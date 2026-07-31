import "./style.css";
import {
  generateTerrain,
  PRESETS,
  type Grid,
  type Preset,
} from "./generator";
import { drawGrid, type TilesetPropImages } from "./rendering/canvas";
import { PARAMETER_FIELDS, renderApp } from "./ui/template";
import { downloadWebp } from "./export/webp";
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
const scaleInput = document.querySelector<HTMLInputElement>("#scale")!;
const previewGridInput =
  document.querySelector<HTMLInputElement>("#preview-grid")!;
const showGridInput = document.querySelector<HTMLInputElement>("#show-grid")!;
const useTilesetInput =
  document.querySelector<HTMLInputElement>("#use-tileset")!;
const owlbearGridInput =
  document.querySelector<HTMLInputElement>("#owlbear-grid")!;
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
const owlbearCopyButton =
  document.querySelector<HTMLButtonElement>("#copy-owlbear")!;
const owlbearDownloadButton =
  document.querySelector<HTMLButtonElement>("#download-owlbear")!;
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
  document.querySelector("#scale-value")!.textContent = scaleInput.value;
  for (const field of PARAMETER_FIELDS) {
    document.querySelector(`#${field.id}-value`)!.textContent =
      field.percent ? `${inputs[field.id].value}%` : inputs[field.id].value;
  }
}

function applyPreset(preset: Preset, useNewSeed = true) {
  activePreset = preset;
  widthInput.value = String(preset.width);
  heightInput.value = String(preset.height);
  scaleInput.value = String(preset.scale);
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
    scale: Number(scaleInput.value),
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
document.querySelector("#download")!.addEventListener("click", () => {
  downloadWebp(
    currentGrid,
    activePreset.mode,
    seedInput.value.trim(),
    hiddenLegendItems,
    showGridInput.checked,
    useTilesetInput.checked && tilesetReady(),
    tilesetImage,
    tilesetPropsReady() ? tilesetProps : undefined,
  );
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
    mode: activePreset.mode,
    seed: seedInput.value.trim(),
    hiddenItems: [...hiddenLegendItems].sort(),
    showGrid: owlbearGridInput.checked,
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
  activeButton.textContent = cachedScene ? "Preparing…" : "Uploading…";
  owlbearStatus.classList.remove("is-error");
  owlbearStatus.textContent = cachedScene
    ? "Reusing the latest Owlbear export…"
    : "Uploading the map background to Litterbox…";
  try {
    const scene = cachedScene ?? await createOwlbearSceneJson(
      currentGrid,
      activePreset.mode,
      seedInput.value.trim(),
      hiddenLegendItems,
      {
        showGrid: owlbearGridInput.checked,
        useTileset: useTilesetInput.checked && tilesetReady(),
        treeUrl: owlbearTreeUrlInput.value,
        rockUrl: owlbearRockUrlInput.value,
        tilesetImage,
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
    activeButton.textContent = previousLabel;
  }
}
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
for (const input of [widthInput, heightInput, scaleInput, ...Object.values(inputs)]) {
  input.addEventListener("input", updateLabels);
}
window.addEventListener("resize", () => renderMap(currentGrid));

applyPreset(PRESETS[0]);
generate();
