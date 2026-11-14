"""DYEFIELD — CINDER REEF walking reachability, crossings and tide-spring arcs (used by cinder_verify.py).

Model (runtime/src/core/config.ts MOVE, read-only): capsule radius 0.32 m, height 1.15 m, step 0.35 m,
walkable slope <= 46 deg, gravity 15 m/s^2. NO wall-slick and NO jumping: every route found here is
a walking route (plus one-way tide-spring edges).

Grid: 0.25 m columns. Every collider triangle (paint_/solid_/col_/spring_) is rasterised into the
columns its xz footprint covers (height, facing, walkable, node). A column level is STANDABLE when it
is a walkable triangle top, nothing lies within 1.15 m above it, no body-height obstacle lies within
one cell (capsule clearance), and the feet are not inside an oob_ volume. Neighbouring levels (8-way)
connect when the height change is within 0.35 m of what the two surfaces' slopes predict.
"""
from __future__ import annotations

import math
from collections import deque

import numpy as np

CELL = 0.25
STEP = 0.35
HEIGHT = 1.15
RADIUS = 0.32
G = 15.0
COS_WALK = math.cos(math.radians(46.0))
X0, X1, Z0, Z1 = -37.0, 37.0, -49.0, 49.0
COLLIDERS = ("paint_", "solid_", "col_", "grate_", "conveyor_", "spring_")


class Grid:
    def __init__(self, nodes, oob_boxes):
        self.nx = int(round((X1 - X0) / CELL))
        self.nz = int(round((Z1 - Z0) / CELL))
        self.oob = oob_boxes
        self.names = sorted(n for n in nodes if n.startswith(COLLIDERS) and n != "solid_seabed")
        cols = {}                                   # cell -> list of (y, ny, walkable, name_idx)
        for ni, name in enumerate(self.names):
            for (P, T, _, _) in nodes[name]:
                self._raster(P, T, ni, cols)
        self.cols = cols
        self._levels()

    def cell_xz(self, c):
        i, k = divmod(c, self.nz)
        return X0 + (i + 0.5) * CELL, Z0 + (k + 0.5) * CELL

    def cell_of(self, x, z):
        i = int(math.floor((x - X0) / CELL))
        k = int(math.floor((z - Z0) / CELL))
        if not (0 <= i < self.nx and 0 <= k < self.nz):
            return None
        return i * self.nz + k

    def _raster(self, P, T, ni, cols):
        A, B, Cc = P[T[:, 0]], P[T[:, 1]], P[T[:, 2]]
        n = np.cross(B - A, Cc - A)
        ln = np.linalg.norm(n, axis=1)
        ok = ln > 1e-12
        n[ok] /= ln[ok, None]
        ny = n[:, 1]
        keep = ok & (np.abs(ny) > 0.02)
        for t in np.nonzero(keep)[0]:
            xs = (A[t, 0], B[t, 0], Cc[t, 0])
            zs = (A[t, 2], B[t, 2], Cc[t, 2])
            i0 = max(0, int(math.floor((min(xs) - X0) / CELL - 0.5)))
            i1 = min(self.nx - 1, int(math.ceil((max(xs) - X0) / CELL - 0.5)))
            k0 = max(0, int(math.floor((min(zs) - Z0) / CELL - 0.5)))
            k1 = min(self.nz - 1, int(math.ceil((max(zs) - Z0) / CELL - 0.5)))
            if i1 < i0 or k1 < k0:
                continue
            gi, gk = np.meshgrid(np.arange(i0, i1 + 1), np.arange(k0, k1 + 1), indexing="ij")
            px = X0 + (gi + 0.5) * CELL
            pz = Z0 + (gk + 0.5) * CELL
            ax, az, bx, bz, cx, cz = xs[0], zs[0], xs[1], zs[1], xs[2], zs[2]
            det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz)
            if abs(det) < 1e-12:
                continue
            l1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / det
            l2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / det
            l3 = 1 - l1 - l2
            inside = (l1 >= -1e-9) & (l2 >= -1e-9) & (l3 >= -1e-9)
            if not inside.any():
                continue
            y = l1 * A[t, 1] + l2 * B[t, 1] + l3 * Cc[t, 1]
            walk = ny[t] >= COS_WALK
            for ii, kk, yy in zip(gi[inside], gk[inside], y[inside]):
                cols.setdefault(int(ii) * self.nz + int(kk), []).append((float(yy), float(ny[t]), bool(walk), ni,
                                                                          float(n[t, 0]), float(n[t, 2])))

    def in_oob(self, x, y, z):
        for (mn, mx) in self.oob:
            if mn[0] <= x <= mx[0] and mn[2] <= z <= mx[2] and mn[1] <= y <= mx[1]:
                return True
        return False

    def _levels(self):
        """Standable levels per column: (y, gx, gz, name_idx) with gx/gz the surface slope dy/dx, dy/dz."""
        self.levels = {}
        for c, surf in self.cols.items():
            surf.sort()
            ys = [s[0] for s in surf]
            out = []
            for j, (y, ny, walk, ni, nx_, nz_) in enumerate(surf):
                if not walk:
                    continue
                if out and y - out[-1][0] < 0.08:
                    out.pop()                        # merge near-coincident tops (keep the higher)
                blocked = any(y + 0.05 < yy < y + HEIGHT for yy in ys[j + 1:])
                if blocked:
                    continue
                x, z = self.cell_xz(c)
                if self.in_oob(x, y, z):
                    continue
                out.append((y, -nx_ / ny, -nz_ / ny, ni))
            if out:
                self.levels[c] = out
        # capsule clearance: nothing at body height (step .. head) within one cell
        clear = {}
        for c, lv in self.levels.items():
            i, k = divmod(c, self.nz)
            keep = []
            for L in lv:
                y = L[0]
                bad = False
                for di in (-1, 0, 1):
                    for dk in (-1, 0, 1):
                        if di == 0 and dk == 0:
                            continue
                        cc = (i + di) * self.nz + (k + dk)
                        for s in self.cols.get(cc, ()):
                            if y + STEP + 0.01 < s[0] < y + HEIGHT:
                                bad = True
                                break
                        if bad:
                            break
                    if bad:
                        break
                if not bad:
                    keep.append(L)
            if keep:
                clear[c] = keep
        self.levels = clear
        # node ids
        self.node_of = {}
        self.nodes = []
        for c in sorted(self.levels):
            for li, L in enumerate(self.levels[c]):
                self.node_of[(c, li)] = len(self.nodes)
                self.nodes.append((c, L[0], L[3]))

    def build_edges(self):
        adj = [[] for _ in self.nodes]
        for (c, li), u in self.node_of.items():
            i, k = divmod(c, self.nz)
            y, gx, gz, _ = self.levels[c][li]
            for di in (-1, 0, 1):
                for dk in (-1, 0, 1):
                    if di == 0 and dk == 0:
                        continue
                    ii, kk = i + di, k + dk
                    if not (0 <= ii < self.nx and 0 <= kk < self.nz):
                        continue
                    cc = ii * self.nz + kk
                    for lj, L2 in enumerate(self.levels.get(cc, ())):
                        y2, gx2, gz2, _ = L2
                        dx, dz = di * CELL, dk * CELL
                        pred = 0.5 * ((gx + gx2) * dx + (gz + gz2) * dz)
                        dy = y2 - y
                        if abs(dy - pred) <= STEP and abs(dy) <= STEP + math.hypot(dx, dz) * 1.04:
                            adj[u].append(self.node_of[(cc, lj)])
        self.adj = adj
        return adj

    def node_at(self, x, y, z, tol=0.6):
        c = self.cell_of(x, z)
        best = None
        for li, L in enumerate(self.levels.get(c, ())):
            if abs(L[0] - y) <= tol and (best is None or abs(L[0] - y) < abs(self.levels[c][best][0] - y)):
                best = li
        return None if best is None else self.node_of[(c, best)]

    # ── ballistic arcs ───────────────────────────────────────────────────────────────────────────
    def surfaces(self, x, z):
        c = self.cell_of(x, z)
        return self.cols.get(c, []) if c is not None else []

    # capsule sample rings: (horizontal offset d, lift) - the capsule's lower/upper surface at offset d
    # from its axis is `lift` = r - sqrt(r^2 - d^2) above the feet / below the head (Rapier capsule)
    RINGS = [(0.0, 0.0)] + [(RADIUS * f, RADIUS - math.sqrt(RADIUS * RADIUS - (RADIUS * f) ** 2)) for f in (0.7, 1.0)]

    def body_contacts(self, x, y, z):
        """Surfaces touching the capsule whose feet are at y: [(surface, lift)], tested on the axis and
        on 8 points of two rings (0.7 r and r) at the capsule's true lower/upper surface there; a
        sample point whose nearest surface above faces up is inside a closed solid."""
        out = []
        for (d, lift) in self.RINGS:
            angs = (0.0,) if d == 0.0 else np.linspace(0, 2 * math.pi, 8, endpoint=False)
            for a in angs:
                px, pz = x + d * math.cos(a), z + d * math.sin(a)
                above = [s for s in self.surfaces(px, pz) if s[0] > y + lift + 0.005]
                if not above:
                    continue
                s = min(above, key=lambda q: q[0])
                if s[0] < y + HEIGHT - lift - 0.02 or s[1] > 0:
                    out.append((s, lift))
        return out

    def fly(self, start, vel, drag_no_input=False, dt=1 / 240):
        """Integrate a spring flight (ballistic, gravity G). Returns dict(landed, land [x,y,z], t, hit, apex).
        Landing = the axis crosses down through a walkable top, or (descending) the lower hemisphere
        touches a walkable top below the sphere centre. Anything else the capsule touches is a hit."""
        x, y, z = start
        vx, vy, vz = vel
        t = 0.0
        apex = y
        while t < 6.0:
            v0 = vy
            vy -= G * dt
            ny_ = y + 0.5 * (v0 + vy) * dt
            if drag_no_input:
                k = math.exp(-0.6 * dt)
                vx *= k
                vz *= k
            nx_, nz_ = x + vx * dt, z + vz * dt
            t += dt
            apex = max(apex, ny_)
            if vy < 0:
                for s in self.surfaces(nx_, nz_):
                    if s[2] and ny_ <= s[0] <= y + 1e-9:
                        return {"landed": True, "land": [nx_, s[0], nz_], "t": t, "hit": None, "apex": apex}
            if t > 0.12:
                hits = self.body_contacts(nx_, ny_, nz_)
                if hits:
                    if vy < 0 and all(s[2] and s[0] <= ny_ + RADIUS for (s, lift) in hits):
                        gy = [s[0] for s in self.surfaces(nx_, nz_) if s[2] and s[0] <= ny_ + RADIUS]
                        top = max(gy) if gy else max(s[0] for (s, lift) in hits)
                        return {"landed": True, "land": [nx_, top, nz_], "t": t, "hit": None, "apex": apex}
                    s = hits[0][0]
                    return {"landed": False, "land": [nx_, ny_, nz_], "t": t, "hit": self.names[s[3]], "apex": apex}
            if ny_ < -3.0:
                return {"landed": False, "land": [nx_, ny_, nz_], "t": t, "hit": "fell", "apex": apex}
            x, y, z = nx_, ny_, nz_
        return {"landed": False, "land": [x, y, z], "t": t, "hit": "timeout", "apex": apex}

    def margin(self, u, R=3.0):
        """Radius of the standable, walk-connected disc around node u (m)."""
        c0, y0, _ = self.nodes[u]
        x0, z0 = self.cell_xz(c0)
        seen = {u}
        dq = deque([u])
        while dq:
            v = dq.popleft()
            for w in self.adj[v]:
                if w in seen:
                    continue
                cx, cz = self.cell_xz(self.nodes[w][0])
                if math.hypot(cx - x0, cz - z0) <= R + 1e-9:
                    seen.add(w)
                    dq.append(w)
        cells = {self.nodes[w][0] for w in seen}
        r = int(math.ceil(R / CELL))
        i0, k0 = divmod(c0, self.nz)
        best = R
        for di in range(-r, r + 1):
            for dk in range(-r, r + 1):
                d = math.hypot(di * CELL, dk * CELL)
                if d > R:
                    continue
                cc = (i0 + di) * self.nz + (k0 + dk)
                if cc not in cells:
                    best = min(best, d)
        return max(0.0, best - CELL / 2)


# ── areas ────────────────────────────────────────────────────────────────────────────────────────
PERCH_NODES = {"paint_crate": "crate tops", "solid_driftwood": "driftwood logs", "solid_lanterns": "lantern posts",
               "solid_palm_trunks": "palm trunks", "solid_bridge_posts": "bridge posts", "col_bridge_rails": "bridge rails",
               "solid_masts": "masts", "solid_coral": "coral heads", "solid_cliff": "back-cliff columns",
               "paint_wreck": "bulwark rail / stems"}


def area_of(x, y, z, name):
    """Named area of a standable cell (glTF). Side isles: WEST = x<0. Beaches: SUNCREW = z<0.
    'perch: ...' = the top of a prop, a rock outcrop or the wheelhouse (jump / wall-slick high ground,
    not a movement area); 'back strip' = the sand behind the back-cliff columns (reached round their ends)."""
    if name.startswith("paint_wreck") and not name.startswith("paint_wreck_deck") and y < 2.5:
        return "wreck tunnel (hull breach)"
    if name in PERCH_NODES:
        return "perch: " + PERCH_NODES[name]
    if name.startswith("paint_basalt"):
        if abs(x) <= 12.0 and abs(z) < 14.0 and y >= 1.4:
            return "perch: MID rock outcrops"
        if abs(z) >= 29.0 and y >= 1.3 and not (abs(x) <= 10.6 and abs(z) >= 35.0):
            return "perch: beach rock outcrops"
        if abs(x) > 12.0 and abs(z) < 29.0 and y >= 3.6:
            return "perch: isle rock pillars"
        if abs(x) > 12.0 and abs(z) < 29.0 and abs(z) >= 11.8 and 1.35 <= y < 2.2 and abs(x) < 21.0:
            return "perch: isle rock outcrops"
    if name.startswith("paint_wreck_deck") and y >= 5.4:
        return "perch: wheelhouse roof"
    if name.startswith("paint_sand") and abs(z) >= 45.4 and abs(x) <= 15.0:
        return "back strip behind the cliff"
    if name.startswith("paint_plank"):
        if abs(x) > 22:
            return "bridge beach-A~WEST" if z < 0 else "bridge beach-B~EAST"
        return "bridge WEST~MID" if x < 0 else "bridge EAST~MID"
    if name.startswith("spring_"):
        return "spring pad " + name
    if abs(z) >= 29.0 or (abs(x) <= 12.0 and abs(z) >= 14.0):
        side = "A" if z < 0 else "B"
        if y >= 1.05 and abs(x) <= 10.6 and abs(z) >= 35.0:
            return f"spawn shelf {side}"
        return f"beach {side}"
    if abs(z) >= 20.9 and abs(x) > 12.0:
        if z < 0:
            return "sandbar A~WEST (bar_w)" if x < 0 else "shoal A~EAST (shoal_e)"
        return "sandbar B~EAST (bar_w_m)" if x > 0 else "shoal B~WEST (shoal_e_m)"
    if abs(x) > 12.0:
        isle = "WEST" if x < 0 else "EAST"
        if y >= 2.75:
            return f"{isle} crown"
        if y >= 1.35:
            return f"{isle} shelf"
        return f"{isle} sand"
    if y >= 5.4:
        return "wheelhouse roof"
    if y >= 3.3:
        return "wreck deck"
    return "MID apron S" if z < 0 else "MID apron N"


def run(g, nodes, verbose=True):
    import json
    oob = []
    for nm, prims in nodes.items():
        if nm.startswith("oob_"):
            P = np.concatenate([p[0] for p in prims])
            oob.append((P.min(axis=0).tolist(), P.max(axis=0).tolist()))
    grid = Grid(nodes, oob)
    adj = grid.build_edges()
    N = len(grid.nodes)
    area = []
    for (c, y, ni) in grid.nodes:
        x, z = grid.cell_xz(c)
        area.append(area_of(x, y, z, grid.names[ni]))
    if verbose:
        print(f"routes: {len(grid.levels)} standable columns, {N} nodes, {sum(len(a) for a in adj)} walk edges")
    walk_adj = [list(a) for a in adj]            # before the spring edges are added
    # springs
    springs = []
    for n in g.j["nodes"]:
        nm = n.get("name", "")
        if not nm.startswith("spring_"):
            continue
        ex = n.get("extras", {})
        P = np.concatenate([p[0] for p in nodes[nm]])
        top = float(P[:, 1].max())
        cx, cz = float((P[:, 0].min() + P[:, 0].max()) / 2), float((P[:, 2].min() + P[:, 2].max()) / 2)
        r_pad = float((P[:, 0].max() - P[:, 0].min()) / 2)
        vel = ex["df_launch"]
        # the runtime launches when the capsule steps onto the pad: test the centre and 8 points at
        # r = 1.0 m on the 1.05 m pad (the realistic worst case)
        starts = [(cx, top - 0.03, cz)] + [(cx + 1.0 * math.cos(a), top - 0.03, cz + 1.0 * math.sin(a))
                                          for a in np.linspace(0, 2 * math.pi, 8, endpoint=False)]
        # the pad's own top (flat disc, y = top - 0.03 .. top) is where the feet stand
        res = []
        for s in starts:
            f = grid.fly(s, vel)
            land_node = grid.node_at(*f["land"], tol=0.3) if f["landed"] else None
            m = grid.margin(land_node) if land_node is not None else 0.0
            ar = area[land_node] if land_node is not None else None
            res.append({"start": [round(v, 2) for v in s], "landed": f["landed"], "land": [round(v, 2) for v in f["land"]],
                        "t": round(f["t"], 3), "apex": round(f["apex"], 2), "hit": f["hit"], "area": ar,
                        "margin_m": round(m, 2), "node": land_node})
        drag = grid.fly(starts[0], vel, drag_no_input=True)
        dn = grid.node_at(*drag["land"], tol=0.3) if drag["landed"] else None
        ok = all(r["landed"] and r["margin_m"] >= 1.0 for r in res) and len({r["area"] for r in res}) == 1
        springs.append({"node": nm, "df_launch": vel, "pad_centre": [round(cx, 2), round(top, 2), round(cz, 2)],
                        "pad_radius": round(r_pad, 2), "starts": res, "ok": ok,
                        "min_margin_m": min(r["margin_m"] for r in res), "target_area": res[0]["area"],
                        "if_runtime_air_drag_no_input": {"landed": drag["landed"], "land": [round(v, 2) for v in drag["land"]],
                                                         "hit": drag["hit"], "area": area[dn] if dn is not None else None}})
        pad_nodes = [u for u, (c, y, ni) in enumerate(grid.nodes) if grid.names[ni] == nm]
        for u in pad_nodes:
            for r in res:
                if r["node"] is not None:
                    adj[u].append(r["node"])
        if verbose:
            print(f"spring {nm}: df_launch {vel} -> {res[0]['area']} land {res[0]['land']} (t {res[0]['t']} s, apex {res[0]['apex']}),"
                  f" min margin {springs[-1]['min_margin_m']} m over 9 starts, ok={ok}; with runtime airDrag/no input:"
                  f" {springs[-1]['if_runtime_air_drag_no_input']}")
    # spawns
    spawn = {}
    for n in g.j["nodes"]:
        if n.get("name") in ("spawn_A", "spawn_B"):
            x, y, z = n["translation"]
            spawn[n["name"][-1]] = grid.node_at(x, y, z, tol=0.4)

    def bfs(src, allowed=None, graph=None):
        graph = graph or adj
        par = {src: None}
        dq = deque([src])
        while dq:
            v = dq.popleft()
            for w in graph[v]:
                if w not in par and (allowed is None or area[w] in allowed):
                    par[w] = v
                    dq.append(w)
        return par
    radj = [[] for _ in range(N)]
    for u in range(N):
        for w in adj[u]:
            radj[w].append(u)
    reach = {s: bfs(spawn[s]) for s in spawn}
    reach_walk = {s: bfs(spawn[s], graph=walk_adj) for s in spawn}
    back = {s: bfs(spawn[s], graph=radj) for s in spawn}
    areas = sorted(set(area))

    def route(par, dst_area):
        """Area sequence of the shortest walk (BFS order = insertion order of par) to dst_area."""
        u = next((q for q in par if area[q] == dst_area), None)
        if u is None:
            return None
        seq = []
        while u is not None:
            if not seq or seq[-1] != area[u]:
                seq.append(area[u])
            u = par[u]
        return list(reversed(seq))
    # walking distance (m) from each spawn to the nearest cell of every area (Dijkstra on the walk graph)
    import heapq

    def dijkstra(src):
        dist = {src: 0.0}
        pq = [(0.0, src)]
        while pq:
            d, v = heapq.heappop(pq)
            if d > dist.get(v, 1e18):
                continue
            cv, yv, _ = grid.nodes[v]
            xv, zv = grid.cell_xz(cv)
            for w in walk_adj[v]:
                cw, yw, _ = grid.nodes[w]
                xw, zw = grid.cell_xz(cw)
                nd = d + math.sqrt((xw - xv) ** 2 + (zw - zv) ** 2 + (yw - yv) ** 2)
                if nd < dist.get(w, 1e18):
                    dist[w] = nd
                    heapq.heappush(pq, (nd, w))
        return dist
    dist = {s: dijkstra(spawn[s]) for s in spawn}

    def mirror_area(a):
        swaps = [("beach A", "beach B"), ("spawn shelf A", "spawn shelf B"), ("WEST", "EAST"), ("MID apron S", "MID apron N"),
                 ("bridge beach-A~WEST", "bridge beach-B~EAST"), ("sandbar A~WEST (bar_w)", "sandbar B~EAST (bar_w_m)"),
                 ("shoal A~EAST (shoal_e)", "shoal B~WEST (shoal_e_m)")]
        for p, q in swaps:
            if a.startswith(p) and (p not in ("WEST",) or a.split()[0] == "WEST"):
                return q + a[len(p):]
            if a.startswith(q) and (q not in ("EAST",) or a.split()[0] == "EAST"):
                return p + a[len(q):]
        if a == "bridge WEST~MID":
            return "bridge EAST~MID"
        if a == "bridge EAST~MID":
            return "bridge WEST~MID"
        if a.startswith("spring pad "):
            return a[:-2] if a.endswith("_m") else a + "_m"
        return a
    table = []
    for a in areas:
        if a.startswith("spring pad"):
            continue
        cells = [u for u in range(N) if area[u] == a]
        row = {"area": a, "cells": len(cells),
               "kind": "perch" if a.startswith("perch") else "out of play" if a.startswith("out of play") else "area"}
        for s in ("A", "B"):
            r = route(reach_walk[s], a)
            row[f"walk_from_{s}"] = r
            if r is None:
                row[f"spring_from_{s}"] = route(reach[s], a)
            ds = [dist[s][u] for u in cells if u in dist[s]]
            row[f"walk_m_from_{s}"] = round(min(ds), 1) if ds else None
        table.append(row)
    by_area = {r["area"]: r for r in table}
    fair = []
    for r in table:
        m = by_area.get(mirror_area(r["area"]))
        dA, dB = r["walk_m_from_A"], (m or {}).get("walk_m_from_B")
        fair.append({"area": r["area"], "mirror": mirror_area(r["area"]), "A_m": dA, "B_to_mirror_m": dB,
                     "diff_m": None if dA is None or dB is None else round(abs(dA - dB), 2)})
    areas_ok = all(r["walk_from_A"] and r["walk_from_B"] for r in table if r["kind"] == "area")
    fair_ok = all((f["diff_m"] is not None and f["diff_m"] <= 0.5) or (f["A_m"] is None and f["B_to_mirror_m"] is None)
                  for f in fair)
    # crossings on their own
    beachA = {"beach A", "spawn shelf A"}
    beachB = {"beach B", "spawn shelf B"}
    W = {"WEST sand", "WEST shelf", "WEST crown"}
    E = {"EAST sand", "EAST shelf", "EAST crown"}
    M = {"MID apron S", "MID apron N", "wreck deck"}
    crossings = [
        ("A -> WEST via bridge_w", "A", beachA | {"bridge beach-A~WEST"} | W, W),
        ("A -> WEST via sandbar bar_w", "A", beachA | {"sandbar A~WEST (bar_w)"} | W, W),
        ("A -> EAST via sandbar shoal_e", "A", beachA | {"shoal A~EAST (shoal_e)"} | E, E),
        ("A -> EAST via tide-spring spring_beach", "A", beachA | {"spring pad spring_beach"} | E, E),
        ("B -> EAST via bridge_w_m", "B", beachB | {"bridge beach-B~EAST"} | E, E),
        ("B -> EAST via sandbar bar_w_m", "B", beachB | {"sandbar B~EAST (bar_w_m)"} | E, E),
        ("B -> WEST via sandbar shoal_e_m", "B", beachB | {"shoal B~WEST (shoal_e_m)"} | W, W),
        ("B -> WEST via tide-spring spring_beach_m", "B", beachB | {"spring pad spring_beach_m"} | W, W),
    ]
    cross = []
    for (label, s, allowed, dst) in crossings:
        par = bfs(spawn[s], allowed=allowed)
        cross.append({"crossing": label, "reached": sorted({area[u] for u in par if area[u] in dst})})
    # Mid from each side isle on its own (start anywhere on that isle's walkable set reached from A)
    for (label, isle, allowed) in (("WEST -> MID via bridge_mid", W, W | {"bridge WEST~MID"} | M),
                                   ("WEST -> MID via tide-spring spring_mid", W, W | {"spring pad spring_mid"} | M),
                                   ("EAST -> MID via bridge_mid_m", E, E | {"bridge EAST~MID"} | M),
                                   ("EAST -> MID via tide-spring spring_mid_m", E, E | {"spring pad spring_mid_m"} | M)):
        srcs = [u for u in reach["A"] if area[u] in isle]
        par = {u: None for u in srcs}
        dq = deque(srcs)
        while dq:
            v = dq.popleft()
            for w in adj[v]:
                if w not in par and area[w] in allowed:
                    par[w] = v
                    dq.append(w)
        cross.append({"crossing": label, "reached": sorted({area[u] for u in par if area[u] in M})})
    allreach = set(reach["A"]) | set(reach["B"])
    traps = [u for u in allreach if u not in back["A"] or u not in back["B"]]
    trap_areas = {}
    for u in traps:
        trap_areas[area[u]] = trap_areas.get(area[u], 0) + 1
    unreached = {}
    for u in range(N):
        if u not in allreach:
            unreached[area[u]] = unreached.get(area[u], 0) + 1
    out = {"model": {"cell_m": CELL, "step_m": STEP, "height_m": HEIGHT, "radius_m": RADIUS, "gravity": G,
                     "walk_slope_deg": 46.0, "wall_slick": False, "jumps": False},
           "nodes": N, "spawn_nodes": spawn, "springs": springs, "route_table": table, "crossings": cross,
           "all_areas_walk_reachable_from_both_spawns": areas_ok, "rot180_fairness": fair, "rot180_fair": fair_ok,
           "springs_ok": all(s["ok"] for s in springs),
           "crossings_ok": all(c["reached"] for c in cross),
           "one_way_trap_cells": len(traps), "trap_cells_by_area": trap_areas,
           "standable_cells_unreachable_from_spawns": unreached,
           "reach_counts": {s: len(reach[s]) for s in reach},
           "walk_reach_counts": {s: len(reach_walk[s]) for s in reach_walk}}
    if verbose:
        print("route table (walking + tide-springs; no wall-slick, no jumps):")
        for row in table:
            print(f"  {row['area']:36s} [{row['kind']}] cells {row['cells']:6d}  walk m A {row['walk_m_from_A']}  B {row['walk_m_from_B']}")
            for s in ("A", "B"):
                w = row[f"walk_from_{s}"]
                sp = row.get(f"spring_from_{s}")
                txt = " > ".join(w) if w else (("(no walking route) spring: " + " > ".join(sp)) if sp
                                               else "UNREACHED (wall-slick / jump perch only)")
                print(f"     {s}: {txt}")
        print("rot180 fairness (walk m from A to X vs from B to mirror(X)):",
              "max diff", max((f["diff_m"] or 0.0) for f in fair), "m; fair =", fair_ok)
        print("all movement areas walk-reachable from both spawns:", areas_ok)
        print("crossings on their own:")
        for c in cross:
            print(f"  {c['crossing']:44s} -> {c['reached'] or 'FAILED'}")
        print("one-way trap cells:", len(traps), json.dumps(trap_areas))
        print("standable but unreachable cells by area:", json.dumps(unreached))
    return out
