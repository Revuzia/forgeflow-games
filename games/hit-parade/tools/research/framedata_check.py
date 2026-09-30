"""Consistency checker for the HIT PARADE proposed frame data (60 fps).

Conventions (Street Fighter style, as used by ultimateframedata.com):
  startup  = frame number of the FIRST active frame (jab startup 6 -> hits on frame 6)
  total    = startup + active + recovery - 1
  hitstop  = (attacker, victim) freeze frames on contact; frozen frames do not
             advance either timeline. Victim > attacker gives the attacker a head start.
  hitstun  = victim frames of stun AFTER its hitstop ends.

For each chain link A -> B (B cancelled from A on hit):
  head_start = victim_hitstop - attacker_hitstop
  If B is cancelled k frames after A's attacker hitstop ends (k = 1 earliest),
  B's first active frame arrives (k - 1) + startup_B frames later.
  The victim is still in hitstun if (k - 1) + startup_B <= hitstun_A + head_start.
  -> latest legal cancel k_max = hitstun_A + head_start - startup_B + 1
  chain_window (frames the player may press, with buffer covering the early side)
     = min(k_max, frames remaining in A after contact) .
Also prints chain durations when every link is cancelled at k = 1 and at mid-window.
ASCII only. Usage: python framedata_check.py
"""

MOVES = {
    # name: startup, active, recovery, hitstun, (hitstop_att, hitstop_vic)
    "jab":        dict(s=6,  a=3, r=10, hs=18, stop=(4, 6)),
    "cross":      dict(s=7,  a=3, r=12, hs=22, stop=(5, 7)),
    "hook":       dict(s=9,  a=3, r=14, hs=24, stop=(6, 8)),
    "uppercut":   dict(s=12, a=4, r=20, hs=None, stop=(9, 11)),   # launcher ender
    "body_blow":  dict(s=11, a=3, r=18, hs=50, stop=(8, 10)),     # crumple
    "front_kick": dict(s=13, a=4, r=18, hs=None, stop=(10, 12)),  # push / wall splat
    "low_kick":   dict(s=10, a=3, r=16, hs=22, stop=(6, 8)),
    "roundhouse": dict(s=14, a=4, r=20, hs=None, stop=(10, 12)),  # spin knockdown
    "heavy":      dict(s=20, a=4, r=24, hs=None, stop=(12, 14)),  # uncharged haymaker
    "launcher":   dict(s=14, a=4, r=22, hs=None, stop=(9, 11)),
    "grab":       dict(s=8,  a=3, r=26, hs=None, stop=(0, 0)),
    "pummel":     dict(s=6,  a=2, r=12, hs=None, stop=(5, 7)),
    "throw":      dict(s=10, a=6, r=20, hs=None, stop=(8, 10)),
    "stomp":      dict(s=12, a=4, r=18, hs=None, stop=(8, 10)),
    "dash_attack": dict(s=10, a=8, r=24, hs=None, stop=(8, 10)),
    "weapon_light": dict(s=9, a=4, r=16, hs=26, stop=(6, 8)),
    "weapon_heavy": dict(s=18, a=5, r=26, hs=None, stop=(12, 14)),
    "air_juggle":  dict(s=7, a=3, r=12, hs=None, stop=(5, 7)),
}

CHAINS = {
    "rush 4 (J-C-H-U)": ["jab", "cross", "hook", "uppercut"],
    "J-body blow": ["jab", "body_blow"],
    "J-C-launcher": ["jab", "cross", "launcher"],
    "J-C-H-roundhouse": ["jab", "cross", "hook", "roundhouse"],
    "low-J-C": ["low_kick", "jab", "cross"],
    "wpn L-L-H": ["weapon_light", "weapon_light", "weapon_heavy"],
}


def total(m):
    return m["s"] + m["a"] + m["r"] - 1


def link(a, b):
    A, B = MOVES[a], MOVES[b]
    head = A["stop"][1] - A["stop"][0]
    kmax = A["hs"] + head - B["s"] + 1
    remaining = (A["a"] - 1) + A["r"]
    return kmax, remaining, head


def main():
    print("move | startup | active | recovery | total f | total ms | hitstop att/vic f (ms)")
    for n, m in MOVES.items():
        print("%-13s| %3d | %2d | %3d | %3d | %4.0f | %d/%d (%.0f/%.0f)" % (
            n, m["s"], m["a"], m["r"], total(m), total(m) * 1000 / 60,
            m["stop"][0], m["stop"][1], m["stop"][0] * 1000 / 60, m["stop"][1] * 1000 / 60))
    print()
    ok = True
    for cname, seq in CHAINS.items():
        t_fast = 0
        t_mid = 0
        print("CHAIN", cname)
        for i in range(len(seq) - 1):
            a, b = seq[i], seq[i + 1]
            kmax, rem, head = link(a, b)
            window = min(kmax, rem)
            flag = "OK" if kmax >= 6 else "TOO TIGHT"
            if kmax < 6:
                ok = False
            print("  %s -> %s: latest cancel k=%d (%.0f ms), frames left in %s=%d, window=%d f (%.0f ms) %s"
                  % (a, b, kmax, kmax * 1000 / 60, a, rem, window, window * 1000 / 60, flag))
        # duration: first move startup + per link (att hitstop + k-1 + startup_next) + last move tail
        first = MOVES[seq[0]]
        t_fast = first["s"]
        t_mid = first["s"]
        for i in range(len(seq) - 1):
            A, B = MOVES[seq[i]], MOVES[seq[i + 1]]
            kmax, rem, head = link(seq[i], seq[i + 1])
            kmid = max(1, min(kmax, rem) // 2)
            t_fast += A["stop"][0] + 0 + B["s"]
            t_mid += A["stop"][0] + (kmid - 1) + B["s"]
        last = MOVES[seq[-1]]
        tail = last["stop"][0] + (last["a"] - 1) + last["r"]
        t_fast += tail
        t_mid += tail
        n = len(seq)
        print("  duration fastest %d f = %.2f s (%.1f hits/s); mid-window %d f = %.2f s (%.1f hits/s)"
              % (t_fast, t_fast / 60, n / (t_fast / 60), t_mid, t_mid / 60, n / (t_mid / 60)))
    print()
    print("ALL LINKS >= 6 f latest-cancel margin:", ok)


if __name__ == "__main__":
    main()
