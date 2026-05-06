#!/usr/bin/env python3
"""
deploy_game.py — Upload a built game to Cloudflare R2 and insert metadata into Supabase.

Usage:
  python pipeline/deploy_game.py --game-dir games/001-tropical-fury --slug tropical-fury

Flow:
  1. Upload all files in game-dir to R2 bucket forgeflow-games/{slug}/
  2. Insert or update game metadata in Supabase games table
  3. Set status to 'published'
"""
import argparse
import json
import os
import subprocess
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PIPELINE_DIR = ROOT / "pipeline"
NOMI = Path(os.path.expandvars("%APPDATA%")) / "Nomi"

R2_BUCKET = "forgeflow-games"
R2_PUBLIC_URL = "https://forgeflow-games.pages.dev"  # Will be updated once R2 custom domain is set

# Load Supabase credentials for the forgeflow-games project
def load_supabase_creds():
    env_path = ROOT / ".env"
    creds = {}
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                creds[k.strip()] = v.strip()
    return creds


def upload_to_r2(game_dir: Path, slug: str) -> int:
    """Upload all files in game_dir to R2 under {slug}/. Returns file count."""
    count = 0
    for file_path in game_dir.rglob("*"):
        if file_path.is_dir():
            continue
        relative = file_path.relative_to(game_dir)
        r2_key = f"{slug}/{relative.as_posix()}"
        cmd = f'npx wrangler r2 object put "{R2_BUCKET}/{r2_key}" --file="{file_path}"'
        result = subprocess.run(
            cmd, shell=True, capture_output=True, text=True,
            encoding="utf-8", errors="replace", timeout=30
        )
        if result.returncode == 0:
            count += 1
            print(f"  [r2] Uploaded: {r2_key}")
        else:
            print(f"  [r2] FAILED: {r2_key} -- {result.stderr[:100]}")
    return count


def insert_game_metadata(slug: str, metadata: dict):
    """Insert or upsert game metadata into Supabase games table."""
    creds = load_supabase_creds()
    supa_url = creds.get("VITE_SUPABASE_URL", "")
    supa_key = creds.get("VITE_SUPABASE_PUBLISHABLE_KEY", "")

    if not supa_url or not supa_key:
        print("[supabase] No credentials found in .env")
        return False

    # Check if game already exists
    check_url = f"{supa_url}/rest/v1/games?slug=eq.{slug}&select=id"
    req = urllib.request.Request(check_url, headers={
        "apikey": supa_key,
        "Authorization": f"Bearer {supa_key}",
    })
    try:
        resp = urllib.request.urlopen(req, timeout=10)
        existing = json.loads(resp.read())
    except Exception as e:
        print(f"[supabase] Check failed: {e}")
        existing = []

    # Build the row. 2026-05-05: hero_image_url added so the game-detail page
    # gets a key-art image too (was previously null → empty banner).
    row = {
        "slug": slug,
        "title": metadata.get("title", slug.replace("-", " ").title()),
        "description": metadata.get("description", ""),
        "short_description": metadata.get("short_description", ""),
        "genre": metadata.get("genre", "platformer"),
        "sub_genre": metadata.get("sub_genre", ""),
        "thumbnail_url": metadata.get("thumbnail_url", ""),
        "hero_image_url": metadata.get("hero_image_url", metadata.get("thumbnail_url", "")),
        "game_url": metadata.get("game_url", f"https://forgeflow-games-cdn.isimcha85.workers.dev/{slug}/index.html"),
        "controls_keyboard": metadata.get("controls_keyboard", ""),
        "controls_gamepad": metadata.get("controls_gamepad", ""),
        "difficulty": metadata.get("difficulty", "medium"),
        "tags": metadata.get("tags", []),
        "status": "published",
    }

    if existing:
        # Update existing
        url = f"{supa_url}/rest/v1/games?slug=eq.{slug}"
        data = json.dumps(row).encode()
        req = urllib.request.Request(url, data=data, method="PATCH", headers={
            "apikey": supa_key,
            "Authorization": f"Bearer {supa_key}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        })
    else:
        # Insert new
        url = f"{supa_url}/rest/v1/games"
        data = json.dumps(row).encode()
        req = urllib.request.Request(url, data=data, method="POST", headers={
            "apikey": supa_key,
            "Authorization": f"Bearer {supa_key}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        })

    try:
        urllib.request.urlopen(req, timeout=10)
        action = "Updated" if existing else "Inserted"
        print(f"[supabase] {action} game: {row['title']} ({slug})")
        return True
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f"[supabase] Error {e.code}: {body[:200]}")
        return False


def main():
    parser = argparse.ArgumentParser(description="Deploy a game to R2 + Supabase")
    parser.add_argument("--game-dir", required=True, help="Path to built game directory")
    parser.add_argument("--slug", required=True, help="URL slug for the game")
    parser.add_argument("--metadata", help="Path to game metadata JSON file")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    game_dir = Path(args.game_dir)
    if not game_dir.exists():
        print(f"Error: {game_dir} does not exist")
        sys.exit(1)

    # Load metadata
    metadata = {}
    if args.metadata:
        metadata = json.loads(Path(args.metadata).read_text(encoding="utf-8"))
    elif (game_dir / "game_meta.json").exists():
        metadata = json.loads((game_dir / "game_meta.json").read_text(encoding="utf-8"))

    print(f"Deploying game: {args.slug}")
    print(f"  Source: {game_dir}")
    print(f"  Files: {sum(1 for _ in game_dir.rglob('*') if _.is_file())}")

    if args.dry_run:
        print("[dry-run] Would upload to R2 and insert into Supabase")
        return

    # 2026-05-05 — Generate cover image FIRST so it ships in the same R2
    # upload as the rest of the files. Uses xAI grok-imagine-image (~$0.02/img).
    # If thumbnail.png already exists in the game dir we keep it (allows manual
    # override). Otherwise we derive description + art-direction from the
    # metadata.json or design.json sitting next to game.js.
    thumb_path = game_dir / "thumbnail.png"
    if not thumb_path.exists():
        try:
            from generate_cover import generate_cover  # type: ignore
            # Pull art_direction + description from metadata, fall back to design.json
            description = metadata.get("description") or metadata.get("short_description") or args.slug
            art_direction = metadata.get("art_direction", "")
            if not art_direction:
                design_path = game_dir / "design.json"
                if design_path.exists():
                    try:
                        design = json.loads(design_path.read_text(encoding="utf-8"))
                        art_direction = design.get("art_direction", "") or design.get("art_style", "")
                    except Exception:
                        pass
            if not art_direction:
                art_direction = "Polished, vibrant indie game art with strong silhouette and dramatic lighting."
            title = metadata.get("title", args.slug.replace("-", " ").title())
            generate_cover(
                slug=args.slug,
                title=title,
                description=description,
                art_direction=art_direction,
                out_dir=game_dir,
            )
        except Exception as e:
            print(f"[cover] WARN: cover generation failed ({e}); proceeding without cover")

    # Upload to R2
    uploaded = upload_to_r2(game_dir, args.slug)
    print(f"  [r2] {uploaded} files uploaded to {R2_BUCKET}/{args.slug}/")

    # Insert metadata. game_url uses the workers.dev CDN pattern other games
    # use; thumbnail_url + hero_image_url point at the freshly-generated PNG.
    cdn_base = "https://forgeflow-games-cdn.isimcha85.workers.dev"
    metadata["game_url"] = f"{cdn_base}/{args.slug}/index.html"
    if thumb_path.exists() and not metadata.get("thumbnail_url"):
        metadata["thumbnail_url"] = f"{cdn_base}/{args.slug}/thumbnail.png"
    if thumb_path.exists() and not metadata.get("hero_image_url"):
        metadata["hero_image_url"] = f"{cdn_base}/{args.slug}/thumbnail.png"
    insert_game_metadata(args.slug, metadata)

    print(f"Done! Game available at: {cdn_base}/{args.slug}/index.html")


if __name__ == "__main__":
    main()
