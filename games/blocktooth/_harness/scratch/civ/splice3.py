import os
os.chdir(r"C:\Users\TestRun\Claude Claw\forgeflow-games\games\blocktooth")
p='src/render/civilians.ts'
s=open(p,encoding='utf-8').read()
def rep(a,b):
    global s
    assert s.count(a)==1,(a[:60],s.count(a)); s=s.replace(a,b)
# avoidBuildings: round buildings honour the widened circle AND the square footprint
rep("""      const b = city.buildings[ids[k]];
      if (!b) continue;
      const dx = this.p3.x - b.x, dz = this.p3.z - b.z;
      let nx = 0, nz = 0;
      if (isRound(b)) {
        const r = b.w / 2 + ROUND_PAD + body;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        const d = Math.sqrt(d2);
        if (d > 1e-4) { nx = dx / d; nz = dz / d; } else { nx = 1; nz = 0; }
        this.p3.x = b.x + nx * r; this.p3.z = b.z + nz * r;
      } else {
        const hw = b.w / 2 + body, hd = b.d / 2 + body;
        if (Math.abs(dx) >= hw || Math.abs(dz) >= hd) continue;
        if (hw - Math.abs(dx) < hd - Math.abs(dz)) { nx = Math.sign(dx || 1); this.p3.x = b.x + nx * hw; }
        else { nz = Math.sign(dz || 1); this.p3.z = b.z + nz * hd; }
      }
      const vn""","""      const b = city.buildings[ids[k]];
      if (!b) continue;
      // (round buildings: the widened circle first, then the square footprint as well)
      for (let pass = isRound(b) ? 0 : 1; pass < 2; pass++) {
      const dx = this.p3.x - b.x, dz = this.p3.z - b.z;
      let nx = 0, nz = 0;
      if (pass === 0) {
        const r = b.w / 2 + ROUND_PAD + body;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        const d = Math.sqrt(d2);
        if (d > 1e-4) { nx = dx / d; nz = dz / d; } else { nx = 1; nz = 0; }
        this.p3.x = b.x + nx * r; this.p3.z = b.z + nz * r;
      } else {
        const hw = b.w / 2 + body, hd = b.d / 2 + body;
        if (Math.abs(dx) >= hw || Math.abs(dz) >= hd) continue;
        if (hw - Math.abs(dx) < hd - Math.abs(dz)) { nx = Math.sign(dx || 1); this.p3.x = b.x + nx * hw; }
        else { nz = Math.sign(dz || 1); this.p3.z = b.z + nz * hd; }
      }
      const vn""")
rep("""      this.wallT[i] = 0.6 + Math.random() * 0.6;
      this.wnx[i] = nx; this.wnz[i] = nz;
    }""","""      this.wallT[i] = 0.6 + Math.random() * 0.6;
      this.wnx[i] = nx; this.wnz[i] = nz;
      }
    }""")
# innerLimit: round = max(circle face, square face)
rep("""      let face: number;
      if (isRound(b)) {
        const r = b.w / 2 + ROUND_PAD;
        const da = Math.max(0, Math.min(Math.abs(alongW - bAlong), Math.abs(ahead - bAlong)) - m);
        if (da >= r) continue;
        face = bDepth + Math.sqrt(r * r - da * da);
      } else {
        const half = (alongIsX ? b.w : b.d) / 2 + m;
        if (!((Math.abs(alongW - bAlong) < half) || (Math.abs(ahead - bAlong) < half))) continue;
        face = bDepth + (alongIsX ? b.d : b.w) / 2;
      }
      if (face + gap > lim) lim = face + gap;""","""      let face = -1e9;
      if (isRound(b)) {
        const r = b.w / 2 + ROUND_PAD;
        const da = Math.max(0, Math.min(Math.abs(alongW - bAlong), Math.abs(ahead - bAlong)) - m);
        if (da < r) face = bDepth + Math.sqrt(r * r - da * da);
      }
      const half = (alongIsX ? b.w : b.d) / 2 + m;
      if ((Math.abs(alongW - bAlong) < half) || (Math.abs(ahead - bAlong) < half)) face = Math.max(face, bDepth + (alongIsX ? b.d : b.w) / 2);
      if (face + gap > lim) lim = face + gap;""")
# rayBlockedIn: round -> circle test, then fall through to the box test
rep("""        const t = Math.max(0, Math.min(L, -(ox * ux + oz * uz)));
        const cx = ox + ux * t, cz = oz + uz * t;
        if (cx * cx + cz * cz < r2) return true;
        continue;
      }""","""        const t = Math.max(0, Math.min(L, -(ox * ux + oz * uz)));
        const cx = ox + ux * t, cz = oz + uz * t;
        if (cx * cx + cz * cz < r2) return true;
        // (and the square footprint below)
      }""")
rep("""          if (qx * qx + qz * qz <= d0 + 1e-4) return true;
          continue;
        }""","""          if (qx * qx + qz * qz <= d0 + 1e-4) return true;
        }""")
rep("""      if (isRound(b)) { const r = b.w / 2 + ROUND_PAD + margin; if ((x - b.x) * (x - b.x) + (z - b.z) * (z - b.z) < r * r) return true; }
      else if (Math.abs""","""      if (isRound(b)) { const r = b.w / 2 + ROUND_PAD + margin; if ((x - b.x) * (x - b.x) + (z - b.z) * (z - b.z) < r * r) return true; }
      if (Math.abs""")
open(p,'w',encoding='utf-8').write(s)
print('ok')
