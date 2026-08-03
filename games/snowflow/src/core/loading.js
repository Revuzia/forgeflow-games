/**
 * Loading-screen driver.
 *
 * A phase-weighted progress model: each phase declares how much of the bar it
 * owns, and the bar only ever moves forward. `phase()` also yields to the
 * browser so the DOM actually repaints between heavy synchronous steps —
 * without the double-rAF the whole bake runs inside one task and the bar jumps
 * from 0 to 100 at the end.
 */

const bar = /** @type {HTMLElement} */ (document.getElementById("boot-bar"));
const label = /** @type {HTMLElement} */ (document.getElementById("boot-phase"));
const root = /** @type {HTMLElement} */ (document.getElementById("boot"));
const hint = /** @type {HTMLElement} */ (document.getElementById("hint"));

let progress = 0;

/**
 * Yield to the compositor so the loading screen repaints.
 *
 * Two frames, not one: the first rAF lands before style/layout for the write we
 * just made, the second lands after it has been painted.
 * @returns {Promise<void>}
 */
export function nextFrame() {
    return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}

/**
 * @param {string} text shown under the bar
 * @param {number} to target progress, 0..1
 * @returns {Promise<void>}
 */
export async function phase(text, to) {
    if (label) label.textContent = text;
    progress = Math.max(progress, to);
    if (bar) bar.style.width = (progress * 100).toFixed(1) + "%";
    await nextFrame();
}

/**
 * Finish the boot sequence: land the bar, fade the screen, flash the hint.
 *
 * The harness waits on `#boot` carrying the class `gone`, so this is also the
 * signal that the scene is shootable.
 * @returns {Promise<void>}
 */
export async function done() {
    await phase("ready", 1);
    // Let the bar visibly land before the fade starts.
    await new Promise((r) => setTimeout(r, 360));
    root?.classList.add("gone");
    hint?.classList.add("show");
    setTimeout(() => {
        root?.remove();
        hint?.classList.remove("show");
    }, 6000);
}

/**
 * Hard failure. Replaces the boot screen with the `#nogpu` panel; `message`
 * overwrites the panel's headline.
 * @param {string} [message]
 * @returns {void}
 */
export function fail(message) {
    root?.remove();
    const el = document.getElementById("nogpu");
    if (el) {
        el.classList.add("show");
        const b = el.querySelector("b");
        if (b && message) b.textContent = message;
    }
}
