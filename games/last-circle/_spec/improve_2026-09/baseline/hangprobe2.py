import json
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    br = p.chromium.launch(headless=True)
    page = br.new_page()
    started, ended = {}, {}
    page.on("request", lambda r: started.__setitem__(r.url, started.get(r.url, 0) + 1) if ".glb" in r.url else None)
    page.on("requestfailed", lambda r: ended.__setitem__(r.url, ended.get(r.url, 0) + 1) if ".glb" in r.url else None)
    page.on("requestfinished", lambda r: ended.__setitem__(r.url, ended.get(r.url, 0) + 1) if ".glb" in r.url else None)
    page.route("**/*.glb*", lambda r: r.abort("internetdisconnected"))
    page.goto("http://127.0.0.1:8790/games/last-circle/index.html")
    page.wait_for_function("!!window.__LC__", timeout=60000)
    page.wait_for_timeout(2000)
    page.evaluate("""() => { window.__smRes='pending'; window.__LC__.startMatch({mode:'standard', seed: 3}).then(() => window.__smRes='resolved', (e) => window.__smRes = 'rejected: ' + (e && e.message || e)); }""")
    for i in range(6):
        page.wait_for_timeout(2500)
    r = page.evaluate("""() => { const k = window.__FFG3D__.kernel; return {sm: window.__smRes, gltfInflight: Object.keys(k._gltfInflight), charInflight: Object.keys(k._charInflight), screen: (document.body.innerText||'').slice(0,80)} }""")
    print(json.dumps(r))
    unmatched = {u: (started[u], ended.get(u, 0)) for u in started if started[u] != ended.get(u, 0)}
    print("unmatched:", json.dumps(unmatched))
    br.close()
