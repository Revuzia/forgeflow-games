import json
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    br = p.chromium.launch(headless=True)
    page = br.new_page()
    page.route("**/*.glb*", lambda r: r.fulfill(status=404, body="Game not found"))
    page.goto("http://127.0.0.1:8790/games/last-circle/index.html")
    page.wait_for_function("!!window.__LC__", timeout=60000)
    page.wait_for_timeout(2000)
    page.evaluate("""() => { const k = window.__FFG3D__.kernel; window.__calls = [];
      const orig = k.loader.loadAsync.bind(k.loader);
      k.loader.loadAsync = (u, pr) => { const rec = {u: u.split('/').pop(), st: 'pending', t: Math.round(performance.now())}; window.__calls.push(rec);
        const p = orig(u, pr); p.then(() => rec.st = 'ok', (e) => rec.st = 'rej'); return p; };
      const og = k.loadGLTF.bind(k); window.__g = [];
      k.loadGLTF = (u) => { const rec = {u: u.split('/').pop(), st: 'pending', hadInflight: !!k._gltfInflight[u], cached: !!k._gltfCache[u]}; window.__g.push(rec);
        const p = og(u); p.then(() => rec.st = 'ok', () => rec.st = 'rej'); return p; };
      window.__smRes='pending';
      window.__LC__.startMatch({mode:'standard', seed: 3}).then(() => window.__smRes='resolved', (e) => window.__smRes = 'rejected: ' + (e && e.message || e)); }""")
    for i in range(10):
        page.wait_for_timeout(2500)
    r = page.evaluate("""() => ({sm: window.__smRes, loadAsyncPending: window.__calls.filter(c => c.st === 'pending'), nLoadAsync: window.__calls.length,
        gltfPending: window.__g.filter(c => c.st === 'pending'), nGltf: window.__g.length, inflight: Object.keys(window.__FFG3D__.kernel._gltfInflight).map(u => u.split('/').pop())})""")
    print(json.dumps(r, indent=0))
    print("screen:", page.evaluate("(document.body.innerText||'').slice(0,160)"))
    page.screenshot(path="shot_glb404_match.png")
    br.close()
