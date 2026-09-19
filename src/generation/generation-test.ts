import { PRESETS } from "../domain/biomes";
import {
  DECK_FEATURE_RULES,
  INTERIOR_PROP_RULES,
  INTERIOR_ROOM_LIMITS,
  INTERIOR_MINIMUM_DIMENSIONS,
  Obstacle,
  OutdoorProp,
  TERRAIN_RULES,
  Terrain,
  isInteriorMode,
  tileSurface,
  type Grid,
  type InteriorMode,
  type LandscapeMode,
  type TerrainKind,
} from "../domain/map";
import { generateTerrain } from "./generate";
import { validateAndRepairGrid } from "./pipeline";
import { createOwlbearSceneJson } from "../export/owlbear";
import { collectMapLightSources } from "../rendering/lighting";
import { selectBedAssetDefinition } from "../rendering/tileset-assets";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const fullyBlockedGrid: Grid = Array.from({ length: 5 }, () =>
  Array.from({ length: 5 }, () => ({
    terrain: Terrain.Cliff,
    obstacle: Obstacle.None,
    height: .8,
  }))
);
const fullyBlockedReport = validateAndRepairGrid(fullyBlockedGrid, "highlands");
assert(
  fullyBlockedReport.remainingConnectedComponents === 0 &&
    fullyBlockedReport.connectivityRepairFailed,
  "connectivity repair: a map without any walkable component must fail",
);

const guestBedVariants = Array.from({ length: 60 }, (_, variant) =>
  selectBedAssetDefinition(false, "north", variant, "Guest room 1"));
assert(guestBedVariants.every((asset) => asset?.folder === "bed_single"),
  "bed assets: tavern guest rooms must use adult beds");
const regularChildBedCount = Array.from({ length: 60 }, (_, variant) =>
  selectBedAssetDefinition(false, "north", variant, "Bedroom 1"))
  .filter((asset) => asset?.folder === "bed_children").length;
assert(regularChildBedCount === 10,
  "bed assets: child beds should be limited to one variant in six");
assert(Array.from({ length: 16 }, (_, variant) =>
  selectBedAssetDefinition(false, "north", variant, "Children bedroom"))
  .every((asset) => asset?.folder === "bed_children"),
"bed assets: explicitly child-oriented rooms must use child beds");

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
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      const tile = grid[y][x];
      if (tile.terrain !== Terrain.Cliff) continue;
      const neighbors = [
        grid[y - 1]?.[x],
        grid[y + 1]?.[x],
        grid[y]?.[x - 1],
        grid[y]?.[x + 1],
      ].filter((neighbor) => neighbor !== undefined);
      const cliffNeighbors = neighbors.filter((neighbor) =>
        neighbor.terrain === Terrain.Cliff
      );
      assert(
        cliffNeighbors.every((neighbor) =>
          Math.abs((tile.elevation ?? 1) - (neighbor.elevation ?? 1)) <= 1
        ),
        `${label}: adjacent cliff tiers jump by more than one level`,
      );
      if (neighbors.some((neighbor) => neighbor.terrain !== Terrain.Cliff)) {
        assert(
          tile.elevation === 1,
          `${label}: an exposed cliff edge starts above elevation one`,
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
    if (kind === "cabinet") {
      const orientation = cells[0].tile.propOrientation;
      assert(cells.length <= (orientation === "horizontal" ? 2 : 3),
        `${label}: cabinet module ${propId} exceeds the available furniture assets`);
    }
    if (kind === "bones") {
      assert(cells.length === 1 && /Burial vault/i.test(cells[0].tile.roomRole ?? ""),
        `${label}: bones ${propId} must be a single floor decoration in a burial vault`);
    }
    if (kind === "wall_chain") {
      const [{ x, y, tile }] = cells;
      assert(cells.length === 1 && tile.propFacing === "south" &&
        grid[y - 1]?.[x]?.terrain === Terrain.Wall,
      `${label}: wall chain ${propId} must hang from a north wall`);
    }
    if (kind === "bed") {
      assert(cells.length === 2 || cells.length === 4,
        `${label}: bed ${propId} must occupy a 1x2 or 2x2 footprint`);
      const facing = cells[0].tile.propFacing;
      assert(facing, `${label}: bed ${propId} has no wall-facing direction`);
      const expectedOrientation = facing === "east" || facing === "west"
        ? "horizontal" : "vertical";
      assert(cells.every(({ tile }) => tile.propOrientation === expectedOrientation),
        `${label}: bed ${propId} orientation disagrees with its pillow direction`);
      const headCoordinate = facing === "north" ? Math.min(...cells.map(({ y }) => y))
        : facing === "south" ? Math.max(...cells.map(({ y }) => y))
          : facing === "west" ? Math.min(...cells.map(({ x }) => x))
            : Math.max(...cells.map(({ x }) => x));
      const tailCoordinate = facing === "north" ? Math.max(...cells.map(({ y }) => y))
        : facing === "south" ? Math.min(...cells.map(({ y }) => y))
          : facing === "west" ? Math.max(...cells.map(({ x }) => x))
            : Math.min(...cells.map(({ x }) => x));
      const heads = cells.filter(({ x, y }) =>
        (facing === "north" || facing === "south" ? y : x) === headCoordinate);
      const tails = cells.filter(({ x, y }) =>
        (facing === "north" || facing === "south" ? y : x) === tailCoordinate);
      assert(heads.every(({ x, y }) => grid[
        y + (facing === "north" ? -1 : facing === "south" ? 1 : 0)
      ]?.[x + (facing === "west" ? -1 : facing === "east" ? 1 : 0)]?.terrain === Terrain.Wall),
      `${label}: bed ${propId} is not headed against a wall`);
      assert(tails.every((tail) => {
        const footX = tail.x + (facing === "west" ? 1 : facing === "east" ? -1 : 0);
        const footY = tail.y + (facing === "north" ? 1 : facing === "south" ? -1 : 0);
        return grid[footY]?.[footX]?.terrain === Terrain.Ground &&
          grid[footY][footX].roomId === tail.tile.roomId && !grid[footY][footX].interiorProp;
      }), `${label}: bed ${propId} has no usable space at its foot`);
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
    if (["drawers", "shelf", "statue", "barrel", "bucket", "flower_pot"].includes(kind)) {
      assert(cells.length === 1, `${label}: ${kind} ${propId} must occupy one cell`);
    }
    if (kind === "drawers" || kind === "shelf") {
      const cell = cells[0];
      assert(grid[cell.y - 1]?.[cell.x]?.terrain === Terrain.Wall,
        `${label}: ${kind} ${propId} must have a wall directly north`);
      assert(cell.tile.propFacing === "south",
        `${label}: ${kind} ${propId} must face into the room`);
    }
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

type DeckFeature = NonNullable<Grid[number][number]["deckFeature"]>;
type DeckPoint = GridPoint & { tile: Grid[number][number] };

function assertShipDeck(grid: Grid, label: string) {
  const key = ({ x, y }: GridPoint) => `${x},${y}`;
  const flood = (allowed: Set<string>, start: string) => {
    const reached = new Set([start]);
    const queue = [start];
    for (let index = 0; index < queue.length; index += 1) {
      const [x, y] = queue[index].split(",").map(Number);
      for (const point of adjacentPoints({ x, y })) {
        const next = key(point);
        if (allowed.has(next) && !reached.has(next)) {
          reached.add(next);
          queue.push(next);
        }
      }
    }
    return reached;
  };
  const hull: DeckPoint[] = [];
  const water = new Set<string>();
  const features = new Map<DeckFeature, DeckPoint[]>();
  const doors: DeckPoint[] = [];
  grid.forEach((row, y) => row.forEach((tile, x) => {
    if (tile.terrain === Terrain.Water) {
      water.add(`${x},${y}`);
    } else {
      assert(tile.terrain === Terrain.Ground || tile.terrain === Terrain.Wall ||
        tile.terrain === Terrain.Door,
      `${label}: sailing-ship exterior contains unexpected ${tile.terrain} at ${x},${y}`);
      hull.push({ x, y, tile });
    }
    if (tile.terrain === Terrain.Door) doors.push({ x, y, tile });
    if (tile.deckFeature) {
      const points = features.get(tile.deckFeature) ?? [];
      points.push({ x, y, tile });
      features.set(tile.deckFeature, points);
    }
  }));
  assert(hull.length > 0 && water.size > 0, `${label}: deck needs both a hull and surrounding water`);

  for (let x = 0; x < grid[0].length; x += 1) {
    assert(grid[0][x].terrain === Terrain.Water &&
      grid[grid.length - 1][x].terrain === Terrain.Water,
    `${label}: water must reach the north and south map edges`);
  }
  for (let y = 0; y < grid.length; y += 1) {
    assert(grid[y][0].terrain === Terrain.Water &&
      grid[y][grid[y].length - 1].terrain === Terrain.Water,
    `${label}: water must reach the east and west map edges`);
  }
  const waterStart = water.values().next().value as string;
  assert(flood(water, waterStart).size === water.size,
    `${label}: hull encloses an impossible pocket of water`);

  const hullKeys = new Set(hull.map(key));
  assert(flood(hullKeys, hullKeys.values().next().value as string).size === hullKeys.size,
    `${label}: hull is not one connected shape`);
  const minX = Math.min(...hull.map(({ x }) => x));
  const maxX = Math.max(...hull.map(({ x }) => x));
  const minY = Math.min(...hull.map(({ y }) => y));
  const maxY = Math.max(...hull.map(({ y }) => y));
  const axis2 = minY + maxY;
  assert(maxX - minX + 1 >= (maxY - minY + 1) * 1.7,
    `${label}: hull is not recognizably longitudinal`);
  for (const point of hull) {
    assert(hullKeys.has(`${point.x},${axis2 - point.y}`),
      `${label}: hull footprint is not laterally symmetric at ${point.x},${point.y}`);
    if (point.tile.terrain === Terrain.Ground) {
      assert(!adjacentPoints(point).some(({ x, y }) => grid[y]?.[x]?.terrain === Terrain.Water),
        `${label}: exposed deck bypasses the hull at ${point.x},${point.y}`);
    }
  }
  const columnWidths: number[] = [];
  for (let x = minX; x <= maxX; x += 1) {
    const ys = hull.filter((point) => point.x === x).map(({ y }) => y);
    assert(ys.length > 0, `${label}: hull has a longitudinal break at x=${x}`);
    assert(Math.max(...ys) - Math.min(...ys) + 1 === ys.length,
      `${label}: hull cross-section is hollow at x=${x}`);
    columnWidths.push(ys.length);
  }
  const maximumBeam = Math.max(...columnWidths);
  assert(columnWidths[0] < maximumBeam && columnWidths[columnWidths.length - 1] < maximumBeam,
    `${label}: bow and stern must both taper relative to the midship beam`);

  const byFeature = (feature: DeckFeature) => features.get(feature) ?? [];
  const groundFeatures: DeckFeature[] = [
    "mast", "hatch", "wheel", "capstan", "cannon", "stairs",
  ];
  for (const feature of groundFeatures) {
    assert(byFeature(feature).every(({ tile }) => tile.terrain === Terrain.Ground),
      `${label}: ${feature} must be placed on the wooden deck`);
  }
  assert(DECK_FEATURE_RULES.mast.movement === "blocked",
    `${label}: masts must block movement`);
  assert(DECK_FEATURE_RULES.cannon.movement === "blocked" &&
    DECK_FEATURE_RULES.railing.movement === "blocked",
  `${label}: cannons and railings must block movement`);
  assert(DECK_FEATURE_RULES.hatch.movement !== "blocked" &&
    DECK_FEATURE_RULES.stairs.movement !== "blocked" &&
    DECK_FEATURE_RULES.gangway.movement !== "blocked",
  `${label}: hatches, stairs, and gangway must remain traversable`);

  const roleCells = (role: string) => hull.filter(({ tile }) =>
    tile.terrain === Terrain.Ground && tile.roomRole === role);
  const quarterdeck = roleCells("Quarterdeck");
  const mainDeck = roleCells("Main deck");
  const forecastle = roleCells("Forecastle");
  assert(quarterdeck.length > 0 && mainDeck.length > 0 && forecastle.length > 0,
    `${label}: Quarterdeck, Main deck, and Forecastle are mandatory`);
  assert(quarterdeck.every(({ tile }) => tile.elevation === 2) &&
    forecastle.every(({ tile }) => tile.elevation === 2),
  `${label}: quarterdeck and forecastle must be uniformly elevated to level 2`);
  assert(mainDeck.every(({ tile }) => tile.elevation === 1),
    `${label}: main deck must be uniformly at level 1`);
  const centerX = (cells: DeckPoint[]) =>
    cells.reduce((sum, point) => sum + point.x, 0) / cells.length;
  const quarterdeckX = centerX(quarterdeck);
  const mainDeckX = centerX(mainDeck);
  const forecastleX = centerX(forecastle);
  const forwardSign = Math.sign(forecastleX - quarterdeckX);
  assert(forwardSign !== 0 &&
    (mainDeckX - quarterdeckX) * forwardSign > 0 &&
    (forecastleX - mainDeckX) * forwardSign > 0,
  `${label}: named deck areas are not ordered stern-to-bow`);
  const progress = ({ x }: GridPoint) => x * forwardSign;

  const masts = byFeature("mast");
  assert(masts.length >= 2 && masts.length <= 3,
    `${label}: deck needs two or three masts, got ${masts.length}`);
  assert(masts.every(({ y }) => Math.abs(y * 2 - axis2) <= 1),
    `${label}: every mast must stand on the longitudinal axis`);
  const mastProgress = masts.map(progress).sort((a, b) => a - b);
  const minimumMastSpacing = Math.max(3, Math.floor((maxX - minX + 1) * .1));
  for (let index = 1; index < mastProgress.length; index += 1) {
    assert(mastProgress[index] - mastProgress[index - 1] >= minimumMastSpacing,
      `${label}: masts are not meaningfully separated`);
  }

  const wheels = byFeature("wheel");
  const capstans = byFeature("capstan");
  const hatches = byFeature("hatch");
  assert(wheels.length === 1 && wheels[0].tile.roomRole === "Quarterdeck",
    `${label}: exactly one wheel must stand on the quarterdeck`);
  assert(capstans.length === 1 &&
    new Set(["Fore waist", "Forecastle", "Head platform"]).has(capstans[0].tile.roomRole ?? ""),
  `${label}: exactly one capstan must stand in the forward deck areas`);
  assert(hatches.length >= 2 && new Set(hatches.map(({ x }) => x)).size >= 2,
    `${label}: deck needs at least two longitudinally separated hatches`);
  const wheelProgress = progress(wheels[0]);
  const capstanProgress = progress(capstans[0]);
  assert(wheelProgress < mastProgress[0] &&
    mastProgress[mastProgress.length - 1] < capstanProgress,
  `${label}: wheel, masts, and capstan are not ordered stern-to-bow`);
  assert(hatches.every((point) =>
    progress(point) > wheelProgress && progress(point) < capstanProgress),
  `${label}: hatches must lie between the helm and foredeck machinery`);

  const stairs = byFeature("stairs");
  assert(stairs.length >= 2, `${label}: raised fore and aft decks both need stairs`);
  for (const stair of stairs) {
    assert(stair.tile.deckFeatureFacing === "east" || stair.tile.deckFeatureFacing === "west",
      `${label}: deck stairs must face along the longitudinal axis`);
    const elevation = stair.tile.elevation ?? 0;
    assert(adjacentPoints(stair).some(({ x, y }) => {
      const neighbor = grid[y]?.[x];
      return neighbor?.terrain === Terrain.Ground &&
        Math.abs((neighbor.elevation ?? 0) - elevation) === 1;
    }), `${label}: stairs at ${stair.x},${stair.y} do not bridge two elevations`);
  }
  for (const raisedRole of ["Quarterdeck", "Forecastle"]) {
    assert(stairs.some((stair) => stair.tile.roomRole === raisedRole ||
      adjacentPoints(stair).some(({ x, y }) => grid[y]?.[x]?.roomRole === raisedRole)),
    `${label}: ${raisedRole} has no stair connection`);
  }

  const railings = byFeature("railing");
  assert(railings.length >= 4, `${label}: raised-deck transitions need blocking railings`);
  const railingFacings = new Set(railings.map(({ tile }) => tile.deckFeatureFacing));
  assert([...railingFacings].every((facing) => facing === "east" || facing === "west"),
    `${label}: raised-deck railings must face along the longitudinal axis`);
  const direction: Record<NonNullable<Grid[number][number]["deckFeatureFacing"]>, GridPoint> = {
    north: { x: 0, y: -1 },
    east: { x: 1, y: 0 },
    south: { x: 0, y: 1 },
    west: { x: -1, y: 0 },
  };
  for (const railing of railings) {
    const facing = railing.tile.deckFeatureFacing;
    assert(railing.tile.terrain === Terrain.Ground && facing,
      `${label}: railing must occupy a raised-deck boundary cell`);
    assert([{ x: -1, y: 0 }, { x: 1, y: 0 }].some((offset) => {
      const neighbor = grid[railing.y + offset.y]?.[railing.x + offset.x];
      return neighbor?.terrain === Terrain.Ground &&
        Math.abs((neighbor.elevation ?? 0) - (railing.tile.elevation ?? 0)) === 1;
    }), `${label}: railing at ${railing.x},${railing.y} does not guard an elevation change`);
  }

  const gangways = byFeature("gangway");
  assert(doors.length === 1 && gangways.length === 1 &&
    doors[0].x === gangways[0].x && doors[0].y === gangways[0].y,
  `${label}: exactly one hull door must also be the gangway`);
  const gangway = gangways[0];
  const gangwayFacing = gangway.tile.deckFeatureFacing;
  assert((gangwayFacing === "north" || gangwayFacing === "south") &&
    gangway.tile.doorOrientation === "horizontal",
  `${label}: gangway must open laterally through a horizontal gunwale`);
  const gangwayDirection = direction[gangwayFacing];
  assert(grid[gangway.y + gangwayDirection.y]?.[gangway.x + gangwayDirection.x]?.terrain === Terrain.Water &&
    grid[gangway.y - gangwayDirection.y]?.[gangway.x - gangwayDirection.x]?.terrain === Terrain.Ground,
  `${label}: gangway must connect open water to the deck interior`);

  const cannons = byFeature("cannon");
  assert(cannons.length >= 4 && cannons.length % 2 === 0,
    `${label}: deck needs at least two complete cannon pairs`);
  const cannonAt = new Map(cannons.map((point) => [key(point), point]));
  const pairXs = new Set<number>();
  for (const cannon of cannons) {
    assert(cannon.tile.deckFeatureFacing === "north" ||
      cannon.tile.deckFeatureFacing === "south",
    `${label}: cannon at ${cannon.x},${cannon.y} must face broadside`);
    assert(cannon.y * 2 !== axis2,
      `${label}: cannon at ${cannon.x},${cannon.y} sits on the centerline`);
    const expectedFacing = cannon.y * 2 < axis2 ? "north" : "south";
    assert(cannon.tile.deckFeatureFacing === expectedFacing,
      `${label}: cannon at ${cannon.x},${cannon.y} faces inward`);
    const mirror = cannonAt.get(`${cannon.x},${axis2 - cannon.y}`);
    assert(mirror && mirror.tile.deckFeatureFacing !== cannon.tile.deckFeatureFacing &&
      mirror.tile.roomRole === cannon.tile.roomRole &&
      mirror.tile.elevation === cannon.tile.elevation,
    `${label}: cannon at ${cannon.x},${cannon.y} lacks a strict opposite broadside mate`);
    const outward = direction[cannon.tile.deckFeatureFacing];
    assert([1, 2].some((distance) => {
      const terrain = grid[cannon.y + outward.y * distance]?.[cannon.x + outward.x * distance]?.terrain;
      return terrain === Terrain.Wall || terrain === Terrain.Water;
    }), `${label}: cannon at ${cannon.x},${cannon.y} is too far from its gunwale`);
    const inward = grid[cannon.y - outward.y]?.[cannon.x - outward.x];
    assert(inward?.terrain === Terrain.Ground,
      `${label}: cannon at ${cannon.x},${cannon.y} has no inward service position`);
    if (expectedFacing === "north") pairXs.add(cannon.x);
  }
  assert(pairXs.size >= 2, `${label}: cannon pairs need at least two longitudinal stations`);

  const passable = new Set<string>();
  for (const point of hull) {
    const { tile } = point;
    if (tile.terrain !== Terrain.Ground && tile.terrain !== Terrain.Door) continue;
    if (tile.obstacle !== Obstacle.None) continue;
    if (tile.interiorProp && INTERIOR_PROP_RULES[tile.interiorProp].movement === "blocked") continue;
    if (tile.deckFeature && DECK_FEATURE_RULES[tile.deckFeature].movement === "blocked") continue;
    passable.add(key(point));
  }
  assert(passable.has(key(gangway)), `${label}: gangway itself is not traversable`);
  const reachable = flood(passable, key(gangway));
  assert(reachable.size === passable.size,
    `${label}: blocking deck features create an unreachable floor pocket`);
  for (const role of ["Quarterdeck", "Main deck", "Forecastle"]) {
    assert(roleCells(role).some((point) => reachable.has(key(point))),
      `${label}: ${role} is unreachable from the gangway`);
  }
  for (const points of features.values()) {
    for (const point of points) {
      if (point.tile.deckFeature === "railing") continue;
      if (passable.has(key(point))) {
        assert(reachable.has(key(point)),
          `${label}: ${point.tile.deckFeature} at ${point.x},${point.y} is unreachable`);
      } else {
        assert(adjacentPoints(point).some((neighbor) => reachable.has(key(neighbor))),
          `${label}: ${point.tile.deckFeature} at ${point.x},${point.y} has no service clearance`);
      }
    }
  }
}

type FurniturePoint = GridPoint & { tile: Grid[number][number] };
type FurnitureRoom = {
  id: number;
  role: string;
  cells: FurniturePoint[];
};

function assertHouseTavernFurniture(
  grid: Grid,
  mode: "house" | "tavern",
  label: string,
) {
  const pointKey = ({ x, y }: GridPoint) => `${x},${y}`;
  const facingStep: Record<NonNullable<Grid[number][number]["propFacing"]>, GridPoint> = {
    north: { x: 0, y: -1 },
    east: { x: 1, y: 0 },
    south: { x: 0, y: 1 },
    west: { x: -1, y: 0 },
  };
  const roomsById = new Map<number, FurnitureRoom>();
  const allProps: FurniturePoint[] = [];
  const doors: FurniturePoint[] = [];
  grid.forEach((row, y) => row.forEach((tile, x) => {
    if (tile.terrain === Terrain.Door) doors.push({ x, y, tile });
    if (tile.terrain !== Terrain.Ground || tile.roomId === undefined) return;
    const room = roomsById.get(tile.roomId) ?? {
      id: tile.roomId,
      role: tile.roomRole ?? "",
      cells: [],
    };
    const point = { x, y, tile };
    room.cells.push(point);
    roomsById.set(tile.roomId, room);
    if (tile.interiorProp) allProps.push(point);
  }));
  const rooms = [...roomsById.values()];
  const roomsMatching = (pattern: RegExp) => rooms.filter(({ role }) => pattern.test(role));
  const groupsInRoom = (
    room: FurnitureRoom,
    kind?: NonNullable<Grid[number][number]["interiorProp"]>,
  ) => {
    const groups = new Map<number, FurniturePoint[]>();
    for (const point of room.cells) {
      if (!point.tile.interiorProp || point.tile.interiorPropId === undefined ||
        (kind !== undefined && point.tile.interiorProp !== kind)) continue;
      const cells = groups.get(point.tile.interiorPropId) ?? [];
      cells.push(point);
      groups.set(point.tile.interiorPropId, cells);
    }
    return groups;
  };
  const occupiedCount = (room: FurnitureRoom) =>
    room.cells.filter(({ tile }) => Boolean(tile.interiorProp)).length;
  const density = (room: FurnitureRoom) => occupiedCount(room) / room.cells.length;

  for (const door of doors) {
    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        const tile = grid[door.y + offsetY]?.[door.x + offsetX];
        if (tile?.terrain === Terrain.Ground) {
          assert(!tile.interiorProp,
            `${label}: prop intrudes into the 3x3 landing around door ${door.x},${door.y}`);
        }
      }
    }
  }

  for (const chair of allProps.filter(({ tile }) => tile.interiorProp === "chair")) {
    const facing = chair.tile.propFacing;
    assert(facing, `${label}: chair at ${chair.x},${chair.y} has no facing`);
    const step = facingStep[facing];
    const facedTile = grid[chair.y + step.y]?.[chair.x + step.x];
    assert(facedTile?.interiorProp === "table",
      `${label}: chair at ${chair.x},${chair.y} does not face a table`);
    const adjacentTableIds = new Set(adjacentPoints(chair).flatMap(({ x, y }) => {
      const tile = grid[y]?.[x];
      return tile?.interiorProp === "table" && tile.interiorPropId !== undefined
        ? [tile.interiorPropId] : [];
    }));
    assert(adjacentTableIds.size === 1,
      `${label}: chair at ${chair.x},${chair.y} is orphaned or shared by several tables`);
  }

  const wallBacked = (group: FurniturePoint[]) => {
    const facings = new Set(group.map(({ tile }) => tile.propFacing));
    if (facings.size !== 1) return false;
    const facing = group[0].tile.propFacing;
    if (!facing) return false;
    const inward = facingStep[facing];
    return group.every(({ x, y }) =>
      grid[y - inward.y]?.[x - inward.x]?.terrain === Terrain.Wall);
  };
  const validateWallGroup = (group: FurniturePoint[], kind: string) => {
    const orientations = new Set(group.map(({ tile }) => tile.propOrientation));
    assert(orientations.size === 1 && group[0].tile.propOrientation,
      `${label}: ${kind} wall group has inconsistent orientation`);
    const orientation = group[0].tile.propOrientation!;
    assert(orientation === "horizontal"
      ? group.every(({ y }) => y === group[0].y)
      : group.every(({ x }) => x === group[0].x),
    `${label}: ${kind} wall group is not a straight run`);
    assert(wallBacked(group), `${label}: ${kind} group is not backed by a wall`);
    const facing = group[0].tile.propFacing!;
    const inward = facingStep[facing];
    const clearFronts = group.filter(({ x, y, tile }) => {
      const front = grid[y + inward.y]?.[x + inward.x];
      return front?.terrain === Terrain.Ground && front.roomId === tile.roomId &&
        !front.interiorProp;
    }).length;
    assert(clearFronts >= Math.ceil(group.length / 2),
      `${label}: ${kind} wall group has no usable frontage`);
  };
  for (const room of rooms) {
    for (const kind of ["cabinet", "hearth"] as const) {
      for (const group of groupsInRoom(room, kind).values()) validateWallGroup(group, kind);
    }
  }

  const commonRoom = roomsMatching(/^Common room$/)[0];
  if (commonRoom && commonRoom.cells.length >= 200) {
    const roomDensity = density(commonRoom);
    assert(roomDensity >= .15 && roomDensity <= .30,
      `${label}: common-room density ${roomDensity.toFixed(3)} is outside 0.15..0.30`);
    const minimumTables = Math.max(4, Math.min(8, Math.floor(commonRoom.cells.length / 40)));
    assert(groupsInRoom(commonRoom, "table").size >= minimumTables,
      `${label}: common room needs ${minimumTables} tables for ${commonRoom.cells.length} cells`);
    assert(groupsInRoom(commonRoom, "hearth").size >= 1,
      `${label}: common room needs a hearth`);
    assert(groupsInRoom(commonRoom, "bar").size === 1,
      `${label}: common room needs one continuous bar group`);
    const wallBenches = [...groupsInRoom(commonRoom, "bench").values()].filter(wallBacked);
    const minimumWallBenches = commonRoom.cells.length >= 250 ? 2 : 1;
    assert(wallBenches.length >= minimumWallBenches,
      `${label}: common room needs ${minimumWallBenches} wall banquette groups`);
  }

  const livingRoom = roomsMatching(/^Living room$/)[0];
  if (livingRoom && livingRoom.cells.length >= 60) {
    const roomDensity = density(livingRoom);
    assert(roomDensity >= .12 && roomDensity <= .30,
      `${label}: living-room density ${roomDensity.toFixed(3)} is outside 0.12..0.30`);
    assert(groupsInRoom(livingRoom, "table").size >= 2,
      `${label}: living room needs at least two table clusters`);
    assert(groupsInRoom(livingRoom, "hearth").size >= 1,
      `${label}: living room needs a hearth`);
    assert(groupsInRoom(livingRoom, "cabinet").size >= 1,
      `${label}: living room needs wall storage`);
    assert([...groupsInRoom(livingRoom, "bench").values()].some(wallBacked),
      `${label}: living room needs a wall-backed seating nook`);
  }

  for (const kitchen of roomsMatching(/^Kitchen$/)) {
    assert(kitchen.cells.length >= 12,
      `${label}: kitchen cannot function in only ${kitchen.cells.length} cells`);
    if (kitchen.cells.length >= 14) {
      for (const kind of ["cabinet", "table", "hearth"] as const) {
        assert(groupsInRoom(kitchen, kind).size >= 1,
          `${label}: kitchen needs at least one ${kind} group`);
      }
    }
    assert(groupsInRoom(kitchen, "chair").size === 0,
      `${label}: kitchen work tables must not be surrounded by dining chairs`);
    if (kitchen.cells.length < 24) continue;
    const roomDensity = density(kitchen);
    const minimumDensity = mode === "house" ? .12 : .14;
    assert(roomDensity >= minimumDensity && roomDensity <= .42,
      `${label}: kitchen density ${roomDensity.toFixed(3)} is outside ` +
      `${minimumDensity.toFixed(2)}..0.42`);
  }

  for (const bedroom of roomsMatching(/^(Bedroom|Guest room) \d+$/)) {
    if (mode === "house") {
      const roomWidth = Math.max(...bedroom.cells.map(({ x }) => x)) -
        Math.min(...bedroom.cells.map(({ x }) => x)) + 1;
      const roomHeight = Math.max(...bedroom.cells.map(({ y }) => y)) -
        Math.min(...bedroom.cells.map(({ y }) => y)) + 1;
      assert(roomWidth >= 2 && roomHeight >= 2,
        `${label}: ${bedroom.role} is an implausible ${roomWidth}x${roomHeight} strip`);
    }
    const roomDensity = density(bedroom);
    const maximumDensity = bedroom.cells.length <= 16 ? .50 : .36;
    const minimumOccupied = bedroom.cells.length <= 16
      ? Math.max(2, Math.min(4, Math.floor(bedroom.cells.length * .36)))
      : Math.max(4, Math.ceil(bedroom.cells.length * .08));
    assert(occupiedCount(bedroom) >= minimumOccupied,
      `${label}: ${bedroom.role} needs ${minimumOccupied} occupied cells`);
    assert(roomDensity <= maximumDensity,
      `${label}: ${bedroom.role} density ${roomDensity.toFixed(3)} exceeds ` +
      maximumDensity.toFixed(2));
    const expectedBeds = bedroom.cells.length >= 90 ? 3 : bedroom.cells.length >= 48 ? 2 : 1;
    assert(groupsInRoom(bedroom, "bed").size >= expectedBeds,
      `${label}: ${bedroom.role} needs ${expectedBeds} beds for ${bedroom.cells.length} cells`);
    if (bedroom.cells.length >= 12) {
      assert(groupsInRoom(bedroom, "cabinet").size >= 1,
        `${label}: ${bedroom.role} needs storage`);
    }
    if (bedroom.cells.length >= 48) {
      assert(groupsInRoom(bedroom, "table").size >= 1 ||
        groupsInRoom(bedroom, "bench").size >= 1,
      `${label}: large ${bedroom.role} needs a desk or bench`);
    }
  }

  const floor = new Set<string>();
  const free = new Set<string>();
  grid.forEach((row, y) => row.forEach((tile, x) => {
    if (tile.terrain !== Terrain.Ground && tile.terrain !== Terrain.Door) return;
    floor.add(`${x},${y}`);
    if (!tile.interiorProp || INTERIOR_PROP_RULES[tile.interiorProp].movement !== "blocked") {
      free.add(`${x},${y}`);
    }
  }));
  const exteriorDoor = doors.find((door) => adjacentPoints(door).some(({ x, y }) =>
    grid[y]?.[x]?.terrain === Terrain.Void));
  assert(exteriorDoor, `${label}: house or tavern has no exterior entrance`);
  const distances = (allowed: Set<string>, start: string) => {
    const result = new Map([[start, 0]]);
    const queue = [start];
    for (let index = 0; index < queue.length; index += 1) {
      const [x, y] = queue[index].split(",").map(Number);
      for (const next of adjacentPoints({ x, y })) {
        const nextKey = pointKey(next);
        if (!allowed.has(nextKey) || result.has(nextKey)) continue;
        result.set(nextKey, result.get(queue[index])! + 1);
        queue.push(nextKey);
      }
    }
    return result;
  };
  const start = pointKey(exteriorDoor);
  const baselineDistances = distances(floor, start);
  const furnishedDistances = distances(free, start);
  const semanticTargets = new Set(doors.map(pointKey));
  for (const room of rooms) {
    for (const bed of groupsInRoom(room, "bed").values()) {
      const facing = bed[0].tile.propFacing;
      if (!facing) continue;
      const step = facingStep[facing];
      const tail = [...bed].sort((a, b) =>
        a.x * step.x + a.y * step.y - (b.x * step.x + b.y * step.y))[0];
      semanticTargets.add(`${tail.x - step.x},${tail.y - step.y}`);
    }
    for (const kind of ["cabinet", "hearth"] as const) {
      for (const group of groupsInRoom(room, kind).values()) {
        const facing = group[0].tile.propFacing;
        if (!facing) continue;
        const step = facingStep[facing];
        const target = group.map(({ x, y }) => ({ x: x + step.x, y: y + step.y }))
          .find((point) => free.has(pointKey(point)));
        assert(target, `${label}: ${kind} group has no reachable frontage target`);
        semanticTargets.add(pointKey(target));
      }
    }
    for (const kind of ["table", "bar"] as const) {
      for (const group of groupsInRoom(room, kind).values()) {
        const candidates = room.cells.filter((point) => free.has(pointKey(point)) &&
          group.some((cell) => Math.abs(cell.x - point.x) + Math.abs(cell.y - point.y) <= 2))
          .sort((a, b) => (furnishedDistances.get(pointKey(a)) ?? Number.POSITIVE_INFINITY) -
            (furnishedDistances.get(pointKey(b)) ?? Number.POSITIVE_INFINITY));
        assert(candidates.length > 0,
          `${label}: ${kind} group has no usable free perimeter`);
        semanticTargets.add(pointKey(candidates[0]));
      }
    }
  }
  for (const target of semanticTargets) {
    const baseline = baselineDistances.get(target);
    const furnished = furnishedDistances.get(target);
    assert(baseline !== undefined && furnished !== undefined,
      `${label}: semantic target ${target} is unreachable from the entrance`);
    const maximumDetour = Math.max(baseline + 6, Math.ceil(baseline * 1.75));
    assert(furnished <= maximumDetour,
      `${label}: furniture turns route to ${target} from ${baseline} into ${furnished} steps`);
  }
}

function assertRoleFurnitureRealism(
  grid: Grid,
  mode: InteriorMode,
  label: string,
) {
  const roomsById = new Map<number, FurnitureRoom>();
  grid.forEach((row, y) => row.forEach((tile, x) => {
    if (tile.terrain !== Terrain.Ground || tile.roomId === undefined) return;
    const room = roomsById.get(tile.roomId) ?? {
      id: tile.roomId,
      role: tile.roomRole ?? "",
      cells: [],
    };
    room.cells.push({ x, y, tile });
    roomsById.set(tile.roomId, room);
  }));
  const groups = (
    room: FurnitureRoom,
    kind?: NonNullable<Grid[number][number]["interiorProp"]>,
  ) => {
    const result = new Map<number, FurniturePoint[]>();
    for (const point of room.cells) {
      const prop = point.tile.interiorProp;
      const propId = point.tile.interiorPropId;
      if (!prop || propId === undefined || (kind && prop !== kind)) continue;
      const cells = result.get(propId) ?? [];
      cells.push(point);
      result.set(propId, cells);
    }
    return result;
  };

  for (const room of roomsById.values()) {
    if (mode === "ship" && room.role === "Crew berths") {
      const expectedBeds = Math.min(4, Math.max(2,
        Math.ceil(room.cells.length / 20)));
      assert(groups(room, "bed").size >= expectedBeds,
        `${label}: ${room.cells.length}-cell crew berths need ` +
        `${expectedBeds} wall berths`);
    }

    if (mode === "spaceship" && room.cells.length >= 18 &&
      /^(Engineering|Life support|Observation room|Utility bay|Escape pods)$/.test(room.role)) {
      const propKinds = new Set(room.cells.flatMap(({ tile }) =>
        tile.interiorProp ? [tile.interiorProp] : []));
      assert(propKinds.size >= 2,
        `${label}: ${room.role} needs a role-specific composition, not only ` +
        `${[...propKinds].join(", ") || "empty floor"}`);
    }

    if (mode === "crypt" && room.role.startsWith("Burial vault ")) {
      const tombs = groups(room, "tomb");
      const expectedTombs = Math.min(6, Math.max(1,
        Math.ceil(room.cells.length / 24)));
      assert(tombs.size >= expectedTombs,
        `${label}: ${room.role} needs ${expectedTombs} tombs for ` +
        `${room.cells.length} cells`);
      if (room.cells.length >= 60) {
        const facings = new Set([...tombs.values()].map((tomb) =>
          tomb[0].tile.propFacing));
        assert(facings.size >= 2,
          `${label}: large ${room.role} must use both opposing walls`);
      }
    }

    if (mode === "crypt" && room.role === "Inner sanctum" &&
      room.cells.length >= 60) {
      const occupied = room.cells.filter(({ tile }) => tile.interiorProp).length;
      assert(occupied / room.cells.length >= .07,
        `${label}: ${room.cells.length}-cell inner sanctum is only ` +
        `${(occupied / room.cells.length * 100).toFixed(1)}% furnished`);
    }

    if (mode === "castle" && room.role === "Kitchen" && room.cells.length >= 8) {
      assert(groups(room, "table").size >= 1,
        `${label}: castle kitchen needs a usable work table`);
    }
  }
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
  house: ["table", "chair", "bed", "cabinet", "hearth"],
  tavern: ["bar", "table", "chair", "bed", "cabinet", "hearth"],
  castle: ["table", "bench", "crate"],
  cathedral: ["bench", "altar", "cabinet"],
  crypt: ["tomb", "altar"],
  ship: ["table", "bed", "crate", "cabinet"],
  spaceship: ["console", "bed", "crate"],
};

type ExteriorEdge = "north" | "east" | "south" | "west";

function exteriorComponents(
  grid: Grid,
  includes: (tile: Grid[number][number], point: GridPoint) => boolean,
) {
  const visited = new Set<string>();
  const components: GridPoint[][] = [];
  const key = ({ x, y }: GridPoint) => `${x},${y}`;
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      const start = { x, y };
      if (visited.has(key(start)) || !includes(grid[y][x], start)) continue;
      const component = [start];
      const queue = [start];
      visited.add(key(start));
      for (let index = 0; index < queue.length; index += 1) {
        for (const next of adjacentPoints(queue[index])) {
          const nextTile = grid[next.y]?.[next.x];
          if (!nextTile || visited.has(key(next)) || !includes(nextTile, next)) continue;
          visited.add(key(next));
          queue.push(next);
          component.push(next);
        }
      }
      components.push(component);
    }
  }
  return components.sort((a, b) => b.length - a.length);
}

function exteriorEdges(grid: Grid, points: GridPoint[]) {
  const edges = new Set<ExteriorEdge>();
  for (const { x, y } of points) {
    if (y === 0) edges.add("north");
    if (x === grid[0].length - 1) edges.add("east");
    if (y === grid.length - 1) edges.add("south");
    if (x === 0) edges.add("west");
  }
  return edges;
}

function touchesOppositeEdges(edges: ReadonlySet<ExteriorEdge>) {
  return (edges.has("north") && edges.has("south")) ||
    (edges.has("east") && edges.has("west"));
}

type ExteriorSpatialMetrics = {
  walkableBreadth: number;
  smallFeatureFragmentRatio: number;
  routeContinuity?: number;
  naturalObstacleClustering?: number;
  naturalObstacleRegions?: number;
  spatialProfile: number[];
};

function isExteriorWalkable(tile: Grid[number][number]) {
  return tile.obstacle === Obstacle.None &&
    (tileSurface(tile) === Terrain.Bridge ||
      TERRAIN_RULES[tile.terrain].movement !== "blocked");
}

function belongsToWalkableSquare(grid: Grid, point: GridPoint) {
  // Membership in a 2x2 square catches maps made almost entirely from
  // single-cell corridors without imposing one absolute width on every biome.
  for (const offsetY of [-1, 0]) {
    for (const offsetX of [-1, 0]) {
      let squareIsWalkable = true;
      for (let squareY = 0; squareY < 2 && squareIsWalkable; squareY += 1) {
        for (let squareX = 0; squareX < 2; squareX += 1) {
          const tile = grid[point.y + offsetY + squareY]?.[point.x + offsetX + squareX];
          if (!tile || !isExteriorWalkable(tile)) {
            squareIsWalkable = false;
            break;
          }
        }
      }
      if (squareIsWalkable) return true;
    }
  }
  return false;
}

function exteriorSpatialProfile(grid: Grid) {
  const columns = 4;
  const rows = 3;
  const profile: number[] = [];
  for (let regionY = 0; regionY < rows; regionY += 1) {
    for (let regionX = 0; regionX < columns; regionX += 1) {
      const minimumX = Math.floor(regionX * grid[0].length / columns);
      const maximumX = Math.floor((regionX + 1) * grid[0].length / columns);
      const minimumY = Math.floor(regionY * grid.length / rows);
      const maximumY = Math.floor((regionY + 1) * grid.length / rows);
      const counts = [0, 0, 0, 0, 0, 0];
      let total = 0;
      for (let y = minimumY; y < maximumY; y += 1) {
        for (let x = minimumX; x < maximumX; x += 1) {
          const tile = grid[y][x];
          total += 1;
          if (tileSurface(tile)) counts[0] += 1;
          if (tile.terrain === Terrain.Water || tile.terrain === Terrain.Ice ||
            tile.terrain === Terrain.Beach) counts[1] += 1;
          if (tile.terrain === Terrain.Difficult) counts[2] += 1;
          if (TERRAIN_RULES[tile.terrain].movement === "blocked") counts[3] += 1;
          if (tile.obstacle === Obstacle.Tree || tile.obstacle === Obstacle.Rock) counts[4] += 1;
          if (tile.obstacle === Obstacle.Building) counts[5] += 1;
        }
      }
      profile.push(...counts.map((count) => count / total));
    }
  }
  return profile;
}

function measureExteriorSpatialQuality(grid: Grid): ExteriorSpatialMetrics {
  const total = grid.length * grid[0].length;
  const walkable = grid.flatMap((row, y) => row.flatMap((tile, x) =>
    isExteriorWalkable(tile) ? [{ x, y }] : []));
  const broadWalkable = walkable.filter((point) => belongsToWalkableSquare(grid, point));

  let featureTiles = 0;
  let smallFeatureTiles = 0;
  for (const terrain of [
    Terrain.Difficult,
    Terrain.Water,
    Terrain.Ice,
    Terrain.Lava,
    Terrain.Beach,
    Terrain.Cliff,
    Terrain.Ravine,
  ]) {
    const components = exteriorComponents(grid, (tile) => tile.terrain === terrain);
    const terrainTiles = components.reduce((sum, component) => sum + component.length, 0);
    if (terrainTiles < total * .025) continue;
    featureTiles += terrainTiles;
    smallFeatureTiles += components
      .filter((component) => component.length <= 2)
      .reduce((sum, component) => sum + component.length, 0);
  }

  const routeComponents = exteriorComponents(grid, (tile) => tileSurface(tile) !== undefined);
  const routeTiles = routeComponents.reduce((sum, component) => sum + component.length, 0);
  const routeContinuity = routeTiles >= Math.min(grid.length, grid[0].length) / 2
    ? (routeComponents[0]?.length ?? 0) / routeTiles
    : undefined;

  const obstacleObjects = new Map<string, {
    kind: typeof Obstacle.Tree | typeof Obstacle.Rock;
    points: GridPoint[];
  }>();
  grid.forEach((row, y) => row.forEach((tile, x) => {
    if (tile.obstacle !== Obstacle.Tree && tile.obstacle !== Obstacle.Rock) return;
    // Count object centers so a multi-cell sprite cannot satisfy clustering by itself.
    const key = `${tile.obstacle}:${tile.obstacleId ?? `${x},${y}`}`;
    const object = obstacleObjects.get(key) ?? { kind: tile.obstacle, points: [] };
    object.points.push({ x, y });
    obstacleObjects.set(key, object);
  }));
  const obstacleCenters = [...obstacleObjects.values()].map(({ kind, points }) => ({
    kind,
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  }));
  const clusteringRadius = Math.max(3, Math.min(grid.length, grid[0].length) * .14);
  const clusteredObstacles = obstacleCenters.filter((obstacle, index) =>
    obstacleCenters.some((neighbor, neighborIndex) => neighborIndex !== index &&
      neighbor.kind === obstacle.kind &&
      Math.hypot(neighbor.x - obstacle.x, neighbor.y - obstacle.y) <= clusteringRadius));
  const obstacleRegions = new Set(obstacleCenters.map(({ x, y }) => {
    const regionX = Math.min(3, Math.floor(x * 4 / grid[0].length));
    const regionY = Math.min(2, Math.floor(y * 3 / grid.length));
    return `${regionX},${regionY}`;
  }));

  return {
    walkableBreadth: broadWalkable.length / Math.max(1, walkable.length),
    smallFeatureFragmentRatio: smallFeatureTiles / Math.max(1, featureTiles),
    routeContinuity,
    naturalObstacleClustering: obstacleCenters.length >= 8
      ? clusteredObstacles.length / obstacleCenters.length
      : undefined,
    naturalObstacleRegions: obstacleCenters.length >= 8 ? obstacleRegions.size : undefined,
    spatialProfile: exteriorSpatialProfile(grid),
  };
}

function assertExteriorSpatialQuality(grids: Grid[], label: string) {
  const metrics = grids.map(measureExteriorSpatialQuality);
  const average = (values: number[]) =>
    values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  const minimumBreadth = Math.min(...metrics.map(({ walkableBreadth }) => walkableBreadth));
  const averageBreadth = average(metrics.map(({ walkableBreadth }) => walkableBreadth));
  assert(minimumBreadth >= .18 && averageBreadth >= .45,
    `${label}: walkable space is too consistently narrow (${minimumBreadth.toFixed(2)} min, ${averageBreadth.toFixed(2)} average)`);

  const maximumFragmentation = Math.max(...metrics.map(({ smallFeatureFragmentRatio }) =>
    smallFeatureFragmentRatio));
  const averageFragmentation = average(metrics.map(({ smallFeatureFragmentRatio }) =>
    smallFeatureFragmentRatio));
  assert(maximumFragmentation <= .55 && averageFragmentation <= .2,
    `${label}: terrain features are excessively fragmented (${maximumFragmentation.toFixed(2)} max, ${averageFragmentation.toFixed(2)} average)`);

  const routeContinuities = metrics.flatMap(({ routeContinuity }) =>
    routeContinuity === undefined ? [] : [routeContinuity]);
  if (routeContinuities.length >= grids.length / 2) {
    assert(Math.min(...routeContinuities) >= .7 && average(routeContinuities) >= .9,
      `${label}: routes are too fragmented (${Math.min(...routeContinuities).toFixed(2)} min, ${average(routeContinuities).toFixed(2)} average)`);
  }

  const obstacleMetrics = metrics.filter((metric) =>
    metric.naturalObstacleClustering !== undefined && metric.naturalObstacleRegions !== undefined);
  if (obstacleMetrics.length >= grids.length / 2) {
    const clustering = obstacleMetrics.map(({ naturalObstacleClustering }) =>
      naturalObstacleClustering!);
    const regions = obstacleMetrics.map(({ naturalObstacleRegions }) => naturalObstacleRegions!);
    assert(average(clustering) >= .25,
      `${label}: natural obstacles do not form recognizable groups (${average(clustering).toFixed(2)})`);
    assert(average(regions) >= 2,
      `${label}: natural obstacles collapse into too little of the map (${average(regions).toFixed(2)} regions average)`);
  }

  // Quantized regional ratios measure structural variety while ignoring exact
  // per-tile noise that would make every seed trivially unique.
  const signatures = new Set(metrics.map(({ spatialProfile }) => spatialProfile
    .map((value) => Math.round(value * 8))
    .join(",")));
  let maximumProfileDistance = 0;
  for (let first = 0; first < metrics.length; first += 1) {
    for (let second = first + 1; second < metrics.length; second += 1) {
      const profileDistance = metrics[first].spatialProfile.reduce((sum, value, index) =>
        sum + Math.abs(value - metrics[second].spatialProfile[index]), 0) /
        metrics[first].spatialProfile.length;
      maximumProfileDistance = Math.max(maximumProfileDistance, profileDistance);
    }
  }
  assert(signatures.size >= Math.max(4, Math.ceil(grids.length * .25)) &&
    maximumProfileDistance >= .012,
  `${label}: seeds produce too little structural variety (${signatures.size} profiles, ${maximumProfileDistance.toFixed(3)} max distance)`);
}

function assertExteriorSemantics(
  grid: Grid,
  mode: string,
  requestedBuildings: number,
  label: string,
) {
  const walkableComponents = exteriorComponents(grid, (tile) =>
    tile.obstacle === Obstacle.None &&
    (tileSurface(tile) === Terrain.Bridge ||
      TERRAIN_RULES[tile.terrain].movement !== "blocked"));
  assert(walkableComponents.length === 1,
    `${label}: walkable terrain forms ${walkableComponents.length} disconnected areas`);

  if (requestedBuildings > 0) {
    const buildingIds = new Set<number>();
    for (const row of grid) {
      for (const tile of row) {
        if (tile.obstacle !== Obstacle.Building) continue;
        assert(tile.obstacleId !== undefined, `${label}: building without an object id`);
        buildingIds.add(tile.obstacleId);
      }
    }
    assert(buildingIds.size >= requestedBuildings,
      `${label}: expected at least ${requestedBuildings} buildings, got ${buildingIds.size}`);
  }

  const routeComponents = exteriorComponents(grid, (tile) => tileSurface(tile) !== undefined);
  if (mode === "city") {
    assert(routeComponents.length === 1,
      `${label}: city streets form ${routeComponents.length} disconnected networks`);
  }

  if (mode === "countryside" || mode === "desert-canyon" || mode === "frozen-lake") {
    const water = exteriorComponents(grid, (tile) => tile.terrain === Terrain.Water).flat();
    assert(water.length > 0, `${label}: missing interior water feature`);
    assert(water.every(({ x, y }) =>
      x > 0 && y > 0 && x < grid[0].length - 1 && y < grid.length - 1),
    `${label}: pond, oasis, or open water leaks off the map edge`);
  }

  if (mode === "archipelago") {
    const ocean = exteriorComponents(grid, (tile) => tile.terrain === Terrain.Water);
    assert(ocean.length === 1,
      `${label}: archipelago ocean forms ${ocean.length} disconnected basins`);
    const islands = exteriorComponents(grid, (tile) => tile.terrain !== Terrain.Water);
    assert(islands.length === 4,
      `${label}: expected four separated islands, got ${islands.length}`);
  }

  if (mode === "farmland") {
    assert(routeComponents.length === 1,
      `${label}: farm lanes form ${routeComponents.length} disconnected networks`);
    const routeEdges = exteriorEdges(grid, routeComponents[0] ?? []);
    assert(routeEdges.size >= 2,
      `${label}: farm lanes need at least two meaningful map exits`);
    const width = grid[0].length;
    const height = grid.length;
    const hasFullRoadRow = grid.some((row) =>
      row.every((tile) => tileSurface(tile) === Terrain.Road ||
        tileSurface(tile) === Terrain.Bridge));
    const hasFullRoadColumn = Array.from({ length: width }, (_, x) =>
      grid.every((row) => tileSurface(row[x]) === Terrain.Road ||
        tileSurface(row[x]) === Terrain.Bridge)).some(Boolean);
    assert(!(hasFullRoadRow && hasFullRoadColumn),
      `${label}: farm lanes fall back to a perfect map-wide cross`);
    const significantFields = exteriorComponents(grid, (tile) =>
      tileSurface(tile) === undefined && tile.terrain !== Terrain.Water)
      .filter((component) => component.length >= grid.length * width * .03);
    assert(significantFields.length >= 3,
      `${label}: farm layout has only ${significantFields.length} meaningful fields`);
    const crops = grid.flat().filter((tile) => tile.terrain === Terrain.Difficult).length;
    assert(crops >= grid.length * width * .05,
      `${label}: farmland has too little cultivated ground`);
    const drainage = exteriorComponents(grid, (tile) => tile.terrain === Terrain.Water);
    assert(drainage.length === 1,
      `${label}: farm drainage must form one continuous ditch`);
    assert(drainage[0].length >= Math.min(width, height),
      `${label}: farm drainage ditch is too short to serve the fields`);
    assert(touchesOppositeEdges(exteriorEdges(grid, drainage[0])),
      `${label}: farm drainage ditch must discharge across the map`);
    assert(grid.flat().some((tile) => tileSurface(tile) === Terrain.Bridge),
      `${label}: farm lane needs a culvert across its drainage ditch`);
  }

  if (mode === "coast") {
    const sea = exteriorComponents(grid, (tile) => tile.terrain === Terrain.Water);
    assert(sea.length === 1,
      `${label}: coastline contains ${sea.length} disconnected seas`);
  }

  if (mode === "sewer") {
    const water = exteriorComponents(grid, (tile) => tile.terrain === Terrain.Water);
    assert(water.length === 1, `${label}: sewer channel is not continuous`);
    const waterEdges = exteriorEdges(grid, water[0]);
    assert(waterEdges.size === 2 && touchesOppositeEdges(waterEdges),
      `${label}: sewer channel must cross between one pair of opposite edges`);
    const open = exteriorComponents(grid, (tile) =>
      TERRAIN_RULES[tile.terrain].movement !== "blocked");
    assert(open.length === 1 && exteriorEdges(grid, open[0]).size === 4,
      `${label}: sewer tunnels must form one four-way network`);
    const total = grid.length * grid[0].length;
    const cliffCount = grid.flat().filter((tile) => tile.terrain === Terrain.Cliff).length;
    assert(cliffCount >= total * .35 && cliffCount <= total * .8,
      `${label}: sewer wall coverage ${cliffCount}/${total} is degenerate`);
    const floorByQuadrant = [0, 0, 0, 0];
    grid.forEach((row, y) => row.forEach((tile, x) => {
      if (tile.terrain !== Terrain.Ground && tile.terrain !== Terrain.Difficult) return;
      const quadrant = (x >= grid[0].length / 2 ? 1 : 0) +
        (y >= grid.length / 2 ? 2 : 0);
      floorByQuadrant[quadrant] += 1;
    }));
    assert(floorByQuadrant.every((count) => count >= total * .04),
      `${label}: sewer chambers do not occupy every quadrant`);
    const openTile = (tile: Grid[number][number]) =>
      TERRAIN_RULES[tile.terrain].movement !== "blocked";
    const fullOpenRows = grid.filter((row) => row.every(openTile)).length;
    const fullOpenColumns = Array.from({ length: grid[0].length }, (_, x) =>
      grid.every((row) => openTile(row[x]))).filter(Boolean).length;
    assert(fullOpenRows === 0 || fullOpenColumns === 0,
      `${label}: sewer is still a perfect ${fullOpenRows}x${fullOpenColumns} cross`);
  }
}

function assertCompactVesselFurniture(
  grid: Grid,
  mode: "ship" | "spaceship",
  label: string,
) {
  const rooms = new Map<number, {
    role: string;
    cells: GridPoint[];
  }>();
  grid.forEach((row, y) => row.forEach((tile, x) => {
    if (tile.terrain !== Terrain.Ground || tile.roomId === undefined || tile.roomId === 0) return;
    const room = rooms.get(tile.roomId) ?? {
      role: tile.roomRole ?? "",
      cells: [],
    };
    room.cells.push({ x, y });
    rooms.set(tile.roomId, room);
  }));
  const expectedProp = (role: string) => {
    if (mode === "ship") {
      if (/Galley/i.test(role)) return "hearth";
      if (/Captain|berths|Sick bay|Guest cabin/i.test(role)) return "bed";
      if (/Cargo hold|store|Magazine|Provision hold/i.test(role)) return "crate";
      if (/Chart room|Workshop/i.test(role)) return "table";
    } else {
      if (/Crew quarters|Medbay/i.test(role)) return "bed";
      if (/Cargo bay|Armory/i.test(role)) return "crate";
      if (/Cockpit|Engineering|Laboratory|Life support|Observation|Utility|Escape pods/i.test(role)) {
        return "console";
      }
    }
    return undefined;
  };
  for (const room of rooms.values()) {
    assert(room.cells.length >= 6,
      `${label}: ${room.role} is only ${room.cells.length} cells`);
    const required = expectedProp(room.role);
    if (!required) continue;
    assert(room.cells.some(({ x, y }) => grid[y][x].interiorProp === required),
      `${label}: ${room.role} needs a ${required}`);
  }
}

let generated = 0;
for (const preset of PRESETS) {
  for (let index = 0; index < 3; index += 1) {
    const options = { ...preset, seed: `audit-${index}` };
    const grid = generateTerrain(options);
    assertGrid(grid, `${preset.id}:${index}`);
    if (isInteriorMode(preset.mode)) {
      assertInterior(grid, preset.buildingCount, `${preset.id}:${index}`,
        preset.mode === "ship-deck" ? 1 : preset.buildingCount);
      if (preset.mode === "ship-deck") assertShipDeck(grid, `${preset.id}:${index}`);
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

const exteriorSemanticPresets = PRESETS.filter(({ mode }) => !isInteriorMode(mode));
for (const preset of exteriorSemanticPresets) {
  const spatialQualitySamples: Grid[] = [];
  for (let index = 0; index < 32; index += 1) {
    const label = `${preset.id}:exterior-semantics:${index}`;
    const grid = generateTerrain({ ...preset, seed: label });
    assertGrid(grid, label);
    assertExteriorSemantics(grid, preset.mode, preset.buildingCount, label);
    spatialQualitySamples.push(grid);
    generated += 1;
  }
  assertExteriorSpatialQuality(spatialQualitySamples, preset.id);
}

for (const mode of [
  "countryside",
  "river",
  "coast",
  "desert-canyon",
  "ancient-forest",
  "frozen-lake",
  "wetlands",
  "volcanic",
] as const) {
  const preset = PRESETS.find((candidate) => candidate.mode === mode);
  assert(preset, `missing ${mode} preset`);
  const grid = generateTerrain({
    ...preset,
    waterWeight: 0,
    seed: `${mode}:zero-water-weight`,
  });
  const forbidden: ReadonlySet<TerrainKind> = mode === "volcanic"
    ? new Set([Terrain.Lava])
    : mode === "frozen-lake"
      ? new Set([Terrain.Water, Terrain.Ice])
      : mode === "coast"
        ? new Set([Terrain.Water, Terrain.Beach])
        : new Set([Terrain.Water]);
  assert(
    grid.flat().every((tile) => !forbidden.has(tile.terrain)),
    `${mode}: waterWeight=0 still creates a liquid or shoreline feature`,
  );
  generated += 1;
}

for (const mode of [
  "desert-canyon",
  "badlands",
  "mountain-pass",
  "highlands",
  "volcanic",
] as const) {
  const preset = PRESETS.find((candidate) => candidate.mode === mode);
  assert(preset, `missing ${mode} preset`);
  const grid = generateTerrain({
    ...preset,
    reliefWeight: 0,
    seed: `${mode}:zero-relief-weight`,
  });
  assert(
    grid.flat().every((tile) =>
      tile.terrain !== Terrain.Cliff && tile.terrain !== Terrain.Ravine
    ),
    `${mode}: reliefWeight=0 still creates cliffs or ravines`,
  );
  generated += 1;
}

const compactExteriorRegressionSeeds: Partial<Record<LandscapeMode, string>> = {
  archipelago: "arch-audit:16x12:0",
  "frozen-lake": "water-compact:frozen-lake:66",
  "ancient-ruins": "stress:ancient-ruins:16x12:0",
  city: "stress:city:16x12:0",
};
for (const preset of PRESETS.filter(({ mode }) =>
  mode === "archipelago" || mode === "frozen-lake" ||
  mode === "ancient-ruins" || mode === "city"
)) {
  for (let index = 0; index < 32; index += 1) {
    const label = `${preset.id}:compact-exterior:${index}`;
    const seed = index === 0
      ? compactExteriorRegressionSeeds[preset.mode] ?? label
      : label;
    const grid = generateTerrain({
      ...preset,
      width: 16,
      height: 12,
      seed,
    });
    assertGrid(grid, label);
    assertExteriorSemantics(grid, preset.mode, preset.buildingCount, label);
    generated += 1;
  }
}

for (const [mode, seeds] of [
  ["archipelago", [
    "arch-audit:16x12:258",
    "arch-audit:16x12:285",
    "arch-audit:16x12:290",
  ]],
  ["city", [
    "stress:city:16x12:19",
    "stress:city:16x12:91",
    "stress:city:16x12:97",
    "stress:city:16x12:109",
  ]],
] as const) {
  const preset = PRESETS.find((candidate) => candidate.mode === mode);
  assert(preset, `missing ${mode} preset`);
  for (const seed of seeds) {
    const label = `${mode}:compact-regression:${seed.split(":").at(-1)}`;
    const grid = generateTerrain({ ...preset, width: 16, height: 12, seed });
    assertGrid(grid, label);
    assertExteriorSemantics(grid, mode, preset.buildingCount, label);
    generated += 1;
  }
}

for (const [mode, seeds] of [
  ["coast", ["coherence:coast:12"]],
  ["farmland", ["coherence:farmland:0"]],
  ["sewer", ["coherence:sewer:0"]],
] as const) {
  const preset = PRESETS.find((candidate) => candidate.mode === mode);
  assert(preset, `missing ${mode} preset`);
  for (const seed of seeds) {
    const label = `${mode}:realism-regression:${seed.split(":").at(-1)}`;
    const grid = generateTerrain({ ...preset, seed });
    assertGrid(grid, label);
    assertExteriorSemantics(grid, mode, preset.buildingCount, label);
    generated += 1;
  }
}

for (const preset of PRESETS.filter(({ mode }) => isInteriorMode(mode))) {
  if (!isInteriorMode(preset.mode)) continue;
  const grid = generateTerrain({ ...preset, seed: `${preset.id}-semantics` });
  assertRoleFurnitureRealism(grid, preset.mode, `${preset.id}:semantics`);
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
      `${tile.terrain}:${tile.roomId ?? ""}:${tile.deckFeature ?? ""}:` +
      `${tile.elevation ?? ""}:${tile.deckFeatureFacing ?? ""}`
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

const shipDeckPreset = PRESETS.find(({ mode }) => mode === "ship-deck");
assert(shipDeckPreset, "missing ship-deck preset");
const shipDeckDimensions = [
  { name: "default", width: shipDeckPreset.width, height: shipDeckPreset.height },
  {
    name: "compact",
    width: INTERIOR_MINIMUM_DIMENSIONS["ship-deck"].width,
    height: INTERIOR_MINIMUM_DIMENSIONS["ship-deck"].height,
  },
];
for (const dimensions of shipDeckDimensions) {
  for (
    let areaCount = INTERIOR_ROOM_LIMITS["ship-deck"].minimum;
    areaCount <= INTERIOR_ROOM_LIMITS["ship-deck"].maximum;
    areaCount += 1
  ) {
    for (let index = 0; index < 3; index += 1) {
      const label = `ship-deck:${dimensions.name}:${areaCount}-areas:${index}`;
      const grid = generateTerrain({
        ...shipDeckPreset,
        width: dimensions.width,
        height: dimensions.height,
        buildingCount: areaCount,
        seed: label,
      });
      assertGrid(grid, label);
      assertInterior(grid, areaCount, label, 1);
      assertShipDeck(grid, label);
      generated += 1;
    }
  }
}

for (const mode of ["ship", "spaceship"] as const) {
  const preset = PRESETS.find((candidate) => candidate.mode === mode);
  assert(preset, `missing ${mode} preset`);
  for (
    let roomCount = INTERIOR_ROOM_LIMITS[mode].minimum;
    roomCount <= INTERIOR_ROOM_LIMITS[mode].maximum;
    roomCount += 1
  ) {
    for (let index = 0; index < 3; index += 1) {
      const label = `${mode}:compact-functional:${roomCount}-rooms:${index}`;
      const grid = generateTerrain({
        ...preset,
        width: INTERIOR_MINIMUM_DIMENSIONS[mode].width,
        height: INTERIOR_MINIMUM_DIMENSIONS[mode].height,
        buildingCount: roomCount,
        seed: label,
      });
      assertGrid(grid, label);
      assertInterior(grid, roomCount, label);
      assertCompactVesselFurniture(grid, mode, label);
      assertRoleFurnitureRealism(grid, mode, label);
      generated += 1;
    }
  }
}

for (const mode of ["ship", "spaceship"] as const) {
  const preset = PRESETS.find((candidate) => candidate.mode === mode)!;
  const roomCount = INTERIOR_ROOM_LIMITS[mode].maximum;
  for (let index = 0; index < 32; index += 1) {
    const label = `${mode}:default-role-realism:${index}`;
    const grid = generateTerrain({
      ...preset,
      buildingCount: roomCount,
      seed: label,
    });
    assertInterior(grid, roomCount, label);
    assertRoleFurnitureRealism(grid, mode, label);
    generated += 1;
  }
}

for (const mode of ["castle", "crypt"] as const) {
  const preset = PRESETS.find((candidate) => candidate.mode === mode)!;
  const roomCounts = mode === "castle"
    ? [INTERIOR_ROOM_LIMITS.castle.maximum]
    : [INTERIOR_ROOM_LIMITS.crypt.minimum, preset.buildingCount];
  for (const roomCount of roomCounts) {
    for (let index = 0; index < 32; index += 1) {
      const label = `${mode}:role-realism:${roomCount}-rooms:${index}`;
      const grid = generateTerrain({
        ...preset,
        buildingCount: roomCount,
        seed: label,
      });
      assertInterior(grid, roomCount, label);
      assertRoleFurnitureRealism(grid, mode, label);
      generated += 1;
    }
  }
}

for (const mode of ["house", "tavern"] as const) {
  const preset = PRESETS.find((candidate) => candidate.mode === mode);
  assert(preset, `missing ${mode} preset`);
  const roomCounts = [...new Set([
    INTERIOR_ROOM_LIMITS[mode].minimum,
    preset.buildingCount,
    INTERIOR_ROOM_LIMITS[mode].maximum,
  ])];
  for (const roomCount of roomCounts) {
    for (let index = 0; index < 8; index += 1) {
      const label = `${mode}:compact-furniture:${roomCount}-rooms:${index}`;
      const grid = generateTerrain({
        ...preset,
        width: INTERIOR_MINIMUM_DIMENSIONS[mode].width,
        height: INTERIOR_MINIMUM_DIMENSIONS[mode].height,
        buildingCount: roomCount,
        seed: label,
      });
      assertGrid(grid, label);
      assertInterior(grid, roomCount, label);
      assertHouseTavernFurniture(grid, mode, label);
      generated += 1;
    }
  }
}

for (const seed of [
  "final-live-audit:house:compact-r7:1",
  "final-live-audit:house:compact-r7:15",
  "final-live-audit:house:compact-r7:24",
  "tiny-house-audit:r7:5",
]) {
  const label = `house:compact-regression:${seed.split(":").at(-1)}`;
  const grid = generateTerrain({
    ...housePreset,
    width: INTERIOR_MINIMUM_DIMENSIONS.house.width,
    height: INTERIOR_MINIMUM_DIMENSIONS.house.height,
    buildingCount: INTERIOR_ROOM_LIMITS.house.maximum,
    seed,
  });
  assertGrid(grid, label);
  assertInterior(grid, INTERIOR_ROOM_LIMITS.house.maximum, label);
  assertHouseTavernFurniture(grid, "house", label);
  generated += 1;
}

for (const mode of ["house", "tavern", "cathedral", "crypt"] as const) {
  const preset = PRESETS.find((candidate) => candidate.mode === mode)!;
  for (let index = 0; index < 32; index += 1) {
    const grid = generateTerrain({ ...preset, seed: `${mode}-furniture-audit-${index}` });
    generated += 1;
    assertInterior(grid, preset.buildingCount, `${mode}:furniture-audit-${index}`);
    assertRoleFurnitureRealism(grid, mode, `${mode}:furniture-audit-${index}`);
    if (mode === "house" || mode === "tavern") {
      assertHouseTavernFurniture(grid, mode, `${mode}:furniture-audit-${index}`);
    }
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
        if (bed.length === 4) {
          const xs = new Set(bed.map(({ x }) => x));
          const ys = new Set(bed.map(({ y }) => y));
          assert(xs.size === 2 && ys.size === 2,
            `${mode}:${index}: double bed must use a 2x2 footprint`);
          continue;
        }
        assert(bed.length === 2,
          `${mode}:${index}: guest bed must use a 1x2 or 2x2 footprint`);
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
      const bonesRoomIds = new Set(grid.flatMap((row) => row.filter((tile) =>
        tile.interiorProp === "bones").map((tile) => tile.roomId)));
      assert([...burialRoomIds].every((roomId) => bonesRoomIds.has(roomId)),
        `${mode}:${index}: every burial vault needs bones on the floor`);
      const wallChains = grid.flatMap((row) => row.filter((tile) =>
        tile.interiorProp === "wall_chain"));
      assert(wallChains.length >= 1,
        `${mode}:${index}: crypt needs at least one wall chain`);
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
    preset.mode === "ship-deck" ? 1 : maximumRooms);
  if (preset.mode === "house" || preset.mode === "tavern") {
    assertHouseTavernFurniture(compactGrid, preset.mode, `${preset.id}:compact-interior`);
  }
  if (preset.mode === "ship-deck") {
    assertShipDeck(compactGrid, `${preset.id}:compact-interior`);
  }
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
    width?: number;
    height?: number;
    shapeType?: string;
    position?: { x: number; y: number };
    endPosition?: { x: number; y: number };
    commands?: unknown[];
    fillRule?: string;
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
const wallFogItems = fogItems.filter(({ name, type, metadata }) =>
  name.startsWith("Wall Fog") &&
  type === "LINE" &&
  !Array.isArray(metadata?.["rodeo.owlbear.dynamic-fog/doors"])
);
const doorFogItems = fogItems.filter(({ type, metadata }) =>
  type === "LINE" && Array.isArray(
    metadata?.["rodeo.owlbear.dynamic-fog/doors"],
  )
);
assert(
  roomFogItems.length === 0,
  "house fog export: room outlines must not be exported as fog curves",
);
assert(
  wallFogItems.length > doorFogItems.length,
  "house fog export: expected wall line segments instead of room outlines",
);
assert(
  wallFogItems.every((item) =>
    item.position && item.endPosition &&
    (item.endPosition.x !== 0 || item.endPosition.y !== 0)
  ),
  "house fog export: wall fog must use non-empty line segments",
);
assert(
  doorFogItems.length === housePreset.buildingCount,
  `house fog export: expected ${housePreset.buildingCount} doors`,
);
const lightMetadataKey = "rodeo.owlbear.dynamic-fog/light";
const interiorPropMetadataKey = "com.touchgrass/interior-prop";
const expectedInteriorPropIds = new Set(fogExportGrid.flatMap((row) =>
  row.flatMap((tile) => tile.interiorPropId === undefined ? [] : [tile.interiorPropId])));
const exportedInteriorProps = fogItems.filter(({ metadata }) =>
  metadata?.[interiorPropMetadataKey] !== undefined
);
assert(
  exportedInteriorProps.length === expectedInteriorPropIds.size,
  `house fog export: expected ${expectedInteriorPropIds.size} interior prop drawings`,
);
for (const item of exportedInteriorProps) {
  assert(
    (item.type === "SHAPE" || item.type === "PATH") &&
      item.layer === "PROP" &&
      !item.locked,
    `house fog export: ${item.name} must be a movable prop drawing`,
  );
  const propMetadata = item.metadata?.[interiorPropMetadataKey] as {
    footprint?: Array<{ x: number; y: number }>;
  };
  assert(propMetadata.footprint?.length,
    `house fog export: ${item.name} has no source footprint`);
  assert(item.position,
    `house fog export: ${item.name} has no drawing bounds`);
  const minimumX = Math.min(...propMetadata.footprint.map(({ x }) => x));
  const maximumX = Math.max(...propMetadata.footprint.map(({ x }) => x));
  const minimumY = Math.min(...propMetadata.footprint.map(({ y }) => y));
  const maximumY = Math.max(...propMetadata.footprint.map(({ y }) => y));
  const expectedCenterX = (minimumX + (maximumX - minimumX + 1) / 2) * 150;
  const expectedCenterY = (minimumY + (maximumY - minimumY + 1) / 2) * 150;
  const circle = item.type === "SHAPE" && item.shapeType === "CIRCLE";
  const actualCenterX = item.type === "SHAPE" && !circle
    ? item.position.x + (item.width ?? 0) / 2
    : item.position.x;
  const actualCenterY = item.type === "SHAPE" && !circle
    ? item.position.y + (item.height ?? 0) / 2
    : item.position.y;
  assert(
    Math.abs(actualCenterX - expectedCenterX) < .001 &&
      Math.abs(actualCenterY - expectedCenterY) < .001,
    `house fog export: ${item.name} is not centered on its grid footprint`,
  );
  if (item.type === "SHAPE") {
    assert(
      typeof item.width === "number" && item.width > 0 &&
        typeof item.height === "number" && item.height > 0,
      `house fog export: ${item.name} has an invalid drawing footprint`,
    );
    assert(
      item.shapeType === "RECTANGLE" || item.shapeType === "CIRCLE",
      `house fog export: ${item.name} has an invalid drawing shape`,
    );
    const drawingLeft = item.position.x - (circle ? item.width / 2 : 0);
    const drawingTop = item.position.y - (circle ? item.height / 2 : 0);
    assert(
      drawingLeft >= minimumX * 150 &&
        drawingTop >= minimumY * 150 &&
        drawingLeft + item.width <= (maximumX + 1) * 150 &&
        drawingTop + item.height <= (maximumY + 1) * 150,
      `house fog export: ${item.name} extends outside its grid footprint`,
    );
  } else {
    assert(item.commands?.length,
      `house fog export: ${item.name} has no path commands`);
    assert(typeof item.fillRule === "string" && item.fillRule.length > 0,
      `house fog export: ${item.name} has no path fill rule`);
  }
}
const exportedLightItems = fogItems.filter(({ metadata }) =>
  metadata?.[lightMetadataKey] !== undefined
);
const expectedLightSources = collectMapLightSources(fogExportGrid);
assert(
  exportedLightItems.length === expectedLightSources.length,
  `house fog export: expected ${expectedLightSources.length} light sources`,
);
assert(exportedLightItems.length > 0, "house fog export: expected at least one light source");
for (const item of exportedLightItems) {
  assert(item.layer === "PROP",
    `house fog export: ${item.name} light must stay on the prop layer`);
  if (item.metadata?.[interiorPropMetadataKey] !== undefined) {
    assert(item.type === "SHAPE" || item.type === "PATH",
      `house fog export: ${item.name} must carry light on its prop drawing`);
  } else {
    assert(item.type === "IMAGE",
      `house fog export: ${item.name} terrain light must use an image marker`);
  }
  const light = item.metadata?.[lightMetadataKey] as {
    attenuationRadius?: number;
    sourceRadius?: number;
    falloff?: number;
    lightType?: string;
  };
  assert(
    typeof light.attenuationRadius === "number" &&
      typeof light.sourceRadius === "number" &&
      light.attenuationRadius > light.sourceRadius,
    `house fog export: ${item.name} has invalid light radii`,
  );
  assert(
    typeof light.falloff === "number" && light.falloff >= 0 && light.falloff <= 1,
    `house fog export: ${item.name} has invalid falloff`,
  );
  assert(light.lightType === "SECONDARY",
    `house fog export: ${item.name} must be a secondary light`);
}

const noFogExport = await createOwlbearSceneJson(
  fogExportGrid,
  "house-without-fog-export",
  new Set(),
  {
    dynamicFog: false,
    mapImage: {
      url: "https://example.com/house.webp",
      mime: "image/webp",
      width: fogExportGrid[0].length * 48,
      height: fogExportGrid.length * 48,
    },
  },
);
const noFogItems = Object.values((JSON.parse(noFogExport.json) as {
  items: { shared: Record<string, {
    type: string;
    layer: string;
    metadata?: Record<string, unknown>;
  }> };
}).items.shared);
assert(
  noFogItems.every((item) => item.metadata?.[lightMetadataKey] === undefined),
  "house export: lights must only be included with dynamic fog",
);
assert(
  noFogItems.filter((item) => item.metadata?.[interiorPropMetadataKey] !== undefined)
    .length === expectedInteriorPropIds.size,
  "house export: interior prop drawings must exist without dynamic fog",
);

const doorSplitGrid: Grid = Array.from({ length: 5 }, () =>
  Array.from({ length: 5 }, () => ({ terrain: Terrain.Void, obstacle: Obstacle.None })));
for (const x of [0, 1, 3, 4]) {
  doorSplitGrid[2][x] = { terrain: Terrain.Wall, obstacle: Obstacle.None };
}
doorSplitGrid[2][2] = {
  terrain: Terrain.Door,
  obstacle: Obstacle.None,
  doorOrientation: "horizontal",
};
const doorSplitExport = await createOwlbearSceneJson(
  doorSplitGrid,
  "door-split-fog-export",
  new Set(),
  {
    dynamicFog: true,
    mapImage: {
      url: "https://example.com/door-split.webp",
      mime: "image/webp",
      width: doorSplitGrid[0].length * 48,
      height: doorSplitGrid.length * 48,
    },
  },
);
const doorSplitItems = Object.values((JSON.parse(doorSplitExport.json) as {
  items: { shared: Record<string, {
    name: string;
    type: string;
    layer: string;
    position?: { x: number; y: number };
    endPosition?: { x: number; y: number };
    points?: Array<{ x: number; y: number }>;
    metadata?: Record<string, unknown>;
  }> };
}).items.shared);
const doorSplitWallItems = doorSplitItems.filter((item) =>
  item.name.startsWith("Wall Fog") &&
  item.type === "LINE" &&
  !Array.isArray(item.metadata?.["rodeo.owlbear.dynamic-fog/doors"])
);
const doorSplitDoorItems = doorSplitItems.filter((item) =>
  item.type === "LINE" && Array.isArray(
    item.metadata?.["rodeo.owlbear.dynamic-fog/doors"],
  )
);
assert(
  doorSplitWallItems.length === 2,
  `door split fog export: expected two wall segments, got ${doorSplitWallItems.length}`,
);
assert(
  doorSplitDoorItems.length === 1,
  `door split fog export: expected one door segment, got ${doorSplitDoorItems.length}`,
);
assert(
  doorSplitWallItems.every((item) => item.position && item.endPosition),
  "door split fog export: wall segments must be line items",
);
const wallSpans = doorSplitWallItems.map((item) => {
  const startX = item.position?.x ?? 0;
  const endX = startX + (item.endPosition?.x ?? 0);
  return { minimumX: Math.min(startX, endX), maximumX: Math.max(startX, endX) };
});
assert(
  wallSpans.some(({ minimumX, maximumX }) =>
    minimumX === .5 * 150 && maximumX === 2 * 150) &&
    wallSpans.some(({ minimumX, maximumX }) =>
      minimumX === 3 * 150 && maximumX === 4.5 * 150),
  "door split fog export: wall lines must follow visual endpoints around the door",
);
const [doorSplitDoor] = doorSplitDoorItems;
assert(
  doorSplitDoor.position?.x === 2 * 150 &&
    doorSplitDoor.position.y === 2.5 * 150 &&
    doorSplitDoor.endPosition?.x === 150 &&
    doorSplitDoor.endPosition.y === 0,
  "door split fog export: door must occupy the gap between wall segments",
);

const wallJunctionGrid: Grid = Array.from({ length: 5 }, () =>
  Array.from({ length: 5 }, () => ({ terrain: Terrain.Void, obstacle: Obstacle.None })));
for (const [x, y] of [[2, 0], [2, 1], [1, 2], [2, 2], [3, 2]] as const) {
  wallJunctionGrid[y][x] = { terrain: Terrain.Wall, obstacle: Obstacle.None };
}
const wallJunctionExport = await createOwlbearSceneJson(
  wallJunctionGrid,
  "wall-junction-fog-export",
  new Set(),
  {
    dynamicFog: true,
    mapImage: {
      url: "https://example.com/wall-junction.webp",
      mime: "image/webp",
      width: wallJunctionGrid[0].length * 48,
      height: wallJunctionGrid.length * 48,
    },
  },
);
const wallJunctionItems = Object.values((JSON.parse(wallJunctionExport.json) as {
  items: { shared: Record<string, {
    name: string;
    type: string;
    position?: { x: number; y: number };
    endPosition?: { x: number; y: number };
    metadata?: Record<string, unknown>;
  }> };
}).items.shared);
const wallJunctionSegments = wallJunctionItems.filter((item) =>
  item.name.startsWith("Wall Fog") &&
  item.type === "LINE" &&
  !Array.isArray(item.metadata?.["rodeo.owlbear.dynamic-fog/doors"])
);
const wallJunctionVerticals = wallJunctionSegments.filter((item) =>
  item.endPosition?.x === 0 && item.endPosition.y !== 0
);
assert(
  wallJunctionVerticals.length === 1,
  `wall junction fog export: expected one vertical wall segment, got ${wallJunctionVerticals.length}`,
);
const [wallJunctionVertical] = wallJunctionVerticals;
assert(
  wallJunctionVertical.position &&
    wallJunctionVertical.endPosition &&
    wallJunctionVertical.position.y + wallJunctionVertical.endPosition.y === 2.5 * 150,
  "wall junction fog export: vertical wall must stop on the horizontal wall axis",
);

const spriteGrid: Grid = Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => ({
  terrain: Terrain.Ground,
  obstacle: Obstacle.None,
})));
for (const [x, y] of [[0, 0], [0, 1]] as const) {
  Object.assign(spriteGrid[y][x], {
    interiorProp: "bed", interiorPropId: 1,
    propOrientation: "vertical", propFacing: "north",
  });
}
for (const [x, y] of [[2, 0], [3, 0], [2, 1], [3, 1]] as const) {
  Object.assign(spriteGrid[y][x], {
    interiorProp: "bed", interiorPropId: 2,
    propOrientation: "vertical", propFacing: "north",
  });
}
for (const [x, y] of [[0, 2], [1, 2]] as const) {
  Object.assign(spriteGrid[y][x], {
    interiorProp: "crate", interiorPropId: 3,
    propOrientation: "horizontal",
  });
}
Object.assign(spriteGrid[2][2], {
  interiorProp: "chair", interiorPropId: 4,
  propOrientation: "horizontal", propFacing: "north",
});
for (const [x, y] of [[0, 3], [1, 3]] as const) {
  Object.assign(spriteGrid[y][x], {
    interiorProp: "bed", interiorPropId: 5,
    propOrientation: "horizontal", propFacing: "east",
  });
}
for (const [x, y] of [[2, 4], [2, 5]] as const) {
  Object.assign(spriteGrid[y][x], {
    interiorProp: "bed", interiorPropId: 6,
    propOrientation: "vertical", propFacing: "south",
  });
}
for (const [x, y] of [[4, 4], [5, 4], [4, 5], [5, 5]] as const) {
  Object.assign(spriteGrid[y][x], {
    interiorProp: "bed", interiorPropId: 7,
    propOrientation: "vertical", propFacing: "south",
  });
}
const spriteExport = await createOwlbearSceneJson(spriteGrid, "interior-sprite-export", new Set(), {
  mode: "spaceship",
  useTileset: true,
  mapImage: {
    url: "https://example.com/interior-sprites.webp",
    mime: "image/webp",
    width: spriteGrid[0].length * 48,
    height: spriteGrid.length * 48,
  },
});
const spriteItems = Object.values((JSON.parse(spriteExport.json) as {
  items: { shared: Record<string, {
    type: string;
    zIndex?: number;
    rotation?: number;
    scale?: { x?: number; y?: number };
    image?: { url?: string };
    metadata?: Record<string, unknown>;
  }> };
}).items.shared).filter((item) => item.metadata?.[interiorPropMetadataKey] !== undefined);
assert(spriteItems.length === 8 && spriteItems.every(({ type }) => type === "IMAGE"),
  "interior tileset export: beds, crates and stools must be movable image props");
assert(spriteItems.filter(({ image }) => image?.url?.includes("/lpc/bed_")).length === 5 &&
  spriteItems.filter(({ image }) => image?.url?.includes("/blue_")).length === 5 &&
  spriteItems.filter(({ image }) => image?.url?.endsWith("_north.png")).length === 2 &&
  spriteItems.filter(({ image }) => image?.url?.endsWith("_south.png")).length === 2 &&
  spriteItems.some(({ image }) => image?.url?.endsWith("_east.png")) &&
  spriteItems.filter(({ image }) => image?.url?.endsWith("/lpc/crate_4_1x1.png")).length === 2 &&
  spriteItems.some(({ image }) => image?.url?.endsWith("/lpc/stool_1x1.png")),
"interior tileset export: expected sprite assets are missing");
const eastFacingBed = spriteItems.find(({ image }) => image?.url?.endsWith("_east.png"));
assert(eastFacingBed?.rotation === 0 && (eastFacingBed.scale?.x ?? 0) > 0,
  "interior tileset export: east-facing bed must use its dedicated unmirrored sprite");
const southFacingBeds = spriteItems.filter(({ image }) => image?.url?.includes("_south.png"));
assert(southFacingBeds.length === 2 && southFacingBeds.every(({ rotation, scale }) =>
  rotation === 0 && (scale?.x ?? 0) > 0),
"interior tileset export: south-facing beds must use dedicated unrotated sprites");
const spriteDepths = spriteItems.map((item) => {
  const metadata = item.metadata?.[interiorPropMetadataKey] as {
    footprint?: Array<{ x: number; y: number }>;
  } | undefined;
  return {
    bottomY: Math.max(...(metadata?.footprint ?? []).map(({ y }) => y + 1)),
    zIndex: item.zIndex ?? 0,
  };
});
for (const foreground of spriteDepths) {
  for (const background of spriteDepths) {
    if (foreground.bottomY <= background.bottomY) continue;
    assert(foreground.zIndex > background.zIndex,
      "interior tileset export: lower sprites must render above higher sprites");
  }
}

const assetRoutingGrid: Grid = Array.from({ length: 4 }, () =>
  Array.from({ length: 12 }, () => ({ terrain: Terrain.Ground, obstacle: Obstacle.None })));
for (const [id, kind, x] of [
  [1, "table", 0], [2, "barrel", 1], [3, "bucket", 2], [4, "shelf", 3],
  [5, "drawers", 4], [6, "statue", 5], [7, "flower_pot", 6],
] as const) {
  Object.assign(assetRoutingGrid[0][x], {
    interiorProp: kind, interiorPropId: id, propOrientation: "horizontal",
  });
}
for (const [x, y] of [[8, 0], [9, 0], [8, 1], [9, 1]] as const) {
  Object.assign(assetRoutingGrid[y][x], {
    interiorProp: "table", interiorPropId: 8, propOrientation: "horizontal",
  });
}
for (const x of [0, 1, 2]) {
  Object.assign(assetRoutingGrid[3][x], {
    interiorProp: "altar", interiorPropId: 9, propOrientation: "horizontal",
  });
}
for (const x of [4, 5]) {
  Object.assign(assetRoutingGrid[3][x], {
    interiorProp: "altar", interiorPropId: 10, propOrientation: "horizontal",
  });
}
const assetRoutingExport = await createOwlbearSceneJson(
  assetRoutingGrid,
  "interior-asset-routing-export",
  new Set(),
  {
    useTileset: true,
    mapImage: {
      url: "https://example.com/interior-asset-routing.webp",
      mime: "image/webp",
      width: assetRoutingGrid[0].length * 48,
      height: assetRoutingGrid.length * 48,
    },
  },
);
const assetRoutingItems = Object.values((JSON.parse(assetRoutingExport.json) as {
  items: { shared: Record<string, {
    image?: { url?: string; width?: number; height?: number };
    metadata?: Record<string, unknown>;
  }> };
}).items.shared).filter((item) => item.metadata?.[interiorPropMetadataKey] !== undefined);
const assetRoutingUrls = assetRoutingItems.map(({ image }) => image?.url ?? "");
for (const path of [
  "/lpc/table_1x1.png", "/lpc/barrel_1x1.png", "/lpc/bucket_2_1x1.png",
  "/lpc/shelf_5_1x1.png", "/bailey/drawer_3_1x1.png", "/lpc/statue_7_1x1.png",
  "/bailey/flower_pot_2_1x1.png", "/bailey/table_2x2.png", "/lpc/altar_3x1.png",
  "/lpc/altar_2x1.png",
]) {
  assert(assetRoutingUrls.some((url) => url.endsWith(path)),
    `interior tileset export: incorrect asset routing for ${path}`);
}
const statueSprite = assetRoutingItems.find(({ image }) =>
  image?.url?.endsWith("/lpc/statue_7_1x1.png"));
assert(statueSprite?.image?.width === 32 && statueSprite.image.height === 64,
  "interior tileset export: statue sprite must retain its two-cell height");

const hearthSpriteGrid: Grid = Array.from({ length: 6 }, () =>
  Array.from({ length: 6 }, () => ({ terrain: Terrain.Ground, obstacle: Obstacle.None })));
for (const [id, orientation, points] of [
  [1, "horizontal", [[0, 0], [1, 0]]],
  [2, "vertical", [[3, 0], [3, 1]]],
  [3, "horizontal", [[0, 3], [1, 3], [2, 3]]],
  [4, "vertical", [[5, 3], [5, 4], [5, 5]]],
] as const) {
  for (const [x, y] of points) {
    Object.assign(hearthSpriteGrid[y][x], {
      interiorProp: "hearth", interiorPropId: id, propOrientation: orientation,
    });
  }
}
const hearthSpriteExport = await createOwlbearSceneJson(
  hearthSpriteGrid,
  "hearth-sprite-export",
  new Set(),
  {
    useTileset: true,
    mapImage: {
      url: "https://example.com/hearth-sprites.webp",
      mime: "image/webp",
      width: hearthSpriteGrid[0].length * 48,
      height: hearthSpriteGrid.length * 48,
    },
  },
);
const hearthSpriteItems = Object.values((JSON.parse(hearthSpriteExport.json) as {
  items: { shared: Record<string, {
    type: string;
    image?: { url?: string };
    metadata?: Record<string, unknown>;
  }> };
}).items.shared).filter((item) => item.metadata?.[interiorPropMetadataKey] !== undefined);
assert(hearthSpriteItems.length === 4 && hearthSpriteItems.every(({ type }) => type === "IMAGE"),
  "interior tileset export: hearths must be movable image props");
for (const asset of ["hearth_2x1.png", "hearth_1x2.png", "hearth_3x1.png", "hearth_1x3.png"])
  assert(hearthSpriteItems.some(({ image }) => image?.url?.endsWith(asset)),
    `interior tileset export: missing ${asset}`);

const counterSpriteGrid: Grid = Array.from({ length: 4 }, () =>
  Array.from({ length: 4 }, () => ({ terrain: Terrain.Ground, obstacle: Obstacle.None })));
for (const [id, orientation, points] of [
  [1, "horizontal", [[0, 0], [1, 0], [2, 0]]],
  [2, "vertical", [[3, 1], [3, 2], [3, 3]]],
] as const) {
  for (const [x, y] of points) {
    Object.assign(counterSpriteGrid[y][x], {
      interiorProp: "bar", interiorPropId: id, propOrientation: orientation,
    });
  }
}
const counterSpriteExport = await createOwlbearSceneJson(
  counterSpriteGrid,
  "counter-sprite-export",
  new Set(),
  {
    useTileset: true,
    mapImage: {
      url: "https://example.com/counter-sprites.webp",
      mime: "image/webp",
      width: counterSpriteGrid[0].length * 48,
      height: counterSpriteGrid.length * 48,
    },
  },
);
const counterSpriteItems = Object.values((JSON.parse(counterSpriteExport.json) as {
  items: { shared: Record<string, {
    type: string;
    image?: { url?: string };
    metadata?: Record<string, unknown>;
  }> };
}).items.shared).filter((item) => item.metadata?.[interiorPropMetadataKey] !== undefined);
const counterAssets = [
  "counter_horizontal_3x1.png",
  "counter_vertical_1x3.png",
];
assert(counterSpriteItems.length === counterAssets.length &&
  counterSpriteItems.every(({ type }) => type === "IMAGE"),
"interior tileset export: counters must be movable image props");
for (const asset of counterAssets) {
  assert(counterSpriteItems.some(({ image }) => image?.url?.endsWith(asset)),
    `interior tileset export: missing ${asset}`);
}

const compositeFurnitureGrid: Grid = Array.from(
  { length: 7 },
  () => Array.from({ length: 10 }, () => ({ terrain: Terrain.Ground, obstacle: Obstacle.None })),
);
for (const [id, kind, orientation, points] of [
  [1, "table", "horizontal", [[0, 0], [1, 0]]],
  [2, "table", "vertical", [[4, 0], [4, 1], [4, 2]]],
  [3, "bench", "horizontal", [[0, 4], [1, 4], [2, 4], [3, 4], [4, 4]]],
  [4, "bench", "vertical", [[6, 0], [6, 1], [6, 2], [6, 3], [6, 4]]],
] as const) {
  for (const [x, y] of points) {
    Object.assign(compositeFurnitureGrid[y][x], {
      interiorProp: kind, interiorPropId: id, propOrientation: orientation,
    });
  }
}
for (const [id, facing, points] of [
  [5, "north", [[0, 6], [1, 6]]],
  [6, "south", [[4, 6], [5, 6]]],
] as const) {
  for (const [x, y] of points) {
    Object.assign(compositeFurnitureGrid[y][x], {
      interiorProp: "cabinet", interiorPropId: id,
      propOrientation: "horizontal", propFacing: facing,
    });
  }
}
for (const [id, points] of [
  [9, [[9, 0], [9, 1]]],
  [10, [[9, 3], [9, 4], [9, 5]]],
] as const) {
  for (const [x, y] of points) {
    Object.assign(compositeFurnitureGrid[y][x], {
      interiorProp: "altar", interiorPropId: id, propOrientation: "vertical",
    });
  }
}
for (const [id, facing, points] of [
  [7, "east", [[7, 0], [7, 1]]],
  [8, "west", [[7, 3], [7, 4], [7, 5]]],
] as const) {
  for (const [x, y] of points) {
    Object.assign(compositeFurnitureGrid[y][x], {
      interiorProp: "cabinet", interiorPropId: id,
      propOrientation: "vertical", propFacing: facing,
    });
  }
}
Object.assign(compositeFurnitureGrid[6][2], {
  interiorProp: "bones", interiorPropId: 11, propOrientation: "horizontal",
});
Object.assign(compositeFurnitureGrid[6][8], {
  interiorProp: "wall_chain", interiorPropId: 12,
  propOrientation: "vertical", propFacing: "south",
});
const compositeFurnitureExport = await createOwlbearSceneJson(
  compositeFurnitureGrid,
  "composite-furniture-export",
  new Set(),
  {
    useTileset: true,
    mapImage: {
      url: "https://example.com/composite-furniture.webp",
      mime: "image/webp",
      width: compositeFurnitureGrid[0].length * 48,
      height: compositeFurnitureGrid.length * 48,
    },
  },
);
const compositeFurnitureItems = Object.values((JSON.parse(compositeFurnitureExport.json) as {
  items: { shared: Record<string, {
    type: string;
    image?: { url?: string };
    metadata?: Record<string, unknown>;
  }> };
}).items.shared).filter((item) => item.metadata?.[interiorPropMetadataKey] !== undefined);
const compositeFurnitureAssets = [
  "table_horizontal_2x1.png",
  "table_vertical_1x3.png",
  "bench_horizontal_5x1.png",
  "bench_vertical_1x5.png",
  "cabinet_north_2x1.png",
  "cabinet_south_2x1.png",
  "cabinet_vertical_1x2.png",
  "cabinet_vertical_1x3.png",
  "altar_vertical_1x2.png",
  "altar_vertical_1x3.png",
  "bones_2_1x1.png",
  "wall_chain_1_1x2.png",
];
assert(compositeFurnitureItems.length === compositeFurnitureAssets.length &&
  compositeFurnitureItems.every(({ type }) => type === "IMAGE"),
"interior tileset export: composite furniture must be one movable image per prop");
for (const asset of compositeFurnitureAssets) {
  assert(compositeFurnitureItems.some(({ image }) => image?.url?.endsWith(asset)),
    `interior tileset export: missing ${asset}`);
}

const lightSourceGrid: Grid = [[
  {
    terrain: Terrain.Ground,
    obstacle: Obstacle.None,
    interiorProp: "hearth",
    interiorPropId: 1,
  },
  {
    terrain: Terrain.Ground,
    obstacle: Obstacle.None,
    interiorProp: "console",
    interiorPropId: 2,
  },
  {
    terrain: Terrain.Ground,
    obstacle: Obstacle.None,
    interiorProp: "altar",
    interiorPropId: 3,
  },
  {
    terrain: Terrain.Wall,
    obstacle: Obstacle.None,
    interiorProp: "torch",
    interiorPropId: 4,
    propFacing: "south",
  },
  {
    terrain: Terrain.Ground,
    obstacle: Obstacle.None,
    outdoorProp: OutdoorProp.Campfire,
  },
  {
    terrain: Terrain.Ground,
    obstacle: Obstacle.None,
    outdoorProp: OutdoorProp.LampPost,
  },
  { terrain: Terrain.Lava, obstacle: Obstacle.None },
]];
const lightKinds = new Set(collectMapLightSources(lightSourceGrid).map(({ kind }) => kind));
for (const kind of [
  "hearth", "console", "altar", "torch", "campfire", "lamp_post", "lava",
] as const) {
  assert(lightKinds.has(kind), `light source extraction: missing ${kind}`);
}
const lightTilesetExport = await createOwlbearSceneJson(
  lightSourceGrid,
  "light-tileset-export",
  new Set(),
  {
    useTileset: true,
    dynamicFog: true,
    mapImage: {
      url: "https://example.com/light-tileset.webp",
      mime: "image/webp",
      width: lightSourceGrid[0].length * 48,
      height: lightSourceGrid.length * 48,
    },
  },
);
const lightTilesetItems = Object.values((JSON.parse(lightTilesetExport.json) as {
  items: { shared: Record<string, {
    image?: { url?: string; width?: number; height?: number };
    metadata?: Record<string, unknown>;
  }> };
}).items.shared);
const torchSprite = lightTilesetItems.find(({ image }) =>
  image?.url?.includes("/lpc/torch_south.png"));
assert(torchSprite?.metadata?.[lightMetadataKey],
  "light tileset export: torch sprite must carry dynamic fog light metadata");
const campfireSprite = lightTilesetItems.find(({ image }) =>
  image?.url?.includes("/lpc/campfire_1x1.png"));
assert(campfireSprite?.image?.width === 32 && campfireSprite.image.height === 64,
  "light tileset export: campfire must use its 32x64 sprite");
assert(lightTilesetItems.some(({ metadata }) =>
  metadata?.[lightMetadataKey] && !metadata?.[interiorPropMetadataKey]),
"light tileset export: outdoor lights must be exported for dynamic fog");

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
  {
    terrain: Terrain.Ground,
    obstacle: Obstacle.None,
    outdoorProp: OutdoorProp.Campfire,
    outdoorPropId: 3,
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
assert(exportedProps.length === 3, "prop export: expected tree, rock and outdoor props");
assert(
  exportedProps.every(([, item]) => item.attachedTo === propBackground[0]),
  "prop export: props must be attached to the background",
);

console.log(`Generation invariants passed for ${generated} maps.`);
