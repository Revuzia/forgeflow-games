// qa_rewards_unit.mjs -- lane R OFFLINE unit test (Node, no browser).
// Supplements the live probe (_harness/qa_rewards.py): exercises the REAL
// modifiers/boons/relics/shop modules against the REAL DamageableRegistry and
// the REAL lane-Q Progression (v4 save sections) with a localStorage shim.
// The controller is a stand-in with the same accessor contract as
// character/controller.js (that file imports three, which Node cannot load).
//     node _harness/qa_rewards_unit.mjs
const store = new Map();
globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
};

const base = new URL("../src/", import.meta.url);
const imp = (p) => import(new URL(p, base).href);
const { bus } = await imp("quests/events.js");
const { DamageableRegistry, TIER } = await imp("combat/damageable.js");
const { Progression } = await imp("progression/progression.js");
const { Modifiers } = await imp("progression/modifiers.js");
const { Boons } = await imp("progression/boons.js");
const { Relics } = await imp("progression/relics.js");
const { Shop } = await imp("progression/shop.js");

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
    if (ok) pass++; else fail++;
    console.log((ok ? "PASS " : "FAIL ") + name + " :: " + JSON.stringify(detail));
};
const near = (a, b, t) => typeof a === "number" && Math.abs(a - b) <= t;

class Ctrl {
    constructor() {
        this.mods = null; this._healthMaxBase = 100; this._manaMaxBase = 100;
        this.health = 100; this.mana = 100; this.manaRegen = 9;
        this.position = { x: 0, y: 0, z: 0 };
        this.velocity = { x: 0, y: 0, z: 0, set(a, b, c) { this.x = a; this.y = b; this.z = c; } };
        this.airborne = false; this.surf = 0; this.vertVel = 0; this.airHeight = 0;
        this.terrain = { heightAt: () => 0 };
    }
    get healthMax() { return this.mods === null ? this._healthMaxBase : Math.round(this._healthMaxBase * this.mods.maxHp); }
    set healthMax(v) { this._healthMaxBase = v; }
    get manaMax() { return this.mods === null ? this._manaMaxBase : Math.round(this._manaMaxBase * this.mods.maxMana); }
    set manaMax(v) { this._manaMaxBase = v; }
}

/** A stand-in with the enemy runtime's damage contract (enemies.js). */
class FakeEnemies {
    constructor(c) { this.c = c; this._pIFrameUntil = 0; this.boltAlive = new Uint8Array(4); this.boltDmg = new Float32Array(4); }
    _applyHit(i, u, d) { this._hurtPlayer(u.dmg, 0, 0); }
    _hurtPlayer(dmg) { this.c.health = Math.max(0, this.c.health - dmg); }
    _fireBolt(i, u, d) { for (let b = 0; b < 4; b++) if (!this.boltAlive[b]) { this.boltAlive[b] = 1; this.boltDmg[b] = u.dmg; return; } }
}

function build() {
    const c = new Ctrl();
    const reg = new DamageableRegistry();
    const P = new Progression(c, reg, null);
    const en = new FakeEnemies(c);
    const spellHits = { damageMult: 1, mods: null };
    const ctx = { character: c, registry: reg, progression: P, bus, enemies: en, spellHits,
        spells: { mods: null }, bosses: { state: "idle" }, getRealm: () => "cold" };
    const mods = new Modifiers(ctx);
    const relics = new Relics(ctx);
    const boons = new Boons(ctx);
    const shop = new Shop(ctx);
    return { c, reg, P, en, ctx, mods, relics, boons, shop, spellHits };
}

// ------------------------------------------------------------------ run 1
let W = build();
W.P.newGame();
W.P.level = 10; W.P._refreshNeed(); W.P._applyLevelStats(true);
check("identity with no rewards: 100 HP, x1 damage", W.c.healthMax === 100 && W.mods.hitMult(W.reg, -1, 0) === 1,
    { hpMax: W.c.healthMax, mult: W.mods.hitMult(W.reg, -1, 0) });

// Boons through the real event path.
bus.emit("boss:killed", { realm: "cold", kind: "mini", key: "k", name: "The Icewall", first: true });
check("first mini kill: offer pending", W.boons.pending.includes("cold.mini"), W.boons.pending);
W.boons.choose("cold.mini", 0);
check("Rime Edge: frost x1.08, fire (ignite) untouched",
    near(W.mods.hitMult(W.reg, -1, 0), 1.08, 1e-9) && near(W.mods.hitMult(W.reg, -1, 2), 1, 1e-9),
    { kit: W.mods.hitMult(W.reg, -1, 0), fire: W.mods.hitMult(W.reg, -1, 2) });
check("boss first kill paid 100 Wake Glass", W.shop.glass === 100, W.shop.glass);
bus.emit("boss:killed", { realm: "cold", kind: "mini", first: false });
check("a re-kill mints nothing", W.shop.glass === 100 && W.boons.pending.length === 0, [W.shop.glass, W.boons.pending]);

// Deep Chill with the real registry chill rule.
W.boons.respec("cold.mini", 1, { atShrine: true });
const id = W.reg.register({ x: 0, y: 0, z: 0, radius: 0.5, height: 1.8, tier: TIER.MEDIUM, level: 10, hp: 1e6, poiseMax: 1e9 });
const s = W.reg.slot(id);
W.reg.chill[s] = 4; W.reg.chillAt[s] = W.reg.time;
let c0 = W.reg.chill[s]; W.reg.damage(id, 1, { chill: true }); W.mods.onChillHit(W.reg, s, id, c0, false);
check("Deep Chill overflow: Brittle fires and 1 stack carries", W.reg.chill[s] === 1 && W.reg.time < W.reg.brittleUntil[s], W.reg.chill[s]);
W.reg.chill[s] = 5;
c0 = 5; W.reg.damage(id, 1, { chill: true }); W.mods.onChillHit(W.reg, s, id, c0, false);
check("Deep Chill: sixth stack during Brittle", W.reg.chill[s] === 6 && near(W.reg.speedMult(id), 0.64, 1e-6),
    { chill: W.reg.chill[s], speed: W.reg.speedMult(id) });

// Cooldowns, vortex clock, relics.
bus.emit("reward", { kind: "relic", id: "relic.sandGlass", source: "cache" });
bus.emit("reward", { kind: "relic", id: "relic.furnaceCore", source: "cache" });
check("two relic rewards fill both slots", W.relics.equipped[0] === "relic.sandGlass" && W.relics.equipped[1] === "relic.furnaceCore", W.relics.equipped);
check("Sand Glass: 10 s -> 9.2 s", near(W.mods.cooldown(4, 10), 9.2, 1e-6), W.mods.cooldown(4, 10));
let t = 0, real = 0;
while (t < 4.65) { const dt = 1 / 60; t += dt * W.mods.vortexClock(t); real += dt; }
check("Furnace Core: vortex clock stretches 4.65 s to 5.58 s", near(real, 5.58, 0.02), real);
bus.emit("reward", { kind: "relic", id: "relic.sandGlass", source: "cache" });
check("a duplicate relic is not granted twice", W.relics.owned.filter((r) => r === "relic.sandGlass").length === 1, W.relics.owned);

// Brass Buckle + Undying Wake through the wrapped enemy seam.
W.relics.equip("relic.brassBuckle", 0) || (bus.emit("reward", { kind: "relic", id: "relic.brassBuckle" }), W.relics.equip("relic.brassBuckle", 0));
W.c.health = 100;
W.en._applyHit(0, { tier: TIER.HEAVY, dmg: 20 }, 0);
const heavyLoss = 100 - W.c.health;
W.c.health = 100;
W.en._applyHit(0, { tier: TIER.MEDIUM, dmg: 20 }, 0);
check("Brass Buckle: heavy 20 -> 17, medium 20 -> 20", near(heavyLoss, 17, 1e-6) && near(100 - W.c.health, 20, 1e-6), [heavyLoss, 100 - W.c.health]);
bus.emit("boss:killed", { realm: "ash", kind: "realm", first: true });
W.boons.choose("ash.realm", 1);
W.c.health = 50;
W.en._hurtPlayer(999);
const h1 = W.c.health;
W.en._hurtPlayer(999);
check("Undying Wake: 1 HP once, then 0", h1 === 1 && W.c.health === 0, [h1, W.c.health]);

// Shop prices + a Vitality rank on max HP.
W.shop.grant(1000, "test");
const g0 = W.shop.glass, hp0 = W.c.healthMax;
const r1 = W.shop.buy("shop.vitality");
check("Vitality I: -60 glass, max HP x1.04", r1.ok && W.shop.glass === g0 - 60 && W.c.healthMax === Math.round(hp0 * 1.04),
    { glass: [g0, W.shop.glass], hp: [hp0, W.c.healthMax] });
const prices = [];
for (let k = 0; k < 5; k++) { prices.push(W.shop.price("shop.wellspring")); W.shop.buy("shop.wellspring"); }
check("Wellspring I-V prices 60/90/130/180/240, then maxed", JSON.stringify(prices) === "[60,90,130,180,240]" && W.shop.price("shop.wellspring") === null, prices);

// Chronicle reroll: all 12 lore shards of Cold, deduped.
for (let n = 1; n <= 12; n++) bus.emit("reward", { kind: "lore", id: "lore.cold." + n });
bus.emit("reward", { kind: "lore", id: "lore.cold.3" });
check("12 Cold lore shards pay exactly one reroll", W.shop.rerolls === 1, W.shop.rerolls);

// Driftmarks at the cap.
W.P.level = 30; W.P._refreshNeed(); W.P.addXP(W.P.xpNeed + 1, "t");
W.mods.update(1 / 60);
check("a minted Driftmark is pending", W.mods.driftmarkPending() === 1, W.mods.driftmarkPending());
const dmgBefore = W.mods.hitMult(W.reg, -1, 0);
W.mods.pickDriftmark("dmg");
check("Driftmark dmg: +0.5%", near(W.mods.hitMult(W.reg, -1, 0) / dmgBefore, 1.005, 1e-9), W.mods.hitMult(W.reg, -1, 0) / dmgBefore);

// ------------------------------------------------------------ save / reload
W.P.save();
const before = JSON.stringify({ picks: W.boons.picks, owned: W.relics.owned, eq: W.relics.equipped, slot3: W.relics.slot3,
    glass: W.shop.glass, ranks: W.shop.ranks, rerolls: W.shop.rerolls, drift: W.mods.driftPicks, maxHp: W.mods.maxHp });
const blob = JSON.parse(store.get("driftwake_save"));
check("v4 blob carries the §8 keys", ["boons", "relics", "wakeGlass", "shop", "rerolls", "driftmarkPicks"].every((k) => k in blob),
    { boons: blob.boons, relics: blob.relics, wakeGlass: blob.wakeGlass, shop: blob.shop, rerolls: blob.rerolls, driftmarkPicks: blob.driftmarkPicks });
W = build();   // a fresh page: new Progression loads the blob; sections deserialize on register
const after = JSON.stringify({ picks: W.boons.picks, owned: W.relics.owned, eq: W.relics.equipped, slot3: W.relics.slot3,
    glass: W.shop.glass, ranks: W.shop.ranks, rerolls: W.shop.rerolls, drift: W.mods.driftPicks, maxHp: W.mods.maxHp });
check("reload restores boons, relics, glass, shop ranks, rerolls, driftmarks", before === after, { before, after });
W.P.newGame();
check("NEW RUN resets every lane-R section", W.boons.activeIds().length === 0 && W.relics.owned.length === 0 &&
    W.shop.glass === 0 && W.shop.rerolls === 0 && W.mods.maxHp === 1,
    { boons: W.boons.activeIds(), relics: W.relics.owned, glass: W.shop.glass, maxHp: W.mods.maxHp });

console.log("\n" + pass + " / " + (pass + fail) + " unit checks PASS");
process.exit(fail ? 1 : 0);
