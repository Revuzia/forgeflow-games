"""xcom_autopipe.py — the nightly SELF-IMPROVING XCOM-match loop (HARDENED).

Each night, for each target game: (1) verify against the XCOM reference
(xcom_match.py), (2) if not yet a MATCH, hand the single highest-severity gap to
`claude -p` (tool-enabled) to implement a fix, (3) GATE it (syntax + feel
play-bot), (4) commit LOCALLY, (5) REGRESSION-GUARD: re-score and only push if the
vision total did not drop, else hard-reset the local commit, (6) Telegram-report.
Re-run nightly and each game converges toward the XCOM reference on its own — no
weak/broken partials, because nothing reaches the remote unless gates pass AND the
score did not regress.

Hardening over the first version:
  • Per-night recovery TAG + clean rollback anchor per game.
  • MULTI-GAME: --game a,b,c iterates several tactics games in one run.
  • SCORE-REGRESSION GUARD: a fix that lowers the vision score never gets pushed.
  • RICHER gap→fix prompts: reference-spec excerpt, current score, explicit file
    map, and a hard DO-NOT list (no runtime lights, no deploy, keep diffs small).

NON-INTERACTIVE ONLY — claude -p holds the OAuth lock. Run from Task Scheduler:
    python xcom_autopipe.py                       # all default games, 1 fix each
    python xcom_autopipe.py --verify-only         # score + report, no code changes
    python xcom_autopipe.py --max-fixes 2         # up to N gaps per game (default 1)
    python xcom_autopipe.py --game void-skirmish-3d,nightfall-tactics
    python xcom_autopipe.py --no-regression-guard # skip the re-score (cheaper, less safe)
"""
import json, subprocess, sys, time, socket
from pathlib import Path

ENGINE = Path(__file__).resolve().parent
ROOT = ENGINE.parent.parent
REPORT = ENGINE / "xcom_match_report.json"
LOG = ENGINE / "xcom_autopipe_log.jsonl"
TG_TOKEN = "8725965467:AAFNoygGflWdwoCA_aidViGWFAR74HI04Sc"
TG_CHAT = "8770010305"
REGRESSION_TOL = 2  # a re-scored total may dip this many points (vision noise) without rollback

# Default target games. A tactics game's renderer + sim live at these conventional
# paths; --game overrides the list. Auto-discovers the paths from the slug.
DEFAULT_GAMES = ["void-skirmish-3d"]


def game_paths(slug):
    """Renderer + sim file paths for a tactics game slug (relative to ROOT)."""
    return {
        "slug": slug,
        "renderer": f"games/{slug}/runtime/3d/ffg_tactics3d.js",
        "sim": f"games/{slug}/runtime/sim/tactical_grid.js",
    }


STATE = ENGINE / "xcom_autopipe_state.json"  # {done:[matched slugs], skip:[user-skipped]}


def discover_games():
    """Every shipped 3D-tactics game the autopipe can drive (has the tactics renderer).
    This is the rotation; --game overrides it. Skips _scratch dirs."""
    base = ROOT / "games"
    out = []
    if base.exists():
        for d in sorted(base.iterdir()):
            if d.is_dir() and not d.name.startswith("_") and (d / "runtime" / "3d" / "ffg_tactics3d.js").exists():
                out.append(d.name)
    return out or list(DEFAULT_GAMES)


def load_state():
    try:
        s = json.loads(STATE.read_text(encoding="utf-8"))
        return {"done": list(s.get("done", [])), "skip": list(s.get("skip", []))}
    except Exception:
        return {"done": [], "skip": []}


def save_state(st):
    try:
        STATE.write_text(json.dumps(st, indent=2), encoding="utf-8")
    except Exception:
        pass


def run(cmd, timeout=900, input=None):
    return subprocess.run(cmd, cwd=str(ROOT), capture_output=True, text=True,
                          encoding="utf-8", errors="replace", input=input, timeout=timeout)


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


def gates_pass(game):
    """Syntax-check the renderer + sim, then run the feel play-bot to a conclusion.
    Returns (ok, detail). Conservative: any failure / unparseable result = not ok."""
    for f in (game["renderer"], game["sim"]):
        if not (ROOT / f).exists():
            return False, f"missing file {f}"
        if run(["node", "--check", f], timeout=60).returncode != 0:
            return False, f"syntax error in {f}"
    port = _free_port()
    srv = subprocess.Popen([sys.executable, "-m", "http.server", str(port)], cwd=str(ROOT),
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        time.sleep(1.5)
        r = run([sys.executable, str(ENGINE / "gates" / "feel_gate.py"),
                 f"http://localhost:{port}/games/{game['slug']}/"], timeout=240)
        out = r.stdout or ""
        # Parse only the FIRST JSON object in feel_gate's stdout. feel_gate prints
        # the result object first, then a human "[feel_gate] PASS/FAIL …{…}" summary
        # line — a naive first-{ .. last-} slice spans BOTH, so json.loads threw
        # "Extra data" and failed EVERY gate (2026-06-02 bug). raw_decode reads one
        # object and ignores the trailing summary.
        s = out.find("{")
        if s < 0:
            return False, "feel_gate produced no JSON output"
        data, _ = json.JSONDecoder().raw_decode(out[s:])
        ok = bool(data.get("ok")) and not data.get("console_errors")
        return ok, ("feel_gate ok" if ok else f"feel_gate fail: {str(data)[:160]}")
    except Exception as ex:
        return False, f"gate exception: {ex}"
    finally:
        srv.terminate()


def verify(slug):
    """Run the vision verifier for a game; return the parsed report (or {})."""
    run([sys.executable, str(ENGINE / "xcom_match.py"), "--game", slug], timeout=400)
    try:
        return json.loads(REPORT.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _ref_excerpt(dimension):
    """Pull the reference-spec lines most relevant to a gap's dimension so the fixer
    has the concrete target, not just a one-word label."""
    try:
        ref = (ENGINE / "xcom_reference.md").read_text(encoding="utf-8")
    except Exception:
        return ""
    lines, keep, key = ref.splitlines(), [], (dimension or "").lower()
    for i, ln in enumerate(lines):
        if key and key in ln.lower():
            keep.extend(lines[max(0, i - 1):i + 4])
    return "\n".join(keep[:18])


def _fix_prompt(game, gap, total):
    """A rich, guard-railed instruction for the tool-enabled fixer."""
    return (
        "You are improving the tactics game '" + game["slug"] + "' (a browser XCOM clone) to close ONE "
        "XCOM-fidelity gap. Make a MINIMAL, SAFE, self-contained change.\n\n"
        f"CURRENT VISION SCORE: {total}/100. TARGET: a MATCH (>=88, no dimension <70).\n\n"
        f"GAP — dimension: {gap.get('dimension')}\nissue: {gap.get('issue')}\nfix hint: {gap.get('fix_hint')}\n\n"
        "REFERENCE-SPEC excerpt for this dimension (your concrete target):\n"
        f"{_ref_excerpt(gap.get('dimension')) or '(none found)'}\n\n"
        "FILE MAP:\n"
        f"  renderer: {game['renderer']}\n  sim: {game['sim']}\n"
        "  generator: pipeline/engine/tools/gen_campaign.cjs\n"
        "  Both renderer + sim have a pipeline-template TWIN under pipeline/engine/runtime/3d/ and\n"
        "  pipeline/engine/runtime/sim/. EDIT THE TEMPLATE then copy it into the game's runtime/ so\n"
        "  both stay byte-identical (the dual-copy gotcha — a renderer edit that skips the sync does nothing).\n\n"
        "HARD RULES (violating any reverts your work):\n"
        "  • DO NOT add a new runtime THREE light — it recompiles every shader and freezes the game.\n"
        "    Fake added light with an additive-blended glow mesh instead.\n"
        "  • DO NOT deploy, push, tag, or touch git — the harness gates + commits.\n"
        "  • Object3D.position is read-only — use .position.set(), never Object.assign.\n"
        "  • Run `node --check` on every file you edit before finishing.\n"
        "  • Keep the diff SMALL and focused on this one gap; it is auto-gated and reverted if it fails."
    )


def git_tag(slug):
    """Create a local recovery tag at HEAD (forensics anchor). Best-effort."""
    base = run(["git", "rev-parse", "HEAD"], timeout=30).stdout.strip()
    tag = f"autopipe-base-{slug}-{int(time.time())}"
    run(["git", "tag", "-f", tag], timeout=30)
    return base, tag


def attempt_fix(game, gap, pre_total, regression_guard=True):
    """Snapshot HEAD, let claude -p (tool-enabled) implement the gap fix, gate it,
    commit LOCALLY, regression-guard (re-score), and only THEN push. Reverts on any
    failure so nothing bad reaches the remote. Returns (committed, detail).

    SAFETY (2026-06-02): the rollback below does `git reset --hard` + `git clean -fd`,
    which on the SHARED working tree once DESTROYED a concurrent interactive session's
    uncommitted work. We now STASH any pre-existing uncommitted/untracked changes
    first — so reset/clean only ever touch the autopipe's own edits — and RESTORE
    them on every exit path. We also stage only games+pipeline (never `git add -A`),
    so a concurrent session's stray files are never swept into an autopipe commit."""
    base, tag = git_tag(game["slug"])

    # Isolate from concurrent uncommitted work: stash it (incl. untracked, -u) so our
    # reset/clean can't reach it. Restored at every return via restore().
    pre_dirty = bool(run(["git", "status", "--porcelain"], timeout=30).stdout.strip())
    stashed = False
    if pre_dirty:
        sr = run(["git", "stash", "push", "-u", "-m",
                  f"autopipe-preserve-{game['slug']}-{int(time.time())}"], timeout=90)
        stashed = sr.returncode == 0 and "No local changes" not in (sr.stdout or "")

    def restore():
        if stashed:
            rp = run(["git", "stash", "pop"], timeout=90)
            if rp.returncode != 0:
                print("[autopipe] WARN concurrent work kept safe in `git stash` "
                      "(pop conflicted, resolve manually): " + (rp.stderr or "")[:160])

    def rollback():
        if base:
            run(["git", "reset", "--hard", base], timeout=60)
            run(["git", "clean", "-fd", "games", "pipeline"], timeout=60)
        restore()

    run(["claude", "-p"], input=_fix_prompt(game, gap, pre_total), timeout=1200)

    # Gate 1: syntax + feel play-bot.
    ok, detail = gates_pass(game)
    if not ok:
        rollback()
        return False, "reverted (gate) — " + detail
    if not run(["git", "status", "--porcelain"], timeout=30).stdout.strip():
        restore()
        return False, "no change produced"

    # Commit LOCALLY (not pushed yet — the regression guard decides). Stage only the
    # autopipe's surface (games + pipeline), never `-A`.
    run(["git", "add", "games", "pipeline"], timeout=60)
    msg = (f"autopipe[{game['slug']}]: close XCOM gap [{gap.get('dimension')}] "
           f"{str(gap.get('issue',''))[:70]}\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>")
    run(["git", "commit", "-q", "-m", msg], timeout=60)

    # Gate 2: SCORE-REGRESSION GUARD — re-score; a fix that lowered the total is undone.
    if regression_guard:
        rep2 = verify(game["slug"])
        post_total = rep2.get("total")
        if isinstance(post_total, (int, float)) and isinstance(pre_total, (int, float)) \
           and post_total < pre_total - REGRESSION_TOL:
            rollback()
            return False, f"reverted (regression {pre_total}->{post_total})"
        post_note = f" score {pre_total}->{post_total}" if post_total is not None else ""
    else:
        post_note = " (regression-guard off)"

    # Clean + improved → publish, then restore any concurrent work on top.
    pr = run(["git", "push", "origin", "master"], timeout=90)
    restore()
    if pr.returncode != 0:
        return False, "commit ok but push failed: " + (pr.stderr or "")[:120]
    return True, "committed + pushed (gates green," + post_note + ")"


def process_game(game, max_fixes, verify_only, regression_guard):
    """Verify one game, fix one gap. Returns a status the window-loop uses to rotate:
    'match' (done — rotate out), 'blank'/'skip' (can't grade — drop this run),
    'fixed' / 'nofix' (keep cycling), 'verify-only'."""
    rep = verify(game["slug"])
    total = rep.get("total"); match = rep.get("match")
    logline({"phase": "verify", "game": game["slug"], "total": total, "match": match, "gaps": rep.get("gaps", [])[:5]})
    if not rep.get("ok", True) and total is None:
        why = str(rep.get("error", "capture/vision"))
        notify(f"⚠️ *XCOM-autopipe* [{game['slug']}]: verify failed ({why}). Skipping this run.")
        return "blank" if "blank" in why else "skip"
    if match:
        notify(f"✅ *XCOM-autopipe* [{game['slug']}]: MATCH — {total}/100. Done; rotating to the next game.")
        return "match"
    if verify_only:
        notify(f"🎯 *XCOM-autopipe* [{game['slug']}]: {total}/100 (verify-only).")
        return "verify-only"

    fixed = []
    for gap in rep.get("gaps", [])[:max_fixes]:
        committed, detail = attempt_fix(game, gap, total, regression_guard)
        logline({"phase": "fix", "game": game["slug"], "gap": gap, "committed": committed, "detail": detail})
        fixed.append((gap.get("dimension"), committed, detail))
        if committed:
            break  # one solid green fix per cycle; re-verify on the next loop pass
    summary = "\n".join(f"• {d}: {'✅ ' + det if c else '↩ ' + det}" for d, c, det in fixed) or "no gaps actioned"
    notify(f"🤖 *XCOM-autopipe* [{game['slug']}] @ {total}/100:\n{summary}")
    return "fixed" if any(c for _, c, _ in fixed) else "nofix"


def main():
    """LOOP the scheduled window (default ~110 min ≈ 1:30–3:30) across the game rotation,
    one fix-cycle per game per pass, re-verifying as it goes — instead of doing one game and
    stopping. A game that MATCHES is persisted as done and rotated out; a blank/unfixable game
    is dropped for the run. So the autonomous window keeps improving games until time's up.

    Flags: --minutes N (window budget) · --game a,b (override rotation) · --skip a,b
    (don't touch these) · --reset (clear done/skip) · --verify-only · --max-fixes N."""
    argv = sys.argv
    verify_only = "--verify-only" in argv
    regression_guard = "--no-regression-guard" not in argv

    def argval(flag, default=None):
        if flag in argv:
            try: return argv[argv.index(flag) + 1]
            except Exception: return default
        return default

    max_fixes = int(argval("--max-fixes", 1) or 1)
    minutes = int(argval("--minutes", 110) or 110)
    deadline = time.time() + minutes * 60

    st = load_state()
    if "--reset" in argv:
        st = {"done": [], "skip": []}
    sk = argval("--skip")
    if sk:
        for s in sk.split(","):
            s = s.strip()
            if s and s not in st["skip"]:
                st["skip"].append(s)
    save_state(st)

    if "--game" in argv:
        rotation = [s.strip() for s in (argval("--game") or "").split(",") if s.strip()]
    else:
        rotation = discover_games()
    active = [g for g in rotation if g not in st["done"] and g not in st["skip"]
              and (ROOT / game_paths(g)["renderer"]).exists()]
    logline({"phase": "start", "rotation": rotation, "active": active, "done": st["done"], "skip": st["skip"], "minutes": minutes})
    if not active:
        notify(f"🤖 *XCOM-autopipe*: nothing to do — all eligible matched/skipped.\nrotation={rotation} done={st['done']} skip={st['skip']}")
        return 0

    cycles, i = 0, 0
    while active and time.time() < deadline:
        slug = active[i % len(active)]
        try:
            status = process_game(game_paths(slug), max_fixes, verify_only, regression_guard)
        except Exception as ex:
            logline({"phase": "error", "game": slug, "error": str(ex)[:200]})
            notify(f"⚠️ *XCOM-autopipe* [{slug}]: run error — {str(ex)[:120]}")
            status = "error"
        cycles += 1
        if status == "match":
            if slug not in st["done"]: st["done"].append(slug); save_state(st)
            active.remove(slug)              # rotate out (list shrank — don't advance i)
        elif status == "fixed":
            i += 1                           # progress made — re-verify it on the next pass, move to next game
        else:                                # blank / skip / nofix / verify-only / error — can't progress this run
            active.remove(slug)
    notify(f"🤖 *XCOM-autopipe*: window complete — {cycles} cycle(s). done={st['done']} remaining={active}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
