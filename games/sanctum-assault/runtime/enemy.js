// Enemy entities + simple chase AI
import * as THREE from 'three';
import { ENEMY_TYPES, clampToArena, ARENA_RADIUS } from './data.js';
import { createEnemyMesh } from './chars.js';

export function createEnemyManager(scene) {
  const enemies = [];
  let idSeq = 1;
  const _camDir = new THREE.Vector3();

  function spawn(typeId, x, z, scale = 1) {
    const def = ENEMY_TYPES[typeId] || ENEMY_TYPES.grunt;
    const mesh = createEnemyMesh(def);
    mesh.position.set(x, 0, z);
    scene.add(mesh);

    const e = {
      id: idSeq++,
      typeId,
      def,
      mesh,
      x,
      z,
      vx: 0,
      vz: 0,
      yaw: 0,
      hp: def.hp * scale,
      maxHp: def.hp * scale,
      speed: def.speed * (0.95 + Math.random() * 0.1),
      radius: def.radius,
      damage: def.damage,
      attackCd: 0.35 + Math.random() * 0.4,
      attackRange: def.attackRange,
      alive: true,
      spawning: 0,
      // statuses
      shockT: 0,
      burnT: 0,
      burnDps: 0,
      frostT: 0,
      frostSlow: 0,
      hitFlash: 0,
      score: Math.floor(def.score * scale),
      attackTimer: 0,
      _statusTint: null,
    };
    enemies.push(e);
    return e;
  }

  function spawnPortal(typeId, scale, portalColor, onPortal) {
    // Spawn at edge of board with slight jitter
    const a = Math.random() * Math.PI * 2;
    const r = ARENA_RADIUS - 1.2;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;

    // Portal VFX marker
    const portal = new THREE.Mesh(
      new THREE.RingGeometry(0.4, 0.9, 20),
      new THREE.MeshBasicMaterial({
        color: portalColor || 0xff5522,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    portal.rotation.x = -Math.PI / 2;
    portal.position.set(x, 0.15, z);
    scene.add(portal);
    onPortal?.(portal);

    const e = spawn(typeId, x, z, scale);
    e.mesh.scale.setScalar(0.01);
    e.spawning = 0.55;
    return { enemy: e, portal, portalLife: 0.7 };
  }

  function applyDamage(e, amount, opts = {}) {
    if (!e.alive || e.spawning > 0) return 0;
    const dmg = Math.max(1, Math.round(amount));
    e.hp -= dmg;
    e.hitFlash = 0.12;
    if (opts.knockback && opts.kx != null) {
      e.x += opts.kx * opts.knockback * 0.15;
      e.z += opts.kz * opts.knockback * 0.15;
      const c = clampToArena(e.x, e.z);
      e.x = c.x;
      e.z = c.z;
    }
    if (opts.status) {
      applyStatus(e, opts.status, opts.mod || {});
    }
    updateHpBar(e);
    if (e.hp <= 0) {
      e.alive = false;
      e.hp = 0;
      return dmg;
    }
    return dmg;
  }

  function applyStatus(e, status, mod = {}) {
    if (!status) return;
    if (status.type === 'shock') {
      const dur = (status.duration || 1) * (mod.shockDuration || 1);
      e.shockT = Math.max(e.shockT, dur);
    } else if (status.type === 'burn') {
      e.burnT = Math.max(e.burnT, status.duration || 2);
      e.burnDps = status.dps || 6;
    } else if (status.type === 'frost') {
      const dur = (status.duration || 2) * (mod.frostDuration || 1);
      e.frostT = Math.max(e.frostT, dur);
      e.frostSlow = (status.slow || 0.5) * (mod.frostSlow || 1);
    }
  }

  function updateHpBar(e) {
    const bar = e.mesh.userData.hpBar;
    if (!bar) return;
    const pct = Math.max(0, e.hp / e.maxHp);
    bar.scale.x = Math.max(0.01, pct);
    bar.position.x = -0.43 * (1 - pct);
    bar.material.color.setHex(pct > 0.5 ? 0x4ade80 : pct > 0.25 ? 0xfbbf24 : 0xe63946);
  }

  function separateEnemies() {
    // Soft push so packs don't fully stack on one pixel
    const n = enemies.length;
    for (let i = 0; i < n; i++) {
      const a = enemies[i];
      if (!a.alive || a.spawning > 0) continue;
      for (let j = i + 1; j < n; j++) {
        const b = enemies[j];
        if (!b.alive || b.spawning > 0) continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const dist = Math.hypot(dx, dz);
        const minD = a.radius + b.radius + 0.08;
        if (dist < 0.001) {
          const ang = (a.id + b.id) * 0.7;
          a.x -= Math.cos(ang) * 0.05;
          a.z -= Math.sin(ang) * 0.05;
          b.x += Math.cos(ang) * 0.05;
          b.z += Math.sin(ang) * 0.05;
          continue;
        }
        if (dist < minD) {
          const push = (minD - dist) * 0.45;
          const nx = dx / dist;
          const nz = dz / dist;
          a.x -= nx * push * 0.5;
          a.z -= nz * push * 0.5;
          b.x += nx * push * 0.5;
          b.z += nz * push * 0.5;
        }
      }
    }
  }

  function applyStatusVisuals(e) {
    // Priority: shock > burn > frost > default/elite
    let tint = null;
    let ei = e.def.elite ? 0.35 : 0.1;
    if (e.shockT > 0) {
      tint = 0x88ddff;
      ei = 0.95 + Math.sin(performance.now() * 0.05) * 0.25;
    } else if (e.burnT > 0) {
      tint = 0xff5522;
      ei = 0.55;
    } else if (e.frostT > 0) {
      tint = 0xaaddff;
      ei = 0.4;
    }
    if (e.hitFlash > 0) ei = Math.max(ei, 0.85);

    // Skip work only when fully idle and already at baseline
    const key = `${tint || 0}|${e.hitFlash > 0 ? 1 : 0}|${e.shockT > 0 ? 1 : 0}`;
    if (key === e._statusKey && e.hitFlash <= 0 && e.shockT <= 0 && !tint) return;
    // Always refresh while flashing / shocked (animated intensity)
    if (key === e._statusKey && e.hitFlash <= 0 && e.shockT <= 0) return;
    e._statusKey = key;
    e._statusTint = tint;

    e.mesh.traverse((o) => {
      if (!o.isMesh || !o.material || !o.material.emissive) return;
      if (o === e.mesh.userData.hpBar || o === e.mesh.userData.hpBarBg) return;
      if (tint) {
        o.material.emissive.setHex(tint);
        o.material.emissiveIntensity = ei;
      } else {
        o.material.emissive.setHex(e.def.accent || 0x000000);
        o.material.emissiveIntensity = e.def.elite ? 0.35 : 0.1;
      }
    });
  }

  function billboardHp(e, camera) {
    const bar = e.mesh.userData.hpBar;
    const bg = e.mesh.userData.hpBarBg;
    if (!bar || !bg || !camera) return;
    // Yaw-only billboard in local space (keeps bars upright and readable)
    _camDir.subVectors(camera.position, e.mesh.position);
    _camDir.y = 0;
    if (_camDir.lengthSq() < 0.01) return;
    const worldYaw = Math.atan2(_camDir.x, _camDir.z);
    const localYaw = worldYaw - e.yaw;
    bar.rotation.set(0, localYaw, 0);
    bg.rotation.set(0, localYaw, 0);
  }

  function update(dt, player, combat, audio, events, camera) {
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];

      // Spawn scale-in
      if (e.spawning > 0) {
        e.spawning -= dt;
        const t = 1 - Math.max(0, e.spawning) / 0.55;
        e.mesh.scale.setScalar(Math.max(0.01, t));
        if (e.spawning <= 0) e.mesh.scale.setScalar(1);
      }

      if (!e.alive) {
        // death pop
        if (e.deathT == null) e.deathT = 0.35;
        e.mesh.scale.multiplyScalar(0.85);
        e.deathT -= dt;
        if (e.deathT <= 0) {
          scene.remove(e.mesh);
          enemies.splice(i, 1);
        }
        continue;
      }

      // Statuses
      if (e.shockT > 0) e.shockT -= dt;
      if (e.frostT > 0) e.frostT -= dt;
      if (e.burnT > 0) {
        e.burnT -= dt;
        e._burnAcc = (e._burnAcc || 0) + dt;
        if (e._burnAcc >= 0.4) {
          e._burnAcc = 0;
          // Allow burn tick even mid-status (bypass spawning gate by direct hp)
          if (e.spawning <= 0) {
            applyDamage(e, e.burnDps * 0.4, { fromStatus: true });
            events.onBurnTick?.(e);
            if (!e.alive) {
              events.onDeath?.(e);
              continue;
            }
          }
        }
      }

      if (e.hitFlash > 0) e.hitFlash -= dt;
      applyStatusVisuals(e);

      // AI frozen while shocked or spawning
      const stunned = e.shockT > 0;
      let speedMul = 1;
      if (e.frostT > 0) speedMul *= Math.max(0.25, 1 - e.frostSlow);

      if (!stunned && player && player.alive && e.spawning <= 0) {
        const dx = player.x - e.x;
        const dz = player.z - e.z;
        const dist = Math.hypot(dx, dz) || 1;
        e.yaw = Math.atan2(dx, dz);

        if (e.def.ranged) {
          if (dist > e.attackRange * 0.7) {
            e.x += (dx / dist) * e.speed * speedMul * dt;
            e.z += (dz / dist) * e.speed * speedMul * dt;
          } else if (dist < e.attackRange * 0.45) {
            e.x -= (dx / dist) * e.speed * 0.6 * speedMul * dt;
            e.z -= (dz / dist) * e.speed * 0.6 * speedMul * dt;
          }
          e.attackCd -= dt;
          if (e.attackCd <= 0 && dist <= e.attackRange) {
            e.attackCd = e.def.attackCd;
            const sp = e.def.projectileSpeed || 12;
            combat.spawnProjectile({
              x: e.x,
              z: e.z,
              y: 1.0,
              vx: (dx / dist) * sp,
              vz: (dz / dist) * sp,
              damage: e.def.projectileDamage || 1,
              radius: 0.28,
              lifetime: 2,
              team: 'enemy',
              color: e.def.accent,
            });
            audio.play('magic');
          }
        } else {
          if (dist > e.attackRange * 0.85) {
            e.x += (dx / dist) * e.speed * speedMul * dt;
            e.z += (dz / dist) * e.speed * speedMul * dt;
          }
          e.attackCd -= dt;
          if (dist <= e.attackRange && e.attackCd <= 0) {
            e.attackCd = e.def.attackCd;
            events.onMeleeHit?.(e, player);
          }
        }
      }
    }

    separateEnemies();

    for (const e of enemies) {
      if (!e.alive) continue;
      const c = clampToArena(e.x, e.z);
      e.x = c.x;
      e.z = c.z;
      const bob = e.shockT > 0 ? Math.sin(performance.now() * 0.04) * 0.05 : 0;
      const frostSink = e.frostT > 0 ? -0.04 : 0;
      e.mesh.position.set(e.x, bob + frostSink, e.z);
      e.mesh.rotation.y = e.yaw;
      // slight scale pulse while shocked for readability
      if (e.spawning <= 0) {
        const pulse = e.shockT > 0 ? 1 + Math.sin(performance.now() * 0.03) * 0.04 : 1;
        e.mesh.scale.setScalar(pulse);
      }
      billboardHp(e, camera);
    }
  }

  function aliveCount() {
    return enemies.filter((e) => e.alive).length;
  }

  function clear() {
    for (const e of enemies) scene.remove(e.mesh);
    enemies.length = 0;
  }

  return {
    enemies,
    spawn,
    spawnPortal,
    applyDamage,
    applyStatus,
    update,
    aliveCount,
    clear,
  };
}
