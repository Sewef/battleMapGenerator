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
import { decorateSailingShipDeck } from "./ship-deck";

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

function buildingBounds(grid: Grid, random: Random, mode?: InteriorMode): Bounds {
  const maximumMarginX = grid[0].length >= 32 ? 3 : grid[0].length >= 24 ? 2 : 1;
  const deckMarginY = grid.length >= 20 ? 4 : grid.length >= 16 ? 3 : 2;
  const maximumMarginY = mode === "ship-deck"
    ? deckMarginY
    : grid.length >= 24 ? 3 : grid.length >= 18 ? 2 : 1;
  const minimumMarginY = mode === "ship-deck" ? Math.max(2, maximumMarginY - 1) : 1;
  const left = randomInteger(random, 1, maximumMarginX);
  const top = randomInteger(random, minimumMarginY, maximumMarginY);
  const rightMargin = randomInteger(random, 1, maximumMarginX);
  const bottomMargin = randomInteger(random, minimumMarginY, maximumMarginY);
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

// Keep openings away from wall junctions whenever the room has enough space.
// Corner doors were the main source of layouts that were technically connected
// but read as accidental or structurally implausible.
function doorwayPosition(random: Random, minimum: number, maximum: number) {
  const inset = maximum - minimum >= 3 ? 1 : 0;
  return randomInteger(random, minimum + inset, maximum - inset);
}

function subdivisionCapacity(rectangle: Rectangle) {
  // Every leaf needs two floor cells along each split axis, with one wall cell
  // between neighboring leaves. Keeping this capacity invariant while splitting
  // prevents a balanced early cut from making the requested room count
  // impossible later on.
  const columns = Math.max(1, Math.floor((rectangle.width + 1) / 3));
  const rows = Math.max(1, Math.floor((rectangle.height + 1) / 3));
  return columns * rows;
}

function splitRectangle(
  rectangle: Rectangle,
  random: Random,
): { rooms: [Rectangle, Rectangle]; wall: Rectangle; door: Door } | undefined {
  const minimumSpan = 2;
  type Candidate = {
    rooms: [Rectangle, Rectangle];
    wall: Rectangle;
    orientation: Door["orientation"];
    capacity: number;
    balance: number;
    orientationPenalty: number;
    order: number;
  };
  const candidates: Candidate[] = [];
  for (
    let wallX = rectangle.x + minimumSpan;
    wallX <= rectangle.x + rectangle.width - minimumSpan - 1;
    wallX += 1
  ) {
    const rooms: [Rectangle, Rectangle] = [
      { ...rectangle, width: wallX - rectangle.x },
      {
        x: wallX + 1,
        y: rectangle.y,
        width: rectangle.x + rectangle.width - wallX - 1,
        height: rectangle.height,
      },
    ];
    candidates.push({
      rooms,
      wall: { x: wallX, y: rectangle.y, width: 1, height: rectangle.height },
      orientation: "vertical",
      capacity: rooms.reduce((sum, room) => sum + subdivisionCapacity(room), 0),
      balance: Math.abs(rooms[0].width - rooms[1].width),
      orientationPenalty: rectangle.width >= rectangle.height ? 0 : 1,
      order: random(),
    });
  }
  for (
    let wallY = rectangle.y + minimumSpan;
    wallY <= rectangle.y + rectangle.height - minimumSpan - 1;
    wallY += 1
  ) {
    const rooms: [Rectangle, Rectangle] = [
      { ...rectangle, height: wallY - rectangle.y },
      {
        x: rectangle.x,
        y: wallY + 1,
        width: rectangle.width,
        height: rectangle.y + rectangle.height - wallY - 1,
      },
    ];
    candidates.push({
      rooms,
      wall: { x: rectangle.x, y: wallY, width: rectangle.width, height: 1 },
      orientation: "horizontal",
      capacity: rooms.reduce((sum, room) => sum + subdivisionCapacity(room), 0),
      balance: Math.abs(rooms[0].height - rooms[1].height),
      orientationPenalty: rectangle.height >= rectangle.width ? 0 : 1,
      order: random(),
    });
  }
  const maximumCapacity = Math.max(...candidates.map(({ capacity }) => capacity), 0);
  const selected = candidates
    .filter(({ capacity }) => capacity === maximumCapacity)
    .sort((first, second) =>
      first.orientationPenalty - second.orientationPenalty ||
      first.balance - second.balance || first.order - second.order
    )[0];
  if (!selected) return undefined;
  const vertical = selected.orientation === "vertical";
  return {
    rooms: selected.rooms,
    wall: selected.wall,
    door: vertical
      ? {
        x: selected.wall.x,
        y: doorwayPosition(random, rectangle.y, rectangle.y + rectangle.height - 1),
        orientation: "vertical",
      }
      : {
        x: doorwayPosition(random, rectangle.x, rectangle.x + rectangle.width - 1),
        y: selected.wall.y,
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

function balancedModuleCounts(moduleCount: number, random: Random) {
  // Both vessel layouts give each side the same longitudinal span. Keeping the
  // split balanced is therefore the only way to preserve useful compartment
  // widths on the 24-cell presets (the old +/- 1 variation could make a 6/4
  // spaceship split, leaving one-cell-wide functional rooms).
  const smaller = Math.floor(moduleCount / 2);
  const larger = moduleCount - smaller;
  return moduleCount % 2 !== 0 && random() < .5
    ? { upper: larger, lower: smaller }
    : { upper: smaller, lower: larger };
}

function bowWeightedPartitionRange(
  start: number,
  end: number,
  count: number,
  random: Random,
) {
  const partitions = variedPartitionRange(start, end, count, random);
  if (partitions.length < 2) return partitions;
  const sizes = partitions.map((segment) => segment.end - segment.start + 1);
  // The sailing hull loses several cells at the pointed bow after rooms are
  // assigned. Give its terminal module a small allowance taken from roomy
  // interior modules, while never reducing another compartment below width 2.
  for (let moved = 0; moved < 2; moved += 1) {
    const donors = sizes.slice(0, -1)
      .map((size, index) => ({ size, index, order: random() }))
      .filter(({ size }) => size > 2)
      .sort((first, second) => second.size - first.size || first.order - second.order);
    if (!donors.length) break;
    sizes[donors[0].index] -= 1;
    sizes[sizes.length - 1] += 1;
  }
  const weighted: Array<{ start: number; end: number }> = [];
  let cursor = start;
  for (const size of sizes) {
    weighted.push({ start: cursor, end: cursor + size - 1 });
    cursor += size + 1;
  }
  return weighted;
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
  const minimumWidth = mode === "ship-deck" ? 20 : 26;
  const minimumHeight = mode === "ship-deck" ? 7 : 10;
  if (bounds.right - bounds.left < minimumWidth ||
    bounds.bottom - bounds.top < minimumHeight) return;
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
  const interiorHeight = bottom - top + 1;
  // A four-cell gangway only fits comfortably once both banks retain useful
  // depth. Compact ships use three cells and keep a three-cell-deep cabin bank.
  const upperGangwayDepth = interiorHeight <= 12 ? 1 : randomInteger(random, 1, 2);
  const minimumBankDepth = 3;
  const minimumCenter = top + upperGangwayDepth + minimumBankDepth + 1;
  const maximumCenter = bottom - minimumBankDepth - 2;
  const corridorCenter = Math.max(minimumCenter, Math.min(maximumCenter,
    Math.floor((top + bottom) / 2) + randomInteger(random, -2, 2)));
  const corridorTop = corridorCenter - upperGangwayDepth;
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
  const { upper: upperCount, lower: lowerCount } =
    balancedModuleCounts(moduleCount, random);
  const partition = mode === "ship" ? bowWeightedPartitionRange : variedPartitionRange;
  const upper = partition(left, right, upperCount, random);
  const lower = lowerCount ? partition(left, right, lowerCount, random) : [];
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
  const moduleCount = roomCount - 2;
  const { upper: upperCount, lower: lowerCount } =
    balancedModuleCounts(moduleCount, random);
  const largestSideCount = Math.max(upperCount, lowerCount);
  const minimumModuleSpan = largestSideCount * 2 + Math.max(0, largestSideCount - 1);
  const preferredCockpitWidth = Math.max(4, Math.min(6,
    Math.round((right - left + 1) * (.14 + random() * .05))));
  // Reserve two floor cells per module plus their separating walls. On the
  // minimum 24x16 map this only contracts the cockpit from four cells to three
  // for the 11/12-room layouts; roomier ships keep the original proportions.
  const maximumCockpitWidth = Math.max(2,
    right - left + 1 - 1 - minimumModuleSpan);
  const cockpitWidth = Math.min(preferredCockpitWidth, maximumCockpitWidth);
  const cockpitWall = right - cockpitWidth;
  const minimumBankDepth = 3;
  const minimumCenter = top + minimumBankDepth + 2;
  const maximumCenter = bottom - minimumBankDepth - 2;
  const corridorCenter = Math.max(minimumCenter, Math.min(maximumCenter,
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
  const rolePatterns: Record<number, string[]> = {
    4: ["Quarterdeck", "Aft waist", "Main deck", "Forecastle"],
    5: ["Quarterdeck", "Aft waist", "Main deck", "Fore waist", "Forecastle"],
    6: ["Quarterdeck", "Aft waist", "Main deck", "Boat deck", "Fore waist", "Forecastle"],
    7: ["Quarterdeck", "Aft waist", "Main deck", "Boat deck", "Fore waist",
      "Forecastle", "Head platform"],
    8: ["Quarterdeck", "Aft waist", "Main deck", "Boat deck", "Fore waist",
      "Forecastle", "Head platform", "Bowsprit deck"],
  };
  const roles = rolePatterns[areaCount] ?? rolePatterns[6];
  sections.forEach((section, roomId) => assignRoom(grid, {
    x: section.start, y: top,
    width: section.end - section.start + 1,
    height: bottom - top + 1,
  }, roomId, roles[roomId] ?? `Deck area ${roomId + 1}`));

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
  const sideRoomCount = roomCount - 2;
  const largestSideCount = Math.ceil(sideRoomCount / 2);
  // Each side-room needs at least two floor rows, with a wall between rooms.
  // On the compact seven-room preset this deliberately contracts the living
  // room from four rows to three instead of producing one-row bedroom strips.
  const minimumSideHeight = largestSideCount * 2 + (largestSideCount - 1);
  const maximumLivingHeight = bottom - top + 1 - minimumSideHeight - 1;
  const preferredLivingHeight = Math.max(4, Math.min(6,
    Math.round((bottom - top + 1) * (.3 + random() * .08))));
  const livingHeight = Math.max(3, Math.min(preferredLivingHeight, maximumLivingHeight));
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

  const sideHeight = livingTop - top - 1;
  const maximumRoomsPerSide = Math.max(1, Math.floor((sideHeight + 1) / 3));
  const preferredLeftCount = Math.ceil(sideRoomCount / 2) + randomInteger(random, -1, 1);
  const leftCount = Math.max(
    Math.max(1, sideRoomCount - maximumRoomsPerSide),
    Math.min(maximumRoomsPerSide, sideRoomCount - 1, preferredLeftCount),
  );
  const rightCount = sideRoomCount - leftCount;
  const leftRooms = variedPartitionRange(top, livingTop - 2, leftCount, random);
  const rightRooms = variedPartitionRange(top, livingTop - 2, rightCount, random);
  const leftRoomWidth = hallLeft - left - 1;
  const rightRoomWidth = right - hallRight - 1;
  const preferredKitchenArea = Math.max(18, Math.min(42,
    Math.round((right - left + 1) * sideHeight * .18)));
  const kitchenCandidates = [
    ...leftRooms.map((segment) => ({ segment, side: "left" as const,
      area: (segment.end - segment.start + 1) * leftRoomWidth })),
    ...rightRooms.map((segment) => ({ segment, side: "right" as const,
      area: (segment.end - segment.start + 1) * rightRoomWidth })),
  ];
  const viableKitchenCandidates = kitchenCandidates.filter(({ area }) => area >= 18);
  const kitchenCandidate = (viableKitchenCandidates.length
    ? viableKitchenCandidates
    : kitchenCandidates).sort((a, b) => Math.abs(a.area - preferredKitchenArea) -
    Math.abs(b.area - preferredKitchenArea) || b.area - a.area)[0];
  let nextRoomId = 2;
  let bedroomNumber = 1;
  const addSideRooms = (
    segments: Array<{ start: number; end: number }>,
    x: number,
    width: number,
    accessWallX: number,
    kitchenSegment?: { start: number; end: number },
  ) => {
    segments.slice(0, -1).forEach(({ end }) =>
      horizontalWall(grid, end + 1, x, x + width - 1)
    );
    segments.forEach((segment) => {
      const kitchen = segment === kitchenSegment;
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
  addSideRooms(leftRooms, left, leftRoomWidth, hallLeft - 1,
    kitchenCandidate.side === "left" ? kitchenCandidate.segment : undefined);
  addSideRooms(rightRooms, hallRight + 2, rightRoomWidth, hallRight + 1,
    kitchenCandidate.side === "right" ? kitchenCandidate.segment : undefined);
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
        roomCapacity: subdivisionCapacity(zone.rectangle),
        order: random(),
      }))
      .filter(({ index, roomCapacity }) => allocations[index] < roomCapacity)
      .sort((first, second) =>
        second.capacity - first.capacity || first.order - second.order
      );
    const selected = candidates[0];
    if (!selected) break;
    allocations[selected.index] += 1;
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
  // Reserve two floor rows per vault plus the partition walls between them.
  // The former `2 * count` allowance occasionally left a final 11x1 burial
  // niche on shells with large top/bottom margins.
  const maximumSanctumHeight = availableHeight - largestSideCount * 3;
  const sanctumHeight = Math.max(2, Math.min(5, maximumSanctumHeight));
  const sanctumTop = entranceAtBottom ? top : bottom - sanctumHeight + 1;
  const sanctumBottom = entranceAtBottom ? top + sanctumHeight - 1 : bottom;
  const sanctumWallY = entranceAtBottom ? sanctumBottom + 1 : sanctumTop - 1;
  const passageTop = entranceAtBottom ? sanctumWallY + 1 : top;
  const passageBottom = entranceAtBottom ? bottom : sanctumWallY - 1;
  const passageLeft = leftCount ? corridorLeft : left;
  const passageRight = rightCount ? corridorRight : right;

  horizontalWall(grid, sanctumWallY, left, right);
  if (leftCount) verticalWall(grid, corridorLeft - 1, passageTop, passageBottom);
  if (rightCount) verticalWall(grid, corridorRight + 1, passageTop, passageBottom);
  assignRoom(grid, {
    x: left,
    y: sanctumTop,
    width: right - left + 1,
    height: sanctumBottom - sanctumTop + 1,
  }, 1, "Inner sanctum");
  assignRoom(grid, {
    x: passageLeft,
    y: passageTop,
    width: passageRight - passageLeft + 1,
    height: passageBottom - passageTop + 1,
  }, 0, "Processional passage");
  placeDoor(grid, {
    x: Math.floor((passageLeft + passageRight) / 2),
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
    x: Math.floor((passageLeft + passageRight) / 2),
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
  const bounds = buildingBounds(grid, random, mode);
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
  if (mode === "ship-deck") decorateSailingShipDeck(grid, random);
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
