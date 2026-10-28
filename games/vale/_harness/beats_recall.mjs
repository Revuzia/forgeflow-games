// VALE harness — combat F3 + F2 live check on the real renderer (render bench, real Chrome GPU, heavy slot):
//   ult     one exposure beat per ultimate cast: each caster casts its ultimate at a muted victim on clear lane stone,
//           96 frames at 30 Hz are stepped and the post chain's lift uniforms (vfx/screen.ts uLiftA) read every
//           frame (w = lift × − 1). `liftStarts` = frames where the strongest w crosses ≥ 1.3 (the beat itself, the
//           metric of final_combat_verify); `anyLiftStarts` = crossings of w ≥ 0.3 (any visible lift, stricter).
//           Done: Kemdo, Rishal, Hesmi and Tunlan exactly 1 of each; Vashil, whose tolls opt in with feel
//           exposureRepeat, 1 full beat and its later tolls at half the lift.
//   recall  the recall channel is visible for its whole length: a fighter recalls alone in view (an ally, then an
//           enemy, seen by seat 0); the pixels the VFX pass adds (VFX drawn vs not, same frame) inside a 240 px box are
//           counted every 0.5 s from the start to the 'done' and just after it (the departure). Done: > 0 at every
//           sample.
//   node _harness/beats_recall.mjs [ult,recall]   → _harness/_reports/fw_W1_beats_recall.json, _harness/_shots/fw_W1_recall_*.jpg
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { open } from './pw.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(HERE, '_shots'), REPS = join(HERE, '_reports');
mkdirSync(SHOTS, { recursive: true }); mkdirSync(REPS, { recursive: true });
const ONLY = (process.argv[2] ?? 'ult,recall').split(',');
const OUT = join(REPS, 'fw_W1_beats_recall.json');

const { browser, page, logs } = await open('/_harness/web/render_bench.html?mode=rift&q=high&t=420&dev=1&hud=0&manual=1&you=lisvel', { wait: false, hmr: false });
const report = { at: new Date().toISOString(), players: null, ult: [], recall: [], pass: true, fails: [] };
const fail = (m) => { report.pass = false; report.fails.push(m); console.log('FAIL', m); };
try {
  await page.waitForFunction(() => window.__VALE_BENCH__?.ready === true || window.__VALE_BENCH__?.error, null, { timeout: 300000 });
  const B = (fn, a) => page.evaluate(([src, x]) => (0, eval)(`(${src})`)(window.__VALE_BENCH__, x), [fn.toString(), a]);
  await B((b) => b.frames(2, 1 / 30));
  await page.waitForTimeout(8000);                     // models, textures
  await B((b) => b.frames(20, 1 / 30));
  await page.evaluate(async () => { window.__VALE_BENCH__.__sfx = await import('/src/render/vfx/screen.ts'); });
  // page-side helpers: muted seats, frozen waves, staging, the VFX-only pixel count
  report.players = await B((b) => {
    const R = b.renderer, H = b.host, W = H.sim.world;
    b.__W = W;
    b.__muted = new Set(W.players.map((_, i) => i));
    const orig = W.command.bind(W);
    W.command = (p, c) => { if (b.__allow || !b.__muted.has(p)) orig(p, c); };
    try { H.drivers.clear(); } catch { /* no drivers */ }
    b.__cmd = (p, c) => { b.__allow = true; try { H.sim.command(p, c); } finally { b.__allow = false; } };
    b.__ev = [];
    H.onEvents((evs) => { for (const e of evs) b.__ev.push(JSON.parse(JSON.stringify(e))); });
    // no new waves, standing Wicks sent home (a clear lane spot)
    W.systems[8] = W.systems[8].filter((f) => f.name !== 'waveSystem' && f.name !== 'minionSystem');
    const m = b.catalog.maps.find((x) => x.id === H.setup.map);
    let n = 0;
    for (const e of W.entities) if (e.kind === 'minion' && e.alive) { const sp = m.bases[e.team]?.spawn ?? [5, 5]; e.x = sp[0] + (e.team ? -3 : 3) + (n % 5) * 0.4; e.y = sp[1] - 4 + (n % 7); e.vx = e.vy = 0; n++; }
    b.__prep = (id, x, y, face) => {
      const e = W.entity(id); if (!e) return false;
      e.x = x; e.y = y; e.vx = 0; e.vy = 0; if (face !== undefined) e.facing = face;
      e.hp = e.maxHp; e.res = e.maxRes; e.shield = 0; e.statuses.length = 0;
      if (e.level < 13) e.level = 13;
      for (let i = 0; i < 4; i++) { const s = e.slots?.[i]; if (s) { s.rank = Math.max(s.rank, s.maxRank); s.cooldown = 0; if (s.maxCharges) s.charges = s.maxCharges; } }
      return true;
    };
    b.__park = () => { for (let p = 0; p < W.players.length; p++) b.__prep(W.players[p].entity, p < 5 ? 30 + p : 150, 40 + p); };
    b.__h = (id) => { const e = H.view.entity(id); const a = R.actors.get(id); const x = a ? a.x : e.x, y = a ? a.y : e.y; const g = b.screen(x, y, 0), t = b.screen(x, y, 2); return { gx: g.x, gy: g.y, ty: t.y }; };
    const gl = () => R.gl.getContext();
    b.__grab = () => { R.render(0); const c = gl(); const Wd = c.drawingBufferWidth, Hd = c.drawingBufferHeight; const px = new Uint8Array(Wd * Hd * 4); c.bindFramebuffer(c.FRAMEBUFFER, null); c.readPixels(0, 0, Wd, Hd, c.RGBA, c.UNSIGNED_BYTE, px); return { px, Wd, Hd }; };
    b.__vfxOnly = (box, thr = 24) => {
      const on = b.__grab(); const d = R.vfx.draw; R.vfx.draw = () => {}; let off; try { off = b.__grab(); } finally { R.vfx.draw = d; } R.render(0);
      const { Wd, Hd } = on; let k = 0;
      for (let y = Math.max(0, box.y0 | 0); y < Math.min(Hd, box.y1 | 0); y++) for (let x = Math.max(0, box.x0 | 0); x < Math.min(Wd, box.x1 | 0); x++) {
        const o = ((Hd - 1 - y) * Wd + x) * 4;
        if (Math.max(Math.abs(on.px[o] - off.px[o]), Math.abs(on.px[o + 1] - off.px[o + 1]), Math.abs(on.px[o + 2] - off.px[o + 2])) > thr) k++;
      }
      return k;
    };
    b.__lift = () => { const U = b.__sfx.screenUniforms; return U.uLiftA.value.reduce((mx, q) => Math.max(mx, q.w), 0); };
    b.__park();
    b.frames(10, 1 / 30);
    return W.players.map((p, i) => { const e = W.entity(p.entity); return { seat: i, def: e?.def, team: e?.team }; });
  });
  const spot = { x: 74, y: 55 };
  const seatOf = (def) => report.players.find((p) => p.def === def);
  const setCam = () => B((b, s) => { b.focus(s.x, s.y); b.zoom(b.catalog.maps.find((m) => m.id === b.host.setup.map).camera.distance); b.frames(4, 1 / 30); }, spot);
  await setCam();
  const clip = await B((b, s) => { const c = b.screen(s.x, s.y, 0); return { x: Math.round(c.x - 480), y: Math.round(c.y - 330), width: 960, height: 620 }; }, spot);
  const shot = (name) => page.screenshot({ path: join(SHOTS, `fw_W1_${name}.jpg`), clip, type: 'jpeg', quality: 88 });

  // ── combat F3: one beat per ultimate cast
  if (ONLY.includes('ult')) {
    for (const [def, want] of [['kemdo', 'one'], ['rishal', 'one'], ['hesmi', 'one'], ['tunlan', 'one'], ['vashil', 'repeat']]) {
      const c = seatOf(def);
      if (!c) { fail(`${def}: not seated in the bench`); continue; }
      const v = report.players.find((p) => p.team !== c.team);
      const st = await B((b, a) => {
        const W = b.__W, pc = W.players[a.c].entity, pv = W.players[a.v].entity;
        b.__park();
        b.__prep(pc, a.x - 2.25, a.y, 0); b.__prep(pv, a.x + 2.25, a.y, Math.PI);
        b.__cmd(a.c, { type: 'stop' }); b.__cmd(a.v, { type: 'stop' });
        b.frames(30, 1 / 30);
        b.__prep(pc, a.x - 2.25, a.y, 0); b.__prep(pv, a.x + 2.25, a.y, Math.PI);
        b.frames(2, 1 / 30);
        b.__ev.length = 0;
        const me = b.host.view.entity(pv);
        b.__cmd(a.c, { type: 'cast', slot: 'ult', x: me.x, y: me.y, target: pv });
        return { pc, pv };
      }, { c: c.seat, v: v.seat, ...spot });
      const rows = [];
      for (let f = 1; f <= 96; f++) {
        rows.push(await B((b, a) => {
          b.frames(1, 1 / 30);
          for (const id of [a.pc, a.pv]) { const e = b.__W.entity(id); if (e && e.alive) { e.hp = Math.max(e.hp, e.maxHp * 0.6); e.res = e.maxRes; } }
          const ev = b.__ev.splice(0).filter((e) => e.src === a.pc && (e.e === 'hit' || e.e === 'area' || e.e === 'cast')).map((e) => e.e);
          return { lift: +b.__lift().toFixed(3), ev };
        }, st));
      }
      const crossings = (k) => { const o = []; for (let i = 0; i < rows.length; i++) if (rows[i].lift >= k && (i === 0 || rows[i - 1].lift < k)) o.push(+((i + 1) / 30).toFixed(2)); return o; };
      const starts = crossings(1.3), any = crossings(0.3);
      const peaks = any.map((s) => { const i = Math.round(s * 30) - 1; return +(1 + Math.max(...rows.slice(i, i + 4).map((r) => r.lift))).toFixed(2); });
      const hits = rows.map((r, i) => (r.ev.includes('hit') ? i + 1 : 0)).filter(Boolean);
      const areas = rows.map((r, i) => (r.ev.includes('area') ? i + 1 : 0)).filter(Boolean);
      const res = { def, seat: c.seat, victim: v.def, liftStarts: starts, anyLiftStarts: any, peaks, hitFrames: hits, areaFrames: areas };
      report.ult.push(res);
      console.log(`ult ${def.padEnd(7)} lift starts ≥1.3 ${JSON.stringify(starts)} · any lift ${JSON.stringify(any)} peaks ×${JSON.stringify(peaks)}  hits f${hits.join(',')}  areas f${areas.join(',')}`);
      if (want === 'one' && (starts.length !== 1 || any.length !== 1)) fail(`${def}: ${starts.length} beats ≥ 1.3 / ${any.length} lifts (want exactly 1 of each)`);
      if (want === 'repeat' && (starts.length !== 1 || peaks[0] < Math.max(...peaks))) fail(`${def}: one full beat, the first toll the strongest`);
      await B((b) => { b.__park(); b.frames(60, 1 / 30); });
    }
  }

  // ── combat F2: the recall channel, start to done
  if (ONLY.includes('recall')) {
    for (const [tag, def] of [['ally', 'odrum'], ['enemy', 'kemdo']]) {
      const c = seatOf(def);
      if (!c) { fail(`${def}: not seated`); continue; }
      const rc = await B((b, a) => {
        const W = b.__W;
        b.__park();
        const me = W.players[0].entity;
        if (a.c !== 0) b.__prep(me, a.x - 5, a.y + 1.5, 0);   // seat 0 watches (its vision covers the spot)
        const id = W.players[a.c].entity;
        b.__prep(id, a.x, a.y, Math.PI / 2); b.__cmd(a.c, { type: 'stop' }); b.frames(45, 1 / 30);
        b.__prep(id, a.x, a.y, Math.PI / 2); b.frames(2, 1 / 30);
        b.__ev.length = 0; b.__cmd(a.c, { type: 'recall' });
        return { id };
      }, { c: c.seat, ...spot });
      await setCam();
      const box = await B((b, a) => { const h = b.__h(a.id); return { x0: h.gx - 120, y0: h.ty - 60, x1: h.gx + 120, y1: h.gy + 60 }; }, rc);
      const samples = [];
      let start = -1, done = -1;
      for (let f = 1; f <= 30 * 8.5; f++) {
        const r = await B((b, a) => {
          b.frames(1, 1 / 30);
          const e = b.host.view.entity(a.id);
          return { st: e?.state, dur: e ? +e.stateDuration.toFixed(2) : 0, ev: b.__ev.splice(0).filter((x) => x.e === 'recall').map((x) => x.state) };
        }, rc);
        if (r.ev.includes('start') && start < 0) start = f;
        if (r.ev.includes('done') || r.ev.includes('cancel')) done = f;
        const t = start > 0 ? (f - start) / 30 : -1;
        // every 0.5 s of the channel, and 2 frames after the done (the departure)
        const sampleNow = (start > 0 && done < 0 && (f - start) % 15 === 0 && r.st === 'recall') || (done > 0 && f === done + 2);
        if (sampleNow) {
          const px = await B((b, a) => b.__vfxOnly(a.box), { box });
          samples.push({ f, t: +t.toFixed(2), st: r.st, vfxPx: px, ev: r.ev });
          if ([15, 90, 180].includes(f - start) || f === done + 2) await shot(`recall_${tag}_${done > 0 ? 'departure' : `t${(f - start) / 30}`}`);
        }
        if (done > 0 && f > done + 3) break;
      }
      const channel = samples.filter((s) => s.st === 'recall');
      const minPx = channel.length ? Math.min(...channel.map((s) => s.vfxPx)) : 0;
      const dep = samples.find((s) => s.st !== 'recall');
      const res = { tag, def, seat: c.seat, startF: start, doneF: done, channelS: done > 0 ? +((done - start) / 30).toFixed(2) : null, samples, minChannelPx: minPx, departurePx: dep?.vfxPx ?? null };
      report.recall.push(res);
      console.log(`recall ${tag} (${def}) ${res.channelS} s: ${channel.map((s) => `${s.t}s:${s.vfxPx}`).join(' ')} | departure ${res.departurePx}`);
      if (done < 0) fail(`recall ${tag}: no done event`);
      if (!channel.length || minPx <= 0) fail(`recall ${tag}: a 0.5 s sample of the channel shows no VFX (min ${minPx} px)`);
      if (!(res.departurePx > 0)) fail(`recall ${tag}: no departure burst`);
      await B((b) => { b.__park(); b.frames(10, 1 / 30); });
    }
  }
  report.logs = logs.filter((l) => !/favicon|toNonIndexed/.test(l)).slice(0, 30);
} catch (e) {
  fail(`harness error: ${e.stack ?? e.message}`);
} finally {
  writeFileSync(OUT, JSON.stringify(report, null, 1));
  await browser.close();
}
console.log(report.pass ? 'beats_recall: PASS' : `beats_recall: FAIL (${report.fails.length})`, '→', OUT);
process.exit(report.pass ? 0 : 1);
