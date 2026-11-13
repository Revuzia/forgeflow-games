// probe (lane INPUT): clicking units is forgiving and attack-move clicks mean what the player pointed at
// (owner report 2026-11-12, ruling 33). Runs the real InputController against a fake match client and the
// real pick maths (render/pick.ts) through the real camera geometry (pitch 52°, fov 26°, 31 m, 1920 × 1080).
//   pick: a click on a unit's ground footprint and selection ring hits it; a near miss within the slop hits it;
//         an enemies-only pick never returns you or an ally in front; overlap goes to the nearest body axis.
//   controller: Shift + right-click and A + left-click attack the enemy under the cursor, else the enemy
//         nearest the CLICK (not the hero) within 2 m, else attack-move the ground; a unit click never arms
//         hold-steer; hold-steer re-issues only on real pointer motion (a following camera alone never walks the
//         hero); a chorded right release ends the steer; fightersOnly (held) picks fighters only; the hover
//         outline names exactly what the click will attack.
import { PerspectiveCamera, Plane, Raycaster, Vector2, Vector3 } from 'three';
import { check, finish, section } from './fixtures/sim_fixture.ts';
import { InputController, type InputHooks, type InputRenderer, type PickOpts } from '../src/input/controller.ts';
import { pickUnit, type Pickable } from '../src/render/pick.ts';
import { CAMERA } from '../src/render/camera.ts';
import { defaultSettings } from '../src/session/settings.ts';
import type { Command, EntityView } from '../src/contracts/sim.ts';

(globalThis as { document?: unknown }).document ??= { elementFromPoint: () => null };

const W = 1920, H = 1080;
const cam = new PerspectiveCamera(CAMERA.fovDeg, W / H, 0.5, 400);
function focus(x: number, y: number): void {
  const p = (CAMERA.pitchDeg * Math.PI) / 180;
  cam.position.set(x, Math.sin(p) * CAMERA.distance, y + Math.cos(p) * CAMERA.distance);
  cam.lookAt(x, 0, y);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
}
focus(50, 50);
const toScreen = (x: number, y: number, h = 0): { x: number; y: number } => {
  const v = new Vector3(x, h, y).project(cam);
  return { x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H };
};
const rc = new Raycaster(), ground = new Plane(new Vector3(0, 1, 0), 0), hit = new Vector3();
const pickGround = (x: number, y: number): { x: number; y: number } | null => {
  rc.setFromCamera(new Vector2((x / W) * 2 - 1, -(y / H) * 2 + 1), cam);
  return rc.ray.intersectPlane(ground, hit) ? { x: hit.x, y: hit.z } : null;
};

type Kind = EntityView['kind'];
let views: EntityView[] = [];
const unit = (id: number, kind: Kind, team: number, x: number, y: number, radius: number): EntityView =>
  ({ id, kind, team, x, y, radius, alive: true, targetable: true, visibleMask: 0b11, statuses: [], vx: 0, vy: 0 }) as unknown as EntityView;
const ART: Record<string, number> = { fighter: 1.9, minion: 1.1, structure: 6 };
const pickables = (): Pickable[] => views.map((v) => ({ id: v.id, x: v.x, y: v.y, h: 0, artHeight: ART[v.kind] ?? 1.2, view: v }));
const pick = (x: number, y: number, o?: PickOpts): number | null => pickUnit(cam, W, H, pickables(), x, y, o);

// ── the controller harness ──
const sent: Command[] = [];
let hover: number | null = null;
const client = {
  you: 0,
  view: {
    get players() { return [{ entity: 1, team: 0, abilities: [], items: [], itemCooldowns: [] }]; },
    get entities() { return views; },
    entity: (id: number) => views.find((v) => v.id === id),
  },
  send: (c: Command) => { sent.push(c); },
};
const renderer: InputRenderer = { pickGround, pickEntity: (x, y, o) => pick(x, y, o), setHover: (id) => { hover = id; } };
const hooks: InputHooks = {
  toggleShop() {}, closeShop: () => false, scoreboard() {}, denied() {}, marker() {}, setCameraLock() {}, blocked: () => false, pingsDisabled: () => false,
};
const surface = { contains: () => true } as unknown as HTMLElement;
// the controller with its private pointer handlers reachable (the probe drives them directly)
function controller(): any {
  sent.length = 0; hover = null;
  return new InputController({ client: client as never, renderer, index: {} as never, settings: defaultSettings(), hooks, surface }) as never;
}
const at = (c: Record<string, any>, p: { x: number; y: number }): void => { c.ptr.x = p.x; c.ptr.y = p.y; c.ptr.inside = true; };
const last = (): Command | undefined => sent[sent.length - 1];

// the hero (id 1, team 0) at (50, 52); an enemy minion wave in front, an enemy fighter behind it
function lane(): void {
  views = [
    unit(1, 'fighter', 0, 50, 52, 0.5),
    unit(10, 'minion', 1, 53, 51, 0.45), unit(11, 'minion', 1, 54, 49.5, 0.45), unit(12, 'minion', 1, 55.5, 51.5, 0.45),
    unit(20, 'fighter', 1, 57, 50, 0.5),
    unit(30, 'minion', 0, 52.2, 51.6, 0.45),
  ];
}

section('pick: a lone minion is clickable on its footprint, its selection ring and a near miss', () => {
  views = [unit(10, 'minion', 1, 50, 50, 0.45)];
  const side = toScreen(50 + 0.45, 50), front = toScreen(50, 50 + 0.45 + 0.2), feet = toScreen(50, 50);
  check('the side edge of its collision circle hits it', pick(side.x - 1, side.y) === 10);
  check('the front edge of its selection ring hits it', pick(front.x, front.y - 1) === 10);
  const edge = toScreen(50 + 0.45 + 0.15, 50).x;   // the box edge (collision radius + 0.15 m)
  check('a click well clear of it is ground', pick(edge + 30, feet.y) === null && pick(edge + 30, feet.y, { slop: 14 }) === null);
  const nearMiss = { x: edge + 9, y: feet.y };
  check('a near miss (≤ 14 px) hits it with slop, not without', pick(nearMiss.x, nearMiss.y, { slop: 14 }) === 10 && pick(nearMiss.x, nearMiss.y) === null, nearMiss);
});

section('pick: overlap and the enemies-only filter', () => {
  views = [unit(1, 'fighter', 0, 50, 50.9, 0.5), unit(10, 'minion', 1, 50, 50, 0.45)];
  const m = toScreen(50, 50, 0.6);
  const enemy = (v: EntityView): boolean => v.team !== 0;
  check('your own fighter in front can take an unfiltered pick', pick(m.x, m.y + 30) === 1);
  check('an enemies-only pick never returns you', pick(m.x, m.y + 30, { filter: enemy }) === 10);
  views = [unit(10, 'minion', 1, 50, 50, 0.45), unit(11, 'minion', 1, 50.7, 50, 0.45)];
  const a = toScreen(50, 50, 0.5), b = toScreen(50.7, 50, 0.5);
  check('overlapping boxes go to the body axis nearest the cursor', pick(a.x + (b.x - a.x) * 0.35, a.y) === 10 && pick(a.x + (b.x - a.x) * 0.65, a.y) === 11);
});

section('Shift + right-click on an enemy fighter behind the wave attacks it (no hold armed)', () => {
  lane();
  const c = controller();
  const f = toScreen(57, 50, 1.0);   // on the fighter's torso
  at(c, f);
  c.rightDown(true);
  const cmd = last();
  check('an attack on the clicked fighter', cmd?.type === 'attack' && (cmd as { target: number }).target === 20, cmd);
  check('hold-steer is not armed for a unit click', c.rightHeld === false);
});

section('Shift + right-click NEAR an enemy attacks the one nearest the click, not the hero', () => {
  lane();
  const c = controller();
  at(c, toScreen(58.6, 49.2));   // ground 1.3 m from the fighter's edge, clear of every box
  check('the cursor is not on any unit', pick(c.ptr.x, c.ptr.y, { slop: 14 }) === null);
  c.rightDown(true);
  const cmd = last();
  check('attacks the fighter (nearest the click), not minion 10 (nearest the hero)', cmd?.type === 'attack' && (cmd as { target: number }).target === 20, cmd);
});

section('A then left-click near a minion attacks that minion', () => {
  lane();
  const c = controller();
  c.action('attackMove', true);
  at(c, toScreen(54.9, 48.2));   // nearest minion 11 (1.4 m), the fighter 2.9 m away
  c.leftDown({ altKey: false } as PointerEvent);
  const cmd = last();
  check('attacks minion 11', cmd?.type === 'attack' && (cmd as { target: number }).target === 11, cmd);
});

section('Shift + right-click on open ground attack-moves; the held button steers only when the pointer moves', () => {
  lane();
  const c = controller();
  at(c, toScreen(45, 56));
  c.rightDown(true);
  const cmd = last() as { type: string; attackMove?: boolean; x: number; y: number };
  check('a ground attack-move', cmd?.type === 'move' && cmd.attackMove === true && Math.abs(cmd.x - 45) < 0.05, cmd);
  check('hold-steer armed', c.rightHeld === true);
  const n = sent.length;
  focus(48, 54);                         // a locked camera follows the hero: the ground under the still cursor moves
  c.frame(performance.now() + 400);
  check('a still pointer over a following camera re-issues nothing', sent.length === n, sent.slice(n));
  at(c, { x: c.ptr.x + 40, y: c.ptr.y });
  c.frame(performance.now() + 800);
  const re = last() as { type: string; attackMove?: boolean };
  check('real pointer motion re-steers (still an attack-move)', sent.length === n + 1 && re.type === 'move' && re.attackMove === true, sent.slice(n));
  focus(50, 50);
});

section('plain right-click: an ally in front never turns an enemy click into a move; near misses attack', () => {
  views = [unit(1, 'fighter', 0, 40, 40, 0.5), unit(10, 'minion', 1, 50, 50, 0.45), unit(30, 'minion', 0, 50, 50.8, 0.45)];
  const c = controller();
  // a point on the enemy's box where the unfiltered pick takes the ally standing in front
  const m = toScreen(50, 50, 0.5);
  let spot: { x: number; y: number } | null = null;
  for (let dy = -60; dy <= 60 && !spot; dy += 2) for (let dx = -40; dx <= 40 && !spot; dx += 2) {
    const p = { x: m.x + dx, y: m.y + dy };
    if (pick(p.x, p.y) === 30 && pick(p.x, p.y, { filter: (v) => v.team === 1 }) === 10) spot = p;
  }
  check('(the ally steals some of the enemy\'s box from an unfiltered pick)', spot !== null);
  at(c, spot ?? m);
  c.rightDown(false);
  check('attacks the enemy', last()?.type === 'attack' && (last() as { target: number }).target === 10, last());
  const c2 = controller();
  views = [unit(1, 'fighter', 0, 40, 40, 0.5), unit(10, 'minion', 1, 50, 50, 0.45)];
  const side = toScreen(50.6, 50);
  at(c2, { x: side.x + 6, y: side.y });
  c2.rightDown(false);
  check('a near miss (6 px) attacks instead of walking into the wave', last()?.type === 'attack', last());
  check('…and arms no steer', c2.rightHeld === false);
  // verifier r2: the 14 px attack-click slop turned plain ground clicks beside enemies into chases
  const c3 = controller();
  at(c3, { x: side.x + 12, y: side.y });
  c3.rightDown(false);
  check('a plain right-click 12 px clear of an enemy stays a move (attack clicks keep 14 px)', last()?.type === 'move', last());
  const c4 = controller();
  views = [unit(1, 'fighter', 0, 40, 40, 0.5), unit(40, 'monster', 2, 50, 50, 0.6)];
  const ms = toScreen(50.75, 50);
  at(c4, { x: ms.x + 5, y: ms.y });
  c4.rightDown(false);
  check('a near miss beside a neutral monster stays a move (no chase into a camp)', last()?.type === 'move', last());
  at(c4, toScreen(50, 50, 0.4));
  c4.rightDown(false);
  check('…a click on the monster itself attacks it', last()?.type === 'attack' && (last() as { target: number }).target === 40, last());
});

section('fightersOnly (held) picks the enemy fighter over a minion under the cursor', () => {
  lane();
  const c = controller();
  const m = toScreen(55.5, 51.5, 0.5);   // on minion 12; the fighter is 2.1 m away
  at(c, m);
  c.held.add('KeyZ');
  c.rightDown(true);
  check('attacks the fighter', last()?.type === 'attack' && (last() as { target: number }).target === 20, last());
  const c2 = controller();
  at(c2, m);
  c2.rightDown(true);
  check('without it the minion under the cursor is attacked', last()?.type === 'attack' && (last() as { target: number }).target === 12, last());
});

section('chorded buttons: a right release during a left hold ends the steer; a chorded left press counts', () => {
  lane();
  const c = controller();
  at(c, toScreen(45, 56));
  const ev = (o: Partial<PointerEvent>): PointerEvent => ({ clientX: c.ptr.x, clientY: c.ptr.y, shiftKey: false, pointerType: 'mouse', target: surface, button: -1, buttons: 0, ...o }) as PointerEvent;
  c.onDown(ev({ button: 2, buttons: 2 }));
  check('steer armed', c.rightHeld === true);
  const n = sent.length;
  c.onMove(ev({ button: 0, buttons: 3 }));   // left pressed while right held: no pointerdown fires
  c.onMove(ev({ button: -1, buttons: 3 }));  // a plain move while both are held: nothing new
  c.onMove(ev({ button: 2, buttons: 1 }));   // right released while left held: no pointerup fires
  check('the steer ended without a right pointerup', c.rightHeld === false);
  check('no extra orders from the chord itself', sent.length === n, sent.slice(n));
  c.onUp(ev({ button: 0, buttons: 0 }));
  c.onDown(ev({ button: 2, buttons: 2 }));
  c.action('attackMove', true);
  at(c, toScreen(54.9, 48.2));
  c.onMove(ev({ clientX: c.ptr.x, clientY: c.ptr.y, button: 0, buttons: 3 }));
  check('a chorded left press finishes an A attack-move', last()?.type === 'attack' && (last() as { target: number }).target === 11, last());
});

section('hover names exactly what the click will attack', () => {
  lane();
  const c = controller();
  at(c, toScreen(58.6, 49.2));
  c.held.add('ShiftLeft');
  c.frame(performance.now() + 1000);
  check('Shift held: the outline is on the attack-move target (the fighter)', hover === 20, hover);
  check('…with the attack-move cursor', c.cursor.value === 'attackMove');
  c.held.delete('ShiftLeft');
  c.frame(performance.now() + 2000);
  check('released: no outline on open ground', hover === null, hover);
  const side = toScreen(53.6, 51);
  at(c, { x: side.x + 6, y: side.y });
  c.frame(performance.now() + 3000);
  check('a near miss on an enemy shows its outline and the attack cursor', hover === 10 && c.cursor.value === 'attack', { hover, cursor: c.cursor.value });
});

finish('probe_input_clicks');
