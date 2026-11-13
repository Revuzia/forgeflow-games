"""Fetch MediaWiki wikitext (SuperCombo, wavu.wiki, fandom, wikipedia) via api.php.

Usage:
  python fg_wikifetch.py page <api_base> <outdir> <Page_Title> [<Page_Title> ...]
  python fg_wikifetch.py search <api_base> <query>

api_base examples:
  https://wiki.supercombo.gg/api.php
  https://wavu.wiki/w/api.php
Raw wikitext is a session cache (written to outdir, normally the scratchpad);
only extracted numbers are copied into the project report, with the page URL.
ASCII only.
"""
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126 Safari/537.36")


def get(url, tries=3):
    delay = 2.0
    last = None
    for _ in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=40) as r:
                return r.status, r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            last = e
            if e.code in (400, 401, 403, 404):
                return e.code, ""
        except Exception as e:  # network / timeout -> retry
            last = e
        time.sleep(delay)
        delay *= 2
    return -1, str(last)


def safe(name):
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", name)[:120]


def fetch_page(api, outdir, title):
    q = urllib.parse.urlencode({"action": "parse", "page": title,
                                "prop": "wikitext", "format": "json",
                                "redirects": 1})
    code, body = get(api + "?" + q)
    if code != 200:
        print("FAIL %s http=%s" % (title, code))
        return
    try:
        data = json.loads(body)
    except ValueError:
        print("FAIL %s non-json (%d bytes)" % (title, len(body)))
        return
    if "error" in data:
        print("FAIL %s %s" % (title, data["error"].get("info")))
        return
    text = data["parse"]["wikitext"]["*"]
    path = os.path.join(outdir, safe(title) + ".wiki")
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)
    print("OK   %s -> %s (%d chars)" % (title, path, len(text)))


def search(api, query):
    q = urllib.parse.urlencode({"action": "query", "list": "search",
                                "srsearch": query, "srlimit": 20,
                                "format": "json"})
    code, body = get(api + "?" + q)
    if code != 200:
        print("FAIL search http=%s" % code)
        return
    for hit in json.loads(body).get("query", {}).get("search", []):
        print(hit["title"])


def main():
    mode = sys.argv[1]
    api = sys.argv[2]
    if mode == "page":
        outdir = sys.argv[3]
        os.makedirs(outdir, exist_ok=True)
        for t in sys.argv[4:]:
            fetch_page(api, outdir, t)
            time.sleep(0.7)
    elif mode == "search":
        search(api, " ".join(sys.argv[3:]))


if __name__ == "__main__":
    main()
