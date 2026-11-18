// probe (lane W2-D, ruling 54): cast modes, the attack-range ring and the new binds, through the real InputController
// against a fake match client and the real camera geometry.
//   per-slot cast modes: normal (press aims; left-click or the key again casts) · quick (casts on the press) · quick with
//   indicator (the indicator shows while the key is held; the cast is sent inside the key's release handler, the release
//   frame; right-click or Esc cancels; a unit ability with no valid unit under the cursor keeps aiming). Settings
//   migration maps quickCast=true to quick on every slot and quickCast=false to normal; a save's own castModes win.
//   The range ring (held showRange, attack-move armed) is stats.range + body radius at the fighter, and hides on release.
//   levelUpMod (default Ctrl) is rebindable; viewAlly1-4 hold the camera on that ally and give it back on release.
import { readFileSync } from 'node:fs';
import { PerspectiveCamera, Plane, Raycaster, Vector2, Vector3 } from 'three';
import { check, finish, section } from './fixtures/sim_fixture.ts';
import { InputController, type CameraLike, type InputHooks, type InputRenderer } from '../src/input/controller.ts';
import { selecting } from '../src/ui/hud/selecting.ts';
import { CAMERA } from '../src/render/camera.ts';
import { CAST_MODE_SLOTS, DEFAULT_BINDS, castModeOf, defaultSettings, normalizeSettings, patchSettings, type ControlSettings } from '../src/session/settings.ts';
import { ACTION_GROUPS, ACTION_LABELS } from '../src/ui/keys.ts';
import type { Command, EntityView } from '../src/contracts/sim.ts';
import type { AimSpecLike } from '../src/input/abilities.ts';

(globalThis as { document?: unknown }).document ??= { elementFromPoint: () => null };
(globalThis as { innerWidth?: number }).innerWidth = 1920; (globalThis as { innerHeight?: number }).innerHeight = 1080;

const W = 1920, H = 1080;
const cam = new PerspectiveCamera(CAMERA.fovDeg, W / H, 0.5, 400);
{
  const p = (CAMERA.pitchDeg * Math.PI) / 180;
  cam.position.set(50, Math.sin(p) * CAMERA.distance, 50 + Math.cos(p) * CAMERA.distance);
  cam.lookAt(50, 0, 50);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
}
const toScreen = (x: number, y: number, h = 0): { x: number; y: number } => {
  const v = new Vector3(x, h, y).project(cam);
  return { x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H };
};
const rc = new Raycaster(), ground = new Plane(new Vector3(0, 1, 0), 0), hit = new Vector3();
const pickGround = (x: number, y: number): { x: number; y: number } | null => {
  rc.setFromCamera(new Vector2((x / W) * 2 - 1, -(y / H) * 2 + 1), cam);
  return rc.ray.intersectPlane(ground, hit) ? { x: hit.x, y: hit.z } : null;
};

const RANGE = 5.5, RADIUS = 0.6;
const unit = (id: number, kind: EntityView['kind'], team: number, x: number, y: number, radius: number): EntityView =>
  ({ id, kind, team, x, y, radius, alive: true, targetable: true, visibleMask: 0b11, statuses: [], vx: 0, vy: 0, res: 100 }) as unknown as EntityView;
let views: EntityView[] = [];
const DEFS: Record<string, unknown> = {
  q_point: { id: 'q_point', targeting: { kind: 'point', range: 8 }, effects: [], costKind: 'none' },
  w_dir: { id: 'w_dir', targeting: { kind: 'direction', range: 9 }, effects: [], costKind: 'none' },
  r_unit: { id: 'r_unit', targeting: { kind: 'unit', range: 6 }, effects: [], costKind: 'none' },
};
const av = (slot: string, id: string) => ({ slot, id, rank: 1, maxRank: 5, ready: true, cooldown: 0, cost: 0, canLevel: true });
const players = [
  { player: 0, entity: 1, team: 0, abilities: [av('a1', 'q_point'), av('a2', 'w_dir'), av('ult', 'r_unit')], items: [], itemCooldowns: [], stats: { range: RANGE } },
  { player: 1, entity: 2, team: 0, abilities: [], items: [], itemCooldowns: [], stats: { range: 1 } },
  { player: 2, entity: 3, team: 1, abilities: [], items: [], itemCooldowns: [], stats: { range: 1 } },
  { player: 3, entity: 4, team: 0, abilities: [], items: [], itemCooldowns: [], stats: { range: 1 } },
];
const sent: Command[] = [];
let aim: AimSpecLike | null = null;
let ring: { x: number; y: number; radius: number } | null = null;
const camLog: string[] = [];
let camMode: 'locked' | 'semi' | 'free' = 'locked';
const camera: CameraLike = {
  get mode() { return camMode; }, setMode: (m) => { camMode = m; camLog.push(`mode:${m}`); }, scout: (on) => { camLog.push(`scout:${on}`); },
  setPointer() {}, setKeyPan() {}, zoomBy() {}, focusOn: (x, y) => { camLog.push(`focus:${x.toFixed(1)},${y.toFixed(1)}`); }, centerOnSelf: () => { camLog.push('self'); },
};
const client = {
  you: 0,
  view: { get players() { return players; }, get entities() { return views; }, entity: (id: number) => views.find((v) => v.id === id) },
  send: (c: Command) => { sent.push(c); },
};
const bare: InputRenderer = {
  pickGround, pickEntity: (x, y) => { const g = pickGround(x, y); const e = g ? views.find((v) => v.id !== 1 && Math.hypot(v.x - g.x, v.y - g.y) < v.radius + 0.3) : undefined; return e ? e.id : null; },
  setHover: () => {}, setAim: (a) => { aim = a; }, setRangeRing: (r) => { ring = r; },
  unitPos: (id) => { const d = views.find((v) => v.id === id); return d ? { x: d.x, y: d.y } : null; }, camera,
};
const renderer: InputRenderer = selecting(bare, () => {});
const denied: string[] = [];
const hooks: InputHooks = {
  toggleShop() {}, closeShop: () => false, scoreboard() {}, denied: (s, why) => { denied.push(`${s}:${why}`); }, marker() {}, setCameraLock() {}, blocked: () => false, pingsDisabled: () => false,
};
const index = { get: (id: string | undefined | null) => (id ? DEFS[id] : undefined), itemActive: () => undefined };
const surface = { contains: () => true } as unknown as HTMLElement;
function controller(o: { modes?: Partial<Record<string, string>>; binds?: Record<string, string>; ringOnAm?: boolean } = {}): any {
  sent.length = 0; aim = null; ring = null; camLog.length = 0; denied.length = 0; camMode = 'locked';
  const s = defaultSettings();
  const c = s.controls as ControlSettings;
  if (o.modes) c.castModes = { ...c.castModes!, ...o.modes } as ControlSettings['castModes'];
  if (o.binds) c.binds = { ...c.binds, ...o.binds };
  if (o.ringOnAm === false) c.rangeOnAttackMove = false;
  return new InputController({ client: client as never, renderer, index: index as never, settings: s, hooks, surface }) as never;
}
const at = (c: any, p: { x: number; y: number }): void => { c.ptr.x = p.x; c.ptr.y = p.y; c.ptr.inside = true; };
const key = (c: any, code: string, down: boolean, mods: { ctrlKey?: boolean; altKey?: boolean } = {}): void => {
  const e = { code, repeat: false, ctrlKey: !!mods.ctrlKey, altKey: !!mods.altKey, metaKey: false, shiftKey: false, target: null, defaultPrevented: false, preventDefault() {}, stopImmediatePropagation() {} };
  if (down) c.onKeyDown(e); else c.onKeyUp(e);
};
const casts = (): Extract<Command, { type: 'cast' }>[] => sent.filter((c) => c.type === 'cast') as never;
function scene(): void {
  views = [unit(1, 'fighter', 0, 50, 52, RADIUS), unit(2, 'fighter', 0, 40, 60, 0.5), unit(3, 'fighter', 1, 54, 50, 0.5), unit(4, 'fighter', 0, 70, 30, 0.5)];
}

section('quick with indicator: the key held shows the aim and sends nothing; the cast is sent inside the release handler', () => {
  scene();
  const c = controller({ modes: { a1: 'quickIndicator' } });
  const p = toScreen(53, 49);
  at(c, p);
  key(c, 'KeyQ', true);
  c.frame(1000);
  check('held: aiming a1 (hold), the indicator is drawn, nothing sent', c.aiming.value?.slot === 'a1' && c.aiming.value?.hold === true && aim !== null && casts().length === 0, { aim, sent });
  // 300 ms of frames with the key held: still nothing sent
  for (let t = 1016; t <= 1300; t += 16) c.frame(t);
  check('…300 ms held: still nothing sent, still aiming', casts().length === 0 && c.aiming.value?.slot === 'a1');
  const before = sent.length;
  key(c, 'KeyQ', false);
  const fired = sent.slice(before);
  const g = pickGround(p.x, p.y)!;
  check('release: exactly one cast, sent inside the keyup handler (the release frame)', fired.length === 1 && fired[0].type === 'cast' && (fired[0] as { slot: string }).slot === 'a1', fired);
  const cc = fired[0] as { x: number; y: number };
  check('…at the cursor ground point (inside range)', Math.hypot(cc.x - g.x, cc.y - g.y) < 1e-6, { cc, g });
  check('…and the aim is cleared', c.aiming.value === null && aim === null);
});

section('quick with indicator: right-click or Esc while held cancels; the release then sends nothing', () => {
  scene();
  const c = controller({ modes: { a2: 'quickIndicator' } });
  at(c, toScreen(56, 52));
  key(c, 'KeyW', true);
  c.buttons = 2; c.rightDown(false);
  const nCast = casts().length;
  key(c, 'KeyW', false);
  check('right-click: aim cancelled, no cast on the release', c.aiming.value === null && nCast === 0 && casts().length === 0, sent);
  const c2 = controller({ modes: { a2: 'quickIndicator' } });
  at(c2, toScreen(56, 52));
  key(c2, 'KeyW', true);
  key(c2, 'Escape', true); key(c2, 'Escape', false);
  key(c2, 'KeyW', false);
  check('Esc: aim cancelled, no cast on the release', c2.aiming.value === null && casts().length === 0, sent);
});

section('quick with indicator, a unit ability: released on a valid enemy casts at it; released on nothing keeps aiming', () => {
  scene();
  const c = controller({ modes: { ult: 'quickIndicator' } });
  at(c, toScreen(54, 50, 0.4));
  key(c, 'KeyR', true);
  key(c, 'KeyR', false);
  const k = casts();
  check('on the enemy: one cast with its target', k.length === 1 && (k[0] as { target?: number }).target === 3, k);
  const c2 = controller({ modes: { ult: 'quickIndicator' } });
  at(c2, toScreen(45, 45));
  key(c2, 'KeyR', true);
  key(c2, 'KeyR', false);
  check('on nothing: no cast, still aiming as a normal cast (no hold)', casts().length === 0 && c2.aiming.value?.slot === 'ult' && !c2.aiming.value?.hold, c2.aiming.value);
  at(c2, toScreen(54, 50, 0.4));
  c2.leftDown({ altKey: false, shiftKey: false, button: 0 });
  check('…then a left-click on the enemy casts it', casts().length === 1);
});

section('quick: the press casts at the cursor; normal: the press aims, the release does nothing, the key again casts', () => {
  scene();
  const q = controller({ modes: { a1: 'quick' } });
  at(q, toScreen(53, 49));
  key(q, 'KeyQ', true);
  check('quick: one cast on the press', casts().length === 1 && q.aiming.value === null);
  key(q, 'KeyQ', false);
  check('…none on the release', casts().length === 1);
  const n = controller();
  at(n, toScreen(53, 49));
  key(n, 'KeyQ', true); key(n, 'KeyQ', false);
  check('normal: aiming after press + release, nothing sent', n.aiming.value?.slot === 'a1' && casts().length === 0);
  key(n, 'KeyQ', true);
  check('…the key again casts', casts().length === 1 && n.aiming.value === null);
  // a HUD click on a quick-with-indicator slot has no release: it aims like normal
  const h = controller({ modes: { a1: 'quickIndicator' } });
  at(h, toScreen(53, 49));
  h.press('a1');
  check('HUD click in quick-with-indicator: aims (no hold), sends nothing', h.aiming.value?.slot === 'a1' && !h.aiming.value?.hold && casts().length === 0);
  // a window blur while the key is held drops the aim (no keyup will come)
  const b = controller({ modes: { a1: 'quickIndicator' } });
  at(b, toScreen(53, 49));
  key(b, 'KeyQ', true);
  b.releaseAll();
  check('blur while held: the aim is dropped, nothing sent', b.aiming.value === null && casts().length === 0);
});

section('settings migration: quickCast=true -> quick on every slot; false -> normal; a save\'s own castModes win', () => {
  const on = normalizeSettings({ controls: { quickCast: true, binds: {} } }).controls as ControlSettings;
  check('quickCast=true -> every castModes slot quick', CAST_MODE_SLOTS.every((k) => on.castModes![k] === 'quick'), on.castModes);
  check('…and every sim slot reads quick (items too)', ['a1', 'a2', 'a3', 'ult', 'spell1', 'spell2', 'item1', 'item6'].every((s) => castModeOf(on, s) === 'quick'));
  check('…quickCast stays true', on.quickCast === true);
  const off = normalizeSettings({ controls: { quickCast: false } }).controls as ControlSettings;
  check('quickCast=false -> every slot normal', CAST_MODE_SLOTS.every((k) => off.castModes![k] === 'normal'), off.castModes);
  const none = normalizeSettings({}).controls as ControlSettings;
  check('no controls at all -> normal', CAST_MODE_SLOTS.every((k) => none.castModes![k] === 'normal'));
  const own = normalizeSettings({ controls: { quickCast: true, castModes: { a1: 'quickIndicator', a2: 'normal', ult: 'bogus' } } }).controls as ControlSettings;
  check('own castModes win over quickCast; a bad entry falls back to the default', own.castModes!.a1 === 'quickIndicator' && own.castModes!.a2 === 'normal' && own.castModes!.ult === 'normal', own.castModes);
  check('…quickCast then reads false (not every slot is quick)', own.quickCast === false);
  const patched = patchSettings(defaultSettings(), { controls: { castModes: { ...((defaultSettings().controls as ControlSettings).castModes!), ult: 'quick' } } as never }).controls as ControlSettings;
  check('patchSettings sets one slot', patched.castModes!.ult === 'quick' && patched.castModes!.a1 === 'normal');
  const round = normalizeSettings(JSON.parse(JSON.stringify(patched === undefined ? {} : { controls: patched }))).controls as ControlSettings;
  check('a saved profile round-trips its castModes', JSON.stringify(round.castModes) === JSON.stringify(patched.castModes));
  const clash = normalizeSettings({ controls: { binds: { shop: 'KeyC', a1: 'KeyQ' } } }).controls;
  check('a save that gave C to the shop keeps it; showRange starts unbound', clash.binds.shop === 'KeyC' && clash.binds.showRange === '', clash.binds);
  const fresh = normalizeSettings({ controls: { binds: { a1: 'KeyQ' } } }).controls;
  check('…a save that did not gets the new defaults', fresh.binds.showRange === DEFAULT_BINDS.showRange && fresh.binds.levelUpMod === 'ControlLeft' && fresh.binds.viewAlly1 === 'F2');
});

section('the attack-range ring: held showRange and attack-move armed draw stats.range + body radius at the fighter', () => {
  scene();
  const c = controller();
  at(c, toScreen(45, 45));
  c.frame(1000);
  check('nothing held: no ring', ring === null);
  key(c, 'KeyC', true);
  c.frame(1016);
  const want = RANGE + RADIUS;
  check(`showRange held: ring radius ${ring?.radius} = stats.range + body radius (${want})`, ring !== null && Math.abs(ring.radius - want) < 1e-9 && ring.x === 50 && ring.y === 52, ring);
  key(c, 'KeyC', false);
  c.frame(1032);
  check('released: the ring hides', ring === null);
  key(c, 'KeyA', true); key(c, 'KeyA', false);
  c.frame(1048);
  check('attack-move armed: the ring shows at the same radius', ring !== null && Math.abs(ring.radius - want) < 1e-9, ring);
  key(c, 'Escape', true); key(c, 'Escape', false);
  c.frame(1064);
  check('…disarmed (Esc): it hides', ring === null);
  const off = controller({ ringOnAm: false });
  at(off, toScreen(45, 45));
  key(off, 'KeyA', true); off.frame(1000);
  check('rangeOnAttackMove off: attack-move shows no ring', ring === null);
  const re = controller({ binds: { showRange: 'KeyV', ult: 'KeyR' } });
  at(re, toScreen(45, 45));
  key(re, 'KeyV', true); re.frame(1000);
  check('rebindable: showRange on V', ring !== null);
});

section('levelUpMod: Ctrl + Q levels up by default; rebound, the new key does and Ctrl no longer does', () => {
  scene();
  const c = controller();
  key(c, 'ControlLeft', true, { ctrlKey: true });
  key(c, 'KeyQ', true, { ctrlKey: true });
  check('Ctrl + Q: a levelUp a1, no cast, no aim', sent.some((x) => x.type === 'levelUp' && x.slot === 'a1') && casts().length === 0 && c.aiming.value === null, sent);
  const r = controller({ binds: { levelUpMod: 'AltRight' } });
  key(r, 'ControlLeft', true, { ctrlKey: true });
  key(r, 'KeyQ', true, { ctrlKey: true });
  check('rebound to R Alt: Ctrl + Q no longer levels up', !sent.some((x) => x.type === 'levelUp'), sent);
  key(r, 'KeyQ', false); key(r, 'ControlLeft', false);
  r.cancelAim();
  key(r, 'AltRight', true, { altKey: true });
  key(r, 'KeyW', true, { altKey: true });
  check('…R Alt + W levels up a2', sent.some((x) => x.type === 'levelUp' && x.slot === 'a2'), sent);
});

section('viewAlly1-4: held, the camera watches that ally (seat order) and gets it back on release', () => {
  scene();
  const c = controller();
  key(c, 'F2', true);
  c.frame(1000);
  check('F2 on a locked camera: it scouts and focuses on ally 1 (seat 1 at 40,60)', camLog[0] === 'scout:true' && camLog.includes('focus:40.0,60.0'), camLog);
  views[1] = unit(2, 'fighter', 0, 42, 61, 0.5);
  c.frame(1016);
  check('…it follows the ally as it moves', camLog.includes('focus:42.0,61.0'), camLog);
  key(c, 'F2', false);
  check('released: the scout ends (back to your fighter)', camLog[camLog.length - 1] === 'scout:false', camLog);
  camLog.length = 0;
  key(c, 'F3', true); c.frame(1032);
  check('F3: ally 2 is the next allied seat (seat 3 at 70,30; the enemy seat is skipped)', camLog.includes('focus:70.0,30.0'), camLog);
  key(c, 'F3', false);
  const u = controller();
  camMode = 'free';
  at(u, { x: W / 2, y: H / 2 });
  key(u, 'F2', true); u.frame(1000); key(u, 'F2', false);
  const back = pickGround(W / 2, H / 2)!;
  check('an unlocked camera returns to the ground it was on', camLog[camLog.length - 1] === `focus:${back.x.toFixed(1)},${back.y.toFixed(1)}` && !camLog.includes('scout:true'), camLog);
  camLog.length = 0;
  key(u, 'F5', true); u.frame(1000); key(u, 'F5', false);
  check('F5 with no fourth ally: nothing happens', camLog.length === 0, camLog);
});

section('Settings › Controls and strings name the new binds and modes', () => {
  const all = ACTION_GROUPS.flatMap((g) => g.actions);
  check('keys.ts lists showRange, levelUpMod, viewAlly1-4', ['showRange', 'levelUpMod', 'viewAlly1', 'viewAlly2', 'viewAlly3', 'viewAlly4'].every((a) => all.includes(a) && !!ACTION_LABELS[a]));
  const strings = JSON.parse(readFileSync('content/strings.en.json', 'utf8')) as Record<string, string>;
  const keys = ['settings.controls.action.showRange', 'settings.controls.action.levelUpMod', 'settings.controls.action.viewAlly1', 'settings.controls.action.viewAlly4',
    'settings.controls.castMode.title', 'settings.controls.castMode.desc', 'settings.controls.castMode.opt.normal', 'settings.controls.castMode.opt.quick',
    'settings.controls.castMode.opt.quickIndicator', 'settings.controls.rangeOnAttackMove.label'];
  check('every new string is in strings.en.json', keys.every((k) => !!strings[k]), keys.filter((k) => !strings[k]));
  const src = readFileSync('src/ui/screens/settings.tsx', 'utf8');
  check('the Controls tab shows the cast modes and the new binds', /castMode/.test(src) && /'showRange'/.test(src) && /'viewAlly1'/.test(src) && /rangeOnAttackMove/.test(src));
  const said = keys.map((k) => strings[k]).join(' ');
  check('no player-facing text here says bot / AI / CPU', !/\b(bots?|AI|CPU)\b/.test(said));
});

finish('probe_input_castmode');
