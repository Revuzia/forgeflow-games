#!/usr/bin/env python
"""DRIFTWAKE audio diagnostic, pass 3 — reconcile live vs offline, and the shell.

Pass 2's live tap read 4.4 dB below the offline render of the same graph at the
same gains. A 4.4 dB unexplained gap makes every absolute dBFS number suspect, so
this pass finds out which of the two is lying before anything is reported.

Suspects for the gap, in order of cost to test:
  1. FFG.sfxVolume != 1 in the live page (a straight scalar on every level)
  2. the wind panner: a mono downmix of a hard-panned source loses up to 3 dB
  3. ScriptProcessor starvation — this page runs at single-digit fps and a
     starved onaudioprocess drops or zeroes buffers, which drags RMS down
  4. filter/gain state actually differing from the offline replica

It also settles whether FFG.music exists at all, since pass 2 got 'no FFG.music'
while index.html demonstrably loads runtime/music.js.

    python audioprobe3.py
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
  window.__errs = [];
  addEventListener('error', e => window.__errs.push(String(e.message)));
  window.__sfReady = () => {
    const SF = globalThis.SNOWFLOW;
    if (!SF || !SF.terrain || !SF.rig || !SF.character) return false;
    const b = document.getElementById('boot');
    return !(b && !b.classList.contains('gone'));
  };
})();
"""

# Live state dump: every scalar that feeds a level, so the offline replica can be
# driven to the identical operating point.
STATE = r"""() => {
  const A = SNOWFLOW.audio, W = A.wind, S = A.surf;
  return {
    sfxVolume: globalThis.FFG ? globalThis.FFG.sfxVolume : 'FFG undefined',
    hasShell: !!(globalThis.FFG && globalThis.FFG.Shell),
    hasMusicCtor: !!(globalThis.FFG && globalThis.FFG.MusicBed),
    musicInstance: !!(globalThis.FFG && globalThis.FFG.music),
    musicStatus: (globalThis.FFG && globalThis.FFG.music) ? FFG.music.status() : null,
    shellInstance: !!(globalThis.FFG && globalThis.FFG.shell),
    errs: window.__errs.slice(0, 6),
    sampleRate: A.ctx.sampleRate, state: A.ctx.state,
    masterGain: A.master.gain.value,
    windStrength: SNOWFLOW.S.windStrength, windDirection: SNOWFLOW.S.windDirection,
    yaw: SNOWFLOW.rig.yaw, speed01: SNOWFLOW.character.speed01,
    surfBlend: SNOWFLOW.character.surf,
    gLow: W.gLow.gain.value, gMid: W.gMid.gain.value, gTop: W.gTop.gain.value,
    fLow: W.fLow.frequency.value, fMid: W.fMid.frequency.value, fTop: W.fTop.frequency.value,
    qLow: W.fLow.Q.value, qMid: W.fMid.Q.value, qTop: W.fTop.Q.value,
    windPan: W.pan.pan.value,
    surfHiss: S.gHiss.gain.value, surfBody: S.gBody.gain.value,
    windLevel: W.level, surfLevel: S.level,
    fps: SNOWFLOW.perf ? SNOWFLOW.perf.fps : null,
  };
}"""

# Same ScriptProcessor tap as pass 2, but it now reports per-chunk RMS and the
# zero-sample fraction so starvation is visible instead of silently averaged in.
LIVETAP = r"""
async (secs) => {
  const A = SNOWFLOW.audio, ctx = A.ctx;
  const rec = ctx.createScriptProcessor(4096, 2, 1);
  const chunks = []; const chunkRms = []; let total = 0, zeros = 0;
  const need = Math.floor(ctx.sampleRate * secs);
  rec.onaudioprocess = (e) => {
    if (total >= need) return;
    const a = e.inputBuffer.getChannelData(0), b = e.inputBuffer.getChannelData(1);
    const m = new Float32Array(a.length); let s = 0;
    for (let i = 0; i < a.length; i++) {
      m[i] = (a[i] + b[i]) * 0.5; s += m[i]*m[i]; if (m[i] === 0) zeros++;
    }
    chunkRms.push(Math.sqrt(s / a.length));
    chunks.push(m); total += m.length;
  };
  A.master.connect(rec);
  const sink = ctx.createGain(); sink.gain.value = 0;
  rec.connect(sink); sink.connect(ctx.destination);
  const t0 = performance.now();
  while (total < need && performance.now() - t0 < (secs + 8) * 1000)
    await new Promise(r => setTimeout(r, 100));
  A.master.disconnect(rec); rec.disconnect(); sink.disconnect(); rec.onaudioprocess = null;
  const all = new Float32Array(total); let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.length; }
  const bytes = new Uint8Array(all.buffer);
  let s = ''; const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH)
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return { sr: ctx.sampleRate, pcm: btoa(s), n: total,
           zeroFrac: zeros / total, chunks: chunkRms.length,
           chunkRmsMin: Math.min.apply(null, chunkRms),
           chunkRmsMax: Math.max.apply(null, chunkRms),
           chunkRmsMed: chunkRms.slice().sort((x,y)=>x-y)[chunkRms.length>>1] };
}
"""

# An OFFLINE render driven to a FROZEN operating point read off the live page,
# including the live pan, so the two are comparable sample for sample.
OFFLINE_PINNED = r"""
async (cfg) => {
  const V = await import('/games/snowflow/src/audio/voices.js');
  const G = await import('/games/snowflow/src/audio/graph.js');
  const SR = cfg.sr, DUR = cfg.dur, STEP = 1/20;
  const ctx = new OfflineAudioContext(2, Math.floor(SR*DUR), SR);
  const lim = ctx.createDynamicsCompressor();
  lim.threshold.value=-8; lim.knee.value=6; lim.ratio.value=6;
  lim.attack.value=0.004; lim.release.value=0.18; lim.connect(ctx.destination);
  const master = ctx.createGain(); master.gain.value = cfg.master; master.connect(lim);
  const white = G.noiseBuffer(ctx, false, 0x5f3a91c7);
  const pink  = G.noiseBuffer(ctx, true,  0x1d7be40b);
  const wind = new V.WindBed(ctx, white, pink, master);
  const nSteps = Math.floor(DUR/STEP);
  for (let i = 1; i < nSteps; i++) {
    ctx.suspend(i*STEP).then(() => {
      const now = ctx.currentTime;
      // Pin the gains and filters to the exact live values, bypassing the gust.
      wind.sLow.write(cfg.mute.indexOf('low')>=0 ? 0 : cfg.gLow, now);
      wind.sMid.write(cfg.mute.indexOf('mid')>=0 ? 0 : cfg.gMid, now);
      wind.sTop.write(cfg.mute.indexOf('top')>=0 ? 0 : cfg.gTop, now);
      wind.sLowF.write(cfg.fLow, now);
      wind.sMidF.write(cfg.fMid, now);
      wind.sTopF.write(cfg.fTop, now);
      wind.sTopQ.write(cfg.qTop, now);
      wind.sPan.write(cfg.windPan, now);
      ctx.resume();
    });
  }
  const buf = await ctx.startRendering();
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  const mono = new Float32Array(buf.length);
  for (let i = 0; i < buf.length; i++) mono[i] = (L[i]+R[i])*0.5;
  const bytes = new Uint8Array(mono.buffer);
  let s=''; const CH=0x8000;
  for (let i=0;i<bytes.length;i+=CH) s += String.fromCharCode.apply(null, bytes.subarray(i,i+CH));
  return { sr: SR, pcm: btoa(s) };
}
"""


def a_weight(f):
    f = np.maximum(f, 1e-6); f2 = f**2
    ra = (12194.0**2 * f2**2) / ((f2+20.6**2) *
         np.sqrt((f2+107.7**2)*(f2+737.9**2)) * (f2+12194.0**2))
    return 20*np.log10(np.maximum(ra,1e-30)) + 2.00


def db(x): return -999.0 if x <= 1e-12 else 20.0*np.log10(x)
def decode(r): return np.frombuffer(base64.b64decode(r["pcm"]), dtype="<f4").astype(np.float64)


def analyse(x, sr, label):
    N, hop = 8192, 4096
    win = np.hanning(N)
    segs = [x[i:i+N]*win for i in range(0, max(1, x.size-N), hop)]
    psd = np.mean([np.abs(np.fft.rfft(s))**2 for s in segs], axis=0) / np.sum(win**2)
    fr = np.fft.rfftfreq(N, 1/sr)
    aw = 10**(a_weight(fr)/10.0)
    bp = lambda lo, hi: float(np.sum(psd[(fr>=lo)&(fr<hi)]))
    m = (fr>=100)&(fr<=16000); p = np.maximum(psd[m],1e-30)
    return dict(label=label, rms_db=db(np.sqrt(np.mean(x**2))),
                a_db=db(np.sqrt(float(np.sum(psd*aw)))),
                hi2k_db=db(np.sqrt(bp(2000, sr/2))),
                sfm=float(np.exp(np.mean(np.log(p)))/np.mean(p)),
                centroid=float(np.sum(fr*psd)/max(float(np.sum(psd)),1e-30)))


def show(a):
    print(f"    {a['label']:<34} flat {a['rms_db']:7.1f} | A-wt {a['a_db']:7.1f} |"
          f" >2k {a['hi2k_db']:7.1f} | SFM {a['sfm']:.3f} | cen {a['centroid']:5.0f}Hz")


def main():
    with sync_playwright() as pw:
        br = pw.chromium.launch(channel="chrome", headless=False, args=[
            "--enable-unsafe-webgpu","--ignore-gpu-blocklist","--use-angle=d3d11",
            "--disable-gpu-sandbox","--autoplay-policy=no-user-gesture-required"])
        pg = br.new_page(viewport={"width":1280,"height":720})
        pg.add_init_script(BOOT)
        pg.goto(URL, wait_until="load", timeout=120_000)
        end = time.time()+180
        while time.time()<end and not pg.evaluate("window.__sfReady && window.__sfReady()"):
            pg.wait_for_timeout(400)
        pg.wait_for_timeout(1500)
        pg.mouse.click(640, 400)
        pg.wait_for_timeout(2500)

        st = pg.evaluate(STATE)
        print("== LIVE STATE ==")
        for k, v in st.items():
            print(f"    {k:<16} {v}")

        print("\n== LIVE TAP, standing, 8 s (with starvation instrumentation) ==")
        r = pg.evaluate(LIVETAP, 8)
        print(f"    chunks={r['chunks']}  zeroFrac={r['zeroFrac']:.6f}  "
              f"chunkRMS min/med/max = {db(r['chunkRmsMin']):.1f} / "
              f"{db(r['chunkRmsMed']):.1f} / {db(r['chunkRmsMax']):.1f} dBFS")
        live = decode(r)
        show(analyse(live, r["sr"], "LIVE (measured)"))

        st2 = pg.evaluate(STATE)   # gains right after the capture, for pinning
        gl = (st["gLow"]+st2["gLow"])/2
        gm = (st["gMid"]+st2["gMid"])/2
        gt = (st["gTop"]+st2["gTop"])/2
        print(f"\n    pinning offline to live gains: low={gl:.5f} mid={gm:.5f} top={gt:.5f} "
              f"pan={st['windPan']:.3f}")

        pin = dict(sr=int(st["sampleRate"]), dur=10.0, master=st["masterGain"],
                   gLow=gl, gMid=gm, gTop=gt,
                   fLow=st["fLow"], fMid=st["fMid"], fTop=st["fTop"],
                   qTop=st["qTop"], windPan=st["windPan"], mute=[])

        print("\n== OFFLINE PINNED to the live operating point ==")
        rr = pg.evaluate(OFFLINE_PINNED, pin)
        off = decode(rr)[int(4*rr["sr"]):]
        show(analyse(off, rr["sr"], "OFFLINE (pinned, all layers)"))

        # Same pin, pan forced to 0, to price the mono-downmix effect.
        p0 = dict(pin); p0["windPan"] = 0.0
        rr0 = pg.evaluate(OFFLINE_PINNED, p0)
        show(analyse(decode(rr0)[int(4*rr0["sr"]):], rr0["sr"], "OFFLINE (pinned, pan=0)"))

        print("\n== OFFLINE PINNED, per layer (live operating point) ==")
        for lbl, mute in [("LOW only", ["mid","top"]), ("MID only", ["low","top"]),
                          ("TOP only", ["low","mid"]), ("no TOP", ["top"]),
                          ("no MID", ["mid"]), ("no LOW", ["low"])]:
            c = dict(pin); c["mute"] = mute
            rx = pg.evaluate(OFFLINE_PINNED, c)
            show(analyse(decode(rx)[int(4*rx["sr"]):], rx["sr"], lbl))

        br.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
