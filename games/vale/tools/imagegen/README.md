# VALE image-generation pack (Grok Imagine in Chrome, on the owner's Mac)

Vale is a 3D game. These are the **2D painted pieces** a 3D game uses on top of its models:
- HUD, shop and tooltip icons
- menu, mode and loading art
- painted backdrops behind the fighter splashes
- hand-painted textures wrapped onto the 3D terrain
- concept turnarounds the Blender modellers work from (never shipped)

**188 images** (`manifest.json`). `build_manifest.py` writes the prompts from the style bible, the
world sheet, the content records and the fighter art briefs.

| kind | count | goes to | used for |
|---|---|---|---|
| concept | 16 | `_design/concept/<fighter>.webp` | turnaround references for the Blender modellers (not shipped) |
| texture | 12 | `art/out/textures/<id>.webp` (made seamless) | hand-painted terrain and material sets for maps |
| backdrop | 6 | `art/out/backdrops/<id>.webp` | painted backgrounds behind the Blender fighter splashes and menus |
| keyart | 13 | `content/ui/{home,modes,loading}/…webp`, `public/thumbnail.png` | home feature + tiles, mode cards, loading screens, store banner, portal cover |
| icon | 141 | `content/ui/icons/{abilities,items,setup,team_buffs}/<id>.webp` | HUD ability bar, shop, tooltips, loadout |

## Workflow: Grok Imagine through Claude in Chrome (primary)

The owner is signed in to Grok Imagine in Chrome. Work from `games/vale`.

1. **Rewrite the concept prompts first.** For each `concept_*` record in `manifest.json`, read
   `_design/fighters/<id>.md` and rewrite the `prompt` as **≤ 120 words of pure visual
   description**: silhouette, mask, costume pieces, signature prop, materials and colours in words.
   Keep the closing style and "no …" clauses. Drop measurements, code names and jargon. Edit
   `manifest.json` in place.
2. **Loop:**
   1. Run `python3 tools/imagegen/queue.py next`. It prints the id, the **aspect ratio** and the
      prompt, in the order concept → texture → backdrop → keyart → icon.
   2. In Chrome, open Grok Imagine, set the aspect ratio, paste the prompt and generate.
   3. Pick the best result. Regenerate if none are good.
   4. Download it, then run `python3 tools/imagegen/queue.py ingest <id>`. It moves the newest
      image in `~/Downloads` to `tools/imagegen/raw/<id>.png`. Use `--variant 2` to keep an
      alternative.
3. **Review every image before ingesting.** Reject and regenerate any that have:
   - text or letters, a logo, a watermark or a border
   - a bare face or visible hair on a character
   - gears, clock hands, gems or glowing runes
   - a muddy silhouette (icons must read at 48 px)
   - anything that resembles a character, icon or splash from an existing game
   - **sensitivity (blocker class anywhere, `content/ui/**` and `public/` included):** a blank, smooth,
     cracked or skull-like mask, a hockey or mannequin face, empty or glowing eye holes; animal-ear cowls,
     full-head cowls, capes, skull plates, horns or demons; a tall, pointed or conical hood (also from
     behind: a white peaked hood seen from the back is the worst case); a Wick with a face (Wicks have a
     rounded hood and one central light, no eye pairs, no mouth); an empty hood or cowl with a dark face void;
     a noose- or gallows-like frame
   - **unnamed figures:** every figure in key art is a named roster fighter (a manifest record's `roster`);
     crowds, armies, tiny background people or a duplicated fighter are a reject

   Zoom to the faces (2-3x crops) before deciding; a thumbnail hides these. Record each shipped key-art
   image in `_design/reviews/fixwaves/W2_art_signoff.md` (file, roster ids shown, checks).
4. **Keep sets consistent.** Ability icons of one fighter share palette and brushwork. Textures
   must be top-down and flat-lit. Check progress with `python3 tools/imagegen/queue.py status`,
   and commit and push the raw-free outputs at least every 30 images (see step 5).
5. **Post-process.** Run `python3 tools/imagegen/post.py --apply-refs` (use
   `--pick <id>=2` for variants). This crops, resizes, makes the textures seamless, converts to
   WebP and points the content refs at the new files. Then run
   `node tools/build_content.ts --check --allow-missing-assets`, which must say OK. Commit the
   outputs and the updated content JSON and `manifest.json`. Never commit `tools/imagegen/raw/`.

## Key art with fighters: reference boards (xAI edit route)
A key-art record may carry `"roster": ["ervet", "ardit:chalkline", ...]` (fighter ids, or `id:skin`), set from
`keyart_subjects.json` by `build_keyart_prompts.py`. `run_xai.py` then builds one board of those real Blender
models (`ref_board.py`, crops of `art/out/fighters/<id>/splash.png`) and sends it to the edit endpoint with the
prompt, so the painting is on-model instead of an anonymous masked figure. Every key-art prompt ends with the
`SENSITIVITY` line of `build_manifest.py`. Keep attempts apart with `--suffix rN` (and `--variants 2`); pick the
kept one in `picks.json` (e.g. `"home_feature": "r3__2"`). Notes from the 2026-10 repaint: the endpoint keeps the
reference's frame, so a padded board comes back framed in grey and a long strip comes back letterboxed
(`post.py` trims flat bars before the cover crop; a record's `"anchor": [x, y]` picks the crop). A back view
hides a mask, so it suits a masked, unhooded fighter (Burdam on the Ranked stair); never paint a pale hooded
fighter from behind, because the hood then reads as peaked (Vashil was rejected for this).

## Optional: the xAI API (much faster)
If an xAI API key is available on this machine (`$XAI_API_KEY`, or `tokens.json` with
`xai_api_key`), `python3 tools/imagegen/run_xai.py` generates the whole pack unattended, at about
$0.02 per image. Useful flags: `--kind`, `--only <id>`, `--force`, `--variants 2`, `--dry-run`.
It writes to the same `raw/` folder, so steps 3–5 are unchanged.
