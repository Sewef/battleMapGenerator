import { Terrain, type LandscapeMode, type TerrainKind } from "../domain/map";

export const SOURCE_TILE_SIZE = 32;
export const TILESET_BLOCK_SIZE = 3;
const HORIZONTAL_SLOT_SIZE = 5;
const HORIZONTAL_COORDINATE_STEP = 2;

export interface TileBlock {
  x: number;
  y: number;
}

export interface TerrainTiles {
  block: TileBlock;
  quarters?: TileBlock;
}

interface BiomeTileset {
  file: string;
  terrains: Partial<Record<TerrainKind, TerrainTiles>>;
}

const biomeTilesets: Partial<Record<LandscapeMode, BiomeTileset>> = {
  "desert-canyon": {
    file: "1.png",
    terrains: {
      [Terrain.Ground]: { block: { x: 2, y: 3 } },
      [Terrain.Difficult]: {
        block: { x: 4, y: 3 },
        quarters: { x: 5, y: 3 },
      },
    },
  },
  sewer: {
    file: "1.png",
    terrains: {
      [Terrain.Water]: { block: { x: 0, y: 1 } },
    },
  },
  underground: {
    file: "1.png",
    terrains: {
      [Terrain.Water]: { block: { x: 0, y: 1 } },
    },
  },
};

const sharedTerrains: Partial<Record<
  TerrainKind,
  {
    file: string;
    block: TileBlock;
    includedModes?: LandscapeMode[];
    excludedModes?: LandscapeMode[];
  }
>> = {
  [Terrain.Ground]: {
    file: "1.png",
    block: { x: 0, y: 0 },
    includedModes: [
      "countryside",
      "river",
      "coast",
      "wetlands",
      "ancient-forest",
      "farmland",
      "archipelago",
    ],
  },
  [Terrain.Difficult]: {
    file: "1.png",
    block: { x: 4, y: 6 },
    includedModes: [
      "countryside",
      "river",
      "coast",
      "wetlands",
      "ancient-forest",
      "farmland",
      "archipelago",
    ],
  },
  [Terrain.Water]: {
    file: "1.png",
    block: { x: 0, y: 2 },
  },
  [Terrain.Beach]: {
    file: "1.png",
    block: { x: 2, y: 4 },
  },
  [Terrain.Lava]: {
    file: "1.png",
    block: { x: 4, y: 0 },
  },
  [Terrain.Cliff]: {
    file: "5.png",
    block: { x: 0, y: 0 },
  },
};

export const tilesetFiles = [...new Set([
  ...Object.values(biomeTilesets).map(({ file }) => file),
  ...Object.values(sharedTerrains).map(({ file }) => file),
])];

export function terrainTileset(
  mode: LandscapeMode,
  terrain: TerrainKind,
): { file: string; tiles: TerrainTiles } | undefined {
  const biome = biomeTilesets[mode];
  const biomeTiles = biome?.terrains[terrain];
  if (biome && biomeTiles) return { file: biome.file, tiles: biomeTiles };

  const shared = sharedTerrains[terrain];
  if (
    !shared ||
    (shared.includedModes && !shared.includedModes.includes(mode)) ||
    shared.excludedModes?.includes(mode)
  ) {
    return undefined;
  }
  return { file: shared.file, tiles: { block: shared.block } };
}

export function atlasTile(
  block: TileBlock,
  offsetX = 1,
  offsetY = 1,
) {
  // The atlas stores each 3×3 block in a five-tile-wide horizontal slot.
  // User-facing X positions are 0, 2, 4; they map to slot starts 0, 5, 10.
  const slot = Math.floor(block.x / HORIZONTAL_COORDINATE_STEP);
  const areaOffset = block.x % HORIZONTAL_COORDINATE_STEP === 0 ? 0 : 3;
  return {
    x: slot * HORIZONTAL_SLOT_SIZE + areaOffset + offsetX,
    y: block.y * TILESET_BLOCK_SIZE + offsetY,
  };
}
