#!/usr/bin/env python3
"""
Cache busting: rewrites every local CSS/JS reference in index.html to
`file.ext?v=<content hash>`. Browsers may keep CSS/JS for hours, but the HTML
is always revalidated, so a changed file gets a new URL and is fetched fresh,
while unchanged files stay cached. Run before every commit that touches CSS/JS:

    python3 tools/bump_version.py
"""
import hashlib, pathlib, re

root = pathlib.Path(__file__).resolve().parent.parent
html_path = root / "index.html"
html = html_path.read_text(encoding="utf-8")

def versioned(match):
    attr, path = match.group(1), match.group(2)
    file = root / path
    if not file.exists():
        return match.group(0)
    digest = hashlib.sha256(file.read_bytes()).hexdigest()[:10]
    return f'{attr}="{path}?v={digest}"'

new = re.sub(r'(src|href)="(?!https?:|data:|//)([\w./-]+\.(?:js|css))(?:\?v=[\w]+)?"', versioned, html)
html_path.write_text(new, encoding="utf-8")
print("\n".join(re.findall(r'(?:src|href)="([\w./-]+\.(?:js|css)\?v=\w+)"', new)))
