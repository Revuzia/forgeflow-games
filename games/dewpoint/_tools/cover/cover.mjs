// Stage and capture close-up hero shots from the real game, for the store cover (headless Chrome over CDP).
// Usage: node cover.mjs <chrome.exe> <gameDir> <outDir>
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const [,, exe, gameDir, outDir] = process.argv;
const W = 1280, H = 720, DSF = 2, PORT = 9412;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const srv = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]); const f = path.join(gameDir, u === '/' ? 'index.html' : u);
  if (!f.startsWith(path.resolve(gameDir)) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); fs.createReadStream(f).pipe(res);
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}/`;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dewpoint-cover-'));
const p = spawn(exe, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio', '--enable-unsafe-swiftshader',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--hide-scrollbars', `--remote-debugging-port=${PORT}`,
  `--window-size=${W},${H}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 60 && !target; i++) { await sleep(250); try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === 'page'); } catch (e) { /* not up */ } }
const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const waits = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && waits.has(m.id)) { waits.get(m.id)(m); waits.delete(m.id); } });
const send = (method, params = {}) => new Promise((res) => { const i = ++id; waits.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 500)); return r.result.result.value; };
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DSF, mobile: false });
await send('Page.navigate', { url: base });
for (let i = 0; i < 160; i++) { await sleep(500); if (await ev('typeof window.__dew === "object" && !!document.querySelector(".title-actions")')) break; if (i === 159) throw new Error('game did not boot'); }
await ev(`(() => {
  const s = document.createElement('style'); s.textContent = '#ui, #__ff_controls__ { display: none !important; }'; document.head.appendChild(s);
  __dew.setQuality && __dew.setQuality('high');
  window.__stage = (o) => {
    clearInterval(window.__stageT);
    const R = __dew.renderer, c = R.camera;
    window.__stageT = setInterval(() => {
      const p = __dew.sim.player;
      if (o.facing !== undefined) p.facing = R.cam.yaw + o.facing;      // look back at the camera, turned by o.facing
      if (o.pitch !== undefined) R.cam.pitch = o.pitch;
      if (o.dist !== undefined) { R.cam.dist = o.dist; R.cam.curDist = o.dist; }
      if (o.yaw !== undefined) R.cam.yaw = o.yaw0 + o.yaw;
      if (o.fov) { c.fov = o.fov; c.updateProjectionMatrix(); }
    }, 4);
  };
})()`);
fs.mkdirSync(outDir, { recursive: true });
const shot = async (name, level, setup, stage, settle = 2600) => {
  await ev(`(async () => { __dew.loadLevel(${JSON.stringify(level)}); __dew.advance(1); ${setup || ''}; const o = ${JSON.stringify(stage)}; o.yaw0 = __dew.renderer.cam.yaw; __stage(o); })()`);
  await sleep(settle);
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(outDir, name), Buffer.from(r.result.data, 'base64'));
  console.log(name, Math.round(fs.statSync(path.join(outDir, name)).size / 1024) + ' KB');
};
const key = (k, c, s) => `window.dispatchEvent(new KeyboardEvent('keydown',{key:'${k}',code:'${c}',bubbles:true})); __dew.advance(${s}); window.dispatchEvent(new KeyboardEvent('keyup',{key:'${k}',code:'${c}',bubbles:true})); __dew.advance(0.4);`;
const shots = JSON.parse(fs.readFileSync(path.join(path.dirname(process.argv[1]), 'cover-shots.json'), 'utf8'));
for (const s of shots) await shot(s.name, s.level, (s.keys || []).map((k) => key(...k)).join(' ') + (s.form ? ` __dew.setForm('${s.form}'); __dew.advance(1.0);` : ''), s.stage, s.settle);
await ev(`localStorage.removeItem('dewpoint.save.v1')`);
ws.close(); p.kill(); srv.close(); await sleep(400);
try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* in use */ }
