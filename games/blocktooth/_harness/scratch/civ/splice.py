"""splice a replacement block into civilians.ts between two marker strings (scratch helper)."""
import sys
p = 'src/render/civilians.ts'
start, end, src = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p, encoding='utf-8', newline='').read()
a = s.index(start)
b = s.index(end, a)
new = open(src, encoding='utf-8').read().replace('\r\n', '\n')
if '\r\n' in s:
    new = new.replace('\n', '\r\n')
s = s[:a] + new + ('\r\n' if '\r\n' in s else '\n') + s[b:]
open(p, 'w', encoding='utf-8', newline='').write(s)
print('spliced', len(new), 'chars')
