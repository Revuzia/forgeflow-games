# W2 art sign-off: front-door key art and sensitivity icons

Wave W2, package "sensitive-art", 2026-10-28. Items: client F1, originality F2, originality MISS-1, hud HUD-10, originality F9 (icon half).

**Rule checked on every image** (owner brief; blocker class anywhere): no blank, smooth, cracked, skull-like, hockey or mannequin mask; no empty or glowing eye holes; no animal-ear or full-head cowl, cape, skull plate, horns or demon; no tall, pointed or conical hood (also seen from behind); no Wick with a face; no unnamed figure (every figure is a roster id); no text, gears, gems or glowing runes.

**How it was checked.** I opened every generated variant at full size, then 2-3x crops of every head (`_harness/_shots/fw_W2_signoff_*.png`, made from the shipped files). Each fighter was painted with the real Blender model as reference. `tools/imagegen/run_xai.py` sends the record's `roster` board (`tools/imagegen/ref_board.py`, crops of `art/out/fighters/<id>/splash.png`) to the xAI edit endpoint. Every key-art prompt now ends with the `SENSITIVITY` line of `tools/imagegen/build_manifest.py`.

## Shipped images

| File | Roster ids shown | Raw pick (`tools/imagegen/picks.json`) | Mask / face | Hood / cowl / ears / skull | Unnamed figures | Other | Verdict |
|---|---|---|---|---|---|---|---|
| `content/ui/home/feature.webp` (1920x1080) | `ervet`, `ardit`, `marund` | `home_feature__r3__2` | Ervet: glass-visor helm with the blue cross. Ardit: flat helm, visor band over a carved face plate. Marund: carved walnut mask with a beard and shaded eye slits. None blank or hollow-eyed. | none | none | Left third is calm road for text. No text. | **pass** |
| `content/ui/home/ranked_season.webp` (1280x640, the 16:8 tile frame) | `burdam` (seen from behind) | `home_tile_ranked_season__r4__2`, anchor `[0.5, 0.1]` | No face visible: the back of his head and mask shell. | No hood. Pauldrons and cleaver read. | none | The bell tower has no cross or other symbol. | **pass** |
| `content/ui/home/store_banner.webp` (1920x1080) | `ardit:chalkline`, `tunlan:noon_fair`, `ervet:lamplit` | `store_banner__r3__2` | Ardit: visor band and carved face plate. Tunlan: carved natural-wood mask, closed eyes, small closed smile, no painted lips. Ervet: glass-visor helm. | Tunlan's hat is her wide flat lampshade, not a hood. | none | No text (the r2 variant painted gibberish text and was rejected). | **pass** |
| `content/ui/home/collection_highlight.webp` (1280x640) | Pieces only, no figures: `marund` dome cap, `tunlan` lampshade hat and lantern, `ervet` glass greatsword, `vashil` bell ring | `home_tile_collection_highlight__r3__2` | no figures, busts, heads or masks | none | none | Nothing hangs from a frame. The r2 variant hung the bell ring from a gallows-like post and was rejected. Another had a bust in the background and was rejected. | **pass** |
| `public/thumbnail.png` (1280x960) | `rishal`, `tunlan` | `portal_thumbnail__r5` | Rishal: blade-shaped glass visor. Tunlan: carved wooden mask with closed eyes and a calm smile. The r2 Tunlan had open eyes behind the mask and a sly grin; it was replaced. | Lampshade hat, not a hood. | none | Ink smoke vs glass light. No letters on the floor (r2__2 had letter-like engraving and was rejected). | **pass** |
| `content/ui/modes/rift_card.webp` (768x1152) | `rishal` (from behind, on the rim) | `mode_rift__r5` | No face visible (back view). | Crest plates, no hood. | **none: no Wick wave, no armies**. The r2 pick had one tiny figure at the centre seat and was rejected. | Dark lower band for a title. Roads radiate from the seat rather than running as three west-east roads (minor fidelity note, not sensitivity). | **pass** |
| `content/ui/modes/bridge_card.webp` (768x1152) | `ardit`, `marund` | `mode_bridge__r3` | Ardit: visor and carved face plate. Marund: carved walnut mask and beard; a small pale mark at the mouth corner reads as carving, not a fang. | none | none: background checked at 2x. r5 added tiny townsfolk and was rejected. r5__2 had numerals on a dial and was rejected. | Glowing crack, glass arch left, lamp gate right. | **pass** |
| `content/ui/modes/fray_card.webp` (768x1152) | `rishal`, `tunlan`, `marund` | `mode_fray__r5` | Rishal: visor. Tunlan: carved wood mask. Marund: carved walnut mask. | none | none. r3__2 had a duplicated second Dunsom and Dunsom's gold beaked mask (plague-doctor read); it was rejected and Dunsom dropped. r5__2 had "THE VALE" text and was rejected. | Ten lamp posts with tinted flames, no gem-like crystals. | **pass** |
| `content/ui/home/practice_tool.webp` (unchanged) | no figures | (2026-10 pack) | n/a: cloth-wrapped posts, spear, glass shield, no heads | none | none | Rated clean by the final review (client F1) and re-checked at full size. | **pass** |
| `content/ui/home/almanac_teaser.webp` (unchanged, not on Home) | no figures | (2026-10 pack) | n/a: a stone book on a lectern | none | none | none | **pass** |

## Icons (originality F9, W2 half; hud HUD-10)

| File | Subject | Raw pick | Check | Verdict |
|---|---|---|---|---|
| `content/ui/icons/items/linen_hood.webp` | Oat linen folded flat into a tied bundle, the hood's crown lying on top, a darker oat hem with a running stitch, on a wooden board | `item_linen_hood__r4` | No dark face void and nothing standing up as a figure. Warm oat, not pure white. The r1 hoods still showed an opening. The r3 back views sat on a head-shaped stand and read as a bust. Both were rejected. | **pass** |
| `content/ui/icons/abilities/tunlan_shadow_play.webp` | A shadow-puppet bear rearing in a cone of lamplight, made by Tunlan's two carved wooden hands | `ability_tunlan_shadow_play__r1` | Replaces the horned, winged demon. No horns, wings or eyes. It reads as hand-shadow theatre. | **pass** |

Not in W2's files (handoff): the Hooded Lamp ward icon `art/out/units/hooded_lamp_icon.png` (round off the tip). Lisvel's and Sukri's heads belong to W5.

## Generation budget (cap: about 12 per slot)

| Slot | Generations | Slot | Generations |
|---|---|---|---|
| home_feature | 5 | mode_rift | 6 |
| home_tile_ranked_season | 6 (Vashil x4 rejected: from behind his pale hood peaks; then Burdam) | mode_bridge | 6 |
| home_tile_collection_highlight | 4 | mode_fray | 6 |
| store_banner | 4 | item_linen_hood | 6 |
| portal_thumbnail | 6 | ability_tunlan_shadow_play | 2 |

Reproduce: `python3 tools/imagegen/build_keyart_prompts.py && python3 tools/imagegen/run_xai.py --only <id> --force --suffix rN --variants 2`, then `python3 tools/imagegen/post.py --only <ids>`. In context: `_harness/_shots/fw_W2_home_1920.png` and `fw_W2_home_1280.png` (live Home). Image sources and sizes: `_harness/_reports/fw_W2_home_art.json`.
