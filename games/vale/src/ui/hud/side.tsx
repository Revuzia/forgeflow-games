// VALE HUD — the edges: ally frames (left edge, 4 × 168 × 52: round portrait, level, HP over a thin
// resource bar, an ultimate-ready tick, the respawn timer when down; a click centres the camera; ordered
// by role; gameplay.showAllyIndicators hides them), the feed (bottom left: ally ping lines, shop
// refusals, first-run hints, surrender — up to 5 lines for 6 s), the recall bar and the respawn line
// over the Dial Bar.

import type { JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import type { PlayerView } from '../../contracts/sim.ts';
import { useApp } from '../app_ctx.ts';
import { Portrait } from '../components/Portrait.tsx';
import { fmtInt, fmtWait } from '../format.ts';
import { useHud } from './ctx.ts';

export function AllyFrames(): JSX.Element | null {
  const { cv, state } = useApp();
  const { model } = useHud();
  model.frame.value;
  if (model.ffa || !state.settings.value.gameplay.showAllyIndicators) return null;
  const order = new Map(cv.rolesOrdered().map((r, i) => [r.id, i]));
  const allies = model.view.players
    .filter((p) => p.team === model.myTeam && p.player !== model.you)
    .sort((a, b) => (order.get(a.role ?? '') ?? 9) - (order.get(b.role ?? '') ?? 9) || a.player - b.player)
    .slice(0, 4);
  if (!allies.length) return null;
  return (
    <section class="allies" aria-label={cv.t('hud.ally_frames', 'Allies')}>
      {allies.map((p) => <AllyFrame p={p} />)}
    </section>
  );
}

function AllyFrame(p: { p: PlayerView }): JSX.Element {
  const { cv } = useApp();
  const { model, r } = useHud();
  const e = model.view.entity(p.p.entity);
  const f = cv.fighter(p.p.fighter);
  const res = cv.resource(f?.resource);
  const dead = !e || !e.alive;
  const hp = e ? e.hp / Math.max(1, e.maxHp) : 0;
  const rs = e && e.maxRes > 0 ? e.res / e.maxRes : 0;
  const ult = p.p.abilities.find((a) => a.slot === 'ult');
  const ultReady = !!ult && ult.rank > 0 && ult.cooldown <= 0;
  const role = cv.role(p.p.role);
  return (
    <button type="button" class={`afr plate ${dead ? 'is-dead' : ''}`} aria-label={`${p.p.name}, ${f?.name ?? ''}`}
      onClick={() => { if (e) { r.camera?.setMode(r.camera.mode === 'locked' ? 'locked' : 'free'); r.camera?.focusOn(e.x, e.y); } }}>
      <span class="afr__face">
        <Portrait fighter={f} skin={p.p.skin} size="fill" round />
        <span class="afr__lvl num">{e?.level ?? 1}</span>
        {dead ? <span class="afr__respawn num">{Math.ceil(p.p.respawnIn)}</span> : null}
      </span>
      <span class="afr__body">
        <span class="afr__name t-caption">{role ? <span class="roledot" style={{ background: role.color }} /> : null}{p.p.name}</span>
        <span class="afr__hp"><i style={{ width: `${hp * 100}%` }} /></span>
        {res && res.model !== 'none' ? <span class="afr__res" style={{ '--res': res.color } as JSX.CSSProperties}><i style={{ width: `${rs * 100}%` }} /></span> : <span class="afr__res afr__res--none" />}
      </span>
      <span class={`afr__ult ${ultReady ? 'is-ready' : ''}`} title={ult ? cv.t('hud.slot.ult', 'Ultimate') : ''} aria-hidden="true" />
    </button>
  );
}

export function Feed(): JSX.Element {
  const { model } = useHud();
  const lines = model.feed.value;
  return (
    <ol class="feed" aria-live="polite">
      {lines.map((l) => <li class={`feed__line feed__line--${l.tone} t-body-s`} key={l.id}>{l.text}</li>)}
    </ol>
  );
}

/** the recall channel over the Dial Bar */
export function RecallBar(): JSX.Element | null {
  const { cv } = useApp();
  const { model, client } = useHud();
  model.frame.value;
  const me = model.me;
  const q = cv.queue(client.setup.queue);
  const rules = q ? cv.rulesOf(q) : undefined;
  const p = me?.recallProgress ?? 0;
  if (!me || p <= 0) return null;
  const total = rules?.recallTime ?? 8;
  return (
    <div class="recallbar plate" role="status">
      <span class="t-label">{cv.t('hud.recall_progress', 'Recalling · {t}', { t: `${Math.max(0, total * (1 - p)).toFixed(1)} s` })}</span>
      <span class="recallbar__track"><i style={{ width: `${p * 100}%` }} /></span>
    </div>
  );
}

/** down: "Back in 12 s", and where the mode allows it, a reminder that the shop is open */
export function RespawnLine(): JSX.Element | null {
  const { cv } = useApp();
  const { model } = useHud();
  model.frame.value;
  const me = model.me;
  const body = model.body;
  if (!me || (body && body.alive) || model.view.phase !== 'live' || me.placement !== undefined) return null;
  return (
    <div class="respawn" role="status">
      <span class="t-h2">{cv.t('hud.dead.respawn', 'Back in {t}', { t: fmtWait(Math.ceil(me.respawnIn)) })}</span>
      {me.canShop ? <span class="t-caption muted">{cv.t('hud.dead.shop', 'You can still shop while you wait.')}</span> : null}
    </div>
  );
}

/** a level-up flourish over the Dial Bar ("Level 6") */
export function LevelUpPop(): JSX.Element | null {
  const { cv } = useApp();
  const { model } = useHud();
  const lv = model.levelUp.value;
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!lv.n || !el.current) return;
    el.current.animate([
      { opacity: 0, transform: 'translate(-50%, 12px)' }, { opacity: 1, transform: 'translate(-50%, 0)', offset: 0.18 },
      { opacity: 1, transform: 'translate(-50%, -4px)', offset: 0.75 }, { opacity: 0, transform: 'translate(-50%, -14px)' },
    ], { duration: 1600, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
  }, [lv.n]);
  if (!lv.n) return null;
  const sp = model.me?.skillPoints ?? 0;
  return (
    <div ref={el} class="lvlpop" aria-live="polite" style={{ opacity: 0 }}>
      <span class="lvlpop__wedge" aria-hidden="true" />
      <span class="t-h2">{cv.t('hud.level', 'Level {n}', { n: lv.level })}</span>
      {sp > 0 ? <span class="t-caption">{sp === 1 ? cv.t('hud.skill_point', 'Level up an ability') : cv.t('hud.skill_points', '{n} points to spend', { n: fmtInt(sp) })}</span> : null}
    </div>
  );
}
