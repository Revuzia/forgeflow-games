# VALE image-generation pack (run on the owner's PC)

The cloud build session cannot reach xAI (its network policy blocks `api.x.ai`, `grok.com`,
`x.ai`), so this pack runs on the owner's machine, where the Forgeflow xAI key and the browser
work. The output is committed and pushed. The cloud session pulls it and wires it in.

**188 images** (`manifest.json`, built by `build_manifest.py` from the style bible, the world sheet,
the content records and the fighter art briefs):

| kind | count | goes to | used for |
|---|---|---|---|
| icon | 141 | `content/ui/icons/{abilities,items,setup,team_buffs}/<id>.webp` | HUD ability bar, shop, tooltips, loadout |
| keyart | 13 | `content/ui/{home,modes,loading}/…webp`, `public/thumbnail.png` | home feature + tiles, mode cards, loading screens, store banner, portal cover |
| backdrop | 6 | `art/out/backdrops/<id>.webp` | painted backgrounds behind the Blender fighter splashes and menus |
| texture | 12 | `art/out/textures/<id>.webp` (made seamless) | hand-painted terrain and material sets for maps |
| concept | 16 | `_design/concept/<fighter>.png` | turnaround references for the Blender modellers (not shipped) |

## Instructions for the Claude session on the owner's PC

You are continuing work on VALE (`games/vale` in the forgeflow-games repo, branch
`claude/youthful-ramanujan-gdud5w`). Your job: generate the images, post-process them, commit,
push. Do not change game code.

1. `git pull` on the branch, then `cd games/vale`.
2. **Concept prompts first.** For each `concept_*` record in `tools/imagegen/manifest.json`,
   read `_design/fighters/<id>.md` and rewrite the record's `prompt` as **≤ 120 words of pure
   visual description**: silhouette, mask, costume pieces, signature prop, materials and colours
   in words. Keep the closing style and "no …" clauses as they are. Remove any measurements,
   code names or jargon. Edit `manifest.json` in place.
3. **Generate.** Prefer the API (fast and cheap, about $0.02 per image):
   `python tools/imagegen/run_xai.py --kind texture` (smoke test), then
   `python tools/imagegen/run_xai.py`. The key comes from `$XAI_API_KEY` or from
   `state/.secrets/tokens.json`, the file `pipeline/generate_cover.py` reads.
   Use `--variants 2` for `keyart` and `concept` so there is a choice.
   **Browser fallback** (only if the API key is unavailable): with Claude in Chrome, open the
   Grok image generator (the owner is signed in). For each record, paste the `prompt`, generate,
   download the best result, and save it as `tools/imagegen/raw/<id>.png`.
4. **Review.** Look at every raw image. Regenerate (`--only <id> --force`) any that have:
   - text or letters, a logo, or a border
   - a bare face or visible hair on a character
   - gears, clock hands, gems or glowing runes
   - a muddy or unreadable silhouette (icons must read at 48 px)
   - anything that resembles a character, icon or splash from an existing game

   For variants, use `--pick <id>=2` in the next step.
5. **Post-process.** Run `python tools/imagegen/post.py --apply-refs`. This crops, resizes,
   makes the textures seamless, converts to WebP and points the content refs at the new files.
6. **Verify and ship.** Run `node tools/build_content.ts --check --allow-missing-assets`
   (must say OK), then commit `content/ui/**`, `art/out/backdrops/**`, `art/out/textures/**`,
   `_design/concept/**`, `public/thumbnail.png` and the updated `content/*.json` + `manifest.json`,
   and push. Do not commit `tools/imagegen/raw/`.
