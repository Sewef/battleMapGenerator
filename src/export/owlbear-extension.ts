import OBR, { type BoundingBox, type Item } from "@owlbear-rodeo/sdk";
import {
  TOUCH_GRASS_METADATA_KEY,
  type OwlbearSceneExport,
  type TouchGrassItemMetadata,
} from "./owlbear";

type OwlbearScenePayload = {
  items?: {
    shared?: Record<string, Item>;
  };
  bounds?: Partial<BoundingBox>;
};

export type TouchGrassSceneMap = {
  mapId: string;
  seed: string;
  mode?: string;
  width: number;
  height: number;
  exportedAt: string;
  itemCount: number;
  hasBackground: boolean;
};

function touchGrassItemMetadata(item: Item): TouchGrassItemMetadata | undefined {
  const value = item.metadata?.[TOUCH_GRASS_METADATA_KEY];
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const metadata = value as Partial<TouchGrassItemMetadata>;
  if (
    metadata.schemaVersion !== 1 ||
    typeof metadata.mapId !== "string" || !metadata.mapId ||
    typeof metadata.seed !== "string" ||
    typeof metadata.width !== "number" ||
    typeof metadata.height !== "number" ||
    typeof metadata.exportedAt !== "string" ||
    (metadata.role !== "map" && metadata.role !== "prop" && metadata.role !== "support")
  ) return undefined;
  return metadata as TouchGrassItemMetadata;
}

export function touchGrassSceneMapsFromItems(items: Item[]): TouchGrassSceneMap[] {
  const groups = new Map<string, TouchGrassSceneMap>();
  for (const item of items) {
    const metadata = touchGrassItemMetadata(item);
    if (!metadata) continue;
    const existing = groups.get(metadata.mapId);
    if (existing) {
      existing.itemCount += 1;
      existing.hasBackground ||= metadata.role === "map";
      continue;
    }
    groups.set(metadata.mapId, {
      mapId: metadata.mapId,
      seed: metadata.seed,
      mode: metadata.mode,
      width: metadata.width,
      height: metadata.height,
      exportedAt: metadata.exportedAt,
      itemCount: 1,
      hasBackground: metadata.role === "map",
    });
  }
  return [...groups.values()].sort((first, second) =>
    second.exportedAt.localeCompare(first.exportedAt) ||
    first.seed.localeCompare(second.seed)
  );
}

function parseSceneItems(scene: OwlbearSceneExport) {
  const parsed = JSON.parse(scene.json) as OwlbearScenePayload;
  const items = Object.values(parsed.items?.shared ?? {});
  if (!items.length) throw new Error("The Owlbear export contains no scene items.");
  return { items, bounds: parsed.bounds };
}

function sdkReadyBounds(bounds: Partial<BoundingBox> | undefined) {
  if (!bounds?.min || !bounds.max) return undefined;
  const width = bounds.width ?? bounds.max.x - bounds.min.x;
  const height = bounds.height ?? bounds.max.y - bounds.min.y;
  return {
    min: bounds.min,
    max: bounds.max,
    width,
    height,
    center: bounds.center ?? {
      x: bounds.min.x + width / 2,
      y: bounds.min.y + height / 2,
    },
  };
}

function sdkReadyItems(items: Item[]) {
  const userId = OBR.player.id;
  const now = new Date().toISOString();
  return items.map((item) => ({
    ...item,
    createdUserId: userId,
    lastModified: now,
    lastModifiedUserId: userId,
  }));
}

export function isOwlbearExtensionAvailable() {
  return OBR.isAvailable;
}

export async function waitForOwlbearExtension() {
  if (!OBR.isAvailable) {
    throw new Error("Open this tool from the Owlbear extension to import directly.");
  }
  if (!OBR.isReady) {
    await new Promise<void>((resolve) => OBR.onReady(resolve));
  }
  if (!(await OBR.scene.isReady())) {
    throw new Error("Open an Owlbear scene before importing the map.");
  }
}

export async function addOwlbearSceneExport(scene: OwlbearSceneExport) {
  await waitForOwlbearExtension();
  const { items, bounds } = parseSceneItems(scene);
  const sceneItems = sdkReadyItems(items);
  await OBR.scene.items.addItems(sceneItems);
  try {
    await OBR.player.select(sceneItems.map(({ id }) => id), true);
  } catch (error) {
    console.warn("[owlbear] Map items were added, but selection failed", error);
  }
  const viewportBounds = sdkReadyBounds(bounds);
  if (viewportBounds) {
    try {
      await OBR.viewport.animateToBounds(viewportBounds);
    } catch (error) {
      console.warn("[owlbear] Map items were added, but viewport framing failed", error);
    }
  }
  try {
    await OBR.notification.show("Map added to the Owlbear scene.", "SUCCESS");
  } catch (error) {
    console.warn("[owlbear] Map items were added, but notification failed", error);
  }
  return items.length;
}

export async function listTouchGrassSceneMaps() {
  await waitForOwlbearExtension();
  return touchGrassSceneMapsFromItems(await OBR.scene.items.getItems());
}

export async function deleteTouchGrassSceneMap(mapId: string) {
  await waitForOwlbearExtension();
  const items = await OBR.scene.items.getItems();
  const ids = items.flatMap((item) =>
    touchGrassItemMetadata(item)?.mapId === mapId ? [item.id] : []
  );
  if (!ids.length) return 0;
  await OBR.scene.items.deleteItems(ids);
  try {
    await OBR.notification.show(
      `Touch Grass map removed (${ids.length} items).`,
      "SUCCESS",
    );
  } catch (error) {
    console.warn("[owlbear] Map was removed, but notification failed", error);
  }
  return ids.length;
}

export function onTouchGrassSceneMapsChange(
  callback: (maps: TouchGrassSceneMap[]) => void,
) {
  return OBR.scene.items.onChange((items) => {
    callback(touchGrassSceneMapsFromItems(items));
  });
}
