import {
  canonicalGeneratedMapUrl,
  GENERATED_MAP_PATH,
  GeneratedMapRequestError,
  parseGeneratedMapRequest,
} from "../src/export/map-request";
import { renderMapSvg } from "../src/rendering/svg";
import { Obstacle } from "../src/domain/map";
import { generateTerrain } from "../src/generation/generate";

const DEFAULT_TILE_PATH = "/assets/tilesets/default.png";
const TERRAIN_TILESET_PATH = "/assets/tilesets/terrain.png";

function errorResponse(
  message: string,
  status: number,
  additionalHeaders?: HeadersInit,
) {
  return new Response(message, {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      ...additionalHeaders,
    },
  });
}

function imageHeaders() {
  return new Headers({
    "Access-Control-Allow-Origin": "*",
    "Cache-Control":
      "public, max-age=31536000, stale-while-revalidate=86400, immutable",
    "Content-Type": "image/webp",
    "Cross-Origin-Resource-Policy": "cross-origin",
    "X-Content-Type-Options": "nosniff",
  });
}

function bytesToDataUrl(bytes: ArrayBuffer, mime: string) {
  const data = new Uint8Array(bytes);
  let binary = "";
  const chunkSize = 8192;
  for (let offset = 0; offset < data.length; offset += chunkSize) {
    binary += String.fromCharCode(...data.subarray(offset, offset + chunkSize));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

async function assetResponse(request: Request, env: Env, path: string) {
  const assetUrl = new URL(path, request.url);
  const response = await env.ASSETS.fetch(
    new Request(assetUrl, { method: "GET" }),
  );
  const contentType = response.headers.get("Content-Type")
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (!response.ok || !response.body || contentType !== "image/png") {
    throw new Error(`Missing render asset: ${path}`);
  }
  return response;
}

async function generatedMap(request: Request, env: Env) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=86400",
      },
    });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return errorResponse("Method not allowed.", 405, {
      Allow: "GET, HEAD, OPTIONS",
    });
  }

  try {
    const requestUrl = new URL(request.url);
    const parsed = parseGeneratedMapRequest(requestUrl);
    const canonicalUrl = canonicalGeneratedMapUrl(requestUrl.origin, parsed);
    if (requestUrl.href !== canonicalUrl) {
      return new Response(null, {
        status: 308,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=86400",
          Location: canonicalUrl,
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    const width = parsed.options.width * parsed.renderOptions.cellSize;
    const height = parsed.options.height * parsed.renderOptions.cellSize;
    if (request.method === "HEAD") {
      return new Response(null, { headers: imageHeaders() });
    }

    const rateLimit = await env.GENERATED_MAP_RATE_LIMITER.limit({
      key: "generated-map",
    });
    if (!rateLimit.success) {
      return errorResponse("Too many new backgrounds. Try again shortly.", 429, {
        "Retry-After": "60",
      });
    }

    const basePromise = assetResponse(request, env, DEFAULT_TILE_PATH);
    const tilesetPromise = parsed.renderOptions.useTileset
      ? assetResponse(request, env, TERRAIN_TILESET_PATH)
      : undefined;
    const grid = generateTerrain(parsed.options);
    const hiddenItems = new Set(parsed.renderOptions.hiddenItems);
    hiddenItems.add(Obstacle.Tree);
    hiddenItems.add(Obstacle.Rock);
    const tileset = await tilesetPromise;
    const tilesetHref = tileset
      ? bytesToDataUrl(await tileset.arrayBuffer(), "image/png")
      : undefined;
    const svg = renderMapSvg(grid, parsed.options.mode, {
      cellSize: parsed.renderOptions.cellSize,
      useTileset: parsed.renderOptions.useTileset,
      tilesetHref,
      stylizedLighting: parsed.renderOptions.stylizedLighting,
      showGrid: parsed.renderOptions.showGrid,
      hiddenItems,
      hiddenOpacity: 0,
    });

    const base = await basePromise;
    if (!base.body) throw new Error("Missing render base body.");
    const svgBody = new Response(
      `<?xml version="1.0" encoding="UTF-8"?>${svg}`,
      { headers: { "Content-Type": "image/svg+xml; charset=utf-8" } },
    ).body;
    if (!svgBody) throw new Error("Unable to create the SVG render stream.");
    const overlay = env.IMAGES.input(svgBody);
    const result = await env.IMAGES
      .input(base.body)
      .transform({
        width,
        height,
        fit: "pad",
        background: "#f3f0e5",
      })
      .draw(overlay, { top: 0, left: 0, composite: "over" })
      .output({ format: "image/webp", quality: 92, anim: false });
    const image = result.response();
    if (
      !image.ok ||
      image.headers.get("Content-Type")?.split(";", 1)[0] !== "image/webp"
    ) {
      throw new Error(`Images returned an invalid response (${image.status}).`);
    }
    const headers = new Headers(image.headers);
    for (const [name, value] of imageHeaders()) {
      headers.set(name, value);
    }
    return new Response(image.body, { status: image.status, headers });
  } catch (error) {
    if (error instanceof GeneratedMapRequestError) {
      return errorResponse(error.message, 400);
    }
    console.error("Generated map failed", error);
    return errorResponse("The generated map could not be rendered.", 500);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === GENERATED_MAP_PATH) {
      return generatedMap(request, env);
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
