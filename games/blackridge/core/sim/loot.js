// core/sim/loot.js — weapons and ammo lying in the world, THREE-free.
//
// "We need to be able to find/loot weapons." Three sources feed state.loot:
//   1. DROPS      — every bot drops the gun it was holding where it falls (the
//                   call-of-duty loop: kill a man, take his rifle). The pistol is
//                   never dropped (everyone has one); the drop carries the ammo the
//                   bot had left, capped at two mags.
//   2. PLACED     — content.loot[]: weapons/ammo authored into the map. Campaign
//                   entries (scope:"campaign") are one-shot; PVP entries name their
//                   arenas+modes and RESPAWN on a timer (the rack economy already in
//                   content.pickups kind "weapon_pad" keeps working untouched — this
//                   system is additive).
//   3. AMMO BOXES — kind:"ammo": tops up every weapon the taker owns.
//
// PICK-UP RULE (one rule for the human and all nine bots, like the racks): walk
// within PICKUP_R and you take it, if it can give you something —
//   · a weapon you do NOT own  -> goes in its fixed slot (loadout.js); raised only
//                                 if it beats what you hold (or the held gun is dry)
//   · a weapon you already own -> its ammo tops yours up (never past the weapon's
//                                 own reserve cap); full -> the item stays put
// Deterministic: no rng, only sim time and positions.

import { WEAPON_NAMES, slotOf } from "../weapons/weapon_data.js";
import { grant, normalise, autoEquip, owns } from "./loadout.js";

const PICKUP_R = 1.3;
const PICKUP_DY = 1.8;
const DROP_TTL_S = 75;
const MAX_DROPS = 26;
const ARM_DELAY_S = 0.45; // a dropped gun cannot be vacuumed the instant it lands

export function makeLoot(sim, content, mapId, mode) {
  const S = sim.state;
  const isCampaign = !mode;
  S.loot = [];
  let nextId = 1;
  let inited = false;
  const statics = []; // {def, itemId, respawnAt}

  // PVP WEAPON RACKS (content.pickups kind "weapon_pad", filtered by mode + arena) are
  // statics too: ONE pick-up rule for racks, placed weapons and drops, and one set of
  // visuals (lootfx draws a pedestal, the gun, a beam and a recharge ring). They used to
  // be invisible pads that match.js resolved on its own — a player could not FIND them.
  // match.js skips its own rack pass when sim.internal.racksInLoot is set.
  if (mode) {
    for (const pk of (content && content.pickups) || []) {
      if (!pk || pk.kind !== "weapon_pad" || !pk.weapon || !Array.isArray(pk.pos)) continue;
      if (!Array.isArray(pk.modes) || pk.modes.indexOf(mode) < 0) continue;
      if (!Array.isArray(pk.arenas) || pk.arenas.indexOf(mapId) < 0) continue;
      statics.push({ def: {
        id: pk.id, kind: "weapon", weapon: pk.weapon, pos: pk.pos, reserve: pk.reserve,
        respawnS: typeof pk.respawnS === "number" ? pk.respawnS : 25, src: "rack", radius: pk.radius,
      }, itemId: null, respawnAt: null });
    }
    if (statics.some((x) => x.def.src === "rack")) sim.internal.racksInLoot = true;
  }

  for (const def of (content && content.loot) || []) {
    if (!def || !Array.isArray(def.pos)) continue;
    if (mode) {
      if (!Array.isArray(def.arenas) || def.arenas.indexOf(mapId) < 0) continue;
      if (Array.isArray(def.modes) && def.modes.indexOf(mode) < 0) continue;
    } else if (def.scope !== "campaign") continue;
    statics.push({ def, itemId: null, respawnAt: null });
  }

  function groundAt(x, z, y) {
    // stand the item on the walkable surface AT ITS OWN HEIGHT — never the roof of
    // whatever overhangs it (arcades, balconies, deck undersides). supportAt takes
    // the highest top within a step of `y`.
    const yy = typeof y === "number" ? y : 0;
    return sim.world.supportAt ? sim.world.supportAt(x, z, yy + 0.05, 0.3) : sim.world.sphereGround(x, z);
  }

  function addItem(it) {
    it.id = nextId++;
    it.born = S.time;
    it.armedAt = S.time + (it.armDelay != null ? it.armDelay : ARM_DELAY_S);
    S.loot.push(it);
    sim.emit("loot", { phase: "spawn", id: it.id, kind: it.kind, weapon: it.weapon, pos: it.pos.slice(), src: it.src });
    return it;
  }

  function removeAt(i, why, by) {
    const it = S.loot[i];
    S.loot.splice(i, 1);
    sim.emit("loot", { phase: "gone", id: it.id, kind: it.kind, weapon: it.weapon, pos: it.pos.slice(), why, by: by == null ? null : by });
    if (it.key != null) {
      const st = statics.find((x) => x.def.id === it.key);
      if (st) {
        st.itemId = null;
        st.respawnAt = why === "taken" && st.def.respawnS > 0 ? S.time + st.def.respawnS : null;
        publishPads();
      }
    }
  }

  function spawnStatic(st) {
    const d = st.def;
    const wt = d.kind === "ammo" ? null : sim.weapons[d.weapon];
    if (d.kind !== "ammo" && !wt) return;
    const it = addItem({
      kind: d.kind === "ammo" ? "ammo" : "weapon",
      weapon: d.kind === "ammo" ? null : d.weapon,
      pos: [d.pos[0], groundAt(d.pos[0], d.pos[2], d.pos[1]), d.pos[2]],
      mag: wt ? (typeof d.mag === "number" ? d.mag : wt.mag) : 0,
      reserve: wt ? (typeof d.reserve === "number" ? d.reserve : wt.reserve) : 0,
      ttl: 0, src: d.src || "placed", key: d.id, armDelay: 0,
    });
    st.itemId = it.id;
    st.respawnAt = null;
    publishPads();
  }

  // The static spawn points, for the view layer: where they are, what they hold, and
  // whether they are ready (an empty rack draws a dim recharge ring).
  function publishPads() {
    S.lootPads = statics.map((st) => ({
      key: st.def.id, src: st.def.src || "placed", kind: st.def.kind === "ammo" ? "ammo" : "weapon",
      weapon: st.def.weapon || null, pos: [st.def.pos[0], st.def.pos[1], st.def.pos[2]],
      ready: st.itemId != null, readyAt: st.respawnAt, respawnS: st.def.respawnS || 0,
    }));
  }

  // Everything a body can take from an AMMO box: 1.5 mags into every owned gun.
  function giveAmmoAll(body) {
    normalise(body, sim.weapons);
    const w = body.weapon;
    let total = 0;
    for (const id of body.slots) {
      if (!id) continue;
      const wt = sim.weapons[id];
      if (!wt) continue;
      const store = w.id === id ? w : body._slotAmmo[id];
      if (!store) continue;
      const cap = wt.reserve + wt.mag;
      const give = Math.max(0, Math.min(Math.round(wt.mag * 1.5), cap - store.reserve));
      if (give > 0) {
        store.reserve += give;
        total += give;
        if (w.id === id) body._slotAmmo[id] = { mag: w.mag, reserve: w.reserve };
      }
    }
    return total;
  }

  function tryTake(it, body, who) {
    if (it.kind === "ammo") {
      const n = giveAmmoAll(body);
      if (n <= 0) return null;
      return { ok: true, kind: "ammo", equipped: false, gained: n, slot: -1 };
    }
    const r = grant(sim, body, it.weapon, { mag: it.mag, reserve: it.reserve, equip: owns(body, it.weapon) ? false : autoEquip(body, it.weapon) }, who);
    return r.ok ? r : null;
  }

  const api = {
    tick(simRef, dt) {
      void simRef; void dt;
      const t = S.time;
      if (!inited) {
        inited = true;
        for (const st of statics) spawnStatic(st);
      }
      for (const st of statics) {
        if (st.itemId == null && st.respawnAt != null && t >= st.respawnAt) spawnStatic(st);
      }
      for (let i = S.loot.length - 1; i >= 0; i--) {
        const it = S.loot[i];
        if (it.ttl > 0 && t - it.born > it.ttl) removeAt(i, "expire");
      }
      if (!S.loot.length) return;

      const p = S.player;
      for (let i = S.loot.length - 1; i >= 0; i--) {
        const it = S.loot[i];
        if (t < it.armedAt) continue;
        let taker = null, res = null, who = null;
        // the human first, then bots in stable roster order
        if (p.alive) {
          const dx = p.pos[0] - it.pos[0], dz = p.pos[2] - it.pos[2];
          if (dx * dx + dz * dz <= PICKUP_R * PICKUP_R && Math.abs(p.pos[1] - it.pos[1]) < PICKUP_DY) {
            res = tryTake(it, p, "P");
            if (res) { taker = p; who = "P"; }
          }
        }
        // campaign: authored crates and ammo boxes are the PLAYER's find — the quay
        // patrol must not strip the map before you reach it (dropped guns are fair game)
        if (!taker && !(isCampaign && it.src === "placed")) {
          for (const b of S.bots) {
            if (!b.alive) continue;
            const dx = b.pos[0] - it.pos[0], dz = b.pos[2] - it.pos[2];
            if (dx * dx + dz * dz > PICKUP_R * PICKUP_R || Math.abs(b.pos[1] - it.pos[1]) >= PICKUP_DY) continue;
            res = tryTake(it, b, b.id);
            if (res) { taker = b; who = b.id; break; }
          }
        }
        if (taker) {
          if (it.src === "rack") {
            // the legacy rack event (HUD/audio consumers): who took which rack
            sim.emit("pad", { who, id: it.key, weapon: it.weapon, respawnS: (statics.find((x) => x.def.id === it.key) || { def: {} }).def.respawnS });
          }
          sim.emit("pickup", {
            who, kind: res.kind, weaponId: it.weapon, slot: res.slot, equipped: !!res.equipped,
            gained: res.gained || 0, pos: it.pos.slice(), itemId: it.id,
            name: it.weapon ? WEAPON_NAMES[it.weapon] || it.weapon : "AMMO",
          });
          removeAt(i, "taken", who);
        }
      }
    },

    // A body died: it leaves its gun (and what is left in it) on the floor.
    onDeath(simRef, d) {
      void simRef;
      if (!d || d.victim === "P" || d.victim == null) return;
      const b = S.bots.find((x) => x.id === d.victim);
      if (!b || !b.weapon) return;
      const wid = b.weapon.id;
      if (wid === "pike" || slotOf(wid) < 0) return;
      const wt = sim.weapons[wid];
      if (!wt) return;
      // oldest ground drop makes room
      let drops = 0, oldest = -1;
      for (let i = 0; i < S.loot.length; i++) {
        if (S.loot[i].src === "drop") { drops++; if (oldest < 0) oldest = i; }
      }
      if (drops >= MAX_DROPS && oldest >= 0) removeAt(oldest, "expire");
      const ang = (b.id * 2.399963) % (Math.PI * 2); // deterministic scatter off the corpse
      const ox = Math.cos(ang) * 0.35, oz = Math.sin(ang) * 0.35;
      const x = b.pos[0] + ox, z = b.pos[2] + oz;
      addItem({
        kind: "weapon", weapon: wid,
        pos: [x, groundAt(x, z, b.pos[1]), z],
        mag: Math.max(1, Math.min(wt.mag, b.weapon.mag || 0)),
        reserve: Math.max(0, Math.min(b.weapon.reserve || 0, wt.mag * 2)),
        ttl: DROP_TTL_S, src: "drop", key: null,
      });
    },

    // test / scenario hook: place an item right now
    spawn(weaponId, pos, o) {
      const wt = sim.weapons[weaponId];
      if (!wt) return null;
      return addItem({
        kind: "weapon", weapon: weaponId,
        pos: [pos[0], groundAt(pos[0], pos[2], pos[1]), pos[2]],
        mag: o && typeof o.mag === "number" ? o.mag : wt.mag,
        reserve: o && typeof o.reserve === "number" ? o.reserve : wt.reserve,
        ttl: (o && o.ttl) || 0, src: "test", key: null, armDelay: 0,
      });
    },

    clear() { while (S.loot.length) removeAt(S.loot.length - 1, "clear"); },
  };
  return api;
}
