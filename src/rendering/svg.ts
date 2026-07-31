import {
  Obstacle,
  Terrain,
  tileSurface,
  type Grid,
  type LandscapeMode,
  type TerrainKind,
  type Tile,
} from "../domain/map";
import { getBiomeObjectStyle, getTerrainStyle } from "./palettes";

export interface SvgRenderOptions {
  /** Output pixels per map cell. */
  cellSize?: number;
  /** Use the 6 x 5 terrain sprite sheet instead of the vector material fills. */
  useTileset?: boolean;
  /**
   * URL or data URL for terrain.png. A data URL keeps server-side rasterization
   * self-contained. When omitted, useTileset falls back to pixel-like patterns.
   */
  tilesetHref?: string;
  stylizedLighting?: boolean;
  showGrid?: boolean;
  hiddenItems?: ReadonlySet<string>;
  hiddenOpacity?: number;
}

type Point = { x: number; y: number };
type Side = "top" | "right" | "bottom" | "left";
type Axis = "horizontal" | "vertical";
type TilesetCoordinate = readonly [column: number, row: number];
type TilesetProfileName = "grass" | "sand" | "mountain" | "snow";

const SVG_BACKGROUND = "#f3f0e5";
const SPRITE_SIZE = 32;
const SPRITE_COLUMNS = 6;
const SPRITE_ROWS = 5;

const terrainPaintOrder: TerrainKind[] = [
  Terrain.Ground,
  Terrain.Difficult,
  Terrain.Beach,
  Terrain.Water,
  Terrain.Ice,
  Terrain.Lava,
  Terrain.Ravine,
  Terrain.Void,
  Terrain.Cliff,
];

const terrainPriority: Record<TerrainKind, number> = {
  [Terrain.Void]: 120,
  [Terrain.Ground]: 10,
  [Terrain.Difficult]: 30,
  [Terrain.Water]: 80,
  [Terrain.Ice]: 85,
  [Terrain.Lava]: 75,
  [Terrain.Beach]: 70,
  [Terrain.Road]: 100,
  [Terrain.Bridge]: 110,
  [Terrain.Cliff]: 90,
  [Terrain.Ravine]: 95,
};

const sharedTilesetCoordinates: Partial<
  Record<TerrainKind, TilesetCoordinate>
> = {
  [Terrain.Beach]: [2, 0],
  [Terrain.Water]: [0, 3],
  [Terrain.Lava]: [0, 4],
  [Terrain.Cliff]: [3, 1],
  [Terrain.Bridge]: [5, 0],
};

const tilesetProfiles: Record<
  TilesetProfileName,
  Partial<Record<TerrainKind, TilesetCoordinate>>
> = {
  grass: {
    [Terrain.Ground]: [0, 0],
    [Terrain.Difficult]: [1, 0],
    [Terrain.Road]: [3, 0],
  },
  sand: {
    [Terrain.Ground]: [0, 1],
    [Terrain.Difficult]: [1, 1],
    [Terrain.Road]: [3, 0],
  },
  mountain: {
    [Terrain.Ground]: [0, 2],
    [Terrain.Difficult]: [1, 2],
    [Terrain.Road]: [4, 0],
  },
  snow: {
    [Terrain.Ground]: [2, 2],
    [Terrain.Difficult]: [3, 2],
    [Terrain.Road]: [3, 0],
  },
};

const tilesetProfileByMode: Partial<
  Record<LandscapeMode, TilesetProfileName>
> = {
  "desert-canyon": "sand",
  badlands: "sand",
  "mountain-pass": "mountain",
  highlands: "mountain",
  sewer: "mountain",
  underground: "mountain",
  volcanic: "mountain",
  "frozen-lake": "snow",
};

function format(value: number) {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? "0" : rounded.toString();
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function escapeAttribute(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function variation(x: number, y: number, salt: number) {
  let value = Math.imul(x + 101, 374761393) ^
    Math.imul(y + 53, 668265263) ^
    Math.imul(salt + 17, 1274126177);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function tilesetCoordinate(
  terrain: TerrainKind,
  mode: LandscapeMode,
): TilesetCoordinate | undefined {
  const profile = tilesetProfileByMode[mode] ?? "grass";
  return tilesetProfiles[profile][terrain] ??
    sharedTilesetCoordinates[terrain];
}

function cellPath(points: readonly Point[], cellSize: number) {
  if (!points.length) return "";
  let rowMajor = true;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (
      current.y < previous.y ||
      (current.y === previous.y && current.x < previous.x)
    ) {
      rowMajor = false;
      break;
    }
  }
  const ordered = rowMajor
    ? points
    : [...points].sort((left, right) => left.y - right.y || left.x - right.x);

  const path: string[] = [];
  let start = ordered[0].x;
  let end = start;
  let y = ordered[0].y;
  const addRun = () => {
    const left = start * cellSize;
    const top = y * cellSize;
    const width = (end - start + 1) * cellSize;
    path.push(`M${left} ${top}h${width}v${cellSize}h-${width}Z`);
  };
  for (let index = 1; index < ordered.length; index += 1) {
    const point = ordered[index];
    if (point.y === y && point.x === end + 1) {
      end = point.x;
    } else {
      addRun();
      start = point.x;
      end = point.x;
      y = point.y;
    }
  }
  addRun();
  return path.join("");
}

function indexedCellPath(
  cells: readonly number[],
  columns: number,
  cellSize: number,
) {
  if (!cells.length) return "";
  const path: string[] = [];
  let y = Math.floor(cells[0] / columns);
  let start = cells[0] - y * columns;
  let end = start;
  const addRun = () => {
    const left = start * cellSize;
    const top = y * cellSize;
    const width = (end - start + 1) * cellSize;
    path.push(`M${left} ${top}h${width}v${cellSize}h-${width}Z`);
  };
  for (let index = 1; index < cells.length; index += 1) {
    const nextY = Math.floor(cells[index] / columns);
    const nextX = cells[index] - nextY * columns;
    if (nextY === y && nextX === end + 1) {
      end = nextX;
    } else {
      addRun();
      y = nextY;
      start = nextX;
      end = nextX;
    }
  }
  addRun();
  return path.join("");
}

function pointKey(x: number, y: number) {
  return `${x},${y}`;
}

function sidePath(
  points: readonly Point[],
  cells: ReadonlySet<string>,
  columns: number,
  rows: number,
  cellSize: number,
  sides: ReadonlySet<Side>,
  includeCanvasEdges = false,
) {
  const path: string[] = [];
  for (const { x, y } of points) {
    const left = x * cellSize;
    const top = y * cellSize;
    const right = left + cellSize;
    const bottom = top + cellSize;
    if (
      sides.has("top") &&
      (includeCanvasEdges || y > 0) &&
      !cells.has(pointKey(x, y - 1))
    ) {
      path.push(`M${format(left)} ${format(top)}H${format(right)}`);
    }
    if (
      sides.has("right") &&
      (includeCanvasEdges || x < columns - 1) &&
      !cells.has(pointKey(x + 1, y))
    ) {
      path.push(`M${format(right)} ${format(top)}V${format(bottom)}`);
    }
    if (
      sides.has("bottom") &&
      (includeCanvasEdges || y < rows - 1) &&
      !cells.has(pointKey(x, y + 1))
    ) {
      path.push(`M${format(right)} ${format(bottom)}H${format(left)}`);
    }
    if (
      sides.has("left") &&
      (includeCanvasEdges || x > 0) &&
      !cells.has(pointKey(x - 1, y))
    ) {
      path.push(`M${format(left)} ${format(bottom)}V${format(top)}`);
    }
  }
  return path.join("");
}

function pointsToSet(points: readonly Point[]) {
  const cells = new Set<string>();
  for (const { x, y } of points) cells.add(pointKey(x, y));
  return cells;
}

function baseTerrainGrid(grid: Grid, columns: number) {
  const overlay = new Set<TerrainKind>([Terrain.Road, Terrain.Bridge]);
  const result: Array<Array<TerrainKind | undefined>> = grid.map((row, y) =>
    Array.from({ length: columns }, (_, x) => {
      const tile = row[x];
      if (!tile) return undefined;
      if (!overlay.has(tile.terrain)) return tile.terrain;

      const canUnderlay = (kind: TerrainKind) =>
        !overlay.has(kind) &&
        !(tile.terrain === Terrain.Road && kind === Terrain.Cliff);
      for (let radius = 1; radius <= 3; radius += 1) {
        const candidates = [
          grid[y - radius]?.[x]?.terrain,
          grid[y + radius]?.[x]?.terrain,
          grid[y]?.[x - radius]?.terrain,
          grid[y]?.[x + radius]?.terrain,
        ].filter((kind): kind is TerrainKind =>
          kind !== undefined && canUnderlay(kind)
        );
        if (candidates.length) {
          candidates.sort((a, b) => terrainPriority[a] - terrainPriority[b]);
          return candidates[0];
        }
      }
      return Terrain.Ground;
    })
  );
  return result;
}

function terrainGroups(
  baseTerrain: ReadonlyArray<ReadonlyArray<TerrainKind | undefined>>,
) {
  const groups = new Map<TerrainKind, Point[]>();
  for (let y = 0; y < baseTerrain.length; y += 1) {
    for (let x = 0; x < baseTerrain[y].length; x += 1) {
      const terrain = baseTerrain[y][x];
      if (!terrain) continue;
      const points = groups.get(terrain) ?? [];
      points.push({ x, y });
      groups.set(terrain, points);
    }
  }
  return groups;
}

function opacityFor(
  item: string,
  hiddenItems: ReadonlySet<string>,
  hiddenOpacity: number,
) {
  return hiddenItems.has(item) ? hiddenOpacity : 1;
}

function terrainPatternDefinition(
  terrain: TerrainKind,
  mode: LandscapeMode,
  cellSize: number,
  useTileset: boolean,
  tilesetHref: string | undefined,
) {
  const style = getTerrainStyle(terrain, mode);
  const coordinate = tilesetCoordinate(terrain, mode);
  const id = `material-${terrain}`;
  const tintOpacity = terrain === Terrain.Cliff
    ? .58
    : terrain === Terrain.Ground || terrain === Terrain.Difficult
      ? .48
      : terrain === Terrain.Water || terrain === Terrain.Lava
        ? .34
        : .42;

  if (useTileset && tilesetHref && coordinate) {
    const viewX = coordinate[0] * SPRITE_SIZE;
    const viewY = coordinate[1] * SPRITE_SIZE;
    return `<pattern id="${id}" patternUnits="userSpaceOnUse" ` +
      `width="${format(cellSize)}" height="${format(cellSize)}">` +
      `<svg width="${format(cellSize)}" height="${format(cellSize)}" ` +
      `viewBox="${viewX} ${viewY} ${SPRITE_SIZE} ${SPRITE_SIZE}" ` +
      `preserveAspectRatio="none" overflow="hidden">` +
      `<image href="${escapeAttribute(tilesetHref)}" width="${SPRITE_COLUMNS * SPRITE_SIZE}" ` +
      `height="${SPRITE_ROWS * SPRITE_SIZE}" image-rendering="pixelated"/>` +
      `</svg><rect width="${format(cellSize)}" height="${format(cellSize)}" ` +
      `fill="${style.color}" opacity="${format(tintOpacity)}"/></pattern>`;
  }

  if (useTileset) {
    const pixel = Math.max(2, Math.round(cellSize / 8));
    return `<pattern id="${id}" patternUnits="userSpaceOnUse" ` +
      `width="${format(cellSize)}" height="${format(cellSize)}">` +
      `<rect width="100%" height="100%" fill="${style.color}"/>` +
      `<path d="M0 ${format(pixel)}H${format(pixel)}V0H${format(pixel * 2)}V${format(pixel * 2)}` +
      `H${format(pixel * 3)}V${format(pixel)}H${format(pixel * 5)}V${format(pixel * 3)}` +
      `H${format(pixel * 4)}V${format(pixel * 4)}H${format(pixel * 2)}V${format(pixel * 5)}` +
      `H0ZM${format(pixel * 6)} 0V${format(pixel)}H${format(pixel * 8)}V${format(pixel * 3)}` +
      `H${format(pixel * 7)}V${format(pixel * 5)}H${format(pixel * 5)}V${format(pixel * 7)}` +
      `H${format(pixel * 8)}V${format(pixel * 8)}H${format(pixel * 6)}Z" ` +
      `fill="${style.alt}" opacity=".32"/></pattern>`;
  }

  return `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${style.color}"/>` +
    `<stop offset=".62" stop-color="${style.color}"/>` +
    `<stop offset="1" stop-color="${style.alt}"/></linearGradient>`;
}

function buildingPatternDefinition(
  mode: LandscapeMode,
  cellSize: number,
  useTileset: boolean,
  tilesetHref: string | undefined,
) {
  const colors = getBiomeObjectStyle(mode).building;
  if (useTileset && tilesetHref) {
    const [column, row] = [4, 1] as const;
    return `<pattern id="building-material" patternUnits="userSpaceOnUse" ` +
      `width="${format(cellSize)}" height="${format(cellSize)}">` +
      `<svg width="${format(cellSize)}" height="${format(cellSize)}" ` +
      `viewBox="${column * SPRITE_SIZE} ${row * SPRITE_SIZE} ${SPRITE_SIZE} ${SPRITE_SIZE}" ` +
      `preserveAspectRatio="none" overflow="hidden">` +
      `<image href="${escapeAttribute(tilesetHref)}" width="${SPRITE_COLUMNS * SPRITE_SIZE}" ` +
      `height="${SPRITE_ROWS * SPRITE_SIZE}" image-rendering="pixelated"/>` +
      `</svg><rect width="${format(cellSize)}" height="${format(cellSize)}" ` +
      `fill="${colors.primary}" opacity=".5"/></pattern>`;
  }
  if (useTileset) {
    return `<pattern id="building-material" patternUnits="userSpaceOnUse" ` +
      `width="${format(cellSize / 2)}" height="${format(cellSize / 2)}">` +
      `<rect width="100%" height="100%" fill="${colors.primary}"/>` +
      `<path d="M0 0H${format(cellSize / 2)}V${format(cellSize * .08)}H0Z` +
      `M0 ${format(cellSize * .3)}H${format(cellSize / 2)}V${format(cellSize * .38)}H0Z" ` +
      `fill="${colors.secondary}" opacity=".42"/></pattern>`;
  }
  return `<linearGradient id="building-material" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${colors.secondary}"/>` +
    `<stop offset=".48" stop-color="${colors.primary}"/>` +
    `<stop offset=".52" stop-color="${colors.primary}"/>` +
    `<stop offset="1" stop-color="${colors.edge}"/></linearGradient>`;
}

function definitionBlock(
  mode: LandscapeMode,
  cellSize: number,
  useTileset: boolean,
  tilesetHref: string | undefined,
) {
  const definitions = terrainPaintOrder.map((terrain) =>
    terrainPatternDefinition(
      terrain,
      mode,
      cellSize,
      useTileset,
      tilesetHref,
    )
  );
  definitions.push(
    terrainPatternDefinition(
      Terrain.Road,
      mode,
      cellSize,
      useTileset,
      tilesetHref,
    ),
    terrainPatternDefinition(
      Terrain.Bridge,
      mode,
      cellSize,
      useTileset,
      tilesetHref,
    ),
    buildingPatternDefinition(mode, cellSize, useTileset, tilesetHref),
    `<linearGradient id="ramp-east" x1="0" y1="0" x2="1" y2="0">` +
      `<stop offset="0" stop-color="#fff0cf" stop-opacity=".18"/>` +
      `<stop offset=".5" stop-color="#76573c" stop-opacity=".02"/>` +
      `<stop offset="1" stop-color="#30251d" stop-opacity=".2"/></linearGradient>`,
    `<linearGradient id="ramp-west" x1="1" y1="0" x2="0" y2="0">` +
      `<stop offset="0" stop-color="#fff0cf" stop-opacity=".18"/>` +
      `<stop offset=".5" stop-color="#76573c" stop-opacity=".02"/>` +
      `<stop offset="1" stop-color="#30251d" stop-opacity=".2"/></linearGradient>`,
    `<linearGradient id="ramp-south" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="#fff0cf" stop-opacity=".18"/>` +
      `<stop offset=".5" stop-color="#76573c" stop-opacity=".02"/>` +
      `<stop offset="1" stop-color="#30251d" stop-opacity=".2"/></linearGradient>`,
    `<linearGradient id="ramp-north" x1="0" y1="1" x2="0" y2="0">` +
      `<stop offset="0" stop-color="#fff0cf" stop-opacity=".18"/>` +
      `<stop offset=".5" stop-color="#76573c" stop-opacity=".02"/>` +
      `<stop offset="1" stop-color="#30251d" stop-opacity=".2"/></linearGradient>`,
    `<radialGradient id="vignette" cx="50%" cy="47%" r="72%">` +
      `<stop offset="25%" stop-color="#111918" stop-opacity="0"/>` +
      `<stop offset="100%" stop-color="#111918" stop-opacity=".15"/></radialGradient>`,
    `<pattern id="paper-grain" width="47" height="43" patternUnits="userSpaceOnUse">` +
      `<circle cx="7" cy="11" r=".7" fill="#26312c" opacity=".13"/>` +
      `<circle cx="31" cy="29" r=".55" fill="#fff9df" opacity=".18"/>` +
      `<path d="M16 38l4-1M39 8l3 1" stroke="#28322d" stroke-width=".55" opacity=".1"/>` +
      `</pattern>`,
    `<filter id="building-shadow" x="-20%" y="-20%" width="150%" height="160%" ` +
      `color-interpolation-filters="sRGB"><feDropShadow dx="${format(cellSize * .055)}" ` +
      `dy="${format(cellSize * .085)}" stdDeviation="${format(Math.max(.6, cellSize * .045))}" ` +
      `flood-color="#171b18" flood-opacity=".36"/></filter>`,
    `<filter id="lava-glow" x="-30%" y="-30%" width="160%" height="160%">` +
      `<feGaussianBlur stdDeviation="${format(Math.max(1, cellSize * .12))}"/></filter>`,
  );
  return `<defs>${definitions.join("")}</defs>`;
}

function materialDetails(
  groups: ReadonlyMap<TerrainKind, Point[]>,
  cellSize: number,
  useTileset: boolean,
  hiddenItems: ReadonlySet<string>,
  hiddenOpacity: number,
) {
  const output: string[] = [];
  if (useTileset) return "";

  const detail = (
    terrain: TerrainKind,
    color: string,
    opacity: number,
    path: string[],
  ) => {
    if (!path.length) return;
    output.push(
      `<path d="${path.join("")}" fill="none" stroke="${color}" ` +
      `stroke-width="${format(Math.max(.7, cellSize * .022))}" ` +
      `stroke-linecap="round" stroke-linejoin="round" opacity="${format(
        opacity * opacityFor(terrain, hiddenItems, hiddenOpacity),
      )}"/>`,
    );
  };

  const difficult: string[] = [];
  for (const { x, y } of groups.get(Terrain.Difficult) ?? []) {
    const left = x * cellSize;
    const top = y * cellSize;
    const offset = variation(x, y, 31) * cellSize * .12;
    difficult.push(
      `M${format(left + cellSize * .22 + offset)} ${format(top + cellSize * .75)}` +
      `l${format(cellSize * .02)} -${format(cellSize * .16)}`,
      `M${format(left + cellSize * .7 - offset)} ${format(top + cellSize * .36)}` +
      `l-${format(cellSize * .03)} -${format(cellSize * .13)}`,
    );
  }
  detail(Terrain.Difficult, "#3d4932", .42, difficult);

  const water: string[] = [];
  for (const { x, y } of groups.get(Terrain.Water) ?? []) {
    const left = x * cellSize;
    const top = y * cellSize;
    const shift = variation(x, y, 73) * cellSize * .18;
    water.push(
      `M${format(left + cellSize * .14 + shift)} ${format(top + cellSize * .42)}` +
      `q${format(cellSize * .16)} -${format(cellSize * .07)} ${format(cellSize * .32)} 0` +
      `t${format(cellSize * .3)} 0`,
    );
  }
  detail(Terrain.Water, "#d8f1ea", .32, water);

  const lava: string[] = [];
  for (const { x, y } of groups.get(Terrain.Lava) ?? []) {
    const left = x * cellSize;
    const top = y * cellSize;
    const bend = (variation(x, y, 109) - .5) * cellSize * .18;
    lava.push(
      `M${format(left + cellSize * .16)} ${format(top + cellSize * .62)}` +
      `q${format(cellSize * .22)} ${format(-cellSize * .24 + bend)} ${format(cellSize * .4)} 0` +
      `t${format(cellSize * .34)} -${format(cellSize * .1)}`,
    );
  }
  detail(Terrain.Lava, "#ffb13c", .38, lava);

  const ice: string[] = [];
  for (const { x, y } of groups.get(Terrain.Ice) ?? []) {
    if (variation(x, y, 149) < .36) continue;
    const left = x * cellSize;
    const top = y * cellSize;
    ice.push(
      `M${format(left + cellSize * .2)} ${format(top + cellSize * .16)}` +
      `l${format(cellSize * .25)} ${format(cellSize * .3)}` +
      `l-${format(cellSize * .1)} ${format(cellSize * .34)}` +
      `m${format(cellSize * .1)} -${format(cellSize * .34)}` +
      `l${format(cellSize * .28)} -${format(cellSize * .12)}`,
    );
  }
  detail(Terrain.Ice, "#eefcff", .52, ice);

  const ravine: string[] = [];
  for (const { x, y } of groups.get(Terrain.Ravine) ?? []) {
    const left = x * cellSize;
    const top = y * cellSize;
    ravine.push(
      `M${format(left + cellSize * .08)} ${format(top + cellSize * .76)}` +
      `L${format(left + cellSize * .46)} ${format(top + cellSize * .3)}` +
      `L${format(left + cellSize * .9)} ${format(top + cellSize * .48)}`,
    );
  }
  detail(Terrain.Ravine, "#171b19", .58, ravine);

  const beach: string[] = [];
  for (const { x, y } of groups.get(Terrain.Beach) ?? []) {
    const left = x * cellSize;
    const top = y * cellSize;
    const r = Math.max(.65, cellSize * .018);
    beach.push(
      `M${format(left + cellSize * .3)} ${format(top + cellSize * .42)}` +
      `m-${format(r)} 0a${format(r)} ${format(r)} 0 1 0 ${format(r * 2)} 0` +
      `a${format(r)} ${format(r)} 0 1 0 -${format(r * 2)} 0`,
      `M${format(left + cellSize * .7)} ${format(top + cellSize * .68)}` +
      `m-${format(r * .8)} 0a${format(r * .8)} ${format(r * .8)} 0 1 0 ${format(r * 1.6)} 0` +
      `a${format(r * .8)} ${format(r * .8)} 0 1 0 -${format(r * 1.6)} 0`,
    );
  }
  if (beach.length) {
    output.push(
      `<path d="${beach.join("")}" fill="#695a3d" opacity="${format(
        .28 * opacityFor(Terrain.Beach, hiddenItems, hiddenOpacity),
      )}"/>`,
    );
  }
  return output.join("");
}

function terrainBoundaries(
  groups: ReadonlyMap<TerrainKind, Point[]>,
  columns: number,
  rows: number,
  cellSize: number,
  hiddenItems: ReadonlySet<string>,
  hiddenOpacity: number,
  stylizedLighting: boolean,
) {
  const output: string[] = [];
  const allSides = new Set<Side>(["top", "right", "bottom", "left"]);
  const cellSets = new Map<TerrainKind, ReadonlySet<string>>();
  const cellsFor = (terrain: TerrainKind, points: readonly Point[]) => {
    const cached = cellSets.get(terrain);
    if (cached) return cached;
    const cells = pointsToSet(points);
    cellSets.set(terrain, cells);
    return cells;
  };
  const boundary = (
    terrain: TerrainKind,
    stroke: string,
    width: number,
    opacity: number,
    sides = allSides,
  ) => {
    const points = groups.get(terrain) ?? [];
    if (!points.length) return;
    const path = sidePath(
      points,
      cellsFor(terrain, points),
      columns,
      rows,
      cellSize,
      sides,
      false,
    );
    if (!path) return;
    output.push(
      `<path d="${path}" fill="none" stroke="${stroke}" ` +
      `stroke-width="${format(width)}" stroke-linecap="round" ` +
      `stroke-linejoin="round" opacity="${format(
        opacity * opacityFor(terrain, hiddenItems, hiddenOpacity),
      )}"/>`,
    );
  };

  boundary(Terrain.Water, "#456f73", cellSize * .105, .58);
  boundary(Terrain.Water, "#b8d6c5", cellSize * .035, .55);
  boundary(Terrain.Ice, "#f0ffff", cellSize * .055, .52);
  boundary(Terrain.Lava, "#2c2422", cellSize * .13, .9);
  boundary(Terrain.Lava, "#ff7b31", cellSize * .038, .68);
  boundary(Terrain.Ravine, "#211c1a", cellSize * .12, .8);
  boundary(
    Terrain.Ravine,
    "#d3aa73",
    cellSize * .038,
    .52,
    new Set<Side>(["top", "left"]),
  );
  boundary(
    Terrain.Cliff,
    "#eee3c9",
    cellSize * .065,
    .52,
    new Set<Side>(["top", "left"]),
  );
  boundary(
    Terrain.Cliff,
    "#292b28",
    cellSize * .115,
    .84,
    new Set<Side>(["right", "bottom"]),
  );

  const cliffCells = groups.get(Terrain.Cliff) ?? [];
  const cliffSet = cellsFor(Terrain.Cliff, cliffCells);
  const hatches: string[] = [];
  for (const { x, y } of cliffCells) {
    const left = x * cellSize;
    const top = y * cellSize;
    if (y < rows - 1 && !cliffSet.has(pointKey(x, y + 1))) {
      for (const ratio of [.3, .67]) {
        hatches.push(
          `M${format(left + cellSize * ratio)} ${format(top + cellSize * .98)}` +
          `l-${format(cellSize * .09)} -${format(cellSize * (.15 + ratio * .04))}`,
        );
      }
    }
    if (x < columns - 1 && !cliffSet.has(pointKey(x + 1, y))) {
      for (const ratio of [.33, .7]) {
        hatches.push(
          `M${format(left + cellSize * .98)} ${format(top + cellSize * ratio)}` +
          `l-${format(cellSize * (.15 + ratio * .04))} -${format(cellSize * .08)}`,
        );
      }
    }
  }
  if (hatches.length) {
    output.push(
      `<path d="${hatches.join("")}" fill="none" stroke="#252825" ` +
      `stroke-width="${format(Math.max(1, cellSize * .032))}" ` +
      `stroke-linecap="round" opacity="${format(
        (stylizedLighting ? .78 : .64) *
          opacityFor(Terrain.Cliff, hiddenItems, hiddenOpacity),
      )}"/>`,
    );
  }
  return output.join("");
}

function slopeOverlays(
  grid: Grid,
  cellSize: number,
  hiddenItems: ReadonlySet<string>,
  hiddenOpacity: number,
) {
  const groups = new Map<string, { direction: string; opacity: string; points: Point[] }>();
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      const tile = grid[y][x];
      if (tile.transition !== "slope") continue;
      const normalX = tile.transitionNormalX ?? 0;
      const normalY = tile.transitionNormalY ?? 0;
      const direction = Math.abs(normalX) >= Math.abs(normalY)
        ? normalX >= 0 ? "east" : "west"
        : normalY >= 0 ? "south" : "north";
      const item = tileSurface(tile) ?? tile.terrain;
      const opacity = format(opacityFor(item, hiddenItems, hiddenOpacity));
      if (opacity === "0") continue;
      const key = `${direction}:${opacity}`;
      const group = groups.get(key) ?? { direction, opacity, points: [] };
      group.points.push({ x, y });
      groups.set(key, group);
    }
  }
  const output: string[] = [];
  for (const { direction, opacity, points } of groups.values()) {
    output.push(
      `<path d="${cellPath(points, cellSize)}" ` +
      `fill="url(#ramp-${direction})" opacity="${opacity}"/>`,
    );
  }
  return output.join("");
}

function roadLayer(
  grid: Grid,
  mode: LandscapeMode,
  columns: number,
  rows: number,
  cellSize: number,
  hiddenItems: ReadonlySet<string>,
  hiddenOpacity: number,
) {
  const roadCells: Point[] = [];
  const surfaceCells: Point[] = [];
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const surface = grid[y]?.[x] ? tileSurface(grid[y][x]) : undefined;
      if (!surface) continue;
      surfaceCells.push({ x, y });
      if (surface === Terrain.Road) roadCells.push({ x, y });
    }
  }
  if (!roadCells.length) return "";
  const surfaceSet = pointsToSet(surfaceCells);
  const edges = sidePath(
    roadCells,
    surfaceSet,
    columns,
    rows,
    cellSize,
    new Set<Side>(["top", "right", "bottom", "left"]),
    false,
  );
  const opacity = opacityFor(Terrain.Road, hiddenItems, hiddenOpacity);
  const detail: string[] = [];
  for (const { x, y } of roadCells) {
    if (variation(x, y, 337) < .48) continue;
    const left = x * cellSize;
    const top = y * cellSize;
    detail.push(
      `M${format(left + cellSize * .22)} ${format(top + cellSize * .7)}` +
      `q${format(cellSize * .14)} -${format(cellSize * .05)} ${format(cellSize * .28)} 0`,
    );
  }
  const style = getTerrainStyle(Terrain.Road, mode);
  return `<g opacity="${format(opacity)}">` +
    `<path d="${cellPath(roadCells, cellSize)}" fill="url(#material-road)"/>` +
    `<path d="${edges}" fill="none" stroke="${style.alt}" ` +
    `stroke-width="${format(Math.max(1.5, cellSize * .075))}" ` +
    `stroke-linecap="round" stroke-linejoin="round" opacity=".74"/>` +
    (detail.length
      ? `<path d="${detail.join("")}" fill="none" stroke="#f6e9c9" ` +
        `stroke-width="${format(Math.max(.7, cellSize * .021))}" opacity=".18"/>`
      : "") +
    `</g>`;
}

function inferBridgeAxes(grid: Grid, bridgeCells: readonly Point[]) {
  const bridgeSet = pointsToSet(bridgeCells);
  const pending = new Set(bridgeSet);
  const result = new Map<string, Axis>();
  while (pending.size) {
    const first = pending.values().next().value as string;
    const queue = [first];
    const component: Point[] = [];
    pending.delete(first);
    while (queue.length) {
      const key = queue.pop()!;
      const [x, y] = key.split(",").map(Number);
      component.push({ x, y });
      for (const [offsetX, offsetY] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const neighbor = pointKey(x + offsetX, y + offsetY);
        if (!pending.has(neighbor)) continue;
        pending.delete(neighbor);
        queue.push(neighbor);
      }
    }

    let horizontalConnections = 0;
    let verticalConnections = 0;
    const surfaceAt = (x: number, y: number) => {
      const tile = grid[y]?.[x];
      return tile ? tileSurface(tile) : undefined;
    };
    for (const { x, y } of component) {
      horizontalConnections += Number(surfaceAt(x - 1, y) === Terrain.Road);
      horizontalConnections += Number(surfaceAt(x + 1, y) === Terrain.Road);
      verticalConnections += Number(surfaceAt(x, y - 1) === Terrain.Road);
      verticalConnections += Number(surfaceAt(x, y + 1) === Terrain.Road);
    }
    const width = Math.max(...component.map(({ x }) => x)) -
      Math.min(...component.map(({ x }) => x)) + 1;
    const height = Math.max(...component.map(({ y }) => y)) -
      Math.min(...component.map(({ y }) => y)) + 1;
    const axis: Axis = horizontalConnections === verticalConnections
      ? width >= height ? "horizontal" : "vertical"
      : horizontalConnections > verticalConnections
        ? "horizontal"
        : "vertical";
    for (const point of component) result.set(pointKey(point.x, point.y), axis);
  }
  return result;
}

function bridgeLayer(
  grid: Grid,
  baseTerrain: ReadonlyArray<ReadonlyArray<TerrainKind | undefined>>,
  columns: number,
  rows: number,
  cellSize: number,
  hiddenItems: ReadonlySet<string>,
  hiddenOpacity: number,
) {
  const bridgeCells: Point[] = [];
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      if (grid[y]?.[x] && tileSurface(grid[y][x]) === Terrain.Bridge) {
        bridgeCells.push({ x, y });
      }
    }
  }
  if (!bridgeCells.length) return "";
  const bridgeSet = pointsToSet(bridgeCells);
  const axes = inferBridgeAxes(grid, bridgeCells);
  const plankLines: string[] = [];
  const lightEdges: string[] = [];
  const darkEdges: string[] = [];
  const underlay = (x: number, y: number) => {
    const terrain = baseTerrain[y]?.[x];
    return terrain === Terrain.Water || terrain === Terrain.Ravine ||
      terrain === Terrain.Lava || terrain === Terrain.Void;
  };

  for (const { x, y } of bridgeCells) {
    const left = x * cellSize;
    const top = y * cellSize;
    const right = left + cellSize;
    const bottom = top + cellSize;
    const axis = axes.get(pointKey(x, y)) ?? "horizontal";
    if (axis === "horizontal") {
      for (const ratio of [.22, .5, .78]) {
        plankLines.push(
          `M${format(left + cellSize * ratio)} ${format(top + cellSize * .08)}` +
          `V${format(bottom - cellSize * .08)}`,
        );
      }
      if (y > 0 && !bridgeSet.has(pointKey(x, y - 1)) && underlay(x, y - 1)) {
        lightEdges.push(`M${format(left)} ${format(top)}H${format(right)}`);
      }
      if (
        y < rows - 1 &&
        !bridgeSet.has(pointKey(x, y + 1)) &&
        underlay(x, y + 1)
      ) {
        darkEdges.push(`M${format(right)} ${format(bottom)}H${format(left)}`);
      }
    } else {
      for (const ratio of [.22, .5, .78]) {
        plankLines.push(
          `M${format(left + cellSize * .08)} ${format(top + cellSize * ratio)}` +
          `H${format(right - cellSize * .08)}`,
        );
      }
      if (x > 0 && !bridgeSet.has(pointKey(x - 1, y)) && underlay(x - 1, y)) {
        lightEdges.push(`M${format(left)} ${format(bottom)}V${format(top)}`);
      }
      if (
        x < columns - 1 &&
        !bridgeSet.has(pointKey(x + 1, y)) &&
        underlay(x + 1, y)
      ) {
        darkEdges.push(`M${format(right)} ${format(top)}V${format(bottom)}`);
      }
    }
  }

  const opacity = opacityFor(Terrain.Bridge, hiddenItems, hiddenOpacity);
  return `<g opacity="${format(opacity)}">` +
    `<path d="${cellPath(bridgeCells, cellSize)}" fill="url(#material-bridge)"/>` +
    `<path d="${plankLines.join("")}" fill="none" stroke="#4e3829" ` +
    `stroke-width="${format(Math.max(.8, cellSize * .025))}" opacity=".42"/>` +
    `<path d="${lightEdges.join("")}" fill="none" stroke="#f5e2bc" ` +
    `stroke-width="${format(Math.max(1.4, cellSize * .065))}" ` +
    `stroke-linecap="round" opacity=".58"/>` +
    `<path d="${darkEdges.join("")}" fill="none" stroke="#36271c" ` +
    `stroke-width="${format(Math.max(2, cellSize * .105))}" ` +
    `stroke-linecap="round" opacity=".74"/></g>`;
}

function roadSlopeOverlays(
  grid: Grid,
  cellSize: number,
  hiddenItems: ReadonlySet<string>,
  hiddenOpacity: number,
) {
  const output: string[] = [];
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      const tile = grid[y][x];
      if (tile.transition !== "slope" || tileSurface(tile) !== Terrain.Road) {
        continue;
      }
      const normalX = tile.transitionNormalX ?? 0;
      const normalY = tile.transitionNormalY ?? 0;
      const direction = Math.abs(normalX) >= Math.abs(normalY)
        ? normalX >= 0 ? "east" : "west"
        : normalY >= 0 ? "south" : "north";
      output.push(
        `<rect x="${format(x * cellSize)}" y="${format(y * cellSize)}" ` +
        `width="${format(cellSize)}" height="${format(cellSize)}" ` +
        `fill="url(#ramp-${direction})"/>`,
      );
    }
  }
  return output.length
    ? `<g opacity="${format(opacityFor(Terrain.Road, hiddenItems, hiddenOpacity))}">` +
      output.join("") + `</g>`
    : "";
}

function tileHeight(tile: Tile) {
  let height = (tile.height ?? .5) * .55;
  const surface = tileSurface(tile);
  if (surface === Terrain.Bridge) {
    height += .08;
  } else if (tile.terrain === Terrain.Cliff) {
    height += .38 + ((tile.elevation ?? 1) - 1) * .22;
  } else if (tile.terrain === Terrain.Ravine) {
    height -= .48;
  } else if (tile.terrain === Terrain.Water || tile.terrain === Terrain.Lava) {
    height -= .11;
  } else if (tile.terrain === Terrain.Void) {
    height -= .4;
  }
  return height;
}

function lightingLayer(
  grid: Grid,
  columns: number,
  rows: number,
  cellSize: number,
  hiddenItems: ReadonlySet<string>,
  hiddenOpacity: number,
) {
  const heights = grid.map((row) => row.map(tileHeight));
  type LightingGroup = { opacity: string; cells: number[] };
  const highlights = new Map<string, LightingGroup>();
  const shadows = new Map<string, LightingGroup>();
  const addPoint = (
    groups: Map<string, LightingGroup>,
    opacity: number,
    x: number,
    y: number,
  ) => {
    const formattedOpacity = format(opacity);
    if (formattedOpacity === "0") return;
    const group = groups.get(formattedOpacity) ?? {
      opacity: formattedOpacity,
      cells: [],
    };
    group.cells.push(y * columns + x);
    groups.set(formattedOpacity, group);
  };
  const lightLength = Math.hypot(-.62, -.76, .92);
  const lightX = -.62 / lightLength;
  const lightY = -.76 / lightLength;
  const lightZ = .92 / lightLength;

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const tile = grid[y]?.[x];
      if (!tile) continue;
      const center = heights[y][x];
      const left = heights[y]?.[x - 1] ?? center;
      const right = heights[y]?.[x + 1] ?? center;
      const top = heights[y - 1]?.[x] ?? center;
      const bottom = heights[y + 1]?.[x] ?? center;
      const dx = right - left;
      const dy = bottom - top;
      const normalLength = Math.hypot(-dx * 2.8, -dy * 2.8, 1);
      const diffuse = (-dx * 2.8 / normalLength) * lightX +
        (-dy * 2.8 / normalLength) * lightY +
        (1 / normalLength) * lightZ;
      const occlusion = (
        Math.max(0, left - center) +
        Math.max(0, right - center) +
        Math.max(0, top - center) +
        Math.max(0, bottom - center)
      ) / 4;
      const light = Math.max(0, diffuse - .66);
      const shadow = Math.max(0, .68 - diffuse) + occlusion * .8;
      const visibility = opacityFor(
        tileSurface(tile) ?? tile.terrain,
        hiddenItems,
        hiddenOpacity,
      );
      if (light > shadow * .55) {
        addPoint(
          highlights,
          Math.min(.22, light * .52) * visibility,
          x,
          y,
        );
      } else {
        addPoint(
          shadows,
          Math.min(.3, shadow * .56) * visibility,
          x,
          y,
        );
      }
    }
  }
  const groupPaths = (groups: ReadonlyMap<string, LightingGroup>, fill: string) => {
    const output: string[] = [];
    for (const { opacity, cells } of groups.values()) {
      output.push(
        `<path d="${indexedCellPath(cells, columns, cellSize)}" fill="${fill}" ` +
        `opacity="${opacity}"/>`,
      );
    }
    return output.join("");
  };
  return `<g>${groupPaths(highlights, "#fff0c8")}` +
    `${groupPaths(shadows, "#1c2929")}</g>`;
}

function buildingLayer(
  grid: Grid,
  columns: number,
  cellSize: number,
  mode: LandscapeMode,
  hiddenItems: ReadonlySet<string>,
  hiddenOpacity: number,
) {
  const groups = new Map<string, { id: number; points: Point[] }>();
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      const tile = grid[y][x];
      if (tile.obstacle !== Obstacle.Building) continue;
      const id = tile.obstacleId ?? y * columns + x;
      const key = tile.obstacleId === undefined ? `cell-${x}-${y}` : `id-${id}`;
      const group = groups.get(key) ?? { id, points: [] };
      group.points.push({ x, y });
      groups.set(key, group);
    }
  }
  if (!groups.size) return "";
  const colors = getBiomeObjectStyle(mode).building;
  const output: string[] = [];
  for (const { id, points } of groups.values()) {
    const cells = pointsToSet(points);
    const minimumX = Math.min(...points.map(({ x }) => x));
    const maximumX = Math.max(...points.map(({ x }) => x));
    const minimumY = Math.min(...points.map(({ y }) => y));
    const maximumY = Math.max(...points.map(({ y }) => y));
    const edge = sidePath(
      points,
      cells,
      columns,
      grid.length,
      cellSize,
      new Set<Side>(["top", "right", "bottom", "left"]),
      true,
    );
    const ridge = maximumX > minimumX
      ? `M${format(minimumX * cellSize + cellSize * .14)} ` +
        `${format((minimumY + maximumY + 1) * cellSize / 2)}` +
        `H${format((maximumX + 1) * cellSize - cellSize * .14)}`
      : maximumY > minimumY
        ? `M${format((minimumX + maximumX + 1) * cellSize / 2)} ` +
          `${format(minimumY * cellSize + cellSize * .14)}` +
          `V${format((maximumY + 1) * cellSize - cellSize * .14)}`
        : "";
    const chimneyX = (id % 2 === 0 ? maximumX + .68 : minimumX + .22) * cellSize;
    const chimneyY = (minimumY + .2) * cellSize;
    output.push(
      `<g filter="url(#building-shadow)">` +
      `<path d="${cellPath(points, cellSize)}" fill="url(#building-material)"/>` +
      `<path d="${edge}" fill="none" stroke="${colors.edge}" ` +
      `stroke-width="${format(Math.max(1.2, cellSize * .05))}" ` +
      `stroke-linejoin="round"/>` +
      (ridge
        ? `<path d="${ridge}" fill="none" stroke="#ffe2b9" ` +
          `stroke-width="${format(Math.max(.8, cellSize * .025))}" opacity=".28"/>`
        : "") +
      `<rect x="${format(chimneyX)}" y="${format(chimneyY)}" ` +
      `width="${format(cellSize * .1)}" height="${format(cellSize * .12)}" ` +
      `rx="${format(cellSize * .015)}" fill="${colors.edge}" opacity=".72"/>` +
      `</g>`,
    );
  }
  return `<g opacity="${format(
    opacityFor(Obstacle.Building, hiddenItems, hiddenOpacity),
  )}">${output.join("")}</g>`;
}

function gridLayer(columns: number, rows: number, cellSize: number) {
  const lines: string[] = [];
  for (let x = 1; x < columns; x += 1) {
    lines.push(`M${format(x * cellSize)} 0V${format(rows * cellSize)}`);
  }
  for (let y = 1; y < rows; y += 1) {
    lines.push(`M0 ${format(y * cellSize)}H${format(columns * cellSize)}`);
  }
  return `<path d="${lines.join("")}" fill="none" stroke="#efeada" ` +
    `stroke-width="1" opacity=".18"/>`;
}

/**
 * Render the generated map background as self-contained SVG markup.
 *
 * This renderer deliberately omits tree and rock props. Buildings remain part
 * of the background, while roads, bridges, relief and liquid materials are
 * rendered from the same grid and biome palette as the interactive canvas.
 */
export function renderMapSvg(
  grid: Grid,
  mode: LandscapeMode,
  options: SvgRenderOptions = {},
) {
  const rows = grid.length;
  const columns = grid.reduce((maximum, row) => Math.max(maximum, row.length), 0);
  const requestedCellSize = options.cellSize ?? 64;
  const cellSize = clamp(
    Number.isFinite(requestedCellSize) ? Math.round(requestedCellSize) : 64,
    4,
    256,
  );
  const width = Math.max(1, columns * cellSize);
  const height = Math.max(1, rows * cellSize);
  const useTileset = options.useTileset ?? false;
  const stylizedLighting = options.stylizedLighting ?? false;
  const showGrid = options.showGrid ?? false;
  const hiddenItems = options.hiddenItems ?? new Set<string>();
  const hiddenOpacity = clamp(options.hiddenOpacity ?? .14, 0, 1);

  const opening = `<svg xmlns="http://www.w3.org/2000/svg" ` +
    `width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" ` +
    `preserveAspectRatio="none" color-rendering="optimizeQuality" ` +
    `shape-rendering="${useTileset ? "crispEdges" : "geometricPrecision"}">`;
  const background = `<rect width="${width}" height="${height}" fill="${SVG_BACKGROUND}"/>`;
  if (!rows || !columns) return `${opening}${background}</svg>`;

  const baseTerrain = baseTerrainGrid(grid, columns);
  const groups = terrainGroups(baseTerrain);
  const terrainLayers: string[] = [];
  for (const terrain of terrainPaintOrder) {
    const points = groups.get(terrain) ?? [];
    if (!points.length) continue;
    terrainLayers.push(
      `<path d="${cellPath(points, cellSize)}" fill="url(#material-${terrain})" ` +
      `opacity="${format(opacityFor(terrain, hiddenItems, hiddenOpacity))}"/>`,
    );
  }

  const lavaPoints = groups.get(Terrain.Lava) ?? [];
  const lavaGlow = stylizedLighting && lavaPoints.length &&
      !hiddenItems.has(Terrain.Lava)
    ? `<path d="${cellPath(lavaPoints, cellSize)}" fill="#ff6e28" ` +
      `opacity=".18" filter="url(#lava-glow)"/>`
    : "";

  return opening +
    definitionBlock(mode, cellSize, useTileset, options.tilesetHref) +
    background +
    terrainLayers.join("") +
    `<rect width="${width}" height="${height}" fill="url(#paper-grain)" opacity=".2"/>` +
    materialDetails(
      groups,
      cellSize,
      useTileset,
      hiddenItems,
      hiddenOpacity,
    ) +
    terrainBoundaries(
      groups,
      columns,
      rows,
      cellSize,
      hiddenItems,
      hiddenOpacity,
      stylizedLighting,
    ) +
    slopeOverlays(grid, cellSize, hiddenItems, hiddenOpacity) +
    roadLayer(
      grid,
      mode,
      columns,
      rows,
      cellSize,
      hiddenItems,
      hiddenOpacity,
    ) +
    roadSlopeOverlays(grid, cellSize, hiddenItems, hiddenOpacity) +
    bridgeLayer(
      grid,
      baseTerrain,
      columns,
      rows,
      cellSize,
      hiddenItems,
      hiddenOpacity,
    ) +
    (stylizedLighting
      ? lavaGlow + lightingLayer(
        grid,
        columns,
        rows,
        cellSize,
        hiddenItems,
        hiddenOpacity,
      ) + `<rect width="${width}" height="${height}" fill="url(#vignette)"/>`
      : "") +
    buildingLayer(
      grid,
      columns,
      cellSize,
      mode,
      hiddenItems,
      hiddenOpacity,
    ) +
    (showGrid ? gridLayer(columns, rows, cellSize) : "") +
    `</svg>`;
}
