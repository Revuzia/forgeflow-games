// VALE harness — combat F6 gate (r12 M12 C1/R1): does every kit keep its signature hue IN PLAY?
//
// A live RIFT bot match in the render bench (real Chrome GPU, pw.mjs heavy slot). The probe builds its own match host
// in the page with the lineup it needs (ten kits a match), fast-forwards it 420 s, freezes the waves and mutes the
// bots. Each kit casts a1 and a2 as an ENEMY of the viewer (its team light is HARM marigold: the worst case for the
// HARM band) at a victim placed inside the slot's range (≤ 4.5 m). A few frames after release (release +1, +4, +7,
// +10 frames; the sample with the most VFX pixels is kept) the frame is drawn twice, VFX on and VFX off (telegraph
// layer hidden in both), and the light the VFX ADD (positive per-channel delta, so the ground's hue never leaks in
// through translucent dust) is classified inside a box around caster and victim:
//   n        pixels whose added luma ≥ 0.08
//   white    share of n with saturation < 0.3
//   sat      pixels with saturation ≥ 0.3
//   sig      share of `sat` within ±25° of the kit's signature hue   ← the gate: ≥ 0.5 on every a1 / a2
//   harm     share of `sat` in 20-55° (HARM marigold's band)
// Between slots every effect of the last cast ends (3.5 s, statuses cleared, VFX cleared), so a lingering zone of a1
// never counts for a2. The status looks (client.vfxStatus → lib_status_*: a unit's state drawn in THAT unit's
// relationship colour, the same for every kit that applies it) are off by default: they are not the kit's light
// (--status counts them too). From the cast to the last sample only the slot's own effects spawn: the VFX the slot
// names (its present / effect vfx ids: cast, wind-up, zone, projectile, hit) with the caster as their source. A unit
// reacting to the hit (the victim's passive), an item or boon proc, a bystander is dropped, so the light measured is
// the kit's.
//
//   node _harness/probe_kit_hue.mjs [--kits a,b,c] [--out <json>] [--shots <prefix>] [--gate 0.5] [--live] [--status]
//   --live   content/vfx.json as it stands on disk replaces the catalog's defs in the page (tuning without a rebuild)
//   exit 1 when any slot measured is under the gate.
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { open, SHOTS as SHOT_DIR } from './pw.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const GATE = +opt('gate', 0.5), OUT = opt('out', ''), SHOTS = opt('shots', ''), LIVE = args.includes('--live'), STATUS = args.includes('--status');
const all = readdirSync(join(HERE, '../content/fighters')).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort();
const kits = (opt('kits', '') || all.join(',')).split(',').filter(Boolean);
const SPOT = { x: 74, y: 55 };
const strip = (v) => (Array.isArray(v) ? v.map(strip) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => !k.startsWith('$')).map(([k, x]) => [k, strip(x)])) : v);
const liveDefs = LIVE ? strip(JSON.parse(readFileSync(join(HERE, '../content/vfx.json'), 'utf8'))) : null;

const { browser, page, logs } = await open('/_harness/web/render_bench.html?mode=rift&q=high&t=0&dev=1&hud=0&manual=1', { wait: false, hmr: false });
await page.waitForFunction(() => window.__VALE_BENCH__?.ready === true || window.__VALE_BENCH__?.error, null, { timeout: 300000 });
const B = (fn, a) => page.evaluate(([src, x]) => (0, eval)(`(${src})`)(window.__VALE_BENCH__, x), [fn.toString(), a]);
if (liveDefs) {
  const r = await B(async (b, defs) => {
    const { VfxDef } = await import('/src/contracts/catalog.ts');
    const parsed = defs.map((d) => VfxDef.parse(d));
    b.renderer.vfx.redefine(parsed);
    return parsed.length;
  }, liveDefs);
  console.log(`live vfx defs: ${r}`);
}
// page-side helpers on the CURRENT host (b.__H), which the probe builds per batch
await B((b, status) => {
  const R = b.renderer;
  if (!status) R.director.statusVfx = {};
  // the caster-only window (b.__only = the caster's entity id; -1 = everything spawns)
  b.__only = -1;
  const spawn0 = R.vfx.spawnHandle.bind(R.vfx);
  b.__ids = new Set();
  R.vfx.spawnHandle = (id, o) => (b.__only >= 0 && (o?.sourceId !== b.__only || !b.__ids.has(id)) ? 0 : spawn0(id, o));
  b.__step = (n = 1, dt = 1 / 30) => { for (let i = 0; i < n; i++) { b.__H.pump(dt); R.render(dt); } };
  b.__grab = () => { R.render(0); const gl = R.gl.getContext(); const Wd = gl.drawingBufferWidth, Hd = gl.drawingBufferHeight; const px = new Uint8Array(Wd * Hd * 4); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, Wd, Hd, gl.RGBA, gl.UNSIGNED_BYTE, px); return { px, Wd, Hd }; };
  b.__vfxHue = (box, sigH) => {
    const tv = R.overlay.teleScene.visible; R.overlay.teleScene.visible = false;
    const on = b.__grab(); const d = R.vfx.draw; R.vfx.draw = () => {}; let off; try { off = b.__grab(); } finally { R.vfx.draw = d; R.overlay.teleScene.visible = tv; } R.render(0);
    const { Wd, Hd } = on; let n = 0, ns = 0, harm = 0, sig = 0, white = 0; const bins = new Array(12).fill(0);
    for (let y = Math.max(0, box.y0 | 0); y < Math.min(Hd, box.y1 | 0); y++) for (let x = Math.max(0, box.x0 | 0); x < Math.min(Wd, box.x1 | 0); x++) {
      const o = ((Hd - 1 - y) * Wd + x) * 4;
      const r = Math.max(0, on.px[o] - off.px[o]) / 255, g = Math.max(0, on.px[o + 1] - off.px[o + 1]) / 255, bl = Math.max(0, on.px[o + 2] - off.px[o + 2]) / 255;
      if (0.2126 * r + 0.7152 * g + 0.0722 * bl < 0.08) continue; n++;
      const mx = Math.max(r, g, bl), mn = Math.min(r, g, bl); const s = mx > 0 ? (mx - mn) / mx : 0;
      if (s < 0.3) { white++; continue; }
      ns++;
      let h; if (mx === r) h = ((g - bl) / (mx - mn)) % 6; else if (mx === g) h = (bl - r) / (mx - mn) + 2; else h = (r - g) / (mx - mn) + 4; h = (h * 60 + 360) % 360;
      bins[Math.floor(h / 30)]++;
      if (h >= 20 && h <= 55) harm++;
      const dh = Math.min(Math.abs(h - sigH), 360 - Math.abs(h - sigH)); if (dh <= 25) sig++;
    }
    return { n, sat: ns, sig: +(sig / Math.max(1, ns)).toFixed(3), harm: +(harm / Math.max(1, ns)).toFixed(3), white: +(white / Math.max(1, n)).toFixed(3), bins30: bins };
  };
}, STATUS);

const rows = [];
for (let b0 = 0; b0 < kits.length; b0 += 10) {
  const batch = kits.slice(b0, b0 + 10);
  const seats = new Array(10).fill('');
  batch.forEach((k, i) => { seats[i < 5 ? 5 + i : i - 5] = k; });
  const spare = all.filter((k) => !batch.includes(k));
  for (let i = 0; i < 10; i++) if (!seats[i]) seats[i] = spare.shift() ?? '';
  // a match host of our own with this lineup (the bench's own host keeps its default lineup)
  const players = await B(async (b, picks) => {
    const { LocalMatchHost } = await import('/src/session/match_host.ts');
    const { createBots } = await import('/src/sim/bots/index.ts');
    const cat = b.catalog;
    const base = b.host.setup;
    const setup = { ...base, matchId: `kit-hue-${picks.join('-')}`, seats: base.seats.map((s, i) => {
      const fighter = picks[i] || s.fighter;
      const skin = cat.skins.find((k) => k.fighter === fighter && k.tier === 'base')?.id ?? cat.skins.find((k) => k.fighter === fighter)?.id ?? '';
      return { ...s, fighter, skin };
    }) };
    const h = new LocalMatchHost(cat, setup, 0, { bots: createBots(cat, setup), autopilot: true, maxTimeScale: 16, pregameSeconds: 0 });
    h.start();
    h.setTimeScale(16);
    let guard = 0; while (h.view.time < 420 && !h.ended && guard++ < 100000) h.pump(0.25);
    h.setTimeScale(1);
    await b.renderer.preload(setup);
    b.renderer.setScene(h);
    b.__H = h;
    const W = h.sim.world;
    b.__W = W;
    b.__muted = new Set(W.players.map((_, i) => i));
    const orig = W.command.bind(W); W.command = (p, c) => { if (b.__allow || !b.__muted.has(p)) orig(p, c); };
    try { h.drivers.clear(); } catch { /* none */ }
    b.__cmd = (p, c) => { b.__allow = true; try { h.sim.command(p, c); } finally { b.__allow = false; } };
    // no new waves and no minion AI (every phase); the standing minions are sent home before every cast
    // (b.__clear), so no Wick's shot or glow lands in the box
    for (let i = 0; i < W.systems.length; i++) W.systems[i] = W.systems[i].filter((f) => f.name !== 'waveSystem' && f.name !== 'minionSystem');
    const m = cat.maps.find((x) => x.id === setup.map);
    b.__clear = () => { let n = 0; for (const e of W.entities) if (e.kind === 'minion' && e.alive) { const sp = m.bases[e.team]?.spawn ?? [5, 5]; e.x = sp[0] + (e.team ? -3 : 3) + (n % 5) * 0.4; e.y = sp[1] - 4 + (n % 7); e.vx = e.vy = 0; n++; } return n; };
    b.__clear();
    b.__prep = (id, x, y, face) => {
      const e = W.entity(id); if (!e) return false;
      if (!e.alive) return false;
      e.x = x; e.y = y; e.vx = 0; e.vy = 0; if (face !== undefined) e.facing = face;
      e.hp = e.maxHp; e.res = e.maxRes; e.shield = 0; e.statuses.length = 0; if (e.level < 13) e.level = 13;
      for (let i = 0; i < 4; i++) { const s = e.slots?.[i]; if (s) { s.rank = Math.max(s.rank, s.maxRank); s.cooldown = 0; if (s.maxCharges) s.charges = s.maxCharges; } }
      return true;
    };
    b.__park = (p) => { b.__prep(W.players[p].entity, p < 5 ? 20 + p : 150 - p, 55); };
    b.__freshen = (ids) => { for (const id of ids) { const e = W.entity(id); if (e && e.alive) { e.hp = Math.max(e.hp, e.maxHp * 0.6); e.res = e.maxRes; } } };
    b.__h = (id) => { const e = h.view.entity(id); const a = b.renderer.actors.get(id); const x = a ? a.x : e.x, y = a ? a.y : e.y; const hh = e.height > 0 ? e.height : 2; const g = b.screen(x, y, 0), t = b.screen(x, y, hh); return { gx: g.x, gy: g.y, tx: t.x, ty: t.y }; };
    return W.players.map((p, i) => ({ seat: i, def: W.entity(p.entity)?.def, team: W.entity(p.entity)?.team }));
  }, seats);
  await page.waitForTimeout(9000);
  await B((b) => b.__step(20));
  const hueOf = (hex) => { const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, bl = parseInt(hex.slice(5, 7), 16) / 255; const mx = Math.max(r, g, bl), mn = Math.min(r, g, bl); if (mx === mn) return 0; let h; if (mx === r) h = ((g - bl) / (mx - mn)) % 6; else if (mx === g) h = (bl - r) / (mx - mn) + 2; else h = (r - g) / (mx - mn) + 4; return (h * 60 + 360) % 360; };
  const kitInfo = await B((b) => Object.fromEntries(b.catalog.fighters.map((f) => [f.id, { sig: f.vfx?.signature ?? null, ct: { a1: f.kit.a1.castTime ?? 0, a2: f.kit.a2.castTime ?? 0 }, range: { a1: f.kit.a1.targeting?.range ?? 0, a2: f.kit.a2.targeting?.range ?? 0 } }])));
  const views = [{ name: 'A', you: 0, casters: [5, 6, 7, 8, 9], victim: 0 }, { name: 'B', you: 5, casters: [0, 1, 2, 3, 4], victim: 5 }];
  for (const v of views) {
    const casters = v.casters.filter((cp) => batch.includes(players[cp].def));
    if (!casters.length) continue;
    if (v.you !== 0) {
      await B((b, you) => { const proxy = Object.create(b.__H, { you: { value: you } }); b.renderer.setScene(proxy); b.__step(2); }, v.you);
      await page.waitForTimeout(8000);
      await B((b) => b.__step(20));
    }
    await B((b, s) => { for (let p = 0; p < 10; p++) b.__park(p); b.focus(s.x, s.y); b.zoom(b.catalog.maps.find((x) => x.id === b.__H.setup.map).camera.distance); b.__step(6); }, SPOT);
    for (const cp of casters) {
      const fid = players[cp].def; const info = kitInfo[fid]; const sh = hueOf(info.sig);
      for (const slot of ['a1', 'a2']) {
        const rg = info.range[slot];
        const dist = rg > 0 ? Math.max(1.5, Math.min(4.5, rg - 0.4)) : 4.5;
        const st = await B((b, a) => {
          const W = b.__W;
          // from the staging on, only this slot's own VFX from this caster spawn (an item or boon proc while the
          // pair is set up would linger into the samples)
          const f = b.catalog.fighters.find((x) => x.id === a.fid);
          b.__ids = new Set([...JSON.stringify(f.kit[a.slot]).matchAll(/"[a-zA-Z]*[vV]fx":"([^"]+)"/g)].map((m) => m[1]));
          b.__only = W.players[a.cp].entity;
          const stage = () => {
            const pc = W.players[a.cp].entity, pv = W.players[a.vp].entity;
            b.__prep(pc, a.x - a.d / 2, a.y, 0); b.__prep(pv, a.x + a.d / 2, a.y, Math.PI);
            b.__cmd(a.cp, { type: 'stop' }); b.__cmd(a.vp, { type: 'stop' });
            return { pc, pv };
          };
          b.__clear(); stage(); b.__step(30); b.__clear(); const r = stage(); b.__step(2); return r;
        }, { cp, vp: v.victim, x: SPOT.x, y: SPOT.y, d: dist, fid, slot });
        await B((b, a) => {
          b.renderer.vfx.clear(); const me = b.__H.view.entity(a.pv); b.__cmd(a.cp, { type: 'cast', slot: a.slot, x: me.x, y: me.y, target: a.pv }); }, { ...st, cp, slot, fid });
        const rel = Math.max(1, Math.round(info.ct[slot] * 30));
        const best = { n: -1 };
        for (let f = 1; f <= rel + 12; f++) {
          await B((b, a) => { b.__step(1); b.__freshen([a.pc, a.pv]); }, st);
          if (f >= rel + 1 && (f - rel) % 3 === 1) {
            const m = await B((b, a) => { const c = b.__h(a.pc), w = b.__h(a.pv); return b.__vfxHue({ x0: Math.min(c.gx, w.gx) - 220, y0: Math.min(c.ty, w.ty) - 120, x1: Math.max(c.gx, w.gx) + 220, y1: Math.max(c.gy, w.gy) + 120 }, a.sh); }, { ...st, sh });
            if (m.n > best.n) {
              Object.assign(best, m, { f });
              if (SHOTS) {
                const box = await B((b, a) => { const c = b.__h(a.pc), w = b.__h(a.pv); return { x: Math.round(Math.min(c.gx, w.gx) - 220), y: Math.round(Math.min(c.ty, w.ty) - 120) }; }, st);
                mkdirSync(SHOT_DIR, { recursive: true });
                await page.screenshot({ path: join(SHOT_DIR, `${SHOTS}_${fid}_${slot}.png`), clip: { x: Math.max(0, Math.min(1200, box.x)), y: Math.max(0, Math.min(660, box.y)), width: 720, height: 420 } });
              }
            }
          }
        }
        const row = { fid, slot, view: v.name, sigHex: info.sig, sigHue: Math.round(sh), dist, f: best.f, n: best.n, sat: best.sat, sig: best.sig, harm: best.harm, white: best.white, bins30: best.bins30, pass: best.sig >= GATE };
        rows.push(row);
        console.log(`${row.pass ? 'PASS' : 'FAIL'} ${fid.padEnd(8)} ${slot} sigH ${String(row.sigHue).padStart(3)} sig ${row.sig} harm ${row.harm} white ${row.white} n ${row.n} sat ${row.sat} bins ${row.bins30?.join(' ')}`);
        // every effect of this cast ends before the next one: zones run out, statuses go, the VFX are cleared
        await B((b, a) => { b.__only = -1; b.__step(105); for (const id of [a.pc, a.pv]) { const e = b.__W.entity(id); if (e) e.statuses.length = 0; } b.renderer.vfx.clear(); b.__step(3); }, st);
      }
      await B((b, p) => b.__park(p), cp);
    }
  }
}
const fails = rows.filter((r) => !r.pass);
const out = { gate: GATE, live: LIVE, status: STATUS, kits, slots: rows.length, fails: fails.map((r) => `${r.fid}.${r.slot}`), minSig: rows.length ? Math.min(...rows.map((r) => r.sig)) : null, rows, logs: logs.filter((l) => !/favicon|toNonIndexed|status of 404/.test(l)).slice(0, 8) };
console.log(JSON.stringify({ ...out, rows: undefined }));
if (OUT) writeFileSync(OUT, JSON.stringify(out, null, 1));
await browser.close();
process.exit(fails.length || !rows.length ? 1 : 0);
