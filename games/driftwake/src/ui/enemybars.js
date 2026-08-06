/**
 * Pooled enemy HP bars over the combat registry (combat/damageable.js) —
 * the combat doc's §9.5 / P2.2 bar layer: thin world-anchored bars for
 * anything that took damage recently, and a big bottom-center bar with name
 * + stance sub-meter for the boss.
 *
 * POLLED, NOT SUBSCRIBED — the crosshair contract. `update()` runs once per
 * frame from `main.js`, after `drawFrame()` (camera matrices are current)
 * and before `registry.endFrame()` clears the event ring. Two reads drive
 * everything:
 *
 *   1. The event ring: hit/kill events stamp `lastHit` for their target and
 *      claim a bar from the 16-slot pool (existing bar for the id wins,
 *      then a free slot, then the stalest is stolen). This is how "took
 *      damage in the last 6 s" is known without any per-enemy subscription.
 *   2. The registry SoA: each active bar re-reads hp/hpMax and position by
 *      id every frame — `slot(id)` survives the registry's swap-remove, and
 *      a vanished id (body removed) releases the bar the same frame.
 *
 * A bar expires 6 s after its last damage event, or immediately when its
 * target leaves the registry. Bars are hidden (not clamped) off-screen and
 * behind the camera. `kind === "boss"` never gets an overhead bar — the
 * boss owns the bottom-center frame instead, found by a linear scan of the
 * registry (count ≤ 96, allocation-free) so it shows from first sight, not
 * first damage. Its stance sub-meter FILLS as `registry.poise` depletes —
 * the §5.1 Sekiro read: a full meter is the break, and the post-break poise
 * reset empties it.
 *
 * Every DOM write is gated behind a cached value (position quantised to
 * whole px, fills to 1/500) — a parked camera over an untouched pack writes
 * nothing. Styling matches ui/hud.js frost glass: same border, same sheen,
 * same ember fill for health; amber for the stance meter, the same colour
 * the floaters use for BREAK.
 *
 * Visibility follows the crosshair contract: `input.locked` + shell phase
 * "playing" + no overlay panel. '#enemybars' belongs in the
 * `_harness/shoot.py` chrome-hider list with '#crosshair' and '#hud'.
 */

import { Vector3 } from "three";
import { input } from "../core/input.js";

/** Overhead-bar pool — twice the alive cap of 8 (combat doc §6.1). */
const POOL = 16;
/** Seconds a bar lingers after the target's last damage event. */
const LINGER_S = 6;

const CSS = `
#enemybars {
  position: fixed; inset: 0;
  z-index: 52; /* under #floaters (53) and #spellbar/#hud (55) */
  pointer-events: none;
  opacity: 0;
  transition: opacity 160ms ease;
  overflow: hidden;
}
#enemybars.show { opacity: 1; }

/* ---- overhead bars: thin frost-glass slivers, hud.js chrome at 1/3 scale */
#enemybars .eb {
  position: absolute; left: 0; top: 0;
  width: 56px; height: 7px; margin-left: -28px;
  border-radius: 4px;
  background: linear-gradient(180deg, rgba(10, 16, 22, 0.62), rgba(6, 10, 15, 0.75));
  border: 1px solid rgba(160, 205, 235, 0.26);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.45), inset 0 1px 2px rgba(0, 0, 0, 0.5);
  overflow: hidden;
  opacity: 0;
  transition: opacity 120ms ease;
  will-change: transform;
}
#enemybars .eb.on { opacity: 1; }
/* The TAB-selected body: brighter frame, a frost outline and a caret above
   it, and its bar never lingers out (targeting owns the lifetime). */
#enemybars .eb.tgt {
  border-color: rgba(190, 240, 255, 0.95);
  box-shadow: 0 0 8px rgba(150, 220, 255, 0.55), inset 0 1px 2px rgba(0, 0, 0, 0.5);
}
#enemybars .eb.tgt::before {
  content: "";
  position: absolute; left: 50%; top: -7px;
  margin-left: -4px;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-top: 5px solid rgba(200, 242, 255, 0.95);
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.8));
}
#enemybars .eb-name {
  position: absolute; left: 50%; top: 9px;
  transform: translateX(-50%);
  white-space: nowrap;
  font: 600 10px/1 "Segoe UI", system-ui, sans-serif;
  color: rgba(226, 244, 255, 0.95);
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.95);
  display: none;
}
#enemybars .eb.tgt .eb-name { display: block; }
#enemybars .eb .eb-fill {
  position: absolute; inset: 1px;
  border-radius: 3px;
  transform-origin: left center;
  background: linear-gradient(180deg, #e89a66, #b35c33 60%, #8a4426);
  box-shadow: inset 0 1px 1px rgba(255, 220, 190, 0.35);
  transition: transform 100ms ease-out;
}

/* ---- boss frame: bottom-center, above the spellbar (bottom 42px + 46px
   icons) and clear of the seam P1.1 reserves for the XP bar. */
#enemybars .bossbar {
  position: fixed; left: 50%; bottom: 118px;
  width: min(46vw, 520px);
  transform: translateX(-50%);
  opacity: 0;
  transition: opacity 200ms ease;
}
#enemybars .bossbar.on { opacity: 0.96; }
#enemybars .boss-name {
  text-align: center;
  font: 600 14px/1.2 "Segoe UI", system-ui, sans-serif;
  letter-spacing: 0.12em;
  color: rgba(240, 248, 253, 0.94);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.95), 0 0 8px rgba(150, 210, 255, 0.3);
  margin-bottom: 6px;
}
#enemybars .boss-hp {
  position: relative;
  height: 16px;
  border-radius: 8px;
  background: linear-gradient(180deg, rgba(10, 16, 22, 0.62), rgba(6, 10, 15, 0.75));
  border: 1px solid rgba(160, 205, 235, 0.26);
  box-shadow: 0 1px 5px rgba(0, 0, 0, 0.45), inset 0 1px 3px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}
#enemybars .boss-hp .eb-fill {
  position: absolute; inset: 1px;
  border-radius: 7px;
  transform-origin: left center;
  background: linear-gradient(180deg, #e89a66, #b35c33 60%, #8a4426);
  box-shadow: inset 0 1px 2px rgba(255, 220, 190, 0.35);
  transition: transform 100ms ease-out;
}
#enemybars .boss-hp::after {
  content: "";
  position: absolute; left: 6px; right: 6px; top: 1px; height: 1px;
  background: rgba(230, 245, 255, 0.28);
  border-radius: 1px;
}
/* Stance sub-meter — fills toward the break; amber, the BREAK colour. */
#enemybars .boss-stance {
  position: relative;
  height: 6px; margin-top: 4px;
  border-radius: 3px;
  background: linear-gradient(180deg, rgba(10, 16, 22, 0.62), rgba(6, 10, 15, 0.75));
  border: 1px solid rgba(160, 205, 235, 0.2);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}
#enemybars .boss-stance .eb-fill {
  position: absolute; inset: 1px;
  border-radius: 2px;
  transform-origin: left center;
  background: linear-gradient(180deg, #ffd489, #d9993f 60%, #a8702a);
  box-shadow: inset 0 1px 1px rgba(255, 230, 180, 0.4);
  transition: transform 100ms ease-out;
}
`;

export class EnemyBars {
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
        el.id = "enemybars";
        document.body.appendChild(el);
        this.el = el;

        /** @type {HTMLDivElement[]} pooled overhead bars. */
        this._bar = new Array(POOL);
        /** @type {HTMLDivElement[]} their fills. */
        this._fillEl = new Array(POOL);
        /** @type {HTMLElement[]} name labels (shown on the TAB target only). */
        this._nameEl = new Array(POOL);
        /** Pool index currently wearing the target frame; -1 = none. */
        this._tgtSlot = -1;
        for (let i = 0; i < POOL; i++) {
            const b = document.createElement("div");
            b.className = "eb";
            const f = document.createElement("div");
            f.className = "eb-fill";
            b.appendChild(f);
            const nm = document.createElement("span");
            nm.className = "eb-name";
            b.appendChild(nm);
            this._nameEl[i] = nm;
            el.appendChild(b);
            this._bar[i] = b;
            this._fillEl[i] = f;
        }

        // Boss frame, one of.
        const boss = document.createElement("div");
        boss.className = "bossbar";
        boss.innerHTML =
            '<div class="boss-name"></div>' +
            '<div class="boss-hp"><div class="eb-fill"></div></div>' +
            '<div class="boss-stance"><div class="eb-fill"></div></div>';
        el.appendChild(boss);
        this._boss = boss;
        this._bossName = boss.querySelector(".boss-name");
        this._bossHpFill = boss.querySelector(".boss-hp .eb-fill");
        this._bossStFill = boss.querySelector(".boss-stance .eb-fill");

        /** @type {{targetId:number}|null} set by main.js — the TAB selection. */
        this.targeting = null;
        /** Registry id each pool slot tracks; -1 = free. */
        this._id = new Int32Array(POOL).fill(-1);
        /** `registry.time` of the target's last damage event. */
        this._lastHit = new Float32Array(POOL);
        /** Cached DOM state per slot — writes gate on these. */
        this._sx = new Float64Array(POOL).fill(-1e9);
        this._sy = new Float64Array(POOL).fill(-1e9);
        this._frac = new Float64Array(POOL).fill(-1);
        this._on = new Uint8Array(POOL);

        /** Cached boss-frame state. */
        this._bOn = false;
        this._bNameTxt = "";
        this._bHp = -1;
        this._bStance = -1;

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
     * One frame: visibility poll, event-ring drain, bar upkeep, boss frame.
     * Allocation-free on steady frames — the only strings built are gated
     * transform/name writes.
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
        if (!show) return; // container is faded out; skip the world work

        const reg = this.registry;

        // ---- 1. Damage events claim/refresh bars -------------------------
        const n = reg.eventCount;
        for (let e = 0; e < n; e++) {
            const type = reg.evType[e];
            if (type !== 0 && type !== 1) continue; // hit/kill only
            const id = reg.evId[e];
            const slot = reg.slot(id);
            if (slot < 0 || reg.kind[slot] === "boss") continue; // boss = big bar
            this._touch(id, reg.time);
        }

        // ---- 1b. The TAB target always owns a bar, damaged or not, and
        //      never lingers out while it stays selected.
        const tgtId = this.targeting ? this.targeting.targetId : -1;
        if (tgtId >= 0 && reg.slot(tgtId) >= 0) this._touch(tgtId, reg.time);

        // ---- 2. Overhead bar upkeep -------------------------------------
        const cam = this.rig.camera;
        const v = this._v;
        const w = window.innerWidth, h = window.innerHeight;
        for (let i = 0; i < POOL; i++) {
            const id = this._id[i];
            if (id < 0) continue;
            const slot = reg.slot(id);
            const isTgt = id === tgtId;
            if (slot < 0 || (!isTgt && reg.time - this._lastHit[i] > LINGER_S)) {
                this._release(i);
                continue;
            }
            if (isTgt !== (this._tgtSlot === i)) {
                this._bar[i].classList.toggle("tgt", isTgt);
                if (isTgt) {
                    this._tgtSlot = i;
                    this._nameEl[i].textContent = reg.name[slot] || "";
                } else if (this._tgtSlot === i) {
                    this._tgtSlot = -1;
                }
            }
            // Anchor just above the capsule's crown.
            v.set(reg.x[slot], reg.y[slot] + reg.height[slot] + 0.35, reg.z[slot])
                .applyMatrix4(cam.matrixWorldInverse);
            if (v.z > -0.5) { this._setOn(i, false); continue; } // behind camera
            v.applyMatrix4(cam.projectionMatrix);
            if (v.x < -1.05 || v.x > 1.05 || v.y < -1.05 || v.y > 1.05) {
                this._setOn(i, false); // off-screen: hidden, never clamped
                continue;
            }
            const sx = Math.round((v.x * 0.5 + 0.5) * w);
            const sy = Math.round((0.5 - v.y * 0.5) * h);
            if (sx !== this._sx[i] || sy !== this._sy[i]) {
                this._sx[i] = sx; this._sy[i] = sy;
                this._bar[i].style.transform = `translate(${sx}px, ${sy}px)`;
            }
            const frac = reg.hpMax[slot] > 0 ?
                Math.max(0, Math.min(1, reg.hp[slot] / reg.hpMax[slot])) : 0;
            if (Math.abs(frac - this._frac[i]) > 0.002) {
                this._frac[i] = frac;
                this._fillEl[i].style.transform = `scaleX(${frac.toFixed(4)})`;
            }
            this._setOn(i, true);
        }

        // ---- 3. Boss frame ----------------------------------------------
        // Linear scan (count ≤ 96): the boss bar shows from first sight, not
        // first damage — walking into the arena IS the reveal.
        let bossSlot = -1;
        for (let s = 0; s < reg.count; s++) {
            if (reg.kind[s] === "boss") { bossSlot = s; break; }
        }
        const bOn = bossSlot >= 0;
        if (bOn !== this._bOn) {
            this._bOn = bOn;
            this._boss.classList.toggle("on", bOn);
        }
        if (bossSlot >= 0) {
            const name = reg.name[bossSlot] || "";
            if (name !== this._bNameTxt) {
                this._bNameTxt = name;
                this._bossName.textContent = name;
            }
            const hp = reg.hpMax[bossSlot] > 0 ?
                Math.max(0, Math.min(1, reg.hp[bossSlot] / reg.hpMax[bossSlot])) : 0;
            if (Math.abs(hp - this._bHp) > 0.002) {
                this._bHp = hp;
                this._bossHpFill.style.transform = `scaleX(${hp.toFixed(4)})`;
            }
            // Stance FILLS as poise depletes (§5.1 Sekiro read); the poise
            // reset on break empties it in one write.
            const st = reg.poiseMax[bossSlot] > 0 ?
                Math.max(0, Math.min(1, 1 - reg.poise[bossSlot] / reg.poiseMax[bossSlot])) : 0;
            if (Math.abs(st - this._bStance) > 0.002) {
                this._bStance = st;
                this._bossStFill.style.transform = `scaleX(${st.toFixed(4)})`;
            }
        }
    }

    /**
     * Stamp `lastHit` for an id, claiming a pool slot if it has none:
     * existing slot for the id, else a free one, else steal the stalest.
     * @param {number} id @param {number} time registry game-time
     * @returns {void}
     */
    _touch(id, time) {
        let free = -1, stale = 0, staleAt = Infinity;
        for (let i = 0; i < POOL; i++) {
            if (this._id[i] === id) { this._lastHit[i] = time; return; }
            if (this._id[i] < 0) { if (free < 0) free = i; }
            else if (this._lastHit[i] < staleAt) { staleAt = this._lastHit[i]; stale = i; }
        }
        const i = free >= 0 ? free : stale;
        this._id[i] = id;
        this._lastHit[i] = time;
        // Poison the caches so the first upkeep pass writes everything.
        this._sx[i] = -1e9; this._sy[i] = -1e9; this._frac[i] = -1;
    }

    /** Free a pool slot and hide its bar. @param {number} i @returns {void} */
    _release(i) {
        this._id[i] = -1;
        if (this._tgtSlot === i) {
            this._bar[i].classList.remove("tgt");
            this._tgtSlot = -1;
        }
        this._setOn(i, false);
    }

    /** Cached visibility toggle. @param {number} i @param {boolean} on @returns {void} */
    _setOn(i, on) {
        const v = on ? 1 : 0;
        if (this._on[i] !== v) {
            this._on[i] = v;
            this._bar[i].classList.toggle("on", on);
        }
    }
}
