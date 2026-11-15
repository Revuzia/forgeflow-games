// qa_questmachine_node.mjs -- lane Q (the quest engine) HEADLESS proof.
//
//   node --expose-gc --import ./_harness/node_three_register.mjs ./_harness/qa_questmachine_node.mjs
//
// Why Node: on 2026-09-30 the shared machine runs at 100% CPU with dozens of
// Chrome processes from other lanes; the live page gets ~0.1-1 frames/s. This
// drives the quest engine against the game's REAL modules wherever they run
// without a GPU, in main.js's frame order:
//   REAL  quests/events.js (bus), quests/questSystem.js, quests/questData.js,
//         quests/storyText.js, progression/progression.js (XP, v4 save
//         sections, shrine touch edge, kill drain), character/controller.js
//         (the surf physics the surf distance integrates), combat/damageable.js,
//         combat/enemies.js (the forced pack + the six bosses' bodies and AI),
//         combat/bossEncounters.js (the arena director + the quest gate),
//         world/shrine.js (the seven anchors + stand points), world/portal.js
//         (the gate + 'portal:entered'), combat/roster.js, combat/combatData.js.
//   STUB  the terrain (an analytic heightfield — the real one is a GPU bake),
//         GPU-side objects (scene.add, uniforms), the mesh-enemy renderer, the
//         camera rig (yaw + flat basis), document.getElementById (loading.js
//         reads it at import), and main.js's enterRealm (the same call order
//         minus the GPU work).
// Kills are registry.damage() calls — the real damage -> kill-event -> drain
// path; the player is made invulnerable (progression.graceUntil) so the real
// enemy AI cannot end the run. Shrine touches and arena approaches are
// teleports onto the real stand points. Exit code 0 only if every check
// passes.
globalThis.document = globalThis.document || { getElementById: () => null };

const THREE = await import("three");
const { registerShaders } = await import("../src/shaders/registry.js");
registerShaders();
const { bus } = await import("../src/quests/events.js");
const { STORY } = await import("../src/quests/storyText.js");
const QD = await import("../src/quests/questData.js");
const { QuestSystem } = await import("../src/quests/questSystem.js");
const { input } = await import("../src/core/input.js");
const { CharacterController } = await import("../src/character/controller.js");
const { DamageableRegistry } = await import("../src/combat/damageable.js");
const combatData = await import("../src/combat/combatData.js");
const { Enemies } = await import("../src/combat/enemies.js");
const PR = await import("../src/progression/progression.js");
const { Progression, SAVE_KEY, xpToNext } = PR;
const { SpawnShrine } = await import("../src/world/shrine.js");
const { BossEncounters } = await import("../src/combat/bossEncounters.js");
const { RealmPortal } = await import("../src/world/portal.js");
const { ROSTER } = await import("../src/combat/roster.js");

const RESULTS = [];
function check(name, ok, detail) {
    RESULTS.push([name, !!ok]);
    console.log((ok ? "PASS " : "FAIL ") + name + "  " + JSON.stringify(detail === undefined ? "" : detail));
}
const warns = [];
const realWarn = console.warn;
console.warn = (...a) => { warns.push(a.join(" ")); realWarn(...a); };

// ------------------------------------------------ determinism trap
// NO Math.random on the quest/boss/progression/portal frame paths. The enemy
// runtime (combat/enemies.js — not a lane Q file) DOES call Math.random on
// spawn (yaw, orbit radius, strafe side/timer: enemies.js:846/859-861, grep
// 2026-09-30) and in its AI, so a call whose stack runs through
// combat/enemies.js is exempted here and reported as an out-of-scope finding;
// any other call made while the trap is armed is a violation. (Removing the
// exemption fails F1 at enemies.js:846 via QuestSystem._spawnPack.)
const realRandom = Math.random;
let trapOn = false;
const badRandom = [];
Math.random = function () {
    if (trapOn) {
        const st = new Error().stack || "";
        if (!/combat[\\/]enemies\.js/.test(st)) badRandom.push(st.split("\n").slice(2, 5).join(" | "));
    }
    return realRandom();
};

// ------------------------------------------------------------- terrain stub
// Gentle analytic relief per realm (tens of metres over hundreds).
const LAND = {
    cold: { a: 9, fx: 190, fz: 230, b: 4, fb: 70, ph: 0.3 },
    sand: { a: 12, fx: 150, fz: 175, b: 5, fb: 58, ph: 1.7 },
    ash: { a: 10, fx: 210, fz: 160, b: 5, fb: 64, ph: 2.9 },
};
const terrain = {
    realm: "cold",
    playRadius: 620,
    heightAt(x, z) {
        const L = LAND[this.realm];
        return L.a * Math.sin(x / L.fx + L.ph) * Math.cos(z / L.fz - 0.7)
            + L.b * Math.sin((x * 0.8 + z * 0.6) / L.fb + L.ph);
    },
    normalAt(x, z, out) {
        const e = 1;
        const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
        const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
        out.set(-hx / (2 * e), 1, -hz / (2 * e));
        return out.normalize();
    },
    edge01(x, z) { return Math.max(0, Math.min(1, (Math.hypot(x, z) - 540) / 80)); },
    clampToPlayArea(v) {
        const d = Math.hypot(v.x, v.z);
        if (d > 620) { v.x *= 620 / d; v.z *= 620 / d; }
    },
};

// ----------------------------------------------------------- GPU-side stubs
const scene = { add() {}, remove() {} };
const box = (v) => ({ value: v });
const uniforms = {
    sssStrength: box(1), sssRadius: box(1), glintIntensity: box(0.55), glintGrazing: box(1),
    uCameraPos: box(new THREE.Vector3()), uViewProj: box(new THREE.Matrix4()), uTime: box(0),
    uSunDir: box(new THREE.Vector3(0, 1, 0)), uSunColor: box(new THREE.Vector3(1, 1, 1)),
    uResolution: box(new THREE.Vector2(1, 1)),
};
const shadows = { registerCaster() {}, makeCasterMaterial() { return { dispose() {} }; } };
const crystals = { scene, shadows, material: { uniforms } };
const rig = {
    yaw: 0,
    getFlatForward(out) { return out.set(Math.sin(this.yaw), 0, -Math.cos(this.yaw)); },
    getFlatRight(out) { return out.set(Math.cos(this.yaw), 0, Math.sin(this.yaw)); },
    addTrauma() {},
    camera: { matrixWorld: new THREE.Matrix4() },
};
const vis = {
    _slotInst: [],
    spawnUnit(i) { this._slotInst[i] = { tint: new Float32Array([1, 1, 1, 0]), state: new Float32Array(4) }; },
    spawn(i) { this.spawnUnit(i); },
    free(i) { this._slotInst[i] = null; },
    drive() {}, driveBolt() {}, driveClip() {}, update() {},
};

// ------------------------------------------------------------ input pinning
function pin(name, val) {
    Object.defineProperty(input, name, { configurable: true, enumerable: true, get: () => val, set: () => {} });
}
function unpin(name, val) {
    Object.defineProperty(input, name, { configurable: true, enumerable: true, writable: true, value: val });
}

// ------------------------------------------------------------------ world
const EVENTS = ["quest:step", "quest:complete", "quest:waypoint", "dialogue", "hint",
    "hint:clear", "ending:begin", "shrine:activated", "enemy:killed", "boss:killed",
    "portal:entered", "player:levelup", "player:died"];

function buildWorld(opts) {
    const o = opts || {};
    terrain.realm = "cold";
    const registry = new DamageableRegistry();
    const character = new CharacterController(terrain);
    character.position.set(0, terrain.heightAt(0, 0), 0);   // main.js's spawn
    const shrine = new SpawnShrine(terrain, crystals, 5.0, 5.5);   // main.js:513
    const enemies = new Enemies(scene, terrain, registry, character, combatData, null);
    enemies.attachVis(vis);
    const progression = new Progression(character, registry, null);
    shrine.register(progression);
    enemies.progression = progression;
    const portal = new RealmPortal(terrain, crystals);
    const bosses = new BossEncounters(enemies, registry, character, combatData, terrain, null);
    bosses.progression = progression;
    bosses.shrine = shrine;
    bosses.portal = portal;
    const w = { registry, character, shrine, enemies, progression, portal, bosses, t: 0,
        realm: "cold", log: [], offs: [], xpGrants: [] };
    bosses.enterRealm = (token) => enterRealm(w, token);
    if (o.test) progression.setTestMode(true);
    for (const ev of EVENTS) {
        w.offs.push(bus.on(ev, (p) => w.log.push({ t: +w.t.toFixed(3), ev,
            p: p == null ? null : JSON.parse(JSON.stringify(p)) })));
    }
    // XP spy: every grant with the requirement standing at the moment it was
    // made (the quest's 15%/25% is of THAT number).
    const addXP = progression.addXP.bind(progression);
    progression.addXP = (n, why) => {
        w.xpGrants.push({ t: +w.t.toFixed(3), n, why, needBefore: progression.xpNeed,
            levelBefore: progression.level });
        return addXP(n, why);
    };
    const ctx = {
        scene, terrain, character, rig, registry, enemies, bosses, portal, shrine,
        progression, bus, input, crystals,
        getRealm: () => w.realm,
    };
    w.ctx = ctx;
    w.quest = new QuestSystem(ctx);
    return w;
}

function disposeWorld(w) {
    for (const o of w.offs) o();
    w.quest.dispose();
    if (w.progression._unsubRealm) w.progression._unsubRealm();
    w.enemies.clear();
}

/** main.js enterRealm, minus the GPU: the sync prefix, then (after an await,
 *  like the body fetch) the realm is applied and the token published. */
async function enterRealm(w, token) {
    w.bosses.setRealm(token);
    w.enemies.clear();
    await Promise.resolve();
    terrain.realm = token;
    w.shrine.setRealm(token);
    w.realm = token;
    return token;
}

const DT = 1 / 60;
/** One frame in main.js's order (character -> combat -> directors -> portal
 *  -> progression -> quest -> endFrame). */
function frame(w) {
    w.character.update(DT, rig);
    terrain.clampToPlayArea(w.character.position);
    w.registry.update(DT);
    w.shrine.update(DT);
    w.enemies.update(DT);
    trapOn = true;
    w.bosses.update(DT);
    w.portal.update(DT, w.character.position.x, w.character.position.z);
    w.progression.update(DT);
    w.quest.update(DT);
    trapOn = false;
    w.registry.endFrame();
    w.t += DT;
}
async function steps(w, n, each) {
    for (let i = 0; i < n; i++) {
        frame(w);
        if (each) each();
        if ((i & 15) === 15) await Promise.resolve();   // let enterRealm's awaits land
    }
}
async function until(w, pred, maxS, each) {
    const n = Math.ceil(maxS / DT);
    for (let i = 0; i < n; i++) {
        frame(w);
        if (each) each();
        await Promise.resolve();
        if (pred()) return true;
    }
    return false;
}
function tp(w, x, z) {
    const c = w.character;
    c.position.set(x, terrain.heightAt(x, z), z);
    c.velocity.set(0, 0, 0);
}
const since = (w, i0, ev) => w.log.slice(i0).filter((e) => !ev || e.ev === ev);
const evStr = (e) => e.ev + " " + JSON.stringify(e.p);

/** Light a ring shrine the waypoint names: teleport onto its stand point. */
async function followWaypointToShrine(w) {
    await steps(w, 20);                                    // >= one 0.25 s refresh
    const wp = w.quest.waypoint;
    const P = w.progression, c = w.character;
    // Independent nearest-dormant (the waypoint must BE it).
    let want = null, bd = Infinity;
    for (let i = 1; i < w.shrine.positions.length; i++) {
        const p = w.shrine.positions[i];
        if (P.isShrineLit(w.realm, p.id)) continue;
        const d = (p.x - c.position.x) ** 2 + (p.z - c.position.z) ** 2;
        if (d < bd) { bd = d; want = p; }
    }
    const target = w.shrine.positions.find((p) => wp && Math.abs(p.x - wp.x) < 1e-6 && Math.abs(p.z - wp.z) < 1e-6);
    tp(w, target ? target.sx : want.sx, target ? target.sz : want.sz);
    await steps(w, 10);
    return { wpKind: wp && wp.kind, wpLabel: wp && wp.label, target: target && target.id,
        nearestDormant: want && want.id, same: !!(target && want && target.id === want.id) };
}

/** Arm-wait, approach and kill this realm's `kind` boss through the director. */
async function breakBoss(w, kind) {
    const B = w.bosses;
    const armed = await until(w, () => B.state === "pending" && B.kind === kind, 20);
    // The quest re-evaluates its waypoint 4x a second: give it one period.
    await until(w, () => w.quest.waypoint && w.quest.waypoint.kind === "boss", 0.5);
    const wpAtPending = w.quest.waypoint;
    const ax = B.ax, az = B.az;
    const c = w.character;
    const vx = c.position.x - ax, vz = c.position.z - az;
    const L = Math.hypot(vx, vz) || 1;
    tp(w, ax + vx / L * 30, az + vz / L * 30);
    const live = await until(w, () => B.state === "live" && B.bossId > 0, 10);
    const row = B.row;
    const name = row ? row.bossName : null;
    let hits = 0;
    for (let k = 0; k < 20 && B.state === "live"; k++) {
        const s = w.registry.slot(B.bossId);
        if (s >= 0 && w.registry.hp[s] > 0) { w.registry.damage(B.bossId, w.registry.hp[s] + 1, { tag: "probe" }); hits++; }
        await steps(w, 30);
    }
    return { armed, live, name, hits, arena: { x: +ax.toFixed(1), z: +az.toFixed(1) },
        wpAtPending: wpAtPending && { kind: wpAtPending.kind, label: wpAtPending.label,
            atArena: Math.abs(wpAtPending.x - ax) < 1e-6 && Math.abs(wpAtPending.z - az) < 1e-6 } };
}

/** Walk into the open portal (armed from outside first). */
async function throughPortal(w) {
    const g = w.portal;
    tp(w, g.x + 8, g.z);
    await steps(w, 6);
    const armed = g.stats.armed;
    tp(w, g.x, g.z);
    await steps(w, 3);
    await Promise.resolve(); await Promise.resolve();
    await steps(w, 30);
    return armed;
}

// =================================================================== A
// Static facts: the 20 steps, titles = storyText, boss titles = live roster.
{
    const ids = [];
    for (const r of QD.REALM_ORDER) for (const s of QD.MAIN[r]) ids.push(s.id);
    const mismatch = ids.filter((id) => !STORY.steps[id] || STORY.steps[id].title !== QD.STEP_BY_ID[id].title
        || STORY.steps[id].tracker !== QD.STEP_BY_ID[id].tracker);
    check("A1 20 steps (cold 8 / sand 6 / ash 6), questData == storyText titles+trackers",
        ids.length === 20 && QD.MAIN.cold.length === 8 && QD.MAIN.sand.length === 6
        && QD.MAIN.ash.length === 6 && mismatch.length === 0 && QD.MAIN_TOTAL === 20, { ids: ids.length, mismatch });
    // The live roster, read exactly the way bossEncounters' BOSS_BY_REALM does.
    const live = { cold: {}, sand: {}, ash: {} };
    for (const slug in ROSTER) {
        const r = ROSTER[slug];
        if (!r.bossKind || r.bossKind === "none") continue;
        const kind = r.bossKind === "realm_boss" ? "realm" : "mini";
        if (live[r.realm] && !live[r.realm][kind]) {
            const n = r.bossName; const cut = n.indexOf(" (");
            live[r.realm][kind] = (cut > 0 ? n.slice(0, cut) : n).trim();
        }
    }
    const bossSteps = [];
    for (const r of QD.REALM_ORDER) for (const s of QD.MAIN[r]) {
        if (s.rule.type !== QD.RULE.BOSS) continue;
        const nm = live[r][s.rule.kind];
        const core = nm.replace(/^The /, "");
        bossSteps.push({ id: s.id, kind: s.rule.kind, live: nm, title: s.title, names: s.title.includes(core) });
    }
    check("A2 every boss step's title names the LIVE boss of its realm+kind",
        bossSteps.length === 6 && bossSteps.every((b) => b.names), bossSteps);
    const txt = JSON.stringify(STORY);
    check("A3 no 'Moraine' anywhere in storyText; no questData drift warnings at construction",
        !/Moraine/.test(txt) && !Object.values(QD.STEP_BY_ID).some((s) => /Moraine/.test(s.title)),
        { moraineInStory: /Moraine/.test(txt) });
    check("A4 boss steps pay the Warden 25%, the other 14 pay 15%",
        ids.every((id) => QD.STEP_BY_ID[id].xpFrac === (QD.STEP_BY_ID[id].rule.type === QD.RULE.BOSS ? 0.25 : 0.15)),
        ids.map((id) => id + ":" + QD.STEP_BY_ID[id].xpFrac).join(" "));
}

// =================================================================== B
// A fresh run through all 20 steps (?test mode: level floors lifted, the quest
// gate is not), in main.js's frame order.
localStorage.clear();
let w = buildWorld({ test: true });
const P = w.progression, Q = w.quest, B = w.bosses;
check("B0 no questData/storyText drift warnings", !warns.some((s) => s.includes("[quests]")), warns);
P.newGame();                       // PLAY
P.graceUntil = 1e9;
const tPlay = w.t;
await steps(w, 2);
{
    const wp = Q.waypoint, sp = w.shrine.positions[0];
    check("B1 fresh save -> tracker cold.1 'The Last Wakecaster', waypoint on the spawn shrine ~8 m away",
        Q.tracked && Q.tracked.stepId === "cold.1" && Q.tracked.title === "The Last Wakecaster"
        && wp && wp.kind === "shrine" && wp.x === sp.x && wp.z === sp.z && wp.label === "The First Stone",
        { tracked: Q.tracked, waypoint: wp, playerToShrineM: +Math.hypot(sp.x, sp.z).toFixed(2) });
    check("B2 quest gate installed; cold mini/realm gates closed at cold.1",
        typeof B.questGate === "function" && !Q.bossUnlocked("cold", "mini") && !Q.bossUnlocked("cold", "realm")
        && B.state === "idle", { state: B.state });
}

// ---- dt === 0 is a strict no-op (a paused frame): touch while frozen.
{
    const sp = w.shrine.positions[0];
    tp(w, sp.sx, sp.sz);
    const i0 = w.log.length;
    P.update(0);                   // the touch edge fires even at dt 0 (fast travel under a modal)
    Q.update(0);
    const frozen = { main: Q.main.cold, completes: since(w, i0, "quest:complete").length,
        activated: since(w, i0, "shrine:activated").length };
    await steps(w, 1);
    const ev = since(w, i0).map(evStr);
    const dl = since(w, i0, "dialogue").map((e) => e.p.id);
    check("B3 dt===0 frame: shrine touched but NO step advance; next real frame completes cold.1",
        frozen.main === 0 && frozen.completes === 0 && frozen.activated === 1 && Q.main.cold === 1,
        { frozen, after: Q.main.cold });
    const act = since(w, i0, "shrine:activated")[0];
    const comp = since(w, i0, "quest:complete")[0];
    check("B4 touch spawn shrine -> shrine:activated{first} + shrine line + Echo 2 lines + cold.2 + surf hint",
        act && act.p.first === true && act.p.id === "cold_spawn" && act.p.realm === "cold"
        && dl[0] === "shrine.cold.cold_spawn" && dl[1] === "echo.cold.1"
        && since(w, i0, "dialogue")[1].p.lines.length === 2
        && comp && comp.p.stepId === "cold.1" && Q.tracked.stepId === "cold.2"
        && since(w, i0, "hint").some((e) => e.p.id === "hint.surf"), ev);
}

// ---- surf 150 m with the REAL controller (RMB held, forward).
{
    const i0 = w.log.length;
    const c = w.character;
    rig.yaw = Math.PI * 0.5;            // ride east, away from the stone
    c.facing = rig.yaw;
    pin("surf", true);
    pin("moveZ", 1);
    let clearAt = null;
    const done = await until(w, () => Q.main.cold >= 2, 90, () => {
        if (clearAt === null && since(w, i0, "hint:clear").some((e) => e.p.id === "hint.surf")) clearAt = +Q.surfM.toFixed(2);
    });
    const surfAtDone = Q.surfM;
    const vel = { x: c.velocity.x, z: c.velocity.z, speed: c.speed };
    const pos = { x: c.position.x, z: c.position.z };
    // the forced pack stands up on the first cold.3 frame
    await steps(w, 2);
    const progress = since(w, i0, "quest:step").filter((e) => e.p.reason === "progress").map((e) => e.p.progress.have);
    check("B5 surf 150 m (RMB held, grounded) -> cold.3; progress announced on 10 m crossings only",
        done && surfAtDone >= 150 && surfAtDone < 152 && Q.tracked.stepId === "cold.3"
        && progress.length >= 14 && progress.length <= 16 && progress.every((v, k) => k === 0 || v >= progress[k - 1]),
        { surfAtDone: +surfAtDone.toFixed(2), gameS: +(w.t - tPlay).toFixed(2), progressEmits: progress });
    check("B6 'Hold RMB to surf' cleared at >= 20 m (and before 150)", clearAt !== null && clearAt >= 20 && clearAt < 25,
        { clearedAtSurfM: clearAt });
    // Pack: 5 rimeImp, 40 m ahead along the travel direction at spawn time.
    const keys = Array.from(Q._forced).map((id) => {
        for (let i = 0; i < w.enemies.id.length; i++) {
            if (w.enemies.id[i] === id && w.enemies.alive[i]) return w.enemies.units[w.enemies.unitOf[i]].key;
        }
        return null;
    });
    const dx = Q.packX - pos.x, dz = Q.packZ - pos.z, d = Math.hypot(dx, dz);
    const sp = Math.hypot(vel.x, vel.z) || 1;
    const along = (dx * vel.x + dz * vel.z) / (d * sp);
    check("B7 cold.3 forces a 5-imp pack ~40 m AHEAD (enemies.spawn), hints LMB + 1 shown",
        Q.packSpawns === 1 && keys.every((k) => k === "rimeImp") && keys.length === 5
        && d > 36 && d < 46 && along > 0.97
        && since(w, i0, "hint").some((e) => e.p.id === "hint.bolt") && since(w, i0, "hint").some((e) => e.p.id === "hint.arc"),
        { keys, centreDistM: +d.toFixed(1), cosToTravel: +along.toFixed(3), hints: since(w, i0, "hint").map((e) => e.p.text) });
    unpin("surf", false);
    unpin("moveZ", 0);
    // Airborne frames do not count (grounded only): the integrator's own gate.
    const s0 = Q.surfM;
    c.surfActive = true; c.airborne = true; c.speed = 12;
    Q._tickSurf(0.5);
    const air = Q.surfM - s0;
    c.airborne = false;
    Q._tickSurf(0.5);
    const ground = Q.surfM - s0;
    c.surfActive = false;
    check("B8 surf integrates speed*dt only while surfing AND grounded", air === 0 && Math.abs(ground - 6) < 1e-9,
        { airborneAdd: air, groundedAdd: ground });
}

// ---- kill 5: approach the pack, one kill per 1.5 s of game time.
let firstDing = null;
{
    const i0 = w.log.length;
    const c = w.character, reg = w.registry;
    const near = () => {
        let best = 1e9;
        for (const id of Q._forced) {
            const s = reg.slot(id);
            if (s >= 0 && reg.hp[s] > 0) best = Math.min(best, Math.hypot(reg.x[s] - c.position.x, reg.z[s] - c.position.z));
        }
        return best;
    };
    pin("moveZ", 1);
    const approached = await until(w, () => near() < 15, 20, () => {
        rig.yaw = Math.atan2(Q.packX - c.position.x, -(Q.packZ - c.position.z));
    });
    unpin("moveZ", 0);
    const wpPack = Q.waypoint;
    const xp0 = P.xp;
    const killed = [];
    for (const id of Array.from(Q._forced)) {
        const s = reg.slot(id);
        if (s < 0 || reg.hp[s] <= 0) continue;
        reg.damage(id, reg.hp[s] + 1, { tag: "probe" });
        killed.push(id);
        await steps(w, 90);            // 1.5 s per kill
    }
    const lv = since(w, 0, "player:levelup");
    firstDing = lv.length ? +(lv[0].t - tPlay).toFixed(2) : null;
    const kills = since(w, i0, "enemy:killed");
    const grants = w.xpGrants.filter((g) => g.t >= since(w, i0)[0].t);
    const comp = since(w, i0, "quest:complete").find((e) => e.p.stepId === "cold.3");
    check("B9 waypoint on a live pack during cold.3", wpPack && wpPack.kind === "pack", wpPack);
    check("B10 5 kills -> 5 enemy:killed{key rimeImp} -> cold.4; hints LMB/1 cleared",
        approached && kills.length === 5 && kills.every((e) => e.p.key === "rimeImp" && e.p.realm === "cold")
        && Q.main.cold === 3 && Q.tracked.stepId === "cold.4"
        && since(w, i0, "hint:clear").some((e) => e.p.id === "hint.bolt") && since(w, i0, "hint:clear").some((e) => e.p.id === "hint.arc"),
        { kills: kills.map((e) => e.p.key), main: Q.main.cold });
    check("B11 first-blood 20 XP once + imps 3 XP each; FIRST DING at the 5th kill; cold.3 pays 15% of L2 (48)",
        grants.filter((g) => g.why === "first-blood").length === 1 && grants.find((g) => g.why === "first-blood").n === 20
        && grants.filter((g) => g.why === "kill").every((g) => g.n === 3)
        && lv.length >= 1 && lv[0].p.level === 2 && comp && comp.p.xp === 48,
        { grants: grants.map((g) => g.why + ":" + g.n), dings: lv.map((e) => e.p.level), cold3xp: comp && comp.p.xp });
    check("B12 PLAY -> first ding < 60 s of GAME time (real surf physics, 1 kill / 1.5 s)",
        firstDing !== null && firstDing < 60, { firstDingGameS: firstDing });
    check("B13 cold.4 shows the one-time J/M/E hint (ttl) and points at the nearest dormant shrine",
        since(w, i0, "hint").some((e) => e.p.id === "hint.journal" && e.p.ttl > 0)
        && Q.hintsSeen["hint.journal"] === true, since(w, i0, "hint").map((e) => e.p));
}

// ---- NOT armed before Kindle the Ring (level floor lifted by ?test).
{
    const samples = [];
    for (let k = 0; k < 24; k++) {
        await steps(w, 30);
        samples.push({ state: B.state, eligible: B._eligibleKind(), gate: Q.bossUnlocked("cold", "mini") });
    }
    check("B14 mini boss NOT armed while cold.4 is open (12 s of game time, test floor lifted)",
        samples.every((s) => s.state === "idle" && s.eligible === null && s.gate === false)
        && B.meetsFloor("mini"), { samples: samples.length, meetsFloor: B.meetsFloor("mini"), first: samples[0] });
}

// ---- waypoints re-emit on CHANGE only.
{
    const i0 = w.log.length;
    await steps(w, 600);
    check("B15 10 s standing still: zero quest:waypoint / quest:step re-emits",
        since(w, i0, "quest:waypoint").length === 0 && since(w, i0, "quest:step").length === 0,
        { waypointEmits: since(w, i0, "quest:waypoint").length });
}

// ---- allocation: the steady frame of the quest engine alone. Measured on
// V8's NEW space (where JS objects are born; JIT code lands elsewhere), after
// a full GC, per 50k-frame window.
//
// WARM-UP IS PART OF THE INSTRUMENT, NOT A LOOPHOLE. Unoptimized V8 code
// (Ignition / Sparkplug) boxes every non-Smi double result as a HeapNumber,
// so ANY float arithmetic allocates until the optimizing tier compiles the
// function. _refreshWaypoint/_wpDormant run at 4 Hz (every 15th frame), so
// they cross V8's hotness budget only after ~100k frames (heap-sampling
// profile 2026-09-30: all pre-tier-up residue sat in those two; --trace-opt
// showed TurboFan compiling them exactly when it vanished). A fixed 20k-frame
// warm-up therefore measured V8's warm-up, not the engine. The probe now runs
// windows until one reaches the INSTRUMENT FLOOR (an empty 50k loop measured
// the same way — getHeapSpaceStatistics' own allocation), then requires the
// next THREE windows to stay at that floor (+1 KB) — a real per-frame
// allocation of even one 16-byte object would add 800 KB per window. The
// pre-tier-up windows are reported, not hidden. A control loop allocating one
// small object per frame proves the instrument sees allocations.
if (typeof globalThis.gc === "function") {
    const v8 = await import("node:v8");
    const newSpace = () => v8.getHeapSpaceStatistics().find((s) => s.space_name === "new_space").space_used_size;
    const q = w.quest;
    // One window = gc, then FRAMES calls of `fn` in 10 slices with a sample
    // after each. A sample below its predecessor means a scavenge ran inside
    // the window (it would hide allocations), so such a window is INVALID —
    // it can never count as "at the floor".
    const FRAMES = 50000, SLICE = FRAMES / 10;
    let scavenged = 0;
    const win = (fn) => {
        globalThis.gc();
        const h0 = newSpace();
        let prev = h0;
        for (let s = 0; s < 10; s++) {
            for (let k = 0; k < SLICE; k++) fn(k);
            const h = newSpace();
            if (h < prev) { scavenged++; return Infinity; }
            prev = h;
        }
        return prev - h0;
    };
    const nop = () => {};
    const tick = () => q.update(DT);
    win(nop); win(nop);                       // warm the instrument itself
    const floor = Math.max(win(nop), win(nop));
    const EPS = 1024;
    const warm = [];
    let reached = -1;
    for (let rep = 0; rep < 20 && reached < 0; rep++) {
        const b = win(tick);
        warm.push(b);
        if (b <= floor + EPS) reached = rep;
    }
    const steady = [win(tick), win(tick), win(tick)];
    const ring = new Array(64);
    const control = win((k) => { ring[k & 63] = { a: k, b: k + 1 }; });
    check("B16 steady quest.update frames allocate nothing once V8 has optimized them (3 x 50k-frame windows at the empty-loop floor; control 1 obj/frame)",
        Number.isFinite(floor) && reached >= 0 && steady.every((b) => b <= floor + EPS)
        && Number.isFinite(control) && control > 400 * 1024,
        { instrumentFloor: floor, preTierUpWindows: warm, warmFramesToFloor: reached >= 0 ? (reached + 1) * FRAMES : null,
            steadyWindows: steady, steadyBytesPerFrame: +((Math.max(...steady) - floor) / FRAMES).toFixed(4),
            control, scavengedWindows: scavenged });
} else {
    check("B16 allocation check NOT RUN (start node with --expose-gc)", false, "no gc()");
}

// ---- Kindle the Ring: 3 shrines, following the waypoint -> cold.5 + mini ARMED.
const perRealm = {};
async function kindleAndBreak(realm) {
    const Q = w.quest, B = w.bosses;          // the CURRENT world's (a reload replaces them)
    const out = {};
    const visits = [];
    for (let k = 0; k < 3; k++) visits.push(await followWaypointToShrine(w));
    out.visits1 = visits;
    await steps(w, 5);
    out.after3 = { main: Q.main[realm], tracked: Q.tracked.stepId, gateMini: Q.bossUnlocked(realm, "mini") };
    out.mini = await breakBoss(w, "mini");
    await steps(w, 10);
    out.afterMini = { main: Q.main[realm], tracked: Q.tracked.stepId };
    // realm boss must NOT arm while 'Wake the Anchors' is open
    const samp = [];
    for (let k = 0; k < 12; k++) { await steps(w, 30); samp.push(B.state === "idle" && B._eligibleKind() === null); }
    out.realmNotArmedBefore = samp.every(Boolean);
    const v2 = [];
    for (let k = 0; k < 3; k++) v2.push(await followWaypointToShrine(w));
    out.visits2 = v2;
    await steps(w, 5);
    out.after6 = { main: Q.main[realm], tracked: Q.tracked.stepId, gateRealm: Q.bossUnlocked(realm, "realm") };
    out.realm = await breakBoss(w, "realm");
    await steps(w, 20);
    out.afterRealm = { main: Q.main[realm], tracked: Q.tracked.stepId,
        portal: { open: w.portal.isOpen, token: w.portal.token, from: w.portal.from },
        waypoint: Q.waypoint && { kind: Q.waypoint.kind, atPortal: Q.waypoint.x === w.portal.x && Q.waypoint.z === w.portal.z } };
    perRealm[realm] = out;
    return out;
}

{
    const i0 = w.log.length;
    const r = await kindleAndBreak("cold");
    const ev = since(w, i0);
    check("B17 Kindle the Ring: each waypoint = the nearest dormant ring shrine",
        r.visits1.every((v) => v.same && v.wpKind === "shrine") && r.visits2.every((v) => v.same), r.visits1.concat(r.visits2));
    check("B18 3 ring shrines -> cold.5 AND the mini boss arms (gate open), waypoint on its arena labelled 'The Icewall'",
        r.after3.main === 4 && r.after3.tracked === "cold.5" && r.after3.gateMini && r.mini.armed
        && r.mini.wpAtPending && r.mini.wpAtPending.kind === "boss" && r.mini.wpAtPending.atArena
        && r.mini.wpAtPending.label === "The Icewall", { after3: r.after3, mini: r.mini });
    const bk = ev.filter((e) => e.ev === "boss:killed").map((e) => e.p);
    check("B19 kill it -> boss:killed{cold, mini, 'The Icewall', first} -> cold.6",
        bk[0] && bk[0].kind === "mini" && bk[0].name === "The Icewall" && bk[0].first === true
        && r.afterMini.main === 5 && r.afterMini.tracked === "cold.6", { boss: bk[0], after: r.afterMini });
    check("B20 realm boss NOT armed while cold.6 open; all 6 -> cold.7 + armed; 'Shrinebreaker' dies -> cold.8, gate cold->sand, waypoint = portal",
        r.realmNotArmedBefore && r.after6.main === 6 && r.after6.tracked === "cold.7" && r.after6.gateRealm
        && r.realm.armed && r.realm.wpAtPending && r.realm.wpAtPending.label === "Shrinebreaker"
        && bk[1] && bk[1].kind === "realm" && bk[1].name === "Shrinebreaker" && bk[1].first === true
        && r.afterRealm.main === 7 && r.afterRealm.tracked === "cold.8"
        && r.afterRealm.portal.open && r.afterRealm.portal.token === "sand" && r.afterRealm.portal.from === "cold"
        && r.afterRealm.waypoint && r.afterRealm.waypoint.kind === "portal" && r.afterRealm.waypoint.atPortal,
        { after6: r.after6, realm: r.realm, bosses: bk, afterRealm: r.afterRealm });
}

// ---- save now (mid-run, cold.8), reload, and the step survives.
{
    P.save();
    const blob = JSON.parse(localStorage.getItem(SAVE_KEY));
    const w2 = (() => { disposeWorld(w); return buildWorld({ test: true }); })();
    const reg = { tracked: w2.quest.tracked && w2.quest.tracked.stepId, main: Object.assign({}, w2.quest.main) };
    w2.progression.continueRun();
    await steps(w2, 5);
    const cont = { tracked: w2.quest.tracked && w2.quest.tracked.stepId, main: Object.assign({}, w2.quest.main),
        surfM: w2.quest.surfM, kills: w2.quest.killsForOnboarding, hintsSeen: w2.quest.hintsSeen,
        lit: w2.progression.litShrines("cold").length, killed: Object.keys(w2.progression.bossesKilled) };
    check("B21 SAVE -> reload -> register AND CONTINUE restore cold.8 (surf, kills, hints, 7 lit, bosses)",
        blob.schemaVer === 4 && blob.quest.main.cold === 7 && reg.tracked === "cold.8" && cont.tracked === "cold.8"
        && cont.main.cold === 7 && cont.surfM >= 150 && cont.kills === 5 && cont.lit === 7
        && cont.hintsSeen["hint.surf"] && cont.hintsSeen["hint.journal"]
        && cont.killed.includes("cold:mini") && cont.killed.includes("cold:realm"),
        { blobQuest: blob.quest, atRegister: reg, afterContinue: cont });
    w = w2;
    // The boss director is a live object: its gate record rides progression.
    w.bosses.setRealm("cold");
    await steps(w, 5);
}

// ---- through the portal into Sand, and the Sand + Ash chains.
{
    const Q2 = w.quest, P2 = w.progression;
    w.progression.graceUntil = 1e9;
    const i0 = w.log.length;
    const armed = await throughPortal(w);
    await until(w, () => w.realm === "sand" && Q2.realm === "sand", 5);
    await steps(w, 30);
    const pe = since(w, i0, "portal:entered").map((e) => e.p);
    check("B22 walk into the gate -> portal:entered{cold->sand} -> cold.8 done -> tracker sand.1 at the Sand spawn shrine",
        armed && pe.length === 1 && pe[0].from === "cold" && pe[0].to === "sand"
        && Q2.main.cold === 8 && Q2.tracked.stepId === "sand.1" && P2.realm === "sand"
        && Q2.waypoint && Q2.waypoint.kind === "shrine" && Q2.waypoint.realm === "sand" && Q2.waypoint.label === "Gatefoot Stone",
        { pe, main: Q2.main, tracked: Q2.tracked && Q2.tracked.stepId, waypoint: Q2.waypoint });
    // sand.1
    const sp = w.shrine.positions[0];
    const i1 = w.log.length;
    tp(w, sp.sx, sp.sz);
    await steps(w, 10);
    const act = since(w, i1, "shrine:activated").map((e) => e.p);
    check("B23 touch the Sand spawn shrine -> shrine:activated{sand, first} -> sand.2",
        act.length === 1 && act[0].realm === "sand" && act[0].first === true && Q2.main.sand === 1
        && Q2.tracked.stepId === "sand.2", { act, main: Q2.main });
    const i2 = w.log.length;
    const r = await kindleAndBreak("sand");
    const bk = since(w, i2, "boss:killed").map((e) => e.p);
    check("B24 Sand: 3 -> sand.3 (Gatekeeper of Brass armed+killed) -> 6 -> sand.5 (Warden of the Sundered Gate) -> sand.6, gate sand->ash",
        r.after3.main === 2 && r.mini.wpAtPending && r.mini.wpAtPending.label === "Gatekeeper of Brass"
        && r.afterMini.main === 3 && r.realmNotArmedBefore && r.after6.main === 4
        && r.realm.wpAtPending && r.realm.wpAtPending.label === "Warden of the Sundered Gate"
        && bk.map((b) => b.name).join("|") === "Gatekeeper of Brass|Warden of the Sundered Gate"
        && r.afterRealm.main === 5 && r.afterRealm.tracked === "sand.6" && r.afterRealm.portal.token === "ash",
        { r, bosses: bk });
    const i3 = w.log.length;
    await throughPortal(w);
    await until(w, () => w.realm === "ash" && Q2.realm === "ash", 5);
    await steps(w, 30);
    tp(w, w.shrine.positions[0].sx, w.shrine.positions[0].sz);
    await steps(w, 10);
    check("B25 portal sand->ash -> sand.6 done; ash.1 by touching the Ash spawn shrine",
        Q2.main.sand === 6 && Q2.main.ash === 1 && Q2.tracked.stepId === "ash.2"
        && since(w, i3, "portal:entered").some((e) => e.p.from === "sand" && e.p.to === "ash"), { main: Q2.main });
    const i4 = w.log.length;
    const ra = await kindleAndBreak("ash");
    const bka = since(w, i4, "boss:killed").map((e) => e.p);
    check("B26 Ash: Furnace Guardian -> ash.4 -> Volcanic Plate Knight -> ash.6, gate ash->cold (the ring closure)",
        ra.mini.wpAtPending && ra.mini.wpAtPending.label === "Furnace Guardian"
        && ra.realm.wpAtPending && ra.realm.wpAtPending.label === "Volcanic Plate Knight"
        && bka.map((b) => b.name).join("|") === "Furnace Guardian|Volcanic Plate Knight"
        && ra.afterRealm.main === 5 && ra.afterRealm.tracked === "ash.6" && ra.afterRealm.portal.token === "cold"
        && ra.afterRealm.portal.from === "ash", { ra, bosses: bka });
    // THE ENDING: through the finale's gate -> landed on the Cold spawn shrine -> ending.
    const i5 = w.log.length;
    await throughPortal(w);
    await until(w, () => Q2.endingSeen, 10);
    await steps(w, 20);
    const eb = since(w, i5, "ending:begin").map((e) => e.p);
    const sp0 = w.shrine.positions[0];
    const c = w.character;
    const dToStone = Math.hypot(c.position.x - sp0.x, c.position.z - sp0.z);
    const lastComp = since(w, i5, "quest:complete").map((e) => e.p.stepId);
    const dl = since(w, i5, "dialogue").map((e) => e.p.id);
    check("B27 finale gate lands on the Cold spawn shrine -> ash.6 completes -> ending:begin with the Echo's 3 last lines (no duplicate dialogue)",
        w.realm === "cold" && dToStone < PR.SHRINE_TOUCH_R && lastComp.join() === "ash.6" && eb.length === 1
        && eb[0].echoId === "echo.ash.6" && JSON.stringify(eb[0].lines) === JSON.stringify(STORY.ending.echo)
        && eb[0].lines.length === 3 && !dl.includes("echo.ash.6") && Q2.endingSeen,
        { realm: w.realm, dToStoneM: +dToStone.toFixed(2), completes: lastComp, ending: eb, dialogue: dl });
    check("B28 post-game tracker 'The world is whole. Ride on.'; journal 20/20 + 'Wakecaster'",
        Q2.tracked.stepId === "post" && Q2.tracked.tracker === "The world is whole. Ride on."
        && Q2.journal().mainDone === 20 && Q2.journal().playerTitle === "Wakecaster" && Q2.waypoint === null,
        { tracked: Q2.tracked, journal: { done: Q2.journal().mainDone, title: Q2.journal().playerTitle } });
}

// ---- every step advanced exactly once, in chain order, paying exactly its XP.
{
    // World 2 (after the reload) logged cold.8 onward; world 1 did cold.1-7.
    const comps = w.log.filter((e) => e.ev === "quest:complete").map((e) => e.p.stepId);
    const want = [];
    for (const r of ["sand", "ash"]) for (const s of QD.MAIN[r]) want.push(s.id);
    check("B29 (world 2) cold.8 + sand.1..6 + ash.1..6 completed exactly once each, in order",
        comps.join() === ["cold.8"].concat(want).join(), comps);
}

// A clean single-world replay of the WHOLE chain for the per-step ledger (no
// reload in the middle), checking each step's XP against the requirement
// standing at the moment it was paid.
{
    disposeWorld(w);
    localStorage.clear();
    w = buildWorld({ test: true });
    const Pz = w.progression, Qz = w.quest;
    Pz.newGame(); Pz.graceUntil = 1e9;
    await steps(w, 2);
    const sp = w.shrine.positions[0];
    tp(w, sp.sx, sp.sz); await steps(w, 5);
    Qz.surfM = 150; Qz._dirty = true; await steps(w, 5);                     // cold.2 (surf proven in B5)
    for (const id of Array.from(Qz._forced)) {
        const s = w.registry.slot(id);
        if (s >= 0) { w.registry.damage(id, w.registry.hp[s] + 1, { tag: "probe" }); await steps(w, 20); }
    }
    for (const realm of ["cold", "sand", "ash"]) {
        if (realm !== "cold") {
            tp(w, w.shrine.positions[0].sx, w.shrine.positions[0].sz); await steps(w, 10);
        }
        await kindleAndBreak(realm);
        await throughPortal(w);
        await until(w, () => (realm === "ash" ? Qz.endingSeen : w.realm !== realm), 10);
        await steps(w, 30);
    }
    const comps = w.log.filter((e) => e.ev === "quest:complete").map((e) => e.p);
    const ids = comps.map((p) => p.stepId);
    const want = [];
    for (const r of QD.REALM_ORDER) for (const s of QD.MAIN[r]) want.push(s.id);
    const qg = w.xpGrants.filter((g) => g.why === "quest");
    const ledger = comps.map((p, k) => {
        const g = qg[k];
        const frac = QD.STEP_BY_ID[p.stepId].xpFrac;
        return { id: p.stepId, xp: p.xp, frac, needBefore: g && g.needBefore,
            ok: !!g && g.n === p.xp && p.xp === Math.round(frac * g.needBefore) };
    });
    check("B30 single run: all 20 steps complete exactly once, in chain order",
        ids.length === 20 && ids.join() === want.join(), ids);
    check("B31 every step pays round(15% | 25% x XP_to_next at that moment) through progression.addXP",
        ledger.length === 20 && ledger.every((l) => l.ok), ledger);
    check("B32 ending fired once; post-game; no step re-fires in 10 s of post-game play",
        w.log.filter((e) => e.ev === "ending:begin").length === 1 && Qz.tracked.stepId === "post",
        { endings: w.log.filter((e) => e.ev === "ending:begin").length });
    const i0 = w.log.length;
    await steps(w, 600);
    check("B33 post-game is quiet (no quest:complete / ending:begin)", since(w, i0, "quest:complete").length === 0
        && since(w, i0, "ending:begin").length === 0, since(w, i0).map(evStr).slice(0, 5));
    // Save round trip of the finished run.
    Pz.save();
    disposeWorld(w);
    w = buildWorld({ test: true });
    w.progression.continueRun();
    await steps(w, 5);
    check("B34 finished run SAVE -> reload: endingSeen, 20/20, post-game tracker, 21 shrines lit",
        w.quest.endingSeen && w.quest.journal().mainDone === 20 && w.quest.tracked.stepId === "post"
        && ["cold", "sand", "ash"].reduce((n, r) => n + w.progression.litShrines(r).length, 0) === 21,
        { endingSeen: w.quest.endingSeen, main: w.quest.main, tracked: w.quest.tracked.stepId });
}

// =================================================================== C  gating table
{
    const q = w.quest;
    const saved = Object.assign({}, q.main);
    const rows = [];
    let ok = true;
    for (const r of QD.REALM_ORDER) {
        for (let idx = 0; idx <= QD.MAIN[r].length; idx++) {
            q.main[r] = idx;
            const mini = q.bossUnlocked(r, "mini"), realmB = q.bossUnlocked(r, "realm");
            const wantMini = idx > QD.UNLOCK_INDEX[r].mini, wantRealm = idx > QD.UNLOCK_INDEX[r].realm;
            if (mini !== wantMini || realmB !== wantRealm) ok = false;
            rows.push(r + "." + idx + ":" + (mini ? "M" : "-") + (realmB ? "R" : "-"));
        }
    }
    Object.assign(q.main, saved);
    const kindle = { cold: QD.STEP_BY_ID["cold.4"].index, sand: QD.STEP_BY_ID["sand.2"].index, ash: QD.STEP_BY_ID["ash.2"].index };
    const wake = { cold: QD.STEP_BY_ID["cold.6"].index, sand: QD.STEP_BY_ID["sand.4"].index, ash: QD.STEP_BY_ID["ash.4"].index };
    check("C1 gate answers: mini opens exactly after 'Kindle the Ring', realm exactly after 'Wake the Anchors' (all 3 realms)",
        ok && QD.UNLOCK_INDEX.cold.mini === kindle.cold && QD.UNLOCK_INDEX.sand.mini === kindle.sand
        && QD.UNLOCK_INDEX.ash.mini === kindle.ash && QD.UNLOCK_INDEX.cold.realm === wake.cold
        && QD.UNLOCK_INDEX.sand.realm === wake.sand && QD.UNLOCK_INDEX.ash.realm === wake.ash, rows.join(" "));
}

// ---- under-level: the floor stays (mini 6 / realm 8), tracker + densest pack.
{
    disposeWorld(w);
    localStorage.clear();
    const pos0 = { cold: ["cold_spawn", "shrine_e", "shrine_ne", "shrine_nw"], sand: [], ash: [] };
    localStorage.setItem(SAVE_KEY, JSON.stringify({ schemaVer: 4, level: 3, xp: 0, driftmarks: 0,
        spellsUnlocked: [2, 1, 3], realmsUnlocked: ["cold"], bossesKilled: {}, bossGates: {},
        lastShrineId: "shrine_e", restedBank: 0, lastSeenTs: Date.now(), objectiveState: {}, deaths: 0, pos: null,
        shrinesLit: pos0, playTime: 100,
        quest: { main: { cold: 4, sand: 0, ash: 0 }, surfM: 160, killsForOnboarding: 5,
            hintsSeen: { "hint.surf": true, "hint.bolt": true, "hint.arc": true, "hint.journal": true },
            endingSeen: false } }));
    w = buildWorld({ test: false });
    w.progression.continueRun();
    w.progression.graceUntil = 1e9;
    // A dense cluster of 3 at ~60 m and a lone imp at ~20 m.
    const c = w.character;
    const ids = [];
    ids.push(w.enemies.spawn("rimeImp", c.position.x + 20, c.position.z, 3));
    for (let k = 0; k < 3; k++) ids.push(w.enemies.spawn("rimeImp", c.position.x - 60 + k * 3, c.position.z + 2, 3));
    await steps(w, 40);
    const Qu = w.quest, Bu = w.bosses;
    const wp = Qu.waypoint;
    check("C2 under-level at cold.5 (L3, no ?test): tracker 'Grow stronger — reach level 6', underLevel 6, waypoint = the DENSEST pack, director idle",
        Qu.tracked.stepId === "cold.5" && Qu.tracked.tracker === "Grow stronger — reach level 6"
        && Qu.tracked.underLevel === 6 && wp && wp.kind === "pack" && wp.x < c.position.x - 40
        && Bu.state === "idle" && Bu._eligibleKind() === null && Qu.bossUnlocked("cold", "mini"),
        { tracked: Qu.tracked, waypoint: wp, boss: Bu.state });
    // Grow to level 6 -> the tracker returns, the boss arms.
    const i0 = w.log.length;
    while (w.progression.level < 6) w.progression.addXP(w.progression.xpNeed - w.progression.xp, "probe");
    const armed = await until(w, () => Bu.state === "pending" && Bu.kind === "mini", 12);
    await steps(w, 20);
    check("C3 reach level 6 -> tracker back to 'Find its arena and break it.', mini ARMS, waypoint on its arena",
        Qu.tracked.tracker === "Find its arena and break it." && Qu.tracked.underLevel === 0 && armed
        && Qu.waypoint && Qu.waypoint.kind === "boss", { tracked: Qu.tracked, waypoint: Qu.waypoint,
            steps: since(w, i0, "quest:step").map((e) => e.p.tracker) });
    // SNOWFLOW.test() flip with no bus event: the floor flip re-announces.
    const P6 = w.progression;
    P6.level = 4; P6._refreshNeed();
    await steps(w, 40);
    const underAgain = Qu.tracked.tracker;
    P6.setTestMode(true);
    await steps(w, 40);
    check("C4 a floor flip with no bus event (level drop / SNOWFLOW.test()) re-announces within 0.5 s",
        underAgain === "Grow stronger — reach level 6" && Qu.tracked.tracker === "Find its arena and break it.",
        { underAgain, afterTest: Qu.tracked.tracker });
    // A pending arena whose quest gate closes (NEW RUN) stands down.
    const pendingBefore = Bu.state;
    w.progression.newGame();
    await steps(w, 3);
    check("C5 NEW RUN while the mini arena is pending -> quest back to cold.1 and the director stands down",
        pendingBefore === "pending" && Qu.tracked.stepId === "cold.1" && Bu.state === "idle",
        { pendingBefore, now: Bu.state, tracked: Qu.tracked.stepId });
}

// ---- the REALM boss floor (8): parked at cold.7 at level 7, no ?test.
{
    disposeWorld(w);
    localStorage.clear();
    const all = ["cold_spawn"].concat(QD.RING_SHRINE_IDS);
    localStorage.setItem(SAVE_KEY, JSON.stringify({ schemaVer: 4, level: 7, xp: 0, driftmarks: 0,
        spellsUnlocked: [2, 1, 3, 4], realmsUnlocked: ["cold"], bossesKilled: { "cold:mini": true },
        bossGates: {}, lastShrineId: "shrine_e", restedBank: 0, lastSeenTs: Date.now(), objectiveState: {},
        deaths: 0, pos: null, shrinesLit: { cold: all, sand: [], ash: [] }, playTime: 900,
        quest: { main: { cold: 6, sand: 0, ash: 0 }, surfM: 160, killsForOnboarding: 5,
            hintsSeen: { "hint.surf": true, "hint.bolt": true, "hint.arc": true, "hint.journal": true },
            endingSeen: false } }));
    w = buildWorld({ test: false });
    w.progression.continueRun();
    w.progression.graceUntil = 1e9;
    const c = w.character;
    w.enemies.spawn("rimeImp", c.position.x + 30, c.position.z, 7);
    const Qr = w.quest, Br = w.bosses;
    const samples = [];
    for (let k = 0; k < 16; k++) { await steps(w, 30); samples.push(Br.state === "idle" && Br._eligibleKind() === null); }
    const under = { tracked: Qr.tracked, waypoint: Qr.waypoint, gate: Qr.bossUnlocked("cold", "realm"),
        floor: Br.levelFloor("realm"), meets: Br.meetsFloor("realm") };
    check("C6 under-level at cold.7 (L7, no ?test): 'Grow stronger — reach level 8', underLevel 8, pack waypoint, realm boss NOT armed for 8 s",
        under.tracked.stepId === "cold.7" && under.tracked.tracker === "Grow stronger — reach level 8"
        && under.tracked.underLevel === 8 && under.waypoint && under.waypoint.kind === "pack"
        && under.gate === true && under.floor === 8 && under.meets === false && samples.every(Boolean), under);
    w.progression.addXP(w.progression.xpNeed - w.progression.xp, "probe");   // -> L8
    const armed = await until(w, () => Br.state === "pending" && Br.kind === "realm", 12);
    await steps(w, 20);
    check("C7 reach level 8 -> tracker 'Face the Warden of the Cold in its arena.', realm boss ARMS, waypoint 'Shrinebreaker'",
        w.progression.level === 8 && armed && Qr.tracked.tracker === "Face the Warden of the Cold in its arena."
        && Qr.tracked.underLevel === 0 && Qr.waypoint && Qr.waypoint.kind === "boss"
        && Qr.waypoint.label === "Shrinebreaker",
        { level: w.progression.level, armed, tracked: Qr.tracked, waypoint: Qr.waypoint });
}

// =================================================================== D  legacy saves
async function legacy(blob, label) {
    disposeWorld(w);
    localStorage.clear();
    if (blob) localStorage.setItem(SAVE_KEY, JSON.stringify(blob));
    w = buildWorld({ test: false });
    const atRegister = w.quest.tracked && w.quest.tracked.stepId;
    const xp0 = w.progression.xp, lvl0 = w.progression.level;
    w.progression.continueRun();
    w.progression.graceUntil = 1e9;
    await steps(w, 60);
    return { label, atRegister, tracked: w.quest.tracked.stepId, main: Object.assign({}, w.quest.main),
        hintsSeen: Object.keys(w.quest.hintsSeen).sort(), surfM: w.quest.surfM, kills: w.quest.killsForOnboarding,
        xpBefore: xp0, xpAfter: w.progression.xp, level: w.progression.level, lvl0,
        hintsActive: w.quest._hintIds.slice(), sandOpen: w.quest.journal().realms[1].open,
        forced: w.quest.packSpawns };
}
const v3 = (over) => Object.assign({ schemaVer: 3, level: 9, xp: 1200, driftmarks: 0,
    spellsUnlocked: [2, 1, 3, 4, 5], boons: [], realmsUnlocked: ["cold"], bossesKilled: {}, bossGates: {},
    lastShrineId: "shrine_e", restedBank: 0, lastSeenTs: Date.now(), objectiveState: {}, deaths: 4,
    pos: { x: 40, z: -30, facing: 0, realm: "cold" } }, over || {});
{
    const a = await legacy(v3(), "v3 L9");
    check("D1 v3 veteran (L9, no quest section) -> cold.4 'Kindle the Ring', onboarding marked done, no XP paid at load",
        a.atRegister === "cold.4" && a.tracked === "cold.4" && a.main.cold === 3 && a.surfM === 150 && a.kills === 5
        && ["hint.arc", "hint.bolt", "hint.journal", "hint.surf"].every((h) => a.hintsSeen.includes(h))
        && a.hintsActive.length === 0 && a.forced === 0 && a.xpAfter === a.xpBefore && a.level === 9, a);
    // ...and the v3-only `boons: []` survives the next save.
    w.progression.save();
    const b = JSON.parse(localStorage.getItem(SAVE_KEY));
    check("D2 v3 -> first v4 save: schemaVer 4, v3's boons key kept, quest section written",
        b.schemaVer === 4 && Array.isArray(b.boons) && b.quest && b.quest.main.cold === 3, { schemaVer: b.schemaVer, boons: b.boons, quest: b.quest });
    const n = await legacy(v3({ level: 1, xp: 10, deaths: 0 }), "v3 L1");
    check("D3 v3 new-ish character (L1) -> cold.1 (the onboarding is still ahead of it)",
        n.tracked === "cold.1" && n.main.cold === 0, n);
    const v2 = { schemaVer: 2, level: 12, xp: 50, driftmarks: 0, spellsUnlocked: [2, 1, 3, 4, 5], boons: [],
        realmsUnlocked: ["cold", "sand"], bossesKilled: { "cold:mini": true, "cold:realm": true, "The Icewall": true, "Shrinebreaker": true },
        lastShrineId: "cold_spawn", restedBank: 0, lastSeenTs: Date.now(), objectiveState: {}, deaths: 9 };
    const m = await legacy(v2, "v2 L12 both cold bosses, sand open");
    check("D4 v2 veteran (L12, cold bosses dead, Sand open, no shrinesLit) -> cold.4 + Sand chain open; bosses stay dead",
        m.tracked === "cold.4" && m.main.cold === 3 && m.sandOpen && w.bosses._eligibleKind() === null, m);
    // Light 3 rings: cold.4 -> cold.5 auto (Icewall already dead) -> cold.6.
    for (let k = 0; k < 3; k++) await followWaypointToShrine(w);
    await steps(w, 10);
    check("D5 ...3 rings lit -> cold.4 done, cold.5 auto-completes from the old kill flag -> cold.6",
        w.quest.main.cold === 5 && w.quest.tracked.stepId === "cold.6", { main: w.quest.main });
    const v4n = { schemaVer: 4, level: 5, xp: 0, driftmarks: 0, spellsUnlocked: [2, 1, 3], realmsUnlocked: ["cold"],
        bossesKilled: {}, bossGates: {}, lastShrineId: "cold_spawn", restedBank: 0, lastSeenTs: Date.now(),
        objectiveState: {}, deaths: 0, pos: null, shrinesLit: { cold: ["cold_spawn"], sand: [], ash: [] }, playTime: 900 };
    const u = await legacy(v4n, "v4 without quest section");
    check("D6 v4 blob written before the quest engine was wired (no quest key, L5) -> cold.4",
        u.tracked === "cold.4" && u.main.cold === 3, u);
    const bad = Object.assign({}, v4n, { level: 2, quest: { main: { cold: 99, sand: -4, ash: "x" }, surfM: -5,
        killsForOnboarding: "lots", hintsSeen: { "hint.surf": "yes" }, endingSeen: "true" } });
    const z = await legacy(bad, "corrupt quest values");
    check("D7 corrupt quest values clamp (cold 99 -> 8 done, sand -4 -> 0, ash 'x' -> 0; surf/kills >= 0; non-true flags dropped)",
        z.main.cold === 8 && z.main.sand === 0 && z.main.ash === 0 && z.surfM === 0 && z.kills === 0
        && !z.hintsSeen.includes("hint.surf") && w.quest.endingSeen === false, z);
    const none = await legacy(null, "no save at all");
    check("D8 no save at all -> cold.1", none.tracked === "cold.1", none);
}

// =================================================================== E  mid-onboarding save
{
    disposeWorld(w);
    localStorage.clear();
    w = buildWorld({ test: false });
    const Pm = w.progression, Qm = w.quest;
    Pm.newGame(); Pm.graceUntil = 1e9;
    await steps(w, 2);
    tp(w, w.shrine.positions[0].sx, w.shrine.positions[0].sz); await steps(w, 5);
    Qm.surfM = 150; Qm._dirty = true; await steps(w, 5);
    const ids = Array.from(Qm._forced);
    for (const id of ids.slice(0, 2)) {
        const s = w.registry.slot(id); w.registry.damage(id, w.registry.hp[s] + 1, { tag: "probe" }); await steps(w, 20);
    }
    Pm.save();
    disposeWorld(w);
    w = buildWorld({ test: false });
    w.progression.continueRun();
    w.progression.graceUntil = 1e9;
    await steps(w, 10);
    check("E1 save mid-cold.3 (2 kills) -> reload: cold.3, 2 kills kept, LMB/1 hints back, the forced pack re-stood",
        w.quest.tracked.stepId === "cold.3" && w.quest.killsForOnboarding === 2
        && w.quest._hintIds.includes("hint.bolt") && w.quest._hintIds.includes("hint.arc")
        && w.quest.packSpawns === 1 && Array.from(w.quest._forced).filter((id) => id > 0).length === 5,
        { tracked: w.quest.tracked.stepId, kills: w.quest.killsForOnboarding, hints: w.quest._hintIds, forced: Array.from(w.quest._forced) });
    // Side-content sections nested under quest.* survive the quest's own save.
    const unreg = w.progression.registerSaveSection("quest.caches", {
        serialize: () => ({ cold: [1, 4] }), deserialize: () => {} });
    w.progression.save();
    unreg();
    w.progression.save();          // owner gone: the loaded value rides along verbatim
    const b = JSON.parse(localStorage.getItem(SAVE_KEY));
    check("E2 quest.caches (another lane's nested section) survives the quest section's save, with and without its owner",
        b.quest && b.quest.caches && JSON.stringify(b.quest.caches) === JSON.stringify({ cold: [1, 4] })
        && b.quest.main.cold === 2, { quest: b.quest });
}

// =================================================================== F  determinism
check("F1 no Math.random on the quest / boss director / progression / portal frame paths",
    badRandom.length === 0, badRandom.slice(0, 5));

disposeWorld(w);
const fails = RESULTS.filter((r) => !r[1]);
console.log("\n" + (RESULTS.length - fails.length) + "/" + RESULTS.length + " checks passed");
if (fails.length) console.log("FAILED: " + fails.map((f) => f[0]).join(" || "));
process.exit(fails.length ? 1 : 0);
