import {
  Obstacle,
  Terrain,
  type Grid,
  type ObstacleKind,
  type TerrainKind,
} from "../domain/map";
import type { UploadedMapImage } from "./map-image";

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
) {
  return {
    type: "IMAGE",
    id,
    name,
    position,
    rotation: 0,
    scale,
    visible: true,
    locked,
    zIndex,
    metadata: {
      "com.terra-map-generator/export": true,
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

function fogContours(
  grid: Grid,
  matches: (x: number, y: number) => boolean,
  includeMapBoundary = true,
): FogPoint[][] {
  const edges: FogEdge[] = [];
  const addEdge = (start: FogPoint, end: FogPoint, direction: number) => {
    edges.push({ start, end, direction });
  };
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      if (!matches(x, y)) continue;
      if ((includeMapBoundary || y > 0) && !matches(x, y - 1)) {
        addEdge({ x, y }, { x: x + 1, y }, 0);
      }
      if (
        (includeMapBoundary || x < grid[y].length - 1) &&
        !matches(x + 1, y)
      ) {
        addEdge({ x: x + 1, y }, { x: x + 1, y: y + 1 }, 1);
      }
      if (
        (includeMapBoundary || y < grid.length - 1) &&
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
  const rooms = new Map<
    number,
    { minimumX: number; minimumY: number; maximumX: number; maximumY: number }
  >();
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      const roomId = grid[y][x].roomId;
      if (roomId === undefined) continue;
      const bounds = rooms.get(roomId) ?? {
        minimumX: x,
        minimumY: y,
        maximumX: x,
        maximumY: y,
      };
      bounds.minimumX = Math.min(bounds.minimumX, x);
      bounds.minimumY = Math.min(bounds.minimumY, y);
      bounds.maximumX = Math.max(bounds.maximumX, x);
      bounds.maximumY = Math.max(bounds.maximumY, y);
      rooms.set(roomId, bounds);
    }
  }
  return [...rooms.entries()]
    .sort(([first], [second]) => first - second)
    .map(([roomId, bounds]) => ({
      roomId,
      contour: [
        { x: bounds.minimumX - .5, y: bounds.minimumY - .5 },
        { x: bounds.maximumX + 1.5, y: bounds.minimumY - .5 },
        { x: bounds.maximumX + 1.5, y: bounds.maximumY + 1.5 },
        { x: bounds.minimumX - .5, y: bounds.maximumY + 1.5 },
      ],
    }));
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
    const url = new URL(filename, PUBLIC_TILESET_ASSET_BASE).href;
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
      inspectPropAsset(undefined, `/assets/tilesets/${kind}_1x1.png`),
      inspectPropAsset(undefined, `/assets/tilesets/${kind}_2x2.png`),
    ]);
    return { oneByOne, twoByTwo };
  }
  const fallback = await inspectPropAsset(
    undefined,
    `/assets/tilesets/${kind}.png`,
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
      ReturnType<typeof fogItem> |
      ReturnType<typeof fogDoorItem>
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
      rooms.forEach(({ roomId, contour }) => {
        const id = crypto.randomUUID();
        shared[id] = fogItem(
          id,
          `Room ${roomId + 1} Fog`,
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
