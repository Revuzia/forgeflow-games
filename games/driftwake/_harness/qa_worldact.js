// qa_worldact.js -- in-page harness for lane W's world activities.
// Loaded by qa_worldact.py (page.evaluate of this whole file). Builds the
// meaning-layer ctx from globalThis.SNOWFLOW, dynamically imports
// src/world/{caches,trials,bounties,beacon}.js, constructs the four systems,
// drives them from a rAF loop on GAME time (registry.time deltas) and
// installs window.__WA with the probe steps. Nothing here edits game files.
(async () => {
    const SF = globalThis.SNOWFLOW;
    const reg = SF.combat.registry;
    const ev = await import("/games/driftwake/src/quests/events.js");
    const bus = ev.bus;
    const C = await import("/games/driftwake/src/world/caches.js");
    const T = await import("/games/driftwake/src/world/trials.js");
    const B = await import("/games/driftwake/src/world/bounties.js");
    const W = await import("/games/driftwake/src/world/beacon.js");
    const ST = await import("/games/driftwake/src/quests/storyText.js");
    const STORY = ST.STORY;

    const log = [];
    const TYPES = ["cache:discovered", "cache:opened", "reward", "trial:started",
        "trial:gate", "trial:finished", "trial:failed", "bounty:revealed",
        "bounty:killed", "enemy:killed"];
    for (const t of TYPES) {
        bus.on(t, (p) => log.push({ t, p: JSON.parse(JSON.stringify(p === undefined ? null : p)),
            gt: +reg.time.toFixed(3) }));
    }

    // Isolation: no ambient packs, no boss events, no damage to the rider.
    // (Probe-only monkeypatches on this throwaway page.)
    SF.combat.encounters.update = () => {};
    SF.combat.bosses.update = () => {};
    SF.combat.enemies.clear();
    SF.progression.graceUntil = 1e9;

    // [lane INT] The INTEGRATED build: main.js constructs and drives lane W's
    // four systems itself (SNOWFLOW.world, shared ctx SNOWFLOW.meaning, with
    // lane R's wallet/relics and lane U's E router). Reuse them: a second set
    // would draw every cache twice and double every reward. In that build
    // this page's tick drives NOTHING; it only steers, hides for A/B shots,
    // and turns H.pressE into ONE real E edge for main.js's Interact router.
    const INTEGRATED = !!(SF.world && SF.meaning);
    const ctx = INTEGRATED ? SF.meaning : {
        scene: SF.scene, terrain: SF.terrain, character: SF.character, rig: SF.rig,
        spells: SF.spells, registry: reg, enemies: SF.combat.enemies,
        encounters: SF.combat.encounters, bosses: SF.combat.bosses,
        portal: SF.portal, shrine: SF.shrine, landmarks: SF.landmarks,
        progression: SF.progression, realms: SF.realms, enterRealm: SF.enterRealm,
        getRealm: () => SF.landmarks.realm, input: SF.input, S: SF.S, bus,
        crystals: SF.spells.crystals, sky: SF.sky, shadows: SF.shadows,
        overlay: SF.overlay,
    };
    // Lane R's reward listeners (wallet + relic inventory), if they construct
    // on this tree — an end-to-end check that a W 'reward' is credited once.
    // Optional: a failure here is reported, never fatal.
    let laneR = INTEGRATED ? { ok: true, err: null, integrated: true } : { ok: false, err: null };
    if (!INTEGRATED) try {
        const RM = await import("/games/driftwake/src/progression/modifiers.js");
        const RR = await import("/games/driftwake/src/progression/relics.js");
        const RS = await import("/games/driftwake/src/progression/shop.js");
        ctx.wake = SF.wake;
        const mods = new RM.Modifiers(ctx); ctx.mods = ctx.mods || mods;
        const relics = new RR.Relics(ctx); ctx.relics = ctx.relics || relics;
        const shop = new RS.Shop(ctx); ctx.shop = ctx.shop || shop;
        laneR = { ok: true, err: null };
    } catch (e) {
        laneR = { ok: false, err: String((e && e.message) || e) };
    }

    const caches = INTEGRATED ? SF.world.caches : new C.RelicCaches(ctx);
    ctx.caches = caches;
    const trials = INTEGRATED ? SF.world.trials : new T.WakeTrials(ctx);
    ctx.trials = trials;
    const bounties = INTEGRATED ? SF.world.bounties : new B.Bounties(ctx);
    const beacon = INTEGRATED ? SF.world.beacon : new W.WaypointBeacon(ctx);

    const H = window.__WA = {
        ctx, bus, log, caches, trials, bounties, beacon, STORY, laneR,
        hide: false, steer: null, errors: [], ticks: 0, pressE: false,
    };
    H.glass = () => (ctx.shop && typeof ctx.shop._glass === "number") ? ctx.shop._glass : null;
    H.relicsOwned = () => (ctx.relics && ctx.relics.owned) ? ctx.relics.owned.slice() : null;

    let last = reg.time;
    const tick = () => {
        const now = reg.time;
        const dt = Math.max(0, now - last);
        last = now;
        try {
            if (INTEGRATED) {
                // One E edge; main.js's Interact router consumes it on its
                // next frame (endFrame() clears it after).
                if (H.pressE) { SF.input.interactPressed = true; H.pressE = false; }
            } else {
            // The E key's edge, set for exactly this update (lane U owns the
            // real key; its endFrame() may clear the property between frames).
            if (H.pressE) SF.input.interactPressed = true;
            caches.update(dt);
            if (H.pressE) SF.input.interactPressed = false;
            trials.update(dt);
            bounties.update(dt);
            beacon.update(dt);
            }
        } catch (e) {
            H.errors.push(String((e && e.stack) || e));
        }
        if (H.steer) {
            try { H.steer(); } catch (e) { H.errors.push("steer " + e); }
        }
        // Hide lane W's meshes for an A/B shot, and PUT ALL FOUR BACK after:
        // the caches' visibility is event-scoped (set on placement / an
        // opening), and under S.freezeTime every update(0) is a no-op, so
        // nothing would re-derive the trials' or the beacon's either.
        const HM = [caches.mesh, caches.glintMesh, trials.mesh, beacon.mesh];
        if (H.hide) {
            if (!H._saved) H._saved = HM.map((m) => m.visible);
            for (const m of HM) m.visible = false;
        } else if (H._saved) {
            for (let i = 0; i < HM.length; i++) HM[i].visible = H._saved[i];
            H._saved = null;
        }
        H.ticks++;
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    // ---------------------------------------------------------------- utils
    H.gameWait = (sec) => new Promise((res) => {
        const t0 = reg.time;
        const f = () => (reg.time - t0 >= sec) ? res() : requestAnimationFrame(f);
        f();
    });
    H.waitFor = (pred, sec) => new Promise((res) => {
        const t0 = reg.time;
        const f = () => {
            let v = false;
            try { v = pred(); } catch (e) { v = false; }
            if (v) return res(true);
            if (reg.time - t0 >= sec) return res(false);
            requestAnimationFrame(f);
        };
        f();
    });
    H.frames = (n) => new Promise((res) => {
        let k = 0;
        const f = () => (++k >= n) ? res() : requestAnimationFrame(f);
        requestAnimationFrame(f);
    });
    H.tp = (x, z, facing) => {
        const c = SF.character;
        c.position.set(x, SF.terrain.heightAt(x, z), z);
        c.velocity.set(0, 0, 0);
        if (facing !== undefined) { c.facing = facing; SF.rig.yaw = facing; }
    };
    H.since = (i0, t) => log.slice(i0).filter((e) => !t || e.t === t);
    H.ready = (realm) => caches.readyRealm === realm && trials.readyRealm === realm &&
        bounties.readyRealm === realm;

    H.enter = async (realm) => {
        if (SF.landmarks.realm !== realm) await SF.enterRealm(realm);
        // Game seconds: the trial build is time-sliced (3 ms of CPU a frame),
        // so a starved browser needs more frames, not more CPU.
        const ok = await H.waitFor(() => H.ready(realm), 120);
        return { realm, ready: ok, live: SF.landmarks.realm };
    };

    // ---------------------------------------------------------------- counts
    H.counts = () => {
        const L = caches.list();
        const kinds = { relic: 0, lore: 0, grand: 0 };
        for (const c of L) kinds[c.kind]++;
        const tl = trials.trials.map((t) => ({
            id: t.id, name: t.name, gates: t.n, len: +t.len.toFixed(1),
            par: +t.par.toFixed(2), ideal: +t.ideal.toFixed(2),
        }));
        const bl = bounties.list().map((b) => ({ id: b.id, name: b.name, place: b.place,
            x: b.x === null ? null : +b.x.toFixed(1), z: b.z === null ? null : +b.z.toFixed(1),
            killed: b.killed }));
        return {
            realm: caches.realm, caches: L.length, kinds,
            placeFallbacks: caches.stats.placeFallbacks,
            trials: tl, trialStats: Object.assign({}, trials.stats),
            bounties: bl,
        };
    };

    // Independent re-validation of every gate pair: the 4 m window at 1 m
    // steps (the build's own grid), min distance to any live landmark prism
    // base and to any shrine anchor, max radius from world centre.
    H.revalidate = () => {
        const Tn = SF.terrain;
        const lm = SF.landmarks;
        const d = lm._texData, w = lm.prismCount * 4;
        const inst = lm.instances.filter((s) => s.realm === caches.realm);
        const out = [];
        for (const tr of trials.trials) {
            let maxUp = -1e9, maxDown = -1e9, maxUp2 = -1e9, minPrism = 1e9, minShrine = 1e9, maxR = 0;
            let minSegLen = 1e9, maxSegLen = 0, maxTurnDeg = 0;
            for (let i = 0; i + 1 < tr.n; i++) {
                const ax = tr.gx[i], az = tr.gz[i], bx = tr.gx[i + 1], bz = tr.gz[i + 1];
                const len = Math.hypot(bx - ax, bz - az);
                minSegLen = Math.min(minSegLen, len);
                maxSegLen = Math.max(maxSegLen, len);
                if (i > 0) {
                    const px = tr.gx[i - 1], pz = tr.gz[i - 1];
                    const a1 = Math.atan2(ax - px, az - pz), a2 = Math.atan2(bx - ax, bz - az);
                    let da = Math.abs(a2 - a1);
                    if (da > Math.PI) da = 2 * Math.PI - da;
                    maxTurnDeg = Math.max(maxTurnDeg, da * 180 / Math.PI);
                }
                // Pass criterion: the build's own measure, a sliding 4 m
                // window, re-checked at every 1 m (SAMPLE_M = 1).
                // Information only: the raw grade between 2 m points.
                const ux = (bx - ax) / len, uz = (bz - az) / len;
                const steps = Math.ceil(len);
                let hp = Tn.heightAt(ax, az);
                for (let s = 1; s <= steps; s++) {
                    const f = s / steps;
                    const x = ax + (bx - ax) * f, z = az + (bz - az) * f;
                    const h = Tn.heightAt(x, z);
                    const g4 = (h - Tn.heightAt(x - ux * 4, z - uz * 4)) / 4;
                    maxUp = Math.max(maxUp, g4);
                    maxDown = Math.max(maxDown, -g4);
                    if (s % 2 === 0) {
                        const g2 = (h - hp) / (2 * len / steps);
                        maxUp2 = Math.max(maxUp2, g2);
                        hp = h;
                    }
                    maxR = Math.max(maxR, Math.hypot(x, z));
                    for (const li of inst) {
                        for (let p = li.prism0; p < li.prism0 + li.prisms; p++) {
                            const o = p * 4;
                            const c = Math.hypot(x - d[o], z - d[o + 2]) - d[w + o + 3];
                            if (c < minPrism) minPrism = c;
                        }
                    }
                    for (const sh of SF.shrine.positions) {
                        minShrine = Math.min(minShrine, Math.hypot(x - sh.x, z - sh.z));
                    }
                }
            }
            out.push({ id: tr.id, gates: tr.n, maxUp4mWindow: +maxUp.toFixed(3),
                maxDown4mWindow: +maxDown.toFixed(3), info_maxUpRaw2m: +maxUp2.toFixed(3), minPrismClear: +minPrism.toFixed(1),
                minShrine: +minShrine.toFixed(1), maxR: +maxR.toFixed(1),
                segLen: [+minSegLen.toFixed(1), +maxSegLen.toFixed(1)],
                maxTurnDeg: +maxTurnDeg.toFixed(1) });
        }
        return out;
    };

    // ---------------------------------------------------------------- caches
    /** Walk up to one cache of `kind` and press E (input.interactPressed). */
    H.openKind = async (kind) => {
        const L = caches.list();
        const c = L.find((e) => e.kind === kind && !e.opened);
        if (!c) return { kind, err: "no unopened cache of that kind" };
        const i0 = log.length;
        const glassBefore = H.glass();
        const relicsBefore = H.relicsOwned();
        H.tp(c.x + 2.0, c.z, Math.atan2(-2.0, 0));
        const near = await H.waitFor(() => caches.interactTarget === c.site, 3);
        H.pressE = true;
        const opened = await H.waitFor(() => caches.isOpened(caches.realm, c.site), 3);
        H.pressE = false;
        await H.gameWait(0.3);
        return {
            kind, site: c.site, landmark: c.landmark, dist: +Math.hypot(
                SF.character.position.x - c.x, SF.character.position.z - c.z).toFixed(2),
            interactTargetSeen: near, opened,
            events: H.since(i0).filter((e) => e.t === "cache:opened" || e.t === "reward"),
            laneRWallet: laneR.ok ? { before: glassBefore, after: H.glass() } : laneR.err,
            laneRRelics: laneR.ok ? { before: relicsBefore, after: H.relicsOwned() } : laneR.err,
        };
    };

    // ---------------------------------------------------------------- trials
    /** Surf trial k with pinned input: surf held, rig yaw aimed at the next gate. */
    H.runTrial = async (k, timeoutS) => {
        const tr = trials.trials[k];
        if (!tr) return { err: "no trial " + k };
        const i0 = log.length;
        const back = 45;
        const bx = tr.gx[0] - tr.nx[0] * back, bz = tr.gz[0] - tr.nz[0] * back;
        const face = Math.atan2(tr.nx[0], -tr.nz[0]);
        H.tp(bx, bz, face);
        await H.frames(3);
        Object.defineProperty(SF.input, "surf", { get: () => true, configurable: true });
        let maxSpeed = 0, sumSpeed = 0, nSpeed = 0;
        H.steer = () => {
            const i = trials.activeIdx === k ? trials.next : 0;
            const p = SF.character.position;
            SF.rig.yaw = Math.atan2(tr.gx[i] - p.x, -(tr.gz[i] - p.z));
            if (trials.activeIdx === k) {
                const s = SF.character.speed;
                maxSpeed = Math.max(maxSpeed, s); sumSpeed += s; nSpeed++;
            }
        };
        const done = await H.waitFor(() => H.since(i0).some((e) =>
            (e.t === "trial:finished" || e.t === "trial:failed") && e.p.id === tr.id), timeoutS || 90);
        H.steer = null;
        Object.defineProperty(SF.input, "surf", { value: false, writable: true,
            configurable: true, enumerable: true });
        const evs = H.since(i0).filter((e) => e.t.startsWith("trial:") || e.t === "reward");
        return {
            id: tr.id, done, par: +tr.par.toFixed(2), ideal: +tr.ideal.toFixed(2),
            gates: tr.n, meanRunSpeed: nSpeed ? +(sumSpeed / nSpeed).toFixed(2) : null,
            maxRunSpeed: +maxSpeed.toFixed(2),
            gateEvents: evs.filter((e) => e.t === "trial:gate").length,
            result: evs.filter((e) => e.t === "trial:finished" || e.t === "trial:failed" ||
                e.t === "trial:started" || e.t === "reward"),
            record: trials.record(tr.id),
        };
    };

    // -------------------------------------------------------------- bounties
    H.bountyReveal = async (k) => {
        const i0 = log.length;
        const sx = bounties.sx[k], sz = bounties.sz[k];
        // Stand 70 m off the site, on whichever side stays inside the disc.
        const r = Math.hypot(sx, sz) || 1;
        const ux = -sx / r, uz = -sz / r;
        H.tp(sx + ux * 70, sz + uz * 70, Math.atan2(-ux, uz));
        const revealed = await H.waitFor(() => bounties.liveId[k] >= 0, 5);
        const id = bounties.liveId[k];
        const s = reg.slot(id);
        const def = STORY.bounties[bounties.realm][k];
        const en = SF.combat.enemies;
        const u = en.units[en.unitIndex(def.unit)];
        const level = s >= 0 ? reg.level[s] : null;
        const rowHp = u.hp * Math.pow(1.10, (level || 10) - 10);
        await H.gameWait(1.5);
        // Tint on the bound body, if its mesh type is resident.
        let tint = null;
        for (let i = 0; i < en.id.length; i++) {
            if (en.alive[i] && en.id[i] === id) {
                const inst = en.vis && en.vis._slotInst ? en.vis._slotInst[i] : null;
                tint = inst ? { rgb: Array.from(inst.tint).map((v) => +v.toFixed(2)),
                    mix: +inst.state[3].toFixed(2) } : "body not bound";
            }
        }
        return {
            k, id: def.id, revealed, registryId: id,
            distAtReveal: +Math.hypot(SF.character.position.x - sx,
                SF.character.position.z - sz).toFixed(1),
            name: s >= 0 ? reg.name[s] : null, storyName: def.name,
            level, playerLevel: SF.progression.level, tier: s >= 0 ? reg.tier[s] : null,
            hpMax: s >= 0 ? +reg.hpMax[s].toFixed(1) : null,
            rowHpAtLevel: +rowHp.toFixed(1),
            hpRatio: s >= 0 ? +(reg.hpMax[s] / rowHp).toFixed(3) : null,
            tint,
            events: H.since(i0, "bounty:revealed"),
        };
    };

    H.bountyKill = async (k) => {
        const i0 = log.length;
        const P = SF.progression;
        const before = { level: P.level, xp: P.xp, xpNeed: P.xpNeed };
        const id = bounties.liveId[k];
        const s = reg.slot(id);
        if (s < 0) return { err: "bounty not live" };
        reg.damage(id, reg.hp[s] + 100, { tag: "probe" });
        const killed = await H.waitFor(() => H.since(i0, "bounty:killed").length > 0, 5);
        await H.gameWait(0.3);
        const after = { level: P.level, xp: P.xp, xpNeed: P.xpNeed };
        return {
            killed, isKilled: bounties.isKilled(STORY.bounties[bounties.realm][k].id),
            before, after,
            events: H.since(i0).filter((e) => e.t === "bounty:killed" || e.t === "reward" ||
                e.t === "enemy:killed"),
        };
    };

    // ------------------------------------------------------------ visuals
    /** Let the camera spring arrive (GAME seconds — at 0.6 fps a wall-clock
     *  wait is under one frame), then report where it is. */
    H.settle = async (sec) => {
        await H.gameWait(sec);
        await H.frames(2);
        const c = SF.rig.camera.position, p = SF.character.position;
        return { cam: [+c.x.toFixed(1), +c.y.toFixed(1), +c.z.toFixed(1)],
            rider: [+p.x.toFixed(1), +p.y.toFixed(1), +p.z.toFixed(1)],
            camToRider: +Math.hypot(c.x - p.x, c.z - p.z).toFixed(1) };
    };
    /** World -> CSS pixel of the 1280x720 viewport through the live camera
     *  (null behind the camera). */
    H.project = (x, y, z) => {
        const cam = SF.rig.camera;
        cam.updateMatrixWorld();
        const V = cam.matrixWorldInverse.elements, P = cam.projectionMatrix.elements;
        const vx = V[0] * x + V[4] * y + V[8] * z + V[12];
        const vy = V[1] * x + V[5] * y + V[9] * z + V[13];
        const vz = V[2] * x + V[6] * y + V[10] * z + V[14];
        const cx = P[0] * vx + P[4] * vy + P[8] * vz + P[12];
        const cy = P[1] * vx + P[5] * vy + P[9] * vz + P[13];
        const cw = P[3] * vx + P[7] * vy + P[11] * vz + P[15];
        if (cw <= 0) return null;
        const w = innerWidth, h = innerHeight;
        return [+((cx / cw * 0.5 + 0.5) * w).toFixed(1), +((1 - (cy / cw * 0.5 + 0.5)) * h).toFixed(1),
            +Math.hypot(x - cam.position.x, z - cam.position.z).toFixed(1)];
    };
    /** Hold the rider where it stands (a parked rider slides on a slope and
     *  drags the camera between an A/B pair). */
    H.pinHere = () => {
        const p = SF.character.position, f = SF.character.facing, yaw = SF.rig.yaw;
        const x = p.x, z = p.z;
        H.steer = () => { H.tp(x, z); SF.character.facing = f; SF.rig.yaw = yaw; };
    };
    H.unpin = () => { H.steer = null; };
    /** A rider spot `dist` m from (x, z) whose CAMERA (about 12 m further
     *  back, ~4 m up) sees the point (x, yTop, z) over the terrain — so a
     *  dune between is not what a visibility test measures. Null if none of
     *  24 bearings is clear. */
    H.clearView = (x, z, yTop, dist) => {
        const T = SF.terrain;
        for (let b = 0; b < 24; b++) {
            const a = b * Math.PI * 2 / 24;
            const px = x + Math.sin(a) * dist, pz = z - Math.cos(a) * dist;
            if (Math.hypot(px, pz) > 500) continue;
            const cx = x + Math.sin(a) * (dist + 12), cz = z - Math.cos(a) * (dist + 12);
            const ey = T.heightAt(cx, cz) + 4;
            let ok = true;
            for (let s = 1; s < 80 && ok; s++) {
                const f = s / 80;
                if (T.heightAt(cx + (x - cx) * f, cz + (z - cz) * f) > ey + (yTop - ey) * f - 0.3) ok = false;
            }
            if (ok) return { px, pz, facing: Math.atan2(x - px, -(z - pz)), bearing: b };
        }
        return null;
    };
    /** Stand the rider `dist` m from (x, z) on the side toward the world
     *  centre, facing it, turned `yawOff` rad away so the rider's own body
     *  does not hide a low object dead ahead. */
    H.faceFrom = (x, z, dist, yawOff) => {
        const r = Math.hypot(x, z) || 1;
        const ux = -x / r, uz = -z / r;
        const px = x + ux * dist, pz = z + uz * dist;
        H.tp(px, pz, Math.atan2(x - px, -(z - pz)) + (yawOff === undefined ? 0.3 : yawOff));
        SF.rig.pitch = 0.12;
        return [px, pz];
    };

    // ---------------------------------------------------------------- beacon
    H.beaconAt = (dist) => {
        // Rider at (-dist/2, 0) facing +x; waypoint dist ahead.
        const x0 = -dist / 2, z0 = 0;
        H.tp(x0, z0, Math.PI / 2);
        const wx = x0 + dist, wz = z0;
        bus.emit("quest:waypoint", { x: wx, z: wz, realm: caches.realm, label: "probe" });
        return { rider: [x0, z0], waypoint: [wx, wz] };
    };

    // ------------------------------------------------------------- draws
    H.drawDelta = async (n) => {
        const sample = async () => {
            let sum = 0;
            for (let i = 0; i < n; i++) { await H.frames(1); sum += SF.perfStats.drawCalls; }
            return sum / n;
        };
        H.hide = false;
        await H.frames(4);
        const on = await sample();
        const vis = { caches: caches.draws, trials: trials.draws, bounties: bounties.draws,
            beacon: beacon.draws };
        H.hide = true;
        await H.frames(4);
        const off = await sample();
        H.hide = false;
        await H.frames(2);
        return { drawsOn: on, drawsOff: off, delta: +(on - off).toFixed(2), perSystem: vis };
    };

    return { ok: true, realm: SF.landmarks.realm, level: SF.progression.level,
        hasRegisterSaveSection: typeof SF.progression.registerSaveSection === "function",
        bountyOfHook: typeof SF.progression.bountyOf === "function", laneR };
})()
