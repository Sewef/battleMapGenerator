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
  Terrain.Cliff,
  Terrain.Void,
];

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
        maskContext.fillRect(
          x * cellSize,
          y * cellSize,
          cellSize,
          cellSize,
        );
      }
    }
  }
  return mask;
}

function drawTerrainLayers(
  grid: Grid,
  cellSize: number,
  mode: LandscapeMode,
  hiddenItems: ReadonlySet<string>,
  hiddenOpacity: number,
  width: number,
  height: number,
  context: CanvasRenderingContext2D,
) {
  const present = new Set<TerrainKind>();
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      const terrain = underlyingTerrain(grid, x, y);
      const style = getTerrainStyle(terrain, mode);
      present.add(terrain);
      context.globalAlpha = hiddenItems.has(terrain) ? hiddenOpacity : 1;
      context.fillStyle = style.color;
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
    const style = getTerrainStyle(terrain, mode);
    layerContext.fillStyle = style.color;
    layerContext.fillRect(0, 0, width, height);

    const gradient = layerContext.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "rgba(255,255,255,.09)");
    gradient.addColorStop(.48, "rgba(255,255,255,0)");
    gradient.addColorStop(1, "rgba(19,31,25,.10)");
    layerContext.fillStyle = gradient;
    layerContext.fillRect(0, 0, width, height);

    layerContext.globalCompositeOperation = "destination-in";
    const maskBlur = terrain === Terrain.Ravine
      ? Math.max(.75, cellSize * .035)
      : terrain === Terrain.Cliff
        ? Math.max(1, cellSize * .055)
        : Math.max(1.5, cellSize * .11);
    layerContext.filter = `blur(${maskBlur}px)`;
    layerContext.drawImage(mask, 0, 0);
    layerContext.filter = "none";
    layerContext.globalCompositeOperation = "source-over";

    context.globalAlpha = hiddenItems.has(terrain) ? hiddenOpacity : 1;
    context.drawImage(layer, 0, 0);
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
  for (const terrain of [Terrain.Cliff, Terrain.Ravine] as const) {
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
  const roadFootprint = new Path2D();
  for (const { x, y } of roadCells) {
    roadFootprint.rect(x * cellSize, y * cellSize, cellSize, cellSize);
  }

  context.save();
  context.globalAlpha = hiddenItems.has(Terrain.Road) ? hiddenOpacity : 1;
  context.shadowColor = "rgba(70, 58, 43, .25)";
  context.shadowBlur = Math.max(1, cellSize * .09);
  context.fillStyle = getTerrainStyle(Terrain.Road, mode).color;
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
  context.beginPath();
  for (const { x, y } of roadCells) {
    const left = x * cellSize;
    const top = y * cellSize;
    const right = left + cellSize;
    const bottom = top + cellSize;
    if (!roadKeys.has(`${x},${y - 1}`) && y > 0) {
      context.moveTo(left, top);
      context.lineTo(right, top);
    }
    if (!roadKeys.has(`${x + 1},${y}`) && x < grid[y].length - 1) {
      context.moveTo(right, top);
      context.lineTo(right, bottom);
    }
    if (!roadKeys.has(`${x},${y + 1}`) && y < grid.length - 1) {
      context.moveTo(right, bottom);
      context.lineTo(left, bottom);
    }
    if (!roadKeys.has(`${x - 1},${y}`) && x > 0) {
      context.moveTo(left, bottom);
      context.lineTo(left, top);
    }
  }
  context.stroke();

  if (bridgeCells.length) {
    const bridgeKeys = new Set(
      bridgeCells.map(({ x, y }) => `${x},${y}`),
    );
    const bridgeFootprint = new Path2D();
    for (const { x, y } of bridgeCells) {
      bridgeFootprint.rect(x * cellSize, y * cellSize, cellSize, cellSize);
    }
    context.globalAlpha = hiddenItems.has(Terrain.Bridge) ? hiddenOpacity : 1;
    context.fillStyle = getTerrainStyle(Terrain.Bridge, mode).color;
    context.fill(bridgeFootprint);
    context.strokeStyle = "rgba(61, 43, 30, .48)";
    context.lineWidth = Math.max(1, cellSize * .06);
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
  if (tile.terrain === Terrain.Lava) {
    context.strokeStyle = "rgba(255, 207, 96, .72)";
    context.lineWidth = Math.max(1, cellSize * .08);
    context.beginPath();
    context.moveTo(x * cellSize + cellSize * .12, y * cellSize + cellSize * .62);
    context.bezierCurveTo(
      x * cellSize + cellSize * .35, y * cellSize + cellSize * .35,
      x * cellSize + cellSize * .62, y * cellSize + cellSize * .76,
      x * cellSize + cellSize * .88, y * cellSize + cellSize * .42,
    );
    context.stroke();
    context.lineWidth = 1;
  } else if (tile.terrain === Terrain.Water) {
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
  drawShorelines(grid, cellSize, hiddenItems, hiddenOpacity, context);
  drawRoadNetwork(grid, cellSize, mode, hiddenItems, hiddenOpacity, context);

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
