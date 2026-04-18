#!/usr/bin/env python3
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SEARCH_DIRS = [ROOT / "src", ROOT / "app.json"]
OUT = ROOT / "artifacts" / "colors" / "light-dark-palette.svg"

HEX_RE = re.compile(r"#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b")
RGBA_RE = re.compile(r"rgba?\(\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})(?:\s*,\s*(0|1|0?\.\d+))?\s*\)")


def to_rgb(color: str):
    c = color.strip().lower()
    if c.startswith("#"):
        h = c[1:]
        if len(h) == 3:
            h = "".join(ch * 2 for ch in h)
        if len(h) >= 6:
            return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    m = RGBA_RE.fullmatch(c)
    if m:
        return int(m.group(1)), int(m.group(2)), int(m.group(3))
    raise ValueError(color)


def luminance(rgb):
    def channel(v):
        c = v / 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    r, g, b = rgb
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)


colors = set()
for target in SEARCH_DIRS:
    if target.is_file():
        text = target.read_text(encoding="utf-8")
        colors.update(m.group(0) for m in HEX_RE.finditer(text))
        colors.update(m.group(0) for m in RGBA_RE.finditer(text))
    else:
        for f in target.rglob("*.ts*"):
            text = f.read_text(encoding="utf-8")
            colors.update(m.group(0) for m in HEX_RE.finditer(text))
            colors.update(m.group(0) for m in RGBA_RE.finditer(text))

norm = sorted({c.lower() for c in colors})
light, dark = [], []
for c in norm:
    try:
        lum = luminance(to_rgb(c))
    except Exception:
        continue
    (light if lum >= 0.45 else dark).append(c)

# layout
swatch = 92
gap = 12
pad = 24
label_h = 36
cols = 8


def section_height(items):
    rows = (len(items) + cols - 1) // cols
    return label_h + rows * (swatch + 34) + 24

w = pad * 2 + cols * swatch + (cols - 1) * gap
h = pad * 2 + section_height(dark) + section_height(light) + 16

parts = [
    f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">',
    '<rect width="100%" height="100%" fill="#0b1020"/>',
    '<style>text{font-family:Inter,Arial,sans-serif;} .title{font-size:22px;font-weight:700;fill:#f3f4f6;} .subtitle{font-size:12px;fill:#94a3b8;} .section{font-size:18px;font-weight:700;fill:#e5e7eb;} .hex{font-size:11px;fill:#cbd5e1;}</style>',
    f'<text x="{pad}" y="32" class="title">Jam Mobile Renk Paleti</text>',
    f'<text x="{pad}" y="50" class="subtitle">Kaynak: src/*.tsx, src/*.ts ve app.json içindeki benzersiz renkler</text>',
]

y = pad + 52
for title, items in [("Dark Palette", dark), ("Light Palette", light)]:
    parts.append(f'<text x="{pad}" y="{y}" class="section">{title} ({len(items)})</text>')
    y += 16
    for i, c in enumerate(items):
        row, col = divmod(i, cols)
        x = pad + col * (swatch + gap)
        yy = y + row * (swatch + 34)
        parts.append(f'<rect x="{x}" y="{yy}" width="{swatch}" height="{swatch}" rx="10" fill="{c}" stroke="rgba(255,255,255,0.18)"/>')
        parts.append(f'<text x="{x+4}" y="{yy+swatch+16}" class="hex">{c}</text>')
    y += ((len(items) + cols - 1) // cols) * (swatch + 34) + 24

parts.append('</svg>')
OUT.write_text("\n".join(parts), encoding="utf-8")
print(f"Wrote {OUT} with {len(dark)} dark and {len(light)} light colors")
