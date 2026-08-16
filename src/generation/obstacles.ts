import {
  Obstacle,
  Terrain,
  tileSurface,
  type Grid,
  type LandscapeMode,
} from "../domain/map";
import type { Point, Random } from "./types";

type TilePredicate = (
  tile: Grid[number][number],
  x: number,
  y: number,
) => boolean;

function cellDistancesFrom(
  grid: Grid,
  predicate: TilePredicate,
): number[][] {
  const distances = grid.map((row) => row.map(() => Infinity));
  const queue: Point[] = [];
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      if (!predicate(grid[y][x], x, y)) continue;
      distances[y][x] = 0;
      queue.push({ x, y });
    }
  }
  for (let index = 0; index < queue.length; index += 1) {
    const point = queue[index];
    for (const direction of [
      { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
    ]) {
      const next = { x: point.x + direction.x, y: point.y + direction.y };
      if (
        grid[next.y]?.[next.x] &&
        distances[next.y][next.x] > distances[point.y][point.x] + 1
      ) {
        distances[next.y][next.x] = distances[point.y][point.x] + 1;
        queue.push(next);
      }
    }
  }
  return distances;
}

export function cellDistancesFromWater(grid: Grid): number[][] {
  return cellDistancesFrom(grid, (tile) => tile.terrain === Terrain.Water);
}

export function scatterDifficultTerrain(
  grid: Grid,
  target: number,
  waterDistance: number[][],
  random: Random,
) {
  const placed = new Set<string>();
  const candidates = grid.flatMap((row, y) =>
    row.map((tile, x) => ({ tile, x, y }))
      .filter(({ tile }) => tile.terrain === Terrain.Ground),
  );
  const patchCount = Math.max(1, Math.round(target / 9));

  for (let patch = 0; patch < patchCount && placed.size < target; patch += 1) {
    const seedPool = candidates
      .filter(({ x, y }) => !placed.has(`${x},${y}`))
      .map((candidate) => {
        const { x, y } = candidate;
        const wet = Number.isFinite(waterDistance[y][x])
          ? waterDistance[y][x]
          : 8;
        return { ...candidate, score: wet + random() * 8 };
      })
      .sort((a, b) => {
        return a.score - b.score;
      });
    if (!seedPool.length) break;
    let point = { x: seedPool[0].x, y: seedPool[0].y };
    const patchSize = 3 + Math.floor(random() * 10);
    let direction = { x: 0, y: 0 };
    for (let step = 0; step < patchSize && placed.size < target; step += 1) {
      const tile = grid[point.y]?.[point.x];
      if (tile?.terrain === Terrain.Ground) placed.add(`${point.x},${point.y}`);
      if (random() < .55) {
        const choices = [
          { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
        ];
        direction = choices[Math.floor(random() * choices.length)];
      }
      point = { x: point.x + direction.x, y: point.y + direction.y };
      if (!grid[point.y]?.[point.x]) break;
    }
  }

  const remaining = candidates
    .filter(({ x, y }) => !placed.has(`${x},${y}`))
    .map((candidate) => {
      const wet = Number.isFinite(waterDistance[candidate.y][candidate.x])
        ? waterDistance[candidate.y][candidate.x]
        : 8;
      return { ...candidate, score: wet + random() * 16 };
    })
    .sort((a, b) => a.score - b.score);
  for (const { x, y } of remaining.slice(0, Math.max(0, target - placed.size))) {
    placed.add(`${x},${y}`);
  }
  for (const key of placed) {
    const [x, y] = key.split(",").map(Number);
    grid[y][x].terrain = Terrain.Difficult;
  }
}

type HabitatCenter = Point & {
  angle: number;
  stretchX: number;
  stretchY: number;
};

type HabitatCandidate = Point & {
  habitatScore: number;
  centerNoise: number;
};

function bandPenalty(distance: number, minimum: number, maximum: number) {
  if (!Number.isFinite(distance)) return Math.max(4, maximum - minimum + 2);
  if (distance < minimum) return minimum - distance;
  if (distance > maximum) return distance - maximum;
  return 0;
}

function localRelief(grid: Grid, x: number, y: number) {
  let minimum = grid[y][x].height ?? .5;
  let maximum = minimum;
  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      const neighbor = grid[y + offsetY]?.[x + offsetX];
      if (!neighbor) continue;
      const height = neighbor.height ?? .5;
      minimum = Math.min(minimum, height);
      maximum = Math.max(maximum, height);
    }
  }
  return maximum - minimum;
}

function dropBelowNearbyCliffs(grid: Grid, x: number, y: number) {
  let cliffHeight = 0;
  let cliffCount = 0;
  for (let offsetY = -3; offsetY <= 3; offsetY += 1) {
    for (let offsetX = -3; offsetX <= 3; offsetX += 1) {
      const neighbor = grid[y + offsetY]?.[x + offsetX];
      if (neighbor?.terrain !== Terrain.Cliff) continue;
      cliffHeight += neighbor.height ?? .5;
      cliffCount += 1;
    }
  }
  if (!cliffCount) return 0;
  return Math.max(0, cliffHeight / cliffCount - (grid[y][x].height ?? .5));
}

function edgeDistance(grid: Grid, x: number, y: number) {
  return Math.min(x, y, grid[y].length - x - 1, grid.length - y - 1);
}

function createsStraightObstacleRun(
  grid: Grid,
  footprint: Point[],
  obstacle: typeof Obstacle.Tree | typeof Obstacle.Rock,
  maximumRun: number,
) {
  const proposed = new Set(footprint.map(({ x, y }) => `${x},${y}`));
  const occupied = (x: number, y: number) =>
    proposed.has(`${x},${y}`) || grid[y]?.[x]?.obstacle === obstacle;
  for (const point of footprint) {
    for (const axis of [{ x: 1, y: 0 }, { x: 0, y: 1 }]) {
      let run = 1;
      for (const sign of [-1, 1]) {
        let distance = 1;
        while (occupied(
          point.x + axis.x * distance * sign,
          point.y + axis.y * distance * sign,
        )) {
          run += 1;
          distance += 1;
        }
      }
      if (run > maximumRun) return true;
    }
  }
  return false;
}

function chooseHabitatCenters(
  candidates: HabitatCandidate[],
  target: number,
  clusterSize: number,
  spacing: number,
  random: Random,
) {
  const desired = Math.max(1, Math.ceil(target / Math.max(1, clusterSize)));
  const pool = [...candidates].sort((a, b) =>
    a.habitatScore + a.centerNoise - b.habitatScore - b.centerNoise
  );
  const centers: HabitatCenter[] = [];
  const addCenter = (candidate: HabitatCandidate) => {
    centers.push({
      x: candidate.x,
      y: candidate.y,
      angle: random() * Math.PI,
      stretchX: .7 + random() * .8,
      stretchY: .7 + random() * .8,
    });
  };
  for (const candidate of pool) {
    if (centers.every((center) =>
      Math.hypot(center.x - candidate.x, center.y - candidate.y) > spacing
    )) {
      addCenter(candidate);
      if (centers.length >= desired) break;
    }
  }
  // Small islands and narrow passes may not satisfy the preferred spacing.
  // Fill the missing sources at a relaxed distance, without collapsing them
  // onto the same cell.
  if (centers.length < desired) {
    for (const candidate of pool) {
      if (centers.some((center) => center.x === candidate.x && center.y === candidate.y)) {
        continue;
      }
      if (centers.every((center) =>
        Math.hypot(center.x - candidate.x, center.y - candidate.y) > spacing * .55
      )) {
        addCenter(candidate);
        if (centers.length >= desired) break;
      }
    }
  }
  return centers;
}

function distanceToHabitat(point: Point, centers: HabitatCenter[]) {
  return Math.min(...centers.map((center) => {
    const deltaX = point.x - center.x;
    const deltaY = point.y - center.y;
    const cosine = Math.cos(center.angle);
    const sine = Math.sin(center.angle);
    const along = (deltaX * cosine + deltaY * sine) / center.stretchX;
    const across = (-deltaX * sine + deltaY * cosine) / center.stretchY;
    return Math.hypot(along, across);
  }));
}

interface RockEcology {
  clusterSize: number;
  centerSpacing: number;
  clusterWeight: number;
  randomness: number;
  cliffMin: number;
  cliffMax: number;
  cliffWeight: number;
  waterMin: number;
  waterMax: number;
  waterWeight: number;
  lavaMin: number;
  lavaMax: number;
  lavaWeight: number;
  ravineMin: number;
  ravineMax: number;
  ravineWeight: number;
  buildingMin: number;
  buildingMax: number;
  buildingWeight: number;
  heightIdeal: number;
  heightWeight: number;
  difficultBias: number;
  reliefBias: number;
  cliffDropBias: number;
  maximumImmediate: number;
  maximumLocal: number;
  massChance: number;
  cornerChance: number;
  slabChance: number;
}

const DEFAULT_ROCK_ECOLOGY: RockEcology = {
  clusterSize: 8,
  centerSpacing: 5,
  clusterWeight: .72,
  randomness: 5.5,
  cliffMin: 1,
  cliffMax: 5,
  cliffWeight: .55,
  waterMin: 2,
  waterMax: 9,
  waterWeight: .12,
  lavaMin: 2,
  lavaMax: 8,
  lavaWeight: 0,
  ravineMin: 1,
  ravineMax: 5,
  ravineWeight: .18,
  buildingMin: 3,
  buildingMax: 10,
  buildingWeight: 0,
  heightIdeal: .52,
  heightWeight: .4,
  difficultBias: -.35,
  reliefBias: 1.5,
  cliffDropBias: 1.5,
  maximumImmediate: 4,
  maximumLocal: 9,
  massChance: .07,
  cornerChance: .09,
  slabChance: .13,
};

const ROCK_ECOLOGY: Partial<Record<LandscapeMode, Partial<RockEcology>>> = {
  countryside: {
    clusterSize: 7, centerSpacing: 6, clusterWeight: .72, randomness: 6,
    cliffWeight: .3, waterMin: 2, waterMax: 6, waterWeight: .22,
    buildingMin: 4, buildingMax: 10, buildingWeight: .12,
  },
  "ancient-forest": {
    clusterSize: 7, centerSpacing: 5, clusterWeight: .86, randomness: 5.5,
    cliffMax: 4, cliffWeight: .5, waterMin: 2, waterMax: 6,
    waterWeight: .45, difficultBias: -.7, reliefBias: 1.2,
  },
  "desert-canyon": {
    clusterSize: 11, centerSpacing: 6, clusterWeight: .92, randomness: 5,
    cliffMax: 3, cliffWeight: 1.35, waterWeight: 0, heightIdeal: .62,
    heightWeight: .8, difficultBias: -.8, reliefBias: 2.8, cliffDropBias: 5,
    massChance: .11, cornerChance: .12, slabChance: .17,
  },
  badlands: {
    clusterSize: 10, centerSpacing: 5.5, clusterWeight: .88, randomness: 5.2,
    cliffMax: 4, cliffWeight: 1.15, waterWeight: 0, heightIdeal: .58,
    heightWeight: .7, difficultBias: -1, reliefBias: 3.2, cliffDropBias: 4,
    massChance: .1, cornerChance: .12, slabChance: .17,
  },
  volcanic: {
    clusterSize: 12, centerSpacing: 5, clusterWeight: .9, randomness: 4.8,
    cliffMax: 4, cliffWeight: .75, waterWeight: 0,
    lavaMin: 1, lavaMax: 4, lavaWeight: 1.45,
    heightIdeal: .66, heightWeight: 1, difficultBias: -1.1,
    reliefBias: 3.4, cliffDropBias: 3.5,
    massChance: .13, cornerChance: .13, slabChance: .18,
  },
  highlands: {
    clusterSize: 10, centerSpacing: 5.5, clusterWeight: .9, randomness: 4.8,
    cliffMax: 3, cliffWeight: 1.35, heightIdeal: .48, heightWeight: .6,
    difficultBias: -.75, reliefBias: 3.2, cliffDropBias: 5.5,
  },
  "mountain-pass": {
    clusterSize: 11, centerSpacing: 6, clusterWeight: .95, randomness: 4.6,
    cliffMax: 3, cliffWeight: 1.5, waterWeight: 0,
    heightIdeal: .42, heightWeight: .7, difficultBias: -.8,
    reliefBias: 3.5, cliffDropBias: 6,
  },
  underground: {
    clusterSize: 7, centerSpacing: 5.5, clusterWeight: 1.05, randomness: 6,
    cliffMax: 2, cliffWeight: 1.3, waterWeight: .15,
    difficultBias: -.8, reliefBias: 1.4, cliffDropBias: 0,
    maximumImmediate: 3, maximumLocal: 7,
  },
  sewer: {
    clusterSize: 5, centerSpacing: 5.5, clusterWeight: 1.05, randomness: 6,
    cliffMax: 2, cliffWeight: 1.35, waterMin: 1, waterMax: 3,
    waterWeight: .65, ravineWeight: 0, difficultBias: -.55,
    reliefBias: .5, cliffDropBias: 0,
    maximumImmediate: 2, maximumLocal: 5,
    massChance: .03, cornerChance: .08, slabChance: .14,
  },
  "frozen-lake": {
    clusterSize: 7, centerSpacing: 5, clusterWeight: .85, randomness: 5.5,
    cliffWeight: .4, waterMin: 1, waterMax: 4, waterWeight: 1.05,
    heightIdeal: .35, heightWeight: .6, difficultBias: -.55,
  },
  coast: {
    clusterSize: 8, centerSpacing: 5.5, clusterWeight: .86, randomness: 5.2,
    cliffMax: 4, cliffWeight: .7, waterMin: 1, waterMax: 3,
    waterWeight: 1, heightIdeal: .48, heightWeight: .5,
  },
  archipelago: {
    clusterSize: 7, centerSpacing: 4.5, clusterWeight: .9, randomness: 5,
    cliffWeight: .35, waterMin: 1, waterMax: 2, waterWeight: 1.25,
    heightIdeal: .45, heightWeight: .5,
  },
  river: {
    clusterSize: 6, centerSpacing: 5, clusterWeight: .82,
    waterMin: 1, waterMax: 3, waterWeight: .9, cliffWeight: .2,
  },
  wetlands: {
    clusterSize: 5, centerSpacing: 5, clusterWeight: .95, randomness: 6,
    cliffWeight: .15, waterMin: 1, waterMax: 2, waterWeight: .7,
    difficultBias: -.8, maximumImmediate: 2, maximumLocal: 5,
  },
  "ruined-battlefield": {
    clusterSize: 8, centerSpacing: 5, clusterWeight: .88,
    cliffWeight: .2, waterWeight: 0, buildingMin: 2, buildingMax: 7,
    buildingWeight: .8, difficultBias: -1.2, reliefBias: 2.2,
  },
  "ancient-ruins": {
    clusterSize: 7, centerSpacing: 4.5, clusterWeight: .86,
    cliffWeight: .25, buildingMin: 1, buildingMax: 4,
    buildingWeight: 1.05, difficultBias: -.75,
  },
  farmland: {
    clusterSize: 4, centerSpacing: 7, clusterWeight: .7, randomness: 6.5,
    cliffWeight: .1, waterWeight: .25, buildingMin: 4, buildingMax: 10,
    buildingWeight: .25, difficultBias: .3,
    maximumImmediate: 2, maximumLocal: 4,
  },
};

function rockEcology(mode: LandscapeMode) {
  return { ...DEFAULT_ROCK_ECOLOGY, ...ROCK_ECOLOGY[mode] };
}

export function scatterRocks(
  grid: Grid,
  target: number,
  random: Random,
  mode: LandscapeMode = "countryside",
) {
  if (target <= 0) return;
  const ecology = rockEcology(mode);
  const cliffDistance = cellDistancesFrom(
    grid,
    (tile) => tile.terrain === Terrain.Cliff,
  );
  const shoreDistance = cellDistancesFrom(
    grid,
    (tile) => tile.terrain === Terrain.Water ||
      (mode === "frozen-lake" && tile.terrain === Terrain.Ice),
  );
  const lavaDistance = cellDistancesFrom(grid, (tile) => tile.terrain === Terrain.Lava);
  const ravineDistance = cellDistancesFrom(grid, (tile) => tile.terrain === Terrain.Ravine);
  const buildingDistance = cellDistancesFrom(
    grid,
    (tile) => tile.obstacle === Obstacle.Building,
  );
  const candidates = grid.flatMap((row, y) =>
    row.map((tile, x) => {
      const habitatScore =
        bandPenalty(cliffDistance[y][x], ecology.cliffMin, ecology.cliffMax) *
          ecology.cliffWeight +
        bandPenalty(shoreDistance[y][x], ecology.waterMin, ecology.waterMax) *
          ecology.waterWeight +
        bandPenalty(lavaDistance[y][x], ecology.lavaMin, ecology.lavaMax) *
          ecology.lavaWeight +
        bandPenalty(ravineDistance[y][x], ecology.ravineMin, ecology.ravineMax) *
          ecology.ravineWeight +
        bandPenalty(
          buildingDistance[y][x],
          ecology.buildingMin,
          ecology.buildingMax,
        ) * ecology.buildingWeight +
        Math.abs((tile.height ?? .5) - ecology.heightIdeal) * ecology.heightWeight +
        (tile.terrain === Terrain.Difficult ? ecology.difficultBias : 0) -
        localRelief(grid, x, y) * ecology.reliefBias -
        dropBelowNearbyCliffs(grid, x, y) * ecology.cliffDropBias;
      return {
        tile,
        x,
        y,
        habitatScore,
        centerNoise: random() * ecology.randomness * 1.35,
        placementNoise: random() * ecology.randomness,
      };
    }).filter(({ tile }) =>
      !tileSurface(tile) &&
      tile.obstacle === Obstacle.None &&
      (tile.terrain === Terrain.Ground || tile.terrain === Terrain.Difficult),
    ),
  );
  if (!candidates.length) return;
  const centers = chooseHabitatCenters(
    candidates,
    target,
    ecology.clusterSize,
    ecology.centerSpacing,
    random,
  );
  const ranked = candidates.map((candidate) => ({
    ...candidate,
    score:
      candidate.habitatScore +
      distanceToHabitat(candidate, centers) * ecology.clusterWeight +
      candidate.placementNoise,
  })).sort((a, b) => a.score - b.score);
  const placed: Point[] = [];
  const placedKeys = new Set<string>();
  let rockId = 0;

  for (const candidate of ranked) {
    const immediateNeighbors = placed.filter((rock) =>
      Math.max(Math.abs(rock.x - candidate.x), Math.abs(rock.y - candidate.y)) <= 1
    ).length;
    const localRocks = placed.filter((rock) =>
      Math.max(Math.abs(rock.x - candidate.x), Math.abs(rock.y - candidate.y)) <= 2
    ).length;
    if (
      immediateNeighbors >= ecology.maximumImmediate ||
      localRocks >= ecology.maximumLocal
    ) {
      continue;
    }
    const roll = random();
    let footprint = roll < ecology.massChance
      ? [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }]
      : roll < ecology.massChance + ecology.cornerChance
        ? [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }]
        : roll < ecology.massChance + ecology.cornerChance + ecology.slabChance
          ? [{ x: 0, y: 0 }, { x: 1, y: 0 }]
          : [{ x: 0, y: 0 }];
    const turns = Math.floor(random() * 4);
    for (let turn = 0; turn < turns; turn += 1) {
      footprint = footprint.map(({ x, y }) => ({ x: -y, y: x }));
    }
    const points = footprint.map((offset) => ({
      x: candidate.x + offset.x,
      y: candidate.y + offset.y,
    }));
    const valid = points.every((point) => {
      const tile = grid[point.y]?.[point.x];
      return tile &&
        !tileSurface(tile) &&
        tile.obstacle === Obstacle.None &&
        !placedKeys.has(`${point.x},${point.y}`) &&
        (tile.terrain === Terrain.Ground || tile.terrain === Terrain.Difficult);
    });
    if (!valid || placed.length + points.length > target) {
      footprint = [{ x: 0, y: 0 }];
    }
    const anchor = grid[candidate.y]?.[candidate.x];
    if (
      !anchor || tileSurface(anchor) || anchor.obstacle !== Obstacle.None ||
      (anchor.terrain !== Terrain.Ground && anchor.terrain !== Terrain.Difficult)
    ) {
      continue;
    }
    const finalPoints = footprint.map((offset) => ({
      x: candidate.x + offset.x,
      y: candidate.y + offset.y,
    }));
    if (createsStraightObstacleRun(grid, finalPoints, Obstacle.Rock, 3)) continue;
    rockId += 1;
    for (const offset of footprint) {
      if (placed.length >= target) break;
      const point = { x: candidate.x + offset.x, y: candidate.y + offset.y };
      const tile = grid[point.y]?.[point.x];
      if (
        tile &&
        !tileSurface(tile) &&
        tile.obstacle === Obstacle.None &&
        (tile.terrain === Terrain.Ground || tile.terrain === Terrain.Difficult)
      ) {
        tile.obstacle = Obstacle.Rock;
        tile.obstacleId = rockId;
        placed.push(point);
        placedKeys.add(`${point.x},${point.y}`);
      }
    }
    if (placed.length >= target) break;
  }
}

interface TreeEcology {
  groveSize: number;
  centerSpacing: number;
  clusterWeight: number;
  randomness: number;
  waterMin: number;
  waterMax: number;
  waterWeight: number;
  cliffMin: number;
  cliffMax: number;
  cliffWeight: number;
  buildingMin: number;
  buildingMax: number;
  buildingWeight: number;
  surfaceMin: number;
  surfaceMax: number;
  surfaceWeight: number;
  edgeMin: number;
  edgeMax: number;
  edgeWeight: number;
  clearingMin: number;
  clearingMax: number;
  clearingWeight: number;
  heightIdeal: number;
  heightWeight: number;
  difficultBias: number;
  reliefPenalty: number;
  maximumImmediate: number;
  maximumLocal: number;
  largeTreeChance: number;
}

const DEFAULT_TREE_ECOLOGY: TreeEcology = {
  groveSize: 16,
  centerSpacing: 5.5,
  clusterWeight: .72,
  randomness: 6,
  waterMin: 2,
  waterMax: 7,
  waterWeight: .32,
  cliffMin: 2,
  cliffMax: 20,
  cliffWeight: .35,
  buildingMin: 3,
  buildingMax: 12,
  buildingWeight: 0,
  surfaceMin: 2,
  surfaceMax: 12,
  surfaceWeight: .1,
  edgeMin: 1,
  edgeMax: 20,
  edgeWeight: .15,
  clearingMin: 1,
  clearingMax: 4,
  clearingWeight: 0,
  heightIdeal: .38,
  heightWeight: .8,
  difficultBias: -.15,
  reliefPenalty: .8,
  maximumImmediate: 3,
  maximumLocal: 7,
  largeTreeChance: .14,
};

const TREE_ECOLOGY: Partial<Record<LandscapeMode, Partial<TreeEcology>>> = {
  "ancient-forest": {
    groveSize: 25, centerSpacing: 6, clusterWeight: .92, randomness: 4.5,
    waterMin: 1, waterMax: 5, waterWeight: .45,
    cliffMin: 2, cliffWeight: .25,
    clearingMin: 1, clearingMax: 3, clearingWeight: .38,
    heightIdeal: .4, heightWeight: .45, difficultBias: -.65,
    maximumImmediate: 6, maximumLocal: 13, largeTreeChance: .2,
  },
  wetlands: {
    groveSize: 9, centerSpacing: 4.5, clusterWeight: .98, randomness: 5,
    waterMin: 1, waterMax: 2, waterWeight: 1.4,
    cliffMin: 3, cliffWeight: .4,
    clearingMin: 1, clearingMax: 3, clearingWeight: .18,
    heightIdeal: .25, heightWeight: 1.8, difficultBias: -.9,
    maximumImmediate: 4, maximumLocal: 9, largeTreeChance: .1,
  },
  river: {
    groveSize: 12, centerSpacing: 5, clusterWeight: .75,
    waterMin: 1, waterMax: 3, waterWeight: 1,
    heightIdeal: .3, heightWeight: 1.2, difficultBias: -.3,
  },
  coast: {
    groveSize: 13, centerSpacing: 5.5, clusterWeight: .8,
    waterMin: 4, waterMax: 9, waterWeight: .9,
    edgeMin: 2, edgeWeight: .45,
    heightIdeal: .34, heightWeight: 1.1, reliefPenalty: 1.3,
  },
  archipelago: {
    groveSize: 11, centerSpacing: 4.5, clusterWeight: .82,
    waterMin: 2, waterMax: 4, waterWeight: 1.1,
    edgeMin: 1, edgeWeight: .2,
    heightIdeal: .36, heightWeight: .8,
    maximumImmediate: 4, maximumLocal: 9,
  },
  highlands: {
    groveSize: 10, centerSpacing: 6, clusterWeight: .9,
    waterMin: 3, waterMax: 10, waterWeight: .2,
    cliffMin: 3, cliffMax: 8, cliffWeight: .8,
    heightIdeal: .18, heightWeight: 4, reliefPenalty: 3.5,
    difficultBias: .2, maximumImmediate: 3, maximumLocal: 6,
  },
  "mountain-pass": {
    groveSize: 9, centerSpacing: 6, clusterWeight: .95,
    waterWeight: .1, cliffMin: 3, cliffMax: 7, cliffWeight: .9,
    heightIdeal: .16, heightWeight: 4.5, reliefPenalty: 4,
    difficultBias: .25, maximumImmediate: 3, maximumLocal: 6,
  },
  "desert-canyon": {
    groveSize: 6, centerSpacing: 4, clusterWeight: .8,
    waterMin: 1, waterMax: 2, waterWeight: 2.4,
    cliffMin: 3, cliffWeight: .8, heightIdeal: .2, heightWeight: 2,
    difficultBias: .4, maximumImmediate: 4, maximumLocal: 8,
  },
  "frozen-lake": {
    groveSize: 9, centerSpacing: 5, clusterWeight: .85,
    waterMin: 3, waterMax: 7, waterWeight: .8,
    cliffMin: 3, cliffWeight: .5, heightIdeal: .3, heightWeight: 1,
    difficultBias: .1, maximumImmediate: 3, maximumLocal: 6,
  },
  "ruined-battlefield": {
    groveSize: 7, centerSpacing: 5.5, clusterWeight: .9,
    waterWeight: .1, cliffWeight: .15,
    buildingMin: 2, buildingMax: 6, buildingWeight: 1.1,
    difficultBias: -1.3, heightWeight: .3,
    maximumImmediate: 3, maximumLocal: 6, largeTreeChance: .08,
  },
  "ancient-ruins": {
    groveSize: 11, centerSpacing: 4.5, clusterWeight: .86,
    waterMin: 2, waterMax: 6, waterWeight: .4,
    buildingMin: 1, buildingMax: 4, buildingWeight: 1.25,
    surfaceMin: 1, surfaceMax: 4, surfaceWeight: .3,
    difficultBias: -.75, maximumImmediate: 4, maximumLocal: 9,
  },
  farmland: {
    groveSize: 9, centerSpacing: 7, clusterWeight: .72, randomness: 6.5,
    waterMin: 2, waterMax: 6, waterWeight: .45,
    buildingMin: 4, buildingMax: 9, buildingWeight: .35,
    surfaceMin: 1, surfaceMax: 3, surfaceWeight: .42,
    edgeMin: 1, edgeMax: 4, edgeWeight: .35,
    difficultBias: .55, maximumImmediate: 2, maximumLocal: 5,
    largeTreeChance: .08,
  },
  countryside: {
    groveSize: 14, centerSpacing: 6, clusterWeight: .75,
    waterMin: 2, waterMax: 6, waterWeight: .5,
    buildingMin: 4, buildingMax: 10, buildingWeight: .2,
  },
  city: {
    groveSize: 5, centerSpacing: 5, clusterWeight: .45, randomness: 7,
    waterWeight: 0, cliffWeight: 0,
    buildingMin: 2, buildingMax: 4, buildingWeight: .55,
    surfaceMin: 1, surfaceMax: 2, surfaceWeight: .9,
    edgeWeight: 0, heightWeight: 0, difficultBias: 0,
    maximumImmediate: 1, maximumLocal: 3, largeTreeChance: 0,
  },
};

function treeEcology(mode: LandscapeMode) {
  return { ...DEFAULT_TREE_ECOLOGY, ...TREE_ECOLOGY[mode] };
}

function reserveOrganicClearing(
  grid: Grid,
  reserved: Set<string>,
  naturalClearings: Set<string>,
  center: Point,
  radiusX: number,
  radiusY: number,
  phase: number,
) {
  const left = Math.floor(center.x - radiusX - 1);
  const right = Math.ceil(center.x + radiusX + 1);
  const top = Math.floor(center.y - radiusY - 1);
  const bottom = Math.ceil(center.y + radiusY + 1);
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const tile = grid[y]?.[x];
      if (
        !tile || tileSurface(tile) || tile.obstacle !== Obstacle.None ||
        (tile.terrain !== Terrain.Ground && tile.terrain !== Terrain.Difficult)
      ) {
        continue;
      }
      const normalizedX = (x - center.x) / radiusX;
      const normalizedY = (y - center.y) / radiusY;
      const angle = Math.atan2(normalizedY, normalizedX);
      const wobble = 1 + Math.sin(angle * 3 + phase) * .13 +
        Math.sin(angle * 5 - phase * .7) * .07;
      if (Math.hypot(normalizedX, normalizedY) > wobble) continue;
      const key = `${x},${y}`;
      reserved.add(key);
      naturalClearings.add(key);
    }
  }
}

function reserveBiomeClearings(
  grid: Grid,
  target: number,
  waterDistance: number[][],
  mode: LandscapeMode,
  reserved: Set<string>,
  naturalClearings: Set<string>,
  random: Random,
) {
  const height = grid.length;
  const width = grid[0].length;
  if (mode === "ancient-forest" && target > width * height * .12) {
    const horizontal = width >= height;
    const longSize = horizontal ? width : height;
    const shortSize = horizontal ? height : width;
    const phase = random() * Math.PI * 2;
    for (let along = 0; along < longSize; along += 1) {
      const across = Math.round(
        shortSize * .5 + Math.sin(phase + along / Math.max(7, longSize / 4)) *
          shortSize * .1,
      );
      for (let offset = -1; offset <= 1; offset += 1) {
        const x = horizontal ? along : across + offset;
        const y = horizontal ? across + offset : along;
        const tile = grid[y]?.[x];
        if (!tile || tileSurface(tile) || tile.obstacle !== Obstacle.None) continue;
        const key = `${x},${y}`;
        reserved.add(key);
        naturalClearings.add(key);
      }
    }
  }

  if (mode !== "ancient-forest" && mode !== "wetlands") return;
  const possible = grid.flatMap((row, y) => row.map((tile, x) => ({
    tile,
    x,
    y,
    water: Number.isFinite(waterDistance[y][x]) ? waterDistance[y][x] : 12,
    noise: random() * 4,
  }))).filter(({ tile, x, y }) =>
    tile.obstacle === Obstacle.None && !tileSurface(tile) &&
    !reserved.has(`${x},${y}`) &&
    (tile.terrain === Terrain.Ground || tile.terrain === Terrain.Difficult),
  ).sort((a, b) => mode === "wetlands"
    ? b.water + a.noise - a.water - b.noise
    : a.noise - b.noise
  );
  const clearingCount = mode === "ancient-forest"
    ? Math.max(1, Math.min(3, Math.round(width * height / 420)))
    : Math.max(1, Math.min(2, Math.round(width * height / 600)));
  const centers: Point[] = [];
  for (const candidate of possible) {
    if (centers.some((center) =>
      Math.hypot(center.x - candidate.x, center.y - candidate.y) < 7
    )) {
      continue;
    }
    centers.push({ x: candidate.x, y: candidate.y });
    reserveOrganicClearing(
      grid,
      reserved,
      naturalClearings,
      candidate,
      mode === "ancient-forest" ? 2.3 + random() * 1.3 : 1.6 + random() * .8,
      mode === "ancient-forest" ? 1.9 + random() * 1.2 : 1.3 + random() * .7,
      random() * Math.PI * 2,
    );
    if (centers.length >= clearingCount) break;
  }
}

export function placeTrees(
  grid: Grid,
  target: number,
  waterDistance: number[][],
  random: Random,
  mode: LandscapeMode = "countryside",
) {
  if (target <= 0) return;
  const ecology = treeEcology(mode);
  const height = grid.length;
  const width = grid[0].length;
  const reserved = new Set<string>();
  const naturalClearings = new Set<string>();
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (tileSurface(grid[y][x])) reserved.add(`${x},${y}`);
    }
  }
  const effectiveWaterDistance = mode === "frozen-lake"
    ? cellDistancesFrom(
      grid,
      (tile) => tile.terrain === Terrain.Water || tile.terrain === Terrain.Ice,
    )
    : waterDistance;
  reserveBiomeClearings(
    grid,
    target,
    effectiveWaterDistance,
    mode,
    reserved,
    naturalClearings,
    random,
  );

  const cliffDistance = cellDistancesFrom(
    grid,
    (tile) => tile.terrain === Terrain.Cliff || tile.terrain === Terrain.Ravine,
  );
  const buildingDistance = cellDistancesFrom(
    grid,
    (tile) => tile.obstacle === Obstacle.Building,
  );
  const surfaceDistance = cellDistancesFrom(grid, (tile) => Boolean(tileSurface(tile)));
  const clearingDistance = cellDistancesFrom(
    grid,
    (_tile, x, y) => naturalClearings.has(`${x},${y}`),
  );
  const candidates = grid.flatMap((row, y) =>
    row.map((tile, x) => {
      const habitatScore =
        bandPenalty(
          effectiveWaterDistance[y][x], ecology.waterMin, ecology.waterMax,
        ) * ecology.waterWeight +
        bandPenalty(cliffDistance[y][x], ecology.cliffMin, ecology.cliffMax) *
          ecology.cliffWeight +
        bandPenalty(
          buildingDistance[y][x], ecology.buildingMin, ecology.buildingMax,
        ) * ecology.buildingWeight +
        bandPenalty(surfaceDistance[y][x], ecology.surfaceMin, ecology.surfaceMax) *
          ecology.surfaceWeight +
        bandPenalty(edgeDistance(grid, x, y), ecology.edgeMin, ecology.edgeMax) *
          ecology.edgeWeight +
        bandPenalty(
          clearingDistance[y][x], ecology.clearingMin, ecology.clearingMax,
        ) * ecology.clearingWeight +
        Math.abs((tile.height ?? .5) - ecology.heightIdeal) * ecology.heightWeight +
        (tile.terrain === Terrain.Difficult ? ecology.difficultBias : 0) +
        localRelief(grid, x, y) * ecology.reliefPenalty;
      return {
        tile,
        x,
        y,
        habitatScore,
        centerNoise: random() * ecology.randomness * 1.25,
        placementNoise: random() * ecology.randomness,
      };
    }).filter(({ tile, x, y }) =>
      tile.obstacle === Obstacle.None &&
      !tileSurface(tile) &&
      !reserved.has(`${x},${y}`) &&
      (tile.terrain === Terrain.Ground || tile.terrain === Terrain.Difficult),
    ),
  );
  if (!candidates.length) return;

  const centers = chooseHabitatCenters(
    candidates,
    target,
    ecology.groveSize,
    ecology.centerSpacing,
    random,
  );
  const ranked = candidates.map((candidate) => ({
    ...candidate,
    score:
      candidate.habitatScore +
      distanceToHabitat(candidate, centers) * ecology.clusterWeight +
      candidate.placementNoise,
  })).sort((a, b) => a.score - b.score);
  const placed: Point[] = [];
  const placedKeys = new Set<string>();
  let treeId = 0;
  for (const { x, y } of ranked) {
    if (reserved.has(`${x},${y}`)) continue;
    const immediate = placed.filter((tree) =>
      Math.max(Math.abs(tree.x - x), Math.abs(tree.y - y)) <= 1
    ).length;
    const local = placed.filter((tree) =>
      Math.max(Math.abs(tree.x - x), Math.abs(tree.y - y)) <= 2
    ).length;
    if (immediate >= ecology.maximumImmediate || local >= ecology.maximumLocal) continue;
    let footprint = [{ x, y }];
    if (random() < ecology.largeTreeChance && target - placed.length >= 4) {
      const directionX = x < width - 1 ? 1 : -1;
      const directionY = y < height - 1 ? 1 : -1;
      footprint = [
        { x, y }, { x: x + directionX, y },
        { x, y: y + directionY }, { x: x + directionX, y: y + directionY },
      ];
    }
    const valid = footprint.every((point) => {
      const tile = grid[point.y]?.[point.x];
      return tile &&
        tile.obstacle === Obstacle.None &&
        !reserved.has(`${point.x},${point.y}`) &&
        !tileSurface(tile) &&
        (tile.terrain === Terrain.Ground || tile.terrain === Terrain.Difficult) &&
        !placedKeys.has(`${point.x},${point.y}`);
    });
    if (!valid) {
      footprint = [{ x, y }];
      const tile = grid[y]?.[x];
      if (
        !tile || tile.obstacle !== Obstacle.None || tileSurface(tile) ||
        reserved.has(`${x},${y}`) || placedKeys.has(`${x},${y}`) ||
        (tile.terrain !== Terrain.Ground && tile.terrain !== Terrain.Difficult)
      ) {
        continue;
      }
    }
    const maximumStraightRun = mode === "farmland" || mode === "city" ? 5 : 3;
    if (
      createsStraightObstacleRun(
        grid,
        footprint,
        Obstacle.Tree,
        maximumStraightRun,
      )
    ) {
      continue;
    }
    treeId += 1;
    for (const point of footprint) {
      grid[point.y][point.x].obstacle = Obstacle.Tree;
      grid[point.y][point.x].obstacleId = treeId;
      placed.push(point);
      placedKeys.add(`${point.x},${point.y}`);
    }
    if (placed.length >= target) break;
  }
}

export function placeBuildings(
  grid: Grid,
  count: number,
  random: Random,
  allowPartyWalls = false,
) {
  const height = grid.length;
  const width = grid[0].length;
  const roadCells = grid.flatMap((row, y) =>
    row.map((tile, x) => ({ tile, x, y }))
      .filter(({ tile }) => tileSurface(tile) === Terrain.Road),
  );
  const sizes = [
    { width: 4, height: 3 }, { width: 3, height: 3 },
    { width: 4, height: 2 }, { width: 2, height: 3 },
    { width: 3, height: 2 }, { width: 2, height: 2 },
    // Compact battlefields may not have room for another full house after
    // terrain and spacing are accounted for. These are only considered once
    // every regular footprint is exhausted.
    { width: 2, height: 1 }, { width: 1, height: 2 },
    { width: 1, height: 1 },
  ];
  const existingIds = grid.flatMap((row) => row)
    .filter((tile) => tile.obstacle === Obstacle.Building)
    .map((tile) => tile.obstacleId ?? 0);
  const firstBuildingId = Math.max(0, ...existingIds) + 1;

  const distanceToRoad = (x: number, y: number, buildingWidth: number, buildingHeight: number) => {
    if (!roadCells.length) return 5;
    const centerX = x + (buildingWidth - 1) / 2;
    const centerY = y + (buildingHeight - 1) / 2;
    return Math.min(...roadCells.map((road) =>
      Math.abs(road.x - centerX) + Math.abs(road.y - centerY)
    ));
  };

  for (let placed = 0; placed < count; placed += 1) {
    const candidates: Array<{
      x: number;
      y: number;
      width: number;
      height: number;
      score: number;
    }> = [];
    for (const size of sizes) {
      for (let y = 1; y <= height - size.height - 1; y += 1) {
        for (let x = 1; x <= width - size.width - 1; x += 1) {
          let available = true;
          for (let tileY = y; tileY < y + size.height && available; tileY += 1) {
            for (let tileX = x; tileX < x + size.width; tileX += 1) {
              const tile = grid[tileY][tileX];
              if (
                tile.obstacle !== Obstacle.None ||
                tileSurface(tile) ||
                (tile.terrain !== Terrain.Ground && tile.terrain !== Terrain.Difficult)
              ) {
                available = false;
                break;
              }
            }
          }
          if (!available) continue;
          let touchesBuilding = false;
          for (let tileY = y - 1; tileY <= y + size.height; tileY += 1) {
            for (let tileX = x - 1; tileX <= x + size.width; tileX += 1) {
              if (grid[tileY]?.[tileX]?.obstacle === Obstacle.Building) {
                touchesBuilding = true;
              }
            }
          }
          if (touchesBuilding && !allowPartyWalls) continue;
          const area = size.width * size.height;
          candidates.push({
            x,
            y,
            ...size,
            score:
              distanceToRoad(x, y, size.width, size.height) * 1.35 -
              area * .28 +
              random() * 5,
          });
        }
      }
    }
    const preferredArea = candidates.some(({ width, height }) => width * height >= 4)
      ? 4
      : candidates.some(({ width, height }) => width * height >= 2) ? 2 : 1;
    const selected = candidates
      .filter(({ width, height }) => width * height >= preferredArea)
      .sort((a, b) => a.score - b.score)[0];
    if (!selected) break;
    const buildingId = firstBuildingId + placed;
    for (let y = selected.y; y < selected.y + selected.height; y += 1) {
      for (let x = selected.x; x < selected.x + selected.width; x += 1) {
        grid[y][x].obstacle = Obstacle.Building;
        grid[y][x].obstacleId = buildingId;
      }
    }
  }
}
