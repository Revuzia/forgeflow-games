// VALE HUD — the edges: ally frames (left edge, 4 × 168 × 52: round portrait, level, HP over a thin
// resource bar, an ultimate-ready tick, the respawn timer when down; a click centres the camera; ordered
// by role; gameplay.showAllyIndicators hides them), the feed (bottom left: ally ping lines, shop
// refusals, first-run hints, surrender — up to 5 lines for 6 s), the recall bar and the respawn line
// over the Dial Bar. r12 B4: keyed re-renders; HP / resource / timers are written per sim tick.

import type { CSSProperties, JSX } from 'preact';
import { useRef } from 'preact/hooks';
import type { PlayerView } from '../../contracts/sim.ts';
import { useApp } from '../app_ctx.ts';
import { Portrait } from '../components/Portrait.tsx';
import { TipText, useTip } from '../components/Tooltip.tsx';
import { fmtWait } from '../format.ts';
import { put, setW, useHud, useViewKey, useWriter } from './ctx.ts';

export function AllyFrames(): JSX.Element | null {
  const { cv, state } = useApp();
  const { model } = useHud();
  useViewKey(() => model.view.players.filter((p) => p.team === model.myTeam && p.player !== model.you).map((p) => p.player).join(','));
  if (model.ffa || !state.settings.value.gameplay.showAllyIndicators) return null;
  const order = new Map(cv.rolesOrdered().map((r, i) => [r.id, i]));
  const allies = model.view.players
    .filter((p) => p.team === model.myTeam && p.player !== model.you)
    .sort((a, b) => (order.get(a.role ?? '') ?? 9) - (order.get(b.role ?? '') ?? 9) || a.player - b.player)
    .slice(0, 4);
  if (!allies.length) return null;
  return (
    <section class="allies" aria-label={cv.t('hud.ally_frames', 'Allies')}>
      {allies.map((p) => <AllyFrame p={p} key={p.player} />)}
    </section>
  );
}

function AllyFrame(p: { p: PlayerView }): JSX.Element {
  const { cv } = useApp();
  const { model, r } = useHud();
  const ent = (): ReturnType<typeof model.view.entity> => model.view.entity(p.p.entity);
  const ultOf = (): boolean => { const u = p.p.abilities.find((a) => a.slot === 'ult'); return !!u && u.rank > 0 && u.cooldown <= 0; };
  useViewKey(() => { const e = ent(); return `${e && e.alive ? 1 : 0}|${e?.level ?? 1}|${ultOf() ? 1 : 0}`; });
  const hpEl = useRef<HTMLElement>(null), resEl = useRef<HTMLElement>(null), respawn = useRef<HTMLSpanElement>(null);
  useWriter(() => {
    const e = ent();
    setW(hpEl.current, e ? e.hp / Math.max(1, e.maxHp) : 0);
    setW(resEl.current, e && e.maxRes > 0 ? e.res / e.maxRes : 0);
    put(respawn.current, !e || !e.alive ? String(Math.ceil(p.p.respawnIn)) : '');
  });
  const e = ent();
  const f = cv.fighter(p.p.fighter);
  const res = cv.resource(f?.resource);
  const dead = !e || !e.alive;
  const ultReady = ultOf();
  const role = cv.role(p.p.role);
  // HUD-9: the full name (and fighter, role, ultimate) on hover and focus
  const tip = useTip(() => <TipText text={p.p.name} sub={[f?.name, role?.name, ultReady ? cv.t('hud.ally.ult_ready', 'Ultimate ready') : null].filter(Boolean).join(' · ')} />, { place: 'right' });
  return (
    <button type="button" class={`afr plate ${dead ? 'is-dead' : ''}`} aria-label={`${p.p.name}, ${f?.name ?? ''}`} {...tip}
      onClick={() => { if (e) { r.camera?.setMode(r.camera.mode === 'locked' ? 'locked' : 'free'); r.camera?.focusOn(e.x, e.y); } }}>
      <span class="afr__face">
        <Portrait kind="chip" fighter={f} skin={p.p.skin} size="fill" round />
        <span class="afr__lvl num">{e?.level ?? 1}</span>
        {dead ? <span class="afr__respawn num" ref={respawn} /> : null}
        {role ? <span class="afr__role" style={{ background: role.color }} aria-hidden="true" /> : null}
        <span class={`afr__ult ${ultReady ? 'is-ready' : ''}`} aria-hidden="true" />
      </span>
      <span class="afr__body">
        <span class="afr__name t-caption">{p.p.name}</span>
        <span class="afr__hp"><i ref={hpEl} /></span>
        {res && res.model !== 'none' ? <span class="afr__res" style={{ '--res': res.color } as CSSProperties}><i ref={resEl} /></span> : <span class="afr__res afr__res--none" />}
      </span>
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
  useViewKey(() => ((model.me?.recallProgress ?? 0) > 0 ? 1 : 0));
  const q = cv.queue(client.setup.queue);
  const rules = q ? cv.rulesOf(q) : undefined;
  const total = rules?.recallTime ?? 8;
  const label = useRef<HTMLSpanElement>(null), bar = useRef<HTMLElement>(null);
  useWriter(() => {
    const p = model.me?.recallProgress ?? 0;
    if (p <= 0) return;
    put(label.current, cv.t('hud.recall_progress', 'Recalling · {t}', { t: `${Math.max(0, total * (1 - p)).toFixed(1)} s` }));
    setW(bar.current, p);
  });
  const me = model.me;
  if (!me || me.recallProgress <= 0) return null;
  return (
    <div class="recallbar plate" role="status">
      <span class="t-label" ref={label} />
      <span class="recallbar__track"><i ref={bar} /></span>
    </div>
  );
}

/** down: "Back in 12 s", and where the mode allows it, a reminder that the shop is open */
export function RespawnLine(): JSX.Element | null {
  const { cv } = useApp();
  const { model } = useHud();
  const showing = (): boolean => { const me = model.me, body = model.body; return !!me && !(body && body.alive) && model.view.phase === 'live' && me.placement === undefined; };
  useViewKey(() => `${showing() ? 1 : 0}|${model.me?.canShop ? 1 : 0}`);
  const line = useRef<HTMLSpanElement>(null);
  useWriter(() => { const me = model.me; if (me && showing()) put(line.current, cv.t('hud.dead.respawn', 'Back in {t}', { t: fmtWait(Math.ceil(me.respawnIn)) })); });
  const me = model.me;
  if (!me || !showing()) return null;
  return (
    <div class="respawn" role="status">
      <span class="t-h2" ref={line} />
      {me.canShop ? <span class="t-caption muted">{cv.t('hud.dead.shop', 'You can still shop while you wait.')}</span> : null}
    </div>
  );
}
