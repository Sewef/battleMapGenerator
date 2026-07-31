import {
  Obstacle,
  type Grid,
  type ObstacleKind,
} from "../domain/map";

const OWLBEAR_SCENE_DPI = 150;
const MAP_IMAGE_DPI = 64;
const PROP_IMAGE_DPI = 512;
const DEFAULT_MAP_URL =
  "https://cdn.jsdelivr.net/gh/Sewef/battleMapGenerator@main/public/assets/tilesets/default.webp";
const PUBLIC_TILESET_ASSET_BASE =
  "https://cdn.jsdelivr.net/gh/Sewef/battleMapGenerator@main/public/assets/tilesets/";

type ExportedObstacle = {
  kind: Exclude<ObstacleKind, "none">;
  id: number;
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

export interface OwlbearExportOptions {
  useTileset?: boolean;
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
      obstacles.set(key, { kind: tile.obstacle, id });
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
    const url = new URL(filename, PUBLIC_TILESET_ASSET_BASE).href;
    const dimensions = await imageDimensions(url);
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
  options: OwlbearExportOptions = {},
): Promise<OwlbearSceneExport> {
  if (!grid.length) throw new Error("Generate a map before exporting.");
  const [treeAssets, rockAssets] = await Promise.all([
    owlBearPropAssets(options.treeUrl, "tree", options.useTileset ?? false),
    owlBearPropAssets(options.rockUrl, "rock", options.useTileset ?? false),
  ]);
  const shared: Record<string, ReturnType<typeof imageItem>> = {};
  const baseZIndex = Date.now();
  const mapId = crypto.randomUUID();
  const mapWidth = grid[0].length * MAP_IMAGE_DPI;
  const mapHeight = grid.length * MAP_IMAGE_DPI;
  shared[mapId] = imageItem(
    mapId,
    "Replace with uploaded Terra map",
    "MAP",
    DEFAULT_MAP_URL,
    "image/webp",
    mapWidth,
    mapHeight,
    { x: 0, y: 0 },
    MAP_IMAGE_DPI,
    { x: 0, y: 0 },
    baseZIndex,
    true,
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
    const points = grid.flatMap((row, y) =>
      row.map((tile, x) => ({ tile, x, y }))
        .filter(({ tile }) =>
          tile.obstacle === obstacle.kind
        ),
    ).filter(({ tile, x, y }) =>
      (tile.obstacleId ?? y * grid[y].length + x) === obstacle.id
    );
    if (!points.length) return;
    const assets = obstacle.kind === Obstacle.Tree ? treeAssets : rockAssets;
    propPlacements(points).forEach(({ x, y, size }, pointIndex) => {
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

  const width = grid[0].length * OWLBEAR_SCENE_DPI;
  const height = grid.length * OWLBEAR_SCENE_DPI;
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
  URL.revokeObjectURL(url);
}
