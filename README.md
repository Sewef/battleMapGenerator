# Touch Grass

Prototype outdoor battlemap generator. Each reproducible map uses two layers:

- terrain: ground, void, water, difficult ground, rocks, cliffs, or ravines;
- obstacles: trees and buildings.

Tactical rules live in the data model. Water and difficult terrain slow
movement; rocks and cliffs block movement and line of sight; ravines block
movement without blocking sight.

## Run locally

```bash
npm install
npm run dev
```

Generation always covers the full grid: void remains available in the model but
is never generated automatically. The engine first builds a Delaunay/Voronoi
geographic mesh with `d3-delaunay`, then rasterizes it onto the tactical grid.
Each map type has its own pipeline:

- open countryside: pond and road;
- river valley: river, banks, road, and bridge;
- coastline: sea, beach, and coastal road;
- wetlands: shallow pools, channels, muddy ground, and no generated roads;
- underground: tight connected passages, rare chambers, rough ground, a
  guaranteed entrance, an optional exit, and occasional pools;
- volcanic wastes: lava lakes and rivers, ash fields, broken ridges, and rocks;
- highlands: ridge, ravine, and mountain pass.

A separate second pass populates trees, rocks, and buildings without changing
the primary terrain morphology.

## Production

```bash
npm run build
```

The static site is generated in `dist/`.

Cloudflare Workers serves that directory and proxies the Owlbear image upload
endpoint through the same origin:

```bash
npm run deploy:check
npm run deploy
```
