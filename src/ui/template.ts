import { PRESETS } from "../domain/biomes";

export const PARAMETER_FIELDS = [
  { id: "water", key: "waterWeight", label: "Water / lava", min: 0, max: 200, step: 10, percent: true, group: "terrain" },
  { id: "difficult", key: "difficultWeight", label: "Difficult terrain", min: 0, max: 200, step: 10, percent: true, group: "terrain" },
  { id: "relief", key: "reliefWeight", label: "Cliffs / ravines", min: 0, max: 200, step: 10, percent: true, group: "terrain" },
  { id: "rocks", key: "rockRatio", label: "Rocks", min: 0, max: 12, step: 1, percent: true, group: "obstacles" },
  { id: "trees", key: "treeRatio", label: "Trees", min: 0, max: 32, step: 1, percent: true, group: "obstacles" },
  { id: "buildings", key: "buildingCount", label: "Buildings", min: 0, max: 8, step: 1, percent: false, group: "obstacles" },
] as const;

const PRESET_GROUPS = [
  {
    label: "Nature",
    ids: ["countryside", "river", "coast", "wetlands", "ancient-forest", "farmland", "archipelago"],
  },
  {
    label: "Harsh lands",
    ids: ["desert-canyon", "badlands", "frozen-lake", "highlands", "mountain-pass", "volcanic"],
  },
  {
    label: "Settlements & ruins",
    ids: ["city", "ancient-ruins", "ruined-battlefield", "sewer", "underground"],
  },
] as const;

export function renderApp(root: HTMLElement) {
  root.innerHTML = `
    <main class="shell">
      <header class="topbar">
        <a class="brand" href="#" aria-label="Touch Grass, home">
          <span class="brand-mark" aria-hidden="true"><img src="/assets/touchgrasslogo.png" alt="" /></span><span>Touch Grass</span>
        </a>
      </header>

      <section class="preset-section">
        <div class="preset-groups">
          ${PRESET_GROUPS.map((group) => {
            const initiallyOpen = group.ids.some((id) => id === PRESETS[0].id);
            return `
            <section class="preset-group${initiallyOpen ? " is-open" : ""}">
              <button class="preset-group-heading" type="button" aria-expanded="${initiallyOpen}" data-preset-group>
                <span>${group.label}</span><span aria-hidden="true">⌄</span>
              </button>
              <div class="preset-list">
                ${group.ids.map((id) => PRESETS.find((preset) => preset.id === id)!)
                  .map((preset) => `
                    <button class="preset-card" type="button" data-preset="${preset.id}">
                      <span class="preset-icon ${preset.id}" aria-hidden="true"></span>
                      <span><strong>${preset.name}</strong><small>${preset.description}</small></span>
                    </button>
                  `).join("")}
              </div>
            </section>`;
          }).join("")}
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
            <label class="grid-option preview-option">
              <input id="preview-grid" type="checkbox" checked />
              <span>Preview grid</span>
            </label>
          </div>
          <div class="canvas-wrap">
            <canvas id="map" aria-label="Generated terrain grid"></canvas>
          </div>
          <section class="map-content-panel" aria-labelledby="map-content-title">
            <div class="map-content-heading">
              <div>
                <p class="eyebrow">Shared settings</p>
                <h2 id="map-content-title">Map content</h2>
                <p>These settings affect the preview, WebP and Owlbear exports.</p>
              </div>
              <div class="shared-render-options">
                <label class="grid-option">
                  <input id="use-tileset" type="checkbox" />
                  <span>Use tileset</span>
                </label>
                <label class="grid-option" title="Adds directional relief, ambient shading and subtle light emitted by liquids.">
                  <input id="stylized-lighting" type="checkbox" checked />
                  <span>Stylized lighting</span>
                </label>
              </div>
            </div>
            <div class="map-footer">
              <div class="legend" id="legend"></div>
              <p class="map-note"><span>◆</span> Click legend items to include or exclude layers everywhere.</p>
            </div>
          </section>
          <section class="export-panel" aria-labelledby="export-title">
            <div class="export-panel-heading">
              <p class="eyebrow">Files &amp; virtual tabletops</p>
              <h2 id="export-title">Export your map</h2>
              <p>Shared content above is already applied. Only format-specific settings appear here.</p>
            </div>
            <div class="export-card webp-export">
              <div class="export-card-heading">
                <div>
                  <p class="eyebrow">Image</p>
                  <h3>WebP export</h3>
                </div>
                <span class="export-format">.WEBP</span>
              </div>
              <p class="export-description">A compact image with the current terrain and selected props.</p>
              <div class="webp-options">
                <label class="grid-option">
                  <input id="show-grid" type="checkbox" checked />
                  <span>Include grid in WebP</span>
                </label>
              </div>
              <button id="download" class="owlbear-primary-button export-wide-button" type="button">Download WebP ↓</button>
            </div>
            <div class="export-card owlbear-export" aria-labelledby="owlbear-title">
            <div class="owlbear-heading">
              <div>
                <p class="eyebrow">Virtual tabletop</p>
                <h3 id="owlbear-title">Owlbear Rodeo</h3>
              </div>
              <label class="grid-option owlbear-grid-option">
                <input id="owlbear-grid" type="checkbox" />
                <span>Include grid in Owlbear</span>
              </label>
            </div>
            <div class="owlbear-options">
              <label class="owlbear-field">
                <span>Tree prop URL <small>Optional</small></span>
                <input id="owlbear-tree-url" name="owlbear-tree-prop-url" type="url" inputmode="url" autocomplete="url" autocapitalize="none" spellcheck="false" placeholder="Direct URL" />
                <span class="prop-preview" id="owlbear-tree-preview">
                  <img alt="Tree prop preview" />
                  <small>Loading default prop…</small>
                </span>
              </label>
              <label class="owlbear-field">
                <span>Rock prop URL <small>Optional</small></span>
                <input id="owlbear-rock-url" name="owlbear-rock-prop-url" type="url" inputmode="url" autocomplete="url" autocapitalize="none" spellcheck="false" placeholder="Direct URL" />
                <span class="prop-preview" id="owlbear-rock-preview">
                  <img alt="Rock prop preview" />
                  <small>Loading default prop…</small>
                </span>
              </label>
            </div>
            <div class="owlbear-notice">
              <strong>Public image hosting</strong>
              <p>The map background is uploaded anonymously to Litterbox. The resulting URL is public and expires after 72 hours; after that, the background will no longer load. Consider downloading a local copy with the WebP export.</p>
            </div>
            <div class="owlbear-instructions">
              <span>1</span>
              <p>Export or copy the generated JSON.</p>
              <span>2</span>
              <p>Open your Owlbear scene and paste the JSON into the scene.</p>
            </div>
            <div class="owlbear-actions">
              <p id="owlbear-status" role="status" aria-live="polite"></p>
              <button id="copy-owlbear" class="owlbear-primary-button" type="button">Copy JSON</button>
              <button id="download-owlbear" class="download-button" type="button">Download JSON ↓</button>
            </div>
            </div>
          </section>
        </div>
      </section>
    </main>
  `;
}
