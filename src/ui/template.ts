import { PRESETS } from "../domain/biomes";
import type { LandscapeMode } from "../domain/map";

export const PARAMETER_FIELDS = [
  { id: "water", key: "waterWeight", label: "Water / lava", min: 0, max: 200, step: 10, percent: true, group: "terrain" },
  { id: "difficult", key: "difficultWeight", label: "Difficult terrain", min: 0, max: 200, step: 10, percent: true, group: "terrain" },
  { id: "relief", key: "reliefWeight", label: "Cliffs / ravines", min: 0, max: 200, step: 10, percent: true, group: "terrain" },
  { id: "rocks", key: "rockRatio", label: "Rocks", min: 0, max: 12, step: 1, percent: true, group: "obstacles" },
  { id: "trees", key: "treeRatio", label: "Trees", min: 0, max: 32, step: 1, percent: true, group: "obstacles" },
  { id: "buildings", key: "buildingCount", label: "Buildings", min: 0, max: 8, step: 1, percent: false, group: "obstacles" },
] as const;

export type ParameterId = (typeof PARAMETER_FIELDS)[number]["id"];

export const BIOME_PARAMETER_PROFILES: Record<
  LandscapeMode,
  Partial<Record<ParameterId, string>>
> = {
  countryside: { water: "Pond coverage", rocks: "Rock density", trees: "Tree density", buildings: "Farm buildings" },
  river: { water: "River width", rocks: "Rock density", trees: "Riverbank trees", buildings: "Buildings" },
  coast: { water: "Sea coverage", rocks: "Coastal rocks", trees: "Tree density", buildings: "Buildings" },
  wetlands: { water: "Wetland coverage", difficult: "Mud coverage", rocks: "Rock density", trees: "Vegetation density", buildings: "Buildings" },
  underground: { water: "Pool frequency", difficult: "Rough floor", rocks: "Rock density" },
  volcanic: { water: "Lava coverage", difficult: "Ash coverage", relief: "Volcanic ridges", rocks: "Rock density" },
  highlands: { relief: "Ridges / ravines", rocks: "Rock density", trees: "Tree density", buildings: "Buildings" },
  city: { difficult: "Damaged ground", trees: "Street trees", buildings: "Urban density" },
  "desert-canyon": { water: "Oasis size", difficult: "Scree coverage", relief: "Canyon relief", rocks: "Rock density", trees: "Vegetation density", buildings: "Buildings" },
  "ancient-forest": { water: "Stream width", difficult: "Undergrowth", rocks: "Rock density", trees: "Forest density", buildings: "Ruins / buildings" },
  "frozen-lake": { water: "Frozen basin size", difficult: "Snowdrifts", rocks: "Rock density", trees: "Tree density", buildings: "Buildings" },
  badlands: { difficult: "Broken ground", relief: "Ridge density", rocks: "Rock density", trees: "Dry vegetation", buildings: "Buildings" },
  "ruined-battlefield": { difficult: "Crater / trench density", rocks: "Debris density", trees: "Vegetation density", buildings: "Ruined structures" },
  farmland: { difficult: "Field coverage", rocks: "Rock density", trees: "Hedgerow trees", buildings: "Farm buildings" },
  archipelago: { water: "Island separation", rocks: "Coastal rocks", trees: "Vegetation density", buildings: "Buildings" },
  "mountain-pass": { difficult: "Mountain scree", relief: "Mountain mass", rocks: "Rock density", trees: "Tree density", buildings: "Buildings" },
  sewer: { water: "Channel width", rocks: "Debris density" },
  "ancient-ruins": { difficult: "Overgrowth", rocks: "Rubble density", trees: "Vegetation density", buildings: "Ruined structures" },
};

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

          ${[
      ["terrain", "Terrain weight"],
      ["obstacles", "Obstacle population"],
    ].map(([group, title]) => `
          <div class="parameter-section" data-parameter-group="${group}">
            <div class="parameter-heading">
              <p>${title}</p>
              <button class="text-button parameter-random-button" type="button" data-randomize-group="${group}">Random</button>
            </div>
            ${PARAMETER_FIELDS.filter((field) => field.group === group).map((field) => `
              <label class="field compact" id="${field.id}-field">
                <span><span id="${field.id}-label">${field.label}</span> <output id="${field.id}-value"></output></span>
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
              <div class="map-content-actions">
                <label class="grid-option preview-option">
                  <input id="preview-grid" type="checkbox" />
                  <span>Preview grid</span>
                </label>
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
            <details class="custom-prop-settings" id="custom-prop-settings">
              <summary>
                <span>Custom tree &amp; rock images</span>
                <small>Optional tileset overrides</small>
              </summary>
              <div class="custom-prop-body">
                <p>Square direct image URLs. Empty fields use the standard tileset props.</p>
                <div class="custom-prop-fields">
                  <label class="owlbear-field">
                    <span>Tree image URL <small>Optional</small></span>
                    <input id="custom-tree-url" name="tree-prop-url" type="url" inputmode="url" autocomplete="url" autocapitalize="none" spellcheck="false" placeholder="https://example.com/tree.png" />
                    <span class="prop-preview" id="custom-tree-preview">
                      <img src="/assets/tilesets/tree_1x1.png" alt="Tree prop preview" />
                      <small>Tileset fallback</small>
                    </span>
                  </label>
                  <label class="owlbear-field">
                    <span>Rock image URL <small>Optional</small></span>
                    <input id="custom-rock-url" name="rock-prop-url" type="url" inputmode="url" autocomplete="url" autocapitalize="none" spellcheck="false" placeholder="https://example.com/rock.png" />
                    <span class="prop-preview" id="custom-rock-preview">
                      <img src="/assets/tilesets/rock_1x1.png" alt="Rock prop preview" />
                      <small>Tileset fallback</small>
                    </span>
                  </label>
                </div>
                <p class="custom-prop-notice">Used only when the tileset is enabled. The image host must allow cross-origin canvas use and remain publicly accessible to Owlbear.</p>
              </div>
            </details>
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
              <p class="export-description">Export the current rendering, or a clean background ready for separate Owlbear props.</p>
              <div class="webp-options">
                <label class="grid-option">
                  <input id="show-grid" type="checkbox" />
                  <span>Export grid</span>
                </label>
              </div>
              <div class="webp-variants">
                <div class="export-variant">
                  <div>
                    <strong>Complete map</strong>
                    <span>Terrain, buildings, trees and rocks baked into one image.</span>
                  </div>
                  <div>
                    <button id="copy-webp-with-props" class="download-button" type="button">Copy</button>
                    <button id="download-webp-with-props" class="owlbear-primary-button" type="button">Download</button>
                  </div>
                </div>
                <div class="export-variant">
                  <div>
                    <strong>Background only</strong>
                    <span>Trees and rocks removed; buildings remain part of the map.</span>
                  </div>
                  <div>
                    <button id="copy-webp-background" class="download-button" type="button">Copy</button>
                    <button id="download-webp-background" class="owlbear-primary-button" type="button">Download</button>
                  </div>
                </div>
              </div>
              <p id="webp-status" role="status" aria-live="polite"></p>
            </div>
            <div class="export-card owlbear-export" aria-labelledby="owlbear-title">
            <div class="owlbear-heading">
              <div>
                <p class="eyebrow">Virtual tabletop</p>
                <h3 id="owlbear-title">Owlbear Rodeo</h3>
              </div>
            </div>
            <p class="export-description">Create a ready-to-import Owlbear token set with the current map as its background and trees and rocks as editable props.</p>
            <ol class="owlbear-instructions">
              <li>Clicking either button renders and uploads the background automatically. The <strong>Export grid</strong> option also applies here.</li>
              <li>Paste the copied JSON directly into an open Owlbear scene, you can also download the JSON file.</li>
              <li>Trees and rocks become separate props. Buildings and all other visual effects remain baked into the background.</li>
            </ol>
            <div class="owlbear-notice">
              <strong>Temporary background hosting</strong>
              <p>The uploaded WebP expires after 30 days maximum, so keep the <strong>Background only</strong> download for long-term use.</p>
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
      <footer class="asset-credit">
        <span>Art credits</span>
        <p>
          Tileset assets from
          <a href="https://opengameart.org/content/16x16-game-assets" target="_blank" rel="noopener noreferrer">16x16 Game Assets</a>
          by George Bailey · CC BY 4.0
        </p>
      </footer>
    </main>
  `;
}
