# .unitypackage reader (tar.gz of <guid>/{asset,asset.meta,pathname,preview.png}).
# Read-only on the source package.
#   python env_unitypkg.py list <pkg> <out.tsv>                 -> "size<TAB>pathname" per asset
#   python env_unitypkg.py extract <pkg> <regex> <out_dir> [listing.tsv]
#       extracts every asset whose pathname matches regex (case-insensitive) to out_dir/<pathname>
# ASCII only.
import sys, os, re, tarfile, json, gzip


def listing(pkg):
    guid_path, guid_size = {}, {}
    with gzip.open(pkg, "rb") as gz, tarfile.open(fileobj=gz, mode="r|") as tf:
        for m in tf:
            parts = m.name.replace("\\", "/").lstrip("./").split("/")
            if len(parts) != 2:
                continue
            g, leaf = parts
            if leaf == "pathname":
                f = tf.extractfile(m)
                guid_path[g] = f.read().decode("utf-8", "replace").splitlines()[0].strip()
            elif leaf == "asset":
                guid_size[g] = m.size
    return guid_path, guid_size


def cmd_list(pkg, out):
    gp, gs = listing(pkg)
    rows = sorted((gp[g], gs.get(g, 0), g) for g in gp if g in gs)
    with open(out, "w", encoding="utf-8") as fh:
        for p, s, g in rows:
            fh.write("%d\t%s\t%s\n" % (s, p, g))
    print("LISTED", len(rows), "assets ->", out)


def cmd_extract(pkg, rx, outdir, lst=None):
    r = re.compile(rx, re.I)
    want = {}
    if lst and os.path.exists(lst):
        for line in open(lst, encoding="utf-8"):
            s, p, g = line.rstrip("\n").split("\t")
            if r.search(p):
                want[g] = p
    else:
        gp, gs = listing(pkg)
        want = {g: p for g, p in gp.items() if g in gs and r.search(p)}
    n = 0
    with gzip.open(pkg, "rb") as gz, tarfile.open(fileobj=gz, mode="r|") as tf:
        for m in tf:
            parts = m.name.replace("\\", "/").lstrip("./").split("/")
            if len(parts) == 2 and parts[1] == "asset" and parts[0] in want:
                dst = os.path.join(outdir, want[parts[0]])
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                with open(dst, "wb") as fh:
                    fh.write(tf.extractfile(m).read())
                n += 1
    print("EXTRACTED", n, "of", len(want), "->", outdir)


def cmd_listall(pkg_list_file, outdir, nest_dir):
    """List many packages; recurse one level into nested .unitypackage (prefer BuiltIn, else first)."""
    os.makedirs(outdir, exist_ok=True)
    for pkg in [l.strip() for l in open(pkg_list_file, encoding="utf-8") if l.strip()]:
        name = os.path.splitext(os.path.basename(pkg))[0]
        out = os.path.join(outdir, name + ".tsv")
        if not os.path.exists(out):
            try:
                cmd_list(pkg, out)
            except Exception as e:
                print("FAIL", pkg, e)
                continue
        rows = [l.rstrip("\n").split("\t") for l in open(out, encoding="utf-8")]
        nested = [r for r in rows if r[1].lower().endswith(".unitypackage")]
        if nested:
            pick = [r for r in nested if "builtin" in r[1].lower()] or [r for r in nested if "urp" in r[1].lower()] or nested
            r = pick[0]
            ndir = os.path.join(nest_dir, name)
            cmd_extract(pkg, re.escape(r[1]) + "$", ndir, out)
            inner = os.path.join(ndir, r[1])
            iout = os.path.join(outdir, name + "__" + os.path.splitext(os.path.basename(r[1]))[0] + ".tsv")
            if not os.path.exists(iout):
                try:
                    cmd_list(inner, iout)
                except Exception as e:
                    print("FAIL nested", inner, e)


if __name__ == "__main__":
    if sys.argv[1] == "listall":
        cmd_listall(sys.argv[2], sys.argv[3], sys.argv[4])
    elif sys.argv[1] == "list":
        cmd_list(sys.argv[2], sys.argv[3])
    else:
        cmd_extract(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5] if len(sys.argv) > 5 else None)
