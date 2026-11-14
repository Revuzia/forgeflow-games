# Per-part triangle audit for a kit piece (no unwrap, no bake, no export — seconds, not minutes).
#   blender.exe --background --factory-startup --python tri_audit.py -- --piece bookcase
import sys, os, collections
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bpy, kitlib as K, pieces as P

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
name = argv[argv.index('--piece') + 1] if '--piece' in argv else argv[0]
K.reset_scene()
pc = P.build(name)
by = collections.Counter()
n = collections.Counter()
for ob in pc.parts + pc.separate:
    K.apply_mods(ob)
    t = K.tri_count(ob)
    base = ''.join(c for c in ob.name.split('.')[0] if not c.isdigit())
    by[base] += t
    n[base] += 1
tot = sum(by.values())
print(f'=== {name}: {len(pc.parts)+len(pc.separate)} parts, {tot} tris, budget {pc.budget} '
      f'({"OK" if tot <= pc.budget else "OVER by " + str(tot - pc.budget)})')
for k, v in by.most_common():
    print(f'  {k:18s} x{n[k]:<4d} {v:6d} tris  ({v/max(1,n[k]):.0f} ea)')
