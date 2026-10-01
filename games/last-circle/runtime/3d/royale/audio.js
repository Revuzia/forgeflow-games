/**
 * royale/audio.js — procedural Web Audio SFX (per-class gunshots, builds,
 * impacts, UI) + real music tracks from the owner's catalog (Laser Sequence —
 * darksynth; unique to this game per the no-duplicate-music rule).
 *
 * Positional: every world sound is placed with an HRTF PannerNode against a
 * listener synced to the camera, so front/back and above/below are audible and
 * not just left/right; distance is a separate tuned curve. Gunshots are
 * information (PUBG lesson), so they carry to a per-class radius (AUDIBLE_M,
 * shotgun 120 m to sniper 520 m) with a muffled tail at range.
 *
 * Synthesis keeps SFX weightless (no downloads) and per-class distinct:
 * noise burst + tuned lowpass + envelope, different per weapon class. The same
 * rule covers the continuous beds at the bottom of this file — storm wall,
 * biome ambience and the room-tone impulse are all generated in code.
 */

let ctx = null, master = null, sfxBus = null, musicEl = null;
let conv = null, wetGain = null;   // shared synthetic-impulse reverb — see ensureCtx()
let W_ = null;
let lastImpactT = 0;      // voice budget for the impact listener — see wire()
let lastWhizT = 0;        // ditto for the near-miss crack
let _lisT = -1;           // ctx time the WebAudio listener was last synced
let _lf = null, _lu = null;   // scratch forward/up vectors (THREE arrives with W)
let reloadTimers = [];    // outstanding reload-sequence timers, so a swap can kill them
let _scoped = false;      // last scopeState — that event re-fires EVERY frame

// ── voice pool: pure policy ─────────────────────────────────────────────────
// Every one-shot built its own BufferSource/Oscillator + Gain (+ Biquad) + HRTF
// panner with no ceiling at all — the only limits were the 35 ms impact and 60 ms
// whiz throttles. In a final-circle firefight (ten SMGs at 720 rpm, 9-pellet
// shotguns, their impacts and whizzes) nothing bounded the node count or the
// sum hitting the limiter. BLOCKTOOTH / DYEFIELD bound it with a voice pool; this
// is the same shape: at most VOICE_CAP live sources, at most VOICE_FRAME_BUDGET
// starts per frame, and when either is full the lowest-scoring voice is stolen
// — but only by a candidate that scores strictly higher.
//
// score = tier + audible gain (clamped below 1), so the TIER always decides and
// loudness only orders voices inside a tier: own gun / hitmarker / kill (and
// every head-relative cue) > enemy gun > footsteps (and other world foley) >
// impacts. Pure and exported so audio_pool.selftest.cjs proves it in Node; the
// Web Audio side (voiceOpen / voiceKill below) only executes what this decides.
export const VOICE_CAP = 24;
export const VOICE_FRAME_BUDGET = 4;
export const VOICE_TIER = { impact: 0, step: 1, gun: 2, own: 3 };

export function voiceScore(tier, gain) {
  const g = +gain;
  return tier + (g > 0 ? Math.min(0.99, g) : 0);   // NaN / <= 0 -> bare tier
}

function _lowerVoice(a, b) { return a.score < b.score || (a.score === b.score && a.start < b.start); }

/**
 * live: [{score, start, end, n, frame}] (n = source nodes in the voice)
 * cand: {score, n, frame}. Voices with end <= now are treated as gone.
 * Returns null (drop the candidate) or the indices into `live` to steal first
 * (usually []). All-or-nothing: nothing is stolen unless the candidate gets in.
 *   1. frame budget — `budget` voices already started in cand.frame: the
 *      candidate must beat the lowest of THOSE and replaces it, so one frame
 *      never nets more than `budget` starts and the most important ones win
 *      whatever order the events arrived in.
 *   2. cap — while live sources + cand.n > cap, steal the lowest score (oldest
 *      on a tie) if the candidate scores strictly higher, else drop it.
 */
export function voicePlan(live, cand, now, cap, budget) {
  cap = cap || VOICE_CAP; budget = budget || VOICE_FRAME_BUDGET;
  const n = Math.max(1, cand.n | 0);
  if (n > cap) return null;
  const victims = [];
  let used = 0, inFrame = 0;
  for (let i = 0; i < live.length; i++) {
    const v = live[i];
    if (v.end <= now) continue;
    used += v.n || 1;
    if (v.frame === cand.frame) inFrame++;
  }
  if (inFrame >= budget) {
    let vi = -1;
    for (let i = 0; i < live.length; i++) {
      const v = live[i];
      if (v.end <= now || v.frame !== cand.frame) continue;
      if (vi < 0 || _lowerVoice(v, live[vi])) vi = i;
    }
    if (vi < 0 || !(cand.score > live[vi].score)) return null;
    victims.push(vi); used -= live[vi].n || 1;
  }
  while (used + n > cap) {
    let vi = -1;
    for (let i = 0; i < live.length; i++) {
      const v = live[i];
      if (v.end <= now || victims.indexOf(i) >= 0) continue;
      if (vi < 0 || _lowerVoice(v, live[vi])) vi = i;
    }
    if (vi < 0 || !(cand.score > live[vi].score)) return null;
    victims.push(vi); used -= live[vi].n || 1;
  }
  return victims;
}

/**
 * Music duck, once per ENGAGEMENT (pure; audio_pool.selftest.cjs). Every own
 * round used to call duckMusic() — 30 duck ramps in a 3.7 s SMG burst, the score
 * pumping ~-4 dB eight times a second while the trigger was held. Now the first
 * shot engages, later shots only extend the hold, and the release comes once the
 * trigger has been quiet for `hold` seconds.
 * st = {on, last}; returns "engage" | "hold" | "release" | null.
 */
export function fireDuckStep(st, now, shot, hold) {
  if (shot) {
    st.last = now;
    if (st.on) return "hold";
    st.on = true;
    return "engage";
  }
  if (st.on && now - st.last >= hold) { st.on = false; return "release"; }
  return null;
}

// ── voice pool: the Web Audio side ──────────────────────────────────────────
// A "frame" is one audioMod.update() call. update() only runs while a match is
// live and unpaused, so a wall-clock fallback also opens a new frame after 20 ms
// with no update — the menu, the pause screen and fastForward() (which emits
// every bot's shots inside ONE task) still get a budget, never a stuck one.
const _pool = { live: [], frame: 1, frameWall: -1e9, peakVoices: 0, peakSources: 0,
                admitted: 0, stolen: 0, rejected: 0, budgetSteals: 0 };
const _aud = { duckRamps: 0, duckReleases: 0, duckBlasts: 0 };

function poolNextFrame() { _pool.frame++; _pool.frameWall = performance.now(); }

function poolPrune(now) {
  const L = _pool.live;
  let j = 0;
  for (let i = 0; i < L.length; i++) if (L[i].end > now) L[j++] = L[i];
  L.length = j;
}

/** Silence a stolen voice. Returns the audio time by which it is silent, which
 *  is when the stealing voice starts, so the two never overlap. */
function voiceKill(v, now) {
  const srcs = v.srcs || [];
  if (v.start >= now) {
    // started in this same render quantum (a frame-budget steal): no sample has
    // been rendered yet, so stopping it at its own start time is inaudible
    for (let i = 0; i < srcs.length; i++) { try { srcs[i].stop(v.start); } catch (e) {} }
    return now;
  }
  const tEnd = now + 0.006;   // 6 ms fade: a hard cut mid-waveform clicks
  if (v.out) {
    try { const g = v.out.gain; g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); g.linearRampToValueAtTime(0, tEnd); } catch (e) {}
  }
  for (let i = 0; i < srcs.length; i++) { try { srcs[i].stop(tEnd); } catch (e) {} }
  return tEnd;
}

/** Ask the pool for a voice. Returns a handle whose .start is the audio time
 *  the caller must start its sources at, or null (dropped by the policy). */
function voiceOpen(tier, gain, n) {
  const P = _pool, now = ctx.currentTime, wall = performance.now();
  if (wall - P.frameWall > 20) { P.frame++; P.frameWall = wall; }
  poolPrune(now);
  const cand = { score: voiceScore(tier, gain), n: n || 1, frame: P.frame };
  const victims = voicePlan(P.live, cand, now, VOICE_CAP, VOICE_FRAME_BUDGET);
  if (!victims) { P.rejected++; return null; }
  let t0 = now;
  if (victims.length) {
    victims.sort((a, b) => b - a);   // splice from the back so indices stay valid
    for (let i = 0; i < victims.length; i++) {
      const v = P.live[victims[i]];
      if (v.frame === cand.frame) P.budgetSteals++;
      P.live.splice(victims[i], 1);
      P.stolen++;
      t0 = Math.max(t0, voiceKill(v, now));
    }
  }
  const h = { score: cand.score, start: t0, end: t0 + 0.05, n: cand.n, frame: P.frame, srcs: null, out: null };
  P.live.push(h);
  P.admitted++;
  let src = 0; for (let i = 0; i < P.live.length; i++) src += P.live[i].n;
  if (P.live.length > P.peakVoices) P.peakVoices = P.live.length;
  if (src > P.peakSources) P.peakSources = src;
  return h;
}

/** Record what the voice actually built, and when its last source stops. A
 *  start time that has already slipped into the past (the audio clock ticked
 *  while the nodes were being built) plays late, not short, so the end moves by
 *  the slip; +12 ms covers the audio thread picking the start up one callback
 *  later. Both err toward "still sounding", which is the side the cap needs. */
function voiceArm(h, out, srcs, end) {
  h.out = out; h.srcs = srcs;
  h.end = end + Math.max(0, ctx.currentTime - h.start) + 0.012;
}

/** default tier: a head-relative cue is the player's own feedback; a placed
 *  one is world foley unless the call site says otherwise */
function tierOf(tier, pos) { return tier != null ? tier : (pos ? VOICE_TIER.step : VOICE_TIER.own); }

/** Place + admit + build the output node for one voice: null when culled by
 *  distance or dropped by the pool, else the pool handle with .out wired. */
function openVoice(pos, maxD, tier, gain, n) {
  const vol = place(pos, maxD);
  if (vol < 0) return null;
  const d = _pd;
  const h = voiceOpen(tierOf(tier, pos), (gain == null ? 0.5 : gain) * vol, n || 1);
  if (!h) return null;
  h.out = spatialOut(pos, vol, d);
  return h;
}

// ── music duck state (see fireDuckStep) ─────────────────────────────────────
const DUCK_FIRE = 0.794;      // -2 dB while you are in a firefight
const DUCK_FIRE_HOLD = 0.6;   // s of trigger silence before the band comes back
const DUCK_BLAST = 0.62;      // -4 dB explosion duck, unchanged
const _duckSt = { on: false, last: -1 };
let _blastRelT = -1;          // audio time the current explosion duck starts releasing
let _duckTimer = 0;

let uwFilter = null;
export function init(W) {
  W_ = W;
  wire(W);
  // player.js's updateCamera calls this on every submersion change
  W.__audio = W.__audio || {};
  W.__audio.setUnderwater = (on) => {
    if (!uwFilter || !ctx) return;
    // glide the cutoff so the waterline is a swoosh, not a click
    uwFilter.frequency.setTargetAtTime(on ? 700 : 20000, ctx.currentTime, 0.08);
  };
  W.__audio.setVolumes = () => setVolumes(W);
  // test surface until __LC__.feel() lands (C9): same object readback() returns
  W.__audio.readback = () => readback(W);
}

/**
 * Feel read-back (C9: __LC__.feel() merges this). Counters are cumulative for
 * the page; a gate diffs two reads. duckRamps counts fire-duck ENGAGEMENTS (one
 * downward ramp each), duckBlasts the explosion ducks.
 */
export function readback(W) {
  const now = ctx ? ctx.currentTime : 0;
  if (ctx) poolPrune(now);
  let src = 0;
  for (let i = 0; i < _pool.live.length; i++) src += _pool.live[i].n;
  return {
    ctx: ctx ? ctx.state : "none",
    musicRouted: !!musicDuck,
    duckRamps: _aud.duckRamps, duckReleases: _aud.duckReleases, duckBlasts: _aud.duckBlasts,
    duckHeld: _duckSt.on,
    duckGain: musicDuck ? Math.round(musicDuck.gain.value * 1000) / 1000 : null,
    voices: _pool.live.length, voiceSources: src,
    voiceCap: VOICE_CAP, frameBudget: VOICE_FRAME_BUDGET,
    peakVoices: _pool.peakVoices, peakSources: _pool.peakSources,
    admitted: _pool.admitted, stolen: _pool.stolen, rejected: _pool.rejected, budgetSteals: _pool.budgetSteals,
    sfxDecoded: Object.keys(sfxBuf).length,
  };
}

/**
 * Match teardown (C8). Nothing here is a GPU resource; what must not outlive a
 * match is behaviour: the reload foley timers of a gun the player no longer
 * holds, a fire duck still holding the next track down, the scope latch.
 * Voices in flight are left to finish — the victory/defeat sting is one of them.
 */
export function disposeMatch(W) {
  cancelReload();
  duckFireRelease(true);
  _blastRelT = -1;
  _scoped = false;
}

// ── recorded one-shots (Kenney, CC0) ────────────────────────────────────────
// Everything in this file was synthesised, which is fine for tonal cues (blips,
// stings, the storm bed) but obviously fake for the physical ones: a footstep is
// broadband contact noise with a texture that says "grass" or "wood", and no
// amount of filtered noise sells that. These 45 clips are Kenney CC0 (public
// domain, commercial use fine, no attribution required — assets/audio/sfx/,
// 472 KB total), covering exactly the categories synthesis is worst at.
//
// Weapon reports were deliberately synthesised while the only alternative was
// "a single flat recorded bang" — that objection is now answered properly:
// 2-3 REAL takes per class (Free Firearm Sound Library, CC0, near-distance
// "Prepared" masters — see assets/audio/sfx/FFSL-LICENSE.txt), and sample()'s
// per-play ±6% rate + gain jitter decorrelates consecutive rounds the same way
// shot() did. The synth path remains the verbatim fallback (owner: "synthesised
// reports may be fine" — recorded preferred when sourceable, and it was).
// glauncher keeps its synth thump: the library has no launcher and the synth
// one reads correctly.
//
// Every call site keeps its synth path as a fallback, so a failed decode, a
// blocked fetch or an old cache degrades to exactly today's behaviour rather
// than to silence.
const SFX = {
  shot_pistol:  ["shot_pistol_0", "shot_pistol_1"],
  shot_smg:     ["shot_smg_0", "shot_smg_1", "shot_smg_2"],
  shot_ar:      ["shot_ar_0", "shot_ar_1", "shot_ar_2"],
  shot_shotgun: ["shot_shotgun_0", "shot_shotgun_1"],
  shot_sniper:  ["shot_sniper_0", "shot_sniper_1", "shot_sniper_2"],
  step_grass:    ["step_grass_000", "step_grass_001", "step_grass_002", "step_grass_003"],
  step_concrete: ["step_concrete_000", "step_concrete_001", "step_concrete_002", "step_concrete_003"],
  step_wood:     ["step_wood_000", "step_wood_001", "step_wood_002", "step_wood_003"],
  step_snow:     ["step_snow_000", "step_snow_001", "step_snow_002", "step_snow_003"],
  imp_stone:     ["impactPlate_light_000", "impactPlate_light_001", "impactPlate_light_002"],
  imp_wood:      ["impactPlank_medium_000", "impactPlank_medium_001", "impactPlank_medium_002"],
  imp_metal:     ["impactMetal_light_000", "impactMetal_light_001", "impactMetal_light_002"],
  imp_glass:     ["impactGlass_light_000", "impactGlass_light_001", "impactGlass_light_002"],
  imp_dirt:      ["impactGeneric_light_000", "impactGeneric_light_001", "impactGeneric_light_002"],
  mag_out:       ["dropLeather", "beltHandle1"],
  mag_in:        ["metalClick", "beltHandle2"],
  rack:          ["metalLatch"],
  equip:         ["drawKnife1", "cloth1"],
  cloth:         ["cloth1", "cloth2"],
  ui_click:      ["ui_click_001", "ui_click_002"],
  ui_back:       ["ui_back_001"],
  ui_close:      ["ui_close_001"],
  ui_ok:         ["ui_confirmation_001"],
  ui_err:        ["ui_error_001"],
};
const sfxBuf = {};       // filename -> AudioBuffer
const sfxSlice = {};     // filename -> {off, dur} — see oneShotSlice()

/**
 * Find the ONE report inside a gunshot file.
 *
 * Three of the thirteen shipped gunshot samples (shot_ar_0, shot_smg_1,
 * shot_smg_2) are not single shots at all: they are three-round BURSTS with
 * ~250-290ms of leading silence, and the 2nd and 3rd reports sit at 79-93% of
 * the file's peak. Played as a one-shot cue, one trigger pull fired three
 * reports — which is what "the echo after firing is louder than the shot"
 * actually was. There was never an echo; there were extra gunshots in the asset.
 *
 * Fixing the three files by hand would leave the next bad file to rediscover
 * this, so the trim is computed from the audio: start at the real onset, end
 * before the next transient. A clean single-shot file is unaffected (no second
 * transient is found, so it plays to its natural end).
 */
function oneShotSlice(buf) {
  try {
    const d = buf.getChannelData(0), sr = buf.sampleRate, n = d.length;
    let peak = 0;
    for (let i = 0; i < n; i++) { const v = Math.abs(d[i]); if (v > peak) peak = v; }
    if (peak <= 0) return { off: 0, dur: buf.duration };
    let on = 0;
    for (let i = 0; i < n; i++) { if (Math.abs(d[i]) > peak * 0.05) { on = i; break; } }
    // Look for a SECOND transient at least 40ms after the first. 40ms is shorter
    // than any real weapon's cycle here (the SMG's 720rpm is 83ms), so a genuine
    // follow-up round is caught while the first shot's own decay is not.
    const gap = Math.floor(sr * 0.04);
    let next = -1;
    for (let i = on + gap; i < n; i++) { if (Math.abs(d[i]) > peak * 0.35) { next = i; break; } }
    const endI = next > 0 ? Math.max(on + gap, next - Math.floor(sr * 0.005)) : n;
    return { off: on / sr, dur: (endI - on) / sr };
  } catch (e) { return { off: 0, dur: buf.duration }; }
}
let sfxReady = false;

/** Decode the pack once, after the context exists. Failures are silent by
 *  design: every caller falls back to the synth path it used before. */
async function loadSfx(W) {
  if (sfxReady || !ctx) return;
  sfxReady = true;
  const names = [];
  for (const k in SFX) for (const n of SFX[k]) if (names.indexOf(n) < 0) names.push(n);
  await Promise.all(names.map(async (n) => {
    try {
      const r = await fetch(W.assetBase + "assets/audio/sfx/" + n + ".ogg");
      if (!r.ok) return;
      sfxBuf[n] = await ctx.decodeAudioData(await r.arrayBuffer());
      if (n.indexOf("shot_") === 0) sfxSlice[n] = oneShotSlice(sfxBuf[n]);
    } catch (e) { /* fall back to synth */ }
  }));
}

/** Play one variant of a logical cue. Returns false if unavailable, so the
 *  caller can run its synth line instead. Routes through the same voice pool,
 *  panner + sfxBus as everything else, so sliders and mute still apply. */
function sample(key, pos, gain, maxD, rate, tier) {
  if (!ctx || !sfxBus) return false;
  const list = SFX[key];
  if (!list || !list.length) return false;
  const pick = list[(Math.random() * list.length) | 0];
  const buf = sfxBuf[pick];
  if (!buf) return false;
  // openVoice() hands back a pool handle whose .out is a GainNode already wired
  // through the HRTF panner into sfxBus, with the distance stashed on __d — so
  // connect straight to it and the clip inherits the same distance curve,
  // panning, mute and slider behaviour as every synthesised voice. null means
  // out of earshot OR dropped by the voice pool: report handled either way,
  // because the synth fallback must not double-fire.
  const h = openVoice(pos, maxD, tier, gain == null ? 0.5 : gain, 1);
  if (!h) return true;
  const out = h.out;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = (rate || 1) * (0.94 + Math.random() * 0.12);
  const g = ctx.createGain();
  g.gain.value = (gain == null ? 0.5 : gain) * (0.9 + Math.random() * 0.2);
  // DISTANCE TIMBRE (sweep finding): air eats treble long before loudness, and
  // the synth path already muffles with range (shot()'s df) — a recorded
  // near-distance master playing full-bright at 250 m loses the positional
  // information the synth had. Same curve: brightness 1.0 -> 0.12 at the cull
  // radius, mapped onto a lowpass. Own/UI plays (__d null) skip the filter.
  if (out.__d != null && out.__d > 8) {
    const df = Math.max(0.12, 1 - out.__d / maxD);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 600 + 17000 * df * df;
    src.connect(g); g.connect(lp); lp.connect(out);
  } else {
    src.connect(g); g.connect(out);
  }
  // h.start is "now", or 6 ms later when this voice had to steal one (the
  // victim fades out first — see voiceKill)
  const t0 = h.start, pr = src.playbackRate.value;
  const sl = sfxSlice[pick];
  if (sl && sl.dur > 0.01) {
    // ONE REPORT PER SHOT (c663ddf3): only the (off, dur) window oneShotSlice()
    // found is played. Taper the last 6ms: the cut lands in the first shot's
    // decay, not at a zero crossing, so an abrupt stop would add a click of its own.
    const end = t0 + sl.dur / pr;
    g.gain.setValueAtTime(g.gain.value, Math.max(t0, end - 0.006));
    g.gain.linearRampToValueAtTime(0.0001, end);
    src.start(t0, sl.off, sl.dur);
    voiceArm(h, out, [src], end);
  } else {
    src.start(t0);
    voiceArm(h, out, [src], t0 + buf.duration / pr);
  }
  return true;
}

let musicBase = 1;        // the current track's own mix level (menu .9 / match .55)
let _blockedTrack = null; // a track the autoplay policy refused, awaiting a gesture
let _pendingMusic = null; // a track whose DOWNLOAD is deferred — see startMenuMusic()
let musicSrc = null, musicDuck = null, musicMix = null, musicFilt = null;

/** 0.45 s of exponentially-decaying stereo noise. GENERATED, not downloaded —
 *  the no-new-binary-assets rule means the room tone has to be synthesised, and
 *  a decaying noise burst is a serviceable small-room impulse. */
function makeIR(seconds, decay) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return b;
}

function ensureCtx(W) {
  if (ctx) return ctx;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  window.__AUDIO_CTX__ = ctx;   // page mute-bar integration
  master = ctx.createGain();
  master.gain.value = W.settings.masterVol;
  // The master used to feed ctx.destination directly. Nothing in the graph
  // constrained the peak, so a 9-pellet shotgun blast (sim: shotgun.pellets 9)
  // or an explosion landing on top of a burst summed past 0 dBFS and clipped in
  // hardware — the "destination with no limiter" the impact comment below
  // diagnosed but never actually fixed. Brickwall it: -6 dBFS, hard knee, 20:1,
  // 3 ms attack so transients are caught but the gunshot crack survives.
  const lim = ctx.createDynamicsCompressor();
  lim.threshold.value = -6; lim.knee.value = 0; lim.ratio.value = 20;
  lim.attack.value = 0.003; lim.release.value = 0.12;
  // Underwater muffle: a lowpass the whole master runs through. Open (20 kHz) on
  // the surface, ~700 Hz when submerged, so going under actually SOUNDS like it.
  uwFilter = ctx.createBiquadFilter();
  uwFilter.type = "lowpass"; uwFilter.frequency.value = 20000; uwFilter.Q.value = 0.4;
  master.connect(uwFilter); uwFilter.connect(lim); lim.connect(ctx.destination);
  sfxBus = ctx.createGain();
  sfxBus.gain.value = W.settings.sfxVol;
  sfxBus.connect(master);
  // Every sound was bone dry, so a firefight inside a building was acoustically
  // identical to one in open field — half of what tells you whether a sound is
  // in YOUR space or somewhere else. Parallel wet send, held at 0 until the
  // roof test in roomTone() says otherwise. Skipped outright on the low tier:
  // partitioned convolution is the one genuinely non-trivial CPU cost in this
  // file and low-tier machines should not be made to pay it for polish.
  if (W.settings.graphics !== "low") {
    try {
      conv = ctx.createConvolver(); conv.buffer = makeIR(0.45, 2.2);
      wetGain = ctx.createGain(); wetGain.gain.value = 0;
      sfxBus.connect(conv); conv.connect(wetGain); wetGain.connect(master);
    } catch (e) { conv = wetGain = null; }
  }
  startTicker(W);
  return ctx;
}

// playTrack mixes each track at its own level (menu 0.9, match 0.55, endgame
// 0.8). setVolumes used to recompute the element volume WITHOUT that factor, so
// the first nudge of any slider — even the SFX one, even nudging it down —
// snapped match music from 0.55 to 1.0, a ~1.8x jump in the middle of a fight.
// masterVol is dropped once routeMusic() has the element inside the graph: the
// master gain applies it there, and folding it in here as well would SQUARE it
// (0.8 master would land music at 0.64x).
function musicLevel(W) {
  return musicBase * W.settings.musicVol * (musicEl && musicEl.__routed ? 1 : W.settings.masterVol);
}

export function setVolumes(W) {
  if (master) master.gain.value = W.settings.masterVol;
  if (sfxBus) sfxBus.gain.value = W.settings.sfxVol;
  if (musicEl) musicEl.volume = musicLevel(W);
}

// ── music ────────────────────────────────────────────────────────────────────
function playTrack(W, name, vol) {
  try {
    _pendingMusic = null;             // an explicit track beats a deferred one
    if (musicEl) { musicEl.pause(); musicEl = null; }
    // A MediaElementSource is permanently bound to the element it was built
    // from and cannot be re-pointed, so the old chain dies with the old element
    // and routeMusic() below builds a fresh one.
    if (musicSrc) { try { musicSrc.disconnect(); } catch (e) {} }
    musicSrc = musicDuck = musicMix = musicFilt = null;
    _blastRelT = -1;   // that schedule belonged to the old duck node
    musicBase = (vol != null ? vol : 1);
    musicEl = new Audio(W.assetBase + "assets/audio/" + name);
    musicEl.loop = true;
    musicEl.volume = musicLevel(W);
    window.__GAME_AUDIO__ = window.__GAME_AUDIO__ || [];
    window.__GAME_AUDIO__.push(musicEl);
    // On a COLD load there has been no user gesture yet, so this play() is
    // rejected by the autoplay policy and the whole 4.9 MB menu track was
    // downloaded and then silently thrown away — the game opened in silence and
    // never recovered, because nothing ever retried. Remember the failure and
    // let the first real gesture start it (see wire()).
    const p = musicEl.play();
    if (p && p.catch) p.catch(() => { _blockedTrack = musicEl; });
    routeMusic();
  } catch (e) {}
}

/** A plain <audio> element sits OUTSIDE the WebAudio graph: the match track
 *  never passed the -6 dBFS master limiter and could not be pushed under
 *  gunfire, so the darksynth sat at exactly the same level as the shots it is
 *  supposed to frame. Routing is deliberately lazy and best-effort — before the
 *  first gesture there is no running ctx to route INTO, and connecting an
 *  element to a SUSPENDED context would silence music that currently plays fine
 *  on its own. musicEl.volume stays the level control (setVolumes, the
 *  visibilitychange mute); these nodes are pure trim on top of it. */
function routeMusic() {
  if (!ctx || ctx.state !== "running" || !musicEl || musicEl.__routed) return;
  try {
    musicSrc = ctx.createMediaElementSource(musicEl);
    musicFilt = ctx.createBiquadFilter(); musicFilt.type = "lowpass"; musicFilt.frequency.value = 20000;
    musicDuck = ctx.createGain(); musicDuck.gain.value = 1;   // gunfire sidechain
    musicMix = ctx.createGain(); musicMix.gain.value = 1;     // endgame intensity
    musicSrc.connect(musicFilt); musicFilt.connect(musicDuck); musicDuck.connect(musicMix); musicMix.connect(master);
    musicEl.__routed = true;
    if (W_) musicEl.volume = musicLevel(W_);   // masterVol moves to the master gain — see musicLevel
  } catch (e) { musicSrc = musicDuck = musicMix = musicFilt = null; }
}
/** Move the duck to `v` from `t`, unless an explosion duck is still holding —
 *  then `v` becomes where that duck releases to instead of cutting it short. */
function duckTo(v, t, tc) {
  const g = musicDuck.gain;
  if (t < _blastRelT) { g.cancelScheduledValues(_blastRelT); g.setTargetAtTime(v, _blastRelT, 0.15); }
  else { g.cancelScheduledValues(t); g.setTargetAtTime(v, t, tc); }
}

/** An own round. The first one of an engagement pulls the band down ~2 dB
 *  (60 ms attack); the rest only extend the hold. BLOCKTOOTH's rule is that
 *  ordinary combat voices never pump the music; one shallow step per firefight
 *  keeps the gunfire on top without the sidechain wobble. */
function duckFireShot() {
  if (!ctx) return;
  const t = ctx.currentTime;
  if (fireDuckStep(_duckSt, t, true, DUCK_FIRE_HOLD) !== "engage") return;
  _aud.duckRamps++;
  if (musicDuck) duckTo(DUCK_FIRE, t, 0.02);
  armDuckTimer();
}

/** Release once the trigger has been quiet for DUCK_FIRE_HOLD (force: now).
 *  Checked from tick() every frame and from a timer, because update() does not
 *  run while paused or on the menu. ~400 ms release, as before. */
function duckFireRelease(force) {
  if (!_duckSt.on) return;
  if (!ctx) { _duckSt.on = false; return; }
  const t = ctx.currentTime;
  if (force) _duckSt.on = false;
  else if (fireDuckStep(_duckSt, t, false, DUCK_FIRE_HOLD) !== "release") return;
  _aud.duckReleases++;
  if (_duckTimer) { clearTimeout(_duckTimer); _duckTimer = 0; }
  if (musicDuck) duckTo(1, t, 0.15);
}

function armDuckTimer() {
  if (_duckTimer) return;
  const check = () => {
    _duckTimer = 0;
    duckFireRelease(false);
    if (_duckSt.on && ctx) {
      const left = DUCK_FIRE_HOLD - (ctx.currentTime - _duckSt.last);
      _duckTimer = setTimeout(check, Math.max(100, left * 1000 + 20));
    }
  };
  _duckTimer = setTimeout(check, DUCK_FIRE_HOLD * 1000 + 20);
}

/** Explosion duck: kept as it was (~-4 dB, 60 ms attack, ~400 ms release),
 *  except it now releases to the fire-duck level if you are still shooting. */
function duckBlast() {
  if (!musicDuck) return;
  const t = ctx.currentTime, g = musicDuck.gain;
  _aud.duckBlasts++;
  g.cancelScheduledValues(t);
  g.setTargetAtTime(DUCK_BLAST, t, 0.02);
  _blastRelT = t + 0.18;
  g.setTargetAtTime(_duckSt.on ? DUCK_FIRE : 1, _blastRelT, 0.15);
}

export function startMenuMusic(W) {
  // 4.79 MB (music_menu.mp3 is 4,900,350 bytes), requested the instant showMenu
  // ran — i.e. while the player is still reading the mode cards and the match's
  // character GLBs are about to contend for the same connection pool. Worse, on
  // a cold load there has been no gesture yet, so the autoplay policy rejects
  // play() and every one of those bytes was downloaded and thrown away (the
  // failure the _blockedTrack retry was added to survive). Defer the fetch: the
  // first gesture is also the first moment the track can legally start.
  if (_pendingMusic) return;
  _pendingMusic = () => { _pendingMusic = null; playTrack(W, "music_menu.mp3", 0.9); };
  const idle = window.requestIdleCallback ? window.requestIdleCallback.bind(window) : (f) => setTimeout(f, 4000);
  idle(() => { if (_pendingMusic) _pendingMusic(); }, { timeout: 6000 });
}
export function startMatchMusic(W) { playTrack(W, "music_match.mp3", 0.55); }
export function onMatchEnd(W, victory) {
  playTrack(W, "music_endgame.mp3", 0.8);
  if (victory) sting(true); else sting(false);
}

// ── synth helpers ────────────────────────────────────────────────────────────
function noiseBuf() {
  if (noiseBuf._b) return noiseBuf._b;
  const b = ctx.createBuffer(1, ctx.sampleRate * 1, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  noiseBuf._b = b;
  return b;
}

/** A PannerNode is meaningless until the listener is placed: the default
 *  listener sits at the origin facing -Z, so world-space source positions would
 *  resolve against a listener that never moves and never turns. Synced from
 *  spatialOut() rather than from a frame loop so a sound triggered between frames
 *  still resolves against the camera that triggered it; the currentTime guard
 *  keeps it to once per render quantum. */
function syncListener(cam) {
  if (ctx.currentTime === _lisT) return;
  _lisT = ctx.currentTime;
  const L = ctx.listener;
  _lf = _lf || new W_.THREE.Vector3(); _lu = _lu || new W_.THREE.Vector3();
  cam.getWorldDirection(_lf);
  // The camera is aimed with lookAt() against world +Y (player.js:1120) so it
  // never rolls — but it PITCHES, and up has to pitch with it or the vertical
  // component of every cue resolves against a listener still looking level.
  _lu.set(0, 1, 0).applyQuaternion(cam.quaternion);
  if (L.positionX) {
    L.positionX.value = cam.position.x; L.positionY.value = cam.position.y; L.positionZ.value = cam.position.z;
    L.forwardX.value = _lf.x; L.forwardY.value = _lf.y; L.forwardZ.value = _lf.z;
    L.upX.value = _lu.x; L.upY.value = _lu.y; L.upZ.value = _lu.z;
  } else {                                          // Safari / older Firefox
    L.setPosition(cam.position.x, cam.position.y, cam.position.z);
    L.setOrientation(_lf.x, _lf.y, _lf.z, _lu.x, _lu.y, _lu.z);
  }
}

/** Distance gain for a world position relative to the camera: 1 for a
 *  head-relative cue (pos null), -1 when out of earshot or unplaceable. Leaves
 *  the distance in _pd (null when head-relative). Split from the node build so
 *  the voice pool can score a cue BEFORE any node exists for it. */
let _pd = null;
function place(pos, maxD) {
  _pd = null;
  if (!pos) return 1;
  const cam = W_.camera;
  const dx = pos.x - cam.position.x, dz = pos.z - cam.position.z;
  const d = Math.hypot(dx, dz, (pos.y || 0) - cam.position.y);
  maxD = maxD || 60;
  // `d > maxD` FAILS OPEN on NaN — every comparison with NaN is false — so a
  // single non-finite coordinate (an actor mid-teleport, a camera between
  // handovers) sailed past this guard, made vol NaN via Math.pow, and then
  // threw "AudioParam: non-finite value" out of g.gain.value. That exception
  // escapes through the event emit and kills the whole frame update: one bad
  // sound position stopped the entire game. A sound we cannot place is a sound
  // we skip, never a crash.
  if (!isFinite(d) || d > maxD) return -1;
  const vol = Math.pow(Math.max(0, 1 - d / maxD), 1.4);
  if (!isFinite(vol)) return -1;
  _pd = d;
  return vol;
}

/** panner+gain for an already-placed cue (place() above decides vol / dist) */
function spatialOut(pos, vol, dist) {
  const cam = W_.camera;
  const g = ctx.createGain();
  g.gain.value = vol;
  if (pos) {
    // StereoPanner encodes left/right ONLY: a source dead ahead and one dead
    // behind both produced pan = 0, so gunfire could not be told front from
    // back and the sky islands' vertical separation was inaudible. (The bug
    // under this line before that was worse — the right vector was the exact
    // negation of the one the rest of the game uses, so every sound played in
    // the WRONG ear at every heading. Do not hand-roll the projection again.)
    // HRTF answers both axes. Distance stays on the tuned (1 - d/maxD)^1.4
    // curve above: rolloffFactor 0 makes the panner purely directional so the
    // two attenuation models cannot fight, and maxD stays the hard cull.
    syncListener(cam);
    const p = ctx.createPanner();
    p.panningModel = "HRTF";
    p.distanceModel = "inverse"; p.refDistance = 1; p.rolloffFactor = 0;
    const py = pos.y || 0;
    if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = py; p.positionZ.value = pos.z; }
    else p.setPosition(pos.x, py, pos.z);
    g.connect(p); p.connect(sfxBus);
  } else g.connect(sfxBus);      // own-player sounds: head-relative, no panning
  // The distance was computed here and then thrown away, so callers could only
  // vary LEVEL with range — a 250 m shot was a bit-identical waveform to a
  // point-blank one, just quieter, which is the opposite of what the docblock
  // above promises. Hand it back so shot() can roll off the high end too. null
  // means "own player", i.e. no distance, so callers keep those at full bright.
  g.__d = dist;
  return g;
}

// Audible radius by weapon class. shot() broadcast every class to a flat 260 m:
// the shotgun (sim falloff [8, 20] — useless past ~20 m) was heard 240 m past
// anywhere it can hurt you, while the sniper (falloff [200, 400], 105 damage out
// to 200 m) killed from 300 m with its report culled at 260 and already at ~2%
// amplitude by 240 m under the (1 - d/maxD)^1.4 curve — you were shot by a gun
// you never heard. Distant gunfire is the rotation signal in a BR, so the radius
// has to track the gun's reach instead of one global number. Deliberately NOT in
// SIM.WEAPONS: shot() already gets the class, and an audio-mix constant does not
// belong in a table netplay and the selftest both read.
const AUDIBLE_M = { pistol: 220, smg: 200, ar: 320, shotgun: 120, sniper: 520, launcher: 260 };

// synth report per class: [lowpass Hz, decay s, gain]. Gains trimmed ~35%
// (owner: shooting audio slightly lower). Hoisted out of shot() — it was a fresh
// object literal on every round of every actor.
const SHOT_P = {
  pistol: [1400, 0.09, 0.32], smg: [1800, 0.06, 0.28], ar: [1100, 0.12, 0.4],
  shotgun: [700, 0.2, 0.6], sniper: [500, 0.32, 0.66], launcher: [420, 0.24, 0.56],
};
const SHOT_P_DEF = [1200, 0.1, 0.34];

function shot(cls, pos, tier) {
  if (!ctx) return;
  const maxD = AUDIBLE_M[cls] || 260;
  const P = SHOT_P[cls] || SHOT_P_DEF;
  const vol = place(pos, maxD); if (vol < 0) return;
  const dist = _pd;
  // crack layer for rifles — near field only: the supersonic crack is a local
  // event, and past ~80 m you should be hearing the muffled report, not the snap
  const crack = (cls === "ar" || cls === "sniper") && (dist || 0) < 80;
  const h = voiceOpen(tierOf(tier, pos), P[2] * vol, crack ? 2 : 1); if (!h) return;
  const out = h.out = spatialOut(pos, vol, dist);
  const t = h.start;
  const n = ctx.createBufferSource(); n.buffer = noiseBuf();
  const f = ctx.createBiquadFilter(); f.type = "lowpass";
  const g = ctx.createGain();
  // Every shot of a class was bit-identical: one cached 1 s noise buffer, always
  // read from offset 0, every filter/gain value a constant from the table below.
  // At the SMG's 720 rpm the 0.13 s tails overlap, and identical copies comb
  // instead of reading as separate reports — full auto sounded like one buzz.
  // Four cheap decorrelators: rate, read window, cutoff, level.
  const rate = 0.93 + Math.random() * 0.14;
  n.playbackRate.value = rate;
  // Brightness by range: 1.0 point-blank falling to 0.12 at the class cutoff.
  // Air eats treble long before it eats loudness, so distance has to move the
  // filter, not just the fader — that muffled far-off report is what the
  // docblock at the top of this file promised and never delivered. Own shots
  // (pos null, so __d null) stay fully bright.
  const df = out.__d != null ? Math.max(0.12, 1 - out.__d / maxD) : 1;
  n.connect(f); f.connect(g); g.connect(out);
  f.frequency.setValueAtTime(P[0] * (0.92 + Math.random() * 0.16) * (0.25 + 0.75 * df), t);
  f.frequency.exponentialRampToValueAtTime(Math.max(80, P[0] * 0.2 * df), t + P[1]);
  g.gain.setValueAtTime(P[2] * (0.9 + Math.random() * 0.2), t);
  g.gain.linearRampToValueAtTime(0.0001, t + P[1] * 2.2);
  // Start at a random window of the buffer, but only as late as the whole tail
  // still fits inside the 1 s of samples — the sniper runs to stop() at t+0.768 s
  // and reads it up to 1.07x fast, so a flat 0..0.7 s offset would have run off
  // the end of the buffer and cut the tail dead mid-envelope on most shots.
  const tStop = t + P[1] * 2.4;
  n.start(t, Math.random() * Math.max(0, 1 - P[1] * 2.4 * rate)); n.stop(tStop);
  if (crack) {
    const o = ctx.createOscillator(), og = ctx.createGain();
    o.type = "square"; o.frequency.setValueAtTime(190, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.05);
    og.gain.setValueAtTime(0.18, t); og.gain.linearRampToValueAtTime(0.0001, t + 0.07);
    o.connect(og); og.connect(out); o.start(t); o.stop(t + 0.08);
    voiceArm(h, out, [n, o], Math.max(tStop, t + 0.08));
  } else voiceArm(h, out, [n], tStop);
}

function blip(freq, dur, vol, type, pos, maxD, tier) {
  if (!ctx) return;
  const h = openVoice(pos, maxD || 40, tier, vol || 0.2, 1); if (!h) return;
  const out = h.out, t = h.start;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type || "sine";
  o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(vol || 0.2, t);
  g.gain.linearRampToValueAtTime(0.0001, t + (dur || 0.1));
  o.connect(g); g.connect(out);
  o.start(t); o.stop(t + (dur || 0.1) + 0.02);
  voiceArm(h, out, [o], t + (dur || 0.1) + 0.02);
}

function thump(freq, dur, vol, pos, maxD, tier) {
  if (!ctx) return;
  const h = openVoice(pos, maxD || 70, tier, vol, 1); if (!h) return;
  const out = h.out, t = h.start;
  const n = ctx.createBufferSource(); n.buffer = noiseBuf();
  const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.linearRampToValueAtTime(0.0001, t + dur);
  n.connect(f); f.connect(g); g.connect(out);
  n.start(t); n.stop(t + dur + 0.02);
  voiceArm(h, out, [n], t + dur + 0.02);
}

// Footsteps were one gain and one 24 m radius for every stance, so crouching —
// which costs 55% of your speed (sim CROUCH.speedMult 0.45) — bought no acoustic
// stealth at all, and a sprint was exactly as quiet as a creep. Stance now sets
// level AND range, and crouch drops the step pitch so it reads as a softer
// footfall rather than merely a quieter one. player.js resolves the stance for
// every actor (a.crouching :800, a.sprinting :823) and bots genuinely crouch.
// The own/other ratio is held at ~0.55, matching the old 0.09 vs 0.16.
// NOTE, not fixable here: net.js replicates neither flag, so an ONLINE remote
// enemy falls to the walk row — undefined degrades to today's behaviour.
const STEP = {
  crouch: { g: 0.07, own: 0.04, d: 11, f: 0.85 },
  walk:   { g: 0.13, own: 0.07, d: 22, f: 1.00 },
  sprint: { g: 0.20, own: 0.11, d: 34, f: 1.06 },
};

// The reload sequence is four timers spanning the weapon's full reloadS and none
// of the handles were kept — so swapping weapons (weapons.js builds a NEW
// a.weapon and drops the reloading state outright) or dying midway still played
// the mag-seat clunk and slide rack of a gun you no longer hold.
function cancelReload() { for (let i = 0; i < reloadTimers.length; i++) clearTimeout(reloadTimers[i]); reloadTimers.length = 0; }

function sting(victory) {
  if (!ctx) return;
  const seq = victory ? [523, 659, 784, 1046] : [392, 330, 262];
  // one pooled voice for the whole arpeggio (head-relative -> top tier)
  const h = openVoice(null, 0, VOICE_TIER.own, 0.25, seq.length); if (!h) return;
  const out = h.out, t = h.start, srcs = [];
  seq.forEach((f2, i) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "triangle"; o.frequency.value = f2;
    g.gain.setValueAtTime(0.0001, t + i * 0.16);
    g.gain.linearRampToValueAtTime(0.25, t + i * 0.16 + 0.03);
    g.gain.linearRampToValueAtTime(0.0001, t + i * 0.16 + 0.5);
    o.connect(g); g.connect(out);
    o.start(t + i * 0.16); o.stop(t + i * 0.16 + 0.55);
    srcs.push(o);
  });
  voiceArm(h, out, srcs, t + (seq.length - 1) * 0.16 + 0.55);
}

// ── event wiring ─────────────────────────────────────────────────────────────
function wire(W) {
  const on = W.events.on;
  // first user gesture unlocks the context
  const unlock = () => {
    ensureCtx(W);
    if (ctx.state === "suspended") ctx.resume();
    loadSfx(W);                 // 472 KB of CC0 one-shots, decoded once

    // the WebAudio context resuming was never enough: the HTMLAudioElement that
    // the autoplay policy rejected is a separate object and needed its own retry.
    if (_blockedTrack && _blockedTrack.paused) {
      const p = _blockedTrack.play();
      if (p && p.catch) p.catch(() => {});
      else _blockedTrack = null;
    } else if (_blockedTrack) _blockedTrack = null;
    // the deferred menu track waits for exactly this moment — see startMenuMusic
    if (_pendingMusic) _pendingMusic();
    routeMusic();
  };
  window.addEventListener("pointerdown", unlock, { once: false });
  window.addEventListener("keydown", unlock, { once: false });
  // iOS Safari only lets an AudioContext resume (and an <audio> element start)
  // inside touchend or click; a touch's pointerdown is too early there, so a
  // phone could tap PLAY and stay silent. Inferred from the WebKit policy, not
  // yet tested on a real WebKit device (PLAN section 7).
  window.addEventListener("touchend", unlock, { once: false, passive: true });
  // A backgrounded tab kept playing at full volume — you alt-tab away and the
  // match music follows you. Suspend on hide, restore on show.
  document.addEventListener("visibilitychange", () => {
    const hidden = document.visibilityState === "hidden";
    if (musicEl) musicEl.volume = hidden ? 0 : musicLevel(W);
    if (ctx) { if (hidden) { try { ctx.suspend(); } catch (e) {} } else { try { ctx.resume(); } catch (e) {} } }
  });

  on("shotFired", (a, weaponId, eye) => {
    const def = W.SIM.WEAPONS[weaponId];
    const cls = def ? def.cls : "ar";
    const own = a === W.player;
    // recorded report first (multi-take round-robin + sample()'s rate jitter =
    // decorrelation), synth shot() verbatim when the class has no recording
    // (launcher) or the pack failed to decode. 260 m ceiling matches the synth
    // path's audible range so bot-fight ambience is unchanged.
    // per-class audible radius, NOT a flat 260: sample() reports "handled"
    // when place() culls beyond maxD, so a flat ceiling silently re-created
    // the exact "shot by a gun you never heard" bug AUDIBLE_M fixed for the
    // synth path (sniper reaches 520 m, shotgun only 120) — sweep finding.
    // Voice pool tier: your own report is top tier and never loses its slot to
    // anything but another own-tier cue; an enemy's report outranks footsteps
    // and impacts whatever its distance.
    const tier = own ? VOICE_TIER.own : VOICE_TIER.gun;
    if (!(SFX["shot_" + cls] && sample("shot_" + cls, own ? null : eye, own ? 0.5 : 0.4, AUDIBLE_M[cls] || 260, 0, tier))) {
      shot(cls, own ? null : eye, tier);
    }
    if (own) duckFireShot();
  });
  // reload = mechanical sequence, not beeps: mag release click → mag drop →
  // mag seat clunk (timed to the weapon's reloadS) → slide rack near the end.
  // Enemy reloads/equips/heals below used to be silenced by an `a !== W.player`
  // guard, which threw away the "he's reloading, push him" read the game could
  // not otherwise give. All of them are positional at <= 25 m and mixed at 0.6x
  // of your own, so mix density in a firefight is effectively unchanged.
  on("reloadStart", (a, wpn) => {
    const own = a === W.player;
    if (own) cancelReload();
    const def = (W.SIM.WEAPONS[wpn.id] || {});
    const total = Math.max(0.8, (def.reloadS || 1.5)) * 1000;
    const p2 = own ? null : a.pos, R = 25, k = own ? 1 : 0.6;
    // RECORDED FOLEY FIRST: mag_out/mag_in/rack were fetched and decoded
    // since the Kenney pack landed but never had a call site — the rescore
    // flagged them as "decoded but unreachable" while this sequence played
    // synth thumps over them. Each beat keeps its thump as the fallback.
    thump(2600, 0.03, 0.22 * k, p2, R);                                       // mag release click
    // `!own && !a.alive` guards: enemy timers are untracked (reloadTimers only
    // collects OWN handles), so an enemy killed mid-reload still played the
    // mag-seat clunk and rack at their corpse (sweep finding)
    const t1 = setTimeout(() => {                                             // mag out / drop
      if (!own && !a.alive) return;
      if (!sample("mag_out", p2, 0.3 * k, R)) thump(700, 0.06, 0.16 * k, p2, R);
    }, 110);
    const t2 = setTimeout(() => {                                             // mag seated
      if (!own && !a.alive) return;
      if (!sample("mag_in", p2, 0.34 * k, R)) { thump(950, 0.05, 0.26 * k, p2, R); thump(420, 0.09, 0.2 * k, p2, R); }
    }, total * 0.55);
    const t3 = setTimeout(() => {                                             // slide rack
      if (!own && !a.alive) return;
      if (sample("rack", p2, 0.34 * k, R)) return;
      thump(3000, 0.025, 0.24 * k, p2, R);
      const t4 = setTimeout(() => thump(1400, 0.05, 0.26 * k, p2, R), 70);
      if (own) reloadTimers.push(t4);
    }, total * 0.86);
    if (own) reloadTimers.push(t1, t2, t3);
  });
  on("reloadDone", (a) => {
    const own = a === W.player;
    if (own) cancelReload();
    thump(1800, 0.03, own ? 0.14 : 0.09, own ? null : a.pos, 25);
  });
  on("dryFire", (a) => { if (a === W.player) blip(300, 0.05, 0.12, "square"); });
  // (the hitmarker ping lives in ONE place further down — two listeners were
  //  registered on this event, so every hit played a detuned sine+square flam
  //  and a 9-pellet shotgun blast summed 18 phase-coherent oscillators into a
  //  destination with no limiter, which audibly clipped)
  on("actorHurt", (victim, info) => {
    if (victim === W.player) thump(600, 0.12, 0.3);
    if (info.broke) blip(1800, 0.25, 0.2, "sawtooth", victim === W.player ? null : victim.pos, 50, VOICE_TIER.gun);
  });
  on("actorDied", (victim) => {
    if (victim === W.player) cancelReload();   // do not rack the slide of a corpse's gun
    thump(300, 0.3, 0.3, victim === W.player ? null : victim.pos, 90, victim === W.player ? VOICE_TIER.own : VOICE_TIER.gun);
  });
  on("swimState", (a, swimming) => { if (swimming) thump(900, 0.25, 0.25, a === W.player ? null : a.pos, 40); });
  on("swimStroke", (a) => thump(1100, 0.12, 0.15, a === W.player ? null : a.pos, 25));
  // footsteps: soft surface thud, own steps quieter than nearby enemies', and
  // level/range/pitch all set by stance (see STEP above)
  on("footstep", (a) => {
    const s = a.crouching ? STEP.crouch : a.sprinting ? STEP.sprint : STEP.walk;
    const own = a === W.player;
    // recorded contact noise beats filtered noise here by a wide margin — a
    // footstep's whole identity is its surface texture. Surface comes from the
    // map so grass, boardwalk and snow read differently underfoot.
    const surf = (W.map && W.map.surfaceAt) ? W.map.surfaceAt(a.pos.x, a.pos.z) : null;
    const keyed = surf === "wood" ? "step_wood" : surf === "snow" ? "step_snow"
                : surf === "stone" || surf === "concrete" ? "step_concrete" : "step_grass";
    // footsteps (yours included) sit below every gunshot in the voice pool
    if (sample(keyed, own ? null : a.pos, own ? s.own : s.g, s.d, s.f, VOICE_TIER.step)) return;
    thump((300 + Math.random() * 90) * s.f, 0.055, own ? s.own : s.g, own ? null : a.pos, s.d, VOICE_TIER.step);
  });
  on("weaponEquipped", (a) => {
    const own = a === W.player;
    if (own) cancelReload();     // weapons.js replaces a.weapon wholesale mid-reload
    if (sample("equip", own ? null : a.pos, own ? 0.22 : 0.14, 18)) return;
    blip(640, 0.05, own ? 0.12 : 0.08, "square", own ? null : a.pos, 18);
  });
  on("chuteDeployed", (a) => thump(1300, 0.35, a === W.player ? 0.3 : 0.2, a === W.player ? null : a.pos, 60));
  on("chuteCut", (a) => { if (a === W.player) blip(420, 0.12, 0.16, "sawtooth"); });
  // launch portal: rising whoosh
  on("portalLaunch", (a) => {
    const own = a === W.player;
    blip(300, 0.5, own ? 0.28 : 0.16, "sawtooth", own ? null : a.pos, 70);
    setTimeout(() => blip(620, 0.35, own ? 0.22 : 0.12, "sine", own ? null : a.pos, 70), 120);
    setTimeout(() => blip(980, 0.3, own ? 0.18 : 0.1, "sine", own ? null : a.pos, 70), 260);
  });
  // hitmarker ping: a short click when YOU land a hit (higher pitch on a headshot)
  on("hitMarker", (owner, target, dmg, isHead) => { if (W.player && owner === W.player) blip(isHead ? 1400 : 950, 0.045, 0.16, "square", null, 0, VOICE_TIER.own); });
  // kill confirm: rising two-tone when YOUR target drops
  on("actorDied", (victim, killerId) => {
    if (W.player && killerId === W.player.id) {
      blip(700, 0.09, 0.2, "triangle", null, 0, VOICE_TIER.own);
      setTimeout(() => blip(1050, 0.14, 0.22, "triangle", null, 0, VOICE_TIER.own), 90);
    }
  });
  // Bullet impacts were entirely silent: weapons.js emits four surfaces
  // (flesh / stone / wood / dirt) and only fx.js listened, for the visual. In a
  // shooter the impact is how you learn you MISSED and what you hit instead —
  // near-misses cracking off a wall beside you are the whole texture of a
  // firefight. Kept short and quiet so a full-auto burst does not become a wall
  // of noise: the hitmarker still owns "you hit them".
  on("impact", (pos, surface) => {
    if (surface === "flesh") return;            // the hitmarker already covers this
    // A shotgun is 9 pellets (sim: shotgun.pellets 9) each travelling as its own
    // projectile, so one blast into a wall fired 9 impact voices in the same
    // millisecond — the identical phase-coherent stack this file's comment above
    // already diagnosed once. One voice per 35 ms window; fx.js still draws the
    // particle burst for every pellet, so the visual spread is unchanged.
    if (!ctx || ctx.currentTime - lastImpactT < 0.035) return;
    lastImpactT = ctx.currentTime;
    // The survivors of that cull are still bit-identical to each other inside a
    // burst and stack coherently into a metallic zap. +/-12% on the pitch is
    // enough to decorrelate them, same trick as the four decorrelators in shot().
    const jf = 0.88 + Math.random() * 0.24;
    const impKey = surface === "stone" ? "imp_stone" : surface === "wood" ? "imp_wood"
                 : surface === "metal" ? "imp_metal" : surface === "glass" ? "imp_glass" : "imp_dirt";
    // lowest voice-pool tier: first to go when a firefight fills the pool
    const TI = VOICE_TIER.impact;
    if (sample(impKey, pos, 0.09, 55, jf, TI)) return;
    if (surface === "stone") blip(2100 * jf, 0.045, 0.07, "square", pos, 55, TI);
    else if (surface === "wood") blip(900 * jf, 0.06, 0.07, "triangle", pos, 55, TI);
    else thump(260 * jf, 0.07, 0.06, pos, 45, TI);  // dirt
  });
  // Supersonic crack of a round passing you. weapons.js emits the point of
  // CLOSEST APPROACH, so the HRTF panner puts it beside the correct ear. Rate-
  // limited like impacts: an enemy SMG at 720 rpm would otherwise fire 12 of
  // these a second into your head and mask the shots themselves.
  on("whizBy", (pos, missM) => {
    if (!ctx || ctx.currentTime - lastWhizT < 0.06) return;
    lastWhizT = ctx.currentTime;
    // "you are being shot at" — ranked with enemy reports in the voice pool
    const wg = 0.4 / (1 + (missM || 0) * 0.6);
    const h = openVoice(pos, 12, VOICE_TIER.gun, wg, 1); if (!h) return;
    const out = h.out, t = h.start;
    const n = ctx.createBufferSource(); n.buffer = noiseBuf();
    n.playbackRate.value = 0.9 + Math.random() * 0.3;
    const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.Q.value = 1.4;
    f.frequency.setValueAtTime(3200, t);
    f.frequency.exponentialRampToValueAtTime(1200, t + 0.05);
    const g = ctx.createGain();
    g.gain.setValueAtTime(wg, t);       // 0.4 at the ear, 0.13 at 3.5 m
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.055);
    n.connect(f); f.connect(g); g.connect(out);
    // random read window for the same reason shot() does it — a repeated
    // identical 40 ms noise burst combs
    n.start(t, Math.random() * 0.9); n.stop(t + 0.07);
    voiceArm(h, out, [n], t + 0.07);
  });
  // these three were emitted into the void — no listener anywhere
  on("hardLand", (a, speed) => thump(180, 0.22, Math.min(0.4, 0.12 + speed * 0.008), a === W.player ? null : a.pos, 60));
  on("propBreak", (p2) => { blip(320, 0.16, 0.22, "square", p2, 60); setTimeout(() => blip(210, 0.2, 0.16, "square", p2, 60), 70); });
  on("supplyDropLanded", (p2) => { thump(140, 0.5, 0.4, p2, 240, VOICE_TIER.gun); setTimeout(() => blip(880, 0.5, 0.18, "triangle", p2, 240, VOICE_TIER.gun), 160); });
  on("chestOpened", (a, c) => { blip(660, 0.3, 0.14, "triangle", a === W.player ? null : c.pos, 40); setTimeout(() => blip(990, 0.4, 0.12, "triangle", a === W.player ? null : c.pos, 40), 120); });
  on("pickedUp", (a) => { const own = a === W.player; blip(840, 0.07, own ? 0.12 : 0.07, "sine", own ? null : a.pos, 16); });
  on("healStart", (a) => { const own = a === W.player; blip(520, 0.3, own ? 0.1 : 0.08, "sine", own ? null : a.pos, 20); });
  on("healed", (a) => { const own = a === W.player; blip(700, 0.25, own ? 0.14 : 0.09, "sine", own ? null : a.pos, 20); });
  // scopeState was one of the emitted-into-the-void events: the scope overlay
  // appeared with no accompanying sound, so ADS on the sniper read as a UI
  // toggle rather than a mechanism. player.js:1130 emits it EVERY FRAME rather
  // than on change — hud.js:2020 absorbs that because setting a display style is
  // idempotent, but a blip is not, so latch the edge here or it machine-guns.
  on("scopeState", (s) => { if (!!s === _scoped) return; _scoped = !!s; blip(_scoped ? 1500 : 1100, 0.035, 0.09, "square"); });
  // The explosion duck stays, but only for a blast you can HEAR: it used to fire
  // for every launcher round anywhere on the map, so a fight 1 km away dipped
  // your music with no sound to explain it. Same 200 m radius as the thump.
  on("explosion", (pos) => {
    thump(180, 0.6, 0.7, pos, 200, VOICE_TIER.gun);
    if (W.camShake > 0.2) thump(90, 0.8, 0.5);
    if (ctx && place(pos, 200) >= 0) duckBlast();
  });
  on("stormWarning", () => siren(W, 2));
  on("stormClosing", () => siren(W, 3));
  on("stormTick", () => blip(140, 0.3, 0.14, "sawtooth"));
  on("playerStormState", (inStorm) => { if (inStorm) thump(200, 0.5, 0.25); });
  on("stormKill", () => {});
  on("supplyDropSpawned", () => { blip(880, 0.2, 0.16, "triangle"); setTimeout(() => blip(1100, 0.3, 0.14, "triangle"), 200); });
  // positional for enemies too — chuteDeployed already was, and an enemy
  // touching down 40 m away is a read you want (sweep finding: the pair was
  // inconsistent, own-only here vs positional deploy)
  on("landed", (a) => {
    const own = a === W.player;
    thump(500, 0.15, own ? 0.25 : 0.14, own ? null : a.pos, 60);
  });
  // this was a REGISTERED EMPTY HANDLER — player.js:944 emits "jump" on every
  // takeoff and nothing listened, so jumping made no sound at all. Same story
  // for ordinary landings: "landed" only fires on the parachute touchdown, so
  // the thump below it was a once-per-match sound pretending to be a footfall.
  on("jump", (a) => { if (a === W.player) thump(300, 0.09, 0.16); });
  // mantle: cloth scrape + a low effort thump (the emit shipped with no
  // listener anywhere — sweep finding); positional for others at close range
  on("mantle", (a) => {
    const own = a === W.player, p2 = own ? null : a.pos;
    if (!sample("cloth", p2, own ? 0.3 : 0.2, 18)) thump(900, 0.06, own ? 0.18 : 0.1, p2, 18);
    thump(240, 0.1, own ? 0.2 : 0.12, p2, 18);
  });
  on("touchdown", (a, speed) => {
    const k = Math.min(1, (speed || 4) / 14);
    thump(360 - k * 120, 0.10 + k * 0.06, 0.12 + k * 0.14, a === W.player ? null : a.pos, 40);
  });
  // recorded Kenney UI tick first (six clips sat decoded-but-unreachable —
  // sweep finding); the synth blip stays as the fallback
  on("uiClick", () => { if (!sample("ui_click", null, 0.3, 999)) blip(900, 0.04, 0.12, "square"); });
  on("countdownBeep", (final) => blip(final ? 1200 : 800, final ? 0.3 : 0.12, 0.2, "square"));
}

function siren(W, n) {
  if (!ctx) return;
  const h = openVoice(null, 0, VOICE_TIER.own, 0.16, n); if (!h) return;
  const out = h.out, t = h.start, srcs = [];
  for (let i = 0; i < n; i++) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(520, t + i * 0.5);
    o.frequency.linearRampToValueAtTime(760, t + i * 0.5 + 0.25);
    g.gain.setValueAtTime(0.0001, t + i * 0.5);
    g.gain.linearRampToValueAtTime(0.16, t + i * 0.5 + 0.05);
    g.gain.linearRampToValueAtTime(0.0001, t + i * 0.5 + 0.45);
    o.connect(g); g.connect(out);
    o.start(t + i * 0.5); o.stop(t + i * 0.5 + 0.5);
    srcs.push(o);
  }
  voiceArm(h, out, srcs, t + (n - 1) * 0.5 + 0.5);
}

// ── continuous beds ──────────────────────────────────────────────────────────
// Everything above is one-shot, fired from an event. The storm wall, the biome
// ambience, the room tone and the music intensity are all CONTINUOUS and need a
// tick, and this module had no per-frame hook at all — it exported init and the
// music calls and nothing else. The main loop now drives update() alongside the
// other modules, but it does so behind an `if (audioMod.update)` guard, so the
// self-throttled rAF below stands in if that call is ever absent. The first
// external call retires the fallback so the two can never both run.
let _extDriven = false, _rafH = 0, _lastTickT = 0, _slowAcc = 0;
let stormBed = null, ambBed = null, ambWater = null;

export function update(W, dt) {
  _extDriven = true;
  if (_rafH) { cancelAnimationFrame(_rafH); _rafH = 0; }
  poolNextFrame();          // one voice-pool frame budget per game frame
  tick(W, dt);
}

function startTicker(W) {
  if (_extDriven || _rafH) return;
  _lastTickT = performance.now();
  const step = () => {
    _rafH = requestAnimationFrame(step);
    const now = performance.now();
    const d = (now - _lastTickT) / 1000; _lastTickT = now;
    poolNextFrame();
    tick(W, d);
  };
  _rafH = requestAnimationFrame(step);
}

function tick(W, dt) {
  if (!ctx || ctx.state !== "running" || !W) return;
  // The one-shot path syncs the listener lazily from spatialOut(), and own-player
  // sounds pass no position so they do not sync it at all. The beds below need
  // it right when NOTHING is firing — standing still in an empty field is
  // precisely when you read the storm wall off its bearing — so sync here too.
  // The ctx.currentTime guard inside makes the duplicate call free.
  if (W_ && W_.camera) syncListener(W_.camera);
  duckFireRelease(false);   // the trigger has been quiet for the hold -> band back up
  stormAudio(W);
  ambience(W);
  musicIntensity(W);
  // the two probes that cost a lookup rather than a gain write run at 4 Hz —
  // neither a roof nor a shoreline appears fast enough to need 60
  _slowAcc += dt;
  if (_slowAcc >= 0.25) { _slowAcc = 0; roomTone(W); waterTone(W); }
}

// One looping voice for the whole match, positioned at the nearest point on the
// wall. The storm's entire vocabulary was a non-positional siren (2-3 blips per
// phase) plus one 200 Hz thump on crossing the line, so with the wall behind you
// or in low visibility sound gave you NO bearing on it — and the ramping damage
// (+50% per 6 s soaked, capped 3x) makes getting the rotation direction wrong
// expensive. The siren and the crossing thump stay: they are phase punctuation
// and still earn their place over the bed.
function stormAudio(W) {
  const ctl = W.stormCtl;
  const live = ctl && ctl.storm.phases.length && (W.phase === "match" || W.phase === "drop") && W.player;
  if (!live) { if (stormBed) { try { stormBed.src.stop(); } catch (e) {} stormBed = null; } return; }
  if (!stormBed) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf(); src.loop = true;
    src.playbackRate.value = 0.35;                       // drops the noise into a rumble
    const filt = ctx.createBiquadFilter(); filt.type = "lowpass"; filt.frequency.value = 500;
    const gain = ctx.createGain(); gain.gain.value = 0;
    const pan = ctx.createPanner();
    pan.panningModel = "HRTF"; pan.distanceModel = "inverse"; pan.refDistance = 1; pan.rolloffFactor = 0;
    src.connect(filt); filt.connect(gain); gain.connect(pan); pan.connect(sfxBus);
    src.start();
    stormBed = { src, filt, gain, pan };
  }
  const st = ctl.state();
  const p = W.player.pos;
  const ddx = p.x - st.center.x, ddz = p.z - st.center.z;
  const dd = Math.hypot(ddx, ddz) || 1;
  const wx = st.center.x + (ddx / dd) * st.radius, wz = st.center.z + (ddz / dd) * st.radius;
  const t = ctx.currentTime;
  const inStorm = st.dps > 0 && dd > st.radius;
  const frac = dd / Math.max(1, st.radius);
  // silent in the middle of the circle, rising over the outer 45% of the radius
  let want = inStorm ? 0.30 : Math.max(0, Math.min(1, (frac - 0.55) / 0.45)) * 0.16;
  if (st.closing && !inStorm) want *= 1.5;               // "the wall is MOVING" is audible too
  stormBed.gain.gain.setTargetAtTime(want, t, 0.25);
  stormBed.filt.frequency.setTargetAtTime(inStorm ? 900 : 500, t, 0.4);
  if (stormBed.pan.positionX) { stormBed.pan.positionX.value = wx; stormBed.pan.positionY.value = p.y + 1; stormBed.pan.positionZ.value = wz; }
  else stormBed.pan.setPosition(wx, p.y + 1, wz);
}

// Biome -> filtered-noise recipe. Wind and forest are the same synth in a
// different band; all three are generated, so no asset budget is involved.
const AMBIENCE = {
  forest:   { rate: 0.55, type: "lowpass",  freq: 1800, g: 0.045, gust: 0.07 },
  tropical: { rate: 0.5,  type: "bandpass", freq: 900,  g: 0.040, gust: 0.05 },
  savanna:  { rate: 0.45, type: "bandpass", freq: 500,  g: 0.050, gust: 0.11 },
};

// Between gunshots all three maps were dead air — an anechoic chamber wearing
// three different skyboxes. Non-positional, because wind has no bearing. The
// biome comes off W.map.K, the MAPS entry buildMap already hands back (maps.js
// returns `K` alongside `themeColor`), so this needs nothing from maps.js.
function ambience(W) {
  const live = W.map && W.player && (W.phase === "match" || W.phase === "drop");
  if (!live) {
    if (ambBed) { try { ambBed.src.stop(); } catch (e) {} ambBed = null; }
    if (ambWater) { try { ambWater.src.stop(); } catch (e) {} ambWater = null; }
    return;
  }
  if (!ambBed) {
    const R = (W.map.K && AMBIENCE[W.map.K.theme]) || AMBIENCE.forest;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf(); src.loop = true;
    src.playbackRate.value = R.rate;
    const filt = ctx.createBiquadFilter(); filt.type = R.type; filt.frequency.value = R.freq; filt.Q.value = 0.6;
    const gain = ctx.createGain(); gain.gain.value = 0;
    src.connect(filt); filt.connect(gain); gain.connect(sfxBus);
    src.start();
    ambBed = { src, filt, gain, R };
  }
  // gusts: a flat bed reads as tape hiss rather than as weather
  const R2 = ambBed.R;
  ambBed.gain.gain.setTargetAtTime(R2.g * (0.75 + 0.25 * Math.sin(W.t * R2.gust * 6.283)), ctx.currentTime, 0.5);
}

// Shoreline layer, tropical and forest only (both carry water: true in MAPS).
function waterTone(W) {
  if (!ambBed || !W.map || !W.map.K || !W.map.K.water || !W.player) {
    if (ambWater) ambWater.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.6);
    return;
  }
  if (!ambWater) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf(); src.loop = true;
    const filt = ctx.createBiquadFilter(); filt.type = "bandpass"; filt.frequency.value = 3500; filt.Q.value = 0.7;
    const gain = ctx.createGain(); gain.gain.value = 0;
    src.connect(filt); filt.connect(gain); gain.connect(sfxBus);
    src.start();
    ambWater = { src, filt, gain };
  }
  const p = W.player.pos;
  const near = W.map.heightAt(p.x, p.z) < W.map.waterY + 2;
  ambWater.gain.gain.setTargetAtTime(near ? 0.03 : 0, ctx.currentTime, 0.6);
}

// Indoor test for the reverb send built in ensureCtx(): a box whose UNDERSIDE
// sits above your head is a ceiling. Reuses the collider grid the movement code
// already queries, so it costs one small cell lookup at 4 Hz. Material-density
// occlusion is deliberately skipped — not worth the raycast budget in a browser.
function roomTone(W) {
  if (!wetGain || !W.map || !W.map.queryColliders || !W_.camera) return;
  const cam = W_.camera.position;
  const list = W.map.queryColliders(cam.x, cam.z, 1.2);
  let roofed = false;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (c.kind === "box" && cam.x > c.minX && cam.x < c.maxX && cam.z > c.minZ && cam.z < c.maxZ
        && c.minY > cam.y + 0.4 && c.minY < cam.y + 8) { roofed = true; break; }
  }
  wetGain.gain.setTargetAtTime(roofed ? 0.18 : 0, ctx.currentTime, 0.35);
}

// One match track played unchanged from drop to final circle. Pull the score
// back as the lobby drains so the last fight is carried by footsteps, not by the
// same loop that scored the bus ride. Only reachable once routeMusic() has put
// the element inside the graph.
function musicIntensity(W) {
  if (!musicMix || !musicFilt || !W.match) return;
  // the victory/defeat sting is its own moment: restore the full band the
  // instant the match is over, or the endgame track plays through the duck
  const thinning = W.phase === "match" || W.phase === "drop";
  const alive = thinning ? W.match.aliveCount() : 99;
  const want = alive <= 3 ? 0.35 : alive <= 10 ? 0.75 : 1;
  musicMix.gain.setTargetAtTime(want, ctx.currentTime, 1.2);
  musicFilt.frequency.setTargetAtTime(alive <= 10 ? 1400 : 20000, ctx.currentTime, 1.5);
}
