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
  "drawer_1_1x1.png": { renderWidthCells: 1, renderHeightCells: 2, anchor: "bottom" },
  "drawer_2_1x1.png": { renderWidthCells: 1, renderHeightCells: 2, anchor: "bottom" },
  "drawer_3_1x1.png": { renderWidthCells: 1, renderHeightCells: 2, anchor: "bottom" },
  "shelf_1_1x1.png": { renderWidthCells: 1, renderHeightCells: 2, anchor: "bottom" },
  "shelf_2_1x1.png": { renderWidthCells: 1, renderHeightCells: 2, anchor: "bottom" },
  "statue_1x1.png": { renderWidthCells: 1, renderHeightCells: 2, anchor: "bottom" },
  "table_1x1.png": { renderWidthCells: 1, renderHeightCells: 2, anchor: "bottom" },
  "table_horizontal_left.png": { renderWidthCells: 1, renderHeightCells: 2, anchor: "bottom" },
  "table_horizontal_middle.png": { renderWidthCells: 1, renderHeightCells: 2, anchor: "bottom" },
  "table_horizontal_right.png": { renderWidthCells: 1, renderHeightCells: 2, anchor: "bottom" },
};

export function interiorAssetSpriteLayout(assetName: string) {
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
}

const BED_COLORS = ["blue", "brown", "green", "purple", "red", "white", "yellow"] as const;
const CHILD_BED_COLORS = [...BED_COLORS, "grey"] as const;

export function bedAssetDefinitions(
  doubleBed: boolean,
  facing: FurnitureFacing,
): BedAssetDefinition[] {
  const horizontal = facing === "east" || facing === "west";
  if (doubleBed) {
    return BED_COLORS.flatMap((color) => ["plain", "patterned"].map((style) => ({
      folder: "bed_double" as const,
      name: `${color}_${style}_${facing}.png`,
      width: horizontal ? 96 : 64,
      height: horizontal ? 64 : 96,
    })));
  }
  const singleBeds = BED_COLORS.map((color) => ({
    folder: "bed_single" as const,
    name: `${color}_${facing}.png`,
    width: horizontal ? 96 : 64,
    height: horizontal ? 64 : 96,
  }));
  const childBeds = CHILD_BED_COLORS.map((color) => ({
    folder: "bed_children" as const,
    name: `${color}_${facing}.png`,
    width: horizontal ? 64 : 32,
    height: horizontal ? 64 : 96,
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

export function createTilesetAssets() {
  const terrain = image(bailey("terrain.png"));
  const props = {
    // Outdoor Bailey tiles.
    tree1x1: image(bailey("tree_1x1.png")),
    tree2x2: image(bailey("tree_2x2.png")),
    rock1x1: image(bailey("rock_1x1.png")),
    rock2x2: image(bailey("rock_2x2.png")),

    // Small Bailey interior props.
    crate1x1: image(bailey("crate_1x1.png")),
    barrel1x1: image(bailey("barrel_1x1.png")),
    bucket1x1: image(bailey("bucket_1x1.png")),
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
    shelves1x1: numberedImages((index) => bailey(`shelf_${index}_1x1.png`), 2),
    statue1x1: image(bailey("statue_1x1.png")),
    flowerPots1x1: numberedImages((index) => bailey(`flower_pot_${index}_1x1.png`), 3),

    // Hand-drawn LPC furniture.
    stool1x1: image(lpc("stool_1x1.png")),
    table1x1: image(lpc("table_1x1.png")),
    tableHorizontalLeft: image(lpc("table_horizontal_left.png")),
    tableHorizontalMiddle: image(lpc("table_horizontal_middle.png")),
    tableHorizontalRight: image(lpc("table_horizontal_right.png")),
    tableVerticalTop: image(lpc("table_vertical_top.png")),
    tableVerticalMiddle: image(lpc("table_vertical_middle.png")),
    tableVerticalDown: image(lpc("table_vertical_down.png")),
    benchHorizontalLeft: image(lpc("bench_horizontal_left_1x1.png")),
    benchHorizontalMiddle: image(lpc("bench_horizontal_middle_1x1.png")),
    benchHorizontalRight: image(lpc("bench_horizontal_right_1x1.png")),
    benchVerticalTop: image(lpc("bench_vertical_top.png")),
    benchVerticalMiddle: image(lpc("bench_vertical_middle.png")),
    benchVerticalDown: image(lpc("bench_vertical_down.png")),
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
    cabinet1x2: image(generated("cabinet_1x2.png")),
    cabinet2x1: image(generated("cabinet_2x1.png")),
    cabinet1x3: image(generated("cabinet_1x3.png")),
    cabinet3x1: image(generated("cabinet_3x1.png")),
    cabinet2x1South: image(generated("cabinet_2x1_south.png")),
    cabinet3x1South: image(generated("cabinet_3x1_south.png")),
    altar1x2: image(generated("altar_1x2.png")),
    altar2x1: image(generated("altar_2x1.png")),
    altar1x3: image(generated("altar_1x3.png")),
    altar3x1: image(generated("altar_3x1.png")),
    coffin1x2: image(generated("coffin_1x2.png")),
    coffin2x1: image(generated("coffin_2x1.png")),
  } satisfies TilesetPropImages;

  const terrainReady = () => terrain.complete && terrain.naturalWidth > 0;
  const propsReady = () => collectTilesetImages(props)
    .every((entry) => entry.complete && entry.naturalWidth > 0);

  return { terrain, props, terrainReady, propsReady };
}
