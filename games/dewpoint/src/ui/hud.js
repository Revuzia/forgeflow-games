// In-game HUD, minimal in play and never over the path: the level's name and the area the hero is
// in (top left), collectibles and pause (top right), the form bar with its gauge (bottom centre;
// on touch a grid by the right thumb), a hint card in a corner, and the touch controls (virtual
// stick, orbit area, jump, four form buttons). Passing things: the area banner (each area's name,
// once, as the hero enters it), a "Checkpoint" notice, a blink of the picture on a respawn.
// Everything that differs between elements (the four forms and their icons, the collectible,
// the gauge, colours, wording) comes from src/ui/elements.js through setElement().

import { ICONS, FORM_KEYS, FORM_LABELS, COLLECTIBLE_ICONS, GAUGE_ICONS } from './icons.js';
import { elementUi } from './elements.js';
import { resolvePrompt, hintSeconds, hintArrival, HINT_MIN_READ, DISMISS_LABEL } from './prompts.js';

const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

export class Hud {
  /**
   * @param {HTMLElement} root
   * @param {Input} input
   * @param {object} cb { onPause(), onOrbit(dx,dy), onGesture(), onUiTap() }
   */
  constructor(root, input, cb) {
    this.input = input; this.cb = cb;
    this.root = el('div', 'hud');
    this.root.hidden = true;
    root.appendChild(this.root);

    // --- top bar
    const top = el('div', 'hud-top');
    const where = el('div', 'hud-where');
    this.nameEl = el('div', 'hud-name');
    this.areaEl = el('div', 'hud-area');
    where.append(this.nameEl, this.areaEl);
    this.shardEls = [];
    const shards = el('div', 'hud-shards');
    this.shardBox = shards;
    for (let i = 0; i < 3; i++) { const s = el('span', 'hud-shard'); shards.appendChild(s); this.shardEls.push(s); }
    this.pauseBtn = el('button', 'hud-pause', ICONS.pause);
    this.pauseBtn.type = 'button'; this.pauseBtn.setAttribute('aria-label', 'Pause');
    this.pauseBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); cb.onPause(); });
    top.append(where, shards, this.pauseBtn);
    this.root.appendChild(top);

    // --- passing notices: the area banner, a toast, the respawn blink (never take input)
    this.banner = el('div', 'hud-banner');
    this.banner.hidden = true; this.banner.setAttribute('role', 'status');
    this.bannerEyebrow = el('span', 'hud-banner-eyebrow'); this.bannerName = el('span', 'hud-banner-name');
    this.banner.append(this.bannerEyebrow, this.bannerName);
    this.root.appendChild(this.banner);
    this.bannerT = 0; this.toastEl = null; this.blinkEl = null;

    // --- hint toast
    // The card holds the RAW hint (with {tokens}); what is on screen is resolved for the active input
    // method, so it re-words itself live if the player picks up a pad or touches the screen.
    this.mode = 'keyboard';
    this.hint = el('button', 'hud-hint');
    this.hint.type = 'button'; this.hint.hidden = true;
    this.hintText = el('span', 'hud-hint-text');
    this.hintMore = el('span', 'hud-hint-more', DISMISS_LABEL.keyboard);
    this.hintX = el('span', 'hud-hint-x', '&times;');       // the only part of the touch card that takes touches
    this.hintX.setAttribute('aria-label', 'Dismiss hint');
    this.hint.append(this.hintText, this.hintMore, this.hintX);
    this.hint.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.dismissHint(); });
    this.root.appendChild(this.hint);
    this.hintT = 0; this.hintAge = 0; this.hintQueue = []; this.hintRaw = '';

    // --- the gauge as a bar of its own, for elements whose gauge does not refill by itself (heat)
    this.meter = el('div', 'hud-meter');
    this.meter.hidden = true;
    this.meter.setAttribute('role', 'meter'); this.meter.setAttribute('aria-valuemin', '0'); this.meter.setAttribute('aria-valuemax', '100');
    this.meterIcon = el('span', 'hud-meter-icon');
    this.meterFill = el('span', 'hud-meter-bar');
    this.meter.append(this.meterIcon, this.meterFill);
    this.root.appendChild(this.meter);

    // --- form bar (desktop) : four slots with key caps. Filled by setElement().
    this.bar = el('div', 'formbar');
    this.slots = {};
    this.root.appendChild(this.bar);

    // --- touch controls
    this.touch = el('div', 'touch');
    this.orbitZone = el('div', 'touch-orbit');
    this.stickZone = el('div', 'touch-stickzone');
    this.stickBase = el('div', 'touch-stick');
    this.stickKnob = el('div', 'touch-knob');
    this.stickBase.appendChild(this.stickKnob);
    this.stickZone.appendChild(this.stickBase);
    this.jumpBtn = el('div', 'touch-jump', ICONS.jump);
    this.jumpBtn.setAttribute('role', 'button'); this.jumpBtn.setAttribute('aria-label', 'Jump');
    this.formGrid = el('div', 'touch-forms');
    this.tslots = {};
    this.touch.append(this.orbitZone, this.stickZone, this.formGrid, this.jumpBtn);
    this.root.appendChild(this.touch);
    this._wireStick();
    this._wireOrbit();
    this._wireJump();

    this.lastForm = ''; this.lastGauge = -1; this.lastShards = -1; this.lastAllowed = ''; this.lastPend = '';
    this.elementId = ''; this.ui = null; this.formIds = []; this.gaugeReady = false;
    this.setElement('water');
  }

  /**
   * Dress the HUD for an element: its four form buttons (desktop bar and touch grid), its
   * collectible, its gauge and its colours. Cheap to call again with the same element.
   */
  setElement(id) {
    const ui = elementUi(id);
    if (ui.id === this.elementId) return;
    this.ui = ui; this.elementId = ui.id; this.formIds = ui.forms.map((f) => f.id);
    this.root.dataset.element = ui.id;
    this.root.style.setProperty('--el', ui.accent); this.root.style.setProperty('--el-deep', ui.accentDeep);
    const { cb, input } = this;
    this.bar.replaceChildren(); this.formGrid.replaceChildren();
    this.slots = {}; this.tslots = {};
    for (const f of this.formIds) {
      const fc = (ui.forms.find((x) => x.id === f) || {}).color || ui.accent;
      const b = el('button', `form-slot form-${f}`);
      b.style.setProperty('--fc', fc);
      b.type = 'button'; b.setAttribute('aria-label', `${FORM_LABELS[f]} form`); b.setAttribute('aria-keyshortcuts', FORM_KEYS[f]);
      b.innerHTML = `<span class="form-gauge"></span><span class="form-icon">${ICONS[f]}</span><span class="form-key">${FORM_KEYS[f]}</span><span class="form-lock">${ICONS.lock}</span>`;
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); cb.onGesture(); input.requestForm(f); });
      this.bar.appendChild(b);
      this.slots[f] = { btn: b, gauge: b.querySelector('.form-gauge') };
      const t = el('div', `touch-form form-${f}`);
      t.style.setProperty('--fc', fc);
      t.setAttribute('role', 'button'); t.setAttribute('aria-label', `${FORM_LABELS[f]} form`);
      t.innerHTML = `<span class="form-gauge"></span><span class="form-icon">${ICONS[f]}</span><span class="form-lock">${ICONS.lock}</span>`;
      t.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation(); cb.onGesture();
        input.requestForm(f);
        t.classList.add('pressed'); setTimeout(() => t.classList.remove('pressed'), 140);
      });
      this.formGrid.appendChild(t);
      this.tslots[f] = { btn: t, gauge: t.querySelector('.form-gauge') };
    }
    const [, empty] = COLLECTIBLE_ICONS[ui.id];
    this.shardBox.setAttribute('aria-label', ui.collectible.label);
    for (const s of this.shardEls) { s.classList.remove('got'); s.innerHTML = empty; }
    this.meter.hidden = !ui.gauge.meter;
    this.meter.setAttribute('aria-label', ui.gauge.name);
    this.meterIcon.innerHTML = GAUGE_ICONS[ui.id];
    this.lastForm = ''; this.lastGauge = -1; this.lastShards = -1; this.lastAllowed = ''; this.lastPend = ''; this.gaugeReady = false;
  }

  // ------------------------------------------------------------------ touch wiring
  _wireStick() {
    const zone = this.stickZone, base = this.stickBase, knob = this.stickKnob;
    let id = null, ox = 0, oy = 0;
    // pointer positions are in screen pixels; the stick is laid out in UI pixels (smaller when a tiny window scales the UI down)
    const K = () => (zone.offsetWidth ? zone.getBoundingClientRect().width / zone.offsetWidth : 1) || 1;
    const R = () => (base.offsetWidth * 0.5 || 56) * K();
    const place = (cx, cy) => {
      const r = zone.getBoundingClientRect(), rad = R(), k = K();
      // keep the whole base on screen
      ox = Math.max(r.left + rad, Math.min(r.right - rad, cx)); oy = Math.max(r.top + rad, Math.min(r.bottom - rad, cy));
      base.style.left = `${(ox - r.left) / k}px`; base.style.top = `${(oy - r.top) / k}px`;
    };
    const move = (cx, cy) => {
      const rad = R() * 0.82;
      let dx = (cx - ox) / rad, dy = (cy - oy) / rad;
      const l = Math.hypot(dx, dy);
      if (l > 1) { dx /= l; dy /= l; }
      knob.style.transform = `translate(${dx * rad / K()}px, ${dy * rad / K()}px)`;
      const dead = 0.14, m = Math.hypot(dx, dy);
      if (m < dead) this.input.setTouchMove(0, 0);
      else { const k = (m - dead) / (1 - dead) / m; this.input.setTouchMove(dx * k, -dy * k); }
    };
    zone.addEventListener('pointerdown', (e) => {
      if (id !== null) return;
      e.preventDefault(); this.cb.onGesture();
      id = e.pointerId;
      try { zone.setPointerCapture(id); } catch (err) { /* ignore */ }
      base.classList.add('active');
      place(e.clientX, e.clientY); move(e.clientX, e.clientY);
    });
    zone.addEventListener('pointermove', (e) => { if (e.pointerId === id) { e.preventDefault(); move(e.clientX, e.clientY); } });
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      base.classList.remove('active');
      base.style.left = ''; base.style.top = '';
      knob.style.transform = '';
      this.input.setTouchMove(0, 0);
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
    zone.addEventListener('lostpointercapture', end);
  }

  _wireOrbit() {
    const z = this.orbitZone;
    let id = null, lx = 0, ly = 0;
    z.addEventListener('pointerdown', (e) => {
      if (id !== null) return;
      e.preventDefault(); this.cb.onGesture();
      id = e.pointerId; lx = e.clientX; ly = e.clientY;
      try { z.setPointerCapture(id); } catch (err) { /* ignore */ }
    });
    z.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      e.preventDefault();
      this.cb.onOrbit(e.clientX - lx, e.clientY - ly);
      lx = e.clientX; ly = e.clientY;
    });
    const end = (e) => { if (e.pointerId === id) id = null; };
    z.addEventListener('pointerup', end); z.addEventListener('pointercancel', end); z.addEventListener('lostpointercapture', end);
  }

  _wireJump() {
    const b = this.jumpBtn;
    let id = null;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation(); this.cb.onGesture();
      id = e.pointerId;
      try { b.setPointerCapture(id); } catch (err) { /* ignore */ }
      b.classList.add('pressed');
      this.input.setTouchJump(true);
    });
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null; b.classList.remove('pressed');
      this.input.setTouchJump(false);
    };
    b.addEventListener('pointerup', end); b.addEventListener('pointercancel', end); b.addEventListener('lostpointercapture', end);
  }

  /** Level complete: a warm bloom from the kiln door and a banner, before the results panel. */
  celebrate(name) {
    const host = this.root.parentNode;
    if (!host) return;
    const old = host.querySelector('.win-flash'); if (old) old.remove();
    const f = el('div', 'win-flash');
    const b = el('div', 'win-banner');
    b.append(el('span', 'win-eyebrow', this.ui.win), el('span', 'win-name'));
    b.lastChild.textContent = name || '';
    f.appendChild(b);
    host.appendChild(f);
    this.hint.hidden = true; this.hintQueue.length = 0; this.banner.hidden = true; this.bannerT = 0;
    this._winT = setTimeout(() => f.remove(), 2600);
  }

  /** The results panel is up: let the bloom and banner bow out quickly. */
  endCelebrate() {
    const host = this.root.parentNode, f = host && host.querySelector('.win-flash');
    if (!f) return;
    f.classList.add('out');
    clearTimeout(this._winT);
    this._winT = setTimeout(() => f.remove(), 300);
  }

  // ------------------------------------------------------------------ state
  /** While a menu is open over the game, keep the hint card out of the way (it comes back after). */
  setPaused(on) { this.root.classList.toggle('paused', !!on); }
  show(v) { this.root.hidden = !v; if (!v) { this.hint.hidden = true; this.hintQueue.length = 0; this.banner.hidden = true; this.bannerT = 0; } }
  /** 'keyboard' | 'touch' | 'pad'. Touch gets the on-screen controls; the hint text follows the mode. */
  setInputMode(mode) {
    this.mode = mode;
    this.root.classList.toggle('is-touch', mode === 'touch');
    this.hintMore.textContent = DISMISS_LABEL[mode] || DISMISS_LABEL.keyboard;
    if (!this.hint.hidden) this.hintText.textContent = resolvePrompt(this.hintRaw, mode);
  }
  setTouchMode(on) { this.setInputMode(on ? 'touch' : 'keyboard'); }
  setLevel(name, element) {
    if (element) this.setElement(element);
    this.nameEl.textContent = name; this.areaEl.textContent = ''; this.banner.hidden = true; this.bannerT = 0; this.lastShards = -1; this.lastAllowed = ''; this.lastForm = ''; this.lastGauge = -1; this.gaugeReady = false;
    this.hint.hidden = true; this.hintQueue.length = 0;      // hints belong to the level that raised them
  }

  showHint(raw) {
    if (!raw) return;
    if (!this.hint.hidden) {
      // A hint belongs to the place that raised it, and the player keeps moving. Once the card on screen has had a
      // fair read, the newer hint takes its place at once (and any older waiting ones are out of date too); a card
      // that has only just appeared (two hints in the same breath) is read first, for what is left of that read.
      if (hintArrival(true, this.hintAge) === 'replace') { this.hintQueue.length = 0; this.hint.hidden = true; }
      else {
        this.hintQueue.push(raw);
        this.hintT = Math.min(this.hintT, HINT_MIN_READ - this.hintAge);
        return;
      }
    }
    const text = resolvePrompt(raw, this.mode);
    this.hintRaw = raw;
    this.hintText.textContent = text;
    this.hint.hidden = false;
    this.hint.classList.remove('in'); void this.hint.offsetWidth; this.hint.classList.add('in');
    this.hintT = hintSeconds(text, this.mode); this.hintAge = 0;
  }

  /**
   * The hero walked into an area for the first time: its name in a banner for a few seconds (it
   * waits its turn behind a hint on a phone, where both live under the top bar), and from then on
   * in the small line under the level's name. `index` is 0-based.
   */
  showArea(name, index, total) {
    this.areaEl.textContent = name;
    this.bannerEyebrow.textContent = total > 1 ? `Area ${index + 1} of ${total}` : 'Area';
    this.bannerName.textContent = name;
    this.banner.hidden = false;
    this.banner.classList.remove('in', 'out'); void this.banner.offsetWidth; this.banner.classList.add('in');
    this.bannerT = 2.8;
  }
  /** Which area the hero is in now (no banner: it has been here before). */
  setArea(name) { this.areaEl.textContent = name || ''; }

  /** A short notice under the top bar ("Checkpoint"). */
  toast(text, icon) {
    if (this.toastEl) this.toastEl.remove();
    const t = el('div', 'hud-toast', `${icon ? ICONS[icon] || '' : ''}<span></span>`);
    t.lastChild.textContent = text;
    t.setAttribute('role', 'status');
    this.root.appendChild(t);
    this.toastEl = t;
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => { t.remove(); if (this.toastEl === t) this.toastEl = null; }, 1600);
  }

  /** Respawn: the picture blinks shut round the middle and opens again (nothing under reduced motion). */
  blink() {
    if (this.blinkEl) this.blinkEl.remove();
    const b = el('div', 'hud-blink');
    this.root.appendChild(b);
    this.blinkEl = b;
    clearTimeout(this._blinkT);
    this._blinkT = setTimeout(() => { b.remove(); if (this.blinkEl === b) this.blinkEl = null; }, 560);
  }

  dismissHint() {
    if (this.hint.hidden) return;
    this.hint.hidden = true;
    if (this.hintQueue.length) this.showHint(this.hintQueue.shift());
  }

  /** Per-frame refresh. Only touches the DOM when something actually changed. */
  update(sim, dt) {
    if (this.root.hidden || !sim) return;
    // a hint card waits out an area banner where the two share the space under the top bar (phones, touch): its
    // reading time only runs while it can be read (ui.css hides it under the banner)
    const view = this.root.ownerDocument && this.root.ownerDocument.defaultView;
    const underBanner = this.bannerT > 0 && (this.root.classList.contains('is-touch') || (view && view.innerWidth < 900));
    if (!this.hint.hidden && !this.root.classList.contains('paused') && !underBanner) { this.hintT -= dt; this.hintAge += dt; if (this.hintT <= 0) this.dismissHint(); }
    if (this.bannerT > 0 && !this.root.classList.contains('paused')) {
      this.bannerT -= dt;
      if (this.bannerT <= 0.35 && !this.banner.classList.contains('out')) { this.banner.classList.remove('in'); this.banner.classList.add('out'); }
      if (this.bannerT <= 0) this.banner.hidden = true;
    }
    // on narrow screens the hint card and the banner share the strip under the top bar: the hint gives way
    this.root.classList.toggle('has-banner', this.bannerT > 0);
    const p = sim.player, L = sim.level;
    if (sim.element.id !== this.elementId) this.setElement(sim.element.id);
    const FORMS = this.formIds, F = sim.F;
    if (!this.gaugeReady) {
      // which buttons carry the gauge: the forms that spend it (unless the element shows a bar of its own)
      this.gaugeReady = true;
      // the bar of its own: always for an element whose gauge does not refill by itself (heat); for water's
      // steam, in every level where steam can be used - a clear, filling bar, not only the sliver on the button
      this.meterOn = !!this.ui.gauge.meter || FORMS.some((f) => F[f] && F[f].drain && L.forms.includes(f));
      this.meter.hidden = !this.meterOn;
      for (const f of FORMS) {
        const on = !this.ui.gauge.meter && !!(F[f] && F[f].drain);
        this.slots[f].btn.classList.toggle('has-gauge', on); this.tslots[f].btn.classList.toggle('has-gauge', on);
      }
    }
    const meter = this.meterOn;
    const allowed = L.forms.join(',');
    if (allowed !== this.lastAllowed) {
      this.lastAllowed = allowed;
      for (const f of FORMS) {
        const lock = !L.forms.includes(f);
        this.slots[f].btn.classList.toggle('locked', lock); this.tslots[f].btn.classList.toggle('locked', lock);
      }
    }
    const formChanged = p.form !== this.lastForm;
    if (formChanged) {
      this.lastForm = p.form;
      for (const f of FORMS) {
        this.slots[f].btn.classList.toggle('active', f === p.form); this.tslots[f].btn.classList.toggle('active', f === p.form);
      }
    }
    const pend = p.pendForm || '';
    if (pend !== this.lastPend) {
      this.lastPend = pend;
      for (const f of FORMS) { this.slots[f].btn.classList.toggle('pending', f === pend); this.tslots[f].btn.classList.toggle('pending', f === pend); }
    }
    const g = Math.round(p.gauge / sim.G.max * 100);
    if (g !== this.lastGauge || formChanged) {
      this.lastGauge = g;
      const spending = !!(F[p.form] && F[p.form].drain);
      for (const f of FORMS) {
        const D = F[f];
        if (!D || !D.drain) continue;
        const low = p.gauge < D.minStart && p.form !== f;       // not enough left to switch to it
        for (const s of [this.slots[f], this.tslots[f]]) {
          s.btn.classList.toggle('low', low);
          if (this.ui.gauge.meter) continue;
          s.gauge.style.setProperty('--g', `${g}%`);
          s.btn.classList.toggle('draining', p.form === f && g < 30);
        }
      }
      if (meter) {
        this.meterFill.style.setProperty('--g', `${g}%`);
        this.meter.setAttribute('aria-valuenow', String(g));
        this.meter.classList.toggle('low', g < 25);
        this.meter.classList.toggle('spending', spending);
        this.meter.classList.toggle('draining', spending && g < 30);
      }
    }
    const n = sim.shardsTaken.length;
    if (n !== this.lastShards) {
      const [full, empty] = COLLECTIBLE_ICONS[this.elementId];
      L.shards.forEach((sh, i) => {
        const e = this.shardEls[i]; if (!e) return;
        const got = sim.shardsTaken.includes(i);
        if (got !== e.classList.contains('got')) { e.classList.toggle('got', got); e.innerHTML = got ? full : empty; e.classList.toggle('pop', got && this.lastShards >= 0); }
      });
      for (let i = L.shards.length; i < 3; i++) this.shardEls[i].style.visibility = 'hidden';
      for (let i = 0; i < L.shards.length; i++) this.shardEls[i].style.visibility = '';
      this.lastShards = n;
    }
  }
}
