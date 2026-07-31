import type { Grid, LandscapeMode } from "../domain/map";
import { drawGrid, type TilesetPropImages } from "../rendering/canvas";

const WEBP_QUALITY = 0.95;

function encodeWebp(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob?.size) {
          reject(new Error("The browser could not encode this map as WebP."));
          return;
        }
        if (blob.type !== "image/webp") {
          reject(new Error("This browser does not support WebP export."));
          return;
        }
        resolve(blob);
      },
      "image/webp",
      WEBP_QUALITY,
    );
  });
}

function encodePng(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob?.size) resolve(blob);
      else reject(new Error("The browser could not encode the clipboard image."));
    }, "image/png");
  });
}

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

function mapFilename(
  grid: Grid,
  seed: string,
  extension: "png" | "webp",
  suffix = "",
) {
  const columns = grid[0]?.length ?? 0;
  const rows = grid.length;
  const safeSeed = seed.replace(/[^a-z0-9_-]+/gi, "-") || "terrain";
  return `terra-${safeSeed}-${columns}x${rows}${suffix}.${extension}`;
}

export async function downloadWebp(
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
  filenameSuffix = "",
) {
  const canvas = renderExportCanvas(
    grid,
    mode,
    cellSize,
    hiddenItems,
    showGrid,
    useTileset,
    tilesetImage,
    tilesetProps,
    stylizedLighting,
  );
  const blob = await encodeWebp(canvas);
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.download = mapFilename(grid, seed, "webp", filenameSuffix);
  link.href = objectUrl;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
}

export async function copyWebp(
  grid: Grid,
  mode: LandscapeMode,
  hiddenItems: ReadonlySet<string>,
  showGrid = true,
  useTileset = false,
  tilesetImage?: CanvasImageSource,
  tilesetProps?: TilesetPropImages,
  stylizedLighting = false,
  cellSize = 64,
) {
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
    throw new Error("This browser does not support copying images to the clipboard.");
  }
  const canvas = renderExportCanvas(
    grid,
    mode,
    cellSize,
    hiddenItems,
    showGrid,
    useTileset,
    tilesetImage,
    tilesetProps,
    stylizedLighting,
  );
  const supportsWebp = typeof ClipboardItem.supports === "function" &&
    ClipboardItem.supports("image/webp");
  const blob = supportsWebp ? await encodeWebp(canvas) : await encodePng(canvas);
  await navigator.clipboard.write([
    new ClipboardItem({ [blob.type]: blob }),
  ]);
  return supportsWebp ? "webp" : "png";
}
