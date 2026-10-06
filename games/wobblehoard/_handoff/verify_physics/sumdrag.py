import json,sys
rows=[json.loads(l) for f in sys.argv[1:] for l in open(f) if l.strip().startswith('{"label"')]
done=[r for r in rows if not r.get('missed')]
f120=sum(r['f120'] for r in done); n=sum(1 for r in done if r['f120']>0)
w=max(done,key=lambda r:r['worst'])
print(f"drag: {len(rows)} specs, {len(done)} run, frames>120 {f120} in {n} presses, worst {w['worst']:.1f} ({w['label']}), restWorst max {max(r['restWorst'] for r in done):.1f}, restN90 {sum(r['restN90'] for r in done)}")
for r in sorted(done,key=lambda r:-r['worst'])[:6]: print('  ',r['label'],round(r['worst'],1),r['f120'])
