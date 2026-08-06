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

export interface BiomeObjectStyle {
  tree: { dark: string; light: string; trunk: string };
  rock: { fill: string; highlight: string; stroke: string };
  building: { primary: string; secondary: string; edge: string };
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
  [Terrain.Wall]: { color: "#5b4638", alt: "#3d3029", label: "Wall" },
  [Terrain.Door]: { color: "#a9683f", alt: "#6d402b", label: "Door" },
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
  house: {
    ground: { color: "#c8a972", alt: "#b7935d" },
    difficult: { color: "#987653", alt: "#806044" },
  },
};

type VisualProfile = {
  terrain: Partial<Record<TerrainKind, Omit<TerrainStyle, "label">>>;
  objects: BiomeObjectStyle;
};

type VisualProfileName = "temperate" | "arid" | "cold" | "dark";

const visualProfiles: Record<VisualProfileName, VisualProfile> = {
  temperate: {
    terrain: {
      [Terrain.Water]: { color: "#729fa2", alt: "#527f85" },
      [Terrain.Road]: { color: "#b19a76", alt: "#725f49" },
      [Terrain.Bridge]: { color: "#806044", alt: "#513b2c" },
    },
    objects: {
      tree: { dark: "#294638", light: "#5f7d54", trunk: "#d7d3b6" },
      rock: { fill: "#555a59", highlight: "#92958f", stroke: "#343837" },
      building: { primary: "#a85d43", secondary: "#bb6e4b", edge: "#432820" },
    },
  },
  arid: {
    terrain: {
      [Terrain.Water]: { color: "#4f9295", alt: "#346e73" },
      [Terrain.Beach]: { color: "#dfbd78", alt: "#bd9656" },
      [Terrain.Road]: { color: "#e0b477", alt: "#8c603d" },
      [Terrain.Bridge]: { color: "#8c6240", alt: "#513720" },
      [Terrain.Cliff]: { color: "#87533d", alt: "#60372d" },
      [Terrain.Ravine]: { color: "#51342e", alt: "#35231f" },
    },
    objects: {
      tree: { dark: "#42513a", light: "#74805b", trunk: "#c6b184" },
      rock: { fill: "#704b3f", highlight: "#bd8060", stroke: "#442c27" },
      building: { primary: "#9a563c", secondary: "#bb724c", edge: "#543126" },
    },
  },
  cold: {
    terrain: {
      [Terrain.Water]: { color: "#739eaa", alt: "#4f7885" },
      [Terrain.Road]: { color: "#a59d8d", alt: "#65615a" },
      [Terrain.Bridge]: { color: "#756a5d", alt: "#49413a" },
      [Terrain.Cliff]: { color: "#70787a", alt: "#50595d" },
    },
    objects: {
      tree: { dark: "#304a48", light: "#69817a", trunk: "#d8ded8" },
      rock: { fill: "#596267", highlight: "#aebabc", stroke: "#333b3e" },
      building: { primary: "#765d54", secondary: "#92736a", edge: "#403431" },
    },
  },
  dark: {
    terrain: {
      [Terrain.Water]: { color: "#496b6c", alt: "#304c4e" },
      [Terrain.Road]: { color: "#827968", alt: "#49443c" },
      [Terrain.Bridge]: { color: "#645547", alt: "#392f28" },
      [Terrain.Cliff]: { color: "#4e5350", alt: "#343936" },
      [Terrain.Ravine]: { color: "#372f2c", alt: "#211d1b" },
    },
    objects: {
      tree: { dark: "#273b32", light: "#4d6754", trunk: "#aaa894" },
      rock: { fill: "#424745", highlight: "#7e8580", stroke: "#272b29" },
      building: { primary: "#725044", secondary: "#876052", edge: "#342824" },
    },
  },
};

const visualProfileByMode: Record<LandscapeMode, VisualProfileName> = {
  countryside: "temperate", river: "temperate", coast: "temperate",
  wetlands: "temperate", farmland: "temperate", archipelago: "temperate",
  city: "temperate", "ancient-forest": "temperate",
  "desert-canyon": "arid", badlands: "arid",
  "ruined-battlefield": "arid", volcanic: "arid",
  "frozen-lake": "cold", highlands: "cold", "mountain-pass": "cold",
  underground: "dark", sewer: "dark", "ancient-ruins": "dark",
  house: "temperate",
};

export function getTerrainStyle(kind: TerrainKind, mode: LandscapeMode): TerrainStyle {
  const base = terrainStyles[kind];
  const biomeBase = kind === Terrain.Ground
    ? { ...base, ...biomePalettes[mode].ground }
    : kind === Terrain.Difficult
      ? { ...base, ...biomePalettes[mode].difficult }
      : base;
  return {
    ...biomeBase,
    ...visualProfiles[visualProfileByMode[mode]].terrain[kind],
  };
}

export function getBiomeObjectStyle(mode: LandscapeMode): BiomeObjectStyle {
  return visualProfiles[visualProfileByMode[mode]].objects;
}
