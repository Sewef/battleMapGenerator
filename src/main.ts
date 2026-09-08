import "./style.css";
import {
  generateTerrain,
  INTERIOR_MINIMUM_DIMENSIONS,
  INTERIOR_ROOM_LIMITS,
  INTERIOR_PROP_RULES,
  isInteriorMode,
  DECK_FEATURE_RULES,
  Obstacle,
  OutdoorProp,
  PRESETS,
  Terrain,
  type Grid,
  type ObstacleKind,
  type OutdoorPropKind,
  type Preset,
  type TerrainKind,
  type TerrainOptions,
  type Tile,
} from "./generator";
import {
  drawGrid,
  type CustomPropImages,
} from "./rendering/canvas";
import {
  bedAssetDefinitions,
  collectTilesetImages,
  createTilesetAssets,
} from "./rendering/tileset-assets";
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
type PropCategory = "all" | "outdoor" | "interior" | "deck";
type Facing = NonNullable<Tile["propFacing"]>;
type PropOrientation = NonNullable<Tile["propOrientation"]>;
type PropFootprint = { width: number; height: number; label: string };
type InteriorPropKind = NonNullable<Tile["interiorProp"]>;
type DeckFeatureKind = NonNullable<Tile["deckFeature"]>;
type PlaceableObstacleKind = Exclude<ObstacleKind, "none">;
type PropEditorTool =
  | "erase"
  | `obstacle:${PlaceableObstacleKind}`
  | `outdoor:${OutdoorPropKind}`
  | `interior:${InteriorPropKind}`
  | `deck:${DeckFeatureKind}`;

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
const propsSearchInput =
  document.querySelector<HTMLInputElement>("#props-search")!;
const propsCategoryInput =
  document.querySelector<HTMLSelectElement>("#props-category")!;
const propsFacingInput =
  document.querySelector<HTMLSelectElement>("#props-facing")!;
const propsSizeInput =
  document.querySelector<HTMLSelectElement>("#props-size")!;
const propsVariantInput =
  document.querySelector<HTMLSelectElement>("#props-variant")!;
const propSelectionPreviewCanvas =
  document.querySelector<HTMLCanvasElement>("#prop-selection-preview")!;
const propsUndoButton =
  document.querySelector<HTMLButtonElement>("#props-editor-undo")!;
const propsEmptyState =
  document.querySelector<HTMLElement>("#props-empty-state")!;
const editorTerrainButtons = [
  ...document.querySelectorAll<HTMLButtonElement>("[data-editor-terrain]"),
];
const propToolButtons = [
  ...document.querySelectorAll<HTMLButtonElement>("[data-prop-tool]"),
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
let activePropTool: PropEditorTool = "erase";
let propsUndoGrid: Grid | undefined;
let propsStrokeBackup: Grid | undefined;
let propsPointerId: number | undefined;
let propsStrokeChanged = false;
let lastPropsPaintedCellKey = "";
let nextManualPropId = -1;
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
  updatePropEditorForMode();
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
      (targetCanvas === previewCanvas &&
        (activeControlsTab === "terrain" || activeControlsTab === "props")),
    useTileset,
    tilesetImage: tilesetReady() ? tilesetImage : undefined,
    tilesetTerrain: tilesetReady() ? tilesetTerrain : undefined,
    tilesetProps: tilesetPropsReady(activePreset.mode) ? tilesetProps : undefined,
    customProps: useTileset ? activeCustomProps() : undefined,
    stylizedLighting: stylizedLightingInput.checked,
  });
}

function renderPropEditorPreview() {
  const footprint = activePropTool === "erase"
    ? oneByOneFootprint[0]
    : selectedPropFootprint();
  const dimension = Math.max(5, Math.max(footprint.width, footprint.height) + 4);
  const originX = Math.floor((dimension - footprint.width) / 2);
  const originY = Math.min(
    dimension - footprint.height - 1,
    Math.max(1, Math.floor((dimension - footprint.height) / 2) + 1),
  );
  const previewGrid: Grid = Array.from({ length: dimension }, () =>
    Array.from({ length: dimension }, () => ({
      terrain: Terrain.Ground,
      obstacle: Obstacle.None,
    })));

  if (activePropTool !== "erase") {
    const [scope, kind] = activePropTool.split(":") as [string, string];
    const variant = selectedPropVariant();
    for (let offsetY = 0; offsetY < footprint.height; offsetY += 1) {
      for (let offsetX = 0; offsetX < footprint.width; offsetX += 1) {
        const tile = previewGrid[originY + offsetY][originX + offsetX];
        if (variant !== undefined) tile.propVariant = variant;
        if (scope === "obstacle") {
          tile.obstacle = kind as PlaceableObstacleKind;
          tile.obstacleId = -1;
        } else if (scope === "outdoor") {
          tile.outdoorProp = kind as OutdoorPropKind;
          tile.outdoorPropId = -1;
        } else if (scope === "interior") {
          tile.interiorProp = kind as InteriorPropKind;
          tile.interiorPropId = -1;
          tile.propOrientation = selectedPropOrientation();
          tile.propFacing = selectedPropFacing();
        } else if (scope === "deck") {
          tile.deckFeature = kind as DeckFeatureKind;
          tile.deckFeatureFacing = selectedPropFacing();
        }
      }
    }
  }

  const usePropTileset = useTilesetInput.checked && tilesetPropsReady(activePreset.mode);
  drawGrid(previewGrid, {
    targetCanvas: propSelectionPreviewCanvas,
    mode: activePreset.mode,
    cellSize: Math.max(12, Math.min(24, Math.floor(126 / dimension))),
    pixelRatio: 1,
    updateInterface: false,
    hiddenItems: new Set<string>(),
    showGrid: true,
    useTileset: usePropTileset,
    tilesetProps: usePropTileset ? tilesetProps : undefined,
    customProps: usePropTileset ? activeCustomProps() : undefined,
    stylizedLighting: false,
    hideInteriorProps: false,
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
  clearPropsEditorUndo();
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

function clearPropsEditorUndo() {
  propsUndoGrid = undefined;
  propsStrokeBackup = undefined;
  propsPointerId = undefined;
  propsStrokeChanged = false;
  lastPropsPaintedCellKey = "";
  propsUndoButton.disabled = true;
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

function isPropCategory(value: string): value is PropCategory {
  return value === "all" || value === "outdoor" ||
    value === "interior" || value === "deck";
}

const placeableObstacles = new Set<PlaceableObstacleKind>([
  Obstacle.Tree,
  Obstacle.Rock,
  Obstacle.Building,
]);
const outdoorProps = new Set(Object.values(OutdoorProp) as OutdoorPropKind[]);
const interiorProps = new Set(Object.keys(INTERIOR_PROP_RULES) as InteriorPropKind[]);
const deckFeatures = new Set(Object.keys(DECK_FEATURE_RULES) as DeckFeatureKind[]);
const oneByOneFootprint = [{ width: 1, height: 1, label: "1 x 1" }] as const;
const defaultFacingChoice = [{ value: "north", label: "Default" }] as const;
const propFacingChoices: ReadonlyArray<{ value: Facing; label: string }> = [
  { value: "north", label: "North" },
  { value: "east", label: "East" },
  { value: "south", label: "South" },
  { value: "west", label: "West" },
];

function propFootprints(tool: PropEditorTool): readonly PropFootprint[] {
  if (tool === "erase") return oneByOneFootprint;
  const [scope, kind] = tool.split(":") as [string, string];
  if (scope === "obstacle") {
    if (kind === Obstacle.Tree) {
      return [
        { width: 1, height: 1, label: "1 x 1" },
        { width: 2, height: 2, label: "2 x 2" },
      ];
    }
    if (kind === Obstacle.Rock) {
      return [
        { width: 1, height: 1, label: "1 x 1" },
        { width: 2, height: 1, label: "2 x 1" },
        { width: 1, height: 2, label: "1 x 2" },
        { width: 2, height: 2, label: "2 x 2" },
        { width: 2, height: 3, label: "2 x 3" },
        { width: 3, height: 3, label: "3 x 3" },
        { width: 4, height: 3, label: "4 x 3" },
        { width: 4, height: 5, label: "4 x 5" },
        { width: 5, height: 4, label: "5 x 4" },
      ];
    }
    return oneByOneFootprint;
  }
  if (scope === "outdoor") return oneByOneFootprint;
  if (scope === "deck") {
    return oneByOneFootprint;
  }
  switch (kind as InteriorPropKind) {
    case "table":
      return [
        { width: 1, height: 1, label: "1 x 1" },
        { width: 2, height: 1, label: "2 x 1" },
        { width: 3, height: 1, label: "3 x 1" },
        { width: 1, height: 2, label: "1 x 2" },
        { width: 1, height: 3, label: "1 x 3" },
        { width: 2, height: 2, label: "2 x 2" },
      ];
    case "bar":
      return [
        { width: 3, height: 1, label: "3 x 1" },
        { width: 4, height: 1, label: "4 x 1" },
        { width: 5, height: 1, label: "5 x 1" },
        { width: 6, height: 1, label: "6 x 1" },
        { width: 7, height: 1, label: "7 x 1" },
        { width: 1, height: 3, label: "1 x 3" },
        { width: 1, height: 4, label: "1 x 4" },
        { width: 1, height: 5, label: "1 x 5" },
        { width: 1, height: 6, label: "1 x 6" },
        { width: 1, height: 7, label: "1 x 7" },
      ];
    case "cabinet":
      return [
        { width: 2, height: 1, label: "2 x 1" },
        { width: 1, height: 2, label: "1 x 2" },
        { width: 1, height: 3, label: "1 x 3" },
      ];
    case "bed":
      return [
        { width: 1, height: 2, label: "1 x 2" },
        { width: 2, height: 1, label: "2 x 1" },
        { width: 2, height: 2, label: "2 x 2" },
      ];
    case "bench":
      return [
        { width: 2, height: 1, label: "2 x 1" },
        { width: 3, height: 1, label: "3 x 1" },
        { width: 4, height: 1, label: "4 x 1" },
        { width: 5, height: 1, label: "5 x 1" },
        { width: 1, height: 2, label: "1 x 2" },
        { width: 1, height: 3, label: "1 x 3" },
        { width: 1, height: 4, label: "1 x 4" },
        { width: 1, height: 5, label: "1 x 5" },
      ];
    case "altar":
    case "hearth":
      return [
        { width: 2, height: 1, label: "2 x 1" },
        { width: 3, height: 1, label: "3 x 1" },
        { width: 1, height: 2, label: "1 x 2" },
        { width: 1, height: 3, label: "1 x 3" },
      ];
    case "tomb":
      return [
        { width: 2, height: 1, label: "2 x 1" },
        { width: 1, height: 2, label: "1 x 2" },
      ];
    case "wall_chain":
      return [{ width: 1, height: 2, label: "1 x 2" }];
    default:
      return oneByOneFootprint;
  }
}

const propFootprintValue = ({ width, height }: PropFootprint) => `${width}x${height}`;

function propFacingOptions(
  tool: PropEditorTool,
  footprint: PropFootprint,
): ReadonlyArray<{ value: Facing; label: string }> {
  if (tool === "erase") return defaultFacingChoice;
  const [scope, kind] = tool.split(":") as [string, string];
  if (scope === "interior") {
    if (kind === "bed") return propFacingChoices;
    if (kind === "cabinet" && footprint.width === 2 && footprint.height === 1) {
      return propFacingChoices.filter(({ value }) =>
        value === "north" || value === "south");
    }
    return defaultFacingChoice;
  }
  if (scope === "deck") {
    if (kind === "cannon") {
      return propFacingChoices.filter(({ value }) =>
        value === "north" || value === "south");
    }
    if (kind === "hatch" || kind === "wheel" ||
      kind === "stairs" || kind === "railing" || kind === "gangway") {
      return propFacingChoices;
    }
  }
  return defaultFacingChoice;
}

function propVariantCount(
  tool: PropEditorTool,
  footprint: PropFootprint,
  facing: Facing,
) {
  if (tool === "erase") return 0;
  const [scope, kind] = tool.split(":") as [string, string];
  if (scope === "obstacle" && kind === Obstacle.Rock) {
    if (footprint.width === 2 && footprint.height === 2) return 14;
    if (footprint.width === 2 && footprint.height === 1) return 3;
    if (footprint.width === 1 && footprint.height === 2) return 9;
    if (footprint.width === 4 && footprint.height === 3) return 2;
    if (
      (footprint.width === 2 && footprint.height === 3) ||
      (footprint.width === 3 && footprint.height === 3) ||
      (footprint.width === 4 && footprint.height === 5) ||
      (footprint.width === 5 && footprint.height === 4)
    ) return 1;
    return 16;
  }
  if (scope !== "interior") return 0;
  switch (kind as InteriorPropKind) {
    case "bed":
      return bedAssetDefinitions(footprint.width === 2 && footprint.height === 2, facing).length;
    case "crate":
      return 4;
    case "bucket":
      return 2;
    case "drawers":
      return 3;
    case "shelf":
      return 7;
    case "flower_pot":
      return 3;
    case "bones":
      return 5;
    case "wall_chain":
      return 2;
    default:
      return 0;
  }
}

function isPropEditorTool(value: string | undefined): value is PropEditorTool {
  if (!value) return false;
  if (value === "erase") return true;
  const [scope, kind] = value.split(":");
  return scope === "obstacle"
    ? placeableObstacles.has(kind as PlaceableObstacleKind)
    : scope === "outdoor"
      ? outdoorProps.has(kind as OutdoorPropKind)
      : scope === "interior"
        ? interiorProps.has(kind as InteriorPropKind)
        : scope === "deck" && deckFeatures.has(kind as DeckFeatureKind);
}

function propCategoryAvailable(category: PropCategory) {
  return category === "all" || category === "outdoor" ||
    category === "interior" || category === "deck";
}

function defaultPropCategory(): PropCategory {
  return "outdoor";
}

function updatePropToolControls() {
  const facingOptions = propFacingOptions(activePropTool, selectedPropFootprint());
  const variantCount = propVariantCount(
    activePropTool,
    selectedPropFootprint(),
    selectedPropFacing(),
  );
  propsFacingInput.disabled = activePropTool === "erase" || facingOptions.length <= 1;
  propsSizeInput.disabled = activePropTool === "erase";
  propsVariantInput.disabled = activePropTool === "erase" || variantCount <= 0;
}

function updatePropSizeOptions() {
  const previousValue = propsSizeInput.value;
  const footprints = propFootprints(activePropTool);
  propsSizeInput.innerHTML = "";
  for (const footprint of footprints) {
    const option = document.createElement("option");
    option.value = propFootprintValue(footprint);
    option.textContent = footprint.label;
    propsSizeInput.append(option);
  }
  const values = new Set(footprints.map(propFootprintValue));
  propsSizeInput.value = values.has(previousValue)
    ? previousValue
    : propFootprintValue(footprints[0]);
}

function updatePropFacingOptions() {
  const previousValue = selectedPropFacing();
  const options = propFacingOptions(activePropTool, selectedPropFootprint());
  propsFacingInput.innerHTML = "";
  for (const { value, label } of options) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    propsFacingInput.append(option);
  }
  const values = new Set(options.map(({ value }) => value));
  propsFacingInput.value = values.has(previousValue)
    ? previousValue
    : options[0].value;
}

function updatePropVariantOptions() {
  const previousValue = propsVariantInput.value;
  const variantCount = propVariantCount(
    activePropTool,
    selectedPropFootprint(),
    selectedPropFacing(),
  );
  propsVariantInput.innerHTML = "";
  const randomOption = document.createElement("option");
  randomOption.value = "";
  randomOption.textContent = "Random";
  propsVariantInput.append(randomOption);
  for (let variant = 0; variant < variantCount; variant += 1) {
    const option = document.createElement("option");
    option.value = String(variant);
    option.textContent = `Variant ${variant + 1}`;
    propsVariantInput.append(option);
  }
  const values = new Set(["", ...Array.from(
    { length: variantCount },
    (_, variant) => String(variant),
  )]);
  propsVariantInput.value = values.has(previousValue) ? previousValue : "";
}

function setPropEditorTool(tool: PropEditorTool) {
  activePropTool = tool;
  for (const button of propToolButtons) {
    const active = button.dataset.propTool === tool;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  updatePropSizeOptions();
  updatePropFacingOptions();
  updatePropVariantOptions();
  updatePropToolControls();
  renderPropEditorPreview();
}

function updatePropEditorForMode() {
  const selectedCategory = isPropCategory(propsCategoryInput.value)
    ? propsCategoryInput.value
    : defaultPropCategory();
  if (selectedCategory !== "all" && !propCategoryAvailable(selectedCategory)) {
    propsCategoryInput.value = defaultPropCategory();
  }
  const category = propsCategoryInput.value as PropCategory;
  const query = propsSearchInput.value.trim().toLowerCase();
  let visibleCount = 0;
  let activeVisible = false;
  for (const button of propToolButtons) {
    const buttonCategory = isPropCategory(button.dataset.propCategory ?? "")
      ? button.dataset.propCategory as PropCategory
      : "all";
    const categoryMatches = category === "all" ||
      buttonCategory === "all" || buttonCategory === category;
    const searchLabel = button.dataset.propLabel ??
      button.textContent?.toLowerCase() ?? "";
    const searchMatches = !query || searchLabel.includes(query);
    const visible = categoryMatches && searchMatches;
    button.hidden = !visible;
    if (!visible) continue;
    visibleCount += 1;
    activeVisible ||= button.dataset.propTool === activePropTool;
  }
  propsEmptyState.hidden = visibleCount > 0;
  if (!activeVisible) setPropEditorTool("erase");
  updatePropFacingOptions();
  updatePropVariantOptions();
  updatePropToolControls();
  renderPropEditorPreview();
}

function selectedPropFacing(): Facing {
  const facing = propsFacingInput.value;
  return facing === "east" || facing === "south" || facing === "west"
    ? facing
    : "north";
}

function selectedPropOrientation(): PropOrientation {
  const footprint = selectedPropFootprint();
  return footprint.height > footprint.width ? "vertical" : "horizontal";
}

function selectedPropFootprint(): PropFootprint {
  const [rawWidth, rawHeight] = propsSizeInput.value.split("x");
  const width = Number(rawWidth);
  const height = Number(rawHeight);
  const selected = propFootprints(activePropTool).find((footprint) =>
    footprint.width === width && footprint.height === height);
  return selected ?? propFootprints(activePropTool)[0];
}

function selectedPropVariant() {
  const value = propsVariantInput.value;
  if (!value) return undefined;
  const variant = Number(value);
  return Number.isInteger(variant) && variant >= 0 ? variant : undefined;
}

function clearTileProps(tile: Tile) {
  tile.obstacle = Obstacle.None;
  delete tile.obstacleId;
  delete tile.outdoorProp;
  delete tile.outdoorPropId;
  delete tile.interiorProp;
  delete tile.interiorPropId;
  delete tile.propVariant;
  delete tile.propOrientation;
  delete tile.propFacing;
  delete tile.deckFeature;
  delete tile.deckFeatureFacing;
}

function clearTilePropFootprint(tile: Tile) {
  const obstacle = tile.obstacle;
  const obstacleId = tile.obstacleId;
  const outdoorProp = tile.outdoorProp;
  const outdoorPropId = tile.outdoorPropId;
  const interiorProp = tile.interiorProp;
  const interiorPropId = tile.interiorPropId;
  const before = tilePropsSignature(tile);
  let changed = false;

  const clearMatching = (matches: (candidate: Tile) => boolean) => {
    for (const row of currentGrid) {
      for (const candidate of row) {
        if (!matches(candidate)) continue;
        const candidateBefore = tilePropsSignature(candidate);
        clearTileProps(candidate);
        changed ||= tilePropsSignature(candidate) !== candidateBefore;
      }
    }
  };

  if (obstacle !== Obstacle.None && obstacleId !== undefined) {
    clearMatching((candidate) =>
      candidate.obstacle === obstacle && candidate.obstacleId === obstacleId);
  } else if (outdoorProp && outdoorPropId !== undefined) {
    clearMatching((candidate) =>
      candidate.outdoorProp === outdoorProp && candidate.outdoorPropId === outdoorPropId);
  } else if (interiorProp && interiorPropId !== undefined) {
    clearMatching((candidate) =>
      candidate.interiorProp === interiorProp && candidate.interiorPropId === interiorPropId);
  } else {
    clearTileProps(tile);
    changed = tilePropsSignature(tile) !== before;
  }

  return changed;
}

function tilePropsSignature(tile: Tile) {
  return [
    tile.obstacle,
    tile.obstacleId ?? "",
    tile.outdoorProp ?? "",
    tile.outdoorPropId ?? "",
    tile.interiorProp ?? "",
    tile.interiorPropId ?? "",
    tile.propVariant ?? "",
    tile.propOrientation ?? "",
    tile.propFacing ?? "",
    tile.deckFeature ?? "",
    tile.deckFeatureFacing ?? "",
  ].join("|");
}

function propFootprintCells(x: number, y: number, footprint: PropFootprint) {
  const cells: Array<{ x: number; y: number; tile: Tile }> = [];
  for (let offsetY = 0; offsetY < footprint.height; offsetY += 1) {
    for (let offsetX = 0; offsetX < footprint.width; offsetX += 1) {
      const cellX = x + offsetX;
      const cellY = y + offsetY;
      const tile = currentGrid[cellY]?.[cellX];
      if (!tile) return undefined;
      cells.push({ x: cellX, y: cellY, tile });
    }
  }
  return cells;
}

function joinedBuildingId(
  cells: Array<{ x: number; y: number; tile: Tile }>,
  fallbackId: number,
) {
  const footprintKeys = new Set(cells.map(({ x, y }) => `${x},${y}`));
  const joinedIds = new Set<number>();
  for (const { x, y } of cells) {
    if (currentGrid[y][x].obstacle === Obstacle.Building) {
      joinedIds.add(currentGrid[y][x].obstacleId ?? fallbackId);
    }
    for (const [offsetX, offsetY] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const neighborX = x + offsetX;
      const neighborY = y + offsetY;
      if (footprintKeys.has(`${neighborX},${neighborY}`)) continue;
      const neighbor = currentGrid[neighborY]?.[neighborX];
      if (neighbor?.obstacle !== Obstacle.Building) continue;
      joinedIds.add(neighbor.obstacleId ?? fallbackId);
    }
  }
  return joinedIds.size ? Math.min(...joinedIds) : fallbackId;
}

function mergeBuildingIds(targetId: number, mergedIds: ReadonlySet<number>) {
  if (!mergedIds.size) return;
  for (const row of currentGrid) {
    for (const tile of row) {
      if (tile.obstacle !== Obstacle.Building) continue;
      const id = tile.obstacleId ?? targetId;
      if (mergedIds.has(id)) tile.obstacleId = targetId;
    }
  }
}

function paintTileProp(x: number, y: number, tool: PropEditorTool) {
  const tile = currentGrid[y]?.[x];
  if (!tile) return false;
  const before = currentGrid.flatMap((row) => row.map(tilePropsSignature)).join("/");
  if (tool === "erase") {
    return clearTilePropFootprint(tile);
  }
  const [scope, kind] = tool.split(":") as [string, string];
  const footprint = selectedPropFootprint();
  const cells = propFootprintCells(x, y, footprint);
  if (!cells) return false;
  const id = nextManualPropId;
  nextManualPropId -= 1;
  const variant = selectedPropVariant();
  if (scope === "obstacle") {
    const obstacle = kind as PlaceableObstacleKind;
    const propId = obstacle === Obstacle.Building
      ? joinedBuildingId(cells, id)
      : id;
    const mergedBuildingIds = new Set<number>();
    for (const cell of cells) {
      if (obstacle === Obstacle.Building && cell.tile.obstacle === Obstacle.Building) {
        clearTileProps(cell.tile);
      } else {
        clearTilePropFootprint(cell.tile);
      }
    }
    for (const cell of cells) {
      cell.tile.obstacle = obstacle;
      cell.tile.obstacleId = propId;
      if (variant !== undefined) cell.tile.propVariant = variant;
    }
    if (obstacle === Obstacle.Building) {
      for (const cell of cells) {
        for (const [offsetX, offsetY] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const neighbor = currentGrid[cell.y + offsetY]?.[cell.x + offsetX];
          if (neighbor?.obstacle !== Obstacle.Building) continue;
          const neighborId = neighbor.obstacleId ?? propId;
          if (neighborId !== propId) mergedBuildingIds.add(neighborId);
        }
      }
      mergeBuildingIds(propId, mergedBuildingIds);
    }
  } else if (scope === "outdoor") {
    for (const cell of cells) {
      clearTilePropFootprint(cell.tile);
    }
    for (const cell of cells) {
      cell.tile.outdoorProp = kind as OutdoorPropKind;
      cell.tile.outdoorPropId = id;
      if (variant !== undefined) cell.tile.propVariant = variant;
    }
  } else if (scope === "interior") {
    for (const cell of cells) {
      clearTilePropFootprint(cell.tile);
    }
    for (const cell of cells) {
      cell.tile.interiorProp = kind as InteriorPropKind;
      cell.tile.interiorPropId = id;
      if (variant !== undefined) cell.tile.propVariant = variant;
      cell.tile.propOrientation = selectedPropOrientation();
      cell.tile.propFacing = selectedPropFacing();
    }
  } else if (scope === "deck") {
    for (const cell of cells) {
      clearTilePropFootprint(cell.tile);
    }
    for (const cell of cells) {
      cell.tile.deckFeature = kind as DeckFeatureKind;
      cell.tile.deckFeatureFacing = selectedPropFacing();
      if (variant !== undefined) cell.tile.propVariant = variant;
    }
  }
  return currentGrid.flatMap((row) => row.map(tilePropsSignature)).join("/") !== before;
}

function applyPropBrush(x: number, y: number) {
  if (!paintTileProp(x, y, activePropTool)) return false;
  markMapEdited();
  renderMap(currentGrid);
  return true;
}

function paintPropsFromPointer(event: PointerEvent) {
  const cell = canvasCellFromPointer(event);
  if (!cell) return;
  const key = `${cell.x}:${cell.y}`;
  if (key === lastPropsPaintedCellKey) return;
  lastPropsPaintedCellKey = key;
  propsStrokeChanged = applyPropBrush(cell.x, cell.y) || propsStrokeChanged;
}

function finishPropsEditorStroke(event: PointerEvent) {
  if (propsPointerId !== event.pointerId) return;
  if (previewCanvas.hasPointerCapture(event.pointerId)) {
    previewCanvas.releasePointerCapture(event.pointerId);
  }
  if (propsStrokeChanged && propsStrokeBackup) {
    propsUndoGrid = propsStrokeBackup;
    propsUndoButton.disabled = false;
  }
  propsPointerId = undefined;
  propsStrokeBackup = undefined;
  propsStrokeChanged = false;
  lastPropsPaintedCellKey = "";
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

  const editingCanvas = tab === "terrain" || tab === "props";
  previewCanvas.classList.toggle("is-editing", editingCanvas);
  previewCanvas.closest<HTMLElement>(".canvas-wrap")?.classList.toggle(
    "is-editing",
    editingCanvas,
  );
  if (tab !== "terrain") {
    editorPointerId = undefined;
    editorStrokeBackup = undefined;
    editorStrokeChanged = false;
    lastPaintedCellKey = "";
  }
  if (tab !== "props") {
    propsPointerId = undefined;
    propsStrokeBackup = undefined;
    propsStrokeChanged = false;
    lastPropsPaintedCellKey = "";
  } else {
    updatePropEditorForMode();
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
for (const button of propToolButtons) {
  const tool = button.dataset.propTool;
  if (!isPropEditorTool(tool)) continue;
  button.addEventListener("click", () => setPropEditorTool(tool));
}
propsSearchInput.addEventListener("input", updatePropEditorForMode);
propsCategoryInput.addEventListener("change", updatePropEditorForMode);
propsSizeInput.addEventListener("change", () => {
  updatePropFacingOptions();
  updatePropVariantOptions();
  updatePropToolControls();
  renderPropEditorPreview();
});
propsFacingInput.addEventListener("change", () => {
  updatePropVariantOptions();
  updatePropToolControls();
  renderPropEditorPreview();
});
propsVariantInput.addEventListener("change", renderPropEditorPreview);
for (const button of controlsTabButtons) {
  const tab = button.dataset.controlsTab;
  if (!isControlsTab(tab)) continue;
  button.addEventListener("click", () => setControlsTab(tab));
}
editorDoneButton.addEventListener("click", () => setControlsTab("generation"));
propsEditorDoneButton.addEventListener("click", () => setControlsTab("generation"));
previewCanvas.addEventListener("pointerdown", (event) => {
  if (
    (activeControlsTab !== "terrain" && activeControlsTab !== "props") ||
    event.button !== 0 ||
    !currentGrid.length
  ) {
    return;
  }
  event.preventDefault();
  previewCanvas.setPointerCapture(event.pointerId);
  if (activeControlsTab === "terrain") {
    editorPointerId = event.pointerId;
    editorStrokeBackup = cloneGrid(currentGrid);
    editorStrokeChanged = false;
    lastPaintedCellKey = "";
    paintFromPointer(event);
  } else {
    propsPointerId = event.pointerId;
    propsStrokeBackup = cloneGrid(currentGrid);
    propsStrokeChanged = false;
    lastPropsPaintedCellKey = "";
    paintPropsFromPointer(event);
  }
});
previewCanvas.addEventListener("pointermove", (event) => {
  if (activeControlsTab === "terrain" && editorPointerId === event.pointerId) {
    event.preventDefault();
    paintFromPointer(event);
  } else if (activeControlsTab === "props" && propsPointerId === event.pointerId) {
    event.preventDefault();
    paintPropsFromPointer(event);
  }
});
previewCanvas.addEventListener("pointerup", (event) => {
  finishEditorStroke(event);
  finishPropsEditorStroke(event);
});
previewCanvas.addEventListener("pointercancel", (event) => {
  finishEditorStroke(event);
  finishPropsEditorStroke(event);
});
editorUndoButton.addEventListener("click", () => {
  if (!editorUndoGrid) return;
  currentGrid = cloneGrid(editorUndoGrid);
  clearEditorUndo();
  markMapEdited();
  renderMap(currentGrid);
});
propsUndoButton.addEventListener("click", () => {
  if (!propsUndoGrid) return;
  currentGrid = cloneGrid(propsUndoGrid);
  clearPropsEditorUndo();
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
    hiddenItems.add(OutdoorProp.Campfire);
    hiddenItems.add(OutdoorProp.LampPost);
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
    renderPropEditorPreview();
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
    renderPropEditorPreview();
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
    renderPropEditorPreview();
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
    renderPropEditorPreview();
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
  renderPropEditorPreview();
});
stylizedLightingInput.addEventListener("change", () => renderMap(currentGrid));
collectTilesetImages({ tilesetImage, tilesetTerrain }).forEach((image) => {
  image.addEventListener("load", () => {
    if (!tilesetReady() || tilesetTerrainReadyLogged) return;
    tilesetTerrainReadyLogged = true;
    console.info("[tileset] All terrain assets loaded", tilesetTerrainStatus());
    if (useTilesetInput.checked) renderMap(currentGrid);
    renderPropEditorPreview();
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
    renderPropEditorPreview();
  });
  image.addEventListener("error", () => {
    console.error("[tileset] Failed to load prop asset", {
      source: image.currentSrc || image.src,
      ...tilesetPropsStatus(activePreset.mode),
    });
    if (useTilesetInput.checked) renderMap(currentGrid);
    renderPropEditorPreview();
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
setPropEditorTool(activePropTool);
updatePropEditorForMode();
setControlsTab(activeControlsTab);
applyPreset(PRESETS[0]);
generate();
