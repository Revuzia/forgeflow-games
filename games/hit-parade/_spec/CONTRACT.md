# HIT PARADE — build contract (v1)

This file is the spine. Every lane builds against the signatures and formats written here.
Where BRIEF/DESIGN and this file disagree, this file wins for *interfaces*; DESIGN wins for
*intent*. A lane that needs an interface change writes it **here first**, marked
`CHANGED(<lane>): …`, and never breaks an existing signature silently.

Numbers source of truth, in order: this file → `data/system.json` → `_research/FIGHTING_DESIGN.md`
(frame-data templates §1b/§1c, systems §2-§4, camera §7, CPU §10) → `_research/NETCODE.md`.
Research files are evidence; `data/*.json` is what the game reads.

## §0 Ground rules

- **Own your files only (§14).** Never edit another lane's files. Need something? Depend on the
  signature here and say so in your final report.
- **THREE-free core:** `runtime/src/core/**` never imports `three`, never touches the DOM, never
  reads a clock. It runs under plain `node` (Node 22.20 type stripping) exactly as in the browser.
- TypeScript: `erasableSyntaxOnly` (no `enum`, `namespace`, parameter properties); relative
  imports **with `.ts` extensions**; JSON via `import x from '…json' with { type: 'json' }`.
- **Determinism (NETCODE.md rules, binding):** no `Math.random`, `Date`, `performance.now` in
  core; all sim state lives in ONE preallocated `Int32Array` (§4.2); integer math in the sim
  (fixed-point, §2); no iteration over object keys / Maps / Sets whose order can differ; no
  floating-point in anything that decides gameplay; RNG = `core/rng.ts` mulberry32 with its seed
  and cursor stored IN the state array.
- **No primitive hero assets.** Boxes/capsules only as debug overlays behind `?dev=1`.
- **Owner rules:** NO PIRATES (no pirate framing, bodies, props, nautical theming). Comic red
  splatter with a settings toggle (sparks/confetti). No realistic gore, no dismemberment.
- Verification is at the player's layer: real key/mouse/touch events in real Chrome, pixels read
  back. A teleporting harness is not a playtest. Look at every screenshot you cite.
- Windows: utf-8 on every subprocess. Never run `claude -p`. One headed Chrome at a time for perf.
  Dev servers started by lanes use `HP_FROZEN=1` (no HMR) on the lane's assigned port (§14).
- Files you write under `runtime/`, `data/`, `art/`, `tools/`, `_harness/` are ASCII or UTF-8
  without BOM, LF line endings.

## §1 What we are building (summary — DESIGN.md has the intent)

A 3D-rendered **2.5D versus fighting game** (SF6-style single fight plane) in a live-TV-show skin.
Modes: THE SEASON (arcade: 8 bouts incl. RIVAL, MINI BOSS, BOSS, 2 BRAWL BREAK bonus rounds;
PILOT = 5 bouts), VERSUS (local 2P / vs CPU), ONLINE (quick match + room code; WebRTC P2P +
rollback), TRAINING. 10 playable fighters + mini boss + boss (bosses unlock after a Season clear).

**Button model (everyone):** four attack buttons **L, M, H, S** plus **ASSIST** (hold), and three
system buttons **THROW** (= L+M), **PARRY** (= M+H), **IMPACT** (dedicated only). Two control
types with identical timing windows:
- SIMPLE: `S`+direction = specials (5S main, 6S approach, 2S anti-air/down, 4S trick/defensive)
  at ×0.8 damage; `S+H` = super (neutral/forward = Lv1, down = Lv3); `ASSIST`+`S`+dir = EX
  (2 NERVE bars); hold `ASSIST` + tap `L` repeatedly = the fighter's auto-combo route.
  Buffer 7 frames early.
- CLASSIC: motion inputs; motion + L/M/H = special at that strength; motion + S = EX;
  236236 + any attack = Lv1, 214214 + any attack = Lv3; charge fighters use [4]6 / [2]8.
  Buffer 4 frames early. (Motion inputs also work in SIMPLE on L/M/H at full damage.)
- Normals per fighter: stand L/M/H, crouch L/M/H (crouch H = anti-air or sweep per fighter),
  air L/M/H, 1–2 command normals (6H overhead or unique), forward/back throw. 9-12 normals.
- Supers per fighter: **Lv1** (1 bar) and **Lv3 "PRIME TIME"** (3 bars, authored cinematic).
- System verbs: walk, dash/backdash (66/44), jump (8/9/7), crouch, block (hold back / down-back),
  PARRY (+perfect parry), IMPACT (armored, wall splat), SHOVE (parry button in blockstun, 2 bars),
  THROW + tech, wakeup (normal / back rise), taunt (S+L+M? no — 5S+hold ASSIST 60f, cosmetic).
- Meters: HP; **SHOWTIME** (3 bars × 10000, super gauge, shown as the RATINGS meter);
  **NERVE** (6 bars × 10000, SF6 Drive analog) → **STAGE FRIGHT** burnout.
- Dropped by design (not in scope, do not build): Drive-Rush cancels from normals (RUSH exists
  only out of a parry), LAST CALL, sidestep, 8-way run, GUTS scaling, Lv2 supers.

## §2 Conventions

- **Axes (runtime/glTF, Y-up):** the fight line is world **X**; +Y up; the camera sits on **+Z**
  looking toward −Z. P1 starts at negative X facing +X. Fighters live at z = 0 (BRAWL BREAK
  goons too — it is on the same line). Blender is Z-up: author forward as Blender −Y → glTF +Z.
- **Model facing:** a fighter GLB faces +Z at rest (Mixamo convention after export). The view
  rotates the root to yaw = +90° (face +X) or −90° (face −X) from `facing` = +1 / −1.
- **Sim units:** 1 sim unit (`U`) = 10 µm → 1 m = 100000 U. Positions/velocities are int32 in U
  and U/frame; gravity in U/frame². Frame = 1/60 s. Angles never appear in the sim.
  `core/sim/units.ts` exports `M = 100000`, `mToU(m)`, `uToM(u)` (the latter only for view/UI).
- **Frame data** is in frames at 60 Hz, SF6 conventions: *startup counts the first active frame*;
  advantage = stun − (active + recovery) (see FIGHTING_DESIGN §1b).
- **Random:** per-system mulberry32 streams; seed + cursor in state.
- **Strings:** ALL user-facing copy in `data/strings.json` (keyed). No literals in UI code except
  debug.

## §3 Layout

```
games/hit-parade/
  README.md package.json tsconfig.json vite.config.ts  .gitignore-block in forgeflow-games/.gitignore
  _spec/      BRIEF.md DESIGN.md CONTRACT.md CONTRACT_MOBILE.md ROSTER.md (kits, lane FIGHTERS)
  _research/  lane evidence (never shipped)
  data/       system.json  stages.json  ladder.json  strings.json  captions.json  cpu.json
              fighters/<id>.json  (stats + moves + anim warps; one file per fighter, §5)
              clips/<id>.clips.json (GENERATED by the asset pipeline, §6 — never hand-edited)
  art/        blender/*.py (headless sources)  gltf/fighters/<id>.glb  gltf/props/*.glb
              gltf/stages/*.glb  renders/ (QA, gitignored)  src/ (pointers/manifests to F:\ sources)
  tools/      build_fighters.py (Blender batch driver)  compress_glb.py  cmu_retarget.py
              clipplan.json (which source clip feeds which fighter clip, §6.2)  research/
  runtime/    Vite root
    index.html   (boot guard adapted from dyefield)
    public/      game_meta.json thumbnail.png manifest.webmanifest icons/
    src/
      main.ts game.ts input.ts testsurface.ts
      app/        loop.ts (blocktooth GameLoop, 60 Hz) flow.ts (mode/screen state machine)
      core/       THREE-free: rng.ts config.ts data.ts
        sim/      units.ts layout.ts state.ts match.ts fighter.ts moves.ts inputs.ts motion.ts
                  hits.ts boxes.ts throws.ts projectiles.ts meters.ts rounds.ts events.ts
                  brawl.ts (BRAWL BREAK goons + wave director) hash.ts
        ai/       cpu.ts (levels 0-8) personas.ts (harness personas) boss.ts
        net/      rollback.ts (session over an abstract transport) sync.ts (time sync, checksums)
      net/        transport_rtc.ts (WebRTC DataChannel) transport_relay.ts (Supabase fallback)
                  netplay.ts (vendored FFG NetPlay: lobby/presence/signalling) online.ts (flow)
      view/       renderer.ts post.ts toon.ts camera.ts fighters.ts anim.ts fx.ts stage.ts
                  crowd.ts cinematics.ts warmup.ts frameprof.ts
      ui/         boot.ts hud.ts broadcast.ts menus.ts menus.css charselect.ts results.ts
                  training.ts movelist.ts settings.ts save.ts styles.css
      audio/      index.ts engine.ts router.ts types.ts manifest.ts(gen) seam.ts voices.ts
                  CREDITS.json(gen) assets/  build/build_audio.py
      touch/      controls.ts touch.css
  _harness/   common.py bootcheck.py bootguard.py playtest.py perfcheck.py mobile.py menus.py
              layoutcheck.py lookshots.py online2.py probe_*.ts  _reports/ (gitignored)
  _shots/     (gitignored)   dist/ (gitignored; the ONLY thing deployed)
```

## §4 Simulation contract (lane SIM)

### §4.1 API (`core/sim/match.ts`)
```ts
export type Scheme = 0 | 1;                       // 0 SIMPLE, 1 CLASSIC
export interface PlayerCfg { fighter: string; color: number; scheme: Scheme; cpu: number /* -1 human, 0..8 */ }
export interface MatchCfg  { mode: 'versus'|'arcade'|'training'|'online'|'brawl'|'heckler';
                             stage: string; seed: number; p: [PlayerCfg, PlayerCfg];
                             rounds?: number /* first-to, default 2 */; timer?: number /* s, default 99, 0 = infinite */ }
export interface Match { cfg: MatchCfg; s: Int32Array; frame(): number; events: EventRing }
export function createMatch(cfg: MatchCfg, data: GameData): Match;
export function step(m: Match, in1: number, in2: number): void;   // advance exactly one frame
export function save(m: Match, slot: Int32Array): void;            // copy state (s.length ints)
export function load(m: Match, slot: Int32Array): void;
export function checksum(m: Match): number;                        // hash32 over the state
export function readFighter(m: Match, i: number): FighterSnap;     // plain snapshot for view/UI
export function readMatch(m: Match): MatchSnap;                    // round, timer, winner, phase...
```
- `in1`/`in2` are 16-bit input words (§4.4). AI produces input words too (CPU never touches state).
- `step` is pure over (state, inputs, data). Same seed + same input streams ⇒ identical checksums
  on every machine (gate G2 `probe_determinism`, G2b `probe_synctest`).
- Budget: `step` ≤ 0.25 ms desktop (2 fighters + projectiles); `save` + `checksum` ≤ 10 µs.

### §4.2 State (`core/sim/layout.ts`)
- One `Int32Array`. `layout.ts` declares every field as a named offset (generated by a tiny
  builder: `field('hp')`, `array('inHist', 64)`), exports `STATE_INTS`, `F` (fighter block
  offsets, stride `FIGHTER_INTS`), `P` (projectile block, stride `PROJ_INTS`, capacity 12),
  `G` (goon blocks for BRAWL, capacity 8), `W` (world: frame, round, timer, rng cursors, phase,
  hitstop counters, slowmo, camera-cue ids, events cursor).
- Versus state ≤ 4 KB (1024 ints) hard cap; target 2 KB. BRAWL/HECKLER state may exceed it
  (offline only).
- Per fighter at minimum: x, y, vx, vy, facing, state enum, stateFrame, moveId, moveFrame,
  hitstop, stun (hit/block), hp, greyHp, greyDelay, showtime, nerve, stageFright, comboCount,
  comboScaleStep, juggleCount, knockdown kind, wakeupKind, invuln flags + timers, armor hits,
  charge timers (back, down), input history ring (32 frames × 1 int), buffered action + age,
  throw-tech window, parry window/perfect frames, cancel flags, hitThisMove bitmask,
  lastHitBy, counterFlag, anim cursor (animId, animFrame, prevAnimId, prevAnimFrame, blendT),
  roundWins, flags (assist held, taunting, stance id, install timers), per-fighter unique ints
  (4 slots: e.g. Gazza ball state, Lotus stance, Krane shield).

### §4.3 Systems (all numbers from `data/system.json`, seeded from FIGHTING_DESIGN.md)
Implement exactly, each with a probe (G2):
1. Movement: walk f/b (per-fighter), first walk frame ¼ speed, dash/backdash (66/44 detection:
   first tap ≤8f, gap ≤8f), jumps (4 prejump + air + 3 landing; per-fighter arc), crouch,
   facing auto-flip when not in an action (cross-ups flip after the pass), separation cap 6.0 m
   (camera wall), stage walls at ±8.0 m (corner). Body push-box collision (no overlap).
2. Moves from data (§5.2): startup/active/recovery, hitboxes per frame range, hurtbox extensions,
   authored forward movement (`move` curve), cancel windows (chain/special/super), target combos.
3. Hit resolution per frame: strike vs hurtbox, throw vs throwable, projectile vs projectile
   (clash, both destroyed) and vs hurtbox; **trades** (both hit, both counter-hit); counter-hit
   (+2 f, +20%) and punish counter (+4 f, +20%); strike beats throw on the same frame.
4. Blocking: hold back (stand: H/M, crouch: M/L), overhead/low guard, proximity guard, auto-guard
   inside true blockstrings for mids/highs, blockstun, pushback (corner transfer to attacker).
5. Hitstop per strength (sim frame counter; both frozen; buffered inputs don't age), hitstun,
   blockstun, knockdowns (soft/hard), wakeup (normal/back rise; hard KD forbids back rise),
   juggles (JS/JI/JL integers; 1 wall splat + 1 ground bounce per combo), crumple.
6. Damage scaling (SF6 table, light-starter variant), super minimums 30%/50%, grey HP rules.
7. Meters: SHOWTIME gain/spend (SF6 gain table; no gain on whiff; defender gains), NERVE regen/
   costs (parry, IMPACT, EX 2 bars, SHOVE 2 bars, RUSH from parry), STAGE FRIGHT (ends only when
   NERVE is completely refilled; +4 blockstun, 25% chip from specials/supers, corner IMPACT stun
   195 f on hit or block).
8. Defense verbs: PARRY (holdable, frame-1, perfect window 3 f → 60-frame freeze), RUSH out of
   parry, IMPACT (26 f, 2-hit armor, wall splat near corner, IMPACT vs IMPACT clash + refund),
   SHOVE (from blockstun), THROW (5 f, 0.60 m default, 9-frame tech, punish-counter throws +70%
   and unbreakable, throw loses to strikes on the same frame).
9. Inputs (§4.4): SOCD cleaning happens in the INPUT layer before the word is formed; the sim
   parses motions from its own stored history (QCF/QCB 11 f, DP 11 f + 323/6236 shortcuts,
   HCF/HCB 12 f, 360 32 f, 236236/214214 20 f, charge 45 f keep 10 f), priority order EX >
   super > DP > QC > HC > other specials > throw/parry/impact > normals, negative edge for
   specials/supers, buffers (4/7 early; dash 7; wakeup 10), hold-to-buffer in freezes.
10. Supers: super freeze (fixed frames, timer frozen), Lv1 move, Lv3 = cinematic sequence of
    fixed length (`cinematic.frames` in data) during which both fighters are sim-locked and the
    damage is applied on authored frames; camera cue id written to state for the view.
11. Rounds: intro (fixed frames), FIGHT, 99 s timer (1 per 60 frames, frozen during cinematics
    and after KO), KO sequence (KO hitstop 30 f, slow-mo = physics every 4th frame for 45 frames,
    deterministic), time-out verdict (strict HP fraction; exact tie = draw; ARCADE last-round tie
    = CPU wins), first to `rounds` (default 2), max 5 rounds, meters carry (SHOWTIME) / reset
    (NERVE full, HP full), match end.
12. Projectiles: per-move spawn (speed, lifetime, hits, strength, box, destroy rules), clash,
    screen-edge despawn, per-fighter limit (1 unless data says otherwise).
13. Fighter uniques (§5.3 `unique`): stance (Lotus), charge (Krane), ball object (Gazza), counter
    stance (Rerun), armor steps (Bruno/Boneyard/Freak), teleport (Zambini), boss phases (Ricky).
14. BRAWL BREAK (`mode:'brawl'`, offline): 1 player fighter vs waves of studio goons (up to 4
    active, both sides of the line), goon kits = 3 shared simple moves, attack tokens ≤ 2,
    45 s, score only; HECKLER TOSS (`mode:'heckler'`): objects thrown from the crowd along
    arcs, parry = score (perfect ×2), hits cost score; 40 s.

### §4.4 Input word (16 bits, built by `input.ts` / touch / gamepad / AI / net)
`bit0 UP, bit1 DOWN, bit2 LEFT, bit3 RIGHT` (screen-relative, already SOCD-cleaned: L+R =
neutral, U+D = neutral) · `bit4 L, bit5 M, bit6 H, bit7 S` · `bit8 ASSIST` · `bit9 THROW
macro` · `bit10 PARRY macro` · `bit11 IMPACT` · `bit12 TAUNT` · bits 13-15 reserved (0).
The sim converts LEFT/RIGHT to back/forward using `facing`. Chords: L+M pressed within 2 frames
= THROW, M+H within 2 frames = PARRY (the macro bits are equivalent).

### §4.5 Events (`core/sim/events.ts`)
Ring of 64 events, each `{frame, type, a, b, c, d}` ints written during `step`. Types (enum-like
`const EV = {...} as const`): ROUND_INTRO, FIGHT, HIT, BLOCK, PARRY, PERFECT_PARRY, THROW,
THROW_TECH, WHIFF, COUNTER, PUNISH, KNOCKDOWN, WAKEUP, WALL_SPLAT, GROUND_BOUNCE, CRUMPLE,
PROJ_SPAWN, PROJ_HIT, PROJ_CLASH, IMPACT_START, IMPACT_ARMOR, IMPACT_CLASH, SHOVE, SUPER_FREEZE,
SUPER_HIT, CINEMATIC_START, CINEMATIC_END, STAGE_FRIGHT_ON, STAGE_FRIGHT_OFF, KO, TIMEOVER,
ROUND_END, MATCH_END, METER_BAR (a bar filled), TAUNT, CAMERA_CUE, SFX_CUE (fighter-authored
sound cue from move data), GOON_SPAWN, GOON_DOWN, HECKLE_THROW, SCORE.
Consumers (view/audio/ui) dedupe by `(frame,type,a,b)` because rollback re-emits events.

### §4.6 Snapshots
`FighterSnap` = {x,y (metres float), facing, state, moveId, moveFrame, animId, animFrame,
prevAnimId, prevAnimFrame, blendT, hp, hpMax, greyHp, showtime, nerve, stageFright, combo,
hitstop, flags: {invuln, armor, counter, stance, taunting, ko}, unique[4]}. `MatchSnap` =
{frame, phase, round, timer (s), wins:[a,b], cinematic:{active, fighter, cueId, frame},
winner, slowmo}. Snapshots are the ONLY thing view/UI read from the sim.

## §5 Data contract (lane FIGHTERS writes fighters; lane SIM writes system.json)

### §5.1 `data/system.json`
All universal numbers: hp default, timer, rounds, walk ¼-speed rule, dash detection, jump
template, buffers, motion windows, hitstop/hitstun/blockstun tables, counter bonuses, scaling
tables, super minimums, SHOWTIME gains/costs, NERVE regen/costs, STAGE FRIGHT rules, parry/
perfect parry/IMPACT/SHOVE/throw numbers, pushback table, stage walls ±8.0 m, separation cap
6.0 m, round-start distance 2.40 m, KO sequence, CPU level table (or `cpu.json`).

### §5.2 `data/fighters/<id>.json`
```jsonc
{
  "id": "johnny", "name": "JOHNNY RIOT", "persona": "The Headliner", "archetype": "shoto",
  "body": "Ch42_nonPBR", "heightM": 1.80, "hp": 10000,
  "walk": {"fwd": 2.12, "back": 1.44}, "dash": {"fwd": 1.06, "back": 0.68, "fwdFrames": 18, "backFrames": 23},
  "jump": {"prejump": 4, "air": 38, "landing": 3, "apexM": 1.59, "fwdM": 1.43},
  "throwRangeM": 0.60, "hurt": {"stand": [w,h], "crouch": [w,h], "air": [w,h]},   // metres, fighter-local
  "pushbox": [w,h],
  "colors": [ { "name": "Headliner", "tint": null }, { "name": "Rerun", "tint": "#..." } ],
  "moves": { "<moveId>": Move, ... },          // every normal/special/super/throw/system anim
  "simple": { "5S": "brickbat_m", "6S": "hook_m", "2S": "encore_m", "4S": "weave", "S+H": "sold_out", "S+H+2": "main_event", "assist": ["2L","5M","hook_m"] },
  "classic": [ { "motion": "236", "btn": "LMH", "move": "brickbat_{s}" }, ... ],
  "unique": { "kind": "none" },                // or stance/charge/ball/counter/teleport/phases
  "intro": "intro_clip", "win": ["win1","win2"], "taunt": "taunt", "rival": "boneyard",
  "stage": "rust_theater", "cpu": { "style": "balanced" }
}
```
`Move`:
```jsonc
{
  "kind": "normal|command|special|ex|super1|super3|throw|cmdgrab|projectile|system",
  "input": "5L",                 // canonical notation, informational (routing lives in simple/classic)
  "startup": 5, "active": 3, "recovery": 9,
  "damage": 300, "chipPct": 0, "hitstop": 9, "hitstun": 15, "blockstun": 10,
  "guard": "HL|H|L|U",           // HL = blockable either way; H overhead (stand only); L low; U unblockable
  "boxes": [ { "f": [5,7], "x": 0.55, "y": 1.35, "w": 0.45, "h": 0.25 } ],  // metres, fighter-local, x forward
  "hurtExt": [ { "f": [5,16], "x": 0.45, "y": 1.35, "w": 0.35, "h": 0.25 } ],
  "move": [[0,0],[5,0.10],[16,0.12]],        // metres forward vs frame (piecewise linear), from clip root motion or authored
  "pushback": {"hit": 0.27, "block": 0.27},
  "cancel": ["chain:5L","special","super"],   // what may cancel this move during hit/block (not whiff unless "whiff")
  "juggle": {"js": 0, "ji": 1, "jl": 0},
  "onHit": {"kd": "none|soft|hard", "launch": [vx_mps, vy_mps], "wallSplat": false, "groundBounce": false, "crumple": false},
  "gain": {"showtime": 300, "nerveCost": 0},
  "cost": {"showtime": 0, "nerve": 0},
  "invuln": {"strike": [a,b], "throw": [a,b], "air": [a,b], "proj": [a,b]},
  "armor": {"hits": 0, "f": [a,b]},
  "projectile": { "speed": 6.0, "life": 90, "box": [0.4,0.35], "y": 1.2, "hits": 1, "strength": "M", "clip": "brick" },
  "cinematic": { "frames": 150, "cue": "johnny_main_event", "hits": [[30,600],[60,600],[120,3300]] },
  "anim": { "clip": "boxing_jab_r", "warp": [[0,0.00],[5,0.18],[8,0.26],[17,0.60]] },   // sim frame -> clip seconds
  "sfx": [[5,"whoosh_l"]]
}
```
- `anim.clip` MUST exist in `data/clips/<id>.clips.json` and in the fighter GLB (gate G1).
- `anim.warp` maps sim frames to clip seconds piecewise-linearly; the **startup frame must map to
  the clip's contact time** (from clips.json `contact`), so the pose at first-active = impact pose
  (doctrine: view strike frame aligned to the sim).
- Hitboxes default from clips.json `effector` at contact (§6.3) and are then tuned by hand.
- Frame data starts from the FIGHTING_DESIGN §1b/§1c templates; deviations are per-kit decisions
  recorded in `_spec/ROSTER.md` with the reason.
- Shared system anims (hit reactions, block, knockdown, wakeup, thrown, crumple, wall splat,
  dizzy, KO, time-over) are named identically for every fighter (§6.2) and are NOT listed in
  `moves`; the sim picks them by state.

### §5.3 Uniques (`unique.kind`)
`stance` (Lotus: enter via 214/4S, 3 follow-ups, exits), `charge` (Krane: [4]6 and [2]8 in
CLASSIC; SIMPLE uses S+dir), `ball` (Gazza: one ball entity with physics — kicked shot, wall
rebound, keepy-uppy hover; stored in the projectile block), `counter` (Rerun: PLAY DEAD catches
strikes f4-20), `armorStep` (Bruno/Boneyard/Freak), `teleport` (Zambini), `phases` (Ricky: phase
2 at < 50% HP, persists for the bout). Each unique has a probe.

### §5.4 Roster (bodies from `_research/characters/ROSTER.md`; kits detailed in `_spec/ROSTER.md`)
| id | name | body (Mixamo file) | archetype | HP | home stage | rival |
|---|---|---|---|---|---|---|
| johnny | JOHNNY RIOT | Ch42_nonPBR | shoto boxer | 10000 | rust_theater | boneyard |
| patch | PATCH | Eve By J.Gonzales | rushdown kickboxer | 9500 | rooftop | spin |
| bruno | BRUNO "THE FRIDGE" | Brute (hide BattleAxe_GEO) | grappler | 11000 | butcher_block | krane |
| zambini | THE GREAT ZAMBINI | Whiteclown N Hallin | zoner magician | 9500 | wheel_of_pain | gazza |
| krane | OFFICER KRANE | Swat | charge, shield+baton | 10000 | control_room | bruno |
| lotus | LOTUS LIU | Kachujin G Rosales (hide bow bones' meshes if any) | stance drunken fist | 9500 | wheel_of_pain | rerun |
| boneyard | BONEYARD | Ch05_nonPBR | big body cleaver | 10500 | butcher_block | johnny |
| spin | SPIN | Ch06_nonPBR | aerial breakdancer | 9500 | rooftop | patch |
| gazza | GAZZA | Ch08_nonPBR | setplay footballer | 10000 | rooftop | zambini |
| rerun | RERUN | Prisoner B Styperek | counter zombie | 10000 | rust_theater | lotus |
| freak | THE FREAK (mini boss) | Mutant (repaint chest number) | armored monster | 11500 | butcher_block | - |
| ricky | RICKY MARQUEE (boss) | Ch40_nonPBR | two-phase showman | 13000 | control_room | - |

## §6 Asset pipeline contract (lane ASSETS)

### §6.1 Per-fighter GLB — `art/gltf/fighters/<id>.glb`
- Built headless by `tools/build_fighters.py --fighter <id>` (blender.exe directly, logs kept).
- Steps: import body FBX → rename bone prefix `/^mixamorig\d*:/` → `mixamorig:` → hide/remove
  prop meshes (Brute axe etc.) → merge meshes/materials where safe → normalise to `heightM` →
  for each clip in `tools/clipplan.json[<id>]` (+ the shared system set): import source (Mixamo
  FBX on X Bot, or CMU BVH via `tools/cmu_retarget.py`, or a LAYERED bake = lower body from clip
  A + upper body from clip B), **hybrid world-space retarget** (research `rig_compat.md`: body
  bones world-space delta, fingers parent-relative copy, hips = body rest + (src hips − src rest)
  × hip ratio), strip horizontal hips root motion (record it into clips.json `root`), resample
  30 fps, purge every other action → export GLB (rotation tracks + hips translation only) →
  `tools/compress_glb.py` chain C (resize 1024 → webp q85 → meshopt).
- Budget per fighter GLB ≤ 3.0 MB (target 2.0). Textures: one 1024 albedo + normal max; drop
  specular/gloss. Hair/lashes alpha → `alphaTest` (named material suffix `_cutout`).
- Clip names inside the GLB are exactly the clip ids in clips.json.

### §6.2 Clip set per fighter
Shared system clips (same id for every fighter, sources chosen once and baked per body):
`idle, walk_f, walk_b, crouch, crouch_idle, jump_up, jump_f, jump_b, land, dash_f, dash_b,
block_high, block_low, hit_high_s, hit_high_l, hit_body, hit_low, hit_air, crumple, kd_fall_b,
kd_fall_f, kd_ground_b, kd_ground_f, wake_b, wake_f, wall_splat, thrown_f, thrown_b (victim),
dizzy (stage fright stun), ko_fall, timeover_lose, parry, impact_windup, shove`.
Fighter clips: every `moves.*.anim.clip` + `intro`, `win*`, `taunt`, cinematic sub-clips.
`tools/clipplan.json` = `{ "<fighter>": { "<clipId>": { "src": "mixamo|cmu|layer",
"file": "...", "range": [f0,f1], "mirror": false, "layer": {"lower": "...", "upper": "..."},
"speed": 1.0 } } }` — authored by lane FIGHTERS from `_research/animations/*` findings.

### §6.3 `data/clips/<id>.clips.json` (generated)
Per clip: `{ "dur": s, "frames": n, "contact": s|null, "effector": {"bone": "RightHand",
"at": [x_fwd, y_up] metres fighter-local at contact} | null, "root": [[t, dx_fwd_m], ...],
"apexY": m|null, "loop": bool }` plus body facts `{ "heightM", "hipsM", "handReachM",
"footReachM" }`. Contact = end-effector speed peak/extension rule from the research lanes.

### §6.4 Props, stages, crowd
- Props GLBs (`art/gltf/props/`): riot shield, baton, cleaver, football, brick, playing card,
  bottle, mic-cane, stage debris; attached at runtime to hand bones by a WORLD-space solve with a
  full basis (doctrine §1) — props lane provides `attach` metadata (grip offset, axis).
- Stages (`art/gltf/stages/<id>.glb` or runtime-built from kits): 5 sets from
  `_research/environment/ENV_KIT.md`. Fight floor = a 16 m strip at z ∈ [−1.5, 1.5]; walls at
  x = ±8 m are visible set walls (splat surfaces); background depth to z = −25 m; stands/crowd
  bays; lights as a FIXED pool. Budget per stage ≤ 6 MB, ≤ 250 draws with crowd.
- Crowd: baked impostors from 6 crowd bodies (research ROSTER §crowd), 3-4 cheer/jeer poses ×
  angles, unlit, instanced cards with vertex-shader bob/sway; intensity follows the ratings.

## §7 View contract (lane VIEW)

- Renderer: dyefield renderer.ts base (WebGL2, DPR ≤ 1.5, adaptive governor, Neutral tone
  mapping, PCFShadowMap 1024, `info.autoReset=false`) + composer: RenderPass → SMAAPass →
  OutputPass (+ optional bloom behind a quality setting). Warm-up (blocktooth warmup.ts) with RT
  bound then canvas, BEFORE the first round.
- **Toon look:** fighters use a shared cel material (albedo map, 3-band ramp, rim light, inverted-
  hull outline on skinned meshes via onBeforeCompile; outline width in screen space). Sets use
  lit PBR with a stylised grade. Must hide the realistic-vs-painted mix across bodies (research
  ROSTER style caveat) — verified by lookshots G5.
- **Pose from state:** each frame the fighter view sets each clip action's `time` from the
  snapshot (`animId`, `animFrame` → seconds via the move's `anim.warp` or loop rate) and blends
  prev→current by `blendT` over ≤ 6 frames. NEVER accumulate mixer time (rollback must re-pose
  identically). Hitstop: victim shake ±2 cm (view-only), attacker holds pose.
- Camera (FIGHTING_DESIGN §7b): vFOV 35°, distance clamp 4.36–7.6 m by separation, look-at mid-X,
  y 1.0 m, height 1.25 m, pitch −2..−4°, pan on jumps, zoom out fast / in slow, rotational shake
  by trauma (+0.10 L / +0.20 H / +0.35 IMPACT or PC / +0.5 KO), perfect-parry zoom freeze,
  super-freeze punch-in, Lv3 cinematic camera tracks (`view/cinematics.ts`, authored per fighter,
  exactly `cinematic.frames` long, driven by the sim's cinematic frame), KO orbit 25°, BRAWL
  camera (lower/closer, 45°) for the bonus rounds.
- FX (`fx.ts`): hit sparks by strength, counter/punish flash, block spark, parry flash, perfect-
  parry shock ring, IMPACT armor glow, wall-splat decal + dust, comic splatter (setting:
  splatter|sparks|confetti), speed lines/smears on heavies, super flash + background dim,
  projectile visuals per fighter, KO finish zoom lines.
- Stage view (`stage.ts`): loads a stage GLB/kit, fixed light pool, crowd, stage-specific
  animated dressing (wheel spin, rain, neon flicker). Stage walls react (dust) to splats.

## §8 UI contract (lane UI)

- TV frame HUD: show bug + LIVE (top-left), P1/P2 health bars with portraits and names (top),
  round pips + timer (top centre), SHOWTIME (ratings) bars bottom-left/right, NERVE bars under
  health, STAGE FRIGHT state, combo counter + style word (SOLID/SPICY/BRUTAL/PRIME TIME/
  SYNDICATED), host caption card (Ricky), system callouts (COUNTER, PUNISH COUNTER, THROW
  ESCAPE, PERFECT PARRY, STAGE FRIGHT), SCORE (arcade only).
- Screens: boot → title (press start) → main menu (THE SEASON, VERSUS, ONLINE, TRAINING, SETTINGS,
  CREDITS) → character select (3D rotating model, name, archetype, difficulty stars, colour pick,
  control type pick) → stage select (versus) → VS splash → fight → results (winner quote, stats) →
  rematch/char select/menu. Arcade: ladder screen between bouts, rival cutscene cards, BRAWL
  BREAK intro, boss intro, ending card per fighter, ratings total + name entry (local board).
  Online: lobby (quick match / create code / join code / status), blind select, rematch.
  Training: dummy menu (stand/crouch/jump/block all/block after first/CPU level/record-playback
  3 s), input display, frame advantage readout, hitbox overlay (`?dev=1` or training toggle),
  move list per fighter (SIMPLE + CLASSIC notations).
- Pause (`window.__PAUSE__`), ESC pauses (never destroys), forfeit = loss through the verdict path;
  settings: controls (scheme per player, remap keys/pad), audio buses, gore toggle, screen shake,
  reduce flashing, cinematic camera (full/short — shots only, never frame count), language: EN.
- Save (`hitparade.save.v1`): unlocks (freak, ricky), season clears per fighter, best scores,
  settings, online display name. Every storage touch in try/catch.

## §9 Audio contract (lane AUDIO)
dyefield engine (buses, voice pool, Ogg + AAC twins, lazy preload after first stage). Router maps
every `EV` type to sounds (hits by strength/counter, blocks, whiffs by weight, throws, parry,
perfect parry sting, IMPACT, wall splat, KO, crowd bed following SHOWTIME/ratings + cheer/gasp/
boo one-shots, host stings, round announcer stingers (bell, air horn), UI). Music: menu, char
select, one track per stage, boss, results/ending jingle; unused tracks only
(`state/music_assignments.json`). Shipped audio ≤ 12 MB total. Credits generated.

## §10 Net contract (lane NET) — per NETCODE.md
- Transport tier 1: WebRTC DataChannel `{ordered:false, maxRetransmits:0}`, public STUN, signalling
  over the vendored NetPlay room channel `ffg:hit-parade:<CODE>` (presence + broadcast, NOT 60 Hz).
- Tier 2 fallback (direct fails within 5 s): 10 Hz batched binary broadcast, 4-frame delay,
  12-frame window; only ONE relay match at a time (presence on `ffg-relay:hit-parade`).
- NEVER send 60 Hz traffic over Supabase (project-wide 100 events/s free-plan cap closes every
  FFG game's channels).
- Rollback (`core/net/rollback.ts`, THREE-free, transport-agnostic): input delay =
  clamp(ceil(RTT/2/16.67) − 3, 1, 4) fixed per round; window 8; packets repeat all unconfirmed
  inputs (≤ 32); time sync every 240 f; checksum every 15 confirmed frames; desync → host
  snapshot recovery; stall when the window is exhausted.
- Match flow: lobby → blind character select → stage (host) + seed → start sync → match →
  result agreement → rematch; disconnect = win for the stayer after 5 s grace; protocol + build
  version in presence; ranked only when both signed in (FFG ratings RPC), else unrated.
- Probes (gates): `probe_synctest` (roll back 1..8 frames every frame, compare checksums, all
  fighter pairs), `probe_netsim` (replays `_research/netcode/rtt_probe_*.json` traces through two
  sessions; game speed ≥ 96%), `_harness/online2.py` (two real Chromes, quick match + code join,
  one full bout, identical final checksums).

## §11 CPU, ladder, bonus rounds (lane AI)
- CPU levels 0-8 exactly per FIGHTING_DESIGN §10 table (`data/cpu.json`): reacts only to VISIBLE
  startup (reaction clock starts at the attacker's startup frame), one latched reaction roll per
  incoming attack, no input reading ever, execution drops, per-fighter game plans (zoner keeps
  range, grappler walks in, etc. from `fighters/<id>.json` `cpu.style`), bosses get tools not
  reactions. CPU emits input words only.
- Ladder (`data/ladder.json`): SEASON 8 bouts (4 random, RIVAL at 5, random, MINI BOSS THE FREAK,
  BOSS RICKY), BRAWL BREAK after bout 3, HECKLER TOSS after bout 6; PILOT 5 bouts; difficulty
  shifts ±2 levels; continues reset the episode ratings; rival banter cards; endings per fighter.
- Personas (`core/ai/personas.ts`, harness only): masher, turtle, jumper, zoner, novice (400 ms
  delay), optimal. Acceptance (G3): block+punish beats mash; anti-air beats jumping; novice beats
  L1 most of the time; boss beats optimal sometimes and loses to it mostly.

## §12 Test surface `window.__HP__`
`{ version, state(), match(), fighters(), events(n), shot(name), perf(), audio(), net(),
touch(), dev: { startMatch(cfg), setInputs(p, word, frames), step(n), setHp(p,v), setMeter(p,
k,v), freeze(on), goto(screen), cpu(p, level) } }` — dev functions throw unless `?dev=1`.
Deep links: `?mode=versus&p1=johnny&p2=bruno&stage=rust_theater&seed=1&cpu2=3&autostart=1&dev=1`.

## §13 Gates
| gate | command | pass |
|---|---|---|
| G0 types | `npm run typecheck` | 0 errors |
| G1 data | `node _harness/probe_data.ts` | every move's clip exists in clips.json AND the GLB; every warp maps startup→contact (±1 f); every fighter has all shared clips; strings resolve; stages/ladder refs resolve; frame-data template check (advantage arithmetic; no normal ≤ −5 except sweep/anti-air) |
| G2 sim | `npm run probe` (probe_determinism, probe_synctest, probe_moves, probe_hits, probe_block, probe_throws, probe_meters, probe_rounds, probe_projectiles, probe_uniques, probe_motion) | all PASS; same seed ⇒ same hash twice; synctest 0 mismatches |
| G3 AI/feel | `node _harness/probe_personas.ts --seeds 1..20` | §11 acceptance numbers |
| G4 boot | `python _harness/bootcheck.py --headless` | BOOTS CLEAN; a real-key bout: walk, jab lands (HIT event + HP falls), special lands |
| G5 look | `python _harness/lookshots.py` + Read every PNG | vision review: fighters toon-consistent, stage readable, HUD correct |
| G6 play | `python _harness/playtest.py --headless` | full versus bout by real keys vs CPU L1 incl. throw, parry, IMPACT, super, results screen numbers = sim |
| G7 shell | `python _harness/menus.py && python _harness/bootguard.py` | all screens reachable by keyboard + pad; bootguard cases pass |
| G8 mobile | `python _harness/mobile.py --headless && python _harness/layoutcheck.py --headless` | touch bout works; layout PASS |
| G9 perf | `python _harness/perfcheck.py --headless` (ALONE) | p99 frame ≤ 33 ms on the Intel iGPU at 1600×900 in a super cinematic |
| G10 online | `node _harness/probe_netsim.ts && python _harness/online2.py` | speed ≥ 96%; 2-browser bout identical checksums |
| G11 season | `node _harness/probe_season.ts` + `playtest.py --season` | ladder resolves, bonus rounds score, boss phases, ending card |

## §14 Lane ownership
| lane | owns (write access) | dev port |
|---|---|---|
| SHELL | package.json, tsconfig, vite.config.ts, runtime/index.html, runtime/public/*, src/main.ts, game.ts, input.ts, testsurface.ts, app/*, ui/boot.ts, ui/settings.ts, ui/save.ts, _harness/common.py, bootcheck.py, bootguard.py, README.md | 5320 |
| SIM | src/core/** except core/ai and core/net, data/system.json, _harness/probe_{determinism,synctest,moves,hits,block,throws,meters,rounds,projectiles,uniques,motion,data}.ts | - |
| ASSETS | art/**, tools/** (except clipplan.json content decisions), data/clips/** | - |
| FIGHTERS | data/fighters/**, tools/clipplan.json, _spec/ROSTER.md | - |
| VIEW | src/view/**, _harness/lookshots.py, perfcheck.py | 5323 |
| UI | src/ui/** except boot/settings/save, src/touch/**, data/strings.json, data/captions.json, _spec/CONTRACT_MOBILE.md, _harness/menus.py, layoutcheck.py, mobile.py | 5324 |
| AUDIO | src/audio/**, runtime/public/audio/** (if used) | - |
| NET | src/core/net/**, src/net/**, _harness/probe_netsim.ts, online2.py | 5325 |
| AI | src/core/ai/**, data/cpu.json, data/ladder.json, _harness/probe_personas.ts, probe_season.ts, playtest.py | 5326 |
| STAGES | art/stages sources + stage GLBs (sub-lane of ASSETS), data/stages.json | - |

## §15 Phases (each ends with gates green + commit + push; no stopping between phases)
- P1 Foundation: SHELL skeleton boots; SIM core systems + probes with 2 test kits (johnny, bruno);
  ASSETS pipeline proves johnny + bruno GLBs with the shared clip set; VIEW renders a bout on the
  Rust Theater greybox-with-real-kit; UI HUD + menus machinery; AUDIO engine + first SFX kit;
  NET rollback core + synctest against the sim.
- P2 Roster: all 12 kits authored + baked + probed; cinematics; props.
- P3 Content: 5 stages, crowd, CPU levels, ladder + bonus rounds, training, endings, online flow.
- P4 Feel + balance: persona playtests, real-input playtests, critic lanes, fixes.
- P5 Ship: mobile, perf, cover, build, deploy (unpublished), live verification (boot + a bout on
  the CDN + an online bout between two browsers on the CDN).
