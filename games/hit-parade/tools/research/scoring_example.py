"""Worked example for the proposed HIT PARADE score + RATINGS design.

Model (all values are design proposals, see DESIGN_RESEARCH.md section 6):
  - every action has base POINTS and base RATINGS gain
  - RATINGS meter 0..699, seven 100-point grade bands D C B A S SS SSS
  - grade multiplier applies to points at award time
  - freshness: ratings gain x0.6 per earlier use of the same action within the
    last 6 actions (DMC-style diminishing returns); points are not reduced
  - first use of a STYLE event in the episode: points x3 (Bulletstorm uses x5)
  - combo counter; cash-out bonus = round(5 * hits^1.5) x grade multiplier at
    cash-out; forfeited if the player is hit first (SoR4 rule)
  - getting hit: ratings drop two grades (DMC4/5 rule), to the band floor
ASCII only. Usage: python scoring_example.py
"""
GRADES = ["D", "C", "B", "A", "S", "SS", "SSS"]
MULT = [1.0, 1.2, 1.5, 2.0, 2.5, 3.0, 4.0]

ACTIONS = {
    # name: (points, ratings, is_style_event, counts_as_hit)
    "jab": (10, 4, False, True), "cross": (15, 5, False, True),
    "hook": (20, 6, False, True), "uppercut": (40, 12, False, True),
    "air_juggle": (30, 8, False, True), "ground_slam": (250, 30, True, True),
    "stomp_otg": (200, 16, True, True), "ko_grunt": (100, 20, False, False),
    "wall_splat": (250, 30, True, True), "parry": (200, 35, True, False),
    "perfect_dodge": (150, 25, True, False), "throw": (80, 18, False, True),
    "env_kill": (2000, 60, True, True), "finisher": (1000, 50, True, True),
    "front_kick": (30, 10, False, True), "taunt": (50, 15, True, False),
}


class Show:
    def __init__(self, ratings=200):
        self.r = ratings
        self.score = 0
        self.hits = 0
        self.recent = []
        self.seen = set()
        self.log = []

    def grade(self):
        return int(min(6, self.r // 100))

    def act(self, name):
        pts, rat, style, is_hit = ACTIONS[name]
        g = self.grade()
        first = style and name not in self.seen
        if style:
            self.seen.add(name)
        p = pts * (3 if first else 1) * MULT[g]
        reps = self.recent[-6:].count(name)
        gain = rat * (0.6 ** reps)
        self.recent.append(name)
        self.r = min(699, self.r + gain)
        if is_hit:
            self.hits += 1
        self.score += p
        self.log.append("%-13s grade %-3s x%.1f  +%6.0f pts%s  ratings +%4.1f -> %5.1f (%s)" % (
            name, GRADES[g], MULT[g], p, " (first x3)" if first else "", gain, self.r,
            GRADES[self.grade()]))

    def cash_out(self):
        g = self.grade()
        bonus = round(5 * self.hits ** 1.5) * MULT[g]
        self.log.append("COMBO CASH-OUT %d hits: round(5*%d^1.5)=%d x%.1f = +%.0f" % (
            self.hits, self.hits, round(5 * self.hits ** 1.5), MULT[g], bonus))
        self.score += bonus
        self.hits = 0

    def get_hit(self):
        g = max(0, self.grade() - 2)
        self.log.append("PLAYER HIT: combo of %d forfeited, ratings %s -> %s" % (
            self.hits, GRADES[self.grade()], GRADES[g]))
        self.hits = 0
        self.r = g * 100


def main():
    s = Show(ratings=150)  # start of a fight at grade C
    seq = ["jab", "cross", "hook", "uppercut", "air_juggle", "air_juggle", "ground_slam",
           "stomp_otg", "ko_grunt", "parry", "jab", "cross", "hook", "wall_splat",
           "throw", "env_kill"]
    for a in seq:
        s.act(a)
    s.cash_out()
    print("\n".join(s.log))
    print("TOTAL after sequence A: %.0f   ratings %.1f (%s)" % (s.score, s.r, GRADES[s.grade()]))
    print()
    # Spam comparison: same fight time spent mashing jab-cross-hook on grunts
    m = Show(ratings=150)
    for _ in range(5):
        for a in ["jab", "cross", "hook"]:
            m.act(a)
        m.act("ko_grunt")
    m.cash_out()
    print("MASHER (5x J-C-H + KO, same 20 actions):")
    print("\n".join(m.log[-3:]))
    print("TOTAL masher: %.0f   ratings %.1f (%s)" % (m.score, m.r, GRADES[m.grade()]))
    print()
    h = Show(ratings=450)
    for a in ["jab", "cross", "hook", "uppercut"]:
        h.act(a)
    h.get_hit()
    print("HIT AT S:")
    print("\n".join(h.log[-1:]))


if __name__ == "__main__":
    main()
