import {
  Obstacle,
  Terrain,
  tileSurface,
  type Grid,
  type LandscapeMode,
  type TerrainKind,
} from "../domain/map";
import { getBiomeObjectStyle, getTerrainStyle } from "./palettes";
import { drawStylizedLighting } from "./lighting";

export interface RenderOptions {
  targetCanvas: HTMLCanvasElement;
  mode: LandscapeMode;
  cellSize?: number;
  pixelRatio?: number;
  updateInterface?: boolean;
  hiddenItems?: ReadonlySet<string>;
  hiddenOpacity?: number;
  transparentBackground?: boolean;
  showGrid?: boolean;
  useTileset?: boolean;
  tilesetImage?: CanvasImageSource;
  tilesetProps?: TilesetPropImages;
  stylizedLighting?: boolean;
}

export interface TilesetPropImages {
  tree1x1: CanvasImageSource;
  tree2x2: CanvasImageSource;
  rock1x1: CanvasImageSource;
  rock2x2: CanvasImageSource;
}


const terrainPriority: Record<TerrainKind, number> = {
  [Terrain.Void]: 120,
  [Terrain.Ground]: 10,
  [Terrain.Difficult]: 30,
  [Terrain.Water]: 80,
  [Terrain.Ice]: 85,
  [Terrain.Lava]: 75,
  [Terrain.Beach]: 70,
  [Terrain.Road]: 100,
  [Terrain.Bridge]: 110,
  [Terrain.Cliff]: 90,
  [Terrain.Ravine]: 95,
};

function terrainVariation(x: number, y: number, salt: number) {
  let value = Math.imul(x + 101, 374761393) ^
    Math.imul(y + 53, 668265263) ^
    Math.imul(salt + 17, 1274126177);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function outsideGrid(grid: Grid, x: number, y: number) {
  return y < 0 || y >= grid.length || x < 0 || x >= grid[0].length;
}

const tintedTilesetPropCache = new WeakMap<
  object,
  Map<string, HTMLCanvasElement>
>();

function applyPropContactShadow(
  cellSize: number,
  context: CanvasRenderingContext2D,
) {
  // The directional light comes from the north-west, so props cast a short,
  // soft shadow towards the south-east. Keeping this tied to one cell makes
  // large props feel grounded without producing long, dominant silhouettes.
  context.shadowColor = "rgba(20, 24, 22, .28)";
  context.shadowBlur = Math.max(1.25, cellSize * .065);
  context.shadowOffsetX = Math.max(.75, cellSize * .04);
  context.shadowOffsetY = Math.max(1.25, cellSize * .075);
}

function tintedTilesetProp(
  image: CanvasImageSource,
  size: 1 | 2,
  cellSize: number,
  tint: string,
  tintStrength: number,
) {
  const imageCache = tintedTilesetPropCache.get(image as object) ?? new Map();
  tintedTilesetPropCache.set(image as object, imageCache);
  const key = `${size}:${cellSize}:${tint}:${tintStrength}`;
  const cached = imageCache.get(key);
  if (cached) return cached;

  const canvas = document.createElement("canvas");
  canvas.width = size * cellSize;
  canvas.height = size * cellSize;
  const context = canvas.getContext("2d")!;
  context.imageSmoothingEnabled = false;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  context.globalCompositeOperation = "source-atop";
  context.globalAlpha = tintStrength;
  context.fillStyle = tint;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.globalAlpha = 1;
  context.globalCompositeOperation = "source-over";
  imageCache.set(key, canvas);
  return canvas;
}

function drawTilesetProp(
  image: CanvasImageSource,
  x: number,
  y: number,
  size: 1 | 2,
  cellSize: number,
  context: CanvasRenderingContext2D,
  tint: string,
  tintStrength: number,
) {
  context.save();
  context.imageSmoothingEnabled = false;
  applyPropContactShadow(cellSize, context);
  context.drawImage(
    tintedTilesetProp(image, size, cellSize, tint, tintStrength),
    x * cellSize,
    y * cellSize,
    size * cellSize,
    size * cellSize,
  );
  context.restore();
}

const overlayTerrains = new Set<TerrainKind>([
  Terrain.Road,
  Terrain.Bridge,
]);

const terrainPaintOrder: TerrainKind[] = [
  Terrain.Ground,
  Terrain.Difficult,
  Terrain.Beach,
  Terrain.Water,
  Terrain.Ice,
  Terrain.Lava,
  Terrain.Ravine,
  Terrain.Void,
  Terrain.Cliff,
];

type TilesetCoordinate = readonly [column: number, row: number];
type TilesetProfileName = "grass" | "sand" | "mountain" | "snow";
type TilesetTerrainMap =
  Partial<Record<TerrainKind, TilesetCoordinate>>;

const sharedTilesetCoordinates: TilesetTerrainMap = {
  [Terrain.Beach]: [2, 0],
  [Terrain.Water]: [0, 3],
  [Terrain.Lava]: [0, 4],
  [Terrain.Cliff]: [3, 1],
  [Terrain.Bridge]: [5, 0],
};

const tilesetProfiles: Record<TilesetProfileName, TilesetTerrainMap> = {
  grass: {
    [Terrain.Ground]: [0, 0],
    [Terrain.Difficult]: [1, 0],
    [Terrain.Road]: [3, 0],
  },
  sand: {
    [Terrain.Ground]: [0, 1],
    [Terrain.Difficult]: [1, 1],
    [Terrain.Road]: [3, 0],
  },
  mountain: {
    [Terrain.Ground]: [0, 2],
    [Terrain.Difficult]: [1, 2],
    [Terrain.Road]: [4, 0],
  },
  snow: {
    [Terrain.Ground]: [2, 2],
    [Terrain.Difficult]: [3, 2],
    [Terrain.Road]: [3, 0],
  },
};

const tilesetProfileByMode: Partial<
  Record<LandscapeMode, TilesetProfileName>
> = {
  "desert-canyon": "sand",
  badlands: "sand",
  "mountain-pass": "mountain",
  highlands: "mountain",
  sewer: "mountain",
  underground: "mountain",
  volcanic: "mountain",
  "frozen-lake": "snow",
};

function tilesetCoordinate(
  terrain: TerrainKind,
  mode: LandscapeMode,
): TilesetCoordinate | undefined {
  const profileName = tilesetProfileByMode[mode] ?? "grass";
  return tilesetProfiles[profileName][terrain] ??
    sharedTilesetCoordinates[terrain];
}

function createTilesetTilePattern(
  image: CanvasImageSource,
  coordinate: TilesetCoordinate,
  context: CanvasRenderingContext2D,
  cellSize: number,
  quarterTurns = 0,
  tint?: string,
  tintStrength = .5,
) {
  const tile = document.createElement("canvas");
  tile.width = cellSize;
  tile.height = cellSize;
  const tileContext = tile.getContext("2d")!;
  tileContext.imageSmoothingEnabled = false;
  tileContext.translate(cellSize / 2, cellSize / 2);
  tileContext.rotate(quarterTurns * Math.PI / 2);
  tileContext.drawImage(
    image,
    coordinate[0] * 32,
    coordinate[1] * 32,
    32,
    32,
    -cellSize / 2,
    -cellSize / 2,
    cellSize,
    cellSize,
  );
  if (tint) {
    tileContext.setTransform(1, 0, 0, 1, 0, 0);
    tileContext.globalCompositeOperation = "source-atop";
    tileContext.globalAlpha = tintStrength;
    tileContext.fillStyle = tint;
    tileContext.fillRect(0, 0, cellSize, cellSize);
    tileContext.globalAlpha = 1;
    tileContext.globalCompositeOperation = "source-over";
  }
  return context.createPattern(tile, "repeat");
}

function createTilesetPatterns(
  image: CanvasImageSource | undefined,
  mode: LandscapeMode,
  context: CanvasRenderingContext2D,
  cellSize: number,
) {
  const patterns = new Map<TerrainKind, CanvasPattern>();
  if (!image) return patterns;
  for (const terrain of terrainPaintOrder) {
    const coordinate = tilesetCoordinate(terrain, mode);
    if (!coordinate) continue;
    const pattern = createTilesetTilePattern(
      image,
      coordinate,
      context,
      cellSize,
      0,
      getTerrainStyle(terrain, mode).color,
      terrain === Terrain.Cliff
        ? .58
        : terrain === Terrain.Ground || terrain === Terrain.Difficult
          ? .48
          : terrain === Terrain.Water || terrain === Terrain.Lava
            ? .34
            : .42,
    );
    if (pattern) patterns.set(terrain, pattern);
  }
  return patterns;
}

function underlyingTerrain(grid: Grid, x: number, y: number): TerrainKind {
  const terrain = grid[y][x].terrain;
  if (tileSurface(grid[y][x]) && !overlayTerrains.has(terrain)) return terrain;
  if (!overlayTerrains.has(terrain)) return terrain;
  const canUnderlay = (kind: TerrainKind) =>
    !overlayTerrains.has(kind) &&
    !(terrain === Terrain.Road && kind === Terrain.Cliff);

  for (let radius = 1; radius <= 3; radius += 1) {
    const candidates = [
      grid[y - radius]?.[x]?.terrain,
      grid[y + radius]?.[x]?.terrain,
      grid[y]?.[x - radius]?.terrain,
      grid[y]?.[x + radius]?.terrain,
    ].filter((kind): kind is TerrainKind =>
      kind !== undefined && canUnderlay(kind)
    );
    if (candidates.length) {
      return candidates.sort((a, b) =>
        terrainPriority[a] - terrainPriority[b]
      )[0];
    }
  }
  return Terrain.Ground;
}

function terrainBackdropTerrain(
  grid: Grid,
  x: number,
  y: number,
  excludedTerrain: TerrainKind,
): TerrainKind {
  for (let radius = 1; radius <= 3; radius += 1) {
    const candidates = [
      grid[y - radius]?.[x]?.terrain,
      grid[y + radius]?.[x]?.terrain,
      grid[y]?.[x - radius]?.terrain,
      grid[y]?.[x + radius]?.terrain,
    ].filter((kind): kind is TerrainKind =>
      kind !== undefined &&
      kind !== excludedTerrain &&
      !overlayTerrains.has(kind)
    );
    if (candidates.length) {
      return candidates.sort((a, b) =>
        terrainPriority[a] - terrainPriority[b]
      )[0];
    }
  }
  return Terrain.Ground;
}

function fillCliffMaskCell(
  context: CanvasRenderingContext2D,
  grid: Grid,
  x: number,
  y: number,
  cellSize: number,
  minimumElevation = 1,
) {
  const isCliff = (cellX: number, cellY: number) =>
    outsideGrid(grid, cellX, cellY) ||
    (
      grid[cellY]?.[cellX]?.terrain === Terrain.Cliff &&
      (grid[cellY][cellX].elevation ?? 1) >= minimumElevation
    );
  const left = x * cellSize;
  const top = y * cellSize;
  const right = left + cellSize;
  const bottom = top + cellSize;
  const topRadius = cellSize * .3;
  const bottomRadius = cellSize * .42;
  const topLeftRadius = !isCliff(x - 1, y) && !isCliff(x, y - 1)
    ? topRadius
    : 0;
  const topRightRadius = !isCliff(x + 1, y) && !isCliff(x, y - 1)
    ? topRadius
    : 0;
  const bottomRightRadius = !isCliff(x + 1, y) && !isCliff(x, y + 1)
    ? bottomRadius
    : 0;
  const bottomLeftRadius = !isCliff(x - 1, y) && !isCliff(x, y + 1)
    ? bottomRadius
    : 0;

  context.beginPath();
  context.moveTo(left + topLeftRadius, top);
  context.lineTo(right - topRightRadius, top);
  context.bezierCurveTo(
    right - topRightRadius * .45,
    top,
    right,
    top + topRightRadius * .45,
    right,
    top + topRightRadius,
  );
  context.lineTo(right, bottom - bottomRightRadius);
  context.quadraticCurveTo(right, bottom, right - bottomRightRadius, bottom);
  context.lineTo(left + bottomLeftRadius, bottom);
  context.quadraticCurveTo(left, bottom, left, bottom - bottomLeftRadius);
  context.lineTo(left, top + topLeftRadius);
  context.bezierCurveTo(
    left,
    top + topLeftRadius * .45,
    left + topLeftRadius * .45,
    top,
    left + topLeftRadius,
    top,
  );
  context.closePath();
  context.fill();
}

function fillWaterMaskCell(
  context: CanvasRenderingContext2D,
  grid: Grid,
  x: number,
  y: number,
  cellSize: number,
) {
  const isWater = (cellX: number, cellY: number) =>
    outsideGrid(grid, cellX, cellY) ||
    (
      grid[cellY]?.[cellX] !== undefined &&
      underlyingTerrain(grid, cellX, cellY) === Terrain.Water
    );
  const left = x * cellSize;
  const top = y * cellSize;
  const right = left + cellSize;
  const bottom = top + cellSize;
  const radius = cellSize * .14;
  const topLeftRadius = !isWater(x - 1, y) && !isWater(x, y - 1) ? radius : 0;
  const topRightRadius = !isWater(x + 1, y) && !isWater(x, y - 1) ? radius : 0;
  const bottomRightRadius = !isWater(x + 1, y) && !isWater(x, y + 1)
    ? radius
    : 0;
  const bottomLeftRadius = !isWater(x - 1, y) && !isWater(x, y + 1)
    ? radius
    : 0;

  context.beginPath();
  context.moveTo(left + topLeftRadius, top);
  context.lineTo(right - topRightRadius, top);
  context.quadraticCurveTo(right, top, right, top + topRightRadius);
  context.lineTo(right, bottom - bottomRightRadius);
  context.quadraticCurveTo(right, bottom, right - bottomRightRadius, bottom);
  context.lineTo(left + bottomLeftRadius, bottom);
  context.quadraticCurveTo(left, bottom, left, bottom - bottomLeftRadius);
  context.lineTo(left, top + topLeftRadius);
  context.quadraticCurveTo(left, top, left + topLeftRadius, top);
  context.closePath();
  context.fill();
}

function fillLavaMaskCell(
  context: CanvasRenderingContext2D,
  grid: Grid,
  x: number,
  y: number,
  cellSize: number,
) {
  const isLava = (cellX: number, cellY: number) =>
    outsideGrid(grid, cellX, cellY) ||
    (
      grid[cellY]?.[cellX] !== undefined &&
      underlyingTerrain(grid, cellX, cellY) === Terrain.Lava
    );
  const left = x * cellSize;
  const top = y * cellSize;
  const right = left + cellSize;
  const bottom = top + cellSize;
  const radius = cellSize * .2;
  const topLeftRadius = !isLava(x - 1, y) && !isLava(x, y - 1) ? radius : 0;
  const topRightRadius = !isLava(x + 1, y) && !isLava(x, y - 1) ? radius : 0;
  const bottomRightRadius = !isLava(x + 1, y) && !isLava(x, y + 1)
    ? radius
    : 0;
  const bottomLeftRadius = !isLava(x - 1, y) && !isLava(x, y + 1)
    ? radius
    : 0;
  const tension = .32;

  context.beginPath();
  context.moveTo(left + topLeftRadius, top);
  context.lineTo(right - topRightRadius, top);
  context.bezierCurveTo(
    right - topRightRadius * tension,
    top,
    right,
    top + topRightRadius * tension,
    right,
    top + topRightRadius,
  );
  context.lineTo(right, bottom - bottomRightRadius);
  context.bezierCurveTo(
    right,
    bottom - bottomRightRadius * tension,
    right - bottomRightRadius * tension,
    bottom,
    right - bottomRightRadius,
    bottom,
  );
  context.lineTo(left + bottomLeftRadius, bottom);
  context.bezierCurveTo(
    left + bottomLeftRadius * tension,
    bottom,
    left,
    bottom - bottomLeftRadius * tension,
    left,
    bottom - bottomLeftRadius,
  );
  context.lineTo(left, top + topLeftRadius);
  context.bezierCurveTo(
    left,
    top + topLeftRadius * tension,
    left + topLeftRadius * tension,
    top,
    left + topLeftRadius,
    top,
  );
  context.closePath();
  context.fill();
}

function fillRavineMaskCell(
  context: CanvasRenderingContext2D,
  grid: Grid,
  x: number,
  y: number,
  cellSize: number,
) {
  const isRavine = (cellX: number, cellY: number) =>
    outsideGrid(grid, cellX, cellY) ||
    grid[cellY]?.[cellX]?.terrain === Terrain.Ravine;
  const left = x * cellSize;
  const top = y * cellSize;
  const segmentCount = 5;
  const points: Array<{ x: number; y: number }> = [];

  const addEdge = (
    side: 0 | 1 | 2 | 3,
    exposed: boolean,
  ) => {
    for (let index = side === 0 ? 0 : 1; index <= segmentCount; index += 1) {
      const ratio = index / segmentCount;
      const progress = side === 2 || side === 3 ? 1 - ratio : ratio;
      const edgeNoise = index === 0 || index === segmentCount || !exposed
        ? 0
        : (
          terrainVariation(
            x * segmentCount + index,
            y * 4 + side,
            733 + side * 41,
          ) - .5
        ) * cellSize * .16;
      if (side === 0) {
        points.push({ x: left + progress * cellSize, y: top + edgeNoise });
      } else if (side === 1) {
        points.push({
          x: left + cellSize + edgeNoise,
          y: top + progress * cellSize,
        });
      } else if (side === 2) {
        points.push({
          x: left + progress * cellSize,
          y: top + cellSize + edgeNoise,
        });
      } else {
        points.push({ x: left + edgeNoise, y: top + progress * cellSize });
      }
    }
  };

  addEdge(0, !isRavine(x, y - 1));
  addEdge(1, !isRavine(x + 1, y));
  addEdge(2, !isRavine(x, y + 1));
  addEdge(3, !isRavine(x - 1, y));

  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    context.lineTo(points[index].x, points[index].y);
  }
  context.closePath();
  context.fill();
}

function createTerrainMask(
  grid: Grid,
  terrain: TerrainKind,
  cellSize: number,
  width: number,
  height: number,
  includeUnderlying = true,
) {
  const mask = document.createElement("canvas");
  mask.width = width;
  mask.height = height;
  const maskContext = mask.getContext("2d")!;
  maskContext.fillStyle = "#fff";
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      const tileTerrain = includeUnderlying
        ? underlyingTerrain(grid, x, y)
        : grid[y][x].terrain;
      if (tileTerrain === terrain) {
        if (terrain === Terrain.Cliff) {
          fillCliffMaskCell(maskContext, grid, x, y, cellSize);
        } else if (terrain === Terrain.Water) {
          fillWaterMaskCell(maskContext, grid, x, y, cellSize);
        } else if (terrain === Terrain.Lava) {
          fillLavaMaskCell(maskContext, grid, x, y, cellSize);
        } else if (terrain === Terrain.Ravine) {
          fillRavineMaskCell(maskContext, grid, x, y, cellSize);
        } else {
          maskContext.fillRect(
            x * cellSize,
            y * cellSize,
            cellSize,
            cellSize,
          );
        }
      }
    }
  }
  return mask;
}

function createCliffElevationMask(
  grid: Grid,
  minimumElevation: number,
  cellSize: number,
  width: number,
  height: number,
) {
  const mask = document.createElement("canvas");
  mask.width = width;
  mask.height = height;
  const maskContext = mask.getContext("2d")!;
  maskContext.fillStyle = "#fff";
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      if (
        grid[y][x].terrain === Terrain.Cliff &&
        (grid[y][x].elevation ?? 1) >= minimumElevation
      ) {
        fillCliffMaskCell(
          maskContext,
          grid,
          x,
          y,
          cellSize,
          minimumElevation,
        );
      }
    }
  }
  return mask;
}

function drawDifficultTerrainContour(
  grid: Grid,
  cellSize: number,
  mode: LandscapeMode,
  opacity: number,
  context: CanvasRenderingContext2D,
) {
  const isDifficult = (x: number, y: number) =>
    grid[y]?.[x] !== undefined &&
    underlyingTerrain(grid, x, y) === Terrain.Difficult;
  const segmentCount = 6;
  const outsideIsDifficult = (x: number, y: number) =>
    outsideGrid(grid, x, y);

  const drawEdge = (
    x: number,
    y: number,
    side: 0 | 1 | 2 | 3,
  ) => {
    const horizontal = side === 0 || side === 2;
    const reverse = side === 2 || side === 3;
    const baseX = x * cellSize;
    const baseY = y * cellSize;
    const points: Array<{ x: number; y: number }> = [];

    for (let index = 0; index <= segmentCount; index += 1) {
      const ratio = index / segmentCount;
      const progress = reverse ? 1 - ratio : ratio;
      const jitter = (
        terrainVariation(
          x * segmentCount + index,
          y * 4 + side,
          211 + side * 37,
        ) - .5
      ) * cellSize * .075;
      const edgeX = horizontal
        ? baseX + progress * cellSize
        : baseX + (side === 1 ? cellSize : 0);
      const edgeY = horizontal
        ? baseY + (side === 2 ? cellSize : 0)
        : baseY + progress * cellSize;
      points.push({
        x: edgeX + (horizontal ? 0 : jitter),
        y: edgeY + (horizontal ? jitter : 0),
      });
    }

    for (let index = 0; index < segmentCount; index += 1) {
      const alphaNoise = terrainVariation(
        x * segmentCount + index,
        y * 4 + side,
        419 + side * 53,
      );
      context.globalAlpha = opacity * (.48 + alphaNoise * .42);
      context.beginPath();
      context.moveTo(points[index].x, points[index].y);
      context.lineTo(points[index + 1].x, points[index + 1].y);
      context.stroke();
    }
  };

  context.save();
  context.strokeStyle = getTerrainStyle(Terrain.Difficult, mode).color;
  context.lineWidth = Math.max(1.5, cellSize * .075);
  context.lineCap = "round";
  context.lineJoin = "round";
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      if (!isDifficult(x, y)) continue;
      if (!outsideIsDifficult(x, y - 1) && !isDifficult(x, y - 1)) {
        drawEdge(x, y, 0);
      }
      if (!outsideIsDifficult(x + 1, y) && !isDifficult(x + 1, y)) {
        drawEdge(x, y, 1);
      }
      if (!outsideIsDifficult(x, y + 1) && !isDifficult(x, y + 1)) {
        drawEdge(x, y, 2);
      }
      if (!outsideIsDifficult(x - 1, y) && !isDifficult(x - 1, y)) {
        drawEdge(x, y, 3);
      }
    }
  }
  context.restore();
}

function drawRavineUpperEdges(
  grid: Grid,
  cellSize: number,
  opacity: number,
  context: CanvasRenderingContext2D,
) {
  const segmentCount = 5;
  const effect = document.createElement("canvas");
  effect.width = grid[0].length * cellSize;
  effect.height = grid.length * cellSize;
  const effectContext = effect.getContext("2d")!;
  effectContext.lineCap = "round";
  effectContext.lineJoin = "round";

  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      if (
        grid[y][x].terrain !== Terrain.Ravine ||
        y === 0 ||
        grid[y - 1]?.[x]?.terrain === Terrain.Ravine
      ) {
        continue;
      }
      const points: Array<{ x: number; y: number }> = [];
      for (let index = 0; index <= segmentCount; index += 1) {
        const edgeNoise = index === 0 || index === segmentCount
          ? 0
          : (
            terrainVariation(
              x * segmentCount + index,
              y * 4,
              733,
            ) - .5
          ) * cellSize * .16;
        points.push({
          x: (x + index / segmentCount) * cellSize,
          y: y * cellSize + edgeNoise,
        });
      }

      const strokeEdge = (offsetY: number) => {
        effectContext.beginPath();
        effectContext.moveTo(points[0].x, points[0].y + offsetY);
        for (let index = 1; index < points.length; index += 1) {
          effectContext.lineTo(points[index].x, points[index].y + offsetY);
        }
        effectContext.stroke();
      };

      effectContext.strokeStyle = "rgba(17, 18, 16, .3)";
      effectContext.lineWidth = Math.max(4, cellSize * .34);
      strokeEdge(cellSize * .17);
      effectContext.strokeStyle = "rgba(17, 18, 16, .62)";
      effectContext.lineWidth = Math.max(2.5, cellSize * .18);
      strokeEdge(cellSize * .09);
      effectContext.strokeStyle = "rgba(232, 215, 182, .48)";
      effectContext.lineWidth = Math.max(1, cellSize * .035);
      strokeEdge(0);
    }
  }

  const mask = createTerrainMask(
    grid,
    Terrain.Ravine,
    cellSize,
    effect.width,
    effect.height,
    false,
  );
  effectContext.globalCompositeOperation = "destination-in";
  effectContext.drawImage(mask, 0, 0);

  context.save();
  context.globalAlpha = opacity;
  context.drawImage(effect, 0, 0);
  context.restore();

}

function drawLiquidUpperEdges(
  grid: Grid,
  cellSize: number,
  terrain: typeof Terrain.Water | typeof Terrain.Lava,
  opacity: number,
  context: CanvasRenderingContext2D,
) {
  const segmentCount = 5;
  const effect = document.createElement("canvas");
  effect.width = grid[0].length * cellSize;
  effect.height = grid.length * cellSize;
  const effectContext = effect.getContext("2d")!;
  effectContext.lineCap = "round";
  effectContext.lineJoin = "round";
  const isLiquid = (x: number, y: number) =>
    outsideGrid(grid, x, y) ||
    (
      grid[y]?.[x] !== undefined &&
      underlyingTerrain(grid, x, y) === terrain
    );
  const lava = terrain === Terrain.Lava;

  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      if (!isLiquid(x, y) || isLiquid(x, y - 1)) continue;

      const points: Array<{ x: number; y: number }> = [];
      for (let index = 0; index <= segmentCount; index += 1) {
        const edgeNoise = index === 0 || index === segmentCount
          ? 0
          : (
            terrainVariation(
              x * segmentCount + index,
              y * 4,
              lava ? 1031 : 947,
            ) - .5
          ) * cellSize * .07;
        points.push({
          x: (x + index / segmentCount) * cellSize,
          y: y * cellSize + edgeNoise,
        });
      }

      const strokeEdge = (offsetY: number) => {
        effectContext.beginPath();
        effectContext.moveTo(points[0].x, points[0].y + offsetY);
        for (let index = 1; index < points.length; index += 1) {
          effectContext.lineTo(points[index].x, points[index].y + offsetY);
        }
        effectContext.stroke();
      };

      effectContext.filter = `blur(${Math.max(1, cellSize * .06)}px)`;
      effectContext.strokeStyle = lava
        ? "rgba(91, 29, 20, .16)"
        : "rgba(30, 65, 68, .13)";
      effectContext.lineWidth = Math.max(5, cellSize * .38);
      strokeEdge(cellSize * .19);
      effectContext.filter = `blur(${Math.max(.75, cellSize * .035)}px)`;
      effectContext.strokeStyle = lava
        ? "rgba(105, 31, 20, .27)"
        : "rgba(35, 72, 75, .23)";
      effectContext.lineWidth = Math.max(3, cellSize * .2);
      strokeEdge(cellSize * .1);
      effectContext.filter = "none";
      effectContext.strokeStyle = lava
        ? "rgba(255, 190, 91, .25)"
        : "rgba(151, 184, 177, .14)";
      effectContext.lineWidth = Math.max(.75, cellSize * .025);
      strokeEdge(0);
    }
  }

  const mask = createTerrainMask(
    grid,
    terrain,
    cellSize,
    effect.width,
    effect.height,
  );
  effectContext.globalCompositeOperation = "destination-in";
  effectContext.drawImage(mask, 0, 0);

  context.save();
  context.globalAlpha = opacity;
  context.drawImage(effect, 0, 0);
  context.restore();

}

function drawLavaRockEdges(
  grid: Grid,
  cellSize: number,
  opacity: number,
  context: CanvasRenderingContext2D,
) {
  const width = grid[0].length * cellSize;
  const height = grid.length * cellSize;
  const effect = document.createElement("canvas");
  effect.width = width;
  effect.height = height;
  const effectContext = effect.getContext("2d")!;
  const edgePath = new Path2D();
  const segmentCount = 6;
  const isLava = (x: number, y: number) =>
    grid[y]?.[x]?.terrain === Terrain.Lava;

  const addEdge = (x: number, y: number, side: 0 | 1 | 2 | 3) => {
    for (let index = 0; index <= segmentCount; index += 1) {
      const ratio = index / segmentCount;
      const progress = side === 2 || side === 3 ? 1 - ratio : ratio;
      const jitter = index === 0 || index === segmentCount
        ? 0
        : (
          terrainVariation(
            x * segmentCount + index,
            y * 4 + side,
            1423 + side * 61,
          ) - .5
        ) * cellSize * .08;
      const point = side === 0
        ? { x: (x + progress) * cellSize, y: y * cellSize + jitter }
        : side === 1
          ? { x: (x + 1) * cellSize + jitter, y: (y + progress) * cellSize }
          : side === 2
            ? {
              x: (x + progress) * cellSize,
              y: (y + 1) * cellSize + jitter,
            }
            : { x: x * cellSize + jitter, y: (y + progress) * cellSize };
      if (index === 0) edgePath.moveTo(point.x, point.y);
      else edgePath.lineTo(point.x, point.y);
    }
  };

  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      if (!isLava(x, y)) continue;
      if (y > 0 && !isLava(x, y - 1)) addEdge(x, y, 0);
      if (x < grid[y].length - 1 && !isLava(x + 1, y)) addEdge(x, y, 1);
      if (y < grid.length - 1 && !isLava(x, y + 1)) addEdge(x, y, 2);
      if (x > 0 && !isLava(x - 1, y)) addEdge(x, y, 3);
    }
  }

  effectContext.lineCap = "round";
  effectContext.lineJoin = "round";
  effectContext.strokeStyle = "rgba(48, 32, 27, .76)";
  effectContext.lineWidth = Math.max(4, cellSize * .24);
  effectContext.stroke(edgePath);
  effectContext.strokeStyle = "rgba(25, 22, 20, .62)";
  effectContext.lineWidth = Math.max(1.5, cellSize * .075);
  effectContext.stroke(edgePath);

  context.save();
  context.globalAlpha = opacity;
  context.drawImage(effect, 0, 0);
  context.restore();
}

function drawTerrainLayers(
  grid: Grid,
  cellSize: number,
  mode: LandscapeMode,
  hiddenItems: ReadonlySet<string>,
  hiddenOpacity: number,
  width: number,
  height: number,
  tilesetImage: CanvasImageSource | undefined,
  context: CanvasRenderingContext2D,
) {
  const tilesetPatterns = createTilesetPatterns(
    tilesetImage,
    mode,
    context,
    cellSize,
  );
  const terrainFill = (terrain: TerrainKind) =>
    tilesetPatterns.get(terrain) ?? getTerrainStyle(terrain, mode).color;
  const present = new Set<TerrainKind>();
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      const tileTerrain = underlyingTerrain(grid, x, y);
      const terrain = tileTerrain === Terrain.Cliff
        ? terrainBackdropTerrain(grid, x, y, Terrain.Cliff)
        : tileTerrain === Terrain.Water
          ? terrainBackdropTerrain(grid, x, y, Terrain.Water)
          : tileTerrain === Terrain.Lava
            ? terrainBackdropTerrain(grid, x, y, Terrain.Lava)
            : tileTerrain;
      present.add(tileTerrain);
      context.globalAlpha = hiddenItems.has(terrain) ? hiddenOpacity : 1;
      context.fillStyle = terrainFill(terrain);
      context.fillRect(
        x * cellSize,
        y * cellSize,
        cellSize,
        cellSize,
      );
    }
  }
  context.globalAlpha = 1;

  for (const terrain of terrainPaintOrder) {
    if (!present.has(terrain)) continue;
    const mask = createTerrainMask(grid, terrain, cellSize, width, height);
    const layer = document.createElement("canvas");
    layer.width = width;
    layer.height = height;
    const layerContext = layer.getContext("2d")!;
    layerContext.fillStyle = terrainFill(terrain);
    layerContext.fillRect(0, 0, width, height);

    if (terrain !== Terrain.Cliff) {
      const gradient = layerContext.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, "rgba(255,255,255,.09)");
      gradient.addColorStop(.48, "rgba(255,255,255,0)");
      gradient.addColorStop(1, "rgba(19,31,25,.10)");
      layerContext.fillStyle = gradient;
      layerContext.fillRect(0, 0, width, height);
    }

    layerContext.globalCompositeOperation = "destination-in";
    const maskBlur = terrain === Terrain.Ravine
      ? Math.max(.75, cellSize * .035)
      : terrain === Terrain.Cliff
        ? 0
        : Math.max(1.5, cellSize * .11);
    layerContext.filter = maskBlur > 0 ? `blur(${maskBlur}px)` : "none";
    layerContext.drawImage(mask, 0, 0);
    layerContext.filter = "none";
    layerContext.globalCompositeOperation = "source-over";

    context.globalAlpha = hiddenItems.has(terrain) ? hiddenOpacity : 1;
    if (terrain === Terrain.Cliff) {
      context.drawImage(
        createOuterMaskShadow(
          mask,
          Math.max(2, cellSize * .09),
          Math.max(3, cellSize * .15),
          Math.max(2, cellSize * .09),
          "rgba(18, 20, 18, .34)",
        ),
        0,
        0,
      );
    }
    context.drawImage(layer, 0, 0);
    if (terrain === Terrain.Cliff) {
      const sideDepth = Math.max(2, cellSize * .12);
      const sideBlur = Math.max(1, cellSize * .045);
      const lowerBlur = Math.max(2, cellSize * .085);

      context.drawImage(
        createMaskEdge(
          mask,
          sideDepth,
          0,
          sideBlur,
          "rgba(28, 30, 27, .14)",
        ),
        0,
        0,
      );
      context.drawImage(
        createMaskEdge(
          mask,
          -sideDepth,
          0,
          sideBlur,
          "rgba(24, 26, 23, .38)",
        ),
        0,
        0,
      );
      context.drawImage(
        createMaskEdge(
          mask,
          0,
          -Math.max(5, cellSize * .3),
          lowerBlur,
          "rgba(20, 22, 20, .48)",
        ),
        0,
        0,
      );
      context.drawImage(
        createMaskEdge(
          mask,
          0,
          -Math.max(4, cellSize * .18),
          Math.max(1, cellSize * .04),
          "rgba(18, 20, 18, .72)",
        ),
        0,
        0,
      );
      context.drawImage(
        createCliffRockFace(mask, grid, cellSize),
        0,
        0,
      );

      const maximumElevation = Math.max(
        1,
        ...grid.flatMap((row) =>
          row
            .filter((tile) => tile.terrain === Terrain.Cliff)
            .map((tile) => tile.elevation ?? 1)
        ),
      );
      for (let elevation = 2; elevation <= maximumElevation; elevation += 1) {
        const tierMask = createCliffElevationMask(
          grid,
          elevation,
          cellSize,
          width,
          height,
        );
        const tier = document.createElement("canvas");
        tier.width = width;
        tier.height = height;
        const tierContext = tier.getContext("2d")!;
        tierContext.fillStyle = terrainFill(Terrain.Cliff);
        tierContext.fillRect(0, 0, width, height);
        tierContext.globalCompositeOperation = "destination-in";
        tierContext.drawImage(tierMask, 0, 0);
        context.drawImage(
          createOuterMaskShadow(
            tierMask,
            Math.max(2, cellSize * .075),
            Math.max(3, cellSize * .13),
            Math.max(1.5, cellSize * .07),
            "rgba(14, 16, 14, .4)",
          ),
          0,
          0,
        );
        context.drawImage(tier, 0, 0);
        context.drawImage(
          createMaskEdge(
            tierMask,
            -Math.max(2, cellSize * .13),
            0,
            Math.max(1, cellSize * .04),
            "rgba(22, 24, 22, .4)",
          ),
          0,
          0,
        );
        context.drawImage(
          createMaskEdge(
            tierMask,
            0,
            -Math.max(5, cellSize * .3),
            Math.max(2, cellSize * .08),
            "rgba(16, 18, 16, .76)",
          ),
          0,
          0,
        );
        context.drawImage(
          createCliffRockFace(
            tierMask,
            grid,
            cellSize,
            elevation,
          ),
          0,
          0,
        );
      }
    }
    if (terrain === Terrain.Difficult) {
      drawDifficultTerrainContour(
        grid,
        cellSize,
        mode,
        hiddenItems.has(Terrain.Difficult) ? hiddenOpacity : 1,
        context,
      );
    }
  }
  context.globalAlpha = 1;
}

function drawGlobalTexture(
  width: number,
  height: number,
  context: CanvasRenderingContext2D,
) {
  context.save();
  context.globalCompositeOperation = "soft-light";
  for (let y = 0; y < height; y += 7) {
    for (let x = 0; x < width; x += 7) {
      const value = terrainVariation(x, y, 31);
      if (value < .46) continue;
      context.globalAlpha = .018 + value * .022;
      context.fillStyle = value > .75 ? "#fff" : "#243329";
      context.fillRect(x, y, 1.2, 1.2);
    }
  }
  context.restore();
}

function createEdgeExtendedMask(
  mask: HTMLCanvasElement,
  padding: number,
) {
  const extended = document.createElement("canvas");
  extended.width = mask.width + padding * 2;
  extended.height = mask.height + padding * 2;
  const context = extended.getContext("2d")!;
  context.imageSmoothingEnabled = false;
  context.drawImage(mask, padding, padding);

  // Repeat the outermost mask pixels into the padding. Blur and offset
  // operations can then distinguish a real terrain boundary from the edge of
  // the canvas instead of treating everything outside the map as transparent.
  context.drawImage(mask, 0, 0, mask.width, 1, padding, 0, mask.width, padding);
  context.drawImage(
    mask,
    0,
    mask.height - 1,
    mask.width,
    1,
    padding,
    padding + mask.height,
    mask.width,
    padding,
  );
  context.drawImage(mask, 0, 0, 1, mask.height, 0, padding, padding, mask.height);
  context.drawImage(
    mask,
    mask.width - 1,
    0,
    1,
    mask.height,
    padding + mask.width,
    padding,
    padding,
    mask.height,
  );

  const corners = [
    [0, 0, 0, 0],
    [mask.width - 1, 0, padding + mask.width, 0],
    [0, mask.height - 1, 0, padding + mask.height],
    [
      mask.width - 1,
      mask.height - 1,
      padding + mask.width,
      padding + mask.height,
    ],
  ] as const;
  for (const [sourceX, sourceY, targetX, targetY] of corners) {
    context.drawImage(
      mask,
      sourceX,
      sourceY,
      1,
      1,
      targetX,
      targetY,
      padding,
      padding,
    );
  }
  return extended;
}

function createMaskEdge(
  mask: HTMLCanvasElement,
  offsetX: number,
  offsetY: number,
  blur: number,
  color: string,
) {
  const padding = Math.ceil(
    Math.max(Math.abs(offsetX), Math.abs(offsetY)) + blur * 3 + 2,
  );
  const extendedMask = createEdgeExtendedMask(mask, padding);
  const working = document.createElement("canvas");
  working.width = extendedMask.width;
  working.height = extendedMask.height;
  const workingContext = working.getContext("2d")!;
  workingContext.drawImage(extendedMask, 0, 0);
  workingContext.globalCompositeOperation = "destination-out";
  workingContext.filter = `blur(${blur}px)`;
  workingContext.drawImage(extendedMask, offsetX, offsetY);
  workingContext.filter = "none";
  workingContext.globalCompositeOperation = "source-in";
  workingContext.fillStyle = color;
  workingContext.fillRect(0, 0, working.width, working.height);

  const edge = document.createElement("canvas");
  edge.width = mask.width;
  edge.height = mask.height;
  const edgeContext = edge.getContext("2d")!;
  edgeContext.drawImage(
    working,
    padding,
    padding,
    mask.width,
    mask.height,
    0,
    0,
    mask.width,
    mask.height,
  );
  return edge;
}

function createOuterMaskShadow(
  mask: HTMLCanvasElement,
  offsetX: number,
  offsetY: number,
  blur: number,
  color: string,
) {
  const shadow = document.createElement("canvas");
  shadow.width = mask.width;
  shadow.height = mask.height;
  const shadowContext = shadow.getContext("2d")!;
  shadowContext.filter = `blur(${blur}px)`;
  shadowContext.drawImage(mask, offsetX, offsetY);
  shadowContext.filter = "none";
  shadowContext.globalCompositeOperation = "destination-out";
  shadowContext.drawImage(mask, 0, 0);
  shadowContext.globalCompositeOperation = "source-in";
  shadowContext.fillStyle = color;
  shadowContext.fillRect(0, 0, shadow.width, shadow.height);
  return shadow;
}

function createCliffRockFace(
  mask: HTMLCanvasElement,
  grid: Grid,
  cellSize: number,
  minimumElevation = 1,
) {
  const face = document.createElement("canvas");
  face.width = mask.width;
  face.height = mask.height;
  const faceContext = face.getContext("2d")!;
  const isCliff = (x: number, y: number) =>
    outsideGrid(grid, x, y) ||
    (
      grid[y]?.[x]?.terrain === Terrain.Cliff &&
      (grid[y][x].elevation ?? 1) >= minimumElevation
    );

  const drawRock = (
    centerX: number,
    centerY: number,
    radius: number,
    variation: number,
  ) => {
    const radiusX = radius * (.78 + variation * .34);
    const radiusY = radius * (1.08 - variation * .2);
    faceContext.fillStyle = "rgba(22, 25, 23, .42)";
    faceContext.beginPath();
    faceContext.ellipse(
      centerX,
      centerY,
      radiusX,
      radiusY,
      (variation - .5) * .5,
      0,
      Math.PI * 2,
    );
    faceContext.fill();
    faceContext.fillStyle = "rgba(194, 194, 176, .3)";
    faceContext.beginPath();
    faceContext.ellipse(
      centerX - radiusX * .22,
      centerY - radiusY * .28,
      radiusX * .42,
      radiusY * .26,
      0,
      0,
      Math.PI * 2,
    );
    faceContext.fill();
  };

  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      if (
        grid[y][x].terrain !== Terrain.Cliff ||
        (grid[y][x].elevation ?? 1) < minimumElevation
      ) {
        continue;
      }
      const left = x * cellSize;
      const top = y * cellSize;

      if (!isCliff(x, y + 1)) {
        for (let index = 0; index < 5; index += 1) {
          const variation = terrainVariation(x * 5 + index, y, 1601);
          drawRock(
            left + cellSize * (index + .5) / 5,
            top + cellSize * (.88 + (variation - .5) * .055),
            cellSize * (.13 + variation * .025),
            variation,
          );
        }
      }
      if (!isCliff(x - 1, y)) {
        for (let index = 0; index < 4; index += 1) {
          const variation = terrainVariation(x, y * 4 + index, 1663);
          drawRock(
            left + cellSize * (.1 + (variation - .5) * .04),
            top + cellSize * (index + .5) / 4,
            cellSize * (.1 + variation * .018),
            variation,
          );
        }
      }
      if (!isCliff(x + 1, y)) {
        for (let index = 0; index < 4; index += 1) {
          const variation = terrainVariation(x, y * 4 + index, 1721);
          drawRock(
            left + cellSize * (.9 + (variation - .5) * .04),
            top + cellSize * (index + .5) / 4,
            cellSize * (.105 + variation * .018),
            variation,
          );
        }
      }
    }
  }

  faceContext.globalCompositeOperation = "destination-in";
  faceContext.drawImage(mask, 0, 0);
  return face;
}

function drawReliefBevels(
  grid: Grid,
  cellSize: number,
  hiddenItems: ReadonlySet<string>,
  hiddenOpacity: number,
  width: number,
  height: number,
  context: CanvasRenderingContext2D,
) {
  const beveledTerrains: TerrainKind[] = [Terrain.Ravine];
  for (const terrain of beveledTerrains) {
    if (!grid.some((row) => row.some((tile) => tile.terrain === terrain))) {
      continue;
    }
    const mask = createTerrainMask(
      grid,
      terrain,
      cellSize,
      width,
      height,
      false,
    );
    const raised = terrain === Terrain.Cliff;
    const depth = raised
      ? Math.max(2, cellSize * .16)
      : Math.max(1.5, cellSize * .1);
    const blur = raised
      ? Math.max(1, cellSize * .07)
      : Math.max(.5, cellSize * .025);
    const topLeft = createMaskEdge(
      mask,
      depth,
      depth,
      blur,
      raised
        ? "rgba(248, 242, 220, .5)"
        : "rgba(235, 202, 151, .62)",
    );
    const bottomRight = createMaskEdge(
      mask,
      -depth,
      -depth,
      blur,
      raised
        ? "rgba(20, 23, 21, .68)"
        : "rgba(224, 185, 132, .55)",
    );
    const wash = document.createElement("canvas");
    wash.width = width;
    wash.height = height;
    const washContext = wash.getContext("2d")!;
    washContext.drawImage(mask, 0, 0);
    washContext.globalCompositeOperation = "source-in";
    washContext.fillStyle = raised ? "#f1ead5" : "#211f1b";
    washContext.fillRect(0, 0, width, height);

    context.save();
    context.globalAlpha = hiddenItems.has(terrain) ? hiddenOpacity : 1;
    context.drawImage(topLeft, 0, 0);
    context.drawImage(bottomRight, 0, 0);

    // A restrained inner wash makes cliffs feel solid and ravines feel deep
    // while preserving the palette underneath.
    context.globalAlpha *= raised ? .06 : .5;
    context.drawImage(wash, 0, 0);
    context.restore();

    if (raised) {
      context.save();
      context.globalAlpha = hiddenItems.has(terrain) ? hiddenOpacity : .72;
      context.strokeStyle = "rgba(29, 31, 28, .72)";
      context.lineWidth = Math.max(1, cellSize * .035);
      context.lineCap = "round";
      context.beginPath();
      for (let y = 0; y < grid.length; y += 1) {
        for (let x = 0; x < grid[y].length; x += 1) {
          if (grid[y][x].terrain !== Terrain.Cliff) continue;
          const left = x * cellSize;
          const top = y * cellSize;
          const right = left + cellSize;
          const bottom = top + cellSize;
          if (grid[y + 1]?.[x]?.terrain !== Terrain.Cliff) {
            for (const ratio of [.28, .62]) {
              const jitter = (
                terrainVariation(x, y, Math.round(ratio * 100)) - .5
              ) * cellSize * .08;
              const hatchX = left + cellSize * ratio + jitter;
              context.moveTo(hatchX, bottom - cellSize * .03);
              context.lineTo(
                hatchX - cellSize * .09,
                bottom - cellSize * (.18 + ratio * .05),
              );
            }
          }
          if (grid[y]?.[x + 1]?.terrain !== Terrain.Cliff) {
            for (const ratio of [.32, .7]) {
              const jitter = (
                terrainVariation(x, y, Math.round(ratio * 130)) - .5
              ) * cellSize * .08;
              const hatchY = top + cellSize * ratio + jitter;
              context.moveTo(right - cellSize * .03, hatchY);
              context.lineTo(
                right - cellSize * (.18 + ratio * .04),
                hatchY - cellSize * .08,
              );
            }
          }
        }
      }
      context.stroke();
      context.restore();
    }
  }
}

function drawRoadNetwork(
  grid: Grid,
  cellSize: number,
  mode: LandscapeMode,
  hiddenItems: ReadonlySet<string>,
  hiddenOpacity: number,
  tilesetImage: CanvasImageSource | undefined,
  context: CanvasRenderingContext2D,
) {
  const roadTerrains = new Set<TerrainKind>([Terrain.Road, Terrain.Bridge]);
  const roadCells: Array<{ x: number; y: number }> = [];
  const bridgeCells: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      const surface = tileSurface(grid[y][x]);
      if (surface && roadTerrains.has(surface)) roadCells.push({ x, y });
      if (surface === Terrain.Bridge) bridgeCells.push({ x, y });
    }
  }
  if (!roadCells.length) return;

  const roadKeys = new Set(roadCells.map(({ x, y }) => `${x},${y}`));
  const roadEdgePoints = (
    x: number,
    y: number,
    side: 0 | 1 | 2 | 3,
    exposed: boolean,
  ) => {
    const points: Array<{ x: number; y: number }> = [];
    const segmentCount = 6;
    for (let index = 0; index <= segmentCount; index += 1) {
      const ratio = index / segmentCount;
      const progress = side === 2 || side === 3 ? 1 - ratio : ratio;
      const erosion = exposed
        ? cellSize * (
          .025 +
          terrainVariation(
            x * segmentCount + index,
            y * 4 + side,
            1201 + side * 47,
          ) * .11
        )
        : 0;
      if (side === 0) {
        points.push({
          x: (x + progress) * cellSize,
          y: y * cellSize + erosion,
        });
      } else if (side === 1) {
        points.push({
          x: (x + 1) * cellSize - erosion,
          y: (y + progress) * cellSize,
        });
      } else if (side === 2) {
        points.push({
          x: (x + progress) * cellSize,
          y: (y + 1) * cellSize - erosion,
        });
      } else {
        points.push({
          x: x * cellSize + erosion,
          y: (y + progress) * cellSize,
        });
      }
    }
    return points;
  };

  const roadFootprint = new Path2D();
  const roadEdges = new Path2D();
  for (const { x, y } of roadCells) {
    if (tileSurface(grid[y][x]) === Terrain.Bridge) {
      roadFootprint.rect(x * cellSize, y * cellSize, cellSize, cellSize);
      continue;
    }
    const exposed = [
      y > 0 && !roadKeys.has(`${x},${y - 1}`),
      x < grid[y].length - 1 && !roadKeys.has(`${x + 1},${y}`),
      y < grid.length - 1 && !roadKeys.has(`${x},${y + 1}`),
      x > 0 && !roadKeys.has(`${x - 1},${y}`),
    ];
    const sides = exposed.map((isExposed, side) =>
      roadEdgePoints(x, y, side as 0 | 1 | 2 | 3, isExposed)
    );
    roadFootprint.moveTo(sides[0][0].x, sides[0][0].y);
    for (const points of sides) {
      for (let index = 1; index < points.length; index += 1) {
        roadFootprint.lineTo(points[index].x, points[index].y);
      }
    }
    roadFootprint.closePath();

    for (let side = 0; side < sides.length; side += 1) {
      if (!exposed[side]) continue;
      const points = sides[side];
      roadEdges.moveTo(points[0].x, points[0].y);
      for (let index = 1; index < points.length; index += 1) {
        roadEdges.lineTo(points[index].x, points[index].y);
      }
    }
  }

  context.save();
  context.globalAlpha = hiddenItems.has(Terrain.Road) ? hiddenOpacity : 1;
  context.shadowColor = "rgba(70, 58, 43, .25)";
  context.shadowBlur = Math.max(1, cellSize * .09);
  const roadCoordinate = tilesetCoordinate(Terrain.Road, mode);
  const roadPattern = tilesetImage && roadCoordinate
    ? createTilesetTilePattern(
      tilesetImage,
      roadCoordinate,
      context,
      cellSize,
      0,
      getTerrainStyle(Terrain.Road, mode).color,
      .42,
    )
    : undefined;
  context.fillStyle =
    roadPattern ?? getTerrainStyle(Terrain.Road, mode).color;
  context.fill(roadFootprint);
  context.shadowColor = "transparent";

  const roadGradient = context.createLinearGradient(
    0,
    0,
    grid[0].length * cellSize,
    grid.length * cellSize,
  );
  roadGradient.addColorStop(0, "rgba(255, 244, 216, .13)");
  roadGradient.addColorStop(1, "rgba(78, 61, 43, .12)");
  context.save();
  context.clip(roadFootprint);
  context.fillStyle = roadGradient;
  context.fillRect(
    0,
    0,
    grid[0].length * cellSize,
    grid.length * cellSize,
  );
  context.restore();

  context.save();
  context.clip(roadFootprint);
  const transitionKeys = new Set(
    roadCells
      .filter(({ x, y }) =>
        grid[y][x].transition && tileSurface(grid[y][x]) === Terrain.Road
      )
      .map(({ x, y }) => `${x},${y}`),
  );
  const pendingTransitions = new Set(transitionKeys);
  while (pendingTransitions.size) {
    const first = pendingTransitions.values().next().value as string;
    const [firstX, firstY] = first.split(",").map(Number);
    const component = [{ x: firstX, y: firstY }];
    pendingTransitions.delete(first);
    for (let index = 0; index < component.length; index += 1) {
      const point = component[index];
      for (const [offsetX, offsetY] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const key = `${point.x + offsetX},${point.y + offsetY}`;
        if (!pendingTransitions.has(key)) continue;
        pendingTransitions.delete(key);
        component.push({ x: point.x + offsetX, y: point.y + offsetY });
      }
    }

    let horizontalConnections = 0;
    let verticalConnections = 0;
    for (const { x, y } of component) {
      horizontalConnections += Number(roadKeys.has(`${x - 1},${y}`)) +
        Number(roadKeys.has(`${x + 1},${y}`));
      verticalConnections += Number(roadKeys.has(`${x},${y - 1}`)) +
        Number(roadKeys.has(`${x},${y + 1}`));
    }
    let axisX = horizontalConnections >= verticalConnections ? 1 : 0;
    let axisY = verticalConnections > horizontalConnections ? 1 : 0;
    const endpointHeight = (direction: number) => {
      const heights = component.flatMap(({ x, y }) => {
        const neighborX = x + axisX * direction;
        const neighborY = y + axisY * direction;
        if (transitionKeys.has(`${neighborX},${neighborY}`)) return [];
        const height = grid[neighborY]?.[neighborX]?.height;
        return height === undefined ? [] : [height];
      });
      return heights.length
        ? heights.reduce((sum, height) => sum + height, 0) / heights.length
        : undefined;
    };
    const negativeHeight = endpointHeight(-1);
    const positiveHeight = endpointHeight(1);
    const storedDirection = component.reduce((score, { x, y }) =>
      score + (grid[y][x].transitionNormalX ?? 0) * axisX +
        (grid[y][x].transitionNormalY ?? 0) * axisY, 0);
    const highSide = negativeHeight !== undefined && positiveHeight !== undefined
      ? Math.sign(positiveHeight - negativeHeight)
      : Math.sign(storedDirection);
    // Keep the drawing axis directed from the low end towards the high end.
    if (highSide < 0) {
      axisX *= -1;
      axisY *= -1;
    }
    const minimumX = Math.min(...component.map(({ x }) => x));
    const maximumX = Math.max(...component.map(({ x }) => x));
    const minimumY = Math.min(...component.map(({ y }) => y));
    const maximumY = Math.max(...component.map(({ y }) => y));
    const startX = axisX >= 0
      ? minimumX * cellSize
      : (maximumX + 1) * cellSize;
    const startY = axisY >= 0
      ? minimumY * cellSize
      : (maximumY + 1) * cellSize;
    const endX = axisX >= 0
      ? (maximumX + 1) * cellSize
      : minimumX * cellSize;
    const endY = axisY >= 0
      ? (maximumY + 1) * cellSize
      : minimumY * cellSize;
    const rampFootprint = new Path2D();
    for (const { x, y } of component) {
      rampFootprint.rect(x * cellSize, y * cellSize, cellSize, cellSize);
    }

    context.save();
    const rampGradient = context.createLinearGradient(startX, startY, endX, endY);
    rampGradient.addColorStop(0, "rgba(255, 241, 205, 0)");
    rampGradient.addColorStop(.2, "rgba(255, 241, 205, .07)");
    rampGradient.addColorStop(.52, "rgba(92, 69, 47, .025)");
    rampGradient.addColorStop(.82, "rgba(49, 38, 28, .1)");
    rampGradient.addColorStop(1, "rgba(49, 38, 28, 0)");
    context.fillStyle = rampGradient;
    // Blurring the component itself feathers every edge into the normal road;
    // transparent gradient ends avoid a visible seam on flat terrain.
    context.filter = `blur(${Math.max(1, cellSize * .28)}px)`;
    context.fill(rampFootprint);
    context.restore();
  }
  context.restore();

  context.globalAlpha = hiddenItems.has(Terrain.Road)
    ? hiddenOpacity
    : .72;
  context.strokeStyle = getTerrainStyle(Terrain.Road, mode).alt;
  context.lineWidth = Math.max(1.5, cellSize * .075);
  context.stroke(roadEdges);
  context.globalAlpha = hiddenItems.has(Terrain.Road) ? hiddenOpacity : 1;

  if (bridgeCells.length) {
    const bridgeKeys = new Set(
      bridgeCells.map(({ x, y }) => `${x},${y}`),
    );
    const bridgeAxes = new Map<string, "horizontal" | "vertical">();
    const unvisitedBridges = new Set(bridgeKeys);
    while (unvisitedBridges.size) {
      const first = unvisitedBridges.values().next().value as string;
      const queue = [first];
      const component: Array<{ x: number; y: number }> = [];
      unvisitedBridges.delete(first);
      while (queue.length) {
        const key = queue.pop()!;
        const [x, y] = key.split(",").map(Number);
        component.push({ x, y });
        for (const [offsetX, offsetY] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const neighborKey = `${x + offsetX},${y + offsetY}`;
          if (!unvisitedBridges.has(neighborKey)) continue;
          unvisitedBridges.delete(neighborKey);
          queue.push(neighborKey);
        }
      }

      let horizontalConnections = 0;
      let verticalConnections = 0;
      for (const { x, y } of component) {
        if (grid[y]?.[x - 1] && tileSurface(grid[y][x - 1]) === Terrain.Road) {
          horizontalConnections += 1;
        }
        if (grid[y]?.[x + 1] && tileSurface(grid[y][x + 1]) === Terrain.Road) {
          horizontalConnections += 1;
        }
        if (grid[y - 1]?.[x] && tileSurface(grid[y - 1][x]) === Terrain.Road) {
          verticalConnections += 1;
        }
        if (grid[y + 1]?.[x] && tileSurface(grid[y + 1][x]) === Terrain.Road) {
          verticalConnections += 1;
        }
      }
      const componentWidth =
        Math.max(...component.map(({ x }) => x)) -
        Math.min(...component.map(({ x }) => x)) + 1;
      const componentHeight =
        Math.max(...component.map(({ y }) => y)) -
        Math.min(...component.map(({ y }) => y)) + 1;
      const axis = horizontalConnections === verticalConnections
        ? componentWidth >= componentHeight ? "horizontal" : "vertical"
        : horizontalConnections > verticalConnections
          ? "horizontal"
          : "vertical";
      for (const { x, y } of component) bridgeAxes.set(`${x},${y}`, axis);
    }
    const bridgeAxis = (x: number, y: number) =>
      bridgeAxes.get(`${x},${y}`) ?? "horizontal";

    const bridgeFootprint = new Path2D();
    const horizontalBridgeFootprint = new Path2D();
    const verticalBridgeFootprint = new Path2D();
    const bridgeShadow = new Path2D();
    const bridgeUnderlay = new Path2D();
    const bridgeLightEdge = new Path2D();
    const bridgeDarkEdge = new Path2D();
    const isBridgeUnderlay = (x: number, y: number) =>
      grid[y]?.[x]?.terrain === Terrain.Water ||
      grid[y]?.[x]?.terrain === Terrain.Ravine;
    for (let y = 0; y < grid.length; y += 1) {
      for (let x = 0; x < grid[y].length; x += 1) {
        if (isBridgeUnderlay(x, y)) {
          bridgeUnderlay.rect(
            x * cellSize,
            y * cellSize,
            cellSize,
            cellSize,
          );
        }
      }
    }
    for (const { x, y } of bridgeCells) {
      const left = x * cellSize;
      const top = y * cellSize;
      const right = left + cellSize;
      const bottom = top + cellSize;
      const axis = bridgeAxis(x, y);
      const shadowOffset = cellSize * .08;
      bridgeFootprint.rect(left, top, cellSize, cellSize);
      if (axis === "horizontal") {
        horizontalBridgeFootprint.rect(left, top, cellSize, cellSize);
      } else {
        verticalBridgeFootprint.rect(left, top, cellSize, cellSize);
      }
      bridgeShadow.rect(
        left + shadowOffset,
        top + shadowOffset,
        cellSize,
        cellSize,
      );
      if (axis === "horizontal") {
        if (!bridgeKeys.has(`${x},${y - 1}`) && isBridgeUnderlay(x, y - 1)) {
          bridgeLightEdge.moveTo(left, top);
          bridgeLightEdge.lineTo(right, top);
        }
        if (!bridgeKeys.has(`${x},${y + 1}`) && isBridgeUnderlay(x, y + 1)) {
          bridgeDarkEdge.moveTo(left, bottom);
          bridgeDarkEdge.lineTo(right, bottom);
        }
      } else {
        if (!bridgeKeys.has(`${x - 1},${y}`) && isBridgeUnderlay(x - 1, y)) {
          bridgeLightEdge.moveTo(left, bottom);
          bridgeLightEdge.lineTo(left, top);
        }
        if (!bridgeKeys.has(`${x + 1},${y}`) && isBridgeUnderlay(x + 1, y)) {
          bridgeDarkEdge.moveTo(right, top);
          bridgeDarkEdge.lineTo(right, bottom);
        }
      }
    }
    context.globalAlpha = hiddenItems.has(Terrain.Bridge) ? hiddenOpacity : 1;
    context.save();
    context.clip(bridgeUnderlay);
    context.filter = `blur(${Math.max(1, cellSize * .055)}px)`;
    context.fillStyle = "rgba(28, 24, 20, .38)";
    context.fill(bridgeShadow);
    context.restore();
    const bridgeCoordinate = tilesetCoordinate(Terrain.Bridge, mode);
    const bridgePattern = tilesetImage && bridgeCoordinate
      ? createTilesetTilePattern(
        tilesetImage,
        bridgeCoordinate,
        context,
        cellSize,
        0,
        getTerrainStyle(Terrain.Bridge, mode).color,
        .45,
      )
      : undefined;
    if (bridgePattern && tilesetImage && bridgeCoordinate) {
      context.fillStyle = bridgePattern;
      context.fill(horizontalBridgeFootprint);
      context.fillStyle = createTilesetTilePattern(
        tilesetImage,
        bridgeCoordinate,
        context,
        cellSize,
        1,
        getTerrainStyle(Terrain.Bridge, mode).color,
        .45,
      )!;
      context.fill(verticalBridgeFootprint);
    } else {
      context.fillStyle = getTerrainStyle(Terrain.Bridge, mode).color;
      context.fill(bridgeFootprint);
    }
    context.lineCap = "round";
    context.strokeStyle = "rgba(245, 226, 188, .58)";
    context.lineWidth = Math.max(1.5, cellSize * .065);
    context.stroke(bridgeLightEdge);
    context.strokeStyle = "rgba(54, 39, 28, .72)";
    context.lineWidth = Math.max(2, cellSize * .105);
    context.stroke(bridgeDarkEdge);
  }
  context.restore();
}

function drawShorelines(
  grid: Grid,
  cellSize: number,
  mode: LandscapeMode,
  hiddenItems: ReadonlySet<string>,
  hiddenOpacity: number,
  context: CanvasRenderingContext2D,
) {
  context.save();
  const visibility = hiddenItems.has(Terrain.Water) ? hiddenOpacity : 1;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      if (underlyingTerrain(grid, x, y) !== Terrain.Water) continue;
      const left = x * cellSize;
      const top = y * cellSize;
      const right = left + cellSize;
      const bottom = top + cellSize;
      if (y > 0 && underlyingTerrain(grid, x, y - 1) !== Terrain.Water) {
        context.moveTo(left, top);
        context.quadraticCurveTo((left + right) / 2, top + cellSize * .08, right, top);
      }
      if (x < grid[y].length - 1 && underlyingTerrain(grid, x + 1, y) !== Terrain.Water) {
        context.moveTo(right, top);
        context.quadraticCurveTo(right - cellSize * .08, (top + bottom) / 2, right, bottom);
      }
      if (y < grid.length - 1 && underlyingTerrain(grid, x, y + 1) !== Terrain.Water) {
        context.moveTo(right, bottom);
        context.quadraticCurveTo((left + right) / 2, bottom - cellSize * .08, left, bottom);
      }
      if (x > 0 && underlyingTerrain(grid, x - 1, y) !== Terrain.Water) {
        context.moveTo(left, bottom);
        context.quadraticCurveTo(left + cellSize * .08, (top + bottom) / 2, left, top);
      }
    }
  }
  context.globalAlpha = visibility * .34;
  context.strokeStyle = getTerrainStyle(Terrain.Ground, mode).color;
  context.lineWidth = Math.max(2, cellSize * .12);
  context.stroke();
  context.globalAlpha = visibility * .28;
  context.strokeStyle = getTerrainStyle(Terrain.Water, mode).alt;
  context.lineWidth = Math.max(1, cellSize * .03);
  context.stroke();
  context.restore();
}

type ContinuousMaterialTerrain =
  | typeof Terrain.Water
  | typeof Terrain.Ice
  | typeof Terrain.Lava;

function terrainIsPresent(grid: Grid, terrain: ContinuousMaterialTerrain) {
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      if (underlyingTerrain(grid, x, y) === terrain) return true;
    }
  }
  return false;
}

function createWavePath(
  width: number,
  baseY: number,
  cellSize: number,
  phase: number,
  salt: number,
  slope = 0,
) {
  const path = new Path2D();
  const step = Math.max(5, cellSize * .34);
  const amplitude = cellSize * (.045 + terrainVariation(salt, 0, 2711) * .045);
  for (let x = -cellSize, index = 0; x <= width + cellSize; x += step, index += 1) {
    const broadWave = Math.sin(x / (cellSize * 1.65) + phase) * amplitude;
    const fineWave = Math.sin(x / (cellSize * .7) + phase * 1.7) * amplitude * .28;
    const jitter = (
      terrainVariation(index, salt, 2819) - .5
    ) * cellSize * .018;
    const y = baseY + x * slope + broadWave + fineWave + jitter;
    if (index === 0) path.moveTo(x, y);
    else path.lineTo(x, y);
  }
  return path;
}

function drawWaterMaterial(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  cellSize: number,
) {
  context.lineCap = "round";
  context.lineJoin = "round";
  const spacing = cellSize * .82;
  const bandCount = Math.ceil(height / spacing) + 4;
  for (let band = -2; band < bandCount; band += 1) {
    const phase = terrainVariation(band, 0, 2903) * Math.PI * 2;
    const path = createWavePath(
      width,
      band * spacing + spacing * .5,
      cellSize,
      phase,
      band,
      (terrainVariation(band, 1, 2927) - .5) * .018,
    );
    context.strokeStyle = "rgba(24, 55, 64, .12)";
    context.lineWidth = Math.max(1.4, cellSize * .07);
    context.setLineDash([]);
    context.stroke(path);
    context.strokeStyle = "rgba(226, 244, 239, .2)";
    context.lineWidth = Math.max(.7, cellSize * .022);
    context.setLineDash([cellSize * .62, cellSize * .3]);
    context.lineDashOffset = -terrainVariation(band, 2, 2953) * cellSize;
    context.stroke(path);
  }
  context.setLineDash([]);
}

function drawLavaMaterial(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  cellSize: number,
) {
  context.lineCap = "round";
  context.lineJoin = "round";
  const spacing = cellSize * 1.18;
  const diagonalReach = width * .12;
  const bandCount = Math.ceil((height + diagonalReach) / spacing) + 4;
  for (let band = -3; band < bandCount; band += 1) {
    const phase = terrainVariation(band, 0, 3011) * Math.PI * 2;
    const path = createWavePath(
      width,
      band * spacing,
      cellSize,
      phase,
      band + 97,
      .1 + (terrainVariation(band, 1, 3037) - .5) * .035,
    );
    context.strokeStyle = "rgba(65, 21, 17, .22)";
    context.lineWidth = Math.max(1.8, cellSize * .075);
    context.setLineDash([]);
    context.stroke(path);
    context.strokeStyle = "rgba(255, 202, 101, .2)";
    context.lineWidth = Math.max(.7, cellSize * .02);
    context.setLineDash([cellSize * .42, cellSize * .5]);
    context.lineDashOffset = -terrainVariation(band, 2, 3067) * cellSize * 1.6;
    context.stroke(path);
  }
  context.setLineDash([]);
}

function drawIceCrack(
  context: CanvasRenderingContext2D,
  startX: number,
  startY: number,
  cellSize: number,
  seedX: number,
  seedY: number,
) {
  const segmentCount = 4 + Math.floor(terrainVariation(seedX, seedY, 3121) * 3);
  let angle = terrainVariation(seedX, seedY, 3137) * Math.PI * 2;
  const points = [{ x: startX, y: startY }];
  let x = startX;
  let y = startY;
  for (let segment = 0; segment < segmentCount; segment += 1) {
    angle += (terrainVariation(seedX * 11 + segment, seedY, 3163) - .5) * .82;
    const length = cellSize * (
      .24 + terrainVariation(seedX, seedY * 13 + segment, 3181) * .2
    );
    x += Math.cos(angle) * length;
    y += Math.sin(angle) * length;
    points.push({ x, y });
  }

  const crack = new Path2D();
  crack.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    crack.lineTo(points[index].x, points[index].y);
  }
  context.strokeStyle = "rgba(43, 82, 94, .18)";
  context.lineWidth = Math.max(1.2, cellSize * .045);
  context.stroke(crack);
  context.strokeStyle = "rgba(241, 252, 250, .35)";
  context.lineWidth = Math.max(.65, cellSize * .014);
  context.stroke(crack);

  const branchIndex = 1 + Math.floor(
    terrainVariation(seedX, seedY, 3203) * (points.length - 2)
  );
  const branchStart = points[branchIndex];
  const branchAngle = angle + (
    terrainVariation(seedX, seedY, 3221) > .5 ? 1 : -1
  ) * (.6 + terrainVariation(seedX, seedY, 3251) * .5);
  const branchLength = cellSize * (
    .3 + terrainVariation(seedX, seedY, 3271) * .28
  );
  const branch = new Path2D();
  branch.moveTo(branchStart.x, branchStart.y);
  branch.lineTo(
    branchStart.x + Math.cos(branchAngle) * branchLength,
    branchStart.y + Math.sin(branchAngle) * branchLength,
  );
  context.strokeStyle = "rgba(241, 252, 250, .27)";
  context.lineWidth = Math.max(.6, cellSize * .012);
  context.stroke(branch);
}

function drawIceMaterial(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  cellSize: number,
) {
  context.lineCap = "round";
  context.lineJoin = "round";

  const sheenSpacing = cellSize * 2.1;
  const sheenCount = Math.ceil((height + width * .24) / sheenSpacing) + 3;
  for (let band = -2; band < sheenCount; band += 1) {
    const path = createWavePath(
      width,
      band * sheenSpacing,
      cellSize,
      terrainVariation(band, 0, 3301) * Math.PI * 2,
      band + 211,
      -.2,
    );
    context.strokeStyle = "rgba(245, 255, 253, .12)";
    context.lineWidth = Math.max(2, cellSize * .11);
    context.stroke(path);
  }

  const seedSpacing = cellSize * 2.55;
  const columns = Math.ceil(width / seedSpacing) + 1;
  const rows = Math.ceil(height / seedSpacing) + 1;
  for (let seedY = 0; seedY < rows; seedY += 1) {
    for (let seedX = 0; seedX < columns; seedX += 1) {
      if (terrainVariation(seedX, seedY, 3323) < .38) continue;
      const startX = (seedX + terrainVariation(seedX, seedY, 3343) * .88) * seedSpacing;
      const startY = (seedY + terrainVariation(seedX, seedY, 3371) * .88) * seedSpacing;
      drawIceCrack(context, startX, startY, cellSize, seedX, seedY);
    }
  }
}

function drawContinuousLiquidMaterials(
  grid: Grid,
  cellSize: number,
  hiddenItems: ReadonlySet<string>,
  hiddenOpacity: number,
  context: CanvasRenderingContext2D,
) {
  const width = grid[0].length * cellSize;
  const height = grid.length * cellSize;
  const terrains: ContinuousMaterialTerrain[] = [
    Terrain.Water,
    Terrain.Ice,
    Terrain.Lava,
  ];

  for (const terrain of terrains) {
    if (hiddenItems.has(terrain) && hiddenOpacity <= 0) continue;
    if (!terrainIsPresent(grid, terrain)) continue;
    const effect = document.createElement("canvas");
    effect.width = width;
    effect.height = height;
    const effectContext = effect.getContext("2d")!;
    if (terrain === Terrain.Water) {
      drawWaterMaterial(effectContext, width, height, cellSize);
    } else if (terrain === Terrain.Ice) {
      drawIceMaterial(effectContext, width, height, cellSize);
    } else {
      drawLavaMaterial(effectContext, width, height, cellSize);
    }

    const mask = createTerrainMask(
      grid,
      terrain,
      cellSize,
      width,
      height,
    );
    effectContext.globalCompositeOperation = "destination-in";
    effectContext.drawImage(mask, 0, 0);

    context.save();
    context.globalAlpha = hiddenItems.has(terrain) ? hiddenOpacity : 1;
    context.drawImage(effect, 0, 0);
    context.restore();

    // Release the large export-sized buffers before moving to the next
    // material instead of waiting for a later garbage-collection cycle.
    effect.width = 1;
    effect.height = 1;
    mask.width = 1;
    mask.height = 1;
  }
}

function drawTree(
  points: Array<{ x: number; y: number }>,
  size: number,
  mode: LandscapeMode,
  context: CanvasRenderingContext2D,
) {
  const colors = getBiomeObjectStyle(mode).tree;
  const minimumX = Math.min(...points.map(({ x }) => x));
  const maximumX = Math.max(...points.map(({ x }) => x));
  const minimumY = Math.min(...points.map(({ y }) => y));
  const maximumY = Math.max(...points.map(({ y }) => y));
  const centerX = (minimumX + maximumX + 1) * size / 2;
  const centerY = (minimumY + maximumY + 1) * size / 2;
  const radiusX = (maximumX - minimumX + 1) * size * .42;
  const radiusY = (maximumY - minimumY + 1) * size * .42;
  context.save();
  applyPropContactShadow(size, context);
  context.fillStyle = colors.dark;
  context.beginPath();
  context.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
  context.fill();
  context.restore();
  context.fillStyle = colors.light;
  context.beginPath();
  context.ellipse(
    centerX - radiusX * .16,
    centerY - radiusY * .16,
    radiusX * .62,
    radiusY * .62,
    -.15,
    0,
    Math.PI * 2,
  );
  context.fill();
  context.fillStyle = colors.trunk;
  context.beginPath();
  context.arc(centerX, centerY, Math.max(1.2, size * .06), 0, Math.PI * 2);
  context.fill();
}

function drawBuilding(
  points: Array<{ x: number; y: number }>,
  id: number,
  size: number,
  mode: LandscapeMode,
  context: CanvasRenderingContext2D,
) {
  const colors = getBiomeObjectStyle(mode).building;
  const cells = new Set(points.map(({ x, y }) => `${x},${y}`));
  const minimumX = Math.min(...points.map(({ x }) => x));
  const maximumX = Math.max(...points.map(({ x }) => x));
  const minimumY = Math.min(...points.map(({ y }) => y));
  const maximumY = Math.max(...points.map(({ y }) => y));
  const footprint = new Path2D();
  for (const { x, y } of points) {
    footprint.rect(x * size, y * size, size, size);
  }

  context.save();
  applyPropContactShadow(size, context);
  context.fillStyle = id % 2 === 0 ? colors.primary : colors.secondary;
  context.fill(footprint);
  context.shadowColor = "transparent";

  context.clip(footprint);
  const roofGradient = context.createLinearGradient(
    minimumX * size,
    minimumY * size,
    (maximumX + 1) * size,
    (maximumY + 1) * size,
  );
  roofGradient.addColorStop(0, "rgba(255, 222, 181, .28)");
  roofGradient.addColorStop(.48, "rgba(255, 255, 255, .04)");
  roofGradient.addColorStop(.52, "rgba(72, 42, 32, .08)");
  roofGradient.addColorStop(1, "rgba(65, 38, 30, .28)");
  context.fillStyle = roofGradient;
  context.fillRect(
    minimumX * size,
    minimumY * size,
    (maximumX - minimumX + 1) * size,
    (maximumY - minimumY + 1) * size,
  );
  context.restore();

  context.strokeStyle = colors.edge;
  context.lineWidth = Math.max(1, size * .045);
  context.beginPath();
  for (const { x, y } of points) {
    const left = x * size;
    const top = y * size;
    const right = left + size;
    const bottom = top + size;
    if (!cells.has(`${x},${y - 1}`)) {
      context.moveTo(left, top);
      context.lineTo(right, top);
    }
    if (!cells.has(`${x + 1},${y}`)) {
      context.moveTo(right, top);
      context.lineTo(right, bottom);
    }
    if (!cells.has(`${x},${y + 1}`)) {
      context.moveTo(right, bottom);
      context.lineTo(left, bottom);
    }
    if (!cells.has(`${x - 1},${y}`)) {
      context.moveTo(left, bottom);
      context.lineTo(left, top);
    }
  }
  context.stroke();

  context.strokeStyle = "rgba(255, 226, 190, .22)";
  context.lineWidth = Math.max(1, size * .025);
  context.beginPath();
  if (maximumX > minimumX) {
    const ridgeY = (minimumY + maximumY + 1) * size / 2;
    context.moveTo(minimumX * size + size * .14, ridgeY);
    context.lineTo((maximumX + 1) * size - size * .14, ridgeY);
  } else if (maximumY > minimumY) {
    const ridgeX = (minimumX + maximumX + 1) * size / 2;
    context.moveTo(ridgeX, minimumY * size + size * .14);
    context.lineTo(ridgeX, (maximumY + 1) * size - size * .14);
  }
  context.stroke();
}

function drawRock(
  x: number,
  y: number,
  size: number,
  mode: LandscapeMode,
  context: CanvasRenderingContext2D,
  span = 1,
) {
  const left = x * size;
  const top = y * size;
  const rockSize = size * span;
  const colors = getBiomeObjectStyle(mode).rock;
  context.save();
  applyPropContactShadow(size, context);
  context.fillStyle = colors.fill;
  context.beginPath();
  context.moveTo(left + rockSize * .1, top + rockSize * .76);
  context.lineTo(left + rockSize * .26, top + rockSize * .24);
  context.lineTo(left + rockSize * .65, top + rockSize * .11);
  context.lineTo(left + rockSize * .91, top + rockSize * .69);
  context.lineTo(left + rockSize * .64, top + rockSize * .88);
  context.closePath();
  context.fill();
  context.restore();
  context.strokeStyle = colors.stroke;
  context.lineWidth = Math.max(1, rockSize * .03);
  context.lineCap = "round";
  context.lineJoin = "round";
  context.stroke();
  context.fillStyle = colors.highlight;
  context.beginPath();
  context.moveTo(left + rockSize * .26, top + rockSize * .24);
  context.lineTo(left + rockSize * .65, top + rockSize * .11);
  context.lineTo(left + rockSize * .51, top + rockSize * .47);
  context.closePath();
  context.fill();
}

function drawTerrainDetail(
  grid: Grid,
  x: number,
  y: number,
  cellSize: number,
  context: CanvasRenderingContext2D,
) {
  const tile = grid[y][x];
  if (tile.terrain === Terrain.Beach) {
    context.fillStyle = "rgba(111, 92, 59, .25)";
    context.beginPath();
    context.arc(x * cellSize + cellSize * .3, y * cellSize + cellSize * .42, Math.max(1, cellSize * .05), 0, Math.PI * 2);
    context.arc(x * cellSize + cellSize * .7, y * cellSize + cellSize * .68, Math.max(1, cellSize * .04), 0, Math.PI * 2);
    context.fill();
  } else if (tile.terrain === Terrain.Road || tile.terrain === Terrain.Bridge) {
    context.strokeStyle = tile.terrain === Terrain.Bridge
      ? "rgba(238, 221, 180, .5)"
      : "rgba(238, 225, 196, .25)";
    context.lineWidth = Math.max(1, cellSize * .08);
    const centerX = x * cellSize + cellSize * .5;
    const centerY = y * cellSize + cellSize * .5;
    for (const [offsetX, offsetY] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const neighbor = grid[y + offsetY]?.[x + offsetX];
      if (neighbor?.terrain === Terrain.Road || neighbor?.terrain === Terrain.Bridge) {
        context.beginPath();
        context.moveTo(centerX, centerY);
        context.lineTo(centerX + offsetX * cellSize * .5, centerY + offsetY * cellSize * .5);
        context.stroke();
      }
    }
    context.lineWidth = 1;
  } else if (tile.terrain === Terrain.Difficult) {
    context.fillStyle = "rgba(64, 75, 49, .35)";
    context.fillRect(x * cellSize + cellSize * .2, y * cellSize + cellSize * .68, cellSize * .08, cellSize * .16);
    context.fillRect(x * cellSize + cellSize * .7, y * cellSize + cellSize * .22, cellSize * .07, cellSize * .13);
  } else if (tile.terrain === Terrain.Ravine) {
    context.strokeStyle = "rgba(35, 37, 31, .55)";
    context.beginPath();
    context.moveTo(x * cellSize + 2, y * cellSize + cellSize * .72);
    context.lineTo(x * cellSize + cellSize * .45, y * cellSize + cellSize * .3);
    context.lineTo((x + 1) * cellSize - 2, y * cellSize + cellSize * .48);
    context.stroke();
  } else if (tile.terrain === Terrain.Cliff) {
    context.fillStyle = "rgba(235, 229, 207, .22)";
    context.beginPath();
    context.moveTo(x * cellSize + cellSize * .12, y * cellSize + cellSize * .75);
    context.lineTo(x * cellSize + cellSize * .5, y * cellSize + cellSize * .18);
    context.lineTo(x * cellSize + cellSize * .88, y * cellSize + cellSize * .75);
    context.fill();
  }
}

export function drawGrid(grid: Grid, options: RenderOptions) {
  if (!grid.length) return;
  const { targetCanvas: canvas, mode } = options;
  const context = canvas.getContext("2d", {
    alpha: options.transparentBackground ?? false,
  })!;
  const rows = grid.length;
  const columns = grid[0].length;
  const cellSize = options.cellSize ??
    Math.max(12, Math.min(28, Math.floor(850 / columns)));
  const pixelRatio = options.pixelRatio ??
    Math.min(window.devicePixelRatio || 1, 2);
  const updateInterface = options.updateInterface ?? true;
  const hiddenItems = options.hiddenItems ?? new Set<string>();
  const hiddenOpacity = options.hiddenOpacity ?? .14;
  const showGrid = options.showGrid ?? true;
  const width = columns * cellSize;
  const height = rows * cellSize;

  canvas.width = width * pixelRatio;
  canvas.height = height * pixelRatio;
  if (updateInterface) {
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  if (!options.transparentBackground) {
    context.fillStyle = "#f3f0e5";
    context.fillRect(0, 0, width, height);
  }

  const counts = new Map<string, number>();
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const tile = grid[y][x];
      counts.set(tile.terrain, (counts.get(tile.terrain) ?? 0) + 1);
      const surface = tileSurface(tile);
      if (surface) counts.set(surface, (counts.get(surface) ?? 0) + 1);
    }
  }

  drawTerrainLayers(
    grid,
    cellSize,
    mode,
    hiddenItems,
    hiddenOpacity,
    width,
    height,
    options.useTileset ? options.tilesetImage : undefined,
    context,
  );
  drawGlobalTexture(width, height, context);
  drawReliefBevels(
    grid,
    cellSize,
    hiddenItems,
    hiddenOpacity,
    width,
    height,
    context,
  );
  drawContinuousLiquidMaterials(
    grid,
    cellSize,
    hiddenItems,
    hiddenOpacity,
    context,
  );
  drawRavineUpperEdges(
    grid,
    cellSize,
    hiddenItems.has(Terrain.Ravine) ? hiddenOpacity : 1,
    context,
  );
  drawLiquidUpperEdges(
    grid,
    cellSize,
    Terrain.Water,
    hiddenItems.has(Terrain.Water) ? hiddenOpacity : 1,
    context,
  );
  drawLiquidUpperEdges(
    grid,
    cellSize,
    Terrain.Lava,
    hiddenItems.has(Terrain.Lava) ? hiddenOpacity : 1,
    context,
  );
  drawShorelines(
    grid,
    cellSize,
    mode,
    hiddenItems,
    hiddenOpacity,
    context,
  );
  drawRoadNetwork(
    grid,
    cellSize,
    mode,
    hiddenItems,
    hiddenOpacity,
    options.useTileset ? options.tilesetImage : undefined,
    context,
  );
  if (options.stylizedLighting) {
    drawStylizedLighting(
      grid,
      mode,
      cellSize,
      width,
      height,
      hiddenItems,
      hiddenOpacity,
      context,
    );
  }
  drawLavaRockEdges(
    grid,
    cellSize,
    hiddenItems.has(Terrain.Lava) ? hiddenOpacity : 1,
    context,
  );

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const tile = grid[y][x];
      context.globalAlpha = hiddenItems.has(tile.terrain) ? hiddenOpacity : 1;
      if (
        !tileSurface(tile) &&
        !overlayTerrains.has(tile.terrain) &&
        tile.terrain !== Terrain.Water &&
        tile.terrain !== Terrain.Cliff &&
        tile.terrain !== Terrain.Ravine
      ) {
        drawTerrainDetail(grid, x, y, cellSize, context);
      }
      if (showGrid) {
        context.strokeStyle = "rgba(239, 235, 218, 0.14)";
        context.lineWidth = 1;
        context.strokeRect(
          x * cellSize + .5,
          y * cellSize + .5,
          cellSize - 1,
          cellSize - 1,
        );
      }
    }
  }
  context.globalAlpha = 1;

  const treeGroups = new Map<number, Array<{ x: number; y: number }>>();
  const buildingGroups = new Map<number, Array<{ x: number; y: number }>>();
  const rockCells = new Set<string>();
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const tile = grid[y][x];
      if (tile.obstacle === Obstacle.Tree) {
        const id = tile.obstacleId ?? y * columns + x;
        const group = treeGroups.get(id) ?? [];
        group.push({ x, y });
        treeGroups.set(id, group);
      }
      if (tile.obstacle === Obstacle.Building) {
        const id = tile.obstacleId ?? y * columns + x;
        const group = buildingGroups.get(id) ?? [];
        group.push({ x, y });
        buildingGroups.set(id, group);
      }
      if (tile.obstacle === Obstacle.Rock) {
        rockCells.add(`${x},${y}`);
      }
      if (tile.obstacle !== Obstacle.None) {
        counts.set(tile.obstacle, (counts.get(tile.obstacle) ?? 0) + 1);
      }
    }
  }
  context.globalAlpha =
    hiddenItems.has(Obstacle.Rock) ? hiddenOpacity : 1;
  const objectStyle = getBiomeObjectStyle(mode);
  const renderedRockCells = new Set<string>();
  for (let y = 0; y < rows - 1; y += 1) {
    for (let x = 0; x < columns - 1; x += 1) {
      const formation = [
        `${x},${y}`,
        `${x + 1},${y}`,
        `${x},${y + 1}`,
        `${x + 1},${y + 1}`,
      ];
      if (
        formation.every((key) => rockCells.has(key)) &&
        formation.every((key) => !renderedRockCells.has(key))
      ) {
        if (options.useTileset && options.tilesetProps) {
          drawTilesetProp(
            options.tilesetProps.rock2x2,
            x,
            y,
            2,
            cellSize,
            context,
            objectStyle.rock.fill,
            .58,
          );
        } else {
          drawRock(x, y, cellSize, mode, context, 2);
        }
        for (const key of formation) renderedRockCells.add(key);
      }
    }
  }
  for (const key of rockCells) {
    if (renderedRockCells.has(key)) continue;
    const [x, y] = key.split(",").map(Number);
    if (options.useTileset && options.tilesetProps) {
      drawTilesetProp(
        options.tilesetProps.rock1x1,
        x,
        y,
        1,
        cellSize,
        context,
        objectStyle.rock.fill,
        .58,
      );
    } else {
      drawRock(x, y, cellSize, mode, context);
    }
  }
  context.globalAlpha = 1;
  context.globalAlpha =
    hiddenItems.has(Obstacle.Building) ? hiddenOpacity : 1;
  for (const [id, points] of buildingGroups) {
    drawBuilding(points, id, cellSize, mode, context);
  }
  context.globalAlpha = 1;
  context.globalAlpha = hiddenItems.has(Obstacle.Tree) ? hiddenOpacity : 1;
  for (const points of treeGroups.values()) {
    if (options.useTileset && options.tilesetProps && points.length === 4) {
      const minimumX = Math.min(...points.map(({ x }) => x));
      const minimumY = Math.min(...points.map(({ y }) => y));
      const completeBlock = [
        `${minimumX},${minimumY}`,
        `${minimumX + 1},${minimumY}`,
        `${minimumX},${minimumY + 1}`,
        `${minimumX + 1},${minimumY + 1}`,
      ];
      const pointKeys = new Set(points.map(({ x, y }) => `${x},${y}`));
      if (completeBlock.every((key) => pointKeys.has(key))) {
        drawTilesetProp(
          options.tilesetProps.tree2x2,
          minimumX,
          minimumY,
          2,
          cellSize,
          context,
          objectStyle.tree.light,
          .48,
        );
        continue;
      }
    }
    if (options.useTileset && options.tilesetProps) {
      for (const { x, y } of points) {
        drawTilesetProp(
          options.tilesetProps.tree1x1,
          x,
          y,
          1,
          cellSize,
          context,
          objectStyle.tree.light,
          .48,
        );
      }
    } else {
      drawTree(points, cellSize, mode, context);
    }
  }
  context.globalAlpha = 1;

  if (!updateInterface) return;
  const terrainItems = Object.values(Terrain).map((kind) => ({
      key: kind,
      label: getTerrainStyle(kind, mode).label,
      className: kind,
      color: getTerrainStyle(kind, mode).color,
    })).filter(({ key }) => (counts.get(key) ?? 0) > 0);
  const obstacleItems = [
    { key: Obstacle.Tree, label: "Tree", className: "tree", color: "" },
    {
      key: Obstacle.Rock,
      label: "Rock",
      className: "rock",
      color: mode === "volcanic"
        ? "#24282a"
        : mode === "underground" ? "#4a4742" : "#555a59",
    },
    { key: Obstacle.Building, label: "Building", className: "building", color: "" },
  ].filter(({ key }) => (counts.get(key) ?? 0) > 0);

  type LegendItem = {
    key: string;
    label: string;
    className: string;
    color: string;
  };
  const renderLegendGroup = (
    label: string,
    items: LegendItem[],
  ) => {
    if (!items.length) return "";
    const keys = items.map(({ key }) => key);
    const allHidden = keys.every((key) => hiddenItems.has(key));
    return `
      <section class="legend-group">
        <div class="legend-heading">
          <strong>${label}</strong>
          <button type="button" class="legend-toggle ${allHidden ? "is-hidden" : ""}" data-legend-group-items="${keys.join(",")}">
            ${allHidden ? "Show all" : "Hide all"}
          </button>
        </div>
        <div class="legend-items">
          ${items.map(({ key, label: itemLabel, className, color }) =>
            `<button type="button" data-legend-item="${key}" class="legend-item ${hiddenItems.has(key) ? "is-hidden" : ""}" aria-pressed="${hiddenItems.has(key)}"><i class="swatch ${className}"${color ? ` style="background:${color}"` : ""}></i><span>${itemLabel}</span><small>${counts.get(key)}</small></button>`
          ).join("")}
        </div>
      </section>`;
  };

  document.querySelector("#legend")!.innerHTML =
    renderLegendGroup("Terrain", terrainItems) +
    renderLegendGroup("Obstacles", obstacleItems);
  document.querySelector("#dimensions")!.textContent = `${columns} × ${rows} cells`;
}
