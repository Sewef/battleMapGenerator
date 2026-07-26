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
  [Terrain.Ice]: { color: "#a9ced3", alt: "#9bc1c8", label: "Ice" },
  [Terrain.Lava]: { color: "#d7542f", alt: "#bd3e27", label: "Lava" },
  [Terrain.Beach]: { color: "#d8c68f", alt: "#cfbb80", label: "Beach" },
  [Terrain.Road]: { color: "#aa9475", alt: "#a28b6c", label: "Road" },
  [Terrain.Bridge]: { color: "#876d4f", alt: "#7e6448", label: "Bridge" },
  [Terrain.Cliff]: { color: "#66685f", alt: "#575950", label: "Cliff" },
  [Terrain.Ravine]: { color: "#59483f", alt: "#493a34", label: "Ravine" },
};

const biomePalettes: Record<
  LandscapeMode,
  { ground: Omit<TerrainStyle, "label">; difficult: Omit<TerrainStyle, "label"> }
> = {
  "desert-canyon": {
    ground: { color: "#c98f5c", alt: "#bb7f50" },
    difficult: { color: "#a96843", alt: "#995c3b" },
  },
  "ancient-forest": {
    ground: { color: "#78905f", alt: "#6d8455" },
    difficult: { color: "#4f6747", alt: "#465d3f" },
  },
  "frozen-lake": {
    ground: { color: "#d4dcda", alt: "#c5d0d0" },
    difficult: { color: "#a9b9bb", alt: "#9daeb1" },
  },
  badlands: {
    ground: { color: "#b87954", alt: "#aa6d4b" },
    difficult: { color: "#8f513d", alt: "#814635" },
  },
  "ruined-battlefield": {
    ground: { color: "#8c8267", alt: "#81775e" },
    difficult: { color: "#625b4d", alt: "#575146" },
  },
  farmland: {
    ground: { color: "#b2bd78", alt: "#a6b16d" },
    difficult: { color: "#8d965a", alt: "#818a50" },
  },
  archipelago: {
    ground: { color: "#9fbd78", alt: "#93b16d" },
    difficult: { color: "#708d5c", alt: "#668253" },
  },
  "mountain-pass": {
    ground: { color: "#9a9987", alt: "#8e8d7c" },
    difficult: { color: "#747467", alt: "#69695e" },
  },
  sewer: {
    ground: { color: "#777a70", alt: "#6d7067" },
    difficult: { color: "#555d55", alt: "#4b534c" },
  },
  "ancient-ruins": {
    ground: { color: "#a9a184", alt: "#9e967a" },
    difficult: { color: "#77745d", alt: "#6c6954" },
  },
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
    ground: { color: "#625d57", alt: "#58534e" },
    difficult: { color: "#84725f", alt: "#786653" },
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
  return kind === Terrain.Ground
    ? { ...base, ...biomePalettes[mode].ground }
    : kind === Terrain.Difficult
      ? { ...base, ...biomePalettes[mode].difficult }
      : base;
}
