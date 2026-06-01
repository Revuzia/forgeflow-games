"""xcom_autopipe.py — the nightly SELF-IMPROVING XCOM-match loop.

Each night: (1) verify the game against the XCOM reference (xcom_match.py),
(2) if not yet a MATCH, hand the single highest-severity gap to `claude -p`
(tool-enabled) to implement a fix, (3) GATE it (syntax + feel play-bot), (4)
commit + push if green, REVERT if not, (5) Telegram-report. Re-run nightly and
it converges toward the XCOM reference on its own — no more weak/broken partials,
because nothing commits unless the gates pass.

NON-INTERACTIVE ONLY — claude -p holds the OAuth lock. Run from Task Scheduler:
    python xcom_autopipe.py
    python xcom_autopipe.py --verify-only   # just score + report, no code changes
    python xcom_autopipe.py --max-fixes 2   # attempt up to N gaps this run (default 1)
"""
import json, subprocess, sys, time, socket
from pathlib import Path

ENGINE = Path(__file__).resolve().parent
ROOT = ENGINE.parent.parent
REPORT = ENGINE / "xcom_match_report.json"
LOG = ENGINE / "xcom_autopipe_log.jsonl"
SLUG = "void-skirmish-3d"
RENDERER = "games/void-skirmish-3d/runtime/3d/ffg_tactics3d.js"
SIM = "games/void-skirmish-3d/runtime/sim/tactical_grid.js"
TG_TOKEN = "8725965467:AAFNoygGflWdwoCA_aidViGWFAR74HI04Sc"
TG_CHAT = "8770010305"


def run(cmd, timeout=900):
    return subprocess.run(cmd, cwd=str(ROOT), capture_output=True, text=True, timeout=timeout)


def notify(text):
    try:
        subprocess.run(["curl", "-s", f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage",
                        "-d", f"chat_id={TG_CHAT}", "-d", f"text={text}", "-d", "parse_mode=Markdown"],
                       capture_output=True, timeout=20)
    except Exception:
        pass


def logline(obj):
    obj["ts"] = int(time.time())
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(json.dumps(obj) + "\n")


def _free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p


def gates_pass():
    """Syntax-check the renderer + sim, then run the feel play-bot to a conclusion.
    Returns (ok, detail). Conservative: any failure / unparseable result = not ok."""
    for f in (RENDERER, SIM):
        if run(["node", "--check", f], timeout=60).returncode != 0:
            return False, f"syntax error in {f}"
    port = _free_port()
    srv = subprocess.Popen([sys.executable, "-m", "http.server", str(port)], cwd=str(ROOT),
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        time.sleep(1.5)
        r = run([sys.executable, str(ENGINE / "gates" / "feel_gate.py"),
                 f"http://localhost:{port}/games/{SLUG}/"], timeout=240)
        out = r.stdout or ""
        s, e = out.find("{"), out.rfind("}")
        data = json.loads(out[s:e + 1]) if s >= 0 and e > s else {}
        ok = bool(data.get("ok")) and not data.get("console_errors")
        return ok, ("feel_gate ok" if ok else f"feel_gate fail: {str(data)[:160]}")
    except Exception as ex:
        return False, f"gate exception: {ex}"
    finally:
        srv.terminate()


def verify():
    """Run the vision verifier; return the parsed report (or {})."""
    run([sys.executable, str(ENGINE / "xcom_match.py")], timeout=400)
    try:
        return json.loads(REPORT.read_text(encoding="utf-8"))
    except Exception:
        return {}


def attempt_fix(gap):
    """Snapshot HEAD, let claude -p (tool-enabled) implement the gap fix, gate it,
    commit+push if green else hard-revert. Returns (committed, detail)."""
    base = run(["git", "rev-parse", "HEAD"], timeout=30).stdout.strip()
    prompt = (
        "You are improving the Void Skirmish 3D tactics game (a browser XCOM clone) to close ONE "
        "XCOM-fidelity gap. Make a MINIMAL, SAFE, self-contained change.\n\n"
        f"GAP — dimension: {gap.get('dimension')}\nissue: {gap.get('issue')}\nfix hint: {gap.get('fix_hint')}\n\n"
        f"Edit the tactics renderer ({RENDERER}) and, only if necessary, the generator "
        "(pipeline/engine/tools/gen_campaign.cjs) or sim. The renderer + sim have a pipeline-template "
        "twin under pipeline/engine/runtime/3d/ and pipeline/engine/runtime/sim/ — edit the TEMPLATE and "
        "copy it into games/void-skirmish-3d/runtime/ so both stay in sync. Do not break the build, do "
        "not deploy, do not touch git. Keep it small; the change will be auto-gated and reverted if it fails."
    )
    cp = run(["claude", "-p", prompt], timeout=1200)
    ok, detail = gates_pass()
    if ok and run(["git", "diff", "--quiet"], timeout=30).returncode != 0:
        run(["git", "add", "-A"], timeout=60)
        msg = f"autopipe: close XCOM gap [{gap.get('dimension')}] {str(gap.get('issue',''))[:70]}\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
        run(["git", "commit", "-q", "-m", msg], timeout=60)
        run(["git", "push", "origin", "master"], timeout=90)
        return True, "committed (gates green)"
    # revert any changes the pass made
    if base:
        run(["git", "reset", "--hard", base], timeout=60)
        run(["git", "clean", "-fd", "games", "pipeline"], timeout=60)
    return False, ("no change produced" if ok else "reverted — " + detail)


def main():
    verify_only = "--verify-only" in sys.argv
    max_fixes = 1
    if "--max-fixes" in sys.argv:
        try: max_fixes = int(sys.argv[sys.argv.index("--max-fixes") + 1])
        except Exception: pass

    rep = verify()
    total = rep.get("total"); match = rep.get("match")
    logline({"phase": "verify", "total": total, "match": match, "gaps": rep.get("gaps", [])[:5]})
    if not rep.get("ok", True) and total is None:
        notify("⚠️ *XCOM-autopipe*: verify failed (capture/vision). Skipping fixes tonight.")
        return 1
    if match:
        notify(f"✅ *XCOM-autopipe*: MATCH reached — {total}/100. Nothing to fix.")
        return 0
    if verify_only:
        return 0

    gaps = rep.get("gaps", [])
    fixed = []
    for gap in gaps[:max_fixes]:
        committed, detail = attempt_fix(gap)
        logline({"phase": "fix", "gap": gap, "committed": committed, "detail": detail})
        fixed.append((gap.get("dimension"), committed, detail))
        if committed:
            break  # one solid green fix per night; re-verify next run
    summary = "\n".join(f"• {d}: {'✅ committed' if c else '↩ ' + det}" for d, c, det in fixed) or "no gaps actioned"
    notify(f"🤖 *XCOM-autopipe* @ {total}/100 — tonight:\n{summary}\nRe-runs nightly until MATCH.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
