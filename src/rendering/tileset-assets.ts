import type { LandscapeMode } from "../domain/map";

export interface InteriorPropSpriteLayout {
  renderWidthCells: number;
  renderHeightCells: number;
  anchor: "center" | "bottom";
}

const DEFAULT_INTERIOR_PROP_SPRITE_LAYOUT: InteriorPropSpriteLayout = {
  renderWidthCells: 1,
  renderHeightCells: 1,
  anchor: "center",
};

const interiorAssetSpriteLayouts: Record<string, InteriorPropSpriteLayout> = {};
export const INTERIOR_ASSET_SPRITE_LAYOUTS: Readonly<
  Record<string, InteriorPropSpriteLayout>
> = interiorAssetSpriteLayouts;

export function interiorAssetSpriteLayout(assetName: string) {
  const declaredLayout = INTERIOR_ASSET_SPRITE_LAYOUTS[assetName];
  if (declaredLayout) return declaredLayout;
  const verticalAltar = /^altar_vertical_1x(\d+)\.png$/.exec(assetName);
  if (verticalAltar) {
    return {
      renderWidthCells: 1,
      renderHeightCells: Number(verticalAltar[1]) + 1,
      anchor: "bottom" as const,
    };
  }
  const verticalCabinet = /^cabinet_vertical_1x(\d+)\.png$/.exec(assetName);
  if (verticalCabinet) {
    return {
      renderWidthCells: 1,
      renderHeightCells: Number(verticalCabinet[1]) + 1,
      anchor: "bottom" as const,
    };
  }
  const horizontalComposite = /^(table|counter|bench)_horizontal_(\d+)x1\.png$/.exec(assetName);
  if (horizontalComposite) {
    return {
      renderWidthCells: Number(horizontalComposite[2]),
      renderHeightCells: horizontalComposite[1] === "bench" ? 1 : 2,
      anchor: horizontalComposite[1] === "bench" ? "center" as const : "bottom" as const,
    };
  }
  const verticalComposite = /^(table|counter|bench)_vertical_1x(\d+)\.png$/.exec(assetName);
  if (verticalComposite) {
    return {
      renderWidthCells: 1,
      renderHeightCells: Number(verticalComposite[2]),
      anchor: "center" as const,
    };
  }
  return INTERIOR_ASSET_SPRITE_LAYOUTS[assetName] ?? DEFAULT_INTERIOR_PROP_SPRITE_LAYOUT;
}

const TILESET_ROOT = "/assets/tilesets";

const bailey = (name: string) => `${TILESET_ROOT}/bailey/${name}`;
const lpc = (name: string) => `${TILESET_ROOT}/lpc/${name}`;

export type InteriorAssetFolder = "ai" | "bailey" | "lpc";

const interiorAssetFolders: Record<string, InteriorAssetFolder> = {};

export function interiorAssetFolder(assetName: string): InteriorAssetFolder {
  return interiorAssetFolders[assetName] ?? "lpc";
}

export const interiorAssetPath = (assetName: string) =>
  `${interiorAssetFolder(assetName)}/${assetName}`;

export interface TilesetAssetDefinition {
  source: string;
  visual?: InteriorPropSpriteLayout;
}

const assetDefinition = (
  source: string,
  visual?: InteriorPropSpriteLayout,
): TilesetAssetDefinition => ({ source, visual });

const interiorAssetDefinition = (
  assetName: string,
  visual?: InteriorPropSpriteLayout,
  folder: InteriorAssetFolder = "lpc",
) => {
  interiorAssetFolders[assetName] = folder;
  if (visual) interiorAssetSpriteLayouts[assetName] = visual;
  return assetDefinition(`${TILESET_ROOT}/${folder}/${assetName}`, visual);
};

const bottomLayout = (
  renderWidthCells: number,
  renderHeightCells: number,
): InteriorPropSpriteLayout => ({
  renderWidthCells,
  renderHeightCells,
  anchor: "bottom",
});

const centeredLayout = (
  renderWidthCells: number,
  renderHeightCells: number,
): InteriorPropSpriteLayout => ({
  renderWidthCells,
  renderHeightCells,
  anchor: "center",
});

export type FurnitureFacing = "north" | "east" | "south" | "west";

export interface BedAssetDefinition {
  folder: "bed_children" | "bed_double" | "bed_single";
  name: string;
  width: number;
  height: number;
  // Point in the trimmed image aligned with the center of the occupied cells.
  anchorX: number;
  anchorY: number;
}

const BED_COLORS = ["blue", "brown", "green", "purple", "red", "white", "yellow"] as const;
const CHILD_BED_COLORS = [...BED_COLORS, "grey"] as const;

function gridAlignedBedLayout(doubleBed: boolean, horizontal: boolean) {
  const width = doubleBed || horizontal ? 64 : 32;
  const height = doubleBed || !horizontal ? 64 : 32;
  return {
    width,
    height,
    anchorX: width / 2,
    anchorY: height / 2,
  };
}

export function bedAssetDefinitions(
  doubleBed: boolean,
  facing: FurnitureFacing,
): BedAssetDefinition[] {
  const horizontal = facing === "east" || facing === "west";
  if (doubleBed) {
    return BED_COLORS.flatMap((color) => ["plain", "patterned"].map((style) => ({
      folder: "bed_double" as const,
      name: `${color}_${style}_${facing}.png`,
      ...gridAlignedBedLayout(true, horizontal),
    })));
  }
  const singleBeds = BED_COLORS.map((color) => ({
    folder: "bed_single" as const,
    name: `${color}_${facing}.png`,
    ...gridAlignedBedLayout(false, horizontal),
  }));
  const childBeds = CHILD_BED_COLORS.map((color) => ({
    folder: "bed_children" as const,
    name: `${color}_${facing}.png`,
    ...gridAlignedBedLayout(false, horizontal),
  }));
  return [...singleBeds, ...childBeds];
}

export function selectBedAssetDefinition(
  doubleBed: boolean,
  facing: FurnitureFacing,
  variant: number,
  roomRole = "",
) {
  const assets = bedAssetDefinitions(doubleBed, facing);
  if (doubleBed) return assets[variant % assets.length];
  const adultBeds = assets.filter(({ folder }) => folder === "bed_single");
  const childBeds = assets.filter(({ folder }) => folder === "bed_children");
  const explicitlyForChildren = /child|children|nursery/i.test(roomRole);
  const guestRoom = /guest room/i.test(roomRole);
  const useChildBed = explicitlyForChildren || !guestRoom && variant % 6 === 0;
  const candidates = useChildBed ? childBeds : adultBeds;
  return candidates[Math.floor(variant / (useChildBed ? 6 : 1)) % candidates.length];
}

export function blueBedAssetDefinitions(
  doubleBed: boolean,
  facing: FurnitureFacing,
) {
  return bedAssetDefinitions(doubleBed, facing)
    .filter(({ name }) => name.startsWith("blue_"));
}

const CASUAL_SOFA_COLORS = [
  "black", "blue", "brown", "green", "grey", "red", "white", "yellow",
] as const;

export function casualSofaAssetNames(facing: FurnitureFacing) {
  const variants = facing === "south" ? [0, 1, 2, 3, 4, 5] : [1, 2, 3, 4, 5];
  return CASUAL_SOFA_COLORS.flatMap((color) => variants.map((variant) =>
    `${color}_${variant}_${facing}.png`));
}

const image = (source: string, visual?: InteriorPropSpriteLayout) => {
  const result = new Image();
  result.dataset.tilesetSource = source;
  if (visual) {
    result.dataset.tilesetRenderWidthCells = String(visual.renderWidthCells);
    result.dataset.tilesetRenderHeightCells = String(visual.renderHeightCells);
    result.dataset.tilesetAnchor = visual.anchor;
  }
  return result;
};

export function tilesetImageSpriteLayout(
  value: CanvasImageSource,
): InteriorPropSpriteLayout | undefined {
  if (!(value instanceof HTMLImageElement)) return undefined;
  const renderWidthCells = Number(value.dataset.tilesetRenderWidthCells);
  const renderHeightCells = Number(value.dataset.tilesetRenderHeightCells);
  const anchor = value.dataset.tilesetAnchor;
  if (
    !Number.isFinite(renderWidthCells) || !Number.isFinite(renderHeightCells) ||
    (anchor !== "center" && anchor !== "bottom")
  ) return undefined;
  return { renderWidthCells, renderHeightCells, anchor };
}

type MaterializedAssets<T> = T extends TilesetAssetDefinition
  ? HTMLImageElement
  : T extends readonly unknown[]
    ? { [Key in keyof T]: MaterializedAssets<T[Key]> }
    : T extends object
      ? { [Key in keyof T]: MaterializedAssets<T[Key]> }
      : T;

function materializeAssets<T>(value: T): MaterializedAssets<T> {
  if (
    value && typeof value === "object" &&
    "source" in value && typeof value.source === "string"
  ) {
    const definition = value as TilesetAssetDefinition;
    return image(definition.source, definition.visual) as MaterializedAssets<T>;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => materializeAssets(entry)) as MaterializedAssets<T>;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) =>
      [key, materializeAssets(entry)])) as MaterializedAssets<T>;
  }
  return value as MaterializedAssets<T>;
}

export function ensureTilesetImageLoaded(value: CanvasImageSource) {
  if (!(value instanceof HTMLImageElement)) return;
  const source = value.dataset.tilesetSource;
  if (source && !value.src) value.src = source;
}

const numberedAssets = (
  definition: (index: number) => TilesetAssetDefinition,
  count: number,
) => Array.from({ length: count }, (_, index) => definition(index + 1));

const lengthAssets = (
  definition: (length: number) => TilesetAssetDefinition,
  minimum: number,
  maximum: number,
) => Object.fromEntries(Array.from(
  { length: maximum - minimum + 1 },
  (_, index) => {
    const length = minimum + index;
    return [length, definition(length)];
  },
));

const rockFamilyAssets = (family: "rock" | "rock_light" | "rock_dark" |
  "rock_desert" | "rock_snow") => ({
  oneByOne: Array.from({ length: 16 }, (_, index) =>
    assetDefinition(lpc(`rock/${family}_${index + 1}_1x1.png`))),
  oneByTwo: Array.from({ length: 9 }, (_, index) =>
    assetDefinition(lpc(`rock/${family}_${index + 1}_1x2.png`))),
  twoByOne: Array.from({ length: 3 }, (_, index) =>
    assetDefinition(lpc(`rock/${family}_${index + 1}_2x1.png`))),
  twoByTwo: Array.from({ length: 14 }, (_, index) =>
    assetDefinition(lpc(`rock/${family}_${index + 1}_2x2.png`))),
  twoByThree: [assetDefinition(lpc(`rock/${family}_1_2x3.png`))],
  threeByThree: [assetDefinition(lpc(`rock/${family}_1_3x3.png`))],
  fourByThree: Array.from({ length: 2 }, (_, index) =>
    assetDefinition(lpc(`rock/${family}_${index + 1}_4x3.png`))),
  fourByFive: [assetDefinition(lpc(`rock/${family}_1_4x5.png`))],
  fiveByFour: [assetDefinition(lpc(`rock/${family}_1_5x4.png`))],
});

const casualSofaAssets = (facing: FurnitureFacing) =>
  casualSofaAssetNames(facing).map((name) =>
    assetDefinition(lpc(`casual_sofa/${name}`)));

const bedAssets = (doubleBed: boolean, facing: FurnitureFacing) =>
  bedAssetDefinitions(doubleBed, facing)
    .map((asset) => assetDefinition(lpc(`${asset.folder}/${asset.name}`)));

export function collectTilesetImages(value: unknown): HTMLImageElement[] {
  if (value instanceof HTMLImageElement) return [value];
  if (Array.isArray(value)) return value.flatMap(collectTilesetImages);
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(collectTilesetImages);
  }
  return [];
}

export interface TilesetLoadStatus {
  total: number;
  loaded: number;
  pending: number;
  failed: string[];
}

export function tilesetLoadStatus(value: unknown): TilesetLoadStatus {
  // Unrequested images deliberately have no src: exclude them from readiness
  // instead of treating the lazy catalogue as failed or pending downloads.
  const images = collectTilesetImages(value).filter((entry) => Boolean(entry.src));
  const failed = images.filter((entry) => entry.complete && entry.naturalWidth === 0)
    .map((entry) => entry.currentSrc || entry.src);
  const loaded = images.filter((entry) => entry.complete && entry.naturalWidth > 0).length;
  return {
    total: images.length,
    loaded,
    pending: images.length - loaded - failed.length,
    failed,
  };
}

function createTilesetTerrainImages() {
  return {
    beachSand: image(lpc("terrain/beach_sand.png")),
    coldWater: image(lpc("terrain/cold_water.png")),
    desertSand: image(lpc("terrain/desert_sand.png")),
    grass: image(lpc("terrain/grass.png")),
    grassRough: image(lpc("terrain/grass_rough.png")),
    ice: image(lpc("terrain/ice.png")),
    lava: image(lpc("terrain/lava.png")),
    sandRough: image(lpc("terrain/sand_rough.png")),
    snow: image(lpc("terrain/snow.png")),
    tiledSoil: image(lpc("terrain/tiled_soil.png")),
    water: image(lpc("terrain/water.png")),
  };
}

// Single source of truth for prop assets. Visual sizes are expressed in grid
// cells and travel with the asset to both the canvas renderer and Owlbear export.
const TILESET_PROP_ASSET_DEFINITIONS = {
    // Outdoor Bailey tiles.
    tree1x1: assetDefinition(bailey("tree_1x1.png"), centeredLayout(1, 1)),
    tree2x2: assetDefinition(bailey("tree_2x2.png"), centeredLayout(2, 2)),
    campfire: assetDefinition(lpc("campfire_1x1.png"), bottomLayout(1, 2)),
    lampPost: assetDefinition(lpc("lamp_post_1x1.png"), bottomLayout(1, 3)),
    torches: {
      east: interiorAssetDefinition("torch_east.png", centeredLayout(1, 1)),
      south: interiorAssetDefinition("torch_south.png", centeredLayout(1, 1)),
      west: interiorAssetDefinition("torch_west.png", centeredLayout(1, 1)),
    },
    rockFamilies: {
      normal: rockFamilyAssets("rock"),
      light: rockFamilyAssets("rock_light"),
      dark: rockFamilyAssets("rock_dark"),
      desert: rockFamilyAssets("rock_desert"),
      snow: rockFamilyAssets("rock_snow"),
    },

    crate1x1: numberedAssets((index) =>
      interiorAssetDefinition(`crate_${index}_1x1.png`, centeredLayout(1, 1)), 4),
    barrel1x1: interiorAssetDefinition("barrel_1x1.png", bottomLayout(1, 2)),
    bucket1x1: numberedAssets((index) =>
      interiorAssetDefinition(`bucket_${index}_1x1.png`, centeredLayout(1, 1)), 2),

    bedSingles: {
      north: bedAssets(false, "north"),
      east: bedAssets(false, "east"),
      south: bedAssets(false, "south"),
      west: bedAssets(false, "west"),
    },
    bedDoubles: {
      north: bedAssets(true, "north"),
      east: bedAssets(true, "east"),
      south: bedAssets(true, "south"),
      west: bedAssets(true, "west"),
    },
    table2x2: interiorAssetDefinition(
      "table_2x2.png", centeredLayout(2, 2), "bailey"),
    indoorTerrain: interiorAssetDefinition("terrain_indoor.png", undefined, "bailey"),
    drawers1x1: numberedAssets((index) =>
      interiorAssetDefinition(
        `drawer_${index}_1x1.png`, bottomLayout(1, 2), "bailey"), 3),
    shelves1x1: numberedAssets((index) => interiorAssetDefinition(
      `shelf_${index}_1x1.png`, bottomLayout(1, index <= 5 ? 3 : 2)), 7),
    statue1x1: numberedAssets((index) =>
      interiorAssetDefinition(`statue_${index}_1x1.png`, bottomLayout(1, 2)), 7),
    flowerPots1x1: numberedAssets((index) =>
      interiorAssetDefinition(
        `flower_pot_${index}_1x1.png`, centeredLayout(1, 1), "bailey"), 3),
    bones1x1: numberedAssets((index) =>
      interiorAssetDefinition(`bones_${index}_1x1.png`, centeredLayout(1, 1)), 5),
    wallChains1x2: numberedAssets((index) =>
      interiorAssetDefinition(`wall_chain_${index}_1x2.png`, bottomLayout(1, 2)), 2),

    // Hand-drawn LPC furniture.
    stool1x1: interiorAssetDefinition("stool_1x1.png", centeredLayout(1, 1)),
    table1x1: interiorAssetDefinition("table_1x1.png", bottomLayout(1, 2)),
    tableHorizontalByLength: lengthAssets((length) => interiorAssetDefinition(
      `table_horizontal_${length}x1.png`, bottomLayout(length, 2)), 2, 3),
    tableVerticalByLength: lengthAssets((length) => interiorAssetDefinition(
      `table_vertical_1x${length}.png`, centeredLayout(1, length)), 2, 3),
    counterHorizontalByLength: lengthAssets((length) => interiorAssetDefinition(
      `counter_horizontal_${length}x1.png`, bottomLayout(length, 2)), 3, 7),
    counterVerticalByLength: lengthAssets((length) => interiorAssetDefinition(
      `counter_vertical_1x${length}.png`, centeredLayout(1, length)), 3, 7),
    benchHorizontalByLength: lengthAssets((length) => interiorAssetDefinition(
      `bench_horizontal_${length}x1.png`, centeredLayout(length, 1)), 2, 5),
    benchVerticalByLength: lengthAssets((length) => interiorAssetDefinition(
      `bench_vertical_1x${length}.png`, centeredLayout(1, length)), 2, 5),
    cannonNorth: assetDefinition(lpc("cannon_north_1x2.png"), bottomLayout(1, 2)),
    cannonSouth: assetDefinition(lpc("cannon_south_1x2.png"), bottomLayout(1, 2)),
    casualSofas: {
      north: casualSofaAssets("north"),
      east: casualSofaAssets("east"),
      south: casualSofaAssets("south"),
      west: casualSofaAssets("west"),
    },

    // Generated multi-cell and directional variants.
    hearth1x2: interiorAssetDefinition(
      "hearth_1x2.png", centeredLayout(1, 2), "ai"),
    hearth2x1: interiorAssetDefinition(
      "hearth_2x1.png", centeredLayout(2, 1), "ai"),
    hearth1x3: interiorAssetDefinition(
      "hearth_1x3.png", centeredLayout(1, 3), "ai"),
    hearth3x1: interiorAssetDefinition(
      "hearth_3x1.png", centeredLayout(3, 1), "ai"),
    cabinetVertical1x2: interiorAssetDefinition(
      "cabinet_vertical_1x2.png", bottomLayout(1, 3)),
    cabinet2x1North: interiorAssetDefinition(
      "cabinet_north_2x1.png", bottomLayout(2, 2)),
    cabinetVertical1x3: interiorAssetDefinition(
      "cabinet_vertical_1x3.png", bottomLayout(1, 4)),
    cabinet2x1South: interiorAssetDefinition(
      "cabinet_south_2x1.png", bottomLayout(2, 2)),
    altarVertical1x2: interiorAssetDefinition(
      "altar_vertical_1x2.png", bottomLayout(1, 3)),
    altar2x1: interiorAssetDefinition("altar_2x1.png", bottomLayout(1, 2)),
    altarVertical1x3: interiorAssetDefinition(
      "altar_vertical_1x3.png", bottomLayout(1, 4)),
    altar3x1: interiorAssetDefinition("altar_3x1.png", bottomLayout(1, 2)),
    coffin1x2: interiorAssetDefinition(
      "coffin_1x2.png", centeredLayout(1, 2), "ai"),
    coffin2x1: interiorAssetDefinition("coffin_2x1.png", centeredLayout(2, 1)),
} as const;

function createTilesetPropImages() {
  return materializeAssets(TILESET_PROP_ASSET_DEFINITIONS);
}

export type TilesetTerrainImages = ReturnType<typeof createTilesetTerrainImages>;
export type TilesetPropImages = ReturnType<typeof createTilesetPropImages>;

export function createTilesetAssets() {
  const terrain = image(bailey("terrain.png"));
  const terrainTiles = createTilesetTerrainImages();
  const props = createTilesetPropImages();
  const terrainStatus = () => tilesetLoadStatus({ terrain, terrainTiles });
  const terrainReady = () => {
    const status = terrainStatus();
    return status.loaded === status.total;
  };
  const propsStatus = (_mode: LandscapeMode) => tilesetLoadStatus(props);
  const propsReady = (mode: LandscapeMode) => {
    const status = propsStatus(mode);
    return status.pending === 0;
  };

  return {
    terrain,
    terrainTiles,
    props,
    terrainReady,
    terrainStatus,
    propsReady,
    propsStatus,
  };
}
