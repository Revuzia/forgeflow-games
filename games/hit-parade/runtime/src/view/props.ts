/// <reference types="vite/client" />
// HIT PARADE - fighter props (CONTRACT §6.4, §17.1 attach metadata, §26.3 CHANGED(VIEW)).
//
// Lane ASSETS ships prop GLBs in art/gltf/props/<id>.glb + art/gltf/props/props.json (`{ props: { <id>: { glb, users,
// rule, bone, attach: {bone, pos, rotDeg}, fighters: { <fighter>: {bone, pos, rotDeg} }, projectile, ... } } }`, CHANGED
// (ASSETS) 6.4). Each prop root also carries the glTF extras `{ attach }`. Grip metadata precedence: props.json
// `fighters[<fighter>]` (the solve on that body's own fingers) > props.json `attach` > GLB extras > the rule's bone.
// The VIEW decides WHO holds WHAT and WHEN (PROP_RULES below: "brick only while throwing, shield always on Krane,
// cleaver always on Boneyard, mic-cane on Ricky"; the baton gives way to the taser during taser moves).
// The prop is solved every frame from the hand bone's WORLD matrix with the full basis (position + rotation, scale
// stripped, mirror kept) composed with the grip offset (fighters.ts). A prop id with no GLB is simply not attached
// (never a primitive stand-in); `PropLibrary.report()` says which rule found nothing.

import * as THREE from 'three';
import type { Assets, PropAttach } from './assets.ts';

/** when a prop shows: always, or during moves whose id matches, optionally only until the projectile leaves the hand */
export interface PropShow {
  always?: boolean;
  /** hidden during moves / cinematic clips matching this (always-props that give way to another) */
  except?: RegExp;
  moves?: RegExp;
  untilRelease?: boolean;
  /** visible while a PRIME TIME attacker clip matches (cinematics play clips, not moves) */
  cineClips?: RegExp;
}
export interface PropRule {
  ids: string[]; bone: string; show: PropShow; pos?: [number, number, number]; rotDeg?: [number, number, number];
  /** hold it in `bone` with the resolved grip MIRRORED from the other hand (the grip data was solved for the right hand) */
  mirrorGrip?: boolean;
}

export const PROP_RULES: Record<string, PropRule[]> = {
  johnny: [{ ids: ['brick'], bone: 'RightHand', show: { moves: /^brickbat_/, untilRelease: true } }],
  krane: [
    { ids: ['riot_shield', 'shield'], bone: 'LeftHand', show: { always: true } },
    { ids: ['baton'], bone: 'RightHand', show: { always: true, except: /taser/ } },
    // the taser clips (taser_* moves, the riot_act `taser_fire` cinematic clip) punch the LEFT hand out from behind the
    // shield - the wire and the barb leave from there - so the taser rides in that fist (grip mirrored from the right-hand
    // solve); measured in the real game: with the taser in the rear right hand the barb flew out of the empty shield hand
    { ids: ['taser'], bone: 'LeftHand', mirrorGrip: true, show: { moves: /^taser_/, cineClips: /taser/ } },
  ],
  boneyard: [{ ids: ['cleaver'], bone: 'RightHand', show: { always: true } }],
  ricky: [{ ids: ['mic_cane', 'miccane', 'cane'], bone: 'RightHand', show: { always: true } }],
  zambini: [{ ids: ['card_fan', 'card', 'playing_card'], bone: 'RightHand', show: { moves: /^card_fan_/, untilRelease: true } }],
  lotus: [{ ids: ['gourd', 'bottle'], bone: 'Hips', show: { always: true } }],
};

interface PropsJsonRow {
  id: string; users?: string[]; fighter?: string | string[]; bone?: string | null; pos?: [number, number, number]; rotDeg?: [number, number, number]; show?: string;
  attach?: { bone: string; pos: [number, number, number]; rotDeg: [number, number, number] } | null;
  fighters?: Record<string, { bone: string; pos: [number, number, number]; rotDeg: [number, number, number] }>;
  projectile?: boolean;
}

const GLBS = import.meta.glob('../../../art/gltf/props/*.glb', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const JSONS = import.meta.glob('../../../art/gltf/props/props.json', { eager: true, import: 'default' }) as Record<string, unknown>;

function glbUrl(id: string): string | null {
  for (const [k, v] of Object.entries(GLBS)) if (k.endsWith(`/${id}.glb`)) return v;
  return null;
}
function propsJson(): PropsJsonRow[] {
  const raw = Object.values(JSONS)[0] as unknown;
  if (!raw) return [];
  const pr = (raw as { props?: unknown }).props;
  const rows = Array.isArray(raw) ? raw : Array.isArray(pr) ? pr
    : pr && typeof pr === 'object' ? Object.entries(pr as Record<string, unknown>).map(([id, v]) => ({ id, ...(v as object) }))
      : typeof raw === 'object' ? Object.entries(raw as Record<string, unknown>).filter(([k]) => !k.startsWith('_') && k !== 'version').map(([id, v]) => ({ id, ...(v as object) })) : [];
  return (rows as PropsJsonRow[]).filter((r) => r && typeof r.id === 'string');
}

export interface ResolvedProp { id: string; rule: PropRule; obj: THREE.Object3D; attach: PropAttach }

/** which props exist and which fighter rules they satisfy */
export class PropLibrary {
  readonly available: string[];
  private readonly json: PropsJsonRow[];
  readonly missing: string[] = [];
  constructor() {
    this.available = Object.keys(GLBS).map((k) => k.slice(k.lastIndexOf('/') + 1).replace(/\.glb$/i, ''));
    this.json = propsJson();
  }

  /** the rules for a fighter: PROP_RULES + props.json rows naming this fighter */
  rulesFor(fighter: string): PropRule[] {
    const out = (PROP_RULES[fighter] ?? []).map((r) => ({ ...r }));
    for (const row of this.json) {
      // a props.json row only ADDS a holder when it names an explicit `show` (users alone = who the grip was solved for)
      if (!row.show) continue;
      const fs = Array.isArray(row.fighter) ? row.fighter : row.fighter ? [row.fighter] : row.users ?? [];
      if (!fs.includes(fighter)) continue;
      const known = out.find((r) => r.ids.includes(row.id));
      const show: PropShow = row.show === 'always' ? { always: true } : { moves: new RegExp(row.show), untilRelease: !!row.projectile };
      if (known) known.show = show;
      else out.push({ ids: [row.id], bone: row.bone ?? 'RightHand', show, pos: row.pos, rotDeg: row.rotDeg });
    }
    return out;
  }

  /** load every prop a fighter's rules name (first id with a GLB wins); rules without a GLB are reported, not faked */
  async load(assets: Assets, fighter: string): Promise<ResolvedProp[]> {
    const res: ResolvedProp[] = [];
    for (const rule of this.rulesFor(fighter)) {
      const id = rule.ids.find((x) => glbUrl(x) !== null);
      if (!id) { this.missing.push(`${fighter}:${rule.ids[0]}`); continue; }
      try {
        assets.setUrl('prop', id, glbUrl(id)!);
        const obj = await assets.prop(id);
        const row = this.json.find((r) => r.id === id);
        const ex = obj.userData.attach as PropAttach | null;
        const mine = row?.fighters?.[fighter] ?? row?.attach ?? null;
        const attach: PropAttach = {
          bone: rule.mirrorGrip ? rule.bone : mine?.bone ?? ex?.bone ?? rule.bone,
          pos: mine?.pos ?? row?.pos ?? ex?.pos ?? rule.pos ?? [0, 0.08, 0.03],
          rotDeg: mine?.rotDeg ?? row?.rotDeg ?? ex?.rotDeg ?? rule.rotDeg ?? [0, 0, 0],
          mirror: !!rule.mirrorGrip,
        };
        obj.name = `prop:${fighter}:${id}`;
        res.push({ id, rule, obj, attach });
      } catch (e) {
        console.warn(`[view] prop ${id} for ${fighter} failed to load:`, e);
        this.missing.push(`${fighter}:${id}`);
      }
    }
    return res;
  }

  report(): { available: string[]; missing: string[] } { return { available: this.available.slice(), missing: this.missing.slice() }; }
}

/** is a prop visible for this snapshot? (`startup` = the move's first active frame, the projectile release;
 *  `cineClip` = the PRIME TIME attacker clip while a cinematic poses this fighter, else '') */
export function propVisible(show: PropShow, moveName: string, moveFrame: number, startup: number, cineClip: string): boolean {
  if (show.always) return !(show.except && (show.except.test(cineClip) || (!cineClip && !!moveName && show.except.test(moveName))));
  if (cineClip) return !!show.cineClips && show.cineClips.test(cineClip);
  if (!show.moves || !moveName || !show.moves.test(moveName)) return false;
  if (show.untilRelease) return moveFrame < Math.max(1, startup);
  return true;
}

/** a projectile body from lane ASSETS' props (props.json `projectile: true`: brick, card_fan / card, football) */
export function propGlbUrl(id: string): string | null { return glbUrl(id); }
