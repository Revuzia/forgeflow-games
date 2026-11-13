import os
here = os.path.dirname(os.path.abspath(__file__))
p = os.path.join(here, '..', '..', 'shots.py')
s = open(p, encoding='utf-8').read()
if 'def g_screens' in s:
    print('already patched'); raise SystemExit(0)
new = open(os.path.join(here, 'shots_groups.py.txt'), encoding='utf-8').read()
marker = '    # ─────────────────────────────── contact sheets ───────────────────────────────'
assert marker in s
s = s.replace(marker, new + marker, 1)
old = 'GROUPS = ("menus", "titans", "hud", "bosses", "tabloid", "v2fx", "v2hud", "cine")'
assert old in s
s = s.replace(old, 'GROUPS = ("menus", "titans", "hud", "bosses", "tabloid", "v2fx", "v2hud", "cine", "screens", "parkade")')
open(p, 'w', encoding='utf-8').write(s)
print('patched')
