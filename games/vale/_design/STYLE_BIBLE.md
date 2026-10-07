# VALE · Style Bible

**Law for every screen.** Machine-readable half: `_design/tokens.json` (`python3 _design/tools/verify_tokens.py` recomputes every colour figure here). Names and lore: `_design/WORLD.md`. Uncovered case? Choose what speeds the 200 ms read (**threat → side → health → self → objective**), then extend the nearest rule.

## World

The Vale is one carved sundial. Its needle fell, its shadow stayed, and the light stopped: morning on the west rim, evening on the east. **Aubade** (west, screen-left) build tall chalk spires with cool dawnglass. **Serenade** (east, screen-right) build low ironstone domes with warm lampresin. RIFT is the war for the dial (**Hourfall**); BRIDGE, the fight along the fallen needle over a gorge (**Needlespan**); FRAY, the **Shadowless Noon** on the **Noonplate**, when nothing casts a shadow and nobody has a side. Tone: luminous, competitive, a little melancholy; defeat is dignified.

- **Stone tells you whose land; light tells you whose side.** Shape, stone and the ▲ spire / ◠ dome marks are absolute. Bars, rings, telegraphs, lamp cores and each fighter's `accent` carry relationship colour (spectators: side colour; FRAY: seat colour).
- Fighters wear carved masks or glass visors. No hair cards, cloth simulation or alpha-card foliage.
- Banned: gears, clock hands, gold filigree, gems, glowing runes, metallic bevels, teal-and-gold, red-versus-green sides.

## Palette

Colour is a gameplay resource; the client is ink and chalk. Overlays draw after the grade, so every hex is the screen pixel.

| UI token | Hex | Use (WCAG contrast) |
|---|---|---|
| ink-0 · 1 · 2 · 3 · 4 | `#0B0D11` `#11141A` `#171B22` `#1E232C` `#262C37` | backdrop · bar plate · panel · hover · pressed |
| line-1 · line-2 | `#2C333F` `#3D4656` | hairline · input / locked dashed border |
| text-1 = chalk · chalk-hi | `#EDE6D6` `#FFF8EA` | text 13.9:1 on ink-2; CTA plate with ink-0 text 15.6:1 |
| text-2 · text-3 · disabled | `#ABA597` `#8F8A80` `#6E6B66` | 7.0 · 5.0 · 3.3 on ink-2 (disabled always says why) |
| brand-gloam | `#A99BFF` | logo, season, "new" dot, T3 frame; never in a match |
| warn · ok | `#F6D04D` + ▲ · `#63D88B` + ✓ | UI only; danger = HARM + wedge "!" |

| Relationship | Default | Deutan | Protan | Tritan | Shape code (every palette) |
|---|---|---|---|---|---|
| **Self** Noonwhite | `#F4EFE2` | `#FBF8F0` | `#FBF8F0` | `#FBF8F0` | double-frame bar · solid ring + gnomon wedge at facing · minimap wedge |
| **Ally** Dawn azure = Aubade | `#3F9CFF` | `#2FA8FF` | `#3F9CFF` | `#2FA8FF` | rounded bar ends · 12-dash ring · round portrait |
| **Enemy / HARM** Dusk marigold = Serenade | `#FF9A1F` | `#FFC21F` | `#FFC21F` | `#FF3D6E` | chevron bar ends · ring with 4 inward notches · portrait + heading wedge |
| **Neutral** Dialstone | `#A9A49A` | same | same | same | square ends · no ring until aggro · square |
| **Measured** (worst CIEDE2000, Machado-2009) | pairs 26.6 · terrain 21.2, all four visions | 27.2 · 26.1 | 28.1 · 26.1 | 32.8 · 26.2 | spectators: azure ▲ / marigold ◠ |

Self and enemy colours are player-overridable (warning below ΔE 20). No red enemy: it sinks into stone under protan.

**FRAY seats**, identical for every viewer: worst pair ≥ 10.4 under all four visions (normal ≥ 17.0), ≥ 15.5 from Noonwhite, ≥ 10.1 from HARM, ≥ 9.6 from heal, ≥ 3.07:1 on the bar plate. The glyph is the sure key: every pair below ΔE 16 in any vision, or below 5 in grey, has glyphs from different families (filled/hollow, round/straight, upright/diagonal).

| I | II | III | IV | V | VI | VII | VIII | IX | X |
|---|---|---|---|---|---|---|---|---|---|
| Crimson `#B2354A` ● | Olive `#767305` ▲ | Lime `#D9FF17` ○ | Green `#20A04E` ✚ | Cyan `#26F3FF` ■ | Blue `#19AFFE` ⧗ | Indigo `#7273F5` ☾ | Violet `#8121FC` ✖ | Plum `#993F94` ▬ | Rose `#DC6294` ◆ |

You see yourself in Noonwhite with your glyph; your seat colour lines your bar plate. FRAY telegraphs stay HARM with the caster's seat tick at the origin. Colourblind options: **Stamp-forward** (glyphs 150%, fill 60%; default with any CVD mode) and **Simple colours** (everyone else HARM + glyph). Crimson, Olive, Violet and Plum take a 1 px chalk keyline; Lime and Cyan an ink one.

| Damage | Token | Second code |
|---|---|---|
| Physical | `#F1E2C6` Chalkstone | upright numerals |
| Magic | `#FF7BD5` Orchid-rose | oval chip in tooltips and recap |
| True | `#101216` numerals, 2 px `#F4EFE2` halo | value inversion (16.3:1) |
| Heal | `#63D88B` Sap | "+" prefix, always rises |
| Shield | `#DCE8EE` Dawnglass | 45° hatch |

| Ranks (L* climbs 45 → 100) | Lamplit `#8A6248` · Greylight `#7D8A9E` · Rosewake `#D9897F` · Clearmorn `#8FB8E0` · Highsun `#E8D39A` · Noonward `#F4EEDD` · Unshadowed `#FFFFFF` + prismatic rim |
|---|---|
| **Item tiers (hour-ticks)** | Slate `#8E96A3` 1 · Verdigris `#5FBFA8` 2 · Gloam `#A99BFF` 3 · Noonlit `#FFF4DA` 4 + glow |
| **Resources (bar row 2)** | Light `#8F86F0` · Tally `#E8C27A` · Heat `#D96A4A` hatched |

## Type

| Role | Face · package (5.3.0, OFL-1.1) | Job |
|---|---|---|
| Display | Gloock 400 · `@fontsource/gloock` | results, mode and screen titles; never below 28 px |
| Heading | Instrument Sans Variable · `@fontsource-variable/instrument-sans` (wght 400–700, wdth 75–100) | CAPS headings, labels, buttons at wdth 88–90 |
| Body | Atkinson Hyperlegible Next · `@fontsource/atkinson-hyperlegible-next` | running text, names, chat |
| Numeric | Atkinson Hyperlegible Mono · `@fontsource/atkinson-hyperlegible-mono` (every digit 632 units) | every number that changes |

| 1080p | display-xl · l · m | h1 | h2 | label | body · s · caption | numbers | overhead name |
|---|---|---|---|---|---|---|---|
| px/line | 112/112 · 72/76 · 44/48 | 24/28 650 +.06em | 18/24 600 +.08em | 15/20 600 +.06em | 16/24 · 14/20 · 13/18 | gold 18 · clock 20 · cooldown 22/700 | 12/14 600, 2 px ink outline |

- Nothing below 12 px at any UI scale (0.8–1.5). Display is Title Case; CAPS only for one-word results and mode names.
- Live numbers use the Mono or `tabular-nums`. No faux bold, outlined or gradient text, no text in images; 35% localisation headroom.

## Menu mood

*Honed stone in long light.* One live 3D scene, **the Rim at the Split Hour**: a terrace on the dial's rim, Glass Belfry left, Lamp Dome right, the fallen needle below, a low sun from the left whose shadow edge creeps 1° a minute. Every screen is a camera position in it.

| Rule | Spec |
|---|---|
| Mode select | The **Mode Dial**: RIFT (three roads crossed by the noon line), BRIDGE (one line over an arc), FRAY (ring of ten ticks), plus an **uncarved hour** for the data-driven reserved mode. Choosing swings a gnomon shadow clockwise to it (360 ms). Modes get no colour; mark, station and motif ending tell them apart |
| Surfaces | ink-2 plates at 94%, 2 px radius, 1 px top-left catch-light, 2% grain. No backdrop blur, gold or metal. Dawnglass inlay (`#BFD3E6` → transparent, 10%) only for lit states |
| Shapes | **plate** = structure · **ring** = time and state · **wedge** (gnomon) = act, chosen, facing. Ornament only tells time, rank or rarity (hour-ticks, hour-line, dial arc), ≤ 2 per panel |
| Grid | 12 × 122 px columns, 24 px gutters, 96 px margins, 8 px baseline; 3D subject in columns 7–12, UI in 1–6. One chalk CTA per screen, bottom-right of the UI zone; Back top-left and Esc |
| Motion | 60 · 100 · 160 · 240 · 360 · 720 (camera) · 900 · 1200 ms. Enter `dawn` (0.16, 1, 0.3, 1); exit `dusk` (0.7, 0, 0.84, 0) at 0.7×; `swing` (0.34, 1.4, 0.64, 1) for rewards only; timers linear. Stagger 32 ms, cap 8. Forward is clockwise (enters from the right). Signature **shadow-line wipe**, 30°, 900 ms, client ↔ match only. Reduced motion: 120 ms fades, camera cuts |
| States | hover = keyboard focus (+ 2 px chalk ring, 2 px ink gap) · pressed 1 px down, sound on pointerdown · selected keeps a chalk hour-tick · disabled says why · locked: dashed border + unlock path, never grey · loading: final-size skeleton with a shadow sweep · empty: one drawing, one sentence, one action · error: HARM rule + Retry · timed: ring sweep, HARM in the last 5 s · new: gloam dot |
| Budget | ≤ 3 ms GPU; 30 fps after 4 s idle; paused when hidden. UI sounds are glass and wood, never beeps |

## In-game camera

| Pitch | Vertical FOV | Distance | Zoom (play, same for all) | Spectator | Yaw |
|---|---|---|---|---|---|
| 52° | 26° (44.6° horizontal at 16:9) | 28.5 m | 24.5–33.0 m | 20–44 m | fixed, looking −Z |

- 82.1 px/m at the focus: a 1.9 m standard fighter is **96 px** at 1080p, 64 px at 720p (compact 1.6 m: 54 px; large 2.4 m: 81 px). Visible ground: 23.4 m wide, 10.2 m ahead, 7.1 m behind.
- **Every team map attacks along the screen horizontal** (Aubade left) and mirrors across the north–south noon line: identical depth for both sides, no per-side offset. Abilities ≤ 10 m stay on screen; longer ones get an edge marker.
- Locked, semi-locked (6 m leash), free, hold-to-scout. Readability signs off at 720p, default zoom, Low tier.

## HUD density

| Element | Where | Size (1080p) | Screen share |
|---|---|---|---|
| Dial Bar | bottom centre | 640×132 | 4.07% |
| Minimap RIFT · BRIDGE · FRAY | bottom right (swappable) | 352×198 · 384×96 · 232 disc | 3.36 · 1.78 · 2.60% |
| Sky strip: score, clock, objectives | top centre | 720×48 | 1.67% |
| Ally frames (team modes) · Hour Board (FRAY) | left edge · top right | 4×168×52 · 220×236 | 1.69 · 2.50% |
| Kill feed (3 rows) · announcer · chat | top right · under strip · bottom left | contextual | 1.46 · 1.73 · 2.67% |
| Overhead bar | head + 0.35 m, fixed screen size | HP 82×9 over resource 82×4, 80% ink plate | ticks every 100 HP, heavy every 1,000 |
| Telegraph | overlay pass, 1 px dark outer keyline | enemy fill 16 → 30%, edge 90%, 3 px · ally edge 45% · own aim 8% / 60% | overlaps MAX-capped at 40% |

- **Always-on ≤ 11%** (RIFT 10.79, BRIDGE 9.20, FRAY 10.84); **peak ≤ 17%** (16.65). The centre 40% × 50% holds no HUD.
- Dial Bar: portrait with level ring, HP over resource, Gleam; items 3×2, abilities 64 px, ultimate 76, spells 48. Cooldowns are ink shadows sweeping clockwise from 12 o'clock.
- Bars: Noonwhite damage trail (150 ms hold, 450 ms out), hatched shield; minion bars only when damaged or targeted.
- Delayed areas sweep clockwise and land as the circle closes. Telegraphs are never white, never pulse above 2 Hz, and look identical on every quality tier.
- Damage numbers: only your outgoing hits and heals ≥ 5% max HP; merged per 0.5 s; ≤ 8 on screen.

## Look rules

- **Lighting.** One sun, behind-left of camera: Hourfall 52°/215° `#FFEBD8`, Needlespan 46°/200° `#FFC890`, Noonplate 86°/200° `#FFF3E6`. Fighters carry their own shader key (view 225°/45°, 0.9× sun) and keep ≥ 75% brightness in shadow. Skies: Blender 5.2 Multiple Scattering bakes, sun disc off. No camera-distance fog, no cloud shadows; walkable roughness ≥ 0.5. Fog of war: value ×0.55, saturation ×0.4; the Standing Shadow keeps colour and a hard edge.
- **Grade.** Khronos PBR Neutral, exposure 1.0, everywhere. One locked LUT, `vale_grade_01` (33³): cool lift, warm gain, +6% contrast, foliage −5° ×0.88, world chroma near team hues ×0.85 (value < 0.85 only, so accents keep their hue). Order: N8AO → bloom (threshold 1.0) → tone map → LUT → vignette → overlay → SMAA.
- **Fighters.** Role is mass: Plinth block, Breaker inverted wedge, Striker forward diagonal, Slinger horizontal, Caster line + disc, Tender round with a light vessel. Top quarter L* 70–85, feet 20–35; ≥ 40% rest; features ≥ 6 cm; silhouette IoU ≤ 0.80 at 64 px; 2–4 cm bevels. The `accent` (≤ 5%, top half) holds readability colour below bloom (≤ 0.8) and blooms only in wind-ups (≥ 1.5): **a glow is a warning**.
- **VFX.** Lumen (additive light, glass shards) and Shade (ink with a light rim). Emissive caps T0–T4: 0.8 · 1.5 · 3 · 6 · ≥ 10; only T4 reaches white. The danger edge is brightest; impacts throw opaque chips; up means help, out means harm; allies' effects at 65%.
- **Audio.** D Dorian with a Lydian G#; 60 menu, 90 draft, 120 match BPM on an 8 s grid. Motif A4–E5–D5–B4, ended by F#5 (RIFT, victory), G4 (BRIDGE), G#4 (FRAY) or a held B4 (defeat). Eight synthesized voices (dawnglass, hourbell, dial harp, lamp drone, frame drum, escapement, shade breath, FM shimmer); enemy T3+ wind-ups share one shade-breath swell. −18 LUFS, −1 dBTP.
