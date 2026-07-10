// Projectiles, ground residuals, melee hit queries
import * as THREE from 'three';
import { createPool } from './pool.js';
import { angleDiff, ARENA_RADIUS } from './data.js';

export function createCombat(scene) {
  const projectiles = createPool(() => {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.15, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffaa00 })
    );
    mesh.visible = false;
    scene.add(mesh);
    return {
      mesh,
      x: 0,
      y: 0.8,
      z: 0,
      vx: 0,
      vz: 0,
      damage: 0,
      radius: 0.25,
      life: 0,
      team: 'player',
      status: null,
      ground: null,
      aoeOnHit: 0,
      color: 0xffaa00,
      owner: null,
    };
  }, 32);

  const grounds = createPool(() => {
    const mesh = new THREE.Mesh(
      new THREE.CircleGeometry(1, 24),
      new THREE.MeshBasicMaterial({
        color: 0xff4400,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
      })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.visible = false;
    scene.add(mesh);
    return {
      mesh,
      x: 0,
      z: 0,
      radius: 1,
      type: 'fire',
      life: 0,
      dps: 0,
      slow: 0,
      tick: 0,
    };
  }, 16);

  const beams = [];

  function spawnProjectile(opts) {
    const p = projectiles.acquire();
    p.x = opts.x;
    p.y = opts.y ?? 0.9;
    p.z = opts.z;
    p.vx = opts.vx;
    p.vz = opts.vz;
    p.damage = opts.damage;
    p.radius = opts.radius ?? 0.25;
    p.life = opts.lifetime ?? 1.2;
    p.team = opts.team ?? 'player';
    p.status = opts.status || null;
    p.ground = opts.ground || null;
    p.aoeOnHit = opts.aoeOnHit || 0;
    p.color = opts.color ?? 0xffaa00;
    p.owner = opts.owner || null;
    p.mesh.visible = true;
    p.mesh.position.set(p.x, p.y, p.z);
    p.mesh.material.color.setHex(p.color);
    p.mesh.scale.setScalar((opts.radius ?? 0.25) * 4);
    return p;
  }

  function spawnGround(opts) {
    const g = grounds.acquire();
    g.x = opts.x;
    g.z = opts.z;
    g.radius = opts.radius ?? 2;
    g.type = opts.type ?? 'fire';
    g.life = opts.duration ?? 3;
    g.dps = opts.dps ?? 0;
    g.slow = opts.slow ?? 0;
    g.tick = 0;
    g.mesh.visible = true;
    g.mesh.position.set(g.x, 0.06, g.z);
    g.mesh.scale.setScalar(g.radius);
    const col = g.type === 'frost' ? 0x66ccff : g.type === 'void' ? 0xcc44ff : 0xff5522;
    g.mesh.material.color.setHex(col);
    g.mesh.material.opacity = 0.5;
    return g;
  }

  function meleeHitEnemies(enemies, ox, oz, yaw, range, arc, filterFn) {
    const hits = [];
    for (const e of enemies) {
      if (!e.alive) continue;
      if (filterFn && !filterFn(e)) continue;
      const dx = e.x - ox;
      const dz = e.z - oz;
      const dist = Math.hypot(dx, dz);
      if (dist > range + e.radius) continue;
      if (dist < 0.01) {
        hits.push(e);
        continue;
      }
      const ang = Math.atan2(dx, dz);
      if (Math.abs(angleDiff(ang, yaw)) <= arc * 0.5) hits.push(e);
    }
    return hits;
  }

  function aoeHitEnemies(enemies, ox, oz, radius) {
    const hits = [];
    for (const e of enemies) {
      if (!e.alive) continue;
      const dist = Math.hypot(e.x - ox, e.z - oz);
      if (dist <= radius + e.radius) hits.push(e);
    }
    return hits;
  }

  function lineHitEnemies(enemies, ox, oz, yaw, length, width) {
    const hits = [];
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    for (const e of enemies) {
      if (!e.alive) continue;
      const dx = e.x - ox;
      const dz = e.z - oz;
      const along = dx * fx + dz * fz;
      if (along < 0 || along > length) continue;
      const px = dx - fx * along;
      const pz = dz - fz * along;
      const lat = Math.hypot(px, pz);
      if (lat <= width * 0.5 + e.radius) hits.push(e);
    }
    return hits;
  }

  function updateProjectiles(dt, enemies, player, onHit) {
    projectiles.forEachAlive((p) => {
      p.life -= dt;
      p.x += p.vx * dt;
      p.z += p.vz * dt;
      p.mesh.position.set(p.x, p.y, p.z);

      if (p.life <= 0 || Math.hypot(p.x, p.z) > ARENA_RADIUS + 2) {
        p.mesh.visible = false;
        projectiles.release(p);
        return;
      }

      if (p.team === 'player') {
        for (const e of enemies) {
          if (!e.alive) continue;
          if (Math.hypot(e.x - p.x, e.z - p.z) <= p.radius + e.radius) {
            onHit?.(p, e);
            if (p.aoeOnHit > 0) {
              for (const e2 of aoeHitEnemies(enemies, p.x, p.z, p.aoeOnHit)) {
                if (e2 !== e) onHit?.(p, e2, true);
              }
            }
            if (p.ground) {
              spawnGround({
                x: p.x,
                z: p.z,
                ...p.ground,
              });
            }
            p.mesh.visible = false;
            projectiles.release(p);
            return;
          }
        }
      } else if (p.team === 'enemy' && player && player.alive) {
        if (Math.hypot(player.x - p.x, player.z - p.z) <= p.radius + 0.45) {
          onHit?.(p, player);
          p.mesh.visible = false;
          projectiles.release(p);
        }
      }
    });
  }

  function updateGrounds(dt, enemies, player, onGroundTick) {
    grounds.forEachAlive((g) => {
      g.life -= dt;
      g.tick += dt;
      g.mesh.material.opacity = 0.25 + 0.3 * Math.abs(Math.sin(g.life * 4));
      if (g.life <= 0) {
        g.mesh.visible = false;
        grounds.release(g);
        return;
      }
      if (g.tick >= 0.35) {
        g.tick = 0;
        onGroundTick?.(g);
      }
    });
  }

  function spawnBeam(x, z, yaw, length, color, life = 0.25) {
    const geo = new THREE.BoxGeometry(1.2, 0.15, length);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    mesh.position.set(x + fx * length * 0.5, 0.5, z + fz * length * 0.5);
    mesh.rotation.y = yaw;
    scene.add(mesh);
    beams.push({ mesh, life, maxLife: life });
  }

  function updateBeams(dt) {
    for (let i = beams.length - 1; i >= 0; i--) {
      const b = beams[i];
      b.life -= dt;
      b.mesh.material.opacity = (b.life / b.maxLife) * 0.85;
      if (b.life <= 0) {
        scene.remove(b.mesh);
        b.mesh.geometry.dispose();
        b.mesh.material.dispose();
        beams.splice(i, 1);
      }
    }
  }

  function clear() {
    projectiles.forEachAlive((p) => {
      p.mesh.visible = false;
      projectiles.release(p);
    });
    grounds.forEachAlive((g) => {
      g.mesh.visible = false;
      grounds.release(g);
    });
    for (const b of beams) {
      scene.remove(b.mesh);
      b.mesh.geometry.dispose();
      b.mesh.material.dispose();
    }
    beams.length = 0;
  }

  return {
    spawnProjectile,
    spawnGround,
    spawnBeam,
    meleeHitEnemies,
    aoeHitEnemies,
    lineHitEnemies,
    updateProjectiles,
    updateGrounds,
    updateBeams,
    clear,
    get activeGrounds() {
      return grounds.active;
    },
  };
}
