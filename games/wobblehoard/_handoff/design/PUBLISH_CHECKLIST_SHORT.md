# Squish Keeper: publication checklist for forgeflowgames.com, short form (2026-10-08)

Read-only. Nothing deployed, no portal / R2 / Supabase write, no secret copied (public-key GETs only). Evidence: `...\scratchpad\ui\publish\` (`portalframe.mjs`, `out\*.png`, `mc.mjs`). The live portal source is the MAIN checkout `...\Claude Claw\forgeflow-games` (master); `squish-keeper-build/src/lib` is an older copy.

## 1. What a game needs, and the state for Squish Keeper
| # | Need | State | Evidence |
|---|---|---|---|
| 1 | Build output `dist/`, never the source folder | DONE | `deploy_game.py` refuses `games/wobblehoard`; G0 1229 KB |
| 2 | Hashed assets, no inline script or style | DONE | 0 CSP violations booting in the portal frame |
| 3 | `public/game_meta.json` | EXISTS, STALE | says "merging and trading ... coming updates"; keys line lacks H / T / C / [ ]; no Cut or Snap; short_description 256 chars (portal clips it to 151, mid-sentence) |
| 4 | `public/thumbnail.png` 1280x720 PNG | MISSING in repo | `public/` has only game_meta.json; worktree `dist/thumbnail.png` is a JPEG named .png. The live one (538 KB PNG, md5 46e95eac, title-card capture) exists only in `%TEMP%\cdnb`. `vite build` empties `dist`; no thumbnail = `deploy_game.py` calls xAI (~$0.02) |
| 5 | Registry row | DONE | id 55, `unpublished`, build_version 20261008T040414Z, mobile_support full |
| 6 | CDN files | DONE (old build 2683d349) | index, thumbnail, game_meta all 200; no bridge, old UI |
| 7 | Achievement rows | MISSING | 0 rows for game 55 (Blocktooth 54, Dyefield 29); service-key write needs the owner's yes. Diamond is accepted live (6 rows exist) |
| 8 | Bridge client and detectors | MISSING | no `forgeflow` / `postMessage` / `window.parent` in `src` |
| 9 | `window.__PAUSE__ = {pause, resume, toggle}` | MISSING | `typeof` is undefined in the frame |
| 10 | Fullscreen / mute / pause entry | MISSING | the portal has no fullscreen button, every game ships one. Blocktooth's `game_controls.js` injects a `<style>` and an inline script, so it breaks our strict CSP: build our own (`fullscreenEnabled` is true in the frame) |
| 11 | README (repo only, `.md` never uploads) and credits | MISSING | no README; three.js MIT notice absent from the minified bundle: ship `public/credits.txt` and an in-game Credits line |
| 12 | Local portal stand-in test | MISSING | copy Blocktooth's `_harness/portal/bridge_host.html` (an unpublished game shows "Game Not Found" on the live portal) |
| 13 | Publish toggle, then `deploy_portal.py` | OWNER | `/games/squish-keeper` serves the generic homepage today |

Script caution: master `deploy_game.py` lacks the Vite source-folder guard, the worktree copy lacks master's truncated-entry guard: use the worktree copy (as on 2026-10-07) or merge. `deploy_portal.py` builds the main checkout's dirty tree, which IS the live site.

## 2. Bridge protocol (master `gameBridge.ts`, Blocktooth `net/portal.ts`, Dyefield `stats/portal.ts`)
All via `window.parent.postMessage(msg, '*')`; the portal accepts only its own embedded iframe and replies to the sender's origin.
| Direction | Shape | Rules |
|---|---|---|
| game > portal | `{type:'forgeflow:whoami', _reqId}` | answered for guests too |
| portal > game | `{type:'forgeflow:identity', _reqId?, signedIn, id, username, avatar_url, level}` | also pushed on sign-in / out. Never display username or avatar (email-derived) |
| game > portal | `{type:'forgeflow:achievement', achievementSlug}` | RPC `unlock_achievement(game_id, slug)`: idempotent, XP = table points x Badge-of-the-Day. No reply. Guests dropped. Unknown slug dropped, so SEED FIRST |
| game > portal | `{type:'forgeflow:score', score:int}` (also `game_over`, `level_complete`) | RPC `submit_score`, keep-highest per season. Squish Keeper sends none unless the owner asks |
| game > portal | `{type:'forgeflow:save', slot:1, data}` | merge-preserving-keys; `__replace:true` wipes; signed-in only |
| both | `{type:'forgeflow:load', slot, _reqId}` > `{type:'forgeflow:save_loaded', data or null, _reqId}` | signed-in only; a guest gets no reply |
Game side (copy Blocktooth's machine): states `standalone / waiting / silent / guest / signedIn`; 3 whoami tries 4 s apart; check `ev.source === window.parent` and the origin allowlist (forgeflowgames.com, www, forgeflow-games.pages.dev, localhost); one post per slug per page; on the first signed-in identity post every locally unlocked slug, at least 1 s apart (Dyefield 3 s). Standalone and guest send only whoami. No cloud save at launch (Practice shelf is device-only, COLLECTION C-6); local flags in a new key `wobblehoard:v1:ach`.
Placement: new `src/portal/` (SHELL), NOT in `src/collection` (probe I04 bans postMessage there). Detectors pure in `src/core/achievements.ts` over one `src/data/achievements.json` (the seeder reads the same file) with a node probe. Results are client-authoritative (platform-wide caveat).

## 3. Proposed 20 achievements (355 XP: 8 bronze 40, 7 silver 105, 3 gold 90, 2 diamond 120)
H = hidden ("???" until earned). Capsule-only timing from `mc.mjs` (4000 players; ECON median 3.5 min per capsule): rare p50 6 capsules, epic 15, legendary 36 (p90 118), mythic 139 (p90 440), 10 species 12, 25 species 59, 40 species 232, all 50 about 1180 (merges and restock shorten it).
| Slug | Name | Tier | Description | Trigger (existing event) |
|---|---|---|---|---|
| first_squish | Hello, Squishy | B | Squeeze it for a moment. | `release` heldFor >= 0.4 (`feedback.ts:131`) |
| first_stretch | Stretchy Hello | B | Pull it and let go. | `snap` intensity >= 0.35 (`feedback.ts:166`) |
| first_capsule | Something Inside | B | Open your first capsule. | `openCapsule` ok (`collection/index.ts:263`) |
| first_task | Little Job | B | Finish a task. | `completeTask` ok (`index.ts:277`) |
| first_cut | Clean Cut | B | Cut a squishy in two. | shell `cut` event `'cut'` (`game.ts:659`) |
| whole_again | Whole Again | B | Put the pieces back together. | `cut` event `'joined'`, pieces back to 1 |
| species_10 | Small Shelf | B | Own 10 different squishies. | `stacks()` copies>0 count >= 10 |
| rare_find | Something Shiny | B | Find a Rare squishy. | OpenOk tier_idx >= 2 |
| full_stretch | As Far As It Goes | S | Stretch one all the way. | `snap` intensity >= 0.95 (`STRETCH_FULL_INTENSITY`) |
| lift_toss (H) | Up and Away | S | Pick one up and toss it. | `carried` rising edge, then snap while lifted (`feedback.ts:196`, `:186`); works on touch |
| medley | Squeeze and Stretch | S | Squeeze, then stretch, within twelve seconds. | meter `detail.medley > 0` (`collection/ghost.ts:74`) |
| four_pieces | Four Little Ones | S | Have it in four pieces at once. | `g.cut.pieces >= 4` (4 is the low-quality limit) |
| first_merge | Two Become One | S | Merge two squishies. | `merge` ok (`index.ts:290`) |
| epic_find | Rare Delight | S | Find an Epic squishy. | OpenOk tier_idx >= 3 |
| species_25 | Growing Shelf | S | Own 25 different squishies. | `stacks()` count >= 25 |
| tier_up | A Step Up | G | A merge lifts a squishy to a higher rarity. | MergeOk `tier_up` |
| legendary_find | Legendary Day | G | Find a Legendary squishy. | OpenOk tier_idx >= 4 |
| species_40 | Nearly There | G | Own 40 different squishies. | `stacks()` count >= 40 |
| mythic_find (H) | Once in a Rainbow | D | Find a Mythic squishy. | OpenOk or MergeOk tier_idx 5 |
| all_fifty | The Whole Hoard | D | Own all 50 squishies. | `stacks()` count 50 (Practice cap is 100) |
Reserve: Say Hi (bump), Say Cheese (Snap), Mini Me (Minis, not built). Taps pay nothing, so no poke goal. No streaks, timers or loss wording. Seed cap: 60 rows per game.

## 4. In-game screens to match Blocktooth / Dyefield
Achievements screen (Blocktooth GOALS & RECORDS, Dyefield CAREER): "n / 20 earned" plus XP total; tier filter; rows with glyph, name, condition, progress bar x / y where countable, earned stamp with date; hidden = "???"; tier colours bronze #cd7f32, silver #c0c0c0, gold #ffd700, diamond #b9f2ff; locked rows dimmed; account line (textContent only, no username): guest "Playing as a guest. Sign in on forgeflowgames.com to keep your achievements", signed in "Saved to your ForgeFlow account", standalone "Saved on this device". Arrows move, Esc back, touch scroll, 44 px targets.
Toast (Dyefield S8.2): top-centre, `role=status aria-live=polite`, tier chip and name, "+N XP" only when signed in, 3.2 s each, queued (more than 3 collapse to "+N more"), fade only under Calm, never over a ceremony.
Pause / menu (Esc when nothing else is open; today Esc only closes panels, `hudBinding.ts:383`): Resume, Settings, Achievements, How to play (incl. Shift, Cut, Snap), Credits (three.js MIT, Vite, TypeScript, "all sound synthesised"), Fullscreen, Sound, account line; `window.__PAUSE__` drives it. No Retry or Quit (there is no run).

## 5. Thumbnail and README
Thumbnail: real 1280x720 PNG in `public/thumbnail.png` (Blocktooth, Dyefield: xAI key art, 1.4 to 1.6 MB). The card is `object-cover` in a short box: subject centred, no text near the bottom. OWNER CALL: title-card capture (recapture after the new title) versus the standing xAI-cover standard (`generate_cover.py`, ~$0.02, generate in scratch, look, re-encode to PNG). Never let `deploy_game.py` generate it.
README (repo only, mirrors Dyefield): run, controls, screens, gates, credits. game_meta.json: short_description <= 155 chars ending on a sentence; description current (Hoard of 50, capsules, merge, Cut, Snap, achievements); keys incl. H, T, C, [ ], Shift; no `status`; no trade claims.

## 6. Sandbox, iframe, CSP, save rules (measured with the portal's exact strings)
Iframe: `sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-popups allow-modals allow-forms"`, `allow="autoplay; fullscreen; gamepad; pointer-lock"`, always a 16:9 box (about 888x500 desktop, 358x201 phone: `out/phone_portal_frame_358x201_play.png` shows hint, name tag and buttons crowding a tiny squishy; design for a 568x320-class box).
- MAJOR: no `allow-downloads`, so Snap "Save photo" silently does nothing in the portal (0 download events; 1 with allow-downloads). Fix in the game (overlay image for long-press / right-click save, or `window.open`; popups are allowed).
- localStorage works but is per CDN origin; never rename `wobblehoard:v1:*` / `v2:*` keys. Vibrate and fullscreen work. Only console line: the portal's own "Unrecognized feature: 'pointer-lock'".
- CSP: the CDN worker sends none (COEP credentialless, ACAO *); `frame-ancestors` cannot come from a meta tag. Ours is "no inline code", tested with the strict header locally. Boot in frame: 4.2 s desktop, 7.6 s phone (SwiftShader), 0 errors. Cache: HTML and JS no-store, other assets 1 day.

## 7. Steps to the owner's yes
1. Owner decisions: thumbnail source; the 20 achievements and tiers (and "no score, no cloud save").
2. After the UI overhaul and fix rounds (`src/ui`, `src/shell` are in flux): build `src/portal/`, `core/achievements.ts` + json + probe, toast, Achievements and Pause screens, `__PAUSE__`, fullscreen button, Snap save fix, 358x201 layout pass.
3. Copy `bridge_host.html` to `_harness/portal/`; checks: no post before identity, once per slug, catch-up paced, guest and silent parent send nothing, no username shown, pause contract; run `portalframe.mjs` at 888x500 and 358x201.
4. Rewrite game_meta.json; add `public/thumbnail.png`, `public/credits.txt`, README; write `pipeline/seed_squish_keeper_achievements.py` from Dyefield's (default dry run, additive, backup first).
5. Gates: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` (clean today), `npm run check`, shell and render harnesses, build under 1229 KB, strict-CSP bootcheck.
6. Dry runs, no writes: `node node_modules/vite/bin/vite.js build`, `ls dist/thumbnail.png dist/game_meta.json`, then `python pipeline/deploy_game.py --game-dir games/wobblehoard/dist --slug squish-keeper --dry-run --no-portal` (prints upload order, index then game_meta last; manifest `state/r2_manifest_squish-keeper.json`), and the seeder without `--apply`. Never `--force`, `--seed-manifest` or `--status`.
7. OWNER YES 1: seed achievements (service-key write); verify by public GET: 20 rows, tiers 8/7/3/2.
8. OWNER YES 2: deploy with `--no-portal` (status stays unpublished); verify live 200s and md5 of every file; boot the live URL.
9. OWNER YES 3: publish toggle, then `pipeline/deploy_portal.py`. The owner plays signed in once; read `user_achievements` and `profiles.xp` to confirm.
