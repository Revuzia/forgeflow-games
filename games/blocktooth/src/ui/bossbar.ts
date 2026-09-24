// BLOCKTOOTH — boss nameplate (CONTRACT.md §10, §12). ui lane.
// Top-centre broadcast lower-third, flipped to the top of the frame:
//   [HALVARD CIVIL DEFENSE · title]
//   CAISSON-4                                   [PHASE 2]
//   ███████████████████░░░░░░  (phase notches at 66 % / 33 %, damage trail)
//   STRAIN ▮▮▮▮▮▯▯▯▯▯                            72%
//   HOOK LANE — STEP OUT OF THE PAINT            (boss.subtitle, slides on change)
// update() is change-only (TextSlot / VarSlot / ClassSlot); phase change and stagger animate.

import type { BossDef, BossState } from '../core/types.ts';
import { bossSubtitle } from '../data/bosses.ts';
import { STR } from '../data/strings.ts';
import { ClassSlot, TextSlot, VarSlot, div, el, flashesReduced, pulse } from './dom.ts';

const METER_SEGS = 10;
const TRAIL_HOLD_S = 0.35;
const TRAIL_RATE = 0.45;         // fraction of max HP per second the trail drains

export class BossBar {
  private readonly layer: HTMLDivElement;
  private readonly plate: HTMLDivElement;
  private readonly nameT: TextSlot;
  private readonly titleT: TextSlot;
  private readonly phaseT: TextSlot;
  private readonly phaseBox: HTMLElement;
  private readonly hpFill: VarSlot;
  private readonly hpTrail: VarSlot;
  private readonly hpPct: TextSlot;
  private readonly hpBar: HTMLElement;
  private readonly meterLbl: TextSlot;
  private readonly meterPct: TextSlot;
  private readonly segs: ClassSlot[] = [];
  private readonly segBox: HTMLElement;
  private readonly subT: TextSlot;
  private readonly subBox: HTMLElement;
  private readonly staggerOn: ClassSlot;
  private readonly introOn: ClassSlot;
  private readonly downOn: ClassSlot;
  private readonly hotOn: ClassSlot;

  private def: BossDef | null = null;
  private shown = false;
  private lastPhase = 0;
  private lastSub = '';
  private lastSegs = -1;
  private lastStagger = false;
  private trail = 1;
  private trailHold = 0;
  private lastHp = 1;
  private lastT = 0;

  constructor(root: HTMLElement) {
    this.layer = div('bt-layer bt-bossbar bt-hidden', root);
    const P = this.plate = div('bt-boss', this.layer);

    const top = div('bt-boss-top', P);
    top.appendChild(el('span', 'bt-boss-tag', STR.boss.contractor));
    this.titleT = new TextSlot(el('span', 'bt-boss-title'));
    top.appendChild(this.titleT.node);

    const row = div('bt-boss-row', P);
    this.nameT = new TextSlot(el('span', 'bt-boss-name'));
    row.appendChild(this.nameT.node);
    this.phaseBox = div('bt-boss-phase', row);
    this.phaseBox.appendChild(el('small', '', STR.boss.phase));
    this.phaseT = new TextSlot(el('b', '', '1'));
    this.phaseBox.appendChild(this.phaseT.node);

    const hp = this.hpBar = div('bt-boss-hp', P);
    const track = div('bt-boss-hp-track', hp);
    this.hpTrail = new VarSlot(div('bt-boss-hp-trail', track), '--p', 0.001);
    this.hpFill = new VarSlot(div('bt-boss-hp-fill', track), '--p', 0.001);
    div('bt-boss-notch n66', track);
    div('bt-boss-notch n33', track);
    this.hpPct = new TextSlot(div('bt-boss-hp-pct', hp));

    const mr = div('bt-boss-meter', P);
    this.meterLbl = new TextSlot(el('span', 'bt-boss-meter-lbl'));
    mr.appendChild(this.meterLbl.node);
    this.segBox = div('bt-boss-segs', mr);
    for (let i = 0; i < METER_SEGS; i++) this.segs.push(new ClassSlot(div('bt-boss-seg', this.segBox), 'on'));
    this.meterPct = new TextSlot(el('span', 'bt-boss-meter-pct'));
    mr.appendChild(this.meterPct.node);

    this.subBox = div('bt-boss-sub', P);
    this.subT = new TextSlot(el('span', ''));
    this.subBox.appendChild(this.subT.node);

    this.staggerOn = new ClassSlot(P, 'stagger');
    this.introOn = new ClassSlot(P, 'intro');
    this.downOn = new ClassSlot(P, 'down');
    this.hotOn = new ClassSlot(P, 'hot');
  }

  show(def: BossDef): void {
    this.def = def;
    this.nameT.set(def.name);
    this.titleT.set(def.title);
    this.meterLbl.set(def.meterName);
    this.plate.dataset.boss = def.id;
    this.lastPhase = 0; this.lastSub = ''; this.lastSegs = -1; this.lastStagger = false;
    this.trail = 1; this.trailHold = 0; this.lastHp = 1; this.lastT = 0;
    for (const s of [this.phaseT, this.hpPct, this.meterPct, this.subT]) s.reset();
    for (const v of [this.hpFill, this.hpTrail]) v.reset();
    for (const c of [this.staggerOn, this.introOn, this.downOn, this.hotOn, ...this.segs]) c.reset();
    this.hpFill.set(1); this.hpTrail.set(1);
    this.subT.set(STR.boss.approaching);
    this.introOn.set(true);
    this.shown = true;
    this.layer.classList.remove('bt-hidden');
    pulse(this.plate, [
      { transform: 'translateY(-140%)', opacity: 0 },
      { transform: 'translateY(6%)', opacity: 1, offset: 0.7 },
      { transform: 'translateY(0)', opacity: 1 },
    ], 620);
  }

  update(b: BossState | null): void {
    if (!this.shown || !b) return;
    const def = this.def;
    if (!def || def.id !== b.id) return;
    const now = performance.now();
    const dt = this.lastT ? Math.min(0.1, (now - this.lastT) / 1000) : 0;
    this.lastT = now;

    // HP + trail
    const hpF = b.maxHp > 0 ? Math.max(0, Math.min(1, b.hp / b.maxHp)) : 0;
    if (hpF >= this.trail) { this.trail = hpF; this.trailHold = 0; }
    else if (this.trailHold > 0) this.trailHold -= dt;
    else this.trail = Math.max(hpF, this.trail - TRAIL_RATE * dt);
    if (hpF < this.lastHp - 1e-5) this.trailHold = Math.max(this.trailHold, TRAIL_HOLD_S);
    this.lastHp = hpF;
    this.hpFill.set(hpF);
    this.hpTrail.set(this.trail);
    this.hpPct.set(`${Math.ceil(hpF * 100)}%`);

    const down = !b.alive || b.hp <= 0;
    this.downOn.set(down);
    this.introOn.set(!down && b.introT > 0);

    // phase
    if (b.phase !== this.lastPhase) {
      const up = this.lastPhase > 0 && b.phase > this.lastPhase;
      this.lastPhase = b.phase;
      this.phaseT.set(String(b.phase));
      this.plate.dataset.phase = String(b.phase);
      if (up) {
        pulse(this.phaseBox, [
          { transform: 'scale(1.9) rotate(-8deg)', background: '#e63946' },
          { transform: 'scale(0.9) rotate(2deg)', offset: 0.55 },
          { transform: 'scale(1) rotate(0deg)' },
        ], 760);
        if (!flashesReduced()) pulse(this.hpBar, [{ filter: 'brightness(2.2)' }, { filter: 'none' }], 520);
      }
    }

    // meter (STRAIN / FRACTURE) — segmented, the next segment "hot" while filling
    const m = Math.max(0, Math.min(1, b.meter || 0));
    const segsOn = Math.floor(m * METER_SEGS + 1e-6);
    if (segsOn !== this.lastSegs) {
      this.lastSegs = segsOn;
      for (let i = 0; i < METER_SEGS; i++) this.segs[i].set(i < segsOn);
    }
    this.meterPct.set(`${Math.floor(m * 100)}%`);
    this.hotOn.set(m >= 0.8 && b.staggerT <= 0);

    // stagger
    const stag = b.staggerT > 0 && !down;
    this.staggerOn.set(stag);
    if (stag !== this.lastStagger) {
      this.lastStagger = stag;
      this.meterLbl.set(stag ? STR.boss.staggered : def.meterName);
      if (stag) pulse(this.plate, [
        { transform: 'translateX(0)' }, { transform: 'translateX(-1.2%)' }, { transform: 'translateX(1%)' },
        { transform: 'translateX(-0.5%)' }, { transform: 'translateX(0)' },
      ], 420);
    }

    // subtitle: sim-authored mechanic hint; intro / defeat override
    let sub = b.subtitle || bossSubtitle(b.id, b.attack);
    if (down) sub = STR.boss.defeated;
    else if (b.introT > 0) sub = STR.boss.approaching;
    if (sub !== this.lastSub) {
      const had = this.lastSub !== '';
      this.lastSub = sub;
      this.subT.set(sub);
      this.subBox.classList.toggle('attack', !!b.attack && !down);
      if (had) pulse(this.subBox, [
        { transform: 'translateY(40%)', opacity: 0 },
        { transform: 'translateY(0)', opacity: 1 },
      ], 240);
    }
  }

  hide(): void {
    if (!this.shown) return;
    this.shown = false;
    this.layer.classList.add('bt-hidden');
  }
}
