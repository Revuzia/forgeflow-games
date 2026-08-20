// core/sim/damage.js [A1] — hp, hit zones, death, regen (combat_spec §6).
// R16: NO hp inflation anywhere — heavies are 100 HP like everything else.
// THREE-free; internal to sim. Frozen export name applyDamage kept
// (signature extended additively — the only caller is this lane's sim).
//
// Regen: player delay 4.5 s from last damage, then 35 HP/s (§6).
// Bots regen ONLY in 'retreat' state at ×0.7 (24.5 HP/s) — sells RETREAT.
// Bot flinch (§3.4): +0.8° aim error for 0.35 s per hit, stacks cap 2× —
// written here as bot.flinchUntil / bot.flinchStacks for A5's aim code.

const REGEN_DELAY_S = 4.5;
const REGEN_PER_S = 35;
const BOT_RETREAT_REGEN_PER_S = 24.5;

function dirFromTo(fromPos, toPos) {
  const dx = toPos[0] - fromPos[0], dy = toPos[1] - fromPos[1], dz = toPos[2] - fromPos[2];
  const len = Math.hypot(dx, dy, dz) || 1;
  return [dx / len, dy / len, dz / len];
}

function attackerPos(sim, attacker) {
  if (attacker === "P") return sim.state.player.pos;
  const b = sim.state.bots.find((b) => b.id === attacker);
  return b ? b.pos : null;
}

// who: 'P' | botId. attacker: 'P' | botId | null. part: 'head'|'body'|'limb'.
export function applyDamage(sim, who, amount, attacker = null, part = "body", src = "shot") {
  const S = sim.state;
  if (!(amount > 0)) return;

  if (who === "P") {
    const p = S.player;
    if (!p.alive || sim.flags.god) return;
    p.hp = Math.max(0, p.hp - amount);
    p.lastDamageT = S.time;
    S.counters.damageTaken += amount;
    const apos = attacker != null ? attackerPos(sim, attacker) : null;
    const dir = apos ? dirFromTo(p.pos, apos) : [0, 0, 1];
    sim.emit("hurt", { victim: "P", attacker, amount, hp: p.hp, part, dir });
    if (p.hp <= 0) {
      p.alive = false;
      p.hp = 0;
      S.counters.deaths++;
      sim.emit("death", {
        victim: "P", attacker, headshot: part === "head",
        pos: p.pos.slice(), dir,
      });
      // R22: mission handles the 1.2 s fade → beat-checkpoint restore.
      if (sim.mission) sim.mission.onPlayerDeath(sim);
    }
    return;
  }

  const b = S.bots.find((b) => b.id === who);
  if (!b || !b.alive) return;
  b.hp = Math.max(0, b.hp - amount);
  // §3.4 flinch — suppression counterplay, consumed by A5's aim code
  const flinchActive = (b.flinchUntil || 0) > S.time;
  b.flinchStacks = Math.min(2, flinchActive ? (b.flinchStacks || 0) + 1 : 1);
  b.flinchUntil = S.time + 0.35;
  b.lastHitT = S.time;
  if (attacker === "P") {
    S.counters.damageDealt += amount;
    if (part === "head") S.counters.headshots++;
  }
  const apos = attacker != null ? attackerPos(sim, attacker) : null;
  const dir = apos ? dirFromTo(b.pos, apos) : [0, 0, 1];
  sim.emit("hurt", { victim: who, attacker, amount, hp: b.hp, part, dir });
  if (b.hp <= 0) {
    const prev = b.state;
    b.alive = false;
    b.hp = 0;
    b.state = "dead";
    b.anim = sim.rng.ai() < 0.5 ? "death_a" : "death_b";
    b.diedT = S.time;
    if (attacker === "P") S.counters.kills++;
    sim.emit("botstate", { botId: b.id, state: "dead", prev });
    sim.emit("death", {
      victim: who, attacker, headshot: part === "head",
      pos: b.pos.slice(), dir,
    });
  }
}

// Ticked once per sim step (tick-order slot 5, after projectiles/grenades).
export function stepHealth(sim, dt) {
  const S = sim.state;
  const p = S.player;
  if (p.alive && p.hp < 100 && S.time - (p.lastDamageT ?? -999) >= REGEN_DELAY_S) {
    p.hp = Math.min(100, p.hp + REGEN_PER_S * dt);
  }
  for (const b of S.bots) {
    if (b.alive && b.state === "retreat" && b.hp < 100) {
      b.hp = Math.min(100, b.hp + BOT_RETREAT_REGEN_PER_S * dt);
    }
  }
}
