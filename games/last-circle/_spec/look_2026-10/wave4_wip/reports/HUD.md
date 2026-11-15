# HUD lane report (Wave 4) - P1.9 HUD restyle + P4.3 death banner / standings

## Triage
Fresh start (no previous REPORT.md). Status: STARTED.

## Log
- started: read plan, hud.js

## Progress (appended as I go)
- 11:26 baseline screenshots of the OLD HUD captured (shots/before_1280x720_{match,death,post}.png), 0 page errors, 0 failed requests.
- hud.js edited (only file touched): new vitals (4+4 segment bars, HP number, consumables row), weapon card above slot row,
  storm row "Circle N of 8 · X damage a second", kill-feed rows with silhouette support + text fallback, death banner (top, compact),
  post-match summary + standings table + "Run it back" / "Find a new match". NOT YET verified in a browser (node --check only = parse OK, proves nothing).
- 11:44 first browser run of the new HUD: new gate _harness/new/hud_checks.py --only desktop = 49 pass / 1 fail (banner text read "#9of 50": missing space, fixed).
  Screens LOOKED at: vitals (78 HP, 3 + 1 partial blue segments for shield 62, 3 + 1 partial white for HP 78, consumables row with key chips 4 and 5),
  weapon card (ASSAULT RIFLE green, outlined UNCOMMON, AUTO chip, AR silhouette from ART-B's wpn_ar.png, "30 / 150", MEDIUM AMMO + 10 mag segments),
  storm row ("Circle 1 of 8 · no damage yet"), kill feed rows with silhouettes, death banner (2 rows, 806x93 px at y 180, clear of the minimap + reticle),
  post-match (summary card + 50-row standings, own row gold, Run it back / Find a new match / MAIN MENU).
- TODO: phones run, fallback run, layoutcheck / mobile / feelcheck / framecheck / leaktest, side-by-side sheets vs ref t84 / t100 / t113.
