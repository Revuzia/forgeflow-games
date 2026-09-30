/// <reference types="vite/client" />
// HIT PARADE - UI lab (lane UI; CONTRACT 16 "Lab pages"). Dev-only: runtime/lab/ui.html, never linked from index.html.
//
// Mounts the REAL Hud, Menus and TouchControls over a painted stand-in for the 3D bout, with in-memory stand-ins for the
// other lanes' deps (SettingsStore, SaveStore, Showcase, GameAudio) and a small emulation of game.ts's flow (intents ->
// ladder / cards / VS / a scripted bout / results / pause / ending), so every screen is reachable by REAL keys.
//   ?hud=<intro|fight|mid|fright|super|parry|ko|arcade|training>   the HUD fed a scripted snapshot + event timeline
//   ?screen=<id>                                                    deep link (layout checks); ?touch=1 touch mode
//   ?unlock=1                                                       bosses unlocked in the fixture save
// window.__UILAB__ = { ready, menus(), hud(), touch(), intents, cues, phase(), hudState(name), screen(id), readWord() }.
//
// Fixture roster: the CONTRACT 5.4 table (names, archetypes, HP, home sets, rivals). Fighters present in data/fighters
// (loaded through core/data.ts when it loads cleanly) replace their fixture rows. Lab portraits are head crops of the
// characters lane's research renders (_research/characters/renders) - lab only, never shipped.

import { Hud } from '../ui/hud.ts';
import { Menus } from '../ui/menus.ts';
import { EV } from '../ui/ev.ts';
import { setPortraits } from '../ui/data.ts';
import { TouchControls, createTouchState } from '../touch/controls.ts';
import type {
  MatchCfg, MatchResult, MenuIntent, SimEvent, UiFighterDef, UiFighterSnap, UiGameData, UiMatchSnap, UiSave, UiSettings,
  UiSettingsStore, UiShowcase,
} from '../ui/types.ts';
import { t } from '../ui/strings.ts';
import STRINGS from '../../../data/strings.json' with { type: 'json' };

const Q = new URLSearchParams(location.search);
const R = (f: string): string => new URL(`../../../_research/characters/renders/${f}`, import.meta.url).href;

// ─────────────────────────── fixture roster (CONTRACT 5.4) ───────────────────────────
const ROSTER: Array<[string, string, string, string, number, string, string, string]> = [
  ['johnny', 'JOHNNY RIOT', 'The Headliner', 'shoto boxer', 10000, 'rust_theater', 'boneyard', 'Ch42_nonPBR'],
  ['patch', 'PATCH', 'Red Light Rushdown', 'rushdown kickboxer', 9500, 'rooftop', 'spin', 'Eve By J.Gonzales'],
  ['bruno', 'BRUNO "THE FRIDGE"', 'The Fridge', 'grappler', 11000, 'butcher_block', 'krane', 'Brute'],
  ['zambini', 'THE GREAT ZAMBINI', 'Master of Misdirection', 'zoner magician', 9500, 'wheel_of_pain', 'gazza', 'Whiteclown N Hallin'],
  ['krane', 'OFFICER KRANE', 'Riot Act', 'charge, shield and baton', 10000, 'control_room', 'bruno', 'Swat'],
  ['lotus', 'LOTUS LIU', 'Drunken Fist', 'stance drunken fist', 9500, 'wheel_of_pain', 'rerun', 'Kachujin G Rosales'],
  ['boneyard', 'BONEYARD', 'Prime Cut', 'big body cleaver', 10500, 'butcher_block', 'johnny', 'Ch05_nonPBR'],
  ['spin', 'SPIN', 'B-Boy', 'aerial breakdancer', 9500, 'rooftop', 'patch', 'Ch06_nonPBR'],
  ['gazza', 'GAZZA', 'Goal Line', 'setplay footballer', 10000, 'rooftop', 'zambini', 'Ch08_nonPBR'],
  ['rerun', 'RERUN', "Won't Stay Down", 'counter zombie', 10000, 'rust_theater', 'lotus', 'Prisoner B Styperek'],
  ['freak', 'THE FREAK', "The Network's Monster", 'armored monster', 11500, 'butcher_block', '', 'Mutant'],
  ['ricky', 'RICKY MARQUEE', 'Your Host', 'two-phase showman', 13000, 'control_room', '', 'Ch40_nonPBR'],
];
const BODY: Record<string, string> = Object.fromEntries(ROSTER.map((r) => [r[0], r[7]]));
const COLORS = [{ name: 'ORIGINAL', tint: null }, { name: 'ENCORE', tint: '#2a6bd6' }, { name: 'BLACKOUT', tint: '#2a2a2a' }, { name: 'GOLD RECORD', tint: '#d4a017' }];

async function buildData(): Promise<{ data: UiGameData; real: string[]; note: string }> {
  const fighters: Record<string, UiFighterDef> = {};
  for (const [id, name, persona, archetype, hp, stage, rival] of ROSTER) fighters[id] = { id, name, persona, archetype, hp, stage, rival, colors: COLORS };
  let stages: unknown = undefined;
  const real: string[] = [];
  let note = 'fixture only';
  try {
    const mod = await import('../core/data.ts');
    const gd = (mod as { loadGameData: () => { fighters: Record<string, UiFighterDef>; stages: unknown } }).loadGameData();
    for (const id of Object.keys(gd.fighters)) { fighters[id] = gd.fighters[id]; real.push(id); }
    stages = gd.stages;
    note = `core/data.ts loaded: ${real.join(', ') || 'no fighters'}`;
  } catch (e) {
    // SIM's validator rejects in-progress data: read the raw fighter / stage JSON instead (the UI only needs names,
    // colours, moves, simple / classic routing and unique blocks)
    const msg = e instanceof Error ? e.message.split(/\r?\n/)[0] : String(e);
    const raw = import.meta.glob('../../../data/fighters/*.json', { eager: true, import: 'default' }) as Record<string, UiFighterDef>;
    for (const f of Object.values(raw)) if (f && typeof f.id === 'string' && f.moves) { fighters[f.id] = f; real.push(f.id); }
    const st = import.meta.glob('../../../data/stages.json', { eager: true, import: 'default' }) as Record<string, unknown>;
    stages = Object.values(st)[0];
    note = `core/data.ts did not load (${msg}); raw fighter JSON: ${real.join(', ') || 'none'}`;
  }
  return { data: { fighters, stages, strings: STRINGS as Record<string, string> }, real, note };
}

/** head-and-shoulders crops of the research renders (the figure's alpha bbox top, 30 % of its height) */
async function labPortraits(ids: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all(ids.map((id) => new Promise<void>((done) => {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        const g = c.getContext('2d', { willReadFrequently: true })!;
        g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, c.width, c.height).data;
        let top = c.height, bot = 0;
        for (let y = 0; y < c.height; y++) for (let x = c.width * 0.35 | 0; x < c.width * 0.65; x++) if (d[(y * c.width + x) * 4 + 3] > 20) { if (y < top) top = y; if (y > bot) bot = y; }
        const size = Math.max(40, Math.round((bot - top) * 0.3));
        const o = document.createElement('canvas');
        o.width = 192; o.height = 192;
        const og = o.getContext('2d')!;
        og.imageSmoothingQuality = 'high';
        og.drawImage(img, c.width / 2 - size / 2, Math.max(0, top - size * 0.08), size, size, 0, 0, 192, 192);
        out[id] = o.toDataURL('image/png');
      } catch { /* leave the badge */ }
      done();
    };
    img.onerror = () => done();
    img.src = R(`${BODY[id]}_front.png`);
  })));
  return out;
}

// ─────────────────────────── stand-ins for the other lanes' deps ───────────────────────────
class MemSettings implements UiSettingsStore {
  private v: UiSettings = {
    volume: { master: 0.8, music: 0.5, sfx: 0.9, crowd: 0.7, voice: 0.9 }, gore: 'splatter', screenShake: 1, reduceFlashing: false,
    cinematics: 'full', quality: 'high', bloom: true, language: 'en', touchScale: 1, touchOpacity: 0.75, touchLeftHanded: false, haptics: true, touchLayout: null,
  };
  private fns = new Set<(s: UiSettings) => void>();
  get(): UiSettings { return this.v; }
  set(p: Partial<UiSettings>): void { this.v = { ...this.v, ...p }; for (const f of this.fns) f(this.v); }
  on(fn: (s: UiSettings) => void): () => void { this.fns.add(fn); return () => this.fns.delete(fn); }
}
const unlock = Q.get('unlock') === '1';
const save: UiSave = {
  unlocks: { freak: unlock, ricky: unlock },
  board: [{ name: 'RKY', score: 912400, fighter: 'ricky' }, { name: 'JON', score: 604150, fighter: 'johnny' }, { name: 'PAT', score: 488900, fighter: 'patch' }],
  onlineName: '',
};
const saveStore = { get: (): UiSave => save, set: (p: Partial<UiSave>): void => { Object.assign(save, p); } };
const cues: string[] = [];
const audio = { ui: (c: string): void => { cues.push(`ui:${c}`); if (cues.length > 200) cues.shift(); }, music: (c: string | null): void => { cues.push(`music:${c}`); } };

class StubShowcase implements UiShowcase {
  private readonly el = document.getElementById('lab-showcase') as HTMLElement;
  private readonly img = document.createElement('img');
  shown: string | null = null;
  constructor() { this.el.append(this.img); this.img.alt = ''; }
  async show(id: string, color: number, pose: 'idle' | 'intro' | 'win'): Promise<void> {
    this.shown = `${id}:${color}:${pose}`;
    this.img.src = R(`${BODY[id] ?? 'Ch42_nonPBR'}_front.png`);
    this.img.style.filter = color ? `drop-shadow(8px 8px 0 rgba(0,0,0,.45)) hue-rotate(${color * 70}deg)` : '';
    this.el.style.display = 'block';
  }
  setRect(r: { x: number; y: number; w: number; h: number } | null): void {
    if (!r) { this.el.style.display = 'none'; return; }
    Object.assign(this.el.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
  }
  hide(): void { this.el.style.display = 'none'; }
  frame(_dt: number): void { /* the real Showcase animates the model */ }
  render(): void { /* drawn by the <img> */ }
}

// ─────────────────────────── snapshots + scripted HUD states ───────────────────────────
const F = (o: Partial<UiFighterSnap> = {}): UiFighterSnap => ({
  hp: 10000, hpMax: 10000, greyHp: 0, showtime: 0, nerve: 60000, stageFright: false, combo: 0, comboDamage: 0,
  hitstop: 0, moveId: -1, moveFrame: 0, stun: 0, actionable: true, ...o,
});
const M = (o: Partial<UiMatchSnap> = {}): UiMatchSnap => ({ frame: 0, round: 1, timer: 99, wins: [0, 0], roundWinner: -1, winner: -1, ...o });
const E = (frame: number, type: number, a = 0, b = 1, c = 0, d = 0): SimEvent => ({ frame, type, a, b, c, d });
type Step = { m: UiMatchSnap; f: [UiFighterSnap, UiFighterSnap]; ev: SimEvent[] };
type Script = { cfg: MatchCfg; step: (k: number) => Step; score?: number };
const cfgOf = (mode: MatchCfg['mode'], p1: string, p2: string, o: Partial<MatchCfg> = {}): MatchCfg => ({
  mode, stage: 'rust_theater', seed: 7, p: [{ fighter: p1, color: 0, scheme: 0, cpu: -1 }, { fighter: p2, color: 1, scheme: 0, cpu: mode === 'arcade' ? 5 : -1 }], rounds: 2, timer: 99, ...o,
});
const lerp = (a: number, b: number, k: number, n: number): number => Math.round(a + (b - a) * Math.min(1, k / n));

const SCRIPTS: Record<string, Script> = {
  intro: { cfg: cfgOf('versus', 'johnny', 'bruno'), step: (k) => ({ m: M({ frame: 100 + k }), f: [F(), F()], ev: k === 1 ? [E(101, EV.ROUND_INTRO)] : k === 80 ? [E(180, EV.FIGHT)] : [] }) },
  fight: { cfg: cfgOf('versus', 'patch', 'spin'), step: (k) => ({ m: M({ frame: 200 + k }), f: [F(), F()], ev: k === 1 ? [E(201, EV.FIGHT)] : [] }) },
  mid: {
    cfg: cfgOf('versus', 'johnny', 'bruno'),
    step: (k) => {
      const combo = Math.min(7, Math.floor(k / 5));
      return {
        m: M({ frame: 1000 + k, round: 2, timer: 63, wins: [1, 0] }),
        f: [F({ hp: 7800, greyHp: 300, showtime: 24000, nerve: 43500, combo: combo >= 2 ? combo : 0, comboDamage: combo >= 2 ? lerp(0, 2150, k, 35) : 0 }),
          F({ hp: lerp(6600, 4450, k, 35), hpMax: 11000, greyHp: 700, showtime: 9000, nerve: 21000 })],
        ev: k === 2 ? [E(1002, EV.HIT, 0, 1)] : k === 6 ? [E(1006, EV.COUNTER, 0, 1)] : [],
      };
    },
  },
  fright: {
    cfg: cfgOf('versus', 'lotus', 'rerun'),
    step: (k) => ({
      m: M({ frame: 3000 + k, round: 3, timer: 21, wins: [1, 1] }),
      f: [F({ hp: 3100, showtime: k < 5 ? 29600 : 30000, nerve: 38000, combo: k > 10 ? 4 : 0, comboDamage: k > 10 ? 1320 : 0 }), F({ hp: 2600, stageFright: true, nerve: lerp(0, 8000, k, 60) })],
      ev: k === 3 ? [E(3003, EV.STAGE_FRIGHT_ON, 1, 0)] : [],
    }),
  },
  super: {
    cfg: cfgOf('versus', 'zambini', 'gazza'),
    step: (k) => ({
      m: M({ frame: 4000 + k, round: 1, timer: 48 }),
      f: [F({ hp: 6400, showtime: 0, nerve: 30000, combo: Math.min(12, 4 + Math.floor(k / 4)), comboDamage: lerp(1800, 5100, k, 32) }), F({ hp: lerp(4000, 1200, k, 32) })],
      ev: k === 2 ? [E(4002, EV.SUPER_HIT, 0, 1, 4)] : [],
    }),
  },
  parry: {
    cfg: cfgOf('versus', 'krane', 'boneyard'),
    step: (k) => ({ m: M({ frame: 5000 + k, timer: 77 }), f: [F({ hp: 9100, nerve: 52000 }), F({ hp: 8800, nerve: 40000, showtime: 12000 })], ev: k === 2 ? [E(5002, EV.PERFECT_PARRY, 0, 1)] : [] }),
  },
  ko: {
    cfg: cfgOf('versus', 'spin', 'patch'),
    step: (k) => ({
      m: M({ frame: 6000 + k, round: 2, timer: 34, wins: [1, 0], roundWinner: k >= 90 ? 0 : -1 }),
      f: [F({ hp: 2300, showtime: 6000, nerve: 12000 }), F({ hp: k < 2 ? 400 : 0, showtime: 15000, nerve: 26000 })],
      ev: k === 2 ? [E(6002, EV.KO, 0, 1)] : k === 90 ? [E(6090, EV.ROUND_END, 0, -1)] : [],
    }),
  },
  arcade: {
    cfg: cfgOf('arcade', 'johnny', 'boneyard'), score: 123450,
    step: (k) => ({ m: M({ frame: 7000 + k, timer: 88 }), f: [F({ hp: 8200, showtime: 11000 }), F({ hp: 7300, hpMax: 10500 })], ev: [] }),
  },
  training: {
    cfg: cfgOf('training', 'johnny', 'bruno', { timer: 0, rounds: 1 }),
    step: (k) => {
      // 5M hits on frame 12; the attacker recovers at 25, the defender at 28 -> +3 on hit
      const hit = k >= 12 && k < 28;
      return {
        m: M({ frame: 9000 + k, timer: -1 }),
        f: [F({ hp: 10000, moveId: k >= 4 && k < 25 ? 3 : -1, moveFrame: k >= 4 && k < 25 ? k - 4 + 1 : 0, actionable: !(k >= 4 && k < 25) }),
          F({ hp: k >= 12 ? 10400 : 11000, hpMax: 11000, stun: hit ? 28 - k : 0, actionable: !hit })],
        ev: k === 12 ? [E(9012, EV.HIT, 0, 1, 1)] : [],
      };
    },
  },
};
// the input words the training state's input display receives (2, 3, 6 + M, ... like a real QCF + M)
const TRAIN_INPUTS: Array<[number, number]> = [[0, 0], [2, 2], [3, 10], [4, 8], [5, 8 | 32], [6, 0], [9, 16], [12, 0]];

// ─────────────────────────── boot ───────────────────────────
async function main(): Promise<void> {
  const host = document.getElementById('lab-ui') as HTMLElement;
  const { data, real, note } = await buildData();
  console.info('[ui lab]', note);
  const settings = new MemSettings();
  const showcase = new StubShowcase();
  const input = { suspended: false, releaseAll: (): void => undefined };
  const hud = new Hud(host, data);
  const menus = new Menus(host, data, { showcase, settings, save: saveStore, audio, input });
  const touchState = createTouchState();
  const touch = new TouchControls(host, touchState, { scale: 1, opacity: 0.75, leftHanded: false, haptics: false, layout: null });
  touch.setEditLabels({ hint: t('touch.edit'), smaller: t('touch.smaller'), bigger: t('touch.bigger'), reset: t('touch.reset'), done: t('touch.done') });
  settings.on((s) => touch.setOptions({ scale: s.touchScale, opacity: s.touchOpacity, leftHanded: s.touchLeftHanded, haptics: s.haptics, layout: s.touchLayout ?? null }));
  touch.onLayout((l) => settings.set({ touchLayout: l }));
  if (Q.get('touch') === '1') { document.documentElement.classList.add('hp-touch'); document.documentElement.classList.remove('hp-kbm'); }
  else document.documentElement.classList.add('hp-kbm');
  const touchOn = (): boolean => document.documentElement.classList.contains('hp-touch');
  const portraits = await labPortraits(Object.keys(data.fighters).filter((id) => BODY[id]));
  setPortraits(portraits);

  // ── the scripted HUD loop
  let script: Script | null = null;
  let k = 0;
  let phase: 'menu' | 'bout' | 'paused' = 'menu';
  let boutEnd = 0;
  let onBoutEnd: (() => void) | null = null;
  const loop = (): void => {
    if (script && phase !== 'paused') {
      const s = script.step(k);
      hud.frame(s.m, s.f, s.ev);
      if (script.cfg.mode === 'training') for (const [at, w] of TRAIN_INPUTS) if (k === at) hud.pushInputs(w, s.m.frame);
      if (touchOn()) touch.setMeters({ showtime: s.f[0].showtime, nerve: s.f[0].nerve, stageFright: !!s.f[0].stageFright });
      k++;
      if (boutEnd && k >= boutEnd && onBoutEnd) { const f = onBoutEnd; onBoutEnd = null; boutEnd = 0; f(); }
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  const hudState = (name: string): void => {
    const sc = SCRIPTS[name] ?? SCRIPTS.mid;
    menus.hide();
    script = sc;
    k = 0;
    hud.mount(sc.cfg);
    if (typeof sc.score === 'number') hud.setScore(sc.score);
    hud.setEpisodeLine(sc.cfg.mode === 'arcade' ? `${t('vs.episode', { n: 5 })} - ${t('stage.rust_theater.name')}` : t(`stage.${sc.cfg.stage}.name`));
    touch.setVisible(touchOn());
    phase = 'bout';
  };
  const endBout = (): void => { script = null; hud.unmount(); touch.setVisible(false); phase = 'menu'; };

  // ── game.ts emulation: results / pause / season flow
  const result = (cfg: MatchCfg, winner: 0 | 1, extra: Partial<MatchResult> = {}): MatchResult => ({
    cfg, winner, wins: winner === 0 ? [2, 1] : [1, 2], frames: 60 * 131, forfeit: -1,
    fighters: [F({ hp: winner === 0 ? 3400 : 0 }), F({ hp: winner === 1 ? 5200 : 0, hpMax: 11000 })],
    match: M({ round: 3, timer: 0, winner }), stats: hud.tally().map((s, i) => ({ ...s, damage: s.damage || (i === winner ? 10000 : 7600), maxCombo: s.maxCombo || (i === winner ? 9 : 5), counters: s.counters || (i === winner ? 3 : 1), punishes: i === winner ? 2 : 0, perfectParries: i === winner ? 1 : 0, throws: i === winner ? 2 : 3, supers: i === winner ? 1 : 0, wallSplats: i === winner ? 1 : 0 })) as MatchResult['stats'],
    ...extra,
  });
  const openPause = async (training: boolean): Promise<void> => {
    phase = 'paused';
    const c = await menus.showPause({ training, fighter: script?.cfg.p[0].fighter, scheme: 0 });
    if (c === 'resume') { menus.hide(); phase = 'bout'; return; }
    if (c === 'settings' || c === 'movelist') { menus.show(c, { from: 'pause', onClose: () => { void openPause(training); } }); return; }
    endBout();
    menus.show('main');
  };
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && phase === 'bout' && !menus.visible) { e.preventDefault(); void openPause(script?.cfg.mode === 'training'); }
  });
  touch.onPause(() => { if (phase === 'bout') void openPause(script?.cfg.mode === 'training'); });

  const bout = (cfg: MatchCfg, name: string, frames: number): Promise<void> => new Promise((done) => {
    const sc = SCRIPTS[name] ?? SCRIPTS.mid;
    hudState(name);
    script = { ...sc, cfg };
    hud.mount(cfg);
    boutEnd = frames;
    onBoutEnd = () => done();
  });

  const intents: MenuIntent[] = [];
  const seasonDemo = async (fighter: string, color: number, length: 'season' | 'pilot'): Promise<void> => {
    const opp = ['patch', 'bruno', 'zambini', 'krane', 'lotus', 'spin', 'gazza', 'rerun'].filter((id) => id !== fighter);
    const kinds = ['bout', 'bout', 'bout', 'brawl', 'bout', 'rival', 'bout', 'heckler', 'miniboss', 'boss'] as const;
    const bouts = kinds.map((kind, i) => ({ kind, opponent: kind === 'rival' ? 'boneyard' : kind === 'miniboss' ? 'freak' : kind === 'boss' ? 'ricky' : kind === 'brawl' || kind === 'heckler' ? undefined : opp[i % 6], result: null as 'won' | 'lost' | null }));
    let score = 0;
    for (const cur of [0, 5, 9]) {
      for (let j = 0; j < cur; j++) bouts[j].result = 'won';
      const go = await menus.showLadder({ fighter, color, length, bouts, current: cur, score, ratings: 72 + cur });
      if (go === 'quit') { menus.show('main'); return; }
      const b = bouts[cur];
      if (b.kind === 'rival') await menus.showCard({ kind: 'rival', a: fighter, b: 'boneyard', banter: [t(`banter.${fighter}.boneyard`).startsWith('[') ? t('banter.johnny.boneyard') : t(`banter.${fighter}.boneyard`), t('banter.boneyard.johnny')] });
      if (b.kind === 'boss') await menus.showCard({ kind: 'boss', a: 'ricky' });
      const cfg = cfgOf('arcade', fighter, b.opponent ?? 'patch');
      await menus.showVs({ p: [{ fighter, color }, { fighter: cfg.p[1].fighter, color: 1, label: t('hud.cpu', { n: 5 }) }], stage: cfg.stage, mode: 'arcade', episode: cur + 1, kind: b.kind });
      await bout(cfg, 'arcade', 45);
      score += 185000;
      const r = await menus.showResults(result(cfg, 0, { score, best: cur === 9 }));
      endBout();
      if (r === 'menu') { menus.show('main'); return; }
    }
    await menus.showEnding({ fighter, score, unlocked: ['freak', 'ricky'] });
    const name = await menus.showNameEntry({ score, fighter });
    save.board = [...(save.board ?? []), { name, score, fighter }];
    menus.show('title');
  };
  menus.onIntent(async (i) => {
    intents.push(i);
    if (i.kind === 'startSeason') await seasonDemo(i.fighter, i.color, i.length);
    else if (i.kind === 'startMatch') {
      await bout(i.cfg, 'mid', 150);
      const r = await menus.showResults(result(i.cfg, 0));
      endBout();
      if (r === 'rematch') menus.show('main');
      else if (r === 'charselect') menus.show('charselect', { mode: 'versus', opponent: i.cfg.p[1].cpu >= 0 ? 'cpu' : 'human' });
      else menus.show('main');
    } else if (i.kind === 'training') {
      menus.setMoveList(i.cfg.p[0].fighter, i.cfg.p[0].scheme);
      hudState('training');
      script = { ...SCRIPTS.training, cfg: i.cfg };
      hud.mount(i.cfg);
    } else if (i.kind === 'online') {
      const seq: Array<[number, Parameters<Menus['setOnlineStatus']>[0]]> = i.action === 'cancel' ? [] : i.action === 'create'
        ? [[0, { code: 'net.waiting_peer', room: 'KRTZ' }]]
        : [[0, { code: 'net.searching' }], [900, { code: 'net.connecting' }], [1800, { code: 'net.rtt_high', rttMs: 142 }]];
      for (const [ms, st] of seq) setTimeout(() => menus.setOnlineStatus(st), ms);
    } else if (i.kind === 'quitToTitle') menus.show('title');
  });

  // ── deep links
  const screen = async (id: string): Promise<void> => {
    const vcfg = cfgOf('versus', 'johnny', 'bruno');
    switch (id) {
      case 'title': case 'main': case 'season': case 'versus': case 'settings': case 'online': case 'credits': menus.show('main'); if (id !== 'main') menus.show((id === 'title' ? 'title' : id) as 'title'); break;
      case 'charselect': menus.show('main'); menus.show('charselect', { mode: 'versus', opponent: 'cpu' }); break;
      case 'charselect_season': menus.show('main'); menus.show('charselect', { mode: 'season' }); break;
      case 'stage': {
        menus.show('main'); menus.show('charselect', { mode: 'versus', opponent: 'cpu' });
        for (const code of ['Enter', 'Enter', 'Enter', 'ArrowRight', 'Enter', 'Enter']) window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
        await new Promise((r) => setTimeout(r, 600));
        break;
      }
      case 'vs': void menus.showVs({ p: [{ fighter: 'johnny', color: 0 }, { fighter: 'boneyard', color: 2, label: t('hud.cpu', { n: 5 }) }], stage: 'rust_theater', mode: 'arcade', episode: 5, kind: 'rival' }, 600000); break;
      case 'results': void menus.showResults(result(vcfg, 0)); break;
      case 'results_arcade': void menus.showResults(result(cfgOf('arcade', 'johnny', 'boneyard'), 1, { score: 412300 })); break;
      case 'ladder': void menus.showLadder({ fighter: 'johnny', color: 0, length: 'season', current: 5, score: 925000, ratings: 81,
        bouts: [{ kind: 'bout', opponent: 'patch', result: 'won' }, { kind: 'bout', opponent: 'krane', result: 'won' }, { kind: 'bout', opponent: 'spin', result: 'won' }, { kind: 'brawl', result: 'won' }, { kind: 'bout', opponent: 'lotus', result: 'won' }, { kind: 'rival', opponent: 'boneyard' }, { kind: 'bout', opponent: 'gazza' }, { kind: 'heckler' }, { kind: 'miniboss', opponent: 'freak' }, { kind: 'boss', opponent: 'ricky' }] }); break;
      case 'card_rival': void menus.showCard({ kind: 'rival', a: 'johnny', b: 'boneyard', banter: [t('banter.johnny.boneyard'), t('banter.boneyard.johnny')] }); break;
      case 'card_boss': void menus.showCard({ kind: 'boss', a: 'ricky' }); break;
      case 'card_miniboss': void menus.showCard({ kind: 'miniboss', a: 'freak' }); break;
      case 'card_brawl': void menus.showCard({ kind: 'brawl' }); break;
      case 'card_heckler': void menus.showCard({ kind: 'heckler' }); break;
      case 'ending': void menus.showEnding({ fighter: 'johnny', score: 1830500, unlocked: ['freak', 'ricky'] }); break;
      case 'nameentry': void menus.showNameEntry({ score: 1830500, fighter: 'johnny' }); break;
      case 'pause': hudState('mid'); phase = 'paused'; void openPause(false); break;
      case 'training': hudState('training'); phase = 'paused'; void menus.showPause({ training: true }); (document.getElementById('hpm-p-training') as HTMLElement).click(); break;
      case 'movelist': menus.show('main'); menus.show('movelist', { fighter: Q.get('fighter') ?? 'johnny', scheme: Q.get('scheme') === '1' ? 1 : 0 }); break;
      case 'confirm': hudState('mid'); phase = 'paused'; void openPause(false); (document.getElementById('hpm-p-forfeit') as HTMLElement).click(); break;
      default: menus.show('title');
    }
  };

  (window as unknown as Record<string, unknown>).__UILAB__ = {
    ready: true, note, real,
    menus: () => menus.readback(), hud: () => hud.readback(), touch: () => touch.readback(), phase: () => phase,
    intents, cues, hudState, screen, readWord: () => touch.readWord(), showcase: () => showcase.shown,
    editLayout: (on: boolean) => touch.editLayout(on), settings: () => settings.get(),
  };
  const hs = Q.get('hud');
  const sc = Q.get('screen');
  if (hs) hudState(hs);
  else if (sc) await screen(sc);
  else menus.show('title');
}

void main();
