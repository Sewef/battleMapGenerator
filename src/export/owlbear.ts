import {
  INTERIOR_PROP_RULES,
  Obstacle,
  OUTDOOR_PROP_RULES,
  Terrain,
  type Grid,
  type LandscapeMode,
  type ObstacleKind,
  type OutdoorPropKind,
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
  blueBedAssetDefinitions,
  casualSofaAssetNames,
  interiorAssetPath,
  interiorAssetSpriteLayout,
  selectBedAssetDefinition,
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
const FALLBACK_TILESET_ASSET_BASE =
  "https://cdn.jsdelivr.net/gh/Sewef/battleMapGenerator@main/public/assets/tilesets/";
// Owlbear caches remote image URLs aggressively. Change this revision whenever
// a shipped tileset image is replaced so an export cannot reuse the old bitmap.
const TILESET_ASSET_REVISION = "20260812-rocks";

const publicTilesetAssetBase = () => typeof window === "undefined"
  ? FALLBACK_TILESET_ASSET_BASE
  : new URL("/assets/tilesets/", window.location.origin).href;

function publicTilesetAssetUrl(relativePath: string) {
  const url = new URL(relativePath, publicTilesetAssetBase());
  if (typeof window !== "undefined") {
    url.searchParams.set("v", TILESET_ASSET_REVISION);
  }
  return url.href;
}

type ExportedObstacle = {
  kind: Exclude<ObstacleKind, "none">;
  id: number;
  variant?: number;
  points: Array<{ x: number; y: number }>;
};

type ExportedOutdoorProp = {
  kind: OutdoorPropKind;
  id: number;
  x: number;
  y: number;
};

type PropPlacement = { x: number; y: number; size: 1 | 2 };
type PropAssetSet = {
  oneByOne: OwlbearPropAsset;
  twoByTwo: OwlbearPropAsset;
};
type RockAssetSet = {
  oneByOne: OwlbearPropAsset[];
  oneByTwo: OwlbearPropAsset[];
  twoByOne: OwlbearPropAsset[];
  twoByTwo: OwlbearPropAsset[];
  twoByThree: OwlbearPropAsset[];
  threeByThree: OwlbearPropAsset[];
  fourByThree: OwlbearPropAsset[];
  fourByFive: OwlbearPropAsset[];
  fiveByFour: OwlbearPropAsset[];
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
const DEFAULT_PROP_DIMENSIONS: Record<string, { width: number; height: number }> = {
  "tree_1x1.png": { width: 32, height: 32 },
  "tree_2x2.png": { width: 64, height: 64 },
  ...Object.fromEntries(Array.from({ length: 7 }, (_, index) =>
    [`rock_${index + 1}_1x1.png`, { width: 32, height: 32 }])),
  ...Object.fromEntries(Array.from({ length: 9 }, (_, index) =>
    [`rock_${index + 1}_1x2.png`, { width: 32, height: 64 }])),
  "rock_2x1.png": { width: 64, height: 32 },
  ...Object.fromEntries(Array.from({ length: 7 }, (_, index) =>
    [`rock_${index + 1}_2x2.png`, { width: 64, height: 64 }])),
  "rock_desert_1x1.png": { width: 32, height: 32 },
  "rock_desert_1x2.png": { width: 32, height: 64 },
  "rock_desert_1_2x2.png": { width: 64, height: 64 },
  "rock_desert_2_2x2.png": { width: 64, height: 64 },
  "tree.png": { width: 64, height: 64 },
  "rock.png": { width: 64, height: 64 },
};

export interface OwlbearExportOptions {
  mapImage: UploadedMapImage;
  mode?: LandscapeMode;
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
        variant: tile.propVariant,
        points: [],
      };
      obstacle.points.push({ x, y });
      obstacles.set(key, obstacle);
    }
  }
  return [...obstacles.values()];
}

function collectOutdoorProps(grid: Grid): ExportedOutdoorProp[] {
  const props: ExportedOutdoorProp[] = [];
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      const tile = grid[y][x];
      if (!tile.outdoorProp) continue;
      props.push({
        kind: tile.outdoorProp,
        id: tile.outdoorPropId ?? y * grid[y].length + x,
        x,
        y,
      });
    }
  }
  return props;
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
        variant: tile.propVariant,
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

function completeRectangleOrigin(
  points: Array<{ x: number; y: number }>,
  width: number,
  height: number,
) {
  if (points.length !== width * height) return undefined;
  const minimumX = Math.min(...points.map(({ x }) => x));
  const minimumY = Math.min(...points.map(({ y }) => y));
  const pointKeys = new Set(points.map(({ x, y }) => `${x},${y}`));
  for (let offsetY = 0; offsetY < height; offsetY += 1) {
    for (let offsetX = 0; offsetX < width; offsetX += 1) {
      if (!pointKeys.has(`${minimumX + offsetX},${minimumY + offsetY}`)) {
        return undefined;
      }
    }
  }
  return { x: minimumX, y: minimumY };
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
      "com.touchgrass/export": true,
      ...metadata,
    },
    image: { url, mime, width, height },
    grid: { dpi: gridDpi, offset: gridOffset },
    text: emptyText(),
    textItemType: "LABEL",
    layer,
  };
}

function perspectiveZIndex(
  baseZIndex: number,
  bottomY: number,
  centerX: number,
  tieBreaker = 0,
) {
  // The lower visual edge controls depth. X and the tie breaker only make
  // otherwise equal depths deterministic and cannot overtake a full row.
  return baseZIndex + Math.round(bottomY * 1_000_000) +
    Math.round(centerX * 1_000) + tieBreaker;
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
    metadata: { "com.touchgrass/export": true },
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

type DoorFogRun = {
  x: number;
  y: number;
  length: number;
  orientation: "horizontal" | "vertical";
};

function doorFogRuns(grid: Grid) {
  const runs: DoorFogRun[] = [];
  for (let y = 0; y < grid.length; y += 1) {
    let x = 0;
    while (x < grid[y].length) {
      const tile = grid[y][x];
      if (tile.terrain !== Terrain.Door || tile.doorOrientation !== "horizontal") {
        x += 1;
        continue;
      }
      const start = x;
      while (
        x < grid[y].length &&
        grid[y][x].terrain === Terrain.Door &&
        grid[y][x].doorOrientation === "horizontal"
      ) {
        x += 1;
      }
      runs.push({ x: start, y, length: x - start, orientation: "horizontal" });
    }
  }

  const width = grid[0]?.length ?? 0;
  for (let x = 0; x < width; x += 1) {
    let y = 0;
    while (y < grid.length) {
      const tile = grid[y]?.[x];
      if (tile?.terrain !== Terrain.Door || tile.doorOrientation !== "vertical") {
        y += 1;
        continue;
      }
      const start = y;
      while (
        y < grid.length &&
        grid[y]?.[x]?.terrain === Terrain.Door &&
        grid[y][x].doorOrientation === "vertical"
      ) {
        y += 1;
      }
      runs.push({ x, y: start, length: y - start, orientation: "vertical" });
    }
  }

  return runs;
}

function fogDoorItem(
  id: string,
  x: number,
  y: number,
  orientation: "horizontal" | "vertical",
  zIndex: number,
  lengthCells = 1,
) {
  const horizontal = orientation === "horizontal";
  const length = lengthCells * OWLBEAR_SCENE_DPI;
  return {
    id,
    name: "Door",
    zIndex,
    locked: false,
    metadata: {
      "com.touchgrass/export": true,
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
  campfire: "Campfire",
  lamp_post: "Lamp post",
};

type InteriorPropKind = NonNullable<Tile["interiorProp"]>;
type ExportedInteriorProp = {
  kind: InteriorPropKind;
  id: number;
  variant?: number;
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
  statue: { fillColor: "#8e918b", strokeColor: "#484c49", shapeType: "CIRCLE" },
  barrel: { fillColor: "#805238", strokeColor: "#3b281f", shapeType: "CIRCLE" },
  bucket: { fillColor: "#555d5d", strokeColor: "#252d2d", shapeType: "CIRCLE" },
  flower_pot: { fillColor: "#9a634b", strokeColor: "#4b3028", shapeType: "CIRCLE" },
  bones: { fillColor: "#d0c8ae", strokeColor: "#625d50", shapeType: "RECTANGLE" },
  wall_chain: { fillColor: "#62625f", strokeColor: "#292a29", shapeType: "RECTANGLE" },
};

const OUTDOOR_PROP_DRAWING_STYLES: Record<
  OutdoorPropKind,
  { fillColor: string; strokeColor: string; shapeType: "RECTANGLE" | "CIRCLE" }
> = {
  campfire: { fillColor: "#cf5b35", strokeColor: "#3d2a22", shapeType: "CIRCLE" },
  lamp_post: { fillColor: "#f0c66a", strokeColor: "#3a3026", shapeType: "RECTANGLE" },
};

function dynamicFogLightMetadata(source: MapLightSource) {
  return {
    attenuationRadius: Math.round(source.attenuationRadius * OWLBEAR_SCENE_DPI),
    sourceRadius: Math.max(1, Math.round(source.sourceRadius * OWLBEAR_SCENE_DPI)),
    falloff: source.falloff,
    lightType: source.lightType,
  };
}

function outdoorPropItem(
  id: string,
  prop: ExportedOutdoorProp,
  baseZIndex: number,
  tieBreaker = 0,
) {
  const style = OUTDOOR_PROP_DRAWING_STYLES[prop.kind];
  const width = prop.kind === "lamp_post"
    ? OWLBEAR_SCENE_DPI * .38
    : OWLBEAR_SCENE_DPI * .62;
  const height = prop.kind === "lamp_post"
    ? OWLBEAR_SCENE_DPI * .82
    : OWLBEAR_SCENE_DPI * .62;
  const center = {
    x: (prop.x + .5) * OWLBEAR_SCENE_DPI,
    y: (prop.y + .5) * OWLBEAR_SCENE_DPI,
  };
  const position = style.shapeType === "CIRCLE"
    ? center
    : { x: center.x - width / 2, y: center.y - height / 2 };
  return {
    id,
    name: `${OUTDOOR_PROP_RULES[prop.kind].label} ${prop.id}`,
    zIndex: perspectiveZIndex(baseZIndex, prop.y + 1, prop.x + .5, tieBreaker),
    locked: false,
    metadata: {
      "com.touchgrass/export": true,
      "com.touchgrass/outdoor-prop": {
        kind: prop.kind,
        id: prop.id,
        footprint: [{ x: prop.x, y: prop.y }],
      },
    },
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
      fillOpacity: 1,
      strokeColor: style.strokeColor,
      strokeOpacity: .9,
      strokeWidth: 5,
      strokeDash: [],
    },
  };
}

function interiorPropItem(
  id: string,
  prop: ExportedInteriorProp,
  baseZIndex: number,
  lightSource?: MapLightSource,
  tieBreaker = 0,
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
  const zIndex = perspectiveZIndex(
    baseZIndex,
    maximumY + 1,
    minimumX + widthInCells / 2,
    tieBreaker,
  );
  const roomSuffix = prop.roomRole ? ` · ${prop.roomRole}` : "";
  return {
    id,
    name: `${INTERIOR_PROP_RULES[prop.kind].label} ${prop.id}${roomSuffix}`,
    zIndex,
    locked: false,
    metadata: {
      "com.touchgrass/export": true,
      "com.touchgrass/interior-prop": {
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
      fillOpacity: 1,
      strokeColor: style.strokeColor,
      strokeOpacity: .9,
      strokeWidth: 5,
      strokeDash: [],
    },
  };
}

function stoolPathCommands(radius: number) {
  const kappa = 0.7071067690849304;
  const branchStart = radius * 1.08;
  const branchEnd = radius * 1.48;
  const diagonal = Math.SQRT1_2;
  return [
    [0, 0, radius],
    [3, radius, radius, radius, 0, kappa],
    [3, radius, -radius, 0, -radius, kappa],
    [3, -radius, -radius, -radius, 0, kappa],
    [3, -radius, radius, 0, radius, kappa],
    [5],
    [0, -branchStart * diagonal, -branchStart * diagonal],
    [1, -branchEnd * diagonal, -branchEnd * diagonal],
    [0, branchStart * diagonal, -branchStart * diagonal],
    [1, branchEnd * diagonal, -branchEnd * diagonal],
    [0, -branchStart * diagonal, branchStart * diagonal],
    [1, -branchEnd * diagonal, branchEnd * diagonal],
    [0, branchStart * diagonal, branchStart * diagonal],
    [1, branchEnd * diagonal, branchEnd * diagonal],
  ];
}

function stoolPathItem(
  id: string,
  prop: ExportedInteriorProp,
  baseZIndex: number,
  lightSource?: MapLightSource,
  tieBreaker = 0,
) {
  const minimumX = Math.min(...prop.points.map(({ x }) => x));
  const maximumX = Math.max(...prop.points.map(({ x }) => x));
  const minimumY = Math.min(...prop.points.map(({ y }) => y));
  const maximumY = Math.max(...prop.points.map(({ y }) => y));
  const widthInCells = maximumX - minimumX + 1;
  const heightInCells = maximumY - minimumY + 1;
  const position = {
    x: (minimumX + widthInCells / 2) * OWLBEAR_SCENE_DPI,
    y: (minimumY + heightInCells / 2) * OWLBEAR_SCENE_DPI,
  };
  const radius = Math.max(14, Math.min(widthInCells, heightInCells) * OWLBEAR_SCENE_DPI * .18);
  const zIndex = perspectiveZIndex(
    baseZIndex,
    maximumY + 1,
    minimumX + widthInCells / 2,
    tieBreaker,
  );
  const roomSuffix = prop.roomRole ? ` Â· ${prop.roomRole}` : "";
  return {
    id,
    name: `Stool ${prop.id}${roomSuffix}`,
    zIndex,
    locked: false,
    metadata: {
      "com.touchgrass/export": true,
      "com.touchgrass/interior-prop": {
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
    position,
    rotation: 0,
    scale: { x: 1, y: 1 },
    type: "PATH",
    visible: true,
    layer: "PROP",
    style: {
      fillColor: "#9b6a47",
      fillOpacity: 1,
      strokeColor: "#422b20",
      strokeOpacity: .9,
      strokeWidth: 5,
      strokeDash: [],
    },
    commands: stoolPathCommands(radius),
  };
}

function benchPathCommands(width: number, height: number) {
  const kappa = 0.7071067690849304;
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const radius = Math.min(halfHeight, halfWidth);
  const straightHalfWidth = Math.max(0, halfWidth - radius);
  const branchX = straightHalfWidth + radius * Math.SQRT1_2;
  const branchY = radius * Math.SQRT1_2;
  const branchLength = Math.min(width, height) * .3;
  return [
    [0, -straightHalfWidth, -radius],
    [1, straightHalfWidth, -radius],
    [3, straightHalfWidth + radius, -radius, straightHalfWidth + radius, 0, kappa],
    [3, straightHalfWidth + radius, radius, straightHalfWidth, radius, kappa],
    [1, -straightHalfWidth, radius],
    [3, -straightHalfWidth - radius, radius, -straightHalfWidth - radius, 0, kappa],
    [3, -straightHalfWidth - radius, -radius, -straightHalfWidth, -radius, kappa],
    [5],
    [0, -branchX, -branchY],
    [1, -branchX - branchLength, -branchY - branchLength],
    [0, -branchX, branchY],
    [1, -branchX - branchLength, branchY + branchLength],
    [0, branchX, -branchY],
    [1, branchX + branchLength, -branchY - branchLength],
    [0, branchX, branchY],
    [1, branchX + branchLength, branchY + branchLength],
  ];
}

function benchPathItem(
  id: string,
  prop: ExportedInteriorProp,
  baseZIndex: number,
  lightSource?: MapLightSource,
  tieBreaker = 0,
) {
  const minimumX = Math.min(...prop.points.map(({ x }) => x));
  const maximumX = Math.max(...prop.points.map(({ x }) => x));
  const minimumY = Math.min(...prop.points.map(({ y }) => y));
  const maximumY = Math.max(...prop.points.map(({ y }) => y));
  const widthInCells = maximumX - minimumX + 1;
  const heightInCells = maximumY - minimumY + 1;
  const vertical = prop.orientation === "vertical" || heightInCells > widthInCells;
  const width = Math.max(24, widthInCells * OWLBEAR_SCENE_DPI * (vertical ? .34 : .78));
  const height = Math.max(24, heightInCells * OWLBEAR_SCENE_DPI * (vertical ? .78 : .34));
  const position = {
    x: (minimumX + widthInCells / 2) * OWLBEAR_SCENE_DPI,
    y: (minimumY + heightInCells / 2) * OWLBEAR_SCENE_DPI,
  };
  const zIndex = perspectiveZIndex(
    baseZIndex,
    maximumY + 1,
    minimumX + widthInCells / 2,
    tieBreaker,
  );
  const roomSuffix = prop.roomRole ? ` · ${prop.roomRole}` : "";
  return {
    id,
    name: `Bench ${prop.id}${roomSuffix}`,
    zIndex,
    locked: false,
    metadata: {
      "com.touchgrass/export": true,
      "com.touchgrass/interior-prop": {
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
    position,
    rotation: 0,
    scale: { x: 1, y: 1 },
    type: "PATH",
    visible: true,
    layer: "PROP",
    style: {
      fillColor: "#956347",
      fillOpacity: 1,
      strokeColor: "#432b20",
      strokeOpacity: .9,
      strokeWidth: 5,
      strokeDash: [],
    },
    commands: benchPathCommands(width, height),
  };
}

function bedPathCommands(
  width: number,
  height: number,
  facing: Tile["propFacing"] | undefined,
) {
  const left = -width / 2;
  const right = width / 2;
  const top = -height / 2;
  const bottom = height / 2;
  if (facing === "east") {
    const pillowX = width * .14;
    return [
      [0, left, top],
      [1, right, top],
      [1, right, bottom],
      [1, left, bottom],
      [5],
      [0, pillowX, top],
      [1, pillowX, bottom],
    ];
  }
  if (facing === "west") {
    const pillowX = -width * .14;
    return [
      [0, left, top],
      [1, right, top],
      [1, right, bottom],
      [1, left, bottom],
      [5],
      [0, pillowX, top],
      [1, pillowX, bottom],
    ];
  }
  if (facing === "south") {
    const pillowY = height * .14;
    return [
      [0, left, top],
      [1, right, top],
      [1, right, bottom],
      [1, left, bottom],
      [5],
      [0, left, pillowY],
      [1, right, pillowY],
    ];
  }
  const pillowY = -height * .14;
  return [
    [0, left, top],
    [1, right, top],
    [1, right, bottom],
    [1, left, bottom],
    [5],
    [0, left, pillowY],
    [1, right, pillowY],
  ];
}

function bedPathItem(
  id: string,
  prop: ExportedInteriorProp,
  baseZIndex: number,
  lightSource?: MapLightSource,
  tieBreaker = 0,
) {
  const minimumX = Math.min(...prop.points.map(({ x }) => x));
  const maximumX = Math.max(...prop.points.map(({ x }) => x));
  const minimumY = Math.min(...prop.points.map(({ y }) => y));
  const maximumY = Math.max(...prop.points.map(({ y }) => y));
  const widthInCells = maximumX - minimumX + 1;
  const heightInCells = maximumY - minimumY + 1;
  const vertical = prop.orientation === "vertical" || heightInCells > widthInCells;
  const width = Math.max(24, widthInCells * OWLBEAR_SCENE_DPI * (vertical ? .72 : .94));
  const height = Math.max(24, heightInCells * OWLBEAR_SCENE_DPI * (vertical ? .94 : .72));
  const position = {
    x: (minimumX + widthInCells / 2) * OWLBEAR_SCENE_DPI,
    y: (minimumY + heightInCells / 2) * OWLBEAR_SCENE_DPI,
  };
  const zIndex = perspectiveZIndex(
    baseZIndex,
    maximumY + 1,
    minimumX + widthInCells / 2,
    tieBreaker,
  );
  const roomSuffix = prop.roomRole ? ` Â· ${prop.roomRole}` : "";
  return {
    id,
    name: `${INTERIOR_PROP_RULES.bed.label} ${prop.id}${roomSuffix}`,
    zIndex,
    locked: false,
    metadata: {
      "com.touchgrass/export": true,
      "com.touchgrass/interior-prop": {
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
    position,
    rotation: 0,
    scale: { x: 1, y: 1 },
    type: "PATH",
    visible: true,
    layer: "PROP",
    style: {
      fillColor: "#cbbd9d",
      fillOpacity: 1,
      strokeColor: "#58483a",
      strokeOpacity: .9,
      strokeWidth: 5,
      strokeDash: [],
    },
    commands: bedPathCommands(width, height, prop.facing),
  };
}

function rectPathCommands(
  left: number,
  top: number,
  width: number,
  height: number,
) {
  const right = left + width;
  const bottom = top + height;
  return [
    [0, left, top],
    [1, right, top],
    [1, right, bottom],
    [1, left, bottom],
    [5],
  ];
}

function hearthPathCommands(
  width: number,
  height: number,
  facing: Tile["propFacing"] | undefined,
  vertical: boolean,
) {
  const left = -width / 2;
  const top = -height / 2;
  const frame = Math.max(3, Math.min(width, height) * .14);
  const innerLeft = left + frame;
  const innerTop = top + frame;
  const innerWidth = width - frame * 2;
  const innerHeight = height - frame * 2;
  const wallSide = facing === "north" ? "south"
    : facing === "east" ? "west"
      : facing === "south" ? "north"
        : facing === "west" ? "east"
          : vertical ? "west" : "south";
  const blockWidth = wallSide === "west" || wallSide === "east"
    ? innerWidth * .42
    : innerWidth * .3;
  const blockHeight = wallSide === "west" || wallSide === "east"
    ? innerHeight * .3
    : innerHeight * .42;
  const blockLeft = wallSide === "west"
    ? innerLeft
    : wallSide === "east"
      ? innerLeft + innerWidth - blockWidth
      : -blockWidth / 2;
  const blockTop = wallSide === "north"
    ? innerTop
    : wallSide === "south"
      ? innerTop + innerHeight - blockHeight
      : -blockHeight / 2;
  return [
    ...rectPathCommands(left, top, width, height),
    ...rectPathCommands(innerLeft, innerTop, innerWidth, innerHeight),
    ...rectPathCommands(blockLeft, blockTop, blockWidth, blockHeight),
  ];
}

function hearthPathItem(
  id: string,
  prop: ExportedInteriorProp,
  baseZIndex: number,
  lightSource?: MapLightSource,
  tieBreaker = 0,
) {
  const minimumX = Math.min(...prop.points.map(({ x }) => x));
  const maximumX = Math.max(...prop.points.map(({ x }) => x));
  const minimumY = Math.min(...prop.points.map(({ y }) => y));
  const maximumY = Math.max(...prop.points.map(({ y }) => y));
  const widthInCells = maximumX - minimumX + 1;
  const heightInCells = maximumY - minimumY + 1;
  const vertical = prop.orientation === "vertical" || heightInCells > widthInCells;
  const width = Math.max(24, widthInCells * OWLBEAR_SCENE_DPI * (vertical ? .66 : .94));
  const height = Math.max(24, heightInCells * OWLBEAR_SCENE_DPI * (vertical ? .94 : .66));
  const position = {
    x: (minimumX + widthInCells / 2) * OWLBEAR_SCENE_DPI,
    y: (minimumY + heightInCells / 2) * OWLBEAR_SCENE_DPI,
  };
  const zIndex = perspectiveZIndex(
    baseZIndex,
    maximumY + 1,
    minimumX + widthInCells / 2,
    tieBreaker,
  );
  const roomSuffix = prop.roomRole ? ` · ${prop.roomRole}` : "";
  return {
    id,
    name: `${INTERIOR_PROP_RULES.hearth.label} ${prop.id}${roomSuffix}`,
    zIndex,
    locked: false,
    metadata: {
      "com.touchgrass/export": true,
      "com.touchgrass/interior-prop": {
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
    position,
    rotation: 0,
    scale: { x: 1, y: 1 },
    type: "PATH",
    visible: true,
    layer: "PROP",
    style: {
      fillColor: "#827768",
      fillOpacity: 1,
      strokeColor: "#403a35",
      strokeOpacity: .9,
      strokeWidth: 5,
      strokeDash: [],
    },
    commands: hearthPathCommands(width, height, prop.facing, vertical),
    fillRule: "evenodd",
  };
}

function statuePathCommands(radius: number) {
  const scale = radius / 60;
  const kappa = 0.7071067690849304;
  const starPoints = [
    [14.7857666015625, -20.3505859375],
    [0, -58.5],
    [-14.7857666015625, -20.3505859375],
    [-55.6368408203125, -18.07763671875],
    [-23.923828125, 7.7734375],
    [-34.385498046875, 47.32763671875],
    [0, 25.1552734375],
    [34.385498046875, 47.32763671875],
    [23.923828125, 7.7734375],
    [55.6368408203125, -18.07763671875],
    [14.7857666015625, -20.3505859375],
  ];
  return [
    [0, 0, radius],
    [3, radius, radius, radius, 0, kappa],
    [3, radius, -radius, 0, -radius, kappa],
    [3, -radius, -radius, -radius, 0, kappa],
    [3, -radius, radius, 0, radius, kappa],
    [5],
    ...starPoints.map(([x, y], index) => [
      index === 0 ? 0 : 1,
      x * scale,
      y * scale,
    ]),
    [5],
  ];
}

function statuePathItem(
  id: string,
  prop: ExportedInteriorProp,
  baseZIndex: number,
  lightSource?: MapLightSource,
  tieBreaker = 0,
) {
  const minimumX = Math.min(...prop.points.map(({ x }) => x));
  const maximumX = Math.max(...prop.points.map(({ x }) => x));
  const minimumY = Math.min(...prop.points.map(({ y }) => y));
  const maximumY = Math.max(...prop.points.map(({ y }) => y));
  const widthInCells = maximumX - minimumX + 1;
  const heightInCells = maximumY - minimumY + 1;
  const position = {
    x: (minimumX + widthInCells / 2) * OWLBEAR_SCENE_DPI,
    y: (minimumY + heightInCells / 2) * OWLBEAR_SCENE_DPI,
  };
  const radius = Math.max(12, Math.min(widthInCells, heightInCells) * OWLBEAR_SCENE_DPI * .4);
  const roomSuffix = prop.roomRole ? ` Â· ${prop.roomRole}` : "";
  return {
    id,
    name: `${INTERIOR_PROP_RULES.statue.label} ${prop.id}${roomSuffix}`,
    zIndex: perspectiveZIndex(
      baseZIndex,
      maximumY + 1,
      minimumX + widthInCells / 2,
      tieBreaker,
    ),
    locked: false,
    metadata: {
      "com.touchgrass/export": true,
      "com.touchgrass/interior-prop": {
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
    position,
    rotation: 0,
    scale: { x: 1, y: 1 },
    type: "PATH",
    visible: true,
    layer: "PROP",
    style: {
      fillColor: "#8e918b",
      fillOpacity: 1,
      strokeColor: "#484c49",
      strokeOpacity: .9,
      strokeWidth: 5,
      strokeDash: [],
    },
    commands: statuePathCommands(radius),
    fillRule: "evenodd",
  };
}

function interiorPropSpriteItems(
  prop: ExportedInteriorProp,
  baseZIndex: number,
  mode: LandscapeMode | undefined,
  lightSource?: MapLightSource,
  tieBreaker = 0,
) {
  const variant = prop.variant ?? Math.abs(prop.id);
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
  const compositeAssetName = woodenHorizontalBench
    ? `bench_horizontal_${rectangle.width}x1.png`
    : woodenVerticalBench ? `bench_vertical_1x${rectangle.height}.png`
      : modularHorizontalCounter ? `counter_horizontal_${rectangle.width}x1.png`
        : modularVerticalCounter ? `counter_vertical_1x${rectangle.height}.png`
          : modularHorizontalTable ? `table_horizontal_${rectangle.width}x1.png`
            : modularVerticalTable ? `table_vertical_1x${rectangle.height}.png`
              : undefined;
  const casualSofaNames = upholsteredBench
    ? casualSofaAssetNames((prop.facing ?? "north") as FurnitureFacing)
    : [];
  const bedFacing = (prop.facing ?? "north") as FurnitureFacing;
  const doubleBed = prop.points.length === 4;
  const bedAssets = prop.kind === "bed"
    ? bedAssetDefinitions(doubleBed, bedFacing)
    : [];
  const bedAsset = prop.kind === "bed"
    ? prop.variant !== undefined
      ? bedAssets[prop.variant % bedAssets.length]
      : mode === "spaceship"
        ? (() => {
          const blueBeds = blueBedAssetDefinitions(doubleBed, bedFacing);
          return blueBeds[variant % blueBeds.length];
        })()
        : selectBedAssetDefinition(doubleBed, bedFacing, variant, prop.roomRole)
    : undefined;
  const assetName = prop.kind === "bed"
    ? bedAsset?.name
    : prop.kind === "hearth" && (prop.points.length === 2 || prop.points.length === 3)
      ? rectangle.width > rectangle.height
        ? `hearth_${prop.points.length}x1.png`
        : `hearth_1x${prop.points.length}.png`
    : prop.kind === "cabinet" && (prop.points.length === 2 || prop.points.length === 3)
      ? rectangle.width > rectangle.height
        ? prop.points.length === 2
          ? `cabinet_${prop.facing === "south" ? "south" : "north"}_2x1.png`
          : undefined
        : `cabinet_vertical_1x${prop.points.length}.png`
    : prop.kind === "tomb" && prop.points.length === 2
      ? rectangle.width > rectangle.height ? "coffin_2x1.png" : "coffin_1x2.png"
    : prop.kind === "altar" && (prop.points.length === 2 || prop.points.length === 3)
      ? rectangle.width > rectangle.height
        ? `altar_${prop.points.length}x1.png`
        : `altar_vertical_1x${prop.points.length}.png`
    : compositeAssetName ?? (prop.kind === "bench"
      ? upholsteredBench ? casualSofaNames[variant % casualSofaNames.length]
        : `bench_${prop.facing === "south" || prop.facing === "west"
          ? "south" : "north"}.png`
    : prop.kind === "chair" ? "stool_1x1.png"
      : prop.kind === "crate" ? `crate_${variant % 4 + 1}_1x1.png`
        : prop.kind === "barrel" ? "barrel_1x1.png"
          : prop.kind === "bucket" ? `bucket_${variant % 2 + 1}_1x1.png`
            : prop.kind === "drawers" ? `drawer_${variant % 3 + 1}_1x1.png`
              : prop.kind === "shelf" ? `shelf_${variant % 7 + 1}_1x1.png`
                : prop.kind === "statue" ? "statue_1x1.png"
                  : prop.kind === "flower_pot" ? `flower_pot_${variant % 3 + 1}_1x1.png`
                    : prop.kind === "bones" ? `bones_${variant % 5 + 1}_1x1.png`
                      : prop.kind === "wall_chain" ? `wall_chain_${variant % 2 + 1}_1x2.png`
                    : prop.kind === "table" && prop.points.length === 1 ? "table_1x1.png"
                      : prop.kind === "table" && prop.points.length === 4 &&
                        rectangle.width === 2 && rectangle.height === 2 ? "table_2x2.png"
                        : undefined);
  if (!assetName) return [];
  const spriteLayout = interiorAssetSpriteLayout(assetName);
  const assetPath = bedAsset ? `lpc/${bedAsset.folder}/${assetName}`
    : upholsteredBench ? `lpc/casual_sofa/${assetName}`
      : interiorAssetPath(assetName);
  const perCell = prop.kind === "crate";
  const fittedLength = prop.kind === "hearth" || prop.kind === "cabinet" ||
    prop.kind === "tomb" || prop.kind === "altar" ||
    prop.kind === "table" && !modularTable &&
      (prop.points.length === 2 || prop.points.length === 3)
    ? prop.points.length : 0;
  const cabinetOverhang = prop.kind === "cabinet" &&
    (rectangle.height > rectangle.width || prop.facing === "south" ||
      prop.points.length === 2 && rectangle.width > rectangle.height) ? 1 : 0;
  const benchAsset = prop.kind === "bench";
  const verticalBench = false;
  const compositeAsset = modularWoodenBench || modularTable || modularCounter;
  const assetWidth = bedAsset ? bedAsset.width
    : compositeAsset ? spriteLayout.renderWidthCells * 32
    : upholsteredBench ? prop.facing === "east" || prop.facing === "west" ? 32 : 64
    : benchAsset ? 160 : fittedLength
    ? rectangle.width * 32
    : assetName.includes("2x2") || assetName.includes("2x1") ? 64 : 32;
  const assetHeight = bedAsset ? bedAsset.height
    : compositeAsset ? spriteLayout.renderHeightCells * 32
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
  const placements = perCell
    ? prop.points.map((point) => ({
      centerX: point.x + .5,
      centerY: spriteLayout.anchor === "bottom"
        ? point.y + 1 - spriteLayout.renderHeightCells / 2
        : point.y + .5,
      widthCells: spriteLayout.renderWidthCells,
      heightCells: spriteLayout.renderHeightCells,
      footprint: [point],
      assetName,
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
      widthCells: bedAsset || compositeAsset ? layoutAssetWidth / 32
        : upholsteredBench ? rectangle.width
        : benchAsset ? prop.points.length : layoutAssetWidth / 32,
      heightCells: bedAsset || compositeAsset ? layoutAssetHeight / 32
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
    publicTilesetAssetUrl(assetPath),
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
    perspectiveZIndex(
      baseZIndex,
      placement.centerY + placement.heightCells / 2,
      placement.centerX,
      tieBreaker + index,
    ),
    false,
    {
      x: (flipHorizontal ? -1 : 1) * placement.widthCells * PROP_IMAGE_DPI / layoutAssetWidth,
      y: placement.heightCells * PROP_IMAGE_DPI / layoutAssetHeight,
    },
    rotation,
    {
      "com.touchgrass/interior-prop": {
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
  url: publicTilesetAssetUrl("bailey/rock_1x1.png"),
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
    const rockDimensions = /^rock(?:_(?:light|dark|desert|snow))?_\d+_(\d+)x(\d+)\.png$/
      .exec(filename);
    const dimensions = DEFAULT_PROP_DIMENSIONS[filename] ?? (rockDimensions
      ? {
        width: Number(rockDimensions[1]) * 32,
        height: Number(rockDimensions[2]) * 32,
      }
      : undefined);
    if (!dimensions) throw new Error(`Unknown default prop asset: ${filename}`);
    const tilesetMarker = "/assets/tilesets/";
    const relativePath = defaultAssetPath.includes(tilesetMarker)
      ? defaultAssetPath.split(tilesetMarker, 2)[1]
      : filename;
    const url = publicTilesetAssetUrl(relativePath);
    return {
      url,
      mime: "image/png",
      ...dimensions,
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

async function owlBearRockAssets(
  customUrl: string | undefined,
  useTileset: boolean,
  mode: LandscapeMode | undefined,
): Promise<RockAssetSet> {
  if (customUrl?.trim() || !useTileset) {
    const assets = await owlBearPropAssets(customUrl, "rock", useTileset);
    return {
      oneByOne: [assets.oneByOne],
      oneByTwo: [],
      twoByOne: [],
      twoByTwo: [assets.twoByTwo],
      twoByThree: [],
      threeByThree: [],
      fourByThree: [],
      fourByFive: [],
      fiveByFour: [],
    };
  }
  const family = mode === "desert-canyon" || mode === "badlands"
    ? "rock_desert"
    : mode === "frozen-lake"
      ? "rock_snow"
      : mode === "underground" || mode === "sewer" || mode === "volcanic"
        ? "rock_dark"
        : mode === "coast" || mode === "archipelago"
          ? "rock_light" : "rock";
  const names = (count: number, footprint: string) =>
    Array.from({ length: count }, (_, index) => `${family}_${index + 1}_${footprint}.png`);
  const paths = {
    oneByOne: names(16, "1x1"),
    oneByTwo: names(9, "1x2"),
    twoByOne: names(3, "2x1"),
    twoByTwo: names(14, "2x2"),
    twoByThree: names(1, "2x3"),
    threeByThree: names(1, "3x3"),
    fourByThree: names(2, "4x3"),
    fourByFive: names(1, "4x5"),
    fiveByFour: names(1, "5x4"),
  };
  const load = (names: string[]) => Promise.all(names.map((name) =>
    inspectPropAsset(undefined, `/assets/tilesets/lpc/rock/${name}`)));
  const [
    oneByOne,
    oneByTwo,
    twoByOne,
    twoByTwo,
    twoByThree,
    threeByThree,
    fourByThree,
    fourByFive,
    fiveByFour,
  ] = await Promise.all([
    load(paths.oneByOne),
    load(paths.oneByTwo),
    load(paths.twoByOne),
    load(paths.twoByTwo),
    load(paths.twoByThree),
    load(paths.threeByThree),
    load(paths.fourByThree),
    load(paths.fourByFive),
    load(paths.fiveByFour),
  ]);
  return {
    oneByOne,
    oneByTwo,
    twoByOne,
    twoByTwo,
    twoByThree,
    threeByThree,
    fourByThree,
    fourByFive,
    fiveByFour,
  };
}

function rockVariantsForPlacement(
  assets: RockAssetSet,
  width: number,
  height: number,
) {
  if (width === 5 && height === 4) return assets.fiveByFour;
  if (width === 4 && height === 5) return assets.fourByFive;
  if (width === 4 && height === 3) return assets.fourByThree;
  if (width === 3 && height === 3) return assets.threeByThree;
  if (width === 2 && height === 3) return assets.twoByThree;
  if (width === 2 && height === 2) return assets.twoByTwo;
  if (width === 2 && height === 1) return assets.twoByOne;
  if (width === 1 && height === 2 && assets.oneByTwo.length) return assets.oneByTwo;
  return assets.oneByOne;
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
    owlBearRockAssets(options.rockUrl, options.useTileset ?? false, options.mode),
  ]);
  type ExportedSceneItem = (
      ReturnType<typeof imageItem> |
      ReturnType<typeof outdoorPropItem> |
      ReturnType<typeof interiorPropItem> |
      ReturnType<typeof stoolPathItem> |
      ReturnType<typeof benchPathItem> |
      ReturnType<typeof bedPathItem> |
      ReturnType<typeof hearthPathItem> |
      ReturnType<typeof statuePathItem> |
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
    "Touch Grass generated background",
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
  let propTieBreaker = 0;
  let highestPropZIndex = baseZIndex;
  collectObstacles(grid).forEach((obstacle) => {
    if (
      hiddenItems.has(obstacle.kind) ||
      obstacle.kind === Obstacle.Building
    ) return;
    if (obstacle.kind === Obstacle.Rock) {
      const sorted = [...obstacle.points].sort((a, b) => a.y - b.y || a.x - b.x);
      const largeManualRockAssets = [
        { width: 5, height: 4, variants: rockAssets.fiveByFour },
        { width: 4, height: 5, variants: rockAssets.fourByFive },
        { width: 4, height: 3, variants: rockAssets.fourByThree },
        { width: 3, height: 3, variants: rockAssets.threeByThree },
        { width: 2, height: 3, variants: rockAssets.twoByThree },
      ];
      const largeManualRockPlacement = obstacle.id < 0
        ? largeManualRockAssets
          .map((asset) => ({
            ...asset,
            origin: completeRectangleOrigin(obstacle.points, asset.width, asset.height),
          }))
          .find(({ origin, variants }) => origin && variants.length > 0)
        : undefined;
      const verticalPair = sorted.length === 2 && sorted[0].x === sorted[1].x &&
        sorted[1].y === sorted[0].y + 1;
      const horizontalPair = sorted.length === 2 && sorted[0].y === sorted[1].y &&
        sorted[1].x === sorted[0].x + 1 && rockAssets.twoByOne.length > 0;
      const placements = largeManualRockPlacement?.origin
        ? [{
          x: largeManualRockPlacement.origin.x,
          y: largeManualRockPlacement.origin.y,
          width: largeManualRockPlacement.width,
          height: largeManualRockPlacement.height,
        }]
        : verticalPair
        ? [{ x: sorted[0].x, y: sorted[0].y, width: 1, height: 2 }]
        : horizontalPair
          ? [{ x: sorted[0].x, y: sorted[0].y, width: 2, height: 1 }]
          : propPlacements(obstacle.points).map(({ x, y, size }) => ({
            x, y, width: size, height: size,
          }));
      placements.forEach(({ x, y, width, height }, pointIndex) => {
        const variants = rockVariantsForPlacement(rockAssets, width, height);
        const variant = obstacle.variant ?? Math.abs(obstacle.id + pointIndex);
        const asset = variants[variant % variants.length];
        const id = crypto.randomUUID();
        shared[id] = imageItem(
          id,
          `Rock ${obstacle.id}.${pointIndex + 1}`,
          "PROP",
          asset.url,
          asset.mime,
          asset.width,
          asset.height,
          {
            x: (x + width / 2) * OWLBEAR_SCENE_DPI,
            y: (y + height / 2) * OWLBEAR_SCENE_DPI,
          },
          PROP_IMAGE_DPI,
          { x: asset.width / 2, y: asset.height / 2 },
          nextPropZIndex,
          false,
          {
            x: width * PROP_IMAGE_DPI / asset.width,
            y: height * PROP_IMAGE_DPI / asset.height,
          },
        );
        nextPropZIndex += 1;
      });
      return;
    }
    propPlacements(obstacle.points).forEach(({ x, y, size }, pointIndex) => {
      const asset = size === 2 ? treeAssets.twoByTwo : treeAssets.oneByOne;
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
        perspectiveZIndex(baseZIndex, y + size, x + size / 2, propTieBreaker),
        false,
        {
          x: size * PROP_IMAGE_DPI / asset.width,
          y: size * PROP_IMAGE_DPI / asset.height,
        },
      );
      propTieBreaker += 1;
      highestPropZIndex = Math.max(highestPropZIndex, shared[id].zIndex);
    });
  });
  collectOutdoorProps(grid).forEach((prop) => {
    if (hiddenItems.has(prop.kind)) return;
    const id = crypto.randomUUID();
    shared[id] = outdoorPropItem(id, prop, baseZIndex, propTieBreaker);
    highestPropZIndex = Math.max(highestPropZIndex, shared[id].zIndex);
    propTieBreaker += 1;
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
      ? interiorPropSpriteItems(
        prop,
        baseZIndex,
        options.mode,
        lightSource,
        propTieBreaker,
      ) : [];
    if (sprites.length) {
      sprites.forEach((item) => {
        shared[item.id] = item;
        highestPropZIndex = Math.max(highestPropZIndex, item.zIndex);
      });
      propTieBreaker += sprites.length;
    } else {
      const id = crypto.randomUUID();
      if (prop.kind === "chair") {
        shared[id] = stoolPathItem(
          id,
          prop,
          baseZIndex,
          lightSource,
          propTieBreaker,
        );
      } else if (prop.kind === "bench") {
        shared[id] = benchPathItem(
          id,
          prop,
          baseZIndex,
          lightSource,
          propTieBreaker,
        );
      } else if (prop.kind === "bed") {
        shared[id] = bedPathItem(
          id,
          prop,
          baseZIndex,
          lightSource,
          propTieBreaker,
        );
      } else if (prop.kind === "hearth") {
        shared[id] = hearthPathItem(
          id,
          prop,
          baseZIndex,
          lightSource,
          propTieBreaker,
        );
      } else if (prop.kind === "statue") {
        shared[id] = statuePathItem(
          id,
          prop,
          baseZIndex,
          lightSource,
          propTieBreaker,
        );
      } else {
        shared[id] = interiorPropItem(
          id,
          prop,
          baseZIndex,
          lightSource,
          propTieBreaker,
        );
      }
      highestPropZIndex = Math.max(highestPropZIndex, shared[id].zIndex);
      propTieBreaker += 1;
    }
  });
  nextPropZIndex = highestPropZIndex + 1;

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
      for (const door of doorFogRuns(grid)) {
        const id = crypto.randomUUID();
        shared[id] = fogDoorItem(
          id,
          door.x,
          door.y,
          door.orientation,
          nextPropZIndex,
          door.length,
        );
        nextPropZIndex += 1;
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
      .filter((source) => !hiddenItems.has(source.kind))
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
    if (item.attachedTo) continue;
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
      `touchgrass-${safeSeed(seed)}-${grid[0].length}x${grid.length}-owlbear.json`,
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
