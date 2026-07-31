import { PRESETS } from "../domain/biomes";
import {
  Obstacle,
  Terrain,
  tileSurface,
  type Grid,
  type TerrainOptions,
} from "../domain/map";
import { generateTerrain } from "./generate";
import {
  buildGeneratedMapUrl,
  parseGeneratedMapRequest,
} from "../export/map-request";
import { renderMapSvg } from "../rendering/svg";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertGrid(grid: Grid, label: string) {
  assert(grid.length > 0 && grid[0].length > 0, `${label}: empty grid`);
  for (const row of grid) {
    assert(row.length === grid[0].length, `${label}: ragged grid`);
    for (const tile of row) {
      assert(
        tile.height !== undefined && tile.height >= 0 && tile.height <= 1,
        `${label}: invalid height`,
      );
      if (tile.terrain === Terrain.Cliff) {
        assert(
          tile.elevation !== undefined &&
            tile.elevation >= 1 &&
            tile.elevation <= 3,
          `${label}: invalid cliff elevation`,
        );
      }
      const surface = tileSurface(tile);
      assert(
        tile.obstacle !== Obstacle.Building || !surface,
        `${label}: building overlaps a road`,
      );
      assert(
        tile.obstacle === Obstacle.None || !surface,
        `${label}: obstacle overlaps a road or bridge`,
      );
      if (surface === Terrain.Bridge) {
        assert(
          tile.terrain === Terrain.Water || tile.terrain === Terrain.Ravine,
          `${label}: bridge without a crossing`,
        );
      }
      assert(
        surface !== Terrain.Road || tile.terrain !== Terrain.Cliff,
        `${label}: road crosses an uncarved cliff`,
      );
      if (tile.transition) {
        assert(
          surface === Terrain.Road &&
            (tile.terrain === Terrain.Ground ||
              tile.terrain === Terrain.Difficult),
          `${label}: invalid elevation transition`,
        );
        assert(
          Number.isFinite(tile.transitionNormalX) &&
            Number.isFinite(tile.transitionNormalY) &&
            Math.hypot(
              tile.transitionNormalX ?? 0,
              tile.transitionNormalY ?? 0,
            ) > .9,
          `${label}: invalid transition normal (${tile.transitionNormalX}, ${tile.transitionNormalY})`,
        );
      }
      if (
        tile.obstacle !== Obstacle.None &&
        tile.terrain !== Terrain.Ground &&
        tile.terrain !== Terrain.Difficult
      ) {
        assert(
          tile.obstacle === Obstacle.Building && surface === Terrain.Road,
          `${label}: obstacle on invalid terrain`,
        );
      }
    }
  }
}

let generated = 0;
for (const preset of PRESETS) {
  for (let index = 0; index < 3; index += 1) {
    const options = { ...preset, seed: `audit-${index}` };
    const grid = generateTerrain(options);
    assertGrid(grid, `${preset.id}:${index}`);
    if (index === 0) {
      const duplicate = generateTerrain(options);
      assert(
        JSON.stringify(grid) === JSON.stringify(duplicate),
        `${preset.id}: generation is not deterministic`,
      );
    }
    generated += 1;
  }
}

console.log(`Generation invariants passed for ${generated} maps.`);

const volcanicPreset = PRESETS.find(({ mode }) => mode === "volcanic")!;
const renderOptions: TerrainOptions = {
  width: 24,
  height: 16,
  seed: "svg-round-trip",
  scale: volcanicPreset.scale,
  mode: volcanicPreset.mode,
  waterWeight: volcanicPreset.waterWeight,
  difficultWeight: volcanicPreset.difficultWeight,
  reliefWeight: volcanicPreset.reliefWeight,
  rockRatio: volcanicPreset.rockRatio,
  treeRatio: volcanicPreset.treeRatio,
  buildingCount: volcanicPreset.buildingCount,
};
const renderGrid = generateTerrain(renderOptions);
const hiddenItems = new Set<string>([Obstacle.Tree, Obstacle.Rock]);
const svg = renderMapSvg(renderGrid, renderOptions.mode, {
  cellSize: 16,
  stylizedLighting: true,
  hiddenItems,
  hiddenOpacity: 0,
});
assert(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'), "invalid SVG root");
assert(svg.includes('width="384" height="256"'), "invalid SVG dimensions");
assert(!svg.includes("NaN") && !svg.includes("undefined"), "invalid SVG number");
assert(
  svg === renderMapSvg(renderGrid, renderOptions.mode, {
    cellSize: 16,
    stylizedLighting: true,
    hiddenItems,
    hiddenOpacity: 0,
  }),
  "SVG rendering is not deterministic",
);

const generatedUrl = buildGeneratedMapUrl(
  "https://maps.example.test/app",
  renderOptions,
  {
    cellSize: 48,
    useTileset: true,
    stylizedLighting: true,
    hiddenItems,
  },
);
const parsedRequest = parseGeneratedMapRequest(new URL(generatedUrl));
assert(
  JSON.stringify(parsedRequest.options) === JSON.stringify(renderOptions),
  "generated map options did not round-trip",
);
assert(
  JSON.stringify(generateTerrain(parsedRequest.options)) ===
    JSON.stringify(renderGrid),
  "server-side generation did not reproduce the exported grid",
);
assert(
  parsedRequest.renderOptions.hiddenItems.join(",") === "rock,tree",
  "hidden map items were not canonicalized",
);
assert(
  buildGeneratedMapUrl(
    "https://maps.example.test",
    parsedRequest.options,
    parsedRequest.renderOptions,
  ) === generatedUrl,
  "generated map URL is not canonical",
);

console.log("Generated map URL and SVG invariants passed.");

const maximumUrl = buildGeneratedMapUrl(
  "https://maps.example.test",
  {
    ...renderOptions,
    width: 64,
    height: 48,
    seed: "\u0800".repeat(128),
  },
  { cellSize: 64, stylizedLighting: true },
);
assert(
  maximumUrl.length <= 16 * 1024,
  `maximum generated map URL is too long (${maximumUrl.length} characters)`,
);

console.log(`Maximum generated map URL: ${maximumUrl.length} characters.`);
