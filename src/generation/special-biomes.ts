import { Terrain, setTileSurface, tileSurface, type Grid } from "../domain/map";
import type { Point, Random } from "./types";

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

const cardinalDirections = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

function clampCell(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

function shuffled<T>(values: readonly T[], random: Random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

function orthogonalPath(anchors: readonly Point[]) {
  const path: Point[] = [];
  const seen = new Set<string>();
  const append = (point: Point) => {
    const key = `${point.x},${point.y}`;
    if (seen.has(key)) return;
    seen.add(key);
    path.push(point);
  };
  for (let index = 1; index < anchors.length; index += 1) {
    const from = anchors[index - 1];
    const to = anchors[index];
    if (from.x !== to.x && from.y !== to.y) {
      throw new Error("Orthogonal paths require axis-aligned anchors");
    }
    const stepX = Math.sign(to.x - from.x);
    const stepY = Math.sign(to.y - from.y);
    const distance = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
    for (let step = 0; step <= distance; step += 1) {
      append({ x: from.x + stepX * step, y: from.y + stepY * step });
    }
  }
  if (anchors.length === 1) append(anchors[0]);
  return path;
}

function carveCorridor(grid: Grid, path: readonly Point[], radius: number) {
  for (const point of path) {
    for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
      for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
        const tile = grid[point.y + offsetY]?.[point.x + offsetX];
        if (tile) tile.terrain = Terrain.Ground;
      }
    }
  }
}

type FarmEdge = "north" | "east" | "south" | "west";

export function generateFarmland(
  grid: Grid,
  random: Random,
  difficultWeight: number,
  waterWeight = 0,
) {
  const height = grid.length;
  const width = grid[0].length;
  const hub = {
    x: clampCell(width * (.42 + random() * .16), 3, width - 4),
    y: clampCell(height * (.42 + random() * .16), 3, height - 4),
  };
  const exitCount = 2 + Math.floor(random() * 3);
  const selectedEdges = shuffled<FarmEdge>(
    ["north", "east", "south", "west"],
    random,
  ).slice(0, exitCount);
  const swapHorizontal = random() < .5;
  const swapVertical = random() < .5;
  const edgePoints: Record<FarmEdge, Point> = {
    west: {
      x: 0,
      y: clampCell(height * (swapHorizontal ? .27 : .72), 2, height - 3),
    },
    east: {
      x: width - 1,
      y: clampCell(height * (swapHorizontal ? .72 : .27), 2, height - 3),
    },
    north: {
      x: clampCell(width * (swapVertical ? .3 : .7), 2, width - 3),
      y: 0,
    },
    south: {
      x: clampCell(width * (swapVertical ? .7 : .3), 2, width - 3),
      y: height - 1,
    },
  };
  const roadPaths: Point[][] = [];
  for (const edge of selectedEdges) {
    const exit = edgePoints[edge];
    const horizontalEdge = edge === "west" || edge === "east";
    const side = edge === "west" || edge === "north" ? -1 : 1;
    const elbow = horizontalEdge
      ? {
          x: clampCell(
            hub.x + side * (2 + random() * Math.max(2, width * .1)),
            2,
            width - 3,
          ),
          y: exit.y,
        }
      : {
          x: exit.x,
          y: clampCell(
            hub.y + side * (2 + random() * Math.max(2, height * .1)),
            2,
            height - 3,
          ),
        };
    const path = horizontalEdge
      ? orthogonalPath([exit, elbow, { x: elbow.x, y: hub.y }, hub])
      : orthogonalPath([exit, elbow, { x: hub.x, y: elbow.y }, hub]);
    roadPaths.push(path);
    for (const point of path) setTileSurface(grid[point.y][point.x], Terrain.Road);
  }

  const plots = [
    { left: 1, right: hub.x - 2, top: 1, bottom: hub.y - 2 },
    { left: hub.x + 2, right: width - 2, top: 1, bottom: hub.y - 2 },
    { left: 1, right: hub.x - 2, top: hub.y + 2, bottom: height - 2 },
    {
      left: hub.x + 2,
      right: width - 2,
      top: hub.y + 2,
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
        if (tileSurface(grid[y][x])) continue;
        const across = horizontalRows ? y - plot.top : x - plot.left;
        const inCropRow = (across + phase) % (rowWidth + gap) < rowWidth;
        if (inCropRow && random() < Math.min(.98, .7 + difficultWeight * .2)) {
          grid[y][x].terrain = Terrain.Difficult;
        }
      }
    }
  }

  // The drainage ditch crosses the fields and drains beyond both map edges.
  // Where it meets a lane, the lane survives as a small bridge/culvert rather
  // than becoming a movement barrier.
  if (waterWeight > .05) {
    const roadCells = roadPaths.flat().filter(({ x, y }) =>
      x >= 3 && y >= 3 && x < width - 3 && y < height - 3
    );
    const crossing = roadCells[Math.floor(random() * roadCells.length)] ?? hub;
    const verticalRoadNeighbors = Number(
      tileSurface(grid[crossing.y - 1]?.[crossing.x]) === Terrain.Road,
    ) + Number(
      tileSurface(grid[crossing.y + 1]?.[crossing.x]) === Terrain.Road,
    );
    const horizontalRoadNeighbors = Number(
      tileSurface(grid[crossing.y]?.[crossing.x - 1]) === Terrain.Road,
    ) + Number(
      tileSurface(grid[crossing.y]?.[crossing.x + 1]) === Terrain.Road,
    );
    const horizontalDitch = verticalRoadNeighbors > horizontalRoadNeighbors ||
      (verticalRoadNeighbors === horizontalRoadNeighbors && random() < .5);
    const frequency = .38 + random() * .18;
    const amplitude = Math.max(1, Math.min(2,
      Math.floor((horizontalDitch ? height : width) * .1)));
    const channel: Point[] = [];
    let previous: Point | undefined;
    const start = 0;
    const stop = (horizontalDitch ? width : height) - 1;
    for (let along = start; along <= stop; along += 1) {
      const distance = along - (horizontalDitch ? crossing.x : crossing.y);
      const across = clampCell(
        (horizontalDitch ? crossing.y : crossing.x) +
          Math.sin(distance * frequency) * amplitude,
        1,
        (horizontalDitch ? height : width) - 2,
      );
      const point = horizontalDitch
        ? { x: along, y: across }
        : { x: across, y: along };
      if (previous) {
        const connector = horizontalDitch
          ? { x: previous.x, y: point.y }
          : { x: point.x, y: previous.y };
        channel.push(...orthogonalPath([previous, connector, point]));
      } else {
        channel.push(point);
      }
      previous = point;
    }
    for (const point of channel) {
      const tile = grid[point.y]?.[point.x];
      if (!tile) continue;
      const carriesRoad = tileSurface(tile) === Terrain.Road;
      tile.terrain = Terrain.Water;
      if (carriesRoad) setTileSurface(tile, Terrain.Bridge);
    }
  }

  const minimumCrops = Math.ceil(width * height * .06);
  const cropCount = grid.flat().filter((tile) => tile.terrain === Terrain.Difficult).length;
  if (cropCount < minimumCrops) {
    const fallbackCrops = grid.flatMap((row, y) =>
      row.map((tile, x) => ({ tile, x, y, score: random() })))
      .filter(({ tile, x, y }) =>
        x > 0 && y > 0 && x < width - 1 && y < height - 1 &&
        tile.terrain === Terrain.Ground && !tileSurface(tile)
      )
      .sort((a, b) => a.score - b.score);
    for (const { tile } of fallbackCrops.slice(0, minimumCrops - cropCount)) {
      tile.terrain = Terrain.Difficult;
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
  const compact = width < 24 || height < 18;
  const corridorRadius = crossSize < 16 ? 1 : 2;
  const branchRadius = compact ? 0 : corridorRadius;
  const innerMinimum = corridorRadius + 1;
  const innerMaximum = Math.max(innerMinimum, crossSize - corridorRadius - 2);
  const span = Math.max(1, innerMaximum - innerMinimum);
  const levels = shuffled([
    clampCell(innerMinimum + span * .08, innerMinimum, innerMaximum),
    clampCell(innerMinimum + span * .5, innerMinimum, innerMaximum),
    clampCell(innerMinimum + span * .92, innerMinimum, innerMaximum),
  ], random);
  const firstBend = clampCell(longSize * (.27 + random() * .1), 2, longSize - 5);
  const secondBend = clampCell(
    longSize * (.64 + random() * .1),
    firstBend + 2,
    longSize - 2,
  );
  const point = (along: number, across: number): Point => horizontal
    ? { x: along, y: across }
    : { x: across, y: along };
  const mainPath = orthogonalPath([
    point(0, levels[0]),
    point(firstBend, levels[0]),
    point(firstBend, levels[1]),
    point(secondBend, levels[1]),
    point(secondBend, levels[2]),
    point(longSize - 1, levels[2]),
  ]);

  const upperTargetAlong = clampCell(
    firstBend + (secondBend - firstBend) * (.25 + random() * .2),
    firstBend,
    secondBend,
  );
  const lowerTargetAlong = clampCell(
    secondBend + (longSize - 1 - secondBend) * (.35 + random() * .25),
    secondBend,
    longSize - 2,
  );
  const upperStartAlong = clampCell(longSize * (.16 + random() * .16), 1, longSize - 2);
  const lowerStartAlong = clampCell(longSize * (.68 + random() * .16), 1, longSize - 2);
  const upperBendAcross = clampCell(levels[1] * .55, 1, crossSize - 2);
  const lowerBendAcross = clampCell(
    levels[2] + (crossSize - 1 - levels[2]) * .5,
    1,
    crossSize - 2,
  );
  const upperBranch = orthogonalPath([
    point(upperStartAlong, 0),
    point(upperStartAlong, upperBendAcross),
    point(upperTargetAlong, upperBendAcross),
    point(upperTargetAlong, levels[1]),
  ]);
  const lowerBranch = orthogonalPath([
    point(lowerStartAlong, crossSize - 1),
    point(lowerStartAlong, lowerBendAcross),
    point(lowerTargetAlong, lowerBendAcross),
    point(lowerTargetAlong, levels[2]),
  ]);

  const blindStartAlong = clampCell(
    firstBend + (secondBend - firstBend) * .55,
    firstBend,
    secondBend,
  );
  const blindDirection = levels[1] < crossSize / 2 ? 1 : -1;
  const blindAlong = clampCell(
    blindStartAlong + (random() < .5 ? -1 : 1) * (3 + random() * 3),
    3,
    longSize - 4,
  );
  const blindAcross = clampCell(
    levels[1] + blindDirection * (4 + random() * Math.max(2, crossSize * .12)),
    3,
    crossSize - 4,
  );
  const blindBranch = orthogonalPath([
    point(blindStartAlong, levels[1]),
    point(blindAlong, levels[1]),
    point(blindAlong, blindAcross),
  ]);

  carveCorridor(grid, mainPath, corridorRadius);
  carveCorridor(grid, upperBranch, branchRadius);
  carveCorridor(grid, lowerBranch, branchRadius);
  carveCorridor(grid, blindBranch, compact ? 0 : 1);
  const chamberCenters = [
    point(firstBend, levels[1]),
    point(upperTargetAlong, levels[1]),
    point(lowerTargetAlong, levels[2]),
    point(blindAlong, blindAcross),
  ];
  for (const center of compact ? chamberCenters.slice(2) : chamberCenters) {
    paintCircle(
      grid,
      center.x,
      center.y,
      compact ? 1 : 2,
      Terrain.Ground,
    );
  }

  if (waterWeight > 0) {
    const thickness = Math.min(
      Math.max(1, corridorRadius),
      Math.max(1, Math.round(waterWeight)),
    );
    for (const center of mainPath) {
      for (let offset = 0; offset < thickness; offset += 1) {
        const x = center.x + (horizontal ? 0 : offset);
        const y = center.y + (horizontal ? offset : 0);
        if (grid[y]?.[x]) grid[y][x].terrain = Terrain.Water;
      }
    }
  }

  // Keep useful floor space in every quadrant without restoring the old
  // map-wide cross. A short maintenance spur links a compact room only when a
  // quadrant is genuinely underserved by the primary network.
  const minimumQuadrantFloor = Math.ceil(width * height * (compact ? .045 : .05));
  const quadrantCenters = [
    { x: Math.floor(width * .25), y: Math.floor(height * .25) },
    { x: Math.floor(width * .75), y: Math.floor(height * .25) },
    { x: Math.floor(width * .25), y: Math.floor(height * .75) },
    { x: Math.floor(width * .75), y: Math.floor(height * .75) },
  ];
  const quadrantIndex = ({ x, y }: Point) =>
    (x >= width / 2 ? 1 : 0) + (y >= height / 2 ? 2 : 0);
  for (let quadrant = 0; quadrant < quadrantCenters.length; quadrant += 1) {
    const currentFloor = grid.reduce((sum, row, y) =>
      sum + row.filter((tile, x) =>
        quadrantIndex({ x, y }) === quadrant &&
        (tile.terrain === Terrain.Ground || tile.terrain === Terrain.Difficult)
      ).length,
    0);
    if (currentFloor >= minimumQuadrantFloor) continue;
    const center = quadrantCenters[quadrant];
    const existingFloor = grid.flatMap((row, y) =>
      row.map((tile, x) => ({ tile, x, y })))
      .filter(({ tile }) => tile.terrain !== Terrain.Cliff)
      .sort((a, b) =>
        Math.abs(a.x - center.x) + Math.abs(a.y - center.y) -
        Math.abs(b.x - center.x) - Math.abs(b.y - center.y)
      )[0];
    if (!existingFloor) continue;
    const connector = random() < .5
      ? orthogonalPath([
          { x: existingFloor.x, y: existingFloor.y },
          { x: center.x, y: existingFloor.y },
          center,
        ])
      : orthogonalPath([
          { x: existingFloor.x, y: existingFloor.y },
          { x: existingFloor.x, y: center.y },
          center,
        ]);
    const maintenanceRadius = compact ? 0 : 1;
    for (const point of connector) {
      for (let offsetY = -maintenanceRadius; offsetY <= maintenanceRadius; offsetY += 1) {
        for (let offsetX = -maintenanceRadius; offsetX <= maintenanceRadius; offsetX += 1) {
          const tile = grid[point.y + offsetY]?.[point.x + offsetX];
          if (tile?.terrain === Terrain.Cliff) tile.terrain = Terrain.Ground;
        }
      }
    }
    const roomRadius = compact ? 1 : 2;
    for (let y = center.y - roomRadius; y <= center.y + roomRadius; y += 1) {
      for (let x = center.x - roomRadius; x <= center.x + roomRadius; x += 1) {
        const tile = grid[y]?.[x];
        if (
          tile?.terrain === Terrain.Cliff &&
          (x - center.x) ** 2 + (y - center.y) ** 2 <= roomRadius ** 2 + 1
        ) {
          tile.terrain = Terrain.Ground;
        }
      }
    }
    let expandedFloor = grid.reduce((sum, row, y) =>
      sum + row.filter((tile, x) =>
        quadrantIndex({ x, y }) === quadrant &&
        (tile.terrain === Terrain.Ground || tile.terrain === Terrain.Difficult)
      ).length,
    0);
    const maximumRoomRadius = Math.ceil(
      Math.sqrt(minimumQuadrantFloor / Math.PI),
    ) + 2;
    for (
      let radius = roomRadius + 1;
      expandedFloor < minimumQuadrantFloor && radius <= maximumRoomRadius;
      radius += 1
    ) {
      for (let y = center.y - radius; y <= center.y + radius; y += 1) {
        for (let x = center.x - radius; x <= center.x + radius; x += 1) {
          const tile = grid[y]?.[x];
          if (
            tile?.terrain === Terrain.Cliff &&
            quadrantIndex({ x, y }) === quadrant &&
            (x - center.x) ** 2 + (y - center.y) ** 2 <= radius ** 2 + 1
          ) {
            tile.terrain = Terrain.Ground;
            expandedFloor += 1;
          }
        }
      }
    }
  }

  // On compact maps several bent corridors can overlap and leave almost no
  // masonry between them. Trim only non-articulation floor cells, preserving
  // the connected network, all edge exits, the channel, and quadrant capacity.
  const minimumCliffs = Math.ceil(width * height * .36);
  let cliffCount = grid.flat().filter((tile) => tile.terrain === Terrain.Cliff).length;
  if (cliffCount < minimumCliffs) {
    const minimumFloorPerQuadrant = Math.ceil(width * height * .04);
    const floorPerQuadrant = [0, 0, 0, 0];
    grid.forEach((row, y) => row.forEach((tile, x) => {
      if (tile.terrain === Terrain.Ground || tile.terrain === Terrain.Difficult) {
        floorPerQuadrant[quadrantIndex({ x, y })] += 1;
      }
    }));
    const connectedOpenCount = () => {
      const first = grid.flatMap((row, y) =>
        row.map((tile, x) => ({ tile, x, y })))
        .find(({ tile }) => tile.terrain !== Terrain.Cliff);
      if (!first) return 0;
      const visited = new Set([`${first.x},${first.y}`]);
      const queue = [{ x: first.x, y: first.y }];
      for (let index = 0; index < queue.length; index += 1) {
        const current = queue[index];
        for (const direction of cardinalDirections) {
          const next = { x: current.x + direction.x, y: current.y + direction.y };
          const key = `${next.x},${next.y}`;
          if (
            visited.has(key) ||
            grid[next.y]?.[next.x]?.terrain === Terrain.Cliff ||
            !grid[next.y]?.[next.x]
          ) {
            continue;
          }
          visited.add(key);
          queue.push(next);
        }
      }
      return visited.size;
    };
    const candidates = grid.flatMap((row, y) =>
      row.map((tile, x) => ({
        tile,
        x,
        y,
        score: cardinalDirections.filter((direction) =>
          grid[y + direction.y]?.[x + direction.x]?.terrain !== Terrain.Cliff &&
          grid[y + direction.y]?.[x + direction.x]
        ).length + random() * .2,
      })))
      .filter(({ tile, x, y }) =>
        x > 0 && y > 0 && x < width - 1 && y < height - 1 &&
        (tile.terrain === Terrain.Ground || tile.terrain === Terrain.Difficult)
      )
      .sort((a, b) => a.score - b.score);
    let openCount = grid.flat().filter((tile) => tile.terrain !== Terrain.Cliff).length;
    for (const candidate of candidates) {
      if (cliffCount >= minimumCliffs) break;
      const quadrant = quadrantIndex(candidate);
      if (floorPerQuadrant[quadrant] <= minimumFloorPerQuadrant) continue;
      const previousTerrain = candidate.tile.terrain;
      candidate.tile.terrain = Terrain.Cliff;
      if (connectedOpenCount() !== openCount - 1) {
        candidate.tile.terrain = previousTerrain;
        continue;
      }
      openCount -= 1;
      cliffCount += 1;
      floorPerQuadrant[quadrant] -= 1;
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
