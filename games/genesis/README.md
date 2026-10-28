# GENESIS

A living-world god game on small planets, for [forgeflowgames.com](https://forgeflowgames.com). Breathe air onto a dead
world, pour seas, seed life and set a people down on the land. They live off it at their own pace: they gather, hunt
real animals, farm, build, learn, forget, quarrel and move on. They also notice you. Every town keeps its own faith,
fear, trust and loyalty toward its god, prays to you, and remembers what you did.

- **The Touch**: the god's presence on the land, shown as light and weather. It is warm light where the people trust
  you and storm-dark where they fear you. It lifts, sets down, hurls, soothes and rebukes.
- **Sigils**: original one-stroke glyphs that cast miracles. Hold G (or the middle button) and draw one. You can also
  say what you want in words (Enter).
- **Prophets and signs**: make a person your prophet, foretell what you will do, then make it true. Send signs (an
  eclipse, a comet, a rainbow), which a trusting town reads as favour and a fearful one as anger. Hallow springs,
  groves and peaks. Each town holds its own real sacred animal.
- **Wrath**: a slider for how hard your harm falls. It is survivable by default, so disasters build fear, trust and
  loyalty rather than end the story.
- **Time**: 1x is slow and real (one game minute per second). The speed steps go 1x, 2x, 3x, 5x, 10x … 3000x
  (`SPEED_PRESETS`), and 1000x and up is a time-lapse.

The game has no creature, real animals only, and no fantasy kinds. `_spec/LIVING.md` §0 records the owner's decisions,
`_spec/CONTRACT.md` is the build contract, and `_spec/STATUS.md` says what is built.

## Run, build, test

Node 22 runs the TypeScript directly, so there is no compile step for tests or tools.

```sh
npm install
npm run dev            # vite dev server (pick a port: npx vite --port 5193 --strictPort)
npm run build          # production build into dist/ (static, relative base: works under any path)
npm run check          # determinism ban + tsc + every node --test suite (the gate)
node --test tests/ui-meta.test.ts      # one suite
```

- **Screenshots**: `node _harness/shots.mjs <spec.json> --port=<port>` (Playwright and SwiftShader; see the header of
  `_harness/shots.mjs` for the spec format).
- **CDN smoke check**: run `npm run build`, then `node _harness/cdn.mjs`. It serves `dist/` through the real
  games-cdn worker and checks hashed-asset caching, COEP, the sim worker and that the world ticks.
- **Controls text**: `node _harness/gen-controls.ts` rewrites `CONTROLS.md` and the controls lines of
  `public/game_meta.json` from the keybind registry. `tests/ui-meta.test.ts` fails when either goes stale.

URL parameters: `?scenario=barren|twoworlds|twoworlds-late|system|sandbox`, `?seed=<n>`, `?mod=<address of a JSON
pack>`, `?quality=low|medium|high|ultra|cinematic`.

## Publishing

The site reads `public/game_meta.json` (title, descriptions, controls, genre) and `public/thumbnail.png` (the cover,
1280x720). Vite copies both into `dist/`. Deployment follows the repository's `DEPLOY.md`. `public/game_controls.js`
is the ForgeFlow site bar (fullscreen, mute, pause). Its pause stops time and shows the game menu, and pressing it
again restores the speed. `index.html` sets `GAME_CONFIG` for the bar.

Inside the site's sandboxed frame, downloads may be blocked (photos, save exports, chronicle exports). The game says so
and offers each file in a new tab. When embedded, it pauses while the page is hidden, and it has a compact layout below
600 px tall (the site frame is 888x500).

## Layout

```
src/sim/       the deterministic simulation (runs in a Web Worker); src/sim/types.ts is the client/sim interface
src/data/      the base content pack (JSON): species, recipes, powers, disasters, planets
src/client/    the sim client, world view and interpolation
src/render/    the three.js WebGL2 renderer (planets, sky, water, life, effects, post)
src/ui/        the interface: title, HUD, palette, radial, sigils, inspector, The god, saves, settings, help (F1)
src/audio/     procedural sound and the authored score (src/audio/score, rendered to src/audio/assets)
mods/          example content packs
tests/         node --test suites
_harness/      screenshots, determinism ban, CDN check, controls generator
_spec/         the contract, the living-world spec, status
```

Saves are versioned binary snapshots of the whole universe (`src/sim/core/serialize.ts`). The same seed and the same
acts make the same world.

## Credits and licences

GENESIS is a ForgeFlow game. The worlds, peoples, animals, light and sound are made in code as you play. The music was
composed for GENESIS and rendered from its own scores. Third-party works shipped inside it are three.js (MIT), the
Cormorant Garamond and Inter fonts (SIL OFL 1.1, via Fontsource), Vite's module-preload helper (MIT) and the
webgl-noise simplex GLSL (MIT, Ashima Arts and Stefan Gustavson). The game's **Credits & licences** window (on the
title screen and in the game menu) shows each notice and its full licence text.

Controls: see [CONTROLS.md](CONTROLS.md), or press F1 in the game.
