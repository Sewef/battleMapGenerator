const LITTERBOX_PROXY_URL = "/api/litterbox";
const LITTERBOX_FILE_URL = /^https:\/\/litter\.catbox\.moe\/[a-z0-9._-]+$/i;
const IMAGE_CHECK_TIMEOUT_MS = 12_000;

function canvasToWebp(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob?.size) resolve(blob);
      else reject(new Error("Unable to encode the map as WebP."));
    }, "image/webp", .95);
  });
}

function canDecodeRemoteImage(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const image = new Image();
    let finished = false;
    const finish = (valid: boolean) => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
      resolve(valid);
    };
    const timeout = window.setTimeout(() => finish(false), IMAGE_CHECK_TIMEOUT_MS);
    image.onload = () => finish(image.naturalWidth > 0 && image.naturalHeight > 0);
    image.onerror = () => finish(false);
    image.src = `${url}?terra-check=${crypto.randomUUID()}`;
  });
}

export async function uploadCanvasToLitterbox(
  canvas: HTMLCanvasElement,
  filename = "terra-map.webp",
): Promise<string> {
  const image = await canvasToWebp(canvas);
  const body = new FormData();
  body.append("reqtype", "fileupload");
  body.append("time", "72h");
  body.append("fileToUpload", image, filename);

  let response: Response;
  try {
    response = await fetch(LITTERBOX_PROXY_URL, { method: "POST", body });
  } catch (error) {
    throw new Error(error instanceof Error
      ? `Unable to reach Litterbox: ${error.message}`
      : "Unable to reach Litterbox.");
  }

  const result = (await response.text()).trim();
  if (!response.ok || !LITTERBOX_FILE_URL.test(result)) {
    throw new Error(result
      ? `Litterbox replied: ${result.slice(0, 180)}`
      : `Litterbox returned an empty response (HTTP ${response.status}).`);
  }
  if (!await canDecodeRemoteImage(result)) {
    throw new Error("Litterbox returned an image that cannot be read.");
  }
  return result;
}
