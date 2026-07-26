import {
  Terrain,
  type LandscapeMode,
  type TerrainKind,
} from "../domain/map";

export interface TerrainStyle {
  color: string;
  alt: string;
  label: string;
}

const terrainStyles: Record<TerrainKind, TerrainStyle> = {
  [Terrain.Void]: { color: "#263334", alt: "#222f30", label: "Void" },
  [Terrain.Ground]: { color: "#b8ca8e", alt: "#afc382", label: "Ground" },
  [Terrain.Difficult]: { color: "#9fa96c", alt: "#949f61", label: "Difficult" },
  [Terrain.Water]: { color: "#7ea7a7", alt: "#739c9e", label: "Water" },
  [Terrain.Lava]: { color: "#d7542f", alt: "#bd3e27", label: "Lava" },
  [Terrain.Beach]: { color: "#d8c68f", alt: "#cfbb80", label: "Beach" },
  [Terrain.Road]: { color: "#aa9475", alt: "#a28b6c", label: "Road" },
  [Terrain.Bridge]: { color: "#876d4f", alt: "#7e6448", label: "Bridge" },
  [Terrain.Rock]: { color: "#85877c", alt: "#7a7d72", label: "Rock" },
  [Terrain.Cliff]: { color: "#6f7165", alt: "#64675c", label: "Cliff" },
  [Terrain.Ravine]: { color: "#776b59", alt: "#6c604f", label: "Ravine" },
};

const biomePalettes: Record<
  LandscapeMode,
  { ground: Omit<TerrainStyle, "label">; difficult: Omit<TerrainStyle, "label"> }
> = {
  countryside: {
    ground: { color: "#b8ca8e", alt: "#afc382" },
    difficult: { color: "#9fa96c", alt: "#949f61" },
  },
  river: {
    ground: { color: "#a9c58b", alt: "#9dbb7f" },
    difficult: { color: "#7f9b68", alt: "#758f60" },
  },
  coast: {
    ground: { color: "#b9bf86", alt: "#adb47b" },
    difficult: { color: "#99996a", alt: "#8d8d60" },
  },
  wetlands: {
    ground: { color: "#9ca874", alt: "#919d6b" },
    difficult: { color: "#747b58", alt: "#69714f" },
  },
  underground: {
    ground: { color: "#8b887d", alt: "#817e74" },
    difficult: { color: "#68665f", alt: "#5e5c56" },
  },
  volcanic: {
    ground: { color: "#5f615d", alt: "#565955" },
    difficult: { color: "#414744", alt: "#3a0b0b" },
  },
  city: {
    ground: { color: "#b9b19c", alt: "#afa690" },
    difficult: { color: "#8f8775", alt: "#857d6d" },
  },
  highlands: {
    ground: { color: "#a9aa7d", alt: "#9d9f73" },
    difficult: { color: "#858360", alt: "#797858" },
  },
};

export function getTerrainStyle(kind: TerrainKind, mode: LandscapeMode): TerrainStyle {
  const base = terrainStyles[kind];
  if (kind === Terrain.Ground) return { ...base, ...biomePalettes[mode].ground };
  if (kind === Terrain.Difficult) return { ...base, ...biomePalettes[mode].difficult };
  return base;
}
