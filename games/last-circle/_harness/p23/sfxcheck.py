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
KEPT_TONAL = {"hit_marker", "kill_confirm", "knock_confirm", "ping", "countdown", "ui", "team_sting"}
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

PLANTS = {
    "synth-loot": ("audio", [(r'if (!sample("pickup", own ? null : a.pos, own ? 0.24 : 0.14, 16, 1, own ? VOICE_TIER.own : VOICE_TIER.step, own ? null : FX_FOLEY))',
                              r'if (true)')]),
    "mute-grenade": ("audio", [('on("grenadeThrown", ', 'on("grenadeThrown__planted", ')]),
    "hot-step": ("audio", [("// LOUD-TABLE-END", 'CLIP_DB["step_grass_001"] = (CLIP_DB["step_grass_001"] || 0) + 7;\n// LOUD-TABLE-END')]),
    "no-amb": ("audio", [('savanna:  [["amb_savanna_bed", 0.5], ["amb_savanna_wind", 0.5]],', 'savanna:  [],')]),
    "no-licence-row": ("sources", None),
}

CENSUS_JS = r"""
import fs from "fs"; import path from "path"; import { pathToFileURL } from "url"; import { createRequire } from "module";
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith("--") ? a.concat([[x.slice(2), arr[i + 1]]]) : a), []));
const ROOT = args.root, AUDIO = args.audio, SFXD = path.join(ROOT, "assets/audio/sfx");
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
  decodeAudioData(ab) { const d = new Float32Array(4800); return Promise.resolve({ __file: ab.__file, numberOfChannels: 1, length: 4800, sampleRate: 48000, duration: 1, getChannelData: () => d }); }
  resume() { return Promise.resolve(); } suspend() { return Promise.resolve(); }
}
const winL = {};
globalThis.window = { AudioContext: FakeCtx, addEventListener: (n, f) => { (winL[n] = winL[n] || []).push(f); }, removeEventListener() {} };
globalThis.document = { addEventListener() {}, visibilityState: "visible", querySelectorAll: () => [] };
globalThis.requestAnimationFrame = () => 1; globalThis.cancelAnimationFrame = () => {};
globalThis.Audio = class { constructor() { this.paused = true; this.volume = 1; } play() { return Promise.resolve(); } pause() {} addEventListener() {} };
const fetched = [];
globalThis.fetch = async (url) => { const m = /assets\/audio\/sfx\/([^/?]+)\.ogg/.exec(String(url)); if (!m) return { ok: false };
  const p = path.join(SFXD, m[1] + ".ogg"); if (!fs.existsSync(p)) return { ok: false }; fetched.push(m[1]);
  return { ok: true, arrayBuffer: async () => ({ __file: m[1] }), blob: async () => ({}) }; };
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
for (let i = 0; i < 200 && A.readback(W).sfxDecoded < [...want].filter((n) => fs.existsSync(path.join(SFXD, n + ".ogg"))).length; i++) await new Promise((r) => realST(r, 10));
const ctx = globalThis.window.__AUDIO_CTX__;
const decoded = A.readback(W).sfxDecoded;
// ── the census ────────────────────────────────────────────────────────────────
const cases = [];
function fire(label, ev, ...a) {
  ctx.currentTime += 3; A.update(W, 0.02);
  REC.starts = []; REC.on = true; SYNC = true; fakeNow += 25;
  let err = null; try { events.emit(ev, ...a); } catch (e) { err = String(e && e.stack || e); }
  for (let n = 0; Q.length && n < 60; n++) {
    Q.sort((x, y) => x.at - y.at); const q = Q.shift();
    const dt = Math.max(0, q.at - fakeNow); fakeNow = Math.max(fakeNow, q.at) + 25; ctx.currentTime += dt / 1000;
    try { q.f(); } catch (e) { err = err || String(e && e.stack || e); }
  }
  Q.length = 0; SYNC = false; REC.on = false;
  cases.push({ label, ev, err, starts: REC.starts.slice() });
}
const who = [["own", P], ["other", E]];
const guns = Object.keys(SIM.WEAPONS).filter((k) => SIM.WEAPONS[k].cls && SIM.WEAPONS[k].cls !== "throwable");
for (const g of guns) {
  fire("shot own " + g, "shotFired", P, g, { x: 0, y: 1.6, z: 0 });
  for (const d of [10, 120, 300]) fire("shot " + d + "m " + g, "shotFired", E, g, { x: d, y: 1.6, z: 0 });
}
const reloads = {};
for (const g of guns) {
  for (const [w, a] of who) { a._audRlT = 0; a.weapon = { id: g, state: "reloading" }; fire("reload " + w + " " + g, "reloadStart", a, a.weapon);
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
for (const [ev, ...rest] of each) for (const [w, a] of who) fire(ev + " " + w, ev, a, ...rest);
fire("chestOpened own", "chestOpened", P, { pos: { x: 1, y: 0, z: 0 } }); fire("chestOpened other", "chestOpened", E, { pos: { x: 8, y: 0, z: 0 } });
fire("supplyDropOpened own", "supplyDropOpened", P, { x: 1, z: 0 }); fire("supplyDropOpened other", "supplyDropOpened", E, { x: 8, z: 0 });
fire("hitMarker", "hitMarker", P, E, 20, false); fire("hitMarker head", "hitMarker", P, E, 40, true);
fire("actorHurt own", "actorHurt", P, { dmg: 10, attackerId: 2 }); fire("actorHurt mine shield", "actorHurt", E, { dmg: 10, attackerId: 1, toShield: 10 });
fire("actorHurt mine flesh", "actorHurt", E, { dmg: 10, attackerId: 1, toShield: 0 }); fire("actorHurt broke", "actorHurt", E, { dmg: 10, attackerId: 1, broke: true });
fire("actorDied by me", "actorDied", E, 1); fire("actorDied own", "actorDied", P, 2); E.alive = true; P.alive = true;
fire("actorDowned by me", "actorDowned", E, 1); fire("actorDowned mate", "actorDowned", M, 2);
fire("reviveStart", "reviveStart", P, M); fire("reviveCancel", "reviveCancel", P, M); fire("actorRevived", "actorRevived", M);
for (const s of ["stone", "wood", "metal", "glass", "dirt"]) fire("impact " + s, "impact", { x: 6, y: 1, z: 0 }, s);
fire("whizBy", "whizBy", { x: 1, y: 1.6, z: 0 }, 0.5); fire("propBreak", "propBreak", { x: 6, y: 0, z: 0 });
fire("supplyDropLanded", "supplyDropLanded", { x: 30, y: 0, z: 0 }); fire("supplyDropSpawned", "supplyDropSpawned");
fire("scopeState in", "scopeState", true); fire("scopeState out", "scopeState", false);
fire("explosion", "explosion", { x: 12, y: 0, z: 0 }); W.camShake = 0.5; fire("explosion close", "explosion", { x: 2, y: 0, z: 0 }); W.camShake = 0;
for (const ev of ["stormWarning", "stormClosing", "stormPhase"]) fire(ev, ev, { phase: 2 });
fire("stormTick", "stormTick", 4); fire("playerStormState", "playerStormState", true);
for (const ev of ["uiClick", "escPressed", "toggleBigMap", "levelUp", "squadRefused", "hostLost", "chatMsg", "dropWaypoint", "pingAck", "emote"]) fire(ev, ev);
fire("countdownBeep", "countdownBeep", false); fire("countdownBeep final", "countdownBeep", true);
fire("pingPlaced own", "pingPlaced", { own: true, kind: "enemy" }); fire("pingPlaced pin", "pingPlaced", { own: true, kind: "pin" });
fire("smokeDeployed", "smokeDeployed", smoke); fire("smokeExpired", "smokeExpired", smoke);
fire("roundBounce", "roundBounce", { x: 5, y: 0.2, z: 0 }, "glauncher", 6);
fire("teamEliminated own", "teamEliminated", "T1"); fire("teamEliminated other", "teamEliminated", "T2");
fire("dummyPopped", "dummyPopped", E);
// ── the ambience, per map theme ──────────────────────────────────────────────
const amb = {};
for (const th of Object.keys(T.AMB_REC).concat(["forest", "tropical", "savanna"].filter((x) => !T.AMB_REC[x]))) {
  W.phase = "menu"; A.update(W, 0.02); W.map.K.theme = th; W.phase = "match";
  REC.starts = []; REC.on = true; let rb = null;
  for (let i = 0; i < 60; i++) { ctx.currentTime += 0.1; A.update(W, 0.02); rb = A.readback(W).ambience; if (rb && rb.recorded) break; await new Promise((r) => realST(r, 5)); }
  REC.on = false;
  amb[th] = { readback: rb, loops: REC.starts.filter((s) => s.loop && s.file).map((s) => s.file), synthLoops: REC.starts.filter((s) => s.synth).length };
}
W.phase = "menu"; A.update(W, 0.02);
fs.writeFileSync(args.out, JSON.stringify({ listeners: Object.keys(H), cases, reloads, amb, decoded, want: want.size, fetched: fetched.length,
  table: { SFX: T.SFX, CLIP_DB: T.CLIP_DB, LOUD_GROUP: T.LOUD_GROUP, AMB_REC: T.AMB_REC, RELOAD_SETS: T.RELOAD_SETS || null, RELOAD_SET_OF: T.RELOAD_SET_OF || null } }));
process.exit(0);
"""

# a census shim for an audio.js that predates the W10 exports (the base control): the same tables, read from the source
BASE_SHIM = r"""
export function sfxTable() { return { SFX, CLIP_DB: {}, LOUD_GROUP: { step: Object.keys(SFX).filter((k) => k.indexOf("step_") === 0) }, AMB_REC: {}, RELOAD_SETS: null, RELOAD_SET_OF: null }; }
export function synthTag() { return null; }
"""


def ffdecode(path):
    p = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-f", "f32le", "-ac", "1", "-ar", "48000", "-"], capture_output=True)
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
            else:
                victim = new_files[0] if new_files else None
                if not victim:
                    raise C.HarnessError("plant no-licence-row: no new sfx file to drop a row for")
                sources = "\n".join(ln for ln in sources.splitlines() if not re.match(r"^\|\s*%s\s*\|" % re.escape(victim), ln))
                v.data["plantVictim"] = victim
        open(audio, "w", encoding="utf-8").write(src)
        cjs = os.path.join(work, "census.mjs")
        open(cjs, "w", encoding="utf-8").write(CENSUS_JS)
        res, _tail, wall = L.run_node([cjs, "--root", root, "--audio", audio])
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
        T = res["table"]; sfxd = os.path.join(root, "assets/audio/sfx")
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
        v.info("node wall", {"s": wall})
        if args.rev:
            shutil.rmtree(os.path.dirname(os.path.dirname(root)), ignore_errors=True)

    return C.run_gate("w10_sfx", body, args)


if __name__ == "__main__":
    sys.exit(main())
