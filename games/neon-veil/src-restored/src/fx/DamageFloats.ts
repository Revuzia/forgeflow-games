import * as THREE from 'three';

export type DmgFloatKind = 'deal' | 'take' | 'crit' | 'shield' | 'heal' | 'kill';

interface FloatEntry {
  el: HTMLDivElement;
  world: THREE.Vector3;
  life: number;
  maxLife: number;
  vy: number;
  jitterX: number;
}

/**
 * Floating combat numbers projected from world → screen.
 * Cyan = you hit them; red = you took damage; gold = crit; pink = kill.
 */
export class DamageFloats {
  private layer: HTMLElement;
  private pool: HTMLDivElement[] = [];
  private active: FloatEntry[] = [];
  private tmp = new THREE.Vector3();

  constructor(layerId = 'dmg-floats') {
    let layer = document.getElementById(layerId);
    if (!layer) {
      layer = document.createElement('div');
      layer.id = layerId;
      const hud = document.getElementById('hud');
      if (hud) hud.appendChild(layer);
      else document.body.appendChild(layer);
    }
    this.layer = layer;
    for (let i = 0; i < 40; i++) {
      const el = document.createElement('div');
      el.className = 'dmg-float hidden';
      this.layer.appendChild(el);
      this.pool.push(el);
    }
  }

  spawn(worldPos: THREE.Vector3, amount: number, kind: DmgFloatKind = 'deal'): void {
    const n = Math.max(1, Math.round(amount));
    if (n <= 0 && kind !== 'kill') return;

    const el = this.acquireEl();
    if (!el) return;

    el.className = `dmg-float dmg-${kind}`;
    if (kind === 'kill') el.textContent = 'DOWNED';
    else if (kind === 'heal') el.textContent = `+${n}`;
    else el.textContent = `−${n}`;
    el.classList.remove('hidden');

    this.active.push({
      el,
      world: worldPos.clone(),
      life: kind === 'kill' ? 1.1 : 0.85,
      maxLife: kind === 'kill' ? 1.1 : 0.85,
      vy: 28 + Math.random() * 18,
      jitterX: (Math.random() - 0.5) * 24,
    });
  }

  private acquireEl(): HTMLDivElement | null {
    const fromPool = this.pool.pop();
    if (fromPool) return fromPool;
    const old = this.active.shift();
    if (!old) return null;
    old.el.className = 'dmg-float hidden';
    old.el.style.opacity = '0';
    return old.el;
  }

  update(dt: number, camera: THREE.Camera, width: number, height: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const f = this.active[i];
      f.life -= dt;
      f.world.y += f.vy * dt * 0.02;

      this.tmp.copy(f.world).project(camera);
      const onScreen =
        this.tmp.z > -1 && this.tmp.z < 1 && Math.abs(this.tmp.x) < 1.2 && Math.abs(this.tmp.y) < 1.2;
      if (!onScreen || f.life <= 0) {
        this.active.splice(i, 1);
        f.el.className = 'dmg-float hidden';
        f.el.style.opacity = '0';
        this.pool.push(f.el);
        continue;
      }

      const x = (this.tmp.x * 0.5 + 0.5) * width + f.jitterX;
      const y = (-this.tmp.y * 0.5 + 0.5) * height;
      const t = 1 - f.life / f.maxLife;
      const rise = t * 36;
      const big = f.el.classList.contains('dmg-crit') || f.el.classList.contains('dmg-kill');
      const scale = (big ? 1.25 : 1) * (1 + (big ? 0.12 * (1 - t) : 0));
      const opacity = t < 0.15 ? t / 0.15 : Math.max(0, 1 - (t - 0.15) / 0.85);

      f.el.style.transform = `translate(-50%, -50%) translate(${x}px, ${y - rise}px) scale(${scale})`;
      f.el.style.opacity = String(opacity);
    }
  }

  clear(): void {
    while (this.active.length) {
      const f = this.active.pop()!;
      f.el.className = 'dmg-float hidden';
      f.el.style.opacity = '0';
      this.pool.push(f.el);
    }
  }
}
