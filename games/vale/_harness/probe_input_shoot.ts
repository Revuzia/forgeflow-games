// probe (lane INPUT): hold Shift + left-click attacks in place toward the cursor (owner 2026-11-15, ruling 39). Runs the
// real InputController against a fake match client and the real pick maths through the real camera geometry.
//   a Shift + left-click sends { attackAt, x, y } at the clicked ground, with the enemy the click means (under the
//   cursor, else nearest the click within 2 m; fighters only within 3 m while Z is held) as `target`; it never sends
//   a move or arms hold-steer; holding the left button re-sends at the cursor every SHOOT_RESEND_MS (re-aimed), and
//   letting go of either the button or Shift stops it; a plain left-click still only selects; Shift + right-click and
//   A + left-click are unchanged; the modifier is rebindable (attackInPlace); the aim line shows while it is held; a
//   dead fighter sends nothing; the help text and settings name the bind.
import { readFileSync } from 'node:fs';
import { PerspectiveCamera, Plane, Raycaster, Vector2, Vector3 } from 'three';
import { check, finish, section } from './fixtures/sim_fixture.ts';
import { InputController, type InputHooks, type InputRenderer, type PickOpts } from '../src/input/controller.ts';
import { pickUnit, type Pickable } from '../src/render/pick.ts';
import { selecting } from '../src/ui/hud/selecting.ts';
import { CAMERA } from '../src/render/camera.ts';
import { DEFAULT_BINDS, defaultSettings } from '../src/session/settings.ts';
import { ACTION_GROUPS, ACTION_LABELS } from '../src/ui/keys.ts';
import type { Command, EntityView } from '../src/contracts/sim.ts';
import type { AimSpecLike } from '../src/input/abilities.ts';

(globalThis as { document?: unknown }).document ??= { elementFromPoint: () => null };

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
let views: EntityView[] = [];
const unit = (id: number, kind: EntityView['kind'], team: number, x: number, y: number, radius: number): EntityView =>
  ({ id, kind, team, x, y, radius, alive: true, targetable: true, visibleMask: 0b11, statuses: [], vx: 0, vy: 0 }) as unknown as EntityView;
const ART: Record<string, number> = { fighter: 1.9, minion: 1.1, structure: 6 };
const pickables = (): Pickable[] => views.map((v) => ({ id: v.id, x: v.x, y: v.y, h: 0, artHeight: ART[v.kind] ?? 1.2, view: v }));
const pick = (x: number, y: number, o?: PickOpts): number | null => pickUnit(cam, W, H, pickables(), x, y, o);

const sent: Command[] = [];
let aim: AimSpecLike | null = null;
const client = {
  you: 0,
  view: {
    get players() { return [{ entity: 1, team: 0, abilities: [], items: [], itemCooldowns: [], stats: { range: 5.5 } }]; },
    get entities() { return views; },
    entity: (id: number) => views.find((v) => v.id === id),
  },
  send: (c: Command) => { sent.push(c); },
};
const bare: InputRenderer = {
  pickGround, pickEntity: (x, y, o) => pick(x, y, o), setHover: () => {}, setAim: (a) => { aim = a; },
  unitPos: (id) => { const d = views.find((v) => v.id === id); return d ? { x: d.x, y: d.y } : null; },
};
const renderer: InputRenderer = selecting(bare, () => {});
const hooks: InputHooks = {
  toggleShop() {}, closeShop: () => false, scoreboard() {}, denied() {}, marker() {}, setCameraLock() {}, blocked: () => false, pingsDisabled: () => false,
};
const surface = { contains: () => true } as unknown as HTMLElement;
function controller(binds?: Record<string, string>): any {
  sent.length = 0; aim = null;
  const s = defaultSettings();
  if (binds) s.controls.binds = { ...s.controls.binds, ...binds };
  return new InputController({ client: client as never, renderer, index: {} as never, settings: s, hooks, surface }) as never;
}
const at = (c: Record<string, any>, p: { x: number; y: number }): void => { c.ptr.x = p.x; c.ptr.y = p.y; c.ptr.inside = true; };
const key = (c: any, code: string, down: boolean): void => {
  const e = { code, repeat: false, ctrlKey: false, shiftKey: code.startsWith('Shift') && down, target: null, defaultPrevented: false, preventDefault() {}, stopImmediatePropagation() {} };
  if (down) c.onKeyDown(e); else c.onKeyUp(e);
};
const leftDown = (c: any, shift: boolean): void => { c.ptrShift = shift; c.buttons = 1; c.leftDown({ altKey: false, shiftKey: shift, button: 0 }); };
const leftUp = (c: any): void => { c.onUp({ clientX: c.ptr.x, clientY: c.ptr.y, button: 0, buttons: 0 }); };
const of = (t: string): Command[] => sent.filter((c) => c.type === t);
type AttackAt = { type: 'attackAt'; x: number; y: number; target?: number; fighters?: boolean };

function lane(): void {
  views = [
    unit(1, 'fighter', 0, 50, 52, 0.5),
    unit(10, 'minion', 1, 53, 51, 0.45), unit(11, 'minion', 1, 54, 49.5, 0.45), unit(12, 'minion', 1, 55.5, 51.5, 0.45),
    unit(20, 'fighter', 1, 57, 50, 0.5),
  ];
}

section('Shift + left-click on open ground: one attackAt at the click, never a move, no hold-steer', () => {
  lane();
  const c = controller();
  key(c, 'ShiftLeft', true);
  const p = toScreen(44, 56);
  at(c, p);
  leftDown(c, true);
  const g = pickGround(p.x, p.y)!;
  const a = of('attackAt') as unknown as AttackAt[];
  check('one attackAt sent', a.length === 1 && sent.length === 1, sent);
  check('…at the clicked ground point', a.length === 1 && Math.hypot(a[0].x - g.x, a[0].y - g.y) < 1e-6, a[0]);
  check('…with no target (nothing near the click)', a.length === 1 && a[0].target === undefined, a[0]);
  check('no move and no hold-steer', of('move').length === 0 && c.rightHeld === false);
});

section('Shift + left-click near an enemy: the enemy nearest the click is the target', () => {
  lane();
  const c = controller();
  key(c, 'ShiftLeft', true);
  at(c, toScreen(58.6, 49.2));
  leftDown(c, true);
  const a = of('attackAt') as unknown as AttackAt[];
  check('target = the fighter by the click (not the minion nearest the hero)', a.length === 1 && a[0].target === 20, a);
});

section('Shift + left-click on a minion: it is the target', () => {
  lane();
  const c = controller();
  key(c, 'ShiftLeft', true);
  at(c, toScreen(53, 51, 0.5));
  leftDown(c, true);
  const a = of('attackAt') as unknown as AttackAt[];
  check('target = the minion under the cursor', a.length === 1 && a[0].target === 10, a);
});

section('fightersOnly held: the attackAt carries fighters-only and targets the fighter', () => {
  lane();
  const c = controller();
  key(c, 'ShiftLeft', true);
  key(c, 'KeyZ', true);
  at(c, toScreen(55, 50.5));
  leftDown(c, true);
  const a = of('attackAt') as unknown as AttackAt[];
  check('fighters: true and the fighter as target', a.length === 1 && a[0].fighters === true && a[0].target === 20, a);
});

section('held left button: re-sent at the moving cursor at the shoot cadence, stopped by the button or Shift', () => {
  lane();
  const c = controller();
  key(c, 'ShiftLeft', true);
  at(c, toScreen(44, 56));
  leftDown(c, true);
  let now = 1e6;
  c.lastShoot = now;
  for (let i = 0; i < 20; i++) { now += 50; at(c, toScreen(44 + i * 0.3, 56 - i * 0.2)); c.frame(now); }
  const a = of('attackAt') as unknown as AttackAt[];
  check('1 s held: about 10 re-sends (every 100 ms) plus the click', a.length >= 9 && a.length <= 12, a.length);
  check('the re-sends re-aim at the cursor', new Set(a.map((q) => q.x.toFixed(2))).size >= 8);
  check('never a move', of('move').length === 0);
  check('the press is a new one, every re-send says held (the sim keeps the press, orch1 r2)', !(a[0] as { held?: boolean }).held && a.slice(1).every((q) => (q as { held?: boolean }).held === true));
  const n = sent.length;
  leftUp(c);
  const endN = sent.slice(n).filter((q) => q.type === 'attackAt' && (q as { end?: boolean }).end === true).length;
  check('button up after a hold: one { attackAt, end } (no owed attack goes off after the release)', endN === 1 && sent.length === n + 1, sent.slice(n));
  const n1 = sent.length;
  for (let i = 0; i < 10; i++) { now += 50; c.frame(now); }
  check('button up: no more sends', sent.length === n1, sent.length - n1);
  leftDown(c, true);
  for (let i = 0; i < 4; i++) { now += 50; c.frame(now); }
  const n2 = sent.length;
  key(c, 'ShiftLeft', false);
  c.ptrShift = false;
  for (let i = 0; i < 10; i++) { now += 50; c.frame(now); }
  const tail = sent.slice(n2);
  check('Shift up while the button is held: one end, then no more sends', tail.length === 1 && (tail[0] as { end?: boolean }).end === true, tail);
});

section('fog (orch1 r2 note): an enemy its team cannot see is never sent as the target', () => {
  lane();
  views = views.map((v) => (v.id === 20 ? ({ ...v, visibleMask: 0b10 }) as EntityView : v));   // hidden from team 0
  const c = controller();
  key(c, 'ShiftLeft', true);
  at(c, toScreen(57, 50));                                    // right on the hidden fighter
  leftDown(c, true);
  const a = of('attackAt') as unknown as AttackAt[];
  check('one attackAt, not carrying the hidden fighter', a.length === 1 && a[0].target !== 20, a);
  lane();
  const c2 = controller();
  key(c2, 'ShiftLeft', true);
  at(c2, toScreen(57, 50));
  leftDown(c2, true);
  const b = of('attackAt') as unknown as AttackAt[];
  check('control: the same click with the fighter in sight targets it', b.length === 1 && b[0].target === 20, b);
});

section('a single Shift + left-click keeps its one attack: the release sends no end', () => {
  lane();
  const c = controller();
  key(c, 'ShiftLeft', true);
  at(c, toScreen(44, 56));
  leftDown(c, true);
  leftUp(c);
  check('one attackAt, no end', sent.length === 1 && sent[0].type === 'attackAt' && !(sent[0] as { end?: boolean }).end, sent);
});

section('a plain left-click still selects and sends nothing; Shift + right and A + left are unchanged', () => {
  lane();
  {
    const c = controller();
    at(c, toScreen(44, 56));
    leftDown(c, false);
    check('plain left-click: nothing sent', sent.length === 0, sent);
  }
  {
    const c = controller();
    at(c, toScreen(44, 56));
    c.rightDown(true);
    check('Shift + right-click on ground: an attack-move', sent.length === 1 && sent[0].type === 'move' && (sent[0] as { attackMove?: boolean }).attackMove === true, sent);
  }
  {
    const c = controller();
    key(c, 'KeyA', true); key(c, 'KeyA', false);
    at(c, toScreen(44, 56));
    leftDown(c, false);
    check('A then left-click on ground: an attack-move', sent.length === 1 && sent[0].type === 'move' && (sent[0] as { attackMove?: boolean }).attackMove === true, sent);
  }
});

section('rebindable: attackInPlace on X makes X + left-click shoot, and Shift + left-click then only selects', () => {
  lane();
  const c = controller({ attackInPlace: 'KeyX' });
  key(c, 'KeyX', true);
  at(c, toScreen(44, 56));
  leftDown(c, false);
  check('X + left-click: one attackAt', of('attackAt').length === 1, sent);
  key(c, 'KeyX', false);
  sent.length = 0;
  key(c, 'ShiftLeft', true);
  leftDown(c, true);
  check('Shift + left-click with the bind moved: nothing sent', sent.length === 0, sent);
});

section('the aim line shows while the modifier is held and clears on release', () => {
  lane();
  const c = controller();
  key(c, 'ShiftLeft', true);
  at(c, toScreen(44, 56));
  c.frame(2e6);
  check('a line from the hero toward the cursor, attack reach long', !!aim && aim.shape === 'line' && Math.abs((aim.length ?? 0) - 6) < 0.01 && aim.casterX === 50, aim);
  key(c, 'ShiftLeft', false);
  c.ptrShift = false;
  c.frame(2e6 + 100);
  check('cleared once Shift is up', aim === null, aim);
});

section('a dead fighter sends nothing', () => {
  lane();
  views[0] = { ...views[0], alive: false } as EntityView;
  const c = controller();
  key(c, 'ShiftLeft', true);
  at(c, toScreen(44, 56));
  leftDown(c, true);
  check('nothing sent', sent.length === 0, sent);
});

section('bind, settings and help text', () => {
  check('default bind: attackInPlace = ShiftLeft', DEFAULT_BINDS.attackInPlace === 'ShiftLeft');
  check('Settings › Controls lists it', ACTION_GROUPS.some((g) => g.actions.includes('attackInPlace')) && !!ACTION_LABELS.attackInPlace);
  const strings = JSON.parse(readFileSync('content/strings.en.json', 'utf8')) as Record<string, string>;
  check('a settings label string', !!strings['settings.controls.action.attackInPlace']);
  check('the attack hint names Shift + left-click', /left-click/i.test(strings['hint.attack'] ?? '') && /shoot|in place/i.test(strings['hint.attack'] ?? ''), strings['hint.attack']);
  const meta = JSON.parse(readFileSync('public/game_meta.json', 'utf8')) as { controls_keyboard: string };
  check('the portal controls string names Shift + left-click', /Shift \+ left-click/i.test(meta.controls_keyboard), meta.controls_keyboard);
  const said = [strings['hint.attack'], strings['settings.controls.action.attackInPlace'], meta.controls_keyboard].join(' ');
  check('no player-facing text here says bot / AI / CPU', !/\b(bots?|AI|CPU)\b/i.test(said), said);
});

finish('probe_input_shoot');
