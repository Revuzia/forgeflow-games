# Vocabulary and taxonomy (content lane, 2026-10-07)

What `content/classes.json`, `roles.json`, `resources.json`, `vfx.json` and `audio.json` define, and why. Every file passes a zod parse against `src/contracts/catalog.ts`. The full `tools/build_content.ts --check` (with these records merged into the fixture catalog) passes the deny-list, duplicate-id and §9.5 VFX vocabulary checks; the only warnings are for asset files that don't exist yet.

## Ids that avoid the content-id probe

`probe_content_ids` fails when a catalog id appears as a quoted string anywhere in `src/`, comments included. Plain `caster`, `light` and `tally` already appear that way (a backticked comment in `bots/knowledge.ts`, and keys in `ui/tokens.ts`). For that reason classes are `class_<name>` and resources are `res_<name>`. Fighters write `"class": "class_slinger"` and `"resource": "res_light"`.

## Classes (what a fighter is)

`class_plinth` · `class_breaker` · `class_striker` · `class_slinger` · `class_caster` · `class_tender`. Each `shape` field restates the bible's mass language: block, inverted wedge, forward diagonal, horizontal, line plus disc, and round with a light vessel. Icons are at `assets/ui/icons/classes/<id>.svg`.

## Rift positions (the role contract)

| id / name | assign | job |
|---|---|---|
| **Shadehold** | `road_high`, order 1 | solo top road: duel, hold the Needles, front line late |
| **Grovehunter** | jungle (`lane: null`), order 2 | Dialwood camps, ambushes, leads objectives |
| **Dialcross** | `road_seat`, order 3 | short centre road across the Seat, roams to the side roads |
| **Shaftlight** | `road_low`, order 4 | duo carry: farms, stays back, steady late damage |
| **Lampglass** | `road_low`, `support: true`, order 5 | duo support: shields, starts fights, lights the map |

The lane ids `road_high`, `road_seat` and `road_low` are now fixed vocabulary for the map designer (`MapDef.lanes[].id`). `road_high` is screen-top, which is low y.

**Why the bottom road is the duo road.** The camera looks −Z at 52°, so the visible ground runs 10.2 m above the focus and only 7.1 m below it, and the Dial Bar covers the bottom of the screen. On the bottom road, every gank comes from the Dialwood above: that is the long, uncluttered half of the view. That gives the fragile Slinger the earliest warning. Sunsplinter, the repeatable early objective, sits between the centre and bottom roads, so the duo, the Grovehunter and the Dialcross converge on it. Longshade, the late siege objective, sits on the solo's side, where a durable Plinth or Breaker can survive the shorter, HUD-covered warning from below. The map mirrors across x = size/2, not by rotation, so the bottom road is the duo road for both teams: duo meets duo and solo meets solo, with no safe-lane or off-lane asymmetry.

**Names.** Each name is a plain-English compound. "Shade" ties the top road to the Standing Shadow, and "Shaft" ties the bottom road to the Fallen Shaft. A lamp glass protects the flame and spreads its light, which is the support's job. The names pass `grep -i` on `protected_names.json`, `node tools/names_check.ts` and web checks. The following were rejected after checking:

- *Sunreach*: a Palworld tower
- *Lightward*: close to the "Lightwarden" of WoW and FFXIV
- *Woodrunner*: two edits from Windrunner
- *Woodstride*: two edits from the game *Wolfstride*
- *Glassguard*: a glass-film brand

Role colours are #A096DC, #8FBF6A, #5FC6C4, #F08F86 and #D8D47E. All sit outside the reserved hue bands (ally 200–225, harm 28–50, heal 125–150, tritan rose 340–350) and have at least 6.4:1 contrast on ink-2. They mark identity, never relationship.

## Resources

| id | model | numbers |
|---|---|---|
| `res_light` (Light) | pool | 300 +40/lvl, regen 1.6/s +0.14/lvl |
| `res_tally` (Tally) | build | 100. Gains: +6 per attack, +2 per hit taken, +5 per ability hit. Drains 8/s after 6 s with no change. |
| `res_heat` (Heat) | heat | 100. Ability costs add heat. At 100, casting locks for 2.5 s. Otherwise it vents 16/s after 1.2 s. |
| `res_unlit` (Unlit) | none | cooldown-only fighters |

**Calibration rule for fighter authors.** The sim adds a fighter's `base.res`/`growth.res` on top of `ResourceDef.max`/`maxPerLevel`. To land in VOCAB's 280–420 (+30–50 per level) Light range, give `base.res` an offset between −20 and +120 and `growth.res` an offset between −10 and +10. Do not restate the pool. Suggested costs:

- Light: 40–120 per cast
- Tally: 0, or spend 25–50 to empower
- Heat: 15–35 per cast, so four quick casts overheat

## VFX library (50 `lib_*` presets)

Each record's `$comment` gives its tier and family. The build strips `$comment`.

- **Tiers.** The generator checks flash `intensity` against the caps: T1 1.5, T2 3, T3 6, T4 at least 10 with a white core. White (`#FFFFFF`) appears only in the T4 presets: `lib_ult_*`, `lib_structure_fall` and `lib_objective_taken`.
  - T1 presets stay at or under 24 particles, 0.35 s particle life and no decals.
  - T2 presets stay at or under 64 particles and 1 decal.
  - Flashes last 120 ms at most. Trails stay at or under half the head's alpha.
- **Families.**
  - Lumen layers are additive, using glow, spark, shard, mote, petal and streak textures.
  - Shade layers are an alpha-blended ink body (`#101216`/`#1A1C22`, smoke and drop textures) with a light rim.
  - The rim uses `"team"`, because the self colour is Noonwhite (the bible's rim colour) and an enemy rim then becomes the danger rim.
- **Relationship.** `"team"` means the *source's* readability colour, so an enemy stun on you reads as harm. It is used on projectile heads, area and zone edges, and status marks. `teamTint` is true exactly when a preset uses `"team"`.
  - Impacts use damage-type colours instead: chalkstone chips for physical, orchid-rose for magic, an ink splash in a Noonwhite halo for true damage.
  - Heal is always Sap. Gleam is warm Noonlit.
  - The 65% opacity for ally effects is left to the renderer.
- **Grammar.**
  - Impacts throw opaque chips (alpha-blended shard texture that falls).
  - Harm bursts fly out. Help (heal, shield, level up, empower) rises, with negative gravity.
  - Movement uses side streaks. Control (stun, slow, root) uses a `spiral` mesh.
  - Burn embers in `lib_zone_ember` go outward, not up.
  - The edge ring is always the brightest layer.
- **Conventions the RENDER lane should honour.**
  - Area and zone presets are authored at a 1.0 m radius and should be scaled by the shape radius.
  - Zone, status and `lib_recall` durations are one loop period, repeated for the sim duration.
  - `path` layers ride a projectile or dash. `lib_blink` puts its arrival at `path`.
  - `gravity` is in m/s² pointing down, so a negative value makes particles rise.
  - Impact timing follows the bible's phases: flash 0–50 ms, mark 50–250 ms, settle 250–900 ms in dust under L* 55.

## Audio (94 cues, 6 beds)

- **Files** are at `assets/audio/<cue>.ogg` and `assets/audio/music/<id>.ogg`. The match beds also have `<id>_intense.ogg`, the same length and bar-aligned.
- **Priority** follows the bible's mix order, highest first:

  | priority | what |
  |---|---|
  | 10 | critical: `ui_queue_pop`, `m_self_down`, `m_structure_ally_fall`, result stings |
  | 9 | announcer stingers on the `voice` bus |
  | 8 | enemy threat: `m_enemy_windup` (the one shared shade-breath swell, spatial), danger pings, ult wind-ups |
  | 7 | own actions |
  | 6 | ally or shared combat |
  | 3–5 | world: Wicks, monsters, wave spawn |

  The beds are MusicDefs and sit below all cues. Combat cues are rated as the local player's own action; the engine may raise an enemy source aimed at you by 1 and lower an ally source by 1.
- **pitchVar** is a ± playback-rate fraction. In-key tonal cues (UI, stings, level up) use 0.
- **cooldown** is the minimum time in seconds between two starts of the same cue. Examples:
  - hover: 70 ms
  - hits: 25–50 ms
  - pings: 0.5 s
  - wave spawn: 5 s
- **Combat sounds** have `spatial: true`. `c_zone_loop` loops.
- **Tempo** is 60 BPM for menu and postgame, 90 for draft and 120 for the match beds. `loopStart` is 0, and each file should be a whole number of 8 s phrases.

## Notes for other lanes

- The layer id `intense` counts as a catalog id. An audio engine that writes `'intense'` in `src/` will fail `probe_content_ids`; select the layer by data instead.
- `src/ui/audio_port.ts` line 10 already fails that probe. Its doc comment quotes `` `ui_click` `` and `` `ui_queue_pop` `` in backticks.
