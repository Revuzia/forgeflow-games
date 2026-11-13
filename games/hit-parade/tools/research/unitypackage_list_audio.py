"""List audio asset pathnames inside a .unitypackage (gzipped tar) without extracting.
Usage: python unitypackage_list_audio.py <pkg.unitypackage> <out.txt>
Each asset is <guid>/pathname (text) + <guid>/asset (bytes). We read only the
pathname members and record the asset member size. ASCII only.
"""
import sys, tarfile

pkg, out = sys.argv[1], sys.argv[2]
AUD = (".wav", ".ogg", ".mp3", ".aif", ".aiff", ".flac")
names = {}
sizes = {}
import gzip
# unitypackages carry a gzip FEXTRA field that tarfile's "r|gz" stream mode
# mis-parses; let the gzip module handle the header instead.
with gzip.open(pkg, "rb") as gz, tarfile.open(fileobj=gz, mode="r|") as tf:
    for m in tf:
        parts = m.name.replace("\\", "/").lstrip("./").split("/")
        if len(parts) != 2:
            continue
        guid, leaf = parts
        if leaf == "pathname":
            f = tf.extractfile(m)
            if f:
                names[guid] = f.read().decode("utf-8", "replace").splitlines()[0].strip()
        elif leaf == "asset":
            sizes[guid] = m.size
rows = []
for g, p in names.items():
    if p.lower().endswith(AUD):
        rows.append((p, sizes.get(g, -1)))
rows.sort()
with open(out, "w", encoding="utf-8") as fo:
    for p, s in rows:
        fo.write("%d\t%s\n" % (s, p))
print("audio assets:", len(rows), "total bytes:", sum(s for _, s in rows if s > 0))
