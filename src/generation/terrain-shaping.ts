import {
  Terrain,
  tileSurface,
  type Grid,
  type TerrainKind,
  type TerrainOptions,
  type Tile,
} from "../domain/map";
import { cellDistancesFromWater } from "./obstacles";
import type { Point, Random } from "./types";

export interface TerrainMorphologyOptions {
  passes?: number;
  replacement?: TerrainKind;
  preserveMapEdge?: boolean;
  preferHighGround?: boolean;
}

/**
 * Breaks the shared Voronoi silhouette after region selection. Large features
 * keep their topology, while their boundary follows the multi-scale height
 * field and acquires irregular shoulders and small promontories.
 */
export function morphTerrainMass(
  grid: Grid,
  terrain: TerrainKind,
  random: Random,
  options: TerrainMorphologyOptions = {},
) {
  const replacement = options.replacement ?? Terrain.Ground;
  const passes = options.passes ?? 2;
  for (let pass = 0; pass < passes; pass += 1) {
    const snapshot = grid.map((row) => row.map((tile) => tile.terrain));
    const next = snapshot.map((row) => [...row]);
    for (let y = 0; y < grid.length; y += 1) {
      for (let x = 0; x < grid[y].length; x += 1) {
        const atMapEdge = x === 0 || y === 0 ||
          x === grid[y].length - 1 || y === grid.length - 1;
        if (atMapEdge && options.preserveMapEdge) continue;
        const current = snapshot[y][x];
        if (current !== terrain && current !== replacement) continue;
        let cardinal = 0;
        let nearby = 0;
        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
          for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
            if (!offsetX && !offsetY) continue;
            if (snapshot[y + offsetY]?.[x + offsetX] === terrain) {
              nearby += 1;
              if (!offsetX || !offsetY) cardinal += 1;
            }
          }
        }
        const elevation = grid[y][x].height ?? .5;
        const preference = options.preferHighGround ? elevation : 1 - elevation;
        if (current !== terrain) {
          const supportedExpansion = cardinal >= 2 && nearby >= 4;
          const shoulderExpansion = cardinal === 1 && nearby >= 3;
          const expansionChance = supportedExpansion
            ? .32 + preference * .38
            : .1 + preference * .16;
          if (
            (supportedExpansion || shoulderExpansion) &&
            random() < expansionChance
          ) {
            next[y][x] = terrain;
          }
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

function paintTerrainDisk(
  grid: Grid,
  center: Point,
  radius: number,
  terrain: TerrainKind,
  allowed: ReadonlySet<TerrainKind>,
  opening?: { x: number; y: number },
) {
  for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
    for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
      if (offsetX * offsetX + offsetY * offsetY > (radius + .25) ** 2) continue;
      if (
        opening &&
        Math.sign(offsetX) === opening.x &&
        Math.sign(offsetY) === opening.y &&
        Math.abs(offsetX) + Math.abs(offsetY) >= radius
      ) {
        continue;
      }
      const tile = grid[center.y + offsetY]?.[center.x + offsetX];
      if (tile && allowed.has(tile.terrain) && !tileSurface(tile)) {
        tile.terrain = terrain;
      }
    }
  }
}

function landmarkCenter(
  grid: Grid,
  random: Random,
  allowed: ReadonlySet<TerrainKind>,
  margin = 4,
  matches: (tile: Tile, x: number, y: number) => boolean = () => true,
) {
  const candidates = grid.flatMap((row, y) =>
    row.map((tile, x) => ({ tile, x, y }))
      .filter(({ tile, x, y }) =>
        x >= margin && y >= margin &&
        x < grid[0].length - margin && y < grid.length - margin &&
        allowed.has(tile.terrain) && !tileSurface(tile) && matches(tile, x, y)
      )
  );
  return candidates.length
    ? candidates[Math.floor(random() * candidates.length)]
    : undefined;
}

export function addBiomeLandmark(
  grid: Grid,
  options: TerrainOptions,
  random: Random,
) {
  const { mode } = options;
  const ground = new Set<TerrainKind>([Terrain.Ground, Terrain.Difficult]);
  if (mode === "countryside" && options.waterWeight > 0 && random() < .48) {
    const center = landmarkCenter(grid, random, ground, 5);
    if (center) {
      paintTerrainDisk(grid, center, 2, Terrain.Beach, ground);
      paintTerrainDisk(grid, center, 1, Terrain.Water, new Set([Terrain.Beach]));
    }
    return;
  }
  if (mode === "coast" && options.waterWeight > 0 && random() < .52) {
    const waterDistance = cellDistancesFromWater(grid);
    const center = landmarkCenter(
      grid,
      random,
      ground,
      5,
      (_tile, x, y) => waterDistance[y][x] >= 2 && waterDistance[y][x] <= 4,
    );
    if (center) paintTerrainDisk(grid, center, 2, Terrain.Beach, ground);
    return;
  }
  if (
    (mode === "badlands" || mode === "highlands") &&
    options.reliefWeight > 0 &&
    random() < .62
  ) {
    const center = landmarkCenter(grid, random, ground, 5);
    if (center) {
      paintTerrainDisk(
        grid,
        center,
        2,
        Terrain.Cliff,
        ground,
        { x: random() > .5 ? 1 : -1, y: 0 },
      );
    }
    return;
  }
  if (mode === "wetlands" && random() < .66) {
    const center = landmarkCenter(grid, random, new Set([Terrain.Water]), 4);
    if (center) {
      paintTerrainDisk(grid, center, 1, Terrain.Ground, new Set([Terrain.Water]));
    }
    return;
  }
  if (mode === "frozen-lake" && random() < .58) {
    const center = landmarkCenter(grid, random, new Set([Terrain.Ice]), 4);
    if (center) {
      paintTerrainDisk(grid, center, 1, Terrain.Water, new Set([Terrain.Ice]));
    }
    return;
  }
  if (mode === "volcanic" && options.waterWeight > 0 && random() < .72) {
    const center = landmarkCenter(grid, random, ground, 5);
    if (!center) return;
    paintTerrainDisk(grid, center, 2, Terrain.Difficult, ground);
    const directions = [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ];
    const first = directions[Math.floor(random() * directions.length)];
    const turns = first.x
      ? [{ x: 0, y: 1 }, { x: 0, y: -1 }]
      : [{ x: 1, y: 0 }, { x: -1, y: 0 }];
    const second = turns[Math.floor(random() * turns.length)];
    for (const offset of [{ x: 0, y: 0 }, first, second]) {
      const tile = grid[center.y + offset.y]?.[center.x + offset.x];
      if (
        tile && !tileSurface(tile) &&
        (tile.terrain === Terrain.Ground || tile.terrain === Terrain.Difficult)
      ) {
        tile.terrain = Terrain.Lava;
      }
    }
  }
}
