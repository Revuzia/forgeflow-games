/**
 * royale/audio.js — procedural Web Audio SFX (per-class gunshots, builds,
 * impacts, UI) + real music tracks from the owner's catalog (Laser Sequence —
 * darksynth; unique to this game per the no-duplicate-music rule).
 *
 * Positional: every world sound pans by direction relative to the camera and
 * attenuates by distance — gunshots are information (PUBG lesson), so distant
 * shots stay audible to ~250m with a muffled tail.
 *
 * Synthesis keeps SFX weightless (no downloads) and per-class distinct:
 * noise burst + tuned lowpass + envelope, different per weapon class.
 */

let ctx = null, master = null, sfxBus = null, musicEl = null;
let W_ = null;

export function init(W) {
  W_ = W;
  wire(W);
}

function ensureCtx(W) {
  if (ctx) return ctx;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  window.__AUDIO_CTX__ = ctx;   // page mute-bar integration
  master = ctx.createGain();
  master.gain.value = W.settings.masterVol;
  master.connect(ctx.destination);
  sfxBus = ctx.createGain();
  sfxBus.gain.value = W.settings.sfxVol;
  sfxBus.connect(master);
  return ctx;
}

export function setVolumes(W) {
  if (master) master.gain.value = W.settings.masterVol;
  if (sfxBus) sfxBus.gain.value = W.settings.sfxVol;
  if (musicEl) musicEl.volume = W.settings.musicVol * W.settings.masterVol;
}

// ── music ────────────────────────────────────────────────────────────────────
function playTrack(W, name, vol) {
  try {
    if (musicEl) { musicEl.pause(); musicEl = null; }
    musicEl = new Audio(W.assetBase + "assets/audio/" + name);
    musicEl.loop = true;
    musicEl.volume = (vol != null ? vol : 1) * W.settings.musicVol * W.settings.masterVol;
    window.__GAME_AUDIO__ = window.__GAME_AUDIO__ || [];
    window.__GAME_AUDIO__.push(musicEl);
    const p = musicEl.play(); if (p && p.catch) p.catch(() => {});
  } catch (e) {}
}
export function startMenuMusic(W) { playTrack(W, "music_menu.mp3", 0.9); }
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

/** panner+gain by world position relative to camera */
function spatial(pos, maxD) {
  const cam = W_.camera;
  let vol = 1, pan = 0;
  if (pos) {
    const dx = pos.x - cam.position.x, dz = pos.z - cam.position.z;
    const d = Math.hypot(dx, dz, (pos.y || 0) - cam.position.y);
    maxD = maxD || 60;
    if (d > maxD) return null;
    vol = Math.pow(1 - d / maxD, 1.4);
    // Pan: project onto the camera's RIGHT vector.
    // This computed right as (fwd.z, -fwd.x) — the exact NEGATION of the right
    // vector the rest of the game uses (sim.moveBasis gives fwd (-sin,-cos) and
    // right (cos,-sin), i.e. (-fwd.z, fwd.x)), so every positional sound played
    // in the WRONG EAR, at every heading. Gunfire told you to look the wrong way.
    // Also normalise the horizontal projection: looking up or down shrinks
    // fwd's xz length and was silently flattening the pan toward centre.
    const fwd = new W_.THREE.Vector3();
    cam.getWorldDirection(fwd);
    const fl = Math.hypot(fwd.x, fwd.z) || 1;
    const rightX = -fwd.z / fl, rightZ = fwd.x / fl;
    const dl = Math.hypot(dx, dz) || 1;
    pan = Math.max(-1, Math.min(1, (dx * rightX + dz * rightZ) / dl * 0.8));
  }
  const g = ctx.createGain();
  g.gain.value = vol;
  const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  if (p) { p.pan.value = pan; g.connect(p); p.connect(sfxBus); }
  else g.connect(sfxBus);
  return g;
}

function shot(cls, pos) {
  if (!ctx) return;
  const out = spatial(pos, 260); if (!out) return;
  const t = ctx.currentTime;
  const n = ctx.createBufferSource(); n.buffer = noiseBuf();
  const f = ctx.createBiquadFilter(); f.type = "lowpass";
  const g = ctx.createGain();
  n.connect(f); f.connect(g); g.connect(out);
  // gains trimmed ~35% (owner: shooting audio slightly lower)
  const P = {
    pistol: [1400, 0.09, 0.32], smg: [1800, 0.06, 0.28], ar: [1100, 0.12, 0.4],
    shotgun: [700, 0.2, 0.6], sniper: [500, 0.32, 0.66], launcher: [420, 0.24, 0.56],
  }[cls] || [1200, 0.1, 0.34];
  f.frequency.setValueAtTime(P[0], t);
  f.frequency.exponentialRampToValueAtTime(Math.max(80, P[0] * 0.2), t + P[1]);
  g.gain.setValueAtTime(P[2], t);
  g.gain.linearRampToValueAtTime(0.0001, t + P[1] * 2.2);
  n.start(t); n.stop(t + P[1] * 2.4);
  // crack layer for rifles
  if (cls === "ar" || cls === "sniper") {
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
    o.connect(g); g.connect(master);
    o.start(t + i * 0.16); o.stop(t + i * 0.16 + 0.55);
  });
}

// ── event wiring ─────────────────────────────────────────────────────────────
function wire(W) {
  const on = W.events.on;
  // first user gesture unlocks the context
  window.addEventListener("pointerdown", () => { ensureCtx(W); if (ctx.state === "suspended") ctx.resume(); }, { once: false });

  on("shotFired", (a, weaponId, eye) => {
    const def = W.SIM.WEAPONS[weaponId];
    shot(def ? def.cls : "ar", a === W.player ? null : eye);
  });
  // reload = mechanical sequence, not beeps: mag release click → mag drop →
  // mag seat clunk (timed to the weapon's reloadS) → slide rack near the end
  on("reloadStart", (a, wpn) => {
    if (a !== W.player) return;
    const def = (W.SIM.WEAPONS[wpn.id] || {});
    const total = Math.max(0.8, (def.reloadS || 1.5)) * 1000;
    thump(2600, 0.03, 0.22);                                        // mag release click
    setTimeout(() => thump(700, 0.06, 0.16), 110);                  // mag out / drop
    setTimeout(() => { thump(950, 0.05, 0.26); thump(420, 0.09, 0.2); }, total * 0.55); // mag seated
    setTimeout(() => { thump(3000, 0.025, 0.24); setTimeout(() => thump(1400, 0.05, 0.26), 70); }, total * 0.86); // slide rack
  });
  on("reloadDone", (a) => { if (a === W.player) thump(1800, 0.03, 0.14); });
  on("dryFire", (a) => { if (a === W.player) blip(300, 0.05, 0.12, "square"); });
  // (the hitmarker ping lives in ONE place further down — two listeners were
  //  registered on this event, so every hit played a detuned sine+square flam
  //  and a 9-pellet shotgun blast summed 18 phase-coherent oscillators into a
  //  destination with no limiter, which audibly clipped)
  on("actorHurt", (victim, info) => {
    if (victim === W.player) thump(600, 0.12, 0.3);
    if (info.broke) blip(1800, 0.25, 0.2, "sawtooth", victim === W.player ? null : victim.pos, 50);
  });
  on("actorDied", (victim) => thump(300, 0.3, 0.3, victim === W.player ? null : victim.pos, 90));
  on("swimState", (a, swimming) => { if (swimming) thump(900, 0.25, 0.25, a === W.player ? null : a.pos, 40); });
  on("swimStroke", (a) => thump(1100, 0.12, 0.15, a === W.player ? null : a.pos, 25));
  // footsteps: soft surface thud, own steps quieter than nearby enemies'
  on("footstep", (a) => thump(300 + Math.random() * 90, 0.055, a === W.player ? 0.09 : 0.16, a === W.player ? null : a.pos, 24));
  on("weaponEquipped", (a) => { if (a === W.player) blip(640, 0.05, 0.12, "square"); });
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
    if (surface === "stone") blip(2100, 0.045, 0.07, "square", pos, 55);
    else if (surface === "wood") blip(900, 0.06, 0.07, "triangle", pos, 55);
    else thump(260, 0.07, 0.06, pos, 45);       // dirt
  });
  // these three were emitted into the void — no listener anywhere
  on("hardLand", (a, speed) => thump(180, 0.22, Math.min(0.4, 0.12 + speed * 0.008), a === W.player ? null : a.pos, 60));
  on("propBreak", (p2) => { blip(320, 0.16, 0.22, "square", p2, 60); setTimeout(() => blip(210, 0.2, 0.16, "square", p2, 60), 70); });
  on("supplyDropLanded", (p2) => { thump(140, 0.5, 0.4, p2, 240); setTimeout(() => blip(880, 0.5, 0.18, "triangle", p2, 240), 160); });
  on("chestOpened", (a, c) => { blip(660, 0.3, 0.14, "triangle", a === W.player ? null : c.pos, 40); setTimeout(() => blip(990, 0.4, 0.12, "triangle", a === W.player ? null : c.pos, 40), 120); });
  on("pickedUp", (a) => { if (a === W.player) blip(840, 0.07, 0.12, "sine"); });
  on("healStart", (a) => { if (a === W.player) blip(520, 0.3, 0.1, "sine"); });
  on("healed", (a) => { if (a === W.player) blip(700, 0.25, 0.14, "sine"); });
  on("explosion", (pos) => { thump(180, 0.6, 0.7, pos, 200); if (W.camShake > 0.2) thump(90, 0.8, 0.5); });
  on("stormWarning", () => siren(W, 2));
  on("stormClosing", () => siren(W, 3));
  on("stormTick", () => blip(140, 0.3, 0.14, "sawtooth"));
  on("playerStormState", (inStorm) => { if (inStorm) thump(200, 0.5, 0.25); });
  on("stormKill", () => {});
  on("supplyDropSpawned", () => { blip(880, 0.2, 0.16, "triangle"); setTimeout(() => blip(1100, 0.3, 0.14, "triangle"), 200); });
  on("landed", (a) => { if (a === W.player) thump(500, 0.15, 0.25); });
  on("jump", () => {});
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
    o.connect(g); g.connect(master);
    o.start(t + i * 0.5); o.stop(t + i * 0.5 + 0.5);
  }
}
