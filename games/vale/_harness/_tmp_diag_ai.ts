// _tmp probe (lane AI diagnosis, owner_rulings 44 round 2): what the fit defenders were doing when an inner or base structure
// fell to Wicks alone (no enemy fighter within 15 m) with two of its team above 60 % within 16 m. Observation only: it reads
// events, entity state and each controller's fields after the step; it never changes a decision.
//
//   node _harness/_tmp_diag_ai.ts --diff veteran --seeds 8 --seed0 101 [--cut 1800] [--what wof|dither]
// Every match is a pure function of (catalog, setup).
import type { CatalogT } from '../src/contracts/catalog.ts';
import type { MatchSetup, SeatSetup } from '../src/contracts/sim.ts';
import { createBots, pickLoadout } from '../src/sim/bots/index.ts';
import type { Entity } from '../src/sim/entity.ts';
import { createSim, type BotController } from '../src/sim/sim.ts';
import { structuresOf } from '../src/sim/units/structures.ts';
import { buildContent, defaultOptions } from '../tools/build_content.ts';

const argv = process.argv.slice(2);
const opt = (k: string, d: string): string => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d; };

function loadCatalog(): CatalogT {
  const r = buildContent(defaultOptions({ check: true, allowMissingAssets: true, quiet: true }));
  if (!r.catalog) { console.error('content build failed'); process.exit(77); }
  return r.catalog;
}

function lineup(catalog: CatalogT, seed: number, diff: string): MatchSetup {
  const mode = catalog.modes.find((m) => m.id === 'rift')!;
  const queue = catalog.queues.find((q) => q.mode === mode.id && q.kind === 'standard') ?? catalog.queues.find((q) => q.mode === mode.id)!;
  const n = mode.teams * mode.perTeam;
  const pool = mode.rules.itemPool ?? '';
  const seats: SeatSetup[] = [];
  const all = catalog.fighters.map((f) => f.id).sort();
  const roles = catalog.roles.filter((r) => r.assign).sort((a, b) => (a.assign?.order ?? 0) - (b.assign?.order ?? 0)).map((r) => r.id);
  const natives = new Map<string, string[]>();
  for (const f of catalog.fighters) { const l = natives.get(f.role) ?? []; l.push(f.id); natives.set(f.role, l); }
  for (const l of natives.values()) l.sort();
  for (let i = 0; i < n; i++) {
    const team = Math.floor(i / mode.perTeam), slot = i % mode.perTeam, role = roles[slot % roles.length];
    const pl = natives.get(role) ?? all;
    const fighter = pl[(seed + slot + team) % pl.length];
    const skin = catalog.skins.find((s) => s.fighter === fighter && s.tier === 'base')?.id ?? catalog.skins.find((s) => s.fighter === fighter)?.id ?? '';
    seats.push({ player: i, team, name: catalog.botNames[i % catalog.botNames.length], fighter, skin, role,
      loadout: pickLoadout(catalog, fighter, pool, role), controller: 'bot', botDifficulty: diff as SeatSetup['botDifficulty'], colorIndex: i });
  }
  return { matchId: `diag-rift-${seed}-${diff}`, seed, queue: queue.id, mode: mode.id, map: mode.map, seats, catalogVersion: catalog.version };
}

const WHAT = opt('what', 'wof');
const diff = opt('diff', 'veteran'), seeds = Number(opt('seeds', '8')), seed0 = Number(opt('seed0', '101')), cut = Number(opt('cut', '1800'));
const catalog = loadCatalog();
for (let seed = seed0; seed < seed0 + seeds; seed++) {
  const setup = lineup(catalog, seed, diff);
  const ctrls: (BotController | null)[] = setup.seats.map(() => null);
  const factory = createBots(catalog, setup);
  const sim = createSim(catalog, setup, { bots: (seat, host) => { const c = factory(seat, host); ctrls[seat.player] = c; return c; }, pregameSeconds: 0 });
  const ctl = (p: number) => ctrls[p] as unknown as { mode?: string; brain?: { guard: Map<number, { sid: string }> } } | null;
  const fHit = new Map<number, number>();
  const hist = new Map<number, string[]>();
  const trail: string[][] = [], swung: number[] = [], dcd: number[] = [];
  while (sim.view.phase !== 'ended') {
    const evs = sim.step();
    const w = sim.world, now = w.time;
    if (now > cut) break;
    for (const ev of evs) {
      if (ev.e === 'damage') { const d = w.entity(ev.dst); const s = w.entity(ev.src); const src = s ? w.creditFighter(s) : null; if (d && d.kind === 'structure' && src) fHit.set(d.id, now); }
      if (ev.e !== 'structure' || WHAT !== 'wof') continue;
      const st = w.entity(ev.id); if (!st) continue;
      const s = structuresOf(w).find((x) => x.ent === st); if (!s) continue;
      let foes = 0; const fit: Entity[] = [];
      for (const pl of w.players) { const f = pl.ent; if (!f || !f.alive) continue; const d2 = (f.x - st.x) ** 2 + (f.y - st.y) ** 2;
        if (f.team !== st.team && d2 <= 225) foes++; else if (f.team === st.team && d2 <= 256 && f.hp > f.maxHp * 0.6) fit.push(f); }
      if (foes > 0 || fit.length < 2) continue;
      let em = 0, om = 0;
      for (const u of w.entities) if (!u.removed && u.alive && u.kind === 'minion' && (u.x - st.x) ** 2 + (u.y - st.y) ** 2 <= 144) { if (u.team === st.team) om++; else em++; }
      const t = `${Math.floor(now / 60)}:${String(Math.floor(now % 60)).padStart(2, '0')}`;
      console.log(`seed ${seed} ${t} ${s.def.id} fell: enemy Wicks in 12 m ${em}, ours ${om}, fighters last hit it ${(now - (fHit.get(st.id) ?? -1e9)).toFixed(0)} s ago`);
      for (const f of fit) {
        const p = w.players.findIndex((x) => x.entity === f.id); const c = ctl(p);
        const at = f.atkTarget >= 0 ? w.entity(f.atkTarget) : null;
        const post = c?.brain?.guard.get(p)?.sid ?? '-';
        console.log(`   p${p} ${setup.seats[p].fighter} mode ${c?.mode} post ${post} d ${Math.hypot(f.x - st.x, f.y - st.y).toFixed(1)} hp ${(f.hp / f.maxHp * 100).toFixed(0)}% atk ${at ? at.kind : '-'} modes(6s) ${(hist.get(p) ?? []).join(',')}`);
      }
    }
    // dither episodes (the tactics probe's detector), with the mode / post / move-point trail
    if (WHAT === 'dither' && w.tick % 10 === 0) for (let p = 0; p < w.players.length; p++) {
      const f = w.players[p].ent; const tr = (trail[p] ??= []);
      if (!f || !f.alive) { tr.length = 0; swung[p] = now; continue; }
      if (f.atkTarget >= 0 || f.cast) swung[p] = now;
      const c = ctrls[p] as unknown as { mode?: string; pMoveX?: number; pMoveY?: number; brain?: { guard: Map<number, { sid: string }> } };
      tr.push(`${f.x.toFixed(0)},${f.y.toFixed(0)} ${String(c.mode).slice(0, 4)} ${c.brain?.guard.get(p)?.sid ?? '-'} ->${(c.pMoveX ?? 0).toFixed(0)},${(c.pMoveY ?? 0).toFixed(0)}`);
      if (tr.length > 36) tr.shift();
      const ph = tr.map((x) => x.split(' ')[0].split(',').map(Number));
      if (f.hp < f.maxHp * 0.9 || now < (dcd[p] ?? 0) || now - (swung[p] ?? 0) < 12 || ph.length < 36) continue;
      let near = false; for (const q of w.players) { const g = q.ent; if (g && g.alive && g.team !== f.team && (g.x - f.x) ** 2 + (g.y - f.y) ** 2 <= 900) { near = true; break; } }
      if (near) continue;
      const legs: number[] = []; let lx = 0, ly = 0, len = 0;
      for (let i = 3; i < ph.length; i += 3) { const dx = ph[i][0] - ph[i - 3][0], dy = ph[i][1] - ph[i - 3][1], m = Math.hypot(dx, dy); if (m < 0.5) continue; if (len > 0 && dx * lx + dy * ly < 0) { legs.push(len); len = 0; } lx = dx; ly = dy; len += m; }
      if (len > 0) legs.push(len);
      const net = Math.hypot(ph[35][0] - ph[0][0], ph[35][1] - ph[0][1]);
      if (legs.filter((x) => x >= 4).length >= 3 && net <= 5 && f.stateOverride !== 'recall') {
        dcd[p] = now + 12;
        console.log(`DITHER seed ${seed} t ${now.toFixed(0)} p${p} t${f.team}: ${tr.filter((_, i) => i % 3 === 0).join(' | ')}`);
      }
    }
    if (w.tick % 30 === 0) for (let p = 0; p < w.players.length; p++) { const h = hist.get(p) ?? []; h.push(String(ctl(p)?.mode ?? '?').slice(0, 4)); if (h.length > 6) h.shift(); hist.set(p, h); }
  }
}
