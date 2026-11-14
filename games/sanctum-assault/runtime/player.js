// Player champion — movement, facing, abilities, block, warrior mode swap
import * as THREE from 'three';
import { CLASSES, clampToArena, ARENA_RADIUS, HEAL_GOLD_COST } from './data.js';
import { createChampionMesh, equipWeapons, animateWalker, pulseAttackPose } from './chars.js';

export function createPlayer(scene) {
  let mesh = null;
  let classDef = null;
  let modeId = 'twohand';
  let kit = null;

  const p = {
    alive: false,
    x: 0,
    z: 0,
    yaw: 0,
    hp: 5,
    maxHp: 5,
    gold: 0,
    speed: 6,
    classId: 'warrior',
    modeId: 'twohand',
    // cooldowns per slot 0=basic, 1,2,3 — persist across mode swap
    cd: [0, 0, 0, 0],
    cdMax: [0.3, 1, 1, 1],
    blocking: false,
    bulwarkT: 0,
    wardT: 0,
    damageReduce: 0,
    invulnT: 0,
    attackAnim: 0,
    rainT: 0,
    rain: null,
    whirlT: 0,
    whirl: null,
  };

  function getKit() {
    if (!classDef) {
      return { id: 'default', basic: { cooldown: 0.3, damage: 10 }, abilities: [], canBlock: false };
    }
    if (classDef.dualMode) {
      return classDef.modes[modeId] || classDef.modes.twohand;
    }
    return {
      id: 'default',
      basic: classDef.basic,
      abilities: classDef.abilities,
      canBlock: false,
    };
  }

  function syncCdMax() {
    kit = getKit();
    p.cdMax[0] = kit.basic.cooldown;
    for (let i = 0; i < 3; i++) {
      p.cdMax[i + 1] = kit.abilities[i]?.cooldown ?? 1;
    }
  }

  function spawn(classId, startMode = 'twohand') {
    clear();
    classDef = CLASSES[classId] || CLASSES.warrior;
    p.classId = classDef.id;
    modeId = classDef.dualMode ? startMode : 'default';
    p.modeId = modeId;
    p.maxHp = classDef.maxHp;
    p.hp = classDef.maxHp;
    p.speed = classDef.speed;
    p.x = 0;
    p.z = 0;
    p.yaw = 0;
    p.alive = true;
    p.gold = 0;
    p.cd = [0, 0, 0, 0];
    p.blocking = false;
    p.bulwarkT = 0;
    p.wardT = 0;
    p.damageReduce = 0;
    p.invulnT = 0;
    p.attackAnim = 0;
    p.rainT = 0;
    p.rain = null;
    p.whirlT = 0;
    p.whirl = null;

    mesh = createChampionMesh(classDef.id, classDef.accent);
    mesh.position.set(0, 0, 0);
    scene.add(mesh);
    equipWeapons(mesh, classDef.id, modeId === 'default' ? null : modeId);
    syncCdMax();
    return p;
  }

  function swapMode(audio, fx) {
    if (!classDef?.dualMode || !p.alive) return false;
    modeId = modeId === 'twohand' ? 'shield' : 'twohand';
    p.modeId = modeId;
    equipWeapons(mesh, classDef.id, modeId);
    syncCdMax();
    // short equip flash
    p.invulnT = Math.max(p.invulnT, 0.12);
    fx?.ringBurst(p.x, p.z, 0xf0c14b, 1.5);
    fx?.callout(modeId === 'twohand' ? 'TWO-HANDED' : 'SWORD & SHIELD');
    audio?.play('mode');
    return true;
  }

  function aimFromInput(input, raycastAim, enemies) {
    if (raycastAim) {
      const dx = raycastAim.x - p.x;
      const dz = raycastAim.z - p.z;
      if (Math.hypot(dx, dz) > 0.2) {
        p.yaw = Math.atan2(dx, dz);
        return;
      }
    }
    if (Math.hypot(input.aimX, input.aimZ) > 0.15) {
      p.yaw = Math.atan2(input.aimX, input.aimZ);
      return;
    }
    if (Math.hypot(input.moveX, input.moveZ) > 0.15) {
      p.yaw = Math.atan2(input.moveX, input.moveZ);
      return;
    }
    // Idle: gently face nearest enemy so attacks still land
    if (enemies && enemies.length) {
      const near = nearestEnemy(enemies, 14);
      if (near) p.yaw = Math.atan2(near.x - p.x, near.z - p.z);
    }
  }

  function takeDamage(amount, opts = {}) {
    if (!p.alive || p.invulnT > 0) return 0;
    kit = getKit();
    if (p.blocking && kit?.canBlock) {
      opts.onBlock?.();
      p.invulnT = 0.15;
      return 0;
    }
    // Bulwark / Arcane Ward must actually mitigate 1-heart hits (allow full block to 0).
    const wardActive = p.wardT > 0;
    const dr = Math.max(p.damageReduce, p.bulwarkT > 0 ? 0.55 : 0, wardActive ? 0.65 : 0);
    let dmg = Math.round(amount * (1 - dr));
    if (wardActive) {
      // Arcane Ward: reflect pulse damage to nearby foes
      const reflectFrac =
        kit?.abilities?.find((a) => a.id === 'arcane_ward')?.reflect ?? 0.25;
      opts.onReflect?.(Math.max(1, Math.round(amount * 8 * reflectFrac)));
    }
    if (dmg <= 0) {
      p.invulnT = 0.25;
      if (wardActive) opts.onWardBlock?.();
      return 0;
    }
    p.hp -= dmg;
    p.invulnT = 0.7;
    if (p.hp <= 0) {
      p.hp = 0;
      p.alive = false;
    }
    return dmg;
  }

  /** Spend gold to restore 1 heart. Returns true if healed. */
  function tryHeal(cost = HEAL_GOLD_COST) {
    if (!p.alive || p.hp >= p.maxHp || p.gold < cost) return false;
    p.gold -= cost;
    p.hp = Math.min(p.maxHp, p.hp + 1);
    return true;
  }

  function nearestEnemy(enemies, maxRange = 16) {
    let best = null;
    let bestD = maxRange;
    for (const e of enemies) {
      if (!e.alive || e.spawning > 0) continue;
      const d = Math.hypot(e.x - p.x, e.z - p.z);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  function tryBasic(combat, enemies, fx, audio, onHitEnemy) {
    if (p.cd[0] > 0 || !p.alive) return false;
    kit = getKit();
    const b = kit.basic;
    p.cd[0] = b.cooldown;
    p.attackAnim = 0.2;
    audio.play(b.projectile ? (p.classId === 'mage' ? 'magic' : 'shoot') : 'swing');

    if (b.projectile) {
      const sp = b.speed || 24;
      const fx_ = Math.sin(p.yaw);
      const fz_ = Math.cos(p.yaw);
      combat.spawnProjectile({
        x: p.x + fx_ * 0.6,
        z: p.z + fz_ * 0.6,
        vx: fx_ * sp,
        vz: fz_ * sp,
        damage: b.damage,
        radius: b.radius,
        lifetime: b.lifetime,
        color: b.color || (p.classId === 'archer' ? 0xe67e22 : 0xc084fc),
        status: b.status,
        ground: b.ground,
        aoeOnHit: b.aoeOnHit,
        team: 'player',
      });
      return true;
    }

    // Melee — small crit chance for juice
    const crit = Math.random() < 0.12;
    const dmg = crit ? Math.floor(b.damage * 1.6) : b.damage;
    fx.slashArc(p.x, p.z, p.yaw, crit ? 0xff6b35 : 0xffcc66, b.range);
    const hits = combat.meleeHitEnemies(enemies, p.x, p.z, p.yaw, b.range, b.arc || Math.PI * 0.8);
    for (const e of hits) {
      const kx = Math.sin(p.yaw);
      const kz = Math.cos(p.yaw);
      onHitEnemy(e, dmg, {
        knockback: (b.knockback || 0) * (crit ? 1.25 : 1),
        kx,
        kz,
        hitstop: (b.hitstop || 0.04) * (crit ? 1.5 : 1),
        crit,
      });
    }
    if (hits.length) {
      fx.addShake(crit ? 0.14 : 0.08, crit ? 0.14 : 0.1);
    }
    return true;
  }

  function tryAbility(slot, combat, enemies, fx, audio, arenaMod, onHitEnemy, aimPoint) {
    if (!p.alive || slot < 1 || slot > 3) return false;
    if (p.cd[slot] > 0) return false;
    kit = getKit();
    const ab = kit.abilities[slot - 1];
    if (!ab) return false;
    p.cd[slot] = ab.cooldown;
    fx.callout(ab.name.toUpperCase());
    audio.play(ab.projectile ? 'magic' : ab.id.includes('shield') ? 'block' : 'explosion');

    const fxDir = Math.sin(p.yaw);
    const fzDir = Math.cos(p.yaw);

    // Projectile abilities
    if (ab.projectile) {
      const count = ab.count || 1;
      const spread = ab.spread || 0;
      for (let i = 0; i < count; i++) {
        const t = count === 1 ? 0 : (i / (count - 1) - 0.5) * spread;
        const yaw = p.yaw + t;
        const sp = ab.speed || 20;
        combat.spawnProjectile({
          x: p.x + Math.sin(yaw) * 0.5,
          z: p.z + Math.cos(yaw) * 0.5,
          vx: Math.sin(yaw) * sp,
          vz: Math.cos(yaw) * sp,
          damage: ab.damage,
          radius: ab.radius,
          lifetime: ab.lifetime,
          color: ab.color || 0xff8844,
          status: ab.status,
          ground: ab.ground
            ? {
                ...ab.ground,
                duration:
                  ab.ground.duration *
                  (ab.ground.type === 'frost'
                    ? arenaMod.frostDuration || 1
                    : arenaMod.fireDuration || 1),
                dps: (ab.ground.dps || 0) * (arenaMod.fireDps || 1),
                slow: (ab.ground.slow || 0) * (arenaMod.frostSlow || 1),
              }
            : null,
          aoeOnHit: ab.aoeOnHit,
          team: 'player',
        });
      }
      return true;
    }

    if (ab.id === 'whirlwind') {
      p.whirlT = ab.duration;
      p.whirl = ab;
      fx.ringBurst(p.x, p.z, 0xff6b35, ab.range);
      return true;
    }

    if (ab.id === 'ground_slam') {
      fx.ringBurst(p.x, p.z, 0xf0c14b, ab.range);
      fx.addShake(0.25, 0.2);
      fx.addHitstop(ab.hitstop || 0.08);
      audio.play('explosion');
      const hits = combat.aoeHitEnemies(enemies, p.x, p.z, ab.range);
      for (const e of hits) {
        const dx = e.x - p.x;
        const dz = e.z - p.z;
        const d = Math.hypot(dx, dz) || 1;
        onHitEnemy(e, ab.damage, { knockback: ab.knockback, kx: dx / d, kz: dz / d, hitstop: 0.05 });
      }
      return true;
    }

    if (ab.id === 'earthsplitter') {
      combat.spawnBeam(p.x, p.z, p.yaw, ab.range, 0xff8844, 0.3);
      fx.addShake(0.2, 0.15);
      const hits = combat.lineHitEnemies(enemies, p.x, p.z, p.yaw, ab.range, ab.width);
      for (const e of hits) {
        onHitEnemy(e, ab.damage, {
          knockback: ab.knockback,
          kx: fxDir,
          kz: fzDir,
        });
      }
      return true;
    }

    if (ab.id === 'frontal_swipe' || ab.id === 'shield_bash') {
      fx.slashArc(p.x, p.z, p.yaw, ab.status?.type === 'shock' ? 0x88ddff : 0xffcc66, ab.range);
      if (ab.status?.type === 'shock') {
        audio.play('shock');
        fx.shockBurst(p.x + fxDir * 1.2, 1, p.z + fzDir * 1.2, arenaMod.shockVfx || 1);
      }
      const hits = combat.meleeHitEnemies(enemies, p.x, p.z, p.yaw, ab.range, ab.arc || Math.PI);
      for (const e of hits) {
        onHitEnemy(e, ab.damage, {
          knockback: ab.knockback,
          kx: fxDir,
          kz: fzDir,
          status: ab.status
            ? { ...ab.status, duration: ab.status.duration * (arenaMod.shockDuration || 1) }
            : null,
        });
      }
      return true;
    }

    if (ab.id === 'bulwark') {
      p.bulwarkT = ab.duration;
      fx.ringBurst(p.x, p.z, 0x66aaff, 2);
      fx.callout('BULWARK');
      return true;
    }

    if (ab.id === 'arcane_ward') {
      p.wardT = ab.duration;
      fx.ringBurst(p.x, p.z, 0xc084fc, 2.2);
      return true;
    }

    if (ab.id === 'rain_of_arrows') {
      let tx = p.x + fxDir * 5;
      let tz = p.z + fzDir * 5;
      if (aimPoint) {
        tx = aimPoint.x;
        tz = aimPoint.z;
      }
      const c = clampToArena(tx, tz, ARENA_RADIUS - 1);
      p.rainT = ab.duration;
      p.rain = { ...ab, x: c.x, z: c.z, tick: 0 };
      fx.ringBurst(c.x, c.z, 0xe67e22, ab.radius);
      return true;
    }

    return true;
  }

  function update(dt, input, combat, enemies, fx, audio, arenaMod, aimPoint, onHitEnemy) {
    if (!p.alive || !mesh) return;

    // CDs
    for (let i = 0; i < 4; i++) {
      if (p.cd[i] > 0) p.cd[i] = Math.max(0, p.cd[i] - dt);
    }
    if (p.invulnT > 0) p.invulnT -= dt;
    if (p.bulwarkT > 0) p.bulwarkT -= dt;
    if (p.wardT > 0) p.wardT -= dt;
    if (p.attackAnim > 0) p.attackAnim -= dt;

    kit = getKit();
    p.blocking = !!(input.block && kit.canBlock && modeId === 'shield');

    // Movement
    let mx = input.moveX;
    let mz = input.moveZ;
    if (p.blocking) {
      mx *= 0.45;
      mz *= 0.45;
    }
    const moving = Math.hypot(mx, mz) > 0.05;
    if (moving) {
      p.x += mx * p.speed * dt;
      p.z += mz * p.speed * dt;
    }
    const c = clampToArena(p.x, p.z);
    p.x = c.x;
    p.z = c.z;

    aimFromInput(input, aimPoint, enemies);

    // Mode swap
    if (input.modeSwap) swapMode(audio, fx);

    // Spend gold for heal (H key or UI flag)
    if (input.heal) {
      if (tryHeal()) {
        fx.ringBurst(p.x, p.z, 0x66ff99, 1.4);
        fx.statusText(p.x, 1.2, p.z, '+❤', '#6f6');
        audio.play('ui');
      }
    }

    // Attacks
    if (input.attack || input.attackHeld) {
      tryBasic(combat, enemies, fx, audio, onHitEnemy);
    }
    if (input.ability1) tryAbility(1, combat, enemies, fx, audio, arenaMod, onHitEnemy, aimPoint);
    if (input.ability2) tryAbility(2, combat, enemies, fx, audio, arenaMod, onHitEnemy, aimPoint);
    if (input.ability3) tryAbility(3, combat, enemies, fx, audio, arenaMod, onHitEnemy, aimPoint);

    // Whirlwind ticks
    if (p.whirlT > 0 && p.whirl) {
      p.whirlT -= dt;
      p._whirlAcc = (p._whirlAcc || 0) + dt;
      const interval = p.whirl.duration / p.whirl.ticks;
      if (p._whirlAcc >= interval) {
        p._whirlAcc = 0;
        fx.ringBurst(p.x, p.z, 0xff6b35, p.whirl.range * 0.8);
        const hits = combat.aoeHitEnemies(enemies, p.x, p.z, p.whirl.range);
        for (const e of hits) {
          onHitEnemy(e, p.whirl.damage, { knockback: 1.5, kx: e.x - p.x, kz: e.z - p.z });
        }
      }
    }

    // Rain of arrows
    if (p.rainT > 0 && p.rain) {
      p.rainT -= dt;
      p.rain.tick += dt;
      const interval = p.rain.duration / p.rain.ticks;
      if (p.rain.tick >= interval) {
        p.rain.tick = 0;
        fx.spawnParticles(p.rain.x, 2, p.rain.z, 0xe67e22, 8, 2);
        const hits = combat.aoeHitEnemies(enemies, p.rain.x, p.rain.z, p.rain.radius);
        for (const e of hits) onHitEnemy(e, p.rain.damage, {});
      }
    }

    // Visuals
    mesh.position.set(p.x, 0, p.z);
    mesh.rotation.y = p.yaw;
    animateWalker(mesh, dt, moving);
    if (p.attackAnim > 0) pulseAttackPose(mesh, 1 - p.attackAnim / 0.2);

    // Invuln blink
    mesh.visible = p.invulnT <= 0 || Math.floor(p.invulnT * 12) % 2 === 0;

    // Ward / bulwark tint
    if (mesh.userData.torso) {
      mesh.userData.torso.material.emissiveIntensity =
        p.wardT > 0 ? 0.6 : p.bulwarkT > 0 ? 0.4 : 0.05;
    }
  }

  function clear() {
    if (mesh) {
      scene.remove(mesh);
      mesh = null;
    }
    p.alive = false;
  }

  function getAbilityLabels() {
    kit = getKit();
    return {
      basic: kit.basic,
      abilities: kit.abilities,
      canBlock: !!kit.canBlock,
      modeLabel: classDef?.dualMode ? (modeId === 'twohand' ? '2H' : 'S&S') : null,
      dualMode: !!classDef?.dualMode,
    };
  }

  return {
    p,
    spawn,
    swapMode,
    update,
    takeDamage,
    tryHeal,
    clear,
    getAbilityLabels,
    get mesh() {
      return mesh;
    },
    get kit() {
      return getKit();
    },
  };
}
