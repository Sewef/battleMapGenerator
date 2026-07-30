import { PRESETS } from "../domain/biomes";
import {
  Obstacle,
  Terrain,
  tileSurface,
  type Grid,
} from "../domain/map";
import { generateTerrain } from "./generate";

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
  for (let index = 0; index < 6; index += 1) {
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
