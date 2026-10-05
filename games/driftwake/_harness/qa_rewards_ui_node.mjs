// qa_rewards_ui_node.mjs -- lane R UI FLOWS headless: the boon pick, the
// shrine menu (Rest / Travel same + cross realm / Boons / Relics / Shop /
// Chronicle), the Driftmark toast and the Wake Glass counter, driven through
// their REAL DOM with keys and clicks.
//
//   node --expose-gc --import ./_harness/node_three_register.mjs ./_harness/qa_rewards_ui_node.mjs
//
// REAL: ui/boonPick.js, ui/shrineMenu.js (+ GlassCounter, DriftmarkToast),
// progression/{modifiers,boons,relics,shop,progression}.js, core/input.js
// (its real window keydown listener is installed with initInput, so "a spell
// key does not leak through an open modal" is measured on input.spellPressed),
// character/controller.js, world/shrine.js (the seven anchors + stand
// points), combat/damageable.js, combat/enemies.js, quests/events.js.
// STUB: the DOM (_harness/node_dom_shim.mjs -- a small real parser/dispatcher,
// no layout), the terrain (flat), GPU-side objects, main.js's enterRealm
// (its call order minus the GPU work, then 'realm:entered').
// Exit code 0 only if every check passes.
import { installDom } from "./node_dom_shim.mjs";
const dom = installDom();

const THREE = await import("three");
const { registerShaders } = await import("../src/shaders/registry.js");
registerShaders();
const { bus } = await import("../src/quests/events.js");
const { input, initInput } = await import("../src/core/input.js");
const { S } = await import("../src/core/settings.js");
const { CharacterController } = await import("../src/character/controller.js");
const { DamageableRegistry } = await import("../src/combat/damageable.js");
const combatData = await import("../src/combat/combatData.js");
const { Enemies } = await import("../src/combat/enemies.js");
const { Progression, SAVE_KEY } = await import("../src/progression/progression.js");
const { SpawnShrine } = await import("../src/world/shrine.js");
const realms = await import("../src/world/realms.js");
const { Modifiers } = await import("../src/progression/modifiers.js");
const { Boons } = await import("../src/progression/boons.js");
const { Relics } = await import("../src/progression/relics.js");
const { Shop, RANK_PRICES } = await import("../src/progression/shop.js");
const { BoonPick, DriftmarkToast, anyModalOpen } = await import("../src/ui/boonPick.js");
const { ShrineMenu, GlassCounter } = await import("../src/ui/shrineMenu.js");
const { STORY } = await import("../src/quests/storyText.js");

const RESULTS = [];
function check(name, ok, detail) {
    RESULTS.push([name, !!ok]);
    console.log((ok ? "PASS " : "FAIL ") + name + "  " + JSON.stringify(detail === undefined ? "" : detail));
}
const r3 = (x) => Math.round(x * 1000) / 1000;

// ------------------------------------------------------------- stubs
const terrain = {
    realm: "cold",
    heightAt() { return 0; },
    normalAt(x, z, out) { return out.set(0, 1, 0); },
    edge01() { return 0; },
    clampToPlayArea() {},
};
const scene = { add() {}, remove() {} };
const box = (v) => ({ value: v });
const uniforms = {
    sssStrength: box(1), sssRadius: box(1), glintIntensity: box(0.55), glintGrazing: box(1),
    uCameraPos: box(new THREE.Vector3()), uViewProj: box(new THREE.Matrix4()), uTime: box(0),
    uSunDir: box(new THREE.Vector3(0, 1, 0)), uSunColor: box(new THREE.Vector3(1, 1, 1)),
    uResolution: box(new THREE.Vector2(1, 1)),
};
const shadows = { registerCaster() {}, makeCasterMaterial() { return { dispose() {} }; }, receiverUniforms() { return {}; } };
const crystals = { scene, shadows, material: { uniforms } };
const rig = {
    yaw: 0, roll: 0, _first: false, pivotVel: new THREE.Vector3(),
    getFlatForward(out) { return out.set(Math.sin(this.yaw), 0, -Math.cos(this.yaw)); },
    getFlatRight(out) { return out.set(Math.cos(this.yaw), 0, Math.sin(this.yaw)); },
    addTrauma() {},
};
const vis = {
    _slotInst: [], spawnUnit(i) { this._slotInst[i] = { tint: new Float32Array(4), state: new Float32Array(4) }; },
    spawn(i) { this.spawnUnit(i); }, free() {}, drive() {}, driveBolt() {}, driveClip() {}, update() {},
};
// The wake's albedo box (vfx/surfWake.js wakeUniforms.uWakeAlbedo shape).
const wake = { wakeUniforms: { uWakeAlbedo: { value: new Float32Array([0.895, 0.920, 0.965]) } } };

initInput(dom.canvas, {});
dom.lock();

const DT = 1 / 60;
let W = null;

function buildWorld() {
    const registry = new DamageableRegistry();
    const character = new CharacterController(terrain);
    const shrine = new SpawnShrine(terrain, crystals, 5.0, 5.5);
    const enemies = new Enemies(scene, terrain, registry, character, combatData, null);
    enemies.attachVis(vis);
    const progression = new Progression(character, registry, null);
    shrine.register(progression);
    enemies.progression = progression;
    const w = { registry, character, shrine, enemies, progression, realm: "cold", t: 0, log: [] };
    const ctx = {
        scene, terrain, character, rig, registry, enemies, shrine, progression, bus, S, realms, wake,
        bosses: { state: "idle" },
        getRealm: () => w.realm,
        enterRealm: async (token) => {
            // main.js enterRealm order minus the GPU: sweep, (await the body
            // fetch), shrine.setRealm (re-ground in 3 frames), then the token.
            w.enemies.clear();
            await Promise.resolve();
            terrain.realm = token;
            w.shrine.setRealm(token);
            w.realm = token;
            w.shop.setRealm(token);
            bus.emit("realm:entered", { realm: token });
            w.enterRealmCalls = (w.enterRealmCalls || 0) + 1;
            return token;
        },
    };
    w.ctx = ctx;
    w.mods = new Modifiers(ctx);
    w.relics = new Relics(ctx);
    w.boons = new Boons(ctx);
    w.shop = new Shop(ctx);
    w.pick = new BoonPick(ctx);
    w.toast = new DriftmarkToast(ctx);
    w.menu = new ShrineMenu(ctx);
    w.glass = new GlassCounter(ctx);
    for (const ev of ["boon:offer", "boon:chosen", "ui:open", "ui:close", "shrine:travelled", "relic:equipped",
        "shop:bought", "glass:changed", "driftmark:offer", "driftmark:chosen", "realm:entered"]) {
        w.log.push(null);
        w.log.pop();
        bus.on(ev, (p) => w.log.push({ ev, p: p == null ? null : JSON.parse(JSON.stringify(p)) }));
    }
    W = w;
    return w;
}

/** One frame in main.js order; game dt is 0 while S.freezeTime (main.js:947). */
function frame(w) {
    const dt = S.freezeTime ? 0 : DT;
    w.character.update(dt, rig);
    w.registry.update(dt);
    w.shrine.update(dt);
    w.enemies.update(dt);
    w.mods.update(dt);
    w.progression.update(dt);
    w.pick.update(dt);
    w.toast.update(dt);
    w.menu.update(dt);
    w.glass.update(dt);
    w.registry.endFrame();
    w.t += dt;
}
function frames(w, n) { for (let i = 0; i < n; i++) frame(w); }
/** rAF pump: a world frame, then the queued callbacks (fast travel awaits these). */
async function pump(w, n) {
    for (let i = 0; i < n; i++) {
        dom.pumpFrames(1, () => frame(w));
        await Promise.resolve(); await Promise.resolve();
    }
}
function tp(w, x, z) {
    const c = w.character;
    c.position.set(x, terrain.heightAt(x, z), z);
    c.velocity.set(0, 0, 0);
}
const since = (w, i0, ev) => w.log.slice(i0).filter((e) => !ev || e.ev === ev);
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => (root || document).querySelectorAll(sel);
const byText = (sel, txt, root) => $$(sel, root).find((e) => e.textContent.indexOf(txt) >= 0) || null;

// =====================================================================
localStorage.clear();
let w = buildWorld();
w.progression.newGame();
w.progression.level = 10; w.progression._refreshNeed(); w.progression._applyLevelStats(true);
S.freezeTime = false;
frames(w, 5);

// ------------------------------------------------ BOON PICK
{
    const i0 = w.log.length;
    const locks0 = dom.stats.lockExits;
    bus.emit("boss:killed", { realm: "cold", kind: "mini", key: "iceWall", name: "The Icewall", first: true });
    const offer = since(w, i0, "boon:offer")[0];
    frames(w, 60);                                     // 1.0 s of game time
    const earlyOpen = w.pick.isOpen;
    frames(w, 35);                                     // past the 1.5 s open delay
    const el = $("#dw-boonpick");
    const cards = $$(".dwr-card", el);
    check("boonPick: the FIRST cold mini-boss kill offers the pair and opens the modal after 1.5 s of game time (not at 1.0 s), naming the live boss",
        !!offer && offer.p.bossKey === "cold.mini" && offer.p.boss === "The Icewall" && !earlyOpen && w.pick.isOpen
        && el.classList.contains("open") && cards.length === 2
        && cards[0].textContent.indexOf("Rime Edge") >= 0 && cards[1].textContent.indexOf("Deep Chill") >= 0
        && $(".dwr-kicker", el).textContent.indexOf("The Icewall") >= 0,
        { offer: offer && offer.p.boss, earlyOpen, open: w.pick.isOpen, kicker: $(".dwr-kicker", el).textContent,
            cards: cards.map((c) => c.textContent) });
    check("boonPick PAUSE PATTERN: S.freezeTime = true, pointer lock released, game time stops, anyModalOpen()",
        S.freezeTime === true && dom.stats.lockExits === locks0 + 1 && document.pointerLockElement === null && anyModalOpen(),
        { freeze: S.freezeTime, lockExits: dom.stats.lockExits - locks0, anyModalOpen: anyModalOpen() });
    const tBefore = w.registry.time;
    frames(w, 30);
    const spell0 = input.spellPressed;
    dom.key("Digit3");                                 // a spell key (bloom) while the modal is up
    dom.key("Digit5");
    const leaked = input.spellPressed !== spell0;
    check("boonPick: game time is frozen and spell keys (3, 5) never reach core/input.js while open",
        w.registry.time === tBefore && !leaked, { timeAdvanced: w.registry.time - tBefore, spellPressed: input.spellPressed });
    dom.key("ArrowRight");
    const sel1 = w.pick.sel;
    const locksReq0 = dom.stats.lockRequests;
    const i1 = w.log.length;
    dom.key("Enter");
    const chosen = since(w, i1, "boon:chosen")[0];
    check("boonPick KEYBOARD: -> selects Deep Chill, Enter takes it; modal closes, freeze restored, pointer re-locked, the effect is live (chill cap 6)",
        sel1 === 1 && w.boons.picks["cold.mini"] === 1 && !w.pick.isOpen && !el.classList.contains("open")
        && S.freezeTime === false && dom.stats.lockRequests === locksReq0 + 1 && w.mods.chillMax === 6
        && chosen && chosen.p.boon.id === "boon.deepChill" && !anyModalOpen(),
        { sel1, picks: w.boons.picks, freeze: S.freezeTime, lockRequests: dom.stats.lockRequests - locksReq0, chillMax: w.mods.chillMax });
    bus.emit("boss:killed", { realm: "cold", kind: "mini", key: "iceWall", name: "The Icewall", first: false });
    frames(w, 100);
    check("boonPick: a RE-kill of the same boss offers nothing", !w.pick.isOpen && w.boons.pending.length === 0,
        { open: w.pick.isOpen, pending: w.boons.pending });
}
{
    // MOUSE path: cold realm boss.
    bus.emit("boss:killed", { realm: "cold", kind: "realm", key: "shrinebreaker", name: "Shrinebreaker", first: true });
    frames(w, 95);
    const el = $("#dw-boonpick");
    const cards = $$(".dwr-card", el);
    dom.mousemove(cards[1]);
    const hover = w.pick.sel;
    dom.mousemove(cards[0]);
    const hp0 = w.character.healthMax;
    dom.click(cards[0]);
    check("boonPick MOUSE: hover moves the selection, a click takes Glacial Guard (max HP 100 -> 110), modal closes",
        hover === 1 && w.boons.picks["cold.realm"] === 0 && !w.pick.isOpen && hp0 === 100 && w.character.healthMax === 110
        && S.freezeTime === false, { hover, picks: w.boons.picks, hp: [hp0, w.character.healthMax] });
}
{
    // Esc DEFERS (the pick is never lost), and it persists across a reload.
    bus.emit("boss:killed", { realm: "sand", kind: "mini", key: "gatekeeper", name: "Gatekeeper of Brass", first: true });
    frames(w, 95);
    const opened = w.pick.isOpen;
    dom.key("Escape");
    check("boonPick Esc = decide later: the modal closes, freeze restored, the Sand mini pair stays PENDING",
        opened && !w.pick.isOpen && S.freezeTime === false && w.boons.stateOf("sand.mini") === "pending",
        { opened, open: w.pick.isOpen, state: w.boons.stateOf("sand.mini") });
    w.progression.save();
    const blob = JSON.parse(localStorage.getItem(SAVE_KEY));
    check("boons persisted in the v4 blob: boons [{bossKey, pick}] + boonOffers [pending]",
        JSON.stringify(blob.boons) === JSON.stringify([{ bossKey: "cold.mini", pick: 1 }, { bossKey: "cold.realm", pick: 0 }])
        && JSON.stringify(blob.boonOffers) === JSON.stringify(["sand.mini"]),
        { boons: blob.boons, boonOffers: blob.boonOffers });
}

// ------------------------------------------------ SHRINE MENU
{
    // Stand at the spawn shrine's stand point: progression lights it by touch.
    const sp = w.shrine.positions[0];
    tp(w, sp.sx, sp.sz);
    frames(w, 3);
    const lit = w.progression.isShrineLit("cold", "cold_spawn");
    const reach = w.menu.reach;
    const dormant = w.shrine.positions[1].id;
    const refused = w.menu.open(dormant);
    const i0 = w.log.length;
    bus.emit("ui:open", { panel: "shrine" });          // lane U's E key, over the bus
    const opened = w.menu.isOpen;
    const el = $("#dw-shrine");
    check("shrineMenu E hook: `reach` = the lit shrine in range; open(dormant id) is refused; 'ui:open' {panel:'shrine'} opens it at the reach shrine; pause pattern",
        lit && reach === "cold_spawn" && refused === false && opened && w.menu.shrineId === "cold_spawn"
        && el.classList.contains("open") && S.freezeTime === true && document.pointerLockElement === null
        && $(".dwr-title", el).textContent === STORY.shrines.cold.cold_spawn.name,
        { lit, reach, refused, opened, title: $(".dwr-title", el).textContent });
    const navs = $$(".dwr-navb", el).map((b) => b.textContent.replace(/^\d/, ""));
    check("shrineMenu pages: Rest, Travel, Boons, Relics, Shop, Chronicle", JSON.stringify(navs) ===
        JSON.stringify(["Rest", "Travel", "Boons", "Relics", "Shop", "Chronicle"]), navs);
    // keys swallowed
    const sp0 = input.spellPressed;
    dom.key("Digit4");                                  // jumps to the Relics PAGE, never casts Spikes
    const tabAfter4 = w.menu.tab;
    check("shrineMenu keys: Digit4 selects the Relics page and never reaches core/input.js",
        tabAfter4 === 3 && input.spellPressed === sp0, { tab: tabAfter4, spellPressed: input.spellPressed });
    dom.key("Digit1");
    // REST
    w.character.health = 20; w.character.mana = 5;
    w.progression.lastShrineId = "shrine_e";
    const restBtn = $('[data-act="rest"]', el);
    dom.click(restBtn);
    check("shrineMenu REST: full heal + full mana, respawn set to this shrine",
        w.character.health === w.character.healthMax && w.character.mana === w.character.manaMax
        && w.progression.lastShrineId === "cold_spawn",
        { hp: w.character.health, mana: w.character.mana, lastShrineId: w.progression.lastShrineId });
    dom.key("Escape");
    check("shrineMenu Esc closes (nav zone): freeze restored, pointer re-locked",
        !w.menu.isOpen && S.freezeTime === false && document.pointerLockElement === dom.canvas, { open: w.menu.isOpen });
}
{
    // Light a second COLD shrine by riding to it, then travel back to the spawn
    // shrine through the menu (same-realm fast travel).
    const s2 = w.shrine.positions[2];
    tp(w, s2.sx, s2.sz);
    frames(w, 3);
    const lit2 = w.progression.isShrineLit("cold", s2.id);
    // ride home
    const sp = w.shrine.positions[0];
    tp(w, sp.sx, sp.sz);
    frames(w, 3);
    w.menu.open(w.menu.reach);
    const el = $("#dw-shrine");
    dom.key("Digit2");                                 // Travel page
    const chip = $('[data-act="travel:cold:' + s2.id + '"]', el);
    const i0 = w.log.length;
    dom.click(chip);
    await pump(w, 6);
    const c = w.character;
    const ev = since(w, i0, "shrine:travelled")[0];
    const fx = Math.sin(c.facing), fz = -Math.cos(c.facing);
    const toMon = Math.atan2(s2.x - c.position.x, -(s2.z - c.position.z));
    check("shrineMenu TRAVEL same realm: the player lands on the shrine's STAND point, facing the monument; menu closed, unpaused; respawn set; 'shrine:travelled'",
        lit2 && !!chip && Math.hypot(c.position.x - s2.sx, c.position.z - s2.sz) < 0.05
        && Math.abs(Math.atan2(Math.sin(c.facing - toMon), Math.cos(c.facing - toMon))) < 0.01
        && !w.menu.isOpen && S.freezeTime === false && w.progression.lastShrineId === s2.id
        && ev && ev.p.realm === "cold" && ev.p.id === s2.id && ev.p.fromId === "cold_spawn",
        { lit2, at: [r3(c.position.x), r3(c.position.z)], stand: [r3(s2.sx), r3(s2.sz)], ev: ev && ev.p,
            lastShrineId: w.progression.lastShrineId });
}
{
    // CROSS-REALM: Sand opens (realm boss), the player crosses, lights the Sand
    // spawn shrine, crosses back, then fast-travels to Sand from a Cold shrine.
    const P = w.progression;
    const locked0 = w.menu.realmOpen("sand");
    P.realmsUnlocked.push("sand");
    await w.ctx.enterRealm("sand");
    await pump(w, 5);
    const ss = w.shrine.positions[0];
    tp(w, ss.sx, ss.sz);
    frames(w, 3);
    const sandLit = P.isShrineLit("sand", "cold_spawn");
    await w.ctx.enterRealm("cold");
    await pump(w, 5);
    const s2 = w.shrine.positions[2];
    tp(w, s2.sx, s2.sz);
    frames(w, 3);
    const calls0 = w.enterRealmCalls;
    w.menu.open(w.menu.reach);
    const el = $("#dw-shrine");
    dom.key("Digit2");
    const chip = $('[data-act="travel:sand:cold_spawn"]', el);
    const i0 = w.log.length;
    dom.click(chip);
    await pump(w, 12);
    const c = w.character;
    const st = w.shrine.positions[0];
    const ev = since(w, i0, "shrine:travelled")[0];
    check("shrineMenu TRAVEL cross-realm: Sand locked until unlocked; travel calls enterRealm('sand') ONCE, waits for the re-ground, lands on the Sand shrine's stand point; progression follows the realm",
        locked0 === false && sandLit && !!chip && w.enterRealmCalls === calls0 + 1 && w.realm === "sand" && P.realm === "sand"
        && Math.hypot(c.position.x - st.sx, c.position.z - st.sz) < 0.05 && !w.menu.isOpen && S.freezeTime === false
        && ev && ev.p.realm === "sand" && ev.p.fromRealm === "cold",
        { locked0, sandLit, chip: !!chip, calls: w.enterRealmCalls - calls0, realm: w.realm, pRealm: P.realm,
            at: [r3(c.position.x), r3(c.position.z)], stand: [r3(st.sx), r3(st.sz)], ev: ev && ev.p });
    await w.ctx.enterRealm("cold");
    await pump(w, 5);
    const sp = w.shrine.positions[0];
    tp(w, sp.sx, sp.sz);
    frames(w, 3);
}
{
    // BOONS page: a pending pick taken at the shrine, and a FREE respec.
    w.menu.open(w.menu.reach);
    const el = $("#dw-shrine");
    dom.key("Digit3");
    const choose = $('[data-act="choose:sand.mini:0"]', el);
    dom.click(choose);
    const takenAtShrine = w.boons.picks["sand.mini"] === 0;
    const rr0 = w.shop.rerolls;
    const swap = $('[data-act="swap:cold.mini:0"]', el);
    dom.click(swap);
    check("shrineMenu BOONS: the deferred Sand pick is taken at the shrine; a respec within a pair is FREE (no token) and live (Deep Chill -> Rime Edge, frost x1.08)",
        takenAtShrine && w.boons.picks["cold.mini"] === 0 && w.shop.rerolls === rr0 && w.mods.dmgFrost === 1.08
        && w.mods.chillMax === 5, { picks: w.boons.picks, rerolls: [rr0, w.shop.rerolls], dmgFrost: w.mods.dmgFrost });
    // Off-shrine respec costs a token: none held -> refused.
    const off = w.boons.respec("cold.mini", 1, { atShrine: false });
    check("boons: away from a shrine a swap needs a reroll token (none held -> refused)", !off.ok && off.reason === "no reroll token", off);
}
{
    // RELICS: three found, 2 slots; swap; slot 3 after the Sand realm boss.
    const el = $("#dw-shrine");
    bus.emit("reward", { kind: "relic", realm: "cold", source: "cache", index: 0 });
    bus.emit("reward", { kind: "relic", realm: "cold", source: "cache", index: 1 });
    bus.emit("reward", { kind: "relic", id: "relic.plateShard", source: "bounty" });
    dom.key("Digit4");
    const R = w.relics;
    const auto = R.equipped.slice();
    const slots = $$(".dwr-slot", el).map((s) => s.textContent);
    const hp0 = w.character.healthMax;
    dom.click($('[data-act="slot:1"]', el));
    dom.click($('[data-act="relic:relic.plateShard"]', el));
    const afterSwap = R.equipped.slice();
    const hp1 = w.character.healthMax;
    check("shrineMenu RELICS: 2 slots from the start (finds auto-fill empties, the 3rd waits in the bag, slot 3 sealed); a click swaps Plate Shard in -> max HP x1.15 live",
        R.slotCount === 2 && auto[0] === "relic.rimeHeart" && auto[1] === "relic.frostglassLens" && auto[2] === null
        && slots[2].indexOf("sealed") >= 0 && afterSwap[1] === "relic.plateShard" && hp1 === Math.round(hp0 * 1.15),
        { auto, slots, afterSwap, hp: [hp0, hp1] });
    bus.emit("boss:killed", { realm: "sand", kind: "realm", key: "warden", name: "Warden of the Sundered Gate", first: true });
    frames(w, 1);
    const n3 = R.slotCount;
    dom.key("Digit4");                                 // re-open the Relics page
    dom.click($('[data-act="slot:2"]', el));
    dom.click($('[data-act="relic:relic.frostglassLens"]', el));
    check("relics: the Sand realm boss opens slot 3; a third relic is worn in it (boltRange x1.20 live)",
        n3 === 3 && R.equipped[2] === "relic.frostglassLens" && Math.abs(w.mods.boltRange - 1.2) < 1e-9,
        { slotCount: n3, equipped: R.equipped, boltRange: w.mods.boltRange });
    // the Sand realm boss kill above also offered sand.realm (first) — the pick
    // waits while the shrine menu is open (never opens over another modal)
    frames(w, 120);
    check("boonPick never opens over the shrine menu (the Sand realm offer waits)", !w.pick.isOpen && w.menu.isOpen,
        { pick: w.pick.isOpen, menu: w.menu.isOpen });
}
{
    // SHOP: §4.3 prices, through clicks.
    const el = $("#dw-shrine");
    w.shop.grant(2000, "qa");
    dom.key("Digit5");
    const prices = [];
    const hp0 = w.character.healthMax;
    for (let k = 0; k < 5; k++) {
        prices.push(w.shop.price("shop.vitality"));
        const b = $('[data-act="buy:shop.vitality"]', el);
        if (b) dom.click(b);
    }
    const vitMaxed = !$('[data-act="buy:shop.vitality"]', el) && w.shop.price("shop.vitality") === null;
    const hp5 = w.character.healthMax;
    const g0 = w.shop.glass;
    dom.click($('[data-act="buy:shop.reroll"]', el));
    const rr = w.shop.rerolls;
    const g1 = w.shop.glass;
    dom.click($('[data-act="buy:trail.ember"]', el));
    const g2 = w.shop.glass;
    const tint = Array.from(wake.wakeUniforms.uWakeAlbedo.value).map(r3);
    const slot3Price = w.shop.price("shop.slot3");
    check("shrineMenu SHOP: Vitality I-V cost 60/90/130/180/240 (max HP x1.20 at V, then maxed); Boon Reroll 80 -> +1 token; Wake Trail 40 -> owned, worn, wake albedo tinted; Relic Slot 3 not for sale once open",
        JSON.stringify(prices) === JSON.stringify(RANK_PRICES) && vitMaxed
        && hp5 === Math.round(Math.round(hp0 / 1.15 / 1.1) * 1.1 * 1.15 * 1.2) && rr === 1 && g0 - g1 === 80
        && g1 - g2 === 40 && w.shop.trail === "trail.ember" && tint.join() !== "0.895,0.92,0.965" && slot3Price === null,
        { prices, vitMaxed, hp: [hp0, hp5], rerolls: rr, glass: [g0, g1, g2], trail: w.shop.trail, wakeAlbedo: tint, slot3Price });
    // Every trail, in every realm: a real tint, and a valid ALBEDO (<= 0.98).
    {
        const { TRAILS } = await import("../src/progression/shop.js");
        const sh = w.shop, keep = sh.trail;
        const rows = [];
        let ok = true;
        for (const realm of ["cold", "sand", "ash"]) {
            sh.setRealm(realm);
            const base = Array.from(realms.realm(realm).ground.wakeAlbedo);
            for (const t of TRAILS) {
                sh.ranks[t.id] = 1;
                sh.equipTrail(t.id);
                const u = Array.from(wake.wakeUniforms.uWakeAlbedo.value);
                const mx = Math.max(...u), moved = u.some((v, i) => Math.abs(v - base[i]) > 0.02);
                if (!(mx <= 0.98 + 1e-6) || !moved) ok = false;
                rows.push(realm + ":" + t.id.slice(6) + "=" + u.map(r3).join("/"));
            }
            sh.equipTrail(null);
            const plain = Array.from(wake.wakeUniforms.uWakeAlbedo.value).map(r3);
            if (plain.join() !== base.map(r3).join()) ok = false;
        }
        sh.setRealm("cold");
        sh.equipTrail(keep);
        check("Wake trails: all 6 tint the wake in all 3 realms, every channel a valid albedo (<= 0.98); 'Plain wake' restores the realm row exactly",
            ok, rows);
    }
    // the purse readout follows
    check("shrineMenu purse + HUD counter show the live Wake Glass", $(".dwr-purse", el).textContent.indexOf(String(w.shop.glass)) >= 0
        && $("#dw-glass").textContent === String(w.shop.glass), { purse: $(".dwr-purse", el).textContent, hud: $("#dw-glass").textContent });
    // Off-shrine respec now spends the bought token.
    const r = w.boons.respec("cold.mini", 1, { atShrine: false });
    check("boons: with a token, an away-from-shrine swap spends exactly one", r.ok && w.shop.rerolls === 0 && w.boons.picks["cold.mini"] === 1,
        { r, rerolls: w.shop.rerolls });
}
{
    // CHRONICLE -> the journal's lore tab.
    const el = $("#dw-shrine");
    const i0 = w.log.length;
    dom.click($$(".dwr-navb", el)[5]);
    const ev = since(w, i0, "ui:open").find((e) => e.p && e.p.panel === "journal");
    check("shrineMenu CHRONICLE: closes the menu and emits 'ui:open' {panel:'journal', tab:'lore'}",
        !w.menu.isOpen && ev && ev.p.tab === "lore", { open: w.menu.isOpen, ev: ev && ev.p });
    // The queued Sand realm offer now opens (nothing modal is up).
    frames(w, 95);
    const opened = w.pick.isOpen;
    dom.key("Digit2");
    check("boonPick: the offer that waited behind the menu opens after it closes; key 2 takes the second boon (Sunder)",
        opened && w.boons.picks["sand.realm"] === 1 && !w.pick.isOpen && S.freezeTime === false,
        { opened, picks: w.boons.picks });
}
{
    // Spell keys reach input.js again once nothing is open.
    unpinSpell();
    dom.key("Digit1");
    check("with every modal closed, Digit1 reaches core/input.js again (Frost Arc edge = 7)", input.spellPressed === 7,
        { spellPressed: input.spellPressed });
}
function unpinSpell() { input.spellPressed = 0; }

// ------------------------------------------------ DRIFTMARK TOAST
{
    const P = w.progression;
    P.level = 30; P._refreshNeed(); P._applyLevelStats(true);
    const freeze0 = S.freezeTime, lock0 = document.pointerLockElement;
    const dm = P.data.driftmarks;
    P.addXP(Math.round(dm.baseCost * (1 + dm.growth)) + 5, "qa");   // two marks: cost(1) + cost(2)
    frames(w, 2);
    const t = $("#dw-driftmark");
    const shown = w.toast.visible && t.classList.contains("show");
    const kicker = $(".dwr-kicker", t).textContent;
    dom.key("KeyZ");
    const afterZ = Object.assign({}, w.mods.driftPicks);
    const stillUp = w.toast.visible;
    dom.click($('[data-mark="hp"]', t));
    check("Driftmark toast (post-cap, NOT a modal): 2 marks minted -> the toast shows (no pause, lock kept); Z picks Keen Mark, a click on Hale Mark picks it; hides when none pending",
        P.driftmarks === 2 && shown && kicker.indexOf(STORY.driftmarks.toast) === 0 && kicker.indexOf("2 waiting") >= 0
        && afterZ.dmg === 1 && stillUp && w.mods.driftPicks.hp === 1 && !w.toast.visible
        && S.freezeTime === freeze0 && document.pointerLockElement === lock0,
        { marks: P.driftmarks, shown, kicker, afterZ, picks: w.mods.driftPicks, visible: w.toast.visible, freeze: S.freezeTime });
}

// ------------------------------------------------ RELOAD -> CONTINUE
{
    w.progression.save();
    const before = JSON.stringify({ picks: w.boons.picks, pending: w.boons.pending, owned: w.relics.owned,
        eq: w.relics.equipped, slot3: w.relics.slot3Unlocked, glass: w.shop.glass, ranks: w.shop.ranks,
        rerolls: w.shop.rerolls, trail: w.shop.trail, drift: w.mods.driftPicks, maxHp: w.character.healthMax,
        lit: w.progression.shrinesLit });
    // a fresh page: new modules read the blob back (sections deserialize on register)
    for (const n of [...$$("#dw-boonpick"), ...$$("#dw-shrine"), ...$$("#dw-driftmark"), ...$$("#dw-glass")]) n.remove();
    w.mods.dispose(); w.boons.dispose(); w.relics.dispose(); w.shop.dispose();
    const w2 = buildWorld();
    w2.progression.level = 30; w2.progression._applyLevelStats(true);
    const after = JSON.stringify({ picks: w2.boons.picks, pending: w2.boons.pending, owned: w2.relics.owned,
        eq: w2.relics.equipped, slot3: w2.relics.slot3Unlocked, glass: w2.shop.glass, ranks: w2.shop.ranks,
        rerolls: w2.shop.rerolls, trail: w2.shop.trail, drift: w2.mods.driftPicks, maxHp: w2.character.healthMax,
        lit: w2.progression.shrinesLit });
    check("SAVE -> reload restores boons, offers, relics + slots, Wake Glass, shop ranks, rerolls, trail, Driftmark picks, lit shrines (and the same max HP)",
        before === after, { before, after });
}

// ------------------------------------------------ STEADY-FRAME ALLOCATION
// Lane Q's instrument (qa_questmachine_node.mjs B16): windows of 50k calls,
// gc before each, new-space sampled 10x per window (a drop = a scavenge ran =
// window invalid); the floor is an EMPTY loop measured the same way; pass =
// three consecutive windows at the floor (+1 KB) after V8 tiers the code up.
// A control allocating one small object per call proves the instrument sees.
if (typeof globalThis.gc === "function") {
    const v8 = await import("node:v8");
    const newSpace = () => v8.getHeapSpaceStatistics().find((s) => s.space_name === "new_space").space_used_size;
    const w3 = W;
    const { TIER } = await import("../src/combat/damageable.js");
    // Every frame-path effect live: ignite, dodge window, Wakemender, Undying,
    // chill rules, cooldown math, the vortex clock.
    for (const id of ["relic.emberCoil", "relic.scorpionsPatience", "relic.wakemender"]) {
        bus.emit("reward", { kind: "relic", id });
    }
    w3.relics.equip("relic.emberCoil", 0);
    w3.relics.equip("relic.scorpionsPatience", 1);
    w3.relics.equip("relic.wakemender", 2);
    w3.boons.respec("cold.mini", 1, { atShrine: true });
    const reg = w3.registry;
    const did = reg.register({ x: 1, y: 0, z: -3, radius: 0.5, height: 1.8, tier: TIER.MEDIUM, level: 10,
        hp: 1e12, poiseMax: 1e9, name: "QA", kind: "enemy" });
    const slot = reg.slot(did);
    const sp = w3.shrine.positions[0];
    tp(w3, sp.sx, sp.sz);                               // shrineMenu.reach resolves every frame
    // A Float64Array slot, not a `let`: a closure-captured double is boxed
    // (one HeapNumber per write) -- that would be the harness allocating.
    const sink = new Float64Array(1);
    // STEADY frames = exactly what the game calls on EVERY frame in lane R's
    // code with rewards worn and no hit landing: mods.update, the vortex
    // clock spellSystem.update reads each frame (vortex idle), and the four
    // UI polls. Hit/event paths (hitMult, cooldown at a cast, onChillHit, the
    // burn tick) are attributed separately below.
    const tick = (k) => {
        reg.update(DT);
        w3.mods.update(DT);
        sink[0] += w3.mods.vortexClock(9.0);
        w3.pick.update(DT);
        w3.toast.update(DT);
        w3.menu.update(DT);
        w3.glass.update(DT);
        reg.endFrame();
    };
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
    win(nop); win(nop);
    const floor = Math.max(win(nop), win(nop));
    // 4 KB per 50k-frame window = 0.08 B/frame: two hundred times below ONE
    // 16-byte object per frame (800 KB/window), the smallest real leak.
    const EPS = 4096;
    const warm = [];
    let reached = -1;
    for (let rep = 0; rep < 20 && reached < 0; rep++) {
        const b = win(tick);
        warm.push(b);
        if (b <= floor + EPS) reached = rep;
    }
    win(tick);                                          // one settle window after tier-up
    const steady = [win(tick), win(tick), win(tick)];
    const ring = new Array(64);
    const control = win((k) => { ring[k & 63] = { a: k, b: k + 1 }; });
    check("ALLOCATION: steady lane-R frames (mods.update with Ember Coil/Scorpion/Wakemender/Undying/Deep Chill worn, the per-frame vortexClock read, boonPick/toast/shrineMenu/glass update) allocate nothing (3 x 50k-frame windows within 4 KB of the empty-loop floor; control 1 obj/frame)",
        Number.isFinite(floor) && reached >= 0 && steady.every((b) => b <= floor + EPS)
        && Number.isFinite(control) && control > 400 * 1024 && w3.menu.reach === "cold_spawn",
        { instrumentFloor: floor, preTierUpWindows: warm, steadyWindows: steady, control, scavengedWindows: scavenged,
            reach: w3.menu.reach, sink: Number.isFinite(sink[0]) });
    // The Ember Coil burn tick (a HIT, 2 Hz per burning body): reported, not
    // hidden. ALLOC_PROFILE=1 attributes what remains to mods.update's own
    // frame: the burn's damage amount crosses into DamageableRegistry.damage
    // as a boxed double — the same per-hit cost every spell's reg.damage(id,
    // dmg, {…}) call pays (those also allocate their options literal).
    {
        const t0 = w3.mods.counters.igniteTicks;
        const burn = (k) => { reg.update(DT); if ((k & 31) === 0) w3.mods.onBoltHit(did); w3.mods.update(DT); reg.endFrame(); };
        let best = Infinity;
        for (let rep = 0; rep < 12; rep++) { const b = win(burn); if (b < best) best = b; }
        const ticks = (w3.mods.counters.igniteTicks - t0) / 12;
        console.log("INFO ALLOCATION Ember Coil burn: " + Math.max(0, best - floor) + " B over the floor per 50k frames = "
            + Math.round(Math.max(0, best - floor) / ticks * 10) / 10 + " B per ignite tick (" + Math.round(ticks) + " ticks/window)");
    }
    // Attribution: each piece alone, warmed to its own floor (reported).
    const IGN_OPT = Object.freeze({ tag: "ignite" });
    w3.mods.setRelics([null, null, null]);              // for "no burn": Ember Coil off ...
    const parts0 = {
        "mods.update (no burn)": () => { reg.update(DT); w3.mods.update(DT); reg.endFrame(); },
    };
    for (const name in parts0) {
        let best = Infinity;
        for (let rep = 0; rep < 12; rep++) { const b = win(parts0[name]); if (b < best) best = b; if (b <= floor + EPS) break; }
        console.log("ALLOC " + name + ": " + (best <= floor + EPS ? "floor" : Math.round((best - floor) / FRAMES * 10) / 10 + " B/call"));
    }
    w3.relics._apply();                                 // ... and back on
    if (process.env.ALLOC_PROFILE) {
        // Heap SAMPLING profile of the burn frames: who allocates, by stack.
        const inspector = await import("node:inspector");
        const ses = new inspector.Session();
        ses.connect();
        const post = (m, p) => new Promise((res, rej) => ses.post(m, p || {}, (e, r) => (e ? rej(e) : res(r))));
        const fn = (k) => { reg.update(DT); if ((k & 31) === 0) w3.mods.onBoltHit(did); w3.mods.update(DT); reg.endFrame(); };
        for (let rep = 0; rep < 6; rep++) win(fn);
        // Without the two include flags the sampler drops objects already
        // collected — exactly the short-lived ones a frame path leaks.
        await post("HeapProfiler.startSampling", { samplingInterval: 8,
            includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
        for (let rep = 0; rep < 6; rep++) win(fn);
        const { profile } = await post("HeapProfiler.stopSampling");
        const out = [];
        const walk = (n, stack) => {
            const s = stack.concat([n.callFrame.functionName + "@" + n.callFrame.url.split("/").pop() + ":" + (n.callFrame.lineNumber + 1)]);
            if (n.selfSize > 0) out.push([n.selfSize, s.slice(-4).join(" < ")]);
            for (const c of n.children) walk(c, s);
        };
        walk(profile.head, []);
        out.sort((a, b) => b[0] - a[0]);
        for (const [sz, st] of out.slice(0, 8)) console.log("ALLOC-PROFILE " + sz + " B  " + st);
    }
    const parts = {
        "registry.update+endFrame (not lane R; the harness clock)": () => { reg.update(DT); reg.endFrame(); },
        "mods.update (burn live)": (k) => { reg.update(DT); if ((k & 31) === 0) w3.mods.onBoltHit(did); w3.mods.update(DT); reg.endFrame(); },
        "mods.update (no burn)": () => { reg.update(DT); w3.mods.update(DT); reg.endFrame(); },
        "registry.damage alone, every 30th call (the spells' own entry point)": (k) => {
            reg.update(DT); if (k % 30 === 0) reg.damage(did, 1.5, IGN_OPT); reg.endFrame();
        },
        "mods.hitMult x2": () => { sink[0] += w3.mods.hitMult(reg, slot, 0) + w3.mods.hitMult(reg, -1, 1); },
        "mods.cooldown + vortexClock": () => { sink[0] += w3.mods.cooldown(4, 10) + w3.mods.vortexClock(1.2); },
        "mods.onChillHit (arc, Frost Nova)": () => { w3.mods.onChillHit(reg, slot, did, 5, true); reg.endFrame(); },
        "boonPick/toast/glass update": () => { w3.pick.update(DT); w3.toast.update(DT); w3.glass.update(DT); },
        "shrineMenu.update (reach scan)": () => { w3.menu.update(DT); },
    };
    const attr = {};
    for (const name in parts) {
        const fn = parts[name];
        let best = Infinity;
        for (let rep = 0; rep < 12; rep++) { const b = win(fn); if (b < best) best = b; if (b <= floor + EPS) break; }
        attr[name] = best === Infinity ? "scavenged" : (best <= floor + EPS ? "floor" : Math.round((best - floor) / FRAMES * 10) / 10 + " B/call");
    }
    console.log("ALLOC attribution (best window vs the empty-loop floor): " + JSON.stringify(attr));
} else {
    check("ALLOCATION (run node with --expose-gc)", false, "gc not exposed");
}

console.log("\n" + RESULTS.filter((r) => r[1]).length + " / " + RESULTS.length + " UI checks PASS");
process.exit(RESULTS.every((r) => r[1]) ? 0 : 1);
