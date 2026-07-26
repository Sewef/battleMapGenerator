import "./style.css";
import {
  generateTerrain,
  Obstacle,
  PRESETS,
  Terrain,
  type Grid,
  type Preset,
  type TerrainKind,
} from "./generator";

const randomSeed = () =>
  `${["moor", "mist", "oak", "flint", "dawn"][Math.floor(Math.random() * 5)]}-${Math.floor(1000 + Math.random() * 9000)}`;

const parameterFields = [
  { id: "rocks", key: "rockRatio", label: "Rocks", min: 0, max: 12, step: 1, percent: true },
  { id: "trees", key: "treeRatio", label: "Trees", min: 0, max: 32, step: 1, percent: true },
  { id: "buildings", key: "buildingCount", label: "Buildings", min: 0, max: 8, step: 1, percent: false },
] as const;

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <main class="shell">
    <header class="topbar">
      <a class="brand" href="#" aria-label="Terra, accueil">
        <span class="brand-mark" aria-hidden="true">T</span><span>Terra</span>
      </a>
      <div class="status"><span></span> Prototype 02</div>
    </header>

    <section class="hero">
      <div>
        <p class="eyebrow">Outdoor terrain generator</p>
        <h1>Shape the landscape.<br /><em>Set the stage for battle.</em></h1>
      </div>
      <p class="intro">Terrain, movement rules, and obstacles come together as a complete tactical map — reproducible and ready to export.</p>
    </section>

    <section class="preset-section">
      <div class="section-label">Map generator</div>
      <div class="preset-list">
        ${PRESETS.map((preset) => `
          <button class="preset-card" type="button" data-preset="${preset.id}">
            <span class="preset-icon ${preset.id}" aria-hidden="true"></span>
            <span><strong>${preset.name}</strong><small>${preset.description}</small></span>
          </button>
        `).join("")}
      </div>
    </section>

    <section class="workspace">
      <aside class="controls">
        <div class="panel-heading">
          <span>Settings</span>
          <button id="reset" class="text-button" type="button">Reset</button>
        </div>

        <label class="field">
          <span>Seed</span>
          <span class="seed-row">
            <input id="seed" type="text" spellcheck="false" />
            <button id="randomize" class="icon-button" type="button" aria-label="Random seed" title="Random seed">↻</button>
          </span>
        </label>

        <div class="field-group">
          <label class="field">
            <span>Width <output id="width-value"></output></span>
            <input id="width" type="range" min="16" max="64" step="2" />
          </label>
          <label class="field">
            <span>Height <output id="height-value"></output></span>
            <input id="height" type="range" min="12" max="48" step="2" />
          </label>
        </div>

        <label class="field">
          <span>Biome size <output id="scale-value"></output></span>
          <input id="scale" type="range" min="4" max="14" step="1" />
        </label>

        <div class="parameter-section">
          <p>Obstacle population</p>
          ${parameterFields.map((field) => `
            <label class="field compact">
              <span>${field.label} <output id="${field.id}-value"></output></span>
              <input id="${field.id}" type="range" min="${field.min}" max="${field.max}" step="${field.step}" />
            </label>
          `).join("")}
        </div>

        <button id="generate" class="primary-button" type="button">Generate map <span>→</span></button>
      </aside>

      <div class="map-panel">
        <div class="map-toolbar">
          <div><strong>Map preview</strong><span id="dimensions"></span></div>
          <button id="download" class="download-button" type="button">Export PNG ↓</button>
        </div>
        <div class="canvas-wrap">
          <canvas id="map" aria-label="Generated terrain grid"></canvas>
        </div>
        <div class="map-footer">
          <div class="legend" id="legend"></div>
          <p class="map-note"><span>◆</span> Obstacles are generated on a separate layer from terrain.</p>
        </div>
      </div>
    </section>
  </main>
`;

const canvas = document.querySelector<HTMLCanvasElement>("#map")!;
const context = canvas.getContext("2d")!;
const seedInput = document.querySelector<HTMLInputElement>("#seed")!;
const widthInput = document.querySelector<HTMLInputElement>("#width")!;
const heightInput = document.querySelector<HTMLInputElement>("#height")!;
const scaleInput = document.querySelector<HTMLInputElement>("#scale")!;
const inputs = Object.fromEntries(
  parameterFields.map(({ id }) => [id, document.querySelector<HTMLInputElement>(`#${id}`)!]),
) as Record<(typeof parameterFields)[number]["id"], HTMLInputElement>;
let activePreset = PRESETS[0];
let currentGrid: Grid = [];

const terrainStyle: Record<TerrainKind, { color: string; alt: string; label: string }> = {
  [Terrain.Void]: { color: "#263334", alt: "#222f30", label: "Void" },
  [Terrain.Ground]: { color: "#b8ca8e", alt: "#afc382", label: "Ground" },
  [Terrain.Difficult]: { color: "#9fa96c", alt: "#949f61", label: "Difficult · ×2" },
  [Terrain.Water]: { color: "#7ea7a7", alt: "#739c9e", label: "Water · ×2" },
  [Terrain.Beach]: { color: "#d8c68f", alt: "#cfbb80", label: "Beach · ×2" },
  [Terrain.Road]: { color: "#aa9475", alt: "#a28b6c", label: "Road" },
  [Terrain.Bridge]: { color: "#876d4f", alt: "#7e6448", label: "Bridge" },
  [Terrain.Rock]: { color: "#85877c", alt: "#7a7d72", label: "Rock · blocks sight" },
  [Terrain.Cliff]: { color: "#6f7165", alt: "#64675c", label: "Cliff · blocks sight" },
  [Terrain.Ravine]: { color: "#776b59", alt: "#6c604f", label: "Ravine · clear sight" },
};

function applyPreset(preset: Preset, useNewSeed = true) {
  activePreset = preset;
  widthInput.value = String(preset.width);
  heightInput.value = String(preset.height);
  scaleInput.value = String(preset.scale);
  for (const field of parameterFields) {
    const value = preset[field.key];
    inputs[field.id].value = String(field.percent ? Number(value) * 100 : value);
  }
  if (useNewSeed || !seedInput.value) seedInput.value = randomSeed();
  document.querySelectorAll(".preset-card").forEach((card) => {
    card.classList.toggle("active", (card as HTMLElement).dataset.preset === preset.id);
  });
  updateLabels();
}

function updateLabels() {
  document.querySelector("#width-value")!.textContent = widthInput.value;
  document.querySelector("#height-value")!.textContent = heightInput.value;
  document.querySelector("#scale-value")!.textContent = scaleInput.value;
  for (const field of parameterFields) {
    document.querySelector(`#${field.id}-value`)!.textContent =
      field.percent ? `${inputs[field.id].value}%` : inputs[field.id].value;
  }
}

function drawTree(x: number, y: number, size: number) {
  const centerX = x * size + size / 2;
  const centerY = y * size + size / 2;
  context.fillStyle = "#344f3e";
  context.beginPath();
  context.arc(centerX, centerY, size * 0.32, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#5e7855";
  context.beginPath();
  context.arc(centerX - size * 0.08, centerY - size * 0.08, size * 0.2, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#d7d3b6";
  context.beginPath();
  context.arc(centerX, centerY, Math.max(1.2, size * 0.06), 0, Math.PI * 2);
  context.fill();
}

function drawBuilding(x: number, y: number, size: number, grid: Grid) {
  const id = grid[y][x].obstacleId;
  context.fillStyle = (id ?? 0) % 2 === 0 ? "#a85d43" : "#bb6e4b";
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  context.strokeStyle = "rgba(73, 44, 35, .55)";
  context.lineWidth = 1;
  if (grid[y - 1]?.[x].obstacleId !== id) {
    context.beginPath();
    context.moveTo(x * size, y * size + 1);
    context.lineTo((x + 1) * size, y * size + 1);
    context.stroke();
  }
  if (grid[y + 1]?.[x].obstacleId !== id) {
    context.beginPath();
    context.moveTo(x * size, (y + 1) * size - 1);
    context.lineTo((x + 1) * size, (y + 1) * size - 1);
    context.stroke();
  }
}

function drawGrid(grid: Grid) {
  if (!grid.length) return;
  const rows = grid.length;
  const columns = grid[0].length;
  const cellSize = Math.max(12, Math.min(28, Math.floor(850 / columns)));
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const width = columns * cellSize;
  const height = rows * cellSize;

  canvas.width = width * pixelRatio;
  canvas.height = height * pixelRatio;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

  const counts = new Map<string, number>();
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const tile = grid[y][x];
      const style = terrainStyle[tile.terrain];
      context.fillStyle = (x + y * 3) % 4 === 0 ? style.alt : style.color;
      context.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);

      if (tile.terrain === Terrain.Water) {
        context.strokeStyle = "rgba(223, 239, 229, .28)";
        context.beginPath();
        context.moveTo(x * cellSize + cellSize * .18, y * cellSize + cellSize * .55);
        context.lineTo(x * cellSize + cellSize * .78, y * cellSize + cellSize * .55);
        context.stroke();
      } else if (tile.terrain === Terrain.Beach) {
        context.fillStyle = "rgba(111, 92, 59, .25)";
        context.beginPath();
        context.arc(x * cellSize + cellSize * .3, y * cellSize + cellSize * .42, Math.max(1, cellSize * .05), 0, Math.PI * 2);
        context.arc(x * cellSize + cellSize * .7, y * cellSize + cellSize * .68, Math.max(1, cellSize * .04), 0, Math.PI * 2);
        context.fill();
      } else if (tile.terrain === Terrain.Road || tile.terrain === Terrain.Bridge) {
        context.strokeStyle = tile.terrain === Terrain.Bridge
          ? "rgba(238, 221, 180, .5)"
          : "rgba(238, 225, 196, .25)";
        context.lineWidth = Math.max(1, cellSize * .08);
        const centerX = x * cellSize + cellSize * .5;
        const centerY = y * cellSize + cellSize * .5;
        for (const [offsetX, offsetY] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const neighbor = grid[y + offsetY]?.[x + offsetX];
          if (neighbor?.terrain === Terrain.Road || neighbor?.terrain === Terrain.Bridge) {
            context.beginPath();
            context.moveTo(centerX, centerY);
            context.lineTo(centerX + offsetX * cellSize * .5, centerY + offsetY * cellSize * .5);
            context.stroke();
          }
        }
        context.lineWidth = 1;
      } else if (tile.terrain === Terrain.Difficult) {
        context.fillStyle = "rgba(64, 75, 49, .35)";
        context.fillRect(x * cellSize + cellSize * .2, y * cellSize + cellSize * .68, cellSize * .08, cellSize * .16);
        context.fillRect(x * cellSize + cellSize * .7, y * cellSize + cellSize * .22, cellSize * .07, cellSize * .13);
      } else if (tile.terrain === Terrain.Rock) {
        context.fillStyle = "rgba(238, 233, 216, .34)";
        context.beginPath();
        context.moveTo(x * cellSize + cellSize * .18, y * cellSize + cellSize * .72);
        context.lineTo(x * cellSize + cellSize * .32, y * cellSize + cellSize * .3);
        context.lineTo(x * cellSize + cellSize * .68, y * cellSize + cellSize * .2);
        context.lineTo(x * cellSize + cellSize * .84, y * cellSize + cellSize * .67);
        context.closePath();
        context.fill();
      } else if (tile.terrain === Terrain.Ravine) {
        context.strokeStyle = "rgba(35, 37, 31, .55)";
        context.beginPath();
        context.moveTo(x * cellSize + 2, y * cellSize + cellSize * .72);
        context.lineTo(x * cellSize + cellSize * .45, y * cellSize + cellSize * .3);
        context.lineTo((x + 1) * cellSize - 2, y * cellSize + cellSize * .48);
        context.stroke();
      } else if (tile.terrain === Terrain.Cliff) {
        context.fillStyle = "rgba(235, 229, 207, .22)";
        context.beginPath();
        context.moveTo(x * cellSize + cellSize * .12, y * cellSize + cellSize * .75);
        context.lineTo(x * cellSize + cellSize * .5, y * cellSize + cellSize * .18);
        context.lineTo(x * cellSize + cellSize * .88, y * cellSize + cellSize * .75);
        context.fill();
      }

      context.strokeStyle = "rgba(239, 235, 218, 0.14)";
      context.lineWidth = 1;
      context.strokeRect(x * cellSize + .5, y * cellSize + .5, cellSize - 1, cellSize - 1);
      counts.set(tile.terrain, (counts.get(tile.terrain) ?? 0) + 1);
    }
  }

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const tile = grid[y][x];
      if (tile.obstacle === Obstacle.Tree) drawTree(x, y, cellSize);
      if (tile.obstacle === Obstacle.Building) drawBuilding(x, y, cellSize, grid);
      if (tile.obstacle !== Obstacle.None) {
        counts.set(tile.obstacle, (counts.get(tile.obstacle) ?? 0) + 1);
      }
    }
  }

  const legendItems = [
    ...Object.values(Terrain).map((kind) => ({
      key: kind,
      label: terrainStyle[kind].label,
      className: kind,
    })),
    { key: Obstacle.Tree, label: "Tree · blocks sight", className: "tree" },
    { key: Obstacle.Building, label: "Building · blocks sight", className: "building" },
  ].filter(({ key }) => (counts.get(key) ?? 0) > 0);

  document.querySelector("#legend")!.innerHTML = legendItems.map(({ key, label, className }) =>
    `<span><i class="swatch ${className}"></i>${label}<small>${counts.get(key)}</small></span>`,
  ).join("");
  document.querySelector("#dimensions")!.textContent = `${columns} × ${rows} cells`;
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
  drawGrid(currentGrid);
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
  const link = document.createElement("a");
  link.download = `terra-${seedInput.value.trim() || "terrain"}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
});
for (const input of [widthInput, heightInput, scaleInput, ...Object.values(inputs)]) {
  input.addEventListener("input", updateLabels);
}
window.addEventListener("resize", () => drawGrid(currentGrid));

applyPreset(PRESETS[0]);
generate();
