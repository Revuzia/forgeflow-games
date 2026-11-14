// HIT PARADE - the in-game CONTROLS BAR (lane UI; CONTRACT §36.2 + the §36.4 OWNER CLARIFICATION). Owned by the Hud
// (hud.ts creates it inside the HUD frame and feeds it every snapshot); game.ts connects it to the settings / pause.
//
//   * a slim two-row strip, bottom centre, for the LOCAL player(s) while fighting: key cap + ONE / TWO plain words per
//     cell. Row 1 = attacks (EASY: the fighter's three normals by name, SPECIAL 1-4 with the fighter's own special names,
//     SUPER, PRIME TIME; SIMPLE / CLASSIC: normals, SPECIAL, COMBO, SUPER, PRIME TIME), row 2 = MOVE, JUMP, STEP, BLOCK,
//     THROW, PARRY, IMPACT + "ESC  MORE" (opens the pause card's keyboard map = the expanded view).
//   * key caps from the live bindings (connect().labels, re-read on refresh(): a remap in SETTINGS shows on resume).
//   * SUPER / PRIME TIME lit when the player's SHOWTIME holds 1 / 3 bars, greyed otherwise (FighterSnap.showtime).
//   * F1 (input.ts UI action 'controls' -> game.ts -> toggle()) or the on-screen "?" chip toggles it; default ON,
//     remembered in settings.controlsBar (connect().enabled / .toggle). TRAINING opens every session with the bar shown
//     (CHANGED(wf8 fix) FT-10: F1 / the chip hide and show it there too, for that session only - HOW TO PLAY promises F1
//     works, and in TRAINING it did nothing). Touch mode shows no bar: the touch overlay's own "?" disc opens the touch
//     cheat sheet (pause card, help).
//   * CHANGED(wf8 fix) FT-01 / FT-04: the BLOCK cell carries its low half ("SHIFT BLOCK + S LOW"); EASY's row 1 gains
//     "N EX" (hold N with a special = the EX version), lit at 2 NERVE bars like SUPER / PRIME TIME at 1 / 3 SHOWTIME bars.
//     localOn(side) tells the Hud which side a local keyboard player plays, with their key caps and live input word (the
//     Hud's coach hints: LOW ATTACK / GRABBED).
//   * HUD-safe: the bar lives between the two RATINGS blocks and inside the bottom band the fight camera keeps the
//     fighters' feet out of (view/camera.ts bottomMargin 0.07 of the frame): fit() measures the room and steps down
//     full -> tight -> mini until both rows fit (the RATINGS bars narrow first when that is not enough); local 2P splits
//     the room, each player's keys on their own side. The camera's close shots (a counter-hit zoom, supers, KO) can still
//     drop a foot into the band: setFeet() (game.ts passes each fighter's lowest toe on screen, every frame) first FOLDS the
//     bar to its attack row (half the height) while a toe is in the band's upper half, and DUCKS it (gone at once) while a
//     toe is lower still; each comes back 0.35 s after the feet leave.

import type { MatchCfg, UiFighterSnap, UiGameData } from './types.ts';
import { barRows, fighterKit, labelsOf, type BarCell, type Labels, type SchemeN } from './controls.ts';
import { capChip } from './keymap.ts';
import { div, el, setText } from './dom.ts';
import { fighter } from './data.ts';
import { t } from './strings.ts';
import './controls.css';

export const SHOWTIME_BAR = 10000;
/** CHANGED(wf8 fix) FT-04: an EX special costs 2 NERVE bars (system.json nerve.bar 10000) */
export const EX_NERVE = 20000;
/** the fraction of the frame height the camera keeps the feet above (view/camera.ts CAM.bottomMargin) */
export const FEET_BAND = 0.07;
/** air between the lowest toe BONE (game.ts reads the foot bones) and the bar's top edge, as a fraction of the frame: the
 *  shoe's tip reaches a few px past the bone */
export const FEET_MARGIN = 0.006;
const DUCK_HOLD_MS = 350;

export interface BarPlayer { /** key set (input player) */ p: 0 | 1; /** screen side / sim slot it plays */ side: 0 | 1; fighter: string; scheme: SchemeN }
export interface BarHooks {
  /** a player's live key caps */
  labels(p: 0 | 1): Labels;
  /** settings.controlsBar */
  enabled(): boolean;
  /** flip settings.controlsBar (F1 / the chip) */
  toggle(): void;
  /** open the expanded view (the pause card's keyboard map) */
  help(): void;
  /** CHANGED(wf8 fix) FT-01: the live input word of key set p (input.ts Input#word), for the Hud's coach hints */
  word?(p: 0 | 1): number;
}

interface SideView { pl: BarPlayer; root: HTMLElement; rows: [HTMLElement, HTMLElement]; sup: HTMLElement | null; prime: HTMLElement | null; ex: HTMLElement | null; key: string }

export class ControlsBar {
  readonly root: HTMLElement;
  private readonly data: UiGameData;
  private readonly sidesBox: HTMLElement;
  private readonly chip: HTMLButtonElement;
  private hooks: BarHooks | null = null;
  private players: BarPlayer[] = [];
  private sides: SideView[] = [];
  private mounted = false;
  private training = false;
  private touch = false;
  private level = 0;
  private lit: Array<[boolean, boolean, boolean]> = [];
  /** CHANGED(wf8 fix) FT-10: TRAINING's own on / off (every session starts shown; F1 / the chip flip it) */
  private trainOn = true;
  private fitDirty = true;
  /** the last fit() found a level at which every row fits (read-back) */
  private fitOk = true;
  private refitTimer = 0;
  /** the bar's top edge as a fraction of the frame height (fit()), the duck state + its hold */
  private topFrac = 1 - FEET_BAND;
  /** the top edge when FOLDED to the attack row only (fit()) */
  private foldFrac = 1 - FEET_BAND / 2;
  private ducked = false;
  private duckUntil = 0;
  private folded = false;
  private foldUntil = 0;
  /** read-back: frames the bar ducked / folded for a foot in the band */
  ducks = 0;
  folds = 0;
  private readonly onResize = (): void => { this.fitDirty = true; };

  constructor(frame: HTMLElement, data: UiGameData) {
    this.data = data;
    this.root = div('hp-cbar', frame);
    this.root.id = 'hp-cbar';
    this.root.hidden = true;
    this.sidesBox = div('hp-cbar-sides', this.root);
    this.chip = el('button', 'hp-cbar-q');
    this.chip.type = 'button';
    this.chip.id = 'hp-cbar-toggle';
    this.chip.tabIndex = -1;
    this.chip.append(el('b', 'q', '?'), capChip('F1', 'system'));
    // a click must never leave focus on the chip (Space / Enter would then "click" it mid-fight)
    this.chip.addEventListener('pointerdown', (e) => e.preventDefault());
    this.chip.addEventListener('click', (e) => { e.preventDefault(); this.chip.blur(); this.toggle(); });
    this.root.append(this.chip);
    window.addEventListener('resize', this.onResize);
    // the fit measures real glyphs: measure again once the web fonts are in (the fallback faces are wider)
    try { void document.fonts?.ready.then(() => { this.fitDirty = true; }); } catch { /* no FontFaceSet */ }
  }

  /** game.ts: the settings / pause hooks (without them the bar shows the default keys and stays on) */
  connect(h: BarHooks): void { this.hooks = h; this.refresh(); }

  /** Hud.mount: the local human players of an offline bout (TRAINING: P1 only; bonus rounds: P1) */
  mount(cfg: MatchCfg): void {
    const training = cfg.mode === 'training';
    const bonus = cfg.mode === 'brawl' || cfg.mode === 'heckler';
    const pl: BarPlayer[] = [];
    for (const i of [0, 1] as const) {
      if (cfg.p[i].cpu >= 0) continue;
      if (i === 1 && (training || bonus || cfg.mode === 'online')) continue;
      pl.push({ p: i, side: i, fighter: cfg.p[i].fighter, scheme: (cfg.p[i].scheme === 1 || cfg.p[i].scheme === 0 ? cfg.p[i].scheme : 2) as SchemeN });
    }
    this.training = training;
    this.trainOn = true;
    this.mounted = true;
    this.setPlayers(pl);
  }

  /** game.ts (online): the one local player - key set 1 (P1's keys) playing sim slot `side` */
  setPlayers(pl: BarPlayer[]): void {
    this.players = pl.map((x) => ({ ...x }));
    this.lit = this.players.map(() => [false, false, false]);
    this.build();
  }

  unmount(): void { this.mounted = false; this.players = []; this.sides = []; this.sidesBox.replaceChildren(); this.root.parentElement?.classList.remove('cb-narrow'); this.sync(); }

  setTouchMode(on: boolean): void { this.touch = on; this.fitDirty = true; this.sync(); }

  /** F1 / the chip: flip the remembered setting (CHANGED(wf8 fix) FT-10: TRAINING flips its own session flag) */
  toggle(): boolean {
    if (this.touch || !this.mounted) return false;
    if (this.training) this.trainOn = !this.trainOn;
    else this.hooks?.toggle();
    this.sync();
    return true;
  }

  /**
   * CHANGED(wf8 fix) FT-01 / FT-11: the local keyboard player on sim side `side` - key set, key caps, live input word
   * (null: a CPU / the dummy / a remote player, or touch mode, where the caps would be wrong).
   */
  localOn(side: 0 | 1): { p: 0 | 1; scheme: SchemeN; labels: Labels; word: number } | null {
    if (!this.mounted || this.touch) return null;
    const pl = this.players.find((x) => x.side === side);
    if (!pl) return null;
    return { p: pl.p, scheme: pl.scheme, labels: this.hooks ? this.hooks.labels(pl.p) : labelsOf(null, pl.p), word: this.hooks?.word ? this.hooks.word(pl.p) : 0 };
  }

  /** CHANGED(ui): P1's first key cap for an action (the training input display's chips), null = unbound */
  cap(action: string): string | null {
    if (this.touch) return null;                          // touch: the PAD's own letters (L / M / H / SP)
    const labels = this.hooks ? this.hooks.labels(0) : labelsOf(null, 0);
    return (labels as Record<string, { keys: string[] }>)[action]?.keys?.[0] ?? null;
  }

  /** bindings / settings changed: rebuild the caps and re-apply the setting */
  refresh(): void { this.build(); }

  get visible(): boolean { return !this.root.hidden && !this.root.classList.contains('off'); }

  /** per rendered frame (Hud.frame): SUPER / PRIME TIME lit from each player's SHOWTIME, CHANGED(wf8 fix) EX from NERVE */
  frame(f: readonly [UiFighterSnap, UiFighterSnap]): void {
    if (!this.mounted || this.root.hidden) return;
    if (this.fitDirty) this.fit();
    this.sides.forEach((s, k) => {
      const st = f[s.pl.side]?.showtime ?? 0;
      const a = st >= SHOWTIME_BAR, b = st >= SHOWTIME_BAR * 3;
      const c = (f[s.pl.side]?.nerve ?? 0) >= EX_NERVE && !f[s.pl.side]?.stageFright;
      const l = this.lit[k];
      if (!l || l[0] !== a || l[1] !== b || l[2] !== c) {
        this.lit[k] = [a, b, c];
        s.sup?.classList.toggle('lit', a);
        s.prime?.classList.toggle('lit', b);
        s.ex?.classList.toggle('lit', c);
      }
    });
  }

  /**
   * game.ts, per rendered frame: each fighter's lowest toe on screen (fraction of the frame height from the top). A foot
   * inside the bar's band (minus FEET_MARGIN of air) ducks the bar: it never covers feet.
   */
  setFeet(fracs: ArrayLike<number>): void {
    if (this.root.hidden) return;
    let low = 0;
    for (let i = 0; i < fracs.length; i++) { const v = fracs[i]; if (Number.isFinite(v) && v > low && v < 2) low = v; }
    const now = performance.now();
    const one = this.root.classList.contains('one');
    // a toe near the bar's top edge first FOLDS it to the attack row (half the height); a toe lower still DUCKS it
    if (low > (one ? this.topFrac : this.foldFrac) - FEET_MARGIN) { this.duckUntil = now + DUCK_HOLD_MS; this.ducks++; }
    else if (low > this.topFrac - FEET_MARGIN) { this.foldUntil = now + DUCK_HOLD_MS; this.folds++; }
    const duck = now < this.duckUntil;
    const fold = !duck && now < this.foldUntil;
    if (duck !== this.ducked) { this.ducked = duck; this.root.classList.toggle('duck', duck); }
    if (fold !== this.folded) { this.folded = fold; this.root.classList.toggle('fold', fold); }
  }

  private enabled(): boolean { return this.training ? this.trainOn : (this.hooks ? this.hooks.enabled() : true); }

  private sync(): void {
    const show = this.mounted && !this.touch && this.players.length > 0;
    this.root.hidden = !show;
    const on = this.enabled();
    this.root.classList.toggle('off', !on);
    this.root.classList.toggle('training', this.training);
    this.chip.hidden = false;                              // CHANGED(wf8 fix) FT-10: TRAINING too
    this.chip.title = on ? t('cbar.hide') : t('cbar.show');
    this.chip.setAttribute('aria-label', this.chip.title);
    this.chip.setAttribute('aria-pressed', String(on));
    this.fitDirty = true;
  }

  private build(): void {
    this.sidesBox.replaceChildren();
    this.sides = [];
    for (const pl of this.players) {
      const labels = this.hooks ? this.hooks.labels(pl.p) : labelsOf(null, pl.p);
      const kit = fighterKit(fighter(this.data, pl.fighter));
      const [r1, r2] = barRows(labels, pl.scheme, kit);
      const root = div(`hp-cbar-side s${pl.side + 1}`, this.sidesBox);
      root.dataset.player = String(pl.p);
      const rows: [HTMLElement, HTMLElement] = [div('hp-cbar-row r1', root), div('hp-cbar-row r2', root)];
      let sup: HTMLElement | null = null, prime: HTMLElement | null = null, ex: HTMLElement | null = null;
      for (const c of r1) { const e = this.cell(c, rows[0]); if (c.id === 'super1') sup = e; if (c.id === 'super3') prime = e; if (c.id === 'ex') ex = e; }
      for (const c of r2) this.cell(c, rows[1]);
      // the expanded view: the pause card's keyboard map (ESC); one per bar (P1's side)
      if (pl === this.players[0] && labels.pause.codes.length) {
        const more = el('button', 'hp-cbar-cell more k-system');
        more.type = 'button';
        more.tabIndex = -1;
        more.id = 'hp-cbar-more';
        more.title = t('cbar.more.t');
        more.append(capChip(labels.pause.keys[0], 'system'), el('span', 'w', t('cbar.more')));
        more.addEventListener('pointerdown', (e) => e.preventDefault());
        more.addEventListener('click', (e) => { e.preventDefault(); more.blur(); this.hooks?.help(); });
        rows[1].append(more);
      }
      this.sides.push({ pl, root, rows, sup, prime, ex, key: '' });
    }
    this.root.dataset.n = String(this.players.length);
    this.lit = this.players.map(() => [false, false, false]);
    this.level = 0;
    this.sync();
  }

  private cell(c: BarCell, row: HTMLElement): HTMLElement {
    const e = div(`hp-cbar-cell k-${c.kind}`, row);
    e.dataset.cell = c.id;
    const caps = el('span', 'caps');
    c.caps.forEach((cap) => caps.append(capChip(cap, c.kind, true)));
    e.append(caps, el('span', 'w', c.word));
    // CHANGED(wf8 fix) FT-01: a second key + word in the same cell (BLOCK + S LOW)
    if (c.plus) {
      const x = el('span', 'x');
      x.append(el('span', 'pl', '+'));
      for (const cap of c.plus.caps) x.append(capChip(cap, c.kind, true));
      x.append(el('span', 'w', c.plus.word));
      e.append(x);
    }
    if (c.title) e.title = c.title;
    return e;
  }

  /**
   * Measure the room (between the RATINGS blocks, under the feet band) and pick the densest level that fits:
   * 0 full, 1 tight (smaller gaps, PRIME TIME -> PRIME), 2 mini (SPECIAL 1-4 keys share one cell, STEP / MOVE caps only).
   */
  private fit(): void {
    this.fitDirty = false;
    if (this.root.hidden) return;
    const frame = this.root.parentElement;
    if (!frame) return;
    const fr = frame.getBoundingClientRect();
    if (fr.width < 10 || fr.height < 10) { this.fitDirty = true; return; }
    // the band under the fighters' feet: the frame's bottom FEET_BAND (the bar's top edge stays below it)
    const band = Math.max(18, fr.height * FEET_BAND - 3);
    this.topFrac = 1 - (band + 3) / fr.height;
    // folded = row 1 only: (band - 12) / 2 + the panel's 10.5 px frame, 3 px off the bottom
    this.foldFrac = 1 - ((band - 12) / 2 + 10.5 + 3) / fr.height;
    const one = band < 34;                       // a short window: one row (attacks + BLOCK + MORE)
    this.root.classList.toggle('one', one);
    this.root.style.setProperty('--cb-band', `${Math.round(band)}px`);
    const measure = (): void => {
      const show = [...frame.querySelectorAll<HTMLElement>('.hp-show')].map((e) => e.getBoundingClientRect());
      const gap = Math.max(6, fr.width * 0.004);
      const l = show[0] && show[0].width > 0 ? show[0].right - fr.left + gap : gap;
      const r = show[1] && show[1].width > 0 ? show[1].left - fr.left - gap : fr.width - gap;
      this.root.style.setProperty('--cb-room', `${Math.round(Math.max(120, r - l))}px`);
      this.root.style.setProperty('--cb-left', `${Math.round(l)}px`);
    };
    // (rows only: the slanted panels' skew paints a few px past their boxes, which a scrollWidth on the parent would count)
    const over = (): boolean => this.sides.some((s) => s.rows.some((r0) => r0.offsetParent !== null && r0.scrollWidth > r0.clientWidth + 1))
      || this.root.scrollHeight > band + 2;
    // the RATINGS blocks narrow (their bars) only when the bar needs the room; then tight -> mini levels
    for (const narrow of [false, true]) {
      frame.classList.toggle('cb-narrow', narrow);
      measure();
      for (let lv = 0; lv <= 2; lv++) {
        this.applyLevel(lv);
        if (!over()) { this.fitOk = true; return; }
      }
    }
    this.fitOk = false;
    // nothing fitted (fonts / layout still settling?): one more try a moment later
    if (!this.refitTimer) this.refitTimer = window.setTimeout(() => { this.refitTimer = 0; this.fitDirty = true; }, 600);
  }

  private applyLevel(lv: number): void {
    this.level = lv;
    this.root.dataset.level = String(lv);
    for (const s of this.sides) {
      // PRIME TIME -> PRIME on the tight levels
      const p = s.prime?.querySelector<HTMLElement>('.w');
      if (p) setText(p, lv >= 1 ? t('kw.primeShort') : t('kw.prime'));
    }
  }

  readback(): Record<string, unknown> {
    const rect = this.root.getBoundingClientRect();
    return {
      shown: !this.root.hidden, on: this.visible, training: this.training, level: this.level, one: this.root.classList.contains('one'), fits: this.fitOk,
      ducked: this.ducked, ducks: this.ducks, folded: this.folded, folds: this.folds, topFrac: Math.round(this.topFrac * 1000) / 1000,
      foldFrac: Math.round(this.foldFrac * 1000) / 1000,
      narrow: !!this.root.parentElement?.classList.contains('cb-narrow'),
      players: this.players.map((p) => ({ ...p })),
      rect: { x: Math.round(rect.left), y: Math.round(rect.top), w: Math.round(rect.width), h: Math.round(rect.height) },
      sides: this.sides.map((s) => ({
        player: s.pl.p, side: s.pl.side,
        cells: [...s.root.querySelectorAll<HTMLElement>('.hp-cbar-cell')].map((c) => ({
          id: c.dataset.cell ?? c.id, caps: [...c.querySelectorAll('.hpk-cap')].map((k) => k.getAttribute('aria-label') || (k.textContent ?? '')),
          word: c.querySelector('.w')?.textContent ?? '', lit: c.classList.contains('lit'),
        })),
      })),
    };
  }

  dispose(): void { window.removeEventListener('resize', this.onResize); this.root.remove(); }
}
