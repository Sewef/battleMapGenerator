import type { Grid, LandscapeMode } from "../domain/map";
import { drawGrid } from "../rendering/canvas";

const WEBP_QUALITY = 0.95;

function renderExportCanvas(
  grid: Grid,
  mode: LandscapeMode,
  cellSize: number,
  hiddenItems: ReadonlySet<string>,
) {
  const canvas = document.createElement("canvas");
  drawGrid(grid, {
    targetCanvas: canvas,
    mode,
    cellSize,
    pixelRatio: 1,
    updateInterface: false,
    hiddenItems,
    hiddenOpacity: 0,
    transparentBackground: true,
  });
  return canvas;
}

function mapFilename(grid: Grid, seed: string, extension: "png" | "webp") {
  const columns = grid[0]?.length ?? 0;
  const rows = grid.length;
  const safeSeed = seed.replace(/[^a-z0-9_-]+/gi, "-") || "terrain";
  return `terra-${safeSeed}-${columns}x${rows}.${extension}`;
}

export function downloadWebp(
  grid: Grid,
  mode: LandscapeMode,
  seed: string,
  hiddenItems: ReadonlySet<string>,
  cellSize = 64,
) {
  const link = document.createElement("a");
  link.download = mapFilename(grid, seed, "webp");
  link.href = renderExportCanvas(grid, mode, cellSize, hiddenItems).toDataURL(
    "image/webp",
    WEBP_QUALITY,
  );
  link.click();
}
