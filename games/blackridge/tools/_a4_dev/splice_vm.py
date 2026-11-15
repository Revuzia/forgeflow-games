import os
HERE = os.path.dirname(os.path.abspath(__file__))
p = os.path.join(HERE, "..", "..", "core", "weapons", "viewmodel.js")
s = open(p, encoding="utf-8").read()
blk = open(os.path.join(HERE, "reload_block.js"), encoding="utf-8").read()
a = s.index("  // --- magazine reload (rifles, DMR")
b = s.index("  // ---- update ---------------------------------------------------------------")
s = s[:a] + blk + s[b:]
# remove the junk equipNow stub
i0 = s.index("  // synchronous swap when the prototype is already resolved")
i1 = s.index("  // ---- kick ---")
s = s[:i0] + s[i1:]
# SWITCH_SWAP near the top of createViewmodel's constants (module level)
s = s.replace("  const SWITCH_SWAP = 0.42;   // fraction of switchS at which the mesh is swapped\n\n", "")
s = s.replace("export const VM_LAYER = 2;\n", "export const VM_LAYER = 2;\n\n// fraction of the sim's switchS at which the held mesh is swapped (lower first half, raise second)\nconst SWITCH_SWAP = 0.42;\n", 1)
open(p, "w", encoding="utf-8").write(s)
print("spliced vm", len(s))
