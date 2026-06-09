#!/usr/bin/env python3
"""engine_game_build.py — ADDITIVE Phase-A wiring (ForgeFlow Engine ↔ Games pipeline).

Turns a ForgeFlow Games `content.json` into a deployable game that runs on the from-scratch **ForgeFlow
Engine** instead of Phaser/Three. It does NOT modify the Phaser generator — it only CONSUMES content.json
(via the engine's existing `ffg_to_scene` bridge) and assembles a self-contained static game directory:

    <out>/
      index.html     (engine bootstrap: mode=scene, scene=./scene.json)
      scene.json      (ffg_to_scene.convert(content))
      src/            (the ForgeFlow Engine runtime, copied from forgeflow-engine/src)

That directory deploys as-is via `pipeline/deploy_game.py --game-dir <out> --slug <slug>`.

What AAA features a scene_loader game actually exercises (honest): the engine's **core render path** —
hierarchical culling (FG1) + cascaded shadow maps (FG2) + GPU instancing + lit 3D / pixel-faithful 2D.
The standalone GI showcases (SDFGI / volumetric / radiance-cascades) are separate `?mode` demos and are
NOT auto-applied to an arbitrary converted scene; wiring those per-genre is Phase C in
forgeflow-engine/ENGINE_GAMES_INTEGRATION_PLAN.md.

Usage:
  python pipeline/engine/engine_game_build.py --content pipeline/engine/golden/tactics3d.content.json \
      --out games/_engine/void-tactics --slug void-tactics-engine [--mode auto|2d|3d]
"""
import argparse, json, shutil, sys
from pathlib import Path

GAMES = Path(__file__).resolve().parents[2]          # .../Claude Claw/forgeflow-games
CLAW = GAMES.parent                                  # .../Claude Claw
ENGINE = CLAW / "forgeflow-engine"
sys.path.insert(0, str(ENGINE / "tools"))
import ffg_to_scene                                  # the engine's READ-ONLY content.json -> scene bridge

INDEX_HTML = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>{title}</title>
<style>html,body{{margin:0;height:100%;background:#000;overflow:hidden}}
#c{{width:100vw;height:100vh;display:block}}
#err{{position:fixed;inset:0;color:#f66;font:13px/1.5 monospace;padding:16px;white-space:pre-wrap}}</style></head>
<body><canvas id="c"></canvas>
<script type="module">
  import {{ Engine }} from "./src/engine.js";
  const canvas = document.getElementById("c");
  window.__ENGINE_MODE__ = "scene";          // render the converted FFG scene
  window.__SCENE_URL__ = "./scene.json";     // shipped alongside index.html
  try {{ const eng = new Engine(canvas); window.__ENGINE__ = eng; eng.start(); }}
  catch (e) {{
    window.__ENGINE_ERROR__ = String(e);
    const d = document.createElement("div"); d.id = "err";
    d.textContent = "Engine failed to start:\\n" + e; document.body.appendChild(d);
  }}
</script></body></html>
"""


def build(content_path, out_dir, mode="auto", slug="engine-game"):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    content = json.loads(Path(content_path).read_text(encoding="utf-8"))
    scene = ffg_to_scene.convert(content, mode=mode)               # may raise on an unwired genre (never fakes)
    (out / "scene.json").write_text(json.dumps(scene), encoding="utf-8")
    for sub in ("src", "assets"):                                   # bundle runtime + the demo assets it
        dst = out / sub                                             # fetches at startup (test-tetra.gltf,
        if dst.exists():                                           # asset-manifest.json) so nothing 404s
            shutil.rmtree(dst)
        shutil.copytree(ENGINE / sub, dst)
    (out / "index.html").write_text(INDEX_HTML.format(title=slug), encoding="utf-8")
    kind = "2d" if scene.get("type") == "2d" else "3d"
    elements = len(scene.get("sprites") or scene.get("nodes") or [])
    return {"out": str(out), "genre": content.get("genre"), "kind": kind, "elements": elements}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--content", required=True, help="path to an FFG content.json")
    ap.add_argument("--out", required=True, help="output game directory (deployable)")
    ap.add_argument("--mode", default="auto", choices=["auto", "2d", "3d"])
    ap.add_argument("--slug", default="engine-game")
    a = ap.parse_args(argv)
    r = build(a.content, a.out, a.mode, a.slug)
    print(f"engine game built: {r['out']}  genre={r['genre']} kind={r['kind']} elements={r['elements']}")
    print(f"deploy: python pipeline/deploy_game.py --game-dir {r['out']} --slug {a.slug}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
