# VALE

An original lane-brawler (Rift 5v5, Bridge, Fray) for Forgeflow Games: Three.js/WebGL2 client,
TypeScript, Vite, Blender-authored art, catalog-driven content. The build contract is
[`_spec/CONTRACT.md`](_spec/CONTRACT.md); the machine-readable half is `src/contracts/`.

> Skeleton written by the TOOLS lane. LEAD: fill in the game overview, controls and credits.

## Install

Node 22 or newer (it runs `.ts` tools and probes directly via type stripping), then:

```sh
npm install
```

Art and audio sources are built by their own lanes (`art/`, `audio/`, Blender 5.2 / Python) and their
outputs (`art/out/`, `audio/out/`) are committed, so a fresh clone does not need Blender to run the game.
To rebuild art with a local Blender install, point `BLENDER` at its executable and run
`python art/build.py <target>` (CONTRACT §12; without `BLENDER` it falls back to the `bpy` module).

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
`node tools/names_check.ts "Some Name"`.

## Run in development

```sh
npm run content                 # once, and after content changes
npm run dev                     # http://localhost:5190 (strict port)
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
```

A probe is a standalone `node _harness/probe_<name>.ts`: exit 0 = PASS, 77 = SKIP (with a reason),
anything else = FAIL. Probes that need content use synthetic fixtures under `_harness/fixtures/`
(placeholder `fx_*` ids), never `content/`.

## Layout and ownership

See CONTRACT §1 (layout) and §14 (which lane owns which files).
