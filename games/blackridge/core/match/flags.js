// core/match/flags.js [W8] — THE FLAG STATE MACHINE (modes.md §3.3, complete;
// PVP_BUILD_PLAN Part 4.1 row W8; freeze amendment b for the `flag` event).
//
// Each flag is exactly one of AT_STAND | CARRIED | DROPPED, and the module
// asserts that invariant EVERY TICK (AC-5) — a violation is counted, logged
// and self-healed by force-return, never silently carried forward.
//
// THREE-free, Node-runnable, deterministic. Draws randomness ONLY from the
// m.rng match stream (dropPoint's nav.randomPoint call). Allocation on the
// per-tick path is limited to transition moments (events are rare by
// construction — a flag changes state a handful of times a minute).
//
// HONESTY BOUNDARY (Part 3.8, doctrine §2): `flag.pos` is the RENDER truth —
// core/match/flagview.js follows it every frame (C22) because a flag you can
// SEE is where it is. What the enemy TEAM is told about it is `pubPos`:
//   AT_STAND → the stand. DROPPED → the drop point (a dropped objective is
//   public property, like the marker — modes.md §3.5.5). CARRIED → null
//   until revealed, then the BEACON: a {pos, t} sample refreshed every
//   `beacon.refreshS` (3.0 s), quantised to `beacon.quantM` (6 m). W7's
//   objective layer must consume pubPos/beacon ONLY, never live `pos` of a
//   carried flag — its own selftest greps for that (AC-34/AC-35).
//
// Carrier restrictions (modes.md §3.5), enforced here because flag state is
// match state: no health regen while carrying (hp clamp — the only upward hp
// path for a bot is retreat regen and for the human timed regen, both of
// which this clamp exactly cancels at ≤0.6 HP/tick fidelity); the HUMAN
// carrier's grenades are stashed to zero and restored when the carry ends,
// and their tac-sprint tank is drained (base sprint stays — §3.2). A BOT
// carrier's grenade suppression lives in W7's carrier role (`noGrenade` on
// bot._obj, the AI-lane channel this mode may not write) — flagged in the
// lane report, not hidden.

const FLAG_DEFAULTS = {
  pickupR: 1.2, pickupDy: 2.0,
  revealS: 8.0, carryCapS: 120.0, dropReturnS: 30.0,
  stuckStrikes: 3, stuckCheckHz: 1,
  captureNeedsOwnFlagHome: true,
  beacon: { refreshS: 3.0, quantM: 6.0 },
};

function d2(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return Math.sqrt(dx * dx + dz * dz); }
function dh(a, b) { return d2(a[0], a[2], b[0], b[2]); }

export { FLAG_DEFAULTS };

// makeFlags(m, cfgIn, on) — m is the match facade (Part 3.1). `on` hooks are
// ctf.js's scoring/HUD seam: {grab, pickup, drop, ret, capture, blocked, log}
// — all optional. Events go out through m.emit with the frozen `flag` shape.
export function makeFlags(m, cfgIn, on = {}) {
  const cfg = Object.assign({}, FLAG_DEFAULTS, cfgIn || {});
  cfg.beacon = Object.assign({}, FLAG_DEFAULTS.beacon, (cfgIn && cfgIn.beacon) || {});

  const counters = {
    grabs: 0, pickups: 0, drops: 0, returns: 0, captures: [0, 0],
    flagStuckResets: 0, invariantViolations: 0, forcedResets: 0, expiredCarries: 0,
    captureBlocked: 0,
  };

  const pub = [];   // JSON-safe, written into m.state.flags at start()
  const priv = [];  // per-flag non-published bookkeeping

  function emitFlag(f, state, extra) {
    m.emit("flag", Object.assign({
      flagId: f.id, team: f.team, state,
      by: null, byWho: null, carrier: f.carrier,
      pos: [f.pos[0], f.pos[1], f.pos[2]], reason: null,
    }, extra || {}));
    if (on.log) on.log({ s: state, t: m.time, flag: f.id, by: (extra && extra.byWho) || null, reason: (extra && extra.reason) || null });
  }

  function byTeam(team) { return pub[team === pub[0].team ? 0 : 1]; }

  function protectedNow(a, t) { return a.protectedUntilT >= 0 && t < a.protectedUntilT; }

  // ---- carrier restriction plumbing ---------------------------------------
  function beginCarry(f, p, actor, t) {
    f.state = "CARRIED";
    f.carrier = actor.who;
    f.carrierActorId = actor.actorId;
    f.carrierName = actor.name || String(actor.who);
    f.carryStartT = t;
    f.droppedT = -1;
    f.returnAtT = -1;
    f.revealed = false;
    f.beacon = null;
    f.pubPos = null;
    p.nextBeaconT = -1e9;
    p.stuckFails = 0;
    const body = m.bodyOf(actor);
    p.hpCap = body ? body.hp : 0;
    // human grenade stash (§3.5.2) — bots have no grenade count to zero (W7)
    if (actor.who === "P" && body && !p.gStashed) {
      p.gStash = body.grenades || 0;
      body.grenades = 0;
      p.gStashed = true;
    }
    if (protectedNow(actor, t)) m.cancelProtection(actor); // §1.3/§3.8
  }

  function endCarry(f, p) {
    if (f.carrier === "P" && p.gStashed) {
      const body = m.bodyOf(m.actorOf("P"));
      if (body) body.grenades = p.gStash;
    }
    p.gStashed = false;
    p.gStash = 0;
    f.carrier = null;
    f.carrierActorId = -1;
    f.carrierName = "";
    f.carryStartT = -1;
    f.revealed = false;
    f.beacon = null;
  }

  function toStand(f, p) {
    endCarry(f, p);
    f.state = "AT_STAND";
    f.pos[0] = f.home[0]; f.pos[1] = f.home[1]; f.pos[2] = f.home[2];
    f.pubPos = f.home;
    f.droppedT = -1;
    f.returnAtT = -1;
    f.offStandSinceT = -1;
    p.stuckFails = 0;
  }

  function forceReturn(f, reason) {
    const p = priv[pub.indexOf(f)];
    toStand(f, p);
    emitFlag(f, "returned", { reason });
  }

  // §3.4 dropPoint: on-nav → use it; else a reachable nav point within 6 m;
  // else force AT_STAND immediately. No nav (Node fixture) → trust the pos.
  function dropPoint(p3) {
    const nav = m.nav;
    if (!nav || !nav.onNav) return p3;
    if (nav.onNav(p3, 1.0)) return p3;
    const q = nav.randomPoint ? nav.randomPoint(p3, 6.0, m.rng) : null;
    if (q && (!nav.reachable || nav.reachable(q, pub[0].home) || nav.reachable(q, pub[1].home))) return q;
    return null; // caller force-returns
  }

  function drop(f, atPos, reason) {
    const p = priv[pub.indexOf(f)];
    const t = m.time;
    endCarry(f, p);
    const dp = dropPoint(atPos);
    if (!dp) {
      // unreachable death spot — §3.4 row 1's immediate force return
      counters.flagStuckResets++;
      toStand(f, p);
      emitFlag(f, "returned", { reason: "stuck" });
      return;
    }
    f.state = "DROPPED";
    f.pos[0] = dp[0]; f.pos[1] = dp[1] != null ? dp[1] : 0; f.pos[2] = dp[2];
    f.pubPos = f.pos;
    f.droppedT = t;
    f.returnAtT = t + cfg.dropReturnS;
    p.stuckFails = 0;
    p.nextStuckT = t + 1 / cfg.stuckCheckHz;
    counters.drops++;
    emitFlag(f, "dropped", { reason: reason || "death" });
    if (on.drop) on.drop(f);
  }

  // ---- the API -------------------------------------------------------------
  const api = {
    pub, counters, cfg,

    start() {
      pub.length = 0; priv.length = 0;
      const src = (m.arena && m.arena.flags) || [];
      const sorted = src.slice().sort((a, b) => a.team - b.team);
      for (const s of sorted) {
        const home = [s.home[0], s.home[1] || 0, s.home[2]];
        pub.push({
          id: s.id, team: s.team, state: "AT_STAND",
          home, standR: s.standR != null ? s.standR : 1.2,
          pos: home.slice(), pubPos: home,
          carrier: null, carrierActorId: -1, carrierName: "",
          carryStartT: -1, droppedT: -1, returnAtT: -1,
          revealed: false, offStandSinceT: -1,
          beacon: null,
        });
        priv.push({ stuckFails: 0, nextStuckT: -1e9, nextBeaconT: -1e9, lastBlockT: -1e9, hpCap: 0, gStash: 0, gStashed: false });
      }
      if (m.state) m.state.flags = pub; // Part 3.2 — the match-level block
    },

    byTeam,
    carriedBy(who) {
      for (const f of pub) if (f.state === "CARRIED" && f.carrier === who) return f;
      return null;
    },
    forceReturn,

    resetBoth(reason) {
      for (const f of pub) {
        const wasHome = f.state === "AT_STAND";
        toStand(f, priv[pub.indexOf(f)]);
        if (!wasHome || reason === "overtime") emitFlag(f, "reset", { reason });
      }
    },

    // Called from ctf.onDeath BEFORE scoring resolves — the driver's
    // onActorDeath runs onKill (carrier still bound) → onDeath (this drop).
    onActorDeath(who, pos) {
      for (const f of pub) {
        if (f.state === "CARRIED" && f.carrier === who) {
          drop(f, pos ? [pos[0], pos[1] || 0, pos[2]] : f.pos.slice(), "death");
        }
      }
    },

    // env: {t, pressureOn}
    tick(dt, env) {
      const t = env.t;

      // -- 1. carried flags follow their carrier; restrictions enforced
      for (let i = 0; i < pub.length; i++) {
        const f = pub[i], p = priv[i];
        if (f.state !== "CARRIED") continue;
        const actor = m.actorOf(f.carrier);
        const body = actor ? m.bodyOf(actor) : null;
        if (!actor || !actor.alive || !body) {
          // a carrier that vanished without a death event is an invariant
          // break — count it, heal it (drop where the flag last was).
          counters.invariantViolations++;
          drop(f, f.pos.slice(), "invariant");
          continue;
        }
        f.pos[0] = body.pos[0]; f.pos[1] = body.pos[1]; f.pos[2] = body.pos[2];
        // §3.5.3 no regen while carrying — clamp any upward hp drift
        if (body.hp > p.hpCap) body.hp = p.hpCap;
        else p.hpCap = body.hp;
        // §3.5.1 human tac-sprint drained (base sprint untouched)
        if (f.carrier === "P" && body._m) {
          body._m.tacLeft = 0;
          if (body._m.sprintState === "tac") body._m.sprintState = "sprint";
        }
      }

      // -- 2. touches. Deterministic actor order (human first, then bot
      // ordinal — §3.3 simultaneity ruling), returns before enemy pickups
      // (defence beats offence on a tie).
      for (let i = 0; i < pub.length; i++) {
        const f = pub[i], p = priv[i];
        if (f.state === "CARRIED") continue;
        let returner = null, taker = null;
        for (const a of m.actors) { // roster order: actorId 0 ('P') first
          if (!a.alive) continue;
          const bp = m.posOf(a);
          if (!bp) continue;
          if (d2(bp[0], bp[2], f.pos[0], f.pos[2]) > cfg.pickupR) continue;
          if (Math.abs((bp[1] || 0) - (f.pos[1] || 0)) > cfg.pickupDy) continue;
          if (a.team === f.team) {
            if (f.state === "DROPPED" && !returner) returner = a;
            // AT_STAND teammate touch: nothing, never pick up your own flag
          } else if (protectedNow(a, t)) {
            // §3.3: a spawn-protected enemy cannot grab — but the touch
            // cancels the protection (§1.3), so the grab lands next tick.
            m.cancelProtection(a);
          } else if (!taker) {
            taker = a;
          }
        }
        if (f.state === "DROPPED" && returner) {
          if (protectedNow(returner, t)) m.cancelProtection(returner);
          toStand(f, p);
          counters.returns++;
          emitFlag(f, "returned", { reason: "touch", by: returner.actorId, byWho: returner.who });
          if (on.ret) on.ret(returner, f, "touch");
        } else if (taker) {
          const fromStand = f.state === "AT_STAND";
          if (fromStand) f.offStandSinceT = t; // ground pickup keeps the clock
          beginCarry(f, p, taker, t);
          if (fromStand) {
            counters.grabs++;
            emitFlag(f, "taken", { reason: "stand", by: taker.actorId, byWho: taker.who, carrier: taker.who });
            if (on.grab) on.grab(taker, f);
          } else {
            counters.pickups++;
            emitFlag(f, "taken", { reason: "ground", by: taker.actorId, byWho: taker.who, carrier: taker.who });
            if (on.pickup) on.pickup(taker, f);
          }
        }
      }

      // -- 3. capture checks (AFTER returns: §3.8's return-then-capture on
      // one tick is the mode's best moment and this ordering is what makes
      // it work).
      for (let i = 0; i < pub.length; i++) {
        const f = pub[i], p = priv[i];
        if (f.state !== "CARRIED") continue;
        const actor = m.actorOf(f.carrier);
        const body = actor ? m.bodyOf(actor) : null;
        if (!actor || !body) continue;
        const own = byTeam(actor.team); // the carrier's OWN flag/stand
        if (!own || own === f) continue;
        if (d2(body.pos[0], body.pos[2], own.home[0], own.home[2]) > own.standR) continue;
        if (Math.abs((body.pos[1] || 0) - (own.home[1] || 0)) > cfg.pickupDy) continue;
        if (!cfg.captureNeedsOwnFlagHome || own.state === "AT_STAND") {
          // CAPTURE (C29c: own flag home — double capture structurally
          // impossible because both-out means neither can score)
          counters.captures[actor.team === pub[0].team ? 0 : 1]++;
          toStand(f, p);
          emitFlag(f, "captured", { by: actor.actorId, byWho: actor.who, carrier: actor.who });
          if (on.capture) on.capture(actor, f);
        } else {
          // §3.3 captureBlocked — the teaching moment, ≥1 per 3 s max
          if (t - p.lastBlockT >= 3.0) {
            p.lastBlockT = t;
            counters.captureBlocked++;
            emitFlag(f, "captureBlocked", { by: actor.actorId, byWho: actor.who, reason: "own flag away" });
            if (on.blocked) on.blocked(actor, f);
          }
        }
      }

      // -- 4. timers: reveal / beacon / carry cap / drop timeout / stuck
      for (let i = 0; i < pub.length; i++) {
        const f = pub[i], p = priv[i];
        if (f.state === "CARRIED") {
          if (!f.revealed && (env.pressureOn || t - f.carryStartT >= cfg.revealS)) {
            f.revealed = true;
            emitFlag(f, "revealed", { carrier: f.carrier });
          }
          if (f.revealed && t >= p.nextBeaconT) {
            p.nextBeaconT = t + cfg.beacon.refreshS;
            const q = cfg.beacon.quantM;
            f.beacon = {
              pos: [Math.round(f.pos[0] / q) * q, Math.round(f.pos[1] / q) * q, Math.round(f.pos[2] / q) * q],
              t,
            };
          }
          f.pubPos = f.revealed && f.beacon ? f.beacon.pos : null;
          if (t - f.carryStartT >= cfg.carryCapS) {
            counters.expiredCarries++;
            forceReturn(f, "expired"); // HUD: FLAG RECOVERED — CARRY EXPIRED
          }
        } else if (f.state === "DROPPED") {
          if (t >= f.returnAtT) {
            counters.returns++;
            forceReturn(f, "timeout");
            continue;
          }
          // 1 Hz stuck validation (§3.4): on-nav + inside the arena AABB
          if (t >= p.nextStuckT) {
            p.nextStuckT = t + 1 / cfg.stuckCheckHz;
            let ok = true;
            const B = m.arena && m.arena.bounds;
            if (B && (f.pos[0] < B.min[0] || f.pos[0] > B.max[0] || f.pos[2] < B.min[2] || f.pos[2] > B.max[2])) ok = false;
            if (ok && m.nav && m.nav.onNav && !m.nav.onNav(f.pos, 1.0)) ok = false;
            if (ok) p.stuckFails = 0;
            else if (++p.stuckFails >= cfg.stuckStrikes) {
              counters.flagStuckResets++;
              forceReturn(f, "stuck");
            }
          }
        }
      }

      // -- 5. the every-tick three-state invariant (AC-5), self-healing
      for (let i = 0; i < pub.length; i++) {
        const f = pub[i];
        let bad = false;
        if (f.state === "AT_STAND") {
          bad = f.carrier !== null || dh(f.pos, f.home) > 0.01 || f.offStandSinceT !== -1;
        } else if (f.state === "CARRIED") {
          const a = m.actorOf(f.carrier);
          bad = f.carrier == null || !a || !a.alive || a.team === f.team || f.offStandSinceT < 0;
        } else if (f.state === "DROPPED") {
          bad = f.carrier !== null || f.droppedT < 0 || f.offStandSinceT < 0;
        } else {
          bad = true;
        }
        if (bad) {
          counters.invariantViolations++;
          console.error(`[flags] INVARIANT VIOLATION on ${f.id} state=${f.state} — force-returning (AC-5)`);
          forceReturn(f, "invariant");
        }
      }
    },
  };

  return api;
}
