# HIT PARADE - Character Roster Scout (Mixamo library)

Status: COMPLETE. All 80 FBX in `F:/games/forgeflow-games-assets/_downloaded/mixamo/characters/`
were imported, measured and rendered with no failures (80/80). All 14 contact sheets and
all 7 lineup sheets were opened and looked at before any description below was written.
`classification.json` was used only as a label to compare against; many of its labels are wrong
(see "Label errors").

## Outputs
- `metrics.json` - per-character numbers (80 entries) + `roster_recommendation` block
- `sheets/sheet_01.png` .. `sheet_14.png` - 6 characters per sheet, front + three-quarter,
  each labelled with the file name, height, triangles, material count, texture count/size/MB,
  rest pose, bone count. `sheets/index.json` says which files are on which sheet.
- `sheets/lineup_*.png` - the recommended groups side by side, scaled to target game heights
  (1 m / 2 m guide lines), for silhouette comparison.
- `renders/<name>_front.png`, `renders/<name>_34.png` (400 px, transparent background, composited
  on mid-grey in the sheets) and `renders/<name>.json` (raw metrics).
- `_zoom/` - close-up crops used to check details (heads, chest prints, the Mutant chest mark).

## Method
- `tools/research/render_mixamo_roster.py` (Blender 5.1.2 headless, `import_scene.fbx`, Eevee):
  empty scene per file, armature set to REST pose, framing from the evaluated mesh vertices of
  every visible mesh, orthographic camera, 400x400, "Standard" view transform, 3 sun lights
  (key / fill / rim) placed relative to the camera, grey ambient world.
  Front view = camera on -Y (characters face -Y after import; faces are visible in every front
  render). Three-quarter view = 38 deg toward the character's left, 10 deg up.
  Scouting look: the imported specular / glossiness / roughness maps were unlinked and roughness
  set to 0.62 before rendering (with them linked, Ch15 rendered glittery/wet - seen in the first
  test render). Albedo and normal maps are kept, so colours and clothing are what the textures say.
- `tools/research/run_roster_batches.py`: one Blender process per <=10 files or <=450 MB of FBX
  (10 processes), resume-safe, logs to `render_log.txt`. Every process exited rc=0.
- `tools/research/compose_roster_sheets.py`: contact sheets + height-normalised lineups (PIL).
- `tools/research/aggregate_roster_metrics.py`: merges the per-file JSON into `metrics.json`.
- `tools/research/dump_fbx_textures.py`, `probe_untextured_materials.py`: one-off checks.

Measurement definitions (all in `metrics.json`):
- triangles = sum over meshes of (polygon corners - 2); vertices = mesh vertex count.
- texture count / MB = unique image files (deduplicated by source file name) referenced by image
  nodes of the materials; bytes = embedded (packed) data size, or the file on disk if external.
  Every texture found is embedded in the FBX (no `.fbm` sidecar folders exist).
- height = Z extent of the skinned meshes in rest pose, in Blender metres after import.
- rest pose = angle of the left upper arm (LeftArm head -> LeftForeArm head) from horizontal;
  |angle| < 15 deg = T-pose, 15-60 = A-pose.
- `torso_width_m` / `torso_depth_m` = extent of a slice at 60-66 % of height. Only meaningful for
  realistic humans; on cartoon or hunched bodies the arms fall inside the slice (e.g. Aj 0.919,
  Ty 1.056, Warrok 1.165). Do not use it for those.

## Library-wide findings (measured)
- 80 files, 80 measured, 0 failed. Total embedded texture data 2559.4 MB.
- 32 files carry 4096x4096 textures - 31 of the 32 `Ch##_nonPBR` files (Ch45 is 2048) plus Aj.
  Heaviest: Ch35 133.8 MB, Ch50 114.4, Ch05 112.3, Ch49 109.0, Ch15 107.7, Ch40 107.3,
  Ch10 103.0, Ch44 91.5, Ch08 80.4, Ch25 77.2.
- The 32 `Ch##_nonPBR` files are 24,780-59,197 triangles; the other 48 files are 4,421-31,696.
- Rest pose: 79 T-pose, 1 A-pose by the 15 deg rule (Ch05 at -17.3 deg, visually a slight droop).
  Next-lowest: Ch24 -14.2, Ch39 -10.6, Ch25 -9.5, Ch50 -9.5.
- Every file uses a mixamorig skeleton, but the prefix differs: 64 files `mixamorig:`, 16 files
  numbered - `mixamorig1:` (Ch17, Ch19, Ch26, Ch29, Ch45, Ch50), `mixamorig2:` (Ch22),
  `mixamorig5:` (Ch10), `mixamorig6:` (Ch09, Ch20), `mixamorig7:` (Ch08, Ch33),
  `mixamorig8:` (Ch07), `mixamorig9:` (Ch06, Ch31), `mixamorig12:` (Ch01).
  The game's clip binder must strip `/^mixamorig\d*:/` or 9 of the recommended bodies will not animate.
- Bone counts range 37-112. Low: Mutant 37, Castle guards 43, Peasant Man 43, Prisoner 47,
  Ch50 49, Ch19 57 (finger / toe bones missing - finger tracks will simply not apply).
  High: Exo Gray / exo_red 112, Ganfaul / Sporty Granny / Vampire 99 (extra face or cloth bones).
- File unit scale is NOT consistent. Ch-series humans measure 1.598-1.898 m, but the older
  single-character files measure ~1.95-2.12 m for ordinary humans (Kachujin 2.077, Lola 1.994,
  Whiteclown 2.048, Prisoner 2.032, Peasant Girl 2.033), and three are far off: Medea 0.165 m,
  Pirate 0.647 m, Eve 1.391 m. The game must normalise every body to a designed height at load;
  file heights are not character heights. The lineup sheets use such target heights.

### Broken / odd materials
No render shows missing (pink) or blank textures on any of the 14 sheets. Measured oddities:
- `akai_e_espiritu.fbx`: the material references `akai_normal.png`, which is not embedded
  (0x0, no data). Diffuse is fine; only normal detail is lost.
- `Sporty Granny.fbx`: `Lens_MAT` (glasses lenses) is untextured cyan with constant alpha 0.187 -
  intentional glass; needs a transparent material on export.
- `Brute.fbx`: `phong4` on `MaleBruteA_Earrings` (308 verts) is untextured grey 0.226 - fine.
- `Ch40_nonPBR.fbx`: material `01` on the body mesh is untextured grey 0.753; nothing looks wrong
  in the renders, but check which faces use it before shipping Ch40.
- Many hair / eyelash / moustache materials are alpha-textured (`alpha_linked` in metrics.json);
  in Three.js give them alphaTest (cutout) rather than blended transparency.

### Content flags seen in the renders
- `POLICE` is printed on the vests of Ch35 and copzombie (visible in both views). Repaint to the
  show's own security branding before use.
- Children: Aj, Ch09, Ty are cartoon kids; Girlscout T Masuyama is a child-proportioned zombie
  scout. None are recommended as enemies or finisher targets.
- Warzombie F Pedroso wears an old-style military officer uniform with a peaked cap; check the
  insignia on the texture before any use. Not recommended.
- Mutant has a branded two-character number on the chest (texture crop `_zoom/mutant_chest_mark.png`
  reads like "08"; the first glyph is ambiguous). Repaint to our own specimen number.
- Lola's outfit carries kanji (chest and trouser legs) - verify meaning if she is used.
- Ch35 / Ch15 / Swat / Ch49 are real-world uniform types; fine as fictional show security once
  any printed words are replaced.

## Label errors in classification.json (label vs what the renders show)
- Aj "young modern man" -> cartoon kid with a big head, red backwards cap, glasses, backpack.
- Arissa "modern casual" -> hooded, cloaked assassin with a quiver.
- Ely "female mage in robes" -> male sci-fi soldier in grey/red armour with orange lights.
- Eve "astronaut / space marine" -> woman in a black leather jacket, shorts, thigh boots, eyepatch.
- Heraklios "Greek warrior, toga-armour" -> pointed hood, respirator mask, long leather coat.
- Kachujin "samurai in traditional armour" -> female martial artist in a red wrap dress.
- Lola "modern casual" -> orange martial-arts suit with kanji.
- Maria "civilian in a simple dress" -> blonde warrior in gold/black armour.
- Medea "sorceress, mystical robes" -> adventurer in white jacket, red corset, khaki trousers.
- Nightshade "hooded rogue in dark leather" -> horned purple sorceress with glowing green gems.
- Pirate "tricorn hat, cutlass" -> purple hood, one white armoured leg, a long rifle; no tricorn.
- Uriel "angelic, glowing aura" -> ornate gold armour, no aura.
- Vanguard "medieval heavy armour" -> tan sci-fi armour with a black respirator.
- Yaku "modern martial artist" -> zombie gangster with arm tattoos and a holstered gun.
- Ganfaul "armoured zombie" -> pale horned warlock in dark robes.
- Girlscout "young girl in scout uniform" -> the girl is a bloodied zombie.
- Maw "oversized mouth / jaws" -> antlered beast with glowing claws and arrows stuck in it.
- The 32 Ch-series files are all labelled "generic humanoid"; they are specific, distinct outfits.

## Per-character visual notes (from the renders)
Style families: [R] realistic 4K Ch-series; [P] painted 2K game characters (~8-20k tris);
[C] cartoon / big-head stylised; [L] low-poly (~5k tris). Fit: modern TV death-show.

Sheet 01
- Aj [C] - cartoon boy: red backwards cap, black glasses, grey hoodie with red lining, ripped dark
  jeans, white sneakers, blue backpack. Cute; off-tone. Skip.
- akai_e_espiritu [P] - slim hooded ninja/assassin in dark grey, red sash, bow and quiver on back,
  leather bracers. Fantasy; normal map missing. Themed-episode only.
- Arissa [P] - hooded woman in black, long dark cape, cropped top and bare midriff, tattooed arm,
  leather skirt, boots, quiver. Dark fantasy assassin. Skip.
- Brute [P] - huge shirtless man, short dark hair, handlebar moustache, earring, a round mark on
  the left pectoral, brown baggy trousers, tall brown boots; a battle-axe mesh in the right hand.
  Most muscular realistic human on the sheets. HEAVY GRAPPLER pick.
- Castle Guard 02 [L] - medieval visored helm, brown leather tunic with crest, pauldrons, blocky
  hands. Skip (low-poly, medieval).
- castle_guard_01 [L] - bucket helm, red heraldic tabard over blue mail. Skip.

Sheet 02
- Ch01 [R] - shaved-head young man, plain white polo, blue jeans, white sneakers. CROWD.
- Ch02 [R] - young woman, hair in a bun, mustard-orange sweatshirt with a white cat face, denim
  shorts, yellow sneakers. CROWD.
- Ch03 [C] - stylised young woman, two puff buns, orange headphones and goggles, grey crop top,
  bright yellow baggy trousers with cyan stripes. Fun colours but cartoon proportions. Skip.
- Ch05 [R] - bald, half the face painted white with dark eye paint, scalp stitches, leather harness
  over bare chest, fur/leather pauldrons, a bone-spine necklace, loincloth over trousers, spiked
  left gauntlet, boots. Wasteland warlord. BOSS pick.
- Ch06 [R] - man in a black hooded track top, black cap, white/red over-ear headphones, white
  undershirt hem showing, black joggers, red/white sneakers. Street grunt. ENEMY pick.
- Ch07 [R] - woman with short dark hair in a navy pantsuit, white shirt, black heels. Host /
  producer NPC or crowd.

Sheet 03
- Ch08 [R] - bearded man with a fade haircut, light-grey hoodie, grey sweatpants with a black side
  stripe, black sneakers. Tracksuit thug. ENEMY pick (also contestant alternate).
- Ch09 [C] - chibi boy, huge head, red cap, green jacket, blue shorts. Skip.
- Ch10 [R] - realistic zombie: rotted brown skin, burnt rags, dark trousers, boots, blood. Horror
  special only.
- Ch15 [R] - special-forces soldier: black helmet with goggles, balaclava, grey urban camo, black
  plate carrier, holsters, knee pads. Elite security alternate (107.7 MB of textures).
- Ch16 [R] - surgeon in cyan scrubs, surgical cap and face mask, black shoes. Show medic. ENEMY pick.
- Ch17 [R] - bearded construction worker: white hard hat, orange hi-vis vest with yellow stripes,
  dark long-sleeve shirt, mud-caked jeans, tan work boots. Bruiser. ENEMY pick.

Sheet 04
- Ch19 [C] - blue cartoon goblin with big eyes, horned cap, brown tunic. Skip.
- Ch20 [R] - racing driver: red race suit with white side panels, black full-face helmet with a
  dark visor (no face visible), red boots. Iconic silhouette. BOSS pick.
- Ch21 [R] - woman with short hair, navy button-up blouse, caramel trousers, flats. CROWD.
- Ch22 [R] - woman, white T-shirt, dark blue jeans, white sneakers. CROWD.
- Ch23 [R] - man with a dark quiff, black blazer over a blue shirt, grey jeans, brown shoes. CROWD.
- Ch24 [C] - stylised muscular ninja in purple-navy with face wrap, chest straps. Dojo theme only.

Sheet 05
- Ch25 [R] - dark grey-brown muscular creature, fanged bald head, claws, bony spikes, bare feet.
  Monster-week only.
- Ch26 [R] - woman with curly hair, mint/pink/navy striped top, cuffed jeans, pink heels. CROWD.
- Ch29 [C] - anime girl, lavender hair, red beanie, white crop top, lavender trousers. Skip.
- Ch31 [R] - young man in a black crewneck, black trousers, dark sneakers. Crowd spare.
- Ch33 [R] - man in a navy suit, white shirt, dark tie, brown shoes. Boss alternate (the
  Showrunner) or host.
- Ch34 [C] - green elf/goblin woman with a leaf skirt. Skip.

Sheet 06
- Ch35 [R] - riot officer: helmet + gas mask, olive vest printed POLICE, dark navy trousers,
  holsters, boots. Elite riot guard. ENEMY pick (heaviest file: 133.8 MB of textures).
- Ch39 [C] - cartoon old kung-fu master: bald, long white beard, purple robe, mustard sleeves.
  Big personality, but cartoon proportions. Dojo-special alternate only.
- Ch40 [R] - white goat-skull mask with curled horns, black vest with gold trim and gold sash, one
  black-gloved sleeve and one white tattooed sleeve, striped trousers, laced boots. Cult MC.
  BOSS pick.
- Ch42 [R] - young man with shaggy dark hair, tattoo sleeves on both arms, red T-shirt with a
  yellow/green grunge glyph print, light denim shorts, white sneakers. ALL-ROUND BRAWLER pick.
- Ch44 [R] - sleek black armoured bodysuit, faceless helmet with an orange visor outline. Sci-fi.
  Boss alternate (the network's prototype enforcer).
- Ch45 [R] - dark teal bodysuit with red accents and small glowing green chest parts, masked.
  Sci-fi creature. Skip.

Sheet 07
- Ch49 [R] - WWII-style GI: olive uniform, round helmet, webbing, brown boots. War-set theme only.
- Ch50 [R] - blue alien, elongated head, cyan glowing stripe suit. Skip.
- copzombie_l_actisdato [P] - zombie police officer: chequered-band cap, black POLICE vest, white
  shirt, bloody torn arms, bloody mouth. Horror special.
- Demon T Wiezzorek [P] - pale blue demon with horn-like head pieces, red shoulder drape and
  loincloth, gold greaves. Fantasy. Skip.
- Ely By K.Atienza [P] - man in grey/red sci-fi armour with orange lights and an orange glowing arc
  behind the shoulders. Skip.
- Erika Archer With Bow Arrow [P] - hooded female archer in dark olive, red sash, bow in hand. Skip.

Sheet 08
- Erika Archer [P] - same archer, quiver on the back, no bow. Skip.
- Eve By J.Gonzales [P] - woman with a high bun and a loose strand over an eyepatch (right eye),
  black leather jacket with tan/gold piping and red collar lining, belted black shorts over black
  tights, thigh boots with tan straps, gloves. FAST STRIKER pick. File height 1.391 m -> rescale.
- Exo Gray [P] - man with an undercut, blue-grey suit under a dark mechanical exo-frame. Cyberpunk.
- exo_red [P] - same body, red patterned suit and red mohawk. Punk-cyber; enemy-variant alternate.
- Ganfaul M Aure [P] - pale warlock, grey hair, horns, spiked pauldron, open chest, dark robes. Skip.
- Girlscout T Masuyama [P] - bloodied zombie girl scout, red headband, sash, green tartan skirt,
  a stick on the back. Child body - excluded.

Sheet 09
- goblin_d_shareyko [P] - detailed goblin, huge ears, orange eyes, leather armour, curled shoes. Skip.
- Heraklios By A. Dizon [P] - tall pointed hood/helm, respirator mask with a hanging hose, long
  brown leather coat with red trim and pouches, boots. Plague enforcer. ENEMY pick.
- Kachujin G Rosales [P] - female martial artist, bun with bangs, red wrap dress with black obi,
  blue scarf, arm guards, grey greaves. Fast-striker alternate (red clashes with Ch42).
- Knight D Pelegrini [P] - red hood with yellow trim, beard, lion tabard, mail sleeves. Skip.
- Lola B Styperek [P] - short orange hair, orange martial-arts suit with white trim and kanji,
  white leg wraps. Very readable; fast-striker alternate; very light (9,825 tris, 3.1 MB).
- Maria J J Ong [P] - blonde warrior in gold/black armour. Skip.

Sheet 10
- Maria WProp J J Ong [P] - same, with a long sword. Skip.
- Maw J Laygo [P] - huge blue-grey antlered beast, glowing orange claws, arrows stuck in the hide,
  a small trophy head hanging from an antler. Monster-week boss alternate.
- Medea By M. Arrebola [P] - auburn updo, white high-collar jacket, red corset, khaki trousers,
  white/green boots. File height 0.165 m. Skip.
- Mutant [P] - hulking cracked-rock skin, bony mask with cyan crystals, big cyan crystal claw
  growths on both hands, torn blue jeans, bare feet, a stitched chest scar and a branded number.
  BOSS pick.
- Nightshade J Friedrich [P] - horned purple sorceress with glowing green eyes and gems. Skip.
- Paladin J Nordstrom [P] - dark steel plate knight, great helm, purple skirt. Skip.

Sheet 11
- Paladin WProp J Nordstrom [P] - same with sword and shield. Skip.
- Parasite L Starkie [P] - pale pink monster with a toothy gaping mouth and a chest tentacle,
  bloody, torn grey shorts. Horror special.
- Peasant Girl [L][C] - stylised medieval woman, headscarf, corset, long patterned skirt. Skip.
- Peasant Man [L][C] - chunky old peasant, white moustache, striped shirt. Skip.
- Pirate By P. Konstantinov [P] - purple hood, one white armoured leg, black suit, long rifle.
  File height 0.647 m. Skip.
- Prisoner B Styperek [P] - zombified convict in grey/white striped prison uniform and cap,
  bloody, barefoot. ENEMY pick (death-row fodder).

Sheet 12
- Pumpkinhulk L Shaw [P] - hulking body with ridged orange pumpkin-rind skin, torn purple shirt,
  belt, ragged jeans, white high-top sneakers, two grey cylinders on the back. Halloween-special
  boss alternate.
- Skeletonzombie T Avelange [P] - flayed zombie, exposed ribs and red flesh, long spiky fingers.
  Horror special.
- Sporty Granny [C] - cartoon granny: pink/white hair curlers, blue cap, glasses, bright blue
  tracksuit with a whistle. Skip (cartoon).
- Survivor A Lusth [P] - green rotting face, white tank top, leather bandolier, rust-orange cargo
  trousers, satchel. Horror special.
- Swat [P] - blue-grey uniform, black tactical vest, helmet with goggles, gloves, knee pads, face
  exposed. Cheapest security body (19,450 tris, 4.2 MB). ENEMY pick.
- Ty [C] - cartoon boy, blond, red jacket, striped scarf. Skip.

Sheet 13
- Uriel A Plotexia [P] - red-haired man in ornate gold/bronze armour with huge pauldrons and a
  winged chest emblem. Big, vain silhouette. BOSS pick (finale champion).
- Vampire A Lusth [P] - pale blue-white vampire in a red hood, glowing blue eyes, blades on the
  back, red sash. Skip.
- Vanguard By T. Choonyung [P] - tan sci-fi armour, black respirator hood with red stripes, pouch
  belt. Hazmat-cleanup-crew alternate.
- Warrok W Kurniawan [P] - green-grey horned troll/orc beast, red cloth, claws. Skip.
- Warzombie F Pedroso [P] - zombie officer in an old military uniform and peaked cap, bloody.
  Not recommended (see content flags).
- Whiteclown N Hallin [P] - bald white clown face with dark eye rings and a toothy grin, black
  tuxedo with bow tie and pocket square, grey gloves, ragged trouser hems, bare grey feet.
  ENEMY pick (clown henchman).

Sheet 14
- Yaku J Ignite [P] - undead gangster: slicked-back hair, pale green skin, tattooed arms, open
  brown jacket, bloody shirt, blue jeans, boots, gun on the hip. ENEMY pick (themed).
- Zombiegirl W Kurniawan [P] - blonde zombie woman, torn bloody white blouse, brown cargo
  trousers, barefoot. Horror special.

## RECOMMENDATION

Palette logic: contestants own red (Ch42), black+gold (Eve) and bare skin+brown (Brute); the
enemy core is black / grey / orange hi-vis / blue / olive / cyan / tux / brown coat, so every
enemy reads against every contestant. Names below are working names only.

### 3 playable contestants  (`sheets/lineup_contestants.png`)
| Role | File | Target h | Why (from the renders) | Measured cost |
|---|---|---|---|---|
| All-round brawler "Johnny Riot" | Ch42_nonPBR | 1.80 m | Average build, red tee is the most readable top in the library, tattoo sleeves + shaggy hair = punk. Mid-weight silhouette sits between the other two. | 50,187 tris, 2 mat, 5 tex @4096, 49.0 MB, `mixamorig:` |
| Fast striker "Patch" | Eve By J.Gonzales | 1.72 m | Slim, long legs, high bun, eyepatch = instant personality; black leather with gold piping and red collar reads well under rim light and is nothing like Ch42 or Brute. | 27,207 tris, 1 mat, 3 tex @2048, 13.4 MB; file height 1.391 m |
| Heavy grappler "Hoss" | Brute | 2.00 m | Visibly the most muscular human on the sheets (torso slice / height = 0.218, vs Ch42 0.168 and Eve 0.165); shirtless + handlebar moustache + big boots = wrestler. Strip the `BattleAxe_GEO` mesh. | 31,301 tris, 10 mat, 18 tex @2048, 18.6 MB |
Alternates: Kachujin (martial striker, but red like Ch42), Lola (orange martial suit, 9,825 tris),
Ch08 (grey tracksuit brawler; used as an enemy below).

### 10 enemy archetypes  (`sheets/lineup_enemies_a.png`, `lineup_enemies_b.png`)
| # | Archetype | File | Target h | Look / behaviour hook |
|---|---|---|---|---|
| 1 | Hoodlum (basic grunt) | Ch06_nonPBR | 1.80 | Black hoodie, cap, headphones; the default mob. |
| 2 | Tracksuit (rusher) | Ch08_nonPBR | 1.80 | Grey tracksuit, beard; fast lunges. |
| 3 | Hardhat (bruiser) | Ch17_nonPBR | 1.95 | Hi-vis vest + hard hat; pipe/wrench swings; scale up ~9 %. |
| 4 | Stage Security (blocker) | Swat | 1.82 | Blue uniform, tactical vest; baton + guard. Cheapest body. |
| 5 | Riot Gas (elite) | Ch35_nonPBR | 1.85 | Gas mask + helmet; shield wall; repaint POLICE. |
| 6 | Tux Clown (henchman) | Whiteclown N Hallin | 1.85 | White clown face, tuxedo; tricks, gag props, taunts to the crowd. |
| 7 | Scrub (show medic) | Ch16_nonPBR | 1.78 | Cyan scrubs + mask; revives KO'd enemies - priority target. |
| 8 | Plague Hood (enforcer) | Heraklios By A. Dizon | 1.95 | Pointed hood, respirator, long coat; slow grabs and throws. |
| 9 | Death Row (horde fodder) | Prisoner B Styperek | 1.80 | Striped convict, rotting face; prison-episode swarms. |
| 10 | Ink (dirty fighter) | Yaku J Ignite | 1.80 | Tattooed undead gangster, holstered gun; horror / yakuza theme. |
Spares: Ch15 (camo special forces), exo_red (red punk-cyber variant), Vanguard (hazmat crew).
Horror-special extras (`lineup_horror_special.png`): copzombie (repaint POLICE), Zombiegirl,
Survivor, Parasite, Skeletonzombie. Girlscout and Warzombie shown on that sheet for comparison
only - excluded (see content flags).

### 5 episode bosses  (`sheets/lineup_bosses.png`)
| Ep | Boss | File | Target h | Personality hook tied to the render |
|---|---|---|---|---|
| 1 | "Crash" - stunt driver | Ch20_nonPBR | 1.85 | Red race suit, helmet never comes off; charges, ramp stunts. |
| 2 | "Boneyard King" - junkyard warlord | Ch05_nonPBR | 1.90 | White half-face paint, bone necklace, spiked gauntlet; a showman butcher. |
| 3 | "Specimen" - lab mutant | Mutant | 2.40 | Crystal claws, cracked hide, jeans; grabs, slams, glowing weak points. |
| 4 | "The Goat" - cult MC | Ch40_nonPBR | 1.90 | Goat-skull mask, gold-trimmed black vest; ritual traps, crowd hype. |
| 5 | "Golden Boy" - reigning champion | Uriel A Plotexia | 2.20 | Gilded armour, huge pauldrons; vain, poses for the cameras. |
Alternates (`lineup_bosses_alt.png`): Pumpkinhulk (Halloween special), Ch44 (black prototype
suit - the network's enforcer), Ch33 (navy suit - the Showrunner as a secret final boss),
Maw (monster-week special).

### Crowd bodies for baked impostors  (`sheets/lineup_crowd.png`)
Ch02 (orange cat sweatshirt), Ch26 (striped top), Ch01 (white polo), Ch23 (black blazer),
Ch21 (navy blouse, caramel trousers), Ch22 (white tee, jeans). Six clearly different colour
blocks and both genders; realistic proportions (not pills). Bake 3-4 cheer / jeer poses from
several angles; spare: Ch31 (black sweater), Ch07 (navy pantsuit, also a host/producer NPC).

### Texture / performance work needed for the picks
- 4096 textures (downsize): Ch42, Ch06, Ch08, Ch17, Ch35, Ch16, Ch20, Ch05, Ch40 and all six
  crowd bodies. Suggested: contestants/bosses one 2048 albedo + 2048 normal; enemies 1024; crowd
  impostor atlases only. Drop the specular/glossiness maps (the scouting renders were made without
  them and read correctly).
- Largest picks by texture weight: Ch35 133.8 MB (12 textures), Ch05 112.3 MB (12), Ch40 107.3 MB
  (9), Ch08 80.4 MB (10), Ch17 59.5 MB. Sum over the 10 enemy picks: 426.4 MB; 5 bosses 288.6 MB;
  3 contestants 81.1 MB; 6 crowd 295.9 MB.
- Triangles: the Ch-series picks are 41,171-59,197 tris each; decimate enemies to roughly 15-20k
  for several on screen. Painted picks are already 8,144-31,301.
- Brute: 10 materials / 18 textures - merge into one atlas; remove `BattleAxe_GEO`.
- Uriel is split into 24 mesh parts (`polySurface*`) - merge before export.
- Ch05 rest pose droops -17.3 deg; check it against the clip set after retargeting.
- Normalise heights at load (file scales disagree; Eve is 1.391 m in the file).
- Strip numbered bone prefixes: Ch06 `mixamorig9:`, Ch08 `mixamorig7:`, Ch17 `mixamorig1:`,
  Ch20 `mixamorig6:`, Ch01 `mixamorig12:`, Ch26 `mixamorig1:`, Ch22 `mixamorig2:`, Ch33 `mixamorig7:`.

### Style caveat
The picks mix realistic 4K Ch-series bodies with painted 2K game characters. In the lineups
(same neutral material) the visible difference is detail density - painted bodies read softer.
One shared cel/rim shader driven by albedo only, which the brief's saturated look calls for
anyway, should hide most of it. Treat this as untested until it is seen in-engine.
