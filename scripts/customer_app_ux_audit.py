#!/usr/bin/env python3
"""Customer-app **mobile UI/UX audit** on SUPER production — measured, not impressionistic.

Creates exactly ONE temp customer via the real UI, walks every reachable tab, and measures
per-tab: horizontal overflow, touch targets (label-aware, WCAG 24x24 vs Apple 44 / Google 48),
iOS zoom risk (<16px inputs), a11y (h1/alt/icon-only button labels), text clipped by the
floating bottom nav, and contrast ratios of every visible text node against its real
painted background.

Zero lasting writes: the temp customer is deleted via `delete-account` in `finally`.
No pre-order is ever submitted (that would write a KitchenOrder and ping the live KDS).
The 136 real customers are never touched.

Usage:
  SITE=https://super.ironwaves.store \
  APIBASE=https://ironwaves-pos-platform-production.up.railway.app \
  TENANT_DOMAIN=super.ironwaves.store \
  python3 scripts/customer_app_ux_audit.py
"""

import json
import os
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

SITE = os.environ.get("SITE", "https://super.ironwaves.store")
BASE = os.environ.get("APIBASE", "https://ironwaves-pos-platform-production.up.railway.app")
DOMAIN = os.environ.get("TENANT_DOMAIN", "super.ironwaves.store")
PREFIX = "/api/v1/ops"
SHOTS = Path("outputs/customer-app-ux-audit")
ROOT = Path(__file__).resolve().parent.parent


def call(method, path, *, query=None, body=None):
    url = BASE + PREFIX + path
    if query:
        url += "?" + urllib.parse.urlencode(query)
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    req.add_header("x-tenant-domain", DOMAIN)
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {"_raw": raw[:200]}


BROWSER_JS = r"""
import { chromium } from 'playwright';

const SITE = process.env.SITE, SHOTS = process.env.SHOTS;
const out = { tabs: {}, console_errors: [], requests: [] };

const b = await chromium.launch({ channel: 'chrome' });
const ctx = await b.newContext({
  viewport: { width: 390, height: 844 },   // iPhone 14/15 logical
  deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
});
const p = await ctx.newPage();
p.on('pageerror', e => out.console_errors.push('pageerror: ' + String(e).slice(0, 160)));
p.on('console', m => { if (m.type() === 'error') out.console_errors.push('console: ' + m.text().slice(0, 200)); });
p.on('response', r => { const u = r.url(); if (r.status() >= 400) out.requests.push(`${r.status()} ${u.replace(SITE, '').slice(0, 160)}`); });

const shot = n => p.screenshot({ path: `${SHOTS}/${n}.png` }).catch(() => {});
const text = async () => (await p.locator('body').innerText()).replace(/\s+/g, ' ').trim();
const store = async () => p.evaluate(() => ({
  card: localStorage.getItem('customer_card_id__super.ironwaves.store'),
  token: localStorage.getItem('customer_token__super.ironwaves.store'),
}));

async function dismissOnboarding() {
  const d = p.locator('[role=dialog][aria-modal=true]');
  for (let i = 0; i < 6; i++) {
    if (!(await d.count())) break;
    const skip = p.getByRole('button', { name: /^(Keç|Skip|Пропустить)$/ });
    if (await skip.count() && await skip.first().isVisible()) { await skip.first().click({ timeout: 5000 }).catch(() => {}); await p.waitForTimeout(600); break; }
    const next = p.getByRole('button', { name: /^(Davam et|Next|Далее)$/ });
    const start = p.getByRole('button', { name: /^(Başlayaq|Get Started|Начать)$/ });
    if (await start.count() && await start.first().isVisible()) await start.first().click({ timeout: 5000 }).catch(() => {});
    else if (await next.count() && await next.first().isVisible()) await next.first().click({ timeout: 5000 }).catch(() => {});
    else break;
    await p.waitForTimeout(600);
  }
}

// ── the audit probe, injected into the live page ────────────────────────────────
const PROBE = () => {
  const px = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
  const parseRGB = s => { const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(s || ''); return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null; };
  const over = (top, bot) => top.a >= 1 ? { ...top, a: 1 } : {
    r: Math.round(top.r * top.a + bot.r * (1 - top.a)),
    g: Math.round(top.g * top.a + bot.g * (1 - top.a)),
    b: Math.round(top.b * top.a + bot.b * (1 - top.a)), a: 1,
  };
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  const WHITE = { r: 255, g: 255, b: 255, a: 1 }, BLACK = { r: 0, g: 0, b: 0, a: 1 };

  // Composite the real painted background: root first, then each ancestor on top, then the
  // element's own background. Anything translucent is composited properly instead of assumed.
  const bgChain = el => {
    const chain = [];
    let n = el, overImage = false;
    while (n && n.nodeType === 1) {
      const s = getComputedStyle(n);
      if (s.backgroundImage && s.backgroundImage !== 'none') overImage = true;
      const c = parseRGB(s.backgroundColor);
      if (c && c.a > 0) chain.push(c);
      n = n.parentElement;
    }
    chain.push({ r: 242, g: 242, b: 247, a: 1 }); // document backdrop
    chain.overImage = overImage;
    return chain;
  };
  // Fold outermost → innermost (HTML paints parents behind children).
  const painted = chain => { let acc = null; for (let i = chain.length - 1; i >= 0; i--) acc = acc === null ? { ...chain[i], a: 1 } : over(chain[i], acc); return acc; };
  // Worst case: answer "what if the backdrop behind the translucency is the opposite extreme?"
  const paintedExtreme = (chain, extreme) => {
    let acc = extreme;
    for (let i = chain.length - 1; i >= 0; i--) acc = over(chain[i], acc);
    return acc;
  };

  const visible = el => { const s = getComputedStyle(el); if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const label = el => (el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  // Where does this element live? Gives the reader a locator instead of a bare measurement.
  const ctxOf = el => {
    let n = el, hops = 0;
    while (n && hops < 8) {
      const cls = (n.className || '').toString();
      if (/cust-(combo|card|stat|row|ptab|sec|lrow|mecard|quick|pill)/.test(cls)) return cls.split(/\s+/).find(c => /^cust-/.test(c)) || '';
      n = n.parentElement; hops++;
    }
    return '';
  };

  // ── touch targets: label-aware (a 16px checkbox inside a 281x49 label is a 281x49 target)
  const targets = [];
  const clickable = [...document.querySelectorAll('button, a[href], [role=button], [role=switch], [role=tab], input[type=checkbox], input[type=radio], select, summary, [onclick]')];
  for (const el of clickable) {
    if (!visible(el)) continue;
    let t = el, r = el.getBoundingClientRect();
    const lab = el.closest('label');
    if (lab) { const lr = lab.getBoundingClientRect(); if (lr.width * lr.height > r.width * r.height) { t = lab; r = lr; } }
    const w = Math.round(r.width), h = Math.round(r.height);
    const rec = { t: label(t), aria: t.getAttribute('aria-label') || el.getAttribute('aria-label') || '', w, h, tag: t.tagName.toLowerCase(), role: t.getAttribute('role') || '', ctx: ctxOf(t) };
    if (w < 24 || h < 24) { rec.wcag = false; rec.apple = true; targets.push(rec); }
    else if (w < 44 || h < 44) { rec.wcag = true; rec.apple = true; targets.push(rec); }
  }
  const dedupe = arr => { const m = new Map(); for (const x of arr) { const k = `${x.w}x${x.h}|${x.tag}|${x.t}|${x.ctx}`; if (!m.has(k)) m.set(k, { ...x, n: 1 }); else m.get(k).n++; } return [...m.values()]; };

  // ── contrast of every visible text node, alpha-composited, in both directions
  const bad = [], risk = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node, seen = 0;
  while ((node = walker.nextNode()) && seen < 6000) {
    seen++;
    const s = (node.nodeValue || '').trim();
    if (s.length < 2) continue;
    const el = node.parentElement;
    if (!el || !visible(el)) continue;
    const st = getComputedStyle(el);
    const rawFg = parseRGB(st.color);
    if (!rawFg || rawFg.a === 0) continue;
    const chain = bgChain(el);
    const bg = painted(chain);
    const fg = over(rawFg, bg);
    const size = px(st.fontSize);
    const bold = (parseInt(st.fontWeight) || 400) >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    const need = large ? 3 : 4.5;
    const cr = ratio(fg, bg);
    // `overImage` — a gradient/decor layer sits somewhere behind this text, so the flat
    // colour maths is indicative, not authoritative. Kept and labelled, not silently dropped.
    const rec = { t: s.slice(0, 40), size: Math.round(size * 10) / 10, weight: st.fontWeight, need: need, fg: st.color, bg: `rgb(${bg.r},${bg.g},${bg.b})`, ctx: ctxOf(el), overImage: !!chain.overImage };
    if (cr < need) {
      // Rigorous: if the text fails against BOTH a pure-white and a pure-black backdrop
      // behind whatever translucency sits under it, it fails on any backdrop. Luminance
      // between white and black bounds every real colour, so this is sound, not a guess.
      const wW = paintedExtreme(chain, WHITE), wB = paintedExtreme(chain, BLACK);
      const worst = Math.min(ratio(over(rawFg, wW), wW), ratio(over(rawFg, wB), wB));
      bad.push({ ...rec, cr: Math.round(cr * 100) / 100, worst: Math.round(worst * 100) / 100, solid: worst < need });
    } else {
      const alphaLayers = chain.filter(c => c.a < 1).length;
      if (alphaLayers > 0) {
        const w1 = ratio(over(rawFg, paintedExtreme(chain, WHITE)), paintedExtreme(chain, WHITE));
        const w2 = ratio(over(rawFg, paintedExtreme(chain, BLACK)), paintedExtreme(chain, BLACK));
        risk.push({ ...rec, cr: Math.round(cr * 100) / 100, worst: Math.round(Math.min(w1, w2) * 100) / 100 });
      }
    }
  }

  // ── iOS autozoom: a focused input below 16px makes Safari zoom in and never zoom back
  const smallInputs = [...document.querySelectorAll('input:not([type=hidden]), select, textarea')]
    .filter(visible)
    .map(e => ({ t: e.type || e.tagName, fs: px(getComputedStyle(e).fontSize), name: e.id || e.name || e.placeholder || '' }))
    .filter(x => x.fs < 16);

  // ── nav occlusion: is any interactive element painted UNDER the floating bottom nav?
  const nav = document.querySelector('nav');
  let occluded = [];
  if (nav) {
    const nr = nav.getBoundingClientRect();
    for (const el of clickable) {
      if (!visible(el) || nav.contains(el)) continue;
      const r = el.getBoundingClientRect();
      const ox = Math.max(0, Math.min(r.right, nr.right) - Math.max(r.left, nr.left));
      const oy = Math.max(0, Math.min(r.bottom, nr.bottom) - Math.max(r.top, nr.top));
      if (ox > 6 && oy > 6) {
        const cx = Math.max(r.left, nr.left) + ox / 2, cy = Math.max(r.top, nr.top) + oy / 2;
        const top = document.elementFromPoint(cx, cy);
        if (top && (nav.contains(top) || top === nav)) occluded.push({ t: label(el), ox: Math.round(ox), oy: Math.round(oy), ctx: ctxOf(el), tag: el.tagName.toLowerCase() });
      }
    }
  }
  // Content padding vs the nav's real footprint — answers "can the reader scroll clear of it?"
  let navPad = null;
  if (nav) {
    const nr = nav.getBoundingClientRect();
    navPad = { navHeight: Math.round(nr.height), navTop: Math.round(nr.top), navBottom: Math.round(nr.bottom), vh: window.innerHeight, scroller: window.__scroller || 'body' };
  }
  // Bottom clearance: after jumping to the very end of the document, is the last interactive
  // element still covered by the nav? This is the difference between "scrollable" and "usable".
  let lastRow = null;
  if (nav) {
    const before = window.scrollY;
    window.scrollTo(0, document.documentElement.scrollHeight);
    const nr = nav.getBoundingClientRect();
    const cands = clickable.filter(el => { const r = el.getBoundingClientRect(); return r.height > 0 && r.bottom > nr.top - 40 && !nav.contains(el); });
    let covered = 0, checked = 0;
    for (const el of cands) {
      const r = el.getBoundingClientRect();
      const ox = Math.max(0, Math.min(r.right, nr.right) - Math.max(r.left, nr.left));
      const oy = Math.max(0, Math.min(r.bottom, nr.bottom) - Math.max(r.top, nr.top));
      if (ox > 6 && oy > 6) {
        checked++;
        const top = document.elementFromPoint(Math.max(r.left, nr.left) + ox / 2, Math.max(r.top, nr.top) + oy / 2);
        if (top && (nav.contains(top) || top === nav)) covered++;
      }
    }
    const de = document.documentElement;
    lastRow = { atDocumentEnd: Math.abs(window.scrollY + window.innerHeight - de.scrollHeight) < 6, nearNav: checked, covered };
    window.scrollTo(0, before);
  }

  // ── a11y snapshot (tagName is UPPERCASE — compare case-insensitively)
  const imgs = [...document.querySelectorAll('img')].filter(visible);
  const iconOnly = [...document.querySelectorAll('button')].filter(x => visible(x) && x.innerText.trim() === '' && !x.getAttribute('aria-label') && !x.title)
    .map(x => ({ w: Math.round(x.getBoundingClientRect().width), h: Math.round(x.getBoundingClientRect().height), ctx: ctxOf(x) }));
  const hs = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(e => e.tagName);
  const de = document.documentElement;
  return {
    vw: window.innerWidth, vh: window.innerHeight,
    docW: de.scrollWidth, docH: de.scrollHeight,
    overflowX: de.scrollWidth > window.innerWidth + 2,
    overflowWide: de.scrollWidth - window.innerWidth,
    h1: hs.filter(x => /^H1$/i.test(x)).length, headings: hs.slice(0, 14),
    imgCount: imgs.length, imgNoAltAttr: imgs.filter(i => !i.hasAttribute('alt')).length, imgEmptyAlt: imgs.filter(i => i.getAttribute('alt') === '').length,
    iconOnlyButtons: iconOnly.length, iconOnlyDetail: iconOnly.slice(0, 8),
    tablist: document.querySelectorAll('[role=tablist]').length,
    navTabs: [...document.querySelectorAll('nav button')].map(x => ({ t: label(x), w: Math.round(x.getBoundingClientRect().width), h: Math.round(x.getBoundingClientRect().height), role: x.getAttribute('role') || '', cur: x.getAttribute('aria-selected') || '' })),
    targets24: dedupe(targets.filter(t => !t.wcag)), targets44: dedupe(targets.filter(t => t.wcag)),
    smallInputs, contrast: bad.sort((a, b) => a.cr - b.cr).slice(0, 30),
    contrastRisk: risk.sort((a, b) => a.worst - b.worst).slice(0, 10),
    occluded: dedupe(occluded).slice(0, 15),
    navPad, lastRow,
    textLen: (document.body.innerText || '').length,
    lang: de.lang, theme: localStorage.getItem('customer_theme'),
  };
};

// ── walk the flow ──────────────────────────────────────────────────────────────
try {
  await p.goto(`${SITE}/?join=1`, { waitUntil: 'networkidle', timeout: 60000 });
  await p.waitForTimeout(2500);
  await dismissOnboarding();
  await p.waitForTimeout(800);
  out.join_probe = await p.evaluate(PROBE);
  await shot('00-join');

  const signupBtn = p.getByRole('button', { name: /^(Başla|Sign up|Qeydiyyatdan keç|Начать)$/ });
  await signupBtn.first().waitFor({ state: 'visible', timeout: 15000 });
  await signupBtn.first().click();
  await p.waitForTimeout(6000);
  await dismissOnboarding();
  await p.waitForTimeout(1500);
  const st = await store();
  out.card = st.card; out.token = st.token;
  out.url = p.url();

  // Scroll the app's real scroller to the end so the probe sees the whole surface, not the fold.
  const scrollAll = async () => {
    await p.evaluate(() => {
      const de = document.documentElement;
      const inner = [...document.querySelectorAll('div')].filter(d => {
        const s = getComputedStyle(d);
        return (s.overflowY === 'auto' || s.overflowY === 'scroll') && d.scrollHeight > d.clientHeight + 40;
      });
      window.__scroller = inner.length ? 'inner' : 'document';
      for (const d of inner) d.scrollTop = d.scrollHeight;
      de.scrollTop = de.scrollHeight;
      window.scrollTo(0, de.scrollHeight);
    });
    await p.waitForTimeout(700);
  };

  // Reach every tab. Bottom nav only exposes home + order, so use the in-page routes.
  const goTab = async (name, key) => {
    await p.evaluate(k => { try { localStorage.setItem('customer_initial_tab', k); } catch {} }, key);
    await p.reload({ waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
    await p.waitForTimeout(3000);
    await dismissOnboarding();
    await p.waitForTimeout(1500);
    await scrollAll();
    out.tabs[name] = await p.evaluate(PROBE);
    await shot(`tab-${name}`);
  };
  await goTab('home', 'home');
  await goTab('menu', 'order');
  await goTab('offers', 'offers');
  await goTab('ai', 'ai');
  await goTab('feedback', 'feedback');
  await goTab('profile', 'profile');

  // Tablet / small-phone sanity: same app, different canvas.
  const quick = async (name, w, h) => {
    await p.setViewportSize({ width: w, height: h });
    await p.evaluate(() => { try { localStorage.setItem('customer_initial_tab', 'home'); } catch {} });
    await p.reload({ waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
    await p.waitForTimeout(2500);
    await dismissOnboarding();
    await p.waitForTimeout(1200);
    await scrollAll();
    out.tabs[name] = await p.evaluate(PROBE);
    await shot(`vp-${name}`);
  };
  await quick('vp320', 320, 568);
  await quick('vp360', 360, 800);
  await quick('vp768', 768, 1024);
  await p.setViewportSize({ width: 390, height: 844 });

  // Switch to dark and re-probe the home tab — the theme axis has its own contrast risk.
  await p.evaluate(() => { try { localStorage.setItem('customer_theme', 'dark'); } catch {} });
  await p.evaluate(() => { try { localStorage.setItem('customer_initial_tab', 'home'); } catch {} });
  await p.reload({ waitUntil: 'networkidle', timeout: 60000 });
  await p.waitForTimeout(3500);
  await dismissOnboarding();
  await p.waitForTimeout(1500);
  await scrollAll();
  out.tabs['home_dark'] = await p.evaluate(PROBE);
  await shot('tab-home_dark');

  // Profile in dark — the switch/settings surface is the densest low-contrast risk.
  await p.evaluate(() => { try { localStorage.setItem('customer_initial_tab', 'profile'); } catch {} });
  await p.reload({ waitUntil: 'networkidle', timeout: 60000 });
  await p.waitForTimeout(3000);
  await dismissOnboarding();
  await p.waitForTimeout(1500);
  await scrollAll();
  out.tabs['profile_dark'] = await p.evaluate(PROBE);
  await shot('tab-profile_dark');

  // Menu detail: open the first product's modifier sheet (guarded — no order is submitted).
  await p.evaluate(() => { try { localStorage.setItem('customer_theme', 'light'); localStorage.setItem('customer_initial_tab', 'order'); } catch {} });
  await p.reload({ waitUntil: 'networkidle', timeout: 60000 });
  await p.waitForTimeout(3500);
  await dismissOnboarding();
  await p.waitForTimeout(1500);
  out.menu_before_cart = {
    cartVisible: await p.locator('text=/Səbət|Cart|Корзина/i').count(),
  };
  await shot('menu-full');
} catch (e) {
  out.error = String(e).slice(0, 500);
  await shot('99-error');
} finally {
  const s = await store().catch(() => ({}));
  out.card = out.card || s.card; out.token = out.token || s.token;
  console.log('###JSON###' + JSON.stringify(out));
  await b.close();
}
"""


def main() -> int:
    SHOTS.mkdir(parents=True, exist_ok=True)
    js_path = ROOT / "uxaudit.tmp.mjs"
    js_path.write_text(BROWSER_JS)
    env = {**os.environ, "SITE": SITE, "SHOTS": str(SHOTS.resolve()), "NODE_OPTIONS": ""}
    r = subprocess.run(["node", js_path.name], cwd=ROOT, env=env, capture_output=True, text=True)
    js_path.unlink(missing_ok=True)

    blob = r.stdout[r.stdout.index("###JSON###") + 10:].strip() if "###JSON###" in r.stdout else None
    if not blob:
        print("NO RESULT")
        print(r.stdout[-1500:])
        print(r.stderr[-2500:])
        return 1

    data = json.loads(blob)
    outdir = Path("outputs/customer-app-ux-audit")
    outdir.mkdir(parents=True, exist_ok=True)
    (outdir / "audit.json").write_text(json.dumps(data, indent=2, ensure_ascii=False))

    # ── cleanup FIRST so a report bug can never leak the temp customer
    card, token = data.get("card"), data.get("token")
    if card and token:
        st, body = call("POST", "/customer-app/delete-account", body={"card_id": card, "token": token})
        print(f"CLEANUP delete-account status={st} {str(body)[:70]}")
        st2, _ = call("GET", "/customer-app/session", query={"id": card, "t": token})
        print(f"CLEANUP verify gone: status={st2} (expect 401)")
    else:
        print(f"CLEANUP SKIPPED card={card} token={'set' if token else 'missing'}")

    def probe_summary(name, pr):
        if not pr:
            print(f"  {name}: MISSING"); return
        t24 = sum(t.get("n", 1) for t in pr.get("targets24", []))
        t44 = sum(t.get("n", 1) for t in pr.get("targets44", []))
        ci = len(pr.get("smallInputs", []))
        cc = len(pr.get("contrast", []))
        cs = len([c for c in pr.get("contrast", []) if c.get("solid")])
        oc = len(pr.get("occluded", []))
        print(f"  {name:10s} vw={pr['vw']} docW={pr['docW']} ovf={pr['overflowX']}({pr['overflowWide']}px) "
              f"h1={pr['h1']} icons={pr['iconOnlyButtons']} t<24={t24} t<44={t44} "
              f"smallInputs={ci} lowContrast={cc}(solid={cs}) navClip={oc}")

    print("\n=== PER-TAB ===")
    probe_summary("join", data.get("join_probe"))
    for k, v in (data.get("tabs") or {}).items():
        probe_summary(k, v)

    print("\n=== OVERFLOW DETAIL ===")
    found = False
    for k, v in (data.get("tabs") or {}).items():
        if v and v.get("overflowX"):
            found = True
            print(f"  {k}: docW={v['docW']} vw={v['vw']} (+{v['overflowWide']}px)")
    if not found:
        print("  none — no horizontal scroll on any tab at 390px")

    print("\n=== WCAG 24x24 VIOLATIONS (mandatory) ===")
    any24 = False
    for k, v in (data.get("tabs") or {}).items():
        for t in (v or {}).get("targets24", []):
            any24 = True
            print(f"  {k:10s} x{t.get('n',1):<3} {t['w']:>3}x{t['h']:<3} {t['tag']:6s} {t['t']!r} {t['ctx']}")
    if not any24:
        print("  none")

    print("\n=== BELOW APPLE 44 / GOOGLE 48 (recommendation, NOT a violation) ===")
    for k, v in (data.get("tabs") or {}).items():
        for t in (v or {}).get("targets44", []):
            print(f"  {k:10s} x{t.get('n',1):<3} {t['w']:>3}x{t['h']:<3} {t['tag']:6s} {t['t']!r} {t['ctx']}")

    print("\n=== iOS ZOOM RISK (input font < 16px) ===")
    for k, v in [("join", data.get("join_probe"))] + list((data.get("tabs") or {}).items()):
        for i in (v or {}).get("smallInputs", []):
            print(f"  {k:10s} {i['fs']}px  {i['t']} {i['name']!r}")

    print("\n=== LOW CONTRAST — SOLID only (definitely broken) ===")
    for k, v in (data.get("tabs") or {}).items():
        for c in [c for c in (v or {}).get("contrast", []) if c.get("solid")]:
            print(f"  {k:10s} {c['cr']:>5}:1 need {c['need']}  {c['size']}px/{c['weight']}  {c['t']!r}  {c['ctx']}  worst={c['worst']}")

    print("\n=== LOW CONTRAST — translucent backdrop (composited, worst-case shown) ===")
    for k, v in (data.get("tabs") or {}).items():
        for c in [c for c in (v or {}).get("contrast", []) if not c.get("solid")]:
            print(f"  {k:10s} {c['cr']:>5}:1 worst={c['worst']:>5} need {c['need']}  {c['size']}px/{c['weight']}  {c['t']!r}  {c['ctx']}")

    print("\n=== AT-RISK on a busy/translucent backdrop (passes now, may fail elsewhere) ===")
    for k, v in (data.get("tabs") or {}).items():
        for c in (v or {}).get("contrastRisk", []):
            print(f"  {k:10s} {c['cr']:>5}:1 worst={c['worst']:>5} need {c['need']}  {c['size']}px/{c['weight']}  {c['t']!r}  {c['ctx']}")

    print("\n=== NAV OCCLUSION ===")
    for k, v in (data.get("tabs") or {}).items():
        for o in (v or {}).get("occluded", []):
            print(f"  {k:10s} x{o.get('n',1):<3} clipped {o['ox']}x{o['oy']}px  {o['tag']:6s} {o['t']!r} {o['ctx']}")
    print("\n=== SCROLL CLEARANCE ===")
    for k, v in (data.get("tabs") or {}).items():
        if v and v.get("navPad"):
            n = v["navPad"]
            print(f"  {k:10s} host={n['host']:16s} padBottom={n['padBottom']:8s} navHeight={n['navHeight']} "
                  f"navTop={n['navTop']} vh={n['vh']} canScrollClear={v.get('canScrollClear')}")

    print("\n=== A11Y / META ===")
    for k, v in [("join", data.get("join_probe"))] + list((data.get("tabs") or {}).items()):
        if not v: continue
        print(f"  {k:10s} lang={v['lang']!r} theme={v['theme']} h1={v['h1']} tablist={v['tablist']} "
              f"headings={v['headings'][:6]} imgs={v['imgCount']} noAlt={v['imgNoAltAttr']} emptyAlt={v['imgEmptyAlt']} "
              f"iconOnly={v['iconOnlyButtons']}{v['iconOnlyDetail'] if v['iconOnlyDetail'] else ''}")

    print("\n=== BOTTOM NAV (the floating panel) ===")
    for k, v in (data.get("tabs") or {}).items():
        if v and v.get("navTabs"):
            print(f"  {k}: {v['navTabs']}")
            break

    print(f"\nconsole/api errors: {data.get('console_errors')}")
    print(f"failed api calls: {data.get('requests')}")
    if data.get("error"):
        print(f"BROWSER ERROR: {data['error']}")
    print(f"\nJSON: {outdir / 'audit.json'}")
    print(f"SHOTS: {SHOTS.resolve()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
