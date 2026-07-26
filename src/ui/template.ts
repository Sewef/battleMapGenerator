import { PRESETS } from "../domain/biomes";

export const PARAMETER_FIELDS = [
  { id: "water", key: "waterWeight", label: "Water / lava", min: 0, max: 200, step: 10, percent: true, group: "terrain" },
  { id: "difficult", key: "difficultWeight", label: "Difficult terrain", min: 0, max: 200, step: 10, percent: true, group: "terrain" },
  { id: "relief", key: "reliefWeight", label: "Cliffs / ravines", min: 0, max: 200, step: 10, percent: true, group: "terrain" },
  { id: "rocks", key: "rockRatio", label: "Rocks", min: 0, max: 12, step: 1, percent: true, group: "obstacles" },
  { id: "trees", key: "treeRatio", label: "Trees", min: 0, max: 32, step: 1, percent: true, group: "obstacles" },
  { id: "buildings", key: "buildingCount", label: "Buildings", min: 0, max: 8, step: 1, percent: false, group: "obstacles" },
] as const;

export function renderApp(root: HTMLElement) {
  root.innerHTML = `
    <main class="shell">
      <header class="topbar">
        <a class="brand" href="#" aria-label="Terra, home">
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

          ${[
            ["terrain", "Terrain weight"],
            ["obstacles", "Obstacle population"],
          ].map(([group, title]) => `
          <div class="parameter-section">
            <p>${title}</p>
            ${PARAMETER_FIELDS.filter((field) => field.group === group).map((field) => `
              <label class="field compact">
                <span>${field.label} <output id="${field.id}-value"></output></span>
                <input id="${field.id}" type="range" min="${field.min}" max="${field.max}" step="${field.step}" />
              </label>
            `).join("")}
          </div>
          `).join("")}

          <button id="generate" class="primary-button" type="button">Generate map <span>→</span></button>
        </aside>

        <div class="map-panel">
          <div class="map-toolbar">
            <div><strong>Map preview</strong><span id="dimensions"></span></div>
            <div class="export-actions">
              <button id="download" class="download-button" type="button">Export WebP ↓</button>
            </div>
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
}
