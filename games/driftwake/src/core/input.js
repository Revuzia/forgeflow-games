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

    /** @type {number} 0 = none, else 1..5 — set on keydown, cleared each frame */
    spellPressed: 0,
    /** @type {boolean} spell 2 (Ribbon) is a held cast. Plain data property — see contract 1. */
    spellHeld2: false,

    locked: false,
};

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

    canvas.addEventListener("click", () => {
        if (!input.locked) canvas.requestPointerLock();
    });

    document.addEventListener("pointerlockchange", () => {
        input.locked = document.pointerLockElement === canvas;
        if (!input.locked) {
            // Drop held state so the character doesn't run off while unfocused.
            for (const k in keys) keys[k] = false;
            input.surf = false;
            input.jump = false;
            input.spellHeld2 = false;
            input.sprintOn = false;
        }
    });

    document.addEventListener("mousemove", (e) => {
        if (!input.locked) return;
        input.lookX += e.movementX * LOOK_SCALE;
        input.lookY += e.movementY * LOOK_SCALE;
    });

    canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    document.addEventListener("mousedown", (e) => {
        if (!input.locked) return;
        if (e.button === 2) input.surf = true;
    });

    document.addEventListener("mouseup", (e) => {
        // Guarded to match `mousedown` — see contract 2 in the file docblock.
        // Without this, a right-release that never had a matching locked press
        // cancels a surf, and unlock/blur already clear the flag anyway.
        if (!input.locked) return;
        if (e.button === 2) input.surf = false;
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

        if (e.repeat) return;
        keys[e.code] = true;

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

        const n = SPELL_KEYS[e.code];
        if (n) {
            input.spellPressed = n;
            if (n === 2) input.spellHeld2 = true;
        }
    });

    window.addEventListener("keyup", (e) => {
        keys[e.code] = false;
        if (e.code === "Space") input.jump = false;
        if (SPELL_KEYS[e.code] === 2) input.spellHeld2 = false;
    });

    window.addEventListener("blur", () => {
        for (const k in keys) keys[k] = false;
        input.surf = false;
        input.jump = false;
        input.spellHeld2 = false;
        input.sprintOn = false;
    });
}

const SPELL_KEYS = {
    Digit1: 1,
    Digit2: 2,
    Digit3: 3,
    Digit4: 4,
    Digit5: 5,
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
 * Note what is *not* cleared: `surf`, `jump` and `spellHeld2` are level-triggered
 * held state, not per-frame edges. Clearing them here would fight the harness pin.
 * @returns {void}
 */
export function endFrame() {
    input.lookX = 0;
    input.lookY = 0;
    input.zoomDelta = 0;
    input.spellPressed = 0;
    input.jumpPressed = false;
}

/**
 * @param {string} code a `KeyboardEvent.code`
 * @returns {boolean}
 */
export function isDown(code) {
    return !!keys[code];
}
