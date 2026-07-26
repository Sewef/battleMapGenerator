export const Terrain = {
  Void: "void",
  Ground: "ground",
  Difficult: "difficult",
  Water: "water",
  Lava: "lava",
  Beach: "beach",
  Road: "road",
  Bridge: "bridge",
  Cliff: "cliff",
  Ravine: "ravine",
} as const;

export const Obstacle = {
  None: "none",
  Tree: "tree",
  Rock: "rock",
  Building: "building",
} as const;

export type TerrainKind = (typeof Terrain)[keyof typeof Terrain];
export type ObstacleKind = (typeof Obstacle)[keyof typeof Obstacle];
export type LandscapeMode =
  | "countryside"
  | "river"
  | "coast"
  | "wetlands"
  | "underground"
  | "volcanic"
  | "highlands"
  | "city";

export interface Tile {
  terrain: TerrainKind;
  obstacle: ObstacleKind;
  obstacleId?: number;
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
  [Terrain.Lava]: { label: "Lava", movement: "blocked", blocksSight: false },
  [Terrain.Beach]: { label: "Beach", movement: "slow", blocksSight: false },
  [Terrain.Road]: { label: "Road", movement: "normal", blocksSight: false },
  [Terrain.Bridge]: { label: "Bridge", movement: "normal", blocksSight: false },
  [Terrain.Cliff]: { label: "Cliff", movement: "blocked", blocksSight: true },
  [Terrain.Ravine]: { label: "Ravine", movement: "blocked", blocksSight: false },
};

export const OBSTACLE_RULES: Record<
  Exclude<ObstacleKind, "none">,
  { label: string; movement: "blocked"; blocksSight: boolean }
> = {
  [Obstacle.Tree]: { label: "Tree", movement: "blocked", blocksSight: true },
  [Obstacle.Rock]: { label: "Rock", movement: "blocked", blocksSight: false },
  [Obstacle.Building]: { label: "Building", movement: "blocked", blocksSight: true },
};
