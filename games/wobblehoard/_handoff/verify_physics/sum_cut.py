import json,sys
rows=[json.loads(l) for f in sys.argv[1:] for l in open(f) if l.strip()]
bad=[]; tun=0; f120=0; cuts=0; volerr=[]; led=[]; det=[]; fin=[]
for r in rows:
    cuts+=r['cuts']; tun+=r['tunnels']; f120+=r['f120']
    volerr.append((r['pieceVolErr'],r['id'],r['g'],r['fam'],r['pieceVolAt']))
    led.append((max(abs(x-1) for x in r['ledger']) if r['ledger'] else 9, r['id'], r['g'], r['fam'], r['ledger']))
    if 'det' in r: det.append(r['det'])
    fz=r.get('final',{})
    probs=[]
    if r['fails']: probs+=r['fails'][:3]
    if r['tunnels']: probs.append(f"tunnels {r['tunnels']} ({r['tunnelAt']})")
    if r['f120']: probs.append(f"frames>120 {r['f120']} worst {r['worstFold']:.0f} at {r['worstAt']}")
    if fz:
        if not fz.get('fracExact'): probs.append(f"final frac {fz.get('frac')}")
        if fz.get('goalRms',0)>0.002: probs.append(f"goal RMS {fz['goalRms']:.4f} R0")
        if abs(fz.get('vol',1)-1)>0.03: probs.append(f"final volume {fz['vol']:.3f}")
        if fz.get('restFold',0)>fz.get('restLimit',60) or fz.get('n90',0)>0: probs.append(f"rest fold {fz['restFold']:.0f} n90 {fz['n90']}")
        if fz.get('kin',0)>=0.02: probs.append(f"not settled kin {fz['kin']:.3f}")
    else: probs.append('no final (aborted)')
    fin.append(r)
    if probs: bad.append((r['id'],r['g'],r['fam'],r['cuts'],'; '.join(probs)))
print(f"jobs {len(rows)}, cuts {cuts}, refused {sum(r['refused'] for r in rows)}, misses {sum(r['misses'] for r in rows)}, pieces at most {max(len(r.get('fracs',[])) for r in rows)}, min piece frac {min(min(r.get('fracs',[1])) for r in rows):.3f}, bumps {sum(r['bumps'] for r in rows)}, frames>120 {f120}, tunnels {tun}, carried ok {sum(1 for r in rows if r.get('carried'))}")
if det: print(f"determinism replays: {sum(det)}/{len(det)} identical")
volerr.sort(reverse=True); print('worst piece volume vs frac:', [(round(v[0],3),)+v[1:] for v in volerr[:5]])
led.sort(key=lambda x:-x[0]); print('worst volume ledger |sum-1|:', [(round(l[0],3),l[1],l[2],l[3],l[4]) for l in led[:6]])
gr=[r['final']['goalRms'] for r in rows if 'final' in r]; print('final goal RMS max', max(gr) if gr else None, 'final vol range', min(r['final']['vol'] for r in rows if 'final' in r), max(r['final']['vol'] for r in rows if 'final' in r))
print('FAILING JOBS', len(bad))
for b in bad: print('  ',*b)
