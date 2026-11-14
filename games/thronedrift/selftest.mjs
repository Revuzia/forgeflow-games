// Thronedrift — headless data selftest (node selftest.mjs).
// Pure-data invariants: arenas, roster (15 regulars + 5 bosses), realm pools,
// wave composition, class kits, combo tiers. Runtime/rendering is verified in
// the browser (preview evals + __FFG3D__ hooks); this gate catches data drift.

import { ARENAS, BOARD_RADIUS } from "./runtime/data/arenas.js";
import { ENEMY_TYPES, BOSS_TYPES, ALL_TYPES, REALM_ROSTERS, waveComp, levelWaves, LEVELS_PER_REALM } from "./runtime/data/enemies.js";
import { CLASSES, COMBO_TIERS, COMBO_WINDOW } from "./runtime/data/abilities.js";

let checks = 0, fails = 0;
const ok = (cond, msg) => { checks++; if (!cond) { fails++; console.log("FAIL:", msg); } };

// ── arenas ──────────────────────────────────────────────────────────────────
ok(ARENAS.length === 5, "5 arenas");
ok(new Set(ARENAS.map(a => a.id)).size === 5, "arena ids unique");
ARENAS.forEach((a, i) => {
  ok(a.order === i + 1, `arena ${a.id} order ${i + 1}`);
  ok(a.waves >= 5 && a.waves <= 10, `arena ${a.id} waves sane`);
  for (const f of ["name", "clearWord", "floor", "sky", "fog", "hemi", "sun", "accent", "portal", "particles", "modifiers"])
    ok(a[f] !== undefined, `arena ${a.id} has ${f}`);
});
ok(ARENAS[4].clearIsFinal === true && !ARENAS.slice(0, 4).some(a => a.clearIsFinal), "exactly the last arena is final");
ok(BOARD_RADIUS > 8 && BOARD_RADIUS < 30, "board radius sane");

// ── regulars: 15, exactly 3 per realm ───────────────────────────────────────
const regs = Object.entries(ENEMY_TYPES);
ok(regs.length === 15, `15 regular enemies (got ${regs.length})`);
for (let realm = 1; realm <= 5; realm++)
  ok(regs.filter(([, d]) => d.realm === realm).length === 3, `realm ${realm} has 3 regulars`);
for (const [id, d] of regs) {
  for (const f of ["model", "name", "role", "lore", "height", "hp", "speed", "dmg", "move", "atkRange", "atkCd", "atkWindup", "score", "gold", "knockMult"])
    ok(d[f] !== undefined, `${id} has ${f}`);
  ok(["walk", "hop", "float", "lumber"].includes(d.move), `${id} move style valid`);
  ok(d.hp > 0 && d.speed > 0 && d.speed < 6, `${id} stats sane`);
  ok(!d.ranged || (d.keepDist > 0 && d.ranged.speed > 0), `${id} ranged def sane`);
  ok(!d.boss, `${id} regular is not a boss`);
}

// ── bosses: 5, one per realm, valid kits ────────────────────────────────────
const bosses = Object.entries(BOSS_TYPES);
ok(bosses.length === 5, "5 bosses");
const KIT_TYPES = new Set(["slam", "charge", "volley", "nova", "summon", "blink"]);
for (let realm = 1; realm <= 5; realm++)
  ok(bosses.filter(([, d]) => d.realm === realm).length === 1, `realm ${realm} has 1 boss`);
for (const [id, d] of bosses) {
  ok(d.boss === true, `${id} flagged boss`);
  ok(Array.isArray(d.kit) && d.kit.length >= 2, `${id} kit >= 2 abilities`);
  for (const k of d.kit) {
    ok(KIT_TYPES.has(k.type), `${id} kit type ${k.type} valid`);
    ok(k.cd > 0, `${id} ${k.type} cd > 0`);
    if (k.type === "summon") ok(ENEMY_TYPES[k.unit], `${id} summons existing unit ${k.unit}`);
    if (k.type === "volley" || k.type === "nova") ok(k.count > 0 && k.speed > 0, `${id} ${k.type} projectiles sane`);
    if (k.type === "blink") ok(Array.isArray(k.range) && k.range[0] < k.range[1], `${id} blink range sane`);
  }
  ok(d.hp >= 500, `${id} boss hp scale`);
}

// ── rosters: every regular used exactly once, bosses valid ──────────────────
const used = [];
for (let realm = 1; realm <= 5; realm++) {
  const r = REALM_ROSTERS[realm];
  ok(!!r, `roster realm ${realm}`);
  ok(r.units.length === 3, `roster ${realm} has 3 units`);
  for (const u of r.units) { ok(!!ENEMY_TYPES[u], `roster ${realm} unit ${u} exists`); used.push(u); }
  ok(!!BOSS_TYPES[r.boss], `roster ${realm} boss ${r.boss} exists`);
  ok(BOSS_TYPES[r.boss].realm === realm, `roster ${realm} boss realm matches`);
}
ok(new Set(used).size === 15, "all 15 regulars appear exactly once across rosters");

// ── wave composition (5 levels per realm; boss only on level 5) ────────────
ok(LEVELS_PER_REALM === 5, "5 levels per realm");
for (const a of ARENAS) {
  for (let l = 0; l < LEVELS_PER_REALM; l++) {
    const wc = levelWaves(a.order, l);
    ok(l < 4 ? wc === 3 + l : wc === 1, `realm ${a.order} L${l + 1} wave count`);
    for (let w = 0; w < wc; w++) {
      const comp = waveComp(a.order, l, w, wc);
      let total = 0, hasBoss = false;
      for (const [type, count] of comp) {
        ok(!!ALL_TYPES[type], `r${a.order} L${l + 1} w${w + 1} type ${type} exists`);
        ok(count >= 1, `r${a.order} L${l + 1} w${w + 1} count >= 1`);
        if (ALL_TYPES[type].boss) hasBoss = true;
        total += count;
      }
      ok(total <= 40, `r${a.order} L${l + 1} w${w + 1} total ${total} <= 40`);
      ok(hasBoss === (l === LEVELS_PER_REALM - 1), `r${a.order} L${l + 1} boss only on boss level`);
    }
  }
}

// ── classes ─────────────────────────────────────────────────────────────────
ok(Object.keys(CLASSES).length === 3, "3 classes");
for (const [id, c] of Object.entries(CLASSES)) {
  ok(c.hearts >= 4 && c.hearts <= 8, `${id} hearts sane`);
  const modeKeys = c.modes || ["base"];
  for (const mk of modeKeys) {
    const kit = c.kits[mk];
    ok(!!kit, `${id}/${mk} kit exists`);
    ok(!!kit.basic && kit.basic.rate > 0, `${id}/${mk} basic sane`);
    ok(kit.abilities.length === 3, `${id}/${mk} 3 abilities`);
    for (const ab of kit.abilities) ok(ab.cd > 0 && !!ab.icon && !!ab.name, `${id}/${mk}/${ab.id} sane`);
  }
}
ok(CLASSES.warrior.modes.length === 2, "warrior has 2 modes");
ok(CLASSES.warrior.kits.sworboard.abilities.some(a => a.hold), "sword&shield has hold-block");
ok(!CLASSES.warrior.kits.twohand.abilities.some(a => a.hold), "two-handed has NO block");
ok(CLASSES.warrior.hearts > CLASSES.mage.hearts, "warrior tankier than mage");

// ── combo tiers ─────────────────────────────────────────────────────────────
for (let i = 1; i < COMBO_TIERS.length; i++)
  ok(COMBO_TIERS[i].hits > COMBO_TIERS[i - 1].hits && COMBO_TIERS[i].mult > COMBO_TIERS[i - 1].mult, `combo tier ${i} ascending`);
ok(COMBO_WINDOW > 1 && COMBO_WINDOW < 6, "combo window sane");

console.log(fails ? `SELFTEST: FAIL (${fails}/${checks})` : `SELFTEST: PASS (${checks} checks)`);
process.exit(fails ? 1 : 0);
