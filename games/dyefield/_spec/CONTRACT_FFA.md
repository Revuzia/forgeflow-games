# DYEFIELD — FFA mode contract (owner request 2026-09-28)

The owner wants: "an OPTION of 4 v 4, but also … a FFA version." Teams 4 v 4 stays the default and
must be byte-for-byte unchanged in behaviour: the same hashes where feasible, the same gates. FFA
is a second mode. The orchestrator owns this file.

## F1 Rules
- `MatchMode = 'teams' | 'ffa'` (`core/types.ts`). **Teams**: the current game (2 crews × 4).
  **FFA**: 8 runners (the human + 7 bots), each its own crew; `TeamId` becomes a number 0..8
  (0 = neutral, 1..8 = crews). The atlas team byte already holds it.
- **The FFA palette** (`data/teams.json → ffa`) has 8 crews, each with the same fields as a team:
  `id, key, name, dye, dyeDeep, dyeGloss, ui, uiInk, mark, markGlyph`.
  - Hues: amber `#FF8A1F` ◉ · violet-blue `#5B4BF0` ▲ · lime `#7ACC29` ■ · magenta `#E0409E` ◆ ·
    sky cyan `#22B8E0` ★ · coral red `#EE4A3C` ✚ · sunflower `#F2CF1A` ⬟ · jade `#2EBF8F` ⬢.
  - The name of an FFA crew is the runner's name; the colour/mark labels are only for UI chips.
  - The human's FFA colour defaults to amber (the loadout may let the player pick any of the 8;
    bots take the rest deterministically).
- **Scoring**: the weighted coverage share per crew (`Painter.coverageByTeam()`), and the winner
  is the largest share with a strict comparison. A tie for first is a draw between the tied crews.
- **Spawns**: `maps.json → <map>.ffaSpawns` holds 8 `{pos:[x,y,z], yaw}`, generated from the nav
  graph by farthest-point sampling over core nav nodes.
  - A spawn must stand on floor (ny ≥ 0.9), with ≥ 2.5 m clearance to walls/edges.
  - It must not be on a grate, conveyor, spring, oob volume or the team pads' footprint (the A/B
    pads stay as neutral scenery in FFA).
  - All spawns must be mutually reachable, and they must be *fair*: the spread of each spawn's
    nav distance to the map centroid / nearest other spawn stays within ±15 % of the mean.
  - Record the generator script at `_harness/gen_ffa_spawns.ts` and write its output into
    maps.json (authorized, with a `_changes` note).
  - Each spawn is a small runtime-rendered **drop pad** (radius 1.6 m) in the owner's colour. It
    counts as that runner's own dye (slick + refill), and other runners are pushed out of it.
- **Respawn** at your own FFA pad, 3 s.
- **Bots**: everyone else is an enemy. Keep the §10.3 fairness rules. Paint-hungry goals still
  count every non-own texel as a target. Flee/refill uses own dye or own pad. Kit tactics are
  unchanged.
- **Teams mode** keeps `spawns.A/B`, the pads, the roster ids 0-3 SUN / 4-7 GULF and every
  existing gate.

## F2 Rendering
- **The GPU paint encoding (both modes)**:
  - R = painted amount (255 on any crew's texel, 0 neutral);
  - G = crew id × 16 (exact; read with `texelFetch` on the nearest texel(s));
  - B = noise;
  - A = surface/gutter mask.
  The dye shader gets its organic edge from the bilinear R. Its colour comes from a
  `uCrewCol[9]` / `uCrewDeep[9]` / `uCrewGloss[9]` palette, blended bilinearly over the 4
  nearest texels' crew ids, so crew-vs-crew borders stay smooth. The friendly = `crew ==
  uViewerTeam` gloss rules and the colorblind rules stay. Teams mode renders visually the same as
  now: verify with an A/B screenshot and the abperf bench (≤ 5 % cost change).
- Runner tint, FX, the minimap, the juice vignette and the name tags take their colour from the
  runner's crew palette entry, never from `sun`/`gulf` constants.

## F3 UI
- **PLAY**: a MODE selector, **TEAMS · 4 v 4** / **FREE-FOR-ALL**, persisted.
  - The title mode line stays exactly `Harbor Cup • 4 v 4` in teams mode. In FFA it reads
    `Harbor Cup • Free-for-all` (new copy; the owner asked for FFA).
  - LOADOUT: the crew toggle becomes, in FFA, a colour pick of the 8 (the chip + mark).
- **FFA HUD**: the timer pill; your own share + mark (left); a live **top-3 leaderboard** (colour
  chip, mark, name, %); 8 small crests (colour + mark, downed ✕ + count); the special gauge; kill
  feed names in crew colours using the brief string `{A} washed {B}`; `WASHED BY {name}`; the
  low-tank string; the minimap in 8 colours.
- **FFA victory slate**: the brief string `THE HARBOR CHOSE A COLOR.`, the winner (name + colour
  + mark), a top-3 podium and the full standings with %. It has the tally animation, PLAY AGAIN and
  LOBBY. The victory/defeat music cue follows whether the human won.
- Query param `?mode=ffa|teams` (the default is teams).

## F4 Gates (both modes; teams = regression)
- G0 typecheck; all existing probes green in teams mode.
- `probe_match --mode ffa`: 8 crews; the countdown freeze; horns; coverage shares sum to 1; a
  winner; determinism.
- `probe_bots --mode ffa --map {pier18,lockwell,cinder}` (3 fixed seeds; validate 8 once):
  - every crew covers ≥ 4 %;
  - neutral < 60 %;
  - ≥ 10 washes;
  - no stuck bot;
  - no jitter over the limit;
  - deterministic;
  - < 25 s wall.
- `gen_ffa_spawns` fairness report per map.
- Browser: `playtest.py --mode ffa --map <id> --kit <id>` real input (countdown → fire →
  slick/refill on own dye → fight → the FFA victory slate with standings); `menus.py` covers the
  mode selector and the FFA colour pick; bootcheck in both modes. 0 errors.

## F5 Lanes
| lane | owns |
|---|---|
| **CORE** | `core/types.ts`, `core/data.ts`, `data/teams.json` (+ffa), `data/maps.json` (ffaSpawns only), `core/paint/painter.ts` (coverageByTeam), `core/paint/minimap.ts` (palette), `core/match/*`, `core/runner.ts` (pad rule), `core/bots/*`, `_harness/gen_ffa_spawns.ts`, `_harness/probe_match.ts`, `_harness/probe_bots.ts` |
| **VIEW** | `view/paintlayer.ts`, `view/surfaces.ts` (dye section only), `view/players.ts`, `view/fx.ts`, `view/mapview.ts` (FFA drop pads), `ui/juice.ts` |
| **UI** | `ui/menus.ts`, `ui/menus.css`, `ui/hud.ts`, `ui/slates.ts`, `ui/styles.css`, `ui/settings.ts`, `game.ts`, `main.ts`, `testsurface.ts`, `input.ts`, `_harness/{playtest,menus,bootcheck}.py` |

## F6 `CHANGED(CORE)`: the FFA core interface (lane CORE, additive; teams mode keeps every old signature)
```ts
// core/types.ts
export type MatchMode = 'teams' | 'ffa';
export const MATCH_MODES: readonly MatchMode[];                       // ['teams', 'ffa']
export function parseMatchMode(raw: string | null | undefined, fallback?: MatchMode): MatchMode;  // case-insensitive; 'free-for-all' → 'ffa'; else fallback ('teams')
export type TeamId = number;   // 0..8 (was 0 | 1 | 2; a plain number so pre-FFA 3-tuple indexing stays valid); TEAM_NONE / TEAM_SUN / TEAM_GULF unchanged
export const FFA_CREWS_MAX = 8;                                        // crews 1..8
export const CREW_SLOTS = 9;                                           // array length for "by crew id" (index 0 = neutral)

// core/data.ts  (data/teams.json gains "ffa": an ARRAY of 8 crews, ids 1..8, same fields as a team minus `side`)
export interface CrewDef { id: TeamId; key: string; side?: Side; name: string; dye: string; dyeDeep: string; dyeGloss: string;
  ui: string; uiInk: string; mark: string; markGlyph: string }      // TeamDef is a CrewDef with side set
export const FFA_CREWS: CrewDef[];                                     // teams.json ffa, by id 1..8 (amber, violet, lime, magenta, sky, coral, sunflower, jade)
export function crewDef(mode: MatchMode, team: TeamId): CrewDef;       // teams → teamById; ffa → FFA_CREWS; 0 or unknown throws
export function crewDyeHex(mode: MatchMode, team: TeamId, colorblind: boolean): string;  // NEW form; the old
//   crewDyeHex(team, colorblind) still compiles and means teams mode. FFA has no colorblind swap (the marks carry identity).
export function crewIds(mode: MatchMode): TeamId[];                    // teams [1, 2] · ffa [1..8]
// MapDef gains  ffaSpawns?: Array<{ pos: V3; yaw: number }>             // 8 entries, yaw in DEGREES (like spawns), written by gen_ffa_spawns.ts

// core/paint/painter.ts
coverageByTeam(out?: Float64Array): Float64Array;   // length CREW_SLOTS: weighted share per crew id, [0] = neutral, sums to 1 (all-neutral → [1, 0, …])
// coverage() {sun, gulf, neutral} is unchanged (teams); weighted(team) takes any crew id

// core/paint/minimap.ts — MinimapOptions.colors gains  palette?: ReadonlyArray<[number, number, number]>  (0..255, index = crew id;
//   when set, a dyed texel takes palette[crew] and sun/gulf are ignored; index 0 unused). MinimapRaster.setPalette(p | null) repaints.

// core/match/roster.ts
defaultRoster(o: { …as before…; mode?: MatchMode; humanCrew?: TeamId }): RosterEntry[];   // mode 'ffa' → ffaRoster(o)
export function ffaRoster(o: { humanKit: string; humanName?: string; seed: number; skill: BotSkill; botKits?: string[]; humanCrew?: TeamId }): RosterEntry[];
//   id 0 = the human on crew humanCrew (default 1 = amber); ids 1..7 = bots on the other 7 crews in ascending crew id;
//   names = the same seeded draw from the ORIGINAL pool as teams mode; kits as teams mode. Every entry has a distinct team.

// core/match/world.ts
MatchOptions.mode?: MatchMode;                        // default 'teams'
MatchWorld.mode: MatchMode;
MatchWorld.crewPads: CrewPad[];                        // FFA: one drop pad per runner, in runner-id order; teams: []
export interface CrewPad extends PadZone { crew: TeamId; pid: number; yaw: number }   // r = 1.6 (MATCH_FFA.padRadius), yaw radians
MatchWorld.padOf(r: Runner): PadZone;                  // the runner's own pad (teams: pads[r.side]; FFA: its drop pad)
MatchWorld.crews: TeamId[];                            // crews in play (teams [1, 2]; FFA the roster's crews, ascending)
// onOwnPad(r) = r.onPad(padOf(r)). In FFA the A/B team pads are neutral scenery (nobody refills there, nobody is pushed out).
// FFA spawns: runner i stands on maps.json ffaSpawns[perm[i]], perm = a seeded shuffle of 0..7 (mulberry32(hash32(seed, 0xffa5))).
//   A map without ffaSpawns falls back to 8 slots spread over the two team pads (never used by a built map).
export interface MatchResult {                         // sun / gulf / neutral / winner as before (FFA: sun = shares[1], gulf = shares[2])
  mode?: MatchMode;
  shares?: number[];                                   // length CREW_SLOTS, by crew id, [0] = neutral; sums to 1
  standings?: CrewStanding[];                          // every crew in play: share desc, ties → lower crew id first
  tied?: TeamId[];                                     // winner 0 → the crews tied for first (both modes); otherwise []
}
export interface CrewStanding { crew: TeamId; share: number; rank: number; pid: number; name: string }  // rank 1-based, equal shares share a rank;
//   pid/name = the crew's runner (FFA) or its first runner / the crew name (teams)
// Winner: the largest share by strict comparison; a tie for first (exactly equal shares) → winner 0 (a draw) and `tied` lists the crews.

// core/runner.ts
RunnerOptions.otherPads?: readonly PadZone[] | null;   // FFA: every other runner's drop pad — pushed out of each (like enemyPad)
RunnerOptions.mode?: MatchMode;                        // FFA → Runner.enemy = 0
Runner.isFoe(t: number | null): boolean;               // t is another crew's dye (not null / neutral / own) — both modes
// Runner.enemy: teams the other crew; FFA 0 (every other crew is a foe; use isFoe). Runner.side: teams only (FFA crews ≠ 2 read 'A').
// The slog rule is now "foe dye underfoot" (= the old rule in teams mode).

// core/config.ts is not CORE-owned: the FFA numbers live in core/match/world.ts as
export const MATCH_FFA = { padRadius: 1.6 };
```
Bots (core/bots/*): enemy = any crew ≠ mine; refill on own dye or own pad (padOf); FFA pads of others are avoided like the
enemy pad (+80 path cost, never a goal); no half-court assumptions (the FFA goal pick skips zones within 3.6 m of a foe's pad
instead of the teams' enemy-base rules). Teams-mode bot and match hashes are unchanged (F4 regression).

## F7 `CHANGED(VIEW)`: the FFA view interface (lane VIEW, additive; teams calls keep every old signature)
```ts
// view/paintlayer.ts — the GPU paint encoding (both modes): R = 255 on any crew's texel (0 neutral) · G = crew id × 16
//   (CREW_STEP = 16, MAX_CREW = 8) · B = noise · A = surface/gutter mask. Old R + G == new R, so every paint/bare
//   edge is unchanged in teams.
// view/surfaces.ts (dye section)
createDyeUniforms(paint, mode?: MatchMode /* 'teams' */): DyeUniforms  // + uDyeFfa, uCrewCol / uCrewDeep / uCrewGloss /
//   uCrewColCB [9] (THREE.Color[], index = crew id, linear); the old uDyeSun* / uDyeGulf* uniforms are gone (internal)
setDyeMode(dye, mode): void           // in place, no recompile (the mode is a uniform); call per session with uViewerTeam
dyeCrewPalette(mode): Array<{ dye, dyeDeep, dyeGloss, cb } | null>   // by crew id, from core/data.ts crewDef()
//   uViewerTeam = the viewer's crew id in BOTH modes (FFA 1..8; 0 = spectator: every crew looks friendly).
//   Teams: crew = the filtered mean id (bit-for-bit the old GULF share). FFA: the 2 strongest crews of the 4 nearest texels
//   (texelFetch), bilinear share, the same organic threshold → smooth crew-vs-crew borders.
//   Colorblind: teams unchanged (swap pair + GULF hatch); FFA no swap, the diagonal hatch on every crew but the viewer's.
// view/players.ts
new PlayerViews(assets, roster, fx, tagHost, kits?, mode?: MatchMode /* 'teams' */)
//   runner tint, body stains (onHit byTeam = any crew id) and name tags from crewDef(mode, team). Tags: teams keep
//   `df-tag sun|gulf`; FFA `df-tag ffa crew-<key>` with an inline background (the crew's dyeDeep at .92) + --crew/--crew-ui.
// view/fx.ts
new Fx(sunDir, mode?: MatchMode /* 'teams' */); fx.setMode(mode): void   // recolours crews 1..8 in place
// ui/juice.ts
JuiceOptions.mode?: MatchMode /* 'teams' */       // damage vignette + arc in the ATTACKER's crew colour (FFA: any of 8)
Juice.victory(winner: TeamId | 0, avoid?, tied?: readonly TeamId[])  // FFA draw → confetti in the tied crews' colours
//   readback().vignetteTeam: teams 'sun' | 'gulf' (unchanged); FFA the crew key ('amber', 'violet', …)
// view/mapview.ts
addFfaPads(map: MapView, pads: ReadonlyArray<{ x: number; y: number; z: number; r?: number; crew: TeamId; yaw?: number }>): FfaPads
//   pass MatchWorld.crewPads (FFA; it carries the roster's crew per pad). One instanced draw: a 1.6 m disc, a ring +
//   the crew's mark shape in the owner's colour. While shown, the A/B team pads' crew accent turns neutral steel
//   (they are scenery in FFA). The slab sits on the floor found by downward rays (centre + 8 rim samples; a skirt
//   reaches the lowest). FfaPads { root: THREE.Group; count: number; floorY: number[]; dispose(): void } — dispose()
//   removes the pads and restores the team pads.
//   Teams: never call it.
```

## F8 `CHANGED(UI)`: the FFA app / UI interface (lane UI, additive; teams calls keep every old signature)
```ts
// ui/settings.ts — Profile gains  mode: 'teams' | 'ffa' (default 'teams')  and  ffaColor: number (1..8, default 1 = amber);
//   both persisted in dyefield.profile.v1 (sanitized: anything else → the default)
// ui/menus.ts — PLAY header: the MODE selector #dfm-mode-teams 'TEAMS · 4 v 4' / #dfm-mode-ffa 'FREE-FOR-ALL' (profile.mode).
//   Title mode line: exactly MODE_LINE 'Harbor Cup • 4 v 4' (teams) · MODE_LINE_FFA 'Harbor Cup • Free-for-all' (ffa).
//   LOADOUT in FFA: the crew row hides; #dfm-color-<key> × 8 (chip + mark) set profile.ffaColor; the mannequin / plate /
//   profile card / PLAY kit line take the colour. StartSelection gains  mode, ffaColor.  readback() gains modeLine.
// ui/slates.ts (re-exported by ui/hud.ts)
export type UiMode = MatchMode;
export function ffaCrews(): CrewLook[];                                 // FFA_CREWS as UI looks (label = the colour name)
export function crewLook(team: number, mode: UiMode, colorblind?: boolean): CrewLook;  // { id, key, label, dye, dyeDeep, dyeGloss, ui, uiInk, markGlyph }
export interface FfaStanding { team: number; name: string; share: number; you: boolean }
export interface FfaVictory { standings: FfaStanding[]; winners: number[]; neutral: number }   // winners: 1, or every tied crew
VictoryInfo.ffa?: FfaVictory                                            // set → the FFA slate (winner line, podium, standings, tally)
Slates.mode: UiMode                                                     // the death slate's washer colour + mark in FFA
// ui/hud.ts
new Hud(host, { …as before…, mode?: UiMode /* 'teams' */ })            // 'ffa' → the FFA HUD (own share + top 3 top-left,
//   8 crests by roster id, an 8-colour share bar, feed names in crew colour, minimap north-up, dots by mark shape)
HudFrame.shares?: ArrayLike<number> | null                              // FFA: coverage share by crew id ([0] neutral)
Hud.readback(): + mode, ffa { me, rank, top3[{team,name,pct}], crests[{team,alive,mark}], feedCrews[[A,B]] };
//   tally (victory) + mode 'ffa', winner, podium[3], standings[{text,pct,win}]; `victory` text = the card's visible parts
// game.ts
MatchConfig.mode?: MatchMode                                            // 'ffa' → MatchWorld { mode: 'ffa' }; `crew` = the FFA colour
Game.matchMode: MatchMode                                               // 'teams' for the lobby
//   victory: VictoryInfo.ffa from MatchResult.standings / winner / tied; juice.victory(winner, card, winners) in FFA;
//   the stinger 'victory' iff the human's crew is the winner or among the tied crews (teams: unchanged)
// main.ts — ?mode=ffa|teams (parseMatchMode; a deep-link key), FFA ?crew=1..8 | <colour key>; per session:
//   setDyeMode(dye, mode), minimap.setPalette(8 FFA dyes | null), new Fx(sunDir, mode), new PlayerViews(…, mode),
//   createJuice(…, { mode }), new Hud(…, { mode }); the roster = defaultRoster({ …, mode: 'ffa', humanCrew }).
// testsurface.ts — match(): + matchMode, crews (world.crews), coverageByTeam (length 9; `mode` stays 'match' | 'lobby');
//   state(): + matchMode; minimapPixel(): + own (the human crew's dye), crews {id: rgb}; session(): + matchMode
// harness: playtest.py --mode ffa (shots ffa_ui_pt_<map>_<kit>_*), bootcheck.py --mode ffa (ffa_ui_boot_*, report
//   bootcheck_ffa), menus.py FFA legs (ffa_ui_menu_*, ffa_ui_menu720_*)
```

## F6b `CHANGED(CORE)` addendum: spawns, bot tuning, results (lane CORE, 2026-09-28)
- **Spawns** (`maps.json <map>.ffaSpawns`, yaw in degrees; top-level `_changes` note): `_harness/gen_ffa_spawns.ts`
  (`--write` writes, `--check` re-verifies; it reproduces the committed sets). Candidates: core nav nodes passing the F1
  site rules (paintable floor ny ≥ 0.9 under the whole 1.6 m disc, ≥ 2.5 m clear of walls and edges, ≥ 3 m headroom,
  disc + 0.5 m off grates / conveyors / springs / oob / A-B pads); farthest-point sampling in rot180 mirror pairs + a
  swap polish. Beyond the F1 gates it balances each spawn's nav-Voronoi TERRITORY (info, not a gate).
  Fairness (nav distance spread to the centroid / to the nearest spawn, gate ±15 %; territory spread):
  pier18 ±11.4 % / ±11.1 %, territory ±15.1 % · lockwell ±12.1 % / ±4.8 %, territory ±41.4 % ·
  cinder ±14.9 % / ±12.0 %, territory ±46.8 % (Cinder's site-ok floor is essentially its two beaches).
- **FFA bot tuning** (bots/director.ts, FFA branches only): foe dye worth half of neutral to goals and sweeps
  (`FFA_FOE_NEED 0.5`, `FFA_FOE_GOAL 0.2`, `FFA_FOE_TEXEL −0.3`); every other bot's goal crowds a zone; two
  path-following dead ends fixed for FFA (a path planned mid-fall → re-plan; perched on a lip over its drop node →
  step off). Both dead ends are latent in teams mode too, left untouched there to keep the teams hashes.
- **Teams regression**: probe_match b2bbe68c-302ad464 / c5a7cddf-170d5cca; probe_bots ce46bdd0-95a08aa4 /
  3be6f4ce-30a6a2b1; mixed b92a5e29-7ae542eb / 6e20d3ed-da4252d2; lockwell 32a9768a-c5d660a1 · 82cb549f-f0113043 ·
  49e92443-e742fd78; cinder 9249db37-d02f5656 · 3951f941-06a26c48 · cc5cece2-909e6533 — identical before and after.
- **Open (reported, not fixed)**: Cinder FFA "every crew ≥ 4 %" misses on 5 of 8 seeds (lowest 2.8–3.8 %); Lockwell
  FFA one 6 s stuck window in 8 seeds (a jump edge retried on foe dye, where the slog jump is too weak); conveyors keep
  carrying runners after the horn in both modes (Lockwell, 4.19 m in 2 s) — pre-existing, outside FFA.

## F9 `CHANGED(INTEGRATION)`: integration fixes (2026-09-28; additive; teams behaviour and hashes unchanged)
```ts
// ui/boot.ts — MODE_LINE_FFA 'Harbor Cup • Free-for-all' now lives here (ui/menus.ts re-exports it unchanged).
BootUI.setMode(mode: 'teams' | 'ffa'): void   // the loading / play cards' mode line: FFA → MODE_LINE_FFA, else exactly MODE_LINE;
//   updates the card on screen in place. main.ts: setMode(sel.mode) before START's loading card, setMode('teams') before
//   the lobby's, setMode('ffa') at boot for a ?mode=ffa deep link. index.html's boot guard swaps the static card's line for
//   ?mode=ffa (not ?lobby=1) before the module graph runs. Teams cards are byte-identical.
// ui/menus.ts — HOW_RULE (the teams copy, unchanged) / HOW_RULE_FFA 'Free-for-all: every runner is a crew of one. When the
//   final horn sounds, the most turf wins.' — HOW TO PLAY panel 1's rule line follows profile.mode.
// ui/slates.ts + ui/menus.css — FFA standings: the winner's % is a pill in the crew's `ui` colour with its `uiInk` text
//   (--cu / --ci on the row). Crew-coloured text on the cream card measured 1.2–3.1:1 (sunflower 1.45, lime 1.89).
// core/bots/director.ts — failJumpWall(b, e, from) (FFA only): a jump edge given up after two tries also blocks, for the
//   same 12 s, every jump edge up the same stretch of wall (take-off within 2.6 m at the same height, rising at least as
//   far, onto the same top floor ±0.6 m), unless that leaves the bot's goal unreachable. Fixes the Lockwell FFA seed-8
//   stuck window (a refilling bot on foe dye failed 5 parallel jump edges up one 1.0 m wall, 93.5–99 s).
```
