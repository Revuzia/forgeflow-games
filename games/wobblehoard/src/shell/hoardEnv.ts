// Builds the Hoard UI's port (src/ui/hoard/types.ts HoardEnv) from the game core: the catalog words, the tier gems, the species icons,
// the live squishy (focusInstance / restorePrimary), the ceremonies (result first), the play mat and the announcer. The Hoard UI itself
// may import only the collection module (probe_collection_imports.ts I07), so this file is its window onto everything else.
import type { TierName } from '../contracts.ts';
import type { ClaimOk, HoardItem, MergeOk } from '../collection/types.ts';
import { MERGE_COST, MERGE_HOLD_MS } from '../core/merge.ts';
import { TIERS, TIER_NAMES, TOP_TIER_INDEX } from '../core/rarity.ts';
import { LANES, getSpecies } from '../data/catalog.ts';
import { MATERIAL_FAMILIES } from '../data/materials.ts';
import { genomePalette, linearToSrgb } from '../render/oklch.ts';
import type { Rgb } from '../render/oklch.ts';
import { h } from '../ui/dom.ts';
import { gemSvg } from '../ui/gem.ts';
import type { HoardEnv } from '../ui/hoard/types.ts';
import { speciesIcon } from '../ui/speciesIcon.ts';
import type { ItemView } from './collectionPort.ts';
import type { Game } from './game.ts';
import type { MatRefusal } from './mat.ts';

const hex = (c: Rgb): string => '#' + c.map((v) => Math.round(Math.max(0, Math.min(1, linearToSrgb(Math.max(0, v)))) * 255).toString(16).padStart(2, '0')).join('');

export interface HoardEnvDeps {
  announce(text: string): void;
  toast(text: string): void;
  returnFocus(): HTMLElement | null;
}

export function matRefusalCopy(r: MatRefusal, limit: number): string {
  switch (r) {
    case 'full': return `The mat holds ${limit} at a time on this device. Put one back first.`;
    case 'busy': return 'The mat is busy enough right now. Put one back first.';
    case 'already': return "It's already out on the mat.";
    case 'unsupported': return 'This device shows one squishy at a time.';
    default: return 'That one could not come out. Try another.';
  }
}

export function createHoardEnv(g: Game, d: HoardEnvDeps): HoardEnv {
  let idle: Array<() => void> = [];
  const busy = (): boolean => g.ceremonies.active || g.ceremonies.pending;
  g.on('ceremony', (e) => {
    if (e.type !== 'end') return;
    queueMicrotask(() => { if (busy() || !idle.length) return; const fns = idle; idle = []; for (const f of fns) { try { f(); } catch (x) { console.error(x); } } });
  });
  const itemView = (it: HoardItem, isNew: boolean, copies: number, quick?: boolean): ItemView =>
    ({ itemId: it.id, genome: it.genome, tier: it.tier as TierName, isNew, copies, nickname: null, quickEligible: quick });
  return {
    collection: g.hoard,
    species(id) {
      const s = getSpecies(id);
      if (!s) return null;
      const fam = MATERIAL_FAMILIES[s.family];
      const laneIdx = LANES.findIndex((l) => l.id === s.lane);
      return { name: s.name, blurb: s.blurb, family: fam?.name ?? '', familyBlurb: fam?.blurb ?? '', lane: LANES[laneIdx]?.name ?? '', laneIdx };
    },
    lanes: LANES.map((l) => l.name),
    tiers: TIERS.map((t) => ({ id: t as TierName, label: TIER_NAMES[t] })),
    gem: (tier, cls) => gemSvg(tier, cls),
    icon: (sp, o) => speciesIcon(sp, o),
    swatch(it) {
      const p = genomePalette(it.genome);
      const el = h('span', { class: 'swatch', attrs: { 'aria-hidden': 'true' } });
      el.style.setProperty('--sw-a', hex(p.glow));
      el.style.setProperty('--sw-b', hex(p.body));
      el.style.setProperty('--sw-c', hex(p.attenuation));
      return el;
    },
    mergeCost: MERGE_COST,
    holdMs: MERGE_HOLD_MS,
    topTierIdx: TOP_TIER_INDEX,
    focus: (it) => g.focusInstance({ genome: it.genome, itemId: it.id, nickname: null }),
    restore: () => { g.restorePrimary(); },
    playWith(it) {
      g.restorePrimary();
      const r = g.switchTo(it.id);
      return r === 'done' || r === 'queued';
    },
    playItemId: () => g.identity.itemId,
    async revealClaim(r: ClaimOk) {
      g.capsules.putAway();   // the gift's reveal makes its own capsule: the waiting one comes back after it
      await g.ceremonies.playReveal(itemView(r.item, r.is_new, r.copies, r.quick), { capsule: null });
    },
    async replayReveal(it) {
      const copies = g.hoard.items().filter((x) => x.species === it.species).length;
      g.capsules.putAway();
      await g.ceremonies.playReveal(itemView(it, copies === 1, copies), { capsule: null });
    },
    async playMerge(r: MergeOk) {
      await g.playMerge(r.parents.map((p) => ({ genome: p.genome, tier: p.tier as TierName })), { ...itemView(r.item, r.is_new, r.copies), tierUp: r.tier_up });
    },
    busy,
    whenIdle(fn) { if (!busy()) fn(); else idle.push(fn); },
    openCapsule: () => g.capsules.openNext(),
    mat: {
      get count() { return g.mat.count; },
      get limit() { return g.mat.limit; },
      has: (id) => g.mat.has(id),
      refusal(it) { const r = g.mat.refusal({ genome: it.genome, itemId: it.id }); return r ? matRefusalCopy(r, g.mat.limit) : null; },
      bringOut(it) {
        g.restorePrimary();   // the card showed it as the live squishy: the player's own comes back, this one joins it on the mat
        const r = g.mat.add({ genome: it.genome, itemId: it.id, tier: it.tier as TierName, name: it.name });
        return r ? matRefusalCopy(r, g.mat.limit) : null;
      },
      putBack: (id) => { g.mat.remove(id); },
      clear: () => g.mat.clear(),
      onChange: (fn) => g.mat.onChange(fn),
    },
    holdInput: (on) => g.holdInput('hoard', on),
    cover: (on) => { if (on) g.suspend('covered'); else g.unsuspend('covered'); },
    announce: d.announce,
    toast: d.toast,
    now: () => g.epochNow(),
    calm: () => g.settings.calm,
    returnFocus: d.returnFocus,
  };
}
