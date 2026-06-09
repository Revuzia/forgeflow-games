#!/usr/bin/env python3
"""test_seed_queue.py — hermetic unit test for the master_list -> build_queue feeder genre mapping. No file
writes, no claude -p, no network. Proves authoring ON queues ALL genres (incl. indie), and authoring OFF
keeps ONLY true-fit LIVE template genres (no regression). Prints 'SEED-QUEUE: PASS'."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import seed_queue as S  # noqa: E402

n = 0
fails = []


def chk(label, ok):
    global n
    n += 1
    if not ok:
        fails.append(label)


# fake master_list: true-fit (2d-platformer, shmup) + indie/unmapped (3d-platformer, falling-puzzle, maze)
# + one NON-pending game that must be excluded everywhere.
ML = {"categories": {
    "Platformers": {"games": [
        {"id": 1, "sub_genre": "2d-platformer", "status": "pending", "rating": 95, "inspired_by": "A"},
        {"id": 2, "sub_genre": "3d-platformer", "status": "pending", "rating": 90, "inspired_by": "B"},   # indie
    ]},
    "Puzzle": {"games": [
        {"id": 3, "sub_genre": "falling-puzzle", "status": "pending", "rating": 88, "inspired_by": "C"},  # indie
        {"id": 4, "sub_genre": "maze", "status": "pending", "rating": 80, "inspired_by": "D"},            # indie
    ]},
    "Shooters": {"games": [
        {"id": 5, "sub_genre": "shmup", "status": "pending", "rating": 92, "inspired_by": "E"},
        {"id": 6, "sub_genre": "shmup", "status": "shipped", "rating": 99, "inspired_by": "done"},        # not pending
    ]},
}}
PENDING_TOTAL = 5
INDIE = {"3d-platformer", "falling-puzzle", "maze"}

# ── authoring OFF: only true-fit LIVE template genres (no regression) ──────────────────────────
off = S.select_candidates(ML, author=False)
off_subs = {g.get("sub_genre") for g, _, _ in off}
chk("OFF: excludes ALL indie/unmapped", not (INDIE & off_subs))
chk("OFF: selects exactly the true-fit pending (2d-platformer + shmup)", off_subs == {"2d-platformer", "shmup"})
chk("OFF: every selected genre is LIVE", all(gen in S.LIVE for _, gen, _ in off) and len(off) == 2)
chk("OFF: excludes non-pending", all(g.get("status") == "pending" for g, _, _ in off))

# ── authoring ON: ALL pending genres incl. indie ──────────────────────────────────────────────
on = S.select_candidates(ML, author=True)
on_subs = {g.get("sub_genre") for g, _, _ in on}
chk("ON: queues ALL pending (incl. indie)", len(on) == PENDING_TOTAL)
chk("ON: includes every indie genre", INDIE <= on_subs)
chk("ON: still excludes the non-pending game", all(g.get("status") == "pending" for g, _, _ in on))
chk("ON: every queued game has a non-empty genre", all((gen or "").strip() for _, gen, _ in on))
chk("ON: highest-rated first", on[0][0].get("rating") == 95)

# ── genre_for detail ──────────────────────────────────────────────────────────────────────────
chk("genre_for ON: indie -> its own sub-genre", S.genre_for({"sub_genre": "falling-puzzle"}, True) == "falling-puzzle")
chk("genre_for ON: true-fit -> template genre", S.genre_for({"sub_genre": "2d-platformer"}, True) == "platformer")
chk("genre_for OFF: indie -> None (skip)", S.genre_for({"sub_genre": "falling-puzzle"}, False) is None)
chk("genre_for OFF: true-fit -> template genre", S.genre_for({"sub_genre": "shmup"}, False) == "shmup")

print(f"checks run: {n}")
if fails:
    print("FAILED:")
    for f in fails:
        print("  -", f)
    print("SEED-QUEUE: FAIL")
    sys.exit(1)
print(f"SEED-QUEUE: PASS ({n} checks)")
sys.exit(0)
