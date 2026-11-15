"""Chrome DynamicsCompressor auto makeup gain for the SFX glue settings (below-threshold gain)."""
import sys, json
from playwright.sync_api import sync_playwright
with sync_playwright() as pw:
    b = pw.chromium.launch(channel="chrome", headless=True)
    p = b.new_page(); p.goto("about:blank")
    r = p.evaluate("""async ([thr, knee, ratio]) => {
      const out = [];
      for (const amp of [0.001, 0.003, 0.01, 0.03, 0.1, 0.3]) {
        const ac = new OfflineAudioContext(1, 48000, 48000);
        const o = ac.createOscillator(); o.frequency.value = 440; const g = ac.createGain(); g.gain.value = amp;
        const c = ac.createDynamicsCompressor(); c.threshold.value = thr; c.knee.value = knee; c.ratio.value = ratio; c.attack.value = 0.008; c.release.value = 0.3;
        o.connect(g); g.connect(c); c.connect(ac.destination); o.start();
        const buf = await ac.startRendering(); const d = buf.getChannelData(0);
        let s = 0; for (let i = 24000; i < 48000; i++) s += d[i] * d[i];
        const rms = Math.sqrt(s / 24000), inRms = amp / Math.SQRT2;
        out.push({ inDb: +(20 * Math.log10(inRms)).toFixed(1), gainDb: +(20 * Math.log10(rms / inRms)).toFixed(2) });
      }
      return out; }""", [float(sys.argv[1]), float(sys.argv[2]), float(sys.argv[3])])
    print(json.dumps(r)); b.close()
