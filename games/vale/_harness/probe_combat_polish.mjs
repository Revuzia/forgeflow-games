// VALE harness — combat polish gates on the real renderer (render bench, real Chrome GPU, heavy slot). One match host of
// its own (the lineup below), fast-forwarded 420 s, waves frozen, bots muted; the viewer is seat 0 (Lisvel), every
// caster is an ENEMY (its telegraphs are the enemy treatment). content/vfx.json on disk replaces the catalog's VFX
// defs (the dev catalog may be stale); `--before <file>` measures that defs file instead (the impact-hold A/B).
//
//   ult     combat F4. Kemdo, Rishal, Tunlan, Hesmi cast their ultimate at the viewer 4.5 m away. Every frame the lift
//           uniforms (vfx/screen.ts uLiftA) are read; on frames with a lift ≥ 1.3 the frame is grabbed:
//             ctr      the lift's screen centre (firstCtr: the first beat) vs the caster's and the victim's ground points;
//                      done: the centre sits nearer the victim / the shape's centroid than the caster (Tunlan's cone,
//                      Rishal's track)
//             body     the victim's BODY pixels (its skinned body alone rendered into an empty target, above its feet) and the share of them that is white (luma > 225, chroma < 30) with the lift alone
//                      (VFX off, the actor's victim flash hidden: the envelope's own effect) less the body's white with no
//                      lift (its own pale parts), with the hit flash, and in the full frame; done: the lift adds ≤ 0.10 at every beat
//                      (the review: the struck unit went 22-34 % white on the first beat, its box measure). `boxWhite`
//                      repeats the review's box measure (body box ±45 px, ground included) for comparison
//             core     mean luma inside 0.5 × the lift radius over the same circle after everything faded (the review's
//                      measure) and the same with the victim's box left out (ground only); done: ≥ 2.3 on the first
//                      beat (r12 M13 2.3-2.5×)
//   cc      combat F5. Each hard CC kind is put on one fighter in a row (applyStatus), the frame is shot; the label
//           draw must carry one CC plate per fighter, and the plate's alpha must be 0 → 1 over 70 ms.
//   flash   combat m-3. Tunlan's 9 m cone and Burdam's 7 m circle land on the viewer: on the landing-flash frames the
//           telegraph layer's alpha is read at the shape's middle (axis 50 % / centre ring 25 %), just inside the
//           edge and on the inner contour; done: middle ≤ 0.22 (56/255), edge band ≥ 0.45.
//   hold    combat m-1. Kemdo (heavy), Rishal (light) and Tunlan's shot (magic) basic-attack the viewer; from the hit
//           event, the pixels the VFX pass adds inside the victim box (luma delta ≥ 0.08) are counted every frame for
//           12 frames (30 Hz), with the lit region's reach (2 × the 90th-percentile distance from its centroid) over the
//           victim's art height. `sizeMs` = how long the reach stays ≥ 0.5; done: ≥ 200 ms (r12 M5: ≈ 0.7 × victim
//           height for ≈ 200 ms). Info: `eqd` the lit area as a disc's diameter over the victim's height, `readMs` how
//           long the count stays ≥ 25 % of its peak.
//
//   node _harness/probe_combat_polish.mjs [ult,cc,flash,hold] [--before <vfx.json>] [--tag <name>]
//   → _harness/_reports/fw_W1_combat_polish[_tag].json, shots _harness/_shots/fw_W1_polish_*.png
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { open } from './pw.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(HERE, '_shots'), REPS = join(HERE, '_reports');
mkdirSync(SHOTS, { recursive: true }); mkdirSync(REPS, { recursive: true });
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const ONLY = (args[0] && !args[0].startsWith('--') ? args[0] : 'ult,cc,flash,hold').split(',');
const BEFORE = opt('before', ''), TAG = opt('tag', BEFORE ? 'before' : '');
const OUT = join(REPS, `fw_W1_combat_polish${TAG ? '_' + TAG : ''}.json`);
const strip = (v) => (Array.isArray(v) ? v.map(strip) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => !k.startsWith('$')).map(([k, x]) => [k, strip(x)])) : v);
const defs = strip(JSON.parse(readFileSync(BEFORE || join(HERE, '../content/vfx.json'), 'utf8')));
const LINEUP = ['lisvel', 'ardit', 'dunsom', 'ilsheta', 'odrum', 'kemdo', 'tunlan', 'hesmi', 'rishal', 'burdam'];

const report = { at: new Date().toISOString(), defs: BEFORE || 'content/vfx.json', ult: [], cc: null, flash: [], hold: [], pass: true, fails: [] };
const fail = (m) => { report.pass = false; report.fails.push(m); console.log('FAIL', m); };

const { browser, page, logs } = await open('/_harness/web/render_bench.html?mode=rift&q=high&t=0&dev=1&hud=0&manual=1', { wait: false, hmr: false });
try {
  await page.waitForFunction(() => window.__VALE_BENCH__?.ready === true || window.__VALE_BENCH__?.error, null, { timeout: 300000 });
  const B = (fn, a) => page.evaluate(([src, x]) => (0, eval)(`(${src})`)(window.__VALE_BENCH__, x), [fn.toString(), a]);
  await B(async (b, d) => { const { VfxDef } = await import('/src/contracts/catalog.ts'); b.renderer.vfx.redefine(d.map((x) => VfxDef.parse(x))); }, defs);
  report.players = await B(async (b, picks) => {
    const { LocalMatchHost } = await import('/src/session/match_host.ts');
    const { createBots } = await import('/src/sim/bots/index.ts');
    // the SAME module instance the bench loaded when the timing buffer still lists it: after an edit the dev server serves
    // a changed file as `…?t=<stamp>`, and a bare import is a second instance (module state the bench never sees)
    const loaded = (path) => performance.getEntriesByType('resource').map((e) => e.name).filter((n) => new URL(n).pathname === path).pop() ?? path;
    b.__st = await import(loaded('/src/sim/status.ts'));
    const cat = b.catalog, base = b.host.setup, R = b.renderer;
    // the envelope's uniforms as the renderer's own post chain holds them (the exposure effect's Uniform objects ARE
    // vfx/screen.ts screenUniforms of the instance the renderer runs)
    const expo = R.post.gradePass.effects.find((e) => e.name === 'ValeExposure');
    b.__U = { uLiftA: expo.uniforms.get('uLiftA'), uExpo: expo.uniforms.get('uExpo'), uBreath: expo.uniforms.get('uBreath') };
    const setup = { ...base, matchId: `polish-${picks.join('-')}`, seats: base.seats.map((s, i) => {
      const fighter = picks[i] || s.fighter;
      const skin = cat.skins.find((k) => k.fighter === fighter && k.tier === 'base')?.id ?? cat.skins.find((k) => k.fighter === fighter)?.id ?? '';
      return { ...s, fighter, skin };
    }) };
    const h = new LocalMatchHost(cat, setup, 0, { bots: createBots(cat, setup), autopilot: true, maxTimeScale: 16, pregameSeconds: 0 });
    h.start(); h.setTimeScale(16);
    let guard = 0; while (h.view.time < 420 && !h.ended && guard++ < 100000) h.pump(0.25);
    h.setTimeScale(1);
    await R.preload(setup);
    R.setScene(h);
    b.__H = h;
    const W = h.sim.world; b.__W = W;
    b.__muted = new Set(W.players.map((_, i) => i));
    const orig = W.command.bind(W); W.command = (p, c) => { if (b.__allow || !b.__muted.has(p)) orig(p, c); };
    try { h.drivers.clear(); } catch { /* none */ }
    b.__cmd = (p, c) => { b.__allow = true; try { h.sim.command(p, c); } finally { b.__allow = false; } };
    W.systems[8] = W.systems[8].filter((f) => f.name !== 'waveSystem' && f.name !== 'minionSystem');
    const m = cat.maps.find((x) => x.id === setup.map);
    b.__clear = () => { let n = 0; for (const e of W.entities) if ((e.kind === 'minion' || e.kind === 'monster') && e.alive) { const sp = m.bases[e.team]?.spawn ?? [5, 5]; e.x = sp[0] + (e.team ? -3 : 3) + (n % 5) * 0.4; e.y = sp[1] - 4 + (n % 7); e.vx = e.vy = 0; n++; } };
    b.__step = (n = 1, dt = 1 / 30) => { for (let i = 0; i < n; i++) { h.pump(dt); R.render(dt); } };
    b.__prep = (id, x, y, face) => {
      const e = W.entity(id); if (!e) return false;
      if (!e.alive) { e.alive = true; e.hp = e.maxHp; }
      e.x = x; e.y = y; e.vx = 0; e.vy = 0; if (face !== undefined) e.facing = face;
      e.hp = e.maxHp; e.res = e.maxRes; e.shield = 0; e.statuses.length = 0; e.autoAttack = false;
      if (e.level < 13) e.level = 13;
      for (let i = 0; i < 4; i++) { const s = e.slots?.[i]; if (s) { s.rank = Math.max(s.rank, s.maxRank); s.cooldown = 0; if (s.maxCharges) s.charges = s.maxCharges; } }
      return true;
    };
    b.__park = () => { for (let p = 0; p < W.players.length; p++) b.__prep(W.players[p].entity, p < 5 ? 30 + p : 150, 40 + p); };
    b.__ev = [];
    h.onEvents((evs) => { for (const e of evs) b.__ev.push(JSON.parse(JSON.stringify(e))); });
    const gl = () => R.gl.getContext();
    b.__grab = () => { R.render(0); const c = gl(); const Wd = c.drawingBufferWidth, Hd = c.drawingBufferHeight; const px = new Uint8Array(Wd * Hd * 4); c.bindFramebuffer(c.FRAMEBUFFER, null); c.readPixels(0, 0, Wd, Hd, c.RGBA, c.UNSIGNED_BYTE, px); return { px, Wd, Hd }; };
    b.__h = (id) => { const a = R.actors.get(id); const e = h.view.entity(id); const x = a ? a.x : e.x, y = a ? a.y : e.y; const g = b.screen(x, y, 0), t = b.screen(x, y, a?.barHeight ?? 2.2), hd = b.screen(x, y, a?.artHeight ?? 1.9); return { gx: g.x, gy: g.y, ty: t.y, hy: hd.y }; };
    const luma = (r, g, bl) => 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    b.__white = (g, box) => { const { px, Wd, Hd } = g; let w = 0, n = 0, s = 0; for (let y = Math.max(0, box.y0 | 0); y < Math.min(Hd, box.y1 | 0); y++) for (let x = Math.max(0, box.x0 | 0); x < Math.min(Wd, box.x1 | 0); x++) { const o = ((Hd - 1 - y) * Wd + x) * 4; const l = luma(px[o], px[o + 1], px[o + 2]); const c = Math.max(px[o], px[o + 1], px[o + 2]) - Math.min(px[o], px[o + 1], px[o + 2]); n++; s += l; if (l > 225 && c < 30) w++; } return { white: +(w / Math.max(1, n)).toFixed(3), mean: +(s / Math.max(1, n)).toFixed(1) }; };
    // mean luma inside a circle, the box left out (ground only)
    b.__circ = (g, cx, cy, rad, box) => { const { px, Wd, Hd } = g; let s = 0, n = 0; for (let y = Math.max(0, cy - rad | 0); y < Math.min(Hd, cy + rad); y += 2) for (let x = Math.max(0, cx - rad | 0); x < Math.min(Wd, cx + rad); x += 2) { if ((x - cx) ** 2 + (y - cy) ** 2 > rad * rad) continue; if (box && x >= box.x0 && x < box.x1 && y >= box.y0 && y < box.y1) continue; const o = ((Hd - 1 - y) * Wd + x) * 4; s += luma(px[o], px[o + 1], px[o + 2]); n++; } return n ? s / n : 0; };
    // the victim's body: actor shown vs hidden (VFX and telegraphs off) inside the box, above its feet. White share of
    // those pixels (luma > 225, chroma < 30) in four frames: `base` no lift and no hit flash (the body's own pale parts),
    // `lift` the envelope alone (the hit flash hidden too: what the post chain does to the body), `flash` the envelope
    // with the actor's own victim flash (the 1-2 frame hit flash, actors.ts VICTIM_FLASH), `full` everything
    b.__body = (id, box, feetY) => {
      const a = R.actors.get(id); const d = R.vfx.draw; const tv = R.overlay.teleScene.visible;
      const U = b.__U;
      // no lift for one grab: the envelope writes into stand-ins that ignore it, the dip and the breath read 1 and 0
      const pin = (u, v) => Object.defineProperty(u, 'value', { get: () => v, set: () => {}, configurable: true });
      const unpin = (u, v) => Object.defineProperty(u, 'value', { value: v, writable: true, enumerable: true, configurable: true });
      const keep = { a: U.uLiftA.value, e: U.uExpo.value, b: U.uBreath.value };
      const noLift = () => { const z = keep.a.map((v) => { const q = v.clone(); q.set(0, 0, 0, 0); q.set = function () { return this; }; return q; }); pin(U.uLiftA, z); pin(U.uExpo, 1); pin(U.uBreath, 0); };
      const lifted = () => { unpin(U.uLiftA, keep.a); unpin(U.uExpo, keep.e); unpin(U.uBreath, keep.b); };
      const full = b.__grab();
      R.vfx.draw = () => {}; R.overlay.teleScene.visible = false;
      let lift, flash, hid, base;
      // the renderer re-sets root.visible every frame (its cull): hide through the layers instead
      const masks = [];
      const off = (o) => { masks.push([o, o.layers.mask]); o.layers.disableAll(); };
      const restore = () => { for (const [o, m] of masks.splice(0)) o.layers.mask = m; };
      try {
        flash = b.__grab();
        for (const m of a.flashMeshes ?? []) m.traverse(off);
        lift = b.__grab();
        noLift();
        base = b.__grab();
      } finally { lifted(); restore(); R.vfx.draw = d; R.overlay.teleScene.visible = tv; }
      // the body mask: the actor's skinned body alone rendered into an empty target (its shadow and contact blob on the
      // ground are not body)
      const { Wd, Hd } = full;
      const g = R.gl; const RT = new (R.overlay.teleTarget.constructor)(Wd, Hd);
      const skip = [];
      a.root.traverse((o) => { if (o.isMesh && !o.isSkinnedMesh) { skip.push([o, o.layers.mask]); o.layers.disableAll(); } });
      for (const m of a.flashMeshes ?? []) m.traverse((o) => { skip.push([o, o.layers.mask]); o.layers.disableAll(); });
      const cc = g.getClearColor(new (R.tmpColor.constructor)()), ca = g.getClearAlpha(), ac = g.autoClear;
      const mask = new Uint8Array(Wd * Hd * 4);
      try {
        g.setRenderTarget(RT); g.setClearColor(0x000000, 0); g.clear(true, true, false); g.autoClear = false;
        g.render(a.root, R.rig.camera);
        g.readRenderTargetPixels(RT, 0, 0, Wd, Hd, mask);
      } finally { g.setRenderTarget(null); g.setClearColor(cc, ca); g.autoClear = ac; for (const [o, m] of skip) o.layers.mask = m; RT.dispose(); }
      hid = null;
      R.render(0);
      let n = 0, wl = 0, wf = 0, wb = 0, wh = 0;
      const white = (g, o) => { const l = luma(g.px[o], g.px[o + 1], g.px[o + 2]); const c = Math.max(g.px[o], g.px[o + 1], g.px[o + 2]) - Math.min(g.px[o], g.px[o + 1], g.px[o + 2]); return l > 225 && c < 30; };
      for (let y = Math.max(0, box.y0 | 0); y < Math.min(Hd, feetY | 0); y++) for (let x = Math.max(0, box.x0 | 0); x < Math.min(Wd, box.x1 | 0); x++) {
        const o = ((Hd - 1 - y) * Wd + x) * 4;
        if (mask[o + 3] < 128) continue;   // the target's rows are bottom-up like readPixels
        n++; if (white(lift, o)) wl++; if (white(full, o)) wf++; if (white(base, o)) wb++; if (white(flash, o)) wh++;
      }
      const k = (w) => +(w / Math.max(1, n)).toFixed(3);
      return { n, baseWhite: k(wb), liftWhite: k(wl), flashWhite: k(wh), fullWhite: k(wf), boxWhite: b.__white(full, box) };
    };
    // only these VFX ids spawn while set (the impact-hold window measures the hit's own look)
    b.__onlyIds = null;
    const spawn0 = R.vfx.spawnHandle.bind(R.vfx);
    R.vfx.spawnHandle = (vid, o) => (b.__onlyIds && !b.__onlyIds.includes(vid) ? 0 : spawn0(vid, o));
    b.__vfxPx = (box) => {
      const tv = R.overlay.teleScene.visible; R.overlay.teleScene.visible = false;
      const on = b.__grab(); const d = R.vfx.draw; R.vfx.draw = () => {}; let off; try { off = b.__grab(); } finally { R.vfx.draw = d; R.overlay.teleScene.visible = tv; } R.render(0);
      const { Wd, Hd } = on; let n = 0; const xs = [], ys = [];
      for (let y = Math.max(0, box.y0 | 0); y < Math.min(Hd, box.y1 | 0); y++) for (let x = Math.max(0, box.x0 | 0); x < Math.min(Wd, box.x1 | 0); x++) {
        const o = ((Hd - 1 - y) * Wd + x) * 4;
        const r = Math.max(0, on.px[o] - off.px[o]) / 255, g = Math.max(0, on.px[o + 1] - off.px[o + 1]) / 255, bl = Math.max(0, on.px[o + 2] - off.px[o + 2]) / 255;
        if (luma(r, g, bl) >= 0.08) { n++; xs.push(x); ys.push(y); }
      }
      // the lit region's size: twice the 90th-percentile distance of its pixels from their centroid (a starburst's
      // reach, the same at any rotation of its points; stray sparks and chips left out)
      if (n < 20) return { n, ext: 0 };
      let cx = 0, cy = 0; for (let i = 0; i < n; i++) { cx += xs[i]; cy += ys[i]; } cx /= n; cy /= n;
      const ds = xs.map((x, i) => Math.hypot(x - cx, ys[i] - cy)).sort((p, q) => p - q);
      return { n, ext: 2 * ds[Math.floor(n * 0.9)] };
    };
    // the telegraph layer alone (premultiplied alpha 0..255) at ground points
    b.__teleAt = (pts) => {
      const g = R.gl; const RT = new (R.overlay.teleTarget.constructor)(1920, 1080);
      g.setRenderTarget(RT); g.setClearColor(0x000000, 0); g.clear(true, true, false);
      const ac = g.autoClear; g.autoClear = false; g.render(R.overlay.teleScene, R.rig.camera); g.autoClear = ac; g.setRenderTarget(null);
      const buf = new Uint8Array(1920 * 1080 * 4); g.readRenderTargetPixels(RT, 0, 0, 1920, 1080, buf); RT.dispose();
      return pts.map((p) => { const s = b.screen(p.x, p.y, 0.04); let sum = 0, n = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = Math.round(s.x) + dx, Y = 1079 - (Math.round(s.y) + dy); if (X < 0 || X >= 1920 || Y < 0 || Y >= 1080) continue; sum += buf[(Y * 1920 + X) * 4 + 3]; n++; } return { k: p.k, a: n ? Math.round(sum / n) : -1 }; });
    };
    b.__park(); b.__clear();
    b.__step(10);
    return W.players.map((p, i) => { const e = W.entity(p.entity); return { seat: i, def: e?.def, team: e?.team, entity: p.entity }; });
  }, LINEUP);
  const P = report.players;
  const seat = (def) => P.find((p) => p.def === def);
  const spot = { x: 74, y: 55 };
  const setCam = () => B((b, s) => { b.renderer.rig.mode = 'free'; b.focus(s.x, s.y); b.zoom(b.catalog.maps.find((m) => m.id === b.__H.setup.map).camera.distance); b.__step(4); }, spot);
  await setCam();
  const clip = await B((b, s) => { const c = b.screen(s.x, s.y, 0); return { x: Math.round(c.x - 480), y: Math.round(c.y - 330), width: 960, height: 620 }; }, spot);
  const shot = (name, c = clip) => page.screenshot({ path: join(SHOTS, `fw_W1_polish_${name}${TAG ? '_' + TAG : ''}.png`), clip: c });
  // caster at spot.x − d/2, victim (seat 0) at spot.x + d/2, both still
  const stage = (c, d = 4.5) => B((b, a) => {
    const W = b.__W, pc = W.players[a.c].entity, pv = W.players[0].entity;
    b.__park(); b.__clear();
    b.__prep(pc, a.x - a.d / 2, a.y, 0); b.__prep(pv, a.x + a.d / 2, a.y, Math.PI);
    b.__cmd(a.c, { type: 'stop' }); b.__cmd(0, { type: 'stop' });
    b.__step(30);
    b.__prep(pc, a.x - a.d / 2, a.y, 0); b.__prep(pv, a.x + a.d / 2, a.y, Math.PI);
    b.__step(2);
    b.__ev.length = 0;
    return { pc, pv };
  }, { c, d, ...spot });

  // ── combat F4: the beat's anchor and the struck unit
  if (ONLY.includes('ult')) {
    for (const def of ['kemdo', 'rishal', 'tunlan', 'hesmi']) {
      const c = seat(def);
      const st = await stage(c.seat);
      const geo = await B((b, a) => ({ c: b.__h(a.pc), v: b.__h(a.pv) }), st);
      const vbox = { x0: geo.v.gx - 45, y0: geo.v.ty - 5, x1: geo.v.gx + 45, y1: geo.v.gy + 5 };
      const base = await B((b, a) => b.__white(b.__grab(), a.vbox), { vbox });
      await B((b, a) => { const me = b.__H.view.entity(a.pv); b.__cmd(a.c, { type: 'cast', slot: 'ult', x: me.x, y: me.y, target: a.pv }); }, { ...st, c: c.seat });
      const rows = [];
      for (let f = 1; f <= 72; f++) {
        rows.push(await B((b, a) => {
          b.__step(1);
          for (const id of [a.pc, a.pv]) { const e = b.__W.entity(id); if (e && e.alive) { e.hp = Math.max(e.hp, e.maxHp * 0.6); e.res = e.maxRes; } }
          const U = b.__U;
          const L = U.uLiftA.value.map((q) => ({ ux: q.x, uy: q.y, rr: q.z, w: q.w })).filter((q) => q.w > 0);
          const out = { w: L.length ? +Math.max(...L.map((q) => q.w)).toFixed(3) : 0 };
          if (L.some((q) => q.w >= 1.3)) {
            const q = L.reduce((m, x) => (x.w > m.w ? x : m));
            const g = b.__grab();
            const cx = q.ux * 1920, cy = (1 - q.uy) * 1080, rad = q.rr * 1080;
            out.q = { ux: q.ux, uy: q.uy, rr: q.rr };
            out.ctr = [Math.round(cx), Math.round(cy)];
            out.core = +b.__circ(g, cx, cy, rad * 0.5, null).toFixed(1);
            out.coreGround = +b.__circ(g, cx, cy, rad * 0.5, a.vbox).toFixed(1);
            out.white = b.__body(a.pv, a.vbox, a.feetY);
          }
          return out;
        }, { ...st, vbox, feetY: geo.v.gy - 6 }));
        if (rows[rows.length - 1].white && !rows.slice(0, -1).some((r) => r.white)) await shot(`ult_${def}_beat`);
      }
      await B((b) => { b.__step(75); });
      const first = rows.find((r) => r.ctr);
      let baseCore = null;
      if (first) {
        await stage(c.seat);
        baseCore = await B((b, a) => { const g = b.__grab(); const cx = a.q.ux * 1920, cy = (1 - a.q.uy) * 1080, r = a.q.rr * 1080 * 0.5; return { all: +b.__circ(g, cx, cy, r, null).toFixed(1), ground: +b.__circ(g, cx, cy, r, a.vbox).toFixed(1) }; }, { q: first.q, vbox });
      }
      const beats = rows.map((r, i) => ({ f: i + 1, ...r })).filter((r) => r.white);
      const dC = first ? Math.hypot(first.ctr[0] - geo.c.gx, first.ctr[1] - geo.c.gy) : null, dV = first ? Math.hypot(first.ctr[0] - geo.v.gx, first.ctr[1] - geo.v.gy) : null;
      const res = {
        def, caster: [Math.round(geo.c.gx), Math.round(geo.c.gy)], victim: [Math.round(geo.v.gx), Math.round(geo.v.gy)], firstCtr: first?.ctr ?? null,
        ctrToCaster: dC && Math.round(dC), ctrToVictim: dV && Math.round(dV), baseWhite: base, baseCore,
        beats: beats.map((r) => ({ f: r.f, w: r.w, bodyPx: r.white.n, bodyWhiteBase: r.white.baseWhite, bodyWhiteLift: r.white.liftWhite, bodyWhiteFlash: r.white.flashWhite, bodyWhiteFull: r.white.fullWhite, boxWhite: r.white.boxWhite.white,
          core: r.core, ratio: baseCore ? +(r.core / baseCore.all).toFixed(2) : null, ratioGround: baseCore ? +(r.coreGround / baseCore.ground).toFixed(2) : null })),
      };
      res.maxWhite = beats.length ? Math.max(...res.beats.map((r) => r.bodyWhiteLift)) : null;
      // what the envelope itself adds to the body (its own pale parts left out)
      res.maxLiftAdds = beats.length ? Math.max(...res.beats.map((r) => +(r.bodyWhiteLift - r.bodyWhiteBase).toFixed(3))) : null;
      res.maxWhiteFlash = beats.length ? Math.max(...res.beats.map((r) => r.bodyWhiteFlash)) : null;
      res.maxWhiteFull = beats.length ? Math.max(...res.beats.map((r) => r.bodyWhiteFull)) : null;
      res.maxBoxWhite = beats.length ? Math.max(...res.beats.map((r) => r.boxWhite)) : null;
      res.firstRatio = res.beats[0]?.ratio ?? null;
      res.firstRatioGround = res.beats[0]?.ratioGround ?? null;
      report.ult.push(res);
      console.log(`ult ${def.padEnd(7)} ctr ${JSON.stringify(res.firstCtr)} caster ${JSON.stringify(res.caster)} victim ${JSON.stringify(res.victim)} (to caster ${res.ctrToCaster}, to victim ${res.ctrToVictim})  body white: lift adds ${res.maxLiftAdds} (lift ${res.maxWhite}, + hit flash ${res.maxWhiteFlash}, full frame ${res.maxWhiteFull}) · box ${res.maxBoxWhite} (box base ${base.white})  core ×${res.firstRatio} ground ×${res.firstRatioGround}`);
      if (!first) fail(`${def}: no beat ≥ 1.3`);
      else {
        if (dV >= dC) fail(`${def}: the beat sits on the caster (${Math.round(dC)} px from it, ${Math.round(dV)} from the victim)`);
        if (res.beats.some((r) => r.bodyPx < 200)) fail(`${def}: the victim's body was not isolated (${res.beats.map((r) => r.bodyPx).join('/')} px)`);
        if (res.maxLiftAdds > 0.1) fail(`${def}: the lift whites ${res.maxLiftAdds} more of the victim's body at a beat (> 0.10)`);
        if (res.firstRatio !== null && Math.max(res.firstRatio, res.firstRatioGround ?? 0) < 2.3) fail(`${def}: core ×${res.firstRatio} (ground ×${res.firstRatioGround}) < 2.3 on the first beat`);
      }
      await B((b) => { b.__park(); b.__step(40); });
    }
  }

  // ── combat F5: one plate per hard CC
  if (ONLY.includes('cc')) {
    const kinds = ['stun', 'airborne', 'sleep', 'taunt', 'fear', 'root', 'silence'];
    const r = await B((b, a) => {
      const W = b.__W, R = b.renderer;
      b.__park(); b.__clear();
      const ids = W.players.slice(0, a.kinds.length).map((p) => p.entity);
      ids.forEach((id, i) => { b.__prep(id, a.x - 9 + i * 3, a.y + (i % 2 ? 1.5 : -1.5), Math.PI / 2); b.__cmd(W.players.findIndex((p) => p.entity === id), { type: 'stop' }); });
      b.__step(20);
      ids.forEach((id, i) => { b.__prep(id, a.x - 9 + i * 3, a.y + (i % 2 ? 1.5 : -1.5), Math.PI / 2); });
      b.__step(1);
      const labels0 = R.bars.labels.geometry.instanceCount;
      const src = W.entity(W.players[9].entity);
      ids.forEach((id, i) => b.__st.applyStatus(W, src, W.entity(id), a.kinds[i], 2));
      // a second CC under the first on fighter 0: the plate names the higher one (stun over root)
      b.__st.applyStatus(W, src, W.entity(ids[0]), 'root', 2);
      const alpha = [];
      for (let f = 0; f < 5; f++) {
        b.__step(1, 1 / 60);
        const L = R.bars.labels.geometry; const n = L.instanceCount; const t = L.getAttribute('ua3');
        // the plate is each fighter's last label; its tint alpha is the fade
        alpha.push({ ms: Math.round((f + 1) * 1000 / 60), labels: n, a: Array.from({ length: n }, (_, j) => +t.getW(j).toFixed(2)) });
      }
      return { ids, labels0, alpha, cells: R.bars.ccKind?.length ?? null, kinds: ids.map((id) => b.__H.view.entity(id)?.statuses.map((s) => s.kind)) };
    }, { kinds, ...spot });
    await B((b) => b.__step(6));
    const ccClip = await B((b, s) => { const c = b.screen(s.x, s.y, 2.6); return { x: Math.round(c.x - 640), y: Math.round(c.y - 170), width: 1280, height: 300 }; }, spot);
    await shot('cc_plates', ccClip);
    const after = await B((b) => b.renderer.bars.labels.geometry.instanceCount);
    report.cc = { ...r, labelsAfter: after, plates: after - r.labels0 };
    console.log(`cc plates: labels ${r.labels0} → ${after} (+${after - r.labels0} for ${kinds.length} CC'd fighters), fade ${r.alpha.map((x) => `${x.ms}ms`).join(' ')}`);
    if (after - r.labels0 !== kinds.length) fail(`cc: ${after - r.labels0} plates for ${kinds.length} CC'd fighters`);
    // the statuses run out on their own (clearing the list would leave the sim's control flags set)
    await B((b) => { b.__step(75); b.__park(); b.__step(5); });
  }

  // ── combat m-3: the landing flash of a wide area
  if (ONLY.includes('flash')) {
    for (const def of ['tunlan', 'burdam']) {
      const c = seat(def);
      const st = await stage(c.seat, 4.5);
      await B((b, a) => { const me = b.__H.view.entity(a.pv); b.__cmd(a.c, { type: 'cast', slot: 'ult', x: me.x, y: me.y, target: a.pv }); }, { ...st, c: c.seat });
      let best = null;
      for (let f = 1; f <= 60 && !best; f++) {
        const r = await B((b, a) => {
          b.__step(1);
          const R = b.renderer, tnow = R.time;
          const t = R.director.telegraphs.find((x) => x.src === a.pc && x.zone < 0 && x.stage === undefined);
          if (!t) return null;
          if (!(tnow >= t.land && tnow < t.end)) return { wait: true };
          const s = t.shape, r0 = s.radius ?? 1;
          const pts = [];
          if (s.kind === 'cone') {
            const P = (ang, d, k) => ({ k, x: t.x + Math.cos(ang) * d, y: t.y + Math.sin(ang) * d });
            const ha = (s.angle ?? 1) / 2, sn = Math.sin(ha), rho = (r0 * sn) / (1 + sn);
            // off the axis by a few degrees (the victim stands on it at 4.5 m and hides the ground behind it)
            pts.push(P(t.dir + 0.12, r0 * 0.3, 'middle'), P(t.dir - 0.1, r0 * 0.68, 'middle68'), P(t.dir + 0.1, r0 - 0.12, 'edgeBand'), P(t.dir - ha * 0.5, r0 - 0.15, 'edgeBand2'));
            // the contour: half the inscribed circle's depth in from the far arc
            pts.push(P(t.dir + 0.08, r0 - rho * 0.5, 'contour'));
          } else {
            const P = (ang, d, k) => ({ k, x: t.x + Math.cos(ang) * d, y: t.y + Math.sin(ang) * d });
            // east (toward the victim and past it) and west: the lane's walls cover the north and south arcs
            pts.push(P(0.3, r0 * 0.25, 'middle'), P(Math.PI - 0.2, r0 * 0.7, 'middle70'), P(0.22, r0 - 0.12, 'edgeBand'), P(-0.22, r0 - 0.15, 'edgeBand2'), P(0.15, r0 * 0.5, 'contour'));
          }
          return { f: 0, shape: { kind: s.kind, r: r0 }, alpha: b.__teleAt(pts) };
        }, st);
        if (r && !r.wait) { best = { ...r, f }; await shot(`flash_${def}`); }
      }
      if (!best) { fail(`${def}: no landing flash frame seen`); continue; }
      const A = Object.fromEntries(best.alpha.map((p) => [p.k, +(p.a / 255).toFixed(2)]));
      const middle = Math.max(...Object.entries(A).filter(([k]) => k.startsWith('middle')).map(([, v]) => v));
      const edge = Math.min(A.edgeBand, A.edgeBand2);
      report.flash.push({ def, frame: best.f, shape: best.shape, alpha: A, middleMax: middle, edgeMin: edge });
      console.log(`flash ${def.padEnd(7)} ${best.shape.kind} ${best.shape.r} m: middle ≤ ${middle}  edge band ≥ ${edge}  contour ${A.contour}`);
      if (middle > 0.225) fail(`${def}: landing fill ${middle} > 0.22 in the middle`);
      if (edge < 0.4) fail(`${def}: landing edge band ${edge} < 0.4`);
      await B((b) => { b.__park(); b.__step(60); });
    }
  }

  // ── combat m-1: how long a basic attack's impact reads
  if (ONLY.includes('hold')) {
    // Tunlan's shot: an ENEMY ranged magic attacker (the viewer's own team cannot strike it)
    for (const def of ['kemdo', 'rishal', 'tunlan']) {
      const c = seat(def);
      const ranged = def === 'tunlan';
      const st = await stage(c.seat, ranged ? 4.5 : 1.6);
      const geo = await B((b, a) => b.__h(a.pv), st);
      const box = { x0: geo.gx - 110, y0: geo.ty - 50, x1: geo.gx + 110, y1: geo.gy + 40 };
      await B((b, a) => {
        const fd = b.catalog.fighters.find((f) => f.id === a.def);
        b.__onlyIds = [fd.attack.present.hitVfx];
        b.__W.entity(a.pc).autoAttack = true; b.__cmd(a.c, { type: 'attack', target: a.pv });
      }, { ...st, c: c.seat, def });
      let hitF = -1; const counts = [], spans = [];
      const vH = Math.max(1, geo.gy - geo.hy);
      for (let f = 1; f <= 90 && (hitF < 0 || f - hitF <= 12); f++) {
        const r = await B((b, a) => {
          b.__step(1);
          const e = b.__W.entity(a.pv); e.hp = e.maxHp;
          const ev = b.__ev.splice(0).filter((x) => (x.e === 'damage' || x.e === 'hit') && x.src === a.pc && (!x.ability || x.ability === 'attack'));
          return { hit: ev.length > 0 };
        }, st);
        if (r.hit && hitF < 0) hitF = f;
        if (hitF > 0) {
          // stop the next swing from landing in the window
          if (f === hitF) await B((b, a) => { b.__W.entity(a.pc).autoAttack = false; b.__cmd(a.c, { type: 'stop' }); }, { ...st, c: c.seat });
          const px = await B((b, a) => b.__vfxPx(a.box), { box });
          counts.push(px.n); spans.push(+(px.ext / vH).toFixed(2));
          if (f - hitF === 3) await shot(`hold_${def}_f3`);
        }
      }
      await B((b) => { b.__onlyIds = null; });
      if (hitF < 0) { fail(`${def}: no basic-attack hit`); continue; }
      const peak = Math.max(...counts);
      let readF = 0; for (let i = 0; i < counts.length; i++) { if (counts[i] >= peak * 0.25) readF = i + 1; else if (i > 0) break; }
      // the gauge (r12 M5): a starburst of ≈ 0.7 × the victim's height for ≈ 200 ms. `sizeMs`: how long from the hit
      // the lit region spans ≥ 0.5 × the victim's height (the done gate, ≥ 200 ms); `readMs` (info): how long the lit
      // pixel count stays ≥ 25 % of its peak, a peak the 35 ms flash and the cut set on the hit frame; `eqd` the lit area
      // as a disc (a thin four-point glint reads larger than its area)
      let sizeF = 0; for (let i = 0; i < spans.length; i++) { if (spans[i] >= 0.5) sizeF = i + 1; else break; }
      const eqd = counts.map((n) => +(2 * Math.sqrt(n / Math.PI) / vH).toFixed(2));
      const res = { def, hitFrame: hitF, victimPx: Math.round(vH), counts, spans, eqd, peak, readMs: Math.round(readF * 1000 / 30), sizeMs: Math.round(sizeF * 1000 / 30), spanAtHit: spans[0] };
      report.hold.push(res);
      console.log(`hold ${def.padEnd(7)} px per frame from the hit ${counts.join(' ')}  reach/victim ${spans.join(' ')}  ≥0.5 for ${res.sizeMs} ms · disc/victim ${eqd.join(' ')} (count ≥25 % of peak ${res.readMs} ms)`);
      if (!BEFORE && res.sizeMs < 200) fail(`${def}: the impact reaches ≥ 0.5 × the victim for ${res.sizeMs} ms < 200`);
      await B((b) => { b.__park(); b.__step(30); });
    }
  }
  report.logs = logs.filter((l) => !/favicon|toNonIndexed|status of 404/.test(l)).slice(0, 20);
} catch (e) {
  fail(`harness error: ${e.stack ?? e.message}`);
} finally {
  writeFileSync(OUT, JSON.stringify(report, null, 1));
  await browser.close();
}
console.log(report.pass ? 'combat_polish: PASS' : `combat_polish: FAIL (${report.fails.length})`, '→', OUT);
process.exit(report.pass ? 0 : 1);
