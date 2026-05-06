#!/usr/bin/env python3
"""
sprite_generator.py — Generate game sprites using PixelLab API.

Uses PixelLab's PixFlux model for high-quality pixel art generation.
Only used when Kenney.nl CC0 assets are insufficient for the game's needs.

API: https://api.pixellab.ai/v1/
Pricing: Free tier available, pay-per-generation after quota.
"""
import base64
import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path

NOMI = Path(os.path.expandvars("%APPDATA%")) / "Nomi"

def get_api_key() -> str:
    cfg_path = NOMI / "api_config.json"
    if cfg_path.exists():
        cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
        return cfg.get("pixellab", {}).get("api_key", "")
    return ""


def generate_sprite(
    description: str,
    width: int = 64,
    height: int = 64,
    output_path: str = None,
    text_guidance: float = 7.0,
) -> bytes | None:
    """
    Generate a pixel art sprite from a text description.

    Args:
        description: Text description of the sprite (e.g., "pixel art warrior, idle stance, fantasy RPG")
        width: Output width in pixels (max 400)
        height: Output height in pixels (max 400)
        output_path: Optional path to save the PNG file
        text_guidance: How closely to follow the text (1-15, default 7)

    Returns:
        PNG bytes or None if failed
    """
    api_key = get_api_key()
    if not api_key:
        print("[pixellab] No API key found in api_config.json")
        return None

    url = "https://api.pixellab.ai/v1/generate-image-pixflux"
    payload = {
        "description": description,
        "text_guidance": text_guidance,
        "image_size": {"width": min(width, 400), "height": min(height, 400)},
    }

    data = json.dumps(payload).encode()

    # 2026-04-22 FIX: PixelLab silently dropped sprites (enemy_10, enemy_11) when
    # the API timed out mid-generation. Retry twice with backoff on timeout / 5xx,
    # then verify the output file exists before returning success.
    last_err = "unknown"
    for attempt in range(3):
        req = urllib.request.Request(url, data=data, method="POST", headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        })
        try:
            resp = urllib.request.urlopen(req, timeout=60)
            result = json.loads(resp.read())
            img_b64 = result["image"]["base64"]
            img_bytes = base64.b64decode(img_b64)
            cost = result.get("usage", {}).get("usd", 0)

            if output_path:
                Path(output_path).parent.mkdir(parents=True, exist_ok=True)
                Path(output_path).write_bytes(img_bytes)
                # Verify file landed on disk before claiming success
                if not Path(output_path).exists() or Path(output_path).stat().st_size < 100:
                    print(f"[pixellab] Write verification failed for {output_path}")
                    last_err = "write_verification_failed"
                    continue
                print(f"[pixellab] Generated: {output_path} ({len(img_bytes)} bytes, ${cost})")

            return img_bytes
        except urllib.error.HTTPError as e:
            body = e.read().decode(errors="replace")[:200]
            last_err = f"HTTP {e.code}: {body}"
            # 401/403/400 are logic errors — don't retry
            if e.code in (400, 401, 403):
                print(f"[pixellab] Non-retryable error {e.code}: {body}")
                return None
            print(f"[pixellab] Error {e.code} (attempt {attempt+1}/3): {body}")
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            last_err = f"timeout/network: {e}"
            print(f"[pixellab] Timeout/network error (attempt {attempt+1}/3): {e}")
        except Exception as e:
            last_err = str(e)
            print(f"[pixellab] Error (attempt {attempt+1}/3): {e}")

        if attempt < 2:
            delay = 10 * (2 ** attempt)  # 10s, 20s
            time.sleep(delay)

    print(f"[pixellab] FAILED after 3 attempts: {last_err}")
    return None


def generate_character_set(
    character_name: str,
    style: str,
    output_dir: str,
    size: int = 64,
) -> dict:
    """
    Generate a set of character sprites for different states.

    Args:
        character_name: Name/description of the character
        style: Art style (e.g., "pixel art", "16-bit", "fantasy")
        output_dir: Directory to save sprites
        size: Sprite size in pixels

    Returns:
        Dict mapping state names to file paths
    """
    states = {
        "idle": f"{style} {character_name}, idle stance, facing right, game sprite",
        "run": f"{style} {character_name}, running, dynamic pose, facing right, game sprite",
        "jump": f"{style} {character_name}, jumping, airborne, facing right, game sprite",
        "attack": f"{style} {character_name}, attacking, sword swing, facing right, game sprite",
        "hurt": f"{style} {character_name}, hurt, knocked back, facing right, game sprite",
    }

    result = {}
    out_path = Path(output_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    for state_name, description in states.items():
        file_path = out_path / f"{character_name.lower().replace(' ', '_')}_{state_name}.png"
        sprite = generate_sprite(description, size, size, str(file_path))
        if sprite:
            result[state_name] = str(file_path)
        else:
            print(f"[pixellab] Failed to generate {state_name} for {character_name}")

    return result


def generate_enemy_sprites(
    enemies: list[dict],
    style: str,
    output_dir: str,
    size: int = 48,
) -> dict:
    """
    Generate sprites for a list of enemies.

    Args:
        enemies: List of dicts with 'name' and 'visual_description' keys
        style: Art style
        output_dir: Directory to save sprites
        size: Sprite size

    Returns:
        Dict mapping enemy names to file paths
    """
    result = {}
    out_path = Path(output_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    for enemy in enemies:
        name = enemy.get("name", "enemy")
        desc = enemy.get("visual_description", f"{style} enemy creature, game sprite")
        file_path = out_path / f"enemy_{name.lower().replace(' ', '_')}.png"

        sprite = generate_sprite(f"{style} {desc}, game sprite, facing left", size, size, str(file_path))
        if sprite:
            result[name] = str(file_path)

    return result


def check_balance() -> dict:
    """Check remaining PixelLab API balance."""
    api_key = get_api_key()
    if not api_key:
        return {"error": "No API key"}

    req = urllib.request.Request("https://api.pixellab.ai/v1/balance", headers={
        "Authorization": f"Bearer {api_key}",
    })
    try:
        resp = urllib.request.urlopen(req, timeout=10)
        return json.loads(resp.read())
    except Exception as e:
        return {"error": str(e)}


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        desc = " ".join(sys.argv[1:])
        generate_sprite(desc, 64, 64, "test_output.png")
    else:
        print("Usage: python sprite_generator.py <description>")
        print("Example: python sprite_generator.py pixel art fire mage, casting spell")
        balance = check_balance()
        print(f"Balance: {json.dumps(balance)}")
