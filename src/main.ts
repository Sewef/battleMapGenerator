import "./style.css";
import {
  generateTerrain,
  INTERIOR_MINIMUM_DIMENSIONS,
  INTERIOR_ROOM_LIMITS,
  isInteriorMode,
  Obstacle,
  PRESETS,
  Terrain,
  type Grid,
  type Preset,
  type TerrainKind,
  type TerrainOptions,
  type Tile,
} from "./generator";
import {
  drawGrid,
  type CustomPropImages,
} from "./rendering/canvas";
import { collectTilesetImages, createTilesetAssets } from "./rendering/tileset-assets";
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

type ControlsTab = "generation" | "terrain" | "props";

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
const controlsTabButtons = [
  ...document.querySelectorAll<HTMLButtonElement>("[data-controls-tab]"),
];
const generationSettingsPanel =
  document.querySelector<HTMLElement>("#generation-settings")!;
const terrainEditorSettingsPanel =
  document.querySelector<HTMLElement>("#terrain-editor-settings")!;
const propsEditorSettingsPanel =
  document.querySelector<HTMLElement>("#props-editor-settings")!;
const editorBrushSizeInput =
  document.querySelector<HTMLSelectElement>("#editor-brush-size")!;
const editorElevationInput =
  document.querySelector<HTMLSelectElement>("#editor-elevation")!;
const editorUndoButton =
  document.querySelector<HTMLButtonElement>("#editor-undo")!;
const editorDoneButton =
  document.querySelector<HTMLButtonElement>("#editor-done")!;
const propsEditorDoneButton =
  document.querySelector<HTMLButtonElement>("#props-editor-done")!;
const editorTerrainButtons = [
  ...document.querySelectorAll<HTMLButtonElement>("[data-editor-terrain]"),
];
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
const {
  terrain: tilesetImage,
  terrainTiles: tilesetTerrain,
  props: tilesetProps,
  terrainReady: tilesetReady,
  terrainStatus: tilesetTerrainStatus,
  propsReady: tilesetPropsReady,
  propsStatus: tilesetPropsStatus,
  ensurePropsForMode,
} = createTilesetAssets();
const tilesetEnabledFor = (mode: Preset["mode"]) => useTilesetInput.checked &&
  (isInteriorMode(mode) ? tilesetPropsReady(mode) : tilesetReady());
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
let lastTilesetWarning = "";
let tilesetTerrainReadyLogged = false;
let tilesetPropsReadyLogged = false;
const hiddenLegendItems = new Set<string>();
const editableTerrains = new Set<TerrainKind>(
  Object.values(Terrain) as TerrainKind[],
);
let activeControlsTab: ControlsTab = "generation";
let activeEditorTerrain: TerrainKind = Terrain.Ground;
let editorUndoGrid: Grid | undefined;
let editorStrokeBackup: Grid | undefined;
let editorPointerId: number | undefined;
let editorStrokeChanged = false;
let lastPaintedCellKey = "";
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
  const isInterior = isInteriorMode(preset.mode);
  const minimumDimensions = isInteriorMode(preset.mode)
    ? INTERIOR_MINIMUM_DIMENSIONS[preset.mode]
    : undefined;
  widthInput.min = minimumDimensions ? String(minimumDimensions.width) : "16";
  heightInput.min = minimumDimensions ? String(minimumDimensions.height) : "12";
  const roomLimits = isInteriorMode(preset.mode)
    ? INTERIOR_ROOM_LIMITS[preset.mode]
    : undefined;
  inputs.buildings.min = roomLimits ? String(roomLimits.minimum) : "0";
  inputs.buildings.max = roomLimits ? String(roomLimits.maximum) : "8";
  useTilesetInput.closest<HTMLElement>("label")!.hidden = false;
  document.querySelector<HTMLElement>("#custom-prop-settings")!.hidden = isInterior;
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
    const heading = group.querySelector<HTMLElement>(".parameter-heading p");
    if (heading && group.dataset.parameterGroup === "obstacles") {
      heading.textContent = isInterior ? "Layout" : "Obstacle population";
    }
  });
}

function applyPreset(preset: Preset, useNewSeed = true) {
  activePreset = preset;
  tilesetPropsReadyLogged = false;
  ensurePropsForMode(preset.mode);
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
  ensurePropsForMode(activePreset.mode);
  const useTileset = tilesetEnabledFor(activePreset.mode);
  if (targetCanvas === previewCanvas && useTilesetInput.checked && !useTileset) {
    const status = tilesetPropsStatus(activePreset.mode);
    const diagnostic = isInteriorMode(activePreset.mode)
      ? `${activePreset.mode}:${status.loaded}:${status.pending}:${status.failed.join("|")}`
      : `${activePreset.mode}:terrain:${JSON.stringify(tilesetTerrainStatus())}`;
    if (diagnostic !== lastTilesetWarning) {
      lastTilesetWarning = diagnostic;
      console.warn("[tileset] Rendering without tileset: assets unavailable", {
        mode: activePreset.mode,
        interior: isInteriorMode(activePreset.mode),
        ...status,
      });
    }
  } else if (useTileset) {
    lastTilesetWarning = "";
  }
  drawGrid(grid, {
    targetCanvas,
    mode: activePreset.mode,
    cellSize,
    pixelRatio: targetCanvas === previewCanvas ? undefined : 1,
    updateInterface: targetCanvas === previewCanvas,
    hiddenItems: hiddenLegendItems,
    showGrid: previewGridInput.checked ||
      (targetCanvas === previewCanvas && activeControlsTab === "terrain"),
    useTileset,
    tilesetImage: tilesetReady() ? tilesetImage : undefined,
    tilesetTerrain: tilesetReady() ? tilesetTerrain : undefined,
    tilesetProps: tilesetPropsReady(activePreset.mode) ? tilesetProps : undefined,
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
  clearEditorUndo();
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

function cloneGrid(grid: Grid): Grid {
  return grid.map((row) => row.map((tile) => ({ ...tile })));
}

function clearEditorUndo() {
  editorUndoGrid = undefined;
  editorStrokeBackup = undefined;
  editorPointerId = undefined;
  editorStrokeChanged = false;
  lastPaintedCellKey = "";
  editorUndoButton.disabled = true;
}

function markMapEdited() {
  mapRevision += 1;
  owlbearExportCache = undefined;
}

function isEditableTerrain(value: string | undefined): value is TerrainKind {
  return Boolean(value && editableTerrains.has(value as TerrainKind));
}

function terrainBaseHeight(terrain: TerrainKind) {
  switch (terrain) {
    case Terrain.Void:
      return .08;
    case Terrain.Water:
    case Terrain.Lava:
      return .16;
    case Terrain.Ice:
    case Terrain.Ravine:
      return .2;
    case Terrain.Beach:
      return .24;
    case Terrain.Difficult:
      return .42;
    case Terrain.Cliff:
    case Terrain.Wall:
      return .86;
    case Terrain.Door:
      return .48;
    default:
      return .32;
  }
}

function selectedEditorElevation() {
  const elevation = Math.round(Number(editorElevationInput.value));
  return Math.max(1, Math.min(3, Number.isFinite(elevation) ? elevation : 1));
}

function selectedEditorBrushRadius() {
  const brushSize = Math.max(1, Math.round(Number(editorBrushSizeInput.value)));
  return Math.floor(brushSize / 2);
}

function tilePaintSignature(tile: Tile) {
  return [
    tile.terrain,
    tile.surface ?? "",
    tile.elevation ?? "",
    tile.height ?? "",
    tile.transition ?? "",
    tile.transitionNormalX ?? "",
    tile.transitionNormalY ?? "",
    tile.doorOrientation ?? "",
  ].join("|");
}

function clearTerrainTransition(tile: Tile) {
  delete tile.surface;
  delete tile.transition;
  delete tile.transitionNormalX;
  delete tile.transitionNormalY;
}

function inferDoorOrientation(x: number, y: number): Tile["doorOrientation"] {
  const hasVerticalWall =
    currentGrid[y - 1]?.[x]?.terrain === Terrain.Wall ||
    currentGrid[y + 1]?.[x]?.terrain === Terrain.Wall;
  const hasHorizontalWall =
    currentGrid[y]?.[x - 1]?.terrain === Terrain.Wall ||
    currentGrid[y]?.[x + 1]?.terrain === Terrain.Wall;
  if (hasVerticalWall && !hasHorizontalWall) return "vertical";
  return "horizontal";
}

function paintTileTerrain(tile: Tile, terrain: TerrainKind, x: number, y: number) {
  const before = tilePaintSignature(tile);
  clearTerrainTransition(tile);
  tile.terrain = terrain;
  tile.height = terrainBaseHeight(terrain);
  if (terrain === Terrain.Cliff) {
    tile.elevation = selectedEditorElevation();
  } else {
    delete tile.elevation;
  }
  if (terrain === Terrain.Door) {
    tile.doorOrientation = tile.doorOrientation ?? inferDoorOrientation(x, y);
  } else {
    delete tile.doorOrientation;
  }
  return tilePaintSignature(tile) !== before;
}

function canvasCellFromPointer(event: PointerEvent) {
  if (!currentGrid.length || !currentGrid[0].length) return undefined;
  const rect = previewCanvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return undefined;
  const columns = currentGrid[0].length;
  const rows = currentGrid.length;
  const x = Math.floor(((event.clientX - rect.left) / rect.width) * columns);
  const y = Math.floor(((event.clientY - rect.top) / rect.height) * rows);
  if (x < 0 || y < 0 || x >= columns || y >= rows) return undefined;
  return { x, y };
}

function applyEditorBrush(centerX: number, centerY: number) {
  const radius = selectedEditorBrushRadius();
  let changed = false;
  for (let y = centerY - radius; y <= centerY + radius; y += 1) {
    for (let x = centerX - radius; x <= centerX + radius; x += 1) {
      const tile = currentGrid[y]?.[x];
      if (!tile) continue;
      changed = paintTileTerrain(tile, activeEditorTerrain, x, y) || changed;
    }
  }
  if (!changed) return false;
  markMapEdited();
  renderMap(currentGrid);
  return true;
}

function paintFromPointer(event: PointerEvent) {
  const cell = canvasCellFromPointer(event);
  if (!cell) return;
  const key = `${cell.x}:${cell.y}`;
  if (key === lastPaintedCellKey) return;
  lastPaintedCellKey = key;
  editorStrokeChanged = applyEditorBrush(cell.x, cell.y) || editorStrokeChanged;
}

function finishEditorStroke(event: PointerEvent) {
  if (editorPointerId !== event.pointerId) return;
  if (previewCanvas.hasPointerCapture(event.pointerId)) {
    previewCanvas.releasePointerCapture(event.pointerId);
  }
  if (editorStrokeChanged && editorStrokeBackup) {
    editorUndoGrid = editorStrokeBackup;
    editorUndoButton.disabled = false;
  }
  editorPointerId = undefined;
  editorStrokeBackup = undefined;
  editorStrokeChanged = false;
  lastPaintedCellKey = "";
}

function setEditorTerrain(terrain: TerrainKind) {
  activeEditorTerrain = terrain;
  for (const button of editorTerrainButtons) {
    const active = button.dataset.editorTerrain === terrain;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  editorElevationInput.disabled = terrain !== Terrain.Cliff;
}

function isControlsTab(value: string | undefined): value is ControlsTab {
  return value === "generation" || value === "terrain" || value === "props";
}

function setControlsTab(tab: ControlsTab) {
  activeControlsTab = tab;
  generationSettingsPanel.hidden = tab !== "generation";
  terrainEditorSettingsPanel.hidden = tab !== "terrain";
  propsEditorSettingsPanel.hidden = tab !== "props";
  for (const button of controlsTabButtons) {
    const active = button.dataset.controlsTab === tab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  }

  const editingTerrain = tab === "terrain";
  previewCanvas.classList.toggle("is-editing", editingTerrain);
  previewCanvas.closest<HTMLElement>(".canvas-wrap")?.classList.toggle(
    "is-editing",
    editingTerrain,
  );
  if (!editingTerrain) {
    editorPointerId = undefined;
    editorStrokeBackup = undefined;
    editorStrokeChanged = false;
    lastPaintedCellKey = "";
  }
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

for (const button of editorTerrainButtons) {
  const terrain = button.dataset.editorTerrain;
  if (!isEditableTerrain(terrain)) continue;
  button.addEventListener("click", () => setEditorTerrain(terrain));
}
for (const button of controlsTabButtons) {
  const tab = button.dataset.controlsTab;
  if (!isControlsTab(tab)) continue;
  button.addEventListener("click", () => setControlsTab(tab));
}
editorDoneButton.addEventListener("click", () => setControlsTab("generation"));
propsEditorDoneButton.addEventListener("click", () => setControlsTab("generation"));
previewCanvas.addEventListener("pointerdown", (event) => {
  if (activeControlsTab !== "terrain" || event.button !== 0 || !currentGrid.length) {
    return;
  }
  event.preventDefault();
  editorPointerId = event.pointerId;
  editorStrokeBackup = cloneGrid(currentGrid);
  editorStrokeChanged = false;
  lastPaintedCellKey = "";
  previewCanvas.setPointerCapture(event.pointerId);
  paintFromPointer(event);
});
previewCanvas.addEventListener("pointermove", (event) => {
  if (activeControlsTab !== "terrain" || editorPointerId !== event.pointerId) return;
  event.preventDefault();
  paintFromPointer(event);
});
previewCanvas.addEventListener("pointerup", finishEditorStroke);
previewCanvas.addEventListener("pointercancel", finishEditorStroke);
editorUndoButton.addEventListener("click", () => {
  if (!editorUndoGrid) return;
  currentGrid = cloneGrid(editorUndoGrid);
  clearEditorUndo();
  markMapEdited();
  renderMap(currentGrid);
});

function webpRenderOptions(
  includeProps: boolean,
  mode: Preset["mode"] = generatedOptions?.mode ?? activePreset.mode,
) {
  const hiddenItems = new Set(hiddenLegendItems);
  if (!includeProps) {
    hiddenItems.add(Obstacle.Tree);
    hiddenItems.add(Obstacle.Rock);
  }
  ensurePropsForMode(mode);
  const useTileset = tilesetEnabledFor(mode);
  return {
    hiddenItems,
    showGrid: showGridInput.checked,
    useTileset,
    tilesetImage: tilesetReady() ? tilesetImage : undefined,
    tilesetTerrain: tilesetReady() ? tilesetTerrain : undefined,
    tilesetProps: tilesetPropsReady(mode) ? tilesetProps : undefined,
    customProps: useTileset ? activeCustomProps() : undefined,
    stylizedLighting: stylizedLightingInput.checked,
    hideInteriorProps: !includeProps,
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
  const mode = generatedOptions?.mode ?? activePreset.mode;
  const useTileset = tilesetEnabledFor(mode);
  return JSON.stringify({
    mapRevision,
    mode,
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
    previewImage.src = `/assets/tilesets/bailey/${kind}_1x1.png`;
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
    const useTileset = tilesetEnabledFor(generation.mode);
    let scene = cachedScene;
    if (!scene) {
      owlbearStatus.textContent = "Rendering and uploading the exact background...";
      const mapCanvas = renderExportCanvas(currentGrid, generation.mode, {
        ...webpRenderOptions(false, generation.mode),
        cellSize: 48,
      });
      const mapImage = await uploadMapCanvas(mapCanvas);
      scene = await createOwlbearSceneJson(
        currentGrid,
        generation.seed,
        hiddenLegendItems,
        {
          mapImage,
          mode: generation.mode,
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
useTilesetInput.addEventListener("change", () => {
  console.info("[tileset] Option changed", {
    checked: useTilesetInput.checked,
    mode: activePreset.mode,
    enabled: tilesetEnabledFor(activePreset.mode),
    ...tilesetPropsStatus(activePreset.mode),
  });
  renderMap(currentGrid);
});
stylizedLightingInput.addEventListener("change", () => renderMap(currentGrid));
collectTilesetImages({ tilesetImage, tilesetTerrain }).forEach((image) => {
  image.addEventListener("load", () => {
    if (!tilesetReady() || tilesetTerrainReadyLogged) return;
    tilesetTerrainReadyLogged = true;
    console.info("[tileset] All terrain assets loaded", tilesetTerrainStatus());
    if (useTilesetInput.checked) renderMap(currentGrid);
  });
  image.addEventListener("error", () => {
    console.error("[tileset] Failed to load terrain asset", {
      source: image.currentSrc || image.src,
      ...tilesetTerrainStatus(),
    });
  });
});
collectTilesetImages(tilesetProps).forEach((image) => {
  image.addEventListener("load", () => {
    if (!tilesetPropsReady(activePreset.mode) || tilesetPropsReadyLogged) return;
    tilesetPropsReadyLogged = true;
    console.info("[tileset] Required prop assets loaded", tilesetPropsStatus(activePreset.mode));
    if (useTilesetInput.checked) renderMap(currentGrid);
  });
  image.addEventListener("error", () => {
    console.error("[tileset] Failed to load interior asset", {
      source: image.currentSrc || image.src,
      ...tilesetPropsStatus(activePreset.mode),
    });
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

setEditorTerrain(activeEditorTerrain);
setControlsTab(activeControlsTab);
applyPreset(PRESETS[0]);
generate();
