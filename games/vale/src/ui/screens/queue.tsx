// VALE UI — Queue + READY CHECK (client_hud §3.3). Searching: a slow ring, "Searching · 1:24 · usually
// under 2:00" (SessionEvent.elapsed / estimate, counted locally between events), Cancel search (Esc
// does the same). Found: the ready check over the search — a timed ring (readyTimer of readyMax, HARM
// in the last 5 s), Ready (chalk) and Decline; after Ready, "Waiting for the others · 3 of 5 ready".
// Esc never declines (no accidental decline). ui_queue_pop plays on found (state.ts), ui_accept on Ready,
// ui_queue_search as a soft pulse every 8 s while searching.

import type { JSX } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useApp, useEsc } from '../app_ctx.ts';
import { Button } from '../components/Button.tsx';
import { ModeMarkGlyph } from '../components/Glyphs.tsx';
import { Ring } from '../components/Ring.tsx';
import { Screen } from '../components/Screen.tsx';
import { fmtClock, fmtWait } from '../format.ts';
import { animateIn } from '../motion.ts';

export function QueueScreen(): JSX.Element {
  const { cv, state, session, sound, router } = useApp();
  const q = state.queue.value;
  const queue = cv.queue(q?.queue ?? state.lastRequest.value?.queue);
  const mode = cv.mode(queue?.mode);
  const searching = q?.state === 'searching';
  const found = q?.state === 'found' || q?.state === 'accepted';
  // local elapsed clock between session updates
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 250);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!searching) return;
    const t = setInterval(() => sound.play('queue_search'), 8000);
    return () => clearInterval(t);
  }, [searching]);
  const elapsed = searching || q?.elapsed === undefined ? Math.max(0, (performance.now() - state.searchStartedAt.value) / 1000) : q.elapsed;
  const cancel = (): void => { sound.play('back'); session.cancelQueue(); };
  useEsc(() => {
    if (found) return true;            // the ready check ignores Esc
    if (searching) { cancel(); return true; }
    router.reset('play', {}, 'back');
    return true;
  });
  const idle = !q || q.state === 'idle' || q.state === 'declined';
  return (
    <Screen kicker={mode ? `${mode.name}${queue ? ` · ${queue.name}` : ''}` : undefined} title={cv.t('queue.title', 'Finding a match')}
      foot={<span class="t-body-s muted">{cv.t('queue.bots_note', 'Open seats are filled with bots.')}</span>}
      cta={<Button variant="chalk" size="l" cue="back" onPress={idle ? () => router.reset('play', {}, 'back') : cancel} data-autofocus="" disabled={found} reason={cv.t('ready.timeout_note', 'If the timer runs out, you leave the queue.')}>
        {idle ? cv.t('common.back', 'Back') : cv.t('btn.cancel_search', 'Cancel search')}
      </Button>}>
      <div class="queue">
        <div class="qring stg" role="status" aria-live="polite">
          <div class="qring__spin" aria-hidden="true" />
          <div class="qring__face">
            {mode ? <ModeMarkGlyph mark={cv.modeMark(mode)} lanes={cv.laneCount(mode)} ticks={cv.seatsOf(mode)} size={72} class="qring__mark" /> : null}
            <span class="t-num-clock num">{fmtClock(elapsed)}</span>
          </div>
        </div>
        <p class="t-body-l queue__line stg">
          {idle ? cv.t('queue.idle', 'Not in a queue.')
            : q?.estimate !== undefined ? cv.t('queue.searching', 'Searching · {elapsed} · usually under {estimate}', { elapsed: fmtWait(elapsed), estimate: fmtWait(q.estimate) })
              : cv.t('queue.searching_short', 'Searching · {elapsed}', { elapsed: fmtWait(elapsed) })}
        </p>
        {queue ? <p class="t-body-s muted queue__desc stg">{queue.desc}</p> : null}
      </div>
      {found && q ? <ReadyCheck /> : null}
    </Screen>
  );
}

function ReadyCheck(): JSX.Element {
  const { cv, state, session, sound } = useApp();
  const q = state.queue.value!;
  const queue = cv.queue(q.queue);
  const mode = cv.mode(queue?.mode);
  const accepted = state.accepted.value || q.state === 'accepted';
  const panel = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const ready = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    animateIn(scrim.current, { from: 'none', d: 'base' });
    animateIn(panel.current, { from: 'scale', d: 'base' });
    ready.current?.focus({ preventScroll: true });
  }, []);
  const left = q.readyTimer ?? 0;
  const max = q.readyMax ?? 10;
  const accept = (): void => { sound.play('accept'); session.acceptMatch(); state.accepted.value = true; };
  const decline = (): void => { sound.play('back'); if (session.declineMatch) session.declineMatch(); else session.cancelQueue(); };
  const trap = (e: KeyboardEvent): void => {
    if (e.key !== 'Tab' || !panel.current) return;
    const els = [...panel.current.querySelectorAll<HTMLElement>('button:not([aria-disabled="true"])')];
    if (!els.length) return;
    const i = els.indexOf(document.activeElement as HTMLElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); els[els.length - 1].focus(); }
    else if (!e.shiftKey && i === els.length - 1) { e.preventDefault(); els[0].focus(); }
  };
  return (
    <div class="modal-layer modal-layer--urgent readycheck" role="presentation">
      <div ref={scrim} class="modal-scrim" />
      <div ref={panel} class="modal plate plate--raised modal--s ready" role="alertdialog" aria-modal="true" aria-labelledby="ready-title" aria-describedby="ready-sub" onKeyDown={trap}>
        <div class="ready__ring">
          <Ring size={168} stroke={6} timer={{ left, max, paused: false }} kind="solid" tone="chalk" showSeconds label={cv.t('a11y.timer_low', 'Time is running out')} />
        </div>
        <h2 id="ready-title" class="t-display-m ready__title">{cv.t('ready.title', 'Match found')}</h2>
        <p id="ready-sub" class="t-body ready__sub">
          {cv.t('ready.sub', '{mode} · {queue}. Ready in {t}.', { mode: mode?.name ?? '', queue: queue?.name ?? '', t: fmtWait(Math.ceil(left)) })}
        </p>
        {accepted ? (
          <div class="ready__wait" role="status">
            <span class="t-label">{cv.t('ready.accepted', 'You are ready.')}</span>
            {q.total ? <span class="t-body-s muted">{(q.accepted ?? 1) >= q.total ? cv.t('ready.all', 'Everyone is ready. Starting.') : cv.t('ready.waiting', 'Waiting for the others · {n} of {m} ready', { n: q.accepted ?? 1, m: q.total })}</span> : null}
            {q.total ? <span class="ready__pips" aria-hidden="true">{Array.from({ length: q.total }, (_, i) => <i class={i < (q.accepted ?? 1) ? 'is-on' : ''} />)}</span> : null}
          </div>
        ) : (
          <div class="ready__actions">
            <Button variant="quiet" cue={null} onPress={decline}>{cv.t('ready.decline', 'Decline')}</Button>
            <Button variant="chalk" size="l" wedge cue={null} innerRef={ready} onPress={accept}>{cv.t('ready.accept', 'Ready')}</Button>
          </div>
        )}
        <p class="t-caption quiet ready__note">{cv.t('ready.timeout_lock', 'Declining or missing the check can lock you out of the queue for a short time.')}</p>
      </div>
    </div>
  );
}
