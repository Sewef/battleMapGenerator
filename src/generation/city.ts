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

      const blockWidth = right - left + 1;
      const blockHeight = bottom - top + 1;
      let insetX = random() < .5 ? 0 : 1;
      let insetY = random() < .5 ? 0 : 1;
      const canSplitVertically = blockWidth >= 5;
      const canSplitHorizontally = blockHeight >= 5;
      const useVerticalAlley = canSplitVertically && (
        !canSplitHorizontally || blockWidth >= blockHeight || random() < .35
      );
      const useHorizontalAlley = canSplitHorizontally && (
        !canSplitVertically || blockHeight > blockWidth || random() < .35
      );
      const alleyX = useVerticalAlley ? Math.floor((left + right) / 2) : undefined;
      const alleyY = useHorizontalAlley ? Math.floor((top + bottom) / 2) : undefined;
      if (alleyX !== undefined && blockWidth <= 6) insetX = 0;
      if (alleyY !== undefined && blockHeight <= 6) insetY = 0;
      buildingId += 1;
      for (let y = top + insetY; y <= bottom - insetY; y += 1) {
        for (let x = left + insetX; x <= right - insetX; x += 1) {
          // Narrow alleys keep large blocks tactically traversable.
          const alley = x === alleyX || y === alleyY;
          if (alley) {
            setTileSurface(grid[y][x], Terrain.Road);
            continue;
          }
          grid[y][x].obstacle = Obstacle.Building;
          grid[y][x].obstacleId = buildingId;
        }
      }

      // Insets used to leave a one-cell lawn between an alley and the street,
      // producing several disconnected road components. Extend every alley
      // through that setback and clear the complete doorway strip.
      if (alleyX !== undefined) {
        for (let y = top - 1; y <= bottom + 1; y += 1) {
          const tile = grid[y]?.[alleyX];
          if (!tile) continue;
          tile.obstacle = Obstacle.None;
          delete tile.obstacleId;
          setTileSurface(tile, Terrain.Road);
        }
      }
      if (alleyY !== undefined) {
        for (let x = left - 1; x <= right + 1; x += 1) {
          const tile = grid[alleyY]?.[x];
          if (!tile) continue;
          tile.obstacle = Obstacle.None;
          delete tile.obstacleId;
          setTileSurface(tile, Terrain.Road);
        }
      }
    }
  }

  // An alley physically separates two buildings, so it must also separate
  // their IDs. Relabeling connected roof masses makes the requested city
  // density meaningful on compact maps and keeps rendering/fog grouping exact.
  const visited = new Set<string>();
  let normalizedBuildingId = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (grid[y][x].obstacle !== Obstacle.Building || visited.has(`${x},${y}`)) continue;
      normalizedBuildingId += 1;
      const queue = [{ x, y }];
      visited.add(`${x},${y}`);
      for (let index = 0; index < queue.length; index += 1) {
        const point = queue[index];
        const tile = grid[point.y][point.x];
        tile.obstacleId = normalizedBuildingId;
        for (const direction of [
          { x: 1, y: 0 }, { x: -1, y: 0 },
          { x: 0, y: 1 }, { x: 0, y: -1 },
        ]) {
          const next = { x: point.x + direction.x, y: point.y + direction.y };
          const key = `${next.x},${next.y}`;
          if (
            visited.has(key) ||
            grid[next.y]?.[next.x]?.obstacle !== Obstacle.Building
          ) {
            continue;
          }
          visited.add(key);
          queue.push(next);
        }
      }
    }
  }
}
