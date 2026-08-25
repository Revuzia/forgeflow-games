// core/sim/damage.js [A1] — hp, hit zones, death, regen (combat_spec §6).
// R16: NO hp inflation anywhere — heavies are 100 HP like everything else.
// THREE-free; internal to sim. Frozen export name applyDamage kept
// (signature extended additively — the only caller is this lane's sim).
//
// Regen: player delay 4.5 s from last damage, then 35 HP/s (§6).
// Bots regen ONLY in 'retreat' state at ×0.7 (24.5 HP/s) — sells RETREAT.
// Bot flinch (§3.4): +0.8° aim error for 0.35 s per hit, stacks cap 2× —
// written here as bot.flinchUntil / bot.flinchStacks for A5's aim code.

// Regen constants now come from sim.tuning (core/pvp/pvp_tuning.js — the C25
// balance seam; IDENTITY values in wave 1: 100 HP, 4.5 s, 35 HP/s, ×0.7).
// These remain as the no-tuning fallback so a hand-built sim stub still works.
const REGEN_DELAY_S = 4.5;
const REGEN_PER_S = 35;
const BOT_RETREAT_REGEN_MULT = 0.7;
const MAX_HP = 100;

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

function attackerWeaponId(sim, attacker) {
  if (attacker === "P") return sim.state.player.weapon.id;
  const b = sim.state.bots.find((b) => b.id === attacker);
  return b && b.weapon ? b.weapon.id : null;
}

// who: 'P' | botId. attacker: 'P' | botId | null. part: 'head'|'body'|'limb'.
export function applyDamage(sim, who, amount, attacker = null, part = "body", src = "shot") {
  const S = sim.state;
  if (!(amount > 0)) return;

  // -- PVP gates (no-ops in the campaign: sim.match is null) ---------------
  // Friendly fire OFF between DIFFERENT actors on the same team; self-damage
  // stays ON at 100% (attacker !== who keeps it live). Returning BEFORE the
  // hurt emit is load-bearing: perception turns being hit into instant
  // awareness 1.0 toward the attacker, so a teammate's stray round would
  // otherwise hand a bot a free wallhack toward its own ally (Part 3.4).
  if (attacker != null && attacker !== who && sim.match && sim.match.sameTeam(attacker, who)) return;
  // Spawn protection: a protected actor takes no damage (modes.md §1.3).
  // OOB backstop damage bypasses it (src 'oob' — the timer already ran).
  if (sim.match && src !== "oob" && sim.match.isProtected(who)) return;

  // additive event fields (freeze amendment d): actor/team attribution
  const _vA = sim.match ? sim.match.m.actorOf(who) : null;
  const _aA = sim.match && attacker != null ? sim.match.m.actorOf(attacker) : null;
  const matchFields = sim.match ? {
    victimActor: _vA ? _vA.actorId : null,
    attackerActor: _aA ? _aA.actorId : null,
    victimTeam: _vA ? _vA.team : null,
    attackerTeam: _aA ? _aA.team : null,
  } : null;

  if (sim.match) sim.match.onDamage(sim, who, amount, attacker, part, src);

  if (who === "P") {
    const p = S.player;
    if (!p.alive || sim.flags.god) return;
    p.hp = Math.max(0, p.hp - amount);
    p.lastDamageT = S.time;
    S.counters.damageTaken += amount;
    const apos = attacker != null ? attackerPos(sim, attacker) : null;
    const dir = apos ? dirFromTo(p.pos, apos) : [0, 0, 1];
    sim.emit("hurt", Object.assign({ victim: "P", attacker, amount, hp: p.hp, part, dir }, matchFields));
    if (p.hp <= 0) {
      p.alive = false;
      p.hp = 0;
      S.counters.deaths++;
      sim.emit("death", Object.assign({
        victim: "P", attacker, headshot: part === "head",
        pos: p.pos.slice(), dir,
      }, matchFields));
      if (sim.match) {
        // PVP: roster bookkeeping + respawn queue (match driver, Part 3.3)
        sim.match.onActorDeath(sim, {
          victim: "P", attacker, headshot: part === "head",
          weaponId: attacker != null ? attackerWeaponId(sim, attacker) : null,
          pos: p.pos.slice(),
        });
      } else if (sim.mission) {
        // R22: mission handles the 1.2 s fade → beat-checkpoint restore.
        sim.mission.onPlayerDeath(sim);
      }
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
  sim.emit("hurt", Object.assign({ victim: who, attacker, amount, hp: b.hp, part, dir }, matchFields));
  if (b.hp <= 0) {
    const prev = b.state;
    b.alive = false;
    b.hp = 0;
    b.state = "dead";
    b.anim = sim.rng.ai() < 0.5 ? "death_a" : "death_b";
    b.diedT = S.time;
    if (attacker === "P") S.counters.kills++; // frozen HUD/probe semantics: human kills only
    sim.emit("botstate", { botId: b.id, state: "dead", prev });
    sim.emit("death", Object.assign({
      victim: who, attacker, headshot: part === "head",
      pos: b.pos.slice(), dir,
    }, matchFields));
    if (sim.match) {
      sim.match.onActorDeath(sim, {
        victim: who, attacker, headshot: part === "head",
        weaponId: attacker != null ? attackerWeaponId(sim, attacker) : null,
        pos: b.pos.slice(),
      });
    }
  }
}

// Ticked once per sim step (tick-order slot 5, after projectiles/grenades).
export function stepHealth(sim, dt) {
  const S = sim.state;
  const t = sim.tuning;
  const maxHp = t ? t.maxHp : MAX_HP;
  const regenDelayS = t ? t.regenDelayS : REGEN_DELAY_S;
  const regenPerS = t ? t.regenPerS : REGEN_PER_S;
  const botRetreatPerS = regenPerS * (t ? t.botRetreatRegenMult : BOT_RETREAT_REGEN_MULT);
  const p = S.player;
  if (p.alive && p.hp < maxHp && S.time - (p.lastDamageT ?? -999) >= regenDelayS) {
    p.hp = Math.min(maxHp, p.hp + regenPerS * dt);
  }
  for (const b of S.bots) {
    if (b.alive && b.state === "retreat" && b.hp < maxHp) {
      b.hp = Math.min(maxHp, b.hp + botRetreatPerS * dt);
    }
  }
}
