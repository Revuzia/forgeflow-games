// HUD binding: the DOM side of the game core. It builds the HUD, the squishy's keyboard target, the settings panel, the live region,
// the reveal plate and the toast, and maps the game's events onto them (and the DOM's clicks onto the game). Nothing here simulates or
// decides: it only shows what game.ts reports. SHELL-2b adds the Hoard here: hud.slot is the bottom-centre slot for its button, and
// game.hoard / game.focusInstance / game.restorePrimary / game.playMerge / game.holdInput are its seams.
import type { TierName } from '../contracts.ts';
import type { SettingsEnv } from '../core/settings.ts';
import { createAnnouncer } from '../ui/announcer.ts';
import type { Announcer } from '../ui/announcer.ts';
import { h, isCoarsePointer, prefersReducedMotion } from '../ui/dom.ts';
import { createSparks } from '../ui/sparks.ts';
import { createToyTray } from '../ui/toyTray.ts';
import type { ToolId, ToyTray } from '../ui/toyTray.ts';
import { createCutBar } from '../ui/cutBar.ts';
import { createSnapBar, paintTint } from '../ui/snapBar.ts';
import type { Sparks } from '../ui/sparks.ts';
import { tierLabel } from '../ui/gem.ts';
import { createHud } from '../ui/hud.ts';
import type { Hud } from '../ui/hud.ts';
import { createPlayTarget } from '../ui/playTarget.ts';
import type { PlayTarget } from '../ui/playTarget.ts';
import { PLATE_MS, createRevealPlate, plateText } from '../ui/revealPlate.ts';
import type { RevealPlate } from '../ui/revealPlate.ts';
import { createSettingsPanel } from '../ui/settingsPanel.ts';
import type { SettingsPanel } from '../ui/settingsPanel.ts';
import { createHoard } from '../ui/hoard/panel.ts';
import type { HoardUi } from '../ui/hoard/panel.ts';
import { QUICK_MAX, createQuickSwitch } from '../ui/quickSwitch.ts';
import type { SwitchChoice } from '../ui/quickSwitch.ts';
import { warmSpeciesIcons } from '../ui/speciesIcon.ts';
import type { Game, PlayLabel } from './game.ts';
import { createHoardEnv } from './hoardEnv.ts';
import '../ui/hoard.css';
import { COPY } from '../collection/copy.ts';

export interface UiBinding {
  readonly hud: Hud;
  readonly panel: SettingsPanel;
  readonly play: PlayTarget;
  readonly plate: RevealPlate;
  readonly announcer: Announcer;
  /** SHELL-2b: the Hoard (shelf, card, gift, today, merge pad, Tidy-up) */
  readonly hoard: HoardUi;
  /** visible XP: the gain sparks (none under Calm effects or reduced motion: the ring glows instead) */
  readonly sparks: Sparks;
  /** the toy tray (FUN.md 1) */
  readonly toys: ToyTray;
  toast(text: string, ms?: number): void;
  /** Escape outside a ceremony: close what is open (settings, the plate); true = something closed */
  escape(): boolean;
  /** a key reached the toy: the Keys line and the keyboard hint wording */
  keyUsed(): void;
  /** [ / ]: switch to the oldest / the newest squishy of the quick switcher */
  switchBy(dir: -1 | 1): void;
  destroy(): void;
}

export const labelText = (l: PlayLabel): string => `${l.species}, ${tierLabel(l.tier)}${l.nickname ? `, called ${l.nickname}` : ''}`;

export function bindUi(root: HTMLElement, canvas: HTMLCanvasElement, g: Game, env: SettingsEnv, o: { onPlay(): void }): UiBinding {
  const off: Array<() => void> = [];
  let hoardUi: HoardUi | null = null;
  const announcer = createAnnouncer(root);
  let panel: SettingsPanel | null = null;
  const hud = createHud(root, {
    label: g.label, muted: g.muted,
    onGear: () => { if (hoardUi?.isOpen) hoardUi.close(); panel?.toggle(); },
    onMute: () => g.toggleMute(),
    onOpenCapsule: () => { g.unlockAudio(); void g.capsules.openNext(); },
  });
  const play = createPlayTarget(root);
  const setPlayLabel = (l: PlayLabel): void => {
    play.setLabel(`Squishy: ${labelText(l)}`);
    canvas.setAttribute('aria-label', `Your squishy, ${labelText(l)}: a soft translucent toy on a felt mat.`);
  };
  setPlayLabel(g.label);
  const plate = createRevealPlate(root);
  panel = createSettingsPanel(root, {
    settings: g.settings,
    hapticsSupported: env.vibrate,
    onChange: (k, v) => g.setSetting(k, v),
    onOpenChange: (open) => { hud.setGearOpen(open); document.body.dataset.settings = open ? 'open' : 'closed'; },
    returnFocusTo: hud.gear,
    escapeFocusTo: () => (g.phase === 'play' ? play.el : null),
  });
  const p: SettingsPanel = panel;

  // ---- the Hoard (SHELL-2b): its HUD button and the play mat's "put back" chip live in the HUD's bottom-centre slot
  const hoard: HoardUi = createHoard(root, createHoardEnv(g, {
    announce: (t) => announcer.say(t),
    toast: (t) => toast(t),
    returnFocus: () => (g.phase === 'play' ? play.el : null),
  }));
  hoardUi = hoard;
  // ---- the toy tray (FUN.md 1): the Toys button sits beside the Hoard button; the Cut tool shows only when the physics can cut
  const toys = createToyTray(root, { onPick: (t) => g.setTool(t) });
  hud.slot.append(hoard.button, toys.button, hoard.matChip);
  const toolsNow = (): ToolId[] => (g.cut.supported ? ['hand', 'cut', 'snap'] : ['hand', 'snap']);
  toys.setAvailable(toolsNow());
  hoard.button.addEventListener('click', () => { if (p.isOpen()) p.close('escape'); }, { capture: true });
  off.push(warmSpeciesIcons());

  // ---- the quick switcher (SHELL-2b): the squishies played lately, then the hearted ones, one tap to play with
  const pick = (id: string): void => {
    const r = g.switchTo(id);
    if (r === 'queued') announcer.say('Switching when this is done.');
    else if (r !== 'done') toast('That one could not come out. Try another.');
  };
  const qs = createQuickSwitch(hud.el, pick);
  const choices = (): SwitchChoice[] => {
    const cur = g.identity.itemId;
    const out: SwitchChoice[] = [];
    const add = (id: string): void => {
      if (id === cur || out.some((c) => c.id === id)) return;
      const it = g.hoard.item(id);
      if (it) out.push({ id: it.id, species: it.species, name: it.name, tier: it.tier as TierName });
    };
    for (const id of g.history.recent()) add(id);
    for (const it of g.hoard.items()) if (it.fav) add(it.id);
    return out;
  };
  // the HUD rows the 3D capsule must not land under (render lane's optional setSafeInsets): the top bar and the bottom row (the quick
  // switcher above the name tag covers only the left edge; counting it would leave the capsule too little room); on change only
  let insetKey = '';
  const reportInsets = (): void => {
    const st = g.stage;
    if (typeof st.setSafeInsets !== 'function') return;
    const ih = window.innerHeight;
    if (!(ih > 0)) return;
    const topBar = hud.el.querySelector<HTMLElement>('.hud-top')?.getBoundingClientRect();
    let bottomTop = ih;
    for (const e of [hud.el.querySelector<HTMLElement>('.hud-bottom')]) {
      if (!e || e.hidden) continue;
      const r = e.getBoundingClientRect();
      if (r.height > 0) bottomTop = Math.min(bottomTop, r.top);
    }
    const top = topBar && topBar.height > 0 ? Math.round(topBar.bottom) : 0;
    const bottom = Math.round(Math.max(0, ih - bottomTop));
    const k = `${top},${bottom}`;
    if (k === insetKey) return;
    insetKey = k;
    try { st.setSafeInsets({ top, bottom }); } catch (e) { console.error(e); }
  };
  const refreshSwitch = (): void => { qs.set(choices()); reportInsets(); };
  refreshSwitch();
  window.addEventListener('resize', reportInsets);
  off.push(() => window.removeEventListener('resize', reportInsets));
  off.push(g.on('identity', () => refreshSwitch()), g.hoard.onChange(() => refreshSwitch()), () => qs.destroy());

  // ---- offline (COLLECTION 9.9, signed in): a quiet banner while the connection is gone, the ring keeps previewing; "Reconnected" once
  const netBanner = h('p', { class: 'net-banner', text: COPY.offline, attrs: { hidden: '', 'aria-hidden': 'true' } });   // the live region says it
  root.append(netBanner);
  let offline = false;
  const netState = (gone: boolean): void => {
    if (gone === offline) return;
    offline = gone;
    netBanner.hidden = !gone;
    document.body.dataset.offline = String(gone);
    announcer.say(gone ? COPY.offline : COPY.reconnected);
  };
  off.push(() => netBanner.remove());

  let toastEl: HTMLElement | null = null;
  let toastTimer = 0;
  const toast = (text: string, ms = 3200): void => {
    toastEl?.remove();
    toastEl = h('div', { class: 'toast', text, attrs: { 'aria-hidden': 'true' } });   // the live region says it; the toast only shows it
    root.append(toastEl);
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => { toastEl?.remove(); toastEl = null; }, ms);
  };

  // ---- game -> UI
  let gravityWas = g.settings.gravity;
  let plateAt = 0;
  const applyCalm = (calm: boolean): void => { document.body.dataset.calm = String(calm); };
  applyCalm(g.settings.calm);
  off.push(
    g.on('settings', (s) => {
      p.sync(s);
      applyCalm(s.calm);
      if (s.gravity !== gravityWas) { gravityWas = s.gravity; announcer.say(s.gravity ? 'On the table' : 'Floating'); }
    }),
    g.on('mute', (m) => { hud.setMuted(m); announcer.say(m ? 'Sound off' : 'Sound on'); }),
    g.on('identity', (_id, l) => { hud.setLabel(l); setPlayLabel(l); if (!g.ceremonies.active) announcer.say(`Your squishy: ${labelText(l)}`); }),
    g.on('interaction', () => { hud.interact(); if (plate.shown && !g.ceremonies.active) plate.hide(); }),
    g.on('meter', (m) => { hud.meter.set(m); netState(m.offline); }),
    g.on('capsuleReady', (n) => { hud.meter.pulse(g.settings.calm); announcer.say(n > 1 ? `A capsule is ready. ${n} waiting.` : 'A capsule is ready.'); }),
    g.on('message', (t) => { toast(t); announcer.say(t); }),
    g.on('notice', (t) => { announcer.say(t); }),
    g.on('ceremony', (e) => {
      if (e.type === 'start') { hud.meter.setBusy(true); plate.hide(); document.body.dataset.ceremony = e.kind; return; }
      const i = e.info;
      const info = { species: i.speciesName, tier: i.item.tier as TierName, isNew: i.item.isNew, copies: i.item.copies, tierUp: i.tierUp, nickname: i.item.nickname };
      if (e.type === 'reveal') { plate.show(info); plateAt = g.clock.now(); announcer.say(plateText(info)); return; }
      hud.meter.setBusy(false);
      delete document.body.dataset.ceremony;
    }),
    // the plate leaves PLATE_MS of game time after the reveal (the gesture clock: frozen while paused, stepped by DebugHook.step)
    g.onStep(() => { if (plate.shown && !g.ceremonies.active && g.clock.now() - plateAt >= PLATE_MS) plate.hide(); }),
    g.on('phase', (ph) => {
      document.body.dataset.phase = ph;
      if (ph === 'play') { hud.setActive(true); o.onPlay(); requestAnimationFrame(reportInsets); }
    }),
  );
  hud.meter.set(g.capsules.reading);

  // ---- visible XP (FUN.md 2): sparks from the touch to the ring (or a soft glow under Calm effects), and the pending arc of a hold
  const sparks = createSparks(root);
  let gainedAt = -1;          // the step a touch last paid (the release of a held touch banks its arc)
  let steps = 0;
  let pendShown = 0, bankWait = 0;
  const BANK_WAIT_STEPS = 8;  // a held touch's release event may come a few steps after the finger lifts
  off.push(
    g.on('gain', (e) => {
      gainedAt = steps;
      const calm = g.settings.calm || prefersReducedMotion();
      const r = hud.meter.ring.getBoundingClientRect();
      if (calm || e.x === null || e.y === null || !r.width) { hud.meter.glow(true); return; }
      const c = canvas.getBoundingClientRect();
      const n = Math.min(6, Math.max(3, Math.round(2.5 + e.sp * 1.2)));   // a poke 3, a squeeze or a stretch 4 to 6
      const ms = sparks.burst(c.left + e.x, c.top + e.y, r.left + r.width / 2, r.top + r.height / 2, n);
      if (ms > 0) { hud.meter.hold(ms); window.setTimeout(() => hud.meter.glow(false), ms); } else hud.meter.glow(true);
    }),
    g.onStep(() => {
      steps++;
      const p = g.pendingFill();
      if (p > 0) {
        bankWait = 0;
        if (pendShown === 0 || Math.abs(p - pendShown) >= 0.002) { hud.meter.setPending(p); pendShown = p; }
      } else if (pendShown > 0) {
        // the hold ended: bank it when its release paid (now or within a few steps), else let it fade
        if (gainedAt >= steps - 1) { hud.meter.bankPending(true); pendShown = 0; bankWait = 0; }
        else if (++bankWait >= BANK_WAIT_STEPS) { hud.meter.bankPending(false); pendShown = 0; bankWait = 0; }
      }
    }),
    () => sparks.destroy(),
  );
  { const n = g.collection.loadNotice(); if (n) { toast(n, 6000); announcer.say(n); } }

  // ---- tools: the Cut bar and its blade line, Snap's bar and backdrop tint, and the Save
  const cutBar = createCutBar(root, {
    onSplit: () => { const r = g.cut.splitInTwo(); if (r === 'miss') announcer.say('Nothing to cut there.'); },
    onReconnect: () => { if (!g.cut.reconnectAll(!g.settings.skipAnimations)) announcer.say('It is in one piece.'); },
    onDone: () => g.setTool('hand'),
  });
  let tintX = 0, tintY = 0;
  const placeTint = (): void => {
    const c = canvas.getBoundingClientRect();
    const b = g.bodies.extras.length ? null : g.host.bodyScreen();
    tintX = b ? b.x : c.width / 2; tintY = b ? b.y : c.height * 0.55;
    snap.place(c.left + tintX, c.top + tintY, c.width, c.height);
  };
  const slug = (t: string): string => t.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'squishy';
  const dateTag = (): string => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const download = (blob: Blob, name: string): void => {
    const url = URL.createObjectURL(blob);
    const a = h('a', { attrs: { href: url, download: name } });
    a.hidden = true;
    document.body.append(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };
  let lastPhoto = '', saving = false;
  // Save: the button shows "Saving…" and the shutter dims first (a paint), then, in the next task, ONE clean frame is rendered and read in
  // that same task (the drawing buffer is not preserved), composited with the tint when there is one, and encoded. The PNG encode can hold
  // the main thread (measured: seconds under the software GL of the test machine), so a second click while saving does nothing.
  const savePhoto = (): void => {
    if (saving) return;
    saving = true;
    snap.setSaving(true);
    snap.shutter(g.settings.calm);
    window.setTimeout(capturePhoto, 40);
  };
  const capturePhoto = (): void => {
    const cv = g.stage.canvas;
    const name = `squish-keeper-${slug(g.label.species)}-${dateTag()}.png`;
    const done = (): void => { saving = false; snap.setSaving(false); };
    if (g.tool !== 'snap') { done(); return; }
    try {
      placeTint();
      g.stageUpdate(0, true);   // ONE clean frame now: the HUD is hidden and the drawing buffer is read in this same task
      let src: HTMLCanvasElement = cv;
      const t = snap.tint;
      if (t.color) {
        const c2 = document.createElement('canvas');
        c2.width = cv.width; c2.height = cv.height;
        const x = c2.getContext('2d');
        if (x) {
          x.drawImage(cv, 0, 0);
          const k = cv.width / Math.max(1, cv.clientWidth);
          paintTint(x, cv.width, cv.height, tintX * k, tintY * k, t.color);
          src = c2;
        }
      }
      src.toBlob((blob) => {
        done();
        if (!blob) { toast('The photo could not be made. Try again.'); return; }
        lastPhoto = name;
        download(blob, name);
        announcer.say('Photo saved.');
      }, 'image/png');
    } catch (e) { console.error(e); done(); toast('The photo could not be made. Try again.'); }
  };
  const snap = createSnapBar(root, { onSave: savePhoto, onDone: () => g.setTool('hand'), onTint: (t) => { announcer.say(`Backdrop: ${t.label}`); } });
  const TOOL_LINES: Record<ToolId, string> = {
    hand: 'Hand: poke, squish, stretch.',
    cut: 'Cut: swipe across a squishy to cut it. Split in two and Reconnect all are buttons.',
    snap: 'Snap: drag to turn the camera (right-drag with a mouse), then Save photo. Escape goes back.',
  };
  let piecesKey = '';
  off.push(
    g.on('tool', (t) => {
      toys.setTool(t);
      document.body.dataset.tool = t;
      cutBar.show(t === 'cut');
      if (t === 'cut') { piecesKey = `${g.cut.pieces},${g.cut.maxPieces},${g.cut.busy}`; cutBar.setPieces(g.cut.pieces, g.cut.maxPieces, g.cut.busy); }   // right now, not on the next sim step (a paused sim showed both buttons on)
      if (t === 'snap') { placeTint(); snap.show(true); } else snap.show(false);
      if (t === 'hand' && (document.activeElement === document.body || !document.activeElement || root.contains(document.activeElement) && (document.activeElement as HTMLElement).closest('.cutbar, .snapbar'))) toys.button.focus({ preventScroll: true });
      announcer.say(TOOL_LINES[t]);
    }),
    g.on('blade', (b) => {
      if (!b) { cutBar.setBlade(null); return; }
      const c = canvas.getBoundingClientRect();
      cutBar.setBlade({ x0: c.left + b.x0, y0: c.top + b.y0, x1: c.left + b.x1, y1: c.top + b.y1 });
    }),
    g.on('cut', (r) => { if (r === 'miss') announcer.say('Swipe across the squishy to cut it.'); }),
    g.on('identity', () => toys.setAvailable(toolsNow())),
    g.onStep(() => {
      if (g.tool !== 'cut') return;
      const k = `${g.cut.pieces},${g.cut.maxPieces},${g.cut.busy}`;
      if (k !== piecesKey) { piecesKey = k; cutBar.setPieces(g.cut.pieces, g.cut.maxPieces, g.cut.busy); }
    }),
    () => { cutBar.destroy(); snap.destroy(); toys.destroy(); },
  );
  document.body.dataset.tool = g.tool;
  void lastPhoto;

  // ---- the play target follows the squishy on screen (CSSOM writes only; re-placed every frame while it has focus)
  let placeRaf = 0;
  const place = (): void => { play.place(g.host.bodyScreen()); };
  const placeLoop = (): void => { placeRaf = 0; place(); if (play.focused) placeRaf = requestAnimationFrame(placeLoop); };
  const onFocus = (): void => { if (!placeRaf) placeRaf = requestAnimationFrame(placeLoop); };
  play.el.addEventListener('focus', onFocus);
  // The transient hint pill keeps clear of the waiting capsule's tap circle: on a landscape phone it stood across the capsule's foot (found by the
  // render lane, VERIFY_RENDER_B_R1 B-m4). It slides sideways (--hint-dx) to the nearer side that fits, and only when neither side does (a tiny
  // screen) does it wait, hidden, until the capsule is gone. Measured from the pill's LAYOUT box (offsetLeft less half its width: transforms and the
  // transition of its own shift do not count), so it never chases itself.
  const HINT_CLEAR = 10, HINT_GUTTER = 12;
  let hintDx = 0, hintYield = false;
  const avoidCapsule = (): void => {
    const el = hud.hintEl;
    let dx = 0, wait = false;
    const cap = g.capsules.screenPoint();
    if (cap && el.offsetWidth > 0) {
      const cv = canvas.getBoundingClientRect(), hr = hud.el.getBoundingClientRect();
      const cx = cv.left + cap.x, cy = cv.top + cap.y, rad = cap.r + HINT_CLEAR;
      const left = hr.left + el.offsetLeft - el.offsetWidth / 2, right = left + el.offsetWidth, top = hr.top + el.offsetTop, bottom = top + el.offsetHeight;
      const nx = Math.max(left, Math.min(cx, right)), ny = Math.max(top, Math.min(cy, bottom));
      if (Math.hypot(cx - nx, cy - ny) < rad) {
        const toLeft = (cx - rad) - right, toRight = (cx + rad) - left;
        const okL = left + toLeft >= HINT_GUTTER, okR = right + toRight <= window.innerWidth - HINT_GUTTER;
        if (okL && (!okR || -toLeft <= toRight)) dx = toLeft; else if (okR) dx = toRight; else wait = true;
      }
    }
    if (Math.abs(dx - hintDx) > 0.5) { hintDx = dx; el.style.setProperty('--hint-dx', `${dx.toFixed(1)}px`); }
    if (wait !== hintYield) { hintYield = wait; el.dataset.yield = String(wait); }
  };
  const placeTimer = window.setInterval(() => { place(); avoidCapsule(); if (g.tool === 'snap') placeTint(); }, 250);
  const onTab = (e: KeyboardEvent): void => { if (e.key === 'Tab') document.body.dataset.kbd = '1'; };
  window.addEventListener('keydown', onTab, { capture: true, passive: true });

  return {
    hud, panel: p, play, plate, announcer, hoard, sparks, toys, toast,
    escape() {
      if (toys.escape()) return true;
      if (p.isOpen()) { p.close('escape'); return true; }
      if (hoard.escape()) return true;
      if (g.tool !== 'hand') { g.setTool('hand'); return true; }   // Snap and Cut: Escape puts the Hand back
      if (plate.shown) { plate.hide(); return true; }
      return false;
    },
    keyUsed() { document.body.dataset.kbd = '1'; if (!isCoarsePointer()) hud.setHintMode('keyboard'); },
    switchBy(dir) {
      const list = choices().slice(0, QUICK_MAX);
      if (!list.length) { announcer.say('No other squishy to switch to yet.'); return; }
      pick((dir > 0 ? list[0] : list[list.length - 1]).id);
    },
    destroy() {
      for (const f of off.splice(0)) f();
      clearInterval(placeTimer); clearTimeout(toastTimer); cancelAnimationFrame(placeRaf);
      play.el.removeEventListener('focus', onFocus);
      window.removeEventListener('keydown', onTab, { capture: true });
      toastEl?.remove(); hoard.destroy(); hud.destroy(); p.destroy(); play.destroy(); plate.destroy(); announcer.destroy();
    },
  };
}
