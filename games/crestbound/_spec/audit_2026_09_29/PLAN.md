# CRESTBOUND — plan to reach the house standard and the Super Mario 64 bar (2026-09-30)

Sources: `standard_dyefield.md`, `standard_blocktooth.md`, `gap_crestbound.md`, `sm64_bar.md` (this folder).
The planning agent died on a usage limit; this plan was written by the orchestrator from those four reports.

## Verdict

Against Super Mario 64 the game scores about **4.8 / 10** (mean of 11 dimensions, `sm64_bar.md`).
Movement (6), juice (7) and UI (7) are near the bar. What is far from it is **variety and character**:

- 4 enemy types for 13 courses (SM64 has 45); the same 3-hit Warden is the boss of 11 of 13 courses.
- The identical 7-crest template in every course, and no mission select — the level never changes per crest.
- Nim has 34 animations and a synth blip for a voice (Mario: 193 animations, 44 voice clips); one NPC.
- 5 procedural music beds for 14 spaces; no recorded themes.
- Courses teach with signboards instead of with play; the hub's 60-crest door opens nothing.

## The re-platform decision: NO full port now — adopt the standard in place

The case for moving to TypeScript + Vite + Rapier rested on "the hand-written physics causes the bugs".
Measured, it does not: 83 of 315 playtest defects have a physics symptom, but only **13 (4%)** trace to the
resolver itself and only **3 are still open**. 32 are gameplay rules layered on physics (carry, push,
crush, currents, buoyancy) that Rapier does not provide — a port would rewrite and re-risk all of them —
and 32 are authored geometry, which no engine fixes. DYEFIELD and BLOCKTOOTH also never ran movers,
rotors, crushers or swimming on Rapier. So: take Rapier where it wins immediately (the camera's swept
sphere — camera is 32 defects, the largest open class), adopt the other standards in place, and leave a
full TS + Vite port as a later, mechanical step.

## Stages

| stage | what the player gets | touches | proves it done | parallel |
|---|---|---|---|---|
| **1 · systems for variety** | new enemies and realm bosses exist; Nim can punch, kick, grab ledges, pick up and throw, talks, and animates far more; mission select changes the level; a camera that never clips; real music per realm | entities/**, player/hero.js + controller.js + core/voice.js, course.js mission layer + coursecard + save + game.js mission flow, camera.js + vendored Rapier, audio.js music + state/music_assignments.json | modulecheck, feelcheck (feel numbers unchanged), camcheck, loopcheck, bootcheck, a test arena per new creature, frames read | 5 lanes |
| **2 · content per realm** | every course gets its own enemies, its realm boss, bespoke crest missions, talking NPCs, and teaches by terrain instead of signboards | runtime/data/courses/<realm>-*.js | reachcheck, loopcheck, a real-key playtest per course, frames read | 4 lanes (one per realm) |
| **3 · standards in place** | fewer bugs and a steadier frame | sim/view split with one fixed tick, headless course bots (closes the 70 untestable defects), a geometry lint, `checkJs`, BLOCKTOOTH's frame profiler, boot guard, gamepad in play | the new gates themselves + every old gate | 3–4 lanes |
| **4 · ship** | live on the CDN with an xAI cover | deploy | every gate, live boot check | — |

## Out of scope (and why)

- **The Keep redesign** — the owner said to skip it for now. The hub finale waits with it.
- **A full TS + Vite port** — not justified by the defect data (see above); a later mechanical step.
- **Changing Nim's acceleration curve toward SM64 momentum** — the audit flags it, but it would move the
  measured reach envelope every course is authored to. A separate, A/B'd experiment later.
