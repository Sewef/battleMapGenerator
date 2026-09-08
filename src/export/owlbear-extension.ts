import OBR, { type BoundingBox, type Item } from "@owlbear-rodeo/sdk";
import type { OwlbearSceneExport } from "./owlbear";

type OwlbearScenePayload = {
  items?: {
    shared?: Record<string, Item>;
  };
  bounds?: Partial<BoundingBox>;
};

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
