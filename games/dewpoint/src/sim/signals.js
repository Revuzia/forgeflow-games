// Named-channel signal system.
//
// Triggers (plates, electrodes, sensors, ...) raise RAW channels each tick with `emit`.
// Several emitters on one channel are OR-ed. Derived channels are declared in
// `level.signals` as expressions; actuators read any channel or inline expression via `on`.
//
// Expression grammar (JSON-ish):
//   'name'                    channel value
//   '!name'                   NOT channel
//   true / false              constant
//   { and: [expr, ...] }      all true
//   { or:  [expr, ...] }      any true
//   { not: expr }
//   { xor: [a, b] }           exactly one true
//   { latch: expr }           becomes true when expr is true and stays true
//   { latch: expr, reset: e } ... until `e` is true (reset wins)
//   { toggle: expr }          flips on each rising edge of expr
//   { hold: expr, for: sec }  true while expr is true and for `sec` seconds after it drops
//   { delay: expr, for: sec } true once expr has been continuously true for `sec` seconds
//
// Evaluation happens once per tick, after triggers have emitted. Actuators therefore see
// a value that is at most one tick (1/120 s) old. Stateful nodes are advanced exactly once
// per tick regardless of how many readers they have.

const KEYS = ['and', 'or', 'not', 'xor', 'latch', 'toggle', 'hold', 'delay'];

export class Signals {
  constructor(defs = {}) {
    this.raw = new Map();       // name -> bool (this tick)
    this.rawPrev = new Map();   // name -> bool (value actuators see)
    this.named = new Map();     // name -> node
    this.nodes = [];            // every stateful/compound node, evaluated every tick
    this.emitters = new Set();  // names declared by triggers (for validation)
    this.readers = new Set();   // raw names referenced by expressions
    this.stamp = 0;
    this._defs = defs || {};
    for (const name of Object.keys(this._defs)) {
      if (!/^[A-Za-z_][\w.-]*$/.test(name)) throw new Error(`signals: bad channel name "${name}"`);
    }
    // compile named definitions lazily so they may reference each other in any order
    this._compiling = new Set();
    for (const name of Object.keys(this._defs)) this._named(name);
  }

  _named(name) {
    if (this.named.has(name)) return this.named.get(name);
    if (this._compiling.has(name)) throw new Error(`signals: cycle through "${name}"`);
    this._compiling.add(name);
    const node = this.compile(this._defs[name], name);
    this._compiling.delete(name);
    this.named.set(name, node);
    return node;
  }

  /** Declare that a trigger raises this raw channel (for validation and so it reads false, not undefined). */
  declareEmitter(name) {
    if (typeof name !== 'string' || !name) throw new Error('signals: emit needs a channel name');
    if (name in this._defs) throw new Error(`signals: "${name}" is a derived channel and cannot also be emitted`);
    this.emitters.add(name);
    if (!this.raw.has(name)) { this.raw.set(name, false); this.rawPrev.set(name, false); }
  }

  /** Compile an expression into a node. `label` is only used in error messages. */
  compile(expr, label = 'expr') {
    if (expr === true || expr === false) return { op: 'const', v: expr, value: expr };
    if (typeof expr === 'string') {
      let name = expr.trim(), neg = false;
      while (name.startsWith('!')) { neg = !neg; name = name.slice(1).trim(); }
      if (!name) throw new Error(`signals: empty channel name in ${label}`);
      let node;
      if (name in this._defs) node = this._reg({ op: 'ref', target: this._named(name), value: false });
      else { this.readers.add(name); node = this._reg({ op: 'raw', name, value: false }); }
      if (neg) node = this._reg({ op: 'not', a: node, value: false });
      return node;
    }
    if (!expr || typeof expr !== 'object' || Array.isArray(expr)) {
      throw new Error(`signals: bad expression in ${label}: ${JSON.stringify(expr)}`);
    }
    const ops = KEYS.filter((k) => k in expr);
    if (ops.length !== 1) throw new Error(`signals: expression in ${label} needs exactly one of ${KEYS.join('/')}: ${JSON.stringify(expr)}`);
    const op = ops[0];
    const sub = (e) => this.compile(e, label);
    const list = (v) => {
      if (!Array.isArray(v) || v.length === 0) throw new Error(`signals: "${op}" in ${label} needs a non-empty array`);
      return v.map(sub);
    };
    switch (op) {
      case 'and': return this._reg({ op, list: list(expr.and), value: false });
      case 'or': return this._reg({ op, list: list(expr.or), value: false });
      case 'xor': {
        const l = list(expr.xor);
        if (l.length !== 2) throw new Error(`signals: "xor" in ${label} needs exactly two operands`);
        return this._reg({ op, list: l, value: false });
      }
      case 'not': return this._reg({ op, a: sub(expr.not), value: false });
      case 'latch': return this._reg({ op, a: sub(expr.latch), reset: 'reset' in expr ? sub(expr.reset) : null, state: false, value: false });
      case 'toggle': return this._reg({ op, a: sub(expr.toggle), state: false, prev: false, value: false });
      case 'hold': case 'delay': {
        const sec = Number(expr.for);
        if (!(sec >= 0)) throw new Error(`signals: "${op}" in ${label} needs a numeric "for" (seconds)`);
        return this._reg({ op, a: sub(expr[op]), sec, t: 0, value: false });
      }
    }
    throw new Error('signals: unreachable');
  }

  _reg(node) { node.stamp = -1; this.nodes.push(node); return node; }

  /** Raise a raw channel for this tick. */
  emit(name) { this.raw.set(name, true); }

  /** Called once per tick after all triggers emitted. */
  evaluate(dt) {
    this.stamp++;
    // publish this tick's raw values, then clear for the next tick
    for (const [k, v] of this.raw) { this.rawPrev.set(k, v); this.raw.set(k, false); }
    for (const n of this.nodes) this._eval(n, dt);
    for (const n of this.named.values()) this._eval(n, dt);
  }

  _eval(n, dt) {
    switch (n.op) {
      case 'const': return n.v;
      case 'raw': return (n.value = this.rawPrev.get(n.name) === true);
      case 'ref': return (n.value = this._eval(n.target, dt));
    }
    if (n.stamp === this.stamp) return n.value;
    n.stamp = this.stamp;
    let v = false;
    switch (n.op) {
      case 'and': v = true; for (const c of n.list) { if (!this._eval(c, dt)) v = false; } break;
      case 'or': v = false; for (const c of n.list) { if (this._eval(c, dt)) v = true; } break;
      case 'xor': { const a = this._eval(n.list[0], dt), b = this._eval(n.list[1], dt); v = a !== b; break; }
      case 'not': v = !this._eval(n.a, dt); break;
      case 'latch': {
        const a = this._eval(n.a, dt);
        const r = n.reset ? this._eval(n.reset, dt) : false;
        if (a) n.state = true;
        if (r) n.state = false;
        v = n.state; break;
      }
      case 'toggle': {
        const a = this._eval(n.a, dt);
        if (a && !n.prev) n.state = !n.state;
        n.prev = a; v = n.state; break;
      }
      case 'hold': {
        const a = this._eval(n.a, dt);
        if (a) { n.t = n.sec; v = true; }
        else { v = n.t > 1e-9; n.t = Math.max(0, n.t - dt); }   // stays on for `sec` after the drop
        break;
      }
      case 'delay': {
        const a = this._eval(n.a, dt);
        n.t = a ? n.t + dt : 0;
        v = a && n.t >= n.sec - 1e-9; break;
      }
    }
    return (n.value = v);
  }

  /** Read a compiled node (as returned by compile()). */
  read(node) { return node ? node.value === true : false; }

  /** Read a channel by name (raw or derived). Unknown names read false. */
  get(name) {
    const n = this.named.get(name);
    if (n) return n.value === true;
    return this.rawPrev.get(name) === true;
  }

  /** Names read by expressions that nothing emits and nothing defines: almost always a typo. */
  dangling() {
    const out = [];
    for (const r of this.readers) if (!this.emitters.has(r)) out.push(r);
    return out;
  }
}
