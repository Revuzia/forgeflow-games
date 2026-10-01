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
              clipplan/_shared.json (ASSETS: shared system clips) clipplan/<fighter>.json (FIGHTERS)  research/
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
- `anim.warp` and `boxes` are OPTIONAL. If omitted, `core/data.ts` derives them at load from
  clips.json: warp = [[0,0],[startup, contact],[startup+active+recovery, dur]]; boxes = one box
  centred on `effector.at` at contact, size by strength class (L 0.30x0.25, M 0.40x0.30,
  H 0.50x0.35 m), active over the move's active frames. Hand-tuned values override.
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
- CHANGED(ASSETS): what the GLB actually contains (additive clarification, no signature broken):
  - ONE skinned mesh `<id>_body` with ≤ 2 primitives: material `<id>_skin` (OPAQUE) and
    `<id>_cutout` (alphaMode MASK, cutoff 0.5 → three `alphaTest 0.5`). Both sample ONE 1024 RGBA
    albedo ATLAS (webp) re-baked (Cycles) from every source material; alpha is only meaningful on
    `_cutout`. No normal map is shipped (the cel look is albedo-driven; "normal max" stays allowed).
  - Armature node `<id>_rig`; bones are `mixamorig:<Bone>` in the file, which three's GLTFLoader
    sanitises to `mixamorig<Bone>` (colon dropped) — find bones by that name. Brute keeps its extra
    bones (Hair1-4, eyes, Weapon) at bind.
  - Rest pose: height = `heightM` (data/fighters/<id>.json if present, else tools/bodies.json), lowest
    vertex on y = 0, facing +Z.
  - EVERY clip carries a rotation track for EVERY joint plus exactly one `mixamorig:Hips` translation
    track (no partial clips → no stale bones when the view blends). Hips horizontal travel is
    stripped (the hips stay above the rest hips x/z in every frame; the forward travel is clips.json
    `root`); hips vertical is kept (crouch, falls), except jump clips which are ground-locked
    (feet at the root, the removed lift = `apexY`) because the sim owns airborne height.
  - Every clip is floor-checked on the real skinned mesh at bake time (hips raised where it would sink).
  - CHANGED(ASSETS) part 2: size facts. The part-1 strip step left the samplers (and accessors) of every dropped
    scale / non-Hips translation channel in the file (ricky: 11505 samplers for 3894 channels, a 1.9 MB glTF
    JSON chunk in a 3.3 MB GLB). Fixed (tools/glb_post.mjs strip disposes unused samplers): ricky 3,304,208 →
    2,204,176 bytes. Nothing the runtime reads changed (same channels, same clip names).

### §6.2 Clip set per fighter
Shared system clips (same id for every fighter, sources chosen once and baked per body):
`idle, walk_f, walk_b, crouch, crouch_idle, jump_up, jump_f, jump_b, land, dash_f, dash_b,
block_high, block_low, hit_high_s, hit_high_l, hit_body, hit_low, hit_air, crumple, kd_fall_b,
kd_fall_f, kd_ground_b, kd_ground_f, wake_b, wake_f, wall_splat, thrown_f, thrown_b (victim),
dizzy (stage fright stun), ko_fall, timeover_lose, parry, impact_windup, shove`.
Fighter clips: every `moves.*.anim.clip` + `intro`, `win*`, `taunt`, cinematic sub-clips.
`tools/clipplan/_shared.json` (lane ASSETS) and `tools/clipplan/<fighter>.json` (lane FIGHTERS),
each = `{ "<clipId>": { "src": "mixamo|cmu|layer",
"file": "...", "range": [f0,f1], "mirror": false, "layer": {"lower": "...", "upper": "..."},
"speed": 1.0 } }` — sources chosen from `_research/animations/*` findings.
- CHANGED(ASSETS): clipplan additions (all optional, additive): `src: "author"` (a keyed world-space
  pose spec in `art/blender/author_clips.py`, retargeted like any source); `layer.lower` / `layer.upper`
  may be a full entry object (e.g. a CMU source) instead of a string; `loop`, `loopBlend` (frames eased
  into frame 0), `air` (`"strip"` ground-lock | `"hold"` hips height held), `floor` (`"clamp"` default |
  `"plant"` | `"none"`), `contact` (`null` | `"auto"` | SOURCE frame), `effector` (bone), `marks`
  `{name: source frame}`; CMU entries also take `kind`, `limb`, `fist`, `face` (`"guard"`) exactly as
  `tools/cmu_retarget.py` (a numeric `contact` also aims the CMU facing). Keys starting `_` are
  ignored. A fighter clipplan entry whose id equals a shared id OVERRIDES the shared clip for that
  fighter only. Fighter entries default to `contact: "auto"`. NOT supported yet: `src: "seq"` (used
  in FIGHTERS' johnny.json) — ASSETS part 2 decides (the driver reports it as an invalid entry).
- CHANGED(ASSETS) part 2 (builder behaviour; no signature broken, every field optional):
  - `src: "seq"` IS supported (hp_retarget.SeqSampler), exactly §20.5: segment k starts on output frame
    start(k-1) + n(k-1) − 1 − `xf` (30 fps), the xf+1 overlap frames crossfade (smoothstep), horizontal hips
    travel continues across segments (root accumulates). clips.json `contact` = the contact of the first
    segment that HAS one (its own field, converted through that segment; rerun crawl_run's run-in segment has
    none, its bite does); `marks` = every segment's contacts in order as
    `hit1..hitN` (+ other named segment marks) - the same list lane FIGHTERS' kitlib.entry_seconds builds.
    Measured: johnny sold_out_flurry = 40 frames = 1.3 s, contact 0.1417 s (warp says 0.142 / 1.3).
  - layer `attach`: `"yaw"` (DEFAULT) | `"full"` | `"world"` - how the upper body is re-attached to the lower's
    hips. "yaw" applies only the tilt of lowerHips·upperHips⁻¹ (swing about world up), so the upper keeps its own
    world yaw = its attack line. The part-1 behaviour ("full") carried the upper clip's bladed-pelvis yaw into
    the result (measured: bruno air_chop fist 0.23 m behind the body, johnny air_cross 0.44 m reach vs 0.87 m).
  - explicit numeric `contact` → clips.json `contact` is the EXACT converted time (not rounded to a baked
    frame); `effector.at` is interpolated between the two neighbouring frames. `effector` defaults: the plan's
    `effector`, else a CMU entry's `limb` (+`kind`), else (layer) the upper's, else (seq) the first segment's,
    else the fastest limb in [c−4, c+1] (layered strikes: hands only).
  - CMU limb verification: when the plan's `limb` is not the one moving (other side > 2× faster and > 4 m/s in
    [c−16, c+4] source frames) the clip is baked with the measured side (facing + effector) and bake.json records
    `_limb_check` / `_limb_resolved`; `limb_lock: true` skips it.
  - floor `"clamp"` (default) also SETTLES a clip whose lowest vertex never touches the floor (whole clip
    lowered by its smallest gap). An authored spec may carry its own default `floor` (crouch_toe_kick: "plant").
  - CONTACT AIM: the opponent is always straight ahead, so when a strike's aim point at contact is > 25° off
    the forward axis (seen from above, from the hips, ≥ 0.20 m out) the clip is turned about the vertical so it
    lands straight ahead - the whole clip, or only the UPPER body of a layer. Aim point = the effector, or the
    mid-point of both hands for two-handed moves (other hand ≥ 0.6× the effector's speed, or both hands out at
    a similar height) and CMU `body` grabs. Not applied to `author` / `seq` clips or entries with `"aim": false`.
    bake.json records `aim` {deg, point, scope, effector_before/after}. The turn also re-projects `root`.
    Measured: bruno storage_slam (a sideways goalkeeper dive) turned −76.6°, effector x_fwd 0.39 → 1.05 m.
    `seq` clips are aimed PER SEGMENT (each segment with a contact; the xf crossfade pivots between them):
    spin handspin_clip toe 0.93 m behind the body → 0.92 m in front; windmill_l/m/h lateral 0.58 m → 0.
  - KNEE strikes: a derived foot effector becomes `<Side>Knee` when, at contact, the knee is ≥ 0.15 m above the
    toe and the toe is no farther out from the hips than the knee (rotation-invariant). gazza air_knee and
    patch step_knee now report the knee; kicks and floor sweeps keep the foot. An explicit plan `effector` wins.
  - `effector.at` at a fractional contact time is the pose AT that time with the joints slerped (what three.js
    samples), not a chord between two baked frames (johnny run_hook differed by 6.6 cm).
  - CHANGED(ASSETS) part 2 re-run - EXTREMITIES (hp_retarget.sanitize_wrists / clamp_toes, every bake): CMU mocap
    hands are marker garbage in places (measured over all 12 fighters: single-frame hand steps > 70° = 20 CMU frames vs
    7 Mixamo; johnny uppercut's wrist bent 126-138° for f0-f2; johnny cross twisted 66° on its contact frame only;
    bruno bear_hug 85-107° all clip). For clips whose hands come from CMU (cmu, a layer with a cmu upper, a seq with a
    cmu segment): frames with the hand > 80° off the forearm or a one-frame excursion are re-interpolated between the
    nearest valid frames, twist is clamped to ±100°, remaining snaps > 50°/frame are spread over 4 frames. Toes are
    limited to 45° vs the foot on every clip (bruno win_flex bent a boot 58°). Clips whose legs come from CMU too
    (cmu, seq with a cmu segment) also get: FEET with the ankle > 80° off the shin re-interpolated (gazza
    grass_cutter swung the foot 121-152° for 3 frames), and the 1- or 2-frame excursion rule (out > 60°, back
    > 40°, neighbours close) on every limb and spine bone (lotus tornado_hop's thigh twisted 157° for 2 frames).
    The snap spread never moves the frames the contact / strike marks sample (a VALID contact pose stays as the
    source had it); an INVALID contact frame is still repaired. Plan opt-outs: `"wrist": "raw"`, `"toes": "raw"`.
    bake.json records `extremities` per clip. Contact frames of some CMU strikes changed because the garbage sat on
    the contact frame (effector.at moved 2-19 cm; list in the part-2 report); lane FIGHTERS re-runs
    `data/fighters/_gen/build.py` for `boxSrc: hitVolume` boxes on those moves (§20.6).
  - CHANGED(ASSETS) part 2 re-run - AIM and SEQ fixes: an AUTO-picked striking hand > 90° off forward at contact
    while the other hand is out in front (≤ 60°) is the wrong hand: the other hand becomes the effector (bake.json
    `aim.effector_switch`); a hand behind the body never counts as the second hand of a two-handed (mid-hands)
    aim; a layered SEQ segment is aimed by turning its upper only (as aim_clip does). Measured: krane
    backup_combo had been turned 143° (the fighter ran backward) and shield_block / shield_charge 86° / 72°; now
    LeftHand (the shield arm) at 30-39°. The seq crossfade interpolates the body yaw once along the shortest angle
    and slerps yaw-free bone poses under it (per-bone slerps across a large yaw change sent bones different ways:
    krane backup_combo Spine1 turned 179° in one frame, spin six_step_ex 154°, patch reel_kicks 163°). A LAYERED
    aim now turns the already-attached upper body about the vertical through the spine base, so strike heights
    are exactly the unaimed heights (turning the upper before the lean-attach had raised boneyard air_backhand's
    fist 25 cm and krane air_poke's 16 cm); only x_fwd / lateral change.
  - authored specs gain `upper` (layered base), `ik` (two-bone leg IK to an ankle target / "base" = planted)
    and `aim` keys (art/blender/author_clips.py header). `crouch_toe_kick` / `crouch_shin_kick` exist: the toe
    kick uses the FRONT leg of the shared crouch, which is the LEFT leg (FIGHTERS' text said right).
- CHANGED(ASSETS): THROW PAIR SYNC. `thrown_f` / `thrown_b` are the victim halves. Victim frame 0 = the
  throw connects (= the attacker throw clip's `contact`); victim `marks.slam` = the victim hits the
  floor (thrown_f 0.733 s, lands on the back, ends in the kd_ground_b pose, ~1.2 m backward travel
  in `root`; thrown_b 0.667 s, lands face-down, ends in the kd_ground_f pose, ~1.4 m forward).
  CHANGED(ASSETS) part-1 re-run: authored (`src: "author"`) clips' `root` = the spec `hips` travel ONLY; the
  library base poses' own hips travel is no longer added (thrown_b's root used to run to +4.9 m and snap back
  to +1.3 m; thrown_f ended −1.92 m). Poses/GLB tracks unchanged (per-frame effector traces bit-identical);
  only `root` of wall_splat / thrown_f / thrown_b / parry / shove / impact_windup (+ FIGHTERS' authored crouch
  kicks) changed. Measured root at the end: johnny thrown_f −1.100 m, thrown_b +1.302 m, wall_splat 0 (−0.257 m
  into the wall at the splat); bruno −1.284 / +1.520 / 0 (−0.300). Nothing consumes `root` for throws today.
  Authored base poses are now blended PARENT-RELATIVE between keys (was: every bone's world delta slerped on its
  own, which twisted thrown_b's right foot 171° / left toe 150° off bind for 3-4 frames and spun shove's left
  hand 157° in one frame); key poses, contacts and effector points are unchanged. An
  attacker throw clip in a fighter clipplan declares its own `marks: {"slam": <source frame>}`; the
  view warps each clip so both slam marks land on the same sim frame. `wall_splat` has `marks.splat`.

### §6.3 `data/clips/<id>.clips.json` (generated)
Per clip: `{ "dur": s, "frames": n, "contact": s|null, "effector": {"bone": "RightHand",
"at": [x_fwd, y_up] metres fighter-local at contact} | null, "root": [[t, dx_fwd_m], ...],
"apexY": m|null, "loop": bool }` plus body facts `{ "heightM", "hipsM", "handReachM",
"footReachM" }`. Contact = end-effector speed peak/extension rule from the research lanes.
- CHANGED(ASSETS): file layout = `{ "fighter": id, "generated_by": "...", "fps": 30, "body": {heightM,
  hipsM, handReachM, footReachM}, "clips": { "<clipId>": {dur, frames, contact, effector, root, apexY,
  loop, marks?} }, "_meta": {field definitions} }`. `dur = (frames − 1) / 30`. `root` has one row per
  baked frame. Contact uses the FRONT-PASS refinement (the frame in [c−8, c+3] where the effector is
  farthest forward) unless the clipplan gives a frame. Effector points: hands = `<Side>HandMiddle1`
  head (knuckles), feet = `<Side>ToeBase` head, knees = `<Side>Leg` head, head = `HeadTop_End`.
  `apexY` is non-null only for ground-locked (`air: "strip"`) clips. Optional `marks: {name: s}`.
- CHANGED(ASSETS) part 2 re-run (answers the §20.6 request; additive): optional `marksAt: {"hit1": {"bone", "at":
  [x_fwd, y_up]}, ...}` on every clip with strike marks (names starting `hit`), measured exactly like `effector.at`
  (slerped pose at the exact mark time). `bone` = among the limbs moving at ≥ 0.4× the fastest one's speed in
  [f−4, f+1] around the mark, the one farthest forward (the clip effector wins ties within 5 cm) - so a flurry that
  alternates hands names each hand (johnny sold_out_flurry: hit1/hit3 LeftHand, hit2/hit4 RightHand). SIM may derive
  one box per `hits` entry from it; nothing reads it yet.
  Measured on johnny/bruno: three.js bone positions match `effector.at` to 0.4 mm with the root at
  yaw +90 (x_fwd = world +X).

### §6.4 Props, stages, crowd
- Props GLBs (`art/gltf/props/`): riot shield, baton, cleaver, football, brick, playing card,
  bottle, mic-cane, stage debris; attached at runtime to hand bones by a WORLD-space solve with a
  full basis (doctrine §1) — props lane provides `attach` metadata (grip offset, axis).
- CHANGED(ASSETS) P2 - props shipped (additive; §17.1 unchanged): `art/gltf/props/<id>.glb` for `brick riot_shield baton
  cleaver gourd football card card_fan mic_cane taser spotlight`, built by `python tools/build_props.py` (procedural Blender
  models `art/blender/build_props.py`, Cycles-baked PBR: baseColor + ORM (R occlusion, G roughness, B metallic) + normal
  [+ emissive: taser LED, spotlight lens], webp, meshopt; 108-7.5k tris; 512-1024 px maps). Each GLB = ONE mesh node named
  `<id>` (material `<id>_mat`) whose glTF extras carry `attach` (§17.1 shape; `null` = world prop: spotlight) and `prop`
  (id, origin text). **Prop frame (glTF):** origin = the grip point (fist-loop centre / pinch / hang point; brick, football,
  card = centre, also the projectile pivot); **+Y = the business end** (blade, cane head, spout, top of the gun, up);
  **+Z = the edge / strike face / barrel / shield front / card face**; modelled at real size (m).
  **`art/gltf/props/props.json`** (generated, never hand-edited) = `{ version, props: { <id>: { glb, users: [fighter],
  rule: 'fist'|'palm'|'pinch'|'fan'|'shield'|'hip'|'none', bone, gripOffset: [x,y,z], axis: { up, edge } (bone-space
  directions of prop +Y / +Z), rotDeg, scale: 1, attach: {bone, pos, rotDeg} | null, fighters: { <fighter>: {bone, pos,
  rotDeg} }, projectile: bool, tip: [x,y,z] | null (business-end point, prop space), reachM: |tip| | null, origin, note,
  boundsM, tris, bytes, textures, check } } }`. `fighters.<id>` is the grip solved on THAT body's own finger joints (prefer it;
  view/props.ts already does); `attach` = the primary user's (also the GLB extras). Solve (tools/build_props.py): the hand
  frame measured in three.js with the view's attach math (tools/prop_attach_check.html) on every body = +Y fingers, +Z palm
  normal, thumb side +X (RightHand) / -X (LeftHand); `fist` = a circle fitted through the curled finger joints (handle axis =
  knuckle line, business end out of the thumb side, edge toward the knuckles), `shield` = the fist with the plate on the
  back-of-hand side, `palm` = resting on the palm, `pinch` = between the index + middle finger tips, `fan` = thumb pinch,
  `hip` = Lotus' gourd on the right hip (Hips bone). Weapon reach for SIM / FIGHTERS hit volumes (the §20.6 open item):
  `reachM` baton 0.50, cleaver 0.28, mic_cane 0.80 (tip = the chrome mic head), taser 0.20 m past the grip; world tip =
  bone frame x compose(attach) x tip. Proof: `python tools/prop_attach_check.py --suite` renders every prop in its users'
  hands on their real clips (game camera + close-up) -> `art/renders/props/attach/*.png`; contact renders next to the two
  ENV_KIT reference props under the stage HDRI -> `art/renders/props/contact_sheet_*.png`. Mirrored fighters (facing -1,
  §17.1 scale x -1) mirror their props too (the shield's K13 SECURITY lettering then reads mirrored - VIEW's call).
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

### §9.1 CHANGED(AUDIO): the audio API game.ts / UI / settings call (extends §16, breaks nothing)
- `createAudio(opts?)` -> `GameAudio` (`audio/index.ts`, types in `audio/types.ts`): the §16 members `unlock()`,
  `preload(ids?)`, `events(ev, m)`, `music(cue | null)`, `ui(cue)`, `setVolumes(v)`, `stats()` plus
  `bout(info | null)`, `setPaused(b)`, `setSplatter('splatter'|'sparks'|'confetti')`, `announce(line)`, `unlocked`, `dispose()`.
- `events(ev, m, f?)`: optional third arg `f = [readFighter(m,0), readFighter(m,1)]` (stereo pan by x, crowd bed from
  SHOWTIME, combo calls). Audio dedupes `(frame,type,a,b)` itself as well (rollback re-emits are harmless).
- `bout({ fighters: [id0, id1], stage, mode?, local? /* 0|1 = this screen's player, -1 local 2P */, sfxNames?: m.tab.sfx })`
  when a match mounts (voices, stage music, crowd beds); `bout(null)` when it ends. `preload()` with no ids = the bout
  set (sfx + crowd sprites); the first `events()` call starts it if the integrator did not.
- `music(cue)`: `'menu' | 'select' | 'stage' | 'boss' | 'miniboss' | 'win' | 'lose' | <stage id>` (5 stage ids of
  §5.4); aliases `title`=menu, `charselect|vs|ladder`=select, `results|ending`=win/lose from `local` + the winner,
  `music_stage_<id>` / `music_<cue>` (the ids `data/stages.json` `music` uses); `null` stops. `'stage'` = the bout's
  stage, `boss` when RICKY fights, `miniboss` when THE FREAK fights. The stage `ambient` (e.g. `amb_theater_crowd`)
  is the automatic crowd bed of `bout()`.
- `ui(cue)`: `move confirm back error toggle start lock vs pause resume tick cash unlock ladder` (aliases `hover`,
  `select`, `click`, `cancel`, `deny`). `announce(line)`: `3 2 1 go ready fight bonus begin gameover victory win lose`.
- Volumes `{ master, music, sfx, crowd, voice }` 0..1 (settings "audio buses"); `__HP__.audio()` = `audio.stats()`.
- **SFX_CUE vocabulary** (move data `sfx: [[frame, name]]`): a name resolves through `SFX_CUE_ALIASES` in
  `audio/router.ts` = the `_research/audio/AUDIO_KIT.md` role names (`punch_light punch_heavy kick body_blow_thud
  bone_crunch slap whoosh_light whoosh_heavy grab_cloth body_fall wall_slam wet_splat glass_break metal_pipe_clang
  wooden_bat_crack electric_zap fire_whoosh explosion air_horn bell_ding cash_register buzzer jingle_sting
  crowd_cheer_burst crowd_boo crowd_gasp_ooh crowd_applause crowd_laugh voice_efforts ...`), the verbs `kiai grunt
  scream laugh whistle card_throw ball_kick zap stomp clang smash`, or any sprite sound id. `probe_audio.ts` fails on
  a name in `data/fighters/*.json` that does not resolve.
- Event fields audio reads beyond §17.6 (from the SIM emit sites): WHIFF `c` strength class; METER_BAR `b` bars now;
  THROW `c` 1 = punish-counter; TIMEOVER `a` round winner. Round flow plays from ROUND_INTRO / FIGHT / ROUND_END /
  MATCH_END when SIM emits them, else from `MatchSnap.phase` transitions (once per round either way).
- Assets (generated by `audio/build/build_audio.py`): `audio/assets/{ui,sfx,crowd}.ogg` Opus sprites + `music_<cue>.ogg`,
  each with an AAC `.m4a` twin (a device downloads one set). Nothing is fetched at `createAudio()`.

### §9.2 CHANGED(AUDIO) P2 content (2026-09-30; additive - no §9.1 signature changes, game.ts needs no edit)
1. **Music.** New cues `brawl` (BRAWL BREAK) and `heckler` (HECKLER TOSS), unused tracks registered in
   `state/music_assignments.json`. `music('stage')` in a bout whose `bout().mode` is `'brawl'` / `'heckler'` plays them (also
   `music('brawl' | 'heckler' | 'music_brawl' | 'music_heckler')`). Stage music: the stage's `data/stages.json` `music` id when it
   resolves (`music_stage_<id>` / `music_<cue>`), else the stage id; `butcher_block wheel_of_pain rooftop control_room` keep their
   P1 cues. RICKY -> `boss`, THE FREAK -> `miniboss` as before. STAGES: please write `"music": "music_stage_<id>"` and
   `"ambient": "amb_<id>"` for the new stages (ids of item 2).
2. **Stage ambience** (automatic with `bout()`): a quiet loop on the crowd bus - `amb_rust_theater` (torch crackle),
   `amb_butcher_block` (freezer hum + drips), `amb_wheel_of_pain` (neon buzz + wheel ticks), `amb_rooftop` (rain + wind, with
   occasional thunder one-shots), `amb_control_room` (equipment hum + beeps). Picked from stages.json `ambient` when it names one of
   these (`amb_theater_crowd` = the rust theater), else by stage id. It recedes as the crowd gets loud.
3. **Move-aware routing.** At `bout()` audio reads the bout fighters' move tables from `loadGameData()` (cached; optional
   `AudioBout.data?: GameData` to pass it) by moveId (§17 rule 1): `projectile.clip`, `cinematic.cue` + `hits`, `name`.
   - Projectiles by clip (brick, card, saw_card, flame, flame_breath, football, fireball_football, taser_bolt, pyro_line,
     spotlight_beam): PROJ_SPAWN (`c` = moveId) = the release, PROJ_HIT = the object's impact (brick smash, card slap, fire burst,
     taser jolt, ball thump, bulb pop, pyro burst), PROJ_CLASH = clash + both objects breaking. An SFX_CUE authored on a projectile
     move whose name is a projectile verb (card_throw, electric_zap, fire_whoosh, ball_kick, explosion, ...) plays that object's
     WIND-UP (card riffle, taser charge, flash-paper ignite, gourd swig, ball touch, fuse hiss, spotlight clunk) - FIGHTERS may keep
     authoring those cues at frame 0.
   - Weapon layers on HIT / BLOCK from the attacker's `FighterSnap.moveId`: Boneyard cleaver (flat-side smack + ring), Krane baton
     / riot shield, Ricky mic-cane (audio's own table by fighter + move name; supers excluded). Krane blocking standing = shield clang.
4. **PRIME TIME stingers:** CINEMATIC_START -> open stinger + roar; per-cinematic beats keyed by the move's `cinematic.cue`
   (e.g. `zambini_prestige` spotlight clunk / doves / vanish / ta-da, `krane_riot_act` taser jolt, `lotus_happy_hour` swig + flame
   jet, `gazza_hat_trick` keepy-uppy bounces + goal horn) on `MatchSnap.cinematic.frame`; the last authored `hits` frame -> finish
   stinger; CINEMATIC_END -> close stinger + applause. Played once per cinematic instance (rollback safe).
5. **SFX_CUE vocabulary additions** (any sprite id also works): `brick_throw brick_smash card_fan card_riffle card_whoosh
   card_saw flame flame_burst fire_burst flash_paper fire_breath swig gourd bottle bottle_smash taser taser_zap taser_charge
   spotlight spotlight_hum spot_on pyro pyro_burst fuse ball_bounce ball_hit shield_bash shield cleaver cleaver_chop baton cane
   camera_flash tv_static magic_poof vanish tada trapdoor lid_slam light_flicker thunder`.
6. **UI cues added for the ONLINE lobby** (lane UI calls `audio.ui(cue)`): `search` (one ping; call every ~1.5 s while searching),
   `found` (match found), `join` (peer joined the room), `leave` (peer left), `ready` (opponent locked in), `reveal` (blind picks
   revealed), `code` (room code created / copied), `rematch` (both want the rematch), `disconnect` (connection lost), `countdown`
   (a start-sync tick; `announce('3'|'2'|'1'|'go')` stays). Unknown cues still play `move` and are listed in `stats().unknown`.
7. **BRAWL / HECKLER and the SIM P2 events: audio follows §28.3 / §28.4 as written** (no extra request): goon indexes
   `8 + slot` (voice bank pitch per `brawl.kinds` id - CHANGED(AUDIO) P2 finish: keyed by the §32.1 ids `goon_hardhat` /
   `goon_security` / `goon_medic`, any other id pitched by its kind index 0 / 1 / 2, so no audio key depends on the old
   `goon_riot` / `goon_scrub`; goon impacts key on the index `>= 8` only), crowd object `2`; `MatchSnap.brawl.goons[].x` pans
   goon sounds against the player; GOON_SPAWN = stage-door bang + a goon bark, GOON_DOWN = body fall + groan + cheer; HECKLE_THROW
   = throw whoosh + a shout from the stands (panned by `c`); the object's sound by `system.json heckler.objects[b].id` (tomato
   splat, bottle smash, shoe thud, chair crash) on HIT / BLOCK / PARRY with the object side `2`, or when it leaves `MatchSnap.proj`
   without one (broke on the floor); SCORE plays the register on positive `b` (combo cash-out `d` 3 louder), nothing on a heckle
   hit (the splat + crowd laugh carry it). EVX: CATCH (Ricky = TV static + laugh, Rerun = growl), TELEPORT (trapdoor + poof),
   PHASE (broadcast glitch + host laugh + roar, music ducked), BALL (kick / wall rebound / rest / pickup / knocked / respawn /
   hover / loose sounds), INSTALL (charge-up). Bonus rounds: ROUND_INTRO -> bell + "BONUS", FIGHT -> "BEGIN" + horn, MATCH_END ->
   bell + "Oh yeah!" + fanfare.
8. Budget unchanged: shipped audio (Ogg + AAC together) <= 12 MB, measured by `node _harness/probe_audio.ts`.

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
`npm run probe` = `node _harness/run_probes.ts` (owned by SIM): it auto-discovers and runs every
`_harness/probe_*.ts` (each exits 0 = PASS, 1 = FAIL, prints one summary line) — lanes add probes
by adding files, never by editing the runner.

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
| ASSETS | art/** (except stage sources), tools/** (except tools/clipplan/<fighter>.json), data/clips/** | - |
| FIGHTERS | data/fighters/**, tools/clipplan/<fighter>.json, _spec/ROSTER.md | - |
| VIEW | src/view/**, _harness/lookshots.py, perfcheck.py | 5323 |
| UI | src/ui/** except boot/settings/save, src/touch/**, data/strings.json, data/captions.json, _spec/CONTRACT_MOBILE.md, _harness/menus.py, layoutcheck.py, mobile.py | 5324 |
| AUDIO | src/audio/**, runtime/public/audio/** (if used) | - |
| NET | src/core/net/**, src/net/**, _harness/probe_netsim.ts, online2.py | 5325 |
| AI | src/core/ai/**, data/cpu.json, data/ladder.json, _harness/probe_personas.ts, probe_season.ts, playtest.py | 5326 |
| STAGES | art/stages/** (sources), art/gltf/stages/**, data/stages.json | 5327 |

## §16 Module APIs (what game.ts wires together — SHELL owns game.ts/flow.ts)
Lab pages: any lane may create dev-only test pages `runtime/lab/<lane>.html` + `runtime/src/lab/<lane>.ts`
(never linked from index.html, so never in the build) to test its modules in isolation.
```ts
// core/data.ts (SIM) — loads + validates all JSON; THREE-free
export interface GameData { system: System; fighters: Record<string, FighterDef>; clips: Record<string, ClipsFile>;
                            stages: StagesFile; ladder: LadderFile; cpu: CpuFile; strings: Record<string,string> }
export function loadGameData(): GameData;             // static JSON imports (bundled)

// view/renderer.ts (VIEW)
export class Renderer { constructor(canvas: HTMLCanvasElement, opts: {quality: 'low'|'med'|'high', touch: boolean});
  readonly three: THREE.WebGLRenderer; resize(): void; info(): RenderInfo; dispose(): void; }
// view/assets.ts (VIEW) — GLB cache with MeshoptDecoder; per-fighter body+clips, props, stages
export class Assets { constructor(base: URL); fighter(id: string): Promise<FighterAsset>; stage(id: string): Promise<StageAsset>;
  prop(id: string): Promise<THREE.Object3D>; preload(ids: string[]): Promise<void>; }
// view/bout.ts (VIEW) — the 3D presentation of one match
export class BoutView {
  static create(r: Renderer, a: Assets, cfg: MatchCfg, data: GameData): Promise<BoutView>;   // loads stage + both fighters, warms shaders
  frame(m: MatchSnap, f: [FighterSnap, FighterSnap], ev: SimEvent[], dtReal: number): void;  // once per rendered frame; ev = NEW (deduped) events
  render(): void; setSettings(s: ViewSettings): void; dispose(): void; }
// view/showcase.ts (VIEW) — char-select / VS-screen 3D model turntable in a given canvas region
export class Showcase { constructor(r: Renderer, a: Assets); show(fighterId: string, color: number, pose: 'idle'|'intro'|'win'): Promise<void>; frame(dt: number): void; render(): void; }

// ui/hud.ts (UI)
export class Hud { constructor(root: HTMLElement, data: GameData); mount(cfg: MatchCfg): void; unmount(): void;
  frame(m: MatchSnap, f: [FighterSnap, FighterSnap], ev: SimEvent[]): void; }
// ui/menus.ts (UI) — every non-bout screen; emits intents, never starts a match itself
export type MenuIntent = { kind: 'startMatch', cfg: MatchCfg } | { kind: 'startSeason', fighter: string, color: number, scheme: Scheme, length: 'season'|'pilot', difficulty: number }
  | { kind: 'online', action: 'quick'|'create'|'join', code?: string } | { kind: 'training', cfg: MatchCfg } | { kind: 'quitToTitle' };
export class Menus { constructor(root: HTMLElement, data: GameData, deps: { showcase: Showcase, settings: SettingsStore, save: SaveStore, audio: GameAudio });
  show(screen: ScreenId, params?: unknown): void; hide(): void; onIntent(cb: (i: MenuIntent) => void): void;
  showResults(r: MatchResult): Promise<'rematch'|'charselect'|'menu'|'next'>; showPause(): Promise<'resume'|'settings'|'forfeit'|'movelist'>; }
// ui/broadcast.ts (UI) — TV straps, host captions, slates; driven by events
// audio/index.ts (AUDIO)
export function createAudio(): GameAudio;  // GameAudio: unlock(), preload(ids), events(ev: SimEvent[], m: MatchSnap), music(cue: string|null), ui(cue), setVolumes(v), stats()
// core/ai/cpu.ts (AI)
export function createCpu(level: number, fighterId: string, seed: number): Cpu;  // Cpu.input(m: Match, playerIndex: number): number (16-bit word)
// net/online.ts (NET)
export function createOnline(deps): Online;  // Online: quick(), create(), join(code), on('matchStart', cfg => ...), session: RollbackSession
// core/net/rollback.ts (NET)  -- CHANGED(NET): first arg is a structural SimPort, see §19.1
export class RollbackSession { constructor(sim: SimPort /* was m: Match */, local: 0|1, transport: Transport, opts: SessionOpts);
  tick(localInput: number): { advanced: number, stalled: boolean };  // called at 60 Hz by the loop
  stats(): NetStats; }
```
The loop (app/loop.ts) runs the sim at exactly 60 Hz; offline: `step(m, input1, input2)` per tick
(input from `input.ts` / touch / CPU); online: `session.tick(localInput)`. Rendering reads
snapshots after the ticks of that frame. Hitstop/slow-mo are SIM counters, never loop timeScale.

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

## §17 CHANGED(VIEW): view-facing encodings (SIM, VIEW, UI and AUDIO must agree)
The snapshot fields in §4.6 carry integer ids whose meaning §4 left open. VIEW reads them this way; SIM
writes them this way (VIEW implements the same rule in `view/animtable.ts` and switches to SIM's table
automatically when `GameData.anims` exists):
1. **moveId** (FighterSnap, fighter state) = index of the move in `Object.keys(def.moves)` (the JSON text
   order of `fighters/<id>.json` `moves`); `-1` = no move.
2. **animId / prevAnimId** = index into the per-fighter anim table (`-1` = none, renders idle):
   - `0..33` = the shared system clips in the exact §6.2 order: idle 0, walk_f 1, walk_b 2, crouch 3,
     crouch_idle 4, jump_up 5, jump_f 6, jump_b 7, land 8, dash_f 9, dash_b 10, block_high 11, block_low 12,
     hit_high_s 13, hit_high_l 14, hit_body 15, hit_low 16, hit_air 17, crumple 18, kd_fall_b 19, kd_fall_f 20,
     kd_ground_b 21, kd_ground_f 22, wake_b 23, wake_f 24, wall_splat 25, thrown_f 26, thrown_b 27, dizzy 28,
     ko_fall 29, timeover_lose 30, parry 31, impact_windup 32, shove 33;
   - `34 + k` = move `k` of rule 1 (entry = that move's `anim.clip` + `anim.warp`, derived per §5.2 when omitted);
   - then `intro`, each `win[i]` in order, then `taunt` (intro and taunt entries ALWAYS exist - clip `''`
     renders idle - as core/data.ts builds them; SIM §19.10 then appends one grab entry per grab move).
   Entry shape (optional `GameData.anims: Record<fighterId, AnimRef[]>` from core/data.ts):
   `interface AnimRef { clip: string; warp: [number, number][] | null; loop: boolean; moveId: number /* -1 system */ }`.
3. **animFrame / prevAnimFrame** = sim frames since that anim started; NOT advanced during hitstop or super
   freeze (the attacker holds the impact pose). View: `seconds = warp ? pwl(warp, animFrame) : animFrame / 60`
   (loop clips wrap by `dur`, one-shots clamp to `dur`).
4. **blendT** (FighterSnap) = weight of the CURRENT anim, a float in [0, 1] (1 = no blend). The state may store
   frames-since-switch (0..6) and `readFighter` converts (`min(1, t / 6)`); the prev anim samples at
   `prevAnimFrame`.
5. **MatchSnap.cinematic.cueId** = the moveId (rule 1) of the Lv3 move that started the cinematic, in the
   cinematic fighter's move list; `cinematic.frame` runs `0 .. cinematic.frames-1`. The view looks up the
   camera track by that move's `cinematic.cue` string (`view/cinematics.ts`), else plays the generic track
   stretched to exactly `cinematic.frames`.
6. **SimEvent payloads** VIEW reads (`a` actor, `b` target, player index 0/1; numbers come from `EV` in
   core/sim/events.ts, never hard-coded by consumers):
   - HIT, BLOCK, COUNTER, PUNISH, PARRY, PERFECT_PARRY, SUPER_HIT, PROJ_HIT: `a` attacker, `b` victim,
     `c` strength class (0 L, 1 M, 2 H, 3 special, 4 super, 5 IMPACT, 6 projectile, 7 throw),
     `d` contact height in cm (hitbox centre y, fighter-local; 0 = unknown -> view uses 120 cm).
   - THROW, THROW_TECH: `a` thrower, `b` victim. KNOCKDOWN, WAKEUP, CRUMPLE, GROUND_BOUNCE, STAGE_FRIGHT_ON/OFF,
     IMPACT_START, IMPACT_ARMOR, TAUNT: `a` fighter. WALL_SPLAT: `a` victim, `b` wall (0 = x -8 m, 1 = x +8 m).
     SUPER_FREEZE: `a` fighter, `b` level (1 | 3). CINEMATIC_START/END: `a` fighter, `b` cueId (rule 5).
     KO: `a` winner, `b` loser, `c` 1 on the match-deciding KO. PROJ_SPAWN/PROJ_CLASH: `a` owner, `b` slot,
     `c` moveId. IMPACT_CLASH: `a`,`b` fighters.
7. The view never interprets `FighterSnap.state` numbers; it uses animId/animFrame, `hitstop`, `flags`.
   Unknown / out-of-range ids render the idle entry (the view never throws on data).

### §17.1 CHANGED(VIEW): view types and asset conventions
- `ViewSettings = { splatter: 'splatter'|'sparks'|'confetti'; screenShake: number /* 0..1 */;
  reduceFlashing: boolean; cinematicCamera: 'full'|'short'; bloom: boolean }` (view/bout.ts exports it;
  UI settings map onto it).
- `RenderInfo = { calls, triangles, programs, textures, geometries, scale, quality, gpu }` (view/renderer.ts).
- `Assets` constructor `base` is OPTIONAL (not a break): omitted = the Vite-resolved `art/gltf/` URLs
  (a `new URL(template-with-${id}, import.meta.url)` per kind, hashed in dist); labs may pass a base
  or `setUrl(kind, id, url)` overrides.
- `BoutView.frame()` also accepts `ev` entries shaped `{frame, type, a, b, c, d}` (the §4.5 ring entries).
- Stage GLB (lane STAGES) conventions the view reads: optional empties `crowd_*` (crowd card placements;
  the card faces the node's +Z; node scale = card height in m), optional `cam_*` empties (ignored for now);
  punctual lights in the GLB join the fixed light pool (they must exist at load and are never added/removed).
  From `data/stages.json` the view reads only (per stage id): optional `glb` (file name in `art/gltf/stages/`,
  default `<id>.glb`), optional `exposure`, `fog: {color, near, far}`, `crowd: {atlas, cols, rows, count}`
  (atlas file in `art/gltf/stages/`). Anything missing falls back to the view's defaults.
- Prop GLB (lane ASSETS) attach metadata = glTF extras on the root node: `{ "attach": { "bone": "RightHand",
  "pos": [x, y, z] /* m, bone space */, "rotDeg": [x, y, z] } }`; the view solves the prop's WORLD transform
  from the bone's full world basis each frame (scale stripped).
- CHANGED(VIEW) presentation only (no sim effect): a fighter with `facing = -1` is drawn with yaw -90 deg AND a
  mirrored model (local X scale -1, the SF4-6 convention) so both sides show the same silhouette to the camera;
  `FighterView.mirror = false` turns it off. Bloom defaults OFF (`ViewSettings.bloom`, quality 'high' only): it
  costs 8 extra programs in the warm-up on the iGPU. The view reads the STAGES §21 fields `lights`,
  `environment` and `crowd.{meta, anchor, tint, brightness}` in addition to the list above.
- CHANGED(VIEW) request to SIM (optional field, breaks nothing): projectile visuals read
  `MatchSnap.proj?: { slot, owner, x, y, vx?, moveId?, alive? }[]` (metres). SIM's MatchSnap has no projectile list
  yet, so the view draws no projectiles until it exists (the FX hook `FxSystem.projectiles()` is ready).

## §18 CHANGED(SHELL): what game.ts / main.ts / testsurface.ts call beyond §16
None of these break an existing signature; each is the ONE place game.ts adapts if the owner shipped a
different shape (game.ts keeps every such call in a small named adapter function).
1. **Events (SIM, core/sim/events.ts):** `export interface SimEvent { frame: number; type: number; a: number;
   b: number; c: number; d: number }` and `export function eventsSince(ring: EventRing, frame: number,
   out: SimEvent[]): number` = append every event still in the ring with `ev.frame >= frame`, oldest first,
   return how many were appended. game.ts calls it once per rendered frame from `lastSeenFrame - 16` and
   dedupes by `(frame,type,a,b)` (rollback re-emits), then hands only NEW events to BoutView/Hud/audio.
   game.ts adapter: `drainEvents()`.
2. **Dev writes (SIM, core/sim/match.ts):** `export function devSet(m: Match, p: 0 | 1, key: 'hp' | 'showtime'
   | 'nerve', v: number): void` - test surface only (`__HP__.dev.setHp / setMeter`, `?dev=1`), never in
   normal play or online. game.ts adapter: `devWrite()`.
3. **Menus (UI, ui/menus.ts) types game.ts builds or passes:**
   - `ScreenId` must include `'title' | 'main' | 'charselect' | 'ladder' | 'online' | 'settings' | 'movelist'
     | 'ending'` (game.ts shows only these; UI may add more).
   - `export interface MatchResult { cfg: MatchCfg; winner: -1 | 0 | 1 /* -1 draw */; wins: [number, number];
     frames: number; forfeit: -1 | 0 | 1 /* the player who forfeited */; fighters: [FighterSnap, FighterSnap];
     match: MatchSnap; season?: { slot: number; slots: number; kind: string; opponent: string; cleared: boolean;
     continues: number } }` - built by game.ts from the sim snapshots only (results numbers = sim). UI's
     ui/types.ts adds the optional `stats: [MatchStats, MatchStats]`, `score`, `best`, `names`, `rated`,
     `disconnect`; game.ts fills `stats` (its own event tallies), `names`, `score` + `season` (THE SEASON),
     `rated` / `disconnect` (online).
   - THE SEASON screens game.ts drives: `showLadder(LadderView)`, `showCard(CardView)` (rival / miniboss / boss /
     brawl / heckler), `showVs(VsView)`, `showResults`, `showNameEntry`, `showEnding({ fighter, score, unlocked })`.
     `startSeason.difficulty` is the menus' INDEX 0 EASY / 1 NORMAL / 2 HARD; game.ts turns it into the ladder
     shift -2 / 0 / +2 (FIGHTING_DESIGN §9b).
   - A sub-screen opened from the pause card: `show('settings' | 'movelist', { from: 'pause', onClose: () =>
     void })`; menus call `onClose` when the player backs out and game.ts re-opens the pause card. ESC or pad
     START on the pause card = 'resume'.
   - Season end: `show('ending', { fighter, length, score })`; dismissing it emits `{ kind: 'quitToTitle' }`.
   - Deps object: `{ showcase, settings, save, audio }` (as §16). The key-remap capture announces itself with a
     window `hp:capture` CustomEvent `{ on }`; SHELL's Input suspends while `on` (no `input` dep needed).
   - Settings shape the menus read/write (ui/settings.ts, persisted in `hitparade.save.v1`): `controls: [P1, P2]`
     each `{ scheme: 0 | 1, keys: Record<Action, string[]>, pad: Record<Action, number[]> }` with Action ids
     `up down left right l m h s assist throw parry impact taunt pause` (<= 3 keys / buttons each; one owner per
     key across both players), `volume {master, music, sfx, voice, crowd}`, `gore`, `screenShake` 0..1,
     `reduceFlashing`, `cinematics`, `bloom`, `quality 'low'|'med'|'high'`, `showFps`, `touchScale`,
     `touchOpacity`, `touchLeftHanded`, `touchScheme 'pad'|'swipe'`, `touchLayout {id: {dx, dy, s}} | null`,
     `haptics`, `language 'en'`. SaveStore.get() also carries `unlocks {freak, ricky}`, `seasonClears`,
     `bestScores`, `board`, `onlineName`; `set({ onlineName })`.
4. **Online (NET, net/online.ts):** `createOnline({ data, version, settings, save })`; the event is
   `on('matchStart', (cfg: MatchCfg, local: 0 | 1) => void)`; game.ts then creates the Match and calls
   `online.attach(m: Match): RollbackSession` (the session binds the transport the lobby opened);
   `online.leave()` on forfeit / quit; `on('matchEnd' | 'disconnect', ...)` optional. Online bouts have no
   sim pause (NETCODE 3.8): ESC opens the pause card while the session keeps ticking.
5. **Touch (UI touch/controls.ts writes, SHELL input.ts owns):** `export interface TouchState { held: number;
   latched: number; active: number }` - §4.4 word bits (`held` = bits the overlay holds now; `latched` = bits
   pressed since the last tick, OR-ed in by the overlay; `active` = touches down). `Input.touch` is that
   object; it feeds player 0 only and is consumed at each sim tick.
6. **App phase** (`__HP__.state().phase`, app/flow.ts): `'boot' | 'loading' | 'title' | 'menu' | 'ready' |
   'bout' | 'paused' | 'results' | 'error'`. `ready` = a bout is loaded behind the PRESS START card (deep
   links without `autostart=1`); `bout` = the sim is stepping.
7. **Settings -> ViewSettings** (SHELL maps, §17.1): `gore` -> `splatter`, `screenShake` (0..1) ->
   `screenShake`, `reduceFlashing`, `cinematics` -> `cinematicCamera`, `bloom`.

## §19 CHANGED(NET): net-facing interfaces (game.ts, UI and the probes build against these)
1. **SimPort** (`core/net/rollback.ts`). `RollbackSession` never imports the sim: it drives a structural port
   `interface SimPort { readonly stateInts: number; step(in1: number, in2: number): void;
   save(slot: Int32Array): void; load(slot: Int32Array): void; checksum(): number }`.
   `core/net/match_port.ts` exports `matchPort(m: Match): SimPort` (wraps §4.1 step/save/load/checksum).
   game.ts never needs it: `online.attach(m)` (§18.4) adapts the Match itself. Probes may pass the toy sim
   (`core/net/toysim.ts`). `SessionOpts.now: () => number` (ms) is injected - core never reads a clock.
2. **Transport** (`core/net/rollback.ts`): `{ readonly kind: 'rtc'|'relay'|'loop'; sendInput(b: Uint8Array);
   sendCtl(b: Uint8Array); drain(cb: (b: Uint8Array, ctl: boolean) => void) }`. Packets are the NETCODE 3.2
   binary layout (`core/net/packet.ts`). The session sends one INPUT packet every `sendEvery` ticks
   (1 on RTC, 6 on relay); the relay transport additionally coalesces to <= 10 packets/s (latest wins).
3. **NetStats** (`session.stats()`, also `__HP__.net()`): `{ transport, frame, delay, window, rttMs,
   rttMedianMs, depth, remoteConfirmed, rollbacks, rollbackFrames, maxRollback, stallTicks, skipTicks,
   ticks, gameSpeed, sent, recv, bytesSent, bytesRecv, lossPct, reordered, silenceMs, desyncs,
   checksumsCompared, lastChecksumFrame, violations, peerAway, status: 'waiting'|'running'|'unstable'|
   'silent'|'nocontest' }`.
4. **Online** (`net/online.ts`, extends §18.4 without breaking it): `createOnline(deps: { data, version,
   settings?, save?, name? })` -> `Online` with `quick(): Promise<void>`, `create(): Promise<string /*code*/>`,
   `join(code: string): Promise<void>`, `pick(p: { fighter: string; color: number; scheme: Scheme;
   stage?: string })` (blind commit-reveal; call once the 'select' event fired), `attach(m: Match):
   RollbackSession`, `finish(r: { winner: -1|0|1; frame: number; checksum: number })` (when the sim's
   MATCH_END fires), `rematch(yes: boolean)`, `leave()`, `stats()`, `readonly phase`, `readonly session`,
   `readonly local`. Events (`on(name, cb)`): `'status' ({ phase, code, rttMs?, transport? })`,
   `'paired' ({ room, host })`, `'select' ({ seconds, opponent, fighters })`, `'opponentLocked' ()`,
   `'reveal' ({ picks })`, `'matchStart' (cfg: MatchCfg, local: 0|1)` (cfg.mode = 'online'),
   `'matchEnd' ({ agreed, winner, reason })`, `'rematch' ({ peerWants })`, `'disconnect' ({ winner })`,
   `'error' ({ code })`. All user-facing text is a `code` key the UI resolves in `data/strings.json`
   (keys listed in `net/online.ts` `NET_STRINGS`; lane UI owns the copy).
5. Deep links (read by net/online.ts helpers, wired by SHELL): `?room=CODE` = join that room; `?relay=1` =
   force the relay tier (test only).
6. **Probe ownership note**: `_harness/probe_synctest.ts` is written by NET (orchestrator lane brief): it runs
   core/net's SyncTest (roll back 1..8 frames every frame) over the REAL `core/sim/match.ts` when it exists,
   all fighter pairs; SIM's own determinism gate stays `probe_determinism.ts`. When `data/` fails
   `loadGameData()` validation it falls back to SIM's fixture kits (`_harness/fixtures/simkit.ts`) and says so.
7. CHANGED(NET) additions (none breaks 1-6; numbering note: `§19 CHANGED(SIM)` below reuses the number, so NET
   items are cited as "NET §19.x"):
   - `Transport.drain(cb: (b, ctl, at?: number) => void)`: optional arrival time on the session clock
     (sharper RTT); omitted = drain time.
   - INPUT flags b4-b7 and control-packet byte 2 carry the **match epoch** (`matchIndex & 15`,
     `SessionOpts.epoch`); a rematch on the same transport drops the previous match's packets
     (`NetStats.stale` counts them). `NetStats` also has `confirmed` (every state <= it is final) and `stale`.
   - Session extras: `setStartAt(t)` (online GO), `proposeDelay(D)` (host, applies on both at one frame),
     `setTransport(t, {window, sendEvery})` (mid-match relay switch), `setAway(b)` (tab hidden),
     `checksumAt(f)`, `confirmedFrame()`, `currentFrame()`, `inputLog(from, to)`.
   - Online semantics: `finish()` may be called on MATCH_END at once - online sends RESULT only when
     `session.confirmedFrame() >= frame`; **keep calling `session.tick()` until 'matchEnd'** (the peer needs
     your confirmations). `roundBreak()` (host, optional) re-derives D between rounds. ONE `Online` serves
     many sessions: `quick/create/join` reset all per-session state (game.ts keeps a single instance).
     `readOnlineParams()` parses the deep links; `NET_STRINGS` = the code -> default EN copy table.
   - Test-only hooks (lab/harness, never in play): `OnlineFlowDeps.wrapTransport`, `OnlineFlow.devKillDirect()`.

## §19 CHANGED(SIM): sim-side rules the fighter JSON, view, UI, AI and NET rely on
SIM adopts §17 (ids, anim table, blendT, cueId, event payloads) and §18.1/§18.2 (`eventsSince`, `devSet`)
exactly. Additions below never break a §4/§5 signature.
1. **Routing of normals, command normals and throws is by the Move `input` field** (for these kinds
   `input` is NOT informational): `5L 5M 5H` stand, `2L 2M 2H` crouch, `j.L j.M j.H` air (`j.2H` = air
   command normal), command normals `6H 4M 3H ...` (digit = facing-relative numpad; a 6X/4X command
   normal wins over 5X while that direction is held, 3X/1X over 2X). A target-combo part uses
   `"input": "5M>5H"`: reachable ONLY through the previous move's `cancel` entry `chain:<moveId>`, triggered
   by the last token (`5H`). Throws: kind `throw`, `input` `LM` (forward) / `4LM` (back); missing throws
   fall back to system.json `throw` numbers (probe_data warns).
2. **Specials** route through `classic` and `simple`. `motion` strings: `236 214 623 421 41236 63214 360
   236236 214214 [4]6 [2]8 22` (facing-relative; DP accepts 323/6236 shortcuts). Classic `{s}` placeholder:
   L→`l`, M→`m`, H→`h`, S→`ex`; S (EX) is accepted whenever the `ex` id exists; `btn` lists the L/M/H buttons
   that trigger; an entry without `{s}` maps every listed button to that one id. CLASSIC supers: 236236 +
   any attack → `simple["S+H"]`, 214214 + any attack → `simple["S+H+2"]` unless a classic entry uses that
   motion. SIMPLE: `5S 6S 2S 4S` (1S/3S → 2S; airborne only when the move has `"air": true`); `S+H`
   neutral/forward/back = Lv1, `S+H` with any down = Lv3 (`S+H+2`); EX = ASSIST+S+dir = the routed id with
   a trailing `_l|_m|_h` replaced by `_ex` (explicit keys `A5S A6S A2S A4S` override); one-button
   specials/supers deal x0.8 (`system.simple.damagePct`). Motions on L/M/H also work in SIMPLE at full damage.
   `assist` = move ids: hold ASSIST + tap L starts step 0 when free; each further tap advances while the
   current route move has connected (hit or block) and is inside its cancel window; whiff resets to step 0.
3. **KD hitstun:** for `onHit.kd` soft|hard WITHOUT an upward launch, `hitstun` = total frames from the hit
   until the defender can act again (fall + lying + wakeup), so on-hit advantage is still
   `hitstun − (active + recovery)` (sweep 10/3/24 KD +33 → hitstun 60). With a launch, juggle physics and
   system.json `kd` decide.
4. **Meters in Move:** `gain.showtime` = attacker gain on hit (on block 50%; defender gets 70% of it when hit,
   25% when blocking; none on whiff); `gain.nerveCost` = NERVE drained from the DEFENDER when the move is
   blocked (omitted → system.json `nerve.blockDrain` by strength); `cost.{showtime,nerve}` = paid by the user
   when the move starts.
5. **Optional Move fields SIM reads:** `strength` (`"L"|"M"|"H"`, default from the input button / id
   suffix / kind), `air` (special usable airborne), `armorBreak` (bool), `starter` (`"light"` forces the
   light-starter scaling table; default: L normals and 2M), `projectile.limit` (default 1), `projectile.x`
   (spawn metres forward; default 0.6), `multi` (frames between hits inside one box's active range; default 0 =
   each box hits once).
6. **System moves** (IMPACT, SHOVE, PARRY, RUSH, default throws) take their numbers from system.json and the
   shared clips `impact_windup`, `shove`, `parry`, `dash_f`; a fighter may override IMPACT/SHOVE frame data with
   moves named `impact` / `shove` (kind `system`). In snapshots a system move reports moveId −1 and
   `moveName` `'impact'|'shove'|'parry'|'rush'|'throw_f'|'throw_b'`.
7. **Snapshot additions:** FighterSnap `+ moveName: string, moveKind: string, stun: number, animSec: number
   (seconds per §17 rule 3, convenience), comboDamage: number, lastDamage: number, airborne: boolean,
   crouching: boolean`. MatchSnap: `phase` is `'intro'|'fight'|'ko'|'timeover'|'roundEnd'|'matchEnd'`;
   `winner` = −1 while undecided and on a drawn match (`draw: true`); `+ roundWinner, freeze, draw`.
8. **Events memory:** the 64-entry ring lives on `Match.events` (outside the Int32Array); the write cursor
   `W.evSeq` is IN the state, so a rollback rewinds it and re-emits. KO on a double KO: `a = b = −1`.
   SFX_CUE: `a` fighter, `b` index into `Match.tab.sfx`, `c` moveId. CAMERA_CUE: `a` fighter, `b` cue
   (`CUE` in events.ts: 1 super freeze, 2 perfect parry, 3 KO, 4 cinematic, 5 wall splat).
9. **Data loading:** `loadGameData()` works in Vite (`import.meta.glob` over `data/**/*.json`) and in Node
   (fs via `process.getBuiltinModule`), so Node probes of every lane can call it. `buildGameData(raw)` is
   exported for fixtures. `GameData.anims` (§17 rule 2) is always built. `dataHash(data)` (uint32 over the
   compiled integer tables) is exported for NET's HELLO; `STATE_VERSION` from core/sim/layout.ts.
10. **Anim table extension (VIEW reads it through `GameData.anims`):** after `taunt`, one entry per move that
   has a §20 `grab` block, in move order: `{ clip: grab.clip, warp: [[0,0],[grab.frames, clip dur]],
   moveId }`. While a landed grab locks (fighter state `GRAB` = 29), `animId` points at that entry and
   `animFrame` counts lock frames. Victims show `thrown_f` / `thrown_b` (swap).
11. **§20 (FIGHTERS) adopted by the sim:** `hits` (per-hit damage / hitstop; non-final hits hold the defender
   until the next hit's first frame + 2 with no KD / launch / pushback; one attack for scaling), `moveY`
   (scripted root height, airborne while > 0), `airVel` (dive from `startup`, ends on landing with
   `recovery` landing frames), `hurtOverride`, `grab` (lock `frames`, damage on lock frame `hitF`, release at
   `+adv`, `swap`, `air`, `techable`, `rangeM` pushbox front to front), `tc` + special `trigger`, `jS`,
   `air: true` = air-only, `cinematic.endAdv` / `endGapM`, projectile `vy` / `g` / `ground`. A `throw`
   WITHOUT a grab block uses the same pushbox-front reach against `throwRangeM`; its victim is locked until
   the thrower's move ends and then knocked down for `hitstun − (active + recovery)`.
   NOT yet in the sim (item 13, uniques): `counter`, `teleport`, `stance`, `ball`, `phase` — moves marked
   `phase: 2` are never routed until the phases unique lands; the others run as their plain frame data.
12. **Motion priority as built:** EX > supers (236236 / 214214) > **360** > DP (623 / 421) > QC > HC > charge >
   22 > throw / parry / IMPACT > assist route > normals > taunt > dash. 360 sits above DP/QC on purpose: with the
   §4b "any 3 of 4 cardinals" leniency a 360 always contains a QC, so a lower 360 could never come out
   (a walked-back 4 + 236 inside 32 frames is a 360 on a kit that has both). A 236236 without meter falls
   through to whatever the sequence contains (623 → DP before QC).
13. **G1 strictness:** `node _harness/probe_data.ts` always FAILS on fixture problems and REPORTS the real
   data/ (errors / template warnings / pending clip, GLB and string refs) in its summary line; the phase gate
   runs `node _harness/probe_data.ts --strict`, which also fails on real-data issues.
14. **Probes:** `probe_synctest.ts` is NET's (§19 NET item 6) and runs this sim over every real pair; SIM's
   save / load / re-step-every-frame check lives in `probe_determinism.ts`. `probe_uniques.ts` is not written
   (item 13 not built yet).

## §20 CHANGED(FIGHTERS): fighter-data and clip-plan additions (all optional; §5/§6/§19 unchanged)
Source of truth for every kit: `data/fighters/_gen/` (python, no `.json` inside, so the `data/**/*.json`
glob never sees it) → emits `data/fighters/<id>.json`, `tools/clipplan/<id>.json`, `_spec/ROSTER.md`.
1. **Ids.** Normals are keyed by their §19.1 `input` (`5L`, `2M`, `j.H`, `6H`, TC parts `5M>5H`); throws are
   `throw_f` (`input` `LM`) and `throw_b` (`4LM`); EVERY special has `<name>_l|_m|_h|_ex` so §19.2 `{s}` and
   SIMPLE EX routing always resolve; supers and follow-up parts use a plain name. Every move carries
   `strength`, `move` (`[[0,0]]` = stationary) and `name` (English display name; UI mirrors it into
   `strings.json` as `move.<fighter>.<moveId>`).
2. **Optional Move fields** (absent = no effect):
   - `hits`: `[{ "f": [a,b], "damage": n, "hitstop": n }]` one entry per hit (move frames, 1 = first frame);
     each entry is one hit with its own box window (derived box per entry when `boxes` is omitted). The move's
     `damage` = the sum (informational). Non-final hits hold the defender in hit/blockstun until the next
     entry's first frame + 2; `hitstun`/`blockstun`/`onHit`/`pushback` apply to the final hit; all entries
     count as ONE attack for damage scaling. (`multi` from §19.5 stays valid for evenly spaced equal hits.)
   - `moveY`: `[[frame, metres]]` attacker root height above the floor (piecewise linear). Frames with height
     > 0 are airborne (air hurtbox, juggle rules, throws whiff). Used by DPs, hops, flips, leaps.
   - `airVel`: `[vx, vy]` m/s set at `startup` for `"air": true` specials (dive kicks); the move ends on
     landing, then `recovery` landing frames.
   - `hurtOverride`: `[{ "f": [a,b], "w": m, "h": m, "y": m }]` replaces the base hurtbox on those frames
     (low profile, crawl, lying, lean); `y` = bottom above the floor (default 0).
   - `grab` (kind `throw` | `cmdgrab`, or a super that grabs): `{ "rangeM", "frames", "adv", "hitF", "swap",
     "air", "techable", "clip" }`. Connects on an active frame when the defender's pushbox front is within
     `rangeM` of the attacker's pushbox front (`throw` without `rangeM` → fighter `throwRangeM`); both fighters
     lock for `frames`, the attacker plays `grab.clip` linearly over them, damage lands on lock frame `hitF`,
     release leaves the defender knocked down so the attacker is `adv` frames ahead; `swap` = sides swap
     (back throw; attacker facing flips at release, the clip may itself turn 180); `air` = catches airborne
     opponents only; `techable` = the 9-frame tech applies (normal throws true, command grabs false). Victim
     plays shared `thrown_f` (swap false) / `thrown_b` (swap true). On whiff `anim.clip` plays through recovery.
     Validator arithmetic for grabs uses `adv` (not hitstun).
   - `tc`: true = reachable only through a parent's `chain:<id>`. Special rekka parts add
     `trigger: { "classic": { "motion": "236", "btn": "LMH" }, "simple": "6S" }` (the input that fires the
     chain inside the parent's cancel window); normal target combos keep §19.1 (`"input": "5M>5H"`).
   - `counter`: `{ "catch": [a,b], "vs": ["strike"] | ["strike","proj"], "follow": "<moveId>" }` - a listed
     hit arriving on catch frames is nullified (attacker gets 12 hitstop, then is in recovery = punish
     counter) and `follow` starts at once. Throws and cmd grabs beat it.
   - `teleport`: `{ "f": n, "to": "behind" | "front" | "home", "gapM": m }` - on move frame f the fighter's x
     becomes opponent.x + side*gapM (behind = far side of the opponent, front = own side, home = own wall
     + gapM), clamped to the walls; facing re-resolves on the next free frame.
   - `stance`: `"enter" | "follow" | "exit"` (Lotus, see 3). `ball`: `{ "act": "shoot" | "hover" | "summon" }`
     (Gazza, see 3). `phase`: 2 = exists only in Ricky's phase 2.
   - `cinematic` extras: `anim` `[[f0, "<clipId>"], ...]` attacker clip timeline (clip starts at f0, 1 clip
     second per 60 frames), `victim` `[[f0, "<shared clip id>"], ...]`, `shots` `[[f0, "<shot>"], ...]`
     camera beats for view/cinematics.ts (shot names in `_spec/ROSTER.md`), `endAdv` (attacker advantage at
     the end, defender knocked down), `endGapM` (separation at the end).
   - `desc`: one-line description (informational; UI move-list source).
   - `role`: informational tag list (`antiair`, `sweep`, `overhead`, `poke`, `launcher`, `reversal`,
     `projectile`, `approach`, `wallsplat`, `low`, `lowprofile`, `grab`, `escape`) - the G1 punishability
     exemption (sweep / antiair) and CPU move picking (lane AI) read it.
   - `classic[]` entries may carry an informational `note`; a move id ending in `_l|_m|_h|_ex` is ALWAYS a
     strength of a special family (follow-ups use other names, e.g. `grave_rise_big`).
3. **`unique` blocks** (numbers the uniques' probes check):
   - `{ "kind": "none", "trait": "<text>" }` (johnny, patch, spin; their identity is in the move data).
   - `stance` (lotus): `{ "name", "enter": [ids], "maxF", "followups": { "L": id, "M": id, "H": id },
     "exit": { "2": id, "timeout": id }, "blockExitF", "walk": { "fwd", "back" }, "clips": { "idle", "walk_f",
     "walk_b" } }` - enter moves put the fighter in the stance after their recovery; in stance L/M/H fire the
     follow-ups (§19 cancel rules don't apply), 2 or `maxF` exits, holding back exits to block after
     `blockExitF` frames.
   - `charge` (krane): `{ "chargeF": 45, "keepF": 10, "standBlockNervePct": 50 }` - blocking STANDING drains
     only that % of the normal NERVE block drain (riot shield).
   - `ball` (gazza): `{ "respawnF", "restF", "pickupM", "hover": { "l", "m", "h", "frames" }, "bounces" }` -
     one ball entity in the projectile block: shots fire it, it rebounds off a wall `bounces` times, rests on
     the floor `restF` frames (walking within `pickupM` traps it back), hover = keepy-uppy hitbox above Gazza;
     an opponent strike on the ball knocks it away (respawns at his feet after `respawnF`).
   - `counter` (rerun): `{ "moves": [ids] }` - the per-move `counter` blocks hold the numbers.
   - `armorStep` (bruno, boneyard, freak): `{ "steps": [ids], "armored": [ids] }` - move-level `armor` holds
     the numbers; steps may `whiff`-cancel into the listed chains.
   - `teleport` (zambini): `{ "moves": [ids] }` - move-level `teleport` blocks.
   - `phases` (ricky): `{ "thresholdPct": 50, "lockF": 60, "cue": "ricky_phase2", "moves": [ids with phase 2],
     "lv3": "<moveId used by S+H+2 in phase 2>", "simple": { "6S": "<moveId>" } }` - first drop below 50% HP
     in any round: both fighters lock `lockF` frames (camera cue), then the phase-2 moves exist for the rest
     of the bout and `simple` overrides those SIMPLE keys (CLASSIC keeps every motion).
4. **SIMPLE air key:** `"jS": "<moveId>"` = S while airborne (must be `air: true`); ground keys unchanged.
   A classic motion may map to a ground move and an `air: true` move at the same time (airborne picks the air one).
5. **Clip plan entries** (`tools/clipplan/<fighter>.json`, extends §6.2). The emitted entries follow lane
   ASSETS' live builder (`tools/build_fighters.py` -> `art/blender/bake_fighter.py`, read 2026-09-29) so they bake
   without translation; intent fields ride along as extras:
   `{ "<clipId>": { "src": "mixamo"|"cmu"|"layer"|"seq"|"author", "file", "range": [f0,f1], "contact",
   "mirror", "speed", "loop", "air", "marks", ... } }`
   - mixamo `file` = `"<Pack>/<clip>"` (NO `.fbx`; the builder appends it) under
     `F:/games/forgeflow-games-assets/_downloaded/mixamo/animations/`, `range` 1-based source frames at 30 fps.
     cmu `file` = take id (`"14_02"`), `range` source frames at 120 fps, plus `kind` (hand|foot|knee|getup|fall|
     body), `limb` (post-mirror, e.g. `L_hand`), `fist` (deg of finger curl; 0 = open hand).
   - `contact` = authoritative strike frame in SOURCE frames (research front-pass frame for strikes, render-
     judged frame for slams/releases); the builder writes clips.json `contact` from it. Multi-hit sources add
     `marks: {"hit1": f, "hit2": f, ...}` (source frames; the builder converts them to clips.json marks seconds)
     and the same list as `contacts`; fighter data derives multi-hit `anim.warp` from them.
   - `air: "strip"` on every clip the sim plays airborne (jump normals, moves with `moveY`, `air: true`): the sim
     owns the height, so the clip's own lift is removed (ASSETS option; clips.json `apexY` keeps it).
   - layer: `"layer": { "lower": <entry>, "upper": <entry>, "split": "Spine", "lowerMode": "hold"|"loop"|"sync",
     "lowerFrame": f }`. Intent: legs from `lower`, Spine-up from `upper`, the result plays at the UPPER's own
     timing. Emitted form for the builder (whose LayerSampler warps the upper onto the lower's frame count and
     converts `contact` through the lower): the lower's `speed` is set so it yields exactly the upper's frame
     count (`_upperFrames`; hold = range `[lowerFrame, lowerFrame+1]`), and the layer `contact` is expressed in
     LOWER source frames (`_upperContact` keeps the upper's frame). validate.py checks both.
   - seq: `"seq": [<entry>, ...], "xf": 2` - concatenated in order, segment k starts where k-1 ends minus `xf`
     frames (30 fps) of crossfade; `contact` = first segment's. Supported by the builder since ASSETS part 2
     (§6.2): used by 13 clips - the multi-hit supers (johnny `sold_out_flurry`, patch `reel_kicks`, krane
     `backup_combo`, lotus `bottoms_seq`, freak `meltdown_clip`), Spin's flair chains (`windmill_l`, `windmill_m`,
     `windmill_h`, `cypher_clip`, `handspin_clip`, `six_step_ex_clip`) and rerun `crawl_run`, `crawl_run_ex`. Segment
     durations follow the builder's frame counts (CMU windows get an extra end frame when not a multiple of 4).
   - author: `"src": "author", "file": "crouch_toe_kick" | "crouch_shin_kick", "frames": n, "contact": k`
     (0-based output frame) + `_base` / `_keys` (the key poses, also in `_spec/ROSTER.md`). Both specs exist in
     `art/blender/author_clips.py` (ASSETS part 2) - the only authored motions in the roster (CMU has no
     crouch-kick class).
   - `effector` (bone key of ASSETS' EFFECTORS: RightHand/LeftHand/RightFoot/LeftFoot/RightKnee/LeftKnee/Head) may
     be set on any entry, including a layer entry (build.py passes it through), when the auto pick would name the
     wrong limb (lotus `knee_lift` = RightKnee, ricky `cane_twirl` = RightHand).
6. **CHANGED(FIGHTERS) part 2 (2026-09-30) - hurtboxes and hit volumes, measured in the real sim** (additive; no
   signature changes; SIM / VIEW / AI read the same fields as before):
   - **Hurtbox heights are measured**, not a height ratio: `hurt.stand[1]` / `hurt.crouch[1]` = median mesh top of
     the `idle` / `crouch_idle` clip the fighter plays (Blender on ASSETS' raw.glb, 7 frames; crouch clamped to
     stand). The old rule (crouch 0.60 H) sat 0.13-0.29 m under every real crouch pose. Widths unchanged.
   - **Crouch line 1.10 m** (lowest measured crouch top, krane 1.159, minus 0.05) and **point-blank reach**
     `(pushbox_w + 0.39) / 2 + 0.23 - 0.10` m (the slimmest defender touching). Every grounded strike that is not
     `role: antiair` (or the informational `role: high` = whiffs crouchers by design; unused today) has a box reaching
     both; an anti-air that is also `role: reversal` (the DPs) must reach both with its FIRST hit (extension cap 0.60 m:
     the rising arm sweeps that space during the first active frames). Where SIM's derived box (§5.2: centred on the clips.json effector) does not, `build.py` writes the SAME box
     widened (bottom lowered / near edge pulled back; top, reach, frames unchanged) as explicit `boxes` and tags the
     move with the informational `"boxSrc": "hitVolume"`. Those boxes are computed from `data/clips/<id>.clips.json`:
     **after every lane ASSETS re-bake run `python data/fighters/_gen/build.py` and `validate.py`** (the validator
     fails on a `hitVolume` box that no longer matches the effector, and lists clips whose plan changed since the
     published bake as PENDING). Straight projectiles also reach the line (`projectile.y - box_h / 2 <= 1.10`).
     Before: 53 of 307 damaging ground moves whiffed crouching opponents in the sim (incl. overheads, johnny /
     zambini projectiles and 6 supers); freak 5M never connected; krane's low 2L never hit a crouch.
   - Request to lane SIM (G1): `probe_data.ts` computes a `hits` move's block advantage as `blockstun - (active +
     recovery)`, but the sim applies stun from the FINAL hit (§20.2, adopted in §19.11): advantage =
     `stun - (startup + active + recovery - hits[last].f[0])`. Measured in the real sim: spin `5H` blocked = -3
     (data -3), probe_data says -8 and fails `--strict` on it (the only G1 failure).
   - Request to lane ASSETS: per-mark effector points in clips.json (e.g. `"marksAt": {"hit1": [x_fwd, y_up], ...}`,
     measured like `effector.at`), and to lane SIM: derive one box per `hits` entry at its mark's point when present.
     Today every hit of a multi-hit move is derived at the FIRST contact's point (one effector per clip), so kits hand-
     set per-hit boxes where it matters (patch `highlight_reel`, lotus `bottoms_up`).
   - Open: weapon props (baton, cleaver, mic-cane) are attached at runtime and are not in the effector point, so a
     weapon strike's box ends at the hand; prop reach is not modelled yet (needs the prop lengths from §6.4).
   - A fighter plan MAY define a shared clip id (§6.2 list, e.g. Krane's shield `idle`/`block_high`); the
     fighter entry wins over `_shared.json` for that body (the builder already does this).
   - Keys starting with `_` (`_why`, `_cand`, `_upperFrames`, `_upperContact`, `_base`, `_keys`) are informational;
     nested `<entry>` objects use the same fields.


## §21 CHANGED(STAGES): stages.json schema, stage GLB nodes, crowd atlas (extends §6.4 / §17.1, breaks nothing)
Everything §17.1 says the view reads is unchanged (`glb`, `exposure`, `fog`, `crowd: {atlas, cols, rows, count}`,
`crowd_*` empties). This section pins the rest so VIEW/AUDIO/UI/SIM probes can build against it.
1. **File shape:** `data/stages.json = { version: 1, units, budget, stages: StageDef[] }` - an ARRAY in ladder/select
   order (UI `stageList()` already reads `{stages:[...]}`). A stage is found by `stages.find(s => s.id === id)`.
   `status: 'built' | 'todo'`; a `todo` stage has no `glb` on disk yet (callers fall back to a built stage).
2. **StageDef (built)** - all metres in game axes (§2), light intensities in three.js r186 physical units:
   `id, name, status, glb, source, home: fighterId[], look,`
   `floor: { y, surface, fightStrip: {x:[-8,8], z:[-1.5,1.5]}, extent: {x, z} },`
   `walls: { x: [-8, 8], splat: [{ id /* = WALL_SPLAT b, §17.6 */, x, normal, z: [z0,z1], heightM, surface, dustColor }] },`
   `spawn: { distanceM, p1: [x,y,z], p2 },  camera: { vFovDeg, heightM, lookAtY, distanceM: [min,max], pitchDeg,`
   `wallClampX, proofShots: [{id, pos, look, aspect?}] },  exposure, toneMapping: 'neutral',`
   `fog: { color, near, far }  (three.js linear THREE.Fog),`
   `environment: { hdr /* file in art/gltf/stages/, IBL only */, intensity /* scene.environmentIntensity */,`
   `background: false, backgroundColor },`
   `lights: LightDef[]  - the FIXED pool, created once at stage load, never added/removed; NO lights in the GLB:`
   `  { id, type: 'directional', color, intensity, position, target, castShadow, shadow?: { mapSize, bias,`
   `    normalBias, camera: {left,right,top,bottom,near,far} } }`
   `  { id, type: 'hemisphere', sky, ground, intensity }`
   `  { id, type: 'point', color, intensity /* cd */, distance, decay, position, flicker?: { amp, hz } }`
   `  { id, type: 'spot', color, intensity, distance, decay, position, target, angleDeg /* = SpotLight.angle, half-cone */, penumbra }`
   `  flicker = view-only intensity modulation (never touches the sim).`
   `crowd: { atlas, meta, cols, rows, count, cardHeightM, cardWidthM, anchor: [u, v_from_top], tint, brightness,`
   `  moods: { idle: pose[], cheer: pose[], jeer: pose[] }, bays: [{ id, x: [x0,x1], spacing, jitter: [jx,jz],`
   `  faceYawDeg, rows: [{z, y}], seed }] },`
   `music /* cue id AUDIO maps */, musicHint, ambient, ambientHint, dressing: { animated: [...] },`
   `build: { bytes, draws, triangles, materials, textures, crowdNodes, extensions, envBytes }  (measured, generated).`
3. **Stage GLB nodes:** `crowd_<bay>_<row>_<i>` empties (190 in rust_theater): translation = the FEET point on the
   floor/tier, rotation = card facing (+Z of the node), uniform scale = card height (m); glTF extras
   `{ bay, row, i, rand /* 0..1 */, angle: 'front'|'left'|'right' /* which atlas view column suits the spot */ }`.
   Animated dressing meshes are separate named nodes: `flame_torches` (both torch flames), `marquee_bulbs`.
   Everything else is one static mesh `<id>_set` (one primitive per material). No lights, no cameras.
4. **Crowd atlas** `art/gltf/stages/crowd_atlas.webp` + `crowd_atlas.json` (shared by all stages): grid of `cols x rows`
   cells (rows = bodies, cols = pose*3 + angle); each cell covers `metresPerCellWidth x metresPerCellHeight`
   (1.2 x 2.4 m) with the feet at `anchor` (cell-normalised, v DOWN from the cell top). `cells[]` gives `rect` (px),
   `uv` = [u0, v0, u1, v1] in glTF/three UV space (v up, flipY texture), `body, pose, angle, restHeightM`. Colours are
   already toon-shaded + outlined in sRGB: draw with an unlit material, `alphaTest 0.5`, `toneMapped: false`,
   colour = `tint x brightness`; cards may be mirrored in U when `angle === 'front'`. Reference implementation of the
   card placement / cell pick / UV remap: `runtime/src/lab/stages.ts` (dev lab, lane STAGES).

## §22 CHANGED(UI): UI-side additions (all additive; §8 / §16 / §18.3 signatures unchanged)
Source of truth: `runtime/src/ui/types.ts` (structural types: the SIM / SHELL / VIEW / AUDIO objects satisfy them
without imports), `_spec/CONTRACT_MOBILE.md` (touch), lab `runtime/lab/ui.html` (every screen + HUD state).
1. **Hud** (ui/hud.ts) beyond §16: `setScore(n | null)` (arcade score; null = sum SCORE events), `setNames([a, b])`
   (online display names), `setEpisodeLine(s)` (the bug's line), `setPortraits({id: url})`, `cue(captionEvent, vars)`
   (e.g. `'boss_phase2'` when Ricky flips), `setTraining({inputs, frames} | null)` + `pushInputs(word, frame)` +
   `setRecordState('off'|'record'|'play')` (training overlays; `mount()` turns them on for `mode: 'training'`),
   `tally(): [MatchStats, MatchStats]` (per-match numbers from the deduped events + snapshots), `setTouchMode(on)`,
   `readback()`, `readonly broadcast: Broadcast`. Event payloads read exactly per §17 rule 6 / §19.8; round / match
   winners from `MatchSnap.roundWinner / winner`; the combo counter reads the ATTACKER's `combo` / `comboDamage`;
   `timer < 0` = infinite. **SCORE** (not fixed by SIM): the HUD reads `a` = player, `b` = points - SIM please confirm.
2. **Menus** (ui/menus.ts) beyond §16 / §18.3: `ScreenId` = `'title'|'main'|'season'|'versus'|'charselect'|'stage'|'vs'|
   'results'|'ladder'|'card'|'ending'|'nameentry'|'pause'|'settings'|'training'|'movelist'|'online'|'credits'`;
   `show('charselect', {mode: 'season'|'versus'|'training'|'online', opponent?})`, `show('movelist', {fighter?, scheme?,
   from?, onClose?})`, `show('online', {status})`; `showPause({training?, online?, fighter?, scheme?})` resolves
   'resume' | 'forfeit' | 'settings' | 'movelist' (TRAINING OPTIONS is a pause-stack child inside the menus; its values
   live in `menus.training: TrainingState` - `get()`, `set()`, `on((opts, 'change'|'reset') => ...)`);
   `showResults` resolves 'next' for an arcade win / bonus round; `showVs(v, autoMs = 2600)`; `setOnlineStatus(s)` also
   takes NET's `{ code, ...vars }` payload (codes resolved in strings.json); `revealOpponent(pick)` (blind select);
   `setMoveList(fighter, scheme)`; `setPortraits({id: url})`; `showcaseRect(): Rect | null`; `confirm(title, body, yes,
   no): Promise<boolean>`; `setTouchMode(on)`; `update(dt)` (optional: the menus poll pads + drive the Showcase with
   their own rAF while visible); `readback()`. **MenuIntent** adds `{kind: 'onlinePick', fighter, color, scheme}` (the
   blind-select lock-in) and `online.action 'cancel'` (+ optional `name`). Optional dep `input: {suspended, releaseAll?}`
   is honoured when passed (the `hp:capture` event is always sent).
3. **Showcase** (VIEW, optional methods): `setRect(r | null)` - the menus pass the character-select region (CSS px)
   each frame it changes, `null` on leave; `hide()`. While the select screen shows, the menus call `frame(dt)` +
   `render()` from their loop unless `menus.driveShowcase = false` (then game.ts renders it, reading `showcaseRect()`).
   Portraits: the menus / HUD show `setPortraits` images; until a fighter has one, a comic initials badge stands in -
   VIEW is asked to render head-and-shoulder portraits from the Showcase (idle pose) and hand them in.
4. **FighterSnap `actionable?: boolean`** (SIM request, optional): true when the fighter can act. The training
   frame-advantage readout uses it; without it the fallback is `stun <= 0 && hitstop <= 0 && moveId < 0`.
5. **Fighter data** (FIGHTERS, optional): `difficulty` 1..3 (select-screen stars; fallback by archetype). Move names:
   `python _harness/menus.py --sync-strings` mirrors every move `name` into strings.json as `move.<fighter>.<moveId>`
   and `unique.trait` as `trait.<fighter>` (§20.1); the move list prefers those keys.
6. **Audio cues** the UI sends (AUDIO): `ui('move'|'select'|'back'|'start'|'error')`; `music('menu')` on title / main,
   `music('charselect')` on the select screen, `music('results')` on results.
7. **Test surface** (SHELL): please expose `__HP__.menus()` / `__HP__.hud()` / `__HP__.touch()` (= the modules'
   `readback()`) and `__HP__.dev.touchWord()` (= `touch.readWord()`): `_harness/menus.py --game`, `layoutcheck.py
   --base`, `mobile.py --game` read them at integration.
8. **CardView** `{kind, a?, b?, banter?, seconds?}` (`seconds` = bonus length from the ladder, default 45 / 40),
   **LadderView** `{fighter, color, length, bouts: [{kind, opponent?, result?}], current, score, ratings?}`,
   **VsView** `{p: [{fighter, color, label?}, ...], stage, mode, episode?, kind?, rated?}`.

## §23 CHANGED(AI): CPU, personas, cpu.json, ladder.json (additive; §11 / §16 unchanged)
1. **`core/ai/cpu.ts`**: `createCpu(level, fighterId, seed): Cpu` exactly as §16. `Cpu = { level, fighter,
   input(m, p): number, prepare(m, p): void, brain }`. `input` = the §4.4 word for player `p` this frame; call it
   once per sim frame BEFORE `step` (game.ts does); it returns 0 in `brawl` / `heckler` / `online` matches (the goons
   and heckle objects are sim-driven; the CPU never runs online). `prepare(m, p)` (optional to call) = the one-time
   warm-up: it measures the fighter's input recipes in a private sandbox Match (3-60 ms per fighter + scheme per
   GameData, cached) - SHELL may call it right after `createMatch` while the loading card is up so the first tick
   of a bout does not pay it; it never touches the match state. The CPU plays the control scheme of its own
   `PlayerCfg.scheme` (SIMPLE one-button specials or CLASSIC motions, both measured).
2. **What the CPU reads**: `m.data.cpu` (GameData.cpu = data/cpu.json; the same file is bundled into cpu.ts as the
   fallback for GameData built without it), `m.cf[i]` compiled moves (read-only), `m.cfg`, and the state ONLY through
   `core/ai/sense.ts`. It never writes to the state and never reads the opponent's input-derived fields (raw, prevRaw,
   hHead, hist, bufA/bufM/bufAge/bufWin/bufF, ageL..ageS, chB..chDR); `probe_personas` H2/H3 prove both every run.
3. **Reaction semantics** (FIGHTING_DESIGN §10 "reaction delay to a VISIBLE startup"): the response is in place
   `reactF` frames after the attacker's first startup frame is shown = on the attacker's move frame `reactF + 1`
   (sim frames; a super freeze or hitstop counts as watchable time). L8 (18 f) blocks a 19 f overhead on reaction,
   not an 18 f one (e.g. johnny 6H is 18 f); a faster move is blocked only by an already-held guard (a guess). If the
   design wants L8 to react to 18 f overheads, set L8 `reactF` 17 and `rules.reactFloor` 17 in cpu.json (data only).
   One latched roll per incoming attack (move instance / jump / projectile); the punish decision is its own latched roll.
4. **`data/cpu.json`**: `levels[0..8]` = the FIGHTING_DESIGN §10 table verbatim (`reactF, block, guessAdapt, antiAir,
   punish, route 'jab'|'single'|'two'|'chainSpecial'|'bnb'|'bnbMeter'|'bestMeterless'|'bestMeter'|'bestCorner', tech,
   parry 'never'|'rare'|'projectiles'|'slow'|'perfect'|'rush'|'baits', meter 'never'|'ex'|'lv1'|'all'|'cancel', nerve
   'none'|'avoid'|'burnout'|'impactReads'|'counterImpact', drop, aggression (number | 'adapts')`) plus the lane's [R]
   levers `guard` (neutral guard posture), `thinkF`, `antiZone`; `rules` (reactFloor, whiffReactPct, parryShare per
   tier, slowStrikeStartup, avoidFrightNerve, adaptAggression, backRise, wakeReversal); `styles` = plan weights per
   fighter `cpu.style` (`balanced` -> shoto; `boss_armor`, `boss_showman` have their own rows); `personas` (harness);
   `boss` = tools per boss id (`freak: armor`, `ricky: counter + phases`; tools never make reactions faster).
5. **Fighter JSON `cpu` block** (FIGHTERS, as shipped): `style`, `rangeM [lo, hi]` (preferred spacing), move-id lists
   `pokes antiAir punish combo zoning approach grab armor counter mixup setup escape air phase2`, `meter`. Lists are
   resolved to MEASURED recipes (`core/ai/kit.ts`); a move the sim cannot start from neutral, or a move with no hitbox /
   projectile / grab (a stance entry, a teleport / counter move while those uniques are not in the sim) is never thrown
   out as an attack. The counter tool (Rerun PLAY DEAD, Ricky COMMERCIAL BREAK) switches on by itself once the compiled
   move carries the §20 `counter` block.
6. **`data/ladder.json`**: `season` / `pilot` slot arrays exactly as app/flow.ts `ladderSpecs()` reads them (`{kind,
   level, opponent?, stage?}`, Normal levels L2 L3 L3 BRAWL L4 RIVAL-L5 L5 HECKLER FREAK-L6 RICKY-L6; PILOT L2 L3 BRAWL L4
   FREAK-L6 RICKY-L6) plus reference data for UI / SHELL: `difficulty {easy -2, normal 0, hard 2, minLevel, maxLevel}`,
   `bouts {rounds, timer, arcadeTieCpuWins}`, `bonus.{brawl,heckler} {mode, seconds 45 / 40, card}`, `continues
   {unlimited, resetEpisodeRatings, bossRestartsBout}`, `miniBoss`, `boss`, `rivals [{fighter, rival, banter:
   [stringKey, stringKey]}]` (the §5.4 rival column; same as fighters/<id>.json `rival`), `cards.<kind>` string keys,
   `endings.<fighterId>` string keys (+ `default`), `unlocks.seasonClear`.
7. **Harness**: `core/ai/personas.ts` `createPersona('masher'|'turtle'|'jumper'|'zoner'|'novice'|'optimal', fighter,
   seed): Cpu` (harness only - the game never imports it). `node _harness/probe_personas.ts --seeds 1..20` = G3 (the §11
   acceptance numbers gate); with no args (as run_probes runs it) = smoke: seeds 1..3, the honesty checks (determinism,
   input-blind, read-only, reaction clock) gate and the acceptance numbers are reported only.
8. **Training** (SHELL / UI note): `?mode=training` defaults P2 to CPU 0 = the TUTOR band, which walks in and attacks
   (aggression 0.2) - a still dummy is no CPU at all (`cpu: -1`) plus the UI's dummy options.
9. CHANGED(AI) 2026-09-30 (additive, AI-internal; no other lane consumes it): **respect a presser**. `cpu.json`
   `rules.press {rate 0.10, windowF 32}` = the opponent counts as PRESSING when the share of its free ground frames
   inside its own fast-button zone that ended in an attack start (EMA, time constant windowF) is >= rate (built from
   visible move starts only; measured: masher 0.09-0.33, CPU L6 0.002-0.10). Profile lever `respect` (level rows and
   personas; default 0 = off and no RNG roll) = chance per neutral decision to respect a presser inside the range of
   the buttons it has been pressing (its last 6 visible ground strikes): swing the most damaging normal of mine that
   meets it where its walk-in stops, at least 2 f before any of those buttons (`brain.spacePoke`), else hold a guard -
   and never walk / dash into that zone. ON for the harness `optimal` persona (0.9); OFF for all CPU levels and the
   novice (a P4 lever: 10-seed test vs the masher gave L4 4->5, L6 4->5, L8 7->6 wins, no clear gain). With it at 0
   the CPU levels play bit-identically to before (probe_personas level lines identical on 60 seeds). `BrainStats`
   gains `respects`, `spacePokes`. Walking is not in `F.vx` (the sim moves walkers by walk speed), so the brain
   derives closing speed from the visible WALK_F / DASH_F state and the opponent's known walk / dash speeds.

## §24 CHANGED(integrator): P1 integration (2026-09-30; additive, no signature broken)
Cross-lane edits made so the lanes fit together; each file carries a `CHANGED(integrator)` note at the change.
1. **Audio wiring (game.ts, per §9.1):** a mounted bout calls `audio.bout({fighters, stage, mode, local, sfxNames: m.tab.sfx})`,
   `setSplatter(settings.gore)` (and on change), `preload()` (no ids = the bout set), `music('stage')`; every rendered frame
   `events(ev, m, [f0, f1])`; pause / resume `setPaused(true|false)`; teardown `bout(null)`. `local` = the human side vs a
   CPU, `-1` for local 2P, the online side online. (Was: `preload([stage, fighters])` and no `bout()`.)
2. **Pause keys:** a pause key that pauses the bout consumes its KeyboardEvent (`preventDefault`); Input listens in the
   capture phase and the menus in the bubble phase, so ESC used to pause and the same keydown resumed at once on the
   card. The menus seed each pad's previous buttons when their loop starts (`startLoop`), so the START that paused is not
   also a fresh press on the pause card.
3. **Touch overlay wired:** main.ts creates `TouchControls(uiRoot, input.touch, settings-derived opts)`; `onPause` -> the ESC
   pause path; `onLayout` -> `settings.set({touchLayout})`; touch settings apply live. `GameDeps.touch?` : game.ts shows the
   overlay only while a bout steps in touch mode and feeds `setMeters` from the local fighter each frame.
4. **Test surface (§12 + UI §22.7):** `__HP__.menus()` / `__HP__.hud()` (= readback()), `__HP__.touch()` now also carries the
   overlay read-back, `__HP__.dev.touchWord()` (= `TouchControls.readWord()`, dev only).
5. **Character-select 3D Showcase in the game:** the Showcase renders into the `#game` canvas UNDER the DOM and every menu
   screen paints an opaque backdrop, so the model was invisible in the integrated game (the UI lab used a DOM stub). While
   the select screen drives the Showcase, the screen moves its backdrop to `::before` with a CSS mask hole at
   `showcaseRect()` (`.hpm-s-charselect.hpm-3d`, CSS vars `--sc-x/-y/-w/-h`, set by menus.ts). `Showcase.backdrop` (sRGB hex,
   default `0x1d0d1b`) = the region's opaque clear colour (the context is `alpha:false`).
6. **Portraits (UI §22.3):** `Showcase.portrait(fighterId, color = 0, size = 256): Promise<string | null>` renders a
   head-and-shoulders PNG data URL (toon material + outline, idle pose, transparent background) into its own targets.
   `app/portraits.ts` `PortraitQueue` (SHELL area) renders them one at a time and hands each to `menus.setPortraits()`:
   `need(id)` (hovered select fighter, both bout fighters) jumps the queue; `all(ids)` renders the roster in the background
   1.5 s after boot and waits while a bout loads / steps. `GameDeps.portraits?`.
7. **COMING SOON slots:** `ui/data.ts hasAssets(data, id)` = the fighter's GLB is in the build (Vite glob of
   `art/gltf/fighters/*.glb`, URL only) AND its clips table loaded (true outside Vite). A fighter without assets is a locked
   `soon` slot labelled `cs.soon` (hint `cs.soonHint`, strings.json) - never a broken slot; THE SEASON roster (game.ts) skips
   it. Today all 12 fighters have assets, so no slot shows it.
8. **Harness:** `_harness/playtest.py` (G6, lane AI's file, never written) now exists: menus -> VERSUS -> CPU L1 -> a full
   best-of-3 bout by REAL keys (walk, jab, special, throw, parry, IMPACT, super) with HUD / audio / results = sim checks,
   then REMATCH -> ESC pause / resume -> FORFEIT -> MAIN MENU. `bootcheck.py` G4: a projectile special counts (PROJ_HIT c = 6,
   §17 rule 6); the walk is judged on the frames P1 spends in walk_f (>= 0.3 m, up to 3 x 0.9 s holds toward P2) and each
   jab first walks back into range - the live CPU knocks P1 down, throws it across and pushes it between checks.
   `probe_data.ts`: a `hits` move's advantage is measured from the FINAL hit's first frame (the §20.6 request): spin 5H
   blocked = -3, as the sim measures.
9. **Asset repair:** the working copy of `runtime/src/audio/assets/sfx.m4a` had one flipped bit (offset 880466; same size
   and mtime, so git status missed it) and failed probe_audio's AAC decode; restored from a fresh `aac_twin()` encode that
   is byte-identical to the committed blob (md5 b85f8ce3cfbaf93082ce081624e39fe0).
10. **`MatchSnap.proj` (SIM, the §17.1 request):** `readMatch()` returns `proj: [{ slot, owner, x, y (m), vx (m/s), moveId (§17
   rule 1), kind (0 projectile, 1 ball, 2 heckle), alive }]` for every active projectile slot (a read-only copy, never in
   the state or the checksum; core/types.ts `MatchSnap.proj?`). The view's `FxSystem.projectiles()` draws it; before this a
   projectile special flew invisibly in the game.
11. **`todo` stages (§21.1 fallback):** `ui/data.ts StageRow.built` (stages.json `status !== 'todo'`) and
   `playableStage(data, id)` (= id when built, else the first built stage). game.ts applies it to every bout (THE SEASON
   home stages, training, deep links, online - both peers compute the same) and to the season VS card; the stage select
   shows todo stages as COMING SOON (not selectable) and RANDOM picks among built stages only. Before: bruno's home stage
   `butcher_block` (no GLB) loaded the view's primitive stand-in set.
12. **Pointer input on the menus:** `runtime/index.html` gives `#ui` `pointer-events: none` (the HUD must never eat input) and
   the menus root inherited it, so no mouse click or touch tap reached a menu in the integrated game (the UI lab host does
   not set it). `.hpm { pointer-events: auto }` (menus.css). `_harness/mobile.py --game` now runs (was a stub): the touch
   overlay in a real deep-linked bout on 5 devices.
13. **THE SEASON bonus slots:** the sim has no BRAWL BREAK / HECKLER TOSS yet (no core/sim/brawl.ts, no GOON_SPAWN /
   HECKLE_THROW emitters), so game.ts `BONUS_ROUNDS_IN_SIM = false` passes over bonus slots (recorded as played, 0 points)
   instead of staging a mirror bout against an idle clone. SIM flips it with the P3 modes.
14. **EXIT TRAINING:** the training pause card's forfeit button (EXIT TRAINING, no confirm) goes straight to the main menu,
   as the UI lab flow does; no "BY FORFEIT" results card for a practice session.

## §25 CHANGED(fixer): P1 verifier fixes (2026-09-30; additive except where marked, every file carries `CHANGED(fixer)` notes)
1. **Round banners follow the sim phases (D1, ui/broadcast.ts, ui/hud.ts):** `Broadcast.sweep(text, {tone, sub, ms, cut, onStart})`
   - `cut: true` drops the showing sweep + queue (their promises resolve) and plays at once; `cutSweeps()`. The HUD cuts on
   ROUND_INTRO / FIGHT / KO / TIMEOVER and queues the round VERDICT (PERFECT with `<NAME> WINS` as sub / `<NAME> WINS` / DRAW)
   on the KO / TIMEOVER frame (the sim decides the round there; ROUND_END is one frame before the next ROUND_INTRO). Durations
   come from `system.json round` (`bannerPace()`): K.O. = koHitstop + koSlowmoFrames, verdict = koOutroFrames - 60 ms, TIME
   OVER / verdict share timeoverOutroFrames, ROUND n <= introFrames - 250 ms, FIGHT! 800 ms. `UiGameData.system?` added.
2. **Stats / snapshots (D8, D10):** game.ts BoutStats records the round winner + PERFECT on the KO / TIMEOVER frame and uses
   ROUND_END `a` (0 | 1, 2 = draw); `readFighter().hp` is clamped >= 0 (the state keeps overkill; checksums unchanged).
3. **Camera vs HUD (D4):** `Hud.safeTop(): number` (fraction of the HUD root height covered by `.hp-top` + `.hp-bars`, measured on
   mount / resize / touch-mode change); `BoutView.setSafeArea(top)` (game.ts calls it every rendered frame);
   `FightCamera.safeTop`. The jump pan is solved with the rig's real pitch (`lookFloorFor` / `lookCeilFor`) so an airborne
   fighter's top (head, or raised hands while airborne: `FighterView.topY()`) stays under `safeTop + 0.015`; the pan UP is a
   hard floor at the actual camera distance (head beats feet while the zoom-out catches up). `state().cam` read-back
   (`BoutView.camReadback()`: lookY, dist, safeTop, tops[] = each fighter's top as a screen fraction).
4. **Portraits (D5):** `PortraitQueue` renders at `portraitSize()` = the largest display (0.95 x min(vh, 0.62 vw) x DPR,
   rounded up to 128 px, 512..1536; 896 at 1600x900) instead of 256; `Showcase.portrait` uses alpha-to-coverage on cutouts and
   returns WebP (PNG where the browser has no WebP encoder).
5. **Measured, asymmetric push boxes (D2) - fighters/<id>.json gains (FIGHTERS generator writes, SIM reads):**
   `push: { front, back, crouchFront, crouchBack }` (m from the root along the facing; `pushbox[0]` = front + back) and per move
   `pushExt: [[frame, m], ...]` (extra FRONT extent from the clip's measured lean, piecewise linear, >= 0). Source:
   `art/blender/measure_body.py` -> `tools/measure/<id>.body_all.json` (98th-percentile forward / backward extent of the skinned
   CORE vertices - hips, spine, neck, head, shoulders, thighs - per clip frame); rules in `data/fighters/_gen/kitlib.py`
   (stand front = max(median idle, median walk_f), back = max(median idle, median walk_b), crouch = median crouch_idle; pushExt
   kept >= 0.04 m). SIM `core/sim/boxes.ts`: `pushExt(m, i, dir)` / `wallLimitX` / `clampToWalls` / `pushGap` replace every use of
   the symmetric half-width (bodies, walls, pushback transfer, proximity guard, wall splat / near-wall, cinematic end gap, grab
   range front-to-front); `CFighter.pushFS/BS/FC/BC`, `CMove.pushExt`. Without `push` the box is the old symmetric one (fixture
   kits unchanged). Point-blank rule (kitlib + validate.py): a box must start within `push.front + ROSTER_DEF_MIN - 0.10`
   (ROSTER_DEF_MIN = min over the roster of push.front + hurt.stand[0] / 2 = 0.47). AI range estimates use `pushFS`.
   After an ASSETS re-bake: run measure_body.py (@all) for the changed fighters, then build.py + validate.py.
6. **Throw victims + knockdown presentation (D3, D7) - `core/sim/throwpose.ts`:**
   - `grab.victim?: [[lockFrame, sharedClip, fromS?, toS?], ...]` (FIGHTERS data; each segment until the next or the release;
     toS omitted = 1 clip-s per 60 f). Default (no victim): `thrown_f` / `thrown_b` (swap) with its `marks.slam` on `grab.hitF`
     and its end on the release (non-grab throws: slam on the damage frame). johnny / bruno `throw_f` carry victim timelines.
   - During the lock the victim's x follows the segments' clips.json `root` travel from the connect x (`F.thrX`) along its own
     facing; a side swap scales that path so the victim lands behind the thrower at max(backThrowOffsetM, thrower front +
     victim back + 0.05 m) (`F.thrDisp`). No teleport at the release; the victim keeps its facing while it lies (the free state
     re-faces it after the wake-up); face-down endings (thrown_b, kd_fall_f, crumple) lie / rise face down (`F.kdFace`).
   - THROWN / KNOCKDOWN anims: the sim writes a VIRTUAL anim frame = round(clip seconds x 60) (§17 rule 3 still holds for the
     view: shared clips sample `animFrame / 60`). KD = fall clip from its drop (standing) or floor impact (juggle landing) to its
     end over <= `anim.fallMaxFrames`, lying loop, wake clip ending exactly on the actionable frame at <= `anim.wakeMaxRate` x
     (system.json `anim.kdFall` = [drop s, floor s] per fall clip). Fields `F.thrX, F.thrDisp, F.tot, F.kdFace`; LAYOUT_REV 2.
   - View: a side-swap victim passes IN FRONT of the thrower (`FighterView.zTarget`, presentation-only depth offset); a throw's
     damage spark / splatter spawns at the victim's chest bone (was root x at a fixed 1.0 m).
7. **Harness:** playtest.py's jab verb passes only on a landed jab (HIT / COUNTER / PUNISH), walk-ins stop when the gap stops
   closing (bodies touching). §13 G2 note: `probe_uniques.ts` does not exist (uniques are not in the sim, §19.14); G2 = the
   probes run_probes discovers.

## §26 CHANGED(FIGHTERS) P2: Lv3 cinematic v2, paired-throw victims, season text (2026-09-30; additive, nothing breaks)
Source of truth stays `data/fighters/_gen/` (kits/*.py -> build.py). SIM reads nothing new unless a request below says so;
the old `cinematic` fields (`frames`, `cue`, `hits`, `anim`, `victim`, `shots`, `endAdv`, `endGapM`) keep their meaning.
1. **`cinematic` v2** (every `super3`; VIEW `view/cinematics.ts` builds the per-fighter track from it; the whole block is
   presentation except `frames` / `hits` / `endAdv` / `endGapM`, which SIM already uses). Frames `f` are cinematic frames
   `0 .. frames-1` (= `MatchSnap.cinematic.frame`); everything is driven by that frame only (rollback-safe, both online
   clients identical). "Attacker frame": x along the ATTACKER's facing (toward the defender at the start), y up, z toward
   the default camera side (world +Z).
   - `anim`: `[[f0, clipId, fromS?, toS?], ...]` attacker sub-clips (ids from the fighter's clips.json). Segment k plays
     clip seconds `fromS -> toS` linearly over cinematic frames `f0 .. nextF0` (the last one until `frames`); `toS` omitted
     = 1 clip-second per 60 frames from `fromS`, clamped at the clip end; `fromS` omitted = 0. Same convention as
     `grab.victim` (§25.6). VIEW crossfades a segment switch over <= 4 frames.
   - `victim`: `[[f0, sharedClipId, fromS?, toS?], ...]` defender sub-clips, SHARED clips only (§6.2; the defender can be any
     body), same timing rule. The last segment ends in the pose the defender lies in after the cinematic (`endPose`).
   - `pathA`: `[[f, dxM, liftM], ...]` attacker root offset from its position at frame 0 (dx along the attacker facing, lift
     up), piecewise linear with an implicit `[0, 0, 0]`; holds after the last key. The last key has dx = 0 and lift = 0 (SIM
     keeps the attacker's x at the end, so the view never pops).
   - `gapD`: `[[f, gapM, liftM], ...]` defender root = attacker VIEW root (incl. `pathA`) + facing x gap, lifted by
     liftM. Implicit first key = the ACTUAL gap at frame 0 (lift 0); every authored key has f >= 1. The last key's gap =
     `endGapM`, lift 0 (SIM places the defender at attacker.x + facing x endGapM at the end). VIEW clamps both roots to the
     stage walls (+-8 m minus the push boxes).
   - `camera`: `[{from, to, shot, target, fovDeg, dist, height, yawDeg, ease, roll?, lookH?, blend?}, ...]` - contiguous
     shots covering `[0, frames)` (`from` of the first = 0, each `to` = the next `from`, the last `to` = `frames`); each
     shot starts with a hard CUT unless `blend` (frames, default 0) asks for a camera crossfade from the previous shot.
     `shot` in `wide | close | low | over_shoulder | orbit | top` (framing class, informational for VIEW presets; the numbers
     are authoritative). `target` in `attacker | defender | both` = the look-at point L: that fighter's view root x (both =
     the midpoint), height `lookH` (m, default 1.2), z 0. Camera position = L + (facing * sin(yaw) * dist, height - lookH,
     cos(yaw) * dist) in world metres (yaw in degrees, attacker frame: 0 = the default side camera on +Z, -90 = behind the
     attacker looking toward the defender, +90 = beyond the defender looking back, |yaw| <= 150); `dist` = horizontal
     distance from L (m), `height` = camera height above the floor (m), `fovDeg` = vertical FOV, `roll` = degrees.
     `fovDeg`, `dist`, `height`, `yawDeg`, `roll`, `lookH` are each a number or `[start, end]` interpolated across the shot
     with `ease` in `linear | in | out | inOut | hold` (hold = start value). The `cinematicCamera: 'short'` setting may swap
     shots, never the frame count (§8).
   - `shots`: `[[from, shot], ...]` - GENERATED from `camera` (kept for old readers).
   - `fx`: `[{f, fx, target?}, ...]` presentation beats; `target` in `attacker | defender | both | stage` (default:
     defender for body FX, stage for stage FX). Vocabulary (VIEW maps what it has, ignores unknown names, never throws):
     body - `impact_s impact_m impact_l` (extra hit burst on the target chest; the sim's SUPER_HIT events already spawn the
     damage sparks), `splat` (comic splatter, honours the gore setting), `smear` (motion smear on the target's fastest limb,
     ~8 f), `dust` (floor dust at the target's feet), `shock_ring`, `fire`, `electric` (taser arcs over the body, ~30 f),
     `sparks` (metal sparks), `smoke` (puff at the target), `doves`, `cards`, `ball_trail`; screen - `flash` (skipped with
     reduceFlashing), `shake_s shake_m shake_l` (camera trauma +0.10 / +0.20 / +0.35), `speed_lines`, `zoom_lines`,
     `freeze_frame` (TV freeze-frame still: white border + INSTANT REPLAY stamp, ~20 f), `letterbox` / `letterbox_off`,
     `slate` (lower-third with the move name / `slate`); stage - `dim` / `undim` (set lights down / back), `spot` /
     `spot_off` (one spotlight on the target, the rest dark), `lights_flicker` (~30 f), `pyro` (stage flame columns),
     `confetti` (confetti cannon).
   - `crowd`: `[{f, react, ratings?}, ...]` crowd beat: `react` in `ooh | gasp | cheer | roar | boo | laugh | hush | chant |
     applause`; `ratings` in `up | spike | peak` = RATINGS presentation intensity (crowd bounce, HUD ratings flash; AUDIO
     may map `react` to crowd one-shots). Never touches the sim's SHOWTIME meter.
   - `slate`: one-line lower-third text for the TV slate (user-facing copy; UI may mirror it into strings.json as
     `slate.<fighter>.<moveId>` like move names, §22.5).
   - `endPose`: `back | front` = how the defender lies when the cinematic ends (the last `victim` segment's end pose).
     **Request to SIM** (cinematicTick, 2 lines): at CINEMATIC_END set the victim's `F.kdFace = KDF.NOFALL` (| `KDF.DOWN`
     for `front`) after `enterKnockdown`, exactly as `throwRelease` does - today the knockdown replays kd_fall_b from a
     STANDING drop over a body the cinematic already laid on the floor (a visible pop up and a second fall).
   - **Grab supers** (a `super3` with a `grab` block: bruno `final_delivery`): the sim runs them as a grab lock (§19.10 /
     §25.6: `grab.frames` = `cinematic.frames`, damage on `grab.hitF`, the victim carried by `grab.victim`, which equals
     the cinematic `victim` timeline), so `MatchSnap.cinematic` stays inactive. VIEW drives the same `cinematic` block
     from the attacker's lock frame (FighterSnap `animFrame` while `animId` is that move's grab entry, §19.10) and does NOT
     apply `gapD` (the sim carries the victim). Optional **request to SIM**: start the cinematic (timer freeze, the
     `cinematic.hits` damage split, CINEMATIC_START / END events) when such a grab connects.
   - Validator (`validate.py`) checks: shots contiguous over [0, frames), numbers in range, clips exist (attacker: the
     fighter's plan / shared set; victim: shared), `fromS`/`toS` inside each clip's `dur` (clips.json), every hit frame
     inside a reacting victim segment, paths end at 0 / `endGapM`, <= 180 frames.
2. **Paired throws**: every `throw_f`, `throw_b`, command grab and grab super carries `grab.victim` (§25.6 format,
   <= 8 segments, shared clips, seconds on the VICTIM's clips.json). Rules the kits follow (validator-checked): the
   victim's big reaction starts on the attacker clip's marked moment (the grab clip's `marks.slam` = the source frame
   shown on `grab.hitF`, §6.2); the LAST segment ends on the floor (`kd_fall_b` / `thrown_f` end = face up, `thrown_b` /
   `kd_fall_f` / `crumple` end = face down), because `throwRelease` starts the knockdown with NOFALL; a side-swap throw's
   segments travel forward in total (sum of their clips.json `root` travel >= 0.5 m) so the sim's `thrDisp` scaling lands
   the victim behind the thrower without a backward jerk.
3. **Season text** in `data/fighters/<id>.json` (UI renders them; user-facing copy authored by FIGHTERS in the kit
   sources; UI may mirror it into strings.json if it wants keyed copy):
   - `introLine`: string (<= 80 chars) - the fighter's line on the VS card / round-1 intro.
   - `winQuotes`: `[string, string, string]` - results-screen quotes (UI picks one, e.g. seeded by the match seed).
   - `banter`: `{ "<opponentId>" | "default": [line1, line2] }` - THIS fighter's two pre-fight lines against that opponent.
     The card interleaves both sides: P1 line1, P2 line1, P1 line2, P2 line2 (each side from its own file, falling back to
     its `default`). Playable fighters carry their rival (§5.4), `freak`, `ricky` and `default`; RICKY carries every
     playable id + `default`; THE FREAK carries `default` (stage directions - it does not talk).
   - `ending`: string, 3-5 short sentences in the show's voice (THE SEASON ending card).
4. **Clip plan changes** made in P2 (source fixes, new cinematic clips) are listed with their reason in
   `_harness/_reports/progress_p2_fighters.md` ("ASSETS rebake list"); until lane ASSETS re-bakes them, build.py marks
   them PENDING and keeps each move's hit-volume box from the PREVIOUS bake's effector (re-derived after the re-bake).
5. **Amendment (2026-09-30 11:40, presentation only; found on FIGHTERS' cinematic preview renders)** - the cinematic
   numbers are authored for 1.80 m bodies, but the roster runs 1.70-2.40 m and push fronts 0.24-0.75 m:
   - **Height scaling:** VIEW multiplies a shot's `lookH` and `dist` by (target `heightM` / 1.80) for `attacker` /
     `defender` targets, and by the taller fighter's ratio for `both` (a close-up on THE FREAK at 2.40 m would otherwise
     frame its chest; on Lotus at 1.70 m, the top of her head). `height` is not scaled.
   - **No body overlap:** while both fighters are grounded (lift < 0.30 m), VIEW keeps the defender's gap at
     >= attacker `push.front` + defender `push.front` (max(authored gap, fronts sum)); authored gaps (~1.0-1.3 m) suit
     average bodies, Bruno / Freak defenders need more. Every `endGapM` (>= 1.5 m) exceeds the largest fronts sum (1.49 m,
     Freak vs Freak), so the end state still matches the sim.
   - `kitlib.cam()` applies framing floors when it emits a shot (close >= 2.5 m single / 3.0 m both, lookH 1.45 / 1.3;
     over-the-shoulder >= 2.9 m at >= 1.8 m high; wide >= 4.5 m): the numbers in the JSON are the ones to use.

## §27 CHANGED(UI) P2: training driver, online lobby events, results rounds, season screens (2026-09-30; additive)
Source of truth: `runtime/src/ui/types.ts`, `runtime/src/ui/trainer.ts`. Nothing here breaks §8 / §16 / §18.3 / §22.
1. **Training driver** `ui/trainer.ts` `TrainingDriver` (DOM-free logic; the ONE place TRAINING OPTIONS become dummy
   behaviour). **Request to SHELL (game.ts) - the only lines it needs** (the UI lab entry `runtime/lab/ui_game.html`
   applies exactly these lines to the real Game as a prototype patch, so the wiring is proven before it lands):
   ```ts
   import { TrainingDriver } from './ui/trainer.ts';
   // startBout, right after createMatch (training only):
   b.trainer = cfg.mode === 'training' ? new TrainingDriver({ opts: d.menus.training, data: d.data, hud: this.hud,
     sim: { createMatch, step, readFighter, readMatch, devSet }, cpu: createCpu }) : null;
   b.trainer?.begin(cfg, m);
   // tick(), before the offline step:
   if (b.trainer) {
     const nm = b.trainer.pending();                      // RESET POSITION built a fresh, positioned Match
     if (nm) { b.m = nm; b.seen.clear(); b.lastFrame = nm.frame(); }
     const [i1, i2] = b.trainer.tick(b.m, w);            // w = input.sampleAll(); P2 dummy / CPU / playback, P1 idle while recording
     step(b.m, i1, i2); return;
   }
   // frame(), after hud.frame():  b.trainer?.frame((x, y, z) => project(b.view.cam.camera, x, y, z))  // -> [cssX, cssY] | null
   // teardown():                  b.trainer?.end()
   ```
   - The menus' training cfg sends `p[1].cpu = -1`: the driver owns the dummy's CPU (DUMMY: CPU at the options' level via the
     `cpu` factory = core/ai createCpu). A deep link with `cpu2 >= 0` starts the driver in DUMMY: CPU at that level.
   - Dummy word per tick: STAND 0 / CROUCH down / JUMP up / CPU / PLAYBACK. Any P2 key / pad input held overrides it
     (manual control of the dummy). GUARD: NONE / ALL / AFTER FIRST HIT / RANDOM (a 50 % roll per attack, seeded):
     back (away from P1) is held from the attacker's first visible move frame, while a P1 projectile flies at the dummy and
     during the dummy's blockstun; plus down unless the attack is an overhead (move `guard` 'H') or the attacker is
     airborne. AFTER FIRST HIT = from the first hit on the dummy until it has been free 40 frames with no threat.
   - RECORD = 3 s (180 ticks): P1's word drives the DUMMY (stored as forward / back of the dummy's facing), P1 gets 0;
     PLAYBACK loops the recording (30 free frames between loops) with the directions re-mapped to the dummy's facing.
   - RESET: MID (round-start spacing), CORNER (the dummy in its corner), CORNERED (you in yours). `pending()` returns a
     fresh Match: `sim.createMatch(cfg)` stepped through the intro (+ a scripted walk to the wall for the corners) + 30
     settle frames; the view reads snapshots only, so game.ts only swaps `b.m` and restarts its event reader.
   - METER FULL refills SHOWTIME and NERVE with `sim.devSet` (training only, never while a cinematic runs); HP always
     refills in training (the sim does it, meters.ts) - the P1 "HP REFILL" toggle is removed (it could not be switched off).
   - The driver feeds the Hud's input display (`hud.pushInputs(P1 word, frame)`, every tick) and the HITBOX overlay
     (`hud.setBoxes(list | null)`): hurt (blue), hit (red), push (white), projectile (yellow) boxes read from the sim
     (`core/sim/boxes.ts hurtRects`, the running move's compiled `boxes`, `P` block), projected by `frame(projector)`.
     Optional request to SIM: `readBoxes(m, i)` in match.ts (world metres); the driver reads core/sim read-only until then.
2. **Online lobby events** - `Menus.onlineEvent(name, payload)`. **Request to SHELL** (one line in onlineWire, beside the
   existing status / error forwards):
   `for (const ev of ['paired', 'select', 'opponentLocked', 'reveal', 'rematch', 'matchEnd', 'disconnect', 'end', 'ratings'] as const) o.on(ev, (p: unknown) => d.menus.onlineEvent(ev, p));`
   Used: `select.opponent` (display name) + `select.seconds` (select countdown), `opponentLocked` (LOCKED IN on the blind
   card), `reveal.picks` (the opponent's SIMPLE / CLASSIC icon), `status.transport` + `status.rttMs` (DIRECT / BACKUP LINE +
   ping bars in the lobby, select and online VS card), `rematch.peerWants` (OPPONENT WANTS A REMATCH on the results card),
   `end` / `error` after results (OPPONENT LEFT card + MAIN MENU = `{kind:'online', action:'cancel'}` then
   `{kind:'quitToTitle'}`), `matchEnd.rated`. Without the forwards the lobby runs on status / error alone. Online REMATCH on
   the results card turns the card into a waiting panel (it stays up until 'select' opens the character select).
   `MatchResult.disconnect` leads the results with the DISCONNECT card.
3. **MatchResult** (ui/types.ts): `rounds?: Array<{ winner: 0 | 1 | -1; how: 'ko' | 'time' | 'perfect' | 'double' | 'draw' }>`
   (request to SHELL: `rounds: s.rounds.slice()` in buildResult). The results screen's per-round breakdown reads it, merged
   with the Hud's own per-round log of the same bout (`Hud.rounds()`: winner, how, frames, damage per side, best combo per
   side, from the sim's events and snapshots), so the breakdown shows today.
4. **Season screens** (UI-side, game.ts unchanged): the ladder shows real progress from `LadderView` (optional
   `continues?: number`, `ratings?: number` shown when passed); a CardView without `banter` resolves both sides' §26.3
   `banter` (interleaved P1 1, P2 1, P1 2, P2 2) - rival, mini boss and boss cards; the VS card shows each `introLine`; results
   quotes come from `winQuotes` (seeded by the match seed), then strings `quote.<id>.n`; `showEnding` plays the per-fighter
   sequence (SEASON FINALE, the §26.3 `ending` paged by sentences, RATINGS TOTAL, THE BOARD from SaveStore incl. the new
   entry, UNLOCKED) and resolves after the last card; `showNameEntry` shows the provisional board rank; the arcade-loss
   results card is the CONTINUE screen (10 s countdown; CONTINUE -> 'rematch' = continue, time-out / END THE SEASON ->
   'menu'; it says the episode's ratings reset); BRAWL BREAK / HECKLER TOSS cards carry rules + seconds, their results
   (mode brawl / heckler) show the score, the ratings it adds and a grade. Boss phase 2: the Hud cues `boss_phase2` by itself
   the first time a fighter whose `unique.kind === 'phases'` drops below `unique.thresholdPct` % HP in a bout (a SIM event,
   if one comes, is honoured the same way); `hud.cue('boss_phase2')` still works.
5. **Hud** additions: `rounds()`, `setBoxes(list | null)`; the host caption card lives in the top band under the timer
   (verifier D6: it covered the fighters' feet). **Menus**: versus / season setup rows stack vertically (up / down = row,
   left / right = value; verifier D14).
6. **Addendum (later the same day, after SIM §28 / NET §29 landed):**
   - 27.2 is WIRED: NET P2 put the `menus.onlineEvent` forwards in game.ts (§29.6). Online REMATCH keeps the results card up:
     its choices become a waiting panel (REMATCH ASKED - WAITING, OPPONENT WANTS A REMATCH on the peer's yes, LEAVE = `{kind:
     'online', action: 'cancel'}`); 'select' / 'end' move on (game.ts). The blind pick shows the opponent's display name,
     PICKING / LOCKED IN, a 30 s pick clock (at 0 the cursor fighter is locked: the normal onlinePick intent); the lobby shows
     SEARCH / ROOM / CONNECT / SYNC / PICK / FIGHT, the room code, the opponent, DIRECT / BACKUP LINE + ping bars.
   - BRAWL BREAK / HECKLER TOSS (SIM §28.4) in the HUD: fighter 1's side (absent) gives way to the bonus panel - SCORE = the
     sim's running total (`MatchSnap.brawl.score`, SCORE `c`), the RATINGS band (`grade` 0..6, `mult`), goons down / wave /
     hits taken or parried / perfect / hits taken, the running combo; banners BRAWL BREAK / HECKLER TOSS -> BRAWL! / INCOMING!
     -> TIME'S UP! with the score (no KO / verdict banners); only index-0 plays count for callouts (goons = 8 + slot, crowd = 2).
     The bonus results card reads `MatchResult.match.brawl` (downed, parries, perfects, hitsTaken, mult). Proven in the real
     game with the deep links `?mode=brawl` / `?mode=heckler` (game.ts `BONUS_ROUNDS_IN_SIM` is still false, so THE SEASON
     passes over the slots until SHELL / SIM flips it; the cards are ready).
   - Training frame data is measured by the driver PER SIM TICK (the render-frame readout could be a frame off): contact =
     the HIT / BLOCK event, advantage = first actionable tick of the defender - of the attacker (`FighterSnap.actionable`,
     §28.1), damage = the victim's `lastDamage`, combo = the attacker's `comboDamage`; handed to `Hud.setReadout(r)`.
     probe_training: 5L hit +4, 5M hit +3, 5M block -3 = the move data.
   - Move list names: the fighter file's `name` first (FIGHTERS' source of truth), then strings `move.<fighter>.<id>` - the
     §22.5 mirror order is reversed so a renamed move never shows stale copy.
   - Harness: `_harness/probe_training.ts` (new, G2 auto-discovered) = the driver over the real sim; `menus.py --game` = the
     integrated walk (report menus_game.json); `mobile.py` checks every touch label fits its disc (`labels_fit`, DPR 2-3).

## §28 CHANGED(SIM) P2: fighter uniques, BRAWL BREAK / HECKLER TOSS, P1 sim fixes (2026-09-30; additive unless marked)
Supersedes the "NOT yet in the sim" notes of §19.11 / §19.14 / §25.7: uniques, `phase: 2` routing and `probe_uniques.ts`
exist now. Numbers the kits do not carry come from `data/system.json` `uniques` / `brawl` / `heckler` (SIM-owned); a
fighter's `unique` block always wins over a system default. Everything below is integer sim state (rollback-safe).
1. **Fighter states / snapshot:** `STANCE` = 30 (`stateName 'stance'`). §4.6 `FighterSnap.flags.stance` = 1 only while in
   STANCE (was `unique[0]` for every kind). New optional FighterSnap fields: `install: number` (frames left, 0 = none),
   `absent: boolean` (true = not on the set: fighter 1 in `brawl` / `heckler`; view / HUD hide it), `actionable: boolean`
   (the §22.4 request: true when the fighter could start an action this frame).
2. **`FighterSnap.unique[0..3]` per `unique.kind`** (UI / VIEW / AI read these; 0 when unused):
   - `stance` (lotus): u0 1 in the stance, u1 frames in it, u2 `maxF`, u3 stance anim (0 idle, 1 walk_f, 2 walk_b).
     Enter moves (`stance: "enter"`) put the fighter in STANCE after their last frame. In STANCE: L / M / H fire
     `followups` at once (no cancel window); down (1/2/3) held `uniques.stance.exitHoldF` (4) frames starts `exit["2"]` (a motion
     special rolls through down faster and starts from the stance); u1 reaching `maxF` starts
     `exit.timeout`; holding back walks back at `walk.back` and after `blockExitF` frames leaves the stance (blocking works
     from the next frame); forward walks at `walk.fwd`; specials / supers / throw / PARRY / IMPACT start from it (leaving
     the stance); jumps and dashes do not. Presses during the enter move buffer the follow-up. Hurtbox in STANCE = the
     enter move's last `hurtOverride` (the lean). Can be thrown, cannot block. The §17 anim table gains, after the §19.10
     grab entries, one entry per `unique.clips` key in the order `idle, walk_f, walk_b` (`moveId -1`, loop from
     clips.json); `GameData.anims` carries them, so the view needs no change.
   - `charge` (krane): u0 back charge frames, u1 down charge frames (both capped at `chargeF`), u2 1 when [4]6 is ready,
     u3 1 when [2]8 is ready. CLASSIC `[4]6` / `[2]8` = `chargeF` frames held, then the release direction + button within
     `keepF` frames. The stored charge and the keep window survive blockstun, hitstun and dashes (neither lost nor aged
     there), and a release shorter than `keepF` does not lose it (re-holding resumes the count: a 44 back dash keeps it). SIMPLE uses S+dir (§19.2). Standing block drains `standBlockNervePct` % of the NERVE block drain.
   - `ball` (gazza): u0 ball state 0 at his feet, 1 flying, 2 hover (keepy-uppy), 3 resting on the floor, 4 gone
     (knocked away, respawning), 5 loose (falling, harmless); u1 frames left of the timed state (hover / rest / respawn);
     u2 projectile slot of the ball or -1; u3 wall rebounds left. The ball is ONE projectile slot (`kind 1`) while it is
     out. `ball.act` moves: `shoot` needs the ball at his feet (kicked from `projectile.x / y` with the move's speed, vy,
     g) or a hover / resting / loose ball within `uniques.ball.kickRangeM` in front (re-kicked from where it is); `hover`
     flicks it up to `projectile.y` at `projectile.x` for `projectile.life` frames (a static hitbox, then it drops and
     rests); `summon` moves (supers) spawn their own `kind 0` projectile and do not touch the ball. A ball move whose ball
     is not available cannot start (the input falls through). Flying: rebounds off a stage wall `bounces` times (vx x
     `wallRestitutionPct`), a lob lands and rests, a roller (`ground`) rolls, `life` over -> loose. Hitting / blocked /
     parried / clashing to 0 hits -> loose (bounces off, harmless) -> rests. Resting: Gazza free (idle / walk / crouch) within
     `pickupM` traps it back at his feet - also the moment it lands next to him; after `restF` it respawns at his feet. An OPPONENT strike box touching the ball (flying, hover,
     resting, loose) knocks it away: gone for `respawnF`, then at his feet. The ball never hits its owner and does not
     count for `projectile.limit`. Each round starts with the ball at his feet.
   - `counter` (rerun, ricky): u0 1 on the catch frames of the running counter move. A strike (and a projectile when `vs`
     lists `proj`) arriving on `counter.catch` frames is nullified: the attacker gets `uniques.counter.catchHitstop` (12)
     hitstop, its move jumps to its last active frame (recovery next), it cannot cancel, and every hit on it counts as a
     punish counter until its move ends; a caught projectile is destroyed; the `follow` move starts at once. Throws and
     command grabs beat counters (no throw invulnerability). Event `CATCH`.
   - `armorStep` (bruno, boneyard, freak): u0 armor hits left on the running move, u1 hits absorbed this move. Moves in
     `steps` may also cancel (inside their whiff / contact cancel window) into grounded normals of strength
     `uniques.armorStep.tickStrength` ("L": the 2L tick) besides their `cancel` list; move-level `armor` holds the numbers
     (P1 armor rules unchanged: absorbed hit = grey damage + hitstop, supers and SHOVE break armor, throws beat it).
   - `teleport` (zambini): u0 teleports done this round. On move frame `teleport.f` x becomes (behind) opponent.x +
     side x gapM, (front) opponent.x - side x gapM, (home) own wall + gapM (side = the direction from him to the opponent
     at that frame), clamped to the walls; facing re-resolves on the next free frame or when the move cancels into another (he can land
     facing away). The move's
     invuln / recovery are the kit's (recovery hits = punish counter). The separation cap still applies. Event `TELEPORT`.
   - `phases` (ricky): u0 phase 1 | 2, u1 lock frames left. The first time his HP drops below `thresholdPct` % of max in any
     round (a hit that also KOs either fighter is just a KO): world freeze `lockF` frames (`MatchSnap.freeze`, freeze kind 3, timer frozen), events `PHASE` +
     `CAMERA_CUE` b = 6; from then on (later rounds too) `phase: 2` moves route (CLASSIC every motion incl. `22` pyro;
     SIMPLE keys overridden by `phases.simple`, EX = the `_ex` of the override; Lv3 (S+H+2 and CLASSIC 214214) = `lv3`).
     Phase-1 routing never reaches a `phase: 2` move.
   - `none`: all 0. **Installs** (no kit uses one yet; available): optional Move field `install: { "frames",
     "damagePct"?, "walkPct"? }` - when the move starts the fighter gets `frames` of install (non-frozen frames, ends with
     the round): its hits deal `damagePct` %, it walks at `walkPct` %; `FighterSnap.install` = frames left; event `INSTALL`.
3. **New events** (numbers from `EVX` in core/sim/events.ts - kept out of `EV` so consumers that switch exhaustively over
   `keyof typeof EV` (audio/router.ts) keep compiling; they opt in via EVX; unknown types are ignored): `CATCH` 42 (a catcher, b attacker, c strength class
   of the caught hit, d 0 strike / 1 projectile), `TELEPORT` 43 (a fighter, b from x cm, c to x cm, d 0 behind / 1 front /
   2 home), `PHASE` 44 (a fighter, b phase), `BALL` 45 (a owner, b 0 kick / 1 wall rebound / 2 rest / 3 pickup / 4 knocked
   away / 5 respawn / 6 hover / 7 loose, c x cm, d y cm), `INSTALL` 46 (a fighter, b frames). `CUE.PHASE` = 6.
   `MatchSnap.proj[]` gains `obj` (kind 1: the ball state as u0; kind 2: heckle object type index).
4. **BRAWL BREAK (`mode: 'brawl'`) and HECKLER TOSS (`mode: 'heckler'`)** - offline, state = `STATE_INTS_BRAWL`
   (`core/sim/brawl.ts`). `cfg.p[0]` = the player; fighter 1 is ABSENT (`FighterSnap.absent`, never hit / pushed; the view
   hides it; `cfg.p[1]` is only compiled - any valid id, an unknown one falls back to p[0]'s). Phases: INTRO (`round.
   introFrames`) -> FIGHT for `cfg.timer` s (default `brawl.seconds` 45 / `heckler.seconds` 40) -> TIMEOVER (outro
   `round.timeoverOutroFrames`, event TIMEOVER a = 0) -> ROUND_END -> MATCH_END (`winner` 0, wins [1, 0]: a bonus round is
   always "cleared"; its result is the score). No KO: the player's HP never drops below 1; getting hit costs RATINGS.
   Input word 2 is ignored.
   - **Snapshot**: `MatchSnap.brawl?: { mode: 'brawl'|'heckler', score, ratings /* 0..699 */, grade /* 0..6 */, mult /*
     percent 100..400 */, timeLeft /* s, ceil */, timeLeftF, wave, spawned, downed, combo /* hits in the running combo */,
     parries, perfects, hitsTaken, goons: GoonSnap[] }`. `GoonSnap = { slot, kind /* goon id, e.g. 'goon_hardhat' */,
     kindIdx, x, y /* m */, facing, state, stateName, animId, animFrame, prevAnimId, prevAnimFrame, blendT /* 0..1 */, hp,
     hpMax, hitstop, telegraph /* true during an attack's startup */, token /* holds an attack token */, moveName /* 'jab' |
     'haymaker' | 'lunge' | '' */, down /* defeated, fading out */ }` - active goon slots only (ordered by slot).
   - **Goons** (up to `brawl.maxActive` 4 alive at once, both sides of the line, spawned by the wave director from
     `brawl.waves`, entering at `spawnDistM` from the player, inside the walls): kinds `brawl.kinds[]` = `{ id, hp, walk }`
     (ids = lane ASSETS' `goon_*` bodies: `goon_hardhat` (Ch17), `goon_riot` (Ch35), `goon_scrub` (Ch16) proposed; the sim
     only uses the index, so ASSETS may rename by writing the ids here - SIM mirrors them into system.json). ONE shared kit
     of 3 moves `brawl.moves` (`jab`, `haymaker`, `lunge`: ordinary §5.2 Move objects, startup >= `brawl.telegraphMinF`
     30) + shared hit reactions. Attack tokens: at most `brawl.tokens` (2) goons hold one; a token is granted >=
     `brawl.tokenSpacingF` frames after the previous grant, held through the walk-in and the attack's startup, released on
     its first active frame (or when the goon is hit). Goons without a token hover in the approach ring (`brawl.ringM`).
     Goon hurt / push boxes = `brawl.goonHurt` / `brawl.goonPush`.
   - **Goon anim ids** (GoonSnap.animId, §17 rule 2 layout on the goon's own table `GameData.goonAnims[kindId]`): 0..33 =
     the shared system clips (each goon GLB should carry at least idle, walk_f, walk_b, hit_high_s, hit_high_l, hit_body,
     hit_air, block_high, kd_fall_b, kd_ground_b, wake_b, ko_fall; a missing one renders idle), 34 + k = `brawl.moves[k]`
     (clip = that move's `anim.clip`: `goon_jab`, `goon_haymaker`, `goon_lunge`; warp derived from
     `data/clips/<goonId>.clips.json` when lane ASSETS publishes it, else linear over the move). animFrame per §17 rule 3.
   - **Player vs goons**: every player strike box, projectile and throw can hit goons (a strike hits each goon once per
     hit id; several at once = a crowd hit). Hits apply the move's damage / hitstun / KD / launch to the goon (simple
     juggle physics), with hitstop on both; the player's move registers contact (cancels and assist routes work). Lv3
     cinematics do not play in bonus rounds: a connecting super3 deals its `cinematic.hits` total at once. Goon attacks vs
     the player use the normal block / parry / perfect-parry rules (no world freeze on a perfect parry in bonus rounds).
   - **Scoring** (DESIGN_RESEARCH §6b subset; numbers in `brawl.score` / `brawl.ratings`): points x the RATINGS multiplier
     at award time; RATINGS 0..699 in 7 bands (x1.0 1.2 1.5 2.0 2.5 3.0 4.0), idle decay after `ratings.idleF`, taking a
     hit drops 2 grades to that band's floor; combo cash-out `score.comboCashF` after the last hit = round(5 x hits^1.5) x
     mult; crowd hit +150 per extra goon; KO 100; parry 200 / perfect parry 400.
   - **HECKLER TOSS**: objects `heckler.objects[]` (`{ id, flightF, damage, box }`: tomato, bottle, shoe, chair) thrown from
     the crowd on integer arcs aimed at the player's position at the throw (spawned `spawnDistM` to either side at
     `spawnY`, cadence `heckler.cadence`, at most `heckler.maxLive` in the air). A touching object is parried when the
     player is in PARRY (perfect when `parryF <= parry.perfectFrames`: points x2), blocked (no score, no penalty) or it hits
     (`heckler.hitCost` points lost, RATINGS -2 grades, hitstun). Objects that miss break on the floor. Objects live in the
     projectile block (`kind 2`, owner 2 = the crowd).
   - **Events**: GOON_SPAWN (a 8 + slot, b kind index, c side -1 | +1, d x cm), GOON_DOWN (a 8 + slot, b kind index, c
     points, d x cm), HECKLE_THROW (a projectile slot, b object type, c from x cm, d target x cm), SCORE (a player 0, b points
     delta - negative on a heckle hit, c running total, d reason: 1 hit, 2 KO, 3 combo cash-out, 4 crowd hit, 5 parry,
     6 perfect parry, 7 heckle parry, 8 heckle perfect, 9 heckle hit). In bonus rounds the fighter-index fields of HIT /
     BLOCK / PARRY / PERFECT_PARRY / COUNTER / PUNISH / KNOCKDOWN carry 8 + slot for a goon and 2 for a crowd object
     (consumers map >= 8 to `MatchSnap.brawl.goons`, 2 to the object; UI's HUD should show SCORE `c`, not a sum of `b`).
   - game.ts may flip `BONUS_ROUNDS_IN_SIM` (§24.13): `createMatch({ mode: 'brawl' | 'heckler', ... })` runs them.
5. **P1 fixes** (this lane): (a) CLASSIC motion priority is now EX > supers > **360 > HC > DP > QC** > charge > 22 (a
   longer motion that contains a shorter one wins; §19.12 had HC below QC, so 41236 / 63214 specials never came out on kits
   with 236 / 214). (b) **derive rule v2** (§5.2, replaces "centred on the effector"): a derived strike box spans from the
   body (the attacker's push front - `boxes.nearPadM`) to the effector plus half the class width (L 0.15, M 0.20, H 0.25 m);
   its height covers the limb from its root (shoulder `boxes.shoulderPct` x heightM for hands / head, hips for feet / knees)
   to the effector +- half the class height; grounded non-anti-air strikes reach the crouch line (`boxes.crouchLineM` 1.10);
   ground normals reach at least the FIGHTING_DESIGN 2h class reach x heightM / 1.80 (`boxes.reachFloorM`: L 0.85, 2L 0.81,
   M 1.11, 2M 1.09, H 1.33, sweep 1.38). One box per `hits` entry at clips.json `marksAt.hitK` when present. Moves tagged
   `boxSrc: "hitVolume"` (FIGHTERS' copy of the v1 derived box, widened) are re-derived by this rule; hand-set boxes (no
   `boxSrc`) are kept. (c) **Hurtboxes are measured and asymmetric**: `data/bodies.json` (SIM-owned, generated by
   `node _harness/tool_bodies.ts` from `tools/measure/<id>.body_all.json`: 98th-percentile FULL-mesh front / back extents,
   median over idle + walk_f / walk_b (stand), crouch_idle (crouch), jump_up / jump_f / jump_b (air), never smaller than
   the push box) = `{ "fighters": { "<id>": { "stand": [front, back], "crouch": [front, back], "air": [front, back] } } }`;
   the posture hurtbox runs from x - back to x + front along the facing (heights unchanged: fighters/<id>.json `hurt`). A
   fighter JSON `hurtBody` block (same shape; FIGHTERS may take it over) wins; without either the box stays centred.
   `hurtOverride` boxes stay centred. Re-run the tool after an ASSETS re-bake + measure_body.py. (d) **Throw knockdowns**: when a
   throw's knockdown after the release is shorter than the victim's wake clip at `anim.wakeMaxRate` (+ `kd.throwLieMinF`
   lying frames), the victim first leaves the lock EARLY - on the first lock frame >= the shortfall where its victim clip is
   on the floor (thrown_* past `marks.slam`, kd_fall_* past `anim.kdFall` floor, kd_ground_*) and its carry is at rest
   (<= 1 cm), never before the damage frame + 2 - and those frames go to the knockdown; whatever is still missing becomes a
   LYING HOLD: the victim's knockdown AND the thrower's grab lock both grow by it (the thrower holds its grab clip's final
   pose; a grab-less throw recovers in RECOVER). The advantage is unchanged in every case; the wake plays whole (measured:
   johnny throw_f on bruno KD 21 -> 43 f, thrower lock 45 -> 67 f, advantage +21 both). (e) KO: `readFighter().hp` is clamped >= 0 (§25.2;
   probe_uniques checks it). (f) §26.1 request done: at CINEMATIC_END the victim's knockdown starts with `KDF.NOFALL`
   (| `KDF.DOWN` when the move's `cinematic.endPose` is `front`).
6. **Probes**: `_harness/probe_uniques.ts` (every unique of every kit, numbers read from the data) and
   `_harness/probe_brawl.ts` (BRAWL BREAK + HECKLER TOSS) join G2; `probe_synctest.ts` also rolls back unique-heavy input
   streams on all 12x12 pairs and bonus-round matches for all 12 fighters (additive; NET's main run unchanged).

## §29 CHANGED(NET) P2: online in the real game, relay pacing, DELAY_HIDE, rated results (2026-09-30; additive unless marked)
Every file carries `CHANGED(NET) P2` notes at the change. Evidence: `_harness/_reports/progress_p2_net.md`.
1. **Online input word (game.ts tick, online branch):** both peers feed the session `w[0]` = this screen's player-1 controls
   (key set 1, pad slot 0, touch overlay). The guest is still sim slot 1; P1 fed `w[b.local]`, so the guest played with the
   P2 key set (arrows / numpad) and its touch overlay and first pad were ignored (Input feeds them into word 0 only).
2. **Room codes (net/netplay.ts `makeCode`):** CREATE ROOM makes **4 letters** from `ABCDEFGHJKLMNPQRSTUVWXYZ` (no I / O) =
   the format lane UI's JOIN field and copy take (`/^[A-Z]{4}$/`, "four-letter code"); P1's 8 chars with digits could never be
   typed there. Quick-match rooms keep their 8-char ids (never typed); `join()` and `?room=` accept any `cleanCode()` (A-Z0-9,
   <= 12). Trade-off vs NETCODE 3.9's 8 chars: 331,776 codes, readable out loud; a guesser can at worst take an empty
   second slot (the first two presence ids play; HELLO tokens guard every later message).
3. **Status / error payloads:** `{ phase, rttMs, transport, room, ...extras, code }` - the key `code` always wins and the room
   code rides as `room` (P1 passed `{code: room}` and overwrote the key of 'net.waiting_peer').
4. **Event payloads:** 'matchEnd' = `OnlineMatchEnd { agreed, winner, reason: 'ko' | 'noresult' | 'nocontest' | 'disconnect' |
   'forfeit', rated, stats, matchId, rematch }` (`rematch` false after a disconnect / forfeit win); 'disconnect' = `{ winner,
   reason: 'disconnect' | 'forfeit' }`; 'end' = `{ reason, code }` (reason `leave` | `no-rematch` (both local) | `peer-bye` |
   `peer-left` | `rematch-timeout` | `no-opponent` | `room-full` | `version` | `cheat` | `hello-timeout` | `sync-timeout` |
   `relay-busy`; `code` = the NET_STRINGS key shown for it, '' for local reasons); 'ratings' = `{ matchId, data, ok }` (the RPC
   answer, async). `rematch(true)` on a session that cannot rematch ends it (reason `no-rematch`; P1 waited forever).
5. **API additions (net/online.ts):** `lastMatch`, `info(): OnlineInfo` (phase, room, local, matchIndex, transport, rttMs,
   delay, peer, pair, signedIn, peerSignedIn, supabase counters, relay stats, lastMatch, ratings, endReason, endCode,
   result {mine, peer} = the RESULT messages {matchId, winner, frame, csFrame, cs}), `setName(name)`, `trace()` (test);
   `netStats()` = session stats with `online: info()` during a match, `{ online }` between matches, null before a session
   (so `__HP__.net()` carries the flow facts in and out of a bout). `NetStats` gains `wallSpeed` (frames advanced / (60 x
   seconds since start): counts ticks the local loop never ran) and `online?`; `SessionOpts` gains `info?` and `trace?`
   (`session.traceDump()`: per-tick + per-packet rows for live diagnosis). Test switches `?nettrace=N`, `?relaypace=interval`.
6. **game.ts online flow (online sections only):** 'select' (first match and every rematch) -> teardown + `toMenus('charselect',
   {mode: 'online'})` (flow mode 'online'); 'matchEnd' -> the results card RESULTS_DELAY_MS after MATCH_END (the offline KO /
   win-pose pacing; P1 cut it after ~1 RTT) and then this peer stops ticking the session (agreement = the peer already holds
   every input; a ticking relay session costs 10 Supabase sends/s); 'disconnect' -> results "by forfeit" (BYE) or "by
   disconnect" (presence gone 5 s); results REMATCH -> `rematch(true)` and the card stays up (UI §27.2 waiting panel) until
   'select'; if the session ends meanwhile, or REMATCH is pressed on a session that cannot rematch -> the ONLINE lobby with the
   reason (`menus.show('online', {status: {code}})`, never a dead card); MAIN MENU -> `rematch(false)` + `leave()` + main.
   'end' while the player waits (blind select, rematch wait, lobby) -> the ONLINE lobby with `code`; a live bout ends only via
   'matchEnd' / 'disconnect'. `MatchResult.rated` = `lastMatch.rated`. UI §27.2's forward `menus.onlineEvent(ev, payload)`
   (paired, select, opponentLocked, reveal, rematch, matchEnd, disconnect, end, ratings) is wired as an optional call.
   Online MATCH_END is never a misprediction (the sim emits it koOutroFrames 90 / timeoverOutroFrames 120 frames after the
   deciding frame; the session never runs more than W = 8 / 12 frames past its last confirmed input).
7. **Relay pacing (net/transport_relay.ts):** a token bucket, 10 packets/s, burst 2. P1 paced "one packet per 100 ms since the
   last flush" at exactly the session's own 10 Hz cadence: a zero-drift queue that held packets 0-100 ms (measured live: mean
   40.7 / 44.5 ms, max 100.9 ms, RTT estimate 167 / 171 ms vs 88 ms sync RTT) = the cause of P1's 91% live relay speed.
   Budget unchanged: <= 10 input packets/s per side (+ burst 2) = 40 events/s per relayed match; `RelayTransport.stats()`.
8. **DELAY_HIDE = 2 (CHANGED from NETCODE 3.3's 3; §10's "- 3" now reads "- DELAY_HIDE"):** P2P D = clamp(ceil(RTT/2/16.67) - 2,
   1, 4). `node _harness/probe_netsim.ts --sweep` (8 measured traces x 4 phases, tick jitter, real sim): hide 3 missed the 96%
   gate in 2 / 32 runs (min 95.89%), hide 2 in 0 / 32 (min 96.85%, same floor as hide 1) with mean rollback 2.48 f vs 3.15 f;
   it adds one frame only for RTT 101-200 ms (RTT <= 100 ms: D = 1 either way). Numbers in core/net/sync.ts.
9. **Ratings:** RATED = both peers agreed on the RESULT and both are signed in (`currentPlayer()`, same-origin portal session);
   each peer calls `report_match_result` (supabase/migrations/0004_game_ratings.sql, idempotent by match_id, reporter must be a
   participant) in the background; the answer comes as 'ratings'; nothing waits on it. match_id = `hp:<room>:<seed hex8>:
   <matchIndex>` (one PK across every FFG game; P1's 32-bit hash + index could collide). Disconnect / forfeit / mismatched
   results stay unrated (only the stayer could report them). The signed-in lookup runs beside the lobby join (3 s cap) and its
   id rides in HELLO and in every READY (the peer keeps the latest). `MatchResult.rated` is true only when the RPC ANSWERED
   (`info().ratings != null`). **Live state 2026-09-30: the RPC is not deployed** (anon probe: HTTP 404 PGRST202 "Could not
   find the function public.report_match_result"), so every online match is UNRATED until the owner applies migration 0004;
   the client remembers a missing function after one failed call per page.
10. **Harness:** `python _harness/online2.py --game [--scenarios quick,code,link] [--relay]` = G10's two-browser half: two
   Chrome processes on dev servers 5325 (A) and 5330 (B) (separate storage), real keys only: QUICK MATCH + full best-of-3 +
   rematch + forfeit; CREATE ROOM + JOIN by typing the code + full best-of-3 + decline; `?room=` deep link + peer leaves during
   the select. `online2.py --lab --nettrace N --relaypace bucket|interval` = the relay diagnosis (two-browser trace join on the
   shared epoch clock). `probe_netsim` models the relay pacing (`--pacing interval` = P1) and rAF tick jitter ('relay+jitter',
   'p2p+jitter' rows), `--sweep` = the DELAY_HIDE table.
11. **Direct-path budget (§10 "direct fails within 5 s", refined):** ICE that has not failed / closed at 5 s gets up to 12 s in
   all before the host claims the relay (`RtcTransport.progressing()` / `state()`): a relayed match holds the ONE project-wide
   relay slot and 40 events/s. Measured: two starved headless Chromes began ICE checks ~10 s after 'connecting' (connected
   3 ms later) and fell back to the relay; a failed ICE still falls back at 5 s. `info().recent` = the flow's last 30 log lines.

## §30 CHANGED(STAGES-A) P2/P3: stage fragments + merge, BUTCHER BLOCK + WHEEL OF PAIN (2026-09-30; additive, §21 unchanged)
1. **Stage fragments.** Each P2+ stage build (`art/stages/<id>.py`, Blender headless) holds its StageDef as a Python dict and
   WRITES `art/stages/<id>.stage.json` (one §21 StageDef, same fields as the rust_theater entry, + measured `build` after
   gltf-transform). `python tools/merge_stages.py` (lane STAGES-A) merges every fragment into `data/stages.json`: replace/insert by
   id, order = `ui/data.ts STAGE_ORDER`, entries without a fragment kept (rust_theater from write_stages_json.py, `todo` stubs), a
   `built` fragment whose GLB is not on disk yet = PENDING (warned, skipped). Every built stage is re-measured from its GLB and
   validated (fightStrip, splat ids 0/1 at x -8/+8, one shadow-casting directional, crowd fields, GLB has crowd_* empties and NO
   punctual lights, bytes GLB+env <= budget.bytesPerStage, draws <= budget.drawsStage); errors stop the write. `--check` = report
   only, `--nodes` also prints each animated node's pivot / local +Y / bbox centre. NOTE: `write_stages_json.py` (P1) still
   rewrites the whole file; run `merge_stages.py` after it.
2. **Animated nodes (view hooks already in view/stage.ts, nothing new for VIEW):** `anim_spin_wheel` (WHEEL OF PAIN; the view's
   `anim_spin_*` hook spins it about the node's LOCAL +Y, authored = the wheel axle = glTF +Z toward the camera, pivot on the
   axle at (0, 3.34, z); radially symmetric so gltf-transform's quantisation keeps the pivot on the axle), `flame_range_l` /
   `flame_range_r` (BUTCHER BLOCK gas burners; `flame_*` scale.y hook), `marquee_bulbs` (both stages; static, optional chase).
   Measured fact for every stage lane: gltf-transform `optimize` (KHR_mesh_quantization) moves a mesh node's pivot to its bbox
   centre (translation changes, rotation kept, uniform scale = dequantisation) - a node that must rotate about a point needs its
   geometry symmetric about that point.
3. **New optional StageDef field:** `floor.trapdoors: [{x, z, sizeM}]` (+ `floor.note`) = where WHEEL OF PAIN's flush trapdoor
   plates are (x -4.7 / +4.7, z 0, 1.5 m); dressing only, available to a sim trapdoor move (zambini / ricky).
4. **Audio ids (per §9.2):** `music: "music_stage_butcher_block" | "music_stage_wheel_of_pain"`, `ambient: "amb_butcher_block" |
   "amb_wheel_of_pain"`.
5. **Tooling facts:** generated textures come from `art/stages/stagetex_a.py` (plain Python + PIL; text set in the game's own
   OFL fonts `runtime/src/ui/fonts/*.woff2`); shared Blender helpers `art/stages/stagelib_a.py` (`contact_render()` = the ENV_KIT
   section 8.3 side-by-side test, `--contact`). Found broken (P1, not STAGES-A's file): `art/stages/crowd_atlas.py` lines 437/467
   and `crowd_compose.py` line 141 carry a raw LF inside `newline="..."` string literals (SyntaxError on import; rust_theater.py
   cannot import crowd_atlas as committed); stagelib_a loads crowd_atlas with those literals repaired in memory.

## §31 CHANGED(VIEW) P2: PRIME TIME director, projectiles, props, bonus rounds, stage dressing (2026-09-30; additive)
Nothing here changes a §16 / §17 / §18 signature. Source of truth: `runtime/src/view/{prime,cinematics,projectiles,props,
brawl,stage,bout}.ts`; proof harness `python _harness/lookshots.py --sim` (lab `runtime/lab/view.html?sim=1`: the REAL sim
and the REAL data drive BoutView exactly as game.ts does - snapshots + deduped events once per frame).
1. **PRIME TIME** (`view/prime.ts`, a pure function of the cinematic frame -> rollback-safe, both peers identical):
   - Reads the §26.1 **v2** block literally when it has `camera`: `anim` / `victim` with `fromS` / `toS`, `pathA`, `gapD`
     (implicit first key = the actual gap; both roots clamped to x +-7.55), `camera` (the §26.1 formula; `blend` crossfades),
     `fx`, `crowd`, `slate`, `endGapM`. The view never changes the frame count. `fx` names supported: all of §26.1
     (`impact_s/m/l` = an extra comic burst on the target, no screen flash; `smear` 8 f; `electric` 30 f arcs + body flicker;
     `freeze_frame` = the picture (poses, camera, FX time) holds 20 f + white inset border, desaturation and a red REC dot;
     `letterbox` / `letterbox_off` (default ON for the whole cinematic when the block has neither); `slate` = the lower-third
     start (default frame 6); `dim` / `undim`; `spot` / `spot_off` (+ `target`) = set dimmed 0.86 + a spotlight shaft;
     `lights_flicker` 30 f; `pyro` 40 f; `confetti`). Unknown names are ignored. `crowd[].react` -> crowd pop amounts (ooh 0.4,
     gasp 0.55, cheer 0.85, roar 1.15, chant 0.7, applause 0.75, boo 0.5, laugh 0.45, hush 0), `ratings` up / spike / peak add
     0.25 / 0.5 / 0.8. Request to UI: a strings key `fx.replay` ("INSTANT REPLAY") - the freeze-frame stamp text is drawn only
     when it exists (copy lives in strings.json).
   - **v1** blocks (no `camera`) are inferred: strike marks (clips.json `marks.hitN` / `contact`) warped onto the `hits` frames,
     victim reactions switched on the blow and re-triggered per hit, `thrown_*` = carried at the attacker's chest, a victim
     path (knockback / launch / juggle / fall / slam) that ends EXACTLY at `endGapM`, the ROSTER shot vocabulary
     (`view/cinematics.ts`), per-cue FX beats (prime.ts `CUES`, authored from the ROSTER outlines).
   - Both: letterbox bars 10.5 %, the name slate (strings `hud.combo.prime` + the `slate` line split at ':' -> move / fighter;
     fallback fighter `name` + move `name`), background dim per shot, SUPER_HIT sparks on the victim's PRESENTATION body,
     metal sparks when a `metal` window is open, an 8-frame pose + position blend back to the sim after CINEMATIC_END.
   - View-side stage magic per cue (CUES; frames authored on the v1 `hits`, remapped piecewise-linearly onto the data's
     current hits): trapdoor (zambini, rerun), the magician's sheet (zambini), Gazza's ball keyed to his feet / head and the
     victim (hat_trick, flaming on the finisher). v2 data keeps these props but never the v1 path / visibility overrides.
   - Grab supers: when `MatchSnap.cinematic` is inactive and a fighter's `animId` is the §19.10 grab entry of a move with a
     `cinematic` block, the block plays from that `animFrame` (attacker pose + camera + fx; no `pathA` / `gapD`; the victim is
     the sim's). Measured today: bruno `final_delivery` starts a sim cinematic, so it takes the normal path.
   - Note to FIGHTERS: `gapD` is along the attacker's facing only, so a victim held during a SPINNING attacker clip (bruno
     `lariat_spin`, f40-100) stays in front of him instead of orbiting with him; keep such keys close to the body (gap
     <= 0.5 m) or ask VIEW for an optional `carry` window (follow the attacker's chest + facing).
2. **Projectiles** (`view/projectiles.ts`): type = the owner move's `projectile.clip` (brick, card -> a card FAN, flame,
   flame_breath, taser_bolt, football, fireball_football, saw_card, spotlight_beam, pyro_line; others by keyword); `kind 1` =
   Gazza's ball; `kind 2` = heckle object `system.json heckler.objects[obj].id` (tomato, bottle, shoe, chair). Bodies: lane
   ASSETS' prop GLBs where they exist (`brick`, `card_fan`, `football`; `spotlight` = the rig head above Ricky's beam), else
   view-built (propmesh.ts: saw card, taser barbs + wire, heckle objects) or authored particle effects (fire, beams, pyro
   columns). Each type has launch FX (slot appears), a trail, and impact FX on PROJ_HIT / PROJ_CLASH (`b` = slot) or a fizzle
   when the slot vanishes.
3. **Props** (`view/props.ts`): WHO / WHEN = `PROP_RULES` (johnny brick in hand during `brickbat_*` until the release frame;
   krane riot_shield always + baton always except taser moves / the `taser_fire` cinematic clip, taser during them; boneyard
   cleaver, ricky mic_cane, lotus gourd at the hips: always; zambini card_fan during `card_fan_*` until release). Grip
   precedence: props.json `props.<id>.fighters.<fighter>` > `props.<id>.attach` > GLB root extras > the rule's bone. An
   optional props.json `show` ('always' | a regex over move ids) overrides the rule. World-space full-basis solve per frame.
4. **BRAWL BREAK / HECKLER TOSS** (`view/brawl.ts`, reads §28.4 as written): `MatchSnap.brawl.goons` posed on
   `GameData.goonAnims[kind]` (blendT like a fighter), bodies = `art/gltf/**/goon_<kind>.glb` (lane ASSETS); until a goon GLB
   exists the pool uses the opponent body tinted (flagged `brawl.fallback: true` in BoutView.info(); never a primitive).
   `FighterSnap.absent` / the bonus modes hide fighter 1. Hits on goons (`b` >= 8) spark at that goon; GOON_DOWN bursts where
   it fell. **Popups hook (for UI):** `BoutView.popups(): ReadonlyArray<{ id, points, player, reason /* SCORE d */, total /*
   SCORE c */, x, y /* screen 0..1, y down, live every frame */, age /* s, removed at 1.4 */ }>` built from SCORE events
   (anchored at the last goon down for KO / crowd-hit reasons, else the player's chest). The view draws no text. The BRAWL
   camera (vFOV 45, lower, closer) frames the player + the goons within 4.5 m.
5. **Stage dressing schema** (`data/stages.json` §21 `dressing.animated[]` entries WITH a `kind`; entries without keep the
   P1 name hooks `anim_spin_*` / `anim_flicker_*` / `flame_*`, and `marquee_bulbs` gets a running-light chase by name):
   `{kind: 'spin', nodes: <glob>, axis: 'x'|'y'|'z' (default z), rpm}` · `{kind: 'flicker', nodes, hz, amp, dropout}` ·
   `{kind: 'chase', nodes}` (emissive waves along world x) · `{kind: 'flame', nodes}` · `{kind: 'sway', nodes, deg, hz}` ·
   `{kind: 'blink', nodes, hz}` · `{kind: 'scroll', nodes, speed}` (map offset) · `{kind: 'screen', nodes, content: 'hud'|
   'static'|'bars'|'logo'}` (the nodes' meshes get an unlit live feed: both HP bars, the clock, the names, a LIVE dot,
   scanlines; 10 Hz canvas) · `{kind: 'rain', area: {x: [x0,x1], z: [z0,z1], top}, rate, color}` (one instanced draw) ·
   `{kind: 'steam', at: [[x,y,z], ...], rate, size, color}` (FX smoke). `BoutView.info().stage.dressing` lists what bound.
   **Marquee glare** (verifier note): sign / bulb / marquee / lens materials with emissive strength > 1.6 are graded down at
   load (`info().stage.glareGraded`).
6. **Polish:** Showcase (D9) = three-point light (warm key + shadow, cool rim, magenta kicker, fill), a turntable platform
   (lacquer disc, glowing show-yellow ring, contact shadow), the model at true size framed to ~86 % of the region height, a
   3/4 sway instead of a full spin (never the back). Crowd (D11) = per card: clothing hue from a 9-angle palette on 80 % of
   cards (skin kept), brightness 0.8-1.08, height +-7 %, idle watch / jeer (a third alternate on their own clock), cheer <->
   hype alternation. KO finish hold = a low hero shot on the winner from the side away from the loser (the lying loser is
   below the frame).
7. **CHANGED(VIEW) P2 resume (2026-09-30 evening; additive, no §16 / §17 / §18 signature changed):**
   - §26.5 is now implemented in `view/prime.ts`: v2 shots scale `lookH` / `dist` by the target's height / 1.80 (`both` =
     the taller); the v2 gap never goes under attacker `push.front` + defender `push.front` (+0.20 m for a held riot shield)
     while both are grounded (full below 0.15 m lift, ramped out by 0.30 m). `PrimeBegin` gains optional `frontA` / `frontV`,
     `PrimeSample` gains `camTarget`.
   - **Framing guard** (`BoutView.frameGuard`, v2 shots except `top`; deterministic: reads only this frame's posed bodies):
     a `close` shot on one fighter follows a crouching subject down (camera + look translate by 0.8 x the head's drop below
     its standing height); the target's head top (airborne: + hands and feet) stays under the letterbox and, on `both`
     shots, both bodies stay inside the frame sideways - dolly out along the view (<= 2.5 m), then widen the FOV (<= 60).
     Read-back `info().prime.guard = {dolly, fov, crouch}`. FIGHTERS' numbers stay authoritative; the guard only corrects.
   - Freeze-frame border = one clean inset rectangle (was drawn as a '#').
   - BRAWL pool: 4 views per goon body (`goon_hardhat` / `goon_medic` / `goon_security`), goons at their TRUE height (only
     the stand-in opponent body is scaled to 1.8 m); `info().brawl.live = [{slot, sim, body, clip, h, vis}]` and
     `borrowed` (a goon shown on another kind's body; expected 0). Goons waiting in the approach ring stand staggered in
     depth (per slot, <= 0.7 m) and come back to the fight line when they hold a token / telegraph / are hit / down (a
     wave on one side no longer walks through itself; the sim is unchanged).
   - **Score popups are drawn by the view** (nothing consumed `BoutView.popups()`; grep of ui/ + game.ts): numeric comic
     sprites (`+150`, `-300`; digits only, no copy) at the §31.4 anchor, rising and fading over 1.4 s.
     `BrawlView.drawPopups = false` turns them off if UI draws its own from `popups()` (hook unchanged).
   - Krane's taser rides in the LEFT hand (the taser clips punch the shield hand out; the wire / barb leave from there):
     `PropRule.mirrorGrip` + `PropAttach.mirror` = the props.json right-hand grip mirrored across the hand's local X.
   - Stage glare: neon materials (`/neon/`) capped at emissive 2.2 (`NEON_CAP`; ROOFTOP's strength-7 letters hazed the
     frame pink). Name hooks bind the TOP matching node only (gltf-transform `<name>_1..` primitive children were bound too:
     the wheel / beacons spun at 2x, BUTCHER BLOCK had 6 flames for 2 burners).
   - Stage: the P1 name hooks are now listed in `info().stage.dressing` (`spin ... (by name)`, `flicker ...`, `flame ...`);
     `steam_*` nodes vent steam and BUTCHER BLOCK's gas ranges (`flame_range_*`) steam from the pot level above the burner
     (view-only, no stages.json entry needed); `info().stage.live` = the hooks' current values (spin angles, flame scales,
     flicker levels, rain offsets, steam emitters, screens).
   - Dev-only harness handle: `window.__HP_VIEW__ = { info(), popups(), view }` of the live BoutView (set in
     `BoutView.create` under `import.meta.env.DEV`; tree-shaken from the build). `python _harness/lookshots.py --game` drives
     the REAL game page with it (deep link + `__HP__.dev`: freeze, one tick per rendered frame, `__HP__.shot`).
   - `perfcheck.py --stages a,b,...` measures the super cinematic on every set in one page (p50 / p99 per stage).

## §32 CHANGED(ASSETS) P2: BRAWL BREAK goon bodies, goon clips, data/goons.json (2026-09-30; additive)
Answers §28.4 ("ASSETS may rename by writing the ids here - SIM mirrors them into system.json") and §31.4 (goon GLBs).
1. **Goon ids (final)** = the GLB / clips stems: `goon_hardhat` (Ch17_nonPBR, 1.95 m, hard hat + hi-vis vest),
   `goon_security` (Ch35_nonPBR, 1.85 m, helmet + gas mask; the texture's printed POLICE / SWAT are repainted to the show's
   K13 SECURITY / SECURITY / K13 lettering during the build - no police marking ships), `goon_medic` (Ch16_nonPBR, 1.78 m,
   scrubs + cap + mask). **Request to SIM:** `system.json brawl.kinds[].id` -> `goon_hardhat, goon_security, goon_medic`
   (today `goon_riot` / `goon_scrub`: view/brawl.ts matches kind ids to GLB stems and falls back to any goon body).
2. **Files:** `art/gltf/fighters/goon_<x>.glb` (same pipeline + contract as §6.1 fighters: one skinned mesh `<id>_body`,
   `<id>_skin` / `<id>_cutout`, one webp albedo atlas, rotation tracks for every joint + one Hips translation, facing +Z,
   height = heightM; budget 1.5 MB each) and `data/clips/goon_<x>.clips.json` (§6.3 layout). `core/data.ts` loads the
   clips files into `GameData.clips` like any other (no fighter JSON exists for them, so probe_data ignores them).
   Built by `python tools/build_fighters.py --goons` (not part of `--all`); plan = `tools/clipplan/_shared.json` (all 34
   shared system clips, §6.2) + `tools/clipplan/_goons.json` (+ its `_override.<id>` block).
3. **Goon clips** beyond the shared set: `goon_shove` (two-hand shove, Mixamo Pro_Magic 2H Attack 02 f28-62, contact f43),
   `goon_haymaker` (Pro_Melee_Axe horizontal f16-52, c29), `goon_kick` (Pro_Melee_Axe kick ver. 1 f8-40, c22 - a push
   kick), `goon_taunt` (chest thump; security = battle cry, medic = angry gesture). **Request to SIM:** the shared goon kit
   = `shove` / `haymaker` / `kick` with those clips (today `jab` -> clip `goon_jab`, `lunge` -> `goon_lunge`, which no body
   carries - the view renders idle for a missing clip); `data/goons.json` below has the three Move objects measured on
   each goon.
4. **`data/goons.json`** (generated by `python tools/goons_data.py` from the published clips; `rawFromFiles` ignores it
   until SIM reads it): `{ version, ids: [...], moveNames: ['shove','haymaker','kick'], goons: { <id>: { name, role, body,
   glb, clips, heightM, hp, walk, weights: {shove, haymaker, kick} (relative AI pick odds), taunt: 'goon_taunt', tauntDur,
   moves: { <name>: Move } } } }`. Move = an ordinary §5.2 object (the shape system.json `brawl.moves` uses): kind, input,
   strength, startup (>= 30, brawl.telegraphMinF), active, recovery, damage, hitstop, hitstun, blockstun, guard, pushback,
   onHit, name, `boxes` (one box from the body front 0.25 m to that goon's measured effector + half the class width, at the
   effector height, over the active frames), `move` (root travel from clips.json), `anim: { clip, warp: [[0,0],[startup,
   clip contact],[total, clip dur]] }`, plus informational `effector`, `_clip`. HP / walk = SIM's proposal (2400 / 1.5,
   3000 / 1.3, 1800 / 1.8); frame data mirrors SIM's jab / haymaker / lunge rows.
5. **Pipeline options (tools/bodies.json, all optional, absent for the 12 fighters):** `goon: true`, `budgetMB` (size gate),
   `atlas` (px), `decimate` (collapse ratio of the joined body), `repaint: { seed, images: { <texture stem>: [ { rect
   [x0,y0,x1,y1] px, text, rot, font, donor [dx,dy] | null } ] } }` -> `tools/goon_repaint.py` (prints lettering removed by
   donor clone / normalised-convolution fill, new text in the original ink with the weave showing through) -> the bake swaps
   the image before the atlas bake (`hp_body.prepare_body` `image_overrides`). Check image: `art/renders/<id>/_src/
   repaint_check.png` (before | after).
6. **CHANGED(ASSETS) P2 resume (2026-09-30 15:40): goon reconciliation DONE - the sim reads the shipped goons.** Supersedes
   the "requests to SIM" in 32.1 / 32.3 and the proposed ids / move names in §28.4 (SIM lane finished; ASSETS made the
   edits in the goon entries of `data/system.json` and the goon mapping of `core/data.ts` / `core/sim/compile.ts` /
   `core/sim/brawl.ts`, each marked `CHANGED(ASSETS) P2`):
   - `system.json brawl.kinds` = `goon_hardhat` (2400 HP, walk 1.5), `goon_security` (3000, 1.3), `goon_medic` (1800, 1.8) -
     same order / numbers as SIM's kinds, so kind indices, waves and AUDIO's index fallback (router.ts `goonVoiceRate`) are
     unchanged. `brawl.moves` = `shove` (5M, 32/4/30, 350) / `haymaker` (5H, 45/5/40, 600) / `kick` (6M, 36/5/40, 500), clips
     `goon_shove` / `goon_haymaker` / `goon_kick` (every goon GLB carries them). `GoonSnap.moveName` is now `'shove' |
     'haymaker' | 'kick' | ''` (types.ts comment still says jab / lunge). system.json owns the goon frame data, HP and walk;
     its shared `boxes` / `move` / `moveRangeM` rows are the 3-goon measured mean (the fallback).
   - `data/goons.json` v2 (`python tools/goons_data.py`; it READS frame data / HP / walk from system.json, never its own copy):
     per goon, per move the system.json row + that goon's measured `boxes`, `move` (root travel), `rangeM` (start range =
     travel at contact + box far edge - 0.15 m) and `weights` (AI pick odds: hardhat shove 2 / haymaker 3 / kick 1, security
     3 / 1 / 2, medic 1 / 1 / 3). `core/data.ts` loads it (`RawData.goons`, Vite glob + Node reader already cover data/*.json)
     and `applyGoons` merges it into a COPY of `system.brawl.kinds[]` (`GoonKindDef`: `moves`, `weights`, `rangeM`), so
     `dataHash` covers it. A goons.json move whose startup / active / recovery differ from system.json (or a missing /
     malformed entry) = a GameData warning and that goon keeps the shared rows. `CBrawl.kindMoves / kindRange / kindWeights`;
     brawl.ts uses the goon's own kit at every move lookup, and `chooseMove` is a weighted roll over the kind's weights
     (was: lunge when far, else 40 % haymaker). Anim tables (`GameData.goonAnims[id]`) = 34 shared + the kind's 3 moves.
   - AUDIO: `router.ts GOON_VOICE_RATE` already keys the final ids (`goon_hardhat` / `goon_security` / `goon_medic`, AUDIO's
     15:19 edit); nothing needed.
   - Pipeline: `goon_hardhat` bakes with `decimate: 0.72` (tools/bodies.json; 53,738 -> 38,690 tris) = 1,463,552 B <= 1.5 MB.
     `art/blender/qc_render.py` also renders one game-camera frame per clips.json mark (`<clip>__m_<mark>.png`, qc.json
     `mark_frames`) so re-timed throw marks can be read against the pose.

## §33 CHANGED(AI) P2: the CPU plays the uniques, habit-guess defense, meter policy, G11 probes (2026-09-30; additive)
§11 / §16 / §23 signatures unchanged (`createCpu(level, fighterId, seed)`, `Cpu.input / prepare`). Evidence:
`_harness/_reports/progress_p2_ai.md`. Everything below is lane-AI internal unless marked **Request**.
1. **Uniques** (`core/ai/uniques.ts`, new): per §28.2 kind, from honest information only (a reaction earned on the
   reaction clock, an observed habit, the CPU's own state, the visible opponent): counter moves (Rerun / Ricky) when the
   incoming active frames fall in the catch window, as reads vs a presser / on the wake-up / after the CPU's blockstun, DEAD
   AIR vs projectiles; teleports (Zambini) cornered -> behind, crowded -> home, through a reacted projectile, wake-up
   mixups; the stance (Lotus) entered at follow-up range, walked in, follow-up chosen from the opponent's VISIBLE posture
   (crouching -> M overhead, standing -> L low, a low-happy opponent -> H hop), exit / timeout; evades (Johnny WEAVE ->
   counter hook trigger, Gazza dive -> special cancel); armor steps (Bruno / Boneyard) as reads / approaches then command
   grab / 2L tick / special in the cancel window; the ball (Gazza) only when available (at his feet, or a hover / resting /
   loose ball in kick range - the CPU mirrors `ballReady` from its own u0 and the ball on screen), re-kick of a hovering
   ball, walking to a resting one; rekkas (Patch CUE 1 -> 2 -> 3, ender from the visible posture); installs (no kit has one;
   started at a safe distance; proven with an injected install); THE FREAK: armored leap / ROAR through projectiles /
   MELTDOWN reads; RICKY: SPOTLIGHT from mid range, PYRO in phase 2. Kit specials in no `cpu` list are occasional mid-range
   pokes when they connect and are not worse than -12 on block (or armored).
2. **Kit** (`kit.ts`): a `phases` kit gets a second measured recipe table for phase 2 (the sandbox sets its OWN u0 = 2) and
   the brain switches on its own u0; a SIMPLE charge kit keeps the charge-free S+dir recipe as `alt` (used when no charge is
   stored); stance follow-ups get `ctx 'stance'` recipes, rekka / weave parts `ctx 'chain'` recipes from their compiled
   trigger (motion form in SIMPLE too - see request (b)); `MoveInfo.tool / counter / tele / evade* / projInv* / revInv /
   phase2`; `Kit.sup1 / sup3` are the supers of THAT phase's routing (Ricky phase 2: SEASON FINALE).
3. **Perception** (`sense.ts`): `FView.uq[4]` / `instF` = the CPU's OWN unique ints / install (zero for the opponent);
   `HIDDEN_FIELDS` += the opponent's `F.uniq..+3` and `F.ucnt` (a charge kit mirrors its input-derived charge counters
   there) - probe_personas H2 scrambles them too; `ProjView.vy / mode`.
4. **Honest low-level defense** (task: levels 0-5 cannot react to a 4-18 f ground attack): `core/ai/habits.ts` (new)
   keeps the opponent's close-range offense (low / overhead / mid / throw / jump / projectile, decay 0.9 per action), the
   share of HIGH strikes, its attack rate while free in its range, its meaty rate on my wake-ups and its pressure rate after
   my blockstun - each observation committed only `reactF` frames after it happened (pattern knowledge about the NEXT
   attack, never the one on screen). cpu.json `levels[].habit` (L0 0.3 .. L8 0.8; personas novice 0.5, optimal 0.9) =
   its weight: guard posture chance in the opponent's range = (1 - habit) x the flat `guard` lever + habit x min(1, 2 x
   block) x attack rate (`plans.ts guardChance`); crouch vs stand blended with its lows vs overheads (x confidence); throw
   tech + close-range throw escapes (step out / L3+ a fast light: strike beats throw) with its throw share; wake-up guard /
   reversal / counter read with its meaty rate. Measured (probe_personas H5, L3 defender, no reactable attack): crouch share
   vs lows 0.83 (habit 0: 0.52); after 24 lows -> overheads the first 4 overheads are still crouch-guarded (0.80: no
   reaction), later ones stand-guarded more (0.64).
5. **Meter policy**: a super that finishes the round is taken at any route tier the meter tier allows (cheapest first); the
   'cancel' tier (L6+) cancels a CONFIRMED hit into a super; a CPU allowed Lv3 saves toward it (`rules.lv1Spend` 0.2 = the
   chance per bar change, LATCHED, to spend a Lv1 anyway) and cashes it on a clean punish (`rules.lv3Cash` 0.6); invulnerable
   supers are wake-up reversals and (air-/strike-invulnerable from frame 1) anti-airs; a projectile's flight time counts in
   punish windows. cpu.json gains `uniques {...}` (per-tool rates) and `rules.lv1Spend / lv3Cash` (documented in `_src`).
6. **Probes**: `probe_personas.ts` + H5 (pattern guesses, gating always) + U1 (every kit's special families, Lv1, Lv3 and its
   unique in natural CPU bouts + full-meter bouts + an injected install; gating with `--seeds`, reported in the smoke run).
   `_harness/probe_season.ts` (new, G11 node half, auto-discovered by run_probes): ladder data vs `flow.ladderSpecs`, 432
   ladders (12 fighters x SEASON/PILOT x difficulty -2/0/+2 x 6 seeds) resolved through `flow.buildSeason` + built stages,
   BRAWL BREAK / HECKLER TOSS for all 12 fighters staged as game.ts does (scored by a scripted player), RICKY's phase 2 in
   the boss bout (fires, persists, phase-2 recipe table + moves), full PILOT x 12 / SEASON x 3 runs to `SeasonRun.cleared`
   + ending text / key. `_harness/playtest.py --season` (G11 browser half): real key events from the main menu through a
   PILOT to the ending card; TIME CONTROL is said in its report - the bouts run with `__HP__.dev.freeze` and the harness
   steps `--step-frames` (2) per key decision (`--realtime` to play unstepped); `--max-bouts 1` = the smoke run.
7. **Request to SHELL** (game.ts): flip `BONUS_ROUNDS_IN_SIM` to true - the sim runs both bonus modes (§28.4) and
   probe_season S3 plays them for all 12 fighters exactly as `seasonSlot` stages them (mode brawl / heckler, P2 = the
   player's id at cpu 0, which the CPU answers with word 0). Until then THE SEASON passes over both bonus slots and
   `playtest.py --season` FAILS its `bonus_round_played` step (by design: it reports the skip).
8. **Requests to SIM** (core/sim/inputs.ts; the CPU works around both, a human cannot): (a) SIMPLE rekka enders - a
   sibling trigger `"5S"` (simpleDir 5) matches S with ANY direction and is checked first, so Patch CUE 2 -> 2S gives CUE 3
   OVERHEAD, never CUE 3 LOW (measured `cue_m > cue2 > cue3_oh`); (b) CLASSIC: a chain motion typed during the parent's
   hitstop is lost - the button's release re-reads the motion (negative edge) as the PARENT special and overwrites the
   buffered chain (`236M` in CUE 1's hitstop -> no CUE 2; after the hitstop -> CUE 2). Scratch repro:
   `_harness/scratch/ai_p2_rekka.ts`.
9. Notes for P4 / SHELL: a boss played by the player (after the unlock) meets its own mirror in its slot (flow.ts
   `buildSeason`); THE FREAK (CPU L6) beats the `optimal` persona 80 % (32/40, seeds 1..40) while RICKY does 27 % (16/60) -
   the mini boss is the harder wall (its kit: 11,500 HP, 2.4 m reach, armor; AI tool rates changed nothing measurable).

## §34 CHANGED(integrator) P2/P3: the §27 SHELL requests landed, bonus rounds in THE SEASON, v0.2.0 (2026-09-30; additive)
Every file carries a `CHANGED(integrator) P2` note at the change. Evidence: `_harness/_reports/progress_p2_integrator.md`.
1. **Training driver in game.ts (§27.1, exactly the lines the UI lab proved):** a training bout (offline) gets `Bout.trainer =
   new TrainingDriver({opts: menus.training, data, hud, sim: {createMatch, step, readFighter, readMatch, devSet}, cpu:
   createCpu})`, `begin(cfg, m)` AFTER `hud.mount` (mount resets the training overlays); `tick()` swaps in `pending()`'s Match
   (seen cleared, lastFrame = its frame) then steps `trainer.tick(m, words)`; `frame()` calls `trainer.frame(projector)` after
   `hud.frame` (the fight camera -> CSS px of the canvas); `teardown()` calls `end()`. game.ts creates NO game-level CPU in a
   training bout (the driver owns the dummy incl. DUMMY: CPU); audio `local` = 0 in training. `runtime/src/lab/ui_game.ts`
   no longer patches Game.prototype (a second wrapper would drive the driver twice) - it boots the game with its read-backs.
   Deep link: `?mode=training` P2 defaults to cpu -1 = the dummy (P1: 0 = a CPU stood in); `?cpu2=n` = DUMMY: CPU at n.
   `__HP__.state().trainer` = `TrainingDriver.readback()` (null outside training).
2. **§27.2** was already wired by NET (§29.6). **§27.3:** `MatchResult.rounds = BoutStats.rounds.slice()`.
3. **THE SEASON (§27.4 hooks):** `LadderView.continues` = run.continues and a slot being replayed after a loss shows
   `result: 'lost'`; bonus `CardView.seconds` = system.json `brawl.seconds` / `heckler.seconds`; `showEnding({..., length,
   continues})`; a season bout calls `hud.setScore(season score banked so far)` and `hud.setEpisodeLine('EPISODE n - <STAGE>')`
   (bonus rounds keep the sim's running SCORE). `LadderView.ratings` is NOT passed (no season-level ratings number exists).
4. **Bonus rounds ON:** `BONUS_ROUNDS_IN_SIM = true` (§24.13 superseded). Slots come from data/ladder.json: SEASON = BRAWL BREAK
   after bout 3, HECKLER TOSS after bout 6; PILOT = BRAWL BREAK after bout 2. Staging (= probe_season S3): mode brawl / heckler,
   p[1] = the player's own id at cpu 0 (absent), stage = the PLAYER's home stage; no VS card; the bonus card first. The
   episode score of a bonus round = `MatchSnap.brawl.score` (SCORE `c`); P1 summed the positive SCORE `b` deltas, which
   over-counted a HECKLER TOSS (heckle hits are negative deltas).
5. **Stages:** all 5 stages are `built` in data/stages.json, so the VERSUS stage select offers all five (no COMING SOON) and every
   ladder slot plays on its opponent's home stage (fighters/<id>.json `stage`): RICKY's boss bout on `control_room`, THE FREAK
   on `butcher_block`. `playableStage()` stays as the fallback for a future `todo` stage.
6. **Version:** `main.ts VERSION = 'hit-parade-0.2.0'`, package.json 0.2.0; `runtime/public/game_meta.json` describes what exists
   (12 fighters incl. the two unlockable bosses, THE SEASON / PILOT with both bonus rounds, VERSUS, ONLINE, TRAINING, 5 stages,
   touch) and claims no rated / ranked online (the ratings RPC is not deployed, §29.9).

## §35 OWNER DIRECTIVE: FULL 3D RING (2026-09-30) — supersedes the 2.5D plane (§1, §2, §4.3.1, §6.4, §7 camera)
Owner, verbatim: "this should not be a flat 2d arena/match it should be 3d or circular where we can walk
around the ring to fight". HIT PARADE becomes a **3D arena fighter** (Tekken / Soul Calibur family):
fighters move on the ground plane (x, z) + height y, can sidestep and circle-walk around each other inside a
360-degree ring, and the camera orbits the pair. Everything not contradicted here stays (frame data, meters,
throws, parry, IMPACT, supers, uniques, bonus rounds, rollback, SIMPLE/CLASSIC).

### §35.1 Fixed-point geometry (SIM; deterministic across browsers)
- Positions x, z (and y) in U (10 µm) as before. **Yaw** = int in [0, 65536) (65536 = 360°); yaw 0 faces +Z,
  positive yaw turns toward +X (matches three.js rotation.y for a model facing +Z at rest).
- Trig ONLY via `core/sim/fx3d.ts`: a Q14 sine table (4096 entries, cos by offset), `yawToDir(yaw) -> [dx, dz]`
  (Q14), `dirToYaw(dx, dz)` (integer atan2 via table/binary search), `isqrt` (integer sqrt), `rot(v, yaw)`,
  dot/cross kept inside safe integer ranges (document the ranges). NEVER Math.sin / cos / atan2 / sqrt / hypot in
  core/sim — browser libm results differ and would desync rollback netplay.
- State additions per fighter: z, vz, yaw, tracking counters, lateral velocity, step state; world: camera normal
  `camN` (Q14 unit vector in the plane, §35.3), ring params cache. Versus state stays <= 1024 ints.

### §35.2 Movement
- **Auto-face:** in neutral states (idle, walk, crouch, block, dash, circle, landing) each fighter's yaw snaps to
  face the opponent every frame. During an attack the yaw follows the move's tracking (§35.4). In hitstun /
  knockdown the yaw is kept.
- **Walk** forward/back = along the line to the opponent (existing speeds). Dashes and jumps along that line.
- **STEP controls:** input bit 13 `STEP_IN` (circle AWAY from the camera) and bit 14 `STEP_OUT` (circle TOWARD
  the camera); both pressed = neutral (SOCD). **Tap** = SIDESTEP: 15 frames total, 0.85 m along the circle around
  the opponent (distance to the opponent preserved: an arc, not a straight line) [CHANGED(fix_core) §35.20: the arc length is per
  fighter, 0.85-1.72 m]; attacks may be buffered from frame 9 [CHANGED(fix_core) §35.20: from frame 2, held to 11] and come
  out from frame 11 (step-attacks); block from frame 12. **Hold** past the sidestep = SIDEWALK:
  circling at 1.8 m/s tangential around the opponent (the "walk around the ring"); ends on release with a 4-frame
  settle; holding BACK cancels circling into block. No invulnerability: evasion is geometric (moving off the line).
- Default bindings: keyboard Q = STEP_IN, E = STEP_OUT (P2: numpad 7 / 9); gamepad right stick up = STEP_IN,
  down = STEP_OUT; touch: two STEP buttons (IN / OUT) above the stick. All remappable.
- Screen-relative LEFT/RIGHT -> back/forward uses the camera basis (§35.3) exactly as the old facing sign did.
- **Ring boundary** (stages.json `ring`): `{shape: 'circle'|'poly', radiusM, sides, rotDeg, wallHeightM, surface}`,
  default circle radius 5.5 m. Push cylinders collide with the boundary; a launched body reaching it = WALL_SPLAT
  (b = wall index: circle = index of 16 sectors, poly = side index; contact point + normal in the payload).
  "Against the wall" (pushback transfer, IMPACT splat, STAGE FRIGHT stun) = the defender within 0.45 m of the
  boundary along the attack direction. No ring-outs.
- Round start: fighters 2.4 m apart through the ring centre on the stage's `spawnAxisDeg` line, facing each other.

### §35.3 Camera basis in the sim (inputs camera-relative AND deterministic)
- `camN` = Q14 unit vector perpendicular to d = P2 − P1, choosing the perpendicular closest to the previous camN
  (continuity; the initial camN points from the ring centre toward the stage's `cameraSideDeg`). If |d| < 0.3 m keep
  the previous camN. Screen-right `R` = the in-plane perpendicular of camN oriented so that at round start P1 is
  screen-left.
- The VIEW camera sits on +camN from the pair midpoint and orbits as the pair circles — the sim owns the basis, the
  view smooths it. STEP_IN moves along the circle tangent that points toward −camN, STEP_OUT toward +camN.
- Cross-overs (jumping over, being thrown behind) swap screen sides naturally (Tekken-style); camN never auto-flips.

### §35.4 Moves in 3D (FIGHTERS data + SIM)
- New optional Move fields, defaulted by class in the kit generator: `track: {until, rate}` (default normals
  until = startup − 4, specials startup − 6; rate = full re-face per frame), `homing: true` (tracks through
  active: sweeps, spins, lariats, flairs, most supers, command grab reach arcs), `linear: true` (no tracking after
  frame 1: rushes, straight projectiles, charge moves), `lateralM` (hitbox half-depth across the attack line;
  defaults L 0.15, M 0.18, H 0.22, sweep 0.45, homing/spin 0.60).
- Hitboxes = boxes in attacker-local (forward, lateral, up); hurt = vertical cylinder per fighter (radius from the
  measured body in bodies.json) with height ranges per stance (stand / crouch / air). Hit test = box vs circle in
  the attacker's local plane + height overlap, integer math.
- Projectiles launch along the thrower's yaw at spawn (`aimed: true` = aim at the opponent at spawn), travel in the
  plane; sidestepping beats straight projectiles; Gazza's ball rebounds off the ring boundary (vector reflection).
- Throws: defender within throw range AND inside the thrower's front arc ±70°; victim timelines play along the
  thrower's yaw; back throws land behind along −forward.
- Pushback along the attacker's forward vector.

### §35.5 Clips (ASSETS)
New shared clips on every body: `sidestep_l`, `sidestep_r` (the fighter's own left/right, ~15 f), `sidewalk_l`,
`sidewalk_r` (loops, 1.8 m/s tangential), optional `turn_l` / `turn_r`. Sources: Pro_Magic Standing Walk
Left/Right and Standing Run Left/Right, Male_Locomotion left/right strafe (walking), Magic_Locomotion strafes;
guard upper body from the CMU guard layer like the other locomotion clips. The sim picks _l/_r from the step
direction relative to the fighter's yaw. Rebake all 12 fighters + 3 goons.

### §35.6 Stages (STAGES): 360-degree arenas
Each of the 5 stages becomes an arena seen from every angle as the camera orbits: a ring (circle or octagon,
radius 5.0–6.0 m) with a visible boundary (pit wall / ropes / cage / railing / counters) that reads as a splat
surface, the stage's identity set pieces kept, and crowd + dressing on ALL sides (tiers, balconies, bleachers);
lights = a fixed pool that works from all angles. Budget per stage ≤ 6 MB, ≤ 150 draws; crowd stays impostors.
New stages.json fields: `ring`, `spawnAxisDeg`, `cameraSideDeg`, `cameraMaxM` (old `walls.x` / fightStrip are
superseded; keep them only as legacy until the sim no longer reads them).

### §35.7 Camera (VIEW)
Orbit camera: target = pair midpoint (y 1.0), position = mid + camN·dist + up·1.35 m, pitch −4°, vFOV 35°,
dist = clamp(4.4 .. 9.5 m) by separation so both fighters (heads + feet) stay in frame, smoothed (angle and
distance), never inside the ring wall or set geometry (pull in / raise when occluded), jump pan as before
(HUD-clear), rotational shake unchanged, cinematics relative to the attacker's yaw (the existing director keeps
working), KO orbit, perfect-parry zoom. BRAWL camera: behind/above the player, framing the nearest goons.

### §35.8 BRAWL BREAK / HECKLER in 3D
Goons spawn around the ring and approach from all directions; the player's attacks auto-target the goon nearest
the stick direction (soft lock); tokens ≤ 2 unchanged. Heckle objects arc in from the crowd on all sides.

### §35.9 CPU (AI)
CPU sidesteps linear attacks it has honestly read (level-scaled reaction rules, no input reading), punishes whiffed
linear moves from the side, uses homing moves vs steppers, circle-walks to get off the wall, avoids its back to the
wall.

### §35.10 Gates added
`probe_3d.ts`: sidestep evades a linear attack but not a homing one; sidewalk keeps distance ±2 cm over 2 s;
tracking until/rate as authored; camN continuity (no flips while circling 360°); ring collision + wall splat on
circle and octagon rings; projectile dodged by a step; throw front-arc rule; determinism + synctest with random STEP
inputs (0 mismatches). G4/G6 add a real-key sidestep + circle-walk in the real game with the camera orbiting
(screenshots from 3 angles READ).

### §35.11 CHANGED(STAGES3D-A): the §35.6 stages.json fields, pinned (2026-09-30; additive, legacy fields kept)
`tools/merge_stages.py` (lane STAGES3D-A) validates these for every built stage that carries `ring`; SIM / VIEW / AI /
STAGES3D-B build against this text. All metres in game axes (§2), ring centre = world origin (0, 0, 0), floor y 0.
1. **Angles** (every `*Deg` below): degrees in the ground plane, the §35.1 yaw convention: 0° = +Z, +90° = +X, i.e.
   direction(θ) = (x = sin θ, z = cos θ). Integer sim code converts with `yaw = round(θ · 65536 / 360) mod 65536`.
2. **`ring: { shape, radiusM, sides, rotDeg, wallHeightM, thicknessM, surface, dustColor }`**
   - `radiusM` = centre -> the boundary's INNER face (circle: its radius; poly: the apothem = centre -> each side's
     inner face). A body centre stays <= radiusM − its push radius. 5.0 <= radiusM <= 6.0.
   - `shape: 'poly'`: `sides` (8 = octagon) flat sides; side k (0..sides−1) has its outward normal at angle
     rotDeg + k·360/sides; inner corners at rotDeg + (k ± ½)·360/sides, radius radiusM / cos(180°/sides).
     WALL_SPLAT b = side index k.
   - `shape: 'circle'`: `sides` = 16 = the WALL_SPLAT sector count; sector k is centred on rotDeg + k·22.5°,
     b = round(wrap360(θ_contact − rotDeg) / 22.5) mod 16.
   - `wallHeightM` = top of the boundary above the floor (all three STAGES3D-A rings <= 1.2 m, below the 1.35 m
     camera); `thicknessM` = inner face -> outer face (occlusion hint for the camera); `surface` / `dustColor` = the
     splat material + dust tint (replace `walls.splat[].surface/dustColor` for ring stages).
3. **`spawnAxisDeg`**: round start P1 = −(spawn.distanceM / 2)·direction(spawnAxisDeg), P2 = +(distanceM / 2)·direction
   (distanceM 2.4). `spawn.p1/p2` are written consistently (merge_stages checks to 1 cm).
4. **`cameraSideDeg`**: the initial camN points from the ring centre toward direction(cameraSideDeg) (§35.3); the
   stage's identity set piece is authored on the far side (cameraSideDeg + 180°) so the round-start shot shows it
   behind the pair. STAGES3D-A: spawnAxisDeg 90 (P1 at x −1.2, P2 at x +1.2) + cameraSideDeg 0 (camera on +Z):
   the round-start frame matches the old 2.5D framing.
5. **`cameraMaxM`**: horizontal radius from the ring centre inside which the camera band y 1.30–3.00 m holds NO set
   geometry (only the floor and the ring boundary, which stays below the band). Set pieces, rails, crowd and
   overhead rigs start outside it (rigs above it may overhang only above y 3.0). The VIEW may place the camera
   anywhere inside cameraMaxM at y 1.3–3.0 without entering geometry; beyond it, pull in. Measured per build
   by a BVH probe in the stage script (`clearance` in the fragment's `build`); STAGES3D-A value 9.5.
6. **Crowd bays (build input only; the view reads the GLB `crowd_*` empties as before):** besides the §21 linear bay
   (`x: [x0, x1]`, rows `{z, y}`) an ARC bay is `{ id, arcDeg: [a0, a1], rows: [{r, y}], spacing, jitter: [jt, jr],
   seed, angle? }` - people along each row's arc (radius r, feet at y), cards facing the ring centre (node yaw =
   θ + 180°), extras unchanged `{bay, row, i, rand, angle}`.
7. **Legacy:** `floor.fightStrip`, `walls.x`, `walls.splat` (ids 0/1 at x ∓8) and the 2.5D `camera` fields stay in
   the three STAGES3D-A fragments unchanged until the sim/view stop reading them; merge_stages only WARNS about them
   on ring stages. `camera.proofShots` gains the 16 orbit shots `orbit_<deg>_<n|f>` (8 angles every 45° from
   cameraSideDeg, dist 4.4 / 8.0 m, eye y 1.35, look-at (0, 1.0, 0)) the lab (`/lab/stages.html?shot=`) renders.

### §35.11b CHANGED(STAGES3D-B): rooftop + control_room follow §35.11 (STAGES3D-A) exactly - STAGES3D-B additions
Both fragments are written to the §35.11 text above (angles, `ring` incl. `thicknessM` / `dustColor`, `spawnAxisDeg` 90,
`cameraSideDeg` 0, `cameraMaxM` = the §35.11.5 clear radius (9.5), `build.clearance` probe, the 16 orbit shots
`orbit_<deg>_<n|f>`, legacy fields kept); the two texts agree on every value the sim reads (see §35.12). STAGES3D-B's
earlier draft here defined `cameraMaxM` as an orbit distance - WITHDRAWN in favour of §35.11.5. Optional extras nobody
has to read: `ring.centre: [0, 0]` (SIM3D's default), `ring.vertexRadiusM` (poly), `ring.measuredLowTopM` (tallest item
inside the clear radius: the railing), `camera.clearRadiusM` (= build.clearance.minRadiusM rounded down; measured on the
stricter band y 1.15-4.5 m, which contains 1.30-3.00), crowd bays with `rotDeg` (a §21 linear bay laid out facing local
+Z and yawed about the ring centre - the §35.11.6 arc bay is not used), `near_center` / `far_center` aliases of
`orbit_000_n` / `orbit_000_f` in proofShots. Rooftop ring: circle r 5.5, 16 railing posts on the sector BORDERS
(yaw 11.25 + 22.5 k) so every sector centre is a cable span; control room: octagon apothem 5.5, rotDeg 0 (flat sides face
+-X / +-Z, corner posts at yaw 22.5 + 45 k).

### §35.12 CHANGED(SIM3D): how the sim reads the §35.11 stage fields (early note; the full SIM3D interface note follows as §35.13)
- SIM3D adopts §35.11 exactly as both STAGES3D texts agree: yaw-convention degrees (dir(a) = (sin a, cos a) in x, z),
  `ring.radiusM` = circle radius / poly APOTHEM, poly side k outward normal at rotDeg + k·360/sides (WALL_SPLAT b = k),
  circle b = round(wrap360(θ_contact − rotDeg) / 22.5) mod 16, optional `ring.centre: [x, z]` (default [0, 0]).
- Defaults when a stage has no `ring`: circle, radiusM 5.5, rotDeg 0, centre [0, 0]; no `spawnAxisDeg` = 90, no
  `cameraSideDeg` = spawnAxisDeg − 90 (= the old 2.5D layout). Degrees -> yaw units with `round(a · 65536 / 360)` at
  createMatch only (no float in the step). Spawn distance = system.json `round.startDistanceM` (2.4 m).
- Initial camN = the perpendicular of (P2 − P1) closest to dir(cameraSideDeg). If that camera side would put P1
  screen-RIGHT (spawnAxisDeg = cameraSideDeg − 90), the sim swaps the spawn ends so P1 is always screen-left.
- `wallHeightM`, `thicknessM`, `surface`, `dustColor`, `cameraMaxM`, `clearRadiusM` are view-only (the sim wall is
  infinitely tall, no ring-outs). The sim no longer reads `walls.x` / `fightStrip` once SIM3D lands.

### §35.12 CHANGED(FIGHTERS3D): 3D move fields as emitted in data/fighters/<id>.json (2026-09-30; additive)
Generated by `data/fighters/_gen/` (kitlib.py class defaults + per-move kit decisions, validate.py checks every rule below).
The 2.5D sim ignores the 3D fields (the item-7 wall-splat flags are ordinary §5.2 fields); SIM3D reads them. Reasons per
move are in `_spec/ROSTER.md` (3D column + "3D ring play").
1. **`track: {"until": u, "rate": r}` on EVERY move.** `until` = the last move frame (1-based, the numbering of `boxes.f` /
   `hits.f`) on which the attacker's yaw turns toward the opponent; from `until + 1` to the move's end the yaw is frozen
   (boxes, `move` travel, projectile launch direction and throw front arc all use the frozen yaw). Frame 1 counts: a move
   started from neutral is already facing (auto-face, §35.2); a move started by a cancel / chain / counter follow-up re-faces
   on its frame 1 at `rate`. `rate` = max yaw change per frame in whole degrees, 1..180 (180 = snap). Integer conversion for
   the sim = a compile-time constant (SIM3D compile.ts degToYaw, as built: 20 -> 3641, 180 -> 32768 = any turn; verified
   2026-09-30 by compiling the real data: trackUntil / trackRate / lateral / homing / linear / aimed match the JSON).
   Class defaults (the generator applies them; a move without the fields - goons, system IMPACT / SHOVE / RUSH / default
   throws - should get the same defaults in SIM):
   - normals, command normals, throws: `until = max(1, startup - 4)`, rate 180; [CHANGED(STEPTUNE) §35.15: normals and
     command normals now `startup - 6`; throws keep - 4]
   - specials, EX, command grabs, supers without `homing`: `until = max(1, startup - 6)`, rate 180;
   - `homing: true`: `until = startup + active - 1` (the move's last active frame, multi-hit moves included), rate **20**
     (catches any stepper: a §35.2 sidestep averages ~3.2 deg / frame at 1 m, ~6 at a front-loaded peak; a sidewalk ~1.7);
   - `linear: true`: `until = 1`, rate 180 (faces on frame 1, never turns again).
2. **`homing: true` / `linear: true`** (never both; absent = false). The class that produced `track` - SIM needs only `track`
   + `lateralM`; AI (§35.9) reads the flags (sidestep `linear`, answer steppers with `homing`). Homing = wide hooks and
   roundhouses, low roundhouses, sweeps, spins / flairs / lariats, command grabs (reach arcs), counter follow-ups, most
   supers. Linear = rushes, charge moves, leaps and dives (`airVel`, travelling `moveY` hops), straight non-aimed
   projectile throws, lunges.
3. **`lateralM`** (metres) on every strike (a move with damage, `hits` or `cinematic` that is not a throw / cmdgrab / grab
   and not a pure projectile throw; absent on those - grabs use the §35.4 range + front-arc rule): the half-depth of EVERY
   box of the move across the attack line (attacker-local lateral axis: each box spans forward x +- w/2, up y +- h/2,
   lateral +- lateralM). Defaults: normals by button L 0.15, M 0.18, H 0.22; specials / EX / supers 0.22 (their L/M/H is
   the button strength, not the limb); role `sweep` 0.45, `homing` 0.60; kit
   overrides carry a reason (low roundhouses 0.40; Freak ROAR = its box half-width 1.0 / 1.2 / 1.4 / 1.5 m: the box is
   already centred on the body, so the roar is a square AROUND it).
4. **Projectiles:** `projectile.aimed` (bool, on every projectile move): true = at spawn the projectile's direction is
   toward the opponent (dirToYaw of opponent - spawn point), false = along the thrower's yaw at spawn (`track` decides that
   yaw). `projectile.lateralM` = half-depth of the projectile box across its travel (default box[0] / 2, min 0.12; wider for
   fans / flames / sawblades). A hover / resting projectile (Gazza keepy-uppy) is `aimed: false`, speed 0. Gazza's shot
   rebounds reflect the direction vector off the ring (§35.4, SIM).
5. **Step-attacks:** kind `command`, `input: "SS.<btn>"` (btn L | M | H), role `stepatk`. Routed when that button is pressed
   while the fighter is in SIDESTEP (buffered from step frame 9 [CHANGED(fix_core) §35.20: 2], starting on frame 11, §35.2) or SIDEWALK; there it wins
   over the button's plain 5X / 2X / 6X routing, anywhere else it is unreachable. Same in SIMPLE and CLASSIC. The move
   starts facing the opponent (frame-1 re-face at its `track.rate`). Today's sim parses `SS.H` as button -1 (never routed),
   so the data is harmless until SIM3D routes it. patch `SS.H` BLINDSIDE KICK (mid, homing, KD + wall splat), spin `SS.H`
   FLANK FLAIR (low, homing, low-profile, KD).
6. **Roles** (informational, §20.2 list, additive): `antistep` = the fighter's fast step-catcher (homing strike or command
   grab with startup <= 12, or an aimed projectile) - every fighter has >= 1; `stepatk` = step-attack. Every fighter also has
   >= 1 "reliable homing tool" (a homing normal / command / special, startup <= 16, >= -6 on block; or an aimed projectile
   special for the zoner) - validate.py checks both.
7. **Wall game:** fighters that had no wall-splat move gained one `onHit.wallSplat: true` ender (johnny hook_h / hook_ex,
   patch 4H + SS.H, zambini 5H, krane 4H, lotus 6M, spin windmill_h / windmill_ex, gazza 5H, rerun 5H, freak claw_rush_h /
   claw_rush_ex, ricky 5H). Existing: bruno 6H + fridge_door, boneyard meat_hook + chefs_special.
8. **Requests:** SIM3D - read `track` / `lateralM` / `projectile.aimed` / `projectile.lateralM`, route `SS.<btn>`, class
   defaults for moves without the fields (item 1). AI - `homing` / `linear` / roles `antistep` / `stepatk` for the §35.9
   rules; each fighter's `cpu` block also carries `antiStep: [moveIds]` (what to throw at a stepper) and, for patch /
   spin, `stepAttack: "SS.H"` (hints, like the existing `pokes` / `punish` lists). UI - move list: render `SS.H` as
   STEP + H and may tag HOMING / LINEAR moves (FighterDef `moves[id].homing` / `.linear`).
9. **Numbers as emitted (2026-09-30):** 384 moves (382 + the 2 step-attacks); homing 98, linear 68, aimed projectile
   moves 24 (johnny 1, krane 1, lotus 4, gazza 4, ricky 5, zambini 9; per-fighter lists in ROSTER.md "From the data"). The
   2.5D sim reads none of the 3D fields and never routes `SS.H`; only the item-7 wall-splat enders also act in 2.5D (at
   the stage walls, like the existing ones).
10. [Superseded by the measured table in §35.15 CHANGED(STEPTUNE): the real sim step was never constant speed.]
   **Step geometry finding for SIM3D / owner (FIGHTERS3D model, scratch stepwin.py - not the sim):** with the §35.2 step
   (0.85 m arc in 15 f, constant speed), hurt radius 0.25 m, 1.2 m apart and the item-1 tracking, a sidestep evades a
   LINEAR move when it starts between 4 frames before the attack and its startup - 8 (johnny hook_m / patch cue_m: 9
   start frames, freak crusher_leap_m: 29), and NEVER evades a default-tracking move (5L / 5M / 6H: the 4-7 frames of
   step after tracking stops move the defender 0.23-0.40 m < lateralM + r = 0.40-0.47 m) or a homing one. So only the 68
   LINEAR moves are steppable. If the owner wants straight normals steppable on a read too, the lever is the step curve
   (front-loaded speed) or a smaller default lead (e.g. normals until = startup - 6); the kits need no change (defaults
   live in kitlib TRACK_LEAD and validate.py TRACK_LEAD, one line each).

### §35.13 CHANGED(SIM3D): the 3D ring sim as built (2026-09-30; every file carries `CHANGED(SIM3D)` notes)
Evidence: `_harness/_reports/progress_3d_SIM3D.md`, gates `probe_3d` / `probe_axis` / STEP rows of `probe_synctest`,
`probe_determinism`, `probe_perf`. On the spawn line (no STEP input) every rule below reduces EXACTLY to the 2.5D game
(push circle = the asymmetric push box along the line, hurt cylinders = the old hurt rects), so 1D readers keep working
while they convert.
1. **Fixed point (`core/sim/fx3d.ts`, §35.1):** Q14 (16384 = 1.0); yaw 0..65535 (0 = +Z, + toward +X, dir(yaw) = (sin, cos)
   in (x, z)); quarter-wave sine table SIN_Q[0..4096] built at load by a fixed-order Taylor polynomial in doubles (only
   + - * / : bit-identical on every engine; `sinTableHash()` = 0xc92b373b, pinned by probe_3d), linear between entries;
   `sinQ cosQ yawToDir dirX dirZ dirToYaw` (binary-search atan, exact round trip), `isqrt` (exact floor, n < 2^53), `rot`,
   `mulQ`, `divRound` (half away from zero), `alongYaw` (amount along a yaw with the table's own length divided out),
   `dot2 cross2 dotQ normQ rightOf yawDelta turnToward degToYaw`, `yawToRad` / `yawToDeg` (view only). Safe ranges in the
   file header (offsets <= 2^25 U, products < 2^53). No Math.sin / cos / atan2 / sqrt / hypot / random anywhere in core/sim
   (probe_3d scans the sources). All geometry is integer math on JS numbers holding integers.
2. **State (layout.ts, LAYOUT_REV 4):** fighter `z vz yaw stepDir stepIn pushYaw thrZ thrYaw`; projectile `z vz yaw`
   (travel yaw); goon `z vz yaw orbit`; world `camNX camNZ` (Q14), `ringKind ringR ringSides ringRot ringCX ringCZ spawnYaw
   camYaw`; BRAWL header `target`. `F.x / F.vx` = world x, `F.z / F.vz` = world z. **`F.facing` = the SCREEN side sign**
   (+1 = the forward points screen-right under the camera basis) - the §4.4 input mapping exactly as before; it is set
   where the yaw is set (auto-face, tracking, round start), so a fighter mid-move or in stun keeps its mapping (the old
   flip-when-free rule). STATE_INTS 556 -> 614 (world 46, fighter 140, projectile 24), STATE_INTS_BRAWL 922.
   New fighter states `SIDESTEP 32`, `SIDEWALK 33`, `STEP_END 34` (ST_NAMES 'sidestep' / 'sidewalk' / 'step_end');
   `ACT.STEP 7` (bufM 1 = IN, 0 = OUT); `BUF.STEPATK 64`.
3. **Input word:** bit 13 `STEP_IN`, bit 14 `STEP_OUT` (`core/config.ts INPUT`, `inputs.ts IN`, `WORD_BITS = 0x7fff`); both =
   neutral. The history ring stores bits 4..14; its frozen flag moved from bit 13 to bit 15 (`motion.ts H_FROZEN`).
   Requests: SHELL `input.ts WORD_MASK 0x1fff -> 0x7fff` + the §35.2 bindings (Q / E, numpad 7 / 9, right stick); UI
   `touch/controls.ts` (`& 0x1fff`) + the two STEP buttons; AI `cpu.ts` / `pad.ts` masks (`& 0x1fff`) before any CPU steps.
   NET packets already carry 16 bits.
4. **Movement (§35.2):** each fight frame fighter i gets its opponent point = the other's START-of-frame position
   (`fighter.ts OPP` / `setOpp`; brawl: the soft-lock goon). AUTO-FACE (yaw snaps to the opponent) in idle / walk / crouch /
   block pose / dash (every dash frame) / landing / sidestep / sidewalk / settle and on every move start from neutral;
   attacks follow tracking (item 6); hitstun / blockstun / knockdown / throws / recovery keep the yaw. Walks, dashes, jump
   arcs (velocity set at takeoff), RUSH and authored `move` / `moveY` travel run along the fighter's forward. STEP (system
   `step`): a tap buffers `ACT.STEP` (dash window) or a held STEP starts SIDESTEP from the free state (not while back is
   held: back = block wins; forward + STEP = the step): 15 frames along the circle around the opponent point, distance
   kept (tangent step renormalised to the start radius every frame), 0.85 m arc on an ease-out curve over 80 % of the
   frames [CHANGED(STEPTUNE) §35.15: over all 15 frames, 64 % in the first 6] [CHANGED(fix_core) §35.20: the arc is the fighter's own
   step.distM]; presses buffer from step frame 9 (earlier presses are ignored) [CHANGED(fix_core) §35.20: from frame 2, held to 11], actions (`tryAct` CTX.STEP = the free rules
   minus a new STEP) from frame 11, `canBlock` accepts a SIDESTEP from frame 12; at frame 16 a still-held STEP -> SIDEWALK
   (1.8 m/s tangential, attacks come out of it, back / down / up leave to the free state at once = back cancels into
   block, forward keeps circling), release -> STEP_END 4 frames -> free. STEP_IN circles toward -camN, STEP_OUT toward
   +camN (sense latched per step in `F.stepDir`: +1 = the offset rotated by (-z, x)). Step-attacks (FIGHTERS3D §35.12.5):
   a move with `input "SS.<L|M|H>"` is `CMove.stepAtk`, never in the normals table, `CFighter.stepAtk[btn]`; its button
   pressed in SIDESTEP (from frame 9) / SIDEWALK buffers it (wins over the plain normal) and it starts from CTX.STEP only.
5. **Camera basis (§35.3):** `camN` = the unit perpendicular of (P2 - P1) closest to the previous camN (continuity), kept
   while |P2 - P1| < `ring.camMinSepM` 0.3 m; updated after bodies / hits / throws each fight frame (`state.ts updateCamN`);
   brawl: the pair (player, soft-lock goon). Screen-right `R = (camN.z, -camN.x)`; the view camera sits on +camN.
   Round start per §35.12 (P1 always screen-left). `canBlock` "back" = the screen direction away from the attacker
   (sign of (defender - attacker) . R); heckle guards by the object's travel screen side.
6. **Moves in 3D (§35.4):** `CMove.trackUntil` (frames 1..until re-face the opponent point), `trackRate` (yaw units per
   frame, 0 = full), `homing` (until >= last active), `linear` (until 1), `lateral` (U). Data: FIGHTERS3D §35.12 (`track`
   rate in degrees 1..180, 180 = any turn); defaults when absent (goons, system moves): normals / throws / system until =
   startup - 4 [CHANGED(STEPTUNE) §35.15: - 6], specials / EX / cmd grabs / supers startup - 6 (system `track`), full rate; lateral L 0.15 / M 0.18 /
   H 0.22, specials / supers 0.22, role sweep 0.45, homing 0.60 (system `lateral`). Hit test (`boxes.ts boxCyl /
   moveBoxHits`): each box in attacker-local (forward x +- w/2, lateral +- lateral, height) vs the defender's hurt
   cylinders (`hurtCyls`: posture cylinder from data/bodies.json front / back with off = (front - back) >> 1, r = front -
   off; hurtOverride / stance = centred r = w/2; hurtExt = r w/2 centred x ahead), strict overlap. Pushback, launches and
   wall splats run along the HIT DIRECTION yaw (attacker forward / projectile travel); `F.pushLeft >= 0` along `F.pushYaw`,
   the part the ring blocks transfers to the attacker (melee). Proximity guard = 3D distance to the defender's body edge.
7. **Ring (§35.2, reading §35.11 per §35.12, `core/sim/ring.ts`):** `Match.ring` (CRing: kind, r, sides, rot, centre,
   side normals), clamp / gap / ray / wall. Bodies: push circles collide (split, a side the ring blocks hands its share
   over), then the ring, then the separation cap (system 6.0 m) on the 3D root distance. **WALL_SPLAT payload:** a = victim,
   **b = wall index (circle sector 0..15 / poly side) + 256 x the wall's INWARD normal in whole degrees (0..359, yaw
   convention)**, c / d = the contact point x / z in cm (consumers: `index = b & 255`, `normalDeg = b >> 8`; VIEW / AUDIO
   read b as 0 / 1 today and fall back gracefully). "Against the wall" = the victim's push circle within `ring.againstWallM`
   0.45 m of the boundary along the hit direction: IMPACT splat (hit or block) and the STAGE FRIGHT corner stun (was 1.5 m
   to the x walls); moves with `onHit.wallSplat` keep `wallSplat.rangeM` 0.9. NEW: a launched (JUGGLE) body reaching the
   boundary wall-splats (one splat per combo), else slides along it. No ring-outs. `system.stage.wallM` = 5.5 (legacy
   number only: AI range estimates; the sim reads the ring). `dataHash` now covers every stage's ring / spawnAxisDeg /
   cameraSideDeg (both online peers must agree).
8. **Throws:** a grab connects when the defender is inside the thrower's front arc +- `throw.frontArcDeg` 70 (root to root)
   AND within range between the push circles (`throws.ts inFrontArc`); the victim turns to face the thrower at the connect,
   its carry runs along -dir(thrower yaw) (`F.thrX / thrZ / thrYaw`), a back throw lands behind along -forward; no facing
   flip after a GRAB (the free state auto-faces). The tech pushes both apart along the line between them.
9. **Projectiles:** spawn at the thrower's position + forward x `projectile.x`, velocity along the thrower's yaw at the
   spawn frame, or at the opponent when `projectile.aimed`; hit box = forward +- w/2, lateral +- `projectile.lateralM`
   (default box[0] / 2) in the travel frame (`hits.ts projHitsCyl`): a sidestep after the release dodges a straight one.
   Despawn: life end, the ring wall, or > `projectile.screenHalfM` 4.5 m from the pair midpoint. Clash = planar circles.
   Gazza's ball: kick / hover along his yaw, `ballReady` = in front (-kickBack .. kickRange) and within kickRange / 2
   sideways, pickup = planar distance, rebound = vector reflection about the wall's inward normal x `wallRestitutionPct`
   (loose ball x 50 %). HECKLER objects: random bearing around the player (distance per `heckler.spawnDistM`), aimed at his
   position at the throw.
10. **BRAWL BREAK (§35.8):** goons spawn around the player at the emptiest of 8 bearings (clamped inside the ring), walk
   in along the line to the player, hold the approach ring and spread around him (sideways drift when two share a side),
   attack with goon-local boxes (tracking to the move's track.until), bodies are circles. Soft lock `BR.target`: when an
   attack starts (a buffered move while free / stepping) the target = the goon nearest the stick direction (LEFT / RIGHT =
   -R / +R, STEP_IN / STEP_OUT = -camN / +camN; within 60 deg the nearest, else the smallest angle), else the current
   target while it lives, else the nearest; the player faces / tracks it.
11. **Snapshots:** FighterSnap `z`, `yaw` (radians = three.js rotation.y), `step: { kind 'none'|'sidestep'|'sidewalk'|
   'settle', frame, side (-1 own left / +1 own right), dir 'in'|'out'|'' }`; MatchSnap `camN: [x, z]` (unit floats),
   `ring: { shape, radius, sides, rot (radians), centre }`, `proj[].z / vz / yaw`; GoonSnap `z`, `yaw`; BrawlSnap `target`.
   The new fields are OPTIONAL in core/types.ts only so hand-built snapshots in labs / probes still type-check; the sim
   always fills them. `match.ts readBoxes(m, i)` (the §27.1 request) = world-metre hurt cylinders, active hit boxes
   (centre, yaw, len, lat, heights) and the push circle for the training overlay; `boxes.ts hurtRects / hitRect / pushExt`
   stay as LEGACY 1D projections by F.facing.
12. **Anim table (§35.5):** the step clips are NOT added to SHARED_CLIPS (that would renumber every `34 + k` move id,
   §17 rule 2 - also the answer to the §35.14.1 note): `core/data.ts STEP_CLIPS = [sidestep_l, sidestep_r, sidewalk_l,
   sidewalk_r]` are APPENDED to each fighter's table after the stance entries (`animStepId(def, k)`, `CFighter.animStep`,
   sidewalk_* loop). SIDESTEP shows sidestep_l / _r, SIDEWALK sidewalk_l / _r by the side of the fighter's own body it
   moves toward (it faces the opponent, so stepDir +1 = its left); STEP_END shows idle. Goon tables unchanged.
13. **Gates:** `probe_3d.ts` (76 checks, the §35.10 list + fx3d unit tests + step-attacks), `probe_axis.ts` (the 10 system
   probes re-run on 33 / 200 deg fight lines through `simkit.ts` HP_PROBE_AXIS + its LINE frame: place / fs / lxU / plx),
   `probe_synctest` +STEP (144 pairs + 24 bonus runs over the 5 real stages and 3 synthetic rings: octagon, hexagon, rotated
   circle), `probe_determinism` +STEP (144 pairs + 12 unique + 24 bonus runs, twin + save / load re-step every frame),
   `probe_perf` +STEP row. All SIM probes work in the line frame now.
14. **Requests / notes to other lanes:** AI - `sense.ts` reads F.x / F.facing / m.sys.wall as 1D (still valid on the line);
   add F.z / F.yaw / F.stepDir / the ST 32-34 states, `m.ring` (compiled) for walls, and the `probe_season` S3 scripted
   bonus player (x-only distance to goons: goons now come from all bearings; 1-3 fighters score 0) and S4 (phase-2 moves
   2/4 bouts: RICKY's L6 bouts vs the L8 hero end faster on the 5.5 m ring) need your 3D pass. UI - `probe_training` RESET
   CORNER / CORNERED expect x > 6.5 m / < -6.5 m (the old 8 m walls; the driver itself reaches the ring wall at ~5.2-5.4 m),
   `readBoxes` for the overlay, the move list's `SS.H`. VIEW - FighterSnap z / yaw, camN, ring, proj z / yaw, WALL_SPLAT b
   decoding, the appended step anim entries (resolve by clip name through GameData.anims as today). AUDIO - WALL_SPLAT b is
   no longer 0 / 1 (index = b & 255).

### §35.14 CHANGED(ASSETS3D): the §35.5 locomotion clips as baked (2026-09-30; additive, nothing breaks)
1. **Four new shared clips on every body (12 fighters + 3 goons):** `sidestep_l`, `sidestep_r`, `sidewalk_l`, `sidewalk_r`
   (`tools/clipplan/_shared.json`; ids appended AFTER the 34 §6.2 shared ids in the plan - `core/data.ts SHARED_CLIPS` is
   SIM's list: append them at the end so anim ids 0..33 stay). `_l` = the fighter's OWN left, `_r` = own right (the sim
   picks by the step direction relative to the fighter's yaw, §35.5). Guard upper body = the CMU 13_17 boxing guard of
   `idle` / walks; lower body = Mixamo Pro_Magic "Standing Walk Left" (a crossover side-walk), `_r` = the same source
   MIRRORED (why that source: least waist twist - measured below).
2. **`sidestep_*`**: 8 frames, `dur` 0.2333 s = a 15-frame sim step shown at anim frames 0..14 (60 fps) ends exactly on the
   clip's last frame. A step-close: lead foot out (frames 0-3), lands, trail foot closes beside it (ends balanced, feet
   together, guard up). Not a loop. Lateral travel = 0.90 m x the body's hip ratio (johnny 0.824 m; the sim moves 0.85 m;
   per body in `rootLat`). Its last frame is the upper-body guard frame `idle` and `sidewalk_*` start on, and its lower-body
   phase is `sidewalk_*` frame 0 (the walk cycle continues seamlessly into hold-to-walk).
3. **`sidewalk_*`**: loops (`loop: true`), baked PER BODY so the stripped lateral travel runs at the §35.2 1.8 m/s (the
   playback rate is chosen per body: `rootSpeed` in the plan, record in art/renders/<id>/_build/bake.json `rate`; the
   achieved speed is within half a frame per cycle, johnny 1.780 m/s / 25 frames / 0.80 s). The view samples loops at
   natural rate (animF / 60), so at 1.8 m/s the planted feet do not slide (johnny: planted ball-of-foot drift <= 1.3 cm
   lateral per plant).
4. **clips.json `rootLat`** (new, optional, only on these 4 clips): `[[t, dx_right_m], ...]` one row per baked frame = the
   LATERAL hips travel since frame 0 that was stripped from the GLB (+ = toward the fighter's own right, so `_l` runs
   negative). Same layout as `root` (which stays forward-only, 2-element rows - `core/data.ts isVec2` would drop 3-element
   rows, hence a separate field). SIM may use the sidestep's `rootLat` shape as the arc's progress curve (normalised to
   0.85 m), VIEW may read `|rootLat end| / dur` as the loop's authored speed.
5. Measured numbers per body: see §35.14 item 6 (added after the rebake).

### §35.15 CHANGED(STEPTUNE): sidestep curve + default tracking lead, with the measured STEPPABLE TABLE (2026-09-30; numbers only, no interface change)
Designer decision (orchestrator, after §35.12 item 10): a READ sidestep (started a few frames before the attack's active
frames) evades straight normals, linear moves and straight projectiles, NEVER a homing move; a late (reaction) step is
still hit. Evidence: `_harness/_reports/progress_3d_STEPTUNE.md`, `probe_3d` section 3b (prints the table below).
1. **Step curve** (data/system.json `step.movePct` 80 -> 100; compile.ts default 100): the existing quadratic ease-out
   now runs over ALL 15 frames. Cumulative arc at step frames 1..15 = 0.110 0.212 0.306 0.393 0.472 0.544 0.608 0.665
   0.714 0.756 0.790 0.816 0.835 0.846 0.850 m: **64.0 % of the 0.85 m in the first 6 frames**, moving every frame, never
   speeding up. Unchanged: 15 frames, buffer from 9, step-attacks from 11, block from 12, sidewalk 1.8 m/s, settle 4.
   NOTE (measured, not modelled): the as-built SIM3D step was NOT constant speed (§35.12 item 10's FIGHTERS3D model) but
   movePct 80 = 75 % in 6 frames and still from frame 13. The decision's 60-65 % is applied as written; item 4 has the
   measured alternative.
2. **Default tracking lead:** normals + command normals `track.until = max(1, startup - 6)` (was - 4; §35.12 item 1),
   kitlib.py / validate.py `TRACK_LEAD = {normal: 6, command: 6, throw: 4}`, build.py rebuilt (77 `track.until` values in
   the 12 fighter JSONs changed, nothing else; validate.py PASS). Specials / EX / supers stay - 6, homing (last active
   frame, 20 deg/f) and linear (frame 1) unchanged. Sim default for moves WITHOUT `track` (goons, system IMPACT / SHOVE,
   default throws): system.json `track.normalUntilOffset` 4 -> 6 (IMPACT until 22 -> 20, SHOVE 16 -> 14, goon moves - 2;
   every throw starts on frame 5, so throws stay until 1 either way).
3. **STEPPABLE TABLE** (real sim + real kits, `probe_3d` 3b). The attacker's move is started by a clean buffer poke on
   frame 0 (= its move frame 1); the defender (johnny, idle, no guard) taps STEP_IN on frame `off` (negative = before the
   attack starts = a read); evaded = no HIT / BLOCK / PROJ_HIT / THROW from the attacker for the whole move. Cell = the
   step-start frames that evade (count; frames from the step start to the attack's first active frame). STEP_OUT gives
   identical windows (checked for 5M / 5H / linear special).

   | class | 1.2 m apart | 2.0 m apart |
   |---|---|---|
   | 5L straight | krane 5L s5 (until 1): -1..0 (2 f; 5..4 before active) | out of reach (no 5L reaches) |
   | 5M straight | krane 5M s8 (until 2): -1..2 (4 f; 8..5 before) | out of reach |
   | 5H straight | zambini 5H s12 (until 6): 4..6 (3 f; 7..5 before) | freak 5H s15 (until 9): 6..9 (4 f; 8..5 before) |
   | 6H overhead | krane 6H s18 (until 12): 9..12 (4 f; 8..5 before) | out of reach |
   | homing 5H | krane 5H s12 (until 14, 20 deg/f): never | bruno lariat_h s10 (until 21; no homing 5H reaches): never |
   | sweep (homing) | johnny 3H s10 (until 12): never | ricky 3H s14 (until 16): never |
   | sweep (linear) | gazza 2H s12 (until 1): -4..5 (10 f; 15..6 before) | gazza 2H: never (it reaches; measured) |
   | linear special | johnny hook_m s12 (until 1): -10..7 (18 f; 21..4 before) | -4..7 (12 f; 15..4 before) |
   | projectile straight | johnny brickbat_m s14: -3..10 (14 f; 16..3 before) | -4..15 (20 f; 17..-2: also after the release) |
   | projectile aimed | zambini card_fan_m s14 (until 8): never | 11..15 (5 f; 2..-2: only around the release) |
   | IMPACT (system) | johnny IMPACT s26 (until 20): 19 (1 f; 6 before) | 18..20 (3 f; 7..5 before) |

   Read it as: against a straight normal the step has to START 4-8 frames before the first active frame (for a 5-frame
   5L: as the attacker presses, or 1 frame before); a step started 3 or fewer frames before a normal's active frames is
   hit. Linear moves and straight projectiles are steppable over long windows (a slow linear move even on reaction).
   Homing moves are never stepped; aimed projectiles only at range and only around the release.
   **Roster sweep at 1.2 m** (every ground strike / projectile of the 12 kits that reaches): default-tracking normals
   52/53 steppable (median window 4 f; latest evading start 3 f before active; never: johnny 5L s4), default-tracking
   specials 18/22 (median 3 f; never: johnny encore_l s5 / encore_m s6 / encore_ex s6, krane baton_flip_ex s5), linear
   47/48 (median 20 f; never: krane baton_flip_l s5), straight projectiles 10/10 (median 12 f), **homing 0/67**, aimed
   projectiles 0/20. The only non-homing moves a read cannot step are the 4-6 frame jab / reversals / anti-airs.
4. **Before / alternative (same harness, 1.2 m):** as built (movePct 80, normal lead 4): krane 5L -2..1 (4 f), krane 5M
   2..3 (2 f), zambini 5H 7 (1 f), krane 6H 12..13 (2 f), homing never, hook_m -8..7 (16 f); roster normals 53/53 but
   median window 2 f. Lead 6 with the as-built 75 % curve (movePct 80): 5L -2..1 (4 f), 5M -1..3 (5 f), 5H 3..7 (5 f),
   6H 9..13 (5 f), latest evading start 3-4 f before active; roster 53/53 normals / 22/22 specials / 48/48 linear / homing
   0/67 - bigger windows incl. the 4-6 f moves; one number (`step.movePct: 80`) if the designer prefers it. The curve
   alone (movePct 100, lead 4) steps nothing slower than a jab (5M / 5H / 6H never): the lead is the main lever.
5. **Notes to lanes:** AI (§35.9) - step reads per the table (start 4-8 f before a default normal's first active frame;
   vs linear / straight projectiles anywhere in their window; never vs homing or close aimed projectiles); the EX rushes
   (johnny hook_ex, krane shield_rush_ex, freak claw_rush_ex, bruno fridge_door_ex, ricky the_hook_ex) are default-tracking
   but measured steppable like linear moves (windows 11-18 f, latest start 2-3 f before active: their travel carries them
   past a stepper). VIEW / ASSETS - the baked `sidestep_*` lateral root curve (§35.14.4 `rootLat`: 42 % at frame 6, an
   S-curve) no longer matches the sim's arc (64 % at frame 6; it did not match the as-built 75 % either): sample the clip
   by the sim's progress (`stepCurve[k] / stepCurve[15]`) or rebake, else the feet may slide in the first step frames.
   FIGHTERS - the ROSTER.md 3D paragraph (build.py text) now quotes these measurements instead of the constant-speed model.
6. **Gates:** `probe_3d` 76 -> 96 checks: curve (15 f, 0.850 m, 60-65 % in 6 f, ease-out every frame), default normal /
   throw lead, the table rows (straight normals: a read evades and a step < 3 f before active is hit; homing never at both
   distances; linear special + straight projectile steppable at both; aimed never at 1.2 m; STEP_OUT = STEP_IN), the roster
   (homing 0 of >= 40; aimed 0; every non-homing move with startup >= 7 steppable; default normals never evaded by a step
   < 3 f before active). synctest / determinism 0 mismatches and probe_perf within budget after the change (progress log).
   + the homing krane 5H is never evaded by any of the 12 defender bodies (item 7 rows are printed, report-only).
7. **The DEFENDER's body decides as much as the tuning (main caveat, measured; report-only rows in `probe_3d` 3b):** the
   table above is for johnny (hurt cylinder r 0.24 m = (front + back) / 2 of the measured body, front 0.36 m). Same
   harness, krane 5L / krane 5M / zambini 5H at 1.2 m: patch (r 0.22) 5 / 6 / 4 f, gazza (0.24) and johnny 2 / 4 / 3 f,
   lotus (0.26) 4 / 4 / 3 f; ricky (0.31) and zambini (0.32) 5M 1 f only; **boneyard (0.43), bruno (0.38), freak (0.47),
   krane (0.48), rerun (0.47), spin (0.39) never step a straight normal** - also at an EQUAL body gap (the defender's hurt
   front 0.84 m from the attacker root, e.g. bruno 1.44 m, rerun 1.64 m apart), because the circling step pivots on the
   attacker: a long body's front, which faces the attacker, stays near the pivot and barely moves sideways, and its wide
   cylinder needs more clearance. Every defender still steps linear moves (johnny hook_m at 1.2 m: 8-18 f) and none ever
   steps a homing move. Levers measured in scratch (not applied - designer's call): a hurt CAPSULE of half-width 0.22-0.26 m
   instead of the circle changes almost nothing for them (at 1.2 m: big bodies 5M 1-2 f at best); tracking lead 8 changes nothing for
   them; a longer step does it - at equal gaps with the decided curve, step distM 1.1 m gives boneyard / bruno / krane /
   spin 5L 2 f / 5M 1-3 f / 5H 1-2 f, distM 1.3 m gives them 4-5 / 4-6 / 3-5 f (johnny-like at 0.85 m) and freak / rerun
   2 / 1-3 / 1 f. So "a read step evades straight normals" holds for 4 small bodies (6 with ricky / zambini barely) unless
   the step distance scales with the body (a per-fighter step length = a sim + data interface change) or big bodies are
   meant to step badly (the Tekken heavyweight trait).

### §35.16 CHANGED(UI3D): STEP controls in the real game - input word, bindings, touch, menus, training (2026-09-30; additive)
Evidence: `_harness/_reports/progress_3d_UI3D.md`. Every file carries `CHANGED(UI3D)` notes. Nothing here changes the sim.
1. **Input word (SHELL `input.ts`, written by UI3D per the brief):** `BIT.STEP_IN = 1 << 13`, `BIT.STEP_OUT = 1 << 14`,
   `WORD_MASK 0x1fff -> 0x7fff` (`socd`, `force` = `__HP__.dev.setInputs` carry bits 13 / 14); SOCD: STEP_IN + STEP_OUT held =
   neutral (cleaned in the input layer like L+R; a latched STEP whose opposite is held is dropped). `touch/controls.ts
   readWord()` masks 0x7fff; `ui/trainer.ts` keeps the bits in TRAINING (P1, RECORD / PLAYBACK - STEP is camera-relative, so
   playback replays it as recorded; only LEFT / RIGHT are re-mapped by facing). The CPU side is lane AI3D's: at the end of this
   session `core/ai/pad.ts` carries `WORD_MASK = 0x7fff` (CHANGED(AI3D)), so the training driver's DUMMY: CPU words keep STEP too.
2. **Actions + defaults (`input.ts`, `ui/settings.ts`, `ui/menus.ts defaultControls`):** action ids `stepIn` / `stepOut`
   (Action / SimAction unions, `ACTION_BIT`); keys P1 `KeyQ` / `KeyE`, P2 `Numpad7` / `Numpad9`; gamepad = the RIGHT STICK as
   virtual pad slots `PAD.RS_UP 17 / RS_DOWN 18 / RS_LEFT 19 / RS_RIGHT 20` (`PAD_SLOTS 21`; `PAD_BUTTONS` stays 17 = real
   buttons): axes 2 / 3 through the left stick's 8-way sectors and 0.3 radial dead zone (`stickBits`), so the up family =
   STEP_IN, the down family = STEP_OUT, pure left / right = nothing; default pad `stepIn [17]`, `stepOut [18]`; any slot or
   button can be bound (the menus' pad capture sees right-stick pushes as slots 17..20; labels `RS-UP` ...). `input.ts ACTIONS`
   lists the 3D actions LAST, and `sanitizeKeys` / `sanitizePad` let every SAVED binding win: an action a save does not name
   (stepIn / stepOut in a pre-3D save) takes its default key / slot only where no saved binding holds it. UI order
   (`ui/types.ts ACTIONS`): up down left right stepIn stepOut l m h s assist throw parry impact taunt pause.
3. **Touch (CONTRACT_MOBILE M2 CHANGED(UI3D)):** buttons `stepin` (IN, bit 13) / `stepout` (OUT, bit 14), 56 px, centres
   58 / 130 px in from the LEFT safe edge (the stick's side; the right edge when left-handed), 196 px up from the bottom safe
   edge = 14 px over the stick base's top; tap = sidestep, hold = circle-walk (the sim decides by hold time); in EDIT LAYOUT
   (`TouchLayout` keys `stepin` / `stepout`); `readback().buttons` lists them. Touch HUD (styles.css): P1's combo / callouts
   and the training input display start 176 px in (right of the pair); left-handed mirrors (P2's side moves in).
4. **Menus:** SETTINGS remap rows STEP IN / STEP OUT (2 key slots + 1 pad slot); the pause CONTROLS legend has a STEP row
   (keys, or the IN / OUT discs in touch mode); `ScreenId 'howto'` = HOW TO PLAY (opened by `#hpm-main-howto` on the main
   menu's guide card): MOVE / THE RING (sidestep, circle walk, step attack, HOMING, LINEAR, the wall) / ATTACK / DEFEND with
   the player's own keys (+ pad labels once a pad was seen; touch discs in touch mode). MOVE LIST: `SS.<btn>` renders as
   STEP + <btn> in a STEP ATTACKS section, every row carries a HOMING / LINEAR tag from `moves[id].homing / .linear`
   (`UiMoveDef` gained `homing? linear? track? projectile.aimed?`), HOMING NORMALS lists the fighter's homing normals,
   SYSTEM gains SIDESTEP / CIRCLE WALK / STEP ATTACK. Strings: `act.stepIn/Out`, `touch.stepin/out`, `hint.step`, `how.*`,
   `ml.step* / ml.tag.* / ml.tip.* / ml.sys.sidestep|circle|stepatk`, `tr.dummy.sidesteps|circles`, `tr.sidesteps|circles.hint`.
5. **Training (`ui/trainopts.ts DummyAction` + `'sidesteps' | 'circles'`, `ui/trainer.ts`):** SIDESTEPS = a STEP tap (2 ticks)
   after every 45 free ticks, IN / OUT in turn; CIRCLES = STEP held 180 ticks (sidewalk round P1), 24 ticks rest, then the
   other way; GUARD modes apply on top (back cancels circling into block - the sim's rule). RESET CORNER / CORNERED walk along
   the spawn axis until the walker is stuck on the RING wall (planar distances). The HITBOX overlay reads `match.ts readBoxes`
   (SIM3D's §27.1 answer) and projects the 3D volumes (hurt cylinders / push circle as rims, hit + projectile boxes as their
   8 oriented corners) through `frame(project(x, y, z))`; `trainer.ts readBoxes(m)` now returns `{kind, pts: [x, y, z][]}`.
6. **Gates:** `probe_training` 21 -> 28 checks (RESET corners against the ring wall on the spawn axis for a circle and an
   octagon ring, SIDESTEPS / CIRCLES, P1 STEP through the driver, 3D boxes); `menus.py` (STEP rows + remap, right-stick pad
   capture, HOW TO PLAY; `--game`: a real Q hold circle-walks P1), `layoutcheck.py` (+ `howto`, `movelist_patch`),
   `mobile.py` (STEP taps / hold / stick + STEP / edit layout; `--game`: a held IN circle-walks P1, an OUT tap sidesteps).
7. **Real-game evidence (2026-09-30, `_reports/ui3d_real.json`, shots `_shots/ui3d_*.png`):** with STEP reachable, P1 circles
   P2 at a kept 2.40 m from all three devices (keyboard Q hold 3.4 s: sweep -174.9 deg, camN (-0.225, 0.974) -> (0.137,
   -0.991); pad right stick up: -167.1 deg; touch IN hold: -67.5 deg) and the fight camera orbits with camN in the current
   tree (the three Q-hold shots show the marquee, then the stands + gate, then the far stands behind an unchanged
   left/right pair). An earlier server build in this session (before the VIEW lane's camera landed) showed a fixed camera.

### §35.17 CHANGED(VIEW3D): the 3D ring presentation as built (2026-09-30; additive - no §16 / §17 / §18 signature broken)
Evidence: `_harness/_reports/progress_3d_VIEW3D.md`, `lookshots_v3d_*.json`, shots `_shots/v3d_*`. Files carry `CHANGED(VIEW3D)`.
1. **Reads (SIM3D §35.13 item 11):** FighterSnap `z`, `yaw`, `step`; MatchSnap `camN`, `ring`, `proj[].z / vz / yaw`; GoonSnap
   `z`, `yaw`; WALL_SPLAT `b & 255` (wall), `b >> 8` (INWARD normal deg), `c / d` (contact cm). All optional in
   `view/types.ts`: a snapshot without them renders exactly the 1D view (z 0, yaw +-90 deg from facing, camera on +Z).
   From stages.json the view additionally reads `ring.{wallHeightM, thicknessM, surface, dustColor}`, `cameraMaxM` and
   `camera.clearRadiusM` (preferred when present). New module `view/ring3d.ts` (float, presentation-only ring maths + the
   `LineFrame`: origin, R = screen-right, N = toward the camera, R = (N.z, -N.x) as §35.13 item 5).
2. **Camera (`view/camera.ts`, §35.7):** target = the eased planar pair midpoint at y 1.0; position = mid + N x dist + up
   1.35 m; N = the sim's camN eased in azimuth (0.12 / 60 Hz frame, ~5 deg lag at sidewalk speed); vFOV 35; dist 4.4-9.5 by
   the planar separation (aspect-aware, unchanged formula); HUD-clear jump pan, trauma shake, KO orbit + match-point hero
   hold, super punch-in and perfect-parry zoom authored in the camera's LOCAL frame (x along R from the midpoint, z along N)
   and converted, so they hold at any fight-line angle. **Occlusion:** (a) set geometry = the camera's planar radius <=
   clearRadiusM - 0.2 (pull in along the view line, vFOV widened by the same ratio, cap 62); (b) the ring wall = outside the
   inner face the camera stays >= 1.3 m and rises until every sight line to the fighters' feet clears the wall top + 0.08
   (<= 2.95 m, the §35.11.5 band), else pulls in; (c) **wall swing** (versus rig): when (b) would need > 0.35 m of raise or
   the lens would sit within 0.9 m of the wall line, the azimuth swings up to +-40 deg off camN (smallest swing that clears;
   eased 0.06, sign-sticky). Inputs stay the sim's camN basis (UI / SIM unchanged); a <= 40 deg swing keeps LEFT / RIGHT
   reading left / right. `CinePose.free` = a fixed lab / harness pose (no correction). Read-back `info().camera` + `{yawDeg,
   yawTDeg, swingDeg, pos, look, raise, pull, clearPull, occluded, camR, brawlOffDeg}`. **BRAWL:** behind / above the
   player - camera 2.7 m looking down at 0.95 m, vFOV 45, azimuth turned 20 deg toward the player's back (38 / 2 / 56 / -16
   deg instead when a goon would stand in the sight line to the player; sticky), distance fit to the player + the goons
   within 4.5 m projected into the frame.
3. **Fighters (`fighters.ts`):** root at the snapshot (x, y, z), rotation.y = `yaw`; facing -1 still MIRRORS the model (§17.1)
   - and a mirrored body plays the §35.5 step clips swapped (`sidestep_l` <-> `_r`, `sidewalk_l` <-> `_r`, a mirrored copy of
   the anim table) so its visible legs step the way the root moves; the side-swap depth offset (fixer D3) runs along camN.
4. **FX (`fx.ts`):** every particle velocity / authored offset is in the FX BASIS (x = hit axis, y up, z = toward the
   camera) rotated to world at spawn; BoutView sets it per frame to the camera's R and per strike to the real hit direction
   (signed toward screen-right). Strike sparks sit at the victim's body 0.18 m back along the hit direction and 0.12 m
   toward the camera. **Wall splat:** `wallSplat(px, pz, nx, nz, y, solidTop, dust)` - the decal on the wall's inner face at
   the sim's contact point facing along its inward normal, clamped inside the paintable height (`ring3d.ringSolidTop`:
   brick / tile / panel = wallHeightM, steel_rail = 0.42 m kick panels, cable_railing = 0 -> a floor splat at the wall's
   foot), plus a floor splat, dust in `ring.dustColor` and the spray back into the ring along the normal. API change inside
   the view only: `confettiRain(at: Vector3, ...)`, `sparkShower(at: Vector3, ...)`, `FxSystem.setBasis / offset / spotZ`.
5. **Projectiles / goons:** projectiles at their world (x, y, z), oriented by the travel direction (velocity, else the
   snapshot yaw); each body's authored 1D pose is turned onto X = d x travel (d = the travel's screen side, so the face stays
   to the camera) and its launch / trail / impact FX use that basis. Goons at (x, y, z) + yaw (no depth stagger in 3D).
6. **PRIME TIME (`bout.ts` + `prime.ts`):** prime.ts stays 1D and runs in LINE SPACE; BoutView freezes a `LineFrame` at the
   cinematic start: origin = the attacker's root, R = facing x (attacker -> victim), facing chosen so N is on the sim
   camera's side - unless that side is cramped (< 3.2 m from the pair midpoint to the ring along N and the other side has
   >= 0.8 m more): then it films from the roomier side. Poses, victim path (carried victims follow the carrier's chest in x
   AND z), v1 / v2 cameras, props (the props group carries the frame), FX beats and the spotlight map through it; roots are
   ring-clamped (0.3 m); the room ahead for `endGapM` / the v1 fling = the ring ray along the attacker's forward - 0.45
   (`PrimeBegin.wallDist`, optional). The framing guard works in world 3D. Read-back `info().cineFrame {ox, oz, rDeg, facing,
   flip}`. On the spawn line the result equals the 1D director exactly (framing-guard numbers identical to the P2 run).
7. **AUDIO (`audio/router.ts`, minimal):** fighter / goon pans = the offset along the camera's screen-right (camN) from the
   listener (WALL_SPLAT included); payload-only positions keep the world-x pan. WALL_SPLAT never read `b`, so the new
   encoding breaks nothing there.
8. **Harness:** `lookshots.py --game --only g3d [--g3d circle,dodge,splat,prime,arenas,brawl]` (the REAL game; STEP via
   `__HP__.dev.setInputs` when input.ts carries bits 13 / 14 - it does since UI3D - else a dev-page Input.sampleAll patch,
   reported as `stepDrive`), `lookshots.py --sim --circle N` (prime / proj on a diagonal), `perfcheck.py --circle N`,
   lab `__LAB__.prime / special / idle({circle, stepOut})`.
9. **Evidence (2026-09-30):** REAL game (`lookshots_v3d_g1..g6.json`): circling - 7 camera yaws 0 / 298 / 245 / 193 / 140 /
   86 / 31 deg tracking camN within ~4 deg; sidestep vs johnny's linear BRICKBAT - PROJ_HIT 0, hp unchanged, closest pass
   0.83 m; WALL_SPLAT b 76805 -> wall 5 / normal 300 deg / contact (4.75, -2.76) m, decal on the brick wall (swing -30 deg,
   raise 0); PRIME TIME on a 37.5 deg line framed as authored; 5 arenas with P2 circling (mirrored sidewalk clip swap
   checked); BRAWL goons from several bearings. Lab (real sim, `lookshots_v3d_p12.json`): all 12 PRIME TIMEs + ricky phase 2
   on a 38.2 deg line - framing-guard numbers identical to the 1D P2 run, hand-back <= 0.060 m; a cramped case (pair at the
   +x wall, camN out of the ring, `lookshots_v3d_cramped.json`) flips the cinematic to the roomy side (flip true, every shot
   inside the ring, no correction needed). **Known limit:** in that cramped case the RIG (inputs bound to camN, so it cannot
   flip) can only swing 40 deg and then rises to 2.95 m + pulls in: a steep but whole shot (occluded 0).
10. **G9 (perfcheck, the super on a 38.2 deg line, control_room = the busiest set by draws: 51):** clean run p50 20.2 /
   p99 80.3 ms (avg 32.4 fps, scale 0.6, Intel UHD iGPU); A/B: super p99 100.3 / 39.8 ms (two windows) vs idle p99 20.8 ms,
   GPU timer p99 29.4 ms, CPU p99 8 ms - the p99 <= 33 ms gate is NOT met; the spikes are not post-warm-up program links.

### §35.18 CHANGED(AI3D): the CPU in the 3D ring (2026-09-30; §11 / §16 / §23 / §33 signatures unchanged, AI-internal except where marked)
Evidence: `_harness/_reports/progress_3d_AI3D.md`. Every file carries `CHANGED(AI3D)` notes. `createCpu(level, fighterId, seed)` /
`Cpu.input / prepare` unchanged; the CPU still reads the state only through `core/ai/sense.ts` and never writes it.
1. **Input word:** `core/ai/pad.ts` `B.STEP_IN 8192 / B.STEP_OUT 16384`, `WORD_MASK 0x1fff -> 0x7fff`, `cpu.ts` masks with it: the
   §35.16 item 1 "still masked to 0x1fff" note is resolved - every CPU level and persona can step. A tap = the STEP bit for one
   frame (the sim plays the 15 f arc), a circle-walk = the bit held; a press out of SIDEWALK keeps the bit held on that frame.
2. **Perception = the fight line (`sense.ts`):** both fighters and every projectile are projected onto the line through the two
   roots; `x` = position along it (screen-right positive: sigma = sign((P2 - P1) . R), R from camN), `wall` = half of THAT line's
   ring chord (ring.ts ringRay both ways), `dist` = the planar distance. The whole 1D brain (reach, pushback, "cornered", block
   side via awayBits) therefore stays exact anywhere in the ring; on the spawn line the projected values ARE the world x values
   (rust_theater chord 11 m = the old 5.5 m wall). Added: world `wx / wz / yaw`, `stepDir`, `aimFwd / aimLat` (the other fighter in
   this fighter's own frame), `backU / opBackU` (root -> the wall behind along the line), projectile `lat / latHalf / miss` (its
   straight path passes clear of my body: ignored by guard / eta logic). `HIDDEN_FIELDS` unchanged (z / yaw / stepDir are visible).
3. **Honest steps (`core/ai/ring3d.ts StepOracle`):** the answer to "does a sidestep started NOW evade this?" is PLAYED in a private
   sandbox Match from the visible situation (the kit.ts pattern): the opponent's input-derived fields are ZEROED there and it feeds
   no input (its started move runs as authored); the step is chosen only if standing still would be touched AND the step is not.
   Asked only once the reaction window is open (`brain.ready`, the §23.3 clock) and only for non-homing strikes / projectiles
   (`RESP.STEP`, share `step` of the block chance, the SAME latched roll; tools / uniques answer first). Measured (`probe_personas`
   H6, pure-reaction stepper patch, 48 linear strikes / straight projectiles + 21 homing per clock): the STEP bit never comes before
   the stepper has SEEN move frame reactF (0 early), every step it chose evaded, 0 homing moves stepped; on an 18 f reaction 14
   attacks are stepped (boneyard CLEAVER DROP, freak CRUSHER LEAP, straight projectiles at 3 m...), on 24 f 8 - i.e. on reaction only
   slow linear moves and projectiles at range, exactly the §35.15 table's long windows. Straight normals are stepped only by READ.
4. **Read steps / circle-walks / anti-step (`plans.ts ringPlan`, `brain.ts stepTick`):** a read sidestep inside the opponent's range
   (`stepGuess` x (0.4 + 3 x habit x its LINEAR habit) x (1 - its HOMING habit), `habits.ts linearRate / homingRate`, committed after
   reactF); patch / spin ride their step-attack (fighter `cpu.stepAttack` "SS.H" -> kit ctx 'step' recipe, fired from step frame 9 when
   it reaches). The whiff of a stepped move is punished from the side: `punishTick` also runs in SIDESTEP (from the sim's buffer frame
   9, window minus the wait to frame 11) and SIDEWALK, step-attacks are route candidates there. Circle-walk off my wall (`backU` <
   1.3 m, not into a running attack, x (1 - its attack rate) inside its range; the sense / length from `planCircle`, which replays the
   sim's arcMove + ring clamp) and the opponent onto ITS wall from mid range (x 0.3). A stepping opponent: a visible SIDEWALK on the
   reaction clock (one latched roll < `antiStep`) and a step HABIT (`habits.stepRate`) are answered with a homing / fighter
   `cpu.antiStep` move that reaches (`brain.antiStepPick`; aimed projectiles count). Reactions keep running while circling (back =
   the sim's circle -> block cancel).
5. **data/cpu.json:** level levers `step / stepGuess / circle / antiStep` (L0 0 / 0 / 0 / 0, L1 0 / 0 / 0.05 / 0.05, L2 0.1 / 0.02 /
   0.1 / 0.1, L3 0.2 / 0.05 / 0.2 / 0.2, L4 0.3 / 0.08 / 0.3 / 0.3, L5 0.4 / 0.1 / 0.35 / 0.4, L6 0.5 / 0.12 / 0.4 / 0.5, L7 0.6 / 0.15 /
   0.45 / 0.6, L8 0.7 / 0.18 / 0.5 / 0.7; absent = 0 = no roll, no sandbox run) [CHANGED(fix_balance) §35.21: re-scaled + the `walk`
   lever + style ringWalk / ringStep], personas novice / optimal gain them, new personas
   `stepper` / `circler` (`personas.ts`, harness only), `_src.ring3d`. data/ladder.json unchanged [CHANGED(fix_balance) §35.21: THE
   FREAK L5, NORMAL slot 1 L1].
6. **Plans that had to follow the ring:** Ricky's phase-2 PYRO comes from his `cpu.rangeM` low end (1.4 m) as well as beyond 1.9 m
   (boss.ts: in the 5.5 m ring the fight stays at 1.4-2 m - measured phase-2 moves in 2/4 boss bouts before); a command-grab SUPER
   (Bruno COLD STORAGE) joins the up-close grab option when the meter policy spends it; Gazza's ball readiness adds the sim's
   sideways rule. Every per-fighter plan and unique keeps working (`probe_personas` U1 "all used").
7. **Gates:** `probe_personas` H6 (always gating) + G3 acceptance A5 homing tools beat the stepper (homing spam vs stepper >= 75 %
   and >= 20 points over the steps-off 'blocker' control, CPU L6 vs stepper >= 70 % with anti-step answers and homing hits on a
   stepping defender), A6 linear spam loses to a stepping defender (stepper >= 70 %, linear evades + side punishes > 0, >= 20 points
   over the blocker), A7 the CPU circle-walks off its wall (L6, 12 fighters x circle + octagon x 2: >= 80 %); H4 / H5 run with the
   ring levers off; U1 samples supers until seen (<= 8 extra full-meter bouts). `probe_season` S3 scripted bonus player walks FORWARD to
   its soft-lock goon by PLANAR distance (all 24 rounds score), S4 boss bouts first to 3 rounds, S5 runaway guard 80 -> 400 slots.
   `playtest.py` (G6) real keys: verbs `sidestep` (tap Q / E) and `circle` (hold E, shots `pt_circle_a/b/c` from three orbit angles),
   a sidestep tap every ~4 s in the bout, distances planar, forward / back from P1's facing.
8. **Notes to other lanes / the designer (measured, not changed here):** THE FREAK L6 is close to a wall for the 'optimal' stand-in in
   the ring (butcher_block, 30-40 seeds: as boneyard 0-1 / 30-40, as johnny / gazza 1-3 / 30, with or without the ring levers on
   either side; `_harness/scratch/ai3d_freak.ts`) - a balance question for FIGHTERS / the designer (§33.9 already called the mini boss
   the harder wall). Big bodies step badly by design (§35.15.7): the CPU's reaction steps are oracle-checked, so a big CPU simply steps
   less; its read steps are guesses either way.

### §35.19 CHANGED(integrator): the 3D ring integrated - v0.3.0 (2026-09-30; additive, no §16 / §18 / §19 signature broken)
Evidence: `_harness/_reports/progress_3d_integrator.md` (every number below is quoted there with its log), logs
`_harness/_reports/int3d_*.log`, contact sheets `_shots/int3d_sheets/*.png`. Files carry `CHANGED(integrator) 3D` notes.
1. **Version:** `main.ts VERSION = 'hit-parade-0.3.0'` (the online peers' version check: a 0.2.0 and a 0.3.0 peer never meet),
   package.json 0.3.0, README (3D ring + the STEP row of the controls table), `runtime/public/game_meta.json` rewritten for the
   ring (sub_genre "3D arena fighter (360-degree ring, sidestep and circle-walk)", STEP keys / pad / touch, the five arenas
   with their ring materials, homing vs straight attacks, the CPU's steps, goons / heckles from every side, the training
   dummy's SIDESTEPS / CIRCLES). Claims checked against data (every fighter has homing moves; zambini has no `linear` move,
   so the text says "straight", not "linear").
2. **AUDIO (`audio/router.ts`, AUDIO lane file):** WALL_SPLAT pans at the §35.13 payload's contact point (c / d cm) along
   camN's screen-right (`panPt`), a snapshot without `ring` / `camN` keeps the victim's pan; `BoutCtx.wallSurface` (read by
   `boutContext` from stages.json `ring.surface`) layers the ring's material under the thud: `WALL_SURFACE_LAYER` =
   steel_rail `clang` 0.7, cable_railing `clang` 0.45 x rate 0.72, neon_panel `glass_break` 0.4, white_tile `glass_break` 0.3,
   blue_brick none. `EVENT_SOUNDS.WALL_SPLAT.ids` += clang / glass_break. Gate: `probe_audio` "router 3D" (every real stage:
   screen-right contact pans right, the other camera side pans left, the layer plays where the surface has one).
3. **NET (harness + test streams only; rollback / packet code unchanged):** `core/net/testinputs.ts IN.STEP_IN 8192 /
   STEP_OUT 16384`; `inputStream(seed, fwd, frames, step = false)` / `new InputGen(seed, fwd, step = false)`: `step` mixes in
   sidestep taps, 20-69 frame circle-walk holds and step + button tries; the default stream is byte-identical to before
   (probe_synctest / probe_audio keep theirs). `probe_netsim`: every scenario's peers play STEP streams, a spy on each sim
   counts REMOTE words carrying bits 13 / 14 and remote-fighter SIDESTEP / SIDEWALK frames - gated > 0 on both peers, with
   the existing equal-checksum / 0-desync gates; the codec check round-trips STEP words. Falsifier (scratch copy whose
   packet.ts writes `& 0x1fff`): "remote step words 0 ... final checksums DIFFER, desyncs 3" = FAIL. `online2.py --game`: the
   key bots tap Q / E, walk by their screen side sign with planar gaps, and check "<scenario>: STEP over rollback".
4. **SHELL harness:** `common.py BIT.STEP_IN / STEP_OUT`, `P1_KEYS / P2_KEYS stepin / stepout` (Q / E, Numpad7 / Numpad9);
   `bootcheck.py` (G4) `ALL_BITS 0x7FFF`, planar gaps, walk key from P1's screen side, new step 6b = a REAL Q tap (SIDESTEP,
   moved >= 0.3 m, P1 yaw + sim camN turn >= 5 deg) and a REAL E hold of 1.6 s (SIDEWALK, bearing / camN sweep / yaw >= 30 deg),
   shots `boot_step_before / boot_step_tap / boot_step_circle`.
5. **AI harness (`playtest.py`):** G11 - a LOST bout presses CONTINUE at once (the results card's countdown is 10 REAL seconds;
   P2 died on the main menu after a screenshot under load ate it) and asserts the SAME slot returns (`slot_<i>_continue_<n>`);
   no screenshot before CONTINUE, the ladder it returns to is shot (`pts_continue_<i>_<n>`). `--slot-help N --help-hp-pct P`
   (default OFF): after N losses on one slot, each round of that slot starts with the CPU's hp at P % via `__HP__.dev.setHp`
   (the G6 `dev.setMeter` precedent); every assisted line says "DEV-ASSISTED" + `report.devAssist` + a "DEV ASSIST" summary line.
   G6 - `audio_results_music` wants the cue for P1's result in `cue` OR the new `lastCue` (polled 3 s); `esc_resume` polls
   simFrame up to 4 s; the special waits for P1 free before each of <= 8 presses; PARRY is pressed when the CPU's move is 1-10
   frames from its first active frame (startup from data/fighters; parry active 12 f).
   **AUDIO test surface:** `audio/engine.ts lastCue` (the last music cue that STARTED; win / lose are one-shot 8.25 / 10.6 s
   stingers and `cue` goes null when they end) -> `AudioStats.lastCue?` (additive, optional).
6. **VIEW lab (`runtime/src/lab/view.ts`):** the `wallsplat` script stood the pair at the legacy 8 m 1D wall (x 6.2 / 7.35-7.55),
   outside the 5.5 m ring (G5 showed both bodies waist-deep in the theatre's stage apron); now at the ring wall (x 3.75 /
   4.8-5.0) with the §35.13 payload (b = 4 + 256 x 270, contact (550, 0) cm).
7. **Real-game evidence (port 5320, `_harness/scratch/int3d_real.py`, real keys):** VERSUS LOCAL 2P on all 5 arenas (P1 Q +
   P2 Numpad9 held together -> both SIDEWALK, camN sweep 146-150 deg, both yaws ~150 deg, 2.40-2.45 m kept; E + Numpad7 taps
   -> both SIDESTEP; inside the ring; 0 hits); CPU L6 vs L6 stepped on the octagon + a circle ring (sidesteps / circle-walks on
   both sides, camN travel 346 / 357 deg); BRAWL BREAK goons first seen in 7 of 8 octants around the player, soft-lock
   targets 0-3, score 1549; HECKLER TOSS objects from all 8 octants, 33 parries; TRAINING on the octagon circles by Q.
8. **Open (measured, not changed here):** G9 perf (VIEW3D §35.17 item 10) not met and not re-run; CPU steps are matchup-
   dependent (spin vs lotus L6 seed 77 never stepped in 40 s on three rings, headless identical; other pairs / seeds step) -
   the §35.18 reaction / read gating; big bodies step badly (§35.15.7, designer's call); THE FREAK mini boss (item 10).
9. **Strings (`data/strings.json`, UI lane data):** the BRAWL BREAK card said goons come "from both sides" (1D):
   `card.brawl.body` "45 seconds. Waves of studio goons from every side of the ring. Score only.", `card.brawl.rule.0` "Goons
   come at you from all around the ring - up to four at once." (system.json brawl.maxActive 4), `card.heckler.rule.0` "The
   crowd throws junk in from all around the ring." (layoutcheck card_brawl / card_heckler 7 devices, 0 problems).
10. **G11 browser half + THE FREAK (balance finding for FIGHTERS / the designer, nothing changed):** the scripted SeasonBot
   cleared the SEASON to the ending only with a dev assist on the mini boss: run 5 (NORMAL, johnny, `--slot-help 3`) "86
   passed, 0 failed", BRAWL 1503, HECKLER 13130, THE FREAK lost 3x unassisted + 1x assisted (CPU hp 35 % per round) then won
   assisted, RICKY won unassisted on the 3rd try with the PHASE event, name entry + ending + title. Unassisted the FREAK was
   never beaten: NORMAL johnny 5x, EASY (FREAK L4) johnny 6x, NORMAL bruno 11x. Headless (CPU L6 contestant vs CPU FREAK,
   butcher_block): johnny vs L4 2/12, vs L6 0/12, unchanged with an 8 m ring (0/12, 0/12) - so not the ring size; per
   contestant vs FREAK L4 (6 seeds): bruno 6/6, johnny / patch / zambini / krane 2/6, boneyard 1/6, lotus / spin / gazza /
   rerun 0/6. (§33.9: FREAK L6 beat the optimal persona 80 % in 2.5D; §35.18.8 ~95 % in 3D.)
11. **G6 stability (`playtest.py`, AI lane harness):** besides item 5 - HP HELP during the VERB phase only (a fighter below
   40 % hp refilled to max via `__HP__.dev.setHp`, reported as `bout.hpHelp`; the rest of the bout decides the winner: CPU L1
   bruno had won 2-0 inside the verb phase, so super / HUD / audio never ran); while the parry verb is open P1 stands its ground
   at close range for up to 40 s of the rest of the bout; the SIM SPEED is measured (3 s of `__HP__` ticks at the bout start /
   a stuck intro, frames / (seconds x 60) over the bout) and a FAILING run below 0.5 of real time is reported INCONCLUSIVE
   (exit 3, never a pass) - other sessions saturated this machine's GPU (a WebGL2 clear-only page: 4 rAF/s, blank page 26).
12. **Gates on the final tree (2026-09-30 / 10-01, port 5320, logs `_harness/_reports/int3d_*.log`):** G0 `npm run typecheck` rc 0;
   G1 `probe_data --strict` 10/10, 384 moves, 0 errors; G2 `npm run probe` 22/22 (probe_audio 17/17 incl. router 3D, probe_netsim
   with STEP streams: 48980 remote step words / 15338 remote step-state frames, synctest 0 mismatches incl. +STEP, probe_season
   30/30, probe_training 28/28, probe_3d 96/96); G3 `probe_personas --seeds 1..20` 25/25, acceptance 7/7; G4 bootcheck BOOTS CLEAN
   with the Q tap (yaw 90.0 -> 55.3, camN 0 -> -34.7 deg) + E hold (camN sweep 166.7 deg); G5 lookshots `--game --only g3d` (39
   PNGs: 7 orbit yaws 0 / 300 / 245 / 193 / 154 / 76 / 36 deg, dodge, ring splat, PRIME TIME on 37.5 deg, 5 arenas, BRAWL) + the
   lab groups (38 PNGs; wallsplat fixed, item 6), all read; G6 playtest 55/55 in runs 6 / 8 / 10 / 12 (runs 7 / 9 failed on the
   flakes fixed in items 5 / 11, 3 / 4 / 5 / 11 starved = INCONCLUSIVE); G7 menus --game 68/68, menus lab 140/140, bootguard 11/11
   cases; G8 mobile --game 50/50, mobile lab 180/180, layoutcheck 7 x 44 steps 0 problems; G11 item 10; online2 --game quick: STEP
   over rollback ok (remote step samples 294 / 251, 0 desyncs) but the bout did not finish (both loops ~5 % of real time);
   `npm run build` 58,152,817 B / 86 files (31 GLBs 40,972,332 B).

### §35.20 CHANGED(fix_core): per-fighter sidestep, the frame-2 step buffer, BACK HIT, teleport facing, the grab hold (2026-10-01; additive except where marked)
Evidence: `_harness/_reports/progress_fix_core.md` (every number below is quoted there with its scratch script / log), gates
`probe_3d` (3b by-defender + section 10), `probe_uniques` (teleport), synctest / determinism / perf. Files carry
`CHANGED(fix_core)` notes. Verifier defects D1, D9, D7, D8, D4.
1. **Per-fighter SIDESTEP length (D1; data + sim interface).** `fighters/<id>.json` gains `step: { distM }` (metres, sim clamps
   0.5..2.5). Generated by `data/fighters/_gen/kitlib.py step_dist_m` from the measured body (data/bodies.json stand
   [front, back]); validate.py `check_step` re-derives it. Why: the step circles round the ATTACKER, so the defender's hurt
   cylinder (r = (front + back) / 2, centred off = (front - back) / 2 ahead of the root) must swing (lat + r) sideways on a
   lever arm of (gap - off): arc needed A = 1.2 asin((0.22 + r) / (1.2 - off)), `distM = clamp(1.555 A, 0.85, 2.0)` (mm).
   The radius alone cannot rank the bodies (krane r 0.48 needs ~1.24 m, rerun r 0.47 needs ~1.71 m: its front sits 0.33 m
   toward the pivot); K 1.555 is calibrated in the real sim so every non-small body sits in its "2-frame" band. As generated:
   patch / johnny / gazza / lotus **0.850** (the default), ricky / zambini 0.967, spin 1.131, boneyard 1.202, bruno 1.219,
   krane 1.244, freak 1.606, rerun 1.715. SIM: `CFighter.stepDist / stepCurve` (compile.ts `stepCurveOf(sys, distU)` = the
   §35.15 curve scaled: still 15 frames, 64 % of the arc in the first 6), fighter.ts steps each fighter by its own curve; a
   fighter without `step` (fixture kits) uses system.json `step.distM` 0.85 (goons never step); `CSys.stepCurve` stays the
   DEFAULT curve; FighterSnap `step.dist` (m, additive). Measured at 1.2 m (probe_3d 3b by-defender rows, STEP_IN, longest
   run of evading start frames vs krane 5M s8 / zambini 5H s12 - every straight 5M / 5H of the roster gives the same window
   for a given defender): **before** boneyard / bruno / freak / krane / rerun / spin never / never, ricky / zambini 1 / never;
   **after** boneyard 3 / 2, bruno 3 / 2, freak 3 / 3, krane 3 / 2, rerun 3 / 2, spin 3 / 2, ricky 4 / 2, zambini 3 / 2; the
   small bodies unchanged (patch 6 / 4, johnny / gazza / lotus 4 / 3); homing never evaded (krane 5H vs all 12; 134 reachable
   homing ground strikes vs the two longest steps, rerun / freak); STEP_OUT = STEP_IN. The jab-speed 5L (s5) stays
   unsteppable for the big bodies (§35.15: 4-6 frame moves). Requests: **AI** - `core/ai/ring3d.ts traceCircle` reads
   `m.sys.stepCurve` (the 0.85 m default): read `m.cf[i].stepCurve` (the StepOracle sandbox already plays the real
   per-fighter step) [done: CHANGED(fix_balance) §35.21 item 4]. **VIEW** - scale the sidestep clip's lateral travel to the fighter's `step.distM` / snapshot
   `step.dist` (view/stepanim.ts already reads `step.distM`).
2. **Step buffer from frame 2 (D9; one data number + one parse rule; supersedes "attacks may be buffered from frame 9" in
   §35.2, "buffered from step frame 9" in §35.12 item 5 and "presses buffer from step frame 9 (earlier presses are ignored)"
   in §35.13 item 4).** system.json `step.bufferF` 9 -> 2 (compile default 2): a press on ANY sidestep frame (2 .. 10) is HELD
   - inputs.ts gives its buffer the frames to `step.attackF` (11) plus the normal window - and comes out on step frame 11; a
   later press overwrites it (the newest press wins, as everywhere); from frame 11 on a press acts at once (unchanged).
   Step-attacks (`SS.<btn>`) route the same way from frame 2. The STEP tap and the dash keep their own short windows.
   AI `brain.ts` mirrors `m.sys.stepBufferF` (its comment "presses before frame 9 are ignored" is stale; the code follows
   the number).
3. **BACK HIT (D7; system.json block + one event).** system.json `backHit: { arcDeg 120, damagePct 120, hitstunF 4 }`. A
   strike whose attacker root - or a projectile whose travel - comes from more than `arcDeg` off a GROUNDED defender's facing
   (pre-hit state, like counter hits; juggled / airborne defenders excluded so juggles keep their scaling) is a back hit:
   damage x `damagePct` / 100, + `hitstunF` on a hitstun reaction (the counter-hit bonus slot), the victim turns to face the
   attacker on the hit frame (a projectile: toward where it came from; F.facing follows), and event **`EV3D.BACK_HIT` = 47**
   follows the HIT with HIT's payload (a attacker, b victim, c strength class, d height cm). `EV3D` is a NEW opt-in group in
   core/sim/events.ts (also in EV_NAMES) - not in `EV` / `EVX`, because audio/router.ts types its tables over those keys and
   probe_audio checks the coverage. Requests: **UI** - a BACK HIT callout (HUD), **AUDIO** - an optional sting; both import
   `EV3D` from core/sim/events.ts.
4. **Teleport facing (D8).** fighter.ts `teleport()` ends with auto-face: the teleporter arrives facing the opponent's
   start-of-frame point (yaw + input sign). Zambini vanish_l / vanish_ex no longer keep their back to the opponent for 23 /
   16 frames and snap 180 degrees in the free state; the opponent is untouched (it re-faces by its own auto-face on the next
   frame, as for any cross-over).
5. **The grab hold (D4; data + sim, LAYOUT_REV 5).** Every grab used to hold its victim where it was caught (the connect
   anchored the victim's own position; the GRAB thrower never moves): measured at the farthest connecting start, throws 0.56-
   0.73 m, command grabs 0.82-1.39 m, cold_storage 0.87 m and bruno FINAL DELIVERY 1.27 m of push-front gap, lift always 0 -
   the grab clips hugged / slammed / lifted air. Now:
   a. `grab.path: [[lockFrame, gapM, liftM], ...]` (GrabDef, optional) = the victim's ROOT over the lock: the thrower's root at
      the connect + its forward x gap, lifted; implicit first key = the actual distance at the connect (lift 0), linear,
      held after the last key; while lift < 0.30 m the gap is floored at the two push fronts (ramped 0.30 -> 0.15 m,
      §26.5); the sideways offset at the connect fades by the first key; the victim clips' own root travel is not added.
      The kit generator emits it for every grab super from its cinematic `gapD` (validate.py: equal, ascending, ends on the
      floor at `endGapM`). bruno FINAL DELIVERY from 1.6 m: hugged at 0.875 m (= bruno 0.558 + johnny 0.317 push fronts)
      while grounded, spun at 0.61-0.69 m as the lift rises, overhead 1.40-1.60 m at 0.40-0.80 m (lock 100-128), hurled to
      3.00 m landing on the damage frame (140), released there lying (knockdown), 4500 damage.
   b. every other grab (throws, command grabs, grab super cold_storage, grab-less system throws): on the connect the victim
      slides onto the thrower's forward line at the HOLD distance (push fronts touching + `grab.holdGapM`, default
      system.json `throw.holdGapM` 0) over `throw.pullF` (6) frames, then its clips' carry as before (a side swap scales to
      hold + `after`, so it still lands `after` behind). The carry anchor is on the hold point by lock frame 6 for all 41
      such grabs. **Gameplay side effect:** a grab caught at max range now releases where a touching one does (johnny throw_f
      1.41 m from 1.2 m, was 1.98 m; bruno walk_in_m 2.13 m, was 3.21 m; cold_storage 2.03 m, was 2.91 m; side swaps
      unchanged); `throw.pullF: 0` restores the old placement.
   State: fighter `thrAX / thrAZ` (the thrower's root at the connect), STATE_INTS 614 -> 618, LAYOUT_REV 4 -> 5 (STATE_VERSION
   changes; both online peers run the same build). `F.y` of a THROWN victim now carries the path lift - the view's
   grab-super path already draws that victim at the sim's x / y / z (bout.ts grabLock / prime.ts simVictim): nothing to change.
   The 12 strike Lv3 cinematics are unaffected (the view places their victims at attacker + gapD).
6. **Gates (2026-10-01, logs `_harness/_reports/fixcore_*.log`):** `probe_3d` 96 -> 110 checks: 3b by-defender = every body
   evades a straight 5M AND 5H at 1.2 m from >= 2 consecutive start frames; small bodies (r <= 0.27) >= big ones (r >= 0.37)
   per move and larger in 5M + 5H; the small keep 0.85 m, the big step longer; STEP_OUT = STEP_IN for the long steps; homing
   never vs rerun / freak (134 strikes); step-attacks pressed on step frame 2 / 5 / 9 -> SS.H on frame 11; section 10 = D9
   (frames 2..10 -> 11, newest wins), D7 (119 deg normal; 121 / 180 / -150 deg x1.2 + 4 f + turned + one BACK_HIT; a
   straight projectile into the back; juggles excluded), D4 (FINAL DELIVERY path keys; the other 41 grabs' anchor on the
   hold point by lock frame 6; range-independent release, side swap behind). `probe_uniques` 168/168 (the two teleport checks
   rewritten: they asserted the D8 defect). build.py BUILD OK, validate.py PASS (`check_step`, `grab.path`), `probe_data
   --strict` 10/10, `npm run typecheck` 0 errors, `npm run probe` 22/22 (synctest 1742016 + STEP 593808 checks, 0
   mismatches; determinism STEP streams 180 runs 0 mismatches; perf step p99 55-86 us, budget 250; A/B vs the committed sim
   under the same machine load: within noise).
### §35.21 CHANGED(fix_balance): THE FREAK / RICKY balance + the CPU fights in the 3D ring (2026-10-01; §11 / §16 / §23 signatures unchanged)
Evidence: `_harness/_reports/progress_fix_balance.md` (every number below is quoted there with its log), the new gate
`_harness/probe_balance.ts` (real sim + data + CPU; SEASON staging = mode arcade on the opponent's home stage, game.ts CPU
seeds; `--full` = the tables, no args = the run_probes smoke), logs `_harness/_reports/fixbal_*`. Files carry
`CHANGED(fix_balance)` notes. Strong player = CPU L6 contestants (the bosses' own level); the harness 'optimal' persona is
measured alongside but cannot be the curve's gauge: G3 A4 (§11) needs it to beat RICKY > 50 %.
1. **Why THE FREAK was a wall (measured, one lever at a time on a GameData clone, CPU L6 x 10 contestants x 12 seeds vs FREAK
   L6, base 13 %; scratch `_harness/scratch/fixbal_levers.ts`):** armor off +4, armor 1 hit 0, HP 10000 +5, damage x0.85 +5,
   reach x0.9 -5 (noise), boss tools (armor reactions) off +1, aggression bonus off +4, no CRUSHER LEAP 0, no ROAR +3, plain
   bigbody style +4; **the CPU never throwing SPECIMEN GRAB +21** (grab + armor off +42). Damage tally (`fixbal_dmg.ts`):
   SPECIMEN GRAB = **52-55 % of all FREAK damage** vs CPU L6 and optimal contestants (~6 grabs per bout; SIMPLE 4S = one
   button). It was the WALK IN template (5 f, untechable, homing, 1.10-1.30 m push-front gap) on a 0.75 m push front = ~2.3 m
   centre reach, beyond most pokes, thrown by the close plan (style grab 0.30) AND as the anti-step answer (the fastest
   antiStep move that reaches). The mirror image: the contestants that beat the bosses won with THEIR command grabs (rerun:
   LAST MEAL 65 % of its damage) - no CPU respected a command-grab range. RICKY's big lever is his counter (tools off +26).
2. **The retune.** kits/freak.py (build.py BUILD OK, validate.py PASS): SPECIMEN GRAB gap 1.00 / 0.92 / 0.85 m (was 1.30 /
   1.20 / 1.10), damage 2200 / 2550 / 2900 (was 2600 / 3000 / 3400), EX 1.08 m / 3150 (was 1.40 / 3700) - ~2.0 m centre reach
   = Bruno's WALK IN on a normal body; 5H armor frames 9-14 (was 5-14), 6H 18-23 (was 5-23): still 2 hits on the heavies, but an
   early poke interrupts the wind-up; cpu antiStep ["5M", "roar_ex"] (was ["5M", "specimen_grab_m"]). data/cpu.json: style
   boss_armor grab 0.30 -> 0.05, armor 0.40 -> 0.25; boss.freak aggressionBonus 0.10 -> 0.05. data/ladder.json (season +
   pilot): THE FREAK L6 -> **L5** (its difficulty now comes from its tools - the §11 boss rule), NORMAL slot 1 L2 -> **L1** (the
   novice persona beat the L2 opener 42-46 %, L1 69-74 % = G3 A3's opponent). Normal = L1 L3 L3 L4 L5 L5 / FREAK L5 / RICKY L6
   (EASY -2, HARD +2 as before). RICKY unchanged: HP 14000, damage x1.1, throw 0.45 / counter 0.55 style weights, no linear
   zoning and ladder L7 were all measured and none moves the optimal persona (63-76 %); vs CPU L6 he is already the hardest bout.
   Not changed (outside this lane): THE FREAK HP (validate.py pins 11500 = §5.4), grab startup (7 f shifted the ASSETS clip plan
   `throw_reach` range vs the baked GLB; worth +2 only).
3. **Every CPU respects command grabs (core/ai, honest - frame data + visible habits):** `brain.opGrabU / opGrabF` = the
   opponent's command-grab centre reach (its push front + mine + the grab's gap) and startup; a command grab counts as close
   offense from as far as it reaches (habits); once it has shown grabs (throw habit, x2 for an untechable grab) the CPU does not
   walk / guard inside that zone: it backs out (walk long enough / backdash) or (L3+) presses a button that is out first, and
   vs a walk-in swings `brain.antiGrabPoke` (normals or not-badly-unsafe specials that meet the walk-in before the grab).
4. **The ring by plan (core/ai/plans.ts ringPlan, ring3d.ts, cpu.json):** read sidesteps at every range inside its threat (was
   push fronts + 0.15 m: grapplers never stepped), a read step as it walks / dashes into range, a NEW neutral circle-walk at
   footsies spacing (level lever `walk`; toward the room behind me / its wall, else on round; 18-54 f), the wall escape from
   1.6 m (was 1.3); style multipliers `ringWalk` / `ringStep` (cpu.json styles: zoner 1.2 / 0.8, grappler 0.5 / 1.7, boss_armor
   0.4 / 1.0, ...); levels step / stepGuess / circle / antiStep / walk L1 0 / 0.015 / 0.05 / 0.05 / 0.012, L2 0.1 / 0.04 / 0.12 /
   0.1 / 0.03, L3 0.2 / 0.1 / 0.3 / 0.2 / 0.07, L4 0.3 / 0.18 / 0.45 / 0.3 / 0.1, L5 0.4 / 0.25 / 0.55 / 0.4 / 0.14, L6 0.5 / 0.31 /
   0.6 / 0.5 / 0.18, L7 0.6 / 0.35 / 0.65 / 0.6 / 0.2, L8 0.7 / 0.39 / 0.7 / 0.7 / 0.22; personas novice / optimal gain `walk`.
   The honesty rules hold (reaction steps only through the §35.18 sandbox oracle on the level's clock; reads are guesses from
   committed habits; no input reading). `traceCircle` reads the fighter's own step curve (cf.stepCurve, §35.20 request). WEAVE
   neutral read from highRate 0.3 (was 0.45; G3 U1 had "MISSING johnny [weave, weave_counter]" on the base tree).
5. **Win-rate table, CPU L6 player, 24 seeds per cell (player win %; FREAK EASY L3 / NORMAL L5 / HARD L7, RICKY L4 / L6 / L8):**

   | contestant | FREAK E | RICKY E | FREAK N | RICKY N | FREAK H | RICKY H |
   |---|---|---|---|---|---|---|
   | johnny | 100 | 54 | 21 | 25 | 4 | 21 |
   | patch | 96 | 88 | 42 | 63 | 21 | 46 |
   | bruno | 100 | 100 | 96 | 92 | 100 | 92 |
   | zambini | 96 | 0 | 21 | 0 | 8 | 0 |
   | krane | 96 | 67 | 100 | 33 | 75 | 38 |
   | lotus | 71 | 38 | 21 | 25 | 8 | 17 |
   | boneyard | 67 | 21 | 4 | 8 | 13 | 4 |
   | spin | 88 | 21 | 54 | 0 | 8 | 0 |
   | gazza | 83 | 33 | 29 | 4 | 8 | 8 |
   | rerun | 96 | 63 | 92 | 63 | 71 | 33 |
   | **ALL** | **89** | **48** | **48** | **31** | **32** | **26** |

   BEFORE (base tree, FREAK L4 / L6 / L8): FREAK 28 / 12 / 9, RICKY 50 / 34 / 28. Regular slots (every other playable fighter
   x 2 on its home stage) now L1 98 / L3 83 / L4 71 / L5 59 (slots 1-6 mean 76; before L2 96 / L3 90 / L4 83 / L5 59).
   'optimal' persona: FREAK 97 / 77 / 60, RICKY 82 / 72 / 62 (before 52 / 20 / 13, 81 / 68 / 61); per contestant vs FREAK
   NORMAL johnny 63, patch 83, bruno 100, zambini 92, krane 96, lotus 46, boneyard 46, spin 63, gazza 79, rerun 100 (min 46);
   slots L5 74. Novice vs NORMAL slot 1 (L1) 69 %. probe_season S5 (optimal stand-in, 15 full runs): mini boss lost 9 / 24,
   boss 18 / 33. G3 info: FREAK L6 vs optimal 4 / 20 (was 17 / 20).
   **Met:** CPU L6 average vs FREAK 48 % (40-65), FREAK 11 points under the hardest slot level and 28 under the slots' mean,
   FREAK 17 / 41 points easier than RICKY at NORMAL / EASY, every contestant >= 46 % with the optimal persona, novice > 50 %.
   **Not met (measured, explained):** CPU L6 johnny / zambini / lotus 21 %, boneyard 4 %, gazza 29 % vs FREAK (the same kits are
   the weakest CPU L6 players vs L5 slots 44-56 % and RICKY 0-25 %: CPU kit-plan strength, not FREAK tools - a stripped FREAK
   at L5 (no tools / armor / grab) beat lotus only 44 % / boneyard 50 %); HARD: FREAK 32 vs RICKY 26 % (RICKY harder by 6, both
   saturate: only the grapplers win); the optimal persona finds FREAK (77 %) about as hard as an L5 slot (74 %) and RICKY only
   5 points harder (structural: its 10 f perfect blocking of RICKY's honest, reactable kit - no lever moved it).
6. **Ring usage, CPU Ln vs CPU Ln, 12 fighters x 5 arenas (60 bouts per level), per CPU per bout, before -> after:** sidestep
   taps / circle-walks L1 0.38 / 0.44 -> 1.86 / 1.11, L2 1.28 / 0.61 -> 2.88 / 1.76, **L4 2.96 / 0.77 -> 6.74 / 3.30** (fewest taps
   bruno 0.7 -> 3.4; every fighter >= 3.4), L6 2.72 / 0.51 -> 8.04 / 3.38, L8 3.98 / 0.62 -> 8.16 / 3.78; camN travel per bout L1-L8
   109 / 198 / 350 / 297 / 377 -> 313 / 452 / 886 / 936 / 900 deg (widest single-round sweep L4-L8 126-143 -> 234-263 deg). vs an
   opponent that never steps (the CPU alone): L6 3.58 / 0.63 -> 10.35 / 3.70, camN 202 -> 689 deg; L8 272 -> 743 deg.
7. **Gates:** `probe_balance.ts` (new; run_probes runs the smoke: FREAK at NORMAL 25-80 %, RICKY not easier by > 10, novice vs
   slot 1 > 50 %, ring L4 >= 4.5 taps / 1.5 circle-walks; `--full` gates B1a / B1b / B2 / B3 / B4 / R1-R4 above and prints the
   misses as NOTE lines). G3 `probe_personas --seeds 1..20` 25 / 25, acceptance 7 / 7 (A1 18, A2 20, A3 16, A4 RICKY 5 / 20, A5
   17 + L6 17, A6 18, A7 44 / 48; U1 "all used"); ring-off profiles in H4 / H5 / H6 / spammers zero `walk` too; H5 uses the G3
   seeds 1-6 in the smoke too (on 3 seeds H5b decided on 7 guarded overheads - the extra WEAVE roll per decision flipped it
   4/7 = 0.57 vs the 0.6 bar; same bar, twice the sample: 0.69). `probe_season`
   30 / 30 (+ a report line: bouts lost / played per slot kind).
8. **Out-of-scope findings (not changed):** Bruno's WALK IN (FIGHTERS kit: 5 f, untechable, homing, L gap 1.22 m) connects
   from ~2.2 m centre distance - beyond every normal of most kits - and Bruno walks forward faster than most walk back: as an L5
   CPU opponent he beats CPU L6 contestants 89 % (johnny 0 / 8 even with the grab-awareness above; the integrator's SeasonBot
   lost slot 4 = Bruno L4 three times), and every CPU slot level 100 % as a contestant. Command-grab reach is push-front to
   push-front, so big bodies (THE FREAK 0.75 m) are grabbed from ~2.5 m. Suggested: WALK IN L gap 1.22 -> ~1.0 m (FIGHTERS).
9. **Real game (2026-10-01, `_reports/fixbal_real.json`, `_harness/scratch/fixbal_real.py`, port 5326 frozen + stepped in the page):**
   menu-VERSUS deep links, CPU L4 vs CPU L4: rooftop johnny vs krane (seed 411) taps 12 / 8, circle-walks 3 / 4, camN travel 1134
   deg (sweep 231); butcher_block lotus vs boneyard (seed 412) taps 1 / 3, circle-walks 0 / 0, camN 157 deg - a low-tail bout of a
   below-average matchup (seeds 401-410: 3.2 / 2.3 and 3.9 / 1.1). Both replay headless IDENTICALLY (fixbal_replay.ts). 0 console
   / page errors; 3 shots read (`_shots/fixbal_real_b1_first_circle`, `_b1_later` - the camera on another side of the ring -,
   `_b2_first_sidestep`). Final gates: build.py BUILD OK, validate.py PASS, probe_data --strict 10/10, typecheck rc 0, `npm run
   probe` 23/23 (synctest 0 mismatches).

### §35.22 CHANGED(fix_ui_stage): stage lights for the orbit camera, rust footlights, BACK HIT callout + sting, HECKLER card, PILOT board, move-list follow-ups, touch harness (2026-10-01; additive)
Evidence: `_harness/_reports/progress_fix_ui_stage.md`, real-game reports `_harness/_reports/fixus_*.json` (orbit before /
after, wall stations, season, backhit, crlight), shots `_shots/fixus_*` (all read). Files carry `CHANGED(fix_ui_stage)` notes.
1. **Stage lights (verifier D5 / modes D6 / butcher_block cap glare; stage scripts -> fragments -> `merge_stages --install`).**
   Measured in the real game (the linear HDR the bloom pass thresholds at luminance 0.92, fighter masks, 8 orbit angles at the
   desktop default quality): (a) a practical point light stands >= 1 m off its own fixture - at 0.15-0.44 m it lit the fixture
   to luminance 25-83 (control_room furnace door + beacon dome, rooftop door lamp) = the flares over the fighters' heads; (b) a
   rim / spot that reaches metal or glossy surfaces near the camera comes in at >= ~40 deg elevation - at 17-32 deg its mirror
   image in a metal cap or a glossy floor sat across the fighters' legs from some orbit angles; (c) an overhead ring spot is ~1x
   the key on the heads (control_room's 320 cd at 6 m was ~7x: both fighters blown out at every angle). Applied: control_room
   ring_spot 320 -> 70, furnace (11.1, 1.3, 0) 34 -> (9.4, 0.8, 0) 14, beacon (-10.95, 3.2, 3.75) 8 -> (-9.9, 2.9, 3.75) 5,
   crt_wall (0, 3.4, -14.8) 40 -> (0, 3.6, -12.6) 32, rim (3, 5, -12) -> (2.2, 9.5, -8.8); butcher_block + wheel_of_pain rim
   polar(10, 20, 7) 1.5 -> polar(7, 20, 9.5) 1.3; wheel tower spots polar(9.75, az, 7) -> polar(7.8, az, 9); rooftop rim (4, 6,
   -13) -> (3, 10.5, -9.5), floods (+-7.6, 5, -+7.6) -> (+-6.4, 7.4, -+6.4), door_lamp (-10.15, 2.8, -1.05) -> (-9.1, 2.45,
   -1.05). GLB: control_room firebox door LOW (frame 0.38-1.02 m, glow 0.47-0.93 m - always under the 1.35 m orbit eye, so it
   can never sit over a standing fighter's head) with its own `cr_fireglow` (2.0), cr_beacon 3.0 -> 1.4, cr_glow 5.0 -> 3.0,
   CRT glass roughness 0.12 -> 0.4; rust_theater rt_brass roughness 0.35 -> 0.55 (it mirrored the HDRI windows); butcher_block
   ring cap + corner posts `bb_steel_cap` (roughness map x1.85); wheel_of_pain floor semi-gloss (roughness map x1.5 + 0.06,
   mean 0.085 -> 0.19). Results: control_room fighters over the threshold 0.034-0.207 -> <= 0.002 (p99 1.67 -> 0.69), furnace /
   beacon head-zone flares 23-32 -> none; rooftop door-lamp flare 83 -> none, wet-floor pools gone; rust brass glint 8.8 -> none;
   wall stations: butcher cap glare 11.9 % of the fighters' band -> 0.2 %, wheel bumper 6.5 % -> 1.5 %, wheel floor glints 43-57
   -> <= 4.2; the other stages' fighters unchanged (p99 <= 0.79). Draws: control_room 30 -> 31, butcher_block 28 -> 29.
2. **rust_theater footlights (verifier D11):** the 48 iron hoods lying ON the coping (top 1.285 m) are lamps RECESSED under the
   coping lip (housing inside the 5 cm overhang, y 1.0-1.05 m, a glowing slot facing the pit, none over the two gates): nothing
   on the wall top stands higher than the coping, the near-wall lamps face away from a camera behind the wall; the ring still
   reads under the far coping.
3. **Stage tooling:** `tools/merge_stages.py --install` reads both staging dirs (`_harness/scratch/stages3d_out/` +
   `_harness/scratch/stages_cache/out3d/`); a stage staged WITHOUT a GLB is a fragment-only install (validated against the shipped
   GLB + env; light / copy edits without a rebuild); renames retry while a dev server holds a file. `art/stages/stagekit_b.py
   --fragment-only` (rooftop / control_room) and stagelib_a's existing flag carry the SHIPPED fragment's measured build fields.
4. **BACK HIT (the §35.20 item 3 requests):** UI `ui/ev.ts EV_BACK_HIT` (the live EV3D table, fallback 47); `ui/hud.ts` callout
   `call.backHit` "BACK HIT!" on the attacker's side (styled like PUNISH COUNTER, orange; bonus rounds: the player's own only) +
   host caption pool `back_hit` (data/captions.json, priority 2). AUDIO `audio/router.ts RING_EVENT_SOUNDS` (mapped over
   `keyof typeof EV3D`: a new EV3D type fails typecheck until routed): BACK_HIT = `hit_pun` (rate x0.94, +20 ms) at the victim's
   pan + `crowd_ooh`; no new assets; probe_audio's tables stay EV / EVX (nothing becomes unreferenced).
5. **Copy (modes D4):** `card.heckler.kicker` "HECKLER TOSS" (was "BRAWL BREAK" - the card kicker AND its broadcast bug), title
   "PARRY THE PEANUT GALLERY"; `season.full.sub` "2 bonus rounds" (the full season has one BRAWL BREAK + one HECKLER TOSS).
6. **Boards (modes D3):** UiSave gains `scores?: { season?, pilot? }` (SaveStore.get() already returns it; `board` stays the
   SEASON board). The menus rank, list and show THE BOARD from the board of the run's LENGTH: `showNameEntry(p.length?)`
   (default: the run on screen - the last showLadder / startSeason length), `showEnding(p.length)`; both label it PILOT BOARD /
   FULL SEASON BOARD (`name.boardLen.*`). **Request to SHELL:** pass `length: init.length` to `showNameEntry` in game.ts
   seasonCleared (it works without it today).
7. **Move list (modes D5):** under each special / EX / super row its follow-ups, indented, each once with its own notation in
   both control types and its own HOMING / LINEAR tag: rekka parts (`cancel` `chain:<id>` to a `tc` move, the move's `trigger`;
   recursive: patch CUE KICK > CUE 2 > CUE 3), stance follow-ups / exits (`unique.followups` / `unique.exit` of a stance-enter
   move), counter follow-ups (`counter.follow`: AUTO). UiMoveDef gains `cancel tc trigger stance counter`, UiFighterDef.unique
   `followups exit`.
8. **Harness (verifier D12):** `_harness/mobile.py` Touch.up() lists ONLY the released finger in `touchEnd` (CDP ends the points
   a touchEnd lists); new checks lab `release_step_keeps_stick` / `release_one_of_3`, --game `game_release_one_finger` (with the
   old call both lab checks fail: the stick was released instead of STEP).
9. Seen, out of scope: SIMPLE 2S after CUE 2 still fires CUE 3 OVERHEAD (§34 item 8a, SIM) - the move list shows the authored
   trigger (2 + S).
### §35.24 CHANGED(fix_input): rekka / follow-up triggers ranked, a release never re-triggers, SIMPLE S+H beats follow-ups (2026-10-01; parse rules only - no signature, state, layout or data change)
Evidence: `_harness/_reports/progress_fix_input.md`; gate `probe_motion` (47 -> 169 checks). Files carry `CHANGED(fix_input)` notes:
`core/sim/inputs.ts` (parse rules), `core/sim/motion.ts` (additive `motionSpan`). Resolves §33 item 8 (a) + (b) and the §35.22 item 9 note.
1. **Sibling triggers are ranked (a).** In a parent's chain window every triggered part (§20.2 `trigger`) is scored and the MOST
   SPECIFIC affordable one is buffered (ties: the authored `cancel` order), not the first that matched: SIMPLE S form on the exact
   direction > on the same SIMPLE class (1 / 3 -> 2S, 9 -> 6S, 7 -> 4S, 8 -> 5S = the one-button routing) > the classic form (motion
   + one of its buttons; also in SIMPLE, §1) > `"5S"` on any other direction (the neutral fallback, only when no more specific
   sibling matches) > button-only triggers. Motion vs motion: a motion that ENDED before the other STARTED is a leftover and loses
   (hitstop never ages a motion: CUE 2's 236 was still satisfied at every 214 typed in CUE 2's hitstop or its last 5 startup frames);
   overlapping motions (6236 = 623 + 236) go by `MOTION_PRIO`, as the special routing. Patch after CUE 2: 2S / 1S / 3S = CUE 3 LOW
   (was OVERHEAD), 5S / 8S / 6S / 4S / 7S / 9S = CUE 3 OVERHEAD; CLASSIC 214 = LOW, 236 = OVERHEAD, typed in the hitstop or after it.
   Target combos (§19.1 `chain:`): an exact direction beats the 5X / 2X class (no kit has overlapping parts today: unchanged).
2. **A release never re-triggers (b).** A release-only read (§4.3.9 negative edge) (i) never overwrites a LIVE follow-up the player
   pressed (`BUF.CHAIN` = rekka / target combo, `BUF.STANCE`): the chain button's release re-read the still-fresh motion as the
   parent special and replaced the chain (236 typed in CUE 1's hitstop, CLASSIC or SIMPLE motion form: no CUE 2; johnny's counter
   hook pressed on WEAVE frame 1 was lost the same way); (ii) never re-reads the special row of the move already running: a special
   with a `"special"` cancel restarted itself on the release - bruno BRACE, boneyard BUTCHER'S BLOCK (also from the CPU's 1-frame
   taps), gazza DIVE, zambini EX VANISH (paying 2 more NERVE bars). Unchanged: a release from neutral or into a cancel window still
   fires a special; a NEW press still replaces any buffer (newest press wins); the world-freeze hold-to-buffer rule; STEP bits 13 /
   14 and the §35.20 frame-2 step buffer (probe_3d section 10 passes).
2b. **SIMPLE S+H beats follow-ups (orchestrator decision, 2026-10-01).** In SIMPLE the S+H super chord completed on this frame (same
   frame, H first, or S one frame before = the S+H routing's chord window) is the SUPER, not a follow-up press, while the running
   move has follow-ups AND its cancel list allows a super AND the super is usable: Patch CUE 1 -> S+H = HIGHLIGHT REEL (in or after
   the hitstop), CUE 2 -> 2S+H = ON AIR (3 bars). S alone (any meter) stays CUE 2 / CUE 3; S+H without the meter, or in a move whose
   cancel list has no super (johnny WEAVE; fixture rk2n), stays the follow-up press. S first and H one frame later works while the
   parent is frozen in hitstop (outside it the S frame already starts the follow-up). CLASSIC unchanged: a fast 236, 236 rekka
   already satisfies 236236, so supers do not outrank the motion triggers there.
3. **`motion.ts motionSpan(s, b, code, w, out)`** (additive): for a done motion, out[0] / out[1] = the END / START ages (history
   entries back from the newest, frozen entries counted) of its latest-ending match; false when the motion is not done.
4. **Checked, no change needed:** every kit's trigger sets (patch cue_* -> cue2, cue2 -> cue3_oh / cue3_lo; johnny weave_* ->
   weave_counter): each part comes from its own trigger in both schemes (probe_motion, parser level, CLASSIC with every sibling's
   motion left in the window); lotus' stance follow-ups: 411 timed presses through the enter moves, both schemes, never meet the
   enter motion's re-read (its 214 is outside the QC window whenever a press can still buffer into the stance); rerun / ricky
   counter follow-ups have no trigger (automatic).
5. **Requests / notes.** AI: both workarounds are no longer needed (they still work): brain.ts routeTick waiting out the hitstop
   for motion triggers, kit.ts `triggerSteps` using the motion form for SIMPLE chain parts. The CPU no longer gets a second BRACE /
   BUTCHER'S BLOCK / DIVE / EX VANISH from a release (the §35.21 tables were measured with them). Out of scope, measured (not
   changed): Patch's authored `super` cancels out of CUE 1 / CUE 2 are shadowed by the rekka parse (it runs before the supers):
   SIMPLE S+H in CUE 1 = CUE 2, 2S+H in CUE 2 = CUE 3 LOW; CLASSIC 236236 in CUE 1 = CUE 2, 236236 / 214214 in CUE 2 = CUE 3; only
   CUE 1 -> 214214 = ON AIR. SIMPLE: applied as item 2b; CLASSIC stays as described (a fast "236, 236" rekka already satisfies
   236236).
6. **Gates (2026-10-01, final tree incl. 2b):** typecheck 0 errors; `npm run probe` 23/23 PASS (probe_motion 169/169; synctest
   1742016 checks 0 mismatches; determinism 33/33; personas 17/17 smoke; season 30/30; uniques 169/169; axis 20/20 incl. motion on
   33 / 200 deg; probe_3d 111/111). An intermediate run failed probe_3d D4 (`bruno walk_in_m 0.00 / 2.13 m`) after lane FIX_BRUNO's
   09:42 WALK IN `grab.rangeM` retune - identically with the pre-fix parser (tree copies) - until probe_3d was updated at 10:03.
   Before / after (a) + (b) on two tree copies identical except inputs.ts: probe_motion 117/151 FAIL -> 151/151, probe_axis 18/20 ->
   20/20 (its probe_motion runs), run_probes 19/23 -> 21/23 (the two left fail in both copies only for files outside the copied
   tree: the music registry, the RTT traces); G3 `probe_personas --seeds 1..20` 25/25 + acceptance 7/7 before and after (A4 RICKY
   vs optimal 5 -> 6 / 20, A3 novice vs L1 16 -> 17 / 20); probe_determinism fixture final hashes: 2 of 6 random-input streams
   change (they press and release over motions), 0 mismatches. 2b: the 18 new checks fail 8 / 18 on the parser without 2b (the
   super cases: `cue_m > cue2`), 18 / 18 with it.
### §35.23 CHANGED(fix_view): presented turns, step feet, the wall swing, real tops, bloom that spares bodies, popups, super cost (2026-10-01; view only - additive, no §16 / §17 / §18 signature broken, the sim untouched)
Evidence: `_harness/_reports/progress_fix_view.md` (every number below is quoted there), `lookshots.py --game --only fixview`
(legacy vs fixed in ONE page through harness switches on the live BoutView: `FighterView.smoothTurns / stepSync`, `BoutView.realTops /
legacyLook()`, `FightCamera.legacySwing / softPullOn / bottomMargin / feetDepth`, `BrawlView.legacyPopups`; report
`lookshots_fixview_final.json`), lab `__LAB__.frameCost / wrapCost`, shots `_shots/fixview_*`. Files carry `CHANGED(fix_view)` notes.
Verifier defects D2, D6, D10, D13, D5 (renderer side; the stage lights are §35.22), modes D7, G9.
1. **Presented yaw (D2, `view/turn.ts` + fighters.ts).** The sim re-faces with a snap (35-180 deg in one sim frame after a whiffed /
   stepped move, hitstun, knockdown, a throw, a BACK HIT turn); the view PRESENTS the body yaw through a per-fighter smoother that
   advances per SIM frame (BoutView sets `FighterView.simFrame = MatchSnap.frame`): a sim change <= 12 deg / frame (auto-face while
   walking / circling / stepping, a move's own tracking) shows at once; a bigger one turns with acceleration 14 deg / frame^2, capped
   45 deg / frame, decelerating into the target (20 deg -> 2 frames, 35 -> 3, 115 -> 6, 180 -> 7). Hit reads: the frames to the
   fighter's own first active frame (`moveName` + `moveFrame` vs the move's startup; system moves by move frame 5) force the turn to
   land by then, and every active frame shows the sim yaw. Safety: the same sim frame again = no change; a backwards frame, a gap > 8
   frames, a turn still open after 12 frames, a new round, `resetPresentation()` or a root jump > 0.6 m (teleport) snap to the sim yaw;
   a cinematic yaw override is shown as given and followed. The mirror (facing -1) flips with the sim facing, except that a flip arriving
   with >= 60 deg of turn left waits until half the turn is done. Measured (real game, frozen + stepped): krane 5M stepped 35.5 deg pop
   -> 14.0 / 17.4 / 4.1 deg; johnny hook_m stepped 145.3 -> 6 frames, max 38 deg / frame; a back throw's 180 on BOTH fighters -> 7
   frames, max 42, the mirror flipping past half way; Zambini's vanish (§35.20 item 4) snaps with the teleport, bruno's 180 re-face
   turns in 7 frames.
2. **Sidestep feet (D6, `view/stepanim.ts`, `view/legik.ts`).** Measured: the clip played at (k - 1) / 60 on sim step frame k and the sim
   blend is 0 on the entry frame (a pure idle pose while the root has moved 13 % of the arc). Now: the clip time on step frame k = where
   the clip's OWN lateral travel (clips.json `rootLat`, read raw - core/data.ts drops it) reaches the sim's progress 1 - (1 - k / 15)^2;
   the step clip has full weight from the entry frame; a two-bone leg IK in root-local space scales the ankles' lateral offsets by
   arc / clip travel (snapshot `step.dist`, else fighters/<id>.json `step.distM`, else system 0.85 - §35.20 item 1) with a reach clamp
   (feet stay on the floor) and a hip drop <= 22 % of the hip height for long strides, eased out over the last 3 step frames, undone
   before the next pose. Slide of a foot measured only while the clip's own (unstripped) foot is planted: johnny 0.377 -> 0.044 m,
   bruno 0.472 -> 0.086, freak 0.380 -> 0.071, krane 0.567 -> 0.070, boneyard 0.479 -> 0.013, rerun 0.584 -> 0.159 (its 1.715 m arc
   is 2.07 x the clip's stride, beyond the legs' reach: a longer baked stride is the ASSETS lever).
3. **Wall swing (D10, camera.ts).** Soft pull: a lens just outside the ring wall dollies in along its view line to stay 0.15 m inside
   (<= 0.9 m, FOV widened to hold the framing; capped, never released abruptly); the swing's cost counts only what the pull cannot fix,
   the 0.9 m wall-line penalty applies outside the ring only, a hysteresis band holds a running swing; the swing angle is a critically
   damped spring (omega 4.5 rad/s, acceleration cap 12 rad/s^2) - the old exponential ease started a swing at 1.2 deg / frame in one
   frame. Twin cameras fed the real snapshots at 60 Hz, P1 circling P2 near the centre, all 5 arenas: legacy swing -17..+24 deg, azimuth
   acceleration up to 4.25 deg / frame^2, lens 0.28-0.36 m beyond the wall; fixed swing 0, max 0.236 deg / frame^2, lens inside (pull
   <= 0.38 m, FOV <= 38). At the wall (P1 backed in, circling toward the camera) the swing still engages (rust up to +19.8 deg) with max
   azimuth acceleration 0.166 vs 3.69 deg / frame^2, occluded 0.
4. **Real tops, HUD-safe frame (D13, `view/bodytop.ts`, camera.ts, bout.ts).** Each body's neutral silhouette top is measured at load
   (skinned vertices binned to their dominant bone, 26-direction support points per bone, the highest posed point over idle / walks /
   crouch / dashes / land / the §35.5 step clips - block poses excluded so a guard does not widen every shot): THE FREAK 2.83 m (tools
   measure 2.79), bruno 1.99, johnny 1.78. The camera frames max(that top, the live head; airborne: raised hands) and keeps the feet
   above 7 % of the frame (was 4 %), measured 0.25 m x body scale nearer the lens than the root. FREAK vs bruno sidestep at 2.4 m: the
   highest posed point sat 14.4 % of the frame behind the HUD band and a foot was off the frame bottom; now under the band with the
   feet in frame (camera 5.6-6.1 m for that pair; johnny vs bruno 4.41 -> 4.59 m). Read-back `info().framing {tops, feet, live,
   liveFeet, safeTop, topM}`.
5. **Bloom / exposure (D5 renderer side, toon.ts, post.ts, `view/lightlevel.ts`; composes with the §35.22 stage-light change).** While
   `BLOOM_MASK.uMaskOn` is 1 (only inside the bout's composer render) the toon bodies and their outline hulls write alpha 0; the bloom
   high-pass excludes alpha-0 pixels and caps the luminance of what blooms (soft knee from threshold 1.0, cap 2.4); UnrealBloomPass no
   longer adds itself - GradePass composites `tBloom` weighted by the pixel's alpha and writes alpha 1 (an alpha-0 frame reached the
   canvas once in testing: black bodies in every capture). The light a toon body receives is capped by the stage light pool's level at
   the body (sum x exposure, cap 6.5): with the committed lights only control_room's 320-cd ring spot exceeded it (scale 0.44-0.56 near
   the centre); with §35.22's lights it is a guard that no stage reaches. Measured with the COMMITTED lights, 5 arenas x 8 orbit angles
   at the desktop default (high + bloom), blown body pixels max / mean: control_room 27.21 / 7.87 % -> 4.99 / 0.93 %, wheel 3.29 /
   0.56 -> 1.53 / 0.43, butcher 2.29 / 0.20 -> 1.55 / 0.12, rooftop 1.25 / 0.08 -> 1.14 / 0.07, rust 0.08 / 0.03 -> 0.09 / 0.03; all
   80 shots read (stage glows kept, no flare over a body). control_room at quality med / low: <= 0.02 % either way (no bloom there).
   Final evidence run with §35.22's lights (`lookshots_fixview_final`), legacy -> fixed, max / mean: control_room 0.01 / 0 -> 0.01 / 0 % (the stage-light change removes the source; the light cap no longer engages anywhere, lightK min 0.98), butcher 1.65 / 0.10 -> 0.96 / 0.06, wheel 1.52 / 0.41 -> 1.50 / 0.40 (body saturation 0.570 -> 0.640: less bloom haze on the bodies), rust 0.03 / 0.01 -> 0.04 / 0.01, rooftop 0 / 0 -> 0 / 0.
6. **BRAWL popups (D7 modes, bout.ts, brawl.ts).** The sim emits each goon's HIT / THROW / GOON_DOWN right before the SCORE it earns: a
   hit / KO popup now sits over that goon, a crowd bonus over the goons that swing hit, combo / parry / heckle scores over the player;
   every frame the popups are laid out (the wanted spot clamped into the safe area - under the HUD band + 0.02, above the bottom 10 %,
   6 % in from the sides - then a newer popup overlapping an older one moves below it, above when below is full) and put back in the
   world at the anchor's depth. Same seeded BRAWL run (score 682): legacy 335 popup samples in the HUD band, 15 overlapping pairs; fixed
   0 / 0 (final evidence run: 289 / 13 -> 0 / 0).
7. **Super cost (G9).** Lab `frameCost` (sim / view / render + gl.finish per frame, cold vs warm passes, no rAF clock): no program link,
   texture or geometry creation anywhere in the super window. control_room's view frame cost ~5x rust's: its CRT feed (the only monitor
   feed of the 5 sets) redrew 900 noise rects with per-dot colour strings + 53 scanline rects per panel every 6th frame (3.08 ms) ->
   cached noise frames + one scanline overlay (0.12 ms), feeds start staggered; super-window view CPU 544 -> 149 ms cold, 298 -> 102 ms
   warm (229 frames). The first PRIME TIME of a page spent 12.2 ms in its start frame (first-run JIT + plan compile) -> `warmPrime()`
   compiles and samples both fighters' cinematic plans at load (3 ms): cold start frame view 18.8 -> 6.6 ms. Lab perf harness: the
   window wrap restores a saved state (`save` / `load`; the frame after a wrap left out) - the old in-frame re-simulation measured only
   0.9-2.2 ms, so it was NOT the source of the reported 80-100 ms spikes; perfcheck.py keeps per-window attribution (worst frames with
   section / GPU / renderer / heap deltas, LoAF) and takes `--chrome-arg`. Frame times this session are CONTAMINATED (3-6 other
   automated Chromes, CPU 47-100 %, the Intel iGPU busy with other sessions + DWM + the DisplayLink host: its frames took 0.2-15 s, no
   usable sample). rAF frame times, super window (Lv3 PRIME TIME, johnny vs bruno on a 38.2 deg line), on the dGPU (`--chrome-arg=--force_high_performance_gpu`), vsync on (the display paces 20 ms), every run labelled CONTAMINATED by perfcheck (3-4 other automated Chromes, machine CPU 47-98 %; the IDLE windows of the same runs spiked too: idle p99 up to 300 ms, max 900 ms). Windows that were not starved pace at the display: butcher_block p50 20.0 / p99 20.9 / max 21.5 ms (both windows; idle 20.8), rooftop window 1 20.0 / 20.8 / 21.0, control_room 20.0 / 20.8 / 21.2 (`perfcheck_fixview_g9_cr_new_r1` window 1), rust_theater best window 20.1 / 60.5 / 80.2. Starved / spiky windows: rooftop window 0 p99 100.2 (frames of 100-220 ms at cinematic frames 45-54 whose own CPU is <= 5.4 ms and GPU <= 5.1 ms, idle window clean), control_room p99 80-360, rust_theater 139.7-379.9, wheel_of_pain 0 and 78 frames in 8 s (p50 40). GPU timer p99: butcher 5.0, rooftop 5.3, control_room 11.4 / 11.5 / 21.2 / 32.0 (four runs, 32.0 in the starved one; baseline 14.0 / 18.1), rust 20.4 / 22.8, wheel 23.6 / 40.4 ms (contention inflates the timer itself: idle frames read up to 45.9). control_room A/B vs the BASELINE (314ec728's runtime, same flags, interleaved): baseline clean windows p99 20.8 too; per-frame JS p90 7.5-8.4 -> 6.0-7.9, p99 9.7-12.3 -> 8.3-11.1 ms; the A/B spike frames carried CPU <= 6 ms and GPU <= 12 ms, the longest LoAF (706 ms) held 5 ms of the page's script. G9 itself (VIEW3D's p99 80 ms on the Intel iGPU) could NOT be re-measured: OPEN until a quiet machine re-runs `perfcheck.py --headless --stages control_room,rust_theater,butcher_block,wheel_of_pain,rooftop --circle 60 --ab 2` without the dGPU flag.
8. **Gates (2026-10-01):** `npm run typecheck` rc 0, 0 errors (09:45, `fixview_typecheck_final.log`). `npm run probe` on the shared tree: 21/23 PASS, rc 1 (09:48 `fixview_probe_final.log`, re-checked 09:51 `fixview_probe_final_recheck.log`): FAIL probe_3d 110/111 - "D4: a grab caught at range releases where a touching one does (johnny throw_f 1.41 / 1.41 m, bruno walk_in_m 0.00 / 2.13 m)"; FAIL probe_audio 16/17 - router "unhandled #47". Neither comes from this lane: no probe imports runtime/src/view (grep of _harness/*.ts + fixtures), the same suite passed 23/23 at 09:11 (`fixview_probe.log`), and in between data/fighters/bruno.json + kits/bruno.py (09:42, a grab-range change in flight) and core/sim inputs.ts / motion.ts (09:26-09:29) changed; #47 is EV3D.BACK_HIT, which the router handles but probe_audio's event-name table (EV + EVX only) does not name - the scripted bout now produces a back hit. `lookshots.py --game --only fixview` RESULT OK (0 fails, 0 console / page errors); `--fixview top` re-run OK after the measureTop() move.
