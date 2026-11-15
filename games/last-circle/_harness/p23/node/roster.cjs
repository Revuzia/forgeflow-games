// roster.cjs - the Node half of p23/roster.py (P2-D LC-16 roster + LC-34 ADS times). NO browser, NO file edited.
//   node roster.cjs --root <game dir> [--plant dmr-weak] [--n 20000] --out res.json
"use strict";
const fs = require("fs");
const path = require("path");
const args = {};
for (let i = 2; i < process.argv.length; i++) { const a = process.argv[i]; if (a.startsWith("--")) { const n = process.argv[i + 1]; if (n === undefined || n.startsWith("--")) args[a.slice(2)] = true; else { args[a.slice(2)] = n; i++; } } }
const ROOT = path.resolve(args.root);
globalThis.FFG = undefined;
const m = require(path.join(ROOT, "runtime", "sim", "royale.js"));
const K = m && m.WEAPONS ? m : globalThis.FFG.sim.Royale;
const N = +(args.n || 20000);
if (args.plant === "dmr-weak" && K.WEAPONS.dmr) K.WEAPONS.dmr.damage = 12;
const out = { root: ROOT, ids: K.WEAPON_IDS || null, fire: {}, ads: {}, value: {}, rolls: {}, burst: null };
const ids = K.WEAPON_IDS || [];
for (const id of ids) { const d = K.WEAPONS[id] || {}; out.fire[id] = d.fire || null; out.ads[id] = d.adsTimeS != null ? d.adsTimeS : null; }
const V = (id, d) => (typeof K.gunValueAt === "function" && K.WEAPONS[id] ? K.gunValueAt(id, 0, d) : null);
for (const d of [15, 30, 90]) { out.value[d] = {}; for (const id of ids) out.value[d][id] = V(id, d); }
if (K.WEAPONS.burst && typeof K.fireInterval === "function") { const b = K.WEAPONS.burst.burst || {}; out.burst = { interval: K.fireInterval(K.WEAPONS.burst), expect: b.n ? ((b.n - 1) * b.gapS + b.delayS) / b.n : null, burst: b }; }
const rng = K.mulberry32 || ((s) => () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; });
const count = (fn) => { const c = {}; for (let s = 1; s <= N; s++) { let r; try { r = fn(rng(s)); } catch (e) { return { error: String(e) }; } const list = Array.isArray(r) ? r : r && r.items ? r.items : [r];
  for (const it of list) if (it && it.kind === "weapon") c[it.id] = (c[it.id] || 0) + 1; } return c; };
out.rolls.floor = typeof K.rollFloorItem === "function" ? count((r) => K.rollFloorItem(r, "basic")) : null;
out.rolls.floorHigh = typeof K.rollFloorItem === "function" ? count((r) => K.rollFloorItem(r, "high")) : null;
out.rolls.chest = typeof K.rollChest === "function" ? count((r) => K.rollChest(r)) : null;
out.rolls.supply = typeof K.rollSupplyDrop === "function" ? count((r) => K.rollSupplyDrop(r)) : null;
fs.writeFileSync(args.out, JSON.stringify(out, null, 1));
console.log("roster.cjs:", JSON.stringify({ ids: out.ids, burst: out.burst }));
