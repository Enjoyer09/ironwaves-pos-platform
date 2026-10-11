#!/usr/bin/env python3
"""Generate app icon/splash set for a brand profile (brand/<id>.json).

Usage: gen_icons.py [profile]     (default: emalatcoffee)

Produces (all destinations shared by native builds):
  PWA  : public/logo-192.png, public/logo-512.png, public/logo-512-maskable.png
  iOS  : ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png (1024)
  iOS splash : Splash.imageset/splash-2732x2732*.png (white + centered logo)
  Android legacy : ic_launcher.png + ic_launcher_round.png (48/72/96/144/192)
  Android adaptive fg : ic_launcher_foreground.png (108/162/216/324/432, safe-zone)
  Android splash : drawable/splash.png (480x320)
  Android notification small icon : drawable/ic_notification.png (white silhouette)

NOTE: source logo is 150x150 — upscaled placeholders. Re-run with >=1024px logo
for App Store quality (profile "logo" path in brand/<id>.json).
"""
import json
import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROFILE = sys.argv[1] if len(sys.argv) > 1 else "emalatcoffee"

with open(os.path.join(ROOT, "brand", PROFILE + ".json"), encoding="utf-8") as f:
    brand = json.load(f)

SRC = os.path.join(ROOT, brand["logo"])
src = Image.open(SRC).convert("RGBA")
print(f"profile={PROFILE} source={brand['logo']} size={src.size}")

# Sample the brand color from a corner pixel (logo has a solid field bg).
corner = src.getpixel((2, 2))
field = (corner[0], corner[1], corner[2], 255)
field_hex = "#%02X%02X%02X" % corner[:3]
print("sampled field color:", field_hex)


def fit(size):
    """Upscale source logo to a square of `size` (LANCZOS for crispness)."""
    return src.resize((size, size), Image.LANCZOS)


def save(img, *parts):
    path = os.path.join(ROOT, *parts)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path)
    print("wrote", os.path.relpath(path, ROOT))


# ---- PWA ----
save(fit(192), "public", "logo-192.png")
save(fit(512), "public", "logo-512.png")
# Legacy names referenced by vite.config PWA manifest icons
save(fit(192), "public", "ironwaves-192.png")
save(fit(512), "public", "ironwaves-512.png")

# Maskable: brand field + logo within 80% safe zone (maskable.dev standard).
m = Image.new("RGBA", (512, 512), field)
inner = int(512 * 0.80)
li = fit(inner)
m.paste(li, ((512 - inner) // 2, (512 - inner) // 2), li)
save(m, "public", "logo-512-maskable.png")

# ---- iOS app icon ----
save(
    fit(1024),
    "ios", "App", "App", "Assets.xcassets",
    "AppIcon.appiconset", "AppIcon-512@2x.png",
)

# ---- iOS splash (white canvas, centered logo at ~22%) ----
def splash(size, logo_ratio=0.22):
    canvas = Image.new("RGBA", (size, size), (255, 255, 255, 255))
    inner = int(size * logo_ratio)
    lg = fit(inner)
    canvas.paste(lg, ((size - inner) // 2, (size - inner) // 2), lg)
    return canvas


for name in ("splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"):
    save(splash(2732), "ios", "App", "App", "Assets.xcassets", "Splash.imageset", name)

# ---- Android legacy (full-bleed square) ----
legacy = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}
for d, s in legacy.items():
    save(fit(s), "android", "app", "src", "main", "res", d, "ic_launcher.png")
    save(fit(s), "android", "app", "src", "main", "res", d, "ic_launcher_round.png")

# ---- Android adaptive foreground (logo within 66% safe zone, transparent) ----
fg = {
    "mipmap-mdpi": 108,
    "mipmap-hdpi": 162,
    "mipmap-xhdpi": 216,
    "mipmap-xxhdpi": 324,
    "mipmap-xxxhdpi": 432,
}
for d, s in fg.items():
    canvas = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    inner = int(s * 0.66)
    f = fit(inner)
    canvas.paste(f, ((s - inner) // 2, (s - inner) // 2), f)
    save(canvas, "android", "app", "src", "main", "res", d, "ic_launcher_foreground.png")

# ---- Android splash (white + centered logo, existing 480x320 slot) ----
sp = Image.new("RGBA", (480, 320), (255, 255, 255, 255))
sp_logo = fit(120)
sp.paste(sp_logo, ((480 - 120) // 2, (320 - 120) // 2), sp_logo)
save(sp, "android", "app", "src", "main", "res", "drawable", "splash.png")

# ---- Android notification small icon (white silhouette, alpha = distance from field) ----
N = 192
logo = fit(N)
mask = Image.new("L", (N, N), 0)
px_logo = logo.load()
px_mask = mask.load()
fr, fg_, fb = field[:3]
for y in range(N):
    for x in range(N):
        r, g, b, _a = px_logo[x, y]
        dist = abs(r - fr) + abs(g - fg_) + abs(b - fb)
        px_mask[x, y] = 255 if dist > 90 else 0
note = Image.new("RGBA", (N, N), (255, 255, 255, 0))
note.putalpha(mask)
white = Image.new("RGBA", (N, N), (255, 255, 255, 255))
note = Image.composite(white, note, mask)
save(note, "android", "app", "src", "main", "res", "drawable", "ic_notification.png")

print("DONE.")
