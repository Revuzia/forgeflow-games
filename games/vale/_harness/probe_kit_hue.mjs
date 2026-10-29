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
// names (its present / effect vfx ids: cast, wind-up, zone, projectile, hit) with the caster (or a non-fighter unit it
// owns: a lamp, a summon) as their source. A unit
// reacting to the hit (the victim's passive), an item or boon proc, a bystander is dropped, so the light measured is
// the kit's.
//
// Staging (W1 verify combat:F6-probe): the caster and the victim are revived if the fast-forward left them dead
// (respawnFighter at their stage spot) and refilled (hp, resource, cooldowns, charges) before every cast, and the
// cast must show in the sim's own events (a `cast` from the caster for that slot). A slot whose cast never happened,
// or whose VFX left nothing to measure (n = 0), is staged and cast again once; if it still fails it is reported
// `not measured` (status 'nm', never sig 0: it is a staging failure, not a hue).
//
// CW1 (closing C1): every slot is measured FRAME-INTEGRATED: from release +1 to release +30 frames a sample every 3
// frames, the gate is the integrated share Σ sig / Σ sat over the window (one bright frame cannot carry a slot, a long
// neutral tail cannot hide). `--slots` picks the slots (default a1,a2,a3,ult: 64 slots for 16 kits). On the slots in
// `--teamgate` (default a3,ult) each cast is repeated with the spawn's `team` colour blacked out (noTeam):
//   teamLight  1 − A(noTeam) / A(normal), A = the added luma summed over the box and the window: the share of the light
//              the effect adds that is team-keyed; gate ≤ 0.35 (team lives in one keyline, not the body of the effect)
//   noTeamSig  the integrated signature share of the noTeam cast; gated ≥ 0.5 where the team colour itself sits within
//              35° of the signature hue (Kemdo's coral and Burdam's red against HARM marigold), where the hue metric alone
//              cannot tell team light from signature light
// --skins (SKIN-FX): each fighter whose skins carry a `vfx` palette casts --skinslots (default a1,ult) in that skin;
// the hue is measured against the SKIN's signature (gate ≥ 0.5) and the noTeam cast proves the team keyline stays
// team (teamLight > 0 where the base kit has one; reported).
//
//   node _harness/probe_kit_hue.mjs [--kits a,b,c] [--slots a1,a2,a3,ult] [--teamgate a3,ult] [--out <json>] [--shots <prefix>]
//                                   [--gate 0.5] [--teammax 0.35] [--live] [--status] [--skins] [--skinslots a1,ult]
//   --live   content/vfx.json and content/skins/*.json as they stand on disk replace the catalog's in the page (tuning
//            without a rebuild)
//   exit 1 when any slot measured is under a gate; exit 2 when none is but a slot could not be measured.
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { open, SHOTS as SHOT_DIR } from './pw.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const GATE = +opt('gate', 0.5), OUT = opt('out', ''), SHOTS = opt('shots', ''), LIVE = args.includes('--live'), STATUS = args.includes('--status');
const SKINS = args.includes('--skins');
const SLOTS = (SKINS ? opt('skinslots', 'a1,ult') : opt('slots', 'a1,a2,a3,ult')).split(',').filter(Boolean);
const TEAMGATE = new Set((SKINS ? SLOTS.join(',') : opt('teamgate', 'a3,ult')).split(',').filter(Boolean));
const TEAMMAX = +opt('teammax', 0.35);
const WIN = +opt('window', 30);
const all = readdirSync(join(HERE, '../content/fighters')).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort();
const kits = (opt('kits', '') || all.join(',')).split(',').filter(Boolean);
const SPOT = { x: 74, y: 55 };
const strip = (v) => (Array.isArray(v) ? v.map(strip) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => !k.startsWith('$')).map(([k, x]) => [k, strip(x)])) : v);
const liveDefs = LIVE ? strip(JSON.parse(readFileSync(join(HERE, '../content/vfx.json'), 'utf8'))) : null;
const skinDir = join(HERE, '../content/skins');
const liveSkins = LIVE || SKINS ? readdirSync(skinDir).filter((f) => f.endsWith('.json')).flatMap((f) => strip(JSON.parse(readFileSync(join(skinDir, f), 'utf8')))) : null;

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
if (liveSkins) {
  // the skins on disk (their `vfx` palette) over the catalog's: the renderer reads catalog.skins per spawn
  const r = await B((b, skins) => { let n = 0; for (const s of skins) { const k = b.catalog.skins.find((x) => x.id === s.id); if (k) { if (s.vfx) k.vfx = s.vfx; else delete k.vfx; if (s.vfxTint) k.vfxTint = s.vfxTint; n++; } } return n; }, liveSkins);
  console.log(`live skins: ${r}`);
}
// page-side helpers on the CURRENT host (b.__H), which the probe builds per batch
await B((b, status) => {
  const R = b.renderer;
  if (!status) R.director.statusVfx = {};
  // the caster-only window (b.__only = the caster's entity id; -1 = everything spawns)
  b.__only = -1;
  const spawn0 = R.vfx.spawnHandle.bind(R.vfx);
  b.__ids = new Set();
  // the caster's own source: the caster, or a unit it owns (a lamp, a summon) that is not a fighter
  const mine = (src) => { if (src === b.__only) return true; const e = src >= 0 ? b.__H.view.entity(src) : null; return !!e && e.kind !== 'fighter' && e.owner === b.__seat; };
  // the cast's variant: 'normal', or 'noTeam' (the spawn's team colour blacked out: what the effect adds without it)
  b.__variant = 'normal';
  const blk = (c) => (c ? c.clone().setRGB(0, 0, 0) : c);
  R.vfx.spawnHandle = (id, o) => {
    if (b.__only >= 0 && (!mine(o?.sourceId ?? -1) || !b.__ids.has(id))) return 0;
    if (b.__only >= 0 && b.__variant === 'noTeam') o = { ...o, team: blk(o.team) };
    return spawn0(id, o);
  };
  b.__step = (n = 1, dt = 1 / 30) => { for (let i = 0; i < n; i++) { b.__H.pump(dt); R.render(dt); } };
  b.__grab = () => { R.render(0); const gl = R.gl.getContext(); const Wd = gl.drawingBufferWidth, Hd = gl.drawingBufferHeight; const px = new Uint8Array(Wd * Hd * 4); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, Wd, Hd, gl.RGBA, gl.UNSIGNED_BYTE, px); return { px, Wd, Hd }; };
  b.__vfxHue = (box, sigH) => {
    const tv = R.overlay.teleScene.visible; R.overlay.teleScene.visible = false;
    const on = b.__grab(); const d = R.vfx.draw; R.vfx.draw = () => {}; let off; try { off = b.__grab(); } finally { R.vfx.draw = d; R.overlay.teleScene.visible = tv; } R.render(0);
    const { Wd, Hd } = on; let n = 0, ns = 0, harm = 0, sig = 0, white = 0, A = 0; const bins = new Array(12).fill(0);
    for (let y = Math.max(0, box.y0 | 0); y < Math.min(Hd, box.y1 | 0); y++) for (let x = Math.max(0, box.x0 | 0); x < Math.min(Wd, box.x1 | 0); x++) {
      const o = ((Hd - 1 - y) * Wd + x) * 4;
      const r = Math.max(0, on.px[o] - off.px[o]) / 255, g = Math.max(0, on.px[o + 1] - off.px[o + 1]) / 255, bl = Math.max(0, on.px[o + 2] - off.px[o + 2]) / 255;
      const Y = 0.2126 * r + 0.7152 * g + 0.0722 * bl; A += Y;
      if (Y < 0.08) continue; n++;
      const mx = Math.max(r, g, bl), mn = Math.min(r, g, bl); const s = mx > 0 ? (mx - mn) / mx : 0;
      if (s < 0.3) { white++; continue; }
      ns++;
      let h; if (mx === r) h = ((g - bl) / (mx - mn)) % 6; else if (mx === g) h = (bl - r) / (mx - mn) + 2; else h = (r - g) / (mx - mn) + 4; h = (h * 60 + 360) % 360;
      bins[Math.floor(h / 30)]++;
      if (h >= 20 && h <= 55) harm++;
      const dh = Math.min(Math.abs(h - sigH), 360 - Math.abs(h - sigH)); if (dh <= 25) sig++;
    }
    return { n, sat: ns, sigN: sig, harmN: harm, whiteN: white, A, sig: +(sig / Math.max(1, ns)).toFixed(3), harm: +(harm / Math.max(1, ns)).toFixed(3), white: +(white / Math.max(1, n)).toFixed(3), bins30: bins };
  };
}, STATUS);

const rows = [];
// --skins: one cast set per skin that carries a `vfx` palette (a fighter at most once per match: batches)
const skinSigs = new Map();
const entries = SKINS
  ? liveSkins.filter((k) => k.vfx && (!opt('kits', '') || kits.includes(k.fighter))).map((k) => { skinSigs.set(k.id, k.vfx.signature); return { fid: k.fighter, skin: k.id }; })
  : kits.map((k) => ({ fid: k, skin: '' }));
const batches = [];
for (const e of entries) { let bt = batches.find((x) => x.length < 10 && !x.some((y) => y.fid === e.fid)); if (!bt) batches.push(bt = []); bt.push(e); }
for (const bEntries of batches) {
  const batch = bEntries.map((e) => e.fid);
  const skinOf = Object.fromEntries(bEntries.filter((e) => e.skin).map((e) => [e.fid, e.skin]));
  const seats = new Array(10).fill('');
  batch.forEach((k, i) => { seats[i < 5 ? 5 + i : i - 5] = k; });
  const spare = all.filter((k) => !batch.includes(k));
  for (let i = 0; i < 10; i++) if (!seats[i]) seats[i] = spare.shift() ?? '';
  // a match host of our own with this lineup (the bench's own host keeps its default lineup)
  const players = await B(async (b, [picks, skinOf]) => {
    const { LocalMatchHost } = await import('/src/session/match_host.ts');
    const { createBots } = await import('/src/sim/bots/index.ts');
    const cat = b.catalog;
    const base = b.host.setup;
    const setup = { ...base, matchId: `kit-hue-${picks.join('-')}`, seats: base.seats.map((s, i) => {
      const fighter = picks[i] || s.fighter;
      const skin = skinOf[fighter] ?? cat.skins.find((k) => k.fighter === fighter && k.tier === 'base')?.id ?? cat.skins.find((k) => k.fighter === fighter)?.id ?? '';
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
    const { respawnFighter } = await import('/src/sim/spawn.ts');
    // every event the sim emits from here on, for the cast assertion (b.__evs: { e, src, slot })
    b.__evs = [];
    const emit0 = W.emit.bind(W);
    W.emit = (ev) => { if (ev && ev.src !== undefined) { b.__evs.push({ e: ev.e, src: ev.src, slot: ev.slot }); if (b.__evs.length > 4000) b.__evs.splice(0, 2000); } emit0(ev); };
    b.__prep = (id, x, y, face) => {
      const e = W.entity(id); if (!e) return false;
      // the 420 s fast-forward can leave a fighter dead (its respawn timer still running): bring it back here
      if (!e.alive) { if (e.kind !== 'fighter') return false; respawnFighter(W, e, x, y); if (!e.alive) return false; }
      e.x = x; e.y = y; e.vx = 0; e.vy = 0; if (face !== undefined) e.facing = face;
      e.hp = e.maxHp; e.res = e.maxRes; e.shield = 0; e.statuses.length = 0; if (e.level < 13) e.level = 13;
      for (let i = 0; i < 4; i++) { const s = e.slots?.[i]; if (s) { s.rank = Math.max(s.rank, s.maxRank); s.cooldown = 0; if (s.maxCharges) s.charges = s.maxCharges; } }
      return true;
    };
    b.__park = (p) => { b.__prep(W.players[p].entity, p < 5 ? 20 + p : 150 - p, 55); };
    b.__freshen = (ids) => { for (const id of ids) { const e = W.entity(id); if (e && e.alive) { e.hp = Math.max(e.hp, e.maxHp * 0.6); e.res = e.maxRes; } } };
    b.__h = (id) => { const e = h.view.entity(id); const a = b.renderer.actors.get(id); const x = a ? a.x : e.x, y = a ? a.y : e.y; const hh = e.height > 0 ? e.height : 2; const g = b.screen(x, y, 0), t = b.screen(x, y, hh); return { gx: g.x, gy: g.y, tx: t.x, ty: t.y }; };
    return W.players.map((p, i) => ({ seat: i, def: W.entity(p.entity)?.def, team: W.entity(p.entity)?.team, skin: W.entity(p.entity)?.skin }));
  }, [seats, skinOf]);
  await page.waitForTimeout(9000);
  await B((b) => b.__step(20));
  const hueOf = (hex) => { const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, bl = parseInt(hex.slice(5, 7), 16) / 255; const mx = Math.max(r, g, bl), mn = Math.min(r, g, bl); if (mx === mn) return 0; let h; if (mx === r) h = ((g - bl) / (mx - mn)) % 6; else if (mx === g) h = (bl - r) / (mx - mn) + 2; else h = (r - g) / (mx - mn) + 4; return (h * 60 + 360) % 360; };
  const SL = ['a1', 'a2', 'a3', 'ult'];
  const kitInfo = await B((b, SL) => Object.fromEntries(b.catalog.fighters.map((f) => [f.id, { sig: f.vfx?.signature ?? null,
    ct: Object.fromEntries(SL.map((k) => [k, f.kit[k].castTime ?? 0])), range: Object.fromEntries(SL.map((k) => [k, f.kit[k].targeting?.range ?? 0])),
    self: Object.fromEntries(SL.map((k) => [k, f.kit[k].targeting?.filter?.enemies === false])) }])), SL);
  // the team light the casters carry as the viewer sees them (HARM marigold for an enemy): its hue
  const teamHex = await B((b) => `#${b.renderer.palette.unitColor(1, -1, true).getHexString()}`);
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
    const teamH = hueOf(await B((b) => `#${b.renderer.palette.unitColor(1 - b.renderer.palette.viewer.team, -1, true).getHexString()}`).catch(() => teamHex));
    for (const cp of casters) {
      const fid = players[cp].def; const info = kitInfo[fid]; const skin = skinOf[fid] ?? '';
      const sigHex = skin ? skinSigs.get(skin) : info.sig; const sh = hueOf(sigHex);
      const dTeam = Math.min(Math.abs(sh - teamH), 360 - Math.abs(sh - teamH));
      for (const slot of SLOTS) {
        const rg = info.range[slot];
        const dist = rg > 0 ? Math.max(1.5, Math.min(4.5, rg - 0.4)) : 4.5;
        const res = {};
        for (const variant of TEAMGATE.has(slot) ? ['normal', 'noTeam'] : ['normal']) {
        let best = { n: -1 }, cast = false, st = null, tries = 0, integ = null;
        for (; tries < 2; tries++) {
        st = await B((b, a) => {
          const W = b.__W;
          // from the staging on, only this slot's own VFX from this caster spawn (an item or boon proc while the
          // pair is set up would linger into the samples)
          const f = b.catalog.fighters.find((x) => x.id === a.fid);
          b.__ids = new Set([...JSON.stringify(f.kit[a.slot]).matchAll(/"[a-zA-Z]*[vV]fx":"([^"]+)"/g)].map((m) => m[1]));
          b.__only = W.players[a.cp].entity; b.__seat = a.cp;
          const stage = () => {
            const pc = W.players[a.cp].entity, pv = W.players[a.vp].entity;
            b.__prep(pc, a.x - a.d / 2, a.y, 0); b.__prep(pv, a.x + a.d / 2, a.y, Math.PI);
            b.__cmd(a.cp, { type: 'stop' }); b.__cmd(a.vp, { type: 'stop' });
            return { pc, pv };
          };
          b.__clear(); stage(); b.__step(30); b.__clear(); const r = stage(); b.__step(2);
          const ok = [r.pc, r.pv].every((id) => W.entity(id)?.alive);
          return { ...r, ok };
        }, { cp, vp: v.victim, x: SPOT.x, y: SPOT.y, d: dist, fid, slot });
        // the caster's spot at the cast: a blink or a dash leaves its origin light behind, inside the box too
        st.c0 = await B((b, a) => b.__h(a.pc), st);
        await B((b, a) => {
          // a slot that never targets an enemy (a lamp hung on an ally or herself) is cast on the caster
          b.renderer.vfx.clear(); b.__evs.length = 0; b.__variant = a.variant;
          const tid = a.self ? a.pc : a.pv; const me = b.__H.view.entity(tid); b.__cmd(a.cp, { type: 'cast', slot: a.slot, x: me.x, y: me.y, target: tid }); }, { ...st, cp, slot, fid, variant, self: info.self[slot] });
        const rel = Math.max(1, Math.round(info.ct[slot] * 30));
        best = { n: -1 }; integ = { A: 0, n: 0, sat: 0, sigN: 0, harmN: 0, whiteN: 0, samples: 0, per: [] };
        for (let f = 1; f <= rel + WIN; f++) {
          await B((b, a) => { b.__step(1); b.__freshen([a.pc, a.pv]); }, st);
          if (f >= rel + 1 && (f - rel) % 3 === 1) {
            const m = await B((b, a) => { const c = b.__h(a.pc), w = b.__h(a.pv), o = a.c0; return b.__vfxHue({ x0: Math.min(c.gx, w.gx, o.gx) - 220, y0: Math.min(c.ty, w.ty, o.ty) - 120, x1: Math.max(c.gx, w.gx, o.gx) + 220, y1: Math.max(c.gy, w.gy, o.gy) + 120 }, a.sh); }, { ...st, sh });
            for (const k of ['A', 'n', 'sat', 'sigN', 'harmN', 'whiteN']) integ[k] += m[k];
            integ.samples++; integ.per.push([f - rel, Math.round(m.A), m.sig]);
            if (m.n > best.n) {
              Object.assign(best, m, { f });
              if (SHOTS && variant === 'normal') {
                const box = await B((b, a) => { const c = b.__h(a.pc), w = b.__h(a.pv); return { x: Math.round(Math.min(c.gx, w.gx) - 220), y: Math.round(Math.min(c.ty, w.ty) - 120) }; }, st);
                mkdirSync(SHOT_DIR, { recursive: true });
                await page.screenshot({ path: join(SHOT_DIR, `${SHOTS}_${skin || fid}_${slot}.png`), clip: { x: Math.max(0, Math.min(1200, box.x)), y: Math.max(0, Math.min(660, box.y)), width: 720, height: 420 } });
              }
            }
          }
        }
        // the cast really happened: the sim emitted a `cast` for this slot from the caster
        cast = await B((b, a) => b.__evs.some((e) => e.e === 'cast' && e.src === a.pc && e.slot === a.slot), { ...st, slot });
        // every effect of this cast ends before the next one: zones run out, statuses go, the VFX are cleared
        await B((b, a) => { b.__only = -1; b.__variant = 'normal'; b.__step(105); for (const id of [a.pc, a.pv]) { const e = b.__W.entity(id); if (e) e.statuses.length = 0; } b.renderer.vfx.clear(); b.__step(3); }, st);
        if (cast && st.ok && best.n > 0) break;
        console.log(`  ${tries === 0 ? 'retry' : 'gave up on'} ${fid} ${slot} ${variant}: ${!st.ok ? 'caster or victim not alive after staging' : !cast ? 'no cast event' : 'nothing measured (n 0)'}`);
        }
        const measured = cast && st.ok && best.n > 0;
        res[variant] = { measured, tries: tries + (measured ? 1 : 0), cast, f: best.f, n: best.n, sat: best.sat, peakSig: measured ? best.sig : null, harm: best.harm, white: best.white, bins30: best.bins30,
          A: Math.round(integ.A), sig: measured ? +(integ.sigN / Math.max(1, integ.sat)).toFixed(3) : null, harmInt: +(integ.harmN / Math.max(1, integ.sat)).toFixed(3),
          whiteInt: +(integ.whiteN / Math.max(1, integ.n)).toFixed(3), per: integ.per };
        }
        const N = res.normal, T = res.noTeam;
        const teamLight = N.measured && T ? +(1 - T.A / Math.max(1, N.A)).toFixed(3) : null;
        // the hue metric cannot tell team light from signature light when the team hue is within 35° of the signature
        const sigNear = dTeam <= 35;
        const fails = [];
        if (N.measured && N.sig < GATE) fails.push(`sig ${N.sig} < ${GATE}`);
        if (!SKINS && teamLight !== null && teamLight > TEAMMAX) fails.push(`team light ${teamLight} > ${TEAMMAX}`);
        if (!SKINS && T && sigNear && T.measured && T.sig < GATE) fails.push(`noTeam sig ${T.sig} < ${GATE} (team hue ${Math.round(dTeam)}° from the signature)`);
        const measured = N.measured && (!T || T.measured);
        const row = { fid, skin: skin || undefined, slot, view: v.name, sigHex, sigHue: Math.round(sh), teamHueDist: Math.round(dTeam), dist, sig: N.sig, peakSig: N.peakSig, teamLight, noTeamSig: T ? T.sig : null,
          white: N.whiteInt, harm: N.harmInt, A: N.A, normal: N, noTeam: T, fails, status: !measured ? 'nm' : fails.length ? 'fail' : 'pass' };
        row.pass = row.status !== 'fail';
        rows.push(row);
        console.log(`${row.status === 'nm' ? 'NOT MEASURED' : row.status.toUpperCase()} ${(skin || fid).padEnd(8)} ${slot.padEnd(3)} sigH ${String(row.sigHue).padStart(3)} sig ${row.sig} (peak ${row.peakSig}) team ${teamLight} noTeamSig ${row.noTeamSig} white ${row.white} harm ${row.harm} A ${row.A} ${fails.join('; ')}`);
      }
      await B((b, p) => b.__park(p), cp);
    }
  }
}
const fails = rows.filter((r) => r.status === 'fail'), nm = rows.filter((r) => r.status === 'nm'), sigs = rows.filter((r) => r.sig !== null).map((r) => r.sig);
const tl = rows.filter((r) => r.teamLight !== null).map((r) => r.teamLight);
const out = { gate: GATE, teamMax: TEAMMAX, window: WIN, live: LIVE, status: STATUS, skins: SKINS, slotsAsked: SLOTS, teamGate: [...TEAMGATE], kits, slots: rows.length, measured: sigs.length, passed: rows.filter((r) => r.status === 'pass').length,
  fails: fails.map((r) => `${r.skin ?? r.fid}.${r.slot}: ${r.fails.join('; ')}`), notMeasured: nm.map((r) => `${r.skin ?? r.fid}.${r.slot}`),
  retried: rows.filter((r) => (r.normal?.tries ?? 1) > 1 || (r.noTeam?.tries ?? 1) > 1).map((r) => `${r.skin ?? r.fid}.${r.slot}`), minSig: sigs.length ? Math.min(...sigs) : null, maxTeamLight: tl.length ? Math.max(...tl) : null,
  rows, logs: logs.filter((l) => !/favicon|toNonIndexed|status of 404/.test(l)).slice(0, 8) };
console.log(JSON.stringify({ ...out, rows: undefined }));
if (OUT) writeFileSync(OUT, JSON.stringify(out, null, 1));
await browser.close();
process.exit(fails.length || !rows.length ? 1 : nm.length ? 2 : 0);
