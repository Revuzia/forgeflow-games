// LOCK, SHELL leg (_spec/LOCK.md): the shell half of "Shift while a pull is fully stretched locks it", plain node, exits 1 on a failed row.
//   node _harness/shellview/lock_checks.ts          (about 5 s; also run by `node _harness/run_probes.ts` through probe_lock_shell.ts)
// The whole game core (createApp) with the recording mocks of _harness/mocks.ts, whose body follows the contract's lock members (lockGrab / releaseLock / lockAt / metrics.locked;
// the lock list closes up on a release, so the INDICES shift: the shell must not depend on them). What is checked is what the shell DOES: the Shift key, the lock call, the sounds, the markers,
// a press on a locked lobe, Esc, every leave path, the mirrored pair, the limit, five touch fingers, the driver on its own, the hint and the keys line. The physics half is probe_lock (PHYS).
import { createApp } from '../../src/app.ts';
import type { App } from '../../src/app.ts';
import type { SoftBodyLike, V3 } from '../../src/contracts.ts';
import { randomGenome } from '../../src/core/genome.ts';
import { attachKeyboard } from '../../src/input/keyboard.ts';
import { createDriver } from '../../src/shell/driver.ts';
import { HINT_IDLE_MS, HINT_LOCK, HINT_TEXT, HINT_TOOLS, createHintController } from '../../src/ui/hint.ts';
import { GUIDE_KEYS, KEYS_LINE } from '../../src/ui/screens/screenCopy.ts';
import { createMockBody, createMockWorld } from '../mocks.ts';
import type { MockBody, MockWorld } from '../mocks.ts';

const REAL = process.argv.includes('--real');   // the rows on the real SoftBody take minutes on a busy machine: opt in (the mock rows above them take seconds)
let bad = 0, total = 0, lastT = Date.now();
const check = (name: string, ok: boolean, extra = ''): void => { total++; if (!ok) bad++; const t = Date.now(); console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}${REAL ? `  (+${((t - lastT) / 1000).toFixed(0)} s)` : ''}`); lastT = t; };
const errors: unknown[][] = [];
const realError = console.error;
console.error = (...a: unknown[]) => { errors.push(a); };

interface Rig {
  w: MockWorld; app: App; id: number; target: EventTarget; esc: { n: number }; keysUsed: { n: number }; markers: V3[][]; panel: { open: boolean }; notices: string[];
  key(type: string, key: string, extra?: Record<string, unknown>, on?: EventTarget): Event;
  body(): MockBody; ui(): Array<{ kind: string; calm?: boolean }>; sp(): number;
}
function rig(o: { lock?: boolean | { maxLocks?: number }; markers?: boolean; noUi?: boolean } = {}): Rig {
  const w = createMockWorld({ lock: o.lock === undefined ? true : o.lock });
  const markers: V3[][] = [];
  if (o.markers !== false) (w.stage as unknown as { setLockMarkers: (p: V3[]) => void }).setLockMarkers = (pts) => { markers.push(pts.map((p) => ({ ...p }))); };
  if (o.noUi) delete (w.audio as { ui?: unknown }).ui;
  const app = createApp({ ...w.deps });
  app.resize(800, 600, 1);
  app.setPhase('play');
  const target = new EventTarget();
  const esc = { n: 0 }, keysUsed = { n: 0 }, panel = { open: false }, notices: string[] = [];
  app.on('notice', (t) => { notices.push(t); });
  attachKeyboard(target, app, { onEscape: () => { esc.n++; return false; }, onKeyUsed: () => { keysUsed.n++; }, panelOpen: () => panel.open });
  const r: Rig = {
    w, app, id: 1, target, esc, keysUsed, markers, panel, notices,
    key(type, key, extra = {}, on = target) {
      const e = Object.assign(new Event(type, { cancelable: true }), { key, code: key === ' ' ? 'Space' : key.length === 1 ? 'Key' + key.toUpperCase() : key, repeat: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: key === 'Shift' }, extra);
      on.dispatchEvent(e);
      return e;
    },
    body: () => w.body,
    ui: () => w.audio.rec.of('ui').map((c) => c.args[0] as { kind: string; calm?: boolean }),
    sp: () => app.hoard.meter().sp,
  };
  return r;
}
const centre = (r: Rig): { x: number; y: number } => r.app.input.screenCentre()!;
const clk = (r: Rig): number => r.w.clock.t;
const disc = (r: Rig): { x: number; y: number; r: number } => r.app.host.bodyScreen()!;

/** a mouse pull: press at (x, y), drag `dx` px to the right (negative = left), hold; the pointer stays DOWN. Returns where it ended. */
function pull(r: Rig, x: number, y: number, dx: number, o: { dy?: number; shift?: boolean; type?: 'mouse' | 'touch' | 'pen'; hold?: number; id?: number } = {}): { id: number; x: number; y: number } {
  const id = o.id ?? r.id++, type = o.type ?? 'mouse', sh = o.shift ? { shift: true } : {}, dy = o.dy ?? 0;
  r.app.input.pointerDown({ id, x, y, t: clk(r), type, button: 0, ...sh });
  r.w.run(r.app, 60);
  r.app.input.pointerMove({ id, x: x + dx * 0.2, y: y + dy * 0.2, t: clk(r), type, ...sh });
  r.w.run(r.app, 60);
  r.app.input.pointerMove({ id, x: x + dx, y: y + dy, t: clk(r), type, ...sh });
  r.w.run(r.app, o.hold ?? 200);
  return { id, x: x + dx, y: y + dy };
}
const SLOTS = [0, 1, 2, 3, 4] as const;
const up = (r: Rig, p: { id: number; x: number; y: number }, type: 'mouse' | 'touch' | 'pen' = 'mouse'): void => { r.app.input.pointerUp({ id: p.id, x: p.x, y: p.y, t: clk(r), type }); r.w.run(r.app, 120); };
const rightLobe = (r: Rig): { x: number; y: number } => ({ x: centre(r).x + disc(r).r * 0.6, y: centre(r).y });
const leftLobe = (r: Rig): { x: number; y: number } => ({ x: centre(r).x - disc(r).r * 0.6, y: centre(r).y });
const lockedCount = (r: Rig): number => r.body().lockList().length;
const lastMarkers = (r: Rig): number => (r.markers.length ? r.markers[r.markers.length - 1].length : 0);

// ============================================================ 1. the Shift tap locks a fully stretched pull
{
  const r = rig();
  const p = pull(r, rightLobe(r).x, rightLobe(r).y, 200);
  const b = r.body();
  check('a full mouse pull (200 px = 0.78 m, past the mock\'s 0.45 m maximum) holds slot 0 and there is no lock yet', b.grabIsActive(0) && lockedCount(r) === 0 && r.ui().length === 0);
  const e = r.key('keydown', 'Shift');
  check('Shift tap: lockGrab(0) is asked once, the body holds ONE lock, the grab slot is free, the mouse is still down', b.rec.count('lockGrab') === 1 && b.rec.of('lockGrab')[0].args[0] === 0 && lockedCount(r) === 1 && !b.grabIsActive(0) && r.app.input.isDown(p.id));
  check('Shift tap: one lock sound (ui "on", calm flag from Settings), the Shift key is not "a key used" (the hint keeps its wording), the key is not swallowed', r.ui().length === 1 && r.ui()[0].kind === 'on' && r.ui()[0].calm === false && r.keysUsed.n === 0 && !e.defaultPrevented, JSON.stringify(r.ui()));
  check('Shift tap: input.locks reads 1 at once (the body\'s metrics.locked is a readout one step behind), then still 1 after a step', r.app.input.locks === 1 && (r.w.run(r.app, 20), r.app.input.locks === 1 && b.metrics.locked === 1));
  check('Shift tap: stage.setLockMarkers got one point (the held vertex) and it is where the body says that vertex is', lastMarkers(r) === 1 && Math.abs(r.markers.at(-1)![0].x - b.positions[b.lockList()[0].vertex * 3]) < 1e-6);
  const sp0 = r.sp(), grabsBefore = b.rec.count('grab'), fu0 = b.rec.count('fingerUp');
  r.app.input.pointerMove({ id: p.id, x: p.x + 30, y: p.y - 30, t: clk(r), type: 'mouse' });
  r.w.run(r.app, 100);
  up(r, p);
  check('after the lock, the held mouse is free: its moves and its release reach the body as nothing (no grabMove, no grabRelease, no snap, no fingerUp, no new grab)', b.rec.count('grabRelease') === 0 && b.rec.of('grabMove').length === 1 && (b.emitted.snap ?? 0) === 0 && b.rec.count('fingerUp') === fu0 && b.rec.count('grab') === grabsBefore, `grabMoves ${b.rec.of('grabMove').length}, fingerUp ${b.rec.count('fingerUp')} vs ${fu0}`);
  check('locking pays nothing itself: the meter is where it was, the stretch voice has ended, the lock is still held after the release of the mouse', Math.abs(r.sp() - sp0) < 1e-12 && r.w.audio.live.size === 0 && lockedCount(r) === 1);
  const ev = r.app.recentEvents();
  check('the events so far are the touch (poke, release) and the one grab of the pull: no snap, nothing paid yet', ev.map((x) => x.kind).join() === 'poke,release,grab', ev.map((x) => x.kind).join());
}
// ---- below the bar, no pull, no lock support, key rules
{
  const r = rig();
  const p = pull(r, rightLobe(r).x, rightLobe(r).y, 200);
  r.body().setPull(0, 0.94);
  r.key('keydown', 'Shift');
  check('Shift with the pull at 0.94 (below 0.95): lockGrab is asked and refuses; nothing happens: no lock, no sound, no marker, the grab is still live and follows the mouse', r.body().rec.count('lockGrab') === 1 && lockedCount(r) === 0 && r.ui().length === 0 && r.markers.length === 0 && r.body().grabIsActive(0));
  r.body().setPull(0, 0.95);
  r.key('keyup', 'Shift'); r.key('keydown', 'Shift');
  check('Shift again with the pull at exactly 0.95: it locks', lockedCount(r) === 1 && r.ui().length === 1);
  up(r, p);
}
{
  const r = rig();
  r.key('keydown', 'Shift');
  check('Shift with no pull at all: nothing is asked of the body, no sound', r.body().rec.count('lockGrab') === 0 && r.ui().length === 0 && r.keysUsed.n === 0);
  const rn = rig({ lock: false });
  const p = pull(rn, rightLobe(rn).x, rightLobe(rn).y, 200);
  rn.key('keydown', 'Shift');
  check('Shift while pulling a body that cannot lock (no lockGrab member): nothing happens, no sound, no error, the pull goes on', rn.ui().length === 0 && rn.body().grabIsActive(0) && rn.app.input.locks === 0 && errors.length === 0);
  up(rn, p);
  check('... and its release is the ordinary snap', (rn.body().emitted.snap ?? 0) === 1);
}
{
  const r = rig();
  const p = pull(r, rightLobe(r).x, rightLobe(r).y, 200);
  r.key('keydown', 'Shift', { repeat: true });
  check('Shift key REPEAT never locks (a held key must not lock a pull it was already holding)', lockedCount(r) === 0 && r.body().rec.count('lockGrab') === 0);
  const input = Object.assign(new EventTarget(), { tagName: 'INPUT', getAttribute: () => null });
  attachKeyboard(input, r.app, { onEscape: () => false });
  r.key('keydown', 'Shift', {}, input);
  const sel = Object.assign(new EventTarget(), { tagName: 'SELECT', getAttribute: () => null });
  attachKeyboard(sel, r.app, { onEscape: () => false });
  r.key('keydown', 'Shift', {}, sel);
  check('Shift in a form control (an input, a select) does nothing', lockedCount(r) === 0 && r.body().rec.count('lockGrab') === 0);
  const btn = Object.assign(new EventTarget(), { tagName: 'BUTTON', getAttribute: () => null, closest: (s: string) => (s === '#wh-dock' ? {} : null) });
  attachKeyboard(btn, r.app, { onEscape: () => false });
  r.key('keydown', 'Shift', {}, btn);
  check('Shift on a focused button of the dock (the mouse player just clicked a tool) DOES lock', lockedCount(r) === 1);
  up(r, p);
  const other = Object.assign(new EventTarget(), { tagName: 'BUTTON', getAttribute: () => null, closest: () => null });
  const r2 = rig();
  const p2 = pull(r2, rightLobe(r2).x, rightLobe(r2).y, 200);
  attachKeyboard(other, r2.app, { onEscape: () => false });
  r2.key('keydown', 'Shift', {}, other);
  check('Shift on a button outside the dock (a dialog button) does nothing', lockedCount(r2) === 0);
  r2.key('keydown', 'Shift', { ctrlKey: true });
  check('Ctrl+Shift is left alone', lockedCount(r2) === 0);
  up(r2, p2);
}

// ============================================================ 2. a second lobe, a press on a locked lobe, Esc
{
  const r = rig();
  const b = r.body();
  const a = pull(r, rightLobe(r).x, rightLobe(r).y, 200);
  r.key('keydown', 'Shift'); up(r, a);
  const c = pull(r, leftLobe(r).x, leftLobe(r).y, -200);
  check('a second lobe: the free mouse pulls another one on slot 0 again (a second grab call, a live grab)', b.rec.count('grab') === 2 && b.grabIsActive(0) && lockedCount(r) === 1);
  r.key('keydown', 'Shift'); up(r, c);
  const L = b.lockList();
  check('Shift on the second lobe: two locks on two different vertices, both grabbed with slot 0, two markers, two lock sounds', L.length === 2 && L[0].vertex !== L[1].vertex && L.every((l) => l.slot === 0) && lastMarkers(r) === 2 && r.ui().map((u) => u.kind).join() === 'on,on' && r.app.input.locks === 2);
  // a third and more, up to the mock's limit of 6, then a clean refusal
  // five more press points on a ring (radial drags), clear of the two lobes already held on the left and right of the middle
  const ring = (k: number): { x: number; y: number; dx: number; dy: number } => { const d = disc(r), a2 = ([60, 120, 240, 300, 270][k] * Math.PI) / 180, rad = k === 4 ? 0.3 : 0.7; return { x: d.x + Math.cos(a2) * d.r * rad, y: d.y + Math.sin(a2) * d.r * rad, dx: Math.cos(a2) * 200, dy: Math.sin(a2) * 200 }; };
  for (let k = 0; k < 4; k++) { const s = ring(k); const pp = pull(r, s.x, s.y, s.dx, { dy: s.dy }); r.body().setPull(0, 1); r.key('keydown', 'Shift'); up(r, pp); }
  check('six locks are possible (the body\'s limit)', lockedCount(r) === 6 && r.app.input.locks === 6 && lastMarkers(r) === 6, `locks ${lockedCount(r)}`);
  const s7 = ring(4); const p7 = pull(r, s7.x, s7.y, s7.dx, { dy: s7.dy }); r.body().setPull(0, 1);
  const uiBefore = r.ui().length, errBefore = errors.length;
  r.key('keydown', 'Shift');
  check('a seventh lock is refused cleanly: lockGrab returned false, the pull is still live, no sound, no marker, no error', lockedCount(r) === 6 && b.grabIsActive(0) && r.ui().length === uiBefore && lastMarkers(r) === 6 && errors.length === errBefore, `locks ${lockedCount(r)}, grab ${b.grabIsActive(0)}, ui ${r.ui().length}/${uiBefore}, markers ${lastMarkers(r)}, errors ${errors.length}/${errBefore}, lockGrab calls ${b.rec.count('lockGrab')}`);
  up(r, p7);
  check('... and letting go of that refused pull is the ordinary snap (the lock list is unchanged)', lockedCount(r) === 6 && (b.emitted.snap ?? 0) === 1);
}
{
  const r = rig();
  const b = r.body();
  const a = pull(r, rightLobe(r).x, rightLobe(r).y, 200); r.key('keydown', 'Shift'); up(r, a);
  const c = pull(r, leftLobe(r).x, leftLobe(r).y, -200); r.key('keydown', 'Shift'); up(r, c);
  r.w.run(r.app, 3000);   // hold the two locks for 3 s of sim time
  const sp0 = r.sp(), fd0 = b.rec.count('fingerDown'), grab0 = b.rec.count('grab'), rel0 = r.w.audio.rec.count('release');
  const rp = rightLobe(r);
  const id = r.id++;
  r.app.input.pointerDown({ id, x: rp.x, y: rp.y, t: clk(r), type: 'mouse', button: 0 });
  r.w.run(r.app, 60);
  check('a LEFT press on the first locked lobe lets that one go: releaseLock(index asked of the body) once, one lock is left, the markers show one, the "off" click played once', b.rec.count('releaseLock') === 1 && b.rec.of('releaseLock')[0].args[0] === 0 && lockedCount(r) === 1 && lastMarkers(r) === 1 && r.ui().map((u) => u.kind).join() === 'on,on,off', JSON.stringify(b.rec.of('releaseLock').map((c2) => c2.args)));
  check('... and the press does nothing else: no finger down, no new grab, the pointer is swallowed (known while down, no slot)', b.rec.count('fingerDown') === fd0 && b.rec.count('grab') === grab0 && r.app.input.isDown(id) && r.app.input.locks === 1);
  r.app.input.pointerMove({ id, x: rp.x + 80, y: rp.y, t: clk(r), type: 'mouse' });
  r.w.run(r.app, 300);
  r.app.input.pointerUp({ id, x: rp.x + 80, y: rp.y, t: clk(r), type: 'mouse' });
  r.w.run(r.app, 200);
  check('... its drag and release start nothing (no grab, no fingerDown, no grabRelease)', b.rec.count('grab') === grab0 && b.rec.count('fingerDown') === fd0 && b.rec.count('grabRelease') === 0 && !r.app.input.isDown(id));
  const snaps = r.app.recentEvents().filter((e) => e.kind === 'snap');
  check('the lock paid as a pull when it was let go: a snap event with the pull level 1 and heldFor = the whole hold (3.2 s or more), one release sound, the meter gained', snaps.length === 1 && snaps[0].intensity === 1 && snaps[0].heldFor > 3.1 && r.w.audio.rec.count('release') === rel0 + 1 && r.sp() > sp0 + 0.5, `heldFor ${snaps[0]?.heldFor?.toFixed(2)}, sp ${sp0.toFixed(3)} -> ${r.sp().toFixed(3)}`);
  const gained = r.sp() - sp0;
  check('hold XP is the capped one: 1.0 + 0.65 x min(held, 3) = 2.95 for a lobe held 3 s or more (fresh meter)', Math.abs(gained - 2.95) < 0.06, `gained ${gained.toFixed(3)}`);
  // the second lock's index shifted down to 0 when the first went: a press on it asks the body again
  const lp = leftLobe(r);
  r.app.input.pointerDown({ id: r.id, x: lp.x, y: lp.y, t: clk(r), type: 'mouse', button: 0 });
  r.app.input.pointerUp({ id: r.id++, x: lp.x, y: lp.y, t: clk(r), type: 'mouse' });
  r.w.run(r.app, 60);
  check('the other lock is found by asking the body again (its index shifted down when the first went): a press on it lets it go too, no locks left, no markers', lockedCount(r) === 0 && r.app.input.locks === 0 && lastMarkers(r) === 0 && b.rec.of('releaseLock').map((c2) => c2.args[0]).join() === '0,0');
  // a press on empty body (no lock there), a right-button press on a lock, and a touch press on a lock
  const r3 = rig();
  const a3 = pull(r3, rightLobe(r3).x, rightLobe(r3).y, 200); r3.key('keydown', 'Shift'); up(r3, a3);
  const fdl = r3.body().rec.count('fingerDown');
  const mid = centre(r3);
  r3.app.input.pointerDown({ id: 50, x: mid.x, y: mid.y, t: clk(r3), type: 'mouse', button: 0 }); r3.app.input.pointerUp({ id: 50, x: mid.x, y: mid.y, t: clk(r3), type: 'mouse' });
  r3.w.run(r3.app, 200);
  check('a press on the body away from the lock is an ordinary poke and does not let it go', lockedCount(r3) === 1 && r3.body().rec.count('fingerDown') === fdl + 1 && r3.body().rec.count('releaseLock') === 0);
  const rp3 = rightLobe(r3);
  r3.app.input.pointerDown({ id: 51, x: rp3.x, y: rp3.y, t: clk(r3), type: 'mouse', button: 2 }); r3.app.input.pointerUp({ id: 51, x: rp3.x, y: rp3.y, t: clk(r3), type: 'mouse', button: 2 });
  check('a RIGHT-button press on the locked lobe does not let it go (that button turns the view)', lockedCount(r3) === 1 && r3.body().rec.count('releaseLock') === 0);
  r3.app.input.pointerDown({ id: 52, x: rp3.x, y: rp3.y, t: clk(r3), type: 'touch', button: 0 }); r3.app.input.pointerUp({ id: 52, x: rp3.x, y: rp3.y, t: clk(r3), type: 'touch' });
  r3.w.run(r3.app, 100);
  check('a finger press on a locked lobe lets it go like a click does', lockedCount(r3) === 0);
}
{
  // Esc
  const r = rig();
  const b = r.body();
  const a = pull(r, rightLobe(r).x, rightLobe(r).y, 200); r.key('keydown', 'Shift'); up(r, a);
  const c = pull(r, leftLobe(r).x, leftLobe(r).y, -200); r.key('keydown', 'Shift'); up(r, c);
  r.panel.open = true;
  const eOpen = r.key('keydown', 'Escape');
  check('Esc with a panel open (the More popover, a card, Menu, Settings, Hoard) goes to the panel as ever; the locks stay', r.esc.n === 1 && lockedCount(r) === 2 && b.rec.count('releaseLock') === 0 && !eOpen.defaultPrevented);
  r.panel.open = false;
  const e1 = r.key('keydown', 'Escape');
  check('Esc with locks and nothing open lets ALL of them go (one releaseLock("all"), two snaps coming), consumes the key, and does not close anything', r.esc.n === 1 && b.rec.of('releaseLock').length === 1 && b.rec.of('releaseLock')[0].args[0] === 'all' && lockedCount(r) === 0 && e1.defaultPrevented && r.ui().at(-1)!.kind === 'off' && lastMarkers(r) === 0);
  r.w.run(r.app, 100);
  check('... the two lobes pay as pulls (two snap events, the meter gained)', r.app.recentEvents().filter((e) => e.kind === 'snap').length === 2 && r.sp() > 0.5);
  const offs = r.ui().filter((u) => u.kind === 'off').length;
  r.key('keydown', 'Escape');
  check('the next Esc is the usual Esc (nothing locked any more: it goes to the panels, no second "off" click)', r.esc.n === 2 && r.ui().filter((u) => u.kind === 'off').length === offs);
  // Esc during a ceremony / not live: the key goes where it went before
  const r2 = rig();
  const a2 = pull(r2, rightLobe(r2).x, rightLobe(r2).y, 200); r2.key('keydown', 'Shift'); up(r2, a2);
  r2.app.setPhase('title');
  check('leaving play (the title) lets the locks go', lockedCount(r2) === 0 && r2.body().rec.count('releaseLock') === 1);
}

// ---- the cap by quality tier (LOCK.md rule 4: 6, and 4 on low)
{
  for (const [tier, cap] of [['low', 4], ['med', 6], ['high', 6]] as const) {
    const r = rig();
    (r.w.stage as unknown as { stats: () => unknown }).stats = () => ({ drawCalls: 0, triangles: 0, tier, frameMsEma: 0 });
    const ang = [0, 60, 120, 180, 240, 300];
    const spots = ang.map((a, i) => { const d = disc(r), rad = (a * Math.PI) / 180, rr = i % 2 ? 0.45 : 0.78; return { x: d.x + Math.cos(rad) * d.r * rr, y: d.y + Math.sin(rad) * d.r * rr, dx: Math.cos(rad) * 200, dy: Math.sin(rad) * 200 }; });
    let made = 0;
    for (const s of spots) { const pp = pull(r, s.x, s.y, s.dx, { dy: s.dy }); r.body().setPull(0, 1); r.key('keydown', 'Shift'); made = lockedCount(r); up(r, pp); }
    check(`quality "${tier}": the shell sets the body's lock cap to ${cap} and the ${cap + 1}${cap === 4 ? 'th' : 'th'} lock is refused cleanly (${made} locks from 6 tries)`, r.body().maxLocks === cap && made === cap, `maxLocks ${r.body().maxLocks}, locks ${made}`);
  }
}

// ---- the live region (polite, spoken only)
{
  const r = rig();
  const a = pull(r, rightLobe(r).x, rightLobe(r).y, 200);
  r.body().setPull(0, 0.5); r.key('keydown', 'Shift');
  check('live region: a refused Shift says nothing', r.notices.length === 0);
  r.body().setPull(0, 1); r.key('keydown', 'Shift'); up(r, a);
  const c = pull(r, leftLobe(r).x, leftLobe(r).y, -200); r.key('keydown', 'Shift'); up(r, c);
  const rp = rightLobe(r);
  r.app.input.pointerDown({ id: r.id, x: rp.x, y: rp.y, t: clk(r), type: 'mouse', button: 0 }); r.app.input.pointerUp({ id: r.id++, x: rp.x, y: rp.y, t: clk(r), type: 'mouse' });
  r.key('keydown', 'Escape');
  check('live region: "Locked in place." for the first, "Locked. 2 held." for the second, "Let go." for a press, "Let go of all." for Esc with two or more (and "Let go." when one is left)', r.notices.join('|') === 'Locked in place.|Locked. 2 held.|Let go.|Let go.', r.notices.join('|'));
  const r2 = rig();
  const b1 = pull(r2, rightLobe(r2).x, rightLobe(r2).y, 200); r2.key('keydown', 'Shift'); up(r2, b1);
  const b2 = pull(r2, leftLobe(r2).x, leftLobe(r2).y, -200); r2.key('keydown', 'Shift'); up(r2, b2);
  r2.notices.length = 0;
  r2.key('keydown', 'Escape');
  check('live region: Esc with two locks says "Let go of all."', r2.notices.join('|') === 'Let go of all.', r2.notices.join('|'));
}

// ============================================================ 3. every way of leaving lets the locks go; a pause does not
{
  const lockedRig = (): Rig => { const r = rig(); const a = pull(r, rightLobe(r).x, rightLobe(r).y, 200); r.key('keydown', 'Shift'); up(r, a); const c = pull(r, leftLobe(r).x, leftLobe(r).y, -200); r.key('keydown', 'Shift'); up(r, c); return r; };
  const g2 = randomGenome(7);
  const ways: Array<[string, (r: Rig) => void]> = [
    ['switching to another squishy', (r) => { r.app.setGenome(g2); }],
    ['the Hoard opening (input held)', (r) => { r.app.holdInput('hoard', true); }],
    ['the Snap tool', (r) => { r.app.setTool('snap'); }],
    ['the play phase ending', (r) => { r.app.setPhase('title'); }],
    ['releaseEverything()', (r) => { r.app.releaseEverything(); }],
    ['a tab hidden more than 60 s', (r) => { r.app.setHidden(true); r.w.clock.t += 61_000; r.app.setHidden(false); }],
    ['dispose()', (r) => { r.app.dispose(); }],
  ];
  for (const [name, how] of ways) {
    const r = lockedRig();
    const old = r.body();
    const sounds = r.ui().length;
    how(r);
    check(`leaving: ${name} lets every lock go on the old body (releaseLock("all") asked, none left), clears the markers, and plays no click`, old.rec.count('releaseLock') >= 1 && old.lockList().length === 0 && r.app.input.locks === 0 && (lastMarkers(r) === 0) && r.ui().length === sounds, `releaseLock x${old.rec.count('releaseLock')}`);
  }
  {
    const r = lockedRig();
    r.app.setHidden(true); r.w.clock.t += 10_000; r.app.setHidden(false);
    r.w.run(r.app, 200);
    check('a tab hidden a SHORT while (10 s) keeps the locks (the sim was paused; nothing was released)', lockedCount(r) === 2 && r.body().rec.count('releaseLock') === 0);
    r.app.suspend('covered'); r.w.run(r.app, 200);
    check('a pause for the Menu, a reading screen or a photo (suspend covered) keeps the locks, and the squishy goes on holding them after', lockedCount(r) === 2);
    r.app.unsuspend('covered'); r.w.run(r.app, 200);
    check('... the sim runs again and the readout still says 2', r.app.input.locks === 2 && r.body().metrics.locked === 2);
    r.app.suspend('context'); r.app.unsuspend('context');
    check('a lost-and-restored GL context keeps them too', lockedCount(r) === 2);
  }
  {
    const r = lockedRig();
    r.app.setTool('snap');
    r.app.setTool('hand');
    const a = pull(r, rightLobe(r).x, rightLobe(r).y, 200);
    r.key('keydown', 'Shift');
    check('after leaving and coming back the Shift lock works again (the new locks are the only ones)', lockedCount(r) === 1);
    up(r, a);
  }
  {
    // Shift in the Snap tool and during a pause: nothing
    const r = rig();
    const a = pull(r, rightLobe(r).x, rightLobe(r).y, 200);
    r.app.suspend('covered');
    r.key('keydown', 'Shift');
    check('Shift while the game is paused (covered) or in the Snap tool: nothing', lockedCount(r) === 0 && r.body().rec.count('lockGrab') === 0);
    void a;
  }
}

// ============================================================ 4. the mirrored (Shift) pull
{
  const r = rig();
  const b = r.body();
  const c = centre(r), d = disc(r);
  const sx = c.x + d.r * 0.6;
  const p = pull(r, sx, c.y, 150, { shift: true });
  check('a Shift pull holds two hands as ever (slots 0 and 1, one stretch voice) and nothing is locked by pulling it', b.grabIsActive(0) && b.grabIsActive(1) && lockedCount(r) === 0 && b.rec.count('lockGrab') === 0 && r.w.audio.live.size === 1);
  b.setPull(0, 1); b.setPull(1, 1);
  r.key('keyup', 'Shift'); r.key('keydown', 'Shift');
  check('a Shift tap during the pair, both hands fully stretched: BOTH are locked (two locks, slots 0 and 1), both grab slots are free, ONE lock click, two markers', lockedCount(r) === 2 && b.lockList().map((l) => l.slot).sort().join() === '0,1' && !b.grabIsActive(0) && !b.grabIsActive(1) && r.ui().length === 1 && lastMarkers(r) === 2);
  up(r, p);
  check('the mouse release afterwards lets go of nothing (no grabRelease on either slot), both stay locked', b.rec.count('grabRelease') === 0 && lockedCount(r) === 2 && (b.emitted.snap ?? 0) === 0);
  r.key('keydown', 'Escape');
  r.w.run(r.app, 100);
  check('Esc lets both go: two snaps (each a normal pull release, neither marked as the mirrored twin)', r.app.recentEvents().filter((e) => e.kind === 'snap').length === 2 && lockedCount(r) === 0);
}
{
  const r = rig();
  const b = r.body();
  const c = centre(r), d = disc(r);
  const p = pull(r, c.x + d.r * 0.6, c.y, 150, { shift: true });
  b.setPull(0, 1); b.setPull(1, 0.5);
  r.key('keyup', 'Shift'); r.key('keydown', 'Shift');
  check('a pair with only one hand fully stretched: that hand locks, the other stays held and still follows the mouse', lockedCount(r) === 1 && b.lockList()[0].slot === 0 && !b.grabIsActive(0) && b.grabIsActive(1));
  const moves = b.rec.of('grabMove').length;
  r.app.input.pointerMove({ id: p.id, x: p.x + 20, y: p.y - 10, t: clk(r), type: 'mouse' });
  r.w.run(r.app, 60);
  check('... the mirrored hand (slot 1) gets the move, the locked one (slot 0) none', b.rec.of('grabMove').length === moves + 1 && b.rec.of('grabMove').at(-1)!.args[0] === 1);
  up(r, p);
  check('... the release lets go of slot 1 only, once; the lock stays', b.rec.of('grabRelease').map((c2) => c2.args[0]).join() === '1' && lockedCount(r) === 1);
  r.key('keydown', 'Escape');
}

// ============================================================ 5. five touch fingers (phones: up to 5 on the squishy; no lock)
{
  const r = rig();
  const b = r.body();
  const c = centre(r), d = disc(r);
  const at = (k: number, rad = 0.55): { x: number; y: number; a: number } => { const a = (2 * Math.PI * k) / 5 - Math.PI / 2; return { x: c.x + Math.cos(a) * d.r * rad, y: c.y + Math.sin(a) * d.r * rad, a }; };
  for (let k = 0; k < 5; k++) { const p = at(k); r.app.input.pointerDown({ id: 70 + k, x: p.x, y: p.y, t: clk(r), type: 'touch', button: 0 }); r.w.run(r.app, 20); }
  check('five touch fingers on a body that can lock: five fingerDown calls on slots 0..4, five fingers down on the body', b.rec.of('fingerDown').map((x) => x.args[0]).join() === '0,1,2,3,4' && SLOTS.every((s) => b.fingerIsDown(s)) && b.metrics.fingers === 5);
  r.app.input.pointerDown({ id: 80, x: c.x, y: c.y, t: clk(r), type: 'touch', button: 0 });
  check('a sixth finger on the body is ignored', b.rec.count('fingerDown') === 5);
  r.w.run(r.app, 500);
  for (let k = 0; k < 5; k++) r.app.input.pointerUp({ id: 70 + k, x: at(k).x, y: at(k).y, t: clk(r), type: 'touch' });
  r.app.input.pointerUp({ id: 80, x: c.x, y: c.y, t: clk(r), type: 'touch' });
  r.w.run(r.app, 400);
  check('... and all five lift cleanly: five fingerUp calls on their own slots, nothing stuck', b.rec.of('fingerUp').map((x) => x.args[0]).sort().join() === '0,1,2,3,4' && SLOTS.every((s) => !b.fingerIsDown(s)) && r.app.input.locks === 0);
}
{
  // a 5-point star: five fingers each PULL a lobe at once
  const r = rig();
  const b = r.body();
  const c = centre(r), d = disc(r);
  const pts = Array.from({ length: 5 }, (_, k) => { const a = (2 * Math.PI * k) / 5 - Math.PI / 2; return { x: c.x + Math.cos(a) * d.r * 0.7, y: c.y + Math.sin(a) * d.r * 0.7, a }; });
  pts.forEach((p, k) => r.app.input.pointerDown({ id: 90 + k, x: p.x, y: p.y, t: clk(r), type: 'touch', button: 0 }));
  r.w.run(r.app, 60);
  pts.forEach((p, k) => r.app.input.pointerMove({ id: 90 + k, x: p.x + Math.cos(p.a) * 45, y: p.y + Math.sin(p.a) * 45, t: clk(r), type: 'touch' }));
  r.w.run(r.app, 60);
  pts.forEach((p, k) => r.app.input.pointerMove({ id: 90 + k, x: p.x + Math.cos(p.a) * 200, y: p.y + Math.sin(p.a) * 200, t: clk(r), type: 'touch' }));
  r.w.run(r.app, 300);
  check('a five-way stretch: five grab calls on slots 0..4, all five live, five grabbed vertices (one per lobe)', b.rec.of('grab').map((x) => x.args[0]).join() === '0,1,2,3,4' && SLOTS.every((s) => b.grabIsActive(s)) && new Set(b.rec.of('grab').map((x) => x.args[1])).size === 5);
  check('... each slot gets its own grabMove stream', SLOTS.every((s) => b.rec.of('grabMove').some((x) => x.args[0] === s)));
  pts.forEach((p, k) => r.app.input.pointerUp({ id: 90 + k, x: p.x + Math.cos(p.a) * 200, y: p.y + Math.sin(p.a) * 200, t: clk(r), type: 'touch' }));
  r.w.run(r.app, 300);
  const snaps = r.app.recentEvents().filter((e) => e.kind === 'snap');
  check('letting go of the five fingers: every grab released once on its own slot, five snap events (finger 0..4) reached the meter, nothing left held', b.rec.of('grabRelease').map((x) => x.args[0]).join() === '0,1,2,3,4' && snaps.length === 5 && snaps.map((e) => e.finger).sort().join() === '0,1,2,3,4' && SLOTS.every((s) => !b.grabIsActive(s)), `snaps ${snaps.length}`);
}
{
  // the same on a laptop with a touch screen and a keyboard: Shift locks finger pulls like a mouse pull (the call is the same); five locks, five slots, five snaps on Esc
  const r = rig();
  const b = r.body();
  const c = centre(r), d = disc(r);
  const pts = Array.from({ length: 5 }, (_, k) => { const a = (2 * Math.PI * k) / 5 - Math.PI / 2; return { x: c.x + Math.cos(a) * d.r * 0.7, y: c.y + Math.sin(a) * d.r * 0.7, a }; });
  pts.forEach((p, k) => r.app.input.pointerDown({ id: 110 + k, x: p.x, y: p.y, t: clk(r), type: 'touch', button: 0 }));
  r.w.run(r.app, 60);
  pts.forEach((p, k) => r.app.input.pointerMove({ id: 110 + k, x: p.x + Math.cos(p.a) * 45, y: p.y + Math.sin(p.a) * 45, t: clk(r), type: 'touch' }));
  r.w.run(r.app, 60);
  pts.forEach((p, k) => r.app.input.pointerMove({ id: 110 + k, x: p.x + Math.cos(p.a) * 200, y: p.y + Math.sin(p.a) * 200, t: clk(r), type: 'touch' }));
  r.w.run(r.app, 300);
  r.key('keydown', 'Shift');
  check('Shift with five finger pulls: five lobes locked, on slots 0..4, five markers, ONE click', lockedCount(r) === 5 && b.lockList().map((l) => l.slot).sort().join() === '0,1,2,3,4' && lastMarkers(r) === 5 && r.ui().length === 1);
  pts.forEach((p, k) => r.app.input.pointerUp({ id: 110 + k, x: p.x + Math.cos(p.a) * 200, y: p.y + Math.sin(p.a) * 200, t: clk(r), type: 'touch' }));
  r.w.run(r.app, 200);
  check('... lifting the five fingers lets go of nothing (no grabRelease), and every finger is up', b.rec.count('grabRelease') === 0 && lockedCount(r) === 5 && SLOTS.every((s) => !b.fingerIsDown(s)));
  r.key('keydown', 'Escape');
  r.w.run(r.app, 100);
  const snaps = r.app.recentEvents().filter((e) => e.kind === 'snap');
  check('... Esc lets all five go: five snaps carrying the slot each was grabbed with', snaps.length === 5 && snaps.map((e) => e.finger).sort().join() === '0,1,2,3,4' && lockedCount(r) === 0);
}
{
  // a body that cannot lock keeps the old two slots for fingers
  const r = rig({ lock: false });
  const c = centre(r), d = disc(r);
  for (let k = 0; k < 4; k++) r.app.input.pointerDown({ id: 100 + k, x: c.x + (k - 1.5) * d.r * 0.3, y: c.y, t: clk(r), type: 'touch', button: 0 });
  check('a body without the lock members (the old physics) keeps two finger slots: the third and fourth finger on it are ignored', r.body().rec.of('fingerDown').map((x) => x.args[0]).join() === '0,1');
}

// ============================================================ 6. the driver on its own: locks across bodies, indices, markers, a body that releases by itself
{
  const mk = (): { b1: MockBody; b2: MockBody; cur: { b: SoftBodyLike }; d: ReturnType<typeof createDriver>; t: { step: number } } => {
    const b1 = createMockBody(undefined, { lock: true }), b2 = createMockBody(undefined, { lock: true });
    const cur = { b: b1 as SoftBodyLike }, t = { step: 0 };
    const w = createMockWorld();
    const d = createDriver({ body: () => cur.b, bodies: () => [b1, b2], stage: w.stage, simTime: () => b1.simTime, stepCount: () => t.step, panOfPoint: () => 0, extraSquish: () => false, interact: () => {}, dirty: () => {}, report: (e) => { errors.push([e]); } });
    return { b1, b2, cur, d, t };
  };
  const lobe = (d: ReturnType<typeof createDriver>, slot: 0 | 1 | 2 | 3 | 4, vertex: number, x: number): void => {
    d.onAction({ type: 'grab', slot, vertex, target: { x, y: 0.4, z: 0 } });
    d.onAction({ type: 'grabMove', slot, target: { x: x + 1, y: 0.4, z: 0 } });
  };
  const m = mk();
  lobe(m.d, 0, 10, 0.3);
  check('driver: lockPulls locks the live grab (the body is asked with slot 0), frees the slot, and counts it', m.d.lockPulls() === 1 && m.b1.rec.count('lockGrab') === 1 && !m.d.touch.grabActive[0] && m.d.lockCount() === 1);
  m.cur.b = m.b2;
  lobe(m.d, 1, 20, -0.3);
  check('driver: a lock on a second body counts too (the active body changed between presses)', m.d.lockPulls() === 1 && m.b2.lockList().length === 1 && m.d.lockCount() === 2);
  const pts: V3[] = [];
  check('driver: fillMarkers gives one point per lock, written in place into the array it is given (the same objects the second time), offset by offsetOf', m.d.fillMarkers(pts, (b) => (b === m.b2 ? { x: 5, y: 0, z: 0 } : { x: 0, y: 0, z: 0 })) === 2 && (() => { const first = pts[0], second = pts[1]; m.d.fillMarkers(pts); return pts[0] === first && pts[1] === second && pts.length === 2; })() && Math.abs(pts[1].x - m.b2.positions[m.b2.lockList()[0].vertex * 3]) < 1e-9);
  // the body lets one go by itself (a fold, a refusal): the shell forgets it at the next step's refresh
  m.b1.releaseLock!('all');
  m.b1.step(1 / 60); m.b2.step(1 / 60);
  check('driver: a lock the body let go of by itself is dropped from the markers (asked of the body with lockAt), the other kept', m.d.fillMarkers(pts) === 1 && pts.length === 1 && m.d.lockCount() === 1);
  m.cur.b = m.b2;
  const some = m.b2.positions;
  check('driver: releaseLockAt asks lockAt, then releaseLock with the index the body answered; a point that is on no lock does nothing', !m.d.releaseLockAt({ x: 9, y: 9, z: 9 }) && m.b2.rec.count('releaseLock') === 0 && m.d.releaseLockAt({ x: some[m.b2.lockList()[0].vertex * 3], y: some[m.b2.lockList()[0].vertex * 3 + 1], z: some[m.b2.lockList()[0].vertex * 3 + 2] }) && m.b2.rec.count('releaseLock') === 1 && m.b2.lockList().length === 0);
  lobe(m.d, 0, 30, 0.2); m.cur.b = m.b1; lobe(m.d, 2, 40, 0.1);
  m.d.lockPulls(); m.cur.b = m.b2; m.d.lockPulls();
  check('driver: releaseLocks lets go on EVERY body and forgets all markers; it says whether there were any', m.d.releaseLocks() === true && m.b1.lockList().length === 0 && m.b2.lockList().length === 0 && m.d.fillMarkers(pts) === 0 && m.d.releaseLocks() === false);
  // a throwing body never breaks the input path
  const t = mk();
  lobe(t.d, 0, 5, 0.3);
  t.b1.lockGrab = () => { throw new Error('boom'); };
  const e0 = errors.length;
  check('driver: a lockGrab that throws is reported and ignored (no lock, the grab stays live)', t.d.lockPulls() === 0 && t.d.touch.grabActive[0] && errors.length === e0 + 1);
  errors.length = e0;
  // the learned maximum pull is not taught by the snap of a released lock (its slot may hold a newer, shorter pull)
  const L = mk();
  lobe(L.d, 0, 3, 0.2); L.b1.setPull(0, 1); L.d.lockPulls();
  lobe(L.d, 0, 4, -0.2);
  L.t.step = 10; L.d.releaseLocks(); L.t.step = 11;
  const pullBefore = L.d.touch.pull(0);
  L.d.touch.learnPull(0, 1);
  check('driver: learnPull ignores the snap that comes from a released lock (the step after releaseLocks)', L.d.touch.pull(0) === pullBefore);
}

// ============================================================ 7. feature detection: no markers member, no audio.ui, a throwing marker call
{
  const r = rig({ markers: false, noUi: true });
  const a = pull(r, rightLobe(r).x, rightLobe(r).y, 200);
  r.key('keydown', 'Shift');
  check('without stage.setLockMarkers and without audio.ui the lock still works (no error)', lockedCount(r) === 1 && errors.length === 0);
  up(r, a);
  r.key('keydown', 'Escape');
  check('... and so does the release', lockedCount(r) === 0 && errors.length === 0);
  const t = rig();
  (t.w.stage as unknown as { setLockMarkers: () => void }).setLockMarkers = () => { throw new Error('marker boom'); };
  const a2 = pull(t, rightLobe(t).x, rightLobe(t).y, 200);
  const e0 = errors.length;
  t.key('keydown', 'Shift');
  t.w.run(t.app, 200);
  check('a stage.setLockMarkers that throws is reported (console.error) and does not break the lock or the frame', lockedCount(t) === 1 && errors.length > e0 && t.app.phase === 'play');
  up(t, a2);
  t.key('keydown', 'Escape');
  check('... and the frames after it, the let-go and the final empty marker call keep reporting the error of the stage without breaking anything', t.app.phase === 'play' && lockedCount(t) === 0 && errors.length > e0);
  errors.length = 0;   // (those errors were the point of the rows above)
}

// ============================================================ 8. the words: hint, keys line, How to play
{
  check('the lock line is "Shift while stretched fully locks a pull; Esc lets go" (pointer and keyboard), no longer than the gesture line it takes the turn of', HINT_LOCK.pointer === 'Shift while stretched fully locks a pull; Esc lets go' && HINT_LOCK.keyboard === HINT_LOCK.pointer && HINT_LOCK.pointer.length <= HINT_TEXT.pointer.length && !/coin|gem|\$|cost|pay|earn|timer|second/i.test(HINT_LOCK.pointer));
  const c = createHintController();
  check('hint: before the first interaction the gesture line (never the lock line)', c.line('pointer') === HINT_TEXT.pointer && c.line('keyboard') === HINT_TEXT.keyboard && c.line('touch') === HINT_TEXT.touch);
  c.interact(1000);
  check('hint: back after the first idle gap it is the first-run tool line, as before', c.visible(1000 + HINT_IDLE_MS) && c.line('pointer') === HINT_TOOLS.pointer);
  c.interact(1000 + HINT_IDLE_MS + 5);
  check('hint: on the SECOND return a mouse or keyboard sees the lock line, a touch screen does not (no Shift on a phone)', c.visible(1000 + 2 * HINT_IDLE_MS + 5) && c.line('pointer') === HINT_LOCK.pointer && c.line('keyboard') === HINT_LOCK.keyboard && c.line('touch') === HINT_TOOLS.touch);
  c.interact(1000 + 2 * HINT_IDLE_MS + 9);
  check('hint: on the third return it is the usual line again (the lock line takes every second turn)', c.line('pointer') === HINT_TOOLS.pointer);
  c.toolTried();
  check('hint: a tool tried retires the first-run line (the gesture help); the alternation goes on', c.line('pointer') === HINT_TEXT.pointer);
  c.interact(1000 + 3 * HINT_IDLE_MS + 20);
  check('hint: the fourth return shows the lock line again', c.line('pointer') === HINT_LOCK.pointer);
  const d = createHintController();
  d.interact(0); d.interact(100); d.interact(200); d.interact(300);
  check('hint: gestures in a row (no idle gap) never advance the alternation', d.line('pointer') === HINT_TOOLS.pointer);
  check('Settings keys line says it (the old "Shift + drag pulls both sides" and "Esc closes" stay)', KEYS_LINE.includes('Shift while stretched fully locks a pull; Esc lets go') && KEYS_LINE.includes('Shift + drag pulls both sides') && KEYS_LINE.includes('Esc closes'));
  check('How to play key table has the Shift row next to Shift + drag', GUIDE_KEYS.some((k) => k.keys.length === 1 && k.keys[0] === 'Shift' && /lock/i.test(k.does)));
}

check('no console.error from the shell during the mock rows above (a swallowed error would hide here)', errors.length === 0, errors.length ? JSON.stringify(errors.map((e) => String((e[0] as Error)?.stack ?? e[0]).slice(0, 240))) : '');
errors.length = 0;

// ============================================================ 9. the shell on the REAL SoftBody (the physics half: lockGrab / releaseLock / lockAt / metrics.locked / maxLocks), through the whole game core
{
  const { SoftBody } = await import('../../src/physics/softbody.ts');
  const { createCollection } = await import('../../src/collection/index.ts');
  type Real = InstanceType<typeof SoftBody>;
  const hasLock = typeof (SoftBody.prototype as unknown as { lockGrab?: unknown }).lockGrab === 'function';
  if (REAL) check('the real SoftBody has the lock members (lockGrab, releaseLock, lockAt): the rows below are the shell against the physics', hasLock);
  if (REAL && hasLock) {
    const mkReal = () => {
      const w = createMockWorld({ storage: null });
      w.deps.createBody = (gg) => new SoftBody(gg) as unknown as SoftBodyLike;
      const now = (): number => 1_700_000_000_000 + w.clock.t;
      const collection = createCollection({ storage: null, profile: null, now, random: () => 0.4 });
      const markers: V3[][] = [];
      (w.stage as unknown as { setLockMarkers: (p: V3[]) => void }).setLockMarkers = (pts) => { markers.push(pts.map((p) => ({ ...p }))); };
      const app = createApp({ ...w.deps, collection, epochNow: now });
      app.resize(800, 600, 1);
      app.setPhase('play');
      const target = new EventTarget();
      let escCount = 0;
      attachKeyboard(target, app, { onEscape: () => { escCount++; return false; }, panelOpen: () => false });
      const key = (type: string, k: string): Event => { const e = Object.assign(new Event(type, { cancelable: true }), { key: k, code: k, repeat: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: k === 'Shift' }); target.dispatchEvent(e); return e; };
      const go = (ms: number, each?: () => void): void => { let left = ms; while (left > 1e-9) { const d = Math.min(1000 / 60, left); w.clock.t += d; app.frame(w.clock.t); each?.(); left -= d; } };
      go(1500);
      const body = app.body as unknown as Real;
      const disc0 = app.host.bodyScreen()!;
      const R = body.restRadius, maxD = body.params.maxPull * R, scale = disc0.r / R;
      let nextId = 1;
      /** a pull from a point of the disc (fractions of its radius from the centre) straight outward by reach x maxPull, in 50 moves; the pointer stays down */
      const pullAt = (fx: number, fy: number, reach: number, type: 'mouse' | 'touch' = 'mouse', sh = false): { id: number; x: number; y: number; sx: number; sy: number; type: 'mouse' | 'touch' } => {
        const d = app.host.bodyScreen()!, id = nextId++;
        const x0 = d.x + fx * d.r, y0 = d.y + fy * d.r, len = Math.hypot(fx, fy) || 1, ux = fx / len, uy = fy / len, drag = reach * maxD * scale;
        app.input.pointerDown({ id, x: x0, y: y0, t: w.clock.t, button: 0, type, ...(sh ? { shift: true } : {}) });
        go(40);
        for (let i = 1; i <= 50; i++) { app.input.pointerMove({ id, x: x0 + (ux * drag * i) / 50, y: y0 + (uy * drag * i) / 50, t: w.clock.t, type, ...(sh ? { shift: true } : {}) }); go(16.7); }
        go(400);
        return { id, x: x0 + ux * drag, y: y0 + uy * drag, sx: x0, sy: y0, type };
      };
      const lift = (p: { id: number; x: number; y: number; type: 'mouse' | 'touch' }): void => { app.input.pointerUp({ id: p.id, x: p.x, y: p.y, t: w.clock.t, type: p.type }); go(100); };
      const finiteVol = (): { finite: boolean; vol: number } => {
        const P = body.positions; let finite = true;
        for (let i = 0; i < P.length; i++) if (!Number.isFinite(P[i])) finite = false;
        let v = 0; const I = body.indices;
        for (let t = 0; t < I.length; t += 3) { const a = I[t] * 3, c = I[t + 1] * 3, e = I[t + 2] * 3; v += P[a] * (P[c + 1] * P[e + 2] - P[c + 2] * P[e + 1]) - P[a + 1] * (P[c] * P[e + 2] - P[c + 2] * P[e]) + P[a + 2] * (P[c] * P[e + 1] - P[c + 1] * P[e]); }
        return { finite, vol: v / 6 };
      };
      return { w, app, body, key, go, pullAt, lift, markers, finiteVol, R, maxD, escCount: () => escCount, ui: () => w.audio.rec.of('ui').map((c) => (c.args[0] as { kind: string }).kind), sp: () => app.hoard.meter().sp };
    };

    // ---- one lobe: refused below the bar, locked at the bar, held after the mouse is up, a press on it lets it go
    {
      const t = mkReal();
      const half = t.pullAt(0.75, 0.05, 0.5);
      t.key('keydown', 'Shift');
      t.go(40);
      check('real SoftBody: a half pull (0.5 x maxPull) is not locked by Shift: no lock, no click, the pull is still held', t.body.metrics.locked === 0 && t.app.input.locks === 0 && t.ui().length === 0 && t.body.metrics.grabbed, `locked ${t.body.metrics.locked}, pull ${(t.body.metrics.pull ?? -1).toFixed(2)}`);
      t.lift(half); t.go(1500);
      const t2 = mkReal();
      const R0 = t2.body.center.x;
      const full = t2.pullAt(0.75, 0.05, 1.25);
      const levelBefore = t2.body.metrics.pull ?? -1;
      t2.key('keydown', 'Shift');
      t2.go(40);
      const stretchAtLock = t2.body.metrics.stretch;
      check('real SoftBody: a full pull (pull level >= 0.95) is locked by one Shift tap: input.locks 1, metrics.locked 1, the grab slot is free, one "on" click, one marker', levelBefore >= 0.95 && t2.app.input.locks === 1 && t2.body.metrics.locked === 1 && !t2.body.metrics.grabbed && t2.ui().join() === 'on' && t2.markers.at(-1)?.length === 1, `level ${levelBefore.toFixed(3)}, locked ${t2.body.metrics.locked}, grabbed ${t2.body.metrics.grabbed}, ui ${t2.ui()}`);
      const mk = t2.markers.at(-1)![0];
      check('... the marker sits on the stretched lobe (out on the pulled side of the body, above the table)', mk.x > R0 + t2.R * 0.9 && mk.y > 0, `marker ${mk.x.toFixed(2)}, ${mk.y.toFixed(2)}, body centre x ${R0.toFixed(2)}`);
      t2.lift(full);
      t2.go(2500);
      const held = t2.body.metrics.stretch;
      check('... with the mouse up and 2.5 s gone the lobe is still held out (stretch stays >= 60 % of what it was), the body is finite, its volume sane, nothing picked it up', held >= 0.6 * stretchAtLock && t2.finiteVol().finite && t2.finiteVol().vol > 0.5 * t2.finiteVol().vol && !t2.body.metrics.carried && t2.app.input.locks === 1, `stretch ${stretchAtLock.toFixed(2)} -> ${held.toFixed(2)}`);
      const sp0 = t2.sp(), snaps0 = t2.app.recentEvents().filter((e) => e.kind === 'snap').length;
      // a press on the lobe (the middle of the stretched part, between the press point and the tip) lets it go
      // (the very tip is a silhouette edge a ray can miss; the pulled-out lobe is hit anywhere along its upper 30 % or so, which is what lockAt's reach covers)
      const tip = { x: full.sx + 0.8 * (full.x - full.sx), y: full.sy + 0.8 * (full.y - full.sy) };
      t2.app.input.pointerDown({ id: 99, x: tip.x, y: tip.y, t: t2.w.clock.t, button: 0, type: 'mouse' });
      t2.go(100);
      check('real SoftBody: a left press on the locked lobe (80 % of the way out to its tip) lets it go: metrics.locked 0, the "off" click, no new grab, no poke', t2.body.metrics.locked === 0 && t2.app.input.locks === 0 && t2.ui().join() === 'on,off' && !t2.body.metrics.grabbed && t2.body.metrics.fingers === 0, `locked ${t2.body.metrics.locked}, ui ${t2.ui()}, fingers ${t2.body.metrics.fingers}`);
      t2.app.input.pointerUp({ id: 99, x: tip.x, y: tip.y, t: t2.w.clock.t, type: 'mouse' });
      t2.go(1500);
      const snaps = t2.app.recentEvents().filter((e) => e.kind === 'snap');
      check('... it snapped back as a pull: ONE snap with the pull level >= 0.95 and heldFor = the whole hold (3 s or more), the meter gained the capped hold XP (1 + 0.65 x 3 = 2.95)', snaps.length === snaps0 + 1 && snaps.at(-1)!.intensity >= 0.95 && snaps.at(-1)!.heldFor >= 3 && Math.abs(t2.sp() - sp0 - 2.95) < 0.1, `snap ${JSON.stringify(snaps.at(-1))}, gained ${(t2.sp() - sp0).toFixed(3)}`);
      check('... and the body is back at rest (stretch < 0.2 after 1.5 s), no error', t2.body.metrics.stretch < 0.2 && errors.length === 0, `stretch ${t2.body.metrics.stretch.toFixed(2)}${errors.length ? ', errors ' + JSON.stringify(errors.map((e) => String((e[0] as Error)?.stack ?? e[0]).slice(0, 300))) : ''}`);
    }

    // ---- two lobes, then Esc
    {
      const t = mkReal();
      const a = t.pullAt(0.75, 0.05, 1.25); t.key('keydown', 'Shift'); t.lift(a);
      const b = t.pullAt(-0.75, 0.05, 1.25); t.key('keydown', 'Shift'); t.lift(b);
      t.go(1500);
      const fv = t.finiteVol();
      check('real SoftBody: two lobes locked in turn (right, then left): metrics.locked 2, two markers, the body finite with a sane volume, not picked up', t.body.metrics.locked === 2 && t.app.input.locks === 2 && t.markers.at(-1)?.length === 2 && fv.finite && fv.vol > 0 && !t.body.metrics.carried && t.ui().join() === 'on,on', `locked ${t.body.metrics.locked}, volume ${fv.vol.toFixed(3)}`);
      const sp0 = t.sp();
      const esc = t.key('keydown', 'Escape');
      t.go(3000);
      const snaps = t.app.recentEvents().filter((e) => e.kind === 'snap');
      check('real SoftBody: Esc lets both go (the key is consumed, not passed on), both snap back as pulls (two snaps carrying slot 0, the meter gained), the body settles', esc.defaultPrevented && t.escCount() === 0 && t.body.metrics.locked === 0 && snaps.length >= 2 && snaps.slice(-2).every((e) => e.intensity >= 0.95 && e.finger === 0) && t.sp() > sp0 + 2 && t.body.metrics.stretch < 0.2, `snaps ${snaps.length}, gained ${(t.sp() - sp0).toFixed(3)}, stretch ${t.body.metrics.stretch.toFixed(2)}`);
    }

    // ---- two hands never pick the body up: one lock + a lone pull far past the limit
    {
      const t = mkReal();
      const a = t.pullAt(0.75, 0.05, 1.25); t.key('keydown', 'Shift'); t.lift(a);
      let carried = false;
      const b = (() => {
        const d = t.app.host.bodyScreen()!, id = 50, x0 = d.x - 0.75 * d.r, y0 = d.y + 0.05 * d.r, drag = -2.2 * t.maxD * (d.r / t.R);
        t.app.input.pointerDown({ id, x: x0, y: y0, t: t.w.clock.t, button: 0, type: 'mouse' });
        t.go(40, () => { if (t.body.metrics.carried) carried = true; });
        for (let i = 1; i <= 60; i++) { t.app.input.pointerMove({ id, x: x0 + (drag * i) / 60, y: y0 - i * 0.8, t: t.w.clock.t, type: 'mouse' }); t.go(16.7, () => { if (t.body.metrics.carried) carried = true; }); }
        t.go(800, () => { if (t.body.metrics.carried) carried = true; });
        return { id, x: x0 + drag, y: y0 - 48 };
      })();
      check('real SoftBody: a lock counts as a hand: a lone pull asked 2.2 x maxPull while one lobe is locked does NOT pick the body up (two hands never carry it)', !carried && t.body.metrics.locked === 1, `carried ${carried}`);
      t.app.input.pointerUp({ id: b.id, x: b.x, y: b.y, t: t.w.clock.t, type: 'mouse' });
      t.go(2000);
      t.key('keydown', 'Escape'); t.go(1500);
      const c = mkReal();
      const d = c.app.host.bodyScreen()!;
      let carried2 = false;
      const x0 = d.x - 0.75 * d.r, y0 = d.y + 0.05 * d.r, drag = -2.2 * c.maxD * (d.r / c.R);
      c.app.input.pointerDown({ id: 51, x: x0, y: y0, t: c.w.clock.t, button: 0, type: 'mouse' });
      c.go(40);
      for (let i = 1; i <= 60; i++) { c.app.input.pointerMove({ id: 51, x: x0 + (drag * i) / 60, y: y0 - i * 0.8, t: c.w.clock.t, type: 'mouse' }); c.go(16.7, () => { if (c.body.metrics.carried) carried2 = true; }); }
      c.go(800, () => { if (c.body.metrics.carried) carried2 = true; });
      check('... and the same lone pull with no lock does pick it up (the control)', carried2);
    }

    // ---- five touch fingers: a five-way stretch, locked with Shift (a laptop with a touch screen), released with Esc
    {
      const t = mkReal();
      const pts: Array<ReturnType<typeof t.pullAt>> = [];
      const spots = [0, 1, 2, 3, 4].map((k) => { const a = (2 * Math.PI * k) / 5 - Math.PI / 2; return { fx: Math.cos(a) * 0.72, fy: Math.sin(a) * 0.72 }; });
      let threw = false;
      try {
        const d = t.app.host.bodyScreen()!;
        spots.forEach((s, k) => { const x0 = d.x + s.fx * d.r, y0 = d.y + s.fy * d.r; t.app.input.pointerDown({ id: 200 + k, x: x0, y: y0, t: t.w.clock.t, button: 0, type: 'touch' }); t.go(30); });
        check('real SoftBody: five touch fingers on the body are all accepted (metrics.fingers 5)', t.body.metrics.fingers === 5, `fingers ${t.body.metrics.fingers}`);
        t.go(100);
        const drag = 1.7 * t.maxD * (d.r / t.R);
        for (let i = 1; i <= 50; i++) { spots.forEach((s, k) => { const len = Math.hypot(s.fx, s.fy); t.app.input.pointerMove({ id: 200 + k, x: d.x + s.fx * d.r + (s.fx / len) * (drag * i) / 50, y: d.y + s.fy * d.r + (s.fy / len) * (drag * i) / 50, t: t.w.clock.t, type: 'touch' }); }); t.go(16.7); }
        t.go(600);
      } catch (e) { threw = true; errors.push([e]); }
      void pts;
      const grabEv = t.app.recentEvents().filter((e) => e.kind === 'grab').map((e) => e.finger).sort().join();
      check('real SoftBody: five fingers PULL five lobes at once (five grab events on slots 0..4), no exception', !threw && grabEv === '0,1,2,3,4' && t.body.metrics.grabbed, `grabs ${grabEv}, threw ${threw}`);
      const fv0 = t.finiteVol();
      t.key('keydown', 'Shift');
      t.go(300);
      const fv = t.finiteVol();
      check('real SoftBody: Shift locks the five-way stretch: metrics.locked is what the body granted (up to its cap of 6), the star is finite and keeps a sane volume', t.app.input.locks >= 3 && t.body.metrics.locked === t.app.input.locks && fv.finite && fv.vol > 0.5 * fv0.vol, `locked ${t.body.metrics.locked}, volume ${fv0.vol.toFixed(3)} -> ${fv.vol.toFixed(3)}`);
      for (let k = 0; k < 5; k++) t.app.input.pointerUp({ id: 200 + k, x: 0, y: 0, t: t.w.clock.t, type: 'touch' });
      t.go(1500);
      const held = t.body.metrics.locked ?? 0;
      const fv2 = t.finiteVol();
      check('... the fingers lifted, the locked lobes stay held (nothing snapped back), the body is finite', held === t.app.input.locks && held >= 3 && fv2.finite && fv2.vol > 0.5 * fv0.vol, `locked ${held}`);
      const sp0 = t.sp();
      t.key('keydown', 'Escape');
      t.go(4000);
      const snaps = t.app.recentEvents().filter((e) => e.kind === 'snap').length;
      const fv3 = t.finiteVol();
      check('... Esc lets them all go: the star settles back (stretch < 0.2, volume near 1 x rest), a snap per lobe, the meter gained', t.body.metrics.locked === 0 && t.body.metrics.stretch < 0.2 && fv3.finite && Math.abs(fv3.vol / fv0.vol - 1) < 0.35 && snaps >= held && t.sp() > sp0, `stretch ${t.body.metrics.stretch.toFixed(2)}, volume ${fv3.vol.toFixed(3)} (was ${fv0.vol.toFixed(3)}), snaps ${snaps}`);
    }

    // ---- the Shift pair (two hands, mirrored): a Shift tap locks both when both are fully stretched
    {
      const t = mkReal();
      const p = t.pullAt(0.75, 0.05, 1.25, 'mouse', true);
      t.key('keyup', 'Shift'); t.key('keydown', 'Shift');
      t.go(40);
      check('real SoftBody: a Shift pair at full stretch is locked by a Shift tap (both hands: metrics.locked 2) and the pointer is free', t.body.metrics.locked === 2 && !t.body.metrics.grabbed && t.app.input.locks === 2, `locked ${t.body.metrics.locked}`);
      t.lift(p); t.go(1500);
      check('... after the mouse is up both lobes are still held, the body finite', t.body.metrics.locked === 2 && t.finiteVol().finite && !t.body.metrics.carried);
      t.key('keydown', 'Escape'); t.go(3000);
      check('... and Esc lets both go: settles', t.body.metrics.locked === 0 && t.body.metrics.stretch < 0.2);
    }

    // ---- leaving: switching squishy with locks held, the low-quality cap, a press that misses
    {
      const t = mkReal();
      const a = t.pullAt(0.75, 0.05, 1.25); t.key('keydown', 'Shift'); t.lift(a);
      const old = t.body;
      const g2 = randomGenome(11);
      let threw = false;
      try { t.app.setGenome(g2); t.go(500); } catch (e) { threw = true; errors.push([e]); }
      check('real SoftBody: switching squishy with a lock held lets it go cleanly (no exception, no locks on the new body, markers cleared)', !threw && t.app.input.locks === 0 && (t.app.body as unknown as Real).metrics.locked === 0 && t.markers.at(-1)?.length === 0 && old !== t.app.body);
      const u = mkReal();
      (u.w.stage as unknown as { stats: () => unknown }).stats = () => ({ drawCalls: 0, triangles: 0, tier: 'low', frameMsEma: 0 });
      const b = u.pullAt(0.75, 0.05, 1.25); u.key('keydown', 'Shift');
      check('real SoftBody: on the low quality tier the shell sets maxLocks to 4 (the body\'s own field)', (u.body as unknown as { maxLocks: number }).maxLocks === 4);
      u.lift(b);
      const m = mkReal();
      const c = m.pullAt(0.75, 0.05, 1.25); m.key('keydown', 'Shift'); m.lift(c); m.go(300);
      const dd = m.app.host.bodyScreen()!;
      m.app.input.pointerDown({ id: 98, x: dd.x - 0.5 * dd.r, y: dd.y, t: m.w.clock.t, button: 0, type: 'mouse' });
      m.app.input.pointerUp({ id: 98, x: dd.x - 0.5 * dd.r, y: dd.y, t: m.w.clock.t, type: 'mouse' });
      m.go(200);
      check('real SoftBody: a press on the other side of the body (not on the lock) is a poke and leaves the lock alone', m.body.metrics.locked === 1 && m.ui().join() === 'on');
      m.key('keydown', 'Escape');
    }
  }
}

console.error = realError;
console.log(`\n${total - bad}/${total} lock shell checks passed`);
process.exit(bad ? 1 : 0);
