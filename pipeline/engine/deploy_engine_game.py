#!/usr/bin/env python3
"""deploy_engine_game.py — publish an ENGINE game dir (games/_engine/<slug>) to R2 + Supabase by
PREPARING it (metadata derived from game.js + the build queue; thumbnail from the play tester's
screenshot; the play tester itself as the final pre-deploy gate) and then delegating to the existing
pipeline/deploy_game.py deploy_one(). ADDITIVE — the Phaser deploy flow is untouched.

Safety:
  * --dry-run prints the EXACT Supabase row + the file list and exits 0 WITHOUT uploading anything.
  * READY_TO_DEPLOY marker required by default (--no-require-ready to override) — same review gate
    as the Phaser path.
  * If the dir has no fresh play_report SHIP verdict (or no _play.png), the multi-inspector play
    tester runs first; a HOLD verdict REFUSES the deploy (we never publish a game that doesn't play).

Usage:
  python pipeline/engine/deploy_engine_game.py --game-dir games/_engine/<slug> [--slug s] [--dry-run]
"""
import argparse
import json
import re
import shutil
import sys
from pathlib import Path

ENGINE_DIR = Path(__file__).resolve().parent             # forgeflow-games/pipeline/engine
PIPELINE = ENGINE_DIR.parent                              # forgeflow-games/pipeline
GAMES = PIPELINE.parent                                   # forgeflow-games/
sys.path.insert(0, str(PIPELINE))
sys.path.insert(0, str(ENGINE_DIR))


def derive_metadata(gdir: Path, slug: str, genre_override=None) -> dict:
    """Build the Supabase metadata row fields from the game dir + build queue. Public-safe text only —
    the queue brief contains internal pipeline instructions and is deliberately NOT used verbatim."""
    gjs = (gdir / "game.js").read_text(encoding="utf-8") if (gdir / "game.js").exists() else ""
    m = re.search(r'title:\s*"([^"]+)"', gjs)
    title = (m.group(1) if m else slug.replace("-", " ").title()).strip()
    m = re.search(r'controls:\s*"([^"]+)"', gjs)
    controls = m.group(1) if m else "Arrows/WASD move - Space jump - F or tap fire - P pause - M mute"
    dim = "2d" if re.search(r'dim:\s*"2d"', gjs) else "3d"
    genre = genre_override or "arcade"
    if not genre_override:
        try:
            q = json.loads((ENGINE_DIR / "build_queue.json").read_text(encoding="utf-8"))
            item = next((i for i in q.get("queue", []) if i.get("slug") == slug), None)
            if item and item.get("genre"):
                genre = item["genre"]
        except Exception:
            pass
    return {
        "title": title,
        "description": (f"{title} is an original {genre} game from ForgeFlow Games — quick to pick up, "
                        f"built for the browser, playable on desktop and mobile with keyboard or touch."),
        "short_description": f"Original {genre} — play free in your browser.",
        "genre": genre,
        "sub_genre": "",
        "controls_keyboard": controls,
        "controls_gamepad": "",
        "difficulty": "medium",
        "tags": [genre, "engine", dim],
    }


def ensure_play_gate(gdir: Path, slug: str):
    """Final pre-deploy gate: a fresh SHIP verdict + a screenshot. Runs the multi-inspector play tester
    when play_report.json is missing/not-SHIP or _play.png is absent. Returns (ok, detail)."""
    rep = gdir / "play_report.json"
    shot = gdir / "_play.png"
    if rep.exists() and shot.exists():
        try:
            if json.loads(rep.read_text(encoding="utf-8")).get("verdict") == "SHIP":
                return True, "existing play_report verdict SHIP"
        except Exception:
            pass
    import build_target
    ship, detail = build_target.play_verify(slug, gdir, port=8812)
    if ship is True:
        return True, detail
    if ship is None:
        return False, "play tester unavailable (" + detail + ") — refusing to publish unverified"
    return False, detail                                   # HOLD: never publish a game that doesn't play


def main():
    ap = argparse.ArgumentParser(description="Deploy an ENGINE game (prepare + delegate to deploy_game)")
    ap.add_argument("--game-dir", required=True)
    ap.add_argument("--slug", default=None)
    ap.add_argument("--genre", default=None, help="override the genre (else looked up in build_queue.json)")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--no-require-ready", action="store_true",
                    help="skip the READY_TO_DEPLOY review-marker requirement")
    a = ap.parse_args()

    gdir = Path(a.game_dir).resolve()
    slug = a.slug or gdir.name
    if not (gdir / "game.js").exists() or not (gdir / "index.html").exists():
        print(f"[engine-deploy] not an engine game dir (need game.js + index.html): {gdir}")
        return 2
    if not a.no_require_ready and not (gdir / "READY_TO_DEPLOY").exists():
        print(f"[engine-deploy] REFUSED: no READY_TO_DEPLOY marker in {gdir} (review gate). "
              f"Stage it via the nightly or pass --no-require-ready.")
        return 1

    ok, detail = ensure_play_gate(gdir, slug)
    print(f"[engine-deploy] play gate: {'SHIP' if ok else 'REFUSED'} — {detail}")
    if not ok:
        return 1

    # thumbnail: the play tester's real gameplay screenshot (no xAI needed)
    thumb = gdir / "thumbnail.png"
    if not thumb.exists() and (gdir / "_play.png").exists():
        shutil.copyfile(gdir / "_play.png", thumb)
        print("[engine-deploy] thumbnail.png <- _play.png (gameplay screenshot)")

    meta = derive_metadata(gdir, slug, genre_override=a.genre)
    (gdir / "game_meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")

    files = [p.relative_to(gdir).as_posix() for p in sorted(gdir.rglob("*")) if p.is_file()]
    if a.dry_run:
        import deploy_game
        row_preview = dict(meta)
        row_preview["slug"] = slug
        row_preview["game_url"] = f"{deploy_game.CDN_BASE}/{slug}/index.html"
        row_preview["thumbnail_url"] = f"{deploy_game.CDN_BASE}/{slug}/thumbnail.png"
        print(f"[dry-run] would upload {len(files)} files to R2 bucket {deploy_game.R2_BUCKET}/{slug}/")
        for f in files[:12]:
            print("   ", f)
        if len(files) > 12:
            print(f"    ... and {len(files) - 12} more")
        print("[dry-run] would upsert Supabase games row:")
        print(json.dumps(row_preview, indent=2))
        print("[dry-run] no uploads performed. ENGINE-DEPLOY-DRY: OK")
        return 0

    import deploy_game
    deploy_game.ensure_cf_env()
    res = deploy_game.deploy_one(gdir, slug, metadata_path=str(gdir / "game_meta.json"))
    print(f"[engine-deploy] result: {res}")
    return 0 if res.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
