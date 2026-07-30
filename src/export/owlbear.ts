import {
  Obstacle,
  type Grid,
  type LandscapeMode,
  type ObstacleKind,
} from "../domain/map";
import { renderExportCanvas } from "./webp";

const OWLBEAR_SCENE_DPI = 150;
const MAP_IMAGE_DPI = 64;
const PROP_IMAGE_DPI = 512;
const EXPORT_USER_ID = "terra-map-generator";

type ExportedObstacle = {
  kind: Exclude<ObstacleKind, "none">;
  id: number;
};

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
  const modified = new Date().toISOString();
  return {
    type: "IMAGE",
    id,
    name,
    position,
    rotation: 0,
    scale,
    visible: true,
    locked,
    // createdUserId: EXPORT_USER_ID,
    zIndex,
    // lastModified: modified,
    // lastModifiedUserId: EXPORT_USER_ID,
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

export function downloadOwlbearScene(
  grid: Grid,
  mode: LandscapeMode,
  seed: string,
  hiddenItems: ReadonlySet<string>,
  showGrid: boolean,
  useTileset: boolean,
  tilesetImage?: CanvasImageSource,
) {
  if (!grid.length) return;
  const mapHiddenItems = new Set(hiddenItems);
  mapHiddenItems.add(Obstacle.Tree);
  mapHiddenItems.add(Obstacle.Rock);
  const mapCanvas = renderExportCanvas(
    grid,
    mode,
    MAP_IMAGE_DPI,
    mapHiddenItems,
    showGrid,
    useTileset,
    tilesetImage,
  );

  const shared: Record<string, ReturnType<typeof imageItem>> = {};
  const baseZIndex = Date.now();
  const mapId = crypto.randomUUID();
  shared[mapId] = imageItem(
    mapId,
    `Terra ${safeSeed(seed)}`,
    "MAP",
    mapCanvas.toDataURL("image/webp", .95),
    "image/webp",
    mapCanvas.width,
    mapCanvas.height,
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
  collectObstacles(grid).forEach((obstacle, index) => {
    if (
      hiddenItems.has(obstacle.kind) ||
      obstacle.kind === Obstacle.Building
    ) return;
    const points = grid.flatMap((row, y) =>
      row.map((tile, x) => ({ tile, x, y }))
        .filter(({ tile }) =>
          tile.obstacle === obstacle.kind &&
          tile.obstacleId === obstacle.id
        ),
    );
    if (!points.length) return;
    const minimumX = Math.min(...points.map(({ x }) => x));
    const maximumX = Math.max(...points.map(({ x }) => x));
    const minimumY = Math.min(...points.map(({ y }) => y));
    const maximumY = Math.max(...points.map(({ y }) => y));
    const spanX = maximumX - minimumX + 1;
    const spanY = maximumY - minimumY + 1;
    const assetName = obstacle.kind === Obstacle.Tree ? "tree.png" : "rock.png";
    const id = crypto.randomUUID();
    shared[id] = imageItem(
      id,
      `${obstacleNames[obstacle.kind]} ${obstacle.id}`,
      "PROP",
      new URL(`/assets/${assetName}`, window.location.origin).href,
      "image/png",
      512,
      512,
      {
        x: (minimumX + spanX / 2) * OWLBEAR_SCENE_DPI,
        y: (minimumY + spanY / 2) * OWLBEAR_SCENE_DPI,
      },
      PROP_IMAGE_DPI,
      { x: 256, y: 256 },
      baseZIndex + index + 1,
      false,
      { x: spanX, y: spanY },
    );
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
  const blob = new Blob([JSON.stringify(scene)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.download = `terra-${safeSeed(seed)}-${grid[0].length}x${grid.length}-owlbear.json`;
  link.href = url;
  link.click();
  URL.revokeObjectURL(url);
}
