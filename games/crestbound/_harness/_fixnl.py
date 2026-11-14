import io
import os

P = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'runtime', 'world', 'materials.js')
s = io.open(P, encoding='utf-8').read()

bad_v = "    if (lod) vHead += 'varying float vCbDist;\n';\n"
good_v = "    if (lod) vHead += 'varying float vCbDist;\\n';\n"
assert bad_v in s, 'v'
s = s.replace(bad_v, good_v, 1)

bad_f = "    if (lod) fHead += 'varying float vCbDist;\nuniform vec2 uCbLod;\n';\n"
good_f = "    if (lod) fHead += 'varying float vCbDist;\\nuniform vec2 uCbLod;\\n';\n"
assert bad_f in s, 'f'
s = s.replace(bad_f, good_f, 1)

bad_p = ("      pre += lod\n"
         "        ? '  float cbLodT = clamp( ( vCbDist - uCbLod.x ) * uCbLod.y, 0.0, 1.0 );\n'\n"
         "        : '  float cbLodT = 0.0;\n';\n")
good_p = ("      pre += lod\n"
          "        ? '  float cbLodT = clamp( ( vCbDist - uCbLod.x ) * uCbLod.y, 0.0, 1.0 );\\n'\n"
          "        : '  float cbLodT = 0.0;\\n';\n")
if bad_p in s:
    s = s.replace(bad_p, good_p, 1)
    print('pre fixed')
else:
    print('pre already ok')

io.open(P, 'w', encoding='utf-8', newline='\n').write(s)
print('done')
