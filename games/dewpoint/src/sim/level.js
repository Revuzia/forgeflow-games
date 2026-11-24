// Level loader: turns plain level data (see LEVELS.md) into validated runtime pieces.
// Throws an Error naming the level, piece index and field on any malformed data, so a
// level author finds mistakes at load time, not half-way through a play-through.

import { MIN_SOLID, PANE_BREAK_SPEED, DOOR_TIME } from './constants.js';
import { PIECE_TYPES } from './piecetypes.js';
import { getElement, allPieceTypes, ELEMENT_IDS } from './elements/index.js';

export { PIECE_TYPES };

const NO_REACT = Object.freeze({});
/** What a body that is not the hero can pass through: nothing. */
export const NO_CAPS = Object.freeze({});

const DIRS = {
  '+x': [1, 0, 0], '-x': [-1, 0, 0], '+y': [0, 1, 0], '-y': [0, -1, 0], '+z': [0, 0, 1], '-z': [0, 0, -1],
};
export function dirVec(d) { return DIRS[d]; }

const PLATE_H = 0.06;

export function buildLevel(data, signals) {
  if (!data || typeof data !== 'object') throw new Error('level: not an object');
  const lid = data.id;
  const fail = (msg) => { throw new Error(`level ${lid}: ${msg}`); };
  if (typeof lid !== 'string' || !lid) throw new Error('level: missing string id');
  if (typeof data.name !== 'string' || !data.name) fail('missing name');
  const spawn = vec3(data.spawn, 'spawn', fail);
  if (!Array.isArray(data.pieces)) fail('pieces must be an array');

  // The element decides the forms, the gauge, which pieces exist and how they react (ELEMENTS.md).
  const E = getElement(data.element);
  if (!E) fail(`unknown element ${JSON.stringify(data.element)}. Known: ${ELEMENT_IDS.join(', ')}`);
  const forms = data.forms ? data.forms.slice() : E.forms.slice();
  for (const f of forms) if (!E.forms.includes(f)) fail(`unknown form "${f}" in forms`);
  if (!forms.includes(E.defaultForm)) fail(`forms must include "${E.defaultForm}" (it is the respawn form)`);
  let startGauge = E.gauge.start;
  if (data.startGauge !== undefined) {
    if (!Number.isFinite(data.startGauge) || data.startGauge < 0 || data.startGauge > E.gauge.max) fail(`startGauge must be a number from 0 to ${E.gauge.max}`);
    startGauge = data.startGauge;
  }

  const L = {
    id: lid, name: data.name, chapter: data.chapter || 1, source: data,
    element: E, startGauge,
    spawn, camYaw: num(data.camYaw, 0), music: data.music === undefined ? 'calm' : data.music,
    forms, hints: data.hints || {},
    pieces: [], solids: [],
    movers: [], doors: [], crates: [], panes: [], embers: [], sprouts: [], plates: [],
    electrodes: [], sensors: [], fans: [], zones: [], fires: [], currents: [], checkpoints: [],
    shards: [], exits: [], hintZones: [], props: [], grates: [], slots: [], blocks: [], ramps: [],
    bounds: { x0: Infinity, y0: Infinity, z0: Infinity, x1: -Infinity, y1: -Infinity, z1: -Infinity },
    warnings: [],
  };

  const solid = (owner, kind, b, extra) => {
    const s = {
      kind, x0: b[0], y0: b[1], z0: b[2], x1: b[3], y1: b[4], z1: b[5],
      up: null, pass: null, active: true, owner, dx: 0, dy: 0, dz: 0, ...extra,
    };
    L.solids.push(s);
    return s;
  };
  const grow = (b) => {
    const B = L.bounds;
    if (b[0] < B.x0) B.x0 = b[0]; if (b[1] < B.y0) B.y0 = b[1]; if (b[2] < B.z0) B.z0 = b[2];
    if (b[3] > B.x1) B.x1 = b[3]; if (b[4] > B.y1) B.y1 = b[4]; if (b[5] > B.z1) B.z1 = b[5];
  };

  /** A free rigid box (falls, rides movers, weighs plates). Shared by `crate` and by packs' own boxes. */
  const makeCrate = (p, pos, sz) => {
    p.home = pos; p.size = sz;
    p.body = { shape: 'box', owner: p, form: 'crate', caps: NO_CAPS, x: pos[0], y: pos[1], z: pos[2], hx: sz[0] / 2, hz: sz[2] / 2, h: sz[1], vx: 0, vy: 0, vz: 0, landed: false, ground: null, wallHit: 0 };
    p.px = pos[0]; p.py = pos[1]; p.pz = pos[2];
    p.grounded = false; p.resets = 0;
    const b = [pos[0] - sz[0] / 2, pos[1], pos[2] - sz[2] / 2, pos[0] + sz[0] / 2, pos[1] + sz[1], pos[2] + sz[2] / 2];
    grow(b);
    p.solid = solid(p, 'box', b);
    L.crates.push(p);
  };

  // Element-only mechanisms ("packs") add their own lists and piece types.
  const packs = E.packs;
  const packCtx = { L, E, signals, fail, solid, grow, num, vec3, box6, makeCrate, dirs: DIRS, noCaps: NO_CAPS, minSolid: MIN_SOLID };
  for (const k of packs) if (k.init) k.init(L, packCtx);

  data.pieces.forEach((def, index) => {
    const where = `piece #${index}${def && def.id ? ` "${def.id}"` : ''} (${def && def.type})`;
    const pf = (msg) => fail(`${where}: ${msg}`);
    if (!def || typeof def !== 'object') pf('not an object');
    if (!E.pieces.includes(def.type)) {
      if (allPieceTypes().includes(def.type)) pf(`"${def.type}" is not a piece ${E.name} levels can use. ${E.name} pieces: ${E.pieces.join(', ')}`);
      pf(`unknown type. Known: ${E.pieces.join(', ')}`);
    }
    const p = { type: def.type, id: def.id || null, index, def };
    const box = () => {
      const b = box6(def.box, pf);
      p.box = b; grow(b); return b;
    };
    const thin = (b) => {
      if (b[3] - b[0] < MIN_SOLID - 1e-9 || b[4] - b[1] < MIN_SOLID - 1e-9 || b[5] - b[2] < MIN_SOLID - 1e-9) {
        pf(`solid thinner than ${MIN_SOLID} m on some axis; fast bodies could tunnel through it`);
      }
    };
    const onNode = () => (def.on === undefined ? null : signals.compile(def.on, where));
    const emit = (required) => {
      if (def.emit === undefined) { if (required) pf('needs "emit" (channel name)'); return null; }
      signals.declareEmitter(def.emit); return def.emit;
    };

    switch (def.type) {
      case 'block': {
        const b = box(); thin(b);
        p.mat = def.mat || 'tile';
        p.solid = solid(p, 'box', b);
        L.blocks.push(p); break;
      }
      case 'ramp': {
        const b = box(); thin(b);
        if (!['+x', '-x', '+z', '-z'].includes(def.up)) pf('"up" must be one of +x -x +z -z');
        p.up = def.up; p.mat = def.mat || 'tile';
        p.solid = solid(p, 'ramp', b, { up: def.up });
        const run = (def.up[1] === 'x') ? b[3] - b[0] : b[5] - b[2];
        p.slope = (b[4] - b[1]) / run;
        if (p.slope > 1.0001) L.warnings.push(`${where}: slope ${p.slope.toFixed(2)} is steeper than 45 degrees`);
        L.ramps.push(p); break;
      }
      case 'mover': {
        const b = box(); thin(b);
        p.to = vec3(def.to, 'to', pf);
        p.len = Math.hypot(p.to[0], p.to[1], p.to[2]);
        if (!(p.len > 0)) pf('"to" must be a non-zero offset');
        grow([b[0] + p.to[0], b[1] + p.to[1], b[2] + p.to[2], b[3] + p.to[0], b[4] + p.to[1], b[5] + p.to[2]]);
        p.speed = num(def.speed, 2); if (!(p.speed > 0)) pf('speed must be > 0');
        if (p.speed > 6) pf('speed above 6 m/s is not supported (riders would be thrown)');
        p.pause = num(def.pause, 1);
        p.mode = def.mode || 'loop';
        if (!['loop', 'toggle'].includes(p.mode)) pf('mode must be "loop" or "toggle"');
        p.on = onNode();
        if (p.mode === 'toggle' && !p.on) pf('mode "toggle" needs "on"');
        p.mat = def.mat || 'metal';
        p.t = 0; p.pt = 0; p.dirSign = 1; p.wait = num(def.delay, 0); p.moving = false;
        p.solid = solid(p, 'box', b);
        L.movers.push(p); break;
      }
      case 'door': {
        const b = box(); thin(b);
        p.slide = def.slide || 'down';
        if (!DIRS[p.slide] && p.slide !== 'down' && p.slide !== 'up') pf('slide must be up, down, +x, -x, +z or -z');
        const dir = p.slide === 'down' ? DIRS['-y'] : p.slide === 'up' ? DIRS['+y'] : DIRS[p.slide];
        const extent = dir[0] ? b[3] - b[0] : dir[1] ? b[4] - b[1] : b[5] - b[2];
        p.travel = [dir[0] * extent, dir[1] * extent, dir[2] * extent];
        p.time = num(def.time, DOOR_TIME); if (!(p.time > 0)) pf('time must be > 0');
        p.on = onNode(); if (!p.on) pf('needs "on" (signal expression)');
        p.open = 0; p.popen = 0; p.target = 0;
        p.buried = p.slide === 'down';
        p.solid = solid(p, 'box', b);
        L.doors.push(p); break;
      }
      case 'crate': {
        const pos = vec3(def.pos, 'pos', pf);
        let sz = def.size === undefined ? [1, 1, 1] : def.size;
        if (typeof sz === 'number') sz = [sz, sz, sz];
        sz = vec3(sz, 'size', pf);
        if (sz[0] < 0.4 || sz[1] < 0.4 || sz[2] < 0.4) pf('crate size must be at least 0.4 on every axis');
        makeCrate(p, pos, sz);
        p.crate = true;               // a plain crate: forms with `pushesCrates` can shove it
        break;
      }
      case 'pane': {
        const b = box(); thin(b);
        p.speed = num(def.speed, PANE_BREAK_SPEED);
        p.broken = false; p.emit = emit(false);
        p.solid = solid(p, 'box', b);
        L.panes.push(p); break;
      }
      case 'ember': {
        const b = box(); thin(b);
        p.doused = false; p.emit = emit(false);
        p.solid = solid(p, 'box', b);
        L.embers.push(p); break;
      }
      case 'grate': {
        const b = box(); thin(b);
        p.solid = solid(p, 'box', b, { pass: 'passesGrate' });
        L.grates.push(p); break;
      }
      case 'slot': {
        const b = box(); thin(b);
        p.solid = solid(p, 'box', b, { pass: 'passesSlot' });
        L.slots.push(p); break;
      }
      case 'sprout': {
        const pos = vec3(def.pos, 'pos', pf);
        p.pos = pos;
        p.height = num(def.height, 3); if (!(p.height >= 0.6)) pf('height must be >= 0.6');
        p.axis = def.axis || 'x'; if (!['x', 'z'].includes(p.axis)) pf('axis must be "x" or "z"');
        p.state = 0; p.growth = 0; p.pgrowth = 0; p.emit = emit(false);
        // A beanstalk of ONE-WAY leaves no more than 1.2 m apart: Mote stands by the stalk and
        // hops straight up through each leaf, landing on top. Lower leaves are 1.4 m square and
        // alternate +0.45 / -0.45 m along `axis`; the top leaf is 1.8 m square, centred.
        const n = Math.max(1, Math.ceil(p.height / 1.2 - 1e-9));
        p.leaves = [];
        for (let i = 1; i <= n; i++) {
          const top = pos[1] + p.height * i / n;
          const last = i === n;
          const half = last ? 0.9 : 0.7;
          const off = last ? 0 : (i % 2 === 1 ? 0.45 : -0.45);
          const cx = pos[0] + (p.axis === 'x' ? off : 0), cz = pos[2] + (p.axis === 'z' ? off : 0);
          const b = [cx - half, top - 0.18, cz - half, cx + half, top, cz + half];
          grow(b);
          const s = solid(p, 'box', b, { active: false, oneWay: true });
          p.leaves.push({ box: b, solid: s, top: last });
        }
        L.sprouts.push(p); break;
      }
      case 'plate': {
        const pos = vec3(def.pos, 'pos', pf);
        let sz = def.size === undefined ? [1.4, 1.4] : def.size;
        if (!Array.isArray(sz) || sz.length !== 2 || !(sz[0] > 0) || !(sz[1] > 0)) pf('size must be [width(x), depth(z)]');
        p.pos = pos; p.size = sz; p.heavy = !!def.heavy; p.emit = emit(true);
        p.pressed = false; p.by = null;
        const b = [pos[0] - sz[0] / 2, pos[1], pos[2] - sz[1] / 2, pos[0] + sz[0] / 2, pos[1] + PLATE_H, pos[2] + sz[1] / 2];
        p.box = b; grow(b);
        // 0.06 m lip: every grounded form steps onto it (film's step-up is 0.12)
        p.solid = solid(p, 'box', b);
        L.plates.push(p); break;
      }
      case 'electrodes': {
        box(); p.emit = emit(true); p.live = false;
        p.axis = def.axis || ((p.box[3] - p.box[0]) >= (p.box[5] - p.box[2]) ? 'x' : 'z');
        L.electrodes.push(p); break;
      }
      case 'sensor': {
        box(); p.emit = emit(true); p.live = false;
        p.forms = def.forms || null; p.crates = !!def.crates;
        if (p.forms) for (const f of p.forms) if (!E.forms.includes(f)) pf(`unknown form "${f}"`);
        p.visible = def.visible !== false;
        L.sensors.push(p); break;
      }
      case 'fan': {
        box();
        if (!DIRS[def.dir]) pf('"dir" must be one of +x -x +y -y +z -z');
        p.dir = DIRS[def.dir]; p.dirName = def.dir;
        p.strength = num(def.strength, 8); if (!(p.strength > 0)) pf('strength must be > 0');
        p.on = onNode(); p.active = !p.on;
        L.fans.push(p); break;
      }
      case 'heatvent': case 'frost': case 'cold': case 'hotfloor': {
        box(); p.on = onNode(); p.active = !p.on;
        // what the zone does is the element's business: { force, fill, hold, demote, ifFits, refuse }
        p.react = (E.zones && E.zones[def.type]) || NO_REACT;
        p.force = p.react.force || null;
        // a hot floor is a thin slab: it acts on a body that merely stands on it; the others have a forgiving margin
        p.mxz = def.type === 'hotfloor' ? 0.05 : 0.12; p.my = def.type === 'hotfloor' ? 0 : 0.02;
        L.zones.push(p); break;
      }
      case 'fire': {
        box(); p.on = onNode(); p.active = !p.on;
        L.fires.push(p); break;
      }
      case 'current': {
        box();
        const fl = def.flow === undefined ? [0, 0] : def.flow;
        if (!Array.isArray(fl) || fl.length !== 2 || !fl.every(Number.isFinite)) pf('flow must be [vx, vz] in m/s');
        p.flow = fl; p.on = onNode(); p.active = !p.on;
        L.currents.push(p); break;
      }
      case 'checkpoint': {
        p.pos = vec3(def.pos, 'pos', pf); p.r = num(def.r, 1.1); p.lit = false;
        grow([p.pos[0], p.pos[1], p.pos[2], p.pos[0], p.pos[1], p.pos[2]]);
        p.emit = emit(false);
        L.checkpoints.push(p); break;
      }
      case 'shard': {
        p.pos = vec3(def.pos, 'pos', pf); p.taken = false; p.shardIndex = L.shards.length;
        L.shards.push(p); break;
      }
      case 'exit': {
        p.pos = vec3(def.pos, 'pos', pf);
        p.face = def.face || '-x';
        if (!['+x', '-x', '+z', '-z'].includes(p.face)) pf('face must be +x -x +z or -z (the side the door opening looks toward)');
        p.on = onNode(); p.open = !p.on;
        // trigger volume: 1.5 wide, 1.6 tall, centred on pos
        p.box = [p.pos[0] - 0.75, p.pos[1], p.pos[2] - 0.75, p.pos[0] + 0.75, p.pos[1] + 1.6, p.pos[2] + 0.75];
        grow(p.box);
        L.exits.push(p); break;
      }
      case 'hint': {
        box();
        if (typeof def.key !== 'string' || !(def.key in L.hints)) pf(`"key" must name an entry of level.hints`);
        p.key = def.key; p.seen = false;
        L.hintZones.push(p); break;
      }
      case 'prop': {
        p.pos = vec3(def.pos, 'pos', pf);
        p.kind = def.kind || 'lamp';
        if (!['lamp', 'pots', 'kiln', 'pipe', 'shelf', 'chimney'].includes(p.kind)) pf('prop kind must be lamp, pots, kiln, pipe, shelf or chimney');
        p.rot = num(def.rot, 0); p.scale = num(def.scale, 1);
        if (!(p.scale > 0)) pf('scale must be > 0');
        // Props are scenery, but Mote should not walk through them: each kind gets a simple
        // box collider (set solid:false for pure background dressing out of reach).
        if (def.solid !== false) {
          const [x, y, z] = p.pos, s = p.scale;
          const alongX = Math.abs(Math.cos(p.rot * Math.PI / 180)) > 0.5;
          let b;
          switch (p.kind) {
            case 'lamp': b = [x - 0.14 * s, y, z - 0.14 * s, x + 0.14 * s, y + 2.1 * s, z + 0.14 * s]; break;
            case 'pots': b = [x - 0.5 * s, y, z - 0.75 * s, x + 0.9 * s, y + 0.55 * s, z + 0.95 * s]; break;
            case 'kiln': b = [x - 1.05 * s, y, z - 1.05 * s, x + 1.05 * s, y + 1.8 * s, z + 1.05 * s]; break;
            case 'pipe': b = alongX ? [x - 1.5 * s - 0.14, y, z - 0.2, x + 1.5 * s + 0.14, y + 0.58, z + 0.2] : [x - 0.2, y, z - 1.5 * s - 0.14, x + 0.2, y + 0.58, z + 1.5 * s + 0.14]; break;
            case 'shelf': b = alongX ? [x - 1.1 * s, y, z - 0.28 * s, x + 1.1 * s, y + 1.8 * s, z + 0.28 * s] : [x - 0.28 * s, y, z - 1.1 * s, x + 0.28 * s, y + 1.8 * s, z + 1.1 * s]; break;
            default: b = [x - 0.6 * s, y, z - 0.6 * s, x + 0.6 * s, y + 6 * s, z + 0.6 * s]; break; // chimney
          }
          p.box = b; grow(b);
          p.solid = solid(p, 'box', b);
        }
        L.props.push(p); break;
      }
      default: {
        // an element-only piece: its pack validates the fields and fills in the runtime piece
        const pack = packs.find((k) => k.types.includes(def.type));
        if (!pack) pf(`no pack builds "${def.type}" (it is listed in the element's pieces but no pack provides it)`);
        pack.build(def.type, def, p, { ...packCtx, where, pf, box, thin, onNode, emit });
      }
    }
    L.pieces.push(p);
  });
  for (const k of packs) if (k.finish) k.finish(L, packCtx);

  if (L.exits.length !== 1) fail(`needs exactly one "exit" piece (found ${L.exits.length})`);
  if (L.shards.length > 3) fail(`at most 3 shards per level (found ${L.shards.length})`);
  for (const d of signals.dangling()) L.warnings.push(`signal "${d}" is read but nothing emits or defines it`);
  L.killY = num(data.killY, L.bounds.y0 - 8);
  return L;
}

function num(v, dflt) {
  if (v === undefined || v === null) return dflt;
  if (!Number.isFinite(v)) throw new Error(`expected a finite number, got ${v}`);
  return v;
}

function vec3(v, name, fail) {
  if (!Array.isArray(v) || v.length !== 3 || !v.every(Number.isFinite)) fail(`"${name}" must be [x, y, z]`);
  return v.slice();
}

function box6(v, fail) {
  if (!Array.isArray(v) || v.length !== 6 || !v.every(Number.isFinite)) fail('"box" must be [x0, y0, z0, x1, y1, z1]');
  const b = [Math.min(v[0], v[3]), Math.min(v[1], v[4]), Math.min(v[2], v[5]), Math.max(v[0], v[3]), Math.max(v[1], v[4]), Math.max(v[2], v[5])];
  if (!(b[3] > b[0]) || !(b[4] > b[1]) || !(b[5] > b[2])) fail('"box" has zero size on some axis');
  return b;
}
