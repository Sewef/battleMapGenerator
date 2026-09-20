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

const BATTLE_SYSTEM_SMOKE_METADATA_PREFIX = "com.battle-system.smoke";

type SmokeCurve = Item & {
  type: "CURVE";
  points: Array<{ x: number; y: number }>;
  style: { strokeWidth: number };
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

export function isBattleSystemSmokeCurve(item: Item): item is SmokeCurve {
  return item.type === "CURVE" && Object.keys(item.metadata ?? {})
    .some((key) => key.startsWith(BATTLE_SYSTEM_SMOKE_METADATA_PREFIX));
}

function boundsOverlap(first: BoundingBox, second: BoundingBox) {
  return Math.min(first.max.x, second.max.x) >= Math.max(first.min.x, second.min.x) &&
    Math.min(first.max.y, second.max.y) >= Math.max(first.min.y, second.min.y);
}

function smokeCurveBounds(item: SmokeCurve): BoundingBox | undefined {
  if (!item.points.length) return undefined;
  const radians = item.rotation * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const points = item.points.map((point) => {
    const scaledX = point.x * item.scale.x;
    const scaledY = point.y * item.scale.y;
    return {
      x: item.position.x + scaledX * cosine - scaledY * sine,
      y: item.position.y + scaledX * sine + scaledY * cosine,
    };
  });
  const padding = item.style.strokeWidth *
    Math.max(Math.abs(item.scale.x), Math.abs(item.scale.y)) / 2;
  const minX = Math.min(...points.map(({ x }) => x)) - padding;
  const minY = Math.min(...points.map(({ y }) => y)) - padding;
  const maxX = Math.max(...points.map(({ x }) => x)) + padding;
  const maxY = Math.max(...points.map(({ y }) => y)) + padding;
  const width = maxX - minX;
  const height = maxY - minY;
  return {
    min: { x: minX, y: minY },
    max: { x: maxX, y: maxY },
    width,
    height,
    center: { x: minX + width / 2, y: minY + height / 2 },
  };
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
  const [items, localItems] = await Promise.all([
    OBR.scene.items.getItems(),
    OBR.scene.local.getItems(),
  ]);
  const mapItems = items.filter((item) =>
    touchGrassItemMetadata(item)?.mapId === mapId
  );
  const ids = mapItems.map(({ id }) => id);
  const localIds: string[] = [];
  if (!ids.length) return 0;

  const background = mapItems.find((item) =>
    touchGrassItemMetadata(item)?.role === "map"
  );
  if (background) {
    try {
      const mapBounds = await OBR.scene.items.getItemBounds([background.id]);
      const findOverlappingSmokeIds = async (
        candidates: SmokeCurve[],
      ) => (await Promise.all(candidates.map(async (item) => {
        try {
          const smokeBounds = smokeCurveBounds(item);
          if (!smokeBounds) return undefined;
          return boundsOverlap(mapBounds, smokeBounds) ? item.id : undefined;
        } catch (error) {
          console.warn("[owlbear] Unable to inspect smoke curve bounds", {
            itemId: item.id,
            error,
          });
          return undefined;
        }
      }))).filter((id): id is string => Boolean(id));

      const [sharedSmokeIds, localSmokeIds] = await Promise.all([
        findOverlappingSmokeIds(
          items
            .filter(isBattleSystemSmokeCurve)
            .filter((item) => !ids.includes(item.id)),
        ),
        findOverlappingSmokeIds(
          localItems.filter(isBattleSystemSmokeCurve),
        ),
      ]);
      ids.push(...sharedSmokeIds);
      localIds.push(...localSmokeIds);
    } catch (error) {
      // Map deletion remains available even when an unrelated extension item
      // has invalid geometry or Owlbear cannot calculate its current bounds.
      console.warn("[owlbear] Unable to inspect map bounds for smoke cleanup", {
        mapId,
        error,
      });
    }
  }
  await Promise.all([
    OBR.scene.items.deleteItems(ids),
    localIds.length
      ? OBR.scene.local.deleteItems(localIds)
      : Promise.resolve(),
  ]);
  const deletedItemCount = ids.length + localIds.length;
  try {
    await OBR.notification.show(
      `Touch Grass map removed (${deletedItemCount} items).`,
      "SUCCESS",
    );
  } catch (error) {
    console.warn("[owlbear] Map was removed, but notification failed", error);
  }
  return deletedItemCount;
}

export function onTouchGrassSceneMapsChange(
  callback: (maps: TouchGrassSceneMap[]) => void,
) {
  return OBR.scene.items.onChange((items) => {
    callback(touchGrassSceneMapsFromItems(items));
  });
}
