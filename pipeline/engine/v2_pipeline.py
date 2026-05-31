"""v2_pipeline.py — unattended autonomous driver for FFG Engine v2.

Runs under Windows Task Scheduler (ClawGamePipeline, 1:30-3:30 AM window). For
each queued game it executes the vertical-slice-first loop, ON ITS OWN:

  select (build_queue.json)
    -> slice content via `claude -p`   (constrained by schema + learned rules)
    -> contract + signature gate (BLOCKING)   [reflexion: 1 retry on failure]
    -> expand content via `claude -p`
    -> re-gate
    -> assemble (copy runtime + write content.json + index.html)
    -> feel gate (Playwright play-bot) + fidelity gate (claude -p vision)  [SOFT]
    -> record learnings
    -> next game (until the 3:30 hard stop)

Deploy is GATED: by default the driver builds + gates + STAGES a game and writes a
READY_TO_DEPLOY marker — it does NOT publish. Pass --deploy to auto-publish games
that pass all blocking gates (only flip this on once you trust the loop).

`claude -p` runs fine here because Task Scheduler is non-interactive; it is ONLY
blocked inside an interactive Claude session (the OAuth lock). To exercise the
whole pipeline WITHOUT `claude -p` (e.g. while developing), use:

    python v2_pipeline.py --selftest ../../games/iron-tide/content.json
        gates + assembles an existing content object (no generation, no network).

    python v2_pipeline.py --once          # build one queued game, then stop
    python v2_pipeline.py --force          # ignore the time window
    python v2_pipeline.py --deploy         # publish games that pass blocking gates
"""
import json
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ENGINE = Path(__file__).resolve().parent
ROOT = ENGINE.parent.parent          # forgeflow-games/
sys.path.insert(0, str(ENGINE))
import build_order  # noqa: E402  (reuses slice/expand prompts, run_claude_p, assemble, gate_content)
import learn        # noqa: E402

QUEUE = ENGINE / "build_queue.json"
WIP = ENGINE / "_wip"
HARD_STOP_MINUTES = 3 * 60 + 30      # 3:30 AM — matches the owner's 1:30-3:30 window
SERVE_PORT = 8791

# Telegram audit channel (automation -> owner). Best-effort; never fatal.
sys.path.insert(0, str(ROOT.parent / "scripts"))
try:
    from claw_lib import telegram as _tg
except Exception:
    _tg = None


def notify(text):
    """Send a Telegram audit line (this is an AUTOMATION reporting what it did,
    per the 'Telegram = automations only' rule). Logged to the outbox by the helper."""
    if _tg is None:
        log("telegram helper unavailable; skipping notify")
        return
    try:
        _tg.send(text, pipeline="forgeflow_games_v2", disable_web_page_preview=True)
    except Exception as e:
        log(f"telegram send failed: {e}")


class TransientError(Exception):
    """Infra failure (claude -p / network unavailable) — abort the run cleanly
    WITHOUT marking games failed, so they retry next window."""


def normalize_content(content, item):
    """Deterministic self-heal — delegates to the shared repair() in build_order
    (fills title/view, moves units off blocking tiles, etc.). Idempotent."""
    return build_order.repair(content, slug=item["slug"], genre=item["genre"], title=item.get("title"))


def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] [v2] {msg}", flush=True)


def _minutes_now():
    n = datetime.now()
    return n.hour * 60 + n.minute


def time_left(force=False):
    return 999 if force else max(0, HARD_STOP_MINUTES - _minutes_now())


# ── queue ──────────────────────────────────────────────────────────────────────
def _load_queue():
    return json.loads(QUEUE.read_text(encoding="utf-8"))


def _save_queue(q):
    QUEUE.write_text(json.dumps(q, indent=2), encoding="utf-8")


def select_next(q):
    for item in q.get("queue", []):
        if item.get("status", "pending") == "pending":
            return item
    return None


def _mark(slug, status, detail=""):
    q = _load_queue()
    for item in q["queue"]:
        if item["slug"] == slug:
            item["status"] = status
            if detail:
                item["detail"] = detail
            item["updated"] = datetime.now(timezone.utc).isoformat()
    _save_queue(q)


# ── gates ───────────────────────────────────────────────────────────────────────
def gate(content_path, genre):
    """contract + signature (blocking). Returns (ok, combined_output)."""
    ok, cout, sout = build_order.gate_content(content_path, genre)
    return ok, (cout + "\n" + sout).strip()


# Generic "begin gameplay" snippet so the fidelity screenshot shows the ACTUAL
# game (not just the title menu), for any genre (2D or 3D).
_START_EVAL = (
    "(async()=>{const s=ms=>new Promise(r=>setTimeout(r,ms));"
    "function T(){if(window.__FFG3D__&&window.__FFG3D__.controller)return window.__FFG3D__.controller.__test;"
    "if(window.__FFG_GAME__&&window.__FFG_GAME__.scene){var x=window.__FFG_GAME__.scene.scenes.find(z=>z.__test);return x&&x.__test;}return null;}"
    "var t=null,n=0;while(!t&&n++<40){t=T();if(!t)await s(200);}"
    "if(t&&t.start)t.start();await s(900);if(t&&t.placeAuto){t.placeAuto();await s(700);}})()"
)


def feel_and_fidelity(slug, genre):
    """Feel (Playwright play-bot, reliable) + fidelity (claude -p vision). Captures
    its OWN in-game screenshot so fidelity actually runs every time. Returns a
    structured verdict; build_one decides ship/hold from it.

    Conservative by design: a build only counts as fidelity-passing if the vision
    call ran AND approved it. claude -p unavailable / capture failure => NOT pass
    (we never ship a build we couldn't see)."""
    results = {"feel": "skipped", "feel_detail": "", "fidelity": "skipped", "fidelity_detail": "", "shot": None}
    server = None
    try:
        server = subprocess.Popen(
            [sys.executable, "-m", "http.server", str(SERVE_PORT), "--directory", str(ROOT)],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        time.sleep(1.5)
        url = f"http://localhost:{SERVE_PORT}/games/{slug}/"
        try:
            r = subprocess.run([sys.executable, str(ENGINE / "gates" / "feel_gate.py"), url],
                               capture_output=True, text=True, timeout=120)
            results["feel"] = "pass" if r.returncode == 0 else "fail"
            results["feel_detail"] = r.stdout.strip().splitlines()[-1] if r.stdout.strip() else ""
        except Exception as e:
            results["feel"] = f"error: {e}"
        # Capture a representative in-game frame (reliable Playwright capture).
        shot = ROOT / "games" / slug / "_fidelity.png"
        try:
            sys.path.insert(0, str(ENGINE / "gates"))
            from capture import capture  # noqa
            capture(url, str(shot), pre_eval=_START_EVAL)
            if shot.exists():
                results["shot"] = str(shot)
        except Exception as e:
            results["fidelity"] = f"capture_error: {e}"
        # Vision fidelity (claude -p) on the captured frame.
        if results.get("shot"):
            try:
                r2 = subprocess.run([sys.executable, str(ENGINE / "gates" / "fidelity_gate.py"), str(shot), genre, "--run"],
                                    capture_output=True, text=True, timeout=180)
                results["fidelity"] = "pass" if r2.returncode == 0 else "fail"
                results["fidelity_detail"] = (r2.stdout or r2.stderr or "").strip()[-500:]
            except Exception as e:
                results["fidelity"] = f"error: {e}"
    finally:
        if server:
            server.terminate()
    return results


# ── generation ────────────────────────────────────────────────────────────────
def _gen(prompt):
    """Call claude -p; classify failures. An infra/network/no-output failure is
    TRANSIENT (abort run, retry next window) — NOT a content error."""
    try:
        return build_order.run_claude_p(prompt)
    except Exception as e:
        raise TransientError(f"claude -p unavailable or returned no JSON: {e}")


def generate_slice(item):
    content = _gen(build_order.slice_prompt(item["genre"], item["brief"]))
    return normalize_content(content, item)


def regenerate_with_feedback(item, prior_errors):
    prompt = build_order.slice_prompt(item["genre"], item["brief"]) + \
        "\n\nYOUR PREVIOUS ATTEMPT FAILED THESE GATES — fix EXACTLY these:\n" + prior_errors + \
        "\nReturn only the corrected JSON object."
    return normalize_content(_gen(prompt), item)


# ── build one game ───────────────────────────────────────────────────────────────
def build_one(item, deploy=False):
    slug, genre = item["slug"], item["genre"]
    WIP.mkdir(exist_ok=True)
    wip = WIP / f"{slug}.json"
    log(f"building {slug} ({genre})")

    # SLICE + gate (+ one reflexion retry)
    content = generate_slice(item)
    wip.write_text(json.dumps(content, indent=2), encoding="utf-8")
    ok, out = gate(wip, genre)
    if not ok:
        log(f"slice gate failed; reflexion retry. {out[:200]}")
        content = regenerate_with_feedback(item, out)
        wip.write_text(json.dumps(content, indent=2), encoding="utf-8")
        ok, out = gate(wip, genre)
        if not ok:
            learn.record(genre, f"slice failed gates twice for {slug}", "tighten the slice prompt / schema for this genre; inspect: " + out[:300], slug)
            _mark(slug, "failed", "slice gate failed twice")
            log(f"SKIP {slug}: slice failed twice")
            return False

    # EXPAND + re-gate (fall back to slice-only content if expansion regresses)
    try:
        expanded = build_order.run_claude_p(build_order.expand_prompt(genre, content))
        expanded = normalize_content(expanded, item)
        wip.write_text(json.dumps(expanded, indent=2), encoding="utf-8")
        ok2, out2 = gate(wip, genre)
        if ok2:
            content = expanded
        else:
            log(f"expansion failed gates; keeping slice-only content. {out2[:160]}")
            wip.write_text(json.dumps(content, indent=2), encoding="utf-8")
    except Exception as e:
        log(f"expansion error ({e}); keeping slice-only content")
        wip.write_text(json.dumps(content, indent=2), encoding="utf-8")

    # ASSEMBLE
    gdir = build_order.assemble(slug, content)
    log(f"assembled -> {gdir}")

    # PLAY + LOOK gates. These are now BLOCKING for shipping: a build must both
    # play to a resolution (feel) AND look like a finished game of its genre
    # (fidelity vision). The lettered-circle tactics build shipped because these
    # were "best effort" and fidelity never even ran — never again.
    soft = feel_and_fidelity(slug, genre)
    log(f"feel+fidelity gates: feel={soft.get('feel')} fidelity={soft.get('fidelity')} :: {soft.get('fidelity_detail','')[:200]}")

    feel_ok = soft.get("feel") == "pass"
    fid = soft.get("fidelity")
    fidelity_ok = fid == "pass"
    if not feel_ok or not fidelity_ok:
        # Build something, but it does NOT look/play shippable — HOLD it. No
        # READY_TO_DEPLOY, no publish. Flag it for repair + record a learning.
        reasons = []
        if not feel_ok:
            reasons.append(f"feel={soft.get('feel')} ({soft.get('feel_detail','')[:80]})")
        if not fidelity_ok:
            reasons.append(f"fidelity={fid} ({soft.get('fidelity_detail','')[:140]})")
        reason = "; ".join(reasons)
        learn.record(genre, f"{slug} held: failed play/look gate", "do not ship below the genre's visual+feel bar; inspect the held build and fix the renderer/content: " + reason, slug)
        _mark(slug, "held", "blocked from shipping: " + reason)
        try:
            (gdir / "HELD_NOT_SHIPPABLE").write_text(reason + "\n", encoding="utf-8")
        except Exception:
            pass
        log(f"HELD {slug}: NOT shipping — {reason}")
        return False

    # DEPLOY (only reached when feel + fidelity both pass)
    if deploy:
        try:
            dep = subprocess.run([sys.executable, str(ROOT / "pipeline" / "deploy_game.py"), slug],
                                 capture_output=True, text=True, timeout=300)
            published = dep.returncode == 0
            _mark(slug, "published" if published else "built", "deploy rc=%d" % dep.returncode)
            log(f"deploy {slug}: {'OK' if published else 'FAILED'}")
        except Exception as e:
            _mark(slug, "built", f"deploy error: {e}")
            log(f"deploy error: {e}")
    else:
        (gdir / "READY_TO_DEPLOY").write_text(datetime.now(timezone.utc).isoformat(), encoding="utf-8")
        _mark(slug, "built", "staged; passed feel+fidelity; awaiting deploy approval")
        log(f"{slug} BUILT + staged (passed feel+fidelity, no auto-publish).")
    return True


# ── main ──────────────────────────────────────────────────────────────────────
def selftest(content_path):
    """Offline: gate + assemble an existing content object. No claude -p, no network."""
    content = json.loads(Path(content_path).read_text(encoding="utf-8"))
    genre = content["genre"]
    log(f"SELFTEST {content.get('slug')} ({genre}) — gate + assemble, no generation")
    ok, out = gate(Path(content_path), genre)
    print(out)
    if not ok:
        log("SELFTEST FAIL — blocking gates failed")
        return 1
    gdir = build_order.assemble(content["slug"], content)
    ok2, _ = gate(gdir / "content.json", genre)
    log(f"SELFTEST assembled -> {gdir}; post-assemble gates: {'PASS' if ok2 else 'FAIL'}")
    return 0 if ok2 else 1


def smoke(genre):
    """Pre-enable generation smoke test: run ONE generate->repair->gate cycle for
    the first queued game of `genre` (or a synthetic brief). Proves the slice
    PROMPT produces gate-passing content — the test that was missing before the
    first live run. Needs claude -p (run via operator/Task Scheduler, not in an
    interactive session). No assemble, no deploy."""
    q = _load_queue()
    item = next((i for i in q.get("queue", []) if i.get("genre") == genre), {"slug": f"smoke-{genre}", "genre": genre, "brief": "smoke test"})
    log(f"SMOKE [{genre}] generating one slice for {item['slug']}...")
    try:
        content = generate_slice(item)
    except TransientError as e:
        log(f"SMOKE inconclusive — {e}")
        return 2
    WIP.mkdir(exist_ok=True)
    wip = WIP / f"smoke-{genre}.json"
    wip.write_text(json.dumps(content, indent=2), encoding="utf-8")
    ok, out = gate(wip, genre)
    if not ok:
        # one self-heal+reflexion pass, like the real loop
        log(f"SMOKE first gate failed; reflexion. {out[:160]}")
        try:
            content = regenerate_with_feedback(item, out)
        except TransientError as e:
            log(f"SMOKE inconclusive — {e}")
            return 2
        wip.write_text(json.dumps(content, indent=2), encoding="utf-8")
        ok, out = gate(wip, genre)
    log(f"SMOKE [{genre}] {'PASS' if ok else 'FAIL'}\n{out}")
    return 0 if ok else 1


def main():
    args = sys.argv[1:]
    if "--selftest" in args:
        sys.exit(selftest(args[args.index("--selftest") + 1]))
    if "--smoke" in args:
        sys.exit(smoke(args[args.index("--smoke") + 1]))
    force = "--force" in args
    deploy = "--deploy" in args
    once = "--once" in args

    if time_left(force) <= 5:
        log(f"outside run window (now {_minutes_now()}m, stop {HARD_STOP_MINUTES}m). Exiting.")
        return

    pending = [i for i in _load_queue().get("queue", []) if i.get("status", "pending") == "pending"]
    log(f"v2 autonomous run start — {time_left(force)} min left, {len(pending)} pending, deploy={deploy}")
    notify(f"🎮 FFG v2 games pipeline started — {len(pending)} game(s) queued, {time_left(force)} min in window (deploy={'on' if deploy else 'off, staging only'}).")

    built, failed, aborted = [], [], False
    while time_left(force) > 5:
        q = _load_queue()
        item = select_next(q)
        if not item:
            log("build queue empty — nothing pending. Done.")
            break
        try:
            ok = build_one(item, deploy=deploy)
            (built if ok else failed).append(item["slug"])
        except TransientError as e:
            # infra/network down — do NOT mark games failed; stop and retry next window
            log(f"ABORT (transient): {e}")
            notify(f"⚠️ FFG v2 aborted — generation backend unavailable ({e}). No games marked failed; will retry next window.")
            aborted = True
            break
        except Exception as e:
            log(f"build error for {item['slug']}: {e}")
            _mark(item["slug"], "failed", str(e)[:200])
            failed.append(item["slug"])
        if once:
            break

    if aborted:
        return

    # End-of-run audit summary to the owner.
    lines = [f"✅ FFG v2 run complete — built {len(built)}, failed {len(failed)}."]
    if built:
        lines.append("Built (staged for review): " + ", ".join(built))
    if failed:
        lines.append("Failed gates (not shipped): " + ", ".join(failed))
    if not built and not failed:
        lines.append("Nothing pending in the queue.")
    summary = "\n".join(lines)
    log(summary.replace("\n", " | "))
    notify(summary)


if __name__ == "__main__":
    main()
