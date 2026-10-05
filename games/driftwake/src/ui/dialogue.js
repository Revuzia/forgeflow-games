/**
 * DIALOGUE — the Echo's voice on screen (_spec/QUEST_DESIGN.md §1, §7):
 * bottom-centre above the spellbar (and above the boss frame and the XP bar,
 * which share that column), the speaker's name over typewriter text. It
 * auto-advances after a reading time, E skips (ui/interact.js routes the key,
 * after a cache or a shrine in reach: the first press finishes the line being
 * typed, the next moves on), and it NEVER pauses gameplay.
 *
 * Fed by the bus 'dialogue' event {speaker, lines, id[, shrine]} (the quest
 * engine: step echoes, shrine first-activation lines). Arrivals queue — a
 * shrine's line and the step echo it completes often land on the same frame
 * — and play in order; the same id is never queued twice in a row.
 *
 * THE TYPEWRITER IS ALLOCATION-FREE. A line is laid out ONCE (one span per
 * character, invisible) when it starts; each frame only adds the class "on"
 * to the newly revealed spans, so the box never reflows while it types and no
 * string is built per frame. Typing runs on GAME time (it freezes with the
 * world under a modal or the pause menu, and resumes where it was).
 *
 * MODULE SHAPE: constructor(ctx), update(dt), setRealm(token), plus `skip()`
 * (returns true when it consumed the press) and `active`. ctx: bus, input,
 * overlay, realms, getRealm.
 */

import { input as coreInput } from "../core/input.js";
import { bus as coreBus } from "../quests/events.js";
import { STORY } from "../quests/storyText.js";
import { hudShown, realmAccent } from "./questTracker.js";

/** Characters per second of game time. */
export const TYPE_CPS = 46;
/** Reading time after a line completes: base + per character, clamped. */
export const READ_BASE = 1.3;
export const READ_PER_CHAR = 0.042;
export const READ_MIN = 2.2;
export const READ_MAX = 6.5;
/** Most dialogues held in the queue (oldest pending dropped beyond it). */
const QUEUE_MAX = 6;

/** Reading time for a line of `n` characters, s. @param {number} n */
export function readTime(n) {
    const t = READ_BASE + READ_PER_CHAR * n;
    return t < READ_MIN ? READ_MIN : t > READ_MAX ? READ_MAX : t;
}

const CSS = `
#dw-dialogue {
  position: fixed; left: 50%; bottom: 178px;
  transform: translate(-50%, 6px);
  width: min(600px, calc(100vw - 32px)); box-sizing: border-box;
  z-index: 56; pointer-events: none;
  padding: 10px 18px 12px;
  border-radius: 10px;
  background: linear-gradient(180deg, rgba(14, 22, 30, 0.72), rgba(8, 13, 19, 0.82));
  border: 1px solid rgba(160, 205, 235, 0.26);
  box-shadow: 0 6px 22px rgba(0, 0, 0, 0.45), inset 0 0 16px rgba(120, 180, 220, 0.06);
  font-family: "Segoe UI", system-ui, sans-serif;
  color: rgba(240, 248, 253, 0.95);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.95);
  opacity: 0; transition: opacity 260ms ease, transform 260ms ease;
  --dl-accent: #a8dcf5;
}
#dw-dialogue.show { opacity: 0.97; transform: translate(-50%, 0); }
#dw-dialogue::after {
  content: ""; position: absolute; left: 12px; right: 12px; top: 1px; height: 1px;
  background: rgba(230, 245, 255, 0.26); border-radius: 1px;
}
#dw-dialogue .dl-who {
  font: 600 10px/1 "Segoe UI", system-ui, sans-serif;
  letter-spacing: 0.24em; text-transform: uppercase; color: var(--dl-accent);
}
#dw-dialogue .dl-text {
  margin-top: 6px; min-height: 21px;
  font: italic 400 15.5px/1.42 "Segoe UI", system-ui, sans-serif;
}
#dw-dialogue .dl-text span { opacity: 0; transition: opacity 90ms linear; }
#dw-dialogue .dl-text span.on { opacity: 1; }
#dw-dialogue .dl-more {
  position: absolute; right: 12px; top: 8px;
  font: 600 9.5px/1 "Segoe UI", system-ui, sans-serif; letter-spacing: 0.08em;
  color: rgba(205, 228, 244, 0.55);
}
#dw-dialogue .dl-more b {
  display: inline-block; padding: 2px 5px; margin-right: 4px; border-radius: 3px;
  border: 1px solid rgba(160, 205, 235, 0.4); color: rgba(220, 240, 252, 0.85);
}
`;

let _cssDone = false;
function ensureCss() {
    if (_cssDone || typeof document === "undefined") return;
    _cssDone = true;
    const s = document.createElement("style");
    s.id = "dw-dialogue-css";
    s.textContent = CSS;
    document.head.appendChild(s);
}

export class Dialogue {
    /** @param {any} ctx */
    constructor(ctx) {
        ensureCss();
        this.ctx = ctx;
        this.bus = ctx.bus || coreBus;
        this.input = ctx.input || coreInput;

        const el = document.createElement("div");
        el.id = "dw-dialogue";
        el.innerHTML = '<div class="dl-who"></div><div class="dl-text"></div>' +
            '<div class="dl-more"><b>E</b>skip</div>';
        document.body.appendChild(el);
        this.el = el;
        this._who = el.querySelector(".dl-who");
        this._text = el.querySelector(".dl-text");

        /** @type {{speaker:string, lines:string[], id:string}[]} */
        this.queue = [];
        /** The dialogue on screen, or null. */
        this.current = null;
        this.line = 0;
        /** Characters revealed (fractional) and the line's length. */
        this._shown = 0;
        this._len = 0;
        this._revealed = 0;
        /** Reading clock once the line is fully typed (-1 = still typing). */
        this._hold = -1;
        /** @type {any[]} the current line's character spans */
        this._spans = [];
        this._show = false;
        this._lastId = "";
        /** Probe surface. */
        this.stats = { played: 0, lines: 0, skips: 0, dropped: 0 };

        this._off = this.bus.on("dialogue", (p) => this.say(p));
        this.el.style.setProperty("--dl-accent", realmAccent(ctx, ctx.getRealm ? ctx.getRealm() : "cold"));
    }

    /** Is a dialogue on screen or waiting? */
    get active() { return this.current !== null; }

    /** Is the current line still typing? */
    get typing() { return this.current !== null && this._hold < 0; }

    /**
     * Queue a dialogue (the 'dialogue' payload). @param {any} p
     * @returns {boolean} queued
     */
    say(p) {
        if (!p || !Array.isArray(p.lines) || p.lines.length === 0) return false;
        const id = p.id || "";
        const last = this.queue.length ? this.queue[this.queue.length - 1].id
            : (this.current ? this.current.id : "");
        if (id && id === last) return false;
        if (this.queue.length >= QUEUE_MAX) { this.queue.shift(); this.stats.dropped++; }
        this.queue.push({
            speaker: p.speaker || (STORY.ui ? STORY.ui.speaker : ""),
            lines: p.lines.slice(0, 3), id,
        });
        if (!this.current) this._next();
        return true;
    }

    /**
     * The E press (ui/interact.js): finish the typing line, else move on.
     * @returns {boolean} true when the press was consumed
     */
    skip() {
        if (!this.current) return false;
        this.stats.skips++;
        if (this._hold < 0) {
            this._reveal(this._len);
            this._shown = this._len;
            this._hold = 0;
        } else {
            this._advance();
        }
        return true;
    }

    /** Drop everything on screen and queued (a realm change does NOT). */
    clear() {
        this.queue.length = 0;
        this.current = null;
        this._text.innerHTML = "";
        this._spans = [];
    }

    /** @param {number} dt */
    update(dt) {
        if (dt !== 0 && this.current) {
            if (this._hold < 0) {
                this._shown += TYPE_CPS * dt;
                const n = this._shown >= this._len ? this._len : Math.floor(this._shown);
                if (n !== this._revealed) this._reveal(n);
                if (n >= this._len) this._hold = 0;
            } else {
                this._hold += dt;
                if (this._hold >= readTime(this._len)) this._advance();
            }
        }
        // Visibility LAST, so the frame that ends a dialogue also hides it.
        const show = this.current !== null && hudShown(this.input, this.ctx.overlay);
        if (show !== this._show) {
            this._show = show;
            this.el.classList.toggle("show", show);
        }
    }

    /** @param {string} token */
    setRealm(token) {
        this.el.style.setProperty("--dl-accent", realmAccent(this.ctx, token));
    }

    dispose() {
        if (this._off) this._off();
        if (this.el.parentNode) this.el.parentNode.removeChild(this.el);
    }

    // ------------------------------------------------------------ internals

    _next() {
        const d = this.queue.shift() || null;
        this.current = d;
        if (!d) { this._text.innerHTML = ""; this._spans = []; return; }
        this._lastId = d.id;
        this.stats.played++;
        this._who.textContent = d.speaker;
        this.line = 0;
        this._startLine();
    }

    _startLine() {
        const s = this.current.lines[this.line] || "";
        this.stats.lines++;
        // One span per character, laid out once (event-rate allocation).
        this._text.innerHTML = "";
        const spans = new Array(s.length);
        for (let i = 0; i < s.length; i++) {
            const sp = document.createElement("span");
            sp.textContent = s[i];
            this._text.appendChild(sp);
            spans[i] = sp;
        }
        this._spans = spans;
        this._len = s.length;
        this._shown = 0;
        this._revealed = 0;
        this._hold = -1;
    }

    /** Reveal spans up to `n`. @param {number} n */
    _reveal(n) {
        const sp = this._spans;
        for (let i = this._revealed; i < n && i < sp.length; i++) sp[i].classList.add("on");
        this._revealed = n;
    }

    _advance() {
        if (!this.current) return;
        this.line++;
        if (this.line < this.current.lines.length) this._startLine();
        else this._next();
    }
}
