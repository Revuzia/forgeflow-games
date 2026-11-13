# neon-veil

Short project rules for Grok (keep this lean).

## What this is
- Neon sky dogfighter (bundled Three.js) + **Grid Rush** (hover-kart circuit: drift, original items, AI rivals).

## Stack
- Dogfight: `index.html` + `assets/index-*.js` (Vite bundle; sources in `src-restored/` from sourcemap).
- Grid Rush: `race.html` + `race/race.js` (ES module, Three via importmap CDN).
- Serve folder over HTTP (not `file://`). Example: `npx --yes serve -p 5179 .` then open `/` or `/race.html`.

## Conventions
- Prefer smallest correct change; don't drive-by refactor.
- After edits: cheapest verify (`node --check` on race.js, `node _verify_race.mjs`, open preview / smoke).

## Do not
- Invent paths or claim files exist without checking.
- Deploy / push / spend without explicit ask.
- Touch secrets or production credentials.
- Clone Mario Kart items (bananas/shells/stars) or dogfight ship meshes for Grid Rush.

## Done means
- Paths changed listed; how to verify locally.
