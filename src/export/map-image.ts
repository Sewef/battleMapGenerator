import { encodeWebp } from "./webp";

const MAP_IMAGE_COLLECTION_PATH = "/api/map-images";

export interface UploadedMapImage {
  url: string;
  mime: "image/webp";
  width: number;
  height: number;
}

function uploadError(response: Response, detail: string) {
  return new Error(
    detail
      ? `The map image upload failed (${response.status}): ${detail}`
      : `The map image upload failed (${response.status}).`,
  );
}

export async function uploadMapCanvas(
  canvas: HTMLCanvasElement,
): Promise<UploadedMapImage> {
  const webp = await encodeWebp(canvas);
  const response = await fetch(MAP_IMAGE_COLLECTION_PATH, {
    method: "POST",
    headers: { "Content-Type": "image/webp" },
    body: webp,
  });
  if (!response.ok) {
    const detail = (await response.text()).trim().slice(0, 240);
    throw uploadError(response, detail);
  }

  const result = await response.json() as Partial<UploadedMapImage>;
  if (
    result.mime !== "image/webp" ||
    result.width !== canvas.width ||
    result.height !== canvas.height ||
    typeof result.url !== "string"
  ) {
    throw new Error("The map image host returned an invalid response.");
  }
  const url = new URL(result.url, window.location.origin);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("The map image host returned an invalid URL.");
  }
  return {
    url: url.href,
    mime: result.mime,
    width: result.width,
    height: result.height,
  };
}
