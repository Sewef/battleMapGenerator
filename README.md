# Touch Grass

Deterministic outdoor battlemap generator built with TypeScript, Canvas and Vite.
Maps are generated entirely in the browser from a biome, a seed and tactical
terrain parameters.

## Features

- 18 biome presets with reproducible terrain generation;
- procedural and pixel-art tileset renderers;
- optional grid and stylized lighting;
- WebP exports with or without tree and rock props;
- Owlbear Rodeo JSON exports with an uploaded WebP background and editable props.

## Local development

Install dependencies and run the browser-only Vite application:

```bash
npm install
npm run dev
```

To test the complete application, including the Owlbear image upload endpoint,
build the static assets and start the Worker locally:

```bash
npm run build
npx wrangler dev
```

## Validation

```bash
npm run typecheck
npm run test:generation
npm run deploy:check
```

The generation test checks map invariants and deterministic output for every
biome preset.

## Cloudflare architecture

The Worker serves `dist/` and exposes `/api/map-images` for Owlbear exports.
The browser renders the exact map background as WebP and uploads it to R2. A
SQLite-backed Durable Object serializes writes, deduplicates identical images
and evicts the oldest objects before the shared map storage exceeds 5 GiB.

Uploaded backgrounds expire after 30 days. The daily cron removes expired
objects and reapplies the storage limit. Run the deployment with:

```bash
npm run deploy
```
