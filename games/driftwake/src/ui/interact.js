/**
 * THE E KEY — one router for "interact" (_spec/QUEST_DESIGN.md §3.1, §5, §7),
 * so a single press never does two things.
 *
 * ORDER (first taker wins):
 *   1. an unopened relic cache within 3 m   -> open it     (world/caches.js
 *                                              `tryInteract()`, lane W)
 *   2. an activated shrine within 7 m       -> shrine menu (ui/shrineMenu.js
 *                                              `reach` / `open()`, lane R)
 *   3. the Echo is speaking                 -> finish the typing line, or
 *                                              move to the next one
 *                                              (ui/dialogue.js `skip()`)
 * Nothing fires while a reward modal (`anyModalOpen()`) or a lane-U panel
 * (`input.panel`) owns the keyboard — those take E themselves.
 *
 * Why the dialogue comes LAST: E is "interact" first. The Echo mostly speaks
 * AT a shrine (its first activation) — a press there means "open the
 * shrine"; the line pauses under the menu (the modal freezes game time, which
 * the typewriter runs on) and carries on after it. With nothing in reach, E
 * is the skip key (QUEST §7: "E to skip").
 *
 * Lane W's caches read `input.interactPressed` themselves unless told not to
 * (wiring (a) in caches.js); this router takes wiring (b): it sets
 * `caches.readsInput = false` on construction. The caches keep their own
 * prompt ("E  Open Relic Cache"); this module draws the matching prompt for
 * an activated shrine in reach ("E  <shrine name> · rest, travel, boons"),
 * same frost glass, same place under the crosshair (they are never both in
 * reach: landmarks keep 120 m from every shrine).
 *
 * MODULE SHAPE: constructor(ctx), update(dt) (the press is handled only when
 * dt > 0; the prompt's visibility follows the HUD at any dt). ctx: input,
 * overlay, dialogue, caches, shrineMenu, getRealm.
 */

import { input as coreInput } from "../core/input.js";
import { anyModalOpen } from "./boonPick.js";
import { STORY } from "../quests/storyText.js";
import { hudShown } from "./questTracker.js";

const CSS = `
#dw-prompt {
  position: fixed; left: 50%; top: calc(50% + 72px);
  transform: translateX(-50%);
  z-index: 56; pointer-events: none;
  display: flex; align-items: center; gap: 10px;
  padding: 7px 14px 7px 7px; border-radius: 9px; white-space: nowrap;
  background: linear-gradient(180deg, rgba(14, 22, 30, 0.58), rgba(8, 13, 19, 0.72));
  border: 1px solid rgba(160, 205, 235, 0.26);
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.45), inset 0 0 10px rgba(120, 180, 220, 0.05);
  color: rgba(240, 248, 253, 0.94); text-shadow: 0 1px 2px rgba(0, 0, 0, 0.95);
  font: 600 12px/1.2 "Segoe UI", system-ui, sans-serif; letter-spacing: 0.04em;
  opacity: 0; transition: opacity 160ms ease;
}
#dw-prompt.show { opacity: 0.95; }
#dw-prompt .ip-key {
  width: 24px; height: 24px; border-radius: 6px; display: grid; place-items: center;
  font-size: 11px; color: #cdefff;
  border: 1px solid rgba(174, 232, 255, 0.7); background: rgba(120, 190, 230, 0.12);
  box-shadow: inset 0 0 6px rgba(160, 225, 255, 0.18);
}
#dw-prompt .ip-sub { color: rgba(205, 228, 244, 0.7); font-weight: 500; margin-left: 2px; }
`;

let _cssDone = false;
function ensureCss() {
    if (_cssDone || typeof document === "undefined") return;
    _cssDone = true;
    const s = document.createElement("style");
    s.id = "dw-prompt-css";
    s.textContent = CSS;
    document.head.appendChild(s);
}

export class Interact {
    /** @param {any} ctx */
    constructor(ctx) {
        ensureCss();
        this.ctx = ctx;
        this.input = ctx.input || coreInput;
        if (ctx.caches) ctx.caches.readsInput = false;

        const el = document.createElement("div");
        el.id = "dw-prompt";
        el.innerHTML = '<span class="ip-key">E</span><span class="ip-name"></span>' +
            '<span class="ip-sub">rest · travel · boons</span>';
        document.body.appendChild(el);
        this.el = el;
        this._name = el.querySelector(".ip-name");
        this._show = false;
        this._shownId = "";
        /** Probe surface: what each press did. */
        this.stats = { presses: 0, typing: 0, cache: 0, shrine: 0, dialogue: 0, none: 0, blocked: 0, last: "" };
        ctx.interact = this;
    }

    /**
     * Route one E press. Exposed for probes and for any caller that owns its
     * own key (a gamepad layer).
     * @returns {"blocked"|"typing"|"cache"|"shrine"|"dialogue"|"none"}
     */
    press() {
        const ctx = this.ctx;
        this.stats.presses++;
        let r = "none";
        const dl = ctx.dialogue;
        const sm = ctx.shrineMenu;
        const C = ctx.caches;
        if (anyModalOpen() || this.input.panel) r = "blocked";
        else if (C && C.interactTarget >= 0 && C.tryInteract()) r = "cache";
        else if (sm && sm.reach && sm.open(sm.reach)) r = "shrine";
        else if (dl && dl.active) {
            const typing = dl.typing;
            if (dl.skip()) r = typing ? "typing" : "dialogue";
        }
        this.stats[r]++;
        this.stats.last = r;
        return r;
    }

    /** @param {number} dt */
    update(dt) {
        // Wiring (b) holds whatever the construction order was: the caches
        // must not ALSO read the edge (one press, one action).
        const C0 = this.ctx.caches;
        if (C0 && C0.readsInput) C0.readsInput = false;
        if (dt !== 0 && this.input.interactPressed) this.press();

        const sm = this.ctx.shrineMenu;
        const C = this.ctx.caches;
        const id = sm && !sm.isOpen && sm.reach && !(C && C.interactTarget >= 0) ? sm.reach : "";
        const show = id !== "" && hudShown(this.input, this.ctx.overlay) && !anyModalOpen();
        if (id !== this._shownId && id !== "") {
            this._shownId = id;
            const realm = this.ctx.getRealm ? this.ctx.getRealm() : "cold";
            const r = STORY.shrines && STORY.shrines[realm] ? STORY.shrines[realm][id] : null;
            this._name.textContent = r ? r.name : "Shrine";
        }
        if (show !== this._show) {
            this._show = show;
            this.el.classList.toggle("show", show);
        }
    }

    /** @param {string} token */
    setRealm(token) { this._shownId = ""; }

    dispose() {
        if (this.el.parentNode) this.el.parentNode.removeChild(this.el);
    }
}
