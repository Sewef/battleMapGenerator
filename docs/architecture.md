# Architecture

Touch Grass is split into a deterministic generation core, a browser renderer,
export adapters, and a thin application shell. New code should be added to the
smallest layer that owns the behavior instead of extending the entry point or a
general-purpose module.

## Dependency direction

```text
domain
  ↑
generation    rendering
  ↑              ↑
  └──── exports ─┘
          ↑
       UI / main
```

- `domain/` defines map data and rules. It must not depend on browser APIs.
- `generation/` transforms options and seeded randomness into domain data. It
  must remain deterministic and usable without a DOM.
- `rendering/` turns domain data into pixels. It may use Canvas APIs, but must
  not make generation decisions.
- `export/` adapts maps and rendered images to external formats and services.
- `ui/` owns markup and browser controls.
- `main.ts` wires these layers together. Domain, editing, rendering, or export
  algorithms should not be implemented there.

The Worker is a separate deployment boundary. It serves the client and owns
uploaded-map persistence; it must not import browser code.

Biome-specific asset choices belong in `rendering/biome-assets.ts`. Canvas,
previews, and exporters must consume that registry instead of branching on
biome names or constructing tileset paths independently. Asset loading and
browser image materialization remain in `rendering/tileset-assets.ts`.

## Generation modules

- `generate.ts`: biome orchestration and generation retries.
- `region-map.ts`: Voronoi region graph construction, selection, traversal,
  and rasterized paths.
- `terrain-shaping.ts`: local morphology and optional biome landmarks.
- `pipeline.ts`: shared generation passes, validation, and repairs.
- `obstacles.ts`: placement of buildings, vegetation, rocks, and related
  distance fields.
- `special-biomes.ts`, `city.ts`, `interior.ts`, `ship-deck.ts`: specialized
  generators whose rules do not belong in the shared pipeline.

## Change rules

1. All random choices receive a `Random` function or derive one from a named
   seed suffix. Do not call `Math.random()` in generation code.
2. A change to an existing random-call sequence can change every later choice.
   Treat deterministic output as a compatibility surface.
3. Add reusable grid or graph algorithms to a focused module, not to
   `generate.ts`.
4. Keep rendering decisions out of `Tile` unless they describe durable map
   semantics needed by exports.
5. Run `npm run typecheck`, `npm run test:generation`, and `npm run build`
   after structural changes.

## Next extraction targets

The remaining large files should be reduced incrementally, with tests kept
green after every move:

1. Move terrain and prop editing commands out of `main.ts` into an editor
   model with explicit undo state.
2. Split `rendering/canvas.ts` by render pass: terrain masks, architecture,
   props, materials, and overlays.
3. Split Owlbear scene construction from serialization and browser download
   concerns.
4. Replace biome condition chains with a typed registry only after each biome
   has a narrow generation context and regression coverage.
