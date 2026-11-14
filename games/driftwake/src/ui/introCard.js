/**
 * THE INTRO CARD — _spec/QUEST_DESIGN.md §6.1: "Title -> PLAY -> a 3-line
 * INTRO CARD over the key art (fades in line by line, skippable with any
 * key): the premise in three sentences." Shown ONCE per fresh run.
 *
 * WHEN. A NEW RUN (the shell's PLAY -> `progression.newGame()`) re-
 * deserializes every save section with reason 'new'; this module's section
 * ('quest.introSeen', a boolean beside lane Q's `quest.endingSeen`) arms the
 * card then, and it opens on the first frame the FFG shell is in play. A
 * CONTINUE ('load') or a boot ('register') never shows it, and an old save
 * without the key counts as seen. Under automation (no shell) it never opens
 * by itself — `show()` is the probe's path — so no harness timeline moves.
 *
 * WHILE UP: time is frozen (`S.freezeTime`, the existing pause pattern — the
 * world must not start before the player has read where they are), the card
 * covers the screen at z 95, and the keyboard belongs to it through the
 * input.js panel stack (any key closes; F1/F3 pass through). The pointer lock
 * PLAY took is KEPT, so closing it drops the player straight into the ride;
 * if the lock is lost (Esc releases it in the browser) the card closes itself
 * at once so the shell's pause menu is never hidden underneath it.
 *
 * TIMELINE on WALL time (the game clock is frozen): line i fades in at
 * LINE_AT[i]; the card closes by itself HOLD_S after the last line.
 *
 * MODULE SHAPE: constructor(ctx), update(dt) (arms the open), setRealm(),
 * plus show() / close() / isOpen / seen. ctx: progression, S, bus, input.
 * Self-registers as `ctx.introCard`.
 */

import { input as coreInput, openPanel, closePanel } from "../core/input.js";
import { bus as coreBus } from "../quests/events.js";
import { STORY } from "../quests/storyText.js";
import { anyModalOpen } from "./boonPick.js";

/** Seconds (wall) at which each line starts to fade in. */
export const LINE_AT = [0.6, 2.9, 5.2];
/** Seconds the full card holds after the last line before closing itself. */
export const HOLD_S = 4.2;
const KEYART = "./assets/ui/keyart.jpg";

const CSS = `
#dw-intro {
  position: fixed; inset: 0; z-index: 95; display: none;
  align-items: center; justify-content: center; flex-direction: column;
  background:
    radial-gradient(ellipse 70% 60% at 50% 55%, rgba(4, 9, 17, 0.55) 0%, rgba(4, 9, 17, 0.86) 100%),
    url("${KEYART}") center / cover no-repeat, #05090f;
  font-family: "Segoe UI", system-ui, sans-serif; color: rgba(240, 248, 253, 0.96);
  text-align: center; cursor: default;
}
#dw-intro.open { display: flex; animation: dw-intro-in 600ms ease-out; }
@keyframes dw-intro-in { from { opacity: 0; } to { opacity: 1; } }
#dw-intro.out { opacity: 0; transition: opacity 500ms ease; }
#dw-intro .in-kick {
  font: 600 11px/1 "Segoe UI", system-ui, sans-serif; letter-spacing: 0.4em; text-transform: uppercase;
  color: #a8dcf5; margin-bottom: 26px; text-shadow: 0 0 14px rgba(120, 205, 245, 0.45);
}
#dw-intro .in-line {
  max-width: min(760px, calc(100vw - 48px)); margin: 0 auto 18px;
  font: 300 clamp(17px, 2.1vw, 24px)/1.5 "Segoe UI", system-ui, sans-serif;
  letter-spacing: 0.01em; text-shadow: 0 2px 10px rgba(0, 0, 0, 0.9);
  opacity: 0; transform: translateY(8px); transition: opacity 1.1s ease, transform 1.1s ease;
}
#dw-intro .in-line.on { opacity: 1; transform: none; }
#dw-intro .in-skip {
  position: absolute; bottom: 34px; left: 0; right: 0;
  font: 500 11px/1 "Segoe UI", system-ui, sans-serif; letter-spacing: 0.2em; text-transform: uppercase;
  color: rgba(205, 228, 244, 0.5);
}
`;

let _cssDone = false;
function ensureCss() {
    if (_cssDone || typeof document === "undefined") return;
    _cssDone = true;
    const s = document.createElement("style");
    s.id = "dw-intro-css";
    s.textContent = CSS;
    document.head.appendChild(s);
}

export class IntroCard {
    /** @param {any} ctx */
    constructor(ctx) {
        ensureCss();
        this.ctx = ctx;
        this.S = ctx.S || null;
        this.bus = ctx.bus || coreBus;
        this.input = ctx.input || coreInput;
        /** Wall clock (overridable by probes). */
        this.now = () => performance.now();

        const lines = STORY.intro && STORY.intro.lines ? STORY.intro.lines : [];
        const el = document.createElement("div");
        el.id = "dw-intro";
        el.innerHTML = '<div class="in-kick">Driftwake</div>';
        for (let i = 0; i < lines.length; i++) {
            const d = document.createElement("div");
            d.className = "in-line";
            d.textContent = lines[i];
            el.appendChild(d);
        }
        const sk = document.createElement("div");
        sk.className = "in-skip";
        sk.textContent = "Press any key";
        el.appendChild(sk);
        document.body.appendChild(el);
        this.el = el;
        this._lines = el.querySelectorAll(".in-line");

        this.isOpen = false;
        /** Seen in this run (persisted). */
        this.seen = true;
        /** Armed by a NEW RUN; opens on the first in-play frame. */
        this.pending = false;
        this._t0 = 0;
        this._shown = 0;
        this._raf = 0;
        this._freezeBefore = false;
        /** Probe surface. */
        this.stats = { shows: 0, closes: 0, skipped: 0, auto: 0, linesShown: 0 };

        this._onKey = (e) => { if (!e.repeat) this.close(true); };
        el.addEventListener("click", () => this.close(true));
        this._hadLock = false;
        this._onLock = () => {
            if (!this.isOpen || typeof document === "undefined") return;
            // PLAY's lock often lands a frame AFTER the card opened.
            if (document.pointerLockElement) { this._hadLock = true; return; }
            // The lock was lost (Esc in the browser): never hide the pause menu.
            if (this._hadLock) this.close(true);
        };
        if (typeof document !== "undefined") document.addEventListener("pointerlockchange", this._onLock);

        const P = ctx.progression;
        this._unreg = null;
        if (P && typeof P.registerSaveSection === "function") {
            this._unreg = P.registerSaveSection("quest.introSeen", {
                serialize: () => !!this.seen,
                deserialize: (v, info) => {
                    const reason = info && info.reason ? info.reason : "load";
                    if (reason === "new") {
                        this.seen = false;
                        this.pending = true;
                    } else {
                        // A CONTINUE / boot: shown already, or a save from
                        // before the card existed — never replay it.
                        this.seen = v !== false;
                        this.pending = false;
                    }
                },
            });
        }
        ctx.introCard = this;
    }

    /** Arms the open once the shell is in play. @param {number} dt */
    update(dt) {
        if (!this.pending || this.isOpen || dt === 0) return;
        const shell = globalThis.FFG ? globalThis.FFG.shell : null;
        if (!shell || shell.phase !== "playing" || anyModalOpen()) return;
        this.show();
    }

    /** Open the card now (also the probe path). @returns {boolean} */
    show() {
        if (this.isOpen) return false;
        this.isOpen = true;
        this.pending = false;
        this.seen = true;
        this.stats.shows++;
        this._hadLock = typeof document !== "undefined" && !!document.pointerLockElement;
        if (this.S) {
            this._freezeBefore = !!this.S.freezeTime;
            this.S.freezeTime = true;
        }
        for (let i = 0; i < this._lines.length; i++) this._lines[i].classList.remove("on");
        this.el.classList.remove("out");
        this.el.classList.add("open");
        openPanel("intro", this._onKey);
        this._t0 = this.now();
        this._shown = 0;
        this.bus.emit("ui:open", { panel: "intro" });
        this._loop();
        return true;
    }

    /**
     * Close. @param {boolean} [skipped] a key / click / lost lock (vs the
     * timeline running out) @returns {void}
     */
    close(skipped) {
        if (!this.isOpen) return;
        this.isOpen = false;
        this.stats.closes++;
        if (skipped) this.stats.skipped++; else this.stats.auto++;
        this.el.classList.remove("open");
        closePanel("intro");
        if (this.S) this.S.freezeTime = this._freezeBefore;
        const P = this.ctx.progression;
        if (P && P.save) P.save();
        this.bus.emit("ui:close", { panel: "intro" });
    }

    /** One timeline step on the wall clock. @returns {void} */
    tick() {
        if (!this.isOpen) return;
        const t = (this.now() - this._t0) / 1000;
        while (this._shown < this._lines.length && t >= LINE_AT[this._shown]) {
            this._lines[this._shown].classList.add("on");
            this._shown++;
            this.stats.linesShown++;
        }
        const end = LINE_AT[Math.max(0, this._lines.length - 1)] + HOLD_S;
        if (t >= end) this.close(false);
    }

    _loop() {
        if (!this.isOpen) return;
        this.tick();
        if (this.isOpen && typeof requestAnimationFrame === "function") {
            requestAnimationFrame(() => this._loop());
        }
    }

    setRealm() {}

    dispose() {
        this.close(true);
        if (this._unreg) this._unreg();
        if (typeof document !== "undefined") document.removeEventListener("pointerlockchange", this._onLock);
        if (this.el.parentNode) this.el.parentNode.removeChild(this.el);
    }
}
