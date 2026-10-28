#!/usr/bin/env python3
"""VALE image-generation pack: build the manifest of every painted 2D image the game uses.

    python3 tools/imagegen/build_manifest.py            # writes tools/imagegen/manifest.json

The manifest is DATA: one record per image with its prompt (written from the style bible, the
world sheet, the content records and the fighter art briefs), the generator size class, and where
the finished file goes. tools/imagegen/run_xai.py generates the raw images (xAI grok-imagine-image,
the same API the Forgeflow pipeline already uses); tools/imagegen/post.py crops, resizes, makes
textures seamless, converts to WebP and (with --apply-refs) points content refs at the new files.

Why these images: Vale's in-game models, maps and VFX are Blender/Three.js, but a shipped
lane-brawler's FEEL in the client comes from painted 2D: ability and item icons, key art, mode
cards, loading screens, painted backdrops behind the fighter splashes and hand-painted terrain
textures. Fighter concept sheets are references for the Blender modellers (never shipped).

Originality: every prompt describes OUR world in our own words. No prompt names or imitates
another game, studio, character or artist.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent            # games/vale
CONTENT = ROOT / "content"
BRIEFS = ROOT / "_design" / "fighters"

# ── shared style language (from _design/STYLE_BIBLE.md, in prompt form) ─────────────────────────
WORLD = (
    "The Vale: an immense valley carved as a single sundial whose needle fell. Light stopped: eternal "
    "cool morning on the west rim, where the Aubade build tall pale chalk spires with cool blue-white "
    "dawnglass panes; eternal warm evening on the east rim, where the Serenade build low dark ironstone "
    "domes with warm amber lampresin windows. Carved dial-stone terraces with engraved hour-lines, the "
    "colossal fallen stone needle lying across a gorge, chalk cliffs, restrained sculpted foliage."
)
PAINT = (
    "premium hand-painted stylized fantasy illustration, confident painterly brushwork, clean readable "
    "shapes, strong silhouette, dramatic soft light with crisp rim light, atmospheric depth, rich but "
    "restrained palette, high polish, shipped AAA game quality"
)
BANNED = (
    "No text, no letters, no numbers, no logo, no watermark, no signature, no UI, no border or frame. "
    "No gears, no clock hands, no clock faces, no gems or jewels, no glowing runes or glyphs, no gold "
    "filigree, no shiny chrome or polished metal armour, no teal-and-gold colour scheme, no red-versus-green."
)
FIGURE = (
    "Characters never show a bare face and no visible hair: each named fighter wears exactly the glass visor or "
    "carved mask of the real character design. Every mask is carved with readable features (a brow ridge, a nose "
    "keel, a closed mouth line) in warm wood, lacquer or stone; glass visors are clear pale panes. Costume of heavy "
    "draped cloth, carved stone and wood plates, wrapped leather."
)
# VALE sensitivity rule (blocker class anywhere; owner brief + final parity review client F1 / originality F2):
# appended to EVERY key-art prompt, figures or not. Sign-off: _design/reviews/fixwaves/W2_art_signoff.md.
SENSITIVITY = (
    "Sensitivity: no blank, smooth, cracked or skull-like masks, no hockey masks, no mannequin faces, no empty or "
    "glowing eye holes, no glowing eyes; no animal ears, no full-head cowls, no capes, no skull plates, no horns; no "
    "tall, pointed or conical hoods (any hood is soft, low and rounded); no faceless crowds, no armies or rows of small "
    "soldiers, no little figures with faces on the roads; nothing that resembles a character from another game, film or comic."
)
ICON = (
    "Square game icon, single bold centred subject that reads at 48 pixels, dynamic three-quarter "
    "angle, strong value contrast against a dark ink-blue painted background with soft vignette, "
    "light source top-left, " + PAINT + ". " + BANNED
)
TEXTURE = (
    "Seamless tileable hand-painted game texture, orthographic top-down view, even flat lighting, no "
    "shadows cast from outside, no perspective, no objects cut at the edges, painterly stylized detail "
    "readable from a high camera, " + BANNED
)


def load(name: str, key: str | None = None):
    d = json.loads((CONTENT / name).read_text(encoding="utf-8"))
    if isinstance(d, dict) and key and key in d:
        return d[key]
    return d


def clean(text: str, n: int = 240) -> str:
    """Strip {placeholders}, markdown and numbers-heavy asides so the generator gets the IDEA, not tooltips."""
    t = re.sub(r"\{[^}]*\}", "", text)
    t = re.sub(r"\*\*|`|^- ", "", t, flags=re.M)
    t = re.sub(r"\([^)]*\d[^)]*\)", "", t)              # (0.90 m wide), (rule: at least 1.4)
    t = re.sub(r"\d+(\.\d+)?\s*(m|cm|px|%|s)\b", "", t)
    t = re.sub(r"\s+", " ", t).replace(" .", ".").replace("..", ".").strip()
    if len(t) > n:
        cut = t[:n]
        t = cut[: cut.rfind(". ") + 1] if ". " in cut else cut
    return t


def colour_words(hexstr: str) -> str:
    """'#6E6358' -> 'dark warm grey-brown'. Image models read words far better than hex."""
    import colorsys
    try:
        r, g, b = (int(hexstr[i:i + 2], 16) / 255 for i in (1, 3, 5))
    except Exception:
        return ""
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    light = "very dark" if l < 0.2 else "dark" if l < 0.38 else "mid" if l < 0.6 else "light" if l < 0.8 else "pale"
    if s < 0.12:
        return f"{light} neutral grey"
    names = [(15, "red"), (40, "orange-amber"), (55, "ochre"), (70, "yellow"), (100, "olive"), (150, "green"),
             (185, "teal"), (215, "azure"), (250, "blue"), (285, "violet"), (330, "plum-magenta"), (361, "rose-red")]
    hue = h * 360
    name = next(nm for lim, nm in names if hue < lim)
    tone = "muted " if s < 0.35 else ""
    return f"{light} {tone}{name}"


def brief_section(fid: str, heading_word: str, n: int = 700) -> str:
    p = BRIEFS / f"{fid}.md"
    if not p.exists():
        return ""
    md = p.read_text(encoding="utf-8")
    m = re.search(rf"^##[^\n]*{heading_word}[^\n]*\n(.*?)(?=^## )", md, re.S | re.M | re.I)
    if not m:
        return ""
    body = re.sub(r"`", "", m.group(1))
    body = re.sub(r"\|[^\n]*\|", "", body)          # drop tables
    body = re.sub(r"\s+", " ", body).strip()
    return body[:n]


def rec(rid: str, kind: str, prompt: str, out: str, size: str, ref_from: str | None = None, note: str = "") -> dict:
    return {"id": rid, "kind": kind, "prompt": re.sub(r"\s+", " ", prompt).strip(), "out": out,
            "size": size, "ref_from": ref_from, "note": note}


def main() -> None:
    items: list[dict] = []
    fighters = sorted((CONTENT / "fighters").glob("*.json"))

    # ── 1. fighter concept sheets (modelling reference; not shipped) ──────────────────────────
    for fp in fighters:
        f = json.loads(fp.read_text(encoding="utf-8"))
        fid = f["id"]
        sil = clean(brief_section(fid, "Silhouette", 900), 380)
        face = clean(brief_section(fid, "Face", 500), 220)
        armour = clean(brief_section(fid, "Armour", 1200), 480)
        pal = f.get("palette", {})
        items.append(rec(
            f"concept_{fid}", "concept",
            f"Character concept turnaround sheet for an original fighter named {f['name']}, {f['title']}, a "
            f"{f['class'].replace('class_', '')} in a stylized fantasy lane-battle game. Full body front view and back "
            f"view side by side on a plain light warm-grey background, neutral A-pose, consistent design in both views. "
            f"Fight role: {f['job']} Silhouette and proportions: {sil} Mask: {face} Costume and props: {armour} "
            f"Main colours {colour_words(pal.get('primary', ''))} and {colour_words(pal.get('secondary', ''))}, value light at the head and dark at the feet. "
            f"{FIGURE} Style: {PAINT}. {BANNED}",
            f"_design/concept/{fid}.png", "landscape",
            note="reference for art/blender/fighters/<id>.py; never shipped"))

    # ── 2. ability icons (passive + 4 abilities per fighter) ──────────────────────────────────
    for fp in fighters:
        f = json.loads(fp.read_text(encoding="utf-8"))
        pal = f.get("palette", {})
        for slot in ("passive", "a1", "a2", "a3", "ult"):
            a = f["kit"][slot]
            tier = "ultimate ability, the most spectacular and luminous of the set" if slot == "ult" else (
                "passive trait, calm emblematic composition" if slot == "passive" else "active ability")
            items.append(rec(
                f"ability_{a['id']}", "icon",
                f"Ability icon '{a['name']}' for {f['name']} ({f['class'].replace('class_', '')}): {tier}. "
                f"What it does: {clean(a['desc'])}. Show the action as one striking image (the effect, the gesture or "
                f"the weapon at the moment of impact), with light-and-shade magic of luminous dawnglass shards and "
                f"dark ink smoke with bright rims, colour accents {colour_words(pal.get('primary', ''))} and {colour_words(pal.get('secondary', ''))}. {ICON}",
                f"content/ui/icons/abilities/{a['id']}.webp", "square", ref_from=a.get("icon")))

    # ── 3. item icons ─────────────────────────────────────────────────────────────────────────
    for it in load("items.json", "items"):
        items.append(rec(
            f"item_{it['id']}", "icon",
            f"Item icon '{it['name']}' ({it['tier']} tier): {clean(it['desc'])}. A single crafted object of the Vale "
            f"(honed chalk stone, dawnglass, amber lampresin, ironstone, carved wood, wrapped cloth and leather) shown "
            f"as a precious game item, rarity expressed by craftsmanship and light, not by gold. {ICON}",
            f"content/ui/icons/items/{it['id']}.webp", "square", ref_from=it.get("icon")))

    # ── 4. setup layer: battle spells, boons, paths ───────────────────────────────────────────
    setup = load("setup.json")
    for s in setup.get("spells", []):
        items.append(rec(f"spell_{s['id']}", "icon",
                         f"Battle spell icon '{s['name']}': {clean(s['desc'])}. Emblematic, one clear shape. {ICON}",
                         f"content/ui/icons/setup/{s['id']}.webp", "square", ref_from=s.get("icon")))
    for b in setup.get("boons", []):
        items.append(rec(f"boon_{b['id']}", "icon",
                         f"Boon icon '{b['name']}': {clean(b['desc'])}. A calm emblematic image, one clear shape. {ICON}",
                         f"content/ui/icons/setup/{b['id']}.webp", "square", ref_from=b.get("icon")))

    # ── 5. team buffs (objective boons) ───────────────────────────────────────────────────────
    for t in load("team_buffs.json", "teamBuffs") if isinstance(load("team_buffs.json"), dict) else load("team_buffs.json"):
        if not isinstance(t, dict) or "id" not in t:
            continue
        items.append(rec(f"buff_{t['id']}", "icon",
                         f"Team boon icon '{t['name']}': {clean(t['desc'])}. {ICON}",
                         f"content/ui/icons/team_buffs/{t['id']}.webp", "square", ref_from=t.get("icon")))

    # ── 6. key art, mode cards, loading backdrops, store banner ───────────────────────────────
    client = load("client.json")
    feat = client["home"]["feature"]
    items.append(rec("home_feature", "keyart",
                     f"Wide cinematic key art for the home screen: '{feat['title']}'. {feat['body']} Several masked fighters "
                     f"of the two sides clash on a carved dial-stone road at the long hour: cool blue-white morning light "
                     f"from the left (pale chalk spires), warm amber evening light from the right (dark ironstone domes), "
                     f"bright magic of dawnglass shards and ink smoke meeting in the middle. Leave the LEFT third calmer and "
                     f"darker for UI text; the action sits in the right two thirds. {FIGURE} {WORLD} Style: {PAINT}. {BANNED} {SENSITIVITY}",
                     "content/ui/home/feature.webp", "wide", ref_from=feat.get("art")))
    for t in client["home"].get("tiles", []):
        items.append(rec(f"home_tile_{t['id']}", "keyart",
                         f"Painted card illustration for a game client tile titled '{t['title']}': {t['body']} Simple strong "
                         f"composition with one focal subject, space at the bottom for a caption. {WORLD} Style: {PAINT}. {BANNED} {SENSITIVITY}",
                         f"content/ui/home/{t['id']}.webp", "tile", ref_from=t.get("art")))
    for m in load("modes.json", "modes"):
        items.append(rec(f"mode_{m['id']}", "keyart",
                         f"Painted mode-select card art for the game mode {m['name'].upper()}: {m['tagline']} {clean(m['desc'], 300)} "
                         f"A vertical, poster-like composition with a single iconic scene of that battlefield and its scale, "
                         f"darker lower area for a title. {FIGURE} {WORLD} Style: {PAINT}. {BANNED} {SENSITIVITY}",
                         f"content/ui/modes/{m['id']}_card.webp", "portrait", ref_from=m.get("card", {}).get("art")))
    for mp in sorted((CONTENT / "maps").glob("*.json")):
        mm = json.loads(mp.read_text(encoding="utf-8"))
        items.append(rec(f"loading_{mm['id']}", "keyart",
                         f"Wide painted panorama of the battlefield '{mm['name']}': {clean(mm['desc'], 320)} Seen from high and far, "
                         f"epic scale, no characters in the foreground, used as a loading-screen backdrop. {WORLD} Style: {PAINT}. {BANNED} {SENSITIVITY}",
                         f"content/ui/loading/{mm['id']}.webp", "wide"))
    items.append(rec("store_banner", "keyart",
                     f"Wide painted banner for an in-game cosmetics store: three masked fighters in alternate outfits posed "
                     f"heroically on a dial-stone terrace at golden hour, strong rim light, celebratory but restrained. "
                     f"Left third calmer for UI text. {FIGURE} {WORLD} Style: {PAINT}. {BANNED} {SENSITIVITY}",
                     "content/ui/home/store_banner.webp", "wide"))
    items.append(rec("portal_thumbnail", "keyart",
                     f"Game cover key art for an original lane-battle game titled VALE (do NOT draw the title): a masked hero in "
                     f"the foreground on a carved sundial terrace, a rival behind, dawnglass light and ink smoke clashing, the "
                     f"fallen stone needle in the distance. {FIGURE} {WORLD} Style: {PAINT}. {BANNED} {SENSITIVITY}",
                     "public/thumbnail.png", "landscape"))

    # ── 7. painted backdrops for fighter splash composites and menus ──────────────────────────
    backdrops = {
        "aubade_dawn": "the Aubade rim at eternal morning: tall pale chalk spires and slender buttresses with cool dawnglass windows, low cool sun, mist in the valley below",
        "serenade_dusk": "the Serenade rim at eternal evening: low dark ironstone domes with glowing amber lampresin windows, long warm light, lanterns along terraces",
        "needle_gorge": "the colossal fallen stone needle spanning a deep gorge, a road along its flat top, wind and drifting light motes",
        "noonplate": "a huge round carved stone plate at a shadowless noon, ten hour-marks around its rim, bright high sun, festival banners of cloth",
        "dialwood": "a sculpted stylized forest of pale-barked trees with rounded canopies on carved terraces, light shafts, a clearing",
        "seat_center": "the base-stone of the fallen needle at the dial's centre, engraved hour-lines radiating out, dramatic sky",
    }
    for bid, scene in backdrops.items():
        items.append(rec(f"backdrop_{bid}", "backdrop",
                         f"Wide painted environment backdrop, no characters: {scene}. Depth layers and atmospheric perspective, "
                         f"the lower-right area simple enough to sit behind a character render. {WORLD} Style: {PAINT}. {BANNED}",
                         f"art/out/backdrops/{bid}.webp", "wide"))

    # ── 8. hand-painted tileable terrain and material textures ────────────────────────────────
    textures = {
        "grass_dial": "short stylized grass with soft painted clumps and a few tiny pale flowers, muted green-olive",
        "grass_dark": "darker forest-floor grass and moss under canopy, deep olive and blue-green",
        "stone_road": "carved pale dial-stone paving: large irregular flagstones with worn edges and thin dark gaps",
        "stone_road_engraved": "pale dial-stone paving with long engraved straight hour-lines and worn chamfers",
        "dirt_path": "packed earth path with small pebbles, warm grey-brown",
        "chalk_cliff": "vertical pale chalk cliff face with horizontal strata and soft cracks (front view, tileable)",
        "ironstone": "dark warm ironstone block masonry with rounded worn edges (front view, tileable)",
        "gravel_light": "light gravel and sand with scattered small stones",
        "moss_stone": "rough grey stone patched with moss",
        "wood_planks": "weathered carved wooden planks, warm grey",
        "cloth_heavy": "heavy woven cloth with visible weave and painted folds, neutral cream",
        "plaster_chalk": "smooth chalk plaster wall with subtle brush texture and faint hour-line incisions",
    }
    for tid, desc in textures.items():
        items.append(rec(f"tex_{tid}", "texture", f"{desc}. {TEXTURE}", f"art/out/textures/{tid}.webp", "square"))

    out = {"version": 1, "generator": "xai:grok-imagine-image", "count": len(items),
           "sizes": {"square": [1024, 1024], "landscape": [1280, 960], "tile": [1280, 640], "wide": [1920, 1080], "portrait": [768, 1152]},
           "items": items}
    (HERE / "manifest.json").write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    kinds: dict[str, int] = {}
    for it in items:
        kinds[it["kind"]] = kinds.get(it["kind"], 0) + 1
    print(f"manifest: {len(items)} images {kinds}")


if __name__ == "__main__":
    main()
