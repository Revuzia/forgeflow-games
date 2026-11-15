#!/usr/bin/env python3
"""
character_consistency.py — Keep a character's look consistent across animation frames.

Research says LoRA training gets ~90% consistency; IPAdapter/reference-based gets
70-85% without training. We implement the reference-based approach here since
LoRA training requires GPU and 2-4 hours of setup per character.

Strategy (reference-anchor method):
  1. Generate a "reference" protagonist sprite at high quality (idle pose)
  2. Save reference image bytes
  3. When generating additional poses (run/jump/attack), use Stability API's
     IMAGE-TO-IMAGE endpoint with the reference as the base + a pose-specific
     prompt. This biases the generator toward the reference's visual style.
  4. Fallback: if Stability image-to-image isn't available, repeat the SAME
     detailed visual_description in every sprite prompt (weaker but free).

Coverage: for each character (protagonist + bosses with animation needs), generate:
  idle, run_1, run_2, run_3 (3-frame run cycle), jump_up, jump_fall,
  attack_1, attack_2, hurt, die

That's 10 frames per character. For a single protagonist, ~10 * $0.01 = $0.10/char.

Usage (module):
    from character_consistency import generate_character_frames
    frames = generate_character_frames("hero", visual_desc, assets_dir)

CLI:
    python scripts/character_consistency.py --name hero --desc "red mascot with cap" --out assets/
"""
import argparse
import base64
import json
import os
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

NOMI = Path(os.path.expandvars("%APPDATA%")) / "Nomi"


ANIMATION_FRAMES = [
    # (frame_name, pose_prompt)
    ("idle",      "standing still, neutral pose, facing right"),
    ("run_1",     "running right, leg forward, arms pumping"),
    ("run_2",     "running right, mid-stride, both feet airborne"),
    ("run_3",     "running right, trailing leg forward"),
    ("jump_up",   "jumping upward, arms raised"),
    ("jump_fall", "falling, arms outstretched"),
    ("attack_1", "attacking, arm forward, weapon or fist extended"),
    ("attack_2", "follow-through of attack, recovery pose"),
    ("hurt",     "recoiling from damage, leaning back"),
    ("die",      "defeated, lying on ground"),
]


def _load_pixellab_key():
    try:
        cfg = json.loads((NOMI / "api_config.json").read_text(encoding="utf-8"))
        return cfg.get("pixellab", {}).get("api_key", "")
    except Exception:
        return ""


def _load_stability_key():
    try:
        cfg = json.loads((NOMI / "api_config.json").read_text(encoding="utf-8"))
        return (cfg.get("stability", {}).get("api_key")
                or cfg.get("providers", {}).get("stability", {}).get("api_key", ""))
    except Exception:
        return ""


def generate_reference_sprite(visual_description: str, output_path: Path,
                              width: int = 64, height: int = 64) -> bool:
    """Generate the first high-quality reference via PixelLab."""
    try:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        from sprite_generator import generate_sprite
    except ImportError:
        print("[consistency] sprite_generator not available")
        return False

    prompt = (
        f"pixel art {visual_description}, "
        f"game character reference sheet, facing right, idle neutral pose, "
        f"16-bit style, clean transparent background, clear silhouette"
    )
    try:
        result = generate_sprite(prompt, width, height, str(output_path))
        return result is not False and output_path.exists()
    except Exception as e:
        print(f"[consistency] reference gen failed: {e}")
        return False


def generate_frame_with_reference(visual_description: str, pose_prompt: str,
                                  reference_path: Path, output_path: Path,
                                  width: int = 64, height: int = 64) -> bool:
    """Generate a new pose using the reference via Stability image-to-image.

    If Stability key missing OR image-to-image fails, falls back to
    prompt-only generation with the same visual_description (weaker consistency).
    """
    stab_key = _load_stability_key()
    ref_exists = reference_path.exists()

    if stab_key and ref_exists:
        # Stability AI image-to-image (structure strength = how closely to match reference)
        url = "https://api.stability.ai/v2beta/stable-image/generate/sd3"
        try:
            # Stability v2beta uses multipart/form-data
            import urllib.parse
            boundary = "----ForgeFlowBoundary"
            body_parts = []
            body_parts.append(f"--{boundary}\r\n".encode())
            body_parts.append(b'Content-Disposition: form-data; name="image"; filename="ref.png"\r\n')
            body_parts.append(b'Content-Type: image/png\r\n\r\n')
            body_parts.append(reference_path.read_bytes())
            body_parts.append(f"\r\n--{boundary}\r\n".encode())
            body_parts.append(f'Content-Disposition: form-data; name="prompt"\r\n\r\n{visual_description}, {pose_prompt}, pixel art, transparent background\r\n'.encode())
            body_parts.append(f"--{boundary}\r\n".encode())
            body_parts.append(b'Content-Disposition: form-data; name="mode"\r\n\r\nimage-to-image\r\n')
            body_parts.append(f"--{boundary}\r\n".encode())
            body_parts.append(b'Content-Disposition: form-data; name="strength"\r\n\r\n0.6\r\n')  # 0.6 = retain 60% of reference
            body_parts.append(f"--{boundary}--\r\n".encode())
            body = b"".join(body_parts)

            req = urllib.request.Request(
                url, data=body, method="POST",
                headers={
                    "Authorization": f"Bearer {stab_key}",
                    "Content-Type": f"multipart/form-data; boundary={boundary}",
                    "Accept": "image/*",
                },
            )
            with urllib.request.urlopen(req, timeout=120) as r:
                output_path.write_bytes(r.read())
            return output_path.exists() and output_path.stat().st_size > 1000
        except urllib.error.HTTPError as e:
            body = e.read().decode(errors="replace")[:200]
            print(f"[consistency] Stability i2i HTTP {e.code}: {body}")
        except Exception as e:
            print(f"[consistency] Stability i2i error: {e}")

    # Fallback: PixelLab with same visual description + pose
    try:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        from sprite_generator import generate_sprite
        combined = f"pixel art {visual_description}, {pose_prompt}, 16-bit style, transparent background, consistent character design"
        return generate_sprite(combined, width, height, str(output_path)) is not False
    except Exception as e:
        print(f"[consistency] fallback gen failed: {e}")
        return False


def generate_character_frames(character_name: str, visual_description: str,
                              output_dir: Path, frames: list = None) -> dict:
    """Generate a full animation set for a character with consistency.

    Returns dict {frame_name: output_path, ...}.
    Only generates frames that don't already exist (idempotent — can re-run).
    """
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    frames = frames or ANIMATION_FRAMES

    # 1. Reference (idle frame)
    ref_path = output_dir / f"{character_name}_idle.png"
    if not ref_path.exists():
        print(f"[consistency] Generating reference: {character_name}_idle.png")
        if not generate_reference_sprite(visual_description, ref_path):
            print(f"[consistency] reference gen FAILED — aborting character {character_name}")
            return {}
    else:
        print(f"[consistency] Reference exists: {ref_path.name}")

    results = {"idle": str(ref_path)}

    # 2. All other frames using reference
    for frame_name, pose_prompt in frames:
        if frame_name == "idle":
            continue  # already done
        out_path = output_dir / f"{character_name}_{frame_name}.png"
        if out_path.exists():
            results[frame_name] = str(out_path)
            continue
        print(f"[consistency] Frame: {character_name}_{frame_name}.png")
        if generate_frame_with_reference(visual_description, pose_prompt, ref_path, out_path):
            results[frame_name] = str(out_path)
        time.sleep(1)  # polite pause between API calls

    return results


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", required=True)
    ap.add_argument("--desc", required=True)
    ap.add_argument("--out", default="assets/characters")
    args = ap.parse_args()

    frames = generate_character_frames(args.name, args.desc, Path(args.out))
    print(json.dumps(frames, indent=2))


if __name__ == "__main__":
    main()
