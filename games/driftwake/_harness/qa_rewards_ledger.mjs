// qa_rewards_ledger.mjs -- lane R THE EFFECT LEDGER (Node, real consumers).
//
//   node --expose-gc --import ./_harness/node_three_register.mjs ./_harness/qa_rewards_ledger.mjs
//
// For every boon (QUEST §4.1, 12) and relic (§4.2, 12), plus the two shop
// ranks that change numbers (§4.3) and the three Driftmark picks (§4.4), this
// probe prints THE CODE LINE THAT APPLIES IT (found by grep at run time, so a
// moved line can never make the ledger lie) and MEASURES the effect on the
// real consumer with an A/B pair: the same scripted scene run twice from the
// same xorshift seed (spells/bending.js resetRandom), once without and once
// with the reward taken through the REAL reward modules (boons.choose,
// relics.grant/equip via a 'reward' bus event, shop.buy, mods.pickDriftmark).
//
// REAL (the game's own modules, unmodified): character/controller.js (surf
// cap, ollie, mana regen, max-pool accessors), spells/spellSystem.js + every
// spell it owns (cast(), cooldowns, the bolt leash, the vortex clock),
// combat/spellHits.js (every damage number), combat/damageable.js (chill,
// Brittle, stagger, knockback, speedMult, the event ring the floaters read),
// combat/enemies.js (real enemy units striking the player: _applyHit ->
// _hurtPlayer, _fireBolt -> _updateBolts), combat/motes.js (mote pickup),
// progression/progression.js (L10 anchor pools, death latch, v4 save),
// progression/{modifiers,boons,relics,shop}.js.
// STUB: flat terrain (heightAt 0), GPU-side objects (scene.add, sky/shadow
// uniform blocks), the enemy mesh renderer, the camera rig (yaw + basis).
// Damage is read from the registry EVENT RING (evAmount by evTag) -- the very
// numbers ui/floaters.js draws -- so "+8% shows in a damage number" is what
// is measured. Exit code 0 only if every check passes.
globalThis.document = globalThis.document || { getElementById: () => null };

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "src");

const THREE = await import("three");
const { registerShaders } = await import("../src/shaders/registry.js");
registerShaders();
const { bus } = await import("../src/quests/events.js");
const { input } = await import("../src/core/input.js");
const { S } = await import("../src/core/settings.js");
const { resetRandom } = await import("../src/spells/bending.js");
const { SpellSystem, ARC_KEY } = await import("../src/spells/spellSystem.js");
const { SpellHits } = await import("../src/combat/spellHits.js");
const { CharacterController } = await import("../src/character/controller.js");
const { DamageableRegistry, TIER } = await import("../src/combat/damageable.js");
const combatData = await import("../src/combat/combatData.js");
const { Enemies } = await import("../src/combat/enemies.js");
const { HealthMotes } = await import("../src/combat/motes.js");
const { Progression } = await import("../src/progression/progression.js");
const MOD = await import("../src/progression/modifiers.js");
const { Modifiers, BOON_FX, RELIC_FX } = MOD;
const { Boons } = await import("../src/progression/boons.js");
const { Relics } = await import("../src/progression/relics.js");
const { Shop } = await import("../src/progression/shop.js");
const { STORY } = await import("../src/quests/storyText.js");

// ------------------------------------------------------------------ report
const RESULTS = [];
function check(name, ok, detail) {
    RESULTS.push([name, !!ok]);
    console.log((ok ? "PASS " : "FAIL ") + name + "  " + JSON.stringify(detail === undefined ? "" : detail));
}
const r5 = (x) => (typeof x === "number" ? Math.round(x * 1e5) / 1e5 : x);
const near = (a, b, t) => typeof a === "number" && Number.isFinite(a) && Math.abs(a - b) <= t;

// The code line that applies an effect: grep the live source for a needle.
const FILES = {};
/** Needles that matched no source line (a ledger that points nowhere fails). */
const UNRESOLVED = [];
function codeLine(rel, needle) {
    if (!FILES[rel]) FILES[rel] = readFileSync(join(SRC, rel), "utf8").split(/\r?\n/);
    const L = FILES[rel];
    for (let i = 0; i < L.length; i++) {
        if (L[i].indexOf(needle) >= 0) return "src/" + rel + ":" + (i + 1) + "  " + L[i].trim();
    }
    UNRESOLVED.push(rel + " <" + needle + ">");
    return "src/" + rel + ": NOT FOUND <" + needle + ">";
}

// ------------------------------------------------------------ world stubs
const terrain = {
    realm: "cold",
    heightAt() { return 0; },
    normalAt(x, z, out) { return out.set(0, 1, 0); },
    edge01() { return 0; },
    clampToPlayArea() {},
};
const scene = { add() {}, remove() {} };
const sky = {
    sunDir: new THREE.Vector3(0.3, 0.8, 0.2).normalize(), sunRadiance: new THREE.Vector3(1, 1, 1),
    uniforms: {}, fogBoost: { density: 1, falloff: 1 },
};
const shadows = {
    registerCaster() {}, makeCasterMaterial() { return { dispose() {} }; }, receiverUniforms() { return {}; },
};
const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 2000);
const rig = {
    yaw: 0, roll: 0,
    forward: new THREE.Vector3(0, 0, -1), right: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 1, 0),
    camera,
    addTrauma() {},
    getFlatForward(out) { return out.set(Math.sin(this.yaw), 0, -Math.cos(this.yaw)); },
    getFlatRight(out) { return out.set(Math.cos(this.yaw), 0, Math.sin(this.yaw)); },
};
const vis = {
    _slotInst: [],
    spawnUnit(i) { this._slotInst[i] = { tint: new Float32Array([1, 1, 1, 0]), state: new Float32Array(4) }; },
    spawn(i) { this.spawnUnit(i); },
    free(i) { this._slotInst[i] = null; },
    drive() {}, driveBolt() {}, driveClip() {}, update() {},
};

function pin(name, val) {
    Object.defineProperty(input, name, { configurable: true, enumerable: true, get: () => val, set: () => {} });
}
function unpin(name, val) {
    Object.defineProperty(input, name, { configurable: true, enumerable: true, writable: true, value: val });
}
function inputs(o) {
    for (const k of ["surf", "jump", "jumpPressed", "sprint"]) unpin(k, false);
    unpin("moveX", 0); unpin("moveZ", 0);
    for (const k in (o || {})) pin(k, o[k]);
}

/** Camera behind the player looking at world point (x,y,z). */
function aimAt(w, x, y, z) {
    const c = w.character.position;
    const ex = c.x, ey = c.y + 1.6, ez = c.z + 2;
    camera.position.set(ex, ey, ez);
    const d = new THREE.Vector3(x - ex, y - ey, z - ez).normalize();
    rig.forward.copy(d);
    rig.right.set(-d.z, 0, d.x).normalize();
    rig.yaw = Math.atan2(d.x, -d.z);
    w.character.facing = rig.yaw;
    camera.lookAt(x, y, z);
    camera.updateMatrixWorld(true);
    // spells.update copies rig.forward into spells.aim each frame; a cast
    // issued before the next update must see the new aim too.
    if (w.spells) w.spells.aim.copy(d);
}

// ------------------------------------------------------------------ world
const DT = 1 / 60;
let current = null;
function world(o) {
    o = o || {};
    if (current) dispose(current);
    localStorage.clear();
    resetRandom(0x2545f491);
    inputs({});
    const character = new CharacterController(terrain);
    character.position.set(0, 0, 0);
    character.facing = 0;
    rig.yaw = 0;
    const spells = new SpellSystem(scene, sky, shadows, terrain, character, null, rig, null);
    const registry = new DamageableRegistry();
    const spellHits = new SpellHits(spells, registry, character, combatData.combatData);
    const enemies = new Enemies(scene, terrain, registry, character, combatData, null);
    enemies.attachVis(vis);
    const motes = new HealthMotes(scene, registry, character, terrain, spells.globals);
    const progression = new Progression(character, registry, null);
    progression.newGame();
    progression.level = o.level || 10;
    progression._refreshNeed();
    progression._applyLevelStats(true);
    progression.attach({ spells: spellHits, enemies });
    enemies.progression = progression;
    progression.graceUntil = -1;
    const w = {
        character, spells, registry, spellHits, enemies, motes, progression,
        bosses: { state: "idle" }, realm: "cold", t: 0, dmg: {}, hits: [],
    };
    const ctx = {
        scene, terrain, character, rig, spells, registry, enemies, motes, progression, bus,
        bosses: w.bosses, S, getRealm: () => w.realm,
    };
    w.ctx = ctx;
    w.mods = new Modifiers(ctx);
    w.relics = new Relics(ctx);
    w.boons = new Boons(ctx);
    w.shop = new Shop(ctx);
    aimAt(w, 0, 0.9, -8);
    current = w;
    return w;
}
function dispose(w) {
    w.mods.dispose(); w.boons.dispose(); w.relics.dispose();
    if (w.shop.dispose) w.shop.dispose();
    if (w.progression._unsubRealm) w.progression._unsubRealm();
    w.enemies.clear();
    current = null;
}

/** One frame, main.js order (controller -> spells -> registry -> spellHits ->
 *  mods -> enemies -> motes -> progression -> endFrame). The damage tap reads
 *  the event ring (what the floaters draw) before it is cleared. */
function frame(w, dt) {
    dt = dt || DT;
    w.character.update(dt, rig);
    w.spells.update(dt, camera.position, camera);
    w.registry.update(dt);
    w.spellHits.update(dt);
    w.mods.update(dt);
    w.enemies.update(dt);
    w.motes.update(dt);
    w.progression.update(dt);
    const r = w.registry;
    for (let e = 0; e < r.eventCount; e++) {
        if (r.evType[e] !== 0) continue;
        const tag = r.evTag[e] || "?";
        w.dmg[tag] = (w.dmg[tag] || 0) + r.evAmount[e];
        if (w.hitLog) w.hits.push({ t: r5(r.time), tag, id: r.evId[e], amt: r5(r.evAmount[e]) });
    }
    r.endFrame();
    w.t += dt;
}
function run(w, sec, each) {
    const n = Math.round(sec / DT);
    for (let i = 0; i < n; i++) { frame(w); if (each) each(i); }
}
function dummy(w, x, z, tier, extra) {
    return w.registry.register(Object.assign({
        x, y: 0, z, radius: 0.5, height: 1.8, tier: tier === undefined ? TIER.MEDIUM : tier,
        level: 10, hp: 1e6, poiseMax: 1e9, name: "QA Dummy", kind: "enemy",
    }, extra || {}));
}
const hpLost = (w, id) => { const s = w.registry.slot(id); return s < 0 ? NaN : w.registry.hpMax[s] - w.registry.hp[s]; };

// Reward application through the REAL modules.
function takeBoon(w, id) {
    for (const key in STORY.boonPairs) {
        const at = STORY.boonPairs[key].indexOf(id);
        if (at < 0) continue;
        const [realm, kind] = key.split(".");
        bus.emit("boss:killed", { realm, kind, key: "qa", name: "QA", first: true });
        const ok = w.boons.choose(key, at);
        if (!ok) throw new Error("choose failed " + key);
        return;
    }
    throw new Error("no pair for " + id);
}
function takeRelic(w, id) {
    bus.emit("reward", { kind: "relic", id, source: "cache" });
    if (w.relics.equipped.indexOf(id) < 0) {
        const s = w.relics.equipped.indexOf(null);
        w.relics.equip(id, s >= 0 && s < w.relics.slotCount ? s : 0);
    }
    if (w.relics.equipped.indexOf(id) < 0) throw new Error("relic not worn " + id);
}

/** A/B: the same scene with and without one reward. */
function ab(reward, scene) {
    const A = world(); const a = scene(A, false);
    const B = world(); reward(B); const b = scene(B, true);
    dispose(B);
    return { a, b };
}

// =====================================================================
// Scenes (each returns measured numbers)
// =====================================================================

/** Spikes (key 4) on a dummy 6 m ahead, then two arcs (key 1 / ARC_KEY) 1.5 s
 *  apart: per-tag damage off the event ring. */
function kitVolley(w) {
    const id = dummy(w, 0, -6);
    aimAt(w, 0, 0, -6);
    w.spells.cast(4);
    run(w, 2.6);                                       // 0.95 s strike + 0.85 s plant
    const spikes = w.dmg.spikes || 0;
    aimAt(w, 0, 0.9, -6);
    w.dmg = {};
    w.spells.cast(ARC_KEY);
    run(w, 0.1);
    const arc1 = w.dmg.bolt || 0;
    run(w, 1.45);
    w.dmg = {};
    w.spells.cast(ARC_KEY);
    run(w, 0.1);
    const arc2 = w.dmg.bolt || 0;
    return { spikes: r5(spikes), arc1: r5(arc1), arc2: r5(arc2), id };
}

/** The bolt stream (LMB, debugBolt) at a planted dummy 8 m ahead for `sec`:
 *  max chill stacks, min chill-only speed, Brittle uptime, per-tag damage. */
function boltStream(w, sec, opts) {
    opts = opts || {};
    const id = dummy(w, 0, -8, opts.tier);
    aimAt(w, 0, 0.9, -8);
    const r = w.registry;
    let maxChill = 0, minSpeed = 1, brittle = 0, frames = 0;
    w.dmg = {};
    w.spells.debugBolt = true;
    run(w, sec, () => {
        const s = r.slot(id);
        if (r.chill[s] > maxChill) maxChill = r.chill[s];
        const sp = r.speedMult(id);
        if (sp < minSpeed) minSpeed = sp;
        if (r.time < r.brittleUntil[s]) brittle++;
        frames++;
    });
    w.spells.debugBolt = false;
    run(w, 2.5);                                       // let burns finish
    return { maxChill, minSpeed: r5(minSpeed), brittleUptime: r5(brittle / frames),
        bolt: r5(w.dmg.bolt || 0), splash: r5(w.dmg.splash || 0), ignite: r5(w.dmg.ignite || 0), id };
}

/** Surf straight on flat ground for `sec`: steady speed, distance. */
function surf(w, sec) {
    aimAt(w, 0, 0.9, -50);
    inputs({ surf: true });
    let top = 0;
    run(w, sec, () => { if (w.character.speed > top) top = w.character.speed; });
    const v = Math.hypot(w.character.velocity.x, w.character.velocity.z);
    inputs({});
    return { speed: r5(v), top: r5(top) };
}

/** Ollie off a full carve: max airHeight of a held jump (no jump-cut). */
function ollie(w) {
    aimAt(w, 0, 0.9, -80);
    inputs({ surf: true });
    run(w, 3.0);                                       // surf blend -> ~1
    const surf01 = w.character.surf;
    inputs({ surf: true, jump: true, jumpPressed: true });
    frame(w);
    inputs({ surf: true, jump: true });
    let apex = 0, t = 0;
    const v0 = w.character.vertVel;
    while (t < 2) {
        frame(w); t += DT;
        if (w.character.airHeight > apex) apex = w.character.airHeight;
        if (!w.character.airborne) break;
    }
    inputs({});
    return { surf01: r5(surf01), takeoffVel: r5(v0), apex: r5(apex) };
}

/** A real enemy unit of `tier` strikes the stationary player (the enemy AI
 *  drives _applyHit / _fireBolt / _updateBolts); every landed hit is
 *  recorded with the attack row it came from. */
function enemyHits(w, unitPred, sec, dist, crowd, throwEvery) {
    const en = w.enemies;
    let k = -1;
    for (let n = 0; n < en.units.length; n++) if (unitPred(en.units[n])) { k = n; break; }
    if (k < 0) return { error: "no unit" };
    const u = en.units[k];
    // A crowd of melee units takes every melee token first, so the unit
    // under test is TOKENLESS — the state in which a heavy pokes with its
    // ranged row (enemies.js _closeAndSwing "Tokenless: keep the pressure on").
    if (crowd) {
        let m = -1;
        for (let n = 0; n < en.units.length; n++) {
            const v = en.units[n];
            if (v.tier === TIER.FODDER && Array.from(v.aKind).some((q) => q === 0)) { m = n; break; }
        }
        for (let j = 0; j < crowd; j++) {
            const a = j * 6.2832 / crowd + 0.6;
            en.spawn(m, Math.sin(a) * 1.6, -Math.cos(a) * 1.6, 10);
        }
    }
    const id = en.spawn(k, 0, -(dist || 2.2), 10);
    let slot = -1;
    for (let i = 0; i < en.alive.length; i++) if (en.alive[i] && en.id[i] === id) slot = i;
    const c = w.character;
    const hits = [];
    let pulse = en.playerHurtPulse;
    // Projectile bookkeeping: a bolt's row is fixed at LAUNCH (the attack
    // index in force on its rising edge); a hurt pulse on the frame a bolt
    // dies is that bolt landing.
    const NB = en.boltAlive.length;
    const prev = new Uint8Array(NB), rowAt = new Float64Array(NB);
    let dProj = -1;
    for (let d = 0; d < u.nAtk; d++) if (u.aKind[d] === 1) dProj = d;
    let nextThrow = throwEvery || Infinity;
    run(w, sec, (f) => {
        // Direct launch of the unit's projectile row through the REAL
        // (wrapped) _fireBolt; flight and landing are the runtime's own
        // _updateBolts. Only the AI's choice to throw is bypassed.
        if (dProj >= 0 && f * DT >= nextThrow) {
            nextThrow += throwEvery;
            en._fireBolt(slot, u, dProj);
            for (let b = 0; b < NB; b++) {
                if (en.boltAlive[b] && !prev[b]) { rowAt[b] = u.aDmg[dProj] * en.dmgScale[slot]; prev[b] = 1; }
            }
        }
        let landed = -1;
        for (let b = 0; b < NB; b++) {
            if (en.boltAlive[b] && !prev[b]) {
                const d = en.atk[slot];
                rowAt[b] = d >= 0 ? u.aDmg[d] * en.dmgScale[slot] : NaN;
            }
            if (!en.boltAlive[b] && prev[b]) landed = b;
            prev[b] = en.boltAlive[b];
        }
        if (en.playerHurtPulse !== pulse) {
            pulse = en.playerHurtPulse;
            const lost = c.healthMax - c.health;
            if (landed >= 0) {
                hits.push({ lost: r5(lost), proj: true, row: r5(rowAt[landed]) });
            } else {
                const d = en.atk[slot];
                hits.push({ lost: r5(lost), atk: d, row: d >= 0 ? r5(u.aDmg[d] * en.dmgScale[slot]) : null });
            }
            c.health = c.healthMax;
        }
    });
    return { unit: u.name, tier: u.tier, aDmg: Array.from(u.aDmg).map(r5), aKind: Array.from(u.aKind), hits };
}

// =====================================================================
console.log("== THE EFFECT LEDGER — every boon and relic, measured on the real consumer ==");
const COVERED = new Set();
function ledger(id, lines) {
    COVERED.add(id);
    console.log("\nLEDGER " + id + "  (" + ((STORY.boons[id] || STORY.relics[id] || STORY.shop[id] || {}).effect || "") + ")");
    for (const l of lines) console.log("    applied at " + l);
}

// ---------------------------------------------------------------- BOONS
{
    ledger("boon.rimeEdge", [
        codeLine("progression/modifiers.js", "if (kind !== KIND_FIRE) m *= this.dmgFrost;"),
        codeLine("combat/spellHits.js", "* this.damageMult * this._rm(slot, 0);"),
    ]);
    const { a, b } = ab((w) => takeBoon(w, "boon.rimeEdge"), kitVolley);
    check("boon.rimeEdge +8% frost damage: Spikes and Frost Arc damage numbers x1.08",
        near(b.spikes / a.spikes, 1.08, 1e-4) && near(b.arc1 / a.arc1, 1.08, 1e-4) && a.spikes > 0 && a.arc1 > 0,
        { A: a, B: b, spikes: r5(b.spikes / a.spikes), arc: r5(b.arc1 / a.arc1) });
}
{
    ledger("boon.deepChill", [
        codeLine("progression/modifiers.js", "reg.chill[slot] = Math.min(this.chillMax, c0 + 1);"),
        codeLine("progression/modifiers.js", "reg.chill[slot] = 1;"),
        codeLine("combat/spellHits.js", "if (D.chill && !moving) this.mods.onChillHit(reg, hs, id, c0, false);"),
    ]);
    const { a, b } = ab((w) => takeBoon(w, "boon.deepChill"), (w) => boltStream(w, 10));
    check("boon.deepChill chill stacks to 6 (deeper slow): a planted bolt stream holds 6 stacks (A 5), chill slow 36% (A 30%)",
        a.maxChill === 5 && b.maxChill === 6 && near(a.minSpeed, 0.70, 1e-4) && near(b.minSpeed, 0.64, 1e-4) && a.bolt > 0,
        { A: a, B: b });
    // PROGRESSION §8.3 prices Deep Chill as "deeper slow + longer Brittle
    // uptime": the stack that overflows the cap carries over, so at a cadence
    // that does NOT saturate (the Frost Arc, 1.5 s) the next Brittle comes a
    // hit sooner. (A saturating bolt stream re-Brittles on the first hit after
    // expiry either way — equal uptime there, which is why this is separate.)
    const arcs = (w) => {
        const id = dummy(w, 0, -5);
        aimAt(w, 0, 0.9, -5);
        const r = w.registry;
        let brittle = 0, frames = 0;
        for (let k = 0; k < 14; k++) {
            w.spells.cast(ARC_KEY);
            run(w, 1.52, () => {                         // just past the 1.5 s arc cooldown
                const s = r.slot(id);
                if (r.time < r.brittleUntil[s]) brittle++;
                frames++;
            });
        }
        return { brittleUptime: r5(brittle / frames), frames };
    };
    const u = ab((w) => takeBoon(w, "boon.deepChill"), arcs);
    check("boon.deepChill longer Brittle uptime: Frost Arc every 1.5 s for 21 s, the Brittle (+20% damage taken) window is up longer",
        u.b.brittleUptime > u.a.brittleUptime, { A: u.a, B: u.b });
}
{
    ledger("boon.glacialGuard", [codeLine("character/controller.js", "Math.round(this._healthMaxBase * m.maxHp)")]);
    const { a, b } = ab((w) => takeBoon(w, "boon.glacialGuard"),
        (w) => ({ healthMax: w.character.healthMax, health: w.character.health }));
    check("boon.glacialGuard +10% max HP: controller.healthMax 100 -> 110 at L10 (and the pool grows with it)",
        a.healthMax === 100 && b.healthMax === 110 && b.health === 110, { A: a, B: b });
}
{
    ledger("boon.frostNova", [
        codeLine("progression/modifiers.js", "reg.damage(id, 0, OPT_RECHILL);"),
        codeLine("combat/spellHits.js", "if (this.mods !== null && D.chill) this.mods.onChillHit(reg, slot, id, c0, true);"),
    ]);
    const { a, b } = ab((w) => takeBoon(w, "boon.frostNova"), (w) => {
        const id = dummy(w, 0, -5);
        aimAt(w, 0, 0.9, -5);
        w.spells.cast(ARC_KEY);
        run(w, 0.1);
        const s = w.registry.slot(id);
        return { chillAfterOneArc: w.registry.chill[s], arcDamage: r5(w.dmg.bolt || 0), speed: r5(w.registry.speedMult(id)) };
    });
    check("boon.frostNova the Arc chills twice: one Frost Arc leaves 2 Chill stacks (A 1), same damage",
        a.chillAfterOneArc === 1 && b.chillAfterOneArc === 2 && near(b.arcDamage, a.arcDamage, 1e-6) && b.speed < a.speed,
        { A: a, B: b });
}
{
    ledger("boon.quickenedSpikes", [
        codeLine("spells/spellSystem.js", "this._cdUntil[key] = this._time + this._cd(key, COOLDOWN[key] || 0);"),
        codeLine("progression/modifiers.js", "let c = base - (key >= 0 && key < 8 ? this.cdFlat[key] : 0);"),
    ]);
    const { a, b } = ab((w) => takeBoon(w, "boon.quickenedSpikes"), (w) => {
        aimAt(w, 0, 0, -6);
        w.spells.cast(4);
        const left = w.spells.cooldownLeft(4);
        const frac = w.spells.cooldownFrac(4);
        run(w, 8.1);
        w.character.mana = w.character.manaMax;
        w.spells._pending.key = 0;
        w.spells.cast(4);
        const recastAt81 = w.spells._pending.key === 4;
        return { cooldownLeft: r5(left), wipeFrac: r5(frac), recastAt81 };
    });
    check("boon.quickenedSpikes Spikes cooldown -2 s: 10 s -> 8 s, recast lands at 8.1 s (A refused), wipe spans the real cooldown",
        near(a.cooldownLeft, 10, 1e-6) && near(b.cooldownLeft, 8, 1e-6) && !a.recastAt81 && b.recastAt81 && b.wipeFrac === 1,
        { A: a, B: b });
}
{
    ledger("boon.tidalForce", [
        codeLine("combat/spellHits.js", "ccMag: D.kbMag * (this.mods === null ? 1 : this.mods.waveKnock),"),
        codeLine("combat/spellHits.js", "this._rm(slot, 1)"),
        codeLine("progression/modifiers.js", "if (kind === KIND_WAVE) m *= this.waveDmg;"),
    ]);
    const { a, b } = ab((w) => takeBoon(w, "boon.tidalForce"), (w) => {
        const id = dummy(w, 0, -4);
        aimAt(w, 0, 0.9, -4);
        w.spells.cast(1);
        let kb = 0;
        run(w, 2.5, () => {
            const s = w.registry.slot(id);
            const m = Math.hypot(w.registry.kbX[s], w.registry.kbZ[s]);
            if (m > kb) kb = m;
        });
        return { wave: r5(w.dmg.wave || 0), knockback: r5(kb) };
    });
    check("boon.tidalForce Wave knockback +30%, Wave damage +8%: measured knockback x1.30, wave damage number x1.08",
        a.wave > 0 && near(b.wave / a.wave, 1.08, 1e-4) && a.knockback > 0 && near(b.knockback / a.knockback, 1.30, 1e-4),
        { A: a, B: b, dmg: r5(b.wave / a.wave), kb: r5(b.knockback / a.knockback) });
}
{
    ledger("boon.sandstep", [codeLine("character/controller.js", "const smax = SURF_MAX * (this.mods === null ? 1 : this.mods.surfSpeed);")]);
    const { a, b } = ab((w) => takeBoon(w, "boon.sandstep"), (w) => surf(w, 8));
    check("boon.sandstep +8% surf speed: the controller's steady carve speed x1.08",
        a.speed > 10 && near(b.speed / a.speed, 1.08, 1e-3), { A: a, B: b, ratio: r5(b.speed / a.speed) });
}
{
    ledger("boon.sunder", [codeLine("progression/modifiers.js", "if (this.dmgVsStaggered !== 1 && t < reg.staggerUntil[slot])")]);
    const { a, b } = ab((w) => takeBoon(w, "boon.sunder"), (w) => {
        const id = dummy(w, 0, -6);
        const r = w.registry;
        aimAt(w, 0, 0, -6);
        w.spells.cast(3);                               // Mini-Vortex: the registry's own stagger write
        let tries = 0;
        while (!(r.time < r.staggerUntil[r.slot(id)]) && tries++ < 240) frame(w);
        const staggered = r.time < r.staggerUntil[r.slot(id)];
        aimAt(w, 0, 0.9, -6);
        w.dmg = {};
        w.spells.cast(ARC_KEY);
        frame(w); frame(w);
        const arcStaggered = w.dmg.bolt || 0;
        run(w, 1.6);                                    // stagger long over
        const after = r.time < r.staggerUntil[r.slot(id)];
        w.dmg = {};
        w.spells.cast(ARC_KEY);
        frame(w); frame(w);
        return { staggeredAtArc: staggered, arcStaggered: r5(arcStaggered), staggeredLater: after, arcPlain: r5(w.dmg.bolt || 0) };
    });
    check("boon.sunder +12% vs staggered: an arc on a staggered foe x1.12, on an unstaggered foe x1.00",
        a.staggeredAtArc && b.staggeredAtArc && !b.staggeredLater && near(b.arcStaggered / a.arcStaggered, 1.12, 1e-4)
        && near(b.arcPlain / a.arcPlain, 1.0, 1e-4),
        { A: a, B: b, staggered: r5(b.arcStaggered / a.arcStaggered), plain: r5(b.arcPlain / a.arcPlain) });
}
{
    ledger("boon.cinderbrand", [codeLine("progression/modifiers.js", "m *= this.dmgVsChilled;")]);
    const { a, b } = ab((w) => takeBoon(w, "boon.cinderbrand"), kitVolley);
    check("boon.cinderbrand +8% vs chilled: the first arc (target unchilled) x1.00, the second (chilled by the first) x1.08",
        near(b.arc1 / a.arc1, 1.0, 1e-4) && near(b.arc2 / a.arc2, 1.08, 1e-4) && near(b.spikes / a.spikes, 1.0, 1e-4),
        { A: a, B: b, arc1: r5(b.arc1 / a.arc1), arc2: r5(b.arc2 / a.arc2) });
}
{
    ledger("boon.greatVortex", [
        codeLine("spells/spellSystem.js", "ctx.vortexScale = this.mods === null ? 1 : this.mods.vortexRadius;"),
        codeLine("spells/vortex.js", "this.ring = this._ringBase * (this.ctx.vortexScale || 1);"),
        codeLine("combat/spellHits.js", "const ringR = vx.ring;"),
    ]);
    const RADII = [3.3, 3.5, 3.7, 3.9, 4.1];
    const { a, b } = ab((w) => takeBoon(w, "boon.greatVortex"), (w) => {
        const ids = RADII.map((d, i) => {
            const ang = i * 1.2566;                 // spread around the player
            return dummy(w, Math.sin(ang) * d, -Math.cos(ang) * d, TIER.HEAVY);
        });
        // The DRAWN column: every helix sample the vortex hands the water body
        // (spells/waterBody.js column()), as a horizontal radius from its axis.
        const water = w.spells.water;
        const col0 = water.column;
        let helixMax = 0;
        water.column = function (s, c, x, y, z, ...rest) {
            const vx = w.spells.vortex;
            if (vx.active && vx.strands.indexOf(s) >= 0) helixMax = Math.max(helixMax, Math.hypot(x - vx.x, z - vx.z));
            return col0.call(this, s, c, x, y, z, ...rest);
        };
        w.spells.cast(5);
        let ring = 0;
        run(w, 6.5, () => { if (w.spells.vortex.ring > ring) ring = w.spells.vortex.ring; });
        water.column = col0;
        const hit = ids.map((id) => r5(hpLost(w, id)));
        let far = 0;
        for (let i = 0; i < RADII.length; i++) if (hit[i] > 0) far = RADII[i];
        return { ringMax: r5(ring), helixMax: r5(helixMax), damageByRadius: hit, farthestHit: far };
    });
    check("boon.greatVortex radius +15%: bodies at 3.7 m and 3.9 m now take vortex damage (A reaches 3.5 m, ring 3.1 + 0.5 body)",
        a.farthestHit === 3.5 && b.farthestHit === 3.9 && b.damageByRadius[2] > 0 && a.damageByRadius[2] === 0,
        { radii: RADII, A: a, B: b });
    check("boon.greatVortex is SEEN: the drawn ring (ground scour) and the helix column are x1.15 too — the ring that is drawn is the ring that hits",
        near(a.ringMax, 3.1, 1e-4) && near(b.ringMax / a.ringMax, 1.15, 1e-4) && a.helixMax > 1
        && near(b.helixMax / a.helixMax, 1.15, 1e-3), { A: { ring: a.ringMax, helix: a.helixMax }, B: { ring: b.ringMax, helix: b.helixMax } });
}
{
    ledger("boon.heartOfTheDrift", [codeLine("progression/modifiers.js", "let m = this.dmgAll;")]);
    const { a, b } = ab((w) => takeBoon(w, "boon.heartOfTheDrift"), kitVolley);
    check("boon.heartOfTheDrift +12% all damage: Spikes and both arcs x1.12",
        near(b.spikes / a.spikes, 1.12, 1e-4) && near(b.arc1 / a.arc1, 1.12, 1e-4) && near(b.arc2 / a.arc2, 1.12, 1e-4),
        { A: a, B: b });
}
{
    ledger("boon.undyingWake", [
        codeLine("progression/modifiers.js", "c.health = 1;"),
        codeLine("progression/modifiers.js", "en._hurtPlayer = function (dmg, sx, sz) {"),
    ]);
    const lethal = (w) => {
        const out = {};
        const trig = [];
        const off = bus.on("boon:triggered", (p) => trig.push(p.id));
        const c = w.character, en = w.enemies, P = w.progression;
        c.health = 30;
        en._hurtPlayer(999, 0, -2);                       // the enemy runtime's ONLY player-damage path
        frame(w);
        out.hit1 = { health: c.health, dead: P.dead };
        run(w, 0.6);                                       // past the 0.5 s i-frames
        en._hurtPlayer(999, 0, -2);
        frame(w);
        out.hit2SameFight = { health: c.health, dead: P.dead };
        run(w, 2.0);                                       // death fade -> respawn at the shrine
        out.respawned = { health: c.health, dead: P.dead, armed: w.mods.undyingArmed };
        run(w, 2.2);                                       // past the 2 s respawn grace
        en._hurtPlayer(999, 0, -2);
        frame(w);
        out.hitAfterRespawn = { health: c.health, dead: P.dead };
        run(w, 10.6);                                      // a quiet fight-gap re-arms it
        out.armedAfterQuiet = w.mods.undyingArmed;
        w.bosses.state = "live";
        en._hurtPlayer(999, 0, -2);
        frame(w);
        run(w, 10.6);
        out.armedDuringBossFight = w.mods.undyingArmed;
        w.bosses.state = "idle";
        out.triggered = trig.length;
        off();
        return out;
    };
    const { a, b } = ab((w) => takeBoon(w, "boon.undyingWake"), lethal);
    check("boon.undyingWake once per fight: a lethal hit leaves 1 HP (A dies), the 2nd lethal hit in the same fight kills, respawn and a 10 s quiet gap re-arm it, a live boss fight does not",
        a.hit1.health === 0 && b.hit1.health === 1 && !b.hit1.dead && b.hit2SameFight.health === 0
        && b.respawned.armed && b.hitAfterRespawn.health === 1 && b.armedAfterQuiet && !b.armedDuringBossFight
        && b.triggered === 3,
        { A: a.hit1, B: b });
}

// ---------------------------------------------------------------- RELICS
{
    ledger("relic.rimeHeart", [codeLine("progression/modifiers.js", "if (this.chillExtend > 0) reg.chillAt[slot] = reg.time + this.chillExtend;")]);
    const { a, b } = ab((w) => takeRelic(w, "relic.rimeHeart"), (w) => {
        const id = dummy(w, 0, -5);
        aimAt(w, 0, 0.9, -5);
        w.spells.cast(ARC_KEY);
        frame(w);
        const t0 = w.registry.time;
        let last = t0;
        run(w, 6, () => { if (w.registry.speedMult(id) < 1) last = w.registry.time; });
        return { slowedFor: r5(last - t0) };
    });
    check("relic.rimeHeart Chill lasts +1 s: the arc's chill keeps the foe slowed ~4.0 s (A ~3.0 s)",
        near(a.slowedFor, 3.0, 0.05) && near(b.slowedFor - a.slowedFor, 1.0, 0.05), { A: a, B: b });
}
{
    ledger("relic.frostglassLens", [codeLine("spells/spellSystem.js", "const boltRange = BOLT_RANGE * (this.mods === null ? 1 : this.mods.boltRange);")]);
    const { a, b } = ab((w) => takeRelic(w, "relic.frostglassLens"), (w) => {
        aimAt(w, 0, 1.6, -200);                         // flat: the eye ray never meets the ground
        const pool = w.spells.bolt;
        w.spells.cast(6);
        let slot = -1;
        for (let i = 0; i < pool.alive.length; i++) if (pool.alive[i] && !pool.own[i]) slot = i;
        const x0 = pool.x[slot], z0 = pool.z[slot];
        let far = 0;
        run(w, 3, () => { if (pool.alive[slot]) far = Math.max(far, Math.hypot(pool.x[slot] - x0, pool.z[slot] - z0)); });
        // A body at 44 m straight down the line.
        const id = dummy(w, 0, -44);
        w.dmg = {};
        w.spells.cast(6);
        run(w, 3);
        return { flight: r5(far), hit44m: r5(hpLost(w, id)) };
    });
    check("relic.frostglassLens bolt range +20%: the bolt flies ~48 m (A ~40 m) and now reaches a body at 44 m",
        a.flight > 38 && a.flight <= 40.5 && near(b.flight / a.flight, 1.2, 0.02) && a.hit44m === 0 && b.hit44m > 0,
        { A: a, B: b, ratio: r5(b.flight / a.flight) });
}
{
    ledger("relic.keelOfTheFirst", [codeLine("character/controller.js", "const smax = SURF_MAX * (this.mods === null ? 1 : this.mods.surfSpeed);")]);
    const { a, b } = ab((w) => takeRelic(w, "relic.keelOfTheFirst"), (w) => surf(w, 8));
    check("relic.keelOfTheFirst surf speed +6%: steady carve speed x1.06",
        a.speed > 10 && near(b.speed / a.speed, 1.06, 1e-3), { A: a, B: b, ratio: r5(b.speed / a.speed) });
}
{
    ledger("relic.warmHands", [codeLine("character/controller.js", "(this.mods === null ? 1 : this.mods.manaRegen) * h);")]);
    const { a, b } = ab((w) => takeRelic(w, "relic.warmHands"), (w) => {
        w.character.mana = 0;
        run(w, 2);
        return { manaIn2s: r5(w.character.mana) };
    });
    check("relic.warmHands mana regen +20%: mana regained in 2 s x1.20 (A 18 at the L10 9/s)",
        near(a.manaIn2s, 18, 0.2) && near(b.manaIn2s / a.manaIn2s, 1.2, 1e-3), { A: a, B: b });
}
{
    ledger("relic.brassBuckle", [
        codeLine("progression/modifiers.js", "d *= self.heavyTaken;"),
        codeLine("progression/modifiers.js", "this.boltDmg[b] *= self.heavyTaken;"),
    ]);
    const heavyMelee = (u) => u.tier === TIER.HEAVY && Array.from(u.aKind).some((k) => k === 0) && u.realm === "cold";
    const heavyProj = (u) => u.tier === TIER.HEAVY && Array.from(u.aKind).some((k) => k === 1);
    const medium = (u) => u.tier === TIER.MEDIUM && Array.from(u.aKind).some((k) => k === 0);
    const scene = (pred, dist, crowd) => (w) => enemyHits(w, pred, 25, dist, crowd);
    const A = world(); const ah = scene(heavyMelee)(A);
    const B = world(); takeRelic(B, "relic.brassBuckle"); const bh = scene(heavyMelee)(B);
    const B2 = world(); takeRelic(B2, "relic.brassBuckle");
    const bp = enemyHits(B2, heavyProj, 8, 7, 0, 1.0);
    const B3 = world(); takeRelic(B3, "relic.brassBuckle"); const bm = scene(medium)(B3);
    dispose(B3);
    const ratio = (h) => h.filter((x) => x.row > 0).map((x) => r5(x.lost / x.row));
    const ra = ratio(ah.hits), rb = ratio(bh.hits), rm = ratio(bm.hits);
    const rp = ratio(bp.hits.filter((x) => x.proj));
    // Flank bonus (rear hits) multiplies some rows; every landed hit must be
    // the row x {1 | flank} x 0.85 for heavies, x1 for the rest.
    check("relic.brassBuckle -15% from heavies: a real heavy's landed hits cost 0.85 x its row (A 1.00), a medium's 1.00",
        ra.length > 0 && rb.length > 0 && rm.length > 0 && ra.every((x) => x >= 1 - 1e-4)
        && rb.every((x) => near(x / (ra[0] || 1), 0.85, 1e-3) || near(x, 0.85, 1e-3))
        && rm.every((x) => x >= 1 - 1e-4),
        { A: { unit: ah.unit, hitRatios: ra }, B: { unit: bh.unit, hitRatios: rb },
            heavyProjectiles: { unit: bp.unit, hitRatios: rp, scaledBolts: B2.mods.counters.heavyHitsScaled },
            medium: { unit: bm.unit, hitRatios: rm } });
    check("relic.brassBuckle heavy PROJECTILES: a heavy unit's thrown row (real _fireBolt launch, real _updateBolts flight) lands at 0.85 x its row",
        rp.length > 0 && rp.every((x) => near(x, 0.85, 1e-3)), { unit: bp.unit, aKind: bp.aKind, hitRatios: rp, hits: bp.hits.slice(0, 4) });
}
{
    ledger("relic.sandGlass", [codeLine("progression/modifiers.js", "c *= this.cdMult;")]);
    const { a, b } = ab((w) => takeRelic(w, "relic.sandGlass"), (w) => {
        aimAt(w, 0, 0, -6);
        const out = {};
        for (const k of [1, 4, 5, ARC_KEY]) {
            w.character.mana = w.character.manaMax;
            w.spells._pending.key = 0;
            w.spells.cast(k);
            out["key" + k] = r5(w.spells.cooldownLeft(k));
        }
        return out;
    });
    check("relic.sandGlass spell cooldowns -8%: wave 4 -> 3.68, spikes 10 -> 9.2, vortex 14 -> 12.88, arc 1.5 -> 1.38",
        near(b.key1, 3.68, 1e-4) && near(b.key4, 9.2, 1e-4) && near(b.key5, 12.88, 1e-4) && near(b["key" + ARC_KEY], 1.38, 1e-4)
        && near(a.key4, 10, 1e-6), { A: a, B: b });
}
{
    ledger("relic.duneRunner", [codeLine("character/controller.js", "(this.mods === null ? 1 : 1 + (this.mods.surfJumpVel - 1) * this.surf);")]);
    const { a, b } = ab((w) => takeRelic(w, "relic.duneRunner"), ollie);
    check("relic.duneRunner surf jump +25%: the surf ollie's apex x1.25",
        a.apex > 1 && near(b.apex / a.apex, 1.25, 0.02), { A: a, B: b, ratio: r5(b.apex / a.apex) });
}
{
    ledger("relic.scorpionsPatience", [
        codeLine("progression/modifiers.js", "if (this.dodgeDmg !== 1 && reg && reg.time < this._dodgeUntil) m *= this.dodgeDmg;"),
        codeLine("progression/modifiers.js", "if (air && !this._wasAir && c.surf > SURF_ON) {"),
    ]);
    const { a, b } = ab((w) => takeRelic(w, "relic.scorpionsPatience"), (w) => {
        const o = ollie(w);                           // the dodge-surf (take-off edge)
        const arcAt = (wait) => {
            run(w, wait);
            const c = w.character, f = c.facing;
            const fx = Math.sin(f), fz = -Math.cos(f);
            const id = dummy(w, c.position.x + fx * 4, c.position.z + fz * 4);
            w.spells.aim.set(fx, 0, fz);
            rig.forward.set(fx, 0, fz);
            w.dmg = {};
            w.spells.cast(ARC_KEY);
            frame(w); frame(w);
            w.registry.remove(id);
            return r5(w.dmg.bolt || 0);
        };
        return { ollieApex: o.apex, arcInWindow: arcAt(0.2), arcAfterWindow: arcAt(2.2), dodges: w.mods.counters.dodges };
    });
    check("relic.scorpionsPatience +10% for 2 s after a dodge-surf: an arc inside the window x1.10, after it x1.00",
        b.dodges >= 1 && near(b.arcInWindow / a.arcInWindow, 1.10, 1e-4) && near(b.arcAfterWindow / a.arcAfterWindow, 1.0, 1e-4),
        { A: a, B: b, inWindow: r5(b.arcInWindow / a.arcInWindow), after: r5(b.arcAfterWindow / a.arcAfterWindow) });
}
{
    ledger("relic.emberCoil", [
        codeLine("progression/modifiers.js", "const dealt = reg.damage(id, amt, OPT_IGNITE);"),
        codeLine("combat/spellHits.js", "this.mods.onBoltHit(id);"),
    ]);
    const one = (w) => {
        const id = dummy(w, 0, -8);
        aimAt(w, 0, 0.9, -8);
        w.dmg = {};
        w.spells.cast(6);
        run(w, 3);
        return { bolt: r5(w.dmg.bolt || 0), ignite: r5(w.dmg.ignite || 0) };
    };
    const { a, b } = ab((w) => takeRelic(w, "relic.emberCoil"), one);
    const { b: c } = ab((w) => { takeRelic(w, "relic.emberCoil"); takeBoon(w, "boon.rimeEdge"); }, one);
    check("relic.emberCoil bolts ignite 3 dmg/s for 2 s: one bolt adds 6.0 'ignite' damage (A 0); FIRE is not boosted by Rime Edge",
        a.bolt > 0 && a.ignite === 0 && near(b.ignite, 6.0, 1e-4) && near(c.ignite, 6.0, 1e-4) && near(c.bolt / b.bolt, 1.08, 1e-4),
        { A: a, B: b, withRimeEdge: c });
}
{
    ledger("relic.plateShard", [codeLine("character/controller.js", "Math.round(this._healthMaxBase * m.maxHp)")]);
    const { a, b } = ab((w) => takeRelic(w, "relic.plateShard"), (w) => ({ healthMax: w.character.healthMax }));
    check("relic.plateShard +15% max HP: controller.healthMax 100 -> 115", a.healthMax === 100 && b.healthMax === 115, { A: a, B: b });
}
{
    ledger("relic.furnaceCore", [
        codeLine("spells/spellSystem.js", "? dt * this.mods.vortexClock(s.t) : dt);"),
        codeLine("progression/modifiers.js", "return V.hold / (V.hold + extra);"),
    ]);
    const { a, b } = ab((w) => takeRelic(w, "relic.furnaceCore"), (w) => {
        const id = dummy(w, 0, -2, TIER.HEAVY);
        w.spells.cast(5);
        let on = 0, seen = false, t = 0;
        run(w, 9, () => { if (w.spells.vortex.active) { on += DT; seen = true; } });
        return { activeFor: r5(on), seen, vortexDamage: r5(w.dmg.vortex || 0) };
    });
    check("relic.furnaceCore vortex +20% duration: the vortex lives 5.58 s (A 4.65 s) and deals more ring damage",
        near(a.activeFor, 4.65, 0.04) && near(b.activeFor / a.activeFor, 1.2, 0.01) && b.vortexDamage > a.vortexDamage,
        { A: a, B: b, ratio: r5(b.activeFor / a.activeFor) });
}
{
    ledger("relic.wakemender", [codeLine("progression/modifiers.js", "c.health = Math.min(max, c.health + max * MOTE_HEAL_FRAC * (this.moteHeal - 1) * n);")]);
    const { a, b } = ab((w) => takeRelic(w, "relic.wakemender"), (w) => {
        const c = w.character;
        c.health = 50;
        w.motes.spawnAt(c.position.x, c.position.z, 1);
        let k = 0;
        while (w.motes.stats.picked === 0 && k++ < 300) frame(w);
        frame(w);
        return { picked: w.motes.stats.picked, healed: r5(c.health - 50) };
    });
    check("relic.wakemender motes heal +50%: one real mote pickup heals 15 HP (A 10)",
        a.picked === 1 && b.picked === 1 && near(a.healed, 10, 1e-4) && near(b.healed, 15, 1e-4), { A: a, B: b });
}

// ---------------------------------------------------------------- SHOP + DRIFTMARKS
{
    ledger("shop.vitality", [
        codeLine("progression/modifiers.js", "if (r > 0) f[SHOP_RANK_FX[id].key] *= 1 + SHOP_RANK_FX[id].per * r;"),
        codeLine("character/controller.js", "Math.round(this._healthMaxBase * m.maxHp)"),
    ]);
    const w = world();
    w.shop.grant(1000, "qa");
    const g0 = w.shop.glass;
    const r1 = w.shop.buy("shop.vitality");
    const hp1 = w.character.healthMax;
    const r2 = w.shop.buy("shop.vitality");
    const hp2 = w.character.healthMax;
    const r3 = w.shop.buy("shop.wellspring");
    const mp1 = w.character.manaMax;
    check("shop.vitality +4% max HP each / shop.wellspring +4% max mana: HP 100 -> 104 -> 108 for 60 + 90, mana 100 -> 104 for 60",
        r1.ok && r2.ok && r3.ok && hp1 === 104 && hp2 === 108 && mp1 === 104 && w.shop.glass === g0 - 60 - 90 - 60,
        { hp: [100, hp1, hp2], mana: [100, mp1], glass: [g0, w.shop.glass] });
    COVERED.add("shop.wellspring");
}
{
    // Relic Slot 3 bought EARLY (QUEST §4.3: 400, otherwise free after the
    // Sand realm boss), then a third relic worn in it is live.
    const w = world();
    w.shop.grant(500, "qa");
    takeRelic(w, "relic.rimeHeart");
    takeRelic(w, "relic.warmHands");
    const slots0 = w.relics.slotCount;
    const price = w.shop.price("shop.slot3");
    const r = w.shop.buy("shop.slot3");
    bus.emit("reward", { kind: "relic", id: "relic.plateShard", source: "bounty" });
    const again = w.shop.price("shop.slot3");
    check("shop.slot3: 2 slots -> buy for 400 -> 3 slots; the next relic found drops into slot 3 and is live (Plate Shard: max HP 115); not for sale twice",
        slots0 === 2 && price === 400 && r.ok && w.relics.slotCount === 3 && w.shop.glass === 100
        && w.relics.equipped[2] === "relic.plateShard" && w.character.healthMax === 115 && again === null,
        { slots: [slots0, w.relics.slotCount], price, glass: w.shop.glass, equipped: w.relics.equipped,
            hpMax: w.character.healthMax, priceAfter: again });
    dispose(w);
}
{
    ledger("driftmarks", [
        codeLine("progression/modifiers.js", "f.dmgAll *= 1 + DRIFTMARK.dmgPer * dp.dmg;"),
        codeLine("progression/modifiers.js", "f.maxHp *= 1 + DRIFTMARK.hpPer * dp.hp;"),
        codeLine("progression/modifiers.js", "f.surfSpeed *= 1 + Math.min(DRIFTMARK.surfCap, DRIFTMARK.surfPer * dp.surf);"),
    ]);
    const mint = (w, n) => { w.progression.driftmarks = n; w.mods.update(DT); };
    const A = world({ level: 30 }); const ka = kitVolley(A); const hpA = A.character.healthMax; const sa = surf(A, 8);
    const B = world({ level: 30 }); mint(B, 3);
    B.mods.pickDriftmark("dmg"); B.mods.pickDriftmark("hp"); B.mods.pickDriftmark("surf");
    const kb = kitVolley(B); const hpB = B.character.healthMax; const sb = surf(B, 8);
    const C = world({ level: 30 }); mint(C, 40);
    let surfPicks = 0;
    while (C.mods.pickDriftmark("surf")) surfPicks++;
    const capOk = !C.mods.canPickSurf() && C.mods.pickDriftmark("dmg");
    dispose(C);
    check("Driftmarks at L30: Keen Mark x1.005 damage number, Hale Mark +0.5% max HP (387 -> 389), Swift Mark x1.003 surf speed; surf picks stop at the +10% cap (33)",
        near(kb.arc1 / ka.arc1, 1.005, 1e-5) && near(kb.spikes / ka.spikes, 1.005, 1e-5) && hpA === 387 && hpB === 389
        && near(sb.speed / sa.speed, 1.003, 2e-4) && surfPicks === 33 && capOk,
        { dmg: r5(kb.arc1 / ka.arc1), hp: [hpA, hpB], surf: r5(sb.speed / sa.speed), surfPicksBeforeCap: surfPicks });
}

// ---------------------------------------------------------------- coverage
{
    const want = Object.keys(STORY.boons).concat(Object.keys(STORY.relics));
    const fxIds = Object.keys(BOON_FX).concat(Object.keys(RELIC_FX));
    const missing = want.filter((id) => !COVERED.has(id));
    const unmatched = want.filter((id) => fxIds.indexOf(id) < 0);
    check("ledger coverage: all 12 boons + 12 relics of STORY have an effect row AND a measured check",
        want.length === 24 && missing.length === 0 && unmatched.length === 0, { count: want.length, missing, unmatched });
    check("ledger code lines: every 'applied at' needle resolves to a real source line", UNRESOLVED.length === 0, UNRESOLVED);
}

console.log("\n" + RESULTS.filter((r) => r[1]).length + " / " + RESULTS.length + " ledger checks PASS");
process.exit(RESULTS.every((r) => r[1]) ? 0 : 1);
