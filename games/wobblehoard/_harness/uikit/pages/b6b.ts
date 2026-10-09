// B6b page: THE TROPHIES AND RECORDS SCREEN (UI.md 6, 8 B6). Every section is the REAL screen (src/ui/later-trophies.ts + trophies.css) over a REAL trophy evaluator, store and bridge
// (core/achievements.ts, achStore.ts, portal/bridge.ts, shell/achievementsBinding.ts) and a REAL seeded Collection (hoardMock.ts), in a scene at exactly the viewport's size (the kit
// sizes), so a sheet shows what the game shows. Only the data is staged: which trophies are earned, the counters, the Hoard.
//   trophies-locked | trophies-some | trophies-all | trophies-gold (the Gold filter) | records-some | records-zero (an empty Hoard, no counts)  +  trophy-toasts (the unlock toast, every tier)
import { memoryStorage } from '../../../src/core/settings.ts';
import { mulberry32 } from '../../../src/core/rng.ts';
import { ACHIEVEMENTS, emptyCounters } from '../../../src/core/achievements.ts';
import type { AchCounters, AchTier } from '../../../src/core/achievements.ts';
import { ACH_KEY } from '../../../src/core/achStore.ts';
import { createCollection } from '../../../src/collection/index.ts';
import type { Collection } from '../../../src/collection/index.ts';
import { HOARD_KEY } from '../../../src/collection/constants.ts';
import type { PortalEnv } from '../../../src/portal/bridge.ts';
import { createAchievements } from '../../../src/shell/achievementsBinding.ts';
import type { Achievements } from '../../../src/shell/achievementsBinding.ts';
import { trophyToastSub } from '../../../src/shell/trophyToast.ts';
import type { TrophyToast } from '../../../src/shell/trophyToast.ts';
import { h } from '../../../src/ui/dom.ts';
import { icon } from '../../../src/ui/icons.ts';
import { openTrophies } from '../../../src/ui/later-trophies.ts';
import type { TrophiesScreen, TrophiesTab } from '../../../src/ui/later-trophies.ts';
import { closeTopLayer } from '../../../src/ui/modal.ts';
import { buildToast } from '../../../src/ui/toast.ts';
import type { TierFilter } from '../../../src/ui/trophiesData.ts';
import { button } from '../parts.ts';
import { NOW, makeSave } from '../hoardMock.ts';
import { cell, sub } from './types.ts';
import type { KitSection } from './types.ts';
import '../b4a.css';

const DAY = 86_400_000;

/** A portal stand-in the kit page owns: standalone (nothing is ever posted). */
const env = (framed = false): PortalEnv => ({ now: () => NOW, setTimeout: () => 0, clearTimeout: () => {}, framed, post: () => {}, onMessage: () => () => {} });

export interface KitTrophies { ach: Achievements; hoard: Collection }
export interface KitTrophyState { earned?: readonly string[]; counters?: Partial<AchCounters>; owned?: readonly number[]; since?: number; framed?: boolean }

/** a real Achievements over an in-memory store that already holds `earned` (stamped a little apart, oldest first) and `counters` */
export function makeKitTrophies(s: KitTrophyState = {}): KitTrophies {
  const earned: Record<string, number> = {};
  (s.earned ?? []).forEach((slug, i) => { earned[slug] = NOW - (s.earned!.length - i) * Math.round(0.7 * DAY); });
  const blob = JSON.stringify({ v: 1, since: s.since ?? NOW - 21 * DAY, earned, counters: { ...emptyCounters(), ...s.counters } });
  const ach = createAchievements({ storage: memoryStorage({ [ACH_KEY]: blob }), now: () => NOW, env: env(s.framed) });
  const hoard = createCollection({ storage: memoryStorage({ [HOARD_KEY]: makeSave({ owned: s.owned ?? [9, 5, 3, 2, 1, 0] }).json }), now: () => NOW, random: mulberry32(11), setTimer: () => 0, clearTimer: () => {}, throttleMs: 1e9 });
  return { ach, hoard };
}

export const SOME = ['first_squish', 'first_stretch', 'first_capsule', 'first_task', 'first_cut', 'rare_find', 'full_stretch', 'lift_toss', 'species_10'];
export const SOME_COUNTERS: Partial<AchCounters> = { squeezes: 142, stretches: 61, tosses: 7, cuts: 18, joins: 11, capsules: 23, merges: 4, tasks: 6, species: 20 };
export const ALL = ACHIEVEMENTS.map((d) => d.slug);
export const ALL_COUNTERS: Partial<AchCounters> = { squeezes: 1840, stretches: 902, tosses: 66, cuts: 240, joins: 190, capsules: 311, merges: 58, tasks: 77, species: 50 };

/** a mock HUD behind an overlay: the felt, a blob, the top row [FS, Sound, Menu] */
function scene(id: string, title: string, note: string, fill: (stage: HTMLElement) => void): KitSection {
  return {
    id, title, note, bleed: true,
    build(host) {
      const w = innerWidth, hgt = innerHeight;
      const stage = h('div', { class: 'kp-scene-b4' });
      stage.style.height = `${hgt}px`;
      const d = Math.round(Math.min(w * 0.7, hgt * 0.5));
      const blob = h('div', { class: 'kp-blob' });
      blob.style.width = blob.style.height = `${d}px`;
      blob.style.left = `${Math.round(w / 2 - d / 2)}px`; blob.style.top = `${Math.round(hgt * 0.45 - d / 2)}px`;
      stage.append(blob, h('div', { class: 'kp-top' }, h('div', { class: 'kp-top-btns' },
        h('span', { class: 'kp-fs' }, button({ kind: 'icon', icon: 'fullscreen', name: 'Full screen', pressed: false })), button({ kind: 'icon', icon: 'soundOn', name: 'Mute sound', pressed: false }), button({ kind: 'icon', icon: 'menu', name: 'Menu' }))));
      host.append(stage);
      fill(stage);
    },
  };
}

declare global { interface Window { __kitTro?: Record<string, { screen: TrophiesScreen; ach: Achievements; hoard: Collection }> } }

function trophyScene(id: string, title: string, note: string, st: KitTrophyState, o: { tab?: TrophiesTab; filter?: TierFilter } = {}): KitSection {
  return scene(id, title, note, (stage) => {
    const k = makeKitTrophies(st);
    const screen = openTrophies({ root: stage, trophies: k.ach, hoard: k.hoard, say: () => {}, tab: o.tab, filter: o.filter });
    (window.__kitTro ??= {})[id] = { screen, ach: k.ach, hoard: k.hoard };
  });
}

const locked = trophyScene('trophies-locked', 'Scene: Trophies, all locked (a new player)', 'Nothing earned: dashed medals with their rank pips, the hidden ones say "???", one kind sentence, 0 XP.', { counters: {}, owned: [1, 0, 0, 0, 0, 0] });
const some = trophyScene('trophies-some', 'Scene: Trophies, some earned', 'Nine earned (one of them a hidden one, now shown by name), species progress on the locked count rows, the account line, the XP line.', { earned: SOME, counters: SOME_COUNTERS });
const all = trophyScene('trophies-all', 'Scene: Trophies, all twenty earned', 'The count turns gold; every card is a filled medal with its date; no progress bars (a count that is done needs none).', { earned: ALL, counters: ALL_COUNTERS, owned: [14, 11, 10, 7, 5, 3] });
const silver = trophyScene('trophies-silver', 'Scene: the Silver filter (a hidden one still hidden)', 'Silver: "Up and Away" is hidden until found (name and condition say ???); the species count row shows its progress (20 of 25).', { earned: SOME.filter((s) => s !== 'lift_toss'), counters: SOME_COUNTERS }, { filter: 'silver' });
const diamond = trophyScene('trophies-diamond', 'Scene: the Diamond filter (the top two)', 'A hidden diamond that is not found yet (???) and a long count (20 of 50).', { earned: ALL.filter((s) => s !== 'mythic_find' && s !== 'all_fifty'), counters: { ...ALL_COUNTERS, species: 20 }, owned: [9, 5, 3, 2, 1, 0] }, { filter: 'diamond' });
const gold = trophyScene('trophies-gold', 'Scene: the Gold filter', 'The medal rail is the tier filter: Gold pressed, three cards (one earned would show its date).', { earned: [...SOME, 'tier_up'], counters: SOME_COUNTERS }, { filter: 'gold' });
const recs = trophyScene('records-some', 'Scene: Records, a mid-game Hoard', 'Species, squishies and the rarest from the Hoard; the species per rarity as bars in the tier colour; the eight counters since the day counting started.', { earned: SOME, counters: SOME_COUNTERS }, { tab: 'records' });
const recs0 = trophyScene('records-zero', 'Scene: Records, nothing yet', 'An empty Hoard and zero counters: zeros, "Nothing yet", no empty bars drawn as errors.', { counters: {}, owned: [0, 0, 0, 0, 0, 0] }, { tab: 'records' });

/** the unlock toast, every tier, signed in or not (the real toast builder and the real second-line rule) */
const toastsSection: KitSection = {
  id: 'trophy-toasts', title: 'B6b parts: the unlock toast (every tier; guest, first ever, signed in)',
  note: 'Top-centre in the game, 3.2 s, the live region speaks it once. The second line: "+N XP" only when signed in; the very first trophy says where they live; a hidden one shows its condition.',
  build(host) {
    const chip = (tier: AchTier): HTMLElement => h('span', { class: 'k-tier', attrs: { 'data-tier': tier } }, icon('trophy', 'k-icon'), h('span', { text: tier.charAt(0).toUpperCase() + tier.slice(1) }));
    const make = (slug: string, signedIn: boolean, first: boolean): HTMLElement => {
      const d = ACHIEVEMENTS.find((x) => x.slug === slug)!;
      const t: TrophyToast = { slug, name: d.name, description: d.description, tier: d.tier, points: d.points, hidden: d.hidden, signedIn, retro: false, first };
      return buildToast('trophy', d.name, { sub: trophyToastSub(t), extra: chip(d.tier) });
    };
    const col = (...els: HTMLElement[]): HTMLElement => h('div', { class: 'kp-toasts' }, ...els);
    host.append(sub('A guest (no portal): the first ever, then plain, then a hidden one'));
    host.append(cell('guest', col(make('first_squish', false, true), make('full_stretch', false, false), make('lift_toss', false, false)), { col: true }));
    host.append(sub('Signed in: +N XP'));
    host.append(cell('signed in, all four tiers', col(make('first_task', true, false), make('medley', true, false), make('legendary_find', true, false), make('mythic_find', true, false)), { col: true }),
      cell('the same over white (the worst backdrop for glass)', col(make('first_task', true, false), make('mythic_find', true, false)), { tone: 'white', col: true }));
  },
};

export const b6bSections = (): KitSection[] => [locked, some, all, silver, gold, diamond, recs, recs0, toastsSection];

/** Esc closes the top layer in the game (hudBinding.escape); the kit page has no HUD, so it does the same for its keyboard walk. */
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeTopLayer('escape'); });
