#!/usr/bin/env python3
# LOADTIME task 3: structural risk of dumped GLSL (boot-probe.mjs --dump=1) for an HLSL back end.
#   python3 _harness/arc-work/loadtime/glsl-risk.py DIR [N]
# Per fragment source: chars, functions, loops (and how many have a bound that is not a literal / #define'd constant),
# loops whose body (or a function called from it, one level) samples with implicit derivatives (texture(), no Lod/Grad:
# D3D must unroll such a loop or fails with "gradient instruction in loop"), discard inside loops, ifs, texture taps by kind,
# const arrays, varyings.
import re, sys, os
D = sys.argv[1]; N = int(sys.argv[2]) if len(sys.argv) > 2 else 12
def strip(s):
    s = re.sub(r'/\*.*?\*/', '', s, flags=re.S); return re.sub(r'//[^\n]*', '', s)
def body_at(s, i):
    j = s.find('{', i)
    if j < 0: return '', i
    d = 0
    for k in range(j, len(s)):
        if s[k] == '{': d += 1
        elif s[k] == '}':
            d -= 1
            if d == 0: return s[j:k + 1], k
    return s[j:], len(s)
rows = []
for f in sorted(os.listdir(D), reverse=True):
    if not f.startswith('fs-'): continue
    s = strip(open(os.path.join(D, f)).read())
    funcs = {}
    for m in re.finditer(r'\b(?:float|vec[234]|void|mat[234]|int|bool|ivec[234]|[A-Z]\w+)\s+([A-Za-z_]\w*)\s*\([^;{)]*\)\s*\{', s):
        b, _ = body_at(s, m.end() - 1); funcs[m.group(1)] = b
    imp = re.compile(r'\b(?:texture|texture2D|textureCube|textureProj|textureOffset)\s*\(')
    implicit_fn = {n for n, b in funcs.items() if imp.search(b)}
    # one more level
    implicit_fn |= {n for n, b in funcs.items() if any(re.search(r'\b' + re.escape(x) + r'\s*\(', b) for x in implicit_fn)}
    loops = []; 
    for m in re.finditer(r'\bfor\s*\(([^;]*);([^;]*);([^)]*)\)', s):
        b, _ = body_at(s, m.end()) if s[m.end():m.end() + 40].lstrip().startswith('{') else (s[m.end():s.find(';', m.end()) + 1], 0)
        cond = m.group(2)
        bound = re.split(r'<=|<|>=|>|!=', cond)[-1].strip()
        const = bool(re.fullmatch(r'[0-9.]+|[A-Z_][A-Z0-9_]*', bound))
        tex = bool(imp.search(b)); viafn = [x for x in implicit_fn if re.search(r'\b' + re.escape(x) + r'\s*\(', b)]
        owner = next((n for n, fb in funcs.items() if m.group(0) in fb), '?')
        loops.append((owner, cond.strip(), const, tex, viafn[:3], 'discard' in b, 'break' in b, len(b)))
    rows.append((len(s), f, s, funcs, loops))
rows.sort(key=lambda r: -r[0])
for n, f, s, funcs, loops in rows[:N]:
    print(f'== {f}: {n} chars (no comments), {len(funcs)} functions, main {len(funcs.get("main", ""))} chars')
    print(f'   ifs {len(re.findall(r"\bif\s*\(", s))} | taps: texture() {len(re.findall(r"\btexture\s*\(", s))} textureLod {len(re.findall(r"\btextureLod\s*\(", s))} textureGrad {len(re.findall(r"\btextureGrad\s*\(", s))} texelFetch {len(re.findall(r"\btexelFetch\s*\(", s))} | dFdx/fwidth {len(re.findall(r"\b(?:dFdx|dFdy|fwidth)\s*\(", s))} | discard {len(re.findall(r"\bdiscard\b", s))}')
    print(f'   varyings (in) {len(re.findall(r"^\s*(?:flat\s+|centroid\s+)?(?:in|varying)\s+\w+\s+\w+", s, flags=re.M))} | const arrays {len(re.findall(r"\bconst\s+\w+\s+\w+\s*\[", s))} | uniforms {len(re.findall(r"^\s*uniform\s", s, flags=re.M))} | #define NUM_*_LIGHTS: {" ".join(re.findall(r"#define (NUM_\w+ \d+)", s))[:0]}')
    print(f'   loops {len(loops)}: non-constant bound {sum(1 for l in loops if not l[2])} | implicit-derivative tap in body {sum(1 for l in loops if l[3])} | via a called function {sum(1 for l in loops if l[4] and not l[3])} | discard in loop {sum(1 for l in loops if l[5])}')
    for l in loops:
        if not l[2] or l[3] or l[4] or l[5]: print(f'     - in {l[0]}: for(..; {l[1]}; ..) body {l[7]} chars{"" if l[2] else " NONCONST"}{" TEX-IMPLICIT" if l[3] else ""}{" via " + ",".join(l[4]) if l[4] else ""}{" DISCARD" if l[5] else ""}{" break" if l[6] else ""}')
