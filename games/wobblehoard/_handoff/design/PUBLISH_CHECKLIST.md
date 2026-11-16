# Squish Keeper on forgeflowgames.com: publication readiness checklist

Lens: PUBLICATION READINESS. Written 2026-10-08 (late morning CDT) by a read-only design agent. Nothing was deployed, no write call was made to R2,
Supabase or the portal, and no secret was read, printed or copied into this file. Game tree, `_harness`, `src`, `public` were not edited.

Evidence tags used everywhere below:
- **[R]** read this session (file:line). **[M]** measured this session by a script of mine (path in section 10). **[S]** taken from the status ledger or a report
  (not re-measured). **[I]** inferred, with the reasoning given. **[Q]** a read-only public HTTP request made this session.
- State words: **DONE**, **PARTIAL**, **MISSING**, **UNKNOWN** (with what would settle it).

---

## 0. Verdict in ten lines

1. Squish Keeper is **not ready for the owner's yes**. The game files and registry row exist (CDN live, row id 55, status `unpublished`), but the three things that
   make a game a full forgeflowgames.com citizen are all MISSING: achievements (0 rows seeded, 0 lines of bridge code), a pause/menu with fullscreen, and a real cover.
2. **Bridge:** the game has no `postMessage` code at all [R: grep of `src/` finds none; M: 0 `forgeflow:*` messages from the live build inside a portal-like frame].
3. **Achievements:** 0 rows for game 55 in the live registry [Q]. Diamond tier is accepted live now (6 diamond rows exist, all Blocktooth) [Q], so the 2026-10-01 worry about the tier CHECK is closed.
4. **Cover:** the live `thumbnail.png` (538,539 B) is a capture of the title card, which contradicts the owner's standing rule that every cover is xAI key art, not a gameplay frame
   [R: memory `feedback_ffg_covers_xai`, 2026-09-24]. The file is also **not in the repo** (never committed, `public/` holds only `game_meta.json`).
5. **G0 conflict:** a cover placed in `public/` is counted by the 1229 KB gate. The 2026-10-07 build was 1139 KB without the cover; with the 538 KB cover it is 1665 KB, **436 KB over** [R/M, arithmetic in 6.3].
6. **Snap "Save photo" is broken inside the portal.** The portal's sandbox has no `allow-downloads`; measured: the same blob download gives 0 download events with the portal's exact sandbox and 1 with `allow-downloads` added [M].
7. **Phones get a 358x201 play area** in the portal (16:9 frame, no portal fullscreen button since 2026-07-10), and the game has no fullscreen button [R/M]. In the old build the HUD covers the squishy at that size [M screenshot].
8. **Deploy tooling is split across two checkouts**: the branch's `deploy_game.py` has the Vite source-folder guard but lacks master's "hashed entry JS is critical" and "truncated index.html" guards [R: diff]. `npm run deploy` has no `--no-portal` and no cover guard [R: package.json:23].
9. The cut tool has one open physics MAJOR (A-F3, pieces thrown out of frame on kneadle, thudge, prismelo) in both latest verifier verdicts [S: VERIFY_SHELL4_A_R1.md:9-12, VERIFY_SHELL4_B_R1.md:5-7]; the cut achievements and the Cut tool itself depend on it.
10. Everything else on the path is plain work (section 9): about 22 achievements, a bridge client of roughly 250 lines, a Trophies screen, a Menu screen, README, credits file, xAI cover, game_meta refresh, a portal stand-in harness, seed script. Three gated writes need the owner's yes: the cover spend (about $0.02), the achievement seed (production DB), the deploy.

---

## 1. What a game needs to be on forgeflowgames.com, and where Squish Keeper stands

| # | Requirement | State | Evidence |
|---|---|---|---|
| P01 | The deployed thing is a production build, never the source folder. `deploy_game.py` refuses a root `index.html` that loads `.ts`. | **DONE** | [R] `pipeline/deploy_game.py:261-307`. [M] run of `source_folder_refusal(games/wobblehoard)` printed "REFUSED: games/wobblehoard/index.html loads ./src/main.ts, so this is a source folder (Vite), not a build." |
| P02 | `dist/` is fresh. | **MISSING (rebuild needed)** | The tree's `dist/` is from 2026-10-05 (assets `index-TNrvdrZC.js`, `stage-DZjrV2aZ.js`) while the R2 manifest records the 2026-10-07 deploy (`index-Ddn6-mxj.js`, `stage-CCrs4Bkm.js`) [R: `state/r2_manifest_squish-keeper.json`]. Its `thumbnail.png` is a 167,602 B **JPEG named .png** (`file` says JFIF 1280x720). Never deploy this `dist/`; `vite build` empties it (`vite.config.ts:211`). |
| P03 | Relative asset base so it runs from `/<slug>/`. | **DONE** | [R] `vite.config.ts:190` `base: './'`; [M] the deployed build booted from `http://localhost:5392/index.html` in the frame. |
| P04 | No inline script or style (strict CSP ready). | **DONE** | [R] `index.html:10-17`; [S] `browser_shell.mjs:3947-3972` ("production build under a strict CSP ... 0 CSP violations"). [M] my run: `csp: []` in both frames, boot OK. |
| P05 | `game_meta.json` at the dist root (Vite `public/`), no `status` field. | **DONE (content stale)** | [R] `public/game_meta.json` 3,905 B; live copy is the same 3,905 B and md5 `60685eba...` [M/Q: CDN 200, size 3905; manifest md5 equals the file]. Content problems: P24. |
| P06 | `thumbnail.png`, 1280x720 real PNG, owner-standard xAI key art. | **PARTIAL, wrong kind** | Live file exists (CDN 200, 538,539 B, 1280x720 PNG, md5 `46e95eac...`) [Q/M] but it is a title-card capture with UI text ("Wake it up", "Sound on for the full squish.") [M: viewed `%TEMP%\cdnb\...\dist\thumbnail.png`]. Source file is **not in the repo** (`git log --all -- games/wobblehoard/public/thumbnail.png` prints nothing) and not in the working tree. See section 6. |
| P07 | Slug `squish-keeper`. | **DONE** | [Q] CDN `/squish-keeper/index.html` 200; `/wobblehoard/index.html` 404. [R] `package.json:22-23` uses `--slug squish-keeper`. `_spec/CONTRACT.md:294` still says `--slug wobblehoard` (stale doc). |
| P08 | Registry row in `games`. | **DONE** | [Q, public read] id **55**, slug `squish-keeper`, **status `unpublished`**, build_version `20261008T040414Z`, genre `arcade`, mobile_support `full`, thumbnail_url `<cdn>/squish-keeper/thumbnail.png?v=46e95eac`, updated 2026-10-08T04:04:14Z. The 2026-10-07 deploy log says "Updated game" [R: `scratchpad/lc/deploy_real.log`], so the row pre-dates it. |
| P09 | Publish state is the owner's toggle, never the deploy's. | **DONE** | [R] `deploy_game.py:672-682` (new row `unpublished`, existing row keeps status), `:838-842` (file `status` is ignored). Only `--status` changes it. |
| P10 | Catalog category exists for the genre. | **DONE** | `genre: "arcade"`; the portal categories include Arcade [R: Bible 7.15 "9 game categories"; `src/lib/categories.ts`]. |
| P11 | Mobile label honest (`mobile_support`). | **PARTIAL** | Declared `full` = "real touch controls, playable start to finish on a phone" [R: `src/lib/mobile.ts:4-9`]. Controls are real; the 358x201 frame is the problem (P27). Re-decide `full` vs `partial` after the UI build. |
| P12 | Achievements seeded in `public.achievements` for game 55, **before** the build that posts them goes live. | **MISSING** | [Q] `squish-keeper achievement rows: 0`. Unknown slugs are dropped: `unlock_achievement` returns `{ok:false,error:'unknown_achievement'}` and the portal only `console.warn`s [R: `gameBridge.ts:402-406`, migration `0009_unlock_achievement_rpc.sql`]. |
| P13 | Game-side bridge: `whoami`, `achievement`, optional `save`/`load`. | **MISSING** | [R] no `forgeflow`/`postMessage`/`window.parent` in `src/` (the only hits are `_harness` probes and worker threads). [M] 0 forgeflow messages from the game in the stand-in host; `typeof window.ForgeFlow` undefined. |
| P14 | In-game Achievements screen, unlock toast, account line. | **MISSING** | [R] no such UI in `src/ui` or `src/shell`. |
| P15 | Pause / Menu screen, and `window.__PAUSE__ = {pause, resume, toggle}`. | **MISSING** | [M] `typeof window.__PAUSE__` = `undefined`. [R] `src/input/keyboard.ts:71` Escape only closes things; `hudBinding.ts:383` Esc returns tools to Hand. Blocktooth: `src/testsurface.ts:661`; Dyefield: `runtime/src/game.ts:505`. |
| P16 | In-game Fullscreen (the portal has no button). | **MISSING** | [R] no `requestFullscreen` anywhere in `src`; portal comment `GamePlayer.tsx:22-25` "Portal-level fullscreen button REMOVED ... every game's own ... bar is the single fullscreen entry point". [M] `document.fullscreenEnabled === true` in the portal-attribute frame, so it can work. |
| P17 | Sign-in-aware Snap (photo) that works in the sandbox. | **BROKEN in portal** | [M] downloads blocked (6.1). Code path: `src/shell/hudBinding.ts:259-261` (`<a download>` on a blob URL), `:300-304`. |
| P18 | Credits / third-party licence notice (three.js is MIT and is inlined). | **MISSING** | [M] deployed assets contain no `Copyright` or `@license` string. Blocktooth ships a README credits section [R: `README.md:578-585`]; Dyefield a CREDITS screen. |
| P19 | `README.md` in the game folder. | **MISSING** | [R] `games/wobblehoard/` has no README. Blocktooth 47,595 B, Dyefield 19,121 B. (Never uploaded: `.md` is dev-only, `deploy_game.py:96-99`.) |
| P20 | Quality gates green on the tree to be shipped. | **PARTIAL** | [M] `tsc --noEmit` printed nothing on the live (mid-edit) tree at 10:59:57. [S] last reports: shell harness 473/473, node_checks 124, probe_app 183, probe_gestures 128, probe_cut 17, bundle 1143 of 1229 KB (STATUS.md:19). Verifier verdicts for SHELL-4 R1 are FAIL on A-F3 (physics) and R1 minor [S]. UI overhaul, trophies, bridge: not built. |
| P21 | Deploy tooling consistent. | **PARTIAL** | 6.4. |
| P22 | CDN caching sensible for a 1.1 MB hashed build. | **PARTIAL** | [R] `workers/games-cdn/src/index.js:87-102` (master): `.js` is `no-store` unless the slug is in `IMMUTABLE_HASHED_GAMES` (`dyefield`, `rimfall`). Squish Keeper's 6 hashed assets are re-downloaded on every visit (about 1.16 MB). Opt-in is a worker deploy (owner's yes). |
| P23 | Portal detail page prerender (`/games/squish-keeper` static HTML). | **UNKNOWN until published** | `deploy_portal.py` always builds the MAIN checkout (`ROOT = Path("C:/Users/TestRun/Claude Claw/forgeflow-games")`, hard-coded near the top of the file) [R]; the live site equals that dirty tree [S: memory `reference_portal_xp_server_authoritative`]. [Q] `/games/squish-keeper` returns the generic homepage shell (same 131,376 B as `/games/blocktooth`, `/games/last-circle`), so this probe cannot tell published from unpublished. |
| P24 | `game_meta.json` text is true and complete. | **PARTIAL** | description line 4: "merging and trading are being built and arrive in coming updates" (merge is built; trade is not); no mention of the Hoard, tasks, restock, cut, photo, tools; `controls_keyboard` lacks H, T, C, [ ]. `short_description` is 256 chars and the portal clips SEO text to 155: result "...with every sound synthesised..." ends in an ellipsis mid-sentence [M: clip computed with the portal's own algorithm, `src/config/site.ts:36-45`]. `controls_touch` is read by nothing (grep of portal `src/` and `pages/`). `art_direction` asks for a wordmark although the cover template forbids text (6.2). |
| P25 | Product rules hold on the portal (no paywall, ads or currency; kind wording). | **PARTIAL** | In-game: yes [R: COMMON.md:30]. Portal ads: `ads-config.json` ships OFF, owner intends to turn them on [S: memory `project_ffg_portal_seo_ads`]; the page template has `<AdRails />` [R: `pages/games/@slug/+Page.tsx:133`]. Owner call (Q7). The game must never call `ForgeFlow.ads` or post `forgeflow:show_*`. |
| P26 | Save keys, persistence in the cross-site sandboxed frame. | **DONE** | [M] `wobblehoard:v2:hoard` and `wobblehoard:v1:profile` were written inside the cross-site, portal-sandboxed frame. |
| P27 | Layout works in the real portal frame sizes. | **PARTIAL** | Frames are 16:9: 888x500 at 1280+ px wide pages, 632x355 at 1024, 358x201 on a 390 phone (derivation in 6.1). [M] screenshots `desktop_portal_frame_888x500_play.png` (fine; tagline pill sits on the toy's head on the title) and `phone_portal_frame_358x201_play.png` (hint pill, name plate, three buttons and the meter all overlap the toy). Old build; the UI lane must re-test these sizes. |
| P28 | Cloud-save scope decided. | **MISSING (decision)** | COLLECTION.md:26, C-6: ghosts are "never sent anywhere", "Nothing a guest does can be claimed on sign-in except the player's own settings". See 2.5. |
| P29 | Live smoke after deploy, signed-in end to end. | **NOT DONE for any game** | [S: memory] "NOT done: a real signed-in end-to-end unlock (owner plays signed in, then read `profiles.xp` vs the sum of unlocked points)". |

---

## 2. The bridge protocol (live portal = master `forgeflow-games/src/lib/gameBridge.ts`)

The branch `claude/exciting-faraday-2dakqx` carries an OLDER copy of the portal (`squish-keeper-build/src/lib/gameBridge.ts`: client-side XP, numeric id path). **The live portal is the
main checkout on master** (462 lines). Everything below is from the master file. [M] the live homepage bundle contains the server-side call `submit_score` (chunk `chunk-D7fao41_.js`, 4 hits),
which was committed after the `unlock_achievement` change (git order: `b29b14b3` then `bd611fd1`), so the live bundle includes the server-side XP path. I could not locate the game-page chunk
to grep `unlock_achievement` itself: that last step is UNKNOWN; one end-to-end signed-in unlock settles it (step S17).

### 2.1 Messages

All are `window.parent.postMessage(msg, '*')` from the game; the portal accepts only messages whose `event.source` is an iframe in its own document (`gameBridge.ts:298-304`) and answers with
`postMessage(reply, <the game's origin>)`.

| Direction | Message | Portal does | Reply |
|---|---|---|---|
| game to portal | `{type:'forgeflow:whoami', _reqId:'<string>'}` | waits for the Play-time auth read, then builds identity (`:377-387`) | `{type:'forgeflow:identity', _reqId, signedIn:boolean, id:string\|null, username:string\|null, avatar_url:string\|null, level:number\|null}`. **Answered for guests** (`signedIn:false`, rest null). Also pushed unsolicited (no `_reqId`) when the player signs in or out after Play. |
| game to portal | `{type:'forgeflow:achievement', achievementSlug:'<slug>'}` | `rpc unlock_achievement(p_game_id, p_slug)` once signed in (`:319-328`, `:402-406`). Slug only: the numeric `achievementId` path was removed. | **None.** Guests: dropped. Unknown slug: RPC answers `{ok:false,error:'unknown_achievement'}`, portal logs a warning, game is never told. Already unlocked: `{ok:true,unlocked:false}`, no XP. |
| game to portal | `{type:'forgeflow:score', score:<finite number>}`, also `level_complete {score}` and `game_over {score}` | `rpc submit_score` (keep-highest per ISO week; season resets Monday 07:00 UTC; `0011`) | none. **Squish Keeper should send none** (no score exists; a leaderboard conflicts with "no pressure"). |
| game to portal | `{type:'forgeflow:save', slot:1, data:{...}}` (`data` must be truthy) | read-merge-write into `game_saves(user, game, slot)` via `mergePreservingKeys`: objects merge key by key, **scalars and arrays: incoming wins**, a missing key is kept; `{__replace:true}` wipes (`saveMerge.ts`, `:423-451`) | none; a failed read writes nothing |
| game to portal | `{type:'forgeflow:load', slot:1, _reqId}` | reads the row (`:353-375`) | `{type:'forgeflow:save_loaded', data:<json>\|null, _reqId}`. **Guests get no reply at all** (not even null). A signed-in account with no row gets `data:null`. |
| game to portal | `run_result`, `vs_result` | routed only for slug `blocktooth` (`GAME_STATS_RPC`); ignored for every other game | acks only for blocktooth |
| game to portal | `forgeflow:show_interstitial`, `show_rewarded` | portal answers `{type:'forgeflow:ad_result', status:'unfilled'}` | **do not use** |
| not available | `forgeflow:rpc` / `rpc_result` (COLLECTION.md section 8) | **does not exist in the live portal** (no such case in `handleGameMessage`) | The real/server ledger and trading cannot be wired to the live portal; the published build is practice-ledger only. |

Whole-system facts that matter for the game:
- Early messages are no longer dropped: handlers queue on `userReady` (`whenSignedIn`, `:279-287`). Dyefield's 3 s pacing and outbox (written before 2026-10-05) worked around the old drop and the old XP race [R: `games/dyefield/_spec/CONTRACT_STATS.md:36-47,287-295`]; with the atomic RPC (`0009`) pacing is only politeness. Keep a small gap anyway (2.4).
- XP comes only from achievements, points from the table row, never from the client; Badge of the Day multiplier applies (0 rows in `daily_badge`, no writer) [R: migration 0009; Blocktooth platform.md:502].
- The portal initialises its bridge when the player clicks the portal's own "Play" button, before the iframe exists (master `GamePlayer.tsx:137` `initGameBridge(game.slug, game.id)`), so the listener is ready when the game boots.
- The iframe URL is `<game_url>?v=<build_version>-<nonce>` (master `GamePlayer.tsx:210`); the game may read `v` (Blocktooth `buildVersionFromUrl`, `src/net/portal.ts:122-130`).
- Line numbers for `GamePlayer.tsx` in this file are the master copy's (the branch copy is about 33 lines shorter because it lacks the ads and Esc-lock code).

### 2.2 The two reference clients (copy the shape, not the ads)

| | Blocktooth `src/net/portal.ts` | Dyefield `runtime/src/stats/portal.ts` + `core.ts` |
|---|---|---|
| Sign-in test | `whoami`: 3 tries, 4,000 ms apart, then state `silent` for good (`:91-92`, `:249-261`) | `forgeflow:load` probes: timeout 6,000 ms, retries after 1.5 / 4 / 8 / 16 s (5 probes, about 60 s), then `guest`; a `null` reply must be confirmed 3,000 ms later (`portal.ts:16-20`) |
| States | `standalone, waiting, silent, guest, signedIn` (`:76`) | `standalone, probing, signed-in, guest` |
| Reply checks | `ev.source === window.parent` | `ev.source === window.parent` **and an origin allowlist**: `forgeflowgames.com`, `www.`, `forgeflow-games.pages.dev`, `*.forgeflow-games.pages.dev`, `localhost`/`127.0.0.1` for harnesses (`:40-47`) |
| Achievements | local record + post once per account per page; **catch-up** of everything already earned on the first signed-in identity (`:303-321`) | paced queue in a persisted outbox: one post, then `ACH_GAP_MS` 3,000 ms; one per slug per page session; reload resumes; 7-day self-heal re-posts every unlocked slug (`core.ts:13-17,270-300`) |
| Guest | sends nothing | local bucket; claimed on sign-in |
| Cloud save | write-lock: nothing saved before `save_loaded` has answered for this account; an empty account (null) counts as an answer; a timeout does not (`:20-24,405-428`) | `readOk` rule + thin pushes, repair push |
| Controls bar | Blocktooth (master) ships the shared `game_controls.js` v3.1 (`index.html:102-107`) | no bar: its own FULLSCREEN toggle on the title corner and pause card, hidden where element fullscreen is unavailable (`ui/menus.ts:1019-1021`) |

### 2.3 Recommended contract for Squish Keeper (all of it additive, none of it touches the sim)

1. Where the code lives: a pure evaluator in `src/collection/trophies.ts` (no DOM, no clock: the import probe I04 forbids `window`/`postMessage`/clocks inside `src/collection/**`
   [R: `_harness/probe_collection_imports.ts:99-115`]) and the bridge client in `src/shell/portal.ts`. **COLLECTION.md:71 plans `src/collection/bridge.ts` as "the only file that touches
   `window.parent`"; that location would fail probe I04.** Fix the doc, not the probe.
2. States and timing: copy Blocktooth's machine (`standalone / waiting / silent / guest / signedIn`), `whoami` 3 tries 4 s apart. Use `whoami` (answered for guests), not `load`, to learn the state.
3. Validate every reply: `ev.source === window.parent` AND the Dyefield origin allowlist (the portal replies to the game's own origin, so a stray window cannot spoof the portal only if the game checks both).
4. Identity use: read `signedIn` only. Never display or store `username`, `avatar_url` or `id`: `profiles.username` is often the local part of the player's email [R: COLLECTION.md:502, TRADE.md:514]. Account line wording in 4.3 shows no name.
5. Achievements are local first. An unlock writes the local record, shows the toast, and, if `signedIn`, posts `{type:'forgeflow:achievement', achievementSlug}`. A guest posts nothing.
   On the first `signedIn` identity of a page: **catch-up** (post every earned slug once). One post per slug per page; at most one in flight; a small gap (suggest 600 ms; Dyefield uses 3,000 ms); the queue persists in the local trophies record so a reload resumes; self-heal re-post of everything earned after each sign-in is cheap and idempotent server-side.
6. Cloud save (optional, recommended small): after `forgeflow:load` has answered (write lock), union-merge and push only `{v:1, game:'squish-keeper', earned:{<slug>:<epochMs>}, counters:{...maxima}}`.
   Never the Hoard (C-6). Use maps keyed by slug and local `max()` for counters because the portal's merge is "incoming wins" for scalars (a stale device could otherwise lower a counter). Never send `__replace`. Throttle pushes (at least 4 s apart; also on `pagehide` / `visibilitychange: hidden`).
7. Never load `https://forgeflowgames.com/forgeflow-sdk.js` (CSP `script-src 'self'`, zero outside assets, and it carries the ads API). Post raw messages like Blocktooth and Dyefield.
8. Standalone (`window.parent === window`) and `silent` portals: the client is inert; trophies still work locally.
9. A decision for the owner (Q4): guest-earned achievements credited on sign-in (Blocktooth style, harmless: XP only, nothing tradeable) or only achievements earned while signed in (strict reading of COLLECTION.md:26).

---

## 3. Proposed achievements (22 rows: 19 visible, 3 hidden; 365 XP)

### 3.1 Platform rules the rows must satisfy

- Row shape = the `achievements` table: `slug` (<= 64 chars; the unlock RPC allows 200), `name` (<= 80), `description` (<= 240), `tier` in `bronze|silver|gold|diamond`, `points`, `secret` (bool), `icon` null.
  Standard points 5 / 15 / 30 / 60 [R: `run_game_pipeline.py:5035`; portal page `pages/achievements/+Page.tsx:44-49`]. The live table also holds custom points (gold 60 and 100, silver 50, bronze 20 and 30) [Q], but the studio standard and the portal page labels assume the four tiers.
- **Diamond is accepted live.** [Q] tier counts across the table: bronze 52, silver 60, gold 50, **diamond 6** (all Blocktooth: `g_gate_over_the_limit`, `g_molo_three_course`, `g_vk_coast_to_coast`, `g_hb_continental_drift`, `g_bw_canopy_cover`, `g_vs_ensemble_cast`). So the `achievements_tier_check` drift documented 2026-10-01 [R: `blocktooth/_harness/portal/seed_achievements.py:278-281`] has been widened. Dyefield's seeder still restricts itself to bronze/silver/gold, so keep a `--hold-tier` fallback anyway.
- **A seeded row is immutable for the seeder**: the pattern is insert-only (`on_conflict=game_id,slug`, ignore-duplicates; a differing row is reported, never updated) [R: `forgeflow-games/pipeline/seed_dyefield_achievements.py` docstring steps 4-5]. Decide tier, points and secret flag before the first `--apply`.
- The `seed_game_achievements` RPC skips the whole call once a game already has 60 rows [R: Blocktooth seeder docstring and its `--apply` guard]; 22 is far under it. Blocktooth has 54 rows (14/18/16/6, 1180 XP), Dyefield 29 (14/12/3, 340 XP) [Q].
- Secret rows exist (2 live, other games) and the portal page shows "???" and "Secret achievement" until unlocked [R: `pages/achievements/+Page.tsx:79,82`]. The names are still readable through the public REST read; "hidden" is a presentation promise, not secrecy.
- **The portal's own Achievements page truncates to one line** (`truncate`, `text-xs`): about 32 characters of description on a phone and about 48 on desktop [I: estimated from card widths]. Lead every description with the action and keep it under 45 characters where possible. The full text lives in the in-game screen.
- Product rules: no gore, no currency, no pressure, no streaks, no timers [R: DESIGN.md:33,93,689]. No "daily" or "in a row" achievements. No luck-only wall: every rarity row is reachable through merges as well as capsules.

### 3.2 Calibration (how long each wall takes)

`_spec`'s economy: 30/50/75 then 100 SP per capsule, 8 capsules a day at full rate, the next 4 at 25 percent, hard stop 12 (`core/meter.ts:112-116`); regular-player median about 3.5 min per capsule [S: memory note, ECON sim 2026-10-06].
Capsules-only Monte Carlo (4,000 simulated players, `rollCapsule` with the public odds 76.3 / 13 / 6 / 2.8 / 1.4 / 0.5 %, no merges, no restock, no tasks), script `scratchpad/ui/publish/mc.mjs` [M]:

| Milestone | p25 | p50 | p90 | Time at 17 capsules per hour (p50) |
|---|---|---|---|---|
| a Rare or better | 3 | 6 | 21 | about 21 min |
| an Epic or better | 6 | 15 | 46 | about 53 min |
| a Legendary or better | 15 | 36 | 118 | about 2.1 h |
| a Mythic | 57 | 139 | 440 | about 8 h |
| 10 distinct species | 11 | 12 | 15 | about 42 min |
| 25 distinct species | 51 | 59 | 80 | about 3.4 h (5 days at the 12 a day stop) |
| 40 distinct species | 198 | 232 | 312 | about 13.5 h |
| all 50 | 901 | 1,180 | 2,125 | about 69 h (about 100 days at 12 a day) |
| all 14 Commons / all 11 Uncommons | 44 / 183 | 55 / 234 | 88 / 392 | |
| a whole lane: Rubber 6, Dough 7, Jelly 10 | 230 / 270 / 435 | 354 / 417 / 661 | 767 / 929 / 1,475 | |

Species per lane (read from the catalog): Jelly 10, Fill 10, Chew 9, Foam 8, Dough 7, Rubber 6 (50 total; tiers 14/11/10/7/5/3). Merge cost 2, 10 merges a day, 24 h output lock (`core/merge.ts`).

### 3.3 The 22 rows (paste-ready as `src/collection/achievements.json`, the single source for the game and the seeder, the Dyefield pattern)

Tier logic: bronze = a first of something, minutes; silver = discovery or about an hour; gold = several sessions; diamond = the long collection goals.

```json
{
  "_doc": "Squish Keeper achievements: the single source of truth for the game and the portal seeder. 22 rows, 365 XP: bronze 10 / silver 7 / gold 3 / diamond 2. Fields are exactly the achievements table's.",
  "achievements": [
    { "slug": "hello_squishy",   "name": "Hello, Squishy",   "description": "Poke your squishy.",                       "tier": "bronze",  "points": 5,  "secret": false },
    { "slug": "soft_hands",      "name": "Soft Hands",       "description": "Squeeze and hold for one second.",         "tier": "bronze",  "points": 5,  "secret": false },
    { "slug": "first_stretch",   "name": "First Stretch",    "description": "Pull outward, then let go.",               "tier": "bronze",  "points": 5,  "secret": false },
    { "slug": "capsule_day",     "name": "Capsule Day",      "description": "Open your first capsule.",                 "tier": "bronze",  "points": 5,  "secret": false },
    { "slug": "little_job",      "name": "Little Job",       "description": "Finish a daily task.",                     "tier": "bronze",  "points": 5,  "secret": false },
    { "slug": "one_becomes_two", "name": "One Becomes Two",  "description": "Cut a squishy in two.",                    "tier": "bronze",  "points": 5,  "secret": false },
    { "slug": "whole_again",     "name": "Whole Again",      "description": "Put the pieces back together.",            "tier": "bronze",  "points": 5,  "secret": false },
    { "slug": "say_cheese",      "name": "Say Cheese",       "description": "Save a photo of your squishy.",            "tier": "bronze",  "points": 5,  "secret": false },
    { "slug": "friendly_bump",   "name": "Friendly Bump",    "description": "Let two squishies bump into each other.",  "tier": "bronze",  "points": 5,  "secret": true  },
    { "slug": "pop_party",       "name": "Pop Party",        "description": "Shake loose a burst of bubbles.",          "tier": "bronze",  "points": 5,  "secret": true  },
    { "slug": "all_the_way",     "name": "All the Way",      "description": "Stretch a squishy as far as it will go.",  "tier": "silver",  "points": 15, "secret": false },
    { "slug": "two_hands",       "name": "Two Hands",        "description": "Pull both sides at once.",                 "tier": "silver",  "points": 15, "secret": false },
    { "slug": "something_shiny", "name": "Something Shiny",  "description": "Find a Rare squishy.",                     "tier": "silver",  "points": 15, "secret": false },
    { "slug": "ten_friends",     "name": "Ten Friends",      "description": "Meet ten different squishies.",            "tier": "silver",  "points": 15, "secret": false },
    { "slug": "two_become_one",  "name": "Two Become One",   "description": "Merge two squishies into one.",            "tier": "silver",  "points": 15, "secret": false },
    { "slug": "settled_in",      "name": "Settled In",       "description": "Spend an hour with your squishies.",       "tier": "silver",  "points": 15, "secret": false },
    { "slug": "up_and_away",     "name": "Up and Away",      "description": "Pick up a squishy and toss it.",           "tier": "silver",  "points": 15, "secret": true  },
    { "slug": "starburst",       "name": "Starburst",        "description": "Find an Epic squishy.",                    "tier": "gold",    "points": 30, "secret": false },
    { "slug": "half_the_shelf",  "name": "Half the Shelf",   "description": "Meet twenty-five different squishies.",    "tier": "gold",    "points": 30, "secret": false },
    { "slug": "step_up",         "name": "Step Up",          "description": "Merge your way up to a higher rarity.",    "tier": "gold",    "points": 30, "secret": false },
    { "slug": "prismatic",       "name": "Prismatic",        "description": "Find a Mythic squishy.",                   "tier": "diamond", "points": 60, "secret": false },
    { "slug": "whole_hoard",     "name": "The Whole Hoard",  "description": "Meet all fifty squishies.",                "tier": "diamond", "points": 60, "secret": false }
  ]
}
```
Counts: bronze 10 x 5 = 50, silver 7 x 15 = 105, gold 3 x 30 = 90, diamond 2 x 60 = 120, total 22 rows and 365 XP (about platform level 3; level 4 starts at 450 [R: migration 0009 level curve]). Hidden: 3 (`friendly_bump`, `pop_party`, `up_and_away`).
Lengths: longest name 16 chars, longest description 40 chars. Wording lint for a probe: reject `kill, die, dead, blood, gore, buy, pay, spend, coin, cash, streak, hurry, last chance, don't miss`.
The word "Gold" and "Diamond" are the portal's tier names (medal metaphor); the in-game UI should show them next to a shape and a number, never as currency.

### 3.4 Triggers: where each is detected in `src` today

"Derived" = recomputable from persisted state at load (self-heals after a lost post). "Event" = needs a hook at the moment it happens. **NEW** = no lifetime counter exists today.

| Slug | Trigger | Where it is detected | Persisted today? |
|---|---|---|---|
| `hello_squishy` | `Profile.stats.pokes >= 1` | `SoftEvent 'poke'` -> `src/shell/feedback.ts:121-122` `d.bump('pokes')`; counter in `src/core/save.ts:46,149` (`stats {pokes, squishes, pulls, releases}`, saved under `wobblehoard:v1:profile`) | yes, derived |
| `soft_hands` | a `release` SoftEvent with `heldFor >= 1.0` | `feedback.ts:131-135` (`case 'release'`); `heldFor` is `contracts.ts:51`. Meter maps `heldFor >= 0.4` to a squeeze (`collection/constants.ts:20`) | no (event; NEW flag) |
| `first_stretch` | `snap` with `intensity >= 0.35` (`SNAP_TASK_INTENSITY`) | `feedback.ts:166-170` (`case 'snap'`, not the Shift twin) | no (event) |
| `all_the_way` | `snap` with `intensity >= 0.95` (`STRETCH_FULL_INTENSITY`) | same site; the same constant already drives the daily task `ghost.ts:73` | no (event) |
| `two_hands` | the Shift twin grab, or both grab slots active | `feedback.ts:159-165` (`case 'grab'`, `twin`); `touch.grabActive[0] && [1]`. Reachable on touch only if a two-finger pull is a supported gesture (known to crease, STATUS.md:38). Card text: "Pull both sides at once" (hold Shift, or two fingers) | no (event) |
| `capsule_day` | first successful `openCapsule()` | `collection/index.ts:263`; lifetime count `HoardSave.ghostOpened` (`collection/types.ts:141`), `practice().opened` (`:345`) | yes, derived |
| `little_job` | first `completeTask` ok | `collection/index.ts:277-280` (emits `capsule` source `task`) | **NEW** lifetime flag (the task state resets by day and week, `core/drops.ts:155-163`) |
| `one_becomes_two` | cut result `cut` and `cut.pieces >= 2` | swipe path `game.ts:659` (`emit('cut', r)`); button path `hudBinding.ts:245` (`splitInTwo`) emits nothing; `cut.pieces` (`shell/cut.ts:130`) is already polled at `hudBinding.ts:321,335` | **NEW** |
| `whole_again` | `reconnectAll()` returned true and pieces are back to 1 | `hudBinding.ts:247`; `cut.ts:144`. The `'joined'` value exists in the `cut` event type (`game.ts:159`) but **nothing emits it** (grep: only the type line) | **NEW**; add the emit |
| `say_cheese` | the photo was delivered | Snap save `hudBinding.ts:259-261,300-304`; must be re-pointed at the fixed delivery path (6.1) | **NEW** |
| `friendly_bump` (hidden) | any `bump` SoftEvent | `feedback.ts:146-151` (`case 'bump'`, needs two bodies on the mat) | **NEW** |
| `pop_party` (hidden) | one release that fires the full 3-pop burst | `feedback.ts:139-142` (`pops(1 + min(2, floor(fx*2.999)), ...)`: 3 when `fx >= 0.667`) | **NEW** |
| `something_shiny` | any owned item with tier index >= 2 | `OpenOk.tier_idx` / `MergeOk.tier_idx` (`collection/types.ts:207-215,281-300`); or `stacks()` owned tier (`:150-165`) | yes, derived from the Hoard |
| `starburst` | tier index >= 3 | same | yes, derived |
| `prismatic` | tier index = 5 (3 Mythics: Skeinara, Constello, Prismelo) | same | yes, derived |
| `ten_friends` | `stacks()` with `copies > 0` >= 10 | `Collection.stacks()` (`types.ts:362`) | yes, derived |
| `half_the_shelf` | owned species >= 25 | same | yes, derived |
| `whole_hoard` | owned species = 50 (`TOTAL_SPECIES`, `core/rarity.ts:26`) | same | yes, derived |
| `two_become_one` | first `merge()` ok | `collection/index.ts:290` (`merge`), also `tidy` (`:300`); shell `collectionPort.ts:109-117` | **NEW** lifetime flag (`ghostMerges` is per day: `types.ts:139`) |
| `step_up` | a merge result with `tier_up === true` | `MergeOk.tier_up` (`types.ts:286`) | **NEW** |
| `settled_in` | 3,600 s of active play | sum `dt` in `game.onStep` (`game.ts:255`) while phase is `play` and not paused/hidden/covered | **NEW** counter |
| `up_and_away` (hidden) | the body was carried then thrown | `feedback.ts:186-189` (`lifted` and toss speed > 0.1); lift edge `feedback.ts:196-198` | **NEW** |

Needed additive pieces (all small): (a) an evaluator that takes SoftEvents plus collection results and returns newly earned slugs; (b) additive `CollectionEvent` members (`opened`, `merged`, `claimed`, `task`, `fav`) so the shell hears results without wrapping every call (`types.ts:336-342` has only `capsule`, `table-full`, `resting`, `done-today`, `storage`, `external`);
(c) a local record `wobblehoard:v1:trophies` = `{v:1, earned:{slug:epochMs}, counters:{cuts, joins, merges, tierUps, tasks, photos, playS, ...}, outbox:[slug...]}` (a new key, never rename `wobblehoard:*` keys); (d) emit `'joined'`.

### 3.5 Reserve list (append later; each is another insert-only seed run)

`squeeze_then_stretch` (silver; medley: `FeedOutcome` needs an additive `medley` flag, `ghost.ts:74,86`), `gift_picked` (bronze; restock, `index.ts:270`), `long_while` (gold; Legendary), `big_heart` (bronze; hearts, `index.ts:307`),
`ten_surprises` (silver; 10 capsules), `full_lane` (gold; one whole lane, p50 354 capsules for Rubber), `little_ones` (silver; 4 or more pieces: 4 is the low-quality maximum, `cut.ts:39`), `tidy_up` (bronze; tidy-up merge), and the pet/toy rows once `_spec/PETS.md` exists (it does not yet).

### 3.6 Dependencies that decide whether a row can ship

- Cut rows (`one_becomes_two`, `whole_again`): the Cut tool has an open physics MAJOR (A-F3) and is being rebuilt as TRUE CUT plus Minis (`_spec/CUT2.md`, `CUT_MINIS.md`). Wire these rows to the **cutter's own state** (pieces, reconnect), not to the chunk build, so they survive the rebuild.
- `say_cheese`: do not wire until the photo path works in the sandbox (6.1).
- `two_hands`: decide the touch story first (see table).

---

## 4. What the in-game screens must show to match the studio

The bar the owner named is Blocktooth and Dyefield. The relevant facts, from the built games:

| | Blocktooth (master) | Dyefield (master) | Squish Keeper today |
|---|---|---|---|
| Full-screen layers | 11 (`draft, lobby, pause, select, settings, slate, tabloid, title, vsend, goals, cine`) | 8 (`title, loadout, play, settings, howto, credits, career, pause`) | title card, HUD, Settings panel, Hoard (+ card, merge pad, last-copy modal), toy tray, Cut bar, Snap bar, reveal plate, error card. **No pause, no achievements, no how-to, no credits.** |
| Achievements | GOALS & RECORDS screen (`ui/goals.ts`), 46 rows + 8 VS, toast stack (`ui/toast.ts`) | CAREER panel section "N / 29 . X XP" + toast (`stats/ui/career_panel.ts`, `toast.ts`) | none |
| Pause | Resume, Settings, Retry, Quit (retry/quit confirm on second press), Loadout, keys line; Esc / P / `__PAUSE__` / tab hidden (`ui/menus.ts:194-404`) | pause card: resume, settings, fullscreen, how to play, quit | none (Esc only closes panels) |
| Title menu | Title, Select | PLAY, LOADOUT, SETTINGS, HOW TO PLAY, CREDITS (`ui/menus.ts:80`) | one button "Wake it up" |
| Portal account line | on the end screen: `GUEST . SIGN IN TO SAVE YOUR STATS` or `<NAME> . SIGNED IN` (`game.ts:1607-1624`) | in CAREER: 4 states (below) | none |
| Credits | README section | CREDITS screen, "MADE BY ForgeFlow Games - Forge Flow Labs" (`ui/menus.ts:774`) | none |
| Fullscreen | shared bar (F, Mute, Pause, Report a bug) | own toggle, hidden where unsupported | none |

### 4.1 Achievements screen (a full-screen modal, like Blocktooth's goals and Dyefield's career)

Name it **Achievements**, not Trophies: the portal calls them achievements, and the portal's "Trophies" are weekly leaderboard trophies (table `leaderboard_trophies`, no writer, an always-empty panel) [S: platform.md:502]. A trophy-cup icon on the toolbar is fine.

Must show, top to bottom:
1. Header: title, count "n / 22" and, when signed in, "x / 365 XP"; a close button; Escape closes; focus returns to where it was. `role="dialog"`, `aria-modal="true"`, labelled.
2. **Account line** (Dyefield's four states, wording kept kind, no name shown): signed in: "Saved to your ForgeFlow account." Guest in the portal: "Playing as a guest. Sign in on forgeflowgames.com to keep your achievements and earn XP." Standalone: "Saved on this device. Play on forgeflowgames.com and sign in to keep them on your account." Waiting: "Connecting to your account..." (Dyefield `CONTRACT_STATS.md` S8.1).
3. Filter chips: All, Bronze, Silver, Gold, Diamond (the portal page has the same five, `+Page.tsx:99-108`).
4. Rows (a list, one column below 700 px, two from 700 px): tier medal, name, description, progress bar with "x / y" for counter rows (species 10/25/50, minutes 60, capsules), "+15 XP", earned stamp "Earned 8 Oct 2026" or the locked state. Hidden rows show "???" and "Hidden achievement" until earned (the portal's wording is "???" / "Secret achievement").
5. Tier colours are the portal's: bronze `#cd7f32`, silver `#c0c0c0`, gold `#ffd700`, diamond `#b9f2ff` (`+Page.tsx:45-48`). Tier is never colour-only: give each tier a distinct shape and the word. **Do not reuse the six rarity gem shapes** (`core/rarity.ts:47-52`: circle, diamond, hexagon, star4, star6, prism8), or rarity and achievement tiers will read as the same thing.
6. Locked rows dimmed but readable (Dyefield dims; the portal uses opacity 0.6). Contrast 4.5:1 for text even when dimmed (UI.md:24).
7. Keyboard: arrows move between chips and rows, Tab order sane, 44 px targets, reflow at 320 px, `prefers-reduced-motion` and Calm effects replace motion with fades.

### 4.2 Unlock toast (match Dyefield's contract, with Blocktooth's modal rule)

- Top centre, `top: max(10px, env(safe-area-inset-top))`, width `min(420px, 92vw)`, height at most 64 px, `z-index` above the HUD and below menus, `pointer-events: none`, `role="status"` with `aria-live="polite"` (Dyefield S8.2).
- Content: tier chip, the word "Achievement", the name, and "+15 XP" **only when signed in**; otherwise "Saved on this device". Dyefield holds each toast 3.2 s and collapses more than 3 waiting into "+N more"; Blocktooth holds 4.5 s, starts toasts at least 3 s apart, shows at most 2, queues at most 8, exits in 260 ms (`ui/toast.ts:36-44`). Recommend 4 s hold, at most 1 on screen, collapse after 3.
- **Never over a ceremony or a modal**: hold the queue while a capsule or merge ceremony runs (`game.on('ceremony')`, `hudBinding.ts:193`) and while the Hoard, Settings or Menu is open; resume with at least 1.5 s left (Blocktooth rule, `toast.ts:25-30`). Under Calm effects: fade only, no motion, nothing flashes.
- One spoken line per unlock through the existing live region (`ui/announcer.ts`), never twice.

### 4.3 Pause / Menu screen (match Blocktooth's pause menu and Dyefield's pause card)

Opens on Escape when nothing else is open, on `P`, from a toolbar button, and through `window.__PAUSE__.toggle()`. While open: sim and audio suspended (`game.suspend('covered')`, `PauseReason` at `game.ts:71`).
Items (Squish Keeper has no run to lose, so no Retry or Quit): Resume, Hoard, Achievements, Settings, How to play, Credits, Fullscreen (hidden where `document.fullscreenEnabled` is false or on iPhone Safari, Dyefield `ui/menus.ts:1019`), Sound on/off.
Footer: account line (same four states), keys line (like Blocktooth's `STR.pause.keys`: `Space poke/squish, drag stretch, Shift two-sided, right-drag turn, H Hoard, T tools, C cut, [ ] switch, G gravity, M sound, Esc menu`), build line from the `?v=` query (`20261008T...`).
Also required for parity: **How to play** (3 short panels: touch, stretch, collect) and **Credits** (original game and procedural sound; three.js 0.186 MIT; Vite MIT; TypeScript Apache-2.0; no fonts, no samples; "ForgeFlow Games - Forge Flow Labs").
Title card: keep the single primary button; add a quiet row of secondary buttons (Achievements, Settings, How to play, Credits) and the fullscreen button, as Dyefield's title menu does.

---

## 5. Frame sizes the UI must be tested at (add to UI.md section 5)

UI.md lists 1280x800, 390x844, 320x568. The portal gives the game a **16:9 box**, not the window: `className="relative aspect-video w-full ..."` (`GamePlayer.tsx:199`), inside `max-w-7xl` with `px-4 sm:px-6` and `lg:grid-cols-[1fr_320px] gap-6`.

| Page width | Game frame | Derivation |
|---|---|---|
| 1280 and wider | **888 x 500** | 1280 - 48 - 320 - 24 = 888 |
| 1024 | 632 x 355 | 1024 - 48 - 320 - 24 |
| 768 | 720 x 405 | single column, 768 - 48 |
| 390 (phone portrait) | **358 x 201** | 390 - 32 |
| 844 (phone landscape) | 796 x 448, but the visible page height is about 390 minus browser bars, so the frame does not fit on screen | 844 - 48 (`sm:px-6` applies from 640 px); needs fullscreen |

Add 888x500, 632x355, 358x201 and a fullscreen 1280x720 / 844x390 to the UI kit and the browser harness. On iPhone, element fullscreen does not exist (Dyefield hides its button there and shows a tip, `CONTRACT_MOBILE` M4/M9): the player stays in the 358x201 box unless the portal adds a CSS "pseudo fullscreen" (a portal change; Q6).

---

## 6. Sandbox, iframe, CSP, save keys, tooling: what the portal imposes (measured where marked)

### 6.1 The iframe

- Attributes, byte for byte [R: `GamePlayer.tsx:212-213`, identical on master]: `sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-popups allow-modals allow-forms"` and `allow="autoplay; fullscreen; gamepad; pointer-lock"`. No `allow-downloads`, no `allow-top-navigation`, no `clipboard-write`, no `allow-popups-to-escape-sandbox`.
- The game is **cross-site**: `forgeflowgames.com` frames `forgeflow-games-cdn.isimcha85.workers.dev`. It cannot read the portal's session; the bridge is the only path (Blocktooth platform.md section 3.2).
- **Measured** (`scratchpad/ui/publish/portalframe.mjs`, Chromium 145 headless shell, host on `127.0.0.1:5391`, game on `localhost:5392`, strict CSP on the game, the CDN worker's COEP and CORS headers added) [M]:

| Probe | Portal sandbox | + `allow-downloads` | + `vibrate` in `allow` |
|---|---|---|---|
| `localStorage` set and read | works | works | works |
| `document.fullscreenEnabled` | true | true | true |
| `navigator.vibrate(30)` (after a real click) | returns true | true | true; Chromium prints "Unrecognized feature: 'vibrate'" so there is nothing to add; real phone behaviour **not measured** |
| blob `<a download>` after a real click | **0 download events (blocked)** | **1 download event** | 0 |
| deployed 2026-10-07 build boots, 0 CSP violations, 0 errors | yes (title ready in 4.2 s desktop frame, 7.6 s phone frame on a loaded machine) | | |
| `localStorage` keys the game wrote | `wobblehoard:v2:hoard`, `wobblehoard:v1:profile` | | |
| forgeflow messages sent by the game | 0 | | |
| `window.__PAUSE__`, `window.ForgeFlow` | undefined, undefined | | |

  The only console message in the frame was the **portal's own** `Unrecognized feature: 'pointer-lock'` from its `allow=` string.
- **Snap fix** (do not wait for a portal change): after the capture, show the image in an in-game overlay (`<img src=blob:...>` with "Press and hold, or right-click, to save"), and keep the anchor download as a bonus for standalone. The unmeasured alternative `window.open(blobUrl)` is permitted by `allow-popups`, but the popup inherits the sandbox. A one-token portal change (`allow-downloads`) also works but needs a portal deploy and the owner's yes. Re-point `say_cheese` to the new delivery.
- Esc: when the iframe is fullscreen the **portal** takes Keyboard Lock for Escape (master `GamePlayer.tsx`, "ESC KEYBOARD LOCK"), so an Esc tap reaches the game and only press-and-hold exits fullscreen (Chromium). A Menu on Esc works in fullscreen there.

### 6.2 What the CDN worker sends [R: `workers/games-cdn/src/index.js`, master]

`access-control-allow-origin: *`, `cross-origin-embedder-policy: credentialless`. **No CSP, no COOP, no Permissions-Policy.** Cache: HTML `no-store`; `.js` `no-store` unless the slug is in `IMMUTABLE_HASHED_GAMES` (`dyefield`, `rimfall` on master; `dyefield` only on the branch copy); everything else `public, max-age=86400`.
MIME is set for `html js css json png jpg jpeg gif svg webp mp3 ogg m4a webmanifest wav woff2 woff wasm glb gltf`; other types keep what R2 stored. Nothing about the game loads cross-origin, so COEP is irrelevant.
**The strict CSP in `index.html:10-17` is documented, not enforced, in production**: it says "the CDN or the portal sets it" and neither does. Neither Blocktooth nor Dyefield enforces one either. Optional hardening: a Vite `transformIndexHtml` step that adds the same policy as a `<meta http-equiv>` (without `frame-ancestors`) to the production `index.html`. The harness already proves the build runs under it. Owner call (Q9).

### 6.3 G0 versus the cover (arithmetic)

Deployed 2026-10-07 build [M, file sizes]: assets 1,160,489 B + `index.html` 2,337 + `game_meta.json` 3,905 = **1,166,731 B = 1,139 KB**; G0 = 1.2 x 1,048,576 = 1,258,291 B = 1,229 KB (`vite.config.ts:24`, `browser_shell.mjs:3940`, both count every file in `dist/`, `public/` files included).
With the live 538,539 B cover: 1,705,270 B = **1,665 KB, 436 KB over**. A studio-grade cover (Blocktooth 1,602,979 B, Dyefield 1,382,752 B) would make dist about 2.5 MB. `.gitignore:6` says "the only image that belongs in the folder is public/thumbnail.png", which cannot coexist with G0.
Options: (a) exclude `thumbnail.png` and `game_meta.json` from the G0 sum (a `vite.config.ts` plus `browser_shell.mjs` change, INTEGRATION lane; recommended: the gate is about game code), then keep the cover in `public/thumbnail.png` and commit it; (b) keep the 2026-10-07 method (copy the cover into `dist/` after the build; fragile, because forgetting it makes `deploy_one` spend on a generated cover, `deploy_game.py:852-872`); (c) raise G0 (owner decides; the UI work, trophies and PETS all want room: UI.md earmarks about 90 KB, the trophies feature adds my estimate of 25 to 40 KB, unmeasured).

### 6.4 Deploy tooling hazards (all [R])

- **Two versions of `deploy_game.py`.** Branch copy (`squish-keeper-build/pipeline/deploy_game.py`) has the Vite source-folder guard (`:261-307`) and the `metadata_ok` warning; master (`forgeflow-games/pipeline/deploy_game.py`) has `_entry_ref_paths` (a hashed build's entry JS is CRITICAL, so a failed upload withholds `index.html`) and `_entry_page_problem` (refuse a truncated `index.html`). Diff: 154 lines. In the branch copy `_is_critical(relative, hashed)` (`:323-335`) makes only `index.html` and `game_meta.json` critical for a hashed build, and my dry run printed exactly "2 critical". That is the Dyefield 1.5.0 incident class (an `index.html` pointing at an entry JS whose upload failed). **Merge the guards into one file before the real deploy** (step S14).
- `--dry-run` returns **before** the cover step (`:846-851`), so a missing `dist/thumbnail.png` passes the dry run and then spends on an xAI generation in the real run. Always `ls dist/thumbnail.png` first.
- `main()` calls `ensure_cf_env()` before `deploy_one`, so even `--dry-run` loads the R2 token into the process environment (it makes no network call and prints the account id's last 4 digits). My plan check called the pure functions instead and touched no credential.
- `npm run deploy` (`package.json:23`) = check, build, `deploy_game.py --game-dir dist --slug squish-keeper` with **no `--no-portal`**, so a real run also executes `refresh_portal_prerender()` (`:750-780`), which builds the **main checkout** and deploys it to Cloudflare Pages. Use explicit commands with `--no-portal` until the owner publishes.
- The R2 manifest (`state/r2_manifest_squish-keeper.json`) skips unchanged files by md5; hashed assets of old builds stay on R2 as orphans (harmless). `index.html` and `game_meta.json` are always re-pushed, and `game_meta.json` goes up last (`:199-206`).
- The Supabase PATCH stamps `build_version` and `updated_at`, sets `thumbnail_url` and `hero_image_url` to `<cdn>/squish-keeper/thumbnail.png?v=<md5 first 8>` only when the row's metadata has none (`:903-911`), and sends only these fields: title, description, short_description, genre, sub_genre, thumbnail_url, hero_image_url, game_url, controls_keyboard, controls_gamepad, difficulty, tags, mobile_support (`:629-643`).
- My plan check on the deployed build: "hashed build (entry ./assets/index-Ddn6-mxj.js)", 2 files would upload (`index.html`, `game_meta.json`), 7 unchanged vs manifest, 0 dev-only withheld, 2 critical [M].

### 6.5 Save keys and storage

- Keys in use [R]: `wobblehoard:v1:settings` (`core/settings.ts:13`), `wobblehoard:v1:profile` (+ `.unreadable`, + `.v<N>` pre-migration copies; `core/save.ts:31-36`), `wobblehoard:v2:hoard` (+ `.unreadable`; `collection/constants.ts:24-26`), `wobblehoard:v2:play` (`shell/playHistory.ts:10`). **Never rename** (COMMON.md:43-44). New: `wobblehoard:v1:trophies`.
- Every game shares **one origin** (the CDN worker host), so keys share one localStorage and one quota (about 5 MB per browser origin) with all other games [I]. Keep the `wobblehoard:` prefix, keep values small (the Hoard is capped at 100 ghosts, `GHOST_CAP`), always wrap access in try/catch (already so: `core/settings.ts:24-34`).
- Safari and iPhone may partition or expire script-writable storage in cross-site frames [I, not measured]. That is why the achievements record (small) should also go to the cloud save, and why the README must say the Practice shelf lives on the device.
- `forgeflow:save` slot 1; payload shape in 2.3 point 6; JSONB, no size cap found in the portal code (keep under about 10 KB [I]).

---

## 7. Cover (thumbnail) and README requirements

### 7.1 Cover

- Owner standard [R: memory `feedback_ffg_covers_xai`, 2026-09-24]: "i want a paid xai cover generation not a real gameplay frame. all games have xai cover generated." About $0.02 per generation, "one or two tries, not a batch", generate into scratch first, **look at it**, then place it. Note CLAUDE.md's gate says any spend above $0 goes to Telegram first: reconcile with one message to the owner (Q2) rather than assuming either.
- Command shape [R: `pipeline/generate_cover.py` docstring and `main()`]: `python pipeline/generate_cover.py --slug squish-keeper --title "Squish Keeper" --description "<1-2 sentences>" --art "<art direction>" --out <scratch dir>`. It writes `thumbnail.png` into `--out`, **raw xAI bytes (a JPEG under a .png name)**, so re-encode to a real PNG (no ImageMagick here: use a one-off Playwright page with a canvas `toBlob('image/png')`). The `--out games/<slug>` form overwrites the catalog cover (memory `reference_forgeflow_games_deploy`), so never point it at the game folder.
- The prompt template forbids text: "STRICT NO-NO: no text, no logos, no titles, no UI overlays, no watermarks" (`generate_cover.py:34-36`). **`public/game_meta.json` `art_direction` contradicts it** ("Cream (#fff1d6), heavy, rounded SQUISH KEEPER wordmark in plain system-style lettering") and the first generated cover (the JPEG still in the tree's `dist/`) did paint the title. Remove that sentence before generating. The current art direction also says "deliberately unlike pastel-kawaii" and fixes the palette (#14102a, #2a1744, #5b3a86, #2a2150, #ffb347, #59d6e6, #ff5a4d); keep those.
- Format: **1280 x 720 PNG** (Blocktooth and Dyefield are both exactly that; sizes 1,602,979 and 1,382,752 B). I found no size cap in the portal or the uploader; stay under about 1.7 MB.
- Composition for the portal's crops [R: `GameCard.tsx:42,63-67`, `GamePlayer.tsx:171`]: catalog cards show the image `object-cover` in a box 128, 160 or 224 px tall and flexible width (about 1.75:1 to 3:1), so the top and bottom of a 16:9 image are cropped by up to a third; put the subject (the squishy, perhaps with two or three rarity siblings) in the **middle 60 percent vertically**, keep the **top-left and bottom-right corners calm** (genre chip and mobile chip sit there), no text, no UI chrome, no button. The same image is the 16:9 pre-roll above "Play Squish Keeper" (`aspect-video`, max-w-lg), the Open Graph image and the JSON-LD image (`pages/games/@slug/+Page.tsx:51,104`).
- Judgement of the current live cover [M: viewed]: well lit and on brand, but it is the title screen: it has a clickable-looking "Wake it up" button, a tagline pill and a small line of text, and it will be wrong the day the new jelly title ships (UI.md decision 4). Replace it.
- The cache-bust is automatic: `thumbnail_url` gets `?v=<md5 first 8>` when the bytes change (`deploy_game.py:903-911`).

### 7.2 README (not uploaded; studio standard)

Sections to match Blocktooth (`README.md` headings: Run it, Controls, URL parameters, Screens, Project layout, Architecture, Test surface and harness, Gates, Credits and licences) and Dyefield (Run it, Stack decision, Play it, Rules, Build status by phase, Gates, Data and art, Credits):
1. Title and a one-paragraph pitch; screenshot paths under `_shots/` are not committed, so no images.
2. Run it: `npm install`, `npm run dev` (port 5360), `npm run preview` (5361), Node >= 22.18 (`package.json:7-9`).
3. Controls: mouse, touch, keyboard, no gamepad; the toolbar tools; the keys including H, T, C, [ ], G, M, Esc.
4. URL parameters (`?genome ?float ?quality ?dev ?mute ?lab`, `CONTRACT.md:250`).
5. Screens (title, HUD, toolbar, Hoard, merge pad, tasks and restock, Cut, Snap, Achievements, Menu, Settings, How to play, Credits).
6. Project layout and architecture: lanes and module map from `CONTRACT.md` section 2; stack rationale (custom XPBD soft body about 640 particles, WebAudio synthesis with zero files, Three.js 0.186).
7. Test surface and harness: `window.__WH__` (dev only), the commands of `CONTRACT.md` section 10, gate table G0 to G9 with the **last observed** results and dates.
8. **Portal integration**: bridge messages used, `achievements.json`, seeder command, save keys, the sandbox facts of section 6, the Snap rule, the fullscreen rule.
9. Deploy: exact commands from section 9 including `--dry-run`, `--no-portal`, the cover rule.
10. Credits and licences: original game, procedural sound, no samples, no fonts; three.js 0.186 MIT, Vite MIT, TypeScript Apache-2.0.
11. Known limitations stated plainly: the Practice shelf is saved on this device only; trading is not part of this build.
- Also ship `credits.txt` (or `LICENSES.txt`) at the dist root: `.txt` files are not dev-only, and a `credits`/`license`/`notice` stem is protected even as `.md` (`deploy_game.py:96-102`). The minified bundle carries no notice [M]; the MIT text must travel with three.js.

---

## 8. `game_meta.json` refresh (do after the UI build, so the text matches the shipped game)

- `short_description`: first 155 characters must be a complete sentence (Dyefield's clips cleanly at 85 chars of its first sentence; Blocktooth's also clips mid-sentence). Example: "A squishy toy that squishes back: poke, squeeze and stretch soft 3D squishies, collect fifty, and cut them into minis." (about 120 chars)
- `description`: remove "merging and trading are being built and arrive in coming updates"; describe what is true at publication (the toolbar tools, capsules and the Hoard of 50 species in six rarities, merging, daily restock and tasks, Cut with Clean cut and Minis if it ships, Snap photos, settings, achievements on forgeflowgames.com, "no ads, no purchases, no timers"). The portal renders line breaks and "- " bullets as text only (`GameDescription`).
- `controls_keyboard`: add H Hoard, T tools, C cut, [ ] switch squishy, Esc menu; remove "ESC close the settings panel". `controls_gamepad` stays empty. Delete `controls_touch` (read by nothing) or keep it for humans.
- `art_direction`: drop the wordmark sentence (7.1).
- `mobile_support`: keep `full` only after the 358x201 layout and the fullscreen button are verified; otherwise `partial`.
- `tags`: add `collectible`, `capsules` if the owner agrees; keep `no-combat`, `relaxing`, `cozy`.
- Never add `status`.

---

## 9. Step list from here to "ready for the owner's yes to deploy"

`G` = repo root `C:\Users\TestRun\Claude Claw\squish-keeper-build`, game folder `games/wobblehoard`. Gated steps are marked **[OWNER YES]**; everything else needs none. Use `node node_modules/typescript/bin/tsc ...` and `node node_modules/vite/bin/vite.js ...` directly (RESUME.md:30-33: `npx` can show a stale exit 0).

| Step | Work | Check (and expected result) |
|---|---|---|
| S0 | Preconditions in STATUS order: SHELL-4 fix round closed and re-verified; UI overhaul (UI.md v2) built and verified; CUT2 / Minis state decided; PETS decision known (it changes the description and the reserve list). | The verifier verdicts say PASS on the same tree hash that will be built. |
| S1 | Owner decisions Q1 to Q9 (section 10). | Written answers in STATUS.md. |
| S2 | `src/collection/achievements.json` (3.3), `src/collection/trophies.ts` (pure evaluator, no DOM or clock), additive `CollectionEvent` members, local record `wobblehoard:v1:trophies`, emit `'joined'`, play-time counter. | `node _harness/probe_trophies.ts` (new): every JSON row has exactly one detector and vice versa; rows pass the seeder rules (slug <= 64, name <= 80, description <= 240, tier/points table, <= 60 rows, wording lint); evaluator replay from a fixed event list is deterministic and idempotent; I04 import probe still passes (no `window` in `src/collection`). |
| S3 | `src/shell/portal.ts` bridge client (2.3) + origin allowlist + catch-up + paced queue + write-locked cloud save of `{earned, counters}`. | New browser harness `_harness/portalcheck.mjs` with a stand-in host (start from my `scratchpad/ui/publish/portalframe.mjs`): modes `signed`, `guest`, `silent`, `noload`; portal sandbox and allow strings; cross-site origins; asserts: boots with 0 console and CSP problems; guest sends only `whoami`; signed catch-up posts each earned slug exactly once and spaced; `silent` portal stops after 3 probes; `noload` never saves; a reply from a wrong origin or wrong source is ignored; unknown message types ignored; 0 `show_*` and 0 `score` messages. |
| S4 | Trophies screen, unlock toast, account line (section 4). | UI kit rows for every state; contrast, 44 px, 320 px reflow, keyboard walk, Calm, `prefers-contrast`, `forced-colors`; toast never overlaps a ceremony (browser check). |
| S5 | Menu / pause screen, `window.__PAUSE__`, Fullscreen button (hidden where unsupported), How to play, Credits. | `typeof window.__PAUSE__.toggle === 'function'`; Esc with nothing open opens the Menu; sim and audio paused while open; fullscreen works in the stand-in host; 888x500, 632x355, 358x201 and 844x390 screenshots read as an art director (no overlap of HUD on the squishy). |
| S6 | Snap delivery that works in the sandbox (overlay), re-point `say_cheese`. | In `portalcheck.mjs` with the portal sandbox: the photo overlay appears, no error; with `allow-downloads` the download also fires. |
| S7 | `credits.txt`, `README.md` (7.2). | `deploy_game.py` plan lists `credits.txt`, no `.md`. |
| S8 | **Cover [OWNER YES for the ~$0.02 spend, Q2]:** remove the wordmark sentence from `art_direction`; `python pipeline/generate_cover.py ... --out <scratch>`; view it; re-encode to a real PNG 1280x720; place per Q3; commit if it lives in `public/`. | `file thumbnail.png` says PNG 1280x720; viewed at 100 percent and cropped to 2:1 and 3:1 (subject survives); no text. |
| S9 | G0 decision (6.3) implemented. | `vite build` prints `[G0] build output <KB> of the 1229 KB budget` and passes with the cover in place. |
| S10 | `game_meta.json` refresh (section 8). | `node -e` JSON parse; the portal clip (`src/config/site.ts:36`) of `short_description` ends at a sentence boundary. |
| S11 | Seed script `pipeline/seed_squish_keeper_achievements.py` from Blocktooth's offline-validating `seed_achievements.py` (no network in the default run; `--verify` public read-only; `--apply` service key) and Dyefield's insert-only upsert and backup. Resolve the game by slug (id 55 now), refuse on 0 or more than 1 rows, `--hold-tier diamond` fallback. | Default run: validates 22 rows, prints them, exits 0 with no network. `--verify` (public key, read-only): reports 0 rows now. |
| S12 | Full local gates on the tree to ship: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` (silent); `node _harness/run_probes.ts` (all PASS); `node _harness/browser_shell.mjs`, `browser_render.mjs`, `probe_audio.mjs` (the prod-build section checks size, no dev tools, no inline script or style, strict CSP boot); `node node_modules/vite/bin/vite.js build` (G0 line). Run in a snapshot, not the live tree. | All green; record the tree hash and the numbers in the report. |
| S13 | Portal-frame run of the BUILT `dist/` (`portalcheck.mjs`, both host modes, 888x500 and 358x201, plus fullscreen). | 0 errors, 0 CSP violations, achievements path as asserted in S3; screenshots read. |
| S14 | Make one `deploy_game.py`: bring master's `_entry_ref_paths` and `_entry_page_problem` into the branch copy (or the Vite guard into master), run the pipeline's own tests. | `python -c` plan on a built `dist/` shows the entry JS and every `assets/*.js` marked `[critical]`; the truncated-page guard refuses a cut file. |
| S15 | **Dry run:** `python pipeline/deploy_game.py --game-dir games/wobblehoard/dist --slug squish-keeper --dry-run` after `ls games/wobblehoard/dist/thumbnail.png` (the dry run does not check it). Expect: "hashed build", the changed hashed assets, `index.html` (entry) and `game_meta.json` (meta, last), `thumbnail.png`, `credits.txt`, "0 dev-only withheld". | Plan read line by line against `dist/`. |
| S16 | **Ready-for-yes report** with: tree hash, G0 numbers, probe counts, portal-frame screenshots, the dry-run plan, the 22-row seed output, the cover file and its view, the open items. Ask the owner for three separate yeses: (1) seed the achievements, (2) deploy the files, (3) later, publish. | The owner's chat answer. |
| S17 | **[OWNER YES] Seed**, strictly before the deploy that posts achievements: `python pipeline/seed_squish_keeper_achievements.py --apply` (writes a backup of existing rows first), then `--verify` (public read, 22 of 22). | Read-back: 22 rows for game 55 with the right tier and points. |
| S18 | **[OWNER YES] Deploy files only:** `python pipeline/deploy_game.py --game-dir games/wobblehoard/dist --slug squish-keeper --no-portal` (no `--status`). | Live: CDN 200 for `index.html`, an asset, `thumbnail.png`, `game_meta.json`; md5 equals the manifest; the registry row's `build_version` changed, `status` still `unpublished`, `thumbnail_url ?v=` equals the new cover; a boot check of the LIVE URL inside the stand-in host. |
| S19 | **Owner publishes** with the portal toggle (not a script). Then `python pipeline/deploy_portal.py` once (builds the MAIN checkout; read memory `reference_portal_xp_server_authoritative` first: commit only your own hunks, do not roll back other sessions' live files). | `https://forgeflowgames.com/games/squish-keeper` shows `Play Squish Keeper Free Online | ...` in the title and the cover in the pre-roll. |
| S20 | **Signed-in end-to-end by the owner:** play on the portal, earn "Hello, Squishy", then read `user_achievements` and `profiles.xp` (+5). | The one check nobody has done for any game yet (P29). |

---

## 10. Owner questions, unknowns, and what I ran

### 10.1 Questions (each blocks a step)

- **Q1** Slug `squish-keeper` (live, row id 55) is final? (Yes by default.)
- **Q2** Cover: the standing rule says paid xAI key art (about $0.02, one or two tries); the 2026-10-07 deploy used a title capture instead. Confirm xAI, and confirm the spend despite the Telegram gate.
- **Q3** Where the cover lives: exempt it from G0 and commit `public/thumbnail.png` (recommended), or copy it into `dist/` after every build.
- **Q4** Catch-up policy: credit achievements earned as a guest on first sign-in (Blocktooth style, harmless) or only those earned while signed in.
- **Q5** The list in 3.3: names, tiers (diamond is accepted live), the 3 hidden rows, 22 rows and 365 XP, the reserve list.
- **Q6** Fullscreen: build the in-game button (recommended; keeps strict CSP and G0) or vendor the shared `game_controls.js` (59,367 B; needs an inline `GAME_CONFIG` script and injects a `<style>` element, both blocked by the documented CSP; wraps `AudioContext` globally). And whether the portal should get a pseudo-fullscreen for iPhone.
- **Q7** Portal-level display ads will appear around the frame once the owner turns them on. The game never calls `ForgeFlow.ads`. Acceptable for a "free, calm, kid-safe" toy, and should the description say "no ads in the game"?
- **Q8** Cloud save scope: achievements and counters only (recommended; respects C-6), or nothing.
- **Q9** Enforce the documented strict CSP in production with a `<meta>` tag (optional hardening).
- **Q10** G0: keep 1229 KB (cover exempt) or raise it for the UI, trophies and PETS work.

### 10.2 Unknown to me (and what settles each)

- Whether migrations 0009 to 0013 and the new portal bundle are live in full: one signed-in unlock (S20). Partial evidence: the live bundle contains `submit_score`.
- Whether a real phone vibrates inside the portal frame, and Safari/iPhone storage behaviour in the cross-site frame: a device test.
- Whether `window.open(blobUrl)` is a usable Snap fallback inside the sandbox: not measured.
- The live portal's behaviour for an unpublished slug (the page returns the generic shell either way): settled by publishing.
- The bundle cost of the trophies feature (my 25 to 40 KB is an estimate).

### 10.3 What I ran (all read-only; nothing written outside my scratch folder and this memo)

Scratch: `C:\Users\TestRun\AppData\Local\Temp\claude\C--Users-TestRun-AppData-Roaming-Claude-scratch-workspaces-10f6a62c-5610-424a-ba29-8c51dbde9f88-b3ecf43b-de12-4070-80de-e1daecc887bf-scratch-2026-10-06-8a5967\3b1103ab-0174-4d88-adc9-dd448a718f0d\scratchpad\ui\publish\`
- `portalframe.mjs` + `portalframe.log` + `out\portalframe.json` + screenshots `desktop_portal_frame_888x500_{title,play}.png`, `phone_portal_frame_358x201_{title,play}.png` (serves the 2026-10-07 deployed build from `%TEMP%\cdnb\...\dist` on ports 5391 and 5392; one Chromium; closed at the end).
- `mc.mjs`: capsules-only Monte Carlo (3.2).
- `readonly_registry.mjs`, `readonly_registry2.mjs`: GET-only reads of the games registry with the public publishable key from the main checkout's `.env` (the key and the project URL were never printed; `api_config.json` and the service-role key were never opened).
- Public HTTP requests with nothing saved: CDN status checks for `/squish-keeper/{index.html,thumbnail.png,game_meta.json}` and `/wobblehoard/index.html`; the portal pages' titles; the homepage bundle grep for RPC names.
- `python -` import of `pipeline/deploy_game.py` calling only `print_upload_plan`, `source_folder_refusal`, `_is_dev_only` (no credentials, no network).
- `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` on the live tree (silent at 10:59:57).
- Files read: RESUME.md, UI.md, STATUS.md, COMMON.md, CONTRACT.md, COLLECTION.md (lines 26-71, 248, 501-504), DESIGN.md (33, 93, 689), CUT_MINIS.md, `deploy_game.py`, `deploy_portal.py`, `generate_cover.py`, master and branch `gameBridge.ts`, `forgeflow-sdk.js`, `GamePlayer.tsx`, `GameCard.tsx`, `pages/games/@slug/+Page.tsx`, `pages/achievements/+Page.tsx`, `workers/games-cdn`, migrations 0003, 0009, 0011, Blocktooth `portal.ts`, `goals.ts`, `ui/goals.ts`, `ui/menus.ts`, `ui/toast.ts`, `seed_achievements.py`, `platform.md`, Dyefield `stats/*`, `CONTRACT_STATS.md`, `seed_dyefield_achievements.py`, and the Claude Claw memory notes on the portal XP rollout, publish toggle, covers and portal SEO/ads.
- Processes: every process I started has exited (Chromium, the two static servers, node scripts); the other Chromium processes on the machine belong to other jobs and were not touched.
