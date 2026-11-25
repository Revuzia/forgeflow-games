// VALE harness — orch1 W3-B (FU-7 / FU-9, ruling 68): the CC body capture strip at the game camera. The real renderer (render
// bench, real Chrome GPU, heavy slot) on a match host of its own (waves and bots off). Seven fighters stand in a row; each
// gets one CC kind through the sim itself (status.ts applyStatus; the airborne one a real displacement, movement.ts
// displaceUnit) and the row is shot at --times seconds after the CC lands: stun, airborne, sleep, fear, taunt, root, and a
// 60 % slow on a walking fighter. Each actor's played role and life-layer weights are logged beside the shot.
//
//   node _harness/w3b_cc_strip.mjs [--picks burdam,kemdo,hesmi,lisvel,rishal,tunlan,odrum] [--times 0.12,0.3,0.55,0.9]
//        [--out _harness/_shots/w3b_cc_strip.jpg] [--q high] [--zoom 13 | --game]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { open } from './pw.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const PICKS = opt('picks', 'burdam,kemdo,hesmi,lisvel,rishal,tunlan,odrum').split(',');
const TIMES = opt('times', '0.12,0.3,0.55,0.9').split(',').map(Number);
const OUT = opt('out', join(HERE, '_shots', 'w3b_cc_strip.jpg'));
const KINDS = ['stun', 'airborne', 'sleep', 'fear', 'taunt', 'root', 'walk'];
const ZOOM = args.includes('--game') ? null : Number(opt('zoom', '13'));
mkdirSync(dirname(OUT), { recursive: true });

const { browser, page, logs } = await open(`/_harness/web/render_bench.html?mode=rift&q=${opt('q', 'high')}&t=0&dev=1&hud=0&manual=1`, { wait: false, hmr: false });
const B = (fn, a) => page.evaluate(([src, x]) => (0, eval)(`(${src})`)(window.__VALE_BENCH__, x), [fn.toString(), a]);
const tiles = [], log = [];
try {
  await page.waitForFunction(() => window.__VALE_BENCH__?.ready === true || window.__VALE_BENCH__?.error, null, { timeout: 300000 });
  await B(async (b, picks) => {
    const { LocalMatchHost } = await import('/src/session/match_host.ts');
    const loaded = (path) => performance.getEntriesByType('resource').map((e) => e.name).filter((n) => new URL(n).pathname === path).pop() ?? path;
    b.__st = await import(loaded('/src/sim/status.ts'));
    b.__mv = await import(loaded('/src/sim/movement.ts'));
    const cat = b.catalog, base = b.host.setup, R = b.renderer;
    const setup = { ...base, matchId: 'w3b-cc', seats: base.seats.map((s, i) => {
      const fighter = picks[i] || s.fighter;
      const skin = cat.skins.find((k) => k.fighter === fighter && k.tier === 'base')?.id ?? '';
      return { ...s, fighter, skin, controller: 'human' };
    }) };
    const h = new LocalMatchHost(cat, setup, 0, { autopilot: false, maxTimeScale: 16, pregameSeconds: 0 });
    h.start();
    await R.preload(setup);
    R.setScene(h);
    const W = h.sim.world; b.__W = W; b.__H = h;
    try { h.drivers.clear(); } catch { /* none */ }
    W.systems[8] = W.systems[8].filter((f) => f.name !== 'waveSystem' && f.name !== 'minionSystem');
    b.__step = (n = 1, dt = 1 / 30) => { for (let i = 0; i < n; i++) { h.pump(dt); R.render(dt); } };
  }, PICKS);
  await page.waitForTimeout(9000);                       // every model lands
  const spot = { x: 86, y: 50 };
  const run = async (t) => B((b, a) => {
    const W = b.__W, h = b.__H, R = b.renderer;
    const ids = W.players.slice(0, 7).map((p) => p.entity);
    const src = W.entity(W.players[9].entity);
    src.x = a.x; src.y = a.y - 30; src.alive = true; src.autoAttack = false;
    for (let p = 7; p < W.players.length; p++) { const e = W.entity(W.players[p].entity); if (p !== 9) { e.x = 150; e.y = 40 + p; } }
    ids.forEach((id, i) => { const e = W.entity(id); e.alive = true; e.hp = e.maxHp; e.statuses.length = 0; e.autoAttack = false; e.x = a.x - 12 + i * 4; e.y = a.y; e.facing = Math.PI / 2; e.vx = e.vy = 0; h.sim.command(i, { type: 'stop' }); });
    b.__step(45);
    // the CCs, from the source standing behind the row
    ids.forEach((id, i) => {
      const e = W.entity(id), k = a.kinds[i];
      if (k === 'airborne') b.__mv.displaceUnit(W, { caster: src, dx: 0, dy: 1, px: e.x, py: e.y, depth: 0, source: { id: 'w3b' } }, e, { op: 'displace', mode: 'knockback', distance: 2.5, duration: 1.0 });
      else if (k === 'walk') { b.__st.applyStatus(W, src, e, 'slow', 3, { power: 0.6 }); h.sim.command(i, { type: 'move', x: e.x, y: e.y + 12 }); }
      else b.__st.applyStatus(W, src, e, k, 3);
    });
    const n = Math.max(1, Math.round(a.t * 60));
    for (let f = 0; f < n; f++) { h.pump(1 / 60); R.render(1 / 60); }
    // one close crop per fighter, on wherever its CC took it (--zoom m: 14 close, the map's own camera distance with --game)
    const out = [];
    for (const id of ids) {
      const e = h.view.entity(id);
      b.focus(e.x, e.y); b.zoom(a.zoom ?? b.catalog.maps.find((m) => m.id === h.setup.map).camera.distance); R.render(0);
      const g = b.screen(e.x, e.y, 0), top = b.screen(e.x, e.y, 2.6 + e.height);
      out.push({ gx: g.x, gy: g.y, ty: top.y });
    }
    const info = ids.map((id) => { const ac = R.actors.get(id), e = h.view.entity(id); const L = ac?.life; return { def: e.def, state: e.state, anim: e.anim, role: ac?.currentKey, h: +e.height.toFixed(2), sts: e.statuses.map((s) => s.kind).join('+'), w: L ? { air: +L.wAir.toFixed(2), sleep: +L.wSleep.toFixed(2), fear: +L.wFear.toFixed(2), taunt: +L.wTaunt.toFixed(2), root: +L.wRoot.toFixed(2) } : null, locoW: +(ac?.locoW ?? 0).toFixed(2) }; });
    return { info, crops: out };
  }, { ...spot, kinds: KINDS, t, zoom: ZOOM });
  for (const t of TIMES) {
    const r = await run(t);
    log.push({ t, info: r.info });
    console.log(`t=${t}s`, r.info.map((x, i) => `${KINDS[i]}:${x.def}/${x.state}/${x.role} h${x.h}`).join('  '));
    // re-render each fighter's frame and crop it (the sim does not advance between the crops)
    const cells = [];
    for (let i = 0; i < r.crops.length; i++) {
      const c = await B((b, a) => { const h = b.__H, e = h.view.entity(a.id); b.focus(e.x, e.y); b.zoom(a.zoom ?? b.catalog.maps.find((m) => m.id === h.setup.map).camera.distance); b.renderer.render(0); const g = b.screen(e.x, e.y, 0), top = b.screen(e.x, e.y, 2.6 + e.height); return { gx: g.x, gy: g.y, ty: top.y }; }, { id: (await B((b, j) => b.__W.players[j].entity, i)), zoom: ZOOM });
      const hgt = Math.max(120, Math.round(c.gy - c.ty) + 40), wid = Math.round(hgt * 0.8);
      cells.push(await page.screenshot({ clip: { x: Math.max(0, Math.round(c.gx - wid / 2)), y: Math.max(0, Math.round(c.ty - 10)), width: wid, height: hgt } }));
    }
    const ms = await Promise.all(cells.map((x) => sharp(x).metadata()));
    const H0 = Math.max(...ms.map((m) => m.height)), W0 = ms.reduce((s, m) => s + m.width, 0);
    let x0 = 0; const cc = cells.map((buf, i) => { const o = { input: buf, left: x0, top: 0 }; x0 += ms[i].width; return o; });
    tiles.push({ t, buf: await sharp({ create: { width: W0, height: H0, channels: 3, background: '#0B0D11' } }).composite(cc).png().toBuffer() });
  }
} finally { await browser.close(); }
const metas = await Promise.all(tiles.map((x) => sharp(x.buf).metadata()));
const Wd = Math.max(...metas.map((m) => m.width)), Hs = metas.map((m) => m.height);
const comp = []; let y = 0;
tiles.forEach((x, i) => { comp.push({ input: x.buf, left: 0, top: y }); y += Hs[i]; });
const labels = tiles.map((x, i) => `<text x="8" y="${Hs.slice(0, i).reduce((s, v) => s + v, 0) + 22}" font-family="Helvetica" font-size="18" fill="#EDE6D6" stroke="#0B0D11" stroke-width="3" paint-order="stroke">t = ${x.t} s   ${KINDS.join(' | ')}</text>`).join('');
comp.push({ input: Buffer.from(`<svg width="${Wd}" height="${y}" xmlns="http://www.w3.org/2000/svg">${labels}</svg>`), left: 0, top: 0 });
await sharp({ create: { width: Wd, height: y, channels: 3, background: '#0B0D11' } }).composite(comp).jpeg({ quality: 90 }).toFile(OUT);
writeFileSync(OUT.replace(/\.jpg$/, '.json'), JSON.stringify({ picks: PICKS, kinds: KINDS, log, pageErrors: logs.slice(0, 10) }, null, 1));
console.log('strip ->', OUT, logs.length ? `page errors: ${logs.slice(0, 4).join(' | ')}` : '');
process.exit(0);
