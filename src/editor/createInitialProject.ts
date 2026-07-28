import type { EditorProject } from "./types";

export function createInitialProject(): EditorProject {
  const terrainCells: EditorProject["levels"][number]["layers"][number]["cells"] = {};

  for (let x = 0; x < 28; x += 1) {
    terrainCells[`${x},14`] = { tileId: 1, color: "#6fbf73" };
    terrainCells[`${x},15`] = { tileId: 2, color: "#3f7f5f" };
  }

  for (let x = 7; x < 13; x += 1) {
    terrainCells[`${x},10`] = { tileId: 3, color: "#d6a04d" };
  }

  for (let x = 17; x < 23; x += 1) {
    terrainCells[`${x},7`] = { tileId: 4, color: "#6c9df0" };
  }

  return {
    id: "project-local-prototype",
    name: "Synchronous Platformer Editor",
    tileSize: 32,
    textures: [],
    sprites: [],
    tiles: [
      { id: 1, name: "Grass", color: "#6fbf73" },
      { id: 2, name: "Soil", color: "#3f7f5f" },
      { id: 3, name: "Wood", color: "#d6a04d" },
      { id: 4, name: "Ice", color: "#6c9df0" },
      { id: 5, name: "Hazard", color: "#f06c7a" },
      { id: 6, name: "Pickup", color: "#f2d05e" },
    ],
    levels: [
      {
        id: "level-1",
        name: "Level 1",
        width: 40,
        height: 20,
        layers: [
          {
            id: "terrain",
            name: "Terrain",
            kind: "tile",
            visible: true,
            opacity: 1,
            color: "#4cc2ff",
            cells: terrainCells,
          },
          {
            id: "entities",
            name: "Entities",
            kind: "tile",
            visible: true,
            opacity: 0.8,
            color: "#ff7ab6",
            cells: {
              "3,13": { tileId: 100, color: "#f06c7a" },
              "25,13": { tileId: 101, color: "#f2d05e" },
            },
          },
        ],
      },
    ],
  };
}
