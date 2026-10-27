"""Render a reference template: a line that is exactly {{relative/path}} becomes that file's content.

python3 verify/tools/render.py verify/search/search.tpl.md plugins/vibe/skills/vibe-backend/references/search.md
"""
import pathlib
import re
import sys


def render(tpl: pathlib.Path) -> str:
    lines = []
    for line in tpl.read_text(encoding="utf-8").splitlines():
        m = re.fullmatch(r"\{\{(.+?)\}\}", line.strip())
        lines.append((tpl.parent / m.group(1)).read_text(encoding="utf-8").rstrip("\n") if m else line)
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    tpl, out = map(pathlib.Path, sys.argv[1:3])
    out.write_text(render(tpl), encoding="utf-8")
    print(f"wrote {out}")
