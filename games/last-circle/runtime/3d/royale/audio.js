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
}

// ── recorded one-shots (Kenney, CC0) ────────────────────────────────────────
// Everything in this file was synthesised, which is fine for tonal cues (blips,
// stings, the storm bed) but obviously fake for the physical ones: a footstep is
// broadband contact noise with a texture that says "grass" or "wood", and no
// amount of filtered noise sells that. These 45 clips are Kenney CC0 (public
// domain, commercial use fine, no attribution required — assets/audio/sfx/,
// 472 KB total), covering exactly the categories synthesis is worst at.
//
// Weapon reports are DELIBERATELY still synthesised: shot() already does
// per-shot decorrelation, range-dependent filtering and a near-field crack
// layer, and a single flat recorded bang would be a downgrade on all three.
//
// Every call site keeps its synth path as a fallback, so a failed decode, a
// blocked fetch or an old cache degrades to exactly today's behaviour rather
// than to silence.
const SFX = {
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
    } catch (e) { /* fall back to synth */ }
  }));
}

/** Play one variant of a logical cue. Returns false if unavailable, so the
 *  caller can run its synth line instead. Routes through the same spatial()
 *  panner + sfxBus as everything else, so sliders and mute still apply. */
function sample(key, pos, gain, maxD, rate) {
  if (!ctx || !sfxBus) return false;
  const list = SFX[key];
  if (!list || !list.length) return false;
  const pick = list[(Math.random() * list.length) | 0];
  const buf = sfxBuf[pick];
  if (!buf) return false;
  // spatial() hands back a GainNode already wired through the HRTF panner into
  // sfxBus, with the distance stashed on __d — so connect straight to it and the
  // clip inherits the same distance curve, panning, mute and slider behaviour as
  // every synthesised voice. null means out of earshot: report handled, because
  // the synth fallback would be inaudible too and must not double-fire.
  const out = spatial(pos, maxD);
  if (!out) return true;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = (rate || 1) * (0.94 + Math.random() * 0.12);
  const g = ctx.createGain();
  g.gain.value = (gain == null ? 0.5 : gain) * (0.9 + Math.random() * 0.2);
  src.connect(g); g.connect(out);
  src.start();
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
function duckMusic() {
  if (!musicDuck) return;
  const t = ctx.currentTime;
  musicDuck.gain.cancelScheduledValues(t);
  musicDuck.gain.setTargetAtTime(0.62, t, 0.02);        // ~-4 dB, 60 ms attack
  musicDuck.gain.setTargetAtTime(1, t + 0.18, 0.15);    // ~400 ms release
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
 *  spatial() rather than from a frame loop so a sound triggered between frames
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

/** panner+gain by world position relative to camera */
function spatial(pos, maxD) {
  const cam = W_.camera;
  let vol = 1, dist = null;
  if (pos) {
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
    if (!isFinite(d) || d > maxD) return null;
    dist = d;
    vol = Math.pow(Math.max(0, 1 - d / maxD), 1.4);
    if (!isFinite(vol)) return null;
  }
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

function shot(cls, pos) {
  if (!ctx) return;
  const maxD = AUDIBLE_M[cls] || 260;
  const out = spatial(pos, maxD); if (!out) return;
  const t = ctx.currentTime;
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
  // gains trimmed ~35% (owner: shooting audio slightly lower)
  const P = {
    pistol: [1400, 0.09, 0.32], smg: [1800, 0.06, 0.28], ar: [1100, 0.12, 0.4],
    shotgun: [700, 0.2, 0.6], sniper: [500, 0.32, 0.66], launcher: [420, 0.24, 0.56],
  }[cls] || [1200, 0.1, 0.34];
  f.frequency.setValueAtTime(P[0] * (0.92 + Math.random() * 0.16) * (0.25 + 0.75 * df), t);
  f.frequency.exponentialRampToValueAtTime(Math.max(80, P[0] * 0.2 * df), t + P[1]);
  g.gain.setValueAtTime(P[2] * (0.9 + Math.random() * 0.2), t);
  g.gain.linearRampToValueAtTime(0.0001, t + P[1] * 2.2);
  // Start at a random window of the buffer, but only as late as the whole tail
  // still fits inside the 1 s of samples — the sniper runs to stop() at t+0.768 s
  // and reads it up to 1.07x fast, so a flat 0..0.7 s offset would have run off
  // the end of the buffer and cut the tail dead mid-envelope on most shots.
  n.start(t, Math.random() * Math.max(0, 1 - P[1] * 2.4 * rate)); n.stop(t + P[1] * 2.4);
  // crack layer for rifles — near field only: the supersonic crack is a local
  // event, and past ~80 m you should be hearing the muffled report, not the snap
  if ((cls === "ar" || cls === "sniper") && (out.__d || 0) < 80) {
    const o = ctx.createOscillator(), og = ctx.createGain();
    o.type = "square"; o.frequency.setValueAtTime(190, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.05);
    og.gain.setValueAtTime(0.18, t); og.gain.linearRampToValueAtTime(0.0001, t + 0.07);
    o.connect(og); og.connect(out); o.start(t); o.stop(t + 0.08);
  }
}

function blip(freq, dur, vol, type, pos, maxD) {
  if (!ctx) return;
  const out = spatial(pos, maxD || 40); if (!out) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type || "sine";
  o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(vol || 0.2, t);
  g.gain.linearRampToValueAtTime(0.0001, t + (dur || 0.1));
  o.connect(g); g.connect(out);
  o.start(t); o.stop(t + (dur || 0.1) + 0.02);
}

function thump(freq, dur, vol, pos, maxD) {
  if (!ctx) return;
  const out = spatial(pos, maxD || 70); if (!out) return;
  const t = ctx.currentTime;
  const n = ctx.createBufferSource(); n.buffer = noiseBuf();
  const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.linearRampToValueAtTime(0.0001, t + dur);
  n.connect(f); f.connect(g); g.connect(out);
  n.start(t); n.stop(t + dur + 0.02);
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
  const t = ctx.currentTime;
  const seq = victory ? [523, 659, 784, 1046] : [392, 330, 262];
  seq.forEach((f2, i) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "triangle"; o.frequency.value = f2;
    g.gain.setValueAtTime(0.0001, t + i * 0.16);
    g.gain.linearRampToValueAtTime(0.25, t + i * 0.16 + 0.03);
    g.gain.linearRampToValueAtTime(0.0001, t + i * 0.16 + 0.5);
    o.connect(g); g.connect(sfxBus || master);
    o.start(t + i * 0.16); o.stop(t + i * 0.16 + 0.55);
  });
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
  // A backgrounded tab kept playing at full volume — you alt-tab away and the
  // match music follows you. Suspend on hide, restore on show.
  document.addEventListener("visibilitychange", () => {
    const hidden = document.visibilityState === "hidden";
    if (musicEl) musicEl.volume = hidden ? 0 : musicLevel(W);
    if (ctx) { if (hidden) { try { ctx.suspend(); } catch (e) {} } else { try { ctx.resume(); } catch (e) {} } }
  });

  on("shotFired", (a, weaponId, eye) => {
    const def = W.SIM.WEAPONS[weaponId];
    shot(def ? def.cls : "ar", a === W.player ? null : eye);
    if (a === W.player) duckMusic();
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
    thump(2600, 0.03, 0.22 * k, p2, R);                                       // mag release click
    const t1 = setTimeout(() => thump(700, 0.06, 0.16 * k, p2, R), 110);      // mag out / drop
    const t2 = setTimeout(() => { thump(950, 0.05, 0.26 * k, p2, R); thump(420, 0.09, 0.2 * k, p2, R); }, total * 0.55); // mag seated
    const t3 = setTimeout(() => {                                             // slide rack
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
    if (info.broke) blip(1800, 0.25, 0.2, "sawtooth", victim === W.player ? null : victim.pos, 50);
  });
  on("actorDied", (victim) => {
    if (victim === W.player) cancelReload();   // do not rack the slide of a corpse's gun
    thump(300, 0.3, 0.3, victim === W.player ? null : victim.pos, 90);
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
    if (sample(keyed, own ? null : a.pos, own ? s.own : s.g, s.d, s.f)) return;
    thump((300 + Math.random() * 90) * s.f, 0.055, own ? s.own : s.g, own ? null : a.pos, s.d);
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
  on("hitMarker", (owner, target, dmg, isHead) => { if (W.player && owner === W.player) blip(isHead ? 1400 : 950, 0.045, 0.16, "square"); });
  // kill confirm: rising two-tone when YOUR target drops
  on("actorDied", (victim, killerId) => {
    if (W.player && killerId === W.player.id) { blip(700, 0.09, 0.2, "triangle"); setTimeout(() => blip(1050, 0.14, 0.22, "triangle"), 90); }
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
    if (sample(impKey, pos, 0.09, 55, jf)) return;
    if (surface === "stone") blip(2100 * jf, 0.045, 0.07, "square", pos, 55);
    else if (surface === "wood") blip(900 * jf, 0.06, 0.07, "triangle", pos, 55);
    else thump(260 * jf, 0.07, 0.06, pos, 45);  // dirt
  });
  // Supersonic crack of a round passing you. weapons.js emits the point of
  // CLOSEST APPROACH, so the HRTF panner puts it beside the correct ear. Rate-
  // limited like impacts: an enemy SMG at 720 rpm would otherwise fire 12 of
  // these a second into your head and mask the shots themselves.
  on("whizBy", (pos, missM) => {
    if (!ctx || ctx.currentTime - lastWhizT < 0.06) return;
    lastWhizT = ctx.currentTime;
    const out = spatial(pos, 12); if (!out) return;
    const t = ctx.currentTime;
    const n = ctx.createBufferSource(); n.buffer = noiseBuf();
    n.playbackRate.value = 0.9 + Math.random() * 0.3;
    const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.Q.value = 1.4;
    f.frequency.setValueAtTime(3200, t);
    f.frequency.exponentialRampToValueAtTime(1200, t + 0.05);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.4 / (1 + (missM || 0) * 0.6), t);       // 0.4 at the ear, 0.13 at 3.5 m
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.055);
    n.connect(f); f.connect(g); g.connect(out);
    // random read window for the same reason shot() does it — a repeated
    // identical 40 ms noise burst combs
    n.start(t, Math.random() * 0.9); n.stop(t + 0.07);
  });
  // these three were emitted into the void — no listener anywhere
  on("hardLand", (a, speed) => thump(180, 0.22, Math.min(0.4, 0.12 + speed * 0.008), a === W.player ? null : a.pos, 60));
  on("propBreak", (p2) => { blip(320, 0.16, 0.22, "square", p2, 60); setTimeout(() => blip(210, 0.2, 0.16, "square", p2, 60), 70); });
  on("supplyDropLanded", (p2) => { thump(140, 0.5, 0.4, p2, 240); setTimeout(() => blip(880, 0.5, 0.18, "triangle", p2, 240), 160); });
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
  on("explosion", (pos) => { thump(180, 0.6, 0.7, pos, 200); if (W.camShake > 0.2) thump(90, 0.8, 0.5); duckMusic(); });
  on("stormWarning", () => siren(W, 2));
  on("stormClosing", () => siren(W, 3));
  on("stormTick", () => blip(140, 0.3, 0.14, "sawtooth"));
  on("playerStormState", (inStorm) => { if (inStorm) thump(200, 0.5, 0.25); });
  on("stormKill", () => {});
  on("supplyDropSpawned", () => { blip(880, 0.2, 0.16, "triangle"); setTimeout(() => blip(1100, 0.3, 0.14, "triangle"), 200); });
  on("landed", (a) => { if (a === W.player) thump(500, 0.15, 0.25); });
  // this was a REGISTERED EMPTY HANDLER — player.js:944 emits "jump" on every
  // takeoff and nothing listened, so jumping made no sound at all. Same story
  // for ordinary landings: "landed" only fires on the parachute touchdown, so
  // the thump below it was a once-per-match sound pretending to be a footfall.
  on("jump", (a) => { if (a === W.player) thump(300, 0.09, 0.16); });
  on("touchdown", (a, speed) => {
    const k = Math.min(1, (speed || 4) / 14);
    thump(360 - k * 120, 0.10 + k * 0.06, 0.12 + k * 0.14, a === W.player ? null : a.pos, 40);
  });
  on("uiClick", () => blip(900, 0.04, 0.12, "square"));
  on("countdownBeep", (final) => blip(final ? 1200 : 800, final ? 0.3 : 0.12, 0.2, "square"));
}

function siren(W, n) {
  if (!ctx) return;
  const t = ctx.currentTime;
  for (let i = 0; i < n; i++) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(520, t + i * 0.5);
    o.frequency.linearRampToValueAtTime(760, t + i * 0.5 + 0.25);
    g.gain.setValueAtTime(0.0001, t + i * 0.5);
    g.gain.linearRampToValueAtTime(0.16, t + i * 0.5 + 0.05);
    g.gain.linearRampToValueAtTime(0.0001, t + i * 0.5 + 0.45);
    o.connect(g); g.connect(sfxBus || master);
    o.start(t + i * 0.5); o.stop(t + i * 0.5 + 0.5);
  }
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
  tick(W, dt);
}

function startTicker(W) {
  if (_extDriven || _rafH) return;
  _lastTickT = performance.now();
  const step = () => {
    _rafH = requestAnimationFrame(step);
    const now = performance.now();
    const d = (now - _lastTickT) / 1000; _lastTickT = now;
    tick(W, d);
  };
  _rafH = requestAnimationFrame(step);
}

function tick(W, dt) {
  if (!ctx || ctx.state !== "running" || !W) return;
  // The one-shot path syncs the listener lazily from spatial(), and own-player
  // sounds pass no position so they do not sync it at all. The beds below need
  // it right when NOTHING is firing — standing still in an empty field is
  // precisely when you read the storm wall off its bearing — so sync here too.
  // The ctx.currentTime guard inside makes the duplicate call free.
  if (W_ && W_.camera) syncListener(W_.camera);
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
