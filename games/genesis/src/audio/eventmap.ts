// GENESIS — what each sim event sounds like (CONTRACT §17). Pure: SimEvent → a cue for the SFX catalog (sfx.ts) with
// its class, loudness, priority, reach and how often it may repeat; no WebAudio here (tests/audio.test.ts checks that
// every disaster kind, every miracle and every hand act has a sound).
//
// Classes decide how distance is heard (engine.ts):
//   god   — the player's own acts (the hand, miracles): always heard, placed where they happen.
//   world — physical sounds (impacts, thunder, quakes, splashes, a launch): attenuated by distance, and the far ones
//           arrive late (sound travels at 343 m/s: the flash first, then the boom).
//   news  — things that happened to a people (a discovery's chime, a death's distant toll, war horns, a founding):
//           heard wherever the camera is, softly when far, panned toward where it happened.
// At 1000x a world produces hundreds of events a second; each cue has a minimum gap and coalesces the events that
// fall inside it into a count (one toll for many deaths, rung longer), and classes have a global rate cap.

import type { SimEvent } from '../sim/types.ts';
import disasterData from '../data/disasters.json' with { type: 'json' };

export type CueClass = 'god' | 'world' | 'news' | 'ui';

export interface CueSpec {
  /** SFX catalog name */
  cue: string;
  cls: CueClass;
  /** base loudness 0..1.5 */
  gain: number;
  /** magnitude the sound scales with (impact radius m, quake magnitude, throw speed m/s, …) */
  size: number;
  /** voice-steal priority 0..10 (higher survives) */
  pri: number;
  /** delay by distance at the speed of sound */
  travel: boolean;
  /** metres at which a 'world' sound has fallen to half power (scaled further by the listener's altitude) */
  reach: number;
  /** minimum real seconds between two plays of this cue (events inside the gap are coalesced) */
  gap: number;
  /** sub-kind: the miracle, the disaster kind, what landed, … */
  variant: string;
  /** the throttle key (defaults to cue) */
  key?: string;
}

// ───────────────────────────── disasters ─────────────────────────────

/** the stinger family of each disaster kind (disasters.json); `sfx.ts` has one recipe per family */
export const DISASTER_FAMILY: Record<string, string> = {
  meteor: 'incoming', 'meteor-shower': 'shower', comet: 'comet', swarm: 'swarm', volcano: 'eruption',
  supervolcano: 'eruption', quake: 'quake', sinkhole: 'collapse', rift: 'rift', flood: 'wave', tsunami: 'wave',
  drought: 'dry', hurricane: 'wind', tornado: 'wind', wildfire: 'fire', firestorm: 'fire', plague: 'plague',
  blight: 'blight', infestation: 'swarm', 'solar-flare': 'cosmic', 'impact-winter': 'cold', 'gravity-slip': 'gravity',
  'magnetic-storm': 'cosmic', eclipse: 'eclipse', 'moon-fall': 'celestial', 'rogue-flyby': 'celestial',
  'acid-rain': 'acid', 'ice-age': 'cold', 'heat-wave': 'heat', 'dust-bowl': 'dry', 'glass-storm': 'glass',
  overgrowth: 'growth', leviathan: 'leviathan', 'forgetting-fog': 'fog', stampede: 'stampede',
};

export const DISASTER_FAMILIES = [
  'incoming', 'shower', 'comet', 'swarm', 'eruption', 'quake', 'collapse', 'rift', 'wave', 'dry', 'wind', 'fire', 'plague',
  'blight', 'cosmic', 'cold', 'heat', 'gravity', 'eclipse', 'celestial', 'acid', 'glass', 'growth', 'leviathan', 'fog',
  'stampede',
] as const;

const CATEGORY_FAMILY: Record<string, string> = {
  sky: 'incoming', earth: 'quake', water: 'wave', weather: 'wind', fire: 'fire', life: 'plague', space: 'cosmic', world: 'celestial',
};
const DISASTER_CATEGORY = new Map<string, string>();
for (const d of (disasterData as unknown as { disasters: { id: string; category: string }[] }).disasters) DISASTER_CATEGORY.set(d.id, d.category);

/** the family of any disaster kind, including ones a mod or the freeform field invented */
export function disasterFamily(kind: string): string {
  const f = DISASTER_FAMILY[kind];
  if (f) return f;
  const cat = DISASTER_CATEGORY.get(kind);
  if (cat && CATEGORY_FAMILY[cat]) return CATEGORY_FAMILY[cat];
  const k = kind.toLowerCase();
  if (/meteor|asteroid|rock|star|bolide/.test(k)) return 'incoming';
  if (/quake|tremor|shake/.test(k)) return 'quake';
  if (/flood|wave|tide|water|deluge/.test(k)) return 'wave';
  if (/fire|flame|burn|inferno/.test(k)) return 'fire';
  if (/storm|wind|cyclone|gale|tornado|hurricane/.test(k)) return 'wind';
  if (/plague|sick|disease|pest|rot/.test(k)) return 'plague';
  if (/swarm|locust|insect|bug|frog/.test(k)) return 'swarm';
  if (/ice|frost|cold|snow|freeze|winter/.test(k)) return 'cold';
  if (/heat|sun|drought|dry|dust/.test(k)) return 'heat';
  if (/volcan|lava|erupt|magma/.test(k)) return 'eruption';
  if (/moon|planet|comet|world/.test(k)) return 'celestial';
  return 'cosmic';
}

// ───────────────────────────── miracles and commands ─────────────────────────────

/** every miracle the sim knows (god/miracles.ts) */
export const MIRACLE_KINDS = ['water', 'food', 'heal', 'forest', 'storm', 'fire', 'fireball', 'shield', 'lightning', 'wood', 'fertility', 'calm', 'teach', 'meteor'] as const;

/** the sound of a successful command, by its kind (null: silent, or another event carries its sound) */
export function commandCue(k: string): { cue: string; gain: number; gap: number; variant: string } | null {
  switch (k) {
    case 'hand.grab': return { cue: 'hand.grab', gain: 1, gap: 0.08, variant: '' };
    case 'hand.slap': return { cue: 'hand.slap', gain: 1.1, gap: 0.08, variant: '' };
    case 'hand.stroke': return { cue: 'hand.stroke', gain: 0.9, gap: 0.25, variant: '' };
    case 'hand.place': return { cue: 'hand.place', gain: 0.9, gap: 0.1, variant: '' };
    case 'hand.drop': return { cue: 'hand.drop', gain: 0.8, gap: 0.1, variant: '' };
    case 'hand.move': case 'hand.pose': case 'hand.release': case 'hand.throw': return null;
    case 'planet.add-air': return { cue: 'air.breathe', gain: 1, gap: 1, variant: '' };
    case 'planet.remove-air': return { cue: 'air.drain', gain: 1, gap: 1, variant: '' };
    case 'time.rewind': case 'time.edit-past': return { cue: 'rewind', gain: 1, gap: 0.5, variant: '' };
    case 'world.birth': case 'world.moon-add': return { cue: 'world.birth', gain: 1, gap: 1, variant: k };
    case 'creature.adopt': return { cue: 'creature.adopt', gain: 1, gap: 1, variant: '' };
    case 'fire.extinguish': return { cue: 'steam', gain: 0.9, gap: 0.3, variant: '' };
    case 'fire.ignite': case 'fire.firestorm': return { cue: 'fire.ignite', gain: 0.9, gap: 0.3, variant: '' };
    case 'focus': case 'time.scale': case 'time.speed': case 'time.step': case 'time.set-hour': return null;
  }
  const dot = k.indexOf('.');
  const pre = dot < 0 ? k : k.slice(0, dot);
  const rest = dot < 0 ? '' : k.slice(dot + 1);
  switch (pre) {
    case 'terrain': return { cue: 'shape', gain: 0.8, gap: 0.3, variant: rest };
    case 'water': return { cue: rest === 'rain' ? 'sky' : 'water.pour', gain: 0.8, gap: 0.3, variant: rest };
    case 'weather': return { cue: 'sky', gain: 0.8, gap: 0.4, variant: rest };
    case 'planet': case 'star': case 'orbit': return { cue: 'cosmos', gain: 0.9, gap: 0.6, variant: rest };
    case 'world': return rest === 'crack' || rest === 'erase' ? null : { cue: 'cosmos', gain: 0.9, gap: 0.6, variant: rest };
    case 'life': return /kill|cull|extinct|curse/.test(rest) ? { cue: 'life.wither', gain: 0.8, gap: 0.3, variant: rest } : { cue: 'life.bloom', gain: 0.8, gap: 0.3, variant: rest };
    case 'agent': case 'disciple': return { cue: 'touch', gain: 0.7, gap: 0.2, variant: rest };
    case 'settlement': case 'set': case 'rival': case 'ship': case 'belief': return { cue: 'decree', gain: 0.7, gap: 0.4, variant: rest };
    case 'idea': case 'content': return { cue: 'idea', gain: 0.8, gap: 0.4, variant: rest };
    case 'creature': return { cue: 'creature.call', gain: 0.7, gap: 0.4, variant: rest };
    // disasters and miracles are heard from their own events; meta / time / possess are silent bookkeeping
    case 'disaster': case 'miracle': case 'meta': case 'time': case 'possess': case 'hand': case 'fire': return null;
  }
  return { cue: 'decree', gain: 0.6, gap: 0.4, variant: k };
}

// ───────────────────────────── events ─────────────────────────────

function spec(cue: string, cls: CueClass, o: Partial<CueSpec> = {}): CueSpec {
  return {
    cue, cls, gain: o.gain ?? 1, size: o.size ?? 1, pri: o.pri ?? (cls === 'god' ? 9 : cls === 'world' ? 6 : 5),
    travel: o.travel ?? false, reach: o.reach ?? 400, gap: o.gap ?? 0.25, variant: o.variant ?? '', key: o.key,
  };
}

const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** the cue for a sim event (null: silent — the ambience or another event carries it) */
export function cueFor(e: SimEvent): CueSpec | null {
  const d = e.data ?? {};
  switch (e.t) {
    // ── the god's hand and miracles ──
    case 'thrown': return spec('hand.whoosh', 'god', { size: num(e.a, 20), gap: 0.05 });
    case 'lost': return spec('lost', 'god', { gap: 0.3 });
    case 'miracle': {
      const k = str(e.text) || str(d.kind);
      const known = (MIRACLE_KINDS as readonly string[]).includes(k);
      return spec(known ? `miracle.${k}` : 'miracle.cast', 'god', { size: num(e.a, 60), gain: 1, gap: 0.15, variant: k, pri: 9 });
    }
    case 'fireball': return spec('fireball', 'world', { size: num(e.a, 40), reach: 2500, travel: true, gap: 0.1, pri: 8 });
    case 'shield': return spec('shield', 'god', { size: num(e.a, 60), gap: 0.3 });
    case 'gift': return spec(str(e.text) === 'accepted' ? 'gift' : 'gift.refused', 'god', { gap: 0.4 });
    case 'creature.reward': return spec('creature.happy', 'god', { gap: 0.4 });
    case 'creature.punish': return spec('creature.hurt', 'god', { gap: 0.4 });
    case 'creature.learned': return spec('creature.learned', 'god', { gap: 1 });
    case 'rewind': return spec('rewind', 'god', { gap: 0.5 });
    case 'command': {
      const c = commandCue(str(d.k));
      return c ? spec(c.cue, 'god', { gain: c.gain, gap: c.gap, variant: c.variant, pri: 7 }) : null;
    }

    // ── physical ──
    case 'impact': {
      if (d.shielded) return spec('shield.hit', 'world', { size: num(e.a, 60), reach: 3000, travel: true, pri: 9, gap: 0.05 });
      const R = num(e.a, 20);
      return spec('impact', 'world', { size: R, gain: 1.1, reach: 300 + R * 14, travel: true, pri: 9, gap: 0.04, variant: str(d.kind) });
    }
    case 'lightning': return spec('thunder', 'world', { size: num(e.a, 1), reach: 2200, travel: true, gap: 0.35, pri: 6 });
    case 'quake': return spec('quake', 'world', { size: num(e.a, 6), reach: num(e.b, 400) * 3 + 900, pri: 8, gap: 0.8 });
    case 'eruption': return spec('eruption', 'world', { size: num(e.a, 1), reach: 3000, travel: true, pri: 8, gap: 0.6 });
    case 'landslide': return spec('landslide', 'world', { size: num(e.a, 1), reach: 700, travel: true, gap: 0.8 });
    case 'steam': return spec('steam', 'world', { size: num(e.a, 1), reach: 250, gap: 1.2, pri: 3 });
    case 'splash': return spec('splash', 'world', { size: num(e.a, 10), reach: 500, gap: 0.08, pri: 7 });
    case 'landed': return spec('landed', 'world', { size: num(e.a, 10), reach: 600, gap: 0.06, pri: 7, variant: str(d.payload) });
    case 'fire.start': return spec('fire.ignite', 'world', { reach: 350, gap: 0.6, pri: 5, variant: str(d.cause) });
    case 'fire.lit': return spec('fire.kindle', 'world', { reach: 140, gap: 2, gain: 0.6, pri: 2 });
    case 'healed': return spec('healed', 'world', { reach: 160, gap: 1.5, gain: 0.6, pri: 2 });
    case 'built': return spec('built', 'world', { reach: 650, gap: 0.8, gain: 0.85, pri: 4, variant: str(d.building) });
    case 'ship.built': return spec('built', 'world', { reach: 900, gap: 0.8, pri: 5, variant: 'ship' });
    case 'trade': return spec('trade', 'world', { reach: 350, gap: 3, gain: 0.7, pri: 2 });
    case 'theft': return spec('theft', 'world', { reach: 220, gap: 4, gain: 0.7, pri: 2 });
    case 'attack': return spec('attack', 'world', { reach: 260, gap: 2, pri: 4 });
    case 'launch': return spec('launch', 'world', { reach: 6000, travel: true, pri: 9, gap: 1, gain: 1.2, variant: str(d.kind) });
    case 'ship.countdown': return spec('countdown', 'world', { reach: 900, gap: 3, pri: 6 });
    case 'battle': return spec('battle', 'news', { reach: 1400, size: num(e.a, 5), gap: 2, pri: 6 });
    case 'weather.start': {
      const k = str(d.kind);
      return /storm|hurricane|blizzard|sandstorm|monsoon|thunder/.test(k) ? spec('weather.gust', 'world', { reach: 2200, gap: 3, pri: 4, variant: k }) : null;
    }
    case 'disaster': {
      const kind = str(d.kind) || str(e.text);
      return spec(`disaster.${disasterFamily(kind)}`, 'news', { size: num(e.a, 100), gain: 1.1, reach: 2500, pri: 8, gap: 0.5, variant: kind, key: `disaster:${kind}` });
    }
    case 'disaster.end': return spec('disaster.end', 'world', { reach: 2500, gap: 2, gain: 0.55, pri: 3, variant: str(d.kind) });

    // ── news of the peoples ──
    case 'discovery': return spec('discovery', 'news', { gain: 0.75, gap: 0.6, variant: str(d.how) === 'god' ? 'taught' : str(d.how), pri: 5 });
    case 'loss': return spec('loss', 'news', { gain: 0.8, gap: 1.6 });
    case 'refusal': return spec('refusal', 'news', { gain: 0.6, gap: 2 });
    case 'birth': return spec('birth', 'news', { gain: 0.5, gap: 1.2, pri: 3 });
    case 'death': return spec('death', 'news', { gain: 0.65, gap: 2.4, pri: 4, variant: str(d.cause) });
    case 'settlement.founded': return spec('founded', 'news', { gap: 1.5 });
    case 'settlement.fallen': return spec('fallen', 'news', { gap: 2, pri: 6 });
    case 'settlement.split': return spec('split', 'news', { gap: 2 });
    case 'war': return spec('war', 'news', { gap: 3, pri: 6 });
    case 'siege': return spec('siege', 'news', { gap: 4, pri: 5 });
    case 'conquest': return spec('conquest', 'news', { gap: 3, pri: 6 });
    case 'treaty': return spec('treaty', 'news', { gap: 3 });
    case 'plague': return spec('plague', 'news', { gap: 3, pri: 6 });
    case 'blight': return spec('blight', 'news', { gap: 3 });
    case 'extinction': return spec('extinction', 'news', { gap: 3 });
    case 'speciation': return spec('speciation', 'news', { gap: 3 });
    case 'age': return spec(str(e.text) === 'golden' ? 'age.golden' : 'age.dark', 'news', { gap: 4, pri: 6 });
    case 'milestone': return spec('milestone', 'news', { gap: 2, pri: 6 });
    case 'orbit.first': return spec('orbit.first', 'news', { gap: 4, pri: 8 });
    case 'contact': return spec('contact', 'news', { gap: 3, pri: 6 });
    case 'conversion': return spec('conversion', 'news', { gap: 3 });
    case 'worship': return spec('worship', 'news', { gap: 3 });
    case 'rival.act': return spec('rival', 'news', { gap: 4 });
    case 'ship.orbit': return spec('ship.orbit', 'news', { gap: 3, pri: 6 });
    case 'ship.transfer': return spec('ship.transfer', 'news', { gap: 3 });
    case 'arrival': return spec('arrival', 'news', { gap: 3, pri: 6 });
    case 'colony': case 'ship.outpost': return spec('colony', 'news', { gap: 3, pri: 6 });
    case 'ship.lost': return spec('ship.lost', 'news', { gap: 3, pri: 6 });
    case 'ship.home': return spec('ship.home', 'news', { gap: 3 });
    case 'ship.program': return spec('ship.program', 'news', { gap: 4, gain: 0.7 });
    case 'ship.refused': case 'ship.spoiled': case 'ship.recalled': case 'ship.stranded': return spec('ship.fail', 'news', { gap: 4, gain: 0.7 });
    case 'world.cracked': return spec('world.cracked', 'news', { gap: 2, pri: 10, gain: 1.2 });
    case 'world.erased': return spec('world.erased', 'news', { gap: 2, pri: 10, gain: 1.2 });
    case 'world.abandoned': return spec('world.abandoned', 'news', { gap: 4 });
    case 'chronicle': return num(e.a) >= 3 ? spec('chronicle.great', 'news', { gap: 6, gain: 0.6 }) : null;
  }
  return null;
}

// ───────────────────────────── throttling ─────────────────────────────

/** global caps per class, cues per second (one cue coalesces many events) */
const CLASS_RATE: Record<CueClass, number> = { god: 20, world: 12, news: 5, ui: 20 };

/**
 * Per-cue minimum gaps and per-class rate caps in real time. `admit` returns how many events this play stands for
 * (the ones coalesced since the last play, including this one), or 0 when it must stay silent.
 */
export class CueGate {
  private last = new Map<string, number>();
  private pending = new Map<string, number>();
  private window = new Map<CueClass, number[]>();

  admit(s: CueSpec, now: number): number {
    const key = s.key ?? s.cue;
    const prev = this.last.get(key) ?? -Infinity;
    const n = (this.pending.get(key) ?? 0) + 1;
    if (now - prev < s.gap) { this.pending.set(key, n); return 0; }
    const w = this.window.get(s.cls) ?? [];
    while (w.length && now - w[0] > 1) w.shift();
    if (w.length >= CLASS_RATE[s.cls]) { this.pending.set(key, n); this.window.set(s.cls, w); return 0; }
    w.push(now);
    this.window.set(s.cls, w);
    this.last.set(key, now);
    this.pending.set(key, 0);
    return n;
  }

  reset(): void { this.last.clear(); this.pending.clear(); this.window.clear(); }
}
