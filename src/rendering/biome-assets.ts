import type { LandscapeMode } from "../domain/map";

export const TILESET_ASSET_ROOT = "/assets/tilesets";

export type TilesetAssetFolder = "ai" | "bailey" | "lpc";
export type TilesetProfileName = "grass" | "sand" | "mountain" | "snow";
export type RockFamily = "normal" | "light" | "dark" | "desert" | "snow";
export type TerrainTextureName =
  | "beachSand"
  | "coldWater"
  | "desertSand"
  | "grass"
  | "grassRough"
  | "ice"
  | "lava"
  | "sandRough"
  | "snow"
  | "tiledSoil"
  | "water";

export interface BiomeAssetProfile {
  atlas: TilesetProfileName;
  rockFamily: RockFamily;
  groundTexture?: TerrainTextureName;
  difficultTexture?: TerrainTextureName;
  waterTexture: "water" | "coldWater";
  interiorFloorTile?: 0 | 1 | 2 | 3;
}

const outdoorProfile = (
  overrides: Partial<BiomeAssetProfile> = {},
): BiomeAssetProfile => ({
  atlas: "grass",
  rockFamily: "normal",
  groundTexture: "grass",
  difficultTexture: "grassRough",
  waterTexture: "water",
  ...overrides,
});

const interiorProfile = (
  interiorFloorTile: 0 | 1 | 2 | 3,
): BiomeAssetProfile => ({
  atlas: "grass",
  rockFamily: "normal",
  waterTexture: "water",
  interiorFloorTile,
});

/**
 * The single source of truth for biome-to-asset selection. Every mode is
 * listed so adding a biome causes a type error until its asset policy is
 * explicitly chosen.
 */
export const BIOME_ASSET_PROFILES: Readonly<
  Record<LandscapeMode, BiomeAssetProfile>
> = {
  countryside: outdoorProfile(),
  river: outdoorProfile(),
  coast: outdoorProfile({ rockFamily: "light" }),
  wetlands: outdoorProfile(),
  underground: outdoorProfile({
    atlas: "mountain",
    rockFamily: "dark",
    groundTexture: undefined,
    difficultTexture: undefined,
  }),
  volcanic: outdoorProfile({
    atlas: "mountain",
    rockFamily: "dark",
    groundTexture: undefined,
    difficultTexture: undefined,
  }),
  highlands: outdoorProfile({
    atlas: "mountain",
    groundTexture: undefined,
    difficultTexture: undefined,
  }),
  city: outdoorProfile(),
  "desert-canyon": outdoorProfile({
    atlas: "sand",
    rockFamily: "desert",
    groundTexture: "desertSand",
    difficultTexture: "sandRough",
  }),
  "ancient-forest": outdoorProfile(),
  "frozen-lake": outdoorProfile({
    atlas: "snow",
    rockFamily: "snow",
    groundTexture: "snow",
    difficultTexture: undefined,
    waterTexture: "coldWater",
  }),
  badlands: outdoorProfile({
    atlas: "sand",
    rockFamily: "desert",
    groundTexture: "desertSand",
    difficultTexture: "sandRough",
  }),
  "ruined-battlefield": outdoorProfile(),
  farmland: outdoorProfile({ difficultTexture: "tiledSoil" }),
  archipelago: outdoorProfile({ rockFamily: "light" }),
  "mountain-pass": outdoorProfile({
    atlas: "mountain",
    groundTexture: undefined,
    difficultTexture: undefined,
  }),
  sewer: outdoorProfile({
    atlas: "mountain",
    rockFamily: "dark",
    groundTexture: undefined,
    difficultTexture: undefined,
  }),
  "ancient-ruins": outdoorProfile(),
  house: interiorProfile(0),
  spaceship: interiorProfile(3),
  ship: interiorProfile(0),
  "ship-deck": interiorProfile(0),
  castle: interiorProfile(2),
  cathedral: interiorProfile(3),
  tavern: interiorProfile(0),
  crypt: interiorProfile(2),
};

export function biomeAssetProfile(mode: LandscapeMode) {
  return BIOME_ASSET_PROFILES[mode];
}

export function tilesetAssetPath(
  folder: TilesetAssetFolder,
  relativePath: string,
) {
  return `${TILESET_ASSET_ROOT}/${folder}/${relativePath}`;
}

const ROCK_FAMILY_STEMS: Readonly<Record<RockFamily, string>> = {
  normal: "rock",
  light: "rock_light",
  dark: "rock_dark",
  desert: "rock_desert",
  snow: "rock_snow",
};

export const ROCK_ASSET_VARIANTS = {
  oneByOne: { count: 16, footprint: "1x1" },
  oneByTwo: { count: 9, footprint: "1x2" },
  twoByOne: { count: 3, footprint: "2x1" },
  twoByTwo: { count: 14, footprint: "2x2" },
  twoByThree: { count: 1, footprint: "2x3" },
  threeByThree: { count: 1, footprint: "3x3" },
  fourByThree: { count: 2, footprint: "4x3" },
  fourByFive: { count: 1, footprint: "4x5" },
  fiveByFour: { count: 1, footprint: "5x4" },
} as const;

export function rockAssetName(
  family: RockFamily,
  index: number,
  footprint: string,
) {
  return `${ROCK_FAMILY_STEMS[family]}_${index}_${footprint}.png`;
}

export function defaultOutdoorPropAssetPath(
  kind: "tree" | "rock",
  footprint?: "1x1" | "2x2",
) {
  const name = footprint ? `${kind}_${footprint}.png` : `${kind}.png`;
  return tilesetAssetPath("bailey", name);
}
