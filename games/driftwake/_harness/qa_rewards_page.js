// qa_rewards_page.js -- in-page step library for _harness/qa_rewards.py (lane R).
// Evaluated once per page load; defines window.__qa with async steps that the
// Python driver calls one at a time (UI clicks happen in Python between them).
// Every step returns MEASURED values; the driver prints them verbatim.
(() => {
    const SF = globalThis.SNOWFLOW;
    const reg = SF.combat.registry, T = SF.terrain, C = SF.character;
    const sp = SF.spells, P = SF.progression, EN = SF.combat.enemies;
    const Q = { log: [], errors: [] };
    const gameWait = (sec) => new Promise((res) => {
        const t0 = reg.time;
        const tick = () => (reg.time - t0 >= sec) ? res() : requestAnimationFrame(tick);
        tick();
    });
    const frames = (n) => new Promise((res) => {
        let k = 0;
        const tick = () => (++k >= n) ? res() : requestAnimationFrame(tick);
        requestAnimationFrame(tick);
    });
    const r4 = (x) => Math.round(x * 10000) / 10000;
    const flatAim = () => {
        const l = Math.hypot(sp.aim.x, sp.aim.z) || 1;
        return { x: sp.aim.x / l, z: sp.aim.z / l };
    };
    const mkTarget = (x, z, tier) => reg.register({
        x, y: T.heightAt(x, z), z, radius: 0.5, height: 1.8,
        tier: tier === undefined ? 2 : tier, level: 10, hp: 4000, poiseMax: 1e9,   // 4000, not 1e6: Float32 hp quantizes 1e6 to 1/16
        name: "QA Target", kind: "enemy",
    });
    const drop = (id) => { if (reg.slot(id) >= 0) reg.remove(id); };

    // ------------------------------------------------------------------ setup
    Q.setup = async () => {
        // [lane INT] The INTEGRATED build: main.js constructs and drives the
        // lane-R systems itself (SNOWFLOW.rewards; shared ctx SNOWFLOW.meaning;
        // its enterRealm emits 'realm:entered'). Reuse them — a second set
        // would double every listener (two wallets crediting one reward).
        // The Wake Glass counter in that build is the HUD pill (hud.js), not
        // GlassCounter, so `m.glass` is null there.
        if (SF.rewards && SF.meaning) {
            const bus = SF.bus;
            SF.combat.encounters.update = () => {};
            SF.combat.bosses.update = () => {};
            EN.clear();
            const R = SF.rewards;
            Q.ctx = SF.meaning; Q.bus = bus;
            Q.m = { mods: R.mods, relics: R.relics, boons: R.boons, shop: R.shop, pick: R.boonPick,
                toast: R.driftToast, menu: R.shrineMenu, glass: null };
            const EVS = ["boon:offer", "boon:chosen", "relic:equipped", "glass:changed",
                "reward", "shop:bought", "boon:triggered", "driftmark:offer",
                "driftmark:chosen", "shrine:travelled", "ui:open", "ui:close",
                "shrine:activated"];
            for (const ev of EVS) bus.on(ev, (p) => Q.log.push([ev, JSON.parse(JSON.stringify(p || null))]));
            return {
                integrated: true,
                sections: P._sections ? P._sections.map((s) => s.name) : "NO registerSaveSection",
                wired: { controller: C.mods === R.mods, spells: sp.mods === R.mods,
                    spellHits: SF.combat.spellHits.mods === R.mods,
                    enemiesWrapped: !!EN.__rewardsWrapped },
                testMode: P.testMode,
            };
        }
        const bus = (await import("/games/driftwake/src/quests/events.js")).bus;
        const M = await import("/games/driftwake/src/progression/modifiers.js");
        const B = await import("/games/driftwake/src/progression/boons.js");
        const R = await import("/games/driftwake/src/progression/relics.js");
        const S = await import("/games/driftwake/src/progression/shop.js");
        const BP = await import("/games/driftwake/src/ui/boonPick.js");
        const SM = await import("/games/driftwake/src/ui/shrineMenu.js");
        // PROBE-ONLY: quiet both directors so no pack or arena lands on the
        // measurements, and clear whatever spawned during boot.
        SF.combat.encounters.update = () => {};
        SF.combat.bosses.update = () => {};
        EN.clear();
        // What the integrator's enterRealm hook will do (lane Q contract):
        // announce the realm so progression labels shrine activations.
        const enterRealm = async (t) => {
            const r = await SF.enterRealm(t);
            bus.emit("realm:entered", { realm: t });
            return r;
        };
        const ctx = {
            scene: SF.scene, terrain: T, character: C, rig: SF.rig, spells: sp,
            spellHits: SF.combat.spellHits, registry: reg, enemies: EN,
            encounters: SF.combat.encounters, bosses: SF.combat.bosses,
            portal: SF.portal, shrine: SF.shrine, landmarks: SF.landmarks,
            progression: P, realms: SF.realms, enterRealm,
            getRealm: () => SF.shrine.realm, input: SF.input, S: SF.S, bus,
            crystals: sp.crystals, sky: SF.sky, shadows: SF.shadows,
            overlay: SF.overlay, motes: SF.motes, wake: SF.wake,
        };
        const mods = new M.Modifiers(ctx);
        const relics = new R.Relics(ctx);
        const boons = new B.Boons(ctx);
        const shop = new S.Shop(ctx);
        const pick = new BP.BoonPick(ctx);
        const toast = new BP.DriftmarkToast(ctx);
        const menu = new SM.ShrineMenu(ctx);
        const glass = new SM.GlassCounter(ctx);
        Q.ctx = ctx; Q.bus = bus;
        Q.m = { mods, relics, boons, shop, pick, toast, menu, glass };
        Q.lib = { M, B, R, S, BP, SM };
        const EVS = ["boon:offer", "boon:chosen", "relic:equipped", "glass:changed",
            "reward", "shop:bought", "boon:triggered", "driftmark:offer",
            "driftmark:chosen", "shrine:travelled", "ui:open", "ui:close",
            "shrine:activated"];
        for (const ev of EVS) bus.on(ev, (p) => Q.log.push([ev, JSON.parse(JSON.stringify(p || null))]));
        let last = reg.time;
        const all = [mods, relics, boons, shop, pick, toast, menu];
        const loop = () => {
            const now = reg.time;
            const dt = now - last;
            last = now;
            try {
                for (let i = 0; i < all.length; i++) all[i].update(dt);
                glass.update(dt);
            } catch (e) { Q.errors.push(String(e && e.stack || e)); }
            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
        return {
            sections: P._sections ? P._sections.map((s) => s.name) : "NO registerSaveSection",
            wired: { controller: C.mods === mods, spells: sp.mods === mods,
                spellHits: SF.combat.spellHits.mods === mods,
                enemiesWrapped: !!EN.__rewardsWrapped },
            testMode: P.testMode,
        };
    };

    /** Fresh run at level 10 (the anchor: 100 HP, damageMult 1). */
    Q.fresh = async () => {
        P.newGame();
        P.level = 10; P.xp = 0; P._refreshNeed(); P._applyLevelStats(true);
        await frames(3);
        const m = Q.m;
        return {
            level: P.level, hp: C.health, hpMax: C.healthMax, manaMax: C.manaMax,
            damageMult: SF.combat.spellHits.damageMult,
            glass: m.shop.glass, boons: m.boons.activeIds(), relics: m.relics.equipped,
            litCold: P.litShrines("cold").slice(),
        };
    };

    // ------------------------------------------------------- measurement kit
    /** One Crystal Spikes cast on a fresh pinned target; damage dealt. */
    Q.spikeHit = async (prep) => {
        // A formation from an EARLIER cast at the same aim point can still be
        // planting (cooldownOf(4) leaves after 1.2 s; planting ends at
        // 0.95 + 0.85 s) and would hit this target too (run 2: 60 = 2 x 30).
        for (let k = 0; k < 600 && (sp.crystallize.active || sp._pending.key); k++) await frames(1);
        sp._cdUntil[4] = 0;
        C.mana = C.manaMax;
        sp.cast(4);
        const p = sp._pending;
        if (p.key !== 4) return { err: "spikes not scheduled" };
        const id = mkTarget(p.a0, p.a2);
        const slot = reg.slot(id);
        if (prep) prep(slot, id);
        const hp0 = reg.hp[slot];
        await gameWait(2.2);
        const dealt = hp0 - reg.hp[reg.slot(id)];
        drop(id);
        return dealt;
    };

    /** One Frost Arc on a fresh target 3.5 m ahead; state after the hit. */
    Q.arcHit = async (prep, keep) => {
        sp._cdUntil[7] = 0;
        const f = flatAim();
        const id = mkTarget(C.position.x + f.x * 3.5, C.position.z + f.z * 3.5);
        const slot = reg.slot(id);
        if (prep) prep(slot, id);
        const hp0 = reg.hp[slot];
        sp.cast(7);
        await frames(3);
        const s = reg.slot(id);
        const out = {
            dealt: r4(hp0 - reg.hp[s]), chill: reg.chill[s],
            brittle: reg.time < reg.brittleUntil[s], speedMult: r4(reg.speedMult(id)),
            id,
        };
        if (!keep) drop(id);
        return out;
    };

    /** Surf cap: pin a surf at 30 m/s along facing; the controller clamps it. */
    Q.surfCap = async () => {
        const inp = SF.input;
        const x0 = C.position.x, z0 = C.position.z;
        inp.surf = true;
        const out = [];
        for (let k = 0; k < 4; k++) {
            C.surf = 1;
            const f = C.facing;
            C.velocity.set(Math.sin(f) * 30, 0, -Math.cos(f) * 30);
            await frames(1);
            out.push(r4(C.speed));
        }
        inp.surf = false;
        C.velocity.set(0, 0, 0);
        C.position.set(x0, T.heightAt(x0, z0), z0);
        await frames(2);
        return out[out.length - 1];
    };

    /** Surf-ollie apex, m (held SPACE, full surf blend). */
    Q.ollieApex = async () => {
        const inp = SF.input;
        const x0 = C.position.x, z0 = C.position.z;
        await gameWait(0.3);
        inp.surf = true;
        C.surf = 1;
        C.velocity.set(0, 0, 0);
        inp.jump = true;
        inp.jumpPressed = true;
        let apex = 0, sawAir = false, v0 = 0, last = reg.time;
        for (let k = 0; k < 200; k++) {
            C.surf = 1;
            C.velocity.set(0, 0, 0);
            await frames(1);
            const dt = reg.time - last;
            last = reg.time;
            // Take-off frame: the controller set vertVel = v0 and then
            // integrated one step of gravity (GRAVITY 20, step min(dt, 1/30)).
            if (C.airborne && !sawAir) v0 = C.vertVel + 20 * Math.min(dt, 1 / 30);
            if (C.airborne) sawAir = true;
            apex = Math.max(apex, C.airHeight);
            if (sawAir && !C.airborne) break;
        }
        inp.jump = false;
        inp.surf = false;
        C.velocity.set(0, 0, 0);
        C.position.set(x0, T.heightAt(x0, z0), z0);
        await gameWait(0.3);
        // Apex height of the take-off speed, exactly (v0^2 / 2g).
        return { apex: r4(apex), v0: r4(v0), height: r4(v0 * v0 / 40) };
    };

    /**
     * Mana regen as a MEASURED multiplier of the controller's base rate:
     * mana gained per frame ÷ (manaRegen × the controller's own step
     * min(dt, 1/30)), summed over 1.5 s — frame-rate independent.
     */
    Q.regen = async () => {
        C.mana = 0;
        await frames(1);
        let gained = 0, nominal = 0, t = 0;
        let last = reg.time, m = C.mana;
        while (t < 1.5) {
            await frames(1);
            const dt = reg.time - last;
            last = reg.time;
            t += dt;
            gained += C.mana - m;
            m = C.mana;
            nominal += C.manaRegen * Math.min(dt, 1 / 30);
        }
        return r4(gained / nominal);
    };

    /** A point `dist` m from the player on the flattest of 16 bearings. */
    Q.flatPoint = (dist) => {
        const y0 = T.heightAt(C.position.x, C.position.z);
        let best = null, bd = 1e9;
        for (let k = 0; k < 16; k++) {
            const a = k * Math.PI / 8;
            const x = C.position.x + Math.cos(a) * dist, z = C.position.z + Math.sin(a) * dist;
            const d = Math.abs(T.heightAt(x, z) - y0);
            if (d < bd) { bd = d; best = { x, z, dh: d }; }
        }
        return best;
    };

    /** The bolt's leash (metres on fire) and its measured flight distance. */
    Q.boltRange = async () => {
        const rig = SF.rig;
        const pitch0 = rig.pitch;
        rig.pitch = -0.6;           // look up: nothing to hit inside 50 m
        await frames(2);
        sp._boltNext = 0;
        const pool = sp.bolt;
        const gens = Array.from(pool.gen);
        sp.cast(6);
        let slot = -1;
        for (let i = 0; i < pool.gen.length; i++) if (pool.gen[i] !== gens[i] && !pool.own[i]) slot = i;
        if (slot < 0) { rig.pitch = pitch0; return { err: "no bolt" }; }
        const leash = pool.left[slot];
        const x0 = pool.x[slot], y0 = pool.y[slot], z0 = pool.z[slot];
        let far = 0;
        for (let k = 0; k < 400 && pool.alive[slot]; k++) {
            far = Math.max(far, Math.hypot(pool.x[slot] - x0, pool.y[slot] - y0, pool.z[slot] - z0));
            await frames(1);
        }
        rig.pitch = pitch0;
        return { leash: r4(leash), flew: r4(far) };
    };

    /** Heavy (or other) melee hit through the REAL enemy damage path. */
    Q.meleeHit = (key) => {
        const f = flatAim();
        const ex = C.position.x + f.x * 1.1, ez = C.position.z + f.z * 1.1;
        const rid = EN.spawn(key, ex, ez, 10);
        let i = -1;
        for (let n = 0; n < EN.alive.length; n++) if (EN.alive[n] && EN.id[n] === rid) i = n;
        if (i < 0) return { err: "spawn failed " + key };
        const u = EN.units[EN.unitOf[i]];
        EN.yaw[i] = Math.atan2(C.position.x - EN.x[i], -(C.position.z - EN.z[i]));
        let lost = 0, used = -1;
        for (let d = 0; d < u.aKind.length && lost === 0; d++) {
            C.health = C.healthMax;
            EN._pIFrameUntil = 0;
            const h0 = C.health;
            EN._applyHit(i, u, d, 1.1, 0, 0);
            lost = h0 - C.health;
            if (lost > 0) used = d;
        }
        const raw = used >= 0 ? u.aDmg[used] * EN.dmgScale[i] : 0;
        EN.despawn(rid);
        C.health = C.healthMax;
        EN._pIFrameUntil = 0;
        return { key, tier: u.tier, attack: used, raw: r4(raw), lost: r4(lost) };
    };

    /** Frames the Great Vortex lives, and damage to a target at `dist` m. */
    Q.vortex = async (dist) => {
        sp._cdUntil[5] = 0;
        C.mana = C.manaMax;
        const fp = dist ? Q.flatPoint(dist) : null;
        const id = dist ? mkTarget(fp.x, fp.z) : -1;
        const hp0 = id >= 0 ? reg.hp[reg.slot(id)] : 0;
        sp.cast(5);
        // wait for the strike, then time the spell's life in GAME seconds
        for (let k = 0; k < 300 && !sp.vortex.active; k++) await frames(1);
        const t0 = reg.time;
        for (let k = 0; k < 2000 && sp.vortex.active; k++) await frames(1);
        const life = reg.time - t0;
        const dealt = id >= 0 ? hp0 - reg.hp[reg.slot(id)] : 0;
        if (id >= 0) drop(id);
        return { life: r4(life), dealt: r4(dealt) };
    };

    /** Mote heal as a fraction of max HP (one mote at the feet). */
    Q.moteHeal = async () => {
        const mo = SF.motes;
        C.health = Math.round(C.healthMax * 0.2);
        const h0 = C.health, p0 = mo.stats.picked;
        mo.spawnAt(C.position.x, C.position.z, 1);
        for (let k = 0; k < 400 && mo.stats.picked === p0; k++) await frames(1);
        await frames(3);   // the Wakemender bonus lands the frame after
        return { picked: mo.stats.picked - p0, frac: r4((C.health - h0) / C.healthMax) };
    };

    /** Ember Coil: two bolts down one line; the second hits a pinned target. */
    Q.igniteBurn = async () => {
        const pool = sp.bolt;
        sp._boltNext = 0;
        let gens = Array.from(pool.gen);
        sp.cast(6);
        let s0 = -1;
        for (let i = 0; i < pool.gen.length; i++) if (pool.gen[i] !== gens[i] && !pool.own[i]) s0 = i;
        if (s0 < 0) return { err: "no bolt" };
        const v = Math.hypot(pool.vx[s0], pool.vy[s0], pool.vz[s0]);
        const dx = pool.vx[s0] / v, dy = pool.vy[s0] / v, dz = pool.vz[s0] / v;
        const px = pool.x[s0] + dx * 6, py = pool.y[s0] + dy * 6, pz = pool.z[s0] + dz * 6;
        await gameWait(0.6);
        const id = reg.register({ x: px, y: py - 0.9, z: pz, radius: 0.5, height: 1.8, tier: 2,
            level: 10, hp: 4000, poiseMax: 1e9, name: "QA Target", kind: "enemy" });
        const c0 = Q.m.mods.counters.igniteTicks, d0 = Q.m.mods.counters.igniteDamage;
        const hpA = reg.hp[reg.slot(id)];
        sp._boltNext = 0;
        gens = Array.from(pool.gen);
        sp.cast(6);
        let hpHit = hpA;
        for (let k = 0; k < 60; k++) {
            await frames(1);
            hpHit = reg.hp[reg.slot(id)];
            if (hpHit < hpA) break;
        }
        const direct = hpA - hpHit;
        await gameWait(2.6);
        const burn = hpHit - reg.hp[reg.slot(id)];
        drop(id);
        return { direct: r4(direct), burn: r4(burn),
            ticks: Q.m.mods.counters.igniteTicks - c0,
            igniteDmg: r4(Q.m.mods.counters.igniteDamage - d0) };
    };

    /** A cast's cooldown in seconds, read the instant after it is spent. */
    Q.cooldownOf = async (key) => {
        sp._cdUntil[key] = 0;
        C.mana = C.manaMax;
        sp.cast(key);
        const cd = sp.cooldownLeft(key);
        await gameWait(1.2);   // let the scheduled strike resolve
        return r4(cd);
    };

    /** The wave's birth-swell hit on a target 1 m ahead: damage + knockback. */
    Q.waveHit = async () => {
        sp._cdUntil[1] = 0;
        C.mana = C.manaMax;
        const f = flatAim();
        const id = mkTarget(C.position.x + f.x * 1.0, C.position.z + f.z * 1.0);
        const slot = reg.slot(id);
        const hp0 = reg.hp[slot];
        sp.cast(1);
        let hit = 0, kb = 0;
        for (let k = 0; k < 200; k++) {
            await frames(1);
            const s = reg.slot(id);
            if (reg.hp[s] < hp0) {
                hit = hp0 - reg.hp[s];
                kb = Math.hypot(reg.kbX[s], reg.kbZ[s]);
                break;
            }
        }
        drop(id);
        return { dealt: r4(hit), kb: r4(kb), env: r4(SF.combat.spellHits._qEnv) };
    };

    // ------------------------------------------------------------ boon flows
    /** A first boss kill, as lane Q's bossEncounters emits it. */
    Q.bossKill = (realm, kind, name) => {
        Q.bus.emit("boss:killed", { realm, kind, key: "qa." + realm + "." + kind,
            name: name || null, first: true, combatKey: null, x: 0, z: 0 });
        return { pending: Q.m.boons.pending.slice() };
    };

    /** Wait for a modal to open: up to `sec` seconds of GAME time (the
     *  machine may be frame-starved; wall time would lie), with a 15-minute
     *  wall backstop. */
    Q.waitModal = async (sel, sec) => {
        const t0 = reg.time, w0 = performance.now();
        while (reg.time - t0 < (sec || 10) && performance.now() - w0 < 900000) {
            const el = document.querySelector(sel);
            if (el && el.classList.contains("open")) return true;
            await frames(1);
        }
        const el = document.querySelector(sel);
        return !!(el && el.classList.contains("open"));
    };

    Q.modalState = () => {
        const bp = document.getElementById("dw-boonpick");
        const sm = document.getElementById("dw-shrine");
        return {
            boonOpen: !!(bp && bp.classList.contains("open")),
            shrineOpen: !!(sm && sm.classList.contains("open")),
            freeze: SF.S.freezeTime,
            boonKicker: bp ? bp.querySelector(".dwr-kicker").textContent : "",
            boonTitle: bp ? bp.querySelector(".dwr-title").textContent : "",
            cards: bp ? Array.from(bp.querySelectorAll(".dwr-card")).map((c) =>
                c.querySelector(".dwr-cname").textContent + " | " +
                c.querySelector(".dwr-ceff").textContent) : [],
            shrineTitle: sm ? sm.querySelector(".dwr-title").textContent : "",
            purse: sm ? sm.querySelector(".dwr-purse").textContent : "",
            pane: sm ? sm.querySelector(".dwr-pane").innerText.slice(0, 600) : "",
        };
    };

    // ------------------------------------------------------------- shrines
    Q.goto = async (realm, id) => {
        const pos = SF.shrine.positions;
        const p = pos.find((q) => q.id === id);
        C.position.set(p.sx, T.heightAt(p.sx, p.sz), p.sz);
        C.velocity.set(0, 0, 0);
        SF.rig._first = true;
        await frames(4);
        return { realm: SF.shrine.realm, lit: P.isShrineLit(realm, id),
            reach: Q.m.menu.reach, lastShrine: P.lastShrineId };
    };

    Q.where = () => {
        const pos = SF.shrine.positions;
        const out = { realm: SF.shrine.realm, x: r4(C.position.x), z: r4(C.position.z),
            freeze: SF.S.freezeTime, menuOpen: Q.m.menu.isOpen, nearest: null, d: 1e9 };
        for (const p of pos) {
            const d = Math.hypot(p.sx - C.position.x, p.sz - C.position.z);
            if (d < out.d) { out.d = r4(d); out.nearest = p.id; }
        }
        return out;
    };

    Q.state = () => {
        const m = Q.m;
        return {
            boons: m.boons.activeIds(), picks: Object.assign({}, m.boons.picks),
            pending: m.boons.pending.slice(),
            relicsOwned: m.relics.owned.slice(), relicsEquipped: m.relics.equipped.slice(),
            slot3: m.relics.slot3Unlocked, glass: m.shop.glass,
            shop: Object.assign({}, m.shop.ranks), rerolls: m.shop.rerolls, trail: m.shop.trail,
            drift: Object.assign({}, m.mods.driftPicks), marks: P.driftmarks,
            maxHpMult: r4(m.mods.maxHp), hpMax: C.healthMax, hpBase: C._healthMaxBase,
            level: P.level,
        };
    };

    window.__qa = Q;
    return "qa ready";
})()
