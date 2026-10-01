/**
 * CRESTBOUND — _harness/cr_scenarios.js   (creatures lane proofs; DEV ONLY)
 * ---------------------------------------------------------------------------
 * One closed-loop proof per creature and per realm boss, fought in the arena
 * (cr_arena.js) inside the real game loop by the real-key bot (cr_bot.js).
 * Every proof does what a player does — walks up, watches the telegraph,
 * sidesteps, jumps on it or pounds — and records, from the creature's own
 * events, that it APPEARED, NOTICED Nim, TELEGRAPHED, was DEFEATED by that
 * move and PAID its reward (the hero's coin counter, not the event, is the
 * proof of the drop). Frames are captured from the real renderer at each beat
 * (`globalThis.__crFrames`, read back by cr_arena.py).
 *
 *   const S = makeScenarios(bot);  S.burrower() -> record
 */

export function makeScenarios(bot) {
  const A = globalThis.CRESTBOUND, G = A.game, E = A.engine;
  const P = () => G.player;
  const frames = (globalThis.__crFrames = globalThis.__crFrames || []);
  const r2 = (v) => Math.round(v * 100) / 100;
  const clampN = (v, a, b) => (v < a ? a : (v > b ? b : v));
  const crit = (k) => (G.course && G.course.critters || []).find((c) => c.kind === k) || null;

  /* ---------------------------------------------------------------- frames */
  function grab(name) {
    let url = null;
    try { url = E.renderer.domElement.toDataURL('image/jpeg', 0.82); } catch (e) { url = null; }
    frames.push({ name, f: bot.frame, url });
    return name;
  }
  /** The follow camera's view, right now. */
  function cap(name) { bot.render(); return grab(name); }
  /**
   * A chase shot that frames Nim AND point (tx, ty, tz): the camera behind Nim
   * on the far side from the target, looking at the pair. Pure presentation:
   * the next game.update hands the camera back to the follow rig.
   */
  function capAt(name, tx, ty, tz) {
    const cam = E.camera, p = P().pos;
    let dx = p.x - tx, dz = p.z - tz;
    const l = Math.hypot(dx, dz);
    if (l < 0.6) { dx = Math.sin(G.cam ? G.cam.yaw : 0); dz = Math.cos(G.cam ? G.cam.yaw : 0); } else { dx /= l; dz /= l; }
    const back = 3.4 + Math.min(l, 14) * 0.3;
    // a little to the side, so a creature right behind Nim is not hidden by him
    const side = 1.2 + Math.min(l, 8) * 0.15;
    cam.position.set(p.x + dx * back - dz * side, Math.max(p.y, ty) + 2.0 + Math.min(l, 14) * 0.12, p.z + dz * back + dx * side);
    cam.lookAt((p.x + tx) * 0.5, (p.y + ty) * 0.5 + 0.7, (p.z + tz) * 0.5);
    cam.updateMatrixWorld(true);
    E.render(1 / 60); E.render(1 / 60);
    return grab(name);
  }
  function capOn(c, name) { return capAt(name, c.pos.x, c.pos.y, c.pos.z); }
  /** A posed portrait of creature `c` (the next update restores the follow cam). */
  function portrait(c, name, dist, h, yaw) {
    bot.portrait(c.pos.x, c.pos.y, c.pos.z, dist, h, yaw);
    return grab(name);
  }

  /* --------------------------------------------------------------- records */
  function evs(kind, f0) { return bot.log.filter((e) => e.k === kind && e.f >= f0); }
  function summary(kind, f0) {
    const L = evs(kind, f0);
    const st = [];
    for (const e of L) if (e.e === 'state' && st[st.length - 1] !== e.a) st.push(e.a);
    const first = (name) => { const e = L.find((x) => x.e === name); return e ? e.f : null; };
    return {
      states: st,
      notice: first('notice'), defeatedF: first('defeated'),
      coinsEv: L.filter((e) => e.e === 'coins').map((e) => e.a),
      bumps: L.filter((e) => e.e === 'bump').length,
      other: L.filter((e) => e.e !== 'state' && e.e !== 'notice' && e.e !== 'defeated' && e.e !== 'coins' && e.e !== 'bump')
        .map((e) => e.e + (e.a !== null && e.a !== undefined ? ':' + e.a : '') + '@' + e.f),
    };
  }
  function cinfo(c) {
    return c ? { st: c.state, p: [r2(c.pos.x), r2(c.pos.y), r2(c.pos.z)], defeated: !!c.defeated, how: c.defeatHow || null,
      visible: !!(c.body && c.body.visible), aware: !!c.aware } : null;
  }

  /* ------------------------------------------------------------ movement */
  /** Walk at `c` until it notices Nim. */
  function walkUntilNotice(c, max) {
    const n = bot.drive(() => { if (c.aware) return true; bot.steer(c.pos.x, c.pos.z, 0); return false; }, max || 900);
    bot.key('KeyW', false);
    return { aware: !!c.aware, frames: n, d: r2(bot.hdist(c.pos.x, c.pos.z)) };
  }
  /** Step until `c.state` is one of `states`; `each(i)` drives the hero meanwhile. */
  function waitState(c, states, max, each) {
    const want = Array.isArray(states) ? states : [states];
    let ok = false;
    bot.drive((i) => {
      if (want.indexOf(c.state) >= 0) { ok = true; return true; }
      if (each) each(i);
      return false;
    }, max);
    if (!each) bot.releaseAll();
    return ok;
  }
  /** Run sideways relative to the line from (fx, fz) to the hero, `dist` metres. */
  function sidestep(fx, fz, dist, max, sign) {
    const p = P().pos;
    let dx = p.x - fx, dz = p.z - fz;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    const s = sign || 1;
    const tx = p.x - dz * dist * s, tz = p.z + dx * dist * s;
    bot.drive(() => bot.steer(tx, tz, 0.3) < 0.35, max || 90);
    bot.key('KeyW', false);
    return [r2(P().pos.x), r2(P().pos.z)];
  }
  /** Walk to `dist` metres from creature c (re-targets every frame). */
  function closeTo(c, dist, max) {
    bot.drive(() => {
      const p = P().pos;
      let dx = p.x - c.pos.x, dz = p.z - c.pos.z;
      const l = Math.hypot(dx, dz) || 1;
      if (l <= dist + 0.15) return true;
      dx /= l; dz /= l;
      bot.steer(c.pos.x + dx * dist, c.pos.z + dz * dist, 1.0);
      return false;
    }, max || 300);
    bot.key('KeyW', false);
  }
  /** Jump onto creature c (a stomp); `top()` gives the height of its top. */
  function stomp(c, top, tries, startDist) {
    const att = [];
    for (let t = 0; t < (tries || 3) && !c.defeated; t++) {
      closeTo(c, startDist || 1.8, 240);
      if (c.defeated) break;
      const r = bot.hop(() => ({ x: c.pos.x, y: c.pos.y, z: c.pos.z, top: top() }), { vmax: 6 });
      att.push({ maxY: r.maxY, landed: r.landed && r.landed.p, st: c.state, defeated: !!c.defeated });
      bot.step(10);
    }
    return att;
  }
  /** Close to `dist` and pound beside creature c. */
  function poundBeside(c, dist, tries) {
    const att = [];
    for (let t = 0; t < (tries || 3) && !c.defeated; t++) {
      closeTo(c, dist || 1.1, 240);
      const before = c.state;
      const h = bot.poundHere();
      att.push({ before, after: c.state, hero: h.st, defeated: !!c.defeated });
    }
    return att;
  }
  /** Walk over the spot where `c` fell and let the coins come in. */
  function collect(c) {
    const x = c.pos.x, z = c.pos.z;
    const before = bot.coins();
    bot.goto(x, z, 0.35, 400, 1.5);
    bot.idle(45);
    // sweep a small square so a coin the magnet missed is walked over
    const pts = [[0.7, 0], [0, 0.7], [-0.7, 0], [0, -0.7], [0, 0]];
    for (const q of pts) { if (bot.coins() - before >= (c.reward || 0)) break; bot.goto(x + q[0], z + q[1], 0.3, 120, 1.0); bot.idle(15); }
    return { before, after: bot.coins(), got: bot.coins() - before };
  }
  function begin(kind) {
    const c = crit(kind);
    if (!c) throw new Error('no ' + kind + ' in this arena');
    bot.watch();
    return { c, f0: bot.frame, t0: performance.now(), rec: { kind, coins0: bot.coins(), home: [r2(c.home.x), r2(c.home.y), r2(c.home.z)], frames: [], steps: {} } };
  }
  function end(o) {
    const { c, f0, rec } = o;
    rec.final = cinfo(c);
    rec.events = summary(c.kind, f0);
    rec.hero = bot.hero();
    rec.gameFrames = bot.frame - o.f0;
    rec.coinsGained = bot.coins() - rec.coins0;   // the drop, counted by the hero's own coin counter
    rec.msPerFrame = r2((performance.now() - o.t0) / Math.max(1, rec.gameFrames));
    return rec;
  }

  /* ======================================================================
   * VERDANT
   * ==================================================================== */

  function burrower() {
    const o = begin('burrower'), { c, rec } = o;
    bot.tp(c.home.x + 0.5, 0, c.home.z + 12.5);
    rec.frames.push(portrait(c, 'burrower_1_lurk', 3.0, 1.1));
    rec.steps.notice = walkUntilNotice(c);
    bot.step(8);
    rec.frames.push(capOn(c, 'burrower_2_notice'));
    // stand still: it dives, tunnels to the hero, telegraphs under his feet
    rec.steps.tele1 = waitState(c, 'tele', 420);
    rec.steps.tele1At = { dHero: r2(bot.hdist(c.pos.x, c.pos.z)), tunnelT: r2(c.tunnelT), fromHome: r2(Math.hypot(c.pos.x - c.home.x, c.pos.z - c.home.z)) };
    bot.step(18);
    rec.frames.push(capOn(c, 'burrower_3_tele_under_nim'));
    // cycle 1: let it pop up under Nim (the attack is real: a toss)
    let tossVy = 0;
    waitState(c, 'dazed', 90, () => { if (P().vel.y > tossVy) tossVy = P().vel.y; });
    rec.steps.toss = { heroVyMax: r2(tossVy), bumped: evs('burrower', o.f0).some((e) => e.e === 'bump') };
    bot.idle(30);
    // cycle 2: when it telegraphs again, sidestep out of the ring and stomp it dazed
    rec.steps.tele2 = waitState(c, 'tele', 600);
    rec.steps.dodge = sidestep(c.pos.x - 1, c.pos.z - 1, 1.9, 34);
    rec.steps.dazed2 = waitState(c, 'dazed', 90);
    bot.step(8);
    rec.frames.push(capOn(c, 'burrower_4_dazed'));
    rec.steps.stomp = stomp(c, () => c.pos.y + 0.95, 3, 1.7);
    bot.step(4);
    rec.frames.push(capOn(c, 'burrower_5_defeat'));
    rec.steps.reward = collect(c);
    return end(o);
  }

  function podspitter() {
    const o = begin('podspitter'), { c, rec } = o;
    bot.tp(c.home.x, 0, c.home.z + 15);
    rec.frames.push(portrait(c, 'podspitter_1_idle', 3.4, 1.5));
    rec.steps.notice = walkUntilNotice(c);
    bot.step(6);
    rec.frames.push(capOn(c, 'podspitter_2_notice'));
    rec.steps.tele = waitState(c, 'tele', 240);
    bot.step(26);
    rec.frames.push(capOn(c, 'podspitter_3_tele_marker'));
    // the seed is aimed where Nim stood: walk out of the marked ring
    rec.steps.dodge = sidestep(c.pos.x, c.pos.z, 2.2, 40);
    const spitF = bot.frame;
    waitState(c, 'aim', 60);
    bot.step(4);
    rec.frames.push(capOn(c, 'podspitter_4_seed_in_flight'));
    bot.step(50);
    rec.steps.seedMissed = !evs('podspitter', spitF).some((e) => e.e === 'bump');
    rec.steps.stomp = stomp(c, () => (c.col.aabb ? c.col.aabb.max.y : c.pos.y + 1.55), 4, 1.6);
    bot.step(4);
    rec.frames.push(capOn(c, 'podspitter_5_defeat'));
    rec.steps.reward = collect(c);
    return end(o);
  }

  /* ======================================================================
   * EMBER
   * ==================================================================== */

  function slagcrab() {
    const o = begin('slagcrab'), { c, rec } = o;
    bot.tp(c.pos.x, 0, c.pos.z + 11);
    rec.frames.push(portrait(c, 'slagcrab_1_scuttle', 2.6, 0.9));
    rec.steps.notice = walkUntilNotice(c);
    bot.step(6);
    rec.frames.push(capOn(c, 'slagcrab_2_notice'));
    // jump at it from outside its snap reach (2.7 m): it hunkers into its hot
    // shell under a falling hero and the stomp clonks off
    closeTo(c, 3.3, 200);
    bot.releaseAll(); bot.step(6);
    const fC = bot.frame;
    let shellCap = false;
    const hop = bot.hop(() => {
      if (!shellCap && c.state === 'shell' && c.hunker > 0.6) { shellCap = true; }
      return { x: c.pos.x, y: c.pos.y, z: c.pos.z, top: c.pos.y + 0.72 };
    }, { vmax: 7.5 });
    rec.steps.clonk = { shelled: evs('slagcrab', fC).some((e) => e.e === 'state' && e.a === 'shell'),
      clonked: evs('slagcrab', fC).some((e) => e.e === 'clonk'), defeated: !!c.defeated, landed: hop.landed && hop.landed.p };
    if (c.state === 'shell') rec.frames.push(capOn(c, 'slagcrab_3_shell'));
    // stand close: claw up, seams flare, SNAP — step back out of reach
    bot.idle(30);
    rec.steps.tele = waitState(c, 'tele', 300, () => { closeTo(c, 2.2, 1); });
    bot.releaseAll();
    bot.step(14);
    rec.frames.push(capOn(c, 'slagcrab_4_tele_claw'));
    rec.steps.backoff = sidestep(c.pos.x, c.pos.z, 0.01, 1);
    bot.drive(() => { const p = P().pos; const d = Math.hypot(p.x - c.pos.x, p.z - c.pos.z); if (d > 3.6) return true; bot.steer(p.x + (p.x - c.pos.x) * 3, p.z + (p.z - c.pos.z) * 3, 0); return false; }, 40);
    bot.key('KeyW', false);
    rec.steps.snapped = waitState(c, ['recover', 'stalk'], 60);
    // POUND beside it: it flips onto its back; then stomp the belly
    rec.steps.pound = poundBeside(c, 1.2, 3);
    if (c.state === 'flipped') { bot.step(6); rec.frames.push(capOn(c, 'slagcrab_5_flipped')); }
    rec.steps.stomp = c.defeated ? [] : stomp(c, () => c.pos.y + 0.72, 3, 1.5);
    bot.step(4);
    rec.frames.push(capOn(c, 'slagcrab_6_defeat'));
    rec.steps.reward = collect(c);
    return end(o);
  }

  function emberimp() {
    const o = begin('emberimp'), { c, rec } = o;
    bot.tp(c.home.x, 0, c.home.z + 13);
    rec.frames.push(portrait(c, 'emberimp_1_idle', 2.4, 0.8));
    rec.steps.notice = walkUntilNotice(c);
    bot.step(10);
    rec.frames.push(capOn(c, 'emberimp_2_notice_cackle'));
    rec.steps.crouch = waitState(c, 'crouch', 120);
    bot.step(14);
    rec.frames.push(capOn(c, 'emberimp_3_tele_flare'));
    // stand: when a crouch will land it beside Nim, jump and pound onto it
    const att = [];
    const pounder = makePounder();
    let lastD = 0;
    bot.releaseAll();
    bot.drive(() => {
      if (c.defeated) return true;
      if (pounder.busy) { pounder.step(); if (!pounder.busy) att.push({ d: r2(lastD), st: c.state, defeated: !!c.defeated, how: c.defeatHow }); return false; }
      const d = bot.hdist(c.pos.x, c.pos.z);
      if (c.state === 'crouch' && c.stateT < 0.12 && d < 3.0) { lastD = d; pounder.start(); }
      return att.length >= 6;
    }, 1800);
    rec.steps.pound = att;
    bot.step(2);
    rec.frames.push(capOn(c, 'emberimp_4_defeat'));
    rec.steps.reward = collect(c);
    return end(o);
  }

  /* ======================================================================
   * RIME
   * ==================================================================== */

  function skater() {
    const o = begin('skater'), { c, rec } = o;
    bot.tp(c.pos.x, 0, c.pos.z + 14);
    rec.frames.push(portrait(c, 'skater_1_waddle', 2.8, 1.0));
    rec.steps.notice = walkUntilNotice(c);
    rec.steps.tele = waitState(c, 'tele', 60);
    bot.step(22);
    rec.frames.push(capOn(c, 'skater_2_tele_scrabble'));
    rec.steps.slide = waitState(c, 'slide', 60);
    const fS = bot.frame;
    rec.steps.dodge = sidestep(c.pos.x, c.pos.z, 2.0, 40);
    bot.step(4);
    rec.frames.push(capOn(c, 'skater_3_slide'));
    rec.steps.dizzy = waitState(c, 'dizzy', 200);
    rec.steps.slideMissed = !evs('skater', fS).some((e) => e.e === 'bump');
    bot.step(4);
    rec.frames.push(capOn(c, 'skater_4_dizzy'));
    rec.steps.stomp = stomp(c, () => c.pos.y + 1.0 - 0.55 * (c.belly || 0), 3, 1.6);
    bot.step(4);
    rec.frames.push(capOn(c, 'skater_5_defeat'));
    rec.steps.reward = collect(c);
    return end(o);
  }

  function snowcub() {
    const o = begin('snowcub'), { c, rec } = o;
    bot.tp(c.home.x, 0, c.home.z + 15);
    rec.frames.push(portrait(c, 'snowcub_1_play', 2.8, 1.0));
    rec.steps.notice = walkUntilNotice(c);
    bot.step(10);
    rec.frames.push(capOn(c, 'snowcub_2_notice_clap'));
    rec.steps.windup = waitState(c, 'windup', 80);
    bot.step(30);
    rec.frames.push(capOn(c, 'snowcub_3_tele_windup'));
    rec.steps.shove = waitState(c, 'shove', 40);
    const fB = bot.frame;
    rec.steps.dodge = sidestep(c.pos.x, c.pos.z, 2.2, 45);
    rec.frames.push(capOn(c, 'snowcub_4_ball_rolling'));
    rec.steps.react = waitState(c, ['sulk', 'cheer'], 240);
    bot.step(20);
    rec.frames.push(capOn(c, 'snowcub_5_' + c.state));
    rec.steps.ballMissed = !evs('snowcub', fB).some((e) => e.e === 'ballHit');
    rec.steps.pound = poundBeside(c, 1.1, 3);
    bot.step(2);
    rec.frames.push(capOn(c, 'snowcub_6_defeat'));
    rec.steps.reward = collect(c);
    return end(o);
  }

  /* ======================================================================
   * AZURE
   * ==================================================================== */

  function sentry() {
    const o = begin('sentry'), { c, rec } = o;
    bot.tp(c.pos.x, 0, c.pos.z + 13);
    rec.frames.push(portrait(c, 'sentry_1_patrol', 3.0, 1.3));
    // walk in front of it until it SEES Nim (range + cone + line of sight)
    rec.steps.notice = walkUntilNotice(c, 1200);
    rec.steps.tele = waitState(c, 'tele', 60);
    bot.step(36);
    rec.frames.push(capOn(c, 'sentry_2_tele_beam'));
    // the beam locks 0.25 s before the bolt: step out of its line
    rec.steps.dodge = sidestep(c.pos.x, c.pos.z, 2.0, 30);
    const fF = bot.frame;
    rec.steps.fired = waitState(c, 'cool', 60);
    bot.step(4);
    rec.frames.push(capOn(c, 'sentry_3_bolt'));
    bot.step(20);
    rec.steps.boltMissed = !bot.log.some((e) => e.f >= fF && e.k === 'sentry' && e.e === 'bump');
    rec.steps.pound = poundBeside(c, 1.1, 4);
    bot.step(4);
    rec.frames.push(capOn(c, 'sentry_4_defeat'));
    rec.steps.reward = collect(c);
    return end(o);
  }

  function puffer() {
    const o = begin('puffer'), { c, rec } = o;
    bot.tp(c.pos.x, 0, c.pos.z + 10);
    rec.frames.push(portrait(c, 'puffer_1_drift', 2.6, 0.6));
    // within 5 m it puffs up into a springy platform
    rec.steps.notice = walkUntilNotice(c);
    rec.steps.puffed = waitState(c, 'puffed', 60);
    bot.releaseAll();
    bot.step(6);
    rec.frames.push(capOn(c, 'puffer_2_puffed_platform'));
    // jump onto it: it is a bounce platform
    closeTo(c, 1.5, 120);
    bot.releaseAll();
    bot.step(4);
    const top = () => (c.col && c.col.aabb ? c.col.aabb.max.y : c.pos.y + 1.0);
    rec.steps.platformTop = r2(top());
    const b1 = bot.frame;
    let vyMax = 0, yMax = -1e9, phase = 0, pounded = false, bounceF = -1, apexAfterBounce = -1e9, capd = false;
    bot.aim(c.pos.x, c.pos.z);
    bot.key('Space', true);
    bot.drive((i) => {
      const p = P();
      if (i === 14) bot.key('Space', false);
      const dx = c.pos.x - p.pos.x, dz = c.pos.z - p.pos.z, d = Math.hypot(dx, dz);
      bot.aim(c.pos.x, c.pos.z);
      if (p.vel.y > vyMax) vyMax = p.vel.y;
      if (p.pos.y > yMax) yMax = p.pos.y;
      const bounced = bot.log.some((e) => e.f >= b1 && e.k === 'puffer' && e.e === 'bounced');
      if (phase === 0) {
        // over the top before the feet come down past it, then hold still above it
        bot.key('KeyW', d > 0.35 && (p.vel.y > 0 || p.pos.y > top() + 0.1));
        if (bounced || (i > 8 && p.vel.y > 9.5)) { phase = 1; bounceF = bot.frame; }
      } else if (phase === 1) {
        if (p.pos.y > apexAfterBounce) apexAfterBounce = p.pos.y;
        if (!capd && p.vel.y < 1) { capd = true; rec.frames.push(capOn(c, 'puffer_3_bounce_apex')); }
        bot.key('KeyW', d > 0.3);
        // falling back onto the puffed ball: POUND it
        if (p.vel.y < 0 && d < 0.6 && p.pos.y > top() + 0.6 && (c.state === 'puffed' || c.state === 'warn')) {
          bot.key('KeyW', false); bot.key('KeyC', true); pounded = true; phase = 2;
        }
      } else if (phase === 2) {
        if (c.defeated || p.grounded) return true;
      }
      return c.defeated || (phase === 0 && i > 30 && p.grounded) || i > 300;
    }, 320);
    bot.releaseAll();
    rec.steps.bounce = { heroVyMax: r2(vyMax), heroApex: r2(yMax), apexAfterBounce: r2(apexAfterBounce), bounceF,
      bouncedEv: bot.log.some((e) => e.f >= b1 && e.k === 'puffer' && e.e === 'bounced'), pounded, defeated: !!c.defeated, how: c.defeatHow };
    bot.step(6);
    rec.frames.push(capOn(c, 'puffer_3_popped'));
    if (!c.defeated) rec.steps.pound2 = poundBeside(c, 1.0, 3);
    rec.steps.reward = collect(c);
    // it floats back after its respawn time: the platform is not lost for good
    const fR = bot.frame;
    rec.steps.respawned = waitState(c, ['respawn', 'drift'], 60 * 14);
    rec.steps.respawnAfterS = r2((bot.frame - fR) / 60);
    bot.step(30);
    rec.frames.push(portrait(c, 'puffer_4_back', 2.6, 0.6));
    return end(o);
  }

  /* ======================================================================
   * THE HERO LANE'S VERBS — a punch / kick on a creature (KeyF, grounded, slow)
   * ==================================================================== */

  /** Bring `kind` back (setup: Critter.reset), walk up and punch it until it goes down. */
  function strike(kind) {
    const o = begin(kind), { c, rec } = o;
    rec.kind = 'strike:' + kind;
    c.reset();
    bot.tp(c.pos.x + 0.3, 0, c.pos.z + 7);
    bot.step(10);
    const att = [];
    let capd = false;
    for (let t = 0; t < 10 && !c.defeated; t++) {
      closeTo(c, 0.9, 240);
      bot.releaseAll();
      bot.step(8);                       // slow: the action button is a punch, not a dive
      const st0 = c.state;
      bot.key('KeyF', true); bot.step(2); bot.key('KeyF', false);
      for (let k = 0; k < 24 && !c.defeated; k++) {
        bot.step(1);
        if (!capd && /punch|kick/i.test(P().state || '')) { capd = true; rec.frames.push(capOn(c, 'strike_' + kind + '_punch')); }
      }
      att.push({ before: st0, after: c.state, defeated: !!c.defeated, how: c.defeatHow || null, hero: P().state,
        strikes: P().stats ? P().stats.strikeHits : null });
    }
    rec.steps.strikes = att;
    bot.step(4);
    rec.frames.push(capOn(c, 'strike_' + kind + '_defeat'));
    rec.steps.reward = collect(c);
    return end(o);
  }

  /* ======================================================================
   * REALM BOSSES — shared fight plumbing
   * ==================================================================== */

  /** A pound as a player does it, one frame at a time: jump, then crouch at the top. */
  function makePounder() {
    let phase = 0, t = 0;
    const me = {
      get busy() { return phase !== 0; },
      start() { if (phase) return; phase = 1; t = 0; bot.key('KeyW', false); bot.key('KeyS', false); bot.key('Space', true); },
      /** call once per frame; `steer` (optional) aims the air control while rising */
      step(steer) {
        if (!phase) return;
        const p = P(); t++;
        if (phase === 1) {
          if (t >= 10) bot.key('Space', false);
          if (steer) steer();
          if (t > 4 && !p.grounded && p.vel.y < 1.0) { bot.key('Space', false); bot.key('KeyW', false); bot.key('KeyC', true); phase = 2; t = 0; }
          else if (t > 70) { bot.releaseAll(); phase = 0; }
        } else if (phase === 2) {
          if (p.grounded || t > 150) { bot.key('KeyC', false); phase = 3; t = 0; }
        } else if (phase === 3) {
          if (t > 8) phase = 0;
        }
      },
    };
    return me;
  }

  /** A hop (over a ring), one frame at a time. */
  function makeJumper() {
    let t = 0;
    return {
      get busy() { return t > 0; },
      start() { if (t) return; t = 1; bot.key('Space', true); },
      step() { if (!t) return; t++; if (t > 14) bot.key('Space', false); if (t > 16 && P().grounded) t = 0; if (t > 120) t = 0; },
    };
  }

  /**
   * Get out of every danger circle [x, z, r]: the nearest point outside all of
   * them (and inside the arena) — the move a player makes when a ring lights up
   * under him. Returns true if it had to move.
   */
  function escape(circles, ac, ar) {
    const p = P().pos;
    let inside = false;
    for (const q of circles) if (Math.hypot(p.x - q[0], p.z - q[1]) < q[2]) { inside = true; break; }
    if (!inside) return false;
    let best = null, bd = 1e9;
    for (let s = 0.6; s <= 5.0 && !best; s += 0.6) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const x = p.x + Math.cos(a) * s, z = p.z + Math.sin(a) * s;
        if (ac && Math.hypot(x - ac.x, z - ac.z) > ar) continue;
        let ok = true;
        for (const q of circles) if (Math.hypot(x - q[0], z - q[1]) < q[2] + 0.2) { ok = false; break; }
        if (ok && s < bd) { bd = s; best = [x, z]; }
      }
    }
    if (best) { bot.steer(best[0], best[1], 0); return true; }
    return false;
  }

  function toasts() {
    return [...document.querySelectorAll('.ch-toast')].map((n) => (n.textContent || '').trim()).filter(Boolean);
  }

  function bossBegin(kind) {
    const o = begin(kind);
    o.rec.hpLog = [];
    o.seen = {};
    return o;
  }
  /** Capture once per key (e.g. 'slamTele-p1'). */
  function capOnce(o, key) {
    if (o.seen[key]) return;
    o.seen[key] = true;
    o.rec.frames.push(capOn(o.c, o.c.kind + '_' + key));
  }
  function crestState() {
    const col = G.course && G.course.collectibles;
    const cr = col && col.crests ? col.crests.find((x) => x.type === 'boss' || (x.def && x.def.type === 'boss')) : null;
    return cr ? { present: !!cr.present, collected: !!(cr.collected || cr.got || cr.taken), id: cr.id } : null;
  }
  /** After the defeat: watch it vanish, the crest appear, walk to it and take it. */
  function bossAftermath(o, crestAt) {
    const { c, rec } = o;
    bot.releaseAll();
    const fD = bot.frame;
    let capd = false;
    bot.drive((i) => {
      if (!capd && c.state === 'defeat' && c.stateT > (c.info.defeatT || 3) * 0.45) { capd = true; rec.frames.push(capOn(c, c.kind + '_defeat_anim')); }
      return c.state === 'gone';
    }, 60 * 8);
    rec.vanishAfterS = r2((bot.frame - fD) / 60);
    bot.step(20);
    rec.trigger = bot.log.filter((e) => e.f >= fD && (e.e === 'trigger' || e.e === 'bossDown')).map((e) => e.k + ':' + e.e + ':' + e.a);
    rec.crestAfterDefeat = crestState();
    rec.frames.push(capAt(c.kind + '_crest_spawned', crestAt[0], crestAt[1], crestAt[2]));
    const crests0 = (G.course.collectibles.counts || {}).crests | 0;
    const gs = [];
    bot.drive(() => {
      if (gs[gs.length - 1] !== G.state) gs.push(G.state);
      const cs = crestState();
      if (cs && !cs.present) return true;
      bot.steer(crestAt[0], crestAt[2], 0.3);
      return false;
    }, 60 * 20);
    bot.releaseAll();
    bot.drive(() => { if (gs[gs.length - 1] !== G.state) gs.push(G.state); return false; }, 90);
    rec.crestTaken = { counter: ((G.course.collectibles.counts || {}).crests | 0) - crests0, gameStates: gs, crest: crestState() };
    rec.frames.push(cap(c.kind + '_crest_taken'));
  }
  function bossRecord(o) {
    const r = end(o);
    const c = o.c;
    r.hp = c.hp; r.hpMax = c.hpMax; r.phase = c.phase; r.hits = c.hits; r.said = c.said.slice();
    r.events.hits = bot.log.filter((e) => e.k === c.kind && e.f >= o.f0 && e.e === 'hit').map((e) => 'hp' + e.a + ':' + e.a2 + '@' + e.f);
    r.events.say = bot.log.filter((e) => e.k === c.kind && e.f >= o.f0 && e.e === 'say').map((e) => e.a);
    return r;
  }
  /** Walk from the ring checkpoint toward a stand point until the boss wakes; return the intro. */
  function bossIntro(o, stand) {
    const { c, rec } = o;
    bot.tp(0, 0, -9.5);
    bot.drive(() => { if (c.state === 'intro') return true; bot.steer(stand[0], stand[1], 0.5); return false; }, 900);
    bot.key('KeyW', false);
    rec.introF = bot.frame;
    bot.drive((i) => { if (i === 50) rec.frames.push(capOn(c, c.kind + '_intro')); return c.state !== 'intro'; }, 600);
    rec.introLine = c.lines.intro;
    rec.introToasts = toasts();
    rec.engagedAfterS = r2((bot.frame - rec.introF) / 60);
  }

  /* ---------------------------------------------------------- BRAMBLEHIDE */
  function bramblehide() {
    const o = bossBegin('bramblehide'), { c, rec } = o;
    const ac = c.arenaC, ar = c.arenaR - 1.0;
    bossIntro(o, [ac.x, ac.z + 6]);
    const pounder = makePounder();
    let hits0 = c.hits, lastState = '', stuckPounds = 0;
    const n = bot.drive(() => {
      if (c.defeated || c.state === 'defeat') return true;
      const st = c.state, ph = c.phase;
      if (st !== lastState) { lastState = st; }
      const p = P().pos, T = c.target;
      const dT = Math.hypot(p.x - T.x, p.z - T.z);
      if (pounder.busy) { pounder.step(); return false; }
      if (st === 'slamTele' || st === 'slam') {
        if (st === 'slamTele' && c.stateT > c.telegraphFor * 0.5) capOnce(o, 'slamTele_p' + ph);
        // out of the marked ring (1.7 m), but stay close enough to pound the bud
        if (dT < 2.05) {
          let ex = p.x - T.x, ez = p.z - T.z;
          if (Math.hypot(ex, ez) < 0.3) { const bx = T.x - c.pos.x, bz = T.z - c.pos.z, bl = Math.hypot(bx, bz) || 1; ex = -bz / bl; ez = bx / bl; }
          const l = Math.hypot(ex, ez) || 1;
          bot.steer(T.x + ex / l * 2.3, T.z + ez / l * 2.3, 0);
        } else bot.releaseAll();
        return false;
      }
      if (st === 'stuck') {
        capOnce(o, 'stuck_p' + ph);
        if (dT > 1.15) { bot.steer(T.x, T.z, 0); return false; }
        bot.key('KeyW', false);
        stuckPounds++;
        pounder.start();
        return false;
      }
      if (st === 'sprayTele' || st === 'spray') {
        if (st === 'sprayTele' && c.stateT > 0.4) capOnce(o, 'thornVolley_p' + ph);
        const circles = [];
        for (let i = 0; i < 5; i++) if (c.marks.on[i]) circles.push([c.seedT[i * 3], c.seedT[i * 3 + 2], 1.35]);
        if (!escape(circles, ac, ar)) bot.releaseAll();
        return false;
      }
      if (st === 'hurt') { capOnce(o, 'hurt_hp' + c.hp); bot.releaseAll(); return false; }
      if (st === 'enrage') { capOnce(o, 'enrage_p' + ph); }
      // otherwise keep clear of the body and let it line up its tail
      const dB = Math.hypot(p.x - c.pos.x, p.z - c.pos.z);
      if (dB < 3.2) bot.steer(c.pos.x + (p.x - c.pos.x) / dB * 4.5, c.pos.z + (p.z - c.pos.z) / dB * 4.5, 0);
      else bot.releaseAll();
      return false;
    }, 60 * 150);
    rec.fightS = r2(n / 60);
    rec.stuckPounds = stuckPounds;
    rec.hitsLanded = c.hits - hits0;
    if (c.state === 'defeat') bossAftermath(o, [0, 1, -9]);
    return bossRecord(o);
  }

  /* -------------------------------------------------------------- SLAGMAW */
  function slagmaw() {
    const o = bossBegin('slagmaw'), { c, rec } = o;
    const ac = c.arenaC, ar = c.arenaR - 1.0;
    bossIntro(o, [ac.x, ac.z + 6.5]);
    const pounder = makePounder(), jumper = makeJumper();
    const carry = { phase: 0, bomb: -1, t: 0, tries: 0, presses: 0 };
    let kicks = 0, target = -1;
    const n = bot.drive(() => {
      if (c.defeated || c.state === 'defeat') return true;
      const st = c.state, ph = c.phase;
      const p = P().pos;
      if (pounder.busy) { pounder.step(); return false; }
      jumper.step();
      // the fire ring: hop it as it reaches Nim
      if (c.ringOn) {
        capOnce(o, 'fireRing_p' + ph);
        const d = Math.hypot(p.x - c.pos.x, p.z - c.pos.z);
        if (!jumper.busy && c.ringR < d && d - c.ringR < 1.6 && P().grounded) jumper.start();
        if (jumper.busy) return false;
      }
      if (st === 'lobTele' && c.stateT > 0.35) capOnce(o, 'lobTele_p' + ph);
      if (st === 'hurt') capOnce(o, 'hurt_hp' + c.hp);
      if (st === 'march') capOnce(o, 'march_p' + ph);
      const circles = [];
      if (st === 'lobTele' || st === 'lob') for (let i = 0; i < c.nBombs; i++) circles.push([c.btx[i * 3], c.btx[i * 3 + 2], 1.9]);
      for (let i = 0; i < 4; i++) {
        const s = c.bs[i], k = i * 3;
        if (s === 1) circles.push([c.btx[c.bombMark[i] * 3], c.btx[c.bombMark[i] * 3 + 2], 1.9]);
        else if (s === 2) circles.push([c.bp[k], c.bp[k + 2], 1.3]);
        else if (s === 4 && c.bt[i] > 0.35) circles.push([c.bp[k], c.bp[k + 2], 3.0]);
      }
      circles.push([c.pos.x, c.pos.z, 2.6]);
      // a DARK bomb: walk up beside it and pound
      target = -1;
      let bd = 1e9;
      for (let i = 0; i < 4; i++) {
        const s = c.bs[i];
        if (s === 3 || (s === 4 && c.bt[i] < 0.3)) {
          const k = i * 3, d = Math.hypot(p.x - c.bp[k], p.z - c.bp[k + 2]);
          if (d < bd) { bd = d; target = i; }
        }
      }
      const threatened = circles.some((q) => Math.hypot(p.x - q[0], p.z - q[1]) < q[2]);
      /* THE FIRST HIT BY HAND (the hero lane's carry): pick a dark bomb up with
         the action key, turn to the grate, throw it. Falls back to the pound. */
      if (carry.phase === 0 && c.hits === 0 && carry.tries < 3 && target >= 0 && !(st === 'lobTele' || st === 'lob')) { carry.phase = 1; carry.bomb = target; carry.t = 0; carry.tries++; }
      if (carry.phase > 0) {
        carry.t++;
        const i = carry.bomb, k = i * 3;
        const bx = c.bp[k], bz = c.bp[k + 2];
        if (carry.phase === 1) {                      // walk up to it from the far side
          if (c.bs[i] !== 3 && c.bs[i] !== 4) { carry.phase = 0; return false; }
          let ax = bx - c.pos.x, az = bz - c.pos.z;
          const al = Math.hypot(ax, az) || 1;
          const sx = bx + ax / al * 0.75, sz = bz + az / al * 0.75;
          if (Math.hypot(p.x - sx, p.z - sz) > 0.2 && carry.t < 240) { bot.steer(sx, sz, 0.6); return false; }
          bot.releaseAll(); carry.phase = 2; carry.t = 0; return false;
        }
        if (carry.phase === 2) {                      // face the bomb and stop
          bot.aim(bx, bz);
          bot.key('KeyW', carry.t < 3);
          if (carry.t >= 12) { bot.key('KeyW', false); bot.key('KeyF', true); carry.phase = 3; carry.t = 0; }
          return false;
        }
        if (carry.phase === 3) {                      // the pick-up
          if (carry.t === 2) bot.key('KeyF', false);
          if (c.bs[i] === 6) { rec.steps.pickedUpF = bot.frame; carry.phase = 4; carry.t = 0; capOnce(o, 'bombLifted'); return false; }
          if (carry.t > 40) { carry.phase = 0; bot.releaseAll(); rec.steps.pickupFailed = (rec.steps.pickupFailed || 0) + 1; }
          return false;
        }
        if (carry.phase === 4) {                      // lift done, then turn to the grate
          if (P().state === 'pickup') { carry.t = 0; return false; }
          bot.aim(c.pos.x, c.pos.z);
          bot.key('KeyW', carry.t < 10);
          if (carry.t >= 16) { bot.key('KeyW', false); bot.key('KeyF', true); carry.phase = 5; carry.t = 0; carry.presses = 1; }
          return false;
        }
        if (carry.phase === 5) {                      // the throw (press again if the first was eaten)
          if (carry.t === 2) bot.key('KeyF', false);
          if (c.bs[i] === 6 && carry.t > 0 && carry.t % 20 === 0 && carry.presses < 4) { bot.aim(c.pos.x, c.pos.z); bot.key('KeyF', true); carry.presses++; }
          if (c.bs[i] === 6 && carry.t % 20 === 2) bot.key('KeyF', false);
          if (c.bs[i] === 7 && !rec.steps.thrownF) { rec.steps.thrownF = bot.frame; capOnce(o, 'bombThrown'); }
          if (carry.t > 150 || c.bs[i] === 0 || c.state === 'hurt') { carry.phase = 0; bot.releaseAll(); rec.steps.throwResult = { state: c.state, hits: c.hits, bomb: c.bs[i], presses: carry.presses }; }
          return false;
        }
      }
      // incoming bombs that will land on Nim before a pound could finish
      let incoming = st === 'lob' && c.stateT > 0.15;
      for (let i = 0; i < 4 && !incoming; i++) if (c.bs[i] === 1 && c.bt[i] > 0.35) {
        const m = c.bombMark[i] * 3;
        if (Math.hypot(p.x - c.btx[m], p.z - c.btx[m + 2]) < 1.9) incoming = true;
      }
      if (target >= 0 && !incoming) {
        capOnce(o, 'darkBomb_p' + ph);
        const k = target * 3, bx = c.bp[k], bz = c.bp[k + 2];
        // the pound's shock reaches TUNE.pound.shockRadius + 0.3 = 2.5 m: 1.6 m is plenty
        if (bd > 1.6) bot.steer(bx, bz, 0.6);
        else { bot.key('KeyW', false); kicks++; pounder.start(); }
        return false;
      }
      if (threatened) { if (!escape(circles, ac, ar)) bot.releaseAll(); return false; }
      if (st === 'dormant') { bot.steer(ac.x, ac.z, 0.5); return false; }   // it slept: walk back in
      // hold a spot ~6 m off its furnace, inside the ring
      const dB = Math.hypot(p.x - c.pos.x, p.z - c.pos.z) || 1;
      let hx = c.pos.x + (p.x - c.pos.x) / dB * 6.5, hz = c.pos.z + (p.z - c.pos.z) / dB * 6.5;
      const hd = Math.hypot(hx - ac.x, hz - ac.z), lim = c.arenaR - 2.5;
      if (hd > lim) { hx = ac.x + (hx - ac.x) / hd * lim; hz = ac.z + (hz - ac.z) / hd * lim; }
      if (dB < 5.0 || Math.hypot(p.x - ac.x, p.z - ac.z) > c.arenaR - 1.5) bot.steer(hx, hz, 0.5);
      else bot.releaseAll();
      return false;
    }, 60 * 170);
    rec.fightS = r2(n / 60);
    rec.kickAttempts = kicks;
    if (c.state === 'defeat') bossAftermath(o, [0, 1, -9]);
    return bossRecord(o);
  }

  /* ------------------------------------------------------------- HOARHORN */
  function hoarhorn() {
    const o = bossBegin('hoarhorn'), { c, rec } = o;
    const ac = c.arenaC, half = c.floeHalf;
    // the floe is a single jump off the north shore
    bot.tp(0, 0, -10);
    let jumped = false;
    bot.drive((i) => {
      const p = P();
      if (jumped && p.grounded && p.pos.z < ac.z + half - 0.6) return true;
      bot.steer(0, ac.z + half - 3.0, 0);
      if (!jumped && p.pos.z < ac.z + half + 3.4 && p.grounded) { bot.key('Space', true); jumped = true; }
      if (bot.held('Space') && !p.grounded && p.vel.y < 2) bot.key('Space', false);
      return false;
    }, 300);
    bot.releaseAll();
    rec.onFloe = bot.hero();
    // brake on the ice and walk in until it wakes
    rec.introF = bot.frame;
    bot.drive(() => { if (c.state === 'intro') return true; bot.servo(ac.x, ac.z + 4.0, 3.0); return false; }, 400);
    bot.drive((i) => { bot.servo(ac.x, ac.z + 4.5, 3.0); if (i === 50) rec.frames.push(capOn(c, 'hoarhorn_intro')); return c.state !== 'intro'; }, 600);
    rec.introLine = c.lines.intro;
    rec.introToasts = toasts();
    const pounder = makePounder();
    let stand = null, dodged = false, pounds = 0, fell = 0, climbs = 0;
    const inner = half - 3.0;
    const pickStand = () => {
      // the edge-side spot farthest from the beast, 3 m in from the lip
      const cands = [[ac.x + inner, ac.z], [ac.x - inner, ac.z], [ac.x, ac.z + inner], [ac.x, ac.z - inner]];
      let b = cands[0], bd = -1;
      for (const q of cands) { const d = Math.hypot(q[0] - c.pos.x, q[1] - c.pos.z); if (d > bd) { bd = d; b = q; } }
      return b;
    };
    const n = bot.drive(() => {
      if (c.defeated || c.state === 'defeat') return true;
      const st = c.state, ph = c.phase;
      const pl = P(), p = pl.pos;
      // in the sea: swim to the nearest lip and surface-jump out
      if (pl.inWater || p.y < ac.y - 0.45) {
        fell++;
        const lim = half - 0.3;
        const ex = clampN(p.x - ac.x, -lim, lim), ez = clampN(p.z - ac.z, -lim, lim);
        const ix = clampN(p.x - ac.x, -(half - 1.6), half - 1.6), iz = clampN(p.z - ac.z, -(half - 1.6), half - 1.6);
        const dEdge = Math.hypot(p.x - (ac.x + ex), p.z - (ac.z + ez));
        bot.aim(ac.x + ix, ac.z + iz);
        bot.key('KeyW', true);
        if (dEdge < 1.3 && !bot.held('Space')) { bot.key('Space', true); climbs++; }
        else if (bot.held('Space')) bot.key('Space', false);
        return false;
      }
      if (pounder.busy) { pounder.step(); return false; }
      if (st === 'chargeTele') { capOnce(o, 'chargeTele_p' + ph); dodged = false; }
      if (st === 'charge') {
        if (c.stateT > 0.15) capOnce(o, 'charge_p' + ph);
        if (!dodged) {
          // sidestep across the charge line, toward the side with more ice
          const dx = c.chargeDir.x, dz = c.chargeDir.z;
          const s1x = p.x - dz * 2.6, s1z = p.z + dx * 2.6, s2x = p.x + dz * 2.6, s2z = p.z - dx * 2.6;
          const e1 = c._edgeDist(s1x, s1z), e2 = c._edgeDist(s2x, s2z);
          stand = e1 > e2 ? [s1x, s1z] : [s2x, s2z];
          dodged = true;
        }
        bot.servo(stand[0], stand[1], 6.0, 3.0);
        return false;
      }
      if (st === 'teeter') {
        capOnce(o, 'teeter_p' + ph);
        const d = Math.hypot(p.x - c.pos.x, p.z - c.pos.z);
        if (d > 2.7) { bot.servo(c.pos.x + (p.x - c.pos.x) / d * 2.2, c.pos.z + (p.z - c.pos.z) / d * 2.2, 5.0, 3.0); return false; }
        pounds++;
        pounder.start();
        return false;
      }
      if (st === 'fall') { capOnce(o, 'dunk_hp' + c.hp); bot.servo(p.x, p.z, 0.1); return false; }
      if (st === 'breathTele' || st === 'breath') {
        if (st === 'breathTele' && c.stateT > 0.5) capOnce(o, 'frostBreath_p' + ph);
        // out of the cone: sidestep across its facing
        const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
        const rx = p.x - c.pos.x, rz = p.z - c.pos.z, rl = Math.hypot(rx, rz) || 1;
        const dot = (rx * fx + rz * fz) / rl;
        if (dot > 0.6 && rl < 7.5) {
          if (!stand || (st === 'breathTele' && c.stateT < 0.05)) {
            const sx = p.x - fz * 3, sz = p.z + fx * 3, tx = p.x + fz * 3, tz = p.z - fx * 3;
            stand = c._edgeDist(sx, sz) > c._edgeDist(tx, tz) ? [sx, sz] : [tx, tz];
          }
          bot.servo(stand[0], stand[1], 5.0, 2.5);
        } else bot.servo(p.x, p.z, 0.1);
        return false;
      }
      if (st === 'return' || st === 'enrage' || st === 'hurt' || st === 'dormant') {
        // it lands back in the middle: be out by the rim (and, asleep, walk back in)
        stand = pickStand();
        bot.servo(stand[0], stand[1], 3.5);
        return false;
      }
      // shuffle / recover / stagger: take the far side so its charge ends at the lip
      if (!stand || Math.hypot(stand[0] - c.pos.x, stand[1] - c.pos.z) < 4.0) stand = pickStand();
      bot.servo(stand[0], stand[1], 3.5);
      return false;
    }, 60 * 170);
    rec.fightS = r2(n / 60);
    rec.teeterPounds = pounds;
    rec.heroInSeaFrames = fell;
    rec.climbOutJumps = climbs;
    rec.pushes = bot.log.filter((e) => e.k === 'hoarhorn' && e.e === 'pushed').map((e) => e.a + '@' + e.f);
    if (c.state === 'defeat') bossAftermath(o, [0, 1, -9]);
    return bossRecord(o);
  }

  /* -------------------------------------------------------------- GYRARCH */
  function gyrarch() {
    const o = bossBegin('gyrarch'), { c, rec } = o;
    const ac = c.arenaC, ar = c.arenaR - 0.8;
    bossIntro(o, [ac.x, ac.z + 8.5]);
    const pounder = makePounder(), jumper = makeJumper();
    let mode = 'ground', gear = -1, leaps = 0, boards = 0, onGearF = 0, leapFails = 0;
    const deckTop = () => c.pos.y + 1.05;
    const gearTop = (i) => c.platPos[i * 3 + 1] + 0.2;
    const gearU = (i) => (c.platPos[i * 3 + 1] - c.floorY - 0.35) / Math.max(0.1, c.hoverH - 0.55);
    const onGear = (i) => {
      const p = P();
      if (i < 0 || !p.grounded) return false;
      const k = i * 3;
      return Math.hypot(p.pos.x - c.platPos[k], p.pos.z - c.platPos[k + 2]) < 1.25 && Math.abs(p.pos.y - gearTop(i)) < 0.35;
    };
    const ventLeft = () => [3.8, 3.2, 2.7][c.phase - 1] - c.stateT;
    let leapT = 0;
    const n = bot.drive(() => {
      if (c.defeated || c.state === 'defeat') return true;
      const st = c.state, ph = c.phase;
      const pl = P(), p = pl.pos;
      if (st === 'aimTele' && c.stateT > 0.45) capOnce(o, 'aimBeam_p' + ph);
      if (st === 'vent' && c.stateT > 0.5) capOnce(o, 'vent_p' + ph);
      if (st === 'hurt') capOnce(o, 'hurt_hp' + c.hp);
      if (c.sweepOn) capOnce(o, 'sweep_p' + ph);
      if (pounder.busy) {
        pounder.step(() => { bot.aim(c.pos.x, c.pos.z); bot.key('KeyW', Math.hypot(p.x - c.pos.x, p.z - c.pos.z) > 0.35); });
        return false;
      }
      jumper.step();
      // the floor sweep (phase 3): hop it on the floor
      if (c.sweepOn && pl.grounded && p.y < c.floorY + 0.7) {
        const d = Math.hypot(p.x - ac.x, p.z - ac.z);
        if (!jumper.busy && c.sweepR < d && d - c.sweepR < 1.3) jumper.start();
      }
      if (mode === 'leap') {
        leapT++;
        // a fresh press (a held Space is no press), rise clear of the body,
        // then air control onto the crown and pound once over the core
        const d = Math.hypot(p.x - c.pos.x, p.z - c.pos.z);
        bot.aim(c.pos.x, c.pos.z);
        if (leapT === 1) { bot.key('Space', false); bot.key('KeyW', false); return false; }
        if (leapT === 2) { bot.key('Space', true); return false; }
        bot.key('KeyW', d > 0.3 && p.y > deckTop() - 0.1);
        if (leapT >= 16) bot.key('Space', false);
        if (d < 0.75 && p.y > deckTop() + 0.15 && pl.vel.y < 3) { bot.key('Space', false); bot.key('KeyW', false); bot.key('KeyC', true); mode = 'pound'; leapT = 0; }
        if (pl.grounded && leapT > 12) { if (p.y < deckTop() - 0.5) leapFails++; bot.releaseAll(); mode = 'ground'; }
        return false;
      }
      if (mode === 'pound') {
        leapT++;
        if (pl.grounded || leapT > 120) { bot.key('KeyC', false); mode = 'ground'; }
        return false;
      }
      // standing on the crown while it vents: pound the core where he stands
      if (pl.grounded && Math.abs(p.y - deckTop()) < 0.4 && Math.hypot(p.x - c.pos.x, p.z - c.pos.z) < 1.3 && st === 'vent') {
        pounder.start();
        return false;
      }
      // riding: stay at the gear's centre; leap for the crown while it vents
      if (gear >= 0 && onGear(gear)) {
        onGearF++;
        mode = 'ride';
        const k = gear * 3;
        if (gearU(gear) > 0.6) capOnce(o, 'ridingGear_p' + ph);
        const dB = Math.hypot(p.x - c.pos.x, p.z - c.pos.z);
        // ride the gear's inner edge, the side nearest the crown
        const gx = c.platPos[k], gz = c.platPos[k + 2];
        let ix = c.pos.x - gx, iz = c.pos.z - gz;
        const il = Math.hypot(ix, iz) || 1;
        const sx = gx + ix / il * 0.6, sz = gz + iz / il * 0.6;
        const atEdge = Math.hypot(p.x - sx, p.z - sz) < 0.45;
        if (st === 'vent' && ventLeft() > 0.9 && gearTop(gear) > deckTop() - 1.35 && dB < 3.6 && atEdge) {
          leaps++; mode = 'leap'; leapT = 0;
          return false;
        }
        bot.servo(sx, sz, 3.0, 2.5);
        return false;
      }
      mode = 'ground';
      // pick the lowest gear that is about to rise, walk under it, hop on
      let best = -1, bu = 1e9;
      for (let i = 0; i < 3; i++) { const u = gearU(i); const d = Math.hypot(p.x - c.platPos[i * 3], p.z - c.platPos[i * 3 + 2]); const s = u * 12 + d * 0.25; if (s < bu) { bu = s; best = i; } }
      gear = best;
      const k = gear * 3;
      const gx = c.platPos[k], gz = c.platPos[k + 2];
      const d = Math.hypot(p.x - gx, p.z - gz);
      bot.steer(gx, gz, 0.2);
      if (d < 1.6 && gearTop(gear) - p.y < 1.4 && gearTop(gear) - p.y > 0.25 && pl.grounded && !jumper.busy) { boards++; jumper.start(); }
      return false;
    }, 60 * 200);
    rec.fightS = r2(n / 60);
    rec.leaps = leaps; rec.leapFails = leapFails; rec.boards = boards; rec.onGearS = r2(onGearF / 60);
    if (c.state === 'defeat') bossAftermath(o, [0, 1, -9]);
    return bossRecord(o);
  }

  return { burrower, podspitter, slagcrab, emberimp, skater, snowcub, sentry, puffer, strike,
    bramblehide, slagmaw, hoarhorn, gyrarch, cap, portrait, crit, summary, frames };
}

export default makeScenarios;
