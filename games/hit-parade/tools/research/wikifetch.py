"""Fetch MediaWiki wikitext (Wikipedia / Fandom / other MediaWiki) via api.php and
print it, optionally only windows around keywords.

Usage:
  python wikifetch.py <api_base> <page> [keyword ...] [--win N] [--out file]
  api_base examples:
    https://en.wikipedia.org/w/api.php
    https://madworld.fandom.com/api.php
ASCII only. Read-only HTTP GET, no auth.
"""
import json
import sys
import urllib.parse
import urllib.request

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/128.0 Safari/537.36")


def fetch(api, page):
    q = urllib.parse.urlencode({"action": "parse", "page": page,
                                "prop": "wikitext", "format": "json",
                                "redirects": 1})
    req = urllib.request.Request(api + "?" + q, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=40) as r:
        d = json.loads(r.read().decode("utf-8", "replace"))
    if "parse" not in d:
        return "ERROR: " + json.dumps(d)[:400]
    return d["parse"]["wikitext"]["*"]


def main():
    args = sys.argv[1:]
    win = 1500
    out = None
    if "--win" in args:
        i = args.index("--win")
        win = int(args[i + 1])
        del args[i:i + 2]
    if "--out" in args:
        i = args.index("--out")
        out = args[i + 1]
        del args[i:i + 2]
    api, page, kws = args[0], args[1], args[2:]
    text = fetch(api, page)
    if out:
        with open(out, "w", encoding="utf-8") as f:
            f.write(text)
    if not kws:
        sys.stdout.buffer.write(text.encode("utf-8", "replace"))
        return
    low = text.lower()
    shown = []
    for kw in kws:
        start = 0
        while True:
            j = low.find(kw.lower(), start)
            if j < 0:
                break
            a, b = max(0, j - win // 3), min(len(text), j + win)
            if not any(a < e and b > s for s, e in shown):
                shown.append((a, b))
                sys.stdout.buffer.write(("\n===== [" + kw + "] @" + str(j) + "\n").encode())
                sys.stdout.buffer.write(text[a:b].encode("utf-8", "replace"))
            start = j + 1


if __name__ == "__main__":
    main()
