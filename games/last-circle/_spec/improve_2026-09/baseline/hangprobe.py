import json
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    br = p.chromium.launch(headless=True)
    page = br.new_page()
    log = []
    page.on("console", lambda m: log.append(m.text[:200]) if ("chars" in m.text or "skins" in m.text or "rig" in m.text) else None)
    page.route("**/*.glb*", lambda r: r.abort("internetdisconnected"))
    page.goto("http://127.0.0.1:8790/games/last-circle/index.html")
    page.wait_for_function("!!window.__LC__", timeout=60000)
    page.wait_for_timeout(2000)
    page.evaluate("""() => { const k = window.__FFG3D__.kernel; window.__ids = new Map(); let n = 0;
      const orig = k.loadCharacter.bind(k);
      k.loadCharacter = (u) => { const pr = orig(u); window.__lcCalls = (window.__lcCalls||0)+1;
        pr.then(() => (window.__lcOk=(window.__lcOk||0)+1), (e) => { window.__lcRej=(window.__lcRej||0)+1; window.__lcLastErr = String(e && e.message || e); }); return pr; };
      window.__smRes = 'pending';
      window.__LC__.startMatch({mode:'standard', seed: 3}).then(() => window.__smRes='resolved', (e) => window.__smRes = 'rejected: ' + (e && e.message || e)); }""")
    for i in range(6):
        page.wait_for_timeout(2500)
    r = page.evaluate("""() => { const k = window.__FFG3D__.kernel; return {sm: window.__smRes, calls: window.__lcCalls, ok: window.__lcOk, rej: window.__lcRej, err: window.__lcLastErr,
       charInflight: Object.keys(k._charInflight).length, gltfInflight: Object.keys(k._gltfInflight).length, phase: window.__LC__.W.phase,
       screen: (document.body.innerText||'').slice(0,120)} }""")
    print(json.dumps(r))
    # does a fresh direct load of the same url reject?
    r2 = page.evaluate("""async () => { const k = window.__FFG3D__.kernel; const u = Object.keys(k._charInflight)[0] || (new URL('assets/chars/meshy/soldier.glb', location.href).href);
       return await Promise.race([k.loader.loadAsync(u + '&x=1').then(() => 'ok', e => 'rej ' + e.message), new Promise(r => setTimeout(() => r('PENDING'), 6000))]); }""")
    print("direct:", r2)
    print("console:", json.dumps(log[-8:]))
    br.close()
