#!/usr/bin/env python
"""DRIFTWAKE audio diagnostic, pass 4 — calibrate both meters against a known tone.

Passes 2 and 3 left a 3.5 dB common-mode gap between the live ScriptProcessor tap
and the offline render of the same graph at pinned gains. Rather than argue about
it, inject a KNOWN signal into each path and see which meter reports it correctly:

    a 0.1-amplitude sine (exactly -20.00 dBFS RMS for a full-scale-1.0 reference,
    since RMS of a sine = A/sqrt(2) -> 0.0707 -> -23.01 dBFS)

Both paths get the identical generator. Whichever meter misreads the tone is the
one carrying the offset, and its readings get corrected or discarded.

    python audioprobe4.py
"""
import base64, sys, time
import numpy as np
from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass

URL = "http://localhost:8799/games/snowflow/index.html"
BOOT = r"""
(() => { window.__sfReady = () => {
    const SF = globalThis.SNOWFLOW;
    if (!SF || !SF.terrain || !SF.rig || !SF.character) return false;
    const b = document.getElementById('boot');
    return !(b && !b.classList.contains('gone')); }; })();
"""

# A 0.1-amplitude 1 kHz sine straight into the LIVE master, captured by the same
# ScriptProcessor tap pass 3 used.
LIVE_TONE = r"""
async (amp) => {
  const A = SNOWFLOW.audio, ctx = A.ctx;
  const o = ctx.createOscillator(); o.type='sine'; o.frequency.value=1000;
  const g = ctx.createGain(); g.gain.value = amp;
  o.connect(g); g.connect(A.master); o.start();
  // Silence the beds so the tone is the only thing on the bus.
  A.wind.silence(ctx.currentTime); A.surf.silence(ctx.currentTime);
  await new Promise(r => setTimeout(r, 400));

  const rec = ctx.createScriptProcessor(4096, 2, 1);
  const chunks=[]; let total=0; const need=Math.floor(ctx.sampleRate*3);
  rec.onaudioprocess = (e) => {
    if (total>=need) return;
    const a=e.inputBuffer.getChannelData(0), b=e.inputBuffer.getChannelData(1);
    const m=new Float32Array(a.length);
    for (let i=0;i<a.length;i++) m[i]=(a[i]+b[i])*0.5;
    chunks.push(m); total+=m.length;
  };
  A.master.connect(rec);
  const sink=ctx.createGain(); sink.gain.value=0; rec.connect(sink); sink.connect(ctx.destination);
  const t0=performance.now();
  while (total<need && performance.now()-t0<9000) await new Promise(r=>setTimeout(r,100));
  A.master.disconnect(rec); rec.disconnect(); sink.disconnect(); rec.onaudioprocess=null;
  o.stop(); g.disconnect();
  const all=new Float32Array(total); let off=0;
  for (const c of chunks){ all.set(c,off); off+=c.length; }
  const by=new Uint8Array(all.buffer); let s=''; const CH=0x8000;
  for (let i=0;i<by.length;i+=CH) s+=String.fromCharCode.apply(null,by.subarray(i,i+CH));
  return { sr: ctx.sampleRate, pcm: btoa(s), masterGain: A.master.gain.value };
}
"""

# The same tone through the same OFFLINE master chain.
OFF_TONE = r"""
async (cfg) => {
  const ctx = new OfflineAudioContext(2, Math.floor(cfg.sr*4), cfg.sr);
  const lim = ctx.createDynamicsCompressor();
  lim.threshold.value=-8; lim.knee.value=6; lim.ratio.value=6;
  lim.attack.value=0.004; lim.release.value=0.18;
  let tail = ctx.destination;
  if (cfg.lim) { lim.connect(ctx.destination); tail = lim; }
  const master = ctx.createGain(); master.gain.value = cfg.master; master.connect(tail);
  const o = ctx.createOscillator(); o.type='sine'; o.frequency.value=1000;
  const g = ctx.createGain(); g.gain.value = cfg.amp;
  o.connect(g); g.connect(master); o.start();
  const buf = await ctx.startRendering();
  const L=buf.getChannelData(0), R=buf.getChannelData(1);
  const mono=new Float32Array(buf.length);
  for (let i=0;i<buf.length;i++) mono[i]=(L[i]+R[i])*0.5;
  const by=new Uint8Array(mono.buffer); let s=''; const CH=0x8000;
  for (let i=0;i<by.length;i+=CH) s+=String.fromCharCode.apply(null,by.subarray(i,i+CH));
  return { sr: cfg.sr, pcm: btoa(s) };
}
"""


def db(x): return -999.0 if x <= 1e-12 else 20.0*np.log10(x)
def dec(r): return np.frombuffer(base64.b64decode(r["pcm"]), dtype="<f4").astype(np.float64)


def main():
    AMP = 0.1
    MASTER = 0.8
    # 0.1 sine through a 0.8 master = 0.08 peak -> RMS 0.08/sqrt(2) = 0.05657
    expect = db(AMP*MASTER/np.sqrt(2))
    print(f"  expected at the tap: {expect:.2f} dBFS RMS "
          f"(amp {AMP} x master {MASTER}, sine)")

    with sync_playwright() as pw:
        br = pw.chromium.launch(channel="chrome", headless=False, args=[
            "--enable-unsafe-webgpu","--ignore-gpu-blocklist","--use-angle=d3d11",
            "--disable-gpu-sandbox","--autoplay-policy=no-user-gesture-required"])
        pg = br.new_page(viewport={"width":1280,"height":720})
        pg.add_init_script(BOOT)
        pg.goto(URL, wait_until="load", timeout=120_000)
        end=time.time()+180
        while time.time()<end and not pg.evaluate("window.__sfReady && window.__sfReady()"):
            pg.wait_for_timeout(400)
        pg.wait_for_timeout(1500)
        pg.mouse.click(640,400); pg.wait_for_timeout(2500)

        r = pg.evaluate(LIVE_TONE, AMP)
        x = dec(r)[int(0.5*r["sr"]):]
        live = db(np.sqrt(np.mean(x**2)))
        print(f"  LIVE  tap (master={r['masterGain']:.3f}) : {live:7.2f} dBFS   "
              f"error {live-expect:+.2f} dB")

        for use_lim in (True, False):
            rr = pg.evaluate(OFF_TONE, {"sr": int(r["sr"]), "amp": AMP,
                                        "master": MASTER, "lim": use_lim})
            y = dec(rr)[int(0.5*rr["sr"]):]
            offv = db(np.sqrt(np.mean(y**2)))
            print(f"  OFFLINE tone, limiter={'on ' if use_lim else 'off'}      : "
                  f"{offv:7.2f} dBFS   error {offv-expect:+.2f} dB")

        br.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
