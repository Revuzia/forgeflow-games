// VALE harness — live kit capture (critic combat-16; the closing combat review's kit capture, kept in the repo): full
// kits of up to five fighters cast as ENEMIES of the viewer in a live RIFT bot match (render bench, real Chrome GPU,
// pw.mjs heavy slot). Per cast: telegraph lead (teleFirst) + layer px, anticipation px on frames 2 and 4 (antic), the
// exposure lift envelope (liftMax, liftFrames, liftStarts), camera jitter, distortion frames, the victim's flash
// (flashMax), CC plates, the victim box's white share, and an 18-cell contact sheet. Also own-aim sheets, basic
// attacks, recall, death (ally + own death grade) when asked with --only.
// content/vfx.json and content/skins on disk replace the catalog's (the dev catalog may be stale; --catalog keeps it).
//
//   node _harness/probe_kit_capture.mjs --picks <10 fighters, seats 0-9> --watch <the team-1 fighters to cast>
//        [--only kits,aim,attack,recall,death] [--tag <name>]   → _harness/_reports/<tag>_kits.json, sheets _harness/_shots/<tag>_kit_*.jpg
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { open } from './pw.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = `${ROOT}/_harness/_shots`, REPS = `${ROOT}/_harness/_reports`;
mkdirSync(SHOTS, { recursive: true });
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const PICKS = opt('picks', 'lisvel,ulkro,vashil,ervet,odrum,marund,ilsheta,sukri,nurrow,dunsom');
const WATCH = opt('watch', 'marund,ilsheta,sukri,nurrow,dunsom').split(',');
const ONLY = opt('only', 'kits').split(',');
const TAG = opt('tag', 'fw_CW1_capture');
const strip = (v) => (Array.isArray(v) ? v.map(strip) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => !k.startsWith('$')).map(([k, x]) => [k, strip(x)])) : v);
const LIVE = !args.includes('--catalog');
const liveDefs = LIVE ? strip(JSON.parse(readFileSync(join(ROOT, 'content/vfx.json'), 'utf8'))) : null;
const liveSkins = LIVE ? readdirSync(join(ROOT, 'content/skins')).filter((f) => f.endsWith('.json')).flatMap((f) => strip(JSON.parse(readFileSync(join(ROOT, 'content/skins', f), 'utf8')))) : null;
const report = { at: new Date().toISOString(), picks: PICKS, casts: [], aim: [], attack: [], recall: null, death: null, logs: [] };

const { browser, page, logs } = await open(`/_harness/web/render_bench.html?mode=rift&q=high&t=420&dev=1&hud=0&manual=1&picks=${PICKS}`, { wait: false, hmr: false });
const B = (fn, a) => page.evaluate(([src, x]) => (0, eval)(`(${src})`)(window.__VALE_BENCH__, x), [fn.toString(), a]);
const saveSheet = async (name) => {
  const url = await B((b) => b.__sheetOut());
  const buf = Buffer.from(url.split(',')[1], 'base64');
  const p = `${SHOTS}/${TAG}_${name}.jpg`; writeFileSync(p, buf); return p;
};
try {
  await page.waitForFunction(() => window.__VALE_BENCH__?.ready === true || window.__VALE_BENCH__?.error, null, { timeout: 300000 });
  if (liveDefs) await B(async (b, [defs, skins]) => {
    const { VfxDef } = await import('/src/contracts/catalog.ts');
    b.renderer.vfx.redefine(defs.map((d) => VfxDef.parse(d)));
    for (const s of skins) { const k = b.catalog.skins.find((x) => x.id === s.id); if (k) { if (s.vfx) k.vfx = s.vfx; else delete k.vfx; } }
  }, [liveDefs, liveSkins]);
  await B((b) => b.frames(2, 1 / 30));
  await page.waitForTimeout(9000);
  await B((b) => b.frames(20, 1 / 30));
  report.players = await B(async (b) => {
    const R = b.renderer, H = b.host, W = H.sim.world; b.__W = W;
    const { aimSpec, isHelpful, reachOf } = await import('/src/input/abilities.ts');
    b.__aimSpec = aimSpec; b.__isHelpful = isHelpful; b.__reachOf = reachOf;
    b.__muted = new Set(W.players.map((_, i) => i));
    const orig = W.command.bind(W); W.command = (p, c) => { if (b.__allow || !b.__muted.has(p)) orig(p, c); };
    try { H.drivers.clear(); } catch { /* none */ }
    b.__cmd = (p, c) => { b.__allow = true; try { H.sim.command(p, c); } finally { b.__allow = false; } };
    for (let i = 0; i < W.systems.length; i++) W.systems[i] = W.systems[i].filter((f) => f.name !== 'waveSystem' && f.name !== 'minionSystem');
    const m = b.catalog.maps.find((x) => x.id === H.setup.map); b.__mapDef = m;
    b.__clear = () => { let n = 0; for (const e of W.entities) if ((e.kind === 'minion' || e.kind === 'monster') && e.alive) { const sp = m.bases[e.team]?.spawn ?? [5, 5]; e.x = sp[0] + (e.team ? -3 : 3) + (n % 5) * 0.4; e.y = sp[1] - 4 + (n % 7); e.vx = e.vy = 0; n++; } };
    b.__prep = (id, x, y, face) => {
      const e = W.entity(id); if (!e) return false;
      if (!e.alive) { e.alive = true; e.hp = e.maxHp; e.state = 'idle'; }
      e.x = x; e.y = y; e.vx = 0; e.vy = 0; if (face !== undefined) e.facing = face;
      e.hp = e.maxHp; e.res = e.maxRes; e.shield = 0; e.statuses.length = 0; e.autoAttack = false;
      if (e.level < 13) e.level = 13;
      for (let i = 0; i < 4; i++) { const s = e.slots?.[i]; if (s) { s.rank = Math.max(s.rank, s.maxRank); s.cooldown = 0; if (s.maxCharges) s.charges = s.maxCharges; } }
      return true;
    };
    b.__park = (except = []) => { for (let p = 0; p < W.players.length; p++) if (!except.includes(p)) b.__prep(W.players[p].entity, p < 5 ? 30 + p : 150 + p, 40 + p); };
    b.__ev = []; H.onEvents((evs) => { for (const e of evs) b.__ev.push(JSON.parse(JSON.stringify(e))); });
    // post-chain uniforms (the instance the renderer runs)
    const effs = [];
    for (const k of Object.keys(R.post)) { const v = R.post[k]; if (v && Array.isArray(v.effects)) effs.push(...v.effects); }
    const find = (n) => effs.find((e) => e.name === n);
    b.__U = { lift: find('ValeExposure')?.uniforms.get('uLiftA'), expo: find('ValeExposure')?.uniforms.get('uExpo'), sat: find('ValeGrade')?.uniforms.get('uSat'), val: find('ValeGrade')?.uniforms.get('uVal'), dist: find('ValeDistort')?.uniforms.get('uDistortOn') };
    b.__effNames = effs.map((e) => e.name);
    const glc = () => R.gl.getContext();
    b.__grab = () => { R.render(0); const c = glc(); const Wd = c.drawingBufferWidth, Hd = c.drawingBufferHeight; const px = new Uint8Array(Wd * Hd * 4); c.bindFramebuffer(c.FRAMEBUFFER, null); c.readPixels(0, 0, Wd, Hd, c.RGBA, c.UNSIGNED_BYTE, px); return { px, Wd, Hd }; };
    const luma = (r, g, bl) => 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    b.__luma = luma;
    // px the VFX pass adds in a box (on vs off), with hue of the saturated ones
    b.__vfxOnly = (box, thr = 20) => {
      const on = b.__grab(); const d = R.vfx.draw; R.vfx.draw = () => {}; let off; try { off = b.__grab(); } finally { R.vfx.draw = d; } R.render(0);
      const { Wd, Hd } = on; let n = 0, white = 0, ns = 0; const bins = new Array(12).fill(0);
      for (let y = Math.max(0, box.y0 | 0); y < Math.min(Hd, box.y1 | 0); y++) for (let x = Math.max(0, box.x0 | 0); x < Math.min(Wd, box.x1 | 0); x++) {
        const o = ((Hd - 1 - y) * Wd + x) * 4;
        const dd = Math.max(on.px[o] - off.px[o], on.px[o + 1] - off.px[o + 1], on.px[o + 2] - off.px[o + 2]);
        if (dd <= thr) continue; n++;
        const r = on.px[o] / 255, g = on.px[o + 1] / 255, bl = on.px[o + 2] / 255; const mx = Math.max(r, g, bl), mn = Math.min(r, g, bl); const s = mx > 0 ? (mx - mn) / mx : 0;
        if (s < 0.3) { white++; continue; }
        ns++; let h; if (mx === r) h = ((g - bl) / (mx - mn)) % 6; else if (mx === g) h = (bl - r) / (mx - mn) + 2; else h = (r - g) / (mx - mn) + 4; h = (h * 60 + 360) % 360; bins[Math.floor(h / 30)]++;
      }
      return { n, white: +(white / Math.max(1, n)).toFixed(2), sat: ns, bins30: bins };
    };
    // telegraph layer px (alpha > 0)
    b.__telePx = () => {
      const gl = R.gl; const ctx = R.overlay; const T = ctx.teleTarget ?? ctx['teleTarget'];
      const RT = new (T.constructor)(1920, 1080);
      gl.setRenderTarget(RT); gl.setClearColor(0x000000, 0); gl.clear(true, true, false);
      const ac = gl.autoClear; gl.autoClear = false; gl.render(ctx.teleScene, R.rig.camera); gl.autoClear = ac; gl.setRenderTarget(null);
      const buf = new Uint8Array(1920 * 1080 * 4); gl.readRenderTargetPixels(RT, 0, 0, 1920, 1080, buf); RT.dispose();
      let n = 0; for (let i = 3; i < buf.length; i += 4) if (buf[i] > 0) n++; return n;
    };
    // body whiteness of an actor box (full frame)
    b.__white = (g, box) => { const { px, Wd, Hd } = g; let w = 0, n = 0; for (let y = Math.max(0, box.y0 | 0); y < Math.min(Hd, box.y1 | 0); y++) for (let x = Math.max(0, box.x0 | 0); x < Math.min(Wd, box.x1 | 0); x++) { const o = ((Hd - 1 - y) * Wd + x) * 4; const l = luma(px[o], px[o + 1], px[o + 2]); const c = Math.max(px[o], px[o + 1], px[o + 2]) - Math.min(px[o], px[o + 1], px[o + 2]); n++; if (l > 225 && c < 30) w++; } return +(w / Math.max(1, n)).toFixed(3); };
    b.__h = (id) => { const a = R.actors.get(id); const e = H.view.entity(id); const x = a ? a.x : e.x, y = a ? a.y : e.y; const g = b.screen(x, y, 0), t = b.screen(x, y, a?.artHeight ?? 1.9); return { gx: g.x, gy: g.y, ty: t.y }; };
    // contact sheet
    b.__sheet = (cols, rows, cw, ch) => { const c = document.createElement('canvas'); c.width = cols * cw; c.height = rows * ch; const x = c.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, c.width, c.height); b.__S = { c, x, cols, cw, ch, i: 0 }; };
    b.__cell = (crop, label) => {
      const S = b.__S; R.render(0); const src = R.gl.domElement;
      const col = S.i % S.cols, row = Math.floor(S.i / S.cols); S.i++;
      S.x.drawImage(src, crop.x, crop.y, crop.w, crop.h, col * S.cw, row * S.ch, S.cw, S.ch);
      S.x.fillStyle = 'rgba(0,0,0,0.6)'; S.x.fillRect(col * S.cw, row * S.ch, S.cw, 22);
      S.x.fillStyle = '#fff'; S.x.font = '15px monospace'; S.x.fillText(label, col * S.cw + 6, row * S.ch + 16);
    };
    b.__sheetOut = () => b.__S.c.toDataURL('image/jpeg', 0.86);
    b.__labels = () => { const bl = R.bars ?? R.overlay?.bars; return bl?.labelCount ?? null; };
    b.__rec = (ids) => {
      const v = H.view; const c = R.rig.camera.position; const U = b.__U;
      const out = { t: +v.time.toFixed(3), cam: [c.x, c.y, c.z], vfx: R.stats().vfx,
        tele: R.director.telegraphs.map((t) => ({ st: t.stage ?? '', k: t.shape.kind, src: t.src, lead: +(t.land - t.start).toFixed(3) })),
        lift: U.lift ? Math.max(0, ...U.lift.value.map((q) => q.w)) : null, expo: U.expo?.value ?? null, dist: U.dist?.value ?? null, u: {} };
      for (const id of ids) { const e = v.entity(id); const a = R.actors.get(id); if (e) out.u[id] = { st: e.state, hp: Math.round(e.hp), sts: e.statuses.map((s) => s.kind), fl: a ? +a.flashLevel.toFixed(3) : null }; }
      return out;
    };
    return W.players.map((p, i) => { const e = W.entity(p.entity); return { seat: i, id: p.entity, def: e.def, team: e.team }; });
  });
  report.effects = await B((b) => b.__effNames);
  console.log('players', report.players.map((p) => `${p.seat}:${p.def}/t${p.team}`).join(' '), 'effects', report.effects.join(','));
  const spot = { x: 74, y: 55 };
  const seatOf = (def) => report.players.find((p) => p.def === def);
  const viewer = report.players[0];
  const ally = report.players[1];
  await B((b, s) => { b.__clear(); b.__park(); b.focus(s.x, s.y); b.zoom(b.__mapDef.camera.distance); b.frames(10, 1 / 30); }, spot);
  const SAMPLE = [0, 1, 2, 3, 5, 7, 9, 11, 13, 15, 18, 21, 24, 28, 33, 40, 50, 65];

  // ── enemy kits ───────────────────────────────────────────────────────────────────────────────
  if (ONLY.includes('kits')) for (const fid of WATCH) {
    const c = seatOf(fid); if (!c) { console.log('no seat for', fid); continue; }
    for (const slot of ['a1', 'a2', 'a3', 'ult']) {
      const st = await B((b, a) => {
        const W = b.__W, R = b.renderer, H = b.host;
        const f = b.catalog.fighters.find((x) => x.id === a.fid); const ab = f.kit[a.slot];
        const helpful = b.__isHelpful(ab);
        const reach = b.__reachOf(ab) || ab.targeting?.range || 4;
        const d = Math.max(2.2, Math.min(4.6, reach * 0.75));
        b.__clear(); b.__park([a.c, 0, 1]);
        b.__prep(a.cid, a.x - d / 2, a.y, 0); b.__prep(a.vid, a.x + d / 2, a.y, Math.PI); b.__prep(a.aid, a.x + d / 2 + 1.0, a.y + 1.6, Math.PI);
        b.__cmd(a.c, { type: 'stop' }); b.__cmd(0, { type: 'stop' }); b.__cmd(1, { type: 'stop' });
        R.vfx.clear(); b.frames(24, 1 / 30);
        b.__prep(a.cid, a.x - d / 2, a.y, 0); b.__prep(a.vid, a.x + d / 2, a.y, Math.PI); b.__prep(a.aid, a.x + d / 2 + 1.0, a.y + 1.6, Math.PI);
        R.vfx.clear(); b.frames(2, 1 / 30);
        const hc = b.__h(a.cid), hv = b.__h(a.vid);
        const mx = (hc.gx + hv.gx) / 2, my = (hc.gy + hv.gy) / 2 - 60;
        const crop = { x: Math.round(mx - 480), y: Math.round(my - 300), w: 960, h: 560 };
        b.__sheet(6, 3, 480, 280);
        b.__ev.length = 0;
        const me = H.view.entity(helpful ? a.cid : a.vid);
        b.__cmd(a.c, { type: 'cast', slot: a.slot, x: me.x, y: me.y, target: me.id });
        return { name: ab.name, id: ab.id, castTime: ab.castTime ?? 0, helpful, d, crop, hc, hv, tele: ab.present?.telegraph ?? null };
      }, { fid, slot, c: c.seat, cid: c.id, vid: viewer.id, aid: ally.id, x: spot.x, y: spot.y });
      const rec = { fighter: fid, slot, ...st, frames: [], antic: null, telePx: [], whiteMax: 0 };
      const cam0 = null;
      for (let f = 0; f <= 65; f++) {
        const r = await B((b, a) => {
          b.frames(1, 1 / 30);
          const o = b.__rec([a.cid, a.vid]);
          if (a.sample) b.__cell(a.crop, `${a.fid} ${a.slot} f${a.f} ${(a.f / 30 * 1000) | 0}ms`);
          if (a.f === 2 || a.f === 4) { const hc = b.__h(a.cid); o.antic = b.__vfxOnly({ x0: hc.gx - 110, y0: hc.ty - 70, x1: hc.gx + 110, y1: hc.gy + 30 }); }
          if (a.f === 1 || a.f === 4 || a.f === 8 || a.f === 14) o.telePx = b.__telePx();
          if (a.f >= 3 && a.f % 3 === 0) { const hv = b.__h(a.vid); const g = b.__grab(); o.vWhite = b.__white(g, { x0: hv.gx - 30, y0: hv.ty - 8, x1: hv.gx + 30, y1: hv.gy }); }
          return o;
        }, { f, sample: SAMPLE.includes(f), crop: st.crop, fid, slot, cid: c.id, vid: viewer.id });
        rec.frames.push(r);
      }
      rec.events = await B((b) => b.__ev.filter((e) => ['cast', 'area', 'hit', 'status', 'dash', 'projectile', 'blink'].includes(e.e)).map((e) => ({ e: e.e, t: +e.t.toFixed(3), ab: e.ability, st: e.status, dur: e.duration, delay: e.delay, tg: e.telegraph, shape: e.shape?.kind, dst: e.dst })).slice(0, 40));
      rec.sheet = await saveSheet(`kit_${fid}_${slot}`);
      // summaries
      const fr = rec.frames;
      const t0 = fr[0].t;
      rec.summary = {
        teleFirst: (() => { const i = fr.findIndex((x) => x.tele.length > 0); return i < 0 ? null : { f: i, ms: Math.round(i * 33.3), lead: fr[i].tele.map((t) => `${t.st}:${t.k}:${t.lead}`) }; })(),
        telePx: fr.filter((x) => x.telePx !== undefined).map((x) => x.telePx),
        antic: fr.filter((x) => x.antic).map((x) => x.antic.n),
        liftMax: Math.max(...fr.map((x) => x.lift ?? 0)),
        liftFrames: fr.filter((x) => (x.lift ?? 0) >= 1.3).length,
        liftStarts: fr.map((x, i) => ((x.lift ?? 0) >= 1.3 && (i === 0 || (fr[i - 1].lift ?? 0) < 1.3)) ? i : -1).filter((i) => i >= 0),
        camJitter: Math.max(...fr.map((x) => Math.hypot(x.cam[0] - fr[0].cam[0], x.cam[1] - fr[0].cam[1], x.cam[2] - fr[0].cam[2]))),
        distortFrames: fr.filter((x) => x.dist > 0.5).length,
        flashMax: Math.max(...fr.map((x) => x.u[viewer.id]?.fl ?? 0)),
        sts: [...new Set(fr.flatMap((x) => x.u[viewer.id]?.sts ?? []))],
        vWhite: fr.filter((x) => x.vWhite !== undefined).map((x) => x.vWhite),
        vfxMax: Math.max(...fr.map((x) => x.vfx)),
      };
      console.log(fid, slot, st.name, `ct ${st.castTime}`, JSON.stringify(rec.summary));
      delete rec.frames; // keep the report small; summaries carry the numbers
      rec.framesLite = fr.map((x) => ({ t: +(x.t - t0).toFixed(3), tele: x.tele.length, lift: x.lift, fl: x.u[viewer.id]?.fl, sts: x.u[viewer.id]?.sts, st: x.u[c.id]?.st }));
      report.casts.push(rec);
    }
  }

  // ── own aim (the viewer's indicator for each watched kit's abilities) ───────────────────────
  if (ONLY.includes('aim')) for (const fid of WATCH) {
    const r = await B((b, a) => {
      const R = b.renderer; const f = b.catalog.fighters.find((x) => x.id === a.fid);
      b.__park([0]); b.__prep(a.vid, a.x, a.y, 0); b.renderer.vfx.clear(); b.frames(6, 1 / 30);
      const me = b.host.view.entity(a.vid);
      const hv = b.__h(a.vid); const crop = { x: Math.round(hv.gx - 520), y: Math.round(hv.gy - 330), w: 1040, h: 600 };
      b.__sheet(4, 1, 520, 300);
      const out = [];
      for (const slot of ['a1', 'a2', 'a3', 'ult']) {
        const ab = f.kit[slot];
        const g = { x: me.x + 4, y: me.y + 0.8 };
        let spec = null; try { spec = b.__aimSpec(ab, me, g, null); } catch (e) { spec = { err: String(e) }; }
        R.setAim(spec && !spec.err ? spec : null); b.frames(2, 1 / 30);
        const px = b.__telePx();
        b.__cell(crop, `${a.fid} ${slot} aim ${spec?.shape ?? 'none'}`);
        out.push({ slot, shape: spec?.shape ?? null, px, spec });
      }
      R.setAim(null);
      return out;
    }, { fid, vid: viewer.id, x: spot.x, y: spot.y });
    const sheet = await saveSheet(`aim_${fid}`);
    report.aim.push({ fighter: fid, sheet, slots: r.map((x) => ({ slot: x.slot, shape: x.shape, px: x.px })) });
    console.log('aim', fid, r.map((x) => `${x.slot}:${x.shape}:${x.px}`).join(' '));
  }

  // ── basic attacks: frame by frame ────────────────────────────────────────────────────────────
  if (ONLY.includes('attack')) for (const fid of opt('attackers', 'marund,nurrow,ilsheta,sukri').split(',')) {
    const c = seatOf(fid); if (!c) continue;
    const st = await B((b, a) => {
      const f = b.catalog.fighters.find((x) => x.id === a.fid); const rng = f.attack.range;
      const d = Math.min(rng * 0.8, 4.5) + 0.6;
      b.__park([a.c, 0]); b.__prep(a.cid, a.x - d / 2, a.y, 0); b.__prep(a.vid, a.x + d / 2, a.y, Math.PI); b.__cmd(0, { type: 'stop' });
      b.renderer.vfx.clear(); b.frames(10, 1 / 30);
      const hc = b.__h(a.cid), hv = b.__h(a.vid); const mx = (hc.gx + hv.gx) / 2, my = (hc.gy + hv.gy) / 2 - 60;
      const crop = { x: Math.round(mx - 360), y: Math.round(my - 220), w: 720, h: 420 };
      b.__sheet(8, 3, 360, 210); b.__ev.length = 0;
      b.__cmd(a.c, { type: 'attack', target: a.vid });
      return { crop, range: rng, windup: f.attack.windup, as: f.base.attackSpeed };
    }, { fid, c: c.seat, cid: c.id, vid: viewer.id, x: spot.x, y: spot.y });
    const fr = [];
    for (let f = 0; f < 72; f++) {
      fr.push(await B((b, a) => { b.frames(1, 1 / 30); const v = b.host.view; const e = v.entity(a.vid); e.hp = Math.max(e.hp, e.maxHp * 0.5); const ac = v.entity(a.cid); const o = { st: ac.state, fl: +(b.renderer.actors.get(a.vid)?.flashLevel ?? 0).toFixed(2), vfx: b.renderer.stats().vfx }; if (a.f < 72 && a.f % 3 === 0) b.__cell(a.crop, `${a.fid} atk f${a.f} ${(a.f / 30 * 1000) | 0}ms ${ac.state}`); return o; }, { f, crop: st.crop, fid, cid: c.id, vid: viewer.id }));
    }
    const ev = await B((b) => b.__ev.filter((e) => e.e === 'attack' || (e.e === 'damage' && !e.ability)).map((e) => ({ e: e.e, t: +e.t.toFixed(3), windup: e.windup, crit: e.crit, amt: e.amount })));
    await B((b, a) => b.__cmd(a, { type: 'stop' }), c.seat);
    const sheet = await saveSheet(`attack_${fid}`);
    const atk = ev.filter((e) => e.e === 'attack'), dmg = ev.filter((e) => e.e === 'damage');
    const rec = { fighter: fid, ...st, sheet, events: ev, windupToDamage: atk.map((a, i) => dmg[i] ? +(dmg[i].t - a.t).toFixed(3) : null), period: atk.length > 1 ? +(atk[1].t - atk[0].t).toFixed(3) : null, flash: fr.map((x) => x.fl) };
    console.log('attack', fid, JSON.stringify({ windupToDamage: rec.windupToDamage, period: rec.period }));
    report.attack.push(rec);
  }

  // ── recall: an enemy recalls in view ───────────────────────────────────────────────────────────
  if (ONLY.includes('recall')) {
    const c = seatOf(WATCH[0]);
    const st = await B((b, a) => {
      b.__park([a.c, 0]); b.__prep(a.cid, a.x, a.y, 0); b.__prep(a.vid, a.x + 7, a.y, Math.PI); b.__cmd(0, { type: 'stop' });
      b.renderer.vfx.clear(); b.frames(10, 1 / 30);
      const hc = b.__h(a.cid); const crop = { x: Math.round(hc.gx - 260), y: Math.round(hc.gy - 300), w: 520, h: 380 };
      b.__sheet(6, 2, 390, 285); b.__ev.length = 0;
      b.__cmd(a.c, { type: 'recall' });
      return { crop };
    }, { c: c.seat, cid: c.id, vid: viewer.id, x: spot.x, y: spot.y });
    const samples = [];
    for (let f = 0; f < 270; f++) {
      const r = await B((b, a) => {
        b.frames(1, 1 / 30); const e = b.host.view.entity(a.cid);
        const o = { f: a.f, st: e.state, vis: e.alive };
        if (a.f % 25 === 3) { const hc = b.__h(a.cid); o.px = b.__vfxOnly({ x0: a.crop.x, y0: a.crop.y, x1: a.crop.x + a.crop.w, y1: a.crop.y + a.crop.h }).n; b.__cell(a.crop, `recall ${(a.f / 30).toFixed(1)}s ${e.state}`); }
        return o;
      }, { f, crop: st.crop, cid: c.id });
      if (r.px !== undefined) samples.push({ s: +(f / 30).toFixed(2), st: r.st, px: r.px });
      if (r.st !== 'recall' && f > 10) { samples.push({ s: +(f / 30).toFixed(2), st: r.st, end: true }); break; }
    }
    const ev = await B((b) => b.__ev.filter((e) => e.e === 'recall').map((e) => ({ t: +e.t.toFixed(2), state: e.state })));
    report.recall = { fighter: WATCH[0], samples, events: ev, sheet: await saveSheet('recall') };
    console.log('recall', JSON.stringify(report.recall.samples), JSON.stringify(ev));
  }

  // ── wash: every caster's ultimate (and a1-a3) at an opposing victim; per frame the full frame / fight box white share,
  //    fight-box mean luma and the victim's body-box white share, everything drawn (what the player sees) ──────────
  if (ONLY.includes('wash')) {
    report.wash = [];
    await B((b) => {
      const luma = b.__luma;
      b.__washStats = (g, box, vbox) => {
        const { px, Wd, Hd } = g; let wf = 0, nf = 0;
        for (let i = 0; i < px.length; i += 16) { const l = luma(px[i], px[i + 1], px[i + 2]); const c = Math.max(px[i], px[i + 1], px[i + 2]) - Math.min(px[i], px[i + 1], px[i + 2]); nf++; if (l > 235 && c < 45) wf++; }
        const reg = (bx) => { let w = 0, n = 0, s = 0; for (let y = Math.max(0, bx.y0 | 0); y < Math.min(Hd, bx.y1 | 0); y += 2) for (let x = Math.max(0, bx.x0 | 0); x < Math.min(Wd, bx.x1 | 0); x += 2) { const o = ((Hd - 1 - y) * Wd + x) * 4; const l = luma(px[o], px[o + 1], px[o + 2]); const c = Math.max(px[o], px[o + 1], px[o + 2]) - Math.min(px[o], px[o + 1], px[o + 2]); n++; s += l; if (l > 235 && c < 45) w++; } return { w: +(w / Math.max(1, n)).toFixed(3), mean: +(s / Math.max(1, n)).toFixed(1) }; };
        return { full: +(wf / nf).toFixed(3), box: reg(box), v: reg(vbox) };
      };
    });
    const casters = opt('casters', '0,1,2,3,4,5,6,7,8,9').split(',').map(Number);
    const slots = opt('slots', 'ult').split(',');
    for (const cs of casters) {
      const c = report.players[cs]; const vs = cs < 5 ? 5 : 0; const v = report.players[vs];
      for (const slot of slots) {
        const st = await B((b, a) => {
          const H = b.host, R = b.renderer;
          const f = b.catalog.fighters.find((x) => x.id === a.fid); const ab = f.kit[a.slot];
          const helpful = b.__isHelpful(ab); const reach = b.__reachOf(ab) || ab.targeting?.range || 4;
          const d = Math.max(2.2, Math.min(4.6, reach * 0.75));
          b.__clear(); b.__park([a.cs, a.vs]);
          for (let k = 0; k < 2; k++) { b.__prep(a.cid, a.x - d / 2, a.y, 0); b.__prep(a.vid, a.x + d / 2, a.y, Math.PI); b.__cmd(a.cs, { type: 'stop' }); b.__cmd(a.vs, { type: 'stop' }); R.vfx.clear(); b.frames(k ? 2 : 24, 1 / 30); }
          const hc = b.__h(a.cid), hv = b.__h(a.vid);
          const mx = (hc.gx + hv.gx) / 2, my = (hc.gy + hv.gy) / 2 - 60;
          const box = { x0: mx - 420, y0: my - 230, x1: mx + 420, y1: my + 230 };
          const vbox = { x0: hv.gx - 28, y0: hv.ty - 6, x1: hv.gx + 28, y1: hv.gy };
          b.__ev.length = 0;
          const me = H.view.entity(helpful ? a.cid : a.vid);
          b.__cmd(a.cs, { type: 'cast', slot: a.slot, x: me.x, y: me.y, target: me.id });
          b.__sheet(3, 1, 560, 330);
          return { name: ab.name, box, vbox, crop: { x: Math.round(mx - 480), y: Math.round(my - 300), w: 960, h: 560 }, base: b.__washStats(b.__grab(), box, vbox) };
        }, { fid: c.def, slot, cs, vs, cid: c.id, vid: v.id, x: spot.x, y: spot.y });
        const rows = [];
        for (let f = 0; f < 75; f++) {
          rows.push(await B((b, a) => { b.frames(1, 1 / 30); const g = b.__grab(); const s = b.__washStats(g, a.box, a.vbox); s.lift = b.__U.lift ? Math.max(0, ...b.__U.lift.value.map((q) => q.w)) : 0; if (a.f === 0) { b.__pk = -1; b.__S.i = 0; b.__cell(a.crop, `${a.fid} ${a.slot} f0`); } if (s.box.w > b.__pk) { b.__pk = s.box.w; b.__S.i = 1; b.__cell(a.crop, `${a.fid} ${a.slot} peak f${a.f} box ${s.box.w} v ${s.v.w}`); } if (a.f === 45) { b.__S.i = 2; b.__cell(a.crop, `${a.fid} ${a.slot} f45`); } return s; }, { ...st, f, fid: c.def, slot }));
        }
        // the peak frame (most fight-box white) replayed is not possible; shoot base, peak-ish via a second short cast is overkill:
        const peakI = rows.reduce((bi, r, i) => (r.box.w > rows[bi].box.w ? i : bi), 0);
        const runs = (thr, key) => { let best = 0, cur = 0; for (const r of rows) { const val = key === 'v' ? r.v.w : key === 'full' ? r.full : r.box.w; if (val >= thr) { cur++; best = Math.max(best, cur); } else cur = 0; } return best; };
        const rec = { caster: c.def, seat: cs, team: c.team, slot, name: st.name, base: st.base, peakFrame: peakI, peak: rows[peakI],
          maxFull: Math.max(...rows.map((r) => r.full)), maxBox: Math.max(...rows.map((r) => r.box.w)), maxBoxMean: Math.max(...rows.map((r) => r.box.mean)), maxV: Math.max(...rows.map((r) => r.v.w)),
          framesBoxW25: runs(0.25, 'box'), framesV50: runs(0.5, 'v'), framesV35: runs(0.35, 'v'), framesFull10: runs(0.10, 'full'), liftFrames: rows.filter((r) => r.lift >= 1.3).length,
          series: rows.map((r) => [r.full, r.box.w, r.box.mean, r.v.w]) };
        report.wash.push(rec);
        console.log('wash', c.def, slot, st.name, JSON.stringify({ peakF: peakI, maxFull: rec.maxFull, maxBox: rec.maxBox, boxMeanBase: st.base.box.mean, maxBoxMean: rec.maxBoxMean, maxV: rec.maxV, boxW25: rec.framesBoxW25, v50: rec.framesV50, v35: rec.framesV35, full10: rec.framesFull10 }));
        rec.sheet = await saveSheet(`wash_${c.def}_${slot}`);
        await B((b, a) => { b.__clear(); }, null);
      }
    }
    // re-cast the worst one and shoot its peak frame
  }

  // ── death: an enemy fighter dies in view; then the viewer dies (the grade) ────────────────────
  if (ONLY.includes('death')) {
    const c = seatOf(WATCH[1]);
    const st = await B((b, a) => {
      b.__park([a.c, 0]); b.__prep(a.cid, a.x, a.y, 0); b.__prep(a.vid, a.x + 3, a.y, Math.PI);
      b.renderer.vfx.clear(); b.frames(10, 1 / 30);
      const hc = b.__h(a.cid); const crop = { x: Math.round(hc.gx - 330), y: Math.round(hc.gy - 300), w: 660, h: 400 };
      b.__sheet(6, 2, 440, 266); b.__ev.length = 0;
      const e = b.__W.entity(a.cid); e.hp = 5; e.shield = 0;
      b.__cmd(0, { type: 'attack', target: a.cid });
      return { crop };
    }, { c: c.seat, cid: c.id, vid: viewer.id, x: spot.x, y: spot.y });
    const fr = [];
    let deadAt = -1;
    for (let f = 0; f < 150; f++) {
      const r = await B((b, a) => { b.frames(1, 1 / 30); const e = b.host.view.entity(a.cid); const o = { alive: e.alive, st: e.state }; if (a.cell) b.__cell(a.crop, `enemy death ${a.lbl}`); return o; }, { f, cid: c.id, crop: st.crop, cell: deadAt >= 0 && [0, 2, 4, 6, 9, 12, 18, 24, 36, 48, 60, 75].includes(f - deadAt), lbl: `+${Math.round((f - deadAt) * 33.3)}ms` });
      if (deadAt < 0 && !r.alive) deadAt = f;
      fr.push(r);
      if (deadAt >= 0 && f - deadAt > 80) break;
    }
    const sheetE = await saveSheet('death_enemy');
    // own death: grade
    await B((b, a) => { b.__cmd(0, { type: 'stop' }); b.__prep(a.vid, a.x, a.y, 0); b.__prep(a.cid, a.x + 2.5, a.y, Math.PI); b.frames(10, 1 / 30); const e = b.__W.entity(a.vid); e.hp = 5; e.shield = 0; b.__cmd(a.c, { type: 'attack', target: a.vid }); }, { c: c.seat, cid: c.id, vid: viewer.id, x: spot.x, y: spot.y });
    const grade = []; let ownDead = -1;
    for (let f = 0; f < 120; f++) {
      const r = await B((b, a) => { b.frames(1, 1 / 30); const e = b.host.view.entity(a.vid); return { alive: e.alive, sat: b.__U.sat?.value, val: b.__U.val?.value }; }, { vid: viewer.id });
      if (ownDead < 0 && !r.alive) ownDead = f;
      if (ownDead >= 0) grade.push({ ms: Math.round((f - ownDead) * 33.3), sat: +(+r.sat).toFixed(3), val: +(+r.val).toFixed(3) });
      if (ownDead >= 0 && f - ownDead === 20) await page.screenshot({ path: `${SHOTS}/${TAG}_death_own_grade.jpg`, type: 'jpeg', quality: 80 });
      if (ownDead >= 0 && f - ownDead > 30) break;
    }
    report.death = { enemy: WATCH[1], deadAtFrame: deadAt, sheet: sheetE, grade: grade.filter((_, i) => i % 3 === 0) };
    console.log('death', deadAt, JSON.stringify(report.death.grade));
  }
} catch (e) {
  report.error = String(e?.stack ?? e);
  console.log('ERROR', e);
} finally {
  report.logs = logs.slice(0, 40);
  // the per-cast numbers the critic asked for (teleFirst, antic, flashMax, liftMax, distortFrames), one line each
  report.table = report.casts.map((c) => ({ fighter: c.fighter, slot: c.slot, teleFirst: c.summary.teleFirst ? c.summary.teleFirst.ms : null, antic: c.summary.antic,
    flashMax: c.summary.flashMax, liftMax: c.summary.liftMax, liftFrames: c.summary.liftFrames, distortFrames: c.summary.distortFrames, camJitter: +c.summary.camJitter.toFixed(4), sts: c.summary.sts }));
  writeFileSync(`${REPS}/${TAG}_kits.json`, JSON.stringify(report, null, 1));
  await browser.close();
  console.log('report', `${REPS}/${TAG}_kits.json`);
}
