"""run_gates.py — Layer-4 orchestrator.

Runs the verification ladder for a game and writes a report. Gates that need no
external service (contract, signature) run now and BLOCK. Gates that need a
browser or claude -p (feel, fidelity) run when --url / --shot are supplied,
otherwise are reported as 'deferred' with the operator command.

Usage:
    python run_gates.py <game_dir> [--url <running_url>] [--shot <screenshot.png>]
    python run_gates.py ../../games/rift-tactics --url http://localhost:8766/games/rift-tactics/
"""
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def run_contract(content_path):
    r = subprocess.run([sys.executable, str(HERE / "contract_gate.py"), str(content_path)],
                       capture_output=True, text=True)
    return {"gate": "contract", "blocking": True, "pass": r.returncode == 0, "output": r.stdout.strip()}


def run_signature(content_path, genre):
    r = subprocess.run(["node", str(HERE / "signature_gate.cjs"), str(content_path), genre],
                       capture_output=True, text=True)
    return {"gate": "signature", "blocking": True, "pass": r.returncode == 0, "output": r.stdout.strip()}


def run_feel(url):
    r = subprocess.run([sys.executable, str(HERE / "feel_gate.py"), url], capture_output=True, text=True)
    return {"gate": "feel", "blocking": False, "pass": r.returncode == 0, "output": r.stdout.strip()}


def run_fidelity(shot, genre):
    r = subprocess.run([sys.executable, str(HERE / "fidelity_gate.py"), shot, genre, "--run"],
                       capture_output=True, text=True)
    return {"gate": "fidelity", "blocking": False, "pass": r.returncode == 0, "output": r.stdout.strip()}


def run_ai_qa(game_dir, genre, shot, run):
    """Multi-agent AI QA panel (vision_fidelity / genre_fit / code_review / ux_hud) for an ENGINE game.
    Soft at the ladder level — the panel's own report carries its blocking verdict; here it never blocks the
    Phaser ladder. Deferred unless --run (needs claude -p; vision inspectors also need --shot)."""
    if not run:
        return {"gate": "ai_qa", "blocking": False, "pass": None,
                "output": "deferred — re-run with --run (+ --shot <png> for the vision inspectors); needs claude -p"}
    sys.path.insert(0, str(HERE))
    import ai_qa_panel
    rep = ai_qa_panel.run_panel(game_dir, genre, shot=shot, run=True)
    out = (f"verdict={rep['verdict']} blocking_fails={rep['blocking_fails']} "
           f"advisory_fails={rep['advisory_fails']} deferred={rep['deferred']}")
    return {"gate": "ai_qa", "blocking": False, "pass": rep["verdict"] == "ship", "output": out}


def main():
    if len(sys.argv) < 2:
        print("usage: python run_gates.py <game_dir> [--url URL] [--shot PNG]")
        sys.exit(2)
    game_dir = Path(sys.argv[1])
    url = None
    shot = None
    genre_arg = None
    if "--url" in sys.argv:
        url = sys.argv[sys.argv.index("--url") + 1]
    if "--shot" in sys.argv:
        shot = sys.argv[sys.argv.index("--shot") + 1]
    if "--genre" in sys.argv:
        genre_arg = sys.argv[sys.argv.index("--genre") + 1]
    run = "--run" in sys.argv

    content_path = game_dir / "content.json"      # Phaser game spec
    game_js = game_dir / "game.js"                # ENGINE game (authored or emitted)
    if not content_path.exists() and not game_js.exists():
        print(f"[run_gates] no content.json or game.js in {game_dir}")
        sys.exit(2)

    results = []
    genre = genre_arg or "?"

    # ── Phaser ladder (contract/signature/feel/fidelity) — only when a content.json spec is present ──
    if content_path.exists():
        content = json.loads(content_path.read_text(encoding="utf-8"))
        genre = content.get("genre", genre)
        results.append(run_contract(content_path))
        if results[0]["pass"]:                    # signature only meaningful if contract passed
            results.append(run_signature(content_path, genre))
        else:
            results.append({"gate": "signature", "blocking": True, "pass": False, "output": "skipped (contract failed)"})
        if url:
            results.append(run_feel(url))
        else:
            results.append({"gate": "feel", "blocking": False, "pass": None, "output": "deferred — re-run with --url <running game url>"})
        if shot:
            results.append(run_fidelity(shot, genre))
        else:
            results.append({"gate": "fidelity", "blocking": False, "pass": None,
                            "output": "deferred — capture a screenshot then re-run with --shot <png> (needs claude -p)"})

    # ── ENGINE game: the multi-agent AI QA panel (additive, advisory at the ladder level) ──
    if game_js.exists():
        results.append(run_ai_qa(game_dir, genre, shot, run))

    blocking_fail = any(r["blocking"] and r["pass"] is False for r in results)
    report = {"game": str(game_dir), "genre": genre, "blocking_pass": not blocking_fail, "gates": results}
    out_path = game_dir / "gate_report.json"
    out_path.write_text(json.dumps(report, indent=2), encoding="utf-8")

    print(f"=== GATE REPORT: {game_dir.name} (genre={genre}) ===")
    for r in results:
        mark = {True: "PASS", False: "FAIL", None: "DEFER"}[r["pass"]]
        tag = "(blocking)" if r["blocking"] else "(soft)"
        print(f"  [{mark}] {r['gate']} {tag}")
    print(f"blocking gates: {'ALL PASS' if not blocking_fail else 'FAILED'}  -> {out_path}")
    sys.exit(0 if not blocking_fail else 1)


if __name__ == "__main__":
    main()
