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
    bed1x2: image(bailey("bed_1x2.png")),
    bed2x2: image(bailey("bed_2x2.png")),
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
    bed1x2South: image(generated("bed_1x2_south.png")),
    bed2x1: image(generated("bed_2x1.png")),
    bed2x2South: image(generated("bed_2x2_south.png")),
    bed2x2Horizontal: image(generated("bed_2x2_horizontal.png")),
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
