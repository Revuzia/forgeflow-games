// core/hud/pause.js [A10] — ESC overlay: Resume / Settings / confirm-Abandon.
// Shell contract (architecture §3.17 + doctrine §6):
//  - ESC NEVER destroys the mission; abandon routes through cb.onAbandon()
//    → mission.forfeit(sim) — the REAL loss path (debrief arrives via the
//    mission:end event; hud.js closes this overlay through closeSilent()).
//  - boot wires window.__PAUSE__ = {pause, resume, toggle} to this object and
//    gates the sim accumulator on `active`; cb.onResume() discards the
//    accumulator (resume must not fast-forward — doctrine §5).
//  - ESC handling LIVES HERE (A0 wave-1 note: boot does not wire ESC).
//    Handler discipline across the lane (registration order = boot creation
//    order: pause → menu → settingsUI):
//      pause acts only while a mission is LIVE; menu acts only while it is
//      NOT; both skip when the settings overlay is visible (settings' own
//      handler, registered last, consumes that press). One press = one action.
//  - Pointer-lock exit (browser-forced ESC while locked never reaches
//    keydown) auto-pauses via the pointerlockchange transition — gameplay
//    only: the harness never pointer-locks, so probes are unaffected.
//  - pause() gates the sim even at the title screen (portal __PAUSE__ button)
//    but shows the OVERLAY only while a mission is live (S6 scenario state:
//    "pause overlay legible over the blurred live plaza frame").
//
// Frozen signature: createPause(ctx, cb) → {pause, resume, toggle, get active}
// (+ private closeSilent, used by hud.js on mission:end / mission:start).

import { shell, isMissionLive, ensureShellStyle } from "./hud.js";

export function createPause(ctx, cb) {
  ensureShellStyle();

  let active = false;
  let confirmOpen = false;
  let wasLocked = false;

  // ------------------------------------------------------------------ DOM
  // id "pause-overlay" is in A11's HUD_DOM sweep list (testsurface.js) so
  // __test.hud(false) beauty shots can hide it along with the HUD.
  const root = document.createElement("div");
  root.id = "pause-overlay";
  root.className = "a10-overlay";
  root.style.display = "none";
  root.style.zIndex = "40"; // above #hud (30): the wash blurs the live frame + HUD beneath

  const wash = document.createElement("div");
  wash.className = "wash";
  root.appendChild(wash);

  const rail = document.createElement("div");
  rail.className = "a10-rail";
  const fiction = (ctx.content && ctx.content.mission && ctx.content.mission.fiction) || {};
  const opName = "OPERATION " + (fiction.operation || "BLACKRIDGE");
  rail.innerHTML =
    `<div class="tag">${opName} — mission paused</div>` +
    `<div class="wm">PAUSED</div>` +
    `<div class="nav">` +
    `<button class="a10-item" data-a="resume">Resume</button>` +
    `<button class="a10-item" data-a="settings">Settings</button>` +
    `<button class="a10-item danger" data-a="abandon">Abandon mission</button>` +
    `</div>` +
    `<div class="confirm" style="display:none">` +
    `<div style="font-size:12.5px;letter-spacing:.08em;line-height:1.7;` +
    `color:rgba(232,232,228,.72);max-width:340px;margin-bottom:14px">` +
    `Abandon the mission? This counts as a loss — progress since the last ` +
    `checkpoint is gone.</div>` +
    `<button class="a10-item danger" data-a="confirm">Confirm abandon</button>` +
    `<button class="a10-item" data-a="cancel">Cancel</button>` +
    `</div>`;
  root.appendChild(rail);
  const navEl = rail.querySelector(".nav");
  const confirmEl = rail.querySelector(".confirm");

  // ---------------------------------------------------- SELECTED ROW (iter07)
  // visual_target.md §6 contracts "left-rail vertical nav in caps with amber
  // active tick", and the same deduction has been taken in iter04, iter05 and
  // iter06 — 3/3 critics in the last round. The tick artwork already existed
  // (.a10-item::before, an amber 2 px bar) but nothing ever carried `.on`,
  // because the menu was mouse-only: no row was ever SELECTED, only hovered,
  // and a hover state cannot appear in a screenshot. The fix is the missing
  // half of the menu, not a decoration — a keyboard-navigable rail with a real
  // selection, which is also what a console shooter's pause menu is.
  const rowsOf = (el) => Array.from(el.querySelectorAll(".a10-item"));
  let sel = 0;
  function paintSel() {
    const rows = rowsOf(confirmOpen ? confirmEl : navEl);
    if (!rows.length) return;
    sel = Math.max(0, Math.min(rows.length - 1, sel));
    rows.forEach((el, i) => el.classList.toggle("on", i === sel));
    // the group that is NOT showing must not keep a stale tick
    rowsOf(confirmOpen ? navEl : confirmEl).forEach((el) => el.classList.remove("on"));
  }
  function moveSel(d) {
    const rows = rowsOf(confirmOpen ? confirmEl : navEl);
    if (!rows.length) return;
    sel = (sel + d + rows.length) % rows.length;
    paintSel();
  }
  // hover and keyboard drive the SAME selection — a mouse user never sees the
  // tick disagree with the pointer.
  rail.addEventListener("mousemove", (e) => {
    const item = e.target && e.target.closest && e.target.closest(".a10-item");
    if (!item) return;
    const rows = rowsOf(confirmOpen ? confirmEl : navEl);
    const i = rows.indexOf(item);
    if (i >= 0 && i !== sel) { sel = i; paintSel(); }
  });

  const vmark = document.createElement("div");
  vmark.className = "a10-vmark";
  vmark.textContent = `BLACKRIDGE ${ctx.version || ""}`;
  root.appendChild(vmark);

  document.body.appendChild(root);

  // ------------------------------------------------------------------ helpers
  function setConfirm(on) {
    confirmOpen = !!on;
    navEl.style.display = on ? "none" : "block";
    confirmEl.style.display = on ? "block" : "none";
    sel = 0;              // a group change always lands on its first row
    paintSel();
  }

  function overlayAllowed() {
    return isMissionLive(ctx) && !(shell.hud && shell.hud.debriefOpen);
  }

  function relock() {
    // Guarded re-lock: browsers may refuse (e.g. Chrome's post-ESC cooldown)
    // and newer Chrome returns a promise whose rejection would land in
    // window.__BOOT_ERRORS__ and fail bootcheck — swallow both shapes. The
    // player's next canvas click re-locks anyway (input.js mousedown path).
    try {
      const r = ctx.canvas && ctx.canvas.requestPointerLock && ctx.canvas.requestPointerLock();
      if (r && typeof r.catch === "function") r.catch(() => {});
    } catch (e) { /* refused — click-to-relock covers it */ }
  }

  // ------------------------------------------------------------------ api
  const pauseCtl = {
    pause() {
      if (active) return;
      active = true;
      setConfirm(false);
      ctx.input.enabled = false; // hotkey/fire gate while the overlay is up
      ctx.input.unlock();
      sel = 0; paintSel();       // RESUME is the selected row on every open
      if (overlayAllowed()) root.style.display = "block";
    },

    resume() {
      if (!active) return;
      active = false;
      setConfirm(false);
      root.style.display = "none";
      if (shell.settingsUI && shell.settingsUI.visible) shell.settingsUI.hide();
      if (cb && cb.onResume) cb.onResume(); // boot discards the accumulator
      if (overlayAllowed()) {
        ctx.input.enabled = true;
        relock();
      }
    },

    toggle() { active ? pauseCtl.resume() : pauseCtl.pause(); },

    get active() { return active; },

    // Close without the resume side effects (input stays gated) — used by
    // hud.js when the debrief takes over (mission:end) and on mission:start
    // so a stale pause can never freeze a fresh mission.
    closeSilent() {
      setConfirm(false);
      root.style.display = "none";
      if (shell.settingsUI && shell.settingsUI.visible) shell.settingsUI.hide();
      if (!active) return;
      active = false;
      if (cb && cb.onResume) cb.onResume(); // discard accumulator only
    },
  };

  // ------------------------------------------------------------------ input
  // Arrow / WS move the selection, Enter or Space activates it. Registered
  // before the ESC handler below and gated the same way, so it can never fire
  // while the settings overlay or the debrief owns the keyboard.
  window.addEventListener("keydown", (e) => {
    if (!active || !overlayAllowed()) return;
    if (shell.settingsUI && shell.settingsUI.visible) return;
    const c = e.code;
    if (c === "ArrowDown" || c === "KeyS") { moveSel(1); e.preventDefault(); return; }
    if (c === "ArrowUp" || c === "KeyW") { moveSel(-1); e.preventDefault(); return; }
    if (c === "Enter" || c === "NumpadEnter" || c === "Space") {
      const rows = rowsOf(confirmOpen ? confirmEl : navEl);
      if (rows[sel]) { rows[sel].click(); e.preventDefault(); }
    }
  });

  rail.addEventListener("click", (e) => {
    const a = e.target && e.target.getAttribute && e.target.getAttribute("data-a");
    if (!a) return;
    if (a === "resume") pauseCtl.resume();
    else if (a === "settings") { if (shell.settingsUI) shell.settingsUI.show(); }
    else if (a === "abandon") setConfirm(true);
    else if (a === "cancel") setConfirm(false);
    else if (a === "confirm") {
      setConfirm(false);
      // Real loss path: forfeit emits mission:end; hud shows the debrief and
      // closes this overlay via closeSilent on the next dispatched frame.
      if (cb && cb.onAbandon) cb.onAbandon();
    }
  });

  window.addEventListener("keydown", (e) => {
    if (e.code !== "Escape") return;
    if (!isMissionLive(ctx)) return;                              // menu owns ESC there
    if (shell.hud && shell.hud.debriefOpen) return;               // debrief is click-only
    if (shell.settingsUI && shell.settingsUI.visible) return;     // settings' handler consumes
    if (!active) pauseCtl.pause();
    else if (confirmOpen) setConfirm(false);
    else pauseCtl.resume();
  });

  document.addEventListener("pointerlockchange", () => {
    const locked = document.pointerLockElement === ctx.canvas;
    const lost = wasLocked && !locked;
    wasLocked = locked;
    // Browser-forced unlock mid-mission (ESC while locked, or OS steal) =
    // auto-pause. Transition-gated: never fires for the never-locking harness.
    if (lost && !active && isMissionLive(ctx) && ctx.input.enabled &&
        !(shell.hud && shell.hud.debriefOpen)) {
      pauseCtl.pause();
    }
  });

  shell.pause = pauseCtl;
  return pauseCtl;
}
