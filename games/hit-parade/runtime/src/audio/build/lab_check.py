#!/usr/bin/env python
"""HIT PARADE audio lab check (lane AUDIO): open runtime/lab/audio.html in headless Chrome and run its three proofs.

    HP_FROZEN=1 npx vite --port 5328 --strictPort      # from the game root, in another shell
    python runtime/src/audio/build/lab_check.py [--url http://localhost:5328/lab/audio.html] [--headed] [--skip-play]

1. decode: every Ogg-Opus sprite / cue AND every AAC twin fetched and decoded by Chrome (OfflineAudioContext at 48 kHz);
   the decoded length must equal the manifest (Ogg) or the manifest +- the AAC priming; every sprite region audible
2. playAll: every sound variant + every music cue played through the realtime engine (a real click unlocks the
   context); the limiter output is metered per sound and per cue
3. bout: a synthetic bout through createAudio().events() - round flow, hits, a wall splat, a super, a KO
Also: every console error / page error / failed request is collected. Writes _harness/_reports/audio_lab.json.
Exit 0 = every proof passed with 0 decode errors, 1 otherwise, 2 setup failure. ASCII only.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.normpath(os.path.join(HERE, "..", "..", "..", ".."))
REPORT = os.path.join(GAME, "_harness", "_reports", "audio_lab.json")


def wait_result(page, key: str, timeout_s: float) -> dict:
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        r = page.evaluate(f"() => (window.__AUDIO_LAB__ && window.__AUDIO_LAB__.results['{key}']) || null")
        if r and r.get("done"):
            return r
        time.sleep(0.25)
    return {"done": False, "error": f"timeout after {timeout_s} s"}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:5328/lab/audio.html")
    ap.add_argument("--headed", action="store_true")
    ap.add_argument("--skip-play", action="store_true")
    a = ap.parse_args()
    try:
        from playwright.sync_api import sync_playwright
    except Exception as e:
        print(f"lab_check: SETUP playwright missing: {e}")
        return 2
    out: dict = {"url": a.url, "console_errors": [], "page_errors": [], "failed_requests": []}
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not a.headed, args=["--autoplay-policy=no-user-gesture-required", "--mute-audio"])
        page = browser.new_page()
        page.on("console", lambda m: out["console_errors"].append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: out["page_errors"].append(str(e)))
        page.on("requestfailed", lambda r: out["failed_requests"].append(f"{r.url} {r.failure}"))
        try:
            page.goto(a.url, wait_until="load", timeout=60000)
            page.wait_for_function("() => window.__AUDIO_LAB__ && window.__AUDIO_LAB__.ready", timeout=60000)
        except Exception as e:
            print(f"lab_check: SETUP page did not load: {e}")
            browser.close()
            return 2
        out["user_agent"] = page.evaluate("() => navigator.userAgent")
        out["can_play"] = page.evaluate("""() => { const a = document.createElement('audio');
            return { oggOpus: a.canPlayType('audio/ogg; codecs="opus"'), aac: a.canPlayType('audio/mp4; codecs="mp4a.40.2"') }; }""")
        page.click("#b-decode")
        out["decode"] = wait_result(page, "decode", 180)
        if not a.skip_play:
            page.click("#b-playall")
            out["playAll"] = wait_result(page, "playAll", 300)
            page.click("#b-bout")
            out["bout"] = wait_result(page, "bout", 120)
        browser.close()
    os.makedirs(os.path.dirname(REPORT), exist_ok=True)
    with open(REPORT, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1)
    problems = []
    dec = out["decode"].get("value") or {}
    rows = dec.get("rows", [])
    decode_errors = sum(1 for r in rows if r.get("error"))
    bad_rows = [f"{r['what']} {r['codec']}: {r.get('error') or ('frames ' + str(r['frames']) + ' want ' + r['want'] + (' silent ' + str(r.get('silentRegions')) if r.get('silentRegions') else ''))}"
                for r in rows if not r.get("ok")]
    if not rows:
        problems.append(f"decode proof did not run: {out['decode'].get('error')}")
    if bad_rows:
        problems.append("decode: " + "; ".join(bad_rows))
    print(f"decode: {len(rows)} decodes (Ogg + AAC of {len(rows) // 2} assets), {decode_errors} decode errors, {len(rows) - len(bad_rows)} exact")
    for r in rows:
        print(f"  {'OK ' if r.get('ok') else 'BAD'} {r['what']:22s} {r['codec']}  frames {r['frames']:8d}  want {r['want']:>16s}  {r['ms']:5d} ms"
              f"{'  silent regions ' + str(r['silentRegions']) if 'silentRegions' in r else ''}{'  ' + r['error'] if r.get('error') else ''}")
    if not a.skip_play:
        pa = out["playAll"].get("value") or {}
        if not pa:
            problems.append(f"playAll did not run: {out['playAll'].get('error')}")
        else:
            print(f"playAll: context {pa.get('state')} @ {pa.get('sampleRate')} Hz, sprites ready {pa.get('ready')}, played {pa.get('played')}/{pa.get('requested')} requested, "
                  f"not ready {pa.get('notReady')}, errors {len(pa.get('errors', []))}, quiet sounds {pa.get('quietSounds')}, quiet cues {pa.get('quietCues')}")
            print(f"  cue peaks (dBFS after the limiter): {pa.get('perCue')}")
            print(f"  codecs: {pa.get('codecs')}")
            if pa.get("errors"):
                problems.append(f"engine errors: {pa['errors']}")
            if not pa.get("ready") or pa.get("played", 0) < pa.get("requested", 1) or pa.get("quietSounds") or pa.get("quietCues"):
                problems.append("playAll: not every sound / cue produced output")
        bo = out["bout"].get("value") or {}
        if not bo:
            problems.append(f"bout demo did not run: {out['bout'].get('error')}")
        else:
            print(f"bout: played {bo.get('played')}, state {bo.get('state')}, errors {bo.get('errors')}, unknown {bo.get('unknown')}, "
                  f"events {bo.get('events')}, loops started {bo.get('loopStarts')}")
            if bo.get("errors") or bo.get("unknown") or not bo.get("played"):
                problems.append("bout demo: errors / unknown / nothing played")
    if out["page_errors"]:
        problems.append(f"page errors: {out['page_errors'][:3]}")
    if out["failed_requests"]:
        problems.append(f"failed requests: {out['failed_requests'][:3]}")
    print(f"console errors: {len(out['console_errors'])} {out['console_errors'][:3]}; page errors {len(out['page_errors'])}; failed requests {len(out['failed_requests'])}")
    print(f"lab_check: {'PASS' if not problems else 'FAIL'} - decode errors {decode_errors}" + ("" if not problems else " | " + " | ".join(problems)))
    return 0 if not problems else 1


if __name__ == "__main__":
    sys.exit(main())
