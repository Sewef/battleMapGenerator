import {
  Obstacle,
  Terrain,
  setTileSurface,
  tileSurface,
  type Grid,
  type LandscapeMode,
  type TerrainKind,
  type TerrainOptions,
  type Tile,
} from "../domain/map";
import type { Point } from "./types";

export type PaintPolicy = {
  replace?: ReadonlySet<TerrainKind>;
  preserve?: ReadonlySet<TerrainKind>;
};

export const BIOME_RECIPES: Record<
  LandscapeMode,
  { ruggedness: number; smoothing: number; roadSlopeCost: number }
> = {
  countryside: { ruggedness: .22, smoothing: 2, roadSlopeCost: 2 },
  river: { ruggedness: .18, smoothing: 1, roadSlopeCost: 2 },
  coast: { ruggedness: .2, smoothing: 2, roadSlopeCost: 2 },
  wetlands: { ruggedness: .12, smoothing: 2, roadSlopeCost: 1 },
  underground: { ruggedness: .65, smoothing: 0, roadSlopeCost: 3 },
  volcanic: { ruggedness: .72, smoothing: 1, roadSlopeCost: 4 },
  highlands: { ruggedness: .82, smoothing: 1, roadSlopeCost: 5 },
  city: { ruggedness: .04, smoothing: 0, roadSlopeCost: 1 },
  "desert-canyon": { ruggedness: .7, smoothing: 1, roadSlopeCost: 4 },
  "ancient-forest": { ruggedness: .28, smoothing: 2, roadSlopeCost: 2 },
  "frozen-lake": { ruggedness: .2, smoothing: 2, roadSlopeCost: 2 },
  badlands: { ruggedness: .78, smoothing: 1, roadSlopeCost: 4 },
  "ruined-battlefield": { ruggedness: .3, smoothing: 0, roadSlopeCost: 2 },
  farmland: { ruggedness: .08, smoothing: 0, roadSlopeCost: 1 },
  archipelago: { ruggedness: .3, smoothing: 2, roadSlopeCost: 2 },
  "mountain-pass": { ruggedness: .9, smoothing: 1, roadSlopeCost: 5 },
  sewer: { ruggedness: .05, smoothing: 0, roadSlopeCost: 1 },
  "ancient-ruins": { ruggedness: .2, smoothing: 1, roadSlopeCost: 2 },
  house: { ruggedness: 0, smoothing: 0, roadSlopeCost: 1 },
  spaceship: { ruggedness: 0, smoothing: 0, roadSlopeCost: 1 },
  ship: { ruggedness: 0, smoothing: 0, roadSlopeCost: 1 },
  "ship-deck": { ruggedness: 0, smoothing: 0, roadSlopeCost: 1 },
  castle: { ruggedness: 0, smoothing: 0, roadSlopeCost: 1 },
  cathedral: { ruggedness: 0, smoothing: 0, roadSlopeCost: 1 },
  tavern: { ruggedness: 0, smoothing: 0, roadSlopeCost: 1 },
  crypt: { ruggedness: 0, smoothing: 0, roadSlopeCost: 1 },
};

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value));

export function normalizeGenerationOptions(
  options: TerrainOptions,
): TerrainOptions {
  return {
    ...options,
    width: Math.max(8, Math.round(options.width)),
    height: Math.max(8, Math.round(options.height)),
    scale: clamp(Math.round(options.scale), 2, 20),
    waterWeight: clamp(options.waterWeight, 0, 2),
    difficultWeight: clamp(options.difficultWeight, 0, 2),
    reliefWeight: clamp(options.reliefWeight, 0, 2),
    rockRatio: clamp(options.rockRatio, 0, .35),
    treeRatio: clamp(options.treeRatio, 0, .5),
    buildingCount: clamp(Math.round(options.buildingCount), 0, 40),
    lightPropRatio: clamp(options.lightPropRatio ?? 0, 0, .05),
  };
}

export function paintTerrain(
  tile: Tile,
  terrain: TerrainKind,
  policy: PaintPolicy = {},
) {
  if (policy.preserve?.has(tile.terrain)) return false;
  if (policy.replace && !policy.replace.has(tile.terrain)) return false;
  tile.terrain = terrain;
  return true;
}

function hashNoise(x: number, y: number, seed: string) {
  let value = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    value = Math.imul(value ^ seed.charCodeAt(index), 16777619);
  }
  value ^= Math.imul(x + 37, 374761393);
  value ^= Math.imul(y + 71, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function interpolatedNoise(
  x: number,
  y: number,
  scale: number,
  seed: string,
) {
  const sampleX = x / scale;
  const sampleY = y / scale;
  const left = Math.floor(sampleX);
  const top = Math.floor(sampleY);
  const fractionX = sampleX - left;
  const fractionY = sampleY - top;
  const smooth = (value: number) => value * value * (3 - 2 * value);
  const blendX = smooth(fractionX);
  const blendY = smooth(fractionY);
  const lerp = (from: number, to: number, amount: number) =>
    from + (to - from) * amount;
  const north = lerp(
    hashNoise(left, top, seed),
    hashNoise(left + 1, top, seed),
    blendX,
  );
  const south = lerp(
    hashNoise(left, top + 1, seed),
    hashNoise(left + 1, top + 1, seed),
    blendX,
  );
  return lerp(north, south, blendY);
}

export function assignHeightField(
  grid: Grid,
  mode: LandscapeMode,
  seed: string,
) {
  const ruggedness = BIOME_RECIPES[mode].ruggedness;
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      const broad = interpolatedNoise(x, y, 8.5, `${seed}:h0`);
      const medium = interpolatedNoise(x, y, 3.75, `${seed}:h1`);
      const fine = interpolatedNoise(x, y, 1.6, `${seed}:h2`);
      grid[y][x].height = clamp(
        (broad * .52 + medium * .31 + fine * .17) * ruggedness +
          (1 - ruggedness) * .35,
        0,
        1,
      );
    }
  }
}

export function smoothTerrain(
  grid: Grid,
  terrain: TerrainKind,
  iterations: number,
) {
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const next = grid.map((row) => row.map((tile) => tile.terrain));
    for (let y = 1; y < grid.length - 1; y += 1) {
      for (let x = 1; x < grid[y].length - 1; x += 1) {
        if (tileSurface(grid[y][x])) continue;
        let neighbors = 0;
        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
          for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
            if (!offsetX && !offsetY) continue;
            if (grid[y + offsetY][x + offsetX].terrain === terrain) {
              neighbors += 1;
            }
          }
        }
        if (grid[y][x].terrain === terrain && neighbors <= 2) {
          next[y][x] = Terrain.Ground;
        } else if (
          grid[y][x].terrain === Terrain.Ground &&
          neighbors >= 6
        ) {
          next[y][x] = terrain;
        }
      }
    }
    for (let y = 0; y < grid.length; y += 1) {
      for (let x = 0; x < grid[y].length; x += 1) {
        grid[y][x].terrain = next[y][x];
      }
    }
  }
}

const directions = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

function routeCost(grid: Grid, from: Point, to: Point, slopeCost: number) {
  const tile = grid[to.y][to.x];
  if (tile.obstacle === Obstacle.Building) return Infinity;
  const obstacleCost = tile.obstacle === Obstacle.Rock
    ? 9
    : tile.obstacle === Obstacle.Tree ? 5 : 0;
  if (tile.terrain === Terrain.Lava || tile.terrain === Terrain.Void) return 80;
  if (tile.terrain === Terrain.Cliff) return 24;
  const heightDelta = Math.abs(
    (grid[from.y][from.x].height ?? 0) - (tile.height ?? 0),
  );
  return 1 +
    obstacleCost +
    heightDelta * slopeCost * 8 +
    (tile.terrain === Terrain.Difficult ? 2 : 0) +
    (tile.terrain === Terrain.Water || tile.terrain === Terrain.Ravine ? 4 : 0);
}

function weightedPath(
  grid: Grid,
  start: Point,
  targets: ReadonlySet<string>,
  slopeCost: number,
) {
  const key = ({ x, y }: Point) => `${x},${y}`;
  const distance = new Map<string, number>([[key(start), 0]]);
  const previous = new Map<string, Point>();
  const queue: Array<{ point: Point; score: number }> = [
    { point: start, score: 0 },
  ];
  let end: Point | undefined;
  while (queue.length) {
    queue.sort((a, b) => a.score - b.score);
    const current = queue.shift()!;
    const currentKey = key(current.point);
    if (current.score !== distance.get(currentKey)) continue;
    if (targets.has(currentKey)) {
      end = current.point;
      break;
    }
    for (const direction of directions) {
      const next = {
        x: current.point.x + direction.x,
        y: current.point.y + direction.y,
      };
      if (!grid[next.y]?.[next.x]) continue;
      const score = current.score +
        routeCost(grid, current.point, next, slopeCost);
      const nextKey = key(next);
      if (score >= (distance.get(nextKey) ?? Infinity)) continue;
      distance.set(nextKey, score);
      previous.set(nextKey, current.point);
      queue.push({ point: next, score });
    }
  }
  if (!end) return undefined;
  const path = [end];
  while (key(path[0]) !== key(start)) {
    const point = previous.get(key(path[0]));
    if (!point) return undefined;
    path.unshift(point);
  }
  return path;
}

export function connectPointsOfInterest(grid: Grid, mode: LandscapeMode) {
  const roadTargets = new Set<string>();
  const buildingEntrances = new Map<number, Point[]>();
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      if (tileSurface(grid[y][x])) roadTargets.add(`${x},${y}`);
      if (grid[y][x].obstacle !== Obstacle.Building) continue;
      const buildingId = grid[y][x].obstacleId ?? y * grid[y].length + x;
      for (const direction of directions) {
        const point = { x: x + direction.x, y: y + direction.y };
        const tile = grid[point.y]?.[point.x];
        if (tile && tile.obstacle === Obstacle.None) {
          const candidates = buildingEntrances.get(buildingId) ?? [];
          candidates.push(point);
          buildingEntrances.set(buildingId, candidates);
        }
      }
    }
  }
  if (!roadTargets.size) return;
  for (const candidates of buildingEntrances.values()) {
    const uniqueEntrances = [
      ...new Map(candidates.map((point) => [`${point.x},${point.y}`, point]))
        .values(),
    ];
    const entrance = uniqueEntrances.sort((a, b) => {
      const distanceToRoad = (point: Point) =>
        Math.min(...[...roadTargets].map((key) => {
          const [x, y] = key.split(",").map(Number);
          return Math.abs(x - point.x) + Math.abs(y - point.y);
        }));
      return distanceToRoad(a) - distanceToRoad(b);
    })[0];
    if (!entrance) continue;
    if (directions.some(({ x, y }) =>
      roadTargets.has(`${entrance.x + x},${entrance.y + y}`)
    )) {
      continue;
    }
    const path = weightedPath(
      grid,
      entrance,
      roadTargets,
      BIOME_RECIPES[mode].roadSlopeCost,
    );
    if (!path) continue;
    for (const point of path) {
      const tile = grid[point.y][point.x];
      const surface =
        tile.terrain === Terrain.Water || tile.terrain === Terrain.Ravine
          ? Terrain.Bridge
          : Terrain.Road;
      setTileSurface(tile, surface);
      roadTargets.add(`${point.x},${point.y}`);
    }
  }
}

function isPassable(tile: Tile) {
  if (tile.obstacle !== Obstacle.None) return false;
  if (tileSurface(tile) === Terrain.Bridge) return true;
  return tile.terrain !== Terrain.Cliff &&
    tile.terrain !== Terrain.Ravine &&
    tile.terrain !== Terrain.Lava &&
    tile.terrain !== Terrain.Void &&
    tile.terrain !== Terrain.Wall;
}

const pointKey = ({ x, y }: Point) => `${x},${y}`;

function passableComponents(grid: Grid) {
  const visited = new Set<string>();
  const components: Point[][] = [];
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      const start = { x, y };
      const startKey = pointKey(start);
      if (visited.has(startKey) || !isPassable(grid[y][x])) continue;
      const component: Point[] = [];
      const queue = [start];
      visited.add(startKey);
      for (let index = 0; index < queue.length; index += 1) {
        const point = queue[index];
        component.push(point);
        for (const direction of directions) {
          const next = { x: point.x + direction.x, y: point.y + direction.y };
          const key = pointKey(next);
          if (
            visited.has(key) ||
            !grid[next.y]?.[next.x] ||
            !isPassable(grid[next.y][next.x])
          ) {
            continue;
          }
          visited.add(key);
          queue.push(next);
        }
      }
      components.push(component);
    }
  }
  return components.sort((a, b) =>
    b.length - a.length ||
    (a[0]?.y ?? 0) - (b[0]?.y ?? 0) ||
    (a[0]?.x ?? 0) - (b[0]?.x ?? 0)
  );
}

type RepairScore = { terrainCost: number; length: number };
type RepairQueueItem = { point: Point; score: RepairScore };

function compareRepairScores(a: RepairScore, b: RepairScore) {
  return a.terrainCost - b.terrainCost || a.length - b.length;
}

function compareRepairQueueItems(a: RepairQueueItem, b: RepairQueueItem) {
  return compareRepairScores(a.score, b.score) ||
    a.point.y - b.point.y ||
    a.point.x - b.point.x;
}

function pushRepairQueue(queue: RepairQueueItem[], item: RepairQueueItem) {
  queue.push(item);
  let index = queue.length - 1;
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (compareRepairQueueItems(queue[parent], queue[index]) <= 0) break;
    [queue[parent], queue[index]] = [queue[index], queue[parent]];
    index = parent;
  }
}

function popRepairQueue(queue: RepairQueueItem[]) {
  const first = queue[0];
  const last = queue.pop();
  if (!first || !last || !queue.length) return first;
  queue[0] = last;
  let index = 0;
  while (true) {
    const left = index * 2 + 1;
    const right = left + 1;
    let smallest = index;
    if (
      left < queue.length &&
      compareRepairQueueItems(queue[left], queue[smallest]) < 0
    ) {
      smallest = left;
    }
    if (
      right < queue.length &&
      compareRepairQueueItems(queue[right], queue[smallest]) < 0
    ) {
      smallest = right;
    }
    if (smallest === index) break;
    [queue[index], queue[smallest]] = [queue[smallest], queue[index]];
    index = smallest;
  }
  return first;
}

function connectivityStepCost(tile: Tile) {
  if (tile.obstacle === Obstacle.Building || tile.terrain === Terrain.Wall) {
    return Infinity;
  }
  // Every edit carries a meaningful base cost, then fragile terrain adds a
  // premium. This prevents a one-cell cliff notch from being avoided by
  // clearing a conspicuously long line of otherwise well-placed vegetation.
  const obstacleCost = tile.obstacle === Obstacle.Tree
    ? 10
    : tile.obstacle === Obstacle.Rock ? 12 : 0;
  const terrainCost = tile.terrain === Terrain.Ravine
    ? 16
    : tile.terrain === Terrain.Cliff
      ? 22 + (tile.elevation ?? 1) * 4
      : tile.terrain === Terrain.Lava
        ? 50
        : tile.terrain === Terrain.Void ? 60 : 0;
  return obstacleCost + terrainCost;
}

/**
 * Finds the least invasive connection from an already connected region to
 * any still-isolated component. Every cell in the connected region is a
 * source, so the result starts at the locally closest useful boundary rather
 * than at an arbitrary component cell. Terrain edits are minimized before
 * path length, which avoids long artificial cuts through cliffs and lava.
 */
function shortestLocalConnection(
  grid: Grid,
  connected: ReadonlySet<string>,
  isolated: ReadonlySet<string>,
) {
  const distances = new Map<string, RepairScore>();
  const previous = new Map<string, Point>();
  const queue: RepairQueueItem[] = [];
  for (const key of connected) {
    const [x, y] = key.split(",").map(Number);
    const point = { x, y };
    const isBoundary = directions.some((direction) => {
      const next = { x: x + direction.x, y: y + direction.y };
      return grid[next.y]?.[next.x] && !connected.has(pointKey(next));
    });
    if (!isBoundary) continue;
    const score = { terrainCost: 0, length: 0 };
    distances.set(key, score);
    pushRepairQueue(queue, { point, score });
  }

  let end: Point | undefined;
  while (queue.length) {
    const current = popRepairQueue(queue)!;
    const currentKey = pointKey(current.point);
    const best = distances.get(currentKey);
    if (!best || compareRepairScores(current.score, best) !== 0) continue;
    if (isolated.has(currentKey)) {
      end = current.point;
      break;
    }
    for (const direction of directions) {
      const next = {
        x: current.point.x + direction.x,
        y: current.point.y + direction.y,
      };
      const tile = grid[next.y]?.[next.x];
      if (!tile) continue;
      const nextKey = pointKey(next);
      // Every connected boundary cell is already a source. Walking back
      // through the entire connected region only bloats the queue and cannot
      // improve either the terrain cost or the path length.
      if (connected.has(nextKey)) continue;
      const terrainCost = connectivityStepCost(tile);
      if (!Number.isFinite(terrainCost)) continue;
      const score = {
        terrainCost: current.score.terrainCost + terrainCost,
        length: current.score.length + 1,
      };
      const known = distances.get(nextKey);
      if (known && compareRepairScores(score, known) >= 0) continue;
      distances.set(nextKey, score);
      previous.set(nextKey, current.point);
      pushRepairQueue(queue, { point: next, score });
    }
  }
  if (!end) return undefined;

  const path = [end];
  while (!connected.has(pointKey(path[0]))) {
    const point = previous.get(pointKey(path[0]));
    if (!point) return undefined;
    path.unshift(point);
  }
  return {
    path,
    score: distances.get(pointKey(end))!,
  };
}

export interface ValidationReport {
  repairedBridgeCells: number;
  carvedCliffCrossings: number;
  removedInvalidObstacles: number;
  connectedComponents: number;
  /** Number of local links added to join isolated walkable regions. */
  connectivityRepairs: number;
  /** Unique cells altered by connectivity repairs. */
  connectivityRepairCells: number;
  /** Weighted severity of terrain altered by connectivity repairs. */
  connectivityRepairCost: number;
  /** Longest gap spanned by one connectivity repair, excluding endpoints. */
  longestConnectivityRepair: number;
  /** Unique cells touched by every validation/repair operation. */
  repairFootprintCells: number;
  /** Soft diagnostic budget, proportional to the map area. */
  repairBudgetCells: number;
  /** Generation should be reconsidered when repairs exceed this soft budget. */
  repairBudgetExceeded: boolean;
  /** Components still disconnected when an immutable wall/building blocks repair. */
  remainingConnectedComponents: number;
  connectivityRepairFailed: boolean;
}

export function validateAndRepairGrid(
  grid: Grid,
  _mode?: LandscapeMode,
): ValidationReport {
  let repairedBridgeCells = 0;
  let carvedCliffCrossings = 0;
  let removedInvalidObstacles = 0;
  let connectivityRepairs = 0;
  let connectivityRepairCost = 0;
  let longestConnectivityRepair = 0;
  const repairFootprint = new Set<string>();
  const connectivityRepairFootprint = new Set<string>();
  const markRepair = (x: number, y: number, connectivity = false) => {
    const key = `${x},${y}`;
    repairFootprint.add(key);
    if (connectivity) connectivityRepairFootprint.add(key);
  };
  const cliffTransitionNormal = (x: number, y: number) => {
    const elevation = grid[y][x].elevation ?? 1;
    let normalX = 0;
    let normalY = 0;
    for (const direction of directions) {
      const neighbor = grid[y + direction.y]?.[x + direction.x];
      const neighborElevation = neighbor?.terrain === Terrain.Cliff
        ? neighbor.elevation ?? 1
        : 0;
      const drop = Math.max(0, elevation - neighborElevation);
      normalX += direction.x * drop;
      normalY += direction.y * drop;
    }
    if (Math.hypot(normalX, normalY) < .01) {
      const horizontal =
        Number(
          grid[y]?.[x - 1] &&
            tileSurface(grid[y][x - 1]) === Terrain.Road,
        ) +
        Number(
          grid[y]?.[x + 1] &&
            tileSurface(grid[y][x + 1]) === Terrain.Road,
        );
      const vertical =
        Number(
          grid[y - 1]?.[x] &&
            tileSurface(grid[y - 1][x]) === Terrain.Road,
        ) +
        Number(
          grid[y + 1]?.[x] &&
            tileSurface(grid[y + 1][x]) === Terrain.Road,
        );
      normalX = horizontal >= vertical ? 1 : 0;
      normalY = vertical > horizontal ? 1 : 0;
    }
    const length = Math.hypot(normalX, normalY) || 1;
    const normalized = { x: normalX / length, y: normalY / length };
    return Math.hypot(normalized.x, normalized.y) > .9
      ? normalized
      : { x: 1, y: 0 };
  };
  const transitionNormals = new Map<string, { x: number; y: number }>();
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      if (
        tileSurface(grid[y][x]) === Terrain.Road &&
        grid[y][x].terrain === Terrain.Cliff
      ) {
        transitionNormals.set(`${x},${y}`, cliffTransitionNormal(x, y));
      }
    }
  }
  for (let y = 0; y < grid.length; y += 1) {
    const row = grid[y];
    for (let x = 0; x < row.length; x += 1) {
      const tile = row[x];
      if (tile.obstacle === Obstacle.Building && tileSurface(tile)) {
        if (tile.terrain === Terrain.Road || tile.terrain === Terrain.Bridge) {
          tile.terrain = Terrain.Ground;
        }
        delete tile.surface;
        markRepair(x, y);
      }
      const surface = tileSurface(tile);
      if (surface === Terrain.Road && tile.terrain === Terrain.Cliff) {
        const elevation = tile.elevation ?? 1;
        const normal = transitionNormals.get(`${x},${y}`) ?? { x: 1, y: 0 };
        tile.transition = "slope";
        tile.transitionNormalX = normal.x;
        tile.transitionNormalY = normal.y;
        tile.terrain = elevation >= 2 ? Terrain.Ground : Terrain.Difficult;
        delete tile.elevation;
        carvedCliffCrossings += 1;
        markRepair(x, y);
      } else if (surface !== Terrain.Road) {
        const removedTransitionMetadata =
          tile.transition !== undefined ||
          tile.transitionNormalX !== undefined ||
          tile.transitionNormalY !== undefined;
        delete tile.transition;
        delete tile.transitionNormalX;
        delete tile.transitionNormalY;
        if (removedTransitionMetadata) markRepair(x, y);
      }
      const needsBridge =
        tile.terrain === Terrain.Water || tile.terrain === Terrain.Ravine;
      if (surface === Terrain.Road && needsBridge) {
        setTileSurface(tile, Terrain.Bridge);
        repairedBridgeCells += 1;
        markRepair(x, y);
      } else if (surface === Terrain.Bridge && !needsBridge) {
        setTileSurface(tile, Terrain.Road);
        repairedBridgeCells += 1;
        markRepair(x, y);
      }
      if (
        tile.obstacle !== Obstacle.None &&
        (tileSurface(tile) !== undefined ||
          tile.terrain === Terrain.Water ||
          tile.terrain === Terrain.Lava ||
          tile.terrain === Terrain.Ravine ||
          tile.terrain === Terrain.Cliff)
      ) {
        tile.obstacle = Obstacle.None;
        delete tile.obstacleId;
        removedInvalidObstacles += 1;
        markRepair(x, y);
      }
    }
  }

  const components = passableComponents(grid);
  const main = components[0] ?? [];
  const mainTargets = new Set(main.map(pointKey));
  const componentByCell = new Map<string, number>();
  components.forEach((component, componentIndex) => {
    for (const point of component) {
      componentByCell.set(pointKey(point), componentIndex);
    }
  });
  const mergedComponents = new Set<number>(main.length ? [0] : []);

  while (mainTargets.size && mergedComponents.size < components.length) {
    const isolatedTargets = new Set<string>();
    components.forEach((component, componentIndex) => {
      if (mergedComponents.has(componentIndex)) return;
      for (const point of component) isolatedTargets.add(pointKey(point));
    });
    const connection = shortestLocalConnection(
      grid,
      mainTargets,
      isolatedTargets,
    );
    if (!connection) break;

    const repairedOnPath = new Set<string>();
    for (const point of connection.path) {
      const tile = grid[point.y][point.x];
      if (tile.obstacle === Obstacle.Tree || tile.obstacle === Obstacle.Rock) {
        tile.obstacle = Obstacle.None;
        delete tile.obstacleId;
        removedInvalidObstacles += 1;
        repairedOnPath.add(pointKey(point));
      }
      if (tile.terrain === Terrain.Cliff) {
        // A patch of difficult ground reads as a natural notch or scramble;
        // plain ground made repaired cliff walls look machine-cut.
        tile.terrain = Terrain.Difficult;
        delete tile.elevation;
        delete tile.transition;
        delete tile.transitionNormalX;
        delete tile.transitionNormalY;
        carvedCliffCrossings += 1;
        repairedOnPath.add(pointKey(point));
      } else if (tile.terrain === Terrain.Ravine) {
        setTileSurface(tile, Terrain.Bridge);
        repairedBridgeCells += 1;
        repairedOnPath.add(pointKey(point));
      } else if (
        tile.terrain === Terrain.Lava ||
        tile.terrain === Terrain.Void
      ) {
        tile.terrain = Terrain.Difficult;
        repairedOnPath.add(pointKey(point));
      }
    }
    if (repairedOnPath.size) {
      connectivityRepairs += 1;
      connectivityRepairCost += connection.score.terrainCost;
      longestConnectivityRepair = Math.max(
        longestConnectivityRepair,
        Math.max(0, connection.path.length - 2),
      );
      for (const key of repairedOnPath) {
        const [x, y] = key.split(",").map(Number);
        markRepair(x, y, true);
      }
    }

    // The selected endpoint identifies the newly joined original component.
    // Adding all of it as a source makes the next repair local to the union,
    // producing a deterministic minimum-spanning style sequence of links.
    const endpoint = connection.path[connection.path.length - 1];
    const joinedComponent = componentByCell.get(pointKey(endpoint));
    if (joinedComponent === undefined) break;
    mergedComponents.add(joinedComponent);
    for (const point of components[joinedComponent]) {
      mainTargets.add(pointKey(point));
    }
    for (const point of connection.path) mainTargets.add(pointKey(point));
  }

  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      const tile = grid[y][x];
      if (tileSurface(tile) && tile.obstacle !== Obstacle.None) {
        tile.obstacle = Obstacle.None;
        delete tile.obstacleId;
        removedInvalidObstacles += 1;
        markRepair(x, y);
      }
    }
  }
  const repairBudgetCells = Math.max(
    4,
    Math.ceil(grid.reduce((total, row) => total + row.length, 0) * .02),
  );
  const remainingConnectedComponents = passableComponents(grid).length;
  return {
    repairedBridgeCells,
    carvedCliffCrossings,
    removedInvalidObstacles,
    connectedComponents: components.length,
    connectivityRepairs,
    connectivityRepairCells: connectivityRepairFootprint.size,
    connectivityRepairCost,
    longestConnectivityRepair,
    repairFootprintCells: repairFootprint.size,
    repairBudgetCells,
    repairBudgetExceeded: repairFootprint.size > repairBudgetCells,
    remainingConnectedComponents,
    connectivityRepairFailed: remainingConnectedComponents !== 1,
  };
}
