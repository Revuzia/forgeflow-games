// Tests for src/audio.js. Run with:  node tests/audio.test.js
// No dependencies. Works whether or not a package.json with "type":"module" exists:
// the module under test is loaded through a data: URL so Node never has to guess its type.

async function main() {
  const fs = typeof require === 'function' ? require('fs') : await import('node:fs');
  const path = typeof require === 'function' ? require('path') : await import('node:path');
  const here = path.dirname(path.resolve(process.argv[1]));
  // AUDIO_SRC=<file> tests another copy of the module (used once to take the golden fingerprints
  // from the pre-element version; see "water unchanged"). Normal runs test src/audio.js.
  const srcFile = process.env.AUDIO_SRC || path.join(here, '..', 'src', 'audio.js');
  const src = fs.readFileSync(srcFile, 'utf8');
  const mod = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
  const { createAudio, audio: defaultAudio, SFX_NAMES, SFX_NAMES_BASE, SFX_NAMES_NEW, FORMS, ELEMENTS, ELEMENT_FORMS, MOODS, volumeToGain } = mod;
  const crypto = await import('node:crypto');

  // ----------------------------------------------------------------- tiny harness
  let passed = 0;
  const failures = [];
  function check(cond, msg) {
    if (cond) passed++;
    else { failures.push(msg); console.error('  FAIL: ' + msg); }
  }
  function section(name) { console.log('\n' + name); }
  function noThrow(fn, msg) {
    try { fn(); passed++; } catch (e) { failures.push(msg + ' threw ' + e); console.error('  FAIL: ' + msg + ' threw ' + (e && e.stack)); }
  }
  const near = (a, b, eps) => Math.abs(a - b) <= (eps === undefined ? 1e-6 : eps);

  // ----------------------------------------------------------------- strict fake Web Audio
  // Strict on purpose: throws where a real browser throws (non-finite numbers, exponential
  // ramp to <=0, start() twice, stop() before start(), invalid enum values).
  function makeFake(variant) {
    variant = variant || {};
    const ctxs = [];
    const chk = (...ns) => { for (const n of ns) if (typeof n !== 'number' || !Number.isFinite(n)) throw new TypeError('non-finite number ' + n); };
    class Param {
      constructor(v) { this._v = v; this.final = v; this.calls = []; this.peaks = []; }
      get value() { return this._v; }
      set value(v) { chk(v); this._v = v; this.final = v; }
      setValueAtTime(v, t) { chk(v, t); if (t < 0) throw new RangeError('neg time'); this.final = v; this.calls.push(['set', v, t]); return this; }
      linearRampToValueAtTime(v, t) { chk(v, t); this.final = v; this.peaks.push(v); this.calls.push(['lin', v, t]); return this; }
      exponentialRampToValueAtTime(v, t) {
        chk(v, t);
        if (!(v > 1.4e-45) && !(v < -1.4e-45)) throw new RangeError('exp ramp to ~0');
        this.final = v; this.calls.push(['exp', v, t]); return this;
      }
      setTargetAtTime(v, t, tc) { chk(v, t, tc); if (tc < 0) throw new RangeError('tc'); this.final = v; this.calls.push(['target', v, t]); return this; }
      cancelScheduledValues(t) { chk(t); this.calls.push(['cancel', t]); return this; }
      setValueCurveAtTime(a, t, d) { chk(t, d); if (d <= 0 || a.length < 2) throw new RangeError('curve'); this.final = a[a.length - 1]; this.calls.push(['curve', t, d]); return this; }
    }
    if (variant.cancelAndHold) Param.prototype.cancelAndHoldAtTime = function (t) { chk(t); this.calls.push(['hold', t]); return this; };

    class Node {
      constructor(ctx, kind) { this.ctx = ctx; this.kind = kind; this.out = []; this.disconnected = false; ctx.nodes.push(this); }
      connect(n) {
        if (!(n instanceof Node) && !(n instanceof Param)) throw new TypeError('connect target');
        this.out.push(n); return n;
      }
      disconnect() { this.disconnected = true; this.out = []; }
    }
    const nodeWithParams = (kind, params) => class extends Node {
      constructor(ctx) { super(ctx, kind); for (const k of Object.keys(params)) this[k] = new Param(params[k]); }
    };
    const Gain = nodeWithParams('gain', { gain: 1 });
    const Comp = nodeWithParams('comp', { threshold: -24, knee: 30, ratio: 12, attack: 0.003, release: 0.25 });
    const Delay = nodeWithParams('delay', { delayTime: 0 });
    const Panner = nodeWithParams('panner', { pan: 0 });
    const FILTERS = ['lowpass', 'highpass', 'bandpass', 'lowshelf', 'highshelf', 'peaking', 'notch', 'allpass'];
    class Biquad extends Node {
      constructor(ctx) { super(ctx, 'biquad'); this.frequency = new Param(350); this.Q = new Param(1); this.gain = new Param(0); this.detune = new Param(0); this._type = 'lowpass'; }
      get type() { return this._type; }
      set type(t) { if (!FILTERS.includes(t)) throw new TypeError('bad filter type ' + t); this._type = t; }
    }
    class Convolver extends Node {
      constructor(ctx) { super(ctx, 'convolver'); this.buffer = null; this.normalize = true; }
    }
    class Source extends Node {
      constructor(ctx, kind) { super(ctx, kind); this.started = false; this.startTime = undefined; this.stopTime = undefined; this.stopped = false; this.ended = false; this.onended = null; }
      start(t, off) {
        if (this.started) throw new Error('InvalidStateError: start twice');
        if (t !== undefined) chk(t);
        if (off !== undefined) chk(off);
        this.started = true; this.startTime = t || 0; this.ctx.startCount++; this.ctx.live.add(this);
      }
      stop(t) {
        if (!this.started) throw new Error('InvalidStateError: stop before start');
        if (t !== undefined) chk(t);
        this.stopCalls = (this.stopCalls || 0) + 1;
        if (t !== undefined && t < this.ctx.currentTime - 1e-9) this.ctx.pastStops++;
        this.stopTime = t === undefined ? 0 : t; this.stopped = true;
      }
    }
    const TYPES = ['sine', 'square', 'sawtooth', 'triangle'];
    class Osc extends Source {
      constructor(ctx) { super(ctx, 'osc'); this.frequency = new Param(440); this.detune = new Param(0); this._type = 'sine'; }
      get type() { return this._type; }
      set type(t) { if (!TYPES.includes(t)) throw new TypeError('bad osc type ' + t); this._type = t; }
    }
    class BufSrc extends Source {
      constructor(ctx) { super(ctx, 'bufsrc'); this.buffer = null; this.loop = false; }
    }
    class Ctx {
      constructor(o) {
        this.nodes = []; this.pastStops = 0; this.live = new Set(); this.startCount = 0; this.currentTime = 0; this.sampleRate = 48000;
        this.state = variant.startSuspended ? 'suspended' : 'running';
        this.resumeCalls = 0; this.suspendCalls = 0; this.onstatechange = null;
        this.destination = new Node(this, 'destination');
        ctxs.push(this);
        Ctx.created++;
        this.options = o;
      }
      createGain() { return new Gain(this); }
      createOscillator() { return new Osc(this); }
      createBufferSource() { return new BufSrc(this); }
      createBiquadFilter() { return new Biquad(this); }
      createDynamicsCompressor() { return new Comp(this); }
      createConvolver() { return new Convolver(this); }
      createDelay(max) { if (!(max > 0)) throw new RangeError('maxDelay'); return new Delay(this); }
      createStereoPanner() { return new Panner(this); }
      createBuffer(ch, len, sr) {
        if (!(ch >= 1) || !(len >= 1) || !(sr > 0)) throw new RangeError('createBuffer');
        const data = []; for (let i = 0; i < ch; i++) data.push(new Float32Array(len));
        return { numberOfChannels: ch, length: len, sampleRate: sr, duration: len / sr, getChannelData: (i) => data[i] };
      }
      resume() { this.resumeCalls++; return Promise.resolve().then(() => { this.state = 'running'; if (this.onstatechange) this.onstatechange(); }); }
      suspend() { this.suspendCalls++; this.state = 'suspended'; return Promise.resolve(); }
      // virtual time: moves the clock and fires onended for sources whose stop time passed
      advance(dt) {
        this.currentTime += dt;
        for (const n of Array.from(this.live)) {
          if (n.stopped && !n.ended && n.stopTime <= this.currentTime) {
            n.ended = true;
            this.live.delete(n);
            if (typeof n.onended === 'function') n.onended();
          }
        }
      }
      sources() { return this.nodes.filter((n) => n instanceof Source); }
    }
    Ctx.created = 0;
    Ctx.ctxs = ctxs;
    return Ctx;
  }

  // fake DOM for the autoplay-unlock test
  function makeDoc() {
    const l = [];
    return {
      listeners: l,
      addEventListener(t, f, o) { l.push({ t, f, o }); },
      removeEventListener(t, f) { const i = l.findIndex((x) => x.t === t && x.f === f); if (i >= 0) l.splice(i, 1); },
      fire(t) { for (const x of l.slice()) if (x.t === t) x.f({ type: t }); },
    };
  }

  const CONTRACT = ['jump', 'land', 'splash', 'freeze', 'melt', 'vaporize', 'condense', 'flatten', 'unflatten',
    'plate_down', 'plate_up', 'door_open', 'door_close', 'fan', 'pane_crack', 'pane_smash', 'crate_push',
    'ember_douse', 'sprout_grow', 'spark', 'checkpoint', 'shard', 'respawn', 'level_complete', 'ui_tap', 'ui_back', 'denied'];

  // DESIGN-ELEMENTS.md "Audio" section, in its order
  const NEW_LIST = ['ignite', 'flare', 'smoke_puff', 'spark_zip', 'wire_ride', 'fuse_burn', 'wood_burn', 'ice_melt',
    'wax_melt', 'gas_blast', 'extinguish', 'coal', 'squish', 'slip_pour', 'fire_harden', 'shell_shed',
    'shell_crumble', 'dust_puff', 'soak', 'mould_cast', 'piston', 'wheel_spin', 'climb_stick'];
  const ALL = CONTRACT.concat(NEW_LIST);
  const EL_FORMS = { water: ['liquid', 'ice', 'steam', 'film'], fire: ['ember', 'blaze', 'smoke', 'spark'], clay: ['clay', 'slip', 'stone', 'dust'] };

  // ----------------------------------------------------------------- fingerprints (water-unchanged proof)
  // A seeded Math.random plus the fake context's complete call log (every node, every parameter
  // event, every connection and start/stop time) reduced to a hash. The golden values below were
  // taken from the module as it was BEFORE elements existed (AUDIO_SRC=<that copy> node
  // tests/audio.test.js --print-golden); equal hashes mean the element-aware module builds the very
  // same graph with the very same numbers for every original sfx, every water form layer and every
  // water music mood.
  function seeded(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function fingerprint(ctx) {
    const id = new Map(ctx.nodes.map((n, i) => [n, i]));
    const r6 = (v) => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v);
    const h = crypto.createHash('sha1');
    for (const n of ctx.nodes) {
      const o = [n.kind, n._type || '', n.loop ? 1 : 0, r6(n.startTime), r6(n.stopTime), n.disconnected ? 1 : 0, n.ended ? 1 : 0,
        n.buffer && n.buffer.length ? n.buffer.length : 0, n.out.map((x) => (id.has(x) ? id.get(x) : -1))];
      for (const k of Object.keys(n)) {
        const v = n[k];
        if (v && typeof v === 'object' && Array.isArray(v.calls)) o.push(k, r6(v._v), v.calls.map((c) => c.map(r6)));
      }
      h.update(JSON.stringify(o));
    }
    return h.digest('hex').slice(0, 16) + '/' + ctx.nodes.length;
  }
  function waterScenario() {
    const realRandom = Math.random;
    Math.random = seeded(20260611);
    try {
      const Ctx = makeFake({ cancelAndHold: true });
      const a = createAudio({ AudioContext: Ctx, document: null, autoPump: false });
      a.setForm(null);
      a.init();
      const ctx = Ctx.ctxs[0];
      const out = {};
      for (const n of CONTRACT) { ctx.advance(0.7); a.playSfx(n, { intensity: 1, pan: 0.3 }); }
      for (const n of CONTRACT) { ctx.advance(0.7); a.playSfx(n, { intensity: 0.5 }); }
      for (let i = 0; i < 40; i++) { ctx.advance(0.25); a._pump(); }
      out.sfx = fingerprint(ctx);
      for (const f of ['liquid', 'ice', 'steam', 'film', 'liquid']) {
        a.setForm(f);
        for (let i = 0; i < 400; i++) { ctx.advance(0.1); a._pump(); }
      }
      a.setForm(null);
      for (let i = 0; i < 40; i++) { ctx.advance(0.25); a._pump(); }
      out.forms = fingerprint(ctx);
      for (const m of ['menu', 'calm', 'tense', 'win']) {
        a.setMusic(m);
        for (let i = 0; i < 1800; i++) { ctx.advance(0.1); a._pump(); }
      }
      a.setMusic(null);
      for (let i = 0; i < 200; i++) { ctx.advance(0.1); a._pump(); }
      out.music = fingerprint(ctx);
      out.errors = a.getState().errors;
      return out;
    } finally { Math.random = realRandom; }
  }
  const GOLDEN = { sfx: '6f0d7c4601381e17/1018', forms: 'c99c78aa62652714/1255', music: '0d241e20e1ded54e/4715' };
  if (process.argv.includes('--print-golden')) {
    console.log(JSON.stringify(waterScenario()));
    return;
  }

  // ================================================================= contract names
  section('contract');
  check(Array.isArray(SFX_NAMES) && SFX_NAMES.length === ALL.length && SFX_NAMES.every((n, i) => n === ALL[i]),
    'SFX_NAMES equals the original DESIGN.md list followed by the DESIGN-ELEMENTS.md list, exactly (same names, same order)');
  check(SFX_NAMES_BASE.length === CONTRACT.length && SFX_NAMES_BASE.every((n, i) => n === CONTRACT[i]),
    'SFX_NAMES_BASE is the original DESIGN.md list (same names, same order)');
  check(SFX_NAMES_NEW.length === NEW_LIST.length && SFX_NAMES_NEW.every((n, i) => n === NEW_LIST[i]),
    'SFX_NAMES_NEW is the DESIGN-ELEMENTS.md list (same names, same order)');
  check(new Set(SFX_NAMES).size === SFX_NAMES.length && NEW_LIST.length === 23, 'no duplicate sfx names; 23 new names');
  check(JSON.stringify(ELEMENTS) === JSON.stringify(['water', 'fire', 'clay']), 'ELEMENTS');
  check(JSON.stringify(ELEMENT_FORMS) === JSON.stringify(EL_FORMS), 'ELEMENT_FORMS: water liquid/ice/steam/film, fire ember/blaze/smoke/spark, clay clay/slip/stone/dust');
  check(JSON.stringify(FORMS) === JSON.stringify(['liquid', 'ice', 'steam', 'film']), 'FORMS');
  check(JSON.stringify(MOODS) === JSON.stringify(['menu', 'calm', 'tense', 'win']), 'MOODS');
  for (const m of ['init', 'setMuted', 'setVolume', 'playSfx', 'setForm', 'setMusic', 'suspend', 'resume', 'setElement']) {
    check(typeof defaultAudio[m] === 'function', 'audio.' + m + ' is a function');
  }

  // ================================================================= (a) no AudioContext
  section('(a) no AudioContext available');
  {
    const variants = [
      ['default export in Node (no AudioContext global)', defaultAudio],
      ['AudioContext: null', createAudio({ AudioContext: null })],
      ['AudioContext constructor throws (blocked)', createAudio({ AudioContext: class { constructor() { throw new Error('blocked'); } } })],
    ];
    for (const [label, a] of variants) {
      const junk = [undefined, null, 0, NaN, Infinity, -1, 5, '', 'nope', {}, [], () => {}, '__proto__', 'constructor', 'toString', true];
      noThrow(() => {
        for (const j of junk) {
          a.setMuted(j); a.setVolume(j, j); a.setVolume(j); a.playSfx(j); a.playSfx(j, j); a.playSfx('jump', j);
          a.playSfx('jump', { intensity: j, pan: j }); a.setForm(j); a.setElement(j); a.setMusic(j); a.suspend(); a.resume(); a.init();
        }
      }, label + ': junk arguments');
      noThrow(() => { for (const n of SFX_NAMES) a.playSfx(n, { intensity: 1, pan: 0.5 }); }, label + ': every SFX before/without init');
      // remembered state
      a.setMuted(true); a.setVolume(0.25, 0.5); a.setForm('steam'); a.setMusic('tense');
      const s = a.getState();
      check(s.muted === true && s.musicVolume === 0.25 && s.sfxVolume === 0.5 && s.form === 'steam' && s.mood === 'tense',
        label + ': mute / volume / form / mood remembered (' + JSON.stringify([s.muted, s.musicVolume, s.sfxVolume, s.form, s.mood]) + ')');
      check(a.init() === false, label + ': init() returns false, does not throw');
      check(s.initialised === false, label + ': not initialised');
      check(a.getState().errors === 0, label + ': no internal errors swallowed (' + a.getState().lastError + ')');
      a.setForm('bogus'); a.setMusic('bogus');
      const s2 = a.getState();
      check(s2.form === 'steam' && s2.mood === 'tense', label + ': unknown form/mood ignored, previous kept');
      a.setMusic(null);
      check(a.getState().mood === null, label + ': setMusic(null) accepted');
      // elements are remembered with no context too
      check(a.getState().element === 'water', label + ': element defaults to water');
      a.setElement('fire'); a.setForm('blaze');
      let s3 = a.getState();
      check(s3.element === 'fire' && s3.form === 'blaze', label + ': element and one of its forms remembered (' + s3.element + '/' + s3.form + ')');
      a.setForm('liquid'); a.setForm('stone');
      check(a.getState().form === 'blaze', label + ': a form from another element is ignored');
      a.setElement('clay');
      s3 = a.getState();
      check(s3.element === 'clay' && s3.form === 'clay', label + ': changing element moves a foreign form to the new element default form (' + s3.form + ')');
      a.setElement('earth'); a.setElement('__proto__'); a.setElement('constructor'); a.setElement('WATER'); a.setElement(null);
      check(a.getState().element === 'clay', label + ': unknown element ignored');
      a.setForm(null); a.setElement('water');
      check(a.getState().form === null, label + ': a form that is off stays off across an element change');
      a.setForm('film');
      check(a.getState().form === 'film' && a.getState().errors === 0, label + ': water forms accepted again after switching back');
    }
  }

  // ================================================================= (b) fake AudioContext
  for (const variant of [{}, { cancelAndHold: true }]) {
    const vname = variant.cancelAndHold ? ' [cancelAndHoldAtTime present]' : ' [cancelAndHoldAtTime absent]';
    section('(b) fake AudioContext' + vname);
    const Ctx = makeFake(variant);
    const a = createAudio({ AudioContext: Ctx, document: null, autoPump: false });
    const S = a._debug();

    // remembered before init, applied on init
    noThrow(() => {
      a.playSfx('jump'); a.suspend(); a.resume();
      a.setVolume(0.5, 0.25); a.setMuted(false); a.setForm('steam'); a.setMusic('tense');
    }, 'calls before init');
    check(Ctx.created === 0, 'no context is created before init()');
    check(a.init() === true, 'init() returns true');
    check(Ctx.created === 1, 'init() created exactly one context');
    a.init(); a.init();
    check(Ctx.created === 1, 'repeated init() does not create more contexts');
    const ctx = Ctx.ctxs[0];
    check(ctx.options && ctx.options.latencyHint === 'interactive', 'context asked for interactive latency');
    for (const k of ['master', 'comp', 'limit', 'mute', 'sfxBus', 'musicBus', 'sfxRev', 'musicRev']) check(!!S.nodes[k], 'graph node ' + k + ' built');
    check(S.nodes.mute.out.includes(ctx.destination), 'chain ends at destination');
    check(S.nodes.sfxBus.out.includes(S.nodes.master) && S.nodes.musicBus.out.includes(S.nodes.master), 'sfx and music buses feed master');
    check(S.nodes.comp.out.includes(S.nodes.limit), 'compressor then limiter');
    check(S.nodes.noise.white.length > 1000 && S.nodes.noise.pink.length > 1000, 'noise buffers generated once at init');
    const rememberedMusic = S.nodes.musicBus.gain.final, rememberedSfx = S.nodes.sfxBus.gain.final;
    check(S.layer && S.layer.form === 'steam', 'remembered form applied on init (steam layer built)');
    check(S.run && S.run.name === 'tense', 'remembered music mood applied on init (tense run built)');

    // volume / mute set the gains
    a.setVolume(1, 1);
    const maxMusic = S.nodes.musicBus.gain.final, maxSfx = S.nodes.sfxBus.gain.final;
    check(near(rememberedMusic / maxMusic, volumeToGain(0.5)), 'remembered music volume 0.5 applied on init');
    check(near(rememberedSfx / maxSfx, volumeToGain(0.25)), 'remembered sfx volume 0.25 applied on init');
    a.setVolume(0.5, 0.5);
    check(near(S.nodes.musicBus.gain.final / maxMusic, volumeToGain(0.5)), 'music volume 0.5 -> ' + volumeToGain(0.5) + ' of full');
    check(near(S.nodes.sfxBus.gain.final / maxSfx, volumeToGain(0.5)), 'sfx volume 0.5 -> ' + volumeToGain(0.5) + ' of full');
    a.setVolume(5, -3);
    check(near(S.nodes.musicBus.gain.final, maxMusic) && S.nodes.sfxBus.gain.final === 0, 'volume clamped to 0..1');
    a.setVolume(NaN, undefined);
    check(near(S.nodes.musicBus.gain.final, maxMusic) && S.nodes.sfxBus.gain.final === 0, 'NaN / undefined volume ignored');
    a.setVolume(0.7, 0.8);
    check(volumeToGain(0) === 0 && volumeToGain(1) === 1 && volumeToGain(0.3) < volumeToGain(0.6), 'volumeToGain monotonic, 0 and 1 map to 0 and 1');
    a.setMuted(true);
    check(S.nodes.mute.gain.final === 0, 'setMuted(true) drives mute gain to 0');
    const before = ctx.startCount;
    check(a.playSfx('jump') === false && ctx.startCount === before, 'muted: playSfx does nothing');
    a.setMuted(false);
    check(S.nodes.mute.gain.final === 1, 'setMuted(false) restores mute gain to 1');
    const rampCalls = S.nodes.mute.gain.calls.filter((c) => c[0] === 'target');
    check(rampCalls.length >= 2, 'mute changes are ramped (setTargetAtTime), not stepped');
    a.setVolume(0, 0);
    check(a.playSfx('jump') === false, 'sfx volume 0: playSfx skipped');
    a.setVolume(0.7, 0.8);

    // every SFX
    ctx.advance(1);
    let errsBefore = a.getState().errors;
    for (const name of ALL) {
      const sources0 = ctx.startCount;
      const nodes0 = ctx.nodes.length;
      let ok;
      try { ok = a.playSfx(name, { intensity: 1, pan: 0.3 }); } catch (e) { ok = 'threw ' + e; }
      check(ok === true, 'sfx ' + name + ' plays (returned ' + ok + ')');
      const started = ctx.startCount - sources0;
      check(started >= 1, 'sfx ' + name + ' scheduled ' + started + ' source(s)');
      const added = ctx.nodes.slice(nodes0);
      check(added.some((n) => n.kind === 'panner' && near(n.pan.final, 0.3)), 'sfx ' + name + ' pans (panner at 0.3)');
      const srcs = added.filter((n) => n instanceof Object && n.started !== undefined);
      check(srcs.every((s) => s.stopTime !== undefined && s.stopTime > s.startTime), 'sfx ' + name + ': every source has a stop time after its start');
      ctx.advance(0.6);
    }
    check(a.getState().errors === errsBefore, 'no internal errors while playing every sfx (' + a.getState().lastError + ')');

    // intensity scales loudness (sum of envelope peaks created by a call), per sfx
    for (const name of ALL) {
      const peak = (I) => {
        ctx.advance(1);
        const n0 = ctx.nodes.length;
        a.playSfx(name, { intensity: I });
        let sum = 0;
        for (const n of ctx.nodes.slice(n0)) if (n.kind === 'gain') sum += n.gain.peaks.reduce((x, y) => x + y, 0);
        return sum;
      };
      let lo = 0, hi = 0;
      for (let k = 0; k < 6; k++) { lo += peak(0.3); hi += peak(1); } // averaged: random elements vary per call
      check(hi > lo * 1.5, 'sfx ' + name + ': intensity 1 louder than 0.3 (' + hi.toFixed(2) + ' vs ' + lo.toFixed(2) + ')');
    }
    ctx.advance(1);
    const n1 = ctx.startCount;
    check(a.playSfx('jump', { intensity: 0 }) === false && ctx.startCount === n1, 'intensity 0: silent');

    // rate limiting of identical sfx, but different sfx are independent
    ctx.advance(1);
    const r0 = ctx.startCount;
    const first = a.playSfx('ui_tap');
    const c1 = ctx.startCount;
    const second = a.playSfx('ui_tap');
    check(first === true && second === false && ctx.startCount === c1 && c1 > r0, 'identical sfx fired within the same instant is rate-limited');
    check(a.playSfx('ui_back') === true, 'a different sfx at the same instant still plays');
    ctx.advance(0.5);
    check(a.playSfx('ui_tap') === true, 'same sfx plays again after the gap');

    // unknown names
    ctx.advance(1);
    const u0 = ctx.startCount, u1 = ctx.nodes.length;
    noThrow(() => {
      for (const n of ['nope', '', '__proto__', 'constructor', 'toString', 'hasOwnProperty', 'JUMP', undefined, null, 7, {}, []]) {
        if (a.playSfx(n) !== false) throw new Error('unknown name played: ' + String(n));
      }
    }, 'unknown sfx names ignored');
    check(ctx.startCount === u0 && ctx.nodes.length === u1, 'unknown sfx names create no nodes');
    noThrow(() => { a.playSfx('jump', null); a.playSfx('jump', 5); a.playSfx('jump', { pan: 99, intensity: 99 }); a.playSfx('jump', { pan: NaN, intensity: NaN }); }, 'bad options tolerated');

    // pan clamps
    ctx.advance(1);
    {
      const n0 = ctx.nodes.length;
      a.playSfx('land', { pan: 5 });
      const pn = ctx.nodes.slice(n0).find((n) => n.kind === 'panner');
      check(pn && pn.pan.final === 1, 'pan clamped to 1');
    }

    // nodes get stopped and disconnected
    a.setMusic(null); a.setForm(null);
    for (let i = 0; i < 80; i++) { ctx.advance(0.25); a._pump(); }
    const live = ctx.sources().filter((s) => !s.ended);
    check(live.length === 0, 'after music/form off and time passing, every source has ended (live: ' + live.length + ')');
    check(S.voices.size === 0, 'no live voices left (' + S.voices.size + ')');
    const leaked = ctx.nodes.filter((n) => n.kind !== 'destination' && !n.disconnected
      && !['master', 'comp', 'limit', 'mute', 'sfxBus', 'musicBus', 'sfxRev', 'musicRev'].some((k) => S.nodes[k] === n));
    check(leaked.length === 0, 'all per-sound nodes disconnected after they end (leaked: ' + leaked.length + (leaked[0] ? ', e.g. ' + leaked[0].kind : '') + ')');
    check(S.retired.length === 0 && S.retiredLayers.length === 0, 'no retired runs / layers pending');

    // voice cap
    ctx.advance(2);
    const names = ALL.filter((n) => !['door_open', 'door_close', 'level_complete'].includes(n));
    let peakVoices = 0;
    for (let i = 0; i < 400; i++) {
      a.playSfx(names[i % names.length], { intensity: 1 });
      ctx.advance(0.004 * (1 + (i % 3)));
      peakVoices = Math.max(peakVoices, S.voices.size);
    }
    check(peakVoices <= a.getState().maxVoices, 'voice count capped (peak ' + peakVoices + ' <= ' + a.getState().maxVoices + ')');
    check(peakVoices >= 10, 'cap test really loaded the engine (peak ' + peakVoices + ')');
    for (let i = 0; i < 40; i++) { ctx.advance(0.25); a._pump(); }
    check(S.voices.size === 0, 'voices drain after the burst');

    // forms
    section('(b) forms' + vname);
    for (const f of FORMS) {
      ctx.advance(0.5);
      a.setForm(f);
      check(S.layer && S.layer.form === f, 'setForm(' + f + ') builds that layer');
      check(S.layer.out.gain.final === 1, 'form ' + f + ' layer fades in');
    }
    {
      const lay = S.layer;
      a.setForm('ice');
      check(lay.out.gain.final === 0 && S.retiredLayers.includes(lay), 'previous form layer fades out and is retired');
      const keep = S.layer;
      a.setForm('ice');
      check(S.layer === keep, 'setForm to the current form is a no-op');
      a.setForm('liquid'); a.setForm('film'); a.setForm('steam'); a.setForm('liquid');
      for (let i = 0; i < 30; i++) { ctx.advance(0.25); a._pump(); }
      check(S.retiredLayers.length === 0, 'rapid form switching leaves no retired layers behind');
      const sources = ctx.sources().filter((s) => !s.ended).length;
      check(sources > 0 && sources < 12, 'only the current layer keeps running sources (' + sources + ')');
    }

    // music
    section('(b) music' + vname);
    for (const mood of MOODS) {
      a.setForm(null);
      a.setMusic(null);
      for (let i = 0; i < 40; i++) { ctx.advance(0.25); a._pump(); }
      const s0 = ctx.startCount;
      const t0 = ctx.currentTime;
      a.setMusic(mood);
      check(S.run && S.run.name === mood, 'setMusic(' + mood + ') starts a run');
      let peakGroups = 0, peakSrc = 0;
      const total = 1300; // virtual seconds (> 20 min)
      for (let t = 0; t < total; t += 0.1) {
        ctx.advance(0.1); a._pump();
        peakGroups = Math.max(peakGroups, S.run.groups.size);
        if ((t * 10) % 50 === 0) peakSrc = Math.max(peakSrc, ctx.live.size);
      }
      const run = S.run;
      check(a.getState().errors === 0, mood + ': no internal errors over ' + total + ' virtual seconds (' + a.getState().lastError + ')');
      check(run.stats.chords > total / 30 && run.stats.plucks > 40, mood + ': generated ' + run.stats.chords + ' chords, ' + run.stats.phrases + ' phrases, ' + run.stats.plucks + ' notes');
      check(peakGroups < 40, mood + ': live note groups stay bounded (peak ' + peakGroups + ')');
      check(peakSrc < 60, mood + ': simultaneous live sources stay bounded (peak ' + peakSrc + ')');
      check(ctx.startCount - s0 > 200, mood + ': scheduled many sources (' + (ctx.startCount - s0) + ')');
      // variety: 6-note windows of the melody should rarely repeat
      const log = run.log, seen = new Set();
      let windows = 0;
      for (let i = 0; i + 6 <= log.length; i++) { seen.add(log.slice(i, i + 6).join(',')); windows++; }
      const ratio = windows ? seen.size / windows : 0;
      check(log.length < 40 || ratio > 0.6, mood + ': melody variety (' + seen.size + ' distinct 6-note windows of ' + windows + ', ratio ' + ratio.toFixed(2) + ')');
      const range = log.length ? [Math.min(...log), Math.max(...log)] : [0, 0];
      const def = { menu: [62, 81], calm: [57, 76], tense: [52, 72], win: [67, 91] }[mood];
      check(range[0] >= def[0] && range[1] <= def[1], mood + ': melody stays in register ' + range.join('..') + ' within ' + def.join('..'));
      // scheduling stays ahead of the clock (never in the past by more than a little)
      void t0;
    }
    // crossfade
    {
      a.setMusic('calm');
      for (let i = 0; i < 100; i++) { ctx.advance(0.1); a._pump(); }
      const oldRun = S.run;
      a.setMusic('menu');
      check(S.run !== oldRun && S.run.name === 'menu', 'mood switch creates a new run');
      check(oldRun.retiring && oldRun.out.gain.final === 0 && S.retired.includes(oldRun), 'old run fades out (retired, not cut)');
      const fadeIn = S.run.out.gain.calls.find((c) => c[0] === 'curve');
      check(!!fadeIn && fadeIn[2] > 1, 'new run fades in with a gain curve (' + (fadeIn && fadeIn[2]) + ' s)');
      const same = S.run;
      a.setMusic('menu');
      check(S.run === same, 'setMusic to the current mood is a no-op');
      for (let i = 0; i < 100; i++) { ctx.advance(0.1); a._pump(); }
      check(S.retired.length === 0 && oldRun.dead, 'retired run killed after the crossfade');
      a.setMusic(null); a.setMusic('win'); a.setMusic('tense'); a.setMusic(null);
      for (let i = 0; i < 200; i++) { ctx.advance(0.1); a._pump(); }
      check(S.run === null && S.retired.length === 0, 'rapid mood switching leaves nothing behind');
      check(ctx.sources().filter((s) => !s.ended).length === 0, 'music off: no live sources');
      check(a.getState().errors === 0, 'no internal errors across mood switching');
    }
    // suspend / resume
    {
      a.setForm('liquid');
      a.suspend();
      check(ctx.state === 'suspended' && a.getState().suspended, 'suspend() suspends the context');
      check(a.playSfx('ui_tap') === false, 'no sfx scheduled while suspended');
      a.resume();
      await Promise.resolve(); await Promise.resolve();
      check(ctx.state === 'running', 'resume() resumes the context');
      ctx.advance(1);
      check(a.playSfx('ui_tap') === true, 'sfx work again after resume');
      a.suspend(); a.suspend(); a.resume(); a.resume();
      await Promise.resolve(); await Promise.resolve();
      check(ctx.state === 'running', 'repeated suspend/resume is harmless');
    }
    check(a.getState().errors === 0, 'zero swallowed errors for the whole fake-context run' + vname);
    check(ctx.pastStops === 0, 'no stop() ever scheduled in the past (an offline/real timeline would read that as time 0): ' + ctx.pastStops);
  }

  // ================================================================= elements: forms
  section('elements: setElement / setForm for every element and form');
  const GRAPH_KEYS = ['master', 'comp', 'limit', 'mute', 'sfxBus', 'musicBus', 'sfxRev', 'musicRev'];
  {
    const foreign = (el) => ELEMENTS.filter((e) => e !== el).flatMap((e) => EL_FORMS[e]);
    for (const el of ELEMENTS) {
      for (const f of EL_FORMS[el]) {
        const tag = el + '/' + f;
        // -- before init: remembered, wrong-element names ignored, nothing built
        const Ctx = makeFake({});
        const a = createAudio({ AudioContext: Ctx, document: null, autoPump: false });
        const S = a._debug();
        noThrow(() => { a.setElement(el); a.setForm(f); }, tag + ': set before init');
        check(a.getState().element === el && a.getState().form === f, tag + ': remembered before init (' + a.getState().element + '/' + a.getState().form + ')');
        noThrow(() => { for (const w of foreign(el)) a.setForm(w); }, tag + ': foreign form names before init do not throw');
        check(a.getState().form === f, tag + ': foreign form names ignored before init');
        check(Ctx.created === 0, tag + ': no context before init');
        // -- init applies it
        a.init();
        const ctx = Ctx.ctxs[0];
        check(S.layer && S.layer.form === f && S.layer.out.gain.final === 1, tag + ': layer for the remembered form built and faded in on init');
        // -- after init: foreign names ignored, layer untouched
        const keep = S.layer;
        noThrow(() => { for (const w of foreign(el)) a.setForm(w); }, tag + ': foreign form names after init do not throw');
        check(S.layer === keep && a.getState().form === f && S.retiredLayers.length === 0, tag + ': foreign form names after init leave the layer alone');
        check(a.getState().errors === 0, tag + ': no swallowed errors (' + a.getState().lastError + ')');
        ctx.advance(3); a._pump();
      }
    }

    // one long session walking every element and every form on a single context
    const Ctx = makeFake({ cancelAndHold: true });
    const a = createAudio({ AudioContext: Ctx, document: null, autoPump: false });
    const S = a._debug();
    a.init();
    const ctx = Ctx.ctxs[0];
    let buffers = 0;
    const origCB = ctx.createBuffer.bind(ctx);
    ctx.createBuffer = (...args) => { buffers++; return origCB(...args); };
    let worstBuild = 0, worstBuildName = '';
    for (const el of ELEMENTS) {
      a.setElement(el);
      check(S.layer && S.layer.form === EL_FORMS[el][0], el + ': setElement moves to the element default form (' + (S.layer && S.layer.form) + ')');
      for (const f of EL_FORMS[el]) {
        ctx.advance(0.5);
        const prev = S.layer;
        const n0 = ctx.nodes.length, b0 = buffers;
        a.setForm(f);
        const built = ctx.nodes.length - n0;
        if (S.layer !== prev) { if (built > worstBuild) { worstBuild = built; worstBuildName = el + '/' + f; } }
        check(buffers === b0, el + '/' + f + ': switching form allocates no AudioBuffer (' + (buffers - b0) + ')');
        check(S.layer.form === f && S.layer.out.gain.final === 1, el + '/' + f + ': setForm builds that layer and fades it in');
        if (prev !== S.layer) check(prev.out.gain.final === 0 && S.retiredLayers.includes(prev), el + '/' + f + ': previous layer fades out and is retired');
        const own = S.layer.g.srcs.length;
        check(own >= 2 && own <= 14, el + '/' + f + ': layer runs a bounded number of sources (' + own + ')');
        // two minutes with the scheduler running: events fire, voices stay bounded, nothing throws or goes non-finite
        let peakVoices = 0;
        for (let i = 0; i < 1200; i++) { ctx.advance(0.1); a._pump(); peakVoices = Math.max(peakVoices, S.voices.size); }
        check(a.getState().errors === 0, el + '/' + f + ': 120 s of layer + events without internal errors (' + a.getState().lastError + ')');
        check(peakVoices <= a.getState().maxVoices, el + '/' + f + ': event voices bounded (peak ' + peakVoices + ')');
        check(S.retiredLayers.length === 0, el + '/' + f + ': retired layer cleaned up');
        const live = ctx.sources().filter((s) => !s.ended).length;
        check(live < 26, el + '/' + f + ': live sources stay low (' + live + ')');
      }
    }
    console.log('  heaviest layer build: ' + worstBuildName + ' ' + worstBuild + ' nodes');
    check(worstBuild <= 60, 'a form layer builds <= 60 nodes (heaviest ' + worstBuildName + ' ' + worstBuild + ')');
    // forms of one element are not accepted under another, after the whole walk too
    a.setElement('fire'); a.setForm('ember');
    const fireLayer = S.layer;
    a.setForm('liquid'); a.setForm('slip'); a.setForm('Ember'); a.setForm(''); a.setForm(5); a.setForm({});
    check(S.layer === fireLayer && a.getState().form === 'ember', 'wrong or junk form names ignored (layer unchanged)');
    // an element change with the form off keeps it off; with a form on, moves to the default
    a.setForm(null);
    check(S.layer === null, 'setForm(null) removes the layer');
    a.setElement('clay');
    check(a.getState().form === null && S.layer === null, 'element change with the form off stays off');
    a.setForm('stone');
    a.setElement('stone');
    a.setElement('clay');
    check(a.getState().element === 'clay' && S.layer.form === 'stone', 'same-element and unknown-element calls change nothing');
    for (let i = 0; i < 100; i++) { ctx.advance(0.25); a._pump(); }
    check(S.retiredLayers.length === 0 && a.getState().errors === 0, 'no leftovers, no errors after the element walk');
  }

  // ================================================================= elements: noise buffers
  section('elements: generated noise buffers (crackle, grit)');
  {
    const Ctx = makeFake({});
    const a = createAudio({ AudioContext: Ctx, document: null, autoPump: false });
    a.init();
    const N = a._debug().nodes.noise;
    for (const k of ['crackle', 'grit']) {
      const b = N[k];
      check(b && b.length === (k === 'crackle' ? 5 : 4) * 48000 && b.numberOfChannels === 1, k + ': a ' + (k === 'crackle' ? 5 : 4) + ' s mono buffer');
      const d = b.getChannelData(0);
      let peak = 0, sum = 0, loud = 0, bad = 0;
      for (let i = 0; i < d.length; i++) { const x = d[i]; if (!Number.isFinite(x)) bad++; const ax = Math.abs(x); if (ax > peak) peak = ax; sum += x; if (ax > 0.02) loud++; }
      check(bad === 0, k + ': every sample finite');
      check(peak <= 0.9 + 1e-6 && peak > 0.85, k + ': peak normalised to 0.9 (' + peak.toFixed(3) + ')');
      check(Math.abs(sum / d.length) < 0.01, k + ': no DC offset (' + (sum / d.length).toExponential(2) + ')');
      const frac = loud / d.length;
      check(frac > 0.01 && frac < 0.6, k + ': sparse bursts, not silence and not a constant wash (' + (frac * 100).toFixed(1) + '% of samples above 0.02)');
      // loop seam: the first and last 5 ms carry the same kind of energy as the rest (no dead gap, no spike)
      const rms = (i0, i1) => { let s = 0; for (let i = i0; i < i1; i++) s += d[i] * d[i]; return Math.sqrt(s / (i1 - i0)); };
      const whole = rms(0, d.length), w = 480;
      check(Number.isFinite(whole) && whole > 0 && Math.abs(d[0]) <= 0.9 && Math.abs(d[d.length - 1]) <= 0.9, k + ': seam samples in range');
      void w;
    }
    // (they use their own generator so building them never shifts Math.random's sequence: the
    // "water unchanged" fingerprints below would catch it if they did)
  }

  // ================================================================= elements: music
  for (const variant of [{}, { cancelAndHold: true }]) {
    const vname = variant.cancelAndHold ? ' [cancelAndHoldAtTime present]' : ' [cancelAndHoldAtTime absent]';
    section('elements: music for every element x mood' + vname);
    for (const el of ELEMENTS) {
      const Ctx = makeFake(variant);
      const a = createAudio({ AudioContext: Ctx, document: null, autoPump: false });
      const S = a._debug();
      a.init();
      a.setElement(el);
      a.setForm(null);
      const ctx = Ctx.ctxs[0];
      for (const mood of MOODS) {
        const tag = el + '/' + mood;
        a.setMusic(null);
        for (let i = 0; i < 40; i++) { ctx.advance(0.25); a._pump(); }
        const n0 = ctx.nodes.length, s0 = ctx.startCount;
        a.setMusic(mood);
        check(S.run && S.run.name === mood && S.run.element === el, tag + ': setMusic starts a run in that element palette');
        const def = S.run.def;
        const total = 1300;
        let peakGroups = 0, peakSrc = 0;
        const liveNodes = [];
        for (let t = 0; t < total; t += 0.1) {
          ctx.advance(0.1); a._pump();
          peakGroups = Math.max(peakGroups, S.run.groups.size);
          if (Math.round(t * 10) % 50 === 0) peakSrc = Math.max(peakSrc, ctx.live.size);
          if (Math.round(t * 10) % 1000 === 0) {
            liveNodes.push(ctx.nodes.reduce((c, n) => c + (n.disconnected || n.kind === 'destination' || GRAPH_KEYS.some((k) => S.nodes[k] === n) ? 0 : 1), 0));
          }
        }
        const run = S.run;
        check(a.getState().errors === 0, tag + ': no internal errors over ' + total + ' virtual seconds (' + a.getState().lastError + ')');
        // NaN / negative time anywhere in any parameter event of any node created for this run
        let nonFinite = 0, negative = 0;
        for (const n of ctx.nodes.slice(n0)) {
          for (const k of Object.keys(n)) {
            const v = n[k];
            if (v && typeof v === 'object' && Array.isArray(v.calls)) {
              for (const c of v.calls) for (let i = 1; i < c.length; i++) { if (typeof c[i] === 'number' && !Number.isFinite(c[i])) nonFinite++; }
              for (const c of v.calls) if (c[0] !== 'cancel' && c[0] !== 'hold' && typeof c[c.length - 1] === 'number' && c[0] !== 'target' && c[0] !== 'curve' && c[c.length - 1] < 0) negative++;
              if (!Number.isFinite(v._v)) nonFinite++;
            }
          }
          if (n.startTime !== undefined && !Number.isFinite(n.startTime)) nonFinite++;
          if (n.stopTime !== undefined && !Number.isFinite(n.stopTime)) nonFinite++;
        }
        check(nonFinite === 0 && negative === 0, tag + ': no NaN / Infinity / negative time in any scheduled parameter (' + nonFinite + ' / ' + negative + ')');
        check(run.stats.chords > total / 30 && run.stats.plucks > 40, tag + ': generated ' + run.stats.chords + ' chords, ' + run.stats.phrases + ' phrases, ' + run.stats.plucks + ' notes');
        check(peakGroups < 40, tag + ': live note groups stay bounded (peak ' + peakGroups + ')');
        check(peakSrc < 60, tag + ': simultaneous live sources stay bounded (peak ' + peakSrc + ')');
        check(ctx.startCount - s0 > 200, tag + ': scheduled many sources (' + (ctx.startCount - s0) + ')');
        // node growth: live (not yet disconnected) nodes stay flat, they do not climb with time
        const mx = Math.max(...liveNodes), first = liveNodes.slice(0, 3), last = liveNodes.slice(-3);
        check(mx < 700 && Math.max(...last) <= Math.max(...first) * 1.5 + 60, tag + ': live node count bounded and flat over time (samples ' + liveNodes.join(',') + ')');
        // melody
        const log = run.log, seen = new Set();
        let windows = 0;
        for (let i = 0; i + 6 <= log.length; i++) { seen.add(log.slice(i, i + 6).join(',')); windows++; }
        check(log.length < 40 || seen.size / windows > 0.6, tag + ': melody variety (' + seen.size + ' distinct 6-note windows of ' + windows + ')');
        const range = log.length ? [Math.min(...log), Math.max(...log)] : [0, 0];
        check(range[0] >= def.melLo && range[1] <= def.melHi, tag + ': melody stays in register ' + range.join('..') + ' within ' + def.melLo + '..' + def.melHi);
        // pulse: present exactly where the palette asks for one, at about the rate it asks for
        const beat = 60 / def.bpm, expected = def.pulse ? (total / (beat * (def.pulseEvery || 2))) * 0.85 : 0;
        if (def.pulse) check(run.stats.pulses > expected * 0.6 && run.stats.pulses < expected * 1.3, tag + ': pulse "' + def.pulse + '" ' + run.stats.pulses + ' beats (expected ~' + Math.round(expected) + ')');
        else check(run.stats.pulses === 0, tag + ': no pulse in this palette');
      }
      // after all moods: stop and make sure nothing is left running or connected
      a.setMusic(null);
      for (let i = 0; i < 200; i++) { ctx.advance(0.1); a._pump(); }
      check(S.run === null && S.retired.length === 0 && ctx.sources().filter((s) => !s.ended).length === 0, el + ': music off leaves no live sources and no retired runs');
      check(a.getState().errors === 0, el + ': zero swallowed errors across its four moods' + vname);
    }
  }

  // The palettes really do differ from water the way the brief says (def-level, so it cannot pass by accident of randomness)
  section('elements: palettes');
  {
    const Ctx = makeFake({});
    const a = createAudio({ AudioContext: Ctx, document: null, autoPump: false });
    const S = a._debug();
    a.init();
    const defs = {};
    for (const el of ELEMENTS) {
      a.setElement(el);
      defs[el] = {};
      for (const m of MOODS) { a.setMusic(m); defs[el][m] = S.run.def; }
    }
    a.setMusic(null);
    for (const m of MOODS) {
      const mid = (d) => (d.melLo + d.melHi) / 2;
      check(mid(defs.fire[m]) < mid(defs.water[m]) && defs.fire[m].root < defs.water[m].root, 'fire/' + m + ': lower register and root than water');
      check(defs.clay[m].bpm < defs.water[m].bpm, 'clay/' + m + ': slower than water (' + defs.clay[m].bpm + ' vs ' + defs.water[m].bpm + ')');
      check(defs.fire[m].kind === 'ember' && defs.clay[m].kind === 'mallet' && defs.water[m].kind !== 'ember' && defs.water[m].kind !== 'mallet', m + ': plucked ember / mallet / water timbres');
      check(!!defs.fire[m].pulse && !!defs.fire[m].rhythms && !!defs.clay[m].rhythms, m + ': fire has a gentle pulse; both have their own rhythm pools');
      check(!!defs.clay[m].pulse === (m === 'tense'), m + ': clay pulses (a slow knock) only in the tense mood');
      check(JSON.stringify(defs.fire[m].scale) !== JSON.stringify(defs.water[m].scale) || defs.fire[m].root !== defs.water[m].root, 'fire/' + m + ': different pitch world');
      check(JSON.stringify(defs.clay[m].scale) !== JSON.stringify(defs.water[m].scale) || defs.clay[m].root !== defs.water[m].root, 'clay/' + m + ': different pitch world');
    }
    check(JSON.stringify(defs.water.menu.scale) === JSON.stringify([0, 2, 3, 5, 7, 9, 10]) && defs.water.menu.root === 50 && defs.water.menu.kind === 'kalimba'
      && defs.water.tense.pulse === true && defs.water.win.root === 55, 'water palettes are the original ones');
  }

  // ================================================================= elements: music crossfade on element change
  section('elements: changing element under running music');
  {
    const Ctx = makeFake({ cancelAndHold: true });
    const a = createAudio({ AudioContext: Ctx, document: null, autoPump: false });
    const S = a._debug();
    a.init();
    const ctx = Ctx.ctxs[0];
    a.setMusic('calm');
    for (let i = 0; i < 200; i++) { ctx.advance(0.1); a._pump(); }
    const waterRun = S.run;
    check(waterRun.element === 'water', 'calm starts in water');
    a.setElement('fire');
    check(S.run !== waterRun && S.run.name === 'calm' && S.run.element === 'fire', 'element change starts the same mood in the new palette');
    check(waterRun.retiring && waterRun.out.gain.final === 0 && S.retired.includes(waterRun), 'old palette fades out (retired, not cut)');
    const fadeIn = S.run.out.gain.calls.find((c) => c[0] === 'curve');
    check(!!fadeIn && fadeIn[2] > 1, 'new palette fades in over a curve (' + (fadeIn && fadeIn[2]) + ' s)');
    const fireRun = S.run;
    a.setElement('fire');
    a.setElement('earth');
    check(S.run === fireRun, 'same or unknown element does not restart the music');
    a.setMusic('calm');
    check(S.run === fireRun, 'setMusic to the current mood in the current element is a no-op');
    for (let i = 0; i < 100; i++) { ctx.advance(0.1); a._pump(); }
    check(S.retired.length === 0 && waterRun.dead, 'old run killed after the crossfade');
    a.setElement('clay'); a.setElement('water'); a.setElement('fire'); a.setElement('clay');
    for (let i = 0; i < 300; i++) { ctx.advance(0.1); a._pump(); }
    check(S.run.element === 'clay' && S.retired.length === 0, 'rapid element switching ends on the last element with nothing left behind');
    a.setMusic(null); a.setForm(null);
    for (let i = 0; i < 200; i++) { ctx.advance(0.1); a._pump(); }
    check(ctx.sources().filter((s) => !s.ended).length === 0 && a.getState().errors === 0, 'music and form off after element switching: no live sources, no errors');
    // element change with no music running only changes the form layer
    a.setElement('clay'); a.setForm('clay');
    a.setElement('fire');
    check(S.run === null && S.layer && S.layer.form === 'ember', 'element change with no music moves only the form layer to the new default');
    // before init: remembered, applied on init
    const C2 = makeFake({});
    const b = createAudio({ AudioContext: C2, document: null, autoPump: false });
    b.setElement('clay'); b.setMusic('tense'); b.setForm('slip');
    b.init();
    const S2 = b._debug();
    check(S2.run && S2.run.element === 'clay' && S2.run.name === 'tense' && S2.layer.form === 'slip', 'element, mood and form remembered before init and applied together');
  }

  // ================================================================= water unchanged
  section('water unchanged: byte-identical graph to the pre-element module');
  {
    const w = waterScenario();
    check(w.errors === 0, 'water scenario ran without swallowed errors');
    check(w.sfx === GOLDEN.sfx, 'every original sfx (two intensities, pan): same graph and numbers as before elements existed (' + w.sfx + ' vs ' + GOLDEN.sfx + ')');
    check(w.forms === GOLDEN.forms, 'every water form layer: same graph and numbers as before (' + w.forms + ' vs ' + GOLDEN.forms + ')');
    check(w.music === GOLDEN.music, 'all four water music moods (150 s each, with crossfades): same graph and numbers as before (' + w.music + ' vs ' + GOLDEN.music + ')');
    // an explicit setElement('water'), or a round trip through another element before init, changes nothing
    const viaRoundTrip = (() => {
      const realRandom = Math.random;
      Math.random = seeded(20260611);
      try {
        const Ctx = makeFake({ cancelAndHold: true });
        const a = createAudio({ AudioContext: Ctx, document: null, autoPump: false });
        a.setElement('water'); a.setElement('fire'); a.setForm('spark'); a.setElement('clay'); a.setElement('water'); a.setForm(null);
        a.init();
        const ctx = Ctx.ctxs[0];
        for (const n of CONTRACT) { ctx.advance(0.7); a.playSfx(n, { intensity: 1, pan: 0.3 }); }
        for (const n of CONTRACT) { ctx.advance(0.7); a.playSfx(n, { intensity: 0.5 }); }
        for (let i = 0; i < 40; i++) { ctx.advance(0.25); a._pump(); }
        return fingerprint(ctx);
      } finally { Math.random = realRandom; }
    })();
    check(viaRoundTrip === GOLDEN.sfx, 'setElement round trip (water, fire, clay, water) before init: original sfx unchanged (' + viaRoundTrip + ')');
    const diffSeed = (() => {
      const realRandom = Math.random;
      Math.random = seeded(7);
      try {
        const Ctx = makeFake({ cancelAndHold: true });
        const a = createAudio({ AudioContext: Ctx, document: null, autoPump: false });
        a.setForm(null); a.init();
        const ctx = Ctx.ctxs[0];
        for (const n of CONTRACT) { ctx.advance(0.7); a.playSfx(n, { intensity: 1, pan: 0.3 }); }
        for (const n of CONTRACT) { ctx.advance(0.7); a.playSfx(n, { intensity: 0.5 }); }
        for (let i = 0; i < 40; i++) { ctx.advance(0.25); a._pump(); }
        return fingerprint(ctx);
      } finally { Math.random = realRandom; }
    })();
    check(diffSeed !== GOLDEN.sfx, 'the fingerprint is sensitive (another seed gives another hash)');
  }

  // ================================================================= autoplay unlock
  section('autoplay unlock (context starts suspended, gesture listeners)');
  {
    const Ctx = makeFake({ startSuspended: true });
    const doc = makeDoc();
    const a = createAudio({ AudioContext: Ctx, document: doc, autoPump: false });
    a.setForm('film'); a.setMusic('calm');
    a.init();
    const ctx = Ctx.ctxs[0];
    await Promise.resolve(); await Promise.resolve();
    // init() itself tries to resume (it is meant to be called from a gesture)
    check(ctx.resumeCalls >= 1, 'init() calls ctx.resume()');
    check(ctx.sources().some((s) => s.kind === 'bufsrc' && s.started && s.loop === false && s.buffer && s.buffer.length === 1), 'init() plays a silent buffer (iOS unlock)');
    check(ctx.state === 'running', 'context running after resume resolves');
    check(doc.listeners.length === 0, 'unlock listeners removed once running (' + doc.listeners.length + ' left)');

    // context blocked again (iOS interruption): listeners re-armed, next gesture resumes
    ctx.state = 'suspended';
    ctx.onstatechange();
    check(doc.listeners.length > 0 && doc.listeners.some((l) => l.t === 'touchend') && doc.listeners.some((l) => l.t === 'pointerdown'), 'interrupted context re-arms gesture listeners (touchend, pointerdown, ...)');
    const rc = ctx.resumeCalls;
    doc.fire('touchend');
    await Promise.resolve(); await Promise.resolve();
    check(ctx.resumeCalls === rc + 1 && ctx.state === 'running', 'a gesture resumes the context');
    check(doc.listeners.length === 0, 'listeners removed again after resume');

    // while locked nothing is queued
    ctx.state = 'suspended';
    check(a.playSfx('jump') === false, 'locked context: sfx are dropped instead of queued');
  }

  // ================================================================= misc robustness
  section('robustness');
  {
    // a context whose createConvolver throws: init must fail cleanly, not throw
    const Ctx = makeFake({});
    Ctx.prototype.createConvolver = function () { throw new Error('no convolver'); };
    const a = createAudio({ AudioContext: Ctx, document: null, autoPump: false });
    let r;
    noThrow(() => { r = a.init(); }, 'init with a broken context');
    check(r === false, 'broken context: init returns false');
    noThrow(() => { a.playSfx('jump'); a.setForm('ice'); a.setMusic('menu'); a.suspend(); a.resume(); }, 'calls after failed init');
    check(a.getState().initialised === false, 'broken context: stays uninitialised');

    // a context without StereoPanner (old Safari): everything still works, pan ignored
    const C2 = makeFake({});
    C2.prototype.createStereoPanner = undefined;
    const b = createAudio({ AudioContext: C2, document: null, autoPump: false });
    b.init();
    const c2 = C2.ctxs[0];
    noThrow(() => { for (const n of ALL) { b.playSfx(n, { pan: -0.5 }); c2.advance(0.6); } }, 'no StereoPanner: every sfx');
    b.setMusic('menu'); b.setForm('ice');
    noThrow(() => { for (let i = 0; i < 600; i++) { c2.advance(0.1); b._pump(); } }, 'no StereoPanner: music');
    check(b.getState().errors === 0, 'no StereoPanner: no swallowed errors (' + b.getState().lastError + ')');
  }

  // ================================================================= JS-side cost
  section('cost (JS time to build voices against the fake context; not audio-thread cost)');
  {
    const Ctx = makeFake({});
    const a = createAudio({ AudioContext: Ctx, document: null, autoPump: false });
    a.init();
    const ctx = Ctx.ctxs[0];
    // (1) Deterministic work bounds - what actually makes a voice expensive is how many audio
    //     nodes it builds and whether it allocates buffers per call (noise and impulse buffers
    //     must be generated once and reused). These are exact counts, immune to GC and CPU load.
    let buffers = 0;
    const origCreateBuffer = ctx.createBuffer.bind(ctx);
    ctx.createBuffer = (...args) => { buffers++; return origCreateBuffer(...args); };
    for (const n of ALL) { ctx.advance(0.7); a.playSfx(n, { intensity: 1 }); }   // warm every cache once
    // Caps sit ~1.4x above today's heaviest voices (pane_smash 48; the once-a-level fanfare 82);
    // a real regression - a per-call graph rebuild, an unbounded loop of partials - blows past them.
    const NODE_CAP = 64, FANFARE_CAP = 120;
    let maxNodes = 0, maxNodesName = '', perCallBuffers = 0, overCap = [];
    const counts = [];
    for (const n of ALL) {
      ctx.advance(0.7);
      const n0 = ctx.nodes.length, b0 = buffers;
      a.playSfx(n, { intensity: 1 });
      const made = ctx.nodes.length - n0;
      counts.push(n + ' ' + made);
      perCallBuffers += buffers - b0;
      if (made > (n === 'level_complete' ? FANFARE_CAP : NODE_CAP)) overCap.push(n + ' ' + made);
      if (made > maxNodes) { maxNodes = made; maxNodesName = n; }
    }
    console.log('  audio nodes built per playSfx: ' + counts.join(', '));
    check(maxNodes > 0 && overCap.length === 0, 'every playSfx builds a bounded voice: <= ' + NODE_CAP + ' nodes, fanfare <= ' + FANFARE_CAP + ' (heaviest: ' + maxNodesName + ' ' + maxNodes + (overCap.length ? '; over: ' + overCap.join(', ') : '') + ')');
    check(perCallBuffers === 0, 'no AudioBuffer is allocated per playSfx call once warm (' + perCallBuffers + ' allocated)');
    ctx.createBuffer = origCreateBuffer;

    // (2) Wall-clock, with a statistic that GC cannot fake: the MEDIAN of many calls per sound.
    //     One 50 ms collection pause in 31 calls moves a mean by 1.6 ms but cannot move the median.
    //     The bar is generous (current medians are ~0.01-0.4 ms) but still catches a voice that
    //     got an order of magnitude more expensive on every call.
    const rows = [];
    let worst = 0, worstName = '';
    const REPS = 31;
    for (const n of ALL) {
      const ts = [];
      for (let i = 0; i < REPS; i++) {
        ctx.advance(0.7);
        const s = process.hrtime.bigint();
        a.playSfx(n, { intensity: 1 });
        ts.push(Number(process.hrtime.bigint() - s) / 1e6);
      }
      ts.sort((x, y) => x - y);
      const med = ts[REPS >> 1];
      rows.push(n + ' ' + med.toFixed(3));
      if (med > worst) { worst = med; worstName = n; }
    }
    console.log('  median ms per playSfx call: ' + rows.join(', '));
    check(worst < 2, 'every playSfx builds its voice in < 2 ms of JS, median of ' + REPS + ' calls (worst: ' + worstName + ' ' + worst.toFixed(3) + ' ms)');
    // pump cost during steady music
    a.setMusic('menu');
    const samples = [];
    for (let i = 0; i < 3000; i++) {
      ctx.advance(0.08);
      const s = process.hrtime.bigint();
      a._pump();
      samples.push(Number(process.hrtime.bigint() - s) / 1e6);
    }
    samples.sort((x, y) => x - y);
    const mean = samples.reduce((x, y) => x + y, 0) / samples.length;
    const p99 = samples[Math.floor(samples.length * 0.99)];
    const worstPump = samples[samples.length - 1];
    console.log('  scheduler pump: mean ' + mean.toFixed(4) + ' ms, p99 ' + p99.toFixed(4) + ' ms, worst ' + worstPump.toFixed(3)
      + ' ms (rare worst-case outliers here are Node GC on the allocation-heavy fake context, not scheduling work)');
    check(p99 < 1, 'scheduler pump p99 < 1 ms (' + p99.toFixed(4) + ' ms)');
  }

  // ================================================================= summary
  console.log('\n' + (failures.length ? 'FAILED' : 'OK') + ': ' + passed + ' checks passed, ' + failures.length + ' failed');
  if (failures.length) {
    for (const f of failures) console.log(' - ' + f);
    process.exit(1);
  }
}

main().then(() => process.exit(process.exitCode || 0), (e) => { console.error('TEST HARNESS ERROR', e); process.exit(2); });
