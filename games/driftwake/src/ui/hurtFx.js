/**
 * Player hurt feedback — the "did I just take damage?" layer the combat gap
 * audit found missing (CORE-COMBAT-MECHANICS: player hits were a sound and a
 * silent health-bar tick). DOM/CSS only, same patterns as ui/hud.js.
 *
 * Three signals, all fed off the player-damage seam:
 *
 *   1. VIGNETTE FLASH — a screen-edge radial flash, red-shifted toward the
 *      current realm's ember hue, 250 ms linear decay. Peak scales with the
 *      hit's size (a 40+ hit is a full flash, a graze is a third).
 *   2. DIRECTIONAL TICK — a short arc segment at the screen edge toward the
 *      damage source: world direction player->source converted to a bearing
 *      relative to the camera yaw (core/camera.js frame: fwd=(sin yaw, 0,
 *      -cos yaw), right=(cos yaw, 0, sin yaw)), so 0 deg = ahead = top of
 *      screen, +90 deg = right edge. Four pooled ticks, round-robin.
 *   3. LOW-HP HEARTBEAT — under 30% health a persistent soft vignette with a
 *      double-thump pulse (class-toggled on the edge, CSS animates).
 *
 * FEED. `onPlayerHit(dirX, dirZ, amount)` is the exact seam — dirX/dirZ is
 * the world-space direction FROM the player TO the source (need not be
 * normalised; (0,0) means "direction unknown", vignette only). main.js wires
 * `enemies.hurtFx = hurtFx` so the enemy runtime can call it with the true
 * striker the moment it applies the hit. Until/unless that call lands, the
 * FALLBACK inside `update()` covers every path: it polls `controller.health`
 * once per frame, and on a drop with no explicit report it flashes with the
 * direction of the nearest alive registry body — in melee range the nearest
 * enemy IS the striker, and a bolt volley still reads as "from over there".
 * An explicit report suppresses the poll for that frame (`_extHit`), so the
 * two seams never double-fire on one hit.
 *
 * POLLED, NOT SUBSCRIBED — the crosshair contract: shown only while
 * `input.locked`, shell phase "playing", no overlay panel. Allocation-free
 * steady frames: the only per-frame writes are the vignette opacity while a
 * 250 ms decay is live, and every class/transform write is edge-gated.
 * '#hurtfx' belongs in the `_harness/shoot.py` chrome-hider list with
 * '#crosshair' and '#hud'.
 */

import { input } from "../core/input.js";

/** Pooled directional ticks — simultaneous distinct attackers worth showing. */
const TICKS = 4;
/** Vignette flash decay, ms. */
const FLASH_MS = 250;
/** Tick fade, ms (matches the CSS animation). */
const TICK_MS = 600;
/** Low-hp heartbeat threshold, fraction of healthMax. */
const LOW_FRAC = 0.3;

/** Realm ember hues, r/g/b — the "red-shifted toward the realm's ember hue"
 *  rule: all are blood-adjacent, warmed by sand, deepened by ash. */
const REALM_HUE = {
    cold: [255, 84, 64],
    sand: [255, 138, 52],
    ash: [255, 54, 34],
};

const CSS = `
#hurtfx {
  position: fixed; inset: 0;
  z-index: 54; /* over #floaters (53), under #hud/#spellbar (55) */
  pointer-events: none;
  opacity: 0;
  transition: opacity 160ms ease;
  overflow: hidden;
  /* Realm hue lands in these vars; JS writes them only on a realm edge. */
  --hfx-mid: rgba(255, 84, 64, 0.30);
  --hfx-edge: rgba(255, 84, 64, 0.62);
  --hfx-soft: rgba(255, 84, 64, 0.20);
  --hfx-tick: rgba(255, 120, 96, 0.95);
  --hfx-glow: rgba(255, 84, 64, 0.55);
}
#hurtfx.show { opacity: 1; }

/* ---- hit flash: dark-cornered radial, opacity driven by JS while live */
#hurtfx .hfx-vig {
  position: absolute; inset: 0;
  opacity: 0;
  background: radial-gradient(ellipse at center,
    rgba(0, 0, 0, 0) 42%,
    var(--hfx-mid) 76%,
    var(--hfx-edge) 100%);
}

/* ---- low-hp heartbeat: soft persistent vignette + double-thump pulse */
#hurtfx .hfx-heart {
  position: absolute; inset: 0;
  opacity: 0;
  background: radial-gradient(ellipse at center,
    rgba(0, 0, 0, 0) 52%,
    var(--hfx-soft) 82%,
    var(--hfx-mid) 100%);
}
#hurtfx.low .hfx-heart {
  animation: hfx-beat 1.15s ease-in-out infinite;
}
@keyframes hfx-beat {
  0%, 100% { opacity: 0.24; }
  12%      { opacity: 0.52; }
  24%      { opacity: 0.30; }
  36%      { opacity: 0.46; }
  60%      { opacity: 0.24; }
}

/* ---- directional ticks: an arc segment near the screen edge, rotated
   toward the source. The wrapper is a 0x0 pivot at screen centre; the arc
   child sits one radius above it, so rotating the wrapper walks the arc
   around a centred circle. */
#hurtfx .hfx-tickw {
  position: absolute; left: 50%; top: 50%;
  width: 0; height: 0;
  will-change: transform;
}
#hurtfx .hfx-tick {
  position: absolute; left: 0; top: 0;
  width: 96px; height: 30px;
  transform: translate(-50%, 0) translateY(calc(-1 * min(41vh, 41vw)));
  border-top: 4px solid var(--hfx-tick);
  border-radius: 50% 50% 0 0 / 100% 100% 0 0;
  opacity: 0;
  filter: drop-shadow(0 0 7px var(--hfx-glow));
}
#hurtfx .hfx-tick.run {
  animation: hfx-tick ${TICK_MS}ms ease-out forwards;
}
@keyframes hfx-tick {
  0%   { opacity: 0; }
  8%   { opacity: 0.95; }
  100% { opacity: 0; }
}
`;

export class HurtFx {
    /**
     * @param {import("../character/controller.js").CharacterController} controller
     * @param {import("../core/camera.js").CameraRig} rig
     * @param {import("../combat/damageable.js").DamageableRegistry} registry
     *        for the nearest-enemy direction fallback
     */
    constructor(controller, rig, registry) {
        this.controller = controller;
        this.rig = rig;
        this.registry = registry;
        this.overlay = null;

        const style = document.createElement("style");
        style.textContent = CSS;
        document.head.appendChild(style);

        const el = document.createElement("div");
        el.id = "hurtfx";
        el.innerHTML = '<div class="hfx-heart"></div><div class="hfx-vig"></div>';
        document.body.appendChild(el);
        this.el = el;
        this._vig = /** @type {HTMLDivElement} */ (el.querySelector(".hfx-vig"));

        /** @type {HTMLDivElement[]} tick wrappers (rotation) */
        this._tickW = new Array(TICKS);
        /** @type {HTMLDivElement[]} tick arcs (animation restart) */
        this._tickA = new Array(TICKS);
        for (let i = 0; i < TICKS; i++) {
            const w = document.createElement("div");
            w.className = "hfx-tickw";
            const a = document.createElement("div");
            a.className = "hfx-tick";
            w.appendChild(a);
            el.appendChild(w);
            this._tickW[i] = w;
            this._tickA[i] = a;
        }
        /** Round-robin tick cursor. */
        this._nextTick = 0;

        /** Flash state: wall-clock end + peak opacity. */
        this._flashUntil = 0;
        this._flashPeak = 0;
        /** Cached vignette opacity (2-dp quantised) — writes gate on this. */
        this._vigOp = 0;

        /** Health-poll fallback state. */
        this._lastHp = controller.health;
        /** Set by onPlayerHit; suppresses the poll for one frame. */
        this._extHit = false;

        this._show = false;
        this._low = false;
        /** Last tick bearing, deg, screen frame (0 = top) — for probes. */
        this._lastAngleDeg = null;

        this._realm = "cold";
    }

    /** @param {{ overlay?: { visible: boolean } }} refs @returns {void} */
    attach(refs) {
        if (refs.overlay) this.overlay = refs.overlay;
    }

    /**
     * Retint toward the realm's ember hue. Called from `enterRealm` in
     * main.js; five var writes, realm-edge only.
     * @param {"cold"|"sand"|"ash"} token @returns {void}
     */
    setRealm(token) {
        if (token === this._realm) return;
        this._realm = token;
        const [r, g, b] = REALM_HUE[token] || REALM_HUE.cold;
        const s = this.el.style;
        s.setProperty("--hfx-mid", `rgba(${r}, ${g}, ${b}, 0.30)`);
        s.setProperty("--hfx-edge", `rgba(${r}, ${g}, ${b}, 0.62)`);
        s.setProperty("--hfx-soft", `rgba(${r}, ${g}, ${b}, 0.20)`);
        s.setProperty("--hfx-tick", `rgba(${Math.min(255, r + 20)}, ${g + 30}, ${b + 30}, 0.95)`);
        s.setProperty("--hfx-glow", `rgba(${r}, ${g}, ${b}, 0.55)`);
    }

    /**
     * THE SEAM — report one player hit. dirX/dirZ: world direction FROM the
     * player TO the damage source (any length; 0,0 = unknown, no tick).
     * Callers: the enemy runtime via `enemies.hurtFx` (exact striker), or
     * the health-poll fallback below.
     * @param {number} dirX @param {number} dirZ @param {number} amount
     * @returns {void}
     */
    onPlayerHit(dirX, dirZ, amount) {
        this._extHit = true;
        if (!this._show) return;

        // Vignette: peak scales with the hit, refreshes on overlap.
        const peak = Math.min(1, 0.35 + amount / 60);
        const now = performance.now();
        this._flashPeak = this._flashUntil > now
            ? Math.max(this._flashPeak, peak) : peak;
        this._flashUntil = now + FLASH_MS;

        // Directional tick, camera-relative bearing (0 = ahead = top).
        const len = Math.hypot(dirX, dirZ);
        if (len > 1e-4) {
            const yaw = this.rig.yaw;
            const fwd = (Math.sin(yaw) * dirX - Math.cos(yaw) * dirZ) / len;
            const right = (Math.cos(yaw) * dirX + Math.sin(yaw) * dirZ) / len;
            const deg = Math.atan2(right, fwd) * 180 / Math.PI;
            this._lastAngleDeg = deg;
            const i = this._nextTick;
            this._nextTick = (i + 1) % TICKS;
            this._tickW[i].style.transform = `rotate(${deg.toFixed(1)}deg)`;
            const a = this._tickA[i];
            // Standard CSS animation restart (floaters.js pattern).
            a.classList.remove("run");
            void a.offsetWidth;
            a.classList.add("run");
        }
    }

    /**
     * One frame: visibility poll, health-drop fallback, flash decay, low-hp
     * edge. Allocation-free; steady no-damage frames write nothing.
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

        const c = this.controller;

        // ---- fallback: a health drop nobody reported explicitly ----------
        const hp = c.health;
        if (hp < this._lastHp - 1e-3 && !this._extHit) {
            const delta = this._lastHp - hp;
            // Nearest alive registry body is the best available guess at the
            // striker (melee: it IS the striker). Linear scan, count <= 96.
            const reg = this.registry;
            const px = c.position.x, pz = c.position.z;
            let bx = 0, bz = 0, bd = Infinity;
            for (let s = 0; s < reg.count; s++) {
                if (reg.hp[s] <= 0 || reg.kind[s] === "dummy") continue;
                const dx = reg.x[s] - px, dz = reg.z[s] - pz;
                const d2 = dx * dx + dz * dz;
                if (d2 < bd) { bd = d2; bx = dx; bz = dz; }
            }
            this.onPlayerHit(bx, bz, delta);
        }
        this._lastHp = hp;
        this._extHit = false;

        // ---- low-hp heartbeat (edge-toggled; CSS animates) ---------------
        const low = c.healthMax > 0 && hp / c.healthMax < LOW_FRAC;
        if (low !== this._low) {
            this._low = low;
            this.el.classList.toggle("low", low);
        }

        // ---- vignette decay (writes only while a flash is live) ----------
        let op = 0;
        if (this._flashUntil > 0) {
            const left = this._flashUntil - performance.now();
            if (left <= 0) {
                this._flashUntil = 0;
            } else {
                op = this._flashPeak * (left / FLASH_MS);
            }
        }
        const q = Math.round(op * 100) / 100;
        if (q !== this._vigOp) {
            this._vigOp = q;
            this._vig.style.opacity = String(q);
        }
    }
}
