// Round 14 (R14_ROOMS, D-104) DEV TOOL: re-lay the seven places from a plan (the bigger rooms), keeping every other byte of the place modules.
//   node _harness/rooms_relay.ts draft            print a first plan: every spot of the LIVE layouts (_harness/data/live_rooms_6c495e9c1.json) scaled to the new bounds
//                                                 (a thing's use / peek / push spots and its own zones and patches keep their OFFSET from it), to _harness/data/rooms_plan_r14.json
//   node _harness/rooms_relay.ts apply [place]    write the plan's numbers into src/data/place_<id>.ts (positions, yaws, spots, zone and patch areas, bounds, walls, spawn)
// The plan is edited by hand between the two (DT-01 of probe_pg_data says what does not fit). Not part of any probe or build.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = resolve(HERE, '..');
const LIVE = JSON.parse(readFileSync(resolve(HERE, 'data/live_rooms_6c495e9c1.json'), 'utf8')) as Record<string, any>;
const PLAN_PATH = resolve(HERE, 'data/rooms_plan_r14.json');
const IDS = ['home', 'hearthlog', 'ripple', 'frostbell', 'rainleaf', 'lanternroof', 'cloudloft'];
const r3 = (v: number): number => Math.round(v * 1000) / 1000, r2 = (v: number): number => Math.round(v * 20) / 20;
/** The new rooms (D-104): wide 11.0 x 7.8 m (was 6.8 x 4.8), tall 4.6 x 9.8 m (was 2.8 x 6.0; the cabin 2.5 wide, Cloudloft 3.6), Home a disc of r 5.5 (was 3.4). */
const NEW = { wide: { hx: 5.5, hz: 3.9, round: 1.3 }, tall: { hx: 2.3, hz: 4.9, round: 0.65 }, tallCloud: { hx: 2.9, hz: 4.9, round: 0.65 }, homeR: 5.5 };

type Lay = { bounds: any; walls: any[]; spawn: any; things: any[]; zones: any[]; patches: any[]; camPitch?: number[] };
function draft(): void {
  const plan: Record<string, { wide: Lay; tall: Lay }> = {};
  for (const id of IDS) {
    const L = LIVE[id];
    const one = (lay: any, tall: boolean): Lay => {
      const b = lay.bounds;
      if (b.shape === 'disc') {   // Home: slot units; things and areas scale about the pad
        const k = NEW.homeR / b.r;
        return { bounds: { r: NEW.homeR }, walls: [], spawn: 'matLayout',
          things: lay.things.map((t: any, i: number) => ({ id: L.wide.things[i].id, x: r2(t.x * k), z: r2(t.z * k), yaw: t.yaw, ...(t.use ? { use: [r2(t.x * k + t.use[0] - t.x), r2(t.z * k + t.use[1] - t.z)] } : {}), ...(t.fromN ? { fromN: t.fromN } : {}) })),
          zones: lay.zones.map((z: any, i: number) => ({ id: L.wide.zones[i].id, x: r2(z.x * k), z: r2(z.z * k), r: z.r })), patches: lay.patches.map((z: any, i: number) => ({ id: L.wide.patches[i].id, x: r2(z.x * k), z: r2(z.z * k), r: z.r })) };
      }
      const N = tall ? (id === 'cloudloft' ? NEW.tallCloud : NEW.tall) : NEW.wide, kx = N.hx / b.hx, kz = N.hz / b.hz;
      const sx = (x: number): number => r2(x * kx), sz = (z: number): number => r2(z * kz);
      const things = lay.things.map((t: any, i: number) => {
        const nx = sx(t.x), nz = sz(t.z), o: any = { id: L.wide.things[i].id, x: nx, z: nz, yaw: t.yaw };
        if (t.use) o.use = [r3(nx + t.use[0] - t.x), r3(nz + t.use[1] - t.z)];
        if (t.peek) o.peek = [r3(nx + t.peek[0] - t.x), r3(nz + t.peek[1] - t.z), r3(nx + t.peek[2] - t.x), r3(nz + t.peek[3] - t.z)];
        if (t.push) o.push = [r3(nx + t.push[0] - t.x), r3(nz + t.push[1] - t.z)];
        return o;
      });
      const area = (a: any, i: number, ids: any[]): any => {
        const zid = ids[i].id as string;
        if (a.shape === 'box') {
          // a band or a whole-room area: its half sizes scale with the room, its centre too
          return { id: zid, x: sx(a.x), z: sz(a.z), hx: r2(a.hx * kx), hz: r2(a.hz * kz) };
        }
        // a disc: it follows the thing that stands nearest to it (its owner), keeping its offset and its radius
        let best = -1, bd = 1e9;
        lay.things.forEach((t: any, k: number) => { const d = Math.hypot(t.x - a.x, t.z - a.z); if (d < bd) { bd = d; best = k; } });
        if (best >= 0 && bd < a.r + 0.6) return { id: zid, x: r3(things[best].x + a.x - lay.things[best].x), z: r3(things[best].z + a.z - lay.things[best].z), r: a.r };
        return { id: zid, x: sx(a.x), z: sz(a.z), r: a.r };
      };
      const walls = (lay.walls as any[]).map((w) => {   // a wall stands just outside the new bounds on its own side
        const alongX = w.hx > w.hz;
        return alongX ? { x: 0, z: r3(Math.sign(w.z) * (N.hz + 0.15)), hx: r3(N.hx + 0.3), hz: 0.15 } : { x: r3(Math.sign(w.x) * (N.hx + 0.15)), z: 0, hx: 0.15, hz: r3(N.hz + 0.3) };
      });
      return { bounds: { hx: N.hx, hz: N.hz, round: N.round }, walls, spawn: (lay.spawn as number[][]).map(([x, z]) => [r2(x * 1.25), r2(z * 1.25)]), things,
        zones: lay.zones.map((z: any, i: number) => area(z, i, L.wide.zones)), patches: lay.patches.map((z: any, i: number) => area(z, i, L.wide.patches)), ...(lay.camPitch ? { camPitch: lay.camPitch } : {}) };
    };
    plan[id] = { wide: one(L.wide, false), tall: one(L.tall, true) };
  }
  const lines = ['{'];
  IDS.forEach((id, n) => {
    lines.push(` "${id}": {`);
    (['wide', 'tall'] as const).forEach((k, m) => {
      const l = plan[id][k];
      lines.push(`  "${k}": {`);
      lines.push(`   "bounds": ${JSON.stringify(l.bounds)},${l.camPitch ? ` "camPitch": ${JSON.stringify(l.camPitch)},` : ''}`);
      lines.push(`   "walls": ${JSON.stringify(l.walls)},`);
      lines.push(`   "spawn": ${JSON.stringify(l.spawn)},`);
      lines.push('   "things": [');
      l.things.forEach((t, i) => lines.push(`    ${JSON.stringify(t)}${i < l.things.length - 1 ? ',' : ''}`));
      lines.push('   ],');
      lines.push('   "zones": [');
      l.zones.forEach((t, i) => lines.push(`    ${JSON.stringify(t)}${i < l.zones.length - 1 ? ',' : ''}`));
      lines.push('   ],');
      lines.push('   "patches": [');
      l.patches.forEach((t, i) => lines.push(`    ${JSON.stringify(t)}${i < l.patches.length - 1 ? ',' : ''}`));
      lines.push('   ]');
      lines.push(`  }${m === 0 ? ',' : ''}`);
    });
    lines.push(` }${n < IDS.length - 1 ? ',' : ''}`);
  });
  lines.push('}');
  writeFileSync(PLAN_PATH, lines.join('\n') + '\n');
  console.log('draft plan written:', PLAN_PATH);
}

const num = (v: number): string => String(r3(v));
const areaSrc = (a: any): string => (a.r !== undefined ? `shape: 'disc', x: ${num(a.x)}, z: ${num(a.z)}, r: ${num(a.r)}` : `shape: 'box', x: ${num(a.x)}, z: ${num(a.z)}, hx: ${num(a.hx)}, hz: ${num(a.hz)}`);
const wallsSrc = (ws: any[]): string => `[${ws.map((w) => `{ shape: 'box', x: ${num(w.x)}, z: ${num(w.z)}, hx: ${num(w.hx)}, hz: ${num(w.hz)} }`).join(', ')}]`;
const boundsSrc = (b: any): string => (b.r !== undefined ? `{ shape: 'disc', x: 0, z: 0, r: ${num(b.r)}, round: 0 }` : `{ shape: 'box', x: 0, z: 0, hx: ${num(b.hx)}, hz: ${num(b.hz)}, round: ${num(b.round)} }`);
const spawnSrc = (s: any): string => (s === 'matLayout' ? "'matLayout'" : `[${(s as number[][]).map(([x, z]) => `[${num(x)}, ${num(z)}]`).join(', ')}]`);
const pair = (a: number[]): string => `[${a.map(num).join(', ')}]`;

function apply(only?: string): void {
  const plan = JSON.parse(readFileSync(PLAN_PATH, 'utf8')) as Record<string, { wide: Lay; tall: Lay }>;
  for (const id of IDS) {
    if (only && only !== id) continue;
    const path = resolve(ROOT, `src/data/place_${id}.ts`);
    const src = readFileSync(path, 'utf8'), P = plan[id];
    const cut = src.indexOf('\n  tall: {'), camAt = src.indexOf('\n  camera: {');
    if (cut < 0 || camAt < cut) throw new Error(`${id}: no tall block`);
    let wide = src.slice(0, cut), tall = src.slice(cut, camAt);
    const rest = src.slice(camAt);
    const must = (s: string, re: RegExp, to: string | ((...m: string[]) => string), what: string): string => { if (!re.test(s)) throw new Error(`${id}: ${what} not found (${re.source.slice(0, 80)})`); return s.replace(re, to as never); };
    // ---- wide ----
    for (const t of P.wide.things) {
      const lineRe = new RegExp(`^(\\s*\\{ id: '${t.id}', place: '${id}', mech: [^,]+, )x: [^,]+, z: [^,]+, yaw: [^,]+,(.*)$`, 'm');
      wide = must(wide, lineRe, (_m: string, head: string, tail: string) => {
        let tl = tail;
        if (t.use) tl = tl.replace(/useSpot: \[[^\]]*\]/, `useSpot: ${pair(t.use)}`);
        if (t.peek) tl = tl.replace(/peek: \[[^\]]*\]/, `peek: ${pair(t.peek)}`);
        if (t.push) tl = tl.replace(/push: \[[^\]]*\]/, `push: ${pair(t.push)}`);
        if (t.size) tl = tl.replace(/size: \[[^\]]*\]/, `size: ${pair(t.size)}`);
        if (t.p) for (const [k, v] of Object.entries(t.p as Record<string, number>)) { const re = new RegExp(`\\b${k}: -?[\\d.]+`); if (!re.test(tl)) throw new Error(`${id}: ${t.id} has no p.${k}`); tl = tl.replace(re, `${k}: ${num(v)}`); }
        return `${head}x: ${num(t.x)}, z: ${num(t.z)}, yaw: ${num(t.yaw)},${tl}`;
      }, `thing ${t.id}`);
    }
    for (const z of P.wide.zones) wide = must(wide, new RegExp(`(\\{ id: '${z.id.replace('.', '\\.')}', kind: [^,]+, strength: [^,]+, )shape: '(?:disc|box)', x: [^,]+, z: [^,]+, (?:r: [^,} ]+|hx: [^,]+, hz: [^,} ]+)`), (_m: string, head: string) => `${head}${areaSrc(z)}`, `zone ${z.id}`);
    for (const z of P.wide.patches) wide = must(wide, new RegExp(`(\\{ id: '${z.id}', )shape: '(?:disc|box)', x: [^,]+, z: [^,]+, (?:r: [^,} ]+|hx: [^,]+, hz: [^,} ]+)`), (_m: string, head: string) => `${head}${areaSrc(z)}`, `patch ${z.id}`);
    wide = must(wide, /^(\s*)bounds: \{[^}]*\}, walls: \[.*\],\s*$/m, (_m: string, ind: string) => `${ind}bounds: ${boundsSrc(P.wide.bounds)}, walls: ${wallsSrc(P.wide.walls)},`, 'wide bounds');
    wide = must(wide, /^(\s*pad: \[[^\]]*\], )spawn: (?:'matLayout'|\[.*\]),(.*)$/m, (_m: string, head: string, tail: string) => `${head}spawn: ${spawnSrc(P.wide.spawn)},${tail}`, 'wide spawn');
    // ---- tall ----
    tall = must(tall, /^(\s*)bounds: \{[^}]*\}, walls: \[.*?\],( camPitch: \[[^\]]*\],)?\s*$/m, (_m: string, ind: string) => `${ind}bounds: ${boundsSrc(P.tall.bounds)}, walls: ${wallsSrc(P.tall.walls)},${P.tall.camPitch ? ` camPitch: ${pair(P.tall.camPitch)},` : ''}`, 'tall bounds');
    tall = must(tall, /^(\s*)spawn: (?:'matLayout'|\[.*\]),\s*$/m, (_m: string, ind: string) => `${ind}spawn: ${spawnSrc(P.tall.spawn)},`, 'tall spawn');
    let k = 0;
    tall = tall.replace(/^(\s*)\{ x: [^,]+, z: [^,]+, yaw: [^,}]+(.*)$/gm, (_m: string, ind: string, tail: string) => {
      const t = P.tall.things[k++];
      if (!t) throw new Error(`${id}: more tall spots in the file than in the plan`);
      let tl = tail;
      if (t.use) tl = tl.replace(/use: \[[^\]]*\]/, `use: ${pair(t.use)}`);
      if (t.peek) tl = tl.replace(/peek: \[[^\]]*\]/, `peek: ${pair(t.peek)}`);
      if (t.push) tl = tl.replace(/push: \[[^\]]*\]/, `push: ${pair(t.push)}`);
      return `${ind}{ x: ${num(t.x)}, z: ${num(t.z)}, yaw: ${num(t.yaw)}${tl}`;
    });
    if (k !== P.tall.things.length) throw new Error(`${id}: ${k} tall spots in the file, ${P.tall.things.length} in the plan`);
    tall = must(tall, /^(\s*)zones: \[.*\],\s*$/m, (_m: string, ind: string) => `${ind}zones: [${P.tall.zones.map((z) => `{ ${areaSrc(z)} }`).join(', ')}],`, 'tall zones');
    tall = must(tall, /^(\s*)patches: \[.*\],\s*$/m, (_m: string, ind: string) => `${ind}patches: [${P.tall.patches.map((z) => `{ ${areaSrc(z)} }`).join(', ')}],`, 'tall patches');
    writeFileSync(path, wide + tall + rest);
    console.log(`${id}: written`);
  }
}

const cmd = process.argv[2];
if (cmd === 'draft') draft();
else if (cmd === 'apply') apply(process.argv[3]);
else { console.log('usage: node _harness/rooms_relay.ts draft | apply [place]'); process.exit(2); }
