# -*- coding: utf-8 -*-
"""
qa_realpath.py -- reproduce the owner's T-pose report on the REAL user path:
the CDN build, the shell menu, a real PLAY click, real WASD keyboard input,
real pointer lock. No ?autoplay, no scripted teleports for the player.

Dumps, per resident body type: decoded clip count (a type whose anims decode
to ZERO clips gets no mixer and runs in bind pose BY DESIGN -- the exact
symptom). Then spawns a pack ahead, walks the player toward it with held W,
and samples every live enemy: mixer presence, total action weight, bone
motion. Screenshots along the way. All console + page errors captured.
"""
import json
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
SHOTS = Path(__file__).resolve().parent.parent / "_shots"
CDN = "https://forgeflow-games-cdn.isimcha85.workers.dev/driftwake/index.html"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]

SAMPLE_JS = """(() => {
    const SF = SNOWFLOW, e = SF.combat.enemies, v = e.vis;
    const reg = SF.combat.registry;
    const out = { t: +reg.time.toFixed(1), units: [] };
    for (let i = 0; i < e.alive.length; i++) {
        if (!e.alive[i]) continue;
        const inst = v._slotInst[i];
        const row = { slot: i, slug: inst ? inst.type.slug : null,
                      visible: inst ? inst.mesh.visible : false,
                      hasMixer: !!(inst && inst.mixer),
                      nClips: inst ? (inst.type.clips ? inst.type.clips.length : 0) : -1,
                      spd: +v.speed01[i].toFixed(2) };
        if (inst && inst.acts) {
            let ws = 0;
            for (const a of inst.acts) if (a) ws += a.getEffectiveWeight();
            row.wsum = +ws.toFixed(2);
            const b = inst.skeleton.bones.find(bb => /LeftArm$/.test(bb.name)) ||
                      inst.skeleton.bones[1];
            row.armQ = b ? b.quaternion.toArray().map(n => +n.toFixed(3)) : null;
        }
        out.units.push(row);
    }
    return out;
})()"""


def main():
    from playwright.sync_api import sync_playwright

    console, errs = [], []
    with sync_playwright() as pw:
        br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("console", lambda m: console.append(m.type + ": " + m.text)
              if m.type in ("error", "warning") else None)
        pg.goto(CDN + "?menu", wait_until="domcontentloaded")
        pg.wait_for_function("() => globalThis.SNOWFLOW", timeout=180000)
        pg.wait_for_timeout(4000)

        # REAL PLAY CLICK through the shell (fresh profile -> no save -> PLAY)
        # via the shell's own button elements (qa_menu.py pattern -- the text
        # locator can't see them).
        pg.evaluate("""(() => { const b = [...FFG.shell.ov.querySelectorAll('button')]
            .find(x => /PLAY|NEW RUN/i.test(x.textContent)); b.click(); })()""")
        pg.wait_for_function("() => !SNOWFLOW.S.freezeTime", timeout=30000)
        pg.wait_for_timeout(2500)

        # Body types + decoded clip counts on the CDN build (hypothesis: a
        # type with 0 clips runs bind-pose by design).
        types = pg.evaluate("""(() => {
            const v = SNOWFLOW.combat.enemies.vis, out = [];
            for (const slug of v._types.keys()) {
                const t = v._types.get(slug);
                out.push({ slug, state: t.state,
                           clips: t.clips ? t.clips.length : 0,
                           kit: t.clipNames.length });
            }
            return out;
        })()""")
        print("resident types:", json.dumps(types))
        pg.evaluate("SNOWFLOW.combat.enemies.vis.stream()")
        pg.wait_for_function(
            "() => SNOWFLOW.combat.enemies.vis.stats.types >= 8",
            timeout=180000)
        types = pg.evaluate("""(() => {
            const v = SNOWFLOW.combat.enemies.vis, out = [];
            for (const slug of v._types.keys()) {
                const t = v._types.get(slug);
                out.push({ slug, clips: t.clips ? t.clips.length : 0 });
            }
            return out;
        })()""")
        zero = [t for t in types if t["clips"] == 0]
        print("after stream:", json.dumps(types))
        print("ZERO-CLIP TYPES:", json.dumps(zero) if zero else "none")

        # A pack ahead of the player's real bearing, woken.
        pg.evaluate("""(() => {
            const SF = SNOWFLOW, c = SF.character, e = SF.combat.enemies;
            SF.combat.encounters._nextSpawnAt = 1e9;
            const a = SF.rig.yaw;
            for (const [k, d] of [["rimeImp", 14], ["rimeImp", 17],
                                  ["glacierBrute", 20], ["hailPlateGuard", 23]]) {
                const id = e.spawn(k, c.position.x + Math.sin(a) * d,
                                   c.position.z - Math.cos(a) * d, 1);
                if (id > 0) SF.combat.registry.damage(id, 1, {});
            }
        })()""")

        # REAL INPUT: hold W and walk at them; sample + shoot as we go.
        pg.mouse.click(640, 360)          # capture pointer like a player would
        pg.wait_for_timeout(300)
        pg.keyboard.down("w")
        for k in range(4):
            pg.wait_for_timeout(2200)
            s = pg.evaluate(SAMPLE_JS)
            print(f"sample{k}:", json.dumps(s))
            pg.screenshot(path=str(SHOTS / f"realpath_{k}.png"))
        pg.keyboard.up("w")

        print("\npage errors:", errs if errs else "none")
        print("console warn/err (first 12):", console[:12] if console else "none")
        br.close()


if __name__ == "__main__":
    main()
