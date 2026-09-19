import {
  Obstacle,
  OutdoorProp,
  OUTDOOR_PROP_RULES,
  Terrain,
  isInteriorMode,
  tileSurface,
  type Grid,
  type LandscapeMode,
  type TerrainKind,
} from "../domain/map";
import {
  getBiomeObjectStyle,
  getArchitectureVisualStyle,
  getDifficultTerrainDetailStyle,
  getInteriorVisualStyle,
  getTerrainStyle,
} from "./palettes";
import { drawStylizedLighting } from "./lighting";
import {
  bedAssetDefinitions,
  blueBedAssetDefinitions,
  ensureTilesetImageLoaded,
  interiorAssetSpriteLayout,
  selectBedAssetDefinition,
  tilesetImageSpriteLayout,
  type TilesetPropImages,
  type TilesetTerrainImages,
} from "./tileset-assets";

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
  tilesetTerrain?: TilesetTerrainImages;
  tilesetProps?: TilesetPropImages;
  customProps?: CustomPropImages;
  stylizedLighting?: boolean;
  hideInteriorProps?: boolean;
  wallDebug?: WallDebugOptions;
}

export interface CustomPropImages {
  tree?: CanvasImageSource;
  rock?: CanvasImageSource;
}

export interface WallDebugOptions {
  underlay?: boolean;
  shadow?: boolean;
  surface?: boolean;
  edge?: boolean;
  highlight?: boolean;
  path?: boolean;
  junction?: boolean;
  door?: boolean;
}

function imageSourceSize(image: CanvasImageSource) {
  ensureTilesetImageLoaded(image);
  const source = image as CanvasImageSource & {
    naturalWidth?: number; naturalHeight?: number;
    videoWidth?: number; videoHeight?: number;
    width?: number; height?: number;
  };
  const width = source.naturalWidth ?? source.videoWidth ?? Number(source.width);
  const height = source.naturalHeight ?? source.videoHeight ?? Number(source.height);
  return Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0
    ? { width, height } : undefined;
}

function readyTilesetImage<T extends CanvasImageSource>(image: T | undefined) {
  return image && imageSourceSize(image) ? image : undefined;
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
  [Terrain.Wall]: 115,
  [Terrain.Door]: 116,
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
  context.shadowColor = "rgba(20, 24, 22, .24)";
  context.shadowBlur = Math.max(1, cellSize * .045);
  context.shadowOffsetX = Math.max(.5, cellSize * .025);
  context.shadowOffsetY = Math.max(.8, cellSize * .045);
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
  if (!readyTilesetImage(image)) return;
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

type RockFamily = "normal" | "light" | "dark" | "desert" | "snow";

function rockFamilyForMode(mode: LandscapeMode): RockFamily {
  if (mode === "desert-canyon" || mode === "badlands") return "desert";
  if (mode === "frozen-lake") return "snow";
  if (mode === "underground" || mode === "sewer" || mode === "volcanic") return "dark";
  if (mode === "coast" || mode === "archipelago") return "light";
  return "normal";
}

function drawLpcProp(
  image: CanvasImageSource,
  x: number,
  y: number,
  width: number,
  height: number,
  cellSize: number,
  context: CanvasRenderingContext2D,
) {
  const source = imageSourceSize(image);
  if (!source) return;
  const targetWidth = width * cellSize;
  const targetHeight = height * cellSize;
  const scale = source
    ? Math.min(targetWidth / source.width, targetHeight / source.height)
    : 1;
  const drawWidth = source ? source.width * scale : targetWidth;
  const drawHeight = source ? source.height * scale : targetHeight;
  context.save();
  context.imageSmoothingEnabled = false;
  applyPropContactShadow(cellSize, context);
  context.drawImage(
    image,
    x * cellSize + (targetWidth - drawWidth) / 2,
    y * cellSize + targetHeight - drawHeight,
    drawWidth,
    drawHeight,
  );
  context.restore();
}

function drawCustomProp(
  image: CanvasImageSource,
  x: number,
  y: number,
  size: 1 | 2,
  cellSize: number,
  context: CanvasRenderingContext2D,
) {
  context.save();
  context.imageSmoothingEnabled = true;
  applyPropContactShadow(cellSize, context);
  context.drawImage(
    image,
    x * cellSize,
    y * cellSize,
    size * cellSize,
    size * cellSize,
  );
  context.restore();
}

function traceFilledStar(
  context: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  outerRadius: number,
  innerRadius: number,
) {
  context.beginPath();
  for (let point = 0; point < 10; point += 1) {
    const radius = point % 2 === 0 ? outerRadius : innerRadius;
    const angle = -Math.PI / 2 + point * Math.PI / 5;
    const x = centerX + Math.cos(angle) * radius;
    const y = centerY + Math.sin(angle) * radius;
    if (point === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.closePath();
}

const overlayTerrains = new Set<TerrainKind>([
  Terrain.Road,
  Terrain.Bridge,
  Terrain.Wall,
  Terrain.Door,
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
  Terrain.Wall,
  Terrain.Door,
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
const buildingTilesetCoordinate: TilesetCoordinate = [4, 1];

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
  if (!readyTilesetImage(image)) return null;
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
  terrainImages: TilesetTerrainImages | undefined,
  mode: LandscapeMode,
  context: CanvasRenderingContext2D,
  cellSize: number,
  width: number,
  height: number,
  usedTerrains: ReadonlySet<TerrainKind>,
) {
  const patterns = new Map<TerrainKind, CanvasPattern>();
  if (image && imageSourceSize(image)) {
    for (const terrain of terrainPaintOrder) {
      if (!usedTerrains.has(terrain)) continue;
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
  }
  if (!terrainImages) return patterns;
  const groundProfile = tilesetProfileByMode[mode] ?? "grass";
  const groundImage = isInteriorMode(mode)
    ? undefined
    : mode === "desert-canyon" || mode === "badlands"
      ? terrainImages.desertSand
      : mode === "frozen-lake"
        ? terrainImages.snow
        : groundProfile === "grass" ? terrainImages.grass : undefined;
  const waterImage = mode === "frozen-lake"
    ? terrainImages.coldWater : terrainImages.water;
  const replacements: Partial<Record<TerrainKind, CanvasImageSource>> = {
    ...(groundImage ? { [Terrain.Ground]: groundImage } : {}),
    ...(groundProfile === "sand"
      ? { [Terrain.Difficult]: terrainImages.sandRough }
      : mode === "farmland"
        ? { [Terrain.Difficult]: terrainImages.tiledSoil }
        : groundProfile === "grass" && !isInteriorMode(mode)
          ? { [Terrain.Difficult]: terrainImages.grassRough }
          : {}),
    [Terrain.Beach]: terrainImages.beachSand,
    [Terrain.Water]: waterImage,
    [Terrain.Ice]: terrainImages.ice,
    [Terrain.Lava]: terrainImages.lava,
  };
  for (const [terrain, terrainImage] of Object.entries(replacements) as
    Array<[TerrainKind, CanvasImageSource]>) {
    if (!usedTerrains.has(terrain)) continue;
    const source = imageSourceSize(terrainImage);
    if (!source) continue;
    const columns = Math.max(1, Math.floor(source.width / 32));
    const texture = document.createElement("canvas");
    texture.width = width;
    texture.height = height;
    const textureContext = texture.getContext("2d")!;
    textureContext.imageSmoothingEnabled = false;
    const salt = terrainPaintOrder.indexOf(terrain) + 101;
    for (let y = 0; y < Math.ceil(height / cellSize); y += 1) {
      for (let x = 0; x < Math.ceil(width / cellSize); x += 1) {
        const column = Math.min(
          columns - 1,
          Math.floor(terrainVariation(x, y, salt) * columns),
        );
        textureContext.drawImage(
          terrainImage,
          column * 32,
          0,
          32,
          32,
          x * cellSize,
          y * cellSize,
          cellSize,
          cellSize,
        );
      }
    }
    const pattern = context.createPattern(texture, "repeat");
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
  fillIrregularLiquidMaskCell(
    context,
    grid,
    x,
    y,
    cellSize,
    Terrain.Water,
    881,
    .1,
  );
}

function fillLavaMaskCell(
  context: CanvasRenderingContext2D,
  grid: Grid,
  x: number,
  y: number,
  cellSize: number,
) {
  fillIrregularLiquidMaskCell(
    context,
    grid,
    x,
    y,
    cellSize,
    Terrain.Lava,
    967,
    .13,
  );
}

function fillIrregularLiquidMaskCell(
  context: CanvasRenderingContext2D,
  grid: Grid,
  x: number,
  y: number,
  cellSize: number,
  terrain: typeof Terrain.Water | typeof Terrain.Lava,
  salt: number,
  amplitude: number,
) {
  const isLiquid = (cellX: number, cellY: number) =>
    outsideGrid(grid, cellX, cellY) ||
    underlyingTerrain(grid, cellX, cellY) === terrain;
  const segmentCount = 6;
  const points: Array<{ x: number; y: number }> = [];
  const addEdge = (side: 0 | 1 | 2 | 3, exposed: boolean) => {
    for (let index = side === 0 ? 0 : 1; index <= segmentCount; index += 1) {
      const ratio = index / segmentCount;
      const progress = side === 2 || side === 3 ? 1 - ratio : ratio;
      const jitter = index === 0 || index === segmentCount || !exposed
        ? 0
        : (
          terrainVariation(x * segmentCount + index, y * 4 + side, salt + side * 43) - .5
        ) * cellSize * amplitude;
      if (side === 0) {
        points.push({ x: (x + progress) * cellSize, y: y * cellSize + jitter });
      } else if (side === 1) {
        points.push({ x: (x + 1) * cellSize + jitter, y: (y + progress) * cellSize });
      } else if (side === 2) {
        points.push({ x: (x + progress) * cellSize, y: (y + 1) * cellSize + jitter });
      } else {
        points.push({ x: x * cellSize + jitter, y: (y + progress) * cellSize });
      }
    }
  };
  addEdge(0, !isLiquid(x, y - 1));
  addEdge(1, !isLiquid(x + 1, y));
  addEdge(2, !isLiquid(x, y + 1));
  addEdge(3, !isLiquid(x - 1, y));
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  points.slice(1).forEach((point) => context.lineTo(point.x, point.y));
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

function fillOrganicTerrainMaskCell(
  context: CanvasRenderingContext2D,
  grid: Grid,
  x: number,
  y: number,
  cellSize: number,
  terrain: typeof Terrain.Difficult | typeof Terrain.Beach,
) {
  const isTerrain = (cellX: number, cellY: number) =>
    outsideGrid(grid, cellX, cellY) ||
    underlyingTerrain(grid, cellX, cellY) === terrain;
  const segmentCount = 6;
  const points: Array<{ x: number; y: number }> = [];
  const salt = terrain === Terrain.Difficult ? 211 : 563;

  const addEdge = (side: 0 | 1 | 2 | 3, exposed: boolean) => {
    for (let index = side === 0 ? 0 : 1; index <= segmentCount; index += 1) {
      const ratio = index / segmentCount;
      const progress = side === 2 || side === 3 ? 1 - ratio : ratio;
      const jitter = index === 0 || index === segmentCount || !exposed
        ? 0
        : (
          terrainVariation(
            x * segmentCount + index,
            y * 4 + side,
            salt + side * 37,
          ) - .5
        ) * cellSize * .09;
      if (side === 0) {
        points.push({ x: (x + progress) * cellSize, y: y * cellSize + jitter });
      } else if (side === 1) {
        points.push({
          x: (x + 1) * cellSize + jitter,
          y: (y + progress) * cellSize,
        });
      } else if (side === 2) {
        points.push({
          x: (x + progress) * cellSize,
          y: (y + 1) * cellSize + jitter,
        });
      } else {
        points.push({ x: x * cellSize + jitter, y: (y + progress) * cellSize });
      }
    }
  };

  addEdge(0, !isTerrain(x, y - 1));
  addEdge(1, !isTerrain(x + 1, y));
  addEdge(2, !isTerrain(x, y + 1));
  addEdge(3, !isTerrain(x - 1, y));
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  points.slice(1).forEach((point) => context.lineTo(point.x, point.y));
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
  excludeArchitecture = false,
) {
  const mask = document.createElement("canvas");
  mask.width = width;
  mask.height = height;
  const maskContext = mask.getContext("2d")!;
  maskContext.fillStyle = "#fff";
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      if (
        excludeArchitecture &&
        (grid[y][x].terrain === Terrain.Wall || grid[y][x].terrain === Terrain.Door)
      ) {
        continue;
      }
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
        } else if (terrain === Terrain.Difficult || terrain === Terrain.Beach) {
          fillOrganicTerrainMaskCell(
            maskContext,
            grid,
            x,
            y,
            cellSize,
            terrain,
          );
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
  mode: LandscapeMode,
  opacity: number,
  context: CanvasRenderingContext2D,
) {
  const battlefieldTrench = mode === "ruined-battlefield";
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
          ) * cellSize * (battlefieldTrench ? .045 : .16);
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

      effectContext.strokeStyle = battlefieldTrench
        ? "rgba(48, 31, 22, .4)"
        : "rgba(17, 18, 16, .3)";
      effectContext.lineWidth = Math.max(4, cellSize * .34);
      strokeEdge(cellSize * .17);
      effectContext.strokeStyle = battlefieldTrench
        ? "rgba(54, 34, 23, .72)"
        : "rgba(17, 18, 16, .62)";
      effectContext.lineWidth = Math.max(2.5, cellSize * .18);
      strokeEdge(cellSize * .09);
      effectContext.strokeStyle = battlefieldTrench
        ? "rgba(178, 144, 96, .5)"
        : "rgba(232, 215, 182, .48)";
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

function drawBattlefieldTrenchDetails(
  grid: Grid,
  cellSize: number,
  opacity: number,
  context: CanvasRenderingContext2D,
) {
  const isTrench = (x: number, y: number) =>
    outsideGrid(grid, x, y) || grid[y][x].terrain === Terrain.Ravine;
  const edgePath = new Path2D();
  const addEdge = (x: number, y: number, side: 0 | 1 | 2 | 3) => {
    const left = x * cellSize;
    const top = y * cellSize;
    if (side === 0) {
      edgePath.moveTo(left, top);
      edgePath.lineTo(left + cellSize, top);
    } else if (side === 1) {
      edgePath.moveTo(left + cellSize, top);
      edgePath.lineTo(left + cellSize, top + cellSize);
    } else if (side === 2) {
      edgePath.moveTo(left + cellSize, top + cellSize);
      edgePath.lineTo(left, top + cellSize);
    } else {
      edgePath.moveTo(left, top + cellSize);
      edgePath.lineTo(left, top);
    }
  };

  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      if (grid[y][x].terrain !== Terrain.Ravine) continue;
      if (!isTrench(x, y - 1)) addEdge(x, y, 0);
      if (!isTrench(x + 1, y)) addEdge(x, y, 1);
      if (!isTrench(x, y + 1)) addEdge(x, y, 2);
      if (!isTrench(x - 1, y)) addEdge(x, y, 3);
    }
  }

  context.save();
  context.globalAlpha = opacity;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = "rgba(55, 34, 22, .78)";
  context.lineWidth = Math.max(2.5, cellSize * .13);
  context.stroke(edgePath);
  context.strokeStyle = "rgba(168, 129, 82, .48)";
  context.lineWidth = Math.max(.8, cellSize * .032);
  context.stroke(edgePath);

  const drawTimber = (
    startX: number,
    startY: number,
    endX: number,
    endY: number,
  ) => {
    context.strokeStyle = "rgba(48, 30, 21, .9)";
    context.lineWidth = Math.max(2.2, cellSize * .12);
    context.beginPath();
    context.moveTo(startX, startY);
    context.lineTo(endX, endY);
    context.stroke();
    context.strokeStyle = "rgba(139, 92, 52, .92)";
    context.lineWidth = Math.max(1.2, cellSize * .068);
    context.beginPath();
    context.moveTo(startX, startY);
    context.lineTo(endX, endY);
    context.stroke();
    context.strokeStyle = "rgba(213, 161, 93, .3)";
    context.lineWidth = Math.max(.55, cellSize * .018);
    context.beginPath();
    context.moveTo(startX, startY);
    context.lineTo(endX, endY);
    context.stroke();
  };

  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      if (grid[y][x].terrain !== Terrain.Ravine) continue;
      let horizontalSupport = 0;
      let verticalSupport = 0;
      for (const offset of [-1, 1]) {
        for (let cross = -1; cross <= 1; cross += 1) {
          if (grid[y + cross]?.[x + offset]?.terrain === Terrain.Ravine) {
            horizontalSupport += 1;
          }
          if (grid[y + offset]?.[x + cross]?.terrain === Terrain.Ravine) {
            verticalSupport += 1;
          }
        }
      }
      const horizontal = horizontalSupport >= verticalSupport;
      const left = x * cellSize;
      const top = y * cellSize;
      if (horizontal) {
        if (!isTrench(x, y - 1)) {
          drawTimber(
            left + cellSize * .12,
            top + cellSize * .13,
            left + cellSize * .88,
            top + cellSize * .13,
          );
        }
        if (!isTrench(x, y + 1)) {
          drawTimber(
            left + cellSize * .12,
            top + cellSize * .87,
            left + cellSize * .88,
            top + cellSize * .87,
          );
        }
        if ((x + y * 2) % 3 === 0) {
          drawTimber(
            left + cellSize * .5,
            top + cellSize * .2,
            left + cellSize * .5,
            top + cellSize * .8,
          );
        }
      } else {
        if (!isTrench(x - 1, y)) {
          drawTimber(
            left + cellSize * .13,
            top + cellSize * .12,
            left + cellSize * .13,
            top + cellSize * .88,
          );
        }
        if (!isTrench(x + 1, y)) {
          drawTimber(
            left + cellSize * .87,
            top + cellSize * .12,
            left + cellSize * .87,
            top + cellSize * .88,
          );
        }
        if ((y + x * 2) % 3 === 0) {
          drawTimber(
            left + cellSize * .2,
            top + cellSize * .5,
            left + cellSize * .8,
            top + cellSize * .5,
          );
        }
      }
    }
  }
  context.restore();
}

function drawLiquidUpperEdges(
  grid: Grid,
  cellSize: number,
  terrain: typeof Terrain.Water | typeof Terrain.Lava,
  mode: LandscapeMode,
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
  const sewerWater = terrain === Terrain.Water && mode === "sewer";

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
          ) * cellSize * (sewerWater ? .014 : .07);
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
        : sewerWater
          ? "rgba(28, 43, 35, .14)"
          : "rgba(30, 65, 68, .13)";
      effectContext.lineWidth = Math.max(5, cellSize * .38);
      strokeEdge(cellSize * .19);
      effectContext.filter = `blur(${Math.max(.75, cellSize * .035)}px)`;
      effectContext.strokeStyle = lava
        ? "rgba(105, 31, 20, .27)"
        : sewerWater
          ? "rgba(48, 63, 48, .24)"
          : "rgba(35, 72, 75, .23)";
      effectContext.lineWidth = Math.max(3, cellSize * .2);
      strokeEdge(cellSize * .1);
      effectContext.filter = "none";
      effectContext.strokeStyle = lava
        ? "rgba(255, 190, 91, .25)"
        : sewerWater
          ? "rgba(183, 193, 151, .16)"
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
  tilesetTerrain: TilesetTerrainImages | undefined,
  context: CanvasRenderingContext2D,
): (x: number, y: number) => void {
  const hasTilesetTexture = Boolean(tilesetImage || tilesetTerrain);
  const usedTerrains = new Set<TerrainKind>([Terrain.Ground]);
  for (const row of grid) {
    for (const tile of row) {
      usedTerrains.add(tile.terrain);
      const surface = tileSurface(tile);
      if (surface) usedTerrains.add(surface);
    }
  }
  const tilesetPatterns = createTilesetPatterns(
    tilesetImage,
    tilesetTerrain,
    mode,
    context,
    cellSize,
    width,
    height,
    usedTerrains,
  );
  const terrainFill = (terrain: TerrainKind) =>
    tilesetPatterns.get(terrain) ?? getTerrainStyle(terrain, mode).color;
  const drawTerrainBackdropCell = (
    x: number,
    y: number,
    includeArchitectureUnderlay = true,
  ) => {
    const rawTerrain = grid[y]?.[x]?.terrain;
    const tileTerrain = !includeArchitectureUnderlay &&
      (rawTerrain === Terrain.Wall || rawTerrain === Terrain.Door)
      ? Terrain.Void
      : underlyingTerrain(grid, x, y);
    const terrain = tileTerrain === Terrain.Cliff
      ? terrainBackdropTerrain(grid, x, y, Terrain.Cliff)
      : tileTerrain === Terrain.Water
        ? terrainBackdropTerrain(grid, x, y, Terrain.Water)
        : tileTerrain === Terrain.Lava
          ? terrainBackdropTerrain(grid, x, y, Terrain.Lava)
          : tileTerrain;
    context.save();
    context.globalAlpha = hiddenItems.has(terrain) ? hiddenOpacity : 1;
    context.fillStyle = terrainFill(terrain);
    context.fillRect(
      x * cellSize,
      y * cellSize,
      cellSize,
      cellSize,
    );
    context.restore();
  };
  const present = new Set<TerrainKind>();
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      const tileTerrain = underlyingTerrain(grid, x, y);
      present.add(tileTerrain);
      drawTerrainBackdropCell(x, y, false);
    }
  }
  context.globalAlpha = 1;

  for (const terrain of terrainPaintOrder) {
    if (!present.has(terrain)) continue;
    const mask = createTerrainMask(
      grid,
      terrain,
      cellSize,
      width,
      height,
      true,
      true,
    );
    const layer = document.createElement("canvas");
    layer.width = width;
    layer.height = height;
    const layerContext = layer.getContext("2d")!;
    layerContext.fillStyle = terrainFill(terrain);
    layerContext.fillRect(0, 0, width, height);

    if (
      !hasTilesetTexture &&
      terrain !== Terrain.Cliff &&
      terrain !== Terrain.Wall &&
      terrain !== Terrain.Door
    ) {
      const gradient = layerContext.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, "rgba(255,255,255,.09)");
      gradient.addColorStop(.48, "rgba(255,255,255,0)");
      gradient.addColorStop(1, "rgba(19,31,25,.10)");
      layerContext.fillStyle = gradient;
      layerContext.fillRect(0, 0, width, height);
    }

    layerContext.globalCompositeOperation = "destination-in";
    const maskBlur = terrain === Terrain.Wall || terrain === Terrain.Door
      ? 0
      : terrain === Terrain.Ravine
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
          Math.max(3, cellSize * .1),
          Math.max(7, cellSize * .34),
          Math.max(3, cellSize * .13),
          "rgba(15, 18, 18, .54)",
        ),
        0,
        0,
      );
    }
    context.drawImage(layer, 0, 0);
    if (terrain === Terrain.Cliff) {
      const sideDepth = Math.max(3, cellSize * .16);
      const sideBlur = Math.max(1, cellSize * .045);
      const lowerBlur = Math.max(2, cellSize * .075);

      context.drawImage(
        createMaskEdge(
          mask,
          sideDepth,
          0,
          sideBlur,
          "rgba(205, 210, 202, .1)",
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
          "rgba(18, 21, 21, .48)",
        ),
        0,
        0,
      );
      context.drawImage(
        createMaskEdge(
          mask,
          0,
          -Math.max(9, cellSize * .55),
          Math.max(2, lowerBlur * 1.15),
          "rgba(17, 19, 20, .68)",
        ),
        0,
        0,
      );
      context.drawImage(
        createMaskEdge(
          mask,
          0,
          -Math.max(6, cellSize * .3),
          Math.max(1, cellSize * .04),
          "rgba(12, 14, 15, .84)",
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
  return drawTerrainBackdropCell;
}

const cardinalCellEdges = [
  {
    dx: 0,
    dy: -1,
    startX: 0,
    startY: 0,
    endX: 1,
    endY: 0,
  },
  {
    dx: 1,
    dy: 0,
    startX: 1,
    startY: 0,
    endX: 1,
    endY: 1,
  },
  {
    dx: 0,
    dy: 1,
    startX: 1,
    startY: 1,
    endX: 0,
    endY: 1,
  },
  {
    dx: -1,
    dy: 0,
    startX: 0,
    startY: 1,
    endX: 0,
    endY: 0,
  },
] as const;

function isSailingShipDeckFloor(grid: Grid, x: number, y: number) {
  const terrain = grid[y]?.[x]?.terrain;
  return terrain === Terrain.Ground || terrain === Terrain.Door;
}

function drawInteriorArchitecture(
  grid: Grid,
  cellSize: number,
  mode: LandscapeMode,
  context: CanvasRenderingContext2D,
  tilesetProps?: TilesetPropImages,
  drawFloors = true,
  drawTerrainBackdropCell?: (x: number, y: number) => void,
  wallDebug: WallDebugOptions = {},
) {
  const style = drawFloors
    ? getInteriorVisualStyle(mode)
    : getArchitectureVisualStyle(mode);
  if (!style) return;
  const debugWallColors = {
    underlayVoid: "rgba(255, 0, 255, .5)",
    underlayGround: "rgba(0, 255, 80, .45)",
    underlayOther: "rgba(0, 220, 255, .45)",
    shadow: "rgba(0, 0, 255, .65)",
    surface: "rgba(255, 0, 0, .7)",
    edge: "rgba(255, 140, 0, .85)",
    highlight: "rgba(255, 255, 0, .85)",
    horizontalPath: "rgba(255, 255, 255, .95)",
    verticalPath: "rgba(0, 255, 255, .95)",
    facadePath: "rgba(180, 0, 255, .95)",
    junctionErase: "rgba(255, 0, 180, .8)",
    doorFrame: "rgba(0, 255, 255, .75)",
    doorLeaf: "rgba(255, 120, 0, .85)",
  };
  const wallDebugActive = (key: keyof WallDebugOptions) =>
    wallDebug[key] === true;
  const isArchitecture = (x: number, y: number) => {
    const terrain = grid[y]?.[x]?.terrain;
    return terrain === Terrain.Wall || terrain === Terrain.Door;
  };
  const floorTileIndex = mode === "house" || mode === "tavern" || mode === "ship" ||
    mode === "ship-deck" ? 0
    : mode === "crypt" ? 2
      : mode === "castle" ? 2
        : mode === "cathedral" ? 3
          : 3;
  const drawFloorTile = (left: number, top: number) => {
    const indoorTerrain = readyTilesetImage(tilesetProps?.indoorTerrain);
    if (!indoorTerrain) return false;
    context.save();
    context.imageSmoothingEnabled = Math.abs(cellSize / 32 - Math.round(cellSize / 32)) > .001;
    context.imageSmoothingQuality = "high";
    context.drawImage(indoorTerrain, floorTileIndex * 32, 0, 32, 32,
      left, top, cellSize, cellSize);
    context.restore();
    return true;
  };
  const isRoomFloor = (x: number, y: number) =>
    grid[y]?.[x]?.terrain === Terrain.Ground;
  const roomTintIndex = (roomId: number | undefined) => {
    if (mode === "ship-deck") return 0;
    const length = style.roomTints.length;
    return (((roomId ?? 0) % length) + length) % length;
  };
  const fallbackFloorTintIndex = (x: number, y: number) => {
    const tile = grid[y]?.[x];
    if (tile?.terrain === Terrain.Ground) return roomTintIndex(tile.roomId);
    const adjacentFloorOffsets = [
      [0, 1],
      [0, -1],
      [-1, 0],
      [1, 0],
      [-1, 1],
      [1, 1],
      [-1, -1],
      [1, -1],
    ] as const;
    for (const [dx, dy] of adjacentFloorOffsets) {
      const neighbor = grid[y + dy]?.[x + dx];
      if (neighbor?.terrain === Terrain.Ground) {
        return roomTintIndex(neighbor.roomId);
      }
    }
    return 0;
  };
  const drawFallbackFloorPattern = (
    _x: number,
    _y: number,
    left: number,
    top: number,
  ) => {
    context.lineWidth = Math.max(.65, cellSize * .018);
    if (style.floorPattern === "wood") {
      context.strokeStyle = "rgba(63, 39, 25, .14)";
      context.beginPath();
      context.moveTo(left, top + cellSize * .5);
      context.lineTo(left + cellSize, top + cellSize * .5);
      context.stroke();
    } else if (style.floorPattern === "metal") {
      context.strokeStyle = "rgba(28, 49, 56, .2)";
      context.strokeRect(
        left + cellSize * .08,
        top + cellSize * .08,
        cellSize * .84,
        cellSize * .84,
      );
      context.fillStyle = "rgba(202, 225, 226, .26)";
      for (const [offsetX, offsetY] of [[.16, .16], [.84, .16], [.16, .84], [.84, .84]]) {
        context.beginPath();
        context.arc(
          left + cellSize * offsetX,
          top + cellSize * offsetY,
          Math.max(.7, cellSize * .025),
          0,
          Math.PI * 2,
        );
        context.fill();
      }
    } else {
      context.strokeStyle = "rgba(48, 51, 48, .16)";
      context.strokeRect(left, top, cellSize, cellSize);
      if (terrainVariation(_x, _y, 1901) > .64) {
        context.beginPath();
        context.moveTo(left + cellSize * .22, top + cellSize * .18);
        context.lineTo(left + cellSize * .52, top + cellSize * .46);
        context.lineTo(left + cellSize * .42, top + cellSize * .72);
        context.stroke();
      }
    }
  };
  const drawFallbackFloorSurface = (
    x: number,
    y: number,
    left: number,
    top: number,
    tintIndex: number,
    drawBase: boolean,
    drawPattern = true,
  ) => {
    if (drawBase) {
      context.fillStyle = getTerrainStyle(Terrain.Ground, mode).color;
      context.fillRect(left, top, cellSize, cellSize);
    }
    context.fillStyle = style.roomTints[tintIndex];
    context.fillRect(left, top, cellSize, cellSize);
    if (!drawPattern) return;
    drawFallbackFloorPattern(x, y, left, top);
  };
  const drawTilesetArchitectureUnderlay = (x: number, y: number) => {
    if (!drawFloors) {
      drawTerrainBackdropCell?.(x, y);
      return;
    }
    const left = x * cellSize;
    const top = y * cellSize;
    type UnderlayFill = {
      base: string;
      terrain: TerrainKind;
      tintIndex?: number;
    };
    const terrainFill = (sampleX: number, sampleY: number): UnderlayFill | undefined => {
      const tile = grid[sampleY]?.[sampleX];
      if (!tile || tile.terrain === Terrain.Void || overlayTerrains.has(tile.terrain)) {
        return undefined;
      }
      if (tile.terrain === Terrain.Ground) {
        return {
          base: getTerrainStyle(Terrain.Ground, mode).color,
          terrain: Terrain.Ground,
          tintIndex: roomTintIndex(tile.roomId),
        };
      }
      return {
        base: getTerrainStyle(tile.terrain, mode).color,
        terrain: tile.terrain,
      };
    };
    const voidFill: UnderlayFill = {
      base: getTerrainStyle(Terrain.Void, mode).color,
      terrain: Terrain.Void,
    };
    const hasUnderlayTerrain = (sampleX: number, sampleY: number) => {
      const terrain = grid[sampleY]?.[sampleX]?.terrain;
      return terrain !== undefined &&
        terrain !== Terrain.Void &&
        !overlayTerrains.has(terrain);
    };
    const architectureDirection = () => {
      const tile = grid[y]?.[x];
      if (tile?.terrain === Terrain.Door) {
        return {
          horizontal: (tile.doorOrientation ?? "horizontal") === "horizontal",
          vertical: tile.doorOrientation === "vertical",
        };
      }
      const joinsNorth = isArchitecture(x, y - 1);
      const joinsSouth = isArchitecture(x, y + 1);
      const joinsWest = isArchitecture(x - 1, y);
      const joinsEast = isArchitecture(x + 1, y);
      const fullyIsolated = !joinsNorth && !joinsSouth && !joinsWest && !joinsEast;
      const verticalByTerrain = !fullyIsolated &&
        (hasUnderlayTerrain(x - 1, y) || hasUnderlayTerrain(x + 1, y)) &&
        !joinsWest && !joinsEast;
      const horizontalByTerrain = !fullyIsolated &&
        (hasUnderlayTerrain(x, y - 1) || hasUnderlayTerrain(x, y + 1)) &&
        !joinsNorth && !joinsSouth;
      const vertical = joinsNorth || joinsSouth || verticalByTerrain;
      const horizontal = joinsWest || joinsEast || horizontalByTerrain ||
        (!joinsNorth && !joinsSouth && !joinsWest && !joinsEast && !vertical);
      return { horizontal, vertical };
    };
    const direction = architectureDirection();

    const paintUnderlayRegion = (
      fill: UnderlayFill | undefined,
      regionLeft: number,
      regionTop: number,
      regionWidth: number,
      regionHeight: number,
    ) => {
      const resolvedFill = fill ?? voidFill;
      context.save();
      context.beginPath();
      context.rect(regionLeft, regionTop, regionWidth, regionHeight);
      context.clip();
      if (wallDebugActive("underlay")) {
        context.fillStyle = resolvedFill.terrain === Terrain.Void
          ? debugWallColors.underlayVoid
          : resolvedFill.terrain === Terrain.Ground
            ? debugWallColors.underlayGround
            : debugWallColors.underlayOther;
        context.fillRect(regionLeft, regionTop, regionWidth, regionHeight);
        context.strokeStyle = "rgba(255,255,255,.75)";
        context.lineWidth = Math.max(1, cellSize * .025);
        context.strokeRect(regionLeft, regionTop, regionWidth, regionHeight);
        context.restore();
        return;
      }
      if (resolvedFill.tintIndex !== undefined) {
        // Match the real floor rendering: use the tileset sprite when available so
        // the floor texture keeps flowing under the wall instead of a flat tint.
        const tiledFloor = drawFloorTile(left, top);
        if (!tiledFloor) {
          context.fillStyle = getTerrainStyle(Terrain.Ground, mode).color;
          context.fillRect(regionLeft, regionTop, regionWidth, regionHeight);
          context.fillStyle = style.roomTints[resolvedFill.tintIndex];
          context.fillRect(regionLeft, regionTop, regionWidth, regionHeight);
          drawFallbackFloorPattern(x, y, left, top);
        }
      } else {
        context.fillStyle = resolvedFill.base;
        context.fillRect(
          regionLeft,
          regionTop,
          regionWidth,
          regionHeight,
        );
        if (resolvedFill.terrain !== Terrain.Void) {
          const gradient = context.createLinearGradient(
            left,
            top,
            left + cellSize,
            top + cellSize,
          );
          gradient.addColorStop(0, "rgba(255,255,255,.09)");
          gradient.addColorStop(.48, "rgba(255,255,255,0)");
          gradient.addColorStop(1, "rgba(19,31,25,.10)");
          context.fillStyle = gradient;
          context.fillRect(
            regionLeft,
            regionTop,
            regionWidth,
            regionHeight,
          );
          if (
            resolvedFill.terrain === Terrain.Beach ||
            resolvedFill.terrain === Terrain.Road ||
            resolvedFill.terrain === Terrain.Bridge ||
            resolvedFill.terrain === Terrain.Difficult
          ) {
            drawTerrainDetail(grid, x, y, cellSize, mode, context, resolvedFill.terrain);
          }
        }
      }
      context.restore();
    };

    context.fillStyle = wallDebugActive("underlay")
      ? debugWallColors.underlayVoid
      : voidFill.base;
    context.fillRect(left, top, cellSize, cellSize);

    const north = terrainFill(x, y - 1);
    const south = terrainFill(x, y + 1);
    const west = terrainFill(x - 1, y);
    const east = terrainFill(x + 1, y);
    if (direction.horizontal && !direction.vertical) {
      paintUnderlayRegion(north, left, top, cellSize, cellSize * .5);
      paintUnderlayRegion(south, left, top + cellSize * .5, cellSize, cellSize * .5);
      return;
    }
    if (direction.vertical && !direction.horizontal) {
      paintUnderlayRegion(west, left, top, cellSize * .5, cellSize);
      paintUnderlayRegion(east, left + cellSize * .5, top, cellSize * .5, cellSize);
      return;
    }

    paintUnderlayRegion(
      terrainFill(x - 1, y - 1) ?? north ?? west,
      left,
      top,
      cellSize * .5,
      cellSize * .5,
    );
    paintUnderlayRegion(
      terrainFill(x + 1, y - 1) ?? north ?? east,
      left + cellSize * .5,
      top,
      cellSize * .5,
      cellSize * .5,
    );
    paintUnderlayRegion(
      terrainFill(x - 1, y + 1) ?? south ?? west,
      left,
      top + cellSize * .5,
      cellSize * .5,
      cellSize * .5,
    );
    paintUnderlayRegion(
      terrainFill(x + 1, y + 1) ?? south ?? east,
      left + cellSize * .5,
      top + cellSize * .5,
      cellSize * .5,
      cellSize * .5,
    );
  };
  const drawWallFacade = (
    left: number,
    top: number,
    width: number,
    height: number,
    wallX: number,
    wallY: number,
    endShadow = true,
  ) => {
    if (width <= 0 || height <= 0) return;
    context.save();
    context.beginPath();
    context.rect(left, top, width, height);
    context.clip();

    const verticalRun = height > width * 1.5 && width < cellSize * .8;
    const gradient = verticalRun
      ? context.createLinearGradient(left, top, left + width, top)
      : context.createLinearGradient(left, top, left, top + height);
    gradient.addColorStop(0, style.wallHighlight);
    gradient.addColorStop(.12, style.wallAlt);
    gradient.addColorStop(1, style.wall);
    context.fillStyle = wallDebugActive("door")
      ? debugWallColors.doorFrame
      : gradient;
    context.fillRect(left, top, width, height);
    if (wallDebugActive("door")) {
      context.strokeStyle = "rgba(255,255,255,.9)";
      context.lineWidth = Math.max(1, cellSize * .025);
      context.strokeRect(left, top, width, height);
      context.restore();
      return;
    }

    context.strokeStyle = style.wallDetail;
    context.lineWidth = Math.max(.65, cellSize * .022);
    const courseHeight = style.floorPattern === "wood"
      ? cellSize * .26
      : cellSize * .3;
    if (style.floorPattern === "wood") {
      for (let courseY = top + courseHeight; courseY < top + height; courseY += courseHeight) {
        context.beginPath();
        context.moveTo(left, courseY);
        context.lineTo(left + width, courseY);
        context.stroke();
      }
      const courseCount = Math.ceil(height / courseHeight);
      for (let course = 0; course < courseCount; course += 1) {
        const courseTop = top + course * courseHeight;
        const courseBottom = Math.min(top + height, courseTop + courseHeight);
        const spacing = cellSize * 1.35;
        const offset = (wallX + wallY + course) % 2 ? spacing * .5 : 0;
        for (let joint = left + offset; joint < left + width; joint += spacing) {
          if (joint <= left + cellSize * .08) continue;
          context.beginPath();
          context.moveTo(joint, courseTop + cellSize * .025);
          context.lineTo(joint, courseBottom - cellSize * .025);
          context.stroke();
        }
      }
    } else if (style.floorPattern === "metal") {
      for (let seamY = top + cellSize * .42; seamY < top + height; seamY += cellSize * .42) {
        context.beginPath();
        context.moveTo(left + cellSize * .06, seamY);
        context.lineTo(left + width - cellSize * .06, seamY);
        context.stroke();
      }
      context.fillStyle = style.doorHighlight;
      context.fillRect(
        left + width * .12,
        top + height * .12,
        Math.max(1, width * .08),
        Math.max(1, height * .08),
      );
    } else {
      for (let courseY = top + courseHeight; courseY < top + height; courseY += courseHeight) {
        context.beginPath();
        context.moveTo(left, courseY);
        context.lineTo(left + width, courseY);
        context.stroke();
      }
      const courseCount = Math.ceil(height / courseHeight);
      for (let course = 0; course < courseCount; course += 1) {
        const courseTop = top + course * courseHeight;
        const courseBottom = Math.min(top + height, courseTop + courseHeight);
        const spacing = cellSize * 1.1;
        const offset = (wallX + wallY + course) % 2 ? spacing * .5 : 0;
        for (let joint = left + offset; joint < left + width; joint += spacing) {
          if (joint <= left + cellSize * .08) continue;
          context.beginPath();
          context.moveTo(joint, courseTop);
          context.lineTo(joint, courseBottom);
          context.stroke();
        }
      }
    }

    if (endShadow) {
      context.fillStyle = "rgba(10, 9, 14, .2)";
      context.fillRect(left, top + height * .9, width, height * .1);
    }
    context.restore();
  };
  const traceChamferedRect = (
    left: number,
    top: number,
    width: number,
    height: number,
    chamfer: number,
  ) => {
    const cut = Math.min(chamfer, width * .25, height * .25);
    context.beginPath();
    context.moveTo(left + cut, top);
    context.lineTo(left + width - cut, top);
    context.lineTo(left + width, top + cut);
    context.lineTo(left + width, top + height - cut);
    context.lineTo(left + width - cut, top + height);
    context.lineTo(left + cut, top + height);
    context.lineTo(left, top + height - cut);
    context.lineTo(left, top + cut);
    context.closePath();
  };
  type WallRun = { x: number; y: number; length: number };
  const horizontalWallRuns = (predicate: (x: number, y: number) => boolean) => {
    const runs: WallRun[] = [];
    for (let y = 0; y < grid.length; y += 1) {
      let x = 0;
      while (x < grid[y].length) {
        if (!predicate(x, y)) {
          x += 1;
          continue;
        }
        const start = x;
        while (x < grid[y].length && predicate(x, y)) x += 1;
        runs.push({ x: start, y, length: x - start });
      }
    }
    return runs;
  };
  const verticalWallRuns = (predicate: (x: number, y: number) => boolean) => {
    const runs: WallRun[] = [];
    const width = grid[0]?.length ?? 0;
    for (let x = 0; x < width; x += 1) {
      let y = 0;
      while (y < grid.length) {
        if (!predicate(x, y)) {
          y += 1;
          continue;
        }
        const start = y;
        while (y < grid.length && predicate(x, y)) y += 1;
        runs.push({ x, y: start, length: y - start });
      }
    }
    return runs;
  };
  const isWall = (x: number, y: number) => grid[y]?.[x]?.terrain === Terrain.Wall;
  const renderWallNetworks = mode !== "ship-deck";
  const vesselInterior = mode === "ship" || mode === "spaceship";
  const networkWallCoreWidth = cellSize * .34;
  const networkWallFacadeWidth = cellSize * .5;
  const networkWallTopOffset = cellSize * .5 - networkWallCoreWidth * .5;
  const networkWallBottomOffset = cellSize;
  const isOutsideVessel = (x: number, y: number) => {
    const terrain = grid[y]?.[x]?.terrain;
    return terrain === undefined || terrain === Terrain.Void ||
      (mode === "ship" && terrain === Terrain.Water);
  };
  const vesselExteriorEdges = () => {
    const edges: Array<{
      startX: number;
      startY: number;
      endX: number;
      endY: number;
      x: number;
      y: number;
      dx: number;
      dy: number;
    }> = [];
    if (!vesselInterior) return edges;
    for (let y = 0; y < grid.length; y += 1) {
      for (let x = 0; x < grid[y].length; x += 1) {
        if (!isArchitecture(x, y)) continue;
        for (const edge of cardinalCellEdges) {
          if (!isOutsideVessel(x + edge.dx, y + edge.dy)) continue;
          edges.push({
            startX: x + edge.startX,
            startY: y + edge.startY,
            endX: x + edge.endX,
            endY: y + edge.endY,
            x,
            y,
            dx: edge.dx,
            dy: edge.dy,
          });
        }
      }
    }
    return edges;
  };
  const drawVesselHullApron = () => {
    for (const edge of vesselExteriorEdges()) {
      const left = edge.x * cellSize;
      const top = edge.y * cellSize;
      context.fillStyle = style.wall;
      if (edge.dy < 0) {
        context.fillRect(left, top, cellSize, cellSize * .54);
      } else if (edge.dy > 0) {
        context.fillRect(left, top + cellSize * .46, cellSize, cellSize * .54);
      } else if (edge.dx < 0) {
        context.fillRect(left, top, cellSize * .54, cellSize);
      } else {
        context.fillRect(left + cellSize * .46, top, cellSize * .54, cellSize);
      }
    }
  };
  const drawVesselHullContour = () => {
    const edges = vesselExteriorEdges();
    if (!edges.length) return;
    const traceEdges = () => {
      context.beginPath();
      for (const edge of edges) {
        context.moveTo(edge.startX * cellSize, edge.startY * cellSize);
        context.lineTo(edge.endX * cellSize, edge.endY * cellSize);
      }
    };
    context.save();
    context.lineCap = "round";
    context.lineJoin = mode === "spaceship" ? "bevel" : "round";
    context.shadowColor = mode === "spaceship"
      ? "rgba(5, 12, 16, .72)"
      : "rgba(24, 13, 9, .68)";
    context.shadowBlur = Math.max(2, cellSize * .16);
    context.strokeStyle = mode === "spaceship" ? "#1b2a30" : "#2a1913";
    context.lineWidth = Math.max(2, cellSize * .24);
    traceEdges();
    context.stroke();
    context.shadowColor = "transparent";
    context.strokeStyle = mode === "spaceship" ? "#526b73" : "#68442d";
    context.lineWidth = Math.max(1.5, cellSize * .15);
    traceEdges();
    context.stroke();
    context.strokeStyle = mode === "spaceship"
      ? "rgba(193, 229, 233, .34)"
      : "rgba(238, 186, 116, .3)";
    context.lineWidth = Math.max(.8, cellSize * .035);
    traceEdges();
    context.stroke();
    context.restore();
  };
  const drawWallNetworks = () => {
    const mapWidth = (grid[0]?.length ?? 0) * cellSize;
    const mapHeight = grid.length * cellSize;
    const wallDirections = (x: number, y: number) => {
      const joinsNorth = isArchitecture(x, y - 1);
      const joinsSouth = isArchitecture(x, y + 1);
      const joinsWest = isArchitecture(x - 1, y);
      const joinsEast = isArchitecture(x + 1, y);
      // A wall tile with no architecture neighbours at all (e.g. a lone corner
      // chamfer) has no real run direction; force it to the horizontal fallback
      // below instead of letting both floor heuristics fire and draw a cross.
      const fullyIsolated = !joinsNorth && !joinsSouth && !joinsWest && !joinsEast;
      const floorNorth = isRoomFloor(x, y - 1);
      const floorSouth = isRoomFloor(x, y + 1);
      const floorWest = isRoomFloor(x - 1, y);
      const floorEast = isRoomFloor(x + 1, y);
      const verticalByFloor = !fullyIsolated &&
        (floorWest || floorEast) && !joinsWest && !joinsEast;
      const horizontalByFloor = !fullyIsolated &&
        (floorNorth || floorSouth) && !joinsNorth && !joinsSouth;
      const vertical = joinsNorth || joinsSouth || verticalByFloor;
      const horizontal = joinsWest || joinsEast || horizontalByFloor ||
        (!joinsNorth && !joinsSouth && !joinsWest && !joinsEast && !vertical);
      return {
        joinsNorth,
        joinsSouth,
        joinsWest,
        joinsEast,
        horizontal,
        vertical,
      };
    };
    const traceWallLines = (
      target: CanvasRenderingContext2D,
      direction: "horizontal" | "vertical",
      offsetY = 0,
    ) => {
      target.beginPath();
      for (let y = 0; y < grid.length; y += 1) {
        for (let x = 0; x < grid[y].length; x += 1) {
          if (!isWall(x, y)) continue;
          const directions = wallDirections(x, y);
          if (!directions[direction]) continue;

          const left = x * cellSize;
          const top = y * cellSize;
          const centerX = left + cellSize * .5;
          const centerY = top + cellSize * .5;
          if (direction === "horizontal") {
            const isolated = !directions.joinsWest && !directions.joinsEast;
            const startX = isolated || directions.joinsWest ? left : centerX;
            const endX = isolated || directions.joinsEast ? left + cellSize : centerX;
            if (startX === endX) continue;
            target.moveTo(startX, centerY + offsetY);
            target.lineTo(endX, centerY + offsetY);
          } else {
            const isolated = !directions.joinsNorth && !directions.joinsSouth;
            const startY = isolated || directions.joinsNorth
              ? top
              : top + networkWallTopOffset;
            const endY = isolated || directions.joinsSouth
              ? top + cellSize
              : top + networkWallBottomOffset;
            if (startY === endY) continue;
            target.moveTo(centerX, startY);
            target.lineTo(centerX, endY);
          }
        }
      }
    };
    const strokeWallLines = (
      target: CanvasRenderingContext2D,
      direction: "horizontal" | "vertical",
      lineWidth: number,
      offsetY = 0,
    ) => {
      target.lineCap = "butt";
      target.lineJoin = "miter";
      target.lineWidth = lineWidth;
      traceWallLines(target, direction, offsetY);
      target.stroke();
    };
    const createWallMask = () => {
      const mask = document.createElement("canvas");
      mask.width = Math.ceil(mapWidth);
      mask.height = Math.ceil(mapHeight);
      const maskContext = mask.getContext("2d")!;
      maskContext.strokeStyle = "#000";
      strokeWallLines(maskContext, "horizontal", networkWallCoreWidth);
      strokeWallLines(maskContext, "vertical", networkWallCoreWidth);
      strokeWallLines(
        maskContext,
        "horizontal",
        networkWallFacadeWidth,
        cellSize * .25,
      );
      return mask;
    };
    const wallMask = createWallMask();
    const eraseJunctionDetails = (target: CanvasRenderingContext2D) => {
      const branchClear = Math.max(networkWallFacadeWidth, networkWallCoreWidth) * 1.15;
      const halfBranchClear = branchClear * .5;
      for (let y = 0; y < grid.length; y += 1) {
        for (let x = 0; x < grid[y].length; x += 1) {
          if (!isWall(x, y)) continue;
          const directions = wallDirections(x, y);
          if (!directions.horizontal || !directions.vertical) continue;
          const left = x * cellSize;
          const top = y * cellSize;
          target.fillRect(left, top, cellSize, cellSize);
          if (directions.joinsNorth) {
            target.fillRect(
              left + cellSize * .5 - halfBranchClear,
              top - cellSize * .5,
              branchClear,
              cellSize * .5,
            );
          }
          if (directions.joinsSouth) {
            target.fillRect(
              left + cellSize * .5 - halfBranchClear,
              top + cellSize,
              branchClear,
              cellSize * .5,
            );
          }
          if (directions.joinsWest) {
            target.fillRect(
              left - cellSize * .5,
              top + cellSize * .5 - halfBranchClear,
              cellSize * .5,
              branchClear,
            );
          }
          if (directions.joinsEast) {
            target.fillRect(
              left + cellSize,
              top + cellSize * .5 - halfBranchClear,
              cellSize * .5,
              branchClear,
            );
          }
        }
      }
    };
    const drawJunctionDebugRegions = () => {
      const branchClear = Math.max(networkWallFacadeWidth, networkWallCoreWidth) * 1.15;
      const halfBranchClear = branchClear * .5;
      context.save();
      context.fillStyle = debugWallColors.junctionErase;
      context.strokeStyle = "rgba(255,255,255,.95)";
      context.lineWidth = Math.max(1, cellSize * .025);
      for (let y = 0; y < grid.length; y += 1) {
        for (let x = 0; x < grid[y].length; x += 1) {
          if (!isWall(x, y)) continue;
          const directions = wallDirections(x, y);
          if (!directions.horizontal || !directions.vertical) continue;
          const left = x * cellSize;
          const top = y * cellSize;
          const regions = [
            [left, top, cellSize, cellSize],
            ...(directions.joinsNorth
              ? [[
                left + cellSize * .5 - halfBranchClear,
                top - cellSize * .5,
                branchClear,
                cellSize * .5,
              ]]
              : []),
            ...(directions.joinsSouth
              ? [[
                left + cellSize * .5 - halfBranchClear,
                top + cellSize,
                branchClear,
                cellSize * .5,
              ]]
              : []),
            ...(directions.joinsWest
              ? [[
                left - cellSize * .5,
                top + cellSize * .5 - halfBranchClear,
                cellSize * .5,
                branchClear,
              ]]
              : []),
            ...(directions.joinsEast
              ? [[
                left + cellSize,
                top + cellSize * .5 - halfBranchClear,
                cellSize * .5,
                branchClear,
              ]]
              : []),
          ] as Array<[number, number, number, number]>;
          for (const [regionLeft, regionTop, regionWidth, regionHeight] of regions) {
            context.fillRect(regionLeft, regionTop, regionWidth, regionHeight);
            context.strokeRect(regionLeft, regionTop, regionWidth, regionHeight);
          }
        }
      }
      context.restore();
    };
    const drawNetworkDebugPaths = () => {
      context.save();
      context.globalAlpha = 1;
      context.strokeStyle = debugWallColors.horizontalPath;
      strokeWallLines(context, "horizontal", Math.max(2, cellSize * .075));
      context.strokeStyle = debugWallColors.verticalPath;
      strokeWallLines(context, "vertical", Math.max(2, cellSize * .075));
      context.strokeStyle = debugWallColors.facadePath;
      strokeWallLines(
        context,
        "horizontal",
        Math.max(2, cellSize * .075),
        cellSize * .25,
      );
      context.restore();
    };
    const drawNetworkShadows = () => {
      const shadow = createOuterMaskShadow(
        wallMask,
        cellSize * .055,
        cellSize * .095,
        Math.max(1.5, cellSize * .13),
        wallDebugActive("shadow") ? debugWallColors.shadow : "rgba(10, 9, 13, .32)",
      );
      const shadowContext = shadow.getContext("2d")!;
      shadowContext.globalCompositeOperation = "destination-out";
      eraseJunctionDetails(shadowContext);
      context.drawImage(shadow, 0, 0);
    };
    const drawNetworkSurface = () => {
      const layer = document.createElement("canvas");
      layer.width = Math.ceil(mapWidth);
      layer.height = Math.ceil(mapHeight);
      const layerContext = layer.getContext("2d")!;
      layerContext.fillStyle = wallDebugActive("surface")
        ? debugWallColors.surface
        : style.wall;
      layerContext.fillRect(0, 0, mapWidth, mapHeight);

      layerContext.globalCompositeOperation = "destination-in";
      layerContext.drawImage(wallMask, 0, 0);
      context.drawImage(layer, 0, 0);
    };
    const drawNetworkEdges = () => {
      const edge = Math.max(1, cellSize * .045);
      const highlight = Math.max(.75, cellSize * .025);
      const edgeLayer = document.createElement("canvas");
      edgeLayer.width = wallMask.width;
      edgeLayer.height = wallMask.height;
      const edgeContext = edgeLayer.getContext("2d")!;
      edgeContext.drawImage(createMaskEdge(
        wallMask,
        0,
        -edge,
        0,
        wallDebugActive("edge") ? debugWallColors.edge : style.wallEdge,
      ), 0, 0);
      edgeContext.drawImage(createMaskEdge(
        wallMask,
        -edge,
        0,
        0,
        wallDebugActive("edge") ? debugWallColors.edge : style.wallEdge,
      ), 0, 0);
      edgeContext.drawImage(
        createMaskEdge(
          wallMask,
          0,
          highlight,
          0,
          wallDebugActive("highlight") ? debugWallColors.highlight : style.wallHighlight,
        ),
        0,
        0,
      );
      edgeContext.drawImage(
        createMaskEdge(
          wallMask,
          highlight,
          0,
          0,
          wallDebugActive("highlight") ? debugWallColors.highlight : style.wallHighlight,
        ),
        0,
        0,
      );
      edgeContext.globalCompositeOperation = "destination-in";
      edgeContext.drawImage(wallMask, 0, 0);
      edgeContext.globalCompositeOperation = "destination-out";
      eraseJunctionDetails(edgeContext);
      context.drawImage(edgeLayer, 0, 0);
    };
    for (let y = 0; y < grid.length; y += 1) {
      for (let x = 0; x < grid[y].length; x += 1) {
        if (isWall(x, y)) drawTilesetArchitectureUnderlay(x, y);
      }
    }
    drawVesselHullApron();
    drawNetworkShadows();
    drawNetworkSurface();
    drawNetworkEdges();
    if (wallDebugActive("path")) drawNetworkDebugPaths();
    if (wallDebugActive("junction")) drawJunctionDebugRegions();
    return;

  };

  type DoorRun = {
    x: number;
    y: number;
    length: number;
    orientation: "horizontal" | "vertical";
  };
  const doorRuns = () => {
    const runs: DoorRun[] = [];
    for (const run of horizontalWallRuns((x, y) =>
      grid[y]?.[x]?.terrain === Terrain.Door &&
      (grid[y][x].doorOrientation ?? "horizontal") === "horizontal")) {
      runs.push({ ...run, orientation: "horizontal" });
    }
    for (const run of verticalWallRuns((x, y) =>
      grid[y]?.[x]?.terrain === Terrain.Door &&
      grid[y][x].doorOrientation === "vertical")) {
      runs.push({ ...run, orientation: "vertical" });
    }
    return runs;
  };
  const drawNetworkDoorRun = (run: DoorRun) => {
    for (let offset = 0; offset < run.length; offset += 1) {
      drawTilesetArchitectureUnderlay(
        run.x + (run.orientation === "horizontal" ? offset : 0),
        run.y + (run.orientation === "vertical" ? offset : 0),
      );
    }

    const left = run.x * cellSize;
    const top = run.y * cellSize;
    const width = (run.orientation === "horizontal" ? run.length : 1) * cellSize;
    const height = (run.orientation === "vertical" ? run.length : 1) * cellSize;
    const horizontal = run.orientation === "horizontal";
    const doubleDoor = run.length === 2;
    const frontFacing = horizontal && Array.from({ length: run.length }, (_, offset) =>
      isRoomFloor(run.x + offset, run.y + 1)
    ).some(Boolean);

    if (frontFacing) {
      const facadeTop = top + networkWallTopOffset;
      const facadeHeight = cellSize - networkWallTopOffset;
      const copingTop = top + networkWallTopOffset;
      const copingHeight = Math.max(1, networkWallCoreWidth * .32);
      const frameWidth = Math.max(1, cellSize * .07);
      const leafInsetX = cellSize * .1;
      const leafInsetY = Math.max(1, cellSize * .025);
      const leafTop = facadeTop + leafInsetY;
      const leafHeight = top + cellSize - leafTop;
      drawWallFacade(left, facadeTop, width, facadeHeight, run.x, run.y);
      context.fillStyle = wallDebugActive("door")
        ? debugWallColors.doorFrame
        : style.wallAlt;
      context.fillRect(left, copingTop, width, copingHeight);
      context.fillRect(left, facadeTop, frameWidth, facadeHeight);
      context.fillRect(left + width - frameWidth, facadeTop, frameWidth, facadeHeight);
      context.fillStyle = wallDebugActive("door")
        ? debugWallColors.highlight
        : style.wallHighlight;
      context.fillRect(left, copingTop, width, Math.max(1, cellSize * .035));
      context.fillStyle = wallDebugActive("door")
        ? debugWallColors.edge
        : style.doorEdge;
      context.fillRect(
        left + frameWidth,
        leafTop - cellSize * .04,
        width - frameWidth * 2,
        top + cellSize - leafTop + leafInsetY,
      );
      context.fillStyle = wallDebugActive("door")
        ? debugWallColors.doorLeaf
        : style.door;
      traceChamferedRect(
        left + leafInsetX,
        leafTop,
        width - leafInsetX * 2,
        leafHeight,
        cellSize * .035,
      );
      context.fill();
      if (doubleDoor) {
        context.strokeStyle = wallDebugActive("door")
          ? "rgba(255,255,255,.95)"
          : style.doorEdge;
        context.lineWidth = Math.max(1, cellSize * .035);
        context.beginPath();
        context.moveTo(left + width * .5, leafTop + cellSize * .035);
        context.lineTo(left + width * .5, top + cellSize - cellSize * .035);
        context.stroke();
      }
      context.strokeStyle = wallDebugActive("door")
        ? "rgba(255,255,255,.95)"
        : style.doorHighlight;
      context.lineWidth = Math.max(.7, cellSize * .022);
      const panelCount = Math.max(2, run.length * 3);
      for (let panel = 1; panel < panelCount; panel += 1) {
        const panelX = left + leafInsetX + (width - leafInsetX * 2) * panel / panelCount;
        context.beginPath();
        context.moveTo(panelX, leafTop + cellSize * .02);
        context.lineTo(panelX, top + cellSize);
        context.stroke();
      }
      context.fillStyle = wallDebugActive("door")
        ? debugWallColors.highlight
        : style.hardware;
      if (doubleDoor) {
        for (const handleX of [
          left + width * .5 - cellSize * .11,
          left + width * .5 + cellSize * .11,
        ]) {
          context.beginPath();
          context.arc(
            handleX,
            leafTop + leafHeight * .52,
            Math.max(1, cellSize * .04),
            0,
            Math.PI * 2,
          );
          context.fill();
        }
      } else {
        context.beginPath();
        context.arc(
          left + width - cellSize * .21,
          leafTop + leafHeight * .52,
          Math.max(1, cellSize * .04),
          0,
          Math.PI * 2,
        );
        context.fill();
      }
      return;
    }

    const frame = horizontal
      ? {
        x: left,
        y: top + networkWallTopOffset,
        width,
        height: cellSize - networkWallTopOffset,
      }
      : {
        x: left + cellSize * .5 - networkWallCoreWidth * .5,
        y: top,
        width: networkWallCoreWidth,
        height,
      };
    context.fillStyle = wallDebugActive("door")
      ? debugWallColors.edge
      : style.wallEdge;
    context.fillRect(frame.x, frame.y, frame.width, frame.height);

    const doorInset = Math.max(1, cellSize * .025);
    const leaf = horizontal
      ? {
        x: left + doorInset,
        y: frame.y + doorInset,
        width: width - doorInset * 2,
        height: frame.height - doorInset * 2,
      }
      : {
        x: frame.x + doorInset,
        y: top + doorInset,
        width: frame.width - doorInset * 2,
        height: height - doorInset * 2,
      };

    context.fillStyle = wallDebugActive("door")
      ? debugWallColors.doorFrame
      : style.wallAlt;
    if (horizontal) {
      traceChamferedRect(left, frame.y, cellSize * .11, frame.height, cellSize * .035);
      context.fill();
      traceChamferedRect(left + width - cellSize * .11, frame.y, cellSize * .11, frame.height, cellSize * .035);
      context.fill();
    } else {
      traceChamferedRect(frame.x, top, frame.width, cellSize * .11, cellSize * .035);
      context.fill();
      traceChamferedRect(frame.x, top + height - cellSize * .11, frame.width, cellSize * .11, cellSize * .035);
      context.fill();
    }

    context.fillStyle = wallDebugActive("door")
      ? debugWallColors.doorLeaf
      : style.door;
    context.strokeStyle = wallDebugActive("door")
      ? debugWallColors.edge
      : style.doorEdge;
    context.lineWidth = Math.max(1, cellSize * .04);
    traceChamferedRect(leaf.x, leaf.y, leaf.width, leaf.height, cellSize * .035);
    context.fill();
    context.stroke();
    if (doubleDoor) {
      context.strokeStyle = wallDebugActive("door")
        ? debugWallColors.edge
        : style.doorEdge;
      context.lineWidth = Math.max(1, cellSize * .035);
      context.beginPath();
      if (horizontal) {
        context.moveTo(leaf.x + leaf.width * .5, leaf.y + cellSize * .035);
        context.lineTo(leaf.x + leaf.width * .5, leaf.y + leaf.height - cellSize * .035);
      } else {
        context.moveTo(leaf.x + cellSize * .035, leaf.y + leaf.height * .5);
        context.lineTo(leaf.x + leaf.width - cellSize * .035, leaf.y + leaf.height * .5);
      }
      context.stroke();
    }

    context.strokeStyle = wallDebugActive("door")
      ? debugWallColors.highlight
      : style.wallHighlight;
    context.lineWidth = Math.max(.7, cellSize * .018);
    context.beginPath();
    if (horizontal) {
      context.moveTo(left + cellSize * .1, frame.y + cellSize * .02);
      context.lineTo(left + cellSize * .1, top + cellSize);
      context.moveTo(left + width - cellSize * .1, frame.y + cellSize * .02);
      context.lineTo(left + width - cellSize * .1, top + cellSize);
    } else {
      context.moveTo(frame.x + doorInset, top + cellSize * .1);
      context.lineTo(frame.x + frame.width - doorInset, top + cellSize * .1);
      context.moveTo(frame.x + doorInset, top + height - cellSize * .1);
      context.lineTo(frame.x + frame.width - doorInset, top + height - cellSize * .1);
    }
    context.stroke();

    context.strokeStyle = wallDebugActive("door")
      ? "rgba(255,255,255,.95)"
      : style.doorHighlight;
    context.lineWidth = Math.max(.7, cellSize * .02);
    context.beginPath();
    if (horizontal) {
      context.moveTo(leaf.x + cellSize * .08, leaf.y + leaf.height * .5);
      context.lineTo(leaf.x + leaf.width - cellSize * .08, leaf.y + leaf.height * .5);
    } else {
      context.moveTo(leaf.x + leaf.width * .5, leaf.y + cellSize * .08);
      context.lineTo(leaf.x + leaf.width * .5, leaf.y + leaf.height - cellSize * .08);
    }
    context.stroke();

    context.fillStyle = wallDebugActive("door")
      ? debugWallColors.highlight
      : style.hardware;
    if (doubleDoor) {
      const handles = horizontal
        ? [
          { x: leaf.x + leaf.width * .5 - cellSize * .1, y: leaf.y + leaf.height * .68 },
          { x: leaf.x + leaf.width * .5 + cellSize * .1, y: leaf.y + leaf.height * .68 },
        ]
        : [
          { x: leaf.x + leaf.width * .72, y: leaf.y + leaf.height * .5 - cellSize * .1 },
          { x: leaf.x + leaf.width * .72, y: leaf.y + leaf.height * .5 + cellSize * .1 },
        ];
      for (const handle of handles) {
        context.beginPath();
        context.arc(
          handle.x,
          handle.y,
          Math.max(1, cellSize * .038),
          0,
          Math.PI * 2,
        );
        context.fill();
      }
    } else {
      context.beginPath();
      context.arc(
        horizontal ? leaf.x + leaf.width - cellSize * .2 : leaf.x + leaf.width * .72,
        horizontal ? leaf.y + leaf.height * .68 : leaf.y + leaf.height - cellSize * .22,
        Math.max(1, cellSize * .038),
        0,
        Math.PI * 2,
      );
      context.fill();
    }
  };

  context.save();
  if (drawFloors) {
    for (let y = 0; y < grid.length; y += 1) {
      for (let x = 0; x < grid[y].length; x += 1) {
        const tile = grid[y][x];
        const left = x * cellSize;
        const top = y * cellSize;
        if (tile.terrain !== Terrain.Ground) continue;
        const tiledFloor = drawFloorTile(left, top);
        if (!tiledFloor) {
          drawFallbackFloorSurface(
            x,
            y,
            left,
            top,
            fallbackFloorTintIndex(x, y),
            false,
            true,
          );
        }
      }
    }
  }

  if (renderWallNetworks) {
    drawWallNetworks();
  } else if (vesselInterior) {
    drawVesselHullApron();
  }

  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      const tile = grid[y][x];
      if (tile.terrain !== Terrain.Wall) continue;
      const left = x * cellSize;
      const top = y * cellSize;
      if (mode === "ship-deck") {
        const connectedHorizontally = isArchitecture(x - 1, y) ||
          isArchitecture(x + 1, y);
        const connectedVertically = isArchitecture(x, y - 1) ||
          isArchitecture(x, y + 1);

        context.fillStyle = style.wallAlt;
        context.fillRect(
          left + cellSize * .08,
          top + cellSize * .08,
          cellSize * .84,
          cellSize * .84,
        );
        context.strokeStyle = "rgba(222, 153, 82, .2)";
        context.lineWidth = Math.max(.65, cellSize * .022);
        if (connectedHorizontally) {
          for (const offset of [.36, .66]) {
            context.beginPath();
            context.moveTo(left, top + cellSize * offset);
            context.lineTo(left + cellSize, top + cellSize * offset);
            context.stroke();
          }
        }
        if (connectedVertically) {
          for (const offset of [.36, .66]) {
            context.beginPath();
            context.moveTo(left + cellSize * offset, top);
            context.lineTo(left + cellSize * offset, top + cellSize);
            context.stroke();
          }
        }

        for (const edge of cardinalCellEdges) {
          if (!isSailingShipDeckFloor(grid, x + edge.dx, y + edge.dy)) {
            continue;
          }
          const inset = cellSize * .08;
          const startX = left + edge.startX * cellSize - edge.dx * inset;
          const startY = top + edge.startY * cellSize - edge.dy * inset;
          const endX = left + edge.endX * cellSize - edge.dx * inset;
          const endY = top + edge.endY * cellSize - edge.dy * inset;

          context.save();
          context.shadowColor = "rgba(27, 18, 14, .42)";
          context.shadowBlur = Math.max(1.4, cellSize * .08);
          context.shadowOffsetX = edge.dx * cellSize * .055;
          context.shadowOffsetY = edge.dy * cellSize * .055;
          context.strokeStyle = "#2f211b";
          context.lineWidth = Math.max(1.35, cellSize * .09);
          context.beginPath();
          context.moveTo(startX, startY);
          context.lineTo(endX, endY);
          context.stroke();
          context.restore();

          context.strokeStyle = "rgba(230, 177, 104, .56)";
          context.lineWidth = Math.max(.7, cellSize * .026);
          context.beginPath();
          context.moveTo(
            startX - edge.dx * cellSize * .055,
            startY - edge.dy * cellSize * .055,
          );
          context.lineTo(
            endX - edge.dx * cellSize * .055,
            endY - edge.dy * cellSize * .055,
          );
          context.stroke();

          if ((x + y) % 2 === 0) {
            context.fillStyle = "#70472d";
            context.strokeStyle = "#291d18";
            context.lineWidth = Math.max(.65, cellSize * .024);
            context.beginPath();
            context.arc(
              (startX + endX) / 2,
              (startY + endY) / 2,
              cellSize * .075,
              0,
              Math.PI * 2,
            );
            context.fill();
            context.stroke();
          }
        }
        continue;
      }
      if (renderWallNetworks) continue;
      const connectedHorizontally = isArchitecture(x - 1, y) ||
        isArchitecture(x + 1, y);
      const connectedVertically = isArchitecture(x, y - 1) ||
        isArchitecture(x, y + 1);
      const capInset = cellSize * .12;
      const traceWallCap = () => {
        context.beginPath();
        context.rect(
          left + capInset,
          top + capInset,
          cellSize - capInset * 2,
          cellSize - capInset * 2,
        );
        if (isArchitecture(x - 1, y)) {
          context.rect(
            left,
            top + capInset,
            cellSize * .5,
            cellSize - capInset * 2,
          );
        }
        if (isArchitecture(x + 1, y)) {
          context.rect(
            left + cellSize * .5,
            top + capInset,
            cellSize * .5,
            cellSize - capInset * 2,
          );
        }
        if (isArchitecture(x, y - 1)) {
          context.rect(
            left + capInset,
            top,
            cellSize - capInset * 2,
            cellSize * .5,
          );
        }
        if (isArchitecture(x, y + 1)) {
          context.rect(
            left + capInset,
            top + cellSize * .5,
            cellSize - capInset * 2,
            cellSize * .5,
          );
        }
      };

      // Give the wall cap volume without laying the same bright stripe over
      // every tile. The soft wash is continuous through connected cells while
      // exposed edges below supply the actual silhouette.
      context.save();
      traceWallCap();
      context.clip();
      const capGradient = context.createLinearGradient(
        left,
        top,
        left + cellSize,
        top + cellSize,
      );
      capGradient.addColorStop(0, style.wallHighlight);
      capGradient.addColorStop(.46, "rgba(255,255,255,0)");
      capGradient.addColorStop(1, "rgba(12,15,15,.2)");
      context.fillStyle = capGradient;
      context.fillRect(left, top, cellSize, cellSize);

      // Material marks follow the architecture rather than alternating
      // arbitrarily from one cell to the next.
      context.strokeStyle = style.wallDetail;
      context.fillStyle = style.wallDetail;
      context.lineWidth = Math.max(.65, cellSize * .014);
      if (style.floorPattern === "wood") {
        context.beginPath();
        if (connectedHorizontally && !connectedVertically) {
          for (const ratio of [.36, .67]) {
            context.moveTo(left + cellSize * .08, top + cellSize * ratio);
            context.lineTo(left + cellSize * .92, top + cellSize * ratio);
          }
        } else if (connectedVertically && !connectedHorizontally) {
          for (const ratio of [.36, .67]) {
            context.moveTo(left + cellSize * ratio, top + cellSize * .08);
            context.lineTo(left + cellSize * ratio, top + cellSize * .92);
          }
        } else {
          context.moveTo(left + cellSize * .16, top + cellSize * .5);
          context.lineTo(left + cellSize * .84, top + cellSize * .5);
        }
        context.stroke();
        if (terrainVariation(x, y, 2467) > .68) {
          context.beginPath();
          context.ellipse(
            left + cellSize * (.38 + terrainVariation(x, y, 2479) * .24),
            top + cellSize * (.38 + terrainVariation(x, y, 2491) * .24),
            cellSize * .055,
            cellSize * .025,
            0,
            0,
            Math.PI * 2,
          );
          context.stroke();
        }
      } else if (style.floorPattern === "metal") {
        context.strokeRect(
          left + cellSize * .14,
          top + cellSize * .14,
          cellSize * .72,
          cellSize * .72,
        );
        for (const [offsetX, offsetY] of [
          [.18, .18], [.82, .18], [.18, .82], [.82, .82],
        ]) {
          context.beginPath();
          context.arc(
            left + cellSize * offsetX,
            top + cellSize * offsetY,
            Math.max(.55, cellSize * .018),
            0,
            Math.PI * 2,
          );
          context.fill();
        }
      } else {
        const upperJoint = (x + y) % 2 ? .35 : .65;
        context.beginPath();
        context.moveTo(left + cellSize * .08, top + cellSize * .5);
        context.lineTo(left + cellSize * .92, top + cellSize * .5);
        context.moveTo(left + cellSize * upperJoint, top + cellSize * .08);
        context.lineTo(left + cellSize * upperJoint, top + cellSize * .5);
        context.moveTo(left + cellSize * (1 - upperJoint), top + cellSize * .5);
        context.lineTo(left + cellSize * (1 - upperJoint), top + cellSize * .92);
        context.stroke();
      }
      context.restore();

      for (const edge of cardinalCellEdges) {
        if (isArchitecture(x + edge.dx, y + edge.dy)) continue;
        const startX = left + edge.startX * cellSize;
        const startY = top + edge.startY * cellSize;
        const endX = left + edge.endX * cellSize;
        const endY = top + edge.endY * cellSize;
        const neighbor = grid[y + edge.dy]?.[x + edge.dx];

        // Cast the weight of the wall into the adjacent room. This makes the
        // full-tile wall read as raised masonry/timber instead of dark floor.
        if (neighbor && neighbor.terrain !== Terrain.Void) {
          context.save();
          context.shadowColor = "rgba(18,20,20,.52)";
          context.shadowBlur = Math.max(2, cellSize * .13);
          context.shadowOffsetX = edge.dx * cellSize * .11;
          context.shadowOffsetY = edge.dy * cellSize * .11;
          context.strokeStyle = style.wallEdge;
          context.lineWidth = Math.max(1.5, cellSize * .07);
          context.beginPath();
          context.moveTo(startX, startY);
          context.lineTo(endX, endY);
          context.stroke();
          context.restore();
        }

        context.strokeStyle = style.wallEdge;
        context.lineWidth = Math.max(1, cellSize * .045);
        context.beginPath();
        context.moveTo(startX, startY);
        context.lineTo(endX, endY);
        context.stroke();

        const bevelInset = cellSize * .055;
        context.strokeStyle = style.wallHighlight;
        context.lineWidth = Math.max(.6, cellSize * .022);
        context.beginPath();
        context.moveTo(
          startX - edge.dx * bevelInset,
          startY - edge.dy * bevelInset,
        );
        context.lineTo(
          endX - edge.dx * bevelInset,
          endY - edge.dy * bevelInset,
        );
        context.stroke();
      }
    }
  }

  drawVesselHullContour();

  if (renderWallNetworks) {
    for (const run of doorRuns()) drawNetworkDoorRun(run);
    context.restore();
    return;
  }

  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      const tile = grid[y][x];
      if (tile.terrain !== Terrain.Door) continue;
      const left = x * cellSize;
      const top = y * cellSize;
      const horizontal = tile.doorOrientation === "horizontal";
      if (renderWallNetworks) {
        drawTilesetArchitectureUnderlay(x, y);
        const frontFacing = horizontal && isRoomFloor(x, y + 1);
        if (frontFacing) {
          const facadeTop = top + cellSize * .34;
          drawWallFacade(left, facadeTop, cellSize, cellSize * .66, x, y);

          // The frame reaches both neighbouring facades; only the leaf is
          // inset, avoiding the detached block produced by the old door tile.
          context.fillStyle = style.wallAlt;
          context.fillRect(
            left,
            top + cellSize * .27,
            cellSize,
            cellSize * .13,
          );
          context.fillRect(left, facadeTop, cellSize * .07, cellSize * .66);
          context.fillRect(
            left + cellSize * .93,
            facadeTop,
            cellSize * .07,
            cellSize * .66,
          );
          context.fillStyle = style.wallHighlight;
          context.fillRect(
            left,
            top + cellSize * .27,
            cellSize,
            Math.max(1, cellSize * .035),
          );
          context.fillStyle = style.doorEdge;
          context.fillRect(
            left + cellSize * .07,
            top + cellSize * .39,
            cellSize * .86,
            cellSize * .61,
          );
          context.fillStyle = style.door;
          traceChamferedRect(
            left + cellSize * .1,
            top + cellSize * .43,
            cellSize * .8,
            cellSize * .57,
            cellSize * .035,
          );
          context.fill();
          context.strokeStyle = style.doorHighlight;
          context.lineWidth = Math.max(.7, cellSize * .022);
          for (const ratio of [.25, .5, .75]) {
            context.beginPath();
            context.moveTo(left + cellSize * (.1 + .8 * ratio), top + cellSize * .45);
            context.lineTo(left + cellSize * (.1 + .8 * ratio), top + cellSize);
            context.stroke();
          }
          context.fillStyle = style.hardware;
          context.beginPath();
          context.arc(
            left + cellSize * .79,
            top + cellSize * .7,
            Math.max(1, cellSize * .04),
            0,
            Math.PI * 2,
          );
          context.fill();
        } else {
          const verticalDoor = !horizontal;
          const frame = verticalDoor
            ? {
              x: left + cellSize * .26,
              y: top,
              width: cellSize * .48,
              height: cellSize,
            }
            : {
              x: left,
              y: top + cellSize * .26,
              width: cellSize,
              height: cellSize * .48,
            };
          context.fillStyle = style.wallEdge;
          context.fillRect(frame.x, frame.y, frame.width, frame.height);

          const leaf = verticalDoor
            ? {
              x: left + cellSize * .34,
              y: top + cellSize * .05,
              width: cellSize * .32,
              height: cellSize * .9,
            }
            : {
              x: left + cellSize * .04,
              y: top + cellSize * .34,
              width: cellSize * .92,
              height: cellSize * .32,
            };
          context.fillStyle = style.wallAlt;
          if (verticalDoor) {
            traceChamferedRect(
              left + cellSize * .25,
              top,
              cellSize * .5,
              cellSize * .11,
              cellSize * .035,
            );
            context.fill();
            traceChamferedRect(
              left + cellSize * .25,
              top + cellSize * .89,
              cellSize * .5,
              cellSize * .11,
              cellSize * .035,
            );
            context.fill();
          } else {
            traceChamferedRect(
              left,
              top + cellSize * .25,
              cellSize * .11,
              cellSize * .5,
              cellSize * .035,
            );
            context.fill();
            traceChamferedRect(
              left + cellSize * .89,
              top + cellSize * .25,
              cellSize * .11,
              cellSize * .5,
              cellSize * .035,
            );
            context.fill();
          }
          context.fillStyle = style.door;
          context.strokeStyle = style.doorEdge;
          context.lineWidth = Math.max(1, cellSize * .04);
          traceChamferedRect(
            leaf.x,
            leaf.y,
            leaf.width,
            leaf.height,
            cellSize * .035,
          );
          context.fill();
          context.stroke();
          context.strokeStyle = style.wallHighlight;
          context.lineWidth = Math.max(.7, cellSize * .018);
          context.beginPath();
          if (verticalDoor) {
            context.moveTo(left + cellSize * .27, top + cellSize * .1);
            context.lineTo(left + cellSize * .73, top + cellSize * .1);
            context.moveTo(left + cellSize * .27, top + cellSize * .9);
            context.lineTo(left + cellSize * .73, top + cellSize * .9);
          } else {
            context.moveTo(left + cellSize * .1, top + cellSize * .27);
            context.lineTo(left + cellSize * .1, top + cellSize * .73);
            context.moveTo(left + cellSize * .9, top + cellSize * .27);
            context.lineTo(left + cellSize * .9, top + cellSize * .73);
          }
          context.stroke();
          context.strokeStyle = style.doorHighlight;
          context.lineWidth = Math.max(.7, cellSize * .02);
          context.beginPath();
          if (verticalDoor) {
            context.moveTo(leaf.x + leaf.width * .5, leaf.y + cellSize * .08);
            context.lineTo(leaf.x + leaf.width * .5, leaf.y + leaf.height - cellSize * .08);
          } else {
            context.moveTo(leaf.x + cellSize * .08, leaf.y + leaf.height * .5);
            context.lineTo(leaf.x + leaf.width - cellSize * .08, leaf.y + leaf.height * .5);
          }
          context.stroke();
          context.fillStyle = style.hardware;
          context.beginPath();
          context.arc(
            leaf.x + leaf.width * .72,
            verticalDoor ? leaf.y + leaf.height * .75 : leaf.y + leaf.height * .68,
            Math.max(1, cellSize * .038),
            0,
            Math.PI * 2,
          );
          context.fill();
        }
        continue;
      }
      if (!drawFloorTile(left, top)) {
        context.fillStyle = getTerrainStyle(Terrain.Ground, mode).color;
        context.fillRect(left, top, cellSize, cellSize);
      }
      context.lineWidth = Math.max(.65, cellSize * .018);
      if (style.floorPattern === "wood") {
        context.strokeStyle = "rgba(63, 39, 25, .14)";
        context.beginPath();
        context.moveTo(left, top + cellSize * .5);
        context.lineTo(left + cellSize, top + cellSize * .5);
        context.stroke();
      } else {
        context.strokeStyle = style.floorPattern === "metal"
          ? "rgba(28, 49, 56, .2)"
          : "rgba(48, 51, 48, .16)";
        context.strokeRect(
          left + cellSize * .08,
          top + cellSize * .08,
          cellSize * .84,
          cellSize * .84,
        );
      }
      const slab = horizontal
        ? {
          x: left + cellSize * .04,
          y: top + cellSize * .34,
          width: cellSize * .92,
          height: cellSize * .32,
        }
        : {
          x: left + cellSize * .34,
          y: top + cellSize * .05,
          width: cellSize * .32,
          height: cellSize * .9,
        };
      // Door jambs retain the thickness and material of the interrupted wall,
      // visually seating the leaf inside the opening.
      context.fillStyle = style.wallAlt;
      context.strokeStyle = style.wallHighlight;
      context.lineWidth = Math.max(.65, cellSize * .018);
      if (horizontal) {
        traceChamferedRect(
          left,
          top + cellSize * .25,
          cellSize * .11,
          cellSize * .5,
          cellSize * .035,
        );
        context.fill();
        traceChamferedRect(
          left + cellSize * .89,
          top + cellSize * .25,
          cellSize * .11,
          cellSize * .5,
          cellSize * .035,
        );
        context.fill();
        context.beginPath();
        context.moveTo(left + cellSize * .1, top + cellSize * .27);
        context.lineTo(left + cellSize * .1, top + cellSize * .73);
        context.moveTo(left + cellSize * .9, top + cellSize * .27);
        context.lineTo(left + cellSize * .9, top + cellSize * .73);
        context.stroke();
      } else {
        traceChamferedRect(
          left + cellSize * .25,
          top,
          cellSize * .5,
          cellSize * .11,
          cellSize * .035,
        );
        context.fill();
        traceChamferedRect(
          left + cellSize * .25,
          top + cellSize * .89,
          cellSize * .5,
          cellSize * .11,
          cellSize * .035,
        );
        context.fill();
        context.beginPath();
        context.moveTo(left + cellSize * .27, top + cellSize * .1);
        context.lineTo(left + cellSize * .73, top + cellSize * .1);
        context.moveTo(left + cellSize * .27, top + cellSize * .9);
        context.lineTo(left + cellSize * .73, top + cellSize * .9);
        context.stroke();
      }
      context.fillStyle = style.door;
      context.strokeStyle = style.doorEdge;
      context.lineWidth = Math.max(1.2, cellSize * .05);
      traceChamferedRect(
        slab.x,
        slab.y,
        slab.width,
        slab.height,
        cellSize * .035,
      );
      context.fill();
      context.stroke();
      context.strokeStyle = style.doorHighlight;
      context.lineWidth = Math.max(.8, cellSize * .02);
      if (horizontal) {
        context.beginPath();
        context.moveTo(slab.x + cellSize * .16, slab.y + slab.height * .5);
        context.lineTo(slab.x + slab.width - cellSize * .16, slab.y + slab.height * .5);
        context.stroke();
      } else {
        context.beginPath();
        context.moveTo(slab.x + slab.width * .5, slab.y + cellSize * .16);
        context.lineTo(slab.x + slab.width * .5, slab.y + slab.height - cellSize * .16);
        context.stroke();
      }
      context.fillStyle = style.hardware;
      context.beginPath();
      context.arc(
        horizontal ? slab.x + slab.width * .78 : slab.x + slab.width * .72,
        horizontal ? slab.y + slab.height * .65 : slab.y + slab.height * .76,
        Math.max(1.1, cellSize * .045),
        0,
        Math.PI * 2,
      );
      context.fill();
    }
  }
  context.restore();
}

type SailingShipDeckFacing = NonNullable<
  Grid[number][number]["deckFeatureFacing"]
>;

function sailingShipDeckFacingAngle(facing: SailingShipDeckFacing) {
  if (facing === "north") return -Math.PI / 2;
  if (facing === "south") return Math.PI / 2;
  if (facing === "west") return Math.PI;
  return 0;
}

function sailingShipDeckFloorElevation(grid: Grid, x: number, y: number) {
  const tile = grid[y]?.[x];
  if (!tile || !isSailingShipDeckFloor(grid, x, y)) return undefined;
  return tile.elevation ?? 1;
}

function drawSailingShipDeckElevation(
  grid: Grid,
  cellSize: number,
  context: CanvasRenderingContext2D,
) {
  context.save();
  context.lineCap = "butt";
  context.lineJoin = "round";
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      const elevation = sailingShipDeckFloorElevation(grid, x, y);
      if (elevation === undefined || elevation <= 1) continue;
      const left = x * cellSize;
      const top = y * cellSize;

      context.fillStyle = "rgba(246, 215, 162, .13)";
      context.fillRect(left, top, cellSize, cellSize);

      for (const edge of cardinalCellEdges) {
        const neighbourElevation = sailingShipDeckFloorElevation(
          grid,
          x + edge.dx,
          y + edge.dy,
        );
        if (
          neighbourElevation === undefined ||
          neighbourElevation >= elevation
        ) {
          continue;
        }

        const startX = left + edge.startX * cellSize;
        const startY = top + edge.startY * cellSize;
        const endX = left + edge.endX * cellSize;
        const endY = top + edge.endY * cellSize;
        const shadowOffset = cellSize * .075;
        context.strokeStyle = "rgba(35, 22, 16, .31)";
        context.lineWidth = Math.max(1.5, cellSize * .12);
        context.beginPath();
        context.moveTo(
          startX + edge.dx * shadowOffset,
          startY + edge.dy * shadowOffset,
        );
        context.lineTo(
          endX + edge.dx * shadowOffset,
          endY + edge.dy * shadowOffset,
        );
        context.stroke();

        context.strokeStyle = "rgba(67, 42, 28, .9)";
        context.lineWidth = Math.max(1.15, cellSize * .07);
        context.beginPath();
        context.moveTo(startX, startY);
        context.lineTo(endX, endY);
        context.stroke();

        const highlightOffset = cellSize * .055;
        context.strokeStyle = "rgba(250, 222, 173, .42)";
        context.lineWidth = Math.max(.75, cellSize * .027);
        context.beginPath();
        context.moveTo(
          startX - edge.dx * highlightOffset,
          startY - edge.dy * highlightOffset,
        );
        context.lineTo(
          endX - edge.dx * highlightOffset,
          endY - edge.dy * highlightOffset,
        );
        context.stroke();
      }
    }
  }
  context.restore();
}

function drawSailingShipMastRigging(
  grid: Grid,
  x: number,
  y: number,
  cellSize: number,
  context: CanvasRenderingContext2D,
) {
  const isHullMaterial = (cellY: number) => {
    const terrain = grid[cellY]?.[x]?.terrain;
    return terrain === Terrain.Ground ||
      terrain === Terrain.Wall ||
      terrain === Terrain.Door;
  };
  let top = y;
  let bottom = y;
  while (top > 0 && isHullMaterial(top - 1)) top -= 1;
  while (bottom < grid.length - 1 && isHullMaterial(bottom + 1)) bottom += 1;
  if (top === bottom) return;

  const centerX = (x + .5) * cellSize;
  const centerY = (y + .5) * cellSize;
  const maximumX = grid[0].length * cellSize - cellSize * .25;
  const clampX = (value: number) =>
    Math.max(cellSize * .25, Math.min(maximumX, value));
  const anchors = [
    {
      x: clampX(centerX - cellSize * .72),
      y: (top + .62) * cellSize,
    },
    {
      x: clampX(centerX + cellSize * .72),
      y: (top + .62) * cellSize,
    },
    {
      x: clampX(centerX - cellSize * .72),
      y: (bottom + .38) * cellSize,
    },
    {
      x: clampX(centerX + cellSize * .72),
      y: (bottom + .38) * cellSize,
    },
  ];

  context.save();
  context.strokeStyle = "rgba(48, 35, 27, .27)";
  context.lineWidth = Math.max(.65, cellSize * .024);
  context.setLineDash([
    Math.max(2, cellSize * .18),
    Math.max(1.5, cellSize * .12),
  ]);
  for (const anchor of anchors) {
    context.beginPath();
    context.moveTo(centerX, centerY);
    context.lineTo(anchor.x, anchor.y);
    context.stroke();
  }
  context.restore();
}

function drawSailingShipDeckFeatures(
  grid: Grid,
  cellSize: number,
  context: CanvasRenderingContext2D,
  tilesetProps?: TilesetPropImages,
) {
  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      const tile = grid[y][x];
      const feature = tile.deckFeature;
      if (!feature) continue;
      const facing = tile.deckFeatureFacing ?? "east";
      const centerX = (x + .5) * cellSize;
      const centerY = (y + .5) * cellSize;

      if (feature === "mast") {
        drawSailingShipMastRigging(grid, x, y, cellSize, context);
        context.save();
        context.translate(centerX, centerY);
        applyPropContactShadow(cellSize, context);
        context.fillStyle = "#3d2b21";
        context.beginPath();
        context.arc(0, 0, cellSize * .46, 0, Math.PI * 2);
        context.fill();
        context.restore();

        context.save();
        context.translate(centerX, centerY);
        context.fillStyle = "#8a5c38";
        context.strokeStyle = "#30221b";
        context.lineWidth = Math.max(1.5, cellSize * .075);
        context.beginPath();
        context.arc(0, 0, cellSize * .37, 0, Math.PI * 2);
        context.fill();
        context.stroke();
        context.strokeStyle = "rgba(230, 183, 119, .62)";
        context.lineWidth = Math.max(.75, cellSize * .03);
        context.beginPath();
        context.arc(
          -cellSize * .035,
          -cellSize * .035,
          cellSize * .245,
          Math.PI * 1.05,
          Math.PI * 1.7,
        );
        context.stroke();
        context.strokeStyle = "#b68a52";
        context.lineWidth = Math.max(1, cellSize * .045);
        context.beginPath();
        context.arc(0, 0, cellSize * .29, 0, Math.PI * 2);
        context.stroke();
        context.restore();
        continue;
      }

      const cannonImage = readyTilesetImage(feature === "cannon"
        ? facing === "north" ? tilesetProps?.cannonNorth
          : facing === "south" ? tilesetProps?.cannonSouth
            : undefined
        : undefined);
      if (cannonImage) {
        const drawTop = facing === "north" ? (y - 1) * cellSize : y * cellSize;
        context.save();
        context.imageSmoothingEnabled = false;
        context.drawImage(cannonImage, x * cellSize, drawTop, cellSize, cellSize * 2);
        context.restore();
        continue;
      }

      context.save();
      context.translate(centerX, centerY);
      context.rotate(sailingShipDeckFacingAngle(facing));

      if (feature === "hatch") {
        const width = cellSize * 1.16;
        const height = cellSize * .72;
        context.save();
        applyPropContactShadow(cellSize, context);
        context.fillStyle = "#34251e";
        context.fillRect(-width * .53, -height * .57, width * 1.06, height * 1.14);
        context.restore();
        context.fillStyle = "#765036";
        context.strokeStyle = "#30221b";
        context.lineWidth = Math.max(1.1, cellSize * .055);
        context.fillRect(-width / 2, -height / 2, width, height);
        context.strokeRect(-width / 2, -height / 2, width, height);
        context.fillStyle = "#392820";
        context.fillRect(-width * .39, -height * .31, width * .78, height * .62);
        context.strokeStyle = "#ad7b49";
        context.lineWidth = Math.max(.75, cellSize * .027);
        for (const offset of [-.26, -.087, .087, .26]) {
          context.beginPath();
          context.moveTo(width * offset, -height * .29);
          context.lineTo(width * offset, height * .29);
          context.stroke();
        }
        context.fillStyle = "#c19a62";
        for (const offset of [-.37, .37]) {
          context.beginPath();
          context.arc(width * offset, 0, Math.max(1, cellSize * .04), 0, Math.PI * 2);
          context.fill();
        }
      } else if (feature === "wheel") {
        context.fillStyle = "#4a3022";
        context.fillRect(-cellSize * .27, -cellSize * .37, cellSize * .12, cellSize * .74);
        context.fillRect(cellSize * .15, -cellSize * .37, cellSize * .12, cellSize * .74);
        context.save();
        applyPropContactShadow(cellSize, context);
        context.strokeStyle = "#33231b";
        context.lineWidth = Math.max(2, cellSize * .13);
        context.beginPath();
        context.arc(0, 0, cellSize * .34, 0, Math.PI * 2);
        context.stroke();
        context.restore();
        context.strokeStyle = "#a66e3d";
        context.lineWidth = Math.max(1.2, cellSize * .075);
        context.beginPath();
        context.arc(0, 0, cellSize * .34, 0, Math.PI * 2);
        context.stroke();
        context.strokeStyle = "#c79658";
        context.lineWidth = Math.max(.75, cellSize * .032);
        for (let spoke = 0; spoke < 8; spoke += 1) {
          const angle = spoke * Math.PI / 4;
          const innerRadius = cellSize * .075;
          const outerRadius = cellSize * .45;
          context.beginPath();
          context.moveTo(
            Math.cos(angle) * innerRadius,
            Math.sin(angle) * innerRadius,
          );
          context.lineTo(
            Math.cos(angle) * outerRadius,
            Math.sin(angle) * outerRadius,
          );
          context.stroke();
          context.fillStyle = "#d0a061";
          context.beginPath();
          context.arc(
            Math.cos(angle) * outerRadius,
            Math.sin(angle) * outerRadius,
            Math.max(.8, cellSize * .035),
            0,
            Math.PI * 2,
          );
          context.fill();
        }
        context.fillStyle = "#6c442b";
        context.strokeStyle = "#2f211b";
        context.lineWidth = Math.max(.75, cellSize * .03);
        context.beginPath();
        context.arc(0, 0, cellSize * .105, 0, Math.PI * 2);
        context.fill();
        context.stroke();
      } else if (feature === "capstan") {
        context.save();
        applyPropContactShadow(cellSize, context);
        context.fillStyle = "#3c2a20";
        context.beginPath();
        context.arc(0, 0, cellSize * .36, 0, Math.PI * 2);
        context.fill();
        context.restore();
        context.strokeStyle = "#b7844a";
        context.lineWidth = Math.max(1.1, cellSize * .06);
        for (let bar = 0; bar < 4; bar += 1) {
          const angle = bar * Math.PI / 4;
          context.beginPath();
          context.moveTo(
            -Math.cos(angle) * cellSize * .43,
            -Math.sin(angle) * cellSize * .43,
          );
          context.lineTo(
            Math.cos(angle) * cellSize * .43,
            Math.sin(angle) * cellSize * .43,
          );
          context.stroke();
        }
        context.fillStyle = "#765035";
        context.strokeStyle = "#30221b";
        context.lineWidth = Math.max(1, cellSize * .05);
        context.beginPath();
        context.arc(0, 0, cellSize * .25, 0, Math.PI * 2);
        context.fill();
        context.stroke();
        context.strokeStyle = "#d0a064";
        context.lineWidth = Math.max(.75, cellSize * .028);
        context.beginPath();
        context.arc(0, 0, cellSize * .17, 0, Math.PI * 2);
        context.stroke();
        context.fillStyle = "#3b2a21";
        context.beginPath();
        context.arc(0, 0, cellSize * .075, 0, Math.PI * 2);
        context.fill();
      } else if (feature === "cannon") {
        context.save();
        applyPropContactShadow(cellSize, context);
        context.fillStyle = "#69442d";
        context.fillRect(
          -cellSize * .5,
          -cellSize * .24,
          cellSize * .62,
          cellSize * .48,
        );
        context.restore();
        context.fillStyle = "#744a2f";
        context.strokeStyle = "#34231b";
        context.lineWidth = Math.max(.9, cellSize * .04);
        context.fillRect(
          -cellSize * .5,
          -cellSize * .22,
          cellSize * .62,
          cellSize * .44,
        );
        context.strokeRect(
          -cellSize * .5,
          -cellSize * .22,
          cellSize * .62,
          cellSize * .44,
        );
        context.fillStyle = "#302a27";
        for (const wheelX of [-.36, -.02]) {
          for (const wheelY of [-.29, .29]) {
            context.beginPath();
            context.arc(
              cellSize * wheelX,
              cellSize * wheelY,
              cellSize * .1,
              0,
              Math.PI * 2,
            );
            context.fill();
          }
        }
        context.fillStyle = "#353739";
        context.strokeStyle = "#181b1d";
        context.lineWidth = Math.max(.85, cellSize * .037);
        context.beginPath();
        context.moveTo(-cellSize * .43, -cellSize * .125);
        context.lineTo(cellSize * .68, -cellSize * .075);
        context.lineTo(cellSize * .79, -cellSize * .125);
        context.lineTo(cellSize * .79, cellSize * .125);
        context.lineTo(cellSize * .68, cellSize * .075);
        context.lineTo(-cellSize * .43, cellSize * .125);
        context.closePath();
        context.fill();
        context.stroke();
        context.strokeStyle = "rgba(214, 217, 210, .38)";
        context.lineWidth = Math.max(.65, cellSize * .02);
        context.beginPath();
        context.moveTo(-cellSize * .34, -cellSize * .055);
        context.lineTo(cellSize * .68, -cellSize * .035);
        context.stroke();
        context.fillStyle = "#252729";
        context.beginPath();
        context.arc(-cellSize * .49, 0, cellSize * .105, 0, Math.PI * 2);
        context.fill();
      } else if (feature === "stairs") {
        const gradient = context.createLinearGradient(
          -cellSize * .43,
          0,
          cellSize * .43,
          0,
        );
        gradient.addColorStop(0, "#5d3d2a");
        gradient.addColorStop(1, "#b27c48");
        context.save();
        applyPropContactShadow(cellSize, context);
        context.fillStyle = "#39271f";
        context.fillRect(
          -cellSize * .46,
          -cellSize * .4,
          cellSize * .92,
          cellSize * .8,
        );
        context.restore();
        context.fillStyle = gradient;
        context.strokeStyle = "#3b281f";
        context.lineWidth = Math.max(1, cellSize * .045);
        context.fillRect(
          -cellSize * .43,
          -cellSize * .36,
          cellSize * .86,
          cellSize * .72,
        );
        context.strokeRect(
          -cellSize * .43,
          -cellSize * .36,
          cellSize * .86,
          cellSize * .72,
        );
        context.strokeStyle = "rgba(242, 201, 136, .58)";
        context.lineWidth = Math.max(.7, cellSize * .025);
        for (const offset of [-.3, -.15, 0, .15, .3]) {
          context.beginPath();
          context.moveTo(cellSize * offset, -cellSize * .34);
          context.lineTo(cellSize * offset, cellSize * .34);
          context.stroke();
        }
        context.strokeStyle = "#513421";
        context.lineWidth = Math.max(1, cellSize * .055);
        for (const side of [-.37, .37]) {
          context.beginPath();
          context.moveTo(-cellSize * .45, cellSize * side);
          context.lineTo(cellSize * .45, cellSize * side);
          context.stroke();
        }
      } else if (feature === "railing") {
        const railX = -cellSize * .38;
        context.save();
        applyPropContactShadow(cellSize, context);
        context.strokeStyle = "#33231c";
        context.lineWidth = Math.max(1.7, cellSize * .12);
        context.beginPath();
        context.moveTo(railX, -cellSize * .52);
        context.lineTo(railX, cellSize * .52);
        context.stroke();
        context.restore();
        context.strokeStyle = "#8c5a34";
        context.lineWidth = Math.max(1.2, cellSize * .075);
        context.beginPath();
        context.moveTo(railX, -cellSize * .52);
        context.lineTo(railX, cellSize * .52);
        context.stroke();
        context.strokeStyle = "rgba(231, 181, 112, .55)";
        context.lineWidth = Math.max(.65, cellSize * .022);
        context.beginPath();
        context.moveTo(railX - cellSize * .04, -cellSize * .5);
        context.lineTo(railX - cellSize * .04, cellSize * .5);
        context.stroke();
        context.fillStyle = "#5e3c28";
        context.strokeStyle = "#2e211a";
        context.lineWidth = Math.max(.65, cellSize * .025);
        for (const offset of [-.43, 0, .43]) {
          context.beginPath();
          context.arc(
            railX,
            cellSize * offset,
            cellSize * .08,
            0,
            Math.PI * 2,
          );
          context.fill();
          context.stroke();
        }
      } else if (feature === "gangway") {
        const start = -cellSize * .65;
        const width = cellSize * 1.9;
        const halfHeight = cellSize * .3;
        context.save();
        applyPropContactShadow(cellSize, context);
        context.fillStyle = "#3b2920";
        context.fillRect(
          start,
          -halfHeight,
          width,
          halfHeight * 2,
        );
        context.restore();
        context.fillStyle = "#8d603a";
        context.strokeStyle = "#35241c";
        context.lineWidth = Math.max(1, cellSize * .045);
        context.fillRect(start, -halfHeight, width, halfHeight * 2);
        context.strokeRect(start, -halfHeight, width, halfHeight * 2);
        context.strokeStyle = "rgba(236, 195, 126, .5)";
        context.lineWidth = Math.max(.65, cellSize * .023);
        for (const offset of [-.5, -.25, 0, .25, .5, .75, 1, 1.2]) {
          context.beginPath();
          context.moveTo(cellSize * offset, -halfHeight * .92);
          context.lineTo(cellSize * offset, halfHeight * .92);
          context.stroke();
        }
        context.strokeStyle = "#4b3021";
        context.lineWidth = Math.max(.9, cellSize * .04);
        for (const side of [-1, 1]) {
          context.beginPath();
          context.moveTo(start, side * halfHeight * .84);
          context.lineTo(start + width, side * halfHeight * .84);
          context.stroke();
        }
      }
      context.restore();
    }
  }
  context.restore();
}

function drawInteriorProps(
  grid: Grid,
  cellSize: number,
  mode: LandscapeMode,
  context: CanvasRenderingContext2D,
  tilesetProps?: TilesetPropImages,
) {
  context.save();
  context.lineJoin = "round";
  const spaceshipFurniture = mode === "spaceship";
  const renderedProps = new Set<number>();
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      const {
        interiorProp: prop,
        interiorPropId,
        propVariant,
        propOrientation,
        propFacing,
        roomRole: propRoomRole = "",
      } = grid[y][x];
      if (!prop) continue;
      if (interiorPropId !== undefined && renderedProps.has(interiorPropId)) continue;
      if (interiorPropId !== undefined) renderedProps.add(interiorPropId);
      const propCells = interiorPropId === undefined
        ? [{ x, y }]
        : grid.flatMap((row, cellY) => row.map((tile, cellX) =>
          tile.interiorPropId === interiorPropId ? { x: cellX, y: cellY } : undefined))
          .filter((point): point is { x: number; y: number } => Boolean(point));
      const propLeft = Math.min(...propCells.map((point) => point.x)) * cellSize;
      const propRight = (Math.max(...propCells.map((point) => point.x)) + 1) * cellSize;
      const propTop = Math.min(...propCells.map((point) => point.y)) * cellSize;
      const propBottom = (Math.max(...propCells.map((point) => point.y)) + 1) * cellSize;
      const centerX = (propLeft + propRight) / 2;
      const centerY = (propTop + propBottom) / 2;
      const spanWidth = propRight - propLeft;
      const spanHeight = propBottom - propTop;
      const vertical = propOrientation === "vertical";
      const syntheticSeat = spaceshipFurniture &&
        (prop === "table" || prop === "chair");
      const variantIndex = propVariant ?? Math.abs(interiorPropId ?? x * 31 + y * 17);
      const modularHorizontalTable = prop === "table" && propCells.length > 1 &&
        spanHeight === cellSize;
      const modularVerticalTable = prop === "table" && propCells.length > 1 &&
        spanWidth === cellSize;
      const counterImage = readyTilesetImage(prop === "bar" && tilesetProps
        ? (vertical ? tilesetProps.counterVerticalByLength
          : tilesetProps.counterHorizontalByLength)[propCells.length]
        : undefined);
      if (counterImage) {
        context.save();
        context.imageSmoothingEnabled = false;
        context.drawImage(counterImage, propLeft,
          vertical ? propTop : propBottom - cellSize * 2,
          spanWidth, vertical ? spanHeight : cellSize * 2);
        context.restore();
        continue;
      }
      const horizontalTableImage = readyTilesetImage(modularHorizontalTable
        ? tilesetProps?.tableHorizontalByLength[propCells.length]
        : undefined);
      if (horizontalTableImage) {
        context.save();
        context.imageSmoothingEnabled = false;
        context.drawImage(horizontalTableImage, propLeft, propBottom - cellSize * 2,
          spanWidth, cellSize * 2);
        context.restore();
        continue;
      }
      const verticalTableImage = readyTilesetImage(modularVerticalTable
        ? tilesetProps?.tableVerticalByLength[propCells.length]
        : undefined);
      if (verticalTableImage) {
        context.save();
        context.imageSmoothingEnabled = false;
        context.drawImage(verticalTableImage, propLeft, propTop, spanWidth, spanHeight);
        context.restore();
        continue;
      }
      const tableAssetName = prop === "table"
        ? propCells.length === 1 ? "table_1x1.png"
          : propCells.length === 4 && spanWidth === cellSize * 2 && spanHeight === cellSize * 2
            ? "table_2x2.png" : undefined
        : undefined;
      const tableImage = readyTilesetImage(prop === "table"
        ? propCells.length === 1 ? tilesetProps?.table1x1
          : propCells.length === 4 && spanWidth === cellSize * 2 && spanHeight === cellSize * 2
            ? tilesetProps?.table2x2 : undefined
        : undefined);
      if (tableImage) {
        const source = imageSourceSize(tableImage)!;
        const scale = cellSize / 32;
        const layout = interiorAssetSpriteLayout(tableAssetName ?? "");
        const drawWidth = source.width * scale;
        const drawHeight = source.height * scale;
        const drawTop = layout.anchor === "bottom"
          ? propBottom - drawHeight
          : centerY - drawHeight / 2;
        context.save();
        context.imageSmoothingEnabled = Math.abs(scale - Math.round(scale)) > .001;
        context.imageSmoothingQuality = "high";
        context.drawImage(tableImage, centerX - drawWidth / 2,
          drawTop, drawWidth, drawHeight);
        context.restore();
        continue;
      }
      const altarImage = readyTilesetImage(prop === "altar" &&
        (propCells.length === 2 || propCells.length === 3)
        ? propCells.length === 3
          ? vertical ? tilesetProps?.altarVertical1x3 : tilesetProps?.altar3x1
          : vertical ? tilesetProps?.altarVertical1x2 : tilesetProps?.altar2x1
        : undefined);
      if (altarImage) {
        const source = imageSourceSize(altarImage);
        if (source) {
          const scale = cellSize / 32;
          const altarAssetName = vertical
            ? `altar_vertical_1x${propCells.length}.png`
            : `altar_${propCells.length}x1.png`;
          const layout = interiorAssetSpriteLayout(altarAssetName);
          const drawHeight = source.height * scale;
          const drawTop = layout.anchor === "bottom"
            ? propBottom - drawHeight
            : centerY - drawHeight / 2;
          context.save();
          context.imageSmoothingEnabled = Math.abs(scale - Math.round(scale)) > .001;
          context.imageSmoothingQuality = "high";
          context.drawImage(altarImage, centerX - source.width * scale / 2,
            drawTop, source.width * scale, drawHeight);
          context.restore();
          continue;
        }
      }
      const upholsteredBench = /Living room|Common room|Bedroom|Guest room|cabin/i.test(propRoomRole);
      const casualSofaImages = upholsteredBench
        ? tilesetProps?.casualSofas[propFacing ?? "north"]
        : undefined;
      const casualSofaImage = readyTilesetImage(casualSofaImages?.length
        ? casualSofaImages[variantIndex % casualSofaImages.length]
        : undefined);
      if (prop === "bench" && casualSofaImage) {
        context.save();
        context.imageSmoothingEnabled = false;
        context.drawImage(casualSofaImage, propLeft, propTop, spanWidth, spanHeight);
        context.restore();
        continue;
      }
      const horizontalBenchImage = readyTilesetImage(
        prop === "bench" && !upholsteredBench && !vertical
        ? tilesetProps?.benchHorizontalByLength[propCells.length]
        : undefined);
      if (horizontalBenchImage) {
        context.save();
        context.imageSmoothingEnabled = false;
        context.drawImage(horizontalBenchImage, propLeft, propTop, spanWidth, spanHeight);
        context.restore();
        continue;
      }
      const verticalBenchImage = readyTilesetImage(
        prop === "bench" && !upholsteredBench && vertical
        ? tilesetProps?.benchVerticalByLength[propCells.length]
        : undefined);
      if (verticalBenchImage) {
        context.save();
        context.imageSmoothingEnabled = false;
        context.drawImage(verticalBenchImage, propLeft, propTop, spanWidth, spanHeight);
        context.restore();
        continue;
      }
      const wallPropImage = readyTilesetImage(prop === "cabinet" &&
        (propCells.length === 2 || propCells.length === 3)
        ? propCells.length === 3
          ? vertical ? tilesetProps?.cabinetVertical1x3 : undefined
          : vertical ? tilesetProps?.cabinetVertical1x2
            : propFacing === "south"
              ? tilesetProps?.cabinet2x1South : tilesetProps?.cabinet2x1North
        : prop === "tomb" && propCells.length === 2
          ? vertical ? tilesetProps?.coffin1x2 : tilesetProps?.coffin2x1
          : undefined);
      if (wallPropImage) {
        const source = imageSourceSize(wallPropImage);
        if (source) {
          const scale = cellSize / 32;
          context.save();
          context.imageSmoothingEnabled = Math.abs(scale - Math.round(scale)) > .001;
          context.imageSmoothingQuality = "high";
          const imageTop = prop === "cabinet"
            ? propBottom - source.height * scale
            : centerY - source.height * scale / 2;
          context.drawImage(wallPropImage, centerX - source.width * scale / 2,
            imageTop, source.width * scale, source.height * scale);
          context.restore();
          continue;
        }
      }
      const hearthImage = readyTilesetImage(prop === "hearth" &&
        (propCells.length === 2 || propCells.length === 3)
        ? propCells.length === 3
          ? vertical ? tilesetProps?.hearth1x3 : tilesetProps?.hearth3x1
          : vertical ? tilesetProps?.hearth1x2 : tilesetProps?.hearth2x1
        : undefined);
      if (hearthImage) {
        const source = imageSourceSize(hearthImage);
        if (source) {
          const scale = cellSize / 32;
          context.save();
          context.imageSmoothingEnabled = Math.abs(scale - Math.round(scale)) > .001;
          context.imageSmoothingQuality = "high";
          context.drawImage(hearthImage, centerX - source.width * scale / 2,
            centerY - source.height * scale / 2, source.width * scale, source.height * scale);
          context.restore();
          continue;
        }
      }
      const allBedAssets = bedAssetDefinitions(
        propCells.length === 4,
        propFacing ?? "north",
      );
      const blueBedAssets = spaceshipFurniture
        ? blueBedAssetDefinitions(propCells.length === 4, propFacing ?? "north")
        : [];
      const selectedBedAsset = prop !== "bed"
        ? undefined
        : propVariant !== undefined
          ? allBedAssets[propVariant % allBedAssets.length]
          : spaceshipFurniture
            ? blueBedAssets[variantIndex % blueBedAssets.length]
            : selectBedAssetDefinition(
              propCells.length === 4,
              propFacing ?? "north",
              variantIndex,
              propRoomRole,
            );
      const bedIndex = selectedBedAsset
        ? allBedAssets.findIndex(({ folder, name }) =>
          folder === selectedBedAsset.folder && name === selectedBedAsset.name)
        : -1;
      const bedImages = prop === "bed"
        ? (propCells.length === 4 ? tilesetProps?.bedDoubles : tilesetProps?.bedSingles)
        ?.[propFacing ?? "north"]
        : undefined;
      const bedImage = readyTilesetImage(bedImages?.[bedIndex]);
      if (bedImage) {
        const source = imageSourceSize(bedImage)!;
        const bedAsset = allBedAssets[bedIndex];
        const scale = cellSize / 32;
        context.save();
        context.imageSmoothingEnabled = Math.abs(scale - Math.round(scale)) > .001;
        context.imageSmoothingQuality = "high";
        context.drawImage(bedImage, centerX - (bedAsset?.anchorX ?? source.width / 2) * scale,
          centerY - (bedAsset?.anchorY ?? source.height / 2) * scale,
          source.width * scale, source.height * scale);
        context.restore();
        continue;
      }
      const tileAssetName = prop === "chair" ? "stool_1x1.png"
        : prop === "crate" ? "crate_1x1.png"
          : prop === "barrel" ? "barrel_1x1.png"
            : prop === "bucket" ? "bucket_1x1.png"
              : prop === "drawers" ? `drawer_${variantIndex % 3 + 1}_1x1.png`
                : prop === "shelf" ? `shelf_${variantIndex % 7 + 1}_1x1.png`
                  : prop === "statue" ? `statue_${variantIndex % 7 + 1}_1x1.png`
                    : prop === "flower_pot" ? `flower_pot_${variantIndex % 3 + 1}_1x1.png`
                      : prop === "bones" ? `bones_${variantIndex % 5 + 1}_1x1.png`
                        : prop === "wall_chain" ? `wall_chain_${variantIndex % 2 + 1}_1x2.png`
                          : prop === "torch" && propFacing !== "north"
                            ? `torch_${propFacing ?? "south"}.png`
                          : undefined;
      const tileImage = readyTilesetImage(prop === "chair" ? tilesetProps?.stool1x1
        : prop === "crate" && tilesetProps?.crate1x1.length
          ? tilesetProps?.crate1x1[variantIndex % tilesetProps.crate1x1.length]
          : prop === "barrel" ? tilesetProps?.barrel1x1
            : prop === "bucket" && tilesetProps?.bucket1x1.length
              ? tilesetProps.bucket1x1[variantIndex % tilesetProps.bucket1x1.length]
              : prop === "drawers" && tilesetProps?.drawers1x1.length
                ? tilesetProps.drawers1x1[variantIndex % tilesetProps.drawers1x1.length]
                : prop === "shelf" && tilesetProps?.shelves1x1.length
                  ? tilesetProps.shelves1x1[variantIndex % tilesetProps.shelves1x1.length]
                  : prop === "statue" && tilesetProps?.statue1x1.length
                    ? tilesetProps.statue1x1[variantIndex % tilesetProps.statue1x1.length]
                    : prop === "flower_pot" && tilesetProps?.flowerPots1x1.length
                      ? tilesetProps.flowerPots1x1[variantIndex % tilesetProps.flowerPots1x1.length]
                      : prop === "bones" && tilesetProps?.bones1x1.length
                        ? tilesetProps.bones1x1[variantIndex % tilesetProps.bones1x1.length]
                        : prop === "wall_chain" && tilesetProps?.wallChains1x2.length
                          ? tilesetProps.wallChains1x2[variantIndex % tilesetProps.wallChains1x2.length]
                          : prop === "torch" && propFacing !== "north"
                            ? tilesetProps?.torches[propFacing ?? "south"]
                          : undefined);
      if (tileImage) {
        const layout = interiorAssetSpriteLayout(tileAssetName ?? "");
        const source = imageSourceSize(tileImage);
        const scale = source
          ? Math.min(
            cellSize * layout.renderWidthCells / source.width,
            cellSize * layout.renderHeightCells / source.height,
          )
          : 1;
        const drawWidth = source ? source.width * scale : cellSize * layout.renderWidthCells;
        const drawHeight = source ? source.height * scale : cellSize * layout.renderHeightCells;
        context.save();
        context.imageSmoothingEnabled = Math.abs(scale - Math.round(scale)) > .001;
        context.imageSmoothingQuality = "high";
        if (prop === "wall_chain") {
          const drawTop = layout.anchor === "bottom"
            ? propBottom - drawHeight
            : centerY - drawHeight / 2;
          context.drawImage(tileImage, centerX - drawWidth / 2,
            drawTop, drawWidth, drawHeight);
        } else {
          for (const cell of propCells) {
            const drawTop = layout.anchor === "bottom"
              ? (cell.y + 1) * cellSize - drawHeight
              : (cell.y + .5) * cellSize - drawHeight / 2;
            context.drawImage(tileImage, (cell.x + .5) * cellSize - drawWidth / 2,
              drawTop, drawWidth, drawHeight);
          }
        }
        context.restore();
        continue;
      }
      context.fillStyle = syntheticSeat
        ? "#596b70"
        : prop === "bar"
          ? "#69432c"
          : "#795137";
      context.strokeStyle = syntheticSeat ? "#23363d" : "#39281f";
      context.lineWidth = Math.max(1, cellSize * .045);
      if (prop === "table") {
        const square = propCells.length === 1;
        const width = square ? cellSize * .68 : spanWidth * (vertical ? .58 : .9);
        const height = square ? cellSize * .68 : spanHeight * (vertical ? .9 : .58);
        context.beginPath();
        context.roundRect(centerX - width / 2, centerY - height / 2,
          width, height, cellSize * .08);
        context.fill();
        context.stroke();
        context.strokeStyle = spaceshipFurniture
          ? "rgba(158, 209, 216, .42)"
          : "rgba(236,190,126,.34)";
        context.beginPath();
        if (vertical) {
          context.moveTo(centerX, centerY - height * .32);
          context.lineTo(centerX, centerY + height * .32);
        } else {
          context.moveTo(centerX - width * .32, centerY);
          context.lineTo(centerX + width * .32, centerY);
        }
        context.stroke();
      } else if (prop === "chair") {
        const size = cellSize * .43;
        context.fillRect(centerX - size / 2, centerY - size / 2, size, size);
        context.strokeRect(centerX - size / 2, centerY - size / 2, size, size);
        context.lineWidth = Math.max(1.2, cellSize * .065);
        context.beginPath();
        if (propFacing === "north") {
          context.moveTo(centerX - size / 2, centerY - size * .62);
          context.lineTo(centerX + size / 2, centerY - size * .62);
        } else if (propFacing === "south") {
          context.moveTo(centerX - size / 2, centerY + size * .62);
          context.lineTo(centerX + size / 2, centerY + size * .62);
        } else if (propFacing === "east") {
          context.moveTo(centerX - size * .62, centerY - size / 2);
          context.lineTo(centerX - size * .62, centerY + size / 2);
        } else {
          context.moveTo(centerX + size * .62, centerY - size / 2);
          context.lineTo(centerX + size * .62, centerY + size / 2);
        }
        context.stroke();
      } else if (prop === "bed") {
        const width = spanWidth * (vertical ? .72 : .94);
        const height = spanHeight * (vertical ? .94 : .72);
        const escapePod = spaceshipFurniture && /Escape pods/i.test(propRoomRole);
        if (escapePod) {
          const left = centerX - width / 2;
          const top = centerY - height / 2;
          const inset = Math.max(1.8, cellSize * .09);
          const capsuleRadius = Math.min(width, height) * .38;
          context.fillStyle = "#263b42";
          context.strokeStyle = "#14272e";
          context.lineWidth = Math.max(1.2, cellSize * .055);
          context.beginPath();
          context.roundRect(left, top, width, height, capsuleRadius);
          context.fill();
          context.stroke();

          context.fillStyle = "#607980";
          context.strokeStyle = "rgba(179, 218, 222, .48)";
          context.lineWidth = Math.max(.75, cellSize * .025);
          context.beginPath();
          context.roundRect(
            left + inset,
            top + inset,
            width - inset * 2,
            height - inset * 2,
            Math.max(cellSize * .1, capsuleRadius - inset),
          );
          context.fill();
          context.stroke();

          const viewportWidth = vertical
            ? width * .5
            : Math.min(width * .2, cellSize * .32);
          const viewportHeight = vertical
            ? Math.min(height * .2, cellSize * .32)
            : height * .5;
          const viewportX = vertical
            ? centerX
            : propFacing === "east"
              ? left + width * .72
              : left + width * .28;
          const viewportY = vertical
            ? propFacing === "south"
              ? top + height * .72
              : top + height * .28
            : centerY;
          context.fillStyle = "#20363e";
          context.strokeStyle = "#8bb9bf";
          context.lineWidth = Math.max(.65, cellSize * .02);
          context.beginPath();
          context.roundRect(
            viewportX - viewportWidth / 2,
            viewportY - viewportHeight / 2,
            viewportWidth,
            viewportHeight,
            Math.min(viewportWidth, viewportHeight) * .4,
          );
          context.fill();
          context.stroke();

          context.strokeStyle = "rgba(25, 45, 52, .74)";
          context.lineWidth = Math.max(.7, cellSize * .026);
          context.beginPath();
          if (vertical) {
            context.moveTo(left + width * .16, centerY);
            context.lineTo(left + width * .84, centerY);
          } else {
            context.moveTo(centerX, top + height * .16);
            context.lineTo(centerX, top + height * .84);
          }
          context.stroke();

          const indicatorX = vertical
            ? left + width * .78
            : propFacing === "east"
              ? left + width * .22
              : left + width * .78;
          const indicatorY = vertical
            ? propFacing === "south"
              ? top + height * .22
              : top + height * .78
            : top + height * .22;
          context.fillStyle = "#d58b42";
          context.beginPath();
          context.arc(
            indicatorX,
            indicatorY,
            Math.max(.9, cellSize * .04),
            0,
            Math.PI * 2,
          );
          context.fill();
        } else if (spaceshipFurniture) {
          const inset = Math.max(1.5, cellSize * .075);
          context.fillStyle = "#34474e";
          context.strokeStyle = "#1d3037";
          context.fillRect(
            centerX - width / 2,
            centerY - height / 2,
            width,
            height,
          );
          context.strokeRect(
            centerX - width / 2,
            centerY - height / 2,
            width,
            height,
          );
          context.fillStyle = "#82969a";
          context.strokeStyle = "rgba(190, 222, 225, .36)";
          context.beginPath();
          context.roundRect(
            centerX - width / 2 + inset,
            centerY - height / 2 + inset,
            width - inset * 2,
            height - inset * 2,
            cellSize * .045,
          );
          context.fill();
          context.stroke();
          context.fillStyle = "#c1cdcc";
        } else {
          context.fillStyle = "#8d795f";
          context.fillRect(
            centerX - width / 2,
            centerY - height / 2,
            width,
            height,
          );
          context.strokeRect(
            centerX - width / 2,
            centerY - height / 2,
            width,
            height,
          );
          context.fillStyle = "#d2c5a8";
        }
        if (!escapePod) {
          if (vertical) {
            const pillowY = propFacing === "south"
              ? centerY + height * .14
              : centerY - height * .38;
            context.fillRect(
              centerX - width * .38,
              pillowY,
              width * .76,
              height * .24,
            );
          } else {
            const pillowX = propFacing === "east"
              ? centerX + width * .14
              : centerX - width * .38;
            context.fillRect(
              pillowX,
              centerY - height * .38,
              width * .24,
              height * .76,
            );
          }
        }
      } else if (prop === "bench") {
        const spaceshipBench = spaceshipFurniture;
        const upholstered = spaceshipBench ||
          /Living room|Bedroom|Guest room|cabin|Royal chamber/i.test(propRoomRole);
        const furnitureDepth = spaceshipBench ? .58 : upholstered ? .7 : .38;
        const width = spanWidth * (vertical ? furnitureDepth : .94);
        const height = spanHeight * (vertical ? .94 : furnitureDepth);
        const left = centerX - width / 2;
        const top = centerY - height / 2;
        const wood = spaceshipBench
          ? "#40555c"
          : upholstered ? "#7b5032" : "#735037";
        const woodLight = spaceshipBench
          ? "#71868b"
          : upholstered ? "#b37a4c" : "#a7794e";
        const woodEdge = spaceshipBench ? "#1c3037" : "#38251b";
        const textile = spaceshipBench ? "#5d7c83" : "#a96049";
        const textileLight = spaceshipBench ? "#a4c5c8" : "#e3a27a";
        const textileEdge = spaceshipBench ? "#294751" : "#673b31";
        const cornerRadius = Math.min(cellSize * .1, width * .18, height * .18);

        context.fillStyle = wood;
        context.strokeStyle = woodEdge;
        context.lineWidth = Math.max(1, cellSize * .045);
        context.beginPath();
        context.roundRect(left, top, width, height, cornerRadius);
        context.fill();
        context.stroke();

        const seatInset = Math.max(1.2, cellSize * .075);
        const seatLeft = left + seatInset;
        const seatTop = top + seatInset;
        const seatWidth = Math.max(1, width - seatInset * 2);
        const seatHeight = Math.max(1, height - seatInset * 2);
        context.fillStyle = upholstered ? textile : woodLight;
        context.strokeStyle = upholstered ? textileEdge : woodEdge;
        context.lineWidth = Math.max(.7, cellSize * .024);
        context.beginPath();
        context.roundRect(
          seatLeft,
          seatTop,
          seatWidth,
          seatHeight,
          Math.min(cellSize * .07, cornerRadius),
        );
        context.fill();
        context.stroke();

        if (upholstered) {
          context.strokeStyle = spaceshipBench
            ? "rgba(31, 59, 67, .46)"
            : "rgba(112, 72, 43, .34)";
          context.lineWidth = Math.max(.65, cellSize * .018);
          context.beginPath();
          const orderedCells = [...propCells].sort((first, second) =>
            vertical ? first.y - second.y : first.x - second.x
          );
          for (let index = 0; index < orderedCells.length - 1; index += 1) {
            if (vertical) {
              const seamY = (orderedCells[index].y + 1) * cellSize;
              context.moveTo(seatLeft + seatWidth * .12, seamY);
              context.lineTo(seatLeft + seatWidth * .88, seamY);
            } else {
              const seamX = (orderedCells[index].x + 1) * cellSize;
              context.moveTo(seamX, seatTop + seatHeight * .12);
              context.lineTo(seamX, seatTop + seatHeight * .88);
            }
          }
          context.stroke();

          context.strokeStyle = spaceshipBench
            ? "rgba(189, 225, 228, .46)"
            : "rgba(255, 218, 183, .5)";
          context.beginPath();
          if (vertical) {
            context.moveTo(seatLeft + seatWidth * .22, seatTop + seatHeight * .08);
            context.lineTo(seatLeft + seatWidth * .22, seatTop + seatHeight * .92);
          } else {
            context.moveTo(seatLeft + seatWidth * .08, seatTop + seatHeight * .22);
            context.lineTo(seatLeft + seatWidth * .92, seatTop + seatHeight * .22);
          }
          context.stroke();
        }

        const backThickness = Math.max(
          cellSize * .1,
          Math.min(vertical ? width : height, cellSize * .18) * .58,
        );
        const back = propFacing === "north"
          ? {
            x: left + cellSize * .025,
            y: top + height - backThickness,
            width: width - cellSize * .05,
            height: backThickness,
          }
          : propFacing === "south"
            ? {
              x: left + cellSize * .025,
              y: top,
              width: width - cellSize * .05,
              height: backThickness,
            }
            : propFacing === "east"
              ? {
                x: left,
                y: top + cellSize * .025,
                width: backThickness,
                height: height - cellSize * .05,
              }
              : {
                x: left + width - backThickness,
                y: top + cellSize * .025,
                width: backThickness,
                height: height - cellSize * .05,
              };
        context.fillStyle = wood;
        context.strokeStyle = woodEdge;
        context.lineWidth = Math.max(1, cellSize * .04);
        context.beginPath();
        context.roundRect(
          back.x,
          back.y,
          back.width,
          back.height,
          Math.min(cellSize * .055, backThickness * .35),
        );
        context.fill();
        context.stroke();

        if (upholstered) {
          const backInset = Math.max(.8, cellSize * .035);
          context.fillStyle = spaceshipBench ? "#4f7078" : "#914d3d";
          context.strokeStyle = textileLight;
          context.lineWidth = Math.max(.55, cellSize * .016);
          context.beginPath();
          context.roundRect(
            back.x + backInset,
            back.y + backInset,
            Math.max(1, back.width - backInset * 2),
            Math.max(1, back.height - backInset * 2),
            Math.min(cellSize * .035, backThickness * .22),
          );
          context.fill();
          context.stroke();
        }

        context.fillStyle = wood;
        context.strokeStyle = woodEdge;
        context.lineWidth = Math.max(.7, cellSize * .023);
        const armThickness = Math.max(1.5, cellSize * .105);
        const armInset = Math.max(.8, cellSize * .035);
        const arms = vertical
          ? [
            {
              x: left + armInset,
              y: top + armInset,
              width: width - armInset * 2,
              height: armThickness,
            },
            {
              x: left + armInset,
              y: top + height - armThickness - armInset,
              width: width - armInset * 2,
              height: armThickness,
            },
          ]
          : [
            {
              x: left + armInset,
              y: top + armInset,
              width: armThickness,
              height: height - armInset * 2,
            },
            {
              x: left + width - armThickness - armInset,
              y: top + armInset,
              width: armThickness,
              height: height - armInset * 2,
            },
          ];
        for (const arm of arms) {
          context.beginPath();
          context.roundRect(
            arm.x,
            arm.y,
            arm.width,
            arm.height,
            Math.min(cellSize * .035, armThickness * .28),
          );
          context.fill();
          context.stroke();
        }
      } else if (prop === "hearth") {
        const width = spanWidth * (vertical ? .68 : .94);
        const height = spanHeight * (vertical ? .94 : .68);
        context.fillStyle = "#827768";
        context.strokeStyle = "#403a35";
        context.beginPath();
        context.roundRect(centerX - width / 2, centerY - height / 2,
          width, height, cellSize * .08);
        context.fill();
        context.stroke();
        const fireWidth = width * (vertical ? .5 : .68);
        const fireHeight = height * (vertical ? .68 : .5);
        context.fillStyle = "#322923";
        context.beginPath();
        context.roundRect(centerX - fireWidth / 2, centerY - fireHeight / 2,
          fireWidth, fireHeight, cellSize * .06);
        context.fill();
        context.fillStyle = "#d77934";
        context.beginPath();
        context.ellipse(centerX, centerY, fireWidth * .27, fireHeight * .28,
          0, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = "#efb653";
        context.beginPath();
        context.ellipse(centerX, centerY, fireWidth * .12, fireHeight * .19,
          0, 0, Math.PI * 2);
        context.fill();
        context.strokeStyle = "rgba(224,213,190,.35)";
        context.lineWidth = Math.max(.7, cellSize * .025);
        const divisions = Math.max(2, propCells.length * 2);
        for (let division = 1; division < divisions; division += 1) {
          context.beginPath();
          if (vertical) {
            const lineY = centerY - height / 2 + height * division / divisions;
            context.moveTo(centerX - width / 2, lineY);
            context.lineTo(centerX - fireWidth / 2, lineY);
          } else {
            const lineX = centerX - width / 2 + width * division / divisions;
            context.moveTo(lineX, centerY - height / 2);
            context.lineTo(lineX, centerY - fireHeight / 2);
          }
          context.stroke();
        }
      } else if (prop === "altar" || prop === "tomb") {
        const width = spanWidth * (vertical ? .68 : .92);
        const height = spanHeight * (vertical ? .92 : .68);
        context.fillStyle = prop === "altar" ? "#a59a81" : "#696d68";
        context.beginPath();
        context.roundRect(centerX - width / 2, centerY - height / 2,
          width, height, prop === "tomb" ? cellSize * .2 : cellSize * .04);
        context.fill();
        context.stroke();
        context.strokeStyle = prop === "altar" ? "#d4c7a1" : "#92978f";
        context.beginPath();
        if (vertical) {
          context.moveTo(centerX, centerY - height * .22);
          context.lineTo(centerX, centerY + height * .22);
        } else {
          context.moveTo(centerX - width * .22, centerY);
          context.lineTo(centerX + width * .22, centerY);
        }
        if (prop === "tomb") {
          if (vertical) {
            context.moveTo(centerX - width * .22, centerY);
            context.lineTo(centerX + width * .22, centerY);
          } else {
            context.moveTo(centerX, centerY - height * .22);
            context.lineTo(centerX, centerY + height * .22);
          }
        }
        context.stroke();
      } else if (prop === "cabinet") {
        const width = spanWidth * (vertical ? .52 : .92);
        const height = spanHeight * (vertical ? .92 : .52);
        const kitchenStorage = /Kitchen|Galley/i.test(propRoomRole);
        context.fillStyle = spaceshipFurniture
          ? "#4d6066"
          : kitchenStorage
            ? "#74543b"
            : "#6b4a35";
        context.strokeStyle = spaceshipFurniture ? "#203239" : "#39281f";
        context.fillRect(centerX - width / 2, centerY - height / 2, width, height);
        context.strokeRect(centerX - width / 2, centerY - height / 2, width, height);
        context.fillStyle = spaceshipFurniture
          ? "#74878b"
          : kitchenStorage
            ? "#aa845b"
            : "#8c6849";
        if (vertical) {
          context.fillRect(centerX - width * .47, centerY - height * .46,
            width * .16, height * .92);
        } else {
          context.fillRect(centerX - width * .46, centerY - height * .47,
            width * .92, height * .16);
        }
        context.strokeStyle = spaceshipFurniture
          ? "rgba(175, 213, 216, .35)"
          : "rgba(232,194,139,.34)";
        context.lineWidth = Math.max(.7, cellSize * .025);
        for (const cell of propCells) {
          const cellCenterX = (cell.x + .5) * cellSize;
          const cellCenterY = (cell.y + .5) * cellSize;
          context.beginPath();
          if (vertical) {
            context.moveTo(centerX - width * .32, cellCenterY);
            context.lineTo(centerX + width * .32, cellCenterY);
          } else {
            context.moveTo(cellCenterX, centerY - height * .32);
            context.lineTo(cellCenterX, centerY + height * .32);
          }
          context.stroke();
          context.fillStyle = spaceshipFurniture ? "#d4934c" : "#d0a36b";
          context.beginPath();
          context.arc(cellCenterX, cellCenterY, Math.max(.8, cellSize * .035), 0, Math.PI * 2);
          context.fill();
        }
      } else if (prop === "crate") {
        for (const cell of propCells) {
          const crateX = (cell.x + .5) * cellSize;
          const crateY = (cell.y + .5) * cellSize;
          const size = cellSize * .7;
          context.fillStyle = spaceshipFurniture ? "#56686d" : "#806040";
          context.strokeStyle = spaceshipFurniture ? "#24373d" : "#39281f";
          context.fillRect(crateX - size / 2, crateY - size / 2, size, size);
          context.strokeRect(crateX - size / 2, crateY - size / 2, size, size);
          context.strokeStyle = spaceshipFurniture
            ? "rgba(153, 181, 185, .58)"
            : "#39281f";
          context.beginPath();
          context.moveTo(crateX - size * .4, crateY - size * .4);
          context.lineTo(crateX + size * .4, crateY + size * .4);
          context.moveTo(crateX + size * .4, crateY - size * .4);
          context.lineTo(crateX - size * .4, crateY + size * .4);
          context.stroke();
        }
      } else if (prop === "barrel" || prop === "bucket" || prop === "flower_pot") {
        const size = prop === "bucket" ? cellSize * .52 : cellSize * .68;
        context.fillStyle = prop === "flower_pot" ? "#9a634b"
          : prop === "bucket" ? "#555d5d" : "#805238";
        context.strokeStyle = prop === "bucket" ? "#252d2d" : "#3b281f";
        context.beginPath();
        context.ellipse(centerX, centerY, size / 2, size * .43, 0, 0, Math.PI * 2);
        context.fill();
        context.stroke();
      } else if (prop === "statue") {
        const radius = cellSize * .36;
        context.fillStyle = "#8e918b";
        context.strokeStyle = "#484c49";
        context.lineWidth = Math.max(1, cellSize * .045);
        context.beginPath();
        context.arc(centerX, centerY, radius, 0, Math.PI * 2);
        context.fill();
        context.stroke();
        context.fillStyle = "#484c49";
        traceFilledStar(context, centerX, centerY, radius * .98, radius * .42);
        context.fill();
      } else if (prop === "drawers" || prop === "shelf") {
        const width = cellSize * .72;
        const height = cellSize * .82;
        context.fillStyle = "#765139";
        context.strokeStyle = "#39281f";
        context.fillRect(centerX - width / 2, centerY - height / 2, width, height);
        context.strokeRect(centerX - width / 2, centerY - height / 2, width, height);
      } else if (prop === "console") {
        const width = spanWidth * (vertical ? .5 : .92);
        const height = spanHeight * (vertical ? .92 : .5);
        context.fillStyle = "#3f5358";
        context.fillRect(centerX - width / 2, centerY - height / 2, width, height);
        context.strokeRect(centerX - width / 2, centerY - height / 2, width, height);
        context.fillStyle = "#76b7bd";
        context.beginPath();
        context.arc(centerX, centerY, Math.max(1.3, cellSize * .09), 0, Math.PI * 2);
        context.fill();
      } else if (prop === "torch") {
        context.fillStyle = "#f0b65b";
        context.beginPath();
        context.arc(centerX, centerY, cellSize * .14, 0, Math.PI * 2);
        context.fill();
        context.strokeStyle = "#443126";
        context.beginPath();
        context.moveTo(centerX, centerY + cellSize * .08);
        context.lineTo(centerX, centerY + cellSize * .32);
        context.stroke();
      } else if (prop === "bar") {
        const width = spanWidth * (vertical ? .56 : .94);
        const height = spanHeight * (vertical ? .94 : .56);
        context.fillStyle = "#68432d";
        context.fillRect(centerX - width / 2, centerY - height / 2, width, height);
        context.strokeRect(centerX - width / 2, centerY - height / 2, width, height);
        context.strokeStyle = "#bf8752";
        context.lineWidth = Math.max(1, cellSize * .04);
        context.beginPath();
        if (vertical) {
          context.moveTo(centerX, centerY - height * .44);
          context.lineTo(centerX, centerY + height * .44);
        } else {
          context.moveTo(centerX - width * .44, centerY);
          context.lineTo(centerX + width * .44, centerY);
        }
        context.stroke();
      } else {
        const width = spanWidth * (vertical ? .5 : .92);
        const height = spanHeight * (vertical ? .92 : .5);
        context.fillRect(centerX - width / 2, centerY - height / 2, width, height);
        context.strokeRect(centerX - width / 2, centerY - height / 2, width, height);
        context.strokeStyle = "rgba(236,190,126,.3)";
        context.beginPath();
        if (vertical) {
          context.moveTo(centerX, centerY - height * .35);
          context.lineTo(centerX, centerY + height * .35);
        } else {
          context.moveTo(centerX - width * .35, centerY);
          context.lineTo(centerX + width * .35, centerY);
        }
        context.stroke();
      }
    }
  }
  context.restore();
}

function drawCampfirePlaceholder(
  x: number,
  y: number,
  cellSize: number,
  context: CanvasRenderingContext2D,
) {
  const centerX = (x + .5) * cellSize;
  const centerY = (y + .5) * cellSize;
  context.save();
  context.translate(centerX, centerY);
  applyPropContactShadow(cellSize, context);
  context.fillStyle = "#3d3127";
  context.strokeStyle = "#261d18";
  context.lineWidth = Math.max(1, cellSize * .045);
  for (const angle of [-.55, .55]) {
    context.save();
    context.rotate(angle);
    context.beginPath();
    context.roundRect(
      -cellSize * .34,
      -cellSize * .075,
      cellSize * .68,
      cellSize * .15,
      cellSize * .055,
    );
    context.fill();
    context.stroke();
    context.restore();
  }
  context.shadowColor = "transparent";
  context.fillStyle = "#c54e2f";
  context.beginPath();
  context.ellipse(0, -cellSize * .035, cellSize * .19, cellSize * .29, 0, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#f0b65b";
  context.beginPath();
  context.ellipse(0, -cellSize * .07, cellSize * .1, cellSize * .18, 0, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#f6d98a";
  context.beginPath();
  context.ellipse(0, -cellSize * .09, cellSize * .045, cellSize * .095, 0, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function drawLampPostPlaceholder(
  x: number,
  y: number,
  cellSize: number,
  context: CanvasRenderingContext2D,
) {
  const centerX = (x + .5) * cellSize;
  const centerY = (y + .5) * cellSize;
  context.save();
  context.translate(centerX, centerY);
  applyPropContactShadow(cellSize, context);
  context.strokeStyle = "#302b24";
  context.lineCap = "round";
  context.lineWidth = Math.max(1.4, cellSize * .075);
  context.beginPath();
  context.moveTo(0, cellSize * .34);
  context.lineTo(0, -cellSize * .22);
  context.stroke();
  context.lineWidth = Math.max(.8, cellSize * .035);
  context.beginPath();
  context.moveTo(-cellSize * .18, cellSize * .36);
  context.lineTo(cellSize * .18, cellSize * .36);
  context.stroke();
  context.shadowColor = "transparent";
  context.fillStyle = "#f0c66a";
  context.strokeStyle = "#3a3026";
  context.lineWidth = Math.max(.8, cellSize * .035);
  context.beginPath();
  context.roundRect(
    -cellSize * .15,
    -cellSize * .43,
    cellSize * .3,
    cellSize * .25,
    cellSize * .035,
  );
  context.fill();
  context.stroke();
  context.fillStyle = "rgba(255, 232, 155, .62)";
  context.beginPath();
  context.arc(0, -cellSize * .3, cellSize * .075, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function drawAnchoredTilesetProp(
  image: CanvasImageSource,
  x: number,
  y: number,
  cellSize: number,
  context: CanvasRenderingContext2D,
) {
  const source = imageSourceSize(image);
  const visual = tilesetImageSpriteLayout(image) ?? {
    renderWidthCells: 1,
    renderHeightCells: 1,
    anchor: "center" as const,
  };
  const targetWidth = cellSize * visual.renderWidthCells;
  const targetHeight = cellSize * visual.renderHeightCells;
  const scale = source
    ? Math.min(targetWidth / source.width, targetHeight / source.height)
    : 1;
  const drawWidth = source ? source.width * scale : targetWidth;
  const drawHeight = source ? source.height * scale : targetHeight;
  context.save();
  context.imageSmoothingEnabled = Math.abs(scale - Math.round(scale)) > .001;
  context.imageSmoothingQuality = "high";
  applyPropContactShadow(cellSize, context);
  context.drawImage(
    image,
    (x + .5) * cellSize - drawWidth / 2,
    visual.anchor === "bottom"
      ? (y + 1) * cellSize - drawHeight
      : (y + .5) * cellSize - drawHeight / 2,
    drawWidth,
    drawHeight,
  );
  context.restore();
}

function drawOutdoorProps(
  grid: Grid,
  cellSize: number,
  hiddenItems: ReadonlySet<string>,
  hiddenOpacity: number,
  context: CanvasRenderingContext2D,
  tilesetProps?: TilesetPropImages,
) {
  context.save();
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      const prop = grid[y][x].outdoorProp;
      if (!prop) continue;
      context.globalAlpha = hiddenItems.has(prop) ? hiddenOpacity : 1;
      if (prop === OutdoorProp.Campfire) {
        const campfireImage = tilesetProps && imageSourceSize(tilesetProps.campfire)
          ? tilesetProps.campfire : undefined;
        if (campfireImage) {
          drawAnchoredTilesetProp(campfireImage, x, y, cellSize, context);
        } else {
          drawCampfirePlaceholder(x, y, cellSize, context);
        }
      } else if (prop === OutdoorProp.LampPost) {
        const lampPostImage = tilesetProps && imageSourceSize(tilesetProps.lampPost)
          ? tilesetProps.lampPost : undefined;
        if (lampPostImage) {
          drawAnchoredTilesetProp(lampPostImage, x, y, cellSize, context);
        } else {
          drawLampPostPlaceholder(x, y, cellSize, context);
        }
      }
    }
  }
  context.restore();
}

function drawSewerMasonry(
  grid: Grid,
  cellSize: number,
  context: CanvasRenderingContext2D,
) {
  const cliffStyle = getTerrainStyle(Terrain.Cliff, "sewer");
  const isCliff = (x: number, y: number) =>
    grid[y]?.[x]?.terrain === Terrain.Cliff;

  context.save();
  context.lineCap = "butt";
  context.lineJoin = "miter";

  // Sewer walls are cut masonry rather than exposed rock. Repainting their
  // square top planes also removes the rounded cave silhouette underneath.
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      if (!isCliff(x, y)) continue;
      const left = x * cellSize;
      const top = y * cellSize;
      context.fillStyle = cliffStyle.color;
      context.fillRect(left, top, cellSize, cellSize);
      if ((x + y) % 2 === 0) {
        context.fillStyle = "rgba(29, 36, 34, .055)";
        context.fillRect(left, top, cellSize, cellSize);
      }

      context.strokeStyle = "rgba(37, 43, 41, .46)";
      context.lineWidth = Math.max(.65, cellSize * .022);
      context.beginPath();
      for (let course = 1; course <= 2; course += 1) {
        const courseY = top + cellSize * course / 3;
        context.moveTo(left, courseY);
        context.lineTo(left + cellSize, courseY);
      }
      for (let course = 0; course < 3; course += 1) {
        const jointX = left + cellSize * (
          (x + y + course) % 2 === 0 ? .34 : .68
        );
        context.moveTo(jointX, top + cellSize * course / 3);
        context.lineTo(jointX, top + cellSize * (course + 1) / 3);
      }
      context.stroke();
    }
  }

  // Broad staggered slabs keep the walkable corridors visually quieter than
  // the brickwork while still reading as built infrastructure.
  context.strokeStyle = "rgba(43, 49, 46, .24)";
  context.lineWidth = Math.max(.55, cellSize * .018);
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      if (underlyingTerrain(grid, x, y) !== Terrain.Ground) continue;
      const left = x * cellSize;
      const top = y * cellSize;
      context.beginPath();
      context.moveTo(left, top + cellSize * .5);
      context.lineTo(left + cellSize, top + cellSize * .5);
      const jointX = left + cellSize * ((x + y) % 2 === 0 ? .35 : .68);
      if (y % 2 === 0) {
        context.moveTo(jointX, top);
        context.lineTo(jointX, top + cellSize * .5);
      } else {
        context.moveTo(jointX, top + cellSize * .5);
        context.lineTo(jointX, top + cellSize);
      }
      context.stroke();
    }
  }

  const drawWallEdge = (
    left: number,
    top: number,
    side: 0 | 1 | 2 | 3,
    inset: number,
  ) => {
    if (side === 0) {
      context.moveTo(left, top + inset);
      context.lineTo(left + cellSize, top + inset);
    } else if (side === 1) {
      context.moveTo(left + cellSize - inset, top);
      context.lineTo(left + cellSize - inset, top + cellSize);
    } else if (side === 2) {
      context.moveTo(left + cellSize, top + cellSize - inset);
      context.lineTo(left, top + cellSize - inset);
    } else {
      context.moveTo(left + inset, top + cellSize);
      context.lineTo(left + inset, top);
    }
  };
  for (const [strokeStyle, lineWidth, inset] of [
    ["rgba(27, 33, 31, .82)", Math.max(2, cellSize * .105), 0],
    ["rgba(176, 181, 164, .38)", Math.max(.7, cellSize * .026), cellSize * .055],
  ] as const) {
    context.strokeStyle = strokeStyle;
    context.lineWidth = lineWidth;
    context.beginPath();
    for (let y = 0; y < grid.length; y += 1) {
      for (let x = 0; x < grid[y].length; x += 1) {
        if (!isCliff(x, y)) continue;
        const left = x * cellSize;
        const top = y * cellSize;
        if (y > 0 && !isCliff(x, y - 1)) drawWallEdge(left, top, 0, inset);
        if (x < grid[y].length - 1 && !isCliff(x + 1, y)) {
          drawWallEdge(left, top, 1, inset);
        }
        if (y < grid.length - 1 && !isCliff(x, y + 1)) {
          drawWallEdge(left, top, 2, inset);
        }
        if (x > 0 && !isCliff(x - 1, y)) drawWallEdge(left, top, 3, inset);
      }
    }
    context.stroke();
  }
  context.restore();
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
    const radiusX = radius * (1.08 + variation * .3);
    const radiusY = radius * (.52 + variation * .16);
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
        faceContext.lineCap = "round";
        for (let index = 1; index <= 4; index += 1) {
          const variation = terrainVariation(x * 4 + index, y, 1579);
          if (variation < .24) continue;
          const startX = left + cellSize * (index / 5 + (variation - .5) * .06);
          const startY = top + cellSize * (.58 + variation * .06);
          const endX = startX + cellSize * (variation - .5) * .1;
          const endY = top + cellSize * (.88 + variation * .04);
          faceContext.strokeStyle = "rgba(14, 17, 17, .3)";
          faceContext.lineWidth = Math.max(1, cellSize * .028);
          faceContext.beginPath();
          faceContext.moveTo(startX, startY);
          faceContext.lineTo(endX, endY);
          faceContext.stroke();
          faceContext.strokeStyle = "rgba(218, 218, 201, .12)";
          faceContext.lineWidth = Math.max(.6, cellSize * .012);
          faceContext.beginPath();
          faceContext.moveTo(startX - cellSize * .025, startY);
          faceContext.lineTo(endX - cellSize * .025, endY);
          faceContext.stroke();
        }

        // Loose stones belong at the foot of the face. Keeping them small and
        // partially clipped by the mask avoids making them float mid-slope.
        for (let index = 0; index < 5; index += 1) {
          const variation = terrainVariation(x * 5 + index, y, 1601);
          if (variation < .48) continue;
          drawRock(
            left + cellSize * (index + .5) / 5,
            top + cellSize * (.965 + (variation - .5) * .025),
            cellSize * (.065 + variation * .02),
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
  mode: LandscapeMode,
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
    const battlefieldTrench = mode === "ruined-battlefield" &&
      terrain === Terrain.Ravine;
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
        : battlefieldTrench
          ? "rgba(167, 130, 84, .58)"
          : "rgba(235, 202, 151, .62)",
    );
    const bottomRight = createMaskEdge(
      mask,
      -depth,
      -depth,
      blur,
      raised
        ? "rgba(20, 23, 21, .68)"
        : battlefieldTrench
          ? "rgba(67, 43, 29, .7)"
          : "rgba(224, 185, 132, .55)",
    );
    const wash = document.createElement("canvas");
    wash.width = width;
    wash.height = height;
    const washContext = wash.getContext("2d")!;
    washContext.drawImage(mask, 0, 0);
    washContext.globalCompositeOperation = "source-in";
    washContext.fillStyle = raised
      ? "#f1ead5"
      : battlefieldTrench
        ? "#30221a"
        : "#211f1b";
    washContext.fillRect(0, 0, width, height);

    context.save();
    context.globalAlpha = hiddenItems.has(terrain) ? hiddenOpacity : 1;
    context.drawImage(topLeft, 0, 0);
    context.drawImage(bottomRight, 0, 0);

    // A restrained inner wash makes cliffs feel solid and ravines feel deep
    // while preserving the palette underneath.
    context.globalAlpha *= raised ? .06 : battlefieldTrench ? .38 : .5;
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
  context.globalAlpha = visibility * .42;
  context.strokeStyle = getTerrainStyle(Terrain.Ground, mode).color;
  context.lineWidth = Math.max(2, cellSize * .14);
  context.stroke();
  context.globalAlpha = visibility * .4;
  context.strokeStyle = getTerrainStyle(Terrain.Water, mode).alt;
  context.lineWidth = Math.max(1, cellSize * .035);
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
  mode: LandscapeMode,
) {
  context.lineCap = "round";
  context.lineJoin = "round";
  if (mode === "sewer") {
    const spacing = cellSize * 1.55;
    const bandCount = Math.ceil(height / spacing) + 3;
    for (let band = -1; band < bandCount; band += 1) {
      const baseY = band * spacing + spacing * .5;
      const path = new Path2D();
      const step = Math.max(6, cellSize * .7);
      for (
        let x = -cellSize, index = 0;
        x <= width + cellSize;
        x += step, index += 1
      ) {
        const ripple = Math.sin(
          x / (cellSize * 2.8) + band * 1.7,
        ) * cellSize * .018;
        const jitter = (
          terrainVariation(index, band, 2887) - .5
        ) * cellSize * .012;
        if (index === 0) path.moveTo(x, baseY + ripple + jitter);
        else path.lineTo(x, baseY + ripple + jitter);
      }
      context.strokeStyle = "rgba(31, 48, 40, .2)";
      context.lineWidth = Math.max(1.1, cellSize * .052);
      context.setLineDash([]);
      context.stroke(path);
      context.strokeStyle = "rgba(182, 194, 151, .14)";
      context.lineWidth = Math.max(.65, cellSize * .018);
      context.setLineDash([cellSize * .95, cellSize * .72]);
      context.lineDashOffset = -terrainVariation(band, 2, 2899) * cellSize;
      context.stroke(path);
    }
    context.setLineDash([]);
    return;
  }
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
  mode: LandscapeMode,
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
      drawWaterMaterial(effectContext, width, height, cellSize, mode);
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

const coniferTreeModes = new Set<LandscapeMode>([
  "frozen-lake",
  "highlands",
  "mountain-pass",
]);

const palmTreeModes = new Set<LandscapeMode>([
  "archipelago",
  "coast",
]);

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

  if (coniferTreeModes.has(mode)) {
    const rotation = terrainVariation(minimumX, minimumY, 4421) * Math.PI;
    const crownPath = (scale: number, offsetX = 0, offsetY = 0) => {
      const crown = new Path2D();
      const pointCount = 18;
      for (let index = 0; index < pointCount; index += 1) {
        const angle = rotation + index * Math.PI * 2 / pointCount;
        const pointVariation = terrainVariation(
          minimumX * pointCount + index,
          minimumY,
          4441,
        );
        const radius = (index % 2 === 0 ? .98 : .65) *
          (.92 + pointVariation * .12) * scale;
        const x = centerX + offsetX + Math.cos(angle) * radiusX * radius;
        const y = centerY + offsetY + Math.sin(angle) * radiusY * radius;
        if (index === 0) crown.moveTo(x, y);
        else crown.lineTo(x, y);
      }
      crown.closePath();
      return crown;
    };

    context.save();
    applyPropContactShadow(size, context);
    context.fillStyle = colors.dark;
    context.fill(crownPath(1));
    context.restore();
    context.fillStyle = colors.light;
    context.fill(crownPath(.58, -radiusX * .1, -radiusY * .1));
    context.fillStyle = colors.trunk;
    context.beginPath();
    context.arc(centerX, centerY, Math.max(1.1, size * .055), 0, Math.PI * 2);
    context.fill();
    return;
  }

  if (palmTreeModes.has(mode)) {
    const rotation = terrainVariation(minimumX, minimumY, 4463) * Math.PI * 2;
    const fronds = new Path2D();
    for (let index = 0; index < 7; index += 1) {
      const pointVariation = terrainVariation(
        minimumX * 7 + index,
        minimumY,
        4481,
      );
      const angle = rotation + index * Math.PI * 2 / 7 +
        (pointVariation - .5) * .22;
      const reachX = Math.cos(angle) * radiusX * (.76 + pointVariation * .2);
      const reachY = Math.sin(angle) * radiusY * (.76 + pointVariation * .2);
      const bend = (pointVariation - .5) * .34;
      fronds.moveTo(centerX, centerY);
      fronds.quadraticCurveTo(
        centerX + reachX * .48 - Math.sin(angle) * radiusX * bend,
        centerY + reachY * .48 + Math.cos(angle) * radiusY * bend,
        centerX + reachX,
        centerY + reachY,
      );
    }

    context.save();
    applyPropContactShadow(size, context);
    context.strokeStyle = colors.dark;
    context.lineWidth = Math.max(1.5, size * .13);
    context.lineCap = "round";
    context.stroke(fronds);
    context.restore();
    context.strokeStyle = colors.light;
    context.lineWidth = Math.max(.8, size * .055);
    context.lineCap = "round";
    context.stroke(fronds);
    context.fillStyle = colors.trunk;
    context.beginPath();
    context.arc(centerX, centerY, Math.max(1.4, size * .085), 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = colors.dark;
    context.lineWidth = Math.max(.65, size * .022);
    context.stroke();
    return;
  }

  if (mode === "ruined-battlefield") {
    const rotation = terrainVariation(minimumX, minimumY, 4513) * Math.PI * 2;
    const branches = new Path2D();
    for (let index = 0; index < 6; index += 1) {
      const pointVariation = terrainVariation(
        minimumX * 6 + index,
        minimumY,
        4547,
      );
      const angle = rotation + index * Math.PI * 2 / 6 +
        (pointVariation - .5) * .3;
      const reachX = Math.cos(angle) * radiusX * (.72 + pointVariation * .22);
      const reachY = Math.sin(angle) * radiusY * (.72 + pointVariation * .22);
      const branchX = centerX + reachX;
      const branchY = centerY + reachY;
      branches.moveTo(centerX, centerY);
      branches.quadraticCurveTo(
        centerX + reachX * .42 + Math.sin(angle) * radiusX * .12,
        centerY + reachY * .42 - Math.cos(angle) * radiusY * .12,
        branchX,
        branchY,
      );
      const twigAngle = angle + (index % 2 ? .5 : -.5);
      branches.moveTo(
        centerX + reachX * .62,
        centerY + reachY * .62,
      );
      branches.lineTo(
        centerX + reachX * .62 + Math.cos(twigAngle) * radiusX * .24,
        centerY + reachY * .62 + Math.sin(twigAngle) * radiusY * .24,
      );
    }

    context.save();
    applyPropContactShadow(size, context);
    context.strokeStyle = colors.dark;
    context.lineWidth = Math.max(1.6, size * .15);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.stroke(branches);
    context.restore();
    context.strokeStyle = colors.trunk;
    context.lineWidth = Math.max(.8, size * .065);
    context.stroke(branches);
    context.fillStyle = colors.dark;
    context.beginPath();
    context.arc(centerX, centerY, Math.max(1.5, size * .11), 0, Math.PI * 2);
    context.fill();
    context.fillStyle = colors.trunk;
    context.beginPath();
    context.arc(centerX - size * .015, centerY - size * .02, Math.max(.9, size * .06), 0, Math.PI * 2);
    context.fill();
    return;
  }

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

function drawRuinedBuilding(
  points: Array<{ x: number; y: number }>,
  id: number,
  size: number,
  mode: LandscapeMode,
  context: CanvasRenderingContext2D,
) {
  const colors = getBiomeObjectStyle(mode).building;
  const cells = new Set(points.map(({ x, y }) => `${x},${y}`));
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
  for (const { x, y } of points) {
    const left = x * size;
    const top = y * size;
    const variation = terrainVariation(x, y, 4013 + id * 17);
    const secondaryVariation = terrainVariation(x, y, 4051 + id * 23);
    const inset = size * (.1 + variation * .045);

    context.fillStyle = variation > .5 ? colors.secondary : colors.primary;
    context.globalAlpha = .72;
    context.fillRect(
      left + inset,
      top + inset,
      size - inset * 2,
      size - inset * 2,
    );
    context.globalAlpha = 1;

    context.fillStyle = "rgba(25, 27, 25, .32)";
    context.beginPath();
    context.ellipse(
      left + size * (.43 + (variation - .5) * .18),
      top + size * (.5 + (secondaryVariation - .5) * .2),
      size * (.18 + variation * .07),
      size * (.11 + secondaryVariation * .055),
      (variation - .5) * .75,
      0,
      Math.PI * 2,
    );
    context.fill();

    context.strokeStyle = "rgba(225, 218, 190, .2)";
    context.lineWidth = Math.max(.65, size * .02);
    context.beginPath();
    context.moveTo(left + size * .18, top + size * (.28 + variation * .12));
    context.lineTo(left + size * (.45 + secondaryVariation * .1), top + size * .48);
    context.lineTo(left + size * (.34 + variation * .12), top + size * .77);
    context.stroke();

    for (let rubble = 0; rubble < 2; rubble += 1) {
      const rubbleX = terrainVariation(x * 3 + rubble, y, 4093 + id);
      const rubbleY = terrainVariation(x, y * 3 + rubble, 4127 + id);
      const centerX = left + size * (.14 + rubbleX * .72);
      const centerY = top + size * (.16 + rubbleY * .68);
      const radius = size * (.045 + rubbleX * .025);
      context.fillStyle = rubble ? colors.primary : colors.secondary;
      context.strokeStyle = colors.edge;
      context.lineWidth = Math.max(.55, size * .015);
      context.beginPath();
      context.moveTo(centerX - radius, centerY + radius * .6);
      context.lineTo(centerX - radius * .45, centerY - radius);
      context.lineTo(centerX + radius, centerY - radius * .15);
      context.lineTo(centerX + radius * .35, centerY + radius);
      context.closePath();
      context.fill();
      context.stroke();
    }
  }
  context.restore();

  const drawBrokenEdge = (
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    salt: number,
  ) => {
    const variation = terrainVariation(
      Math.round(startX / size),
      Math.round(startY / size),
      salt + id * 29,
    );
    const gapStart = .28 + variation * .18;
    const gapEnd = gapStart + .16 + variation * .09;
    context.moveTo(startX, startY);
    context.lineTo(
      startX + (endX - startX) * gapStart,
      startY + (endY - startY) * gapStart,
    );
    context.moveTo(
      startX + (endX - startX) * gapEnd,
      startY + (endY - startY) * gapEnd,
    );
    context.lineTo(endX, endY);
  };

  context.save();
  context.strokeStyle = colors.edge;
  context.lineWidth = Math.max(1.5, size * .1);
  context.lineCap = "round";
  context.beginPath();
  for (const { x, y } of points) {
    const left = x * size;
    const top = y * size;
    const right = left + size;
    const bottom = top + size;
    if (!cells.has(`${x},${y - 1}`)) {
      drawBrokenEdge(left, top, right, top, 4159 + x * 7 + y * 11);
    }
    if (!cells.has(`${x + 1},${y}`)) {
      drawBrokenEdge(right, top, right, bottom, 4211 + x * 7 + y * 11);
    }
    if (!cells.has(`${x},${y + 1}`)) {
      drawBrokenEdge(right, bottom, left, bottom, 4253 + x * 7 + y * 11);
    }
    if (!cells.has(`${x - 1},${y}`)) {
      drawBrokenEdge(left, bottom, left, top, 4283 + x * 7 + y * 11);
    }
  }
  context.stroke();

  context.strokeStyle = "rgba(231, 224, 196, .26)";
  context.lineWidth = Math.max(.7, size * .025);
  context.beginPath();
  for (const { x, y } of points) {
    if (!cells.has(`${x},${y - 1}`)) {
      const left = x * size;
      const top = y * size;
      context.moveTo(left + size * .08, top + size * .035);
      context.lineTo(left + size * .35, top + size * .035);
    }
  }
  context.stroke();
  context.restore();
}

function drawBuilding(
  points: Array<{ x: number; y: number }>,
  id: number,
  size: number,
  mode: LandscapeMode,
  context: CanvasRenderingContext2D,
  tilesetImage?: CanvasImageSource,
) {
  if (mode === "ancient-ruins" || mode === "ruined-battlefield") {
    drawRuinedBuilding(points, id, size, mode, context);
    return;
  }
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
  const baseColor = id % 2 === 0 ? colors.primary : colors.secondary;
  context.fillStyle = tilesetImage
    ? createTilesetTilePattern(
      tilesetImage,
      buildingTilesetCoordinate,
      context,
      size,
      0,
      baseColor,
      .5,
    )!
    : baseColor;
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
  context.save();
  context.clip(footprint);
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
  context.restore();
}

function connectedPointGroups(points: Array<{ x: number; y: number }>) {
  const remaining = new Set(points.map(({ x, y }) => `${x},${y}`));
  const byKey = new Map(points.map((point) => [`${point.x},${point.y}`, point]));
  const groups: Array<Array<{ x: number; y: number }>> = [];
  for (const point of points) {
    const startKey = `${point.x},${point.y}`;
    if (!remaining.has(startKey)) continue;
    const group: Array<{ x: number; y: number }> = [];
    const stack = [point];
    remaining.delete(startKey);
    while (stack.length) {
      const current = stack.pop()!;
      group.push(current);
      for (const [offsetX, offsetY] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const neighborKey = `${current.x + offsetX},${current.y + offsetY}`;
        const neighbor = byKey.get(neighborKey);
        if (!neighbor || !remaining.delete(neighborKey)) continue;
        stack.push(neighbor);
      }
    }
    groups.push(group);
  }
  return groups;
}

function drawRockFormation(
  points: Array<{ x: number; y: number }>,
  size: number,
  mode: LandscapeMode,
  context: CanvasRenderingContext2D,
) {
  const colors = getBiomeObjectStyle(mode).rock;
  if (points.length === 1) {
    const { x, y } = points[0];
    const left = x * size;
    const top = y * size;
    context.save();
    applyPropContactShadow(size, context);
    context.fillStyle = colors.fill;
    context.beginPath();
    context.moveTo(left + size * .1, top + size * .76);
    context.lineTo(left + size * .26, top + size * .24);
    context.lineTo(left + size * .65, top + size * .11);
    context.lineTo(left + size * .91, top + size * .69);
    context.lineTo(left + size * .64, top + size * .88);
    context.closePath();
    context.fill();
    context.restore();
    context.strokeStyle = colors.stroke;
    context.lineWidth = Math.max(1, size * .03);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.stroke();
    context.fillStyle = colors.highlight;
    context.beginPath();
    context.moveTo(left + size * .26, top + size * .24);
    context.lineTo(left + size * .65, top + size * .11);
    context.lineTo(left + size * .51, top + size * .47);
    context.closePath();
    context.fill();
    return;
  }
  const minimumX = Math.min(...points.map(({ x }) => x));
  const maximumX = Math.max(...points.map(({ x }) => x));
  const minimumY = Math.min(...points.map(({ y }) => y));
  const maximumY = Math.max(...points.map(({ y }) => y));
  const variation = terrainVariation(minimumX, minimumY, 4337);
  const left = minimumX * size + size * (.07 + variation * .025);
  const right = (maximumX + 1) * size - size * (.08 + variation * .02);
  const top = minimumY * size + size * (.06 + variation * .025);
  const bottom = (maximumY + 1) * size - size * (.08 + variation * .02);
  const width = right - left;
  const height = bottom - top;
  const formation = new Path2D();
  formation.moveTo(left + width * .02, top + height * .68);
  formation.lineTo(left + width * .13, top + height * .31);
  formation.lineTo(left + width * .34, top + height * .07);
  formation.lineTo(left + width * .65, top + height * .02);
  formation.lineTo(left + width * .88, top + height * .23);
  formation.lineTo(left + width * .98, top + height * .61);
  formation.lineTo(left + width * .78, top + height * .9);
  formation.lineTo(left + width * .36, top + height * .97);
  formation.closePath();

  context.save();
  applyPropContactShadow(size, context);
  context.fillStyle = colors.fill;
  context.fill(formation);
  context.restore();

  context.strokeStyle = colors.stroke;
  context.lineWidth = Math.max(1, size * .055);
  context.lineCap = "round";
  context.lineJoin = "round";
  context.stroke(formation);

  context.fillStyle = colors.highlight;
  context.globalAlpha = .82;
  context.beginPath();
  context.moveTo(left + width * .13, top + height * .31);
  context.lineTo(left + width * .34, top + height * .07);
  context.lineTo(left + width * .46, top + height * .48);
  context.lineTo(left + width * .24, top + height * .56);
  context.closePath();
  context.fill();
  context.globalAlpha = .52;
  context.beginPath();
  context.moveTo(left + width * .34, top + height * .07);
  context.lineTo(left + width * .65, top + height * .02);
  context.lineTo(left + width * .72, top + height * .32);
  context.lineTo(left + width * .46, top + height * .48);
  context.closePath();
  context.fill();
  context.globalAlpha = 1;

  context.strokeStyle = colors.stroke;
  context.lineWidth = Math.max(.8, size * .025);
  context.beginPath();
  context.moveTo(left + width * .46, top + height * .48);
  context.lineTo(left + width * .57, top + height * .61);
  context.lineTo(left + width * .52, top + height * .76);
  context.stroke();
}

function completeTwoByTwoOrigin(
  points: Array<{ x: number; y: number }>,
) {
  if (points.length !== 4) return undefined;
  const minimumX = Math.min(...points.map(({ x }) => x));
  const minimumY = Math.min(...points.map(({ y }) => y));
  const pointKeys = new Set(points.map(({ x, y }) => `${x},${y}`));
  const completeBlock = [
    `${minimumX},${minimumY}`,
    `${minimumX + 1},${minimumY}`,
    `${minimumX},${minimumY + 1}`,
    `${minimumX + 1},${minimumY + 1}`,
  ];
  return completeBlock.every((key) => pointKeys.has(key))
    ? { x: minimumX, y: minimumY }
    : undefined;
}

function completeRectangleOrigin(
  points: Array<{ x: number; y: number }>,
  width: number,
  height: number,
) {
  if (points.length !== width * height) return undefined;
  const minimumX = Math.min(...points.map(({ x }) => x));
  const minimumY = Math.min(...points.map(({ y }) => y));
  const pointKeys = new Set(points.map(({ x, y }) => `${x},${y}`));
  for (let offsetY = 0; offsetY < height; offsetY += 1) {
    for (let offsetX = 0; offsetX < width; offsetX += 1) {
      if (!pointKeys.has(`${minimumX + offsetX},${minimumY + offsetY}`)) {
        return undefined;
      }
    }
  }
  return { x: minimumX, y: minimumY };
}

function drawDifficultTerrainDetail(
  grid: Grid,
  x: number,
  y: number,
  cellSize: number,
  mode: LandscapeMode,
  context: CanvasRenderingContext2D,
) {
  const style = getDifficultTerrainDetailStyle(mode);
  const left = x * cellSize;
  const top = y * cellSize;
  const variation = terrainVariation(x, y, 3701);
  const secondaryVariation = terrainVariation(x, y, 3733);

  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";

  if (style.kind === "crop") {
    const cropAxisSupport = (dx: number, dy: number) => {
      let support = 0;
      for (const direction of [-1, 1]) {
        let consecutiveGaps = 0;
        for (let distance = 1; distance <= 5; distance += 1) {
          const sampleX = x + dx * distance * direction;
          const sampleY = y + dy * distance * direction;
          const sample = grid[sampleY]?.[sampleX];
          if (!sample) break;
          const terrain = underlyingTerrain(grid, sampleX, sampleY);
          if (
            terrain === Terrain.Road ||
            terrain === Terrain.Water ||
            terrain === Terrain.Cliff ||
            terrain === Terrain.Wall ||
            terrain === Terrain.Ravine
          ) {
            break;
          }
          if (terrain === Terrain.Difficult) {
            support += 6 - distance;
            consecutiveGaps = 0;
          } else {
            consecutiveGaps += 1;
            if (consecutiveGaps >= 2) break;
          }
        }
      }
      return support;
    };
    const horizontal = cropAxisSupport(1, 0) >= cropAxisSupport(0, 1);
    context.strokeStyle = style.dark;
    context.lineWidth = Math.max(.8, cellSize * .035);
    for (const offset of [.2, .5, .8]) {
      context.beginPath();
      if (horizontal) {
        context.moveTo(left, top + cellSize * offset);
        context.lineTo(left + cellSize, top + cellSize * offset);
      } else {
        context.moveTo(left + cellSize * offset, top);
        context.lineTo(left + cellSize * offset, top + cellSize);
      }
      context.stroke();
    }
    context.strokeStyle = style.light;
    context.lineWidth = Math.max(.6, cellSize * .018);
    const highlightOffset = .2 + secondaryVariation * .6;
    context.beginPath();
    if (horizontal) {
      context.moveTo(left + cellSize * .12, top + cellSize * highlightOffset);
      context.lineTo(left + cellSize * .88, top + cellSize * highlightOffset);
    } else {
      context.moveTo(left + cellSize * highlightOffset, top + cellSize * .12);
      context.lineTo(left + cellSize * highlightOffset, top + cellSize * .88);
    }
    context.stroke();
  } else if (style.kind === "snow") {
    for (const [index, offset, width] of [
      [0, .35, .08],
      [1, .72, .045],
    ] as const) {
      if (index === 0 ? variation < .2 : secondaryVariation < .43) continue;
      context.strokeStyle = width > .05 ? style.dark : style.light;
      context.lineWidth = Math.max(.7, cellSize * width);
      context.beginPath();
      const driftOffset = offset + (secondaryVariation - .5) * .08;
      context.moveTo(left + cellSize * .08, top + cellSize * driftOffset);
      context.quadraticCurveTo(
        left + cellSize * (.46 + (variation - .5) * .12),
        top + cellSize * (driftOffset - .12),
        left + cellSize * (.78 + variation * .14),
        top + cellSize * (driftOffset + .02),
      );
      context.stroke();
    }
    if (variation > .58) {
      const centerX = left + cellSize * (.28 + secondaryVariation * .45);
      const centerY = top + cellSize * (.2 + variation * .45);
      const radius = cellSize * .075;
      context.strokeStyle = style.light;
      context.lineWidth = Math.max(.65, cellSize * .018);
      context.beginPath();
      context.moveTo(centerX - radius, centerY);
      context.lineTo(centerX + radius, centerY);
      context.moveTo(centerX, centerY - radius);
      context.lineTo(centerX, centerY + radius);
      context.stroke();
    }
  } else if (style.kind === "mud") {
    const puddleX = left + cellSize * (.42 + (variation - .5) * .18);
    const puddleY = top + cellSize * (.57 + (secondaryVariation - .5) * .16);
    context.fillStyle = style.dark;
    context.beginPath();
    context.ellipse(
      puddleX,
      puddleY,
      cellSize * (.22 + variation * .08),
      cellSize * (.1 + secondaryVariation * .04),
      (variation - .5) * .35,
      0,
      Math.PI * 2,
    );
    context.fill();
    context.strokeStyle = style.light;
    context.lineWidth = Math.max(.6, cellSize * .018);
    context.beginPath();
    context.arc(
      puddleX - cellSize * .035,
      puddleY - cellSize * .02,
      cellSize * .11,
      Math.PI * 1.08,
      Math.PI * 1.74,
    );
    context.stroke();
    if (variation > .28) {
      const reedX = left + cellSize * (.2 + secondaryVariation * .55);
      const reedBase = top + cellSize * .86;
      context.strokeStyle = style.accent;
      context.lineWidth = Math.max(.75, cellSize * .025);
      context.beginPath();
      context.moveTo(reedX, reedBase);
      context.quadraticCurveTo(
        reedX - cellSize * .025,
        reedBase - cellSize * .24,
        reedX + cellSize * .025,
        reedBase - cellSize * .43,
      );
      context.moveTo(reedX + cellSize * .07, reedBase);
      context.quadraticCurveTo(
        reedX + cellSize * .1,
        reedBase - cellSize * .18,
        reedX + cellSize * .055,
        reedBase - cellSize * .34,
      );
      context.stroke();
    }
  } else if (style.kind === "ash") {
    context.strokeStyle = style.light;
    context.lineWidth = Math.max(.6, cellSize * .018);
    context.beginPath();
    context.moveTo(left + cellSize * .08, top + cellSize * (.3 + variation * .18));
    context.quadraticCurveTo(
      left + cellSize * .48,
      top + cellSize * (.2 + secondaryVariation * .16),
      left + cellSize * .92,
      top + cellSize * (.32 + variation * .18),
    );
    context.stroke();
    for (let index = 0; index < 4; index += 1) {
      const pointVariation = terrainVariation(x * 7 + index, y, 3761);
      const otherVariation = terrainVariation(x, y * 7 + index, 3793);
      context.fillStyle = index % 2 ? style.accent : style.dark;
      context.beginPath();
      context.arc(
        left + cellSize * (.14 + pointVariation * .72),
        top + cellSize * (.2 + otherVariation * .65),
        Math.max(.7, cellSize * (.018 + pointVariation * .018)),
        0,
        Math.PI * 2,
      );
      context.fill();
    }
  } else if (style.kind === "scree") {
    for (let index = 0; index < 3; index += 1) {
      const pointVariation = terrainVariation(x * 5 + index, y, 3821);
      const otherVariation = terrainVariation(x, y * 5 + index, 3851);
      const centerX = left + cellSize * (.18 + pointVariation * .64);
      const centerY = top + cellSize * (.2 + otherVariation * .62);
      const radius = cellSize * (.055 + pointVariation * .035);
      context.fillStyle = index === 1 ? style.light : style.accent;
      context.strokeStyle = style.dark;
      context.lineWidth = Math.max(.55, cellSize * .015);
      context.beginPath();
      context.moveTo(centerX - radius, centerY + radius * .7);
      context.lineTo(centerX - radius * .2, centerY - radius);
      context.lineTo(centerX + radius, centerY + radius * .45);
      context.closePath();
      context.fill();
      context.stroke();
    }
  } else if (style.kind === "rubble") {
    if (mode === "ruined-battlefield" && variation > .68) {
      context.strokeStyle = style.dark;
      context.lineWidth = Math.max(1, cellSize * .055);
      context.beginPath();
      context.ellipse(
        left + cellSize * (.5 + (variation - .5) * .1),
        top + cellSize * (.52 + (secondaryVariation - .5) * .08),
        cellSize * .31,
        cellSize * .2,
        (variation - .5) * .35,
        Math.PI * .05,
        Math.PI * 1.35,
      );
      context.stroke();
    }
    for (let index = 0; index < 2; index += 1) {
      const pointVariation = terrainVariation(x * 3 + index, y, 3889);
      const otherVariation = terrainVariation(x, y * 3 + index, 3911);
      const centerX = left + cellSize * (.24 + pointVariation * .52);
      const centerY = top + cellSize * (.24 + otherVariation * .5);
      const radius = cellSize * (.07 + pointVariation * .04);
      context.fillStyle = index ? style.light : style.accent;
      context.strokeStyle = style.dark;
      context.lineWidth = Math.max(.6, cellSize * .018);
      context.beginPath();
      context.moveTo(centerX - radius, centerY + radius * .55);
      context.lineTo(centerX - radius * .55, centerY - radius);
      context.lineTo(centerX + radius, centerY - radius * .35);
      context.lineTo(centerX + radius * .5, centerY + radius);
      context.closePath();
      context.fill();
      context.stroke();
    }
  } else if (style.kind === "undergrowth") {
    const stemX = left + cellSize * (.32 + variation * .36);
    const stemBase = top + cellSize * .84;
    context.strokeStyle = style.dark;
    context.lineWidth = Math.max(.8, cellSize * .03);
    context.beginPath();
    context.moveTo(stemX, stemBase);
    context.quadraticCurveTo(
      stemX - cellSize * .08,
      top + cellSize * .52,
      stemX + cellSize * .02,
      top + cellSize * .2,
    );
    context.stroke();
    context.fillStyle = style.accent;
    for (const [offsetX, offsetY, angle] of [
      [-.11, -.18, -.65], [.1, -.29, .58], [-.08, -.39, -.55],
    ] as const) {
      context.beginPath();
      context.ellipse(
        stemX + cellSize * offsetX,
        stemBase + cellSize * offsetY,
        cellSize * .12,
        cellSize * .045,
        angle,
        0,
        Math.PI * 2,
      );
      context.fill();
    }
    context.fillStyle = style.light;
    context.beginPath();
    context.arc(stemX + cellSize * .02, top + cellSize * .2, cellSize * .035, 0, Math.PI * 2);
    context.fill();
  } else {
    const drawGrassClump = (
      centerX: number,
      baseY: number,
      scale: number,
      lean: number,
    ) => {
      context.beginPath();
      for (const offset of [-.08, 0, .08]) {
        context.moveTo(centerX, baseY);
        context.quadraticCurveTo(
          centerX + cellSize * (offset + lean * .04),
          baseY - cellSize * scale * .52,
          centerX + cellSize * (offset * 1.45 + lean * .06),
          baseY - cellSize * scale,
        );
      }
      context.stroke();
    };
    context.strokeStyle = style.dark;
    context.lineWidth = Math.max(.75, cellSize * .027);
    drawGrassClump(
      left + cellSize * (.23 + variation * .08),
      top + cellSize * .83,
      .22 + secondaryVariation * .08,
      variation - .5,
    );
    context.strokeStyle = style.accent;
    drawGrassClump(
      left + cellSize * (.67 + secondaryVariation * .09),
      top + cellSize * (.48 + variation * .13),
      .16 + variation * .06,
      secondaryVariation - .5,
    );
  }

  context.restore();
}

function drawTerrainDetail(
  grid: Grid,
  x: number,
  y: number,
  cellSize: number,
  mode: LandscapeMode,
  context: CanvasRenderingContext2D,
  terrainOverride?: TerrainKind,
) {
  const tile = grid[y][x];
  const terrain = terrainOverride ?? tile.terrain;
  if (terrain === Terrain.Beach) {
    context.fillStyle = "rgba(111, 92, 59, .25)";
    context.beginPath();
    context.arc(x * cellSize + cellSize * .3, y * cellSize + cellSize * .42, Math.max(1, cellSize * .05), 0, Math.PI * 2);
    context.arc(x * cellSize + cellSize * .7, y * cellSize + cellSize * .68, Math.max(1, cellSize * .04), 0, Math.PI * 2);
    context.fill();
  } else if (terrain === Terrain.Road || terrain === Terrain.Bridge) {
    context.strokeStyle = terrain === Terrain.Bridge
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
  } else if (terrain === Terrain.Difficult) {
    drawDifficultTerrainDetail(grid, x, y, cellSize, mode, context);
  } else if (terrain === Terrain.Ravine) {
    context.strokeStyle = "rgba(35, 37, 31, .55)";
    context.beginPath();
    context.moveTo(x * cellSize + 2, y * cellSize + cellSize * .72);
    context.lineTo(x * cellSize + cellSize * .45, y * cellSize + cellSize * .3);
    context.lineTo((x + 1) * cellSize - 2, y * cellSize + cellSize * .48);
    context.stroke();
  } else if (terrain === Terrain.Cliff) {
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
  const useImageProps = options.useTileset ?? false;
  const useTilesetTexture = Boolean(
    options.useTileset && (options.tilesetImage || options.tilesetTerrain),
  );
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

  const drawTerrainBackdropCell = drawTerrainLayers(
    grid,
    cellSize,
    mode,
    hiddenItems,
    hiddenOpacity,
    width,
    height,
    options.useTileset ? options.tilesetImage : undefined,
    options.useTileset ? options.tilesetTerrain : undefined,
    context,
  );
  if (mode === "sewer") drawSewerMasonry(grid, cellSize, context);
  if (!useTilesetTexture) drawGlobalTexture(width, height, context);
  const hasArchitecture = grid.some((row) =>
    row.some((tile) => tile.terrain === Terrain.Wall || tile.terrain === Terrain.Door)
  );
  if (isInteriorMode(mode)) {
    drawInteriorArchitecture(
      grid,
      cellSize,
      mode,
      context,
      options.useTileset ? options.tilesetProps : undefined,
      true,
      drawTerrainBackdropCell,
      options.wallDebug,
    );
    if (mode === "ship-deck") {
      drawSailingShipDeckElevation(grid, cellSize, context);
    }
  }
  drawReliefBevels(
    grid,
    cellSize,
    mode,
    hiddenItems,
    hiddenOpacity,
    width,
    height,
    context,
  );
  if (!useTilesetTexture) {
    drawContinuousLiquidMaterials(
      grid,
      cellSize,
      mode,
      hiddenItems,
      hiddenOpacity,
      context,
    );
  }
  drawRavineUpperEdges(
    grid,
    cellSize,
    mode,
    hiddenItems.has(Terrain.Ravine) ? hiddenOpacity : 1,
    context,
  );
  if (mode === "ruined-battlefield") {
    drawBattlefieldTrenchDetails(
      grid,
      cellSize,
      hiddenItems.has(Terrain.Ravine) ? hiddenOpacity : 1,
      context,
    );
  }
  drawLiquidUpperEdges(
    grid,
    cellSize,
    Terrain.Water,
    mode,
    hiddenItems.has(Terrain.Water) ? hiddenOpacity : 1,
    context,
  );
  drawLiquidUpperEdges(
    grid,
    cellSize,
    Terrain.Lava,
    mode,
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
  drawLavaRockEdges(
    grid,
    cellSize,
    hiddenItems.has(Terrain.Lava) ? hiddenOpacity : 1,
    context,
  );

  if (!useTilesetTexture) {
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
          drawTerrainDetail(grid, x, y, cellSize, mode, context);
        }
      }
    }
  }
  context.globalAlpha = 1;

  if (!isInteriorMode(mode) && hasArchitecture) {
    drawInteriorArchitecture(
      grid,
      cellSize,
      mode,
      context,
      undefined,
      false,
      drawTerrainBackdropCell,
      options.wallDebug,
    );
  }

  if (grid.some((row) => row.some((tile) => tile.deckFeature))) {
    drawSailingShipDeckFeatures(
      grid,
      cellSize,
      context,
      options.useTileset ? options.tilesetProps : undefined,
    );
  }

  const treeGroups = new Map<number, Array<{ x: number; y: number }>>();
  const buildingGroups = new Map<number, Array<{ x: number; y: number }>>();
  const manualBuildingPoints: Array<{ x: number; y: number }> = [];
  const rockGroups = new Map<number, Array<{ x: number; y: number }>>();
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
        if (id < 0) {
          manualBuildingPoints.push({ x, y });
        } else {
          const group = buildingGroups.get(id) ?? [];
          group.push({ x, y });
          buildingGroups.set(id, group);
        }
      }
      if (tile.obstacle === Obstacle.Rock) {
        const id = tile.obstacleId ?? y * columns + x;
        const group = rockGroups.get(id) ?? [];
        group.push({ x, y });
        rockGroups.set(id, group);
      }
      if (tile.obstacle !== Obstacle.None) {
        counts.set(tile.obstacle, (counts.get(tile.obstacle) ?? 0) + 1);
      }
      if (tile.outdoorProp) {
        counts.set(tile.outdoorProp, (counts.get(tile.outdoorProp) ?? 0) + 1);
      }
    }
  }
  context.globalAlpha =
    hiddenItems.has(Obstacle.Rock) ? hiddenOpacity : 1;
  const objectStyle = getBiomeObjectStyle(mode);
  const rockFamily = rockFamilyForMode(mode);
  const rockAssets = options.tilesetProps?.rockFamilies[rockFamily];
  for (const [rockId, points] of rockGroups) {
    const firstRockPoint = points[0];
    const rockVariant = grid[firstRockPoint.y][firstRockPoint.x].propVariant ?? Math.abs(rockId);
    if (rockId < 0 && useImageProps && !options.customProps?.rock && rockAssets) {
      const largeRockAssets = [
        { width: 5, height: 4, variants: rockAssets.fiveByFour },
        { width: 4, height: 5, variants: rockAssets.fourByFive },
        { width: 4, height: 3, variants: rockAssets.fourByThree },
        { width: 3, height: 3, variants: rockAssets.threeByThree },
        { width: 2, height: 3, variants: rockAssets.twoByThree },
        { width: 2, height: 2, variants: rockAssets.twoByTwo },
        { width: 2, height: 1, variants: rockAssets.twoByOne },
        { width: 1, height: 2, variants: rockAssets.oneByTwo },
      ];
      const matchingRockAsset = largeRockAssets
        .map((asset) => ({
          ...asset,
          origin: completeRectangleOrigin(points, asset.width, asset.height),
        }))
        .find(({ origin, variants }) => origin && variants.length > 0);
      if (matchingRockAsset?.origin) {
        drawLpcProp(
          matchingRockAsset.variants[rockVariant % matchingRockAsset.variants.length],
          matchingRockAsset.origin.x,
          matchingRockAsset.origin.y,
          matchingRockAsset.width,
          matchingRockAsset.height,
          cellSize,
          context,
        );
        continue;
      }
    }
    const largeRockOrigin = completeTwoByTwoOrigin(points);
    if (largeRockOrigin) {
      if (useImageProps && options.customProps?.rock) {
        drawCustomProp(
          options.customProps.rock,
          largeRockOrigin.x,
          largeRockOrigin.y,
          2,
          cellSize,
          context,
        );
      } else if (useImageProps && options.tilesetProps) {
        const variants = rockAssets!.twoByTwo;
        drawLpcProp(
          variants[rockVariant % variants.length],
          largeRockOrigin.x,
          largeRockOrigin.y,
          2,
          2,
          cellSize,
          context,
        );
      } else {
        drawRockFormation(points, cellSize, mode, context);
      }
      continue;
    }
    const verticalPair = points.length === 2 &&
      points[0].x === points[1].x && Math.abs(points[0].y - points[1].y) === 1;
    if (verticalPair && useImageProps && !options.customProps?.rock && options.tilesetProps) {
      const top = points[0].y < points[1].y ? points[0] : points[1];
      const variants = rockAssets!.oneByTwo;
      drawLpcProp(
        variants[rockVariant % variants.length],
        top.x,
        top.y,
        1,
        2,
        cellSize,
        context,
      );
      continue;
    }
    const horizontalPair = points.length === 2 &&
      points[0].y === points[1].y && Math.abs(points[0].x - points[1].x) === 1;
    if (horizontalPair && useImageProps && !options.customProps?.rock && options.tilesetProps) {
      const left = points[0].x < points[1].x ? points[0] : points[1];
      const variants = rockAssets!.twoByOne;
      drawLpcProp(
        variants[rockVariant % variants.length],
        left.x,
        left.y,
        2,
        1,
        cellSize,
        context,
      );
      continue;
    }
    // Non-square scree groups retain the new loose, individual-rock rendering.
    for (const point of points) {
      if (useImageProps && options.customProps?.rock) {
        drawCustomProp(
          options.customProps.rock,
          point.x,
          point.y,
          1,
          cellSize,
          context,
        );
      } else if (useImageProps && options.tilesetProps) {
        const variants = rockAssets!.oneByOne;
        drawLpcProp(
          variants[rockVariant % variants.length],
          point.x,
          point.y,
          1,
          1,
          cellSize,
          context,
        );
      } else {
        drawRockFormation([point], cellSize, mode, context);
      }
    }
  }
  context.globalAlpha = 1;
  context.globalAlpha =
    hiddenItems.has(Obstacle.Building) ? hiddenOpacity : 1;
  for (const [id, points] of buildingGroups) {
    drawBuilding(
      points,
      id,
      cellSize,
      mode,
      context,
      useImageProps ? options.tilesetImage : undefined,
    );
  }
  for (const points of connectedPointGroups(manualBuildingPoints)) {
    const id = Math.min(...points.map(({ x, y }) =>
      grid[y][x].obstacleId ?? y * columns + x));
    drawBuilding(
      points,
      id,
      cellSize,
      mode,
      context,
      useImageProps ? options.tilesetImage : undefined,
    );
  }
  context.globalAlpha = 1;
  context.globalAlpha = hiddenItems.has(Obstacle.Tree) ? hiddenOpacity : 1;
  for (const points of treeGroups.values()) {
    const largeTreeOrigin = completeTwoByTwoOrigin(points);
    if (largeTreeOrigin) {
      if (useImageProps && options.customProps?.tree) {
        drawCustomProp(
          options.customProps.tree,
          largeTreeOrigin.x,
          largeTreeOrigin.y,
          2,
          cellSize,
          context,
        );
        continue;
      }
      if (useImageProps && options.tilesetProps) {
        drawTilesetProp(
          options.tilesetProps.tree2x2,
          largeTreeOrigin.x,
          largeTreeOrigin.y,
          2,
          cellSize,
          context,
          objectStyle.tree.light,
          .48,
        );
        continue;
      }
    }
    if (useImageProps && options.customProps?.tree) {
      for (const { x, y } of points) {
        drawCustomProp(
          options.customProps.tree,
          x,
          y,
          1,
          cellSize,
          context,
        );
      }
    } else if (useImageProps && options.tilesetProps) {
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

  if (!options.hideInteriorProps) {
    drawInteriorProps(
      grid,
      cellSize,
      mode,
      context,
      options.useTileset ? options.tilesetProps : undefined,
    );
  }

  drawOutdoorProps(
    grid,
    cellSize,
    hiddenItems,
    hiddenOpacity,
    context,
    options.useTileset ? options.tilesetProps : undefined,
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
      !options.hideInteriorProps,
    );
  }

  if (showGrid) {
    context.save();
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < columns; x += 1) {
        const tile = grid[y][x];
        context.globalAlpha = hiddenItems.has(tile.terrain) ? hiddenOpacity : 1;
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
    context.restore();
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
  const outdoorPropItems = Object.entries(OUTDOOR_PROP_RULES).map(([kind, rule]) => ({
    key: kind,
    label: rule.label,
    className: kind,
    color: "",
  })).filter(({ key }) => (counts.get(key) ?? 0) > 0);

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
    renderLegendGroup("Obstacles", obstacleItems) +
    renderLegendGroup("Props", outdoorPropItems);
  document.querySelector("#dimensions")!.textContent = `${columns} × ${rows} cells`;
}
