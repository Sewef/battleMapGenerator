import {
  Obstacle,
  Terrain,
  type Grid,
  type ObstacleKind,
  type SurfaceKind,
  type TerrainKind,
  type Tile,
} from "../domain/map";

export const GRID_SNAPSHOT_BYTES_PER_TILE = 3;
export const GRID_SNAPSHOT_CHARACTERS_PER_TILE = 4;
export const GRID_SNAPSHOT_MIN_WIDTH = 16;
export const GRID_SNAPSHOT_MAX_WIDTH = 64;
export const GRID_SNAPSHOT_MIN_HEIGHT = 12;
export const GRID_SNAPSHOT_MAX_HEIGHT = 48;
export const GRID_SNAPSHOT_MAX_BUILDING_GROUPS = 256;
export const GRID_SNAPSHOT_MAX_CHARACTERS =
  GRID_SNAPSHOT_MAX_WIDTH * GRID_SNAPSHOT_MAX_HEIGHT *
  GRID_SNAPSHOT_CHARACTERS_PER_TILE;

export class GridSnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GridSnapshotError";
  }
}

const TERRAIN_BY_CODE = Object.freeze([
  Terrain.Void,
  Terrain.Ground,
  Terrain.Difficult,
  Terrain.Water,
  Terrain.Ice,
  Terrain.Lava,
  Terrain.Beach,
  Terrain.Road,
  Terrain.Bridge,
  Terrain.Cliff,
  Terrain.Ravine,
] satisfies readonly TerrainKind[]);

const TERRAIN_CODE = new Map<TerrainKind, number>(
  TERRAIN_BY_CODE.map((terrain, code) => [terrain, code]),
);

const SURFACE_BY_CODE = Object.freeze([
  undefined,
  Terrain.Road,
  Terrain.Bridge,
] satisfies readonly (SurfaceKind | undefined)[]);

const SURFACE_CODE = new Map<SurfaceKind | undefined, number>(
  SURFACE_BY_CODE.map((surface, code) => [surface, code]),
);

const OBSTACLE_BY_CODE = Object.freeze([
  Obstacle.None,
  Obstacle.Tree,
  Obstacle.Rock,
  Obstacle.Building,
] satisfies readonly ObstacleKind[]);

const OBSTACLE_CODE = new Map<ObstacleKind, number>(
  OBSTACLE_BY_CODE.map((obstacle, code) => [obstacle, code]),
);

const Direction = Object.freeze({
  North: 0,
  East: 1,
  South: 2,
  West: 3,
} as const);

const DIRECTION_NORMALS = Object.freeze([
  Object.freeze({ x: 0, y: -1 }),
  Object.freeze({ x: 1, y: 0 }),
  Object.freeze({ x: 0, y: 1 }),
  Object.freeze({ x: -1, y: 0 }),
] as const);

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const BYTE_ZERO_TERRAIN_MASK = 0b0000_1111;
const BYTE_ZERO_SURFACE_SHIFT = 4;
const BYTE_ZERO_SURFACE_MASK = 0b0011_0000;
const BYTE_ZERO_OBSTACLE_SHIFT = 6;
const BYTE_ZERO_OBSTACLE_MASK = 0b1100_0000;
const BYTE_TWO_ELEVATION_MASK = 0b0000_0011;
const BYTE_TWO_SLOPE_FLAG = 0b0000_0100;
const BYTE_TWO_DIRECTION_SHIFT = 3;
const BYTE_TWO_DIRECTION_MASK = 0b0001_1000;
const BYTE_TWO_RESERVED_MASK = 0b1110_0000;

function snapshotError(message: string): never {
  throw new GridSnapshotError(message);
}

function validateDimension(
  name: "width" | "height",
  value: number,
  minimum: number,
  maximum: number,
) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    snapshotError(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function gridDimensions(grid: Grid) {
  if (!Array.isArray(grid)) snapshotError("grid must be an array of rows.");
  const height = validateDimension(
    "height",
    grid.length,
    GRID_SNAPSHOT_MIN_HEIGHT,
    GRID_SNAPSHOT_MAX_HEIGHT,
  );
  if (!Array.isArray(grid[0])) snapshotError("grid must contain rows.");
  const width = validateDimension(
    "width",
    grid[0].length,
    GRID_SNAPSHOT_MIN_WIDTH,
    GRID_SNAPSHOT_MAX_WIDTH,
  );
  for (let y = 0; y < height; y += 1) {
    if (!Array.isArray(grid[y]) || grid[y].length !== width) {
      snapshotError(`grid row ${y} does not match the expected width ${width}.`);
    }
  }
  return { width, height };
}

function codeFor<T>(
  label: string,
  value: T,
  codes: ReadonlyMap<T, number>,
) {
  const code = codes.get(value);
  if (code === undefined) snapshotError(`Unsupported ${label}: ${String(value)}.`);
  return code;
}

function quantizedHeight(tile: Tile, x: number, y: number) {
  const height = tile.height;
  if (
    typeof height !== "number" ||
    !Number.isFinite(height) ||
    height < 0 ||
    height > 1
  ) {
    snapshotError(`Invalid height at ${x},${y}; expected a number from 0 to 1.`);
  }
  return Math.round(height * 255);
}

function elevationCode(tile: Tile, x: number, y: number) {
  if (tile.elevation === undefined) return 0;
  if (
    !Number.isInteger(tile.elevation) ||
    tile.elevation < 1 ||
    tile.elevation > 3
  ) {
    snapshotError(`Invalid elevation at ${x},${y}; expected 1, 2, 3 or undefined.`);
  }
  return tile.elevation;
}

function slopeDirection(tile: Tile, x: number, y: number) {
  if (tile.transition === undefined) {
    if (
      tile.transitionNormalX !== undefined ||
      tile.transitionNormalY !== undefined
    ) {
      snapshotError(`Transition normal without a slope at ${x},${y}.`);
    }
    return { slope: false, direction: Direction.North } as const;
  }
  if (tile.transition !== "slope") {
    snapshotError(`Unsupported transition at ${x},${y}: ${String(tile.transition)}.`);
  }

  const normalX = tile.transitionNormalX;
  const normalY = tile.transitionNormalY;
  if (
    typeof normalX !== "number" ||
    typeof normalY !== "number" ||
    !Number.isFinite(normalX) ||
    !Number.isFinite(normalY) ||
    (normalX === 0 && normalY === 0)
  ) {
    snapshotError(`Invalid slope normal at ${x},${y}.`);
  }

  const direction = Math.abs(normalX) >= Math.abs(normalY)
    ? normalX >= 0 ? Direction.East : Direction.West
    : normalY >= 0 ? Direction.South : Direction.North;
  return { slope: true, direction } as const;
}

function buildingGroupKey(tile: Tile, tileIndex: number, x: number, y: number) {
  if (tile.obstacle !== Obstacle.Building) return undefined;
  if (tile.obstacleId === undefined) return `cell:${tileIndex}`;
  if (!Number.isSafeInteger(tile.obstacleId)) {
    snapshotError(`Invalid building obstacleId at ${x},${y}.`);
  }
  return `id:${tile.obstacleId}`;
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 8192;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function base64UrlToBytes(value: string, expectedBytes: number) {
  if (typeof value !== "string") snapshotError("snapshot must be a string.");
  const expectedCharacters = expectedBytes / GRID_SNAPSHOT_BYTES_PER_TILE *
    GRID_SNAPSHOT_CHARACTERS_PER_TILE;
  if (
    value.length !== expectedCharacters ||
    value.length > GRID_SNAPSHOT_MAX_CHARACTERS
  ) {
    snapshotError(
      `snapshot must contain exactly ${expectedCharacters} base64url characters.`,
    );
  }
  if (!BASE64URL_PATTERN.test(value)) {
    snapshotError("snapshot is not canonical unpadded base64url.");
  }

  let binary: string;
  try {
    binary = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
  } catch {
    return snapshotError("snapshot is not valid base64url.");
  }
  if (binary.length !== expectedBytes) {
    snapshotError(`snapshot must decode to exactly ${expectedBytes} bytes.`);
  }

  const bytes = new Uint8Array(expectedBytes);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  if (bytesToBase64Url(bytes) !== value) {
    snapshotError("snapshot is not canonical unpadded base64url.");
  }
  return bytes;
}

/**
 * Encode a rectangular generated grid using exactly three bytes per tile.
 * Heights and slope normals are intentionally quantized. For building tiles,
 * the third byte is an unsigned group ID; otherwise it stores elevation and
 * slope metadata. Building IDs are remapped by first row-major occurrence so
 * equivalent grouping is canonical.
 */
export function encodeGridSnapshot(grid: Grid) {
  const { width, height } = gridDimensions(grid);
  const bytes = new Uint8Array(
    width * height * GRID_SNAPSHOT_BYTES_PER_TILE,
  );
  const buildingGroups = new Map<string, number>();

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const tile = grid[y][x];
      if (!tile || typeof tile !== "object") {
        snapshotError(`Missing tile at ${x},${y}.`);
      }
      const tileIndex = y * width + x;
      const offset = tileIndex * GRID_SNAPSHOT_BYTES_PER_TILE;
      const terrain = codeFor("terrain", tile.terrain, TERRAIN_CODE);
      const surface = codeFor("surface", tile.surface, SURFACE_CODE);
      const obstacle = codeFor("obstacle", tile.obstacle, OBSTACLE_CODE);
      const heightByte = quantizedHeight(tile, x, y);
      let metadata: number;
      const groupKey = buildingGroupKey(tile, tileIndex, x, y);
      if (groupKey !== undefined) {
        if (
          tile.elevation !== undefined ||
          tile.transition !== undefined ||
          tile.transitionNormalX !== undefined ||
          tile.transitionNormalY !== undefined
        ) {
          snapshotError(`Building tile has unsupported relief metadata at ${x},${y}.`);
        }
        const existing = buildingGroups.get(groupKey);
        if (existing !== undefined) {
          metadata = existing;
        } else {
          metadata = buildingGroups.size;
          if (metadata >= GRID_SNAPSHOT_MAX_BUILDING_GROUPS) {
            snapshotError(
              `grid contains more than ${GRID_SNAPSHOT_MAX_BUILDING_GROUPS} building groups.`,
            );
          }
          buildingGroups.set(groupKey, metadata);
        }
      } else {
        const elevation = elevationCode(tile, x, y);
        const { slope, direction } = slopeDirection(tile, x, y);
        metadata = elevation |
          (slope ? BYTE_TWO_SLOPE_FLAG : 0) |
          (direction << BYTE_TWO_DIRECTION_SHIFT);
      }

      bytes[offset] = terrain |
        (surface << BYTE_ZERO_SURFACE_SHIFT) |
        (obstacle << BYTE_ZERO_OBSTACLE_SHIFT);
      bytes[offset + 1] = heightByte;
      bytes[offset + 2] = metadata;
    }
  }

  return bytesToBase64Url(bytes);
}

/** Decode and strictly validate a canonical three-byte-per-tile snapshot. */
export function decodeGridSnapshot(
  value: string,
  width: number,
  height: number,
): Grid {
  const safeWidth = validateDimension(
    "width",
    width,
    GRID_SNAPSHOT_MIN_WIDTH,
    GRID_SNAPSHOT_MAX_WIDTH,
  );
  const safeHeight = validateDimension(
    "height",
    height,
    GRID_SNAPSHOT_MIN_HEIGHT,
    GRID_SNAPSHOT_MAX_HEIGHT,
  );
  const expectedBytes = safeWidth * safeHeight *
    GRID_SNAPSHOT_BYTES_PER_TILE;
  const bytes = base64UrlToBytes(value, expectedBytes);
  const grid: Grid = [];
  const seenBuildingGroups = new Set<number>();
  let nextBuildingGroup = 0;

  for (let y = 0; y < safeHeight; y += 1) {
    const row: Tile[] = [];
    for (let x = 0; x < safeWidth; x += 1) {
      const offset = (y * safeWidth + x) * GRID_SNAPSHOT_BYTES_PER_TILE;
      const byteZero = bytes[offset];
      const byteTwo = bytes[offset + 2];
      const terrainCode = byteZero & BYTE_ZERO_TERRAIN_MASK;
      const surfaceCode = (byteZero & BYTE_ZERO_SURFACE_MASK) >>>
        BYTE_ZERO_SURFACE_SHIFT;
      const obstacleCode = (byteZero & BYTE_ZERO_OBSTACLE_MASK) >>>
        BYTE_ZERO_OBSTACLE_SHIFT;
      const terrain = TERRAIN_BY_CODE[terrainCode];
      const surface = SURFACE_BY_CODE[surfaceCode];
      const obstacle = OBSTACLE_BY_CODE[obstacleCode];
      if (terrain === undefined) {
        snapshotError(`Invalid terrain code ${terrainCode} at ${x},${y}.`);
      }
      if (surfaceCode >= SURFACE_BY_CODE.length) {
        snapshotError(`Invalid surface code ${surfaceCode} at ${x},${y}.`);
      }
      if (obstacle === undefined) {
        snapshotError(`Invalid obstacle code ${obstacleCode} at ${x},${y}.`);
      }

      const tile: Tile = {
        terrain,
        obstacle,
        height: bytes[offset + 1] / 255,
      };
      if (surface !== undefined) tile.surface = surface;
      if (obstacle === Obstacle.Building) {
        const buildingGroup = byteTwo;
        if (!seenBuildingGroups.has(buildingGroup)) {
          if (buildingGroup !== nextBuildingGroup) {
            snapshotError(`Non-canonical building group at ${x},${y}.`);
          }
          seenBuildingGroups.add(buildingGroup);
          nextBuildingGroup += 1;
        }
        tile.obstacleId = buildingGroup;
      } else {
        if ((byteTwo & BYTE_TWO_RESERVED_MASK) !== 0) {
          snapshotError(`Reserved metadata bits are set at ${x},${y}.`);
        }
        const elevation = byteTwo & BYTE_TWO_ELEVATION_MASK;
        const slope = (byteTwo & BYTE_TWO_SLOPE_FLAG) !== 0;
        const direction = (byteTwo & BYTE_TWO_DIRECTION_MASK) >>>
          BYTE_TWO_DIRECTION_SHIFT;
        if (!slope && direction !== Direction.North) {
          snapshotError(`Non-canonical slope direction at ${x},${y}.`);
        }
        if (elevation !== 0) tile.elevation = elevation;
        if (slope) {
          const normal = DIRECTION_NORMALS[direction];
          tile.transition = "slope";
          tile.transitionNormalX = normal.x;
          tile.transitionNormalY = normal.y;
        }
      }
      row.push(tile);
    }
    grid.push(row);
  }

  return grid;
}
