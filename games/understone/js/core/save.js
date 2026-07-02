// World + player persistence in localStorage.
// Tile/wall layers are RLE-compressed (worlds are mostly long runs) then base64'd.
// Typical compressed world ≈ 100-400 KB — well inside the localStorage budget.

const KEY = 'understone.save.v1';

// --- RLE: Uint16Array → Uint8Array stream [count u16][value u16]... ---------------
function rleEncode16(arr) {
  const out = [];
  let i = 0;
  while (i < arr.length) {
    const v = arr[i];
    let run = 1;
    while (i + run < arr.length && arr[i + run] === v && run < 0xffff) run++;
    out.push(run & 0xff, run >> 8, v & 0xff, v >> 8);
    i += run;
  }
  return new Uint8Array(out);
}
function rleDecode16(bytes, length) {
  const out = new Uint16Array(length);
  let oi = 0;
  for (let i = 0; i < bytes.length; i += 4) {
    const run = bytes[i] | (bytes[i + 1] << 8);
    const v = bytes[i + 2] | (bytes[i + 3] << 8);
    out.fill(v, oi, oi + run);
    oi += run;
  }
  return out;
}
function rleEncode8(arr) {
  const out = [];
  let i = 0;
  while (i < arr.length) {
    const v = arr[i];
    let run = 1;
    while (i + run < arr.length && arr[i + run] === v && run < 0xffff) run++;
    out.push(run & 0xff, run >> 8, v);
    i += run;
  }
  return new Uint8Array(out);
}
function rleDecode8(bytes, length) {
  const out = new Uint8Array(length);
  let oi = 0;
  for (let i = 0; i < bytes.length; i += 3) {
    const run = bytes[i] | (bytes[i + 1] << 8);
    out.fill(bytes[i + 2], oi, oi + run);
    oi += run;
  }
  return out;
}

function b64(bytes) {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}
function unb64(str) {
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function hasSave() {
  try { return localStorage.getItem(KEY) !== null; } catch { return false; }
}
export function deleteSave() {
  try { localStorage.removeItem(KEY); } catch {}
}

export function saveGame(game) {
  const { world, player, inventory } = game;
  const chests = {};
  if (world.chests) for (const [k, v] of world.chests.map) chests[k] = v;
  const data = {
    v: 1,
    seed: world.seed, w: world.w, h: world.h,
    tick: game.tick,
    tiles: b64(rleEncode16(world.tiles)),
    walls: b64(rleEncode16(world.walls)),
    liquid: b64(rleEncode8(world.liquid)),
    liquidType: b64(rleEncode8(world.liquidType)),
    surface: Array.from(world.surface),
    spawn: [world.spawnX, world.spawnY],
    corruption: world.corruption ?? [],
    biomes: world.biomes ?? null,
    npcs: (game.npcs?.npcs ?? []).map(n => ({ type: n.type, x: n.x, y: n.y, homeX: n.homeX })),
    player: {
      x: player.px, y: player.py, hp: player.hp, hpMax: player.hpMax,
      mana: player.mana, manaMax: player.manaMax,
    },
    inv: {
      slots: inventory.slots, armor: inventory.armor,
      selected: inventory.selected, money: inventory.money,
    },
    chests,
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch (e) {
    console.warn('save failed', e);
    return false;
  }
}

// restores into freshly-constructed world/player/inventory objects
export function loadGame(game) {
  let data;
  try { data = JSON.parse(localStorage.getItem(KEY)); } catch { return false; }
  if (!data || data.v !== 1) return false;
  const { world, player, inventory } = game;
  if (data.w !== world.w || data.h !== world.h) return false;
  world.seed = data.seed;
  world.tiles.set(rleDecode16(unb64(data.tiles), world.w * world.h));
  world.walls.set(rleDecode16(unb64(data.walls), world.w * world.h));
  world.liquid.set(rleDecode8(unb64(data.liquid), world.w * world.h));
  world.liquidType.set(rleDecode8(unb64(data.liquidType), world.w * world.h));
  world.surface.set(Int16Array.from(data.surface));
  world.spawnX = data.spawn[0]; world.spawnY = data.spawn[1];
  world.corruption = data.corruption ?? [];
  world.biomes = data.biomes ?? null;
  game._savedNpcs = data.npcs ?? [];
  game.tick = data.tick;
  player.px = data.player.x; player.py = data.player.y;
  player.ppx = player.px; player.ppy = player.py;
  player.hp = data.player.hp; player.hpMax = data.player.hpMax;
  player.mana = data.player.mana; player.manaMax = data.player.manaMax;
  player.fallStartTy = (player.py / 16) | 0;
  inventory.slots = data.inv.slots;
  inventory.armor = data.inv.armor;
  inventory.selected = data.inv.selected;
  inventory.money = data.inv.money;
  if (world.chests) {
    world.chests.map.clear();
    for (const [k, v] of Object.entries(data.chests ?? {})) world.chests.map.set(k, v);
  }
  // repaint everything
  const CH = 32;
  for (let cy = 0; cy < Math.ceil(world.h / CH); cy++)
    for (let cx = 0; cx < Math.ceil(world.w / CH); cx++)
      world.dirty.add(cy * 4096 + cx);
  inventory.changed();
  return true;
}
