# SQUISH KEEPER

> A squishy toy that squishes back.

**SQUISH KEEPER** is an original 3D soft-body collectible toy for the browser. Every squishy is a jelly body simulated in real time: poke it,
squash it, pull it into a long lobe, let go and watch it spring back. Squishing and stretching fills a ring; a full ring drops a capsule; a capsule
holds one of **50 squishies in six rarities** (Common to Mythic) that you keep in your **Hoard**, merge into rarer ones, cut into pieces, and photograph.
No combat, no streaks, no countdown timers. Desktop and phone. The game and its portal slug are **Squish Keeper** / `squish-keeper`; the folder and the
npm package keep the working title `wobblehoard`.

## Run it

```bash
npm install && npm run dev
```

Open **http://localhost:5360** (fixed, `strictPort`: the harness expects it). A browser with **WebGL 2** is required. Node 22.18 or newer
(`package.json` `engines`; the probes run `.ts` files directly under `node`).

| script | what it does |
|---|---|
| `npm run dev` | Vite dev server on :5360 (no-store headers; `?dev=1` exposes the debug hook `window.__WH__`; harness endpoints `/__shot`, `/__report`) |
| `npm run preview` | serves the built `dist/` on :5361 |
| `npm run build` | production build into `dist/` (`base: './'`, hashed assets, no inline script or style). Fails when a size gate is over budget (see Gates) |
| `npm run typecheck` | `tsc --noEmit -p tsconfig.json` over `src`, `_harness` and `vite.config.ts` |
| `npm run probe` | every `_harness/probe_*.ts` under plain `node`, one after the other; exits non-zero if any fails. A long run; the two longest probes run their `--quick` set here |
| `npm run check` | `typecheck`, then `probe` |
| `npm run probe:physics-film`, `probe:audio`, `probe:render`, `probe:shell` | the four browser harnesses (Chromium with software WebGL; Playwright is **not** a dependency, it is found in `node_modules` or the global install). `npm run probe:browser` runs audio, render and shell. Arguments pass after `--`, for example `npm run probe:shell -- --quick` |
| `npm run deploy:dry` | builds, then prints the upload plan of `pipeline/deploy_game.py` without uploading |
| `npm run deploy` | check, build, upload. **The owner's step; never run by a build agent** (see `_handoff/reports/PUBLISH_PREP.md`) |

A single probe is `node _harness/probe_screens.ts` (and so on for every `probe_*.ts`).

## How to play

You start with one squishy on a felt mat. The toolbar at the bottom holds **Hoard**, **Hand**, **Cut** and **Snap**, and the **Table | Float** switch.

- **Hand** (key `1`). Tap to poke. Press and hold to squash it flat, then let go. Press on it and drag away to pull it into a long lobe; let go and it
  snaps back and jiggles to rest. **Shift and drag** (or two fingers) pulls both sides at once. When a pull is stretched all the way, press **Shift** to
  **lock** it where it is; press the lobe, or **Esc**, to let go. Taps pay nothing: squeezing and stretching fill the meter.
- **Cut** (keys `2` or `C`). Swipe across the squishy to slice it into pieces, or press **Split in two**. Two styles: **Clean cut** (each piece is the
  real part of the squishy on its side of the slice) and **Minis** (each piece is a complete smaller copy). Pieces can be cut again and again; there is
  no fixed piece limit, only a safety ceiling of 64 live pieces that protects phones (`PIECE_CEILING`, `src/shell/cut.ts`). **Reconnect all** joins
  everything back into the original.
- **Snap** (keys `3` or `S`). A photo mode: the interface hides, you turn and zoom the view, pick a backdrop, and **Save photo**.
- **Table | Float** (key `G`). Table lets the squishy rest on the mat; Float lets it drift in the air.
- **Capsules.** When the ring is full, a capsule drops in. Press **Open**, or hold the capsule, for a reveal that grows grander with the rarity.
  The odds are fixed and shown in the Hoard: Common 76.3 %, Uncommon 13 %, Rare 6 %, Epic 2.8 %, Legendary 1.4 %, Mythic 0.5 % (`src/core/rarity.ts`; no
  hidden adjustment).
- **The Hoard** (key `H`). Every squishy you find, 50 kinds (14 Common, 11 Uncommon, 10 Rare, 7 Epic, 5 Legendary, 3 Mythic). It also holds the daily gift
  (pick one of three), a short list of daily tasks (with a weekly limit) and the **merge pad**: press and hold **Merge** on two spare copies of one kind
  and the result can come out rarer (up to 10 merges a day; Mythic squishies cannot be merged). The shelf holds up to 100 squishies and lives in this browser.
- **Trophies.** 20 achievements (8 Bronze, 7 Silver, 3 Gold, 2 Diamond; two are hidden until earned; 355 XP in total, counted by the portal when signed in).
  They live in `src/data/achievements.json`, which the evaluator (`src/core/achievements.ts`) and the portal seeder read.

### Keys

| key | does |
|---|---|
| Space | Poke; hold to squish |
| Arrow keys, `+` / `-` | Look around, zoom |
| `1` / `2` or `C` / `3` or `S` | Hand / Cut / Snap |
| `H` | Hoard |
| `[` `]` | Switch squishy |
| `G` | Gravity: Table or Float |
| `M` | Sound on or off |
| `F` | Full screen |
| `P` | Menu (Resume, Settings, Trophies, How to play, Credits) |
| `?` | How to play |
| `Esc` | Close what is open, or back to the Hand; lets a locked pull go |
| Shift + drag, Shift | Pull both sides; lock a fully stretched pull |
| Right-drag, wheel | Turn the view, zoom (mouse) |

Touch: tap = poke, press and hold = squish, press the squishy and drag outward = pull, two fingers on it = pull both sides, drag empty space = turn the
view, pinch = zoom. The single-letter shortcuts can be switched off in Settings (Keyboard shortcuts). The wording above is the in-game How to play
(`src/ui/screens/screenCopy.ts`).

## Accessibility and privacy

- **Keyboard**: the whole toy plays from the keyboard (Space, arrows, `+`/`-`, the tool and Hoard keys); a focused control owns its own keys.
- **Calm effects** (Settings): no camera moves, flashes or shake, fewer sparkles. `prefers-reduced-motion` turns the same on unless the player chose otherwise.
  Also in Settings: screen shake, skip animations, fast open, haptics, button sounds, quality (Auto, Low, Medium, High).
- **Contrast modes**: `prefers-contrast: more` and `forced-colors: active` have their own token sets (`src/ui/a11y.css`).
- **Screen readers**: one polite live region announces mute, gravity, capsule and reveal messages (`src/ui/announcer.ts`).
- **Touch targets** are sized for fingers and the layout is checked down to a 358 x 201 portal frame; the verification reports are in
  `_handoff/reports/UI_VERIFY_*.md` and the open minors are listed in `_handoff/STATUS.md`.
- **Reveals** are designed to a flash budget (CONTRACT section 6, gate G7), with none in Calm.
- **Privacy**: "Your squishies live in this browser. Signed in to ForgeFlow Games, only your trophies are shared with the site." The game makes no network
  request of its own (the page CSP is `connect-src 'self'`). Inside the portal frame it posts one kind of message to the page: the slug of a trophy you
  earned, and only when you are signed in; the "who is signed in?" question carries no data about you (`src/portal/bridge.ts`, pinned by `_harness/probe_portal.ts`).
  Saves are `localStorage` keys `wobblehoard:v1:settings`, `wobblehoard:v1:ach` and `wobblehoard:v2:hoard` (`wobblehoard:v1:profile` is only read, for older saves); never rename them.

## Tech

- **Three.js 0.186** (WebGL 2, `MeshPhysicalMaterial` for the translucent jelly), **TypeScript** (7.0.2), **Vite** 8.3. No framework.
- **Custom soft body**: XPBD with shape matching on the CPU, about 640 particles for a whole squishy, deterministic, no WASM, runs unchanged under `node` for the probes.
  Cut pieces are real separate bodies (`src/physics/piece.ts`, `region.ts`).
- **Procedural WebAudio**: every voice and the music are synthesised at runtime and rendered offline by the audio probe. No audio files.
- **No outside assets**: no image, font, audio or model files. The jelly lettering, icons and art are drawn in code. The only file besides code in `public/` is
  the store thumbnail, plus `game_meta.json` and `credits.txt`.
- **Strict CSP**: no inline script or style; the recommended header is in `index.html`; `_harness/browser_shell.mjs` serves `dist/` with it and fails on any violation.

### Layout

| folder | what |
|---|---|
| `src/core`, `src/data` | pure TypeScript with no DOM: genome, rarity, drops, meter, merge, achievements, settings, saves; the 50-species catalog, materials, shapes, palette, `achievements.json` |
| `src/physics` | the soft body, cut pieces and regions, broad phase |
| `src/render` | the Three.js stage, jelly material, face, capsule and merge ceremonies, effects, band framing |
| `src/audio` | the synthesised voices, music, cut and ceremony sounds |
| `src/collection` | the Hoard store, capsules, merge, tasks (device-only) |
| `src/input`, `src/shell` | pointer, gesture and keyboard input; the wiring: boot, game loop, cut, HUD binding, pause |
| `src/ui` | the DOM interface: kit, toolbar, Hoard, screens, the jelly lettering |
| `src/portal` | the ForgeFlow bridge client and its copy |
| `_harness` | node probes (`probe_*.ts`) and the Chromium harnesses (`*.mjs`, `portal/`) |
| `_spec` | the contract and design documents (`CONTRACT.md`, `DESIGN.md`, `UI.md`, `CUT3.md`, ...); where prose and `src/contracts.ts` disagree, the code wins |
| `_handoff` | status, briefs, reports and the publication checklist (`STATUS.md`, `reports/PUBLISH_PREP.md`) |

## Gates

The contract's gate table is `_spec/CONTRACT.md` section 6; the commands are in section 10. The size gates are enforced by `vite build` itself
(`vite.config.ts`):

- **G0**: the whole build output (public files included) under **3 MB** raw.
- **G0b**: the first-play files (html, js, css, except `later-*` chunks) under **600 KB** gzip.

Last measured on 2026-10-10 with the store thumbnail in `public/`: `[G0] build output 1934 KB of the 3072 KB budget`, `[G0b] first-play download 435 KB gzip of the 600 KB budget`.
Also: `npm run typecheck` clean (exit 0 on 2026-10-10); `probe_screens` 43/43, `probe_portal` 81/81, `probe_trophies` 31/31. The full `npm run probe` and the browser
harnesses carry a few known red rows that are listed, with owners, in `_handoff/STATUS.md`.

## Credits and licences

An original game by **ForgeFlow Games**. All sound is synthesised in your browser and all art is drawn in code.

- **three.js** (MIT) draws the 3D jelly. **Vite** (MIT) and **TypeScript** (Apache-2.0) build it.
- The three.js licence notice, as shipped in the package (`node_modules/three/LICENSE`, r186), travels with the game: in the in-game Credits screen and in `credits.txt`.

> The MIT License
>
> Copyright © 2010-2026 three.js authors
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
