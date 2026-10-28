// VALE UI — Profile (client_hud §3.11): Overview (display name + Change name, level and XP, the wallet
// with its recent ledger lines, skins owned, record, most played, reset), History (the last 50 matches;
// empty: one drawing, one sentence, one action), Rating (tier emblem, rating, peak, games, next tier,
// placement progress; locked below the ranked level). Reset says exactly what returns to defaults.

import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { LedgerEntry, MatchHistoryEntry, Profile } from '../../contracts/session.ts';
import type { CatalogView } from '../catalog_view.ts';
import { useApp } from '../app_ctx.ts';
import { Button } from '../components/Button.tsx';
import { Currency } from '../components/Currency.tsx';
import { ClassGlyph, classShapeOf, Icon } from '../components/Glyphs.tsx';
import { confirmDialog } from '../components/Modal.tsx';
import { Portrait } from '../components/Portrait.tsx';
import { RankEmblem } from '../components/RankEmblem.tsx';
import { Screen, Section } from '../components/Screen.tsx';
import { EmptyState } from '../components/States.tsx';
import { Tabs } from '../components/Tabs.tsx';
import { fmtClock, fmtInt, fmtSigned, fmtWhen } from '../format.ts';
import { RESULTS_CAP } from '../state.ts';

const xpToNext = (level: number): number => 100 + 25 * (level - 1);   // CONTRACT §7 grants

export function ProfileScreen(p: { params: Record<string, string> }): JSX.Element {
  const { cv, router, state, overlay, session } = useApp();
  const tab = ['overview', 'history', 'rating'].includes(p.params.tab) ? p.params.tab : 'overview';
  const profile = state.profile.value;
  const rename = (): void => openRename(overlay, cv, profile.identity.displayName, (n) => { session.rename(n); state.toast(cv.t('toast.name_changed', 'Name changed to {name}.', { name: n }), 'ok'); });
  return (
    <Screen title={cv.t('profile.title', 'Profile')}
      foot={<span class="t-body-s muted">{cv.t('profile.storage_note', 'Your profile is saved in this browser only.')} · {cv.t('profile.seen_version', 'Content version {version}', { version: cv.version })}</span>}
      cta={tab === 'overview' ? <Button variant="chalk" size="l" icon="edit" onPress={rename}>{cv.t('profile.rename', 'Change name')}</Button> : null}>
      <Tabs label={cv.t('profile.title', 'Profile')} value={tab} onChange={(id) => router.setParams({ tab: id })} items={[
        { id: 'overview', label: cv.t('profile.tab.overview', 'Overview') },
        { id: 'history', label: cv.t('profile.tab.history', 'History'), badge: profile.history.length },
        { id: 'rating', label: cv.t('profile.tab.rating', 'Rating') },
      ]} />
      <div class="tabpanel">
        {tab === 'overview' ? <Overview /> : tab === 'history' ? <History /> : <Rating />}
      </div>
    </Screen>
  );
}

function openRename(overlay: ReturnType<typeof useApp>['overlay'], cv: ReturnType<typeof useApp>['cv'], current: string, done: (n: string) => void): void {
  overlay.open({ title: cv.t('profile.rename', 'Change name'), size: 's', render: (close) => <RenameForm current={current} onDone={(n) => { done(n); close(); }} onCancel={close} /> });
}

function RenameForm(p: { current: string; onDone: (n: string) => void; onCancel: () => void }): JSX.Element {
  const { cv, sound } = useApp();
  const [v, setV] = useState(p.current);
  const [err, setErr] = useState<string | null>(null);
  const submit = (e?: Event): void => {
    e?.preventDefault();
    const n = v.trim();
    const why = n.length < 2 ? cv.t('error.rename.short', 'Names need at least 2 characters.') : n.length > 16 ? cv.t('error.rename.long', 'Names can be up to 16 characters.') : n === p.current ? cv.t('error.rename.same', 'That is already your name.') : null;
    if (why) { setErr(why); sound.play('error'); return; }
    sound.play('confirm');
    p.onDone(n);
  };
  return (
    <form class="confirm" onSubmit={submit}>
      <div class="confirm__body">
        <label class="field">
          <span class="t-label">{cv.t('profile.name', 'Display name')}</span>
          <input class={`input t-body ${err ? 'is-error' : ''}`} value={v} maxLength={24} autoFocus data-autofocus="" aria-invalid={err ? 'true' : undefined} aria-describedby="rename-hint"
            onInput={(e) => { setV((e.currentTarget as HTMLInputElement).value); setErr(null); }} />
          <span id="rename-hint" class={`t-caption ${err ? 'reason--err' : 'muted'}`}>{err ?? cv.t('profile.name_hint', '2 to 16 characters.')}</span>
        </label>
      </div>
      <div class="confirm__actions">
        <Button variant="quiet" cue="back" onPress={p.onCancel}>{cv.t('common.cancel', 'Cancel')}</Button>
        <Button variant="chalk" type="submit" cue={null}>{cv.t('common.save', 'Save')}</Button>
      </div>
    </form>
  );
}

function ledgerLabel(cv: ReturnType<typeof useApp>['cv'], e: LedgerEntry): string {
  if (e.reason === 'purchase') { const s = cv.skin(cv.offer(e.ref)?.ref); return s ? s.name : cv.t('profile.ledger.purchase', 'Purchase'); }
  const fall: Record<LedgerEntry['reason'], string> = { match_grant: 'Match reward', first_win: 'First win of the day', purchase: 'Purchase', starter: 'Starting Candles', refund: 'Refund', migration: 'Carried over' };
  return cv.t(e.reason === 'first_win' ? 'grant.first_win' : `profile.ledger.${e.reason}`, fall[e.reason]);
}

function Overview(): JSX.Element {
  const { cv, router, state, session, overlay } = useApp();
  const profile = state.profile.value;
  const cur = cv.earnedCurrency();
  const need = xpToNext(profile.level);
  const wins = profile.history.filter((h) => h.won).length;
  const losses = profile.history.length - wins;
  const counts = new Map<string, number>();
  for (const h of profile.history) counts.set(h.fighter, (counts.get(h.fighter) ?? 0) + 1);
  const fav = [...counts].sort((a, b) => b[1] - a[1])[0];
  const favF = cv.fighter(fav?.[0]);
  const owned = profile.owned.filter((o) => o.kind === 'skin' && cv.skin(o.ref)?.tier !== 'base').length;
  const total = cv.c.skins.filter((s) => s.tier !== 'base').length;
  const ledger = [...profile.ledger].reverse().slice(0, 6);
  const emblems = emblemsOf(cv, profile);
  const chosen = emblems.find((e) => e.id === state.prefs.value.emblem && e.earned) ?? emblems[0];
  const reset = (): void => {
    void confirmDialog(overlay, {
      title: cv.t('profile.reset.title', 'Reset your profile'), body: cv.t('profile.reset.body', "This returns your Candles, skins, history and settings to a new account's. It cannot be undone."),
      confirm: cv.t('profile.reset.confirm', 'Reset profile'), cancel: cv.t('profile.reset.cancel', 'Keep my profile'), tone: 'danger',
    }).then((yes) => { if (yes) { session.resetProfile(); state.toast(cv.t('toast.profile_reset', 'Profile reset.'), 'ok'); } });
  };
  return (
    <div class="prof">
      <section class="prof__id plate pad-l stg">
        <span class={`prof__avatar emb emb--${chosen.kind}`} title={chosen.name}>{chosen.draw(56)}</span>
        <div class="stack stack--s prof__idtext">
          <h2 class="t-display-m">{profile.identity.displayName}</h2>
          <span class="t-label muted">{cv.t('profile.level', 'Level {n}', { n: profile.level })}</span>
          <div class="bar-line bar-line--gloam" role="progressbar" aria-valuemin={0} aria-valuemax={need} aria-valuenow={profile.xp} aria-label={cv.t('profile.xp', '{xp} of {next} XP to level {n}', { xp: profile.xp, next: need, n: profile.level + 1 })}>
            <span class="bar-line__fill" style={{ width: `${Math.min(100, (profile.xp / need) * 100)}%` }} />
          </div>
          <span class="t-caption muted fig">{cv.t('profile.xp', '{xp} of {next} XP to level {n}', { xp: fmtInt(profile.xp), next: fmtInt(need), n: profile.level + 1 })}</span>
        </div>
        <EmblemPicker list={emblems} chosen={chosen.id} onPick={(id) => state.setPrefs({ emblem: id })} />
      </section>
      <div class="prof__grid">
        <Section title={cv.t('profile.wallet', 'Wallet')} class="plate pad-l">
          {cur ? <Currency id={cur.id} amount={profile.wallet[cur.id] ?? 0} size="l" showName /> : null}
          <ul class="ledger ledger--compact">
            {ledger.map((e) => (
              <li class="ledger__row is-in">
                <span class="t-body-s">{ledgerLabel(cv, e)}<span class="t-caption muted"> · {fmtWhen(e.at)}</span></span>
                <span class={`num t-body-s ${e.delta >= 0 ? 'is-up' : 'is-down'}`}>{fmtSigned(e.delta)}</span>
              </li>
            ))}
          </ul>
        </Section>
        <Section title={cv.t('profile.record', 'Record')} class="plate pad-l">
          <dl class="stats stats--2">
            <div><dt class="t-caption">{cv.t('profile.record', 'Record')}</dt><dd class="t-body">{cv.t('profile.record_line', '{wins} wins · {losses} losses', { wins, losses })}</dd></div>
            <div><dt class="t-caption">{cv.t('profile.matches_label', 'Matches played')}</dt><dd class="num">{profile.history.length}</dd></div>
            <div><dt class="t-caption">{cv.t('profile.favourite', 'Most played')}</dt><dd class="t-body">{favF ? <span class="row row--s row--nowrap"><Portrait fighter={favF} size="xs" />{favF.name}</span> : '—'}</dd></div>
            <div><dt class="t-caption">{cv.t('collection.tab.skins', 'Skins')}</dt><dd class="t-body">{cv.t('collection.skins_owned', '{n} of {m} skins owned', { n: owned, m: total })}</dd></div>
          </dl>
          <div class="row"><Button variant="quiet" size="s" iconAfter="arrow" onPress={() => router.go('collection', { tab: 'skins' }, { root: true })}>{cv.t('collection.title', 'Collection')}</Button></div>
        </Section>
      </div>
      <div class="row prof__danger">
        <Button variant="quiet" size="s" icon="reroll" onPress={reset}>{cv.t('profile.reset.title', 'Reset your profile')}</Button>
      </div>
    </div>
  );
}

function History(): JSX.Element {
  const { cv, router, state } = useApp();
  const h = state.profile.value.history;
  if (!h.length) return <EmptyState text={cv.t('profile.history.empty', 'No matches yet. Play one and it will be kept here.')} action={{ label: cv.t('btn.play', 'Play'), run: () => router.go('play', {}, { root: true }) }} />;
  return (
    <div class="hist">
      <table class="hist__table">
        <thead><tr>
          <th class="t-caption">{cv.t('profile.history.col.result', 'Result')}</th>
          <th class="t-caption">{cv.t('profile.history.col.fighter', 'Fighter')}</th>
          <th class="t-caption">{cv.t('profile.history.col.mode', 'Mode')}</th>
          <th class="t-caption num">{cv.t('profile.history.col.kda', 'T / F / A')}</th>
          <th class="t-caption num">{cv.t('profile.history.col.length', 'Length')}</th>
          <th class="t-caption num">{cv.t('profile.history.col.candles', 'Candles')}</th>
          <th class="t-caption">{cv.t('profile.history.col.when', 'When')}</th>
        </tr></thead>
        <tbody>{h.map((m) => <HistRow m={m} />)}</tbody>
      </table>
      {h.length >= 50 ? <p class="t-caption muted">{cv.t('profile.history.capped', 'Showing your last {n} matches.', { n: 50 })}</p> : null}
      <p class="t-caption muted">{cv.t('profile.history.open_hint', 'Select one of your last {n} matches to see its full summary. They are kept in this browser.', { n: RESULTS_CAP })}</p>
    </div>
  );
}

function HistRow(p: { m: MatchHistoryEntry }): JSX.Element {
  const { cv, state } = useApp();
  const m = p.m;
  // client F17: a match this device kept opens its post-game (Enter or a click on the row)
  const kept = !!state.storedResult(m.matchId);
  const open = (): void => { if (kept) state.openResult(m.matchId); };
  const mode = cv.mode(m.mode);
  const q = cv.queue(m.queue);
  const ffa = cv.isFfa(mode);
  const f = cv.fighter(m.fighter);
  const candles = Object.values(m.grants.currency).reduce((a, b) => a + b, 0);
  return (
    <tr class={`hrow ${ffa ? 'is-place' : m.won ? 'is-win' : 'is-loss'} ${kept ? 'is-kept' : ''}`} onClick={kept ? open : undefined}>
      <td>{kept ? <button type="button" class="hrow__open" onClick={(e) => { e.stopPropagation(); open(); }} aria-label={cv.t('profile.history.open', 'Open the summary of this match')}><span class="hrow__res t-label">{ffa ? cv.t('profile.history.placed', '{ord} of {total}', { ord: cv.ordinal(m.placement), total: cv.seatsOf(mode) }) : m.won ? cv.t('profile.history.won', 'Victory') : cv.t('profile.history.lost', 'Defeat')}</span><Icon name="arrow" size={14} /></button>
        : <span class="hrow__res t-label">{ffa ? cv.t('profile.history.placed', '{ord} of {total}', { ord: cv.ordinal(m.placement), total: cv.seatsOf(mode) }) : m.won ? cv.t('profile.history.won', 'Victory') : cv.t('profile.history.lost', 'Defeat')}</span>}
        {m.ratingDelta !== undefined ? <span class="t-caption muted"> {cv.t('profile.history.rating_delta', 'Rating {delta}', { delta: fmtSigned(m.ratingDelta) })}</span> : null}</td>
      <td><span class="row row--s row--nowrap"><Portrait fighter={f} skin={m.skin} size="xs" /><span class="t-body-s">{f?.name}</span></span></td>
      <td class="t-body-s">{mode?.name}<span class="muted"> · {q?.name}</span></td>
      <td class="num">{m.kills} / {m.deaths} / {m.assists}</td>
      <td class="num">{fmtClock(m.duration)}</td>
      <td class="num">{candles ? `+${fmtInt(candles)}` : '—'}</td>
      <td class="t-caption muted">{fmtWhen(m.at)}</td>
    </tr>
  );
}

function Rating(): JSX.Element {
  const { cv, router, state } = useApp();
  const profile = state.profile.value;
  const qs = cv.rankedQueues();
  if (!qs.length) return <EmptyState text={cv.t('profile.rating.none', 'Play ranked RIFT to get a rating.')} />;
  const tiers = [...cv.c.ranks].sort((a, b) => a.minRating - b.minRating);
  return (
    <div class="stack stack--l">
      {qs.map((q) => {
        const rec = profile.ratings[q.ranked!.ratingId];
        const tier = cv.ratingTier(rec);
        const locked = q.unlockLevel > profile.level;
        const next = tier ? tiers[tiers.findIndex((t) => t.id === tier.id) + 1] : undefined;
        return (
          <section class="plate pad-l rating stg" aria-label={q.name}>
            <RankEmblem tier={tier} provisional={!tier} size={128} art />
            <div class="stack stack--s">
              <span class="t-label muted">{cv.mode(q.mode)?.name} · {q.name}</span>
              {locked ? <p class="t-body locknote"><Icon name="lock" size={16} />{cv.t('profile.rating.locked', 'Reach level {level} to play Ranked.', { level: q.unlockLevel })}</p>
                : !rec ? <><p class="t-body">{cv.t('profile.rating.none', 'Play ranked RIFT to get a rating.')}</p><div><Button variant="secondary" onPress={() => router.go('play', { mode: q.mode, queue: q.id }, { root: true })}>{cv.t('btn.play', 'Play')}</Button></div></>
                  : <>
                    <h2 class="t-display-m">{tier ? tier.name : cv.t('profile.rating.provisional', 'Placing · {n} of {m} matches played', { n: rec.games, m: q.ranked!.placementGames })}</h2>
                    <dl class="stats stats--4">
                      <div><dt class="t-caption">{cv.t('profile.rating.title', 'Rating')}</dt><dd class="num">{tier ? fmtInt(rec.rating) : '—'}</dd></div>
                      <div><dt class="t-caption">{cv.t('profile.rating.peak', 'Peak {n}', { n: '' }).trim()}</dt><dd class="num">{fmtInt(rec.peak)}</dd></div>
                      <div><dt class="t-caption">{cv.t('profile.rating.games', '{n} ranked matches', { n: '' }).trim()}</dt><dd class="num">{rec.games}</dd></div>
                      <div><dt class="t-caption">{cv.t('profile.record', 'Record')}</dt><dd class="num">{rec.wins} / {rec.games - rec.wins}</dd></div>
                    </dl>
                    <p class="t-body-s muted">{tier && next ? cv.t('profile.rating.next', '{n} rating to {tier}', { n: fmtInt(Math.max(0, next.minRating - rec.rating)), tier: next.name }) : tier ? cv.t('profile.rating.top', 'You are at the top tier.') : ''}</p>
                  </>}
            </div>
          </section>
        );
      })}
      <section class="tiers stg" aria-label={cv.t('profile.rating.tier', 'Tier')}>
        <p class="t-body-s muted">{cv.t('profile.rating.scale', 'Tiers climb with the sun, from Lamplit to Unshadowed.')}</p>
        <div class="tiers__row">
          {tiers.map((t) => <span class="tiers__t"><RankEmblem tier={t} size={48} /><span class="t-caption">{t.name}</span><span class="t-caption muted fig">{fmtInt(t.minRating)}</span></span>)}
        </div>
      </section>
    </div>
  );
}

// ── client F17: earnable emblems ──────────────────────────────────────────────────────────────────
/** an emblem: what the avatar shows. Earned from the profile itself (never bought): the First lamp from the start, a
 *  class mark for each class you have won a match with, the Tenth hour at level 10, and your best ranked tier once
 *  placed. The choice is kept per device (UiPrefs.emblem) until the Profile carries it. */
export interface Emblem { id: string; kind: 'lamp' | 'class' | 'hour' | 'rank'; name: string; how: string; earned: boolean; draw: (px: number) => JSX.Element }

export function emblemsOf(cv: CatalogView, profile: Profile): Emblem[] {
  const out: Emblem[] = [{ id: 'lamp', kind: 'lamp', name: cv.t('profile.emblem.lamp', 'First lamp'), how: cv.t('profile.emblem.lamp_how', 'Yours from the start.'), earned: true, draw: (px) => <LampEmblem px={px} /> }];
  const won = new Set(profile.history.filter((h) => h.won).map((h) => cv.fighter(h.fighter)?.class).filter((c): c is string => !!c));
  for (const c of cv.c.classes) {
    const shape = classShapeOf(c.shape, c.name);
    out.push({ id: `class:${c.id}`, kind: 'class', name: cv.t('profile.emblem.class', '{cls} mark', { cls: c.name }), how: cv.t('profile.emblem.class_how', 'Win a match as a {cls}.', { cls: c.name }), earned: won.has(c.id),
      draw: (px) => (shape ? <ClassGlyph shape={shape} size={Math.round(px * 0.6)} /> : <LampEmblem px={px} />) });
  }
  out.push({ id: 'hour10', kind: 'hour', name: cv.t('profile.emblem.hour10', 'Tenth hour'), how: cv.t('profile.emblem.hour10_how', 'Reach level 10.'), earned: profile.level >= 10, draw: (px) => <HourEmblem px={px} hour={10} /> });
  const tiers = Object.values(profile.ratings).map((r) => cv.ratingTier(r)).filter((t): t is NonNullable<typeof t> => !!t).sort((a, b) => b.minRating - a.minRating);
  const best = tiers[0];
  out.push({ id: 'rank', kind: 'rank', name: best ? best.name : cv.t('profile.emblem.rank', 'Ranked tier'), how: cv.t('profile.emblem.rank_how', 'Finish your ranked placement matches.'), earned: !!best,
    draw: (px) => <RankEmblem tier={best} provisional={!best} size={Math.round(px * 0.8)} /> });
  return out;
}

function EmblemPicker(p: { list: Emblem[]; chosen: string; onPick: (id: string) => void }): JSX.Element {
  const { cv, sound } = useApp();
  const n = p.list.filter((e) => e.earned).length;
  return (
    <div class="emblems" role="radiogroup" aria-label={cv.t('profile.emblem.title', 'Emblem')}>
      <span class="t-label muted emblems__head">{cv.t('profile.emblem.title', 'Emblem')} <span class="fig">{cv.t('profile.emblem.count', '{n} of {m} earned', { n, m: p.list.length })}</span></span>
      <div class="emblems__row" data-arrownav="grid">
        {p.list.map((e) => (
          <button type="button" role="radio" data-nav="" aria-checked={p.chosen === e.id} aria-disabled={e.earned ? undefined : 'true'}
            class={`emb emb--${e.kind} emblems__opt ${p.chosen === e.id ? 'is-selected' : ''} ${e.earned ? '' : 'is-locked'}`}
            title={`${e.name} · ${e.how}`} aria-label={`${e.name}. ${e.earned ? '' : e.how}`}
            onClick={() => { if (!e.earned) { sound.play('error', 200); return; } sound.play('equip'); p.onPick(e.id); }}>
            {e.draw(32)}
            {e.earned ? null : <span class="emblems__lock"><Icon name="lock" size={12} /></span>}
          </button>
        ))}
      </div>
    </div>
  );
}

/** the First lamp: a lit lamp in a ring (VALE's own mark) */
function LampEmblem(p: { px: number }): JSX.Element {
  const s = `calc(${p.px}px * var(--k))`;
  return (
    <svg viewBox="0 0 32 32" style={{ width: s, height: s }} aria-hidden="true">
      <circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" stroke-width="1.6" opacity="0.55" />
      <path d="M11 13h10l-1.6 9h-6.8z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
      <path d="M13 13c0-2 1.3-3.4 3-3.4s3 1.4 3 3.4" fill="none" stroke="currentColor" stroke-width="1.6" />
      <path d="M16 15.2c1.1 1.2 1.6 2.1 1.6 3a1.6 1.6 0 0 1-3.2 0c0-.9.5-1.8 1.6-3z" fill="var(--res-tally)" />
      <path d="M12.5 24.5h7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
    </svg>
  );
}

/** an hour emblem: the dial with its gnomon on that hour */
function HourEmblem(p: { px: number; hour: number }): JSX.Element {
  const s = `calc(${p.px}px * var(--k))`;
  const a = ((p.hour % 12) / 12) * Math.PI * 2;
  const x = 16 + Math.sin(a) * 9.5, y = 16 - Math.cos(a) * 9.5;
  return (
    <svg viewBox="0 0 32 32" style={{ width: s, height: s }} aria-hidden="true">
      <circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" stroke-width="1.6" />
      {Array.from({ length: 12 }, (_, i) => { const t = (i / 12) * Math.PI * 2; return <line x1={16 + Math.sin(t) * 11.5} y1={16 - Math.cos(t) * 11.5} x2={16 + Math.sin(t) * 13} y2={16 - Math.cos(t) * 13} stroke="currentColor" stroke-width={i === 0 ? 2 : 1} />; })}
      <line x1="16" y1="16" x2={x} y2={y} stroke="var(--res-tally)" stroke-width="2.2" stroke-linecap="round" />
      <circle cx="16" cy="16" r="1.8" fill="currentColor" />
    </svg>
  );
}
