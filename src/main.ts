import "./style.css";
import {
  generateTerrain,
  Obstacle,
  PRESETS,
  type Grid,
  type Preset,
  type TerrainOptions,
} from "./generator";
import {
  drawGrid,
  type CustomPropImages,
  type TilesetPropImages,
} from "./rendering/canvas";
import {
  BIOME_PARAMETER_PROFILES,
  PARAMETER_FIELDS,
  renderApp,
} from "./ui/template";
import { copyWebp, downloadWebp, renderExportCanvas } from "./export/webp";
import { uploadMapCanvas } from "./export/map-image";
import {
  createOwlbearSceneJson,
  downloadOwlbearJson,
  inspectPropAsset,
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
const treePropUrlInput =
  document.querySelector<HTMLInputElement>("#custom-tree-url")!;
const rockPropUrlInput =
  document.querySelector<HTMLInputElement>("#custom-rock-url")!;
const treePropPreview =
  document.querySelector<HTMLElement>("#custom-tree-preview")!;
const rockPropPreview =
  document.querySelector<HTMLElement>("#custom-rock-preview")!;
const owlbearStatus =
  document.querySelector<HTMLParagraphElement>("#owlbear-status")!;
const owlbearDynamicFogInput =
  document.querySelector<HTMLInputElement>("#owlbear-dynamic-fog")!;
const webpStatus =
  document.querySelector<HTMLParagraphElement>("#webp-status")!;
const webpCopyWithPropsButton =
  document.querySelector<HTMLButtonElement>("#copy-webp-with-props")!;
const webpDownloadWithPropsButton =
  document.querySelector<HTMLButtonElement>("#download-webp-with-props")!;
const webpCopyBackgroundButton =
  document.querySelector<HTMLButtonElement>("#copy-webp-background")!;
const webpDownloadBackgroundButton =
  document.querySelector<HTMLButtonElement>("#download-webp-background")!;
const webpButtons = [
  webpCopyWithPropsButton,
  webpDownloadWithPropsButton,
  webpCopyBackgroundButton,
  webpDownloadBackgroundButton,
];
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
const customProps: CustomPropImages = {};
const customPropSources: Partial<Record<"tree" | "rock", string>> = {};
const activeCustomProps = (): CustomPropImages => ({
  tree: customPropSources.tree === treePropUrlInput.value.trim()
    ? customProps.tree
    : undefined,
  rock: customPropSources.rock === rockPropUrlInput.value.trim()
    ? customProps.rock
    : undefined,
});
const inputs = Object.fromEntries(
  PARAMETER_FIELDS.map(({ id }) => [
    id,
    document.querySelector<HTMLInputElement>(`#${id}`)!,
  ]),
) as Record<(typeof PARAMETER_FIELDS)[number]["id"], HTMLInputElement>;

let activePreset = PRESETS[0];
let currentGrid: Grid = [];
let generatedOptions: TerrainOptions | undefined;
let mapRevision = 0;
let pendingGenerationFrame: number | undefined;
let pendingSeedGeneration: number | undefined;
const hiddenLegendItems = new Set<string>();
let owlbearExportCache: {
  key: string;
  scene: Awaited<ReturnType<typeof createOwlbearSceneJson>>;
} | undefined;

function updateLabels() {
  document.querySelector("#width-value")!.textContent = widthInput.value;
  document.querySelector("#height-value")!.textContent = heightInput.value;
  for (const field of PARAMETER_FIELDS) {
    const value = inputs[field.id].value;
    document.querySelector(`#${field.id}-value`)!.textContent = field.group === "terrain"
      ? `×${(Number(value) / 100).toFixed(1)}`
      : field.percent ? `${value}%` : value;
  }
}

function updateBiomeParameterFields(preset: Preset) {
  const profile = BIOME_PARAMETER_PROFILES[preset.mode];
  for (const field of PARAMETER_FIELDS) {
    const label = profile[field.id];
    document.querySelector<HTMLElement>(`#${field.id}-field`)!.hidden = !label;
    if (label) {
      document.querySelector<HTMLElement>(`#${field.id}-label`)!.textContent = label;
    }
  }
  document.querySelectorAll<HTMLElement>("[data-parameter-group]").forEach((group) => {
    group.hidden = ![...group.querySelectorAll<HTMLElement>(".field")]
      .some((field) => !field.hidden);
  });
}

function applyPreset(preset: Preset, useNewSeed = true) {
  activePreset = preset;
  updateBiomeParameterFields(preset);
  widthInput.value = String(preset.width);
  heightInput.value = String(preset.height);
  for (const field of PARAMETER_FIELDS) {
    const value = preset[field.key];
    inputs[field.id].value = String(field.percent ? Number(value) * 100 : value);
  }
  if (useNewSeed || !seedInput.value) seedInput.value = randomSeed();
  document.querySelectorAll(".preset-card").forEach((card) => {
    card.classList.toggle(
      "active",
      (card as HTMLElement).dataset.preset === preset.id,
    );
  });
  updateLabels();
}

function renderMap(grid: Grid, targetCanvas = previewCanvas, cellSize?: number) {
  const useTileset = useTilesetInput.checked && tilesetReady();
  drawGrid(grid, {
    targetCanvas,
    mode: activePreset.mode,
    cellSize,
    pixelRatio: targetCanvas === previewCanvas ? undefined : 1,
    updateInterface: targetCanvas === previewCanvas,
    hiddenItems: hiddenLegendItems,
    showGrid: previewGridInput.checked,
    useTileset,
    tilesetImage: tilesetReady() ? tilesetImage : undefined,
    tilesetProps: tilesetPropsReady() ? tilesetProps : undefined,
    customProps: useTileset ? activeCustomProps() : undefined,
    stylizedLighting: stylizedLightingInput.checked,
  });
}

function currentGenerationOptions(): TerrainOptions {
  return {
    width: Number(widthInput.value),
    height: Number(heightInput.value),
    seed: seedInput.value.trim(),
    scale: activePreset.scale,
    mode: activePreset.mode,
    waterWeight: Number(inputs.water.value) / 100,
    difficultWeight: Number(inputs.difficult.value) / 100,
    reliefWeight: Number(inputs.relief.value) / 100,
    rockRatio: Number(inputs.rocks.value) / 100,
    treeRatio: Number(inputs.trees.value) / 100,
    buildingCount: Number(inputs.buildings.value),
  };
}

function generate() {
  if (pendingGenerationFrame !== undefined) {
    cancelAnimationFrame(pendingGenerationFrame);
    pendingGenerationFrame = undefined;
  }
  if (pendingSeedGeneration !== undefined) {
    window.clearTimeout(pendingSeedGeneration);
    pendingSeedGeneration = undefined;
  }
  updateLabels();
  const seed = (seedInput.value.trim() || randomSeed()).normalize("NFC");
  seedInput.value = seed;
  generatedOptions = currentGenerationOptions();
  currentGrid = generateTerrain(generatedOptions);
  mapRevision += 1;
  renderMap(currentGrid);
}

function scheduleGeneration() {
  if (pendingGenerationFrame !== undefined) {
    cancelAnimationFrame(pendingGenerationFrame);
  }
  pendingGenerationFrame = requestAnimationFrame(() => {
    pendingGenerationFrame = undefined;
    generate();
  });
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
function webpRenderOptions(includeProps: boolean) {
  const hiddenItems = new Set(hiddenLegendItems);
  if (!includeProps) {
    hiddenItems.add(Obstacle.Tree);
    hiddenItems.add(Obstacle.Rock);
  }
  const useTileset = useTilesetInput.checked && tilesetReady();
  return {
    hiddenItems,
    showGrid: showGridInput.checked,
    useTileset,
    tilesetImage: tilesetReady() ? tilesetImage : undefined,
    tilesetProps: tilesetPropsReady() ? tilesetProps : undefined,
    customProps: useTileset ? activeCustomProps() : undefined,
    stylizedLighting: stylizedLightingInput.checked,
    cellSize: 64,
  };
}

async function runWebpExport(
  action: "copy" | "download",
  includeProps: boolean,
  activeButton: HTMLButtonElement,
) {
  const previousLabel = activeButton.textContent;
  webpButtons.forEach((button) => button.disabled = true);
  activeButton.textContent = "Encoding…";
  webpStatus.classList.remove("is-error");
  webpStatus.textContent = includeProps
    ? "Rendering the complete map…"
    : "Rendering the prop-free background…";

  // Let the busy state paint before rendering a potentially large map.
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  try {
    const options = webpRenderOptions(includeProps);
    if (action === "copy") {
      const clipboardFormat = await copyWebp(
        currentGrid,
        activePreset.mode,
        options,
      );
      webpStatus.textContent = clipboardFormat === "webp"
        ? `${includeProps ? "Complete map" : "Background"} copied as WebP.`
        : `${includeProps ? "Complete map" : "Background"} copied as PNG for browser compatibility.`;
    } else {
      await downloadWebp(
        currentGrid,
        activePreset.mode,
        seedInput.value.trim(),
        {
          ...options,
          filenameSuffix: includeProps ? "" : "-background",
        },
      );
      webpStatus.textContent = includeProps
        ? "Complete WebP downloaded."
        : "Background WebP downloaded.";
    }
  } catch (error) {
    webpStatus.classList.add("is-error");
    webpStatus.textContent = error instanceof Error
      ? `Export failed: ${error.message}`
      : "WebP export failed.";
  } finally {
    webpButtons.forEach((button) => button.disabled = false);
    activeButton.textContent = previousLabel;
  }
}
webpCopyWithPropsButton.addEventListener("click", () =>
  void runWebpExport("copy", true, webpCopyWithPropsButton));
webpDownloadWithPropsButton.addEventListener("click", () =>
  void runWebpExport("download", true, webpDownloadWithPropsButton));
webpCopyBackgroundButton.addEventListener("click", () =>
  void runWebpExport("copy", false, webpCopyBackgroundButton));
webpDownloadBackgroundButton.addEventListener("click", () =>
  void runWebpExport("download", false, webpDownloadBackgroundButton));
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
  const useTileset = useTilesetInput.checked;
  return JSON.stringify({
    mapRevision,
    seed: generatedOptions?.seed ?? seedInput.value.trim(),
    hiddenItems: [...hiddenLegendItems].sort(),
    useTileset,
    showGrid: showGridInput.checked,
    stylizedLighting: stylizedLightingInput.checked,
    dynamicFog: owlbearDynamicFogInput.checked,
    treeUrl: useTileset
      ? treePropUrlInput.value.trim()
      : "",
    rockUrl: useTileset
      ? rockPropUrlInput.value.trim()
      : "",
  });
}

async function updatePropPreview(
  input: HTMLInputElement,
  preview: HTMLElement,
  kind: "tree" | "rock",
) {
  const requestedUrl = input.value.trim();
  preview.classList.remove("is-error");
  preview.classList.add("is-loading");
  const information = preview.querySelector<HTMLElement>("small")!;
  const previewImage = preview.querySelector<HTMLImageElement>("img")!;
  if (!requestedUrl) {
    delete customProps[kind];
    delete customPropSources[kind];
    previewImage.src = `/assets/tilesets/${kind}_1x1.png`;
    previewImage.style.display = "block";
    information.textContent = "Tileset fallback";
    preview.classList.remove("is-loading");
    if (useTilesetInput.checked) renderMap(currentGrid);
    return;
  }
  information.textContent = "Checking image…";
  try {
    const asset = await inspectPropAsset(requestedUrl, "");
    const canvasImage = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(
        "The image host does not allow cross-origin canvas rendering.",
      ));
      image.src = asset.url;
    });
    if (input.value.trim() !== requestedUrl) return;
    customProps[kind] = canvasImage;
    customPropSources[kind] = requestedUrl;
    previewImage.src = asset.url;
    previewImage.style.display = "block";
    information.textContent =
      `${asset.width} × ${asset.height} · ${asset.mime.replace("image/", "").toUpperCase()}`;
    if (useTilesetInput.checked) renderMap(currentGrid);
  } catch (error) {
    if (input.value.trim() !== requestedUrl) return;
    delete customProps[kind];
    delete customPropSources[kind];
    preview.classList.add("is-error");
    previewImage.removeAttribute("src");
    information.textContent = error instanceof Error
      ? error.message
      : "Unable to inspect this prop.";
    if (useTilesetInput.checked) renderMap(currentGrid);
  } finally {
    if (input.value.trim() === requestedUrl) {
      preview.classList.remove("is-loading");
    }
  }
}

function bindPropPreview(
  input: HTMLInputElement,
  preview: HTMLElement,
  kind: "tree" | "rock",
) {
  let timeout = 0;
  const schedule = () => {
    window.clearTimeout(timeout);
    if (useTilesetInput.checked) renderMap(currentGrid);
    timeout = window.setTimeout(() => {
      void updatePropPreview(input, preview, kind);
    }, 450);
  };
  input.addEventListener("input", schedule);
  input.addEventListener("change", () => {
    window.clearTimeout(timeout);
    void updatePropPreview(input, preview, kind);
  });
  void updatePropPreview(input, preview, kind);
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
  activeButton.textContent = "Preparing…";
  owlbearStatus.classList.remove("is-error");
  owlbearStatus.textContent = cachedScene
    ? "Reusing the latest Owlbear export…"
    : "Preparing the Owlbear JSON…";
  try {
    const generation = generatedOptions;
    if (!generation) throw new Error("Generate a map before exporting.");
    const useTileset = useTilesetInput.checked;
    let scene = cachedScene;
    if (!scene) {
      owlbearStatus.textContent = "Rendering and uploading the exact background...";
      const mapCanvas = renderExportCanvas(currentGrid, generation.mode, {
        ...webpRenderOptions(false),
        cellSize: 48,
      });
      const mapImage = await uploadMapCanvas(mapCanvas);
      scene = await createOwlbearSceneJson(
        currentGrid,
        generation.seed,
        hiddenLegendItems,
        {
          mapImage,
          useTileset,
          dynamicFog: owlbearDynamicFogInput.checked,
          treeUrl: useTileset
            ? treePropUrlInput.value
            : undefined,
          rockUrl: useTileset
            ? rockPropUrlInput.value
            : undefined,
        },
      );
    }
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
  treePropUrlInput,
  treePropPreview,
  "tree",
);
bindPropPreview(
  rockPropUrlInput,
  rockPropPreview,
  "rock",
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
  input.addEventListener("input", () => {
    updateLabels();
    scheduleGeneration();
  });
}
seedInput.addEventListener("input", () => {
  if (pendingSeedGeneration !== undefined) {
    window.clearTimeout(pendingSeedGeneration);
  }
  if (!seedInput.value.trim()) return;
  pendingSeedGeneration = window.setTimeout(() => {
    pendingSeedGeneration = undefined;
    generate();
  }, 250);
});
seedInput.addEventListener("change", generate);
document.querySelectorAll<HTMLButtonElement>("[data-randomize-group]")
  .forEach((button) => {
    button.addEventListener("click", () => {
      const group = button.dataset.randomizeGroup;
      for (const field of PARAMETER_FIELDS) {
        if (field.group !== group) continue;
        const container = document.querySelector<HTMLElement>(
          `#${field.id}-field`,
        )!;
        if (container.hidden) continue;
        const input = inputs[field.id];
        const minimum = Number(input.min);
        const step = Number(input.step) || 1;
        const stepCount = Math.floor((Number(input.max) - minimum) / step);
        input.value = String(
          minimum + Math.floor(Math.random() * (stepCount + 1)) * step,
        );
      }
      updateLabels();
      generate();
    });
  });
window.addEventListener("resize", () => renderMap(currentGrid));

applyPreset(PRESETS[0]);
generate();
