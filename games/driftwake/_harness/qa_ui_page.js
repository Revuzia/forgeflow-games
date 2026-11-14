// qa_ui_page.js -- in-page step library for _harness/qa_ui.py (lane U).
// Evaluated once per page load (add_init_script); defines window.__ui with
// async steps the Python driver calls one at a time. Real KEYBOARD and MOUSE
// input comes from Python (Playwright) between the steps; every step returns
// MEASURED values (DOM text, classes, system state) for the driver to print.
//
// main.js has NO meaning-layer integration yet (the integrator's job), so
// setup() wires lanes Q, W, R and U onto the live SNOWFLOW surface exactly as
// the lane reports' hooks describe:
//   - the per-frame updates run INSIDE main's frame, at the HUD stage (a wrap
//     of SNOWFLOW.hud.update — after progression.update, before endFrame(), so
//     the E / J / M edges are still set), on the registry's GAME clock;
//   - ending.drive() runs right after rig.update (a wrap of post.update, which
//     main.js calls immediately after rig.update);
//   - the pause-on-unlock guard (`!anyModalOpen() && !input.panel`) is a wrap
//     of FFG.shell.pause, the same effect as the main.js hook.
// PROBE-ONLY: the pack/arena directors are quieted and the rider is
// invulnerable, so no fight lands on the UI measurements.
(() => {
    const U = { log: [], errors: [] };
    const base = "/games/driftwake/src/";
    const frames = (n) => new Promise((res) => {
        let k = 0;
        const tick = () => (++k >= n) ? res() : requestAnimationFrame(tick);
        requestAnimationFrame(tick);
    });
    const gameWait = (sec, wallCapS) => new Promise((res) => {
        const reg = SNOWFLOW.combat.registry, t0 = reg.time, w0 = performance.now();
        const tick = () => (reg.time - t0 >= sec || performance.now() - w0 > (wallCapS || 900) * 1000)
            ? res(reg.time - t0) : requestAnimationFrame(tick);
        tick();
    });
    const until = (pred, wallCapS) => new Promise((res) => {
        const w0 = performance.now();
        const tick = () => {
            let ok = false;
            try { ok = !!pred(); } catch (e) { ok = false; }
            if (ok) res(true);
            else if (performance.now() - w0 > (wallCapS || 900) * 1000) res(false);
            else requestAnimationFrame(tick);
        };
        tick();
    });
    const $ = (s) => document.querySelector(s);
    const txt = (s) => { const e = $(s); return e ? e.textContent : null; };
    const cls = (s, c) => { const e = $(s); return !!(e && e.classList.contains(c)); };
    const rect = (s) => {
        const e = $(s);
        if (!e) return null;
        const r = e.getBoundingClientRect();
        return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const since = (i0, t) => U.log.slice(i0).filter((e) => e[0] === t).map((e) => e[1]);
    U.frames = frames; U.gameWait = gameWait; U.until = until;

    U.setup = async () => {
        const SF = SNOWFLOW;
        if (SF.quests && SF.ui && SF.meaning) return U.setupIntegrated();
        const imp = (p) => import(base + p);
        const { bus } = await imp("quests/events.js");
        const QS = await imp("quests/questSystem.js");
        const WC = await imp("world/caches.js"), WT = await imp("world/trials.js");
        const WB = await imp("world/bounties.js"), WBe = await imp("world/beacon.js");
        const M = await imp("progression/modifiers.js"), B = await imp("progression/boons.js");
        const R = await imp("progression/relics.js"), S = await imp("progression/shop.js");
        const BP = await imp("ui/boonPick.js"), SM = await imp("ui/shrineMenu.js");
        const UT = await imp("ui/questTracker.js"), UC = await imp("ui/compass.js");
        const UD = await imp("ui/dialogue.js"), UTo = await imp("ui/toasts.js");
        const UI = await imp("ui/interact.js"), UJ = await imp("ui/journal.js");
        const UM = await imp("ui/worldMap.js"), UN = await imp("ui/introCard.js");
        const UE = await imp("ui/ending.js");
        const settings = await imp("core/settings.js");
        const P = SF.progression;
        SF.combat.encounters.update = () => {};
        SF.combat.bosses.update = () => {};
        SF.combat.enemies.clear();
        P.graceUntil = 1e12;
        const enterRealm = async (t) => { const r = await SF.enterRealm(t); bus.emit("realm:entered", { realm: t }); return r; };
        const ctx = {
            scene: SF.scene, terrain: SF.terrain, character: SF.character, rig: SF.rig, spells: SF.spells,
            spellHits: SF.combat.spellHits, registry: SF.combat.registry, enemies: SF.combat.enemies,
            encounters: SF.combat.encounters, bosses: SF.combat.bosses, portal: SF.portal, shrine: SF.shrine,
            landmarks: SF.landmarks, progression: P, realms: SF.realms, enterRealm,
            getRealm: () => SF.shrine.realm || "cold", input: SF.input, S: SF.S, set: settings.set, bus,
            crystals: SF.spells.crystals, sky: SF.sky, shadows: SF.shadows, overlay: SF.overlay,
            motes: SF.motes, wake: SF.wake, hud: SF.hud, minimap: SF.minimap,
        };
        const m = {};
        m.quests = new QS.QuestSystem(ctx);
        m.caches = new WC.RelicCaches(ctx); ctx.caches = m.caches;
        m.trials = new WT.WakeTrials(ctx); ctx.trials = m.trials;
        m.bounties = new WB.Bounties(ctx); ctx.bounties = m.bounties;
        m.beacon = new WBe.WaypointBeacon(ctx); ctx.beacon = m.beacon;
        if (m.quests.waypoint) m.beacon.set(m.quests.waypoint);
        m.mods = new M.Modifiers(ctx);
        m.relics = new R.Relics(ctx); ctx.relics = m.relics;
        m.boons = new B.Boons(ctx); ctx.boons = m.boons;
        m.shop = new S.Shop(ctx); ctx.shop = m.shop;
        m.pick = new BP.BoonPick(ctx);
        m.dtoast = new BP.DriftmarkToast(ctx);
        m.menu = new SM.ShrineMenu(ctx);
        // ---- lane U
        SF.hud.attach({ shop: m.shop, bus });
        m.tracker = new UT.QuestTracker(ctx);
        m.compass = new UC.Compass(ctx);
        m.dialogue = new UD.Dialogue(ctx); ctx.dialogue = m.dialogue;
        m.toasts = new UTo.Toasts(ctx);
        m.interact = new UI.Interact(ctx);
        m.journal = new UJ.Journal(ctx);
        m.map = new UM.WorldMap(ctx);
        m.intro = new UN.IntroCard(ctx);
        m.ending = new UE.Ending(ctx);
        SF.minimap.attachQuest(ctx);
        U.ctx = ctx; U.m = m; U.bus = bus; U.anyModalOpen = BP.anyModalOpen;
        const EVS = ["quest:step", "quest:complete", "quest:waypoint", "waypoint:pin", "dialogue", "hint",
            "hint:clear", "ui:open", "ui:close", "cache:opened", "reward", "glass:changed", "ending:begin",
            "ending:done", "shrine:activated"];
        for (const ev of EVS) bus.on(ev, (p) => U.log.push([ev, JSON.parse(JSON.stringify(p == null ? null : p))]));
        // Frame hooks (see the header).
        const reg = SF.combat.registry;
        let last = reg.time;
        const W = [m.quests, m.caches, m.trials, m.bounties, m.beacon, m.mods, m.pick, m.dtoast, m.menu,
            m.interact, m.tracker, m.compass, m.dialogue, m.toasts, m.journal, m.map, m.intro, m.ending];
        const hudUpdate = SF.hud.update.bind(SF.hud);
        SF.hud.update = function () {
            const now = reg.time;
            const dt = SF.S.freezeTime ? 0 : now - last;
            last = now;
            try { for (let i = 0; i < W.length; i++) W[i].update(dt); } catch (e) { U.errors.push(String(e && e.stack || e)); }
            hudUpdate();
        };
        const postUpdate = SF.post.update.bind(SF.post);
        SF.post.update = function (a, b, c) {
            try { m.ending.drive(); } catch (e) { U.errors.push(String(e && e.stack || e)); }
            return postUpdate(a, b, c);
        };
        const shell = globalThis.FFG && FFG.shell;
        if (shell) {
            const pause = shell.pause.bind(shell);
            U.unlockPausesBlocked = 0;
            shell.pause = function () {
                if (BP.anyModalOpen() || SF.input.panel) { U.unlockPausesBlocked++; return; }
                return pause();
            };
        }
        return { shell: shell ? shell.phase : null, sections: P._sections.map((s) => s.name),
            introPending: m.intro.pending, lockable: !!SF.input };
    };

    /**
     * [lane INT] The INTEGRATED build: main.js now constructs, orders and
     * drives every meaning-layer system itself (SNOWFLOW.quests / .world /
     * .rewards / .ui, the shared ctx on SNOWFLOW.meaning) and carries the
     * pause-on-unlock guard. Building a second set here would put two of
     * every panel on the page, so the probe REUSES main.js's systems and
     * installs no frame hooks of its own. The probe-only isolation (quiet
     * directors, invulnerable rider) and the event log are unchanged.
     */
    U.setupIntegrated = async () => {
        const SF = SNOWFLOW;
        const { bus } = await import(base + "quests/events.js");
        const BP = await import(base + "ui/boonPick.js");
        const P = SF.progression;
        SF.combat.encounters.update = () => {};
        SF.combat.bosses.update = () => {};
        SF.combat.enemies.clear();
        P.graceUntil = 1e12;
        const W = SF.world, R = SF.rewards, I = SF.ui;
        const m = {
            quests: SF.quests, caches: W.caches, trials: W.trials, bounties: W.bounties, beacon: W.beacon,
            mods: R.mods, relics: R.relics, boons: R.boons, shop: R.shop, pick: R.boonPick, dtoast: R.driftToast,
            menu: R.shrineMenu, tracker: I.questTracker, compass: I.compass, dialogue: I.dialogue, toasts: I.toasts,
            interact: I.interact, journal: I.journal, map: I.worldMap, intro: I.introCard, ending: I.ending,
        };
        U.ctx = SF.meaning; U.m = m; U.bus = bus; U.anyModalOpen = BP.anyModalOpen;
        const EVS = ["quest:step", "quest:complete", "quest:waypoint", "waypoint:pin", "dialogue", "hint",
            "hint:clear", "ui:open", "ui:close", "cache:opened", "reward", "glass:changed", "ending:begin",
            "ending:done", "shrine:activated"];
        for (const ev of EVS) bus.on(ev, (p) => U.log.push([ev, JSON.parse(JSON.stringify(p == null ? null : p))]));
        // Count unlock-pauses the guard lets through (main.js's guard blocks
        // the call before it reaches the shell, so this stays a spy only).
        const shell = globalThis.FFG && FFG.shell;
        if (shell) {
            const pause = shell.pause.bind(shell);
            U.unlockPausesBlocked = 0;
            shell.pause = function () {
                if (BP.anyModalOpen() || SF.input.panel) { U.unlockPausesBlocked++; return; }
                return pause();
            };
        }
        return { integrated: true, shell: shell ? shell.phase : null, sections: P._sections.map((s) => s.name),
            introPending: m.intro.pending, lockable: !!SF.input };
    };

    /** The HUD shows only under pointer lock; under automation the lock may
     *  not come — pin `input.locked` (a plain data property) so the HUD can be
     *  SEEN for the screenshots. Reported every time it is used. */
    U.ensureHud = async () => {
        const inp = SNOWFLOW.input;
        const was = inp.locked;
        if (!inp.locked) inp.locked = true;
        await frames(2);
        return { lockedReally: !!document.pointerLockElement, pinned: !was };
    };

    U.state = () => {
        const m = U.m, SF = SNOWFLOW;
        return {
            shell: globalThis.FFG && FFG.shell ? FFG.shell.phase : null, freeze: SF.S.freezeTime,
            panel: SF.input.panel, locked: SF.input.locked, pointerLock: !!document.pointerLockElement,
            intro: { open: m.intro.isOpen, shown: m.intro.stats.linesShown, cls: cls("#dw-intro", "open") },
            journal: m.journal.isOpen, map: m.map.isOpen, menu: m.menu.isOpen, modal: U.anyModalOpen(),
            ending: m.ending.phase, unlockPausesBlocked: U.unlockPausesBlocked, errors: U.errors.slice(0, 3),
        };
    };

    U.tracker = () => ({
        show: cls("#dw-tracker", "show"), kicker: txt("#dw-tracker .qt-kicker"), title: txt("#dw-tracker .qt-title"),
        text: txt("#dw-tracker .qt-text"), under: txt("#dw-tracker .qt-under"), label: txt("#dw-tracker .qt-label"),
        dist: txt("#dw-tracker .qt-dist"), count: txt("#dw-tracker .qt-count"), side: txt("#dw-tracker .qt-side"),
        tracked: U.m.quests.tracked && U.m.quests.tracked.stepId, wp: U.m.quests.waypoint,
    });

    U.tp = async (x, z, yaw) => {
        const SF = SNOWFLOW, c = SF.character;
        c.position.set(x, SF.terrain.heightAt(x, z), z);
        c.velocity.set(0, 0, 0);
        if (yaw !== undefined) { c.facing = yaw; SF.rig.yaw = yaw; }
        SF.rig._first = true;
        await frames(3);
    };

    U.touchSpawn = async () => {
        const i0 = U.log.length;
        const sp = SNOWFLOW.shrine.positions[0];
        await U.tp(sp.sx, sp.sz, Math.atan2(sp.x - sp.sx, -(sp.z - sp.sz)));
        const ok = await until(() => U.m.quests.main.cold >= 1, 600);
        await frames(2);
        return {
            completed: ok, events: since(i0, "quest:complete").map((p) => p.stepId),
            dialogues: since(i0, "dialogue").map((p) => p.id),
            banner: { show: cls("#dw-banner", "show"), kick: txt("#dw-banner .tb-kick"), title: txt("#dw-banner .tb-title"),
                rew: txt("#dw-banner .tb-rew") },
            dialogue: { show: cls("#dw-dialogue", "show"), who: txt("#dw-dialogue .dl-who"),
                text: txt("#dw-dialogue .dl-text"), current: U.m.dialogue.current && U.m.dialogue.current.id,
                revealed: U.m.dialogue._revealed, len: U.m.dialogue._len },
            toasts: U.m.toasts.live.map((t) => t.el.textContent),
            reach: U.m.menu.reach,
        };
    };

    U.journal = () => ({
        open: U.m.journal.isOpen, cls: cls("#dw-journal", "open"), tab: U.m.journal.tab,
        tabs: Array.from(document.querySelectorAll("#dw-journal .dwu-tab")).map((b) => b.textContent + (b.classList.contains("cur") ? "*" : "")),
        body: (txt("#dw-journal .dwu-body") || "").slice(0, 900),
        rows: Array.from(document.querySelectorAll("#dw-journal .dwu-row")).slice(0, 24).map((r) =>
            (r.classList.contains("done") ? "[x] " : r.classList.contains("cur") ? "[>] " : "[ ] ") + r.textContent.slice(0, 80)),
    });

    U.map = () => {
        const mk = U.m.map.markers;
        return { open: U.m.map.isOpen, counts: mk && mk.counts, title: txt("#dw-map .dwu-title"),
            legend: txt("#dw-map .dwm-legend"), stage: rect("#dw-map .dwm-stage"), size: U.m.map._size,
            bakes: U.m.map.stats.bakes, mark: cls("#dw-map .dwm-mark", "on") ? txt("#dw-map .dwm-mn") : null };
    };

    /** Screen point (CSS px) of the nearest DORMANT shrine on the map stage. */
    U.mapShrinePoint = () => {
        const m = U.m.map, mk = m.markers, st = $("#dw-map .dwm-stage").getBoundingClientRect();
        const R = SNOWFLOW.terrain.playRadius || 620;
        const d = mk.shrines.find((s) => s.s === 0);
        const px = ((d.x / R) * 0.5 + 0.5) * st.width, py = ((d.z / R) * 0.5 + 0.5) * st.height;
        return { id: d.id, label: d.label, x: Math.round(st.left + px), y: Math.round(st.top + py), wx: d.x, wz: d.z };
    };

    U.pin = () => ({ pin: Object.assign({}, U.m.tracker.pin), target: Object.assign({}, U.m.tracker.target),
        beacon: { on: U.m.beacon.target.on, x: U.m.beacon.target.x, z: U.m.beacon.target.z },
        label: txt("#dw-tracker .qt-label"), minimapWp: SNOWFLOW.minimap.questStats.wp });

    U.faceAwayFromTarget = async () => {
        const t = U.m.tracker.target, c = SNOWFLOW.character;
        const toward = Math.atan2(t.x - c.position.x, -(t.z - c.position.z));
        c.facing = toward + Math.PI; SNOWFLOW.rig.yaw = toward + Math.PI;
        await frames(4);
        return { compassShow: cls("#dw-compass", "show"), px: U.m.compass.stats.px, rel: U.m.compass.stats.rel,
            chevron: cls("#dw-compass", "left") ? "left" : cls("#dw-compass", "right") ? "right" : "down",
            dist: txt("#dw-compass .cp-dist"), rect: rect("#dw-compass .cp-tick") };
    };

    U.toCache = async (kind) => {
        const C = U.m.caches;
        await until(() => C.readyRealm === "cold", 600);
        const L = C.list("cold");
        const site = L.find((c) => c.kind === kind && !c.opened);
        if (!site) return { err: "no unopened " + kind };
        await U.tp(C.x[site.site] + 1.2, C.z[site.site], SNOWFLOW.rig.yaw);
        await until(() => C.interactTarget === site.site, 120);
        return { site: site.site, target: C.interactTarget, glass: U.m.shop.glass };
    };

    U.toasts = () => ({
        live: U.m.toasts.live.map((t) => t.el.textContent), hud: txt("#hud .hud-glass-n"), wallet: U.m.shop.glass,
        last: U.m.interact.stats.last, hudGlassShown: cls("#hud", "glass"),
    });

    /** Every lane-U element forced visible, then rect intersections against
     *  the reserved HUD (vitals, minimap, spellbar, XP bar, boss frame). */
    U.layout = async () => {
        const m = U.m;
        // Content in every box.
        m.dialogue.say({ speaker: "The Echo", lines: ["Every anchor you wake pulls the shards a little closer. Ride on, Wakecaster, and listen."], id: "qa.layout" });
        m.toasts.push("relic", "Relic Found", "Rime Heart", "Chill lasts +1 s");
        m.toasts.push("shrine", "Shrine Awakened", "The First Stone", "");
        m.toasts.push("glass", "+73 Wake Glass", "", "");
        m.toasts.push("trial m3", "Gold Medal — Rime Circle Run", "", "29.8 s  ·  new best");
        U.bus.emit("quest:complete", { realm: "cold", stepId: "qa", title: "Wake the Anchors", xp: 120, rewards: [] });
        U.bus.emit("hint", { id: "qa.hint", text: "J — Journal, M — Map, E — Interact", ttl: 0 });
        await frames(3);
        const force = ["#dw-tracker", "#dw-dialogue", "#dw-toasts", "#dw-banner", "#dw-hints", "#dw-compass", "#dw-prompt"];
        for (const s of force) { const e = $(s); if (e) e.classList.add("show"); }
        const bb = $("#enemybars .bossbar"); if (bb) bb.classList.add("on");
        await frames(2);
        const mine = { tracker: rect("#dw-tracker"), dialogue: rect("#dw-dialogue"), toasts: rect("#dw-toasts"),
            banner: rect("#dw-banner"), hints: rect("#dw-hints"), compass: rect("#dw-compass .cp-tick svg") || rect("#dw-compass"),
            prompt: rect("#dw-prompt") };
        const reserved = { vitals: rect("#hud"), minimap: rect("#minimap"), spellbar: rect("#spellbar"),
            xpbar: rect("#xphud"), bossbar: rect("#enemybars .bossbar"), trialTimer: rect("#wa-trial") };
        const hit = (a, b) => a && b && a.w > 0 && a.h > 0 && b.w > 0 && b.h > 0 &&
            a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        const overlaps = [];
        for (const a in mine) for (const b in reserved) if (hit(mine[a], reserved[b])) overlaps.push(a + " x " + b);
        const names = Object.keys(mine);
        for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
            if (hit(mine[names[i]], mine[names[j]])) overlaps.push(names[i] + " x " + names[j]);
        }
        return { viewport: [innerWidth, innerHeight], mine, reserved, overlaps };
    };
    U.layoutClear = async () => {
        const force = ["#dw-tracker", "#dw-dialogue", "#dw-toasts", "#dw-banner", "#dw-hints", "#dw-compass", "#dw-prompt"];
        for (const s of force) { const e = $(s); if (e) e.classList.remove("show"); }
        const bb = $("#enemybars .bossbar"); if (bb) bb.classList.remove("on");
        U.m.dialogue.clear();
        U.bus.emit("hint:clear", { id: "qa.hint" });
        await frames(2);
        return true;
    };

    U.endingBegin = async () => {
        const S = SNOWFLOW.S;
        U.lightBefore = { exposure: S.exposure, bloom: S.bloomStrength, warm: S.sunTempWarm, el: S.sunElevation, freeze: S.freezeTime };
        U.camBefore = SNOWFLOW.rig.camera.position.toArray().map((v) => Math.round(v * 10) / 10);
        U.i0End = U.log.length;
        U.bus.emit("ending:begin", { echoId: "echo.ash.6", lines: (await import(base + "quests/storyText.js")).STORY.ending.echo });
        await frames(2);
        return U.ending();
    };
    U.ending = () => {
        const S = SNOWFLOW.S, e = U.m.ending;
        return { phase: e.phase, line: txt("#dw-ending .en-line"), freeze: S.freezeTime, panel: SNOWFLOW.input.panel,
            letter: cls("#dw-ending", "letter"), card: cls("#dw-ending", "card"), credits: cls("#dw-ending", "credits"),
            cinematic: document.body.classList.contains("dw-cinematic"),
            hudHidden: getComputedStyle(document.getElementById("hud")).visibility === "hidden",
            cam: SNOWFLOW.rig.camera.position.toArray().map((v) => Math.round(v * 10) / 10),
            light: { exposure: S.exposure, bloom: S.bloomStrength, warm: S.sunTempWarm, el: S.sunElevation },
            drives: e.stats.drives, phases: e.stats.phases.slice(),
            anchor: { x: Math.round(e._anchor.x * 10) / 10, y: Math.round(e._anchor.y * 10) / 10, z: Math.round(e._anchor.z * 10) / 10 } };
    };
    U.endingDone = () => {
        const S = SNOWFLOW.S;
        const after = { exposure: S.exposure, bloom: S.bloomStrength, warm: S.sunTempWarm, el: S.sunElevation, freeze: S.freezeTime };
        return { before: U.lightBefore, after, restored: JSON.stringify(after) === JSON.stringify(U.lightBefore),
            done: since(U.i0End, "ending:done"), panel: SNOWFLOW.input.panel, phase: U.m.ending.phase,
            cinematic: document.body.classList.contains("dw-cinematic"),
            hudHidden: getComputedStyle(document.getElementById("hud")).visibility === "hidden" };
    };

    window.__ui = U;
})();
