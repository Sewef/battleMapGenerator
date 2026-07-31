import { MapStorageCoordinator } from "./map-storage";
import {
  MAP_IMAGE_COLLECTION_PATH,
  MAP_IMAGE_PREFIX,
  MAP_IMAGE_RETENTION_MS,
  MAX_MAP_IMAGE_BYTES,
  MAX_MAP_IMAGE_DIMENSION,
  MAX_MAP_IMAGE_PIXELS,
} from "./map-settings";

export { MapStorageCoordinator };

type ImageDimensions = { width: number; height: number };

function storageCoordinator(env: Env) {
  return env.MAP_STORAGE_COORDINATOR.getByName("global-map-storage");
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Cross-Origin-Resource-Policy": "cross-origin",
    "X-Content-Type-Options": "nosniff",
  };
}

function errorResponse(message: string, status: number, headers?: HeadersInit) {
  return new Response(message, {
    status,
    headers: {
      ...corsHeaders(),
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
      ...headers,
    },
  });
}

function fourCc(data: Uint8Array, offset: number) {
  return String.fromCharCode(...data.subarray(offset, offset + 4));
}

function readUint24(view: DataView, offset: number) {
  return view.getUint8(offset) |
    (view.getUint8(offset + 1) << 8) |
    (view.getUint8(offset + 2) << 16);
}

function validDimensions(width: number, height: number): ImageDimensions | undefined {
  if (
    width < 1 ||
    height < 1 ||
    width > MAX_MAP_IMAGE_DIMENSION ||
    height > MAX_MAP_IMAGE_DIMENSION ||
    width * height > MAX_MAP_IMAGE_PIXELS
  ) return undefined;
  return { width, height };
}

function parseWebpDimensions(bytes: ArrayBuffer): ImageDimensions | undefined {
  const data = new Uint8Array(bytes);
  if (data.length < 30 || fourCc(data, 0) !== "RIFF" || fourCc(data, 8) !== "WEBP") {
    return undefined;
  }
  const view = new DataView(bytes);
  if (view.getUint32(4, true) + 8 > data.length) return undefined;

  let offset = 12;
  while (offset + 8 <= data.length) {
    const kind = fourCc(data, offset);
    const size = view.getUint32(offset + 4, true);
    const payload = offset + 8;
    if (payload + size > data.length) return undefined;
    if (kind === "VP8X" && size >= 10) {
      return validDimensions(
        readUint24(view, payload + 4) + 1,
        readUint24(view, payload + 7) + 1,
      );
    }
    if (kind === "VP8L" && size >= 5 && data[payload] === 0x2f) {
      const bits = view.getUint32(payload + 1, true);
      return validDimensions(
        (bits & 0x3fff) + 1,
        ((bits >>> 14) & 0x3fff) + 1,
      );
    }
    if (
      kind === "VP8 " &&
      size >= 10 &&
      data[payload + 3] === 0x9d &&
      data[payload + 4] === 0x01 &&
      data[payload + 5] === 0x2a
    ) {
      return validDimensions(
        view.getUint16(payload + 6, true) & 0x3fff,
        view.getUint16(payload + 8, true) & 0x3fff,
      );
    }
    offset = payload + size + (size & 1);
  }
  return undefined;
}

async function sha256Hex(bytes: ArrayBuffer) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readBodyWithLimit(request: Request, maximumBytes: number) {
  if (!request.body) return new ArrayBuffer(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximumBytes) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

function objectExpired(object: R2Object) {
  const expiresAt = Number(object.customMetadata?.expiresAt);
  return !Number.isFinite(expiresAt) || expiresAt <= Date.now();
}

function storedImageHeaders(object: R2Object) {
  return new Headers({
    ...corsHeaders(),
    "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
    "Content-Length": object.size.toString(),
    "Content-Type": "image/webp",
    ETag: object.httpEtag,
  });
}

async function uploadMapImage(request: Request, env: Env) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        ...corsHeaders(),
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Max-Age": "86400",
      },
    });
  }
  if (request.method !== "POST") {
    return errorResponse("Method not allowed.", 405, { Allow: "POST, OPTIONS" });
  }
  if (request.headers.get("Content-Type")?.split(";", 1)[0] !== "image/webp") {
    return errorResponse("Only WebP map images are accepted.", 415);
  }
  const declaredSize = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declaredSize) && declaredSize > MAX_MAP_IMAGE_BYTES) {
    return errorResponse("The WebP is larger than 8 MiB.", 413);
  }

  const rateLimit = await env.MAP_IMAGE_UPLOAD_RATE_LIMITER.limit({
    key: request.headers.get("CF-Connecting-IP") ?? "local",
  });
  if (!rateLimit.success) {
    return errorResponse("Too many map uploads. Try again shortly.", 429, {
      "Retry-After": "60",
    });
  }

  const bytes = await readBodyWithLimit(request, MAX_MAP_IMAGE_BYTES);
  if (!bytes?.byteLength) {
    return errorResponse("The WebP is empty or larger than 8 MiB.", 413);
  }
  const dimensions = parseWebpDimensions(bytes);
  if (!dimensions) {
    return errorResponse("The uploaded file is not a supported WebP map image.", 400);
  }

  const hash = await sha256Hex(bytes);
  const key = `${MAP_IMAGE_PREFIX}${hash}.webp`;
  await storageCoordinator(env).storeImage({
    key,
    bytes,
    ...dimensions,
    expiresAt: Date.now() + MAP_IMAGE_RETENTION_MS,
  });

  const imageUrl = new URL(`${MAP_IMAGE_COLLECTION_PATH}/${hash}.webp`, request.url);
  return Response.json(
    { url: imageUrl.href, mime: "image/webp", ...dimensions },
    { headers: { ...corsHeaders(), "Cache-Control": "no-store" } },
  );
}

async function getMapImage(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  hash: string,
) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return errorResponse("Method not allowed.", 405, { Allow: "GET, HEAD" });
  }
  const key = `${MAP_IMAGE_PREFIX}${hash}.webp`;
  if (request.method === "HEAD") {
    const object = await env.MAP_IMAGES.head(key);
    if (!object) return errorResponse("Map image not found.", 404);
    if (objectExpired(object)) {
      ctx.waitUntil(storageCoordinator(env).deleteImage(key));
      return errorResponse("This temporary map image has expired.", 410);
    }
    return new Response(null, { headers: storedImageHeaders(object) });
  }
  const object = await env.MAP_IMAGES.get(key);
  if (!object) return errorResponse("Map image not found.", 404);
  if (objectExpired(object)) {
    ctx.waitUntil(storageCoordinator(env).deleteImage(key));
    return errorResponse("This temporary map image has expired.", 410);
  }
  return new Response(object.body, { headers: storedImageHeaders(object) });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === MAP_IMAGE_COLLECTION_PATH) {
      try {
        return await uploadMapImage(request, env);
      } catch (error) {
        console.error("Map image upload failed", error);
        return errorResponse("The map image could not be uploaded.", 500);
      }
    }
    const match = url.pathname.match(/^\/api\/map-images\/([a-f0-9]{64})\.webp$/);
    if (match) {
      try {
        return await getMapImage(request, env, ctx, match[1]);
      } catch (error) {
        console.error("Map image retrieval failed", error);
        return errorResponse("The map image could not be retrieved.", 500);
      }
    }
    return env.ASSETS.fetch(request);
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(storageCoordinator(env).removeExpiredImages(Date.now()));
  },
} satisfies ExportedHandler<Env>;
