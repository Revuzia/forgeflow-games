// Compose the Dewpoint store cover from two in-game hero shots. Usage: node compose.mjs <chrome> <shotsDir> <out.png> [variant]
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const [,, exe, dir, out, variant = 'a'] = process.argv;
const W = 1280, H = 720, PORT = 9433;
const V = {
  a: { left: 'mote-a.png', right: 'cinder-b.png', ls: 0.64, lx: -490, ly: -128, rs: 0.56, rx: 233, ry: -16 },
  b: { left: 'mote-a.png', right: 'cinder-a.png', ls: 0.62, lx: -464, ly: -96, rs: 0.66, rx: 96, ry: 6 },
}[variant];
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; background: #12303f; }
  .side { position: absolute; inset: 0; overflow: hidden; }
  .side img { position: absolute; transform-origin: 0 0; }
  .l { clip-path: polygon(0 0, 706px 0, 574px 100%, 0 100%); }
  .r { clip-path: polygon(706px 0, 100% 0, 100% 100%, 574px 100%); }
  svg { position: absolute; inset: 0; }
  .shade { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(10, 24, 38, .42) 0, rgba(10, 24, 38, 0) 34%, rgba(10, 24, 38, 0) 70%, rgba(10, 24, 38, .5) 100%); }
  h1 { position: absolute; left: 0; right: 0; top: 30px; margin: 0; text-align: center; white-space: nowrap;
       font: 900 152px/1 ui-rounded, "Segoe UI", "Helvetica Neue", system-ui, Arial, sans-serif; letter-spacing: .07em; padding-left: .07em;
       color: #fff; -webkit-text-stroke: 15px #12303f; paint-order: stroke fill; text-shadow: 0 11px 0 #12303f; transform: rotate(-2deg); }
  h1 span { display: inline-block; }
  h1 .w { color: #35cfe6; } h1 .f { color: #ffa53d; }
  h1 span:nth-child(odd) { transform: translateY(-5px) rotate(-2deg); } h1 span:nth-child(even) { transform: translateY(5px) rotate(2deg); }
  .tag { position: absolute; left: 50%; bottom: 30px; transform: translateX(-50%) rotate(-1deg); padding: 12px 30px 14px; border-radius: 999px; background: #12303f;
         color: #fff7e6; font: 800 30px/1 ui-rounded, "Segoe UI", system-ui, Arial, sans-serif; letter-spacing: .02em; white-space: nowrap; box-shadow: 0 6px 0 rgba(0, 0, 0, .35); }
  .tag b { color: #35cfe6; } .tag i { color: #ffa53d; font-style: normal; }
</style></head><body>
  <div class="side l"><img src="${V.left}" style="left:${V.lx}px;top:${V.ly}px;transform:scale(${V.ls})"></div>
  <div class="side r"><img src="${V.right}" style="left:${V.rx}px;top:${V.ry}px;transform:scale(${V.rs})"></div>
  <div class="shade"></div>
  <svg viewBox="0 0 ${W} ${H}"><line x1="706" y1="-10" x2="574" y2="730" stroke="#12303f" stroke-width="20"/><line x1="706" y1="-10" x2="574" y2="730" stroke="#fff7e6" stroke-width="6"/></svg>
  <h1><span>D</span><span class="w">E</span><span>W</span><span class="w">P</span><span>O</span><span class="f">I</span><span>N</span><span class="f">T</span></h1>
  <div class="tag">Play as <b>water</b>. Then play as <i>fire</i>.</div>
</body></html>`;
const srv = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html); return; }
  const f = path.join(dir, path.basename(u));
  if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': 'image/png' }); fs.createReadStream(f).pipe(res);
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dewpoint-compose-'));
const p = spawn(exe, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, `--window-size=${W},${H}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 60 && !target; i++) { await sleep(250); try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === 'page'); } catch (e) { /* not up */ } }
const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const waits = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && waits.has(m.id)) { waits.get(m.id)(m); waits.delete(m.id); } });
const send = (method, params = {}) => new Promise((res) => { const i = ++id; waits.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:${srv.address().port}/` });
await sleep(2500);
const r = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: W, height: H, scale: 1 } });
fs.writeFileSync(out, Buffer.from(r.result.data, 'base64'));
console.log(out, Math.round(fs.statSync(out).size / 1024) + ' KB');
ws.close(); p.kill(); srv.close(); await sleep(300);
try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* in use */ }
