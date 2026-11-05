#!/usr/bin/env python3
"""Build the extension icon ``images/icon.png``.

Draws a bold white label (Segoe UI Black with a soft shadow) on the brain tile
``images/icon-background.png``, the same way the NEO app icons are made. Requires PySide6:

  python scripts/build_icon.py                 # images/icon.png (256 px)
  python scripts/build_icon.py --label F06 --size 1024 --out preview.png
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from PySide6.QtCore import QRectF, Qt
from PySide6.QtGui import QColor, QFont, QFontMetricsF, QImage, QPainter, QPainterPath, QPen
from PySide6.QtWidgets import QApplication

ROOT = Path(__file__).resolve().parent.parent
MASTER = 1024


def fitted_font(label: str, s: float, width: float, height: float) -> tuple[QFont, QRectF]:
    """Largest Segoe UI Black size at which the label fits in width x height."""
    font = QFont("Segoe UI Black")
    font.setStyleStrategy(QFont.PreferAntialias)
    font.setWeight(QFont.Black)
    px = int(s * 0.42)
    while True:
        font.setPixelSize(px)
        tight = QFontMetricsF(font).tightBoundingRect(label)
        if (tight.width() <= width and tight.height() <= height) or px <= 12:
            return font, tight
        px -= 1


def draw_label(p: QPainter, s: float, label: str) -> None:
    """White label centered on the tile, with a dark shadow offset down and right."""
    font, tight = fitted_font(label, s, s * 0.74, s * 0.34)
    path = QPainterPath()
    x = s / 2 - tight.width() / 2 - tight.x()
    y = s * 0.53 + tight.height() / 2 - (tight.y() + tight.height())
    path.addText(x, y, font, label)
    off = max(1.0, s / 200)
    p.translate(off, off)
    p.fillPath(path, QColor(0, 0, 30, 140))
    p.translate(-off, -off)
    p.fillPath(path, QColor(255, 255, 255))
    p.strokePath(path, QPen(QColor(255, 255, 255), max(1.0, s / 512)))


def render(label: str, background: Path) -> QImage:
    src = QImage(str(background))
    if src.isNull():
        raise RuntimeError(f"Failed to load {background}")
    img = src.scaled(MASTER, MASTER, Qt.KeepAspectRatio, Qt.SmoothTransformation).convertToFormat(QImage.Format_ARGB32)
    p = QPainter(img)
    p.setRenderHint(QPainter.Antialiasing)
    p.setRenderHint(QPainter.TextAntialiasing)
    draw_label(p, MASTER, label)
    p.end()
    return img


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--label", default="BDF")
    ap.add_argument("--size", type=int, default=256)
    ap.add_argument("--background", type=Path, default=ROOT / "images" / "icon-background.png")
    ap.add_argument("--out", type=Path, default=ROOT / "images" / "icon.png")
    args = ap.parse_args()
    _app = QApplication(sys.argv)
    img = render(args.label, args.background)
    if args.size != MASTER:
        img = img.scaled(args.size, args.size, Qt.KeepAspectRatio, Qt.SmoothTransformation)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    if not img.save(str(args.out), "PNG"):
        print(f"Failed to write {args.out}", file=sys.stderr)
        return 1
    print(f"Wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
