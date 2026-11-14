# HIT PARADE - live on Knockout 13

> Every hit's a hit.

**HIT PARADE** is an original 3D ring versus fighting game (Tekken / Soul Calibur family: the two fighters face each
other inside a 360-degree ring, sidestep and circle-walk around each other, and the camera orbits the pair) wearing a
brutal late-night TV-show skin: an arcade ladder vs the CPU up to a mini boss and the host himself, local versus,
online versus with rollback netcode, and training. Comic splatter (or sparks / confetti), never realistic gore.

The build contract is `_spec/CONTRACT.md` (interfaces, ownership, gates); the intent is `_spec/DESIGN.md`; the
owner's brief is `_spec/BRIEF.md`; measured research lives in `_research/`.

## Run it

```bash
npm install && npm run dev
```

Open **http://localhost:5320** (fixed port, `strictPort`: the harness expects it). A browser with **WebGL 2** is
required.

| script | what it does |
|---|---|
| `npm run dev` | Vite dev server on :5320 (serves `runtime/`, no-store headers, `/__shot` + `/__report` harness endpoints) |
| `npm run build` | production build into `dist/` (`base: './'`, no source maps) - the only thing ever deployed |
| `npm run preview` | serve `dist/` on :5321 |
| `npm run typecheck` | `tsc --noEmit` over runtime, harness probes and config (gate G0) |
| `npm run probe` | every `_harness/probe_*.ts` under plain `node` (gates G1-G3, G10, G11) |

Agents testing while other lanes edit use a frozen server: `HP_FROZEN=1 npx vite --port <lane port> --strictPort`
(no HMR, no file watching - so restart it after changing source yourself).

## Deep links (share links and harnesses)

`/?mode=versus&p1=johnny&p2=bruno&stage=rust_theater&seed=1&cpu2=3&autostart=1&dev=1`

| key | meaning |
|---|---|
| `mode` | `versus` (default) · `training` · `arcade` (THE SEASON with `p1`) · `brawl` · `heckler` · `online` |
| `p1`, `p2` | fighter ids (`data/fighters/<id>.json`) |
| `stage` | stage id (default: P2's home stage) |
| `seed` | sim seed (uint) |
| `cpu1`, `cpu2` | CPU level `0..8`, `-1` / absent = human (training: P2 defaults to 0, the dummy) |
| `scheme1`, `scheme2` | `0`/`simple` or `1`/`classic` |
| `autostart=1` | skip the PRESS START card |
| `room=CODE` | join an online room (`relay=1` forces the relay tier, test only) |
| `dev=1` | enables `window.__HP__.dev.*` |
| `touch=1` / `touch=0` | pin the input method |
| `quality=low\|med\|high` | this page only (never saved) |

Any deep-link key skips the title screen; a bare URL opens it.

## Controls (defaults; everything is remappable per player)

| | P1 keyboard | P2 keyboard | gamepad (Standard mapping) |
|---|---|---|---|
| move / jump / crouch | W A S D (Space = up) | arrow keys | left stick (8-way, 30 % dead zone) or d-pad |
| L / M / H | J / K / L | Num 1 / 2 / 3 | X / Y / RB |
| SPECIAL | I | Num 5 | A |
| ASSIST (hold) | U | Num 4 | B |
| THROW (= L+M) | H | Num 0 | LT |
| PARRY (= M+H) | O | Num 6 | LB |
| IMPACT | P | Num + | RT |
| TAUNT | Y | Num * | SELECT |
| STEP IN / STEP OUT (tap = sidestep, hold = circle-walk) | Q / E | Num 7 / Num 9 | right stick up / down |
| pause | Esc | - | START |

SIMPLE (special button + direction) and CLASSIC (motion inputs) share every timing window; the control type is a
per-player setting. Blocking is holding back. The input layer cleans SOCD (left+right = neutral, up+down = neutral)
and latches every press for at least one 60 Hz tick; STEP IN + STEP OUT held together = neutral too. STEP IN circles
away from the camera, STEP OUT toward it (CONTRACT §35.2); LEFT / RIGHT stay screen-relative as the camera orbits.
Touch: two STEP buttons (IN / OUT) above the stick.

## Layout (CONTRACT §3)

```
runtime/            Vite root: index.html (boot guard) · public/ (game_meta.json, manifest, icons) · src/
  src/main.ts       boot: params -> WebGL2 -> loading card -> data -> renderer -> menus -> Game
  src/game.ts       the orchestrator: menus intents -> bouts, the 60 Hz loop, pause / forfeit / results, THE SEASON, online
  src/app/          loop.ts (fixed 60 Hz step, pause gate, ~60 fps render cap) · flow.ts (phases, SEASON ladder slots)
  src/input.ts      keyboard + gamepad (+ touch bits) -> one 16-bit word per player per tick
  src/testsurface.ts  window.__HP__
  src/core/         THREE-free deterministic sim (SIM), CPU (AI), rollback (NET)
  src/view/ ui/ audio/ net/ touch/   the other lanes (CONTRACT §14)
  lab/<lane>.html   dev-only lab pages (never linked, never built)
data/               every number and every string the game reads
art/ tools/         Blender-headless asset pipeline + compressed GLBs
_harness/           gates: bootcheck.py bootguard.py menus.py playtest.py perfcheck.py mobile.py ... + probe_*.ts
```

## Harness (lane SHELL's gates)

```bash
python _harness/bootcheck.py --headless              # G4: a deep-linked versus bout by REAL keys (walk, 5L hit, 5S special)
python _harness/bootcheck.py --lab --headless        # SHELL lab: loop / input / gamepad / settings / save / __HP__ / flow
python _harness/bootguard.py                         # G7: boot-guard cases a b1-b4 c d f e1-e3 on a temp build + dev server
python _harness/bootguard.py --shell-only            # the same cases with the SHELL-only entry (HP_SHELL_ENTRY=1)
python _harness/build_icons.py                       # the four install icons from the favicon mark (no spend)
```

`window.__HP__` (CONTRACT §12): `version, state(), match(), fighters(), events(n), shot(name), perf(), audio(), net(),
touch(), input(), dev: { startMatch(cfg), setInputs(p, word, frames), step(n), setHp(p, v), setMeter(p, k, v),
freeze(on), goto(screen), cpu(p, level) }` - the dev functions throw unless the page was loaded with `?dev=1`.
`window.__PAUSE__ = { pause, resume, toggle }` exists while a bout is loaded.

## Stack

Three.js 0.186 + TypeScript 7 + Vite 8 (the dyefield stack), Blender 5.1 headless for authored art, glTF + meshopt.
The fixed-step loop, shader warm-up and frame profiler come from blocktooth; the boot guard, input-method detection,
settings store, audio engine and harness from dyefield (`_research/TECH_REUSE.md`).
