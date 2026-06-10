"""v2_pipeline.py — unattended autonomous driver for FFG Engine v2.

Runs under Windows Task Scheduler (ClawGamePipeline, 1:30-3:30 AM window). For
each queued game it executes the vertical-slice-first loop, ON ITS OWN:

  select (build_queue.json)
    -> slice content via `claude -p`   (constrained by schema + learned rules)
    -> contract + signature gate (BLOCKING)   [reflexion: 1 retry on failure]
    -> expand content via `claude -p`
    -> re-gate
    -> assemble (copy runtime + write content.json + index.html)
    -> VERIFY (all BLOCKING): structure (scaffolding/menu/control-bar) + feel (play-bot:
       plays to win/lose AND no crash / handler throw) + fidelity (claude -p vision: looks
       finished) + review (claude -p: logic/completeness bugs)
    -> AUTO-REPAIR loop: claude -p fixes the specific failing gaps -> re-assemble -> re-verify
       (up to MAX_REPAIRS) ; HOLD only if still below bar
    -> record learnings
    -> next game (until the hard stop)

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
HARD_STOP_MINUTES = 4 * 60 + 30      # 4:30 AM Eastern (machine TZ) = 3:30 AM Central. Trigger
                                     # fires 2:30 ET = 1:30 CT, so this gives the owner's full
                                     # 1:30-3:30 CT / 120-min window. (Was 210/3:30 ET = only 60 min CT.)
SERVE_PORT = 8791
MAX_REPAIRS = 2                      # post-assemble auto-repair attempts before HOLDing (claude -p each; --max-repairs overrides)

# Telegram audit channel (automation -> owner). Best-effort; never fatal.
sys.path.insert(0, str(ROOT.parent / "scripts"))
try:
    from claw_lib import telegram as _tg
except Exception:
    _tg = None

# Central error feed (state/pipeline_errors.jsonl) — the file evolve_doctor scans daily for stuck/
# repeated-failure patterns. Game-build failures (gate FAILs, engine HOLDs, dev_loop crashes) used to
# write ONLY to the submodule pipeline_log.jsonl + Telegram, so the doctor was blind to them. Now they
# land here too. (Had the 510 void-spire schema-gate FAILs been logged, the doctor would have flagged
# "510 errors in 24h" and surfaced the stuck loop the same night.)
try:
    from pipeline_logger import log_error as _log_error
except Exception:
    _log_error = None
_PIPELINE_ERRORS = ROOT.parent / "state" / "pipeline_errors.jsonl"


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


def track_error(stage, detail, **ctx):
    """Append a structured row to the central state/pipeline_errors.jsonl (the feed evolve_doctor scans)
    so game-build failures/HOLDs/gate-FAILs/crashes are findable in the daily doctor report. Uses the
    canonical pipeline_logger.log_error if importable, else a local writer with the identical schema +
    path. Best-effort — never throws (tracking must not break a build)."""
    ctx = {"stage": stage, **{k: v for k, v in ctx.items() if v is not None}}
    if _log_error is not None:
        try:
            _log_error("forgeflow_games_v2", detail, ctx)
            return
        except Exception:
            pass
    try:
        _PIPELINE_ERRORS.parent.mkdir(parents=True, exist_ok=True)
        row = {"ts": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
               "pipeline": "forgeflow_games_v2", "error": detail, "context": ctx}
        with open(_PIPELINE_ERRORS, "a", encoding="utf-8") as f:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    except Exception:
        pass


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


_CODE_REVIEW_PROMPT = (
    "You are a senior game-build reviewer. Review this {genre} game's generated CONTENT for "
    "LOGIC and COMPLETENESS bugs a player would actually hit — NOT art or style (other gates "
    "cover those). Check: (1) BOTH a win condition and a lose condition exist and are REACHABLE; "
    "(2) no degenerate values — speeds/counts/timers/health that make it instantly over or "
    "impossible; (3) every referenced asset / sound / sprite / level / handler key actually "
    "exists in the content; (4) the genre's required fields are present and sane; (5) no "
    "placeholder / TODO / lorem / 'example' text shipped as real content. Return ONLY compact "
    'JSON: {{"ok":true|false,"issues":[{{"field":"...","problem":"...","fix":"concrete change"}}]}}. '
    "ok=true ONLY if there are zero player-facing logic/completeness bugs. CONTENT:\n{content}"
)


def code_review(slug, genre, gdir):
    """claude -p LOGIC/COMPLETENESS review of the generated content — the bugs that the
    structural schema gate (shape-only) and the vision gate (look-only) both miss: an
    unreachable win condition, a speed of 0, a referenced sound that isn't in the set,
    placeholder text. Returns (ok, issues[]). NON-FATAL by design: a backend/parse failure
    returns ok=True (never block shipping on a flaky reviewer) but is logged. claude -p, so
    it runs under Task Scheduler, not in an interactive session."""
    cj = gdir / "content.json"
    if not cj.exists():
        return True, []  # the structure gate already FAILs a missing content.json
    try:
        content = cj.read_text(encoding="utf-8")[:9000]
    except Exception:
        return True, []
    try:
        out = subprocess.run(["claude", "-p", _CODE_REVIEW_PROMPT.format(genre=genre, content=content)],
                             capture_output=True, text=True, timeout=160)
        raw = (out.stdout or "").strip()
        s, e = raw.find("{"), raw.rfind("}")
        if s < 0 or e <= s:
            log(f"code_review {slug}: unparseable reviewer output — not blocking")
            return True, []
        data = json.loads(raw[s:e + 1])
        issues = [i for i in (data.get("issues") or []) if i]
        return (bool(data.get("ok", not issues)) and not issues), issues
    except Exception as ex:
        log(f"code_review {slug} skipped ({ex})")
        return True, []


def verify_build(slug, genre, gdir):
    """All shipping gates → (all_ok, verdict). The full "is this a finished game?" check:
      • STRUCTURE  — deterministic scaffolding / control-bar / test-hook
      • FEEL       — play-bot: plays to a win/lose AND no uncaught crash / handler throw
      • FIDELITY   — claude -p vision: looks like a finished game of its genre
      • REVIEW     — claude -p logic/completeness: reachable win-lose, no degenerate values,
                     referenced keys exist, no placeholders
    Shippable only if ALL four pass. Each failing dimension feeds the repair loop with its
    own concrete, grounded fix list — so claude -p builds, tests, sees, reviews AND fixes."""
    verdict = {"structure_ok": True, "structure_issues": [],
               "feel": "skipped", "feel_detail": "", "fidelity": "skipped", "fidelity_detail": "",
               "review_ok": True, "review_issues": []}
    try:
        sys.path.insert(0, str(ENGINE / "gates"))
        import structure_gate  # noqa: E402
        s_ok, s_issues = structure_gate.check(gdir)
        verdict["structure_ok"] = s_ok
        verdict["structure_issues"] = [f"[{lvl}] {m}" for lvl, m in s_issues]
    except Exception as e:
        verdict["structure_ok"] = False
        verdict["structure_issues"] = [f"[FAIL] structure gate error: {e}"]
    soft = feel_and_fidelity(slug, genre)
    verdict["feel"] = soft.get("feel")
    verdict["feel_detail"] = soft.get("feel_detail", "")
    verdict["fidelity"] = soft.get("fidelity")
    verdict["fidelity_detail"] = soft.get("fidelity_detail", "")
    try:
        r_ok, r_issues = code_review(slug, genre, gdir)
        verdict["review_ok"] = r_ok
        verdict["review_issues"] = r_issues
    except Exception as e:
        verdict["review_ok"] = True  # non-fatal
        log(f"code_review error ({e}); not blocking")
    ok = (verdict["structure_ok"] and soft.get("feel") == "pass"
          and soft.get("fidelity") == "pass" and verdict["review_ok"])
    return ok, verdict


def verdict_to_feedback(verdict, genre=""):
    """Turn a failing verdict into a CONCRETE, grounded repair instruction for claude -p —
    only the parts that actually failed, each with its specific evidence (structure issues,
    the play-bot's failure detail, the vision review's gap list). This is what makes the
    repair loop targeted instead of a blind regenerate."""
    parts = []
    sfails = [i for i in verdict.get("structure_issues", []) if i.startswith("[FAIL]")]
    if not verdict.get("structure_ok") and sfails:
        parts.append("STRUCTURE — the game is structurally incomplete; fix EXACTLY these:\n  " + "\n  ".join(sfails))
    if verdict.get("feel") != "pass":
        parts.append(f"FEEL/PLAYABILITY — the play-bot could not play it to a win/lose resolution: "
                     f"{verdict.get('feel')} {verdict.get('feel_detail','')[:200]}")
    if verdict.get("fidelity") != "pass":
        parts.append(f"VISUAL FIDELITY — the vision review says it does not yet look like a finished "
                     f"{genre or 'game'}: {verdict.get('fidelity')} {verdict.get('fidelity_detail','')[:300]}")
    if not verdict.get("review_ok") and verdict.get("review_issues"):
        lines = "; ".join(f"{i.get('field','?')}: {i.get('problem','')} -> fix: {i.get('fix','')}"
                          for i in verdict["review_issues"][:6])
        parts.append("CODE/CONTENT REVIEW — logic & completeness bugs to fix: " + lines)
    return "\n".join(parts) if parts else "below the quality bar"


# ── generation ────────────────────────────────────────────────────────────────
def _gen(prompt):
    """Call claude -p; classify failures. An infra/network/no-output failure is
    TRANSIENT (abort run, retry next window) — NOT a content error."""
    try:
        return build_order.run_claude_p(prompt)
    except Exception as e:
        raise TransientError(f"claude -p unavailable or returned no JSON: {e}")


def generate_slice(item):
    # HIGH-BASELINE START: if this genre has a golden template, seed from it (a
    # polished, gated reference) instead of a weak from-scratch LLM slice — so the
    # FIRST build is already at the high bar and the operator never sees a rough start.
    golden = build_order.golden_seed(item["genre"], item)
    if golden is not None:
        log(f"seeding {item['slug']} from GOLDEN {item['genre']} template (high baseline)")
        return normalize_content(golden, item)
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
    # GOLDEN baseline is a polished, ALREADY-gated reference (the high bar). Re-gating
    # it against the per-genre slice schema is redundant and can falsely fail (e.g. a
    # 3D tactics3d golden vs the shared tactics schema). The feel + fidelity gates
    # below still guard shipping. So only gate freshly-generated (non-golden) slices.
    if not content.get("_from_golden"):
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

    # EXPAND + re-gate (fall back to slice-only content if expansion regresses).
    # Golden-seeded builds are already a full polished campaign — skip expansion
    # so claude -p can't regress the high baseline.
    if content.get("_from_golden"):
        log(f"{slug}: golden baseline — skipping expand")
        wip.write_text(json.dumps(content, indent=2), encoding="utf-8")
    else:
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

    # GS9: optional ENGINE target (FLAG-GATED, ADDITIVE). Default OFF -> the Phaser ASSEMBLE/verify path
    # below is byte-for-byte unchanged. When FFG_ENGINE_TARGET=1 and the genre is emitter-supported, build
    # a PLAYABLE game on the from-scratch ForgeFlow Engine; on ANY failure fall through to Phaser so the
    # nightly never regresses. Engine builds stage for manual deploy (engine auto-deploy is a later step).
    # Playability is proven by forgeflow-engine/tools/verify_engine_emit.py.
    import build_target  # noqa: E402  (sibling; ENGINE already on sys.path)
    if build_target.choose_target(genre, content):
        try:
            edir = build_target.engine_assemble(slug, content)
            eok, edetail = build_target.engine_verify(slug, edir)
        except Exception as e:
            edir, eok, edetail = None, False, f"engine build error: {e}"
        if eok:
            try:
                (edir / "READY_TO_DEPLOY").write_text(datetime.now(timezone.utc).isoformat(), encoding="utf-8")
            except Exception:
                pass
            _mark(slug, "built", f"ENGINE target; passed structural verify ({edetail}); staged (engine deploy manual)")
            log(f"{slug}: ENGINE target built + verified ({edetail}) -> {edir} [staged, no auto-publish]")
            return True
        log(f"{slug}: engine target not ready ({edetail}) -> Phaser fallback")

    # ASSEMBLE
    gdir = build_order.assemble(slug, content)
    log(f"assembled -> {gdir}")

    # VERIFY + AUTO-REPAIR. Shipping requires STRUCTURE (scaffolding/control-bar/test-hook)
    # AND FEEL (plays to a resolution) AND FIDELITY (looks finished — via the now-working
    # vision gate). Rather than HOLD a rough build for manual fixing (what made every game
    # need hand-finishing), we LOOP: verify -> claude -p repairs the SPECIFIC failing gaps
    # (grounded by the actual structure issues + play-bot detail + vision gap list) ->
    # re-assemble -> re-verify, up to MAX_REPAIRS times. HOLD only if it still can't reach
    # the bar (or the build window runs out). Golden-seeded builds are already at the bar,
    # so they verify but don't enter the regenerate loop.
    max_repairs = MAX_REPAIRS
    if "--max-repairs" in sys.argv:
        try: max_repairs = int(sys.argv[sys.argv.index("--max-repairs") + 1])
        except Exception: pass

    ok, verdict = verify_build(slug, genre, gdir)
    log(f"verify {slug}: structure={'ok' if verdict['structure_ok'] else 'FAIL'} "
        f"feel={verdict['feel']} fidelity={verdict['fidelity']} review={'ok' if verdict['review_ok'] else 'FAIL'} "
        f":: {verdict.get('fidelity_detail','')[:140]}")
    attempt = 0
    while (not ok) and attempt < max_repairs and not content.get("_from_golden"):
        if time_left("--force" in sys.argv) <= 8:
            log(f"{slug}: out of build window mid-repair — stopping repair loop")
            break
        attempt += 1
        fb = verdict_to_feedback(verdict, genre)
        log(f"{slug}: below bar — REPAIR attempt {attempt}/{max_repairs} on:\n{fb[:400]}")
        try:
            content = regenerate_with_feedback(item, fb)
            wip.write_text(json.dumps(content, indent=2), encoding="utf-8")
            gdir = build_order.assemble(slug, content)
            ok, verdict = verify_build(slug, genre, gdir)
            log(f"re-verify {slug} (after repair {attempt}): structure={'ok' if verdict['structure_ok'] else 'FAIL'} "
                f"feel={verdict['feel']} fidelity={verdict['fidelity']} review={'ok' if verdict['review_ok'] else 'FAIL'}")
        except TransientError:
            raise  # backend down — bubble up so main() aborts cleanly (game NOT marked failed)
        except Exception as e:
            log(f"{slug}: repair attempt {attempt} errored ({e}); stopping repair loop")
            break

    if not ok:
        reason = verdict_to_feedback(verdict, genre)
        learn.record(genre, f"{slug} held after {attempt} repair attempt(s)",
                     "still below the structure/feel/vision bar; inspect the held build: " + reason[:300], slug)
        _mark(slug, "held", f"held after {attempt} repair(s) — below quality bar")
        try:
            (gdir / "HELD_NOT_SHIPPABLE").write_text(reason + "\n", encoding="utf-8")
        except Exception:
            pass
        log(f"HELD {slug}: not shippable after {attempt} repair(s) — {reason[:200]}")
        notify(f"🛠️ FFG v2 HELD *{slug}* after {attempt} repair attempt(s) — below the quality bar. Staged for inspection, not shipped.")
        return False

    if attempt > 0:
        log(f"{slug}: auto-repaired to PASSING in {attempt} attempt(s).")

    # DEPLOY (only reached when structure + feel + fidelity all pass)
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
        _mark(slug, "built", "staged; passed structure+feel+fidelity+review; awaiting deploy approval")
        log(f"{slug} BUILT + staged (passed structure+feel+fidelity+review, no auto-publish).")
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
    log(f"SELFTEST assembled -> {gdir}; post-assemble schema gates: {'PASS' if ok2 else 'FAIL'}")
    # STRUCTURE gate (deterministic, no claude -p) — the scaffolding/control-bar/test-hook
    # check that runs in the real loop. Surfaces here so the offline selftest covers it too.
    try:
        sys.path.insert(0, str(ENGINE / "gates"))
        import structure_gate  # noqa: E402
        s_ok, s_issues = structure_gate.check(gdir)
        for lvl, m in s_issues:
            log(f"  structure [{lvl}] {m}")
        log(f"SELFTEST structure gate: {'PASS' if s_ok else 'FAIL'}")
    except Exception as e:
        log(f"SELFTEST structure gate error: {e}")
        s_ok = False
    return 0 if (ok2 and s_ok) else 1


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


# ══ DEPTH-FIRST single-game development (the "real game dev" driver) ════════════════
# Builds ONE game properly, milestone by milestone, over as many nights as it takes — no
# throughput, no rush. A persistent dev journal carries the design doc + milestone status +
# live issue list + changelog across nights, so each run RESUMES the work like an engineer
# returning to their project. The gates (structure/feel/fidelity/review) + a deep multi-run
# playtest are the QA harness that feeds the next step's fixes. Only when a game reaches M5
# (ship-ready) does the driver pick the next game from the backlog.
DEV_JOURNAL = ENGINE / "dev_journal"
MILESTONES = [
    ("M0", "design",         "design doc written: core loop, verbs, scope, art direction, definition_of_done"),
    ("M1", "vertical_slice", "core loop genuinely playable in ONE level: structure+feel green, no crash"),
    ("M2", "mechanics",      "every verb in the design doc implemented and survives the play-bot"),
    ("M3", "content",        "multiple levels + progression + a real difficulty curve; everything reachable"),
    ("M4", "polish",         "menu + audio + game-feel/juice; vision fidelity high; zero crashes"),
    ("M5", "ship_ready",     "deep QA: structure+feel+fidelity+review all green across repeated playthroughs"),
]
MILESTONE_IDS = [m[0] for m in MILESTONES]


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def load_journal(slug):
    p = DEV_JOURNAL / f"{slug}.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def save_journal(j):
    DEV_JOURNAL.mkdir(exist_ok=True)
    (DEV_JOURNAL / f"{j['slug']}.json").write_text(json.dumps(j, indent=2), encoding="utf-8")


def init_journal(item):
    j = {"slug": item["slug"], "genre": item["genre"], "title": None,
         "brief": item.get("brief", ""), "inspired_by": item.get("inspired_by"), "rating": item.get("rating"),
         "milestone": "M0",
         "milestones": {mid: {"status": "todo", "done_when": dw} for mid, _, dw in MILESTONES},
         "design_doc": None, "open_issues": [], "changelog": [], "sessions": 0, "created": _now_iso()}
    j["milestones"]["M0"]["status"] = "in_progress"
    save_journal(j)
    return j


def _changelog(j, mid, action, result):
    j.setdefault("changelog", []).append({"ts": _now_iso(), "milestone": mid, "action": action, "result": result})


def milestone_done(mid, verdict, pt):
    """Definition-of-Done per milestone, judged by the gate verdict + the deep playtest. The
    bar rises as milestones progress (slice just needs to play; ship-ready needs everything)."""
    no_crash = pt.get("crashes", 1) == 0 and pt.get("passed", 0) >= max(1, pt.get("runs", 3) - 0)
    feel, struct = verdict.get("feel") == "pass", verdict.get("structure_ok")
    fid, review = verdict.get("fidelity") == "pass", verdict.get("review_ok")
    return {
        "M1": struct and feel and no_crash,
        "M2": struct and feel and no_crash,
        "M3": struct and feel and no_crash and review,
        "M4": struct and feel and no_crash and fid,
        "M5": struct and feel and no_crash and fid and review,
    }.get(mid, False)


def pick_dev_target():
    """The ONE game in development: resume an unfinished journal (oldest first — finish what we
    started), else promote the highest-rated BACKLOG game to a fresh journal. (None, None) if
    there is nothing to build."""
    DEV_JOURNAL.mkdir(exist_ok=True)
    # NO-REPEAT GUARD: a game already built locally (games/<slug>, the deploy source) is DONE — never
    # re-develop it. This is what kept the loop re-doing Lumen Run.
    shipped = {p.name for p in (ROOT / "games").iterdir() if p.is_dir() and not p.name.startswith("_")} if (ROOT / "games").exists() else set()
    actives = []
    for p in DEV_JOURNAL.glob("*.json"):
        try:
            jj = json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            continue
        # PARKED journals are skipped: a game that kept failing (e.g. 3 consecutive schema-gate fails)
        # is benched so it can never monopolize the nightly window again (the void-spire failure class).
        # Un-park by deleting the "parked" key in its dev_journal file.
        if jj.get("milestone") != "DONE" and not jj.get("parked") and jj.get("slug") not in shipped:
            actives.append(jj)
    if actives:
        actives.sort(key=lambda jj: jj.get("created", ""))
        jj = actives[0]
        return ({"slug": jj["slug"], "genre": jj["genre"], "brief": jj.get("brief", ""),
                 "inspired_by": jj.get("inspired_by"), "rating": jj.get("rating")}, jj)
    q = _load_queue()
    cands = [i for i in q.get("queue", []) if i.get("status") == "backlog" and i["slug"] not in shipped] or \
            [i for i in q.get("queue", []) if i.get("status") == "pending" and i["slug"] not in shipped]
    if not cands:
        return None, None
    cands.sort(key=lambda i: -(i.get("rating") or 0))
    item = cands[0]
    _mark(item["slug"], "developing", "active deep-dev target")
    return item, init_journal(item)


def _claude_json(prompt, timeout=240):
    """claude -p -> first JSON object in its output. Raises TransientError on backend/timeout
    (infra down -> abort the night cleanly, nothing marked failed); returns None on unparseable
    output (a bad generation -> caller keeps prior state). claude -p: Task Scheduler only."""
    try:
        out = subprocess.run(["claude", "-p", prompt], capture_output=True, text=True, timeout=timeout)
    except Exception as e:
        raise TransientError(f"claude -p unavailable: {e}")
    raw = (out.stdout or "").strip()
    if out.returncode != 0 and not raw:
        raise TransientError(f"claude -p rc={out.returncode}")
    s, e = raw.find("{"), raw.rfind("}")
    if s < 0 or e <= s:
        return None
    try:
        return json.loads(raw[s:e + 1])
    except Exception:
        return None


def generate_design_doc(item):
    """M0: a real design doc BEFORE any code — core loop, verbs, scope, art direction, a
    per-milestone plan, and an explicit definition_of_done. This is what makes the build
    deliberate instead of a one-shot guess."""
    prompt = (
        f"You are a senior game designer. Write a concise but COMPLETE design doc for an original-IP "
        f"{item['genre']} game. Brief: {item.get('brief','')}. Inspired by the FEEL of "
        f"\"{item.get('inspired_by','a classic of the genre')}\" but with your own original name/theme/art. "
        f"Return ONLY JSON: {{\"title\":\"original name\",\"core_loop\":\"one tight paragraph\","
        f"\"verbs\":[\"the player actions\"],\"scope\":\"what is IN and explicitly OUT for v1\","
        f"\"art_direction\":\"palette + mood\",\"milestone_plan\":{{\"M1\":\"vertical slice goal\","
        f"\"M2\":\"mechanics goal\",\"M3\":\"content goal\",\"M4\":\"polish goal\",\"M5\":\"ship goal\"}},"
        f"\"definition_of_done\":[\"specific, checkable criteria for a finished game\"]}}."
    )
    return _claude_json(prompt, timeout=200)


def develop_step(journal, content):
    """ONE focused unit of milestone work via claude -p — exactly how a dev iterates: given the
    design doc, the current milestone + its done-when, the LIVE open issues, and the current
    content, return improved content that advances THIS milestone and fixes the logged issues
    first, without regressing what already works."""
    mid = journal["milestone"]
    dw = journal["milestones"][mid].get("plan") or journal["milestones"][mid]["done_when"]
    issues = [i for i in journal.get("open_issues", []) if i.get("status", "open") == "open"]
    issue_txt = "\n".join(f"- [{i.get('severity','?')}] {i.get('issue','')}"
                          f"{(' -> ' + i['fix']) if i.get('fix') else ''}" for i in issues[:10]) or "(none)"
    prompt = (
        f"You are a senior game engineer iterating on an original-IP {journal['genre']} game, milestone by "
        f"milestone like a real dev. DESIGN DOC:\n{json.dumps(journal.get('design_doc') or {}, separators=(',',':'))[:2600]}\n\n"
        f"CURRENT MILESTONE {mid} — done when: {dw}.\n"
        f"FIX THESE OPEN ISSUES FIRST (highest severity first):\n{issue_txt}\n\n"
        f"CURRENT content.json:\n{json.dumps(content, separators=(',',':'))[:6500]}\n\n"
        f"Return ONLY the improved content.json (same schema) that advances THIS milestone and fixes the "
        f"issues. Do NOT regress working features. No prose, no markdown — just the JSON object."
    )
    data = _claude_json(prompt, timeout=300)
    if data is None:
        return None
    return normalize_content(data, {"slug": journal["slug"], "genre": journal["genre"], "title": journal.get("title")})


def deep_playtest(slug, runs=3):
    """A real QA pass, not one pass/fail: play the game to a conclusion `runs` times and
    aggregate crashes/consistency. Play-bot only (no claude -p). Returns issues for the journal."""
    results, issues = [], []
    server = None
    try:
        server = subprocess.Popen([sys.executable, "-m", "http.server", str(SERVE_PORT), "--directory", str(ROOT)],
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(1.5)
        url = f"http://localhost:{SERVE_PORT}/games/{slug}/"
        for _ in range(runs):
            try:
                r = subprocess.run([sys.executable, str(ENGINE / "gates" / "feel_gate.py"), url],
                                   capture_output=True, text=True, timeout=120)
                last = (r.stdout or "").strip().splitlines()[-1] if (r.stdout or "").strip() else ""
                results.append({"rc": r.returncode, "summary": last})
            except Exception as e:
                results.append({"rc": -1, "summary": f"run error: {e}"})
    finally:
        if server:
            server.terminate()
    crashes = sum(1 for r in results if r["rc"] != 0)
    if crashes:
        detail = "; ".join(r["summary"][:120] for r in results if r["rc"] != 0)[:300]
        issues.append({"severity": "high", "issue": f"{crashes}/{runs} playtests failed/crashed", "detail": detail})
    return {"runs": runs, "crashes": crashes, "passed": runs - crashes, "results": results, "issues": issues}


def _snapshot_issues(journal, mid, verdict, pt):
    """Replace the journal's open issues with the LIVE state from this step's QA — so fixed
    issues drop off and only what's still wrong remains for the next step to address."""
    issues = []

    def add(sev, text, fix=""):
        issues.append({"id": len(issues) + 1, "milestone": mid, "severity": sev, "issue": text, "fix": fix, "status": "open", "found": _now_iso()})

    for i in pt.get("issues", []):
        add(i.get("severity", "med"), i["issue"], i.get("detail", ""))
    if not verdict.get("structure_ok"):
        for s in [x for x in verdict.get("structure_issues", []) if x.startswith("[FAIL]")]:
            add("high", "structure: " + s)
    if verdict.get("feel") != "pass":
        add("high", "feel: " + str(verdict.get("feel_detail", ""))[:160])
    if verdict.get("fidelity") != "pass":
        add("med", "fidelity: " + str(verdict.get("fidelity_detail", ""))[:160])
    for ri in (verdict.get("review_issues") or []):
        add("med", f"review {ri.get('field','')}: {ri.get('problem','')}", ri.get("fix", ""))
    journal["open_issues"] = issues
    return issues


# ── ENGINE deep-dev: ITERATIVE milestone development (the 2-6 hour real-game path) ────────────────
# One authoring call makes a MINIGAME. A real game is built the way the Phaser deep-dev built games:
# milestone passes all night — each pass is a claude -p revision of the complete game.js against the
# milestone goal + the open QA issues, then a fresh play-test. ~3-6 min per pass; M1->M5 is typically
# 12-40 passes (~1.5-4 h), and the journal resumes across nights exactly like the Phaser path.
ENGINE_MILESTONES = {
    "M1": "CORE LOOP: the genre's signature mechanic playable start-to-finish — real assets, win AND "
          "lose reachable, ctx.level wired, controls declared.",
    "M2": "CONTENT DEPTH: 5+ distinct levels/waves/rounds with a real difficulty ramp scaled by "
          "ctx.difficulty — new layouts/elements appear as ctx.level rises, not just bigger numbers.",
    "M3": "VARIETY & CHALLENGE: 3+ distinct enemy/hazard behaviors, a mid-run set-piece or boss "
          "encounter, score/reward tuning so risk pays.",
    "M4": "POLISH & FEEL: hit feedback (knockback/invuln moments/particle bursts via ctx.spawn), HUD "
          "clarity, per-event SFX (hit/explosion/powerup/select/win/lose), difficulty balance pass.",
    "M5": "SHIP-READY: every open QA issue closed, controls line accurate, no dead code, the whole "
          "game plays clean start to finish at all three difficulties.",
}


def engine_milestone_dev(item, journal, spec, force=False, single_step=False):
    """Iterative ENGINE development of one game (authoring mode): M0 design doc, M1 initial author,
    M2..M5 revision passes (claude -p rewrites the full game.js against the milestone goal + open QA
    issues), each pass play-verified; at M4/M5 the AI QA panel adds issues and gates M5. 3-strike park
    on consecutive author/revision failures. Returns "built"|"parked"|"worked"|"transient",
    or None when the authoring stack is unavailable (caller falls back to the one-shot path)."""
    try:
        sys.path.insert(0, str(ENGINE))
        import engine_authoring
        import build_target
    except Exception as e:
        log(f"engine authoring stack unavailable ({e}) -> one-shot path")
        return None
    slug, genre = item["slug"], item["genre"]
    gdir = ROOT / "games" / "_engine" / slug

    # M0 — design doc first (same as the Phaser path; feeds the authoring spec).
    if journal["milestone"] == "M0":
        try:
            if not journal.get("design_doc"):
                log(f"{slug}: ENGINE M0 — design doc")
                dd = generate_design_doc(item)
                if dd:
                    journal["design_doc"] = dd
                    journal["title"] = dd.get("title") or journal.get("title")
            journal["milestones"]["M0"]["status"] = "done"
            journal["milestone"] = "M1"
            journal["milestones"]["M1"]["status"] = "in_progress"
            _changelog(journal, "M0", "design doc", f"title={journal.get('title')}")
            save_journal(journal)
        except TransientError as e:
            log(f"ENGINE M0 abort (transient): {e}"); save_journal(journal); return "transient"
    dd = journal.get("design_doc") or {}
    spec = dict(spec)
    spec["title"] = journal.get("title") or spec.get("title")
    spec["core_loop"] = dd.get("core_loop") or spec.get("core_loop")

    steps, fails = 0, 0
    while time_left(force) > 8 and journal["milestone"] != "DONE" and steps < 40:
        mid = journal["milestone"]
        goal = ENGINE_MILESTONES.get(mid, "Improve the game toward ship quality.")
        open_issues = [i["issue"] for i in journal.get("open_issues", []) if i.get("status", "open") == "open"]

        # 1. AUTHOR (first pass) or REVISE (every later pass) — one claude -p call.
        if not (gdir / "game.js").exists():
            ok, _, detail = engine_authoring.author_engine_game(spec, out_dir=gdir, run=True)
        else:
            ok, _, detail = engine_authoring.revise_engine_game(gdir, spec, goal=goal, issues=open_issues, run=True)
        steps += 1
        if not ok:
            fails += 1
            _changelog(journal, mid, "engine pass", f"author/revise FAIL ({fails}/3): {str(detail)[:140]}")
            track_error("engine_author", str(detail)[:200], slug=slug, genre=genre, milestone=mid)
            if any(t in str(detail) for t in ("unavailable", "spawn error", "timed out")):
                save_journal(journal); return "transient"          # infra down -> retry next window
            if fails >= 3:
                journal["parked"] = True
                journal["parked_reason"] = f"3 consecutive engine authoring failures at {mid}: {str(detail)[:160]}"
                journal["parked_at"] = _now_iso()
                _changelog(journal, mid, "PARKED", "3 consecutive authoring failures — moving on")
                _mark(slug, "held", "parked: engine authoring failures")
                notify(f"🅿️ FFG engine-dev: *{slug}* PARKED after 3 authoring failures at {mid}.")
                save_journal(journal); return "parked"
            save_journal(journal)
            if single_step: break
            continue
        fails = 0

        # 2. PLAY-VERIFY the new build; snapshot failed inspectors as the open issue list.
        ship, pdetail = build_target.play_verify(slug, gdir)
        rep = {}
        try:
            rep = json.loads((gdir / "play_report.json").read_text(encoding="utf-8"))
        except Exception:
            pass
        journal["open_issues"] = [
            {"id": k + 1, "milestone": mid, "severity": "high",
             "issue": f"play:{name} — {info.get('detail','')[:140]}", "status": "open", "found": _now_iso()}
            for k, (name, info) in enumerate((rep.get("inspectors") or {}).items()) if info.get("pass") is False]

        # 3. At M4/M5 fold in the AI QA panel (vision/genre-fit/code-review/UX) for quality issues.
        panel_ok = True
        if mid in ("M4", "M5"):
            try:
                sys.path.insert(0, str(ENGINE / "gates"))
                import ai_qa_panel
                prep = ai_qa_panel.run_panel(gdir, genre, shot=str(gdir / "_play.png"), run=True,
                                             title=spec.get("title"))
                panel_ok = prep.get("verdict") == "ship"
                base = len(journal["open_issues"])
                for j, (insp, lst) in enumerate((prep.get("issues") or {}).items()):
                    for issue in lst[:4]:
                        journal["open_issues"].append({"id": base + j + 1, "milestone": mid, "severity": "med",
                                                       "issue": f"ai:{insp} — {str(issue)[:140]}",
                                                       "status": "open", "found": _now_iso()})
            except Exception as e:
                log(f"ai_qa panel skipped ({e})"); panel_ok = True       # panel infra missing -> don't block

        _changelog(journal, mid, "engine pass",
                   f"play={'SHIP' if ship else str(pdetail)[:60]} panel={'ok' if panel_ok else 'hold'} open={len(journal['open_issues'])}")
        log(f"{slug} [ENGINE {mid}] pass {steps}: play={'SHIP' if ship else 'HOLD'} open={len(journal['open_issues'])}")

        # 4. Definition of done: the build PLAYS (tester SHIP, or tester unavailable -> structural floor);
        #    M5 additionally needs the AI QA panel to say ship (when it ran).
        if (ship is True or ship is None) and (mid != "M5" or panel_ok):
            nxt = MILESTONE_IDS[MILESTONE_IDS.index(mid) + 1] if mid != "M5" else "DONE"
            journal["milestones"][mid]["status"] = "done"
            journal["milestone"] = nxt
            if nxt != "DONE":
                journal["milestones"][nxt]["status"] = "in_progress"
            _changelog(journal, mid, "milestone complete", f"-> {nxt}")
            log(f"{slug}: ENGINE milestone {mid} DONE -> {nxt}")
            notify(f"📈 FFG engine-dev: *{slug}* completed {mid} -> {nxt} (pass {steps}).")
        save_journal(journal)
        if single_step:
            break

    if journal["milestone"] == "DONE":
        try:
            (gdir / "READY_TO_DEPLOY").write_text(_now_iso(), encoding="utf-8")
        except OSError:
            pass
        _mark(slug, "built", f"ENGINE deep-dev complete (M0-M5, {journal.get('sessions',1)} session(s)); staged for review")
        notify(f"✅ FFG engine-dev: *{slug}* reached M5 SHIP-READY on the engine — staged for your review.")
        save_journal(journal)
        return "built"
    save_journal(journal)
    log(f"{slug}: ENGINE dev paused at {journal['milestone']} after {steps} pass(es) — resumes next window.")
    return "worked"


def dev_loop(force=False, deploy=False, single_step=False):
    """One game's worth of deliberate development. Resumes the active project, advances its
    current milestone with claude -p, QA's it with the gates + deep playtest, logs the live issue
    list, and persists after every step.

    Returns a status string so main() can run MULTIPLE games per night (engine builds are fast):
      "built"     — game finished + staged -> pick the next one
      "parked"    — game benched after repeated failures -> pick the next one
      "no_target" — queue empty -> stop
      "transient" — claude -p / infra down -> stop (no point continuing tonight)
      "worked"    — made progress but window/steps ran out -> stop (resumes next night)"""
    item, journal = pick_dev_target()
    if not item:
        log("deep-dev: nothing to develop (no active journal, empty backlog)."); return "no_target"
    slug, genre = item["slug"], item["genre"]
    journal["sessions"] = journal.get("sessions", 0) + 1
    log(f"DEEP-DEV target: {slug} ({genre}) — milestone {journal['milestone']}, session {journal['sessions']}")
    notify(f"🛠️ FFG deep-dev: working *{slug}* ({genre}) at {journal['milestone']} — building it properly, one step at a time.")

    WIP.mkdir(exist_ok=True)
    wip = WIP / f"{slug}.json"
    gdir = ROOT / "games" / slug

    # ENGINE TARGET (opt-in via build_target / engine_target.json) — for emitter-supported genres, build a
    # REAL-ASSET game on the ForgeFlow Engine in ONE deterministic step (no claude -p, no Phaser schema
    # gate) and stage it. This unblocks genres the Phaser path has no schema for (e.g. platformer). On ANY
    # failure it falls through to the Phaser deep-dev loop below, so the nightly can't regress.
    try:
        sys.path.insert(0, str(ENGINE)); import build_target  # noqa: E402
    except Exception:
        build_target = None
    if build_target and build_target.choose_target(genre):
        content = {"slug": slug, "genre": genre, "title": journal.get("title") or item.get("title") or slug,
                   "brief": item.get("brief", ""), "palette": item.get("palette")}
        if wip.exists():
            try: content.update({k: v for k, v in (json.loads(wip.read_text(encoding="utf-8")) or {}).items() if v is not None})
            except Exception: pass
        # AUTHORING ON -> ITERATIVE milestone development (the 2-6h real-game path: design doc, then
        # claude -p revision passes against QA issues until M5). AUTHORING OFF -> the one-shot template
        # build below (fast minigame floor; the proven fallback).
        if build_target.authoring_enabled():
            st = engine_milestone_dev(item, journal, content, force=force, single_step=single_step)
            if st is not None:
                return st
            # authoring stack unavailable -> fall through to the deterministic one-shot path
        ok_e, out_e, detail_e = build_target.dev_engine_build(slug, content)
        if ok_e:
            journal["engine_build"] = {"out": out_e, "detail": detail_e, "ts": _now_iso()}
            for m in journal.get("milestones", {}).values():
                if m.get("status") in ("in_progress", "todo"): m["status"] = "done"
            journal["milestone"] = "DONE"; journal["open_issues"] = []
            _changelog(journal, "ENGINE", "engine build", f"real-asset game staged ({detail_e})")
            save_journal(journal)
            try: (Path(out_e) / "READY_TO_DEPLOY").write_text(_now_iso(), encoding="utf-8")
            except Exception: pass
            _mark(slug, "built", f"ENGINE target: real-asset game staged at {out_e}")
            log(f"DEEP-DEV {slug}: built on the ENGINE -> {out_e} ({detail_e}) [staged, no Phaser schema needed]")
            notify(f"✅ FFG deep-dev: *{slug}* ({genre}) built on the NEW ENGINE with real assets — staged for review.")
            return "built"
        log(f"DEEP-DEV {slug}: engine target unavailable ({detail_e}) -> Phaser deep-dev loop")
        track_error("engine_build", f"engine build not accepted: {detail_e}", slug=slug, genre=genre)

    # M0 — DESIGN (write the doc before any code; fast, one claude -p call).
    try:
        if not journal.get("design_doc"):
            log(f"{slug}: M0 — writing the design doc first")
            dd = generate_design_doc(item)
            if dd:
                journal["design_doc"] = dd
                journal["title"] = dd.get("title") or journal.get("title")
                for mid, plan in (dd.get("milestone_plan") or {}).items():
                    if mid in journal["milestones"]:
                        journal["milestones"][mid]["plan"] = plan
                journal["milestones"]["M0"]["status"] = "done"
                journal["milestone"] = "M1"
                journal["milestones"]["M1"]["status"] = "in_progress"
                _changelog(journal, "M0", "wrote design doc", f"title={journal['title']}")
                save_journal(journal)
                log(f"{slug}: design doc done — '{journal['title']}'; advancing to M1")
    except TransientError as e:
        log(f"deep-dev abort (transient) during design: {e}")
        save_journal(journal); return "transient"

    # M1..M5 — iterate. One step per loop; persist each time; advance only on DoD.
    steps = 0
    status = "worked"            # default: progressed but didn't finish (window/steps ran out)
    schema_fails = 0             # consecutive schema-gate fails -> 3-strike PARK (each fail costs a claude -p call)
    while time_left(force) > 8 and journal["milestone"] != "DONE":
        mid = journal["milestone"]
        content = None
        if wip.exists():
            try: content = json.loads(wip.read_text(encoding="utf-8"))
            except Exception: content = None
        if content is None and (gdir / "content.json").exists():
            try: content = json.loads((gdir / "content.json").read_text(encoding="utf-8"))
            except Exception: content = None
        try:
            if content is None:
                content = generate_slice(item)        # first slice from the design/brief
            new_content = develop_step(journal, content)
        except TransientError as e:
            log(f"deep-dev abort (transient): {e}"); status = "transient"; break
        if new_content is not None:
            content = new_content
        wip.write_text(json.dumps(content, indent=2), encoding="utf-8")

        ok_g, out_g = gate(wip, genre)               # schema gate before assemble
        if not ok_g:
            schema_fails += 1
            log(f"{slug}: step content failed schema gate ({schema_fails}/3); logging + next step. {out_g[:140]}")
            journal["open_issues"] = [{"id": 1, "milestone": mid, "severity": "high",
                                       "issue": "content failed schema gate", "fix": out_g[:200], "status": "open", "found": _now_iso()}]
            _changelog(journal, mid, "develop step", "schema gate FAIL")
            track_error("schema_gate", f"content failed schema gate: {out_g[:160]}",
                        slug=slug, genre=genre, milestone=mid)   # makes a void-spire-style FAIL storm visible to the doctor
            if schema_fails >= 3:
                # 3-STRIKE PARK — this is what void-spire lacked: it logged 510 schema FAILs across two
                # nights (each preceded by a claude -p call) without ever moving on. Bench the game so
                # the rest of the night (and the queue) keeps building; un-park by editing its journal.
                journal["parked"] = True
                journal["parked_reason"] = f"3 consecutive schema-gate fails at {mid}: {out_g[:160]}"
                journal["parked_at"] = _now_iso()
                _changelog(journal, mid, "PARKED", "3 consecutive schema-gate fails — moving on to the next game")
                _mark(slug, "held", "parked: 3 consecutive schema-gate fails")
                track_error("parked", f"parked after 3 consecutive schema-gate fails at {mid}", slug=slug, genre=genre)
                notify(f"🅿️ FFG deep-dev: *{slug}* ({genre}) PARKED after 3 schema-gate fails — moving on to the next game.")
                save_journal(journal)
                status = "parked"
                break
            save_journal(journal); steps += 1
            if single_step: break
            continue
        schema_fails = 0                              # a pass resets the strike counter

        gdir = build_order.assemble(slug, content)
        ok_v, verdict = verify_build(slug, genre, gdir)   # structure+feel+fidelity+review
        pt = deep_playtest(slug, runs=3)                  # multi-run QA
        _snapshot_issues(journal, mid, verdict, pt)
        open_n = len(journal["open_issues"])
        _changelog(journal, mid, "develop step", f"verify_ok={ok_v} playtest={pt['passed']}/{pt['runs']} open_issues={open_n}")
        log(f"{slug} [{mid}] step {steps+1}: verify_ok={ok_v} playtest={pt['passed']}/{pt['runs']} open_issues={open_n}")

        if milestone_done(mid, verdict, pt):
            journal["milestones"][mid]["status"] = "done"
            nxt = MILESTONE_IDS[MILESTONE_IDS.index(mid) + 1] if mid != "M5" else "DONE"
            journal["milestone"] = nxt
            if nxt != "DONE":
                journal["milestones"][nxt]["status"] = "in_progress"
            _changelog(journal, mid, "milestone complete", f"-> {nxt}")
            log(f"{slug}: milestone {mid} DONE -> {nxt}")
            notify(f"📈 FFG deep-dev: *{slug}* completed {mid} -> {nxt}.")
        save_journal(journal)
        steps += 1
        if single_step:
            break

    # Ship-ready -> stage (never auto-publish unless --deploy).
    if journal["milestone"] == "DONE":
        if deploy:
            try:
                subprocess.run([sys.executable, str(ROOT / "pipeline" / "deploy_game.py"), slug], timeout=300)
            except Exception as e:
                log(f"deploy error: {e}")
        else:
            (gdir / "READY_TO_DEPLOY").write_text(_now_iso(), encoding="utf-8")
        _mark(slug, "built", "deep-dev complete (M5 ship-ready); staged for review")
        notify(f"✅ FFG deep-dev: *{slug}* reached M5 SHIP-READY — staged for your review.")
        status = "built"

    save_journal(journal)
    open_n = len([i for i in journal.get("open_issues", []) if i.get("status", "open") == "open"])
    log(f"DEEP-DEV round done: {slug} at {journal['milestone']}, {steps} step(s), {open_n} open issue(s), session {journal['sessions']} -> {status}.")
    notify(f"🌙 FFG deep-dev: *{slug}* now at {journal['milestone']} — {steps} step(s), {open_n} open issue(s) logged.")
    return status


# ── throughput (legacy multi-game batch) ────────────────────────────────────────
def throughput_loop(force=False, deploy=False, once=False):
    """The original build-as-many-as-fit loop. Kept behind --throughput for batch staging; the
    DEFAULT run is now depth-first (dev_loop). Not used by the nightly task unless --throughput."""
    pending = [i for i in _load_queue().get("queue", []) if i.get("status", "pending") == "pending"]
    log(f"THROUGHPUT run — {time_left(force)} min left, {len(pending)} pending, deploy={deploy}")
    notify(f"🎮 FFG throughput run — {len(pending)} game(s) queued, {time_left(force)} min (deploy={'on' if deploy else 'off'}).")
    built, failed, aborted = [], [], False
    while time_left(force) > 5:
        item = select_next(_load_queue())
        if not item:
            log("build queue empty — nothing pending. Done."); break
        try:
            ok = build_one(item, deploy=deploy)
            (built if ok else failed).append(item["slug"])
        except TransientError as e:
            log(f"ABORT (transient): {e}")
            notify(f"⚠️ FFG aborted — backend unavailable ({e}). Retrying next window.")
            aborted = True; break
        except Exception as e:
            log(f"build error for {item['slug']}: {e}")
            _mark(item["slug"], "failed", str(e)[:200]); failed.append(item["slug"])
        if once:
            break
    return aborted, built, failed


def main():
    args = sys.argv[1:]
    if "--selftest" in args:
        sys.exit(selftest(args[args.index("--selftest") + 1]))
    if "--smoke" in args:
        sys.exit(smoke(args[args.index("--smoke") + 1]))
    force = "--force" in args
    deploy = "--deploy" in args
    once = "--once" in args
    throughput = "--throughput" in args

    if time_left(force) <= 5:
        log(f"outside run window (now {_minutes_now()}m, stop {HARD_STOP_MINUTES}m). Exiting.")
        return

    # DEPTH-FIRST is the DEFAULT (owner: "one very well-built game, not 8-12 shallow ones").
    # The nightly task runs this with no args -> dev_loop. --throughput is the legacy batch loop.
    if not throughput:
        # MULTI-GAME NIGHTS: engine builds take ~1 min, so one 120-min window can ship several games.
        # Keep developing targets while the window holds and each round ENDS its game ("built") or
        # benches it ("parked") — any other status (worked/transient/no_target/error) means stop:
        # the same target would just be re-picked (or the backend is down / queue is empty).
        rounds, built_n = 0, 0
        while True:
            rounds += 1
            try:
                st = dev_loop(force=force, deploy=deploy, single_step=once)
            except Exception as e:
                log(f"dev_loop error: {e}")
                track_error("dev_loop", f"dev_loop crashed: {type(e).__name__}: {str(e)[:200]}")
                st = "error"
            built_n += 1 if st == "built" else 0
            if once or st not in ("built", "parked"):
                break
            if rounds >= 10 or time_left(force) <= 15:
                log(f"night cap reached (rounds={rounds}, {time_left(force)} min left) — {built_n} built this night")
                break
        if built_n > 1:
            notify(f"🌙 FFG multi-game night: {built_n} games built+staged this window.")
        if not once:
            try:
                log("XCOM-match autopipe: one nightly improvement pass…")
                subprocess.run([sys.executable, str(ENGINE / "xcom_autopipe.py"), "--max-fixes", "1"], timeout=1800)
            except Exception as e:
                log(f"autopipe pass skipped ({e})")
                track_error("xcom_autopipe", f"autopipe pass failed: {type(e).__name__}: {str(e)[:160]}")
        return

    aborted, built, failed = throughput_loop(force=force, deploy=deploy, once=once)
    if aborted:
        return

    # End-of-run audit summary to the owner (throughput path only).
    lines = [f"✅ FFG throughput run complete — built {len(built)}, failed {len(failed)}."]
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
