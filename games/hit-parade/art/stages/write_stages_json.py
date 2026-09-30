"""HIT PARADE - writes data/stages.json (lane STAGES). Plain Python 3.

  python art/stages/write_stages_json.py            # write data/stages.json
  python art/stages/write_stages_json.py --measure  # also fill rust_theater build stats from the GLB

Source of truth for the stage definitions: THIS file (rust_theater is authored here; the other four
sets are TODO stubs whose kit lists are copied from _research/environment/env_kit.json).
The Blender build (art/stages/rust_theater.py) READS data/stages.json for the light pool, crowd bays
and camera hints, so the proof renders show exactly what the data says.
Axes: game/glTF metres, +X = fight line, +Y up, camera on +Z looking toward -Z (CONTRACT 2).
Light intensities are three.js r186 physical units (directional/hemisphere = lux-like irradiance
scale, point/spot = candela, decay 2). ASCII only.
"""
import json
import os
import sys
import struct

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
ENV = os.path.join(ROOT, "_research", "environment", "env_kit.json")
OUT = os.path.join(ROOT, "data", "stages.json")

CAMERA = {
    "vFovDeg": 35.0, "heightM": 1.25, "lookAtY": 1.0, "distanceM": [4.36, 7.6], "pitchDeg": [-2.0, -4.0],
    "wallClampX": 8.0,
    "note": "FIGHTING_DESIGN 7b. Camera x is clamped so the splat wall sits at the screen edge on the fight line: "
            "|camX| <= wallClampX - distance * tan(hFov/2). Proof renders: _harness/_reports/stages/rust_theater_*.png",
    "proofShots": [
        {"id": "near_center", "pos": [0.0, 1.25, 4.4], "look": [0.0, 1.0, 0.0]},
        {"id": "far_center", "pos": [0.0, 1.25, 7.6], "look": [0.0, 1.0, 0.0]},
        {"id": "near_corner_r", "pos": [5.53, 1.25, 4.4], "look": [5.53, 1.0, 0.0]},
        {"id": "far_corner_l", "pos": [-3.74, 1.25, 7.6], "look": [-3.74, 1.0, 0.0]},
        {"id": "far_center_phone", "pos": [0.0, 1.25, 6.22], "look": [0.0, 1.0, 0.0], "aspect": 2.1667},
    ],
}

RUST = {
    "id": "rust_theater",
    "name": "THE RUST THEATER",
    "status": "built",
    "glb": "rust_theater.glb",
    "source": "art/stages/rust_theater.py",
    "home": ["johnny", "rerun"],
    "look": "condemned vaudeville theatre turned fight pit: blue-painted brick pit walls with iron-banded doors and "
            "wall torches, stone floor; bleacher crowd behind the pit; torn red-velvet proscenium, opera boxes and a "
            "bulb marquee on the old stage behind",
    "floor": {"y": 0.0, "surface": "stone", "fightStrip": {"x": [-8.0, 8.0], "z": [-1.5, 1.5]},
              "extent": {"x": [-12.0, 12.0], "z": [-3.2, 8.0]}},
    "walls": {
        "x": [-8.0, 8.0],
        "splat": [
            {"id": 0, "x": -8.0, "normal": [1, 0, 0], "z": [-3.2, 3.0], "heightM": 4.2, "surface": "blue_brick",
             "dustColor": "#7d8fb0"},
            {"id": 1, "x": 8.0, "normal": [-1, 0, 0], "z": [-3.2, 3.0], "heightM": 4.2, "surface": "blue_brick",
             "dustColor": "#7d8fb0"},
        ],
        "note": "WALL_SPLAT event b = wall id (0 = x -8, 1 = x +8), CONTRACT 17.6",
    },
    "spawn": {"distanceM": 2.40, "p1": [-1.2, 0.0, 0.0], "p2": [1.2, 0.0, 0.0]},
    "camera": CAMERA,
    "exposure": 1.0,
    "toneMapping": "neutral",
    "fog": {"color": "#17121d", "near": 15.0, "far": 50.0},
    "environment": {"hdr": "rust_theater_env.hdr", "intensity": 0.28, "background": False,
                    "src": "Poly Haven afrikaans_church_interior_2k.hdr (CC0), downsampled to 512x256",
                    "backgroundColor": "#0b0910"},
    "lights": [
        {"id": "key", "type": "directional", "color": "#ffd8ab", "intensity": 2.6,
         "position": [-5.0, 10.0, 8.0], "target": [0.0, 1.0, 0.0], "castShadow": True,
         "shadow": {"mapSize": 1024, "bias": -0.0004, "normalBias": 0.03,
                    "camera": {"left": -10.0, "right": 10.0, "top": 7.0, "bottom": -4.0, "near": 1.0, "far": 30.0}}},
        {"id": "rim", "type": "directional", "color": "#86a8ff", "intensity": 1.9,
         "position": [4.0, 7.0, -10.0], "target": [0.0, 1.2, 0.0], "castShadow": False},
        {"id": "fill", "type": "hemisphere", "sky": "#5b6fa6", "ground": "#3b2621", "intensity": 0.9},
        {"id": "torch_l", "type": "point", "color": "#ff8a36", "intensity": 7.0, "distance": 9.0, "decay": 2,
         "position": [-7.74, 2.5, -0.15], "flicker": {"amp": 0.22, "hz": 7.0}},
        {"id": "torch_r", "type": "point", "color": "#ff8a36", "intensity": 7.0, "distance": 9.0, "decay": 2,
         "position": [7.74, 2.5, -0.15], "flicker": {"amp": 0.22, "hz": 6.3}},
        {"id": "stage_wash", "type": "spot", "color": "#ff9d7e", "intensity": 130.0, "distance": 32.0, "decay": 2,
         "position": [0.0, 9.0, -3.0], "target": [0.0, 5.0, -10.6], "angleDeg": 44.0, "penumbra": 0.65},
        {"id": "marquee", "type": "point", "color": "#ffcf85", "intensity": 14.0, "distance": 9.0, "decay": 2,
         "position": [0.0, 4.0, -15.2], "flicker": {"amp": 0.05, "hz": 13.0}},
    ],
    "lightsNote": "FIXED pool: created once at stage load, never added/removed (shader programs stay warm). "
                  "No lights are embedded in the GLB. Flicker = view-only intensity modulation.",
    "crowd": {
        "atlas": "crowd_atlas.webp", "meta": "crowd_atlas.json", "cols": 12, "rows": 6, "count": 72,
        "cardHeightM": 2.4, "cardWidthM": 1.2, "anchor": [0.5, 0.97917],
        "tint": "#d2c3bd", "brightness": 0.54,
        "moods": {"idle": ["watch"], "cheer": ["cheer", "hype"], "jeer": ["jeer"]},
        "nodes": "GLB empties crowd_<bay>_<row>_<i>: position = feet point, +Z = card facing, uniform scale = card "
                 "height; extras {bay,row,i,rand,angle}. Generated from the bays below (rows run along world X; "
                 "x step = spacing, jitter = [x,z] half-ranges from mulberry32(seed); card yaw = faceYawDeg about +Y).",
        "bays": [
            {"id": "pit", "x": [-13.6, 13.6], "spacing": 0.62, "jitter": [0.14, 0.08], "faceYawDeg": 0.0,
             "rows": [{"z": -4.1, "y": 0.3}, {"z": -4.9, "y": 0.6}, {"z": -5.7, "y": 0.9}, {"z": -6.5, "y": 1.2}],
             "seed": 1301},
            {"id": "box_l1", "x": [-10.8, -8.4], "spacing": 0.8, "jitter": [0.1, 0.05], "faceYawDeg": 22.0,
             "rows": [{"z": -9.62, "y": 3.0}], "seed": 1302},
            {"id": "box_l2", "x": [-10.8, -8.4], "spacing": 0.8, "jitter": [0.1, 0.05], "faceYawDeg": 22.0,
             "rows": [{"z": -9.62, "y": 5.6}], "seed": 1303},
            {"id": "box_r1", "x": [8.4, 10.8], "spacing": 0.8, "jitter": [0.1, 0.05], "faceYawDeg": -22.0,
             "rows": [{"z": -9.62, "y": 3.0}], "seed": 1304},
            {"id": "box_r2", "x": [8.4, 10.8], "spacing": 0.8, "jitter": [0.1, 0.05], "faceYawDeg": -22.0,
             "rows": [{"z": -9.62, "y": 5.6}], "seed": 1305},
        ],
    },
    "music": "music_stage_rust_theater",
    "musicHint": "AUDIO_KIT music_stage pick 'Halloween Rocks' (Evil Mind, rock, 129 BPM) - AUDIO lane maps the id",
    "ambient": "amb_theater_crowd",
    "ambientHint": "crowd bed that follows SHOWTIME/ratings + torch crackle near the walls",
    "dressing": {
        "animated": [
            {"what": "torch flames", "nodes": "flame_*", "how": "view-side flicker (scale/emissive) synced to torch_l/r flicker"},
            {"what": "marquee bulbs", "nodes": "marquee_bulbs", "how": "optional chase pattern on emissive intensity"},
            {"what": "crowd", "how": "instanced cards, vertex bob/sway, pose swaps by ratings mood"},
        ],
        "splatWallDust": "#7d8fb0",
    },
}


def stubs():
    env = json.load(open(ENV, encoding="utf-8"))["sets"]

    def kit(key):
        s = env[key]
        tex = []
        for t in s.get("textures", []):
            tex.append(t.get("label") if isinstance(t, dict) else str(t))
        hd = [h.get("id") if isinstance(h, dict) else str(h) for h in s.get("hdri", [])]
        mods = [m.get("id") if isinstance(m, dict) else str(m) for m in s.get("models", [])]
        proc = [str(p) for p in s.get("thin_procedural", [])]
        return {"verdict": s.get("verdict"), "models": mods, "textures": tex, "hdri": hd, "procedural": proc,
                "src": "_research/environment/env_kit.json sets." + key + " + ENV_KIT.md"}

    return [
        {"id": "butcher_block", "name": "BUTCHER BLOCK", "status": "todo", "glb": "butcher_block.glb",
         "home": ["bruno", "boneyard", "freak"], "look": "cooking-show meat locker (no gore beyond comic splatter)",
         "kit": kit("2_butcher_block")},
        {"id": "wheel_of_pain", "name": "WHEEL OF PAIN", "status": "todo", "glb": "wheel_of_pain.glb",
         "home": ["zambini", "lotus"], "look": "neon game-show floor with the giant wheel",
         "kit": kit("3_wheel_of_pain")},
        {"id": "rooftop", "name": "CHANNEL 13 ROOFTOP", "status": "todo", "glb": "rooftop.glb",
         "home": ["patch", "spin", "gazza"], "look": "night rooftop, rain, neon CHANNEL 13 sign",
         "kit": kit("4_channel13_rooftop")},
        {"id": "control_room", "name": "THE CONTROL ROOM", "status": "todo", "glb": "control_room.glb",
         "home": ["krane", "ricky"], "look": "finale under the studio: CRT banks, pipes, boiler (boss stage)",
         "kit": kit("5_control_room")},
    ]


def glb_stats(path):
    """draws (primitives on mesh nodes; an EXT_mesh_gpu_instancing node counts once), triangles, bytes."""
    b = open(path, "rb").read()
    jl = struct.unpack_from("<I", b, 12)[0]
    g = json.loads(b[20:20 + jl].decode("utf-8"))
    draws = tris = 0
    inst_tris = 0
    for n in g.get("nodes", []):
        if "mesh" not in n:
            continue
        m = g["meshes"][n["mesh"]]
        inst = n.get("extensions", {}).get("EXT_mesh_gpu_instancing")
        count = 1
        if inst:
            count = g["accessors"][list(inst["attributes"].values())[0]]["count"]
        for p in m["primitives"]:
            draws += 1
            if "indices" in p:
                t = g["accessors"][p["indices"]]["count"] // 3
            else:
                t = g["accessors"][p["attributes"]["POSITION"]]["count"] // 3
            tris += t * count
    crowd = [n for n in g.get("nodes", []) if str(n.get("name", "")).startswith("crowd_")]
    return {"bytes": len(b), "draws": draws, "triangles": tris, "materials": len(g.get("materials", [])),
            "textures": len(g.get("textures", [])), "crowdNodes": len(crowd),
            "extensions": g.get("extensionsUsed", [])}


def main():
    rust = json.loads(json.dumps(RUST))
    if "--measure" in sys.argv:
        gp = os.path.join(ROOT, "art", "gltf", "stages", "rust_theater.glb")
        if os.path.exists(gp):
            st = glb_stats(gp)
            envp = os.path.join(ROOT, "art", "gltf", "stages", "rust_theater_env.hdr")
            st["envBytes"] = os.path.getsize(envp) if os.path.exists(envp) else None
            rust["build"] = st
            print("measured", st)
    data = {
        "version": 1,
        "units": "metres; game/glTF axes: +X fight line, +Y up, camera on +Z looking toward -Z",
        "budget": {"bytesPerStage": 6000000, "drawsStage": 150, "drawsWithCrowd": 250},
        "stages": [rust] + stubs(),
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(json.dumps(data, indent=2) + "\n")
    print("wrote", OUT, os.path.getsize(OUT), "bytes")


if __name__ == "__main__":
    main()
