"""learn.py — Layer-5 cross-game learning store.

Append-only rules accumulated from gate failures and post-mortems, injected into
the next build's generation prompt. This is the actual "learns over time"
mechanism — grounded in concrete past failures, not vibes.

API:
    relevant_rules(genre)            -> [rule strings]  (genre-specific + '*' global)
    record(genre, symptom, rule, evidence)              append a new rule
    ingest_gate_report(report_path, genre)              turn gate failures into rules
    prompt_block(genre)              -> str   ready to paste into a build prompt
"""
import json
from datetime import date
from pathlib import Path

STORE = Path(__file__).resolve().parent / "learnings.jsonl"


def _read():
    if not STORE.exists():
        return []
    out = []
    for line in STORE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return out


def relevant_rules(genre):
    rules = []
    for r in _read():
        if r.get("genre") in ("*", genre):
            rules.append(r["rule"])
    return rules


def record(genre, symptom, rule, evidence=""):
    entry = {"ts": date.today().isoformat(), "genre": genre, "symptom": symptom, "rule": rule, "evidence": evidence}
    with open(STORE, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")
    return entry


def ingest_gate_report(report_path, genre=None):
    """Convert blocking gate failures in a gate_report.json into learning rules."""
    rep = json.loads(Path(report_path).read_text(encoding="utf-8"))
    genre = genre or rep.get("genre", "*")
    added = 0
    for g in rep.get("gates", []):
        if g.get("pass") is False and g.get("blocking"):
            record(genre,
                   symptom=f"{g['gate']} gate failed: {g.get('output','')[:200]}",
                   rule=f"before shipping a {genre} game, ensure the {g['gate']} gate passes; re-check the content against the schema/signature probes.",
                   evidence=str(report_path))
            added += 1
    return added


def prompt_block(genre):
    rules = relevant_rules(genre)
    if not rules:
        return ""
    lines = ["LEARNED RULES (from past failures — obey strictly):"]
    for i, r in enumerate(rules, 1):
        lines.append(f"  {i}. {r}")
    return "\n".join(lines)


if __name__ == "__main__":
    import sys
    genre = sys.argv[1] if len(sys.argv) > 1 else "tactics"
    print(prompt_block(genre))
