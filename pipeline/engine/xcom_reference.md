# XCOM-MATCH reference — the "copy" Void Skirmish (genre: tactics) must converge to

This is the machine-checked target spec for the autonomous XCOM-match loop
(`xcom_autopipe.py`). The nightly verifier (`xcom_match.py`) shows this to a
Claude vision model alongside live screenshots of the game and asks it to score
the match 0-100 and list concrete, fixable gaps. Grounded in the XCOM-2 art
research (11 real screenshots) + the "Plot and Parcel" structure research.

## Must-match dimensions (each scored 0-100, weighted)
1. **City structure (15%)** — parcel/plot layout: real streets dividing lots into
   enterable multi-room buildings, walled compounds, plazas, parks; ~64-tile
   plot; dense clustered cover forcing non-linear movement. NOT a flat open grid.
2. **Buildings & interiors (15%)** — low-rise enterable buildings with VISIBLE
   furnished interiors (desks/shelves), real wall geometry with window/door
   cutouts; tall high-rises only as a distant backdrop fading into haze.
3. **Verticality (10%)** — climbable elevation (rooftops/upper floors), height
   gives an aim advantage + line-of-sight over low cover.
4. **Props & clutter density (10%)** — busy streets: cars, dumpsters, crates,
   barriers, hydrants, street lamps, benches, planters, traffic cones, manholes,
   billboards, and the signature ADVENT teal-cyan propaganda kiosks/signage.
5. **Palette & grade (10%)** — dusk: desaturated base + a few saturated neon pops
   (warm `#ffb24d` windows + cool ADVENT teal `#34d6e8`); high value-contrast,
   crushed blacks, never flat midday.
6. **Lighting & post (10%)** — low warm key + long shadows, sky-tinted ambient,
   bloom on emissives, SSAO/contact shadows, depth fog tinted to the horizon.
7. **Units (10%)** — armored military silhouettes (soldiers) vs distinct
   escalating enemies; readable at tactical zoom; weapons visible; color-coded.
8. **Tactical UI (10%)** — per-soldier roster with class/role + HP + AP; active
   soldier marker (chevron); class ability bar showing what each power does;
   hovered-enemy hit-% preview; cover shield indicators.
9. **Game feel (10%)** — muzzle flash, tracers, impact sparks, screen shake,
   hit-react + death animations, cinematic kill-cam, hunker-behind-cover.

## Systems that must EXIST (functional, checked by feel/contract gates, not vision)
2-action economy, cover (half/full), flanking, overwatch, line-of-sight,
concealment + enemy pods, soldier classes + abilities, mission objectives +
turn limit, permadeath + ranks + doom clock, inventory/armor/weapons/crafting
(Barracks), audio (music + combat SFX), plays to a win/lose conclusion.

## Pass bar
- Per-dimension vision score and a weighted TOTAL.
- **MATCH = total ≥ 88 AND no dimension < 70 AND all functional systems present.**
- Below that, the verifier emits a ranked gap list; the autopipe fixes the
  highest-severity gap that night, re-gates, commits if green, and repeats the
  next night until MATCH.

## Honest ceiling note (for the operator, not the scorer)
Free CC0 low-poly + browser tops out at "stylized / Roblox-tier," not pixel-
identical XCOM-2 AAA. The score should judge STRUCTURE, SYSTEMS, COMPOSITION and
ART-DIRECTION fidelity (all achievable) — not raw texture/poly realism.
