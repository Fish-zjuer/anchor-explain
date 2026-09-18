# -*- coding: utf-8 -*-
"""Rebuild release/Anchor-0.1.0-安装包.zip from the current (D86) vsix files."""
import os
import zipfile

ROOT = r"C:\Users\29927\Desktop\anchor-explain\release"
OUT = os.path.join(ROOT, "Anchor-0.1.0-安装包.zip")
ITEMS = [
    (os.path.join(ROOT, "安装说明.txt"), "安装说明.txt"),
    (os.path.join(ROOT, "anchor-explain-0.1.0.vsix"), "anchor-explain-0.1.0.vsix"),
    (os.path.join(ROOT, "anchor-pdf-0.1.0.vsix"), "anchor-pdf-0.1.0.vsix"),
]

lines = []
if os.path.exists(OUT):
    os.remove(OUT)

with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as zf:
    for src, arc in ITEMS:
        zf.write(src, arc)
        lines.append("added: {} ({} bytes)".format(arc, os.path.getsize(src)))

# read back to verify
lines.append("--- read back ---")
with zipfile.ZipFile(OUT) as zf:
    bad = zf.testzip()
    lines.append("testzip: {}".format("OK" if bad is None else "BAD: {}".format(bad)))
    for info in zf.infolist():
        lines.append("{}/{}  {} bytes  CRC ok".format(
            info.filename, "/", info.file_size).replace("/", "", 1) if False else
            "{}  {} bytes".format(info.filename, info.file_size))
    # verify the shipped readme inside the explain vsix is the user version
    with zf.open("anchor-explain-0.1.0.vsix") as vsix:
        with zipfile.ZipFile(vsix) as inner:
            names = inner.namelist()
            readme = inner.read("extension/readme.md").decode("utf-8", "replace")
            has_src = ("src/" in readme) or ("pnpm " in readme) or ("| D" in readme and "Slice" in readme)
            lines.append("explain vsix entries: {}".format(len(names)))
            lines.append("shipped readme.md: has README.dist marker={}; leaks src/pnpm={}".format(
                "安装" in readme or "安装包" in readme or "keybinding" in readme.lower() or "入门" in readme,
                has_src))
            lines.append("readme head: {}".format(readme[:80].replace("\n", " ")))

with open(os.path.join(ROOT, "..", ".tmp-zip.txt"), "w", encoding="utf-8") as f:
    f.write("\n".join(lines))
print("done")
