import os
here = os.path.dirname(os.path.abspath(__file__))
p = os.path.join(here, '..', '..', 'playtest_v2.py')
s = open(p, encoding='utf-8').read()
new = open(os.path.join(here, 'steps_10_11.py.txt'), encoding='utf-8').read()
start = s.index('    def cine_available(self):')
end = s.index('    # ── driver ──')
s = s[:start] + new + s[end:]
imp = "                    owned_total, print_diagnostics, save_report, world_to_keys, xp_to_next)\n"
assert imp in s
s = s.replace(imp, imp + "from bootcheck import CROSSWALK_JS  # noqa: E402  (step 11: zebra check on the first play frame)\n", 1)
consts = '''
# Steps 10/11 (read-only DOM / module reads).
FREEZE_JS = r"""
() => { const e = document.querySelector('.bt-slate'); const f = document.querySelector('.bt-slate-freeze');
        return !!(e && f && !e.classList.contains('bt-hidden') && getComputedStyle(e).display !== 'none'); }
"""
SETTINGS_VIS_JS = r"""
() => { const e = document.querySelector('.bt-settings'); return !!(e && !e.classList.contains('bt-hidden')); }
"""
SETTINGS_READ_JS = r"""
async () => { const m = await import('/src/core/save.ts'); return m.loadSettings(); }
"""
'''
anchor = '\n\ndef bar_expect('
assert anchor in s
s = s.replace(anchor, '\n' + consts + '\n\ndef bar_expect(', 1)
old10 = " 10  settings Opening OFF / SHORT / Reduce motion  (needs the C4 cinematic; PENDING until it lands)\n 11  cinematic dismissed by a real key + zebra check   (needs the C4 cinematic; PENDING until it lands)"
assert old10 in s
s = s.replace(old10, " 10  settings (pause → SETTINGS, real keys): Opening OFF → the legacy freeze-frame slate; SHORT →\n     the v2.cine shot sequence lasts ≤ 3.2 s; Reduce motion ON (+ FULL) → no `crane` shot\n 11  the default opening is the cinematic; a real Enter dismisses it; the first play frame passes the\n     zebra check (bootcheck CROSSWALK_JS) and v2.cine is null in play")
open(p, 'w', encoding='utf-8').write(s)
print('patched')
