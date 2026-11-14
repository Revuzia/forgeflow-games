// BLOCKTOOTH ONLINE VS — the VS HUD (lane B-VIEW; vs_design.md §3, §6.2, §11, §12).
//
//   top centre   phase stamp (OPEN HOUSE / HOSTILE TAKEOVER / FINAL NOTICE / LAST CALL) + the match clock + "NEXT PHASE IN"
//   left         4 SEAT CARDS (portrait, name + YOU chip on your own seat, LV, SIZE numeral, evictions, HP bar, FRONT PAGE crown),
//                ordered live by standing (level, then XP); EVICTED / OUT states ride the card
//   right        KO feed (evictions, eliminations, crown changes, tenders, the ring) and the MINIMAP (rotated to the
//                camera's 45 degrees: rivals, tenders, power-ups, the cordon, the FRONT PAGE star; M enlarges it)
//   in the world nameplates over each rival (name, size, LV, HP; a pip when it is a speck on screen), edge arrows for
//                off-screen rivals, PUBLIC TENDER chips, "NO CONTEST" pops on OPEN HOUSE shoves
//   centre       phase banners, the 5-4-3-2-1 countdown, the EVICTED / BACK IN n stamp, the OUTSIDE THE CORDON warning
//   bottom       the SPECTATE bar (Q / E cycle, M map, ESC leave) once the local seat is out
//
// Reads World.players[i] / World.vs and the events; never writes the sim. Per-frame writes go through TextSlot / VarSlot /
// ClassSlot (change-only) and transforms; the minimap redraws at 10 Hz.

import './vs.css';
import type { SimEvent, TitanId, World } from '../core/types.ts';
import { CITY, VS } from '../core/config.ts';
import { VS_BANNER, VS_NEXT, VS_RULE, VS as STR_VS, VS_TENDER_NAME, fmtMatchClock, titanTag, vsFmt } from '../data/strings_vs.ts';
import { TITANS } from '../data/titans.ts';
import { ClassSlot, TextSlot, VarSlot, clearEl, div, el, pulse, roman } from './dom.ts';
import { safeRect, type VsAnchor, type VsFrame, type VsMatchInfo, type VsTenderAnchor } from './vstypes.ts';
import type { VsPhase } from '../vs/types.ts';

export interface VsHudCtx {
  /** the local human's seat */
  local: number;
  /** the local seat is out / the view follows another seat: hide own-body widgets, show the spectate bar */
  spectating: boolean;
}

interface SeatCard {
  root: HTMLElement;
  name: TextSlot; chip: HTMLElement; crown: HTMLElement; lv: TextSlot; size: TextSlot; ev: TextSlot;
  hp: VarSlot; state: TextSlot; down: ClassSlot; out: ClassSlot;
}
interface Plate {
  root: HTMLElement; card: HTMLElement;
  name: TextSlot; size: TextSlot; sub: TextSlot; hp: VarSlot; ptr: HTMLElement; dist: TextSlot; init: TextSlot;
  on: ClassSlot; tiny: ClassSlot; edge: ClassSlot; crowned: ClassSlot;
  x: number; y: number; ang: number;
}
interface TChip { root: HTMLElement; text: TextSlot; sub: TextSlot; on: ClassSlot; edge: ClassSlot; x: number; y: number; ang: number; w: number; sig: string }

const FEED_MAX = 6;
const FEED_LIFE_S = 9;
const BANNER_MS = 3400;
/** the phase banner's fade-in (CRIT: ~1 s, not a slam) */
const BANNER_FADE_IN_MS = 1000;
const MAP_HZ = 10;
const COS45 = Math.SQRT1_2;

const PHASE_ORDER: Record<VsPhase, number> = { countdown: 0, open: 1, takeover: 2, final: 3, last: 4, over: 5 };

export class VsHud {
  private readonly root: HTMLElement;
  private readonly layer: HTMLDivElement;
  /** world-attached pieces (nameplates, edge arrows, tender chips, NO CONTEST pops): their own layer UNDER the HUD (z 8 < 10) */
  private readonly worldLayer: HTMLDivElement;
  private info: VsMatchInfo | null = null;
  private world: World | null = null;
  private shown = false;
  // top bar
  private readonly phaseT: TextSlot;
  private readonly clockT: TextSlot;
  private readonly nextT: TextSlot;
  private readonly ruleT: TextSlot;
  // seats
  private readonly seatsBox: HTMLElement;
  private cards: SeatCard[] = [];
  // feed
  private readonly feed: HTMLElement;
  private readonly feedLines: { node: HTMLElement; born: number }[] = [];
  // minimap
  private readonly mini: HTMLElement;
  private readonly miniLbl: HTMLElement;
  private readonly cv: HTMLCanvasElement;
  private readonly cx: CanvasRenderingContext2D | null;
  private u = 12.8;
  private mapAcc = 0;
  private mapBig = false;
  private mapW = 0;
  private mapH = 0;
  // plates
  private readonly plates: HTMLElement;
  private plateNodes: Plate[] = [];
  private tchips: TChip[] = [];
  private popCd = 0;
  // centre stuff
  private readonly banner: HTMLElement;
  private readonly bannerT: TextSlot;
  private readonly bannerS: TextSlot;
  private bannerLeft = 0;
  private readonly count: HTMLElement;
  private readonly countT: TextSlot;
  private readonly stamp: HTMLElement;
  private readonly stampT: TextSlot;
  private readonly stampS: TextSlot;
  private readonly spec: HTMLElement;
  private readonly specName: TextSlot;
  private readonly specPlace: TextSlot;
  private readonly warn: HTMLElement;
  private readonly warnOn: ClassSlot;
  // state
  private lastPhase: VsPhase | '' = '';
  private lastCountN = -1;
  private crown = -1;
  private crownPrev = -1;
  private evictInfo: { killer: number; levels: number } | null = null;
  private clock = 0;
  /** a world-point projector (VsView.projectPoint): filled by the app */
  project: ((x: number, y: number, z: number, out: { x: number; y: number }) => boolean) | null = null;
  /** spectate buttons (touch / mouse) */
  onSpectate: ((dir: number) => void) | null = null;
  onLeave: (() => void) | null = null;
  private readonly pt = { x: 0, y: 0 };

  constructor(root: HTMLElement) {
    this.root = root;
    // created FIRST so it sits below the HUD layer in the DOM too (z-index 8 below the HUD's 10; markers are 9)
    this.worldLayer = div('bt-layer bt-vs-world bt-hidden', root);
    const L = this.layer = div('bt-layer bt-vs bt-hidden', root);
    L.dataset.v2 = 'vs-hud';

    // ── phase bar ──
    const top = div('bt-vs-top', L);
    this.phaseT = new TextSlot(el('span'));
    div('bt-vs-phase', top).appendChild(this.phaseT.node);
    this.clockT = new TextSlot(div('bt-vs-clock', top));
    const nx = div('bt-vs-next', top);
    this.nextT = new TextSlot(el('span'));
    this.ruleT = new TextSlot(el('span', 'bt-vs-rule'));
    nx.appendChild(this.nextT.node);
    nx.appendChild(document.createElement('br'));
    nx.appendChild(this.ruleT.node);

    this.seatsBox = div('bt-vs-seats', L);
    this.feed = div('bt-vs-feed', L);
    this.mini = div('bt-vs-mini', L);
    this.miniLbl = div('bt-vs-mini-lbl', this.mini, 'CITY MAP');
    this.cv = document.createElement('canvas');
    this.mini.appendChild(this.cv);
    this.cx = this.cv.getContext('2d');
    this.plates = div('bt-vs-plates', this.worldLayer);

    // ── centre ──
    this.banner = div('bt-vs-banner', L);
    const bt = div('bt-vs-banner-t', this.banner);
    this.bannerT = new TextSlot(el('span'));
    bt.appendChild(this.bannerT.node);
    this.bannerS = new TextSlot(div('bt-vs-banner-s', this.banner));
    this.count = div('bt-vs-count', L);
    this.countT = new TextSlot(this.count);
    this.stamp = div('bt-vs-stamp', L);
    this.stampT = new TextSlot(el('b'));
    this.stamp.appendChild(this.stampT.node);
    this.stampS = new TextSlot(el('span'));
    this.stamp.appendChild(this.stampS.node);
    this.warn = div('bt-vs-warn', L);
    this.warn.appendChild(el('span', '', STR_VS.outsideRing));
    this.warnOn = new ClassSlot(this.warn, 'on');

    // ── spectate bar ──
    this.spec = div('bt-vs-spec', L);
    const prev = el('button', 'bt-btn-mini', '◀ Q');
    prev.type = 'button'; prev.tabIndex = -1;
    prev.addEventListener('mousedown', (e) => e.preventDefault());
    prev.addEventListener('click', () => { if (this.onSpectate) this.onSpectate(-1); });
    this.spec.appendChild(prev);
    this.specPlace = new TextSlot(el('i', 'bt-vs-spec-place'));
    this.spec.appendChild(this.specPlace.node);
    const mid = div('', this.spec);
    mid.appendChild(document.createTextNode(STR_VS.spectating + ' '));
    this.specName = new TextSlot(el('b'));
    mid.appendChild(this.specName.node);
    const next = el('button', 'bt-btn-mini', 'E ▶');
    next.type = 'button'; next.tabIndex = -1;
    next.addEventListener('mousedown', (e) => e.preventDefault());
    next.addEventListener('click', () => { if (this.onSpectate) this.onSpectate(1); });
    this.spec.appendChild(next);
    const map = el('button', 'bt-btn-mini', STR_VS.mapKey);
    map.type = 'button'; map.tabIndex = -1;
    map.addEventListener('mousedown', (e) => e.preventDefault());
    map.addEventListener('click', () => this.toggleMap());
    this.spec.appendChild(map);
    const leave = el('button', 'bt-btn-mini', STR_VS.leaveKey);
    leave.type = 'button'; leave.tabIndex = -1;
    leave.addEventListener('mousedown', (e) => e.preventDefault());
    leave.addEventListener('click', () => { if (this.onLeave) this.onLeave(); });
    this.spec.appendChild(leave);

    const unit = (): number => Math.max(8, Math.min(window.innerWidth / 100, (window.innerHeight * 1.7778) / 100));
    this.u = unit();
    window.addEventListener('resize', () => { this.mapW = 0; this.u = unit(); });
  }

  show(on: boolean): void {
    this.shown = on;
    this.layer.classList.toggle('bt-hidden', !on);
    this.worldLayer.classList.toggle('bt-hidden', !on);
    try { document.body.dataset.vs = on ? '1' : ''; } catch { /* no DOM */ }
  }

  get visible(): boolean { return this.shown; }

  /** M: enlarge / shrink the minimap (also bound to the key by the app) */
  toggleMap(): void {
    this.mapBig = !this.mapBig;
    this.mini.classList.toggle('big', this.mapBig);
    this.mapW = 0;
    this.mapAcc = 1;
  }

  /** a fresh match: build the seat cards + nameplate pool and reset every cache */
  mount(w: World, info: VsMatchInfo, portraits: Partial<Record<TitanId, string>>): void {
    this.world = w;
    this.info = info;
    clearEl(this.seatsBox); clearEl(this.plates); clearEl(this.feed);
    this.cards = []; this.plateNodes = []; this.tchips = []; this.feedLines.length = 0;
    this.lastPhase = ''; this.lastCountN = -1; this.crown = -1; this.evictInfo = null; this.bannerLeft = 0;
    this.banner.classList.remove('on'); this.count.classList.remove('on'); this.stamp.classList.remove('on');
    this.mapBig = false; this.mini.classList.remove('big'); this.mapW = 0; this.mapAcc = 1;
    for (const s of info.seats) {
      const card = div('bt-vs-seat' + (s.slot === info.local ? ' local' : ''), this.seatsBox);
      card.style.setProperty('--seat', s.color);
      card.dataset.slot = String(s.slot);
      card.dataset.v2 = 'vs-seat';
      const ph = el('img', 'bt-vs-seat-ph');
      ph.alt = '';
      const url = portraits[s.titan];
      if (url) ph.src = url;
      card.appendChild(ph);
      const main = div('bt-vs-seat-main', card);
      const nm = div('bt-vs-seat-name', main);
      const nameB = el('b');
      nm.appendChild(nameB);
      // only YOUR seat carries a chip: every rival reads as a player (name + titan), whoever or whatever drives the seat
      const chip = el('span', 'bt-vs-chip you', STR_VS.you);
      if (s.slot !== info.local) chip.classList.add('bt-hidden');
      nm.appendChild(chip);
      const crown = el('span', 'bt-vs-chip crown bt-hidden', '★ ' + STR_VS.crown);
      nm.appendChild(crown);
      const meta = div('bt-vs-seat-meta', main);
      meta.appendChild(el('small', '', 'LV'));
      const lv = el('span');
      meta.appendChild(lv);
      const size = el('i');
      meta.appendChild(size);
      const ev = el('small');
      meta.appendChild(ev);
      const hpBar = div('bt-vs-seat-hp', main);
      const hpFill = el('b');
      hpBar.appendChild(hpFill);
      const st = div('bt-vs-seat-state', card);
      this.cards.push({
        root: card, name: new TextSlot(nameB), chip, crown, lv: new TextSlot(lv), size: new TextSlot(size), ev: new TextSlot(ev),
        hp: new VarSlot(hpFill, '--p', 0.01), state: new TextSlot(st), down: new ClassSlot(card, 'down'), out: new ClassSlot(card, 'out'),
      });
      nameB.textContent = s.name;
      // nameplate (rivals only get shown; the pool is per seat so a spectate switch needs no rebuild)
      const pl = div('bt-vs-plate', this.plates);
      pl.style.setProperty('--seat', s.color);
      const pip = div('bt-vs-pip', pl);
      void pip;
      const pc = div('bt-vs-plate-card', pl);
      const top = div('bt-vs-plate-top', pc);
      const pn = el('b'); top.appendChild(pn);
      const psz = el('i'); top.appendChild(psz);
      const psub = div('bt-vs-plate-sub', pc);
      const php = div('bt-vs-plate-hp', pc);
      const phf = el('b'); php.appendChild(phf);
      const ar = div('bt-vs-arrow', pl);
      const disc = div('bt-vs-arrow-disc', ar);
      const ini = el('span'); disc.appendChild(ini);
      const dist = el('small'); disc.appendChild(dist);
      const ptr = div('bt-vs-arrow-ptr', ar);
      this.plateNodes.push({
        root: pl, card: pc, name: new TextSlot(pn), size: new TextSlot(psz), sub: new TextSlot(psub), hp: new VarSlot(phf, '--p', 0.01),
        ptr, dist: new TextSlot(dist), init: new TextSlot(ini),
        on: new ClassSlot(pl, 'on'), tiny: new ClassSlot(pl, 'tiny'), edge: new ClassSlot(pl, 'edge'), crowned: new ClassSlot(pl, 'crowned'),
        x: NaN, y: NaN, ang: NaN,
      });
    }
    for (let i = 0; i < 3; i++) {
      const c = div('bt-vs-tchip', this.plates);
      const inner = div('', c);
      const t = el('span'); inner.appendChild(t);
      const sub = el('small'); inner.appendChild(sub);
      this.tchips.push({ root: c, text: new TextSlot(t), sub: new TextSlot(sub), on: new ClassSlot(c, 'on'), edge: new ClassSlot(c, 'edge'), x: NaN, y: NaN, ang: NaN, w: 0, sig: '' });
    }
    this.sortSeats(w);
  }

  /** ONLINE: the seats' names changed (a player joined a seat mid-match) */
  refreshSeats(): void {
    const info = this.info;
    if (!info) return;
    for (let i = 0; i < this.cards.length; i++) {
      const s = info.seats[i], cd = this.cards[i];
      if (!s || !cd) continue;
      cd.name.set(s.name);
      cd.chip.textContent = STR_VS.you;
      cd.chip.className = 'bt-vs-chip you' + (s.slot !== info.local ? ' bt-hidden' : '');
    }
  }

  clear(): void {
    this.world = null; this.info = null;
    clearEl(this.seatsBox); clearEl(this.plates); clearEl(this.feed);
    this.cards = []; this.plateNodes = []; this.tchips = []; this.feedLines.length = 0;
    this.banner.classList.remove('on'); this.count.classList.remove('on'); this.stamp.classList.remove('on'); this.spec.classList.remove('on');
    this.warnOn.set(false);
  }

  // ─────────────────────────────── per frame ───────────────────────────────

  update(w: World, dt: number, fr: VsFrame, c: VsHudCtx): void {
    const info = this.info;
    if (!this.shown || !info || w !== this.world || !w.vs) return;
    const d = Math.min(0.1, Math.max(0, dt || 0));
    const V = w.vs;
    const matchT = w.t - V.startT;
    this.clock = matchT;
    const phase = V.phase;
    this.layer.dataset.phase = phase;
    this.crownPrev = this.crown;   // the crown as of last frame: an `evicted` event is read against it (HEADLINE STOLEN)

    // phase bar
    this.phaseT.set(VS_BANNER[phase].title);
    this.clockT.set(phase === 'countdown' ? '0:00' : fmtMatchClock(matchT));
    let next = '';
    const P = VS.phase;
    const left = phase === 'open' ? P.openEndS - matchT : phase === 'takeover' ? P.takeoverEndS - matchT
      : phase === 'final' ? P.finalEndS - matchT : phase === 'last' ? P.hardEndS - matchT : -1;
    if (left >= 0 && VS_NEXT[phase]) next = VS_NEXT[phase] + ' ' + fmtMatchClock(Math.ceil(left));
    this.nextT.set(next || ' ');
    this.ruleT.set(VS_RULE[phase]);

    // banner + feed line on a phase change (works for a real sim and the fixture alike)
    if (phase !== this.lastPhase) {
      const first = this.lastPhase === '';
      this.lastPhase = phase;
      if (phase !== 'over') this.showBanner(phase);
      if (!first && phase !== 'countdown' && phase !== 'over') this.pushLine(vsFmt(STR_VS.feed.phase, { title: VS_BANNER[phase].title }), '#ffd166', 'gold');
    }
    if (this.bannerLeft > 0) {
      this.bannerLeft -= d * 1000;
      if (this.bannerLeft <= 0) { this.bannerLeft = 0; this.banner.classList.remove('on'); }
    }

    // countdown
    if (phase === 'countdown') {
      const rem = Math.max(0, V.startT - w.t);
      const n = Math.ceil(rem - 1e-6);
      if (n !== this.lastCountN) {
        this.lastCountN = n;
        this.countT.set(n > 0 ? String(n) : STR_VS.go);
        this.count.classList.add('on');
        pulse(this.count, [{ transform: 'translate(-50%, 0) scale(1.5)', opacity: 0 }, { transform: 'translate(-50%, 0) scale(1)', opacity: 1 }], 380);
      }
    } else if (this.lastCountN !== -2) {
      if (this.lastCountN > -1) { this.countT.set(STR_VS.go); pulse(this.count, [{ opacity: 1 }, { opacity: 0 }], 700); setTimeout(() => this.count.classList.remove('on'), 650); }
      this.lastCountN = -2;
    }

    // seat cards
    this.updateCards(w, info);
    this.sortSeats(w);

    // own-seat stamps / warnings
    const me = w.players[c.local];
    const myVs = me ? me.vs : null;
    let stampOn = false;
    if (me && myVs && phase !== 'countdown' && phase !== 'over' && !c.spectating) {
      if (myVs.eliminated) {
        stampOn = true;
        this.stampT.set(vsFmt(STR_VS.eliminatedYou, { place: STR_VS.place[Math.max(0, Math.min(3, (myVs.place || 4) - 1))] }));
        this.stampS.set(' ');
      } else if (!me.titan.alive) {
        stampOn = true;
        const ei = this.evictInfo;
        const lv = ei ? ei.levels : VS.ko.levelsLost;
        this.stampT.set(vsFmt(STR_VS.backIn, { n: Math.max(0, Math.ceil(myVs.respawnT - w.t - 1e-6)) }));
        const lvTxt = lv > 0 ? ' — −' + lv + ' LV' : '';
        this.stampS.set(ei && ei.killer >= 0 && ei.killer !== c.local
          ? vsFmt(STR_VS.evictedBy, { a: this.who(ei.killer), lv: lvTxt }) : vsFmt(STR_VS.evictedAlone, { lv: lvTxt }));
      }
    }
    this.stamp.classList.toggle('on', stampOn);
    let outside = false;
    if (me && me.titan.alive && !(myVs && myVs.eliminated) && (phase === 'final' || phase === 'last') && V.ring.step >= 0) {
      outside = Math.hypot(me.titan.x - V.ring.cx, me.titan.z - V.ring.cz) > V.ring.r;
    }
    this.warnOn.set(outside && !c.spectating);

    // spectate bar
    const specOn = c.spectating && phase !== 'over';
    this.spec.classList.toggle('on', specOn);
    if (specOn) {
      this.specPlace.set(myVs && myVs.eliminated ? vsFmt(STR_VS.eliminatedYou, { place: STR_VS.place[Math.max(0, Math.min(3, (myVs.place || 4) - 1))] }) : STR_VS.out);
      const s = info.seats[w.view];
      if (s) { this.specName.set(titanTag(s.titan) + (s.slot === info.local ? '' : ' · ' + s.name)); this.spec.style.setProperty('--seat', s.color); }
    }

    // feed lifetime
    const now = performance.now();
    for (let i = this.feedLines.length - 1; i >= 0; i--) {
      const f = this.feedLines[i];
      const age = (now - f.born) / 1000;
      if (age > FEED_LIFE_S) { f.node.remove(); this.feedLines.splice(i, 1); }
      else if (age > FEED_LIFE_S - 0.6) f.node.classList.add('fade');
    }
    if (this.popCd > 0) this.popCd -= d;

    // nameplates + tender chips
    this.updatePlates(w, info, fr, c);

    // minimap
    this.mapAcc += d;
    if (this.mapAcc >= 1 / MAP_HZ) { this.mapAcc = 0; this.drawMap(w, info, c); }
  }

  private who(slot: number): string {
    const info = this.info;
    if (!info) return '?';
    if (slot === info.local) return STR_VS.you;
    const s = info.seats[slot];
    return s ? titanTag(s.titan) : '?';
  }

  private seatColor(slot: number): string {
    const s = this.info ? this.info.seats[slot] : null;
    return s ? s.color : '#ffd166';
  }

  private showBanner(phase: VsPhase): void {
    const B = VS_BANNER[phase];
    this.bannerT.set(B.title);
    this.bannerS.set(B.sub);
    this.layer.dataset.ban = phase;
    this.banner.style.setProperty('--ph', phase === 'open' ? 'var(--teal)' : phase === 'takeover' ? 'var(--red)' : phase === 'final' ? '#ffc21a' : phase === 'last' ? '#ff3b3b' : '#6b5a8e');
    this.banner.classList.add('on');
    this.bannerLeft = BANNER_MS;
    // the big ghost banner FADES IN over ~1 s from the phase start (it used to slam in within 0.3 s over the fight), holds, then fades out
    const fadeIn = Math.min(0.5, BANNER_FADE_IN_MS / BANNER_MS);
    pulse(this.banner, [
      { transform: 'scale(1.12)', opacity: 0 },
      { transform: 'scale(1)', opacity: 0.88, offset: fadeIn },
      { transform: 'scale(1)', opacity: 0.88, offset: 0.82 },
      { transform: 'scale(.97)', opacity: 0 },
    ], BANNER_MS, 'ease-out');
  }

  private pushLine(text: string, color: string, cls = ''): void {
    const n = div('bt-vs-line' + (cls ? ' ' + cls : ''), this.feed, text);
    n.style.setProperty('--seat', color);
    this.feedLines.push({ node: n, born: performance.now() });
    while (this.feedLines.length > FEED_MAX) { const f = this.feedLines.shift(); if (f) f.node.remove(); }
  }

  private updateCards(w: World, info: VsMatchInfo): void {
    const V = w.vs;
    if (!V) return;
    const crown = V.phase === 'countdown' || V.phase === 'open' ? -1 : V.crown;
    for (let i = 0; i < this.cards.length; i++) {
      const cd = this.cards[i], P = w.players[i], s = info.seats[i];
      if (!P || !s) continue;
      const T = P.titan;
      cd.lv.set(String(T.level));
      cd.size.set(roman(T.rank));
      const hp = T.maxHp > 0 ? Math.max(0, Math.min(1, T.hp / T.maxHp)) : 0;
      cd.hp.set(T.alive ? hp : 0);
      // KOs n = knock-outs this seat scored; OUT xn = times it was knocked out (the old "EV n" / "KO n" read the same to a player)
      const kos = P.vs.evictions, outs = P.vs.koCount;
      cd.ev.set(kos > 0 || outs > 0 ? [kos > 0 ? vsFmt(STR_VS.kos, { n: kos }) : '', outs > 0 ? vsFmt(STR_VS.outTimes, { n: outs }) : ''].filter(Boolean).join(' · ') : ' ');
      cd.crown.classList.toggle('bt-hidden', i !== crown || P.vs.eliminated);
      const out = P.vs.eliminated;
      const down = !out && !T.alive;
      cd.out.set(out);
      cd.down.set(down);
      if (out) cd.state.set(P.vs.place > 0 ? STR_VS.place[Math.min(3, P.vs.place - 1)] + ' · ' + STR_VS.out : STR_VS.out);
      else if (down) cd.state.set(STR_VS.evicted + ' ' + Math.max(0, Math.ceil(P.vs.respawnT - w.t - 1e-6)));
    }
    this.crown = crown;
  }

  /** standings order: alive seats by level then XP progress, then the knocked-out ones by place */
  private sortSeats(w: World): void {
    const n = this.cards.length;
    const key: number[] = [];
    for (let i = 0; i < n; i++) {
      const P = w.players[i];
      if (!P) { key.push(1e9); continue; }
      if (P.vs.eliminated) { key.push(1e6 + (P.vs.place > 0 ? P.vs.place : 9) * 10 + i); continue; }
      const T = P.titan;
      const frac = T.xpToNext > 0 ? Math.min(0.999, T.xp / T.xpToNext) : 0;
      key.push(-(T.level * 1000 + frac * 999) + i * 1e-3);
    }
    const idx = key.map((_, i) => i).sort((a, b) => key[a] - key[b]);
    for (let r = 0; r < idx.length; r++) {
      const st = this.cards[idx[r]].root.style;
      const v = String(r);
      if (st.order !== v) st.order = v;
    }
  }

  private updatePlates(w: World, info: VsMatchInfo, fr: VsFrame, c: VsHudCtx): void {
    const V = w.vs;
    if (!V) return;
    const pitch = CITY.pitch;
    for (let i = 0; i < this.plateNodes.length; i++) {
      const pn = this.plateNodes[i], P = w.players[i], an: VsAnchor | undefined = fr.seats[i], s = info.seats[i];
      if (!P || !an || !s || i === w.view || !an.live) { pn.on.set(false); continue; }
      const T = P.titan;
      pn.on.set(true);
      const edge = !an.onScreen;
      pn.edge.set(edge);
      pn.tiny.set(!edge && an.pxH > 0 && an.pxH < 30);
      pn.crowned.set(i === this.crown);
      pn.name.set(s.name);
      pn.size.set(roman(T.rank));
      pn.sub.set(titanTag(s.titan) + ' · LV ' + T.level);
      pn.hp.set(T.maxHp > 0 ? Math.max(0, Math.min(1, T.hp / T.maxHp)) : 0);
      if (edge) {
        pn.init.set(titanTag(s.titan).slice(0, 1));
        pn.dist.set((an.distM / pitch).toFixed(1) + ' BLK');
        if (!(Math.abs(pn.ang - an.angle) <= 0.01)) { pn.ang = an.angle; pn.ptr.style.setProperty('--ang', an.angle.toFixed(3) + 'rad'); }
      }
      // an on-screen card stays inside the safe rectangle (never on the clock / seat column / minimap); edge arrows come clamped from VsView
      let px = an.x, py = an.y;
      if (!edge) {
        const R = safeRect(window.innerWidth, window.innerHeight, this.u);
        const u = this.u;
        px = Math.min(R.r - 4.6 * u, Math.max(R.l + 4.6 * u, px));
        py = Math.min(R.b, Math.max(R.t + 5.2 * u, py));
      }
      if (!(Math.abs(pn.x - px) <= 0.5) || !(Math.abs(pn.y - py) <= 0.5)) {
        pn.x = px; pn.y = py;
        pn.root.style.transform = 'translate3d(' + px.toFixed(1) + 'px,' + py.toFixed(1) + 'px,0)';
      }
    }
    for (let i = 0; i < this.tchips.length; i++) {
      const ch = this.tchips[i], an: VsTenderAnchor | undefined = fr.tenders[i], T = V.tenders[i];
      const live = !!T && !!an && (T.state === 'marker' || T.state === 'live') && T.markerT >= 0;
      if (!live || !an) { ch.on.set(false); continue; }
      ch.on.set(true);
      ch.edge.set(!an.onScreen);
      const name = VS_TENDER_NAME[T.gate] ?? String(T.gate).toUpperCase();
      ch.text.set('PUBLIC TENDER · ' + name);
      const lead = T.state === 'marker' ? Math.max(0, Math.ceil(VS.tender.markerLeadS - (w.t - T.markerT))) : 0;
      ch.sub.set(T.state === 'marker' ? lead + ' S' : 'LIVE · ' + (an.distM / pitch).toFixed(1) + ' BLK');
      if (!an.onScreen && !(Math.abs(ch.ang - an.angle) <= 0.01)) { ch.ang = an.angle; ch.root.style.setProperty('--ang', an.angle.toFixed(3) + 'rad'); }
      // the chip lives INSIDE the safe rectangle: below the phase strip, clear of the seat column / KO feed / minimap / bottom panels
      const u = this.u;
      const R = safeRect(window.innerWidth, window.innerHeight, u);
      if (ch.w <= 0 || ch.sig !== ch.text.node.textContent + '|' + ch.sub.node.textContent) {
        ch.sig = ch.text.node.textContent + '|' + ch.sub.node.textContent;
        const inner = ch.root.firstElementChild as HTMLElement | null;
        ch.w = inner ? inner.offsetWidth : 12 * u;
      }
      const half = ch.w / 2 + 0.8 * u;
      const cx = Math.max(R.l + half, Math.min(R.r - half, an.x));
      const cy = Math.max(R.t + 1.6 * u, Math.min(R.b, an.y));
      if (!(Math.abs(ch.x - cx) <= 0.5) || !(Math.abs(ch.y - cy) <= 0.5)) {
        ch.x = cx; ch.y = cy;
        ch.root.style.transform = 'translate3d(' + cx.toFixed(1) + 'px,' + cy.toFixed(1) + 'px,0)';
      }
    }
    void c;
  }

  // ─────────────────────────────── events ───────────────────────────────

  onEvents(w: World, ev: readonly SimEvent[], c: VsHudCtx): void {
    const info = this.info;
    if (!info || w !== this.world) return;
    for (let i = 0; i < ev.length; i++) {
      const e = ev[i];
      switch (e.type) {
        case 'evicted': {
          const victimCrown = e.victim === this.crownPrev;
          const mine = e.victim === c.local;
          const levels = e.levelsLost;
          if (victimCrown && e.killer >= 0 && e.killer !== e.victim) {
            this.pushLine(vsFmt(STR_VS.feed.headline, { a: this.who(e.killer) }), this.seatColor(e.killer), 'gold');
          }
          if (e.killer >= 0 && e.killer !== e.victim) {
            this.pushLine(vsFmt(mine ? STR_VS.feed.evictedBy : STR_VS.feed.evicted, { a: this.who(e.killer), b: this.who(e.victim), lv: levels > 0 ? ' · −' + levels + ' LV' : '' }),
              this.seatColor(e.killer), mine ? 'mine' : e.killer === c.local ? 'good' : '');
          } else {
            this.pushLine(vsFmt('{b} EVICTED{lv}', { b: this.who(e.victim), lv: levels > 0 ? ' · −' + levels + ' LV' : '' }), this.seatColor(e.victim), mine ? 'mine' : '');
          }
          for (const a of e.assists) if (a !== e.killer && a !== e.victim) this.pushLine(vsFmt(STR_VS.feed.assist, { a: this.who(a) }), this.seatColor(a));
          if (mine) this.evictInfo = { killer: e.killer, levels };
          break;
        }
        case 'eliminated': {
          const place = STR_VS.place[Math.max(0, Math.min(3, e.place - 1))];
          const mine = e.victim === c.local;
          if (e.killer >= 0 && e.killer !== e.victim) {
            this.pushLine(vsFmt(STR_VS.feed.eliminatedBy, { a: this.who(e.killer), b: this.who(e.victim), place }), this.seatColor(e.killer), mine ? 'mine' : '');
          } else this.pushLine(vsFmt(STR_VS.feed.eliminated, { b: this.who(e.victim), place }), this.seatColor(e.victim), mine ? 'mine' : '');
          break;
        }
        case 'crown':
          if (e.holder >= 0) this.pushLine(vsFmt(STR_VS.feed.crown, { a: this.who(e.holder) }), '#ffd166', 'gold');
          else this.pushLine(STR_VS.feed.crownNone, '#ffd166');
          break;
        case 'tenderMarker':
          this.pushLine(vsFmt(STR_VS.feed.tenderMarker, { name: VS_TENDER_NAME[e.gate] ?? e.gate, t: Math.round(e.leadS) }), '#ffb12e');
          break;
        case 'tenderSpawn':
          this.pushLine(vsFmt(STR_VS.feed.tenderSpawn, { name: VS_TENDER_NAME[e.gate] ?? e.gate }), '#ffb12e');
          break;
        case 'tenderPaid':
          this.pushLine(vsFmt(STR_VS.feed.tenderPaid, { a: e.top >= 0 ? this.who(e.top) : '—', name: VS_TENDER_NAME[e.gate] ?? e.gate }), '#ffb12e', 'gold');
          break;
        case 'ringStep':
          this.pushLine(vsFmt(STR_VS.feed.ring, { n: e.step + 1 }), '#ff3b3b');
          break;
        case 'rivalHit':
          if (e.noContest && this.popCd <= 0 && this.project) {
            const vw = w.players[e.to] ? w.players[e.to].titan.height : 3;
            if (this.project(e.x, Math.max(1, vw * 0.7), e.z, this.pt)) {
              this.popCd = 0.4;
              const p = div('bt-vs-pop', this.plates, STR_VS.noContest);
              p.style.left = this.pt.x.toFixed(0) + 'px';
              p.style.top = this.pt.y.toFixed(0) + 'px';
              setTimeout(() => p.remove(), 1200);
            }
          }
          break;
        default: break;
      }
    }
  }

  // ─────────────────────────────── minimap ───────────────────────────────

  private drawMap(w: World, info: VsMatchInfo, c: VsHudCtx): void {
    const cx = this.cx, V = w.vs;
    if (!cx || !V) return;
    if (this.mapW === 0) {
      const u = Math.max(8, Math.min(window.innerWidth / 100, (window.innerHeight * 1.7778) / 100));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const cssPx = (this.mapBig ? 30 : 13) * u;
      this.mapW = this.mapH = Math.max(40, Math.round(cssPx * dpr));
      this.cv.width = this.mapW; this.cv.height = this.mapH;
    }
    const W = this.mapW, H = this.mapH;
    const B = w.city.bounds;
    const spanX = Math.max(1, B.maxX - B.minX), spanZ = Math.max(1, B.maxZ - B.minZ);
    const midX = (B.minX + B.maxX) / 2, midZ = (B.minZ + B.maxZ) / 2;
    const sc = (W * 0.94) / ((spanX + spanZ) * COS45);   // the rotated square's diagonal
    const k = W / 220;                                     // px scale for dots / lines
    cx.clearRect(0, 0, W, H);
    // city: standing buildings
    cx.save();
    cx.translate(W / 2, H / 2);
    cx.rotate(Math.PI / 4);
    cx.scale(sc, sc);
    cx.translate(-midX, -midZ);
    cx.fillStyle = 'rgba(18,30,56,0.9)';
    cx.fillRect(B.minX, B.minZ, spanX, spanZ);
    const bl = w.city.buildings;
    cx.fillStyle = 'rgba(132,150,190,0.7)';
    for (let i = 0; i < bl.length; i++) {
      const b = bl[i];
      if (b.collapsed || b.alive <= 0) continue;
      cx.fillRect(b.x - b.w / 2, b.z - b.d / 2, b.w, b.d);
    }
    cx.restore();
    const mx = (x: number, z: number): number => W / 2 + ((x - midX) * COS45 - (z - midZ) * COS45) * sc;
    const my = (x: number, z: number): number => H / 2 + ((x - midX) * COS45 + (z - midZ) * COS45) * sc;

    // ring: the next target (dashed) from minimapFromS, the live cordon with the condemned side tinted
    const matchT = w.t - V.startT;
    const R = V.ring;
    if (matchT >= VS.ring.minimapFromS - 1 || R.step >= 0) {
      cx.save();
      cx.lineWidth = Math.max(1.5, 2 * k);
      const rpx = R.r * sc;
      if (R.step >= 0) {
        cx.beginPath();
        cx.rect(0, 0, W, H);
        cx.arc(mx(R.cx, R.cz), my(R.cx, R.cz), rpx, 0, Math.PI * 2, true);
        cx.fillStyle = 'rgba(255,50,50,0.22)';
        cx.fill('evenodd');
        cx.beginPath();
        cx.arc(mx(R.cx, R.cz), my(R.cx, R.cz), rpx, 0, Math.PI * 2);
        cx.strokeStyle = '#ff4040';
        cx.stroke();
      }
      if (R.toR > 0 && R.toR < R.r - 1) {
        cx.setLineDash([4 * k, 3 * k]);
        cx.beginPath();
        cx.arc(mx(R.cx, R.cz), my(R.cx, R.cz), R.toR * sc, 0, Math.PI * 2);
        cx.strokeStyle = 'rgba(255,200,200,0.75)';
        cx.lineWidth = Math.max(1, 1.4 * k);
        cx.stroke();
      }
      cx.restore();
    }

    // power-ups
    const pus = w.map ? w.map.powerups : [];
    cx.fillStyle = '#ffffff';
    for (let i = 0; i < pus.length; i++) {
      const p = pus[i];
      if (!p.alive) continue;
      cx.fillRect(mx(p.x, p.z) - 1.5 * k, my(p.x, p.z) - 1.5 * k, 3 * k, 3 * k);
    }
    // tenders
    for (let i = 0; i < V.tenders.length; i++) {
      const T = V.tenders[i];
      if ((T.state !== 'marker' && T.state !== 'live') || T.markerT < 0) continue;
      const x = mx(T.x, T.z), y = my(T.x, T.z), r = 4.2 * k;
      cx.beginPath();
      cx.moveTo(x, y - r); cx.lineTo(x + r, y); cx.lineTo(x, y + r); cx.lineTo(x - r, y); cx.closePath();
      const blink = T.state === 'marker' && Math.floor(performance.now() / 300) % 2 === 0;
      cx.fillStyle = blink ? '#ffe9b0' : '#ffb12e';
      cx.fill();
      cx.strokeStyle = '#1b1426';
      cx.lineWidth = Math.max(1, k);
      cx.stroke();
    }
    // titans
    for (let i = 0; i < info.seats.length; i++) {
      const P = w.players[i], s = info.seats[i];
      if (!P || P.vs.eliminated) continue;
      const T = P.titan;
      const x = mx(T.x, T.z), y = my(T.x, T.z);
      const r = (3.6 + T.rank * 1.1) * k;
      cx.beginPath();
      cx.arc(x, y, r, 0, Math.PI * 2);
      cx.fillStyle = T.alive ? s.color : 'rgba(120,120,130,0.8)';
      cx.fill();
      cx.lineWidth = Math.max(1, 1.4 * k);
      cx.strokeStyle = i === w.view ? '#ffffff' : '#1b1426';
      cx.stroke();
      if (i === this.crown) {
        cx.fillStyle = '#ffd166';
        cx.font = 'bold ' + Math.round(11 * k) + 'px sans-serif';
        cx.textAlign = 'center';
        cx.fillText('★', x, y - r - 2 * k);
      }
    }
    void c;
  }

  /** the minimap label reads the biome name when a match is up */
  setCityName(name: string): void { this.miniLbl.textContent = name; }

  /** the app's raw clock (probes) */
  get matchClock(): number { return this.clock; }
}

// keep the TITANS import used for tooltips in later builds (portrait fallbacks read the def colours)
export function titanColor(id: TitanId): string { return TITANS[id] ? TITANS[id].colors.primary : '#ffffff'; }
