// BLOCKTOOTH v2 — the ability bar: owned-card slots + level badges, the UPROAR meter, the ACTIVE (hook)
// cooldown panel (FEATURES_V2 §4). Lane L8. UI.
//
// DOM is built once at construction and pooled (10 slots). Per frame, update() writes only transforms,
// custom properties that feed transforms, class toggles and change-only text (TextSlot / VarSlot /
// ClassSlot); it never reads layout. Text writes are ≤ 10 Hz (the ACTIVE seconds change at most once per
// second; the meter percent only when its rounded value changes). The bar's slot set is re-derived at
// 4 Hz (upgrades change only between frames of a draft) and immediately on bind.
//
// Also owned here (pre-built, opacity/transform only): the UPROAR burst word stamp beside the meter
// (§3.6: never over the titan) and the screen-space radial speed-line overlay (§3.7).
//
// Test hooks (§13.3, visible nodes only): [data-v2="bar-slot"], [data-v2="badge"], [data-v2="active-cd"],
// [data-v2="meter"] (data-pct).

import './hud_v2.css';
import type { SimEvent, World } from '../core/types.ts';
import type { AbilityBarApi } from '../v2types.ts';
import { ULT } from '../core/config.ts';
import { TITANS } from '../data/titans.ts';
import { UPGRADE_BY_ID } from '../data/upgrades.ts';
import { ULTS } from '../data/ultimates.ts';
import { HUD2 } from '../data/strings_hud.ts';
import { loadProfile } from '../core/save.ts';
import { ClassSlot, TextSlot, VarSlot, div, el, flashesReduced, keyChip, pulse } from './dom.ts';
import { BAR_SLOTS, badgeFor, barFill, barGlyphs, barSlots, glyphSvg, rarityFrameClass } from './icons.ts';
import { dismissHudToast, pushHudToast } from './toast.ts';
import { evolutionProgress } from '../upgrades/draft.ts';

const SLOT_REFRESH_S = 0.25;
const PROC_GAP_MS = 250;          // ≤ 4 Hz per slot (§4.2.5)
const DEVICE_POLL_S = 0.25;
const WIRE_CAP = 6;               // VOLT-KITE live-wire cap (CONTRACT §8)
const BURST_MS = 1300;
const HINT_KEY = 'uproarHint';

interface SlotNode {
  root: HTMLDivElement;
  glyph: HTMLDivElement;
  badge: HTMLDivElement;
  more: HTMLDivElement;
  proc: HTMLDivElement;
  burst: HTMLDivElement;
  flag: HTMLDivElement;
  id: string | null;        // card shown ('' = none; null = the +N slot)
  sig: string;              // id|stacks|more
  gl: string;               // glyph|fill drawn (F4: bar glyphs are assigned per bar, so a slot's can change)
  lastProc: number;
}

type Device = 'keyboard' | 'gamepad';

export class AbilityBar implements AbilityBarApi {
  private readonly layer: HTMLDivElement;
  private shown = false;
  private world: World | null = null;

  // bar
  private readonly bar: HTMLDivElement;
  private readonly slots: SlotNode[] = [];
  private slotAcc = 0;
  private slotSig = '#';

  // UPROAR meter
  private readonly meter: HTMLDivElement;
  private readonly meterFill: VarSlot;
  private readonly meterCool: VarSlot;
  private readonly meterLbl: TextSlot;
  private readonly meterPct: TextSlot;
  private readonly meterKey: TextSlot;
  private readonly meterReady: ClassSlot;
  private readonly meterCooling: ClassSlot;
  private readonly burst: HTMLDivElement;
  private readonly lines: HTMLDivElement;
  private pctShown = -1;
  private drainT = 0;           // > 0: draining the meter over the roar (visual)
  private drainFrom = 0;
  private roarS = 0.5;

  // ACTIVE panel
  private readonly active: HTMLDivElement;
  private readonly actName: TextSlot;
  private readonly actKey: TextSlot;
  private readonly actCd: TextSlot;
  private readonly actBar: VarSlot;
  private readonly swA: VarSlot;
  private readonly swB: VarSlot;
  private readonly actReady: ClassSlot;
  private readonly actCore: HTMLDivElement;
  private readonly kitRow: HTMLDivElement;
  private readonly kitOn: ClassSlot;
  private readonly kitLbl: TextSlot;
  private readonly kitVal: TextSlot;
  private readonly kitBar: VarSlot;
  private kitKind = '';
  private hookMax = 1;
  private lastCd = 0;
  private cdShown = -1;
  private kitAcc = 0;

  // input device (key chips)
  private device: Device = 'keyboard';
  private devAcc = 0;
  private hintArmed = false;
  /** Gate F: evolution recipes already announced as ready this run */
  private evoSeen = new Set<string>();

  constructor(root: HTMLElement) {
    const L = this.layer = div('bt-layer bt-v2hud bt-hidden', root);

    // speed lines (behind everything in this layer)
    this.lines = div('bt-ult-lines', L);

    // ── UPROAR meter
    const m = this.meter = div('bt-uproar', L);
    m.dataset.v2 = 'meter';
    m.dataset.pct = '0';
    const tab = div('bt-up-tab', m);
    this.meterLbl = new TextSlot(el('span', 'bt-up-lbl', HUD2.uproar));
    tab.appendChild(this.meterLbl.node);
    this.meterPct = new TextSlot(el('span', 'bt-up-pct', '0%'));
    tab.appendChild(this.meterPct.node);
    const kc = keyChip(HUD2.keyUltKb);
    tab.appendChild(kc);
    this.meterKey = new TextSlot(kc);
    const tr = div('bt-up-track', m);
    this.meterFill = new VarSlot(div('bt-up-fill', tr), '--p', 0.002);
    this.meterCool = new VarSlot(div('bt-up-cool', tr), '--c', 0.004);
    div('bt-up-shine', tr);
    div('bt-up-ticks', tr);
    this.meterReady = new ClassSlot(m, 'ready');
    this.meterCooling = new ClassSlot(m, 'cool');
    this.burst = div('bt-up-burst', m);

    // ── ability bar (10 pooled slots)
    this.bar = div('bt-abar', L);
    for (let i = 0; i < BAR_SLOTS; i++) {
      const r = div('bt-slot empty', this.bar);
      div('bt-rv', r);
      const flag = div('bt-slot-flag', r);
      flag.innerHTML = glyphSvg('evo', '#1b1426');
      const glyph = div('bt-slot-g', r);
      div('bt-slot-sh', r);
      const more = div('bt-slot-more off', r);
      const badge = div('bt-slot-badge off', r);
      const proc = div('bt-slot-proc', r);
      const burst = div('bt-slot-burst', r);
      burst.innerHTML = glyphSvg('evo', '#ffd166');
      this.slots.push({ root: r, glyph, badge, more, proc, burst, flag, id: '', sig: '', gl: '', lastProc: 0 });
    }

    // ── ACTIVE panel (hook)
    const a = this.active = div('bt-active', L);
    const box = div('bt-act-box', a);
    const swr = div('bt-sw r', box);
    const swl = div('bt-sw l', box);
    this.swA = new VarSlot(el('i'), '--a', 0.5);
    swr.appendChild(this.swA.node);
    this.swB = new VarSlot(el('i'), '--b', 0.5);
    swl.appendChild(this.swB.node);
    this.actCore = div('bt-act-core', box);
    div('bt-act-ring', box);
    const txt = div('bt-act-txt', a);
    const top = div('bt-act-top', txt);
    div('bt-act-lbl', top, HUD2.active);
    const hk = keyChip(HUD2.keyHookKb);
    top.appendChild(hk);
    this.actKey = new TextSlot(hk);
    this.actName = new TextSlot(div('bt-act-name', txt));
    const row = div('bt-act-row', txt);
    const ab = div('bt-act-bar', row);
    this.actBar = new VarSlot(el('i'), '--p', 0.005);
    ab.appendChild(this.actBar.node);
    const cd = div('bt-act-cd', row);
    cd.dataset.v2 = 'active-cd';
    this.actCd = new TextSlot(cd);
    this.actReady = new ClassSlot(a, 'ready');
    const kit = this.kitRow = div('bt-act-kit', txt);
    this.kitLbl = new TextSlot(div('bt-act-kitlbl', kit));
    const kb = div('bt-act-kitbar', kit);
    this.kitBar = new VarSlot(el('i'), '--p', 0.005);
    kb.appendChild(this.kitBar.node);
    this.kitVal = new TextSlot(div('bt-act-kitval', kit));
    this.kitOn = new ClassSlot(kit, 'on');

    // device detection for the key chips (no Input reference is passed to this class)
    window.addEventListener('keydown', () => { this.device = 'keyboard'; }, { passive: true });
    window.addEventListener('mousedown', () => { this.device = 'keyboard'; }, { passive: true });
  }

  show(on: boolean): void {
    this.shown = on;
    this.layer.classList.toggle('bt-hidden', !on);
  }

  // ─────────────────────────────── per frame ───────────────────────────────

  update(w: World, dt: number): void {
    if (w !== this.world) this.bind(w);
    if (!this.shown) return;
    const d = Math.min(0.1, Math.max(0, dt || 0));

    this.devAcc += d;
    if (this.devAcc >= DEVICE_POLL_S) { this.devAcc = 0; this.pollPad(); }

    // bar (4 Hz re-derive; change-only DOM)
    this.slotAcc += d;
    if (this.slotAcc >= SLOT_REFRESH_S) { this.slotAcc = 0; this.refreshSlots(w, false); }

    this.updateMeter(w, d);
    this.updateActive(w, d);
  }

  onEvents(w: World, ev: readonly SimEvent[]): void {
    if (w !== this.world) this.bind(w);
    for (const e of ev) {
      switch (e.type) {
        case 'upgradeProc': this.procSlot(e.id); break;
        case 'ultCharged':
          if (this.shown) pulse(this.meter, [{ transform: 'scale(1.06)' }, { transform: 'scale(1)' }], 360);
          if (this.hintArmed && w.titan.rank === 0) {
            this.hintArmed = false;
            // F4: shown at once (front of the queue, no 3 s gap) and only while the meter really reads
            // READY: it slides out the moment UPROAR fires (ON AIR) or the meter is otherwise not ready
            const ww = w;
            pushHudToast({ kicker: HUD2.hintKicker, title: this.device === 'gamepad' ? HUD2.hintTitlePad : HUD2.hintTitleKb, sub: HUD2.hintSub, glyph: 'megaphone' }, 6,
              { key: HINT_KEY, front: true, alive: () => this.world === ww && !!ww.ult && ww.ult.ready && ww.ult.phase === 'idle' && !ww.run.result });
          }
          break;
        case 'ultFire': dismissHudToast(HINT_KEY); this.onUltFire(w, e.titan); break;
        case 'ability':
          if (this.shown) pulse(this.active, [{ transform: 'scale(1.05)' }, { transform: 'scale(1)' }], 260);
          break;
        case 'revive':
          pushHudToast({ kicker: HUD2.reviveKicker, title: HUD2.reviveTitle, sub: HUD2.reviveSub, glyph: 'notice' }, 3.5);
          break;
        default: break;
      }
    }
  }

  // ─────────────────────────────── internals ───────────────────────────────

  private bind(w: World): void {
    this.world = w;
    const def = TITANS[w.titanId];
    this.active.style.setProperty('--titan', def ? def.colors.primary : '#3fae7f');
    this.actName.set(def ? def.hook.name : 'HOOK');
    this.actCore.innerHTML = glyphSvg('hook', def ? def.colors.accent : '#4fb3b0');
    this.hookMax = 1; this.lastCd = 0; this.kitKind = ''; this.cdShown = -1; this.kitAcc = 1;
    this.pctShown = -1; this.drainT = 0;
    for (const s of [this.meterLbl, this.meterPct, this.meterKey, this.actCd, this.actKey, this.kitLbl, this.kitVal]) s.reset();
    for (const v of [this.meterFill, this.meterCool, this.actBar, this.swA, this.swB, this.kitBar]) v.reset();
    for (const c of [this.meterReady, this.meterCooling, this.actReady, this.kitOn]) c.reset();
    this.lines.style.opacity = '0';
    this.burst.style.opacity = '0';
    this.slotSig = '#';
    this.evoSeen.clear();
    for (const s of this.slots) {           // a new run starts from an empty bar (no slot leaks from the last run)
      s.id = ''; s.sig = ''; s.gl = '';
      s.root.className = 'bt-slot empty';
      delete s.root.dataset.v2;
      this.setBadge(s, '');
    }
    this.refreshSlots(w, true);
    // one-time Size I hint: a profile's first run only (Profile.life.runs counts FINISHED runs)
    let first = false;
    try { first = loadProfile().life.runs === 0; } catch { first = false; }
    this.hintArmed = first && !hintShownThisSession;
    if (this.hintArmed) hintShownThisSession = true;
  }

  /**
   * Gate F: EVOLUTION READY toast when a recipe first becomes ready (the upgrade set only changes on a
   * pick, so this runs from refreshSlots' change-only path). Queued behind the draft screen by the toast
   * modal gate; slides out if the evolution is taken or stops being ready.
   */
  private checkEvoReady(w: World, silent: boolean): void {
    for (const p of evolutionProgress(w)) {
      if (!p.ready || this.evoSeen.has(p.evo)) continue;
      this.evoSeen.add(p.evo);
      if (silent) continue;
      const def = UPGRADE_BY_ID[p.evo];
      const ww = w, id = p.evo;
      pushHudToast({ kicker: HUD2.evoReadyKicker, title: HUD2.evoReadyTitle + ' — ' + (def ? def.name.toUpperCase() : id.toUpperCase()), sub: HUD2.evoReadySub, glyph: 'evo' }, 4.5,
        { key: 'evoReady:' + id, alive: () => this.world === ww && !ww.run.result && evolutionProgress(ww).some((q) => q.evo === id && q.ready) });
    }
  }

  private pollPad(): void {
    try {
      const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : null;
      if (!pads) return;
      for (const p of pads) {
        if (!p) continue;
        for (const b of p.buttons) if (b && b.pressed) { this.device = 'gamepad'; return; }
        for (const ax of p.axes) if (Math.abs(ax) > 0.55) { this.device = 'gamepad'; return; }
      }
    } catch { /* no gamepad API */ }
  }

  private refreshSlots(w: World, force: boolean): void {
    const U = w.upgrades;
    let sig = '';
    for (const id of U.order) sig += id + ':' + (U.owned[id] ?? 0) + '|';
    if (!force && sig === this.slotSig) return;
    const first = this.slotSig === '#';
    this.slotSig = sig;
    this.checkEvoReady(w, first);
    const layout = barSlots(U.order, U.owned);
    const glyphs = barGlyphs(layout.map((l) => l.id));   // F4: no two slots show the same glyph
    for (let i = 0; i < BAR_SLOTS; i++) {
      const s = this.slots[i];
      const want = layout[i];
      if (!want) {
        if (s.id !== '') { s.id = ''; s.sig = ''; s.gl = ''; s.root.className = 'bt-slot empty'; delete s.root.dataset.v2; this.setBadge(s, ''); s.glyph.innerHTML = ''; s.more.classList.add('off'); }
        continue;
      }
      if (want.id === null) {
        const sg = 'more|' + want.more;
        if (s.sig === sg) continue;
        const was = s.sig;
        s.id = null; s.sig = sg;
        s.root.className = 'bt-slot more bt-frame-common';
        s.root.dataset.v2 = 'bar-slot';
        s.gl = 'plus'; s.glyph.innerHTML = glyphSvg('plus', '#f4ecd8');
        s.more.textContent = '+' + want.more;
        s.more.classList.remove('off');
        s.root.title = '';
        this.setBadge(s, '');
        if (!first && !was.startsWith('more|')) this.pop(s);
        continue;
      }
      const u = UPGRADE_BY_ID[want.id];
      if (!u) continue;
      const stacks = U.owned[want.id] ?? 0;
      const gl = (glyphs[i] ?? 'star') + '|' + barFill(u);
      if (s.gl !== gl && s.id === want.id) { s.gl = gl; s.glyph.innerHTML = glyphSvg(glyphs[i] ?? 'star', barFill(u)); }
      const sg = want.id + '|' + stacks;
      if (s.sig === sg) continue;
      const prevId = s.id;
      s.id = want.id; s.sig = sg;
      s.root.className = 'bt-slot ' + rarityFrameClass(u);
      s.root.dataset.v2 = 'bar-slot';
      s.more.classList.add('off');
      s.root.title = u.name;
      if (prevId !== want.id) { s.gl = gl; s.glyph.innerHTML = glyphSvg(glyphs[i] ?? 'star', barFill(u)); }
      this.setBadge(s, badgeFor(u, stacks));
      if (first || force) continue;
      if (u.evo && prevId === u.evo.base) this.evoBurst(s);
      else if (prevId !== want.id) this.pop(s);
      else pulse(s.badge, [{ transform: 'scale(1.6)' }, { transform: 'scale(1)' }], 300);
    }
  }

  private setBadge(s: SlotNode, text: string): void {
    if (!text) {
      s.badge.classList.add('off');
      delete s.badge.dataset.v2;
      return;
    }
    s.badge.textContent = text;
    s.badge.className = 'bt-slot-badge' + (text === 'MAX' ? ' max' : text === 'EVO' ? ' evo' : '');
    s.badge.dataset.v2 = 'badge';
  }

  private pop(s: SlotNode): void {
    pulse(s.root, [{ transform: 'scale(.4)', opacity: 0 }, { transform: 'scale(1.12)', opacity: 1, offset: 0.7 }, { transform: 'scale(1)', opacity: 1 }], 250);
  }

  private evoBurst(s: SlotNode): void {
    this.pop(s);
    if (flashesReduced()) return;
    pulse(s.burst, [
      { opacity: 0, transform: 'scale(.3) rotate(0deg)' },
      { opacity: 1, transform: 'scale(1) rotate(20deg)', offset: 0.35 },
      { opacity: 0, transform: 'scale(1.35) rotate(40deg)' },
    ], 900, 'ease-out');
  }

  private procSlot(id: string): void {
    if (!this.shown) return;
    for (const s of this.slots) {
      if (s.id !== id) continue;
      const now = performance.now();
      if (now - s.lastProc < PROC_GAP_MS) return;
      s.lastProc = now;
      pulse(s.proc, [{ opacity: flashesReduced() ? 0.35 : 0.9 }, { opacity: 0 }], 120, 'linear');
      return;
    }
  }

  private onUltFire(w: World, titan: World['titanId']): void {
    const def = ULTS[titan];
    this.roarS = def ? Math.max(0.2, def.roarS) : 0.5;
    this.drainT = this.roarS;
    this.drainFrom = 100;
    if (!this.shown) return;
    this.burst.textContent = def ? def.burst : '';
    const tilt = w.titanId === 'voltkite' ? 4 : w.titanId === 'briarwick' ? -3 : -6;
    pulse(this.burst, [
      { opacity: 0, transform: `scale(.3) rotate(${tilt - 10}deg)` },
      { opacity: 1, transform: `scale(1.18) rotate(${tilt}deg)`, offset: 0.14 },
      { opacity: 1, transform: `scale(1) rotate(${tilt}deg)`, offset: 0.7 },
      { opacity: 0, transform: `scale(1.05) translateY(-30%) rotate(${tilt}deg)` },
    ], BURST_MS);
    if (!flashesReduced()) {
      const total = (def ? def.roarS + def.blastS : 1.4) * 1000;
      pulse(this.lines, [
        { opacity: 0, transform: 'scale(1.25)' },
        { opacity: 0.85, transform: 'scale(1)', offset: 0.15 },
        { opacity: 0.55, transform: 'scale(.96)', offset: 0.7 },
        { opacity: 0, transform: 'scale(.92)' },
      ], Math.max(600, total), 'ease-out');
    }
  }

  private updateMeter(w: World, d: number): void {
    const U = w.ult;
    const max = ULT.max || 100;
    let charge = U ? Math.max(0, Math.min(max, U.charge)) : 0;
    const firing = !!U && U.phase !== 'idle';
    // on fire the meter drains to 0 over the roar (the sim already zeroed it)
    if (this.drainT > 0) {
      this.drainT = Math.max(0, this.drainT - d);
      charge = Math.max(charge, this.drainFrom * (this.drainT / this.roarS));
    }
    const ready = !!U && U.ready && !firing;
    const cooling = !!U && !firing && U.lockT > 0 && !ready;
    this.meterFill.set(charge / max);
    this.meterCool.set(cooling ? Math.min(1, U.lockT / Math.max(0.1, ULT.lockoutS)) : 0);
    this.meterReady.set(ready);
    this.meterCooling.set(cooling);
    this.meterLbl.set(ready ? HUD2.uproarReady : firing ? HUD2.roaring : cooling ? HUD2.cooling : HUD2.uproar);
    const pct = Math.round(U ? (U.charge / max) * 100 : 0);
    if (pct !== this.pctShown) {
      this.pctShown = pct;
      this.meterPct.set(pct + '%');
      this.meter.dataset.pct = String(Math.round(U ? U.charge : 0));
    }
    this.meterKey.set(this.device === 'gamepad' ? HUD2.keyUltPad : HUD2.keyUltKb);
  }

  private updateActive(w: World, d: number): void {
    const T = w.titan;
    const cd = Math.max(0, T.abilityCd || 0);
    // total inferred like hud.ts hookMax: the largest cd seen since the last ready
    if (cd > this.lastCd + 0.05) this.hookMax = Math.max(0.1, cd);
    if (cd <= 0 && this.lastCd > 0) pulse(this.actCore, [{ transform: 'scale(1.25)' }, { transform: 'scale(1)' }], 320);
    this.lastCd = cd;
    const p = cd <= 0 ? 1 : 1 - Math.min(1, cd / this.hookMax);
    // two half-discs: right half sweeps 0 → 180° for p 0 → .5, left half 0 → 180° for p .5 → 1
    this.swA.set(Math.min(0.5, p) * 360);
    this.swB.set(Math.max(0, p - 0.5) * 360);
    this.actBar.set(p);
    this.actReady.set(cd <= 0);
    const sec = cd <= 0 ? 0 : Math.ceil(cd);
    if (sec !== this.cdShown) { this.cdShown = sec; this.actCd.set(sec === 0 ? HUD2.ready : sec + 's'); }
    this.actKey.set(this.device === 'gamepad' ? HUD2.keyHookPad : HUD2.keyHookKb);
    this.kitAcc += d;
    if (this.kitAcc >= 0.1) { this.kitAcc = 0; this.updateKit(w); }   // kit counters at ~10 Hz
  }

  private updateKit(w: World): void {
    const T = w.titan, K = T.kit || {};
    let kind = '', frac = 0, val = '';
    if (w.titanId === 'hearthback' && (K.cap || 0) > 0) {
      kind = 'shell'; frac = (K.stored || 0) / K.cap; val = `${Math.floor(Math.max(0, Math.min(1, frac)) * 100)}%`;
    } else if (w.titanId === 'voltkite') {
      const n = Math.max(0, Math.round(K.wires || 0));
      kind = 'wires'; frac = n / WIRE_CAP; val = `${n}/${WIRE_CAP}`;
    } else if (w.titanId === 'briarwick') {
      const cap = Math.max(1, Math.round(T.stats ? T.stats.turretCap : 4));
      const n = Math.max(0, Math.round(K.turrets || 0));
      kind = 'blooms'; frac = n / cap; val = `${n}/${cap}`;
    }
    this.kitOn.set(kind !== '');
    if (!kind) return;
    if (kind !== this.kitKind) {
      this.kitKind = kind;
      this.kitLbl.set(kind === 'shell' ? HUD2.shell : kind === 'wires' ? HUD2.wires : HUD2.blooms);
      this.kitRow.dataset.kit = kind;
    }
    this.kitBar.set(Math.max(0, Math.min(1, frac)));
    this.kitVal.set(val);
  }
}

let hintShownThisSession = false;
