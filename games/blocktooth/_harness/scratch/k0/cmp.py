import json, sys, math

def load(p):
    return json.load(open(p, encoding='utf-8'))['results']

def f(x):
    return 'NaN' if x is None else ('%.2f' % x)

worst = 0.0
same_hash = 0
n = 0
for mode in ('fresh', 'full'):
    a = load('_harness/scratch/k0/base_%s.json' % mode)
    b = load('_harness/scratch/k0/k0_%s.json' % mode)
    print('--meta', mode)
    for ra, rb in zip(a, b):
        n += 1
        keys = [('rank II', ra['rankT'][1], rb['rankT'][1]), ('III', ra['rankT'][2], rb['rankT'][2]),
                ('IV', ra['rankT'][3], rb['rankT'][3]), ('V', ra['rankT'][4], rb['rankT'][4]),
                ('bossT', ra['bossT'], rb['bossT']), ('endT', ra['endT'], rb['endT'])]
        d = 0.0
        for _, x, y in keys:
            if (x is None) != (y is None):
                d = math.inf
            elif x is not None:
                d = max(d, abs(x - y))
        worst = max(worst, d)
        h = ra['hash'] == rb['hash']
        same_hash += 1 if h else 0
        print('  %-10s %-12s %-6s/%-6s endT %s/%s bossT %s/%s max|dt| %.3f s  hash %s %s' % (
            ra['titan'], ra['biome'], ra['result'], rb['result'], f(ra['endT']), f(rb['endT']),
            f(ra['bossT']), f(rb['bossT']), d, rb['hash'], 'SAME' if h else 'DIFF(base %s)' % ra['hash']))
print('runs %d · identical final hashes %d/%d · worst |dt| over rank/boss/end times %.3f s (gate: <= 2 s)' % (n, same_hash, n, worst))
sys.exit(0 if worst <= 2 else 1)
