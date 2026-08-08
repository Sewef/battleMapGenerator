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

export function assignHeightField(
  grid: Grid,
  mode: LandscapeMode,
  seed: string,
) {
  const ruggedness = BIOME_RECIPES[mode].ruggedness;
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      const broad = hashNoise(Math.floor(x / 6), Math.floor(y / 6), `${seed}:h0`);
      const medium = hashNoise(Math.floor(x / 3), Math.floor(y / 3), `${seed}:h1`);
      const fine = hashNoise(x, y, `${seed}:h2`);
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
  if (tile.terrain === Terrain.Lava || tile.terrain === Terrain.Void) return 80;
  if (tile.terrain === Terrain.Cliff) return 24;
  const heightDelta = Math.abs(
    (grid[from.y][from.x].height ?? 0) - (tile.height ?? 0),
  );
  return 1 +
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
  if (tile.obstacle === Obstacle.Building || tile.obstacle === Obstacle.Rock) {
    return false;
  }
  if (tileSurface(tile) === Terrain.Bridge) return true;
  return tile.terrain !== Terrain.Cliff &&
    tile.terrain !== Terrain.Ravine &&
    tile.terrain !== Terrain.Lava &&
    tile.terrain !== Terrain.Void;
}

export interface ValidationReport {
  repairedBridgeCells: number;
  carvedCliffCrossings: number;
  removedInvalidObstacles: number;
  connectedComponents: number;
}

export function validateAndRepairGrid(
  grid: Grid,
  mode?: LandscapeMode,
): ValidationReport {
  let repairedBridgeCells = 0;
  let carvedCliffCrossings = 0;
  let removedInvalidObstacles = 0;
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
        delete tile.surface;
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
      } else if (surface !== Terrain.Road) {
        delete tile.transition;
        delete tile.transitionNormalX;
        delete tile.transitionNormalY;
      }
      const needsBridge =
        tile.terrain === Terrain.Water || tile.terrain === Terrain.Ravine;
      if (surface === Terrain.Road && needsBridge) {
        setTileSurface(tile, Terrain.Bridge);
        repairedBridgeCells += 1;
      } else if (surface === Terrain.Bridge && !needsBridge) {
        setTileSurface(tile, Terrain.Road);
        repairedBridgeCells += 1;
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
      }
    }
  }

  const visited = new Set<string>();
  const components: Point[][] = [];
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      const startKey = `${x},${y}`;
      if (visited.has(startKey) || !isPassable(grid[y][x])) continue;
      const component: Point[] = [];
      const queue = [{ x, y }];
      visited.add(startKey);
      for (let index = 0; index < queue.length; index += 1) {
        const point = queue[index];
        component.push(point);
        for (const direction of directions) {
          const next = { x: point.x + direction.x, y: point.y + direction.y };
          const key = `${next.x},${next.y}`;
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
  components.sort((a, b) => b.length - a.length);
  const main = components[0] ?? [];
  const mainTargets = new Set(main.map(({ x, y }) => `${x},${y}`));
  for (const component of mode === "archipelago" ? [] : components.slice(1)) {
    if (component.length < 3 || !mainTargets.size) continue;
    const path = weightedPath(grid, component[0], mainTargets, 2);
    if (!path) continue;
    for (const point of path) {
      const tile = grid[point.y][point.x];
      if (tile.terrain === Terrain.Cliff) {
        const normal = cliffTransitionNormal(point.x, point.y);
        tile.transition = "slope";
        tile.transitionNormalX = normal.x;
        tile.transitionNormalY = normal.y;
        tile.terrain = Terrain.Ground;
        carvedCliffCrossings += 1;
      } else if (
        tile.terrain === Terrain.Lava ||
        tile.terrain === Terrain.Void
      ) {
        tile.terrain = Terrain.Ground;
      }
      setTileSurface(
        tile,
        tile.terrain === Terrain.Water || tile.terrain === Terrain.Ravine
          ? Terrain.Bridge
          : Terrain.Road,
      );
      mainTargets.add(`${point.x},${point.y}`);
    }
  }
  for (const row of grid) {
    for (const tile of row) {
      if (tileSurface(tile) && tile.obstacle !== Obstacle.None) {
        tile.obstacle = Obstacle.None;
        delete tile.obstacleId;
        removedInvalidObstacles += 1;
      }
    }
  }
  return {
    repairedBridgeCells,
    carvedCliffCrossings,
    removedInvalidObstacles,
    connectedComponents: components.length,
  };
}
