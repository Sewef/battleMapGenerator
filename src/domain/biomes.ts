import type { Preset } from "./map";

export const PRESETS: Preset[] = [
  {
    id: "countryside",
    name: "Open countryside",
    description: "A main road, a pond, and open ground.",
    width: 36, height: 24, seed: "", scale: 10, mode: "countryside",
    rockRatio: 0.02, treeRatio: 0.05, buildingCount: 2,
  },
  {
    id: "river",
    name: "River valley",
    description: "A continuous river, banks, a road, and a bridge.",
    width: 36, height: 24, seed: "", scale: 8, mode: "river",
    rockRatio: 0.01, treeRatio: 0.09, buildingCount: 1,
  },
  {
    id: "coast",
    name: "Coastline",
    description: "An organic shoreline, beach, and coastal road.",
    width: 36, height: 24, seed: "", scale: 9, mode: "coast",
    rockRatio: 0.03, treeRatio: 0.06, buildingCount: 1,
  },
  {
    id: "wetlands",
    name: "Wetlands",
    description: "Shallow pools, muddy ground, and winding channels.",
    width: 36, height: 24, seed: "", scale: 8, mode: "wetlands",
    rockRatio: 0.005, treeRatio: 0.045, buildingCount: 0,
  },
  {
    id: "underground",
    name: "Underground",
    description: "Tight passages, rare chambers, rough ground, and underground pools.",
    width: 36, height: 24, seed: "", scale: 7, mode: "underground",
    rockRatio: 0, treeRatio: 0, buildingCount: 0,
  },
  {
    id: "volcanic",
    name: "Volcanic wastes",
    description: "Lava lakes and flows, ash fields, and broken ridges.",
    width: 36, height: 24, seed: "", scale: 7, mode: "volcanic",
    rockRatio: 0.07, treeRatio: 0, buildingCount: 0,
  },
  {
    id: "highlands",
    name: "Highlands",
    description: "Continuous ridges, a ravine, and a mountain pass.",
    width: 36, height: 24, seed: "", scale: 6, mode: "highlands",
    rockRatio: 0.06, treeRatio: 0.03, buildingCount: 1,
  },
];
