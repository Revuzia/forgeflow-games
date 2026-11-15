// Game loop, state machine, orchestration
import * as THREE from 'three';
import {
  ARENAS,
  CLASSES,
  WAVES_PER_ARENA,
  getWaveDef,
  comboMultiplier,
  HEAL_GOLD_COST,
  CAMPAIGN_PROGRESS_KEY,
} from './data.js';
import { createArenaSystem } from './arena.js';
import { createCombat } from './combat.js';
import { createEnemyManager } from './enemy.js';
import { createPlayer } from './player.js';
import { createFX } from './fx.js';
import { createUI } from './ui.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';

const State = {
  MENU: 'menu',
  CLASS: 'class',
  ARENA: 'arena',
  PLAYING: 'playing',
  WAVE_CLEAR: 'wave_clear',
  PAUSED: 'paused',
  RESULT: 'result',
};

export function createGame(engine) {
  const { scene, camera, renderer, container } = engine;
  const audio = createAudio();
  const input = createInput(container);
  const arenaSys = createArenaSystem(scene);
  const combat = createCombat(scene);
  const enemies = createEnemyManager(scene);
  const player = createPlayer(scene);
  const fx = createFX(scene, camera, renderer);

  // Aim raycaster
  const raycaster = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const aimHit = new THREE.Vector3();

  // Camera
  const camOffset = new THREE.Vector3(0, 22, 16);
  const camTarget = new THREE.Vector3();
  const camPos = new THREE.Vector3();

  // Run state
  let state = State.MENU;
  let campaign = true;
  let arenaIndex = 0;
  let classId = 'warrior';
  let waveIndex = 0;
  let score = 0;
  let comboKills = 0;
  let comboTimer = 0;
  let spawnQueue = [];
  let spawnTimer = 0;
  let waveActive = false;
  let waveClearTimer = 0;
  let portals = [];
  let restTimer = 0;

  const ui = createUI({
    onCampaign() {
      audio.play('ui');
      campaign = true;
      arenaIndex = 0;
      state = State.CLASS;
      ui.showClassSelect();
    },
    onArenaSelectMenu() {
      audio.play('ui');
      campaign = false;
      state = State.CLASS;
      ui.showClassSelect();
    },
    onClassPick(id) {
      audio.play('ui');
      classId = id;
      if (campaign) {
        startRun(0);
      } else {
        state = State.ARENA;
        ui.showArenaSelect();
      }
    },
    onArenaPick(i) {
      audio.play('ui');
      startRun(i);
    },
    onBackMenu() {
      audio.play('ui');
      state = State.MENU;
      ui.showMenu();
    },
    onBackClass() {
      audio.play('ui');
      state = State.CLASS;
      ui.showClassSelect();
    },
    onResume() {
      if (state === State.PAUSED) {
        state = State.PLAYING;
        ui.hidePause();
      }
    },
    onQuitMenu() {
      audio.play('ui');
      endToMenu();
    },
    onRestart() {
      audio.play('ui');
      startRun(arenaIndex);
    },
    onNextArena() {
      audio.play('ui');
      if (arenaIndex < ARENAS.length - 1) {
        // Campaign: keep cumulative score + gold across realm boards
        startRun(arenaIndex + 1, { keepScore: true });
      } else {
        endToMenu();
      }
    },
  });

  function endToMenu() {
    cleanupPlay();
    state = State.MENU;
    ui.showMenu();
    // soft menu backdrop: ember board
    arenaSys.build(0);
  }

  function cleanupPlay() {
    player.clear();
    enemies.clear();
    combat.clear();
    fx.clear();
    for (const p of portals) {
      scene.remove(p.mesh);
    }
    portals = [];
    spawnQueue = [];
  }

  function startRun(aIndex, opts = {}) {
    const keepScore = !!opts.keepScore;
    const prevScore = score;
    const prevGold = player.p?.gold || 0;
    const prevHp = player.p?.hp || 0;
    const prevMax = player.p?.maxHp || 0;

    cleanupPlay();
    arenaIndex = aIndex;
    waveIndex = 0;
    score = keepScore ? prevScore : 0;
    comboKills = 0;
    comboTimer = 0;
    waveActive = false;
    restTimer = 1.2;

    arenaSys.build(arenaIndex);
    player.spawn(classId);
    if (keepScore) {
      // Campaign continuity: carry gold + remaining HP (at least 1 if still alive)
      player.p.gold = prevGold;
      if (prevHp > 0 && prevMax > 0) {
        player.p.hp = Math.max(1, Math.min(player.p.maxHp, prevHp));
      }
    }
    state = State.PLAYING;
    ui.showHud();
    const label = campaign
      ? `${ARENAS[arenaIndex].name.toUpperCase()}  ·  ${arenaIndex + 1}/${ARENAS.length}`
      : ARENAS[arenaIndex].name.toUpperCase();
    fx.banner(label, 'gold');
    audio.play('wave');

    // Camera snap
    camTarget.set(0, 0, 0);
    camPos.copy(camTarget).add(camOffset);
    camera.position.copy(camPos);
    camera.lookAt(camTarget);
  }

  function beginWave() {
    const def = getWaveDef(arenaIndex, waveIndex);
    spawnQueue = [];
    for (const pack of def.spawns) {
      for (let i = 0; i < pack.n; i++) {
        spawnQueue.push({ type: pack.type, scale: def.scale });
      }
    }
    // shuffle lightly
    for (let i = spawnQueue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [spawnQueue[i], spawnQueue[j]] = [spawnQueue[j], spawnQueue[i]];
    }
    spawnTimer = 0.4;
    waveActive = true;
    fx.banner(`WAVE ${waveIndex + 1}`, '');
    audio.play('wave');
  }

  function getAimPoint(inputState) {
    if (!inputState.hasPointer) return null;
    raycaster.setFromCamera(inputState.pointerNdc, camera);
    const ok = raycaster.ray.intersectPlane(groundPlane, aimHit);
    if (!ok) return null;
    return { x: aimHit.x, z: aimHit.z };
  }

  function onHitEnemy(e, damage, opts = {}) {
    if (!e || !e.alive) return;
    const kx = opts.kx || 0;
    const kz = opts.kz || 0;
    const kn = Math.hypot(kx, kz) || 1;
    const dealt = enemies.applyDamage(e, damage, {
      knockback: opts.knockback || 0,
      kx: kx / kn,
      kz: kz / kn,
      status: opts.status,
      mod: arenaSys.def?.modifiers || {},
    });
    if (dealt <= 0) return;

    const isCrit = !!(opts.crit || dealt >= 32);
    fx.damageNumber(e.x, 1, e.z, dealt, {
      crit: isCrit,
      shock: opts.status?.type === 'shock',
    });
    fx.spawnParticles(e.x, 1, e.z, isCrit ? 0xff6b35 : 0xffaa66, isCrit ? 10 : 6, isCrit ? 4.5 : 3);
    if (opts.hitstop) fx.addHitstop(opts.hitstop);
    audio.play(isCrit ? 'crit' : 'hit');

    if (opts.status?.type === 'shock') {
      fx.shockBurst(e.x, 1, e.z, arenaSys.def?.modifiers?.shockVfx || 1);
      fx.statusText(e.x, 1, e.z, 'SHOCK', '#8cf');
      audio.play('shock');
    }
    if (opts.status?.type === 'burn') fx.statusText(e.x, 1, e.z, 'BURN', '#f80');
    if (opts.status?.type === 'frost') fx.statusText(e.x, 1, e.z, 'FROST', '#8cf');

    if (!e.alive) onEnemyDeath(e);
  }

  function onEnemyDeath(e) {
    if (!e || e._scored) return;
    e._scored = true;
    comboTimer = 3.5;
    comboKills += 1;
    const mult = comboMultiplier(comboKills);
    const pts = Math.floor(e.score * mult * (arenaSys.def?.modifiers?.scoreBonus || 1));
    score += pts;
    player.p.gold += 1 + (e.def.elite ? 4 : 0);
    fx.damageNumber(e.x, 1.5, e.z, pts, { crit: mult >= 4 });
    fx.spawnParticles(e.x, 1, e.z, 0xf0c14b, 14, 5);
    audio.play('kill');
    if (mult >= 2) audio.play('combo');
    arenaSys.pulseFlash(1.5);
  }

  function hurtPlayer(amount, sourceEnemy = null) {
    const dealt = player.takeDamage(amount, {
      onBlock() {
        audio.play('block');
        fx.ringBurst(player.p.x, player.p.z, 0x66ccff, 1.2);
        fx.statusText(player.p.x, 1, player.p.z, 'BLOCK', '#8cf');
      },
      onWardBlock() {
        audio.play('magic');
        fx.ringBurst(player.p.x, player.p.z, 0xc084fc, 1.6);
        fx.statusText(player.p.x, 1, player.p.z, 'WARD', '#c9f');
      },
      onReflect(reflectDmg) {
        audio.play('magic');
        fx.ringBurst(player.p.x, player.p.z, 0xc084fc, 2.2);
        fx.statusText(player.p.x, 1.2, player.p.z, 'REFLECT', '#c9f');
        // Pulse damage to nearby enemies (and the attacker if known)
        for (const e of enemies.enemies) {
          if (!e.alive || e.spawning > 0) continue;
          const d = Math.hypot(e.x - player.p.x, e.z - player.p.z);
          if (d <= 3.2 + e.radius || e === sourceEnemy) {
            onHitEnemy(e, reflectDmg, {
              knockback: 1.2,
              kx: e.x - player.p.x,
              kz: e.z - player.p.z,
              status: { type: 'shock', duration: 0.6 },
            });
          }
        }
      },
    });
    if (dealt > 0) {
      audio.play('hurt');
      fx.addShake(0.3, 0.25);
      fx.spawnParticles(player.p.x, 1, player.p.z, 0xe63946, 10, 4);
      comboKills = 0;
      if (!player.p.alive) {
        gameOver();
      }
    }
  }

  function gameOver() {
    state = State.RESULT;
    audio.play('gameover');
    fx.banner('DEFEATED', '');
    ui.showResult({
      title: 'DEFEATED',
      sub: `${ARENAS[arenaIndex].name} — Wave ${waveIndex + 1}`,
      score,
      showNext: false,
    });
  }

  function saveCampaignProgress() {
    if (!campaign) return;
    try {
      const best = parseInt(localStorage.getItem(CAMPAIGN_PROGRESS_KEY) || '0', 10) || 0;
      const reached = arenaIndex + 1; // 1-based boards cleared
      if (reached > best) localStorage.setItem(CAMPAIGN_PROGRESS_KEY, String(reached));
    } catch {
      /* ignore */
    }
  }

  function arenaCleared() {
    state = State.RESULT;
    const isLast = arenaIndex >= ARENAS.length - 1;
    const isCampaignWin = campaign && isLast;
    if (campaign) saveCampaignProgress();
    audio.play('victory');
    fx.banner(isCampaignWin ? 'SANCTUM CLAIMED!' : ARENAS[arenaIndex].clearBanner, 'gold');
    const progress = campaign ? `Realm ${arenaIndex + 1}/${ARENAS.length} · ` : '';
    ui.showResult({
      title: isCampaignWin ? 'SANCTUM CLAIMED!' : 'REALM CLEARED!',
      sub:
        progress +
        ARENAS[arenaIndex].clearBanner +
        (campaign && !isLast ? ' Advance to the next realm.' : isCampaignWin ? ' All five boards conquered.' : ''),
      score,
      showNext: campaign && !isLast,
    });
  }

  function updateHud() {
    const labels = player.getAbilityLabels();
    const cls = CLASSES[classId];
    ui.updateHud({
      hp: player.p.hp,
      maxHp: player.p.maxHp,
      gold: player.p.gold,
      score,
      combo: comboMultiplier(comboKills),
      wave: waveIndex + 1,
      waveTotal: WAVES_PER_ARENA,
      arenaName: ARENAS[arenaIndex]?.name,
      className: cls?.name,
      emoji: cls?.emoji,
      abilityLabels: labels,
      cds: player.p.cd,
      cdMax: player.p.cdMax,
      canHeal: player.p.alive && player.p.hp < player.p.maxHp && player.p.gold >= HEAL_GOLD_COST,
      healCost: HEAL_GOLD_COST,
      campaign,
      arenaIndex,
    });
  }

  function updatePlaying(dt) {
    const inputState = input.poll();

    if (inputState.pause) {
      state = State.PAUSED;
      ui.showPause();
      return;
    }

    // Combo decay
    if (comboTimer > 0) {
      comboTimer -= dt;
      if (comboTimer <= 0) comboKills = 0;
    }

    const aim = getAimPoint(inputState);
    const mod = arenaSys.def?.modifiers || {};

    player.update(dt, inputState, combat, enemies.enemies, fx, audio, mod, aim, onHitEnemy);

    // Enemy AI
    enemies.update(
      dt,
      player.p,
      combat,
      audio,
      {
        onMeleeHit(e) {
          hurtPlayer(e.damage, e);
        },
        onDeath: onEnemyDeath,
        onBurnTick(e) {
          fx.spawnParticles(e.x, 1, e.z, 0xff4400, 3, 1);
        },
      },
      camera
    );

    // Projectiles
    combat.updateProjectiles(dt, enemies.enemies, player.p, (proj, target, isAoe) => {
      if (proj.team === 'player') {
        onHitEnemy(target, proj.damage, {
          status: proj.status,
          knockback: isAoe ? 1 : 2,
          kx: target.x - proj.x,
          kz: target.z - proj.z,
        });
        if (proj.ground) {
          // ground already spawned in combat when primary hit
        }
      } else {
        hurtPlayer(proj.damage);
      }
    });

    combat.updateGrounds(dt, enemies.enemies, player.p, (g) => {
      if (g.type === 'fire') {
        for (const e of enemies.enemies) {
          if (!e.alive) continue;
          if (Math.hypot(e.x - g.x, e.z - g.z) <= g.radius + e.radius) {
            const wasAlive = e.alive;
            enemies.applyDamage(e, Math.max(1, g.dps * 0.35), {
              status: { type: 'burn', duration: 1.2, dps: g.dps },
            });
            if (wasAlive && !e.alive) onEnemyDeath(e);
          }
        }
      } else if (g.type === 'frost') {
        for (const e of enemies.enemies) {
          if (!e.alive) continue;
          if (Math.hypot(e.x - g.x, e.z - g.z) <= g.radius + e.radius) {
            enemies.applyStatus(e, { type: 'frost', duration: 0.8, slow: g.slow || 0.45 }, mod);
          }
        }
      }
    });
    combat.updateBeams(dt);

    // Portals fade
    for (let i = portals.length - 1; i >= 0; i--) {
      const p = portals[i];
      p.life -= dt;
      p.mesh.material.opacity = Math.max(0, p.life / 0.6);
      p.mesh.scale.setScalar(1 + (1 - p.life / 0.6) * 0.5);
      if (p.life <= 0) {
        scene.remove(p.mesh);
        portals.splice(i, 1);
      }
    }

    // Wave flow
    if (restTimer > 0) {
      restTimer -= dt;
      if (restTimer <= 0) beginWave();
    } else if (waveActive) {
      const def = getWaveDef(arenaIndex, waveIndex);
      spawnTimer -= dt;
      if (spawnQueue.length && spawnTimer <= 0) {
        const next = spawnQueue.shift();
        const { enemy, portal, portalLife } = enemies.spawnPortal(
          next.type,
          next.scale,
          arenaSys.spawnPortalTint()
        );
        portals.push({ mesh: portal, life: portalLife });
        spawnTimer = def.spawnInterval;
        void enemy;
      }

      if (!spawnQueue.length && enemies.aliveCount() === 0) {
        waveActive = false;
        // Wave clear celebration
        const cleared = waveIndex + 1;
        const clearBonus = 250 * cleared;
        const goldBonus = 2 + Math.floor(cleared / 2) + arenaIndex;
        score += clearBonus;
        player.p.gold += goldBonus;
        // Partial heal on wave clear (flavor: sanctuary pulse)
        if (player.p.alive && player.p.hp < player.p.maxHp && cleared % 2 === 0) {
          player.p.hp = Math.min(player.p.maxHp, player.p.hp + 1);
          fx.statusText(player.p.x, 1.4, player.p.z, '+❤ SANCTUM', '#6f6');
        }
        const arenaName = ARENAS[arenaIndex]?.name || 'Realm';
        fx.banner(cleared >= WAVES_PER_ARENA ? 'FINAL WAVE CLEAR!' : 'WAVE CLEAR!', 'gold');
        fx.callout(`+${clearBonus} · +${goldBonus}◈ · ${arenaName}`);
        audio.play('wave');
        arenaSys.pulseFlash(3);
        fx.addShake(0.2, 0.25);
        fx.ringBurst(player.p.x, player.p.z, 0xf0c14b, 3.5);
        fx.spawnParticles(player.p.x, 1.2, player.p.z, 0xf0c14b, 18, 5);

        if (waveIndex >= WAVES_PER_ARENA - 1) {
          waveClearTimer = 1.8;
          state = State.WAVE_CLEAR;
        } else {
          waveIndex += 1;
          restTimer = 2.4;
        }
      }
    }

    // Camera follow
    camTarget.x += (player.p.x - camTarget.x) * Math.min(1, dt * 5);
    camTarget.z += (player.p.z - camTarget.z) * Math.min(1, dt * 5);
    camTarget.y = 0;
    camPos.copy(camTarget).add(camOffset);
    camera.position.lerp(camPos, Math.min(1, dt * 6));
    camera.lookAt(camTarget);

    arenaSys.update(dt);
    updateHud();
  }

  function update(dt) {
    // Hit-stop freezes sim (fx.update returns 0) but VFX/shake still tick
    const simDt = fx.beginFrame(dt);

    if (state === State.PLAYING) {
      if (simDt > 0) updatePlaying(simDt);
      else {
        // Still refresh HUD/ability rings during brief hit-stop
        updateHud();
      }
    } else if (state === State.WAVE_CLEAR) {
      waveClearTimer -= dt;
      arenaSys.update(dt);
      camPos.copy(camTarget).add(camOffset);
      camera.position.lerp(camPos, 0.1);
      camera.lookAt(camTarget);
      if (waveClearTimer <= 0) {
        arenaCleared();
      }
    } else if (state === State.PAUSED) {
      const inputState = input.poll();
      if (inputState.pause) {
        state = State.PLAYING;
        ui.hidePause();
      }
    } else if (state === State.MENU || state === State.CLASS || state === State.ARENA) {
      arenaSys.update(dt);
      // gentle orbit of camera on menu
      const t = performance.now() * 0.00015;
      camera.position.set(Math.sin(t) * 18, 20, Math.cos(t) * 18);
      camera.lookAt(0, 0, 0);
    }

    // Shake applied AFTER camera follow so it is not overwritten
    fx.applyShake();
    renderer.render(scene, camera);
  }

  // Boot into menu with arena backdrop
  arenaSys.build(0);
  ui.hideLoading();
  ui.showMenu();

  // Audio unlock
  const unlock = () => audio.unlock();
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });

  return {
    update,
    audio,
    get state() {
      return state;
    },
  };
}
