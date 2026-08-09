import {
  Terrain,
  type Grid,
  type InteriorMode,
  type Tile,
} from "../domain/map";
import type { Random } from "./types";

type Point = { x: number; y: number };
type PropKind = NonNullable<Tile["interiorProp"]>;
type Orientation = NonNullable<Tile["propOrientation"]>;
type Room = {
  id: number;
  role: string;
  cells: Point[];
  left: number;
  right: number;
  top: number;
  bottom: number;
};

const key = ({ x, y }: Point) => `${x},${y}`;
const neighbors = ({ x, y }: Point): Point[] => [
  { x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 },
];

function collectRooms(grid: Grid) {
  const cellsByRoom = new Map<number, Point[]>();
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      const tile = grid[y][x];
      if (tile.terrain !== Terrain.Ground || tile.roomId === undefined) continue;
      const cells = cellsByRoom.get(tile.roomId) ?? [];
      cells.push({ x, y });
      cellsByRoom.set(tile.roomId, cells);
    }
  }
  return [...cellsByRoom.entries()].map(([id, cells]): Room => ({
    id,
    role: grid[cells[0].y][cells[0].x].roomRole ?? "",
    cells,
    left: Math.min(...cells.map(({ x }) => x)),
    right: Math.max(...cells.map(({ x }) => x)),
    top: Math.min(...cells.map(({ y }) => y)),
    bottom: Math.max(...cells.map(({ y }) => y)),
  }));
}

function shuffled<T>(values: T[], random: Random) {
  return [...values]
    .map((value) => ({ value, order: random() }))
    .sort((a, b) => a.order - b.order)
    .map(({ value }) => value);
}

function reserveCirculation(grid: Grid, rooms: Room[]) {
  const reserved = new Set<string>();
  const doorClearance = new Set<string>();
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      if (grid[y][x].terrain !== Terrain.Door) continue;
      const exteriorDoor = neighbors({ x, y }).some((point) =>
        grid[point.y]?.[point.x]?.terrain === Terrain.Void);
      const clearanceRadius = exteriorDoor ? 2 : 1;
      for (let offsetY = -clearanceRadius; offsetY <= clearanceRadius; offsetY += 1) {
        for (let offsetX = -clearanceRadius; offsetX <= clearanceRadius; offsetX += 1) {
          if (grid[y + offsetY]?.[x + offsetX]?.terrain === Terrain.Ground) {
            reserved.add(`${x + offsetX},${y + offsetY}`);
            doorClearance.add(`${x + offsetX},${y + offsetY}`);
          }
        }
      }
    }
  }
  for (const room of rooms) {
    if (/Nave and transept/i.test(room.role)) continue;
    const roomKeys = new Set(room.cells.map(key));
    const doorApproaches = room.cells.filter((point) =>
      neighbors(point).some(({ x, y }) => grid[y]?.[x]?.terrain === Terrain.Door));
    if (doorApproaches.length < 2) continue;
    const start = doorApproaches[0];
    for (const target of doorApproaches.slice(1)) {
      const queue = [start];
      const previous = new Map<string, string>();
      const visited = new Set([key(start)]);
      for (let index = 0; index < queue.length; index += 1) {
        const current = queue[index];
        if (key(current) === key(target)) break;
        for (const next of neighbors(current)) {
          const nextKey = key(next);
          if (!roomKeys.has(nextKey) || visited.has(nextKey)) continue;
          visited.add(nextKey);
          previous.set(nextKey, key(current));
          queue.push(next);
        }
      }
      let cursor = key(target);
      while (cursor !== key(start) && previous.has(cursor)) {
        reserved.add(cursor);
        cursor = previous.get(cursor)!;
      }
      reserved.add(key(start));
    }
  }
  return { reserved, doorClearance };
}

export function decorateInterior(grid: Grid, mode: InteriorMode, random: Random) {
  if (mode === "ship-deck") return;
  const rooms = collectRooms(grid);
  const { reserved, doorClearance } = reserveCirculation(grid, rooms);
  let nextPropId = 1;

  const availableWithMask = (
    room: Room,
    points: Point[],
    reservationMask: Set<string>,
  ) => points.every(({ x, y }) => {
    const tile = grid[y]?.[x];
    return tile?.terrain === Terrain.Ground && tile.roomId === room.id &&
      !tile.interiorProp && !reservationMask.has(`${x},${y}`);
  });
  const available = (room: Room, points: Point[]) =>
    availableWithMask(room, points, reserved);
  const roomRemainsConnected = (room: Room, proposed: Point[]) => {
    const blocked = new Set([
      ...room.cells.filter(({ x, y }) => Boolean(grid[y][x].interiorProp)).map(key),
      ...proposed.map(key),
    ]);
    const freeCells = new Set(room.cells.map(key).filter((cellKey) => !blocked.has(cellKey)));
    const start = freeCells.values().next().value as string | undefined;
    if (!start) return false;
    const reached = new Set([start]);
    const queue = [start];
    for (let index = 0; index < queue.length; index += 1) {
      const [x, y] = queue[index].split(",").map(Number);
      for (const next of neighbors({ x, y })) {
        const nextKey = key(next);
        if (freeCells.has(nextKey) && !reached.has(nextKey)) {
          reached.add(nextKey);
          queue.push(nextKey);
        }
      }
    }
    return reached.size === freeCells.size;
  };
  type PlannedProp = {
    kind: PropKind;
    points: Point[];
    orientation: Orientation;
    facing?: NonNullable<Tile["propFacing"]>;
  };
  const commitProp = ({ kind, points, orientation, facing }: PlannedProp) => {
    const propId = nextPropId++;
    for (const { x, y } of points) {
      grid[y][x].interiorProp = kind;
      grid[y][x].interiorPropId = propId;
      grid[y][x].propOrientation = orientation;
      grid[y][x].propFacing = facing;
    }
  };
  const placeComposition = (
    room: Room,
    props: PlannedProp[],
    reservationMask = reserved,
  ) => {
    const points = props.flatMap((prop) => prop.points);
    if (!points.length || new Set(points.map(key)).size !== points.length ||
      !points.every(({ x, y }) => {
        const tile = grid[y]?.[x];
        return tile?.terrain === Terrain.Ground && tile.roomId === room.id &&
          !tile.interiorProp && !reservationMask.has(`${x},${y}`);
      }) || !roomRemainsConnected(room, points)) return false;
    props.forEach(commitProp);
    return true;
  };
  const place = (
    room: Room,
    kind: PropKind,
    points: Point[],
    orientation: Orientation,
    facing?: NonNullable<Tile["propFacing"]>,
  ) => placeComposition(room, [{ kind, points, orientation, facing }]);
  const pointInRoom = (room: Room, x: number, y: number) =>
    grid[y]?.[x]?.terrain === Terrain.Ground && grid[y][x].roomId === room.id;

  const wallAnchors = (room: Room) => shuffled(room.cells.flatMap((point) => {
    const anchors: Array<{ head: Point; dx: number; dy: number; orientation: Orientation; facing: NonNullable<Tile["propFacing"]> }> = [];
    if (grid[point.y - 1]?.[point.x]?.terrain === Terrain.Wall) {
      anchors.push({ head: point, dx: 0, dy: 1, orientation: "vertical", facing: "north" });
    }
    if (grid[point.y + 1]?.[point.x]?.terrain === Terrain.Wall) {
      anchors.push({ head: point, dx: 0, dy: -1, orientation: "vertical", facing: "south" });
    }
    if (grid[point.y]?.[point.x - 1]?.terrain === Terrain.Wall) {
      anchors.push({ head: point, dx: 1, dy: 0, orientation: "horizontal", facing: "west" });
    }
    if (grid[point.y]?.[point.x + 1]?.terrain === Terrain.Wall) {
      anchors.push({ head: point, dx: -1, dy: 0, orientation: "horizontal", facing: "east" });
    }
    return anchors;
  }), random);

  const placeWallDepth = (room: Room, kind: PropKind, depth: number, count: number) => {
    let placed = 0;
    const doorApproaches = room.cells.filter((point) =>
      neighbors(point).some(({ x, y }) => grid[y]?.[x]?.terrain === Terrain.Door));
    const scoredAnchors = wallAnchors(room).map((anchor) => {
      const points = Array.from({ length: depth }, (_, index) => ({
        x: anchor.head.x + anchor.dx * index,
        y: anchor.head.y + anchor.dy * index,
      }));
      const sideDirections = anchor.orientation === "vertical"
        ? [{ x: -1, y: 0 }, { x: 1, y: 0 }]
        : [{ x: 0, y: -1 }, { x: 0, y: 1 }];
      const hugsSideWall = sideDirections.some((side) => points.every((point) =>
        grid[point.y + side.y]?.[point.x + side.x]?.terrain === Terrain.Wall));
      const doorDistance = doorApproaches.length
        ? Math.min(...doorApproaches.map((door) =>
          Math.abs(door.x - anchor.head.x) + Math.abs(door.y - anchor.head.y)))
        : 0;
      return { anchor, points, score: (hugsSideWall ? 100 : 0) + doorDistance * 3 + random() };
    }).sort((a, b) => b.score - a.score);
    for (const { anchor, points } of scoredAnchors) {
      const footClearance = {
        x: anchor.head.x + anchor.dx * depth,
        y: anchor.head.y + anchor.dy * depth,
      };
      if (!pointInRoom(room, footClearance.x, footClearance.y) ||
        !available(room, [footClearance])) continue;
      if (!place(room, kind, points, anchor.orientation, anchor.facing)) continue;
      reserved.add(key(footClearance));
      if (++placed >= count) break;
    }
    return placed;
  };

  const wallRuns = (room: Room) => {
    const runs: Array<{ points: Point[]; orientation: Orientation; facing: NonNullable<Tile["propFacing"]> }> = [];
    for (const y of [room.top, room.bottom]) {
      let run: Point[] = [];
      for (let x = room.left; x <= room.right + 1; x += 1) {
        const valid = x <= room.right && pointInRoom(room, x, y) &&
          (grid[y + (y === room.top ? -1 : 1)]?.[x]?.terrain === Terrain.Wall);
        if (valid) run.push({ x, y });
        else if (run.length) {
          runs.push({ points: run, orientation: "horizontal", facing: y === room.top ? "south" : "north" });
          run = [];
        }
      }
    }
    for (const x of [room.left, room.right]) {
      let run: Point[] = [];
      for (let y = room.top; y <= room.bottom + 1; y += 1) {
        const valid = y <= room.bottom && pointInRoom(room, x, y) &&
          (grid[y]?.[x + (x === room.left ? -1 : 1)]?.terrain === Terrain.Wall);
        if (valid) run.push({ x, y });
        else if (run.length) {
          runs.push({ points: run, orientation: "vertical", facing: x === room.left ? "east" : "west" });
          run = [];
        }
      }
    }
    return runs.sort((a, b) => b.points.length - a.points.length);
  };

  const placeWallRun = (
    room: Room,
    kind: PropKind,
    minimum: number,
    maximum: number,
    preferredNeighbor?: RegExp,
  ) => {
    const neighborScore = (run: { points: Point[] }) => preferredNeighbor
      ? run.points.filter(({ x, y }) => [
        [0, -1], [0, 1], [-1, 0], [1, 0],
      ].some(([dx, dy]) => grid[y + dy]?.[x + dx]?.terrain === Terrain.Wall &&
        preferredNeighbor.test(grid[y + dy * 2]?.[x + dx * 2]?.roomRole ?? ""))).length
      : 0;
    const orderedRuns = wallRuns(room).sort((a, b) =>
      neighborScore(b) - neighborScore(a) || b.points.length - a.points.length);
    for (const run of orderedRuns) {
      const usableRuns: Point[][] = [];
      let current: Point[] = [];
      for (const point of run.points) {
        if (available(room, [point])) current.push(point);
        else if (current.length) { usableRuns.push(current); current = []; }
      }
      if (current.length) usableRuns.push(current);
      for (const usable of usableRuns.sort((a, b) => b.length - a.length)) {
        for (let length = Math.min(maximum, usable.length); length >= minimum; length -= 1) {
          const starts = Array.from(
            { length: usable.length - length + 1 },
            (_, index) => index,
          ).sort((a, b) => Math.abs(a + length / 2 - usable.length / 2) -
            Math.abs(b + length / 2 - usable.length / 2));
          for (const start of starts) {
            const points = usable.slice(start, start + length);
            const inward = run.facing === "north" ? { x: 0, y: -1 }
              : run.facing === "east" ? { x: 1, y: 0 }
                : run.facing === "south" ? { x: 0, y: 1 }
                  : { x: -1, y: 0 };
            const clearFrontage = (kind === "cabinet" || kind === "hearth")
              ? points.map((point) => ({ x: point.x + inward.x, y: point.y + inward.y }))
                .filter(({ x, y }) => pointInRoom(room, x, y) && !grid[y][x].interiorProp)
              : [];
            if ((kind === "cabinet" || kind === "hearth") &&
              clearFrontage.length < Math.ceil(points.length / 2)) continue;
            if (!place(room, kind, points, run.orientation, run.facing)) continue;
            clearFrontage.forEach((point) => reserved.add(key(point)));
            return true;
          }
        }
      }
    }
    return false;
  };

  const placeServiceBar = (room: Room) => {
    const availableForBar = (point: Point) => {
      const tile = grid[point.y]?.[point.x];
      return tile?.terrain === Terrain.Ground && tile.roomId === room.id &&
        !tile.interiorProp && !doorClearance.has(key(point));
    };
    const candidates: Array<{ counter: Point; service: Point; orientation: Orientation }> = [];
    for (const service of room.cells) {
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const partition = grid[service.y + dy]?.[service.x + dx]?.terrain;
        if ((partition !== Terrain.Wall && partition !== Terrain.Door) ||
          !/Kitchen/i.test(grid[service.y + dy * 2]?.[service.x + dx * 2]?.roomRole ?? "")) continue;
        candidates.push({
          service,
          counter: { x: service.x - dx, y: service.y - dy },
          orientation: dx === 0 ? "horizontal" : "vertical",
        });
      }
    }
    const orientations: Orientation[] = ["horizontal", "vertical"];
    for (const orientation of orientations) {
      const shared = candidates.filter((candidate) => candidate.orientation === orientation)
        .sort((a, b) => orientation === "horizontal"
          ? a.counter.x - b.counter.x : a.counter.y - b.counter.y);
      if (!shared.length) continue;
      const serviceOffset = {
        x: shared[0].service.x - shared[0].counter.x,
        y: shared[0].service.y - shared[0].counter.y,
      };
      const fixedX = shared[0].counter.x;
      const fixedY = shared[0].counter.y;
      const aligned = (orientation === "horizontal"
        ? Array.from({ length: room.right - room.left + 1 }, (_, index) => ({ x: room.left + index, y: fixedY }))
        : Array.from({ length: room.bottom - room.top + 1 }, (_, index) => ({ x: fixedX, y: room.top + index })))
        .map((counter) => ({
          counter,
          service: { x: counter.x + serviceOffset.x, y: counter.y + serviceOffset.y },
          orientation,
        }))
        .filter((candidate) => pointInRoom(room, candidate.counter.x, candidate.counter.y) &&
          pointInRoom(room, candidate.service.x, candidate.service.y) &&
          (grid[candidate.service.y + serviceOffset.y]?.[candidate.service.x + serviceOffset.x]?.terrain === Terrain.Wall ||
            grid[candidate.service.y + serviceOffset.y]?.[candidate.service.x + serviceOffset.x]?.terrain === Terrain.Door) &&
          /Kitchen/i.test(grid[candidate.service.y + serviceOffset.y * 2]?.
            [candidate.service.x + serviceOffset.x * 2]?.roomRole ?? ""));
      const runs: typeof aligned[] = [];
      let run: typeof aligned = [];
      for (const candidate of aligned) {
        const previous = run[run.length - 1];
        const contiguous = !previous || (orientation === "horizontal"
          ? candidate.counter.y === previous.counter.y && candidate.counter.x === previous.counter.x + 1
          : candidate.counter.x === previous.counter.x && candidate.counter.y === previous.counter.y + 1);
        if (contiguous && availableForBar(candidate.counter)) run.push(candidate);
        else {
          if (run.length) runs.push(run);
          run = availableForBar(candidate.counter) ? [candidate] : [];
        }
      }
      if (run.length) runs.push(run);
      const sharedCenter = shared.reduce((sum, candidate) => sum + (orientation === "horizontal"
        ? candidate.counter.x : candidate.counter.y), 0) / shared.length;
      const runDistance = (candidateRun: typeof aligned) => Math.min(...candidateRun.map((candidate) =>
        Math.abs((orientation === "horizontal" ? candidate.counter.x : candidate.counter.y) - sharedCenter)));
      const selected = runs.filter((candidateRun) => candidateRun.length >= 3)
        .sort((a, b) => runDistance(a) - runDistance(b) || b.length - a.length)[0];
      if (!selected) continue;
      const length = Math.min(7, selected.length);
      const selectedStart = orientation === "horizontal" ? selected[0].counter.x : selected[0].counter.y;
      const start = Math.max(0, Math.min(selected.length - length,
        Math.round(sharedCenter - selectedStart - length / 2)));
      const bar = selected.slice(start, start + length);
      if (!placeComposition(room, [{
        kind: "bar",
        points: bar.map(({ counter }) => counter),
        orientation,
      }], doorClearance)) continue;
      for (const { counter, service } of bar) {
        reserved.add(key(service));
        const customer = {
          x: counter.x - serviceOffset.x,
          y: counter.y - serviceOffset.y,
        };
        if (pointInRoom(room, customer.x, customer.y)) reserved.add(key(customer));
      }
      return true;
    }
    return false;
  };

  const placeWallAlignedObjects = (
    room: Room,
    kind: PropKind,
    length: number,
    count: number,
  ) => {
    const doors = room.cells.filter((point) =>
      neighbors(point).some(({ x, y }) => grid[y]?.[x]?.terrain === Terrain.Door));
    const runs = wallRuns(room).sort((a, b) => {
      const distance = (run: { points: Point[] }) => doors.length
        ? Math.min(...run.points.flatMap((point) => doors.map((door) =>
          Math.abs(point.x - door.x) + Math.abs(point.y - door.y))))
        : run.points.length;
      return distance(b) - distance(a) || b.points.length - a.points.length;
    });
    for (let target = count; target >= 1; target -= 1) {
      const span = target * length + (target - 1);
      for (const run of runs) {
        if (run.points.length < span) continue;
        const starts = [...new Set([
          Math.floor((run.points.length - span) / 2),
          0,
          run.points.length - span,
        ])].sort((first, second) => {
          const distance = (start: number) => doors.length
            ? Math.min(...run.points.slice(start, start + span).flatMap((point) => doors.map((door) =>
              Math.abs(point.x - door.x) + Math.abs(point.y - door.y))))
            : 0;
          return distance(second) - distance(first);
        });
        for (const start of starts) {
          const footprints = Array.from({ length: target }, (_, index) => {
            const offset = start + index * (length + 1);
            return run.points.slice(offset, offset + length);
          });
          const props = footprints.map((points): PlannedProp => ({
            kind, points, orientation: run.orientation, facing: run.facing,
          }));
          if (!placeComposition(room, props)) continue;
          for (const point of footprints.flat()) {
            for (const next of neighbors(point)) {
              if (pointInRoom(room, next.x, next.y)) reserved.add(key(next));
            }
          }
          return target;
        }
      }
    }
    return 0;
  };

  const diningCandidates = (room: Room, tableLength: number, orientation: Orientation) => {
    const candidates: Array<{ table: Point[]; firstSide: Point[]; secondSide: Point[] }> = [];
    for (let y = room.top + 1; y <= room.bottom - 1; y += 1) {
      for (let x = room.left + 1; x <= room.right - 1; x += 1) {
        const table = Array.from({ length: tableLength }, (_, index) => ({
          x: x + (orientation === "horizontal" ? index : 0),
          y: y + (orientation === "vertical" ? index : 0),
        }));
        const firstSide = table.map(({ x: px, y: py }) => orientation === "horizontal"
          ? { x: px, y: py - 1 } : { x: px - 1, y: py });
        const secondSide = table.map(({ x: px, y: py }) => orientation === "horizontal"
          ? { x: px, y: py + 1 } : { x: px + 1, y: py });
        if (available(room, [...table, ...firstSide, ...secondSide])) {
          candidates.push({ table, firstSide, secondSide });
        }
      }
    }
    const centerX = (room.left + room.right) / 2;
    const centerY = (room.top + room.bottom) / 2;
    return candidates.sort((a, b) => {
      const ac = a.table[Math.floor(a.table.length / 2)];
      const bc = b.table[Math.floor(b.table.length / 2)];
      return Math.hypot(ac.x - centerX, ac.y - centerY) - Math.hypot(bc.x - centerX, bc.y - centerY);
    });
  };

  const reserveAround = (room: Room, points: Point[], distance = 1) => {
    for (const point of points) {
      for (let offsetY = -distance; offsetY <= distance; offsetY += 1) {
        for (let offsetX = -distance; offsetX <= distance; offsetX += 1) {
          if (pointInRoom(room, point.x + offsetX, point.y + offsetY)) {
            reserved.add(`${point.x + offsetX},${point.y + offsetY}`);
          }
        }
      }
    }
  };
  const facingStep: Record<NonNullable<Tile["propFacing"]>, Point> = {
    north: { x: 0, y: -1 },
    east: { x: 1, y: 0 },
    south: { x: 0, y: 1 },
    west: { x: -1, y: 0 },
  };
  const oppositeFacing: Record<
    NonNullable<Tile["propFacing"]>,
    NonNullable<Tile["propFacing"]>
  > = { north: "south", east: "west", south: "north", west: "east" };

  const placeCompactWallProp = (
    room: Room,
    kind: PropKind,
    needsFrontage = false,
  ) => {
    const doorApproaches = room.cells.filter((point) =>
      neighbors(point).some(({ x, y }) => grid[y]?.[x]?.terrain === Terrain.Door));
    const candidates = wallRuns(room).flatMap((run) => {
      const inward = facingStep[run.facing];
      return run.points.map((point) => {
        const frontage = { x: point.x + inward.x, y: point.y + inward.y };
        const frontageFree = pointInRoom(room, frontage.x, frontage.y) &&
          !grid[frontage.y][frontage.x].interiorProp;
        const doorDistance = doorApproaches.length
          ? Math.min(...doorApproaches.map((door) =>
            Math.abs(point.x - door.x) + Math.abs(point.y - door.y)))
          : 0;
        return { run, point, frontage, frontageFree, score: doorDistance * 4 + random() };
      });
    }).filter(({ point, frontageFree }) =>
      (!needsFrontage || frontageFree) &&
      availableWithMask(room, [point], doorClearance) &&
      roomRemainsConnected(room, [point]))
      .sort((first, second) => second.score - first.score);
    for (const candidate of candidates) {
      if (!placeComposition(room, [{
        kind,
        points: [candidate.point],
        orientation: candidate.run.orientation,
        facing: candidate.run.facing,
      }], doorClearance)) continue;
      if (candidate.frontageFree) reserved.add(key(candidate.frontage));
      return true;
    }
    return false;
  };

  const placeCompactBed = (room: Room, reservationMask?: Set<string>) => {
    const doorApproaches = room.cells.filter((point) =>
      neighbors(point).some(({ x, y }) => grid[y]?.[x]?.terrain === Terrain.Door));
    const doorwayApproaches = new Set(doorApproaches.map(key));
    const placementMask = reservationMask ?? doorwayApproaches;
    const candidates = wallAnchors(room).map((anchor) => {
      const points = [anchor.head, {
        x: anchor.head.x + anchor.dx,
        y: anchor.head.y + anchor.dy,
      }];
      const foot = {
        x: anchor.head.x + anchor.dx * 2,
        y: anchor.head.y + anchor.dy * 2,
      };
      const doorDistance = doorApproaches.length
        ? Math.min(...doorApproaches.map((door) =>
          Math.abs(anchor.head.x - door.x) + Math.abs(anchor.head.y - door.y)))
        : 0;
      return { anchor, points, foot, score: doorDistance * 3 + random() };
    }).filter(({ points, foot }) => pointInRoom(room, foot.x, foot.y) &&
      !grid[foot.y][foot.x].interiorProp &&
      availableWithMask(room, points, placementMask) && roomRemainsConnected(room, points))
      .sort((first, second) => second.score - first.score);
    for (const candidate of candidates) {
      if (!placeComposition(room, [{
        kind: "bed",
        points: candidate.points,
        orientation: candidate.anchor.orientation,
        facing: candidate.anchor.facing,
      }], placementMask)) continue;
      reserved.add(key(candidate.foot));
      return true;
    }
    return false;
  };

  const placeDoubleBed = (room: Room) => {
    const candidates = wallRuns(room).flatMap((run) => {
      const inward = facingStep[run.facing];
      return Array.from({ length: Math.max(0, run.points.length - 1) }, (_, index) => {
        const heads = run.points.slice(index, index + 2);
        const tails = heads.map((point) => ({
          x: point.x + inward.x,
          y: point.y + inward.y,
        }));
        const feet = tails.map((point) => ({
          x: point.x + inward.x,
          y: point.y + inward.y,
        }));
        return {
          points: [...heads, ...tails],
          feet,
          facing: oppositeFacing[run.facing],
          score: random(),
        };
      });
    }).filter(({ points, feet }) => available(room, points) &&
      feet.every((point) => pointInRoom(room, point.x, point.y) && available(room, [point])) &&
      roomRemainsConnected(room, points))
      .sort((first, second) => second.score - first.score);
    for (const candidate of candidates) {
      if (!place(room, "bed", candidate.points, "vertical", candidate.facing)) continue;
      candidate.feet.forEach((point) => reserved.add(key(point)));
      return true;
    }
    return false;
  };

  const placeNorthWallProp = (room: Room, kind: "drawers" | "shelf" | "statue") => {
    const candidates = shuffled(room.cells, random).filter((point) => {
      const frontage = { x: point.x, y: point.y + 1 };
      return grid[point.y - 1]?.[point.x]?.terrain === Terrain.Wall &&
        pointInRoom(room, frontage.x, frontage.y) && available(room, [point, frontage]) &&
        roomRemainsConnected(room, [point]);
    });
    for (const point of candidates) {
      if (!place(room, kind, [point], "horizontal", "south")) continue;
      reserved.add(key({ x: point.x, y: point.y + 1 }));
      return true;
    }
    return false;
  };

  const placeSmallProp = (room: Room, kind: "barrel" | "bucket" | "flower_pot") => {
    const candidates = shuffled(room.cells, random).sort((a, b) =>
      Number(neighbors(b).some(({ x, y }) => grid[y]?.[x]?.terrain === Terrain.Wall)) -
      Number(neighbors(a).some(({ x, y }) => grid[y]?.[x]?.terrain === Terrain.Wall)));
    return candidates.some((point) => place(room, kind, [point], "horizontal"));
  };

  const reserveDoorAxis = (room: Room) => {
    const entries = room.cells.flatMap((approach) => neighbors(approach)
      .filter(({ x, y }) => grid[y]?.[x]?.terrain === Terrain.Door)
      .map((door) => ({ approach, door })));
    const aisle = new Set<string>();
    if (!entries.length) return aisle;
    const entry = entries.sort((first, second) => {
      const distanceFromCenter = ({ approach }: { approach: Point }) => Math.abs(
        approach.x - (room.left + room.right) / 2,
      ) + Math.abs(approach.y - (room.top + room.bottom) / 2);
      return distanceFromCenter(first) - distanceFromCenter(second);
    })[0];
    const step = {
      x: entry.approach.x - entry.door.x,
      y: entry.approach.y - entry.door.y,
    };
    const transverseSpan = step.x !== 0
      ? room.bottom - room.top + 1
      : room.right - room.left + 1;
    aisle.add(key(entry.approach));
    // A one- or two-cell transverse room has no separate centre aisle: the
    // entire compartment would become a reservation and could not serve its
    // function at all. Door clearance and the connectivity check remain active.
    if (transverseSpan < 3) return aisle;
    for (
      let cursor = entry.approach;
      pointInRoom(room, cursor.x, cursor.y);
      cursor = { x: cursor.x + step.x, y: cursor.y + step.y }
    ) {
      reserved.add(key(cursor));
      aisle.add(key(cursor));
    }
    return aisle;
  };

  const furnishBurialVault = (room: Room) => {
    reserveDoorAxis(room);
    const expected = Math.min(6, Math.max(1, Math.ceil(room.cells.length / 24)));
    const target = Math.min(8, Math.max(expected,
      Math.round(room.cells.length / (15 + random() * 3))));
    const runs = wallRuns(room).filter((run) => run.points.length >= 2);
    const orientations = (["horizontal", "vertical"] as const).map((orientation) => {
      const matching = runs.filter((run) => run.orientation === orientation);
      const facings = new Set(matching.map((run) => run.facing));
      const capacity = matching.reduce((sum, run) =>
        sum + Math.floor((run.points.length + 1) / 3), 0);
      return { orientation, runs: matching, facings, capacity };
    }).filter(({ facings, capacity }) => capacity > 0 &&
      (room.cells.length < 60 || facings.size >= 2))
      .sort((first, second) => second.capacity - first.capacity || random() - .5);
    const selected = orientations[0];
    if (!selected) {
      return placeWallAlignedObjects(room, "tomb", 2, expected);
    }

    const placedByFacing = new Map<NonNullable<Tile["propFacing"]>, number>();
    const placedCenters: Array<{
      axis: number;
      facing: NonNullable<Tile["propFacing"]>;
    }> = [];
    const packedStarts = new Map<(typeof runs)[number], number[]>();
    for (const run of selected.runs) {
      const variants = [0, 1, 2].map((offset) => {
        const starts: number[] = [];
        for (let start = offset; start <= run.points.length - 2; start += 3) {
          starts.push(start);
        }
        const usable = starts.filter((start) => {
          const points = run.points.slice(start, start + 2);
          return available(room, points) && roomRemainsConnected(room, points);
        }).length;
        return { starts, usable, order: random() };
      }).sort((first, second) => second.usable - first.usable || first.order - second.order);
      packedStarts.set(run, variants[0].starts);
    }
    let placed = 0;
    while (placed < target) {
      const candidates = selected.runs.flatMap((run) =>
        (packedStarts.get(run) ?? []).map((start) => {
          const points = run.points.slice(start, start + 2);
          const axis = selected.orientation === "horizontal"
            ? (points[0].x + points[1].x) / 2
            : (points[0].y + points[1].y) / 2;
          const matchingOpposite = placedCenters.filter((candidate) =>
            candidate.facing === oppositeFacing[run.facing]);
          const symmetryDistance = matchingOpposite.length
            ? Math.min(...matchingOpposite.map((candidate) => Math.abs(candidate.axis - axis)))
            : 0;
          const spread = placedCenters.length
            ? Math.min(...placedCenters.map((candidate) => Math.abs(candidate.axis - axis)))
            : 0;
          return {
            run,
            points,
            axis,
            score: (matchingOpposite.length
              ? -symmetryDistance * 10
              : spread * 5) + random(),
          };
        }));
      const viable = candidates.filter(({ points }) =>
        available(room, points) && roomRemainsConnected(room, points))
        .sort((first, second) => {
          const firstCount = placedByFacing.get(first.run.facing) ?? 0;
          const secondCount = placedByFacing.get(second.run.facing) ?? 0;
          return firstCount - secondCount || second.score - first.score;
        });
      const candidate = viable[0];
      if (!candidate || !placeComposition(room, [{
        kind: "tomb",
        points: candidate.points,
        orientation: selected.orientation,
        facing: candidate.run.facing,
      }])) break;
      const first = candidate.points[0];
      const last = candidate.points[candidate.points.length - 1];
      const along = selected.orientation === "horizontal"
        ? { x: 1, y: 0 } : { x: 0, y: 1 };
      for (const clearance of [
        { x: first.x - along.x, y: first.y - along.y },
        { x: last.x + along.x, y: last.y + along.y },
        ...candidate.points.map((point) => ({
          x: point.x + facingStep[candidate.run.facing].x,
          y: point.y + facingStep[candidate.run.facing].y,
        })),
      ]) {
        if (pointInRoom(room, clearance.x, clearance.y)) reserved.add(key(clearance));
      }
      placedByFacing.set(candidate.run.facing,
        (placedByFacing.get(candidate.run.facing) ?? 0) + 1);
      placedCenters.push({ axis: candidate.axis, facing: candidate.run.facing });
      placed += 1;
    }
    return placed;
  };

  const placeHearth = (room: Room) => {
    const doors = room.cells.filter((point) =>
      neighbors(point).some(({ x, y }) => grid[y]?.[x]?.terrain === Terrain.Door));
    const preferredLength = room.cells.length >= 90 ? 3 : 2;
    for (let length = preferredLength; length >= 2; length -= 1) {
      const candidates = wallRuns(room).flatMap((run) => {
        const inward = facingStep[run.facing];
        return Array.from(
          { length: Math.max(0, run.points.length - length + 1) },
          (_, start) => {
            const points = run.points.slice(start, start + length);
            const front = points.map(({ x, y }) => ({ x: x + inward.x, y: y + inward.y }));
            const doorDistance = doors.length
              ? Math.min(...points.flatMap((point) => doors.map((door) =>
                Math.abs(point.x - door.x) + Math.abs(point.y - door.y))))
              : 0;
            return { run, points, front, score: doorDistance * 4 + random() };
          },
        );
      }).filter(({ points, front }) => available(room, [...points, ...front]) &&
        roomRemainsConnected(room, points))
        .sort((a, b) => b.score - a.score);
      for (const candidate of candidates) {
        if (!place(room, "hearth", candidate.points,
          candidate.run.orientation, candidate.run.facing)) continue;
        candidate.front.forEach((point) => reserved.add(key(point)));
        return true;
      }
    }
    return false;
  };

  const placeWallSeatingGroups = (room: Room, count: number) => {
    let placed = 0;
    const centers: Point[] = [];
    while (placed < count) {
      const doors = room.cells.filter((point) =>
        neighbors(point).some(({ x, y }) => grid[y]?.[x]?.terrain === Terrain.Door));
      const candidates = wallRuns(room).flatMap((run) => {
        const inward = facingStep[run.facing];
        return Array.from(
          { length: Math.max(0, run.points.length - 1) },
          (_, start) => {
            const bench = run.points.slice(start, start + 2);
            const table = bench.map(({ x, y }) => ({ x: x + inward.x, y: y + inward.y }));
            const chairs = table.map(({ x, y }) => ({ x: x + inward.x, y: y + inward.y }));
            const center = table[Math.floor(table.length / 2)];
            const doorDistance = doors.length
              ? Math.min(...table.flatMap((point) => doors.map((door) =>
                Math.abs(point.x - door.x) + Math.abs(point.y - door.y))))
              : 0;
            const groupDistance = centers.length
              ? Math.min(...centers.map((other) => Math.hypot(center.x - other.x, center.y - other.y)))
              : 0;
            return {
              run, bench, table, chairs, center,
              score: doorDistance * 2 + groupDistance * 4 + random(),
            };
          },
        );
      }).filter(({ bench, table, chairs }) => {
        const footprint = [...bench, ...table, ...chairs];
        return available(room, footprint) && roomRemainsConnected(room, footprint);
      }).sort((a, b) => b.score - a.score);
      const selected = candidates[0];
      if (!selected) break;
      const composition: PlannedProp[] = [
        {
          kind: "bench",
          points: selected.bench,
          orientation: selected.run.orientation,
          facing: selected.run.facing,
        },
        { kind: "table", points: selected.table, orientation: selected.run.orientation },
        ...selected.chairs.map((point): PlannedProp => ({
          kind: "chair",
          points: [point],
          orientation: selected.run.orientation,
          facing: oppositeFacing[selected.run.facing],
        })),
      ];
      if (!placeComposition(room, composition)) break;
      reserveAround(room, [...selected.bench, ...selected.table, ...selected.chairs]);
      reserveAround(room, selected.table, 2);
      centers.push(selected.center);
      placed += 1;
    }
    return placed;
  };

  const placeWorkTables = (room: Room, count: number, tableLength = 2) => {
    let placed = 0;
    const centers: Point[] = [];
    const preferred: Orientation = room.right - room.left >= room.bottom - room.top
      ? "horizontal" : "vertical";
    while (placed < count) {
      const orientations: Orientation[] = placed % 2
        ? [preferred === "horizontal" ? "vertical" : "horizontal", preferred]
        : [preferred, preferred === "horizontal" ? "vertical" : "horizontal"];
      const candidates = orientations.flatMap((orientation) => room.cells.map((start) => {
        const points = Array.from({ length: tableLength }, (_, index) => ({
          x: start.x + (orientation === "horizontal" ? index : 0),
          y: start.y + (orientation === "vertical" ? index : 0),
        }));
        const center = points[Math.floor(points.length / 2)];
        const centerDistance = Math.hypot(
          center.x - (room.left + room.right) / 2,
          center.y - (room.top + room.bottom) / 2,
        );
        const groupDistance = centers.length
          ? Math.min(...centers.map((other) => Math.hypot(center.x - other.x, center.y - other.y)))
          : 0;
        return { orientation, points, center, score: groupDistance * 8 - centerDistance + random() };
      })).filter(({ points }) => available(room, points) && roomRemainsConnected(room, points))
        .sort((a, b) => b.score - a.score);
      const selected = candidates[0];
      if (!selected || !place(room, "table", selected.points, selected.orientation)) break;
      reserveAround(room, selected.points);
      centers.push(selected.center);
      placed += 1;
    }
    return placed;
  };

  const placeWritingNook = (room: Room) => {
    const doors = room.cells.filter((point) =>
      neighbors(point).some(({ x, y }) => grid[y]?.[x]?.terrain === Terrain.Door));
    const candidates = wallRuns(room).flatMap((run) => {
      const inward = facingStep[run.facing];
      return run.points.map((table) => {
        const chair = { x: table.x + inward.x, y: table.y + inward.y };
        const doorDistance = doors.length
          ? Math.min(...doors.map((door) =>
            Math.abs(table.x - door.x) + Math.abs(table.y - door.y)))
          : 0;
        return { run, table, chair, score: doorDistance * 3 + random() };
      });
    }).filter(({ table, chair }) => available(room, [table, chair]) &&
      roomRemainsConnected(room, [table, chair]))
      .sort((a, b) => b.score - a.score);
    for (const candidate of candidates) {
      if (!placeComposition(room, [
        { kind: "table", points: [candidate.table], orientation: candidate.run.orientation },
        {
          kind: "chair",
          points: [candidate.chair],
          orientation: candidate.run.orientation,
          facing: oppositeFacing[candidate.run.facing],
        },
      ])) continue;
      reserveAround(room, [candidate.table, candidate.chair]);
      return true;
    }
    return false;
  };

  const placeCompactCouncilTable = (room: Room) => {
    if (placeWritingNook(room) || placeWorkTables(room, 1, 1)) return true;

    // Tiny council rooms often have almost their whole floor reserved by the
    // route to their door. Keep the actual doorway approach clear, but allow a
    // compact table (and a chair when possible) on a diagonal landing cell.
    const doorwayApproaches = new Set(room.cells.filter((point) =>
      neighbors(point).some(({ x, y }) => grid[y]?.[x]?.terrain === Terrain.Door))
      .map(key));
    const doors = room.cells.filter((point) => doorwayApproaches.has(key(point)));
    const candidates = shuffled(room.cells, random).sort((first, second) => {
      const distance = (point: Point) => doors.length
        ? Math.min(...doors.map((door) =>
          Math.abs(point.x - door.x) + Math.abs(point.y - door.y)))
        : 0;
      return distance(second) - distance(first);
    });
    for (const table of candidates) {
      for (const chair of neighbors(table)) {
        if (!pointInRoom(room, chair.x, chair.y)) continue;
        const dx = table.x - chair.x;
        const dy = table.y - chair.y;
        const facing: NonNullable<Tile["propFacing"]> = dx > 0 ? "east"
          : dx < 0 ? "west" : dy > 0 ? "south" : "north";
        const orientation: Orientation = dx === 0 ? "horizontal" : "vertical";
        if (placeComposition(room, [
          { kind: "table", points: [table], orientation },
          { kind: "chair", points: [chair], orientation, facing },
        ], doorwayApproaches)) return true;
      }
      if (placeComposition(room, [{
        kind: "table",
        points: [table],
        orientation: room.right - room.left >= room.bottom - room.top
          ? "horizontal" : "vertical",
      }], doorwayApproaches)) return true;
    }
    return false;
  };

  const placeCompactWorkTable = (room: Room) => {
    if (placeWorkTables(room, 1, 1)) return true;
    const doorwayApproaches = new Set(room.cells.filter((point) =>
      neighbors(point).some(({ x, y }) => grid[y]?.[x]?.terrain === Terrain.Door))
      .map(key));
    const approaches = room.cells.filter((point) => doorwayApproaches.has(key(point)));
    const candidates = shuffled(room.cells, random).sort((first, second) => {
      const distance = (point: Point) => approaches.length
        ? Math.min(...approaches.map((approach) =>
          Math.abs(point.x - approach.x) + Math.abs(point.y - approach.y)))
        : 0;
      return distance(second) - distance(first);
    });
    for (const point of candidates) {
      if (placeComposition(room, [{
        kind: "table",
        points: [point],
        orientation: room.right - room.left >= room.bottom - room.top
          ? "horizontal" : "vertical",
      }], doorwayApproaches)) return true;
    }
    return false;
  };

  const placeDiningSets = (
    room: Room,
    count: number,
    tableLength = 2,
    seating: "chair" | "bench" = "chair",
    spacing = 0,
  ) => {
    let placed = 0;
    const placedCenters: Point[] = [];
    const preferred: Orientation = room.right - room.left >= room.bottom - room.top
      ? "horizontal" : "vertical";
    while (placed < count) {
      const orientation = tableLength === 1
        ? "horizontal"
        : placed % 2 === 0 ? preferred : preferred === "horizontal" ? "vertical" : "horizontal";
      const candidates = diningCandidates(room, tableLength, orientation)
        .map((candidate) => {
          const center = candidate.table[Math.floor(candidate.table.length / 2)];
          const endSeats = tableLength === 1
            ? [{ x: center.x - 1, y: center.y }, { x: center.x + 1, y: center.y }]
            : [];
          return { ...candidate, center, endSeats };
        })
        .filter((candidate) => {
          const footprint = [
            ...candidate.table, ...candidate.firstSide, ...candidate.secondSide, ...candidate.endSeats,
          ];
          return available(room, footprint) && roomRemainsConnected(room, footprint);
        });
      if (!candidates.length) break;
      candidates.sort((a, b) => {
        if (!placedCenters.length) {
          const centerX = (room.left + room.right) / 2;
          const centerY = (room.top + room.bottom) / 2;
          return Math.hypot(a.center.x - centerX, a.center.y - centerY) -
            Math.hypot(b.center.x - centerX, b.center.y - centerY);
        }
        const distance = (point: Point) => Math.min(...placedCenters.map((center) =>
          Math.hypot(point.x - center.x, point.y - center.y)));
        return distance(b.center) - distance(a.center) ||
          a.center.y - b.center.y || a.center.x - b.center.x;
      });
      const candidate = candidates[0];
      const composition: PlannedProp[] = [{
        kind: "table", points: candidate.table, orientation,
      }];
      if (seating === "bench") {
        composition.push(
          {
            kind: "bench", points: candidate.firstSide, orientation,
            facing: orientation === "horizontal" ? "south" : "east",
          },
          {
            kind: "bench", points: candidate.secondSide, orientation,
            facing: orientation === "horizontal" ? "north" : "west",
          },
        );
      } else {
        const seatIndexes = tableLength === 1 ? [0] : [0, tableLength - 1];
        for (const index of seatIndexes) {
          composition.push(
            {
              kind: "chair", points: [candidate.firstSide[index]], orientation,
              facing: orientation === "horizontal" ? "south" : "east",
            },
            {
              kind: "chair", points: [candidate.secondSide[index]], orientation,
              facing: orientation === "horizontal" ? "north" : "west",
            },
          );
        }
        if (tableLength === 1) {
          composition.push(
            { kind: "chair", points: [candidate.endSeats[0]], orientation: "vertical", facing: "east" },
            { kind: "chair", points: [candidate.endSeats[1]], orientation: "vertical", facing: "west" },
          );
        }
      }
      if (!placeComposition(room, composition)) break;
      if (spacing > 0) {
        const footprint = [
          ...candidate.table, ...candidate.firstSide, ...candidate.secondSide, ...candidate.endSeats,
        ];
        reserveAround(room, footprint, spacing);
        reserveAround(room, candidate.table, spacing + 1);
      }
      placedCenters.push(candidate.center);
      placed += 1;
    }
    return placed;
  };

  const placeScattered = (room: Room, kind: PropKind, count: number) => {
    let placed = 0;
    for (const point of shuffled(room.cells, random)) {
      if (place(room, kind, [point], "horizontal") && ++placed >= count) break;
    }
  };

  const furnishAxialChapel = (room: Room) => {
    const innerSanctum = /Inner sanctum/i.test(room.role);
    const entries = room.cells.flatMap((approach) => neighbors(approach)
      .filter(({ x, y }) => grid[y]?.[x]?.terrain === Terrain.Door)
      .map((door) => ({ approach, door })))
      .sort((a, b) => {
        const score = ({ door }: { door: Point }) => neighbors(door).some(({ x, y }) =>
          /Nave and transept|Processional passage/i.test(grid[y]?.[x]?.roomRole ?? "")) ? 1 : 0;
        return score(b) - score(a);
      });
    const entry = entries[0];
    if (!entry) {
      placeWallRun(room, "altar", 2, 3);
      placeWallRun(room, "bench", 2, 4);
      return;
    }
    const dx = entry.approach.x - entry.door.x;
    const dy = entry.approach.y - entry.door.y;
    const horizontalAxis = dx !== 0;
    const axis = horizontalAxis ? entry.approach.y : entry.approach.x;
    const altarDepth = horizontalAxis
      ? (dx > 0 ? room.right : room.left)
      : (dy > 0 ? room.bottom : room.top);
    const entranceDepth = horizontalAxis ? entry.approach.x : entry.approach.y;
    const orientation: Orientation = horizontalAxis ? "vertical" : "horizontal";
    const altarFacing: NonNullable<Tile["propFacing"]> = dx > 0 ? "west"
      : dx < 0 ? "east" : dy > 0 ? "north" : "south";
    const benchFacing: NonNullable<Tile["propFacing"]> = dx > 0 ? "east"
      : dx < 0 ? "west" : dy > 0 ? "south" : "north";
    const negativeCrossSpan = horizontalAxis ? axis - room.top : axis - room.left;
    const positiveCrossSpan = horizontalAxis ? room.bottom - axis : room.right - axis;
    const maximumSymmetricBenchLength = Math.min(negativeCrossSpan, positiveCrossSpan);
    const proportionalBenchLength = innerSanctum
      ? Math.max(3, Math.min(5, Math.floor((negativeCrossSpan + positiveCrossSpan + 1) / 5)))
      : 2;
    const benchLength = Math.max(2, Math.min(Math.max(2, maximumSymmetricBenchLength),
      proportionalBenchLength - (innerSanctum && random() < .35 ? 1 : 0)));

    for (let depth = entranceDepth; depth !== altarDepth; depth += horizontalAxis ? dx : dy) {
      reserved.add(horizontalAxis ? `${depth},${axis}` : `${axis},${depth}`);
    }

    const altarVariants = [
      [-1, 0, 1],
      [-1, 0],
      [0, 1],
    ].map((offsets) => offsets.map((offset) => horizontalAxis
      ? { x: altarDepth, y: axis + offset }
      : { x: axis + offset, y: altarDepth }));
    const tryLayout = (reservationMask: Set<string>) => {
      for (const altar of altarVariants) {
        if (!availableWithMask(room, altar, reservationMask)) continue;
        const rowPlans: PlannedProp[][] = [];
        const axialLength = Math.abs(altarDepth - entranceDepth);
        const firstRowDistance = innerSanctum
          ? Math.max(2, Math.min(3, axialLength - 1))
          : 3;
        // Wide sanctum benches sit farther from the altar. In a four-row
        // sanctum the shorter two-cell gap is paired with at most four seats,
        // so their average depth still reads clearly before the altar.
        const layoutBenchLength = innerSanctum
          ? Math.min(benchLength, firstRowDistance * 2)
          : benchLength;
        const rowTarget = innerSanctum ? 3 : 2;
        for (let distance = firstRowDistance;
          distance <= axialLength - 1 && rowPlans.length < rowTarget;
          distance += 2) {
          const rowDepth = altarDepth - (horizontalAxis ? dx : dy) * distance;
          const first = Array.from({ length: layoutBenchLength }, (_, index) =>
            -layoutBenchLength + index).map((offset) => horizontalAxis
            ? { x: rowDepth, y: axis + offset }
            : { x: axis + offset, y: rowDepth });
          const second = Array.from({ length: layoutBenchLength }, (_, index) =>
            index + 1).map((offset) => horizontalAxis
            ? { x: rowDepth, y: axis + offset }
            : { x: axis + offset, y: rowDepth });
          const pair = [first, second]
            .filter((points) => availableWithMask(room, points, reservationMask))
            .map((points): PlannedProp => ({
              kind: "bench", points, orientation, facing: benchFacing,
            }));
          if (pair.length) rowPlans.push(pair);
        }
        for (let usedRows = rowPlans.length; usedRows >= 1; usedRows -= 1) {
          const benches = rowPlans.slice(0, usedRows).flat();
          if (placeComposition(room, [
            { kind: "altar", points: altar, orientation, facing: altarFacing },
            ...benches,
          ], reservationMask)) return true;
        }
        if (placeComposition(room, [{
          kind: "altar", points: altar, orientation, facing: altarFacing,
        }], reservationMask)) return true;
      }
      return false;
    };
    if (tryLayout(reserved) || tryLayout(doorClearance)) return;
    placeWallRun(room, "altar", 2, 3);
  };

  const furnishCathedralNave = (room: Room) => {
    const exteriorApproaches = room.cells.filter((point) => neighbors(point).some(({ x, y }) =>
      grid[y]?.[x]?.terrain === Terrain.Door && neighbors({ x, y }).some((outside) =>
        grid[outside.y]?.[outside.x]?.terrain === Terrain.Void)));
    const centerX = exteriorApproaches[0]?.x ?? Math.round((room.left + room.right) / 2);
    const entranceY = exteriorApproaches[0]?.y ?? room.bottom;
    const altarY = entranceY < (room.top + room.bottom) / 2 ? room.bottom - 1 : room.top + 1;
    for (let y = Math.min(entranceY, altarY); y <= Math.max(entranceY, altarY); y += 1) {
      if (y !== altarY) reserved.add(`${centerX},${y}`);
    }
    const altar = [-1, 0, 1].map((offset) => ({ x: centerX + offset, y: altarY }))
      .filter((point) => pointInRoom(room, point.x, point.y));
    place(room, "altar", altar, "horizontal");
    const direction = entranceY > altarY ? 1 : -1;
    for (let distance = 3; distance < Math.abs(entranceY - altarY) - 1; distance += 2) {
      const y = altarY + direction * distance;
      const facing = direction > 0 ? "north" : "south";
      for (let length = 4; length >= 2; length -= 1) {
        const left = Array.from({ length }, (_, index) => ({
          x: centerX - length + index,
          y,
        }));
        const right = Array.from({ length }, (_, index) => ({
          x: centerX + 1 + index,
          y,
        }));
        if (!placeComposition(room, [
          { kind: "bench", points: left, orientation: "horizontal", facing },
          { kind: "bench", points: right, orientation: "horizontal", facing },
        ])) continue;
        break;
      }
    }
  };

  for (const room of rooms.sort((a, b) => a.id - b.id)) {
    const role = room.role;
    if (/Nave and transept/i.test(role)) {
      furnishCathedralNave(room);
    } else if (/Side chapel|Inner sanctum|Reliquary/i.test(role)) {
      furnishAxialChapel(room);
      if (room.cells.length >= 28) placeNorthWallProp(room, "statue");
    } else if (/Common room/i.test(role)) {
      placeServiceBar(room);
      placeHearth(room);
      placeWallRun(room, "cabinet", 1, room.cells.length >= 280 ? 4 : 3);
      const tableCount = Math.max(6, Math.min(9, Math.floor(room.cells.length / 34)));
      const boothTables = placeWallSeatingGroups(room, room.cells.length >= 200 ? 2 : 1);
      const squareTarget = Math.max(1, Math.min(3, Math.floor(tableCount / 3)));
      const squareTables = placeDiningSets(room, squareTarget, 1, "chair", 1);
      placeDiningSets(room,
        Math.max(2, tableCount - boothTables - squareTables), 2, "chair", 1);
      if (room.cells.length >= 120 && random() < .7) placeSmallProp(room, "barrel");
    } else if (/Great hall/i.test(role)) {
      placeHearth(room);
      placeWallRun(room, "cabinet", 2, 4);
      const tableTarget = Math.max(3, Math.min(7, Math.round(room.cells.length / 55)));
      const longTables = placeDiningSets(room, tableTarget, 3, "bench", 1);
      if (longTables < tableTarget) {
        placeDiningSets(room, tableTarget - longTables, 2, "bench");
      }
    } else if (/Council room/i.test(role)) {
      const tableLength = room.cells.length >= 36 ? 3 : 2;
      if (!placeDiningSets(room, 1, tableLength, "chair") &&
        !placeDiningSets(room, 1, 1, "chair")) {
        placeCompactCouncilTable(room);
      }
      placeWallRun(room, "cabinet", 1, Math.min(3, Math.max(1,
        Math.ceil(room.cells.length / 20))));
    } else if (/Living room/i.test(role)) {
      placeHearth(room);
      const loungeGroups = placeWallSeatingGroups(room, room.cells.length >= 110 ? 2 : 1);
      placeWallRun(room, "cabinet", 1,
        Math.max(2, Math.min(5, Math.ceil(room.cells.length / 45))));
      if (room.cells.length >= 130) placeWallRun(room, "cabinet", 1, 3);
      placeDiningSets(room, 1, 2, "chair", 1);
      if (room.cells.length >= 55) placeWritingNook(room);
      if (!loungeGroups && room.cells.length >= 80) {
        placeDiningSets(room, 1, 1, "chair", 1);
      }
      if (room.cells.length >= 80) placeNorthWallProp(room, random() < .55 ? "drawers" : "shelf");
      if (room.cells.length >= 120 && random() < .65) placeSmallProp(room, "flower_pot");
    } else if (/Chart room|Guardroom/i.test(role)) {
      if (!placeDiningSets(room, room.cells.length >= 35 ? 2 : 1, 2, "chair")) {
        placeCompactCouncilTable(room);
      }
      placeWallRun(room, "cabinet", 1, 3);
    } else if (/Kitchen|Galley/i.test(role)) {
      if (!placeHearth(room)) placeCompactWallProp(room, "hearth", true);
      const cabinetTarget = room.cells.length < 24
        ? 2
        : Math.max(3, Math.min(9, Math.ceil(room.cells.length * .08)));
      if (!placeWallRun(room, "cabinet", Math.min(3, cabinetTarget), cabinetTarget)) {
        placeWallRun(room, "cabinet", 1, cabinetTarget);
      }
      if (room.cells.length >= 70) placeWallRun(room, "cabinet", 2, 5);
      const workTableCount = room.cells.length >= 70 ? 2 : 1;
      const workTables = placeWorkTables(room, workTableCount, 2);
      if (!workTables) placeCompactWorkTable(room);
      if (!room.cells.some(({ x, y }) => grid[y][x].interiorProp === "table")) {
        placeCompactWorkTable(room);
      }
      placeWallRun(room, "crate", 1, room.cells.length >= 50 ? 3 : 2);
      if (room.cells.length >= 40) placeSmallProp(room, random() < .58 ? "barrel" : "bucket");
    } else if (/Bedroom|Guest room|cabin|berths|quarters|Barracks|Medbay|Sick bay|Royal chamber|Clergy chamber/i.test(role)) {
      const sharedSleepingRoom = /berths|quarters|Barracks|Medbay|Sick bay/i.test(role);
      const crewBerths = /Crew berths/i.test(role);
      const crewAisle = crewBerths ? reserveDoorAxis(room) : undefined;
      const bedCount = crewBerths
        ? Math.min(4, Math.max(2, Math.ceil(room.cells.length / 20)))
        : room.cells.length >= 90 ? 3
          : room.cells.length >= 48 || sharedSleepingRoom ? 2 : 1;
      const wantsDoubleBed = !sharedSleepingRoom &&
        /Bedroom|Guest room|cabin|Royal chamber/i.test(role) &&
        room.cells.length >= 30 && random() < .58;
      let bedsPlaced = wantsDoubleBed && placeDoubleBed(room) ? 1 : 0;
      bedsPlaced += placeWallDepth(room, "bed", 2, Math.max(0, bedCount - bedsPlaced));
      while (crewBerths && bedsPlaced < bedCount && placeCompactBed(room, crewAisle)) {
        bedsPlaced += 1;
      }
      if (!bedsPlaced) placeCompactBed(room);
      placeWallRun(room, "cabinet", 1,
        Math.max(2, Math.min(4, Math.ceil(room.cells.length / 32))));
      if (room.cells.length >= 80) placeWallRun(room, "cabinet", 1, 3);
      if (room.cells.length >= 12) placeWritingNook(room);
      if (room.cells.length >= 80) placeWritingNook(room);
      if (room.cells.length >= 58) placeWallAlignedObjects(room, "bench", 2, 1);
      if (room.cells.length <= 16 &&
        room.cells.filter(({ x, y }) => grid[y][x].interiorProp).length <
          Math.max(2, Math.min(4, Math.floor(room.cells.length * .36)))) {
        placeWallRun(room, "table", 1, 1);
      }
      if (room.cells.length >= 64 && random() < .7) {
        placeNorthWallProp(room, random() < .6 ? "drawers" : "shelf");
      }
      if (room.cells.length >= 90 && random() < .45) placeSmallProp(room, "flower_pot");
    } else if (/Burial vault/i.test(role)) {
      furnishBurialVault(room);
    } else if (/Cargo|hold|store|Magazine|Provision|Armory|Treasury/i.test(role)) {
      placeWallRun(room, "crate", 2, 5);
      placeScattered(room, "crate", Math.max(1, Math.min(4, Math.floor(room.cells.length / 14))));
      if (!room.cells.some(({ x, y }) => grid[y][x].interiorProp === "crate")) {
        placeCompactWallProp(room, "crate");
      }
      if (room.cells.length >= 18) placeSmallProp(room, random() < .7 ? "barrel" : "bucket");
    } else if (/Engineering/i.test(role)) {
      if (!placeWallRun(room, "console", 2, 5)) placeCompactWallProp(room, "console", true);
      const workTarget = Math.max(1, Math.min(3, Math.ceil(room.cells.length / 32)));
      if (!placeWorkTables(room, workTarget, 2)) placeCompactWorkTable(room);
      if (!placeWallRun(room, "cabinet", 1,
        Math.max(2, Math.min(5, Math.ceil(room.cells.length / 18))))) {
        placeCompactWallProp(room, "cabinet", true);
      }
    } else if (/Life support/i.test(role)) {
      if (!placeWallRun(room, "console", 2, 4)) placeCompactWallProp(room, "console", true);
      if (!placeWallRun(room, "cabinet", 2,
        Math.max(2, Math.min(6, Math.ceil(room.cells.length / 14))))) {
        placeCompactWallProp(room, "cabinet", true);
      }
      if (room.cells.length >= 36) placeWallRun(room, "crate", 1, 2);
    } else if (/Observation/i.test(role)) {
      if (!placeWallRun(room, "console", 2, 4)) placeCompactWallProp(room, "console", true);
      const loungeTarget = room.cells.length >= 48 ? 2 : 1;
      if (!placeWallSeatingGroups(room, loungeTarget) &&
        !placeWallAlignedObjects(room, "bench", 2, loungeTarget)) {
        placeCompactWorkTable(room);
      }
    } else if (/Utility/i.test(role)) {
      if (!placeWallRun(room, "console", 2, 4)) placeCompactWallProp(room, "console", true);
      if (!placeWallRun(room, "cabinet", 1,
        Math.max(2, Math.min(5, Math.ceil(room.cells.length / 16))))) {
        placeCompactWallProp(room, "cabinet", true);
      }
      placeScattered(room, "crate", Math.max(1, Math.min(3,
        Math.floor(room.cells.length / 24))));
    } else if (/Escape pods/i.test(role)) {
      const podAisle = reserveDoorAxis(room);
      if (!placeWallRun(room, "console", 2, 4)) placeCompactWallProp(room, "console", true);
      const podTarget = Math.max(1, Math.min(3, Math.ceil(room.cells.length / 22)));
      let podsPlaced = placeWallDepth(room, "bed", 2, podTarget);
      while (podsPlaced < podTarget && placeCompactBed(room, podAisle)) podsPlaced += 1;
      if (!podsPlaced) placeCompactWallProp(room, "cabinet", true);
    } else if (/Cockpit|Laboratory|Airlock/i.test(role)) {
      if (!placeWallRun(room, "console", 2, 5)) placeCompactWallProp(room, "console", true);
      if (/Cockpit|Laboratory/i.test(role)) placeDiningSets(room, 1, 1, "chair");
    } else if (/Choir room/i.test(role)) {
      const benchTarget = Math.max(1, Math.min(3, Math.floor(room.cells.length / 12)));
      if (!placeWallAlignedObjects(room, "bench", 2, benchTarget)) {
        placeWallRun(room, "bench", 2, Math.min(4, Math.max(2,
          Math.floor(room.cells.length / 3))));
      }
      placeWallRun(room, "cabinet", 1, 3);
    } else if (/Workshop/i.test(role)) {
      if (!placeWorkTables(room, 1, 2) && !placeWorkTables(room, 1, 1)) {
        placeCompactCouncilTable(room);
      }
      if (!placeWallRun(room, "cabinet", 1, 4)) {
        placeCompactWallProp(room, "cabinet", true);
      }
    } else if (/Sacristy|Vestry|Archive|Clergy|Chapter/i.test(role)) {
      placeWallRun(room, "cabinet", 2, 4);
      if (room.cells.length >= 20) placeDiningSets(room, 1, 2, "chair");
      if (room.cells.length >= 28) placeNorthWallProp(room, "shelf");
    } else if (!/Hallway|passage|spine|gangway/i.test(role)) {
      placeWallRun(room, "cabinet", 1, 3);
      if (room.cells.length >= 28) placeDiningSets(room, 1, 2, "chair");
    }
  }
}
