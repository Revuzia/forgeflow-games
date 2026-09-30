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
