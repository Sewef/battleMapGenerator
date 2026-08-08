export const Terrain = {
  Void: "void",
  Ground: "ground",
  Difficult: "difficult",
  Water: "water",
  Ice: "ice",
  Lava: "lava",
  Beach: "beach",
  Road: "road",
  Bridge: "bridge",
  Cliff: "cliff",
  Ravine: "ravine",
  Wall: "wall",
  Door: "door",
} as const;

export const Obstacle = {
  None: "none",
  Tree: "tree",
  Rock: "rock",
  Building: "building",
} as const;

export type TerrainKind = (typeof Terrain)[keyof typeof Terrain];
export type SurfaceKind = typeof Terrain.Road | typeof Terrain.Bridge;
export type ObstacleKind = (typeof Obstacle)[keyof typeof Obstacle];
export type LandscapeMode =
  | "countryside"
  | "river"
  | "coast"
  | "wetlands"
  | "underground"
  | "volcanic"
  | "highlands"
  | "city"
  | "desert-canyon"
  | "ancient-forest"
  | "frozen-lake"
  | "badlands"
  | "ruined-battlefield"
  | "farmland"
  | "archipelago"
  | "mountain-pass"
  | "sewer"
  | "ancient-ruins"
  | "house"
  | "spaceship"
  | "ship"
  | "ship-deck"
  | "castle"
  | "cathedral"
  | "tavern"
  | "crypt";

export type InteriorMode = Extract<
  LandscapeMode,
  "house" | "spaceship" | "ship" | "ship-deck" | "castle" | "cathedral" | "tavern" | "crypt"
>;

const interiorModes = new Set<LandscapeMode>([
  "house",
  "spaceship",
  "ship",
  "ship-deck",
  "castle",
  "cathedral",
  "tavern",
  "crypt",
]);

export function isInteriorMode(mode: LandscapeMode): mode is InteriorMode {
  return interiorModes.has(mode);
}

export const INTERIOR_ROOM_LIMITS: Record<
  InteriorMode,
  { minimum: number; maximum: number }
> = {
  house: { minimum: 4, maximum: 7 },
  tavern: { minimum: 4, maximum: 7 },
  spaceship: { minimum: 4, maximum: 12 },
  ship: { minimum: 4, maximum: 12 },
  "ship-deck": { minimum: 4, maximum: 8 },
  castle: { minimum: 5, maximum: 12 },
  cathedral: { minimum: 5, maximum: 9 },
  crypt: { minimum: 3, maximum: 12 },
};

export const INTERIOR_MINIMUM_DIMENSIONS: Record<
  InteriorMode,
  { width: number; height: number }
> = {
  house: { width: 24, height: 16 },
  tavern: { width: 24, height: 16 },
  spaceship: { width: 24, height: 16 },
  ship: { width: 24, height: 16 },
  "ship-deck": { width: 30, height: 16 },
  castle: { width: 32, height: 24 },
  cathedral: { width: 28, height: 30 },
  crypt: { width: 24, height: 16 },
};

export interface Tile {
  terrain: TerrainKind;
  surface?: SurfaceKind;
  obstacle: ObstacleKind;
  obstacleId?: number;
  elevation?: number;
  height?: number;
  transition?: "slope";
  transitionNormalX?: number;
  transitionNormalY?: number;
  roomId?: number;
  roomRole?: string;
  doorOrientation?: "horizontal" | "vertical";
  deckFeature?: "mast" | "hatch" | "wheel" | "capstan";
}

export function tileSurface(tile: Tile): SurfaceKind | undefined {
  if (tile.surface) return tile.surface;
  return tile.terrain === Terrain.Road || tile.terrain === Terrain.Bridge
    ? tile.terrain
    : undefined;
}

export function setTileSurface(tile: Tile, surface: SurfaceKind) {
  if (tile.terrain === Terrain.Road || tile.terrain === Terrain.Bridge) {
    tile.terrain = Terrain.Ground;
  }
  tile.surface = surface;
}

export type Grid = Tile[][];

export interface TerrainOptions {
  width: number;
  height: number;
  seed: string;
  scale: number;
  mode: LandscapeMode;
  waterWeight: number;
  difficultWeight: number;
  reliefWeight: number;
  rockRatio: number;
  treeRatio: number;
  buildingCount: number;
}

export interface Preset extends TerrainOptions {
  id: string;
  name: string;
  description: string;
}

export const TERRAIN_RULES: Record<
  TerrainKind,
  { label: string; movement: "normal" | "slow" | "blocked"; blocksSight: boolean }
> = {
  [Terrain.Void]: { label: "Void", movement: "blocked", blocksSight: true },
  [Terrain.Ground]: { label: "Ground", movement: "normal", blocksSight: false },
  [Terrain.Difficult]: { label: "Difficult terrain", movement: "slow", blocksSight: false },
  [Terrain.Water]: { label: "Water", movement: "slow", blocksSight: false },
  [Terrain.Ice]: { label: "Ice", movement: "normal", blocksSight: false },
  [Terrain.Lava]: { label: "Lava", movement: "blocked", blocksSight: false },
  [Terrain.Beach]: { label: "Beach", movement: "slow", blocksSight: false },
  [Terrain.Road]: { label: "Road", movement: "normal", blocksSight: false },
  [Terrain.Bridge]: { label: "Bridge", movement: "normal", blocksSight: false },
  [Terrain.Cliff]: { label: "Cliff", movement: "blocked", blocksSight: true },
  [Terrain.Ravine]: { label: "Ravine", movement: "blocked", blocksSight: false },
  [Terrain.Wall]: { label: "Wall", movement: "blocked", blocksSight: true },
  [Terrain.Door]: { label: "Door", movement: "normal", blocksSight: false },
};

export const OBSTACLE_RULES: Record<
  Exclude<ObstacleKind, "none">,
  { label: string; movement: "blocked"; blocksSight: boolean }
> = {
  [Obstacle.Tree]: { label: "Tree", movement: "blocked", blocksSight: true },
  [Obstacle.Rock]: { label: "Rock", movement: "blocked", blocksSight: false },
  [Obstacle.Building]: { label: "Building", movement: "blocked", blocksSight: true },
};
