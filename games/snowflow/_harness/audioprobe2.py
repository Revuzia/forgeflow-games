#!/usr/bin/env python
"""DRIFTWAKE audio diagnostic, pass 2 — perceptual weighting and the second context.

Pass 1 (audioprobe.py) measured flat RMS and found a bed dominated by energy
below 125 Hz. Flat RMS is the wrong yardstick for "does this sound like hiss":
the ear discounts LF heavily, so a bed whose FLAT level is LF-dominated can still
be perceived as a hiss if its HF tail is what survives A-weighting.

This pass therefore adds:
  · A-weighted level per case (dBFS(A)) — tracks what is actually heard
  · absolute level of the >2 kHz band per case — the "hiss" band, in dBFS
  · a speed sweep, because the top layer is speed-gated and the owner may be moving
  · a tap on FFG.music's SEPARATE AudioContext, which pass 1 never covered
  · a walking live capture, not just standing
  · loop-seam / crossfade behaviour of the shared noise buffer

    python audioprobe2.py
"""
import base64, json, sys, time
import numpy as np
from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass

URL = "http://localhost:8799/games/snowflow/index.html"

BOOT = r"""
(() => {
  window.__sfReady = () => {
    const SF = globalThis.SNOWFLOW;
    if (!SF || !SF.terrain || !SF.rig || !SF.character) return false;
    const b = document.getElementById('boot');
    return !(b && !b.classList.contains('gone'));
  };
})();
"""

OFFLINE = r"""
async (cfg) => {
  const V = await import('/games/snowflow/src/audio/voices.js');
  const G = await import('/games/snowflow/src/audio/graph.js');
  const SR = cfg.sr, DUR = cfg.dur, STEP = 1 / 20;
  const ctx = new OfflineAudioContext(2, Math.floor(SR * DUR), SR);

  let out = ctx.destination;
  const lim = ctx.createDynamicsCompressor();
  lim.threshold.value = -8; lim.knee.value = 6; lim.ratio.value = 6;
  lim.attack.value = 0.004; lim.release.value = 0.18;
  lim.connect(ctx.destination); out = lim;
  const master = ctx.createGain();
  master.gain.value = cfg.master; master.connect(out);

  const white = G.noiseBuffer(ctx, false, 0x5f3a91c7);
  const pink  = G.noiseBuffer(ctx, true,  0x1d7be40b);
  const wind = cfg.wind ? new V.WindBed(ctx, white, pink, master) : null;
  const surf = cfg.surf ? new V.SurfBed(ctx, white, pink, master) : null;
  const crunch = cfg.crunch ? new V.CrunchPool(ctx, white, master, 4) : null;

  const nSteps = Math.floor(DUR / STEP);
  for (let i = 1; i < nSteps; i++) {
    ctx.suspend(i * STEP).then(() => {
      const now = ctx.currentTime, t = cfg.freezeT != null ? cfg.freezeT : now;
      if (wind) {
        wind.drive(now, t, cfg.strength, cfg.speed01, cfg.surfBlend, cfg.pan, cfg.sfx);
        if (cfg.mute.indexOf('low') >= 0) wind.sLow.reset(0, now);
        if (cfg.mute.indexOf('mid') >= 0) wind.sMid.reset(0, now);
        if (cfg.mute.indexOf('top') >= 0) wind.sTop.reset(0, now);
      }
      if (surf) surf.drive(now, cfg.surfBlend, cfg.speed01, cfg.carve || 0, cfg.sfx);
      if (crunch && cfg.fireAt && Math.abs(now - cfg.fireAt) < STEP * 0.51) {
        crunch.fire(now, 1260, 0.75, 0.92, 0.40 * cfg.sfx, 0.145, 0.028, -0.22);
      }
      ctx.resume();
    });
  }
  const buf = await ctx.startRendering();
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  const mono = new Float32Array(buf.length);
  for (let i = 0; i < buf.length; i++) mono[i] = (L[i] + R[i]) * 0.5;
  const bytes = new Uint8Array(mono.buffer);
  let s = ''; const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH)
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return { sr: SR, pcm: btoa(s) };
}
"""

# Tap an arbitrary context's master gain and return raw PCM, so Python does the
# same analysis on live audio as on offline audio.
LIVETAP = r"""
async (arg) => {
  const which = arg.which, secs = arg.secs;
  let ctx = null, node = null, extra = {};
  if (which === 'sfx') {
    const A = globalThis.SNOWFLOW && globalThis.SNOWFLOW.audio;
    if (!A || !A.ctx) return { err: 'sfx: ' + (A ? A.state : 'none') };
    ctx = A.ctx; node = A.master;
  } else {
    const M = globalThis.FFG && globalThis.FFG.music;
    if (!M || !M.ctx) return { err: 'music: ' + (M ? M.status() : 'no FFG.music') };
    ctx = M.ctx; node = M.master;
  }
  const rec = ctx.createScriptProcessor ? ctx.createScriptProcessor(16384, 2, 1) : null;
  if (!rec) return { err: 'no ScriptProcessor' };
  const chunks = []; let total = 0;
  const need = Math.floor(ctx.sampleRate * secs);
  rec.onaudioprocess = (e) => {
    if (total >= need) return;
    const a = e.inputBuffer.getChannelData(0), b = e.inputBuffer.getChannelData(1);
    const m = new Float32Array(a.length);
    for (let i = 0; i < a.length; i++) m[i] = (a[i] + b[i]) * 0.5;
    chunks.push(m); total += m.length;
  };
  node.connect(rec);
  // A ScriptProcessor only pulls if it reaches a destination; a zero gain keeps
  // it silent so this tap does not double the sound while it measures.
  const sink = ctx.createGain(); sink.gain.value = 0;
  rec.connect(sink); sink.connect(ctx.destination);

  const A = globalThis.SNOWFLOW && globalThis.SNOWFLOW.audio;
  const gmin = [9,9,9], gmax = [0,0,0];
  const poll = setInterval(() => {
    if (which === 'sfx' && A && A.wind) {
      const v = [A.wind.gLow.gain.value, A.wind.gMid.gain.value, A.wind.gTop.gain.value];
      for (let i = 0; i < 3; i++) { if (v[i] < gmin[i]) gmin[i] = v[i]; if (v[i] > gmax[i]) gmax[i] = v[i]; }
    }
  }, 40);

  const t0 = performance.now();
  while (total < need && performance.now() - t0 < (secs + 6) * 1000)
    await new Promise(r => setTimeout(r, 100));
  clearInterval(poll);
  node.disconnect(rec); rec.disconnect(); sink.disconnect(); rec.onaudioprocess = null;

  const all = new Float32Array(total); let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.length; }
  const bytes = new Uint8Array(all.buffer);
  let s = ''; const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH)
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  if (which === 'sfx' && A) {
    extra = { voices: A.voices, masterGain: A.master.gain.value,
              gainMin: gmin, gainMax: gmax,
              speed01: SNOWFLOW.character.speed01, surf: SNOWFLOW.character.surf };
  } else {
    const M = globalThis.FFG.music;
    extra = { status: M.status(), masterGain: M.master.gain.value, volume: M._volume };
  }
  return { sr: ctx.sampleRate, pcm: btoa(s), extra: extra };
}
"""


def a_weight(f):
    f = np.maximum(f, 1e-6)
    f2 = f ** 2
    ra = (12194.0 ** 2 * f2 ** 2) / (
        (f2 + 20.6 ** 2) *
        np.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) *
        (f2 + 12194.0 ** 2))
    return 20 * np.log10(np.maximum(ra, 1e-30)) + 2.00


def db(x):
    return -999.0 if x <= 1e-12 else 20.0 * np.log10(x)


def decode(res):
    return np.frombuffer(base64.b64decode(res["pcm"]), dtype="<f4").astype(np.float64)


def analyse(x, sr, label, t0=None, t1=None):
    seg = x if t0 is None else x[int(t0 * sr):int(t1 * sr)]
    if seg.size < 8192:
        return dict(label=label, empty=True)
    N, hop = 8192, 4096
    win = np.hanning(N)
    segs = [seg[i:i + N] * win for i in range(0, seg.size - N, hop)]
    psd = np.mean([np.abs(np.fft.rfft(s)) ** 2 for s in segs], axis=0)
    psd /= np.sum(win ** 2)
    freqs = np.fft.rfftfreq(N, 1 / sr)

    tot = float(np.sum(psd))
    aw = 10 ** (a_weight(freqs) / 10.0)
    tot_a = float(np.sum(psd * aw))

    def bandpow(lo, hi):
        m = (freqs >= lo) & (freqs < hi)
        return float(np.sum(psd[m]))

    m = (freqs >= 100) & (freqs <= 16000)
    p = np.maximum(psd[m], 1e-30)
    sfm = float(np.exp(np.mean(np.log(p))) / np.mean(p))

    return dict(
        label=label, empty=False,
        rms_db=db(np.sqrt(np.mean(seg ** 2))),
        peak_db=db(np.max(np.abs(seg))),
        a_db=db(np.sqrt(tot_a)),
        hi2k_db=db(np.sqrt(bandpow(2000, sr / 2))),
        hi4k_db=db(np.sqrt(bandpow(4000, sr / 2))),
        lo125_db=db(np.sqrt(bandpow(0, 125))),
        sfm=sfm,
        centroid=float(np.sum(freqs * psd) / max(tot, 1e-30)),
        pct_above_2k=100.0 * bandpow(2000, sr / 2) / max(tot, 1e-30),
    )


def show(a):
    if a.get("empty"):
        print(f"    {a['label']:<26} (too short)"); return
    print(f"    {a['label']:<26} flat {a['rms_db']:7.1f} | A-wt {a['a_db']:7.1f} |"
          f" >2k {a['hi2k_db']:7.1f} | >4k {a['hi4k_db']:7.1f} | <125 {a['lo125_db']:7.1f} |"
          f" SFM {a['sfm']:.3f} | cen {a['centroid']:5.0f}Hz | {a['pct_above_2k']:4.1f}%>2k")


def main():
    with sync_playwright() as pw:
        br = pw.chromium.launch(channel="chrome", headless=False, args=[
            "--enable-unsafe-webgpu", "--ignore-gpu-blocklist", "--use-angle=d3d11",
            "--disable-gpu-sandbox", "--autoplay-policy=no-user-gesture-required"])
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        pg.add_init_script(BOOT)
        pg.goto(URL, wait_until="load", timeout=120_000)
        end = time.time() + 180
        while time.time() < end and not pg.evaluate("window.__sfReady && window.__sfReady()"):
            pg.wait_for_timeout(400)
        pg.wait_for_timeout(1500)

        # Click the shell's real PLAY button: that is what starts the music bed.
        try:
            pg.get_by_text("PLAY", exact=True).first.click(timeout=8000)
            print("  clicked PLAY")
        except Exception as e:
            print("  PLAY click failed:", str(e)[:120]); pg.mouse.click(640, 400)
        pg.wait_for_timeout(3000)
        print("  sfx state :", pg.evaluate("() => SNOWFLOW.audio.state"))
        print("  music     :", pg.evaluate("() => FFG.music ? FFG.music.status() : 'none'"))
        print("  windStr   :", pg.evaluate("() => SNOWFLOW.S.windStrength"))

        print("\n== LIVE CAPTURES (real contexts, ScriptProcessor tap on each master) ==")
        for which, secs, note in [("sfx", 8, "standing still"), ("music", 8, "menu/gameplay bed")]:
            r = pg.evaluate(LIVETAP, {"which": which, "secs": secs})
            if "err" in r:
                print(f"    {which}: {r['err']}"); continue
            print(f"    [{which}] {note}  extra={json.dumps(r['extra'])[:300]}")
            show(analyse(decode(r), r["sr"], f"LIVE {which} ({note})"))

        # Walking: the top layer is speed-gated, so standing is not the whole story.
        pg.evaluate("() => window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyW',bubbles:true}))")
        pg.wait_for_timeout(1200)
        r = pg.evaluate(LIVETAP, {"which": "sfx", "secs": 6})
        if "err" not in r:
            print(f"    [sfx] WALKING  extra={json.dumps(r['extra'])[:300]}")
            show(analyse(decode(r), r["sr"], "LIVE sfx (walking)"))
        pg.evaluate("() => window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyW',bubbles:true}))")
        pg.wait_for_timeout(800)

        sr_live = r.get("sr", 44100)

        # ---------------------------------------------------------- offline
        base = dict(sr=int(sr_live), dur=12.0, master=0.8, sfx=1.0, strength=1.0,
                    speed01=0.0, surfBlend=0.0, pan=0.0, wind=True, surf=False,
                    crunch=False, mute=[], freezeT=None)

        print(f"\n== OFFLINE at {int(sr_live)} Hz, tail 6-12 s ==")
        cases = [
            ("bed ALL  stand",     dict()),
            ("bed LOW  stand",     dict(mute=["mid", "top"])),
            ("bed MID  stand",     dict(mute=["low", "top"])),
            ("bed TOP  stand",     dict(mute=["low", "mid"])),
            ("bed ALL  sp0.5",     dict(speed01=0.5)),
            ("bed LOW  sp0.5",     dict(speed01=0.5, mute=["mid", "top"])),
            ("bed MID  sp0.5",     dict(speed01=0.5, mute=["low", "top"])),
            ("bed TOP  sp0.5",     dict(speed01=0.5, mute=["low", "mid"])),
            ("bed ALL  sp1.0",     dict(speed01=1.0)),
            ("bed LOW  sp1.0",     dict(speed01=1.0, mute=["mid", "top"])),
            ("bed MID  sp1.0",     dict(speed01=1.0, mute=["low", "top"])),
            ("bed TOP  sp1.0",     dict(speed01=1.0, mute=["low", "mid"])),
        ]
        res = {}
        for label, over in cases:
            cfg = dict(base); cfg.update(over)
            rr = pg.evaluate(OFFLINE, cfg)
            res[label] = analyse(decode(rr), rr["sr"], label, 6.0, 12.0)
            show(res[label])

        print("\n== REFERENCE: one footstep, bed off ==")
        cfg = dict(base); cfg.update(dict(wind=False, crunch=True, fireAt=2.0, dur=4.0))
        rr = pg.evaluate(OFFLINE, cfg)
        x = decode(rr)
        foot = analyse(x, rr["sr"], "footstep 0-300ms", 2.0, 2.3)
        show(foot)

        print("\n== BED vs FOOTSTEP (the headroom the bed leaves the foreground) ==")
        for k in ["bed ALL  stand", "bed ALL  sp0.5", "bed ALL  sp1.0"]:
            print(f"    {k:<18} A-wt gap to footstep = "
                  f"{foot['a_db'] - res[k]['a_db']:+6.1f} dB   "
                  f">2k gap = {foot['hi2k_db'] - res[k]['hi2k_db']:+6.1f} dB")

        # ------------------------------------------------- stuck voice, tight
        print("\n== VOICE COUNT ==")
        print("    standing:", pg.evaluate("() => SNOWFLOW.audio.voices"))
        print("    during cast:", pg.evaluate(r"""() => {
            SNOWFLOW.spells.cast(1); return SNOWFLOW.audio.voices; }"""))
        pg.wait_for_timeout(1500)
        print("    1.5 s after cast:", pg.evaluate("() => SNOWFLOW.audio.voices"))
        print("    wind.live alone:", pg.evaluate("() => SNOWFLOW.audio.wind.live"),
              " surf.live:", pg.evaluate("() => SNOWFLOW.audio.surf.live"))

        # ------------------------------------------- noise buffer loop seam
        print("\n== NOISE BUFFER LOOP SEAM (equal-gain crossfade on uncorrelated noise) ==")
        print("   ", json.dumps(pg.evaluate(r"""
          async () => {
            const G = await import('/games/snowflow/src/audio/graph.js');
            const ctx = new OfflineAudioContext(1, 128, 48000);
            const b = G.noiseBuffer(ctx, false, 0x5f3a91c7);
            const d = b.getChannelData(0), n = d.length, X = 2048;
            const rms = (a, o, len) => { let s = 0; for (let i = 0; i < len; i++) s += a[o+i]*a[o+i];
                                          return Math.sqrt(s/len); };
            return { n: n, dur: n/48000,
                     rms_in_xfade_mid: rms(d, 900, 256),
                     rms_body:         rms(d, 60000, 256),
                     rms_xfade_all:    rms(d, 0, X),
                     dip_dB: 20*Math.log10(rms(d, 900, 256) / rms(d, 60000, 256)) };
          }"""), indent=None))

        br.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
