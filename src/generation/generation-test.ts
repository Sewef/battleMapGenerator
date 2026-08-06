import { PRESETS } from "../domain/biomes";
import {
  Obstacle,
  Terrain,
  tileSurface,
  type Grid,
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

function assertHouse(grid: Grid, expectedRooms: number, label: string) {
  const roomIds = new Set<number>();
  const walkable = new Set<string>();
  let doorCount = 0;
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      const tile = grid[y][x];
      if (tile.terrain === Terrain.Ground) {
        assert(tile.roomId !== undefined, `${label}: floor without a room`);
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
  assert(doorCount === expectedRooms, `${label}: expected one entrance plus ${expectedRooms - 1} internal doors`);

  const start = walkable.values().next().value as string | undefined;
  assert(start, `${label}: house has no walkable floor`);
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

let generated = 0;
for (const preset of PRESETS) {
  for (let index = 0; index < 3; index += 1) {
    const options = { ...preset, seed: `audit-${index}` };
    const grid = generateTerrain(options);
    assertGrid(grid, `${preset.id}:${index}`);
    if (preset.mode === "house") {
      assertHouse(grid, preset.buildingCount, `${preset.id}:${index}`);
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

const housePreset = PRESETS.find(({ mode }) => mode === "house");
assert(housePreset, "missing house preset");
for (let roomCount = 2; roomCount <= 12; roomCount += 1) {
  const grid = generateTerrain({
    ...housePreset,
    width: 30,
    height: 22,
    buildingCount: roomCount,
    seed: `house-room-count-${roomCount}`,
  });
  assertHouse(grid, roomCount, `house:${roomCount}-rooms`);
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
const roomFogItems = fogItems.filter(({ name, type }) =>
  type === "CURVE" && /^Room \d+ Fog$/.test(name)
);
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
