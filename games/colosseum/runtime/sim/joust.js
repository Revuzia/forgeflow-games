// Colosseum — the joust. Two riders, a tilt barrier, six passes.
//
// THREE-free like the rest of runtime/sim, and deterministic: it owns its OWN
// mulberry32 stream and never draws from Combat's — a joust replayed from a
// seed must produce the same passes whether or not a melee ever ran this
// session. Combat.update() is NOT called while riders are mounted; this module
// is the whole authority for the mounted phase.
//
// THE SHAPE OF A PASS
//   LINEUP  (~1.6 s)  riders walk to their marks at x = ±34, opposite lanes
//   CHARGE            both gallop; closing speed ~22 m/s. The PLAYER aims
//                     (high/mid/low) and COUCHES the lance (hold attack);
//                     couching early telegraphs and tires the arm, a couch
//                     inside the last ~0.45 s is the skilled window.
//   IMPACT            resolved SUB-TICK: at 22 m/s closing the riders cross a
//                     whole lance-reach in under two 60 Hz ticks, so the exact
//                     crossing time is solved inside the tick and both lances
//                     resolve at that instant — never "whoever ticked first".
//   FOLLOW            ride past, slow, turn at the far end, next pass.
//
// SCORING (period sources describe splintered lances and unhorsings; the point
// values follow the later tournament convention because it reads instantly):
//   lance on shield   1 point
//   lance on body     2 points, and a chance to UNHORSE
//   unhorse           wins outright
//   6 passes without an unhorse -> points decide; tie -> one extra pass.

import { clamp, mulberry32 } from "../core/util.js";

export const JOUST = {
  laneX: 34,            // start distance from centre, each side
  laneGap: 1.15,        // half-separation across the tilt barrier
  gallop: 11.0,         // m/s per rider at full stretch
  accel: 6.5,           // m/s^2 out of the lineup
  lanceReach: 3.2,      // m, couched
  passes: 6,
  lineupT: 1.6,
  followT: 2.4,         // ride-out after a pass before the turn
  couchWindow: 0.45,    // s before impact — couching inside this is "timed"
  aims: ["high", "mid", "low"],
};

export class Joust {
  /**
   * @param {object} opts
   *   seed     deterministic seed for THIS joust
   *   player   { name }        — display only
   *   opponent { name, skill } — skill in [0,1]: aim quality + couch timing
   *   hooks    { onEvent }     — same event bus shape Match uses
   */
  constructor({ seed = 1, player = {}, opponent = {}, hooks = {} } = {}) {
    this.rng = mulberry32(seed >>> 0);
    this.hooks = hooks;
    this.time = 0;
    this.pass = 0;
    this.state = "lineup";
    this.stateT = 0;
    this.result = null;
    this.score = { player: 0, opponent: 0 };
    this.oppSkill = clamp(opponent.skill ?? 0.5, 0, 1);

    // Riders are plain records the view can render like fighters. facing is
    // the atan2(dx,dz) convention the rest of the game uses; the tilt runs
    // along X, so a rider charging +x faces atan2(1,0) = PI/2.
    this.riders = {
      player: this._rider("player", player.name || "You", -JOUST.laneX, -JOUST.laneGap, Math.PI / 2, 0),
      opponent: this._rider("opponent", opponent.name || "The Eques", JOUST.laneX, JOUST.laneGap, -Math.PI / 2, 1),
    };
    // Per-pass intent, re-armed each CHARGE.
    this._intent = null;
  }

  _rider(id, name, x, z, facing, team) {
    return {
      id, name, team, x, z, facing,
      speed: 0, phase: "idle", alive: true,
      hp: 100, maxHp: 100,
      mounted: true, mountId: "warhorse",
      weaponId: "contus", shieldId: "parmula",
      // view-compat fields the actor pipeline reads
      blocking: false, vx: 0, vz: 0, stamina: 100, maxStamina: 100,
      wounds: { head: 0, torso: 0, arms: 0, legs: 0 },
    };
  }

  emit(type, payload) { if (this.hooks.onEvent) this.hooks.onEvent({ type, ...payload }); }

  /**
   * @param {number} dt
   * @param {object} cmd { aim: "high"|"mid"|"low", couch: bool } — the
   *   player's lance intent. Movement is on rails; the skill is in the lance.
   */
  update(dt, cmd = {}) {
    if (this.result) return;
    this.time += dt;
    this.stateT += dt;
    const P = this.riders.player, O = this.riders.opponent;

    switch (this.state) {
      case "lineup": {
        P.speed = O.speed = 0;
        P.phase = O.phase = "idle";
        if (this.stateT >= JOUST.lineupT) {
          this.pass++;
          this._armPass(cmd);
          this._setState("charge");
          this.emit("pass_begin", { pass: this.pass, of: JOUST.passes });
        }
        break;
      }

      case "charge": {
        // Player intent latches on the fly: last aim before the window closes
        // is the aim that counts; couch is the FIRST tick attack is held.
        const it = this._intent;
        if (cmd.aim && JOUST.aims.includes(cmd.aim)) it.playerAim = cmd.aim;
        if (cmd.couch && it.playerCouchT === null) it.playerCouchT = this.time;

        const dirP = Math.sign(O.x - P.x) || 1;
        P.speed = Math.min(JOUST.gallop, P.speed + JOUST.accel * dt);
        O.speed = Math.min(JOUST.gallop, O.speed + JOUST.accel * dt);
        P.phase = O.phase = "run";

        // SUB-TICK IMPACT. Solve the exact instant the gap closes to lance
        // reach; if it falls inside this tick, advance both riders to that
        // instant, resolve BOTH lances there, then spend the remainder.
        const gap = Math.abs(O.x - P.x);
        const closing = P.speed + O.speed;
        const gapAfter = gap - closing * dt;
        if (gap > JOUST.lanceReach && gapAfter <= JOUST.lanceReach && closing > 0) {
          const tHit = (gap - JOUST.lanceReach) / closing;
          P.x += dirP * P.speed * tHit;
          O.x -= dirP * O.speed * tHit;
          this._resolveImpact();
          const rest = dt - tHit;
          P.x += dirP * P.speed * rest;
          O.x -= dirP * O.speed * rest;
          if (!this.result) this._setState("follow");
        } else {
          P.x += dirP * P.speed * dt;
          O.x -= dirP * O.speed * dt;
        }
        P.vx = dirP * P.speed; O.vx = -dirP * O.speed;
        break;
      }

      case "follow": {
        // Ride out, slowing; then swap ends for the next pass.
        P.speed = Math.max(0, P.speed - JOUST.accel * 0.8 * dt);
        O.speed = Math.max(0, O.speed - JOUST.accel * 0.8 * dt);
        const dirP = Math.sign(P.vx) || 1;
        P.x += dirP * P.speed * dt;
        O.x -= dirP * O.speed * dt;
        P.phase = P.speed > 2 ? "run" : "idle";
        O.phase = O.speed > 2 ? "run" : "idle";
        if (this.stateT >= JOUST.followT) {
          if (this.pass >= JOUST.passes) this._decideOnPoints();
          else {
            // Turn: each rider lines up at the end he rode TO, lanes swapped
            // so they pass shield-to-shield again.
            P.x = clamp(P.x, -JOUST.laneX, JOUST.laneX) > 0 ? JOUST.laneX : -JOUST.laneX;
            O.x = -P.x;
            P.z = -P.z; O.z = -O.z;
            P.facing = Math.sign(O.x - P.x) > 0 ? Math.PI / 2 : -Math.PI / 2;
            O.facing = -P.facing;
            P.speed = O.speed = 0;
            this._setState("lineup");
          }
        }
        break;
      }

      default: break;
    }
  }

  _armPass() {
    // The opponent picks his aim and couch plan for the pass up front, from
    // skill plus this joust's own rng — deterministic per seed.
    const r = this.rng;
    this._intent = {
      playerAim: "mid",
      playerCouchT: null,
      oppAim: JOUST.aims[(r() * 3) | 0],
      // Skilled riders couch inside the window; green ones couch a full
      // second out and telegraph everything.
      oppCouchLead: 0.15 + (1 - this.oppSkill) * 0.9 + r() * 0.15,
    };
  }

  /** Both lances resolve at the same instant — a joust is mutual by nature. */
  _resolveImpact() {
    const it = this._intent;
    const P = this.riders.player, O = this.riders.opponent;

    // Player couch quality: never couched = 0.25 (lance loose in the arm),
    // couched inside the window = 1, couched early decays toward 0.45.
    let pCouch = 0.25;
    if (it.playerCouchT !== null) {
      const lead = this.time - it.playerCouchT;
      pCouch = lead <= JOUST.couchWindow ? 1 : clamp(1 - (lead - JOUST.couchWindow) * 0.6, 0.45, 1);
    }
    const oCouch = it.oppCouchLead <= JOUST.couchWindow ? 1 : clamp(1 - (it.oppCouchLead - JOUST.couchWindow) * 0.6, 0.45, 1);

    const roll = (skill, couch) => {
      const q = skill * 0.55 + couch * 0.45 + (this.rng() - 0.5) * 0.3;
      if (q < 0.38) return "miss";
      if (q < 0.72) return "shield";
      return "body";
    };
    // Aim matching: aiming where the other shield ISN'T converts shield->body
    // some of the time. high beats low-guard etc. — one rng consult each.
    const pHit = roll(0.55 + (it.playerAim === "mid" ? 0 : 0.06), pCouch);
    const oHit = roll(this.oppSkill, oCouch);

    const outcome = (who, hit, target) => {
      if (hit === "miss") { this.emit("joust_miss", { rider: who, pass: this.pass }); return 0; }
      if (hit === "shield") {
        this.emit("joust_shield", { rider: who, pass: this.pass, x: (P.x + O.x) / 2, z: target.z });
        return 1;
      }
      // body: 2 points and an unhorse roll
      this.emit("joust_body", { rider: who, pass: this.pass, x: (P.x + O.x) / 2, z: target.z });
      target.hp -= 18 + this.rng() * 14;
      // 18%: an unhorse should decide SOME jousts, not most first passes.
      if (this.rng() < 0.18) {
        target.alive = false;
        target.mounted = false;
        target.phase = "dead";
        this.emit("joust_unhorse", { rider: who, unhorsed: target.id, pass: this.pass, x: target.x, z: target.z });
        this.result = { playerWon: target.id !== "player", by: "unhorse", pass: this.pass, score: { ...this.score } };
      }
      return 2;
    };

    // Resolve simultaneously: score both before any result short-circuits,
    // unless an unhorse already ended it (a dead man scores no lance).
    this.score.player += outcome("player", pHit, O);
    if (!this.result) this.score.opponent += outcome("opponent", oHit, P);
    this.emit("joust_pass", { pass: this.pass, score: { ...this.score } });
  }

  _decideOnPoints() {
    if (this.score.player === this.score.opponent && this.pass < JOUST.passes + 2) {
      // one extra pass to break the tie
      const P = this.riders.player, O = this.riders.opponent;
      P.x = P.x > 0 ? JOUST.laneX : -JOUST.laneX; O.x = -P.x;
      P.z = -P.z; O.z = -O.z;
      P.facing = Math.sign(O.x - P.x) > 0 ? Math.PI / 2 : -Math.PI / 2;
      O.facing = -P.facing;
      this._setState("lineup");
      return;
    }
    this.result = {
      playerWon: this.score.player >= this.score.opponent,
      by: "points", pass: this.pass, score: { ...this.score },
    };
  }

  _setState(s) { this.state = s; this.stateT = 0; }

  /** Fighters list, shaped for the view/bout pipeline. */
  fighters() { return [this.riders.player, this.riders.opponent]; }

  snapshot() {
    return {
      state: this.state, pass: this.pass, of: JOUST.passes,
      score: { ...this.score }, result: this.result,
      riders: this.fighters().map((r) => ({
        id: r.id, x: +r.x.toFixed(2), z: +r.z.toFixed(2), speed: +r.speed.toFixed(2),
        mounted: r.mounted, alive: r.alive, hp: Math.round(r.hp),
      })),
    };
  }
}
