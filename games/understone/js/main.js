// Understone — boot + fixed-timestep game loop.
// Physics runs at 60 ticks/sec (Terraria-accurate); rendering is decoupled with interpolation.

export const TPS = 60;
export const TICK_MS = 1000 / TPS;
const MAX_CATCHUP_TICKS = 5; // spiral-of-death guard when tab was backgrounded

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { alpha: false });

// Horizontal-mirror a sprite once and cache it. Used for the axe, whose icon art is drawn
// blade-on-the-left: mirroring the SPRITE (rather than flipping the canvas X during the swing)
// points the blade forward WITHOUT reversing the swing rotation the way a scale(-1) would.
const _hflipCache = new WeakMap();
function hflipSprite(img) {
  if (!img) return img;
  let f = _hflipCache.get(img);
  if (!f) {
    f = document.createElement('canvas');
    f.width = img.width; f.height = img.height;
    const fc = f.getContext('2d');
    fc.imageSmoothingEnabled = false;
    fc.translate(img.width, 0); fc.scale(-1, 1);
    fc.drawImage(img, 0, 0);
    _hflipCache.set(img, f);
  }
  return f;
}

function fitCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
}
window.addEventListener('resize', fitCanvas);
fitCanvas();

const bootFill = document.getElementById('boot-fill');
const bootMsg = document.getElementById('boot-msg');
export function bootProgress(frac, msg) {
  if (bootFill) bootFill.style.width = `${Math.round(frac * 100)}%`;
  if (bootMsg && msg) bootMsg.textContent = msg;
}
export function bootDone() {
  const boot = document.getElementById('boot');
  if (!boot) return;
  boot.style.opacity = '0';
  setTimeout(() => boot.remove(), 450);
}

// --- game state registry (filled in by systems as they come online) ---
export const game = {
  canvas, ctx,
  tick: 0,           // world ticks elapsed
  updaters: [],      // fn(game) called once per tick, in order
  renderers: [],     // fn(game, alpha) called once per frame, in order
  paused: false,
};

let acc = 0;
let last = performance.now();
let fpsFrames = 0, fpsLast = last;
game.fps = 0;
function frame(now) {
  requestAnimationFrame(frame);
  fpsFrames++;
  if (now - fpsLast >= 500) { game.fps = Math.round((fpsFrames * 1000) / (now - fpsLast)); fpsFrames = 0; fpsLast = now; }
  acc += now - last;
  last = now;
  let ticks = 0;
  while (acc >= TICK_MS && ticks < MAX_CATCHUP_TICKS) {
    if (!game.paused) {
      if (game.fx && game.fx.freezeTimer > 0) {
        game.fx.freezeTimer--;            // hit-stop: sim frozen, render continues
      } else {
        for (const u of game.updaters) u(game);
        game.tick++;
      }
    }
    acc -= TICK_MS;
    ticks++;
  }
  if (ticks === MAX_CATCHUP_TICKS) acc = 0; // drop backlog rather than freeze
  const alpha = acc / TICK_MS; // interpolation factor for renderers
  for (const r of game.renderers) r(game, alpha);
}

// paint hint that cannot hang: RAF when visible, timeout fallback when the tab is hidden
const paintBreak = () => new Promise((r) => { const t = setTimeout(r, 60); requestAnimationFrame(() => { clearTimeout(t); r(); }); });

async function boot() {
  bootProgress(0.05, 'Waking the world…');
  const [{ initInput, consumeTick }, { World, TILES, T, W_ }, { generateWorld }, { Camera }, { Background }, { TileRenderer }, { Player }] =
    await Promise.all([
      import('./core/input.js'),
      import('./world/world.js'),
      import('./world/worldgen.js'),
      import('./render/camera.js'),
      import('./render/background.js'),
      import('./render/renderer.js'),
      import('./entities/player.js'),
    ]);
  const { Lighting } = await import('./world/lighting.js');
  const { Liquids } = await import('./world/liquids.js');
  const [{ ITEMS, STARTER_ITEMS }, { Inventory }, { Drops }, { HUD }, inputMod] = await Promise.all([
    import('./items/items.js'),
    import('./items/inventory.js'),
    import('./entities/drops.js'),
    import('./ui/hud.js'),
    import('./core/input.js'),
  ]);
  const [{ Spawner }, { Projectiles }, { Combat }, { summonBossFactory }, { loadAssets, makeTileDrawer, makeWallDrawer, itemIcon, toolFallbackSprite, arcSprite, character }] = await Promise.all([
    import('./entities/spawner.js'),
    import('./entities/projectile.js'),
    import('./entities/combat.js'),
    import('./entities/bosses.js'),
    import('./core/assets.js'),
  ]);

  const [{ Chests }, { FallingTiles }, saveMod] = await Promise.all([
    import('./items/chests.js'),
    import('./world/falling.js'),
    import('./core/save.js'),
  ]);
  game.save = saveMod;

  initInput(canvas);
  const world = new World();
  game.world = world;

  bootProgress(0.5, 'Painting the world…');
  const assets = await loadAssets();
  game.assets = assets;

  const camera = new Camera(world, canvas);
  game.camera = camera;
  const background = new Background(world, camera, assets);
  const tileRenderer = new TileRenderer(world);
  tileRenderer.drawTileHook = makeTileDrawer(world, assets);
  tileRenderer.drawWallHook = makeWallDrawer(assets);
  game.tileRenderer = tileRenderer;

  const player = new Player(world);
  game.player = player;
  game.T = T; game.TILES = TILES;
  camera.follow(player);
  window.__US__ = game; // debug/verification handle (same convention as __FFG_GAME__)

  const chests = new Chests(world);
  world.chests = chests;
  const falling = new FallingTiles(world);
  game.falling = falling;

  // inventory / drops / HUD must exist before loadGame can restore into them
  const inventory = new Inventory();
  game.inventory = inventory;
  const drops = new Drops(world);
  game.drops = drops;
  const hud = new HUD(game, player, inventory);
  game.hud = hud;
  game.openChest = (tx, ty) => hud.openChest(tx, ty);

  // ---- title menu: New World / Continue -------------------------------------------
  bootProgress(1, 'Ready');
  bootDone();
  const choice = await showTitle(saveMod.hasSave());
  const bootEl2 = document.createElement('div');   // re-show a mini progress line
  bootEl2.id = 'genmsg';
  bootEl2.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(10,10,18,0.85);color:#cfd6e6;font:16px Segoe UI;z-index:90;';
  bootEl2.textContent = 'Shaping the world…';
  document.body.appendChild(bootEl2);
  await paintBreak();
  await paintBreak();

  const liquids = new Liquids(world);
  game.liquids = liquids;

  const { NPCManager, NPC } = await import('./entities/npc.js');
  const npcs = new NPCManager(game);
  game.npcs = npcs;
  game.npcInteract = (tx, ty) => npcs.interactAt(tx, ty);

  if (choice === 'continue' && saveMod.loadGame(game)) {
    // world restored from save; restore town NPCs
    for (const rec of game._savedNpcs ?? []) {
      const n = new NPC(rec.type, rec.x + 9, rec.y + 40);   // +9/+40 undo the NPC ctor offset so x/y round-trip exactly (no per-save drift)
      n.homeX = rec.homeX ?? rec.x;
      npcs.npcs.push(n);
    }
    if (!npcs.npcs.some(n => n.type === 'guide')) npcs.spawnGuide();
  } else {
    // fresh world: clear any prior save so autosave/Continue reflect THIS world, not a stale one
    saveMod.deleteSave();
    generateWorld(world, () => {});
    chests.seedWorldLoot();
    player.respawn();
    for (const [id, n] of STARTER_ITEMS) inventory.add(id, n);
    npcs.spawnGuide();
    // settlement residents (underground miners, far-outpost wizard)
    for (const rec of world.townNpcs ?? []) {
      const n = new NPC(rec.type, rec.x + 9, rec.y + 40);   // +9/+40 undo the NPC ctor offset so x/y round-trip exactly (no per-save drift)
      n.homeX = rec.x;
      npcs.npcs.push(n);
    }
  }
  liquids.settleAll();
  camera.x = player.x; camera.y = player.y; camera.px = camera.x; camera.py = camera.y;
  bootEl2.remove();

  // dug tiles → world drops
  player.onDig.push((tx, ty, info, extra) => {
    if (extra?.wall) return;
    if (extra?.wood) {
      drops.spawnFromTile(tx, ty, 'wood', extra.wood);
      if (Math.random() < 0.5) drops.spawnFromTile(tx, ty, 'acorn', 1 + (Math.random() < 0.3 ? 1 : 0));
      return;
    }
    if (info.name === 'pot') {
      const roll = Math.random();
      if (roll < 0.4) inventory.money += 30 + (Math.random() * 120) | 0;
      else if (roll < 0.65) drops.spawnFromTile(tx, ty, 'torch', 3 + (Math.random() * 5) | 0);
      else if (roll < 0.85) drops.spawnFromTile(tx, ty, 'woodenArrow', 8 + (Math.random() * 12) | 0);
      else drops.spawnFromTile(tx, ty, 'bomb', 1 + (Math.random() * 3) | 0);
      return;
    }
    if (info.drops && ITEMS[info.drops]) drops.spawnFromTile(tx, ty, info.drops, 1);
  });

  // held item adapter: inventory slot → the shape player.updateTool expects
  const syncHeld = () => {
    const def = inventory.heldDef();
    if (!def) { player.heldItem = null; return; }
    const cb = inventory.classBonus();
    const isMelee = ['sword', 'shortsword', 'spear', 'flail', 'boomerang'].includes(def.weapon);
    let dmgMult = isMelee ? cb.meleeDmg : def.weapon === 'bow' ? cb.rangedDmg : def.weapon === 'magic' ? cb.magicDmg : 1;
    // reforge modifier (Blacksmith): stored on the STACK, persists in saves
    const mod = inventory.held()?.mod;
    let speedMult = isMelee ? cb.meleeSpeed : 1;
    if (mod) {
      dmgMult *= mod.dmg ?? 1;
      speedMult *= mod.speed ?? 1;
    }
    player.heldItem = {
      name: mod ? `${mod.name} ${def.name}` : def.name,
      critBonus: (mod?.crit ?? 0) + inventory.accessoryEffects().critBonus,
      type: def.tool ?? def.type,
      pickPower: def.pickPower, axePower: def.axePower, hammerPower: def.hammerPower,
      useTime: Math.max(6, Math.round((def.useTime ?? 20) * speedMult)),
      damage: def.damage != null ? Math.round(def.damage * dmgMult) : def.damage,
      knockback: def.knockback != null ? def.knockback * (mod?.kb ?? 1) : def.knockback,
      placeTile: def.placeTile != null ? T[def.placeTile] : null,
      placeWall: def.placeWall != null ? W_[def.placeWall] : null,
      use: def.use, boss: def.boss, weapon: def.weapon, ammo: def.ammo,
      element: def.element ?? null, proc: def.proc ?? null,
      mana: def.mana != null && def.type !== 'consumable' ? Math.max(1, Math.round(def.mana * cb.manaCost)) : def.mana,
      heal: def.heal, bolt: def.bolt, blastTiles: def.blastTiles, fuse: def.fuse,
      consume: (def.type === 'block' || def.type === 'wall' || def.type === 'consumable' || def.type === 'summon')
        ? () => inventory.consumeHeld(1) : null,
    };
  };

  game.updaters.push(() => {
    // hotbar selection: number keys (mouse wheel is dedicated to camera zoom — see wheel handler)
    const hb = inputMod.hotbarPressed();
    if (hb >= 0) { inventory.selected = hb; inventory.changed(); }
    // don't trigger panel keys while typing in the recipe search box
    const typing = document.activeElement && document.activeElement.id === 'us-search';
    if (!typing) {
      if (inputMod.wasPressed('inventory')) hud.toggle();
      else if (inputMod.wasPressed('crafting')) hud.toggle(!hud.open, 'craft');
    }
    syncHeld();
  });
  // ---- combat: enemies, spawner, projectiles, bosses ----------------------------
  game.enemies = [];
  game.ITEMS = ITEMS;
  game.bloodMoon = false;
  const spawner = new Spawner(world, game.enemies);
  const projectiles = new Projectiles(world);
  game.projectiles = projectiles;
  const combat = new Combat(game);
  game.combat = combat;
  game.summonBoss = summonBossFactory(game);
  player.getDefense = () => inventory.defense();

  // ---- fx: particles, hit-stop, screenshake ---------------------------------------
  const { FX } = await import('./render/fx.js');
  const fx = new FX();
  game.fx = fx;
  game.updaters.push(() => {
    fx.update();
    // ambient flames on visible torches / furnaces / hellforges
    if (!fx.throttled() && game.tick % 2 === 0) {
      const [x0, y0, x1, y1] = camera.visibleTileRange(1, 0);
      let emitted = 0;
      for (let ty = y0; ty <= y1 && emitted < 14; ty++) {
        for (let tx = x0; tx <= x1 && emitted < 14; tx++) {
          const id = world.tiles[ty * world.w + tx];
          if (id === T.torch) { fx.fire(tx * 16 + 8, ty * 16 + 4, 1, 22); emitted++; }
          else if (id === T.campfire) { fx.fire(tx * 16 + 8, ty * 16 + 6, 2, 26); emitted++; }
          else if (id === T.candle && (game.tick & 2)) { fx.fire(tx * 16 + 8, ty * 16 + 3, 1, 12); emitted++; }
          else if (id === T.furnace || id === T.hellforge) { if (Math.random() < 0.5) { fx.fire(tx * 16 + 8, ty * 16 + 11, 1, 16); emitted++; } }
        }
      }
    }
  });
  game.renderers.push((g, alpha) => {
    const [sx, sy] = game.settings?.screenShake === false ? [0, 0] : fx.shakeOffset();
    camera.shakeX = sx; camera.shakeY = sy;
  });

  // ---- audio ---------------------------------------------------------------------
  const { AudioEngine } = await import('./core/audio.js');
  const audio = new AudioEngine();
  game.audio = audio;
  player.onDig.push((tx, ty, info, extra) => {
    if (extra?.wood) audio.play('chop', { volume: 0.9 });
    else audio.play(`dig${(Math.random() * 3) | 0}`, { volume: 0.8 });
    fx.digDust(tx * 16 + 8, ty * 16 + 8, info.color && info.color !== 'transparent' ? info.color : '#9a7a5a');
  });
  player.onHurt.push(() => fx.addTrauma(0.4));
  player.onHurt.push(() => audio.play('hurt'));
  drops.onPickup.push((itemId, count) => {
    audio.play('pickup', { volume: 0.55, throttleMs: 90 });
    // Terraria-style rising pickup text: "Wood (3)"
    const def = ITEMS[itemId];
    if (def) game.floatText?.(player.x, player.py - 6, count > 1 ? `${def.name} (${count})` : def.name, '#9ecbff');
  });
  inventory.onChange.push(() => { /* craft sound handled in HUD */ });
  {
    // music selection by context (checked every 2s of ticks)
    const { LAYERS, WORLD_H } = await import('./config.js');
    const { isDay } = await import('./render/background.js');
    game.updaters.push(() => {
      if (game.tick % 120 !== 0 || !audio.ctx) return;
      const pty = player.py / 16, ptx = player.px / 16;
      const inCorruption = (world.corruption ?? []).some(([a, b]) => ptx >= a && ptx <= b);
      let track;
      if (game.enemies.some(e => e.boss)) track = 'boss';
      else if (pty > WORLD_H * LAYERS.underworld) track = 'hell';
      else if (inCorruption && pty < WORLD_H * LAYERS.underground) track = 'corruption';
      else if (pty > WORLD_H * LAYERS.underground) track = 'underground';
      else track = isDay(game.tick) ? 'day' : 'night';
      audio.music(track);
    });
  }

  // announcement banner (top center, fades)
  const announceEl = document.createElement('div');
  announceEl.style.cssText = `position:fixed;top:70px;left:50%;transform:translateX(-50%);
    font:600 18px 'Segoe UI',sans-serif;color:#f0d8a0;text-shadow:0 2px 6px #000;
    opacity:0;transition:opacity .4s;pointer-events:none;z-index:60;`;
  document.getElementById('hud').appendChild(announceEl);
  let announceTimer = null;
  game.announce = (msg) => {
    announceEl.textContent = msg;
    announceEl.style.opacity = '1';
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => { announceEl.style.opacity = '0'; }, 3500);
  };

  game.updaters.push(() => player.tick(game));
  game.updaters.push(() => combat.tick());
  game.updaters.push(() => npcs.tick());
  game.updaters.push(() => spawner.tick(game));
  game.updaters.push(() => projectiles.tick(game));
  game.updaters.push(() => drops.tick(player, inventory));
  game.updaters.push(() => liquids.tick());
  game.updaters.push(() => falling.tick());
  game.updaters.push(() => camera.tick());
  game.updaters.push(() => hud.tick());
  game.updaters.push(() => consumeTick()); // must stay LAST updater

  // death jingle on the tick the player dies
  let wasDead = false;
  game.updaters.push(() => {
    if (player.dead && !wasDead) audio.play('death', { volume: 0.9 });
    wasDead = player.dead;
  });

  // fallen stars: rain at night near the player, vanish at dawn (mana progression!)
  {
    const { isDay } = await import('./render/background.js');
    game.updaters.push(() => {
      if (game.tick % 60 !== 0) return;
      const night = !isDay(game.tick);
      if (night && Math.random() < 0.045 && !player.dead) {
        const tx = Math.floor(player.x / 16) + ((Math.random() * 160) | 0) - 80;
        if (tx > 5 && tx < world.w - 5) {
          const skyY = Math.max(2, (world.surface[tx] ?? 100) - 40);
          game.drops.spawn('fallenStar', 1, tx * 16 + 8, skyY * 16, false);
          const d = game.drops.items[game.drops.items.length - 1];
          if (d?.id === 'fallenStar') { d.star = true; d.vy = 2; d.vx = (Math.random() - 0.5) * 0.6; }
        }
      }
      if (!night) {
        // stars evaporate in daylight (Terraria rule)
        for (let i = game.drops.items.length - 1; i >= 0; i--) {
          if (game.drops.items[i].star) game.drops.items.splice(i, 1);
        }
      }
    });
  }

  // sapling growth: every ~5s one random sapling tries to become a tree
  const saplings = new Set();
  world.onTileChanged.push((tx, ty) => {
    const k = ty * world.w + tx;
    if (world.tiles[k] === T.sapling) saplings.add(k); else saplings.delete(k);
  });
  game.updaters.push(() => {
    if (game.tick % 300 !== 0 || saplings.size === 0) return;
    const arr = [...saplings];
    const k = arr[(Math.random() * arr.length) | 0];
    const tx = k % world.w, ty = (k / world.w) | 0;
    if (world.tiles[k] !== T.sapling) { saplings.delete(k); return; }
    if (Math.random() > 0.3) return;
    const height = 6 + (Math.random() * 7 | 0);
    for (let t = 0; t <= height + 2; t++) {
      if (ty - t < 0 || (t > 0 && world.tileAt(tx, ty - t) !== T.air)) return; // no room
    }
    const ground = world.tileAt(tx, ty + 1);
    if (ground !== T.grass && ground !== T.dirt && ground !== T.snow && ground !== T.jungleGrass) return;
    saplings.delete(k);
    for (let t = 0; t <= height; t++) world.setTile(tx, ty - t, T.treeTrunk);
    for (let ly = -2; ly <= 1; ly++) for (let lx = -2; lx <= 2; lx++) {
      const yy = ty - height - 1 + ly, xx = tx + lx;
      if (Math.abs(lx) + Math.abs(ly) <= 3 && world.tileAt(xx, yy) === T.air) world.setTile(xx, yy, T.treeLeaves);
    }
  });

  // ---- pause menu (Esc) + autosave ------------------------------------------------
  const pauseEl = document.createElement('div');
  pauseEl.style.cssText = `position:fixed;inset:0;display:none;align-items:center;justify-content:center;
    background:rgba(8,10,18,0.72);z-index:80;font-family:'Segoe UI',sans-serif;`;
  // load persisted settings
  const SETTINGS = (() => { try { return JSON.parse(localStorage.getItem('understone.settings.v1')) || {}; } catch (_) { return {}; } })();
  const saveSettings = () => { try { localStorage.setItem('understone.settings.v1', JSON.stringify(SETTINGS)); } catch (_) { /* ignore */ } };
  game.settings = game.settings || {};
  // toggleable on-screen FPS counter (separate from the F3 debug panel)
  const fpsEl = document.createElement('div');
  fpsEl.style.cssText = `position:fixed;top:40px;left:12px;z-index:69;pointer-events:none;font:600 12px monospace;color:#8fd0ff;text-shadow:0 1px 2px #000;display:none;`;
  document.body.appendChild(fpsEl);
  game.renderers.push((g) => { if (fpsEl.style.display !== 'none') fpsEl.textContent = 'FPS ' + g.fps; });
  const applyAudio = () => {
    const m = SETTINGS.master ?? 1;
    const music = (SETTINGS.music ?? 0.35) * m, sfx = (SETTINGS.sfx ?? 0.7) * m;
    audio.musicVolume = music; if (audio.musicGain) audio.musicGain.gain.value = music;
    audio.sfxVolume = sfx; if (audio.sfxGain) audio.sfxGain.gain.value = sfx;
  };
  const applyVideo = () => {
    game.settings.screenShake = SETTINGS.screenShake !== false;
    game.settings.smoothLighting = SETTINGS.smoothLighting !== false;
    if (game.lighting) game.lighting.smooth = game.settings.smoothLighting;
    fpsEl.style.display = SETTINGS.showFps ? 'block' : 'none';
  };
  applyAudio(); applyVideo();
  // ---- mouse-wheel zoom (replaces the old Video › Zoom slider) --------------------
  // Scroll over the canvas to zoom in/out; the player stays centered (follow-camera),
  // and the chosen level is remembered across reloads.
  const ZOOM_KEY = 'understone.zoom.v1';
  const MIN_ZOOM = 1.2, MAX_ZOOM = 6.0;
  const clampZoom = (z) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
  { const saved = parseFloat(localStorage.getItem(ZOOM_KEY)); if (saved > 0) camera.zoom = clampZoom(saved); }
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    camera.zoom = clampZoom(camera.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12));
    try { localStorage.setItem(ZOOM_KEY, camera.zoom.toFixed(3)); } catch (_) { /* ignore */ }
  }, { passive: false });
  const sliderRow = (id, label, min = 0, max = 100) => `<label style="display:flex;align-items:center;gap:10px;color:#c8d0e8;font-size:13px;margin-bottom:8px">${label}<input id="us-s-${id}" type="range" min="${min}" max="${max}" style="flex:1"><span id="us-s-${id}-v" style="width:38px;text-align:right;color:#9aa3c0"></span></label>`;
  const cat = (t) => `<div style="color:#d9b98a;font:700 10px 'Segoe UI';letter-spacing:1.5px;text-transform:uppercase;margin:12px 0 8px">${t}</div>`;
  pauseEl.innerHTML = `<div style="text-align:center;min-width:360px;max-height:94vh;overflow:auto;padding:4px">
    <h2 style="color:#e8d9a0;letter-spacing:6px;margin:6px 0 14px">PAUSED</h2>
    <div id="us-resume" class="us-menu-btn">Resume</div>
    <div style="margin:14px auto 6px;padding:14px 16px;background:rgba(20,24,40,.6);border:1px solid #3a415c;border-radius:10px;width:334px;text-align:left">
      ${cat('Audio')}${sliderRow('master', 'Master')}${sliderRow('music', 'Music')}${sliderRow('sfx', 'Sound')}
      ${cat('Video')}
      <div id="us-toggles"></div>
      <div id="us-fullscreen" class="us-menu-btn" style="margin:6px 0 2px;font-size:12px;padding:5px 10px">Toggle Fullscreen</div>
      ${cat('Controls')}
      <div style="color:#9aa3c0;font-size:11.5px;line-height:1.85">
        Move — <b>A</b> / <b>D</b> &nbsp;·&nbsp; Jump — <b>Space</b> (hold = higher)<br>
        Mine / Use — <b>Left-click</b> &nbsp;·&nbsp; Interact — <b>Right-click</b><br>
        Inventory — <b>I</b> / <b>E</b> &nbsp;·&nbsp; Crafting — <b>C</b> &nbsp;·&nbsp; Hotbar — <b>1–0</b><br>
        Zoom — <b>Mouse wheel</b> &nbsp;·&nbsp; Debug (X/Y/FPS) — <b>F3</b> &nbsp;·&nbsp; Pause / Menu — <b>Esc</b>
      </div>
      <div id="us-reset" class="us-menu-btn" style="margin-top:10px;font-size:12px;padding:5px 10px;color:#e0a0a0">Reset to Defaults</div>
    </div>
    <div id="us-save" class="us-menu-btn">Save World</div>
    <div id="us-savequit" class="us-menu-btn">Save &amp; Quit to Title</div>
    <div id="us-savemsg" style="color:#8ac88a;font-size:13px;margin-top:10px;height:16px"></div>
  </div>`;
  document.body.appendChild(pauseEl);
  pauseEl.style.pointerEvents = 'auto';   // panel is outside #hud, keep it clickable
  const setPaused = (on) => {
    game.paused = on;
    pauseEl.style.display = on ? 'flex' : 'none';
    if (on) audio.music('title'); // gentle menu theme; auto-selector restores on resume
  };
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Escape') return;
    if (hud.open) { hud.toggle(false); return; }
    setPaused(!game.paused);
  });
  // ---- wire sliders (value 0-100 -> 0..1, zoom 60-260 -> 0.6..2.6× base) ----
  const wireSlider = (id, key, def, apply, sound) => {
    const el = pauseEl.querySelector(`#us-s-${id}`), vEl = pauseEl.querySelector(`#us-s-${id}-v`);
    el.value = Math.round((SETTINGS[key] ?? def) * 100);
    const sync = () => { vEl.textContent = `${el.value}%`; };
    sync();
    el.addEventListener('input', () => { SETTINGS[key] = +el.value / 100; apply(); saveSettings(); sync(); if (sound) audio.play('pickup', { volume: 0.4 }); });
  };
  wireSlider('master', 'master', 1, applyAudio);
  wireSlider('music', 'music', 0.35, applyAudio);
  wireSlider('sfx', 'sfx', 0.7, applyAudio, true);
  // ---- wire on/off toggles ----
  const tc = pauseEl.querySelector('#us-toggles');
  for (const [key, label, def] of [['screenShake', 'Screen Shake', true], ['smoothLighting', 'Smooth Lighting', true], ['showFps', 'Show FPS', false]]) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;color:#c8d0e8;font-size:13px;margin-bottom:8px';
    const span = document.createElement('span'); span.textContent = label;
    const btn = document.createElement('div'); btn.className = 'us-menu-btn';
    btn.style.cssText = 'font-size:12px;padding:3px 14px;margin:0;min-width:46px;text-align:center';
    const val = () => SETTINGS[key] ?? def;
    const render = () => { btn.textContent = val() ? 'On' : 'Off'; btn.style.color = val() ? '#8ad48a' : '#9aa3c0'; };
    render();
    btn.onclick = () => { SETTINGS[key] = !val(); applyVideo(); saveSettings(); render(); };
    row.append(span, btn); tc.appendChild(row);
  }
  pauseEl.querySelector('#us-fullscreen').onclick = () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.();
  };
  pauseEl.querySelector('#us-reset').onclick = () => { for (const k of Object.keys(SETTINGS)) delete SETTINGS[k]; saveSettings(); location.reload(); };
  pauseEl.querySelector('#us-resume').onclick = () => setPaused(false);
  pauseEl.querySelector('#us-save').onclick = () => {
    const ok = saveMod.saveGame(game);
    pauseEl.querySelector('#us-savemsg').textContent = ok ? 'World saved.' : 'Save failed (storage full?)';
  };
  pauseEl.querySelector('#us-savequit').onclick = () => {
    saveMod.saveGame(game);
    location.reload();
  };
  setInterval(() => {
    if (!game.paused && !player.dead && game.tick > 600) saveMod.saveGame(game);
  }, 120000); // autosave every 2 min
  window.addEventListener('beforeunload', () => { if (game.tick > 600) saveMod.saveGame(game); });
  // always-visible settings/menu button (top-left) so the menu is discoverable, not just Esc
  const gear = document.createElement('div');
  gear.textContent = '☰ Menu';
  gear.style.cssText = `position:fixed;top:10px;left:12px;z-index:70;pointer-events:auto;cursor:pointer;
    font:600 13px 'Segoe UI',sans-serif;color:#e8d9a0;background:rgba(12,16,28,.6);border:1px solid #3a415c;
    border-radius:8px;padding:5px 11px;user-select:none;`;
  gear.onclick = () => setPaused(!game.paused);
  document.body.appendChild(gear);

  game.renderers.push((g, alpha) => background.draw(g.ctx, g, alpha));
  game.renderers.push((g, alpha) => tileRenderer.draw(g.ctx, camera, alpha));

  // player sprite (Grok-generated; block fallback while art is missing)
  game.renderers.push((g, alpha) => {
    const c = g.ctx;
    const [ox, oy] = camera.frameOrigin(alpha);
    const [px, py] = player.renderPos(alpha);
    const z = camera.zoom;
    if (player.dead) return;
    const sx = (px - ox) * z, sy = (py - oy) * z;
    if (player.iFrames > 0 && (g.tick & 4)) c.globalAlpha = 0.4;
    // fishing line + bobber
    if (player.bobber) {
      const b = player.bobber;
      c.strokeStyle = 'rgba(220,220,230,0.6)';
      c.lineWidth = Math.max(1, z * 0.7);
      c.beginPath();
      c.moveTo((player.x + player.facing * 8 - ox) * z, (player.py + 8 - oy) * z);
      c.lineTo((b.x - ox) * z, (b.y - oy) * z);
      c.stroke();
      c.fillStyle = b.biting > 0 ? '#ff4a4a' : '#e04a4a';
      c.beginPath(); c.arc((b.x - ox) * z, (b.y - oy) * z, (b.biting > 0 ? 4 : 3) * z, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#f0f0f0';
      c.beginPath(); c.arc((b.x - ox) * z, (b.y - 2 - oy) * z, 1.5 * z, 0, Math.PI * 2); c.fill();
    }
    // grapple chain + hook (drawn under the player)
    if (player.grapple) {
      const gp = player.grapple;
      c.strokeStyle = '#8a8a96';
      c.lineWidth = Math.max(1, 1.5 * z);
      c.setLineDash([3 * z, 2 * z]);
      c.beginPath();
      c.moveTo((player.x - ox) * z, (player.py + 20 - oy) * z);
      c.lineTo((gp.x - ox) * z, (gp.y - oy) * z);
      c.stroke();
      c.setLineDash([]);
      c.fillStyle = '#c9ccd8';
      c.fillRect((gp.x - ox) * z - 2 * z, (gp.y - oy) * z - 2 * z, 4 * z, 4 * z);
    }
    // PixelLab animated hero (walk/attack/jump/idle) with Grok static fallback.
    // Equipped armor is VISIBLE: full matching set swaps in the armored variant.
    const ARMOR_VARIANT = { copper: 'heroCopper', iron: 'heroIron', silver: 'heroSilver', gold: 'heroGold', shadow: 'heroShadow', molten: 'heroMolten' };
    let heroName = 'hero';
    {
      const a = inventory.armor;
      if (a.chest) {
        const prefix = a.chest.id.replace(/(Chainmail|Breastplate|Scalemail).*/, '');
        if (ARMOR_VARIANT[prefix]) heroName = ARMOR_VARIANT[prefix];
      }
    }
    const heroChar = character(heroName) ?? character('hero');
    const walking = Math.abs(player.vx) > 0.3 && player.vy === 0;
    let frameImg = null;
    if (heroChar) {
      const pick = (name) => heroChar.anims[name]?.length ? heroChar.anims[name] : null;
      let frames, idx;
      if (player.swinging > 0) {
        frames = pick('attack') ?? pick('cross-punch');
        const useT = player.heldItem?.useTime || 20;
        idx = frames ? Math.min(frames.length - 1, Math.floor((1 - player.swinging / useT) * frames.length)) : 0;
      } else if (player.vy !== 0) {
        frames = pick('jump');
        idx = frames ? (player.vy < 0 ? 1 : Math.max(0, frames.length - 2)) : 0;
      } else if (walking) {
        frames = pick('walk') ?? pick('walking-8-frames');
        idx = frames ? Math.floor(g.tick * 0.22 * (Math.abs(player.vx) / 3 + 0.4)) % frames.length : 0;
      } else {
        frames = pick('breathing-idle') ?? pick('idle');
        idx = frames ? Math.floor(g.tick * 0.05) % frames.length : 0;
      }
      frameImg = frames ? frames[idx] : heroChar.base;
    }
    const spr = frameImg ?? game.assets?.sprites?.player;
    if (spr) {
      const bob = !frameImg && walking ? Math.sin(g.tick * 0.35) * 1.2 * z : 0;
      const lean = !frameImg && walking ? Math.sin(g.tick * 0.35) * 0.05 : 0;
      // scale so the OPAQUE figure (content box) matches the hitbox height + anchor feet
      let dh, dw, cy;
      const cx = sx + (player.w * z) / 2;
      if (frameImg && heroChar?.content) {
        const scale = (player.h * 1.06) / heroChar.content.h;    // figure ≈ hitbox height
        dh = frameImg.height * scale * z;
        dw = frameImg.width * scale * z;
        // content bottom sits at hitbox bottom
        const contentBottomFrac = (heroChar.content.y + heroChar.content.h) / frameImg.height;
        cy = sy + player.h * z - dh * contentBottomFrac + dh / 2;
      } else {
        dh = player.h * z;
        dw = spr.width * (dh / spr.height);
        cy = sy + (player.h * z) / 2 + bob;
      }
      c.save();
      c.translate(cx, cy);
      c.scale(player.facing > 0 ? 1 : -1, 1);
      c.rotate(lean * (player.facing > 0 ? 1 : -1));
      if (!frameImg && player.swinging > 0) c.rotate(0.18);
      c.imageSmoothingEnabled = false;
      const sq = player.crouching ? 0.68 : 1;   // crouch: squash the figure, feet stay planted
      c.drawImage(spr, -dw / 2, dh / 2 - dh * sq, dw, dh * sq);
      c.restore();
      // ---- held item: visibly swung around the hand anchor (research 07 P0-4) ----
      const held = player.heldItem;
      const heldDef = game.inventory.heldDef();
      if (held && heldDef && !held.use && !held.boss) {
        const useT = held.useTime || 20;
        const swinging = player.swinging > 0;
        const prog = swinging ? Math.min(1, Math.max(0, 1 - player.swinging / useT)) : 1;
        // Anchor the hand relative to the VISIBLE character (centred on cx, ~player.h tall), NOT
        // the narrow 14px hitbox — otherwise the tool floats by the feet. Hand = a few px toward
        // the facing side, at chest height.
        const handX = cx + player.facing * 5 * z;
        const handY = sy + player.h * z * 0.44;
        const rawSpr = itemIcon(heldDef.id)
          ?? toolFallbackSprite(held.type === 'pickaxe' || held.type === 'axe' || held.type === 'hammer' ? held.type
            : held.weapon === 'bow' ? 'bow' : held.weapon === 'sword' ? 'sword'
            : held.placeTile != null ? 'block' : 'sword');
        // the axe icon is drawn blade-on-the-LEFT (opposite the pickaxe); pre-mirror the SPRITE so its
        // blade points forward. Doing it on the sprite (not via scale(-1)) keeps the swing rotating the
        // SAME way as the sword/pickaxe instead of spinning backwards.
        const sprIt = held.type === 'axe' ? hflipSprite(rawSpr) : rawSpr;
        const isz = 22 * z;
        // mirror FIRST so "forward" == facing, then rotate: rest = held forward/down out of the
        // hand; swing = overhead → forward-down chop.
        const angle = swinging ? (-2.2 + prog * 3.0) : 0.85;
        c.save();
        c.translate(handX, handY);
        c.scale(player.facing > 0 ? 1 : -1, 1);
        c.rotate(angle);
        c.imageSmoothingEnabled = false;
        // grip the icon near its handle so the head reaches OUT (forward) from the fist
        c.drawImage(sprIt, -isz * 0.1, -isz * 0.72, isz, isz);
        c.restore();
        // white/element arc flash, alpha peaks mid-swing (research 10 §5a)
        if (held.weapon === 'sword') {
          const tint = held.element === 'fire' ? '#ffca7a' : held.element === 'ice' ? '#bfe9ff'
            : held.element === 'lightning' ? '#dfe4ff' : held.element === 'shadow' ? '#c78aff'
            : held.element === 'water' ? '#9fd0ff' : '#ffffff';
          const arc = arcSprite(Math.round(30 * z), tint);
          c.save();
          c.globalCompositeOperation = 'lighter';
          c.globalAlpha = Math.sin(prog * Math.PI) * 0.7;
          c.translate(handX, handY);
          c.scale(player.facing > 0 ? 1 : -1, 1);
          c.rotate(-1.2 + prog * 2.2);
          c.drawImage(arc, -arc.width / 2, -arc.height / 2);
          c.restore();
          c.globalAlpha = 1;
          c.globalCompositeOperation = 'source-over';
        }
      }
    } else {
      c.fillStyle = '#c8956c'; c.fillRect(sx + 4 * z, sy, 12 * z, 10 * z);
      c.fillStyle = '#3a6ea5'; c.fillRect(sx + 2 * z, sy + 10 * z, 16 * z, 20 * z);
      c.fillStyle = '#2d4739';
      c.fillRect(sx + 3 * z, sy + 30 * z, 6 * z, 12 * z);
      c.fillRect(sx + 11 * z, sy + 30 * z, 6 * z, 12 * z);
    }
    c.globalAlpha = 1;
  });

  // NPCs + enemies + projectiles + falling tiles + world item drops
  game.renderers.push((g, alpha) => npcs.draw(g.ctx, camera, alpha, g.assets));
  game.renderers.push((g, alpha) => { for (const e of g.enemies) e.draw(g.ctx, camera, alpha, g.assets); });
  game.renderers.push((g, alpha) => projectiles.draw(g.ctx, camera, alpha));
  game.renderers.push((g, alpha) => falling.draw(g.ctx, camera, alpha, g.assets));
  game.renderers.push((g, alpha) => drops.draw(g.ctx, camera, alpha));

  // lighting (multiply overlay) — after entities, before cursor/HUD
  const lighting = new Lighting(world);
  game.lighting = lighting;
  game.renderers.push((g, alpha) => {
    lighting.compute(camera, g.tick, alpha);
    lighting.draw(g.ctx, camera, alpha);
  });

  // particles + bolts render above lighting (flames/zaps are self-lit)
  game.renderers.push((g, alpha) => fx.draw(g.ctx, camera, alpha));

  // floating damage numbers (above lighting so they stay readable)
  game.renderers.push((g, alpha) => combat.draw(g.ctx, camera, alpha));

  // ---- F3 debug overlay: X/Y, FPS, velocity, biome, entity counts, cursor tile -------
  game.debug = false;
  window.addEventListener('keydown', (e) => {
    if (e.code === 'F3') { e.preventDefault(); game.debug = !game.debug; }
  });
  game.renderers.push((g) => {
    if (!g.debug) return;
    const c = g.ctx, p = player;
    const ptx = Math.floor(p.x / 16), pty = Math.floor(p.y / 16);
    let biome = 'forest', band = 'surface';
    try { biome = spawner.biomeAt(ptx); band = spawner.depthBand(pty); } catch (_) { /* ignore */ }
    const m = inputMod.mouse;
    const [cwx, cwy] = camera.screenToWorld(m.x * (g.canvas.width / g.canvas.clientWidth), m.y * (g.canvas.height / g.canvas.clientHeight));
    const ctx_tx = Math.floor(cwx / 16), ctx_ty = Math.floor(cwy / 16);
    const underCursor = world.inBounds(ctx_tx, ctx_ty) ? (TILES[world.tileAt(ctx_tx, ctx_ty)]?.name ?? 'air') : 'oob';
    const lines = [
      'UNDERSTONE — F3 debug',
      `FPS ${g.fps}   tick ${g.tick}`,
      `X ${ptx}   Y ${pty}   layer:${band}`,
      `px ${p.px.toFixed(1)}, ${p.py.toFixed(1)}   vel ${p.vx.toFixed(2)}, ${p.vy.toFixed(2)}`,
      `grounded ${p.grounded()}   facing ${p.facing > 0 ? 'R' : 'L'}`,
      `biome ${biome}`,
      `HP ${p.hp}/${p.hpMax}   MP ${Math.floor(p.mana)}/${p.manaMax}`,
      `enemies ${g.enemies.length}   npcs ${npcs.npcs.length}`,
      `cursor ${ctx_tx},${ctx_ty} = ${underCursor}`,
      `held ${p.heldItem?.name ?? '-'}   seed ${world.seed ?? '?'}`,
    ];
    c.save();
    c.font = '12px monospace';
    const bw = 264, bh = lines.length * 15 + 12;
    c.fillStyle = 'rgba(0,0,0,0.62)';
    c.fillRect(8, 8, bw, bh);
    c.textAlign = 'left'; c.textBaseline = 'top';
    lines.forEach((ln, i) => { c.fillStyle = i === 0 ? '#8fd0ff' : '#c8f0c0'; c.fillText(ln, 16, 14 + i * 15); });
    c.restore();
  });

  // death overlay
  game.renderers.push((g) => {
    if (!player.dead) return;
    const c = g.ctx;
    c.fillStyle = 'rgba(60,0,0,0.35)';
    c.fillRect(0, 0, g.canvas.width, g.canvas.height);
    c.fillStyle = '#f0d0d0';
    c.font = `bold ${28 * Math.min(window.devicePixelRatio || 1, 2)}px 'Segoe UI', sans-serif`;   // cap matches the canvas backing store
    c.textAlign = 'center';
    c.fillText('You were slain…', g.canvas.width / 2, g.canvas.height / 2 - 20);
    c.font = `${16 * Math.min(window.devicePixelRatio || 1, 2)}px 'Segoe UI', sans-serif`;   // cap matches the canvas backing store
    c.fillText(`Respawning in ${Math.ceil(player.respawnTimer / 60)}…`, g.canvas.width / 2, g.canvas.height / 2 + 16);
    c.textAlign = 'left';
  });

  // cursor target tile outline + mining cracks — DEV
  game.renderers.push((g, alpha) => {
    const c = g.ctx;
    const { tx, ty, inReach } = player.targetTile(g);
    if (!world.inBounds(tx, ty)) return;
    const [ox, oy] = camera.frameOrigin(alpha);
    const z = camera.zoom;
    const sx = (tx * 16 - ox) * z, sy = (ty * 16 - oy) * z;
    c.strokeStyle = inReach ? 'rgba(255,255,180,0.85)' : 'rgba(255,80,80,0.4)';
    c.lineWidth = Math.max(1, z);
    c.strokeRect(sx + 0.5, sy + 0.5, 16 * z, 16 * z);
    if (player.miningTile === ty * world.w + tx && player.miningDamage > 0) {
      c.fillStyle = `rgba(0,0,0,${0.15 + 0.35 * (player.miningDamage / 100)})`;
      c.fillRect(sx, sy, 16 * z, 16 * z);
    }
  });

  requestAnimationFrame((t) => { last = t; requestAnimationFrame(frame); });
}

// ---------------------------------------------------------------------------
// Title screen: New World / Continue. Resolves with the choice.
// ---------------------------------------------------------------------------
function showTitle(canContinue) {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.style.cssText = `position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;
      justify-content:center;background:linear-gradient(#0e1526,#1c2c22);z-index:95;font-family:'Segoe UI',sans-serif;`;
    el.innerHTML = `
      <style>
        .us-menu-btn { padding:10px 34px;margin:7px;border:2px solid #3a415c;border-radius:8px;color:#e8e8f0;
          font-size:17px;cursor:pointer;background:rgba(20,24,40,0.75);min-width:220px;text-align:center;
          transition: all .15s; user-select:none; }
        .us-menu-btn:hover { border-color:#e8d9a0;color:#e8d9a0;box-shadow:0 0 12px rgba(232,217,160,.3); }
        .us-menu-btn.disabled { opacity:.35;cursor:default;pointer-events:none; }
      </style>
      <h1 style="font-size:52px;letter-spacing:12px;color:#e8d9a0;margin:0 0 6px;text-shadow:0 0 28px rgba(232,217,160,.4)">UNDERSTONE</h1>
      <div style="color:#8a93b0;margin-bottom:34px;font-size:14px">dig · build · craft · survive</div>
      <div class="us-menu-btn" id="us-new">New World</div>
      <div class="us-menu-btn ${canContinue ? '' : 'disabled'}" id="us-continue">Continue</div>
      <div class="us-menu-btn" id="us-title-settings" style="font-size:15px;min-width:220px">Settings</div>
      <div class="us-menu-btn" id="us-title-credits" style="font-size:15px;min-width:220px">Credits</div>`;
    document.body.appendChild(el);
    el.querySelector('#us-new').onclick = () => {
      // no save → just start; save exists → confirm before replacing it (single world slot)
      if (!canContinue) { el.remove(); resolve('new'); return; }
      const box = document.createElement('div');
      box.style.cssText = `position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;
        justify-content:center;background:rgba(6,9,16,.92);z-index:120;font-family:'Segoe UI',sans-serif`;
      box.innerHTML = `<div style="color:#e8d9a0;font-size:20px;margin-bottom:8px">Start a new world?</div>
        <div style="color:#9aa3c0;font-size:13px;max-width:360px;text-align:center;margin-bottom:22px;line-height:1.6">
          This replaces your current saved world. Choose <b>Continue</b> instead to keep playing the existing one.</div>`;
      const yes = document.createElement('div'); yes.className = 'us-menu-btn';
      yes.textContent = 'Replace & Start New'; yes.style.borderColor = '#e0a0a0'; yes.style.color = '#e0a0a0';
      const no = document.createElement('div'); no.className = 'us-menu-btn'; no.textContent = 'Cancel';
      box.append(yes, no); el.appendChild(box);
      no.onclick = () => box.remove();
      yes.onclick = () => { el.remove(); resolve('new'); };
    };
    el.querySelector('#us-continue').onclick = () => { el.remove(); resolve('continue'); };
    el.querySelector('#us-title-settings').onclick = () => openTitleOverlay('settings');
    el.querySelector('#us-title-credits').onclick = () => openTitleOverlay('credits');
  });
}

// Standalone Settings / Credits overlay usable BEFORE the game boots (edits the same persisted
// settings; audio/video prefs apply when you start playing). Keeps the title screen "complete".
function openTitleOverlay(kind) {
  const KEY = 'understone.settings.v1';
  const S = (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (_) { return {}; } })();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (_) { /* ignore */ } };
  const ov = document.createElement('div');
  ov.style.cssText = `position:fixed;inset:0;display:flex;align-items:center;justify-content:center;
    background:rgba(6,9,16,.82);z-index:110;font-family:'Segoe UI',sans-serif;`;
  const slider = (id, label, min, max) => `<label style="display:flex;align-items:center;gap:10px;color:#c8d0e8;font-size:13px;margin-bottom:8px">${label}<input id="s-${id}" type="range" min="${min}" max="${max}" style="flex:1"><span id="s-${id}-v" style="width:38px;text-align:right;color:#9aa3c0"></span></label>`;
  const cat = (t) => `<div style="color:#d9b98a;font:700 10px 'Segoe UI';letter-spacing:1.5px;text-transform:uppercase;margin:12px 0 8px">${t}</div>`;
  if (kind === 'credits') {
    ov.innerHTML = `<div style="width:400px;max-width:92vw;padding:24px;background:rgba(18,22,38,.96);border:1px solid #3a415c;border-radius:12px;text-align:center;color:#c8d0e8">
      <h2 style="color:#e8d9a0;letter-spacing:6px;margin:0 0 16px">UNDERSTONE</h2>
      <div style="font-size:13px;line-height:1.9">A 2D dig-build-craft-survive sandbox in the Terraria tradition.<br>
      Built by Forge Flow Labs.<br>Pixel art via PixelLab · Engine: vanilla JS.<br>
      <span style="color:#7480a0">Mine deep, build tall, beware the night.</span></div>
      <div class="us-menu-btn" id="ov-close" style="margin:18px auto 0;min-width:120px;font-size:14px">Back</div></div>`;
  } else {
    ov.innerHTML = `<div style="width:380px;max-width:94vw;max-height:92vh;overflow:auto;padding:20px;background:rgba(18,22,38,.96);border:1px solid #3a415c;border-radius:12px;text-align:left">
      <h2 style="color:#e8d9a0;letter-spacing:5px;margin:0 0 4px;text-align:center">SETTINGS</h2>
      <div style="color:#7480a0;font-size:11px;text-align:center;margin-bottom:12px">applied when you start playing</div>
      ${cat('Audio')}${slider('master', 'Master', 0, 100)}${slider('music', 'Music', 0, 100)}${slider('sfx', 'Sound', 0, 100)}
      ${cat('Video')}<div id="ov-toggles"></div>
      ${cat('Controls')}<div style="color:#9aa3c0;font-size:11.5px;line-height:1.85">
        Move — <b>A</b>/<b>D</b> · Jump — <b>Space</b> (hold = higher)<br>
        Mine/Use — <b>Left-click</b> · Interact — <b>Right-click</b><br>
        Inventory — <b>I</b>/<b>E</b> · Crafting — <b>C</b> · Hotbar — <b>1–0</b><br>
        Zoom — <b>Mouse wheel</b> · Debug — <b>F3</b> · Pause/Menu — <b>Esc</b></div>
      <div class="us-menu-btn" id="ov-close" style="margin:16px auto 0;min-width:120px;font-size:14px">Back</div></div>`;
  }
  document.body.appendChild(ov);
  ov.querySelector('#ov-close').onclick = () => ov.remove();
  if (kind === 'settings') {
    const wire = (id, key, def) => {
      const el = ov.querySelector(`#s-${id}`), v = ov.querySelector(`#s-${id}-v`);
      el.value = Math.round((S[key] ?? def) * 100);
      const sync = () => { v.textContent = `${el.value}%`; };
      sync();
      el.addEventListener('input', () => { S[key] = +el.value / 100; save(); sync(); });
    };
    wire('master', 'master', 1); wire('music', 'music', 0.35); wire('sfx', 'sfx', 0.7);
    const tc = ov.querySelector('#ov-toggles');
    for (const [key, label, def] of [['screenShake', 'Screen Shake', true], ['smoothLighting', 'Smooth Lighting', true], ['showFps', 'Show FPS', false]]) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;color:#c8d0e8;font-size:13px;margin-bottom:8px';
      const sp = document.createElement('span'); sp.textContent = label;
      const b = document.createElement('div'); b.className = 'us-menu-btn';
      b.style.cssText = 'font-size:12px;padding:3px 14px;margin:0;min-width:46px;text-align:center';
      const val = () => S[key] ?? def;
      const r = () => { b.textContent = val() ? 'On' : 'Off'; b.style.color = val() ? '#8ad48a' : '#9aa3c0'; };
      r(); b.onclick = () => { S[key] = !val(); save(); r(); };
      row.append(sp, b); tc.appendChild(row);
    }
  }
}

boot();
