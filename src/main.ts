import "./style.css";
import {
  generateTerrain,
  Obstacle,
  PRESETS,
  type Grid,
  type Preset,
} from "./generator";
import { drawGrid, type TilesetPropImages } from "./rendering/canvas";
import { PARAMETER_FIELDS, renderApp } from "./ui/template";
import { copyWebp, downloadWebp } from "./export/webp";
import {
  createOwlbearSceneJson,
  downloadOwlbearJson,
  inspectOwlbearProp,
} from "./export/owlbear";

const randomSeed = () =>
  `${["moor", "mist", "oak", "flint", "dawn"][Math.floor(Math.random() * 5)]}-${Math.floor(1000 + Math.random() * 9000)}`;

renderApp(document.querySelector<HTMLDivElement>("#app")!);

const previewCanvas = document.querySelector<HTMLCanvasElement>("#map")!;
const seedInput = document.querySelector<HTMLInputElement>("#seed")!;
const widthInput = document.querySelector<HTMLInputElement>("#width")!;
const heightInput = document.querySelector<HTMLInputElement>("#height")!;
const previewGridInput =
  document.querySelector<HTMLInputElement>("#preview-grid")!;
const showGridInput = document.querySelector<HTMLInputElement>("#show-grid")!;
const useTilesetInput =
  document.querySelector<HTMLInputElement>("#use-tileset")!;
const stylizedLightingInput =
  document.querySelector<HTMLInputElement>("#stylized-lighting")!;
const owlbearTreeUrlInput =
  document.querySelector<HTMLInputElement>("#owlbear-tree-url")!;
const owlbearRockUrlInput =
  document.querySelector<HTMLInputElement>("#owlbear-rock-url")!;
const owlbearTreePreview =
  document.querySelector<HTMLElement>("#owlbear-tree-preview")!;
const owlbearRockPreview =
  document.querySelector<HTMLElement>("#owlbear-rock-preview")!;
const owlbearStatus =
  document.querySelector<HTMLParagraphElement>("#owlbear-status")!;
const webpStatus =
  document.querySelector<HTMLParagraphElement>("#webp-status")!;
const webpDownloadButton =
  document.querySelector<HTMLButtonElement>("#download")!;
const webpCopyButton =
  document.querySelector<HTMLButtonElement>("#copy-webp")!;
const owlbearCopyButton =
  document.querySelector<HTMLButtonElement>("#copy-owlbear")!;
const owlbearDownloadButton =
  document.querySelector<HTMLButtonElement>("#download-owlbear")!;
const owlbearBackgroundButton =
  document.querySelector<HTMLButtonElement>("#download-owlbear-background")!;
const tilesetImage = new Image();
tilesetImage.src = "/assets/tilesets/terrain.png";
const tilesetReady = () => tilesetImage.naturalWidth > 0;
const tilesetProps = {
  tree1x1: new Image(),
  tree2x2: new Image(),
  rock1x1: new Image(),
  rock2x2: new Image(),
} satisfies TilesetPropImages;
tilesetProps.tree1x1.src = "/assets/tilesets/tree_1x1.png";
tilesetProps.tree2x2.src = "/assets/tilesets/tree_2x2.png";
tilesetProps.rock1x1.src = "/assets/tilesets/rock_1x1.png";
tilesetProps.rock2x2.src = "/assets/tilesets/rock_2x2.png";
const tilesetPropsReady = () =>
  Object.values(tilesetProps).every((image) => image.naturalWidth > 0);
const inputs = Object.fromEntries(
  PARAMETER_FIELDS.map(({ id }) => [
    id,
    document.querySelector<HTMLInputElement>(`#${id}`)!,
  ]),
) as Record<(typeof PARAMETER_FIELDS)[number]["id"], HTMLInputElement>;

let activePreset = PRESETS[0];
let currentGrid: Grid = [];
let mapRevision = 0;
const hiddenLegendItems = new Set<string>();
let owlbearExportCache: {
  key: string;
  scene: Awaited<ReturnType<typeof createOwlbearSceneJson>>;
} | undefined;

function updateLabels() {
  document.querySelector("#width-value")!.textContent = widthInput.value;
  document.querySelector("#height-value")!.textContent = heightInput.value;
  for (const field of PARAMETER_FIELDS) {
    document.querySelector(`#${field.id}-value`)!.textContent =
      field.percent ? `${inputs[field.id].value}%` : inputs[field.id].value;
  }
}

function applyPreset(preset: Preset, useNewSeed = true) {
  activePreset = preset;
  widthInput.value = String(preset.width);
  heightInput.value = String(preset.height);
  for (const field of PARAMETER_FIELDS) {
    const value = preset[field.key];
    inputs[field.id].value = String(field.percent ? Number(value) * 100 : value);
  }
  if (useNewSeed || !seedInput.value) seedInput.value = randomSeed();
  // seedInput.value = "oak-2889";
  document.querySelectorAll(".preset-card").forEach((card) => {
    card.classList.toggle(
      "active",
      (card as HTMLElement).dataset.preset === preset.id,
    );
  });
  updateLabels();
}

function renderMap(grid: Grid, targetCanvas = previewCanvas, cellSize?: number) {
  drawGrid(grid, {
    targetCanvas,
    mode: activePreset.mode,
    cellSize,
    pixelRatio: targetCanvas === previewCanvas ? undefined : 1,
    updateInterface: targetCanvas === previewCanvas,
    hiddenItems: hiddenLegendItems,
    showGrid: previewGridInput.checked,
    useTileset: useTilesetInput.checked && tilesetReady(),
    tilesetImage,
    tilesetProps: tilesetPropsReady() ? tilesetProps : undefined,
    stylizedLighting: stylizedLightingInput.checked,
  });
}

function generate() {
  updateLabels();
  const seed = seedInput.value.trim() || randomSeed();
  seedInput.value = seed;
  currentGrid = generateTerrain({
    width: Number(widthInput.value),
    height: Number(heightInput.value),
    seed,
    scale: activePreset.scale,
    mode: activePreset.mode,
    waterWeight: Number(inputs.water.value) / 100,
    difficultWeight: Number(inputs.difficult.value) / 100,
    reliefWeight: Number(inputs.relief.value) / 100,
    rockRatio: Number(inputs.rocks.value) / 100,
    treeRatio: Number(inputs.trees.value) / 100,
    buildingCount: Number(inputs.buildings.value),
  });
  mapRevision += 1;
  renderMap(currentGrid);
}

document.querySelectorAll<HTMLButtonElement>(".preset-card").forEach((button) => {
  button.addEventListener("click", () => {
    const preset = PRESETS.find(({ id }) => id === button.dataset.preset);
    if (preset) {
      applyPreset(preset);
      generate();
    }
  });
});
document.querySelectorAll<HTMLButtonElement>("[data-preset-group]").forEach((button) => {
  button.addEventListener("click", () => {
    const group = button.closest<HTMLElement>(".preset-group");
    const open = !group?.classList.contains("is-open");
    group?.classList.toggle("is-open", open);
    button.setAttribute("aria-expanded", String(open));
  });
});

document.querySelector("#generate")!.addEventListener("click", generate);
document.querySelector("#randomize")!.addEventListener("click", () => {
  seedInput.value = randomSeed();
  generate();
});
document.querySelector("#reset")!.addEventListener("click", () => {
  applyPreset(activePreset);
  generate();
});
async function runWebpExport(action: "copy" | "download") {
  const activeButton = action === "copy" ? webpCopyButton : webpDownloadButton;
  const previousLabel = activeButton.textContent;
  webpCopyButton.disabled = true;
  webpDownloadButton.disabled = true;
  activeButton.textContent = "Encoding…";
  webpStatus.classList.remove("is-error");
  webpStatus.textContent = "Rendering and encoding the WebP…";

  // Let the busy state paint before rendering a potentially large map.
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  try {
    const commonArguments = [
      currentGrid,
      activePreset.mode,
      hiddenLegendItems,
      showGridInput.checked,
      useTilesetInput.checked && tilesetReady(),
      tilesetImage,
      tilesetPropsReady() ? tilesetProps : undefined,
      stylizedLightingInput.checked,
    ] as const;
    if (action === "copy") {
      const clipboardFormat = await copyWebp(...commonArguments);
      webpStatus.textContent = clipboardFormat === "webp"
        ? "WebP copied to the clipboard."
        : "Map copied to the clipboard (PNG compatibility format).";
    } else {
      await downloadWebp(
        currentGrid,
        activePreset.mode,
        seedInput.value.trim(),
        hiddenLegendItems,
        showGridInput.checked,
        useTilesetInput.checked && tilesetReady(),
        tilesetImage,
        tilesetPropsReady() ? tilesetProps : undefined,
        stylizedLightingInput.checked,
      );
      webpStatus.textContent = "WebP ready. The download has started.";
    }
  } catch (error) {
    webpStatus.classList.add("is-error");
    webpStatus.textContent = error instanceof Error
      ? `Export failed: ${error.message}`
      : "WebP export failed.";
  } finally {
    webpCopyButton.disabled = false;
    webpDownloadButton.disabled = false;
    activeButton.textContent = previousLabel;
  }
}
webpCopyButton.addEventListener("click", () => {
  void runWebpExport("copy");
});
webpDownloadButton.addEventListener("click", () => {
  void runWebpExport("download");
});
async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("The browser refused clipboard access.");
}

function owlbearExportKey() {
  return JSON.stringify({
    mapRevision,
    seed: seedInput.value.trim(),
    hiddenItems: [...hiddenLegendItems].sort(),
    useTileset: useTilesetInput.checked && tilesetReady(),
    treeUrl: owlbearTreeUrlInput.value.trim(),
    rockUrl: owlbearRockUrlInput.value.trim(),
  });
}

async function updatePropPreview(
  input: HTMLInputElement,
  preview: HTMLElement,
  assetName: string,
) {
  const requestedUrl = input.value.trim();
  preview.classList.remove("is-error");
  preview.classList.add("is-loading");
  const information = preview.querySelector<HTMLElement>("small")!;
  const image = preview.querySelector<HTMLImageElement>("img")!;
  information.textContent = "Checking image…";
  try {
    const asset = await inspectOwlbearProp(requestedUrl, assetName);
    if (input.value.trim() !== requestedUrl) return;
    image.src = asset.url;
    image.style.display = "block";
    information.textContent =
      `${asset.width} × ${asset.height} · ${asset.mime.replace("image/", "").toUpperCase()}`;
  } catch (error) {
    if (input.value.trim() !== requestedUrl) return;
    preview.classList.add("is-error");
    image.removeAttribute("src");
    information.textContent = error instanceof Error
      ? error.message
      : "Unable to inspect this prop.";
  } finally {
    if (input.value.trim() === requestedUrl) {
      preview.classList.remove("is-loading");
    }
  }
}

function bindPropPreview(
  input: HTMLInputElement,
  preview: HTMLElement,
  assetName: string,
) {
  let timeout = 0;
  const schedule = () => {
    window.clearTimeout(timeout);
    timeout = window.setTimeout(() => {
      void updatePropPreview(input, preview, assetName);
    }, 450);
  };
  input.addEventListener("input", schedule);
  input.addEventListener("change", () => {
    window.clearTimeout(timeout);
    void updatePropPreview(input, preview, assetName);
  });
  void updatePropPreview(input, preview, assetName);
}

async function runOwlbearExport(action: "copy" | "download") {
  const activeButton =
    action === "copy" ? owlbearCopyButton : owlbearDownloadButton;
  const previousLabel = activeButton.textContent;
  const cacheKey = owlbearExportKey();
  const cachedScene = owlbearExportCache?.key === cacheKey
    ? owlbearExportCache.scene
    : undefined;
  owlbearCopyButton.disabled = true;
  owlbearDownloadButton.disabled = true;
  owlbearBackgroundButton.disabled = true;
  activeButton.textContent = "Preparing…";
  owlbearStatus.classList.remove("is-error");
  owlbearStatus.textContent = cachedScene
    ? "Reusing the latest Owlbear export…"
    : "Preparing the Owlbear JSON…";
  try {
    const scene = cachedScene ?? await createOwlbearSceneJson(
      currentGrid,
      seedInput.value.trim(),
      hiddenLegendItems,
      {
        useTileset: useTilesetInput.checked && tilesetReady(),
        treeUrl: owlbearTreeUrlInput.value,
        rockUrl: owlbearRockUrlInput.value,
      },
    );
    if (!cachedScene) {
      owlbearExportCache = { key: cacheKey, scene };
    }
    if (action === "copy") {
      await copyText(scene.json);
      owlbearStatus.textContent =
        "JSON copied. Paste it into your Owlbear scene.";
    } else {
      downloadOwlbearJson(scene);
      owlbearStatus.textContent =
        "JSON downloaded. Import or paste it into Owlbear.";
    }
  } catch (error) {
    owlbearStatus.classList.add("is-error");
    owlbearStatus.textContent = error instanceof Error
      ? `Export failed: ${error.message}`
      : "Owlbear export failed.";
  } finally {
    owlbearCopyButton.disabled = false;
    owlbearDownloadButton.disabled = false;
    owlbearBackgroundButton.disabled = false;
    activeButton.textContent = previousLabel;
  }
}
owlbearBackgroundButton.addEventListener("click", async () => {
  const previousLabel = owlbearBackgroundButton.textContent;
  owlbearBackgroundButton.disabled = true;
  owlbearCopyButton.disabled = true;
  owlbearDownloadButton.disabled = true;
  owlbearBackgroundButton.textContent = "Encoding…";
  owlbearStatus.classList.remove("is-error");
  owlbearStatus.textContent = "Preparing the prop-free background…";
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  try {
    const backgroundHiddenItems = new Set(hiddenLegendItems);
    backgroundHiddenItems.add(Obstacle.Tree);
    backgroundHiddenItems.add(Obstacle.Rock);
    await downloadWebp(
      currentGrid,
      activePreset.mode,
      seedInput.value.trim(),
      backgroundHiddenItems,
      showGridInput.checked,
      useTilesetInput.checked && tilesetReady(),
      tilesetImage,
      tilesetPropsReady() ? tilesetProps : undefined,
      stylizedLightingInput.checked,
      64,
      "-background",
    );
    owlbearStatus.textContent =
      "Background downloaded. Upload it as a map in Owlbear.";
  } catch (error) {
    owlbearStatus.classList.add("is-error");
    owlbearStatus.textContent = error instanceof Error
      ? `Export failed: ${error.message}`
      : "Background export failed.";
  } finally {
    owlbearBackgroundButton.disabled = false;
    owlbearCopyButton.disabled = false;
    owlbearDownloadButton.disabled = false;
    owlbearBackgroundButton.textContent = previousLabel;
  }
});
owlbearCopyButton.addEventListener("click", () => {
  void runOwlbearExport("copy");
});
owlbearDownloadButton.addEventListener("click", () => {
  void runOwlbearExport("download");
});
bindPropPreview(
  owlbearTreeUrlInput,
  owlbearTreePreview,
  "/assets/tilesets/tree.png",
);
bindPropPreview(
  owlbearRockUrlInput,
  owlbearRockPreview,
  "/assets/tilesets/rock.png",
);
previewGridInput.addEventListener("change", () => renderMap(currentGrid));
useTilesetInput.addEventListener("change", () => renderMap(currentGrid));
stylizedLightingInput.addEventListener("change", () => renderMap(currentGrid));
tilesetImage.addEventListener("load", () => {
  if (useTilesetInput.checked) renderMap(currentGrid);
});
Object.values(tilesetProps).forEach((image) => {
  image.addEventListener("load", () => {
    if (useTilesetInput.checked) renderMap(currentGrid);
  });
});
document.querySelector("#legend")!.addEventListener("click", (event) => {
  const groupButton = (event.target as HTMLElement).closest<HTMLButtonElement>(
    "[data-legend-group-items]",
  );
  if (groupButton) {
    const items = groupButton.dataset.legendGroupItems?.split(",") ?? [];
    const allHidden = items.every((item) => hiddenLegendItems.has(item));
    for (const item of items) {
      if (allHidden) hiddenLegendItems.delete(item);
      else hiddenLegendItems.add(item);
    }
    renderMap(currentGrid);
    return;
  }
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
    "[data-legend-item]",
  );
  const item = button?.dataset.legendItem;
  if (!item) return;
  if (hiddenLegendItems.has(item)) hiddenLegendItems.delete(item);
  else hiddenLegendItems.add(item);
  renderMap(currentGrid);
});
for (const input of [widthInput, heightInput, ...Object.values(inputs)]) {
  input.addEventListener("input", updateLabels);
}
window.addEventListener("resize", () => renderMap(currentGrid));

applyPreset(PRESETS[0]);
generate();
