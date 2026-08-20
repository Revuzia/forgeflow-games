#!/usr/bin/env python
"""
BLACKRIDGE deployverify — prove the DEPLOYED game (harness_plan §2.6).

    python deployverify.py --expect-version v7 --fingerprint "<marker>"
    python deployverify.py ... --fingerprint-path runtime/boot.js
    python deployverify.py ... --recheck-after 300   # CDN staleness window
    python deployverify.py ... --perf                # + perf-static on the CDN

Doctrine §5 verbatim: exit-code-0 deploys have lied. After every R2 upload:
  1. Fetch index.html (+ boot.js?v=N): HTTP 200, correct content-type.
  2. Version fingerprint: the page must reference the CURRENT boot.js?v=N,
     and --fingerprint must be a marker that exists ONLY in the new code —
     pick it from the actual diff each deploy (a grep against an old marker
     is how stale CDN slipped through before). Both are REQUIRED arguments:
     this script refuses to bless a deploy it cannot fingerprint.
  3. Headed boot of the live URL: clean boot, zero shader errors, zero page
     errors (bootcheck logic inline).
  4. ONE production bot-match via the test surface: startMission({seed}) +
     rusher persona; assert counters moved (shotsFired > 0, >= 1 kill or
     death) and the engagement resolved. __FPS__.version must equal
     --expect-version.
  5. --perf: perfprobe's perf-static phase numbers against the CDN (report).

CDN edge staleness: on fingerprint failure with --recheck-after N, wait and
re-check ONCE; if it still fails, the honest report is "action taken,
verification pending" (exit 5) — never re-trigger the deploy from here.

Report deployed state SEPARATELY from local readiness. Exit 0 = the live
game observably plays. 1 = a check failed. 2 = fetch/nav failure.
5 = fingerprint pending after recheck window.
"""
import argparse, json, sys, time, urllib.request

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

DEFAULT_URL = "https://forgeflow-games-cdn.isimcha85.workers.dev/blackridge/index.html"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]
READY_EXPR = "!!(globalThis.__FPS__ && __FPS__.renderer && __FPS__.sim)"  # R11
SHADER_MARKERS = ("THREE.WebGLProgram", "THREE.WebGLShader", "ERROR:",
                  "gl.getShaderInfoLog", "Program Info Log", "VALIDATE_STATUS")


def fetch(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": "blackridge-deployverify"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, r.headers.get("Content-Type", ""), r.read().decode("utf-8", "replace")


def check_static(base_url: str, expect_version: str, fingerprint: str,
                 fingerprint_path: str):
    """Steps 1+2. Returns (ok:bool, pending:bool, notes:[str], boot_v:str|None)."""
    notes = []
    try:
        status, ctype, html = fetch(base_url)
    except Exception as e:
        return False, False, [f"index.html fetch FAILED: {e}"], None
    if status != 200:
        return False, False, [f"index.html HTTP {status}"], None
    if "text/html" not in ctype:
        notes.append(f"index.html content-type '{ctype}' (expected text/html)")
    import re as _re
    m = _re.search(r"boot\.js\?v=(\d+)", html)
    if not m:
        return False, False, notes + ["no boot.js?v=N reference in the live index.html"], None
    boot_v = f"v{m.group(1)}"
    if expect_version and boot_v != expect_version:
        notes.append(f"live page references boot.js {boot_v}, expected {expect_version}")
        return False, True, notes, boot_v  # version mismatch = possibly stale edge

    root = base_url.rsplit("/", 1)[0]
    fp_url = f"{root}/{fingerprint_path}?v={m.group(1)}"
    try:
        status2, _, body = fetch(fp_url)
    except Exception as e:
        return False, False, notes + [f"{fingerprint_path} fetch FAILED: {e}"], boot_v
    if status2 != 200:
        return False, False, notes + [f"{fingerprint_path} HTTP {status2}"], boot_v
    if fingerprint not in body:
        notes.append(f"fingerprint NOT FOUND in {fingerprint_path} — stale edge or bad deploy")
        return False, True, notes, boot_v
    notes.append(f"fingerprint present in {fingerprint_path} ({boot_v})")
    return True, False, notes, boot_v


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--expect-version", required=True,
                    help="the __FPS__.version this deploy shipped (e.g. v7)")
    ap.add_argument("--fingerprint", required=True,
                    help="a string that exists ONLY in the new code — from the actual diff")
    ap.add_argument("--fingerprint-path", default="runtime/boot.js",
                    help="file (relative to the game root) the fingerprint lives in")
    ap.add_argument("--seed", type=int, default=4711, help="PROD_SEED for the bot-match")
    ap.add_argument("--seconds", type=float, default=60.0)
    ap.add_argument("--recheck-after", type=float, default=0,
                    help="on fingerprint failure, wait N s and re-check ONCE (CDN purge window)")
    ap.add_argument("--perf", action="store_true", help="also run perf-static vs the CDN")
    args = ap.parse_args()

    print(f"== DEPLOYED-STATE VERIFICATION == {args.url}")

    ok, pending, notes, boot_v = check_static(
        args.url, args.expect_version, args.fingerprint, args.fingerprint_path)
    for n in notes:
        print(f"  static: {n}")
    if not ok and pending and args.recheck_after > 0:
        print(f"  fingerprint/version stale — waiting {args.recheck_after:.0f}s for the edge, re-checking ONCE")
        time.sleep(args.recheck_after)
        ok, pending, notes, boot_v = check_static(
            args.url, args.expect_version, args.fingerprint, args.fingerprint_path)
        for n in notes:
            print(f"  static(recheck): {n}")
    if not ok:
        if pending:
            print("\nRESULT: ACTION TAKEN, VERIFICATION PENDING — edge still serving old "
                  "content after the recheck window; purge and re-run deployverify.")
            return 5
        print("\nRESULT: DEPLOY BAD (static checks failed)")
        return 1

    # ---- steps 3+4: headed boot + one production bot-match -----------------
    from playwright.sync_api import sync_playwright
    msgs, page_errors = [], []
    match = None
    live_version = None
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        page = browser.new_page(viewport={"width": 1280, "height": 720})
        page.on("console", lambda m: msgs.append((m.type, m.text)))
        page.on("pageerror", lambda e: page_errors.append(str(e)))
        page.add_init_script(
            "window.__err=[];addEventListener('error',e=>window.__err.push(String(e.message)));"
            "addEventListener('unhandledrejection',e=>window.__err.push('reject: '+e.reason));")
        try:
            page.goto(args.url, wait_until="load", timeout=90_000)
        except Exception as e:
            print(f"NAVIGATION FAILED: {e}", file=sys.stderr)
            browser.close()
            return 2

        ready = False
        deadline = time.time() + 120
        while time.time() < deadline:
            try:
                if page.evaluate(READY_EXPR):
                    ready = True
                    break
            except Exception:
                pass
            page.wait_for_timeout(500)
        if not ready:
            print("live page never assigned __FPS__ — NOT BOOTING", file=sys.stderr)
            browser.close()
            return 1

        live_version = page.evaluate("__FPS__.version || null")
        nogpu = page.evaluate(
            "!!(document.getElementById('nogpu') && "
            "document.getElementById('nogpu').classList.contains('show'))")
        inpage_errs = page.evaluate("window.__err || []")

        # step 4: one production bot-match through the REAL surface
        page.evaluate("(s) => { window.__BR_AUTOPLAY_SEED__ = s; }", args.seed)
        page.evaluate("(s) => __FPS__.__test.startMission({seed: s})", args.seed)
        match = page.evaluate(
            "(a) => __FPS__.__test.autoplay('rusher', a.seconds)",
            {"seconds": args.seconds})
        browser.close()

    shader_errs = [t for ty, t in msgs
                   if ty == "error" and any(m in t for m in SHADER_MARKERS)]
    c = (match or {}).get("counters", {})
    fails = []
    if live_version != args.expect_version:
        fails.append(f"live __FPS__.version {live_version!r} != expected {args.expect_version!r}")
    if nogpu:
        fails.append("live page shows #nogpu")
    if shader_errs:
        fails.append(f"{len(shader_errs)} shader compile/link errors: {shader_errs[:2]}")
    if page_errors or inpage_errs:
        fails.append(f"page errors: { (page_errors + inpage_errs)[:4]}")
    if not match or (match.get("counters", {}).get("shotsFired", 0)) <= 0:
        fails.append("bot-match: shotsFired did not move")
    if match and (match.get("kills", 0) + match.get("deaths", 0)) < 1:
        fails.append("bot-match: no kill and no death — the engagement never resolved")

    print(f"  live version: {live_version}   match: kills={match and match.get('kills')} "
          f"deaths={match and match.get('deaths')} phase={match and match.get('phase')} "
          f"shotsFired={c.get('shotsFired')}")

    if args.perf:
        import subprocess
        print("  perf-static vs CDN:")
        rc = subprocess.call([sys.executable, __file__.replace("deployverify.py", "perfprobe.py"),
                              "--url", args.url, "--phases", "perf-static"])
        print(f"  perfprobe exit {rc} (report above; deployed perf is reported, "
              f"the binding perf gate runs locally)")

    if fails:
        print(f"\nRESULT: DEPLOY BAD ({len(fails)}):")
        for f in fails:
            print(f"  !! {f}")
        return 1
    print("\nRESULT: DEPLOY VERIFIED — the live game observably plays "
          f"({args.expect_version}, fingerprint matched, production bot-match resolved)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
