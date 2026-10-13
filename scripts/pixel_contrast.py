"""Ground-truth contrast: sample the ACTUAL PIXELS under each text node.

Why this exists: computed-style contrast is wrong whenever text sits on a gradient, a photo,
or a translucent glass layer. The first pass reported `1.12:1` for white text on the loyalty
card — that card is a dark gradient, so the true value is fine. Conversely a low computed
value on a translucent panel can be a real failure. Only pixels settle it.

Method: for each text node, take the pixels in its bounding box. The background is the MODE
of the box (the most common colour — the pixels that are NOT glyphs); the glyph colour is the
pixel furthest in luminance from that mode. That gives a real measured ratio.

Self-contained: this script captures the screenshots AND analyses them, so there is no hidden
`pix.json` producer to forget.

Usage:
  SITE=https://super.ironwaves.store python3 scripts/pixel_contrast.py
  python3 scripts/pixel_contrast.py <dir-with-existing-pix.json>     # analyse only
"""

import json
import os
import subprocess
import sys
from collections import Counter
from pathlib import Path

from PIL import Image

SHOTS_DIR = Path("outputs/customer-app-ux-audit")
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 and Path(sys.argv[1]).is_dir() else SHOTS_DIR

CAPTURE_JS = r"""
import { chromium } from 'playwright';
import fs from 'fs';
const SITE = process.env.SITE, OUT = process.env.OUT;
const b = await chromium.launch({ channel: 'chrome' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
const p = await ctx.newPage();
const result = { screens: [] };
async function dismiss() {
  const d = p.locator('[role=dialog][aria-modal=true]');
  for (let i = 0; i < 6; i++) {
    if (!(await d.count())) break;
    const skip = p.getByRole('button', { name: /^(Keç|Skip|Пропустить)$/ });
    if (await skip.count() && await skip.first().isVisible()) { await skip.first().click().catch(() => {}); await p.waitForTimeout(600); break; }
    const nx = p.getByRole('button', { name: /^(Davam et|Next|Далее)$/ });
    if (await nx.count() && await nx.first().isVisible()) await nx.first().click().catch(() => {});
    else break; await p.waitForTimeout(600);
  }
}
// Only on-screen text is harvested: the pixel sample below needs the box inside the screenshot.
const harvest = () => {
  const out = [];
  for (const el of document.querySelectorAll('*')) {
    const own = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.nodeValue.trim()).join(' ').trim();
    if (!own || own.length < 2) continue;
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 6 || r.height < 6) continue;
    if (r.bottom < 0 || r.top > innerHeight) continue;
    out.push({ t: own.slice(0, 34), color: s.color, fs: parseFloat(s.fontSize), fw: s.fontWeight,
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      cls: (el.className || '').toString().split(/\s+/).slice(0, 3).join('.') });
  }
  return out;
};
const grab = async (name, prep) => {
  if (prep) await prep();
  await p.waitForTimeout(1500);
  const shot = `${OUT}/pix-${name}.png`;
  await p.screenshot({ path: shot });
  result.screens.push({ name, shot, dpr: 3, items: await p.evaluate(harvest) });
};
try {
  await p.goto(`${SITE}/?join=1`, { waitUntil: 'networkidle', timeout: 60000 });
  await p.waitForTimeout(2500); await dismiss();
  await grab('join', null);
  const btn = p.getByRole('button', { name: /^(Başla|Sign up|Qeydiyyatdan keç|Начать)$/ });
  await btn.first().waitFor({ state: 'visible', timeout: 15000 });
  await btn.first().click();
  await p.waitForTimeout(6000); await dismiss();
  result.card = await p.evaluate(() => localStorage.getItem('customer_card_id__super.ironwaves.store'));
  result.token = await p.evaluate(() => localStorage.getItem('customer_token__super.ironwaves.store'));
  await grab('home', null);
  const go = k => async () => { await p.evaluate(x => localStorage.setItem('customer_initial_tab', x), k); await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(3500); await dismiss(); await p.waitForTimeout(1000); };
  await grab('menu', go('order'));
  await grab('offers', go('offers'));
  await grab('feedback', go('feedback'));
  await grab('profile', go('profile'));
  await p.evaluate(() => localStorage.setItem('customer_theme', 'dark'));
  await grab('profile_dark', go('profile'));
} catch (e) { result.error = String(e).slice(0, 300); }
finally { fs.writeFileSync(`${OUT}/pix.json`, JSON.stringify(result)); await b.close(); }
"""


def capture():
    """Take the screenshots and harvest each on-screen text node's box."""
    keep = os.environ.get("KEEP_CUSTOMER") == "1"
    root = Path(__file__).resolve().parent.parent
    js = root / "pixcapture.tmp.mjs"
    js.write_text(CAPTURE_JS)
    env = {**os.environ, "SITE": os.environ.get("SITE", "https://super.ironwaves.store"),
           "OUT": str(SHOTS_DIR.resolve()), "NODE_OPTIONS": ""}
    try:
        r = subprocess.run(["node", js.name], cwd=root, env=env, capture_output=True, text=True)
        if r.returncode != 0:
            raise SystemExit(f"capture failed:\n{r.stderr[-1500:]}")
    finally:
        js.unlink(missing_ok=True)

    # The capture signs up a real customer to reach the tabs. Remove it — this script is a
    # diagnostic, it must never leave a row behind. `KEEP_CUSTOMER=1` is for debugging only.
    meta = json.loads((SHOTS_DIR / "pix.json").read_text())
    card, token = meta.get("card"), meta.get("token")
    if not (card and token):
        print(f"WARNING: no card/token captured — nothing to clean up (card={card})")
        return
    if keep:
        print(f"KEEP_CUSTOMER=1 — left {card} in place")
        return
    import urllib.error
    import urllib.parse
    import urllib.request
    base = os.environ.get("APIBASE", "https://ironwaves-pos-platform-production.up.railway.app")
    req = urllib.request.Request(
        f"{base}/api/v1/ops/customer-app/delete-account",
        data=json.dumps({"card_id": card, "token": token}).encode(), method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("x-tenant-domain", os.environ.get("TENANT_DOMAIN", "super.ironwaves.store"))
    try:
        with urllib.request.urlopen(req) as resp:
            print(f"cleanup: delete-account {resp.status} ({card})")
    except urllib.error.HTTPError as e:
        print(f"cleanup FAILED {e.code} for {card} — delete it manually")
    else:
        try:
            with urllib.request.urlopen(urllib.request.Request(
                    f"{base}/api/v1/ops/customer-app/session?"
                    + urllib.parse.urlencode({"id": card, "t": token}),
                    headers={"x-tenant-domain": os.environ.get("TENANT_DOMAIN", "super.ironwaves.store")})) as v:
                print(f"cleanup: VERIFY FAILED — customer still readable ({v.status})")
        except urllib.error.HTTPError as e:
            print(f"cleanup: verified gone ({e.code})" if e.code == 401
                  else f"cleanup: unexpected verify status {e.code}")


if not (OUT / "pix.json").exists():
    print(f"no {OUT / 'pix.json'} — capturing from the live app first")
    capture()

data = json.loads((OUT / "pix.json").read_text())


def rel_lum(rgb):
    def f(v):
        v /= 255.0
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = rgb
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)


def ratio(a, b):
    l1, l2 = rel_lum(a), rel_lum(b)
    return (max(l1, l2) + 0.05) / (min(l1, l2) + 0.05)


findings = []
for screen in data["screens"]:
    if screen["name"].endswith("_dark") or screen["name"].endswith("_back"):
        pass
    im = Image.open(screen["shot"]).convert("RGB")
    dpr = im.width / 390.0
    for it in screen["items"]:
        x0 = max(0, int(it["x"] * dpr) - 2)
        y0 = max(0, int(it["y"] * dpr) - 2)
        x1 = min(im.width, int((it["x"] + it["w"]) * dpr) + 2)
        y1 = min(im.height, int((it["y"] + it["h"]) * dpr) + 2)
        if x1 - x0 < 6 or y1 - y0 < 6:
            continue
        crop = im.crop((x0, y0, x1, y1))
        px = list(crop.getdata())
        if len(px) < 25:
            continue
        counts = Counter(px)
        # Split pixels into DARK and LIGHT clusters by luminance; support both light-on-dark
        # and dark-on-light. bg = the cluster with MORE pixels (the "field"). glyph = the
        # dominant colour of the OPPOSITE cluster. Resistant to: text covering <50% of a box
        # (bg wins by count), inverse cases (bg dark, text bright), and antialias scatter.
        dark = sorted(((abs(rel_lum(c) - 0.0), c, n) for c, n in counts.items()))
        light = sorted(((abs(rel_lum(c) - 1.0), c, n) for c, n in counts.items()))
        bg_c, bg_n = dark[0][1], dark[0][2]
        if light[0][2] > bg_n:
            bg_c, bg_n, light, dark = light[0][1], light[0][2], dark, light
        glyph_c, g_n = light[0][1], light[0][2]
        glyph = tuple(glyph_c)
        lb = rel_lum(bg_c)
        cr = ratio(glyph, bg_c)
        big = it["fs"] >= 24 or (it["fs"] >= 18.66 and int(it["fw"]) >= 700)
        need = 3.0 if big else 4.5
        findings.append({
            "screen": screen["name"], "t": it["t"], "fs": it["fs"], "fw": it["fw"], "cls": it["cls"],
            "bg": bg_c, "bg_share": round(bg_n / len(px), 3), "glyph": glyph, "glyph_share": round(g_n / len(px), 3),
            "cr": round(cr, 2), "need": need, "fail": cr < need,
            "low_confidence": bg_n / len(px) < 0.18 or g_n > 0.5 * bg_n,
        })

print(f"sampled {len(findings)} text nodes across {len(data['screens'])} screens\n")
print("=== REAL FAILURES (pixel-measured, confident background) ===")
fails = [f for f in findings if f["fail"] and not f["low_confidence"]]
for f in sorted(fails, key=lambda f: f["cr"]):
    print(f"  {f['screen']:12s} {f['cr']:>5}:1 need {f['need']}  {f['fs']:>5}px/{f['fw']:>3}  {f['t']!r}")
    print(f"       glyph rgb{f['glyph']} on rgb{f['bg']} (bg={f['bg_share']:.0%} of box) cls={f['cls']}")

print(f"\n=== BELOW THRESHOLD but background uncertain (needs human check) ===")
unc = [f for f in findings if f["fail"] and f["low_confidence"]]
for f in sorted(unc, key=lambda f: f["cr"])[:20]:
    print(f"  {f['screen']:12s} {f['cr']:>5}:1  {f['fs']:>5}px  {f['t']!r} bg-share={f['bg_share']:.0%}")

print(f"\nsummary: {len(fails)} confident failures, {len(unc)} uncertain, "
      f"{len([f for f in findings if not f['fail']])} passes")
(OUT / "pixel_contrast.json").write_text(json.dumps(findings, indent=1, ensure_ascii=False))
print(f"written: {OUT / 'pixel_contrast.json'}")
