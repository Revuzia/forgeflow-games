# -*- coding: utf-8 -*-
"""
qa_shrinenet.py -- the seven-shrine respawn network, end to end, live.

Proves three fixes, each against the mechanism it broke:

  D1  ACTIVATION BY TOUCH. `lastShrineId` was writable only by `addShrine()`
      (zero call sites), the "cold_spawn" default and the save blob, so every
      death in every realm resolved to the spawn monument. This probe WALKS in
      from 14 m in 0.4 m steps -- one step per frame, never a teleport, so a
      "the trigger needs a continuous approach" reading cannot save the old
      code -- for all six ring shrines in cold, sand AND ash, and reads
      `lastShrineId` every frame. It also reads the localStorage blob WITHOUT
      calling save(), which is what shows the activation edge saved by itself,
      and then scrambles the field and calls load() to show it round-trips.

  D2  RESPAWN OFF THE PRISM. `_respawn()` wrote the anchor verbatim and the
      anchor is the monolith's own axis (0.34 m radius, 3.6 m tall), so the
      player materialised inside the ice. This probe dies 8-10 m from three
      different ring shrines, one per realm, snapshots the position on the
      frame the respawn lands, and measures the distance to the monolith axis,
      the distance to the published stand point, the height above ground, and
      the worst clearance against ALL TWELVE prisms of that formation, read
      out of the shrine's own data texture.

  D3  PER-REALM FLAT-SPOT SCAN. Both layers nudged to flat ground in their
      constructors -- against COLD's heightfield -- and never re-scanned. This
      probe records sand's and ash's landmark anchors BEFORE either realm is
      ever entered (the constructor values) and again after entering, reports
      how far they moved, and per realm reports every shrine's stand-point
      grade, every landmark's base-vs-heightAt delta and the minimum shrine
      clearance. It then cycles cold -> sand -> ash -> cold and asserts cold
      comes back to the same anchors, because a scan that is not deterministic
      is not a fix.

All waits are GAME time (SNOWFLOW.combat.registry.time polled through rAF) or
raw frames -- never wall-clock sleeps for game state.

PROBE-LOCAL MONKEYPATCH, disclosed: `encounters.update` is stubbed to a no-op
after boot so the spawn director cannot drop an enemy on the walk path and
kill the player mid-measurement. Nothing else is patched; the death arm sets
health to 0 directly, which is the same edge a real death takes.

Usage:  python _harness/qa_shrinenet.py            (port 8912)
"""
import json
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[3]
PORT = 8912
GAME_URL = "http://localhost:%d/games/driftwake/index.html?autoplay&test" % PORT
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion"]

REALMS = ["cold", "sand", "ash"]
# One death arm per realm, at a DIFFERENT ring shrine each time.
DEATH_AT = {"cold": 1, "sand": 3, "ash": 5}
# Distance from the anchor the death is taken at, m (outside the 6 m radius).
DEATH_DIST = {"cold": 8.0, "sand": 9.0, "ash": 10.0}

PRELUDE = r"""
window.__sn = (function () {
    const SF = SNOWFLOW, T = SF.terrain, reg = SF.combat.registry;
    const P = SF.progression, c = SF.character, SH = SF.shrine, LM = SF.landmarks;

    // Spawn director off: it must not drop a pack on the walk path. Disclosed
    // in the module docstring; nothing else is patched.
    SF.combat.encounters.update = function () {};
    SF.combat.enemies.clear();

    const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
    const rafs = async (n) => { for (let i = 0; i < n; i++) await raf(); };
    /** GAME-time wait: polls the combat registry clock, never wall-clock. */
    const gwait = (sec) => new Promise((res) => {
        const t0 = reg.time;
        const t = () => (reg.time - t0 >= sec) ? res() : requestAnimationFrame(t);
        requestAnimationFrame(t);
    });
    const put = (x, z) => {
        c.position.x = x; c.position.z = z; c.position.y = T.heightAt(x, z);
        c.velocity.set(0, 0, 0);
        c.vertVel = 0; c.airborne = false; c.airHeight = 0;
    };
    const heal = () => { c.health = c.healthMax; c.mana = c.manaMax; };
    const f2 = (v) => +v.toFixed(2);
    const f3 = (v) => +v.toFixed(3);

    /** |grad h| by central differences over 4 m -- shrine.js's `gradeAt`. */
    const grade = (x, z) => {
        const gx = (T.heightAt(x + 2, z) - T.heightAt(x - 2, z)) / 4;
        const gz = (T.heightAt(x, z + 2) - T.heightAt(x, z - 2)) / 4;
        return Math.hypot(gx, gz);
    };

    const PRISMS_PER = 12;
    const nPrisms = () => SH._texData.length / 12;   // 3 rows x 4 floats each

    /** Worst (distance - prismRadius) from (x,z) to shrine s's 12 prisms.
     *  Negative = the player is INSIDE a prism's footprint. */
    function prismClear(s, x, z) {
        const d = SH._texData, w = nPrisms() * 4;
        let m = Infinity, at = -1, rad = 0;
        for (let q = 0; q < PRISMS_PER; q++) {
            const o = (s * PRISMS_PER + q) * 4;
            const v = Math.hypot(x - d[o], z - d[o + 2]) - d[w + o + 3];
            if (v < m) { m = v; at = q; rad = d[w + o + 3]; }
        }
        return { clear: f3(m), prism: at, prismRad: f3(rad) };
    }

    /** localStorage's view of the respawn target -- read, never written. */
    function blobId() {
        try {
            const b = JSON.parse(localStorage.getItem("driftwake_save"));
            return b ? b.lastShrineId : null;
        } catch (e) { return "<unreadable>"; }
    }

    /* ------------------------------------------------------- D1: touch */

    /** Walk into ring shrine `i` from 14 m out, 0.4 m per FRAME. */
    async function walkIn(i) {
        const a = SH.positions[i];
        const before = P.lastShrineId;
        const acts0 = P.shrineActivations;
        let firstAt = null;
        const trace = [];
        for (let s = 0; s <= 30; s++) {
            const dist = 14 - s * 0.4;
            heal(); put(a.x + dist, a.z);
            await raf();
            heal();
            if (firstAt === null && P.lastShrineId === a.id) firstAt = f2(dist);
            if (s % 5 === 0) trace.push([f2(dist), P.lastShrineId]);
        }
        // The blob BEFORE anyone calls save(): the activation edge must have
        // written it by itself.
        const edgeBlob = blobId();
        const actsAtTouch = P.shrineActivations;
        // Dwell 2 s of GAME time standing on it: the edge guard must not
        // re-activate or re-save once per frame.
        await gwait(2);
        const dwellActs = P.shrineActivations - actsAtTouch;

        // Round-trip: scramble the live field, load() from the blob. Only
        // meaningful when a blob EXISTS -- on the very first walk of a fresh
        // profile nothing has saved yet, and `load()` correctly declines to
        // partially apply a missing blob, so scrambling there would be the
        // probe testing its own vandalism.
        let afterLoad = "(no blob yet)";
        if (edgeBlob !== null) {
            P.lastShrineId = "__scrambled__";
            P.load();
            afterLoad = P.lastShrineId;
        }

        return {
            shrine: a.id, before: before, after: P.lastShrineId,
            firstAtM: firstAt, edgeBlob: edgeBlob, afterLoad: afterLoad,
            acts: P.shrineActivations - acts0, dwellActs: dwellActs,
            trace: trace,
        };
    }

    /* ------------------------------------------------------ D2: respawn */

    async function dieNear(i, dist) {
        const a = SH.positions[i];
        // Activate THIS shrine first -- otherwise the arm measures whichever
        // shrine the walk loop happened to leave active, which is exactly the
        // false negative the first run of this probe produced.
        const walk = await walkIn(i);
        heal(); put(a.x + dist, a.z);
        await rafs(4);
        heal();
        const idAtDeath = P.lastShrineId;
        const dAtDeath = f2(Math.hypot(c.position.x - a.x, c.position.z - a.z));
        const deaths0 = P.deaths;

        c.health = 0;
        const t0 = reg.time;
        let sawDead = false;
        await new Promise((res) => {
            const t = () => {
                if (P.dead) sawDead = true;
                else if (sawDead) return res();
                if (reg.time - t0 > 15) return res();
                requestAnimationFrame(t);
            };
            requestAnimationFrame(t);
        });
        // The frame the respawn landed on.
        const px = c.position.x, pz = c.position.z, py = c.position.y;
        // ...and settled, half a second of game time later.
        await gwait(0.5);
        const sx = c.position.x, sz = c.position.z, sy = c.position.y;

        return {
            shrine: a.id, activatedBy: walk.after,
            idAtDeath: idAtDeath, diedAtM: dAtDeath,
            deathsDelta: P.deaths - deaths0, respawnedTo: P.lastShrineId,
            anchor: [f2(a.x), f2(a.z)], stand: [f2(a.sx), f2(a.sz)],
            landed: [f2(px), f2(pz)],
            dFromAnchor: f2(Math.hypot(px - a.x, pz - a.z)),
            dFromStand: f2(Math.hypot(px - a.sx, pz - a.sz)),
            prism: prismClear(i, px, pz),
            groundDy: f3(py - T.heightAt(px, pz)),
            settled: [f2(sx), f2(sz)],
            settledGroundDy: f3(sy - T.heightAt(sx, sz)),
            settledFromAnchor: f2(Math.hypot(sx - a.x, sz - a.z)),
            settledPrism: prismClear(i, sx, sz),
        };
    }

    /* -------------------------------------------------- D3: realm scans */

    /** Every live landmark anchor in the CURRENT realm, for drift diffs. */
    function anchors(realm) {
        return LM.instances.filter((s) => s.realm === realm)
            .map((s) => [f2(s.x), f2(s.z)]);
    }

    /** |grad h| of a list of [x, z] under the LIVE heightfield. This is how
     *  the D3 fix is scored: the constructor's anchors were chosen on COLD's
     *  landform, so under sand/ash they should measure STEEPER than the ones
     *  the per-realm re-scan picks. */
    function grades(pts) {
        return pts.map((p) => f3(grade(p[0], p[1])));
    }

    /**
     * Seat forensics for one landmark instance, over ALL of its prisms.
     *
     * `_baseOff` is subtracted first: the Glacier Gate's lintel is placed
     * 20+ m ABOVE its seat on purpose, and a probe that forgets that reports
     * a 23 m "float" for a working formation (it did, first run).
     *
     *   seatErr  (base - baseOff) - (min ground under the base ring - 0.02).
     *            The seat rule `landmarks.js:seatY` IS that expression, so a
     *            correct re-ground makes this 0.000 -- the direct test that
     *            the layer re-seated against THIS realm's heightfield.
     *   hang     (base - baseOff) - lowest ground under the base ring.
     *            Positive = part of the base ring is in the air.
     *   centreDy base - heightAt(centre): the number the brief asks for. It is
     *            NEGATIVE by design and grows with the local relief across the
     *            base radius, because seatY takes the ring MINIMUM so the
     *            error is one-sided (buried, never floating).
     */
    function seatProbe(inst) {
        const d = LM._texData, w = LM.prismCount * 4;
        let worstSeat = 0, worstHang = -Infinity, worstRelief = 0;
        for (let p = inst.prism0; p < inst.prism0 + inst.prisms; p++) {
            const o = p * 4;
            const bx = d[o], bz = d[o + 2], rad = d[w + o + 3];
            // The authored lift OUT: a lintel is meant to be in the air.
            const by = d[o + 1] - LM._baseOff[p];
            let lo = T.heightAt(bx, bz), hi = lo;
            for (let k = 0; k < 12; k++) {
                const ang = k * (Math.PI * 2 / 12);
                const g = T.heightAt(bx + Math.cos(ang) * rad,
                    bz + Math.sin(ang) * rad);
                if (g < lo) lo = g;
                if (g > hi) hi = g;
            }
            const se = by - (lo - 0.02);
            if (Math.abs(se) > Math.abs(worstSeat)) worstSeat = se;
            if (by - lo > worstHang) worstHang = by - lo;
            if (hi - lo > worstRelief) worstRelief = hi - lo;
        }
        const o0 = inst.prism0 * 4;
        return {
            centreDy: f3(d[o0 + 1] - LM._baseOff[inst.prism0]
                - T.heightAt(d[o0], d[o0 + 2])),
            seatErr: f3(worstSeat), hang: f3(worstHang),
            relief: f3(worstRelief),
        };
    }

    function realmReport() {
        const shrines = SH.positions.map((p, i) => ({
            id: p.id,
            anchor: [f2(p.x), f2(p.z)],
            stand: [f2(p.sx), f2(p.sz)],
            standR: f2(Math.hypot(p.sx - p.x, p.sz - p.z)),
            standGrade: f3(p.sgrade),
            anchorGrade: f3(grade(p.x, p.z)),
            standDy: f3(p.sy - T.heightAt(p.sx, p.sz)),
            standPrismClear: prismClear(i, p.sx, p.sz).clear,
        }));

        const live = LM.instances.filter((s) => s.realm === LM.realm);
        const lms = live.map((s) => {
            const sp = seatProbe(s);
            let minS = Infinity, minAt = "";
            for (let k = 0; k < SH.positions.length; k++) {
                const q = SH.positions[k];
                const v = Math.hypot(s.x - q.x, s.z - q.z);
                if (v < minS) { minS = v; minAt = q.id; }
            }
            return {
                label: s.label, at: [f2(s.x), f2(s.z)],
                baseDy: sp.centreDy, seatErr: sp.seatErr, hang: sp.hang,
                relief: sp.relief, anchorGrade: f3(grade(s.x, s.z)),
                shrine: f2(minS), shrineAt: minAt,
            };
        });
        let minPair = Infinity;
        for (let i = 0; i < live.length; i++) {
            for (let j = i + 1; j < live.length; j++) {
                const v = Math.hypot(live[i].x - live[j].x, live[i].z - live[j].z);
                if (v < minPair) minPair = v;
            }
        }
        return {
            realm: LM.realm, shrineRealm: SH.realm,
            shrines: shrines, landmarks: lms,
            minShrineClear: f2(Math.min.apply(null, lms.map((r) => r.shrine))),
            minPairSpacing: f2(minPair),
            worstBaseDy: f3(Math.max.apply(null,
                lms.map((r) => Math.abs(r.baseDy)))),
            relayoutShort: LM.stats.relayoutShort,
            liveInstances: lms.length,
        };
    }

    /** Enter a realm and let BOTH re-ground countdowns (3 frames) run out. */
    async function enter(name) {
        await SF.enterRealm(name);
        await rafs(8);
        await gwait(0.6);
        return { realm: LM.realm, shrineRealm: SH.realm };
    }

    /**
     * What the two new event-scoped passes COST. Both run inside `_reground`,
     * three frames after a realm swap, so they land on exactly one frame --
     * a hitch there would be a real regression traded for a real fix.
     */
    function cost() {
        const t0 = performance.now();
        for (let i = 0; i < 5; i++) LM._relayoutRealm(LM.realm);
        const t1 = performance.now();
        for (let i = 0; i < 5; i++) SH._reground();
        const t2 = performance.now();
        return {
            landmarkRelayoutMs: f3((t1 - t0) / 5),
            shrineRegroundMs: f3((t2 - t1) / 5),
        };
    }

    return { walkIn, dieNear, realmReport, anchors, grades, enter, blobId,
             prismClear, seatProbe, cost, rafs, gwait, put, heal };
})();
"""


def rj(pg, expr):
    return pg.evaluate("(async () => { return " + expr + "; })()")


def main():
    from playwright.sync_api import sync_playwright

    srv = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT)], cwd=str(ROOT),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    fails = []
    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            pg.set_default_timeout(240000)
            errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.on("console", lambda m: errs.append("console." + m.type + ": "
                                                   + m.text)
                  if m.type == "error" else None)
            pg.goto(GAME_URL, wait_until="domcontentloaded")
            pg.wait_for_function(
                "() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime",
                timeout=180000)
            pg.wait_for_timeout(2500)
            pg.evaluate(PRELUDE)

            # -------- D3 baseline: the CONSTRUCTOR's anchors for sand + ash,
            # chosen against cold's heightfield because it is the only one that
            # exists at construction time.
            pre = {r: pg.evaluate("__sn.anchors('%s')" % r) for r in REALMS}

            out = {}
            deaths = {}
            walks = {}
            for realm in REALMS:
                print("\n" + "=" * 68)
                print("REALM", realm.upper())
                print("=" * 68)
                st = rj(pg, "__sn.enter('%s')" % realm)
                print("  entered:", json.dumps(st))
                if st["realm"] != realm or st["shrineRealm"] != realm:
                    fails.append("%s: layers disagree on realm %s" % (realm, st))

                # ---------------- (a) touch activation, all six ring shrines
                # Touch the SPAWN monument first, entirely in-mechanism (a
                # walk, not a field write), so every ring walk below crosses a
                # genuine activation edge. Without it the previous realm's
                # death arm leaves its shrine active and the first ring walk
                # is a no-op the edge guard is right to swallow.
                z = rj(pg, "__sn.walkIn(0)")
                print("  reset  -> lastShrineId=%s (acts %d)"
                      % (z["after"], z["acts"]))
                if z["after"] != "cold_spawn":
                    fails.append("%s: could not touch the spawn shrine: %s"
                                 % (realm, json.dumps(z)))

                rows = []
                for i in range(1, 7):
                    r = rj(pg, "__sn.walkIn(%d)" % i)
                    rows.append(r)
                    ok = (r["after"] == r["shrine"]
                          and r["edgeBlob"] == r["shrine"]
                          and r["afterLoad"] == r["shrine"]
                          and r["acts"] == 1 and r["dwellActs"] == 0)
                    print("  walk %-10s -> after=%-10s blob=%-10s load=%-10s "
                          "firstAt=%-5s acts=%d dwell=%d  %s"
                          % (r["shrine"], r["after"], r["edgeBlob"],
                             r["afterLoad"], r["firstAtM"], r["acts"],
                             r["dwellActs"], "OK" if ok else "FAIL"))
                    if not ok:
                        fails.append("%s: touch/persist failed for %s: %s"
                                     % (realm, r["shrine"], json.dumps(r)))
                    if r["firstAtM"] is None or not (5.0 <= r["firstAtM"] <= 6.5):
                        fails.append("%s: %s activated at %s m, expected ~6 m"
                                     % (realm, r["shrine"], r["firstAtM"]))
                walks[realm] = rows

                # ---------------- (b) death arm, a different shrine per realm
                i = DEATH_AT[realm]
                d = rj(pg, "__sn.dieNear(%d, %f)" % (i, DEATH_DIST[realm]))
                deaths[realm] = d
                print("  DEATH at %s from %.1f m" % (d["shrine"], d["diedAtM"]))
                print("    anchor %s  stand %s  landed %s"
                      % (d["anchor"], d["stand"], d["landed"]))
                print("    dFromAnchor %.2f m   dFromStand %.2f m   "
                      "prismClear %.3f m (prism %d, r=%.3f)"
                      % (d["dFromAnchor"], d["dFromStand"],
                         d["prism"]["clear"], d["prism"]["prism"],
                         d["prism"]["prismRad"]))
                print("    groundDy %.3f m   settled %s dy %.3f prismClear %.3f"
                      % (d["groundDy"], d["settled"], d["settledGroundDy"],
                         d["settledPrism"]["clear"]))
                if d["respawnedTo"] != d["shrine"]:
                    fails.append("%s: respawned to %s, not %s"
                                 % (realm, d["respawnedTo"], d["shrine"]))
                if d["deathsDelta"] != 1:
                    fails.append("%s: deaths delta %d" % (realm, d["deathsDelta"]))
                if d["dFromStand"] > 0.6:
                    fails.append("%s: landed %.2f m off the stand point"
                                 % (realm, d["dFromStand"]))
                if d["dFromAnchor"] < 3.5:
                    fails.append("%s: landed %.2f m from the monolith axis "
                                 "(prism radius 0.34)" % (realm, d["dFromAnchor"]))
                if d["prism"]["clear"] < 1.0:
                    fails.append("%s: prism clearance %.3f m -- no clear margin"
                                 % (realm, d["prism"]["clear"]))
                if abs(d["groundDy"]) > 0.5:
                    fails.append("%s: respawn %.3f m off the ground"
                                 % (realm, d["groundDy"]))
                if abs(d["settledGroundDy"]) > 0.5:
                    fails.append("%s: settled %.3f m off the ground"
                                 % (realm, d["settledGroundDy"]))

                # ---------------- (c) per-realm report
                rep = pg.evaluate("__sn.realmReport()")
                out[realm] = rep
                # D3 SCORE: the constructor's anchors for this realm were
                # chosen on COLD's landform. Grade them against the landform
                # actually in force, next to the ones the re-scan picked.
                rep["oldGrades"] = pg.evaluate(
                    "__sn.grades(" + json.dumps(pre[realm]) + ")")
                print("  -- shrine stand points")
                for s in rep["shrines"]:
                    print("     %-11s anchor %-18s stand %-18s r=%.2f "
                          "grade %.4f (anchor %.4f) dy %.3f clr %.3f"
                          % (s["id"], s["anchor"], s["stand"], s["standR"],
                             s["standGrade"], s["anchorGrade"], s["standDy"],
                             s["standPrismClear"]))
                    if s["standPrismClear"] < 1.0:
                        fails.append("%s: %s stand point only %.3f m clear of "
                                     "its own prisms"
                                     % (realm, s["id"], s["standPrismClear"]))
                    if s["standGrade"] > s["anchorGrade"] + 1e-6:
                        print("       NOTE: stand grade above anchor grade")
                print("  -- landmarks (%d live)   baseDy = base - heightAt("
                      "centre); seatErr = base - seatY(live field), 0 = "
                      "re-seated; hang > 0 = floating" % rep["liveInstances"])
                for m in rep["landmarks"]:
                    flag = ""
                    if abs(m["baseDy"]) >= 0.5:
                        flag = "  [|dy|>=0.5, explained by relief %.2f]" \
                            % m["relief"]
                    print("     %-22s %-18s baseDy %+.3f  seatErr %+.3f  "
                          "hang %+.3f  shrine %.1f (%s)%s"
                          % (m["label"], m["at"], m["baseDy"], m["seatErr"],
                             m["hang"], m["shrine"], m["shrineAt"], flag))
                    # The GATE is the seat, not the centre delta: seatY takes
                    # the ring MINIMUM by design, so centreDy is negative and
                    # scales with relief. What must hold is that the layer
                    # re-seated against THIS realm's heightfield (seatErr 0)
                    # and that nothing floats (hang <= 0).
                    if abs(m["seatErr"]) > 0.05:
                        fails.append("%s: %s seatErr %.3f m -- not re-seated "
                                     "on this realm's heightfield"
                                     % (realm, m["label"], m["seatErr"]))
                    if m["hang"] > 0.0:
                        fails.append("%s: %s hangs %.3f m above its ground"
                                     % (realm, m["label"], m["hang"]))
                    if abs(m["baseDy"]) > m["relief"] + 0.05:
                        fails.append("%s: %s baseDy %.3f exceeds base-ring "
                                     "relief %.3f" % (realm, m["label"],
                                                      m["baseDy"], m["relief"]))
                print("  minShrineClear %.1f m (floor 120)   minPairSpacing "
                      "%.1f m (floor 150)   relayoutShort %d"
                      % (rep["minShrineClear"], rep["minPairSpacing"],
                         rep["relayoutShort"]))
                if rep["minShrineClear"] < 120:
                    fails.append("%s: shrine clearance %.1f m < 120"
                                 % (realm, rep["minShrineClear"]))
                if rep["minPairSpacing"] < 150:
                    fails.append("%s: landmark spacing %.1f m < 150"
                                 % (realm, rep["minPairSpacing"]))
                if rep["relayoutShort"] != 0:
                    fails.append("%s: relayoutShort=%d" %
                                 (realm, rep["relayoutShort"]))

            # -------- D3: how far the per-realm re-scan actually moved things
            print("\n" + "=" * 68)
            print("D3 -- constructor anchors (scanned on COLD) vs live")
            print("=" * 68)
            post = {}
            for realm in REALMS:
                post[realm] = [[m["at"][0], m["at"][1]]
                               for m in out[realm]["landmarks"]]
                moved = 0
                worst = 0.0
                for a, b in zip(pre[realm], post[realm]):
                    dd = ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** 0.5
                    if dd > 0.01:
                        moved += 1
                    worst = max(worst, dd)
                og = out[realm]["oldGrades"]
                ng = [m["anchorGrade"] for m in out[realm]["landmarks"]]
                mo = sum(og) / len(og)
                mn = sum(ng) / len(ng)
                print("  %-5s  %2d of %2d anchors moved, max move %.1f m   "
                      "mean |grad h| under THIS realm: old %.4f -> new %.4f"
                      % (realm, moved, len(post[realm]), worst, mo, mn))
                if realm != "cold" and mn > mo:
                    fails.append("%s: re-scan picked STEEPER ground "
                                 "(%.4f > %.4f)" % (realm, mn, mo))
                if realm == "cold" and moved != 0:
                    fails.append("cold re-layout moved %d anchors -- the scan "
                                 "is not deterministic" % moved)

            # -------- determinism: cold -> ... -> cold returns the same anchors
            rj(pg, "__sn.enter('cold')")
            again = pg.evaluate("__sn.anchors('cold')")
            same = all(abs(a[0] - b[0]) < 0.01 and abs(a[1] - b[1]) < 0.01
                       for a, b in zip(post["cold"], again))
            print("\n  cold->sand->ash->cold returns identical anchors:", same)
            if not same:
                fails.append("cold anchors drifted over a realm cycle")

            # -------- the touch state survived the whole cycle
            final = pg.evaluate(
                "({ id: SNOWFLOW.progression.lastShrineId, blob: __sn.blobId(),"
                " acts: SNOWFLOW.progression.shrineActivations })")
            print("  final lastShrineId:", json.dumps(final))
            if final["id"] == "cold_spawn":
                fails.append("lastShrineId fell back to cold_spawn")

            # -------- what the new event-scoped passes cost, on their frame
            cost = pg.evaluate("__sn.cost()")
            print("  per-swap cost: landmark re-layout %.3f ms, shrine "
                  "re-ground %.3f ms (both event-scoped, 3 frames after a "
                  "realm swap)"
                  % (cost["landmarkRelayoutMs"], cost["shrineRegroundMs"]))
            if cost["landmarkRelayoutMs"] + cost["shrineRegroundMs"] > 8.0:
                fails.append("per-swap re-ground costs %.1f ms -- a visible "
                             "hitch" % (cost["landmarkRelayoutMs"]
                                        + cost["shrineRegroundMs"]))

            hard = [e for e in errs if "favicon" not in e.lower()]
            if hard:
                print("\n  PAGE ERRORS:")
                for e in hard[:10]:
                    print("   ", e)
                fails.append("%d page/console errors" % len(hard))

            br.close()
    finally:
        srv.terminate()

    print("\n" + "=" * 68)
    if fails:
        print("FAIL (%d)" % len(fails))
        for f in fails:
            print("  -", f)
        sys.exit(1)
    print("PASS -- touch activation, stand-point respawn and per-realm scan "
          "all verified in cold, sand and ash")
    sys.exit(0)


if __name__ == "__main__":
    main()
