"""xcom_match.py — autonomous XCOM-fidelity VERIFIER (the "does it match the copy yet?" gate).

Captures the live game (menu establishing shot + in-battle gameplay) and asks a
Claude vision model to score how closely it matches the XCOM reference spec
(xcom_reference.md) across 9 weighted dimensions, returning a ranked list of
concrete, fixable GAPS. Writes xcom_match_report.json and a Telegram summary.

NON-INTERACTIVE ONLY: claude -p holds the OAuth lock, so run this from Task
Scheduler / cron (the nightly autopipe), never inside an interactive session.

    python xcom_match.py            # full run (starts a server, captures, claude -p)
    python xcom_match.py --dry      # capture + print the claude -p command, no model call
"""
import json, subprocess, sys, time, socket
from pathlib import Path

ENGINE = Path(__file__).resolve().parent
ROOT = ENGINE.parent.parent  # forgeflow-games
GATES = ENGINE / "gates"
REPORT = ENGINE / "xcom_match_report.json"
SLUG = "void-skirmish-3d"
TG_TOKEN = "8725965467:AAFNoygGflWdwoCA_aidViGWFAR74HI04Sc"
TG_CHAT = "8770010305"

PROMPT = (
    "You are a strict art director comparing a low-poly BROWSER tactics game to the XCOM-2 "
    "target spec below. Judge STRUCTURE, SYSTEMS, COMPOSITION and ART-DIRECTION fidelity "
    "(all achievable on this stack) — NOT raw texture/polygon realism (it's free CC0 low-poly, "
    "that ceiling is expected). Two screenshots are attached: [1] menu/establishing shot, "
    "[2] in-battle gameplay.\n\n=== XCOM TARGET SPEC ===\n{ref}\n\n"
    "Return ONLY compact JSON: "
    '{{"total":0-100,"dimensions":{{"structure":0,"buildings":0,"verticality":0,"props":0,'
    '"palette":0,"lighting":0,"units":0,"ui":0,"feel":0}},"match":true/false,'
    '"gaps":[{{"dimension":"...","issue":"...","fix_hint":"...","severity":1}}],"notes":"one sentence"}}. '
    "match=true ONLY if total>=88 and no dimension<70. gaps = ranked most-severe-first, each a "
    "CONCRETE fixable issue with a specific actionable fix_hint a programmer could act on."
)


def notify(text):
    try:
        subprocess.run(["curl", "-s", f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage",
                        "-d", f"chat_id={TG_CHAT}", "-d", f"text={text}", "-d", "parse_mode=Markdown"],
                       capture_output=True, timeout=20)
    except Exception:
        pass


def _free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p


def capture_shots(port):
    """Start a static server, capture menu + gameplay PNGs via the gate's Playwright
    helper, return [menu_png, play_png]. Returns [] on failure."""
    srv = subprocess.Popen([sys.executable, "-m", "http.server", str(port)], cwd=str(ROOT),
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        time.sleep(1.5)
        url = f"http://localhost:{port}/games/{SLUG}/"
        sys.path.insert(0, str(GATES))
        import capture  # the Playwright screenshot helper
        out_menu = ENGINE / "_match_menu.png"
        out_play = ENGINE / "_match_play.png"
        start_js = "() => { try { var t = window.__FFG3D__ && window.__FFG3D__.controller && window.__FFG3D__.controller.__test; if (t && t.start) t.start(); } catch(e){} }"
        capture.capture(url, str(out_menu), settle_ms=3500)
        capture.capture(url, str(out_play), settle_ms=4500, pre_eval=start_js)
        return [str(out_menu), str(out_play)] if out_menu.exists() and out_play.exists() else []
    except Exception as e:
        print("capture failed:", e); return []
    finally:
        srv.terminate()


def main():
    dry = "--dry" in sys.argv
    ref = (ENGINE / "xcom_reference.md").read_text(encoding="utf-8")
    port = _free_port()
    shots = capture_shots(port)
    if not shots:
        notify("⚠️ *XCOM-match*: capture failed — could not screenshot the game.")
        print(json.dumps({"ok": False, "error": "capture failed"})); return 1
    prompt = PROMPT.format(ref=ref)
    cmd = ["claude", "-p", prompt + "".join(f"\n\n@{p}" for p in shots)]
    if dry:
        print("DRY — would run:\n", cmd[0], cmd[1], "[prompt+imgs]")
        print("shots:", shots); return 0
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=240)
    except Exception as e:
        notify(f"⚠️ *XCOM-match*: claude -p failed — {e}")
        print(json.dumps({"ok": False, "error": str(e)})); return 1
    raw = (out.stdout or "").strip()
    s, e = raw.find("{"), raw.rfind("}")
    if s < 0 or e <= s:
        notify("⚠️ *XCOM-match*: could not parse vision JSON.")
        print(json.dumps({"ok": False, "raw": raw[:400]})); return 1
    data = json.loads(raw[s:e + 1]); data["ok"] = True; data["ts"] = int(time.time())
    REPORT.write_text(json.dumps(data, indent=2), encoding="utf-8")
    gaps = data.get("gaps", [])[:5]
    glines = "\n".join(f"• [{g.get('severity','?')}] {g.get('dimension','')}: {g.get('issue','')}" for g in gaps)
    notify(f"🎯 *XCOM-match*: {data.get('total','?')}/100 — {'✅ MATCH' if data.get('match') else 'gaps remain'}\n{glines}")
    print(json.dumps(data, indent=2)); return 0


if __name__ == "__main__":
    sys.exit(main())
