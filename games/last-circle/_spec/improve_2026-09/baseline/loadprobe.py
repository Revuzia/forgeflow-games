import json, sys
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    br = p.chromium.launch(headless=True)
    page = br.new_page()
    page.goto("http://127.0.0.1:8790/games/last-circle/index.html")
    page.wait_for_function("!!window.__LC__", timeout=60000)
    page.wait_for_timeout(3000)
    mode = sys.argv[1]
    if mode == "abort":
        page.route("**/probe_*.glb*", lambda r: r.abort("internetdisconnected"))
    elif mode == "404":
        page.route("**/probe_*.glb*", lambda r: r.fulfill(status=404, body="Game not found"))
    res = page.evaluate("""async () => {
      const k = window.__FFG3D__.kernel;
      const t = (p) => Promise.race([p.then(() => 'resolved', (e) => 'rejected: ' + (e && e.message || e)), new Promise(r => setTimeout(() => r('PENDING after 8s'), 8000))]);
      const base = new URL('assets/chars/meshy/', location.href).href;
      return {
        rawLoadAsync: await t(k.loader.loadAsync(base + 'probe_a.glb')),
        loadGLTF: await t(k.loadGLTF(base + 'probe_b.glb')),
        loadCharacter: await t(k.loadCharacter(base + 'probe_c.glb')),
      };
    }""")
    print(mode, json.dumps(res))
    br.close()
