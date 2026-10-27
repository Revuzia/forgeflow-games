/**
 * royale/audio.js — Web Audio SFX (recorded CC0 one-shots with synth fallbacks:
 * per-class gunshots, footsteps, impacts, foley, UI) + real music tracks from the
 * owner's catalog (Laser Sequence — darksynth; unique to this game per the
 * no-duplicate-music rule).
 *
 * Positional: every world sound is placed with an HRTF PannerNode (equal-power
 * on the "speakers" output) against a listener that sits at the FOCUS ACTOR'S
 * HEAD and turns with the camera — the Unreal listener-attenuation pattern
 * (distance from the pawn, panning from the camera). It used to sit AT the
 * third-person camera, 4.3 m behind the character, so everything behind you was
 * louder than the same thing in front (P1-B / LC-02). Distance is a separate
 * tuned curve. Gunshots are information (PUBG lesson), so they carry to a
 * per-class radius (AUDIBLE_M, shotgun 120 m to sniper 520 m), arrive late with
 * range (speed of sound beyond 25 m), lose their treble, and their outdoor tail
 * falls off slower than the direct sound, so a far shot is mostly echo.
 *
 * Acoustics (P1-B / LC-26): each placed sound is tested against the static box
 * colliders between it and the listener (slab test through W.map.queryColliders,
 * plus a few terrain samples) — one wall muffles it, two muffle it more — and
 * against a roof over the SOURCE: a roofed source feeds the room reverb, an open
 * one feeds the outdoor tail. Results are cached per (source, listener) cell.
 *
 * The continuous beds at the bottom of this file — storm wall, biome ambience,
 * freefall wind, the room and outdoor impulses — are all generated in code.
 */

let ctx = null, master = null, sfxBus = null;
let W_ = null;
let lastImpactT = 0;      // voice budget for the impact listener — see wire()
let lastWhizT = 0;        // ditto for the near-miss crack
let _lisT = -1e9, _lisFrame = -1;  // wall ms / pool frame the WebAudio listener was last synced
let _lf = null, _lu = null;   // scratch forward/up vectors (THREE arrives with W)
const _lisW = [NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN];   // last listener values written
let reloadTimers = [];    // outstanding reload-sequence timers, so a swap can kill them
let _scoped = false;      // last scopeState — that event re-fires EVERY frame

// ── acoustics + mix state (P1-B) ────────────────────────────────────────────
// Listener = the focus actor's head (see computeListener). `cam` says the
// fallback (menu / no focus) used the camera instead.
const _L = { x: 0, y: 0, z: 0, ok: false, cam: true };
let tailIn = null, roomIn = null;   // per-voice send inputs: outdoor tail / indoor room reverb
let ambBus = null;                  // ambience + shoreline (threat-ducked)
let monoNode = null;                // master downmix point for the mono option
let musicThreat = null;             // threat duck on the music chain
let _lisRoof = false;               // the listener's own head is under a roof (4 Hz)
let _threat = 0;                    // 0..1, raised by enemy fire near you, decays ~1.5 s
// LC-69 settings engine. The Settings rows land in P2-G; until then these are
// driven by W.settings.audioOutput / audioMix / audioMono (if present) and by
// the exported setters (also on W.__audio).
const _opt = { output: "headphones", mix: "default", mono: false };
// counters for the probes (cumulative for the page, like the pool's)
const _acc = { occTests: 0, occCached: 0, occluded: 0, roofed: 0, delayed: 0, remoteSteps: 0, remoteReloads: 0,
               steps: 0, tailSends: 0, roomSends: 0, musicLoops: 0, musicXfades: 0, pings: 0,
               // P23
               distMid: 0, distFar: 0, vocals: 0, vocalsDropped: 0, downed: 0, revives: 0, reviveCancels: 0, revived: 0,
               falls: 0, smokes: 0, shimmerOn: 0, knockConfirms: 0, teamAlerts: 0 };

// Speed of sound, and the range below which a report is left on time (a 25 m
// shot would be 73 ms late — inside the muzzle-flash read, so not worth it).
const SOUND_MPS = 343;
const DELAY_FROM_M = 25;
// Occlusion: per blocking layer (0, 1, 2+) a gain and a lowpass. One wall is a
// ~6 dB, much darker sound: you still hear it, you hear that it is behind
// something. Tested only inside OCC_MAX_D (a far shot is already muffled by the
// distance timbre and dominated by its tail).
const OCC_G = [1, 0.5, 0.32];
const OCC_F = [0, 950, 520];
const OCC_MAX_D = 140;
// Send levels into the shared reverbs (measured in P1-B probes; see readback).
const TAIL_SEND = 0.42;
const ROOM_SEND = 0.7;
// Per-call acoustic recipes. tail/room scale the sends, occl enables the
// occlusion test, delay the speed-of-sound offset. null = dry (UI, stings).
const FX_GUN = { tail: 1, room: 1, occl: true, delay: true };
// P23 (LC-08): a recorded mid / far take carries its own outdoor tail, so it sends less into the generated one
const FX_GUN_DIST = { tail: 0.55, room: 1, occl: true, delay: true, dist: true };
const FX_BOOM = { tail: 1.3, room: 1, occl: true, delay: true };
const FX_FOLEY = { tail: 0, room: 0.9, occl: true, delay: false };
const FX_STEP = { tail: 0, room: 0.9, occl: true, delay: false };
// Footstep mix (LC-53): a teammate's steps sit 8 dB under, an enemy's 2 dB over
// the stance row, so the one you must react to wins at equal range.
const MATE_STEP = 0.398;   // -8 dB
const ENEMY_STEP = 1.259;  // +2 dB

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
    // not started yet (same render quantum, or a distance-delayed report still
    // in flight): stopping it at its own start time is inaudible
    for (let i = 0; i < srcs.length; i++) { try { srcs[i].stop(v.start); } catch (e) {} }
    if (v.strip) v.strip.busy = now;
    return now;
  }
  const tEnd = now + 0.006;   // 6 ms fade: a hard cut mid-waveform clicks
  if (v.out) {
    try { const g = v.out.gain; g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); g.linearRampToValueAtTime(0, tEnd); } catch (e) {}
  }
  for (let i = 0; i < srcs.length; i++) { try { srcs[i].stop(tEnd); } catch (e) {} }
  if (v.strip) v.strip.busy = tEnd + 0.01;
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
  if (h.strip) h.strip.busy = h.end + 0.02;
}

/** default tier: a head-relative cue is the player's own feedback; a placed
 *  one is world foley unless the call site says otherwise */
function tierOf(tier, pos) { return tier != null ? tier : (pos ? VOICE_TIER.step : VOICE_TIER.own); }

/** Place + admit + build the output node for one voice: null when culled by
 *  distance or dropped by the pool, else the pool handle with .out wired.
 *  fx: acoustic recipe (FX_GUN ...; default FX_FOLEY for a placed cue, dry for
 *  a head-relative one). A placed cue is scored with its OCCLUDED gain, and a
 *  delayed one (fx.delay, beyond DELAY_FROM_M) starts d / 343 s later. */
function openVoice(pos, maxD, tier, gain, n, fx) {
  const vol = place(pos, maxD);
  if (vol < 0) return null;
  const d = _pd;
  if (fx === undefined) fx = pos ? FX_FOLEY : null;
  const env = pos ? sourceEnv(pos, fx) : null;
  const occ = env ? env.occ : 0;
  const h = voiceOpen(tierOf(tier, pos), (gain == null ? 0.5 : gain) * vol * OCC_G[occ], n || 1);
  if (!h) return null;
  if (fx && fx.delay && d != null && d > DELAY_FROM_M) {
    h.start += d / SOUND_MPS; h.end = h.start + 0.05;
    _acc.delayed++;
  }
  h.out = spatialOut(pos, vol, d, fx, env, maxD, h);
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
  readSettings(W);
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
  // LC-69 settings engine (P2-G's Settings rows call these)
  W.__audio.setOutput = setOutput;
  W.__audio.setMix = setMix;
  W.__audio.setMono = setMono;
  // probe surface (P2-F ports the P1-B probes into gate.py): what the acoustics
  // decide for a world point right now — {occ, roof, d, vol} for a maxD
  W.__audio.env = (x, y, z, maxD) => {
    if (!ctx || !W_) return null;
    const pos = { x, y, z };
    const vol = place(pos, maxD || 320), d = _pd;
    const e = sourceEnv(pos, FX_GUN);
    return { occ: e.occ, roof: e.roof, d, vol, listener: { x: _L.x, y: _L.y, z: _L.z, fromCamera: _L.cam } };
  };
}

/** W.settings may carry the P2-G audio rows; unknown values fall back to the defaults. */
function readSettings(W) {
  const s = (W && W.settings) || {};
  if (s.audioOutput != null) _opt.output = s.audioOutput === "speakers" ? "speakers" : "headphones";
  if (s.audioMix != null) _opt.mix = s.audioMix === "focused" ? "focused" : "default";
  if (s.audioMono != null) _opt.mono = !!s.audioMono;
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
  const reg = (typeof window !== "undefined" && window.__GAME_AUDIO__) || [];
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
    // P1-B
    listener: { x: _L.x, y: _L.y, z: _L.z, fromCamera: _L.cam, roofed: _lisRoof },
    options: { output: _opt.output, mix: _opt.mix, mono: _opt.mono },
    threat: Math.round(_threat * 1000) / 1000,
    reverbs: { tail: !!tailIn, room: !!roomIn },
    music: { track: _cur ? _cur.name : null, registry: reg.length,
             tracks: Object.keys(_tr), playing: Object.keys(_tr).filter((k) => _tr[k].el && !_tr[k].el.paused) },
    acoustics: Object.assign({}, _acc),
    tick: { ms: Math.round(_tickMs * 1000) / 1000, n: _tickN },
    wind: windBed ? { speed: Math.round(windBed.speed * 10) / 10, level: Math.round(windBed.level * 10000) / 10000 } : null,
    // P23
    shimmer: shimmer ? { d: shimmer.d != null ? Math.round(shimmer.d * 100) / 100 : null, level: Math.round(shimmer.level * 100000) / 100000,
                         x: shimmer.x, z: shimmer.z, accessor: typeof (W && W.nearbyChests) === "function" ? "nearbyChests" : "debugChests" } : null,
    revivesActive: _rev.size,
    sfxLate: Object.keys(sfxBuf).filter(lateSfx).length,
  };
}

/**
 * Match teardown (C8). Nothing here is a GPU resource; what must not outlive a
 * match is behaviour: the reload foley timers of a gun the player no longer
 * holds, a fire duck still holding the next track down, the scope latch, the
 * threat duck and the acoustic cache (it holds collider-derived answers).
 * Voices in flight are left to finish — the victory/defeat sting is one of them.
 */
/** Test hook: forget an actor's vocal state (voice key, hurt-grunt gap and busy window) so a probe can fire the
 *  next cue at once. The state is a module WeakMap (see voSt), never fields on the actor. */
export function resetVocal(a, keepVoice) {
  if (!a) return;
  const s = _voSt.get(a);
  if (!s) return;
  s.t = -1e9; s.end = 0;
  if (!keepVoice) s.v = null;
}
export function disposeMatch(W) {
  cancelReload();
  duckFireRelease(true);
  _blastRelT = -1;
  _scoped = false;
  _threat = 0;
  _envCache.clear();
  // P23: no revive rustle, chest hum or queued grunt survives into the next match
  stopAllRevives();
  stopShimmer();
  _hurtQ.length = 0;
  // startMatch runs every disposeMatch before the ~20 s world build: fetch the
  // match and endgame tracks now, so both are seekable Blobs by the drop
  if (W && W.assetBase != null) { fetchBlob(W, "music_match.mp3"); fetchBlob(W, "music_endgame.mp3"); }
}

// ── recorded one-shots (Kenney + FFSL, CC0) ─────────────────────────────────
// Everything in this file was synthesised, which is fine for tonal cues (blips,
// stings, the storm bed) but obviously fake for the physical ones: a footstep is
// broadband contact noise with a texture that says "grass" or "wood", and no
// amount of filtered noise sells that. The Kenney clips are CC0 (public domain,
// commercial use fine, no attribution required — assets/audio/sfx/), covering
// exactly the categories synthesis is worst at.
//
// Weapon reports: 2-3 REAL takes per class (Free Firearm Sound Library, CC0,
// near-distance "Prepared" masters — see assets/audio/sfx/FFSL-LICENSE.txt), and
// sample()'s per-play ±6% rate + gain jitter decorrelates consecutive rounds the
// same way shot() did. The synth path remains the verbatim fallback. glauncher
// keeps its synth thump: the library has no launcher and the synth one reads.
//
// P1-B (LC-55): hit confirms and the blast are recorded too — flesh / shield
// tink / shield break / explosion, built from local Kenney CC0 packs
// (impact-sounds 1.0, interface-sounds 1.0) plus a seeded procedural rumble
// under the blast (F:/lc_p1/P1-B/sfx_build/build_sfx.py, credits_P1-B.md).
//
// Every call site keeps its synth path as a fallback, so a failed decode, a
// blocked fetch or an old cache degrades to exactly the old behaviour rather
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
  // P23 fix round: the rest of maps.surfaceAt's labels (CC0; OGA Fantozzi / TinyWorlds / rubberduck / Peludo + Kenney
  // impact layers for metal; F:/lc_p23/audio/fixtools/build_steps.py, loudest-50 ms RMS matched to step_grass)
  step_sand:     ["step_sand_000", "step_sand_001", "step_sand_002", "step_sand_003"],
  step_dirt:     ["step_dirt_000", "step_dirt_001", "step_dirt_002", "step_dirt_003"],
  step_metal:    ["step_metal_000", "step_metal_001", "step_metal_002", "step_metal_003"],
  step_water:    ["step_water_000", "step_water_001", "step_water_002", "step_water_003"],
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
  hit_flesh:     ["hit_flesh_0", "hit_flesh_1"],
  hit_shield:    ["hit_shield_0", "hit_shield_1"],
  shield_break:  ["shield_break_0"],
  explosion:     ["explosion_0", "explosion_1"],
  // P23 (LC-16 sound side): the two new near takes - DMR = SKS, burst AR = AR-15 (FFSL CC0). The LMG plays the
  // AR takes pitched down (GUN_SND.lmg.rate), so it needs no file of its own.
  shot_dmr:      ["shot_dmr_0", "shot_dmr_1", "shot_dmr_2"],
  shot_burst:    ["shot_burst_0", "shot_burst_1"],
};
// P23 (LC-08): the DISTANT layers - FFSL "mid distance" (Prepared SFX) and "far distance" (Master Tracks) takes,
// recorded tens to hundreds of metres from the shooter: gd_<class>_mid / gd_<class>_far. No shotgun far layer
// (its 120 m radius ends before the far band starts). Built by F:/lc_p23/audio/tools/build_sfx.py.
const GD_SETS = { pistol: [2, 2], smg: [2, 2], ar: [2, 2], shotgun: [2, 0], sniper: [2, 2], dmr: [2, 2], burst: [2, 2] };
for (const k in GD_SETS) {
  const [m, f] = GD_SETS[k];
  if (m) SFX["gd_" + k + "_mid"] = Array.from({ length: m }, (_, i) => "gd_" + k + "_mid_" + i);
  if (f) SFX["gd_" + k + "_far"] = Array.from({ length: f }, (_, i) => "gd_" + k + "_far_" + i);
}
// P23 (LC-67): the vocal layer - three CC0 voices (m1 Potapooo, m2 qubodup + thebardofblasphemy, f
// Nocturnal_Vanguard + mvVoiceActing), each with hurt / downed / death / revive takes: vo_<voice>_<kind>.
const VO_SETS = { m1: { hurt: 4, downed: 2, death: 2, revive: 2 }, m2: { hurt: 5, downed: 2, death: 3, revive: 2 },
                  f: { hurt: 5, downed: 2, death: 2, revive: 1 } };
for (const v in VO_SETS) for (const k in VO_SETS[v]) SFX["vo_" + v + "_" + k] = Array.from({ length: VO_SETS[v][k] }, (_, i) => "vo_" + v + "_" + k + "_" + i);
/** the second fetch wave: layers that only ever ADD to a cue that already has a fallback */
function lateSfx(n) { return n.indexOf("gd_") === 0 || n.indexOf("vo_") === 0; }
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
 * transient is found, so it plays to its natural end). The REAL tail a report
 * needs now comes from the outdoor tail send (see spatialOut), not the file.
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
  const one = async (n) => {
    try {
      const r = await fetch(W.assetBase + "assets/audio/sfx/" + n + ".ogg");
      if (!r.ok) return;
      sfxBuf[n] = await ctx.decodeAudioData(await r.arrayBuffer());
      if (n.indexOf("shot_") === 0) sfxSlice[n] = oneShotSlice(sfxBuf[n]);
    } catch (e) { /* fall back to synth */ }
  };
  // P23: the core pack first; the distant gun layers and the vocals (63 files, ~690 KB) only once it is in, so
  // they never queue ahead of a footstep or the player's own report. Until a late clip decodes, its cue plays
  // what it played before (the near take, no vocal).
  await Promise.all(names.filter((n) => !lateSfx(n)).map(one));
  await Promise.all(names.filter(lateSfx).map(one));
}

/** Play one variant of a logical cue. Returns false if unavailable, so the
 *  caller can run its synth line instead. Routes through the same voice pool,
 *  panner + sfxBus as everything else, so sliders and mute still apply.
 *  fx: acoustic recipe (see openVoice). */
function sample(key, pos, gain, maxD, rate, tier, fx) {
  if (!ctx || !sfxBus) return false;
  const list = SFX[key];
  if (!list || !list.length) return false;
  const pick = list[(Math.random() * list.length) | 0];
  const buf = sfxBuf[pick];
  if (!buf) return false;
  // openVoice() hands back a pool handle whose .out is a GainNode already wired
  // through occlusion, the HRTF panner and the reverb sends into sfxBus, with
  // the distance stashed on __d — so connect straight to it and the clip
  // inherits the same distance curve, panning, mute and slider behaviour as
  // every synthesised voice. null means out of earshot OR dropped by the voice
  // pool: report handled either way, because the synth fallback must not double-fire.
  const h = openVoice(pos, maxD, tier, gain == null ? 0.5 : gain, 1, fx);
  if (!h) return true;
  const out = h.out;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = (rate || 1) * (0.94 + Math.random() * 0.12);
  const lvl = (gain == null ? 0.5 : gain) * (0.9 + Math.random() * 0.2);
  // On a pooled strip the per-play level folds into the strip's own gain (and
  // its two sends, which tap BEFORE that gain) and the end taper rides its input gain, so a placed clip costs ONE new node
  // (the source). Head-relative clips keep their own gain node.
  const st = h.strip;
  let g = null;
  if (st) { st.g.gain.value *= lvl; st.ts.gain.value *= lvl; st.rs.gain.value *= lvl; src.connect(out); }
  else { g = ctx.createGain(); g.gain.value = lvl; }
  // DISTANCE TIMBRE (sweep finding): air eats treble long before loudness —
  // brightness 1.0 -> 0.12 at the cull radius, mapped onto a lowpass (on a
  // strip: folded into its occlusion lowpass, the lower cutoff wins).
  // Own/UI plays (__d null) skip the filter.
  if (out.__d != null && out.__d > 8) {
    const df = Math.max(0.12, 1 - out.__d / maxD);
    // a DISTANT take (fx.dist, P23 LC-08) was recorded far away: the air already took its treble, so it only
    // gets a gentle extra slope instead of the near take's full darkening (that would count the distance twice)
    const fc = fx && fx.dist ? 1800 + 15000 * df : 600 + 17000 * df * df;
    if (st) {
      const f = st.lp.frequency;
      if (fc < f.value) { f.value = fc; if (st.lp.Q.value > 0.6) st.lp.Q.value = 1; }
    } else {
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = fc;
      src.connect(g); g.connect(lp); lp.connect(out);
    }
  } else if (g) {
    src.connect(g); g.connect(out);
  }
  // h.start is "now", 6 ms later when this voice had to steal one (the victim
  // fades out first — see voiceKill), or d / 343 s later for a far report
  const t0 = h.start, pr = src.playbackRate.value;
  const sl = sfxSlice[pick];
  if (sl && sl.dur > 0.01) {
    // ONE REPORT PER SHOT (c663ddf3): only the (off, dur) window oneShotSlice()
    // found is played. Taper the last 6ms: the cut lands in the first shot's
    // decay, not at a zero crossing, so an abrupt stop would add a click of its own.
    const end = t0 + sl.dur / pr;
    const tg = st ? st.inp.gain : g.gain;
    tg.setValueAtTime(st ? 1 : g.gain.value, Math.max(t0, end - 0.006));
    tg.linearRampToValueAtTime(0.0001, end);
    src.start(t0, sl.off, sl.dur);
    voiceArm(h, out, [src], end);
  } else {
    src.start(t0);
    voiceArm(h, out, [src], t0 + buf.duration / pr);
  }
  return true;
}

// ── impulses (generated, never downloaded) ──────────────────────────────────
/** Small/medium ROOM: early reflections in the first 30 ms, then a dense
 *  exponential tail (tau 0.32 s, ~0.95 s long). Stereo channels are independent noise,
 *  so a mono send comes back diffuse. */
function makeRoomIR() {
  const sr = ctx.sampleRate, len = Math.floor(sr * 0.95);
  const b = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      lp += 0.55 * ((Math.random() * 2 - 1) - lp);           // gentle air absorption
      d[i] = lp * Math.exp(-t / 0.32) * Math.min(1, t / 0.004);
    }
    const er = ch ? [0.0071, 0.0113, 0.0167, 0.0239] : [0.0053, 0.0131, 0.0191, 0.0277];
    for (let k = 0; k < er.length; k++) {
      const i0 = Math.floor(er[k] * sr), a = 0.7 - k * 0.12;
      for (let j = 0; j < 40 && i0 + j < len; j++) d[i0 + j] += a * (Math.random() * 2 - 1) * (1 - j / 40);
    }
  }
  return b;
}

/** OUTDOOR tail: what a gun sounds like in open country — a 25 ms gap, a few
 *  discrete slapbacks off terrain and buildings (different per ear), then a
 *  rolling diffuse decay that darkens as it goes (~1.9 s). This is the half of
 *  a gunshot the dry close-mic takes never had. */
function makeTailIR() {
  const sr = ctx.sampleRate, len = Math.floor(sr * 1.9);
  const b = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr - 0.025;
      if (t < 0) { d[i] = 0; continue; }
      const a = 0.25 + 0.7 * Math.min(1, t / 1.3);           // one-pole coefficient: bright early, dark late
      lp += (1 - a) * ((Math.random() * 2 - 1) - lp);
      d[i] = lp * Math.exp(-t / 0.45) * Math.min(1, t / 0.04) * 0.7;
    }
    const echoes = ch ? [0.071, 0.163, 0.29, 0.47, 0.74] : [0.083, 0.141, 0.33, 0.52, 0.81];
    for (let k = 0; k < echoes.length; k++) {
      const i0 = Math.floor(echoes[k] * sr), a = 0.55 * Math.exp(-echoes[k] / 0.55);
      for (let j = 0; j < 200 && i0 + j < len; j++) d[i0 + j] += a * (Math.random() * 2 - 1) * Math.exp(-j / 45);
    }
  }
  return b;
}

function ensureCtx(W) {
  if (ctx) return ctx;
  // LC-87: a browser with no Web Audio (a WebKit build without it, a locked-down
  // embed) threw "undefined is not a constructor" here on the first gesture and
  // took the input handler with it. No context = no SFX; the music element
  // still plays on its own (playTrack never needs ctx).
  const AC = typeof window !== "undefined" ? (window.AudioContext || window.webkitAudioContext) : null;
  if (!AC) return null;
  try { ctx = new AC(); } catch (e) { ctx = null; return null; }
  window.__AUDIO_CTX__ = ctx;   // page mute-bar integration
  master = ctx.createGain();
  master.gain.value = W.settings.masterVol;
  // The master used to feed ctx.destination directly. Nothing in the graph
  // constrained the peak, so a 9-pellet shotgun blast (sim: shotgun.pellets 9)
  // or an explosion landing on top of a burst summed past 0 dBFS and clipped in
  // hardware. Brickwall it: -6 dBFS, hard knee, 20:1, 3 ms attack so transients
  // are caught but the gunshot crack survives.
  const lim = ctx.createDynamicsCompressor();
  lim.threshold.value = -6; lim.knee.value = 0; lim.ratio.value = 20;
  lim.attack.value = 0.003; lim.release.value = 0.12;
  // Underwater muffle: a lowpass the whole master runs through. Open (20 kHz) on
  // the surface, ~700 Hz when submerged, so going under actually SOUNDS like it.
  uwFilter = ctx.createBiquadFilter();
  uwFilter.type = "lowpass"; uwFilter.frequency.value = 20000; uwFilter.Q.value = 0.4;
  // mono option (LC-69): one node whose channel count is switched 2 <-> 1
  monoNode = ctx.createGain();
  master.connect(uwFilter); uwFilter.connect(monoNode); monoNode.connect(lim); lim.connect(ctx.destination);
  applyMono();
  sfxBus = ctx.createGain();
  sfxBus.gain.value = W.settings.sfxVol;
  sfxBus.connect(master);
  ambBus = ctx.createGain(); ambBus.gain.value = 1;
  ambBus.connect(sfxBus);
  // REVERBS (P1-B / LC-08 + LC-26). The old graph had ONE wet send on the whole
  // sfxBus, opened by a roof over the CAMERA: every sound — the enemy in the
  // field outside included — got the same room, and the room's tail sat ~50 dB
  // down (inaudible). Now each placed voice sends to the reverb of where IT is:
  // a roofed source into the room, an open one into the outdoor tail (guns and
  // blasts only — a footstep has no 1.9 s tail). Partitioned convolution is the
  // one real CPU cost here, so the low tier gets a two-tap feedback echo for the
  // tail instead and no room reverb.
  try {
    if (W.settings.graphics !== "low") {
      const tc = ctx.createConvolver(); tc.buffer = makeTailIR();
      tailIn = ctx.createGain(); tailIn.connect(tc); tc.connect(sfxBus);
      const rc = ctx.createConvolver(); rc.buffer = makeRoomIR();
      roomIn = ctx.createGain(); roomIn.connect(rc); rc.connect(sfxBus);
    } else {
      tailIn = ctx.createGain();
      const out = ctx.createGain(); out.gain.value = 0.55; out.connect(sfxBus);
      for (const [dt, fb] of [[0.083, 0.42], [0.131, 0.38]]) {
        const dl = ctx.createDelay(0.5); dl.delayTime.value = dt;
        const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1600;
        const g = ctx.createGain(); g.gain.value = fb;
        tailIn.connect(dl); dl.connect(lp); lp.connect(g); g.connect(dl); lp.connect(out);
      }
      roomIn = null;
    }
  } catch (e) { tailIn = roomIn = null; }
  startTicker(W);
  return ctx;
}

// ── music ────────────────────────────────────────────────────────────────────
// One persistent <audio> element PER TRACK (LC-95: playTrack built a new element
// on every call and pushed it into window.__GAME_AUDIO__, which grew by one per
// menu -> match -> results cycle). Each element is routed into the graph once,
// through its own crossfade gain, into the shared music chain
//   track xf -> musicFilt -> musicDuck (gunfire) -> musicMix (intensity) -> musicThreat -> master
// LC-54: the files carry 0.50-0.62 s of lead silence and a fade-out, so the
// native loop dropped out for ~0.6 s at every seam. The loop is now done here:
// at `b` (the last 50 ms window above -33 dBFS, before the fade-out's floor)
// the element seeks to `a` (the first window above it, after the lead silence).
// Points measured offline (F:/lc_p1/P1-B/music_seams2.py: ffmpeg decode, 50 ms
// RMS windows of the file at full scale).
// A seek needs a SEEKABLE source, and the CDN answers a Range request with a
// plain 200 (measured 2026-10-20), so Chrome treats the streamed file as
// unseekable (currentTime = 208 lands on 0). Each track is therefore fetched
// once into a Blob (~3 MB compressed, the bytes the element would stream
// anyway) and played from its object URL, which seeks instantly. A failed
// fetch falls back to the network URL and the native loop, i.e. the old seam.
const TRACKS = {
  "music_menu.mp3":    { base: 0.9,  a: 0.50, b: 209.00 },
  "music_match.mp3":   { base: 0.55, a: 0.50, b: 223.65 },
  "music_endgame.mp3": { base: 0.8,  a: 0.65, b: 219.60 },
};
const ENDGAME_ALIVE = 10;    // the endgame track crossfades in at this many alive
const _tr = {};              // name -> { name, el, base, a, b, src, xf, routed, srcSet, want }
const _blob = {};            // name -> Promise<object URL | null>
let _cur = null;             // the track that is (or is becoming) audible
let _blockedTrack = null;    // a track the autoplay policy refused, awaiting a gesture
let _pendingMusic = null;    // a track whose DOWNLOAD is deferred — see startMenuMusic()
let musicDuck = null, musicMix = null, musicFilt = null;
let _musicIv = 0, _seamT = 0;

// Each track mixes at its own level (menu 0.9, match 0.55, endgame 0.8).
// masterVol is dropped once the element is inside the graph: the master gain
// applies it there, and folding it in here as well would SQUARE it.
function trackLevel(W, r) {
  return r.base * W.settings.musicVol * (r.routed ? 1 : W.settings.masterVol);
}
function musicLevel(W) { return _cur ? trackLevel(W, _cur) : 0; }

export function setVolumes(W) {
  if (master) master.gain.value = W.settings.masterVol;
  if (sfxBus) sfxBus.gain.value = W.settings.sfxVol;
  const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
  for (const k in _tr) { const r = _tr[k]; if (r.el) r.el.volume = hidden ? 0 : trackLevel(W, r); }
}

/** The track's bytes as a seekable object URL (null = use the network URL). */
function fetchBlob(W, name) {
  if (_blob[name]) return _blob[name];
  const url = W.assetBase + "assets/audio/" + name;
  _blob[name] = (typeof fetch === "function" && typeof URL !== "undefined" && URL.createObjectURL
    ? fetch(url).then((r) => (r.ok ? r.blob() : null)).then((b) => (b ? URL.createObjectURL(b) : null)).catch(() => null)
    : Promise.resolve(null));
  return _blob[name];
}

function trackRec(W, name) {
  let r = _tr[name];
  if (r) return r;
  const T = TRACKS[name] || { base: 1, a: 0, b: 0 };
  const el = new Audio();
  el.preload = "auto";
  // native loop stays ON as the fallback: if the seam pump below ever misses
  // (a starved tab, an unseekable fallback source), the track still wraps
  el.loop = true;
  r = _tr[name] = { name, el, base: T.base, a: T.a, b: T.b, src: null, xf: null, routed: false, srcSet: false, want: false };
  window.__GAME_AUDIO__ = window.__GAME_AUDIO__ || [];
  window.__GAME_AUDIO__.push(el);     // once per track, for the page mute bar
  fetchBlob(W, name).then((u) => {
    el.src = u || (W.assetBase + "assets/audio/" + name);
    r.seekable = !!u;
    r.srcSet = true;
    if (r.want && _cur === r) startTrack(W, r, r.wantFade || 0);
  });
  routeTrack(r);
  return r;
}

/** fadeS: crossfade length from the current track (0 = cut, the old behaviour). */
function playTrack(W, name, vol, fadeS) {
  try {
    _pendingMusic = null;             // an explicit track beats a deferred one
    const r = trackRec(W, name);
    if (vol != null) r.base = vol;
    const old = _cur;
    _cur = r;
    if (old && old !== r) { old.want = false; fadeOutTrack(old, fadeS || 0); }
    if (old === r && r.srcSet && !r.el.paused) return;   // already the live track: keep its place
    r.want = true; r.wantFade = fadeS || 0;
    if (r.srcSet) startTrack(W, r, fadeS || 0);
    armMusicPump();
  } catch (e) {}
}

function startTrack(W, r, fadeS) {
  try {
    if (r.el.paused && r.el.currentTime > 0 && r.a > 0 && r.seekable) {
      // a track coming back (results -> menu): start it from its first note
      try { r.el.currentTime = r.a; } catch (e) {}
    }
    r.el.volume = trackLevel(W, r);
    routeTrack(r);
    if (r.xf && ctx) {
      const g = r.xf.gain, t = ctx.currentTime;
      g.cancelScheduledValues(t);
      if (fadeS > 0) { g.setValueAtTime(0.0001, t); g.linearRampToValueAtTime(1, t + fadeS); }
      else g.setValueAtTime(1, t);
    }
    // On a COLD load there has been no user gesture yet, so play() is rejected
    // by the autoplay policy. Remember the failure and let the first real
    // gesture start it (see wire()).
    const p = r.el.play();
    if (p && p.catch) p.catch(() => { _blockedTrack = r.el; });
  } catch (e) {}
}

function fadeOutTrack(r, fadeS) {
  if (!r || !r.el) return;
  if (r.xf && ctx && fadeS > 0) {
    const g = r.xf.gain, t = ctx.currentTime;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(0.0001, t + fadeS);
    r.stopAt = performance.now() + fadeS * 1000 + 60;
  } else {
    try { r.el.pause(); } catch (e) {}
    r.stopAt = 0;
  }
}

/** Route one element into the shared chain (best-effort, lazily: before the
 *  first gesture there is no running ctx, and connecting an element to a
 *  SUSPENDED context would silence music that plays fine on its own). */
function routeTrack(r) {
  if (!ctx || ctx.state !== "running" || !r || r.routed) return;
  if (!musicFilt) {
    try {
      musicFilt = ctx.createBiquadFilter(); musicFilt.type = "lowpass"; musicFilt.frequency.value = 20000;
      musicDuck = ctx.createGain(); musicDuck.gain.value = 1;     // gunfire sidechain
      musicMix = ctx.createGain(); musicMix.gain.value = 1;       // endgame intensity
      musicThreat = ctx.createGain(); musicThreat.gain.value = 1; // threat duck (LC-53)
      musicFilt.connect(musicDuck); musicDuck.connect(musicMix); musicMix.connect(musicThreat); musicThreat.connect(master);
    } catch (e) { musicFilt = musicDuck = musicMix = musicThreat = null; return; }
  }
  try {
    r.src = ctx.createMediaElementSource(r.el);
    r.xf = ctx.createGain(); r.xf.gain.value = r === _cur ? 1 : 0.0001;
    r.src.connect(r.xf); r.xf.connect(musicFilt);
    r.routed = true;
    if (W_) r.el.volume = trackLevel(W_, r);   // masterVol moves to the master gain
  } catch (e) { r.src = r.xf = null; }
}
function routeMusic() { for (const k in _tr) routeTrack(_tr[k]); }

/** Seam + fade housekeeping. Runs from tick() in a match and from a 100 ms
 *  interval otherwise (update() does not run on the menu or while paused). The
 *  seek is scheduled with a timer for the exact remaining time once the seam is
 *  under 300 ms away, so it lands within a few ms of `b`. */
function musicPump() {
  const now = performance.now();
  for (const k in _tr) {
    const r = _tr[k];
    if (r !== _cur && r.stopAt && now >= r.stopAt) { try { r.el.pause(); } catch (e) {} r.stopAt = 0; }
  }
  const r = _cur;
  if (!r || !r.el || !r.seekable || r.el.paused || !(r.b > r.a)) return;
  const left = r.b - r.el.currentTime;
  if (left <= 0) { seamNow(r); return; }
  if (left < 0.3 && !_seamT) _seamT = setTimeout(() => { _seamT = 0; if (_cur === r && !r.el.paused) seamNow(r); }, Math.max(0, left * 1000 - 4));
}
function seamNow(r) {
  if (r.el.currentTime < r.b - 0.05) return;
  try { r.el.currentTime = r.a; _acc.musicLoops++; } catch (e) {}
}
function armMusicPump() {
  if (_musicIv) return;
  _musicIv = setInterval(musicPump, 100);
}

/** Crossfade to another track (LC-54 phase change). */
function crossfadeTo(W, name, fadeS) {
  if (_cur && _cur.name === name && !_cur.el.paused) return;
  _acc.musicXfades++;
  playTrack(W, name, null, fadeS);
}

/** An own round. The first one of an engagement pulls the band down ~2 dB
 *  (60 ms attack); the rest only extend the hold. BLOCKTOOTH's rule is that
 *  ordinary combat voices never pump the music; one shallow step per firefight
 *  keeps the gunfire on top without the sidechain wobble. */
function duckTo(v, t, tc) {
  const g = musicDuck.gain;
  if (t < _blastRelT) { g.cancelScheduledValues(_blastRelT); g.setTargetAtTime(v, _blastRelT, 0.15); }
  else { g.cancelScheduledValues(t); g.setTargetAtTime(v, t, tc); }
}

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
  if (!musicDuck || !ctx) return;
  const t = ctx.currentTime, g = musicDuck.gain;
  _aud.duckBlasts++;
  g.cancelScheduledValues(t);
  g.setTargetAtTime(DUCK_BLAST, t, 0.02);
  _blastRelT = t + 0.18;
  g.setTargetAtTime(_duckSt.on ? DUCK_FIRE : 1, _blastRelT, 0.15);
}

export function startMenuMusic(W) {
  // ~2.9 MB (music_menu.mp3), requested the instant showMenu ran — while the
  // player is still reading the mode cards and the match's character GLBs are
  // about to contend for the same connection pool. On a cold load there has
  // been no gesture yet, so the autoplay policy rejects play() and every byte
  // was downloaded and thrown away. Defer the fetch: the first gesture is also
  // the first moment the track can legally start.
  if (_pendingMusic) return;
  if (_tr["music_menu.mp3"]) { playTrack(W, "music_menu.mp3", 0.9, 1.5); return; }   // back from a match: element exists
  _pendingMusic = () => { _pendingMusic = null; playTrack(W, "music_menu.mp3", 0.9); };
  const idle = window.requestIdleCallback ? window.requestIdleCallback.bind(window) : (f) => setTimeout(f, 4000);
  idle(() => { if (_pendingMusic) _pendingMusic(); }, { timeout: 6000 });
}
export function startMatchMusic(W) { playTrack(W, "music_match.mp3", 0.55, 1.0); }
export function onMatchEnd(W, victory) {
  // the endgame track may already be up (it crossfades in at ENDGAME_ALIVE alive)
  crossfadeTo(W, "music_endgame.mp3", 1.2);
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

// ── listener (LC-02) ─────────────────────────────────────────────────────────
/** The ear is the FOCUS actor's head: the spectated player while you spectate,
 *  else you. Its position comes from the same point the camera orbits
 *  (player.js updateCamera: obj.position for an interpolated body, pos
 *  otherwise, plus the smoothed eye height), so the ear never lags the view.
 *  On the menu (no focus) it falls back to the camera. */
function computeListener() {
  const W = W_;
  if (!W) { _L.ok = false; return false; }
  const f = W.phase !== "menu" ? (W._camFocus || W.player) : null;
  if (f && f.pos) {
    const b = (f.alive && f._vmode && f.obj) ? f.obj.position : f.pos;
    const ey = f._hasEyeY ? f._eyeY : (f.swimming ? 0.7 : 1.62);
    const x = b.x, y = b.y + ey, z = b.z;
    if (isFinite(x) && isFinite(y) && isFinite(z)) { _L.x = x; _L.y = y; _L.z = z; _L.ok = true; _L.cam = false; return true; }
  }
  const cam = W.camera;
  if (cam && isFinite(cam.position.x) && isFinite(cam.position.y) && isFinite(cam.position.z)) {
    _L.x = cam.position.x; _L.y = cam.position.y; _L.z = cam.position.z; _L.ok = true; _L.cam = true; return true;
  }
  _L.ok = false;
  return false;
}

/** A PannerNode is meaningless until the listener is placed. Position = the
 *  focus head (computeListener), orientation = the camera, so left/right and
 *  front/back follow the view exactly while distance is measured from the
 *  character (the Unreal listener-attenuation pattern). Synced lazily from
 *  place() so a sound triggered between frames resolves against the frame that
 *  triggered it; once per voice-pool frame (or 20 ms of wall clock, for the
 *  frameless paths: menu, fastForward). */
function syncListener(cam) {
  if (!ctx) return;
  const wall = performance.now();
  if (_pool.frame === _lisFrame && wall - _lisT < 20) return;
  _lisT = wall; _lisFrame = _pool.frame;
  if (!computeListener() || !cam) return;
  const L = ctx.listener;
  _lf = _lf || new W_.THREE.Vector3(); _lu = _lu || new W_.THREE.Vector3();
  cam.getWorldDirection(_lf);
  // The camera is aimed with lookAt() against world +Y so it never rolls — but
  // it PITCHES, and up has to pitch with it or the vertical component of every
  // cue resolves against a listener still looking level.
  _lu.set(0, 1, 0).applyQuaternion(cam.quaternion);
  // nine AudioParam writes cross to the audio thread: skip them when nothing moved
  const w = _lisW;
  if (w[0] === _L.x && w[1] === _L.y && w[2] === _L.z && w[3] === _lf.x && w[4] === _lf.y && w[5] === _lf.z && w[6] === _lu.x && w[7] === _lu.y && w[8] === _lu.z) return;
  w[0] = _L.x; w[1] = _L.y; w[2] = _L.z; w[3] = _lf.x; w[4] = _lf.y; w[5] = _lf.z; w[6] = _lu.x; w[7] = _lu.y; w[8] = _lu.z;
  if (L.positionX) {
    L.positionX.value = _L.x; L.positionY.value = _L.y; L.positionZ.value = _L.z;
    L.forwardX.value = _lf.x; L.forwardY.value = _lf.y; L.forwardZ.value = _lf.z;
    L.upX.value = _lu.x; L.upY.value = _lu.y; L.upZ.value = _lu.z;
  } else {                                          // Safari / older Firefox
    L.setPosition(_L.x, _L.y, _L.z);
    L.setOrientation(_lf.x, _lf.y, _lf.z, _lu.x, _lu.y, _lu.z);
  }
}

/** Distance gain for a world position relative to the LISTENER: 1 for a
 *  head-relative cue (pos null), -1 when out of earshot or unplaceable. Leaves
 *  the distance in _pd (null when head-relative). Split from the node build so
 *  the voice pool can score a cue BEFORE any node exists for it. */
let _pd = null;
function place(pos, maxD) {
  _pd = null;
  if (!pos) return 1;
  if (!W_) return -1;
  syncListener(W_.camera);
  if (!_L.ok) return -1;
  const dx = pos.x - _L.x, dz = pos.z - _L.z;
  const d = Math.hypot(dx, dz, (pos.y || 0) - _L.y);
  maxD = maxD || 60;
  // `d > maxD` FAILS OPEN on NaN — every comparison with NaN is false — so a
  // single non-finite coordinate (an actor mid-teleport, a camera between
  // handovers) sailed past this guard and threw "AudioParam: non-finite value"
  // out of the event emit, which killed the whole frame update. A sound we
  // cannot place is a sound we skip, never a crash.
  if (!isFinite(d) || d > maxD) return -1;
  const vol = Math.pow(Math.max(0, 1 - d / maxD), 1.4);
  if (!isFinite(vol)) return -1;
  _pd = d;
  return vol;
}

// ── acoustics (LC-26) ────────────────────────────────────────────────────────
// queryColliders' default result array is SHARED scratch, valid until the next
// call (maps.js contract) — and these tests run inside event handlers, i.e. in
// the middle of weapons.js / player.js loops that may still be reading theirs.
// So every query here passes its OWN out array.
const _qo = [];
const _occHit = [];
const _envCache = new Map();
const _envRes = { occ: 0, roof: false };

/** segment (x0..x1) vs axis-aligned box: the classic slab test */
function segBox(c, x0, y0, z0, x1, y1, z1) {
  let t0 = 0, t1 = 1;
  const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
  if (Math.abs(dx) < 1e-9) { if (x0 < c.minX || x0 > c.maxX) return false; }
  else { let a = (c.minX - x0) / dx, b = (c.maxX - x0) / dx; if (a > b) { const s = a; a = b; b = s; } if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) return false; }
  if (Math.abs(dy) < 1e-9) { if (y0 < c.minY || y0 > c.maxY) return false; }
  else { let a = (c.minY - y0) / dy, b = (c.maxY - y0) / dy; if (a > b) { const s = a; a = b; b = s; } if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) return false; }
  if (Math.abs(dz) < 1e-9) { if (z0 < c.minZ || z0 > c.maxZ) return false; }
  else { let a = (c.minZ - z0) / dz, b = (c.maxZ - z0) / dz; if (a > b) { const s = a; a = b; b = s; } if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) return false; }
  return true;
}
function inBox(c, x, y, z) { return x >= c.minX && x <= c.maxX && y >= c.minY && y <= c.maxY && z >= c.minZ && z <= c.maxZ; }

/** Is there a roof over this point? A box whose UNDERSIDE sits 0.3-9 m above
 *  head height and that spans more than a lamp head. A feet-level point is
 *  lifted to head height first, so a footstep and a gunshot from the same
 *  spot get the same answer. */
function roofAt(x, y, z) {
  const M = W_ && W_.map;
  if (!M || !M.queryColliders) return false;
  const gy = M.heightAt ? M.heightAt(x, z) : y;
  const y0 = Math.max(y, gy + 1.5);
  const list = M.queryColliders(x, z, 0.5, _qo);
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (c.kind === "box" && !c.dead && x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ
        && c.minY > y0 + 0.3 && c.minY < y0 + 9 && c.maxX - c.minX > 1.6 && c.maxZ - c.minZ > 1.6) return true;
  }
  return false;
}

/** Blocking layers between a source and the listener's head: static boxes at
 *  least 1 m tall that the straight path crosses (a box holding either end is
 *  skipped — you are not occluded by the floor you stand on), plus the terrain
 *  (a hill counts as one layer). Swept in 12 m spans like maps.js losBlocked so
 *  each query touches a couple of grid cells. Capped at 2. */
function occlusionAt(ax, ay, az) {
  const M = W_.map;
  if (!M || !M.queryColliders) return 0;
  const bx = _L.x, by = _L.y, bz = _L.z;
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (!(len > 1.5) || len > OCC_MAX_D) return 0;
  let hits = 0;
  _occHit.length = 0;
  const spans = Math.max(1, Math.ceil(len / 12));
  for (let s = 0; s < spans && hits < 2; s++) {
    const t0 = s / spans, t1 = (s + 1) / spans;
    const x0 = ax + dx * t0, y0 = ay + dy * t0, z0 = az + dz * t0;
    const x1 = ax + dx * t1, y1 = ay + dy * t1, z1 = az + dz * t1;
    const hx = x1 - x0, hz = z1 - z0;
    const list = M.queryColliders((x0 + x1) / 2, (z0 + z1) / 2, Math.sqrt(hx * hx + hz * hz) / 2 + 0.6, _qo);
    for (let i = 0; i < list.length && hits < 2; i++) {
      const c = list[i];
      if (c.kind !== "box" || c.dead || c.maxY - c.minY < 1.0) continue;
      if (_occHit.indexOf(c) >= 0) continue;
      if (inBox(c, ax, ay, az) || inBox(c, bx, by, bz)) continue;
      if (segBox(c, x0, y0, z0, x1, y1, z1)) { _occHit.push(c); hits++; }
    }
  }
  if (hits < 2 && M.heightAt) {
    for (let k = 1; k < 6; k++) {
      const t = k / 6;
      if (M.heightAt(ax + dx * t, az + dz * t) > ay + dy * t + 0.25) { hits++; break; }
    }
  }
  return Math.min(2, hits);
}

/** Occlusion + roof for one placed source, cached per (1 m source cell, 0.5 m
 *  listener cell) for 250 ms: a burst from one spot costs one test. */
function sourceEnv(pos, fx) {
  _envRes.occ = 0; _envRes.roof = false;
  if (!W_ || !W_.map || !_L.ok) return _envRes;
  const M = W_.map;
  const gy = M.heightAt ? M.heightAt(pos.x, pos.z) : (pos.y || 0);
  const py = Math.max(pos.y || 0, gy + 1.0);       // a feet-level source radiates from the body
  const now = performance.now();
  const key = ((Math.round(pos.x) + 4096) * 8192 + (Math.round(pos.z) + 4096)) * 512 + (Math.round(py) + 256);
  const lk = ((Math.round(_L.x * 2) + 8192) * 16384 + (Math.round(_L.z * 2) + 8192)) * 1024 + (Math.round(_L.y * 2) + 512);
  const e = _envCache.get(key);
  if (e && e.lk === lk && now - e.t < 250) {
    _acc.occCached++;
    _envRes.occ = (fx && fx.occl) ? e.occ : 0; _envRes.roof = e.roof;
    return _envRes;
  }
  _acc.occTests++;
  const occ = occlusionAt(pos.x, py, pos.z);
  const roof = roofAt(pos.x, py, pos.z);
  if (_envCache.size > 400) _envCache.clear();
  _envCache.set(key, { t: now, lk, occ, roof });
  if (occ) _acc.occluded++;
  if (roof) _acc.roofed++;
  _envRes.occ = (fx && fx.occl) ? occ : 0; _envRes.roof = roof;
  return _envRes;
}

// Positional CHANNEL STRIPS. Every placed voice used to build its own
//   gain -> [lowpass] -> gain -> HRTF panner (+ send)
// and throw it away ~0.3 s later. Creating an HRTF PannerNode is the single
// most expensive call in this file (CPU profile of the 10-shooter budget
// scenario: spatialOut was the top self-time, ~0.3 ms per voice), so the
// positional half of the chain is now a small pool of persistent strips,
// reconfigured per voice (gain, occlusion cutoff, panner position, sends):
//   inp -> lowpass (open = Nyquist) -> gain (vol x occlusion) -> panner -> sfxBus
//                                 \-> tail send -> tailIn,  \-> room send -> roomIn
// A strip is busy until its voice's last source stops (voiceArm / voiceKill set
// it), so the voice pool's cap (24) also bounds the strips in use; STRIP_MAX
// leaves room for the 6 ms steal fades and for the direction rule below. Head-relative voices (no panner) keep
// their cheap throwaway chain.
const STRIP_MAX = 48;
const _strips = [];
function makeStrip() {
  const inp = ctx.createGain();
  const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = ctx.sampleRate / 2; lp.Q.value = 0.7071;
  const g = ctx.createGain();
  const p = ctx.createPanner();
  p.panningModel = _opt.output === "speakers" ? "equalpower" : "HRTF";
  p.distanceModel = "inverse"; p.refDistance = 1; p.rolloffFactor = 0;
  inp.connect(lp); lp.connect(g); g.connect(p); p.connect(sfxBus);
  const ts = ctx.createGain(); ts.gain.value = 0;
  const rs = ctx.createGain(); rs.gain.value = 0;
  if (tailIn) { lp.connect(ts); ts.connect(tailIn); }
  if (roomIn) { lp.connect(rs); rs.connect(roomIn); }
  return { inp, lp, g, p, ts, rs, busy: 0, px: 0, py: -1e6, pz: 0 };
}
// Chrome's HRTF panner does not jump to a new direction: it CROSSFADES its
// convolution kernels over ~45 ms when the azimuth changes (that is what keeps
// a moving source from zippering). A pooled strip moved from "behind-left" to
// "front-right" therefore played the first 45 ms of the next gunshot — its
// whole transient — from the OLD side (probe_core: a 20 m right shot read
// L-R -1.0 dB, left -2.2 dB, against -4.8 / +4.8 with a fresh panner). So a
// strip is only reused for a source within STRIP_COS (~10 deg, as seen from the
// ear) of where it last pointed — a burst, a walking enemy and the next round
// from the same window all qualify — and a new direction gets a new strip while
// the pool has room; past STRIP_MAX the nearest free direction is taken.
const STRIP_COS = Math.cos(10 * Math.PI / 180);
function takeStrip(now, pos) {
  let best = null, bc = -2;
  const vx = pos.x - _L.x, vy = (pos.y || 0) - _L.y, vz = pos.z - _L.z;
  const vl = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1;
  for (let i = 0; i < _strips.length; i++) {
    const st = _strips[i];
    if (st.busy > now) continue;
    const ux = st.px - _L.x, uy = st.py - _L.y, uz = st.pz - _L.z;
    const ul = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1;
    const c = (ux * vx + uy * vy + uz * vz) / (ul * vl);
    if (c > bc) { bc = c; best = st; }
  }
  if (best && (bc >= STRIP_COS || _strips.length >= STRIP_MAX)) return best;
  if (_strips.length >= STRIP_MAX) return null;
  const st = makeStrip(); _strips.push(st);
  return st;
}

/** Send levels for one voice: [tail, room]. The tail falls off far slower than
 *  the direct sound (^0.45 vs ^1.4), so the farther the shot, the more of what
 *  you hear is its echo; a roofed source rings in the room instead. */
function sendLevels(fx, env, dist, maxD, occ) {
  if (!fx) return _sl0;
  const roofed = env ? env.roof : _lisRoof;
  const df = dist == null ? 0 : Math.min(1, dist / (maxD || 60));
  if (roofed && fx.room && roomIn) { _sl[0] = 0; _sl[1] = fx.room * ROOM_SEND * Math.pow(1 - df, 0.7) * OCC_G[occ]; _acc.roomSends++; return _sl; }
  if (!roofed && fx.tail && tailIn) { _sl[0] = fx.tail * TAIL_SEND * Math.pow(1 - df, 0.45) * OCC_G[occ]; _sl[1] = 0; _acc.tailSends++; return _sl; }
  return _sl0;
}
const _sl = [0, 0], _sl0 = [0, 0];

/** Input node for an already-placed cue (place() decided vol / dist). The
 *  returned node is the pool handle's .out (voiceKill fades it, which silences
 *  the dry path AND the sends). __d carries the distance (null = head-relative). */
function spatialOut(pos, vol, dist, fx, env, maxD, h) {
  const occ = env ? env.occ : 0;
  const sl = sendLevels(fx, env, dist, maxD, occ);
  if (pos) {
    const t = ctx.currentTime;
    const st = takeStrip(t, pos);
    if (st) {
      st.px = pos.x; st.py = pos.y || 0; st.pz = pos.z;
      st.busy = t + 5;                       // until voiceArm says when it really ends
      if (h) h.strip = st;
      const gi = st.inp.gain; gi.cancelScheduledValues(t); gi.setValueAtTime(1, t);
      st.lp.frequency.value = occ ? OCC_F[occ] : ctx.sampleRate / 2;
      st.lp.Q.value = occ ? 0.5 : 0.7071;
      st.g.gain.value = vol * OCC_G[occ];
      const py = pos.y || 0;
      if (st.p.positionX) { st.p.positionX.value = pos.x; st.p.positionY.value = py; st.p.positionZ.value = pos.z; }
      else st.p.setPosition(pos.x, py, pos.z);
      st.ts.gain.value = sl[0]; st.rs.gain.value = sl[1];
      st.inp.__d = dist;
      return st.inp;
    }
  }
  // head-relative (own) voices — and a positional one if every strip is busy
  const inp = ctx.createGain();
  let node = inp;
  if (occ > 0) {
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = OCC_F[occ]; lp.Q.value = 0.5;
    inp.connect(lp); node = lp;
  }
  const g = ctx.createGain();
  g.gain.value = vol * OCC_G[occ];
  node.connect(g);
  if (pos) {
    // HRTF answers left/right AND front/back; "speakers" uses equal-power
    // (LC-69). rolloffFactor 0: distance stays on the tuned curve above.
    const p = ctx.createPanner();
    p.panningModel = _opt.output === "speakers" ? "equalpower" : "HRTF";
    p.distanceModel = "inverse"; p.refDistance = 1; p.rolloffFactor = 0;
    const py = pos.y || 0;
    if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = py; p.positionZ.value = pos.z; }
    else p.setPosition(pos.x, py, pos.z);
    g.connect(p); p.connect(sfxBus);
  } else g.connect(sfxBus);      // own-player sounds: head-relative, no panning
  if (sl[0] > 0) { const sg = ctx.createGain(); sg.gain.value = sl[0]; node.connect(sg); sg.connect(tailIn); }
  if (sl[1] > 0) { const sg = ctx.createGain(); sg.gain.value = sl[1]; node.connect(sg); sg.connect(roomIn); }
  inp.__d = dist;
  return inp;
}

// Audible radius by weapon class. A flat 260 m let the shotgun (useless past
// ~20 m) carry 240 m too far while the sniper (105 damage out to 200 m) killed
// from beyond its own report. Distant gunfire is the rotation signal in a BR,
// so the radius tracks the gun's reach. Deliberately NOT in SIM.WEAPONS.
const AUDIBLE_M = { pistol: 220, smg: 200, ar: 320, shotgun: 120, sniper: 520, launcher: 260, dmr: 420, lmg: 360, burst: 320 };
// Beyond this a report also gets its distant BODY (farBoom): the low rolling
// thump that is what is left of a gunshot once the air has taken the crack.
// P23: farBoom is now only the FALLBACK for that - a recorded distant take (below) replaces it.
const FAR_M = 80;

// P23 (LC-08 + LC-16 sound side). One sound profile per gun class: the near take (shot_*), the distant
// layers (gd_<dist>_mid from MID_M, gd_<dist>_far from farFrom(R)), the audible radius R, a playback rate
// and gain, and the synth class shot() falls back to. The three new guns of P2-D (DMR, LMG, burst AR) are
// resolved by id, by cls or by an explicit fire: "burst" (gunSnd), so whatever ids lane sim ships, a gun
// never falls silent: anything unknown sounds like the AR.
const GUN_SND = {
  pistol:   { near: "shot_pistol",  dist: "pistol",  R: 220 },
  smg:      { near: "shot_smg",     dist: "smg",     R: 200 },
  ar:       { near: "shot_ar",      dist: "ar",      R: 320 },
  shotgun:  { near: "shot_shotgun", dist: "shotgun", R: 120 },
  sniper:   { near: "shot_sniper",  dist: "sniper",  R: 520 },
  dmr:      { near: "shot_dmr",     dist: "dmr",     R: 420, synth: "sniper" },              // SKS: a heavier semi-auto crack than the AR
  lmg:      { near: "shot_ar",      dist: "ar",      R: 360, rate: 0.86, g: 1.12, synth: "ar" },   // AK takes a fourth lower = a bigger, slower gun
  burst:    { near: "shot_burst",   dist: "burst",   R: 320, synth: "ar" },                  // AR-15: a brighter 5.56 than the AK
  launcher: { near: null,           dist: null,      R: 260 },
};
const GUN_ALIAS = { dmr: "dmr", marksman: "dmr", lmg: "lmg", mg: "lmg", hmg: "lmg", burst: "burst", burstar: "burst",
                    burst_ar: "burst", ar_burst: "burst", rifle: "ar", glauncher: "launcher" };
/** sound class for a weaponId + its SIM.WEAPONS def (id alias > cls alias > fire "burst" > cls > "ar") */
export function gunSnd(wid, def) {
  const id = String(wid || "").toLowerCase(), cls = String((def && def.cls) || "").toLowerCase();
  let k = GUN_ALIAS[id] || GUN_ALIAS[cls];
  if (!k && def && def.fire === "burst") k = "burst";
  if (!k) k = GUN_SND[cls] ? cls : GUN_SND[id] ? id : "ar";
  return k;
}
const MID_M = 80;                                        // the mid-distance take from here ...
function farFrom(R) { return Math.max(150, 0.5 * R); }  // ... the far one from here (AR 160 m, sniper 260 m)
// Level of each distant layer against the near take, per sound class [mid, far]: the hand-over at MID_M and
// at farFrom(R) is level-continuous (about 1 dB down across it, the distance it covers), so a fight walking
// away never "steps" quieter or louder. Measured on the output tap (P23 mix pass, probe_p23.py "bands",
// loudest-10 ms RMS of the same shot 3-4 m either side of each hand-over; all gains 1.0 gave jumps of
// -10.1 dB (AR at 80 m) to +2.1 dB (AR at 160 m)). The LMG shares the AR takes but not its near level.
const DIST_G = { pistol: [1.64, 2.19], smg: [1.22, 1.57], ar: [2.85, 1.99], shotgun: [1.76, 0], sniper: [1.06, 1.51],
                 dmr: [1.17, 1.62], lmg: [2.16, 1.9], burst: [0.92, 0.99] };   // 0 = no such band for the class
const DIST_G_DEF = [1, 1];

// synth report per class: [lowpass Hz, decay s, gain]
const SHOT_P = {
  pistol: [1400, 0.09, 0.32], smg: [1800, 0.06, 0.28], ar: [1100, 0.12, 0.4],
  shotgun: [700, 0.2, 0.6], sniper: [500, 0.32, 0.66], launcher: [420, 0.24, 0.56],
};
const SHOT_P_DEF = [1200, 0.1, 0.34];

function shot(cls, pos, tier) {
  if (!ctx) return;
  const maxD = AUDIBLE_M[cls] || 260;
  const P = SHOT_P[cls] || SHOT_P_DEF;
  if (place(pos, maxD) < 0) return;
  // crack layer for rifles — near field only: the supersonic crack is a local
  // event, and past ~80 m you should be hearing the muffled report, not the snap
  const crack = (cls === "ar" || cls === "sniper") && (_pd || 0) < 80;
  const h = openVoice(pos, maxD, tier, P[2], crack ? 2 : 1, FX_GUN); if (!h) return;
  const out = h.out;
  const t = h.start;
  const n = ctx.createBufferSource(); n.buffer = noiseBuf();
  const f = ctx.createBiquadFilter(); f.type = "lowpass";
  const g = ctx.createGain();
  // four cheap decorrelators: rate, read window, cutoff, level
  const rate = 0.93 + Math.random() * 0.14;
  n.playbackRate.value = rate;
  const df = out.__d != null ? Math.max(0.12, 1 - out.__d / maxD) : 1;
  n.connect(f); f.connect(g); g.connect(out);
  f.frequency.setValueAtTime(P[0] * (0.92 + Math.random() * 0.16) * (0.25 + 0.75 * df), t);
  f.frequency.exponentialRampToValueAtTime(Math.max(80, P[0] * 0.2 * df), t + P[1]);
  g.gain.setValueAtTime(P[2] * (0.9 + Math.random() * 0.2), t);
  g.gain.linearRampToValueAtTime(0.0001, t + P[1] * 2.2);
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

/** The distant body of a report (d > FAR_M): low noise thump whose length grows
 *  with range, delayed with the report itself. Same tier as the report. */
function farBoom(cls, pos, maxD) {
  if (!ctx) return;
  const k = cls === "sniper" ? 1 : cls === "shotgun" ? 0.9 : cls === "ar" ? 0.8 : 0.55;
  const h = openVoice(pos, maxD, VOICE_TIER.gun, 0.3 * k, 1, FX_GUN); if (!h) return;
  const out = h.out, t = h.start;
  const n = ctx.createBufferSource(); n.buffer = noiseBuf();
  n.playbackRate.value = 0.55 + Math.random() * 0.1;
  const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 260; f.Q.value = 0.7;
  const g = ctx.createGain();
  const dur = 0.22 + 0.25 * Math.min(1, (out.__d || 0) / maxD);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.3 * k, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
  n.connect(f); f.connect(g); g.connect(out);
  n.start(t, Math.random() * 0.4); n.stop(t + dur + 0.02);
  voiceArm(h, out, [n], t + dur + 0.02);
}

function blip(freq, dur, vol, type, pos, maxD, tier, fx) {
  if (!ctx) return;
  const h = openVoice(pos, maxD || 40, tier, vol || 0.2, 1, fx); if (!h) return;
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

function thump(freq, dur, vol, pos, maxD, tier, fx) {
  if (!ctx) return;
  const h = openVoice(pos, maxD || 70, tier, vol, 1, fx); if (!h) return;
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

// Footsteps: stance sets level AND range, and crouch drops the step pitch so it
// reads as a softer footfall rather than merely a quieter one. Crouch costs 28%
// of your speed (sim CROUCH.speedMult 0.72). player.js resolves the stance for
// every actor and bots genuinely crouch; net.js replicates crouch (flag bit 1)
// and P1-D adds sprint — until then a remote's sprint is inferred from its speed.
// P1-B re-tune: with the ear at the head instead of 4.3 m behind it, a step's
// distance is the same in every direction, so the radii were set from the
// front/back AVERAGE the camera-listener gave (11 m crouch read as ~6.7 m in
// front, ~15 m behind): crouch 14 / walk 24 / sprint 36 m.
const STEP = {
  crouch: { g: 0.07, own: 0.04, d: 14, f: 0.85 },
  walk:   { g: 0.13, own: 0.07, d: 24, f: 1.00 },
  sprint: { g: 0.20, own: 0.11, d: 36, f: 1.06 },
};

// The reload sequence is four timers spanning the weapon's full reloadS and none
// of the handles were kept — so swapping weapons or dying midway still played
// the mag-seat clunk and slide rack of a gun you no longer hold.
function cancelReload() { for (let i = 0; i < reloadTimers.length; i++) clearTimeout(reloadTimers[i]); reloadTimers.length = 0; }

function sting(victory) {
  if (!ctx) return;
  const seq = victory ? [523, 659, 784, 1046] : [392, 330, 262];
  // one pooled voice for the whole arpeggio (head-relative -> top tier)
  const h = openVoice(null, 0, VOICE_TIER.own, 0.25, seq.length, null); if (!h) return;
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

// ── mix helpers (LC-53 / LC-69) ─────────────────────────────────────────────
function focusActor() { return W_ ? (W_._camFocus || W_.player || null) : null; }
function isMate(a) {
  const f = W_ && W_.player;
  return !!(a && f && a !== f && a.teamId && a.teamId === f.teamId);
}
/** Enemy fire near you raises the threat envelope (0..1); tick() decays it and
 *  ducks the ambience, the music and the friendly footsteps under it. */
function bumpThreat(v) { if (v > _threat) _threat = Math.min(1, v); }

// maps.surfaceAt label -> footstep cue (every label it returns: grass, concrete, stone, wood, snow, metal, sand, dirt,
// water); anything else, or no surfaceAt, is grass
const STEP_KEY = { grass: "step_grass", wood: "step_wood", snow: "step_snow", stone: "step_concrete", concrete: "step_concrete",
                   sand: "step_sand", dirt: "step_dirt", metal: "step_metal", water: "step_water" };

/** One footstep for actor `a` — the "footstep" event and the remote-step
 *  synthesiser both land here. */
function playStep(a, sprintGuess) {
  const W = W_;
  const sprint = a.sprinting || sprintGuess;
  const s = a.crouching ? STEP.crouch : sprint ? STEP.sprint : STEP.walk;
  const own = a === W.player;
  const mate = !own && isMate(a);
  let k = own ? 1 : mate ? MATE_STEP : ENEMY_STEP;
  if (_opt.mix === "focused") { if (mate) return; if (!own) k *= 1.41; }
  if (own || mate) k *= 1 - 0.4 * _threat;
  _acc.steps++;
  // recorded contact noise beats filtered noise here by a wide margin — a
  // footstep's whole identity is its surface texture. The feet height goes
  // along (LC-52, part): Wave 8's surfaceAt reads house storeys from it.
  const surf = (W.map && W.map.surfaceAt) ? W.map.surfaceAt(a.pos.x, a.pos.z, a.pos.y) : null;
  const keyed = STEP_KEY[surf] || "step_grass";
  // footsteps (yours included) sit below every gunshot in the voice pool
  const gain = (own ? s.own : s.g) * k;
  if (sample(keyed, own ? null : a.pos, gain, s.d, s.f, VOICE_TIER.step, FX_STEP)) return;
  // a surface whose takes have not decoded (blocked fetch, old cache) plays the grass step it played before
  if (keyed !== "step_grass" && sample("step_grass", own ? null : a.pos, gain, s.d, s.f, VOICE_TIER.step, FX_STEP)) return;
  thump((300 + Math.random() * 90) * s.f, 0.055, gain, own ? null : a.pos, s.d, VOICE_TIER.step, FX_STEP);
}

/** Reload foley (mag out, mag in, rack) for any actor; `remote` = synthesised
 *  from a replicated weapon state edge (LC-09). De-duplicated per actor so a
 *  relayed reloadStart (P1-D) and the edge cannot both play it. */
function reloadFoley(a, wpn) {
  const W = W_;
  const own = a === W.player;
  const nowMs = performance.now();
  if (!own && a._audRlT && nowMs - a._audRlT < 600) return;
  a._audRlT = nowMs;
  if (own) cancelReload();
  const def = (W.SIM.WEAPONS[wpn && wpn.id] || {});
  const total = Math.max(0.8, (def.reloadS || 1.5)) * 1000;
  const p2 = own ? null : a.pos, R = 25, k = own ? 1 : 0.6;
  // RECORDED FOLEY FIRST; each beat keeps its thump as the fallback.
  thump(2600, 0.03, 0.22 * k, p2, R);                                       // mag release click
  // `!own && !a.alive` guards: enemy timers are untracked (reloadTimers only
  // collects OWN handles), so an enemy killed mid-reload still played the
  // mag-seat clunk and rack at their corpse
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
}

// ── vocals (P23 / LC-67) ────────────────────────────────────────────────────
// Every body in the game was mute: a hit, a knock and a death were a thud and a damage number. Now each
// actor has ONE voice for the match (female for the athlete and viper skins, else one of two male voices
// by a hash of its id) and grunts on a hit, cries out when knocked, groans when it dies and exhales when it
// is back up. Hurt is rate-limited per actor (an SMG burst is one grunt, not 30) and is queued for one
// frame, so a lethal or knocking hit plays the death / downed cry instead of both. Your own voice is
// head-relative and lower; others are placed at the mouth and ride the acoustics like any foley.
const FEMALE_SKINS = { athlete: 1, viper: 1 };
const VO_P = {
  hurt:   { g: 0.24, own: 0.11, d: 38, gap: 0.6, len: 0.45, tier: VOICE_TIER.step },
  downed: { g: 0.36, own: 0.2,  d: 60, gap: 0,   len: 1.1,  tier: VOICE_TIER.gun },
  death:  { g: 0.34, own: 0.2,  d: 60, gap: 0,   len: 1.2,  tier: VOICE_TIER.gun },
  revive: { g: 0.2,  own: 0.12, d: 30, gap: 0,   len: 0.7,  tier: VOICE_TIER.step },
};
const _mouth = { x: 0, y: 0, z: 0 };
// Per-actor vocal state lives HERE, never as new fields on the actor: stamping a._audVo* on the bots that happen to
// grunt mid-match changed their hidden class, the sim's hot actor loops (bots.js / player.js / loot.js) went
// polymorphic and lost escape analysis - framecheck measured 125-129 KB/frame vs the base's 89-94 on the SAME world
// state (fingerprint identical at t 65.533). actor -> { v: voice key | null, t: last start, end: busy until }
const _voSt = new WeakMap();
function voSt(a) {
  let s = _voSt.get(a);
  if (!s) { s = { v: null, t: -1e9, end: 0 }; _voSt.set(a, s); }
  return s;
}
function voiceOf(a) {
  const st = voSt(a);
  if (st.v) return st.v;
  let v;
  if (a.skin && FEMALE_SKINS[a.skin]) v = "f";
  else {
    const s = String(a.id != null ? a.id : "");
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    v = (h >>> 0) & 1 ? "m2" : "m1";
  }
  if (a.skin) st.v = v;                 // stable once the rig (and so the skin) is known
  return v;
}
function vocal(a, kind, force) {
  const W = W_;
  if (!ctx || !W || !a || a.isDummy || !a.pos) return false;
  const P = VO_P[kind];
  const now = ctx.currentTime;
  const st = voSt(a);
  if (!force && kind === "hurt" && (now - st.t < P.gap || st.end > now)) { _acc.vocalsDropped++; return false; }
  st.t = now; st.end = now + P.len;
  const own = a === W.player;
  let pos = null;
  if (!own) { _mouth.x = a.pos.x; _mouth.y = a.pos.y + (a.downed ? 0.45 : a.crouching ? 1.1 : 1.55); _mouth.z = a.pos.z; pos = _mouth; }
  _acc.vocals++;
  return sample("vo_" + voiceOf(a) + "_" + kind, pos, own ? P.own : P.g, P.d, 1, own ? VOICE_TIER.own : P.tier, own ? null : FX_FOLEY);
}
// hurt grunts wait one frame (see above); wall-clock stamped so a burst emitted inside fastForward never
// plays seconds late
const _hurtQ = [];
function flushHurt() {
  if (!_hurtQ.length) return;
  const wall = performance.now();
  for (let i = 0; i < _hurtQ.length; i += 2) {
    const a = _hurtQ[i];
    if (wall - _hurtQ[i + 1] < 250 && a.alive !== false && !(a.hp <= 0 && !a.downed)) vocal(a, "hurt");
  }
  _hurtQ.length = 0;
}

// ── DBNO cues (P23 / C-DBNO) ─────────────────────────────────────────────────
// Knock: the downed cry + the body hitting the ground; a teammate (or you) going down gets the Apex-style
// alert sting, an enemy YOU knocked a knock-confirm that is distinct from the kill confirm. Revive: a kit /
// bandage rustle every ~0.6 s for the 5 s channel (positional at the downed body), cut on cancel; a revived
// teammate gets a rising chime and their own exhale.
const _rev = new Map();               // target -> { iv, to, reviver }
function stopRevive(target) {
  const r = _rev.get(target);
  if (!r) return false;
  clearInterval(r.iv); clearTimeout(r.to); _rev.delete(target);
  return true;
}
function stopAllRevives() { for (const t of [..._rev.keys()]) stopRevive(t); }
function isOwnTeam(a) { const me = W_ && W_.player; return !!(me && a && (a === me || isMate(a))); }
function teamSting(up) {
  _acc.teamAlerts++;
  const seq = up ? [660, 990] : [880, 587];
  blip(seq[0], 0.09, 0.15, "triangle", null, 0, VOICE_TIER.own);
  setTimeout(() => blip(seq[1], up ? 0.16 : 0.2, 0.15, "triangle", null, 0, VOICE_TIER.own), 85);
  if (up) sample("ui_ok", null, 0.14, 999);
  else thump(160, 0.16, 0.16, null, 0, VOICE_TIER.own, null);
}
function knockConfirm() {
  _acc.knockConfirms++;
  blip(560, 0.06, 0.18, "square", null, 0, VOICE_TIER.own);
  setTimeout(() => blip(420, 0.12, 0.18, "square", null, 0, VOICE_TIER.own), 60);
}
function reviveFoley(reviver, target) {
  if (!target) return;
  stopRevive(target);
  _acc.revives++;
  const me = W_ && W_.player, own = reviver === me || target === me;
  const pos = own ? null : target.pos;
  if (!sample("equip", pos, own ? 0.16 : 0.12, 20, 0.9, VOICE_TIER.step, own ? null : FX_FOLEY)) thump(1400, 0.04, 0.1, pos, 20);
  const step = () => {
    if (!target.alive) { stopRevive(target); return; }
    if (!sample("cloth", pos, own ? 0.15 : 0.11, 20, 0.75 + Math.random() * 0.35, VOICE_TIER.step, own ? null : FX_FOLEY))
      thump(900, 0.06, own ? 0.1 : 0.07, pos, 20, VOICE_TIER.step);
  };
  const iv = setInterval(step, 620);
  const to = setTimeout(() => stopRevive(target), 7000);   // a lost cancel event never rustles forever
  _rev.set(target, { iv, to, reviver });
}

// ── fall damage (P23 / C-FALL) ───────────────────────────────────────────────
// The landing thump (hardLand / touchdown) already plays; a landing that HURT adds a crunch scaled by the
// damage and the grunt (forced past the hurt rate limit: it is one event, not a burst).
function fallCue(a, info) {
  const dmg = typeof info === "number" ? info : (info && (info.dmg != null ? info.dmg : info.damage)) || 0;
  if (!a || !(dmg > 0)) return;
  _acc.falls++;
  const own = a === W_.player, p = own ? null : a.pos;
  const k = Math.min(1, dmg / 60);
  thump(110, 0.2 + 0.15 * k, 0.2 + 0.2 * k, p, 50, own ? VOICE_TIER.own : VOICE_TIER.step, own ? null : FX_FOLEY);
  sample("imp_wood", p, 0.16 + 0.14 * k, 30, 0.5, own ? VOICE_TIER.own : VOICE_TIER.step, own ? null : FX_FOLEY);
  // player.js emits fallDamage BEFORE it applies the hp: a fall that kills or knocks cries via
  // actorDied / actorDowned instead, so it never grunts AND cries
  if (a.alive !== false && !a.downed && !(a.hp - dmg <= 0)) vocal(a, "hurt", true);
}

// ── smoke (P23 / C-SMOKE) ────────────────────────────────────────────────────
// W.smokes [{x, y, z, r, t0, t1}] is weapons.js's (lane sim). A new entry = a canister that just popped: a
// metallic pop and a ~5 s pressurised hiss at the cloud, positional (you hear WHERE the smoke went down).
// Read only; scanned at the 4 Hz rate and also on a "smokeLanded" / "smokeDeployed" event if one exists.
// Only clouds younger than 1 s are voiced (a late joiner does not hear every smoke of the match).
const _smokeSeen = new WeakMap();
function smokeScan(W) {
  const L = W.smokes;
  if (!L || !L.length) return;
  for (let i = 0; i < L.length; i++) {
    const s = L[i];
    if (!s || typeof s !== "object" || _smokeSeen.get(s) === s.t0) continue;
    _smokeSeen.set(s, s.t0);
    if (W.t != null && s.t0 != null && W.t - s.t0 > 1.0) continue;
    smokePop(s);
  }
}
function smokePop(s) {
  if (!ctx || !s || !isFinite(s.x) || !isFinite(s.z)) return;
  _acc.smokes++;
  const pos = { x: s.x, y: (isFinite(s.y) ? s.y : 0) + 0.3, z: s.z };
  blip(190, 0.05, 0.16, "square", pos, 60, VOICE_TIER.step, FX_FOLEY);
  sample("imp_metal", pos, 0.14, 60, 0.7, VOICE_TIER.step, FX_FOLEY);
  const h = openVoice(pos, 55, VOICE_TIER.step, 0.2, 1, FX_FOLEY); if (!h) return;
  // the canister vents for seconds while the cloud builds (PUBG / Warzone smokes hiss ~5 s): hold, then a long fade
  const out = h.out, t = h.start, dur = 5.5;
  const n = ctx.createBufferSource(); n.buffer = noiseBuf(); n.loop = true;
  n.playbackRate.value = 0.9 + Math.random() * 0.15;
  const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.Q.value = 0.7;
  f.frequency.setValueAtTime(5200, t); f.frequency.exponentialRampToValueAtTime(2400, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.2, t + 0.06);
  g.gain.setValueAtTime(0.2, t + 1.8); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
  n.connect(f); f.connect(g); g.connect(out);
  n.start(t); n.stop(t + dur + 0.02);
  voiceArm(h, out, [n], t + dur + 0.02);
}

// ── chest shimmer (P2-J) ─────────────────────────────────────────────────────
// The nearest UNOPENED chest (or supply crate) within SHIM_R hums: a soft, beating, twinkling tone at the
// chest - the Fortnite rule that you can find a chest by ear, through a wall (muffled by the same occlusion
// test as every source). One persistent bed (3 oscillators + panner), retuned at 4 Hz; stopped when no chest
// has been in range for 2 s. The chest list comes from lane loot's accessor W.nearbyChests(pos, r, out)
// (P2-H, allocation-free); until that merges, the W.debugChests() hook (refreshed once a second) stands in.
const SHIM_R = 12;
const _chOut = [];
let shimmer = null, _shimIdle = 0, _chFallL = null, _chFallT = -1e9;
function nearestChest(W, p) {
  let L = null, n = 0;
  if (typeof W.nearbyChests === "function") {
    // P2-H contract: fills the first N records of _chOut (reused; records past N are STALE) and returns N
    let r = null;
    try { r = W.nearbyChests(p, SHIM_R, _chOut); } catch (e) { r = null; }
    if (typeof r === "number") { L = _chOut; n = Math.min(r, _chOut.length); }
    else if (Array.isArray(r)) { L = r; n = r.length; }
  } else if (typeof W.debugChests === "function") {
    const now = performance.now();
    if (!_chFallL || now - _chFallT > 1000) { try { _chFallL = W.debugChests(); } catch (e) { _chFallL = null; } _chFallT = now; }
    L = _chFallL; n = L ? L.length : 0;
  }
  if (!L) return null;
  let best = null, bd = SHIM_R * SHIM_R;
  for (let i = 0; i < n; i++) {
    const c = L[i];
    if (!c || c.opened) continue;
    const q = c.pos || c;
    const dx = q.x - p.x, dz = q.z - p.z, dy = (q.y || 0) - p.y, d2 = dx * dx + dz * dz + dy * dy;
    if (d2 < bd) { bd = d2; best = q; }
  }
  return best;
}
function makeShimmer() {
  const out = ctx.createGain(); out.gain.value = 0;
  const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 9000; lp.Q.value = 0.5;
  const pan = ctx.createPanner();
  pan.panningModel = _opt.output === "speakers" ? "equalpower" : "HRTF"; pan.distanceModel = "inverse"; pan.refDistance = 1; pan.rolloffFactor = 0;
  const mix = ctx.createGain(); mix.gain.value = 0.5;
  const oscs = [];
  for (const [f, g] of [[1568, 0.5], [1576, 0.35], [2352, 0.22]]) {      // G6 + a beating twin + the fifth above
    const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = f;
    const og = ctx.createGain(); og.gain.value = g;
    o.connect(og); og.connect(mix); oscs.push(o);
  }
  // twinkle: a 6.5 Hz tremolo on the cluster
  const lfo = ctx.createOscillator(); lfo.frequency.value = 6.5;
  const lg = ctx.createGain(); lg.gain.value = 0.35;
  lfo.connect(lg); lg.connect(mix.gain); oscs.push(lfo);
  mix.connect(lp); lp.connect(out); out.connect(pan); pan.connect(sfxBus);
  const t = ctx.currentTime;
  for (const o of oscs) o.start(t);
  _acc.shimmerOn++;
  return { out, lp, pan, oscs, x: 1e9, y: 1e9, z: 1e9, level: 0, d: null, w: -1 };
}
function stopShimmer() {
  if (!shimmer) return;
  const t = ctx ? ctx.currentTime : 0;
  try { shimmer.out.gain.cancelScheduledValues(t); shimmer.out.gain.setTargetAtTime(0, t, 0.05); } catch (e) {}
  for (const o of shimmer.oscs) { try { o.stop(t + 0.3); } catch (e) {} }
  shimmer = null;
}
function chestShimmer(W, dt) {
  const f = W.player;
  const live = (W.phase === "match") && f && f.alive && !f.gliding && !f.downed && f.pos;
  const c = live ? nearestChest(W, f.pos) : null;
  if (!c) {
    if (shimmer) {
      if (shimmer.w !== 0) { shimmer.w = 0; shimmer.out.gain.setTargetAtTime(0, ctx.currentTime, 0.15); }
      shimmer.level = 0; shimmer.d = null;
      _shimIdle += dt;
      if (_shimIdle > 2) stopShimmer();
    }
    return;
  }
  _shimIdle = 0;
  if (!shimmer) shimmer = makeShimmer();
  const pos = { x: c.x, y: (c.y || 0) + 0.5, z: c.z };
  const vol = place(pos, SHIM_R + 2);
  const d = _pd;
  if (vol < 0) { shimmer.w = 0; shimmer.out.gain.setTargetAtTime(0, ctx.currentTime, 0.15); return; }
  const env = sourceEnv(pos, FX_FOLEY);
  const want = SHIM_G * vol * OCC_G[env.occ];
  const t = ctx.currentTime;
  if (Math.abs(want - shimmer.w) > 0.0005) { shimmer.w = want; shimmer.out.gain.setTargetAtTime(want, t, 0.2); }
  const fc = env.occ ? OCC_F[env.occ] : 9000;
  if (shimmer.lp.frequency.value !== fc) shimmer.lp.frequency.setTargetAtTime(fc, t, 0.1);
  if (Math.abs(pos.x - shimmer.x) + Math.abs(pos.z - shimmer.z) + Math.abs(pos.y - shimmer.y) > 0.05) {
    shimmer.x = pos.x; shimmer.y = pos.y; shimmer.z = pos.z;
    if (shimmer.pan.positionX) { shimmer.pan.positionX.value = pos.x; shimmer.pan.positionY.value = pos.y; shimmer.pan.positionZ.value = pos.z; }
    else shimmer.pan.setPosition(pos.x, pos.y, pos.z);
  }
  shimmer.level = want; shimmer.d = d;
}
// shimmer level at the chest (before distance), P23 mix pass: at 4 m its tone sits ~10 dB over the wind / storm beds in
// its band and ~14 dB under a walking step at 3 m - findable by ear, never masking a step (0.05 measured 20 dB under)
const SHIM_G = 0.1;

// ── settings engine (LC-69) ─────────────────────────────────────────────────
/** "headphones" (HRTF, the default) | "speakers" (equal-power panning: HRTF's
 *  ear filtering sounds phasey over two speakers). Applies to new voices and
 *  to the live storm bed. */
export function setOutput(mode) {
  _opt.output = mode === "speakers" ? "speakers" : "headphones";
  if (W_ && W_.settings) W_.settings.audioOutput = _opt.output;
  const model = _opt.output === "speakers" ? "equalpower" : "HRTF";
  if (stormBed && stormBed.pan) { try { stormBed.pan.panningModel = model; } catch (e) {} }
  if (shimmer && shimmer.pan) { try { shimmer.pan.panningModel = model; } catch (e) {} }
  for (let i = 0; i < _strips.length; i++) { try { _strips[i].p.panningModel = model; } catch (e) {} }
  return _opt.output;
}
/** "default" | "focused" (the Apex-style competitive mix: your own gun 3 dB
 *  down, teammates' steps gone, enemy steps 3 dB up, ambience and music down). */
export function setMix(mode) {
  _opt.mix = mode === "focused" ? "focused" : "default";
  if (W_ && W_.settings) W_.settings.audioMix = _opt.mix;
  return _opt.mix;
}
/** Mono downmix of the whole output (one-ear listeners, a single speaker). */
export function setMono(on) {
  _opt.mono = !!on;
  if (W_ && W_.settings) W_.settings.audioMono = _opt.mono;
  applyMono();
  return _opt.mono;
}
function applyMono() {
  if (!monoNode) return;
  try {
    if (_opt.mono) { monoNode.channelCount = 1; monoNode.channelCountMode = "explicit"; monoNode.channelInterpretation = "speakers"; }
    else { monoNode.channelCount = 2; monoNode.channelCountMode = "max"; monoNode.channelInterpretation = "speakers"; }
  } catch (e) {}
}

// ── event wiring ─────────────────────────────────────────────────────────────
function wire(W) {
  const on = W.events.on;
  // first user gesture unlocks the context
  const unlock = () => {
    const c = ensureCtx(W);       // null without Web Audio (LC-87): music still plays below
    if (c) {
      if (c.state === "suspended") { try { const p = c.resume(); if (p && p.catch) p.catch(() => {}); } catch (e) {} }
      loadSfx(W);                 // the CC0 one-shots, decoded once
    }
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
  // inside touchend or click; a touch's pointerdown is too early there.
  window.addEventListener("touchend", unlock, { once: false, passive: true });
  // A backgrounded tab kept playing at full volume — suspend on hide, restore on show.
  document.addEventListener("visibilitychange", () => {
    const hidden = document.visibilityState === "hidden";
    for (const k in _tr) { const r = _tr[k]; if (r.el) r.el.volume = hidden ? 0 : trackLevel(W, r); }
    if (ctx) { if (hidden) { try { ctx.suspend(); } catch (e) {} } else { try { ctx.resume(); } catch (e) {} } }
  });

  on("shotFired", (a, weaponId, eye) => {
    const def = W.SIM.WEAPONS[weaponId];
    const k = gunSnd(weaponId, def), G = GUN_SND[k];
    const cls = G.synth || k;                 // the synth / farBoom class
    const own = a === W.player;
    const maxD = G.R;
    // recorded report first (multi-take round-robin + sample()'s rate jitter),
    // synth shot() verbatim when the class has no recording (launcher) or the
    // pack failed to decode. Per-class audible radius (sample() reports
    // "handled" when place() culls beyond maxD). Voice pool tier: your own
    // report is top tier; an enemy's outranks footsteps and impacts.
    const tier = own ? VOICE_TIER.own : VOICE_TIER.gun;
    const pos = own ? null : eye;
    const g = (own ? (_opt.mix === "focused" ? 0.35 : 0.5) : 0.4) * (G.g || 1);
    // P23 (LC-08): beyond MID_M the report is a DISTANT recording (mid, then far), never the close-mic take
    // darkened - that is what a gunshot 150 m away actually sounds like. Falls back to the near take until
    // the late wave has decoded (sample() returns false for an undecoded clip).
    let distant = false;
    if (!own && eye && G.dist && ctx && place(eye, maxD) >= 0 && _pd >= MID_M) {
      // a band whose DIST_G level is 0 does not exist for that class (shotgun far): the band below it carries on.
      // (The old `[..] || 1` turned that 0 into full level.) A class missing from DIST_G plays both bands at 1.
      const dg = DIST_G[k] || DIST_G_DEF;
      const band = _pd >= farFrom(maxD) && dg[1] > 0 && SFX["gd_" + G.dist + "_far"] ? "far" : "mid";
      const key = "gd_" + G.dist + "_" + band, dgain = dg[band === "far" ? 1 : 0];
      if (dgain > 0 && SFX[key] && sample(key, pos, g * dgain, maxD, G.rate, tier, FX_GUN_DIST)) { distant = true; _acc[band === "far" ? "distFar" : "distMid"]++; }
    }
    if (!distant && !(G.near && sample(G.near, pos, g, maxD, G.rate, tier, FX_GUN))) shot(cls, pos, tier);
    if (own) duckFireShot();
    else if (ctx && eye && place(eye, maxD) >= 0) {
      if (_pd > FAR_M && !distant) farBoom(cls, eye, maxD);
      if (!isMate(a)) bumpThreat(Math.max(0, 1 - _pd / 120));
    }
  });
  // reload = mechanical sequence, not beeps: mag release click → mag drop →
  // mag seat clunk (timed to the weapon's reloadS) → slide rack near the end.
  // Enemy reloads are positional at <= 25 m and mixed at 0.6x of your own.
  on("reloadStart", (a, wpn) => reloadFoley(a, wpn));
  on("reloadDone", (a) => {
    const own = a === W.player;
    if (own) cancelReload();
    thump(1800, 0.03, own ? 0.14 : 0.09, own ? null : a.pos, 25);
  });
  on("dryFire", (a) => { if (a === W.player) blip(300, 0.05, 0.12, "square"); });
  // Hurt / hit material (LC-55). YOUR hit on someone: a crystalline tink while
  // the damage lands on shield, a body thud once it reaches flesh, a glass
  // break on the hit that empties the shield — head-relative, like the
  // hitmarker (it is feedback, not a world event). Anyone else's shield
  // breaking is a world event at their position. Your own hurt keeps its thud.
  on("actorHurt", (victim, info) => {
    const me = W.player;
    if (victim === me) { thump(600, 0.12, 0.3); bumpThreat(1); }
    const mine = !!(me && info && info.attackerId != null && info.attackerId === me.id && victim !== me);
    if (info.broke) {
      const p2 = (victim === me || mine) ? null : victim.pos;
      if (!sample("shield_break", p2, mine ? 0.3 : 0.34, 50, 1, VOICE_TIER.gun))
        blip(1800, 0.25, 0.2, "sawtooth", p2, 50, VOICE_TIER.gun);
    } else if (mine) {
      if (info.toShield > 0) sample("hit_shield", null, 0.2, 0, 1.0, VOICE_TIER.own, null);
      else sample("hit_flesh", null, 0.32, 0, 1.0, VOICE_TIER.own, null);
    }
    // P23 (LC-67): the hurt grunt, one frame later (flushHurt) so a lethal / knocking hit cries once
    if (info && info.dmg > 0 && victim && !victim.isDummy && _hurtQ.length < 32) _hurtQ.push(victim, performance.now());
  });
  on("actorDied", (victim) => {
    if (victim === W.player) cancelReload();   // do not rack the slide of a corpse's gun
    stopRevive(victim);
    vocal(victim, "death");                    // P23 (LC-67)
    thump(300, 0.3, 0.3, victim === W.player ? null : victim.pos, 90, victim === W.player ? VOICE_TIER.own : VOICE_TIER.gun);
  });
  on("swimState", (a, swimming) => { if (swimming) thump(900, 0.25, 0.25, a === W.player ? null : a.pos, 40); });
  on("swimStroke", (a) => thump(1100, 0.12, 0.15, a === W.player ? null : a.pos, 25));
  // footsteps: see playStep (stance row, teammate / enemy mix, surface)
  on("footstep", (a) => playStep(a, false));
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
  // Bullet impacts: how you learn you MISSED and what you hit instead. Short
  // and quiet so a full-auto burst does not become a wall of noise.
  on("impact", (pos, surface) => {
    if (surface === "flesh") return;            // the hitmarker already covers this
    // one voice per 35 ms window (a 9-pellet shotgun into a wall fired 9)
    if (!ctx || ctx.currentTime - lastImpactT < 0.035) return;
    lastImpactT = ctx.currentTime;
    const jf = 0.88 + Math.random() * 0.24;     // decorrelate the survivors
    const impKey = surface === "stone" ? "imp_stone" : surface === "wood" ? "imp_wood"
                 : surface === "metal" ? "imp_metal" : surface === "glass" ? "imp_glass" : "imp_dirt";
    const TI = VOICE_TIER.impact;               // first to go when a firefight fills the pool
    if (sample(impKey, pos, 0.09, 55, jf, TI)) return;
    if (surface === "stone") blip(2100 * jf, 0.045, 0.07, "square", pos, 55, TI);
    else if (surface === "wood") blip(900 * jf, 0.06, 0.07, "triangle", pos, 55, TI);
    else thump(260 * jf, 0.07, 0.06, pos, 45, TI);  // dirt
  });
  // Supersonic crack of a round passing you (weapons.js emits the point of
  // CLOSEST APPROACH). Rate-limited like impacts.
  on("whizBy", (pos, missM) => {
    bumpThreat(1);
    if (!ctx || ctx.currentTime - lastWhizT < 0.06) return;
    lastWhizT = ctx.currentTime;
    const wg = 0.4 / (1 + (missM || 0) * 0.6);
    const h = openVoice(pos, 12, VOICE_TIER.gun, wg, 1, null); if (!h) return;
    const out = h.out, t = h.start;
    const n = ctx.createBufferSource(); n.buffer = noiseBuf();
    n.playbackRate.value = 0.9 + Math.random() * 0.3;
    const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.Q.value = 1.4;
    f.frequency.setValueAtTime(3200, t);
    f.frequency.exponentialRampToValueAtTime(1200, t + 0.05);
    const g = ctx.createGain();
    g.gain.setValueAtTime(wg, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.055);
    n.connect(f); f.connect(g); g.connect(out);
    n.start(t, Math.random() * 0.9); n.stop(t + 0.07);
    voiceArm(h, out, [n], t + 0.07);
  });
  on("hardLand", (a, speed) => thump(180, 0.22, Math.min(0.4, 0.12 + speed * 0.008), a === W.player ? null : a.pos, 60));
  on("propBreak", (p2) => { blip(320, 0.16, 0.22, "square", p2, 60); setTimeout(() => blip(210, 0.2, 0.16, "square", p2, 60), 70); });
  on("supplyDropLanded", (p2) => { thump(140, 0.5, 0.4, p2, 240, VOICE_TIER.gun, FX_BOOM); setTimeout(() => blip(880, 0.5, 0.18, "triangle", p2, 240, VOICE_TIER.gun), 160); });
  on("chestOpened", (a, c) => { blip(660, 0.3, 0.14, "triangle", a === W.player ? null : c.pos, 40); setTimeout(() => blip(990, 0.4, 0.12, "triangle", a === W.player ? null : c.pos, 40), 120); });
  on("pickedUp", (a) => { const own = a === W.player; blip(840, 0.07, own ? 0.12 : 0.07, "sine", own ? null : a.pos, 16); });
  on("healStart", (a) => { const own = a === W.player; blip(520, 0.3, own ? 0.1 : 0.08, "sine", own ? null : a.pos, 20); });
  on("healed", (a) => { const own = a === W.player; blip(700, 0.25, own ? 0.14 : 0.09, "sine", own ? null : a.pos, 20); });
  // scopeState re-fires EVERY FRAME (player.js) — latch the edge or it machine-guns
  on("scopeState", (s) => { if (!!s === _scoped) return; _scoped = !!s; blip(_scoped ? 1500 : 1100, 0.035, 0.09, "square"); });
  // Explosion (LC-55): the recorded blast (Kenney CC0 thump + rumble), delayed
  // and tailed like a report; the synth thump is the fallback. The music duck
  // only for a blast you can HEAR.
  on("explosion", (pos) => {
    if (!sample("explosion", pos, 0.8, 260, 1, VOICE_TIER.gun, FX_BOOM)) thump(180, 0.6, 0.7, pos, 200, VOICE_TIER.gun, FX_BOOM);
    if (W.camShake > 0.2) thump(90, 0.8, 0.5);
    if (ctx && place(pos, 260) >= 0) { duckBlast(); bumpThreat(Math.max(0, 1 - _pd / 150)); }
  });
  on("stormWarning", () => siren(W, 2));
  on("stormClosing", () => siren(W, 3));
  on("stormTick", () => blip(140, 0.3, 0.14, "sawtooth"));
  on("playerStormState", (inStorm) => { if (inStorm) thump(200, 0.5, 0.25); });
  on("stormKill", () => {});
  on("supplyDropSpawned", () => { blip(880, 0.2, 0.16, "triangle"); setTimeout(() => blip(1100, 0.3, 0.14, "triangle"), 200); });
  on("landed", (a) => {
    const own = a === W.player;
    thump(500, 0.15, own ? 0.25 : 0.14, own ? null : a.pos, 60);
  });
  on("jump", (a) => { if (a === W.player) thump(300, 0.09, 0.16); });
  // mantle: cloth scrape + a low effort thump; positional for others at close range
  on("mantle", (a) => {
    const own = a === W.player, p2 = own ? null : a.pos;
    if (!sample("cloth", p2, own ? 0.3 : 0.2, 18)) thump(900, 0.06, own ? 0.18 : 0.1, p2, 18);
    thump(240, 0.1, own ? 0.2 : 0.12, p2, 18);
  });
  on("touchdown", (a, speed) => {
    const k = Math.min(1, (speed || 4) / 14);
    thump(360 - k * 120, 0.10 + k * 0.06, 0.12 + k * 0.14, a === W.player ? null : a.pos, 40);
  });
  // UI (LC-95): the four Kenney UI clips that sat decoded but unreachable are
  // wired to the events that mean them — back (Esc), close (big map), ok
  // (level up), error (a squad refusal or a lost host); squad chat ticks.
  on("uiClick", () => { if (!sample("ui_click", null, 0.3, 999)) blip(900, 0.04, 0.12, "square"); });
  on("escPressed", () => { if (!sample("ui_back", null, 0.28, 999)) blip(600, 0.05, 0.1, "square"); });
  on("toggleBigMap", () => { if (!sample("ui_close", null, 0.24, 999)) blip(700, 0.05, 0.1, "sine"); });
  on("levelUp", () => { if (!sample("ui_ok", null, 0.32, 999)) blip(1100, 0.12, 0.14, "triangle"); });
  on("squadRefused", () => { if (!sample("ui_err", null, 0.3, 999)) blip(220, 0.18, 0.14, "square"); });
  on("hostLost", () => { if (!sample("ui_err", null, 0.3, 999)) blip(220, 0.18, 0.14, "square"); });
  on("chatMsg", () => { sample("ui_click", null, 0.16, 999); });
  on("countdownBeep", (final) => blip(final ? 1200 : 800, final ? 0.3 : 0.12, 0.2, "square"));
  // Ping (P1-D emits it): a bright two-note chirp, head-relative like Apex's —
  // a ping is a message, not a world sound. Teammates' pings a touch softer.
  // Accepts any payload shape (pos / {x,z} / {by, kind}); only the owner matters.
  on("pingPlaced", (p) => {
    _acc.pings++;
    const fromMe = !p || p.own || p.local || (W.player && (p.by === W.player.id || p.owner === W.player.id || p.from === W.player.id || p.actor === W.player));
    const g = fromMe ? 0.16 : 0.12, danger = p && (p.kind === "enemy" || p.kind === "danger");
    // P23: a big-map PIN (a waypoint, not a callout) is one soft low note; a world ping keeps the chirp
    if (p && p.kind === "pin") { blip(880, 0.12, g * 0.8, "sine", null, 0, VOICE_TIER.own); return; }
    blip(danger ? 1320 : 1180, 0.07, g, "triangle", null, 0, VOICE_TIER.own);
    setTimeout(() => blip(danger ? 990 : 1570, 0.11, g * 0.85, "triangle", null, 0, VOICE_TIER.own), 70);
  });
  // ── P23: DBNO (C-DBNO), fall damage (C-FALL), smoke (C-SMOKE), chest shimmer (P2-J) ──
  on("actorDowned", (a, src) => {
    if (!a) return;
    _acc.downed++;
    stopRevive(a);
    vocal(a, "downed");
    const own = a === W.player;
    thump(210, 0.24, own ? 0.24 : 0.2, own ? null : a.pos, 50, own ? VOICE_TIER.own : VOICE_TIER.gun, own ? null : FX_FOLEY);
    const me = W.player;
    if (me && isOwnTeam(a)) teamSting(false);
    else if (me && src != null && (src === me || src === me.id || src.id === me.id)) knockConfirm();
  });
  on("reviveStart", (reviver, target) => reviveFoley(reviver, target));
  on("reviveCancel", (reviver, target) => {
    // by target; a cancel that names only the reviver stops that reviver's channel
    if (!(target && stopRevive(target)) && reviver) for (const [t, r] of _rev) if (r.reviver === reviver) stopRevive(t);
    _acc.reviveCancels++;
    if (W.player && (reviver === W.player || target === W.player)) blip(300, 0.1, 0.1, "square", null, 0, VOICE_TIER.own);
  });
  on("actorRevived", (a) => {
    if (!a) return;
    _acc.revived++;
    stopRevive(a);
    vocal(a, "revive");
    if (isOwnTeam(a)) teamSting(true);
  });
  on("fallDamage", (a, info) => fallCue(a, info));
  for (const ev of ["smokeLanded", "smokeDeployed", "smokePopped"]) on(ev, (s) => { if (s && typeof s === "object" && isFinite(s.x)) { _smokeSeen.set(s, s.t0); smokePop(s); } });
  on("chestOpened", () => { if (shimmer && W_) chestShimmer(W_, 0); });
}

function siren(W, n) {
  if (!ctx) return;
  const h = openVoice(null, 0, VOICE_TIER.own, 0.16, n, null); if (!h) return;
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
// The storm wall, the biome ambience, the freefall wind, the room probe and
// the music intensity are CONTINUOUS and need a tick. The main loop drives
// update() behind an `if (audioMod.update)` guard, so a self-throttled rAF
// stands in if that call is ever absent; the first external call retires it.
let _extDriven = false, _rafH = 0, _lastTickT = 0, _slowAcc = 0;
let stormBed = null, ambBed = null, ambWater = null, windBed = null;
let _tickMs = 0, _tickN = 0;     // audio tick cost (probe read-back)
const _duckW = [1, 1];           // last ambience / music threat-duck targets written

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
  const t0 = performance.now();
  // The beds need the listener right when NOTHING is firing — standing still in
  // an empty field is precisely when you read the storm wall off its bearing.
  if (W_ && W_.camera) syncListener(W_.camera);
  duckFireRelease(false);   // the trigger has been quiet for the hold -> band back up
  // threat envelope: ~1.5 s decay; ducks ambience (-6 dB) and music (-3 dB)
  _threat *= Math.exp(-Math.min(0.25, dt || 0) / 1.5);
  if (_threat < 0.002) _threat = 0;
  const foc = _opt.mix === "focused";
  const wa = (1 - 0.5 * _threat) * (foc ? 0.5 : 1), wm = (1 - 0.3 * _threat) * (foc ? 0.71 : 1);
  // an automation event per frame piles up on the param timeline: only when it moved
  if (ambBus && Math.abs(wa - _duckW[0]) > 0.004) { _duckW[0] = wa; ambBus.gain.setTargetAtTime(wa, ctx.currentTime, 0.12); }
  if (musicThreat && Math.abs(wm - _duckW[1]) > 0.004) { _duckW[1] = wm; musicThreat.gain.setTargetAtTime(wm, ctx.currentTime, 0.2); }
  stormAudio(W);
  ambience(W);
  windAudio(W);
  musicIntensity(W);              // (the loop seam has its own 100 ms pump + timer)
  remoteActors(W, dt || 0);
  flushHurt();                    // P23: last frame's hurt grunts (see vocal)
  // the probes that cost a lookup rather than a gain write run at 4 Hz
  _slowAcc += dt;
  if (_slowAcc >= 0.25) { const sd = _slowAcc; _slowAcc = 0; roomTone(W); waterTone(W); smokeScan(W); chestShimmer(W, sd); }
  _tickMs += performance.now() - t0; _tickN++;
}

// LC-09: on a guest every bot is netRemote (and on any client every other
// human is): stepActor never runs for them, so they never emitted a footstep
// or a reload — an enemy could walk up behind you in silence. Their position
// still moves (interpRemote lerps them toward each snapshot), so the same
// stride rule stepActor uses (walk 2.4 m / sprint 3.2 m, while moving faster
// than 1.5 m/s) runs here on the DISTANCE they actually covered. Not on
// a.vel: interpRemote clamps it to 12 m/s per axis, and a late snapshot is
// caught up in a few frames far faster than that, so a clamped velocity loses
// the distance of every catch-up (two-client probe: 32% of the host's steps
// when snapshots ran sparse). A jump over 4 m in one frame is a teleport, not
// walking. Pauses between snapshots do not reset the stride (only 0.5 s of
// standing does), and the speed that decides "moving" / "sprinting" is a
// ~0.25 s average of that motion. A remote reload is the replicated
// weapon.state edge (net.js flag bit 4). Sprint is inferred from speed (sim
// walk 6.0 / sprint 8.0 m/s) until P1-D replicates the flag.
function remoteActors(W, dt) {
  const L = W.actors;
  if (!L || !(dt > 0) || (W.phase !== "match" && W.phase !== "drop")) return;
  const k = 1 - Math.exp(-Math.min(dt, 0.1) / 0.25);
  for (let i = 0; i < L.length; i++) {
    const a = L[i];
    if (!a.netRemote || a.isDummy || a === W.player) continue;
    if (!a.alive) { a._audAcc = 0; a._audPx = undefined; continue; }
    const ws = a.weapon ? a.weapon.state : null;
    if (ws === "reloading" && a._audWs !== "reloading" && a._audWs !== undefined) { _acc.remoteReloads++; reloadFoley(a, a.weapon); }
    a._audWs = ws;
    const px = a.pos.x, pz = a.pos.z;
    if (a._audPx === undefined || a.gliding || a.swimming) { a._audPx = px; a._audPz = pz; a._audAcc = 0; a._audSp = 0; a._audStill = 0; continue; }
    const dx = px - a._audPx, dz = pz - a._audPz;
    a._audPx = px; a._audPz = pz;
    let d = Math.sqrt(dx * dx + dz * dz);
    if (d > 4) d = 0;                                     // teleport / first snapshot
    a._audSp = (a._audSp || 0) + (d / Math.min(dt, 0.1) - (a._audSp || 0)) * k;
    if (!a.onGround) continue;
    if (a._audSp > 1.5) {
      a._audStill = 0;
      a._audAcc = (a._audAcc || 0) + d;
      const sprint = !!a.sprinting || a._audSp > 7.0;
      if (a._audAcc >= (sprint ? 3.2 : 2.4)) { a._audAcc = 0; _acc.remoteSteps++; a._audN = (a._audN || 0) + 1; playStep(a, sprint); }
    } else {
      a._audAcc = (a._audAcc || 0) + d;
      a._audStill = (a._audStill || 0) + dt;
      if (a._audStill > 0.5) a._audAcc = 0;
    }
  }
}

// One looping voice for the whole match, positioned at the nearest point on the
// wall, so sound gives you a BEARING on the storm. The siren and the crossing
// thump stay: they are phase punctuation.
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
    pan.panningModel = _opt.output === "speakers" ? "equalpower" : "HRTF"; pan.distanceModel = "inverse"; pan.refDistance = 1; pan.rolloffFactor = 0;
    src.connect(filt); filt.connect(gain); gain.connect(pan); pan.connect(sfxBus);
    src.start();
    stormBed = { src, filt, gain, pan, w: -1, inS: null, x: 1e9, y: 1e9, z: 1e9 };
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
  // write only what moved: three automation events + three param writes a
  // frame were the bed's whole cost, for a wall that moves centimetres
  if (Math.abs(want - stormBed.w) > 0.002) { stormBed.w = want; stormBed.gain.gain.setTargetAtTime(want, t, 0.25); }
  if (inStorm !== stormBed.inS) { stormBed.inS = inStorm; stormBed.filt.frequency.setTargetAtTime(inStorm ? 900 : 500, t, 0.4); }
  const py = p.y + 1;
  if (Math.abs(wx - stormBed.x) + Math.abs(wz - stormBed.z) + Math.abs(py - stormBed.y) > 0.25) {
    stormBed.x = wx; stormBed.y = py; stormBed.z = wz;
    if (stormBed.pan.positionX) { stormBed.pan.positionX.value = wx; stormBed.pan.positionY.value = py; stormBed.pan.positionZ.value = wz; }
    else stormBed.pan.setPosition(wx, py, wz);
  }
}

// LC-68: the drop was silent but for a chute thump — 25-40 s of descent at
// up to 20 m/s with no air. A looping wind bed, head-relative (it is the air
// past YOUR ears), whose level and brightness follow the focus actor's speed;
// under canopy it drops to a soft flutter. Generated noise, no asset.
function windAudio(W) {
  const f = focusActor();
  const live = (W.phase === "drop" || W.phase === "match") && f;
  if (!live) { if (windBed) { try { windBed.src.stop(); } catch (e) {} windBed = null; } return; }
  const gliding = !!(f.gliding && f.alive);
  if (!windBed) {
    if (!gliding) return;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf(); src.loop = true;
    src.playbackRate.value = 0.8;
    const filt = ctx.createBiquadFilter(); filt.type = "bandpass"; filt.frequency.value = 500; filt.Q.value = 0.55;
    const gain = ctx.createGain(); gain.gain.value = 0;
    src.connect(filt); filt.connect(gain); gain.connect(sfxBus);
    src.start();
    windBed = { src, filt, gain, speed: 0, level: 0 };
  }
  const v = f.vel || { x: 0, y: 0, z: 0 };
  const sp = gliding ? Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) : 0;
  // the drop measured 13-20 m/s in freefall and 5.5-8.5 m/s under canopy
  // (P1-B probe_remote), so 22 m/s is full scale
  const k = Math.min(1, sp / 22);
  const want = gliding ? (f.chute ? 0.35 : 1) * (0.02 + 0.22 * k * k) : 0;
  const t = ctx.currentTime;
  windBed.gain.gain.setTargetAtTime(want, t, gliding ? 0.25 : 0.4);
  windBed.filt.frequency.setTargetAtTime(280 + 1700 * k, t, 0.3);
  windBed.speed = sp; windBed.level = want;
}

// Biome -> filtered-noise recipe (generated, no asset budget involved).
const AMBIENCE = {
  forest:   { rate: 0.55, type: "lowpass",  freq: 1800, g: 0.045, gust: 0.07 },
  tropical: { rate: 0.5,  type: "bandpass", freq: 900,  g: 0.040, gust: 0.05 },
  savanna:  { rate: 0.45, type: "bandpass", freq: 500,  g: 0.050, gust: 0.11 },
};

// Between gunshots all three maps were dead air. Non-positional, because wind
// has no bearing. Routed through ambBus, which the threat envelope ducks.
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
    src.connect(filt); filt.connect(gain); gain.connect(ambBus || sfxBus);
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
    src.connect(filt); filt.connect(gain); gain.connect(ambBus || sfxBus);
    src.start();
    ambWater = { src, filt, gain };
  }
  const p = W.player.pos;
  const near = W.map.heightAt(p.x, p.z) < W.map.waterY + 2;
  ambWater.gain.gain.setTargetAtTime(near ? 0.03 : 0, ctx.currentTime, 0.6);
}

// The listener's own roof (4 Hz): decides whether YOUR head-relative sounds
// (own gun, own steps) ring in the room or out into the open. Placed sources
// get the same test at their own position (sourceEnv).
function roomTone(W) {
  if (!_L.ok) return;
  _lisRoof = roofAt(_L.x, _L.y, _L.z);
}

// Pull the score back as the lobby drains so the last fight is carried by
// footsteps; and at ENDGAME_ALIVE alive the endgame track crossfades in (LC-54:
// it used to play only on the results screen, so the final circle ran on the
// same loop that scored the drop, lowpassed).
function musicIntensity(W) {
  if (!W.match) return;
  const thinning = W.phase === "match" || W.phase === "drop";
  const alive = thinning ? W.match.aliveCount() : 99;
  if (thinning && alive <= ENDGAME_ALIVE && _cur && _cur.name === "music_match.mp3") crossfadeTo(W, "music_endgame.mp3", 4);
  if (!musicMix || !musicFilt) return;
  // the victory/defeat sting is its own moment: restore the full band the
  // instant the match is over, or the endgame track plays through the duck
  const want = alive <= 3 ? 0.35 : alive <= 10 ? 0.75 : 1;
  musicMix.gain.setTargetAtTime(want, ctx.currentTime, 1.2);
  // the lowpass was the old stand-in for a final-circle track; the real one
  // plays open (the match loop keeps it only if it is somehow still current)
  const muffle = alive <= 10 && _cur && _cur.name === "music_match.mp3";
  musicFilt.frequency.setTargetAtTime(muffle ? 1400 : 20000, ctx.currentTime, 1.5);
}
