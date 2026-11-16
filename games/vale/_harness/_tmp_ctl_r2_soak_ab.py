# orch1 controls round 2: the ruling-39 soak "regression" A/B. Reads the bot-soak reports of two clean worktrees at
# 8ad227d24 (the same bots code): ON = this lane's movement, attack and Wick code (ruling 39 + round 2), OFF = those files
# at 526f88325^ (before ruling 39). Prints, per seed set, the enforced gates either arm fails and the values of the gates
# the verifier flagged, and writes the table as json.
#   python3 _harness/_tmp_ctl_r2_soak_ab.py <on_reports_dir> <off_reports_dir> <out.json> <label_on> <label_off> <seed0...>
import json
import re
import sys

on_dir, off_dir, out, lon, loff = sys.argv[1:6]
seeds = sys.argv[6:]
WATCH = [
    ('shadehold adept', r'RIFT adept: shadehold takedowns'),
    ('shadehold veteran', r'RIFT veteran: shadehold takedowns'),
    ('first ult adept', r'RIFT adept: fighters with a median first ult'),
    ('vet beats novice', r'veteran beats novice'),
    ('vet beats adept', r'veteran beats adept'),
    ('BRIDGE median', r'BRIDGE median length'),
    ('BRIDGE sudden', r'BRIDGE games ending in sudden death'),
    ('RIFT adept p90', r'RIFT adept match length p90'),
    ('laners in lane', r'laners in lane'),
]
res = {}
for s in seeds:
    row = {}
    for arm, d, lab in (('on', on_dir, lon), ('off', off_dir, loff)):
        g = None
        for cand in (f'{d}/fw_W4_soak_{lab}_s{s}.json', f'{d}/fw_W4_soak_{lab}2_s{s}.json'):
            try:
                g = json.load(open(cand))['gates']
                break
            except FileNotFoundError:
                pass
        if g is None:
            row[arm] = None
            continue
        vals = {}
        for name, pat in WATCH:
            for x in g:
                if re.search(pat, x['label']):
                    vals[name] = {'value': x['value'], 'pass': x['pass']}
        row[arm] = {'failed': [f"[{x['group']}] {x['label']}: {x['value']}" for x in g if x['pass'] is False], 'watch': vals}
    res[s] = row
json.dump(res, open(out, 'w'), indent=1)
for s, row in res.items():
    print(f'== seeds {s}-{int(s) + 19}')
    for arm in ('on', 'off'):
        r = row[arm]
        if not r:
            print(f'  {arm}: missing')
            continue
        print(f'  {arm}: {len(r["failed"])} enforced gates fail')
        for f in r['failed']:
            print(f'      FAIL {f[:150]}')
    for name, _ in WATCH:
        a = (row['on'] or {}).get('watch', {}).get(name)
        b = (row['off'] or {}).get('watch', {}).get(name)
        fmt = lambda v: '-' if not v else f"{v['value']}{'' if v['pass'] else ' FAIL'}"
        print(f'    {name:18s} on {fmt(a)[:60]:62s} off {fmt(b)[:60]}')
