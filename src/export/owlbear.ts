import {
  INTERIOR_PROP_RULES,
  Obstacle,
  Terrain,
  type Grid,
  type ObstacleKind,
  type TerrainKind,
  type Tile,
} from "../domain/map";
import type { UploadedMapImage } from "./map-image";
import {
  collectMapLightSources,
  type MapLightSource,
} from "../rendering/lighting";
import {
  bedAssetDefinitions,
  casualSofaAssetNames,
  interiorAssetSpriteLayout,
  type FurnitureFacing,
} from "../rendering/tileset-assets";

const OWLBEAR_SCENE_DPI = 150;
const MAP_IMAGE_DPI = 48;
const PROP_IMAGE_DPI = 512;
const FOG_TERRAINS = new Set<TerrainKind>([
  Terrain.Ground,
  Terrain.Difficult,
  Terrain.Water,
  Terrain.Ice,
  Terrain.Lava,
  Terrain.Beach,
  Terrain.Road,
  Terrain.Bridge,
  Terrain.Ravine,
  Terrain.Door,
]);
const PUBLIC_TILESET_ASSET_BASE =
  "https://cdn.jsdelivr.net/gh/Sewef/battleMapGenerator@main/public/assets/tilesets/";

const BAILEY_INTERIOR_ASSETS = new Set([
  "barrel_1x1.png", "bed_1x2.png", "bed_2x2.png", "bucket_1x1.png",
  "crate_1x1.png", "drawer_1_1x1.png", "drawer_2_1x1.png", "drawer_3_1x1.png",
  "flower_pot_1_1x1.png", "flower_pot_2_1x1.png", "flower_pot_3_1x1.png",
  "shelf_1_1x1.png", "shelf_2_1x1.png", "statue_1x1.png", "stool_1x1.png",
  "table_1x1.png",
]);

type ExportedObstacle = {
  kind: Exclude<ObstacleKind, "none">;
  id: number;
  points: Array<{ x: number; y: number }>;
};

type PropPlacement = { x: number; y: number; size: 1 | 2 };
type PropAssetSet = {
  oneByOne: OwlbearPropAsset;
  twoByTwo: OwlbearPropAsset;
};

export type OwlbearPropAsset = {
  url: string;
  mime: "image/png" | "image/jpeg" | "image/webp" | "image/gif" | "image/avif";
  width: number;
  height: number;
};

const PROP_MIME_BY_EXTENSION: Record<string, OwlbearPropAsset["mime"]> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
};
const SUPPORTED_PROP_MIMES = new Set<OwlbearPropAsset["mime"]>(
  Object.values(PROP_MIME_BY_EXTENSION),
);
const DEFAULT_PROP_DIMENSIONS: Record<string, number> = {
  "tree_1x1.png": 32,
  "tree_2x2.png": 64,
  "rock_1x1.png": 32,
  "rock_2x2.png": 64,
  "tree.png": 64,
  "rock.png": 64,
};

export interface OwlbearExportOptions {
  mapImage: UploadedMapImage;
  useTileset?: boolean;
  dynamicFog?: boolean;
  treeUrl?: string;
  rockUrl?: string;
}

export interface OwlbearSceneExport {
  json: string;
  filename: string;
}

function safeSeed(seed: string) {
  return seed.replace(/[^a-z0-9_-]+/gi, "-") || "terrain";
}

function emptyText() {
  return {
    type: "PLAIN",
    style: {
      padding: 8,
      fontSize: 24,
      fillColor: "white",
      textAlign: "CENTER",
      fontFamily: "Roboto",
      fontWeight: 400,
      lineHeight: 1.5,
      fillOpacity: 1,
      strokeColor: "white",
      strokeWidth: 0,
      strokeOpacity: 1,
      textAlignVertical: "BOTTOM",
    },
    width: "AUTO",
    height: "AUTO",
    richText: [{ type: "paragraph", children: [{ text: "" }] }],
    plainText: "",
  };
}

function collectObstacles(grid: Grid): ExportedObstacle[] {
  const obstacles = new Map<string, ExportedObstacle>();
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      const tile = grid[y][x];
      if (tile.obstacle === Obstacle.None) continue;
      const id = tile.obstacleId ?? y * grid[y].length + x;
      const key = `${tile.obstacle}:${id}`;
      const obstacle = obstacles.get(key) ?? {
        kind: tile.obstacle,
        id,
        points: [],
      };
      obstacle.points.push({ x, y });
      obstacles.set(key, obstacle);
    }
  }
  return [...obstacles.values()];
}

function collectInteriorProps(grid: Grid): ExportedInteriorProp[] {
  const props = new Map<string, ExportedInteriorProp>();
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      const tile = grid[y][x];
      if (!tile.interiorProp || tile.interiorPropId === undefined) continue;
      const key = `${tile.interiorProp}:${tile.interiorPropId}`;
      const prop = props.get(key) ?? {
        kind: tile.interiorProp,
        id: tile.interiorPropId,
        points: [],
        orientation: tile.propOrientation,
        facing: tile.propFacing,
        roomRole: tile.roomRole,
      };
      prop.points.push({ x, y });
      props.set(key, prop);
    }
  }
  return [...props.values()].sort((first, second) => first.id - second.id);
}

function propPlacements(points: Array<{ x: number; y: number }>): PropPlacement[] {
  const remaining = new Set(points.map(({ x, y }) => `${x},${y}`));
  const placements: PropPlacement[] = [];
  const ordered = [...points].sort((a, b) => a.y - b.y || a.x - b.x);
  for (const { x, y } of ordered) {
    if (!remaining.has(`${x},${y}`)) continue;
    const block = [
      `${x},${y}`,
      `${x + 1},${y}`,
      `${x},${y + 1}`,
      `${x + 1},${y + 1}`,
    ];
    if (block.every((key) => remaining.has(key))) {
      block.forEach((key) => remaining.delete(key));
      placements.push({ x, y, size: 2 });
    } else {
      remaining.delete(`${x},${y}`);
      placements.push({ x, y, size: 1 });
    }
  }
  return placements;
}

function imageItem(
  id: string,
  name: string,
  layer: "MAP" | "PROP",
  url: string,
  mime: string,
  width: number,
  height: number,
  position: { x: number; y: number },
  gridDpi: number,
  gridOffset: { x: number; y: number },
  zIndex: number,
  locked: boolean,
  scale = { x: 1, y: 1 },
  rotation = 0,
  metadata: Record<string, unknown> = {},
) {
  return {
    type: "IMAGE",
    id,
    name,
    position,
    rotation,
    scale,
    visible: true,
    locked,
    zIndex,
    metadata: {
      "com.terra-map-generator/export": true,
      ...metadata,
    },
    image: { url, mime, width, height },
    grid: { dpi: gridDpi, offset: gridOffset },
    text: emptyText(),
    textItemType: "LABEL",
    layer,
  };
}

type FogPoint = { x: number; y: number };
type FogEdge = { start: FogPoint; end: FogPoint; direction: number };

function traceContours(
  columns: number,
  rows: number,
  matches: (x: number, y: number) => boolean,
  includeMapBoundary = true,
): FogPoint[][] {
  const edges: FogEdge[] = [];
  const addEdge = (start: FogPoint, end: FogPoint, direction: number) => {
    edges.push({ start, end, direction });
  };
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      if (!matches(x, y)) continue;
      if ((includeMapBoundary || y > 0) && !matches(x, y - 1)) {
        addEdge({ x, y }, { x: x + 1, y }, 0);
      }
      if (
        (includeMapBoundary || x < columns - 1) &&
        !matches(x + 1, y)
      ) {
        addEdge({ x: x + 1, y }, { x: x + 1, y: y + 1 }, 1);
      }
      if (
        (includeMapBoundary || y < rows - 1) &&
        !matches(x, y + 1)
      ) {
        addEdge({ x: x + 1, y: y + 1 }, { x, y: y + 1 }, 2);
      }
      if ((includeMapBoundary || x > 0) && !matches(x - 1, y)) {
        addEdge({ x, y: y + 1 }, { x, y }, 3);
      }
    }
  }

  const pointKey = ({ x, y }: FogPoint) => `${x},${y}`;
  const outgoing = new Map<string, number[]>();
  edges.forEach((edge, index) => {
    const key = pointKey(edge.start);
    outgoing.set(key, [...(outgoing.get(key) ?? []), index]);
  });
  const unused = new Set(edges.map((_, index) => index));
  const contours: FogPoint[][] = [];
  const turnPriority = [1, 0, 3, 2];

  while (unused.size) {
    const firstIndex = unused.values().next().value as number;
    const first = edges[firstIndex];
    const points = [first.start];
    let edge = first;
    unused.delete(firstIndex);

    while (pointKey(edge.end) !== pointKey(first.start)) {
      points.push(edge.end);
      const candidates = (outgoing.get(pointKey(edge.end)) ?? [])
        .filter((index) => unused.has(index));
      if (!candidates.length) break;
      candidates.sort((a, b) => {
        const turnA = (edges[a].direction - edge.direction + 4) % 4;
        const turnB = (edges[b].direction - edge.direction + 4) % 4;
        return turnPriority.indexOf(turnA) - turnPriority.indexOf(turnB);
      });
      const nextIndex = candidates[0];
      edge = edges[nextIndex];
      unused.delete(nextIndex);
    }

    if (pointKey(edge.end) !== pointKey(first.start) || points.length < 4) continue;
    const simplified = points.filter((point, index) => {
      const previous = points[(index - 1 + points.length) % points.length];
      const next = points[(index + 1) % points.length];
      return !(
        (previous.x === point.x && point.x === next.x) ||
        (previous.y === point.y && point.y === next.y)
      );
    });
    if (simplified.length >= 4) contours.push(simplified);
  }
  return contours;
}

function fogContours(
  grid: Grid,
  matches: (x: number, y: number) => boolean,
  includeMapBoundary = true,
) {
  return traceContours(
    grid[0].length,
    grid.length,
    matches,
    includeMapBoundary,
  );
}

function fogItem(
  id: string,
  name: string,
  contour: FogPoint[],
  zIndex: number,
) {
  return {
    id,
    name,
    zIndex,
    locked: false,
    metadata: { "com.terra-map-generator/export": true },
    position: { x: 0, y: 0 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    type: "CURVE",
    visible: true,
    layer: "FOG",
    points: contour.map(({ x, y }) => ({
      x: x * OWLBEAR_SCENE_DPI,
      y: y * OWLBEAR_SCENE_DPI,
    })),
    style: {
      fillColor: "#222222",
      fillOpacity: 1,
      strokeColor: "#222222",
      strokeOpacity: 1,
      strokeWidth: 15,
      strokeDash: [],
      tension: 0,
      closed: true,
    },
  };
}

function roomFogContours(grid: Grid) {
  const rooms = new Map<number, { role: string; cells: FogPoint[] }>();
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      const current = grid[y][x];
      const roomId = current.roomId;
      if (roomId === undefined) continue;
      const room = rooms.get(roomId) ?? {
        role: current.roomRole ?? `Room ${roomId + 1}`,
        cells: [],
      };
      room.cells.push({ x, y });
      rooms.set(roomId, room);
    }
  }
  const maskWidth = grid[0].length * 2 + 2;
  const maskHeight = grid.length * 2 + 2;
  return [...rooms.entries()]
    .sort(([first], [second]) => first - second)
    .flatMap(([roomId, room]) => {
      const mask = new Set<string>();
      for (const cell of room.cells) {
        for (let y = cell.y * 2; y < cell.y * 2 + 4; y += 1) {
          for (let x = cell.x * 2; x < cell.x * 2 + 4; x += 1) {
            mask.add(`${x},${y}`);
          }
        }
      }
      return traceContours(
        maskWidth,
        maskHeight,
        (x, y) => mask.has(`${x},${y}`),
      ).map((contour) => ({
        roomId,
        role: room.role,
        contour: contour.map(({ x, y }) => ({
          x: (x - 1) / 2,
          y: (y - 1) / 2,
        })),
      }));
    });
}

function fogDoorItem(
  id: string,
  x: number,
  y: number,
  orientation: "horizontal" | "vertical",
  zIndex: number,
) {
  const horizontal = orientation === "horizontal";
  const length = OWLBEAR_SCENE_DPI;
  return {
    id,
    name: "Door",
    zIndex,
    locked: false,
    metadata: {
      "com.terra-map-generator/export": true,
      "rodeo.owlbear.dynamic-fog/doors": [{
        open: false,
        start: { distance: 0, index: 0 },
        end: { distance: length, index: 0 },
      }],
    },
    position: {
      x: (x + (horizontal ? 0 : .5)) * OWLBEAR_SCENE_DPI,
      y: (y + (horizontal ? .5 : 0)) * OWLBEAR_SCENE_DPI,
    },
    rotation: 0,
    scale: { x: 1, y: 1 },
    type: "LINE",
    visible: true,
    layer: "FOG",
    startPosition: { x: 0, y: 0 },
    endPosition: {
      x: horizontal ? length : 0,
      y: horizontal ? 0 : length,
    },
    style: {
      strokeColor: "#222222",
      strokeOpacity: 1,
      strokeWidth: 15,
      strokeDash: [],
    },
  };
}

const LIGHT_SOURCE_NAMES: Record<MapLightSource["kind"], string> = {
  hearth: "Hearth",
  console: "Console",
  altar: "Altar candles",
  lava: "Lava",
};

type InteriorPropKind = NonNullable<Tile["interiorProp"]>;
type ExportedInteriorProp = {
  kind: InteriorPropKind;
  id: number;
  points: Array<{ x: number; y: number }>;
  orientation?: Tile["propOrientation"];
  facing?: Tile["propFacing"];
  roomRole?: string;
};

const INTERIOR_PROP_DRAWING_STYLES: Record<
  InteriorPropKind,
  { fillColor: string; strokeColor: string; shapeType: "RECTANGLE" | "CIRCLE" }
> = {
  table: { fillColor: "#8b5d3b", strokeColor: "#422b20", shapeType: "RECTANGLE" },
  chair: { fillColor: "#9b6a47", strokeColor: "#422b20", shapeType: "CIRCLE" },
  bar: { fillColor: "#70442c", strokeColor: "#35251d", shapeType: "RECTANGLE" },
  cabinet: { fillColor: "#684b3a", strokeColor: "#30251f", shapeType: "RECTANGLE" },
  bed: { fillColor: "#cbbd9d", strokeColor: "#58483a", shapeType: "RECTANGLE" },
  bench: { fillColor: "#956347", strokeColor: "#432b20", shapeType: "RECTANGLE" },
  altar: { fillColor: "#d3c5a4", strokeColor: "#665b4c", shapeType: "RECTANGLE" },
  crate: { fillColor: "#7b5836", strokeColor: "#3b2a20", shapeType: "RECTANGLE" },
  console: { fillColor: "#54727a", strokeColor: "#213b43", shapeType: "RECTANGLE" },
  tomb: { fillColor: "#858681", strokeColor: "#41433f", shapeType: "RECTANGLE" },
  hearth: { fillColor: "#a95332", strokeColor: "#472b24", shapeType: "RECTANGLE" },
  drawers: { fillColor: "#765139", strokeColor: "#39281f", shapeType: "RECTANGLE" },
  shelf: { fillColor: "#765139", strokeColor: "#39281f", shapeType: "RECTANGLE" },
  statue: { fillColor: "#8e918b", strokeColor: "#484c49", shapeType: "RECTANGLE" },
  barrel: { fillColor: "#805238", strokeColor: "#3b281f", shapeType: "CIRCLE" },
  bucket: { fillColor: "#555d5d", strokeColor: "#252d2d", shapeType: "CIRCLE" },
  flower_pot: { fillColor: "#9a634b", strokeColor: "#4b3028", shapeType: "CIRCLE" },
};

function dynamicFogLightMetadata(source: MapLightSource) {
  return {
    attenuationRadius: Math.round(source.attenuationRadius * OWLBEAR_SCENE_DPI),
    sourceRadius: Math.max(1, Math.round(source.sourceRadius * OWLBEAR_SCENE_DPI)),
    falloff: source.falloff,
    lightType: source.lightType,
  };
}

function interiorPropItem(
  id: string,
  prop: ExportedInteriorProp,
  zIndex: number,
  lightSource?: MapLightSource,
) {
  const minimumX = Math.min(...prop.points.map(({ x }) => x));
  const maximumX = Math.max(...prop.points.map(({ x }) => x));
  const minimumY = Math.min(...prop.points.map(({ y }) => y));
  const maximumY = Math.max(...prop.points.map(({ y }) => y));
  const style = INTERIOR_PROP_DRAWING_STYLES[prop.kind];
  const widthInCells = maximumX - minimumX + 1;
  const heightInCells = maximumY - minimumY + 1;
  const inset = prop.kind === "chair" ? .58 : .8;
  const width = Math.max(24, widthInCells * OWLBEAR_SCENE_DPI * inset);
  const height = Math.max(24, heightInCells * OWLBEAR_SCENE_DPI * inset);
  const footprintWidth = widthInCells * OWLBEAR_SCENE_DPI;
  const footprintHeight = heightInCells * OWLBEAR_SCENE_DPI;
  const footprintCenter = {
    x: (minimumX + widthInCells / 2) * OWLBEAR_SCENE_DPI,
    y: (minimumY + heightInCells / 2) * OWLBEAR_SCENE_DPI,
  };
  const position = style.shapeType === "CIRCLE"
    ? footprintCenter
    : {
      // Rectangle shapes use their top-left corner as `position`.
      x: minimumX * OWLBEAR_SCENE_DPI + (footprintWidth - width) / 2,
      y: minimumY * OWLBEAR_SCENE_DPI + (footprintHeight - height) / 2,
    };
  const roomSuffix = prop.roomRole ? ` · ${prop.roomRole}` : "";
  return {
    id,
    name: `${INTERIOR_PROP_RULES[prop.kind].label} ${prop.id}${roomSuffix}`,
    zIndex,
    locked: false,
    metadata: {
      "com.terra-map-generator/export": true,
      "com.terra-map-generator/interior-prop": {
        kind: prop.kind,
        id: prop.id,
        orientation: prop.orientation,
        facing: prop.facing,
        roomRole: prop.roomRole,
        footprint: prop.points,
      },
      ...(lightSource
        ? { "rodeo.owlbear.dynamic-fog/light": dynamicFogLightMetadata(lightSource) }
        : {}),
    },
    // Owlbear circles are center-positioned, unlike rectangular Drawings.
    position,
    rotation: 0,
    scale: { x: 1, y: 1 },
    type: "SHAPE",
    visible: true,
    layer: "PROP",
    width,
    height,
    shapeType: style.shapeType,
    style: {
      fillColor: style.fillColor,
      fillOpacity: .42,
      strokeColor: style.strokeColor,
      strokeOpacity: .9,
      strokeWidth: 5,
      strokeDash: [],
    },
  };
}

function interiorPropSpriteItems(
  prop: ExportedInteriorProp,
  zIndex: number,
  lightSource?: MapLightSource,
) {
  const variant = Math.abs(prop.id);
  const rectangle = (() => {
    const minimumX = Math.min(...prop.points.map(({ x }) => x));
    const maximumX = Math.max(...prop.points.map(({ x }) => x));
    const minimumY = Math.min(...prop.points.map(({ y }) => y));
    const maximumY = Math.max(...prop.points.map(({ y }) => y));
    return {
      minimumX, minimumY,
      width: maximumX - minimumX + 1,
      height: maximumY - minimumY + 1,
    };
  })();
  const upholsteredBench = prop.kind === "bench" &&
    /Living room|Common room|Bedroom|Guest room|cabin/i.test(prop.roomRole ?? "");
  const woodenHorizontalBench = prop.kind === "bench" && !upholsteredBench &&
    rectangle.width > rectangle.height;
  const woodenVerticalBench = prop.kind === "bench" && !upholsteredBench &&
    rectangle.height > rectangle.width;
  const modularWoodenBench = woodenHorizontalBench || woodenVerticalBench;
  const modularHorizontalTable = prop.kind === "table" && prop.points.length > 1 &&
    rectangle.height === 1;
  const modularVerticalTable = prop.kind === "table" && prop.points.length > 1 &&
    rectangle.width === 1;
  const modularTable = modularHorizontalTable || modularVerticalTable;
  const modularHorizontalCounter = prop.kind === "bar" && rectangle.height === 1;
  const modularVerticalCounter = prop.kind === "bar" && rectangle.width === 1;
  const modularCounter = modularHorizontalCounter || modularVerticalCounter;
  const casualSofaNames = upholsteredBench
    ? casualSofaAssetNames((prop.facing ?? "north") as FurnitureFacing)
    : [];
  const bedAssets = prop.kind === "bed"
    ? bedAssetDefinitions(prop.points.length === 4,
      (prop.facing ?? "north") as FurnitureFacing)
    : [];
  const bedAsset = bedAssets.length ? bedAssets[variant % bedAssets.length] : undefined;
  const assetName = prop.kind === "bed"
    ? bedAsset?.name
    : prop.kind === "hearth" && (prop.points.length === 2 || prop.points.length === 3)
      ? rectangle.width > rectangle.height
        ? `hearth_${prop.points.length}x1.png`
        : `hearth_1x${prop.points.length}.png`
    : prop.kind === "cabinet" && (prop.points.length === 2 || prop.points.length === 3)
      ? rectangle.width > rectangle.height
        ? `cabinet_${prop.points.length}x1${prop.facing === "south" ? "_south" : ""}.png`
        : `cabinet_1x${prop.points.length}.png`
    : prop.kind === "tomb" && prop.points.length === 2
      ? rectangle.width > rectangle.height ? "coffin_2x1.png" : "coffin_1x2.png"
    : prop.kind === "altar" && (prop.points.length === 2 || prop.points.length === 3)
      ? rectangle.width > rectangle.height
        ? `altar_${prop.points.length}x1.png`
        : `altar_1x${prop.points.length}.png`
    : prop.kind === "bench"
      ? woodenVerticalBench ? "bench_vertical_middle.png"
        : upholsteredBench ? casualSofaNames[variant % casualSofaNames.length]
        : `bench_${prop.facing === "south" || prop.facing === "west"
          ? "south" : "north"}.png`
    : prop.kind === "chair" ? "stool_1x1.png"
      : prop.kind === "crate" ? "crate_1x1.png"
        : prop.kind === "barrel" ? "barrel_1x1.png"
          : prop.kind === "bucket" ? "bucket_1x1.png"
            : prop.kind === "drawers" ? `drawer_${variant % 3 + 1}_1x1.png`
              : prop.kind === "shelf" ? `shelf_${variant % 2 + 1}_1x1.png`
                : prop.kind === "statue" ? "statue_1x1.png"
                  : prop.kind === "flower_pot" ? `flower_pot_${variant % 3 + 1}_1x1.png`
                    : modularHorizontalCounter ? "counter_horizontal_middle_1x1.png"
                    : modularVerticalCounter ? "counter_vertical_middle_1x1.png"
                    : modularHorizontalTable ? "table_horizontal_middle.png"
                    : modularVerticalTable ? "table_vertical_middle.png"
                    : prop.kind === "table" && prop.points.length === 1 ? "table_1x1.png"
                      : prop.kind === "table" && prop.points.length === 4 &&
                        rectangle.width === 2 && rectangle.height === 2 ? "table_2x2.png"
                        : undefined;
  if (!assetName) return [];
  const spriteLayout = interiorAssetSpriteLayout(assetName);
  const lpcAsset = modularWoodenBench || modularTable || modularCounter ||
    upholsteredBench || !!bedAsset;
  const assetFolder = bedAsset ? `lpc/${bedAsset.folder}/`
    : upholsteredBench ? "lpc/casual_sofa/"
    : lpcAsset ? "lpc/"
    : BAILEY_INTERIOR_ASSETS.has(assetName) ? "bailey/" : "ai/";
  const perCell = prop.kind === "crate" || modularWoodenBench || modularTable || modularCounter;
  const fittedLength = prop.kind === "hearth" || prop.kind === "cabinet" ||
    prop.kind === "tomb" || prop.kind === "altar" ||
    prop.kind === "table" && !modularTable &&
      (prop.points.length === 2 || prop.points.length === 3)
    ? prop.points.length : 0;
  const cabinetOverhang = prop.kind === "cabinet" &&
    (rectangle.height > rectangle.width || prop.facing === "south") ? 1 : 0;
  const benchAsset = prop.kind === "bench";
  const verticalBench = false;
  const assetWidth = bedAsset ? bedAsset.width
    : modularWoodenBench || modularTable || modularCounter ? 32
    : upholsteredBench ? prop.facing === "east" || prop.facing === "west" ? 32 : 64
    : benchAsset ? 160 : fittedLength
    ? rectangle.width * 32
    : assetName.includes("2x2") || assetName.includes("2x1") ? 64 : 32;
  const assetHeight = bedAsset ? bedAsset.height
    : upholsteredBench
    ? prop.facing === "east" || prop.facing === "west" ? 64 : 32
    : benchAsset ? 32 : fittedLength
    ? (rectangle.height + cabinetOverhang) * 32
    : assetName.includes("1x2") ? 64
      : assetName.includes("2x1") ? 32 : assetWidth;
  const layoutAssetWidth = !benchAsset && !fittedLength &&
      spriteLayout.renderWidthCells !== 1
    ? spriteLayout.renderWidthCells * 32 : assetWidth;
  const layoutAssetHeight = !benchAsset && !fittedLength &&
      spriteLayout.renderHeightCells !== 1
    ? spriteLayout.renderHeightCells * 32 : assetHeight;
  const rotation = verticalBench ? 90 : 0;
  const flipHorizontal = false;
  const orderedModulePoints = modularWoodenBench || modularTable || modularCounter
    ? [...prop.points].sort((first, second) => woodenVerticalBench || modularVerticalTable
      || modularVerticalCounter
      ? first.y - second.y : first.x - second.x)
    : prop.points;
  const placements = perCell
    ? orderedModulePoints.map((point, index) => ({
      centerX: point.x + .5,
      centerY: spriteLayout.anchor === "bottom"
        ? point.y + 1 - spriteLayout.renderHeightCells / 2
        : point.y + .5,
      widthCells: spriteLayout.renderWidthCells,
      heightCells: spriteLayout.renderHeightCells,
      footprint: [point],
      assetName: modularWoodenBench || modularTable || modularCounter
        ? `${woodenHorizontalBench ? "bench_horizontal"
          : woodenVerticalBench ? "bench_vertical"
          : modularHorizontalCounter ? "counter_horizontal"
          : modularVerticalCounter ? "counter_vertical"
          : modularVerticalTable ? "table_vertical" : "table_horizontal"}_${
          index === 0 ? woodenVerticalBench || modularVerticalTable || modularVerticalCounter
            ? "top" : "left"
            : index === orderedModulePoints.length - 1
              ? woodenVerticalBench || modularVerticalTable || modularVerticalCounter
                ? "down" : "right" : "middle"
        }${woodenHorizontalBench || modularCounter ? "_1x1" : ""}.png`
        : assetName,
    }))
    : [{
      centerX: rectangle.minimumX + rectangle.width / 2,
      centerY: bedAsset
        ? rectangle.minimumY + rectangle.height / 2
        : prop.kind === "cabinet"
        ? rectangle.minimumY + rectangle.height - layoutAssetHeight / 64
        : spriteLayout.anchor === "bottom"
          ? rectangle.minimumY + rectangle.height - layoutAssetHeight / 64
          : rectangle.minimumY + rectangle.height / 2,
      widthCells: bedAsset ? layoutAssetWidth / 32
        : upholsteredBench ? rectangle.width
        : benchAsset ? prop.points.length : layoutAssetWidth / 32,
      heightCells: bedAsset ? layoutAssetHeight / 32
        : upholsteredBench ? rectangle.height
        : benchAsset ? 1 : layoutAssetHeight / 32,
      footprint: prop.points,
      assetName,
    }];
  const roomSuffix = prop.roomRole ? ` · ${prop.roomRole}` : "";
  return placements.map((placement, index) => imageItem(
    crypto.randomUUID(),
    `${INTERIOR_PROP_RULES[prop.kind].label} ${prop.id}${
      placements.length > 1 ? `.${index + 1}` : ""}${roomSuffix}`,
    "PROP",
    `${PUBLIC_TILESET_ASSET_BASE}${assetFolder}${placement.assetName}`,
    "image/png",
    layoutAssetWidth,
    layoutAssetHeight,
    {
      x: placement.centerX * OWLBEAR_SCENE_DPI,
      y: placement.centerY * OWLBEAR_SCENE_DPI,
    },
    PROP_IMAGE_DPI,
    bedAsset
      ? { x: bedAsset.anchorX, y: bedAsset.anchorY }
      : { x: layoutAssetWidth / 2, y: layoutAssetHeight / 2 },
    zIndex + index,
    false,
    {
      x: (flipHorizontal ? -1 : 1) * placement.widthCells * PROP_IMAGE_DPI / layoutAssetWidth,
      y: placement.heightCells * PROP_IMAGE_DPI / layoutAssetHeight,
    },
    rotation,
    {
      "com.terra-map-generator/interior-prop": {
        kind: prop.kind,
        id: prop.id,
        orientation: prop.orientation,
        facing: prop.facing,
        roomRole: prop.roomRole,
        footprint: placement.footprint,
      },
      ...(lightSource && index === 0
        ? { "rodeo.owlbear.dynamic-fog/light": dynamicFogLightMetadata(lightSource) }
        : {}),
    },
  ));
}

const LIGHT_MARKER_ASSET = {
  url: `${PUBLIC_TILESET_ASSET_BASE}bailey/rock_1x1.png`,
  mime: "image/png",
  width: 32,
  height: 32,
} as const;

function lightItem(
  id: string,
  source: MapLightSource,
  sourceIndex: number,
  zIndex: number,
) {
  const marker = imageItem(
    id,
    `${LIGHT_SOURCE_NAMES[source.kind]} Light ${sourceIndex + 1}`,
    "PROP",
    LIGHT_MARKER_ASSET.url,
    LIGHT_MARKER_ASSET.mime,
    LIGHT_MARKER_ASSET.width,
    LIGHT_MARKER_ASSET.height,
    {
      x: source.x * OWLBEAR_SCENE_DPI,
      y: source.y * OWLBEAR_SCENE_DPI,
    },
    PROP_IMAGE_DPI,
    { x: LIGHT_MARKER_ASSET.width / 2, y: LIGHT_MARKER_ASSET.height / 2 },
    zIndex,
    false,
    { x: .01, y: .01 },
  );
  return {
    ...marker,
    metadata: {
      ...marker.metadata,
      "rodeo.owlbear.dynamic-fog/light": dynamicFogLightMetadata(source),
    },
  };
}

function imageDimensions(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timeout = window.setTimeout(() => {
      image.src = "";
      reject(new Error(`Timed out while loading custom prop: ${url}`));
    }, 10_000);
    image.onload = () => {
      window.clearTimeout(timeout);
      if (!image.naturalWidth || !image.naturalHeight) {
        reject(new Error(`Custom prop has invalid dimensions: ${url}`));
        return;
      }
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      window.clearTimeout(timeout);
      reject(new Error(`Unable to load custom prop image: ${url}`));
    };
    image.src = url;
  });
}

async function mimeFromUrl(parsed: URL): Promise<OwlbearPropAsset["mime"]> {
  const extension = parsed.pathname.split(".").pop()?.toLowerCase() ?? "";
  const extensionMime = PROP_MIME_BY_EXTENSION[extension];
  if (!extensionMime) {
    throw new Error(
      "Custom prop URLs must end with .png, .jpg, .jpeg, .webp, .gif, or .avif.",
    );
  }

  let response: Response | undefined;
  try {
    response = await fetch(parsed.href, { method: "HEAD" });
  } catch {
    // Many image hosts do not expose HEAD requests through CORS.
  }
  if (!response?.ok) return extensionMime;

  const contentType = response.headers.get("content-type")
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (!contentType || contentType === "application/octet-stream") {
    return extensionMime;
  }
  if (!SUPPORTED_PROP_MIMES.has(contentType as OwlbearPropAsset["mime"])) {
    throw new Error(`Unsupported custom prop Content-Type: ${contentType}`);
  }
  return contentType as OwlbearPropAsset["mime"];
}

export async function inspectPropAsset(
  customUrl: string | undefined,
  defaultAssetPath: string,
): Promise<OwlbearPropAsset> {
  const value = customUrl?.trim();
  if (!value) {
    const filename = defaultAssetPath.split("/").at(-1);
    if (!filename) throw new Error("Missing default prop asset name.");
    const size = DEFAULT_PROP_DIMENSIONS[filename];
    if (!size) throw new Error(`Unknown default prop asset: ${filename}`);
    const tilesetMarker = "/assets/tilesets/";
    const relativePath = defaultAssetPath.includes(tilesetMarker)
      ? defaultAssetPath.split(tilesetMarker, 2)[1]
      : filename;
    const url = new URL(relativePath, PUBLIC_TILESET_ASSET_BASE).href;
    return {
      url,
      mime: "image/png",
      width: size,
      height: size,
    };
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Invalid prop URL: ${value}`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Prop URLs must use HTTP or HTTPS.");
  }
  const mime = await mimeFromUrl(parsed);
  const dimensions = await imageDimensions(parsed.href);
  if (dimensions.width !== dimensions.height) {
    throw new Error(
      `Custom props must be square (${dimensions.width}×${dimensions.height} received).`,
    );
  }
  return { url: parsed.href, mime, ...dimensions };
}

async function owlBearPropAssets(
  customUrl: string | undefined,
  kind: "tree" | "rock",
  useTileset: boolean,
): Promise<PropAssetSet> {
  if (customUrl?.trim()) {
    const custom = await inspectPropAsset(customUrl, "");
    return { oneByOne: custom, twoByTwo: custom };
  }
  if (useTileset) {
    const [oneByOne, twoByTwo] = await Promise.all([
      inspectPropAsset(undefined, `/assets/tilesets/bailey/${kind}_1x1.png`),
      inspectPropAsset(undefined, `/assets/tilesets/bailey/${kind}_2x2.png`),
    ]);
    return { oneByOne, twoByTwo };
  }
  const fallback = await inspectPropAsset(
    undefined,
    `/assets/tilesets/bailey/${kind}.png`,
  );
  return { oneByOne: fallback, twoByTwo: fallback };
}

export async function createOwlbearSceneJson(
  grid: Grid,
  seed: string,
  hiddenItems: ReadonlySet<string>,
  options: OwlbearExportOptions,
): Promise<OwlbearSceneExport> {
  if (!grid.length) throw new Error("Generate a map before exporting.");
  const [treeAssets, rockAssets] = await Promise.all([
    owlBearPropAssets(options.treeUrl, "tree", options.useTileset ?? false),
    owlBearPropAssets(options.rockUrl, "rock", options.useTileset ?? false),
  ]);
  type ExportedSceneItem = (
      ReturnType<typeof imageItem> |
      ReturnType<typeof interiorPropItem> |
      ReturnType<typeof fogItem> |
      ReturnType<typeof fogDoorItem> |
      ReturnType<typeof lightItem>
  ) & {
    attachedTo?: string;
    disableAttachmentBehavior?: Array<
      "VISIBLE" | "SCALE" | "ROTATION" | "POSITION" |
        "DELETE" | "LOCKED" | "COPY"
    >;
  };
  const shared: Record<string, ExportedSceneItem> = {};
  const baseZIndex = Date.now();
  const mapId = crypto.randomUUID();
  const mapWidth = grid[0].length * MAP_IMAGE_DPI;
  const mapHeight = grid.length * MAP_IMAGE_DPI;
  if (
    options.mapImage.width !== mapWidth ||
    options.mapImage.height !== mapHeight
  ) {
    throw new Error("The uploaded background dimensions do not match the map.");
  }
  shared[mapId] = imageItem(
    mapId,
    "Terra generated background",
    "MAP",
    options.mapImage.url,
    options.mapImage.mime,
    mapWidth,
    mapHeight,
    { x: 0, y: 0 },
    MAP_IMAGE_DPI,
    { x: 0, y: 0 },
    baseZIndex,
    false,
  );

  const obstacleNames: Record<ExportedObstacle["kind"], string> = {
    [Obstacle.Tree]: "Tree",
    [Obstacle.Rock]: "Rock",
    [Obstacle.Building]: "Building",
  };
  let nextPropZIndex = baseZIndex + 1;
  collectObstacles(grid).forEach((obstacle) => {
    if (
      hiddenItems.has(obstacle.kind) ||
      obstacle.kind === Obstacle.Building
    ) return;
    const assets = obstacle.kind === Obstacle.Tree ? treeAssets : rockAssets;
    propPlacements(obstacle.points).forEach(({ x, y, size }, pointIndex) => {
      const asset = size === 2 ? assets.twoByTwo : assets.oneByOne;
      const id = crypto.randomUUID();
      shared[id] = imageItem(
        id,
        `${obstacleNames[obstacle.kind]} ${obstacle.id}.${pointIndex + 1}`,
        "PROP",
        asset.url,
        asset.mime,
        asset.width,
        asset.height,
        {
          x: (x + size / 2) * OWLBEAR_SCENE_DPI,
          y: (y + size / 2) * OWLBEAR_SCENE_DPI,
        },
        PROP_IMAGE_DPI,
        { x: asset.width / 2, y: asset.height / 2 },
        nextPropZIndex,
        false,
        {
          x: size * PROP_IMAGE_DPI / asset.width,
          y: size * PROP_IMAGE_DPI / asset.height,
        },
      );
      nextPropZIndex += 1;
    });
  });

  const mapLightSources = collectMapLightSources(grid);
  const lightSourceByInteriorPropId = new Map(
    mapLightSources.flatMap((source) => source.interiorPropId === undefined
      ? [] : [[source.interiorPropId, source] as const]),
  );
  collectInteriorProps(grid).forEach((prop) => {
    const lightSource = options.dynamicFog
      ? lightSourceByInteriorPropId.get(prop.id) : undefined;
    const sprites = options.useTileset
      ? interiorPropSpriteItems(prop, nextPropZIndex, lightSource) : [];
    if (sprites.length) {
      sprites.forEach((item) => { shared[item.id] = item; });
      nextPropZIndex += sprites.length;
    } else {
      const id = crypto.randomUUID();
      shared[id] = interiorPropItem(id, prop, nextPropZIndex, lightSource);
      nextPropZIndex += 1;
    }
  });

  if (options.dynamicFog) {
    const rooms = roomFogContours(grid);
    const isInterior = rooms.length > 0;
    const addFogContours = (
      name: string,
      matches: (x: number, y: number) => boolean,
      includeMapBoundary = true,
    ) => {
      fogContours(grid, matches, includeMapBoundary)
        .forEach((contour, index, contours) => {
          const id = crypto.randomUUID();
          shared[id] = fogItem(
            id,
            `${name} Fog${contours.length > 1 ? ` ${index + 1}` : ""}`,
            contour,
            nextPropZIndex,
          );
          nextPropZIndex += 1;
        });
    };

    if (!hiddenItems.has(Terrain.Cliff)) {
      addFogContours(
        "Cliff",
        (x, y) => grid[y]?.[x]?.terrain === Terrain.Cliff,
      );
    }

    if (isInterior) {
      rooms.forEach(({ roomId, role, contour }) => {
        const id = crypto.randomUUID();
        shared[id] = fogItem(
          id,
          `${role || `Room ${roomId + 1}`} Fog`,
          contour,
          nextPropZIndex,
        );
        nextPropZIndex += 1;
      });
      for (let y = 0; y < grid.length; y += 1) {
        for (let x = 0; x < grid[y].length; x += 1) {
          const tile = grid[y][x];
          if (tile.terrain !== Terrain.Door || !tile.doorOrientation) continue;
          const id = crypto.randomUUID();
          shared[id] = fogDoorItem(
            id,
            x,
            y,
            tile.doorOrientation,
            nextPropZIndex,
          );
          nextPropZIndex += 1;
        }
      }
    } else if (!hiddenItems.has(Terrain.Wall)) {
      addFogContours(
        "Wall",
        (x, y) => grid[y]?.[x]?.terrain === Terrain.Wall,
      );
    }

    if (!hiddenItems.has(Obstacle.Building)) {
      collectObstacles(grid)
        .filter(({ kind }) => kind === Obstacle.Building)
        .forEach((building, buildingIndex) => {
          const cells = new Set(
            building.points.map(({ x, y }) => `${x},${y}`),
          );
          addFogContours(
            `Building ${buildingIndex + 1}`,
            (x, y) => cells.has(`${x},${y}`),
          );
        });
    }

    if (!isInterior) {
      addFogContours(
        "Terrain",
        (x, y) => {
          const tile = grid[y]?.[x];
          return Boolean(
            tile &&
            FOG_TERRAINS.has(tile.terrain) &&
            tile.obstacle !== Obstacle.Building,
          );
        },
        false,
      );
    }

    mapLightSources
      .filter((source) => source.interiorPropId === undefined)
      .filter((source) => source.kind !== "lava" || !hiddenItems.has(Terrain.Lava))
      .forEach((source, sourceIndex) => {
        const id = crypto.randomUUID();
        shared[id] = lightItem(id, source, sourceIndex, nextPropZIndex);
        nextPropZIndex += 1;
      });
  }

  const width = grid[0].length * OWLBEAR_SCENE_DPI;
  const height = grid.length * OWLBEAR_SCENE_DPI;
  for (const [id, item] of Object.entries(shared)) {
    if (id === mapId) continue;
    item.attachedTo = mapId;
    item.disableAttachmentBehavior = [
      "SCALE",
      "ROTATION",
      "VISIBLE",
      "LOCKED",
    ];
  }
  const scene = {
    items: { shared, local: {} },
    bounds: {
      min: { x: 0, y: 0 },
      max: { x: width, y: height },
    },
  };
  return {
    json: JSON.stringify(scene),
    filename:
      `terra-${safeSeed(seed)}-${grid[0].length}x${grid.length}-owlbear.json`,
  };
}

export function downloadOwlbearJson(scene: OwlbearSceneExport) {
  const blob = new Blob([scene.json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.download = scene.filename;
  link.href = url;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
