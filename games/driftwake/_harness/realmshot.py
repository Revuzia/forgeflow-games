#!/usr/bin/env python
"""
Realm ground/sky capture probe — the A/B rig for TASK C.

Boots the game through real headed Chrome (the preview MCP cannot be used: a
hidden pane never composites, rAF never fires, and boot stalls at 'creating
context'), poses the camera at two FIXED framings, optionally applies a realm
block through `Terrain.applyRealm` / `Sky.applyRealm`, and saves one PNG per
framing.

Two jobs, one script:

  COLD NO-REGRESSION   run it with `--realm cold` before and after the edit and
                       diff the PNGs with `shotdiff.py`. Cold must be
                       pixel-identical up to TAA jitter, and the size of that
                       jitter is measured by running `--realm cold` twice
                       against the SAME build (the control).

  SAND / ASH           run it with `--realm sand|ash`; the realm block is
                       supplied HERE rather than imported, because the canonical
                       per-realm data belongs to `src/world/realms.js`, which
                       TASK C does not own. The blocks below are the
                       `_spec/_build/REALM_CONTRACT.md` §1a/§1b tables typed out.

The pose is set the way `_harness/shots.js` does it (place + look), so a capture
from here is framed identically to `01-hero` / `02-snow-grazing`.

    python _harness/realmshot.py --realm cold --out ../_shots/realm/cold_before
    python _harness/realmshot.py --realm sand --out ../_shots/realm/sand
"""
import argparse
import json
import os
import sys

from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_URL = "http://localhost:8788/games/driftwake/index.html"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]

# The two framings. Verbatim from _harness/shots.js `01-hero` and
# `02-snow-grazing` — same SPOT (0,0), same yaw/pitch/distance triples.
POSES = {
    "hero":  {"yaw": 2.40, "pitch": 0.17,  "dist": 6.2},
    "graze": {"yaw": 2.06, "pitch": -0.06, "dist": 3.0},
}

READY = """() => {
  const SF = globalThis.SNOWFLOW;
  if (!SF || !SF.terrain || !SF.rig || !SF.character) return false;
  const b = document.getElementById('boot');
  return !(b && !b.classList.contains('gone'));
}"""

CHROME_OFF = """() => {
  for (const sel of ['#boot','#hint','#overlay','#crosshair','#spellbar','#hud',
                     '#minimap','#floaters','#enemybars','#xphud','.overlay','#perf']) {
    document.querySelectorAll(sel).forEach(e => { e.style.display = 'none'; });
  }
}"""

POSE = """(p) => {
  const SF = globalThis.SNOWFLOW;
  // DETERMINISM. Under Playwright `navigator.webdriver` is true, so main.js
  // leaves AUTOPLAY on and the simulation keeps running (main.js:994-1004) —
  // the character idles, the spray pool churns, uTime advances, and two
  // captures of the SAME build differ across 77% of the frame. Measured:
  // px>1/255 = 74-77%, maxdiff 179. With dt pinned to exactly 0 the residual
  // drops to the TAA jitter alone, which is the noise floor a no-regression
  // claim has to be read against (controller.js:354 quotes "a mean of 1.5/255").
  SF.S.freezeTime = true;
  SF.character.position.x = 0;
  SF.character.position.z = 0;
  SF.character.position.y = SF.terrain.heightAt(0, 0);
  SF.character.velocity.x = 0;
  SF.character.velocity.y = 0;
  SF.character.velocity.z = 0;
  SF.rig.yaw = p.yaw;
  SF.rig.pitch = p.pitch;
  SF.rig.distance = p.dist;
  SF.rig.distanceTarget = p.dist;
}"""

# Applies a realm block exactly the way the integrator (src/world/realms.js)
# will: the cheap uniform writes first, then the two stalling re-bakes, then the
# awaited sky solve — NOT the debounced `_markDirty` path, so the first frame
# after this call is already lit by the new LUT (REALM_CONTRACT §2.1 class B).
APPLY = """async (block) => {
  const SF = globalThis.SNOWFLOW;
  const out = { steps: [] };
  if (block.settings) {
    for (const k of Object.keys(block.settings)) SF.S[k] = block.settings[k];
    out.steps.push('settings');
  }
  if (block.ground) {
    SF.terrain.applyRealm(block.ground);
    out.steps.push('terrain.applyRealm');
    out.rebakeDue = SF.terrain.realmRebakeDue;
    await SF.terrain.rebakeRealm();
    out.steps.push('terrain.rebakeRealm');
  }
  if (block.sky) {
    SF.sky.applyRealm(block.sky);
    out.steps.push('sky.applyRealm');
    // Read the flag rather than assuming: applyRealm must have marked the LUT
    // dirty, and `solve()` must clear it.
    out.skyDirtyBefore = SF.sky.lutDirty;
    await SF.sky.solve();
    out.skyDirtyAfter = SF.sky.lutDirty;
    out.skyBakes = SF.sky.bakeCount;
    out.steps.push('sky.solve');
  }
  out.groundAlbedo = SF.sky.groundAlbedo.slice();
  out.groundBounce = [SF.sky.groundBounce.x, SF.sky.groundBounce.y, SF.sky.groundBounce.z];
  return out;
}"""


def realm_blocks() -> dict:
    """The three realm blocks. Cold is the identity — applying it must change
    nothing, which is itself a test of the parameter surface."""
    cold = {
        "settings": {},
        "ground": {},           # empty object = leave every default in place
        "sky": {},
    }
    sand = {
        "settings": {
            "sunAzimuth": 206.0, "sunElevation": 22.0, "sunIntensity": 5.4,
            "sunTempWarm": 0.72, "ambientIntensity": 1.15,
            "showMountains": True, "mountainHeight": 1750.0, "shaftStrength": 0.22,
            "fogDensity": 0.0115, "fogHeightFalloff": 0.070, "fogStart": 18.0,
            "aerialStrength": 1.15,
            "windDirection": 130.0, "windStrength": 1.45,
            "sastrugiStrength": 1.35, "macroHeightScale": 1.25,
            "sssStrength": 0.18, "sssRadius": 0.55,
            "glintIntensity": 0.30, "glintGrazing": 0.25,
            "exposure": 0.170, "contrast": 1.10, "bloomStrength": 0.18,
        },
        "ground": {
            "albedo": [0.620, 0.505, 0.345], "roughness": 0.86,
            "f0": [0.035, 0.035, 0.035], "thickness": 0.45,
            "packedColor": [0.44, 0.355, 0.235], "packedRoughness": 0.52,
            "packedThickness": 0.20,
            "glazeColor": [0.74, 0.62, 0.40], "glazeRoughness": 0.11,
            "glazeF0": 0.050, "glazeThickness": 0.10,
            "looseColor": [0.700, 0.585, 0.415], "looseRoughness": 0.90,
            "rockColorA": [0.30, 0.24, 0.17], "rockColorB": [0.42, 0.34, 0.24],
            "rockGate": [0.22, 0.52],
            "sssShallow": [1.00, 0.96, 0.86], "sssDeep": [0.92, 0.66, 0.38],
            "caveTint": [0.82, 0.62, 0.42],
            "wrap": [0.24, 0.10], "bounceUp": 0.16,
            "detailScale": [11.0, 2.4, 0.44],
            "grainScale": 0.021,
            "glintCell": 1.92, "glintTint": [1.00, 0.94, 0.74], "glintEmissive": 0.0,
        },
        "sky": {
            "groundAlbedo": [0.55, 0.45, 0.31],
            "cloudAmount": 0.12,
            "cirrusColor": [0.72, 0.63, 0.50],
            "farSnowAlbedo": [0.60, 0.50, 0.36],
            "farRockAlbedo": [0.19, 0.155, 0.115],
            "farSnowGate": [0.30, 0.62],
            "farSssShallow": [1.00, 0.96, 0.86],
            "farSssDeep": [0.92, 0.66, 0.38],
        },
    }
    ash = {
        "settings": {
            "sunAzimuth": 74.0, "sunElevation": 9.5, "sunIntensity": 5.6,
            "sunTempWarm": 1.0, "ambientIntensity": 0.80,
            "showMountains": False, "mountainHeight": 0.0, "shaftStrength": 0.55,
            "fogDensity": 0.0155, "fogHeightFalloff": 0.026, "fogStart": 12.0,
            "aerialStrength": 1.30,
            "windDirection": 150.0, "windStrength": 0.75,
            "sastrugiStrength": 0.70, "macroHeightScale": 0.65,
            "sssStrength": 0.10, "sssRadius": 0.30,
            "glintIntensity": 0.18, "glintGrazing": 0.0,
            "exposure": 0.300, "contrast": 1.22, "bloomStrength": 0.34,
        },
        "ground": {
            "albedo": [0.082, 0.076, 0.074], "roughness": 0.93,
            "f0": [0.040, 0.040, 0.040], "thickness": 0.12,
            "packedColor": [0.048, 0.044, 0.043], "packedRoughness": 0.66,
            "packedThickness": 0.05,
            "glazeColor": [0.16, 0.075, 0.055], "glazeRoughness": 0.14,
            "glazeF0": 0.055, "glazeThickness": 0.04,
            "looseColor": [0.135, 0.125, 0.120], "looseRoughness": 0.95,
            "rockColorA": [0.030, 0.028, 0.028], "rockColorB": [0.075, 0.062, 0.056],
            "rockGate": [0.10, 0.34],
            "sssShallow": [1.00, 0.72, 0.46], "sssDeep": [0.55, 0.19, 0.08],
            "caveTint": [0.34, 0.24, 0.20],
            "wrap": [0.12, 0.06], "bounceUp": 0.05,
            "detailScale": [6.0, 1.35, 0.25],
            "grainScale": 0.009,
            "glintCell": 4.23, "glintTint": [1.00, 0.42, 0.11], "glintEmissive": 3.4,
        },
        "sky": {
            "groundAlbedo": [0.075, 0.070, 0.068],
            "cloudAmount": 0.85,
            "cirrusColor": [0.20, 0.18, 0.17],
            # showMountains is false for Ash, so the far range never marches and
            # these are inert — supplied anyway so the block has one shape.
            "farSnowAlbedo": [0.14, 0.12, 0.11],
            "farRockAlbedo": [0.045, 0.040, 0.038],
            "farSnowGate": [0.10, 0.34],
            "farSssShallow": [1.00, 0.72, 0.46],
            "farSssDeep": [0.55, 0.19, 0.08],
        },
    }
    return {"cold": cold, "sand": sand, "ash": ash}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--realm", default="cold", choices=("cold", "sand", "ash"))
    ap.add_argument("--out", required=True, help="output DIRECTORY")
    ap.add_argument("--wait", type=float, default=120.0)
    ap.add_argument("--settle", type=float, default=3.5, help="seconds per pose")
    ap.add_argument("--width", type=int, default=1280)
    ap.add_argument("--height", type=int, default=720)
    ap.add_argument("--skip-apply", action="store_true",
                    help="pose and shoot without calling applyRealm at all "
                         "(use against a build that predates the methods)")
    args = ap.parse_args()

    out = os.path.abspath(args.out)
    os.makedirs(out, exist_ok=True)
    block = realm_blocks()[args.realm]

    msgs, page_errors = [], []
    applied = None
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": args.width, "height": args.height})
        pg.on("console", lambda m: msgs.append((m.type, m.text)))
        pg.on("pageerror", lambda e: page_errors.append(f"pageerror: {e}"))
        pg.add_init_script(
            "window.__err=[];addEventListener('error',e=>window.__err.push(String(e.message)));"
            "addEventListener('unhandledrejection',e=>window.__err.push('reject: '+e.reason));"
        )
        pg.goto(args.url, wait_until="load", timeout=90_000)

        deadline = args.wait * 1000
        waited = 0
        ready = False
        while waited < deadline:
            try:
                if pg.evaluate(READY):
                    ready = True
                    break
            except Exception:
                pass
            pg.wait_for_timeout(500)
            waited += 500
        if not ready:
            print("NOT READY", file=sys.stderr)
            br.close()
            return 2

        # Freeze and clear FIRST, before anything else runs a frame.
        #
        # Two captures of the same build were 77% different until this landed,
        # and the residual after freezing was still structural because the
        # encounter director had already spawned a pack during the ready wait —
        # one run came back 22 draws / 1,799,120 tris (the documented empty-Cold
        # baseline) and the next 24 / 1,849,708. `enemies.clear()` puts both runs
        # on the same empty field, and `freezeTime` stops the director refilling
        # it (encounters.js:17 — dt === 0 is a strict no-op).
        scene0 = pg.evaluate("""() => {
            const SF = globalThis.SNOWFLOW;
            SF.S.freezeTime = true;
            // TAA and the film grain are the last two per-frame randomisers.
            // TAA re-jitters the projection every frame, so the captured frame
            // carries whatever sub-pixel offset it happened to land on — across
            // a grain field that is a 150/255 swing on edge pixels — and the
            // film grain is animated noise by construction (settings.js:150,
            // 160). With both frozen out and dt = 0 the frame is reproducible;
            // they are toggled through `set()` and not by writing S, because a
            // bare write bypasses every onChange subscriber (main.js:1044-1052).
            const put = (k, v) => { try { SF.set(k, v); } catch (e) { SF.S[k] = v; } };
            put('taa', false);
            put('grain', false);
            const E = SF.combat && SF.combat.enemies;
            if (!E) return {aliveBefore: -1, aliveAfter: -1};
            const before = E.aliveCount;
            // NOT E.clear(): it throws. `Enemies.clear()` (enemies.js:857-860)
            // loops b over BOLT_MAX and calls `vis.driveBolt(b, ...)`, and
            // MeshEnemies.driveBolt (meshEnemies.js:1286) dereferences
            // `this._boltMeshes[b].visible` unguarded, so any b past the pool's
            // real length is
            //   TypeError: Cannot set properties of undefined (setting 'visible')
            // Reported as an out-of-scope finding; per-id despawn avoids it.
            const ids = [];
            for (let i = 0; i < E.alive.length; i++) if (E.alive[i]) ids.push(E.id[i]);
            for (const id of ids) E.despawn(id);
            return {aliveBefore: before, aliveAfter: E.aliveCount};
        }""")
        print("scene -> " + json.dumps(scene0))
        pg.wait_for_timeout(2000)
        pg.evaluate(CHROME_OFF)

        if not args.skip_apply:
            applied = pg.evaluate(APPLY, block)
            print("apply -> " + json.dumps(applied))
            pg.wait_for_timeout(1200)

        stats = {}
        for name, pose in POSES.items():
            pg.evaluate(POSE, pose)
            pg.wait_for_timeout(int(args.settle * 1000))
            pg.evaluate(CHROME_OFF)
            path = os.path.join(out, name + ".png")
            pg.screenshot(path=path)
            print(f"  shot {name} -> {path}")

        stats = pg.evaluate("""() => {
            const SF = globalThis.SNOWFLOW;
            return {draws: SF.perfStats.drawCalls, tris: SF.perfStats.triangles,
                    pageErrors: window.__err || []};
        }""")
        br.close()

    shader_errs = [t for ty, t in msgs if ty == "error"
                   and any(m in t for m in ("THREE.WebGLProgram", "THREE.WebGLShader",
                                            "ERROR:", "Program Info Log", "VALIDATE_STATUS"))]
    other = [t for ty, t in msgs if ty == "error" and t not in shader_errs]

    print(f"\ndraws/tris   {stats['draws']} / {stats['tris']}")
    for title, items in (("SHADER COMPILE / LINK FAILURES", shader_errs),
                         ("UNCAUGHT PAGE ERRORS", stats["pageErrors"] + page_errors),
                         ("CONSOLE ERRORS", other)):
        if items:
            print(f"\n--- {title} ({len(items)}) ---")
            for t in items[:20]:
                print("  " + str(t).replace("\n", "\n    ")[:2000])

    with open(os.path.join(out, "probe.json"), "w", encoding="utf-8") as f:
        json.dump({"realm": args.realm, "applied": applied, "stats": stats,
                   "shaderErrors": shader_errs}, f, indent=2)

    ok = not shader_errs and not stats["pageErrors"] and not page_errors
    print(f"\nRESULT: {'OK' if ok else 'FAIL'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
