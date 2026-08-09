import { Terrain, setTileSurface, type Grid } from "../domain/map";
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
  const laneX = Math.floor(width * (.38 + random() * .24));
  const laneY = Math.floor(height * (.38 + random() * .24));
  const laneWidth = random() < .3 ? 2 : 1;

  // A through-road and a crossing farm lane guarantee access from every edge
  // without wrapping every field in an implausible paved border.
  for (let offset = 0; offset < laneWidth; offset += 1) {
    const x = Math.min(width - 1, laneX + offset);
    for (let y = 0; y < height; y += 1) {
      setTileSurface(grid[y][x], Terrain.Road);
    }
  }
  for (let offset = 0; offset < laneWidth; offset += 1) {
    const y = Math.min(height - 1, laneY + offset);
    for (let x = 0; x < width; x += 1) {
      setTileSurface(grid[y][x], Terrain.Road);
    }
  }

  const plots = [
    { left: 1, right: laneX - 1, top: 1, bottom: laneY - 1 },
    { left: laneX + laneWidth, right: width - 2, top: 1, bottom: laneY - 1 },
    { left: 1, right: laneX - 1, top: laneY + laneWidth, bottom: height - 2 },
    {
      left: laneX + laneWidth,
      right: width - 2,
      top: laneY + laneWidth,
      bottom: height - 2,
    },
  ];
  for (const plot of plots) {
    if (plot.right < plot.left || plot.bottom < plot.top) continue;
    const horizontalRows = random() < .5;
    const rowWidth = random() < .35 ? 2 : 1;
    const gap = 1 + Math.floor(random() * 2);
    const phase = Math.floor(random() * (rowWidth + gap));
    for (let y = plot.top; y <= plot.bottom; y += 1) {
      for (let x = plot.left; x <= plot.right; x += 1) {
        const across = horizontalRows ? y - plot.top : x - plot.left;
        const inCropRow = (across + phase) % (rowWidth + gap) < rowWidth;
        if (inCropRow && random() < Math.min(1, .88 + difficultWeight * .12)) {
          grid[y][x].terrain = Terrain.Difficult;
        }
      }
    }
  }

  // Some maps gain a short service track into one field, which breaks up the
  // otherwise identical four-quadrant silhouette while remaining connected.
  if (random() < .65) {
    const toRight = random() < .5;
    const spurY = Math.max(2, Math.min(height - 3,
      laneY + (random() < .5 ? -1 : 1) * (3 + Math.floor(random() * 4))));
    const start = toRight ? laneX : 0;
    const end = toRight ? Math.min(width - 2, laneX + 5 + Math.floor(random() * 5)) : laneX;
    for (let x = start; x <= end; x += 1) {
      setTileSurface(grid[spurY][x], Terrain.Road);
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
  const horizontal = random() < .5;
  const crossSize = horizontal ? height : width;
  const longSize = horizontal ? width : height;
  const mainAcross = Math.floor(crossSize * (.38 + random() * .24));
  // Five cells leave a usable walkway on both sides of the open channel and
  // keep every arm tactically meaningful even when the junction is offset.
  const corridorRadius = 2;
  const carve = (along: number, across: number) => {
    const x = horizontal ? along : across;
    const y = horizontal ? across : along;
    if (grid[y]?.[x]) grid[y][x].terrain = Terrain.Ground;
  };
  for (let along = 0; along < longSize; along += 1) {
    for (let offset = -corridorRadius; offset <= corridorRadius; offset += 1) {
      carve(along, mainAcross + offset);
    }
  }

  const crossCount = random() < .45 ? 2 : 1;
  const crossPositions = crossCount === 2
    ? [Math.floor(longSize * (.27 + random() * .08)), Math.floor(longSize * (.65 + random() * .08))]
    : [Math.floor(longSize / 2)];
  const crossRadius = crossCount === 1 ? 3 : corridorRadius;
  for (const along of crossPositions) {
    for (let across = 0; across < crossSize; across += 1) {
      for (let offset = -crossRadius; offset <= crossRadius; offset += 1) {
        carve(along + offset, across);
      }
    }
    for (const chamberAcross of [
      Math.floor(crossSize * (.22 + random() * .07)),
      Math.floor(crossSize * (.71 + random() * .07)),
    ]) {
      const chamberX = horizontal ? along : chamberAcross;
      const chamberY = horizontal ? chamberAcross : along;
      paintCircle(grid, chamberX, chamberY, 3 + Math.floor(random() * 2), Terrain.Ground);
    }
  }

  // A blind maintenance branch and terminal chamber make the network read as
  // infrastructure rather than four identical cave mouths.
  const branchAlong = Math.floor(longSize * (.2 + random() * .6));
  const branchDirection = random() < .5 ? -1 : 1;
  const branchEnd = Math.max(3, Math.min(crossSize - 4,
    mainAcross + branchDirection * (5 + Math.floor(random() * crossSize * .2))));
  const branchStart = Math.min(mainAcross, branchEnd);
  const branchStop = Math.max(mainAcross, branchEnd);
  for (let across = branchStart; across <= branchStop; across += 1) {
    for (let offset = -1; offset <= 1; offset += 1) carve(branchAlong + offset, across);
  }
  paintCircle(
    grid,
    horizontal ? branchAlong : branchEnd,
    horizontal ? branchEnd : branchAlong,
    3,
    Terrain.Ground,
  );

  if (waterWeight > 0) {
    const thickness = Math.max(1, Math.round(waterWeight));
    const waterOffset = corridorRadius > 1 && random() < .5 ? -1 : 0;
    for (let along = 0; along < longSize; along += 1) {
      for (let offset = 0; offset < thickness; offset += 1) {
        const across = mainAcross + waterOffset + offset;
        const x = horizontal ? along : across;
        const y = horizontal ? across : along;
        if (grid[y]?.[x]) grid[y][x].terrain = Terrain.Water;
      }
    }
  }
}

export function generateAncientRuins(grid: Grid, random: Random) {
  const height = grid.length;
  const width = grid[0].length;
  const centerX = Math.floor(width / 2);
  const centerY = Math.floor(height / 2);
  for (let x = 0; x < width; x += 1) {
    setTileSurface(grid[centerY][x], Terrain.Road);
  }
  for (let y = 0; y < height; y += 1) {
    setTileSurface(grid[y][centerX], Terrain.Road);
  }
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
