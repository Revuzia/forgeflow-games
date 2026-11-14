#!/usr/bin/env python
"""DRIFTWAKE — measure the SHIPPED page's real output signal.

windprobe.py renders the real WindBed through a REPLICA of the master chain in an
OfflineAudioContext. That is the right tool for a repeatable number, but it proves
nothing about what a player hears: it never loads index.html, never runs update(),
and never touches the music element.

This probe measures the actual thing. It taps `SNOWFLOW.audio.master` — the bus
every synthesised voice and every decoded sample is connected to — with an
AudioWorklet, which runs on the AUDIO thread and is therefore NOT starved by this
page's single-digit frame rate (the defect that made the old ScriptProcessor tap in
audioprobe3/4 unusable). The worklet accumulates raw PCM and posts it back; every
number below comes out of numpy, from samples the browser actually produced.

Four operating points, driven through the real input path:

  still   PLAY pressed, no keys, character at rest  -> the noise floor
  walk    W held                                    -> footsteps over the bed
  surf    W + right mouse held                      -> the carve hiss
  music   the shell's HTMLAudioElement, tapped via createMediaElementSource

The music tap is LAST on purpose: `createMediaElementSource` re-routes the element
into the tapping context permanently, so doing it earlier would change the page
under the three measurements above.

Analysis (`a_weight_db`, `bands`, `db`) is copied verbatim from windprobe.py so the
numbers here are directly comparable with windprobe_before.json / _after.json.

    python outputprobe.py
    python outputprobe.py --out outputprobe.json
"""
import argparse, base64, json, sys, time
import numpy as np
from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass

# `?menu=1` is REQUIRED, and it is not a convenience. main.js line 827: under
# `navigator.webdriver` the build takes the AUTOPLAY path, which skips the shell
# handover entirely — no menu, no Shell instance, and therefore NO MUSIC AT ALL.
# A probe run without it measures a page that has no music element to measure and
# would report the music silent while a real player hears it perfectly well.
URL = "http://localhost:8799/games/driftwake/index.html?menu=1"

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

# The meter. Runs on the audio thread; `process()` is called by the audio system
# every 128 frames regardless of what the main thread is doing, which is the whole
# reason this is a worklet and not a ScriptProcessor.
WORKLET = r"""
class FFGMeter extends AudioWorkletProcessor {
  constructor() {
    super();
    this.cap = Math.floor(sampleRate * 8);
    this.buf = new Float32Array(this.cap);
    this.n = 0; this.rec = false;
    this.port.onmessage = (e) => {
      const c = e.data && e.data.cmd;
      if (c === 'start') { this.n = 0; this.rec = true; }
      else if (c === 'stop') {
        this.rec = false;
        const out = this.buf.slice(0, this.n);
        this.port.postMessage({ sr: sampleRate, n: this.n, pcm: out }, [out.buffer]);
      }
    };
  }
  process(inputs) {
    const inp = inputs[0];
    if (this.rec && inp && inp.length) {
      const L = inp[0], R = inp[1] || inp[0];
      for (let i = 0; i < L.length && this.n < this.cap; i++) {
        this.buf[this.n++] = (L[i] + R[i]) * 0.5;
      }
    }
    return true;
  }
}
registerProcessor('ffg-meter', FFGMeter);
"""

# Install a meter on SNOWFLOW's own context, fanned out from `master`. `connect`
# ADDS a consumer, it does not move one, so the game's own path to the limiter and
# the destination is untouched and the page stays audible and unmodified.
INSTALL_SFX = r"""
async (src) => {
  const A = globalThis.SNOWFLOW && globalThis.SNOWFLOW.audio;
  if (!A || !A.ctx || !A.master) return { ok: false, why: 'no audio ctx/master' };
  const ctx = A.ctx;
  const url = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
  await ctx.audioWorklet.addModule(url);
  const m = new AudioWorkletNode(ctx, 'ffg-meter', { numberOfInputs: 1, numberOfOutputs: 1 });
  // Pulled by a silent path to the destination: a worklet with a dangling output
  // is not guaranteed to be run at all.
  const sink = ctx.createGain(); sink.gain.value = 0;
  m.connect(sink); sink.connect(ctx.destination);
  A.master.connect(m);
  window.__meter = m;
  window.__grab = (ms) => new Promise((res) => {
    m.port.onmessage = (e) => res({ sr: e.data.sr, n: e.data.n,
      pcm: (() => { const by = new Uint8Array(e.data.pcm.buffer); let s = '';
        const CH = 0x8000;
        for (let i = 0; i < by.length; i += CH) s += String.fromCharCode.apply(null, by.subarray(i, i + CH));
        return btoa(s); })() });
    m.port.postMessage({ cmd: 'start' });
    setTimeout(() => m.port.postMessage({ cmd: 'stop' }), ms);
  });
  return { ok: true, sr: ctx.sampleRate, state: ctx.state };
}
"""

# The music element. A second context, because the element is not in SNOWFLOW's.
INSTALL_MUSIC = r"""
async (src) => {
  const sh = globalThis.FFG && globalThis.FFG.shell;
  const a = sh && sh._music;
  if (!a) return { ok: false, why: 'shell has no _music element' };
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  await ctx.resume();
  const url = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
  await ctx.audioWorklet.addModule(url);
  const m = new AudioWorkletNode(ctx, 'ffg-meter', { numberOfInputs: 1, numberOfOutputs: 1 });
  const sink = ctx.createGain(); sink.gain.value = 0;
  m.connect(sink); sink.connect(ctx.destination);
  const srcNode = ctx.createMediaElementSource(a);
  srcNode.connect(m);
  srcNode.connect(ctx.destination);   // keep it audible
  window.__mmeter = m;
  window.__mgrab = (ms) => new Promise((res) => {
    m.port.onmessage = (e) => res({ sr: e.data.sr, n: e.data.n,
      pcm: (() => { const by = new Uint8Array(e.data.pcm.buffer); let s = '';
        const CH = 0x8000;
        for (let i = 0; i < by.length; i += CH) s += String.fromCharCode.apply(null, by.subarray(i, i + CH));
        return btoa(s); })() });
    m.port.postMessage({ cmd: 'start' });
    setTimeout(() => m.port.postMessage({ cmd: 'stop' }), ms);
  });
  return { ok: true, sr: ctx.sampleRate, volume: a.volume, paused: a.paused,
           readyState: a.readyState, currentTime: a.currentTime };
}
"""


def db(x):
    return -999.0 if x <= 1e-12 else 20.0 * np.log10(x)


def a_weight_db(x, sr):
    """A-weighted RMS in dBFS — windprobe.py's function, verbatim."""
    n = len(x)
    X = np.fft.rfft(x * np.hanning(n))
    f = np.fft.rfftfreq(n, 1.0 / sr)
    f = np.maximum(f, 1e-6)
    f2 = f * f
    ra = (12194.0**2 * f2**2) / (
        (f2 + 20.6**2) * np.sqrt((f2 + 107.7**2) * (f2 + 737.9**2)) * (f2 + 12194.0**2))
    a = 2.0 + 20.0 * np.log10(np.maximum(ra, 1e-20))
    w = 10.0 ** (a / 20.0)
    Xw = X * w
    p = (np.sum(np.abs(Xw) ** 2) * 2.0) / (n * n * 0.375)
    return db(np.sqrt(p))


def bands(x, sr):
    n = len(x)
    P = np.abs(np.fft.rfft(x * np.hanning(n))) ** 2
    f = np.fft.rfftfreq(n, 1.0 / sr)
    tot = P.sum() + 1e-30
    return (float(P[f < 500].sum() / tot),
            float(P[(f >= 500) & (f < 2000)].sum() / tot),
            float(P[f >= 2000].sum() / tot))


def envelope(x, sr, win_ms=50.0):
    """Per-window RMS in dB. A footstep is an EVENT: it shows up as spread between
    the loud windows and the quiet ones, and not at all in a 4 s mean."""
    w = max(1, int(sr * win_ms / 1000.0))
    m = (len(x) // w) * w
    if m == 0:
        return np.array([-999.0])
    f = x[:m].reshape(-1, w)
    r = np.sqrt(np.mean(f * f, axis=1))
    return np.array([db(v) for v in r])


def stats(x, sr, label):
    env = envelope(x, sr)
    return {
        "label": label,
        "secs": round(len(x) / sr, 3),
        "rms": db(np.sqrt(np.mean(x**2))),
        "a": a_weight_db(x, sr),
        "peak": db(np.max(np.abs(x))) if len(x) else -999.0,
        "bands": bands(x, sr),
        "env_p95": float(np.percentile(env, 95)),
        "env_p50": float(np.percentile(env, 50)),
        "env_p05": float(np.percentile(env, 5)),
        "crest": float(np.percentile(env, 95) - np.percentile(env, 50)),
    }


FIND_BTN = r"""
(re) => {
  const rx = new RegExp(re);
  const bs = Array.from(document.querySelectorAll('button'));
  for (const b of bs) {
    const t = (b.textContent || '').replace(/\s+/g, ' ').trim();
    if (!rx.test(t)) continue;
    const r = b.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: t };
  }
  return null;
}
"""


def click_button(pg, pattern):
    """A trusted click at the button's centre. Returns the label, or None."""
    hit = pg.evaluate(FIND_BTN, pattern)
    if not hit:
        return None
    pg.mouse.click(hit["x"], hit["y"])
    return hit["text"]


def grab(pg, fn, ms, label):
    r = pg.evaluate(f"(ms) => window.{fn}(ms)", ms)
    x = np.frombuffer(base64.b64decode(r["pcm"]), dtype="<f4").astype(np.float64)
    return stats(x, r["sr"], label), x, r["sr"]


def events(x, sr, floor_db, min_gap_ms=140.0):
    """Find discrete transients and report their peak levels.

    'Are the footsteps varied?' is not a question a 5 s mean can answer — five
    identical samples and five different ones give the same RMS. This isolates the
    individual footfalls and reports the SPREAD of their peaks. Five recordings
    played round-robin with per-trigger pitch jitter should show several dB of it;
    one sample on repeat would show almost none.
    """
    w = max(1, int(sr * 0.005))
    m = (len(x) // w) * w
    if m == 0:
        return {"n": 0}
    env = np.max(np.abs(x[:m].reshape(-1, w)), axis=1)
    thr = 10.0 ** (floor_db / 20.0)
    gap = int(min_gap_ms / 5.0)
    peaks, i = [], 0
    while i < len(env):
        if env[i] >= thr:
            j = min(len(env), i + gap)
            peaks.append(float(np.max(env[i:j])))
            i = j
        else:
            i += 1
    if not peaks:
        return {"n": 0}
    d = np.array([db(p) for p in peaks])
    return {"n": len(d), "mean": float(d.mean()), "min": float(d.min()),
            "max": float(d.max()), "spread": float(d.max() - d.min()),
            "sd": float(d.std())}


def line(s):
    lo, mi, hi = s["bands"]
    return (f"    {s['label']:<22} rms {s['rms']:7.2f}  A {s['a']:7.2f}  peak {s['peak']:7.2f} dBFS"
            f"   |  50ms env p05 {s['env_p05']:7.2f} p50 {s['env_p50']:7.2f} p95 {s['env_p95']:7.2f}"
            f"  crest {s['crest']:5.2f} dB"
            f"   |  <500 {lo*100:4.1f}%  .5-2k {mi*100:4.1f}%  >2k {hi*100:4.1f}%")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="outputprobe.json")
    ap.add_argument("--secs", type=float, default=5.0)
    args = ap.parse_args()
    out = {"points": {}, "facts": {}}

    with sync_playwright() as pw:
        br = pw.chromium.launch(channel="chrome", headless=False, args=[
            "--enable-unsafe-webgpu", "--ignore-gpu-blocklist", "--use-angle=d3d11",
            "--disable-gpu-sandbox", "--autoplay-policy=no-user-gesture-required"])
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        pg.add_init_script(BOOT)
        console = []
        pg.on("console", lambda m: console.append((m.type, m.text)))
        pg.goto(URL, wait_until="load", timeout=120_000)
        end = time.time() + 180
        while time.time() < end and not pg.evaluate("window.__sfReady && window.__sfReady()"):
            pg.wait_for_timeout(400)
        pg.wait_for_timeout(1000)

        # --- the title screen, BEFORE PLAY -------------------------------------
        out["facts"]["menu"] = pg.evaluate("""() => ({
            phase: FFG.shell ? FFG.shell.phase : null,
            musicElement: !!(FFG.shell && FFG.shell._music),
            musicVolume: FFG.shell ? FFG.shell.musicVolume : null,
            sfxVolume: FFG.sfxVolume,
            audioCtx: !!(SNOWFLOW.audio && SNOWFLOW.audio.ctx),
        })""")
        print("  title screen:", json.dumps(out["facts"]["menu"]))

        # --- PLAY: a real click, which is the gesture both paths need ----------
        # A REAL mouse click at the button's own coordinates, not `element.click()`:
        # a scripted click is not a user activation, and `audio.js` unlocks on
        # `pointerdown`, which `HTMLElement.click()` never dispatches.
        # Located by exact button text — `get_by_text("PLAY")` matches "HOW TO
        # PLAY" and, more entertainingly, the `<h2>Dis-PLAY</h2>` settings heading.
        if not click_button(pg, r"^\s*(▶\s*)?PLAY\s*$"):
            print("FAILED: no PLAY button found"); br.close(); return 1
        pg.wait_for_timeout(2500)

        out["facts"]["playing"] = pg.evaluate("""() => ({
            phase: FFG.shell.phase,
            sampleStatus: SNOWFLOW.audio.sampleStatus,
            musicStatus: FFG.musicStatus(),
            ctxState: SNOWFLOW.audio.ctx ? SNOWFLOW.audio.ctx.state : null,
        })""")
        print("  after PLAY  :", json.dumps(out["facts"]["playing"], indent=2)[:900])

        r = pg.evaluate(INSTALL_SFX, WORKLET)
        print("  sfx meter   :", r)
        if not r.get("ok"):
            print("FAILED to install the SFX meter"); br.close(); return 1

        # 1 -- STILL. Let the wind's Smoothed ramps settle first.
        pg.wait_for_timeout(2500)
        st_still, _, _ = grab(pg, "__grab", int(args.secs * 1000), "still (no input)")
        out["points"]["still"] = st_still
        out["facts"]["still_state"] = pg.evaluate(
            "() => ({speed: SNOWFLOW.character.speed, surf: SNOWFLOW.character.surf})")

        # 2 -- WALK. Longer window: footfalls are ~2/s, so a 5 s grab holds ~10.
        pg.keyboard.down("w")
        pg.wait_for_timeout(1800)
        st_walk, xw, srw = grab(pg, "__grab", 8000, "walk (W held)")
        out["points"]["walk"] = st_walk
        # Footfall peaks, isolated ~15 dB above the between-step floor.
        out["points"]["walk"]["events"] = events(xw, srw, st_walk["env_p50"] + 15.0)
        out["facts"]["walk_state"] = pg.evaluate(
            "() => ({speed: SNOWFLOW.character.speed, surf: SNOWFLOW.character.surf, "
            "samplesLive: SNOWFLOW.audio.samples.live})")

        # 3 -- SURF, at two carve states. A hiss that does not move with the turn
        # is not a carve, it is a texture, so measuring one held straight line
        # would answer the wrong question.
        pg.mouse.move(640, 400)
        pg.mouse.down(button="right")
        pg.wait_for_timeout(2600)
        out["facts"]["surf_straight_state"] = pg.evaluate(
            "() => ({speed: SNOWFLOW.character.speed, surf: SNOWFLOW.character.surf, "
            "carve: SNOWFLOW.character.carve, streak01: SNOWFLOW.character.streak01})")
        st_surf, _, _ = grab(pg, "__grab", int(args.secs * 1000), "surf, running straight")
        out["points"]["surf_straight"] = st_surf

        # Hard steer: A held turns the carve on.
        pg.keyboard.down("a")
        pg.wait_for_timeout(1600)
        out["facts"]["surf_carve_state"] = pg.evaluate(
            "() => ({speed: SNOWFLOW.character.speed, surf: SNOWFLOW.character.surf, "
            "carve: SNOWFLOW.character.carve, streak01: SNOWFLOW.character.streak01})")
        st_carve, _, _ = grab(pg, "__grab", int(args.secs * 1000), "surf, hard carve (A)")
        out["points"]["surf_carve"] = st_carve
        pg.keyboard.up("a")
        pg.mouse.up(button="right")
        pg.keyboard.up("w")
        pg.wait_for_timeout(2000)

        # 4 -- MUTE, through the page button's own event, to prove it reaches the bus.
        pg.evaluate("""() => { window.dispatchEvent(new CustomEvent('mutechange',
            {detail:{muted:true}})); }""")
        pg.wait_for_timeout(900)
        st_mute, _, _ = grab(pg, "__grab", 2000, "muted (mutechange)")
        out["points"]["muted"] = st_mute
        pg.evaluate("""() => { window.dispatchEvent(new CustomEvent('mutechange',
            {detail:{muted:false}})); }""")
        pg.wait_for_timeout(900)

        # 5 -- MUSIC. Last: this re-routes the element.
        mr = pg.evaluate(INSTALL_MUSIC, WORKLET)
        out["facts"]["music_install"] = mr
        print("  music meter :", mr)
        if mr.get("ok"):
            pg.wait_for_timeout(600)
            st_m1, _, _ = grab(pg, "__mgrab", 5000, f"music @ vol {mr['volume']:.2f} (default)")
            out["points"]["music_default"] = st_m1

            # Does the tap even SEE `.volume`? `createMediaElementSource` re-routes
            # the element, and if the volume attribute were applied downstream of
            # the tap every level below would be the file's own and the slider
            # would look dead when it is not. Settle this first, with a ladder.
            for v in (1.0, 0.1):
                pg.evaluate("(v) => { FFG.shell._music.volume = v; }", v)
                pg.wait_for_timeout(500)
                s, _, _ = grab(pg, "__mgrab", 5000, f"music @ element.volume {v:.2f}")
                out["points"][f"music_vol_{v:.2f}"] = s
            pg.evaluate("() => { FFG.shell._music.volume = FFG.shell.musicVolume; }")

            # Now the REAL slider, in the shell's own settings panel. Selected by
            # its label, not by index: DRIFTWAKE's F1 panel puts ~36 other range
            # inputs in this document and `input[type=range]:first` is one of them.
            pg.evaluate("() => FFG.shell.pause()")
            pg.wait_for_timeout(700)
            out["facts"]["settings_btn"] = click_button(pg, r"^\s*SETTINGS\s*$")
            pg.wait_for_timeout(700)
            for target, tag in ((100, "slider_100"), (10, "slider_10")):
                moved = pg.evaluate("""(t) => {
                    const ov = document.querySelector('.ffg-shell-overlay');
                    if (!ov) return {ok:false, why:'no shell overlay'};
                    const ins = Array.from(ov.querySelectorAll('input[type=range]'));
                    // The slider whose own wrapper is labelled MUSIC.
                    const el = ins.find(i => /MUSIC/.test(
                        (i.parentElement && i.parentElement.textContent) || ''));
                    if (!el) return {ok:false, why:'no MUSIC slider', n: ins.length,
                                     labels: ins.map(i => (i.parentElement||{}).textContent)};
                    const before = FFG.shell._music ? FFG.shell._music.volume : null;
                    el.value = String(t);
                    el.dispatchEvent(new Event('input', {bubbles:true}));
                    return {ok:true, shellSliders: ins.length, before,
                            after: FFG.shell._music ? FFG.shell._music.volume : null,
                            musicVolume: FFG.shell.musicVolume};
                }""", target)
                out["facts"][tag] = moved
                print(f"  MUSIC slider -> {target}%:", moved)
                pg.wait_for_timeout(700)
                s, _, _ = grab(pg, "__mgrab", 5000, f"music @ MUSIC slider {target}%")
                out["points"][f"music_{tag}"] = s

        out["facts"]["console_errors"] = [t for (k, t) in console if k == "error"]
        out["facts"]["page_errors"] = pg.evaluate("() => window.__errs")

        print("\n  LIVE OUTPUT — SNOWFLOW.audio.master, tapped on the audio thread")
        for k in ("still", "walk", "surf_straight", "surf_carve", "muted"):
            if k in out["points"]:
                print(line(out["points"][k]))
        ev = out["points"].get("walk", {}).get("events")
        if ev and ev.get("n"):
            print(f"    footfalls isolated: n={ev['n']}  peaks {ev['min']:.2f}..{ev['max']:.2f} dBFS"
                  f"  spread {ev['spread']:.2f} dB  sd {ev['sd']:.2f} dB")
        print("\n  MUSIC — the shell's HTMLAudioElement")
        for k in sorted(out["points"]):
            if k.startswith("music"):
                print(line(out["points"][k]))
        print("\n  state:", json.dumps({k: v for k, v in out["facts"].items()
                                        if k.endswith("_state")}))

        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(out, f, indent=1)
        print("\n  wrote", args.out)
        br.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
