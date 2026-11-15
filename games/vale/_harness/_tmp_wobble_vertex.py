# VALE harness (tmp, orch1 wobble diag): per-Wick lateral dip at each lane vertex of the high / low roads.
# For every marching Wick (attack-move, not chasing, not stepping out, no attack target) that walks through a vertex,
# dip = its signed offset from the road centre at the vertex (|s - s_v| < 0.75 m, peak of the window s_v - 3 .. s_v + 3)
# minus the mean of its offsets at the two neighbouring segment midpoints (straight road). Offset > 0 = screen-down
# (+y; the bench camera's screen-down is +y). Also: drawn (render-interpolated) minus sim offset, body-lane / nav-path
# use within 6 m of the inner towers, and the share of waves that dip > 0.75 m at the inner-tower vertices.
#   python3 _harness/_tmp_wobble_vertex.py <dir> [seeds...]
import json, math, sys, os, collections, statistics as st
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _tmp_wobble_analyze import LANES, TOW, proj, lane_of, analyze, marching

def verts(path):
    s = 0.0; out = []; L = []
    for i in range(len(path) - 1):
        L.append(math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]))
    acc = [0.0]
    for l in L: acc.append(acc[-1] + l)
    for i in range(1, len(path) - 1):
        a = math.atan2(path[i][1] - path[i - 1][1], path[i][0] - path[i - 1][0]); b = math.atan2(path[i + 1][1] - path[i][1], path[i + 1][0] - path[i][0])
        out.append({'k': i, 's': acc[i], 'turn': math.degrees(b - a), 'mid_prev': acc[i] - L[i - 1] / 2, 'mid_next': acc[i] + L[i] / 2, 'xy': path[i]})
    return out

def main():
    d = sys.argv[1]; seeds = [int(s) for s in sys.argv[2:]] or [3, 7, 11]
    res = collections.defaultdict(list)      # (lane, team, k) -> [(seed, wave, id, dip, peak, drawdiff)]
    drawn = []; nearTower = collections.Counter()
    for seed in seeds:
        p = os.path.join(d, f'wobble_{seed}.ndjson')
        if not os.path.exists(p): continue
        meta, blocks, tr, info = analyze(seed, d)
        for mid, P in tr.items():
            team, unit = info[mid]
            lane = lane_of(P[0][1], P[0][2])
            if lane == 'road_seat': continue
            path = LANES[lane]
            wave = round((P[0][0] - 30) / 30) if P[0][0] > 95 else None   # spawn time → wave (first 30 s, every 30 s)
            seq = []
            for q in P:
                off, s, seg = proj(path, q[1], q[2])
                offr = proj(path, q[3], q[4])[0] if q[3] is not None else None
                seq.append((q[0], s, off, offr, marching(q), q))
                if marching(q) and offr is not None: drawn.append(offr - off)
            # body lane / nav path near the inner towers
            for tid in ('a_%s_needle_inner', 's_%s_needle_inner', 'a_%s_needle_outer', 's_%s_needle_outer'):
                tx, ty = TOW[tid % lane.split('_')[1]]
                for (t, s, off, offr, mk, q) in seq:
                    if mk and math.hypot(q[1] - tx, q[2] - ty) < 6:
                        nearTower[(lane, team, tid[:1] + tid[4:], 'frames')] += 1
                        if q[8] > 0: nearTower[(lane, team, tid[:1] + tid[4:], 'bodylane')] += 1
                        if q[9] > 0: nearTower[(lane, team, tid[:1] + tid[4:], 'navpath')] += 1
            for v in verts(path):
                win = [x for x in seq if x[4] and abs(x[1] - v['s']) < 3]
                pm = [x for x in seq if x[4] and abs(x[1] - v['mid_prev']) < 0.75]
                nm = [x for x in seq if x[4] and abs(x[1] - v['mid_next']) < 0.75]
                if len(win) < 10 or not pm or not nm: continue
                base = (st.mean(x[2] for x in pm) + st.mean(x[2] for x in nm)) / 2
                pk = max(win, key=lambda x: abs(x[2] - base))
                at = [x for x in win if abs(x[1] - v['s']) < 0.75]
                dip_v = (st.mean(x[2] for x in at) - base) if at else None
                # duration off the line by > 0.3 m from base (s), and length along the road
                off_frames = [x for x in seq if x[4] and abs(x[1] - v['s']) < 6 and abs(x[2] - base) > 0.3]
                dur = len(off_frames) / 30
                res[(lane, team, v['k'])].append({'seed': seed, 'wave': wave, 'id': mid, 'unit': unit, 'dip_peak': round(pk[2] - base, 2), 'dip_at_v': round(dip_v, 2) if dip_v is not None else None,
                                                   'drawn_peak': round(pk[3] - base, 2) if pk[3] is not None else None, 't_peak': pk[0], 's_peak': round(pk[1], 1), 'x': pk[5][1], 'y': pk[5][2], 'dur_off': round(dur, 2)})
    out = {'vertices': {}, 'drawn_minus_sim': {}, 'near_tower': {}}
    if drawn:
        a = sorted(abs(x) for x in drawn)
        out['drawn_minus_sim'] = {'n': len(a), 'median_abs': round(a[len(a) // 2], 3), 'p99_abs': round(a[int(len(a) * 0.99)], 3), 'max_abs': round(a[-1], 3)}
    for lane in ('road_high', 'road_low'):
        vs = verts(LANES[lane])
        for team in (0, 1):
            for v in vs:
                R = res.get((lane, team, v['k']))
                if not R: continue
                dips = [r['dip_peak'] for r in R]
                waves = collections.defaultdict(list)
                for r in R: waves[(r['seed'], r['wave'])].append(abs(r['dip_peak']))
                big = sum(1 for w in waves.values() if max(w) > 0.75)
                out['vertices'][f'{lane}|t{team}|v{v["k"]}'] = {
                    's': round(v['s'], 1), 'xy': v['xy'], 'turn_deg': round(v['turn'], 1), 'n_wicks': len(R), 'n_waves': len(waves),
                    'dip_mean': round(st.mean(dips), 2), 'dip_median': round(st.median(dips), 2), 'dip_p90_abs': round(sorted(abs(x) for x in dips)[int(len(dips) * 0.9)], 2),
                    'dip_max_abs': round(max(abs(x) for x in dips), 2), 'share_screen_down': round(sum(1 for x in dips if x > 0) / len(dips), 2),
                    'waves_with_dip_gt_0_75': big, 'dur_off_mean_s': round(st.mean(r['dur_off'] for r in R), 2),
                    'drawn_peak_mean': round(st.mean(r['drawn_peak'] for r in R if r['drawn_peak'] is not None), 2),
                    'worst': sorted(R, key=lambda r: -abs(r['dip_peak']))[:3]}
    for k, n in nearTower.items(): out['near_tower']['|'.join(map(str, k))] = n
    json.dump(out, sys.stdout, indent=1)

if __name__ == '__main__':
    main()
