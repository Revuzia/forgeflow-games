# -*- coding: utf-8 -*-
"""
qa_trackbind.py -- do the enemy anim clips actually BIND to their bodies?

"Animated but still looks like T-pose" (owner 2026-08-10) is the signature of
clip tracks whose node names miss the skeleton's bone names: the mixer plays,
unresolved tracks drive nothing, and the body holds bind pose with residual
wiggle from whatever DID resolve. This walks every resident body type in all
three realms and, per clip, counts tracks whose target node exists vs not.
"""
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[3]
GAME_URL = "http://localhost:8799/games/driftwake/index.html?autoplay"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]

JS = """(() => {
    const v = SNOWFLOW.combat.enemies.vis;
    const out = [];
    for (const slug of v._types.keys()) {
        const t = v._types.get(slug);
        if (!t || t.state !== 1 || !t.clips) continue;
        const names = new Set();
        t.proto.traverse((o) => names.add(o.name));
        for (const b of t.protoMesh.skeleton.bones) names.add(b.name);
        const clips = [];
        for (const c of t.clips) {
            let ok = 0, miss = 0;
            const missNames = [];
            for (const tr of c.tracks) {
                const node = tr.name.split(".")[0];
                if (names.has(node)) ok++;
                else { miss++; if (missNames.length < 3) missNames.push(node); }
            }
            clips.push({ name: c.name, ok, miss, missNames,
                         dur: +c.duration.toFixed(2) });
        }
        out.push({ slug, bones: t.protoMesh.skeleton.bones.length,
                   bone0: t.protoMesh.skeleton.bones[0].name, clips });
    }
    return out;
})()"""


def main():
    from playwright.sync_api import sync_playwright

    srv = subprocess.Popen(
        [sys.executable, "-m", "http.server", "8799"], cwd=str(ROOT),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    bad = 0
    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            pg.goto(GAME_URL, wait_until="domcontentloaded")
            pg.wait_for_function(
                "() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime",
                timeout=120000)
            pg.wait_for_timeout(2000)
            for realm in ("cold", "sand", "ash"):
                pg.evaluate(f"SNOWFLOW.enterRealm('{realm}')")
                pg.wait_for_timeout(1200)
                pg.evaluate("SNOWFLOW.combat.enemies.vis.stream()")
                pg.wait_for_function(
                    "() => SNOWFLOW.combat.enemies.vis.stats.types >= 8",
                    timeout=120000)
            rows = pg.evaluate(JS)
            for r in rows:
                worst = max((c["miss"] / max(1, c["ok"] + c["miss"])
                             for c in r["clips"]), default=0)
                flag = "BAD " if worst > 0.3 else "ok  "
                if worst > 0.3:
                    bad += 1
                print(f"{flag}{r['slug']} bones={r['bones']} bone0={r['bone0']}")
                for c in r["clips"]:
                    tag = " <-- MISS" if c["miss"] > c["ok"] * 0.4 else ""
                    print(f"      {c['name']:<22} ok={c['ok']:<3} "
                          f"miss={c['miss']:<3} {c['missNames']}{tag}")
            br.close()
    finally:
        srv.terminate()
    print("\nRESULT:", "OK" if bad == 0 else f"{bad} BODIES WITH BROKEN BINDINGS")
    sys.exit(0 if bad == 0 else 1)


if __name__ == "__main__":
    main()
