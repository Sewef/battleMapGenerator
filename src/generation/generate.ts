import { Delaunay } from "d3-delaunay";
import {
  Obstacle,
  Terrain,
  isInteriorMode,
  setTileSurface,
  tileSurface,
  type Grid,
  type LandscapeMode,
  type TerrainKind,
  type TerrainOptions,
  type Tile,
} from "../domain/map";
import { seededRandom } from "./random";
import type { Point, Random } from "./types";
import {
  cellDistancesFromWater,
  placeBuildings,
  placeTrees,
  scatterDifficultTerrain,
  scatterRocks,
} from "./obstacles";
import { generateCity } from "./city";
import { generateInterior } from "./interior";
import {
  generateAncientRuins,
  generateBattlefield,
  generateFarmland,
  generateSewer,
} from "./special-biomes";
import {
  BIOME_RECIPES,
  assignHeightField,
  connectPointsOfInterest,
  normalizeGenerationOptions,
  paintTerrain,
  smoothTerrain,
  validateAndRepairGrid,
} from "./pipeline";

interface RegionMap {
  centers: Point[];
  neighbors: number[][];
  cells: Point[][];
  cellRegion: number[][];
}

const liquidTerrainPolicy = {
  preserve: new Set<TerrainKind>([Terrain.Water, Terrain.Lava]),
};

function shuffled<T>(values: readonly T[], random: Random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

function buildRegionMap(width: number, height: number, scale: number, random: Random): RegionMap {
  const targetCount = Math.max(18, Math.round((width * height) / (scale * 2.2)));
  const columns = Math.max(4, Math.round(Math.sqrt(targetCount * width / height)));
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
    const diagram = Delaunay.from(centers.map(({ x, y }) => [x, y])).voronoi([0, 0, width, height]);
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
  const cellRegion = Array.from({ length: height }, () => Array(width).fill(0));
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

function selectConnectedRegions(
  map: RegionMap,
  targetCells: number,
  random: Random,
  allowed: (region: number) => boolean,
  preferredSeeds?: number[],
  preference?: (region: number) => number,
): Set<number> {
  const possibleSeeds = (preferredSeeds?.filter(allowed).length ? preferredSeeds : map.cells.map((_, index) => index))
    ?.filter(allowed) ?? [];
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
      const touching = map.neighbors[candidate].filter((neighbor) => selected.has(neighbor)).length;
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

function regionHeight(grid: Grid, map: RegionMap, region: number) {
  const cells = map.cells[region];
  if (!cells.length) return .5;
  return cells.reduce((sum, { x, y }) => sum + (grid[y][x].height ?? .5), 0) /
    cells.length;
}

function preferredRegion(
  regions: number[],
  preference: (region: number) => number,
  random: Random,
) {
  return regions.map((region) => ({
    region,
    score: preference(region) + random() * .25,
  })).sort((a, b) => b.score - a.score)[0]?.region;
}

function paintRegions(grid: Grid, map: RegionMap, regions: Set<number>, terrain: TerrainKind) {
  for (const region of regions) {
    for (const { x, y } of map.cells[region]) paintTerrain(grid[y][x], terrain);
  }
}

interface TerrainMorphologyOptions {
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
function morphTerrainMass(
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

function addBiomeLandmark(
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
    if (center) paintTerrainDisk(grid, center, 1, Terrain.Ground, new Set([Terrain.Water]));
    return;
  }
  if (mode === "frozen-lake" && random() < .58) {
    const center = landmarkCenter(grid, random, new Set([Terrain.Ice]), 4);
    if (center) paintTerrainDisk(grid, center, 1, Terrain.Water, new Set([Terrain.Ice]));
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

function distanceFromRegions(map: RegionMap, sources: Set<number>): number[] {
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

function shortestRegionPath(
  map: RegionMap,
  start: number,
  end: number,
  random: Random,
  allowed: (region: number) => boolean = () => true,
  preference?: (region: number) => number,
): number[] {
  const previous = map.cells.map(() => -1);
  const queue = [start];
  previous[start] = start;
  for (let index = 0; index < queue.length && previous[end] === -1; index += 1) {
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
  while (path[0] !== start && previous[path[0]] !== -1) path.unshift(previous[path[0]]);
  return path;
}

function edgeRegions(map: RegionMap, width: number, height: number, side: "left" | "right" | "top" | "bottom") {
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

function boundaryRegions(map: RegionMap, width: number, height: number) {
  return new Set(map.cells
    .map((cells, region) => ({ cells, region }))
    .filter(({ cells }) => cells.some(({ x, y }) =>
      x === 0 || y === 0 || x === width - 1 || y === height - 1
    ))
    .map(({ region }) => region));
}

function drawRegionPath(
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
    if (
      tile &&
      tile.terrain !== Terrain.Water &&
      tile.terrain !== Terrain.Lava
    ) {
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

      // Fill the inside corner when rasterization changes both coordinates at
      // once. This keeps the surface connected without changing its curve.
      if (previousCell && previousCell.x !== x && previousCell.y !== y) {
        paintCell(x, previousCell.y);
      }
      paintCell(x, y);

      if (terrain === Terrain.Ravine) {
        const phase = (index + t) * 1.18 + path[0] * .73;
        const widthWave = Math.sin(phase);
        const extraWidth = widthWave > .38
          ? 2
          : widthWave > -.38 ? 1 : 0;
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

function pathAcrossMap(
  map: RegionMap,
  width: number,
  height: number,
  horizontal: boolean,
  random: Random,
  allowed: (region: number) => boolean = () => true,
  preference?: (region: number) => number,
) {
  const starts = edgeRegions(map, width, height, horizontal ? "left" : "top").filter(allowed);
  const ends = edgeRegions(map, width, height, horizontal ? "right" : "bottom").filter(allowed);
  if (!starts.length || !ends.length) return [];
  const choose = (regions: number[]) => preference
    ? regions.map((region) => ({
      region,
      score: preference(region) + random() * .2,
    })).sort((a, b) => b.score - a.score)[0].region
    : regions[Math.floor(random() * regions.length)];
  const start = choose(starts);
  const end = choose(ends);
  return shortestRegionPath(map, start, end, random, allowed, preference);
}

function connectedWaterComponents(grid: Grid) {
  const visited = new Set<string>();
  const components: Point[][] = [];
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[0].length; x += 1) {
      const startKey = `${x},${y}`;
      if (visited.has(startKey) || grid[y][x].terrain !== Terrain.Water) continue;
      const queue = [{ x, y }];
      const component: Point[] = [];
      visited.add(startKey);
      for (let index = 0; index < queue.length; index += 1) {
        const point = queue[index];
        component.push(point);
        for (const [offsetX, offsetY] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const next = { x: point.x + offsetX, y: point.y + offsetY };
          const key = `${next.x},${next.y}`;
          if (
            visited.has(key) ||
            grid[next.y]?.[next.x]?.terrain !== Terrain.Water
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
  return components.sort((a, b) => b.length - a.length);
}

function coastalEdgeConnector(
  grid: Grid,
  first: readonly Point[],
  second: readonly Point[],
) {
  const width = grid[0].length;
  const height = grid.length;
  const sides = [
    { includes: ({ y }: Point) => y === 0, coordinate: ({ x }: Point) => x,
      point: (coordinate: number) => ({ x: coordinate, y: 0 }) },
    { includes: ({ x }: Point) => x === width - 1, coordinate: ({ y }: Point) => y,
      point: (coordinate: number) => ({ x: width - 1, y: coordinate }) },
    { includes: ({ y }: Point) => y === height - 1, coordinate: ({ x }: Point) => x,
      point: (coordinate: number) => ({ x: coordinate, y: height - 1 }) },
    { includes: ({ x }: Point) => x === 0, coordinate: ({ y }: Point) => y,
      point: (coordinate: number) => ({ x: 0, y: coordinate }) },
  ];
  let best: { distance: number; start: number; end: number; side: typeof sides[number] } |
    undefined;
  for (const side of sides) {
    const firstCoordinates = first.filter(side.includes).map(side.coordinate);
    const secondCoordinates = second.filter(side.includes).map(side.coordinate);
    for (const start of firstCoordinates) {
      for (const end of secondCoordinates) {
        const distance = Math.abs(start - end);
        if (!best || distance < best.distance) best = { distance, start, end, side };
      }
    }
  }
  if (!best) return undefined;
  const step = Math.sign(best.end - best.start);
  return Array.from({ length: best.distance + 1 }, (_, index) =>
    best!.side.point(best!.start + step * index));
}

function inlandCoastalConnector(
  grid: Grid,
  first: readonly Point[],
  second: readonly Point[],
) {
  let nearest: { distance: number; first: Point; second: Point } | undefined;
  for (const firstPoint of first) {
    for (const secondPoint of second) {
      const distance = Math.abs(firstPoint.x - secondPoint.x) +
        Math.abs(firstPoint.y - secondPoint.y);
      if (!nearest || distance < nearest.distance) {
        nearest = { distance, first: firstPoint, second: secondPoint };
      }
    }
  }
  if (!nearest) return [];
  const makePath = (horizontalFirst: boolean) => {
    const corner = horizontalFirst
      ? { x: nearest!.second.x, y: nearest!.first.y }
      : { x: nearest!.first.x, y: nearest!.second.y };
    const result: Point[] = [];
    for (const [from, to] of [[nearest!.first, corner], [corner, nearest!.second]]) {
      const stepX = Math.sign(to.x - from.x);
      const stepY = Math.sign(to.y - from.y);
      const distance = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
      for (let step = 0; step <= distance; step += 1) {
        result.push({ x: from.x + stepX * step, y: from.y + stepY * step });
      }
    }
    return result;
  };
  const candidates = [makePath(true), makePath(false)];
  const edgeDistance = ({ x, y }: Point) => Math.min(
    x,
    y,
    grid[0].length - 1 - x,
    grid.length - 1 - y,
  );
  return candidates.sort((a, b) =>
    a.reduce((sum, point) => sum + edgeDistance(point), 0) -
    b.reduce((sum, point) => sum + edgeDistance(point), 0)
  )[0];
}

function ensureSingleCoastalSea(grid: Grid) {
  for (let guard = 0; guard < grid.length * grid[0].length; guard += 1) {
    const components = connectedWaterComponents(grid);
    if (components.length <= 1) return;
    const main = components[0];
    const secondary = components[1];
    const edgeConnector = coastalEdgeConnector(grid, main, secondary);
    if (edgeConnector) {
      for (const point of edgeConnector) grid[point.y][point.x].terrain = Terrain.Water;
      continue;
    }
    if (secondary.length <= Math.max(18, main.length * .12)) {
      for (const point of secondary) grid[point.y][point.x].terrain = Terrain.Ground;
      continue;
    }
    for (const point of inlandCoastalConnector(grid, main, secondary)) {
      grid[point.y][point.x].terrain = Terrain.Water;
    }
  }
}

function paintShore(grid: Grid, random: Random, maxDepth: number) {
  const waterDistance = cellDistancesFromWater(grid);
  const beach: Point[] = [];
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[0].length; x += 1) {
      if (grid[y][x].terrain !== Terrain.Ground) continue;
      const distance = waterDistance[y][x];
      if (distance === 1 || (distance <= maxDepth && random() < .78 / distance)) {
        beach.push({ x, y });
      }
    }
  }
  for (const { x, y } of beach) grid[y][x].terrain = Terrain.Beach;
}

function paintCompactArchipelago(
  grid: Grid,
  landTarget: number,
  random: Random,
) {
  const height = grid.length;
  const width = grid[0].length;
  const clampStart = (value: number, size: number) =>
    Math.max(1, Math.min(size - 3, Math.round(value)));
  const anchors = [
    { x: clampStart(width * .2, width), y: clampStart(height * .18, height) },
    { x: clampStart(width * .72, width), y: clampStart(height * .18, height) },
    { x: clampStart(width * .2, width), y: clampStart(height * .68, height) },
    { x: clampStart(width * .72, width), y: clampStart(height * .68, height) },
  ];
  const key = ({ x, y }: Point) => `${x},${y}`;
  const islands = anchors.map(({ x, y }) => new Set([
    `${x},${y}`, `${x + 1},${y}`,
    `${x},${y + 1}`, `${x + 1},${y + 1}`,
  ]));
  const owners = new Map<string, number>();
  islands.forEach((island, owner) => island.forEach((cell) => owners.set(cell, owner)));
  const targetPerIsland = Math.max(4, Math.round(landTarget / 4));
  const dividerX = [Math.floor((width - 1) / 2), Math.ceil((width - 1) / 2)];
  const dividerY = [Math.floor((height - 1) / 2), Math.ceil((height - 1) / 2)];
  const reservedForOcean = ({ x, y }: Point) =>
    dividerX.includes(x) || dividerY.includes(y);
  const directions = [
    { x: 1, y: 0 }, { x: -1, y: 0 },
    { x: 0, y: 1 }, { x: 0, y: -1 },
  ];
  let progressed = true;
  while (progressed && islands.some((island) => island.size < targetPerIsland)) {
    progressed = false;
    islands.forEach((island, owner) => {
      if (island.size >= targetPerIsland) return;
      const frontier = new Map<string, Point>();
      for (const cell of island) {
        const [x, y] = cell.split(",").map(Number);
        for (const direction of directions) {
          const point = { x: x + direction.x, y: y + direction.y };
          if (
            point.x <= 0 || point.y <= 0 ||
            point.x >= width - 1 || point.y >= height - 1 ||
            reservedForOcean(point) ||
            owners.has(key(point))
          ) {
            continue;
          }
          frontier.set(key(point), point);
        }
      }
      const candidates = [...frontier.values()]
        .filter((point) => directions.every((direction) => {
          const neighborOwner = owners.get(`${point.x + direction.x},${point.y + direction.y}`);
          return neighborOwner === undefined || neighborOwner === owner;
        }))
        .map((point) => ({
          point,
          score:
            directions.filter((direction) =>
              island.has(`${point.x + direction.x},${point.y + direction.y}`)
            ).length * 1.6 -
            Math.hypot(point.x - anchors[owner].x, point.y - anchors[owner].y) * .08 +
            random() * 2,
        }))
        .sort((a, b) => b.score - a.score);
      const selected = candidates[0]?.point;
      if (!selected) return;
      island.add(key(selected));
      owners.set(key(selected), owner);
      progressed = true;
    });
  }
  for (const cell of owners.keys()) {
    const [x, y] = cell.split(",").map(Number);
    grid[y][x].terrain = Terrain.Ground;
  }

  // A compact blob can very rarely curl around one water cell. Fill only
  // enclosed basins so the surrounding ocean remains a single component.
  const visited = new Set<string>();
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (grid[y][x].terrain !== Terrain.Water || visited.has(`${x},${y}`)) continue;
      const queue = [{ x, y }];
      const component: Point[] = [];
      let touchesEdge = false;
      visited.add(`${x},${y}`);
      for (let index = 0; index < queue.length; index += 1) {
        const point = queue[index];
        component.push(point);
        if (point.x === 0 || point.y === 0 || point.x === width - 1 || point.y === height - 1) {
          touchesEdge = true;
        }
        for (const direction of directions) {
          const next = { x: point.x + direction.x, y: point.y + direction.y };
          const nextKey = key(next);
          if (
            visited.has(nextKey) ||
            grid[next.y]?.[next.x]?.terrain !== Terrain.Water
          ) {
            continue;
          }
          visited.add(nextKey);
          queue.push(next);
        }
      }
      if (!touchesEdge) {
        for (const point of component) grid[point.y][point.x].terrain = Terrain.Ground;
      }
    }
  }
}

/**
 * Produces an inertial line sampled from outside one edge to outside the
 * opposite edge. Unlike a graph path, it cannot stop inside the map or make
 * abrupt turns.
 */
function meanderingCrossing(
  grid: Grid,
  horizontal: boolean,
  random: Random,
  width: number | [number, number],
  paint: (tile: Tile) => TerrainKind,
  widthIsDiameter = false,
  lowlandBias = 0,
): Point[] {
  const longSize = horizontal ? grid[0].length : grid.length;
  const shortSize = horizontal ? grid.length : grid[0].length;
  const [minimumWidth, maximumWidth] = Array.isArray(width) ? width : [width, width];
  const maximumRadius = widthIsDiameter
    ? Math.ceil((maximumWidth - 1) / 2)
    : maximumWidth;
  let currentWidth = minimumWidth;
  let targetWidth = minimumWidth;
  let across = shortSize * (.3 + random() * .4);
  let velocity = (random() - .5) * .25;
  const centerline: Point[] = [];
  let previousCenter: Point | undefined;

  for (let along = -2; along <= longSize + 1; along += 1) {
    if (along % 6 === 0) {
      targetWidth = minimumWidth + Math.floor(random() * (maximumWidth - minimumWidth + 1));
    }
    currentWidth += Math.sign(targetWidth - currentWidth) * Math.min(.34, Math.abs(targetWidth - currentWidth));
    const paintedWidth = Math.round(currentWidth);
    const minimumOffset = widthIsDiameter
      ? -Math.floor((paintedWidth - 1) / 2)
      : -paintedWidth;
    const maximumOffset = widthIsDiameter
      ? Math.ceil((paintedWidth - 1) / 2)
      : paintedWidth;
    if (random() < .28) velocity += (random() - .5) * .22;
    if (lowlandBias > 0 && along >= 0 && along < longSize) {
      const candidates = [-1, 0, 1]
        .map((offset) => {
          const short = Math.round(across + offset);
          const tile = horizontal
            ? grid[short]?.[along]
            : grid[along]?.[short];
          return { offset, height: tile?.height ?? Infinity };
        })
        .filter(({ height }) => Number.isFinite(height))
        .sort((a, b) => a.height - b.height);
      velocity += (candidates[0]?.offset ?? 0) * .1 * lowlandBias;
    }
    velocity *= .82;
    velocity = Math.max(-.42, Math.min(.42, velocity));
    across += velocity;
    if (across < maximumRadius + 1 || across > shortSize - maximumRadius - 2) {
      velocity *= -1;
      across = Math.max(
        maximumRadius + 1,
        Math.min(shortSize - maximumRadius - 2, across),
      );
    }
    const center = horizontal
      ? { x: along, y: Math.round(across) }
      : { x: Math.round(across), y: along };
    centerline.push(center);

    // When the centerline shifts by one cell, paint the inside of the turn as
    // well. Without this orthogonal link, consecutive cells only meet at a
    // corner and both generation and rendering perceive a broken network.
    if (previousCenter) {
      if (horizontal && previousCenter.y !== center.y) {
        const startY = Math.min(previousCenter.y, center.y);
        const endY = Math.max(previousCenter.y, center.y);
        for (let connectorY = startY; connectorY <= endY; connectorY += 1) {
          for (let offset = minimumOffset; offset <= maximumOffset; offset += 1) {
            const tile = grid[connectorY + offset]?.[center.x];
            if (tile) {
              const terrain = paint(tile);
              if (terrain === Terrain.Road || terrain === Terrain.Bridge) {
                setTileSurface(tile, terrain);
              } else {
                tile.terrain = terrain;
              }
            }
          }
        }
      } else if (!horizontal && previousCenter.x !== center.x) {
        const startX = Math.min(previousCenter.x, center.x);
        const endX = Math.max(previousCenter.x, center.x);
        for (let connectorX = startX; connectorX <= endX; connectorX += 1) {
          for (let offset = minimumOffset; offset <= maximumOffset; offset += 1) {
            const tile = grid[center.y]?.[connectorX + offset];
            if (tile) {
              const terrain = paint(tile);
              if (terrain === Terrain.Road || terrain === Terrain.Bridge) {
                setTileSurface(tile, terrain);
              } else {
                tile.terrain = terrain;
              }
            }
          }
        }
      }
    }
    for (let offset = minimumOffset; offset <= maximumOffset; offset += 1) {
      const point = horizontal
        ? { x: center.x, y: center.y + offset }
        : { x: center.x + offset, y: center.y };
      const tile = grid[point.y]?.[point.x];
      if (tile) {
        const terrain = paint(tile);
        if (terrain === Terrain.Road || terrain === Terrain.Bridge) {
          setTileSurface(tile, terrain);
        } else {
          tile.terrain = terrain;
        }
      }
    }
    previousCenter = center;
  }
  return centerline;
}

function drawRoadCrossing(grid: Grid, horizontal: boolean, random: Random) {
  return meanderingCrossing(
    grid,
    horizontal,
    random,
    [1, 3],
    (tile) =>
      tile.terrain === Terrain.Water ||
        tile.terrain === Terrain.Ravine ||
        tile.surface === Terrain.Bridge
        ? Terrain.Bridge
        : Terrain.Road,
    true,
  );
}

function drawTrailCrossing(grid: Grid, horizontal: boolean, random: Random) {
  return meanderingCrossing(
    grid,
    horizontal,
    random,
    1,
    (tile) =>
      tile.terrain === Terrain.Water ||
        tile.terrain === Terrain.Ravine ||
        tile.surface === Terrain.Bridge
        ? Terrain.Bridge
        : Terrain.Road,
    true,
  );
}

function addLiquidTributary(
  grid: Grid,
  terrain: typeof Terrain.Water | typeof Terrain.Lava,
  random: Random,
) {
  const directions = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ];
  const sources: Array<Point & { exits: Point[] }> = [];
  for (let y = 3; y < grid.length - 3; y += 1) {
    for (let x = 3; x < grid[y].length - 3; x += 1) {
      if (grid[y][x].terrain !== terrain) continue;
      const exits = directions.filter((direction) => {
        const neighbor = grid[y + direction.y]?.[x + direction.x];
        return neighbor &&
          neighbor.terrain !== terrain &&
          neighbor.terrain !== Terrain.Cliff &&
          neighbor.terrain !== Terrain.Void;
      });
      if (exits.length) sources.push({ x, y, exits });
    }
  }
  if (!sources.length) return;
  const source = sources[Math.floor(random() * sources.length)];
  let direction = source.exits[Math.floor(random() * source.exits.length)];
  let point = { x: source.x, y: source.y };
  const length = 5 + Math.floor(random() * 9);
  let paintedNewCells = 0;
  for (let step = 0; step < length; step += 1) {
    if (step > 1 && random() < .2) {
      const turns = direction.x
        ? { x: 0, y: random() > .5 ? 1 : -1 }
        : { x: random() > .5 ? 1 : -1, y: 0 };
      const turnTile = grid[point.y + turns.y]?.[point.x + turns.x];
      if (
        turnTile && turnTile.terrain !== Terrain.Cliff &&
        turnTile.terrain !== Terrain.Void
      ) {
        direction = turns;
      }
    }
    const next = { x: point.x + direction.x, y: point.y + direction.y };
    const tile = grid[next.y]?.[next.x];
    if (!tile || tile.terrain === Terrain.Cliff || tile.terrain === Terrain.Void) break;
    if (tile.terrain === terrain && paintedNewCells > 0) break;
    if (tile.terrain !== terrain) paintedNewCells += 1;
    tile.terrain = terrain;
    if (tileSurface(tile) === Terrain.Road) setTileSurface(tile, Terrain.Bridge);
    point = next;
  }
}

function hasRoadNetwork(grid: Grid) {
  return grid.some((row) => row.some((tile) =>
    tileSurface(tile) === Terrain.Road || tileSurface(tile) === Terrain.Bridge
  ));
}

function trailOrientationAcrossLiquid(grid: Grid, random: Random) {
  const lastY = grid.length - 1;
  const lastX = grid[0].length - 1;
  const verticalFlowExits = grid[0].filter((tile) => tile.terrain === Terrain.Water).length +
    grid[lastY].filter((tile) => tile.terrain === Terrain.Water).length;
  let horizontalFlowExits = 0;
  for (const row of grid) {
    if (row[0].terrain === Terrain.Water) horizontalFlowExits += 1;
    if (row[lastX].terrain === Terrain.Water) horizontalFlowExits += 1;
  }
  if (verticalFlowExits === horizontalFlowExits) return random() > .5;
  // A horizontal trail crosses a predominantly north-south watercourse, and
  // vice versa, avoiding long boardwalks that simply follow the channel.
  return verticalFlowExits > horizontalFlowExits;
}

function maybeAddBiomeTrail(
  grid: Grid,
  mode: LandscapeMode,
  random: Random,
) {
  if (hasRoadNetwork(grid)) return;
  const chance: Partial<Record<LandscapeMode, number>> = {
    "ancient-forest": .58,
    "frozen-lake": .42,
    badlands: .62,
    wetlands: .4,
    "ancient-ruins": .72,
  };
  if (random() >= (chance[mode] ?? 0)) return;
  drawTrailCrossing(grid, trailOrientationAcrossLiquid(grid, random), random);
}

function addRoadSpurs(grid: Grid, random: Random, requested: number) {
  const roadCells = grid.flatMap((row, y) =>
    row.map((tile, x) => ({ tile, x, y }))
      .filter(({ tile }) => tileSurface(tile) === Terrain.Road)
  );
  if (!roadCells.length) return;
  const directions = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ];
  for (let spur = 0; spur < requested; spur += 1) {
    const source = roadCells[Math.floor(random() * roadCells.length)];
    const leftNeighbor = grid[source.y]?.[source.x - 1];
    const rightNeighbor = grid[source.y]?.[source.x + 1];
    const horizontalRoad =
      (leftNeighbor && tileSurface(leftNeighbor) === Terrain.Road) ||
      (rightNeighbor && tileSurface(rightNeighbor) === Terrain.Road);
    let direction = horizontalRoad
      ? directions[2 + Math.floor(random() * 2)]
      : directions[Math.floor(random() * 2)];
    let point = { x: source.x, y: source.y };
    const length = 4 + Math.floor(random() * 8);
    for (let step = 0; step < length; step += 1) {
      if (step > 1 && random() < .24) {
        const turns = direction.x
          ? [{ x: 0, y: 1 }, { x: 0, y: -1 }]
          : [{ x: 1, y: 0 }, { x: -1, y: 0 }];
        direction = turns[Math.floor(random() * turns.length)];
      }
      const next = { x: point.x + direction.x, y: point.y + direction.y };
      const tile = grid[next.y]?.[next.x];
      if (
        !tile ||
        tile.obstacle === Obstacle.Building ||
        tile.terrain === Terrain.Lava ||
        tile.terrain === Terrain.Void ||
        tile.terrain === Terrain.Wall ||
        tile.terrain === Terrain.Cliff
      ) {
        break;
      }
      const existingSurface = tileSurface(tile);
      if (step > 2 && (existingSurface === Terrain.Road || existingSurface === Terrain.Bridge)) {
        break;
      }
      setTileSurface(
        tile,
        tile.terrain === Terrain.Water || tile.terrain === Terrain.Ravine
          ? Terrain.Bridge
          : Terrain.Road,
      );
      point = next;
    }
  }
}

function assignCliffElevations(grid: Grid) {
  const distances = grid.map((row) => row.map(() => Infinity));
  const queue: Point[] = [];
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      const tile = grid[y][x];
      delete tile.elevation;
      if (tile.terrain !== Terrain.Cliff) continue;
      const touchesLowerTerrain = [
        grid[y - 1]?.[x],
        grid[y + 1]?.[x],
        grid[y]?.[x - 1],
        grid[y]?.[x + 1],
      ].some((neighbor) => neighbor && neighbor.terrain !== Terrain.Cliff);
      if (touchesLowerTerrain) {
        distances[y][x] = 0;
        queue.push({ x, y });
      }
    }
  }
  for (let index = 0; index < queue.length; index += 1) {
    const { x, y } = queue[index];
    for (const [offsetX, offsetY] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nextX = x + offsetX;
      const nextY = y + offsetY;
      if (
        grid[nextY]?.[nextX]?.terrain !== Terrain.Cliff ||
        distances[nextY][nextX] <= distances[y][x] + 1
      ) {
        continue;
      }
      distances[nextY][nextX] = distances[y][x] + 1;
      queue.push({ x: nextX, y: nextY });
    }
  }
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      if (grid[y][x].terrain !== Terrain.Cliff) continue;
      const distance = Number.isFinite(distances[y][x]) ? distances[y][x] : 0;
      const height = grid[y][x].height ?? .5;
      const distanceRelief = Math.min(1, distance / 4);
      const relief = height * .72 + distanceRelief * .28;
      const desiredElevation = relief >= .68 ? 3 : relief >= .47 ? 2 : 1;
      // A tall tier must have enough cliff mass in front of it to read as a
      // terrace. Without this cap, height noise could put elevation 3 directly
      // on the outer edge and stack two faces on the exact same silhouette.
      grid[y][x].elevation = Math.min(desiredElevation, distance + 1, 3);
    }
  }

  // Height can still produce a low pocket beside a much taller inner cell.
  // Relax only the taller side so cardinal neighbours never jump by two tiers;
  // preserving the lower edge keeps the visible foot of the cliff grounded.
  for (let pass = 0; pass < 2; pass += 1) {
    const next = grid.map((row) => row.map((tile) => tile.elevation));
    for (let y = 0; y < grid.length; y += 1) {
      for (let x = 0; x < grid[y].length; x += 1) {
        const tile = grid[y][x];
        if (tile.terrain !== Terrain.Cliff) continue;
        const lowerNeighbor = [
          grid[y - 1]?.[x],
          grid[y + 1]?.[x],
          grid[y]?.[x - 1],
          grid[y]?.[x + 1],
        ].filter((neighbor) => neighbor?.terrain === Terrain.Cliff)
          .reduce(
            (minimum, neighbor) => Math.min(minimum, neighbor?.elevation ?? 1),
            tile.elevation ?? 1,
          );
        next[y][x] = Math.min(tile.elevation ?? 1, lowerNeighbor + 1);
      }
    }
    for (let y = 0; y < grid.length; y += 1) {
      for (let x = 0; x < grid[y].length; x += 1) {
        if (grid[y][x].terrain === Terrain.Cliff) {
          grid[y][x].elevation = next[y][x];
        }
      }
    }
  }
}

function drawCoastalRoad(grid: Grid, random: Random) {
  const waterDistance = cellDistancesFromWater(grid);
  const minimumClearance = 4;
  const preferredClearance = minimumClearance + 1;
  const safeTargets = grid.map((row, y) => {
    const safeX = waterDistance[y].findIndex((distance, x) =>
      distance >= preferredClearance &&
      row[x].terrain !== Terrain.Water
    );
    return safeX < 0 ? grid[0].length - 2 : safeX;
  });

  // Build the smallest path that stays inland of every safe target and can
  // move by at most one cell per row. Looking ahead prevents abrupt shoreline
  // changes from forcing a disconnected horizontal jump.
  const centers = safeTargets.map((_, y) => {
    let requiredX = 0;
    for (let otherY = 0; otherY < safeTargets.length; otherY += 1) {
      requiredX = Math.max(
        requiredX,
        safeTargets[otherY] - Math.abs(otherY - y),
      );
    }
    return Math.min(grid[0].length - 2, requiredX);
  });

  let roadWidth = 1;
  for (let y = 0; y < grid.length; y += 1) {
    const centerX = centers[y];
    if (y % 7 === 0 && random() < .55) roadWidth = roadWidth === 1 ? 2 : 1;
    const connectorStart = y === 0
      ? centerX
      : Math.min(centers[y - 1], centerX);
    const connectorEnd = y === 0
      ? centerX
      : Math.max(centers[y - 1], centerX);
    for (let x = connectorStart; x <= connectorEnd + roadWidth - 1; x += 1) {
      const tile = grid[y][x];
      if (
        tile &&
        tile.terrain !== Terrain.Water &&
        waterDistance[y][x] >= minimumClearance
      ) {
        setTileSurface(tile, Terrain.Road);
      }
    }
  }
}

type MapEdge = "top" | "right" | "bottom" | "left";

function connectCavernAccess(
  grid: Grid,
  carved: Set<string>,
  edge: MapEdge,
  random: Random,
) {
  const floor = [...carved].map((key) => {
    const [x, y] = key.split(",").map(Number);
    return { x, y };
  });
  const distanceToEdge = (point: Point) => {
    if (edge === "top") return point.y;
    if (edge === "bottom") return grid.length - 1 - point.y;
    if (edge === "left") return point.x;
    return grid[0].length - 1 - point.x;
  };
  floor.sort((a, b) => distanceToEdge(a) - distanceToEdge(b));
  const nearest = floor.slice(0, Math.max(1, Math.min(12, floor.length)));
  const target = nearest[Math.floor(random() * nearest.length)];
  const border = {
    x: edge === "left" ? 0 : edge === "right" ? grid[0].length - 1 : target.x,
    y: edge === "top" ? 0 : edge === "bottom" ? grid.length - 1 : target.y,
  };
  let point = { ...border };

  while (point.x !== target.x || point.y !== target.y) {
    grid[point.y][point.x].terrain = Terrain.Ground;
    carved.add(`${point.x},${point.y}`);
    const deltaX = target.x - point.x;
    const deltaY = target.y - point.y;
    if (deltaX !== 0 && deltaY !== 0) {
      if (random() < Math.abs(deltaX) / (Math.abs(deltaX) + Math.abs(deltaY))) {
        point.x += Math.sign(deltaX);
      } else {
        point.y += Math.sign(deltaY);
      }
    } else if (deltaX !== 0) {
      point.x += Math.sign(deltaX);
    } else {
      point.y += Math.sign(deltaY);
    }
  }
  grid[target.y][target.x].terrain = Terrain.Ground;
}

function generateCavern(
  grid: Grid,
  random: Random,
  waterWeight: number,
  difficultWeight: number,
) {
  for (const row of grid) {
    for (const tile of row) tile.terrain = Terrain.Cliff;
  }

  const width = grid[0].length;
  const height = grid.length;
  const targetFloor = Math.round(width * height * (.4 + random() * .07));
  const carved = new Set<string>();
  const walkers: Array<Point & { dx: number; dy: number }> = [
    { x: Math.floor(width / 2), y: Math.floor(height / 2), dx: 1, dy: 0 },
  ];
  let attempts = 0;

  const carveBrush = (center: Point, radius: number) => {
    for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
      for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
        if (offsetX * offsetX + offsetY * offsetY > radius * radius + 1) continue;
        const x = center.x + offsetX;
        const y = center.y + offsetY;
        if (x <= 0 || y <= 0 || x >= width - 1 || y >= height - 1) continue;
        grid[y][x].terrain = Terrain.Ground;
        carved.add(`${x},${y}`);
      }
    }
  };

  while (carved.size < targetFloor && attempts < width * height * 30) {
    attempts += 1;
    const walker = walkers[Math.floor(random() * walkers.length)];
    const chamberRoll = random();
    carveBrush(walker, chamberRoll < .035 ? 2 : chamberRoll < .24 ? 1 : 0);
    const directions = [
      { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
    ];
    if (random() < .28) {
      const direction = directions[Math.floor(random() * directions.length)];
      walker.dx = direction.x;
      walker.dy = direction.y;
    }
    walker.x = Math.max(2, Math.min(width - 3, walker.x + walker.dx));
    walker.y = Math.max(2, Math.min(height - 3, walker.y + walker.dy));
    if (walker.x === 2 || walker.x === width - 3) walker.dx *= -1;
    if (walker.y === 2 || walker.y === height - 3) walker.dy *= -1;

    if (walkers.length < 3 && random() < .014 && carved.size > 30) {
      const points = [...carved];
      const [x, y] = points[Math.floor(random() * points.length)].split(",").map(Number);
      const direction = directions[Math.floor(random() * directions.length)];
      walkers.push({ x, y, dx: direction.x, dy: direction.y });
    }
  }

  // A rare, compact underground pool is carved only inside existing floor.
  if (random() < .38 * waterWeight && carved.size > 30) {
    const floor = [...carved];
    let [x, y] = floor[Math.floor(random() * floor.length)].split(",").map(Number);
    const poolSize = Math.round((4 + Math.floor(random() * 10)) * waterWeight);
    for (let index = 0; index < poolSize; index += 1) {
      if (grid[y]?.[x]?.terrain === Terrain.Ground) grid[y][x].terrain = Terrain.Water;
      const directions = [
        { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
      ];
      const direction = directions[Math.floor(random() * directions.length)];
      const nextX = x + direction.x;
      const nextY = y + direction.y;
      if (grid[nextY]?.[nextX]?.terrain === Terrain.Ground) {
        x = nextX;
        y = nextY;
      }
    }
  }

  const edges: MapEdge[] = ["top", "right", "bottom", "left"];
  const entranceEdge = edges[Math.floor(random() * edges.length)];
  connectCavernAccess(grid, carved, entranceEdge, random);

  if (random() < .58) {
    const exitEdges = edges.filter((edge) => edge !== entranceEdge);
    const exitEdge = exitEdges[Math.floor(random() * exitEdges.length)];
    connectCavernAccess(grid, carved, exitEdge, random);
  }

  scatterDifficultTerrain(
    grid,
    Math.round(carved.size * (.13 + random() * .07) * difficultWeight),
    cellDistancesFromWater(grid),
    random,
  );
}

function generateTerrainAttempt(options: TerrainOptions) {
  options = normalizeGenerationOptions(options);
  const { width, height, seed } = options;
  const grid: Grid = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({
      terrain: Terrain.Ground,
      obstacle: Obstacle.None,
    })),
  );
  if (isInteriorMode(options.mode)) {
    generateInterior(
      grid,
      options.buildingCount,
      seededRandom(`${seed}:${options.mode}`),
      options.mode,
      options.lightPropRatio,
    );
    return { grid };
  }
  const total = width * height;
  const map = buildRegionMap(width, height, options.scale, seededRandom(`${seed}:mesh`));
  assignHeightField(grid, options.mode, seed);
  const regionHeights = map.cells.map((_, region) => regionHeight(grid, map, region));
  const preferLowland = (region: number) => 1 - regionHeights[region];
  const preferHighland = (region: number) => regionHeights[region];
  const boundary = boundaryRegions(map, width, height);
  const preferInlandLowland = (region: number) => {
    const center = map.centers[region];
    const edgeDistance = Math.min(
      center.x / width,
      (width - center.x) / width,
      center.y / height,
      (height - center.y) / height,
    );
    return preferLowland(region) * .72 + edgeDistance * 1.15;
  };

  if (options.mode === "countryside") {
    const pond = selectConnectedRegions(
      map, Math.round(total * .035 * options.waterWeight), seededRandom(`${seed}:pond`),
      (region) => !boundary.has(region), undefined, preferInlandLowland,
    );
    paintRegions(grid, map, pond, Terrain.Water);
    morphTerrainMass(
      grid,
      Terrain.Water,
      seededRandom(`${seed}:pond-shape`),
      { preserveMapEdge: true },
    );
    paintShore(grid, seededRandom(`${seed}:pond-shore`), 2);
    drawRoadCrossing(grid, true, seededRandom(`${seed}:road`));
  }

  if (options.mode === "river") {
    const riverRandom = seededRandom(`${seed}:river`);
    const riverIsHorizontal = riverRandom() > .5;
    if (options.waterWeight > 0) {
      meanderingCrossing(
        grid,
        riverIsHorizontal,
        riverRandom,
        [
          Math.max(0, Math.round(options.waterWeight)),
          Math.max(0, Math.round(2 * options.waterWeight)),
        ],
        () => Terrain.Water,
        false,
        .9,
      );
      if (riverRandom() < .72) {
        addLiquidTributary(
          grid,
          Terrain.Water,
          seededRandom(`${seed}:river-tributary`),
        );
      }
    }
    paintShore(grid, seededRandom(`${seed}:river-shore`), 2);
    drawRoadCrossing(
      grid,
      !riverIsHorizontal,
      seededRandom(`${seed}:road`),
    );
  }

  if (options.mode === "coast") {
    const coastSeeds = edgeRegions(map, width, height, "left");
    const sea = selectConnectedRegions(
      map,
      Math.round(total * .3 * options.waterWeight),
      seededRandom(`${seed}:coast`),
      () => true,
      coastSeeds,
      preferLowland,
    );
    paintRegions(grid, map, sea, Terrain.Water);
    morphTerrainMass(
      grid,
      Terrain.Water,
      seededRandom(`${seed}:coast-shape`),
      { passes: 3, preserveMapEdge: true },
    );
    ensureSingleCoastalSea(grid);
    paintShore(grid, seededRandom(`${seed}:coast-shore`), 3);
    drawCoastalRoad(grid, seededRandom(`${seed}:coastal-road`));
  }

  if (options.mode === "desert-canyon") {
    const canyonRandom = seededRandom(`${seed}:desert-canyon`);
    const ravine = options.reliefWeight > 0
      ? pathAcrossMap(
        map, width, height, canyonRandom() > .5, canyonRandom,
        () => true, preferLowland,
      )
      : [];
    if (ravine.length) {
      drawRegionPath(
        grid, map, ravine, Terrain.Ravine,
        Math.max(0, Math.round(options.reliefWeight) - 1),
      );
    }
    const mesa = selectConnectedRegions(
      map, Math.round(total * .13 * options.reliefWeight), canyonRandom,
      (region) => !ravine.includes(region),
      undefined,
      preferHighland,
    );
    paintRegions(grid, map, mesa, Terrain.Cliff);
    morphTerrainMass(
      grid,
      Terrain.Cliff,
      seededRandom(`${seed}:mesa-shape`),
      { preferHighGround: true },
    );
    const oasis = selectConnectedRegions(
      map, Math.round(total * .025 * options.waterWeight), canyonRandom,
      (region) => !mesa.has(region) && !boundary.has(region),
      undefined,
      preferInlandLowland,
    );
    paintRegions(grid, map, oasis, Terrain.Water);
    morphTerrainMass(
      grid,
      Terrain.Water,
      seededRandom(`${seed}:oasis-shape`),
      { preserveMapEdge: true },
    );
    scatterDifficultTerrain(
      grid, Math.round(total * .14 * options.difficultWeight),
      cellDistancesFromWater(grid), seededRandom(`${seed}:desert-scree`),
    );
    drawRoadCrossing(grid, canyonRandom() > .5, seededRandom(`${seed}:desert-trail`));
  }

  if (options.mode === "ancient-forest") {
    const forestRandom = seededRandom(`${seed}:ancient-forest`);
    if (options.waterWeight > 0) {
      meanderingCrossing(
        grid, forestRandom() > .5, seededRandom(`${seed}:forest-stream`),
        [0, Math.max(0, Math.round(options.waterWeight))], () => Terrain.Water,
        false,
        .7,
      );
      if (forestRandom() < .48) {
        addLiquidTributary(
          grid,
          Terrain.Water,
          seededRandom(`${seed}:forest-tributary`),
        );
      }
    }
    scatterDifficultTerrain(
      grid, Math.round(total * .2 * options.difficultWeight),
      cellDistancesFromWater(grid), seededRandom(`${seed}:undergrowth`),
    );
  }

  if (options.mode === "frozen-lake") {
    const inlandSeeds = map.cells
      .map((_, region) => region)
      .filter((region) => !boundary.has(region));
    const frozenLake = selectConnectedRegions(
      map, Math.round(total * .34 * options.waterWeight),
      seededRandom(`${seed}:frozen-lake`), () => true,
      inlandSeeds, preferLowland,
    );
    paintRegions(grid, map, frozenLake, Terrain.Ice);
    morphTerrainMass(
      grid,
      Terrain.Ice,
      seededRandom(`${seed}:frozen-lake-shape`),
      { passes: 3, preserveMapEdge: true },
    );
    const openWater = selectConnectedRegions(
      map, Math.round(total * .045 * options.waterWeight),
      seededRandom(`${seed}:open-water`),
      (region) => frozenLake.has(region) && !boundary.has(region),
      undefined,
      preferInlandLowland,
    );
    paintRegions(grid, map, openWater, Terrain.Water);
    morphTerrainMass(
      grid,
      Terrain.Water,
      seededRandom(`${seed}:open-water-shape`),
      { replacement: Terrain.Ice, preserveMapEdge: true },
    );
    scatterDifficultTerrain(
      grid, Math.round(total * .16 * options.difficultWeight),
      cellDistancesFromWater(grid), seededRandom(`${seed}:snowdrifts`),
    );
  }

  if (options.mode === "badlands") {
    const badlandsRandom = seededRandom(`${seed}:badlands`);
    for (let index = 0; index < Math.round(options.reliefWeight * 2); index += 1) {
      const path = pathAcrossMap(
        map, width, height, badlandsRandom() > .5,
        seededRandom(`${seed}:badlands-ridge:${index}`),
        () => true,
        index % 2 ? preferLowland : preferHighland,
      );
      drawRegionPath(grid, map, path, index % 2 ? Terrain.Ravine : Terrain.Cliff, 0);
    }
    scatterDifficultTerrain(
      grid, Math.round(total * .22 * options.difficultWeight),
      grid.map((row) => row.map(() => Infinity)),
      seededRandom(`${seed}:badlands-floor`),
    );
  }

  if (options.mode === "ruined-battlefield") {
    generateBattlefield(
      grid, seededRandom(`${seed}:battlefield`), options.difficultWeight,
    );
    drawRoadCrossing(grid, true, seededRandom(`${seed}:battlefield-road`));
  }

  if (options.mode === "farmland") {
    generateFarmland(
      grid,
      seededRandom(`${seed}:farmland`),
      options.difficultWeight,
      options.waterWeight,
    );
  }

  if (options.mode === "archipelago") {
    for (const row of grid) for (const tile of row) tile.terrain = Terrain.Water;
    const islandRandom = seededRandom(`${seed}:archipelago`);
    const landTarget = total * Math.max(.2, .55 - options.waterWeight * .22);
    if (width < 24 || height < 18) {
      paintCompactArchipelago(grid, landTarget, islandRandom);
      paintShore(grid, seededRandom(`${seed}:island-beaches`), 2);
    } else {
    const anchors = shuffled([
      { x: width * .25, y: height * .28 },
      { x: width * .73, y: height * .24 },
      { x: width * .28, y: height * .73 },
      { x: width * .72, y: height * .72 },
    ], islandRandom);
    const islandSeeds: number[] = [];
    for (const anchor of anchors) {
      const available = map.centers
        .map((center, region) => ({ center, region }))
        .filter(({ region }) =>
          !boundary.has(region) &&
          !islandSeeds.includes(region) &&
          islandSeeds.every((other) => !map.neighbors[region].includes(other))
        )
        .map(({ center, region }) => ({
          region,
          score:
            Math.hypot(center.x - anchor.x, center.y - anchor.y) -
            preferHighland(region) * 2 + islandRandom() * .7,
        }))
        .sort((a, b) => a.score - b.score);
      if (available[0]) islandSeeds.push(available[0].region);
    }
    const islands = islandSeeds.map((region) => new Set([region]));
    const owners = new Map(islandSeeds.map((region, index) => [region, index]));
    const targetPerIsland = Math.round(landTarget / Math.max(1, islands.length));
    for (let index = 0; index < islands.length; index += 1) {
      const island = islands[index];
      let islandSize = [...island]
        .reduce((sum, region) => sum + map.cells[region].length, 0);
      while (islandSize < targetPerIsland) {
        const frontier = new Set([...island].flatMap((region) => map.neighbors[region]));
        const candidates = [...frontier]
          .filter((region) => {
            if (boundary.has(region) || owners.has(region)) return false;
            return map.neighbors[region].every((neighbor) => {
              const owner = owners.get(neighbor);
              return owner === undefined || owner === index;
            });
          })
          .map((region) => ({
            region,
            score:
              map.neighbors[region].filter((neighbor) => island.has(neighbor)).length * 1.4 +
              preferHighland(region) * 2.4 + islandRandom() * 2,
          }))
          .sort((a, b) => b.score - a.score);
        const next = candidates[0]?.region;
        if (next === undefined) break;
        island.add(next);
        owners.set(next, index);
        islandSize += map.cells[next].length;
      }
      for (const region of island) {
        for (const point of map.cells[region]) {
          paintTerrain(grid[point.y][point.x], Terrain.Ground);
        }
      }
    }
    paintShore(grid, seededRandom(`${seed}:island-beaches`), 2);
    }
  }

  if (options.mode === "mountain-pass") {
    const passRandom = seededRandom(`${seed}:mountain-pass`);
    const leftMass = selectConnectedRegions(
      map, Math.round(total * .22 * options.reliefWeight), passRandom,
      () => true, edgeRegions(map, width, height, "left"),
      preferHighland,
    );
    const rightMass = selectConnectedRegions(
      map, Math.round(total * .22 * options.reliefWeight), passRandom,
      (region) => !leftMass.has(region), edgeRegions(map, width, height, "right"),
      preferHighland,
    );
    paintRegions(grid, map, leftMass, Terrain.Cliff);
    paintRegions(grid, map, rightMass, Terrain.Cliff);
    morphTerrainMass(
      grid,
      Terrain.Cliff,
      seededRandom(`${seed}:mountain-mass-shape`),
      { passes: 3, preserveMapEdge: true, preferHighGround: true },
    );
    scatterDifficultTerrain(
      grid, Math.round(total * .12 * options.difficultWeight),
      grid.map((row) => row.map(() => Infinity)),
      seededRandom(`${seed}:mountain-scree`),
    );
    drawRoadCrossing(grid, true, seededRandom(`${seed}:mountain-road`));
  }

  if (options.mode === "sewer") {
    generateSewer(grid, seededRandom(`${seed}:sewer`), options.waterWeight);
  }

  if (options.mode === "ancient-ruins") {
    generateAncientRuins(grid, seededRandom(`${seed}:ancient-ruins`));
    scatterDifficultTerrain(
      grid, Math.round(total * .1 * options.difficultWeight),
      cellDistancesFromWater(grid), seededRandom(`${seed}:ruin-overgrowth`),
    );
  }

  if (options.mode === "wetlands") {
    const wetlandRandom = seededRandom(`${seed}:wetlands`);
    const firstPool = selectConnectedRegions(
      map,
      Math.round(total * .16 * options.waterWeight),
      wetlandRandom,
      () => true,
      undefined,
      preferLowland,
    );
    paintRegions(grid, map, firstPool, Terrain.Water);

    const secondPool = selectConnectedRegions(
      map,
      Math.round(total * .08 * options.waterWeight),
      seededRandom(`${seed}:wetlands-pool`),
      (region) => !firstPool.has(region),
      undefined,
      preferLowland,
    );
    paintRegions(grid, map, secondPool, Terrain.Water);

    morphTerrainMass(
      grid,
      Terrain.Water,
      seededRandom(`${seed}:wetland-pool-shape`),
    );

    // Narrow channels connect the wetland visually to the landscape beyond the
    // map without turning it into a single broad river.
    if (options.waterWeight > 0) meanderingCrossing(
      grid,
      wetlandRandom() > .5,
      seededRandom(`${seed}:wetlands-channel`),
      [0, Math.max(0, Math.round(options.waterWeight))],
      () => Terrain.Water,
      false,
      .65,
    );
    if (options.waterWeight > 0 && wetlandRandom() < .7) {
      addLiquidTributary(
        grid,
        Terrain.Water,
        seededRandom(`${seed}:wetland-tributary`),
      );
    }
    const wetlandDistance = cellDistancesFromWater(grid);
    scatterDifficultTerrain(
      grid,
      Math.round(total * .18 * options.difficultWeight),
      wetlandDistance,
      seededRandom(`${seed}:wetland-mud`),
    );
  }

  if (options.mode === "underground") {
    generateCavern(
      grid,
      seededRandom(`${seed}:cavern`),
      options.waterWeight,
      options.difficultWeight,
    );
  }

  if (options.mode === "volcanic") {
    const volcanicRandom = seededRandom(`${seed}:volcanic`);
    const morphology = volcanicRandom();
    const hasRiver = morphology >= .27;
    const hasLake = morphology < .68 || morphology > .86;
    let lavaPath: Point[] = [];
    let lavaRiverCells: Point[] = [];

    if (hasRiver && options.waterWeight > 0) {
      lavaPath = meanderingCrossing(
        grid,
        volcanicRandom() > .5,
        seededRandom(`${seed}:lava-river`),
        [0, Math.max(0, Math.round(options.waterWeight))],
        () => Terrain.Lava,
        false,
        .55,
      );
      lavaRiverCells = grid.flatMap((row, y) =>
        row.flatMap((tile, x) => tile.terrain === Terrain.Lava ? [{ x, y }] : [])
      );
    }
    if (hasLake && options.waterWeight > 0) {
      const visiblePath = lavaPath.filter(({ x, y }) =>
        x >= 0 && x < width && y >= 0 && y < height,
      );
      const preferred = visiblePath.length
        ? [map.cellRegion[
          visiblePath[Math.floor(visiblePath.length / 2)].y
        ][visiblePath[Math.floor(visiblePath.length / 2)].x]]
        : undefined;
      const lavaLake = selectConnectedRegions(
        map,
        Math.round(total * (.08 + volcanicRandom() * .07) * options.waterWeight),
        seededRandom(`${seed}:lava-lake`),
        () => true,
        preferred,
        preferLowland,
      );
      paintRegions(grid, map, lavaLake, Terrain.Lava);
      morphTerrainMass(
        grid,
        Terrain.Lava,
        seededRandom(`${seed}:lava-lake-shape`),
      );
      // Morphing the lake also sees the narrow river as an exposed boundary.
      // Restore its complete painted mask (including orthogonal connectors
      // between diagonal centerline steps) so the flow stays uninterrupted.
      for (const point of lavaRiverCells) {
        grid[point.y][point.x].terrain = Terrain.Lava;
      }
    }
    if (options.waterWeight > 0 && volcanicRandom() < .55) {
      addLiquidTributary(
        grid,
        Terrain.Lava,
        seededRandom(`${seed}:lava-tributary`),
      );
    }

    scatterDifficultTerrain(
      grid,
      Math.round(total * (.18 + volcanicRandom() * .08) * options.difficultWeight),
      grid.map((row) => row.map(() => Infinity)),
      seededRandom(`${seed}:ash-fields`),
    );

    const ridgeRandom = seededRandom(`${seed}:volcanic-ridge`);
    const ridgeStart = preferredRegion(
      map.centers.map((_, region) => region),
      preferHighland,
      ridgeRandom,
    ) ?? 0;
    const ridgeDistances = distanceFromRegions(map, new Set([ridgeStart]));
    const ridgeEnds = ridgeDistances
      .map((distance, region) => ({ distance, region }))
      .filter(({ distance }) => distance >= 3 && distance <= 6);
    if (ridgeEnds.length && options.reliefWeight > 0) {
      const ridgeEnd = ridgeEnds[Math.floor(ridgeRandom() * ridgeEnds.length)].region;
      drawRegionPath(
        grid,
        map,
        shortestRegionPath(
          map, ridgeStart, ridgeEnd, ridgeRandom, () => true, preferHighland,
        ),
        Terrain.Cliff,
        Math.max(0, Math.round(options.reliefWeight) - 1),
      );
      morphTerrainMass(
        grid,
        Terrain.Cliff,
        seededRandom(`${seed}:volcanic-ridge-ground-shape`),
        { passes: 1, preferHighGround: true },
      );
      morphTerrainMass(
        grid,
        Terrain.Cliff,
        seededRandom(`${seed}:volcanic-ridge-ash-shape`),
        {
          passes: 1,
          replacement: Terrain.Difficult,
          preferHighGround: true,
        },
      );
    }
  }

  if (options.mode === "city") {
    generateCity(
      grid,
      seededRandom(`${seed}:city`),
      options.buildingCount,
      options.difficultWeight,
    );
  }

  if (options.mode === "highlands") {
    const ridgeRandom = seededRandom(`${seed}:ridge`);
    const ridgeStart = preferredRegion(
      map.centers.map((_, region) => region),
      preferHighland,
      ridgeRandom,
    ) ?? 0;
    const ridgeDistances = distanceFromRegions(map, new Set([ridgeStart]));
    const ridgeEnds = ridgeDistances
      .map((distance, region) => ({ distance, region }))
      .filter(({ distance }) => distance >= 5 && distance <= 8);
    if (ridgeEnds.length && options.reliefWeight > 0) {
      const ridgeEnd = ridgeEnds[Math.floor(ridgeRandom() * ridgeEnds.length)].region;
      drawRegionPath(
        grid,
        map,
        shortestRegionPath(
          map, ridgeStart, ridgeEnd, ridgeRandom, () => true, preferHighland,
        ),
        Terrain.Cliff,
        Math.max(0, Math.round(options.reliefWeight)),
      );
    }
    const ravinePath = pathAcrossMap(
      map, width, height, ridgeRandom() > .5, seededRandom(`${seed}:ravine`),
      () => true,
      preferLowland,
    );
    if (options.reliefWeight > 0) {
      drawRegionPath(
        grid,
        map,
        ravinePath,
        Terrain.Ravine,
        Math.max(0, Math.round(options.reliefWeight) - 1),
      );
    }
    drawRoadCrossing(
      grid,
      ridgeRandom() > .5,
      seededRandom(`${seed}:pass-road`),
    );
  }

  smoothTerrain(
    grid,
    Terrain.Difficult,
    BIOME_RECIPES[options.mode].smoothing,
  );

  addBiomeLandmark(
    grid,
    options,
    seededRandom(`${seed}:landmark-variant`),
  );
  maybeAddBiomeTrail(
    grid,
    options.mode,
    seededRandom(`${seed}:optional-trail`),
  );

  // Second pass: establish every major point of interest and its access
  // before vegetation and scree are fitted into the remaining landscape.
  const waterDistance = cellDistancesFromWater(grid);
  if (
    options.mode !== "city" &&
    options.mode !== "underground" &&
    options.mode !== "volcanic"
  ) {
    placeBuildings(grid, options.buildingCount, seededRandom(`${seed}:buildings`));
  }
  if (options.mode === "city") {
    const cityBuildings = new Set(grid.flatMap((row) => row)
      .filter((tile) => tile.obstacle === Obstacle.Building)
      .map((tile) => tile.obstacleId));
    placeBuildings(
      grid,
      Math.max(0, options.buildingCount - cityBuildings.size),
      seededRandom(`${seed}:city-infill`),
      true,
    );
  }

  connectPointsOfInterest(grid, options.mode);
  if (
    hasRoadNetwork(grid) &&
    options.mode !== "city" &&
    options.mode !== "sewer" &&
    options.mode !== "underground" &&
    options.mode !== "archipelago" &&
    options.mode !== "volcanic"
  ) {
    addRoadSpurs(
      grid,
      seededRandom(`${seed}:road-spurs`),
      Math.min(3, Math.max(1, Math.ceil(options.buildingCount / 2))),
    );
  }

  if (options.mode !== "city") {
    scatterRocks(
      grid,
      Math.round(total * options.rockRatio),
      seededRandom(`${seed}:rocks`),
      options.mode,
    );
  }
  if (
    options.mode !== "underground" &&
    options.mode !== "volcanic"
  ) {
    placeTrees(
      grid,
      Math.round(total * options.treeRatio),
      waterDistance,
      seededRandom(`${seed}:street-trees`),
      options.mode,
    );
  }
  assignCliffElevations(grid);
  const repair = validateAndRepairGrid(grid, options.mode);
  assignCliffElevations(grid);
  return { grid, repair };
}

export function generateTerrain(options: TerrainOptions): Grid {
  const first = generateTerrainAttempt(options);
  if (
    !first.repair?.repairBudgetExceeded &&
    !first.repair?.connectivityRepairFailed
  ) {
    return first.grid;
  }

  const candidates: Array<
    ReturnType<typeof generateTerrainAttempt> & { attempt: number }
  > = [{ ...first, attempt: 0 }];
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const candidate = generateTerrainAttempt({
      ...options,
      seed: `${options.seed}:repair-retry:${attempt}`,
    });
    candidates.push({ ...candidate, attempt });
    if (
      candidate.repair &&
      !candidate.repair.repairBudgetExceeded &&
      !candidate.repair.connectivityRepairFailed
    ) {
      break;
    }
  }
  const failureRank = (candidate: typeof candidates[number]) => {
    if (candidate.repair?.connectivityRepairFailed) {
      return candidate.repair.remainingConnectedComponents === 0 ? 3 : 2;
    }
    return candidate.repair?.repairBudgetExceeded ? 1 : 0;
  };
  candidates.sort((a, b) => {
    return failureRank(a) - failureRank(b) ||
      (a.repair?.remainingConnectedComponents ?? 1) -
        (b.repair?.remainingConnectedComponents ?? 1) ||
      (a.repair?.repairFootprintCells ?? 0) -
        (b.repair?.repairFootprintCells ?? 0) ||
      (a.repair?.connectivityRepairCost ?? 0) -
        (b.repair?.connectivityRepairCost ?? 0) ||
      a.attempt - b.attempt;
  });
  return candidates[0].grid;
}
