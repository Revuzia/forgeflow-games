/**
 * Raw input state. Everything lands in one mutable struct that systems poll —
 * no events fired into game code, no per-frame allocation.
 *
 * Mouse look uses pointer lock, which frees the right button for snow-surf.
 *
 * TWO CONTRACTS THE COMPARISON HARNESS DEPENDS ON — read before touching this
 * file or any consumer of it:
 *
 *  1. `surf` and `spellHeld2` are plain, configurable, writable data properties
 *     of `input`, and every consumer must re-read `input.surf` / `input.spellHeld2`
 *     from the object *each frame*. The harness cannot forge a pointer-lock
 *     gesture, so it pins these held inputs by replacing them with a constant
 *     getter via `Object.defineProperty`. That only works if (a) they start life
 *     as ordinary object-literal properties — never accessors, never frozen —
 *     and (b) nobody has stashed the value in a module-scope local. Cache it and
 *     the pin silently does nothing, and every surf/ribbon shot in the battery
 *     comes out as a plain idle stand.
 *
 *  1b. `jump` follows the same held-property rules as `surf`, and `jumpPressed`
 *     is a per-frame EDGE cleared by `endFrame()` alongside `spellPressed`.
 *     The controller consumes the edge and never writes back to this object —
 *     a pinned property is a getter, and assigning to one throws in a module's
 *     strict mode. Drive jump from the harness with a real `KeyboardEvent` for
 *     `Space` (which is what `_harness/shots.js` `key()` already dispatches);
 *     pinning `jump` on will NOT produce repeated hops, because the controller
 *     triggers on the edge rather than on the held level.
 *
 *  2. The reference clears `input.surf` in a document-level `mouseup` with no
 *     pointer-lock guard, while `mousedown` *is* guarded. That asymmetry is a
 *     real bug, not a stylistic quirk: press the right button before clicking
 *     into the canvas and the release cancels a surf that was never started —
 *     and, worse, any stray right-release anywhere on the page kills an
 *     in-progress carve. The guard is added below to match `mousedown`. Held
 *     state is still dropped on unlock and on window blur, which is where that
 *     cleanup belongs.
 *
 *  3. THE MEANING LAYER'S KEYS (_spec/QUEST_DESIGN.md §7, lane U):
 *     `interactPressed` (E), `journalPressed` (J) and `mapPressed` (M) are
 *     per-frame EDGES exactly like `jumpPressed` — set on the keydown edge,
 *     cleared by `endFrame()`, never written back by a consumer. Nothing in
 *     this file decides what E does: `ui/interact.js` routes it (dialogue
 *     skip -> relic cache -> shrine menu), `ui/journal.js` and
 *     `ui/worldMap.js` consume J and M. A CLOSED panel listens to nothing and
 *     steals no key.
 *
 *  4. THE PANEL STACK. A UI panel that owns the keyboard (journal, map, the
 *     intro card, the ending) calls `openPanel(name, onKey)`; from then on
 *     every keydown is delivered to the TOP panel's `onKey` in the CAPTURE
 *     phase on window and stopped there, so no spell, move, jump or edge key
 *     reaches the game, and the FFG shell's Escape (a window BUBBLE listener)
 *     never sees an Esc a panel consumed — Esc closes the panel first, the
 *     next Esc pauses (QUEST §7). F1 / F3 / Backquote / F5 / F11 / F12 pass
 *     through. `input.panel` names the top panel (null = none): it is what
 *     main.js's pointerlockchange -> shell.pause() guard reads, because a
 *     cursor panel releases the pointer lock on purpose. The two reward
 *     modals (ui/boonPick.js, ui/shrineMenu.js) keep their own capture
 *     handlers and their own `anyModalOpen()`; a cursor panel closes itself
 *     when one of them opens (bus 'ui:open'), so the two never stack.
 */

export const input = {
    // Movement axes, camera-relative, already normalised to a unit disc.
    moveX: 0,
    moveZ: 0,
    moving: false,

    // Accumulated mouse delta since last `endFrame()`, in radians.
    lookX: 0,
    lookY: 0,

    // Zoom, consumed by the camera rig.
    zoomDelta: 0,

    /** @type {boolean} RMB held. Plain data property — see contract 1 above. */
    surf: false,
    /**
     * @type {boolean} Run is ON. Shift is a TOGGLE, not a hold (owner decision
     * 2026-08-04: "click shift should enable run and click again should
     * disable"): the keydown EDGE flips `sprintOn` (auto-repeat is already
     * swallowed by the repeat guard below) and keyup does nothing. Consumers
     * keep reading `sprint`, which `pollInput()` copies from the latch every
     * frame — only the SOURCE changed, not the meaning. The latch clears on
     * pointer-unlock and window blur exactly like the held state does.
     */
    sprintOn: false,
    sprint: false, // resolved from `sprintOn` each `pollInput()`

    /**
     * @type {boolean} SPACE held. Plain data property — see contract 1/1b.
     * Held level, used only to CUT a rise short when the key is released early.
     */
    jump: false,
    /**
     * @type {boolean} SPACE went down this frame. Edge, cleared by `endFrame()`.
     * This is what starts a jump; the controller reads it and never writes it.
     */
    jumpPressed: false,

    /** @type {number} 0 = none, else 1..6 — set on keydown, cleared each frame.
     *  6 is the primary bolt and is set by the LEFT MOUSE BUTTON, not a key. */
    spellPressed: 0,
    /** One-frame edge: TAB pressed — the target-cycle step (combat/targeting).
     *  Plain data property cleared by endFrame(), like `spellPressed`. */
    targetCycle: false,
    /** TEMP realm-portal edge: "sand" | "ash" | null. Set on Digit6/7,
     *  consumed by main.js, cleared by endFrame(). */
    realmPortal: null,
    /**
     * @type {boolean} the held STREAM channel (internal spell id 2, the Ribbon).
     *
     * THE NAME IS DELIBERATELY UNCHANGED. It is `spellHeld2` because the flag
     * carries INTERNAL spell id 2, which is the Ribbon and always has been —
     * only the thing that WRITES it moved, from LMB (owner remap 2026-08-05)
     * to Digit1 (owner remap 2026-08-08). Every harness pin, every
     * `Object.defineProperty` in `_harness/`, and contract 1 above keep working
     * untouched. `spellHeld1` is an alias for the new bind's spelling; both
     * names address the same slot (see `aliasHeld` at the bottom of this file).
     * Plain data property — see contract 1.
     */
    spellHeld2: false,
    /**
     * @type {boolean} LMB is down — the primary bolt auto-repeats while it is.
     *
     * Same contract-1 rules as `surf` / `spellHeld2`: a plain, writable,
     * configurable data property, re-read from `input` every frame, never
     * cached in a module local, so the harness can pin it with
     * `Object.defineProperty` in lieu of a pointer-lock gesture it cannot
     * forge. `spellSystem._dispatch()` is the only consumer.
     */
    boltHeld: false,

    /** One-frame edge: E pressed — interact (contract 3). Cleared by endFrame(). */
    interactPressed: false,
    /** One-frame edge: J pressed — journal toggle (contract 3). */
    journalPressed: false,
    /** One-frame edge: M pressed — world map toggle (contract 3). */
    mapPressed: false,
    /** @type {string|null} the top UI panel that owns the keyboard (contract
     *  4), or null. Read by main.js's pause-on-unlock guard. */
    panel: null,

    locked: false,
};

/**
 * `spellHeld1` — the NEW bind's spelling of the held stream.
 *
 * The flag itself keeps the name `spellHeld2` (it carries INTERNAL id 2, and
 * every harness pin in `_harness/` addresses it by that name — contract 1).
 * This alias exists so code written against the player-facing bind reads
 * naturally, and it is an ACCESSOR ON THE ALIAS ONLY: `spellHeld2` stays the
 * plain, writable, configurable data property contract 1 requires, so pinning
 * it still works and the alias correctly reports the pinned value.
 */
Object.defineProperty(input, "spellHeld1", {
    get() { return input.spellHeld2; },
    set(v) { input.spellHeld2 = !!v; },
    configurable: true,
    enumerable: false,
});

const keys = Object.create(null);

const LOOK_SCALE = 0.0022;

/** @type {(() => void)|null} */
let onToggleOverlay = null;

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ onToggleOverlay?: (code?: string) => void }} [hooks]
 * @returns {void}
 */
export function initInput(canvas, hooks) {
    onToggleOverlay = hooks?.onToggleOverlay ?? null;
    _hookPanelKeys();

    canvas.addEventListener("click", () => {
        // A cursor panel is up: the click belongs to the panel, not the lock.
        if (_panels.length > 0 && _panels[_panels.length - 1].cursor) return;
        if (!input.locked) canvas.requestPointerLock();
    });

    document.addEventListener("pointerlockchange", () => {
        input.locked = document.pointerLockElement === canvas;
        if (!input.locked) {
            // Drop held state so the character doesn't run off while unfocused.
            dropHeld();
        } else if (_panels.length > 0 && _panels[_panels.length - 1].cursor) {
            // A re-lock requested by a closing modal landed AFTER a cursor
            // panel opened (the shrine menu's Chronicle -> journal hand-off):
            // the panel needs the cursor, so give it back.
            try { document.exitPointerLock(); } catch (e) { /* nothing held */ }
        }
    });

    document.addEventListener("mousemove", (e) => {
        if (!input.locked) return;
        input.lookX += e.movementX * LOOK_SCALE;
        input.lookY += e.movementY * LOOK_SCALE;
    });

    canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    document.addEventListener("mousedown", (e) => {
        // LOAD-BEARING, not cosmetic (it was cosmetic before this remap): LMB
        // is also the pointer-lock gesture, so without this guard the very
        // click that acquires the lock would also fire a bolt.
        if (!input.locked) return;
        if (e.button === 2) input.surf = true;
        // LMB = the PRIMARY BOLT (owner remap 2026-08-08), internal id 6.
        // Press fires one immediately through the `spellPressed` edge — which
        // is also what the spellbar flash and the crosshair cast pulse read —
        // and `boltHeld` keeps it repeating on the 0.45 s fire cycle.
        if (e.button === 0) {
            input.boltHeld = true;
            input.spellPressed = 6;
        }
    });

    document.addEventListener("mouseup", (e) => {
        // Guarded to match `mousedown` — see contract 2 in the file docblock.
        // Without this, a right-release that never had a matching locked press
        // cancels a surf, and unlock/blur already clear the flag anyway.
        if (!input.locked) return;
        if (e.button === 2) input.surf = false;
        if (e.button === 0) input.boltHeld = false;
    });

    document.addEventListener(
        "wheel",
        (e) => {
            if (!input.locked) return;
            e.preventDefault();
            input.zoomDelta += e.deltaY * 0.0016;
        },
        { passive: false }
    );

    window.addEventListener("keydown", (e) => {
        // Panel keys work whether or not the pointer is locked. F1 = settings,
        // F3 = debug, backtick = whichever panel was open last. `ui/overlay.js`
        // handles these itself in CAPTURE phase because only it knows which key
        // selects which panel; the hook fires afterwards as the integrator's
        // undirected fallback and is debounced into the same press there.
        if (e.code === "F1" || e.code === "F3" || e.code === "Backquote") {
            e.preventDefault();
            onToggleOverlay?.(e.code);
            return;
        }
        // Unconditionally, and before the repeat guard: an unlocked page scrolls
        // under the canvas on SPACE, and auto-repeat scrolls it continuously.
        if (e.code === "Space") e.preventDefault();
        // TAB is the target cycle: always preventDefault, or the browser
        // walks focus out of the canvas and the next keystroke is lost.
        if (e.code === "Tab") {
            e.preventDefault();
            if (!e.repeat) input.targetCycle = true;
        }

        if (e.repeat) return;
        // Belt and braces for contract 4: the capture handler already stopped
        // every key while a panel is up; nothing below may fire then.
        if (_panels.length > 0) return;
        keys[e.code] = true;

        // Contract 3: the meaning layer's edges.
        if (e.code === "KeyE") input.interactPressed = true;
        else if (e.code === "KeyJ") input.journalPressed = true;
        else if (e.code === "KeyM") input.mapPressed = true;

        // SHIFT toggles run. On the press edge only — the repeat guard above
        // is what keeps a held Shift from strobing the latch — and keyup
        // deliberately does nothing. Both Shift keys flip the same latch.
        if (e.code === "ShiftLeft" || e.code === "ShiftRight") {
            input.sprintOn = !input.sprintOn;
        }

        // SPACE = JUMP. Snow-surf stays on the right mouse button alone; SPACE
        // is deliberately NOT a second surf binding.
        if (e.code === "Space") {
            input.jump = true;
            // The repeat guard above is what keeps a held key from re-firing the
            // edge — holding SPACE gives one jump, not a stream of them.
            input.jumpPressed = true;
        }

        // DIGIT1 IS THE HELD STREAM, and it is deliberately NOT in SPELL_KEYS.
        // `spellSystem._dispatch()` polls the hold and then edge-fires
        // `input.spellPressed`, excluding the ribbon with a literal `key !== 2`
        // guard. Routing Digit1 through SPELL_KEYS would be swallowed by that
        // guard for casting purposes but would still set `spellPressed` every
        // frame the key auto-repeats, and `spellbar.js` + `crosshair.js` both
        // read `spellPressed` directly — so a hold would strobe a cast flash.
        // A dedicated keydown/keyup pair writes the held flag instead, exactly
        // as the mouse handlers used to, so contract 1's pin still works.
        // Digit1 is the FROST ARC cast edge (owner 2026-08-12). The held
        // stream lost its keyboard bind; `spellHeld2` stays a writable
        // property because the harness contract pins it directly.
        if (e.code === "Digit1" && !e.repeat) input.spellPressed = 7;
        // TEMPORARY realm portals (owner 2026-08-13): 6 = Sand, 7 = Ash;
        // main.js consumes the edge and toggles back to Cold when the
        // pressed realm is already active. Remove with the toolbar pair.
        if (e.code === "Digit6" && !e.repeat) input.realmPortal = "sand";
        if (e.code === "Digit7" && !e.repeat) input.realmPortal = "ash";

        const n = SPELL_KEYS[e.code];
        if (n) input.spellPressed = n;
    });

    window.addEventListener("keyup", (e) => {
        keys[e.code] = false;
        if (e.code === "Space") input.jump = false;
        // (Digit1 keyup: nothing — the arc is an edge, not a hold.)
    });

    window.addEventListener("blur", dropHeld);
}

/** Drop every held key and held flag (unlock, blur, a panel opening). */
function dropHeld() {
    for (const k in keys) keys[k] = false;
    input.surf = false;
    input.jump = false;
    input.spellHeld2 = false;
    input.boltHeld = false;
    input.sprintOn = false;
}

// ---------------------------------------------------------------------------
// The panel stack (contract 4)
// ---------------------------------------------------------------------------

/** @type {{name:string, onKey:(e:KeyboardEvent)=>void, cursor:boolean}[]} */
const _panels = [];
let _panelKeysHooked = false;

/** Keys a panel never swallows (the settings/debug panels, browser keys) —
 *  the same list ui/boonPick.js uses. @param {string} code */
function passThrough(code) {
    return code === "F1" || code === "F3" || code === "F5" || code === "F11" ||
        code === "F12" || code === "Backquote";
}

/**
 * [INTEGRATOR] M is the WORLD MAP in play (QUEST_DESIGN §7), but the page
 * control bar (game_controls.js, owned by the FFG page furniture) binds M to
 * MUTE on its own window keydown listener, which is registered before this
 * module's — so before this guard every map open also flipped the page mute
 * (measured by reading game_controls' mute state across an M press). While
 * the game is in play the map owns the key: the edge is set HERE, in the
 * capture phase, and the event is stopped so the bar never sees it. On the
 * title / pause menus (no map there) M still reaches the bar and mutes; the
 * bar's Mute button works everywhere. Without a shell (automation) the map
 * owns it too. A panel on top keeps its own handling below.
 * @param {KeyboardEvent} e @returns {boolean} whether M was taken
 */
function _mapKey(e) {
    if (e.code !== "KeyM") return false;
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return false;
    const FFG = globalThis.FFG;
    const shell = FFG ? FFG.shell : null;
    if (shell && shell.phase !== "playing") return false;
    if (!e.repeat) input.mapPressed = true;
    e.preventDefault();
    e.stopImmediatePropagation();
    return true;
}

/** @param {KeyboardEvent} e */
function _panelKey(e) {
    if (_panels.length === 0) { _mapKey(e); return; }
    if (passThrough(e.code)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const top = _panels[_panels.length - 1];
    try {
        top.onKey(e);
    } catch (err) {
        console.error("[input] panel '" + top.name + "' key handler threw:", err);
    }
}

function _hookPanelKeys() {
    if (_panelKeysHooked || typeof window === "undefined" || !window.addEventListener) return;
    _panelKeysHooked = true;
    window.addEventListener("keydown", _panelKey, true);
}

/**
 * A UI panel takes the keyboard (contract 4). Re-opening a panel already on
 * the stack moves it to the top.
 * @param {string} name
 * @param {(e: KeyboardEvent) => void} onKey every keydown while on top
 * @param {{cursor?: boolean}} [opt] cursor: the panel needs the mouse — the
 *   pointer lock is released now (and kept released while it is on top)
 * @returns {void}
 */
export function openPanel(name, onKey, opt) {
    _hookPanelKeys();
    for (let i = _panels.length - 1; i >= 0; i--) {
        if (_panels[i].name === name) _panels.splice(i, 1);
    }
    const cursor = !!(opt && opt.cursor);
    _panels.push({ name, onKey: onKey || (() => {}), cursor });
    input.panel = name;
    // Nothing held when the panel opened may keep acting behind it.
    dropHeld();
    input.interactPressed = input.journalPressed = input.mapPressed = false;
    input.jumpPressed = false;
    input.spellPressed = 0;
    if (cursor && typeof document !== "undefined" && document.pointerLockElement) {
        try { document.exitPointerLock(); } catch (e) { /* nothing held */ }
    }
}

/**
 * Pop a panel (anywhere in the stack). Does NOT re-lock the pointer — the
 * panel decides that (`requestLock()`), since only it knows whether a modal
 * or the shell now owns the screen.
 * @param {string} name @returns {boolean} whether it was open
 */
export function closePanel(name) {
    let was = false;
    for (let i = _panels.length - 1; i >= 0; i--) {
        if (_panels[i].name === name) { _panels.splice(i, 1); was = true; }
    }
    input.panel = _panels.length ? _panels[_panels.length - 1].name : null;
    return was;
}

/** Is any UI panel holding the keyboard? @returns {boolean} */
export function panelOpen() {
    return _panels.length > 0;
}

/**
 * Ask for the pointer lock back on the game canvas (#view). Needs a user
 * gesture (a click, or a non-Esc keydown); a refusal is not an error — the
 * canvas click re-locks.
 * @returns {void}
 */
export function requestLock() {
    if (typeof document === "undefined") return;
    const cv = document.getElementById("view");
    if (!cv || document.pointerLockElement === cv || !cv.requestPointerLock) return;
    try {
        const p = /** @type {any} */ (cv.requestPointerLock());
        if (p && p.catch) p.catch(() => {});
    } catch (e) { /* no gesture */ }
}

/**
 * Key -> INTERNAL spell id (owner remap 2026-08-08): the primary BOLT takes
 * LMB (internal id 6, handled by the mouse handlers above, never here), the
 * Ribbon's held stream moves off LMB onto Digit1 (handled by its own
 * keydown/keyup pair above, also never here), and the four cast spells shift
 * one key UP so the bar reads 1..5 left to right.
 *
 * The internal ids never change — sweep 1, ribbon 2, bloom 3, crystallize 4,
 * vortex 5, bolt 6. Only this table and the handlers above decide bindings.
 *
 *   LMB -> 6 bolt      (mousedown, + auto-repeat off `boltHeld`)
 *   1   -> 2 stream    (keydown/keyup pair, held)
 *   2   -> 1 wave
 *   3   -> 3 bloom
 *   4   -> 4 spikes
 *   5   -> 5 vortex
 */
const SPELL_KEYS = {
    Digit2: 1,   // wave / crescent
    Digit3: 3,   // bloom / eruption
    Digit4: 4,   // crystal spikes / stance-break disc
    Digit5: 5,   // vortex / helices
};

/**
 * Resolve held keys into movement axes. Called once per frame before update.
 * @returns {void}
 */
export function pollInput() {
    let x = 0;
    let z = 0;
    if (keys.KeyW || keys.ArrowUp) z += 1;
    if (keys.KeyS || keys.ArrowDown) z -= 1;
    if (keys.KeyD || keys.ArrowRight) x += 1;
    if (keys.KeyA || keys.ArrowLeft) x -= 1;

    // Clamp to a unit disc so diagonals aren't faster.
    const len = Math.sqrt(x * x + z * z);
    if (len > 1) {
        x /= len;
        z /= len;
    }
    input.moveX = x;
    input.moveZ = z;
    input.moving = len > 0.001;
    // From the latch, not the held keys — Shift is a toggle (see `sprintOn`).
    // Copied every frame so every consumer's `input.sprint` read is unchanged.
    input.sprint = input.sprintOn;
}

/**
 * Clear per-frame accumulators. Called at the very end of the frame.
 *
 * Note what is *not* cleared: `surf`, `jump`, `spellHeld2` and `boltHeld` are
 * level-triggered held state, not per-frame edges. Clearing them here would
 * fight the harness pin.
 * @returns {void}
 */
export function endFrame() {
    input.lookX = 0;
    input.lookY = 0;
    input.zoomDelta = 0;
    input.spellPressed = 0;
    input.jumpPressed = false;
    input.targetCycle = false;
    input.realmPortal = null;
    input.interactPressed = false;
    input.journalPressed = false;
    input.mapPressed = false;
}

/**
 * @param {string} code a `KeyboardEvent.code`
 * @returns {boolean}
 */
export function isDown(code) {
    return !!keys[code];
}
