# WOBBLEHOARD: status and roadmap

What is built, what to build next, in what order, what each step depends on, how big it is, and what only the **owner** can decide. Detail lives in
[`COLLECTION.md`](COLLECTION.md), [`MERGE.md`](MERGE.md) and [`TRADE.md`](TRADE.md); the design decisions are in [`DESIGN.md`](DESIGN.md); the
build contract (lanes, gates, ports, commands) is [`CONTRACT.md`](CONTRACT.md); the reference clips are read in [`REFERENCES.md`](REFERENCES.md).

**Grades.** **[V]** verified by running it here. **[R]** read in the repo. **[S]** a DESIGN claim not re-checked. **[G]** general knowledge. **[U]** my estimate or assumption. **All sizes below are [U]**: one engineer, working days, rough, to be re-estimated when a step starts.

---

## 1. Status: the one authoritative table (as of 2026-10-05, UTC)

**This is the only place that says what is built, wired into the app, or specification only.** Other documents link here instead of restating it.
"Built" = the code is in the tree. "Wired" = `src/app.ts` uses it in the running game. Gate results live in gitignored reports, so the last result and
its date are copied here; update the row (with the date) whenever a lane re-runs its gate. Rows marked "read from the report" were copied from the
lane's own report file, not re-run by the docs lane; "checkpoint `fc60963`" is the orchestrator's commit of 2026-10-05 06:37.

| Module | Built | Wired into the app | Spec only | Last gate result (date, UTC) |
|---|---|---|---|---|
| Slice physics: DOLLOP soft body (`src/physics`) | yes | yes | | `probe_softbody.ts` (full run), 2026-10-05 06:44, read from the report: 99 of 100 rows pass; 1 fails (a hard side shove at the swirl-peak leaves a 138 degree crease against the 115 degree limit). PHYS is rewriting: **in progress** |
| Physics round 2: material families, species rest shapes, `metrics.press` and `reaction`, ceremony drivers, per-family G1 band (CONTRACT 4.2, 4.3) | partly: `softbody.ts` at checkpoints `fc60963` and `f14d3b8` fills `metrics.press` and `metrics.reaction`; material families, species rest shapes, the ceremony drivers and the per-family band are not in it yet | no | the rest of the interface | **in progress** (PHYS) |
| Slice audio: poke, squish, release, land, pop, blend | yes | yes | | SOUND.md records 372/372 checks for rounds 1 and 2 |
| Audio round 2: `meterFull`, `capsuleBeat`, `reveal`, `mergeStart`, `duck` | yes (landed 2026-10-02 18:07, commit `d0c4545`) | no | | as above |
| Audio round 3: music bed, `bump`, `lift`, `toss`, `strand` | in the tree (`music.ts`, `interact.ts`, first committed in checkpoint `7954349`, 2026-10-05 05:51); still being tuned | no | | **in progress** (AUDIO; its probe was running at 06:37, result not recorded here) |
| Slice render: the jelly stage | yes (landed 2026-10-02 16:36) | yes | | `browser_render.mjs`, last complete run 2026-10-05 05:13: 182 of 185 checks ok (recorded then); a later run (started 06:24) was cut off: its report says the browser closed mid-run |
| Render round 2: several bodies, tier look, capsule drop and reveal, merge ceremony, Calm effects, flash governor | yes (`src/render/stage.ts`) | no | | 05:13 run: one listed failure (the Legendary merge escalation row); audit fixes **in progress** |
| Slice shell: input, keyboard, settings, HUD, title, errors | yes (landed 2026-10-02 17:16) | yes | | `browser_shell.mjs`, 2026-10-02 17:12: 151/151 |
| Core economy logic: `rarity`, `meter`, `drops`, `merge`, `genome` with 50 species | yes (landed 2026-10-02 18:01, commit `7869499`; audit fixes in checkpoints `fc60963` and `f14d3b8`) | no | | re-run on the working tree after checkpoint `f14d3b8`, 2026-10-05 about 15:40 UTC: `probe_economy` 138/138, `probe_genome` 25/25 [V] |
| Catalog and material data: `catalog.ts` (50 species), `materials.ts` (12 families), `shapes.ts`, `palette.ts`, `species.ts` | yes | no (only core, the probes and the sim import them) | | same run: `probe_catalog` 121/121 (including the multilingual name gate and the `CATALOG.md` drift guard), `probe_materials` 46/46 [V]. The pre-launch renames of idx 15, 18, 20 and 36 landed in checkpoint `f14d3b8`; `node _harness/gen_catalog_doc.ts` leaves `CATALOG.md` unchanged |
| Economy sim | yes | (not a game module) | | full canonical run 2026-10-05, re-run on checkpoint `fc60963` the same day and again on the working tree after `f14d3b8` (about 16:05 UTC, 430 s): identical output, the SHA-256 DESIGN 5.0 records [V] |
| Typecheck of the whole tree | | | | `npx tsc --noEmit -p tsconfig.json` clean, 2026-10-05 about 15:45 UTC, with the PHYS lane's edits in progress [V] |
| Production build and deploy path | yes: `npm run build` (it fails itself if the output exceeds the 1.2 MB budget, `vite.config.ts`); `public/game_meta.json`; `npm run deploy` / `deploy:dry` (build, then `pipeline/deploy_game.py --game-dir dist`); `deploy_game.py` refuses the source folder | (not a game module) | `public/thumbnail.png` (rendered from the final game later) | 2026-10-05 about 15:30 UTC [V]: build 822 KB of 1229 KB; `vite preview` boots on desktop and a 390x844 touch phone with 0 console errors or warnings and 0 failed requests; `game_meta.json` in the output. **Never deployed** |
| COLLECTION module 1: local Hoard, meter feed, capsule table, restock, tasks, Practice shelf | no | no | yes (COLLECTION.md) | |
| SERVER MINT 1b: migration, commit functions, `wh-api` host, portal bridge | no (drafts in COLLECTION.md appendices; nothing in `supabase/`) | no | yes | drafts on a scratch PostgreSQL 16: 149 SQL + 36 host checks on 2026-10-02; **after the 2026-10-05 security revisions, 170 SQL + 37 host checks, the ops pack and the A.7 privilege audit (with its negative test), 2026-10-05, last run finished 06:53 UTC [V]; re-run independently from the documents at about 16:00 UTC: 170/170, 37/37, ops pack clean, A.7 passing and failing the migration on each of six injected faults [V]**. Never run on Supabase (gate G9) |
| MERGE module: host ops `wh_merge` and `wh_tidy`, pad UI, Tidy-up | merge rules only (`core/merge.ts`) | no | server and UI (MERGE.md) | rules: `probe_economy` (above); the draft host and commit function: as SERVER MINT |
| TRADE module: friends, shelf, board, proposals, review screen, block and report | no | no | yes (TRADE.md) | as SERVER MINT |
| Stage B: the reference-clip features (section 4) | audio side in progress (round 3) | no | yes | |

**Stage A** is what the lanes were finishing on 2026-10-05: physics round 2, the render round-2 audit fixes, audio round 3, and then the shell rewrite that wires
rounds 2 and 3 into the app. **Stage B** is the play-mat work taken from the reference clips (section 4). The collection, server, merge and trade
modules (P2 to P8) follow the roadmap of section 2.

**What the module documents proved, and when.** On 2026-10-02 the draft SQL and a reference host passed 149 SQL-level and 36 host-level checks on a
scratch PostgreSQL 16 with a Supabase stand-in (parallel acceptors, double-spend, replay, tampered payloads, fault injection, deadlock storm,
laundering ring, conservation). After the security revisions of 2026-10-05 (section 7) the same suites, grown to **170 SQL-level and 37 host-level
checks**, passed again on 2026-10-05 on a scratch PostgreSQL 16.14, with the SQL, the runner and the host cut verbatim out of the documents by a
script; the migration's privilege audit (COLLECTION A.7) passed and was shown to fail the migration on a schema-wide revoke or a stray grant.
**Not proven:** anything on a real Supabase project, PostgREST, the Edge Function, the portal, any UI, or load.

## 2. The roadmap

```
 P0 stage A: lanes finish rounds 2-3, shell wires them, gates G0-G8 -----+------------------------------+
 P1 owner decisions (D-6, D-4, D-5 default A, D-3, D-16) --+             |                              |
                                                           v             v                              v
 P2 COLLECTION-local: store, stacks, ghosts, Hoard UI ---> P3 capsule table, restock, tasks, ceremony wiring    PB stage B (section 4): play mat,
        |                                                             |                                    contact, pick-up, strands, music,
        +--> (client work continues)                                  |                                    contact glow (client only, parallel)
 P4 SERVER MINT: migration, host, portal bridge  ----------+          |
        |                                                  v          v
        +-----------------------------------> P5 integrate client + server, staging runs
                                                   |            |
                                       +-----------+            +-------------+
                                       v                                      v
                                P6 MERGE (9-11 d)                       P7 TRADE (30-40 d)      <- parallel
                                       |                                      |
                                       +------------------+-------------------+
                                                          v
                                           P8 hardening and ops
                                                          v
                                           P9 closed beta + measurement
                                                          v
                                           P10 open launch gates (D-3, D-5, counsel)
                                                          v
                                           P11 seasons (new species)
```

| Phase | Work | Size | Depends on | Exit criteria |
|---|---|---|---|---|
| **P0** | Stage A: physics round 2 (material families, species shapes, per-family G1, ceremony drivers), render round-2 audit fixes, audio round 3, the shell rewrite that wires the round-2/3 members and the planned settings (CONTRACT section 8) | other lanes, in progress on 2026-10-05 | none | Gates G0 to G8 green (CONTRACT section 6) |
| **P1** | Owner decisions in section 3: **D-6 hosting, D-4 accounts, D-5 age default, D-3 name, D-16 per-game origin** | owner, days to weeks | none | Written answers; D-6 blocks P4, D-5 blocks any trading by children, D-3 blocks public launch, D-16 should precede P5 |
| **P2** | COLLECTION-local: v2 save and migration, stacks, meter feed and preview ring, the practice (ghost) economy, the Hoard UI (cabinet, filters, detail card with the live squishy), empty and error states, accessibility | 14 to 17 days | P0 (the stage and body); species icon helper | Practice-only Hoard playable by a guest, probes C01 to C10, UI checks U01 to U09, gate G4m |
| **P3** | Capsule table (up to 5), open, restock, tasks, the ceremony calls (result first), haptic and sound hooks | 3 to 4 days | P2, render and audio ceremonies | A guest can play the full practice loop, including a merge of ghosts |
| **P4** | Server mint: migration (tables, helpers, commit functions, RLS, the privilege snapshot and self-test), the `wh-api` host, vendor and hash probes, the `forgeflow:rpc` bridge in the portal and its deploy | 13 to 15 days | **D-6**; owner applies the migration and deploys the portal | Staging project passes the two suites through PostgREST and the Edge Function (gate G9) |
| **P5** | Integration: `bridge.ts`, `api.ts`, `sync.ts`, the mirror, pending-op reconcile (COLLECTION 7.7), first sign-in, sign-out wiping, the real Hoard | 7 days | P3, P4 | A signed-in player earns, opens, restocks and completes tasks; closing the tab never loses or doubles an item |
| **P6** | MERGE: shared `oddsDigest`, host `wh_merge` and `wh_tidy`, pad UI, last-copy modal, hold, ceremony wiring, Tidy-up | 9 to 11 days | P4, P5 (the pad UI can start in P2 on ghosts) | Section 10 of MERGE.md green |
| **P7** | TRADE: friend codes, shelf, board, proposals, review screen, inbox, block and report, emotes, handle lists | 30 to 40 days | P4, P5; **D-5** to turn trading on for anyone but testers; D-8 word lists; D-17 | Section 18 of TRADE.md green on staging through PostgREST; UI checks; trading enabled for allow-listed adults only |
| **P8** | Hardening and ops: hourly conservation job with auto-freeze, admin recall function, the request-body limit at the gateway and the per-account rate buckets on staging, in-migration self-test blocks, load test, portal-rendered trade confirm (H1) | 10 to 14 days | P6, P7 | Freeze drill done; recall drill done; load test results recorded |
| **PB** | Stage B (section 4): the play-mat features from the reference clips | 25 to 41 days, not on the critical path | P0 (physics round 2); B1 "bring out of the Hoard" also needs P2 | Each item's exit in section 4 |
| **P9** | Closed beta with allow-listed adults (2 weeks), aggregate telemetry, **measure the real minutes per capsule and the real trade share**, retune `capsuleCost` and the levers of TRADE.md section 2 if needed | 2 weeks calendar | P8 | A written report against DESIGN risks 5 and 6 |
| **P10** | Open launch gates: D-3 clearance, D-5 age and consent, privacy page and terms updated, counsel review, the pre-existing portal exposures (D-13) fixed | owner and counsel | P9 | Signed off |
| **P11** | Seasons: 4 to 6 new species every 8 weeks, append-only (DESIGN risk 3); one `wh_species` row, one catalog entry, one probe lock entry each | ongoing | P10 | |

**Total engineering before the beta: about 96 engineer-days (range 85 to 115) [U]**: P2 15 + P3 3.5 + P4 14 + P5 7 + P6 10 + P7 35 + P8 12. With two engineers (one on the client, one on the server and ops) about **10 to 12 calendar weeks**, plus the beta. **The critical path is D-6, P4, P5, P7, P8, the beta.** P2 and P3 need no server; they start when stage A (P0) lands. Stage B (PB) adds 25 to 41 engineer-days [U] if the owner wants it before the beta; it needs no server and can run beside P4 to P7.

## 3. Decisions only the owner can make

| # | Decision | Options and my recommendation | Blocks | If no answer |
|---|---|---|---|---|
| **D-1** | **Merge cost 2 or 3.** | Keep **2** (DESIGN 5.6: 3 to 4 minutes per capsule is the "decent effort" band; with the 2026-10-06 meter (DESIGN 5.4) it is 3.1 to 3.6 by play style and 3.0 measured for regular players; at the chosen 100 SP meter, 3 fails the "a mergeable set in the first one or two sessions" target: 36.3 minutes against 10.3 to the first mergeable set [sim O, 2026-10-06 run; 36.6 against 10.4 before]). Flip only if a playtest measures 1.5 minutes or less per capsule, or the meter changes too. **In the game the flip is one source line plus `node _harness/gen_catalog_doc.ts` (`probe_economy.ts` needs no edits); on the server, a config row and a host redeploy: [MERGE.md section 8](MERGE.md), re-checked in a scratch copy on 2026-10-05.** | Nothing now | Stays 2 |
| **D-2** | **Should trade be mandatory for completion?** | As designed it is not: a solo player finishes in about 205 days against 131 with trading (1.56x at the median) [sim K], and trade supplies about a third of Epic+ first copies [sim L] (DESIGN 5.0). The levers that could change that (account exclusives, version groups, gift species, and others) and their costs are in [TRADE.md section 2](TRADE.md). **None is adopted.** Recommendation: ship as designed, measure the real trade share in the beta, then decide. Any lever excludes players who cannot trade (age gate, no friends, no sign-in), so decide D-5 first. | The design of P7 only if a lever is chosen | Not mandatory |
| **D-3** | **Name clearance.** | A trademark and domain search on the title **WOBBLEHOARD** and all 50 species names (DESIGN section 9 requires it before release; `probe_catalog.ts` only checks against a built-in denylist, which is not a legal search). **I cannot do this with the tools I have.** The internal screen was widened on 2026-10-05: `probe_catalog.ts` now holds **every official Pokemon species name** (all 1025, generations 1 to 9, from PokeAPI: `_harness/data/deny_pokemon.json`), the main Digimon, all 55 Neopets species and the six Moshi Monsters (`_harness/data/deny_creatures.json`), about 1600 names in all, and reads names aloud (a name also fails when it **sounds** one edit away from a listed name). It caught three names, **renamed before launch** with their idx bytes kept (`src/data/species.ts` rule 3b): **Glubbin -> Glugbean** (one letter from Grubbin), **Sproink -> Boingle** (Spoink), **Drowsel -> Slumbrel** (Drowzee, read aloud). All 50 names pass the widened screen and the multilingual language gate. The screen is still not a legal search. Recommendation: before any art or marketing spend; a working title is fine for the beta. | Public launch, store listings | The title stays "working" |
| **D-4** | **Account requirements.** | Real squishies need a server account. **(a)** the existing portal accounts (email sign-up, Google): works as of 2026-10-05, but needs an email address, which is the child-privacy question (D-5). **(b)** Supabase anonymous sign-ins [G: supported by Supabase Auth, not used by the portal today]: a player gets a real account and a real Hoard with **no email**, can collect and merge, and trade stays off (the database default) until the account is linked to a verified identity; weaker against multi-accounting (clear storage, new account) but safe because trade is gated. **(c)** guests stay practice only. Recommendation: **v1 = (a) and (c)**; evaluate (b) after the beta, because it changes the portal. | P4's account story, P5's first-sign-in flow | (a) and (c) |
| **D-5** | **Age gating and consent for trading.** | The portal has no age field and no parental flow [R]; its privacy page says "No account creation is required to play games" and "We do not knowingly collect personal information from children under 13" [R] while real items need an account. Options in [TRADE.md 16.3](TRADE.md): **A** closed beta, trading switched on by hand for named adults; **B** a neutral age screen at portal sign-up with trading for 13+ (or 16+); **C** verifiable parental consent via a third party; **D** adults only. **Recommendation: A for the beta, and C if children are the audience.** Needs the owner and counsel; I am not a lawyer. The switch it sets (`trade_enabled`) closes every social surface, not only trading (TRADE 16.1). | Any trading by anyone who is not an allow-listed tester; the launch | **A** (trading off by default) |
| **D-6** | **Server hosting and cost.** | The logic is TypeScript and must run the game's own modules verbatim. Options: **(a) a Supabase Edge Function** (recommended: same project, JWT verified by the platform, no new vendor); **(b)** a Cloudflare Worker (the repo already deploys `workers/games-cdn` with wrangler) calling PostgREST with the service key: **no SQL change**; **(c)** port to PL/pgSQL with golden vectors (not recommended: drift risk). **Cost formula [G, unverified plan limits]:** Edge invocations per month = daily active players x sessions a day x (minutes per session x batches per minute + about 10 other host calls) x 30. With a 45 second batch (1.33 a minute) and one 20 minute session: 37 calls per player-day, so **1,000 daily players is about 1.1 million a month and 10,000 about 11 million**; the free plan allows 500,000 and the Pro plan includes 2,000,000 [G]. Plain `rpc` calls (inbox polling at 1 a minute, reads) are not Edge invocations. **Storage measured on the scratch database [V, 2026-10-02]:** an item costs about **225 bytes with indexes**, a ledger row about **318 bytes**; at 331 items a player (the sim's week-9 mean [sim G]) that is about **200 KB per player**, so 1,000 players are about 200 MB and 100,000 about 20 GB [U: random test data, no compression]. I do not know which Supabase plan the `qkid` project is on. | P4 | Edge Function |
| D-7 | **Trade numbers.** | Daily cap 3 (the sim value; DESIGN says "raise to 5 as headroom"), pair cap 1, lock 24 h, gate 2 days and 10 capsules, offer shelf 12, friends 30, live offers 3 and 10, the per-account rate buckets of TRADE 7.4. All are config or constants. Recommendation: ship as written, review in the beta. | Nothing | As written |
| D-8 | **Handle word lists.** | 64 adjectives and 64 nouns (plus a server number): content only the owner can approve; **all 4096 combinations must be reviewed** (a probe checks them against a language-safety list as the species names are). | P7's handle picker | Placeholder lists in the beta |
| D-9 | **Telemetry.** | Aggregate-only play timing and trade share (no user id in the aggregate): needed to re-measure the 3.0 minutes a capsule (DESIGN 5.4 and risk 5; 3.1 before the 2026-10-06 meter re-tune). Recommendation: yes, aggregate only, 13 months. | P9 | None collected |
| D-10 | **Portal-rendered trade confirm (H1)** before an open launch to children | Recommended (TRADE.md 12.6): a compromised game build cannot confirm a trade without a human click in the portal. 3 to 5 days of portal work. | P10 | Not built |
| D-11 | **Day boundary** | UTC (what `meter.ts` does) or another fixed offset, for the meter cap, restock, tasks and the merge cap. A non-UTC player sees a mid-day reset. Recommendation: UTC for v1; one constant to change later. | Nothing | UTC |
| D-12 | **Welcome grant for guests who sign in** | Up to 3 capsule credits for 3 practice capsules opened, once per account (COLLECTION 6.3). Saves about 5 minutes; one more commit function. Recommendation: no. | Nothing | None |
| D-13 | **Pre-existing portal exposures** | `profiles` is world-readable (including `is_online`, `current_game_slug`, and a `username` that may be the start of an email address); `friendships` policies let a user forge an accepted friend row; `find_users` searches by email. None is WH's to fix, all matter for children. Recommendation: fix before any child access, separately from this work ([TRADE.md section 17](TRADE.md)). | P10 | Left as is |
| D-14 | **Merge cap and Tidy-up defaults** | Cap 10 merges a day (it counts merges, so at M = 3 up to 30 items a day); Tidy-up defaults to Common and Uncommon and never touches shelved items (MERGE.md M-4). | Nothing | As written |
| **D-15** | **Colourway variants** (from reference clip A, REFERENCES.md section 1) | Optional rare colourway variants per species: a second collecting dimension. It changes the economy (more "species" to complete, or a cosmetic layer on top), the odds disclosure and trade parity, so the sim must be extended and re-run before deciding. DESIGN 5.6 says "none in v1". Recommendation: not in v1; revisit with seasons (P11). | P11 at the earliest | None in v1 |
| **D-16** | **A separate origin for this game** | All games are served from one CDN origin (`forgeflow-games-cdn.../<slug>/`, `pipeline/deploy_game.py` [R]), so `localStorage` is shared with every other game and with any script injected into one of them. COLLECTION 7.7 already keeps no replayable parameters there, but a per-game origin (for example a subdomain per slug) removes the whole class of problems. Infrastructure work outside this game. Recommendation: before P5 (real items reach the device). | P5 (recommended) | Shared origin; COLLECTION 7.7 mitigations only |
| **D-17** | **Friendships when trading is switched off** (age or consent flow, or the owner) | When `trade_enabled` goes off, every social surface closes at once and pending requests, live trades and listings are cancelled (TRADE 16.1). Existing friendships are **suspended** by the draft (kept, hidden, unusable, back if trading is switched on again). The alternative is to **delete** them (cleaner for a child who was found under-age, irreversible). Needs the owner and counsel. | P7 | Suspended |

## 4. Stage B: the reference-clip features (scheduled; client only)

From [`REFERENCES.md`](REFERENCES.md) (clip A = the jellyfish demo, clip B = the squishy shelf). None needs the server; each must keep the flash budget
and Calm effects (DESIGN 6.6) and every gate of CONTRACT section 6. Owners are lanes (CONTRACT section 2); sizes [U].

| # | Item (clip, beat) | Lanes | Size | Depends on | Exit |
|---|---|---|---|---|---|
| B1 | **Play mat with several squishies out at once**: bring 2 to 5 out of the Hoard onto the mat (B, "mix and match.") | SHELL, RENDER (`addBody` exists), PHYS (stepping several bodies inside the 2.0 ms budget per body or a shared budget) | 4 to 6 days | P0; "bring out of the Hoard" needs P2 (Practice items are enough) | 5 bodies at 60 fps on the reference phone profile [U target]; G1p per body |
| B2 | **Soft body-to-body contact**: squishies push, squash and tumble against each other (B, "mix and match.") | PHYS (particle-against-surface contact between bodies, bounding-sphere broad phase, new contract member), AUDIO `bump` (round 3) | 6 to 10 days | B1, physics round 2 | Fuzz with 3 bodies: 0 NaN, 0 inversions, no tunnelling; the `bump` voice fires on contact events |
| B3 | **Pull past the limit = pick it up, then toss it** (B, "mix and match.") | PHYS (unstick from the mat, kinematic carry, release velocity), SHELL (gesture), AUDIO `lift` and `toss` (round 3) | 4 to 6 days | B1 | A pull beyond `maxPull` lifts; a flick throws; the body lands and settles inside the mat |
| B4 | **Long taffy pulls** for Sticky Stretch and Slime Goo to their `maxPull` (2.1 to 2.9x), neck and spring back (A, "To the limit") | PHYS | 3 to 5 days | physics round 2 (materials) | Fuzz coverage of long pulls; no fold left at the neck |
| B5 | **Contact glow**: a soft bloom where the finger presses, tinted by the core colour (A, "Touch the light") | RENDER (uses `SoftBody.tip()`) | 1 to 2 days | P0 | Gate G7 unchanged (it is not a flash); Calm effects reduce it |
| B6 | **Tack strands**: tacky families string and snap with bubbles (B, "pull. pop.") | PHYS (tack, SQUISHY_SCIENCE P6), RENDER (strand geometry), AUDIO `strand` (round 3) | 5 to 8 days | physics round 2 | A strand forms, stretches and snaps on the two tacky families only; `fingerUp` behaviour unchanged elsewhere |
| B7 | **Music bed** with its own volume, ducked under ceremonies (B, audio) | AUDIO (round 3, in progress), SHELL (a Music setting: additive `Settings` field) | 1 to 2 days of shell work | audio round 3 | Music off by default or at the designed level (owner's call); follows mute, pause and Calm |
| B8 | **Extra squish** depth: an optional deeper squish (B, "more squish.") | SHELL (setting), PHYS (a depth scale on `fingerPressure`), INTEGRATION (additive `Settings` field) | 1 to 2 days | P0 | Off by default; G1 holds at the deeper depth |
| B9 | **Colourway variants** (A, "Aurora. Amber. Abyssal.") | owner first (D-15), then CORE, RENDER, the sim | not scheduled | D-15 | Only if the owner adopts D-15 |

## 5. Stretch modules from the reference clips (NOT in v1)

None of these is built or scheduled. Each is a paragraph on how it would sit on what exists; sizes are [U].

**Jelly Lab: split and rejoin (clip A: "Each cut, another size" to "Everything reconnects").** The soft body is about 640 particles with edge-distance constraints (compliance from `genome.stretch`), one global volume constraint, shape matching toward the rest shape, and a two-finger `grab` that attaches a Gaussian patch of vertices to a target. A cheap path that reuses all of that: let a long pull *pinch off* by giving edges a break strain (the per-vertex `strain[]` array is already exposed), partition the vertices into two clusters at the neck, and give each cluster its own volume target and shape-matching goal; rejoin by welding the nearest vertices when the halves meet. The expensive path is real mesh surgery into two closed bodies (`SoftBody.split(plane)`). Either way it needs per-cluster volume and shape matching (today there is one cluster), new fuzz coverage for mesh inversion at the neck (the fuzz of `probe_softbody.ts` is the template), and stays a cosmetic lab mode: no genome change, no economy, no server. Size L, 10 to 15 days, most of it physics stability.

**Fold into a glowing ball as a charge animation (clip A: "All the light in one ball").** The merge ceremony already uses the optional solver members `setFold(t)`, `moveTo`, `tremble(amp)` and `burstOpen(strength)` (`contracts.ts`; physics round 2), the stage's tier FX and `audio.mergeStart`. A standalone "charge" is the same drivers fed by `meterFill`: the squishy folds a little more as the meter nears full, trembles, and springs open as the capsule drops, with colour from `TIER_STYLE` and `genome.coreHue`. It adds no economy, only presentation, and must obey the flash budget and Calm effects (DESIGN 6.6). **One design tension to resolve first:** folding the body interrupts touching, and DESIGN 6.2 says the meter-full cue must not interrupt touch, so the charge would have to be a small glow and ring, not the whole body, while the player is touching. Size S to M, 3 to 5 days, mostly tuning and QA.

**Mix-and-match trait rail (our own idea).** An earlier draft attributed this to clip B's "mix and match." beat; REFERENCES.md reads that beat as squishies tossed onto a shelf, which is stage B item B1, not a trait editor. The idea stands on its own: the genome already has the traits a rail would edit (`PATTERNS`, `EYE_STYLES`, hue, core hue, glitter, size, eye spacing, quantised to 1/255 by `quantizeGenome`) and the catalog's per-species `bands` say how far a look may move before a species stops being recognisable. Editing the genome itself would destroy the "every instance is unique" and "share string is look-only" rules, so the safe design is a **cosmetic overlay** stored beside the item (`wh_items.cosmetic jsonb`) with each field validated against fixed lists and ranges (no free text), applied by the renderer, and kept out of `genome_code` and out of trade parity (tier is by species). Unlocks would be the fixed cosmetic rewards DESIGN 5.11 already promises for finished rows. The trade review screen would show the overlay as part of the exact look. Size M, 6 to 8 days (UI and server validation), plus an owner decision on whether cosmetics travel with a traded item.

**Six-input bulk blender (clip B: "Premium: the Blender.").** DESIGN defers it; Tidy-up is its only descendant. Much of the machinery exists: `mergeOddsCore` and `mergeDrawCore` are generic over integer species handles and are already used by the sim for hypothetical rosters (the sim has a `mergeInputs` setting), `lineageGenome(template, parents[], seed)` already accepts any number of parents, `audio.blend({count, durationS})` exists in the slice, and the server pattern (host, odds digest, commit function) is the one in MERGE.md. What is new is **the rules, not the code**: how mixed species and tiers combine into a tier-up chance, how to keep a six-input blend from being a cheaper route to Epic and above than the drop (DESIGN 5.8 shows merge-only routes only roughly match a drop for Rare and above), and whether it is the supply sink DESIGN 5.9 says merge is not (merge removes only 2 to 3% of supply). That needs a sim extension and an anti-laundering review before any build, then a `wh_blend` host operation and commit function, a UI for placing up to six inputs, and a ceremony beat sheet (the render lane clamps merge ceremonies to 2 or 3 parents today). Size L, 15 to 20 days including the sim work.

## 6. Risks worth watching (beyond DESIGN section 10)

1. **Everything rests on assumed behaviour** (DESIGN 5.12); the beta must re-measure minutes per capsule and trade share before any retune.
2. **The server key is the trust root.** A leaked service key can mint anything. Keep it in the function's secrets; rotate it; consider a dedicated database role limited to the `wh__*` functions (H2).
3. **A compromised game build can act as the player** through the bridge, including confirming trades (H1 is the answer).
4. **Multi-accounting** is the real macro risk: every account is a new 12-capsule stream. The controls are the trade gate and caps, not the meter.
5. **The world-readable portal tables** (D-13) leak more about a child than WH ever will.
6. **The sim's trade ratio (1.5 to 1.7x) is a hard ceiling** of the current catalog (DESIGN 5.8): owner expectations of "required" need a decision (D-2), not more code.
7. **Per-lane file ownership:** `core/save.ts` and `core/genome.ts` need the additive `'restock'` origin; the shell lane owns `save.ts` (COLLECTION 3.5).
8. **The shared CDN origin** (D-16): any script on it can read and write this game's `localStorage`. The design never trusts or blindly replays local data (COLLECTION 7.7), but the clean fix is infrastructure.
9. **The draft SQL has only ever run on a scratch PostgreSQL with a stand-in for Supabase** (the 2026-10-05 revisions included, section 7). RLS and grants under PostgREST, `SECURITY DEFINER` ownership and the Edge Function are unproven until gate G9 runs on a staging project.

## 7. What the docs lane did and did not do (2026-10-05 revision)

**Done:** this file now carries the one status table (section 1) with absolute dates and schedules the reference-clip items as stage B
(section 4, owner decision D-15); D-16 and D-17 were added; CONTRACT.md was rewritten as the current build contract; DESIGN.md was brought in line
with the clip review, the module documents' deviations and one canonical sim run (DESIGN 5.0). The draft SQL and host in COLLECTION.md, MERGE.md and
TRADE.md were revised for the 2026-10-05 security audit: the grant revocation is scoped to WH objects and audited, local pending operations keep no
replayable parameters, the trading switch closes every social surface, the report hold cannot be re-armed, friend-code errors no longer reveal a
code's validity, counters keep the trade's tier, board trades stay 1 for 1, the incoming-offer cap holds under concurrency, payload limits are
described honestly with per-account rate buckets added, and Tidy-up sub-keys cannot collide.

**Verified on 2026-10-05 [V]** (this container has PostgreSQL 16.14 and Node 22.22.0; nothing was installed):

* **The draft server, as written in the documents.** A script cut every SQL block, the Python runner and the two host files verbatim out of
  COLLECTION.md, MERGE.md and TRADE.md and ran them on a scratch database with the stand-in of TRADE Appendix B: the migration loaded in the
  order of COLLECTION Appendix A with its privilege audit A.7 passing; **170 of 170 SQL checks** (TRADE Appendix C, including every check added
  for the audit); the ops pack without an error; **37 of 37 host checks** (COLLECTION Appendix C) against `src/core` and `src/data` as they stood at 06:53 UTC. Both suites were run twice
  (finishing 06:42 and 06:53 UTC), the second time after the last edit to any appendix.
  A.7 was also loaded after six injected faults (the first draft's schema-wide revoke on tables, the same on sequences, a callable helper, a usable
  WH sequence, an extra table grant, RLS switched on for a portal table) and failed the migration every time.
* **The canonical sim** re-run on checkpoint `fc60963`: byte-identical to the run DESIGN 5.0 quotes (same SHA-256).
* **The CORE probes** on a clean export of checkpoint `fc60963`: `probe_economy`, `probe_genome`, `probe_catalog`, `probe_materials` all pass.
* **The volume-band table** of CONTRACT 4.3 regenerated from `materials.ts` with the command printed there; **the family and lane rules** of
  DESIGN 5.2 recomputed from `catalog.ts` (grid, lane totals 10/10/9/8/7/6, 3 to 5 species and tiers per family, signature family higher in
  mean tier, no tier more than 40% one lane).
* `npx tsc --noEmit -p tsconfig.json` clean for the whole tree at 06:52 UTC, with the other lanes' edits in progress.

**Independent check, 2026-10-05 about 15:30 to 16:10 UTC** (after checkpoint `f14d3b8`): the four CORE probes, `sim_economy.ts --quick`, the full canonical sim (same SHA-256 as DESIGN 5.0), `gen_catalog_doc.ts` (no change to
`CATALOG.md`) and `tsc` re-run on the working tree; a scratch flip to `MERGE_COST = 3` (MERGE.md section 8); the SQL and host suites re-extracted from the documents and re-run (170/170, 37/37, ops pack clean) plus a fresh negative test of A.7 (six injected faults, each failing the migration); the production build and `vite preview` boot (section 1). The rows of section 1 marked "about 15:" or "about 16:" come from that check.

**Not done:** no code under `src` or `_harness`; nothing under `supabase/`; nothing deployed; no trademark or legal search; no run on a real
Supabase project (PostgREST, RLS as Supabase configures it, the Edge Function, Deno); no UI; no load test. The physics, render and audio gate
numbers in section 1 are copied from those lanes' own reports, not re-run here.
