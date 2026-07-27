import { Obstacle, Terrain, setTileSurface, type Grid } from "../domain/map";
import type { Random } from "./types";

export function generateCity(
  grid: Grid,
  random: Random,
  buildingWeight: number,
  difficultWeight: number,
) {
  const height = grid.length;
  const width = grid[0].length;
  const verticalStreets = [0];
  const horizontalStreets = [0];

  for (let x = 6 + Math.floor(random() * 3); x < width - 3;) {
    verticalStreets.push(x);
    x += 7 + Math.floor(random() * 5);
  }
  for (let y = 5 + Math.floor(random() * 3); y < height - 3;) {
    horizontalStreets.push(y);
    y += 6 + Math.floor(random() * 4);
  }
  verticalStreets.push(width - 1);
  horizontalStreets.push(height - 1);

  for (const x of verticalStreets) {
    for (let y = 0; y < height; y += 1) {
      setTileSurface(grid[y][x], Terrain.Road);
    }
  }
  for (const y of horizontalStreets) {
    for (let x = 0; x < width; x += 1) {
      setTileSurface(grid[y][x], Terrain.Road);
    }
  }

  // A wider avenue gives the street network a readable hierarchy.
  const avenue = verticalStreets[Math.floor(verticalStreets.length / 2)];
  for (let y = 0; y < height; y += 1) {
    setTileSurface(grid[y][avenue], Terrain.Road);
    if (grid[y][avenue + 1]) {
      setTileSurface(grid[y][avenue + 1], Terrain.Road);
    }
  }

  let buildingId = 0;
  for (let row = 0; row < horizontalStreets.length - 1; row += 1) {
    for (let column = 0; column < verticalStreets.length - 1; column += 1) {
      const left = verticalStreets[column] + 1;
      const right = verticalStreets[column + 1] - 1;
      const top = horizontalStreets[row] + 1;
      const bottom = horizontalStreets[row + 1] - 1;
      if (right - left < 2 || bottom - top < 2) continue;

      // Some blocks become squares, markets, or rough vacant lots.
      if (random() > Math.min(.92, .42 + buildingWeight * .055)) {
        if (random() < difficultWeight * .55) {
          for (let y = top; y <= bottom; y += 1) {
            for (let x = left; x <= right; x += 1) {
              if (random() < .45) grid[y][x].terrain = Terrain.Difficult;
            }
          }
        }
        continue;
      }

      const insetX = random() < .5 ? 0 : 1;
      const insetY = random() < .5 ? 0 : 1;
      buildingId += 1;
      for (let y = top + insetY; y <= bottom - insetY; y += 1) {
        for (let x = left + insetX; x <= right - insetX; x += 1) {
          // Narrow alleys keep large blocks tactically traversable.
          const alley = (right - left > 7 && x === Math.floor((left + right) / 2)) ||
            (bottom - top > 6 && y === Math.floor((top + bottom) / 2));
          if (alley) {
            setTileSurface(grid[y][x], Terrain.Road);
            continue;
          }
          grid[y][x].obstacle = Obstacle.Building;
          grid[y][x].obstacleId = buildingId;
        }
      }
    }
  }
}
