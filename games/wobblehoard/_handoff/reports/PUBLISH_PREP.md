# PUBLISH_PREP: running report (2026-10-10). PREPARATION ONLY: nothing deployed, uploaded or written remotely

Kept: no git write, no deploy, no network write, no secret printed, one browser (port 5610). `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` exit 0.

| # | Item | State |
|---|---|---|
| 1 | `README.md` (11.8 KB) | DONE |
| 2 | `public/game_meta.json` | DONE |
| 3 | `public/thumbnail.png` (+ `public/credits.txt`, checklist #11) | DONE |
| 4 | deploy_game.py dry-run report | DONE (raw output: `PUBLISH_PREP_dryrun.txt`) |
| 5 | remaining steps and owners | DONE (below) |

## 1. README
Studio style (Dyefield / Blocktooth): what it is, run table (only real `package.json` scripts), how to play, keys, accessibility and privacy, tech, layout, gates, credits with the full three.js MIT notice. Facts come from `screenCopy.ts`, `keyboard.ts`, `rarity.ts`, `merge.ts`, `achievements.json`, `cut.ts`. Run today: tsc, vite build, `probe_screens` 43/43, `probe_portal` 81/81, `probe_trophies` 31/31. NOT run: `npm run dev` (port 5360 is outside my range), the full `npm run probe` and the browser harnesses (long; known red rows per STATUS). No trading, no pets mentioned.

## 2. game_meta.json
Same field names as the examples; empty `controls_gamepad` dropped, `controls_touch` kept (not a DB column, the pipeline ignores it), no `status`. short_description 123 chars (checklist: <= 155, ends on a sentence). description covers soft-body play, Shift lock, capsules, 50 squishies in 6 rarities, Hoard, merge, daily gift and tasks, 20 achievements, Cut (Clean cut / Minis / Reconnect all), Snap, Table / Float, synthesised sound, Calm effects, privacy. Keys line: 1, 2/C, 3/S, H, [ ], G, M, F, P, ?, arrows, + / -, Shift drag, Shift lock, Esc. 13 tags, `mobile_support: full`.
CAVEAT: the sentence "when you play signed in ... your achievements are saved to your account" is true only after the owner-approved seeding. Do not flip the publish toggle before it.

## 3. thumbnail.png and credits.txt
- `thumbnail.png`: real PNG (signature and IHDR checked), 1280x720, 8-bit RGB, 471,562 B, md5 7bd22890. Built from two real captures of the production title card (strict CSP, 0 violations, 0 console problems) at 2x: scene only, and lockup only; composed and downscaled by `_handoff/tools/thumbnail/cap_layers.mjs` + `compose.py` (scene 78 css px lower, lockup x0.9, grain softened in sky and felt only, to get under 600 KB). No UI chrome, no hand-drawn pixels.
- Art-director read, 3 rounds: the plain capture had the squishy tip touching the K and a dead bottom third. The layered version clears the lettering, reads at 320 px wide and survives a 2.4:1 object-cover crop (lettering y 94 to 190, squishy to about y 610 of 720). Owner call still open: this capture versus the xAI cover standard (checklist 5).
- Build with all three public files: `[G0] build output 1934 KB of the 3072 KB budget`, `[G0b] first-play download 435 KB gzip of the 600 KB budget`; dist md5 equals public md5 for thumbnail, game_meta and credits.
- `credits.txt` = three.js r186 MIT notice verbatim plus Vite (MIT) and TypeScript (Apache-2.0) lines (the in-game Credits screen already shows the notice).

## 4. deploy_game.py dry run
Read in full first: the worktree copy `squish-keeper-build/pipeline/deploy_game.py` (962 lines; `package.json` reaches it via `../../pipeline`). `--dry-run` returns inside `deploy_one` BEFORE the cover step (no xAI), R2 upload, cache purge, Supabase and portal refresh; it only reads the manifest and local files (manifest mtime unchanged after my run). Flags: `--game-dir`, `--slug` (required), `--metadata`, `--dry-run`, `--no-portal`, `--force` (re-push all), `--status {draft,unpublished,published}`, `--seed-manifest` (writes the LOCAL manifest and exits). I ran it with dummy CF env values so no real credential was loaded or printed.
Result on the throwaway dist, exit 0: `Files: 18`; hashed build (entry `./assets/index-C8coRjKe.js`); 17 files would upload in this order: `credits.txt`, `thumbnail.png`, 13 files in `assets/` (catalog, engine, index js + css, later-photo, later-screens, later-trophies js + css, rarity, stage, ui), then `index.html` [critical], then `game_meta.json` [critical] LAST. 1 unchanged vs manifest (`rng-DTRKR-_l.js`), 0 dev-only withheld. `--game-dir games/wobblehoard` is REFUSED (source-folder guard, shown in the run).
A REAL run would: load the CF token and account id (env, `.secrets`, `api_config.json`); upload each file with `npx wrangler r2 object put forgeflow-games/squish-keeper/<path> --remote`; purge the CDN cache (worktree copy finds no purge token, so it skips; HTML and JS are no-store anyway); PATCH the existing games row (id 55: text, tags, genre, mobile_support, thumbnail_url `?v=7bd22890`, build_version; `status` is NOT sent, it stays `unpublished`); then run `deploy_portal.py` unless `--no-portal`.
**Master vs worktree** (`forgeflow-games/pipeline/deploy_game.py`, 970 lines; diff ignoring CRLF). Master has: the entry-ref critical gate (a failed upload of any script index.html loads blocks index.html: the gate a hashed Vite build needs), the truncated-entry guard, the screenshots gallery (`screenshots/` to `screenshot_urls`), and `.secrets` (purge token). The worktree has: the source-folder guard, the Supabase-write warning, `verify_live(game_dir=)`. **USE the worktree copy** for this unpublished deploy (it is what `deploy:dry` runs and what worked on 2026-10-07; the missing gate cannot hurt a game nobody can play if every live file is md5-checked after). **MERGE** the two (engineer task) before any redeploy of a published game or store screenshots. **TRAP:** `npm run deploy` has no `--no-portal`, so it would also rebuild and push the live portal from the main checkout's dirty tree (`deploy_portal.py` hard-codes that ROOT; its worktree copy has 300 s timeouts against 900 s). Use the explicit commands below, and add `--no-portal` to both package scripts.

## 5. Remaining steps (O = owner yes needed)
1. Engineer: write `pipeline/seed_squish_keeper_achievements.py` from `forgeflow-games/pipeline/seed_dyefield_achievements.py` (NOT written yet): input `src/data/achievements.json`, slug `squish-keeper`, game id 55, 20 rows, points bronze 5 / silver 15 / gold 30 / diamond 60 (355 XP), secret = hidden, default dry run (a dry run is a service-key READ plus a local backup).
2. Engineers: close the STATUS fix list (harness result, LOCK-B, CUT-D, UI minors), then the gates: `npm run check`, `npm run probe:browser`, `node _harness/portal/portal_check.mjs` and `photo_check.mjs` (portal frame, Snap save), the strict-CSP boot check.
3. Engineer: merge deploy_game.py; optionally add `public/screenshots/` (needs the master features).
4. O, decisions: thumbnail (this one or xAI), the 20 achievements and tiers, no score and no cloud save.
5. O, seed: `python pipeline/seed_squish_keeper_achievements.py` (dry), then `--apply`; check by public GET: 20 rows, tiers 8 / 7 / 3 / 2.
6. O, deploy (files only): `cd games/wobblehoard && node node_modules/vite/bin/vite.js build`; then from `squish-keeper-build`: `python pipeline/deploy_game.py --game-dir games/wobblehoard/dist --slug squish-keeper --dry-run --no-portal`, review, repeat without `--dry-run`. Never `--force`, `--seed-manifest`, `--status`. Then GET all 17 files at `https://forgeflow-games-cdn.isimcha85.workers.dev/squish-keeper/`, compare md5 with `dist/`, boot the live URL.
7. O, publish toggle (portal admin `admin-game-publish`, `unpublished` to `published`).
8. O, portal prerender: check `git status` of `forgeflow-games` (it builds the dirty tree), then `python "C:/Users/TestRun/Claude Claw/forgeflow-games/pipeline/deploy_portal.py"`. Direct links already work through the SPA fallback; this gives `/games/squish-keeper` real static HTML.
9. The owner plays signed in once; read `user_achievements` and `profiles.xp` to confirm.
