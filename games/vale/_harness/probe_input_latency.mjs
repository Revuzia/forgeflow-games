// VALE harness — CW1 critic:input-feel + critic:camera, the REAL client (dev server, real Chrome GPU, heavy slot).
// A RIFT co-op match (your seat drafted by the dev autopilot, then yours to play at speed 1). Every other seat's
// commands are muted so the field holds still; one enemy fighter is parked 3.5 m from you as the attack target.
//
// input    50 orders through CDP mouse/keyboard events (Playwright → Input.dispatchMouseEvent):
//            20 move          right-click on the ground 160-220 px from your fighter
//            10 attack        right-click on the parked enemy
//            10 attack-move   A, then left-click on the ground
//            10 windup-move   attack the enemy, and the frame the attack clip starts, right-click the ground
//          An in-page rAF logger (registered after the client's own loops, so it runs after they drew) records every
//          frame: your actor's drawn position, heading and clip, and the move/attack markers on screen. Per order,
//          from the pointerdown's event.timeStamp: `marker` = the first frame that draws the order's marker,
//          `motion` = the first frame your fighter's drawn position, heading or clip changes (windup-move: the first
//          frame it leaves the attack clip or moves). p50 / p95 in ms (the frame's callback time; the screen shows it
//          on that frame's present). Gauge (critic): LoL acknowledges an order on the next frame and starts motion
//          within a server tick (~33 ms at 30 Hz): marker p95 <= 2 frames (an input landing mid-frame shows on the
//          frame after), motion p95 <= 2 ticks (67 ms) + 1 frame. Also: marker frames histogram.
// camera   locked default; edge peek (pointer held at the right edge 1 s: the dwell, then px/s of the drawn focus) and
//          its glide back; the lock key (Y) to semi, an edge pan, the centre key (Space) and Y back: focus offset from
//          your fighter after one frame; respawn (your fighter killed, the camera panned 1 s away while dead, back at
//          the fountain): focus offset on the first live frame, in semi and in locked.
//
//   node _harness/probe_input_latency.mjs [--orders 50] [--tag x] [--only camera] [--kinds attack,windupMove]   → _harness/_reports/fw_CW1_input_latency[_tag].json
//   shots _harness/_shots/fw_CW1_input_*.png
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { open, shot, vale, waitFor } from './pw.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const TAG = opt('tag', '');
const OUT = join(HERE, '_reports', `fw_CW1_input_latency${TAG ? '_' + TAG : ''}.json`);
mkdirSync(dirname(OUT), { recursive: true });
const NORD = Number(opt('orders', 50));
/** --only camera: skip the 50 orders (the camera half alone) */
const ONLY = opt('only', 'input,camera').split(',');
const report = { at: new Date().toISOString(), orders: [], summary: {}, camera: {}, pass: true, fails: [] };
const fail = (m) => { report.pass = false; report.fails.push(m); console.log('FAIL', m); };

const { browser, page, logs } = await open('/?dev=1&autopilot=draft', { hmr: false });
try {
  const frames = () => page.waitForFunction(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))), null, { timeout: 60000 });
  const click = async (l) => { await l.waitFor({ state: 'visible', timeout: 30000 }); await frames(); await l.click({ timeout: 30000 }); };
  await page.waitForTimeout(2000);
  await click(page.locator('.nav__item', { hasText: 'Play' })); await page.waitForTimeout(500);
  await click(page.locator('.station', { hasText: 'RIFT' }).first()); await page.waitForTimeout(500);
  // the co-op queue card (renamed 'Lantern Drill' in originality m1; a dev catalog not yet rebuilt still shows the old name)
  await click(page.locator('.qcard').filter({ hasText: /Lantern Drill|Co-op vs/ }).first()); await page.waitForTimeout(300);
  await click(page.getByRole('button', { name: 'Find match' }));
  await waitFor(page, (v) => v.state.queue.value?.state === 'found' || !!v.state.draft.value, 30000);
  const ready = page.getByRole('button', { name: /^Ready/ }); if (await ready.count()) await click(ready.first());
  await waitFor(page, (v) => !!v.state.draft.value || !!v.state.loading.value || !!v.state.match.value, 30000);
  await waitFor(page, (v) => v.state.match.value?.view.phase === 'live', 240000);
  // your fighter drawn
  await waitFor(page, (v) => { const c = v.state.match.value, R = v.state.renderer; const me = c.view.players.find((p) => p.player === c.you); const a = R.actors.get(me.entity); return !!a?.model; }, 60000);
  await page.mouse.move(960, 540);
  await page.waitForTimeout(1500);

  // freeze the field: every other seat muted; one enemy fighter parked as the target
  const setup = await vale(page, async (v) => {
    const c = v.state.match.value, W = c.sim.world, R = v.state.renderer;
    // a parked foe that died is revived the sim's own way (a bare alive = true left it untargetable: death clears
    // `targetable`, and the right-click on it then fell through to a ground move — critic:input-feel, a harness artefact)
    const { respawnFighter } = await import('/src/sim/spawn.ts');
    const me = c.view.players.find((p) => p.player === c.you);
    const self = W.entity(me.entity);
    const orig = W.command.bind(W);
    window.__allow = false;
    W.command = (p, cmd) => { if (p === c.you || window.__allow) orig(p, cmd); };
    const foe = c.view.players.find((p) => p.team !== me.team);
    window.__ids = { me: me.entity, foe: foe.entity, you: c.you };
    // near = true: the enemy 0.6 m outside your attack range (edge to edge; inside it your fighter's auto-attack
    // would already be swinging), so an attack order steps in and winds up; false: 3.5 m outside it (still in
    // vision, so its actor stays drawn and pickable), so auto-attack does not take the move orders
    window.__park = (near = true) => {
      const s = W.entity(me.entity), e = W.entity(foe.entity);
      if (!e.alive) respawnFighter(W, e, e.x, e.y);
      // the foe's own order from before the mute (a bot's walk) would carry it on past the park spot: stop it the
      // sim's way (r2: orders 1 / 4 of fw_CW1_input_latency_r2a/b clicked where the walking foe had been)
      orig(foe.player, { type: 'stop' });
      s.target = null; if ('attackTarget' in s) s.attackTarget = null;
      const reach = (s.stats?.range ?? 1.5) + s.radius + e.radius;
      const d = near ? Math.max(1.2, reach + 0.6) : reach + 3.5;
      e.hp = e.maxHp; e.x = s.x + d; e.y = s.y; e.vx = 0; e.vy = 0; e.autoAttack = false; e.statuses.length = 0;
      s.hp = s.maxHp;
    };
    // move your fighter off the fountain platform to open ground near your base
    return { me: me.entity, foe: foe.entity, fighter: self.def?.id ?? self.defId ?? '', x: self.x, y: self.y, team: me.team, mode: R.rig?.mode };
  });
  report.setup = setup;
  console.log('setup', JSON.stringify(setup));
  // walk 12 m toward the map centre so the fountain's edge and shop do not take clicks
  // walk 24 m toward the map centre (the fountain's edge, the shop and the camera's map-edge clamp stay out of it);
  // that point is the anchor every other order walks back to
  const anchor = await vale(page, (v) => { const c = v.state.match.value, W = c.sim.world, s = W.entity(window.__ids.me); const m = W.map ?? null; const cx = (m?.size?.[0] ?? 170) / 2, cy = (m?.size?.[1] ?? 110) / 2; const d = Math.hypot(cx - s.x, cy - s.y) || 1; const a = { x: s.x + (cx - s.x) / d * 24, y: s.y + (cy - s.y) / d * 24 }; c.send({ type: 'move', ...a }); window.__anchor = a; return a; });
  report.anchor = anchor;
  await page.waitForTimeout(8000);
  await vale(page, () => window.__park());
  await page.waitForTimeout(600);

  // the in-page logger
  await vale(page, (v) => {
    const c = v.state.match.value, R = v.state.renderer;
    const L = { frames: [], events: [], cmds: [] };
    window.__L = L;
    // every command the client sends (r2 diagnosis: is a right-click on the foe sent as 'attack' or as 'move'?)
    const send0 = c.send.bind(c);
    c.send = (cmd) => { L.cmds.push({ t: performance.now(), type: cmd.type, target: cmd.target, attackMove: cmd.attackMove }); return send0(cmd); };
    const a = () => R.actors.get(window.__ids.me);
    addEventListener('pointerdown', (e) => {
      // what the pick sees at the press (the controller's entityAt asks the same), with the foe's view state
      const fv = c.view.entity(window.__ids.foe);
      L.events.push({ t: e.timeStamp, button: e.button, x: e.clientX, y: e.clientY, pick: R.pickEntity(e.clientX, e.clientY), foeTargetable: fv?.targetable, foeVis: fv?.visibleMask, foeAlive: fv?.alive });
    }, { capture: true });
    const tick = (ts) => {
      requestAnimationFrame(tick);
      const x = a();
      if (!x) return;
      const now = performance.now();
      const marks = document.querySelectorAll('.wmark').length;
      // the marker kinds on screen this frame (read in the frame itself: a CDP round trip under load can outlive the
      // 520 ms marker, so a later DOM read is not evidence)
      const am = document.querySelectorAll('.wmark--attack').length, mm = document.querySelectorAll('.wmark--move').length;
      L.frames.push({ ts, now, x: x.root.position.x, z: x.root.position.z, rot: x.root.rotation.y, key: x.currentKey, marks, am, mm, tick: c.view.tick });
      if (L.frames.length > 20000) L.frames.splice(0, 5000);
    };
    requestAnimationFrame(tick);
  });

  const selfScreen = () => vale(page, (v) => {
    const R = v.state.renderer, a = R.actors.get(window.__ids.me), e = R.actors.get(window.__ids.foe);
    const cam = R.rig.camera;
    const P = a.root.position.clone();
    const s = P.clone().project(cam);
    const Q = e ? e.root.position.clone().setY(e.root.position.y + 1.0).project(cam) : null;
    const W = innerWidth, H = innerHeight;
    const px = Q ? (Q.x + 1) / 2 * innerWidth : -1, py = Q ? (1 - Q.y) / 2 * innerHeight : -1;
    const pick = Q ? R.pickEntity(px, py) : null;
    // CW1 refix (critic:input-feel): why the pick rejects the foe — renderer.pickEntity's own tests, replayed on its actor
    let why = null;
    if (Q && pick !== window.__ids.foe && e) {
      const ev = e.view, V3 = P.constructor;
      const f = new V3(e.x, e.h, e.y).project(cam), h = new V3(e.x, e.h + e.artHeight, e.y).project(cam);
      const sx = (f.x * 0.5 + 0.5) * R.cssW, sy = (-f.y * 0.5 + 0.5) * R.cssH, hy = (-h.y * 0.5 + 0.5) * R.cssH;
      const ppm = Math.abs(sy - hy) / Math.max(0.3, e.artHeight), rx = Math.max(16, ((ev?.radius ?? 0) + 0.15) * ppm);
      const top = Math.min(hy, sy - 24) - 6, bottom = sy + rx * 0.6;
      why = { visible: e.visible, alive: ev?.alive, targetable: ev?.targetable, leaving: e.leaving, mode: R.mode, css: [R.cssW, R.cssH], inner: [innerWidth, innerHeight],
        actorXY: [+e.x.toFixed(2), +e.y.toFixed(2), +e.h.toFixed(2)], rootXZ: [+e.root.position.x.toFixed(2), +e.root.position.z.toFixed(2)], simXY: [ev?.x, ev?.y],
        artHeight: e.artHeight, feet: [Math.round(sx), Math.round(sy)], head: Math.round(hy), rx: Math.round(rx), band: [Math.round(top), Math.round(bottom)], at: [Math.round(px), Math.round(py)],
        inBand: py >= top && py <= bottom, inX: Math.abs(px - sx) <= rx };
    }
    const fv = v.state.match.value.view.entity(window.__ids.foe);
    const A = window.__anchor ? P.clone().set(window.__anchor.x, 0, window.__anchor.y).project(cam) : null;
    return { x: (s.x + 1) / 2 * W, y: (1 - s.y) / 2 * H, fx: Q ? (Q.x + 1) / 2 * W : -1, fy: Q ? (1 - Q.y) / 2 * H : -1, key: a.currentKey, pick, why, foeAlive: fv?.alive, foeVis: fv?.visibleMask, dist: e ? Math.hypot(e.x - a.x, e.y - a.y) : null, ...(A ? { ax: (A.x + 1) / 2 * W, ay: (1 - A.y) / 2 * H } : {}) };
  });
  const stationary = async () => {
    for (let i = 0; i < 40; i++) {
      const m = await vale(page, () => { const f = window.__L.frames; const n = f.length; if (n < 8) return 1; let d = 0; for (let i = n - 8; i < n; i++) d = Math.max(d, Math.hypot(f[i].x - f[n - 1].x, f[i].z - f[n - 1].z)); return d; });
      if (m < 0.002) return true;
      await page.waitForTimeout(100);
    }
    return false;
  };

  // --kinds attack,windupMove: only those order kinds (a targeted re-run)
  const KINDS = opt('kinds', 'move,attack,attackMove,windupMove').split(',');
  const kinds = [];
  const n = (k) => Math.round(NORD * k);
  for (let i = 0; i < n(0.4); i++) kinds.push('move');
  for (let i = 0; i < n(0.2); i++) kinds.push('attack');
  for (let i = 0; i < n(0.2); i++) kinds.push('attackMove');
  for (let i = 0; kinds.length < NORD; i++) kinds.push('windupMove');
  // interleave
  const order = [];
  const pools = { move: kinds.filter((k) => k === 'move'), attack: kinds.filter((k) => k === 'attack'), attackMove: kinds.filter((k) => k === 'attackMove'), windupMove: kinds.filter((k) => k === 'windupMove') };
  if (KINDS.length < 4) { for (let i = 0; i < NORD; i++) order.push(KINDS[i % KINDS.length]); }
  else while (order.length < NORD) for (const k of ['move', 'attack', 'move', 'attackMove', 'windupMove']) if (pools[k].length && order.length < NORD) order.push(pools[k].pop());

  let dir = 1;
  for (let i = 0; i < (ONLY.includes('input') ? order.length : 0); i++) {
    const kind = order[i];
    const near = kind === 'attack' || kind === 'windupMove';
    await vale(page, (v, n) => window.__park(n), near);
    await page.keyboard.press('KeyS'); // stop
    await page.waitForTimeout(250);
    await stationary();
    // settle into idle (a running attack finishes first)
    for (let k = 0; k < 20; k++) { const key = await vale(page, (v) => v.state.renderer.actors.get(window.__ids.me)?.currentKey); if (key === 'idle') break; await page.waitForTimeout(60); }
    // the parked foe's actor glides to its new sim spot after __park's teleport: an attack order aimed at it before
    // the drawn position settles clicks where it WAS (a harness artefact: orders 1 / 4 of fw_CW1_input_latency_v2b,
    // press pick null at the click, actor 4.1 / 5.0 m away vs the 3.7 m park)
    if (near) for (let k = 0; k < 40; k++) {
      const d = await vale(page, (v) => { const e = v.state.renderer.actors.get(window.__ids.foe), ev = v.state.match.value.view.entity(window.__ids.foe); return e && ev ? Math.hypot(e.x - ev.x, e.y - ev.y) : 0; });
      if (d < 0.03) break;
      await page.waitForTimeout(50);
    }
    // the locked camera glides after your fighter stops: the foe's screen point is only valid once the focus holds
    for (let k = 0; k < 40; k++) {
      const m = await vale(page, async (v) => { const R = v.state.renderer, f0 = R.rig.focus.clone(); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); return Math.hypot(R.rig.focus.x - f0.x, R.rig.focus.z - f0.z); });
      if (m < 0.002) break;
      await page.waitForTimeout(50);
    }
    const s = await selfScreen();
    const ang = (i * 2.399) % (Math.PI * 2);
    const r = 160 + (i % 4) * 20;
    // ground points away from the parked enemy (its side is +x); a windup-move's ground click always goes to the
    // far side (r2: with dir -1 it could land on the foe and be sent, rightly, as a second attack)
    let gx = s.x - Math.abs(Math.cos(ang)) * r * (near ? 1 : dir), gy = s.y + Math.sin(ang) * r * 0.6;
    // every other order walks back toward the anchor (the fighter stays in open ground)
    if (i % 2 === 1 && s.ax !== undefined && !(near && s.ax > s.x)) { const dx = s.ax - s.x, dy = s.ay - s.y, l = Math.hypot(dx, dy); if (l > 40) { gx = s.x + dx / l * Math.min(l, 260); gy = s.y + dy / l * Math.min(l, 260); } }
    gx = Math.max(80, Math.min(1840, gx)); gy = Math.max(160, Math.min(860, gy));
    dir = -dir;
    const before = await vale(page, () => ({ ev: window.__L.events.length, fr: window.__L.frames.length, cmd: window.__L.cmds.length }));
    let t0ev = before.ev, firstMark = null;
    if (kind === 'move') {
      await page.mouse.move(gx, gy); await page.waitForTimeout(60);
      await page.mouse.down({ button: 'right' }); await page.mouse.up({ button: 'right' });
    } else if (kind === 'attack') {
      await page.mouse.move(s.fx, s.fy); await page.waitForTimeout(120);
      await page.mouse.down({ button: 'right' }); await page.mouse.up({ button: 'right' });
      await frames(); await frames();
      firstMark = await vale(page, () => [...document.querySelectorAll('.wmark')].map((x) => x.className).join(' '));
    } else if (kind === 'attackMove') {
      await page.mouse.move(gx, gy); await page.waitForTimeout(60);
      await page.keyboard.press('KeyA'); await page.waitForTimeout(80);
      await page.mouse.down({ button: 'left' }); await page.mouse.up({ button: 'left' });
    } else {
      await page.mouse.move(s.fx, s.fy); await page.waitForTimeout(120);
      await page.mouse.down({ button: 'right' }); await page.mouse.up({ button: 'right' });
      await frames(); await frames();
      firstMark = await vale(page, () => [...document.querySelectorAll('.wmark')].map((x) => x.className).join(' '));
      // wait for the attack clip
      for (let k = 0; k < 150; k++) { const key = await vale(page, (v) => v.state.renderer.actors.get(window.__ids.me)?.currentKey); if (/^attack|^crit/.test(key ?? '')) break; await page.waitForTimeout(10); }
      t0ev = await vale(page, () => window.__L.events.length);
      await page.mouse.move(gx, gy);
      await page.mouse.down({ button: 'right' }); await page.mouse.up({ button: 'right' });
    }
    await page.waitForTimeout(450);
    const res = await vale(page, (v, a) => {
      const L = window.__L, ev = L.events[a.ev];
      if (!ev) return { err: 'no pointer event' };
      const fr = L.frames;
      let b = -1;
      for (let i = 0; i < fr.length; i++) if (fr[i].now < ev.t) b = i;
      if (b < 0) return { err: 'no base frame' };
      const base = fr[b];
      let marker = null, motion = null, pos = null, anim = null, frames = 0;
      for (let i = b + 1; i < fr.length; i++) {
        const f = fr[i];
        frames++;
        if (marker === null && f.marks > base.marks) marker = { ms: f.now - ev.t, frames };
        const moved = Math.hypot(f.x - base.x, f.z - base.z) > 0.01;
        const turned = Math.abs(f.rot - base.rot) > 0.5 * Math.PI / 180;
        const clip = f.key !== base.key;
        if (pos === null && moved) pos = { ms: f.now - ev.t, frames };
        if (anim === null && (turned || clip)) anim = { ms: f.now - ev.t, frames, why: clip ? `${base.key}->${f.key}` : 'turn' };
        if (motion === null && (a.windup ? (moved || (clip && !/^attack|^crit/.test(f.key))) : (moved || turned || clip))) motion = { ms: f.now - ev.t, frames };
      }
      return { marker, motion, pos, anim, baseKey: base.key, frameMs: fr.length > 2 ? (fr[fr.length - 1].ts - fr[Math.max(0, fr.length - 61)].ts) / Math.min(60, fr.length - 1) : null };
    }, { ev: t0ev, windup: kind === 'windupMove' });
    const markerKind = await vale(page, () => [...document.querySelectorAll('.wmark')].map((x) => x.className).join(' '));
    // an attack order (right-click on the enemy) must draw the ATTACK marker, never a ground move (critic:input-feel)
    const press = await vale(page, (v, n) => window.__L.events[n] ?? null, before.ev);
    // the press's marker, from the in-page frame log: an attack / move ring that appears within 8 frames of the press
    if (kind === 'attack' || kind === 'windupMove') {
      firstMark = await vale(page, (v, n) => {
        const L = window.__L, ev = L.events[n];
        if (!ev) return null;
        const fr = L.frames;
        let b = -1;
        for (let i = 0; i < fr.length; i++) if (fr[i].now < ev.t) b = i;
        if (b < 0) return null;
        const out = [];
        for (let i = b + 1; i < Math.min(fr.length, b + 9); i++) {
          if (fr[i].am > fr[b].am && !out.includes('wmark--attack')) out.push('wmark--attack');
          if (fr[i].mm > fr[b].mm && !out.includes('wmark--move')) out.push('wmark--move');
        }
        return out.join(' ');
      }, before.ev);
    }
    const cmds = await vale(page, (v, n) => window.__L.cmds.slice(n), before.cmd);
    // what the controller SENT for the press (the first command after it): an attack order lost on its way to the
    // command builder shows here as a 'move'
    const attackMark = kind === 'attack' || kind === 'windupMove' ? firstMark : null;
    const sentAs = cmds[0]?.type ?? null;
    const wrongMark = attackMark !== null && (sentAs !== 'attack' || /wmark--move/.test(attackMark ?? ''));
    // the attack was sent but its marker was not on screen 2 frames later (a HUD marker defect, reported apart)
    const attackMarkMissing = attackMark !== null && sentAs === 'attack' && !/wmark--attack/.test(attackMark ?? '');
    report.orders.push({ i, kind, ...res, pick: s.pick, pickWhy: s.why, foe: setup.foe, foeAlive: s.foeAlive, foeVis: s.foeVis, dist: s.dist, markerKind, firstMark, wrongMark, attackMarkMissing, sentAs, press, cmds });
    console.log(i, kind, JSON.stringify(res), wrongMark ? `WRONG MARK (${attackMark}) pick ${s.pick} why ${JSON.stringify(s.why)} press ${JSON.stringify(press)} cmds ${JSON.stringify(cmds)}` : '');
  }
  await shot(page, 'fw_CW1_input_after_orders').catch(() => {});

  // summary
  const pct = (a, p) => { const b = a.filter((x) => typeof x === 'number').sort((x, y) => x - y); return b.length ? +b[Math.min(b.length - 1, Math.floor(p * b.length))].toFixed(1) : null; };
  const frameMs = pct(report.orders.map((o) => o.frameMs), 0.5) ?? 16.7;
  for (const k of ['all', 'move', 'attack', 'attackMove', 'windupMove']) {
    const os = report.orders.filter((o) => k === 'all' || o.kind === k);
    const mk = os.map((o) => o.marker?.ms), mo = os.map((o) => o.motion?.ms);
    report.summary[k] = { n: os.length, markerP50: pct(mk, 0.5), markerP95: pct(mk, 0.95), markerMissing: mk.filter((x) => typeof x !== 'number').length, motionP50: pct(mo, 0.5), motionP95: pct(mo, 0.95), motionMissing: mo.filter((x) => typeof x !== 'number').length };
  }
  report.summary.frameMs = frameMs;
  const hist = (k) => report.orders.reduce((h, o) => { const f = o[k]?.frames ?? 'none'; h[f] = (h[f] ?? 0) + 1; return h; }, {});
  report.summary.markerFrames = hist('marker'); report.summary.motionFrames = hist('motion');
  const all = report.summary.all;
  console.log('summary', JSON.stringify(report.summary));
  // an input that lands while a frame is being built waits for that frame, then shows on the next: <= 2 frames
  if (ONLY.includes('input')) {
    if (all.markerP95 === null || all.markerP95 > 2 * frameMs) fail(`marker p95 ${all.markerP95} ms > 2 frames`);
    if (all.motionP95 === null || all.motionP95 > 67 + frameMs) fail(`motion p95 ${all.motionP95} ms > 2 ticks + 1 frame`);
    if (all.markerMissing > 0) fail(`${all.markerMissing} orders drew no marker`);
    if (all.motionMissing > 0) fail(`${all.motionMissing} orders never moved the fighter`);
    const wrong = report.orders.filter((o) => o.wrongMark);
    report.summary.attackAsMove = wrong.length;
    if (wrong.length) fail(`${wrong.length} attack orders on the enemy were sent or drawn as a move (orders ${wrong.map((o) => o.i).join(',')})`);
    const noMark = report.orders.filter((o) => o.attackMarkMissing);
    report.summary.attackMarkMissing = noMark.length;
    if (noMark.length) fail(`${noMark.length} attack orders sent as attack showed no attack marker 2 frames later (orders ${noMark.map((o) => o.i).join(',')})`);
  }

  // ── camera, live ───────────────────────────────────────────────────────────────────────────────────────
  const camState = () => vale(page, (v) => { const R = v.state.renderer, a = R.actors.get(window.__ids.me), f = R.rig.focus; return { mode: R.rig.mode, fx: f.x, fz: f.z, sx: a.x, sz: a.y, off: Math.hypot(f.x - a.x, f.z - a.y), alive: !!a.view?.alive, zoom: R.rig.zoom }; });
  const pxm = (z) => (540 / Math.tan(13 * Math.PI / 180)) / z;
  // back to the anchor (open ground, away from the camera's map-edge clamp)
  await vale(page, (v) => v.state.match.value.send({ type: 'move', ...window.__anchor }));
  await page.mouse.move(960, 540); await page.waitForTimeout(5000);
  await vale(page, () => window.__park(false));
  await page.keyboard.press('KeyS'); await page.waitForTimeout(400);
  const c0 = await camState();
  report.camera.default = { mode: c0.mode, offPx: +(c0.off * pxm(c0.zoom)).toFixed(2), zoom: c0.zoom };
  // edge peek (locked): the focus over time
  const trace = [];
  await page.mouse.move(1919, 540);
  const tp0 = Date.now();
  for (let k = 0; k < 12; k++) { await page.waitForTimeout(90); const s = await camState(); trace.push({ t: Date.now() - tp0, offPx: s.off * pxm(s.zoom) }); }
  // the glide back, frame by frame in the page (rAF), from the pointer leaving the edge
  await vale(page, (v) => {
    const R = v.state.renderer; window.__back = null; const rows = []; let t0 = null;
    addEventListener('pointermove', function once(e) { if (e.clientX < 1800) { t0 = e.timeStamp; removeEventListener('pointermove', once, true); } }, true);
    const f = (ts) => { const a = R.actors.get(window.__ids.me), q = R.rig.focus; if (t0 !== null) { const off = Math.hypot(q.x - a.x, q.z - a.y) * (540 / Math.tan(13 * Math.PI / 180)) / R.rig.zoom; rows.push({ t: +(performance.now() - t0).toFixed(1), offPx: +off.toFixed(1) }); if (off < 1 || rows.length > 240) { window.__back = rows; return; } } requestAnimationFrame(f); };
    requestAnimationFrame(f);
  });
  await page.mouse.move(960, 540);
  try { await waitFor(page, () => !!window.__back, 10000); } catch { /* reported below */ }
  const back = (await vale(page, () => window.__back)) ?? [];
  // the pan's slope while it moves (a map-edge clamp ends it in a plateau, left out)
  const moving = trace.filter((p, i) => p.offPx > 2 && !(i > 0 && Math.abs(p.offPx - trace[i - 1].offPx) < 1));
  const speed = moving.length >= 2 ? (moving[moving.length - 1].offPx - moving[0].offPx) / ((moving[moving.length - 1].t - moving[0].t) / 1000) : 0;
  report.camera.peek = { dwellMsBefore: moving.length ? moving[0].t : null, pxPerS: Math.round(speed), trace: trace.map((p) => ({ t: p.t, offPx: Math.round(p.offPx) })), back: back.filter((_, i) => i % 3 === 0 || i === back.length - 1), backWithinMs: back.find((p) => p.offPx < 1)?.t ?? null };
  // lock toggle → semi, edge pan, centre key, toggle back
  await page.keyboard.press('KeyY'); await page.waitForTimeout(200);
  const semi = await camState();
  await page.mouse.move(1919, 540); await page.waitForTimeout(500); await page.mouse.move(960, 540); await page.waitForTimeout(100);
  const panned = await camState();
  await page.keyboard.down('Space'); await frames();
  const centred = await camState();
  await page.keyboard.up('Space'); await page.waitForTimeout(100);
  await page.mouse.move(1919, 540); await page.waitForTimeout(400); await page.mouse.move(960, 540); await page.waitForTimeout(60);
  await page.keyboard.press('KeyY'); await frames();
  const relocked = await camState();
  report.camera.toggle = { afterY: semi.mode, pannedPx: Math.round(panned.off * pxm(panned.zoom)), spaceOffPx: +(centred.off * pxm(centred.zoom)).toFixed(2), relockMode: relocked.mode, relockOffPx: +(relocked.off * pxm(relocked.zoom)).toFixed(2) };
  // respawn, in semi then in locked
  report.camera.respawn = {};
  for (const mode of ['semi', 'locked']) {
    const st = await camState();
    if (st.mode !== mode) { await page.keyboard.press('KeyY'); await page.waitForTimeout(150); }
    await vale(page, async (v) => {
      const W = v.state.match.value.sim.world, s = W.entity(window.__ids.me);
      const loaded = (path) => performance.getEntriesByType('resource').map((e) => e.name).filter((n) => new URL(n).pathname === path).pop() ?? path;
      const { killEntity } = await import(loaded('/src/sim/combat.ts'));
      s.hp = 0; killEntity(W, s, W.entity(window.__ids.foe), 0);
    });
    await waitFor(page, (v) => !v.state.renderer.actors.get(window.__ids.me)?.view?.alive, 15000);
    await page.mouse.move(1919, 300); await page.waitForTimeout(1200); await page.mouse.move(960, 540);
    const dead = await camState();
    // the respawn timer: shorten it (dev) so the probe does not wait a full death
    await vale(page, (v) => { const W = v.state.match.value.sim.world, s = W.entity(window.__ids.me); if (s.player && s.player.respawnIn > 0.5) s.player.respawnIn = 0.5; });
    // log the first live frame's focus offset
    await vale(page, (v) => { const R = v.state.renderer; window.__resp = null; const f = () => { const a = R.actors.get(window.__ids.me); if (a?.view?.alive) { const q = R.rig.focus; window.__resp = { off: Math.hypot(q.x - a.x, q.z - a.y), zoom: R.rig.zoom }; return; } requestAnimationFrame(f); }; requestAnimationFrame(f); });
    try { await waitFor(page, () => !!window.__resp, 90000); } catch { /* reported below */ }
    const r = await vale(page, () => window.__resp);
    report.camera.respawn[mode] = { deadPannedPx: Math.round(dead.off * pxm(dead.zoom) || 0), firstLiveOffPx: r ? +(r.off * pxm(r.zoom)).toFixed(2) : null };
    await page.waitForTimeout(800);
    await vale(page, () => window.__park(false));
  }
  await shot(page, 'fw_CW1_input_camera_end').catch(() => {});
  console.log('camera', JSON.stringify(report.camera));
  const cam = report.camera;
  if (cam.default.mode !== 'locked') fail(`default camera mode ${cam.default.mode}`);
  if (cam.default.offPx > 1) fail(`locked camera off the fighter by ${cam.default.offPx} px`);
  if (!(cam.peek.pxPerS > 500)) fail(`edge peek did not pan (${cam.peek.pxPerS} px/s)`);
  // the rig lands within peekReturnMaxS (400 ms) of the pointer leaving the edge; one frame of slack
  if (cam.peek.backWithinMs === null || cam.peek.backWithinMs > 400 + 2 * frameMs) fail(`peek glide back ${cam.peek.backWithinMs} ms`);
  if (cam.toggle.afterY === 'locked') fail('Y did not unlock');
  if (cam.toggle.spaceOffPx > 1) fail(`Space left the focus ${cam.toggle.spaceOffPx} px off`);
  if (cam.toggle.relockMode !== 'locked' || cam.toggle.relockOffPx > 1) fail(`Y relock ${cam.toggle.relockMode} ${cam.toggle.relockOffPx} px`);
  for (const [m, r] of Object.entries(cam.respawn)) if (r.firstLiveOffPx === null || r.firstLiveOffPx > 1) fail(`respawn (${m}) first live frame ${r.firstLiveOffPx} px off`);
} catch (e) {
  fail(`error: ${e?.stack ?? e}`);
} finally {
  report.logs = logs.slice(0, 40);
  writeFileSync(OUT, JSON.stringify(report, null, 1));
  console.log(report.pass ? 'input/camera PASS' : `input/camera FAIL (${report.fails.length})`, '→', OUT);
  await browser.close();
}
process.exit(report.pass ? 0 : 1);
