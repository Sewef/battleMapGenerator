import "./style.css";
import {
  generateTerrain,
  PRESETS,
  type Grid,
  type Preset,
} from "./generator";
import { drawGrid } from "./rendering/canvas";
import { PARAMETER_FIELDS, renderApp } from "./ui/template";
import { downloadWebp } from "./export/webp";

const randomSeed = () =>
  `${["moor", "mist", "oak", "flint", "dawn"][Math.floor(Math.random() * 5)]}-${Math.floor(1000 + Math.random() * 9000)}`;

renderApp(document.querySelector<HTMLDivElement>("#app")!);

const previewCanvas = document.querySelector<HTMLCanvasElement>("#map")!;
const seedInput = document.querySelector<HTMLInputElement>("#seed")!;
const widthInput = document.querySelector<HTMLInputElement>("#width")!;
const heightInput = document.querySelector<HTMLInputElement>("#height")!;
const scaleInput = document.querySelector<HTMLInputElement>("#scale")!;
const inputs = Object.fromEntries(
  PARAMETER_FIELDS.map(({ id }) => [
    id,
    document.querySelector<HTMLInputElement>(`#${id}`)!,
  ]),
) as Record<(typeof PARAMETER_FIELDS)[number]["id"], HTMLInputElement>;

let activePreset = PRESETS[0];
let currentGrid: Grid = [];
const hiddenLegendItems = new Set<string>();

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
  );
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
