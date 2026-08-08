import { PRESETS } from "../domain/biomes";
import {
  INTERIOR_PROP_RULES,
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
  const unobstructed = new Set<string>();
  const unobstructedDoors = new Set<string>();
  const propGroups = new Map<number, Array<{ x: number; y: number; tile: Grid[number][number] }>>();
  let doorCount = 0;
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      const tile = grid[y][x];
      if (tile.terrain === Terrain.Ground) {
        assert(tile.roomId !== undefined, `${label}: floor without a room`);
        assert(tile.roomRole, `${label}: floor without a functional role`);
        if (tile.interiorProp) {
          assert(tile.interiorPropId !== undefined, `${label}: prop without an object id`);
          const touchesDoor = [grid[y - 1]?.[x], grid[y + 1]?.[x], grid[y]?.[x - 1], grid[y]?.[x + 1]]
            .some((neighbor) => neighbor?.terrain === Terrain.Door);
          assert(!touchesDoor, `${label}: interior prop blocks a doorway`);
          const group = propGroups.get(tile.interiorPropId!) ?? [];
          group.push({ x, y, tile });
          propGroups.set(tile.interiorPropId!, group);
        }
        if (!tile.interiorProp || INTERIOR_PROP_RULES[tile.interiorProp].movement !== "blocked") {
          unobstructed.add(`${x},${y}`);
        }
        roomIds.add(tile.roomId);
        walkable.add(`${x},${y}`);
      } else if (tile.terrain === Terrain.Door) {
        assert(tile.doorOrientation !== undefined, `${label}: unoriented door`);
        doorCount += 1;
        walkable.add(`${x},${y}`);
        unobstructed.add(`${x},${y}`);
        unobstructedDoors.add(`${x},${y}`);
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

  for (const [propId, cells] of propGroups) {
    const kinds = new Set(cells.map(({ tile }) => tile.interiorProp));
    const rooms = new Set(cells.map(({ tile }) => tile.roomId));
    assert(kinds.size === 1 && rooms.size === 1, `${label}: prop ${propId} crosses types or rooms`);
    const kind = cells[0].tile.interiorProp!;
    const cellKeys = new Set(cells.map(({ x, y }) => `${x},${y}`));
    const reached = new Set([cellKeys.values().next().value as string]);
    const groupQueue = [...reached];
    for (let index = 0; index < groupQueue.length; index += 1) {
      const [x, y] = groupQueue[index].split(",").map(Number);
      for (const [offsetX, offsetY] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const next = `${x + offsetX},${y + offsetY}`;
        if (cellKeys.has(next) && !reached.has(next)) { reached.add(next); groupQueue.push(next); }
      }
    }
    assert(reached.size === cells.length, `${label}: prop ${propId} has a broken footprint`);
    if (kind === "bed") {
      assert(cells.length === 2, `${label}: bed ${propId} must occupy two cells`);
      const facing = cells[0].tile.propFacing;
      assert(facing, `${label}: bed ${propId} has no wall-facing direction`);
      const head = [...cells].sort((a, b) => facing === "north" ? a.y - b.y
        : facing === "south" ? b.y - a.y : facing === "west" ? a.x - b.x : b.x - a.x)[0];
      const wallX = head.x + (facing === "west" ? -1 : facing === "east" ? 1 : 0);
      const wallY = head.y + (facing === "north" ? -1 : facing === "south" ? 1 : 0);
      assert(grid[wallY]?.[wallX]?.terrain === Terrain.Wall,
        `${label}: bed ${propId} is not headed against a wall`);
      const tail = [...cells].sort((a, b) => facing === "north" ? b.y - a.y
        : facing === "south" ? a.y - b.y : facing === "west" ? b.x - a.x : a.x - b.x)[0];
      const footX = tail.x + (facing === "west" ? 1 : facing === "east" ? -1 : 0);
      const footY = tail.y + (facing === "north" ? 1 : facing === "south" ? -1 : 0);
      assert(grid[footY]?.[footX]?.terrain === Terrain.Ground &&
        grid[footY][footX].roomId === tail.tile.roomId && !grid[footY][footX].interiorProp,
      `${label}: bed ${propId} has no usable space at its foot`);
    }
    if (kind === "tomb") {
      assert(cells.length === 2, `${label}: tomb ${propId} must occupy two cells`);
      assert(cells.every(({ x, y }) => [grid[y - 1]?.[x], grid[y + 1]?.[x], grid[y]?.[x - 1], grid[y]?.[x + 1]]
        .some((neighbor) => neighbor?.terrain === Terrain.Wall)),
      `${label}: tomb ${propId} must run along a wall`);
    }
    if (kind === "bench") assert(cells.length >= 2, `${label}: bench ${propId} is too short`);
    if (kind === "bar") assert(cells.length >= 3, `${label}: bar ${propId} is too short`);
    if (kind === "altar") assert(cells.length >= 2, `${label}: altar ${propId} is too small`);
  }

  const unobstructedStart = (unobstructedDoors.values().next().value as string | undefined) ??
    (unobstructed.values().next().value as string | undefined);
  assert(unobstructedStart, `${label}: furniture blocks the entire interior`);
  const unobstructedVisited = new Set([unobstructedStart]);
  const unobstructedQueue = [unobstructedStart];
  for (let index = 0; index < unobstructedQueue.length; index += 1) {
    const [x, y] = unobstructedQueue[index].split(",").map(Number);
    for (const [offsetX, offsetY] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = `${x + offsetX},${y + offsetY}`;
      if (unobstructed.has(next) && !unobstructedVisited.has(next)) {
        unobstructedVisited.add(next);
        unobstructedQueue.push(next);
      }
    }
  }
  assert(unobstructedVisited.size === unobstructed.size,
    `${label}: furniture creates an unreachable floor pocket`);
  assert([...unobstructedDoors].every((door) => unobstructedVisited.has(door)),
    `${label}: furniture disconnects one or more doors`);
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

function interiorPropGroups(
  grid: Grid,
  kind: NonNullable<Grid[number][number]["interiorProp"]>,
  role?: string,
) {
  const groups = new Map<number, Array<{ x: number; y: number }>>();
  grid.forEach((row, y) => row.forEach((tile, x) => {
    if (tile.interiorProp !== kind || tile.interiorPropId === undefined ||
      (role !== undefined && tile.roomRole !== role)) return;
    const cells = groups.get(tile.interiorPropId) ?? [];
    cells.push({ x, y });
    groups.set(tile.interiorPropId, cells);
  }));
  return groups;
}

type GridPoint = { x: number; y: number };

function adjacentPoints({ x, y }: GridPoint): GridPoint[] {
  return [
    { x: x + 1, y },
    { x: x - 1, y },
    { x, y: y + 1 },
    { x, y: y - 1 },
  ];
}

function exteriorDoorApproaches(grid: Grid, role: string) {
  const approaches: Array<{ door: GridPoint; approach: GridPoint }> = [];
  grid.forEach((row, y) => row.forEach((tile, x) => {
    if (tile.terrain !== Terrain.Door) return;
    const door = { x, y };
    const neighbors = adjacentPoints(door);
    if (!neighbors.some((point) => grid[point.y]?.[point.x]?.terrain === Terrain.Void)) return;
    for (const approach of neighbors) {
      const approachTile = grid[approach.y]?.[approach.x];
      if (approachTile?.terrain === Terrain.Ground && approachTile.roomRole === role) {
        approaches.push({ door, approach });
      }
    }
  }));
  return approaches;
}

function roomDoorApproaches(grid: Grid, role: string) {
  const approaches: GridPoint[] = [];
  grid.forEach((row, y) => row.forEach((tile, x) => {
    if (tile.terrain !== Terrain.Ground || tile.roomRole !== role) return;
    if (adjacentPoints({ x, y }).some((point) =>
      grid[point.y]?.[point.x]?.terrain === Terrain.Door)) {
      approaches.push({ x, y });
    }
  }));
  return approaches;
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

const requiredInteriorProps: Partial<Record<InteriorMode, Array<NonNullable<Grid[number][number]["interiorProp"]>>>> = {
  house: ["table", "chair", "bed", "cabinet"],
  tavern: ["bar", "table", "chair", "bed", "cabinet"],
  castle: ["table", "bench", "crate"],
  cathedral: ["bench", "altar", "cabinet"],
  crypt: ["tomb", "altar"],
  ship: ["table", "bed", "crate", "cabinet"],
  spaceship: ["console", "bed", "crate"],
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
  const props = new Set(grid.flatMap((row) => row.map(({ interiorProp }) => interiorProp))
    .filter((prop): prop is NonNullable<Grid[number][number]["interiorProp"]> => Boolean(prop)));
  for (const prop of requiredInteriorProps[preset.mode] ?? []) {
    assert(props.has(prop), `${preset.id}: missing required interior prop ${prop}`);
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
    const commonRoomTables = interiorPropGroups(grid, "table", "Common room");
    const commonRoomChairs = interiorPropGroups(grid, "chair", "Common room");
    assert(commonRoomTables.size >= 3,
      "tavern: the common room must contain at least three distinct tables");
    for (const table of commonRoomTables.values()) {
      const adjacentChairs = [...commonRoomChairs.values()].filter((chair) => chair.some((seat) =>
        table.some((cell) => Math.abs(cell.x - seat.x) + Math.abs(cell.y - seat.y) === 1)));
      assert(adjacentChairs.length >= 2,
        "tavern: every common-room table must have coherent seating");
    }
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
    const bedroomIds = new Set(grid.flatMap((row) => row.filter((tile) =>
      tile.roomRole?.startsWith("Bedroom ")).map((tile) => tile.roomId)));
    const furnishedBedroomIds = new Set(grid.flatMap((row) => row.filter((tile) =>
      tile.roomRole?.startsWith("Bedroom ") && tile.interiorProp === "bed")
      .map((tile) => tile.roomId)));
    assert([...bedroomIds].every((roomId) => furnishedBedroomIds.has(roomId)),
      "house: every bedroom must contain a wall-anchored bed");
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
    const naveBenchGroups = new Set(grid.flatMap((row) => row.filter((tile) =>
      tile.roomRole === "Nave and transept" && tile.interiorProp === "bench")
      .map((tile) => tile.interiorPropId)));
    assert(naveBenchGroups.size >= 4,
      "cathedral: the nave must contain several real rows of pews");
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

for (const mode of ["house", "tavern", "cathedral", "crypt"] as const) {
  const preset = PRESETS.find((candidate) => candidate.mode === mode)!;
  for (let index = 0; index < 32; index += 1) {
    const grid = generateTerrain({ ...preset, seed: `${mode}-furniture-audit-${index}` });
    generated += 1;
    assertInterior(grid, preset.buildingCount, `${mode}:furniture-audit-${index}`);
    if (mode === "house") {
      const bedroomIds = new Set(grid.flatMap((row) => row.filter((tile) =>
        tile.roomRole?.startsWith("Bedroom ")).map((tile) => tile.roomId)));
      const bedRoomIds = new Set(grid.flatMap((row) => row.filter((tile) =>
        tile.roomRole?.startsWith("Bedroom ") && tile.interiorProp === "bed")
        .map((tile) => tile.roomId)));
      assert([...bedroomIds].every((roomId) => bedRoomIds.has(roomId)),
        `${mode}:${index}: every bedroom needs a bed`);
    } else if (mode === "tavern") {
      const bars = interiorPropGroups(grid, "bar", "Common room");
      assert(bars.size === 1,
        `${mode}:${index}: common room needs one continuous bar`);
      const bar = [...bars.values()][0];
      const verticalBar = bar.every((cell) => cell.x === bar[0].x);
      const serviceDirections = verticalBar ? [[-1, 0], [1, 0]] : [[0, -1], [0, 1]];
      const barHasServiceStrip = serviceDirections.some(([dx, dy]) => bar.every(({ x, y }) =>
        grid[y + dy]?.[x + dx]?.terrain === Terrain.Ground &&
        grid[y + dy]?.[x + dx]?.roomRole === "Common room" &&
        !grid[y + dy]?.[x + dx]?.interiorProp) && bar.some(({ x, y }) => {
        const service = { x: x + dx, y: y + dy };
        return adjacentPoints(service).some((door) => grid[door.y]?.[door.x]?.terrain === Terrain.Door &&
          adjacentPoints(door).some((kitchen) => grid[kitchen.y]?.[kitchen.x]?.roomRole === "Kitchen"));
      }));
      assert(barHasServiceStrip,
        `${mode}:${index}: bar needs a continuous service strip linked to the kitchen`);
      const tables = interiorPropGroups(grid, "table", "Common room");
      assert(tables.size >= 3,
        `${mode}:${index}: common room needs at least three tables`);
      assert([...tables.values()].some((table) => table.length === 1) &&
        [...tables.values()].some((table) => table.length === 2),
      `${mode}:${index}: common room needs both square and rectangular tables`);
      const rectangularTables = [...tables.values()].filter((table) => table.length === 2);
      assert(rectangularTables.some((table) => table[0].y === table[1].y) &&
        rectangularTables.some((table) => table[0].x === table[1].x),
      `${mode}:${index}: rectangular tables need both orientations`);
      const tableList = [...tables.values()];
      for (let first = 0; first < tableList.length; first += 1) {
        for (let second = first + 1; second < tableList.length; second += 1) {
          const distance = Math.min(...tableList[first].flatMap((a) => tableList[second].map((b) =>
            Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)))));
          assert(distance >= 3, `${mode}:${index}: table groups leave no circulation gap`);
        }
      }
      const guestBeds = interiorPropGroups(grid, "bed");
      for (const bed of guestBeds.values()) {
        const vertical = bed.every((cell) => cell.x === bed[0].x);
        const hugsLongWall = vertical
          ? [-1, 1].some((offset) => bed.every(({ x, y }) => grid[y]?.[x + offset]?.terrain === Terrain.Wall))
          : [-1, 1].some((offset) => bed.every(({ x, y }) => grid[y + offset]?.[x]?.terrain === Terrain.Wall));
        assert(hugsLongWall, `${mode}:${index}: guest bed must hug a side wall`);
      }
    } else if (mode === "cathedral") {
      const altars = interiorPropGroups(grid, "altar", "Nave and transept");
      assert(altars.size === 1,
        `${mode}:${index}: nave needs one altar`);
      const pews = interiorPropGroups(grid, "bench", "Nave and transept");
      assert(pews.size >= 4,
        `${mode}:${index}: nave needs several pew rows`);
      const entrances = exteriorDoorApproaches(grid, "Nave and transept");
      assert(entrances.length === 1,
        `${mode}:${index}: nave needs one unambiguous exterior entrance`);
      const { door, approach } = entrances[0];
      const verticalAxis = door.x === approach.x;
      assert(verticalAxis || door.y === approach.y,
        `${mode}:${index}: exterior entrance is not orthogonal to the nave`);
      const axis = verticalAxis ? approach.x : approach.y;
      const altar = [...altars.values()][0];
      assert(altar.some((cell) => (verticalAxis ? cell.x : cell.y) === axis),
        `${mode}:${index}: altar must sit on the true entrance axis`);
      const altarDepths = new Set(altar.map((cell) => verticalAxis ? cell.y : cell.x));
      assert(altarDepths.size === 1,
        `${mode}:${index}: altar must span across, rather than along, the nave axis`);
      const altarDepth = [...altarDepths][0];
      const entranceDepth = verticalAxis ? approach.y : approach.x;
      assert(altarDepth !== entranceDepth,
        `${mode}:${index}: altar cannot occupy the entrance row`);
      const pewCells = new Set([...pews.values()].flat().map(({ x, y }) => `${x},${y}`));
      assert([...pewCells].every((value) => {
        const [x, y] = value.split(",").map(Number);
        const mirrorX = verticalAxis ? axis * 2 - x : x;
        const mirrorY = verticalAxis ? y : axis * 2 - y;
        return pewCells.has(`${mirrorX},${mirrorY}`);
      }), `${mode}:${index}: pew rows must be mirror-symmetric`);
      const step = Math.sign(altarDepth - entranceDepth);
      for (let depth = entranceDepth; depth !== altarDepth; depth += step) {
        const x = verticalAxis ? axis : depth;
        const y = verticalAxis ? depth : axis;
        const tile = grid[y]?.[x];
        assert(tile?.terrain === Terrain.Ground && tile.roomRole === "Nave and transept",
          `${mode}:${index}: entrance-to-altar axis leaves the nave at ${x},${y}`);
        assert(!tile.interiorProp,
          `${mode}:${index}: prop blocks the entrance-to-altar aisle at ${x},${y}`);
      }
    } else {
      const tombs = [...interiorPropGroups(grid, "tomb").values()];
      assert(tombs.length >= 2, `${mode}:${index}: crypt needs multiple wall-aligned tombs`);
      const burialRoomIds = new Set(grid.flatMap((row) => row.filter((tile) =>
        tile.roomRole?.startsWith("Burial vault ")).map((tile) => tile.roomId)));
      const tombRoomIds = new Set(tombs.map((tomb) => grid[tomb[0].y][tomb[0].x].roomId));
      assert([...burialRoomIds].every((roomId) => tombRoomIds.has(roomId)),
        `${mode}:${index}: every burial vault needs at least one tomb`);
      const passageProps = grid.flatMap((row) => row.filter((tile) =>
        tile.roomRole === "Processional passage" && tile.interiorProp));
      assert(passageProps.length === 0, `${mode}:${index}: crypt passage must stay clear`);
      for (let first = 0; first < tombs.length; first += 1) {
        for (let second = first + 1; second < tombs.length; second += 1) {
          const distance = Math.min(...tombs[first].flatMap((a) => tombs[second].map((b) =>
            Math.abs(a.x - b.x) + Math.abs(a.y - b.y))));
          assert(distance >= 2, `${mode}:${index}: tombs need a circulation gap`);
        }
      }
      const tombOrientationsByRoom = new Map<number, Set<"horizontal" | "vertical">>();
      for (const tomb of tombs) {
        const horizontal = tomb.every((cell) => cell.y === tomb[0].y);
        const vertical = tomb.every((cell) => cell.x === tomb[0].x);
        assert(horizontal !== vertical,
          `${mode}:${index}: tomb footprint must have one clear orientation`);
        const roomId = grid[tomb[0].y][tomb[0].x].roomId;
        assert(roomId !== undefined, `${mode}:${index}: tomb has no burial room`);
        const orientations = tombOrientationsByRoom.get(roomId) ?? new Set();
        orientations.add(horizontal ? "horizontal" : "vertical");
        tombOrientationsByRoom.set(roomId, orientations);
      }
      for (const [roomId, orientations] of tombOrientationsByRoom) {
        assert(orientations.size === 1,
          `${mode}:${index}: burial room ${roomId} mixes tomb orientations`);
      }

      const sanctumAltars = interiorPropGroups(grid, "altar", "Inner sanctum");
      const sanctumBenches = interiorPropGroups(grid, "bench", "Inner sanctum");
      assert(sanctumAltars.size === 1,
        `${mode}:${index}: inner sanctum needs one altar`);
      assert(sanctumBenches.size >= 1,
        `${mode}:${index}: inner sanctum needs seating facing its altar`);
      const altarCells = [...sanctumAltars.values()][0];
      const benchCells = [...sanctumBenches.values()].flat();
      const altarBenchGap = Math.min(...altarCells.flatMap((altarCell) =>
        benchCells.map((benchCell) =>
          Math.abs(altarCell.x - benchCell.x) + Math.abs(altarCell.y - benchCell.y))));
      assert(altarBenchGap >= 2,
        `${mode}:${index}: inner-sanctum altar and seating must not touch`);
      const sanctumEntrances = roomDoorApproaches(grid, "Inner sanctum");
      assert(sanctumEntrances.length >= 1,
        `${mode}:${index}: inner sanctum has no usable entrance approach`);
      const averageEntranceDepth = (cells: GridPoint[]) => cells.reduce((sum, cell) => sum +
        Math.min(...sanctumEntrances.map((entrance) =>
          Math.abs(cell.x - entrance.x) + Math.abs(cell.y - entrance.y))), 0) / cells.length;
      assert(averageEntranceDepth(altarCells) > averageEntranceDepth(benchCells),
        `${mode}:${index}: altar must be deeper in the sanctum than its seating`);
    }
  }
}

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
  if (preset.mode === "tavern") {
    const guestRoomIds = new Set(compactGrid.flatMap((row) => row.filter((tile) =>
      tile.roomRole?.startsWith("Guest room ")).map((tile) => tile.roomId)));
    const bedRoomIds = new Set(compactGrid.flatMap((row) => row.filter((tile) =>
      tile.roomRole?.startsWith("Guest room ") && tile.interiorProp === "bed")
      .map((tile) => tile.roomId)));
    assert([...guestRoomIds].every((roomId) => bedRoomIds.has(roomId)),
      `${preset.id}:compact-interior: every guest room needs a bed`);
    assert(interiorPropGroups(compactGrid, "bar", "Common room").size === 1 &&
      interiorPropGroups(compactGrid, "table", "Common room").size >= 3,
    `${preset.id}:compact-interior: common room needs its bar and tables`);
  } else if (preset.mode === "crypt") {
    const tombs = [...interiorPropGroups(compactGrid, "tomb").values()];
    const burialRoomIds = new Set(compactGrid.flatMap((row) => row.filter((tile) =>
      tile.roomRole?.startsWith("Burial vault ")).map((tile) => tile.roomId)));
    const tombRoomIds = new Set(tombs.map((tomb) => compactGrid[tomb[0].y][tomb[0].x].roomId));
    assert([...burialRoomIds].every((roomId) => tombRoomIds.has(roomId)),
      `${preset.id}:compact-interior: every burial vault needs a tomb`);
    assert(interiorPropGroups(compactGrid, "altar", "Inner sanctum").size === 1 &&
      interiorPropGroups(compactGrid, "bench", "Inner sanctum").size >= 1,
    `${preset.id}:compact-interior: sanctum needs an altar and seating`);
  }
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
