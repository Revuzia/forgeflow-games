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


def feel_and_fidelity(slug, genre, deploy_shot=None):
    """Soft gates — best effort; never fatal. Returns dict of results."""
    results = {"feel": "skipped", "fidelity": "skipped"}
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
        # fidelity needs a screenshot (the feel gate / a capture step would provide it);
        # left as deferred unless a shot path is supplied by a capture step.
        if deploy_shot and Path(deploy_shot).exists():
            try:
                r2 = subprocess.run([sys.executable, str(ENGINE / "gates" / "fidelity_gate.py"), deploy_shot, genre, "--run"],
                                    capture_output=True, text=True, timeout=180)
                results["fidelity"] = "pass" if r2.returncode == 0 else "fail"
            except Exception as e:
                results["fidelity"] = f"error: {e}"
    finally:
        if server:
            server.terminate()
    return results


# ── generation ────────────────────────────────────────────────────────────────
def generate_slice(item):
    content = build_order.run_claude_p(build_order.slice_prompt(item["genre"], item["brief"]))
    content.setdefault("slug", item["slug"])
    content.setdefault("genre", item["genre"])
    content.setdefault("title", item.get("title", item["slug"].replace("-", " ").title()))
    return content


def regenerate_with_feedback(item, prior_errors):
    prompt = build_order.slice_prompt(item["genre"], item["brief"]) + \
        "\n\nYOUR PREVIOUS ATTEMPT FAILED THESE GATES — fix EXACTLY these:\n" + prior_errors + \
        "\nReturn only the corrected JSON object."
    content = build_order.run_claude_p(prompt)
    content.setdefault("slug", item["slug"])
    content.setdefault("genre", item["genre"])
    return content


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
        expanded.setdefault("slug", slug)
        expanded.setdefault("genre", genre)
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

    # SOFT gates (feel/fidelity) — best effort
    soft = feel_and_fidelity(slug, genre)
    log(f"soft gates: {soft}")

    # DEPLOY (gated)
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
        _mark(slug, "built", "staged; awaiting deploy approval")
        log(f"{slug} BUILT + staged (no auto-publish). Review then run deploy_game.py {slug}")
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


def main():
    args = sys.argv[1:]
    if "--selftest" in args:
        sys.exit(selftest(args[args.index("--selftest") + 1]))
    force = "--force" in args
    deploy = "--deploy" in args
    once = "--once" in args

    if time_left(force) <= 5:
        log(f"outside run window (now {_minutes_now()}m, stop {HARD_STOP_MINUTES}m). Exiting.")
        return
    log(f"v2 autonomous run start — {time_left(force)} min left in window, deploy={deploy}")
    built = 0
    while time_left(force) > 5:
        q = _load_queue()
        item = select_next(q)
        if not item:
            log("build queue empty — nothing pending. Done.")
            break
        try:
            build_one(item, deploy=deploy)
        except Exception as e:
            log(f"build error for {item['slug']}: {e}")
            _mark(item["slug"], "failed", str(e)[:200])
        built += 1
        if once:
            break
    log(f"v2 run complete: {built} game(s) attempted")


if __name__ == "__main__":
    main()
