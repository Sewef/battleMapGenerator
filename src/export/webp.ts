import type { Grid, LandscapeMode } from "../domain/map";
import { drawGrid, type TilesetPropImages } from "../rendering/canvas";

const WEBP_QUALITY = 0.95;

export function renderExportCanvas(
  grid: Grid,
  mode: LandscapeMode,
  cellSize: number,
  hiddenItems: ReadonlySet<string>,
  showGrid: boolean,
  useTileset: boolean,
  tilesetImage: CanvasImageSource | undefined,
  tilesetProps?: TilesetPropImages,
  stylizedLighting = false,
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
    showGrid,
    useTileset,
    tilesetImage,
    tilesetProps,
    stylizedLighting,
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
  showGrid = true,
  useTileset = false,
  tilesetImage?: CanvasImageSource,
  tilesetProps?: TilesetPropImages,
  stylizedLighting = false,
  cellSize = 64,
) {
  const link = document.createElement("a");
  link.download = mapFilename(grid, seed, "webp");
  link.href = renderExportCanvas(
    grid,
    mode,
    cellSize,
    hiddenItems,
    showGrid,
    useTileset,
    tilesetImage,
    tilesetProps,
    stylizedLighting,
  ).toDataURL(
    "image/webp",
    WEBP_QUALITY,
  );
  link.click();
}
