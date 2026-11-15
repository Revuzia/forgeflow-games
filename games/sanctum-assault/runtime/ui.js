// Menus, HUD, radial cooldowns, banners
import { CLASSES, ARENAS, HISCORE_KEY, CAMPAIGN_PROGRESS_KEY, HEAL_GOLD_COST } from './data.js';

export function createUI(handlers) {
  const els = {
    loading: document.getElementById('loading'),
    menu: document.getElementById('menu'),
    classSelect: document.getElementById('class-select'),
    arenaSelect: document.getElementById('arena-select'),
    pauseMenu: document.getElementById('pause-menu'),
    result: document.getElementById('result-screen'),
    hud: document.getElementById('hud'),
    hearts: document.getElementById('hearts'),
    gold: document.getElementById('gold-val'),
    score: document.getElementById('score-val'),
    combo: document.getElementById('combo-val'),
    wave: document.getElementById('wave-val'),
    arenaName: document.getElementById('arena-name'),
    playerName: document.getElementById('player-name'),
    portrait: document.getElementById('portrait'),
    hiscore: document.getElementById('menu-hiscore'),
    resultTitle: document.getElementById('result-title'),
    resultSub: document.getElementById('result-sub'),
    resultScore: document.getElementById('result-score'),
    btnNext: document.getElementById('btn-next-arena'),
    modeBtn: document.getElementById('mode-btn'),
    blockBtn: document.getElementById('block-btn'),
    modeLabel: document.getElementById('mode-label'),
    hint: document.getElementById('hint-bar'),
    classCards: document.getElementById('class-cards'),
    arenaCards: document.getElementById('arena-cards'),
  };

  function show(el) {
    if (!el) return;
    el.classList.remove('hidden');
    if (el === els.hud) el.style.display = '';
    else el.style.display = '';
  }

  function hide(el) {
    if (!el) return;
    el.classList.add('hidden');
    if (el === els.hud) el.style.display = 'none';
  }

  function hideAllOverlays() {
    hide(els.menu);
    hide(els.classSelect);
    hide(els.arenaSelect);
    hide(els.pauseMenu);
    hide(els.result);
  }

  function getHiscore() {
    try {
      return parseInt(localStorage.getItem(HISCORE_KEY) || '0', 10) || 0;
    } catch {
      return 0;
    }
  }

  function setHiscore(score) {
    const prev = getHiscore();
    if (score > prev) {
      try {
        localStorage.setItem(HISCORE_KEY, String(score));
      } catch {
        /* ignore */
      }
      return score;
    }
    return prev;
  }

  function getCampaignBest() {
    try {
      return parseInt(localStorage.getItem(CAMPAIGN_PROGRESS_KEY) || '0', 10) || 0;
    } catch {
      return 0;
    }
  }

  function refreshHiscore() {
    if (!els.hiscore) return;
    const best = getHiscore().toLocaleString();
    const camp = getCampaignBest();
    const campTxt = camp > 0 ? ` · Campaign best: ${camp}/${ARENAS.length}` : '';
    els.hiscore.textContent = `Best: ${best}${campTxt}`;
  }

  // Class cards
  if (els.classCards) {
    els.classCards.innerHTML = '';
    for (const c of Object.values(CLASSES)) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'class-card';
      card.innerHTML = `<div class="emoji">${c.emoji}</div><h3>${c.name}</h3><p>${c.blurb}</p>`;
      card.addEventListener('click', () => handlers.onClassPick?.(c.id));
      els.classCards.appendChild(card);
    }
  }

  // Arena cards
  if (els.arenaCards) {
    els.arenaCards.innerHTML = '';
    ARENAS.forEach((a, i) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'arena-card';
      card.innerHTML = `<div class="emoji">${a.emoji}</div><h3>${a.name}</h3><p>${a.blurb}</p>`;
      card.addEventListener('click', () => handlers.onArenaPick?.(i));
      els.arenaCards.appendChild(card);
    });
  }

  document.getElementById('btn-campaign')?.addEventListener('click', () => handlers.onCampaign?.());
  document.getElementById('btn-arena-select')?.addEventListener('click', () => handlers.onArenaSelectMenu?.());
  document.getElementById('btn-class-back')?.addEventListener('click', () => handlers.onBackMenu?.());
  document.getElementById('btn-arena-back')?.addEventListener('click', () => handlers.onBackClass?.());
  document.getElementById('btn-resume')?.addEventListener('click', () => handlers.onResume?.());
  document.getElementById('btn-quit-menu')?.addEventListener('click', () => handlers.onQuitMenu?.());
  document.getElementById('btn-restart')?.addEventListener('click', () => handlers.onRestart?.());
  document.getElementById('btn-next-arena')?.addEventListener('click', () => handlers.onNextArena?.());
  document.getElementById('btn-result-menu')?.addEventListener('click', () => handlers.onQuitMenu?.());

  function showMenu() {
    hideAllOverlays();
    hide(els.hud);
    show(els.menu);
    refreshHiscore();
  }

  function showClassSelect() {
    hideAllOverlays();
    show(els.classSelect);
  }

  function showArenaSelect() {
    hideAllOverlays();
    show(els.arenaSelect);
  }

  function showPause() {
    show(els.pauseMenu);
  }

  function hidePause() {
    hide(els.pauseMenu);
  }

  function showHud() {
    hideAllOverlays();
    show(els.hud);
    if (els.hint) {
      els.hint.classList.remove('hidden');
      setTimeout(() => els.hint?.classList.add('hidden'), 5000);
    }
  }

  function showResult({ title, sub, score, showNext }) {
    hide(els.hud);
    show(els.result);
    const prevBest = getHiscore();
    const newBest = score > prevBest;
    setHiscore(score);
    if (els.resultTitle) els.resultTitle.textContent = title;
    if (els.resultSub) {
      const bestLine = newBest
        ? ` ★ NEW BEST: ${score.toLocaleString()}!`
        : ` Best: ${Math.max(prevBest, score).toLocaleString()}`;
      els.resultSub.textContent = (sub || '') + bestLine;
    }
    if (els.resultScore) {
      els.resultScore.textContent = score.toLocaleString();
      els.resultScore.style.textShadow = newBest
        ? '0 0 24px rgba(240,193,75,.95)'
        : '';
    }
    if (els.btnNext) els.btnNext.style.display = showNext ? '' : 'none';
  }

  function hideLoading() {
    hide(els.loading);
  }

  function updateHud(state) {
    if (!els.hud || els.hud.classList.contains('hidden')) return;

    if (els.hearts) {
      const hp = Math.max(0, state.hp);
      const max = state.maxHp;
      els.hearts.textContent = '❤'.repeat(hp) + '♡'.repeat(Math.max(0, max - hp));
    }
    if (els.gold) els.gold.textContent = String(state.gold || 0);
    if (els.score) els.score.textContent = (state.score || 0).toLocaleString();
    if (els.combo) {
      if (state.combo > 1) {
        els.combo.textContent = `${state.combo}x COMBO`;
        els.combo.classList.add('pulse');
        clearTimeout(els.combo._t);
        els.combo._t = setTimeout(() => els.combo.classList.remove('pulse'), 120);
      } else {
        els.combo.textContent = '';
      }
    }
    if (els.wave) els.wave.textContent = `WAVE ${state.wave}/${state.waveTotal}`;
    if (els.arenaName) els.arenaName.textContent = state.arenaName || '';
    if (els.playerName) els.playerName.textContent = state.className || '';
    if (els.portrait) els.portrait.textContent = state.emoji || '⚔';

    // Ability buttons
    const labels = state.abilityLabels;
    if (labels) {
      const basicBtn = document.querySelector('.ability-btn[data-slot="0"]');
      if (basicBtn && labels.basic) {
        basicBtn.querySelector('.icon').textContent = labels.basic.icon || '⚔';
        basicBtn.querySelector('.label').textContent = 'ATK';
      }
      for (let i = 1; i <= 3; i++) {
        const btn = document.querySelector(`.ability-btn[data-slot="${i}"]`);
        const ab = labels.abilities?.[i - 1];
        if (btn && ab) {
          btn.querySelector('.icon').textContent = ab.icon || String(i);
          btn.querySelector('.label').textContent = ab.name.split(' ')[0];
        }
      }
      if (els.modeBtn) {
        els.modeBtn.style.display = labels.dualMode ? '' : 'none';
        if (labels.modeLabel) {
          els.modeBtn.querySelector('.label').textContent = labels.modeLabel;
          els.modeBtn.querySelector('.icon').textContent = labels.modeLabel === '2H' ? '⚔' : '🛡';
        }
      }
      if (els.blockBtn) {
        els.blockBtn.style.display = labels.canBlock ? '' : 'none';
      }
      if (els.modeLabel) {
        if (labels.dualMode) {
          els.modeLabel.style.display = '';
          els.modeLabel.classList.remove('hidden');
          els.modeLabel.textContent = labels.modeLabel === '2H' ? 'Mode: Two-Handed' : 'Mode: Sword & Shield';
        } else {
          els.modeLabel.style.display = 'none';
        }
      }
    }

    // Radial cooldowns
    for (let i = 0; i < 4; i++) {
      const btn = document.querySelector(`.ability-btn[data-slot="${i}"]`);
      if (!btn) continue;
      const ring = btn.querySelector('.cd-ring');
      const cd = state.cds?.[i] || 0;
      const max = state.cdMax?.[i] || 1;
      if (cd > 0) {
        const pct = (1 - cd / max) * 100;
        ring?.classList.remove('hidden');
        if (ring) ring.style.setProperty('--cd', `${pct}%`);
        btn.classList.remove('ready');
      } else {
        ring?.classList.add('hidden');
        if (i > 0) btn.classList.add('ready');
      }
    }

    // Heal affordance
    const healBtn = document.getElementById('btn-heal');
    if (healBtn) {
      const can = !!state.canHeal;
      healBtn.classList.toggle('ready', can);
      healBtn.classList.toggle('dim', !can);
      const cost = state.healCost || HEAL_GOLD_COST;
      healBtn.title = can
        ? `Heal 1❤ for ${cost}◈ (H)`
        : `Need ${cost}◈ and missing HP (H)`;
      const costEl = healBtn.querySelector('.label');
      if (costEl) costEl.textContent = `${cost}◈`;
    }
  }

  refreshHiscore();

  return {
    showMenu,
    showClassSelect,
    showArenaSelect,
    showPause,
    hidePause,
    showHud,
    showResult,
    hideLoading,
    updateHud,
    getHiscore,
    setHiscore,
    refreshHiscore,
  };
}
