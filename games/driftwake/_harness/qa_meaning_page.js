// qa_meaning_page.js -- in-page step library for _harness/qa_meaning.py (lane INT).
// Evaluated on every page load (add_init_script); defines window.__M with async
// steps the Python driver calls one at a time. The game is the REAL integrated
// build: main.js constructs and drives every meaning-layer system itself
// (SNOWFLOW.quests / .world / .rewards / .ui) — NOTHING here constructs,
// wraps or re-orders a game system. The Python side supplies the REAL inputs
// (the PLAY / CONTINUE clicks, the E / J / M / Esc / digit keys, the mouse
// clicks on the boon cards and the shrine menu).
//
// SCRIPTED SHORTCUTS (each is reported by the step that uses it):
//   - input.locked is pinned true (Playwright never acquires a real pointer
//     lock; the HUD only shows under lock) — pin(), reported by the driver;
//   - movement / surf / bolt input is PINNED on `SNOWFLOW.input` (moveZ, surf,
//     boltHeld) and the heading is steered by writing rig.yaw each frame;
//   - long trips (ring shrines, arenas, bounty sites, the portal) are
//     teleports onto the real stand points / approach points;
//   - kills that the starved machine cannot fight in real time go through
//     registry.damage() — the real damage / kill-event path;
//   - the rider is made invulnerable (progression.graceUntil);
//   - the intro card's wall clock is probe-controlled (introClock), as in
//     lane U's qa_ui.py, because at < 1 fps its 9.4 s timeline would run out
//     inside one probe round trip.
(() => {
    const M = { log: [], errors: [], steer: null, ticks: 0 };
    window.__M = M;
    addEventListener("error", (e) => M.errors.push("error: " + String(e.message)));
    addEventListener("unhandledrejection", (e) => M.errors.push("reject: " + String(e.reason)));

    const SF = () => globalThis.SNOWFLOW;
    const reg = () => SF().combat.registry;

    // ENVIRONMENT GUARD (run 1, 2026-10-01): mid-run the FFG shell PAUSED by
    // itself (shot meaning_13_trial: the pause menu) and every later game-time
    // wait hit its wall cap. The designed trigger is a lost pointer lock (a
    // keydown is a user gesture, so a shrine menu's close re-lock can really
    // succeed; another session's window taking focus then drops it). Every
    // pointer-lock change and window blur is LOGGED here with its time, and a
    // pause the probe did not ask for is undone through the shell's own
    // resume() (what the RESUME button calls) — each one reported.
    M.lockLog = [];
    M.autoResumes = [];
    M.allowPause = false;
    document.addEventListener("pointerlockchange", () => M.lockLog.push({ ev: "pointerlockchange",
        locked: !!document.pointerLockElement, wallS: +(performance.now() / 1000).toFixed(1),
        phase: globalThis.FFG && FFG.shell ? FFG.shell.phase : null }));
    addEventListener("blur", () => M.lockLog.push({ ev: "blur", wallS: +(performance.now() / 1000).toFixed(1) }));
    addEventListener("focus", () => M.lockLog.push({ ev: "focus", wallS: +(performance.now() / 1000).toFixed(1) }));
    const guardPause = () => {
        const sh = globalThis.FFG && FFG.shell;
        if (!sh || M.allowPause || sh.phase !== "paused") return;
        M.autoResumes.push({ wallS: +(performance.now() / 1000).toFixed(1),
            gameT: globalThis.SNOWFLOW ? +reg().time.toFixed(2) : null, lastLock: M.lockLog.slice(-3) });
        try { sh.resume(); } catch (e) { M.errors.push("resume: " + String(e)); }
    };
    const frames = (n) => new Promise((res) => {
        let k = 0;
        const tick = () => (++k >= n) ? res() : requestAnimationFrame(tick);
        requestAnimationFrame(tick);
    });
    /** Wait `sec` of GAME time (registry clock), wall backstop `wallS`. */
    const gameWait = (sec, wallS) => new Promise((res) => {
        const r = reg(), t0 = r.time, w0 = performance.now();
        const tick = () => {
            guardPause();
            if (r.time - t0 >= sec || performance.now() - w0 > (wallS || 900) * 1000) res(+(r.time - t0).toFixed(3));
            else requestAnimationFrame(tick);
        };
        tick();
    });
    /** Poll `pred` every frame until true, `sec` of GAME time or `wallS` wall. */
    const until = (pred, sec, wallS) => new Promise((res) => {
        const r = reg(), t0 = r.time, w0 = performance.now();
        const tick = () => {
            guardPause();
            let ok = false;
            try { ok = !!pred(); } catch (e) { ok = false; }
            const g = r.time - t0;
            if (ok) return res({ ok: true, gameS: +g.toFixed(2), wallS: +((performance.now() - w0) / 1000).toFixed(1) });
            if (g >= sec || performance.now() - w0 > (wallS || 900) * 1000) {
                return res({ ok: false, gameS: +g.toFixed(2), wallS: +((performance.now() - w0) / 1000).toFixed(1) });
            }
            requestAnimationFrame(tick);
        };
        tick();
    });
    const r1 = (v) => Math.round(v * 10) / 10;
    const r4 = (v) => Math.round(v * 10000) / 10000;
    const $ = (s) => document.querySelector(s);
    const txt = (s) => { const e = $(s); return e ? e.textContent : null; };
    const cls = (s, c) => { const e = $(s); return !!(e && e.classList.contains(c)); };
    const since = (i0, t) => M.log.slice(i0).filter((e) => !t || e.t === t);
    M.frames = frames; M.gameWait = gameWait; M.until = until;

    // ------------------------------------------------------------ the steer hook
    // One rAF loop of the probe's own (it never touches a game system's order):
    // runs `M.steer()` once per frame when set.
    const loop = () => {
        M.ticks++;
        if (M.steer) { try { M.steer(); } catch (e) { M.errors.push("steer: " + String(e && e.stack || e)); M.steer = null; } }
        requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);

    M.pin = (name, val) => Object.defineProperty(SF().input, name,
        { configurable: true, enumerable: true, get: () => val, set: () => {} });
    M.unpin = (name, val) => Object.defineProperty(SF().input, name,
        { configurable: true, enumerable: true, writable: true, value: val });
    M.tp = (x, z, yaw) => {
        const c = SF().character;
        c.position.set(x, SF().terrain.heightAt(x, z), z);
        c.velocity.set(0, 0, 0);
        if (yaw !== undefined) { c.facing = yaw; SF().rig.yaw = yaw; }
        SF().rig._first = true;
    };
    const yawTo = (x, z) => { const p = SF().character.position; return Math.atan2(x - p.x, -(z - p.z)); };
    const dist = (x, z) => { const p = SF().character.position; return Math.hypot(x - p.x, z - p.z); };

    // ---------------------------------------------------------------- setup
    M.setup = () => {
        const S = SF();
        const bus = S.bus;
        const EV = ["quest:step", "quest:complete", "quest:waypoint", "dialogue", "hint", "hint:clear",
            "shrine:activated", "enemy:killed", "boss:killed", "portal:entered", "player:levelup", "player:died",
            "realm:entered", "cache:opened", "cache:discovered", "trial:started", "trial:gate", "trial:finished",
            "trial:failed", "bounty:revealed", "bounty:killed", "reward", "boon:offer", "boon:chosen",
            "relic:equipped", "glass:changed", "shop:bought", "shrine:travelled", "ui:open", "ui:close",
            "ending:begin", "ending:done", "waypoint:pin"];
        for (const t of EV) {
            bus.on(t, (p) => M.log.push({ t, p: p == null ? null : JSON.parse(JSON.stringify(p)),
                g: +reg().time.toFixed(2) }));
        }
        return {
            shell: globalThis.FFG && FFG.shell ? FFG.shell.phase : null,
            freeze: S.S.freezeTime,
            systems: {
                quests: !!S.quests, world: Object.keys(S.world || {}), rewards: Object.keys(S.rewards || {}),
                ui: Object.keys(S.ui || {}), bus: !!S.bus, meaning: S.meaning ? Object.keys(S.meaning).length : 0,
            },
            gateInstalled: typeof S.combat.bosses.questGate === "function",
            sections: S.progression._sections ? S.progression._sections.map((s) => s.name) : null,
            introPending: S.ui.introCard.pending, introSeen: S.ui.introCard.seen,
            hint: txt("#hint"),
        };
    };

    M.fps = async (wallMs) => {
        const r = reg(), g0 = r.time, w0 = performance.now();
        let n = 0;
        await new Promise((res) => {
            const tick = () => { n++; if (performance.now() - w0 >= (wallMs || 10000)) res(); else requestAnimationFrame(tick); };
            requestAnimationFrame(tick);
        });
        const wall = (performance.now() - w0) / 1000;
        return { frames: n, wallS: +wall.toFixed(1), fps: +(n / wall).toFixed(2), gameSPerWallS: +((r.time - g0) / wall).toFixed(3) };
    };

    /** Probe-controlled clock for the intro card (see the header). */
    M.introClockOn = () => { M.introClock = 0; SF().ui.introCard.now = () => M.introClock; return true; };
    M.intro = () => {
        const I = SF().ui.introCard;
        return { open: I.isOpen, cls: cls("#dw-intro", "open"), shown: I.stats.linesShown, skipped: I.stats.skipped,
            freeze: SF().S.freezeTime, panel: SF().input.panel, seen: I.seen, pending: I.pending,
            lines: Array.from(document.querySelectorAll("#dw-intro .in-line")).map((l) => l.textContent),
            shell: globalThis.FFG && FFG.shell ? FFG.shell.phase : null };
    };

    /** After PLAY: invulnerable rider (reported), HUD pinned visible. */
    M.afterPlay = () => {
        const S = SF();
        S.progression.graceUntil = 1e12;
        const real = !!document.pointerLockElement;
        M.pin("locked", true);
        M.tPlay = reg().time;
        return { realPointerLock: real, pinnedLocked: true, tPlayGame: +M.tPlay.toFixed(2),
            level: S.progression.level, xp: S.progression.xp, testMode: S.progression.testMode };
    };

    M.tracker = () => ({
        show: cls("#dw-tracker", "show"), kicker: txt("#dw-tracker .qt-kicker"), title: txt("#dw-tracker .qt-title"),
        text: txt("#dw-tracker .qt-text"), under: txt("#dw-tracker .qt-under"), label: txt("#dw-tracker .qt-label"),
        dist: txt("#dw-tracker .qt-dist"), count: txt("#dw-tracker .qt-count"),
        tracked: SF().quests.tracked ? SF().quests.tracked.stepId : null, main: Object.assign({}, SF().quests.main),
        wp: SF().quests.waypoint,
    });

    // ---------------------------------------------------------------- cold.1
    M.walkToSpawn = async () => {
        const S = SF(), Q = S.quests, sp = S.shrine.positions[0], i0 = M.log.length;
        const d0 = dist(sp.x, sp.z);
        M.pin("moveZ", 1);
        M.steer = () => { S.rig.yaw = yawTo(sp.x, sp.z); };
        const u = await until(() => Q.main.cold >= 1, 20, 900);
        M.steer = null;
        M.unpin("moveZ", 0);
        let method = "walked";
        if (!u.ok) {                        // fallback: the stand point
            M.tp(sp.sx, sp.sz, yawTo(sp.x, sp.z));
            await until(() => Q.main.cold >= 1, 5, 600);
            method = "teleported (walk did not reach)";
        }
        await gameWait(0.4, 300);
        return { method, walk: u, startDistToAnchor: r1(d0), main: Object.assign({}, Q.main),
            completed: since(i0, "quest:complete").map((e) => e.p.stepId + " +" + e.p.xp + "xp"),
            dialogues: since(i0, "dialogue").map((e) => e.p.id),
            shrineEvents: since(i0, "shrine:activated").map((e) => e.p.realm + ":" + e.p.id) };
    };

    M.echo = () => ({
        show: cls("#dw-dialogue", "show"), who: txt("#dw-dialogue .dl-who"), text: txt("#dw-dialogue .dl-text"),
        current: SF().ui.dialogue.current ? SF().ui.dialogue.current.id : null,
        queued: (SF().ui.dialogue.queue || []).map((q) => q.id),
        banner: { show: cls("#dw-banner", "show"), title: txt("#dw-banner .tb-title"), rew: txt("#dw-banner .tb-rew") },
        toasts: SF().ui.toasts.live ? SF().ui.toasts.live.map((t) => t.el.textContent) : null,
        hints: txt("#dw-hints"),
    });

    // ---------------------------------------------------------------- cold.2
    M.surf150 = async () => {
        const S = SF(), Q = S.quests, c = S.character, i0 = M.log.length;
        const x0 = c.position.x, z0 = c.position.z, s0 = Q.surfM;
        // Ride AWAY from the shrine, toward the centre of the disc's open side.
        const sp = S.shrine.positions[0];
        const yaw0 = Math.atan2(c.position.x - sp.x, -(c.position.z - sp.z));
        M.pin("surf", true);
        M.pin("moveZ", 1);
        // Up to four headings, 30 game-s each: a line that runs into a rise
        // or the storm edge stalls the carve, so the rider turns 90 degrees.
        let u = null;
        const headings = [];
        for (let h = 0; h < 4 && Q.main.cold < 2; h++) {
            const yaw = yaw0 + h * Math.PI / 2;
            S.rig.yaw = yaw; c.facing = yaw;
            headings.push(r1(yaw));
            u = await until(() => Q.main.cold >= 2, 30, 900);
        }
        M.unpin("surf", false);
        M.unpin("moveZ", 0);
        await gameWait(0.5, 300);
        return { until: u, headings, surfedM: r1(Q.surfM - s0), displacementM: r1(Math.hypot(c.position.x - x0, c.position.z - z0)),
            main: Object.assign({}, Q.main), maxSpeedNow: r1(c.speed),
            completed: since(i0, "quest:complete").map((e) => e.p.stepId),
            hints: since(i0, "hint").map((e) => e.p.id), packSpawns: Q.packSpawns };
    };

    // ---------------------------------------------------------------- cold.3
    M.killPack = async () => {
        const S = SF(), Q = S.quests, r = reg(), c = S.character, i0 = M.log.length;
        const sp = await until(() => Q.packSpawns >= 1, 6, 600);
        const live = () => Array.from(Q._forced).filter((id) => { const s = r.slot(id); return s >= 0 && r.hp[s] > 0; });
        const nearest = () => {
            let best = null, bd = 1e9;
            for (const id of live()) {
                const s = r.slot(id), d = dist(r.x[s], r.z[s]);
                if (d < bd) { bd = d; best = { id, s, d }; }
            }
            return best;
        };
        const packAt = { x: r1(Q.packX), z: r1(Q.packZ), dist: r1(dist(Q.packX, Q.packZ)) };
        // SURF at the pack (the core verb) until one is close.
        M.pin("moveZ", 1);
        M.pin("surf", true);
        M.steer = () => { const n = nearest(); if (n) S.rig.yaw = yawTo(r.x[n.s], r.z[n.s]); };
        const ap = await until(() => { const n = nearest(); return !n || n.d < 12; }, 25, 1200);
        M.unpin("surf", false);
        M.unpin("moveZ", 0);
        // REAL spells: LMB held (pinned) = the bolt on its fire cycle, and
        // the Frost Arc (key 1) cast through the spell system's own entry
        // point whenever its cooldown allows — what the onboarding prompts
        // ("LMB — bolt", "1 — Frost Arc") teach. Yaw on the nearest imp; the
        // spell system's aim and assist do the rest.
        const hpOf = () => { let h = 0; for (const id of Q._forced) { const s = r.slot(id); if (s >= 0 && r.hp[s] > 0) h += r.hp[s]; } return h; };
        const hp0 = hpOf();
        const killsBefore = Q.killsForOnboarding;
        const g0 = r.time;
        M.pin("boltHeld", true);
        M.steer = () => {
            const n = nearest();
            if (n) S.rig.yaw = yawTo(r.x[n.s], r.z[n.s]);
            if (n && n.d < 9) S.spells.cast(7);
        };
        const bolts = await until(() => Q.main.cold >= 3 || live().length === 0, 25, 1500);
        M.steer = null;
        M.unpin("boltHeld", false);
        const boltKills = Q.killsForOnboarding - killsBefore;
        const spellDamage = { packHpBefore: r1(hp0), packHpAfter: r1(hpOf()), gameS: +(r.time - g0).toFixed(2) };
        // Whatever is still standing (the starved box cannot fight it out in
        // real time): the real damage path.
        let scripted = 0;
        if (Q.main.cold < 3) {
            for (const id of live()) {
                const s = r.slot(id);
                r.damage(id, r.hp[s] + 1, { tag: "probe" });
                scripted++;
                await gameWait(0.3, 300);
                if (Q.main.cold >= 3) break;
            }
        }
        const u = await until(() => Q.main.cold >= 3, 8, 600);
        await gameWait(0.5, 300);
        const lv = M.log.filter((e) => e.t === "player:levelup");
        return { packSpawned: sp, packAt, approach: ap, bolts, boltKills, spellDamage, scriptedKills: scripted,
            killsForOnboarding: Q.killsForOnboarding, until: u, main: Object.assign({}, Q.main),
            level: S.progression.level, xp: S.progression.xp,
            firstDingGameS: lv.length ? +(lv[0].g - M.tPlay).toFixed(2) : null,
            levelups: lv.map((e) => e.p.level),
            completed: since(i0, "quest:complete").map((e) => e.p.stepId),
            hints: since(i0, "hint").map((e) => e.p.id) };
    };

    // ------------------------------------------------- waypoint / beacon / compass
    M.nearestDormant = () => {
        const S = SF(), P = S.progression, realm = S.meaning.getRealm();
        let best = null, bd = 1e18;
        for (let i = 1; i < S.shrine.positions.length; i++) {
            const p = S.shrine.positions[i];
            if (P.isShrineLit(realm, p.id)) continue;
            const d = dist(p.x, p.z);
            if (d < bd) { bd = d; best = p; }
        }
        return best;
    };
    M.waypointCheck = async () => {
        const S = SF(), Q = S.quests, B = S.world.beacon, T = S.ui.questTracker;
        await gameWait(0.6, 300);                     // > one 0.25 s waypoint poll
        const want = M.nearestDormant();
        const wp = Q.waypoint;
        const out = {
            step: Q.tracked && Q.tracked.stepId, waypoint: wp,
            nearestDormant: want ? { id: want.id, x: r1(want.x), z: r1(want.z), d: r1(dist(want.x, want.z)) } : null,
            waypointIsNearestDormant: !!(want && wp && Math.abs(wp.x - want.x) < 0.05 && Math.abs(wp.z - want.z) < 0.05),
            beacon: { on: B.target.on, x: r1(B.target.x), z: r1(B.target.z), visible: B.mesh.visible },
            beaconOnIt: !!(want && B.target.on && Math.abs(B.target.x - want.x) < 0.05 && Math.abs(B.target.z - want.z) < 0.05),
            trackerTarget: T.target ? { x: r1(T.target.x), z: r1(T.target.z) } : null,
            trackerLabel: txt("#dw-tracker .qt-label"), trackerDist: txt("#dw-tracker .qt-dist"),
        };
        // Compass: face AWAY from it, then toward it.
        const c = S.character;
        const toward = yawTo(want.x, want.z);
        S.rig.yaw = toward + Math.PI; c.facing = S.rig.yaw;
        await frames(4);
        const cs = S.ui.compass.stats;
        out.compassAway = { shown: cls("#dw-compass", "show"), px: cs.px, rel: r4(cs.rel),
            side: cls("#dw-compass", "left") ? "left" : cls("#dw-compass", "right") ? "right" : "none",
            dist: txt("#dw-compass .cp-dist") };
        S.rig.yaw = toward - Math.PI / 2; c.facing = S.rig.yaw;   // target on the RIGHT
        await frames(4);
        out.compassRight = { shown: cls("#dw-compass", "show"), px: S.ui.compass.stats.px, rel: r4(S.ui.compass.stats.rel) };
        S.rig.yaw = toward; c.facing = S.rig.yaw;
        await frames(4);
        out.compassToward = { shown: cls("#dw-compass", "show"), rel: r4(S.ui.compass.stats.rel) };
        return out;
    };
    M.faceWaypoint = async () => {
        const S = SF(), wp = S.quests.waypoint;
        if (wp) { S.rig.yaw = yawTo(wp.x, wp.z); S.character.facing = S.rig.yaw; }
        await frames(3);
        return { wp };
    };

    // ---------------------------------------------------------------- gating
    M.gateSample = async (n, every) => {
        const S = SF(), B = S.combat.bosses, Q = S.quests;
        const out = [];
        for (let i = 0; i < n; i++) {
            out.push({ state: B.state, kind: B.kind, eligible: B._eligibleKind(), questMini: Q.bossUnlocked("cold", "mini"),
                floorMini: B.meetsFloor("mini") });
            await gameWait(every, 300);
        }
        return { samples: out.length, armed: out.filter((s) => s.state !== "idle" || s.eligible !== null).length,
            questGateOpen: out.filter((s) => s.questMini).length, floorMet: out.filter((s) => s.floorMini).length,
            first: out[0], last: out[out.length - 1], level: S.progression.level, testMode: S.progression.testMode,
            tracker: txt("#dw-tracker .qt-text"), under: txt("#dw-tracker .qt-under") };
    };
    M.testOn = () => SF().test(true);

    // ---------------------------------------------------------------- caches
    M.toCache = async (kind, nth) => {
        const S = SF(), C = S.world.caches;
        const rd = await until(() => C.readyRealm === S.meaning.getRealm(), 120, 900);
        const L = C.list();
        const of = L.filter((c) => c.kind === kind);
        const site = of[nth || 0];
        if (!site) return { err: "no cache of kind " + kind, ready: rd };
        M.tp(C.x[site.site] + 1.2, C.z[site.site], S.rig.yaw);
        const near = await until(() => C.interactTarget === site.site, 10, 600);
        M.i0 = M.log.length;
        M.glass0 = S.rewards.shop.glass;
        M.relics0 = S.rewards.relics.owned.slice();
        return { kind, site: site.site, opened: site.opened, landmark: site.landmark, ready: rd, near,
            prompt: cls("#wa-prompt", "show") || cls(".wa-prompt", "show"), glassBefore: M.glass0 };
    };
    M.afterCache = async (site) => {
        const S = SF(), C = S.world.caches;
        const u = await until(() => C.isOpened(C.realm, site), 6, 600);
        await gameWait(0.4, 300);
        const ev = since(M.i0).filter((e) => e.t === "cache:opened" || e.t === "reward" || e.t === "glass:changed");
        return { opened: u, interact: S.ui.interact.stats.last, events: ev.map((e) => e.t + " " + JSON.stringify(e.p)),
            glass: [M.glass0, S.rewards.shop.glass], relics: [M.relics0, S.rewards.relics.owned.slice()],
            toasts: S.ui.toasts.live ? S.ui.toasts.live.map((t) => t.el.textContent) : null,
            hudGlass: txt("#hud .hud-glass-n") };
    };

    // ---------------------------------------------------------------- shrines
    M.ringShrines = async (k) => {
        const S = SF(), Q = S.quests, P = S.progression, realm = S.meaning.getRealm(), i0 = M.log.length;
        const visits = [];
        for (let i = 0; i < k; i++) {
            await gameWait(0.6, 300);
            const wp = Q.waypoint, want = M.nearestDormant();
            const target = S.shrine.positions.find((p) => wp && Math.abs(p.x - wp.x) < 0.05 && Math.abs(p.z - wp.z) < 0.05);
            const go = target || want;
            visits.push({ waypoint: wp ? wp.label : null, wpKind: wp ? wp.kind : null, target: go ? go.id : null,
                followedWaypoint: !!target, distM: go ? r1(dist(go.x, go.z)) : null });
            if (!go) break;
            M.tp(go.sx, go.sz, yawTo(go.x, go.z));
            const lit = await until(() => P.isShrineLit(realm, go.id), 6, 600);
            visits[visits.length - 1].lit = lit.ok;
        }
        await gameWait(0.4, 300);
        return { visits, main: Object.assign({}, Q.main), lit: P.litShrines(realm).slice(),
            completed: since(i0, "quest:complete").map((e) => e.p.stepId),
            dialogues: since(i0, "dialogue").map((e) => e.p.id) };
    };
    M.armWait = async (kind, sec) => {
        const S = SF(), B = S.combat.bosses, t0 = reg().time;
        const u = await until(() => B.state === "pending" && B.kind === kind, sec || 15, 900);
        return { until: u, latencyGameS: +(reg().time - t0).toFixed(2), state: B.state, kind: B.kind,
            arena: { x: r1(B.ax), z: r1(B.az), d: r1(dist(B.ax, B.az)) }, waypoint: S.quests.waypoint,
            step: S.quests.tracked && S.quests.tracked.stepId };
    };

    // ------------------------------------------------------- damage measuring
    const mkTarget = (x, z) => reg().register({
        x, y: SF().terrain.heightAt(x, z), z, radius: 0.5, height: 1.8, tier: 2, level: 10, hp: 4000,
        poiseMax: 1e9, name: "QA Target", kind: "enemy",
    });
    /** One Crystal Spikes cast on a fresh pinned QA target (lane R's method). */
    M.spikeHit = async () => {
        const S = SF(), sp = S.spells, r = reg(), C = S.character;
        for (let k = 0; k < 600 && (sp.crystallize.active || sp._pending.key); k++) await frames(1);
        sp._cdUntil[4] = 0;
        C.mana = C.manaMax;
        const flt0 = Array.from(document.querySelectorAll("#floaters .flt-t")).map((e) => e.textContent);
        sp.cast(4);
        const p = sp._pending;
        if (p.key !== 4) return { err: "spikes not scheduled (unlocked? " + JSON.stringify(sp.unlocked) + ")" };
        const id = mkTarget(p.a0, p.a2);
        const s = r.slot(id), hp0 = r.hp[s];
        const flo = [];
        const grab = () => { for (const e of document.querySelectorAll("#floaters .flt-t")) flo.push(e.textContent); };
        // ATTRIBUTION (run 2: the after-hit read 22.31 = the Spikes hit plus
        // something else on the target). Every registry.damage() on the QA
        // target is logged with its tag and the target's brittle / broken
        // state; the check uses the 'spikes'-tagged amount AS DEALT BY THE
        // SPELL (pre-registry), which is where a boon multiplier lives.
        const hits = [];
        const orig = r.damage;
        r.damage = function (hid, amount, o) {
            if (hid === id) {
                const k = r.slot(hid);
                hits.push({ tag: o && o.tag ? o.tag : null, amount: r4(amount),
                    brittle: k >= 0 && r.time < r.brittleUntil[k], broken: k >= 0 && r.time < r.breakUntil[k] });
            }
            return orig.call(this, hid, amount, o);
        };
        let w;
        try { w = await gameWait(2.2, 600); } finally { r.damage = orig; }
        grab();
        const dealt = hp0 - r.hp[r.slot(id)];
        if (r.slot(id) >= 0) r.remove(id);
        const spikes = hits.filter((h) => h.tag === "spikes").reduce((a, h) => a + h.amount, 0);
        const dm = S.combat.spellHits.damageMult;
        return { dealt: r4(dealt), spikesAmount: r4(spikes), damageMult: r4(dm), level: S.progression.level,
            perMult: r4(spikes / dm), dealtPerMult: r4(dealt / dm), hits, gameS: w,
            floatersNow: flo.filter((t, i) => flo.indexOf(t) === i).slice(0, 12), floatersBefore: flt0.length };
    };
    /** The bolt's leash (Frostglass Lens: bolt range +20%) — lane R's read. */
    M.boltLeash = async () => {
        const S = SF(), sp = S.spells, rig = S.rig;
        const pitch0 = rig.pitch;
        rig.pitch = -0.6;
        await frames(2);
        sp._boltNext = 0;
        const pool = sp.bolt;
        const gens = Array.from(pool.gen);
        sp.cast(6);
        let slot = -1;
        for (let i = 0; i < pool.gen.length; i++) if (pool.gen[i] !== gens[i] && !pool.own[i]) slot = i;
        rig.pitch = pitch0;
        if (slot < 0) return { err: "no bolt" };
        return { leash: r4(pool.left[slot]), boltRangeMult: r4(S.rewards.mods.boltRange) };
    };

    // ---------------------------------------------------------------- bosses
    M.bossFight = async (kind) => {
        const S = SF(), B = S.combat.bosses, r = reg(), i0 = M.log.length;
        const vx = S.character.position.x - B.ax, vz = S.character.position.z - B.az;
        const L = Math.hypot(vx, vz) || 1;
        M.tp(B.ax + vx / L * 30, B.az + vz / L * 30, yawTo(B.ax, B.az));
        const live = await until(() => B.state === "live" && B.bossId > 0, 30, 1200);
        const name = B.row ? (B.row.bossName || B.row.name) : null;
        const stats = B.stats ? { name: B.stats.name, phase: B.stats.phase } : null;
        const lv0 = S.progression.level;
        let hits = 0;
        for (let i = 0; i < 10 && B.state === "live"; i++) {
            const s = r.slot(B.bossId);
            if (s >= 0 && r.hp[s] > 0) { r.damage(B.bossId, r.hp[s] + 1, { tag: "probe" }); hits++; }
            await gameWait(0.5, 300);
        }
        const killed = await until(() => since(i0, "boss:killed").length > 0, 6, 600);
        return { kind, live, name, stats, scriptedKillHits: hits, killed,
            bossKilled: since(i0, "boss:killed").map((e) => e.p), levelBefore: lv0, level: S.progression.level,
            offers: since(i0, "boon:offer").map((e) => e.p), main: Object.assign({}, S.quests.main) };
    };
    /** Wait (game time; the open delay runs on it) for the boon pick modal. */
    M.waitBoonPick = async () => {
        const u = await until(() => cls("#dw-boonpick", "open"), 10, 900);
        return Object.assign({ until: u }, M.modal());
    };
    M.modal = () => {
        const bp = $("#dw-boonpick"), sm = $("#dw-shrine");
        return {
            boonOpen: cls("#dw-boonpick", "open"), shrineOpen: cls("#dw-shrine", "open"),
            freeze: SF().S.freezeTime, anyModal: SF().rewards.boonPick.isOpen || SF().rewards.shrineMenu.isOpen,
            boonTitle: bp && bp.querySelector(".dwr-title") ? bp.querySelector(".dwr-title").textContent : null,
            boonKicker: bp && bp.querySelector(".dwr-kicker") ? bp.querySelector(".dwr-kicker").textContent : null,
            cards: bp ? Array.from(bp.querySelectorAll(".dwr-card")).map((c) =>
                (c.querySelector(".dwr-cname") || {}).textContent + " | " + (c.querySelector(".dwr-ceff") || {}).textContent) : [],
            shrineTitle: sm && sm.querySelector(".dwr-title") ? sm.querySelector(".dwr-title").textContent : null,
            purse: sm && sm.querySelector(".dwr-purse") ? sm.querySelector(".dwr-purse").textContent : null,
            pane: sm && sm.querySelector(".dwr-pane") ? sm.querySelector(".dwr-pane").innerText.slice(0, 500) : null,
        };
    };
    M.boonState = () => {
        const R = SF().rewards;
        return { active: R.boons.activeIds(), picks: Object.assign({}, R.boons.picks), pending: R.boons.pending.slice(),
            dmgFrost: r4(R.mods.dmgFrost), dmgAll: r4(R.mods.dmgAll), maxHp: r4(R.mods.maxHp),
            glass: R.shop.glass, relicsOwned: R.relics.owned.slice(), relicsEquipped: R.relics.equipped.slice() };
    };

    // ---------------------------------------------------------------- shrine hub
    M.toShrine = async (id) => {
        const S = SF(), p = S.shrine.positions.find((q) => q.id === id);
        M.tp(p.sx, p.sz, yawTo(p.x, p.z));
        const u = await until(() => S.rewards.shrineMenu.reach === id, 6, 600);
        return { id, reach: S.rewards.shrineMenu.reach, until: u, realm: S.meaning.getRealm(),
            lit: S.progression.isShrineLit(S.meaning.getRealm(), id),
            prompt: { show: cls("#dw-prompt", "show"), name: txt("#dw-prompt .ip-name") } };
    };
    /** Wait on the WALL clock (time is frozen under a modal). */
    M.waitOpen = (sel, on, wallS) => new Promise((res) => {
        const w0 = performance.now();
        const tick = () => {
            const ok = cls(sel, "open") === on;
            if (ok || performance.now() - w0 > (wallS || 600) * 1000) res({ ok, wallS: +((performance.now() - w0) / 1000).toFixed(1) });
            else requestAnimationFrame(tick);
        };
        tick();
    });
    M.where = () => {
        const S = SF(), c = S.character.position;
        let near = null, nd = 1e9;
        for (const p of S.shrine.positions) { const d = Math.hypot(p.sx - c.x, p.sz - c.z); if (d < nd) { nd = d; near = p.id; } }
        return { realm: S.meaning.getRealm(), x: r1(c.x), z: r1(c.z), nearestStand: near, dStand: r4(nd),
            freeze: S.S.freezeTime, menu: S.rewards.shrineMenu.isOpen, travelling: S.rewards.shrineMenu._travelling };
    };

    // ---------------------------------------------------------------- trials
    M.runTrial = async (k) => {
        const S = SF(), Tr = S.world.trials, i0 = M.log.length;
        await until(() => Tr.readyRealm === S.meaning.getRealm(), 120, 900);
        const tr = Tr.trials[k];
        if (!tr) return { err: "no trial " + k };
        const bx = tr.gx[0] - tr.nx[0] * 45, bz = tr.gz[0] - tr.nz[0] * 45;
        M.tp(bx, bz, Math.atan2(tr.nx[0], -tr.nz[0]));
        await frames(3);
        M.pin("surf", true);
        M.pin("moveZ", 1);
        M.steer = () => {
            const i = Tr.activeIdx === k ? Tr.next : 0;
            const p = S.character.position;
            S.rig.yaw = Math.atan2(tr.gx[i] - p.x, -(tr.gz[i] - p.z));
        };
        const done = await until(() => since(i0).some((e) => (e.t === "trial:finished" || e.t === "trial:failed") && e.p.id === tr.id),
            120, 3600);
        M.steer = null;
        M.unpin("surf", false);
        M.unpin("moveZ", 0);
        await gameWait(0.5, 300);
        const evs = since(i0).filter((e) => e.t.startsWith("trial:") || e.t === "reward");
        return { id: tr.id, name: tr.name, done, par: r1(tr.par), gates: tr.n,
            gateEvents: evs.filter((e) => e.t === "trial:gate").length,
            result: evs.filter((e) => e.t !== "trial:gate").map((e) => e.t + " " + JSON.stringify(e.p)),
            record: Tr.record(tr.id), timerShown: txt("#wa-trial") };
    };

    // ---------------------------------------------------------------- bounties
    M.bounty = async (k) => {
        const S = SF(), Bo = S.world.bounties, r = reg(), P = S.progression, i0 = M.log.length;
        await until(() => Bo.readyRealm === S.meaning.getRealm(), 120, 900);
        const sx = Bo.sx[k], sz = Bo.sz[k];
        const R0 = Math.hypot(sx, sz) || 1;
        const ux = -sx / R0, uz = -sz / R0;
        M.tp(sx + ux * 70, sz + uz * 70, Math.atan2(-ux, uz));
        const rev = await until(() => Bo.liveId[k] >= 0, 8, 900);
        const id = Bo.liveId[k], s = r.slot(id);
        const info = s >= 0 ? { name: r.name[s], level: r.level[s], hpMax: r1(r.hpMax[s]), playerLevel: P.level } : null;
        const glass0 = S.rewards.shop.glass, xp0 = P.xp, lv0 = P.level;
        if (s >= 0) r.damage(id, r.hp[s] + 100, { tag: "probe" });
        const killed = await until(() => since(i0, "bounty:killed").length > 0, 6, 600);
        await gameWait(0.5, 300);
        const bid = since(i0, "bounty:killed").map((e) => e.p.id)[0] || null;
        return { k, revealed: rev, registryId: id, info, distAtReveal: r1(dist(sx, sz)), scriptedKill: true, killed,
            bountyId: bid, isKilled: bid ? Bo.isKilled(bid) : null,
            glass: [glass0, S.rewards.shop.glass], xp: [lv0 + ":" + xp0, P.level + ":" + P.xp],
            events: since(i0).filter((e) => e.t === "bounty:revealed" || e.t === "bounty:killed" || e.t === "reward")
                .map((e) => e.t + " " + JSON.stringify(e.p)) };
    };
    /** Revisit a killed bounty's site: it must not come back. */
    M.bountyStaysDead = async (k) => {
        const S = SF(), Bo = S.world.bounties;
        const sx = Bo.sx[k], sz = Bo.sz[k];
        const R0 = Math.hypot(sx, sz) || 1;
        M.tp(sx - sx / R0 * 40, sz - sz / R0 * 40);
        await gameWait(3, 600);
        return { liveId: Bo.liveId[k], within: r1(dist(sx, sz)) };
    };

    // ---------------------------------------------------------------- portal
    M.portalWalk = async () => {
        const S = SF(), G = S.portal, Q = S.quests, i0 = M.log.length;
        const open = await until(() => G.isOpen, 20, 900);
        const gx = G.x, gz = G.z;
        M.tp(gx + 8, gz, yawTo(gx, gz));
        await gameWait(0.6, 300);
        M.tp(gx, gz);
        const entered = await until(() => since(i0, "portal:entered").length > 0, 8, 900);
        const realm = await until(() => S.meaning.getRealm() === "sand", 60, 1800);
        await gameWait(1.0, 600);
        return { open, gate: { x: r1(gx), z: r1(gz), token: G.token }, entered, realm,
            nowRealm: S.meaning.getRealm(), main: Object.assign({}, Q.main),
            unlocked: (S.progression.realmsUnlocked || []).slice(),
            completed: since(i0, "quest:complete").map((e) => e.p.stepId),
            events: since(i0).filter((e) => e.t === "portal:entered" || e.t === "realm:entered").map((e) => e.t + " " + JSON.stringify(e.p)) };
    };
    M.touchSpawnHere = async () => {
        const S = SF(), Q = S.quests, realm = S.meaning.getRealm(), sp = S.shrine.positions[0], i0 = M.log.length;
        await until(() => !(S.landmarks._regroundIn > 0), 10, 600);
        await gameWait(0.5, 300);
        M.tp(sp.sx, sp.sz, yawTo(sp.x, sp.z));
        const u = await until(() => S.progression.isShrineLit(realm, "cold_spawn") && Q.main[realm] >= 1, 8, 900);
        await gameWait(0.4, 300);
        return { realm, until: u, main: Object.assign({}, Q.main),
            completed: since(i0, "quest:complete").map((e) => e.p.stepId), tracker: M.tracker() };
    };

    // ---------------------------------------------------- TEMP dev keys 6 / 7
    M.mark = () => { M.i1 = M.log.length; return M.i1; };
    /** After a Digit6/Digit7 press (Python): the realm and lane W follow. */
    M.devRealmWait = async (want) => {
        const S = SF(), W = S.world;
        const u = await until(() => S.meaning.getRealm() === want, 60, 1800);
        const rd = await until(() => W.caches.readyRealm === want && W.trials.readyRealm === want &&
            W.bounties.readyRealm === want, 120, 1800);
        return { want, realm: u, worldReady: rd, now: S.meaning.getRealm(), questRealm: S.quests.realm,
            trackerRealm: S.ui.questTracker.realm, kicker: txt("#dw-tracker .qt-kicker"),
            entered: since(M.i1, "realm:entered").map((e) => e.p.realm) };
    };

    // ---------------------------------------------------------------- panels
    M.journal = () => {
        const J = SF().ui.journal;
        return { open: J.isOpen, tab: J.tab, panel: SF().input.panel,
            tabs: Array.from(document.querySelectorAll("#dw-journal .dwu-tab")).map((b) => b.textContent + (b.classList.contains("cur") ? "*" : "")),
            body: (txt("#dw-journal .dwu-body") || "").slice(0, 1400),
            rows: Array.from(document.querySelectorAll("#dw-journal .dwu-row")).slice(0, 30).map((r) =>
                (r.classList.contains("done") ? "[x] " : r.classList.contains("cur") ? "[>] " : "[ ] ") + r.textContent.slice(0, 90)) };
    };
    M.map = () => {
        const W = SF().ui.worldMap, mk = W.markers;
        return { open: W.isOpen, panel: SF().input.panel, counts: mk && mk.counts, title: txt("#dw-map .dwu-title"),
            legend: txt("#dw-map .dwm-legend"),
            bounties: mk ? mk.bounties.map((b) => b.label + (b.s ? "(" + b.s + ")" : "")) : null,
            trials: mk ? mk.trials.map((t) => t.label + (t.s ? "(" + t.s + ")" : "")) : null,
            caches: mk ? mk.caches.length : null, portal: mk ? mk.portal : null };
    };

    // ---------------------------------------------------------------- perf
    /** Draw calls with lane W's meshes as they are vs all four hidden, in the
     *  CURRENT scene (busy: enemies, a trial, caches, the beacon). Averages of
     *  `n` frames each; perfStats is the whole-frame counter main.js latches. */
    M.drawDelta = async (n) => {
        const S = SF(), W = S.world;
        const meshes = [W.caches.mesh, W.caches.glintMesh, W.trials.mesh, W.beacon.mesh];
        const sample = async () => {
            let d = 0, t = 0;
            for (let i = 0; i < n; i++) { await frames(1); d += S.perfStats.drawCalls; t += S.perfStats.triangles; }
            return { draws: d / n, tris: Math.round(t / n) };
        };
        const vis = meshes.map((m) => m.visible);
        const on = await sample();
        // Hide for the off sample: the systems re-derive visibility in update(),
        // so freeze the world (render keeps running) while they are hidden.
        const fz = S.S.freezeTime;
        S.S.freezeTime = true;
        await frames(1);
        for (const m of meshes) m.visible = false;
        const off = await sample();
        for (let i = 0; i < meshes.length; i++) meshes[i].visible = vis[i];
        S.S.freezeTime = fz;
        await frames(2);
        let alive = 0;
        const r = reg();
        for (let i = 0; i < r.count; i++) if (r.hp[i] > 0) alive++;
        return { on, off, delta: +(on.draws - off.draws).toFixed(2), visible: vis,
            perSystem: { caches: W.caches.draws, trials: W.trials.draws, beacon: W.beacon.draws, bounties: 0 },
            registryLive: alive, enemiesAlive: S.combat.enemies.alive ? Array.from(S.combat.enemies.alive).filter(Boolean).length : null };
    };

    // ---------------------------------------------------------------- save
    M.snapshot = () => {
        const S = SF(), R = S.rewards, W = S.world, Q = S.quests;
        let blob = null;
        try { blob = JSON.parse(localStorage.getItem("driftwake_save") || "null"); } catch (e) { blob = null; }
        const trials = {};
        for (const t of W.trials.trials) { const rec = W.trials.record(t.id); if (rec) trials[t.id] = rec; }
        return {
            realm: S.meaning.getRealm(), level: S.progression.level,
            main: Object.assign({}, Q.main), surfM: r1(Q.surfM), hintsSeen: Object.keys(Q.hintsSeen).sort(),
            relicsOwned: R.relics.owned.slice().sort(), relicsEquipped: R.relics.equipped.slice(),
            glass: R.shop.glass, boons: R.boons.activeIds().slice().sort(), picks: Object.assign({}, R.boons.picks),
            shop: Object.assign({}, R.shop.ranks), rerolls: R.shop.rerolls,
            cachesOpenedCold: W.caches.list("cold").filter((c) => c.opened).map((c) => c.site),
            trials, savedTrials: blob && blob.quest ? blob.quest.trials : null,
            bountiesKilled: blob && blob.quest ? blob.quest.bounties : null,
            lore: blob && blob.quest ? blob.quest.lore : null,
            lit: { cold: S.progression.litShrines("cold").slice(), sand: S.progression.litShrines("sand").slice() },
            bossesKilled: Object.assign({}, S.progression.bossesKilled),
            unlocked: (S.progression.realmsUnlocked || []).slice(),
            blobKeys: blob ? Object.keys(blob).sort() : null, schemaVer: blob ? blob.schemaVer : null,
            introSeen: blob && blob.quest ? blob.quest.introSeen : null,
        };
    };
    /** Lane W builds a realm time-sliced after a boot / CONTINUE: wait for
     *  it before reading trial records off the live system (run 2 read an
     *  empty `trials` list 2 game-s after CONTINUE). */
    M.waitWorld = async () => {
        const S = SF(), W = S.world, realm = S.meaning.getRealm();
        return until(() => W.caches.readyRealm === realm && W.trials.readyRealm === realm &&
            W.bounties.readyRealm === realm, 120, 1800);
    };
    M.errorsNow = () => M.errors.slice();
    M.envNow = () => ({ autoResumes: M.autoResumes.slice(), lockLog: M.lockLog.slice(-40),
        phase: globalThis.FFG && FFG.shell ? FFG.shell.phase : null });
    M.mute = () => { try { return localStorage.getItem("ff_muted"); } catch (e) { return "n/a"; } };
})();
