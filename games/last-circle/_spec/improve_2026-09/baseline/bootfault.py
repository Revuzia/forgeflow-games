"""Last Circle boot fault-injection probe (READ-ONLY: faults are injected client-side via
Playwright routes / CDP / init scripts; nothing on disk or on the server is touched).

usage: python bootfault.py <case> [--wait S]
cases: baseline, mod404_hud, mod404_entry, mod404_sim, content404, cdn_block, cdn_hang,
       slow150, nowebgl, sitelock, ctxlost, frame_throw, glb_block_match
Writes scratch/out_<case>.json + png screenshots.
"""
import json, os, sys, time
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = "http://127.0.0.1:8790/games/last-circle/index.html"
case = sys.argv[1]
WAIT = float(sys.argv[sys.argv.index("--wait") + 1]) if "--wait" in sys.argv else 40.0

SNAP_JS = r"""() => {
  const s = document.getElementById('lc-splash');
  const tip = document.getElementById('lc-splash-tip');
  const bar = s && s.querySelector('.bar');
  const vis = [];
  // any full-screen fallback div painted by splashFail / desktopOnlyCard
  document.querySelectorAll('#game-container > div').forEach(d => { const t = (d.innerText||'').trim(); if (t) vis.push(t.slice(0,300)); });
  return {
    t: Math.round(performance.now()),
    splash: !!s, splashOpacity: s ? getComputedStyle(s).opacity : null,
    tip: tip ? tip.textContent : null,
    barBg: bar ? getComputedStyle(bar).backgroundColor : null,
    barW: bar ? bar.getBoundingClientRect().width : null,
    lc: !!window.__LC__, canvas: !!document.querySelector('canvas'),
    overlays: vis,
    bodyText: (document.body.innerText || '').trim().slice(0, 400),
  };
}"""

out = {"case": case, "snaps": [], "console": [], "pageerrors": [], "failed_requests": [], "notes": []}


def snap(page, label):
    try:
        s = page.evaluate(SNAP_JS)
    except Exception as e:
        s = {"err": str(e)[:200]}
    s["label"] = label
    s["wall"] = round(time.time() - T0, 1)
    out["snaps"].append(s)
    print(json.dumps(s)[:600], flush=True)
    return s


with sync_playwright() as p:
    args = ["--host-resolver-rules=MAP rehost.example 127.0.0.1"]
    if case == "nowebgl":
        args += ["--disable-webgl", "--disable-webgl2", "--disable-3d-apis"]
    br = p.chromium.launch(headless=True, args=args)
    ctx = br.new_context(viewport={"width": 1280, "height": 720})
    page = ctx.new_page()
    page.on("console", lambda m: out["console"].append((m.type, m.text[:300])))
    page.on("pageerror", lambda e: out["pageerrors"].append(str(e)[:300]))
    page.on("requestfailed", lambda r: out["failed_requests"].append((r.url[-120:], r.failure)))
    url = sys.argv[sys.argv.index("--url") + 1] if "--url" in sys.argv else BASE
    if case == "mod404_hud":
        page.route("**/runtime/3d/royale/hud.js*", lambda r: r.fulfill(status=404, body="nope"))
    elif case == "mod404_entry":
        page.route("**/runtime/3d/ffg_boot3d.js*", lambda r: r.fulfill(status=404, body="nope"))
    elif case == "mod404_sim":
        page.route("**/runtime/sim/royale.js*", lambda r: r.fulfill(status=404, body="nope"))
    elif case == "content404":
        page.route("**/last-circle/content.json*", lambda r: r.fulfill(status=404, body="Game not found"))
    elif case == "cdn_block":
        page.route("**/cdn.jsdelivr.net/**", lambda r: r.abort("blockedbyclient"))
    elif case == "cdn_hang":
        page.route("**/cdn.jsdelivr.net/**", lambda r: None)   # never fulfilled: a filtering proxy that black-holes
    elif case == "sitelock":
        url = "http://rehost.example:8790/games/last-circle/index.html"
    elif case == "glb_block_match":
        pass
    elif case == "glb_block_all":
        page.route("**/*.glb*", lambda r: r.abort("internetdisconnected"))
    if case == "slow150":
        cdp = ctx.new_cdp_session(page)
        cdp.send("Network.enable")
        cdp.send("Network.emulateNetworkConditions", {"offline": False, "latency": 150,
                 "downloadThroughput": 150 * 1000 / 8, "uploadThroughput": 150 * 1000 / 8})
        cdp.send("Network.setCacheDisabled", {"cacheDisabled": True})
    T0 = time.time()
    try:
        page.goto(url, wait_until="commit", timeout=60000)
    except Exception as e:
        out["notes"].append("goto: " + str(e)[:200])
    marks = [1, 3, 6, 10, 20, 32, 45, 60, 90, 120, 180, 240, 300]
    done_at = None
    for m in marks:
        if m > WAIT:
            break
        while time.time() - T0 < m:
            page.wait_for_timeout(250)
            try:
                if done_at is None and page.evaluate("!!window.__LC__"):
                    done_at = round(time.time() - T0, 1)
                    out["notes"].append(f"__LC__ appeared at wall {done_at}s")
            except Exception:
                pass
        s = snap(page, f"t{m}")
        if m in (3, 10, 32) or m == marks[-1]:
            page.screenshot(path=os.path.join(HERE, f"shot_{case}_t{m}.png"))
        if done_at is not None and case in ("baseline", "slow150", "content404") and m >= done_at + 3:
            break

    # post-menu experiments
    if case == "ctxlost" and page.evaluate("!!window.__LC__"):
        page.wait_for_timeout(2000)
        page.screenshot(path=os.path.join(HERE, f"shot_{case}_before.png"))
        r = page.evaluate("""() => { const k = window.__FFG3D__ && window.__FFG3D__.kernel; const gl = k.renderer.getContext();
            const ext = gl.getExtension('WEBGL_lose_context'); if (!ext) return 'no ext'; ext.loseContext(); return 'lost'; }""")
        out["notes"].append("loseContext: " + str(r))
        page.wait_for_timeout(4000)
        snap(page, "after_ctxlost")
        page.screenshot(path=os.path.join(HERE, f"shot_{case}_after.png"))
        try:
            r2 = page.evaluate("""async () => { try { await window.__LC__.startMatch({mode:'standard', seed: 7}); return 'resolved'; } catch (e) { return 'rejected: ' + e; } }""")
        except Exception as e:
            r2 = "eval-err " + str(e)[:200]
        out["notes"].append("startMatch after ctxlost: " + str(r2)[:300])
        page.wait_for_timeout(3000)
        snap(page, "after_ctxlost_start")
        page.screenshot(path=os.path.join(HERE, f"shot_{case}_after_start.png"))
    if case == "frame_throw" and page.evaluate("!!window.__LC__"):
        page.wait_for_timeout(1500)
        r = page.evaluate("""() => new Promise(res => { const k = window.__FFG3D__.kernel; let n0 = k.renderer.info.render.frame;
            let once = true; k._updaters.push(() => { if (once) { once = false; throw new Error('INJECTED frame fault'); } });
            setTimeout(() => res({before: n0, after: k.renderer.info.render.frame, running: k._running}), 3000); })""")
        out["notes"].append("frame counter before/after injected throw: " + json.dumps(r))
        r = page.evaluate("""() => new Promise(res => { const k = window.__FFG3D__.kernel; const a = k.renderer.info.render.frame;
            setTimeout(() => res({a, b: k.renderer.info.render.frame}), 2000); })""")
        out["notes"].append("2s later frames: " + json.dumps(r))
        snap(page, "after_throw")
        page.screenshot(path=os.path.join(HERE, f"shot_{case}_after.png"))
    if case in ("glb_block_match", "glb_block_all") and page.evaluate("!!window.__LC__"):
        page.wait_for_timeout(1500)
        if case == "glb_block_match":
            # clear the kernel caches so the match really re-fetches, then black out every GLB
            page.evaluate("() => { const k = window.__FFG3D__.kernel; k._charCache = {}; k._gltfCache = {}; }")
            page.route("**/*.glb*", lambda r: r.abort("internetdisconnected"))
        res = page.evaluate("""() => { window.__smRes = 'pending'; window.__LC__.startMatch({mode:'standard', seed: 11})
             .then(() => { window.__smRes = 'resolved'; }, (e) => { window.__smRes = 'rejected: ' + (e && e.message || e); }); return 'called'; }""")
        for i in range(8):
            page.wait_for_timeout(2500)
        out["notes"].append("startMatch outcome after 20s: " + str(page.evaluate("window.__smRes")))
        out["notes"].append("W.phase: " + str(page.evaluate("window.__LC__ && window.__LC__.W ? window.__LC__.W.phase : '?'")))
        out["notes"].append("inflight: " + str(page.evaluate("() => { const k = window.__FFG3D__.kernel; return {g: Object.keys(k._gltfInflight), c: Object.keys(k._charInflight)}; }")))
        snap(page, "after_glb_block_20s")
        page.screenshot(path=os.path.join(HERE, f"shot_{case}_after.png"))
    # resource accounting (baseline / slow)
    try:
        res = page.evaluate("""() => performance.getEntriesByType('resource').map(e => ({n: e.name.replace(location.origin,'').slice(-90), t: e.initiatorType, tx: e.transferSize, enc: e.encodedBodySize, dec: e.decodedBodySize, end: Math.round(e.responseEnd)}))""")
        out["resources"] = res
        out["bytes_total_encoded"] = sum((r.get("enc") or 0) for r in res)
        out["bytes_jsdelivr_encoded"] = sum((r.get("enc") or 0) for r in res if "jsdelivr" in r["n"])
        out["n_resources"] = len(res)
    except Exception as e:
        out["notes"].append("resources: " + str(e)[:200])
    br.close()

TAG = sys.argv[sys.argv.index("--tag") + 1] if "--tag" in sys.argv else case
with open(os.path.join(HERE, f"out_{TAG}.json"), "w", encoding="utf-8") as f:
    json.dump(out, f, indent=1)
print("NOTES", json.dumps(out["notes"]))
print("PAGEERRORS", json.dumps(out["pageerrors"])[:1500])
print("CONSOLE_ERR", json.dumps([c for c in out["console"] if c[0] in ("error", "warning")])[:2000])
print("FAILED", json.dumps(out["failed_requests"])[:1200])
print("BYTES", out.get("bytes_total_encoded"), "jsdelivr", out.get("bytes_jsdelivr_encoded"), "n", out.get("n_resources"))
