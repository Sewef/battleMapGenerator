import { Obstacle, Terrain, type Grid } from "../domain/map";
import type { Point, Random } from "./types";

export function cellDistancesFromWater(grid: Grid): number[][] {
  const distances = grid.map((row) => row.map(() => Infinity));
  const queue: Point[] = [];
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[0].length; x += 1) {
      if (grid[y][x].terrain === Terrain.Water) {
        distances[y][x] = 0;
        queue.push({ x, y });
      }
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
      .sort((a, b) => {
        const wetA = Number.isFinite(waterDistance[a.y][a.x]) ? waterDistance[a.y][a.x] : 8;
        const wetB = Number.isFinite(waterDistance[b.y][b.x]) ? waterDistance[b.y][b.x] : 8;
        return (wetA + random() * 8) - (wetB + random() * 8);
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
    .sort((a, b) => {
      const wetA = Number.isFinite(waterDistance[a.y][a.x]) ? waterDistance[a.y][a.x] : 8;
      const wetB = Number.isFinite(waterDistance[b.y][b.x]) ? waterDistance[b.y][b.x] : 8;
      return (wetA + random() * 16) - (wetB + random() * 16);
    });
  for (const { x, y } of remaining.slice(0, Math.max(0, target - placed.size))) {
    placed.add(`${x},${y}`);
  }
  for (const key of placed) {
    const [x, y] = key.split(",").map(Number);
    grid[y][x].terrain = Terrain.Difficult;
  }
}

export function scatterRocks(grid: Grid, target: number, random: Random) {
  const candidates = grid.flatMap((row, y) =>
    row.map((tile, x) => ({ tile, x, y, score: random() }))
      .filter(({ tile }) =>
        tile.terrain === Terrain.Ground || tile.terrain === Terrain.Difficult,
      ),
  ).sort((a, b) => a.score - b.score);
  const placed: Point[] = [];
  let rockId = 0;

  for (const candidate of candidates) {
    const nearExisting = placed.some((rock) =>
      Math.abs(rock.x - candidate.x) <= 2 && Math.abs(rock.y - candidate.y) <= 2,
    );
    if (nearExisting) continue;
    const outcropSize = random() < .18 ? 2 + Math.floor(random() * 3) : 1;
    rockId += 1;
    let point = { x: candidate.x, y: candidate.y };
    for (let index = 0; index < outcropSize && placed.length < target; index += 1) {
      const tile = grid[point.y]?.[point.x];
      if (
        tile &&
        tile.obstacle === Obstacle.None &&
        (tile.terrain === Terrain.Ground || tile.terrain === Terrain.Difficult)
      ) {
        tile.obstacle = Obstacle.Rock;
        tile.obstacleId = rockId;
        placed.push(point);
      }
      const directions = [
        { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
      ];
      const direction = directions[Math.floor(random() * directions.length)];
      point = { x: point.x + direction.x, y: point.y + direction.y };
    }
    if (placed.length >= target) break;
  }
}

export function placeTrees(
  grid: Grid,
  target: number,
  waterDistance: number[][],
  random: Random,
) {
  const candidates = grid.flatMap((row, y) =>
    row.map((tile, x) => ({ tile, x, y }))
      .filter(({ tile }) =>
        tile.obstacle === Obstacle.None &&
        (tile.terrain === Terrain.Ground || tile.terrain === Terrain.Difficult),
      ),
  );
  if (!candidates.length || target <= 0) return;

  const centerCount = Math.max(1, Math.round(target / 22));
  const centers: Point[] = [];
  const wetCandidates = [...candidates].sort((a, b) => {
    const wetA = Number.isFinite(waterDistance[a.y][a.x]) ? waterDistance[a.y][a.x] : 10;
    const wetB = Number.isFinite(waterDistance[b.y][b.x]) ? waterDistance[b.y][b.x] : 10;
    return (wetA + random() * 12) - (wetB + random() * 12);
  });
  for (const candidate of wetCandidates) {
    if (centers.every((center) => Math.hypot(center.x - candidate.x, center.y - candidate.y) > 5)) {
      centers.push({ x: candidate.x, y: candidate.y });
      if (centers.length >= centerCount) break;
    }
  }

  const ranked = candidates
    .map((candidate) => {
      const groveDistance = Math.min(...centers.map((center) =>
        Math.hypot(center.x - candidate.x, center.y - candidate.y),
      ));
      const wetness = Number.isFinite(waterDistance[candidate.y][candidate.x])
        ? Math.min(8, waterDistance[candidate.y][candidate.x]) * .18
        : 1.4;
      return { ...candidate, score: groveDistance * .8 + wetness + random() * 7 };
    })
    .sort((a, b) => a.score - b.score);
  const placed: Point[] = [];
  let treeId = 0;
  for (const { x, y } of ranked) {
    if (placed.some((tree) => Math.abs(tree.x - x) <= 1 && Math.abs(tree.y - y) <= 1)) {
      continue;
    }
    let footprint = [{ x, y }];
    const sizeRoll = random();
    if (sizeRoll < .14) {
      const directionX = x < grid[0].length - 1 ? 1 : -1;
      const directionY = y < grid.length - 1 ? 1 : -1;
      footprint = [
        { x, y }, { x: x + directionX, y },
        { x, y: y + directionY }, { x: x + directionX, y: y + directionY },
      ];
    }
    const valid = footprint.every((point) => {
      const tile = grid[point.y]?.[point.x];
      return tile &&
        tile.obstacle === Obstacle.None &&
        (tile.terrain === Terrain.Ground || tile.terrain === Terrain.Difficult) &&
        !placed.some((tree) =>
          Math.abs(tree.x - point.x) <= 1 && Math.abs(tree.y - point.y) <= 1
        );
    });
    if (!valid) footprint = [{ x, y }];
    treeId += 1;
    for (const point of footprint) {
      grid[point.y][point.x].obstacle = Obstacle.Tree;
      grid[point.y][point.x].obstacleId = treeId;
      placed.push(point);
    }
    if (placed.length >= target) break;
  }
}

export function placeBuildings(grid: Grid, count: number, random: Random) {
  const height = grid.length;
  const width = grid[0].length;
  let placed = 0;
  let attempts = 0;
  while (placed < count && attempts < count * 100) {
    attempts += 1;
    const buildingWidth = 2 + Math.floor(random() * 3);
    const buildingHeight = 2 + Math.floor(random() * 2);
    const startX = 1 + Math.floor(random() * Math.max(1, width - buildingWidth - 2));
    const startY = 1 + Math.floor(random() * Math.max(1, height - buildingHeight - 2));
    let available = true;
    for (let y = startY - 1; y <= startY + buildingHeight; y += 1) {
      for (let x = startX - 1; x <= startX + buildingWidth; x += 1) {
        const tile = grid[y]?.[x];
        if (!tile || tile.terrain !== Terrain.Ground || tile.obstacle !== Obstacle.None) {
          available = false;
        }
      }
    }
    if (!available) continue;
    placed += 1;
    for (let y = startY; y < startY + buildingHeight; y += 1) {
      for (let x = startX; x < startX + buildingWidth; x += 1) {
        grid[y][x].obstacle = Obstacle.Building;
        grid[y][x].obstacleId = placed;
      }
    }
  }
}
