// core/hud/touch_controls.js — BLACKRIDGE on phones and tablets (2026-10-14).
//
// The game shipped desktop-only (mouse look through pointer lock, keyboard verbs).
// This module is the whole touch layer, and it drives the SAME input.state the
// keyboard and mouse write — the sim cannot tell a thumb from a key:
//
//   LEFT half   floating move stick: touch anywhere, drag. Analog moveX/moveZ;
//               pushed to the rim while going forward = sprint (no sprint button).
//   RIGHT half  drag to look. FIRE is a big button you can also DRAG on to aim
//               while shooting (the standard mobile-shooter grip).
//   buttons     AIM (toggle) · JUMP · CROUCH (toggle; while sprinting = slide)
//               · RELOAD · GRENADE (hold = cook, release = throw) · SWAP (next
//               weapon) · USE · SCORE (hold, matches) · PAUSE.
//   streaks     the killstreak tray tiles become buttons: tap a READY tile.
//               Sweep launches at once; mortar/airstrike/orbital enter the
//               designate mode (FIRE confirms on the preview ring, AIM cancels).
//
// Also: landscape prompt in portrait, fullscreen + landscape lock on the first
// touch (best effort — an iframe without allow=fullscreen just declines), and a
// body class (`br-touch`) the HUD stylesheets use to move the ammo / health
// blocks out from under the thumbs and hide the keyboard hints.

export function isTouchDevice() {
  try {
    const q = typeof location !== "undefined" ? location.search : "";
    if (/[?&]touch=0\b/.test(q)) return false;
    if (/[?&]touch=1\b/.test(q)) return true;
    // the page script (game_controls.js v3) publishes the authoritative device
    // signal before any game code runs — agree with it when present
    if (typeof window !== "undefined" && window.FFG_DEVICE && typeof window.FFG_DEVICE.touch === "boolean") {
      return window.FFG_DEVICE.touch;
    }
    // primary pointer is a finger (phones, tablets). A touch-screen laptop keeps a
    // fine primary pointer and stays on mouse + keyboard.
    const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
    const tp = typeof navigator !== "undefined" ? (navigator.maxTouchPoints | 0) : 0;
    return tp > 0 && coarse;
  } catch (e) { return false; }
}

const STYLE_ID = "br-touch-style";
const LOOK_MUL = 2.3;        // a thumb travels far fewer px than a mouse per turn
const STICK_R = 58;          // px of knob travel for a full push
const SPRINT_AT = 0.93;      // stick magnitude that turns into sprint (forward only)

function css() {
  return `
#tc-root{position:fixed;inset:0;z-index:35;pointer-events:none;display:none;touch-action:none;
  -webkit-user-select:none;user-select:none;-webkit-touch-callout:none;font-family:var(--a10-hud-font,'Oswald','Arial Narrow',system-ui,sans-serif);}
#tc-root.on{display:block;}
#tc-root .zone{position:absolute;top:0;bottom:0;pointer-events:auto;touch-action:none;}
#tc-move{left:0;width:44%;}
#tc-look{right:0;width:56%;}
#tc-stick{position:absolute;width:${STICK_R * 2 + 30}px;height:${STICK_R * 2 + 30}px;margin:${-(STICK_R + 15)}px 0 0 ${-(STICK_R + 15)}px;
  border-radius:50%;border:2px solid rgba(232,232,228,.22);background:rgba(8,12,18,.18);opacity:0;transition:opacity .12s;pointer-events:none;}
#tc-stick.on{opacity:1;}
#tc-knob{position:absolute;left:50%;top:50%;width:54px;height:54px;margin:-27px 0 0 -27px;border-radius:50%;
  background:rgba(232,232,228,.30);border:2px solid rgba(232,232,228,.5);}
#tc-stick.sprint #tc-knob{background:rgba(217,164,65,.55);border-color:#d9a441;}
.tc-btn{position:absolute;pointer-events:auto;touch-action:none;border-radius:50%;display:flex;align-items:center;justify-content:center;
  color:rgba(240,240,236,.92);font-size:11px;letter-spacing:.12em;background:rgba(8,12,18,.36);border:2px solid rgba(232,232,228,.30);
  box-shadow:0 2px 10px rgba(0,0,0,.35);}
.tc-btn.down{background:rgba(217,164,65,.42);border-color:#d9a441;}
.tc-btn.on{background:rgba(217,164,65,.30);border-color:#d9a441;}
.tc-btn svg{width:46%;height:46%;display:block;}
#tc-fire{width:92px;height:92px;right:calc(26px + env(safe-area-inset-right));bottom:calc(70px + env(safe-area-inset-bottom));border-width:3px;
  background:rgba(60,12,10,.45);border-color:rgba(255,90,70,.6);}
#tc-fire.down{background:rgba(255,59,48,.55);}
#tc-fire.designate{background:rgba(255,59,48,.65);border-color:#fff;animation:tcpulse .8s ease-in-out infinite;}
@keyframes tcpulse{50%{transform:scale(1.08);}}
#tc-ads{width:62px;height:62px;right:calc(132px + env(safe-area-inset-right));bottom:calc(118px + env(safe-area-inset-bottom));}
#tc-jump{width:58px;height:58px;right:calc(30px + env(safe-area-inset-right));bottom:calc(178px + env(safe-area-inset-bottom));}
#tc-crouch{width:58px;height:58px;right:calc(130px + env(safe-area-inset-right));bottom:calc(36px + env(safe-area-inset-bottom));}
#tc-reload{width:50px;height:50px;right:calc(104px + env(safe-area-inset-right));bottom:calc(194px + env(safe-area-inset-bottom));}
#tc-nade{width:50px;height:50px;right:calc(200px + env(safe-area-inset-right));bottom:calc(70px + env(safe-area-inset-bottom));}
#tc-swap{width:50px;height:50px;right:calc(200px + env(safe-area-inset-right));bottom:calc(140px + env(safe-area-inset-bottom));}
#tc-use{width:46px;height:46px;right:calc(204px + env(safe-area-inset-right));bottom:calc(210px + env(safe-area-inset-bottom));font-size:10px;}
#tc-pause{width:40px;height:40px;left:calc(12px + env(safe-area-inset-left));top:calc(12px + env(safe-area-inset-top));border-radius:8px;}
#tc-score{width:40px;height:40px;left:calc(60px + env(safe-area-inset-left));top:calc(12px + env(safe-area-inset-top));border-radius:8px;font-size:9px;}
#tc-score.hide{display:none;}
#tc-rotate{position:fixed;inset:0;z-index:300;display:none;align-items:center;justify-content:center;flex-direction:column;gap:14px;
  background:#05070b;color:#e8e8e4;font:15px/1.4 'Oswald','Arial Narrow',system-ui,sans-serif;letter-spacing:.18em;text-align:center;pointer-events:auto;}
#tc-rotate.on{display:flex;}
#tc-rotate svg{width:74px;height:74px;animation:tcrot 2.2s ease-in-out infinite;}
@keyframes tcrot{0%,20%{transform:rotate(0)}50%,70%{transform:rotate(-90deg)}100%{transform:rotate(0)}}

/* ---- HUD re-layout while touch controls are up: nothing important under a thumb */
body.br-touch #hint{display:none !important;}
body.br-touch #ammo{right:auto;left:50%;bottom:10px;transform:translateX(-50%) scale(.78);transform-origin:50% 100%;text-align:center;}
body.br-touch #a10-health{right:auto;left:50%;bottom:74px;transform:translateX(-50%) scale(.8);}
body.br-touch #a10-subtitle{left:50%;bottom:auto;top:118px;transform:translateX(-50%);text-align:center;}
body.br-touch #objective{left:calc(12px + env(safe-area-inset-left));bottom:auto;top:62px;transform:scale(.85);transform-origin:0 0;}
body.br-touch #a10-banner{left:calc(12px + env(safe-area-inset-left));bottom:auto;top:96px;}
body.br-touch #killfeed,body.br-touch #mh-feed{top:56px;transform:scale(.82);transform-origin:100% 0;}
body.br-touch #ld-bar{display:none;}
body.br-touch #ld-streaks{left:calc(108px + env(safe-area-inset-left));top:calc(12px + env(safe-area-inset-top));bottom:auto;transform:scale(.82);
  transform-origin:0 0;flex-direction:column;align-items:flex-start;gap:5px;}
body.br-touch #ld-streaks .ld-st{pointer-events:auto;touch-action:none;}
body.br-touch #ld-streaks .ld-st:not(.ready){display:none;}
body.br-touch #ld-call{top:104px;font-size:12px;}
body.br-touch #ld-recon .bar{top:150px;}
`;
}

const ICON = {
  fire: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2v6M12 16v6M2 12h6M16 12h6" stroke="currentColor" stroke-width="2"/></svg>`,
  ads: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 3v18M3 12h18" stroke="currentColor" stroke-width="1.2"/><circle cx="12" cy="12" r="2" fill="currentColor"/></svg>`,
  jump: `<svg viewBox="0 0 24 24"><path d="M5 15l7-7 7 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round"/></svg>`,
  crouch: `<svg viewBox="0 0 24 24"><path d="M5 9l7 7 7-7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round"/></svg>`,
  reload: `<svg viewBox="0 0 24 24"><path d="M19 12a7 7 0 1 1-2.05-4.95" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M19 4v4h-4" fill="none" stroke="currentColor" stroke-width="2.2"/></svg>`,
  nade: `<svg viewBox="0 0 24 24"><ellipse cx="12" cy="14" rx="6" ry="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M10 6h4v2h-4zM14 6l3-2" stroke="currentColor" stroke-width="1.8" fill="none"/></svg>`,
  swap: `<svg viewBox="0 0 24 24"><path d="M4 8h14l-3-3M20 16H6l3 3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/></svg>`,
  pause: `<svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14" stroke="currentColor" stroke-width="3"/></svg>`,
  rotate: `<svg viewBox="0 0 64 64"><rect x="20" y="8" width="24" height="44" rx="4" fill="none" stroke="#d9a441" stroke-width="3"/><circle cx="32" cy="46" r="2" fill="#d9a441"/></svg>`,
};

export function createTouchControls(ctx) {
  const input = ctx.input;
  if (!document.getElementById(STYLE_ID)) {
    const st = document.createElement("style");
    st.id = STYLE_ID; st.textContent = css();
    document.head.appendChild(st);
  }
  document.body.classList.add("br-touch");

  const root = document.createElement("div");
  root.id = "tc-root";
  const mk = (tag, id, cls, html) => { const e = document.createElement(tag); if (id) e.id = id; if (cls) e.className = cls; if (html) e.innerHTML = html; root.appendChild(e); return e; };
  const moveZone = mk("div", "tc-move", "zone");
  const lookZone = mk("div", "tc-look", "zone");
  const stick = mk("div", "tc-stick", null, `<div id="tc-knob"></div>`);
  const knob = stick.firstChild;
  const B = {
    fire: mk("div", "tc-fire", "tc-btn", ICON.fire),
    ads: mk("div", "tc-ads", "tc-btn", ICON.ads),
    jump: mk("div", "tc-jump", "tc-btn", ICON.jump),
    crouch: mk("div", "tc-crouch", "tc-btn", ICON.crouch),
    reload: mk("div", "tc-reload", "tc-btn", ICON.reload),
    nade: mk("div", "tc-nade", "tc-btn", ICON.nade),
    swap: mk("div", "tc-swap", "tc-btn", ICON.swap),
    use: mk("div", "tc-use", "tc-btn", "USE"),
    pause: mk("div", "tc-pause", "tc-btn", ICON.pause),
    score: mk("div", "tc-score", "tc-btn", "SCORE"),
  };
  document.body.appendChild(root);
  const rotate = document.createElement("div");
  rotate.id = "tc-rotate";
  rotate.innerHTML = `${ICON.rotate}<div>ROTATE YOUR DEVICE<br><small style="opacity:.7;letter-spacing:.12em">BLACKRIDGE PLAYS IN LANDSCAPE</small></div>`;
  document.body.appendChild(rotate);

  const key = (code, type) => window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
  let wentFull = false;
  function goFullscreen() {
    if (wentFull) return;
    wentFull = true;
    try {
      const el = document.documentElement;
      const p = el.requestFullscreen ? el.requestFullscreen({ navigationUI: "hide" }) : (el.webkitRequestFullscreen && el.webkitRequestFullscreen());
      const lock = () => { try { const o = screen.orientation; if (o && o.lock) o.lock("landscape").catch(() => {}); } catch (e) { /* not supported */ } };
      if (p && typeof p.then === "function") p.then(lock, () => {}); else lock();
    } catch (e) { /* iframe without allow=fullscreen, iOS Safari: play windowed */ }
  }

  // ---- move stick (one pointer) -------------------------------------------
  let mv = null; // {id, x0, y0}
  function setStick(dx, dy) {
    const m = Math.hypot(dx, dy);
    const k = m > STICK_R ? STICK_R / m : 1;
    const nx = (dx * k) / STICK_R, ny = (dy * k) / STICK_R;
    knob.style.transform = `translate(${(dx * k).toFixed(1)}px,${(dy * k).toFixed(1)}px)`;
    // small dead zone, then analog
    const mag = Math.min(1, m / STICK_R);
    const dz = mag < 0.12 ? 0 : 1;
    input.state.moveX = nx * dz;
    input.state.moveZ = -ny * dz;
    const sprint = mag >= SPRINT_AT && -ny > 0.72;
    input.state.sprint = sprint;
    stick.classList.toggle("sprint", sprint);
  }
  moveZone.addEventListener("pointerdown", (e) => {
    goFullscreen();
    if (mv) return;
    mv = { id: e.pointerId, x0: e.clientX, y0: e.clientY };
    try { moveZone.setPointerCapture(e.pointerId); } catch (er) { /* synthetic */ }
    stick.style.left = e.clientX + "px"; stick.style.top = e.clientY + "px";
    stick.classList.add("on");
    setStick(0, 0);
    e.preventDefault();
  });
  moveZone.addEventListener("pointermove", (e) => {
    if (!mv || e.pointerId !== mv.id) return;
    setStick(e.clientX - mv.x0, e.clientY - mv.y0);
  });
  const endMove = (e) => {
    if (!mv || (e && e.pointerId !== mv.id)) return;
    mv = null;
    stick.classList.remove("on", "sprint");
    knob.style.transform = "";
    input.state.moveX = 0; input.state.moveZ = 0; input.state.sprint = false;
  };
  moveZone.addEventListener("pointerup", endMove);
  moveZone.addEventListener("pointercancel", endMove);

  // ---- look (any number of right-side pointers; each drags the view) -------
  const looks = new Map(); // pointerId -> {x, y}
  function lookStart(e, el) {
    looks.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { el.setPointerCapture(e.pointerId); } catch (er) { /* synthetic */ }
  }
  function lookMove(e) {
    const l = looks.get(e.pointerId);
    if (!l) return;
    const dx = e.clientX - l.x, dy = e.clientY - l.y;
    l.x = e.clientX; l.y = e.clientY;
    if (!input.enabled) return;
    const s = (input._lookScale ? input._lookScale() : 0.0022) * LOOK_MUL;
    input.addLook(-dx * s, -dy * s);
  }
  const lookEnd = (e) => { looks.delete(e.pointerId); };
  lookZone.addEventListener("pointerdown", (e) => { goFullscreen(); lookStart(e, lookZone); e.preventDefault(); });
  lookZone.addEventListener("pointermove", lookMove);
  lookZone.addEventListener("pointerup", lookEnd);
  lookZone.addEventListener("pointercancel", lookEnd);

  // ---- buttons ----------------------------------------------------------------
  function hold(el, down, up, opts = {}) {
    el.addEventListener("pointerdown", (e) => {
      goFullscreen();
      e.preventDefault(); e.stopPropagation();
      el.classList.add("down");
      if (opts.look) lookStart(e, el);
      down(e);
    });
    if (opts.look) el.addEventListener("pointermove", lookMove);
    const fin = (e) => { el.classList.remove("down"); if (opts.look) lookEnd(e); if (up) up(e); };
    el.addEventListener("pointerup", fin);
    el.addEventListener("pointercancel", fin);
  }
  // FIRE: also a look surface; in designate mode it confirms the call-in instead
  hold(B.fire, () => {
    if (input.designate) { input.confirmDesignate(); return; }
    input.touchPress("fire");
  }, () => input.touchRelease("fire"), { look: true });
  hold(B.ads, () => {
    if (input.designate) { input.cancelDesignate(); return; }
    input.state.ads = !input.state.ads;
  });
  hold(B.jump, () => input.touchPress("jump"), () => input.touchRelease("jump"));
  hold(B.crouch, () => { input.state.crouch = !input.state.crouch; });
  hold(B.reload, () => input.touchPress("reload"), () => input.touchRelease("reload"));
  hold(B.nade, () => input.touchPress("grenade"), () => input.touchRelease("grenade"));
  hold(B.swap, () => { input.state.switchTo = "next"; });
  hold(B.use, () => input.touchPress("interact"), () => input.touchRelease("interact"));
  hold(B.pause, () => { key("Escape", "keydown"); key("Escape", "keyup"); });
  hold(B.score, () => key("Tab", "keydown"), () => key("Tab", "keyup"));

  // killstreak tray tiles (loadout_hud) become buttons: index -> tier
  document.addEventListener("pointerdown", (e) => {
    const tile = e.target && e.target.closest && e.target.closest("#ld-streaks .ld-st");
    if (!tile || !root.classList.contains("on")) return;
    const tiles = [...document.querySelectorAll("#ld-streaks .ld-st")];
    const tier = tiles.indexOf(tile) + 1;
    if (tier <= 0) return;
    e.preventDefault(); e.stopPropagation();
    if (tier === 1) input.state.streak = 1;
    else input.designateTier(tier);
  }, true);

  function releaseAll() {
    endMove(null);
    mv = null;
    looks.clear();
    for (const k of Object.keys(B)) B[k].classList.remove("down");
    input.touchRelease("fire"); input.touchRelease("jump"); input.touchRelease("reload");
    input.touchRelease("grenade"); input.touchRelease("interact");
    input.state.moveX = 0; input.state.moveZ = 0; input.state.sprint = false;
  }

  let wasOn = false, wasPortrait = false;
  return {
    update() {
      const s = ctx.sim && ctx.sim();
      const portrait = window.innerHeight > window.innerWidth;
      const live = !!(s && input.enabled && s.state.phase !== "menu" && s.state.player && s.state.player.alive);
      rotate.classList.toggle("on", portrait && !!(s && s.state.phase !== "menu"));
      // turning the phone to portrait mid-fight pauses it (the prompt covers the
      // screen; nobody should die behind it) — once, on the transition
      if (portrait && !wasPortrait && live) { key("Escape", "keydown"); key("Escape", "keyup"); }
      wasPortrait = portrait;
      const on = live && !portrait;
      if (on !== wasOn) {
        root.classList.toggle("on", on);
        if (!on) releaseAll();
        wasOn = on;
      }
      if (!on) return;
      B.ads.classList.toggle("on", !!input.state.ads);
      B.crouch.classList.toggle("on", !!input.state.crouch);
      B.fire.classList.toggle("designate", !!input.designate);
      B.score.classList.toggle("hide", !s.match);
      // an emptied stick must not leave the player creeping
      if (!mv && (input.state.moveX || input.state.moveZ) && !input._keysHeld()) { input.state.moveX = 0; input.state.moveZ = 0; }
    },
    root,
  };
}
