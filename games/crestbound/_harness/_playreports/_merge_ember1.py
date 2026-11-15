"""Merge the durable playtest jsonl + worked/blocked into _playreports/ember-1.json.

The driver (_play_e1b.py) rewrites ember-1.json from its own in-memory copy on
every save, so the agent's findings live in ember-1.defects.jsonl (append-only)
and ember-1.worked.json until the runs are finished. This script folds them back
in without losing the drivers' `traces` and `played` notes.

    python _harness/_playreports/_merge_ember1.py
"""
import io, json, os

HERE = os.path.dirname(os.path.abspath(__file__))
MAIN = os.path.join(HERE, "ember-1.json")
JL = os.path.join(HERE, "ember-1.defects.jsonl")
WB = os.path.join(HERE, "ember-1.worked.json")
NARR = os.path.join(HERE, "ember-1.played.txt")


def load(p, default):
    try:
        with io.open(p, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def main():
    rep = load(MAIN, {})
    out = {"area": "ember-1"}

    defects = []
    if os.path.exists(JL):
        with io.open(JL, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    defects.append(json.loads(line))
    out["defects"] = defects

    wb = load(WB, {"worked": [], "blocked": []})
    out["worked"] = wb.get("worked", [])
    out["blocked"] = wb.get("blocked", [])

    if os.path.exists(NARR):
        out["played"] = io.open(NARR, encoding="utf-8").read().strip()
    elif rep.get("played"):
        out["played"] = rep["played"]

    # keep everything the drivers measured
    if rep.get("traces"):
        out["traces"] = rep["traces"]
    if rep.get("played") and isinstance(out.get("played"), str):
        out["driver_notes"] = rep["played"]
    if rep.get("console"):
        out["console"] = rep["console"]

    with io.open(MAIN, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1)
    print("merged: %d defects, %d worked, %d blocked, %d trace keys"
          % (len(out["defects"]), len(out["worked"]), len(out["blocked"]),
             len(out.get("traces", {}))))


if __name__ == "__main__":
    main()
