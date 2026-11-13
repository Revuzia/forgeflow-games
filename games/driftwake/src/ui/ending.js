/**
 * THE ENDING — "Mend the Drift" (_spec/QUEST_DESIGN.md §9). Started by the
 * quest engine's 'ending:begin' {echoId, lines} (step ash.6: the Cold spawn
 * shrine touched with the ending condition met). Four beats, then post-game:
 *
 *   1. ECHO      the Echo's last lines (3), one at a time, letterboxed.
 *   2. FLYOVER   FLY_S (30 s, inside §9's 25-35) — the camera rises from the
 *                spawn shrine in a widening orbit until the whole realm is
 *                under it, while the light warms (the sun's warmth to full
 *                and lowered a few degrees, bloom and exposure eased up).
 *   3. CARD      "The Drift is mended." (STORY.ending.card).
 *   4. CREDITS   STORY.ending.credits, scrolling (a CSS animation), skippable.
 *   then         control returns: the camera is handed back to the rig, every
 *                setting touched is restored, 'ending:done' is emitted. The
 *                quest engine already owns the post-game tracker ("The world is
 *                whole. Ride on.") and the persisted `endingSeen`; the journal
 *                shows the "Wakecaster" title.
 *
 * SKIPPING: any key moves to the next beat (the next Echo line, the end of
 * the flyover, the end of the card, the end of the credits); Esc skips the
 * whole sequence. F1/F3 pass through.
 *
 * THE WORLD IS HELD STILL (`S.freezeTime`, the existing pause pattern): no
 * pack may walk up to a player who cannot move. So the sequence runs on the
 * WALL clock — its own requestAnimationFrame loop — and the camera is posed
 * by `drive()`, which the integrator calls once a frame RIGHT AFTER
 * `rig.update(...)` (the rig writes the camera every frame, frozen or not; the
 * override must land after it and before `post.update` reads the matrices).
 * Without that hook the beats still play and end; only the camera stays put.
 *
 * The pointer lock is released for the sequence (every HUD element hides —
 * they all show only under lock) through the input.js panel stack, so the
 * keyboard belongs to the ending and main.js's pause-on-unlock guard (which
 * reads `input.panel`) does not open the pause menu under it.
 *
 * NOT DONE HERE (no seam): "all shrines pulsing" (§9.2) — world/shrine.js has
 * no pulse uniform this module could drive. See the lane report.
 *
 * MODULE SHAPE: constructor(ctx), update(dt) (no per-frame work — the
 * sequence owns its clock), drive(), setRealm(), plus start(lines) / skip() /
 * skipAll() / phase. ctx: bus, S, set (settings.set), rig, shrine, terrain,
 * character, progression, input. Self-registers as `ctx.ending`.
 */

import { input as coreInput, openPanel, closePanel, requestLock } from "../core/input.js";
import { bus as coreBus } from "../quests/events.js";
import { STORY } from "../quests/storyText.js";

/** Beat lengths, s of WALL time. */
export const ECHO_LINE_S = 4.6;
export const FLY_S = 30;
export const CARD_S = 5;
export const CREDITS_S = 30;
/** The flyover path: orbit radius, camera height above the shrine, and how
 *  far the look-at point drifts toward the realm centre, start -> end. */
const R0 = 11, R1 = 300;
const H0 = 5, H1 = 210;
const TURN = 1.25 * Math.PI;
/** The light at the end of the flyover. */
const WARM = { sunTempWarm: 1.0, sunDrop: 5, bloomMul: 1.25, exposureMul: 1.08 };

const CSS = `
#dw-ending { position: fixed; inset: 0; z-index: 96; display: none; pointer-events: none;
  font-family: "Segoe UI", system-ui, sans-serif; color: rgba(240, 248, 253, 0.96); }
#dw-ending.open { display: block; }
#dw-ending .en-bar { position: absolute; left: 0; right: 0; height: 0; background: #000;
  transition: height 900ms ease; }
#dw-ending .en-bar.top { top: 0; } #dw-ending .en-bar.bot { bottom: 0; }
#dw-ending.letter .en-bar { height: 11vh; }
#dw-ending .en-echo { position: absolute; left: 0; right: 0; bottom: 16vh; text-align: center;
  opacity: 0; transition: opacity 700ms ease; }
#dw-ending.echo .en-echo { opacity: 1; }
#dw-ending .en-who { font: 600 11px/1 "Segoe UI", system-ui, sans-serif; letter-spacing: 0.32em;
  text-transform: uppercase; color: #a8dcf5; text-shadow: 0 0 12px rgba(120, 205, 245, 0.5); }
#dw-ending .en-line { margin: 12px auto 0; max-width: min(820px, calc(100vw - 48px));
  font: italic 300 clamp(18px, 2.2vw, 26px)/1.5 "Segoe UI", system-ui, sans-serif;
  text-shadow: 0 2px 12px rgba(0, 0, 0, 0.95); transition: opacity 500ms ease; }
#dw-ending .en-line.fade { opacity: 0; }
#dw-ending .en-card { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  background: radial-gradient(ellipse at center, rgba(4, 9, 17, 0.35), rgba(4, 9, 17, 0.8));
  font: 300 clamp(26px, 4vw, 52px)/1.2 "Segoe UI", system-ui, sans-serif; letter-spacing: 0.06em;
  text-shadow: 0 0 30px rgba(255, 220, 160, 0.45), 0 2px 14px rgba(0, 0, 0, 0.9);
  opacity: 0; transition: opacity 1.2s ease; }
#dw-ending.card .en-card { opacity: 1; }
#dw-ending .en-credits { position: absolute; inset: 0; overflow: hidden; opacity: 0; transition: opacity 800ms ease;
  background: linear-gradient(rgba(4, 9, 17, 0.72), rgba(4, 9, 17, 0.86)); }
#dw-ending.credits .en-credits { opacity: 1; }
#dw-ending .en-roll { position: absolute; left: 0; right: 0; top: 0; text-align: center; transform: translateY(100vh); }
#dw-ending.credits .en-roll { animation: dw-roll var(--roll-s, 30s) linear forwards; }
@keyframes dw-roll { from { transform: translateY(100vh); } to { transform: translateY(-100%); } }
#dw-ending .en-h { margin-top: 46px; font: 600 11px/1 "Segoe UI", system-ui, sans-serif; letter-spacing: 0.3em;
  text-transform: uppercase; color: #a8dcf5; }
#dw-ending .en-h.big { font: 300 40px/1.1 "Segoe UI", system-ui, sans-serif; letter-spacing: 0.24em; color: #eaf6ff; }
#dw-ending .en-l { margin-top: 10px; font: 400 15px/1.4 "Segoe UI", system-ui, sans-serif; color: rgba(225, 240, 250, 0.88); }
/* The whole play HUD steps aside for the cinematic, whatever the pointer
   lock is doing (every HUD element shows only under lock, but a lock that was
   never re-acquired, or a harness pin, must not leave them over the shot). */
body.dw-cinematic #hud, body.dw-cinematic #minimap, body.dw-cinematic #spellbar,
body.dw-cinematic #crosshair, body.dw-cinematic #xphud, body.dw-cinematic #enemybars,
body.dw-cinematic #floaters, body.dw-cinematic #hint, body.dw-cinematic .dw-glass,
body.dw-cinematic #dw-tracker, body.dw-cinematic #dw-compass, body.dw-cinematic #dw-dialogue,
body.dw-cinematic #dw-toasts, body.dw-cinematic #dw-banner, body.dw-cinematic #dw-hints,
body.dw-cinematic #dw-prompt, body.dw-cinematic #wa-prompt, body.dw-cinematic #wa-trial,
body.dw-cinematic #dw-driftmark { visibility: hidden !important; }
#dw-ending .en-skip { position: absolute; left: 22px; bottom: 16px; font: 500 10.5px/1 "Segoe UI", system-ui, sans-serif;
  letter-spacing: 0.18em; text-transform: uppercase; color: rgba(205, 228, 244, 0.5); }
`;

let _cssDone = false;
function ensureCss() {
    if (_cssDone || typeof document === "undefined") return;
    _cssDone = true;
    const s = document.createElement("style");
    s.id = "dw-ending-css";
    s.textContent = CSS;
    document.head.appendChild(s);
}

/** smoothstep 0..1. @param {number} t */
function ease(t) { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }

/**
 * The flyover camera pose at progress u (0..1) — pure, exported for the
 * Node probe. Writes {x, y, z, tx, ty, tz} into `out`.
 * @param {number} u @param {number} ax @param {number} ay @param {number} az
 *   the shrine anchor @param {number} yaw0 the rig yaw at the start
 * @param {any} out @returns {any}
 */
export function flyPose(u, ax, ay, az, yaw0, out) {
    const e = ease(u);
    const r = R0 + (R1 - R0) * e;
    const h = H0 + (H1 - H0) * e;
    // Start BEHIND the rider's own view (the rig's arm), then swing round.
    const a = yaw0 + Math.PI + TURN * e;
    out.x = ax + Math.sin(a) * r;
    out.z = az - Math.cos(a) * r;
    out.y = ay + h;
    // Look at the shrine first, drifting toward the realm centre as it rises.
    const k = e * 0.75;
    out.tx = ax * (1 - k);
    out.tz = az * (1 - k);
    out.ty = ay + 1.5 * (1 - e);
    return out;
}

export class Ending {
    /** @param {any} ctx */
    constructor(ctx) {
        ensureCss();
        this.ctx = ctx;
        this.S = ctx.S || null;
        this.bus = ctx.bus || coreBus;
        this.input = ctx.input || coreInput;
        this.now = () => performance.now();

        const E = STORY.ending || { echo: [], card: "", credits: [] };
        const el = document.createElement("div");
        el.id = "dw-ending";
        el.innerHTML =
            '<div class="en-bar top"></div><div class="en-bar bot"></div>' +
            '<div class="en-echo"><div class="en-who"></div><div class="en-line"></div></div>' +
            '<div class="en-card"></div><div class="en-credits"><div class="en-roll"></div></div>' +
            '<div class="en-skip">Any key: next · Esc: skip</div>';
        document.body.appendChild(el);
        this.el = el;
        this._who = el.querySelector(".en-who");
        this._line = el.querySelector(".en-line");
        el.querySelector(".en-card").textContent = E.card || "";
        el.style.setProperty("--roll-s", CREDITS_S + "s");
        // Credits, built once.
        const roll = el.querySelector(".en-roll");
        const credits = Array.isArray(E.credits) ? E.credits : [];
        for (let i = 0; i < credits.length; i++) {
            const c = credits[i];
            const h = document.createElement("div");
            h.className = "en-h" + (i === 0 ? " big" : "");
            h.textContent = c.heading;
            roll.appendChild(h);
            for (let j = 0; j < c.lines.length; j++) {
                const l = document.createElement("div");
                l.className = "en-l";
                l.textContent = c.lines[j];
                roll.appendChild(l);
            }
        }
        this._roll = roll;

        /** "idle" | "echo" | "flyover" | "card" | "credits" */
        this.phase = "idle";
        this.lines = [];
        this.lineIx = 0;
        this._t = 0;            // phase start, ms
        this._raf = 0;
        this._pose = { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0 };
        this._anchor = { x: 0, y: 0, z: 0, yaw: 0 };
        this._restore = null;
        this._freezeBefore = false;
        this._skipped = false;
        /** Probe surface. */
        this.stats = { starts: 0, done: 0, skipped: 0, drives: 0, phases: [], lastPose: null };

        this._onKey = (e) => {
            if (e.repeat) return;
            if (e.code === "Escape") this.skipAll(); else this.skip();
        };
        this._off = this.bus.on("ending:begin", (p) => this.start(p && p.lines));
        ctx.ending = this;
    }

    get active() { return this.phase !== "idle"; }

    /**
     * Begin the sequence. @param {string[]} [lines] the Echo's last lines
     * (default STORY.ending.echo) @returns {boolean}
     */
    start(lines) {
        if (this.phase !== "idle") return false;
        this.lines = Array.isArray(lines) && lines.length ? lines.slice(0, 3)
            : (STORY.ending && STORY.ending.echo ? STORY.ending.echo.slice() : []);
        this.stats.starts++;
        this.stats.phases.length = 0;
        this._skipped = false;
        if (this.S) {
            this._freezeBefore = !!this.S.freezeTime;
            this.S.freezeTime = true;
        }
        // Anchor: the Cold spawn shrine (the ending's own place), else the rider.
        const sh = this.ctx.shrine;
        const p0 = sh && sh.positions ? sh.positions[0] : null;
        const c = this.ctx.character;
        const T = this.ctx.terrain;
        const ax = p0 ? p0.x : (c ? c.position.x : 0);
        const az = p0 ? p0.z : (c ? c.position.z : 0);
        this._anchor.x = ax;
        this._anchor.z = az;
        this._anchor.y = T && T.heightAt ? T.heightAt(ax, az) : (c ? c.position.y : 0);
        this._anchor.yaw = this.ctx.rig ? this.ctx.rig.yaw : 0;
        this.el.classList.add("open", "letter");
        document.body.classList.add("dw-cinematic");
        openPanel("ending", this._onKey, { cursor: true });
        this.bus.emit("ui:open", { panel: "ending" });
        this._who.textContent = STORY.ui ? STORY.ui.speaker : "The Echo";
        this._enter("echo");
        this._loop();
        return true;
    }

    /** Next beat (any key). */
    skip() {
        if (this.phase === "idle") return;
        this._skipped = true;
        if (this.phase === "echo") this._nextLine();
        else if (this.phase === "flyover") this._enter("card");
        else if (this.phase === "card") this._enter("credits");
        else if (this.phase === "credits") this._finish();
    }

    /** The whole sequence (Esc). */
    skipAll() {
        if (this.phase === "idle") return;
        this._skipped = true;
        this._finish();
    }

    /**
     * Pose the camera for this frame. The integrator calls it right after
     * `rig.update(...)`; a no-op unless the flyover (or the beats after it)
     * is running. Allocation-free.
     */
    drive() {
        if (this.phase !== "flyover" && this.phase !== "card" && this.phase !== "credits") return;
        const rig = this.ctx.rig;
        const cam = rig ? rig.camera : null;
        if (!cam) return;
        this.stats.drives++;
        let u;
        if (this.phase === "flyover") u = (this.now() - this._t) / (FLY_S * 1000);
        else u = 1;
        const a = this._anchor;
        const p = flyPose(u > 1 ? 1 : u, a.x, a.y, a.z, a.yaw, this._pose);
        // After the flyover the shot keeps turning, slowly, under the card
        // and the credits.
        if (this.phase !== "flyover") {
            const extra = ((this.now() - this._t) / 1000) * 0.02;
            const ang = a.yaw + Math.PI + TURN + extra;
            p.x = a.x + Math.sin(ang) * R1;
            p.z = a.z - Math.cos(ang) * R1;
        }
        const T = this.ctx.terrain;
        if (T && T.heightAt) {
            const g = T.heightAt(p.x, p.z) + 6;
            if (p.y < g) p.y = g;
        }
        cam.position.set(p.x, p.y, p.z);
        cam.lookAt(p.tx, p.ty, p.tz);
        cam.updateMatrixWorld(true);
        // Light: ease the warmth in across the flyover.
        if (this._restore && this.S) {
            const w = this.phase === "flyover" ? ease(u) : 1;
            const r = this._restore;
            this.S.bloomStrength = r.bloomStrength * (1 + (WARM.bloomMul - 1) * w);
            this.S.exposure = r.exposure * (1 + (WARM.exposureMul - 1) * w);
        }
    }

    /** @param {number} dt */
    update(dt) { /* the sequence runs on its own wall-clock loop */ }

    setRealm() {}

    dispose() {
        if (this.phase !== "idle") this._finish();
        if (this._off) this._off();
        if (this.el.parentNode) this.el.parentNode.removeChild(this.el);
    }

    // ============================================================ internals

    /** @param {string} ph */
    _enter(ph) {
        this.phase = ph;
        this._t = this.now();
        this.stats.phases.push(ph);
        const cl = this.el.classList;
        cl.toggle("echo", ph === "echo");
        cl.toggle("card", ph === "card");
        cl.toggle("credits", ph === "credits");
        cl.toggle("letter", ph === "echo" || ph === "flyover");
        if (ph === "echo") {
            this.lineIx = 0;
            this._line.textContent = this.lines[0] || "";
        } else if (ph === "flyover") {
            this._warm();
        } else if (ph === "credits") {
            // Restart the roll animation from the top.
            this._roll.style.animation = "none";
            void this._roll.offsetWidth;
            this._roll.style.animation = "";
        }
    }

    _nextLine() {
        this.lineIx++;
        if (this.lineIx >= this.lines.length) { this._enter("flyover"); return; }
        this._line.textContent = this.lines[this.lineIx];
        this._t = this.now();
    }

    /** Warm the light for the flyover (restored at the end). */
    _warm() {
        const S = this.S;
        if (!S || this._restore) return;
        this._restore = {
            sunTempWarm: S.sunTempWarm, sunElevation: S.sunElevation,
            bloomStrength: S.bloomStrength, exposure: S.exposure,
        };
        const set = this.ctx.set;
        const el = Math.max(2.5, S.sunElevation - WARM.sunDrop);
        // The two sun keys re-solve the sky (debounced) — set ONCE, not eased.
        if (typeof set === "function") {
            set("sunTempWarm", Math.max(S.sunTempWarm, WARM.sunTempWarm));
            set("sunElevation", el);
        } else {
            S.sunTempWarm = Math.max(S.sunTempWarm, WARM.sunTempWarm);
            S.sunElevation = el;
        }
    }

    _unwarm() {
        const S = this.S;
        const r = this._restore;
        if (!S || !r) return;
        this._restore = null;
        const set = this.ctx.set;
        S.bloomStrength = r.bloomStrength;
        S.exposure = r.exposure;
        if (typeof set === "function") {
            set("sunTempWarm", r.sunTempWarm);
            set("sunElevation", r.sunElevation);
        } else {
            S.sunTempWarm = r.sunTempWarm;
            S.sunElevation = r.sunElevation;
        }
    }

    /** One wall-clock step of the beats. Exposed for probes. */
    tick() {
        if (this.phase === "idle") return;
        const t = (this.now() - this._t) / 1000;
        if (this.phase === "echo") { if (t >= ECHO_LINE_S) this._nextLine(); }
        else if (this.phase === "flyover") { if (t >= FLY_S) this._enter("card"); }
        else if (this.phase === "card") { if (t >= CARD_S) this._enter("credits"); }
        else if (this.phase === "credits") { if (t >= CREDITS_S) this._finish(); }
    }

    _loop() {
        if (this.phase === "idle") return;
        this.tick();
        if (this.phase !== "idle" && typeof requestAnimationFrame === "function") {
            requestAnimationFrame(() => this._loop());
        }
    }

    /** Hand control back: camera, light, clock, keyboard; post-game. */
    _finish() {
        if (this.phase === "idle") return;
        this.phase = "idle";
        this.stats.done++;
        if (this._skipped) this.stats.skipped++;
        this.stats.phases.push("done");
        this.el.classList.remove("open", "letter", "echo", "card", "credits");
        document.body.classList.remove("dw-cinematic");
        this._unwarm();
        const rig = this.ctx.rig;
        if (rig) {
            // The rig's first-frame path copies the pivot instead of springing
            // 300 m back to the rider.
            rig._first = true;
            if (rig.pivotVel) rig.pivotVel.set(0, 0, 0);
        }
        if (this.S) this.S.freezeTime = this._freezeBefore;
        closePanel("ending");
        const P = this.ctx.progression;
        if (P && P.save) P.save();
        this.bus.emit("ui:close", { panel: "ending" });
        this.bus.emit("ending:done", { skipped: this._skipped });
        if (!this.input.panel) requestLock();
    }
}
