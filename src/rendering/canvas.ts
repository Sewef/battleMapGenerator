import {
  Obstacle,
  Terrain,
  type Grid,
  type LandscapeMode,
} from "../domain/map";
import { getTerrainStyle } from "./palettes";

export interface RenderOptions {
  targetCanvas: HTMLCanvasElement;
  mode: LandscapeMode;
  cellSize?: number;
  pixelRatio?: number;
  updateInterface?: boolean;
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
  x: number,
  y: number,
  size: number,
  grid: Grid,
  context: CanvasRenderingContext2D,
) {
  const id = grid[y][x].obstacleId;
  context.fillStyle = (id ?? 0) % 2 === 0 ? "#a85d43" : "#bb6e4b";
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  context.strokeStyle = "rgba(73, 44, 35, .55)";
  context.lineWidth = 1;
  if (grid[y - 1]?.[x].obstacleId !== id) {
    context.beginPath();
    context.moveTo(x * size, y * size + 1);
    context.lineTo((x + 1) * size, y * size + 1);
    context.stroke();
  }
  if (grid[y + 1]?.[x].obstacleId !== id) {
    context.beginPath();
    context.moveTo(x * size, (y + 1) * size - 1);
    context.lineTo((x + 1) * size, (y + 1) * size - 1);
    context.stroke();
  }
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
  } else if (tile.terrain === Terrain.Rock) {
    context.fillStyle = "rgba(238, 233, 216, .34)";
    context.beginPath();
    context.moveTo(x * cellSize + cellSize * .18, y * cellSize + cellSize * .72);
    context.lineTo(x * cellSize + cellSize * .32, y * cellSize + cellSize * .3);
    context.lineTo(x * cellSize + cellSize * .68, y * cellSize + cellSize * .2);
    context.lineTo(x * cellSize + cellSize * .84, y * cellSize + cellSize * .67);
    context.closePath();
    context.fill();
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
  const context = canvas.getContext("2d")!;
  const rows = grid.length;
  const columns = grid[0].length;
  const cellSize = options.cellSize ??
    Math.max(12, Math.min(28, Math.floor(850 / columns)));
  const pixelRatio = options.pixelRatio ??
    Math.min(window.devicePixelRatio || 1, 2);
  const updateInterface = options.updateInterface ?? true;
  const width = columns * cellSize;
  const height = rows * cellSize;

  canvas.width = width * pixelRatio;
  canvas.height = height * pixelRatio;
  if (updateInterface) {
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

  const counts = new Map<string, number>();
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const tile = grid[y][x];
      const style = getTerrainStyle(tile.terrain, mode);
      context.fillStyle = (x + y * 3) % 4 === 0 ? style.alt : style.color;
      context.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
      drawTerrainDetail(grid, x, y, cellSize, context);
      context.strokeStyle = "rgba(239, 235, 218, 0.14)";
      context.lineWidth = 1;
      context.strokeRect(x * cellSize + .5, y * cellSize + .5, cellSize - 1, cellSize - 1);
      counts.set(tile.terrain, (counts.get(tile.terrain) ?? 0) + 1);
    }
  }

  const treeGroups = new Map<number, Array<{ x: number; y: number }>>();
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
        drawBuilding(x, y, cellSize, grid, context);
      }
      if (tile.obstacle !== Obstacle.None) {
        counts.set(tile.obstacle, (counts.get(tile.obstacle) ?? 0) + 1);
      }
    }
  }
  for (const points of treeGroups.values()) drawTree(points, cellSize, context);

  if (!updateInterface) return;
  const legendItems = [
    ...Object.values(Terrain).map((kind) => ({
      key: kind,
      label: getTerrainStyle(kind, mode).label,
      className: kind,
      color: getTerrainStyle(kind, mode).color,
    })),
    { key: Obstacle.Tree, label: "Tree · blocks sight", className: "tree", color: "" },
    { key: Obstacle.Building, label: "Building · blocks sight", className: "building", color: "" },
  ].filter(({ key }) => (counts.get(key) ?? 0) > 0);

  document.querySelector("#legend")!.innerHTML = legendItems.map(
    ({ key, label, className, color }) =>
      `<span><i class="swatch ${className}"${color ? ` style="background:${color}"` : ""}></i>${label}<small>${counts.get(key)}</small></span>`,
  ).join("");
  document.querySelector("#dimensions")!.textContent = `${columns} × ${rows} cells`;
}
