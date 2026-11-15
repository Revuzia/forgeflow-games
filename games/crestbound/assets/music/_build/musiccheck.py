#!/usr/bin/env python
"""CRESTBOUND — recorded-music proof (stage 1, music lane). Dev only: .py never ships to the CDN.

Drives the REAL page with REAL input and reads what the audio graph actually produces:

    python assets/music/_build/musiccheck.py                       # the Keep, via the title PLAY click
    python assets/music/_build/musiccheck.py --course verdant-1    # ?dev=1&course=verdant-1 (direct boot)
    python assets/music/_build/musiccheck.py --moods               # + setMusicMood boss/course/fanfare/clear

What it proves (each line printed with the number it read):
  * before the gesture: no AudioContext is running, nothing plays (bytes may already be fetched),
  * the page requested the realm's track from assets/music/ (the network log, status + bytes),
  * after a real mouse click: musicStats().playing is the realm's cue, the context is 'running',
  * an AnalyserNode TAPPED on the music bus (fan-out, the output is untouched) reads non-silent RMS,
  * the music volume setting reaches it (music 0 -> RMS ~0, back -> RMS returns),
  * --moods: the boss track crossfades in with no silent gap (RMS sampled every 100 ms across the switch),
    the fanfare / clear jingles play over a dipped loop, and 'course' returns to the realm's track.

--autoplay-policy=user-gesture-required (a desktop Chrome's rule; headless alone is lenient): Chrome enforces it.
One browser, headless, closed at the end. Exit 0 = every check passed.
"""
import argparse
import json
import os
import sys
import time

from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

BASE = "http://localhost:8788/games/crestbound/index.html"
FLAGS = [
    "--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
    "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion",
    # Headless Chrome lets an AudioContext run without a gesture (measured: a direct ?course= boot read 'running'
    # before any input). Pin the policy a real desktop Chrome applies, so the gesture rule is actually tested.
    "--autoplay-policy=user-gesture-required",
]
REALM_CUE = {"keep": "keep", "verdant": "verdant", "ember": "ember", "rime": "rime", "azure": "azure"}

STATS_JS = "() => { const a = globalThis.CRESTBOUND && CRESTBOUND.game && CRESTBOUND.game.audio; " \
           "return a && a.musicStats ? a.musicStats() : null; }"

# A tap on the music bus: musicBus -> analyser (a second output; the bus keeps its own destination).
TAP_JS = r"""() => {
  const a = CRESTBOUND.game.audio;
  if (!a || !a.ctx || !a.musicBus) return false;
  if (!window.__mtap) {
    const an = a.ctx.createAnalyser();
    an.fftSize = 2048;
    a.musicBus.connect(an);
    window.__mtap = { an, buf: new Float32Array(an.fftSize) };
  }
  return true;
}"""
RMS_JS = r"""() => {
  const t = window.__mtap; if (!t) return null;
  t.an.getFloatTimeDomainData(t.buf);
  let s = 0; for (let i = 0; i < t.buf.length; i++) s += t.buf[i] * t.buf[i];
  return Math.sqrt(s / t.buf.length);
}"""

# In-page clock: the click time and the first time a recorded loop is playing on a running context (ms, page clock).
TIMER_JS = r"""() => {
  if (window.__mt) return true;
  window.__mt = { click: null, firstPlay: null, cue: null };
  addEventListener('pointerdown', () => { if (window.__mt.click === null) window.__mt.click = performance.now(); }, true);
  const iv = setInterval(() => {
    const a = globalThis.CRESTBOUND && CRESTBOUND.game && CRESTBOUND.game.audio;
    const s = a && a.musicStats ? a.musicStats() : null;
    if (s && s.playing && s.state === 'running' && window.__mt.click !== null) {
      window.__mt.firstPlay = performance.now(); window.__mt.cue = s.playing; clearInterval(iv);
    }
  }, 50);
  return true;
}"""

PLAY_RECT_JS = r"""() => {
  const words = ['NEW GAME', 'CONTINUE', 'PLAY', 'START'];
  const btns = Array.from(document.querySelectorAll('button.cb-btn, button, [role=button]'));
  for (const w of words) for (const b of btns) {
    const r = b.getBoundingClientRect();
    if (b.disabled || r.width < 4 || r.height < 4) continue;
    if ((b.textContent || '').toUpperCase().indexOf(w) < 0) continue;
    return { word: w, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  return null;
}"""


def rms_series(pg, n, gap_ms):
    out = []
    for _ in range(n):
        v = pg.evaluate(RMS_JS)
        out.append(round(v, 5) if isinstance(v, (int, float)) else None)
        pg.wait_for_timeout(gap_ms)
    return out


def wait_for(pg, js, timeout_s, poll_ms=200):
    deadline = time.time() + timeout_s
    v = None
    while time.time() < deadline:
        try:
            v = pg.evaluate(js)
        except Exception:
            v = None
        if v:
            return v
        pg.wait_for_timeout(poll_ms)
    return v


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--course", default=None)
    ap.add_argument("--moods", action="store_true")
    ap.add_argument("--travel", default=None,
                    help="after the checks, load this course through game.loadCourse (the course-change path the "
                         "painting uses) and prove the realm track crossfades in, then returnToKeep()")
    ap.add_argument("--quality", default="low")
    ap.add_argument("--json", default=None)
    ap.add_argument("--wait", type=float, default=120.0)
    ap.add_argument("--music", choices=("synth", "m4a"), default=None,
                    help="synth: measure the procedural bed (loudness reference); m4a: force the AAC twins")
    ap.add_argument("--base", default=BASE, help="page URL without query (a private server under multi-lane load)")
    args = ap.parse_args()

    url = args.base + "?dev=1&quality=%s&autoscale=0" % args.quality
    if args.course:
        url += "&course=%s" % args.course
    if args.music:
        url += "&music=%s" % args.music
    checks, net, cerr, perr = [], [], [], []
    t_start = time.time()
    gesture_at = [None]

    def ok(name, cond, detail):
        checks.append({"check": name, "pass": bool(cond), "detail": detail})
        print("%s  %-34s %s" % ("PASS" if cond else "FAIL", name, detail), flush=True)

    def on_resp(r):
        if "/assets/music/" in r.url:
            net.append({"url": r.url.split("/assets/music/")[1], "status": r.status,
                        "len": r.headers.get("content-length"), "t": round(time.time() - t_start, 2),
                        "afterGesture": gesture_at[0] is not None})

    def on_fail(r):
        net.append({"url": r.url, "status": "FAILED " + str(r.failure), "t": round(time.time() - t_start, 2),
                    "afterGesture": gesture_at[0] is not None})

    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=True, args=FLAGS)
        try:
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            pg.on("console", lambda m: cerr.append(m.text) if m.type == "error" else None)
            pg.on("pageerror", lambda e: perr.append(str(e)))
            pg.on("response", on_resp)
            pg.on("requestfailed", on_fail)
            pg.goto(url, wait_until="load", timeout=90_000)
            ready = wait_for(pg, "!!(globalThis.CRESTBOUND && CRESTBOUND.game && CRESTBOUND.game.audio)", args.wait, 400)
            ok("boot", ready, "CRESTBOUND.game.audio present")
            if not ready:
                raise RuntimeError("boot")

            if args.course:
                wait_for(pg, "CRESTBOUND.game.state === 'playing' && CRESTBOUND.game.courseId === %s" % json.dumps(args.course),
                         args.wait, 400)
                pg.wait_for_timeout(1500)
                # The dev ?course= boot calls startAudio() with no gesture (game.js). A desktop Chrome then creates
                # the context SUSPENDED; headless Chrome lets it run (measured, even with the policy flag). Model
                # the desktop: suspend it, then prove audio.js's own gesture hook is what brings the music up.
                was = pg.evaluate("CRESTBOUND.game.audio.ctx ? CRESTBOUND.game.audio.ctx.state : 'none'")
                pg.evaluate("(async () => { const a = CRESTBOUND.game.audio; if (a.ctx) await a.ctx.suspend(); })()")
                pg.wait_for_timeout(300)
                pre = pg.evaluate(STATS_JS)
                ok("pre-gesture: context suspended", pre and pre["state"] == "suspended",
                   "ctx %s (headless had it %s; suspended to model a desktop Chrome), playing %s"
                   % (pre and pre["state"], was, pre and pre["playing"]))
                # REAL input: a mouse click on the canvas (the gesture the player makes first)
                pg.evaluate(TIMER_JS)
                gesture_at[0] = time.time()
                pg.mouse.click(640, 360)
            else:
                # Title: wait for the PLAY button, read the pre-gesture state, then a real mouse click on it.
                rect = wait_for(pg, PLAY_RECT_JS, args.wait, 400)
                pg.wait_for_timeout(800)
                pre = pg.evaluate(STATS_JS)
                ok("pre-gesture: no context, silent", pre and pre["state"] == "none" and pre["playing"] is None,
                   "ctx %s, playing %s, keep bytes %s" % (pre and pre["state"], pre and pre["playing"],
                                                          pre and pre["cues"]["keep"]["bytes"]))
                ok("title PLAY button found", rect, str(rect))
                if not rect:
                    raise RuntimeError("no PLAY button")
                pg.evaluate(TIMER_JS)
                gesture_at[0] = time.time()
                pg.mouse.click(rect["x"], rect["y"])

            if args.music == "synth":
                # Loudness reference: the procedural bed on the same music bus, same tap, same window.
                bed = wait_for(pg, "(() => { const s = (%s)(); return s && s.bedsActive > 0 && s.state === 'running' && !s.playing ? s : null; })()"
                               % STATS_JS, args.wait, 250)
                ok("procedural bed playing (?music=synth)", bool(bed), "bedsActive %s, recorded %s" % (bed and bed["bedsActive"], bed and bed["recorded"]))
                pg.evaluate(TAP_JS)
                pg.wait_for_timeout(2500)
                rs = rms_series(pg, 40, 100)
                ok("bed RMS (4 s)", min(x or 0 for x in rs) > 0.0, "mean %.4f  min %.4f  max %.4f" % (sum(rs) / len(rs), min(rs), max(rs)))
                raise RuntimeError("synth reference done")
            wait_for(pg, "window.__mt && window.__mt.firstPlay !== null", args.wait, 250)
            realm = pg.evaluate("CRESTBOUND.game.themeId")
            want = REALM_CUE.get(realm)
            playing = wait_for(pg, "(() => { const s = (%s)(); return s && s.playing === %s && s.state === 'running' ? s : null; })()"
                               % (STATS_JS, json.dumps(want)), 60, 250)
            st = pg.evaluate(STATS_JS)
            mt = pg.evaluate("window.__mt")
            lat = (mt["firstPlay"] - mt["click"]) / 1000.0 if mt and mt.get("firstPlay") and mt.get("click") else None
            ok("realm track playing after gesture", bool(playing),
               "theme %s (game state %s) -> playing %s, ctx %s, codec %s, decoded %s s, level %s; first played %s s after the click (page clock)"
               % (realm, pg.evaluate("CRESTBOUND.game.state"), st["playing"], st["state"],
                  st["cues"].get(want or "", {}).get("codec"), st["cues"].get(want or "", {}).get("seconds"), st["level"],
                  "%.2f" % lat if lat is not None else None))
            ok("procedural beds retired", st["bedsActive"] == 0 or st["playing"], "bedsActive %s" % st["bedsActive"])
            ok("no music errors", not st["errors"], str(st["errors"]))

            ok("codec as asked", st["cues"][want]["codec"] == ("m4a" if args.music == "m4a" else "ogg"),
               "codec %s, decoded %s s, priming offset skipped %s s (manifest loop %s s)"
               % (st["cues"][want]["codec"], st["cues"][want]["seconds"], st["cues"][want]["off"],
                  pg.evaluate("(async () => (await import('./assets/music/manifest.js')).MUSIC_CUES[%s].seconds)()" % json.dumps(want))))
            pg.evaluate(TAP_JS)
            pg.wait_for_timeout(1600)                       # past the 1.2 s fade-in
            r1 = rms_series(pg, 40, 100)
            # mean, not min: a track's own rests read ~0.002 in one 2048-sample window (verdant measured)
            ok("music bus is audible (RMS, 4 s)", sum(x or 0 for x in r1) / len(r1) > 0.01,
               "mean %.4f  min %.4f  max %.4f" % (sum(r1) / len(r1), min(r1), max(r1)))
            p1 = pg.evaluate(STATS_JS)["pos"]
            pg.wait_for_timeout(1000)
            p2 = pg.evaluate(STATS_JS)["pos"]
            ok("track position advances", isinstance(p1, (int, float)) and isinstance(p2, (int, float)) and p2 != p1,
               "pos %s -> %s s" % (p1, p2))

            # The music volume setting reaches the recorded track (setVolumes is what the settings slider calls).
            vol0 = pg.evaluate("CRESTBOUND.game.audio.vol.music")
            pg.evaluate("CRESTBOUND.game.audio.setVolumes({music: 0})")
            pg.wait_for_timeout(400)
            r0 = rms_series(pg, 5, 100)
            pg.evaluate("CRESTBOUND.game.audio.setVolumes({music: %s})" % json.dumps(vol0))
            pg.wait_for_timeout(400)
            rb = rms_series(pg, 5, 100)
            ok("music volume 0 silences it", max(x or 0 for x in r0) < 0.001, "RMS at music=0: %s" % r0)
            ok("music volume restored", min(x or 0 for x in rb) > 0.005, "RMS at music=%s: %s" % (vol0, rb))

            if args.moods:
                # boss: crossfade with no gap
                pg.evaluate("CRESTBOUND.game.audio.setMusicMood('boss')")
                t0 = time.time()
                got = wait_for(pg, "(() => { const s = (%s)(); return s && s.playing === 'boss' ? s : null; })()" % STATS_JS, 60, 50)
                xf = rms_series(pg, 16, 100)                 # 1.6 s across the 1.2 s crossfade
                ok("setMusicMood('boss') -> boss track", bool(got),
                   "playing %s after %.1f s (fetch + decode on demand)" % (got and got["playing"], time.time() - t0))
                ok("crossfade has no silent gap", min(x or 0 for x in xf) > 0.001, "RMS every 100 ms: %s" % xf)
                # back to course
                pg.evaluate("CRESTBOUND.game.audio.setMusicMood('course')")
                back = wait_for(pg, "(() => { const s = (%s)(); return s && s.playing === %s ? s : null; })()"
                                % (STATS_JS, json.dumps(want)), 30, 50)
                ok("setMusicMood('course') -> realm track", bool(back), "playing %s" % (back and back["playing"]))
                pg.wait_for_timeout(1500)
                # fanfare: the jingle plays, the loop dips
                pre_j = rms_series(pg, 3, 100)
                handled = pg.evaluate("CRESTBOUND.game.audio.setMusicMood('fanfare')")
                pg.wait_for_timeout(500)
                sj = pg.evaluate(STATS_JS)
                duck = pg.evaluate("CRESTBOUND.game.audio.musicDuck.gain.value")
                ok("setMusicMood('fanfare') plays the jingle", handled and sj["jingle"] == "fanfare",
                   "returned %s, jingle %s, loop duck gain %.3f (loop RMS before %s)" % (handled, sj["jingle"], duck, pre_j))
                pg.wait_for_timeout(4800)
                after = pg.evaluate(STATS_JS)
                duck2 = pg.evaluate("CRESTBOUND.game.audio.musicDuck.gain.value")
                ok("fanfare ends, loop returns", after["jingle"] is None and duck2 > 0.95,
                   "jingle %s, duck gain %.3f, playing %s" % (after["jingle"], duck2, after["playing"]))
                # clear (from the boss track: the loop returns to the course track)
                pg.evaluate("CRESTBOUND.game.audio.setMusicMood('boss')")
                wait_for(pg, "(() => { const s = (%s)(); return s && s.playing === 'boss' ? s : null; })()" % STATS_JS, 30, 100)
                handled = pg.evaluate("CRESTBOUND.game.audio.setMusicMood('clear')")
                pg.wait_for_timeout(300)
                sc = pg.evaluate(STATS_JS)
                ok("setMusicMood('clear') plays the jingle", handled and sc["jingle"] == "clear",
                   "returned %s, jingle %s, loop target %s" % (handled, sc["jingle"], sc["target"]))
                back2 = wait_for(pg, "(() => { const s = (%s)(); return s && s.playing === %s ? s : null; })()"
                                 % (STATS_JS, json.dumps(want)), 30, 100)
                ok("clear returns the loop to the realm track", bool(back2), "playing %s" % (back2 and back2["playing"]))
                # module-level export
                mod = pg.evaluate("import('./runtime/core/audio.js').then(m => typeof m.setMusicMood)")
                ok("module export setMusicMood", mod == "function", "typeof %s" % mod)
                fin = pg.evaluate(STATS_JS)
                ok("no music errors after moods", not fin["errors"], str(fin["errors"]))
                ok("decoded PCM bounded", fin["decodedMB"] < 120, "decodedMB %s" % fin["decodedMB"])

            if args.travel:
                start = pg.evaluate(STATS_JS)["playing"]
                pg.evaluate("CRESTBOUND.game.loadCourse(%s).catch(e => { window.__travelErr = String(e); })" % json.dumps(args.travel))
                t0 = time.time()
                arrived = wait_for(pg, "CRESTBOUND.game.state === 'playing' && CRESTBOUND.game.courseId === %s" % json.dumps(args.travel),
                                   args.wait, 250)
                realm2 = pg.evaluate("CRESTBOUND.game.themeId")
                want2 = REALM_CUE.get(realm2)
                got2 = wait_for(pg, "(() => { const s = (%s)(); return s && s.playing === %s ? s : null; })()"
                                % (STATS_JS, json.dumps(want2)), 60, 100)
                rt = rms_series(pg, 20, 100)
                ok("course change -> realm track", bool(arrived) and bool(got2) and want2 != start,
                   "%s -> %s: theme %s, playing %s, %.1f s after loadCourse (course build included); travel err %s"
                   % (start, args.travel, realm2, got2 and got2["playing"], time.time() - t0,
                      pg.evaluate("window.__travelErr || null")))
                ok("realm track audible after the change", sum(x or 0 for x in rt) / len(rt) > 0.01,
                   "mean %.4f  min %.4f" % (sum(rt) / len(rt), min(rt)))
                pg.evaluate("CRESTBOUND.game.returnToKeep().catch(e => { window.__travelErr = String(e); })")
                back = wait_for(pg, "(() => { const s = (%s)(); return s && s.playing === 'keep' && CRESTBOUND.game.state === 'keep' ? s : null; })()"
                                % STATS_JS, args.wait, 250)
                ok("returnToKeep -> keep track", bool(back), "playing %s, beds %s, errors %s"
                   % (back and back["playing"], back and back["bedsActive"], back and back["errors"]))

            final = pg.evaluate(STATS_JS)
        except RuntimeError as e:
            final = {"aborted": str(e)}
            want = None if args.music != "synth" else "-"
        finally:
            br.close()

    music_net = [n for n in net if n.get("status") == 200 or "FAILED" in str(n.get("status"))]
    print("-" * 78)
    print("network (assets/music + any failed request):")
    for n in net:
        print("  %s" % json.dumps(n))
    # Only music requests are this lane's: other subsystems' failures are printed above, not judged here.
    bad_net = [n for n in net if ("/assets/music/" in n["url"] or "://" not in n["url"])
               and ("FAILED" in str(n.get("status")) or (isinstance(n.get("status"), int) and n["status"] >= 400))]
    if args.music != "synth":
      ok("music requested over the network", any(n["status"] == 200 and n["url"].startswith((want or "?") + ".") for n in net
                                               if isinstance(n.get("status"), int)),
         "%d music responses" % len([n for n in net if isinstance(n.get("status"), int)]))
    ok("no failed music requests", not bad_net, str(bad_net)[:400])
    ok("zero console/page errors", not cerr and not perr, "console %s / page %s" % (cerr[:5], perr[:5]))
    passed = all(c["pass"] for c in checks)
    print("RESULT: %s (%d checks)" % ("PASS" if passed else "FAIL", len(checks)))
    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump({"url": url, "checks": checks, "network": net, "final": final,
                       "consoleErrors": cerr, "pageErrors": perr}, f, indent=1)
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
