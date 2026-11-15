> **HISTORICAL DOCUMENT (banner added 2026-06-10).** Superseded by the live design: ONE-GAME policy (single journal to M5 DONE; parked blocks promotions), claude -p prompts via STDIN (WinError 206 fix), XCOM detached from the nightly, legacy Phaser path quarantined behind FFG_ALLOW_PHASER=1. Current truth lives in v2_pipeline.py + engine_authoring.py docstrings and forgeflow-engine/ENGINE_GAME_API.md.

# FFG Pipeline Audit — vs. the professional game-dev process

Honest gap analysis after the first live autonomous run (2026-05-29) exposed that
verification had been done against hand-authored content, not real generator output.
Maps the v2 pipeline to the stages a professional studio actually uses, grades each,
and lists what's fixed vs. still missing.

Grades: **A** solid / **B** works, gaps / **C** partial / **D** missing.

| # | Pro stage | What a studio does | FFG v2 today | Grade |
|---|---|---|---|---|
| 1 | **Concept** | Pitch, genre, hook, references, target audience | `master_list.json` (140 refs, rated 80%+) + `build_queue` briefs | **A** |
| 2 | **Pre-production** | GDD, technical design, engine choice, vertical-slice plan | `registry.json` (genre→engine), typed `content.schema` (the contract), `ARCHITECTURE.md`. **Gap:** no per-game design doc / tech-design generated | **B** |
| 3 | **Prototype / vertical slice** | Prove the core loop + signature mechanic before content | `build_order` slice-first + **signature gate** blocks until the defining mechanic works. Our strongest stage. | **A−** |
| 4 | **Production** | Build content, systems, assets, audio | Expand step + `assemble`. **Gaps:** no audio/SFX for 3D; no per-game art-direction beyond stock; asset-coherence gate not in v2 (moot for data-only genres, needed once a genre generates art) | **C** |
| 5 | **Alpha (feature complete)** | Explicit "all features in" checkpoint | No explicit feature-complete gate; the slice→expand→assemble flow implies it | **C** |
| 6 | **QA / testing** | Functional, compatibility, balance, playtest, soak | contract + signature (**blocking, proven**); feel (Playwright) + fidelity (vision) wired but **soft + not yet proven on a live unattended run**. **Gaps:** no cross-browser in v2 (old pipeline had it), no balance/difficulty tuning, no soak/perf test | **C+** |
| 7 | **Polish / beta** | Game-feel/juice, performance budget, accessibility, localization | 2D kernel has juice helpers; 3D has the cinematic + **real physics (cannon-es)**. **Gaps:** no systematic game-feel metric, no perf budget enforcement, no a11y pass, no localization | **C** |
| 8 | **Certification / release** | Build, store metadata, deploy | `deploy_game.py` → Cloudflare R2, Supabase metadata, portal. Deploy **gated** (staging-only until trusted). **Gap:** no storefront/listing polish pipeline | **B−** |
| 9 | **Live ops** | Telemetry, analytics, patches, player feedback | `sync_to_portal` + **Telegram audit (added)**. **Gaps:** no per-game play analytics/telemetry, no post-launch patch loop, no feedback ingestion | **C** |

## Cross-cutting findings from the first live run (and status)

| Finding | Severity | Status |
|---|---|---|
| **No generation smoke test** — verified with golden content, not generator output, so "model omits title/view" slipped to production | High | **FIXED** — `v2_pipeline.py --smoke <genre>` runs one generate→repair→gate cycle; must run before trusting a new genre |
| **Not self-healing** — marked-failed on a trivially-fixable error instead of fixing + continuing | High | **FIXED** — `build_order.repair()` deterministically fills title/view + moves units off blocking tiles; verified to turn the real failures into clean builds |
| **No transient/content error split** — a network-down run would have marked games failed | High | **FIXED** — `TransientError` aborts the run cleanly (no false-fail); content errors get repair+reflexion |
| **Hand-rolled "physics"** (sine-tween cannonball, tween sink) | Med | **FIXED** — cannon-es rigid-body world in the 3D kernel; ballistic cannonballs + dynamic sinking + debris; verified bodies fall under gravity |
| **Visual verification gap** — WebGL canvas can't be screenshotted headless | High | **FIXED (capture half)** — `gates/capture.py` (Playwright/CDP) reliably screenshots WebGL to a PNG; used it to find + fix Iron Tide's camera framing + ship-scale defects (before/after captures). `fidelity_gate.py --url` now captures then scores. The claude -p vision *scoring* half still needs a live (Task Scheduler) run to prove end-to-end. |
| **No player fleet-placement UX** (battleship pre-places ships) | Med (open) | OPEN — missing core player agency for the genre |
| **No audio/SFX** wired for 3D | Med (open) | OPEN |
| **No balance/difficulty tuning** pass | Med (open) | OPEN — signature gate proves "winnable", not "well-tuned" |
| **No perf budget / accessibility** | Med (open) | OPEN |
| ES-module **cache** can serve stale runtime on same-URL redeploys | Low (open) | OPEN — fresh deploys/users get new files; add `?v=VERSION` busting if it bites |

## The honest bottom line

The pipeline is **strongest exactly where the old one was weakest** — concept→vertical-slice with a signature gate that refuses to ship a fake mechanic. It is **weakest at the back half** a pro studio obsesses over: **automated visual/feel QA, balance tuning, polish, audio, and live telemetry.** The single highest-leverage open item is **proving the vision fidelity gate** so the system can judge "does this look like a real game" without a human — because right now functional correctness is verified end-to-end, but *aesthetic/feel quality is not*, and that's the exact thing that made the old games feel bad.

Priority order to close the gap: (1) prove the vision fidelity gate on a live run; (2) balance/feel tuning pass; (3) audio for 3D; (4) player-agency UX (fleet placement); (5) perf + a11y.
