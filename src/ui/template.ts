import { DEFAULT_PRESET_ID, PRESETS } from "../domain/biomes";
import {
  DECK_FEATURE_RULES,
  INTERIOR_PROP_RULES,
  OBSTACLE_RULES,
  Obstacle,
  OUTDOOR_PROP_RULES,
  Terrain,
  TERRAIN_RULES,
  type LandscapeMode,
  type TerrainKind,
} from "../domain/map";

export const PARAMETER_FIELDS = [
  { id: "water", key: "waterWeight", label: "Water / lava", min: 0, max: 200, step: 10, percent: true, group: "terrain" },
  { id: "difficult", key: "difficultWeight", label: "Difficult terrain", min: 0, max: 200, step: 10, percent: true, group: "terrain" },
  { id: "relief", key: "reliefWeight", label: "Cliffs / ravines", min: 0, max: 200, step: 10, percent: true, group: "terrain" },
  { id: "rocks", key: "rockRatio", label: "Rocks", min: 0, max: 12, step: 1, percent: true, group: "obstacles" },
  { id: "trees", key: "treeRatio", label: "Trees", min: 0, max: 32, step: 1, percent: true, group: "obstacles" },
  { id: "buildings", key: "buildingCount", label: "Buildings", min: 0, max: 8, step: 1, percent: false, group: "obstacles" },
  { id: "lights", key: "lightPropRatio", label: "Light props", min: 0, max: 5, step: .5, percent: true, group: "lighting" },
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
  house: { buildings: "Rooms", lights: "Light props" },
  spaceship: { buildings: "Compartments" },
  ship: { buildings: "Cabins / holds", lights: "Light props" },
  "ship-deck": { buildings: "Deck areas" },
  castle: { buildings: "Chambers", lights: "Light props" },
  cathedral: { buildings: "Halls / chapels", lights: "Light props" },
  tavern: { buildings: "Rooms", lights: "Light props" },
  crypt: { buildings: "Vaults", lights: "Light props" },
};

const PRESET_GROUPS = [
  {
    label: "Interiors",
    ids: ["house", "tavern", "castle", "cathedral", "crypt", "ship", "ship-deck", "spaceship"],
  },
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

const EDITOR_TERRAINS: TerrainKind[] = [
  Terrain.Ground,
  Terrain.Difficult,
  Terrain.Water,
  Terrain.Ice,
  Terrain.Lava,
  Terrain.Beach,
  Terrain.Cliff,
  Terrain.Ravine,
  Terrain.Void,
  Terrain.Road,
  Terrain.Bridge,
  Terrain.Wall,
  Terrain.Door,
];

type PropToolCategory = "outdoor" | "interior" | "deck";

const PROP_EDITOR_TOOLS: Array<{
  value: string;
  category: PropToolCategory;
  label: string;
  swatch: string;
}> = [
  {
    value: `obstacle:${Obstacle.Tree}`,
    category: "outdoor",
    label: OBSTACLE_RULES[Obstacle.Tree].label,
    swatch: "tree",
  },
  {
    value: `obstacle:${Obstacle.Rock}`,
    category: "outdoor",
    label: OBSTACLE_RULES[Obstacle.Rock].label,
    swatch: "rock",
  },
  {
    value: `obstacle:${Obstacle.Building}`,
    category: "outdoor",
    label: OBSTACLE_RULES[Obstacle.Building].label,
    swatch: "building",
  },
  ...Object.entries(OUTDOOR_PROP_RULES).map(([kind, rule]) => ({
    value: `outdoor:${kind}`,
    category: "outdoor" as const,
    label: rule.label,
    swatch: kind,
  })),
  ...Object.entries(INTERIOR_PROP_RULES).map(([kind, rule]) => ({
    value: `interior:${kind}`,
    category: "interior" as const,
    label: rule.label,
    swatch: `prop-${kind}`,
  })),
  ...Object.entries(DECK_FEATURE_RULES).map(([kind, rule]) => ({
    value: `deck:${kind}`,
    category: "deck" as const,
    label: rule.label,
    swatch: `deck-${kind}`,
  })),
];

export function renderApp(root: HTMLElement) {
  const initialPresetGroupIndex = Math.max(
    0,
    PRESET_GROUPS.findIndex((group) =>
      group.ids.some((id) => id === DEFAULT_PRESET_ID)
    ),
  );
  root.innerHTML = `
    <main class="shell">
      <header class="topbar">
        <a class="brand" href="#" aria-label="Touch Grass, home">
          <span class="brand-mark" aria-hidden="true"><img src="/assets/touchgrasslogo.png" alt="" /></span><span>Touch Grass</span>
        </a>
        <div class="header-actions">
          <button id="copy-owlbear-manifest" class="manifest-button" type="button">Copy Owlbear manifest</button>
          <span id="manifest-status" role="status" aria-live="polite"></span>
        </div>
      </header>

      <section class="preset-section">
        <div class="preset-groups">
          <div class="preset-tabs" role="tablist" aria-label="Map categories">
            ${PRESET_GROUPS.map((group, index) => {
    const active = index === initialPresetGroupIndex;
    return `
              <button id="preset-group-tab-${index}" class="preset-group-tab${active ? " active" : ""}" type="button" role="tab" aria-selected="${active}" aria-controls="preset-group-panel-${index}" data-preset-group-tab="${index}">
                ${group.label}
              </button>`;
  }).join("")}
          </div>
          <div class="preset-panels">
            ${PRESET_GROUPS.map((group, index) => {
    const active = index === initialPresetGroupIndex;
    return `
            <section id="preset-group-panel-${index}" class="preset-group" role="tabpanel" aria-labelledby="preset-group-tab-${index}"${active ? "" : " hidden"}>
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
        </div>
      </section>

      <section class="workspace">
        <aside class="controls">
          <div class="controls-tabs" role="tablist" aria-label="Map tools">
            <button id="generation-tab" class="controls-tab active" type="button" role="tab" aria-selected="true" aria-controls="generation-settings" data-controls-tab="generation">Generation</button>
            <button id="terrain-editor-tab" class="controls-tab" type="button" role="tab" aria-selected="false" aria-controls="terrain-editor-settings" data-controls-tab="terrain">Terrain editor</button>
            <button id="props-editor-tab" class="controls-tab" type="button" role="tab" aria-selected="false" aria-controls="props-editor-settings" data-controls-tab="props">Props editor</button>
          </div>
          <section class="controls-view generation-settings" id="generation-settings" role="tabpanel" aria-labelledby="generation-tab">
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
      ["lighting", "Lighting"],
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
          <div class="generation-actions">
            <button id="reset" class="download-button" type="button">Reset</button>

          <button id="generate" class="primary-button" type="button">Generate map <span>→</span></button>
          </div>
          </section>

          <section class="controls-view editor-settings" id="terrain-editor-settings" hidden role="tabpanel" aria-labelledby="terrain-editor-tab">
            <div class="editor-terrain-list" role="group" aria-label="Terrain brush">
              ${EDITOR_TERRAINS.map((terrain) => `
                <button class="editor-terrain-button" type="button" data-editor-terrain="${terrain}">
                  <i class="swatch ${terrain}" aria-hidden="true"></i>
                  <span>${TERRAIN_RULES[terrain].label}</span>
                </button>
              `).join("")}
            </div>
            <div class="editor-tool-options">
              <label class="editor-select-field">
                <span>Brush</span>
                <select id="editor-brush-size">
                  <option value="1">1 cell</option>
                  <option value="3">3 cells</option>
                  <option value="5">5 cells</option>
                </select>
              </label>
              <label class="editor-select-field">
                <span>Cliff level</span>
                <select id="editor-elevation">
                  <option value="1">Low</option>
                  <option value="2">Mid</option>
                  <option value="3">High</option>
                </select>
              </label>
              <button id="editor-undo" class="download-button" type="button" disabled>Undo</button>
            </div>
            <button id="editor-done" class="download-button" type="button">Done</button>
          </section>

          <section class="controls-view props-editor-settings" id="props-editor-settings" hidden role="tabpanel" aria-labelledby="props-editor-tab">
            <div class="props-editor-toolbar">
              <label class="editor-search-field">
                <span>Search</span>
                <input id="props-search" type="search" autocomplete="off" spellcheck="false" placeholder="Filter props" />
              </label>
              <label class="editor-select-field">
                <span>Category</span>
                <select id="props-category">
                  <option value="outdoor">Outdoor</option>
                  <option value="interior">Interior</option>
                  <option value="deck">Deck</option>
                  <option value="all">All</option>
                </select>
              </label>
            </div>
            <div class="prop-tool-list" role="group" aria-label="Prop palette">
              <button class="prop-tool-button active" type="button" data-prop-tool="erase" data-prop-category="all" data-prop-label="erase remove clear">
                <i class="swatch erase" aria-hidden="true"></i>
                <span>Erase</span>
                <small>All</small>
              </button>
              ${PROP_EDITOR_TOOLS.map((tool) => `
                <button class="prop-tool-button" type="button" data-prop-tool="${tool.value}" data-prop-category="${tool.category}" data-prop-label="${tool.label.toLowerCase()} ${tool.value.replace(":", " ")}">
                  <i class="swatch ${tool.swatch}" aria-hidden="true"></i>
                  <span>${tool.label}</span>
                  <small>${tool.category}</small>
                </button>
              `).join("")}
            </div>
            <p id="props-empty-state" class="props-empty-state" hidden>No matching props.</p>
            <div class="editor-tool-options props-editor-options">
              <div class="prop-selection-preview" aria-label="Selected prop preview">
                <canvas id="prop-selection-preview" aria-hidden="true"></canvas>
              </div>
              <label class="editor-select-field">
                <span>Size</span>
                <select id="props-size">
                  <option value="1x1">1 x 1</option>
                </select>
              </label>
              <label class="editor-select-field">
                <span>Facing</span>
                <select id="props-facing">
                  <option value="north">North</option>
                  <option value="east">East</option>
                  <option value="south">South</option>
                  <option value="west">West</option>
                </select>
              </label>
              <label class="editor-select-field prop-variant-field">
                <span>Variant</span>
                <select id="props-variant">
                  <option value="">Random</option>
                </select>
              </label>
              <button id="props-editor-undo" class="download-button" type="button" disabled>Undo</button>
            </div>
            <button id="props-editor-done" class="download-button" type="button">Done</button>
          </section>
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
            <details class="map-content-details">
              <summary>
                <span>Layer filters &amp; prop overrides</span>
                <small>Legend, custom images</small>
              </summary>
            <div class="map-content-details-body">
            <details class="wall-debug-settings" hidden>
              <summary>
                <span>Wall render debug</span>
                <small>Preview only</small>
              </summary>
              <div class="wall-debug-grid">
                <label class="grid-option"><input type="checkbox" data-wall-debug="underlay" /><span>Underlay</span></label>
                <label class="grid-option"><input type="checkbox" data-wall-debug="shadow" /><span>Shadow</span></label>
                <label class="grid-option"><input type="checkbox" data-wall-debug="surface" /><span>Surface</span></label>
                <label class="grid-option"><input type="checkbox" data-wall-debug="edge" /><span>Edges</span></label>
                <label class="grid-option"><input type="checkbox" data-wall-debug="highlight" /><span>Highlights</span></label>
                <label class="grid-option"><input type="checkbox" data-wall-debug="path" /><span>Paths</span></label>
                <label class="grid-option"><input type="checkbox" data-wall-debug="junction" /><span>Junctions</span></label>
                <label class="grid-option"><input type="checkbox" data-wall-debug="door" /><span>Doors</span></label>
              </div>
            </details>
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
                      <img src="/assets/tilesets/bailey/tree_1x1.png" alt="Tree prop preview" />
                      <small>Tileset fallback</small>
                    </span>
                  </label>
                  <label class="owlbear-field">
                    <span>Rock image URL <small>Optional</small></span>
                    <input id="custom-rock-url" name="rock-prop-url" type="url" inputmode="url" autocomplete="url" autocapitalize="none" spellcheck="false" placeholder="https://example.com/rock.png" />
                    <span class="prop-preview" id="custom-rock-preview">
                      <img src="/assets/tilesets/bailey/rock_1x1.png" alt="Rock prop preview" />
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
              </div>
            </details>
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
                    <span>Terrain, buildings and painted props baked into one image.</span>
                  </div>
                  <div>
                    <button id="copy-webp-with-props" class="download-button" type="button">Copy</button>
                    <button id="download-webp-with-props" class="owlbear-primary-button" type="button">Download</button>
                  </div>
                </div>
                <div class="export-variant">
                  <div>
                    <strong>Background only</strong>
                    <span>Trees, rocks and outdoor placeholders removed; buildings remain part of the map.</span>
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
            <p id="owlbear-description" class="export-description">Create a ready-to-import Owlbear token set with the current map as its background and editable props.</p>
            <ol id="owlbear-site-instructions" class="owlbear-instructions">
              <li>Copy or download the JSON, then paste it into an open Owlbear scene.</li>
              <li>The export renders and uploads the background automatically. The <strong>Export grid</strong> option also applies here.</li>
              <li>The background stays unlocked for alignment. With scene snapping enabled, move only the map into place: every prop, room outline and door follows it. Lock the map afterwards.</li>
              <li>Trees, rocks and outdoor placeholders become separate props. Buildings and visual effects remain baked into the background.</li>
            </ol>
            <ol id="owlbear-extension-instructions" class="owlbear-instructions" hidden>
              <li>Add the generated map directly to the current Owlbear scene.</li>
              <li>The import renders and uploads the background automatically. The <strong>Export grid</strong> option also applies here.</li>
              <li>All inserted items are selected after import so you can move the map and attached props together.</li>
              <li>Lock the background once aligned. Trees, rocks and outdoor placeholders remain editable props.</li>
            </ol>
            <label class="grid-option owlbear-fog-option">
              <input id="owlbear-dynamic-fog" type="checkbox" />
              Add Dynamic Fog to terrain, buildings, rooms and doors
            </label>
            <div id="owlbear-hosting-notice" class="owlbear-notice">
              <strong>Temporary background hosting</strong>
              <p>The uploaded WebP expires after 30 days maximum, so keep the <strong>Background only</strong> download for long-term use.</p>
            </div>
            <div class="owlbear-actions">
              <p id="owlbear-status" role="status" aria-live="polite"></p>
              <button id="import-owlbear" class="owlbear-primary-button" type="button" hidden>Add to scene</button>
              <button id="download-owlbear-terrain" class="download-button" type="button" hidden>Download terrain</button>
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
          <span class="footer-separator" aria-hidden="true">·</span>
          <a href="https://opengameart.org/art-search-advanced?keys=lpc" target="_blank" rel="noopener noreferrer">LPC</a>
          by Various Artists · CC-BY-SA 3.0 · GPL 3.0
          <span class="footer-separator" aria-hidden="true">·</span>
          <a class="discord-link" href="https://discord.gg/AZkX28fb64" target="_blank" rel="noopener noreferrer">Join my Discord</a>
        </p>
      </footer>
    </main>
  `;
}
