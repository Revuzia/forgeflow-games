# -*- coding: utf-8 -*-
"""
qa_boneforensic.py -- port 8821. THE leg-vanishing forensic.

For each body: spawn on the vis layer, drive it walking for 2 s of GAME time,
then, on the live instance:
  * per-bone: basis magnitudes + translation + finiteness of
      (a) bone.matrixWorld  (b) skeleton.boneInverses[i]
      (c) the composite skeleton.boneMatrices[i*16..]  (what the GPU reads)
  * CPU-emulate the EXACT shader chain (world = sum w * M * p, bindMatrix
    is identity -- dumped to prove it) for every 7th vertex; bucket vertices
    by dominant bone; report per-bone mean world Y, NaN counts, and the
    skinned bbox vs the bind bbox.
That names the corrupt bones and shows where the leg vertices actually land.
"""
import json
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[3]
PORT = 8821
GAME_URL = f"http://localhost:{PORT}/games/driftwake/index.html?autoplay"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]

JS = """(async () => {
    const SF = SNOWFLOW, v = SF.combat.enemies.vis, c = SF.character;
    const SLOT = 23;
    const x = c.position.x, z = c.position.z - 6;
    const y = SF.terrain.heightAt(x, z);
    v.spawn(SLOT, 'KEY', x, y, z);
    const inst = v._slotInst[SLOT];
    if (!inst) return { err: 'not bound (body not resident?)' };

    const reg = SF.combat.registry;
    const gameWait = (sec) => new Promise((res) => {
        const t0 = reg.time;
        const tick = () => (reg.time - t0 >= sec) ? res()
            : requestAnimationFrame(tick);
        tick();
    });
    // drive it WALKING so the mixer poses the legs (speed01 0.6 = walk/run)
    const drv = setInterval(() => v.drive(SLOT, x, y, z, Math.PI,
        0.6, 0, 0, 0, 0), 30);
    await gameWait(2.0);

    const sk = inst.skeleton;
    const bones = sk.bones;
    const bm = sk.boneMatrices;          // composite, GPU input
    const inv = sk.boneInverses;

    const mag3 = (e, c0) => Math.hypot(e[c0], e[c0 + 1], e[c0 + 2]);
    const finite16 = (e, o) => {
        for (let k = 0; k < 16; k++) if (!Number.isFinite(e[o + k])) return false;
        return true;
    };
    const boneRows = [];
    for (let i = 0; i < bones.length; i++) {
        const mw = bones[i].matrixWorld.elements;
        const iv = inv[i].elements;
        const o = i * 16;
        boneRows.push({
            i, name: bones[i].name.replace('mixamorig:', ''),
            mw: [mag3(mw, 0), mag3(mw, 4), mag3(mw, 8)].map(n => +n.toFixed(3)),
            mwT: [mw[12], mw[13], mw[14]].map(n => +n.toFixed(3)),
            inv: [mag3(iv, 0), mag3(iv, 4), mag3(iv, 8)].map(n => +n.toFixed(2)),
            comp: [
                Math.hypot(bm[o], bm[o + 1], bm[o + 2]),
                Math.hypot(bm[o + 4], bm[o + 5], bm[o + 6]),
                Math.hypot(bm[o + 8], bm[o + 9], bm[o + 10])].map(n => +n.toFixed(2)),
            compT: [bm[o + 12], bm[o + 13], bm[o + 14]].map(n => +n.toFixed(2)),
            mwOK: finite16(mw, 0), invOK: finite16(iv, 0),
            compOK: finite16(bm, o),
        });
    }

    // ---- CPU shader emulation over the geometry ---------------------------
    const g = inst.mesh.geometry;
    const pos = g.attributes.position;
    const jix = g.attributes.skinIndex;
    const wts = g.attributes.skinWeight;
    const bindE = inst.mesh.bindMatrix.elements.slice();
    const perBone = bones.map(() => ({ n: 0, sumY: 0, nan: 0,
        minY: 1e9, maxY: -1e9 }));
    let gMin = [1e9, 1e9, 1e9], gMax = [-1e9, -1e9, -1e9], nanTotal = 0;
    const N = pos.count;
    for (let vi = 0; vi < N; vi += 7) {
        const px = pos.getX(vi), py = pos.getY(vi), pz = pos.getZ(vi);
        let ox = 0, oy = 0, oz = 0, wsum = 0;
        let domB = 0, domW = -1;
        for (let k = 0; k < 4; k++) {
            const w = k === 0 ? wts.getX(vi) : k === 1 ? wts.getY(vi)
                : k === 2 ? wts.getZ(vi) : wts.getW(vi);
            if (w === 0) continue;
            const j = k === 0 ? jix.getX(vi) : k === 1 ? jix.getY(vi)
                : k === 2 ? jix.getZ(vi) : jix.getW(vi);
            if (w > domW) { domW = w; domB = j; }
            const o = j * 16;
            // column-major mat4 * vec4(p,1)
            ox += w * (bm[o] * px + bm[o + 4] * py + bm[o + 8] * pz + bm[o + 12]);
            oy += w * (bm[o + 1] * px + bm[o + 5] * py + bm[o + 9] * pz + bm[o + 13]);
            oz += w * (bm[o + 2] * px + bm[o + 6] * py + bm[o + 10] * pz + bm[o + 14]);
            wsum += w;
        }
        ox /= wsum; oy /= wsum; oz /= wsum;
        const rec = perBone[domB];
        rec.n++;
        if (Number.isFinite(ox) && Number.isFinite(oy) && Number.isFinite(oz)) {
            rec.sumY += oy;
            if (oy < rec.minY) rec.minY = oy;
            if (oy > rec.maxY) rec.maxY = oy;
            if (ox < gMin[0]) gMin[0] = ox; if (ox > gMax[0]) gMax[0] = ox;
            if (oy < gMin[1]) gMin[1] = oy; if (oy > gMax[1]) gMax[1] = oy;
            if (oz < gMin[2]) gMin[2] = oz; if (oz > gMax[2]) gMax[2] = oz;
        } else { rec.nan++; nanTotal++; }
    }
    const vertRows = [];
    for (let i = 0; i < perBone.length; i++) {
        const r = perBone[i];
        if (!r.n) continue;
        vertRows.push({ bone: bones[i].name.replace('mixamorig:', ''),
            verts: r.n, nan: r.nan,
            meanY: +(r.sumY / Math.max(1, r.n - r.nan)).toFixed(2),
            minY: +r.minY.toFixed(2), maxY: +r.maxY.toFixed(2) });
    }

    clearInterval(drv);
    const groundY = y;
    const out = {
        key: 'KEY', slot: SLOT, groundY: +groundY.toFixed(2),
        rootY: +inst.root.position.y.toFixed(3),
        footLift: +(inst.footLift || 0).toFixed(3),
        bindMode: inst.mesh.bindMode,
        bindMatrixIsIdentity: bindE.every((e, k) =>
            Math.abs(e - (k % 5 === 0 ? 1 : 0)) < 1e-6),
        vertexCount: N, sampled: Math.ceil(N / 7), nanVerts: nanTotal,
        skinnedBBoxY: [+gMin[1].toFixed(2), +gMax[1].toFixed(2)],
        skinnedBBoxX: [+gMin[0].toFixed(2), +gMax[0].toFixed(2)],
        bones: boneRows, verts: vertRows,
    };
    v.free(SLOT);
    return out;
})()"""


def main():
    from playwright.sync_api import sync_playwright

    srv = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT)], cwd=str(ROOT),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            pg.goto(GAME_URL, wait_until="domcontentloaded")
            pg.wait_for_function(
                "() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime",
                timeout=120000)
            pg.wait_for_timeout(3000)
            all_out = {}
            for key in ("hailPlateGuard", "glacierBrute", "rimeImp"):
                # wait for the body to stream in
                pg.wait_for_function(
                    "() => SNOWFLOW.combat.enemies.vis.ready('%s')" % key,
                    timeout=120000)
                r = pg.evaluate(JS.replace("KEY", key))
                all_out[key] = r
                print("\n==== %s ====" % key)
                if not isinstance(r, dict) or r.get("err"):
                    print("  ERR:", r)
                    continue
                for k in ("groundY", "rootY", "footLift", "bindMode",
                          "bindMatrixIsIdentity", "vertexCount", "sampled",
                          "nanVerts", "skinnedBBoxY", "skinnedBBoxX"):
                    print("  %s = %s" % (k, r[k]))
                badBones = [b for b in r["bones"]
                            if not (b["mwOK"] and b["invOK"] and b["compOK"])]
                print("  non-finite bones: %d" % len(badBones))
                for b in badBones[:10]:
                    print("   ", json.dumps(b))
                comps = sorted(r["bones"], key=lambda b: b["comp"][0])
                print("  composite scale spread: min %s (%s)  max %s (%s)" % (
                    comps[0]["comp"], comps[0]["name"],
                    comps[-1]["comp"], comps[-1]["name"]))
                print("  per-dominant-bone skinned Y (leg vs torso):")
                for row in r["verts"]:
                    if any(t in row["bone"] for t in
                           ("Leg", "Foot", "Toe", "Hips", "Spine", "Head",
                            "Arm")):
                        print("   ", json.dumps(row))
            out = Path(__file__).with_name("qa_boneforensic_out.json")
            out.write_text(json.dumps(all_out, indent=1), encoding="utf-8")
            print("\nwrote", out)
            br.close()
    finally:
        srv.terminate()


if __name__ == "__main__":
    main()
