import {
  Obstacle,
  Terrain,
  type LandscapeMode,
  type ObstacleKind,
  type TerrainKind,
  type TerrainOptions,
} from "../domain/map";

export const GENERATED_MAP_PATH = "/api/generated-map.webp";
// This value is also part of the cross-deployment cache key. Bump it whenever
// the snapshot or SVG rendering semantics change.
export const GENERATED_MAP_REQUEST_VERSION = 3 as const;

export const GENERATED_MAP_LIMITS = Object.freeze({
  width: Object.freeze({ minimum: 16, maximum: 64 }),
  height: Object.freeze({ minimum: 12, maximum: 48 }),
  seedLength: Object.freeze({ minimum: 1, maximum: 128 }),
  scale: Object.freeze({ minimum: 2, maximum: 20 }),
  waterWeight: Object.freeze({ minimum: 0, maximum: 2 }),
  difficultWeight: Object.freeze({ minimum: 0, maximum: 2 }),
  reliefWeight: Object.freeze({ minimum: 0, maximum: 2 }),
  rockRatio: Object.freeze({ minimum: 0, maximum: .12 }),
  treeRatio: Object.freeze({ minimum: 0, maximum: .32 }),
  buildingCount: Object.freeze({ minimum: 0, maximum: 8 }),
  cellSize: Object.freeze({ minimum: 16, maximum: 64 }),
});

const LANDSCAPE_MODE_SET: Readonly<Record<LandscapeMode, true>> = Object.freeze({
  countryside: true,
  river: true,
  coast: true,
  wetlands: true,
  underground: true,
  volcanic: true,
  highlands: true,
  city: true,
  "desert-canyon": true,
  "ancient-forest": true,
  "frozen-lake": true,
  badlands: true,
  "ruined-battlefield": true,
  farmland: true,
  archipelago: true,
  "mountain-pass": true,
  sewer: true,
  "ancient-ruins": true,
});

export const GENERATED_MAP_MODES = Object.freeze(
  Object.keys(LANDSCAPE_MODE_SET) as LandscapeMode[],
);

export interface GeneratedMapRenderOptions {
  cellSize?: number;
  useTileset?: boolean;
  stylizedLighting?: boolean;
  showGrid?: boolean;
  hiddenItems?: ReadonlySet<string> | readonly string[];
}

export type GeneratedMapHiddenItem = TerrainKind | ObstacleKind;

export interface CanonicalGeneratedMapRenderOptions {
  cellSize: number;
  useTileset: boolean;
  stylizedLighting: boolean;
  showGrid: boolean;
  hiddenItems: readonly GeneratedMapHiddenItem[];
}

export interface GeneratedMapRequest {
  version: typeof GENERATED_MAP_REQUEST_VERSION;
  options: TerrainOptions;
  renderOptions: CanonicalGeneratedMapRenderOptions;
}

export class GeneratedMapRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeneratedMapRequestError";
  }
}

const DEFAULT_RENDER_OPTIONS: CanonicalGeneratedMapRenderOptions = Object.freeze({
  cellSize: 64,
  useTileset: false,
  stylizedLighting: true,
  showGrid: false,
  hiddenItems: Object.freeze([]),
});

const HIDDEN_ITEM_SET = new Set<string>([
  ...Object.values(Terrain),
  ...Object.values(Obstacle),
]);

const REQUIRED_GENERATION_PARAMETERS = [
  "width",
  "height",
  "seed",
  "scale",
  "mode",
  "waterWeight",
  "difficultWeight",
  "reliefWeight",
  "rockRatio",
  "treeRatio",
  "buildingCount",
] as const;

const KNOWN_PARAMETERS = new Set([
  "v",
  ...REQUIRED_GENERATION_PARAMETERS,
  "cellSize",
  "useTileset",
  "stylizedLighting",
  "showGrid",
  "hiddenItems",
]);

const DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

function requestError(message: string): never {
  throw new GeneratedMapRequestError(message);
}

function finiteNumber(
  name: string,
  value: unknown,
  minimum: number,
  maximum: number,
  integer = false,
) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum ||
    (integer && !Number.isInteger(value))
  ) {
    const kind = integer ? "an integer" : "a number";
    requestError(`${name} must be ${kind} between ${minimum} and ${maximum}.`);
  }
  return Object.is(value, -0) ? 0 : value;
}

function queryNumber(
  parameters: URLSearchParams,
  name: string,
  minimum: number,
  maximum: number,
  integer = false,
) {
  const rawValue = parameters.get(name);
  if (rawValue === null) requestError(`Missing ${name} parameter.`);
  if (rawValue.length > 32 || !DECIMAL_PATTERN.test(rawValue)) {
    requestError(`${name} is not a valid decimal number.`);
  }
  return finiteNumber(name, Number(rawValue), minimum, maximum, integer);
}

function canonicalSeed(value: unknown) {
  if (typeof value !== "string") requestError("seed must be a string.");
  const seed = value.trim().normalize("NFC");
  const { minimum, maximum } = GENERATED_MAP_LIMITS.seedLength;
  if (
    seed.length < minimum ||
    seed.length > maximum ||
    /[\u0000-\u001f\u007f]/.test(seed)
  ) {
    requestError(
      `seed must contain between ${minimum} and ${maximum} characters and no control characters.`,
    );
  }
  return seed;
}

function landscapeMode(value: unknown): LandscapeMode {
  if (
    typeof value !== "string" ||
    !Object.prototype.hasOwnProperty.call(LANDSCAPE_MODE_SET, value)
  ) {
    requestError("mode is not a supported landscape mode.");
  }
  return value as LandscapeMode;
}

function booleanValue(name: string, value: unknown, fallback: boolean) {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") requestError(`${name} must be a boolean.`);
  return value;
}

function canonicalHiddenItems(
  value: GeneratedMapRenderOptions["hiddenItems"],
): readonly GeneratedMapHiddenItem[] {
  if (value === undefined) return DEFAULT_RENDER_OPTIONS.hiddenItems;
  if (!Array.isArray(value) && !(value instanceof Set)) {
    requestError("hiddenItems must be an array or a set.");
  }

  const items = [...value];
  for (const item of items) {
    if (typeof item !== "string" || !HIDDEN_ITEM_SET.has(item)) {
      requestError(`${String(item)} is not a supported hidden item.`);
    }
  }
  return Object.freeze(
    [...new Set(items as GeneratedMapHiddenItem[])].sort((left, right) =>
      left < right ? -1 : left > right ? 1 : 0
    ),
  );
}

function queryHiddenItems(parameters: URLSearchParams) {
  const value = parameters.get("hiddenItems");
  if (value === null || value === "") return DEFAULT_RENDER_OPTIONS.hiddenItems;
  return canonicalHiddenItems(value.split(","));
}

function queryBoolean(
  parameters: URLSearchParams,
  name: string,
  fallback: boolean,
) {
  const value = parameters.get(name);
  if (value === null) return fallback;
  if (value === "1") return true;
  if (value === "0") return false;
  return requestError(`${name} must be encoded as 0 or 1.`);
}

function canonicalOptions(options: TerrainOptions): TerrainOptions {
  return {
    width: finiteNumber(
      "width",
      options.width,
      GENERATED_MAP_LIMITS.width.minimum,
      GENERATED_MAP_LIMITS.width.maximum,
      true,
    ),
    height: finiteNumber(
      "height",
      options.height,
      GENERATED_MAP_LIMITS.height.minimum,
      GENERATED_MAP_LIMITS.height.maximum,
      true,
    ),
    seed: canonicalSeed(options.seed),
    scale: finiteNumber(
      "scale",
      options.scale,
      GENERATED_MAP_LIMITS.scale.minimum,
      GENERATED_MAP_LIMITS.scale.maximum,
      true,
    ),
    mode: landscapeMode(options.mode),
    waterWeight: finiteNumber(
      "waterWeight",
      options.waterWeight,
      GENERATED_MAP_LIMITS.waterWeight.minimum,
      GENERATED_MAP_LIMITS.waterWeight.maximum,
    ),
    difficultWeight: finiteNumber(
      "difficultWeight",
      options.difficultWeight,
      GENERATED_MAP_LIMITS.difficultWeight.minimum,
      GENERATED_MAP_LIMITS.difficultWeight.maximum,
    ),
    reliefWeight: finiteNumber(
      "reliefWeight",
      options.reliefWeight,
      GENERATED_MAP_LIMITS.reliefWeight.minimum,
      GENERATED_MAP_LIMITS.reliefWeight.maximum,
    ),
    rockRatio: finiteNumber(
      "rockRatio",
      options.rockRatio,
      GENERATED_MAP_LIMITS.rockRatio.minimum,
      GENERATED_MAP_LIMITS.rockRatio.maximum,
    ),
    treeRatio: finiteNumber(
      "treeRatio",
      options.treeRatio,
      GENERATED_MAP_LIMITS.treeRatio.minimum,
      GENERATED_MAP_LIMITS.treeRatio.maximum,
    ),
    buildingCount: finiteNumber(
      "buildingCount",
      options.buildingCount,
      GENERATED_MAP_LIMITS.buildingCount.minimum,
      GENERATED_MAP_LIMITS.buildingCount.maximum,
      true,
    ),
  };
}

function canonicalRenderOptions(
  options: GeneratedMapRenderOptions,
): CanonicalGeneratedMapRenderOptions {
  return {
    cellSize: finiteNumber(
      "cellSize",
      options.cellSize ?? DEFAULT_RENDER_OPTIONS.cellSize,
      GENERATED_MAP_LIMITS.cellSize.minimum,
      GENERATED_MAP_LIMITS.cellSize.maximum,
      true,
    ),
    useTileset: booleanValue(
      "useTileset",
      options.useTileset,
      DEFAULT_RENDER_OPTIONS.useTileset,
    ),
    stylizedLighting: booleanValue(
      "stylizedLighting",
      options.stylizedLighting,
      DEFAULT_RENDER_OPTIONS.stylizedLighting,
    ),
    showGrid: booleanValue(
      "showGrid",
      options.showGrid,
      DEFAULT_RENDER_OPTIONS.showGrid,
    ),
    hiddenItems: canonicalHiddenItems(options.hiddenItems),
  };
}

function mapEndpoint(origin: string | URL) {
  let base: URL;
  try {
    base = origin instanceof URL ? new URL(origin.href) : new URL(origin);
  } catch {
    return requestError("origin must be an absolute HTTP(S) URL.");
  }
  if (base.protocol !== "http:" && base.protocol !== "https:") {
    requestError("origin must be an absolute HTTP(S) URL.");
  }
  return new URL(GENERATED_MAP_PATH, base.origin);
}

function generatedMapUrl(
  origin: string | URL,
  generation: TerrainOptions,
  render: CanonicalGeneratedMapRenderOptions,
) {
  const url = mapEndpoint(origin);
  const parameters = url.searchParams;

  parameters.set("v", String(GENERATED_MAP_REQUEST_VERSION));
  parameters.set("width", String(generation.width));
  parameters.set("height", String(generation.height));
  parameters.set("seed", generation.seed);
  parameters.set("scale", String(generation.scale));
  parameters.set("mode", generation.mode);
  parameters.set("waterWeight", String(generation.waterWeight));
  parameters.set("difficultWeight", String(generation.difficultWeight));
  parameters.set("reliefWeight", String(generation.reliefWeight));
  parameters.set("rockRatio", String(generation.rockRatio));
  parameters.set("treeRatio", String(generation.treeRatio));
  parameters.set("buildingCount", String(generation.buildingCount));
  parameters.set("cellSize", String(render.cellSize));
  parameters.set("useTileset", render.useTileset ? "1" : "0");
  parameters.set("stylizedLighting", render.stylizedLighting ? "1" : "0");
  if (render.showGrid) parameters.set("showGrid", "1");
  if (render.hiddenItems.length) {
    parameters.set("hiddenItems", render.hiddenItems.join(","));
  }
  return url.href;
}

export function buildGeneratedMapUrl(
  origin: string | URL,
  options: TerrainOptions,
  renderOptions: GeneratedMapRenderOptions,
) {
  const generation = canonicalOptions(options);
  const render = canonicalRenderOptions(renderOptions);
  return generatedMapUrl(origin, generation, render);
}

export function canonicalGeneratedMapUrl(
  origin: string | URL,
  request: GeneratedMapRequest,
) {
  return generatedMapUrl(
    origin,
    request.options,
    request.renderOptions,
  );
}

export function parseGeneratedMapRequest(url: URL): GeneratedMapRequest {
  if (url.pathname !== GENERATED_MAP_PATH) {
    requestError(`Expected ${GENERATED_MAP_PATH}.`);
  }

  const seen = new Set<string>();
  for (const [name] of url.searchParams) {
    if (!KNOWN_PARAMETERS.has(name)) requestError(`Unknown ${name} parameter.`);
    if (seen.has(name)) requestError(`Duplicate ${name} parameter.`);
    seen.add(name);
  }

  const version = queryNumber(
    url.searchParams,
    "v",
    GENERATED_MAP_REQUEST_VERSION,
    GENERATED_MAP_REQUEST_VERSION,
    true,
  );
  for (const name of REQUIRED_GENERATION_PARAMETERS) {
    if (!seen.has(name)) requestError(`Missing ${name} parameter.`);
  }

  const options = canonicalOptions({
    width: queryNumber(
      url.searchParams,
      "width",
      GENERATED_MAP_LIMITS.width.minimum,
      GENERATED_MAP_LIMITS.width.maximum,
      true,
    ),
    height: queryNumber(
      url.searchParams,
      "height",
      GENERATED_MAP_LIMITS.height.minimum,
      GENERATED_MAP_LIMITS.height.maximum,
      true,
    ),
    seed: canonicalSeed(url.searchParams.get("seed")),
    scale: queryNumber(
      url.searchParams,
      "scale",
      GENERATED_MAP_LIMITS.scale.minimum,
      GENERATED_MAP_LIMITS.scale.maximum,
      true,
    ),
    mode: landscapeMode(url.searchParams.get("mode")),
    waterWeight: queryNumber(
      url.searchParams,
      "waterWeight",
      GENERATED_MAP_LIMITS.waterWeight.minimum,
      GENERATED_MAP_LIMITS.waterWeight.maximum,
    ),
    difficultWeight: queryNumber(
      url.searchParams,
      "difficultWeight",
      GENERATED_MAP_LIMITS.difficultWeight.minimum,
      GENERATED_MAP_LIMITS.difficultWeight.maximum,
    ),
    reliefWeight: queryNumber(
      url.searchParams,
      "reliefWeight",
      GENERATED_MAP_LIMITS.reliefWeight.minimum,
      GENERATED_MAP_LIMITS.reliefWeight.maximum,
    ),
    rockRatio: queryNumber(
      url.searchParams,
      "rockRatio",
      GENERATED_MAP_LIMITS.rockRatio.minimum,
      GENERATED_MAP_LIMITS.rockRatio.maximum,
    ),
    treeRatio: queryNumber(
      url.searchParams,
      "treeRatio",
      GENERATED_MAP_LIMITS.treeRatio.minimum,
      GENERATED_MAP_LIMITS.treeRatio.maximum,
    ),
    buildingCount: queryNumber(
      url.searchParams,
      "buildingCount",
      GENERATED_MAP_LIMITS.buildingCount.minimum,
      GENERATED_MAP_LIMITS.buildingCount.maximum,
      true,
    ),
  });

  return {
    version: version as typeof GENERATED_MAP_REQUEST_VERSION,
    options,
    renderOptions: canonicalRenderOptions({
      cellSize: seen.has("cellSize")
        ? queryNumber(
          url.searchParams,
          "cellSize",
          GENERATED_MAP_LIMITS.cellSize.minimum,
          GENERATED_MAP_LIMITS.cellSize.maximum,
          true,
        )
        : undefined,
      useTileset: queryBoolean(
        url.searchParams,
        "useTileset",
        DEFAULT_RENDER_OPTIONS.useTileset,
      ),
      stylizedLighting: queryBoolean(
        url.searchParams,
        "stylizedLighting",
        DEFAULT_RENDER_OPTIONS.stylizedLighting,
      ),
      showGrid: queryBoolean(
        url.searchParams,
        "showGrid",
        DEFAULT_RENDER_OPTIONS.showGrid,
      ),
      hiddenItems: queryHiddenItems(url.searchParams),
    }),
  };
}
