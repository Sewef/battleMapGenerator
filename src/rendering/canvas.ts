import {
  Obstacle,
  Terrain,
  type Grid,
  type LandscapeMode,
  type TerrainKind,
} from "../domain/map";
import { getTerrainStyle } from "./palettes";

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

const sandyTilesetModes = new Set<LandscapeMode>([
  "desert-canyon",
  "badlands",
]);

const mountainousTilesetModes = new Set<LandscapeMode>([
  "mountain-pass",
  "highlands",
  "sewer",
  "underground",
  "volcanic",
]);

function tilesetCoordinate(
  terrain: TerrainKind,
  mode: LandscapeMode,
): readonly [number, number] | undefined {
  const sandy = sandyTilesetModes.has(mode);
  const mountainous = mountainousTilesetModes.has(mode);
  if (terrain === Terrain.Ground) {
    return mountainous ? [0, 2] : sandy ? [0, 1] : [0, 0];
  }
  if (terrain === Terrain.Difficult) {
    return mountainous ? [1, 2] : sandy ? [1, 1] : [1, 0];
  }
  if (terrain === Terrain.Road) {
    return mountainous ? [4, 0] : [3, 0];
  }
  if (terrain === Terrain.Beach) return [2, 0];
  if (terrain === Terrain.Water) return [0, 3];
  if (terrain === Terrain.Lava) return [0, 4];
  if (terrain === Terrain.Cliff) return [3, 1];
  if (terrain === Terrain.Bridge) return [5, 0];
  return undefined;
}

function createTilesetTilePattern(
  image: CanvasImageSource,
  coordinate: readonly [number, number],
  context: CanvasRenderingContext2D,
  cellSize: number,
  quarterTurns = 0,
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
    );
    if (pattern) patterns.set(terrain, pattern);
  }
  return patterns;
}

function underlyingTerrain(grid: Grid, x: number, y: number): TerrainKind {
  const terrain = grid[y][x].terrain;
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
) {
  const isCliff = (cellX: number, cellY: number) =>
    outsideGrid(grid, cellX, cellY) ||
    grid[cellY]?.[cellX]?.terrain === Terrain.Cliff;
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
  effect.width = context.canvas.width;
  effect.height = context.canvas.height;
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
  effect.width = context.canvas.width;
  effect.height = context.canvas.height;
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
        : "rgba(216, 235, 228, .22)";
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
  const effect = document.createElement("canvas");
  effect.width = context.canvas.width;
  effect.height = context.canvas.height;
  const effectContext = effect.getContext("2d")!;
  const edgePath = new Path2D();
  const segmentCount = 6;
  const isLava = (x: number, y: number) =>
    outsideGrid(grid, x, y) ||
    (
      grid[y]?.[x] !== undefined &&
      underlyingTerrain(grid, x, y) === Terrain.Lava
    );

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
      if (!isLava(x, y - 1)) addEdge(x, y, 0);
      if (!isLava(x + 1, y)) addEdge(x, y, 1);
      if (!isLava(x, y + 1)) addEdge(x, y, 2);
      if (!isLava(x - 1, y)) addEdge(x, y, 3);
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

  const mask = createTerrainMask(
    grid,
    Terrain.Lava,
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
    context.drawImage(layer, 0, 0);
    if (terrain === Terrain.Cliff) {
      const depth = Math.max(3, cellSize * .18);
      const blur = Math.max(1.5, cellSize * .065);
      const color = "rgba(25, 27, 24, .38)";
      context.drawImage(createMaskEdge(mask, depth, 0, blur, color), 0, 0);
      context.drawImage(createMaskEdge(mask, -depth, 0, blur, color), 0, 0);
      context.drawImage(createMaskEdge(mask, 0, -depth, blur, color), 0, 0);
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

function createMaskEdge(
  mask: HTMLCanvasElement,
  offsetX: number,
  offsetY: number,
  blur: number,
  color: string,
) {
  const edge = document.createElement("canvas");
  edge.width = mask.width;
  edge.height = mask.height;
  const edgeContext = edge.getContext("2d")!;
  edgeContext.drawImage(mask, 0, 0);
  edgeContext.globalCompositeOperation = "destination-out";
  edgeContext.filter = `blur(${blur}px)`;
  edgeContext.drawImage(mask, offsetX, offsetY);
  edgeContext.filter = "none";
  edgeContext.globalCompositeOperation = "source-in";
  edgeContext.fillStyle = color;
  edgeContext.fillRect(0, 0, edge.width, edge.height);
  return edge;
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
      if (roadTerrains.has(grid[y][x].terrain)) roadCells.push({ x, y });
      if (grid[y][x].terrain === Terrain.Bridge) bridgeCells.push({ x, y });
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
    if (grid[y][x].terrain === Terrain.Bridge) {
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

  context.strokeStyle = "rgba(70, 58, 43, .34)";
  context.lineWidth = Math.max(1, cellSize * .055);
  context.stroke(roadEdges);

  if (bridgeCells.length) {
    const bridgeKeys = new Set(
      bridgeCells.map(({ x, y }) => `${x},${y}`),
    );
    const bridgeAxis = (x: number, y: number) => {
      const bridgeHorizontal =
        Number(bridgeKeys.has(`${x - 1},${y}`)) +
        Number(bridgeKeys.has(`${x + 1},${y}`));
      const bridgeVertical =
        Number(bridgeKeys.has(`${x},${y - 1}`)) +
        Number(bridgeKeys.has(`${x},${y + 1}`));
      if (bridgeHorizontal !== bridgeVertical) {
        return bridgeHorizontal > bridgeVertical ? "horizontal" : "vertical";
      }
      const roadHorizontal =
        Number(roadKeys.has(`${x - 1},${y}`)) +
        Number(roadKeys.has(`${x + 1},${y}`));
      const roadVertical =
        Number(roadKeys.has(`${x},${y - 1}`)) +
        Number(roadKeys.has(`${x},${y + 1}`));
      return roadVertical > roadHorizontal ? "vertical" : "horizontal";
    };

    const bridgeFootprint = new Path2D();
    const horizontalBridgeFootprint = new Path2D();
    const verticalBridgeFootprint = new Path2D();
    const bridgeShadow = new Path2D();
    const bridgeLightEdge = new Path2D();
    const bridgeDarkEdge = new Path2D();
    const bridgeRampSeams = new Path2D();
    const bridgeRampLips = new Path2D();
    for (const { x, y } of bridgeCells) {
      const left = x * cellSize;
      const top = y * cellSize;
      const right = left + cellSize;
      const bottom = top + cellSize;
      const axis = bridgeAxis(x, y);
      const shadowOffset = cellSize * .12;
      bridgeFootprint.rect(left, top, cellSize, cellSize);
      if (axis === "horizontal") {
        horizontalBridgeFootprint.rect(left, top, cellSize, cellSize);
      } else {
        verticalBridgeFootprint.rect(left, top, cellSize, cellSize);
      }
      bridgeShadow.rect(
        left + (axis === "vertical" ? shadowOffset : 0),
        top + (axis === "horizontal" ? shadowOffset : 0),
        cellSize,
        cellSize,
      );
      if (axis === "horizontal") {
        if (!bridgeKeys.has(`${x},${y - 1}`)) {
          bridgeLightEdge.moveTo(left, top);
          bridgeLightEdge.lineTo(right, top);
        }
        if (!bridgeKeys.has(`${x},${y + 1}`)) {
          bridgeDarkEdge.moveTo(left, bottom);
          bridgeDarkEdge.lineTo(right, bottom);
        }
        if (
          !bridgeKeys.has(`${x - 1},${y}`) &&
          grid[y]?.[x - 1]?.terrain === Terrain.Road
        ) {
          bridgeRampSeams.moveTo(left, top);
          bridgeRampSeams.lineTo(left, bottom);
          bridgeRampLips.moveTo(left + cellSize * .1, top);
          bridgeRampLips.lineTo(left + cellSize * .1, bottom);
        }
        if (
          !bridgeKeys.has(`${x + 1},${y}`) &&
          grid[y]?.[x + 1]?.terrain === Terrain.Road
        ) {
          bridgeRampSeams.moveTo(right, top);
          bridgeRampSeams.lineTo(right, bottom);
          bridgeRampLips.moveTo(right - cellSize * .1, top);
          bridgeRampLips.lineTo(right - cellSize * .1, bottom);
        }
      } else {
        if (!bridgeKeys.has(`${x - 1},${y}`)) {
          bridgeLightEdge.moveTo(left, bottom);
          bridgeLightEdge.lineTo(left, top);
        }
        if (!bridgeKeys.has(`${x + 1},${y}`)) {
          bridgeDarkEdge.moveTo(right, top);
          bridgeDarkEdge.lineTo(right, bottom);
        }
        if (
          !bridgeKeys.has(`${x},${y - 1}`) &&
          grid[y - 1]?.[x]?.terrain === Terrain.Road
        ) {
          bridgeRampSeams.moveTo(left, top);
          bridgeRampSeams.lineTo(right, top);
          bridgeRampLips.moveTo(left, top + cellSize * .1);
          bridgeRampLips.lineTo(right, top + cellSize * .1);
        }
        if (
          !bridgeKeys.has(`${x},${y + 1}`) &&
          grid[y + 1]?.[x]?.terrain === Terrain.Road
        ) {
          bridgeRampSeams.moveTo(left, bottom);
          bridgeRampSeams.lineTo(right, bottom);
          bridgeRampLips.moveTo(left, bottom - cellSize * .1);
          bridgeRampLips.lineTo(right, bottom - cellSize * .1);
        }
      }
    }
    context.globalAlpha = hiddenItems.has(Terrain.Bridge) ? hiddenOpacity : 1;
    context.save();
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
    context.strokeStyle = "rgba(48, 34, 25, .62)";
    context.lineWidth = Math.max(2, cellSize * .085);
    context.stroke(bridgeRampSeams);
    context.strokeStyle = "rgba(246, 224, 181, .52)";
    context.lineWidth = Math.max(1, cellSize * .04);
    context.stroke(bridgeRampLips);
    context.strokeStyle = "rgba(61, 43, 30, .48)";
    context.lineWidth = Math.max(1.5, cellSize * .075);
    context.beginPath();
    for (const { x, y } of bridgeCells) {
      const left = x * cellSize;
      const top = y * cellSize;
      const right = left + cellSize;
      const bottom = top + cellSize;
      if (!bridgeKeys.has(`${x},${y - 1}`)) {
        context.moveTo(left, top);
        context.lineTo(right, top);
      }
      if (!bridgeKeys.has(`${x + 1},${y}`)) {
        context.moveTo(right, top);
        context.lineTo(right, bottom);
      }
      if (!bridgeKeys.has(`${x},${y + 1}`)) {
        context.moveTo(right, bottom);
        context.lineTo(left, bottom);
      }
      if (!bridgeKeys.has(`${x - 1},${y}`)) {
        context.moveTo(left, bottom);
        context.lineTo(left, top);
      }
    }
    context.stroke();
  }
  context.restore();
}

function drawShorelines(
  grid: Grid,
  cellSize: number,
  hiddenItems: ReadonlySet<string>,
  hiddenOpacity: number,
  context: CanvasRenderingContext2D,
) {
  context.save();
  context.globalAlpha = hiddenItems.has(Terrain.Water) ? hiddenOpacity : 1;
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
  context.strokeStyle = "rgba(38, 74, 75, .26)";
  context.lineWidth = Math.max(2, cellSize * .13);
  context.stroke();
  context.strokeStyle = "rgba(235, 242, 224, .48)";
  context.lineWidth = Math.max(1, cellSize * .035);
  context.stroke();
  context.restore();
}

function drawTree(
  points: Array<{ x: number; y: number }>,
  size: number,
  context: CanvasRenderingContext2D,
) {
  const minimumX = Math.min(...points.map(({ x }) => x));
  const maximumX = Math.max(...points.map(({ x }) => x));
  const minimumY = Math.min(...points.map(({ y }) => y));
  const maximumY = Math.max(...points.map(({ y }) => y));
  const centerX = (minimumX + maximumX + 1) * size / 2;
  const centerY = (minimumY + maximumY + 1) * size / 2;
  const radiusX = (maximumX - minimumX + 1) * size * .42;
  const radiusY = (maximumY - minimumY + 1) * size * .42;
  context.fillStyle = "#344f3e";
  context.beginPath();
  context.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#5e7855";
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
  context.fillStyle = "#d7d3b6";
  context.beginPath();
  context.arc(centerX, centerY, Math.max(1.2, size * .06), 0, Math.PI * 2);
  context.fill();
}

function drawBuilding(
  points: Array<{ x: number; y: number }>,
  id: number,
  size: number,
  context: CanvasRenderingContext2D,
) {
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
  context.shadowColor = "rgba(39, 31, 25, .28)";
  context.shadowBlur = Math.max(2, size * .12);
  context.shadowOffsetY = Math.max(1, size * .08);
  context.fillStyle = id % 2 === 0 ? "#a85d43" : "#bb6e4b";
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

  context.strokeStyle = "rgba(67, 40, 32, .72)";
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
) {
  const colors = mode === "volcanic"
    ? { fill: "#24282a", highlight: "#8f7d6b", stroke: "#d0a45f" }
    : mode === "underground"
      ? { fill: "#4a4742", highlight: "#bbb2a2", stroke: "#ded4c0" }
      : { fill: "#555a59", highlight: "#a9aaa2", stroke: "#343837" };
  context.fillStyle = "rgba(20, 22, 22, .3)";
  context.beginPath();
  context.ellipse(
    x * size + size * .52,
    y * size + size * .76,
    size * .4,
    size * .14,
    0,
    0,
    Math.PI * 2,
  );
  context.fill();
  context.fillStyle = colors.fill;
  context.strokeStyle = colors.stroke;
  context.lineWidth = Math.max(1.5, size * .045);
  context.beginPath();
  context.moveTo(x * size + size * .1, y * size + size * .76);
  context.lineTo(x * size + size * .26, y * size + size * .24);
  context.lineTo(x * size + size * .65, y * size + size * .11);
  context.lineTo(x * size + size * .91, y * size + size * .69);
  context.lineTo(x * size + size * .64, y * size + size * .88);
  context.closePath();
  context.fill();
  context.stroke();
  context.fillStyle = colors.highlight;
  context.beginPath();
  context.moveTo(x * size + size * .26, y * size + size * .24);
  context.lineTo(x * size + size * .65, y * size + size * .11);
  context.lineTo(x * size + size * .51, y * size + size * .47);
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
  if (tile.terrain === Terrain.Water) {
    context.strokeStyle = "rgba(223, 239, 229, .28)";
    context.beginPath();
    context.moveTo(x * cellSize + cellSize * .18, y * cellSize + cellSize * .55);
    context.lineTo(x * cellSize + cellSize * .78, y * cellSize + cellSize * .55);
    context.stroke();
  } else if (tile.terrain === Terrain.Ice) {
    context.strokeStyle = "rgba(239, 250, 248, .55)";
    context.lineWidth = Math.max(1, cellSize * .025);
    context.beginPath();
    context.moveTo(x * cellSize + cellSize * .2, y * cellSize + cellSize * .25);
    context.lineTo(x * cellSize + cellSize * .48, y * cellSize + cellSize * .52);
    context.lineTo(x * cellSize + cellSize * .38, y * cellSize + cellSize * .78);
    context.moveTo(x * cellSize + cellSize * .48, y * cellSize + cellSize * .52);
    context.lineTo(x * cellSize + cellSize * .78, y * cellSize + cellSize * .38);
    context.stroke();
  } else if (tile.terrain === Terrain.Beach) {
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
  drawLavaRockEdges(
    grid,
    cellSize,
    hiddenItems.has(Terrain.Lava) ? hiddenOpacity : 1,
    context,
  );
  drawShorelines(grid, cellSize, hiddenItems, hiddenOpacity, context);
  drawRoadNetwork(
    grid,
    cellSize,
    mode,
    hiddenItems,
    hiddenOpacity,
    options.useTileset ? options.tilesetImage : undefined,
    context,
  );

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const tile = grid[y][x];
      context.globalAlpha = hiddenItems.has(tile.terrain) ? hiddenOpacity : 1;
      if (
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
        context.globalAlpha =
          hiddenItems.has(Obstacle.Rock) ? hiddenOpacity : 1;
        drawRock(x, y, cellSize, mode, context);
        context.globalAlpha = 1;
      }
      if (tile.obstacle !== Obstacle.None) {
        counts.set(tile.obstacle, (counts.get(tile.obstacle) ?? 0) + 1);
      }
    }
  }
  context.globalAlpha =
    hiddenItems.has(Obstacle.Building) ? hiddenOpacity : 1;
  for (const [id, points] of buildingGroups) {
    drawBuilding(points, id, cellSize, context);
  }
  context.globalAlpha = 1;
  context.globalAlpha = hiddenItems.has(Obstacle.Tree) ? hiddenOpacity : 1;
  for (const points of treeGroups.values()) drawTree(points, cellSize, context);
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
