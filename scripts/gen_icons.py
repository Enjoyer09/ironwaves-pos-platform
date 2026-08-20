#!/usr/bin/env python3
"""Generate app icon set for Emalathhana from public/logo.jpg.

Produces:
  PWA  : public/logo-192.png, public/logo-512.png, public/logo-512-maskable.png
  iOS  : ios/.../AppIcon.appiconset/AppIcon-512@2x.png (1024)
  Android legacy : ic_launcher.png + ic_launcher_round.png (48/72/96/144/192)
  Android adaptive fg : ic_launcher_foreground.png (108/162/216/324/432, safe-zone)
"""
import os
from PIL import Image

ROOT = "/Users/macbookair/Documents/GitHub/ironwaves-pos-platform"
SRC = os.path.join(ROOT, "public", "logo.jpg")

src = Image.open(SRC).convert("RGBA")
print("source size:", src.size)

# Sample the brand orange from a corner pixel (logo has an orange field bg).
corner = src.getpixel((2, 2))
orange = (corner[0], corner[1], corner[2], 255)
orange_hex = "#%02X%02X%02X" % (corner[0], corner[1], corner[2])
print("sampled orange:", orange_hex)


def fit(size):
    """Upscale source logo to a square of `size` (LANCZOS for crispness)."""
    return src.resize((size, size), Image.LANCZOS)


# ---- PWA ----
fit(192).save(os.path.join(ROOT, "public", "logo-192.png"))
fit(512).save(os.path.join(ROOT, "public", "logo-512.png"))

# Maskable: orange field + logo within 80% safe zone (maskable.dev standard).
m = Image.new("RGBA", (512, 512), orange)
inner = int(512 * 0.80)
li = fit(inner)
m.paste(li, ((512 - inner) // 2, (512 - inner) // 2), li)
m.save(os.path.join(ROOT, "public", "logo-512-maskable.png"))

# ---- iOS ----
ios_path = os.path.join(
    ROOT, "ios", "App", "App", "Assets.xcassets",
    "AppIcon.appiconset", "AppIcon-512@2x.png",
)
fit(1024).save(ios_path)

# ---- Android legacy (full-bleed square) ----
legacy = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}
for d, s in legacy.items():
    p = os.path.join(ROOT, "android", "app", "src", "main", "res", d)
    fit(s).save(os.path.join(p, "ic_launcher.png"))
    fit(s).save(os.path.join(p, "ic_launcher_round.png"))

# ---- Android adaptive foreground (logo within 66% safe zone, transparent around) ----
fg = {
    "mipmap-mdpi": 108,
    "mipmap-hdpi": 162,
    "mipmap-xhdpi": 216,
    "mipmap-xxhdpi": 324,
    "mipmap-xxxhdpi": 432,
}
for d, s in fg.items():
    p = os.path.join(ROOT, "android", "app", "src", "main", "res", d)
    canvas = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    inner = int(s * 0.66)
    f = fit(inner)
    canvas.paste(f, ((s - inner) // 2, (s - inner) // 2), f)
    canvas.save(os.path.join(p, "ic_launcher_foreground.png"))

print("DONE. Use orange for Android adaptive background:", orange_hex)
