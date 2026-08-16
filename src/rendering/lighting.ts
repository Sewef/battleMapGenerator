import {
  Obstacle,
  Terrain,
  isInteriorMode,
  tileSurface,
  type Grid,
  type LandscapeMode,
  type Tile,
} from "../domain/map";

type LightingProfile = {
  light: [number, number, number];
  shadow: [number, number, number];
  ambient: string;
  lava: string;
  water: string;
};

export type MapLightKind = "hearth" | "console" | "altar" | "lava";

export type MapLightSource = {
  kind: MapLightKind;
  x: number;
  y: number;
  interiorPropId?: number;
  attenuationRadius: number;
  sourceRadius: number;
  falloff: number;
  lightType: "SECONDARY";
  color: [number, number, number];
  intensity: number;
};

const lightSourceStyles: Record<
  MapLightKind,
  Omit<MapLightSource, "kind" | "x" | "y">
> = {
  hearth: {
    attenuationRadius: 4.25,
    sourceRadius: .22,
    falloff: .28,
    lightType: "SECONDARY",
    color: [255, 161, 78],
    intensity: .48,
  },
  console: {
    attenuationRadius: 2.4,
    sourceRadius: .12,
    falloff: .42,
    lightType: "SECONDARY",
    color: [100, 212, 232],
    intensity: .24,
  },
  altar: {
    attenuationRadius: 2.8,
    sourceRadius: .14,
    falloff: .36,
    lightType: "SECONDARY",
    color: [255, 204, 128],
    intensity: .25,
  },
  lava: {
    attenuationRadius: 4.6,
    sourceRadius: .45,
    falloff: .24,
    lightType: "SECONDARY",
    color: [255, 105, 38],
    intensity: .34,
  },
};

function mapLightSource(
  kind: MapLightKind,
  x: number,
  y: number,
  interiorPropId?: number,
): MapLightSource {
  return { kind, x, y, interiorPropId, ...lightSourceStyles[kind] };
}

function spreadLavaSources(points: Array<{ x: number; y: number }>) {
  const sourceCount = Math.min(6, Math.max(1, Math.ceil(points.length / 18)));
  const centerX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const centerY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  const selected = [[...points].sort((first, second) => {
    const firstDistance = (first.x - centerX) ** 2 + (first.y - centerY) ** 2;
    const secondDistance = (second.x - centerX) ** 2 + (second.y - centerY) ** 2;
    return firstDistance - secondDistance || first.y - second.y || first.x - second.x;
  })[0]];
  while (selected.length < sourceCount) {
    const next = [...points].sort((first, second) => {
      const nearestDistance = (point: { x: number; y: number }) =>
        Math.min(...selected.map((source) =>
          (point.x - source.x) ** 2 + (point.y - source.y) ** 2));
      return nearestDistance(second) - nearestDistance(first) ||
        first.y - second.y || first.x - second.x;
    })[0];
    if (selected.some((point) => point.x === next.x && point.y === next.y)) break;
    selected.push(next);
  }
  return selected;
}

export function collectMapLightSources(grid: Grid): MapLightSource[] {
  if (!grid.length || !grid[0].length) return [];
  const propKinds = new Set<MapLightKind>(["hearth", "console", "altar"]);
  const propGroups = new Map<
    string,
    {
      kind: MapLightKind;
      points: Array<{ x: number; y: number }>;
      facing?: Tile["propFacing"];
      interiorPropId?: number;
    }
  >();
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      const tile = grid[y][x];
      if (!tile.interiorProp || !propKinds.has(tile.interiorProp as MapLightKind)) continue;
      const kind = tile.interiorProp as MapLightKind;
      const key = `${kind}:${tile.interiorPropId ?? `${x},${y}`}`;
      const group = propGroups.get(key) ?? {
        kind,
        points: [],
        facing: tile.propFacing,
        interiorPropId: tile.interiorPropId,
      };
      group.points.push({ x, y });
      propGroups.set(key, group);
    }
  }

  const sources = [...propGroups.values()].map(({
    kind, points, facing, interiorPropId,
  }) => {
    let x = points.reduce((sum, point) => sum + point.x + .5, 0) / points.length;
    let y = points.reduce((sum, point) => sum + point.y + .5, 0) / points.length;
    if (kind === "hearth") {
      const offset = .28;
      if (facing === "north") y -= offset;
      else if (facing === "east") x += offset;
      else if (facing === "south") y += offset;
      else if (facing === "west") x -= offset;
    }
    return mapLightSource(kind, x, y, interiorPropId);
  });

  const visited = new Set<string>();
  const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      const startKey = `${x},${y}`;
      if (grid[y][x].terrain !== Terrain.Lava || visited.has(startKey)) continue;
      const component: Array<{ x: number; y: number }> = [];
      const queue = [{ x, y }];
      visited.add(startKey);
      for (let index = 0; index < queue.length; index += 1) {
        const point = queue[index];
        component.push(point);
        for (const [offsetX, offsetY] of directions) {
          const next = { x: point.x + offsetX, y: point.y + offsetY };
          const key = `${next.x},${next.y}`;
          if (visited.has(key) || grid[next.y]?.[next.x]?.terrain !== Terrain.Lava) continue;
          visited.add(key);
          queue.push(next);
        }
      }
      for (const point of spreadLavaSources(component)) {
        sources.push(mapLightSource("lava", point.x + .5, point.y + .5));
      }
    }
  }
  return sources;
}

const warmModes = new Set<LandscapeMode>([
  "desert-canyon",
  "badlands",
  "ruined-battlefield",
  "volcanic",
  "ship",
  "ship-deck",
  "tavern",
  "cathedral",
]);
const coldModes = new Set<LandscapeMode>([
  "frozen-lake",
  "highlands",
  "mountain-pass",
  "spaceship",
  "castle",
]);
const darkModes = new Set<LandscapeMode>([
  "underground",
  "sewer",
  "ancient-ruins",
  "crypt",
]);

function lightingProfile(mode: LandscapeMode): LightingProfile {
  if (mode === "volcanic") {
    return {
      light: [255, 181, 116],
      shadow: [35, 25, 31],
      ambient: "rgba(124, 54, 36, .055)",
      lava: "rgba(255, 103, 35, .72)",
      water: "rgba(104, 174, 181, .16)",
    };
  }
  if (warmModes.has(mode)) {
    return {
      light: [255, 215, 154],
      shadow: [52, 39, 43],
      ambient: "rgba(170, 102, 65, .045)",
      lava: "rgba(255, 116, 43, .62)",
      water: "rgba(94, 166, 172, .14)",
    };
  }
  if (coldModes.has(mode)) {
    return {
      light: [213, 238, 241],
      shadow: [31, 46, 58],
      ambient: "rgba(104, 153, 167, .045)",
      lava: "rgba(255, 126, 52, .58)",
      water: "rgba(151, 221, 232, .22)",
    };
  }
  if (darkModes.has(mode)) {
    return {
      light: [194, 205, 177],
      shadow: [20, 27, 29],
      ambient: "rgba(43, 64, 56, .075)",
      lava: "rgba(255, 106, 32, .76)",
      water: "rgba(79, 139, 145, .13)",
    };
  }
  return {
    light: [238, 226, 179],
    shadow: [35, 48, 47],
    ambient: "rgba(96, 123, 91, .035)",
    lava: "rgba(255, 118, 40, .62)",
    water: "rgba(116, 190, 196, .16)",
  };
}

function tileHeight(tile: Tile, interiorMode: boolean) {
  let height = (tile.height ?? .5) * .32;
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
  } else if (tile.terrain === Terrain.Wall && !interiorMode) {
    height += .5;
  } else if (tile.terrain === Terrain.Door && !interiorMode) {
    height += .2;
  }
  if (tile.obstacle === Obstacle.Tree) {
    height += .22;
  } else if (tile.obstacle === Obstacle.Rock) {
    height += .1;
  } else if (tile.obstacle === Obstacle.Building) {
    height += .38;
  }
  return height;
}

function tileVisibility(
  tile: Tile,
  hiddenItems: ReadonlySet<string>,
  hiddenOpacity: number,
) {
  const surface = tileSurface(tile);
  if (surface && !hiddenItems.has(surface)) return 1;
  return hiddenItems.has(tile.terrain) ? hiddenOpacity : 1;
}

function createLightMap(
  grid: Grid,
  mode: LandscapeMode,
  profile: LightingProfile,
  hiddenItems: ReadonlySet<string>,
  hiddenOpacity: number,
) {
  const rows = grid.length;
  const columns = grid[0].length;
  const interiorMode = isInteriorMode(mode);
  const heights = grid.map((row) => row.map((tile) =>
    tileHeight(tile, interiorMode)));
  const visibility = grid.map((row) =>
    row.map((tile) => tileVisibility(tile, hiddenItems, hiddenOpacity))
  );
  const canvas = document.createElement("canvas");
  canvas.width = columns;
  canvas.height = rows;
  const context = canvas.getContext("2d")!;
  const image = context.createImageData(columns, rows);
  const lightLength = Math.hypot(-.62, -.76, .92);
  const lightX = -.62 / lightLength;
  const lightY = -.76 / lightLength;
  const lightZ = .92 / lightLength;

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const center = heights[y][x];
      const sampleHeight = (sampleX: number, sampleY: number) => {
        const safeY = Math.max(0, Math.min(rows - 1, sampleY));
        const safeX = Math.max(0, Math.min(columns - 1, sampleX));
        return visibility[safeY][safeX] < .5 ? center : heights[safeY][safeX];
      };
      const dx = sampleHeight(x + 1, y) - sampleHeight(x - 1, y);
      const dy = sampleHeight(x, y + 1) - sampleHeight(x, y - 1);
      const normalLength = Math.hypot(-dx * 2.8, -dy * 2.8, 1);
      const normalX = -dx * 2.8 / normalLength;
      const normalY = -dy * 2.8 / normalLength;
      const normalZ = 1 / normalLength;
      const diffuse = normalX * lightX + normalY * lightY + normalZ * lightZ;
      const neighbors = [
        sampleHeight(x - 1, y),
        sampleHeight(x + 1, y),
        sampleHeight(x, y - 1),
        sampleHeight(x, y + 1),
      ];
      const occlusion = neighbors.reduce(
        (sum, neighbor) => sum + Math.max(0, neighbor - center),
        0,
      ) / neighbors.length;
      const lightAmount = Math.max(0, diffuse - .66);
      const shadowAmount = Math.max(0, .68 - diffuse) + occlusion * .8;
      const lit = lightAmount > shadowAmount * .55;
      const color = lit ? profile.light : profile.shadow;
      const alpha = lit
        ? Math.min(.22, lightAmount * .52)
        : Math.min(.3, shadowAmount * .56);
      const offset = (y * columns + x) * 4;
      image.data[offset] = color[0];
      image.data[offset + 1] = color[1];
      image.data[offset + 2] = color[2];
      image.data[offset + 3] = Math.round(
        alpha * visibility[y][x] * 255,
      );
    }
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

function createTerrainEmissionMap(
  grid: Grid,
  terrain: typeof Terrain.Lava,
  color: string,
  hiddenItems: ReadonlySet<string>,
  hiddenOpacity: number,
) {
  const canvas = document.createElement("canvas");
  canvas.width = grid[0].length;
  canvas.height = grid.length;
  const context = canvas.getContext("2d")!;
  context.fillStyle = color;
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      if (grid[y][x].terrain !== terrain) continue;
      context.globalAlpha = hiddenItems.has(terrain) ? hiddenOpacity : 1;
      context.fillRect(x, y, 1, 1);
    }
  }
  context.globalAlpha = 1;
  return canvas;
}

function createLiquidSpecularMap(
  grid: Grid,
  color: string,
  hiddenItems: ReadonlySet<string>,
  hiddenOpacity: number,
) {
  const resolution = 4;
  const canvas = document.createElement("canvas");
  canvas.width = grid[0].length * resolution;
  canvas.height = grid.length * resolution;
  const context = canvas.getContext("2d")!;
  context.strokeStyle = color;
  context.lineWidth = .72;
  context.lineCap = "round";
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      const tile = grid[y][x];
      if (
        (tile.terrain !== Terrain.Water && tile.terrain !== Terrain.Ice) ||
        tileSurface(tile) === Terrain.Bridge
      ) {
        continue;
      }
      context.globalAlpha = hiddenItems.has(tile.terrain) ? hiddenOpacity : 1;
      const offset = ((x * 17 + y * 29) % 5) * .12;
      const left = x * resolution;
      const top = y * resolution;
      context.beginPath();
      context.moveTo(left + .35, top + 1.25 + offset);
      context.lineTo(left + 3.55, top + .55 + offset);
      context.stroke();
    }
  }
  context.globalAlpha = 1;
  return canvas;
}

function blocksLocalLight(tile: Tile) {
  return tile.terrain === Terrain.Wall ||
    tile.terrain === Terrain.Cliff ||
    tile.terrain === Terrain.Void ||
    tile.obstacle === Obstacle.Building;
}

function hasDirectLightLine(
  grid: Grid,
  source: MapLightSource,
  targetX: number,
  targetY: number,
) {
  const destinationX = targetX + .5;
  const destinationY = targetY + .5;
  const deltaX = destinationX - source.x;
  const deltaY = destinationY - source.y;
  const steps = Math.max(1, Math.ceil(Math.hypot(deltaX, deltaY) * 10));
  let previousX = Math.floor(source.x);
  let previousY = Math.floor(source.y);
  for (let step = 1; step <= steps; step += 1) {
    const ratio = step / steps;
    const cellX = Math.floor(source.x + deltaX * ratio);
    const cellY = Math.floor(source.y + deltaY * ratio);
    if (cellX === previousX && cellY === previousY) continue;

    // Do not let a diagonal ray squeeze through the meeting point of two
    // opaque walls. A single blocked side still leaves a valid open corner.
    if (cellX !== previousX && cellY !== previousY) {
      const horizontalSide = grid[previousY]?.[cellX];
      const verticalSide = grid[cellY]?.[previousX];
      if (
        horizontalSide && verticalSide &&
        blocksLocalLight(horizontalSide) && blocksLocalLight(verticalSide)
      ) {
        return false;
      }
    }

    if (cellX === targetX && cellY === targetY) return true;
    const tile = grid[cellY]?.[cellX];
    if (!tile || blocksLocalLight(tile)) return false;
    previousX = cellX;
    previousY = cellY;
  }
  return true;
}

function reachableLightCells(grid: Grid, source: MapLightSource) {
  const reached: Array<{ x: number; y: number }> = [];
  const minimumX = Math.max(0, Math.floor(source.x - source.attenuationRadius - 1));
  const maximumX = Math.min(
    grid[0].length - 1,
    Math.ceil(source.x + source.attenuationRadius),
  );
  const minimumY = Math.max(0, Math.floor(source.y - source.attenuationRadius - 1));
  const maximumY = Math.min(
    grid.length - 1,
    Math.ceil(source.y + source.attenuationRadius),
  );
  for (let y = minimumY; y <= maximumY; y += 1) {
    for (let x = minimumX; x <= maximumX; x += 1) {
      const distance = Math.hypot(x + .5 - source.x, y + .5 - source.y);
      if (distance > source.attenuationRadius + .5) continue;
      if (hasDirectLightLine(grid, source, x, y)) reached.push({ x, y });
    }
  }
  return reached;
}

function drawLocalLightSources(
  grid: Grid,
  cellSize: number,
  hiddenItems: ReadonlySet<string>,
  hiddenOpacity: number,
  context: CanvasRenderingContext2D,
  includeInteriorPropLights: boolean,
) {
  for (const source of collectMapLightSources(grid)) {
    if (!includeInteriorPropLights && source.interiorPropId !== undefined) continue;
    const sourceTile = grid[Math.floor(source.y)]?.[Math.floor(source.x)];
    if (!sourceTile || tileVisibility(sourceTile, hiddenItems, hiddenOpacity) <= 0) continue;
    const [red, green, blue] = source.color;
    const centerX = source.x * cellSize;
    const centerY = source.y * cellSize;
    const radius = source.attenuationRadius * cellSize;
    const coreRadius = Math.max(1, source.sourceRadius * cellSize);
    const mapWidth = grid[0].length * cellSize;
    const mapHeight = grid.length * cellSize;
    const layerLeft = Math.max(0, Math.floor(centerX - radius - cellSize));
    const layerTop = Math.max(0, Math.floor(centerY - radius - cellSize));
    const layerRight = Math.min(mapWidth, Math.ceil(centerX + radius + cellSize));
    const layerBottom = Math.min(mapHeight, Math.ceil(centerY + radius + cellSize));
    const layerWidth = layerRight - layerLeft;
    const layerHeight = layerBottom - layerTop;
    const hardMask = document.createElement("canvas");
    hardMask.width = layerWidth;
    hardMask.height = layerHeight;
    const hardContext = hardMask.getContext("2d")!;
    hardContext.fillStyle = "#fff";
    hardContext.beginPath();
    for (const point of reachableLightCells(grid, source)) {
      const tile = grid[point.y][point.x];
      if (tileVisibility(tile, hiddenItems, hiddenOpacity) <= 0) continue;
      const left = point.x * cellSize - layerLeft;
      const top = point.y * cellSize - layerTop;
      if (blocksLocalLight(tile)) {
        const deltaX = point.x + .5 - source.x;
        const deltaY = point.y + .5 - source.y;
        if (Math.abs(deltaX) > Math.abs(deltaY)) {
          hardContext.rect(
            deltaX > 0 ? left : left + cellSize * .5,
            top,
            cellSize * .5,
            cellSize,
          );
        } else {
          hardContext.rect(
            left,
            deltaY > 0 ? top : top + cellSize * .5,
            cellSize,
            cellSize * .5,
          );
        }
      } else {
        hardContext.rect(left, top, cellSize, cellSize);
      }
    }
    hardContext.fill();

    // Blur the visibility mask, then intersect it with its hard version. The
    // falloff therefore happens only on the lit side: it softens corners and
    // stair-steps without bleeding through an opaque wall.
    const softMask = document.createElement("canvas");
    softMask.width = layerWidth;
    softMask.height = layerHeight;
    const softContext = softMask.getContext("2d")!;
    softContext.filter = `blur(${Math.max(2, cellSize * .24)}px)`;
    softContext.drawImage(hardMask, 0, 0);
    softContext.filter = "none";
    softContext.globalCompositeOperation = "destination-in";
    softContext.drawImage(hardMask, 0, 0);

    const lightLayer = document.createElement("canvas");
    lightLayer.width = layerWidth;
    lightLayer.height = layerHeight;
    const lightContext = lightLayer.getContext("2d")!;
    const localCenterX = centerX - layerLeft;
    const localCenterY = centerY - layerTop;
    const gradient = lightContext.createRadialGradient(
      localCenterX,
      localCenterY,
      coreRadius,
      localCenterX,
      localCenterY,
      radius,
    );
    gradient.addColorStop(0, `rgba(${red}, ${green}, ${blue}, ${source.intensity})`);
    gradient.addColorStop(
      Math.min(.72, Math.max(.18, source.falloff)),
      `rgba(${red}, ${green}, ${blue}, ${source.intensity * .58})`,
    );
    gradient.addColorStop(1, `rgba(${red}, ${green}, ${blue}, 0)`);

    lightContext.fillStyle = gradient;
    lightContext.fillRect(
      localCenterX - radius,
      localCenterY - radius,
      radius * 2,
      radius * 2,
    );
    lightContext.globalCompositeOperation = "destination-in";
    lightContext.drawImage(softMask, 0, 0);

    context.save();
    context.globalCompositeOperation = "screen";
    context.drawImage(lightLayer, layerLeft, layerTop);
    context.restore();
  }
}

export function drawStylizedLighting(
  grid: Grid,
  mode: LandscapeMode,
  cellSize: number,
  width: number,
  height: number,
  hiddenItems: ReadonlySet<string>,
  hiddenOpacity: number,
  context: CanvasRenderingContext2D,
  includeInteriorPropLights = true,
) {
  const profile = lightingProfile(mode);
  const lightMap = createLightMap(
    grid,
    mode,
    profile,
    hiddenItems,
    hiddenOpacity,
  );

  context.save();
  context.beginPath();
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      if (tileVisibility(grid[y][x], hiddenItems, hiddenOpacity) <= 0) continue;
      context.rect(x * cellSize, y * cellSize, cellSize, cellSize);
    }
  }
  context.clip();

  context.save();
  context.imageSmoothingEnabled = true;
  context.globalCompositeOperation = "source-over";
  context.drawImage(lightMap, 0, 0, width, height);
  context.fillStyle = profile.ambient;
  context.fillRect(0, 0, width, height);
  context.restore();

  const lava = createTerrainEmissionMap(
    grid,
    Terrain.Lava,
    profile.lava,
    hiddenItems,
    hiddenOpacity,
  );
  const liquidSpecular = createLiquidSpecularMap(
    grid,
    profile.water,
    hiddenItems,
    hiddenOpacity,
  );
  context.save();
  context.imageSmoothingEnabled = true;
  context.globalCompositeOperation = "screen";
  context.filter = `blur(${Math.max(2, cellSize * .28)}px)`;
  context.globalAlpha = .42;
  context.drawImage(lava, 0, 0, width, height);
  context.filter = `blur(${Math.max(.8, cellSize * .045)}px)`;
  context.globalAlpha = .28;
  context.drawImage(liquidSpecular, 0, 0, width, height);
  context.filter = "none";
  context.restore();

  drawLocalLightSources(
    grid,
    cellSize,
    hiddenItems,
    hiddenOpacity,
    context,
    includeInteriorPropLights,
  );

  const vignette = context.createRadialGradient(
    width * .5,
    height * .47,
    Math.min(width, height) * .18,
    width * .5,
    height * .5,
    Math.max(width, height) * .72,
  );
  vignette.addColorStop(0, "rgba(20, 28, 27, 0)");
  vignette.addColorStop(1, "rgba(19, 24, 24, .12)");
  context.save();
  context.fillStyle = vignette;
  context.fillRect(0, 0, width, height);
  context.restore();
  context.restore();
}
