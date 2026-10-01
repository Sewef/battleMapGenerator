import { Delaunay } from "d3-delaunay";
import {
  Terrain,
  type Grid,
  type TerrainKind,
} from "../domain/map";
import { paintTerrain } from "./pipeline";
import type { Point, Random } from "./types";

export interface RegionMap {
  centers: Point[];
  neighbors: number[][];
  cells: Point[][];
  cellRegion: number[][];
}

const liquidTerrainPolicy = {
  preserve: new Set<TerrainKind>([Terrain.Water, Terrain.Lava]),
};

export function shuffled<T>(values: readonly T[], random: Random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

export function buildRegionMap(
  width: number,
  height: number,
  scale: number,
  random: Random,
): RegionMap {
  const targetCount = Math.max(
    18,
    Math.round((width * height) / (scale * 2.2)),
  );
  const columns = Math.max(
    4,
    Math.round(Math.sqrt(targetCount * width / height)),
  );
  const rows = Math.max(3, Math.round(targetCount / columns));
  let centers: Point[] = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      centers.push({
        x: (column + .18 + random() * .64) * width / columns,
        y: (row + .18 + random() * .64) * height / rows,
      });
    }
  }

  // Two Lloyd relaxation passes prevent tiny cells without creating a
  // perfectly regular mosaic.
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const diagram = Delaunay.from(centers.map(({ x, y }) => [x, y]))
      .voronoi([0, 0, width, height]);
    centers = centers.map((center, index) => {
      const polygon = diagram.cellPolygon(index);
      if (!polygon?.length) return center;
      const points = polygon.slice(0, -1);
      return {
        x: points.reduce((sum, point) => sum + point[0], 0) / points.length,
        y: points.reduce((sum, point) => sum + point[1], 0) / points.length,
      };
    });
  }

  const delaunay = Delaunay.from(centers.map(({ x, y }) => [x, y]));
  const neighbors = centers.map((_, index) => [...delaunay.neighbors(index)]);
  const cells: Point[][] = centers.map(() => []);
  const cellRegion = Array.from(
    { length: height },
    () => Array<number>(width).fill(0),
  );
  let previousRegion = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      previousRegion = delaunay.find(x + .5, y + .5, previousRegion);
      cellRegion[y][x] = previousRegion;
      cells[previousRegion].push({ x, y });
    }
  }
  return { centers, neighbors, cells, cellRegion };
}

export function selectConnectedRegions(
  map: RegionMap,
  targetCells: number,
  random: Random,
  allowed: (region: number) => boolean,
  preferredSeeds?: number[],
  preference?: (region: number) => number,
): Set<number> {
  const preferred = preferredSeeds?.filter(allowed);
  const possibleSeeds = (preferred?.length
    ? preferred
    : map.cells.map((_, index) => index)).filter(allowed);
  if (!possibleSeeds.length || targetCells <= 0) return new Set();
  const seed = preference
    ? possibleSeeds.map((region) => ({
      region,
      score: preference(region) + random() * .35,
    })).sort((a, b) => b.score - a.score)[0].region
    : possibleSeeds[Math.floor(random() * possibleSeeds.length)];
  const selected = new Set([seed]);
  const frontier = new Set(map.neighbors[seed].filter(allowed));
  let size = map.cells[seed].length;

  while (size < targetCells && frontier.size) {
    let best = -1;
    let bestScore = -Infinity;
    for (const candidate of frontier) {
      const touching = map.neighbors[candidate]
        .filter((neighbor) => selected.has(neighbor)).length;
      const score = touching * 1.4 + random() * 2 +
        (preference?.(candidate) ?? 0) * 2.4;
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    frontier.delete(best);
    selected.add(best);
    size += map.cells[best].length;
    for (const neighbor of map.neighbors[best]) {
      if (!selected.has(neighbor) && allowed(neighbor)) frontier.add(neighbor);
    }
  }
  return selected;
}

export function regionHeight(grid: Grid, map: RegionMap, region: number) {
  const cells = map.cells[region];
  if (!cells.length) return .5;
  return cells.reduce(
    (sum, { x, y }) => sum + (grid[y][x].height ?? .5),
    0,
  ) / cells.length;
}

export function preferredRegion(
  regions: number[],
  preference: (region: number) => number,
  random: Random,
) {
  return regions.map((region) => ({
    region,
    score: preference(region) + random() * .25,
  })).sort((a, b) => b.score - a.score)[0]?.region;
}

export function paintRegions(
  grid: Grid,
  map: RegionMap,
  regions: Set<number>,
  terrain: TerrainKind,
) {
  for (const region of regions) {
    for (const { x, y } of map.cells[region]) {
      paintTerrain(grid[y][x], terrain);
    }
  }
}

export function distanceFromRegions(map: RegionMap, sources: Set<number>) {
  const distances = map.cells.map(() => Infinity);
  const queue = [...sources];
  for (const source of sources) distances[source] = 0;
  for (let index = 0; index < queue.length; index += 1) {
    const region = queue[index];
    for (const neighbor of map.neighbors[region]) {
      if (distances[neighbor] === Infinity) {
        distances[neighbor] = distances[region] + 1;
        queue.push(neighbor);
      }
    }
  }
  return distances;
}

export function shortestRegionPath(
  map: RegionMap,
  start: number,
  end: number,
  random: Random,
  allowed: (region: number) => boolean = () => true,
  preference?: (region: number) => number,
) {
  const previous = map.cells.map(() => -1);
  const queue = [start];
  previous[start] = start;
  for (
    let index = 0;
    index < queue.length && previous[end] === -1;
    index += 1
  ) {
    const region = queue[index];
    const next = shuffled(map.neighbors[region], random);
    if (preference) next.sort((a, b) => preference(b) - preference(a));
    for (const neighbor of next) {
      if (previous[neighbor] === -1 && allowed(neighbor)) {
        previous[neighbor] = region;
        queue.push(neighbor);
      }
    }
  }
  if (previous[end] === -1) return [];
  const path = [end];
  while (path[0] !== start && previous[path[0]] !== -1) {
    path.unshift(previous[path[0]]);
  }
  return path;
}

export type MapEdge = "left" | "right" | "top" | "bottom";

export function edgeRegions(
  map: RegionMap,
  width: number,
  height: number,
  side: MapEdge,
) {
  return map.centers
    .map((center, index) => ({ center, index }))
    .filter(({ center }) => {
      if (side === "left") return center.x < width * .18;
      if (side === "right") return center.x > width * .82;
      if (side === "top") return center.y < height * .18;
      return center.y > height * .82;
    })
    .map(({ index }) => index);
}

export function boundaryRegions(
  map: RegionMap,
  width: number,
  height: number,
) {
  return new Set(map.cells
    .map((cells, region) => ({ cells, region }))
    .filter(({ cells }) => cells.some(({ x, y }) =>
      x === 0 || y === 0 || x === width - 1 || y === height - 1
    ))
    .map(({ region }) => region));
}

export function drawRegionPath(
  grid: Grid,
  map: RegionMap,
  path: number[],
  terrain: TerrainKind,
  thickness: number,
) {
  const points = path.map((region) => map.centers[region]);
  let previousCell: Point | undefined;
  const paintSingleCell = (x: number, y: number) => {
    const tile = grid[y]?.[x];
    if (tile && tile.terrain !== Terrain.Water && tile.terrain !== Terrain.Lava) {
      paintTerrain(tile, terrain, liquidTerrainPolicy);
    }
  };
  const paintCell = (centerX: number, centerY: number) => {
    for (let offsetY = -thickness; offsetY <= thickness; offsetY += 1) {
      for (let offsetX = -thickness; offsetX <= thickness; offsetX += 1) {
        if (
          thickness > 0 &&
          offsetX * offsetX + offsetY * offsetY >
            (thickness + .35) * (thickness + .35)
        ) {
          continue;
        }
        paintSingleCell(centerX + offsetX, centerY + offsetY);
      }
    }
  };

  for (let index = 0; index < points.length - 1; index += 1) {
    const point0 = points[Math.max(0, index - 1)];
    const point1 = points[index];
    const point2 = points[index + 1];
    const point3 = points[Math.min(points.length - 1, index + 2)];
    const distance = Math.hypot(point2.x - point1.x, point2.y - point1.y);
    const steps = Math.max(2, Math.ceil(distance * 4));
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      const x = Math.round(.5 * (
        2 * point1.x +
        (-point0.x + point2.x) * t +
        (2 * point0.x - 5 * point1.x + 4 * point2.x - point3.x) * t2 +
        (-point0.x + 3 * point1.x - 3 * point2.x + point3.x) * t3
      ));
      const y = Math.round(.5 * (
        2 * point1.y +
        (-point0.y + point2.y) * t +
        (2 * point0.y - 5 * point1.y + 4 * point2.y - point3.y) * t2 +
        (-point0.y + 3 * point1.y - 3 * point2.y + point3.y) * t3
      ));

      if (previousCell && previousCell.x !== x && previousCell.y !== y) {
        paintCell(x, previousCell.y);
      }
      paintCell(x, y);

      if (terrain === Terrain.Ravine) {
        const phase = (index + t) * 1.18 + path[0] * .73;
        const widthWave = Math.sin(phase);
        const extraWidth = widthWave > .38 ? 2 : widthWave > -.38 ? 1 : 0;
        if (extraWidth > 0) {
          const directionX = point2.x - point0.x;
          const directionY = point2.y - point0.y;
          const normal = Math.abs(directionX) >= Math.abs(directionY)
            ? { x: 0, y: 1 }
            : { x: 1, y: 0 };
          const distanceFromCenter = thickness + 1;
          paintSingleCell(
            x + normal.x * distanceFromCenter,
            y + normal.y * distanceFromCenter,
          );
          if (extraWidth > 1) {
            paintSingleCell(
              x - normal.x * distanceFromCenter,
              y - normal.y * distanceFromCenter,
            );
          }
        }
      }
      previousCell = { x, y };
    }
  }
}

export function pathAcrossMap(
  map: RegionMap,
  width: number,
  height: number,
  horizontal: boolean,
  random: Random,
  allowed: (region: number) => boolean = () => true,
  preference?: (region: number) => number,
) {
  const starts = edgeRegions(
    map,
    width,
    height,
    horizontal ? "left" : "top",
  ).filter(allowed);
  const ends = edgeRegions(
    map,
    width,
    height,
    horizontal ? "right" : "bottom",
  ).filter(allowed);
  if (!starts.length || !ends.length) return [];
  const choose = (regions: number[]) => preference
    ? regions.map((region) => ({
      region,
      score: preference(region) + random() * .2,
    })).sort((a, b) => b.score - a.score)[0].region
    : regions[Math.floor(random() * regions.length)];
  return shortestRegionPath(
    map,
    choose(starts),
    choose(ends),
    random,
    allowed,
    preference,
  );
}
