# Lane E ledger (sonnet tasks): accessibility, scenarios, wheel entries

| item | status | files | test |
|---|---|---|---|
| leftover: compact `controls_keyboard` | done (12 essentials: drag, wheel, WASD, Z/X, click, `/`, speed, pause, F4, M, P, F1); regenerated with gen-controls | src/ui/controlstext.ts, public/game_meta.json | tests/ui-meta.test.ts |
| E7a dialog roles + focus return | done: panels already `role=dialog`; added `aria-modal` on veiled ones, `tabindex=-1` and focus into the window on open, focus back to the opener on close (not into text fields, not if the player moved focus) | src/ui/panel.ts | tests/ui-a11y.test.ts (pure `focusReturnTarget`; no DOM harness) |
| E7b text size + high contrast | done: `ui.textSize` (normal / large 1.15 / larger 1.3, multiplies the interface scale, clamp 0.8..2.5) and `ui.highContrast` (body class, brighter ivory, firmer lines/panels, 3px focus ring); both in Settings > Interface | prefs.ts, shell.ts, settings.ts, styles.css | tests/ui-a11y.test.ts |
| E7c second non-colour cue | done for regard: The god card gauge now prints the band as a word (the HUD chip already did). Mood/health/needs bars already carry a number, left as is | living.ts, styles.css | tests/ui-a11y.test.ts |
| E7d reduce-motion for camera fly-to and cinematics | NOT DONE: the fly-to is `src/render/camera/rig.ts` (`flyToPlanet`) called from `src/app.ts:1845`; neither is mine. Suggested change: in `App.flyTo` pass `duration` ~0.01 (or snap) when `prefs.value.ui.reduceMotion`; same for the dolly (`cam.dolly`) orbit speed | none | none |
| E5 premise scenarios | done: `shore`, `neighbours`, `coldforge`, `fewhands`; each description ends "What to watch: ..."; cards in the picker (icons wave, world, snow, person) | src/data/scenarios.json, src/ui/newworld.ts | tests/ui-scenarios.test.ts (runs 200 steps, people alive); ui-newworld-babel.test.ts (every scenario has a hand card) |
| E6a neutral wheel entries | done: 13 powers in Signs: tower (confuse, strike, warn, let), vows (4 + say nothing), answers to defiance (lightning, bread, sign, patience). "Read the Book" is a UI action, not a command, so it is not a power (already reachable from the age line, Chronicle Book tab, towns' cards, words) | src/data/powers.json | tests/ui-arc-wheel.test.ts; content.test.ts `validatePowers` |
| E6b "What you did" Chronicle tab | done: third tab showing only `kind === 'god'` entries, kind chips hidden | src/ui/chronicle.ts | tests/ui-arc-wheel.test.ts |
| E9 live integration tests / layout matrix | NOT DONE: needs a real babel world in a browser (no browsers allowed here) and no DOM harness exists |  |  |
| skipped by instruction | E1 reading view, E2 whispers, E3 auto-ease, E4 long press, E8 last-page card (opus / owner decision) |  |  |

## Notes
- Text size is a step on top of the interface scale (the scale slider already reaches 200%), not a separate font system: the UI is px-based throughout.
- Wheel powers have no `cost` or `cooldown` (the sim lane decides restraint costs); ring 1.
- Not looked at in a browser: the focus ring, the high-contrast palette and the gauge word were not seen.
