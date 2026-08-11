import type { TilesetPropImages } from "./canvas";

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

export const INTERIOR_ASSET_SPRITE_LAYOUTS: Readonly<
  Record<string, InteriorPropSpriteLayout>
> = {
  // These files occupy one gameplay cell, but their artwork rises one cell north.
  "altar_3x1.png": { renderWidthCells: 1, renderHeightCells: 2, anchor: "bottom" },
  "altar_vertical_1x2.png": { renderWidthCells: 1, renderHeightCells: 2, anchor: "bottom" },
  "barrel_1x1.png": { renderWidthCells: 1, renderHeightCells: 2, anchor: "bottom" },
  "cabinet_north_2x1.png": { renderWidthCells: 2, renderHeightCells: 2, anchor: "bottom" },
  "cabinet_south_2x1.png": { renderWidthCells: 2, renderHeightCells: 2, anchor: "bottom" },
  "counter_horizontal_left_1x1.png": { renderWidthCells: 1, renderHeightCells: 2, anchor: "bottom" },
  "counter_horizontal_middle_1x1.png": { renderWidthCells: 1, renderHeightCells: 2, anchor: "bottom" },
  "counter_horizontal_right_1x1.png": { renderWidthCells: 1, renderHeightCells: 2, anchor: "bottom" },
  "drawer_1_1x1.png": { renderWidthCells: 1, renderHeightCells: 2, anchor: "bottom" },
  "drawer_2_1x1.png": { renderWidthCells: 1, renderHeightCells: 2, anchor: "bottom" },
  "drawer_3_1x1.png": { renderWidthCells: 1, renderHeightCells: 2, anchor: "bottom" },
  "shelf_1_1x1.png": { renderWidthCells: 1, renderHeightCells: 3, anchor: "bottom" },
  "shelf_2_1x1.png": { renderWidthCells: 1, renderHeightCells: 3, anchor: "bottom" },
  "shelf_3_1x1.png": { renderWidthCells: 1, renderHeightCells: 3, anchor: "bottom" },
  "shelf_4_1x1.png": { renderWidthCells: 1, renderHeightCells: 3, anchor: "bottom" },
  "shelf_5_1x1.png": { renderWidthCells: 1, renderHeightCells: 3, anchor: "bottom" },
  "shelf_6_1x1.png": { renderWidthCells: 1, renderHeightCells: 2, anchor: "bottom" },
  "shelf_7_1x1.png": { renderWidthCells: 1, renderHeightCells: 2, anchor: "bottom" },
  "statue_1x1.png": { renderWidthCells: 1, renderHeightCells: 2, anchor: "bottom" },
  "table_1x1.png": { renderWidthCells: 1, renderHeightCells: 2, anchor: "bottom" },
  "table_horizontal_left.png": { renderWidthCells: 1, renderHeightCells: 2, anchor: "bottom" },
  "table_horizontal_middle.png": { renderWidthCells: 1, renderHeightCells: 2, anchor: "bottom" },
  "table_horizontal_right.png": { renderWidthCells: 1, renderHeightCells: 2, anchor: "bottom" },
};

export function interiorAssetSpriteLayout(assetName: string) {
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
const generated = (name: string) => `${TILESET_ROOT}/ai/${name}`;
const lpc = (name: string) => `${TILESET_ROOT}/lpc/${name}`;

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

const CASUAL_SOFA_COLORS = [
  "black", "blue", "brown", "green", "grey", "red", "white", "yellow",
] as const;

export function casualSofaAssetNames(facing: FurnitureFacing) {
  const variants = facing === "south" ? [0, 1, 2, 3, 4, 5] : [1, 2, 3, 4, 5];
  return CASUAL_SOFA_COLORS.flatMap((color) => variants.map((variant) =>
    `${color}_${variant}_${facing}.png`));
}

const image = (source: string) => {
  const result = new Image();
  result.src = source;
  return result;
};

const numberedImages = (
  source: (index: number) => string,
  count: number,
) => Array.from({ length: count }, (_, index) => image(source(index + 1)));

const lengthImages = (
  source: (length: number) => string,
  minimum: number,
  maximum: number,
) => Object.fromEntries(Array.from(
  { length: maximum - minimum + 1 },
  (_, index) => {
    const length = minimum + index;
    return [length, image(source(length))];
  },
));

const casualSofaImages = (facing: FurnitureFacing) =>
  casualSofaAssetNames(facing).map((name) => image(lpc(`casual_sofa/${name}`)));

const bedImages = (doubleBed: boolean, facing: FurnitureFacing) =>
  bedAssetDefinitions(doubleBed, facing)
    .map((asset) => image(lpc(`${asset.folder}/${asset.name}`)));

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
  const images = collectTilesetImages(value);
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

export function createTilesetAssets() {
  const terrain = image(bailey("terrain.png"));
  const props = {
    // Outdoor Bailey tiles.
    tree1x1: image(bailey("tree_1x1.png")),
    tree2x2: image(bailey("tree_2x2.png")),
    rock1x1: image(bailey("rock_1x1.png")),
    rock2x2: image(bailey("rock_2x2.png")),

    crate1x1: numberedImages((index) => lpc(`crate_${index}_1x1.png`), 4),
    barrel1x1: image(lpc("barrel_1x1.png")),
    bucket1x1: numberedImages((index) => lpc(`bucket_${index}_1x1.png`), 2),

    bedSingles: {
      north: bedImages(false, "north"),
      east: bedImages(false, "east"),
      south: bedImages(false, "south"),
      west: bedImages(false, "west"),
    },
    bedDoubles: {
      north: bedImages(true, "north"),
      east: bedImages(true, "east"),
      south: bedImages(true, "south"),
      west: bedImages(true, "west"),
    },
    table2x2: image(bailey("table_2x2.png")),
    indoorTerrain: image(bailey("terrain_indoor.png")),
    drawers1x1: numberedImages((index) => bailey(`drawer_${index}_1x1.png`), 3),
    shelves1x1: numberedImages((index) => lpc(`shelf_${index}_1x1.png`), 7),
    statue1x1: image(bailey("statue_1x1.png")),
    flowerPots1x1: numberedImages((index) => bailey(`flower_pot_${index}_1x1.png`), 3),

    // Hand-drawn LPC furniture.
    stool1x1: image(lpc("stool_1x1.png")),
    table1x1: image(lpc("table_1x1.png")),
    tableHorizontalByLength: lengthImages((length) =>
      lpc(`table_horizontal_${length}x1.png`), 2, 3),
    tableVerticalByLength: lengthImages((length) =>
      lpc(`table_vertical_1x${length}.png`), 2, 3),
    counterHorizontalByLength: lengthImages((length) =>
      lpc(`counter_horizontal_${length}x1.png`), 3, 7),
    counterVerticalByLength: lengthImages((length) =>
      lpc(`counter_vertical_1x${length}.png`), 3, 7),
    benchHorizontalByLength: lengthImages((length) =>
      lpc(`bench_horizontal_${length}x1.png`), 2, 4),
    benchVerticalByLength: lengthImages((length) =>
      lpc(`bench_vertical_1x${length}.png`), 2, 4),
    cannonNorth: image(lpc("cannon_north_1x2.png")),
    cannonSouth: image(lpc("cannon_south_1x2.png")),
    casualSofas: {
      north: casualSofaImages("north"),
      east: casualSofaImages("east"),
      south: casualSofaImages("south"),
      west: casualSofaImages("west"),
    },

    // Generated multi-cell and directional variants.
    hearth1x2: image(generated("hearth_1x2.png")),
    hearth2x1: image(generated("hearth_2x1.png")),
    hearth1x3: image(generated("hearth_1x3.png")),
    hearth3x1: image(generated("hearth_3x1.png")),
    cabinetVertical1x2: image(lpc("cabinet_vertical_1x2.png")),
    cabinet2x1North: image(lpc("cabinet_north_2x1.png")),
    cabinetVertical1x3: image(lpc("cabinet_vertical_1x3.png")),
    cabinet2x1South: image(lpc("cabinet_south_2x1.png")),
    altarVertical1x2: image(lpc("altar_vertical_1x2.png")),
    altar2x1: image(generated("altar_2x1.png")),
    altarVertical1x3: image(lpc("altar_vertical_1x3.png")),
    altar3x1: image(lpc("altar_3x1.png")),
    coffin1x2: image(generated("coffin_1x2.png")),
    coffin2x1: image(generated("coffin_2x1.png")),
  } satisfies TilesetPropImages;

  const terrainReady = () => terrain.complete && terrain.naturalWidth > 0;
  const propsStatus = () => tilesetLoadStatus(props);
  const propsReady = () => {
    const status = propsStatus();
    return status.loaded === status.total;
  };

  return { terrain, props, terrainReady, propsReady, propsStatus };
}
