import { SoftBody, speciesTemplateGenome, quantizeGenome } from './attack_lib.ts';
const t = speciesTemplateGenome('twangle');
for (const [n, g] of [['tmpl', t], ['soft', quantizeGenome({ ...t, firmness: 0, bounce: 1, stretch: 1, size: 1 })]] as any) {
  const b: any = new SoftBody(g);
  for (let i = 0; i < 30; i++) b.step(1 / 60);
  const R = b.restRadius, h = b.raycast({ x: b.center.x + 4 * R, y: b.center.y, z: b.center.z }, { x: -1, y: 0, z: 0 });
  for (const dist of [0.5, 1.0, 2.0, 3.0]) {
    const c: any = new SoftBody(g); for (let i = 0; i < 30; i++) c.step(1 / 60);
    c.grab(0, h.vertex, h.point);
    for (let k = 0; k < 60; k++) { c.grabMove(0, { x: h.point.x + dist * R * Math.min(1, k / 30), y: h.point.y, z: h.point.z }); c.step(1 / 60); }
    c.grabRelease(0); const ev: any[] = []; c.step(1 / 60); c.drainEvents(ev);
    console.log(n, 'stretch gene', g.stretch, 'maxPull R', c.params.maxPull.toFixed(3), 'pull', dist, 'R -> snap', ev.filter((e: any) => e.kind === 'snap').map((e: any) => e.intensity.toFixed(3)).join(','), 'stretch metric', c.metrics.stretch.toFixed(3));
  }
}
