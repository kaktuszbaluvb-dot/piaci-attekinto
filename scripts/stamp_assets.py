#!/usr/bin/env python3
"""A Pages-csomag index.html fájljához verzióparamétert ír. A repót nem commitolja."""

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "web" / "index.html"

ASSETS = (
    "assets/brand/logo-light@2x.webp",
    "assets/brand/logo-dark@2x.webp",
    "assets/brand/logo-light.webp",
    "assets/brand/logo-dark.webp",
    "assets/brand/apple-touch-icon.png",
    "assets/brand/favicon-64.png",
    "assets/brand/favicon-32.png",
    "css/styles.css",
    "js/app.js",
    "vendor/chart.umd.min.js",
)


def main() -> None:
    version = os.environ["VERSION"].strip()
    if not version:
        raise SystemExit("VERSION üres")
    text = INDEX.read_text(encoding="utf-8")
    for asset in ASSETS:
        text = text.replace(f'{asset}"', f'{asset}?v={version}"')
        text = text.replace(f"{asset} ", f"{asset}?v={version} ")
    text = text.replace(
        'name="asset-version" content=""',
        f'name="asset-version" content="{version}"',
    )
    INDEX.write_text(text, encoding="utf-8")


if __name__ == "__main__":
    main()
