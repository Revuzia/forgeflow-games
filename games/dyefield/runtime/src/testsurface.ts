// DYEFIELD — window.__DF__ test surface (CONTRACT §6 + §11). Installed at boot (before the game
// exists), so the harness can poll state().phase through boot → loading → ready → play.
//
//   version · state() · teamUnderFeet() · paintHash() · flips() · shot(name)
//   §11: match() — phase, timeLeft, countdown, runners[] {id, name, team, state, hp, tank, alive, x, y, z,
//        hidden, …}, result, coverage, event counts · events(n) — the last n drained sim events
//   dev-only (?dev=1): teleport(x, y, z, yaw?) · splat(x, y, z, r, team) · start()
//        §11: setTimeLeft(s) · damage(pid, n) · setTank(pid, v)
//   extra (harness read-backs, not in the contract): minimapPixel() — the DOM minimap canvas pixel
//   under the runner plus the team colors; render() — renderer counters, the adaptive render scale and
//   the static map merge report; hud() — the visible HUD text (timer, toast, kill feed, slates, crests);
//   aim() — the camera yaw / pitch and the reticle's world point.
//   phase 6: kit() — the human's kit read-outs (charge, rolling, special meter, sub cooldown, layer summary,
//   the left-hand → grip_L distance of a two-handed kit) · fx() — live FX counts (drops, jelly, puddles,
//   cells, raining cells, glint lines, beam flashes)
//   phase 9 (CONTRACT_P6_11 §20): state().phase gains 'menu' (the lobby behind the menus) · menu() — the menus'
//   screen / context / focus / profile / mannequin · settings() — the saved settings · session() — the running
//   session (mode, map, preset) · gl() — renderer.info memory + program counts (leak checks across sessions)
//   phase 10 (CONTRACT_P6_11 §21): audio() — the GameAudio stats (unlocked, context state, music cue, voices,
//   peak / stolen / rejected, loops, one-shots played (sfx / ui), decoded sets, decode + fetch errors, the output
//   meter) · juice() — the match's juice read-back (markers, hurt vignette + arc, confetti + its keep-out box,
//   shakes / trauma added; null outside a match)
//   dev-only phase 6: fillSpecial(pid = 0) — fills the special meter and arms it (sets the Runner's public
//   `special` = 1 and `specialReady` = true; MatchWorld has no dev hook for it, and the 'ready' event is
//   NOT emitted) · freeze(on) — stops the sim AND the visual clock while rendering continues, so a
//   screenshot can catch an exact moment (the harness unfreezes right after).
//   CONTRACT_FFA F3: match() adds matchMode ('teams' | 'ffa'), crews (the crews in play) and coverageByTeam (the
//   weighted share per crew id, [0] = neutral) — `mode` stays the session kind ('match' | 'lobby'); state() adds
//   matchMode; minimapPixel() adds `own` (the human's crew dye, either mode) and `crews` (dye by crew id).
//   FFA drop pads (lane PADS): ffaPads(n = 128) — per pad {i, crew, mark, x, z, r, maxHoverCm, maxSinkCm, …} measured
//   at n points inside 0.95 R (a sunflower spread + a ring on 0.95 R): the RENDERED pad top (a downward ray onto the pad
//   mesh itself, so whatever geometry the view built is what is measured) vs the ground (a downward ray onto the visible
//   map meshes, the pads excluded; the first face with world normal y >= 0.7 below the pad top + 0.5 m). hover = top −
//   ground > 0 (the pad stands above the sand there), sink = ground − top > 0 (the pad is buried there). Also the fitted
//   ground slope, its downhill direction and the fitted ground height under the centre (groundY) per pad, the pads'
//   draw objects / vertices and the view's build stats (root.userData: buildMs, gather {ms, meshes, scanned},
//   floorTris per pad, plane-clamped vertices). The rays are THREE.Raycaster's own tests, run against per-pad soups of
//   the world-space triangles whose xz bounds touch the pad's square (every face such a vertical ray can hit: same
//   answers, ~0.5 s per map instead of ~25 s). _harness/padcheck.py gates on it.

import * as THREE from 'three';
import type { AppStatus } from './game.ts';
import type { Menus } from './ui/menus.ts';
import type { ProfileStore, SettingsStore } from './ui/settings.ts';
import type { WebGLInfo } from 'three';

/** app handles the phase 9 read-backs use (main.ts fills them) */
export interface AppHandles {
  menus(): Menus | null;
  settings(): SettingsStore;
  profile(): ProfileStore;
  session(): { mode: string; map: string; preset: string; key: string; cam: number[] | null; fov: number | null } | null;
  renderInfo(): WebGLInfo | null;
  audio(): unknown;
  juice(): unknown;
  /** CONTRACT_MOBILE M10: the touch read-back (main.ts) */
  touch?(): unknown;
}
import type { Coverage, MatchMode, MoveState, TeamId } from './core/types.ts';
import { teamById, hexToRgb01, crewDef, crewIds } from './core/data.ts';

export interface DFState {
  phase: AppStatus['phase'];
  mapId: string;
  tick: number;
  fps: number;
  player: { x: number; y: number; z: number; yaw: number; state: MoveState; grounded: boolean; tank: number; team: TeamId; hp: number; alive: boolean; slickForm: boolean };
  coverage: Coverage;
  atlas: { size: number; count: number; overlaps: number };
  match?: { phase: string; timeLeft: number; countdown: number };
  error?: string;
  startedBy?: string | null;
  pointerLocked?: boolean;
  /** CONTRACT_FFA F3 */
  matchMode?: MatchMode;
}

const rgb255 = (hex: string): number[] => hexToRgb01(hex).map((v) => Math.round(v * 255));

// ── FFA drop-pad read-back (lane PADS) ──
interface PadSpecLike { x: number; y: number; z: number; r?: number; crew: TeamId; yaw?: number }
const fpRay = new THREE.Raycaster();
const fpDown = new THREE.Vector3(0, -1, 0);
const fpO = new THREE.Vector3();
const fpN = new THREE.Vector3();
const fpM = new THREE.Matrix4();
const fpIm = new THREE.Matrix4();
const fpNm = new THREE.Matrix3();
const fpBox = new THREE.Box3();

/** the world-space normal y of a raycast hit (instanced meshes: the instance's matrix too) */
function hitNormalY(h: THREE.Intersection): number {
  if (!h.face) return 0;
  const obj = h.object as THREE.InstancedMesh;
  fpM.copy(obj.matrixWorld);
  if (obj.isInstancedMesh && h.instanceId !== undefined) { obj.getMatrixAt(h.instanceId, fpIm); fpM.multiply(fpIm); }
  fpNm.getNormalMatrix(fpM);
  return fpN.copy(h.face.normal).applyMatrix3(fpNm).normalize().y;
}

function firstUp(hits: THREE.Intersection[], minNy: number): THREE.Intersection | null {
  for (const h of hits) if (hitNormalY(h) >= minNy) return h;
  return null;
}

/** visible all the way up to (and including) `stop` */
function shownUnder(o: THREE.Object3D, stop: THREE.Object3D): boolean {
  for (let x: THREE.Object3D | null = o; x; x = x.parent) {
    if (!x.visible) return false;
    if (x === stop) return true;
  }
  return false;
}

/**
 * Speed-up only: the world-space triangles of `meshes` whose xz bounds touch each square [x0, z0, x1, z1] — every
 * face a vertical ray inside that square can hit — as one temporary Mesh per square that THREE.Raycaster tests
 * exactly as it would the originals (a mirrored transform's winding restored, back-face-only meshes left out: a ray
 * from above only ever hits their down-facing faces). Without it every ray walks every triangle of the merged pads
 * (≈ 12.8 k) and of the big terrain meshes (≈ 25 s per map on the iGPU machine).
 */
function soups(meshes: THREE.Mesh[], squares: number[][]): THREE.Mesh[] {
  const out: number[][] = squares.map(() => []);
  const M = new THREE.Matrix4();
  const IM = new THREE.Matrix4();
  const v = new THREE.Vector3();
  let w = new Float32Array(0);
  for (const m of meshes) {
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    if (mats.every((mt) => mt && mt.side === THREE.BackSide)) continue;
    const geo = m.geometry;
    const pos = geo.getAttribute('position');
    if (!pos) continue;
    const idx = geo.index;
    const total = idx ? idx.count : pos.count;
    const start = geo.drawRange.start, end = Math.min(total, start + geo.drawRange.count);
    const inst = m as THREE.InstancedMesh;
    const copies = inst.isInstancedMesh ? inst.count : 1;
    if (w.length < pos.count * 3) w = new Float32Array(pos.count * 3);
    for (let c = 0; c < copies; c++) {
      M.copy(m.matrixWorld);
      if (inst.isInstancedMesh) { inst.getMatrixAt(c, IM); M.multiply(IM); }
      const flip = M.determinant() < 0;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(M);
        w[i * 3] = v.x; w[i * 3 + 1] = v.y; w[i * 3 + 2] = v.z;
      }
      for (let k = start; k + 2 < end; k += 3) {
        const a = (idx ? idx.getX(k) : k) * 3;
        let b = (idx ? idx.getX(k + 1) : k + 1) * 3, cc = (idx ? idx.getX(k + 2) : k + 2) * 3;
        if (flip) { const t = b; b = cc; cc = t; }
        const minX = Math.min(w[a], w[b], w[cc]), maxX = Math.max(w[a], w[b], w[cc]);
        const minZ = Math.min(w[a + 2], w[b + 2], w[cc + 2]), maxZ = Math.max(w[a + 2], w[b + 2], w[cc + 2]);
        for (let q = 0; q < squares.length; q++) {
          const sq = squares[q];
          if (maxX < sq[0] || minX > sq[2] || maxZ < sq[1] || minZ > sq[3]) continue;
          out[q].push(w[a], w[a + 1], w[a + 2], w[b], w[b + 1], w[b + 2], w[cc], w[cc + 1], w[cc + 2]);
        }
      }
    }
  }
  return out.map((arr) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
    mesh.updateMatrixWorld(true);
    return mesh;
  });
}

function measureFfaPads(mapRoot: THREE.Object3D, specs: ReadonlyArray<PadSpecLike>, n: number): Record<string, unknown> {
  const t0 = performance.now();
  const padsRoot = mapRoot.getObjectByName('ffa_pads');
  if (!padsRoot) return { count: 0, specs: specs.length, pads: [], error: 'no ffa_pads group under the map root' };
  mapRoot.updateMatrixWorld(true);
  const padMeshes: THREE.Mesh[] = [];
  let vertices = 0;
  padsRoot.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    padMeshes.push(m);
    const im = m as THREE.InstancedMesh;
    vertices += (m.geometry.getAttribute('position')?.count ?? 0) * (im.isInstancedMesh ? im.count : 1);
  });
  const ground: Array<{ m: THREE.Mesh; box: THREE.Box3 }> = [];
  mapRoot.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !shownUnder(o, mapRoot)) return;
    for (let x: THREE.Object3D | null = o; x && x !== mapRoot; x = x.parent) if (x === padsRoot) return;
    ground.push({ m, box: new THREE.Box3().setFromObject(m) });
  });
  const nIn = Math.max(1, Math.round(n * 0.75));
  const nRing = Math.max(1, n - nIn);
  const GOLD = Math.PI * (3 - Math.sqrt(5));
  const pads: Array<Record<string, unknown>> = [];
  const radius = specs.map((p) => (p.r && p.r > 0 ? p.r : 1.6));
  const squares = specs.map((p, i) => [p.x - radius[i] - 0.3, p.z - radius[i] - 0.3, p.x + radius[i] + 0.3, p.z + radius[i] + 0.3]);
  const near = ground.filter((g) => specs.some((p, i) => {
    fpBox.min.set(p.x - radius[i] - 0.3, p.y - 4, p.z - radius[i] - 0.3);
    fpBox.max.set(p.x + radius[i] + 0.3, p.y + 3.5, p.z + radius[i] + 0.3);
    return g.box.intersectsBox(fpBox);
  })).map((g) => g.m);
  const padSoup = soups(padMeshes, squares);
  const groundSoup = soups(near, squares);
  specs.forEach((p, i) => {
    const R = radius[i];
    const padT = [padSoup[i]];
    const cands = [groundSoup[i]];
    let maxHover = -Infinity, maxSink = -Infinity, sum = 0, cnt = 0, topMiss = 0, groundMiss = 0;
    let worst: { x: number; z: number; dCm: number } | null = null;
    const gs: number[][] = [];
    for (let k = 0; k < nIn + nRing; k++) {
      const rr = k < nIn ? 0.95 * R * Math.sqrt((k + 0.5) / nIn) : 0.95 * R;
      const a = k < nIn ? k * GOLD : ((k - nIn) / nRing) * Math.PI * 2;
      const x = p.x + Math.sin(a) * rr, z = p.z + Math.cos(a) * rr;
      fpRay.set(fpO.set(x, p.y + 3, z), fpDown);
      fpRay.far = 8;
      const top = firstUp(fpRay.intersectObjects(padT, false), 0.3);
      if (!top) { topMiss++; continue; }
      const ty = top.point.y;
      fpRay.set(fpO.set(x, ty + 0.5, z), fpDown);
      fpRay.far = 3.5;
      const gh = firstUp(fpRay.intersectObjects(cands, false), 0.7);
      if (!gh) { groundMiss++; continue; }
      const gy = gh.point.y;
      gs.push([x - p.x, z - p.z, gy]);
      const d = ty - gy;
      maxHover = Math.max(maxHover, d);
      maxSink = Math.max(maxSink, -d);
      sum += d; cnt++;
      if (!worst || Math.abs(d) > Math.abs(worst.dCm / 100)) worst = { x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, dCm: Math.round(d * 1000) / 10 };
    }
    // the ground's least-squares plane gy = a + b·dx + c·dz: slope and downhill direction
    let slopeDeg = 0, downhill = [0, 0], range = 0, groundY = NaN;
    if (gs.length >= 3) {
      let sx = 0, sz = 0, sy = 0, sxx = 0, szz = 0, sxz = 0, sxy = 0, szy = 0;
      let lo = Infinity, hi = -Infinity;
      for (const [dx, dz, y] of gs) {
        sx += dx; sz += dz; sy += y; sxx += dx * dx; szz += dz * dz; sxz += dx * dz; sxy += dx * y; szy += dz * y;
        lo = Math.min(lo, y); hi = Math.max(hi, y);
      }
      const m = gs.length;
      const mx = sx / m, mz = sz / m, my = sy / m;
      const cxx = sxx / m - mx * mx, czz = szz / m - mz * mz, cxz = sxz / m - mx * mz;
      const cxy = sxy / m - mx * my, czy = szy / m - mz * my;
      const det = cxx * czz - cxz * cxz;
      if (Math.abs(det) > 1e-9) {
        const b = (cxy * czz - czy * cxz) / det, c = (czy * cxx - cxy * cxz) / det;
        groundY = my - b * mx - c * mz;              // the fitted plane under the pad centre
        const gl = Math.hypot(b, c);
        slopeDeg = Math.atan(gl) * 180 / Math.PI;
        downhill = gl > 1e-6 ? [-b / gl, -c / gl] : [0, 0];
      }
      range = hi - lo;
    }
    let mark = '';
    try { mark = crewDef('ffa', p.crew).mark; } catch { /* unknown crew */ }
    const r2 = (v: number): number => Math.round(v * 100) / 100;
    pads.push({
      i, crew: p.crew, mark, x: r2(p.x), y: r2(p.y), z: r2(p.z), r: R, yaw: r2(p.yaw ?? 0),
      groundY: Number.isFinite(groundY) ? Math.round(groundY * 1000) / 1000 : null,
      samples: cnt, topMiss, groundMiss,
      maxHoverCm: cnt ? Math.round(Math.max(0, maxHover) * 1000) / 10 : null,
      maxSinkCm: cnt ? Math.round(Math.max(0, maxSink) * 1000) / 10 : null,
      meanCm: cnt ? Math.round((sum / cnt) * 1000) / 10 : null,
      slopeDeg: Math.round(slopeDeg * 10) / 10, downhill: downhill.map((v) => Math.round(v * 1000) / 1000),
      groundRangeCm: Math.round(range * 1000) / 10, worst,
    });
  });
  for (const m of [...padSoup, ...groundSoup]) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
  const ud = padsRoot.userData as { buildMs?: number; clamped?: number; floorTris?: number[]; gather?: unknown };
  return {
    count: specs.length, drawObjects: padMeshes.length, vertices, buildMs: typeof ud.buildMs === 'number' ? Math.round(ud.buildMs * 10) / 10 : null,
    clampedVertices: ud.clamped ?? null, floorTris: ud.floorTris ?? null, gather: ud.gather ?? null,
    groundMeshes: ground.length, samplesPerPad: nIn + nRing, ms: Math.round(performance.now() - t0), pads,
  };
}

export function installTestSurface(app: AppStatus, handles?: AppHandles): void {
  const g = () => app.game;
  const devOnly = (name: string): void => {
    if (!app.dev) throw new Error(`__DF__.${name} is dev-only — load with ?dev=1`);
  };
  const need = (name: string) => {
    const game = g();
    if (!game) throw new Error(`__DF__.${name}: game not loaded (phase ${app.phase})`);
    return game;
  };
  const api = {
    version: app.version,
    state(): DFState {
      const game = g();
      const p = game?.human;
      const s: DFState = {
        phase: app.phase,
        mapId: app.mapId,
        tick: game?.tick ?? 0,
        fps: game ? Math.round(game.fps * 10) / 10 : 0,
        player: p
          ? { x: p.x, y: p.y, z: p.z, yaw: p.yaw, state: p.state, grounded: p.grounded, tank: p.tank, team: p.team, hp: p.hp, alive: p.alive, slickForm: p.slickForm }
          : { x: 0, y: 0, z: 0, yaw: 0, state: 'walk', grounded: false, tank: 0, team: 1, hp: 0, alive: false, slickForm: false },
        coverage: game ? game.p.painter.coverage() : { sun: 0, gulf: 0, neutral: 1 },
        atlas: game ? { size: game.p.atlas.size, count: game.p.atlas.count, overlaps: game.p.atlas.overlaps } : { size: 0, count: 0, overlaps: 0 },
        startedBy: app.startedBy,
        pointerLocked: !!document.pointerLockElement,
      };
      if (game) s.match = { phase: game.world.phase, timeLeft: game.world.timeLeft, countdown: game.world.countdown };
      if (game) s.matchMode = game.matchMode;
      if (app.error) s.error = app.error;
      return s;
    },
    teamUnderFeet(): TeamId | null {
      const game = g();
      if (!game) return null;
      const p = game.human;
      return game.p.painter.teamUnder(p.x, p.y, p.z);
    },
    paintHash(): string {
      const game = g();
      return game ? game.p.painter.hash() : '';
    },
    flips(): number {
      const game = g();
      return game ? game.p.painter.flips : 0;
    },
    async shot(name: string): Promise<{ ok: boolean; path?: string }> {
      const game = g();
      if (!game) return { ok: false };
      game.render(0, 1);
      const url = game.p.canvas.toDataURL('image/png');
      try {
        const res = await fetch('/__shot/' + encodeURIComponent(String(name || 'shot')), {
          method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: url,
        });
        const body = await res.json().catch(() => ({})) as { ok?: boolean; path?: string };
        return { ok: res.ok && body.ok !== false, path: body.path };
      } catch {
        return { ok: false };
      }
    },
    // ── §11 match read-backs
    match(): Record<string, unknown> | null {
      const game = g();
      return game ? game.matchInfo() : null;
    },
    events(n = 50): unknown[] {
      const game = g();
      return game ? game.events(n) : [];
    },
    // ── dev-only
    teleport(x: number, y: number, z: number, yaw?: number): void {
      devOnly('teleport');
      need('teleport').world.devTeleport(0, x, y, z, yaw);
    },
    splat(x: number, y: number, z: number, r: number, team: TeamId): number {
      devOnly('splat');
      return need('splat').p.painter.splat(x, y, z, { radius: r, team });
    },
    start(): void {
      devOnly('start');
      need('start').devStart();
    },
    setTimeLeft(s: number): void {
      devOnly('setTimeLeft');
      need('setTimeLeft').world.devSetTimeLeft(s);
    },
    damage(pid: number, n: number): void {
      devOnly('damage');
      need('damage').world.devDamage(pid, n);
    },
    setTank(pid: number, v: number): void {
      devOnly('setTank');
      need('setTank').world.devSetTank(pid, v);
    },
    fillSpecial(pid = 0): boolean {
      devOnly('fillSpecial');
      const r = need('fillSpecial').world.runners[pid];
      if (!r) return false;
      r.special = 1;
      r.specialReady = true;
      return true;
    },
    freeze(on: boolean): boolean {
      devOnly('freeze');
      const game = need('freeze');
      game.frozen = !!on;
      return game.frozen;
    },
    // ── phase 9 read-backs
    menu(): Record<string, unknown> | null {
      const m = handles?.menus();
      return m ? m.readback() : null;
    },
    settings(): Record<string, unknown> | null {
      return handles ? JSON.parse(JSON.stringify(handles.settings().get())) : null;
    },
    profile(): Record<string, unknown> | null {
      return handles ? { ...handles.profile().get() } : null;
    },
    session(): Record<string, unknown> | null {
      return handles?.session() ?? null;
    },
    gl(): Record<string, unknown> | null {
      const i = handles?.renderInfo();
      if (!i) return null;
      return { geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs ? i.programs.length : 0,
        heapMB: (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory ? Math.round((performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize / 1048576) : null };
    },
    audio(): unknown {
      return handles ? handles.audio() : null;
    },
    juice(): unknown {
      return handles ? handles.juice() : null;
    },
    /**
     * CONTRACT_MOBILE M10: { mode, visible, stick: {x, y, active}, lookRad: {yaw, pitch} (total touch look radians, never
     * reset), held, buttons: [{id, rect, dimmed}], assist: {slow, dyaw} } plus pinned / latched / active / options /
     * startedBy / renderer (touch profile, antialias, shadow cap) / rotateOverlay / fullscreen / contextLost.
     */
    touch(): unknown {
      return handles?.touch ? handles.touch() : null;
    },
    // ── harness read-backs (additive)
    kit(): Record<string, unknown> | null {
      const game = g();
      if (!game) return null;
      const r = game.human;
      const rv = game.p.players.view(0);
      const grip = game.p.players.gripError(0);
      return {
        kit: r.kit, charge: r.charge, rolling: r.rolling, flicking: r.flicking, leaping: r.leaping, special: r.special,
        specialReady: r.specialReady, specialActive: r.specialActive, specialT: r.specialT, subCooldown: r.subCooldown, tank: r.tank,
        subs: r.subs, flicks: r.flicks, beams: r.beams, bursts: r.bursts, shots: r.shots, firing: r.firing,
        anim: rv ? rv.describe() : null, gripError: grip === null ? null : Math.round(grip * 1000) / 1000,
      };
    },
    fx(): Record<string, unknown> | null {
      const game = g();
      return game ? { ...game.p.fx.live, emitted: game.p.fx.emitted } : null;
    },
    minimapPixel(): { px: number; py: number; rgba: number[]; sun: number[]; gulf: number[]; own: number[]; crews: Record<number, number[]> } | null {
      const game = g();
      if (!game) return null;
      const p = game.human;
      const r = game.p.hud.minimapPixel(p.x, p.z);
      if (!r) return null;
      const mm = game.matchMode;
      const crews: Record<number, number[]> = {};
      for (const id of crewIds(mm)) crews[id] = rgb255(crewDef(mm, id).dye);
      return { ...r, sun: rgb255(teamById(1).dye), gulf: rgb255(teamById(2).dye), own: rgb255(crewDef(mm, p.team).dye), crews };
    },
    render(): Record<string, unknown> | null {
      const game = g();
      if (!game) return null;
      const ad = game.p.rig.adaptive();
      const c = game.p.canvas;
      return {
        ...game.p.rig.stats(), gpu: game.p.rig.gpu(), fps: game.fps, frames: game.frames,
        quality: ad.quality, scale: ad.scale, scaleMin: ad.min, scaleMax: ad.max, buffer: [c.width, c.height],
        targetMs: ad.targetMs, p90: ad.p90, clockMs: ad.clockMs, scaleChanges: ad.changes, scaleLast: ad.last,
        mapMerge: game.p.map.merge, runnerTris: game.p.players.stats().bodyTris, particles: game.p.fx.emitted,
        projectiles: game.world.projectiles.count,
      };
    },
    hud(): Record<string, unknown> | null {
      const game = g();
      return game ? game.p.hud.readback() : null;
    },
    aim(): Record<string, unknown> | null {
      const game = g();
      if (!game) return null;
      const c = game.p.cam;
      return { yaw: c.yaw, pitch: c.pitch, boom: c.boom, slickBlend: c.slickBlend };
    },
    /** FFA drop pads: rendered pad top vs the ground under it (see the header); null outside a game, count 0 in teams */
    ffaPads(n = 128): Record<string, unknown> | null {
      const game = g();
      if (!game) return null;
      return { matchMode: game.matchMode, map: app.mapId, ...measureFfaPads(game.p.map.root, game.world.crewPads, Math.max(16, n | 0)) };
    },
    /** dev-only live handles for console debugging (renderer, scene, game parts) */
    get dev(): Record<string, unknown> | null {
      const game = g();
      if (!app.dev || !game) return null;
      return { game, renderer: game.p.rig.renderer, scene: game.p.scene, camera: game.p.cam.camera, parts: game.p, world: game.world };
    },
  };
  (window as unknown as { __DF__: typeof api }).__DF__ = api;
}
