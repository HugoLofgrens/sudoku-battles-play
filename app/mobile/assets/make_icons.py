"""Draws the app icon and splash screens and writes every size Android, iOS and the web need.
The mark is one 3x3 box in the game's own highlight language: the pressed cell (dark blue),
its row and column (gray) and a matching number (blue).  Run: python3 assets/make_icons.py"""
from PIL import Image, ImageDraw
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)                       # app/mobile
BG, CELL, PEER, SEL, HI = '#121418', '#262a32', '#4a505b', '#1e40af', '#3b82f6'
# Tile colors, row by row: corners plain, the center's row/column gray, center pressed,
# top-right a matching number.
TILES = [CELL, PEER, HI,
         PEER, SEL, PEER,
         CELL, PEER, CELL]


def mark(size, scale=4):
    """The 3x3 mark on a transparent square, drawn large and scaled down for smooth edges."""
    s = size * scale
    im = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    gap = s * 0.06
    tile = (s - 2 * gap) / 3
    for k, color in enumerate(TILES):
        x, y = (k % 3) * (tile + gap), (k // 3) * (tile + gap)
        d.rounded_rectangle([x, y, x + tile, y + tile], radius=tile * 0.22, fill=color)
    return im.resize((size, size), Image.LANCZOS)


def canvas(w, h, mark_frac, rounded=False):
    """Background with the mark centered at mark_frac of the shorter side."""
    im = Image.new('RGBA', (w, h), BG)
    m = mark(int(min(w, h) * mark_frac))
    im.alpha_composite(m, ((w - m.width) // 2, (h - m.height) // 2))
    if rounded:  # legacy round launcher
        mask = Image.new('L', (w, h), 0)
        ImageDraw.Draw(mask).ellipse([0, 0, w - 1, h - 1], fill=255)
        out = Image.new('RGBA', (w, h), (0, 0, 0, 0)); out.paste(im, mask=mask); return out
    return im


def save(im, *path, opaque=True):
    p = os.path.join(ROOT, *path)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    (im.convert('RGB') if opaque else im).save(p, optimize=True)


# iOS: one opaque 1024 icon (iOS rounds the corners itself), square splash.
save(canvas(1024, 1024, 0.62), 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png')
for name in ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']:
    save(canvas(2732, 2732, 0.16), 'ios/App/App/Assets.xcassets/Splash.imageset', name)

# Android launcher icons. Adaptive foreground: 108dp canvas, mark inside the 66dp safe zone.
res = 'android/app/src/main/res'
for dpi, px in {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}.items():
    save(canvas(px, px, 0.62), res, f'mipmap-{dpi}', 'ic_launcher.png')
    save(canvas(px, px, 0.56, rounded=True), res, f'mipmap-{dpi}', 'ic_launcher_round.png', opaque=False)
    fg = px * 108 // 48
    layer = Image.new('RGBA', (fg, fg), (0, 0, 0, 0))
    m = mark(int(fg * 0.50))
    layer.alpha_composite(m, ((fg - m.width) // 2, (fg - m.height) // 2))
    save(layer, res, f'mipmap-{dpi}', 'ic_launcher_foreground.png', opaque=False)
with open(os.path.join(ROOT, res, 'values/ic_launcher_background.xml'), 'w') as f:
    f.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">%s</color>\n</resources>\n' % BG)

# Android splash screens, every size the template ships.
for folder in os.listdir(os.path.join(ROOT, res)):
    p = os.path.join(ROOT, res, folder, 'splash.png')
    if os.path.exists(p):
        w, h = Image.open(p).size
        save(canvas(w, h, 0.28), res, folder, 'splash.png')

# Web: favicon, home-screen icons.
web = os.path.join(os.path.dirname(ROOT), 'client')
for px, name in [(32, 'favicon.png'), (180, 'apple-touch-icon.png'), (192, 'icon-192.png'), (512, 'icon-512.png')]:
    canvas(px, px, 0.62).convert('RGB').save(os.path.join(web, name), optimize=True)
print('icons written')
