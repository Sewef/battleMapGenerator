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
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      if (grid[y][x].terrain !== Terrain.Door) continue;
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if (grid[y + offsetY]?.[x + offsetX]?.terrain === Terrain.Ground) {
            reserved.add(`${x + offsetX},${y + offsetY}`);
          }
        }
      }
    }
  }
  for (const room of rooms) {
    if (/Nave and transept|Common room/i.test(room.role)) continue;
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
  return reserved;
}

export function decorateInterior(grid: Grid, mode: InteriorMode, random: Random) {
  if (mode === "ship-deck") return;
  const rooms = collectRooms(grid);
  const reserved = reserveCirculation(grid, rooms);
  let nextPropId = 1;

  const available = (room: Room, points: Point[]) => points.every(({ x, y }) => {
    const tile = grid[y]?.[x];
    return tile?.terrain === Terrain.Ground && tile.roomId === room.id &&
      !tile.interiorProp && !reserved.has(`${x},${y}`);
  });
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
  const placeComposition = (room: Room, props: PlannedProp[]) => {
    const points = props.flatMap((prop) => prop.points);
    if (!points.length || new Set(points.map(key)).size !== points.length ||
      !available(room, points) || !roomRemainsConnected(room, points)) return false;
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
        const length = Math.min(maximum, usable.length);
        if (length < minimum) continue;
        const start = Math.floor((usable.length - length) / 2);
        if (place(room, kind, usable.slice(start, start + length), run.orientation, run.facing)) return true;
      }
    }
    return false;
  };

  const placeServiceBar = (room: Room) => {
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
        if (contiguous && available(room, [candidate.counter])) run.push(candidate);
        else {
          if (run.length) runs.push(run);
          run = available(room, [candidate.counter]) ? [candidate] : [];
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
      if (!place(room, "bar", bar.map(({ counter }) => counter), orientation)) continue;
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
        for (const point of footprint) {
          for (let offsetY = -spacing; offsetY <= spacing; offsetY += 1) {
            for (let offsetX = -spacing; offsetX <= spacing; offsetX += 1) {
              if (pointInRoom(room, point.x + offsetX, point.y + offsetY)) {
                reserved.add(`${point.x + offsetX},${point.y + offsetY}`);
              }
            }
          }
        }
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
    for (const altar of altarVariants) {
      if (!available(room, altar)) continue;
      const rowPlans: PlannedProp[][] = [];
      const axialLength = Math.abs(altarDepth - entranceDepth);
      for (let distance = 3; distance <= axialLength - 1 && rowPlans.length < 2; distance += 2) {
        const rowDepth = altarDepth - (horizontalAxis ? dx : dy) * distance;
        const first = [-2, -1].map((offset) => horizontalAxis
          ? { x: rowDepth, y: axis + offset }
          : { x: axis + offset, y: rowDepth });
        const second = [1, 2].map((offset) => horizontalAxis
          ? { x: rowDepth, y: axis + offset }
          : { x: axis + offset, y: rowDepth });
        const pair = [first, second].filter((points) => available(room, points)).map((points): PlannedProp => ({
          kind: "bench", points, orientation, facing: benchFacing,
        }));
        if (pair.length) rowPlans.push(pair);
      }
      for (let usedRows = rowPlans.length; usedRows >= 1; usedRows -= 1) {
        const benches = rowPlans.slice(0, usedRows).flat();
        if (placeComposition(room, [
          { kind: "altar", points: altar, orientation, facing: altarFacing },
          ...benches,
        ])) return;
      }
      if (place(room, "altar", altar, orientation, altarFacing)) return;
    }
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
    } else if (/Common room/i.test(role)) {
      placeServiceBar(room);
      const tableCount = Math.max(3, Math.min(6, Math.floor(room.cells.length / 34)));
      const squareTables = placeDiningSets(room, tableCount >= 5 ? 2 : 1, 1, "chair", 1);
      placeDiningSets(room, tableCount - squareTables, 2, "chair", 1);
    } else if (/Great hall/i.test(role)) {
      placeDiningSets(room, Math.max(1, Math.min(3, Math.floor(room.cells.length / 32))), 3, "bench");
    } else if (/Council room/i.test(role)) {
      placeDiningSets(room, 1, 3, "chair");
    } else if (/Living room|Chart room|Guardroom/i.test(role)) {
      placeDiningSets(room, room.cells.length >= 35 ? 2 : 1, 2, "chair");
      placeWallRun(room, "cabinet", 1, 3);
    } else if (/Kitchen|Galley/i.test(role)) {
      placeWallRun(room, "cabinet", 3, 6);
      if (room.cells.length >= 24) placeDiningSets(room, 1, 2, "chair");
    } else if (/Bedroom|Guest room|cabin|berths|quarters|Barracks|Medbay|Sick bay|Royal chamber|Clergy chamber/i.test(role)) {
      placeWallDepth(room, "bed", 2, /berths|quarters|Barracks|Medbay|Sick bay/i.test(role) ? 2 : 1);
      placeWallRun(room, "cabinet", 1, 2);
    } else if (/Burial vault/i.test(role)) {
      placeWallAlignedObjects(room, "tomb", 2,
        Math.max(1, Math.min(3, Math.floor(room.cells.length / 14))));
    } else if (/Cargo|hold|store|Magazine|Provision|Armory|Treasury/i.test(role)) {
      placeWallRun(room, "crate", 2, 5);
      placeScattered(room, "crate", Math.max(1, Math.min(4, Math.floor(room.cells.length / 14))));
    } else if (/Cockpit|Engineering|Laboratory|Life support|Utility|Observation|Airlock/i.test(role)) {
      placeWallRun(room, "console", 2, 5);
      if (/Cockpit|Laboratory/i.test(role)) placeDiningSets(room, 1, 1, "chair");
    } else if (/Sacristy|Vestry|Archive|Clergy|Chapter|Workshop/i.test(role)) {
      placeWallRun(room, "cabinet", 2, 4);
      if (room.cells.length >= 20) placeDiningSets(room, 1, 2, "chair");
    } else if (!/Hallway|passage|spine|gangway/i.test(role)) {
      placeWallRun(room, "cabinet", 1, 3);
      if (room.cells.length >= 28) placeDiningSets(room, 1, 2, "chair");
    }
  }
}
