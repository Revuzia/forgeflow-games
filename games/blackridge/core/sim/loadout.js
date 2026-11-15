// core/sim/loadout.js — the FIVE-SLOT inventory (keys 1-5), THREE-free.
//
// WHY: the sim carried `slots` as a 2-element array and nothing ever mapped the
// 1/2 keys to a weapon (player.js resolveSwitch's header explains the bug), so
// weapon switching never worked in any shipped build and "find/loot a weapon" had
// nowhere to put it. A body now holds slots[0..4] — one fixed slot per weapon,
// by CLASS (weapon_data.js WEAPON_SLOT: 1 Warden AR · 2 Vesper SMG · 3 Breaker
// shotgun · 4 Corvus DMR · 5 Pike pistol). The key you press is always the same
// gun, so muscle memory works and a pick-up never shuffles your bar.
//
// A body is {weapon:{id,mag,reserve,...}, slots:[id|null ×5], _slotAmmo:{id:{mag,reserve}}}.
// `weapon` is the HELD gun; _slotAmmo mirrors every owned gun (the held gun's
// entry is refreshed by commitSlotAmmo whenever it changes).

import { SLOT_COUNT, slotOf } from "../weapons/weapon_data.js";

export { SLOT_COUNT };

export function emptySlots() { return new Array(SLOT_COUNT).fill(null); }

// ["warden","pike"] / ["pike", null] / [] -> fixed-slot array
export function slotsFromList(list) {
  const s = emptySlots();
  for (const id of list || []) {
    if (!id) continue;
    const i = slotOf(id);
    if (i >= 0) s[i] = id;
  }
  return s;
}

export function ownedIds(body) {
  return (body.slots || []).filter(Boolean);
}

export function owns(body, id) {
  return !!(body.slots && body.slots.indexOf(id) >= 0);
}

// AUTO-EQUIP TIER (ground-loot walkovers only): a gun you run over is raised only
// when it beats the one in hand, or the held gun is dry. Pistol < SMG/shotgun < AR/DMR.
const TIER = { pike: 0, vesper: 1, breaker: 1, warden: 2, corvus: 2 };
export const tierOf = (id) => (TIER[id] != null ? TIER[id] : 1);
export function autoEquip(body, newId) {
  const w = body.weapon;
  if (!w) return true;
  return (w.mag + w.reserve) <= 0 || tierOf(newId) > tierOf(w.id);
}

// Make sure `body` has a well-formed 5-slot inventory (older saves / test
// bodies built with a 2-element array are normalised in place).
export function normalise(body, weapons) {
  if (!body.slots || body.slots.length !== SLOT_COUNT) {
    const old = (body.slots || []).filter(Boolean);
    if (body.weapon && body.weapon.id && old.indexOf(body.weapon.id) < 0) old.push(body.weapon.id);
    body.slots = slotsFromList(old);
  }
  if (!body._slotAmmo) body._slotAmmo = {};
  for (const id of body.slots) {
    if (id && !body._slotAmmo[id]) {
      const wt = weapons[id];
      body._slotAmmo[id] = { mag: wt ? wt.mag : 0, reserve: wt ? wt.reserve : 0 };
    }
  }
}

// The weapon a switch request resolves to, or null. `want` is a weapon id,
// "slot1".."slot5", "next", "prev" or "last".
export function resolveSwitch(body, want) {
  if (!want) return null;
  const slots = body.slots || [];
  const m = /^slot([1-9])$/.exec(want);
  if (m) return slots[+m[1] - 1] || null;
  const held = body.weapon ? body.weapon.id : null;
  if (want === "last") {
    const l = body._lastWeapon;
    return l && slots.indexOf(l) >= 0 && l !== held ? l : null;
  }
  if (want === "next" || want === "prev") {
    const dir = want === "next" ? 1 : -1;
    const at = slotOf(held);
    for (let k = 1; k <= SLOT_COUNT; k++) {
      const id = slots[(((at + dir * k) % SLOT_COUNT) + SLOT_COUNT) % SLOT_COUNT];
      if (id && id !== held) return id;
    }
    return null;
  }
  return want; // a literal weapon id (bots, scenarios)
}

// Put (or top up) weapon `id` on `body`.
//   opts.mag / opts.reserve   — ammo the pick-up carries (default: a full
//                               weapon_data load; racks pass their own reserve)
//   opts.equip                — true/false to force; undefined = equip (loot walkovers pass autoEquip())
// Returns {ok, kind:'weapon'|'ammo'|null, equipped, slot, gained} — `ok` is false
// when there was nothing to gain (full on a weapon already owned).
export function grant(sim, body, id, opts, whoTag) {
  const weapons = sim.weapons;
  const wt = weapons[id];
  const res = { ok: false, kind: null, equipped: false, slot: slotOf(id), gained: 0 };
  if (!body || !wt || res.slot < 0) return res;
  normalise(body, weapons);
  const w = body.weapon;
  const held = w.id;
  const o = opts || {};

  if (owns(body, id) && o.equip === false) {
    // ground-loot walkover of a gun we already own: take the AMMO, up to the
    // weapon's own reserve cap (a spare mag over the starting load)
    const store = held === id ? w : body._slotAmmo[id];
    const cap = wt.reserve + wt.mag;
    const room = Math.max(0, cap - store.reserve);
    if (room <= 0) return res;
    const give = Math.min(room, typeof o.reserve === "number" ? o.reserve + (o.mag || 0) : wt.mag * 2);
    if (give <= 0) return res;
    store.reserve += give;
    if (held === id) body._slotAmmo[id] = { mag: w.mag, reserve: w.reserve };
    res.ok = true; res.kind = "ammo"; res.gained = give;
    return res;
  }
  // explicit grant (rack / crate / scenario) of the gun already in hand: nothing to do
  if (held === id) return res;

  // new weapon: stow what is in hand, fill ITS slot
  body._slotAmmo[held] = { mag: w.mag, reserve: w.reserve };
  body.slots[res.slot] = id;
  const mag = typeof o.mag === "number" ? Math.max(0, Math.min(wt.mag, o.mag)) : wt.mag;
  const reserve = typeof o.reserve === "number" ? o.reserve : wt.reserve;
  body._slotAmmo[id] = { mag, reserve };
  res.ok = true; res.kind = "weapon";

  // Default: raise the new gun (racks, crates, scenario/test grants all mean "put
  // this in my hands"). Ground-loot walkovers pass an explicit equip decision
  // (autoEquip below) so running over a dropped pistol never yanks your rifle away.
  const equip = o.equip != null ? !!o.equip : true;
  if (equip) {
    body._lastWeapon = held;
    w.id = id; w.mag = mag; w.reserve = reserve;
    w.state = "idle"; w.stateT = 0; w.ads = false; w.adsT = 0;
    w.recoilIndex = 0; w._shotCount = 0; w._reloadCommitted = false;
    res.equipped = true;
    sim.emit("switch", { who: whoTag || (body === sim.state.player ? "P" : body.id), from: held, to: id });
  }
  return res;
}
