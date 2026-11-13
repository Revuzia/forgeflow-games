/**
 * CRESTBOUND — _harness/cr_bot.js   (creatures lane arena driver; DEV ONLY)
 * ---------------------------------------------------------------------------
 * A closed-loop "player" for the creature arena. It ONLY does what a player
 * does: it holds and releases real keys through `input.__test.press/release`
 * (real KeyboardEvents on window: W / S / Space / C) and turns the follow
 * camera toward where it wants to go (a mouse player's steering; the same
 * convention spawnwalk.py and the SM64 audit use). The engine is stopped and
 * every frame is `game.update(1/60)` stepped by hand, so a loaded machine
 * cannot change what happens — only how long it takes.
 *
 * Every primitive steps frames until its goal or its budget and returns a
 * record; creature/boss events are logged with their frame number.
 */

export function makeBot() {
  const A = globalThis.CRESTBOUND, G = A.game, E = A.engine;
  const T = G.input.__test;
  const held = new Set();
  const log = [];
  let frame = 0;
  const DT = 1 / 60;

  function key(code, on) {
    if (on) { if (!held.has(code)) { T.press(code); held.add(code); } }
    else if (held.has(code)) { T.release(code); held.delete(code); }
  }
  function releaseAll() { for (const c of Array.from(held)) T.release(c); held.clear(); }
  const P = () => G.player;
  let lastGS = G.state;
  function tick() {
    G.update(DT); frame++;
    if (G.state !== lastGS) { log.push({ f: frame, k: 'game', e: 'state', a: G.state, a2: lastGS }); lastGS = G.state; }
  }
  function aim(x, z) {
    const p = P().pos;
    const yaw = Math.atan2(-(x - p.x), -(z - p.z));
    G.cam.yaw = yaw;
    if ('_rcHoldT' in G.cam) G.cam._rcHoldT = 0;
    return yaw;
  }
  const r2 = (v) => Math.round(v * 100) / 100;
  function hero() {
    const p = P();
    return { f: frame, p: [r2(p.pos.x), r2(p.pos.y), r2(p.pos.z)], v: [r2(p.vel.x), r2(p.vel.y), r2(p.vel.z)], st: p.state, gr: !!p.grounded, dead: !!p.dead, gs: G.state };
  }
  function crit(kind) { return (G.course && G.course.critters || []).find((c) => c.kind === kind) || null; }
  function cinfo(c) {
    if (!c) return null;
    return { kind: c.kind, st: c.state, p: [r2(c.pos.x), r2(c.pos.y), r2(c.pos.z)], defeated: !!c.defeated, hp: c.hp, phase: c.phase,
      aware: !!c.aware, visible: !!(c.body && c.body.visible), emote: !!(c.emote && c.emote.visible) };
  }
  function coins() { const col = G.course && G.course.collectibles; return col && col.counts ? col.counts.coins | 0 : 0; }
  function hdist(x, z) { const p = P().pos; return Math.hypot(x - p.x, z - p.z); }

  const bot = {
    log, hero, crit: (k) => cinfo(crit(k)), coins, releaseAll,
    get frame() { return frame; },

    /** Subscribe to every critter's events (call once per course load). */
    watch() {
      const cs = (G.course && G.course.critters) || [];
      for (const c of cs) {
        if (c.__crWatched) continue;
        c.__crWatched = true;
        for (const e of ['state', 'notice', 'defeated', 'coins', 'hit', 'say', 'bossDown', 'intro', 'stuck', 'teeter', 'vent', 'bombKicked', 'pushed', 'bump', 'clonk', 'spit', 'fire', 'ballHit', 'trigger', 'lost', 'bounced', 'stagger', 'bombHeld', 'bombThrown']) {
          c.events.on(e, (...a) => {
            const arg = a.length && (typeof a[0] === 'string' || typeof a[0] === 'number') ? a[0] : (e === 'say' ? a[1] : null);
            log.push({ f: frame, k: c.kind, e, a: arg, a2: e === 'say' ? a[1] : (e === 'coins' ? a[0] : (e === 'hit' ? a[2] : undefined)) });
          });
        }
      }
      if (G.course && G.course.events && !G.course.__crWatched) {
        G.course.__crWatched = true;
        G.course.events.on('trigger', (id) => log.push({ f: frame, k: 'course', e: 'trigger', a: id }));
      }
      return cs.map((c) => c.kind);
    },

    /** Teleport (setup only) then stand still a few frames. */
    tp(x, y, z) { releaseAll(); G.__dev.tp(x, y, z); P().__test.setVel({ x: 0, y: 0, z: 0 }); for (let i = 0; i < 20; i++) tick(); return hero(); },

    idle(n) { releaseAll(); for (let i = 0; i < n; i++) tick(); return hero(); },

    /** Step until pred() is true or the budget runs out. pred sees (hero, frame). */
    waitFor(kind, states, max, dodge) {
      releaseAll();
      const want = Array.isArray(states) ? states : [states];
      for (let i = 0; i < max; i++) {
        const c = crit(kind);
        if (c && want.indexOf(c.state) >= 0) return { ok: true, f: frame, c: cinfo(c), h: hero() };
        if (dodge) bot._dodgeStep(dodge);
        tick();
      }
      return { ok: false, f: frame, c: cinfo(crit(kind)), h: hero() };
    },

    /** Walk toward (x, z) with W, feathering the key inside `slow` metres. */
    goto(x, z, tol, max, slow) {
      tol = tol || 0.8; max = max || 900; slow = slow === undefined ? 2.5 : slow;
      let best = 1e9, still = 0;
      for (let i = 0; i < max; i++) {
        const d = hdist(x, z);
        if (d < tol) break;
        aim(x, z);
        const v = P().vel, hs = Math.hypot(v.x, v.z);
        const want = d < slow ? 1.0 + d * 1.6 : 99;
        key('KeyW', hs < want);
        tick();
        if (d < best - 0.02) { best = d; still = 0; } else if (++still > 180) break;
      }
      key('KeyW', false);
      for (let i = 0; i < 8; i++) tick();
      return { d: r2(hdist(x, z)), h: hero() };
    },

    /** Walk to a point `dist` metres from (x, z) on the hero's side of it. */
    approach(x, z, dist, max) {
      const p = P().pos;
      let dx = p.x - x, dz = p.z - z;
      const l = Math.hypot(dx, dz) || 1;
      dx /= l; dz /= l;
      return bot.goto(x + dx * dist, z + dz * dist, 0.35, max || 900, 2.0);
    },

    /** Move away from (x, z) until `dist` metres clear (one frame per call from waitFor). */
    _dodgeStep(d) {
      const p = P().pos;
      let dx = p.x - d.x, dz = p.z - d.z;
      const l = Math.hypot(dx, dz);
      if (l > d.r) { key('KeyW', false); return; }
      if (l < 1e-3) { dx = 1; dz = 0; } else { dx /= l; dz /= l; }
      if (d.side) { const t = dx; dx = -dz; dz = t; }
      aim(p.x + dx * 5, p.z + dz * 5);
      key('KeyW', true);
    },

    /** Run from a point until clear (a sidestep). */
    dodge(x, z, r, side, max) {
      releaseAll();
      for (let i = 0; i < (max || 120); i++) {
        const p = P().pos;
        if (Math.hypot(p.x - x, p.z - z) > r) break;
        bot._dodgeStep({ x, z, r, side });
        tick();
      }
      key('KeyW', false);
      for (let i = 0; i < 6; i++) tick();
      return hero();
    },

    /** Strafe: hold W toward a world point for n frames. */
    run(x, z, n) {
      for (let i = 0; i < n; i++) { aim(x, z); key('KeyW', true); tick(); }
      key('KeyW', false);
      return hero();
    },

    /**
     * Jump and come down ON a moving target (a stomp), or pound it (opts.pound).
     * `tgt()` -> {x, y, z, top}: the target's position and the height of its top.
     * In the air the bot steers with W / S toward where the target will be when
     * its feet reach `top` (what a player does with the stick mid-jump).
     */
    hop(tgt, opts) {
      opts = opts || {};
      releaseAll();
      const t0 = tgt();
      aim(t0.x, t0.z);
      for (let i = 0; i < 3; i++) tick();
      key('Space', true);
      let air = false, pounded = false, landed = null, maxY = -1e9;
      const out = { frames: [] };
      for (let i = 0; i < (opts.max || 150); i++) {
        const t = tgt();
        const p = P();
        const dx = t.x - p.pos.x, dz = t.z - p.pos.z, d = Math.hypot(dx, dz);
        aim(t.x, t.z);
        if (i >= (opts.hold || 16)) key('Space', false);
        if (!p.grounded) air = true;
        maxY = Math.max(maxY, p.pos.y);
        const vy = p.vel.y;
        // time until the feet come down through the target's top
        const g = vy > 0 ? 34 : 46;
        const h = p.pos.y - t.top;
        const disc = vy * vy + 2 * g * Math.max(h, 0);
        const tt = Math.max(0.06, (vy + Math.sqrt(Math.max(0, disc))) / g);
        const dirx = d > 1e-3 ? dx / d : 0, dirz = d > 1e-3 ? dz / d : 0;
        const vh = p.vel.x * dirx + p.vel.z * dirz;
        const want = Math.min(opts.vmax || 6, d / tt);
        if (opts.pound && !pounded && air && d < (opts.poundR || 0.6) && vy < 2.5) {
          key('KeyW', false); key('KeyS', false); key('Space', false);
          key('KeyC', true); pounded = true; out.poundF = frame;
        } else if (!pounded) {
          key('KeyW', vh < want - 0.25);
          key('KeyS', vh > want + 0.9 && d < 1.2);
        }
        tick();
        if (i % 3 === 0) out.frames.push([frame, r2(p.pos.x), r2(p.pos.y), r2(p.pos.z), p.state, r2(d)]);
        if (air && p.grounded) { landed = hero(); break; }
      }
      releaseAll();
      for (let i = 0; i < 6; i++) tick();
      out.landed = landed; out.maxY = r2(maxY); out.pounded = pounded; out.h = hero();
      return out;
    },

    /** Stand still, jump straight up and pound (a pound BESIDE something). */
    poundHere() {
      releaseAll();
      key('Space', true);
      let air = false, pounded = false;
      for (let i = 0; i < 120; i++) {
        const p = P();
        if (i >= 10) key('Space', false);
        if (!p.grounded) air = true;
        if (air && !pounded && p.vel.y < 1.0) { key('KeyC', true); pounded = true; }
        tick();
        if (air && p.grounded) break;
      }
      releaseAll();
      for (let i = 0; i < 12; i++) tick();
      return hero();
    },

    /** Render the frame the player sees right now. */
    render() { E.render(DT); return frame; },

    /** Park the camera on a point for a portrait, render, and leave (the next update restores the follow cam). */
    portrait(x, y, z, dist, h, yaw) {
      const cam = E.camera;
      const a = yaw === undefined ? Math.atan2(P().pos.x - x, P().pos.z - z) : yaw;
      cam.position.set(x + Math.sin(a) * dist, y + h, z + Math.cos(a) * dist);
      cam.lookAt(x, y + h * 0.35, z);
      cam.updateMatrixWorld(true);
      E.render(DT); E.render(DT);
      return frame;
    },

    step(n) { for (let i = 0; i < n; i++) tick(); return hero(); },

    /* ---- per-frame driving (closed loops written by the scenarios) ---------- */

    /** Hold or release one key (a real KeyboardEvent on change). */
    key,
    /** Turn the follow camera (the stick frame) toward a world point. */
    aim,
    /** Is a key held right now? */
    held(code) { return held.has(code); },
    /**
     * Step frames, calling `each(i)` BEFORE every frame (it presses keys / aims);
     * stop when it returns true or after `max` frames. Returns frames stepped.
     */
    drive(each, max) {
      let i = 0;
      for (; i < max; i++) {
        if (each(i) === true) break;
        tick();
      }
      return i;
    },
    /** Steer one frame toward (x, z) with W, feathered inside `slow` metres. */
    steer(x, z, slow) {
      const d = hdist(x, z);
      aim(x, z);
      const v = P().vel, hs = Math.hypot(v.x, v.z);
      const s = slow === undefined ? 1.2 : slow;
      const want = d < s ? 0.6 + d * 2.2 : 99;
      key('KeyW', d > 0.12 && hs < want);
      return d;
    },
    /**
     * Velocity servo toward (x, z): want speed min(vmax, k*d) at the point, and
     * push the stick (camera yaw + W) along (wanted - actual) velocity. On ICE
     * (friction 1.6 m/s^2) this is what brakes: releasing W there glides for
     * metres. On normal ground it simply arrives without overshoot.
     */
    servo(x, z, vmax, k) {
      const p = P().pos, v = P().vel;
      const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
      const sp = Math.min(vmax || 4.5, (k || 1.6) * d);
      const vx = d > 1e-3 ? dx / d * sp : 0, vz = d > 1e-3 ? dz / d * sp : 0;
      const ex = vx - v.x, ez = vz - v.z, e = Math.hypot(ex, ez);
      if (e < 0.35) { key('KeyW', false); return d; }
      aim(p.x + ex * 5, p.z + ez * 5);
      key('KeyW', true);
      return d;
    },
    hdist,
  };
  return bot;
}
