import os
os.chdir(r"C:\Users\TestRun\Claude Claw\forgeflow-games\games\blocktooth")
p = 'src/render/civilians.ts'
s = open(p, encoding='utf-8').read()
blk = open('_harness/scratch/civ/bld_block.ts.txt', encoding='utf-8').read()
start = s.index("  /** innermost |local coordinate| a sidewalk walker may use here")
end = s.index("  private squashCircle(")
s = s[:start] + blk + s[end:]
old = "function wrapPi(a: number): number {"
assert s.count(old) == 1
s = s.replace(old, """/** tanks / cooling towers: a round mesh (plinth + flares) — civilians keep to a circle around it */
function isRound(b: { shape: string }): boolean { return b.shape === 'cylinder'; }

/** feeler turn angles (rad), tried on the preferred side first: ~31°, 57°, 83°, 109°, 137° */
const STEER_ANGLES = [0.55, 1.0, 1.45, 1.9, 2.4] as const;

""" + old)
open(p, 'w', encoding='utf-8').write(s)
print("ok")
