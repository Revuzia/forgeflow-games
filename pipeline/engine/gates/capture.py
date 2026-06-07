"""capture.py — reliable WebGL/Canvas screenshot via Playwright (CDP).

The preview MCP's screenshot times out on a continuously-rendering WebGL page,
and toDataURL-over-eval is lossy. Playwright's page.screenshot() captures the
compositor directly and writes a real PNG — works for three.js (3D) and Phaser
(2D) alike, regardless of preserveDrawingBuffer. This is the capture mechanism
the fidelity gate uses.

Usage:
    python capture.py <url> <out.png>
    python capture.py http://localhost:8767/games/iron-tide/ shot.png
"""
import sys
from playwright.sync_api import sync_playwright


def capture(url, out, settle_ms=3500, pre_eval=None, post_eval_ms=2500):
    with sync_playwright() as p:
        # Headless Chromium has NO GPU, so a WebGL/three.js scene renders BLANK (black) and
        # page.screenshot() captures only the DOM HUD over an empty canvas. That made the
        # XCOM fidelity verifier grade an EMPTY battlefield every night → permanent "no match"
        # → the pipeline looped on one game forever. Forcing the ANGLE→SwiftShader software-GL
        # backend gives headless a working WebGL context so the 3D scene actually renders.
        b = p.chromium.launch(args=[
            "--use-gl=angle",
            "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader",   # newer Chromium gates swiftshader-for-WebGL behind this
            "--ignore-gpu-blocklist",
            "--enable-webgl",
        ])
        pg = b.new_page(viewport={"width": 1280, "height": 800})
        pg.goto(url, wait_until="load", timeout=60000)
        # Wait for either the 3D or 2D game object to exist.
        try:
            pg.wait_for_function(
                "() => (window.__FFG3D__ && window.__FFG3D__.controller) || (window.__FFG_GAME__)",
                timeout=30000,
            )
        except Exception:
            pass  # capture whatever rendered anyway
        pg.wait_for_timeout(settle_ms)  # let GLB models + first frames settle
        if pre_eval:
            # Run a JS snippet to reach a specific game state (e.g. fire some
            # shots) before the screenshot — lets the fidelity gate capture
            # mid-game, not just the opening frame.
            try:
                pg.evaluate(pre_eval)
                pg.wait_for_timeout(post_eval_ms)
            except Exception as e:
                print("pre_eval error:", e)
        # CAPTURE. A continuously-rendering WebGL/bloom scene makes page.screenshot() hang
        # (it waits for an idle frame that never arrives — the documented bloom-hang). For 3D
        # we read the canvas DIRECTLY via toDataURL (the kernel sets preserveDrawingBuffer:true
        # for exactly this), which never hangs. 2D/Phaser pages composite fine via screenshot.
        shot = None
        try:
            shot = pg.evaluate(
                "() => { const k = window.__FFG3D__ && window.__FFG3D__.kernel;"
                " const c = (k && k.renderer && k.renderer.domElement) || null;"
                " if (!c) return null;"
                # RAW render (scene+camera) right before readback. The render LOOP leaves the
                # EffectComposer/bloom output on the canvas, which blacks out under headless
                # SwiftShader (post-FX passes fail) — a raw render is 98% lit. Verified 2026-06-07.
                " try { if (k.scene && k.camera) k.renderer.render(k.scene, k.camera); } catch (e) {}"
                " let img = null, lit = 0;"
                " try { img = c.toDataURL('image/png'); } catch (e) {}"
                # lit fraction (non-near-black pixels) — lets the verifier DETECT a blank capture
                # and skip rather than grade an empty scene (the loop-forever bug's safety net).
                " try { const t = document.createElement('canvas'); t.width = 64; t.height = 40;"
                "   const g = t.getContext('2d'); g.drawImage(c, 0, 0, 64, 40);"
                "   const d = g.getImageData(0, 0, 64, 40).data; let n = 0;"
                "   for (let i = 0; i < d.length; i += 4) { if (d[i] + d[i+1] + d[i+2] > 40) n++; }"
                "   lit = n / (64 * 40); } catch (e) {}"
                " return { img: img, lit: lit }; }"
            )
        except Exception as e:
            print("toDataURL error:", e)
        if shot and isinstance(shot, dict) and (shot.get("img") or "").startswith("data:image"):
            import base64
            with open(out, "wb") as f:
                f.write(base64.b64decode(shot["img"].split(",", 1)[1]))
            try:
                with open(out + ".lit", "w", encoding="utf-8") as f:
                    f.write(str(shot.get("lit", "")))  # sidecar: blank-capture detector reads this
            except Exception:
                pass
        else:
            pg.screenshot(path=out, timeout=60000, animations="disabled")  # 2D / fallback
        b.close()
    return out


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("usage: python capture.py <url> <out.png> [--eval '<js>']")
        sys.exit(2)
    ev = sys.argv[sys.argv.index("--eval") + 1] if "--eval" in sys.argv else None
    print("saved", capture(sys.argv[1], sys.argv[2], pre_eval=ev))
