# WOBBLEHOARD: the roadmap after slice 1

What to build, in what order, what each step depends on, how big it is, and what only the **owner** can decide. Detail lives in [`COLLECTION.md`](COLLECTION.md), [`MERGE.md`](MERGE.md) and [`TRADE.md`](TRADE.md); the design decisions are in [`DESIGN.md`](DESIGN.md).

**Grades.** **[V]** verified by running it here. **[R]** read in the repo. **[S]** a DESIGN claim not re-checked. **[G]** general knowledge. **[U]** my estimate or assumption. **All sizes below are [U]**: one engineer, working days, rough, to be re-estimated when a step starts.

---

## 1. Where we are

* **Slice 1** (one squishy you can poke, squish, pull and release, with sound) is built; other lanes are finishing the capsule and merge ceremonies (render and audio) right now.
* **The collection loop is decided and validated** (DESIGN 5): about 50 species in 6 tiers, a Squish meter that pays free capsules, repeats allowed, merge of 2 same-species copies, exact same-tier trade with locks and caps. The pure game logic exists and is tested: `src/data/catalog.ts`, `shapes.ts`, `src/core/{rarity,meter,drops,merge,genome}.ts`.
* **These documents** specify the three modules the owner asked for as separate next steps: collection (with the server mint), merge ("blend" in the owner's wording), and trade (**required** by the owner).
* **What was proven while writing them:** the draft SQL and a reference host passed 149 SQL-level and 36 host-level checks on a scratch PostgreSQL 16 with a Supabase stand-in (parallel acceptors, double-spend, replay, tampered payloads, fault injection, deadlock storm, laundering ring, conservation). **What was not:** anything on a real Supabase project, the Edge Function, the portal, or any UI.

## 2. The roadmap

```
 P0 slice-1 gates + ceremonies (other lanes) ----------------------------+
 P1 owner decisions (D-6, D-4, D-5 default A, D-3) --+                   |
                                                     v                   v
 P2 COLLECTION-local: store, stacks, ghosts, Hoard UI ---> P3 capsule table, restock, tasks, ceremony wiring
        |                                                             |
        +--> (client work continues)                                  |
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
| **P0** | Slice-1 gates G0 to G6 (CONTRACT section 6); render and audio ceremonies | other lanes | none | Probes and browser gates green |
| **P1** | Owner decisions in section 3: **D-6 hosting, D-4 accounts, D-5 age default, D-3 name** | owner, days to weeks | none | Written answers; D-6 blocks P4, D-5 blocks any trading by children, D-3 blocks public launch |
| **P2** | COLLECTION-local: v2 save and migration, stacks, meter feed and preview ring, the practice (ghost) economy, the Hoard UI (cabinet, filters, detail card with the live squishy), empty and error states, accessibility | 14 to 17 days | P0 (the stage and body); species icon helper | Practice-only Hoard playable by a guest, probes C01 to C10, UI checks U01 to U09 |
| **P3** | Capsule table (up to 5), open, restock, tasks, the ceremony calls (result first), haptic and sound hooks | 3 to 4 days | P2, render and audio ceremonies | A guest can play the full practice loop, including a merge of ghosts |
| **P4** | Server mint: migration (tables, helpers, commit functions, RLS, self-test), the `wh-api` host, vendor and hash probes, the `forgeflow:rpc` bridge in the portal and its deploy | 13 to 15 days | **D-6**; owner applies the migration and deploys the portal | Staging project passes the two suites through PostgREST and the Edge Function |
| **P5** | Integration: `bridge.ts`, `api.ts`, `sync.ts`, the mirror, pending ops, reconcile; first sign-in; sign-out wiping; the real Hoard | 7 days | P3, P4 | A signed-in player earns, opens, restocks and completes tasks; closing the tab never loses or doubles an item |
| **P6** | MERGE: shared `oddsDigest`, host `wh_merge` and `wh_tidy`, pad UI, last-copy modal, hold, ceremony wiring, Tidy-up | 9 to 11 days | P4, P5 (the pad UI can start in P2 on ghosts) | Section 10 of MERGE.md green |
| **P7** | TRADE: friend codes, shelf, board, proposals, review screen, inbox, block and report, emotes, handle lists | 30 to 40 days | P4, P5; **D-5** to turn trading on for anyone but testers; D-8 word lists | Section 18 of TRADE.md green on staging through PostgREST; UI checks; trading enabled for allow-listed adults only |
| **P8** | Hardening and ops: hourly conservation job with auto-freeze, admin recall function, per-account call rate limit, in-migration self-test blocks, load test, portal-rendered trade confirm (H1) | 10 to 14 days | P6, P7 | Freeze drill done; recall drill done; load test results recorded |
| **P9** | Closed beta with allow-listed adults (2 weeks), aggregate telemetry, **measure the real minutes per capsule and the real trade share**, retune `capsuleCost` and the levers of TRADE.md section 2 if needed | 2 weeks calendar | P8 | A written report against DESIGN risks 5 and 6 |
| **P10** | Open launch gates: D-3 clearance, D-5 age and consent, privacy page and terms updated, counsel review, the pre-existing portal exposures (D-13) fixed | owner and counsel | P9 | Signed off |
| **P11** | Seasons: 4 to 6 new species every 8 weeks, append-only (DESIGN risk 3); one `wh_species` row, one catalog entry, one probe lock entry each | ongoing | P10 | |

**Total engineering before the beta: about 96 engineer-days (range 85 to 115) [U]**: P2 15 + P3 3.5 + P4 14 + P5 7 + P6 10 + P7 35 + P8 12. With two engineers (one on the client, one on the server and ops) about **10 to 12 calendar weeks**, plus the beta. **The critical path is D-6, P4, P5, P7, P8, the beta.** P2 and P3 need no server and can start now.

## 3. Decisions only the owner can make

| # | Decision | Options and my recommendation | Blocks | If no answer |
|---|---|---|---|---|
| **D-1** | **Merge cost 2 or 3.** | Keep **2** (DESIGN 5.6: 3.1 to 3.8 minutes per capsule is the "decent effort" band; at the chosen 100 SP meter, 3 fails the "a mergeable set in the first one or two sessions" target: 36.6 minutes against 10.4 to the first mergeable set). Flip only if a playtest measures 1.5 minutes or less per capsule, or the meter changes too. **The flip costs one line, seven probe edits, a config row and a host redeploy: [MERGE.md section 8](MERGE.md), checked in a scratch copy.** | Nothing now | Stays 2 |
| **D-2** | **Should trade be mandatory for completion?** | Today it is not: a solo player finishes in about 205 days against 131 with trading (1.56x at the median), and trade supplies about a third of Epic+ first copies. The levers that could change that (account exclusives, version groups, gift species, and others) and their costs are in [TRADE.md section 2](TRADE.md). **None is adopted.** Recommendation: ship as designed, measure the real trade share in the beta, then decide. Any lever excludes players who cannot trade (age gate, no friends, no sign-in), so decide D-5 first. | The design of P7 only if a lever is chosen | Not mandatory |
| **D-3** | **Name clearance.** | A trademark and domain search on the title **WOBBLEHOARD** and all 50 species names (DESIGN section 9 requires it before release; `probe_catalog.ts` only checks against a built-in denylist, which is not a legal search). **I cannot do this with the tools I have.** Recommendation: before any art or marketing spend; a working title is fine for the beta. | Public launch, store listings | The title stays "working" |
| **D-4** | **Account requirements.** | Real squishies need a server account. **(a)** the existing portal accounts (email sign-up, Google): works today, but needs an email address, which is the child-privacy question (D-5). **(b)** Supabase anonymous sign-ins [G: supported by Supabase Auth, not used by the portal today]: a player gets a real account and a real Hoard with **no email**, can collect and merge, and trade stays off (the database default) until the account is linked to a verified identity; weaker against multi-accounting (clear storage, new account) but safe because trade is gated. **(c)** guests stay practice only. Recommendation: **v1 = (a) and (c)**; evaluate (b) after the beta, because it changes the portal. | P4's account story, P5's first-sign-in flow | (a) and (c) |
| **D-5** | **Age gating and consent for trading.** | The portal has no age field and no parental flow [R]; its privacy page says "No account creation is required to play games" and "We do not knowingly collect personal information from children under 13" [R] while real items need an account. Options in [TRADE.md 16.3](TRADE.md): **A** closed beta, trading switched on by hand for named adults; **B** a neutral age screen at portal sign-up with trading for 13+ (or 16+); **C** verifiable parental consent via a third party; **D** adults only. **Recommendation: A for the beta, and C if children are the audience.** Needs the owner and counsel; I am not a lawyer. | Any trading by anyone who is not an allow-listed tester; the launch | **A** (trading off by default) |
| **D-6** | **Server hosting and cost.** | The logic is TypeScript and must run the game's own modules verbatim. Options: **(a) a Supabase Edge Function** (recommended: same project, JWT verified by the platform, no new vendor); **(b)** a Cloudflare Worker (the repo already deploys `workers/games-cdn` with wrangler) calling PostgREST with the service key: **no SQL change**; **(c)** port to PL/pgSQL with golden vectors (not recommended: drift risk). **Cost formula [G, unverified plan limits]:** Edge invocations per month = daily active players x sessions a day x (minutes per session x batches per minute + about 10 other host calls) x 30. With a 45 second batch (1.33 a minute) and one 20 minute session: 37 calls per player-day, so **1,000 daily players is about 1.1 million a month and 10,000 about 11 million**; the free plan allows 500,000 and the Pro plan includes 2,000,000 [G]. Plain `rpc` calls (inbox polling at 1 a minute, reads) are not Edge invocations. **Storage measured on the scratch database [V]:** an item costs about **225 bytes with indexes**, a ledger row about **318 bytes**; at 331 items a player (the sim's week-9 mean [S]) that is about **200 KB per player**, so 1,000 players are about 200 MB and 100,000 about 20 GB [U: random test data, no compression]. I do not know which Supabase plan the `qkid` project is on. | P4 | Edge Function |
| D-7 | **Trade numbers.** | Daily cap 3 (the sim value; DESIGN says "raise to 5 as headroom"), pair cap 1, lock 24 h, gate 2 days and 10 capsules, offer shelf 12, friends 30, live offers 3 and 10. All are config or constants. Recommendation: ship as written, review in the beta. | Nothing | As written |
| D-8 | **Handle word lists.** | 64 adjectives and 64 nouns (plus a server number): content only the owner can approve; **all 4096 combinations must be reviewed** (a probe checks them against a language-safety list as the species names are). | P7's handle picker | Placeholder lists in the beta |
| D-9 | **Telemetry.** | Aggregate-only play timing and trade share (no user id in the aggregate): needed to re-measure the 3.1 minutes a capsule (DESIGN risk 5). Recommendation: yes, aggregate only, 13 months. | P9 | None collected |
| D-10 | **Portal-rendered trade confirm (H1)** before an open launch to children | Recommended (TRADE.md 12.6): a compromised game build cannot confirm a trade without a human click in the portal. 3 to 5 days of portal work. | P10 | Not built |
| D-11 | **Day boundary** | UTC (what `meter.ts` does) or another fixed offset, for the meter cap, restock, tasks and the merge cap. A non-UTC player sees a mid-day reset. Recommendation: UTC for v1; one constant to change later. | Nothing | UTC |
| D-12 | **Welcome grant for guests who sign in** | Up to 3 capsule credits for 3 practice capsules opened, once per account (COLLECTION 6.3). Saves about 5 minutes; one more commit function. Recommendation: no. | Nothing | None |
| D-13 | **Pre-existing portal exposures** | `profiles` is world-readable (including `is_online`, `current_game_slug`, and a `username` that may be the start of an email address); `friendships` policies let a user forge an accepted friend row; `find_users` searches by email. None is WH's to fix, all matter for children. Recommendation: fix before any child access, separately from this work ([TRADE.md section 17](TRADE.md)). | P10 | Left as is |
| D-14 | **Merge cap and Tidy-up defaults** | Cap 10 merges a day (it counts merges, so at M = 3 up to 30 items a day); Tidy-up defaults to Common and Uncommon and never touches shelved items (MERGE.md M-4). | Nothing | As written |

## 4. Risks worth watching (beyond DESIGN section 10)

1. **Everything rests on assumed behaviour** (DESIGN 5.12); the beta must re-measure minutes per capsule and trade share before any retune.
2. **The server key is the trust root.** A leaked service key can mint anything. Keep it in the function's secrets; rotate it; consider a dedicated database role limited to the `wh__*` functions (H2).
3. **A compromised game build can act as the player** through the bridge, including confirming trades (H1 is the answer).
4. **Multi-accounting** is the real macro risk: every account is a new 12-capsule stream. The controls are the trade gate and caps, not the meter.
5. **The world-readable portal tables** (D-13) leak more about a child than WH ever will.
6. **The sim's trade ratio (1.5 to 1.7x) is a hard ceiling** of the current catalog (DESIGN 5.8): owner expectations of "required" need a decision (D-2), not more code.
7. **Per-lane file ownership:** `core/save.ts` and `core/genome.ts` need the additive `'restock'` origin; the shell lane owns `save.ts` (COLLECTION 3.5).

## 5. Stretch modules from the reference clips (NOT in v1)

None of these is built or scheduled. Each is a paragraph on how it would sit on what exists; sizes are [U].

**Jelly Lab: split and rejoin (clip 2: "translucent jelly that stretches, divides, reconnects").** The soft body is about 640 particles with edge-distance constraints (compliance from `genome.stretch`), one global volume constraint, shape matching toward the rest shape, and a two-finger `grab` that attaches a Gaussian patch of vertices to a target. A cheap path that reuses all of that: let a long pull *pinch off* by giving edges a break strain (the per-vertex `strain[]` array is already exposed), partition the vertices into two clusters at the neck, and give each cluster its own volume target and shape-matching goal; rejoin by welding the nearest vertices when the halves meet. The expensive path is real mesh surgery into two closed bodies (`SoftBody.split(plane)`). Either way it needs per-cluster volume and shape matching (today there is one cluster), new fuzz coverage for mesh inversion at the neck (the existing `verify_phys_fuzz` is the template), and stays a cosmetic lab mode: no genome change, no economy, no server. Size L, 10 to 15 days, most of it physics stability.

**Fold into a glowing ball as a charge animation (clip 2: "fold into a glowing ball, then spring back").** The merge ceremony already uses the optional solver members `setFold(t)`, `moveTo`, `tremble(amp)` and `burstOpen(strength)` (`contracts.ts`), the stage's tier FX and `audio.mergeStart`. A standalone "charge" is the same drivers fed by `meterFill`: the squishy folds a little more as the meter nears full, trembles, and springs open as the capsule drops, with colour from `TIER_STYLE` and `genome.coreHue`. It adds no economy, only presentation, and must obey the flash budget and Calm effects (DESIGN 6.6). **One design tension to resolve first:** folding the body interrupts touching, and DESIGN 6.2 says the meter-full cue must not interrupt touch, so the charge would have to be a small glow and ring, not the whole body, while the player is touching. Size S to M, 3 to 5 days, mostly tuning and QA.

**Mix-and-match trait rail (clip 1: the mix-and-match row).** The genome already has the traits a rail would edit (`PATTERNS`, `EYE_STYLES`, hue, core hue, glitter, size, eye spacing, quantised to 1/255 by `quantizeGenome`) and the catalog's per-species `bands` say how far a look may move before a species stops being recognisable. Editing the genome itself would destroy the "every instance is unique" and "share string is look-only" rules, so the safe design is a **cosmetic overlay** stored beside the item (`wh_items.cosmetic jsonb`) with each field validated against fixed lists and ranges (no free text), applied by the renderer, and kept out of `genome_code` and out of trade parity (tier is by species). Unlocks would be the fixed cosmetic rewards DESIGN 5.11 already promises for finished rows. The trade review screen would show the overlay as part of the exact look. Size M, 6 to 8 days (UI and server validation), plus an owner decision on whether cosmetics travel with a traded item.

**Six-input bulk blender (clip 1: "combines up to six into a hybrid").** DESIGN defers it; Tidy-up is its only descendant. Much of the machinery exists: `mergeOddsCore` and `mergeDrawCore` are generic over integer species handles and are already used by the sim for hypothetical rosters (the sim has a `mergeInputs` setting), `lineageGenome(template, parents[], seed)` already accepts any number of parents, `audio.blend({count, durationS})` exists in the slice, and the server pattern (host, odds digest, commit function) is the one in MERGE.md. What is new is **the rules, not the code**: how mixed species and tiers combine into a tier-up chance, how to keep a six-input blend from being a cheaper route to Epic and above than the drop (DESIGN 5.8 shows merge-only routes only roughly match a drop for Rare and above), and whether it is the supply sink DESIGN 5.9 says merge is not (merge removes only 2 to 3% of supply). That needs a sim extension and an anti-laundering review before any build, then a `wh_blend` host operation and commit function, a UI for placing up to six inputs, and a ceremony beat sheet (the render lane clamps merge ceremonies to 2 or 3 parents today). Size L, 15 to 20 days including the sim work.

## 6. What this lane did not do

No code under `src`, `_harness` or `supabase/migrations`; nothing deployed; no trademark or legal search; no real-Supabase run; no UI. The 3 stale references I found outside my files (DESIGN 7.2 still names `src/core/catalog.ts` and `economy.ts`; `CONTRACT.md` lines 5 and 27 still say `BLEND.md`) are listed in the final report for the owner of those files.
