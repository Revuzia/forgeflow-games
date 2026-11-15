#!/usr/bin/env python
"""sfxcheck (w10_sfx) - the Wave 10 R2B sound gate. NO browser: a Node census of the real runtime/3d/royale/audio.js (a recording fake
Web Audio context, every game event fired against the fully decoded pack) plus ffmpeg measurements of the shipped assets/audio/sfx files.

    python _harness/p23/sfxcheck.py --disk                          # the working copy
    python _harness/p23/sfxcheck.py --rev cbf0a1ff1                 # control: the W10 base (25 synth cues, 15 silent events, 1 reload set) - MUST FAIL
    python _harness/p23/sfxcheck.py --disk --plant synth-loot       # the loot pickup is a sine blip again                  - MUST FAIL synth-count
    python _harness/p23/sfxcheck.py --disk --plant mute-grenade     # no grenadeThrown listener                              - MUST FAIL events
    python _harness/p23/sfxcheck.py --disk --plant hot-step         # one footstep take +7 dB in the loudness table          - MUST FAIL loudness
    python _harness/p23/sfxcheck.py --disk --plant no-amb           # the Savanna loses its recorded ambience layers         - MUST FAIL amb-layers
    python _harness/p23/sfxcheck.py --disk --plant no-licence-row   # one new file's AUDIO_SOURCES.md row is dropped         - MUST FAIL licence
    python _harness/p23/sfxcheck.py --disk --plant pcm-lossy        # the smoke vent (a high-passed fizz) held at 16 kHz       - MUST FAIL pcm-rate
    python _harness/p23/sfxcheck.py --disk --plant amb-leak         # a map change no longer frees the other maps' ambience    - MUST FAIL pcm-bounded
    python _harness/p23/sfxcheck.py --disk --plant lazy-hoard       # the lazy decode cache never frees a take                - MUST FAIL pcm-budget
    python _harness/p23/sfxcheck.py --disk --plant lazy-drop        # a lazy take's first use is decoded but never played     - MUST FAIL lazy-play
    python _harness/p23/sfxcheck.py --disk --plant snow-birds       # Deepwood's snow stage keeps the birdsong bed up         - MUST FAIL snow-birds
    python _harness/p23/sfxcheck.py --disk --plant hiss-bed         # the Savanna bed is the pre-fix hiss take (53cd76820)    - MUST FAIL bed-hiss
    python _harness/p23/sfxcheck.py --disk --plant seam-gap         # one ambience loop ends in 30 ms of silence (non-gapless) - MUST FAIL loop-seam
    python _harness/p23/sfxcheck.py --disk --plant clip-hot         # one equip take +12 dB in the loudness table             - MUST FAIL no-clip
    python _harness/p23/sfxcheck.py --disk --plant xcat-hot         # every reload take +8 dB (its family stays level)        - MUST FAIL xcat
    python _harness/p23/sfxcheck.py --disk --plant siren-gone       # the storm warning loses the W9 siren                    - MUST FAIL storm-siren

Rows (PLAN.md Lane R2B acceptance bars):
  synth-count     synthesised one-shot cues <= 8, every one a KEPT tonal cue (hit marker, kill / knock confirm, ping, countdown, UI, team
                  sting): every event (own and other actor) is fired with the pack decoded and each synth source counted by its tone() tag;
                  an untagged synth source is a cue that should be foley
  events          every gameplay event the runtime emits has a non-empty listener in audio.js, except the explicit allowlist (emote) and the
                  W9 R2A door events (PLAN sec 0: door sounds are not planned again in W10 - listed, not silently passed); every event that was
                  silent at the W10 base now starts a sound in the census
  loudness        loudest-50 ms RMS of every take (file level + its CLIP_DB trim) within +-2 dB of its family median (footsteps: one family)
  swap-level      every equip take peaks >= -6 dBFS (file peak + trim)
  reload-classes  >= 4 distinct reload sets, mapped by weapon class (the census: reloadStart of every gun in SIM.WEAPONS, the cues it starts)
  amb-layers      >= 2 RECORDED layers per map theme (AMB_REC), each file present; the census starts them on every map and retires the synth bed
                  (the in-game level / spectrum rows are p23_audiotap's amb-* rows)
  pcm-rate        every PCM_HZ entry (a file held decoded at 16 / 24 kHz) plays back within -30 dB error energy of its 48 kHz decode (the
                  chain: ffmpeg decode at the rate, then LINEAR interpolation to 48 kHz as Chromium's buffer source does), the census decodes
                  it at that rate, and nothing else is held below 48 kHz
  pcm-bounded     the census changes map 3 times: after each change only that map's ambience layers (+ the underwater bed) are decoded
  pcm-budget      decoded PCM the added files put in one session <= 10.0 MB (PLAN R2B Budget "+6-10 MB"), judged TWO ways and both must
                  hold: (a) the bound - the eager added files at their census rates + the lazy cache cap + its largest file + the underwater
                  bed + the largest map's resident ambience; (b) observed - the census decodes with REAL buffer lengths (ffmpeg durations)
                  and the bytes the added files hold are read after every fired event, the lazy probe (every lazy file decoded once through
                  the cache), each map change, the snow stage and a dive; and the runtime's own lazy-cache peak stays inside its bound
                  (W10 R2B fix 3: lazy one-shot decode with an LRU cap; until fix 3 every added file was eager and (a) was the whole row)
  lazy-play       every lazy-take miss in the census (first use) is played as its decode lands: per fired event, recorded starts of lazy
                  files >= the misses it caused, 0 dropped late
  storm-siren     storm warning / closing start the W9 siren (synth tag storm_siren) AND the recorded wall surge under it
  snow-birds      Deepwood in its snow stage: every layer still up has <= 5 % bird-tonal frames (2.5-9 kHz peak >= 25 dB over the band
                  median, within 20 dB of the frame peak), the birdsong bed is down (gain 0) and comes back out of the snow
  bed-hiss        no ambience layer is hiss: 2-12 kHz spectral flatness >= 0.9 (white noise ~1) WITH >= -12 dB of its energy above 5 kHz
  loop-seam       every looping file (ambience layers + the underwater bed) wraps without a click or a gap: the wrap step |x[0]-x[-1]|
                  <= the 99.9th percentile of the file's own |dx|; the 10 ms window across the wrap has <= the 99th percentile 4 kHz+
                  energy of 400 windows inside the file; and the level jump between the last and the first 10 ms <= the 99.9th
                  percentile of the file's own adjacent-10 ms level jumps
  no-clip         no added file is clipped (no run of >= 3 samples at |x| >= 0.98, no sample over 0 dBFS) and no play of one in the census
                  peaks over -1 dBFS in game (file peak + 20 log10 of the call gain x CLIP_DB trim x 1.1 jitter top, before the bus),
                  judged on EVERY take of each played SFX key (fix 4: not only the census pick)
  xcat            loudness matched ACROSS the R2B own-action categories (foley, reload, movement, water, grenade, equip): each category's
                  median in-game level (loudest-50 ms RMS + 20 log10 of the call gain x trim, own plays in the census) within +-3 dB of the
                  median of the category medians. Own footsteps are listed, not judged: their level is the W8 footstep mix (p23_footsteps)
  bytes           sfx added since the W10 base <= 2.0 MB; total assets/audio/sfx <= 3.5 MB
  licence         every sfx file added since the W10 base has an AUDIO_SOURCES.md row with a source and a licence
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import p23lib as L  # noqa: E402
C = L.C

W10_BASE = "cbf0a1ff1"            # the W10 integration base (LIVE_REV cb244268 + gates baseline): "added" / "new" are against this tree
# storm_siren: W10 R2B fix 3 - the W9 storm siren is KEPT (orchestrator ticket 4: the owner did not ask for the siren to change)
KEPT_TONAL = {"hit_marker", "kill_confirm", "knock_confirm", "ping", "countdown", "ui", "team_sting", "storm_siren"}
SYNTH_MAX = 8
ALLOW_SILENT = {"emote": "silent on purpose (PLAN R2B item 7)"}
DEFERRED_W9 = {"doorChanged": "door sounds = W9 R2A (PLAN sec 0, not planned again in W10)", "doorBlocked": "door sounds = W9 R2A (PLAN sec 0)"}
# emitted on W.events but not a gameplay sound moment: plumbing, UI state, or a duplicate of an event that IS voiced
NON_GAMEPLAY = {
    "gfxTier": "graphics tier change", "mapFallback": "map load fallback", "netDropItem": "net relay of an item drop (pickedUp / weaponDropped voice it)",
    "netPing": "net relay of a ping (pingPlaced voices it)", "openOnline": "online menu", "playerDied": "duplicate of actorDied(player)",
    "smokeNet": "net relay of a smoke (smokeScan voices the cloud)", "spectateChanged": "spectator camera", "squadMapFallback": "lobby state",
    "squadRejoin": "lobby state", "touchMode": "input mode", "touchSettings": "settings panel", "tracer": "visual of a shot (shotFired voices it)",
    "useConsumable": "use intent (healStart / the throw voice it)",
}
FORMERLY_SILENT = ["grenadeThrown", "quickThrow", "roundBounce", "slideStart", "slideEnd", "weaponDropped", "supplyDropOpened", "healCancel",
                   "reloadCancel", "teamEliminated", "smokeExpired", "stormPhase", "stormKill"]
LOUD_TOL = 2.0
SWAP_PEAK_MIN = -6.0
RELOAD_SETS_MIN = 4
ADDED_MAX, TOTAL_MAX = 2.0e6, 3.5e6
PCM_SHARE = 0.001               # a file held below 48 kHz: decoded at its rate + linear-interpolated playback at 48 kHz within -30 dB error energy
PLAY_JITTER_MAX = 1.1           # sample(): per-play level x (0.9 + rand x 0.2) - no-clip judges the top of it
PCM_BUDGET = 10.0e6             # PLAN R2B Budget: decoded memory "+6-10 MB" (the top of the estimate)
BIRD_MAX = 0.05
HISS_FLAT, HISS_HF_DB = 0.9, -12.0
XCAT_TOL = 3.0
XCAT_INFO = {"footstep"}      # listed, not judged (the W8 own-footstep mix sits lower on purpose; p23_footsteps owns it)
XCAT = {"footstep": ["step_"], "foley": ["pickup", "chest_open", "heal_start", "heal_done", "drop_open", "weapon_drop"],
        "reload": ["rl_"], "movement": ["jump", "land", "land_hard", "mantle", "slide", "slide_end"], "water": ["splash", "swim"],
        "grenade": ["gren_throw", "gren_pin"], "equip": ["equip"]}
PRE_FIX_REV = "53cd76820"       # the last R2B head before fix 3 (its Savanna bed is the hiss take)

PLANTS = {
    "synth-loot": ("audio", [(r'if (!sample("pickup", own ? null : a.pos, own ? 0.24 : 0.14, 16, 1, own ? VOICE_TIER.own : VOICE_TIER.step, own ? null : FX_FOLEY))',
                              r'if (true)')]),
    "mute-grenade": ("audio", [('on("grenadeThrown", ', 'on("grenadeThrown__planted", ')]),
    "hot-step": ("audio", [("// LOUD-TABLE-END", 'CLIP_DB["step_grass_001"] = (CLIP_DB["step_grass_001"] || 0) + 7;\n// LOUD-TABLE-END')]),
    "no-amb": ("audio", [('savanna:  [["amb_savanna_bed", 0.5], ["amb_savanna_wind", 0.5]],', 'savanna:  [],')]),
    "no-licence-row": ("sources", None),
    "pcm-lossy": ("audio", [("// PCM-TABLE-END", 'PCM_HZ["smoke_hiss_0"] = 16000;\n// PCM-TABLE-END')]),
    "amb-leak": ("audio", [("function ambEvict(th) {\n  if (_ambTheme === th) return;", "function ambEvict(th) {\n  return;")]),
    "lazy-hoard": ("audio", [("function lazyTrim(keep) {\n", "function lazyTrim(keep) {\n  return;\n")]),
    "lazy-drop": ("audio", [("      _lazy.played++;\n      playBuf(", "      _lazy.played++; return;\n      playBuf(")]),
    "snow-birds": ("audio", [("const AMB_SNOW = { forest: { amb_forest_bed: 0, amb_forest_wind: 0.62 } };", "const AMB_SNOW = { forest: { amb_forest_wind: 0.62 } };")]),
    "hiss-bed": ("measure", None),
    "seam-gap": ("measure", None),
    "clip-hot": ("audio", [("// LOUD-TABLE-END", 'CLIP_DB["equip_0"] = (CLIP_DB["equip_0"] || 0) + 12;\n// LOUD-TABLE-END')]),
    "xcat-hot": ("audio", [("// LOUD-TABLE-END", 'for (const k in SFX) if (k.indexOf("rl_") === 0) for (const f of SFX[k]) CLIP_DB[f] = (CLIP_DB[f] || 0) + 8;\n// LOUD-TABLE-END')]),
    "siren-gone": ("audio", [('on("stormWarning", () => { tone("storm_siren", () => siren(W, 2)); ', 'on("stormWarning", () => { ')]),
}

CENSUS_JS = r"""
import fs from "fs"; import path from "path"; import { pathToFileURL } from "url"; import { createRequire } from "module";
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith("--") ? a.concat([[x.slice(2), arr[i + 1]]]) : a), []));
const ROOT = args.root, AUDIO = args.audio, SFXD = path.join(ROOT, "assets/audio/sfx");
const DUR = args.dur ? JSON.parse(fs.readFileSync(args.dur, "utf8")) : {};
const ADDED = new Set(args.added ? JSON.parse(fs.readFileSync(args.added, "utf8")) : []);
const require = createRequire(import.meta.url);
const SIM = require(path.join(ROOT, "runtime/sim/royale.js"));
// ── a recording fake Web Audio ───────────────────────────────────────────────
const PARAMS = new Set(["gain", "frequency", "Q", "detune", "playbackRate", "positionX", "positionY", "positionZ", "orientationX", "orientationY",
  "orientationZ", "forwardX", "forwardY", "forwardZ", "upX", "upY", "upZ", "threshold", "knee", "ratio", "attack", "release", "delayTime", "pan", "offset"]);
class Param { constructor(v) { this.value = v; this.defaultValue = v; } setValueAtTime() { return this; } linearRampToValueAtTime() { return this; }
  exponentialRampToValueAtTime() { return this; } setTargetAtTime() { return this; } cancelScheduledValues() { return this; } cancelAndHoldAtTime() { return this; } }
const REC = { on: false, starts: [] };
let A = null;
function mk(kind) {
  const o = { kind, channelCount: 2, channelCountMode: "max", channelInterpretation: "speakers", buffer: null, loop: false };
  o.connect = (d) => d; o.disconnect = () => {}; o.setPosition = () => {}; o.setOrientation = () => {}; o.stop = () => {};
  o.start = () => { if (!REC.on) return; const b = o.buffer;
    REC.starts.push(kind === "osc" ? { synth: true, tag: A.synthTag() } : b && b.__file ? { file: b.__file, loop: !!o.loop } : { synth: true, tag: A.synthTag(), kind }); };
  return new Proxy(o, { get(t, k) { if (k in t) return t[k]; if (typeof k === "string" && PARAMS.has(k)) { t[k] = new Param(k === "gain" ? 1 : 0); return t[k]; } return undefined; } });
}
class FakeCtx {
  constructor() { this.currentTime = 1; this.sampleRate = 48000; this.state = "running"; this.destination = mk("dest"); this.listener = mk("listener"); }
  createGain() { return mk("gain"); } createBiquadFilter() { return mk("biquad"); } createOscillator() { return mk("osc"); }
  createBufferSource() { return mk("bufsrc"); } createPanner() { return mk("panner"); } createConvolver() { return mk("conv"); }
  createDynamicsCompressor() { return mk("comp"); } createDelay() { return mk("delay"); } createStereoPanner() { return mk("span"); }
  createMediaElementSource() { return mk("media"); } createChannelMerger() { return mk("merge"); } createChannelSplitter() { return mk("split"); }
  createBuffer(ch, len, sr) { const d = new Float32Array(len); return { __gen: true, numberOfChannels: ch, length: len, sampleRate: sr, duration: len / sr, getChannelData: () => d }; }
  decodeAudioData(ab) { return Promise.resolve(fakeBuf(ab.__file, 48000)); }
  resume() { return Promise.resolve(); } suspend() { return Promise.resolve(); }
}
// the W10 R2B store-rate decoders (PCM_HZ): a buffer decoded here carries the decoder's rate, which the pcm rows read back
class FakeOff { constructor(ch, len, sr) { this.sampleRate = sr; }
  decodeAudioData(ab) { return Promise.resolve(fakeBuf(ab.__file, this.sampleRate)); } }
// W10 R2B fix 3: a decoded buffer has the file's REAL length at the decoder's rate (ffmpeg durations, --dur), so the bytes the
// runtime holds (and its lazy cache counts) are the browser's; the samples are zeros, allocated only if read
function fakeBuf(f, sr) {
  const len = Math.max(1, Math.round((DUR[f] || 0.1) * sr)); let d = null;
  return { __file: f, numberOfChannels: 1, length: len, sampleRate: sr, duration: len / sr, getChannelData: () => (d = d || new Float32Array(len)) };
}
const winL = {};
globalThis.window = { AudioContext: FakeCtx, OfflineAudioContext: FakeOff, addEventListener: (n, f) => { (winL[n] = winL[n] || []).push(f); }, removeEventListener() {} };
globalThis.document = { addEventListener() {}, visibilityState: "visible", querySelectorAll: () => [] };
globalThis.requestAnimationFrame = () => 1; globalThis.cancelAnimationFrame = () => {};
globalThis.Audio = class { constructor() { this.paused = true; this.volume = 1; } play() { return Promise.resolve(); } pause() {} addEventListener() {} };
const fetched = [];
globalThis.fetch = async (url) => { const m = /assets\/audio\/sfx\/([^/?]+)\.ogg/.exec(String(url)); if (!m) return { ok: false };
  const p = path.join(SFXD, m[1] + ".ogg"); if (!fs.existsSync(p)) return { ok: false }; fetched.push(m[1]);
  const ab = () => ({ __file: m[1], slice: ab });   // like an ArrayBuffer, slice() gives a copy that can be sliced again
  return { ok: true, arrayBuffer: async () => ab(), blob: async () => ({}) }; };
globalThis.URL.createObjectURL = () => "blob:x";
const realST = setTimeout, realSI = setInterval;
// during a fired event the game's timers go to a queue that is drained in time order right after it (each run a new voice-pool frame:
// the fake wall clock steps 25 ms), so a reload set's later beats or a two-note sting are counted with the event that scheduled them
let SYNC = false, fakeNow = 1000; const Q = [];
Object.defineProperty(globalThis, "performance", { configurable: true, value: { now: () => fakeNow } });
globalThis.setTimeout = (f, ms) => { if (!SYNC) return realST(f, ms); if ((ms || 0) <= 8000) Q.push({ f, at: fakeNow + (ms || 0) }); return 0; };
globalThis.setInterval = (f, ms) => { if (!SYNC) return realSI(f, ms); Q.push({ f, at: fakeNow + (ms || 0) }); return 0; };
const realCT = clearTimeout, realCI = clearInterval;
globalThis.clearTimeout = (h) => { if (h) realCT(h); }; globalThis.clearInterval = (h) => { if (h) realCI(h); };
// ── the world ─────────────────────────────────────────────────────────────────
// W10 R2B fix 4: a seeded Math.random (mulberry32), so the census picks the same takes run to run (the verifier saw the clean
// loudestPlayDb drift -7.65 / -6.58 between runs)
{ let _s = 0x5eed1234 >>> 0; Math.random = () => { _s = (_s + 0x6D2B79F5) >>> 0; let t = _s; t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
A = await import(pathToFileURL(AUDIO).href);
const H = {};
const events = { on: (n, f) => { (H[n] = H[n] || []).push(f); }, emit: (n, ...a) => { for (const f of (H[n] || [])) f(...a); } };
const actor = (id, x, z, team) => ({ id, pos: { x, y: 0, z }, alive: true, teamId: team, skin: "soldier", weapon: { id: "ar", state: "ready" }, vel: { x: 0, y: 0, z: 0 },
  onGround: true, isBot: id !== 1 });
const P = actor(1, 0, 0, "T1"), E = actor(2, 8, 0, "T2"), M = actor(3, -6, 0, "T1");
const W = { events, settings: { masterVol: 1, sfxVol: 1, musicVol: 0, graphics: "high" }, assetBase: ROOT.replace(/\\/g, "/") + "/", SIM, player: P,
  actors: [P, E, M], phase: "match", t: 100, camera: null, camShake: 0, smokes: [],
  map: { K: { theme: "savanna", water: false }, heightAt: () => 0, waterY: -50, colliders: [], surfaceAt: () => "grass",
         queryColliders: (x, z, r, out) => { if (out) { out.length = 0; return out; } return []; } },
  match: { aliveCount: () => 40 } };
A.init(W);
for (const f of (winL.pointerdown || [])) f({});
const T = A.sfxTable(); const want = new Set(); for (const k in T.SFX) for (const n of T.SFX[k]) want.add(n);
const avail = () => { const rb = A.readback(W); return rb.sfxDecoded + (rb.sfxLazy || 0); };
for (let i = 0; i < 200 && avail() < [...want].filter((n) => fs.existsSync(path.join(SFXD, n + ".ogg"))).length; i++) await new Promise((r) => realST(r, 10));
const ctx = globalThis.window.__AUDIO_CTX__;
const decoded = avail();
const LAZYF = new Set(); for (const k of (A.LAZY_KEYS || [])) for (const n of (T.SFX[k] || [])) LAZYF.add(n);
// the bytes the ADDED files hold decoded right now (pack + ambience), the session peak and where it happened
const peak = { bytes: 0, at: null, uwSeen: false, snaps: 0 };
function snap(tag) {
  if (!A.pcmCensus) return; const h = A.pcmCensus().held || {}; let b = 0;
  for (const k in h) if (ADDED.has(k)) b += h[k];
  if (T.UW_BED && h[T.UW_BED]) peak.uwSeen = true;
  peak.snaps++; if (b > peak.bytes) { peak.bytes = b; peak.at = tag; }
}
snap("pack loaded");
// ── the census ────────────────────────────────────────────────────────────────
const cases = [];
// W10 R2B fix 3: async - a lazy take's first use plays when its decode lands (a promise), so the event's microtasks are flushed
// after the emit and after every queued timer, inside the recording window
const flush = () => new Promise((r) => realST(r, 0));
const lazyMiss = () => (A.readback(W).lazy || {}).miss || 0;
async function fire(label, ev, ...a) {
  ctx.currentTime += 3; A.update(W, 0.02);
  REC.starts = []; REC.on = true; SYNC = true; fakeNow += 25;
  const m0 = lazyMiss(); if (A.levelTap) A.levelTap(true);
  let err = null; try { events.emit(ev, ...a); } catch (e) { err = String(e && e.stack || e); }
  await flush();
  for (let n = 0; Q.length && n < 60; n++) {
    Q.sort((x, y) => x.at - y.at); const q = Q.shift();
    const dt = Math.max(0, q.at - fakeNow); fakeNow = Math.max(fakeNow, q.at) + 25; ctx.currentTime += dt / 1000;
    try { q.f(); } catch (e) { err = err || String(e && e.stack || e); }
    await flush();
  }
  Q.length = 0; SYNC = false; REC.on = false;
  const lv = A.levelTap ? (A.levelTap(false) || []) : [];
  const st = REC.starts.slice();
  cases.push({ label, ev, err, starts: st, lazyMiss: lazyMiss() - m0, lazyStarts: st.filter((x) => x.file && LAZYF.has(x.file)).length, levels: lv });
  snap("event " + label);
}
const who = [["own", P], ["other", E]];
const guns = Object.keys(SIM.WEAPONS).filter((k) => SIM.WEAPONS[k].cls && SIM.WEAPONS[k].cls !== "throwable");
for (const g of guns) {
  await fire("shot own " + g, "shotFired", P, g, { x: 0, y: 1.6, z: 0 });
  for (const d of [10, 120, 300]) await fire("shot " + d + "m " + g, "shotFired", E, g, { x: d, y: 1.6, z: 0 });
}
const reloads = {};
for (const g of guns) {
  for (const [w, a] of who) { a._audRlT = 0; a.weapon = { id: g, state: "reloading" }; await fire("reload " + w + " " + g, "reloadStart", a, a.weapon);
    if (w === "own") reloads[g] = { cls: SIM.WEAPONS[g].cls, cues: cases[cases.length - 1].starts.map((s) => s.file || ("synth:" + s.tag)) }; }
}
P.weapon = E.weapon = { id: "ar", state: "ready" };
const smoke = { x: 10, y: 0, z: 0, r: 6, t0: 100, t1: 120 };
const each = [
  ["reloadDone"], ["reloadCancel"], ["dryFire"], ["swimState", true], ["swimStroke"], ["footstep"], ["weaponEquipped"], ["chuteDeployed"], ["chuteCut"],
  ["portalLaunch"], ["hardLand", 14], ["landed"], ["jump"], ["mantle"], ["touchdown", 4], ["touchdown", 13], ["pickedUp"], ["healStart"], ["healed"],
  ["healCancel"], ["weaponDropped", {}], ["grenadeThrown", "frag", { x: 8, y: 1.5, z: 0 }, { x: 1, y: 1, z: 0 }], ["quickThrow", "frag"], ["slideStart"],
  ["slideEnd", false], ["stormKill"], ["fallDamage", { dmg: 30 }],
];
for (const [ev, ...rest] of each) for (const [w, a] of who) await fire(ev + " " + w, ev, a, ...rest);
await fire("chestOpened own", "chestOpened", P, { pos: { x: 1, y: 0, z: 0 } }); await fire("chestOpened other", "chestOpened", E, { pos: { x: 8, y: 0, z: 0 } });
await fire("supplyDropOpened own", "supplyDropOpened", P, { x: 1, z: 0 }); await fire("supplyDropOpened other", "supplyDropOpened", E, { x: 8, z: 0 });
await fire("hitMarker", "hitMarker", P, E, 20, false); await fire("hitMarker head", "hitMarker", P, E, 40, true);
await fire("actorHurt own", "actorHurt", P, { dmg: 10, attackerId: 2 }); await fire("actorHurt mine shield", "actorHurt", E, { dmg: 10, attackerId: 1, toShield: 10 });
await fire("actorHurt mine flesh", "actorHurt", E, { dmg: 10, attackerId: 1, toShield: 0 }); await fire("actorHurt broke", "actorHurt", E, { dmg: 10, attackerId: 1, broke: true });
await fire("actorDied by me", "actorDied", E, 1); await fire("actorDied own", "actorDied", P, 2); E.alive = true; P.alive = true;
await fire("actorDowned by me", "actorDowned", E, 1); await fire("actorDowned mate", "actorDowned", M, 2);
await fire("reviveStart", "reviveStart", P, M); await fire("reviveCancel", "reviveCancel", P, M); await fire("actorRevived", "actorRevived", M);
for (const s of ["stone", "wood", "metal", "glass", "dirt"]) await fire("impact " + s, "impact", { x: 6, y: 1, z: 0 }, s);
await fire("whizBy", "whizBy", { x: 1, y: 1.6, z: 0 }, 0.5); await fire("propBreak", "propBreak", { x: 6, y: 0, z: 0 });
await fire("supplyDropLanded", "supplyDropLanded", { x: 30, y: 0, z: 0 }); await fire("supplyDropSpawned", "supplyDropSpawned");
await fire("scopeState in", "scopeState", true); await fire("scopeState out", "scopeState", false);
await fire("explosion", "explosion", { x: 12, y: 0, z: 0 }); W.camShake = 0.5; await fire("explosion close", "explosion", { x: 2, y: 0, z: 0 }); W.camShake = 0;
for (const ev of ["stormWarning", "stormClosing", "stormPhase"]) await fire(ev, ev, { phase: 2 });
await fire("stormTick", "stormTick", 4); await fire("playerStormState", "playerStormState", true);
for (const ev of ["uiClick", "escPressed", "toggleBigMap", "levelUp", "squadRefused", "hostLost", "chatMsg", "dropWaypoint", "pingAck", "emote"]) await fire(ev, ev);
await fire("countdownBeep", "countdownBeep", false); await fire("countdownBeep final", "countdownBeep", true);
await fire("pingPlaced own", "pingPlaced", { own: true, kind: "enemy" }); await fire("pingPlaced pin", "pingPlaced", { own: true, kind: "pin" });
await fire("smokeDeployed", "smokeDeployed", smoke); await fire("smokeExpired", "smokeExpired", smoke);
await fire("roundBounce", "roundBounce", { x: 5, y: 0.2, z: 0 }, "glauncher", 6);
await fire("teamEliminated own", "teamEliminated", "T1"); await fire("teamEliminated other", "teamEliminated", "T2");
await fire("dummyPopped", "dummyPopped", E);
// ── the lazy probe: every lazy file decoded once through the cache (its rate for pcm-rate; the cap under stress) ──
let lazyProbe = null;
if (A.pcmProbe) { lazyProbe = await A.pcmProbe(); snap("lazy probe"); }
// ── the ambience, per map theme ──────────────────────────────────────────────
const amb = {}, ambRate = {};
for (const th of Object.keys(T.AMB_REC).concat(["forest", "tropical", "savanna"].filter((x) => !T.AMB_REC[x]))) {
  W.phase = "menu"; A.update(W, 0.02); W.map.K.theme = th; W.phase = "match";
  REC.starts = []; REC.on = true; let rb = null;
  for (let i = 0; i < 60; i++) { ctx.currentTime += 0.1; A.update(W, 0.02); rb = A.readback(W).ambience; if (rb && rb.recorded) break; await new Promise((r) => realST(r, 5)); }
  REC.on = false;
  const lb = REC.starts.filter((s) => s.loop && s.file).map((s) => s.file);
  if (A.pcmCensus) Object.assign(ambRate, A.pcmCensus().amb);
  amb[th] = { readback: rb, loops: lb, synthLoops: REC.starts.filter((s) => s.synth).length, resident: (rb && rb.resident) || [] };
  snap("map " + th);
}
// ── Deepwood's snow stage (W10 R2B fix 3): the ground under the ear reads snow, then grass again ──
const snow = {};
for (const [lab, key] of [["snow", "in"], ["grass", "out"]]) {
  if (key === "in") { W.phase = "menu"; A.update(W, 0.02); }      // a map change goes through the menu (it stops the old map's layers)
  W.map.K.theme = "forest"; W.phase = "match"; W.map.surfaceAt = () => lab;
  for (let i = 0; i < 14; i++) { ctx.currentTime += 0.3; A.update(W, 0.3); await new Promise((r) => realST(r, 3)); }
  const rb = A.readback(W).ambience || {};
  snow[key] = { snow: rb.snow, layerGain: rb.layerGain, recorded: rb.recorded };
  snap("snow " + key);
}
W.map.surfaceAt = () => "grass";
// ── a dive: the underwater bed decodes on top of whatever is resident ──
if (W.__audio && W.__audio.setUnderwater) {
  W.__audio.setUnderwater(true);
  for (let i = 0; i < 10; i++) { ctx.currentTime += 0.3; A.update(W, 0.3); await new Promise((r) => realST(r, 3)); }
  snap("dive"); W.__audio.setUnderwater(false); A.update(W, 0.3);
}
const decRate = A.pcmCensus ? A.pcmCensus().sfx : {};
const lazyEnd = A.pcmCensus ? A.pcmCensus().lazy : null;
W.phase = "menu"; A.update(W, 0.02);
const ambAfter = (A.readback(W).ambience || {}).resident || [];
fs.writeFileSync(args.out, JSON.stringify({ listeners: Object.keys(H), cases, reloads, amb, ambAfter, ambRate, decRate, decoded, want: want.size, fetched: fetched.length,
  peak, lazyProbe, lazyEnd, snow, lazyKeys: A.LAZY_KEYS || [], lazyCap: A.LAZY_CAP || 0,
  table: { SFX: T.SFX, CLIP_DB: T.CLIP_DB, LOUD_GROUP: T.LOUD_GROUP, AMB_REC: T.AMB_REC, UW_BED: T.UW_BED || null, PCM_HZ: T.PCM_HZ || {}, RELOAD_SETS: T.RELOAD_SETS || null, RELOAD_SET_OF: T.RELOAD_SET_OF || null } }));
process.exit(0);
"""

# a census shim for an audio.js that predates the W10 exports (the base control): the same tables, read from the source
BASE_SHIM = r"""
export function sfxTable() { return { SFX, CLIP_DB: {}, LOUD_GROUP: { step: Object.keys(SFX).filter((k) => k.indexOf("step_") === 0) }, AMB_REC: {}, RELOAD_SETS: null, RELOAD_SET_OF: null }; }
export function synthTag() { return null; }
"""


def ffdecode(path, rate=48000):
    p = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-f", "f32le", "-ac", "1", "-ar", str(rate), "-"], capture_output=True)
    if p.returncode:
        raise C.EnvFailure("ffmpeg could not decode %s: %s" % (path, p.stderr.decode("utf-8", "replace")[:200]))
    return np.frombuffer(p.stdout, dtype=np.float32)


def loud50(x):
    n = 2400; hop = 600
    if len(x) < n:
        return 20 * np.log10(max(float(np.sqrt(np.mean(x.astype(np.float64) ** 2))) if len(x) else 0.0, 1e-12))
    c = np.concatenate([[0.0], np.cumsum(x.astype(np.float64) ** 2)])
    i = np.arange(0, len(x) - n + 1, hop)
    return 20 * np.log10(max(float(np.sqrt(((c[i + n] - c[i]) / n).max())), 1e-12))


def peak(x):
    return 20 * np.log10(max(float(np.abs(x).max()) if len(x) else 0.0, 1e-12))


def export_rev(rev):
    """games/last-circle at `rev`: runtime/, assets/audio/, AUDIO_SOURCES.md (git archive into a scratch dir)"""
    dst = tempfile.mkdtemp(prefix="lc_sfxcheck_rev_")
    gl = "games/last-circle/"
    a = subprocess.run(["git", "-C", C.REPO, "archive", "--format=tar", rev, gl + "runtime", gl + "assets/audio", gl + "AUDIO_SOURCES.md"], capture_output=True)
    if a.returncode:
        raise C.EnvFailure("git archive %s failed: %s" % (rev, a.stderr.decode("utf-8", "replace")[:300]))
    subprocess.run(["tar", "-x", "-C", dst], input=a.stdout, check=True)
    return os.path.join(dst, "games", "last-circle")


def base_sfx_names():
    r = subprocess.run(["git", "-C", C.REPO, "ls-tree", "--name-only", W10_BASE, "games/last-circle/assets/audio/sfx/"], capture_output=True, text=True)
    if r.returncode:
        raise C.EnvFailure("git ls-tree %s failed" % W10_BASE)
    return {os.path.basename(x) for x in r.stdout.split()}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    L.add_args(ap, plants=PLANTS)
    args = L.parse(ap)

    def body(v):
        root = export_rev(args.rev) if args.rev else C.ROOT
        v.data["root"] = ("git " + args.rev) if args.rev else "working copy"
        work = tempfile.mkdtemp(prefix="lc_sfxcheck_")
        audio = os.path.join(work, "audio.js")
        src = open(os.path.join(root, "runtime/3d/royale/audio.js"), encoding="utf-8").read()
        sources = open(os.path.join(root, "AUDIO_SOURCES.md"), encoding="utf-8").read()
        if "export function sfxTable" not in src:
            src += BASE_SHIM
        new_files = sorted(f for f in os.listdir(os.path.join(root, "assets/audio/sfx")) if f.endswith(".ogg") and f not in base_sfx_names())
        if args.plant:
            kind, reps = PLANTS[args.plant]
            if kind == "audio":
                for a, b in reps:
                    if a not in src:
                        raise C.HarnessError("plant %s: anchor not found in audio.js: %r" % (args.plant, a[:80]))
                    src = src.replace(a, b, 1)
            elif kind == "sources":
                victim = new_files[0] if new_files else None
                if not victim:
                    raise C.HarnessError("plant no-licence-row: no new sfx file to drop a row for")
                sources = "\n".join(ln for ln in sources.splitlines() if not re.match(r"^\|\s*%s\s*\|" % re.escape(victim), ln))
                v.data["plantVictim"] = victim
        open(audio, "w", encoding="utf-8").write(src)
        cjs = os.path.join(work, "census.mjs")
        open(cjs, "w", encoding="utf-8").write(CENSUS_JS)
        sfxd = os.path.join(root, "assets/audio/sfx")
        _dur = {}

        def dur(f):
            if f not in _dur:
                pth = os.path.join(sfxd, f + ".ogg")
                _dur[f] = len(ffdecode(pth)) / 48000.0 if os.path.exists(pth) else 0.0
            return _dur[f]
        added = sorted(f[:-4] for f in new_files)
        for f in added:
            dur(f)
        durj, addj = os.path.join(work, "dur.json"), os.path.join(work, "added.json")
        json.dump(_dur, open(durj, "w")); json.dump(added, open(addj, "w"))
        res, _tail, wall = L.run_node([cjs, "--root", root, "--audio", audio, "--dur", durj, "--added", addj])
        if not res:
            v.cnj("census", "the Node census of audio.js returned no report")
            return
        v.data["census"] = {"decoded": res["decoded"], "want": res["want"], "cases": len(res["cases"])}
        errs = [c for c in res["cases"] if c["err"]]
        v.check("census (every event fired against the decoded pack without a throw)", res["decoded"] > 0 and not errs,
                {"decoded": res["decoded"], "of": res["want"], "throws": [(c["label"], c["err"][:160]) for c in errs[:6]]}, "pack decoded, 0 throws")
        # ── synth-count ──
        tags = {}
        for c in res["cases"]:
            for s in c["starts"]:
                if s.get("synth"):
                    t = s.get("tag") or ("untagged:" + c["ev"])
                    tags.setdefault(t, set()).add(c["label"])
        bad = sorted(t for t in tags if t not in KEPT_TONAL)
        v.check("synth-count (synthesised one-shot cues <= %d, all kept tonal)" % SYNTH_MAX, len(tags) <= SYNTH_MAX and not bad,
                {"cues": len(tags), "kept": sorted(t for t in tags if t in KEPT_TONAL), "notKept": {t: sorted(tags[t])[:4] for t in bad}},
                "<= %d, every one in %s" % (SYNTH_MAX, sorted(KEPT_TONAL)))
        # ── events ──
        emitted = {}
        rt = os.path.join(root, "runtime")
        for dp, _dn, fns in os.walk(rt):
            if os.path.relpath(dp, rt).replace("\\", "/").startswith("net"):
                continue                      # ffg_netplay's own transport channel (_emit), not W.events
            for fn in fns:
                if not fn.endswith(".js") or ".selftest." in fn:
                    continue
                txt = open(os.path.join(dp, fn), encoding="utf-8", errors="replace").read()
                for m in re.finditer(r"\b(?:emit|doorEmit)\(\s*[\"']([A-Za-z]+)[\"']", txt):
                    emitted.setdefault(m.group(1), set()).add(fn)
        listeners = set(res["listeners"])
        empty = set(re.findall(r'on\("(\w+)",\s*\([^)]*\)\s*=>\s*\{\s*\}\s*\)', src))
        gameplay = {e for e in emitted if e not in NON_GAMEPLAY}
        unheard = sorted(e for e in gameplay if (e not in listeners or e in empty) and e not in ALLOW_SILENT and e not in DEFERRED_W9)
        started = {}
        for c in res["cases"]:
            started[c["ev"]] = started.get(c["ev"], 0) + len(c["starts"])
        mute = sorted(e for e in FORMERLY_SILENT if not started.get(e))
        v.check("events (every emitted gameplay event has a listener; the formerly silent ones sound)", not unheard and not mute,
                {"gameplayEmitted": len(gameplay), "noListener": unheard, "emptyHandler": sorted(empty), "formerlySilentStillMute": mute,
                 "allowlist": ALLOW_SILENT, "deferredW9": {k: v2 for k, v2 in DEFERRED_W9.items() if k in emitted}}, "0 unheard, 0 mute")
        v.info("events not counted as gameplay (reason each)", {k: NON_GAMEPLAY[k] for k in sorted(emitted) if k in NON_GAMEPLAY})
        # ── loudness / swap-level ──
        T = res["table"]
        inv = {k: g for g, ks in (T.get("LOUD_GROUP") or {}).items() for k in ks}
        fam = {}
        for k, takes in T["SFX"].items():
            for f in takes:
                fam.setdefault(inv.get(k, k), [])
                if f not in fam[inv.get(k, k)]:
                    fam[inv.get(k, k)].append(f)
        clip = T.get("CLIP_DB") or {}
        lvl, pk = {}, {}
        for fs in fam.values():
            for f in fs:
                p = os.path.join(sfxd, f + ".ogg")
                if f not in lvl and os.path.exists(p):
                    x = ffdecode(p); lvl[f] = loud50(x) + clip.get(f, 0.0); pk[f] = peak(x) + clip.get(f, 0.0)
        worst, outl = 0.0, []
        for g, fs in sorted(fam.items()):
            fs = [f for f in fs if f in lvl]
            if len(fs) < 2:
                continue
            med = float(np.median([lvl[f] for f in fs]))
            for f in fs:
                d = lvl[f] - med; worst = max(worst, abs(d))
                if abs(d) > LOUD_TOL:
                    outl.append({"family": g, "take": f, "dB": round(d, 2)})
        v.check("loudness (every take within +-%.0f dB of its family median, loudest-50 ms RMS + CLIP_DB)" % LOUD_TOL, not outl and len(lvl) > 0,
                {"families": sum(1 for fs in fam.values() if len([f for f in fs if f in lvl]) >= 2), "worstDb": round(worst, 2), "outliers": outl[:12]}, "|d| <= %.1f dB" % LOUD_TOL)
        eq = {f: round(pk[f], 2) for f in fam.get("equip", []) if f in pk}
        v.check("swap-level (every equip take peaks >= %.0f dBFS)" % SWAP_PEAK_MIN, bool(eq) and min(eq.values()) >= SWAP_PEAK_MIN, eq, ">= %.0f dBFS" % SWAP_PEAK_MIN)
        # ── reload-classes ──
        sig = {}
        for g, r in res["reloads"].items():
            fams = tuple(re.sub(r"_\d+$", "", c) for c in r["cues"])
            sig.setdefault(fams, []).append(g)
        distinct = {" > ".join(k): v2 for k, v2 in sig.items() if k and not any(x.startswith("synth:") for x in k)}
        v.check("reload-classes (>= %d distinct recorded reload sets, by weapon class)" % RELOAD_SETS_MIN, len(distinct) >= RELOAD_SETS_MIN,
                {"sets": distinct, "classOf": {g: r["cls"] for g, r in res["reloads"].items()}}, ">= %d" % RELOAD_SETS_MIN)
        # ── amb-layers ──
        amb = res["amb"]; ar = T.get("AMB_REC") or {}
        per = {}
        for th in ("forest", "tropical", "savanna"):
            layers = ar.get(th) or []
            files = [l[0] for l in layers if os.path.exists(os.path.join(sfxd, l[0] + ".ogg"))]
            a = amb.get(th) or {}
            per[th] = {"layers": len(layers), "filesPresent": len(files), "loopsStarted": a.get("loops"), "synthBedLeft": (a.get("readback") or {}).get("synthBed")}
        ok = all(p["layers"] >= 2 and p["filesPresent"] >= 2 and len(p["loopsStarted"] or []) >= 2 and not p["synthBedLeft"] for p in per.values())
        v.check("amb-layers (>= 2 recorded layers per map, started in place of the synth bed)", ok, per, ">= 2 recorded loops on every map")
        # ── pcm-rate / pcm-bounded / pcm-budget (W10 R2B repair: the decoded-memory budget, PLAN R2B "Budget") ──
        hz = T.get("PCM_HZ") or {}; dec = res.get("decRate") or {}; arate = res.get("ambRate") or {}; uwn = T.get("UW_BED")
        bad, unseen = [], []
        for f, r in sorted(hz.items()):
            pth = os.path.join(sfxd, f + ".ogg")
            if not os.path.exists(pth):
                bad.append({"file": f, "why": "listed, no file"}); continue
            # the playback chain: decoded at r, then read by a 48 kHz buffer source with LINEAR interpolation (Chromium), vs the 48 kHz decode
            x = ffdecode(pth).astype(np.float64); y = ffdecode(pth, r).astype(np.float64)
            z = np.interp(np.arange(len(x)) * r / 48000.0, np.arange(len(y)), y)
            share = float(np.sum((x - z) ** 2) / max(np.sum(x ** 2), 1e-30))
            got = dec.get(f, arate.get(f))
            if share > PCM_SHARE:
                bad.append({"file": f, "hz": r, "lostShare": round(share, 5)})
            if got is None:
                unseen.append(f)
            elif got != r:
                bad.append({"file": f, "hz": r, "censusHz": got})
        stray = sorted(f for f, g in list(dec.items()) + list(arate.items()) if g < 48000 and f not in hz)
        unseen_bad = [f for f in unseen if f != uwn]
        v.check("pcm-rate (a file held below 48 kHz plays back within %.1f %% (-30 dB) error energy of its 48 kHz decode, and the runtime decodes it at its table rate)" % (PCM_SHARE * 100),
                not bad and not stray and not unseen_bad,
                {"listed": len(hz), "at16k": sum(1 for r in hz.values() if r == 16000), "at24k": sum(1 for r in hz.values() if r == 24000),
                 "bad": bad[:10], "notInTable": stray[:10], "notDecodedInCensus": unseen}, "0 bad (chain error energy <= %.3f)" % PCM_SHARE)
        layers = {th: [l[0] for l in (ar.get(th) or [])] for th in ar}
        visits, leak = [], []
        for th, a in amb.items():
            resd = sorted(a.get("resident") or [])
            extra = [f for f in resd if f not in layers.get(th, []) and f != uwn]
            miss = [f for f in layers.get(th, []) if f not in resd]
            visits.append({"theme": th, "resident": resd})
            if extra or miss:
                leak.append({"theme": th, "otherThemesHeld": extra, "ownMissing": miss})
        v.check("pcm-bounded (after each map change only that map's ambience layers stay decoded)", bool(layers) and len(visits) >= 3 and not leak,
                {"visits": visits, "leaks": leak, "afterAll": res.get("ambAfter")}, "0 leaks over %d map changes" % len(visits))
        pack = set(n for ks in T["SFX"].values() for n in ks)
        addedS = set(added)
        lazyf = set(n for k in (res.get("lazyKeys") or []) for n in T["SFX"].get(k, []))
        rateof = lambda n: dec.get(n, hz.get(n, 48000))
        eager = sum(dur(n) * rateof(n) * 4 for n in addedS if n in pack and n not in lazyf)
        lazy_all = sum(dur(n) * rateof(n) * 4 for n in addedS if n in lazyf)
        lazy_max = max([dur(n) * rateof(n) * 4 for n in addedS if n in lazyf] or [0.0])
        cap = float(res.get("lazyCap") or 0.0)
        lazy_bound = min(lazy_all, cap + lazy_max) if lazyf else 0.0
        uwb = dur(uwn) * hz.get(uwn, 48000) * 4 if uwn and uwn in addedS else 0.0
        perv = {a2["theme"]: sum(dur(f) * arate.get(f, hz.get(f, 48000)) * 4 for f in a2["resident"] if f != uwn) for a2 in visits}
        bound = eager + lazy_bound + uwb + (max(perv.values()) if perv else 0.0)
        pk = res.get("peak") or {}
        observed = float(pk.get("bytes") or 0.0) + (0.0 if pk.get("uwSeen") else uwb)
        lp = (res.get("lazyEnd") or {}).get("peak", 0.0)
        lazy_ok = (not lazyf) or lp <= cap + lazy_max
        worst = max(bound, observed)
        v.check("pcm-budget (decoded PCM the R2B files add to one session <= %.1f MB: the bound AND the census-observed peak)" % (PCM_BUDGET / 1e6),
                bool(perv) and bound <= PCM_BUDGET and observed <= PCM_BUDGET and lazy_ok,
                {"MB": round(worst / 1e6, 2), "boundMB": round(bound / 1e6, 2), "observedPeakMB": round(observed / 1e6, 2), "observedAt": pk.get("at"),
                 "snapshots": pk.get("snaps"), "eagerAddedMB": round(eager / 1e6, 3), "lazyFiles": len(lazyf), "lazyAllMB": round(lazy_all / 1e6, 2),
                 "lazyCapMB": round(cap / 1e6, 2), "lazyLargestMB": round(lazy_max / 1e6, 3), "lazyPeakMB": round(lp / 1e6, 3),
                 "lazyEvicted": (res.get("lazyEnd") or {}).get("evicted"), "underwaterBedMB": round(uwb / 1e6, 2),
                 "ambienceMBPerMap": {k: round(x / 1e6, 2) for k, x in perv.items()}}, "<= %.1f MB" % (PCM_BUDGET / 1e6))
        # ── lazy-play ──
        lz = [c for c in res["cases"] if c.get("lazyMiss")]
        dropped = [(c["label"], c["lazyMiss"], c["lazyStarts"]) for c in lz if c["lazyStarts"] < c["lazyMiss"]]
        late = (res.get("lazyEnd") or {}).get("late", 0)
        v.check("lazy-play (every lazy take's first use in the census is played as its decode lands; 0 dropped late)",
                (not lazyf) or (bool(lz) and not dropped and not late),
                {"casesWithMiss": len(lz), "misses": sum(c["lazyMiss"] for c in lz), "lazyStarts": sum(c["lazyStarts"] for c in lz),
                 "notPlayed": dropped[:8], "late": late}, "lazy starts >= misses in every event, 0 late")
        # ── storm-siren ──
        sir = {}
        for ev in ("stormWarning", "stormClosing"):
            cs = [c for c in res["cases"] if c["ev"] == ev]
            st = cs[0]["starts"] if cs else []
            sir[ev] = {"siren": sum(1 for x in st if x.get("synth") and x.get("tag") == "storm_siren"),
                       "surge": sum(1 for x in st if (x.get("file") or "").startswith("storm_surge"))}
        lzs = [c for c in res["cases"] if c["ev"] in ("stormWarning", "stormClosing")]
        v.check("storm-siren (warning / closing keep the W9 siren with the recorded surge layered under it)",
                all(x["siren"] >= 1 for x in sir.values()) and all(x["surge"] >= 1 or any(c["lazyMiss"] for c in lzs) for x in sir.values()),
                sir, "siren >= 1 and surge >= 1 on both")
        # ── bytes ──
        allb = sum(os.path.getsize(os.path.join(sfxd, f)) for f in os.listdir(sfxd) if f.endswith(".ogg"))
        addb = sum(os.path.getsize(os.path.join(sfxd, f)) for f in new_files)
        v.check("bytes (added sfx <= 2.0 MB; total sfx <= 3.5 MB)", addb <= ADDED_MAX and allb <= TOTAL_MAX,
                {"addedBytes": addb, "addedFiles": len(new_files), "totalBytes": allb}, "added <= %d, total <= %d" % (ADDED_MAX, TOTAL_MAX))
        # ── licence ──
        rows = {}
        for ln in sources.splitlines():
            m = re.match(r"^\|\s*([\w.-]+\.ogg)\s*\|(.*)\|\s*$", ln)
            if m:
                cols = [c.strip() for c in m.group(2).split("|")]
                rows[m.group(1)] = cols
        missing = [f for f in new_files if f not in rows or len(rows[f]) < 3 or not rows[f][-2] or not rows[f][-1]]
        v.check("licence (every new sfx file has an AUDIO_SOURCES.md row: source + licence)", not missing,
                {"newFiles": len(new_files), "rows": sum(1 for f in new_files if f in rows), "missing": missing[:10]}, "0 missing")
        # ── the measured-quality rows (W10 R2B fix 3: nobody can listen, so the sound is judged by measurement) ──
        def layer_x(f):
            if args.plant == "hiss-bed" and f == "amb_savanna_bed":
                tmp = os.path.join(work, "prefix_savanna_bed.ogg")
                g = subprocess.run(["git", "-C", C.REPO, "show", "%s:games/last-circle/assets/audio/sfx/amb_savanna_bed.ogg" % PRE_FIX_REV], capture_output=True)
                if g.returncode:
                    raise C.EnvFailure("plant hiss-bed: git show %s failed" % PRE_FIX_REV)
                open(tmp, "wb").write(g.stdout)
                return ffdecode(tmp).astype(np.float64)
            x = ffdecode(os.path.join(sfxd, f + ".ogg")).astype(np.float64)
            if args.plant == "seam-gap" and f == "amb_tropical_bed":
                x = np.concatenate([x, np.zeros(1440)])           # 30 ms of digital silence at the loop end (a non-gapless export)
            return x
        layers_all = sorted(set(l[0] for th in ar for l in ar[th]) | ({uwn} if uwn else set()))
        LX = {f: layer_x(f) for f in layers_all if os.path.exists(os.path.join(sfxd, f + ".ogg"))}

        def spec(x, n=2048):
            fr = np.array([x[i:i + n] * np.hanning(n) for i in range(0, len(x) - n, n)])
            return np.abs(np.fft.rfft(fr, axis=1)) ** 2 + 1e-20, np.fft.rfftfreq(n, 1 / 48000.0)
        # bed-hiss
        hiss = {}
        for f in sorted(LX):
            if f == uwn:
                continue
            P, fq = spec(LX[f]); m = P.mean(0); h = (fq >= 2000) & (fq <= 12000)
            flat = float(np.exp(np.mean(np.log(m[h]))) / np.mean(m[h])); hf = float(10 * np.log10(m[fq >= 5000].sum() / m.sum()))
            hiss[f] = {"flat2to12k": round(flat, 3), "above5kDb": round(hf, 1), "hiss": flat >= HISS_FLAT and hf >= HISS_HF_DB}
        v.check("bed-hiss (no ambience layer is white-noise hiss: 2-12 kHz flatness >= %.1f with >= %.0f dB above 5 kHz)" % (HISS_FLAT, HISS_HF_DB),
                bool(hiss) and not any(x["hiss"] for x in hiss.values()), hiss, "0 hiss layers")
        # snow-birds
        def birdfrac(x, n=2048):
            P, fq = spec(x, n); b = (fq >= 2500) & (fq <= 9000); A_ = 10 * np.log10(P); pkx = np.abs(x).max(); c = t = 0
            for i in range(P.shape[0]):
                fr = x[i * n:(i + 1) * n]
                if np.sqrt(np.mean(fr ** 2)) < pkx * 1e-3:
                    continue
                t += 1; Pb = A_[i][b]
                if Pb.max() - np.median(Pb) >= 25.0 and Pb.max() >= A_[i].max() - 20:
                    c += 1
            return c / max(t, 1)
        sn = res.get("snow") or {}
        gin, gout = (sn.get("in") or {}).get("layerGain") or {}, (sn.get("out") or {}).get("layerGain") or {}
        bf = {f: round(birdfrac(LX[f]), 3) for f in gin if f in LX}
        up_in = {f: g for f, g in gin.items() if g > 0}
        birdy_up = [f for f in up_in if bf.get(f, 1.0) > BIRD_MAX]
        birdy = [f for f in bf if bf[f] > BIRD_MAX]
        v.check("snow-birds (Deepwood snow stage: every layer still up has <= %.0f %% bird-tonal frames; the birdsong layer is back out of the snow)" % (BIRD_MAX * 100),
                bool(gin) and (sn.get("in") or {}).get("snow") is True and not birdy_up and up_in and all(gout.get(f, 0) > 0 for f in birdy) and bool(birdy),
                {"inSnow": sn.get("in"), "outOfSnow": sn.get("out"), "birdFrames": bf}, "layers up in snow: 0 birdy; birdy layer up again outside")
        # loop-seam
        seams = {}
        for f in sorted(LX):
            x = LX[f]; dx = np.abs(np.diff(x)); step = abs(float(x[0] - x[-1])); p999 = float(np.percentile(dx, 99.9))
            w = 240
            def hfe(seg):
                X = np.abs(np.fft.rfft(seg * np.hanning(len(seg)))) ** 2; fq = np.fft.rfftfreq(len(seg), 1 / 48000.0); return float(X[fq >= 4000].sum())
            rng = np.random.RandomState(7); pos = rng.randint(w, len(x) - w, 400)
            inner = [hfe(x[i - w:i + w]) for i in pos]; p99 = float(np.percentile(inner, 99))
            se = hfe(np.concatenate([x[-w:], x[:w]]))
            r10 = lambda seg: 10 * np.log10(max(float(np.mean(seg ** 2)), 1e-20))
            nw = len(x) // 480
            lv = np.array([r10(x[k * 480:(k + 1) * 480]) for k in range(nw)])
            jp999 = float(np.percentile(np.abs(np.diff(lv)), 99.9)); jump = abs(r10(x[-480:]) - r10(x[:480]))
            seams[f] = {"step": round(step, 5), "dxP999": round(p999, 5), "seamHF_dB_vs_p99": round(10 * np.log10(max(se, 1e-30) / max(p99, 1e-30)), 2),
                        "levelJumpDb": round(jump, 2), "jumpP999Db": round(jp999, 2), "ok": step <= p999 and se <= p99 and jump <= jp999}
        v.check("loop-seam (every loop wraps without a click or gap: step <= p99.9 |dx|, wrap 4 kHz+ energy <= p99, level jump <= p99.9)",
                bool(seams) and all(x["ok"] for x in seams.values()), seams, "every loop ok")
        # no-clip
        clips, filepk = [], {}
        for f in added:
            pth = os.path.join(sfxd, f + ".ogg")
            if not os.path.exists(pth):
                continue
            x = ffdecode(pth); filepk[f] = peak(x)
            hot = np.abs(x) >= 0.98
            run = int(np.max(np.diff(np.flatnonzero(np.concatenate([[1], ~hot, [1]]))) - 1)) if hot.any() else 0
            if run >= 3 or filepk[f] > 0.0:
                clips.append({"file": f, "peakDb": round(filepk[f], 2), "flatTopRun": run})
        # W10 R2B fix 4: a played family is judged on EVERY take, not only the one the census picked (sample() picks a take at
        # random): the call gain (tap g / the pick's CLIP_DB trim) x each take's own trim x the top of the per-play level jitter
        # (0.9..1.1 in sample()). Before this, a hot take slipped past when the census happened to pick a sibling (plant clip-hot 0/3)
        sfx_t, clipg = T["SFX"], {f: 10 ** (d / 20.0) for f, d in (T.get("CLIP_DB") or {}).items()}
        f2ks = {}
        for k_, fs_ in sfx_t.items():
            for f_ in fs_:
                f2ks.setdefault(f_, []).append(k_)
        playpk, hotplays, seen = -99.0, [], set()
        for c in res["cases"]:
            for e in (c.get("levels") or []):
                callg = max(e["g"], 1e-9) / clipg.get(e["f"], 1.0)
                for k_ in ([e["k"]] if e.get("k") in sfx_t else f2ks.get(e["f"], [])):
                    for t_ in sfx_t[k_]:
                        if t_ not in filepk:
                            continue
                        pp = filepk[t_] + 20 * np.log10(callg * clipg.get(t_, 1.0) * PLAY_JITTER_MAX); playpk = max(playpk, pp)
                        if pp > -1.0 and (c["label"], t_) not in seen:
                            seen.add((c["label"], t_)); hotplays.append({"case": c["label"], "key": k_, "file": t_, "peakDb": round(pp, 2)})
        v.check("no-clip (no added file is clipped; no census play of one peaks over -1 dBFS in game, before the bus)", not clips and not hotplays,
                {"files": len(filepk), "loudestFileDb": round(max(filepk.values() or [-99]), 2), "loudestPlayDb": round(playpk, 2),
                 "clippedFiles": clips[:10], "hotPlays": hotplays[:10]}, "0 clipped files, every play <= -1 dBFS")
        # xcat
        f2k = {f: k for k, fs in T["SFX"].items() for f in fs}
        def cat(f):
            k = f2k.get(f, "")
            for c, pre in XCAT.items():
                for p_ in pre:
                    if (p_.endswith("_") and k.startswith(p_)) or k == p_:
                        return c
            return None
        lvls = {}
        for c in res["cases"]:
            for e in (c.get("levels") or []):
                if e.get("d") is not None:
                    continue
                cc = cat(e["f"])
                if not cc:
                    continue
                if e["f"] not in lvl:
                    pth = os.path.join(sfxd, e["f"] + ".ogg")
                    if not os.path.exists(pth):
                        continue
                    lvl[e["f"]] = loud50(ffdecode(pth)) + clip.get(e["f"], 0.0)
                base_l = lvl[e["f"]] - clip.get(e["f"], 0.0)
                lvls.setdefault(cc, []).append(base_l + 20 * np.log10(max(e["g"], 1e-9)))
        meds = {cc: round(float(np.median(x)), 2) for cc, x in lvls.items()}
        judged = {cc: m_ for cc, m_ in meds.items() if cc not in XCAT_INFO}
        mm = float(np.median(list(judged.values()))) if judged else 0.0
        off = {cc: round(m_ - mm, 2) for cc, m_ in meds.items()}
        v.check("xcat (R2B own-action categories' median in-game level within +-%.0f dB of the median of category medians; own footsteps listed)" % XCAT_TOL,
                len(judged) >= len(XCAT) - len(XCAT_INFO) and all(abs(off[cc]) <= XCAT_TOL for cc in judged),
                {"medianDb": meds, "offsetDb": off, "plays": {cc: len(x) for cc, x in lvls.items()}}, "|offset| <= %.1f dB" % XCAT_TOL)
        v.info("node wall", {"s": wall})
        if args.rev:
            shutil.rmtree(os.path.dirname(os.path.dirname(root)), ignore_errors=True)

    return C.run_gate("w10_sfx", body, args)


if __name__ == "__main__":
    sys.exit(main())
