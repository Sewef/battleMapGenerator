import { PRESETS } from "../domain/biomes";
import {
  INTERIOR_ROOM_LIMITS,
  INTERIOR_MINIMUM_DIMENSIONS,
  Obstacle,
  Terrain,
  isInteriorMode,
  tileSurface,
  type Grid,
  type InteriorMode,
} from "../domain/map";
import { generateTerrain } from "./generate";
import { createOwlbearSceneJson } from "../export/owlbear";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertGrid(grid: Grid, label: string) {
  assert(grid.length > 0 && grid[0].length > 0, `${label}: empty grid`);
  for (const row of grid) {
    assert(row.length === grid[0].length, `${label}: ragged grid`);
    for (const tile of row) {
      assert(
        tile.height !== undefined && tile.height >= 0 && tile.height <= 1,
        `${label}: invalid height`,
      );
      if (tile.terrain === Terrain.Cliff) {
        assert(
          tile.elevation !== undefined &&
            tile.elevation >= 1 &&
            tile.elevation <= 3,
          `${label}: invalid cliff elevation`,
        );
      }
      const surface = tileSurface(tile);
      assert(
        tile.obstacle !== Obstacle.Building || !surface,
        `${label}: building overlaps a road`,
      );
      assert(
        tile.obstacle === Obstacle.None || !surface,
        `${label}: obstacle overlaps a road or bridge`,
      );
      if (surface === Terrain.Bridge) {
        assert(
          tile.terrain === Terrain.Water || tile.terrain === Terrain.Ravine,
          `${label}: bridge without a crossing`,
        );
      }
      assert(
        surface !== Terrain.Road || tile.terrain !== Terrain.Cliff,
        `${label}: road crosses an uncarved cliff`,
      );
      if (tile.transition) {
        assert(
          surface === Terrain.Road &&
            (tile.terrain === Terrain.Ground ||
              tile.terrain === Terrain.Difficult),
          `${label}: invalid elevation transition`,
        );
        assert(
          Number.isFinite(tile.transitionNormalX) &&
            Number.isFinite(tile.transitionNormalY) &&
            Math.hypot(
              tile.transitionNormalX ?? 0,
              tile.transitionNormalY ?? 0,
            ) > .9,
          `${label}: invalid transition normal (${tile.transitionNormalX}, ${tile.transitionNormalY})`,
        );
      }
      if (
        tile.obstacle !== Obstacle.None &&
        tile.terrain !== Terrain.Ground &&
        tile.terrain !== Terrain.Difficult
      ) {
        assert(
          tile.obstacle === Obstacle.Building && surface === Terrain.Road,
          `${label}: obstacle on invalid terrain`,
        );
      }
    }
  }
}

function assertInterior(grid: Grid, expectedRooms: number, label: string, expectedDoors = expectedRooms) {
  const roomIds = new Set<number>();
  const walkable = new Set<string>();
  let doorCount = 0;
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      const tile = grid[y][x];
      if (tile.terrain === Terrain.Ground) {
        assert(tile.roomId !== undefined, `${label}: floor without a room`);
        assert(tile.roomRole, `${label}: floor without a functional role`);
        roomIds.add(tile.roomId);
        walkable.add(`${x},${y}`);
      } else if (tile.terrain === Terrain.Door) {
        assert(tile.doorOrientation !== undefined, `${label}: unoriented door`);
        doorCount += 1;
        walkable.add(`${x},${y}`);
      }
    }
  }
  assert(roomIds.size === expectedRooms, `${label}: expected ${expectedRooms} rooms, got ${roomIds.size}`);
  assert(doorCount === expectedDoors, `${label}: expected ${expectedDoors} doors, got ${doorCount}`);

  const start = walkable.values().next().value as string | undefined;
  assert(start, `${label}: interior has no walkable floor`);
  const visited = new Set([start]);
  const queue = [start];
  for (let index = 0; index < queue.length; index += 1) {
    const [x, y] = queue[index].split(",").map(Number);
    for (const [offsetX, offsetY] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const key = `${x + offsetX},${y + offsetY}`;
      if (walkable.has(key) && !visited.has(key)) {
        visited.add(key);
        queue.push(key);
      }
    }
  }
  assert(visited.size === walkable.size, `${label}: disconnected rooms`);
}

function roomRoles(grid: Grid) {
  return new Set(
    grid.flatMap((row) => row.map(({ roomRole }) => roomRole))
      .filter((role): role is string => Boolean(role)),
  );
}

function hasNonRectangularRoom(grid: Grid) {
  const rooms = new Map<number, Array<{ x: number; y: number }>>();
  grid.forEach((row, y) => row.forEach((tile, x) => {
    if (tile.terrain !== Terrain.Ground || tile.roomId === undefined) return;
    const cells = rooms.get(tile.roomId) ?? [];
    cells.push({ x, y });
    rooms.set(tile.roomId, cells);
  }));
  return [...rooms.values()].some((cells) => {
    const width = Math.max(...cells.map(({ x }) => x)) - Math.min(...cells.map(({ x }) => x)) + 1;
    const height = Math.max(...cells.map(({ y }) => y)) - Math.min(...cells.map(({ y }) => y)) + 1;
    return cells.length < width * height;
  });
}

function doorConnections(grid: Grid) {
  const connections = new Set<string>();
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      const current = grid[y][x];
      if (current.terrain !== Terrain.Door || !current.doorOrientation) continue;
      const neighbors = current.doorOrientation === "horizontal"
        ? [grid[y - 1]?.[x], grid[y + 1]?.[x]]
        : [grid[y]?.[x - 1], grid[y]?.[x + 1]];
      const roles = neighbors
        .map((neighbor) => neighbor?.roomRole)
        .filter((role): role is string => Boolean(role));
      if (roles.length === 2 && roles[0] !== roles[1]) {
        connections.add([...roles].sort().join(" | "));
      }
    }
  }
  return connections;
}

const requiredInteriorRoles: Record<InteriorMode, string[]> = {
  house: ["Living room", "Kitchen", "Hallway", "Bedroom 1"],
  tavern: ["Common room", "Kitchen", "Hallway", "Guest room 1"],
  spaceship: ["Central spine", "Cockpit", "Engineering"],
  ship: ["Main gangway", "Captain's cabin", "Galley"],
  "ship-deck": ["Quarterdeck", "Main deck", "Forecastle"],
  castle: ["Great hall and galleries", "Guardroom", "Armory"],
  cathedral: ["Nave and transept", "Sacristy", "Reliquary"],
  crypt: ["Processional passage", "Inner sanctum", "Burial vault 2"],
};

let generated = 0;
for (const preset of PRESETS) {
  for (let index = 0; index < 3; index += 1) {
    const options = { ...preset, seed: `audit-${index}` };
    const grid = generateTerrain(options);
    assertGrid(grid, `${preset.id}:${index}`);
    if (isInteriorMode(preset.mode)) {
      assertInterior(grid, preset.buildingCount, `${preset.id}:${index}`,
        preset.mode === "ship-deck" ? 0 : preset.buildingCount);
    }
    if (index === 0) {
      const duplicate = generateTerrain(options);
      assert(
        JSON.stringify(grid) === JSON.stringify(duplicate),
        `${preset.id}: generation is not deterministic`,
      );
    }
    generated += 1;
  }
}

for (const preset of PRESETS.filter(({ mode }) => isInteriorMode(mode))) {
  if (!isInteriorMode(preset.mode)) continue;
  const grid = generateTerrain({ ...preset, seed: `${preset.id}-semantics` });
  const roles = roomRoles(grid);
  for (const role of requiredInteriorRoles[preset.mode]) {
    assert(roles.has(role), `${preset.id}: missing required ${role}`);
  }
  const connections = doorConnections(grid);
  if (preset.mode === "tavern") {
    assert(
      connections.has(["Common room", "Kitchen"].sort().join(" | ")),
      `${preset.id}: kitchen must open directly into the main room`,
    );
    assert(
      connections.has(["Common room", "Hallway"].sort().join(" | ")),
      `${preset.id}: hallway must open from the main room`,
    );
  }
  if (preset.mode === "house") {
    assert(
      connections.has(["Living room", "Hallway"].sort().join(" | ")),
      "house: living room must open onto the central hallway",
    );
    const kitchenViaHall = connections.has(["Kitchen", "Hallway"].sort().join(" | "));
    const kitchenViaLiving = connections.has(["Kitchen", "Living room"].sort().join(" | "));
    assert(kitchenViaHall || kitchenViaLiving,
      "house: kitchen must connect to either the hall or the living-room hub");
  }
  if (preset.mode === "spaceship") {
    assert(
      connections.has(["Central spine", "Cockpit"].sort().join(" | ")),
      "spaceship: the central spine must lead directly to the cockpit",
    );
    assert(
      connections.has(["Central spine", "Engineering"].sort().join(" | ")),
      "spaceship: engineering must open onto the central spine",
    );
  }
  if (preset.mode === "spaceship" || preset.mode === "ship" || preset.mode === "ship-deck") {
    assert(
      hasNonRectangularRoom(grid),
      `${preset.id}: vessel must contain at least one shaped compartment`,
    );
  }
  if (preset.mode === "cathedral") {
    const naveCells = grid.flatMap((row, y) =>
      row.map((tile, x) => tile.roomRole === "Nave and transept" ? { x, y } : undefined)
    ).filter((point): point is { x: number; y: number } => Boolean(point));
    const width = Math.max(...naveCells.map(({ x }) => x)) -
      Math.min(...naveCells.map(({ x }) => x)) + 1;
    const height = Math.max(...naveCells.map(({ y }) => y)) -
      Math.min(...naveCells.map(({ y }) => y)) + 1;
    assert(
      naveCells.length < width * height * .8,
      "cathedral: central nave must retain a cross-shaped footprint",
    );
  }
}

for (const preset of PRESETS.filter(({ mode }) => isInteriorMode(mode))) {
  const layouts = new Set<string>();
  for (let index = 0; index < 12; index += 1) {
    const grid = generateTerrain({ ...preset, seed: `${preset.id}-variation-${index}` });
    layouts.add(grid.map((row) => row.map((tile) =>
      `${tile.terrain}:${tile.roomId ?? ""}`
    ).join(",")).join(";"));
  }
  assert(
    layouts.size >= 8,
    `${preset.id}: seed produces too little structural variation (${layouts.size}/12)`,
  );
}

const housePreset = PRESETS.find(({ mode }) => mode === "house");
assert(housePreset, "missing house preset");
for (
  let roomCount = INTERIOR_ROOM_LIMITS.house.minimum;
  roomCount <= INTERIOR_ROOM_LIMITS.house.maximum;
  roomCount += 1
) {
  const grid = generateTerrain({
    ...housePreset,
    width: 30,
    height: 22,
    buildingCount: roomCount,
    seed: `house-room-count-${roomCount}`,
  });
  assertInterior(grid, roomCount, `house:${roomCount}-rooms`);
}

const houseTopologies = new Set<string>();
for (let index = 0; index < 24; index += 1) {
  const grid = generateTerrain({ ...housePreset, seed: `house-topology-${index}` });
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      if (grid[y][x].terrain !== Terrain.Door) continue;
      const neighbors = [grid[y - 1]?.[x], grid[y + 1]?.[x], grid[y]?.[x - 1], grid[y]?.[x + 1]];
      if (!neighbors.some((neighbor) => neighbor?.terrain === Terrain.Void)) continue;
      const entranceRole = neighbors.find((neighbor) => neighbor?.terrain === Terrain.Ground)?.roomRole;
      if (entranceRole === "Hallway") houseTopologies.add("corridor");
      if (entranceRole === "Living room") houseTopologies.add("living-room-entry");
    }
  }
}
assert(houseTopologies.has("corridor") && houseTopologies.has("living-room-entry"),
  "house: seeds must expose both hallway and direct living-room entrances");

for (const preset of PRESETS.filter(({ mode }) => isInteriorMode(mode))) {
  if (!isInteriorMode(preset.mode)) continue;
  const maximumRooms = INTERIOR_ROOM_LIMITS[preset.mode].maximum;
  const minimumDimensions = INTERIOR_MINIMUM_DIMENSIONS[preset.mode];
  const compactGrid = generateTerrain({
    ...preset,
    width: minimumDimensions.width,
    height: minimumDimensions.height,
    buildingCount: maximumRooms,
    seed: `${preset.id}-compact-interior`,
  });
  assertInterior(compactGrid, maximumRooms, `${preset.id}:compact-interior`,
    preset.mode === "ship-deck" ? 0 : maximumRooms);
}

const fogExportGrid = generateTerrain({
  ...housePreset,
  seed: "house-fog-export",
});
const fogExport = await createOwlbearSceneJson(
  fogExportGrid,
  "house-fog-export",
  new Set(),
  {
    dynamicFog: true,
    mapImage: {
      url: "https://example.com/house.webp",
      mime: "image/webp",
      width: fogExportGrid[0].length * 48,
      height: fogExportGrid.length * 48,
    },
  },
);
const fogScene = JSON.parse(fogExport.json) as {
  items: { shared: Record<string, {
    name: string;
    type: string;
    layer: string;
    locked: boolean;
    attachedTo?: string;
    disableAttachmentBehavior?: string[];
    metadata?: Record<string, unknown>;
  }> };
};
const fogEntries = Object.entries(fogScene.items.shared);
const fogItems = Object.values(fogScene.items.shared);
const backgroundEntry = fogEntries.find(([, { layer }]) => layer === "MAP");
assert(backgroundEntry, "house fog export: missing map background");
const [backgroundId, background] = backgroundEntry;
assert(!background.locked, "house fog export: background must stay movable");
for (const [id, item] of fogEntries) {
  if (id === backgroundId) continue;
  assert(
    item.attachedTo === backgroundId,
    `house fog export: ${item.name} is not attached to the background`,
  );
  assert(
    !item.disableAttachmentBehavior?.includes("POSITION"),
    `house fog export: ${item.name} will not follow the background`,
  );
}
const roomFogItems = fogItems.filter(({ type }) => type === "CURVE");
const doorFogItems = fogItems.filter(({ type, metadata }) =>
  type === "LINE" && Array.isArray(
    metadata?.["rodeo.owlbear.dynamic-fog/doors"],
  )
);
assert(
  roomFogItems.length === housePreset.buildingCount,
  `house fog export: expected ${housePreset.buildingCount} room outlines`,
);
assert(
  doorFogItems.length === housePreset.buildingCount,
  `house fog export: expected ${housePreset.buildingCount} doors`,
);

const propGrid: Grid = [[
  {
    terrain: Terrain.Ground,
    obstacle: Obstacle.Tree,
    obstacleId: 1,
    height: .3,
  },
  {
    terrain: Terrain.Ground,
    obstacle: Obstacle.Rock,
    obstacleId: 2,
    height: .3,
  },
]];
const propExport = await createOwlbearSceneJson(
  propGrid,
  "prop-attachment",
  new Set(),
  {
    mapImage: {
      url: "https://example.com/props.webp",
      mime: "image/webp",
      width: propGrid[0].length * 48,
      height: propGrid.length * 48,
    },
  },
);
const propScene = JSON.parse(propExport.json) as {
  items: { shared: Record<string, {
    layer: string;
    attachedTo?: string;
  }> };
};
const propEntries = Object.entries(propScene.items.shared);
const propBackground = propEntries.find(([, item]) => item.layer === "MAP");
assert(propBackground, "prop export: missing map background");
const exportedProps = propEntries.filter(([, item]) => item.layer === "PROP");
assert(exportedProps.length === 2, "prop export: expected tree and rock props");
assert(
  exportedProps.every(([, item]) => item.attachedTo === propBackground[0]),
  "prop export: props must be attached to the background",
);

console.log(`Generation invariants passed for ${generated} maps.`);
