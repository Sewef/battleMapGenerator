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

export interface InteriorVisualStyle {
  floorPattern: "wood" | "metal" | "stone";
  roomTints: string[];
  wall: string;
  wallAlt: string;
  wallHighlight: string;
  wallEdge: string;
  wallDetail: string;
  door: string;
  doorEdge: string;
  doorHighlight: string;
  hardware: string;
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
  spaceship: {
    ground: { color: "#87999d", alt: "#708287" },
    difficult: { color: "#65757a", alt: "#52636a" },
  },
  ship: {
    ground: { color: "#b18152", alt: "#96683f" },
    difficult: { color: "#815b3f", alt: "#674634" },
  },
  "ship-deck": {
    ground: { color: "#bd8b55", alt: "#9d6d41" },
    difficult: { color: "#80583a", alt: "#68452f" },
  },
  castle: {
    ground: { color: "#99988f", alt: "#85857e" },
    difficult: { color: "#74746e", alt: "#62635f" },
  },
  cathedral: {
    ground: { color: "#c8c1ab", alt: "#afa791" },
    difficult: { color: "#968e7d", alt: "#7f786b" },
  },
  tavern: {
    ground: { color: "#bb8d58", alt: "#a37447" },
    difficult: { color: "#866344", alt: "#6e4e38" },
  },
  crypt: {
    ground: { color: "#6d706d", alt: "#5b5f5d" },
    difficult: { color: "#4f5553", alt: "#414746" },
  },
};

const interiorVisualStyles: Partial<Record<LandscapeMode, InteriorVisualStyle>> = {
  house: {
    floorPattern: "wood", roomTints: ["rgba(255,232,184,.055)", "rgba(119,76,48,.045)", "rgba(221,190,129,.06)", "rgba(105,71,52,.035)"],
    wall: "#5b4638", wallAlt: "#3d3029", wallHighlight: "rgba(255,226,176,.12)", wallEdge: "rgba(42,29,24,.34)", wallDetail: "rgba(226,185,127,.12)",
    door: "#9f603b", doorEdge: "#432b22", doorHighlight: "rgba(244,197,126,.35)", hardware: "#d7b065",
  },
  spaceship: {
    floorPattern: "metal", roomTints: ["rgba(190,230,235,.05)", "rgba(45,74,82,.055)", "rgba(155,190,198,.045)"],
    wall: "#40535b", wallAlt: "#293940", wallHighlight: "rgba(193,229,233,.18)", wallEdge: "rgba(20,31,36,.55)", wallDetail: "rgba(104,180,192,.22)",
    door: "#60777e", doorEdge: "#1f3036", doorHighlight: "rgba(164,226,232,.5)", hardware: "#d28b46",
  },
  ship: {
    floorPattern: "wood", roomTints: ["rgba(255,211,145,.05)", "rgba(83,48,28,.05)", "rgba(202,146,81,.05)"],
    wall: "#513a2c", wallAlt: "#34261f", wallHighlight: "rgba(236,184,116,.13)", wallEdge: "rgba(38,24,18,.5)", wallDetail: "rgba(205,141,77,.17)",
    door: "#875232", doorEdge: "#35231b", doorHighlight: "rgba(236,177,102,.35)", hardware: "#c9a258",
  },
  "ship-deck": {
    floorPattern: "wood", roomTints: ["rgba(255,226,170,.04)", "rgba(83,48,28,.035)", "rgba(220,164,96,.045)"],
    wall: "#5b402e", wallAlt: "#38271f", wallHighlight: "rgba(245,198,132,.16)", wallEdge: "rgba(38,24,18,.52)", wallDetail: "rgba(220,153,82,.18)",
    door: "#93603a", doorEdge: "#35231b", doorHighlight: "rgba(246,190,112,.38)", hardware: "#d3af62",
  },
  castle: {
    floorPattern: "stone", roomTints: ["rgba(233,230,214,.045)", "rgba(59,64,63,.045)", "rgba(174,174,161,.05)"],
    wall: "#555957", wallAlt: "#383d3c", wallHighlight: "rgba(221,221,204,.14)", wallEdge: "rgba(28,32,32,.52)", wallDetail: "rgba(194,195,182,.15)",
    door: "#75513a", doorEdge: "#30251f", doorHighlight: "rgba(200,158,104,.3)", hardware: "#aa9266",
  },
  cathedral: {
    floorPattern: "stone", roomTints: ["rgba(255,248,220,.06)", "rgba(123,105,76,.035)", "rgba(216,197,151,.05)"],
    wall: "#756f62", wallAlt: "#514c45", wallHighlight: "rgba(255,244,210,.18)", wallEdge: "rgba(47,42,37,.43)", wallDetail: "rgba(221,201,158,.2)",
    door: "#8a6238", doorEdge: "#3d3024", doorHighlight: "rgba(242,207,129,.44)", hardware: "#d2b35d",
  },
  tavern: {
    floorPattern: "wood", roomTints: ["rgba(255,218,158,.065)", "rgba(103,57,31,.045)", "rgba(217,151,78,.055)"],
    wall: "#624632", wallAlt: "#3f2e25", wallHighlight: "rgba(255,205,137,.14)", wallEdge: "rgba(47,29,21,.42)", wallDetail: "rgba(226,154,82,.15)",
    door: "#9a5d35", doorEdge: "#43291e", doorHighlight: "rgba(242,182,103,.4)", hardware: "#cfaa5b",
  },
  crypt: {
    floorPattern: "stone", roomTints: ["rgba(185,196,187,.035)", "rgba(20,29,29,.07)", "rgba(101,118,111,.04)"],
    wall: "#363d3c", wallAlt: "#222929", wallHighlight: "rgba(163,180,168,.11)", wallEdge: "rgba(13,19,20,.64)", wallDetail: "rgba(112,133,124,.14)",
    door: "#55463a", doorEdge: "#201d1a", doorHighlight: "rgba(155,134,105,.25)", hardware: "#787765",
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
  spaceship: "cold", ship: "temperate", "ship-deck": "temperate", castle: "cold",
  cathedral: "temperate", tavern: "temperate", crypt: "dark",
};

export function getTerrainStyle(kind: TerrainKind, mode: LandscapeMode): TerrainStyle {
  const base = terrainStyles[kind];
  const biomeBase = kind === Terrain.Ground
    ? { ...base, ...biomePalettes[mode].ground }
    : kind === Terrain.Difficult
      ? { ...base, ...biomePalettes[mode].difficult }
      : base;
  const interiorStyle = interiorVisualStyles[mode];
  const architectureStyle = interiorStyle && kind === Terrain.Wall
    ? { color: interiorStyle.wall, alt: interiorStyle.wallAlt }
    : interiorStyle && kind === Terrain.Door
      ? { color: interiorStyle.door, alt: interiorStyle.doorEdge }
      : undefined;
  return {
    ...biomeBase,
    ...visualProfiles[visualProfileByMode[mode]].terrain[kind],
    ...architectureStyle,
  };
}

export function getBiomeObjectStyle(mode: LandscapeMode): BiomeObjectStyle {
  return visualProfiles[visualProfileByMode[mode]].objects;
}

export function getInteriorVisualStyle(mode: LandscapeMode) {
  return interiorVisualStyles[mode];
}
