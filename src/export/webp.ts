import type { Grid, LandscapeMode } from "../domain/map";
import { drawGrid } from "../rendering/canvas";

const WEBP_QUALITY = 0.95;
const MAX_EXPORT_PIXELS = 80_000_000;

function renderExportCanvas(grid: Grid, mode: LandscapeMode, cellSize: number) {
  const canvas = document.createElement("canvas");
  drawGrid(grid, {
    targetCanvas: canvas,
    mode,
    cellSize,
    pixelRatio: 1,
    updateInterface: false,
  });
  return canvas;
}

export function downloadWebp(
  grid: Grid,
  mode: LandscapeMode,
  seed: string,
  cellSize = 64,
) {
  const link = document.createElement("a");
  link.download = `terra-${seed || "terrain"}.webp`;
  link.href = renderExportCanvas(grid, mode, cellSize).toDataURL(
    "image/webp",
    WEBP_QUALITY,
  );
  link.click();
}

export async function copyMapForOwlbear(
  grid: Grid,
  mode: LandscapeMode,
  dpi: number,
) {
  const columns = grid[0]?.length ?? 0;
  const rows = grid.length;
  if (columns * dpi * rows * dpi > MAX_EXPORT_PIXELS) {
    throw new Error("Export is too large for the browser");
  }
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
    throw new Error("Image clipboard is not supported");
  }

  const canvas = renderExportCanvas(grid, mode, dpi);
  // PNG is the interoperable image format mandated by the Async Clipboard API.
  // Browsers may export WebP files while still rejecting image/webp ClipboardItems.
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) resolve(result);
      else reject(new Error("Unable to create clipboard image"));
    }, "image/png");
  });
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}
