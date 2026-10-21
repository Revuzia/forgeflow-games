// VALE render — VFX socket resolution (CONTRACT §9.5 `socket`): where a layer with `socket: <name>` sits on a
// unit. The renderer hands this to the VFX system as VfxWorld.socketPos.
//
//   bone sockets   a fighter's FighterArt.sockets (weapon, hand_r, head, chest, weapon_tip …), read from the
//                  animated model every frame. A name the fighter lacks falls back along a chain (weapon →
//                  weapon_r → hand_r → chest; weapon_tip → blade_tip → weapon …), so one def works on every
//                  kit (Marund carries no `weapon` prop: his wind-ups sit at his right hand).
//   virtual        names every unit has, from its body (no bone needed):
//                    top     over the head (art height above the feet; a halo, a bell, a sleep glow)
//                    base    the feet, airborne height included (stakes, shackles, streaks)
//                    ground  under the unit at y = 0 even while it is airborne (its left-behind shadow)
//                    origin  the feet (root)
//                  `chest` and `head` use the bone when the model has one, else a share of the art height.
// Bone lookups are cached per frame (a held status emitter asks for its socket once per particle).
// Presentation only.

import type { Vector3 } from 'three';
import type { CatalogT } from '../../contracts/catalog.ts';

/** what the resolver needs from an actor (render/actors.ts Actor) */
export interface SocketActor {
  readonly def: string;
  x: number; y: number; h: number;
  artHeight: number;
  leaving: number;
  socket(name: string, out: Vector3): Vector3;
}

const CHAINS: Record<string, readonly string[]> = {
  weapon: ['weapon', 'weapon_r', 'hand_r'],
  weapon_r: ['weapon_r', 'weapon', 'hand_r'],
  weapon_l: ['weapon_l', 'hand_l', 'weapon'],
  weapon_tip: ['weapon_tip', 'blade_tip', 'weapon', 'weapon_r', 'hand_r'],
  blade_tip: ['blade_tip', 'weapon_tip', 'weapon', 'weapon_r', 'hand_r'],
  hand_r: ['hand_r', 'weapon_r', 'weapon'],
  hand_l: ['hand_l', 'weapon_l'],
};

export class SocketResolver {
  private readonly bones = new Map<string, Record<string, string>>();
  private readonly cache = new Map<string, { t: number; x: number; y: number; z: number }>();
  private readonly actor: (id: number) => SocketActor | undefined;
  private readonly clock: () => number;

  constructor(catalog: CatalogT, actor: (id: number) => SocketActor | undefined, clock: () => number) {
    for (const f of catalog.fighters) this.bones.set(f.id, f.art.sockets ?? {});
    this.actor = actor;
    this.clock = clock;
  }

  /** world position of `name` on entity `id`; false when the unit has no actor (the layer keeps its anchor) */
  socketPos(id: number, name: string, out: Vector3): boolean {
    const a = this.actor(id);
    if (!a || a.leaving >= 0) return false;
    switch (name) {
      case 'top': out.set(a.x, a.h + a.artHeight, a.y); return true;
      case 'base': out.set(a.x, a.h + 0.04, a.y); return true;
      case 'ground': out.set(a.x, 0.02, a.y); return true;
      case 'origin': out.set(a.x, a.h, a.y); return true;
      default: break;
    }
    const have = this.bones.get(a.def);
    const bone = have ? (CHAINS[name] ?? [name]).find((n) => n in have) : undefined;
    if (!bone) {
      // a body share: head 88 %, everything else (chest, a missing weapon) at the chest
      out.set(a.x, a.h + a.artHeight * (name === 'head' ? 0.88 : 0.6), a.y);
      return true;
    }
    const key = `${id}:${bone}`;
    const t = this.clock();
    const c = this.cache.get(key);
    if (c && c.t === t) { out.set(c.x, c.y, c.z); return true; }
    a.socket(bone, out);
    if (c) { c.t = t; c.x = out.x; c.y = out.y; c.z = out.z; } else this.cache.set(key, { t, x: out.x, y: out.y, z: out.z });
    if (this.cache.size > 2048) this.cache.clear();
    return true;
  }
}
