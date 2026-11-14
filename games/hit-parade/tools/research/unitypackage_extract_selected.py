"""Extract selected audio assets from a .unitypackage (read-only on the package).
Usage: python unitypackage_extract_selected.py <pkg> <out_dir> <regex> [--max N]
Streams the gzipped tar once; for each asset whose pathname matches <regex>
(case-insensitive) writes the asset bytes to <out_dir>/<basename>.
Writes <out_dir>/_extracted.json mapping basename -> original package path.
ASCII only.
"""
import sys, os, re, gzip, tarfile, json

pkg, out, rx = sys.argv[1], sys.argv[2], re.compile(sys.argv[3], re.I)
mx = int(sys.argv[sys.argv.index("--max") + 1]) if "--max" in sys.argv else 10 ** 9
os.makedirs(out, exist_ok=True)
names, pending = {}, {}
done = {}
with gzip.open(pkg, "rb") as gz, tarfile.open(fileobj=gz, mode="r|") as tf:
    for m in tf:
        parts = m.name.replace("\\", "/").lstrip("./").split("/")
        if len(parts) != 2:
            continue
        guid, leaf = parts
        if leaf == "pathname":
            f = tf.extractfile(m)
            p = f.read().decode("utf-8", "replace").splitlines()[0].strip() if f else ""
            names[guid] = p
            data = pending.pop(guid, None)
            if data is not None and rx.search(p) and len(done) < mx:
                dst = os.path.join(out, os.path.basename(p))
                open(dst, "wb").write(data)
                done[os.path.basename(p)] = p
        elif leaf == "asset":
            p = names.get(guid)
            if p is not None:
                if rx.search(p) and len(done) < mx:
                    f = tf.extractfile(m)
                    dst = os.path.join(out, os.path.basename(p))
                    open(dst, "wb").write(f.read())
                    done[os.path.basename(p)] = p
            else:
                # pathname not seen yet: keep bytes only if small (< 30 MB)
                if m.size < 30 * 1024 * 1024:
                    f = tf.extractfile(m)
                    pending[guid] = f.read()
json.dump(done, open(os.path.join(out, "_extracted.json"), "w", encoding="utf-8"), indent=1)
print("extracted", len(done))
