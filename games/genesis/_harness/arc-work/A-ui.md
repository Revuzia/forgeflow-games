# A-ui ledger (UI engineer, stage A) — trust this file

Sim lane is in parallel (A-sim.md): it owns types.ts views, events.json, freeform-signs, the §10 8-seed probe.
UI builds ahead on `__GENESIS__.arc.stub` (§6.7) with local mirror types in src/ui/arc.ts until types.ts lands.

## Plan (priority order)
1. testsurface `arc` {hearts, towers, story, stub} + stub injection into the next snapshot (§6.7)
2. audio: eventmap cues/null for every §6.3 event, new SFX cues (crowd.jeer, crowd.hymn, toil.drums, toil.chant,
   ui.great, babel.babble, masonry.collapse, crowd.cheer); tests/audio-arc.test.ts
3. §1.4 heart glyph icons (ui/icons.ts) + HUD chip glyph + proud tower mark + defiant pulse; tests/ui-arc-hearts
4. §1.4 Hearts layer (overlays.ts LAYERS) + palette ΔE>=15 test (M5)
5. §1.4 inspector person caption + settlement Hearts section
6. §2.5 Decision card (ui/decision.ts), pill, keys 1-4, slow-down setting, tower inspector card; tests/ui-arc-decision (T10)
7. chronicle: tower.* / heart.* lines show (kind god) — check chronicle filter handles them
8. §10: river-warning shot looked at (888x500), spec in _harness/arc-work/
9. shots M4/T3 once sim lands; gate green

## Stint log
### Stint 1 (2026-11-07)
- started
- DONE item 1: src/client/arcstub.ts (arcStub/applyArcStub, patched in SimClient.receive so lookdev too);
  worldview.ts copies towers/covenant/covenantOffer/age/epithet into PlanetView (optional fields); testsurface `arc`
  {hearts,towers,story,stub} (stub requests a full snapshot). tests/ui-arc-stub.test.ts 3/3.
  NOTE: sim landed §6.2 types in src/sim/types.ts already (HeartSign, HeartKind, TowerView, Vow, SettlementView.heart...).
- DONE item 2: eventmap.ts `ARC_CUES` table (every §6.3 event: cue or null; cueFor falls back to it); sfx.ts new
  recipes crowd.jeer, crowd.hymn, toil.drums, toil.chant, ui.great, babel.babble, masonry.collapse, crowd.cheer,
  crowd.shout, stone.knock, covenant.chime, covenant.chime.broken, ui.deny (stage B/C cues too). Music untouched.
  tests/audio-arc.test.ts 4/4; audio.test + audio-authored 44/44.
- DONE item 3: src/ui/hearts.ts (pure: captions fallback, shareWords, heartGlyph, heartHover, duskWords, HEART_COLORS
  per CvdPalette incl. monochrome, heartAlpha, deltaE); icons heart, heart-devoted/fearful/restless/defiant/proud;
  hud.ts name chip glyph after the name (+ proud tower mark, 10 s fist pulse on a new SettlementView.defiant.tick);
  living.ts PrayerMarks also marks hearts from orbit (`.gn-lmark-heart`, clickable, markedHearts()); CSS in styles.css.
- DONE item 4: Hearts layer in overlays.ts OVERLAYS (id hearts) + hearts() fill (quiet unshaded, proud rim on edge
  cells) + hover words + legend with captions. tests/ui-arc-hearts.test.ts 3/3 (M5 ΔE>=15 all 5 palettes).
  NOT YET LOOKED AT in a shot (do with item 9 / stub shot).
- DONE item 5 (code; not yet looked at): inspector person line (personHeartLine from agent detail `heart`), settlement
  "Hearts" section (settlementHearts: caption+share words, mood line, 4 share bars, Pride gn-pride (+prideWhy words on
  hover if detail carries `prideWhy`), Defiance gn-defy, dusk "x of y at the shrine (a year ago, z)", theyCall,
  remember, answered). Reads heart from deps.live(ref) (mirror, carries stub) then detail view.
- DONE item 6a (code+unit; NOT yet looked at): src/ui/decision.ts — towerChoice (pure words/buttons), DecisionState
  (pure: open/pill/forced, slow-down 10x above 30x and restore), DecisionCard DOM (Esc/keys 1-4 on focus, Look at it,
  Decide later -> pill, layout: top-centre under --gn-time-b; class gn-decision-left under the time panel when the
  inspector would be covered). Mounted in shell.ts (`ui.decision`, updated each frame from primary planet towers).
  Pref game.slowGreat (default true; settings toggle "Slow down for great moments"). Test surface arc.decision() /
  arc.choose(key) / arc.later(). tests/ui-arc-decision.test.ts 5/5.
  Placement note: the pill sits where the card was (top-centre), not "left of the time controls" — the time panel is
  at the far left at 888x500, so nothing fits left of it. (UI placement only; no §6 contract change.)
  TODO 6b: tower inspector card (picking a tower -> needs a pick path for TowerView; render lane draws it) with the same
  buttons via decision.openFor(id); "tower.begun" toast "Look at it" (toasts/eventmap via chronicle?).
