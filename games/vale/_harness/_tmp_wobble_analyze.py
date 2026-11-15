# VALE harness (tmp, orch1 wobble diag): lateral offset of marching Wicks from the road centre (map lane polyline,
# which is also the drawn road's centre: render/terrain.ts bakes the road distance field from the same segments).
#   python3 _harness/_tmp_wobble_analyze.py <dir with wobble_<seed>.ndjson> [seeds...] → JSON summary on stdout
import json, math, sys, os, collections

HERE = os.path.dirname(os.path.abspath(__file__))
MAP = json.load(open(os.path.join(HERE, '..', 'content', 'maps', 'map_rift.json')))
LANES = {l['id']: l['path'] for l in MAP['lanes']}
TOW = {s['id']: s['at'] for s in MAP['structures']}

def proj(path, x, y):
    """(signed offset, arclength s, seg) to the nearest segment; offset > 0 = +y side of the walking direction normal"""
    best = None; s0 = 0.0
    for i in range(len(path) - 1):
        ax, ay = path[i]; bx, by = path[i + 1]
        dx, dy = bx - ax, by - ay; L = math.hypot(dx, dy)
        t = max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / (L * L)))
        qx, qy = ax + dx * t, ay + dy * t
        d = math.hypot(x - qx, y - qy)
        if best is None or d < best[0] - 1e-9:
            # side: the unit normal pointing to +y (screen-down on this camera), so offset > 0 = below the road on screen
            nx, ny = -dy / L, dx / L
            if ny < 0: nx, ny = -nx, -ny
            off = (x - qx) * nx + (y - qy) * ny
            best = (d, off, s0 + t * L, i)
        s0 += L
    return best[1], best[2], best[3]

def lane_of(x, y):
    # by spawn point: high starts at y 46, seat at 55, low at 64 (and every high / low road point is outside 50..60)
    if y < 50: return 'road_high'
    if y > 60: return 'road_low'
    return 'road_seat'

def load(path):
    meta = None; blocks = []
    for line in open(path):
        r = json.loads(line)
        if 'meta' in r: meta = r['meta']
        else: blocks.append(r)
    return meta, blocks

def analyze(seed, d):
    meta, blocks = load(os.path.join(d, f'wobble_{seed}.ndjson'))
    # per minion: list of (t, x, y, dx, dy, order, chasing, flank, laneLen, pathLen, atk)
    tr = collections.defaultdict(list); info = {}
    for b in blocks:
        for f in b['fr']:
            for m in f['m']:
                mid, team, unit, sx, sy, rx, ry, order, ch, fl, wp, ll, li, pl, pi, atk, otg, gx, gy = m
                tr[mid].append((f['t'], sx, sy, rx, ry, order, ch, fl, ll, pl, atk, wp, gx, gy, pi))
                info[mid] = (team, unit)
    return meta, blocks, tr, info

def marching(p):
    # lane-following: attack-move, not chasing, not stepping out, no attack target
    return p[5] == 2 and p[6] == 0 and p[7] == 0 and p[10] == -1

def main():
    d = sys.argv[1]; seeds = [int(s) for s in sys.argv[2:]] or [3, 7, 11]
    out = {}
    for seed in seeds:
        if not os.path.exists(os.path.join(d, f'wobble_{seed}.ndjson')): continue
        meta, blocks, tr, info = analyze(seed, d)
        # profile by (lane, team, s-bin): offsets of marching Wicks
        prof = collections.defaultdict(list)
        eps = []
        for mid, P in tr.items():
            team, unit = info[mid]
            lane = lane_of(P[0][1], P[0][2])
            if lane == 'road_seat': continue
            path = LANES[lane]
            seq = []
            for p in P:
                off, s, seg = proj(path, p[1], p[2])
                offr = proj(path, p[3], p[4])[0] if p[3] is not None else None
                seq.append((p[0], s, off, offr, marching(p), p[8], p[9], p))
                if marching(p): prof[(lane, team, int(s // 2) * 2)].append(off)
            # excursions: marching run, offset relative to the minion's own median over its marching frames in the
            # 15 m before; |dev| > 0.6 m sustained ≥ 0.5 s and returning within 0.4 m of the baseline
            ms = [q for q in seq if q[4]]
            i = 0
            while i < len(ms):
                t, s, off = ms[i][0], ms[i][1], ms[i][2]
                base_pts = [q[2] for q in ms if s - 15 <= q[1] < s - 3 and q[0] < t]
                if len(base_pts) < 20: i += 1; continue
                base = sorted(base_pts)[len(base_pts) // 2]
                if abs(off - base) > 0.6:
                    j = i; peak = ms[i]
                    while j < len(ms) and abs(ms[j][2] - base) > 0.3 and ms[j][0] - ms[j - 1 if j > i else j][0] < 0.2:
                        if abs(ms[j][2] - base) > abs(peak[2] - base): peak = ms[j]
                        j += 1
                    dur = ms[min(j, len(ms) - 1)][0] - t
                    if dur >= 0.5:
                        came_back = j < len(ms) and abs(ms[j][2] - base) <= 0.3
                        pk = peak[7]
                        eps.append({'id': mid, 'team': team, 'unit': unit, 'lane': lane, 't0': t, 't1': round(t + dur, 2), 'dur': round(dur, 2),
                                    's0': round(s, 1), 's_peak': round(peak[1], 1), 's1': round(ms[min(j, len(ms) - 1)][1], 1),
                                    'x_peak': pk[1], 'y_peak': pk[2], 'base': round(base, 2), 'peak_off': round(peak[2], 2), 'dev': round(peak[2] - base, 2),
                                    'dev_drawn': round((peak[3] - base), 2) if peak[3] is not None else None,
                                    'laneLen_peak': peak[5], 'pathLen_peak': peak[6], 'came_back': came_back})
                    i = max(j, i + 1)
                else: i += 1
        out[seed] = {'meta': {'screenDy_per_worldY': meta['screenDy_per_worldY']}, 'episodes': eps,
                     'profile': {f'{k[0]}|{k[1]}|{k[2]}': [len(v), round(sum(v) / len(v), 2), round(sorted(v)[int(len(v) * 0.9)], 2), round(sorted(v)[int(len(v) * 0.1)], 2)] for k, v in sorted(prof.items()) if len(v) >= 30}}
    json.dump(out, sys.stdout, indent=1)

if __name__ == '__main__':
    main()
