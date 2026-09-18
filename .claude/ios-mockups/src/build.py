"""Assemble artboard bodies + shared.css into .dc.html artboards (and plain
preview pages for a local screenshot pass).

Bodies reference icons as [[i:name]] or [[i:name:size]] or
[[i:name:size:stroke]]; they expand to inline 24-grid SVG.
"""
import pathlib
import re

SRC = pathlib.Path(__file__).parent
OUT = SRC.parent
PREVIEW = OUT / "preview"

ARTBOARDS = [
    "Guide", "Main", "Catalog", "Orders",
    "ClientLookup", "ClientCreate",
    "ClientLookupTabs3", "ClientLookupTabs2", "ClientLookupNumpad",
    "Scanner", "Product", "Cart", "CartEmpty", "MainEmptyCart", "Delivery",
]

STROKE = {
    "chev": '<path d="m9 5 7 7-7 7"/>',
    "back": '<path d="m15 5-7 7 7 7"/>',
    "close": '<path d="M18 6 6 18M6 6l12 12"/>',
    "scan": '<path d="M3 8V6a3 3 0 0 1 3-3h2M16 3h2a3 3 0 0 1 3 3v2M21 16v2a3 3 0 0 1-3 3h-2M8 21H6a3 3 0 0 1-3-3v-2M7 12h10"/>',
    "search": '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    "cart": '<path d="M6.5 7H21l-1.6 8.2a2 2 0 0 1-2 1.6H9.2a2 2 0 0 1-2-1.6L5 3H2.5"/><circle cx="9.5" cy="20.5" r="1.2"/><circle cx="17.5" cy="20.5" r="1.2"/>',
    "plus": '<path d="M12 5v14M5 12h14"/>',
    "minus": '<path d="M5 12h14"/>',
    "torch": '<path d="M8 2h8v4l-2 4v11a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1V10L8 6V2Z"/><path d="M12 13v2"/>',
    "keyboard": '<rect x="2" y="6" width="20" height="12" rx="2.5"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7.5 14h9"/>',
    "check": '<path d="m5 12.5 4.5 4.5L19 7"/>',
    "warn": '<path d="M12 3.5 2.5 20h19L12 3.5Z"/><path d="M12 10v4.5M12 17.5h.01"/>',
    "info": '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8h.01"/>',
    "gift": '<rect x="3" y="8" width="18" height="4.5" rx="1"/><path d="M5 12.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7.5M12 8v13M12 8C10.5 4 6.5 3.8 6.5 6.3 6.5 8 9 8 12 8Zm0 0c1.5-4 5.5-4.2 5.5-1.7C17.5 8 15 8 12 8Z"/>',
    "person": '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.4-3.9 4.4-6 8-6s6.6 2.1 8 6"/>',
    "pin": '<path d="M12 21.5s7-6 7-11.5a7 7 0 1 0-14 0c0 5.5 7 11.5 7 11.5Z"/><circle cx="12" cy="10" r="2.5"/>',
    "calendar": '<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    "clock": '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>',
    "cloud": '<path d="M12 12.5v8m-3.2-3.2L12 20.5l3.2-3.2"/><path d="M19.5 16.3A4.6 4.6 0 0 0 17.3 7.5h-1.2A7 7 0 1 0 4.6 15"/>',
    "package": '<path d="M21 8v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8"/><path d="m3.3 7 8.7-4 8.7 4"/><path d="M12 12v9"/><path d="M3.3 7 12 11l8.7-4"/>',
    "pan": '<path d="M2.5 11h14v1a5 5 0 0 1-5 5h-4a5 5 0 0 1-5-5v-1Z"/><path d="M16.5 12h5"/>',
    "pot": '<path d="M4 9.5h16V17a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V9.5Z"/><path d="M2 9.5h20M9 6h6"/>',
    "kettle": '<path d="M5 20h12a1 1 0 0 0 1-1.2l-1.6-8.2A2 2 0 0 0 14.4 9H7.6a2 2 0 0 0-2 1.6L4 18.8A1 1 0 0 0 5 20Z"/><path d="M8 9V7.5a3 3 0 0 1 6 0V9M17.5 12.5l3.5-3"/>',
    "blender": '<path d="M8 3h8l-1 10.5H9L8 3Z"/><path d="M7 13.5h10V20a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1v-6.5Z"/><path d="M12 17.2h.01"/>',
    "phone": '<path d="M21.5 16.4v3a2 2 0 0 1-2.2 2A19.6 19.6 0 0 1 2.6 4.7 2 2 0 0 1 4.6 2.5h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.7a2 2 0 0 1-.4 2.1L8.6 10.3a16 16 0 0 0 5.1 5.1l1.3-1.3a2 2 0 0 1 2.1-.4c.8.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2Z"/>',
    "idcard": '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><circle cx="8.5" cy="11" r="2"/><path d="M5.5 16c.6-1.4 1.7-2 3-2s2.4.6 3 2M14.5 10h4M14.5 14h3"/>',
    "trash": '<path d="M4 7h16M9.5 7V4.5h5V7M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/>',
    "backspace": '<path d="M9 5h11a1.5 1.5 0 0 1 1.5 1.5v11A1.5 1.5 0 0 1 20 19H9l-6.5-7L9 5Z"/><path d="m12 9.5 5 5m0-5-5 5"/>',
    "spinner": '<path d="M12 3a9 9 0 1 0 9 9"/>',
    "clockback":'<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6"/><path d="M3.5 4v4h4M12 8v4l3 2"/>',
}

FILLED = {
    "tab-products": '<path fill-rule="evenodd" d="M12 1.8 2.8 6.4v11.2L12 22.2l9.2-4.6V6.4L12 1.8Zm0 2.6 6 3-6 3-6-3 6-3Z"/>',
    "tab-orders": '<path fill-rule="evenodd" d="M6.5 2h11A2.5 2.5 0 0 1 20 4.5v15a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Zm1.5 5h8v2H8V7Zm0 4h8v2H8v-2Zm0 4h5v2H8v-2Z"/>',
    "more": '<circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>',
}


def icon(match):
    parts = match.group(1).split(":")
    name = parts[0]
    size = parts[1] if len(parts) > 1 and parts[1] else "24"
    stroke = parts[2] if len(parts) > 2 else "2"
    if name in FILLED:
        return (f'<svg width="{size}" height="{size}" viewBox="0 0 24 24" '
                f'fill="currentColor">{FILLED[name]}</svg>')
    return (f'<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" '
            f'stroke="currentColor" stroke-width="{stroke}" stroke-linecap="round" '
            f'stroke-linejoin="round">{STROKE[name]}</svg>')


FONT = ('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?'
        'family=Noto+Sans+Georgian:wght@400;500;600;700&amp;display=swap">')


def main():
    css = (SRC / "shared.css").read_text(encoding="utf-8")
    PREVIEW.mkdir(exist_ok=True)
    (PREVIEW / "iflow-logo.png").write_bytes((OUT / "iflow-logo.png").read_bytes())
    for name in ARTBOARDS:
        src = SRC / f"{name}.body.html"
        if not src.exists():
            print("missing", name)
            continue
        body = src.read_text(encoding="utf-8")
        body = re.sub(r"\[\[i:([\w:.-]+)\]\]", icon, body)
        if "{{" in body or "[[" in body:
            raise SystemExit(f"{name}: unexpanded token or handlebars in body")
        dc = (
            "<!doctype html>\n<html>\n<head>\n  <meta charset=\"utf-8\">\n"
            "  <script src=\"./support.js\"></script>\n</head>\n<body>\n<x-dc>\n"
            f"<helmet>\n  {FONT}\n  <style>\n{css}\n  </style>\n</helmet>\n"
            f"{body}\n</x-dc>\n</body>\n</html>\n"
        )
        (OUT / f"{name}.dc.html").write_text(dc, encoding="utf-8")
        preview = (
            f"<!doctype html><html><head><meta charset=\"utf-8\">{FONT}"
            f"<style>{css}</style></head><body>{body}</body></html>"
        )
        (PREVIEW / f"{name}.html").write_text(preview, encoding="utf-8")
        print("built", name)


if __name__ == "__main__":
    main()
