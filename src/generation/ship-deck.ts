import {
  DECK_FEATURE_RULES,
  Obstacle,
  Terrain,
  type Grid,
  type Tile,
} from "../domain/map";
import type { Random } from "./types";

type Point = { x: number; y: number };
type Facing = NonNullable<Tile["deckFeatureFacing"]>;
type Feature = NonNullable<Tile["deckFeature"]>;

const pointKey = ({ x, y }: Point) => `${x},${y}`;

function roleCells(grid: Grid, role: string) {
  const cells: Point[] = [];
  grid.forEach((row, y) => row.forEach((tile, x) => {
    if (tile.terrain === Terrain.Ground && tile.roomRole === role) cells.push({ x, y });
  }));
  return cells;
}

function groundCells(grid: Grid) {
  const cells: Point[] = [];
  grid.forEach((row, y) => row.forEach((tile, x) => {
    if (tile.terrain === Terrain.Ground) cells.push({ x, y });
  }));
  return cells;
}

function averageX(cells: Point[]) {
  return cells.reduce((sum, { x }) => sum + x, 0) / cells.length;
}

function orderedOffsets(radius: number) {
  const offsets = [0];
  for (let distance = 1; distance <= radius; distance += 1) {
    offsets.push(-distance, distance);
  }
  return offsets;
}

function deckComponents(grid: Grid) {
  const open = new Set<string>();
  grid.forEach((row, y) => row.forEach((tile, x) => {
    if ((tile.terrain === Terrain.Ground || tile.terrain === Terrain.Door) &&
      (!tile.deckFeature || DECK_FEATURE_RULES[tile.deckFeature].movement !== "blocked")) {
      open.add(`${x},${y}`);
    }
  }));
  const components: Set<string>[] = [];
  while (open.size) {
    const start = open.values().next().value as string;
    const component = new Set([start]);
    const queue = [start];
    open.delete(start);
    for (let index = 0; index < queue.length; index += 1) {
      const [x, y] = queue[index].split(",").map(Number);
      for (const [offsetX, offsetY] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const next = `${x + offsetX},${y + offsetY}`;
        if (!open.has(next)) continue;
        open.delete(next);
        component.add(next);
        queue.push(next);
      }
    }
    components.push(component);
  }
  return components;
}

/**
 * Turns the open ship shell into a working weather deck. Equipment is kept on
 * the longitudinal axis or mirrored at the rails, leaving two continuous side
 * passages around the central machinery.
 */
export function decorateSailingShipDeck(grid: Grid, random: Random) {
  const deck = groundCells(grid);
  const quarterdeck = roleCells(grid, "Quarterdeck");
  const forecastle = roleCells(grid, "Forecastle");
  if (!deck.length || !quarterdeck.length || !forecastle.length) return;

  const minX = Math.min(...deck.map(({ x }) => x));
  const maxX = Math.max(...deck.map(({ x }) => x));
  const minY = Math.min(...deck.map(({ y }) => y));
  const maxY = Math.max(...deck.map(({ y }) => y));
  const centerY = (minY + maxY) / 2;
  const direction = averageX(forecastle) > averageX(quarterdeck) ? 1 : -1;
  const aftX = direction > 0 ? minX : maxX;
  const foreX = direction > 0 ? maxX : minX;
  const longitudinalSpan = Math.abs(foreX - aftX);
  const facingAlong = (sign: number): Facing => direction * sign > 0 ? "east" : "west";
  const raisedRoles = new Set(["Quarterdeck", "Forecastle", "Head platform", "Bowsprit deck"]);

  for (const { x, y } of deck) {
    const raised = raisedRoles.has(grid[y][x].roomRole ?? "");
    grid[y][x].elevation = raised ? 2 : 1;
    grid[y][x].height = raised ? .47 : .32;
  }

  const reserved = new Set<string>();
  const featurePoints = new Map<Feature, Point[]>();
  const place = (point: Point, feature: Feature, facing?: Facing) => {
    const tile = grid[point.y]?.[point.x];
    const key = pointKey(point);
    if (tile?.terrain !== Terrain.Ground || reserved.has(key)) return false;
    tile.deckFeature = feature;
    tile.deckFeatureFacing = facing;
    reserved.add(key);
    const points = featurePoints.get(feature) ?? [];
    points.push(point);
    featurePoints.set(feature, points);
    return true;
  };

  const quarterdeckBoundary = direction > 0
    ? Math.max(...quarterdeck.map(({ x }) => x))
    : Math.min(...quarterdeck.map(({ x }) => x));
  const forecastleBoundary = direction > 0
    ? Math.min(...forecastle.map(({ x }) => x))
    : Math.max(...forecastle.map(({ x }) => x));

  const addRaisedDeckEdge = (x: number, climbDirection: number) => {
    const column = deck.filter((point) => point.x === x).sort((a, b) => a.y - b.y);
    const upper = column.filter(({ y }) => y < centerY)
      .sort((a, b) => Math.abs(a.y - (centerY - 2)) - Math.abs(b.y - (centerY - 2)))[0];
    const lower = column.filter(({ y }) => y > centerY)
      .sort((a, b) => Math.abs(a.y - (centerY + 2)) - Math.abs(b.y - (centerY + 2)))[0];
    const stairs = new Set([upper, lower].filter((point): point is Point => Boolean(point)).map(pointKey));
    for (const point of column) {
      if (stairs.has(pointKey(point))) place(point, "stairs", facingAlong(climbDirection));
      else place(point, "railing", facingAlong(climbDirection));
    }
  };
  addRaisedDeckEdge(quarterdeckBoundary, -1);
  if (forecastleBoundary !== quarterdeckBoundary) addRaisedDeckEdge(forecastleBoundary, 1);

  const xAt = (ratio: number) => Math.round(aftX + (foreX - aftX) * ratio);
  const featureClear = (point: Point, clearance: number) => {
    for (const key of reserved) {
      const [otherX, otherY] = key.split(",").map(Number);
      if (Math.abs(point.x - otherX) + Math.abs(point.y - otherY) <= clearance) return false;
    }
    return true;
  };
  const placeNearAxis = (
    feature: Feature,
    ratio: number,
    facing: Facing,
    roles?: Set<string>,
    clearance = 0,
  ) => {
    const targetX = xAt(ratio);
    const candidates = deck.filter(({ x, y }) => {
      const tile = grid[y][x];
      return (!roles || roles.has(tile.roomRole ?? "")) && featureClear({ x, y }, clearance);
    }).sort((a, b) => {
      const scoreA = Math.abs(a.x - targetX) * 8 + Math.abs(a.y - centerY);
      const scoreB = Math.abs(b.x - targetX) * 8 + Math.abs(b.y - centerY);
      return scoreA - scoreB;
    });
    return candidates.some((point) => place(point, feature, facing));
  };

  placeNearAxis("wheel", .08, facingAlong(1), new Set(["Quarterdeck"]));

  const mastRatios = longitudinalSpan >= 21 ? [.24, .5, .75] : [.34, .68];
  for (const ratio of mastRatios) placeNearAxis("mast", ratio, facingAlong(1), undefined, 1);

  for (const ratio of [.38, .62]) {
    placeNearAxis("hatch", ratio, facingAlong(1));
  }
  placeNearAxis(
    "capstan",
    .86,
    facingAlong(1),
    new Set(["Fore waist", "Forecastle", "Head platform"]),
    1,
  );

  const sideGroundAt = (x: number) => {
    const cells = deck.filter((point) => point.x === x).sort((a, b) => a.y - b.y);
    if (cells.length < 5) return undefined;
    const north = cells[0];
    const south = cells[cells.length - 1];
    if (Math.abs((north.y + south.y) / 2 - centerY) > .01) return undefined;
    if (grid[north.y + 1]?.[x]?.terrain !== Terrain.Ground ||
      grid[south.y - 1]?.[x]?.terrain !== Terrain.Ground) return undefined;
    return { north, south };
  };
  const cannonXs: number[] = [];
  const placeCannonPair = (targetX: number) => {
    for (const offset of orderedOffsets(5)) {
      const x = targetX + offset * direction;
      if (x < minX || x > maxX || cannonXs.some((other) => Math.abs(other - x) < 3)) continue;
      const sides = sideGroundAt(x);
      if (!sides || !featureClear(sides.north, 0) || !featureClear(sides.south, 0)) continue;
      if (!place(sides.north, "cannon", "north")) continue;
      if (!place(sides.south, "cannon", "south")) {
        const northTile = grid[sides.north.y][sides.north.x];
        northTile.deckFeature = undefined;
        northTile.deckFeatureFacing = undefined;
        reserved.delete(pointKey(sides.north));
        featurePoints.get("cannon")?.pop();
        continue;
      }
      cannonXs.push(x);
      return true;
    }
    return false;
  };
  const desiredCannonPairs = longitudinalSpan >= 32 ? 4 : 3;
  const cannonRatios = desiredCannonPairs === 4
    ? [.16, .37, .63, .84]
    : [.22, .5, .78];
  for (const ratio of cannonRatios) {
    const jitter = Math.round((random() - .5) * 2);
    placeCannonPair(xAt(ratio) + jitter * direction);
  }

  const gangwaySides: Array<"north" | "south"> = random() < .5
    ? ["north", "south"]
    : ["south", "north"];
  const gangwayTargets = orderedOffsets(Math.ceil(longitudinalSpan / 2))
    .map((offset) => xAt(.5) + offset * direction);
  let gangwayPlaced = false;
  for (const side of gangwaySides) {
    for (const x of gangwayTargets) {
      if (x < minX || x > maxX || cannonXs.some((cannonX) => Math.abs(cannonX - x) <= 1)) continue;
      const yRange = side === "north"
        ? Array.from({ length: grid.length }, (_, y) => y)
        : Array.from({ length: grid.length }, (_, index) => grid.length - index - 1);
      const y = yRange.find((candidateY) => {
        const wall = grid[candidateY]?.[x];
        const outside = grid[candidateY + (side === "north" ? -1 : 1)]?.[x];
        const inside = grid[candidateY + (side === "north" ? 1 : -1)]?.[x];
        return wall?.terrain === Terrain.Wall && outside?.terrain === Terrain.Void &&
          inside?.terrain === Terrain.Ground && !inside.deckFeature;
      });
      if (y === undefined) continue;
      grid[y][x] = {
        terrain: Terrain.Door,
        obstacle: Obstacle.None,
        height: .34,
        elevation: 1,
        doorOrientation: "horizontal",
        deckFeature: "gangway",
        deckFeatureFacing: side,
      };
      gangwayPlaced = true;
      break;
    }
    if (gangwayPlaced) break;
  }

  // A narrow hull or a rare alignment can make one stair opening insufficient.
  // Promote additional rail sections to stairs only when doing so joins two
  // otherwise disconnected deck components.
  let components = deckComponents(grid);
  while (components.length > 1) {
    const rail = featurePoints.get("railing")?.find(({ x, y }) => {
      const neighborComponents = new Set<number>();
      for (const [offsetX, offsetY] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const neighbor = `${x + offsetX},${y + offsetY}`;
        components.forEach((component, index) => {
          if (component.has(neighbor)) neighborComponents.add(index);
        });
      }
      return neighborComponents.size >= 2;
    });
    if (!rail) break;
    grid[rail.y][rail.x].deckFeature = "stairs";
    grid[rail.y][rail.x].deckFeatureFacing = facingAlong(
      rail.x === quarterdeckBoundary ? -1 : 1,
    );
    components = deckComponents(grid);
  }
}
