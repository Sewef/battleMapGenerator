import {
  Obstacle,
  Terrain,
  tileSurface,
  type Grid,
  type LandscapeMode,
} from "../domain/map";
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

export function scatterRocks(grid: Grid, target: number, random: Random) {
  const candidates = grid.flatMap((row, y) =>
    row.map((tile, x) => {
      let nearbyCliffs = 0;
      for (let offsetY = -2; offsetY <= 2; offsetY += 1) {
        for (let offsetX = -2; offsetX <= 2; offsetX += 1) {
          if (grid[y + offsetY]?.[x + offsetX]?.terrain === Terrain.Cliff) {
            nearbyCliffs += 1;
          }
        }
      }
      return {
        tile,
        x,
        y,
        score: random() - Math.min(.55, nearbyCliffs * .045),
      };
    })
      .filter(({ tile }) =>
        !tileSurface(tile) &&
        (tile.terrain === Terrain.Ground || tile.terrain === Terrain.Difficult),
      ),
  ).sort((a, b) => a.score - b.score);
  const placed: Point[] = [];
  const placedKeys = new Set<string>();
  let rockId = 0;

  for (const candidate of candidates) {
    const immediateNeighbors = placed.filter((rock) =>
      Math.max(Math.abs(rock.x - candidate.x), Math.abs(rock.y - candidate.y)) <= 1
    ).length;
    const localRocks = placed.filter((rock) =>
      Math.max(Math.abs(rock.x - candidate.x), Math.abs(rock.y - candidate.y)) <= 2
    ).length;
    // Natural scree forms loose clusters. The previous blanket two-cell
    // exclusion produced a regular polka-dot pattern and routinely missed the
    // requested density on mountainous maps.
    if (immediateNeighbors >= 4 || localRocks >= 9) continue;
    const roll = random();
    let footprint = roll < .08
      ? [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }]
      : roll < .16
        ? [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }]
        : roll < .28
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

export function placeTrees(
  grid: Grid,
  target: number,
  waterDistance: number[][],
  random: Random,
  mode: LandscapeMode = "countryside",
) {
  const height = grid.length;
  const width = grid[0].length;
  const reserved = new Set<string>();
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (tileSurface(grid[y][x])) reserved.add(`${x},${y}`);
    }
  }

  // Dense woods still need a legible clearing through the battlefield. Keep
  // it as natural ground rather than painting a road, and give it a gentle
  // bend so it does not read as another grid line.
  if (mode === "ancient-forest" && target > width * height * .12) {
    const horizontal = width >= height;
    const longSize = horizontal ? width : height;
    const shortSize = horizontal ? height : width;
    const phase = random() * Math.PI * 2;
    for (let along = 0; along < longSize; along += 1) {
      const across = Math.round(
        shortSize * .5 + Math.sin(phase + along / Math.max(7, longSize / 4)) * shortSize * .1,
      );
      for (let offset = -1; offset <= 1; offset += 1) {
        const x = horizontal ? along : across + offset;
        const y = horizontal ? across + offset : along;
        if (grid[y]?.[x]) reserved.add(`${x},${y}`);
      }
    }
  }

  const candidates = grid.flatMap((row, y) =>
    row.map((tile, x) => ({ tile, x, y }))
      .filter(({ tile }) =>
        tile.obstacle === Obstacle.None &&
        !tileSurface(tile) &&
        (tile.terrain === Terrain.Ground || tile.terrain === Terrain.Difficult),
      ),
  );
  if (!candidates.length || target <= 0) return;

  const centerCount = Math.max(1, Math.round(target / 22));
  const centers: Point[] = [];
  const wetCandidates = candidates
    .map((candidate) => {
      const wet = Number.isFinite(waterDistance[candidate.y][candidate.x])
        ? waterDistance[candidate.y][candidate.x]
        : 10;
      return { ...candidate, score: wet + random() * 12 };
    })
    .sort((a, b) => a.score - b.score);
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
      const elevationPenalty =
        mode === "highlands" || mode === "mountain-pass"
          ? (candidate.tile.height ?? 0) * 2.4
          : 0;
      const waterAffinity = mode === "wetlands" || mode === "ancient-forest"
        ? wetness * .55
        : wetness;
      return {
        ...candidate,
        score:
          groveDistance * .8 +
          waterAffinity +
          elevationPenalty +
          random() * 7,
      };
    })
    .sort((a, b) => a.score - b.score);
  const placed: Point[] = [];
  const placedKeys = new Set<string>();
  const maximumImmediate = mode === "ancient-forest"
    ? 5
    : mode === "wetlands" ? 4 : 3;
  let treeId = 0;
  for (const { x, y } of ranked) {
    if (reserved.has(`${x},${y}`)) continue;
    const immediate = placed.filter((tree) =>
      Math.max(Math.abs(tree.x - x), Math.abs(tree.y - y)) <= 1
    ).length;
    const local = placed.filter((tree) =>
      Math.max(Math.abs(tree.x - x), Math.abs(tree.y - y)) <= 2
    ).length;
    if (immediate >= maximumImmediate || local >= maximumImmediate * 2 + 1) continue;
    let footprint = [{ x, y }];
    const sizeRoll = random();
    if (sizeRoll < .14 && target - placed.length >= 4) {
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
        !reserved.has(`${point.x},${point.y}`) &&
        !tileSurface(tile) &&
        (tile.terrain === Terrain.Ground || tile.terrain === Terrain.Difficult) &&
        !placedKeys.has(`${point.x},${point.y}`);
    });
    if (!valid) {
      footprint = [{ x, y }];
      const tile = grid[y]?.[x];
      if (
        !tile ||
        tile.obstacle !== Obstacle.None ||
        tileSurface(tile) ||
        reserved.has(`${x},${y}`) ||
        placedKeys.has(`${x},${y}`) ||
        (tile.terrain !== Terrain.Ground && tile.terrain !== Terrain.Difficult)
      ) {
        continue;
      }
    }
    if (footprint.some((point) => reserved.has(`${point.x},${point.y}`))) continue;
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
