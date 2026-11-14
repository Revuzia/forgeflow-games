/**
 * The two on-screen panels: SETTINGS on F1, DEBUG on F3.
 *
 * One panel used to carry everything — 49 art sliders, the frame graph, the CPU
 * and GPU breakdowns, every system toggle and eleven debug views. That is a
 * developer console wearing a settings menu's clothes, so it is split the way
 * shipping games split it:
 *
 *   F1  SETTINGS  player-facing. Quality preset, resolution, audio, and the art
 *                 parameters, grouped, in the panel's own visual language.
 *   F3  DEBUG     developer-facing. Frame graph, percentiles, draws/tris, the
 *                 per-system CPU breakdown, the per-pass GPU profile, live
 *                 character and camera state, and the debug views. Compact,
 *                 monospaced, top-left, dark plate under the text so it stays
 *                 readable over lit snow — the register everyone already knows
 *                 from Minecraft's F3.
 *   `             toggles whichever panel was open last, so the muscle memory
 *                 from the single-panel build still works.
 *
 * BOTH PANELS ARE CHILDREN OF `#overlay`, and that is load-bearing, not tidiness.
 * The comparison harness hides `#boot`, `#hint` and `#overlay` before every
 * screenshot (`shoot.py`: `e.style.display = 'none'`). A panel mounted anywhere
 * else lands in the shot and contaminates the blind comparison the whole port is
 * judged on. `#overlay` is therefore a bare, click-through container — it has no
 * appearance of its own, it only positions the two panels and carries the hide.
 *
 * Two more selectors the harness reaches through, which is why the widget markup
 * below is unchanged: `#overlay .row` holding a `<label>`, an `input[type=range]`
 * and a `.val` (`pathcheck.py` drives the row labelled "Resolution";
 * `probe_ui_slider.py` drives any row by its label text), and
 * `#overlay .presets button` carrying one button per entry in `PRESETS`.
 *
 * Both panels are built at construction and stay in the DOM whether or not they
 * are shown, because those probes drive the widgets while the overlay is hidden.
 *
 * Everything is built from `SCHEMA` — a settings key with no widget is a bug in
 * `settings.js`, not here — and a group that `SCHEMA` grows later (Audio, say)
 * appears in the settings panel with no change needed here.
 *
 * Refresh rates: readouts 4 Hz, frame graph 20 Hz (fast enough to watch a hitch
 * appear), live state 10 Hz (at 4 Hz you cannot tell which way you nudged the
 * rig). All of it is skipped entirely unless the debug panel is open, and the
 * settings panel costs nothing per frame at all.
 */

import { S, SCHEMA, PRESETS, set, applyPreset, onChange } from "../core/settings.js";
import { input } from "../core/input.js";
import {
    stats, systemMs, FrameGraph, spikes, resetSpikes,
    profileCount, profileNames, profileEma, profileTotal,
} from "../core/perf.js";

/**
 * Keys that belong to the DEBUG panel rather than SETTINGS. Everything else in
 * `SCHEMA` is player-facing and lands on F1. Routing by key and not by group
 * because `SCHEMA`'s "Systems" group mixes the two: the resolution controls are
 * a player's quality lever, while the visibility toggles next to them are a
 * developer's isolation switch.
 */
const DEBUG_KEYS = new Set([
    "showTerrain", "showCharacter", "meshCharacter", "wireframe", "freezeTime",
    "debugProfile", "debugProfileDeep", "debugView",
]);

/**
 * Group headings reworded for the player-facing panel. "Systems" is what is left
 * of that group once the debug switches move out — resolution scale and the
 * dynamic-resolution controller — and "Display" is what those actually are.
 */
const GROUP_LABEL = { Systems: "Display" };

const CSS = `
/* The container. No appearance, no hit area — it exists to position the panels
   and to be the single element the harness hides. */
#overlay {
  position: fixed; inset: 0; z-index: 80; display: none;
  pointer-events: none;
  font: 400 11px/1.5 ui-monospace, "SF Mono", "Cascadia Mono", Menlo, monospace;
}
#overlay.show { display: block; }
#overlay .panel { display: none; pointer-events: auto; }
#overlay .panel.show { display: block; }

/* --------------------------------------------------------------- settings */

#ov-set {
  position: absolute; top: 0; right: 0; bottom: 0;
  width: 336px;
  color: #cddaea;
  background: rgba(8, 12, 19, 0.86);
  backdrop-filter: blur(18px) saturate(1.2);
  border-left: 1px solid rgba(143, 196, 232, 0.14);
  overflow-y: auto; overscroll-behavior: contain;
  padding: 14px 16px 40px;
}

/* ------------------------------------------------------------------ debug */

/* Top-left, narrow, and plated: over sunlit snow, light text with no backing is
   unreadable, and a full-width panel would cover the thing being debugged. */
#ov-dbg {
  position: absolute; top: 10px; left: 10px;
  width: 272px; max-height: calc(100vh - 20px);
  color: #dde8f2;
  background: rgba(5, 9, 15, 0.72);
  border: 1px solid rgba(143, 196, 232, 0.13);
  border-radius: 3px;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.85);
  overflow-y: auto; overscroll-behavior: contain;
  padding: 9px 11px 12px;
  line-height: 1.42;
}

#overlay .panel::-webkit-scrollbar { width: 8px; }
#overlay .panel::-webkit-scrollbar-thumb { background: rgba(143,196,232,0.16); border-radius: 4px; }

/* ---------------------------------------------------------------- shared */

#overlay h2 {
  font-size: 10px; font-weight: 500; letter-spacing: 0.22em; text-transform: uppercase;
  color: #6f8296; margin: 20px 0 8px; padding-bottom: 6px;
  border-bottom: 1px solid rgba(143, 196, 232, 0.10);
}
#overlay h2:first-child { margin-top: 0; }
/* The debug panel is a dense readout, not a document: its headings are separators
   between blocks, so they are tighter and carry no rule. */
#ov-dbg h2 {
  font-size: 9px; letter-spacing: 0.18em; color: #62788c;
  margin: 9px 0 3px; padding-bottom: 0; border-bottom: 0;
}

#overlay .hdr {
  display: flex; align-items: baseline; justify-content: space-between;
  margin-bottom: 12px;
}
#overlay .hdr b { font-size: 11px; font-weight: 600; letter-spacing: 0.3em; color: #e6eff8; }
#overlay .hdr i { font-style: normal; font-size: 9px; letter-spacing: 0.14em; color: #55677a; }
#ov-dbg .hdr { margin-bottom: 7px; }
#ov-dbg .hdr b { letter-spacing: 0.22em; }

#overlay canvas { width: 100%; height: 44px; display: block;
  background: rgba(0,0,0,0.34); border: 1px solid rgba(143,196,232,0.10); border-radius: 2px; }

#overlay .nums { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 10px; margin-top: 8px; }
#overlay .num { display: flex; justify-content: space-between; }
#overlay .num span:first-child { color: #6f8296; }
#overlay .num span:last-child { font-variant-numeric: tabular-nums; color: #dbe6f2; }
#overlay .num.warn span:last-child { color: #e8b04f; }
#overlay .num.bad  span:last-child { color: #e8734f; }
#ov-dbg .nums { gap: 0 10px; margin-top: 6px; }
/* System and pass names are long ("cpu wake+spray", "post composite (full)") and
   this panel is narrow on purpose. Two columns wrapped them onto second lines and
   broke the number alignment, which is the one thing a readout has to keep. */
#ov-dbg .budget { grid-template-columns: 1fr; gap: 0; }

#overlay .row { display: flex; align-items: center; gap: 8px; margin: 5px 0; }
#overlay .row > label { flex: 0 0 108px; color: #8fa3b8; cursor: default; }
#overlay .row > .val { flex: 0 0 46px; text-align: right; font-variant-numeric: tabular-nums; color: #dbe6f2; }
#ov-dbg .row { margin: 3px 0; gap: 6px; }
#ov-dbg .row > label { flex: 0 0 84px; }

#overlay input[type=range] { flex: 1; -webkit-appearance: none; appearance: none;
  height: 2px; background: rgba(143,196,232,0.18); border-radius: 2px; outline: none; }
#overlay input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; appearance: none;
  width: 10px; height: 10px; border-radius: 50%; background: #8fc4e8; cursor: grab;
  box-shadow: 0 0 8px rgba(143,196,232,0.5); }
#overlay input[type=range]::-webkit-slider-thumb:active { cursor: grabbing; background: #eaf4ff; }

#overlay .tog { flex: 1; display: flex; align-items: center; justify-content: flex-end; }
#overlay .sw { width: 26px; height: 14px; border-radius: 7px; background: rgba(143,196,232,0.16);
  position: relative; cursor: pointer; transition: background 140ms ease; }
#overlay .sw::after { content: ""; position: absolute; top: 2px; left: 2px; width: 10px; height: 10px;
  border-radius: 50%; background: #7d8ea3;
  transition: transform 140ms cubic-bezier(0.4,0,0.2,1), background 140ms ease; }
#overlay .sw.on { background: rgba(143,196,232,0.34); }
#overlay .sw.on::after { transform: translateX(12px); background: #eaf4ff; }

#overlay select { flex: 1; background: rgba(0,0,0,0.35); color: #dbe6f2;
  border: 1px solid rgba(143,196,232,0.16); border-radius: 3px; padding: 2px 5px;
  font: inherit; outline: none; cursor: pointer; }

#overlay .presets, #overlay .btns { display: flex; gap: 6px; margin-top: 4px; }
#overlay .presets button, #overlay .btns button {
  flex: 1; background: rgba(143,196,232,0.07); color: #8fa3b8;
  border: 1px solid rgba(143,196,232,0.14); border-radius: 3px; padding: 5px 0;
  font: inherit; letter-spacing: 0.08em; cursor: pointer; transition: all 140ms ease; }
#overlay .presets button:hover, #overlay .btns button:hover {
  background: rgba(143,196,232,0.14); color: #dbe6f2; }
#overlay .presets button.on { background: rgba(143,196,232,0.22); color: #eaf4ff;
  border-color: rgba(143,196,232,0.4); }

#overlay .budget { margin-top: 4px; }
#overlay .budget .num span:last-child { color: #9fb4c8; }

#overlay .nums.one { grid-template-columns: 1fr; gap: 1px; }
/* white-space: pre so the sign-padding in fmt2 survives — without it the
   columns shift by a character every time a coordinate crosses zero. */
#overlay .cam .num span:last-child { color: #a9d3ef; letter-spacing: 0.02em; white-space: pre; }
#overlay .pose { margin-top: 7px; padding: 6px 7px; border-radius: 3px;
  background: rgba(0,0,0,0.34); border: 1px solid rgba(143,196,232,0.10);
  color: #7f93a8; font-size: 10px; line-height: 1.45; word-break: break-all;
  user-select: text; cursor: text; }

/* The one line of prose in the settings panel: what the other key does. */
#ov-set .foot { margin-top: 22px; font-size: 9px; letter-spacing: 0.12em;
  text-transform: uppercase; color: #4d5e70; }
`;

export class Overlay {
    /**
     * @param {{ rig?: any, character?: any, renderer?: any }} [refs]
     *   Live systems the debug readouts sample. All optional so the overlay can
     *   be constructed before they exist; see `attach()`.
     */
    constructor(refs) {
        const style = document.createElement("style");
        style.textContent = CSS;
        document.head.appendChild(style);

        const el = document.createElement("div");
        el.id = "overlay";
        document.body.appendChild(el);
        this.el = el;

        this.rig = refs?.rig ?? null;
        this.character = refs?.character ?? null;
        this.renderer = refs?.renderer ?? null;

        /** @type {Record<string, HTMLElement>} */
        this.readouts = {};
        /** @type {Array<{k:string, sync:() => void}>} */
        this.widgets = [];

        const setEl = document.createElement("div");
        setEl.id = "ov-set";
        setEl.className = "panel";
        el.appendChild(setEl);
        this.setEl = setEl;

        const dbgEl = document.createElement("div");
        dbgEl.id = "ov-dbg";
        dbgEl.className = "panel";
        el.appendChild(dbgEl);
        this.dbgEl = dbgEl;

        this.setOpen = false;
        this.dbgOpen = false;
        /** Which panel the backtick reopens. @type {"settings"|"debug"} */
        this._last = "settings";

        this._buildSettings(setEl);
        this._buildDebug(dbgEl);

        this._acc = 0;
        this._graphAcc = 0;
        this._camAcc = 0;
        this._pose = "";
        this._lastKeyToggle = 0;

        this.toggleFromKey = this.toggleFromKey.bind(this);
        // CAPTURE phase, deliberately. `input.js` also listens for these keys and
        // calls whatever the integrator handed to `initInput({ onToggleOverlay })`
        // — today `() => overlay.toggle()`, which cannot know WHICH key was
        // pressed. Handling the press here first means F1 and F3 select their own
        // panel, and the hook's undirected call arrives inside the dead time in
        // `toggle()` and collapses into it. Capture rather than bubble so the
        // ordering holds however the integrator orders construction.
        window.addEventListener("keydown", (e) => {
            if (e.code === "F1" || e.code === "F3" || e.code === "Backquote") {
                e.preventDefault();
                this.toggleFromKey(e.code);
            }
        }, true);
    }

    /**
     * Late-bind the systems the readouts sample.
     * @param {{ rig?: any, character?: any, renderer?: any }} refs
     * @returns {void}
     */
    attach(refs) {
        if (refs.rig) this.rig = refs.rig;
        if (refs.character) this.character = refs.character;
        if (refs.renderer) this.renderer = refs.renderer;
    }

    /** True while either panel is showing. @returns {boolean} */
    get visible() {
        return this.setOpen || this.dbgOpen;
    }

    // ------------------------------------------------------------- building

    /** @param {HTMLElement} root */
    _buildSettings(root) {
        const hdr = document.createElement("div");
        hdr.className = "hdr";
        hdr.innerHTML = "<b>DRIFTWAKE</b><i>F1 to close</i>";
        root.appendChild(hdr);

        // Quality first: it is the one control that moves everything else, and a
        // player who opens this panel at 8 fps is looking for exactly this.
        this._mkHead(root, "Quality");
        const pr = document.createElement("div");
        pr.className = "presets";
        root.appendChild(pr);
        /** @type {Record<string, HTMLButtonElement>} */
        this.presetBtns = {};
        // Enumerated from `PRESETS`, not from a literal list. The list was
        // `["ultra", "high", "balanced"]`, so a rung added to the store had no
        // button and looked unimplemented from the UI — the same class of silent
        // divergence as a preset name that does not match the settings in force.
        for (const name in PRESETS) {
            const b = document.createElement("button");
            b.textContent = name;
            b.onclick = () => applyPreset(name);
            pr.appendChild(b);
            this.presetBtns[name] = b;
        }
        // Subscribe rather than resync inside the click handler: the preset can
        // be applied from outside the DOM (`SNOWFLOW.applyPreset`, a harness, an
        // embedder), and a panel that only repaints on its own clicks shows a
        // stale rung for every one of those.
        this._offPreset = onChange("preset", () => {
            this._syncPresets();
            this._syncWidgets();
        });
        this._syncPresets();

        for (const g of settingsGroups()) {
            this._mkHead(root, g.label);
            for (let i = 0; i < g.items.length; i++) this._mkRow(root, g.items[i]);
        }

        const foot = document.createElement("div");
        foot.className = "foot";
        foot.textContent = "F3 · debug";
        root.appendChild(foot);
    }

    /** @param {HTMLElement} root */
    _buildDebug(root) {
        const hdr = document.createElement("div");
        hdr.className = "hdr";
        hdr.innerHTML = "<b>DRIFTWAKE</b><i>F3 to close</i>";
        root.appendChild(hdr);

        const cv = document.createElement("canvas");
        cv.width = 248;
        cv.height = 44;
        root.appendChild(cv);
        this.graph = new FrameGraph(cv);

        const nums = document.createElement("div");
        nums.className = "nums";
        root.appendChild(nums);
        this._mkNum(nums, "fps", "fps");
        this._mkNum(nums, "fpsLow", "1% low");
        this._mkNum(nums, "median", "median");
        this._mkNum(nums, "p95", "95th");
        this._mkNum(nums, "p99", "99th");
        this._mkNum(nums, "gpu", "gpu ms");
        this._mkNum(nums, "draws", "draws");
        this._mkNum(nums, "tris", "tris");
        this._mkNum(nums, "spikes", "spikes");
        this._mkNum(nums, "res", "res");

        // ------------------------------------------------------------ state
        // Above the two breakdowns deliberately. This is the block that is read
        // while actually playing, and the CPU and GPU tables are twenty-odd rows
        // that would push it off the bottom of the screen the moment the
        // profiler is switched on.
        //
        // Everything needed to describe, and later reproduce, the exact moment
        // on screen: where the player is, what they are doing, where the camera
        // is looking, in the units the systems actually store.
        this._mkHead(root, "player");
        const chr = document.createElement("div");
        chr.className = "nums one cam";
        root.appendChild(chr);
        this._mkNum(chr, "chrPos", "xyz");
        this._mkNum(chr, "chrMot", "speed / facing");
        this._mkNum(chr, "chrAct", "surf / air");
        this._mkNum(chr, "chrRun", "run");

        this._mkHead(root, "camera");
        const cam = document.createElement("div");
        cam.className = "nums one cam";
        root.appendChild(cam);
        this._mkNum(cam, "camPos", "eye");
        this._mkNum(cam, "camAng", "yaw / pitch");
        this._mkNum(cam, "camArm", "arm / fov");

        const pose = document.createElement("div");
        pose.className = "pose";
        pose.textContent = "—";
        root.appendChild(pose);
        this.poseEl = pose;

        const pb = document.createElement("div");
        pb.className = "btns";
        root.appendChild(pb);
        const copy = document.createElement("button");
        copy.textContent = "copy pose";
        copy.onclick = () => this._copyPose(copy);
        pb.appendChild(copy);

        // ---------------------------------------------------- CPU breakdown
        this._mkHead(root, "cpu ms");
        const budget = document.createElement("div");
        budget.className = "nums budget";
        root.appendChild(budget);
        this.budgetEl = budget;
        /** @type {Map<string, HTMLElement>} */
        this.budgetRows = new Map();

        // ------------------------------------------------------- GPU passes
        // The GPU analogue of the block above, fed by the timer queries in
        // `core/perf.js`. Empty and hidden until `S.debugProfile` is switched on,
        // because a permanently blank section reads as a broken feature.
        const gh = this._mkHead(root, "gpu passes");
        gh.style.display = "none";
        this.gpuHead = gh;
        const gpu = document.createElement("div");
        gpu.className = "nums one budget";
        root.appendChild(gpu);
        this.gpuEl = gpu;
        /** @type {HTMLElement[]} id-indexed, created as scopes are first seen. */
        this.gpuRows = [];

        // ----------------------------------------------------------- switches
        this._mkHead(root, "views");
        for (const it of debugItems()) this._mkRow(root, it);
    }

    /** @param {HTMLElement} parent @param {string} text @returns {HTMLElement} */
    _mkHead(parent, text) {
        const h = document.createElement("h2");
        h.textContent = text;
        parent.appendChild(h);
        return h;
    }

    _mkNum(parent, key, label) {
        const d = document.createElement("div");
        d.className = "num";
        const a = document.createElement("span");
        a.textContent = label;
        const b = document.createElement("span");
        b.textContent = "—";
        d.appendChild(a);
        d.appendChild(b);
        parent.appendChild(d);
        this.readouts[key] = b;
        this.readouts[key + "_row"] = d;
    }

    /**
     * One `SCHEMA` item as a widget row. The markup is fixed by the harness —
     * `.row` > `<label>` + control (+ `.val` for a slider) — see the file header.
     * @param {HTMLElement} parent
     * @param {{k:string,l:string,t:string,min?:number,max?:number,step?:number,opts?:string[]}} it
     */
    _mkRow(parent, it) {
        const row = document.createElement("div");
        row.className = "row";
        const lab = document.createElement("label");
        lab.textContent = it.l;
        row.appendChild(lab);

        if (it.t === "f") {
            const r = document.createElement("input");
            r.type = "range";
            r.min = String(it.min);
            r.max = String(it.max);
            r.step = String(it.step);
            r.value = String(S[it.k]);
            const v = document.createElement("span");
            v.className = "val";
            v.textContent = fmtNum(S[it.k], it.step);
            r.oninput = () => {
                const n = parseFloat(r.value);
                set(it.k, n);
                v.textContent = fmtNum(n, it.step);
            };
            row.appendChild(r);
            row.appendChild(v);
            this.widgets.push({
                k: it.k,
                sync: () => {
                    r.value = String(S[it.k]);
                    v.textContent = fmtNum(S[it.k], it.step);
                },
            });
        } else if (it.t === "b") {
            const wrap = document.createElement("div");
            wrap.className = "tog";
            const sw = document.createElement("div");
            sw.className = "sw" + (S[it.k] ? " on" : "");
            sw.onclick = () => {
                const n = !S[it.k];
                set(it.k, n);
                sw.classList.toggle("on", n);
            };
            wrap.appendChild(sw);
            row.appendChild(wrap);
            this.widgets.push({
                k: it.k,
                sync: () => sw.classList.toggle("on", !!S[it.k]),
            });
        } else if (it.t === "e") {
            const sel = document.createElement("select");
            for (let o = 0; o < it.opts.length; o++) {
                const op = document.createElement("option");
                op.value = it.opts[o];
                op.textContent = it.opts[o];
                sel.appendChild(op);
            }
            sel.value = String(S[it.k]);
            sel.onchange = () => set(it.k, sel.value);
            row.appendChild(sel);
            this.widgets.push({ k: it.k, sync: () => (sel.value = String(S[it.k])) });
        }

        parent.appendChild(row);
    }

    _syncPresets() {
        for (const k in this.presetBtns) {
            this.presetBtns[k].classList.toggle("on", S.preset === k);
        }
    }

    _syncWidgets() {
        for (let i = 0; i < this.widgets.length; i++) this.widgets[i].sync();
    }

    // -------------------------------------------------------------- panels

    /**
     * Show or hide one panel. The undirected, programmatic entry point.
     * @param {"settings"|"debug"} name
     * @param {boolean} on
     * @returns {void}
     */
    setPanel(name, on) {
        const dbg = name === "debug";
        const el = dbg ? this.dbgEl : this.setEl;
        if (dbg) this.dbgOpen = on;
        else this.setOpen = on;
        el.classList.toggle("show", on);

        if (on) {
            this._last = name;
            this._syncWidgets();
            // Repaint on the next frame rather than after a quarter second of
            // dashes — the throttles below are for steady state, not for opening.
            this._acc = 1e6;
            this._graphAcc = 1e6;
            this._camAcc = 1e6;
        }
        // The container carries the hide, so it shows only while something is in it.
        this.el.classList.toggle("show", this.visible);
    }

    /**
     * @param {"settings"|"debug"} name
     * @returns {boolean}
     */
    isOpen(name) {
        return name === "debug" ? this.dbgOpen : this.setOpen;
    }

    /**
     * Toggle a panel. Named argument = programmatic, and always acts.
     *
     * NO ARGUMENT is the legacy hook path: `initInput({ onToggleOverlay })` is
     * handed `() => overlay.toggle()` by the integrator, and it fires for the
     * same physical key press this class already handled in capture phase. It
     * cannot say which key, so it is debounced into the press it belongs to.
     * Without that dead time the two paths cancel and the key does nothing at
     * all — which is exactly what F1 did before this split: measured, one press,
     * `toggle()` entered twice, panel back where it started.
     *
     * @param {"settings"|"debug"} [which]
     * @returns {void}
     */
    toggle(which) {
        if (which === undefined) {
            const now = performance.now();
            if (now - this._lastKeyToggle < 50) return;
            this._lastKeyToggle = now;
            which = this._last;
        }
        this.setPanel(which, !this.isOpen(which));
    }

    /**
     * Toggle from a key press, debounced against the hook path above.
     *
     * Backtick has no panel of its own: it reopens whatever was open last, which
     * is what keeps the single-panel build's muscle memory working.
     *
     * @param {string} [code] a `KeyboardEvent.code`
     * @returns {void}
     */
    toggleFromKey(code) {
        const now = performance.now();
        if (now - this._lastKeyToggle < 50) return;
        this._lastKeyToggle = now;
        const which = code === "F1" ? "settings" : code === "F3" ? "debug" : this._last;
        this.setPanel(which, !this.isOpen(which));
    }

    // -------------------------------------------------------------- update

    /**
     * @param {number} dtMs wall-clock frame time
     * @param {any} [renderer] a THREE.WebGLRenderer, for the resolution readout
     * @returns {void}
     */
    update(dtMs, renderer) {
        if (renderer) this.renderer = renderer;
        // The settings panel has no live readouts, so an open settings panel
        // costs exactly nothing per frame.
        if (!this.dbgOpen) return;

        this._graphAcc += dtMs;
        if (this._graphAcc >= 50) {
            this._graphAcc = 0;
            this.graph.draw();
        }

        this._camAcc += dtMs;
        if (this._camAcc >= 100) {
            this._camAcc = 0;
            this._updateState();
        }

        this._acc += dtMs;
        if (this._acc < 250) return;
        this._acc = 0;

        const r = this.readouts;
        this._txt(r.fps, stats.fps.toFixed(0));
        this._txt(r.fpsLow, stats.fpsLow.toFixed(0));
        this._txt(r.median, stats.median.toFixed(2));
        this._txt(r.p95, stats.p95.toFixed(2));
        this._txt(r.p99, stats.p99.toFixed(2));
        // A dash rather than 0.00 when the browser exposes no timer query: an
        // unavailable number and a zero one are not the same claim. The sigma
        // marks the other claim change: while the profiler is on this is the sum
        // of the timed scopes, not one whole-frame query, and the two are not
        // interchangeable (see the profile block in core/perf.js).
        this._txt(
            r.gpu,
            stats.gpuMs > 0
                ? stats.gpuMs.toFixed(2) + (stats.gpuProfiled ? " Σ" : "")
                : "—"
        );
        this._txt(r.draws, String(stats.drawCalls));
        this._txt(r.tris, fmtK(stats.triangles));
        this._txt(r.spikes, String(spikes.count));

        const c = this.renderer && this.renderer.domElement;
        this._txt(r.res, c ? c.width + "x" + c.height : "—");

        r.fps_row.className = "num" + (stats.fps < 60 ? " bad" : stats.fps < 88 ? " warn" : "");
        r.fpsLow_row.className =
            "num" + (stats.fpsLow < 60 ? " bad" : stats.fpsLow < 75 ? " warn" : "");
        r.spikes_row.className = "num" + (spikes.count > 0 ? " warn" : "");

        // Per-system costs — rows are created lazily and then only mutated.
        for (const name in systemMs) {
            let row = this.budgetRows.get(name);
            if (!row) {
                this._mkNum(this.budgetEl, "sys_" + name, name);
                row = this.readouts["sys_" + name];
                this.budgetRows.set(name, row);
            }
            this._txt(row, systemMs[name].toFixed(2));
        }

        this._updateGpuPasses();
    }

    /**
     * The per-pass GPU breakdown. Rows appear in the order the scopes are first
     * seen, which is frame order, so the block reads top to bottom as the frame
     * executes. Each row is `ms  (share of the profiled total)`.
     * @returns {void}
     */
    _updateGpuPasses() {
        const n = stats.gpuProfiled ? profileCount() : 0;
        // Hide the ROWS with the heading, not just the heading. The rows are
        // built once and only mutated, so switching the profiler off used to
        // leave the last measurement on screen under no heading at all — a stale
        // table that reads as a live one, which is the worst thing a readout can
        // do. They repopulate from the EMAs the moment it is switched back on.
        this.gpuHead.style.display = n > 0 ? "" : "none";
        this.gpuEl.style.display = n > 0 ? "" : "none";
        if (n === 0) return;

        const names = profileNames();
        const ema = profileEma();
        const total = profileTotal();

        for (let i = 0; i < n; i++) {
            let row = this.gpuRows[i];
            if (!row) {
                this._mkNum(this.gpuEl, "gpu_" + i, names[i]);
                row = this.readouts["gpu_" + i];
                this.gpuRows[i] = row;
            }
            const ms = ema[i];
            const pct = total > 0 ? (ms / total) * 100 : 0;
            this._txt(row, ms.toFixed(2) + "  " + pct.toFixed(0) + "%");
        }
    }

    // ---------------------------------------------------- character + camera
    _updateState() {
        const r = this.readouts;

        const c = this.character;
        if (c && c.position) {
            const q = c.position;
            this._txt(r.chrPos, fmt2(q.x) + "  " + fmt2(q.y) + "  " + fmt2(q.z));
            const speed = typeof c.speed === "number" ? c.speed : 0;
            const facing = typeof c.facing === "number" ? c.facing : 0;
            this._txt(
                r.chrMot,
                speed.toFixed(2) + " m/s  " + wrapDeg(facing * RAD).toFixed(0) + "°"
            );
            // `airborne` / `airTime` / `airHeight` are the jump controller's, and
            // this panel is read on builds that predate it as well as after.
            // Absent reads as a dash — "not reported" and "on the ground" are
            // different claims, and the second would be a lie on a build that
            // cannot jump at all.
            const surf = typeof c.surf === "number" ? c.surf : 0;
            const air =
                typeof c.airTime === "number" && typeof c.airborne === "boolean"
                    ? (c.airborne
                        ? "air " + c.airTime.toFixed(2) + "s" +
                          (typeof c.airHeight === "number" ? " " + c.airHeight.toFixed(2) + "m" : "")
                        : "ground")
                    : "—";
            this._txt(r.chrAct, surf.toFixed(2) + "  " + air);
        } else {
            this._txt(r.chrPos, "—");
            this._txt(r.chrMot, "—");
            this._txt(r.chrAct, "—");
        }
        // The Shift toggle's latch, straight from the source. Shown whether or
        // not a character is attached — the latch is input state, not pose.
        this._txt(r.chrRun, input.sprintOn ? "on" : "off");

        const rig = this.rig;
        if (!rig) {
            this._txt(r.camPos, "no rig");
            this._txt(this.poseEl, "—");
            return;
        }

        const p = rig.camera.position;
        this._txt(r.camPos, fmt2(p.x) + "  " + fmt2(p.y) + "  " + fmt2(p.z));
        // Yaw wrapped to a compass reading; pitch signed, positive = looking
        // down, which is the rig's own convention.
        this._txt(
            r.camAng,
            wrapDeg(rig.yaw * RAD).toFixed(1) + "°  " + signDeg(rig.pitch * RAD)
        );
        this._txt(
            r.camArm,
            rig.distance.toFixed(2) + " m  " + (rig.fov * RAD).toFixed(1) + "° v"
        );

        this._pose = this._poseScript();
        this._txt(this.poseEl, this._pose);
    }

    /**
     * A one-liner that reproduces the current pose. Paste it into the console.
     *
     * It writes `SNOWFLOW`, not `DRIFTWAKE`: that global is the contract the
     * comparison harness drives BOTH this build and the WebGPU reference
     * through, so the line has to be paste-able into either one.
     */
    _poseScript() {
        const rig = this.rig;
        if (!rig) return "—";
        const c = this.character;
        let s = "const s=SNOWFLOW;";
        if (c && c.position) {
            const facing = typeof c.facing === "number" ? c.facing : 0;
            s +=
                "s.character.position.set(" +
                fmt2(c.position.x) + "," + fmt2(c.position.y) + "," + fmt2(c.position.z) +
                ");s.character.facing=" + facing.toFixed(3) + ";";
        }
        s +=
            "s.rig.yaw=" + rig.yaw.toFixed(3) +
            ";s.rig.pitch=" + rig.pitch.toFixed(3) +
            ";s.rig.distance=s.rig.distanceTarget=" + rig.distance.toFixed(2) + ";";
        return s;
    }

    _copyPose(btn) {
        const text = this._pose || this._poseScript();
        const done = (ok) => {
            btn.textContent = ok ? "copied" : "select + copy";
            if (!ok) {
                // No console here (ARCHITECTURE §6) — the pose panel is
                // selectable text, so leave it where it can be copied by hand.
                const sel = window.getSelection();
                if (sel && this.poseEl) {
                    const range = document.createRange();
                    range.selectNodeContents(this.poseEl);
                    sel.removeAllRanges();
                    sel.addRange(range);
                }
            }
            setTimeout(() => (btn.textContent = "copy pose"), 1200);
        };
        // Clipboard access can be refused (no focus, insecure context); the
        // selection fallback still gets the pose out.
        try {
            navigator.clipboard.writeText(text).then(() => done(true), () => done(false));
        } catch {
            done(false);
        }
    }

    /** Only touch the DOM when the string actually changed. */
    _txt(el, s) {
        if (el._v !== s) {
            el._v = s;
            el.textContent = s;
        }
    }

    /** @returns {void} */
    resetSpikes() {
        resetSpikes();
    }
}

/**
 * `SCHEMA`, minus the debug keys, as the settings panel's groups. A group that
 * loses every item disappears rather than leaving an empty heading, and an Audio
 * group — which `SCHEMA` does not have yet — is pulled up next to Quality where
 * a player expects it rather than landing wherever it was appended.
 * @returns {{label:string, items:any[]}[]}
 */
function settingsGroups() {
    const out = [];
    for (let g = 0; g < SCHEMA.length; g++) {
        const items = SCHEMA[g].items.filter((it) => !DEBUG_KEYS.has(it.k));
        if (items.length) out.push({ label: GROUP_LABEL[SCHEMA[g].group] || SCHEMA[g].group, items });
    }
    const ai = out.findIndex((g) => g.label.toLowerCase().startsWith("audio"));
    if (ai > 0) out.unshift(out.splice(ai, 1)[0]);
    return out;
}

/**
 * The debug keys, in `SCHEMA` order. Read out of `SCHEMA` rather than declared
 * here so a debug toggle keeps its authored label, range and options in one
 * place — and so a key named in `DEBUG_KEYS` that `SCHEMA` drops simply stops
 * appearing instead of throwing.
 * @returns {any[]}
 */
function debugItems() {
    const out = [];
    for (let g = 0; g < SCHEMA.length; g++) {
        const items = SCHEMA[g].items;
        for (let i = 0; i < items.length; i++) {
            if (DEBUG_KEYS.has(items[i].k)) out.push(items[i]);
        }
    }
    return out;
}

const RAD = 180 / Math.PI;

/** Fixed-width two-decimal metres, sign-padded so columns don't jitter. */
function fmt2(v) {
    const s = v.toFixed(2);
    return v < 0 ? s : " " + s;
}

function wrapDeg(d) {
    d %= 360;
    return d < 0 ? d + 360 : d;
}

function signDeg(d) {
    return (d >= 0 ? "+" : "") + d.toFixed(1) + "°";
}

function fmtNum(v, step) {
    if (step >= 1) return v.toFixed(0);
    if (step >= 0.01) return v.toFixed(2);
    if (step >= 0.001) return v.toFixed(3);
    return v.toFixed(4);
}

function fmtK(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(0) + "k";
    return String(n);
}
