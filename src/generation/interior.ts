import {
  Obstacle,
  Terrain,
  type Grid,
  type Tile,
} from "../domain/map";
import type { Random } from "./types";

type Room = { x: number; y: number; width: number; height: number };

const MINIMUM_ROOM_SPAN = 3;

function floorTile(): Tile {
  return {
    terrain: Terrain.Ground,
    obstacle: Obstacle.None,
    height: .32,
  };
}

function architectureTile(terrain: typeof Terrain.Wall | typeof Terrain.Door): Tile {
  return {
    terrain,
    obstacle: Obstacle.None,
    height: terrain === Terrain.Wall ? .82 : .48,
  };
}

function randomInteger(random: Random, minimum: number, maximum: number) {
  return minimum + Math.floor(random() * (maximum - minimum + 1));
}

function splitRoom(
  room: Room,
  random: Random,
): { rooms: [Room, Room]; wall: Room; door: { x: number; y: number; orientation: "horizontal" | "vertical" } } | undefined {
  const canSplitVertically = room.width >= MINIMUM_ROOM_SPAN * 2 + 1;
  const canSplitHorizontally = room.height >= MINIMUM_ROOM_SPAN * 2 + 1;
  if (!canSplitVertically && !canSplitHorizontally) return undefined;

  const vertical = canSplitVertically && (
    !canSplitHorizontally ||
    room.width / room.height > 1.3 ||
    (room.height / room.width <= 1.3 && random() < .5)
  );

  if (vertical) {
    const wallX = randomInteger(
      random,
      room.x + MINIMUM_ROOM_SPAN,
      room.x + room.width - MINIMUM_ROOM_SPAN - 1,
    );
    const doorY = randomInteger(random, room.y + 1, room.y + room.height - 2);
    return {
      rooms: [
        { ...room, width: wallX - room.x },
        {
          x: wallX + 1,
          y: room.y,
          width: room.x + room.width - wallX - 1,
          height: room.height,
        },
      ],
      wall: { x: wallX, y: room.y, width: 1, height: room.height },
      door: { x: wallX, y: doorY, orientation: "vertical" },
    };
  }

  const wallY = randomInteger(
    random,
    room.y + MINIMUM_ROOM_SPAN,
    room.y + room.height - MINIMUM_ROOM_SPAN - 1,
  );
  const doorX = randomInteger(random, room.x + 1, room.x + room.width - 2);
  return {
    rooms: [
      { ...room, height: wallY - room.y },
      {
        x: room.x,
        y: wallY + 1,
        width: room.width,
        height: room.y + room.height - wallY - 1,
      },
    ],
    wall: { x: room.x, y: wallY, width: room.width, height: 1 },
    door: { x: doorX, y: wallY, orientation: "horizontal" },
  };
}

function paintRectangle(
  grid: Grid,
  rectangle: Room,
  tile: () => Tile,
) {
  for (let y = rectangle.y; y < rectangle.y + rectangle.height; y += 1) {
    for (let x = rectangle.x; x < rectangle.x + rectangle.width; x += 1) {
      grid[y][x] = tile();
    }
  }
}

function addExteriorEntrance(
  grid: Grid,
  bounds: { left: number; top: number; right: number; bottom: number },
  random: Random,
) {
  const edge = randomInteger(random, 0, 3);
  const candidates: Array<{ x: number; y: number; orientation: "horizontal" | "vertical" }> = [];
  if (edge === 0 || edge === 2) {
    const y = edge === 0 ? bounds.top : bounds.bottom;
    const insideY = edge === 0 ? y + 1 : y - 1;
    for (let x = bounds.left + 2; x <= bounds.right - 2; x += 1) {
      if (grid[insideY][x].terrain === Terrain.Ground) {
        candidates.push({ x, y, orientation: "horizontal" });
      }
    }
  } else {
    const x = edge === 1 ? bounds.right : bounds.left;
    const insideX = edge === 1 ? x - 1 : x + 1;
    for (let y = bounds.top + 2; y <= bounds.bottom - 2; y += 1) {
      if (grid[y][insideX].terrain === Terrain.Ground) {
        candidates.push({ x, y, orientation: "vertical" });
      }
    }
  }
  const entrance = candidates[randomInteger(random, 0, candidates.length - 1)];
  if (!entrance) return;
  grid[entrance.y][entrance.x] = {
    ...architectureTile(Terrain.Door),
    doorOrientation: entrance.orientation,
  };
}

function repairBlockedInternalDoors(grid: Grid) {
  const doors: Array<{ x: number; y: number; orientation: "horizontal" | "vertical" }> = [];
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      const tile = grid[y][x];
      if (tile.terrain === Terrain.Door && tile.doorOrientation) {
        doors.push({ x, y, orientation: tile.doorOrientation });
      }
    }
  }
  const isFloor = (x: number, y: number) =>
    grid[y]?.[x]?.terrain === Terrain.Ground;
  const isWallLine = (x: number, y: number) => {
    const terrain = grid[y]?.[x]?.terrain;
    return terrain === Terrain.Wall || terrain === Terrain.Door;
  };

  for (const door of doors) {
    const opensCorrectly = door.orientation === "horizontal"
      ? isFloor(door.x, door.y - 1) && isFloor(door.x, door.y + 1)
      : isFloor(door.x - 1, door.y) && isFloor(door.x + 1, door.y);
    if (opensCorrectly) continue;

    const candidates: Array<{ x: number; y: number }> = [];
    const maximumDistance = door.orientation === "horizontal"
      ? grid[door.y].length
      : grid.length;
    for (let distance = 1; distance < maximumDistance; distance += 1) {
      for (const direction of [-1, 1]) {
        const x = door.orientation === "horizontal"
          ? door.x + distance * direction
          : door.x;
        const y = door.orientation === "vertical"
          ? door.y + distance * direction
          : door.y;
        if (!isWallLine(x, y)) continue;
        const valid = door.orientation === "horizontal"
          ? isFloor(x, y - 1) && isFloor(x, y + 1)
          : isFloor(x - 1, y) && isFloor(x + 1, y);
        if (valid) candidates.push({ x, y });
      }
      if (candidates.length) break;
    }
    const replacement = candidates[0];
    if (!replacement) continue;
    grid[door.y][door.x] = architectureTile(Terrain.Wall);
    grid[replacement.y][replacement.x] = {
      ...architectureTile(Terrain.Door),
      doorOrientation: door.orientation,
    };
  }
}

export function generateHouseInterior(
  grid: Grid,
  requestedRoomCount: number,
  random: Random,
) {
  const height = grid.length;
  const width = grid[0].length;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      grid[y][x] = {
        terrain: Terrain.Void,
        obstacle: Obstacle.None,
        height: .08,
      };
    }
  }

  const marginX = width >= 24 ? 2 : 1;
  const marginY = height >= 18 ? 2 : 1;
  const bounds = {
    left: marginX,
    top: marginY,
    right: width - marginX - 1,
    bottom: height - marginY - 1,
  };
  const interior: Room = {
    x: bounds.left + 1,
    y: bounds.top + 1,
    width: bounds.right - bounds.left - 1,
    height: bounds.bottom - bounds.top - 1,
  };
  paintRectangle(grid, interior, floorTile);

  for (let x = bounds.left; x <= bounds.right; x += 1) {
    grid[bounds.top][x] = architectureTile(Terrain.Wall);
    grid[bounds.bottom][x] = architectureTile(Terrain.Wall);
  }
  for (let y = bounds.top; y <= bounds.bottom; y += 1) {
    grid[y][bounds.left] = architectureTile(Terrain.Wall);
    grid[y][bounds.right] = architectureTile(Terrain.Wall);
  }

  const targetRoomCount = Math.max(2, Math.min(12, Math.round(requestedRoomCount)));
  const rooms = [interior];
  while (rooms.length < targetRoomCount) {
    const candidates = rooms
      .map((room, index) => ({ room, index, split: splitRoom(room, random) }))
      .filter((candidate) => candidate.split)
      .sort((a, b) =>
        b.room.width * b.room.height - a.room.width * a.room.height
      );
    const candidate = candidates[0];
    if (!candidate?.split) break;
    const { rooms: childRooms, wall, door } = candidate.split;
    paintRectangle(grid, wall, () => architectureTile(Terrain.Wall));
    grid[door.y][door.x] = {
      ...architectureTile(Terrain.Door),
      doorOrientation: door.orientation,
    };
    rooms.splice(candidate.index, 1, ...childRooms);
  }

  rooms.forEach((room, roomId) => {
    for (let y = room.y; y < room.y + room.height; y += 1) {
      for (let x = room.x; x < room.x + room.width; x += 1) {
        if (grid[y][x].terrain === Terrain.Ground) grid[y][x].roomId = roomId;
      }
    }
  });
  repairBlockedInternalDoors(grid);
  addExteriorEntrance(grid, bounds, random);
}
