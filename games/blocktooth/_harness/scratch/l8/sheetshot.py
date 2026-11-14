import os, sys
from playwright.sync_api import sync_playwright
src, out = sys.argv[1], sys.argv[2]
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome'); pg = b.new_page(viewport={'width': 1000, 'height': 900})
    pg.goto('file:///' + os.path.abspath(src).replace(os.sep, '/')); pg.screenshot(path=out, full_page=True); b.close()
