#!/usr/bin/env node
// VALE art: render a fighter GLB with the REAL three.js r186 renderer (headless Chromium, WebGL2
// via SwiftShader) — the in-engine QA view that Cycles renders cannot give (baked AO map, the
// tangent frame three uses for the normal map, glTF material mapping, accent tint, +Z facing,
// clip playback through AnimationMixer).
//
//   node art/tools/three_snapshot.mjs art/out/_proof/_proof_mannequin.glb [out.png]
//        [--sky art/out/_proof/sky.hdr] [--tint #ff5a4f] [--chrome /path/to/chrome] [--cell 300]
//        [--strip aoMap,normalMap,shadows]   (debug: drop maps to find which one carries an artifact)
//        [--clips]   clip sheet instead: every clip x 8 frames (impact included) in three
//   Report: facing (bind-pose toe direction, must be +Z), heightPx1080 at default zoom,
//   accentPct (accent share of the silhouette at the game camera, 8 facings) and accentTopHalfPct.
//
// Sheet (one PNG): row 1 = 8 facings at the GAMEPLAY camera (pitch 52°, vFOV 26°, 28.5 m, the bible
// numbers) cropped at 1080p pixel scale (so the fighter is exactly as many px tall as in play);
// row 2 = idle/run/attack1 impact/cast_ult impact/death end at the gameplay camera + team tints;
// row 3 = close 3/4 views (front, back, profile) with the baked maps for texture QA.
// Exit 0 and a JSON line {facing, heightPx, ...} on success. Needs a Chromium binary: $CHROME,
// --chrome, or Playwright's cache (/opt/pw-browsers, ~/.cache/ms-playwright). Skips (exit 0 with
// a warning) when none is found, like the optional node/ffmpeg steps.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, dirname, relative, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const GAME = resolve(HERE, '..', '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const files = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && ['--sky', '--tint', '--chrome', '--cell', '--strip'].includes(args[i - 1])));
if (!files.length) {
  console.error('usage: node art/tools/three_snapshot.mjs file.glb [out.png] [--sky x.hdr] [--tint #rrggbb] [--chrome exe]');
  process.exit(2);
}
const glb = resolve(files[0]);
const out = resolve(files[1] ?? glb.replace(/\.glb$/, '_three.png'));
const sky = opt('--sky') ? resolve(opt('--sky')) : null;
const tint = opt('--tint', '#ff5a4f');
const cell = Number(opt('--cell', 300));
const strip = opt('--strip', '');   // debug: comma list of material maps to drop (aoMap,normalMap,map,roughnessMap)
const mode = args.includes('--clips') ? 'clips' : 'sheet';

function findChrome() {
  const c = opt('--chrome') || process.env.CHROME;
  if (c && existsSync(c)) return c;
  const roots = ['/opt/pw-browsers', join(process.env.HOME || '', '.cache', 'ms-playwright'),
    join(process.env.LOCALAPPDATA || '', 'ms-playwright')];
  for (const r of roots) {
    if (!r || !existsSync(r)) continue;
    for (const d of readdirSync(r).sort().reverse()) {
      for (const rel of ['chrome-linux/headless_shell', 'chrome-linux/chrome', 'chrome-win/chrome.exe',
        'chrome-headless-shell-linux64/chrome-headless-shell']) {
        const p = join(r, d, rel);
        if (existsSync(p)) return p;
      }
    }
  }
  for (const p of ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
    'C:/Program Files/Google/Chrome/Application/chrome.exe']) if (existsSync(p)) return p;
  return null;
}
const chrome = findChrome();
if (!chrome) {
  console.warn('[three-snap] no Chromium found ($CHROME / --chrome / Playwright cache): skipped');
  process.exit(0);
}
const within = (p) => !relative(GAME, p).startsWith('..');
if (!within(glb) || (sky && !within(sky))) {
  console.error('[three-snap] the GLB/HDR must live under the game folder (served over http)');
  process.exit(2);
}

const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;background:#20242b}canvas{display:block}</style>
<script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js",
"three/addons/":"/node_modules/three/examples/jsm/"}}</script></head><body>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
const Q = new URLSearchParams(location.search);
const MODE = Q.get('mode') || 'sheet';
const CELL = +Q.get('cell');
const report = { ok: false, mode: MODE };
try {
  const gltf = await new GLTFLoader().loadAsync(Q.get('glb'));
  const clips = Object.fromEntries(gltf.animations.map((c) => [c.name, c]));
  const CLIPS = gltf.animations.map((c) => c.name);
  const COLS = 8, ROWS = MODE === 'clips' ? CLIPS.length : 3;
  const W = CELL * COLS, H = CELL * ROWS;
  const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  r.setPixelRatio(1); r.setSize(W, H);
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.AgXToneMapping; r.toneMappingExposure = 1.0;
  r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
  r.setScissorTest(true);
  document.body.appendChild(r.domElement);
  const scene = new THREE.Scene();
  const pm = new THREE.PMREMGenerator(r);
  if (Q.get('sky')) {
    const hdr = await new HDRLoader().loadAsync(Q.get('sky'));
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = pm.fromEquirectangular(hdr).texture;
    scene.environmentIntensity = 1.0;
  } else {
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.55;
  }
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
  sun.position.set(-6, 12, 7); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 1, far: 40 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40),
    new THREE.MeshStandardMaterial({ color: 0xcfc6b2, roughness: 0.95 }));      // chalk road
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const proto = gltf.scene;
  const strip = (Q.get('strip') || '').split(',').filter(Boolean);
  if (strip.includes('shadows')) { r.shadowMap.enabled = false; strip.splice(strip.indexOf('shadows'), 1); }
  proto.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
    for (const k of strip) { if (k === 'metal') { o.material.metalnessMap = null; o.material.metalness = 0; } else o.material[k] = null; }
    o.material.needsUpdate = true; } });
  // facing / height measurement in the bind pose (no clip applied)
  proto.updateMatrixWorld(true);
  const bone = (o, n) => o.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(n));
  const wp = (o) => o.getWorldPosition(new THREE.Vector3());
  const toe = wp(bone(proto, 'toe.L')).add(wp(bone(proto, 'toe.R'))).multiplyScalar(0.5);
  const ankle = wp(bone(proto, 'foot.L')).add(wp(bone(proto, 'foot.R'))).multiplyScalar(0.5);
  const fwd = toe.clone().sub(ankle); fwd.y = 0; fwd.normalize();
  report.facing = [+fwd.x.toFixed(3), +fwd.z.toFixed(3)];
  const box = new THREE.Box3();
  proto.traverse((o) => { if (o.isSkinnedMesh) { o.skeleton.update(); o.computeBoundingBox(); box.union(o.boundingBox.clone().applyMatrix4(o.matrixWorld)); } });
  report.bindBox = [box.min.toArray().map((v) => +v.toFixed(3)), box.max.toArray().map((v) => +v.toFixed(3))];
  report.headY = +wp(bone(proto, 'head')).y.toFixed(3);
  const LOOPS = /^(idle|run|recall|idle_lobby|channel|stunned)$/;
  function instance(clip, t, tintHex) {
    const o = SkeletonUtils.clone(proto);
    if (tintHex) o.traverse((m) => { if (m.isMesh && m.material.name === 'accent') {
      m.material = m.material.clone(); m.material.emissive.set(tintHex); m.material.color.set(tintHex).multiplyScalar(0.4); } });
    if (clip && clips[clip]) {
      const mx = new THREE.AnimationMixer(o);
      const a = mx.clipAction(clips[clip]); a.play();
      if (!LOOPS.test(clip)) { a.clampWhenFinished = true; a.setLoop(THREE.LoopOnce); }
      mx.setTime(Math.min(clips[clip].duration - 1e-4, t * clips[clip].duration));
    }
    o.updateMatrixWorld(true);
    return o;
  }
  // gameplay camera (STYLE_BIBLE "In-game camera", tokens.json camera): pitch 52°, vFOV 26°, 28.5 m, looking -Z
  const GAME = { pitch: 52 * Math.PI / 180, fov: 26, dist: 28.5 };
  function gameCam(target, cell = CELL) {
    const c = new THREE.PerspectiveCamera(GAME.fov, 1920 / 1080, 1, 200);
    c.position.set(target.x, target.y + Math.sin(GAME.pitch) * GAME.dist, target.z + Math.cos(GAME.pitch) * GAME.dist);
    c.lookAt(target);
    c.setViewOffset(1920, 1080, 960 - cell / 2, 540 - cell / 2, cell, cell);   // 1:1 crop of the 1080p frame
    c.updateProjectionMatrix();
    return c;
  }
  function draw(obj, cam, col, row, bg) {
    scene.add(obj);
    const x = col * CELL, y = (ROWS - 1 - row) * CELL;
    r.setViewport(x, y, CELL, CELL); r.setScissor(x, y, CELL, CELL);
    r.setClearColor(bg ?? 0x2a2f38);
    r.render(scene, cam);
    scene.remove(obj);
  }
  // accent coverage at the game camera: unlit mask (accent white, rest grey) averaged over 8 facings
  {
    const rt = new THREE.WebGLRenderTarget(160, 160);
    const ms = new THREE.Scene();
    const white = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    const grey = new THREE.MeshBasicMaterial({ color: 0x808080, toneMapped: false });
    const buf = new Uint8Array(160 * 160 * 4);
    let acc = 0, body = 0, top = 0;
    r.setScissorTest(false);
    for (let i = 0; i < 8; i++) {
      const o = instance('idle', 0); o.rotation.y = i * Math.PI / 4; o.updateMatrixWorld(true);
      o.traverse((m) => { if (m.isMesh) m.material = m.material.name === 'accent' ? white : grey; });
      ms.add(o);
      r.setRenderTarget(rt); r.setViewport(0, 0, 160, 160); r.setClearColor(0x000000); r.clear();
      r.render(ms, gameCam(new THREE.Vector3(0, 0.95, 0), 160));
      r.readRenderTargetPixels(rt, 0, 0, 160, 160, buf);
      let ymin = 999, ymax = -1;
      for (let p = 0; p < 160 * 160; p++) if (buf[p * 4] > 40) { const y = Math.floor(p / 160); ymin = Math.min(ymin, y); ymax = Math.max(ymax, y); }
      for (let p = 0; p < 160 * 160; p++) {
        const v = buf[p * 4];
        if (v > 40) body++;
        if (v > 200) { acc++; if (Math.floor(p / 160) > (ymin + ymax) / 2) top++; }
      }
      ms.remove(o);
    }
    r.setRenderTarget(null); r.setScissorTest(true);
    report.accentPct = +(100 * acc / Math.max(1, body)).toFixed(2);
    report.accentTopHalfPct = acc ? +(100 * top / acc).toFixed(1) : 0;
  }
  {
    const c = new THREE.PerspectiveCamera(GAME.fov, 1920 / 1080, 1, 200);
    c.position.set(0, Math.sin(GAME.pitch) * GAME.dist, Math.cos(GAME.pitch) * GAME.dist); c.lookAt(0, 0, 0); c.updateMatrixWorld();
    const tp = new THREE.Vector3(0, box.max.y, 0).project(c), bt = new THREE.Vector3(0, 0, 0).project(c);
    report.heightPx1080 = Math.round((tp.y - bt.y) / 2 * 1080);
  }
  const tgt = new THREE.Vector3(0, 0.95, 0);
  if (MODE === 'clips') {
    // every clip, 8 frames (impact frame included for attack/cast clips), 3/4 eye-level camera
    const cam = new THREE.PerspectiveCamera(28, 1, 0.1, 60);
    cam.position.set(-2.4, 1.55, 3.9); cam.lookAt(0, 0.82, 0);
    CLIPS.forEach((name, row) => {
      const ts = /^(attack|cast|crit)/.test(name) ? [0, 0.12, 0.24, 0.32, 0.4, 0.52, 0.7, 1] : [0, 1/7, 2/7, 3/7, 4/7, 5/7, 6/7, 1];
      ts.forEach((t, col) => draw(instance(name, t), cam, col, row, 0x39404a));
    });
    report.rows = CLIPS;
  } else {
    // row 0: 8 facings at the gameplay camera, 1:1 pixels (rotation about +Y; 0 = faces +Z = camera)
    for (let i = 0; i < 8; i++) {
      const o = instance('idle', 0); o.rotation.y = i * Math.PI / 4; o.updateMatrixWorld(true);
      draw(o, gameCam(tgt), i, 0);
    }
    // row 1: key poses at the gameplay camera + team tint
    const keys = [['run', 0], ['run', 0.5], ['attack1', 0.24], ['attack1', 0.4], ['cast_a3', 0.4], ['cast_ult', 0.4], ['death', 1.0]];
    keys.forEach(([c, t], i) => { const o = instance(c, t); o.rotation.y = -0.6; o.updateMatrixWorld(true); draw(o, gameCam(tgt), i, 1); });
    { const o = instance('idle', 0, Q.get('tint')); o.rotation.y = 0.5; o.updateMatrixWorld(true); draw(o, gameCam(tgt), 7, 1); }
    // row 2: close-ups with the real material (texture / deformation QA)
    const close = [[0, 1.0, 3.2], [-0.7, 1.0, 3.2], [Math.PI / 2, 1.0, 3.2], [Math.PI, 1.0, 3.2], [-0.4, 1.55, 1.1], [Math.PI * 0.8, 1.35, 1.2], [-0.6, 0.5, 1.5], [2.4, 1.1, 1.6]];
    close.forEach(([yaw, h, d], i) => {
      const o = instance('idle', 0);
      const c = new THREE.PerspectiveCamera(30, 1, 0.05, 50);
      c.position.set(Math.sin(yaw) * d, h + d * 0.12, Math.cos(yaw) * d); c.lookAt(0, h, 0);
      draw(o, c, i, 2, 0x39404a);
    });
  }
  report.size = [W, H];
  report.clips = CLIPS.length;
  report.ok = true;
} catch (e) {
  report.error = String(e && e.stack || e);
}
window.__report = report;
</script></body></html>`;

const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.glb': 'model/gltf-binary', '.hdr': 'application/octet-stream',
  '.html': 'text/html', '.json': 'application/json', '.png': 'image/png' };
const server = createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/__snap.html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(PAGE); return; }
  const p = resolve(GAME, '.' + decodeURIComponent(u.pathname));
  if (!within(p) || !existsSync(p)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' });
  res.end(readFileSync(p));
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const port = server.address().port;
const rel = (p) => '/' + relative(GAME, p).split('\\').join('/');
const url = `http://127.0.0.1:${port}/__snap.html?glb=${encodeURIComponent(rel(glb))}&cell=${cell}` +
  `&tint=${encodeURIComponent(tint)}&mode=${mode}` + (sky ? `&sky=${encodeURIComponent(rel(sky))}` : '') + (strip ? `&strip=${encodeURIComponent(strip)}` : '');

const prof = mkdtempSync(join(tmpdir(), 'vale-snap-'));
const W = cell * 8, H = cell * (mode === 'clips' ? 24 : 3);
const proc = spawn(chrome, ['--headless', '--no-sandbox', '--disable-gpu-sandbox', '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', `--window-size=${W},${H}`,
  `--user-data-dir=${prof}`, '--remote-debugging-port=0', '--hide-scrollbars', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
let wsUrl = null;
proc.stderr.on('data', (d) => { const m = String(d).match(/ws:\/\/[^\s]+/); if (m && !wsUrl) wsUrl = m[0]; });
const t0 = Date.now();
while (!wsUrl && Date.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 100));
function done(code, msg) { if (msg) console.log(msg); try { proc.kill('SIGKILL'); } catch {} server.close(); try { rmSync(prof, { recursive: true, force: true }); } catch {} process.exit(code); }
if (!wsUrl) done(1, '[three-snap] Chromium did not start');
const browser = new WebSocket(wsUrl);
await new Promise((ok, ko) => { browser.onopen = ok; browser.onerror = ko; });
let id = 0; const pending = new Map();
browser.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}, sessionId) => new Promise((ok) => { const i = ++id; pending.set(i, ok);
  browser.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) })); });
const { result: { targetId } } = await send('Target.createTarget', { url: 'about:blank' });
const { result: { sessionId } } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false }, sessionId);
await send('Page.enable', {}, sessionId);
await send('Page.navigate', { url }, sessionId);
let report = null;
while (Date.now() - t0 < 240000) {
  const r = await send('Runtime.evaluate', { expression: 'JSON.stringify(window.__report || null)', returnByValue: true }, sessionId);
  const v = r.result?.result?.value;
  if (v && v !== 'null') { report = JSON.parse(v); break; }
  await new Promise((r) => setTimeout(r, 250));
}
if (!report) done(1, '[three-snap] timed out waiting for the page');
if (!report.ok) done(1, `[three-snap] page error: ${report.error}`);
const [SW, SH] = report.size;
const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: SW, height: SH, scale: 1 } }, sessionId);
writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
report.out = relative(GAME, out).split('\\').join('/');
report.seconds = +((Date.now() - t0) / 1000).toFixed(1);
const facingOk = report.facing[1] > 0.95;
done(facingOk ? 0 : 1, '[three-snap] ' + JSON.stringify(report) + (facingOk ? '' : '\n[three-snap] FAIL: model does not face +Z'));
