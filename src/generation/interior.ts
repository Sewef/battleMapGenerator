import {
  INTERIOR_ROOM_LIMITS,
  Obstacle,
  Terrain,
  type Grid,
  type InteriorMode,
  type Tile,
} from "../domain/map";
import type { Random } from "./types";
import { decorateInterior } from "./interior-props";

type Rectangle = { x: number; y: number; width: number; height: number };
type Bounds = { left: number; top: number; right: number; bottom: number };
type Door = {
  x: number;
  y: number;
  orientation: "horizontal" | "vertical";
};

function tile(terrain: typeof Terrain.Void | typeof Terrain.Ground | typeof Terrain.Wall | typeof Terrain.Door): Tile {
  return {
    terrain,
    obstacle: Obstacle.None,
    height: terrain === Terrain.Wall
      ? .82
      : terrain === Terrain.Door ? .48 : terrain === Terrain.Void ? .08 : .32,
  };
}

function randomInteger(random: Random, minimum: number, maximum: number) {
  return minimum + Math.floor(random() * (maximum - minimum + 1));
}

function initialize(grid: Grid) {
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      grid[y][x] = tile(Terrain.Void);
    }
  }
}

function buildingBounds(grid: Grid, random: Random): Bounds {
  const maximumMarginX = grid[0].length >= 32 ? 3 : grid[0].length >= 24 ? 2 : 1;
  const maximumMarginY = grid.length >= 24 ? 3 : grid.length >= 18 ? 2 : 1;
  const left = randomInteger(random, 1, maximumMarginX);
  const top = randomInteger(random, 1, maximumMarginY);
  const rightMargin = randomInteger(random, 1, maximumMarginX);
  const bottomMargin = randomInteger(random, 1, maximumMarginY);
  return {
    left,
    top,
    right: grid[0].length - rightMargin - 1,
    bottom: grid.length - bottomMargin - 1,
  };
}

function paintRectangle(grid: Grid, rectangle: Rectangle, terrain: typeof Terrain.Ground | typeof Terrain.Wall) {
  for (let y = rectangle.y; y < rectangle.y + rectangle.height; y += 1) {
    for (let x = rectangle.x; x < rectangle.x + rectangle.width; x += 1) {
      grid[y][x] = tile(terrain);
    }
  }
}

function buildShell(grid: Grid, bounds: Bounds) {
  paintRectangle(
    grid,
    {
      x: bounds.left + 1,
      y: bounds.top + 1,
      width: bounds.right - bounds.left - 1,
      height: bounds.bottom - bounds.top - 1,
    },
    Terrain.Ground,
  );
  horizontalWall(grid, bounds.top, bounds.left, bounds.right);
  horizontalWall(grid, bounds.bottom, bounds.left, bounds.right);
  verticalWall(grid, bounds.left, bounds.top, bounds.bottom);
  verticalWall(grid, bounds.right, bounds.top, bounds.bottom);
}

function horizontalWall(grid: Grid, y: number, startX: number, endX: number) {
  for (let x = startX; x <= endX; x += 1) grid[y][x] = tile(Terrain.Wall);
}

function verticalWall(grid: Grid, x: number, startY: number, endY: number) {
  for (let y = startY; y <= endY; y += 1) grid[y][x] = tile(Terrain.Wall);
}

function placeDoor(grid: Grid, door: Door) {
  grid[door.y][door.x] = {
    ...tile(Terrain.Door),
    doorOrientation: door.orientation,
  };
}

function assignRoom(
  grid: Grid,
  rectangle: Rectangle,
  roomId: number,
  role: string,
) {
  for (let y = rectangle.y; y < rectangle.y + rectangle.height; y += 1) {
    for (let x = rectangle.x; x < rectangle.x + rectangle.width; x += 1) {
      if (grid[y]?.[x]?.terrain !== Terrain.Ground) continue;
      grid[y][x].roomId = roomId;
      grid[y][x].roomRole = role;
    }
  }
}

function assignRemainingGround(
  grid: Grid,
  roomId: number,
  role: string,
) {
  for (const row of grid) {
    for (const current of row) {
      if (current.terrain !== Terrain.Ground || current.roomId !== undefined) continue;
      current.roomId = roomId;
      current.roomRole = role;
    }
  }
}

function balancedSplit(random: Random, minimum: number, maximum: number) {
  const center = (minimum + maximum) / 2;
  const jitter = Math.min(2, (maximum - minimum) * .22);
  return Math.max(
    minimum,
    Math.min(maximum, Math.round(center + (random() - .5) * jitter * 2)),
  );
}

// Keep openings away from wall junctions whenever the room has enough space.
// Corner doors were the main source of layouts that were technically connected
// but read as accidental or structurally implausible.
function doorwayPosition(random: Random, minimum: number, maximum: number) {
  const inset = maximum - minimum >= 3 ? 1 : 0;
  return randomInteger(random, minimum + inset, maximum - inset);
}

function splitRectangle(
  rectangle: Rectangle,
  random: Random,
): { rooms: [Rectangle, Rectangle]; wall: Rectangle; door: Door } | undefined {
  const minimumSpan = 2;
  const verticalPossible = rectangle.width >= minimumSpan * 2 + 1;
  const horizontalPossible = rectangle.height >= minimumSpan * 2 + 1;
  if (!verticalPossible && !horizontalPossible) return undefined;
  const vertical = verticalPossible && (
    !horizontalPossible ||
    rectangle.width / rectangle.height > 1.2 ||
    (rectangle.height / rectangle.width <= 1.2 && random() < .5)
  );
  if (vertical) {
    const wallX = balancedSplit(
      random,
      rectangle.x + minimumSpan,
      rectangle.x + rectangle.width - minimumSpan - 1,
    );
    return {
      rooms: [
        { ...rectangle, width: wallX - rectangle.x },
        {
          x: wallX + 1,
          y: rectangle.y,
          width: rectangle.x + rectangle.width - wallX - 1,
          height: rectangle.height,
        },
      ],
      wall: { x: wallX, y: rectangle.y, width: 1, height: rectangle.height },
      door: {
        x: wallX,
        y: doorwayPosition(random, rectangle.y, rectangle.y + rectangle.height - 1),
        orientation: "vertical",
      },
    };
  }
  const wallY = balancedSplit(
    random,
    rectangle.y + minimumSpan,
    rectangle.y + rectangle.height - minimumSpan - 1,
  );
  return {
    rooms: [
      { ...rectangle, height: wallY - rectangle.y },
      {
        x: rectangle.x,
        y: wallY + 1,
        width: rectangle.width,
        height: rectangle.y + rectangle.height - wallY - 1,
      },
    ],
    wall: { x: rectangle.x, y: wallY, width: rectangle.width, height: 1 },
    door: {
      x: doorwayPosition(random, rectangle.x, rectangle.x + rectangle.width - 1),
      y: wallY,
      orientation: "horizontal",
    },
  };
}

function subdivide(
  grid: Grid,
  rectangle: Rectangle,
  count: number,
  random: Random,
) {
  const rooms = [rectangle];
  while (rooms.length < count) {
    const candidates = rooms
      .map((room, index) => ({ room, index, split: splitRectangle(room, random) }))
      .filter(({ split }) => split)
      .sort((first, second) =>
        second.room.width * second.room.height -
        first.room.width * first.room.height
      );
    const selected = candidates[0];
    if (!selected?.split) break;
    paintRectangle(grid, selected.split.wall, Terrain.Wall);
    placeDoor(grid, selected.split.door);
    rooms.splice(selected.index, 1, ...selected.split.rooms);
  }
  return rooms;
}

function variedPartitionRange(
  start: number,
  end: number,
  count: number,
  random: Random,
) {
  if (count <= 1) return [{ start, end }];
  const usable = end - start + 1 - (count - 1);
  const minimumSize = Math.max(1, Math.min(3, Math.floor(usable / count) - 1));
  const sizes = Array.from({ length: count }, () => minimumSize);
  let remaining = usable - minimumSize * count;
  while (remaining > 0) {
    const smallest = Math.min(...sizes);
    const candidates = sizes
      .map((size, index) => ({ size, index }))
      .filter(({ size }) => size === smallest);
    sizes[candidates[Math.floor(random() * candidates.length)].index] += 1;
    remaining -= 1;
  }
  const segments: Array<{ start: number; end: number }> = [];
  let cursor = start;
  for (const size of sizes) {
    segments.push({ start: cursor, end: cursor + size - 1 });
    cursor += size + 1;
  }
  return segments;
}

function mirrorInterior(grid: Grid, random: Random) {
  if (random() < .5) {
    for (const row of grid) row.reverse();
  }
  if (random() < .5) grid.reverse();
}

function shapeVesselHull(
  grid: Grid,
  bounds: Bounds,
  mode: "ship" | "ship-deck" | "spaceship",
  random: Random,
) {
  // Preserve a recognizable hull even on the shortest supported ship maps.
  // The old 26x14 cutoff made some valid 42x18 presets stay rectangular after
  // their randomized margins were applied.
  if (bounds.right - bounds.left < 26 || bounds.bottom - bounds.top < 10) return;
  const centerY = (bounds.top + bounds.bottom) / 2;
  const halfHeight = Math.max(1, (bounds.bottom - bounds.top) / 2);
  const woodenVessel = mode === "ship" || mode === "ship-deck";
  const sternInset = woodenVessel
    ? randomInteger(random, 1, 2)
    : randomInteger(random, 2, 3);
  const bowInset = woodenVessel
    ? randomInteger(random, 4, 6)
    : randomInteger(random, 2, 4);

  for (let y = bounds.top; y <= bounds.bottom; y += 1) {
    const edge = Math.abs(y - centerY) / halfHeight;
    const taper = Math.max(0, (edge - .42) / .58) ** 1.35;
    const leftInset = Math.round(sternInset * taper);
    const rightInset = Math.round(bowInset * taper);
    for (let x = bounds.left; x <= bounds.right; x += 1) {
      if (x < bounds.left + leftInset || x > bounds.right - rightInset) {
        grid[y][x] = tile(Terrain.Void);
      }
    }
  }

  const exposedFloor: Array<{ x: number; y: number }> = [];
  for (let y = bounds.top; y <= bounds.bottom; y += 1) {
    for (let x = bounds.left; x <= bounds.right; x += 1) {
      if (grid[y][x].terrain !== Terrain.Ground) continue;
      const touchesOutside = [
        grid[y - 1]?.[x],
        grid[y + 1]?.[x],
        grid[y]?.[x - 1],
        grid[y]?.[x + 1],
      ].some((neighbor) => !neighbor || neighbor.terrain === Terrain.Void);
      if (touchesOutside) exposedFloor.push({ x, y });
    }
  }
  for (const { x, y } of exposedFloor) grid[y][x] = tile(Terrain.Wall);
}

function chamferVesselRooms(grid: Grid, random: Random) {
  const rooms = new Map<number, Array<{ x: number; y: number }>>();
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      const current = grid[y][x];
      if (current.terrain !== Terrain.Ground || current.roomId === undefined || current.roomId === 0) {
        continue;
      }
      const cells = rooms.get(current.roomId) ?? [];
      cells.push({ x, y });
      rooms.set(current.roomId, cells);
    }
  }
  const touchesDoor = (x: number, y: number) => [
    grid[y - 1]?.[x], grid[y + 1]?.[x], grid[y]?.[x - 1], grid[y]?.[x + 1],
  ].some((neighbor) => neighbor?.terrain === Terrain.Door);

  for (const cells of rooms.values()) {
    const left = Math.min(...cells.map(({ x }) => x));
    const right = Math.max(...cells.map(({ x }) => x));
    const top = Math.min(...cells.map(({ y }) => y));
    const bottom = Math.max(...cells.map(({ y }) => y));
    if (right - left < 3 || bottom - top < 3 || random() > .78) continue;
    const candidates = [
      { x: left, y: top, inwardX: 1, inwardY: 1 },
      { x: right, y: top, inwardX: -1, inwardY: 1 },
      { x: left, y: bottom, inwardX: 1, inwardY: -1 },
      { x: right, y: bottom, inwardX: -1, inwardY: -1 },
    ].filter(({ x, y, inwardX, inwardY }) => {
      const roomId = grid[y]?.[x]?.roomId;
      return grid[y]?.[x]?.terrain === Terrain.Ground &&
        grid[y]?.[x + inwardX]?.roomId === roomId &&
        grid[y + inwardY]?.[x]?.roomId === roomId &&
        !touchesDoor(x, y);
    });
    if (!candidates.length) continue;
    const corner = candidates[Math.floor(random() * candidates.length)];
    grid[corner.y][corner.x] = tile(Terrain.Wall);
  }
}

function repairBlockedInternalDoors(grid: Grid) {
  const doors: Door[] = [];
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      const current = grid[y][x];
      if (current.terrain === Terrain.Door && current.doorOrientation) {
        doors.push({ x, y, orientation: current.doorOrientation });
      }
    }
  }
  const isFloor = (x: number, y: number) => grid[y]?.[x]?.terrain === Terrain.Ground;
  const isWallLine = (x: number, y: number) => {
    const terrain = grid[y]?.[x]?.terrain;
    return terrain === Terrain.Wall || terrain === Terrain.Door;
  };
  for (const door of doors) {
    const valid = door.orientation === "horizontal"
      ? isFloor(door.x, door.y - 1) && isFloor(door.x, door.y + 1)
      : isFloor(door.x - 1, door.y) && isFloor(door.x + 1, door.y);
    const exterior = [
      grid[door.y - 1]?.[door.x]?.terrain,
      grid[door.y + 1]?.[door.x]?.terrain,
      grid[door.y]?.[door.x - 1]?.terrain,
      grid[door.y]?.[door.x + 1]?.terrain,
    ].includes(Terrain.Void);
    if (valid || exterior) continue;
    const maximumDistance = door.orientation === "horizontal"
      ? grid[door.y].length
      : grid.length;
    let replacement: { x: number; y: number } | undefined;
    for (let distance = 1; distance < maximumDistance && !replacement; distance += 1) {
      for (const direction of [-1, 1]) {
        const x = door.orientation === "horizontal"
          ? door.x + distance * direction
          : door.x;
        const y = door.orientation === "vertical"
          ? door.y + distance * direction
          : door.y;
        if (!isWallLine(x, y)) continue;
        const opens = door.orientation === "horizontal"
          ? isFloor(x, y - 1) && isFloor(x, y + 1)
          : isFloor(x - 1, y) && isFloor(x + 1, y);
        if (opens) {
          replacement = { x, y };
          break;
        }
      }
    }
    if (!replacement) continue;
    grid[door.y][door.x] = tile(Terrain.Wall);
    placeDoor(grid, { ...replacement, orientation: door.orientation });
  }
}

function houseInterior(
  grid: Grid,
  bounds: Bounds,
  roomCount: number,
  random: Random,
) {
  const left = bounds.left + 1;
  const right = bounds.right - 1;
  const top = bounds.top + 1;
  const bottom = bounds.bottom - 1;
  const height = bottom - top + 1;
  const hallTop = top + Math.max(4, Math.min(height - 6,
    Math.round(height * (.48 + random() * .13))));
  const hallBottom = hallTop + randomInteger(random, 1, 2);
  const livingWall = left + Math.max(4, Math.min(right - left - 4,
    Math.round((right - left) * (.56 + random() * .14))));

  horizontalWall(grid, hallTop - 1, left, right);
  horizontalWall(grid, hallBottom + 1, left, right);
  verticalWall(grid, livingWall, top, hallTop - 2);

  assignRoom(grid, {
    x: left, y: top, width: livingWall - left, height: hallTop - top - 1,
  }, 0, "Living room");
  assignRoom(grid, {
    x: livingWall + 1,
    y: top,
    width: right - livingWall,
    height: hallTop - top - 1,
  }, 1, "Kitchen");
  assignRoom(grid, {
    x: left,
    y: hallTop,
    width: right - left + 1,
    height: hallBottom - hallTop + 1,
  }, 2, "Hallway");

  placeDoor(grid, {
    x: randomInteger(random, left + 1, livingWall - 1),
    y: hallTop - 1,
    orientation: "horizontal",
  });
  placeDoor(grid, {
    x: randomInteger(random, livingWall + 1, right - 1),
    y: hallTop - 1,
    orientation: "horizontal",
  });

  const bedroomCount = roomCount - 3;
  const bedroomSegments = variedPartitionRange(left, right, bedroomCount, random);
  bedroomSegments.slice(0, -1).forEach(({ end }) =>
    verticalWall(grid, end + 1, hallBottom + 2, bottom)
  );
  bedroomSegments.forEach((segment, index) => {
    assignRoom(grid, {
      x: segment.start,
      y: hallBottom + 2,
      width: segment.end - segment.start + 1,
      height: bottom - hallBottom - 1,
    }, index + 3, `Bedroom ${index + 1}`);
    placeDoor(grid, {
      x: Math.floor((segment.start + segment.end) / 2),
      y: hallBottom + 1,
      orientation: "horizontal",
    });
  });
  placeDoor(grid, {
    x: bounds.left,
    y: randomInteger(random, hallTop, hallBottom),
    orientation: "vertical",
  });
}

function tavernInterior(
  grid: Grid,
  bounds: Bounds,
  roomCount: number,
  random: Random,
) {
  const left = bounds.left + 1;
  const right = bounds.right - 1;
  const top = bounds.top + 1;
  const bottom = bounds.bottom - 1;
  const corridorWidth = randomInteger(random, 2, 3);
  const hallWall = left + Math.max(6, Math.min(
    right - left - corridorWidth - 4,
    Math.round((right - left) * (.52 + random() * .08)),
  ));
  const hallRight = hallWall + corridorWidth + 1;
  const kitchenWall = top + Math.max(3, Math.min(bottom - top - 5,
    Math.round((bottom - top) * (.19 + random() * .09))));
  verticalWall(grid, hallWall, top, bottom);
  verticalWall(grid, hallRight, kitchenWall + 1, bottom);
  horizontalWall(grid, kitchenWall, hallWall + 1, right);

  assignRoom(grid, {
    x: left, y: top, width: hallWall - left, height: bottom - top + 1,
  }, 0, "Common room");
  assignRoom(grid, {
    x: hallWall + 1, y: top, width: right - hallWall, height: kitchenWall - top,
  }, 1, "Kitchen");
  assignRoom(grid, {
    x: hallWall + 1,
    y: kitchenWall + 1,
    width: corridorWidth,
    height: bottom - kitchenWall,
  }, 2, "Hallway");

  placeDoor(grid, {
    x: hallWall,
    y: randomInteger(random, top + 1, kitchenWall - 1),
    orientation: "vertical",
  });
  placeDoor(grid, {
    x: hallWall,
    y: randomInteger(random, kitchenWall + 2, bottom - 1),
    orientation: "vertical",
  });

  const guestSegments = variedPartitionRange(kitchenWall + 1, bottom, roomCount - 3, random);
  guestSegments.slice(0, -1).forEach(({ end }) =>
    horizontalWall(grid, end + 1, hallRight + 1, right)
  );
  guestSegments.forEach((segment, index) => {
    assignRoom(grid, {
      x: hallRight + 1,
      y: segment.start,
      width: right - hallRight,
      height: segment.end - segment.start + 1,
    }, index + 3, `Guest room ${index + 1}`);
    placeDoor(grid, {
      x: hallRight,
      y: Math.floor((segment.start + segment.end) / 2),
      orientation: "vertical",
    });
  });
  placeDoor(grid, {
    x: randomInteger(random, left + 1, hallWall - 1),
    y: bounds.bottom,
    orientation: "horizontal",
  });
}

function axialInterior(
  grid: Grid,
  bounds: Bounds,
  roomCount: number,
  mode: "spaceship" | "ship" | "ship-deck",
  random: Random,
) {
  const left = bounds.left + 1;
  const right = bounds.right - 1;
  const top = bounds.top + 1;
  const bottom = bounds.bottom - 1;
  const corridorCenter = Math.max(top + 4, Math.min(bottom - 4,
    Math.floor((top + bottom) / 2) + randomInteger(random, -2, 2)));
  const corridorTop = corridorCenter - randomInteger(random, 1, 2);
  const corridorBottom = corridorCenter + 1;
  horizontalWall(grid, corridorTop - 1, left, right);
  horizontalWall(grid, corridorBottom + 1, left, right);
  assignRoom(grid, {
    x: left,
    y: corridorTop,
    width: right - left + 1,
    height: corridorBottom - corridorTop + 1,
  }, 0, mode === "spaceship"
    ? "Central spine"
    : mode === "ship-deck" ? "Weather deck" : "Main gangway");

  const moduleCount = roomCount - 1;
  const upperCount = Math.max(1, Math.min(moduleCount - 1,
    Math.ceil(moduleCount / 2) + randomInteger(random, -1, 1)));
  const lowerCount = moduleCount - upperCount;
  const upper = variedPartitionRange(left, right, upperCount, random);
  const lower = lowerCount ? variedPartitionRange(left, right, lowerCount, random) : [];
  const roles = mode === "spaceship"
    ? ["Cockpit", "Engineering", "Crew quarters", "Medbay", "Cargo bay", "Laboratory", "Life support", "Armory", "Observation room", "Airlock", "Utility bay"]
    : mode === "ship-deck"
      ? ["Quarterdeck", "Forecastle", "Port waist", "Starboard waist", "Boat deck", "Capstan deck", "Helm platform"]
      : ["Captain's cabin", "Galley", "Crew berths", "Cargo hold", "Chart room", "Sick bay", "Bosun's store", "Guest cabin", "Magazine", "Workshop", "Provision hold"];
  let nextRoomId = 1;
  const addModules = (
    segments: Array<{ start: number; end: number }>,
    y: number,
    height: number,
    wallY: number,
  ) => {
    segments.slice(0, -1).forEach(({ end }) =>
      verticalWall(grid, end + 1, y, y + height - 1)
    );
    segments.forEach((segment) => {
      assignRoom(grid, {
        x: segment.start,
        y,
        width: segment.end - segment.start + 1,
        height,
      }, nextRoomId, roles[nextRoomId - 1] ?? `Compartment ${nextRoomId}`);
      placeDoor(grid, {
        x: Math.floor((segment.start + segment.end) / 2),
        y: wallY,
        orientation: "horizontal",
      });
      nextRoomId += 1;
    });
  };
  addModules(upper, top, corridorTop - top - 1, corridorTop - 1);
  if (lower.length) {
    addModules(
      lower,
      corridorBottom + 2,
      bottom - corridorBottom - 1,
      corridorBottom + 1,
    );
  }
  const entranceOnLeft = random() < .5;
  placeDoor(grid, {
    x: entranceOnLeft ? bounds.left : bounds.right,
    y: Math.floor((corridorTop + corridorBottom) / 2),
    orientation: "vertical",
  });
}

function spaceshipInterior(
  grid: Grid,
  bounds: Bounds,
  roomCount: number,
  random: Random,
) {
  const left = bounds.left + 1;
  const right = bounds.right - 1;
  const top = bounds.top + 1;
  const bottom = bounds.bottom - 1;
  const height = bottom - top + 1;
  const cockpitWidth = Math.max(4, Math.min(6,
    Math.round((right - left + 1) * (.14 + random() * .05))));
  const cockpitWall = right - cockpitWidth;
  const corridorCenter = Math.max(top + 4, Math.min(bottom - 4,
    Math.floor((top + bottom) / 2) + randomInteger(random, -1, 1)));
  const corridorTop = corridorCenter - 1;
  const corridorBottom = corridorCenter + 1;

  verticalWall(grid, cockpitWall, top, bottom);
  horizontalWall(grid, corridorTop - 1, left, cockpitWall - 1);
  horizontalWall(grid, corridorBottom + 1, left, cockpitWall - 1);

  assignRoom(grid, {
    x: left,
    y: corridorTop,
    width: cockpitWall - left,
    height: corridorBottom - corridorTop + 1,
  }, 0, "Central spine");
  assignRoom(grid, {
    x: cockpitWall + 1,
    y: top,
    width: right - cockpitWall,
    height,
  }, 1, "Cockpit");
  placeDoor(grid, {
    x: cockpitWall,
    y: corridorCenter,
    orientation: "vertical",
  });

  const moduleCount = roomCount - 2;
  const upperCount = Math.max(1, Math.min(moduleCount - 1,
    Math.ceil(moduleCount / 2) + randomInteger(random, -1, 1)));
  const lowerCount = moduleCount - upperCount;
  const moduleRight = cockpitWall - 1;
  const upper = variedPartitionRange(left, moduleRight, upperCount, random);
  const lower = variedPartitionRange(left, moduleRight, lowerCount, random);
  const roles = [
    "Engineering",
    "Crew quarters",
    "Medbay",
    "Cargo bay",
    "Laboratory",
    "Life support",
    "Armory",
    "Observation room",
    "Utility bay",
    "Escape pods",
  ];
  let nextRoomId = 2;
  const addModules = (
    segments: Array<{ start: number; end: number }>,
    y: number,
    moduleHeight: number,
    wallY: number,
  ) => {
    segments.slice(0, -1).forEach(({ end }) =>
      verticalWall(grid, end + 1, y, y + moduleHeight - 1)
    );
    for (const segment of segments) {
      assignRoom(grid, {
        x: segment.start,
        y,
        width: segment.end - segment.start + 1,
        height: moduleHeight,
      }, nextRoomId, roles[nextRoomId - 2] ?? `Compartment ${nextRoomId - 1}`);
      placeDoor(grid, {
        x: Math.floor((segment.start + segment.end) / 2),
        y: wallY,
        orientation: "horizontal",
      });
      nextRoomId += 1;
    }
  };

  addModules(upper, top, corridorTop - top - 1, corridorTop - 1);
  addModules(
    lower,
    corridorBottom + 2,
    bottom - corridorBottom - 1,
    corridorBottom + 1,
  );
  placeDoor(grid, {
    x: bounds.left,
    y: corridorCenter,
    orientation: "vertical",
  });
}

function sailingShipDeck(
  grid: Grid,
  bounds: Bounds,
  areaCount: number,
  random: Random,
) {
  const left = bounds.left + 1;
  const right = bounds.right - 1;
  const top = bounds.top + 1;
  const bottom = bounds.bottom - 1;
  const centerY = Math.floor((top + bottom) / 2);
  const deckWidth = right - left + 1;
  const sizes = Array.from({ length: areaCount }, () => Math.floor(deckWidth / areaCount));
  let remainder = deckWidth - sizes.reduce((sum, size) => sum + size, 0);
  while (remainder > 0) {
    sizes[Math.floor(random() * sizes.length)] += 1;
    remainder -= 1;
  }
  let cursor = left;
  const sections = sizes.map((size) => {
    const section = { start: cursor, end: cursor + size - 1 };
    cursor += size;
    return section;
  });
  const roles = ["Quarterdeck", "Aft waist", "Main deck", "Boat deck",
    "Fore waist", "Forecastle", "Head platform", "Bowsprit deck"];
  sections.forEach((section, roomId) => assignRoom(grid, {
    x: section.start, y: top,
    width: section.end - section.start + 1,
    height: bottom - top + 1,
  }, roomId, roles[roomId] ?? `Deck area ${roomId + 1}`));

  const featureAt = (ratio: number, feature: NonNullable<Tile["deckFeature"]>) => {
    const x = Math.max(left + 1, Math.min(right - 1,
      Math.round(left + (right - left) * ratio)));
    const current = grid[centerY]?.[x];
    if (current?.terrain === Terrain.Ground) current.deckFeature = feature;
  };
  featureAt(.08, "wheel");
  featureAt(.25, "hatch");
  featureAt(.38, "mast");
  featureAt(.54, "hatch");
  featureAt(.66, "mast");
  featureAt(.82, "capstan");
}

function hubHouseInterior(
  grid: Grid,
  bounds: Bounds,
  roomCount: number,
  random: Random,
) {
  const left = bounds.left + 1;
  const right = bounds.right - 1;
  const top = bounds.top + 1;
  const bottom = bounds.bottom - 1;
  const centerX = Math.floor((left + right) / 2) + randomInteger(random, -1, 1);
  const hallHalfWidth = randomInteger(random, 1, 2);
  const hallLeft = centerX - hallHalfWidth;
  const hallRight = centerX + hallHalfWidth;
  const livingHeight = Math.max(4, Math.min(6,
    Math.round((bottom - top + 1) * (.3 + random() * .08))));
  const livingTop = bottom - livingHeight + 1;

  horizontalWall(grid, livingTop - 1, left, right);
  verticalWall(grid, hallLeft - 1, top, livingTop - 2);
  verticalWall(grid, hallRight + 1, top, livingTop - 2);
  assignRoom(grid, {
    x: left,
    y: livingTop,
    width: right - left + 1,
    height: bottom - livingTop + 1,
  }, 0, "Living room");
  assignRoom(grid, {
    x: hallLeft,
    y: top,
    width: hallRight - hallLeft + 1,
    height: livingTop - top - 1,
  }, 1, "Hallway");
  placeDoor(grid, {
    x: centerX,
    y: livingTop - 1,
    orientation: "horizontal",
  });
  placeDoor(grid, { x: centerX, y: bounds.bottom, orientation: "horizontal" });

  const sideRoomCount = roomCount - 2;
  const leftCount = Math.max(1, Math.min(sideRoomCount - 1,
    Math.ceil(sideRoomCount / 2) + randomInteger(random, -1, 1)));
  const rightCount = sideRoomCount - leftCount;
  const leftRooms = variedPartitionRange(top, livingTop - 2, leftCount, random);
  const rightRooms = variedPartitionRange(top, livingTop - 2, rightCount, random);
  let nextRoomId = 2;
  let bedroomNumber = 1;
  const addSideRooms = (
    segments: Array<{ start: number; end: number }>,
    x: number,
    width: number,
    accessWallX: number,
  ) => {
    segments.slice(0, -1).forEach(({ end }) =>
      horizontalWall(grid, end + 1, x, x + width - 1)
    );
    segments.forEach((segment) => {
      const kitchen = nextRoomId === 2;
      assignRoom(grid, {
        x,
        y: segment.start,
        width,
        height: segment.end - segment.start + 1,
      }, nextRoomId, kitchen ? "Kitchen" : `Bedroom ${bedroomNumber++}`);
      placeDoor(grid, {
        x: accessWallX,
        y: Math.floor((segment.start + segment.end) / 2),
        orientation: "vertical",
      });
      nextRoomId += 1;
    });
  };
  addSideRooms(leftRooms, left, hallLeft - left - 1, hallLeft - 1);
  addSideRooms(rightRooms, hallRight + 2, right - hallRight - 1, hallRight + 1);
}

function crossInterior(
  grid: Grid,
  bounds: Bounds,
  roomCount: number,
  mode: "castle" | "cathedral",
  random: Random,
) {
  const left = bounds.left + 1;
  const right = bounds.right - 1;
  const top = bounds.top + 1;
  const bottom = bounds.bottom - 1;
  const centerX = Math.floor((left + right) / 2) + randomInteger(random, -1, 1);
  const centerY = Math.floor((top + bottom) / 2) + randomInteger(random, -1, 1);
  const naveHalfWidth = mode === "cathedral"
    ? Math.max(2, Math.floor((right - left + 1) * (.15 + random() * .07)))
    : Math.max(2, Math.floor((right - left + 1) * (.1 + random() * .07)));
  const transeptHalfHeight = mode === "cathedral"
    ? Math.max(2, Math.floor((bottom - top + 1) * (.08 + random() * .06)))
    : Math.max(2, Math.floor((bottom - top + 1) * (.1 + random() * .06)));
  const naveLeft = centerX - naveHalfWidth;
  const naveRight = centerX + naveHalfWidth;
  const transeptTop = centerY - transeptHalfHeight;
  const transeptBottom = centerY + transeptHalfHeight;

  verticalWall(grid, naveLeft - 1, top, transeptTop - 1);
  verticalWall(grid, naveRight + 1, top, transeptTop - 1);
  verticalWall(grid, naveLeft - 1, transeptBottom + 1, bottom);
  verticalWall(grid, naveRight + 1, transeptBottom + 1, bottom);
  horizontalWall(grid, transeptTop - 1, left, naveLeft - 1);
  horizontalWall(grid, transeptTop - 1, naveRight + 1, right);
  horizontalWall(grid, transeptBottom + 1, left, naveLeft - 1);
  horizontalWall(grid, transeptBottom + 1, naveRight + 1, right);

  const zones: Array<{ rectangle: Rectangle; access: Door }> = [
    {
      rectangle: { x: left, y: top, width: naveLeft - left - 1, height: transeptTop - top - 1 },
      access: { x: naveLeft - 1, y: Math.floor((top + transeptTop - 2) / 2), orientation: "vertical" },
    },
    {
      rectangle: { x: naveRight + 2, y: top, width: right - naveRight - 1, height: transeptTop - top - 1 },
      access: { x: naveRight + 1, y: Math.floor((top + transeptTop - 2) / 2), orientation: "vertical" },
    },
    {
      rectangle: { x: left, y: transeptBottom + 2, width: naveLeft - left - 1, height: bottom - transeptBottom - 1 },
      access: { x: naveLeft - 1, y: Math.floor((transeptBottom + 2 + bottom) / 2), orientation: "vertical" },
    },
    {
      rectangle: { x: naveRight + 2, y: transeptBottom + 2, width: right - naveRight - 1, height: bottom - transeptBottom - 1 },
      access: { x: naveRight + 1, y: Math.floor((transeptBottom + 2 + bottom) / 2), orientation: "vertical" },
    },
  ];
  const sideRoomCount = roomCount - 1;
  const allocations = zones.map(() => 1);
  for (let remaining = sideRoomCount - zones.length; remaining > 0; remaining -= 1) {
    const candidates = zones
      .map((zone, index) => ({
        index,
        capacity: zone.rectangle.width * zone.rectangle.height / allocations[index],
      }))
      .filter(({ capacity }) => capacity >= 10);
    const pool = candidates.length ? candidates : zones.map((_, index) => ({ index, capacity: 1 }));
    allocations[pool[Math.floor(random() * pool.length)].index] += 1;
  }
  const roles = mode === "cathedral"
    ? ["Sacristy", "Reliquary", "Side chapel", "Vestry", "Chapter room", "Clergy chamber", "Treasury", "Choir room"]
    : ["Guardroom", "Armory", "Kitchen", "Royal chamber", "Store room", "Barracks", "Council room", "Treasury", "Servants' hall", "Dungeon access", "Archive"];
  let nextRoomId = 1;
  zones.forEach((zone, zoneIndex) => {
    const leaves = subdivide(grid, zone.rectangle, allocations[zoneIndex], random);
    placeDoor(grid, zone.access);
    leaves.forEach((rectangle) => {
      assignRoom(
        grid,
        rectangle,
        nextRoomId,
        roles[nextRoomId - 1] ?? `Side chamber ${nextRoomId}`,
      );
      nextRoomId += 1;
    });
  });
  assignRemainingGround(
    grid,
    0,
    mode === "cathedral" ? "Nave and transept" : "Great hall and galleries",
  );
  placeDoor(grid, { x: centerX, y: bounds.bottom, orientation: "horizontal" });
}

function cryptInterior(
  grid: Grid,
  bounds: Bounds,
  roomCount: number,
  random: Random,
) {
  const left = bounds.left + 1;
  const right = bounds.right - 1;
  const top = bounds.top + 1;
  const bottom = bounds.bottom - 1;
  const corridorCenter = Math.max(left + 5, Math.min(right - 5,
    Math.floor((left + right) / 2) + randomInteger(random, -2, 2)));
  const corridorLeft = corridorCenter - randomInteger(random, 1, 2);
  const corridorRight = corridorCenter + 1;
  const entranceAtBottom = random() < .5;
  const burialVaultCount = roomCount - 2;
  const availableHeight = bottom - top + 1;
  const maximumRoomsPerSide = Math.max(1, Math.floor((availableHeight - 2) / 2));
  const preferredLeftCount = Math.floor(burialVaultCount / 2) +
    (burialVaultCount % 2 !== 0 && random() < .5 ? 1 : 0);
  const leftCount = Math.max(
    Math.max(1, burialVaultCount - maximumRoomsPerSide),
    Math.min(maximumRoomsPerSide, preferredLeftCount),
  );
  const rightCount = burialVaultCount - leftCount;
  const largestSideCount = Math.max(leftCount, rightCount);
  const maximumSanctumHeight = availableHeight - largestSideCount * 2;
  const sanctumHeight = Math.max(2, Math.min(5, maximumSanctumHeight));
  const sanctumTop = entranceAtBottom ? top : bottom - sanctumHeight + 1;
  const sanctumBottom = entranceAtBottom ? top + sanctumHeight - 1 : bottom;
  const sanctumWallY = entranceAtBottom ? sanctumBottom + 1 : sanctumTop - 1;
  const passageTop = entranceAtBottom ? sanctumWallY + 1 : top;
  const passageBottom = entranceAtBottom ? bottom : sanctumWallY - 1;

  horizontalWall(grid, sanctumWallY, left, right);
  verticalWall(grid, corridorLeft - 1, passageTop, passageBottom);
  verticalWall(grid, corridorRight + 1, passageTop, passageBottom);
  assignRoom(grid, {
    x: left,
    y: sanctumTop,
    width: right - left + 1,
    height: sanctumBottom - sanctumTop + 1,
  }, 1, "Inner sanctum");
  assignRoom(grid, {
    x: corridorLeft,
    y: passageTop,
    width: corridorRight - corridorLeft + 1,
    height: passageBottom - passageTop + 1,
  }, 0, "Processional passage");
  placeDoor(grid, {
    x: Math.floor((corridorLeft + corridorRight) / 2),
    y: sanctumWallY,
    orientation: "horizontal",
  });

  const leftSegments = variedPartitionRange(passageTop, passageBottom, leftCount, random);
  const rightSegments = rightCount
    ? variedPartitionRange(passageTop, passageBottom, rightCount, random)
    : [];
  let nextVaultId = 2;
  const addVaults = (
    segments: Array<{ start: number; end: number }>,
    x: number,
    width: number,
    wallX: number,
  ) => {
    segments.slice(0, -1).forEach(({ end }) =>
      horizontalWall(grid, end + 1, x, x + width - 1)
    );
    segments.forEach((segment) => {
      const roomId = nextVaultId++;
      assignRoom(grid, {
        x,
        y: segment.start,
        width,
        height: segment.end - segment.start + 1,
      }, roomId, `Burial vault ${roomId}`);
      placeDoor(grid, {
        x: wallX,
        y: Math.floor((segment.start + segment.end) / 2),
        orientation: "vertical",
      });
    });
  };
  addVaults(
    leftSegments,
    left,
    corridorLeft - left - 1,
    corridorLeft - 1,
  );
  addVaults(
    rightSegments,
    corridorRight + 2,
    right - corridorRight - 1,
    corridorRight + 1,
  );
  placeDoor(grid, {
    x: Math.floor((corridorLeft + corridorRight) / 2),
    y: entranceAtBottom ? bounds.bottom : bounds.top,
    orientation: "horizontal",
  });
}

export function generateInterior(
  grid: Grid,
  requestedRoomCount: number,
  random: Random,
  mode: InteriorMode,
) {
  initialize(grid);
  const bounds = buildingBounds(grid, random);
  buildShell(grid, bounds);
  const limits = INTERIOR_ROOM_LIMITS[mode];
  const roomCount = Math.max(
    limits.minimum,
    Math.min(limits.maximum, Math.round(requestedRoomCount)),
  );

  if (mode === "house") {
    if (random() < .5) houseInterior(grid, bounds, roomCount, random);
    else hubHouseInterior(grid, bounds, roomCount, random);
  } else if (mode === "tavern") {
    tavernInterior(grid, bounds, roomCount, random);
  } else if (mode === "spaceship") {
    spaceshipInterior(grid, bounds, roomCount, random);
  } else if (mode === "ship") {
    axialInterior(grid, bounds, roomCount, mode, random);
  } else if (mode === "ship-deck") {
    sailingShipDeck(grid, bounds, roomCount, random);
  } else if (mode === "castle" || mode === "cathedral") {
    crossInterior(grid, bounds, roomCount, mode, random);
  } else {
    cryptInterior(grid, bounds, roomCount, random);
  }
  if (mode === "ship" || mode === "ship-deck" || mode === "spaceship") {
    shapeVesselHull(grid, bounds, mode, random);
    if (mode !== "ship-deck") chamferVesselRooms(grid, random);
  }
  repairBlockedInternalDoors(grid);
  mirrorInterior(grid, random);
  decorateInterior(grid, mode, random);
  if (mode === "ship" || mode === "ship-deck") {
    // Both sailing-ship views are presented afloat. The hull walls remain the
    // boundary while water replaces the opaque backdrop used by buildings.
    for (const row of grid) {
      for (const current of row) {
        if (current.terrain === Terrain.Void) {
          current.terrain = Terrain.Water;
          current.height = .16;
        }
      }
    }
  }
}
