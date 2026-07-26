import { Delaunay } from "d3-delaunay";

export const Terrain = {
  Void: "void",
  Ground: "ground",
  Difficult: "difficult",
  Water: "water",
  Lava: "lava",
  Beach: "beach",
  Road: "road",
  Bridge: "bridge",
  Rock: "rock",
  Cliff: "cliff",
  Ravine: "ravine",
} as const;

export const Obstacle = {
  None: "none",
  Tree: "tree",
  Building: "building",
} as const;

export type TerrainKind = (typeof Terrain)[keyof typeof Terrain];
export type ObstacleKind = (typeof Obstacle)[keyof typeof Obstacle];
export type LandscapeMode =
  | "countryside"
  | "river"
  | "coast"
  | "wetlands"
  | "underground"
  | "volcanic"
  | "highlands";

export interface Tile {
  terrain: TerrainKind;
  obstacle: ObstacleKind;
  obstacleId?: number;
}

export type Grid = Tile[][];

export interface TerrainOptions {
  width: number;
  height: number;
  seed: string;
  scale: number;
  mode: LandscapeMode;
  rockRatio: number;
  treeRatio: number;
  buildingCount: number;
}

export interface Preset extends TerrainOptions {
  id: string;
  name: string;
  description: string;
}

export const PRESETS: Preset[] = [
  {
    id: "countryside",
    name: "Open countryside",
    description: "A main road, a pond, and open ground.",
    width: 36, height: 24, seed: "", scale: 10, mode: "countryside",
    rockRatio: 0.02, treeRatio: 0.05, buildingCount: 2,
  },
  {
    id: "river",
    name: "River valley",
    description: "A continuous river, banks, a road, and a bridge.",
    width: 36, height: 24, seed: "", scale: 8, mode: "river",
    rockRatio: 0.01, treeRatio: 0.09, buildingCount: 1,
  },
  {
    id: "coast",
    name: "Coastline",
    description: "An organic shoreline, beach, and coastal road.",
    width: 36, height: 24, seed: "", scale: 9, mode: "coast",
    rockRatio: 0.03, treeRatio: 0.06, buildingCount: 1,
  },
  {
    id: "wetlands",
    name: "Wetlands",
    description: "Shallow pools, muddy ground, and winding channels.",
    width: 36, height: 24, seed: "", scale: 8, mode: "wetlands",
    rockRatio: 0.005, treeRatio: 0.045, buildingCount: 0,
  },
  {
    id: "underground",
    name: "Underground",
    description: "Tight passages, rare chambers, rough ground, and underground pools.",
    width: 36, height: 24, seed: "", scale: 7, mode: "underground",
    rockRatio: 0, treeRatio: 0, buildingCount: 0,
  },
  {
    id: "volcanic",
    name: "Volcanic wastes",
    description: "Lava lakes and flows, ash fields, and broken ridges.",
    width: 36, height: 24, seed: "", scale: 7, mode: "volcanic",
    rockRatio: 0.07, treeRatio: 0, buildingCount: 0,
  },
  {
    id: "highlands",
    name: "Highlands",
    description: "Continuous ridges, a ravine, and a mountain pass.",
    width: 36, height: 24, seed: "", scale: 6, mode: "highlands",
    rockRatio: 0.06, treeRatio: 0.03, buildingCount: 1,
  },
];

export const TERRAIN_RULES: Record<
  TerrainKind,
  { label: string; movement: "normal" | "slow" | "blocked"; blocksSight: boolean }
> = {
  [Terrain.Void]: { label: "Void", movement: "blocked", blocksSight: true },
  [Terrain.Ground]: { label: "Ground", movement: "normal", blocksSight: false },
  [Terrain.Difficult]: { label: "Difficult terrain", movement: "slow", blocksSight: false },
  [Terrain.Water]: { label: "Water", movement: "slow", blocksSight: false },
  [Terrain.Lava]: { label: "Lava", movement: "blocked", blocksSight: false },
  [Terrain.Beach]: { label: "Beach", movement: "slow", blocksSight: false },
  [Terrain.Road]: { label: "Road", movement: "normal", blocksSight: false },
  [Terrain.Bridge]: { label: "Bridge", movement: "normal", blocksSight: false },
  [Terrain.Rock]: { label: "Rock", movement: "blocked", blocksSight: true },
  [Terrain.Cliff]: { label: "Cliff", movement: "blocked", blocksSight: true },
  [Terrain.Ravine]: { label: "Ravine", movement: "blocked", blocksSight: false },
};

export const OBSTACLE_RULES: Record<
  Exclude<ObstacleKind, "none">,
  { label: string; movement: "blocked"; blocksSight: true }
> = {
  [Obstacle.Tree]: { label: "Tree", movement: "blocked", blocksSight: true },
  [Obstacle.Building]: { label: "Building", movement: "blocked", blocksSight: true },
};

type Point = { x: number; y: number };
type Random = () => number;

function seededRandom(seed: string): Random {
  let hash = 1779033703 ^ seed.length;
  for (let index = 0; index < seed.length; index += 1) {
    hash = Math.imul(hash ^ seed.charCodeAt(index), 3432918353);
    hash = (hash << 13) | (hash >>> 19);
  }
  hash = Math.imul(hash ^ (hash >>> 16), 2246822507);
  hash = Math.imul(hash ^ (hash >>> 13), 3266489909);
  let state = (hash ^= hash >>> 16) >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

interface RegionMap {
  centers: Point[];
  neighbors: number[][];
  cells: Point[][];
  cellRegion: number[][];
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
): Set<number> {
  const possibleSeeds = (preferredSeeds?.filter(allowed).length ? preferredSeeds : map.cells.map((_, index) => index))
    ?.filter(allowed) ?? [];
  if (!possibleSeeds.length || targetCells <= 0) return new Set();
  const seed = possibleSeeds[Math.floor(random() * possibleSeeds.length)];
  const selected = new Set([seed]);
  const frontier = new Set(map.neighbors[seed].filter(allowed));
  let size = map.cells[seed].length;

  while (size < targetCells && frontier.size) {
    let best = -1;
    let bestScore = -Infinity;
    for (const candidate of frontier) {
      const touching = map.neighbors[candidate].filter((neighbor) => selected.has(neighbor)).length;
      const score = touching * 1.4 + random() * 2;
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

function paintRegions(grid: Grid, map: RegionMap, regions: Set<number>, terrain: TerrainKind) {
  for (const region of regions) {
    for (const { x, y } of map.cells[region]) grid[y][x].terrain = terrain;
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
): number[] {
  const previous = map.cells.map(() => -1);
  const queue = [start];
  previous[start] = start;
  for (let index = 0; index < queue.length && previous[end] === -1; index += 1) {
    const region = queue[index];
    const next = [...map.neighbors[region]].sort(() => random() - .5);
    for (const neighbor of next) {
      if (previous[neighbor] === -1 && allowed(neighbor)) {
        previous[neighbor] = region;
        queue.push(neighbor);
      }
    }
  }
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

function drawRegionPath(
  grid: Grid,
  map: RegionMap,
  path: number[],
  terrain: TerrainKind,
  thickness: number,
) {
  for (let index = 0; index < path.length - 1; index += 1) {
    const start = map.centers[path[index]];
    const end = map.centers[path[index + 1]];
    const steps = Math.max(Math.abs(end.x - start.x), Math.abs(end.y - start.y)) * 2;
    for (let step = 0; step <= steps; step += 1) {
      const ratio = step / Math.max(1, steps);
      const x = Math.round(start.x + (end.x - start.x) * ratio);
      const y = Math.round(start.y + (end.y - start.y) * ratio);
      for (let offsetY = -thickness; offsetY <= thickness; offsetY += 1) {
        for (let offsetX = -thickness; offsetX <= thickness; offsetX += 1) {
          const tile = grid[y + offsetY]?.[x + offsetX];
          if (
            tile &&
            tile.terrain !== Terrain.Water &&
            tile.terrain !== Terrain.Lava
          ) {
            tile.terrain = terrain;
          }
        }
      }
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
) {
  const starts = edgeRegions(map, width, height, horizontal ? "left" : "top").filter(allowed);
  const ends = edgeRegions(map, width, height, horizontal ? "right" : "bottom").filter(allowed);
  if (!starts.length || !ends.length) return [];
  const start = starts[Math.floor(random() * starts.length)];
  const end = ends[Math.floor(random() * ends.length)];
  return shortestRegionPath(map, start, end, random, allowed);
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
): Point[] {
  const longSize = horizontal ? grid[0].length : grid.length;
  const shortSize = horizontal ? grid.length : grid[0].length;
  const [minimumWidth, maximumWidth] = Array.isArray(width) ? width : [width, width];
  let currentWidth = minimumWidth;
  let targetWidth = minimumWidth;
  let across = shortSize * (.3 + random() * .4);
  let velocity = (random() - .5) * .25;
  const centerline: Point[] = [];

  for (let along = -2; along <= longSize + 1; along += 1) {
    if (along % 6 === 0) {
      targetWidth = minimumWidth + Math.floor(random() * (maximumWidth - minimumWidth + 1));
    }
    currentWidth += Math.sign(targetWidth - currentWidth) * Math.min(.34, Math.abs(targetWidth - currentWidth));
    const paintedWidth = Math.round(currentWidth);
    if (random() < .28) velocity += (random() - .5) * .22;
    velocity *= .82;
    velocity = Math.max(-.42, Math.min(.42, velocity));
    across += velocity;
    if (across < maximumWidth + 1 || across > shortSize - maximumWidth - 2) {
      velocity *= -1;
      across = Math.max(maximumWidth + 1, Math.min(shortSize - maximumWidth - 2, across));
    }
    const center = horizontal
      ? { x: along, y: Math.round(across) }
      : { x: Math.round(across), y: along };
    centerline.push(center);
    for (let offset = -paintedWidth; offset <= paintedWidth; offset += 1) {
      const point = horizontal
        ? { x: center.x, y: center.y + offset }
        : { x: center.x + offset, y: center.y };
      const tile = grid[point.y]?.[point.x];
      if (tile) tile.terrain = paint(tile);
    }
  }
  return centerline;
}

function drawRoadCrossing(grid: Grid, horizontal: boolean, random: Random) {
  return meanderingCrossing(grid, horizontal, random, 0, (tile) =>
    tile.terrain === Terrain.Water || tile.terrain === Terrain.Ravine
      ? Terrain.Bridge
      : Terrain.Road,
  );
}

function drawCoastalRoad(grid: Grid) {
  let smoothedX: number | undefined;
  for (let y = -1; y <= grid.length; y += 1) {
    const sampleY = Math.max(0, Math.min(grid.length - 1, y));
    const shoreline = grid[sampleY].findIndex((tile) => tile.terrain !== Terrain.Water);
    if (shoreline < 0) continue;
    const targetX = Math.min(grid[0].length - 2, shoreline + 3);
    smoothedX = smoothedX === undefined ? targetX : smoothedX * .72 + targetX * .28;
    const tile = grid[y]?.[Math.round(smoothedX)];
    if (tile && tile.terrain !== Terrain.Water) tile.terrain = Terrain.Road;
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

function generateCavern(grid: Grid, random: Random) {
  for (const row of grid) {
    for (const tile of row) tile.terrain = Terrain.Rock;
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
  if (random() < .38 && carved.size > 30) {
    const floor = [...carved];
    let [x, y] = floor[Math.floor(random() * floor.length)].split(",").map(Number);
    const poolSize = 4 + Math.floor(random() * 10);
    for (let index = 0; index < poolSize; index += 1) {
      if (grid[y]?.[x].terrain === Terrain.Ground) grid[y][x].terrain = Terrain.Water;
      const directions = [
        { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
      ];
      const direction = directions[Math.floor(random() * directions.length)];
      const nextX = x + direction.x;
      const nextY = y + direction.y;
      if (grid[nextY]?.[nextX].terrain === Terrain.Ground) {
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
    Math.round(carved.size * (.13 + random() * .07)),
    cellDistancesFromWater(grid),
    random,
  );
}

function cellDistancesFromWater(grid: Grid): number[][] {
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

/**
 * Difficult terrain forms small irregular patches with a few isolated cells.
 * Near water it represents mud and reeds; elsewhere, brush and rough ground.
 */
function scatterDifficultTerrain(
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

  // Roughly 20% isolated elements break up large block-like outlines.
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

function scatterRocks(grid: Grid, target: number, random: Random) {
  const candidates = grid.flatMap((row, y) =>
    row.map((tile, x) => ({ tile, x, y, score: random() }))
      .filter(({ tile }) =>
        tile.terrain === Terrain.Ground || tile.terrain === Terrain.Difficult,
      ),
  ).sort((a, b) => a.score - b.score);
  const placed: Point[] = [];

  for (const candidate of candidates) {
    const nearExisting = placed.some((rock) =>
      Math.abs(rock.x - candidate.x) <= 2 && Math.abs(rock.y - candidate.y) <= 2,
    );
    if (nearExisting) continue;

    const outcropSize = random() < .18 ? 2 + Math.floor(random() * 3) : 1;
    let point = { x: candidate.x, y: candidate.y };
    for (let index = 0; index < outcropSize && placed.length < target; index += 1) {
      const tile = grid[point.y]?.[point.x];
      if (
        tile &&
        (tile.terrain === Terrain.Ground || tile.terrain === Terrain.Difficult)
      ) {
        tile.terrain = Terrain.Rock;
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

/**
 * Trees are points, not a solid biome. Grove centers attract most trees, while
 * a random component preserves isolated trees and genuine clearings.
 */
function placeTrees(
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
      return {
        ...candidate,
        score: groveDistance * .8 + wetness + random() * 7,
      };
    })
    .sort((a, b) => a.score - b.score);
  const placed: Point[] = [];
  let treeId = 0;
  for (const { x, y } of ranked) {
    const hasCloseTree = placed.some((tree) =>
      Math.abs(tree.x - x) <= 1 && Math.abs(tree.y - y) <= 1,
    );
    if (hasCloseTree) continue;

    let footprint = [{ x, y }];
    const sizeRoll = random();
    if (sizeRoll < .1) {
      const directionX = x < grid[0].length - 1 ? 1 : -1;
      const directionY = y < grid.length - 1 ? 1 : -1;
      footprint = [
        { x, y },
        { x: x + directionX, y },
        { x, y: y + directionY },
        { x: x + directionX, y: y + directionY },
      ];
    } else if (sizeRoll < .24) {
      const horizontal = random() > .5;
      footprint = [
        { x, y },
        horizontal
          ? { x: x + (x < grid[0].length - 1 ? 1 : -1), y }
          : { x, y: y + (y < grid.length - 1 ? 1 : -1) },
      ];
    }
    const validFootprint = footprint.every((point) => {
      const tile = grid[point.y]?.[point.x];
      return tile &&
        tile.obstacle === Obstacle.None &&
        (tile.terrain === Terrain.Ground || tile.terrain === Terrain.Difficult) &&
        !placed.some((tree) =>
          Math.abs(tree.x - point.x) <= 1 && Math.abs(tree.y - point.y) <= 1
        );
    });
    if (!validFootprint) footprint = [{ x, y }];

    treeId += 1;
    for (const point of footprint) {
      grid[point.y][point.x].obstacle = Obstacle.Tree;
      grid[point.y][point.x].obstacleId = treeId;
      placed.push(point);
    }
    if (placed.length >= target) break;
  }
}

function placeBuildings(grid: Grid, count: number, random: Random) {
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
        if (!tile || tile.terrain !== Terrain.Ground || tile.obstacle !== Obstacle.None) available = false;
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

export function generateTerrain(options: TerrainOptions): Grid {
  const { width, height, seed } = options;
  const grid: Grid = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({
      terrain: Terrain.Ground,
      obstacle: Obstacle.None,
    })),
  );
  const total = width * height;
  const map = buildRegionMap(width, height, options.scale, seededRandom(`${seed}:mesh`));

  if (options.mode === "countryside") {
    const pond = selectConnectedRegions(
      map, Math.round(total * .035), seededRandom(`${seed}:pond`), () => true,
    );
    paintRegions(grid, map, pond, Terrain.Water);
    paintShore(grid, seededRandom(`${seed}:pond-shore`), 2);
    drawRoadCrossing(grid, true, seededRandom(`${seed}:road`));
  }

  if (options.mode === "river") {
    const riverRandom = seededRandom(`${seed}:river`);
    const riverIsHorizontal = riverRandom() > .5;
    meanderingCrossing(
      grid,
      riverIsHorizontal,
      riverRandom,
      [1, 2],
      () => Terrain.Water,
    );
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
      Math.round(total * .3),
      seededRandom(`${seed}:coast`),
      () => true,
      coastSeeds,
    );
    paintRegions(grid, map, sea, Terrain.Water);
    paintShore(grid, seededRandom(`${seed}:coast-shore`), 3);
    drawCoastalRoad(grid);
  }

  if (options.mode === "wetlands") {
    const wetlandRandom = seededRandom(`${seed}:wetlands`);
    const firstPool = selectConnectedRegions(
      map,
      Math.round(total * .16),
      wetlandRandom,
      () => true,
    );
    paintRegions(grid, map, firstPool, Terrain.Water);

    const secondPool = selectConnectedRegions(
      map,
      Math.round(total * .08),
      seededRandom(`${seed}:wetlands-pool`),
      (region) => !firstPool.has(region),
    );
    paintRegions(grid, map, secondPool, Terrain.Water);

    // Narrow channels connect the wetland visually to the landscape beyond the
    // map without turning it into a single broad river.
    meanderingCrossing(
      grid,
      wetlandRandom() > .5,
      seededRandom(`${seed}:wetlands-channel`),
      [0, 1],
      () => Terrain.Water,
    );
    const wetlandDistance = cellDistancesFromWater(grid);
    scatterDifficultTerrain(
      grid,
      Math.round(total * .18),
      wetlandDistance,
      seededRandom(`${seed}:wetland-mud`),
    );
  }

  if (options.mode === "underground") {
    generateCavern(grid, seededRandom(`${seed}:cavern`));
  }

  if (options.mode === "volcanic") {
    const volcanicRandom = seededRandom(`${seed}:volcanic`);
    const morphology = volcanicRandom();
    const hasRiver = morphology >= .27;
    const hasLake = morphology < .68 || morphology > .86;
    let lavaPath: Point[] = [];

    if (hasRiver) {
      lavaPath = meanderingCrossing(
        grid,
        volcanicRandom() > .5,
        seededRandom(`${seed}:lava-river`),
        [0, 1],
        () => Terrain.Lava,
      );
    }
    if (hasLake) {
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
        Math.round(total * (.08 + volcanicRandom() * .07)),
        seededRandom(`${seed}:lava-lake`),
        () => true,
        preferred,
      );
      paintRegions(grid, map, lavaLake, Terrain.Lava);
    }

    scatterDifficultTerrain(
      grid,
      Math.round(total * (.18 + volcanicRandom() * .08)),
      grid.map((row) => row.map(() => Infinity)),
      seededRandom(`${seed}:ash-fields`),
    );

    const ridgeRandom = seededRandom(`${seed}:volcanic-ridge`);
    const ridgeStart = Math.floor(ridgeRandom() * map.centers.length);
    const ridgeDistances = distanceFromRegions(map, new Set([ridgeStart]));
    const ridgeEnds = ridgeDistances
      .map((distance, region) => ({ distance, region }))
      .filter(({ distance }) => distance >= 3 && distance <= 6);
    if (ridgeEnds.length) {
      const ridgeEnd = ridgeEnds[Math.floor(ridgeRandom() * ridgeEnds.length)].region;
      drawRegionPath(
        grid,
        map,
        shortestRegionPath(map, ridgeStart, ridgeEnd, ridgeRandom),
        Terrain.Cliff,
        0,
      );
    }
  }

  if (options.mode === "highlands") {
    const ridgeRandom = seededRandom(`${seed}:ridge`);
    const ridgeStart = Math.floor(ridgeRandom() * map.centers.length);
    const ridgeDistances = distanceFromRegions(map, new Set([ridgeStart]));
    const ridgeEnds = ridgeDistances
      .map((distance, region) => ({ distance, region }))
      .filter(({ distance }) => distance >= 5 && distance <= 8);
    if (ridgeEnds.length) {
      const ridgeEnd = ridgeEnds[Math.floor(ridgeRandom() * ridgeEnds.length)].region;
      drawRegionPath(
        grid,
        map,
        shortestRegionPath(map, ridgeStart, ridgeEnd, ridgeRandom),
        Terrain.Cliff,
        1,
      );
    }
    const ravinePath = pathAcrossMap(
      map, width, height, ridgeRandom() > .5, seededRandom(`${seed}:ravine`),
    );
    drawRegionPath(grid, map, ravinePath, Terrain.Ravine, 0);
    drawRoadCrossing(
      grid,
      ridgeRandom() > .5,
      seededRandom(`${seed}:pass-road`),
    );
  }

  // Second pass: obstacles do not participate in terrain morphology.
  const waterDistance = cellDistancesFromWater(grid);
  if (options.mode !== "underground") {
    scatterRocks(grid, Math.round(total * options.rockRatio), seededRandom(`${seed}:rocks`));
  }
  if (options.mode !== "underground" && options.mode !== "volcanic") {
    placeBuildings(grid, options.buildingCount, seededRandom(`${seed}:buildings`));
    placeTrees(
      grid,
      Math.round(total * options.treeRatio),
      waterDistance,
      seededRandom(`${seed}:groves`),
    );
  }
  return grid;
}
