"""HIT PARADE versus frame-data template: arithmetic check + markdown table.

Convention (SF6, verified on Ryu rows from the SuperCombo Cargo table):
  startup counts the first active frame (FAF startup);
  total      = startup + active + recovery - 1
  on-hit     = hitstun  - (active + recovery)     e.g. Ryu 5LP 14-(3+7)=+4
  on-block   = blockstun - (active + recovery)    e.g. Ryu 5LP  9-(3+7)=-1
(frames of hitstop are excluded: both sides are frozen.)
Punishability: a move at -N on block is punishable by any move with startup
<= N (FAF convention). HIT PARADE fastest universal normal = 5f, so <= -5 is
punishable, -2..-4 is "safe but minus".
ASCII only. Usage: python fg_template_check.py
"""

FASTEST = 5
PC_BONUS = 4   # punish-counter frame bonus (SF6)
CH_BONUS = 2   # counter-hit frame bonus (SF6)

# name, startup, active, recovery, hitstun, blockstun, dmg, hitstop, guard,
# super_gain_hit, reach_m, sf6_ref
MOVES = [
    ("stand light", 5, 3, 9, 15, 10, 300, 9, "H/L", 300, 0.85, "5/3/10 +3/-2 hs16 bs10"),
    ("crouch light (low)", 5, 3, 9, 15, 10, 250, 9, "L", 300, 0.81, "5/3/9 +4/-2 hs15 bs10"),
    ("stand medium", 8, 3, 16, 22, 16, 600, 11, "H/L", 500, 1.11, "8/3/16 +3/-3 hs23 bs17"),
    ("crouch medium (low poke)", 8, 3, 15, 22, 16, 600, 11, "L", 500, 1.09, "8/3/16 +4/-2 hs22 bs16"),
    ("stand heavy", 12, 3, 20, 25, 20, 800, 13, "H/L", 1000, 1.33, "12/3/20 +2/-3 hs26 bs20"),
    ("crouch heavy (anti-air)", 9, 4, 21, 27, 19, 800, 13, "H/L", 1000, 0.90, "9/4/21 +2/-6 hs27 bs20"),
    ("sweep (low, KD)", 10, 3, 24, None, 16, 900, 13, "L", 1000, 1.38, "10/3/24 KD+33 -11 bs18"),
    ("overhead (6+button)", 18, 3, 17, 22, 16, 600, 11, "H", 500, 1.10, "cmd normals 16/3/20 +3/-3"),
]


def adv(stun, a, r):
    return None if stun is None else stun - (a + r)


def fmt(v):
    return "KD" if v is None else ("%+d" % v)


def main():
    ok = True
    print("| Class | Startup | Active | Recovery | Total | Hitstun | Blockstun | On hit | On block | "
          "On PC hit | Damage | Hitstop | Guard | Super gain (hit/block) | Reach | SF6 roster median (for reference) |")
    print("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
    for (n, s, a, r, hs, bs, dmg, hstop, g, sg, reach, ref) in MOVES:
        tot = s + a + r - 1
        oh, ob = adv(hs, a, r), adv(bs, a, r)
        pc = None if oh is None else oh + PC_BONUS
        print("| %s | %d | %d | %d | %d | %s | %d | %s | %s | %s | %d | %d | %s | %d / %d | %.2f m | %s |" % (
            n, s, a, r, tot, "-" if hs is None else hs, bs, fmt(oh), fmt(ob),
            fmt(pc), dmg, hstop, g, sg, sg // 2, reach, ref))
        if ob is not None and ob <= -FASTEST and "sweep" not in n and "anti-air" not in n:
            print("  WARN %s is punishable on block (%+d)" % (n, ob))
            ok = False
    print()
    # link table: which normals link into which after a punish counter
    print("Links on normal hit / punish-counter hit (on-hit >= next startup):")
    for (n, s, a, r, hs, bs, *_rest) in MOVES:
        oh = adv(hs, a, r)
        if oh is None:
            continue
        nxt = [m[0] for m in MOVES if m[1] <= oh]
        nxt_pc = [m[0] for m in MOVES if m[1] <= oh + PC_BONUS]
        print("  %-26s hit %+d -> %s | PC %+d -> %s" % (
            n, oh, nxt or "none (cancel only)", oh + PC_BONUS, nxt_pc or "none"))
    print()
    # blockstun rule of thumb
    print("blockstun - hitstun per class:", ", ".join(
        "%s %d" % (m[0].split(" (")[0], m[5] - m[4]) for m in MOVES if m[4]))
    print("ALL CHECKS OK" if ok else "CHECKS FLAGGED")


if __name__ == "__main__":
    main()
