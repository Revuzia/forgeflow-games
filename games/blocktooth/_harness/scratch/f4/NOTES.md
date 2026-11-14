# F4 UI polish — working notes (disk survives)
start 11:10. dev server port 5294 (BT_FROZEN=1 npx vite --port 5294 --strictPort)
baseline: probe_icons PASS 1388 checks; probe_meta PASS 2568 checks (483 s)
items: [1] markers out of HUD rects [2] UPROAR hint timing [3] HP > max [4] powerup token colour+shape
[5] SIZE goal 0-based [6] goals too fast (5-8 in first run) [7] bar glyph repeats + dark-on-dark [8] toasts over modals
11:35 DONE(code, unverified in browser): [3] hud.ts hpReadout (cause: ceil(hp) vs round(maxHp); sim never hp>maxHp: firstrun_before.txt "hp > maxHp ticks: 0")
  [1] markers.ts HUD keep-out rects + keepOut() solver + cream disc  [8]+[2] toast.ts modal gate/keyed/front/alive; abilitybar hint uses it
  [5] meta/goals.ts goalParts peakRank +1 (OUTSIDE owned list, generator fix) + ui/goals.ts roman text
firstrun_before: bot first runs meet 8-15 goals (median 13). F1 lane is changing balance concurrently (bot.ts, config.ts...).
12:00 resumed: remaining [4][6][7] + browser verify. firstrun 1337 rerun -> fr_1337_now.txt
12:10 [4] powerupview: per-kind silhouette+colour, ink core, camera-facing wobble (backPay green, demolition orange; tracker.ts POWERUP_COLOR not owned -> gap)
12:35 [6] goals retuned (fr_1337_after2.txt); [7] icons barGlyphs/barFill + abilitybar wired
12:50 goals final: kills1600 ults16 blocks130 pu11 obj14 vac750 hook45 heal2400 props6500 overload8 tier4 .9 boats520 -> fr_1337_after3.txt stretch median 1
13:10 wrote f4_verify.py (browser checks), running
13:45 tokens verified (shots tokens_a/b_zoom), markers 0 hits, hint ok, modal ok, goals II/III ok; goals unlock chips -> cream (dark-on-dark). final full verify run next
14:05 reverted kills/ults/powerups to 1000/10/8 (probe_meta G(a) supply cap); rerun firstrun + probe_meta
14:25 playtest_v2: 10/11 PASS, step10 FAIL SHORT cine 9.84s wall (camera/cine not mine; GPU contended)
14:45 DONE. probe_icons PASS 2178; probe_meta FAIL 2 (hb/lockwater supply 996<1000, 6<8 at ORIGINAL targets; baseline 11:18 had 1286/9, hb/lockwater now clears 413s vs 490s — other lane's pacing); firstrun median 11 (was 13); server stopped
