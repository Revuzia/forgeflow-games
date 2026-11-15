/**
 * Damage floaters — pooled DOM spans over the combat registry's event ring
 * (combat/damageable.js). The combat doc calls for pooled floaters with
 * Brittle-tinted hits and mandatory DR text (§9.4, §5.3: "silent DR feels
 * like cheating"); this is that consumer, DOM-only like the rest of the HUD.
 *
 * POLLED, NOT SUBSCRIBED — the crosshair contract. `update()` runs once per
 * frame from `main.js`, AFTER the registry has collected the frame's combat
 * events and BEFORE `registry.endFrame()` clears the ring (damageable.js
 * header: spells -> combat -> floaters/xp -> endFrame). It reads the ring
 * directly: no callbacks, no listeners, and a steady no-combat frame costs
 * the visibility poll and one event-count read — zero DOM writes.
 *
 * Pool: 24 span pairs, preallocated in the constructor. The outer span is
 * placed once at spawn (world → screen via `rig.camera` + Vector3.project);
 * the inner span runs a 0.8 s rise+fade CSS animation with `forwards` fill,
 * so an expired floater is invisible without a single JS write. Spawns take
 * slots round-robin, which IS oldest-first: when all 24 are in flight the
 * oldest is overwritten — a 25th simultaneous number carries no information.
 *
 * Event handling per frame:
 *   hit (0) / kill (1)  — hit amounts are MERGED per target per frame (a
 *       5-prism Spike plant or a Vortex tick burst reads as one number, not
 *       confetti; the kill event's amount duplicates its own hit event and
 *       is never double-counted). Rounded. Kill = bright + larger.
 *   poisebreak (2)      — "BREAK", amber (the stance colour).
 *   cc (3)              — tag text: "stun" → STUN (cyan), "brittle" →
 *       BRITTLE (amber); any other tag renders uppercased (cyan), which is
 *       where the §5.3 "RESIST"/"IMMUNE" DR floaters land for free once the
 *       registry emits them.
 * Colour by state: normal frost-white; target currently Brittle → amber
 * (registry.brittleUntil is the source of truth, not the tag); stun cyan;
 * kill bright.
 *
 * Visibility follows the crosshair contract exactly: shown only while
 * `input.locked`, the FFG shell phase is "playing", and no overlay panel is
 * up. '#floaters' belongs in the `_harness/shoot.py` chrome-hider list with
 * '#crosshair' and '#hud'.
 */

import { Vector3 } from "three";
import { input } from "../core/input.js";

/** Pool size — matches the alive cap's worth of simultaneous numbers. */
const POOL = 24;
/** Floater lifetime, ms. Matches the CSS animation duration. */
const LIFE_MS = 800;

const CSS = `
#floaters {
  position: fixed; inset: 0;
  z-index: 53; /* over #enemybars (52), under #spellbar/#hud (55) */
  pointer-events: none;
  opacity: 0;
  transition: opacity 160ms ease;
  overflow: hidden;
}
#floaters.show { opacity: 1; }

#floaters .flt {
  position: absolute; left: 0; top: 0;
  will-change: transform;
}
#floaters .flt-t {
  display: inline-block;
  transform: translate(-50%, -100%);
  font: 700 13px/1 "Segoe UI", system-ui, sans-serif;
  letter-spacing: 0.02em;
  opacity: 0;
  white-space: nowrap;
}
#floaters .flt-t.run {
  animation: flt-rise ${LIFE_MS}ms cubic-bezier(0.2, 0, 0.45, 1) forwards;
}
@keyframes flt-rise {
  0%   { opacity: 0;    transform: translate(-50%, -100%) translateY(6px); }
  12%  { opacity: 1;    transform: translate(-50%, -100%) translateY(0); }
  70%  { opacity: 0.9; }
  100% { opacity: 0;    transform: translate(-50%, -100%) translateY(-38px); }
}

/* Colour language: frost-white numbers; amber = Brittle/stance; cyan = CC
   text; kills flare bright. Dark halo on everything — numbers must read on
   sunlit snow and in shadow alike (same rule as the crosshair core). */
#floaters .flt-normal {
  color: #eef6ff;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.95), 0 0 6px rgba(150, 210, 255, 0.35);
}
#floaters .flt-brittle {
  color: #ffc86e;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.95), 0 0 7px rgba(255, 180, 90, 0.45);
}
#floaters .flt-stun {
  color: #8fe8ff;
  font-size: 11px; letter-spacing: 0.08em;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.95), 0 0 7px rgba(120, 220, 255, 0.5);
}
#floaters .flt-kill {
  color: #ffffff;
  font-size: 17px; font-weight: 800;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.95), 0 0 10px rgba(190, 235, 255, 0.85);
}
`;

export class Floaters {
    /**
     * @param {import("../combat/damageable.js").DamageableRegistry} registry
     * @param {import("../core/camera.js").CameraRig} rig
     */
    constructor(registry, rig) {
        this.registry = registry;
        this.rig = rig;
        this.overlay = null;

        const style = document.createElement("style");
        style.textContent = CSS;
        document.head.appendChild(style);

        const el = document.createElement("div");
        el.id = "floaters";
        document.body.appendChild(el);
        this.el = el;

        /** @type {HTMLSpanElement[]} outer spans — screen placement. */
        this._outer = new Array(POOL);
        /** @type {HTMLSpanElement[]} inner spans — animation + colour + text. */
        this._inner = new Array(POOL);
        /** @type {string[]} cached class per slot, so reuse skips className. */
        this._cls = new Array(POOL).fill("");
        for (let i = 0; i < POOL; i++) {
            const o = document.createElement("span");
            o.className = "flt";
            const t = document.createElement("span");
            t.className = "flt-t";
            o.appendChild(t);
            el.appendChild(o);
            this._outer[i] = o;
            this._inner[i] = t;
        }
        /** Round-robin spawn cursor. */
        this._next = 0;
        /** Hashed jitter counter — deterministic scatter, no Math.random on
         *  the frame path (LCG stepped once per spawn). */
        this._jit = 0x2f6e2b1;

        /** Per-frame merge mask over the event ring (sized to the ring). */
        this._consumed = new Uint8Array(registry.evType.length);

        /** Projection scratch — the only Vector3 this module ever makes. */
        this._v = new Vector3();

        this._show = false;
    }

    /**
     * Late-bind the systems the visibility poll reads (crosshair contract).
     * @param {{ overlay?: { visible: boolean } }} refs
     * @returns {void}
     */
    attach(refs) {
        if (refs.overlay) this.overlay = refs.overlay;
    }

    /**
     * One frame: poll visibility, drain the event ring into pooled spans.
     * Runs after `drawFrame()` (camera matrices current) and before
     * `registry.endFrame()`. Allocates only on event edges (text strings),
     * never on steady frames.
     * @returns {void}
     */
    update() {
        const shell = globalThis.FFG ? globalThis.FFG.shell : null;
        const shellUp = !!(shell && shell.phase !== "playing");
        const panelUp = !!(this.overlay && this.overlay.visible);
        const show = input.locked && !shellUp && !panelUp;
        if (show !== this._show) {
            this._show = show;
            this.el.classList.toggle("show", show);
        }
        if (!show) return; // paused/menu frames also produce no events (dt=0)

        const reg = this.registry;
        const n = reg.eventCount;
        if (n === 0) return;

        const consumed = this._consumed;
        for (let e = 0; e < n; e++) consumed[e] = 0;

        for (let e = 0; e < n; e++) {
            if (consumed[e]) continue;
            const type = reg.evType[e];
            const id = reg.evId[e];

            if (type === 0 || type === 1) {
                // Merge every damage event for this target this frame into
                // one number. The kill event's amount duplicates the hit
                // event that emitted it (damage() fires both with the same
                // dmg), so only type-0 amounts are summed; type-1 marks the
                // group as a kill and is the fallback amount if it somehow
                // arrives alone.
                let total = 0;
                let killed = false;
                let killAmt = 0;
                for (let j = e; j < n; j++) {
                    if (consumed[j] || reg.evId[j] !== id) continue;
                    const tj = reg.evType[j];
                    if (tj === 0) { total += reg.evAmount[j]; consumed[j] = 1; }
                    else if (tj === 1) { killed = true; killAmt = reg.evAmount[j]; consumed[j] = 1; }
                }
                if (total <= 0) total = killAmt;
                if (total <= 0) continue;
                let num = Math.round(total);
                if (num < 1) num = 1; // sub-1 ticks still read as a hit

                // Brittle tint from the registry's live state, not the tag —
                // the event carries no brittle flag, but the slot does.
                const slot = reg.slot(id);
                const brittle = slot >= 0 && reg.time < reg.brittleUntil[slot];
                const cls = killed ? "flt-kill" : brittle ? "flt-brittle" : "flt-normal";
                this._spawn(reg.evX[e], reg.evY[e], reg.evZ[e], String(num), cls);
            } else if (type === 2) {
                consumed[e] = 1;
                this._spawn(reg.evX[e], reg.evY[e], reg.evZ[e], "BREAK", "flt-brittle");
            } else {
                consumed[e] = 1;
                const tag = reg.evTag[e];
                if (tag === "stun") {
                    this._spawn(reg.evX[e], reg.evY[e], reg.evZ[e], "STUN", "flt-stun");
                } else if (tag === "brittle") {
                    this._spawn(reg.evX[e], reg.evY[e], reg.evZ[e], "BRITTLE", "flt-brittle");
                } else if (tag) {
                    // Future registry tags ("RESIST"/"IMMUNE" DR, §5.3)
                    // render without this file changing.
                    this._spawn(reg.evX[e], reg.evY[e], reg.evZ[e], tag.toUpperCase(), "flt-stun");
                }
            }
        }
    }

    /**
     * Place one pooled span at the projection of a world point and (re)start
     * its rise+fade. Event-edge path — the string work here never runs on a
     * quiet frame.
     * @param {number} x @param {number} y @param {number} z
     * @param {string} text
     * @param {string} cls one of the flt-* colour classes
     * @returns {void}
     */
    _spawn(x, y, z, text, cls) {
        const cam = this.rig.camera;
        const v = this._v;
        // View-space depth first: a point behind the camera projects to a
        // mirrored on-screen position, so it must be rejected before NDC.
        v.set(x, y, z).applyMatrix4(cam.matrixWorldInverse);
        if (v.z > -0.5) return; // behind / inside the near shell
        v.applyMatrix4(cam.projectionMatrix);
        if (v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.1) return;

        // ±px jitter so a burst of merged numbers over one target never
        // stacks into an unreadable pillar. Deterministic: one LCG step per
        // spawn, two bit-fields — reproducible under the shot harness.
        const j = this._jit = (this._jit * 1103515245 + 12345) & 0x7fffffff;
        const sx = (v.x * 0.5 + 0.5) * window.innerWidth +
            (((j & 1023) / 1023) * 20 - 10);
        const sy = (0.5 - v.y * 0.5) * window.innerHeight +
            ((((j >> 10) & 1023) / 1023) * 12 - 6);

        // Round-robin — sequential spawns make this oldest-first by
        // construction; an in-flight slot is simply overwritten.
        const i = this._next;
        this._next = (i + 1) % POOL;

        const o = this._outer[i];
        const t = this._inner[i];
        o.style.transform = `translate(${sx.toFixed(0)}px, ${sy.toFixed(0)}px)`;
        t.textContent = text;
        if (this._cls[i] !== cls) {
            this._cls[i] = cls;
            t.className = `flt-t ${cls}`;
        } else {
            t.classList.remove("run");
        }
        // Standard CSS animation restart: without the reflow a reused slot
        // inside its own 0.8 s window would not animate at all.
        void t.offsetWidth;
        t.classList.add("run");
    }
}
