import {
  Terrain,
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
  } else if (tile.terrain === Terrain.Wall) {
    height += .5;
  } else if (tile.terrain === Terrain.Door) {
    height += .2;
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
  profile: LightingProfile,
  hiddenItems: ReadonlySet<string>,
  hiddenOpacity: number,
) {
  const rows = grid.length;
  const columns = grid[0].length;
  const heights = grid.map((row) => row.map(tileHeight));
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

export function drawStylizedLighting(
  grid: Grid,
  mode: LandscapeMode,
  cellSize: number,
  width: number,
  height: number,
  hiddenItems: ReadonlySet<string>,
  hiddenOpacity: number,
  context: CanvasRenderingContext2D,
) {
  const profile = lightingProfile(mode);
  const lightMap = createLightMap(
    grid,
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
