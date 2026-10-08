#!/usr/bin/env python3
"""test_deploy_game.py — screenshot publishing in pipeline/deploy_game.py (2026-10-08).

Locks in two behaviours:
  (a) insert_game_metadata sends games.screenshot_urls ONLY when the metadata declares a
      non-empty list of non-empty strings — the mobile_support rule — so a deploy never
      clears screenshots set by hand.
  (b) deploy_one, when the metadata has no screenshot_urls, publishes <game_dir>/screenshots/
      (.png .jpg .jpeg .webp, sorted by filename, at most 8) as CDN URLs with ?v=<md5[:8]>.
      No screenshots/ folder => no screenshot_urls key is sent at all.

HERMETIC: never touches R2, Supabase, Cloudflare, xAI or the live R2 manifest. _r2_put (the
single upload seam), purge_cf_cache, refresh_portal_prerender and urllib's urlopen are
replaced for the duration of each test; R2_MANIFEST_DIR points at a temp dir; every fake
game ships a thumbnail.png so cover generation (xAI) is never reached, and generate_cover is
stubbed anyway. Bytecode writing is off so the tracked __pycache__ is left alone.

Run:  python pipeline/test_deploy_game.py      (or: python -m pytest pipeline/test_deploy_game.py)
"""
import hashlib
import io
import json
import sys
import tempfile
import types
from contextlib import contextmanager, redirect_stdout
from pathlib import Path

sys.dont_write_bytecode = True
PIPELINE = Path(__file__).resolve().parent
sys.path.insert(0, str(PIPELINE))
import deploy_game as dg  # noqa: E402

CDN = "https://forgeflow-games-cdn.isimcha85.workers.dev"
SLUG = "zz-test-screenshots"   # not a real slug, never in state/staged_slugs.json
THUMB = b"PNG-thumbnail-bytes"
_checks = 0


def _ok(cond, msg):
    global _checks
    _checks += 1
    if not cond:
        raise AssertionError(msg)


@contextmanager
def _patched(obj, **attrs):
    """Set attributes on obj for the duration of the block, then restore them."""
    saved = {k: getattr(obj, k) for k in attrs}
    try:
        for k, v in attrs.items():
            setattr(obj, k, v)
        yield
    finally:
        for k, v in saved.items():
            setattr(obj, k, v)


# ── fake Supabase (insert_game_metadata) ─────────────────────────────────────────────

class _Resp:
    def __init__(self, body=b""):
        self._body = body

    def read(self):
        return self._body


@contextmanager
def _fake_supabase(existing=True):
    """Replace every network edge insert_game_metadata uses. Yields the list of captured
    requests; the write is the last one (PATCH for an existing game, POST for a new one)."""
    calls = []

    def fake_urlopen(req, timeout=None):
        calls.append(req)
        if req.get_method() == "GET":
            return _Resp(b'[{"id": 1}]' if existing else b"[]")
        return _Resp(b"")

    fake_cfg = {"providers": {"supabase_forgeflow": {"url": "https://supabase.invalid",
                                                     "service_role_key": "test-not-a-key"}}}
    with _patched(dg.urllib.request, urlopen=fake_urlopen), \
            _patched(dg, load_supabase_creds=lambda: {}, _read_api_config=lambda: fake_cfg):
        yield calls


def _sent_row(metadata, existing=True):
    with _fake_supabase(existing=existing) as calls:
        with redirect_stdout(io.StringIO()):   # its "[supabase] Updated" lines are about the FAKE
            ok = dg.insert_game_metadata(SLUG, dict(metadata))
    _ok(ok is True, f"insert_game_metadata returned {ok!r} against the fake Supabase")
    writes = [c for c in calls if c.get_method() in ("PATCH", "POST")]
    _ok(len(writes) == 1, f"expected exactly one write, saw {[c.get_method() for c in calls]}")
    _ok(all(c.full_url.startswith("https://supabase.invalid/") for c in calls),
        "a request left the fake Supabase host")
    return json.loads(writes[0].data.decode())


def test_insert_sends_declared_screenshots():
    shots = [f"{CDN}/{SLUG}/screenshots/01.png?v=abcdef12", f"{CDN}/{SLUG}/screenshots/02.png?v=12345678"]
    row = _sent_row({"title": "Test", "screenshot_urls": shots})
    _ok(row.get("screenshot_urls") == shots, f"declared screenshots not sent as-is: {row.get('screenshot_urls')!r}")
    row = _sent_row({"title": "Test", "screenshot_urls": shots}, existing=False)
    _ok(row.get("screenshot_urls") == shots, "a brand-new game (POST) did not get its screenshots")


def test_insert_omits_undeclared_or_invalid_screenshots():
    for meta in (
        {"title": "Test"},                                     # not declared
        {"title": "Test", "screenshot_urls": None},
        {"title": "Test", "screenshot_urls": []},              # would CLEAR hand-set screenshots
        {"title": "Test", "screenshot_urls": ["", "  "]},
        {"title": "Test", "screenshot_urls": [f"{CDN}/a.png", ""]},
        {"title": "Test", "screenshot_urls": [f"{CDN}/a.png", 7]},
        {"title": "Test", "screenshot_urls": f"{CDN}/a.png"},  # a string, not a list
    ):
        row = _sent_row(meta)
        _ok("screenshot_urls" not in row, f"screenshot_urls sent for {meta.get('screenshot_urls')!r}: {row!r}")
    # the rest of the row is unaffected
    row = _sent_row({"title": "Test", "mobile_support": "full"})
    _ok(row.get("mobile_support") == "full" and row.get("title") == "Test", f"row changed shape: {row!r}")


# ── fake deploy (deploy_one) ──────────────────────────────────────────────────────────

def _make_game(root, shots=None):
    """A minimal game folder. shots: {filename: bytes} written to screenshots/, or None for no folder."""
    gd = Path(root) / "game"
    gd.mkdir()
    (gd / "index.html").write_text("<!doctype html><html><body>test</body></html>\n", encoding="utf-8")
    (gd / "game_meta.json").write_text(json.dumps({"title": "Screenshot Test"}), encoding="utf-8")
    (gd / "thumbnail.png").write_bytes(THUMB)
    if shots is not None:
        (gd / "screenshots").mkdir()
        for name, data in shots.items():
            (gd / "screenshots" / name).write_bytes(data)
    return gd


def _deploy(gd, manifest_dir):
    """Run deploy_one with every external edge replaced. Returns (result, metadata sent, keys put)."""
    put, sent = [], []

    def fake_put(key, path):
        put.append(key)
        return True, ""

    def no_network(*a, **k):
        raise AssertionError("deploy_one reached the real network")

    def fake_insert(slug, metadata):
        sent.append((slug, dict(metadata)))
        return True

    def no_cover(**kw):
        raise AssertionError("cover generation (xAI) must not run in tests")

    cover_stub = types.ModuleType("generate_cover")
    cover_stub.generate_cover = no_cover
    prev_cover = sys.modules.get("generate_cover")
    sys.modules["generate_cover"] = cover_stub
    try:
        with _patched(dg, _r2_put=fake_put, R2_MANIFEST_DIR=Path(manifest_dir),
                      purge_cf_cache=lambda keys, host="forgeflowgames.com": True,
                      insert_game_metadata=fake_insert, refresh_portal_prerender=no_network), \
                _patched(dg.urllib.request, urlopen=no_network):
            with redirect_stdout(io.StringIO()):   # its "[r2] Uploaded" lines are about the FAKE uploader
                res = dg.deploy_one(gd, SLUG, refresh_portal=False)
    finally:
        if prev_cover is None:
            sys.modules.pop("generate_cover", None)
        else:
            sys.modules["generate_cover"] = prev_cover
    _ok(len(sent) == 1 and sent[0][0] == SLUG, f"expected one metadata upsert for {SLUG}, got {sent!r}")
    _ok(Path(manifest_dir, f"r2_manifest_{SLUG}.json").exists(), "manifest was not written to the temp dir")
    return res, sent[0][1], put


def _v(data):
    return hashlib.md5(data).hexdigest()[:8]


def test_deploy_publishes_screenshots_folder():
    shots = {
        "03-finale.webp": b"webp three",
        "01-arena.png": b"png one",
        "02-duel.JPG": b"jpg two",
        "notes.txt": b"not an image",
        "clip.gif": b"gif is not a listed type",
    }
    with tempfile.TemporaryDirectory() as tmp:
        gd = _make_game(tmp, shots)
        man = Path(tmp) / "manifest"
        man.mkdir()
        res, meta, put = _deploy(gd, man)
    _ok(res.get("ok") is True, f"deploy_one failed: {res!r}")
    want = [
        f"{CDN}/{SLUG}/screenshots/01-arena.png?v={_v(b'png one')}",
        f"{CDN}/{SLUG}/screenshots/02-duel.JPG?v={_v(b'jpg two')}",
        f"{CDN}/{SLUG}/screenshots/03-finale.webp?v={_v(b'webp three')}",
    ]
    _ok(meta.get("screenshot_urls") == want, f"screenshot_urls {meta.get('screenshot_urls')!r} != {want!r}")
    # the images themselves go up with the game (screenshots/ is not a dev-only dir)
    for name in ("01-arena.png", "02-duel.JPG", "03-finale.webp"):
        _ok(f"{SLUG}/screenshots/{name}" in put, f"screenshots/{name} was not uploaded: {put!r}")
    # unchanged neighbours: thumbnail cache-bust still derived the same way
    _ok(meta.get("thumbnail_url") == f"{CDN}/{SLUG}/thumbnail.png?v={_v(THUMB)}",
        f"thumbnail_url changed: {meta.get('thumbnail_url')!r}")


def test_deploy_caps_at_eight_sorted_by_filename():
    shots = {f"shot-{i:02d}.png": f"img {i}".encode() for i in range(12, 0, -1)}
    with tempfile.TemporaryDirectory() as tmp:
        gd = _make_game(tmp, shots)
        man = Path(tmp) / "manifest"
        man.mkdir()
        _, meta, _ = _deploy(gd, man)
    urls = meta.get("screenshot_urls") or []
    _ok(len(urls) == 8, f"expected 8 screenshot URLs, got {len(urls)}")
    names = [u.split("/screenshots/", 1)[1].split("?", 1)[0] for u in urls]
    _ok(names == [f"shot-{i:02d}.png" for i in range(1, 9)], f"not the first 8 by filename: {names!r}")


def test_deploy_without_screenshots_dir_sends_no_key():
    with tempfile.TemporaryDirectory() as tmp:
        gd = _make_game(tmp, None)
        man = Path(tmp) / "manifest"
        man.mkdir()
        _, meta, _ = _deploy(gd, man)
    _ok("screenshot_urls" not in meta, f"screenshot_urls present with no screenshots/ dir: {meta.get('screenshot_urls')!r}")
    # end to end: that metadata produces a row WITHOUT the key (hand-set screenshots survive)
    row = _sent_row(meta)
    _ok("screenshot_urls" not in row, "the Supabase row carried screenshot_urls with no screenshots/ dir")


def test_deploy_empty_screenshots_dir_sends_no_key():
    with tempfile.TemporaryDirectory() as tmp:
        gd = _make_game(tmp, {"readme.txt": b"no images here"})
        man = Path(tmp) / "manifest"
        man.mkdir()
        _, meta, _ = _deploy(gd, man)
    _ok("screenshot_urls" not in meta, f"screenshot_urls present with no images: {meta.get('screenshot_urls')!r}")


def test_deploy_declared_list_wins_over_folder():
    declared = [f"{CDN}/{SLUG}/screenshots/hand-picked.png?v=deadbeef"]
    with tempfile.TemporaryDirectory() as tmp:
        gd = _make_game(tmp, {"01.png": b"folder image"})
        meta_path = gd / "game_meta.json"
        meta_path.write_text(json.dumps({"title": "Screenshot Test", "screenshot_urls": declared}), encoding="utf-8")
        man = Path(tmp) / "manifest"
        man.mkdir()
        _, meta, _ = _deploy(gd, man)
    _ok(meta.get("screenshot_urls") == declared, f"declared list was overridden: {meta.get('screenshot_urls')!r}")


def run():
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failed = 0
    for fn in fns:
        try:
            fn()
            print(f"  PASS {fn.__name__}")
        except AssertionError as e:
            failed += 1
            print(f"  FAIL {fn.__name__}: {e}")
        except Exception as e:
            failed += 1
            print(f"  ERROR {fn.__name__}: {type(e).__name__}: {e}")
    print(f"DEPLOY-GAME SCREENSHOTS: {'PASS' if not failed else 'FAIL'} ({_checks} checks across {len(fns)} tests)")
    return failed == 0


if __name__ == "__main__":
    sys.exit(0 if run() else 1)
