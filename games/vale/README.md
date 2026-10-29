# VALE

An original lane-brawler (Rift 5v5, Bridge, Fray) for Forgeflow Games: Three.js/WebGL2 client,
TypeScript, Vite, Blender-authored art, catalog-driven content. The build contract is
[`_spec/CONTRACT.md`](_spec/CONTRACT.md); the machine-readable half is `src/contracts/`.

## The game

VALE is set on one great carved sundial whose needle fell. Its shadow stayed and the light stopped:
the west rim lives in a morning that never ends, the east rim in an evening that never reaches night.
Two peoples fight over the stopped hours. **Aubade** (west, screen-left) build chalk spires with cool
dawnglass; **Serenade** (east, screen-right) build ironstone domes with warm lampresin.

Three modes share one roster of 16 fighters in six classes (Plinth, Breaker, Striker, Slinger, Caster,
Tender). **RIFT** is five against five on Hourfall: three roads, the Dialwood jungle, and Needles and
Lanterns to break before you silence the enemy Hourbell (about 25 minutes; Quick, Draft, Ranked and
Co-op queues). **BRIDGE** is five against five on one road over a gorge, with fighters dealt by lot
and traded through a shared bench (about 17 minutes). **FRAY** is ten fighters with no teams and four
lives each: first to 12 kills or the last one standing, then everyone is placed on the Hour Board
(about 10 minutes). Bots fill every empty seat; there is also a practice mode and a custom lobby.

Skins change how a fighter looks, never how they play, and are bought with Candles earned by playing.
What VALE is, the research behind it, the stack and why, the style bible and every name it chose not
to use are in [`_design/DESIGN_NOTE.md`](_design/DESIGN_NOTE.md).

## Controls

Defaults (`DEFAULT_BINDS` in `src/session/settings.ts`); every key can be rebound in Settings → Controls.

| Input | Action |
|---|---|
| Right-click | Move; right-click an enemy to attack it; hold to keep steering |
| Q · W · E · R | Abilities: aim, then left-click or press the key again (quick cast is a setting); right-click cancels |
| Ctrl + Q · W · E · R | Level the ability up |
| D · F | Hour spells |
| 1–6 | Item actives |
| A, then left-click | Attack-move |
| S | Stop |
| B | Recall to base (RIFT only; BRIDGE and FRAY have no recall) |
| P | Shop |
| Tab (hold) | Scoreboard |
| G | Ping: hold for the ping wheel, tap for "Look here"; Alt + left-click also pings (team modes) |
| Y | Lock or unlock the camera |
| Space (hold) | Centre the camera on your fighter |
| Left Alt + ability | Self-cast |
| Mouse wheel · middle-drag | Zoom · pan the camera |
| Esc | Cancel aiming, close the shop, or open the menu (Resume, Settings, Leave match) |

## Install

Node 22 or newer (it runs `.ts` tools and probes directly via type stripping), then:

```sh
npm install
```

Art and audio sources are built by their own lanes (`art/`, `audio/`, Blender 5.2 / Python) and their
outputs (`art/out/`, `audio/out/`) are committed, so a fresh clone does not need Blender to run the game.
To rebuild art, run `python3 art/build.py <target>`: it uses `$BLENDER` when set, else a standard
install (`/Applications/Blender.app`, the Windows default, or `blender` on `PATH`), else the `bpy`
module (CONTRACT §12, `art/README.md`).

## Online play

`npm run server` starts the game server (Node 22, WebSocket, port 8787; `--port`, `--host`, `--wait <s>` for
how long a search waits before bots fill, `--catalog <catalog.json>`). It must serve the same catalog
version as the clients. Point clients at it with `server` in `public/config.js` (or `?server=ws://host:8787`
for a one-off). Matchmade queues then play online: the server matchmakes, runs the ready check and the draft,
and runs each match as deterministic lockstep (every client steps the same sim on the server's ticks; bots
fill empty seats; a dropped player reconnects into their seat). Practice and custom games stay local, and
without a reachable server every queue plays against bots. Hosting the server is a separate deploy (any Node
22 host with WebSockets behind TLS: `wss://`). Proof: `node _harness/probe_online.ts`,
`node _harness/e2e_online.mjs`.

## Two builds that ship separately (CONTRACT §3.1)

| build | command | output | contains |
|---|---|---|---|
| client | `npm run build` | `dist/` | code, fonts, `public/` — **no content** |
| content | `npm run content` | `dist-catalog/` | `manifest.json`, `schema-<n>/<version>/catalog.json`, content-addressed `assets/` |

Content changes ship without a client rebuild, and a client keeps working when content moves on:
the manifest lists one catalog per schema it still serves, and each client picks the highest schema
it can read (`CLIENT_SCHEMAS` in `src/boot/catalog.ts`, down-converters in `tools/schema_migrations.ts`).

## Build content

```sh
npm run content                 # content/ → dist-catalog/ (validates everything, then writes)
npm run content:check           # validate only, write nothing
node tools/build_content.ts --help
```

Content lives in `content/` (one JSON per record family, `fighters/<id>.json`, `skins/<fighter>.json`,
`maps/<id>.json`, `version.json`). Asset refs `assets/...` resolve against `content/`, then `art/out/`,
then `audio/out/` (`assets/audio/x.ogg` → `audio/out/x.ogg`); see the header of
`tools/build_content.ts`. Every failure names the file and JSON path. Bump `content/version.json`
for every published content change. Check a name against the originality deny-list with
`node tools/names_check.ts "Some Name"`; rejected names are logged in `_design/NAMES_NOT_USED.md`.

While fighter, skin and monster art is still being made, the build fails on the missing asset files.
Add `--allow-missing-assets` (`npm run content -- --allow-missing-assets`) to report them as
warnings and leave those refs as they are.

## Run in development

```sh
npm run content                 # once, and after content changes (add -- --allow-missing-assets, see above)
npm run dev                     # http://localhost:5190 (strict port; ?dev=1 for debug tools)
```

The dev server serves `/catalog/*` from `dist-catalog/` (override with `VALE_CATALOG_DIR=<dir>`),
so the client loads `./catalog/manifest.json` exactly as in production. `VALE_FROZEN=1` disables HMR
and file watching for harness runs.

## Build and preview the client

```sh
npm run build                   # → dist/
npm run preview                 # http://localhost:5191, also serves /catalog/* from dist-catalog/
```

## Package for deploy

```sh
npm run build && npm run content && npm run package     # → deploy/ (= dist/ + dist-catalog/ as deploy/catalog/)
```

`deploy/` is what the R2 uploader ships. `tools/package_deploy.ts` refuses to assemble it if
`index.html` is missing, source maps slipped in, or a catalog does not match its manifest hash.

## Where the catalog URL comes from (CONTRACT §3.5)

1. `?catalog=<url>` on the page URL (QA override), else
2. `window.VALE_CONFIG.catalog` from `config.js` (edit it on the deployed site — no rebuild), else
3. `./catalog/manifest.json`.

Moving content to another CDN = upload `dist-catalog/` there and point `config.js` at its
`manifest.json` (the host must send CORS headers). Give `manifest.json` a short cache TTL; every
other catalog file is immutable.

## Checks and probes

```sh
npm run typecheck               # tsc --noEmit
npm run probe                   # every _harness/probe_*.ts, sequentially
node _harness/run_probes.ts --only content --verbose
npm run check                   # typecheck + content:check + probes
node _harness/e2e.mjs all       # the full journey in real Chrome (needs npm run dev)
node _harness/perf_1080.mjs     # frame times at 1920×1080 per quality preset (needs npm run dev)
```

A probe is a standalone `node _harness/probe_<name>.ts`: exit 0 = PASS, 77 = SKIP (with a reason),
anything else = FAIL. Engine probes use synthetic fixtures under `_harness/fixtures/` (placeholder
`fx_*` ids); the content probes (`probe_items`, `probe_kits_A`, `probe_kits_B`, `probe_maps`,
`probe_content_ids`) also read the real `content/` records. Until the remaining art lands,
`npm run content:check` (and so `npm run check`) fails on missing asset files; run
`node tools/build_content.ts --check --allow-missing-assets` instead.

## Layout and ownership

See CONTRACT §1 (layout) and §14 (which lane owns which files).

## Credits

An original game by Forgeflow Games.

Built with these open-source libraries (`package.json`): three.js (MIT), postprocessing (Zlib),
N8AO (ISC), Preact and @preact/signals (MIT), Vite (MIT), TypeScript (Apache-2.0), zod (MIT),
glTF Transform (MIT), meshoptimizer (MIT) and playwright-core (Apache-2.0). Fonts: Gloock,
Instrument Sans, Atkinson Hyperlegible Next and Atkinson Hyperlegible Mono (SIL Open Font License
1.1, packaged by Fontsource).

All art, VFX, music and sound effects were made for VALE: 3D models, landmarks and skies in Blender;
painted 2D images (icons, key art, backdrops, terrain textures) generated with Grok Imagine (xAI) from
VALE's own prompts; effects authored in code; music and sound effects synthesized with numpy.
