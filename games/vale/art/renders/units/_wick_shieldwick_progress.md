# shieldwick (Aubade + Serenade) build progress

Owner of: art/blender/units/wick_shieldwick.py, art/blender/proto/wick_shieldwick_*.py,
art/out/units/shieldwick_{aubade,serenade}.glb, art/renders/units/*shieldwick*.

## 2026-10-20 10:11 start
- Read brief §0-§6 (_design/units/wicks.md), wick_common.py, HANDOFF Art 2.0, marund.py, marund_v2.py, kemdo.py/_fit.
- Plates exist (art/.cache/concept/wicks/shieldwick_{aubade,serenade}_*), default cut. Masks checked:
  Aubade knob not in the cut (pale on pale background) -> knob painted flat chalk; plate top row 236 =
  z 1.04 on the measuring grid (hood dome top measures 1.00, knob top 1.10). Serenade plate top 220 = dome
  crown, measured at 1.08.
- Measured both concepts on a 5/10 cm grid (scratchpad grid overlays).

## 2026-10-20 11:00 first sculpt + build
- wick_shieldwick.py: both faction sculpts (parts_aubade / parts_serenade), per-faction arm joints in rig_extras
  (prop.R up the haft, prop.L along the shield normal), bespoke idle / run / attack1 / death, palette fit wrapper
  around project.paint_object (only active with PROJECTION["palette_fit"]).
- proto/wick_shieldwick_fit.py -> art/renders/units/shieldwick_fit_{aubade,serenade}.png (silhouette overlay):
  both fit the concepts; Serenade hood lip rebuilt as a tube along the cut edge (a planar ring floated).
- First builds: surface-nets non-manifold edges stalled the decimator (hem band 4.5k tris) -> make_low():
  decimate, fall back to voxel remesh + decimate. Now ~3.2-3.5k tris, ~415 KiB.
- Review (scratchpad three.js review sheet -> art/renders/units/shieldwick_review.png): both read as distinct
  cultures, but far too pale on top (fit to palette medians blew out under the game sun) -> fit targets now a
  step under the palette (painted medians), Aubade hood blue linen L* 72, Serenade felt #C0A078.
- Accent 5.2 % (A) / 5.9 % (S) -> seam, band, shield inlay ring, lantern windows enlarged.
- Death legs fixed (were sticking up behind), wind-up raises the lantern above the hood.

## 2026-10-20 11:45 paint pass
- Top plates (TOPS, painted fields: cloth median + key light + brush patches + radial folds / felt mottle) for the
  hood, cloak, scarf (A) and hood, collar, mantle, cloak (S): the front/back projection had streaked the silhouette
  top-edge highlight across every crown (near-white domes from the 52 deg camera).
- Region-limited glow erase (ERASE) on top of graded_projection: hood flame / Serenade hollow glow, painted seams,
  lantern panes, boss glow, the Serenade band; +7 px edge re-pad on the Serenade sheet (its pale rim-light outline
  left white streaks on the arms / shield edge).
- Hood lining vs hood inner surface interpenetrated after decimation (pale facets in the hollow): hood carve now
  1.2 cm outside the visible lining surface, lining 2.2 cm thick.
- Serenade lantern simplified (4 bars, larger accent globe), knob rounder, hood light smoother.
- Colours: Aubade hood #93A7BA (blue linen), cloak #62748A; Serenade felt #B0916C / mantle #B79A74, pads #AD9C80.
- Accent 6.2 % (A) / 7.4 % (S) at the game camera. Tris 3.18k / 3.32k, GLB 422 / 406 KiB.

## 2026-10-20 14:05 resumed (usage-limit break) - hollow + crown fixes
- Review of the 11:46 builds: Aubade hollow showed pale "shards", Serenade dome had a pale patch on the back
  (back-plate band-erase fill), tris 3.27k / 3.39k (brief target <= 3.0k).
- Serenade crown: `tops_full` (in the paint wrapper) re-blends the hood's top plate from n_z 0.10 (common paint
  uses 0.55-0.85) -> uniform felt over the whole dome, patch gone. Aubade hood gets the same from n_z 0.05.
- Hollow, three causes found one by one (flat-texture Blender renders with backface culling + face/texel probes):
  1. the rim's inward-facing tube faces took the rim's front paint -> `hollow_ink` inks rim / hood texels whose
     normal turns to the opening axis (inside the rim's centre line);
  2. the lining's palette-fit gain clipped at 0.2 (painted median 0.42) -> a mid-grey pool under the hood light;
     the lining is now pulled onto its ink (#101318 A / #15110D S);
  3. the Aubade scarf's top rose through the hollow floor -> scarf cut 1.5 cm under the carve, its inside inked.
  Also: `dilate_bake_maps` fills the rough/AO bakes between UV islands (common.bake leaves roughness 0 there and
  the 256 ORM mixed it into island borders); ORM 18K -> 9K.
- Tris trimmed (lining 380 -> 280, hood light 130 -> 80): 3118 (A) / 3244 (S); GLB ~395 KiB each.

## 2026-10-20 15:20 final pass (both factions rebuilt)
- Serenade opening lip fitted to a dark felt (#5C4A3B, brief §2.2 "dark felt rim"; it had read as a pale
  ring); hollow linings lifted a touch to navy #141A24 (A) / umber #1C150F (S) so they read as cloth.
- Gates: three.js load test OK, facing +Z, Aubade 3118 tris / 389 KiB / accent 6.21 % (63 % top half),
  Serenade 3244 tris / 395 KiB / accent 7.44 % (89 % top half); mesh top 1.089 / 1.087 m (content 1.1).
- 64 px IoU (scratchpad sil.py, front / game view): shieldwick A vs S 0.82 / 0.91 (>= 0.70); vs the other
  kinds max 0.75 front / 0.79 game (<= 0.80).
- Renders: three_shieldwick_{aubade,serenade}.png, three_clips_shieldwick_{aubade,serenade}.png,
  shieldwick_beauty.png (close 3/4), shieldwick_review.png (game camera, ally/enemy tints, lane crowd),
  shieldwick_clips.png (idle / run / attack1 / death strips, both factions).
- Note: a --clip-sheet three_snapshot hung once under heavy machine load (killed; rerun fine).

## 2026-10-20 15:47 FIX PASS start (independent review, 11 items)
- Majors: (1) hood light invisible at 52 deg on both (0.00 %), (2) painted defects (Serenade white patch under the
  right sleeve, white lantern-lid tip, white zig-zag cracks on both hoods, pale flecks in the S atlas top rows),
  (3) Aubade opening: porthole + thin jagged lip + shards + octagon pill vs the concept's arch + broad chalk rim +
  soft teardrop, (4) Serenade crown band lumpy / wavy / uneven -> clean inset glowing slit.
- Minors: ink grooves under accents (team-0 contrast), job silhouette (disc outline, mace), crisp hems, faceting
  on accent shapes + Aubade hood-back value step, stiffer clips (waddle, attack readability), tris <= 3.0k,
  Serenade accent 7.4 % -> spread, metallicFactor 0.

## 2026-10-21 00:10 FIX PASS 2 start (independent review, 13 items)
- Note: the 15:47 pass was rebuilt at 16:21 / 16:35 without a completion entry; its review sheets (beauty / review /
  clips, 15:18-15:20) predate those builds. Its "load test OK" (15:20) was stale: the 16:21/16:35 run clip FAILED
  the planted-foot gate (planted samples 0).
- Majors: (1) run gate, (2) Aubade accent 3.7 % and nearly gone from side/back, (3) Aubade value flat (bottom 54-73
  on screen), (4) Serenade collar front inked into a black slab, (5) Serenade shield pad ghosts, (6) Serenade crown
  band tilted / wavy. Minors: Aubade hollow (wedges, octagon lip, lens-like dot), arm/cuff/haft ghosts and side
  streaks, cone knob + needle rib, attack1 not an overhead chop, ground penetration (death / run hem), Serenade
  cream top + faceted lantern / mitts, stale docs and sheets.
- Tools: scratchpad review harness (the reviewer's three r186 + headless Chrome page: game camera 52 deg, AgX, sun
  2.6), value / accent analysis per facing (silhouette bands top 25 % / middle 50 % / bottom 25 %, mask accent %),
  proto/wick_shieldwick_motion.py (rig + clips solved in Blender in seconds: ankle / ball per run frame, the lantern
  core over attack1, hem + shield lowest point over death).

## 2026-10-21 00:40 run gate root cause + clips
- anim._solve_foot turns a positive `pitch` toes DOWN on this rig (it rotates about the foot's local X) while it still
  pivots a positive pitch about the heel: the stance foot's +6 "heel strike" sank the ball 13 mm, the -13 toe-off
  dropped the ankle 2 cm, so no frame was level. Shieldwick._ft() now takes a PHYSICAL roll (+ toes up about the
  heel, - heel up about the ball), picks the solver sign that turns the toes the asked way and corrects the ankle
  offset for the pivot the solver uses (off' = off + (I - R)(pivot_want - pivot_solver)); not a common-code change.
- run: contact 23 % (3 sampled frames flat: ankle 0.056 / 0.055 / 0.055, ball 0.011-0.012), heel lift only in the
  contact's last quarter; the waddle moved from the hips (roll 9 -> 4, pitch 7 -> 2) into spine / chest sway with
  the hood counter-rolled, crouch 2.4-4.4 cm (the rigid bell hem dipped 6 cm into the ground on the Serenade).
- attack1: shove -> the mace hauled overhead (arm at full reach over the shoulder, heels up 14 deg, the lantern core
  0.94 m, its cap over the hood crown) -> chop down and forward, impact at 40 % with the core 0.32 m in front at
  0.47 m -> follow-through 0.37 m -> recoil; the forward pitch is in the spine / chest (the hips pitch dipped the hem).
- death: DEATH_LIFT raises the sit / tip / lying keys (A 9 / 17.5 / 11 cm, S 15 / 25 / 16 cm) so the cloak and
  shield rest on the ground.

## 2026-10-21 01:00 Aubade: accent, hollow, knob, rib, values
- Accent: a hood-hem trim (accent piping round the cowl's lower edge from one chin corner round the back) + the
  seam beads raised 7.5 mm; the shield's inlay ring became dawnglass (with the trim the accent ran to 6.4-7 %).
- Hollow: an ink cup (MeshPart) from just inside the chalk rim back into the hood hides every carved inner surface
  (wedges, octagon lip); the rim's inner wall shortened to 1.6 cm. The hood light is ONE low dome of lamplight,
  16 x 6 cm, rising from behind the chin (crest 3.4 cm behind the opening) - not an oval floating mid-hollow (an
  isolated oval still read as one pupil from 52 deg).
- Knob: a smooth 12-segment lathe of the concept's knob (disc, ball, small round top; 8.6 cm over the dome). Rib: a
  flat blade 5.6 cm wide, 4.5 cm where it crosses the rim, rising to a blunt spire 6 cm over the rim.
- Guard: the shield 4.5 cm further out (its spire tip crossed the hood opening at the 52 deg camera: the "pale
  triangular shard" inside the hollow).
- Values: wool #4E5D70 -> #485769 + a RAMP by height (cloak x0.30 at the hem -> 1.0 at the shoulders, stole, shield,
  hood x0.52 at the flare -> 1.0 at the crown, rim), hem band #252A30.

## 2026-10-21 01:15 Serenade: face, band, shield, lantern, felt
- The collar is no longer inked by the carve (the black slab); the collar front is continuous felt.
- Crown band: a horizontal ring at z 1.00 (36 stations on the sculpted dome); the opening lowered 1.5 cm so the
  band's lower edge sits on the lip's top (the concept's straight glowing slit at brow height).
- Shield: the dome's ochre (projected pad) texels refilled from its own ironstone paint; the pads are smooth oval
  lathe discs following the dome slope, painted on their own geometry (sandstone, groove loop, bevelled edge).
- Lantern: smooth lathe globe (15.6 cm) and domed lid, cage hoops outside the globe. Felt #94795A / #9F8561 (39 %).

## 2026-10-21 01:25 both: ghosts and streaks
- CLEAN: texels far from their part's median (value or colour) are refilled with the part's paint-by-height field
  (a nearest-texel UV fill had left angular patches on the dome), SIDES: side-facing texels get that field too, and
  ZONES: the cloak's flanks where the concept paints arms / fists / cuffs / haft (both plates) get it whole.
- Mitts: smooth lathe mittens with a thumb lobe; Aubade wraps / Serenade cuffs: smooth ribbon rings.

## 2026-10-21 01:38 builds (both factions, --clip-sheet)
- Gates: three.js load test OK both (run: planted samples 2, foot-speed error 0.1 %), facing +Z, mesh top
  1.090 / 1.087 m (content 1.1).
- Aubade 3012 tris / 353 KiB / accent 5.73 % (top half 76 %); Serenade 3066 tris / 344 KiB / accent 4.72 % (85 %).
- Accent per facing (game camera, 3x): A 4.7-7.9 % (side / back 4.7-5.9; was 2.0-3.5), S 3.8-6.8 %.
- On-screen L* (top / middle / bottom, median of 8 facings): A 70 / 63 / 38 (was 71 / 69 / 59), S 75 / 52 / 36
  (was 80 / 55 / 51). Aubade facing 315 deg bottom = 62: there the bottom quarter is the shield face (the job read;
  its paint is ramped to x0.42 at the bottom edge but stays chalk).
- Ground: skinned-vertex minimum >= -1.3 cm in run / attack1 / death (was -6 / - / -22 cm).

## 2026-10-21 01:46 FIX PASS 2 done
- 64 px IoU (front / game camera): shieldwick A vs S 0.81 / 0.88 (>= 0.70); vs the other kinds of the same faction
  max 0.69 front / 0.76 game (<= 0.80).
- Fit overlays re-rendered (shieldwick_fit_{aubade,serenade}.png); review sheets regenerated from the final GLBs with
  whole-wick framing: shieldwick_beauty.png (close orbit + details, both factions), shieldwick_review.png (game
  camera 8 facings x ally / enemy tint + lane crowd 1:1 and 2x), shieldwick_clips.png (run / attack1 / death / idle
  strips + a larger attack1 strip). three_shieldwick_*.png / three_clips_shieldwick_*.png are the pipeline QA (its
  close row uses the fighter framing - common code, not changed here).
- Open / accepted: the Aubade hood light deviates from the concept's teardrop (brief §0.2 wins); at the 315-degree
  facing the Aubade bottom quarter is the chalk shield face (on-screen L* 62); tris 3012 / 3066 sit a little over
  the brief's 3.0k target (CONTRACT 1.5-4k); common/anim._solve_foot's pitch sign is inverted on the VALE minion rig
  (worked around in Shieldwick._ft, the shared code is untouched).

## 2026-10-27 08:50 resumed (session break) - FIX PASS 3 (review 2026-10-21b, 11 items) was in progress, unlogged
- Found in the module (02:58 Oct 21, after the last builds at 02:53): item 1 Serenade opening cut flush into the dome
  (no stand-off felt visor), 2 hood lights (Aubade: the concept's chalk dish + teardrop flame + painted spill, flat
  rounded-trapezoid opening; Serenade: glow welling up from the bottom of the arch), 3 the guard carried in front
  of the left chest (25 cm forward, face 45 deg out, rim clears the outline from the off side / back), 4 + 11 cloak hem
  follows the thighs (run / death), Serenade attack raise to full reach, 5 Serenade dome fitted on its outer felt,
  6 paint v2 (painted folds from the sculpt normals, strokes, procedural small hard parts), 7 Aubade flat front plane
  (no porthole brim), 8 round knob (no point on the hood), 9 lamp panes = culture glass with an accent core,
  10 turned / lathed game meshes for round outlines.
- The 02:53 GLBs (A 3166 tris / 350 KiB / accent 5.09 %, S 3122 / 323 KiB) predate the last module edit: rebuild.

## 2026-10-27 09:25 FIX PASS 3 finished (both factions rebuilt, --clip-sheet)
- Review harness rebuilt (the scratchpad copy was wiped): art/.cache/shieldwick_review/review.mjs (three r186, the
  three_snapshot renderer settings; modes review / beauty / clips / metrics / sil). Rebuild of the 02:58 module first:
  A 3262 tris / accent 5.05 %, S 3138 / 4.97 %; Aubade front 4.3 %, Serenade back facings 3.3-3.8 %.
- Aubade opening: the rounded trapezoid's top widened (r2 3.0 -> 5.2 cm): a broad round-topped arch, no peaked
  opening in the pale hood (rule 0.1, brief §2.1 "a rounded arch"). Flame kept as the concept's teardrop on its dish,
  shortened to 5.6 x 8.5 cm (a squat bud was tried: from the 52 deg camera it read as a round pupil).
- Accent: Aubade seams 2.3 -> 2.8 cm (sides 2.3, hem piping 2.4), the shield's inlay ring back to accent and lifted
  onto the GAME disc's face (it sat on the sculpt's face, buried under the lathe disc - that is why it never showed);
  Serenade crown band 2.6 -> 3.3 cm and a new accent cord along the mantle hem (front flaps round the back).
- Ribbons buried in the host's creases (the Aubade brow seam had a gap and a stray triangle): MeshPart.snapped moves
  each station onto the host's decimated game mesh (SNAP: hood_seam/crown_band -> hood, mantle_trim -> mantle);
  the brow seam needed denser stations too (27 / 18), the chords cut the flat front's edge. Mantle 150 -> 190 tris.
- Lathe trims: flame / dish 8 seg, Aubade boss 12, Serenade lid / globe / core 10.
- Gates: three.js load test OK both (run planted samples 2, foot-speed error 0.1 %), facing +Z, mesh top
  1.075 / 1.087 m (content 1.1). Aubade 3296 tris / 346 KiB / accent 6.07 % (top half 67 %); Serenade 3246 tris /
  328 KiB / accent 6.40 % (68 %). Pipeline warns above 6 % (bible 2-6); the task's minion aim is 6-12 %.
  Per facing (3x game camera): A 4.8-8.3 %, S 5.1-8.4 %. On-screen L* top / middle / bottom (median of 8 facings):
  A 71 / 63 / 37, S 73 / 50 / 40.
- 64 px IoU (front / game): shieldwick A vs S 0.79 / 0.85 (>= 0.70); vs the other kinds of the same faction
  max 0.68 front / 0.70 game (<= 0.80; their GLBs were being rebuilt by their owners at the same time).
- proto/wick_shieldwick_fit.py takes the (sculpt, game mesh) tuple parts (it crashed on them); fit overlays
  re-rendered. Sheets regenerated: shieldwick_review.png, shieldwick_beauty.png, shieldwick_clips.png,
  shieldwick_fit_{aubade,serenade}.png, three_shieldwick_*.png, three_clips_shieldwick_*.png.
- Open: tris 3296 / 3246 over the brief's 3.0k target (CONTRACT 1.5-4k); the cloak game mesh is a little faceted
  at close range (fine at the game camera); common/anim._solve_foot's pitch sign (worked around in Shieldwick._ft).

## 2026-10-27 09:40 FIX PASS 4 start (independent review 2026-10-27, 14 items)
- Majors: (1) Serenade lantern-mace broken (decimated cage = crumpled flaps + shard, globe hidden, core a strap round
  the outside), (2) paint = untextured clay (flat fills, chopped atlas, no linen / felt / chalk / iron, no painted folds),
  (3) accent built from 2.3-3.3 cm hairlines (< 1 px at 720p), hood light 2-3 px front-only, (4) Serenade hood light =
  hard lozenge on the lower lip (tongue / mouth read). Minors: (5) Aubade panes = inset gems, (6) rib tilted 30 deg +
  past the rim (propeller) + bullseye inlay, (7) thin frame with a net / zig-zag scroll, (8) sleeve shards, stole smudge /
  torn ends, (9) ragged Serenade mantle cord / crown band, (10) bone-cream Serenade dome, (11) faceted boots / mitts /
  hood, (12) floaty run, (13) shield sinks 5-6 cm in death, (14) tris over 3.0k, QA close row unusable.
- Harness: the reviewer's rv.mjs adopted as art/.cache/shieldwick_review/review.mjs (+ modes hero, close, --src preview,
  --dbg rough|albedo; feet now reports the body minimum without the shield hand); proto/wick_shieldwick_preview.py snaps
  ribbons like the build.

## 2026-10-27 10:31 FIX PASS 4 done (both factions rebuilt, --clip-sheet)
- (1) Serenade lantern rebuilt from turned / swept game meshes: ironstone base cup, LAMPRESIN bowl, the globe itself the
  ACCENT light (14 cm, the brightest thing on the figure as in the concept), four ironstone cage bars (4-sided tubes),
  domed lid with a round knob. Reads as a caged lantern at close range and as a lit globe at the game camera.
- (3)+(4) Hood lights: a LIT INNER RIM on both (a closed loop of even width round the opening: Aubade 3.6 cm accent band
  between the chalk frame and the hollow; Serenade a 3.4 cm accent half-tube along the arch's rolled edge, collar to
  collar) - visible on the 0 / 45 / 315 facings of the 52 deg camera; the Serenade floor lozenge is gone (the sill is
  inked dark from the opening), the Aubade flame grew to 7 x 11 cm. Bands >= 4.6 cm, flat-topped: Aubade crown seam 5.0
  (side seams dropped), hood-hem band 5.1; Serenade crown band 5.3, mantle band 4.6 (sides and back only); boss 12.8 cm.
  Ribbons snap onto their host with SMOOTHED offsets (+-2..4 stations, 2.5 mm lift); the Serenade mantle is a game mesh
  sampled on the sculpt (no ripple in the back hem), the band laid on the felt-free mantle field.
- (5) Aubade lantern: two tall lit panes per face (accent block, chalk mullion) in dawnglass. (6) AimUp (anim._solve_aim
  wrapped for AimUp only): the shield's rib held upright (front-view tilt -7 deg = the 10 deg face tip; was ~30), rib
  ends at the rim, the inlay ring removed, boss 12.8 cm in a dawnglass ring. (7) Frame 4.2 / 5.6 / 3.6 cm with a broad
  running scroll (15 cm waves, lit lip, raised bosses), border fillets, block joints. (8) Wraps / cuffs are turned bands
  on the sleeve radius; the stole is two hand-built strips with clean points; the cowl's front under the frame takes the
  linen field (the concept's scarf / stole tops had smeared onto it); scarf procedural.
- (2) Paint v3: form light, sculpt-curvature edges / cavities (SDF Laplacian), material textures (linen threads, wool,
  felt fuzz + fibre flecks, chalk grain + pits, iron pitting, sand, wood grain, leather, glass sheen), warm-light /
  cool-shadow temperature, stronger painted folds and brush strokes, painted running stitches (hood seams, hem bands,
  stole edges, crown / mantle bands), the Serenade shield laid in stone plates with lit rivets, boot welts / toe caps.
  Texel weights per part (hood 2.2, shield 1.6, cloak 1.5 ... lining 0.08) and the hood's hidden interior / underside
  faces culled (127 A / 108 S): the readable parts own the atlas. Normal map 512 (brief §1 allows it), AO into base 0.42.
- (10) Serenade felt fitted hue-preserving ("tone": the texel takes the target colour at its own luminance; the old
  per-channel gain multiplied the felt's blue x2.2 and turned every lit plane bone-cream): dome #A6825E (caramel at the
  marigold band's 40 % limit; concept median #B88957), mantle #9C7853.
- (11) Boots: turned loaf + shaft (10 seg, flat sole), mitts 10 seg, Aubade hood 420 tris. (12) Run: hips bob 3.1 cm
  (lowest at mid-stance), ankle apex 6.3 cm (was 13 cm lift / 2 cm bob); contact stays 23 % (a 0.31 m leg at 3.25 m/s is
  a sprint: Froude 3.5, the planted stride is at the leg's reach). The 1.3 cm mid-contact ankle dip at 24 samples is
  three.js slerp between 30 fps keys (10.8 cm of foot travel per key) - inherent to the export rate, noted.
- (13) Death: the shield hand drawn 6 cm toward the chest in the lying keys; three.js skinned minimum at t=1: A -0.3 cm,
  S 0.0 cm (was -4.7 / -5.9), worst frame -2.1 cm with 2-3 vertices under -2 cm (was 68 / 182). attack1 >= -0.6 cm.
- (14) Tris A 2923 / S 2908 (brief <= 3.0k). three_<id>.png's close row is the common QA framing (not changed);
  close review sheets added instead: shieldwick_hero.png (3/4 front + back at 1100 px), shieldwick_close.png (frame,
  lantern, shield, boots, back), shieldwick_true1x.png (1:1 1080p crops, nearest x3).
- Gates: three.js load test OK both (run 12 f, planted samples 2, foot-speed error 0 %), facing +Z, mesh top 1.075 /
  1.087 m (content 1.1), GLB 356 / 333 KiB. Accent (pipeline QA) A 8.03 % (top half 65 %), S 11.62 % (74 %); per facing
  at the game camera A 6.0-11.3 (mean 8.0), S 10.5-13.3 (mean 11.7) - inside the task's 6-12 % minion aim (the pipeline
  warns above 6 %, the brief's 4.5-6 %). On-screen L* top / mid / bottom (median of 8): A 74 / 66 / 37, S 75 / 48 / 39.
  64 px IoU front / game: A vs S 0.82 / 0.84 (>= 0.70); vs the other kinds of the faction max 0.63 / 0.70 (<= 0.80).
- Sheets: shieldwick_review.png, shieldwick_beauty.png, shieldwick_clips.png, shieldwick_hero.png, shieldwick_close.png,
  shieldwick_true1x.png, shieldwick_fit_{aubade,serenade}.png, three_shieldwick_*.png, three_clips_shieldwick_*.png.
- Open: the Serenade front (52 deg, facing 0) reads as a dark doorway under a lit arch - watch for a mouth read in review;
  the atlas is still the pipeline's smart-project layout (weighted, not re-cut); the paint is a clean painted-stylised
  read rather than the concept's dense brushwork; common/anim._solve_foot's pitch sign (worked around in Shieldwick._ft).

## 2026-10-27 10:43 FIX PASS 5 start (independent review 2026-10-27b, 10 items)
- Majors: (1) Serenade opening = squat slot (1.4:1) under a lit "upper lip", black boxy hollow, glossy bronze sill ->
  mouth read; no lamplight inside; (2) Serenade mantle = short flat shelf (stacked-burger back), jagged front edge by
  the shield arm, blue mantle-band shards poke through; (3) Aubade accent ribbons broken (hem-band ends stick out as
  blades at the chin corners, black shards where band meets hood, crown seam = a detached tab beside the knob).
- Minors: (4) Aubade hood light = faceted glossy gem, (5) faceting (hem, collar, pads, wraps, mitts, inner planes),
  (6) paint short of premium (faint rim scroll, notched stole tops, ghost line on the S chest), (7) attack1 head stays
  inside the hood outline in the raise, (8) run = bounding sprint (60 % flight), (9) Serenade pads small buttons, lantern
  globe two-tone, (10) accent 8.0 / 11.6 % vs brief 4.5-6 %.
- Module backed up: art/.cache/shieldwick_review/wick_shieldwick_1027_pass5_start.py

## 2026-10-27 11:05 fix pass 5 - geometry + motion changes (preview-checked), first builds running
- Serenade hood: SE_ARCH a tall round-topped door (hw 0.118, top a superellipse n 2.5 15 cm tall to z 0.972, sill
  0.75: ~1.07 : 1 face-on, was 1.4 : 1); a sculpted rolled felt rim (tube 1.9 cm along the arch, blended into the dome,
  inner edge carved; painted a step darker + groove: se_rim_paint) reaching the crown band, now at z 1.03; the accent
  half-tube on the arch REMOVED (the lit "upper lip"); the hood light is one soft glow mound on the hollow floor 8.5 cm
  behind the opening, 14.4 x 10.8 cm, 4.4 cm tall (12-seg smooth lathe), spill painted round it on the lining
  (#8A8379 x 0.42); cavity enlarged so the opening's lower corners carve through; hood 520 tris (was 380).
- Serenade collar: 14 cm roll (rz 0.069, was 0.084) tipped 6 deg (was 11: its back rose to 0.85 and hid the mantle),
  front dip to the 0.75 sill; role cloth (felt, was ironstone - the glossy sill), game mesh sampled round the roll
  (24 x 7, the hidden inner side left out) instead of the lumpy decimated 140-tri torus.
- Serenade mantle: draped cape - hem 0.552 at the back centre rising (cos^2.2) to rounded corners 0.62 over the arms,
  front lapels 0.556 with a V to 0.66, rolled hem edge, 5 broad drape folds; 30 stations; mantle accent band REMOVED
  (it poked through; brief accent list does not have it); a painted running stitch along the hem; colour #A8875F.
- Serenade shield pads: four rounded rectangles 9.6 x 13.2 cm (superellipse n 3) whose vertices lie ON the dome face
  (pad_mesh), was 9.6 x 8 cm ovals; pad paint uses the same metric. Lantern bowl cut to a small amber foot (the
  globe no longer reads two-tone).
- Aubade seam starts AT the frame's top edge (no taper there), 26 stations by arc length, passes under the knob;
  hem band from the sides round the back only (phi -14..194, 21 stations), its ends tapered into the linen; SNAP_BIAS
  4 mm (seam/band) so the decimated cowl does not poke through as dark shards; hood 480 tris.
- Aubade flame: rounder soft-tipped bud, 10 sides; accent roughness 0.9 (was 0.25: glossy gem highlights).
- Faceting: cloak game meshes 32 (A, 4 per hem point) / 30 (S) stations; wraps 10, cuffs 12, mitts 12 + thumb 8.
- Matte: ROUGH overrides in the roughness bake (lining 1.0, carved hood 1.0, S collar 0.97); AO floor 0.8 on the stole
  (the scarf's occlusion notched its tops). Frame scroll groove broader / deeper, lit lip brighter.
- run: 8 frames (7.5 steps/s), contact 34 % (3 planted samples), swing apex 4 cm, crouch 3.2 cm + 2.2 cm bob (the
  leg reaches the landing foot); motion proto: f0-f2 ankle 0.055 / ball 0.011, both feet up only ~32 %.
- attack1 wind-up: wrist out and back at full reach, haft tipped out (-0.40, 0.42, 0.81): lantern core A x -0.40 /
  z 0.89 (top 1.03), S x -0.35 / z 0.94 (top 1.04) - outboard of the hood (its edge x -0.18), was x -0.20 over the head.
- Preview tris (before hood cull): A 3422, S 3458.

## 2026-10-27 11:50 fix pass 5 - build iterations (both factions)
- Build 1 looked at close range (scratchpad head / hood orbits + albedo / roughness debug renders):
  * Serenade: the painted spill lit the lining's big flat facets grey (the "low-poly box") and the lining's front floor
    strip pale (the "bronze sill"); the carve ink started behind the new rolled rim, leaving the rim's inner roll and
    the arch walls pale felt -> spill now only a floor halo round the mound (never walls, never the front strip), and
    an "open" ink pass in hollow_ink: every hood / collar texel inside the arch outline, behind the front and in the
    cavity takes the carve ink (the collar's front crest stays felt: the matte dark-felt sill); se_rim_paint's groove
    only on the dome side of the roll.
  * The mantle's shoulder ellipsoid made a ridge under the collar (a second roll from the back) -> removed; later the
    hood skirt's round foot showed under the slimmer collar the same way -> hood cut level at z 0.70 (inside the collar).
  * Pale slivers in the albedo debug = HOLES: cull_hidden removed the carved walls from 3 cm deep, the lining started
    behind them and the background showed through -> lining origin moved to the opening (S y -0.188, A w 0.014), rays
    to +-88/89 deg; the Serenade keeps its tunnel walls (cull from 20 cm), the Aubade from 5 cm. Aubade gets the same
    "open" ink (its top-corner specks).
  * Glow mound from the 52 deg camera read as a round disc -> 13.2 x 6.8 cm, 3.2 cm tall, 9.6 cm behind the opening,
    16-sided (about 1.7 : 1 on screen).
  * Aubade hem band: its side ends flared past the cowl as blades in the back view -> back half only (phi 8..172), set
    1 cm higher; its ink groove narrower (6 mm). Lit inner rim 3.2 cm (was 3.6).
- Builds (--clip-sheet): three.js load test OK both (run 8 f, planted samples 2, foot-speed error 0 %), facing +Z,
  mesh top 1.075 (A) / 1.085 (S) m (content 1.1).
  Aubade 3291 tris / 367 KiB / accent 8.53 % (top half 71 %); Serenade 3374 tris / 346 KiB / accent 8.72 % (90 %).
  Per facing at the game camera: A 6.8-11.7 (mean 8.4), S 7.0-11.4 (mean 8.6) - Serenade down from 11.6; both inside
  the task's 6-12 % minion aim, over the brief's 4.5-6 (and the pipeline's 6 % warning).
  On-screen L* top / mid / bottom (median of 8 facings): A 73 / 65 / 37, S 70 / 50 / 39.
  64 px IoU front / game: shieldwick A vs S 0.82 / 0.86 (>= 0.70); vs the other kinds of the faction max 0.61 / 0.69.
  three.js run (24 samples / 0.267 s): a foot on the ground in 14 / 24 samples, both ankles over 7 cm in 2 / 24 (was
  stance ~20 %, flight ~60 %); stance ankle dips 1.1 cm between the 30 fps keys (boot sole -1.1 cm, as before).
  attack1 / death skinned minimum -0.6 / -2.1 cm (2 vertices under -2 cm in death).

## 2026-10-27 11:56 FIX PASS 5 done (final builds: Aubade 11:42, Serenade 11:53, both --clip-sheet)
- Last Serenade change: the floor halo round the glow mound toned down (#7A7268 x 0.32: at 0.55 a lit floor facet read
  as a pale wedge in close-ups). Numbers as in the 11:50 entry (Serenade 3374 tris / 346 KiB / accent 8.72 %).
- Review items: (1) S opening: tall round-topped arch ~1.07 : 1 + rolled dark-felt rim to the crown band, no accent on
  the rim, one soft low glow mound set back in an inked, matte hollow, matte felt sill; (2) S mantle: draped cape
  (curved hem, rounded corners, lapels), no band, no shards; (3) A seam from the frame's brow under the knob, hem band
  on the back half with sunk ends, 4 mm lift; (4) A flame: rounder soft bud, matte accent (roughness 0.9 on every
  accent); (5) faceting: clean sampled collar (24 x 7), cloak 32 / 30 stations, conforming 14-sided pads, 10-12-sided
  wraps / cuffs / mitts, hood 470-480 tris, hollows inked + roughness 1; (6) paint: broader frame scroll, stole AO floor,
  no chest ghost line seen under the new mantle; the paint is still the procedural v3 layer, not the concept's brushwork
  (open); (7) attack1 wind-up outboard of the hood (core x -0.40 / -0.35, top 1.03-1.04); from the side-on game camera
  with the mace toward the camera it shows beside / below the hood, not above it (an arm 0.19-0.22 m long cannot lift a
  0.16 m head clear over a 0.33 m hood); (8) run 8 f / 34 % contact; (9) big pads, single-tone lit globe on a small amber
  foot; (10) accent S 11.6 -> 8.7 %, A 8.0 -> 8.5 % (task aim 6-12, brief 4.5-6).
- Open: accent above the brief's 4.5-6 % (inside the task's 6-12 % minion aim); tris 3.29k / 3.37k over the brief's 3.0k
  target (CONTRACT 1.5-4k; the review asked for 400-800 more tris on the silhouettes); stance ankle dip 1.1 cm between
  30 fps keys; tiny background specks may remain at the Serenade hollow's floor corners in extreme close-ups;
  common/anim._solve_foot's pitch sign (worked around in Shieldwick._ft).

## 2026-10-27 13:40 FIX ROUND 3 start (review 2026-10-27c: score 5.5, 3 open majors + the in-game notes)
- Majors: (1) Serenade opening broken up close (crumpled grey polygon ring on the arch's inner lip, felt triangles at
  the upper corners, a sliver at the lower left; the light a flat hard half-disc on the sill = a tongue at eye level, a
  pupil from 52 deg); (2) Aubade seam = tape peeling off (free front end lifted above the brow, runs beside the knob, a
  chalk chip at the knob's base; dark cracks in the lit inner band); (3) paint not premium / not Art 2.0 (clean
  procedural fields, no felt fuzz / linen folds / brushwork, a doodled chain of 'o' circles on the Aubade frame, faceted
  tube arms, grey-ball mitts). In-game: Aubade blue-grey under the ally azure and Serenade tan under the enemy marigold
  read weakly; hood light small from above; surfaces flat, like tidy toys.
- Shared targets of the round: one soft ellipsoid core centred in the opening (no slab / disc / mouth / eye), Art 2.0
  paint, team read for every viewer (no large area in a reserved hue band over 40 % sat, accent-vs-surround contrast
  measured in game from both seats), hoods L* <= 65 and under the fighters after B5, gates (tris <= 3.0k, accent
  4.5-6 %, clips, three.js QA).
- Module backed up: art/.cache/shieldwick_review/wick_shieldwick_1027_r3_start.py

## 2026-10-27 fix round 3 - what changed (module wick_shieldwick.py; wick_common.py untouched)
- HOOD LIGHT (both): the Aubade lit inner rim, ink cup, chalk dish and flame and the Serenade floor mound are gone. One
  smooth accent ellipsoid core (8 x 6 turned, 80 tris), 10 x 6.2 cm face-on (1.6 : 1), centred vertically in the
  opening, its front 3-4 cm behind the opening / brow, dark throat above, below and to both sides. Its soft falloff is
  painted on the throat's walls and back round it (hood_light_paint + light_falloff: a dim team-neutral lamplight at the
  core's outline, falling off fastest there, measured in core radii so the glow is wider than tall). The accent stays
  factor-only (shared load test), so the nested shell is paint, not a second emissive. Tried and dropped: a halo dish
  behind the core (lit by the room + AO-floored it read as a grey ring round an iris, builds 1-2) and a 2.15 : 1 core
  (a horizontal dash = a slot at the game camera, build 2).
- THROAT (both): one clean hand-built inked tube (throat_mesh) from the opening's lip to a round back cap replaces the
  decimated carve + lining. Aubade: its lip tucks under the chalk frame's inner edge and rolls in over the edge; every
  hood face inside the frame's inner edge is culled (cull_hidden; first try also culled the hood's BACK - the depth
  window w < 4.5 cm fixes that). Serenade: the dome's game mesh is now SAMPLED on the sculpt (lathe_low, 22 x 8, clean
  round dome) and its door hole conformed exactly under a hand-built rolled dark-felt rim (conform_hole + a 5 x 17 roll
  that curls into the throat; rim_tube_paint inks its inner side) - no decimated carve edge anywhere, no felt
  triangles, no slivers; the throat's floor sits on the collar's sill.
- AUBADE SEAM: centred on the arch (x of the frame), starts 1.4 cm inside the chalk frame's outer edge (under the
  frame: no free end), passes under the knob, tapers into the nape; an inlaid profile (SEAM_BAND: 3 mm proud, bevelled
  edges sunk 7.5 mm) so no edge lifts off the cowl; the knob stands ON the seam with a 3.5 cm base disc covering the
  crossing and sinking 4-5 mm into the cowl (no chip); wider, darker ink beds (x0.20 / x0.24).
- PAINT v4: the raw projection's brushwork carried onto the finished paint (concept_detail: the luminance ratio over a
  4.5 cm 3D low-pass + its chroma strokes, front / back-facing texels only, arm-ghost zones excluded) on hood, cloak,
  scarf / mantle, collar, stole, the mace sleeve; stronger material texture (linen 2.0, wool 2.2, felt 2.4) and sculpt
  edge light / cavity (EDGES +25-40 %); the Aubade frame relief is a running scroll with carved VOLUTES curling out of
  the wave (the raised 'o' bosses are gone); the Serenade cloak under the mantle shades into its shadow (the pale wedge
  in the mantle's V is gone).
- ARMS: sleeves are smooth 8-sided tubes sampled from the sleeve radii with capped ends (the sculpt stays the bake
  source); the mace hand is a mitten FIST (fist_mesh: a drum turned round the haft, the back of the hand toward the
  wrist, a wrist neck, the thumb over the haft); mittens are cloth (blue-grey wool #66727F / umber felt #6A5546, matte,
  AO floor 0.78 - the haft through the fist had baked them near-black and glossy).
- TEAM READ / VALUES (FACTION_PALETTES unchanged; the per-part fit targets moved): Aubade linen #93A7BA -> #727880
  (L* 50, 11 % sat, toward the palette's cloth2 208 deg / 6 %), wool #485769 -> #4A5562, hood chalk (frame, knob)
  #C9C5BB -> #A5A197 / #ABA79D, dawnglass round the boss and the lantern core DEEP (#4F6276 / #55687C: pale blue glass
  round an azure-tinted core hid it); Serenade dome #A6825E (43 % sat - over the 40 % limit in the marigold band)
  -> #86735F (30 %), mantle #A8875F -> #9A866F, pads #BC9C6E -> #AE9A7C, cloak 36 -> 32 %; crown band 5.1 -> 3.7 cm
  with a darker bed.
- Budget: hood light / throat / seam / knob / rim rebuilt lean, wraps 10, shield 16-18, boss 10, ring 12-14, globe 9,
  cage bars 2 segments, pads 12, Serenade cloak 26 stations, mantle 26, collar 20 x 6, boots 9.

## 2026-10-27 15:30 FIX ROUND 3 done (5 builds, both factions; final with --clip-sheet)
- Gates: three.js load test OK both (run 8 f, planted samples 2, foot-speed error 0 %), QA OK, facing +Z; clips idle
  72 f / run 8 f / attack1 25 f (impact 0.4) / death 40 f. Aubade 2931 tris / 357 KiB / pipeline accent 5.74 % (top
  half 73 %) / mesh top 1.08 m / 56 px; Serenade 2995 tris / 339 KiB / 5.95 % (87 %) / 1.086 m / 57 px (brief: <= 3.0k,
  <= 500 KB, 4.5-6 %, >= 60 % top half, 1.1 m +-5 %). Ground (three.js skinned minimum): run -1.1 cm, attack1 -0.7 cm,
  death -2.1 cm with 2-3 vertices under -2 cm (as round 2).
- Review harness (game camera 3x, 8 facings): accent A 4.8-6.5 % (mean 5.7), S 4.6-8.6 % (mean 6.0); on-screen L*
  top / mid / bottom median A 63 / 55 / 36 (was 73 / 65 / 37), S 64 / 49 / 39 (was 70 / 50 / 39).
- IN GAME (scratchpad ingame.mjs + ingame_measure.py: a real RIFT match, seed 7, 1080p High, gameplay zoom 28.5, the
  same frame re-rendered with one faction's shieldwick crowd materials swapped to mask colours; t 78 / 86, after the B5
  rebase; team 1 is seat 5 - rift has 5 per team, so the wiring step's "seat 1" was still the west viewer):
  * hood (top quarter of each wick) L* A 46.5-52.9, S 51.6-52.9 (round 2 GLBs, same frames: 65.4-72.3 / 64.2-66.9);
    the fighters' top quarter is 59-67 in game (B5 report): the hoods sit under them, the light-top / dark-feet
    gradient holds (mid 24-43, feet 8-20).
  * accent vs its surround (1-4 px ring), dE2000 / dL*: west viewer - Aubade under the ALLY azure 22.3-25.4 /
    +10..+16 (was 15.8-16.6 / +4..+5), Serenade under the ENEMY marigold 30.4-30.5 / +25 (was 17.8-19.2 / +14); east
    viewer - Aubade under the enemy marigold 39.1-41.4 (was 31.9-37.6), Serenade under the ally azure 35.0-35.9 (was
    38.1-38.8). No large body area in a reserved band above 40 % sat (the Serenade dome was 43 %, now 30 %).
- Checks: typecheck OK, probe 40 / 40, content build + --check OK (80 warnings, all fighter-lane assets not built yet).
- Renders: three_shieldwick_{aubade,serenade}.png, three_clips_shieldwick_*.png (pipeline), shieldwick_hero.png,
  shieldwick_review.png (8 facings x ally / enemy + lane crowd), shieldwick_true1x.png, shieldwick_beauty.png,
  shieldwick_close.png, shieldwick_clips.png, shieldwick_fit_{aubade,serenade}.png; scratch review set (eye-level front /
  3/4 / side / back, hood close-ups, 52 deg x10, in-game crowds from both seats before / after) in the session scratchpad
  wick_shieldwick/.
- Open: the core itself is one flat emissive (factor-only accent), so up close its own outline is crisp - the softness is
  the painted throat glow round it; the paint is the concept's brushwork over palette fields + procedural material /
  edge / cavity layers, richer than round 2 but not a full hand-painted texture (the Serenade dome reads a little
  plaster-like up close); Serenade-under-ally-azure contrast dipped 38 -> 35 dE2000 (still high); common/anim
  _solve_foot's pitch sign (worked around in Shieldwick._ft).
