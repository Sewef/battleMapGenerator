import "./style.css";
import {
  generateTerrain,
  PRESETS,
  type Grid,
  type Preset,
} from "./generator";
import { drawGrid } from "./rendering/canvas";
import { PARAMETER_FIELDS, renderApp } from "./ui/template";
import { copyWebpForOwlbear, downloadWebp } from "./export/webp";

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

function updateOwlbearResolution() {
  const dpi = Number(document.querySelector<HTMLInputElement>("#owlbear-dpi")?.value || 150);
  const columns = Number(widthInput.value || 0);
  const rows = Number(heightInput.value || 0);
  const label = document.querySelector("#owlbear-resolution");
  if (label) label.textContent = `${columns * dpi} × ${rows * dpi}px`;
}

function updateLabels() {
  document.querySelector("#width-value")!.textContent = widthInput.value;
  document.querySelector("#height-value")!.textContent = heightInput.value;
  document.querySelector("#scale-value")!.textContent = scaleInput.value;
  for (const field of PARAMETER_FIELDS) {
    document.querySelector(`#${field.id}-value`)!.textContent =
      field.percent ? `${inputs[field.id].value}%` : inputs[field.id].value;
  }
  updateOwlbearResolution();
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
  downloadWebp(currentGrid, activePreset.mode, seedInput.value.trim());
});
document.querySelector("#copy")!.addEventListener("click", async () => {
  const button = document.querySelector<HTMLButtonElement>("#copy")!;
  const defaultLabel = "Copy map";
  try {
    const dpiInput = document.querySelector<HTMLInputElement>("#owlbear-dpi")!;
    const dpi = Math.max(50, Math.min(300, Number(dpiInput.value) || 150));
    dpiInput.value = String(dpi);
    updateOwlbearResolution();
    await copyWebpForOwlbear(currentGrid, activePreset.mode, dpi);
    button.textContent = "Copied!";
  } catch {
    button.textContent = "Copy failed";
  }
  window.setTimeout(() => {
    button.textContent = defaultLabel;
  }, 1800);
});

document.querySelector("#owlbear-dpi")!.addEventListener("input", updateOwlbearResolution);
for (const input of [widthInput, heightInput, scaleInput, ...Object.values(inputs)]) {
  input.addEventListener("input", updateLabels);
}
window.addEventListener("resize", () => renderMap(currentGrid));

applyPreset(PRESETS[0]);
generate();
