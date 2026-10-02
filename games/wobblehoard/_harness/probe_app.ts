// Shell probe (plain node, exits 1 on failure): settings, save, haptics, hint timing, palette contrast, keyboard, and the
// app core driven with MOCK body/stage/audio: SoftEvent -> audio/haptics/shake/fx mapping, voice lifecycle, pause/resume,
// live settings, debug hook determinism. No DOM, no WebGL, no audio.
import { createApp } from '../src/app.ts';
import type { App } from '../src/app.ts';
import type { Settings, SoftEvent } from '../src/contracts.ts';
import { decodeGenome, encodeGenome, genomeEquals, makeStarterGenome, pitchRatio, randomGenome } from '../src/core/genome.ts';
import { mulberry32 } from '../src/core/rng.ts';
import {
  SETTINGS_KEY, defaultSettings, guardStorage, loadSettings, memoryStorage, safeLocalStorage, sanitizeSettings, saveSettings,
} from '../src/core/settings.ts';
import { PROFILE_BACKUP_KEY, PROFILE_KEY, createProfileStore, freshProfile, loadProfile, parseProfile, saveProfile } from '../src/core/save.ts';
import { HAPTIC_MS, createHaptics } from '../src/input/haptics.ts';
import { KEY_POINTER_ID, attachKeyboard } from '../src/input/keyboard.ts';
import { createHintController, HINT_IDLE_MS } from '../src/ui/hint.ts';
import { CONTRAST_PAIRS, DERIVED, PALETTE, contrastRatio, themeVars } from '../src/ui/theme.ts';
import { nameForGenome } from '../src/ui/names.ts';
import { createMockWorld } from './mocks.ts';
import type { MockWorld } from './mocks.ts';

let bad = 0;
let total = 0;
const check = (name: string, ok: boolean, extra = ''): void => { total++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`); };

// every console.error the app swallows must fail a probe
const errors: unknown[][] = [];
const realError = console.error;
console.error = (...a: unknown[]) => { errors.push(a); };

const ENV = { vibrate: true, reducedMotion: false };
const throwing = { getItem(): string | null { throw new Error('SecurityError'); }, setItem(): void { throw new Error('QuotaExceededError'); }, removeItem(): void { throw new Error('x'); } };

// ============================================================ settings
{
  const d = defaultSettings({ vibrate: true, reducedMotion: false });
  check('settings defaults: volume 0.8, boost 0.4, haptics on (vibrate present), shake 0.35, gravity, auto',
    d.volume === 0.8 && d.squishBoost === 0.4 && d.haptics === true && d.shake === 0.35 && d.gravity === true && d.quality === 'auto', JSON.stringify(d));
  check('settings defaults: haptics off where navigator.vibrate is missing', defaultSettings({ vibrate: false, reducedMotion: false }).haptics === false);
  check('settings defaults: shake 0 under prefers-reduced-motion', defaultSettings({ vibrate: true, reducedMotion: true }).shake === 0);
  const s = sanitizeSettings({ volume: 7, squishBoost: -3, shake: NaN, haptics: 'yes', gravity: 0, quality: 'ultra', extra: 1 }, d);
  check('sanitize: clamps numbers, rejects NaN / wrong types / unknown enum, drops unknown keys',
    s.volume === 1 && s.squishBoost === 0 && s.shake === d.shake && s.haptics === d.haptics && s.gravity === d.gravity && s.quality === 'auto' && !('extra' in s), JSON.stringify(s));
  check('sanitize: hostile roots (null, array, string, number) give the defaults',
    [null, [], 'x', 42, undefined].every((r) => JSON.stringify(sanitizeSettings(r, d)) === JSON.stringify(d)));
  check('sanitize: Infinity and "0.5" (string) are rejected, 0.5 kept', sanitizeSettings({ volume: Infinity }, d).volume === d.volume && sanitizeSettings({ volume: '0.5' }, d).volume === d.volume && sanitizeSettings({ volume: 0.5 }, d).volume === 0.5);
  const mem = memoryStorage();
  const mine: Settings = { volume: 0.25, squishBoost: 0.9, haptics: false, shake: 0, gravity: false, quality: 'high' };
  check('settings: save then load round-trips under the right key', saveSettings(mem, mine) && JSON.stringify(loadSettings(mem, ENV)) === JSON.stringify(mine) && mem.getItem('wobblehoard:v1:settings') !== null && SETTINGS_KEY === 'wobblehoard:v1:settings');
  mem.setItem(SETTINGS_KEY, '{not json');
  check('settings: corrupt JSON in storage gives the defaults (no throw)', JSON.stringify(loadSettings(mem, ENV)) === JSON.stringify(defaultSettings(ENV)));
  mem.setItem(SETTINGS_KEY, JSON.stringify({ volume: 99, quality: 'low', gravity: 'nope' }));
  const partial = loadSettings(mem, ENV);
  check('settings: a partly valid blob keeps the valid fields and clamps the rest', partial.volume === 1 && partial.quality === 'low' && partial.gravity === true);
  let threw = false;
  try { loadSettings(throwing, ENV); saveSettings(throwing, mine); const g = guardStorage(throwing); g.getItem('a'); g.setItem('a', 'b'); g.removeItem('a'); } catch { threw = true; }
  check('settings: blocked / private-mode storage (every call throws) never breaks anything', !threw && saveSettings(throwing, mine) === false);
  check('settings: no localStorage at all (node) -> safeLocalStorage() is null, load gives defaults', safeLocalStorage() === null && JSON.stringify(loadSettings(null, ENV)) === JSON.stringify(defaultSettings(ENV)) && saveSettings(null, mine) === false);
  // a write that is silently dropped (guarded storage) is reported as not saved
  check('settings: a dropped write is reported (saveSettings returns false)', saveSettings(guardStorage(throwing), mine) === false);
}

// ============================================================ save
{
  const mem = memoryStorage();
  const a = createProfileStore(mem);
  check('save: first visit creates the starter once and writes it at once', a.status === 'fresh' && mem.getItem(PROFILE_KEY) !== null && a.profile.instance.origin.kind === 'starter' && genomeEquals(a.profile.instance.genome, makeStarterGenome()) && a.profile.instance.name === 'Dollop' && a.writes === 1);
  const id = a.profile.instance.id;
  a.bump('pokes'); a.flush();
  const b = createProfileStore(mem);
  check('save: the starter keeps a STABLE id across sessions (the trade seam)', b.status === 'ok' && b.profile.instance.id === id && b.profile.stats.pokes === 1 && b.profile.instance.bornAt === a.profile.instance.bornAt);
  const raw = JSON.parse(mem.getItem(PROFILE_KEY)!);
  check('save: the envelope is { v:1, instance, stats:{pokes,squishes,pulls,releases} }', raw.v === 1 && typeof raw.instance.id === 'string' && Object.keys(raw.stats).sort().join() === 'pokes,pulls,releases,squishes' && Object.keys(raw).sort().join() === 'instance,stats,v');

  const cases: Array<[string, string]> = [
    ['bad JSON', '{oops'], ['empty array', '[]'], ['null', 'null'], ['number', '42'], ['v only', '{"v":1}'], ['v:0', '{"v":0,"instance":null}'],
  ];
  for (const [label, text] of cases) {
    const m = memoryStorage({ [PROFILE_KEY]: text });
    let r;
    try { r = createProfileStore(m); } catch { r = null; }
    check(`save: corrupt profile (${label}) -> fresh profile, never throws, old text parked`, !!r && r.status === 'corrupt' && r.profile.instance.origin.kind === 'starter' && m.getItem(PROFILE_BACKUP_KEY) === text && parseProfile(JSON.parse(m.getItem(PROFILE_KEY)!)) !== null);
  }
  const good = JSON.parse(mem.getItem(PROFILE_KEY)!);
  const mutate = (fn: (p: any) => void): string => { const p = JSON.parse(JSON.stringify(good)); fn(p); return JSON.stringify(p); };
  const shapes: Array<[string, string]> = [
    ['genome hue out of range', mutate((p) => { p.instance.genome.hue = 400; })],
    ['genome unit field > 1', mutate((p) => { p.instance.genome.firmness = 2; })],
    ['genome bad species', mutate((p) => { p.instance.genome.species = 'dragon'; })],
    ['genome missing', mutate((p) => { delete p.instance.genome; })],
    ['instance id missing', mutate((p) => { delete p.instance.id; })],
    ['instance id empty', mutate((p) => { p.instance.id = ''; })],
    ['tradeCount negative', mutate((p) => { p.instance.tradeCount = -1; })],
    ['origin kind unknown', mutate((p) => { p.instance.origin.kind = 'gift'; })],
    ['name not a string', mutate((p) => { p.instance.name = 5; })],
    ['NaN seed', mutate((p) => { p.instance.genome.seed = 'x'; })],
  ];
  const allCorrupt = shapes.every(([, text]) => { const m = memoryStorage({ [PROFILE_KEY]: text }); return loadProfile(m).status === 'corrupt'; });
  check(`save: ${shapes.length} wrong-shape variants (bad genome / id / origin / counts) all load as a fresh profile`, allCorrupt);
  const lenient = loadProfile(memoryStorage({ [PROFILE_KEY]: mutate((p) => { p.stats = { pokes: -5, squishes: 'x', pulls: 3.9 }; }) }));
  check('save: damaged stats are coerced (not fatal): the squishy and its id survive', lenient.status === 'ok' && lenient.profile.instance.id === id && lenient.profile.stats.pokes === 0 && lenient.profile.stats.squishes === 0 && lenient.profile.stats.pulls === 3 && lenient.profile.stats.releases === 0);
  const newer = memoryStorage({ [PROFILE_KEY]: JSON.stringify({ v: 2, instance: { future: true } }) });
  const before = newer.getItem(PROFILE_KEY);
  const nv = createProfileStore(newer);
  nv.bump('pokes'); nv.flush(); nv.dispose();
  check('save: a profile from a NEWER build (v:2) is never overwritten', nv.status === 'newer' && newer.getItem(PROFILE_KEY) === before && newer.getItem(PROFILE_BACKUP_KEY) === null);
  check('save: genome in a stored profile is re-quantised to the canonical grid', (() => { const g = JSON.parse(JSON.stringify(good)); g.instance.genome.chroma = 0.123456789; const p = parseProfile(g)!; return decodeGenome(encodeGenome(p.instance.genome)) !== null && genomeEquals(decodeGenome(encodeGenome(p.instance.genome))!, p.instance.genome); })());

  // throttling with fake timers
  let t = 0;
  const timers: Array<{ at: number; fn: () => void }> = [];
  const m2 = memoryStorage();
  const st = createProfileStore(m2, { throttleMs: 2000, now: () => t, setTimer: (fn, ms) => { const h = { at: t + ms, fn }; timers.push(h); return h; }, clearTimer: (h) => { const i = timers.indexOf(h as never); if (i >= 0) timers.splice(i, 1); } });
  const w0 = st.writes;
  for (let i = 0; i < 1000; i++) st.bump(i % 2 ? 'pokes' : 'squishes');
  check('save: 1000 bumps at once cost at most one extra write, the rest is one trailing timer', st.writes - w0 <= 1 && timers.length <= 1, `writes +${st.writes - w0}, timers ${timers.length}`);
  t = 2500; for (const h of timers.splice(0)) h.fn();
  check('save: the trailing write lands and carries every count', JSON.parse(m2.getItem(PROFILE_KEY)!).stats.pokes === 500 && JSON.parse(m2.getItem(PROFILE_KEY)!).stats.squishes === 500);
  const w1 = st.writes; st.flush(); st.flush();
  check('save: flush with nothing dirty writes nothing', st.writes === w1);
  st.bump('pulls'); st.flush();
  check('save: flush writes immediately when dirty', JSON.parse(m2.getItem(PROFILE_KEY)!).stats.pulls === 1);
  let threw2 = false;
  try { const s3 = createProfileStore(throwing); s3.bump('pokes'); s3.flush(); s3.dispose(); loadProfile(throwing); saveProfile(throwing, freshProfile()); createProfileStore(null).bump('pokes'); } catch { threw2 = true; }
  check('save: a storage that throws on every call (private mode) is survived', !threw2);
}

// ============================================================ haptics
{
  const calls: number[] = [];
  let tNow = 0;
  const hp = createHaptics({ vibrate: (p) => { calls.push(p as number); return true; }, now: () => tNow });
  hp.poke(); hp.release(); hp.pop();
  check('haptics: poke 8 ms, release 18 ms, pop 6 ms', calls.join() === `${HAPTIC_MS.poke},${HAPTIC_MS.release},${HAPTIC_MS.pop}` && calls.join() === '8,18,6', calls.join());
  calls.length = 0;
  hp.squeeze(0.1); hp.squeeze(2); tNow += 10; hp.squeeze(2); tNow += 200; hp.squeeze(2); tNow += 200; hp.squeeze(8);
  check('haptics: squeeze pulse is rate-scaled, throttled, and silent when barely moving', calls.length === 3 && calls[0] < calls[2] && calls.every((c) => c >= 3 && c <= 14), calls.join());
  calls.length = 0; hp.setEnabled(false); hp.poke(); hp.squeeze(5); hp.release(); hp.pop();
  check('haptics: disabled = nothing vibrates (only the cancel buzz 0)', calls.every((c) => c === 0), calls.join());
  const none = createHaptics({ vibrate: null });
  let ok = true;
  try { none.poke(); none.squeeze(3); none.release(); none.pop(); none.cancel(); none.setEnabled(true); } catch { ok = false; }
  check('haptics: unsupported (no navigator.vibrate) is a quiet no-op', ok && none.supported === false);
  const thr = createHaptics({ vibrate: () => { throw new Error('NotAllowedError'); } });
  let ok2 = true;
  try { thr.poke(); thr.release(); } catch { ok2 = false; }
  check('haptics: a vibrate() that throws is swallowed', ok2);
}

// ============================================================ hint timing, palette, names
{
  const hc = createHintController();
  check('hint: visible before the first interaction', hc.visible(0) && hc.visible(50000));
  hc.interact(1000);
  check('hint: hidden right after an interaction and for 20 s', !hc.visible(1000) && !hc.visible(1000 + HINT_IDLE_MS - 1));
  check('hint: comes back after 20 s idle', hc.visible(1000 + HINT_IDLE_MS) && HINT_IDLE_MS === 20000);
  hc.interact(30000);
  check('hint: another interaction hides it again for another 20 s', !hc.visible(30001) && !hc.visible(49999) && hc.visible(50000));
}
{
  const failures = CONTRAST_PAIRS.filter((p) => contrastRatio(p.fg, p.bg) < p.min);
  check(`contrast: all ${CONTRAST_PAIRS.length} text / ring / edge pairs meet their WCAG minimum (text >= 4.5:1)`, failures.length === 0,
    failures.map((f) => `${f.name} ${contrastRatio(f.fg, f.bg).toFixed(2)}`).join('; ') || `min text ratio ${Math.min(...CONTRAST_PAIRS.filter((p) => p.min >= 4.5).map((p) => contrastRatio(p.fg, p.bg))).toFixed(2)}`);
  const vars = themeVars();
  check('theme: CONTRACT palette tokens are exact and exposed as --wh-* custom properties',
    PALETTE.ink === '#14102a' && PALETTE.plum === '#2a1744' && PALETTE.dusk === '#5b3a86' && PALETTE.felt === '#2a2150' && PALETTE.amber === '#ffb347' && PALETTE.lagoon === '#59d6e6' && PALETTE.coral === '#ff5a4d' && PALETTE.cream === '#fff1d6'
    && vars['--wh-ink'] === '#14102a' && vars['--wh-cream-dim'] === DERIVED.creamDim && vars['--wh-amber-deep'] === DERIVED.amberDeep);
  check('names: deterministic and non-empty', nameForGenome(randomGenome(3)) === nameForGenome(randomGenome(3)) && nameForGenome(randomGenome(3)).length > 1);
}

// ============================================================ helpers for the app probes
interface Rig { w: MockWorld; app: App; id: number }
function rig(o: { storage?: ReturnType<typeof memoryStorage> | null; auto?: boolean; overrides?: Partial<Settings>; muted?: boolean; genome?: ReturnType<typeof randomGenome>; phase?: 'play' | 'title' } = {}): Rig {
  const w = createMockWorld({ auto: o.auto, storage: o.storage ?? null });
  const app = createApp({ ...w.deps, overrides: o.overrides, muted: o.muted, genome: o.genome });
  app.resize(800, 600, 1);
  app.setPhase(o.phase ?? 'play');
  return { w, app, id: 1 };
}
const centre = (r: Rig): { x: number; y: number } => r.app.input.screenCentre()!;
const sq = (r: Rig): number => r.w.audio.rec.count('squishStart');
const clk = (r: Rig): number => r.w.clock.t;

/** press at (x,y) for `ms`, release, return the pointer id used */
function press(r: Rig, x: number, y: number, ms: number): number {
  const id = r.id++;
  r.app.input.pointerDown({ id, x, y, t: clk(r) });
  r.w.run(r.app, ms);
  r.app.input.pointerUp({ id, x, y, t: clk(r) });
  return id;
}

// ============================================================ boot + settings applied live
{
  const r = rig();
  check('app: boot builds the body once and hands it to the stage with the genome', r.w.bodies.length === 1 && r.w.stage.rec.count('setBody') === 1 && genomeEquals(r.w.stage.rec.of('setBody')[0].args[1] as never, makeStarterGenome()));
  const st = r.w.audio.rec.of('setSettings')[0].args[0] as { master: number; squishBoost: number; muted: boolean };
  check('app: boot applies settings to audio / stage / body', st.master === 0.8 && st.squishBoost === 0.4 && st.muted === false && r.w.stage.rec.of('setShakeScale')[0].args[0] === 0.35 && r.w.stage.rec.of('setQuality')[0].args[0] === 'auto' && r.w.body.gravity === true && r.w.stage.rec.of('setFloatMode')[0].args[0] === false);
  check('app: boot does not touch the audio before a gesture (no unlock, no voices)', r.w.audio.rec.count('unlock') === 0 && sq(r) === 0);

  r.app.setSetting('volume', 0.3); r.app.setSetting('squishBoost', 1); r.app.setSetting('shake', 0); r.app.setSetting('quality', 'low'); r.app.setSetting('gravity', false); r.app.setSetting('haptics', false);
  const last = r.w.audio.rec.of('setSettings').at(-1)!.args[0] as { master: number; squishBoost: number };
  check('settings live: volume + louder-squish reach audio.setSettings', last.master === 0.3 && last.squishBoost === 1);
  check('settings live: shake scale, quality tier, float mode and body.gravity apply at once', r.w.stage.rec.of('setShakeScale').at(-1)!.args[0] === 0 && r.w.stage.rec.of('setQuality').at(-1)!.args[0] === 'low' && r.w.stage.rec.of('setFloatMode').at(-1)!.args[0] === true && r.w.body.gravity === false);
  check('settings live: haptics switch reaches the haptics module', r.w.haptics.enabled === false);
  const n = r.w.stage.rec.count('setQuality');
  r.app.setSetting('volume', 0.31);
  check('settings live: an unrelated change does not re-apply quality (no needless render-target rebuild)', r.w.stage.rec.count('setQuality') === n);
  r.app.setSetting('volume', 5 as never); r.app.setSetting('quality', 'bogus' as never);
  check('settings live: out-of-range / invalid values are clamped or ignored', r.app.settings.volume === 1 && r.app.settings.quality === 'low');
  r.app.toggleGravity();
  check('toggleGravity flips between table and float', r.app.settings.gravity === true && r.w.body.gravity === true);
  const notified: boolean[] = []; r.app.onMute((m) => notified.push(m));
  r.app.toggleMute(); r.app.toggleMute();
  check('toggleMute mutes and unmutes the audio and notifies the UI', notified.join() === 'true,false' && (r.w.audio.rec.of('setSettings').at(-1)!.args[0] as { muted: boolean }).muted === false && (r.w.audio.rec.of('setSettings').at(-2)!.args[0] as { muted: boolean }).muted === true);
  check('?mute=1: starts muted', ((rig({ muted: true }).w.audio.rec.of('setSettings')[0].args[0]) as { muted: boolean }).muted === true);
}

// ============================================================ persistence of settings + URL overrides + stable id
{
  const mem = memoryStorage();
  const a = rig({ storage: mem });
  a.app.setSetting('volume', 0.33); a.app.setSetting('gravity', false);
  const b = rig({ storage: mem });
  check('persist: settings survive a reload through storage', b.app.settings.volume === 0.33 && b.app.settings.gravity === false && b.w.body.gravity === false);
  const mem2 = memoryStorage();
  const c = rig({ storage: mem2, overrides: { gravity: false, quality: 'low' } });
  check('URL overrides (?float=1 ?quality=low) apply but are not persisted', c.app.settings.gravity === false && c.app.settings.quality === 'low' && mem2.getItem(SETTINGS_KEY) === null);
  c.app.setSetting('volume', 0.5);
  const stored = JSON.parse(mem2.getItem(SETTINGS_KEY)!);
  check('URL overrides stay session-only when the player changes something else', stored.gravity === true && stored.quality === 'auto' && stored.volume === 0.5 && c.app.settings.gravity === false);
  c.app.setSetting('gravity', true);
  check('...but a deliberate change to an overridden key wins and is saved', JSON.parse(mem2.getItem(SETTINGS_KEY)!).gravity === true && c.app.settings.gravity === true);
  const id1 = a.app.instance.id;
  check('stable id: a second session on the same storage gets the same squishy instance', b.app.instance.id === id1 && b.app.name === 'Dollop');
  const gmem = memoryStorage();
  const g = rig({ storage: gmem, genome: randomGenome(5) });
  const prof = loadProfile(gmem).profile;
  check('?genome= previews another squishy but never overwrites the stored starter', genomeEquals(prof.instance.genome, makeStarterGenome()) && genomeEquals(g.app.genome, randomGenome(5)) && g.app.name === nameForGenome(randomGenome(5)));
}

// ============================================================ tap -> poke mapping, sub-frame taps
{
  const r = rig();
  const c = centre(r);
  const id = r.id++;
  r.app.input.pointerDown({ id, x: c.x, y: c.y, t: clk(r) });
  r.app.input.pointerUp({ id, x: c.x, y: c.y, t: clk(r) });   // down and up in the SAME instant: no frame between
  check('tap: fingerDown reaches the body at once with the 0.55 pressure target', r.w.body.rec.count('fingerDown') === 1 && r.w.body.rec.of('fingerPressure')[0].args[1] === 0.55);
  check('tap: a sub-frame tap keeps the finger down (min contact) instead of vanishing before the physics saw it', r.w.body.rec.count('fingerUp') === 0 && r.w.body.fingerIsDown(0));
  r.w.run(r.app, 250);
  check('tap: the finger lifts after the minimum contact, and exactly one poke came out', r.w.body.rec.count('fingerUp') === 1 && !r.w.body.fingerIsDown(0) && r.w.body.emitted.poke === 1);
  check('poke -> audio.poke (pitch from genome, pan), haptics 8 ms tick, small stage.shake, stats.pokes', r.w.audio.rec.count('poke') === 1 && typeof (r.w.audio.rec.of('poke')[0].args[0] as { pitch: number }).pitch === 'number' && r.w.haptics.rec.count('poke') === 1 && r.w.stage.rec.count('shake') >= 1 && (r.w.stage.rec.of('shake')[0].args[0] as number) < 0.25 && r.app.profile.profile.stats.pokes === 1);
  check('a tap leaves no squish voice behind', r.w.audio.live.size === 0 && sq(r) === 0);
}
{
  const r = rig();
  const c = centre(r);
  press(r, c.x - 90, c.y, 60);  r.w.run(r.app, 300);
  r.w.audio.rec.clear();
  press(r, c.x + 90, c.y, 60);  r.w.run(r.app, 300);
  const pans = [r.w.audio.rec.of('poke')[0].args[0] as { pan: number }];
  const l = rig(); const cl = centre(l); press(l, cl.x - 90, cl.y, 60); l.w.run(l.app, 300);
  const lp = (l.w.audio.rec.of('poke')[0].args[0] as { pan: number }).pan;
  check('pan comes from the event screen x: left poke pans left (< 0), right poke pans right (> 0), centre ~ 0', lp < -0.1 && pans[0].pan > 0.1 && Math.abs(((): number => { const m = rig(); const cm = centre(m); press(m, cm.x, cm.y, 60); m.w.run(m.app, 300); return (m.w.audio.rec.of('poke')[0].args[0] as { pan: number }).pan; })()) < 0.15, `L ${lp.toFixed(2)} R ${pans[0].pan.toFixed(2)}`);
}

// ============================================================ hold -> press voice, release
{
  const r = rig();
  const c = centre(r);
  const id = r.id++;
  r.app.input.pointerDown({ id, x: c.x, y: c.y, t: clk(r) });
  r.w.run(r.app, 120);
  check('hold: no squish voice before the press event (0.18 s)', sq(r) === 0);
  r.w.run(r.app, 400);
  check('hold: press starts EXACTLY ONE squish voice and it is live', sq(r) === 1 && r.w.audio.live.size === 1 && r.w.body.emitted.press === 1);
  r.w.run(r.app, 2000);
  const v = r.w.audio.allVoices[0];
  check('hold: still one voice after 2.5 s, updated every frame with finite compression/rate/pan', sq(r) === 1 && v.updates.length > 100 && v.updates.every((u) => Number.isFinite(u.compression) && Number.isFinite(u.rate) && u.compression >= 0 && u.compression <= 1 && Math.abs(u.pan ?? 0) <= 0.8), `${v.updates.length} updates`);
  check('hold: compression fed to the voice rises as the squeeze deepens', v.updates.at(-1)!.compression > v.updates[0].compression);
  check('hold: pitch handed to the voice is exactly pitchRatio(genome)', (v.opts as { pitch: number }).pitch === pitchRatio(makeStarterGenome()), String((v.opts as { pitch: number }).pitch));
  check('hold: press pulses buzz the phone while squeezing (haptics.squeeze)', r.w.haptics.rec.count('squeeze') >= 1);
  const shakesBefore = r.w.stage.rec.count('shake');
  r.app.input.pointerUp({ id, x: c.x, y: c.y, t: clk(r) });
  r.w.run(r.app, 40);
  check('release: ends the voice (no leak), plays audio.release with the released compression, thump, shake, bubbles', r.w.audio.live.size === 0 && v.ended && r.w.audio.rec.count('release') === 1 && (r.w.audio.rec.of('release')[0].args[0] as { compression: number }).compression > 0.5 && r.w.haptics.rec.count('release') === 1 && r.w.stage.rec.count('shake') > shakesBefore && r.w.stage.rec.count('spawnFx') >= 1 && r.w.stage.rec.of('spawnFx').some((c) => c.args[0] === 'bubbles'));
  // pops: 1..3, each 40..120 ms apart. (the release itself was handled in the frame above)
  const t0 = clk(r);
  const popAt: number[] = [];
  let seen = r.w.audio.rec.count('pop');
  for (let i = 0; i < 400; i++) { r.w.clock.t += 2; r.app.frame(r.w.clock.t); const n = r.w.audio.rec.count('pop'); while (seen < n) { popAt.push(r.w.clock.t - t0); seen++; } }
  const total = r.w.audio.rec.count('pop');
  const gaps = popAt.map((t, i) => t - (i ? popAt[i - 1] : 0));
  check('release with intensity > 0.5: one to three pops, each 40-120 ms after the last', total >= 1 && total <= 3 && gaps.slice(1).every((g) => g >= 38 && g <= 124), `${total} pops, gaps ${gaps.join('/')} ms`);
  check('release: one haptic pop per audio pop', r.w.haptics.rec.count('pop') === total);
  check('release: stats counted (1 squish, 1 release)', r.app.profile.profile.stats.squishes === 1 && r.app.profile.profile.stats.releases === 1);
}

// ============================================================ manual events: land, leaks without a release event, two fingers
{
  const r = rig({ auto: false });
  r.w.body.queue({ kind: 'land', intensity: 0.8, finger: -1, at: { x: 0, y: 0, z: 0 } });
  r.w.run(r.app, 20);
  const fx = r.w.stage.rec.of('spawnFx').map((c) => c.args[0]);
  check('land -> audio.land, dust + ring fx, stage.shake', r.w.audio.rec.count('land') === 1 && fx.includes('dust') && fx.includes('ring') && r.w.stage.rec.count('shake') === 1);
  r.w.body.queue({ kind: 'land', intensity: 0.15, finger: -1 });
  r.w.run(r.app, 20);
  check('a soft land makes dust but no ring', r.w.stage.rec.of('spawnFx').map((c) => c.args[0]).filter((k) => k === 'ring').length === 1 && r.w.stage.rec.of('spawnFx').filter((c) => c.args[0] === 'dust').length === 2);
}
{
  // the contract only emits 'release' when compression > 0.08: a press voice must still end when the finger lifts without one
  const r = rig({ auto: false });
  const c = centre(r);
  const id = r.id++;
  r.app.input.pointerDown({ id, x: c.x, y: c.y, t: clk(r) });
  r.w.run(r.app, 50);
  r.w.body.queue({ kind: 'press', finger: 0, intensity: 0.05 });
  r.w.run(r.app, 50);
  check('leak guard: press (no auto physics) opens the voice while the finger is down', sq(r) === 1 && r.w.audio.live.size === 1);
  r.app.input.pointerUp({ id, x: c.x, y: c.y, t: clk(r) });
  r.w.run(r.app, 200);
  check('leak guard: finger up WITHOUT any release event still ends the voice', r.w.audio.live.size === 0 && r.w.audio.allVoices[0].ended && r.w.audio.rec.count('release') === 0);
  // a late press event for a finger that is already up must not open a voice at all
  r.w.body.queue({ kind: 'press', finger: 0, intensity: 0.5 });
  r.w.run(r.app, 50);
  check('leak guard: a late press event for a lifted finger starts nothing', sq(r) === 1 && r.w.audio.live.size === 0);
  r.w.body.queue({ kind: 'press', finger: 1, intensity: 0.5 });
  r.w.run(r.app, 50);
  check('leak guard: a press event for a finger we never pressed starts nothing', sq(r) === 1);
}
{
  const r = rig();
  const c = centre(r);
  const a = r.id++, b = r.id++;
  r.app.input.pointerDown({ id: a, x: c.x - 40, y: c.y, t: clk(r) });
  r.app.input.pointerDown({ id: b, x: c.x + 40, y: c.y, t: clk(r) });
  r.w.run(r.app, 700);
  check('two fingers: fingerDown on slots 0 and 1, two voices (one per finger), never more', r.w.body.rec.of('fingerDown').map((x) => x.args[0]).join() === '0,1' && r.w.audio.live.size === 2 && sq(r) === 2);
  r.app.input.pointerUp({ id: a, x: c.x - 40, y: c.y, t: clk(r) });
  r.w.run(r.app, 200);
  check('two fingers: lifting one ends only its voice', r.w.audio.live.size === 1);
  r.app.input.pointerUp({ id: b, x: c.x + 40, y: c.y, t: clk(r) });
  r.w.run(r.app, 200);
  check('two fingers: lifting the other ends the last voice', r.w.audio.live.size === 0);
}

// ============================================================ pull -> grab voice, snap
{
  const r = rig();
  const c = centre(r);
  const disc = r.app.host.bodyScreen()!;
  const sx = c.x + disc.r * 0.6, sy = c.y;
  const id = r.id++;
  r.app.input.pointerDown({ id, x: sx, y: sy, t: clk(r) });
  r.w.run(r.app, 400);
  check('pull: a held press has its squish voice first', sq(r) === 1 && r.w.audio.live.size === 1);
  r.app.input.pointerMove({ id, x: sx + 40, y: sy, t: clk(r) });
  r.w.run(r.app, 60);
  check('pull: outward drag grabs a vertex and the finger is handed over (fingerUp then grab)', r.w.body.rec.count('grab') === 1 && r.w.body.rec.count('fingerUp') === 1 && !r.w.body.fingerIsDown(0) && r.w.body.grabIsActive(0));
  check('pull: the hand-over does NOT play a release bloop (no audio.release, no thump)', r.w.audio.rec.count('release') === 0 && r.w.haptics.rec.count('release') === 0);
  check('pull: the squish voice is swapped for ONE stretch voice (2 started, 1 live)', sq(r) === 2 && r.w.audio.live.size === 1 && r.w.audio.allVoices[0].ended && !r.w.audio.allVoices[1].ended);
  r.app.input.pointerMove({ id, x: sx + 90, y: sy - 20, t: clk(r) });
  r.w.run(r.app, 300);
  const gv = r.w.audio.allVoices[1];
  check('pull: the stretch voice is driven by body stretch (compression arg = metrics.stretch)', gv.updates.length > 5 && gv.updates.at(-1)!.compression > 0.3 && r.w.body.rec.count('grabMove') >= 1);
  check('pull: stats.pulls counted', r.app.profile.profile.stats.pulls === 1);
  r.app.input.pointerUp({ id, x: sx + 90, y: sy - 20, t: clk(r) });
  r.w.run(r.app, 60);
  check('snap: grabRelease -> voice ended, audio.release, pops, bubbles + glitter fx, thump', r.w.body.rec.count('grabRelease') === 1 && r.w.audio.live.size === 0 && r.w.audio.rec.count('release') === 1 && r.w.haptics.rec.count('release') === 1 && r.w.stage.rec.of('spawnFx').some((c) => c.args[0] === 'bubbles') && r.w.stage.rec.of('spawnFx').some((c) => c.args[0] === 'glitter'));
  r.w.run(r.app, 400);
  check('snap: one to three pops follow', r.w.audio.rec.count('pop') >= 1 && r.w.audio.rec.count('pop') <= 3, String(r.w.audio.rec.count('pop')));
}

// ============================================================ orbit / zoom reach the stage; phase gating
{
  const r = rig();
  r.app.input.pointerDown({ id: 7, x: 40, y: 40, t: clk(r) });
  r.app.input.pointerMove({ id: 7, x: 90, y: 60, t: clk(r) });
  r.app.input.pointerUp({ id: 7, x: 90, y: 60, t: clk(r) });
  const o = r.w.stage.rec.of('orbit');
  check('orbit: empty-space drag reaches stage.orbit with a finger-following sign (drag right = +yaw, down = +pitch)', o.length === 1 && (o[0].args[0] as number) > 0 && (o[0].args[1] as number) > 0 && r.w.body.rec.count('fingerDown') === 0);
  r.app.input.wheel(100); r.app.input.wheel(-100);
  const z = r.w.stage.rec.of('zoom').map((c) => c.args[0] as number);
  check('wheel zoom: deltaY > 0 = away (positive) one notch per 100 px', z.length === 2 && z[0] === 1 && z[1] === -1);
  const inter: number[] = [];
  r.app.onInteraction(() => inter.push(1));
  r.app.input.pointerDown({ id: 8, x: 300, y: 200, t: clk(r) }); r.app.input.pointerMove({ id: 8, x: 330, y: 200, t: clk(r) });
  check('interaction callback fires for gestures (hides the hint)', inter.length >= 1);
  const t = rig({ phase: 'title' });
  const c = (() => { t.app.setPhase('play'); const cc = centre(t); t.app.setPhase('title'); return cc; })();
  t.app.input.pointerDown({ id: 1, x: c.x, y: c.y, t: clk(t) }); t.app.input.wheel(300);
  check('phase gating: no input reaches the body or stage while the title card is up', t.w.body.rec.count('fingerDown') === 0 && t.w.stage.rec.count('zoom') === 0);
}

// ============================================================ pause / resume / hidden: no dt spike
{
  const r = rig();
  r.w.run(r.app, 200);
  const steps = (): number[] => r.w.body.rec.of('step').map((c) => c.args[0] as number);
  check('loop: dt per step is the real frame time (~16.7 ms)', Math.abs(steps().at(-1)! - 1 / 60) < 1e-6);
  r.w.clock.t += 500; r.app.frame(r.w.clock.t);
  check('loop: a 500 ms stall is clamped to 1/20 s', Math.abs(steps().at(-1)! - 0.05) < 1e-9);
  const c = centre(r);
  const id = r.id++;
  r.app.input.pointerDown({ id, x: c.x, y: c.y, t: clk(r) });
  r.w.run(r.app, 600);
  check('hidden: setup has a press voice and a finger down', r.w.audio.live.size === 1 && r.w.body.fingerIsDown(0));
  const n0 = r.w.body.stepCalls;
  r.app.setHidden(true);
  check('hidden: every finger is released and the voice ends at once', !r.w.body.fingerIsDown(0) && r.w.audio.live.size === 0 && r.app.input.isDown(id) === false);
  r.w.clock.t += 60000;
  for (let i = 0; i < 5; i++) { r.w.clock.t += 16; r.app.frame(r.w.clock.t); }
  check('hidden: the sim does not step while the tab is hidden', r.w.body.stepCalls === n0);
  check('hidden: audio is muted while hidden (this mock has no setPaused)', (r.w.audio.rec.of('setSettings').at(-1)!.args[0] as { muted: boolean }).muted === true);
  r.app.setHidden(false);
  r.w.clock.t += 16; r.app.frame(r.w.clock.t);
  check('resume after 60 s hidden: first step is a normal 1/60 s (NO dt spike)', Math.abs(steps().at(-1)! - 1 / 60) < 1e-9);
  check('resume: audio unmuted again', (r.w.audio.rec.of('setSettings').at(-1)!.args[0] as { muted: boolean }).muted === false);
  r.w.run(r.app, 300);
  check('after hide/resume the released press produced no surprise release bloop', r.w.audio.rec.count('release') === 0 && r.w.audio.live.size === 0);

  r.app.pause();
  const n1 = r.w.body.stepCalls;
  r.w.clock.t += 5000; r.app.frame(r.w.clock.t); r.app.frame(r.w.clock.t + 16);
  check('pause: the rAF frame does not step the sim', r.w.body.stepCalls === n1);
  r.app.resume();
  r.w.clock.t += 16; r.app.frame(r.w.clock.t);
  check('resume after pause: first step is a normal 1/60 s (NO dt spike)', Math.abs(steps().at(-1)! - 1 / 60) < 1e-9);
}
{
  // audio.setPaused is used when the audio engine offers it (the real one does)
  const r = rig();
  const calls: boolean[] = [];
  (r.w.audio as unknown as { setPaused: (p: boolean) => void }).setPaused = (p) => { calls.push(p); };
  r.app.setHidden(true); r.app.setHidden(false);
  check('hidden: uses audio.setPaused(true/false) when available (suspends the context), and does not need the mute fallback', calls.join() === 'true,false' && (r.w.audio.rec.of('setSettings').at(-1)!.args[0] as { muted: boolean }).muted === false);
}

// ============================================================ 1000 random taps: no voice leak, no error
{
  const r = rig();
  const rnd = mulberry32(2024);
  const c = centre(r);
  const disc = r.app.host.bodyScreen()!;
  let maxLive = 0, maxFingers = 0;
  const active: Array<{ id: number; x: number; y: number; until: number }> = [];
  for (let i = 0; i < 1000; i++) {
    const onBody = rnd() < 0.75;
    const x = onBody ? c.x + (rnd() - 0.5) * disc.r * 1.7 : rnd() * 800;
    const y = onBody ? c.y + (rnd() - 0.5) * disc.r * 1.5 : rnd() * 600;
    const id = r.id++;
    r.app.input.pointerDown({ id, x, y, t: clk(r) });
    const dur = rnd() < 0.5 ? 5 + rnd() * 120 : 150 + rnd() * 450;
    let px = x, py = y;
    const k = rnd();
    if (k < 0.12) { px = x + (rnd() - 0.5) * 120; py = y + (rnd() - 0.5) * 120; r.app.input.pointerMove({ id, x: px, y: py, t: clk(r) }); }
    // sometimes a second finger overlaps
    let id2 = -1;
    if (rnd() < 0.2) { id2 = r.id++; r.app.input.pointerDown({ id: id2, x: c.x + (rnd() - 0.5) * 100, y: c.y + (rnd() - 0.5) * 80, t: clk(r) }); }
    r.w.run(r.app, dur, 1000 / 60);
    r.app.input.pointerUp({ id, x: px, y: py, t: clk(r) });
    if (id2 >= 0) { if (rnd() < 0.15) r.app.input.pointerCancel(id2); else r.app.input.pointerUp({ id: id2, x: c.x, y: c.y, t: clk(r) }); }
    if (rnd() < 0.5) r.w.run(r.app, rnd() * 100, 1000 / 60);
    maxLive = Math.max(maxLive, r.w.audio.live.size);
    maxFingers = Math.max(maxFingers, (r.w.body.fingerIsDown(0) ? 1 : 0) + (r.w.body.fingerIsDown(1) ? 1 : 0));
    void active;
  }
  r.w.run(r.app, 2500, 1000 / 60);
  const started = r.w.audio.allVoices.length;
  check('1000 random taps/holds/drags: no live voice left, every voice that started ended', r.w.audio.live.size === 0 && r.w.audio.allVoices.every((v) => v.ended), `${started} voices started`);
  check('1000 random taps: no finger or grab left down on the body', !r.w.body.fingerIsDown(0) && !r.w.body.fingerIsDown(1) && !r.w.body.grabIsActive(0) && !r.w.body.grabIsActive(1) && r.app.input.isDown(1) === false);
  check('1000 random taps: never more than 2 voices at once and never more than 2 fingers on the body', maxLive <= 2 && maxFingers <= 2, `max live ${maxLive}, max fingers ${maxFingers}`);
  check('1000 random taps: voices <= press+grab events (a press voice needs a press event)', started <= (r.w.body.emitted.press ?? 0) + (r.w.body.emitted.grab ?? 0), `${started} voices, ${r.w.body.emitted.press ?? 0} press + ${r.w.body.emitted.grab ?? 0} grab events`);
  check('1000 random taps: every voice update was legal (no update() after end() raised an error)', errors.length === 0, `${errors.length} console.error calls`);
  check('1000 random taps: pokes happened and no scheduled pop is left dangling', (r.w.body.emitted.poke ?? 0) > 300 && r.app.profile.profile.stats.pokes === r.w.body.emitted.poke, `${r.w.body.emitted.poke} pokes`);
}

// ============================================================ debug hook: deterministic stepping while paused
{
  const script = (r: Rig): string => {
    const d = r.app.debug;
    d.pause();
    d.pointerDown(0.5, 0.5);
    d.step(1 / 60, 40);
    const mid = d.state();
    d.pointerMove(0.5, 0.52);
    d.step(1 / 60, 10);
    d.pointerUp();
    d.step(1 / 60, 60);
    const end = d.state();
    return JSON.stringify({ calls: r.w.body.rec.calls.map((c) => [c.name, c.args]), audio: r.w.audio.rec.calls.map((c) => [c.name, c.args]), mid: mid.events, endEvents: end.events, phase: end.phase });
  };
  const a = rig(), b = rig();
  const sa = script(a), sb = script(b);
  check('debug: paused + step() + synthetic pointer is perfectly repeatable (identical call logs)', sa === sb && sa.length > 1000, `${sa.length} chars`);
  const d = a.app.debug.state();
  check('debug: state() has phase, metrics, settings, genome, genomeCode, fps, stage, audio, events, stateHash', d.phase === 'play' && typeof d.metrics.compression === 'number' && d.settings.volume === 0.8 && d.genomeCode === encodeGenome(makeStarterGenome()) && typeof d.fps === 'number' && d.stage.tier === 'med' && 'started' in d.audio && Array.isArray(d.events) && typeof d.stateHash === 'number');
  const kinds = d.events.map((e) => e.kind);
  check('debug: the synthetic press produced poke -> press -> release events through the same gesture path (oldest first)', kinds[0] === 'poke' && kinds.includes('press') && kinds.at(-1) === 'release', kinds.join());
  check('debug: state().events keeps at most the last 32', (() => { const r = rig({ auto: false }); for (let i = 0; i < 100; i++) r.w.body.queue({ kind: 'land', intensity: 0.1 }); r.w.run(r.app, 50); return r.app.debug.state().events.length === 32; })());
  const r = rig();
  r.app.debug.pause();
  const n = r.w.body.stepCalls;
  r.app.debug.step(1 / 60, 25);
  check('debug: step(dt, n) advances exactly n fixed steps and renders (works while paused)', r.w.body.stepCalls === n + 25 && r.w.body.rec.of('step').slice(-25).every((c) => c.args[0] === 1 / 60) && r.w.stage.rec.count('render') >= 1);
  r.w.run(r.app, 500);
  check('debug: the rAF loop does not advance a paused sim', r.w.body.stepCalls === n + 25);
  r.app.debug.resume();
  r.w.run(r.app, 100);
  check('debug: resume() restarts the loop', r.w.body.stepCalls > n + 25);
  const un = rig();
  un.app.debug.step(1 / 60, 3);
  check('debug: step() while running pauses first (never interleaves with the rAF loop)', un.app.paused === true);
  const g = rig();
  g.app.debug.setGenome(7);
  check('debug: setGenome(seed) builds a new body, re-targets the stage, keeps the gravity mode', g.w.bodies.length === 2 && g.w.stage.rec.count('setBody') === 2 && genomeEquals(g.app.genome, randomGenome(7)) && g.w.bodies[1].gravity === true);
  g.app.debug.setGenome(encodeGenome(randomGenome(9)));
  check('debug: setGenome(share code) works too', genomeEquals(g.app.genome, randomGenome(9)));
  g.app.debug.setSetting('quality', 'high');
  check('debug: setSetting goes through the same validated pipeline', g.app.settings.quality === 'high' && g.w.stage.rec.of('setQuality').at(-1)!.args[0] === 'high');
  const shot = await g.app.debug.shot('probe_shot');
  void shot;
  const posted: string[] = [];
  const w2 = createMockWorld();
  const app2 = createApp({ ...w2.deps, postShot: async (name, url) => { posted.push(name + ':' + url.slice(0, 22)); return { ok: true, path: '/x/' + name + '.png' }; } });
  const sh = await app2.debug.shot('abc');
  check('debug: shot(name) renders then posts the canvas data URL under that name', sh.ok === true && posted[0] === 'abc:data:image/png;base64,' && w2.stage.rec.count('render') >= 1);
  g.app.debug.playSound('poke'); g.app.debug.playSound('release'); g.app.debug.playSound('land'); g.app.debug.playSound('pop'); g.app.debug.playSound('blend'); g.app.debug.playSound('squish');
  check('debug: playSound plays each named voice (squish = a held squelch that ends by itself)', g.w.audio.rec.count('poke') === 1 && g.w.audio.rec.count('release') === 1 && g.w.audio.rec.count('land') === 1 && g.w.audio.rec.count('pop') === 1 && g.w.audio.rec.count('blend') === 1 && g.w.audio.live.size === 1);
  g.w.run(g.app, 1800);
  check('lab: the scripted squish voice ends itself after its hold', g.w.audio.live.size === 0);
  g.app.lab.holdStart(); g.w.run(g.app, 300);
  const lv = g.w.audio.allVoices.at(-1)!;
  g.app.lab.holdEnd();
  check('lab: hold-start / hold-end drives a voice with a rising scripted compression', lv.ended && lv.updates.length > 5 && lv.updates.at(-1)!.compression > lv.updates[0].compression);
}

// ============================================================ audio unlock, fatal frame errors, dispose
{
  const r = rig();
  r.app.unlockAudio(); r.app.unlockAudio(); r.app.unlockAudio();
  check('unlockAudio: calls audio.unlock() from the gesture; once running it stops re-calling', r.w.audio.rec.count('unlock') === 1);
  const dead = rig();
  const cbs: Array<(t: number) => void> = [];
  let fatal: unknown = null;
  const w = createMockWorld();
  w.deps.raf = (cb) => { cbs.push(cb); return cbs.length; };
  const app = createApp({ ...w.deps, onFatal: (e) => { fatal = e; } });
  app.resize(800, 600, 1); app.setPhase('play');
  app.start();
  (w.stage as unknown as { update: () => void }).update = () => { throw new Error('boom'); };
  for (let i = 0; i < 4; i++) { const cb = cbs.shift()!; cb(i * 16); }
  const phaseOf = (): string => app.phase;
  const notYet = fatal === null && phaseOf() === 'play';
  for (let i = 0; i < 3; i++) { const cb = cbs.shift(); if (cb) cb(100 + i * 16); }
  check('fatal: a throwing frame is survived 4 times, then the app stops and reports (error card, never a frozen blank)', notYet && fatal instanceof Error && phaseOf() === 'error' && cbs.length === 0, `phase ${phaseOf()}`);
  void dead;
  const rr = rig();
  const c = centre(rr);
  rr.app.input.pointerDown({ id: 1, x: c.x, y: c.y, t: clk(rr) });
  rr.w.run(rr.app, 400);
  rr.app.dispose();
  check('dispose: releases the finger, ends voices, disposes the stage, flushes', !rr.w.body.fingerIsDown(0) && rr.w.audio.live.size === 0 && rr.w.stage.rec.count('dispose') === 1);
  const throwingStage = createMockWorld();
  throwingStage.deps.createStage = () => { throw new Error('no webgl'); };
  let msg = '';
  try { createApp(throwingStage.deps); } catch (e) { msg = (e as Error).message; }
  check('boot failure: a createStage that throws propagates (main.ts turns it into the friendly error card)', msg === 'no webgl');
  const throwingBody = createMockWorld();
  throwingBody.deps.createBody = () => { throw new Error('bad genome'); };
  let msg2 = '';
  try { createApp(throwingBody.deps); } catch (e) { msg2 = (e as Error).message; }
  check('boot failure: a createBody that throws disposes the half-built stage and propagates', msg2 === 'bad genome' && throwingBody.stage.rec.count('dispose') === 1);
}

// ============================================================ keyboard
{
  const r = rig();
  const target = new EventTarget();
  let closed = 0;
  const detach = attachKeyboard(target, r.app, { onEscape: () => { closed++; return closed < 3; } });
  const key = (type: string, key: string, extra: Record<string, unknown> = {}): Event => {
    const e = Object.assign(new Event(type, { cancelable: true }), { key, code: key === ' ' ? 'Space' : 'Key' + key.toUpperCase(), repeat: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false }, extra);
    target.dispatchEvent(e);
    return e;
  };
  const sp = key('keydown', ' ');
  check('keyboard: Space-down presses at the body centre through the same gesture path (fingerDown), page scroll prevented', r.w.body.rec.count('fingerDown') === 1 && r.app.input.isDown(KEY_POINTER_ID) && sp.defaultPrevented);
  key('keydown', ' ', { repeat: true });
  check('keyboard: auto-repeat of Space does not press again', r.w.body.rec.count('fingerDown') === 1);
  r.w.run(r.app, 60);
  key('keyup', ' ');
  r.w.run(r.app, 300);
  check('keyboard: Space tap = one poke (fingerUp after the minimum contact), and nothing left pressed', r.w.body.emitted.poke === 1 && r.w.audio.rec.count('poke') === 1 && !r.w.body.fingerIsDown(0) && !r.app.input.isDown(KEY_POINTER_ID));
  key('keydown', ' '); r.w.run(r.app, 500);
  check('keyboard: holding Space squishes (press -> a squish voice)', sq(r) === 1 && r.w.audio.live.size === 1);
  key('keyup', ' '); r.w.run(r.app, 200);
  check('keyboard: releasing Space ends it', r.w.audio.live.size === 0);
  key('keydown', 'g'); key('keydown', 'G');
  check('keyboard: G toggles gravity <-> float (twice = back)', r.app.settings.gravity === true && r.w.stage.rec.of('setFloatMode').length >= 3);
  key('keydown', 'g');
  check('keyboard: G once = float mode', r.app.settings.gravity === false && r.w.body.gravity === false);
  key('keydown', 'm');
  check('keyboard: M mutes', r.app.muted === true);
  key('keydown', 'm', { repeat: true });
  check('keyboard: a held M does not flicker the mute', r.app.muted === true);
  key('keydown', 'm');
  key('keydown', 'Escape'); key('keydown', 'Escape');
  check('keyboard: Escape asks the panel to close (consumed when it closed something)', closed === 2);
  const before = r.w.body.rec.count('fingerDown');
  key('keydown', ' ', { ctrlKey: true }); key('keydown', 'g', { metaKey: true });
  check('keyboard: Ctrl/Cmd shortcuts are left alone', r.w.body.rec.count('fingerDown') === before && r.app.settings.gravity === false);
  key('keydown', 'ArrowRight'); key('keydown', 'ArrowDown'); key('keydown', '+'); key('keydown', '-');
  const oo = r.w.stage.rec.of('orbit'), zz = r.w.stage.rec.of('zoom');
  check('keyboard extras: arrows orbit (right = +yaw, down = +pitch), + zooms in (delta < 0), - zooms out', oo.length === 2 && (oo[0].args[0] as number) > 0 && (oo[1].args[1] as number) > 0 && zz.length === 2 && (zz[0].args[0] as number) < 0 && (zz[1].args[0] as number) > 0);
  // while Space is held, losing focus must not leave a finger stuck
  key('keydown', ' ');
  target.dispatchEvent(new Event('blur'));
  r.w.run(r.app, 120);
  check('keyboard: window blur while Space is held releases the finger (no stuck press)', !r.w.body.fingerIsDown(0) && !r.app.input.isDown(KEY_POINTER_ID));
  detach();
  const b2 = r.w.body.rec.count('fingerDown');
  key('keydown', ' ');
  check('keyboard: detach removes the listeners', r.w.body.rec.count('fingerDown') === b2);

  // focused controls own Space and the arrows
  const r2 = rig();
  const btn = Object.assign(new EventTarget(), { tagName: 'BUTTON', getAttribute: () => null });
  attachKeyboard(btn, r2.app, { onEscape: () => false });
  const ev = Object.assign(new Event('keydown', { cancelable: true }), { key: ' ', code: 'Space', repeat: false, ctrlKey: false, metaKey: false, altKey: false });
  btn.dispatchEvent(ev);
  const slider = Object.assign(new EventTarget(), { tagName: 'INPUT', getAttribute: () => null });
  attachKeyboard(slider, r2.app, { onEscape: () => false });
  slider.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { key: 'ArrowRight', code: 'ArrowRight', repeat: false, ctrlKey: false, metaKey: false, altKey: false }));
  check('keyboard: Space on a focused button and arrows on a focused slider are NOT hijacked', r2.w.body.rec.count('fingerDown') === 0 && !ev.defaultPrevented && r2.w.stage.rec.count('orbit') === 0);
  const t3 = rig({ phase: 'title' });
  const tg = new EventTarget();
  attachKeyboard(tg, t3.app, { onEscape: () => false });
  tg.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { key: 'g', code: 'KeyG', repeat: false, ctrlKey: false, metaKey: false, altKey: false }));
  check('keyboard: shortcuts are inert while the title card is up', t3.app.settings.gravity === true && t3.w.body.rec.count('fingerDown') === 0);
}

console.error = realError;
console.log(`\n${total - bad}/${total} shell checks passed`);
process.exit(bad ? 1 : 0);
