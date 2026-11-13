#!/usr/bin/env python3
"""structure_gate.py — deterministic "is the scaffolding COMPLETE?" gate (no claude -p).

A finished ForgeFlow game has a fixed structural skeleton. This reads the assembled
files and FAILs only on universal, zero-false-positive invariants — the things that,
if missing, guarantee a broken or un-driveable game regardless of genre or menu style:

  FAIL  1. index.html missing
  FAIL  2. content.json missing / unparseable / no title
  FAIL  3. game_controls.js missing OR not loaded by index.html   (page control bar)
  FAIL  4. no test/start hook (__FFG3D__ for 3D, __FFG_GAME__ for 2D) in any runtime JS
           — the feel + vision gates drive the game through this hook, and a game that
           exposes start() necessarily has a start gate to begin from.

  WARN  5. menu mechanism unclear: no FFG.Shell usage AND no custom start-overlay pattern
           — the game MIGHT still render a menu (Phaser canvas titles can't be grepped),
           so this is a heads-up, not a block. The runtime feel + vision gates verify the
           menu actually renders.
  WARN  6. ffg_shell.js (the standard menu library) not shipped.

Why menu-presence is NOT a hard FAIL here: games legitimately build menus three different
ways — FFG.Shell DOM overlay (starlance/lumen/void), a side-effect `import(ffg_shell.js)`
in the 3D boot bundle (iron-tide/warboard/tide-breakers), or a custom canvas start-overlay
(neon-breakout's `_buildStartOverlay`). A grep for any single pattern false-positives the
others and would BLOCK good builds. So structure checks the skeleton; the menu *renders*
check lives at runtime.

Returns (ok, issues[]). ok = no FAIL. Blocking in the build pipeline (FAILs only).

    python structure_gate.py <game_dir>
"""
import json, sys
from pathlib import Path


def _read(p):
    try:
        return p.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return ""


def check(gdir):
    gdir = Path(gdir)
    issues = []  # (level, msg)

    idx = gdir / "index.html"
    if not idx.exists():
        return False, [("FAIL", "no index.html")]
    html = _read(idx)

    # 2. content.json + title
    cj = gdir / "content.json"
    if not cj.exists():
        issues.append(("FAIL", "no content.json"))
    else:
        try:
            c = json.loads(_read(cj))
            if not (c.get("title") or "").strip():
                issues.append(("FAIL", "content.json has no title"))
        except Exception as e:
            issues.append(("FAIL", f"content.json invalid JSON: {e}"))

    # 3. control bar
    if not (gdir / "game_controls.js").exists():
        issues.append(("FAIL", "no game_controls.js (page control bar missing)"))
    elif "game_controls.js" not in html:
        issues.append(("FAIL", "game_controls.js exists but index.html never loads it"))

    # Scan all runtime JS once.
    runtime = gdir / "runtime"
    srcs = {}
    if runtime.exists():
        for js in runtime.rglob("*.js"):
            srcs[js.name] = _read(js)
    allsrc = "\n".join(srcs.values())

    # 4. test/start hook (drivable + implies a start gate). Universal contract.
    hook_3d = "__FFG3D__" in allsrc
    hook_2d = "__FFG_GAME__" in allsrc
    if not (hook_3d or hook_2d):
        issues.append(("FAIL", "no test hook (__FFG3D__/__FFG_GAME__) — feel + vision gates can't drive it, and no start gate"))

    # 5. menu mechanism (soft — three valid styles; absence of ALL three is only a WARN).
    shell_present = (runtime / "ffg_shell.js").exists()
    shell_loaded = ("ffg_shell.js" in html) or ("ffg_shell.js" in allsrc)  # <script> or import(...)
    shell_used = "FFG.Shell(" in "\n".join(v for k, v in srcs.items() if k != "ffg_shell.js")
    custom_menu = any(m in allsrc for m in ("_buildStartOverlay", "buildStartOverlay", "startOverlay", "_started"))
    if not (shell_used or (shell_present and shell_loaded) or custom_menu):
        issues.append(("WARN", "menu mechanism unclear (no FFG.Shell usage, no custom start-overlay) — verify the menu renders at runtime"))
    if not shell_present:
        issues.append(("WARN", "ffg_shell.js (standard menu library) not shipped"))

    ok = not any(level == "FAIL" for level, _ in issues)
    return ok, issues


def main():
    if len(sys.argv) < 2:
        print("usage: python structure_gate.py <game_dir>"); return 2
    ok, issues = check(sys.argv[1])
    for level, msg in issues:
        print(f"  [{level}] {msg}")
    print(("PASS" if ok else "FAIL") + f" — {Path(sys.argv[1]).name}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
