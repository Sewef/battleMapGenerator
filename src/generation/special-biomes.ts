import { Terrain, type Grid } from "../domain/map";
import type { Random } from "./types";

function paintCircle(
  grid: Grid,
  centerX: number,
  centerY: number,
  radius: number,
  terrain: typeof Terrain[keyof typeof Terrain],
) {
  for (let y = centerY - radius; y <= centerY + radius; y += 1) {
    for (let x = centerX - radius; x <= centerX + radius; x += 1) {
      if ((x - centerX) ** 2 + (y - centerY) ** 2 <= radius ** 2 + 1 && grid[y]?.[x]) {
        grid[y][x].terrain = terrain;
      }
    }
  }
}

export function generateFarmland(grid: Grid, random: Random, difficultWeight: number) {
  const height = grid.length;
  const width = grid[0].length;
  const lanesX = [0, Math.floor(width * (.42 + random() * .12)), width - 1];
  const lanesY = [0, Math.floor(height * (.44 + random() * .12)), height - 1];
  for (const x of lanesX) for (let y = 0; y < height; y += 1) grid[y][x].terrain = Terrain.Road;
  for (const y of lanesY) for (let x = 0; x < width; x += 1) grid[y][x].terrain = Terrain.Road;
  for (let by = 0; by < lanesY.length - 1; by += 1) {
    for (let bx = 0; bx < lanesX.length - 1; bx += 1) {
      if (random() > .35 + difficultWeight * .35) continue;
      for (let y = lanesY[by] + 2; y < lanesY[by + 1] - 1; y += 1) {
        for (let x = lanesX[bx] + 2; x < lanesX[bx + 1] - 1; x += 1) {
          if ((x + y) % 3 !== 0) grid[y][x].terrain = Terrain.Difficult;
        }
      }
    }
  }
}

export function generateBattlefield(grid: Grid, random: Random, difficultWeight: number) {
  const height = grid.length;
  const width = grid[0].length;
  const craters = Math.round((5 + random() * 5) * difficultWeight);
  for (let index = 0; index < craters; index += 1) {
    paintCircle(
      grid,
      2 + Math.floor(random() * (width - 4)),
      2 + Math.floor(random() * (height - 4)),
      1 + Math.floor(random() * 2),
      Terrain.Difficult,
    );
  }
  const trenchY = Math.floor(height * (.3 + random() * .4));
  for (let x = 0; x < width; x += 1) {
    const y = Math.max(1, Math.min(height - 2, trenchY + Math.round(Math.sin(x * .45) * 2)));
    grid[y][x].terrain = Terrain.Ravine;
  }
}

export function generateSewer(grid: Grid, random: Random, waterWeight: number) {
  const height = grid.length;
  const width = grid[0].length;
  for (const row of grid) for (const tile of row) tile.terrain = Terrain.Cliff;
  const centerX = Math.floor(width / 2);
  const centerY = Math.floor(height / 2);
  const corridorWidth = 2;
  for (let y = 0; y < height; y += 1) {
    for (let offset = -corridorWidth; offset <= corridorWidth; offset += 1) {
      if (grid[y]?.[centerX + offset]) grid[y][centerX + offset].terrain = Terrain.Ground;
    }
  }
  for (let x = 0; x < width; x += 1) {
    for (let offset = -corridorWidth; offset <= corridorWidth; offset += 1) {
      if (grid[centerY + offset]?.[x]) grid[centerY + offset][x].terrain = Terrain.Ground;
    }
  }
  for (const [x, y] of [
    [Math.floor(width * .25), centerY],
    [Math.floor(width * .75), centerY],
    [centerX, Math.floor(height * .25)],
    [centerX, Math.floor(height * .75)],
  ]) {
    paintCircle(grid, x, y, 3 + Math.floor(random() * 2), Terrain.Ground);
  }
  if (waterWeight > 0) {
    const horizontal = random() > .5;
    const thickness = Math.max(1, Math.round(waterWeight));
    if (horizontal) {
      for (let x = 0; x < width; x += 1) {
        for (let offset = 0; offset < thickness; offset += 1) {
          grid[centerY + offset][x].terrain = Terrain.Water;
        }
      }
    } else {
      for (let y = 0; y < height; y += 1) {
        for (let offset = 0; offset < thickness; offset += 1) {
          grid[y][centerX + offset].terrain = Terrain.Water;
        }
      }
    }
  }
}

export function generateAncientRuins(grid: Grid, random: Random) {
  const height = grid.length;
  const width = grid[0].length;
  const centerX = Math.floor(width / 2);
  const centerY = Math.floor(height / 2);
  for (let x = 0; x < width; x += 1) grid[centerY][x].terrain = Terrain.Road;
  for (let y = 0; y < height; y += 1) grid[y][centerX].terrain = Terrain.Road;
  paintCircle(grid, centerX, centerY, 3, Terrain.Ground);
  for (let index = 0; index < 5; index += 1) {
    paintCircle(
      grid,
      2 + Math.floor(random() * (width - 4)),
      2 + Math.floor(random() * (height - 4)),
      1 + Math.floor(random() * 2),
      Terrain.Difficult,
    );
  }
}
