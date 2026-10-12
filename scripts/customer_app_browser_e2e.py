#!/usr/bin/env python3
"""Customer-app **browser E2E** on SUPER production — the owner-visible path.

Signs up entirely through the real UI (no API shortcut), walks/skips the C11 onboarding
dialog, proves the `?customer=1` end state, opens the Profile tab, and proves a
notification preference round-trips to the server across a reload. Creates exactly ONE
temp customer and deletes it via `delete-account` at the end.

Never touches the Menu/order tab: a real pre-order would ping live staff in the KDS.
Never touches the 136 real customers.

Usage:
  SITE=https://super.ironwaves.store \
  APIBASE=https://ironwaves-pos-platform-production.up.railway.app \
  TENANT_DOMAIN=super.ironwaves.store \
  python3 scripts/customer_app_browser_e2e.py
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
SHOTS = Path("outputs/customer-app-e2e")
ROOT = Path(__file__).resolve().parent.parent

results: list[tuple[str, bool, str]] = []


def check(name, ok, extra=""):
    results.append((name, bool(ok), extra))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{extra}]" if extra else ""))


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
const out = { steps: [] };
const step = (name, ok, detail) => out.steps.push({ name, ok, detail });

const b = await chromium.launch({ channel: 'chrome' });
const ctx = await b.newContext({ viewport: { width: 414, height: 896 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
p.on('pageerror', e => out.steps.push({ name: 'PAGEERROR', ok: false, detail: String(e).slice(0, 200) }));

const shot = n => p.screenshot({ path: `${SHOTS}/${n}.png` }).catch(() => {});
const text = async () => (await p.locator('body').innerText()).replace(/\s+/g, ' ').trim();
const store = async () => p.evaluate(() => ({
  card: localStorage.getItem('customer_card_id__super.ironwaves.store'),
  token: localStorage.getItem('customer_token__super.ironwaves.store'),
  onboarded: localStorage.getItem('ironwaves_customer_onboarded'),
}));

// The C11 welcome dialog (`role=dialog` aria-label Xoş gəlmisiniz / Добро пожаловать / Welcome)
// appears on first launch over any screen. Dismiss it deterministically: prefer the Skip
// button, otherwise advance to the last slide and press Get Started.
const dialog = () => p.locator('[role=dialog][aria-modal=true]');
async function dismissOnboarding(label) {
  const d = dialog();
  if (!(await d.count())) { step(`${label}: onboarding dialog`, true, 'not shown'); return 0; }
  let clicks = 0;
  for (let i = 0; i < 6; i++) {
    if (!(await d.count())) break;
    const skip = p.getByRole('button', { name: /^(Keç|Skip|Пропустить)$/ });
    if (await skip.count() && await skip.first().isVisible()) {
      await skip.first().click({ timeout: 5000 }).catch(() => {});
      await p.waitForTimeout(700); clicks++; break;
    }
    const next = p.getByRole('button', { name: /^(Davam et|Next|Далее)$/ });
    const start = p.getByRole('button', { name: /^(Başlayaq|Get Started|Начать)$/ });
    if (await start.count() && await start.first().isVisible()) {
      await start.first().click({ timeout: 5000 }).catch(() => {});
    } else if (await next.count() && await next.first().isVisible()) {
      await next.first().click({ timeout: 5000 }).catch(() => {});
    } else break;
    await p.waitForTimeout(700); clicks++;
  }
  const st = await store();
  step(`${label}: onboarded flag set`, !!st.onboarded, `clicks=${clicks} onboarded=${st.onboarded}`);
  return clicks;
}

try {
  // ── 1. cold join ──────────────────────────────────────────────────────────
  await p.goto(`${SITE}/?join=1`, { waitUntil: 'networkidle', timeout: 60000 });
  await p.waitForTimeout(2500);
  out.url_after_join = p.url();
  await shot('01-join');
  await dismissOnboarding('join');

  // ── 2. consent gate ───────────────────────────────────────────────────────
  // NOTE: `consentChecked` defaults to **true** (CustomerApp.tsx L266), so the button
  // starts enabled. The gate itself is what must work: untick → disabled, re-tick → enabled.
  const signupBtn = p.getByRole('button', { name: /^(Başla|Sign up|Qeydiyyatdan keç|Начать)$/ });
  await signupBtn.first().waitFor({ state: 'visible', timeout: 15000 });
  const box = p.locator('input[type=checkbox]').first();
  const defaultChecked = await box.isChecked();
  out.consent_default_checked = defaultChecked;
  step('consent box default state recorded', true,
       `checked_by_default=${defaultChecked} (L266 defaults true)`);
  if (defaultChecked) { await box.uncheck(); await p.waitForTimeout(400); }
  const disabledAfterUntick = await signupBtn.first().isDisabled();
  await box.check({ timeout: 10000 });
  await p.waitForTimeout(400);
  const disabledAfterTick = await signupBtn.first().isDisabled();
  step('consent gate: untick disables, tick enables',
       disabledAfterUntick === true && disabledAfterTick === false,
       `unticked=${disabledAfterUntick} ticked=${disabledAfterTick}`);
  step('consent default is pre-ticked (compliance observation)',
       defaultChecked === true, `checked=${defaultChecked} — GDPR-style consent usually starts unticked`);
  await shot('02-consent-ticked');

  // ── 3. submit → home ──────────────────────────────────────────────────────
  await signupBtn.first().click();
  await p.waitForTimeout(6000);
  await dismissOnboarding('after-signup');
  out.url_after_signup = p.url();
  const st = await store();
  out.card = st.card; out.token = st.token;
  const homeText = await text();
  await shot('03-home');
  step('landed on the ?customer=1 end state', /customer=1/.test(p.url()), `url=${p.url()}`);
  step('card_id persisted in localStorage', !!st.card, `card=${st.card}`);
  step('secret token persisted in localStorage', !!st.token, `len=${(st.token || '').length}`);
  step('home shows loyalty content', /CASHBACK|ulduz|KASSAYA/i.test(homeText), homeText.slice(0, 110));
  step('no login/PIN screen', !/PİN Kodunuzu daxil edin/i.test(homeText), '');

  // ── 4. profile tab ────────────────────────────────────────────────────────
  const profileBtn = p.getByRole('button', { name: /^(Profil|Profile|Профиль)$/ });
  await profileBtn.first().click({ timeout: 15000 });
  await p.waitForTimeout(2500);
  await shot('04-profile');
  const profText = await text();
  const sw = p.locator('[role=switch]');
  const swCount = await sw.count();
  step('profile tab opens', /Bildiriş|Уведомления|Notifications/i.test(profText), profText.slice(0, 110));
  step('notification channel switches present (>=3)', swCount >= 3, `switches=${swCount}`);

  const labels = [];
  for (let i = 0; i < swCount; i++) labels.push(await sw.nth(i).getAttribute('aria-label'));
  out.switch_labels = labels;
  const readPrefs = async () => {
    const o = {};
    for (let i = 0; i < swCount; i++) {
      const l = (await sw.nth(i).getAttribute('aria-label')) || '';
      const k = /push/i.test(l) ? 'push' : /sms/i.test(l) ? 'sms' : /mail|e-poçt|email/i.test(l) ? 'email' : null;
      if (k) o[k] = await sw.nth(i).getAttribute('aria-checked');
    }
    return o;
  };
  const before = await readPrefs();
  out.prefs_before = before;
  step('switches expose push/email/sms', ['push', 'email', 'sms'].every(k => k in before), JSON.stringify(before));

  // ── 5. toggle SMS → must survive a reload (real server write) ─────────────
  const smsIdx = labels.findIndex(l => /sms/i.test(l || ''));
  if (smsIdx >= 0) {
    await sw.nth(smsIdx).click();
    await p.waitForTimeout(3000);
    await shot('05-sms-on');
  }
  await p.reload({ waitUntil: 'networkidle', timeout: 60000 });
  await p.waitForTimeout(3000);
  await dismissOnboarding('after-reload');
  await profileBtn.first().click({ timeout: 15000 }).catch(() => {});
  await p.waitForTimeout(2500);
  const after = await readPrefs();
  out.prefs_after = after;
  await shot('06-after-reload');
  step('SMS preference survived reload (server round-trip)', after.sms === 'true',
       `before=${before.sms} after=${after.sms}`);

  // ── 6. bare root must NOT show the customer app ───────────────────────────
  await p.goto(SITE, { waitUntil: 'networkidle', timeout: 60000 });
  await p.waitForTimeout(2500);
  const bare = await text();
  step('bare root shows staff PIN (customer app needs the query)',
       /PİN Kodunuzu daxil edin|PIN/i.test(bare), bare.slice(0, 90));
  await shot('07-bare-root');

  out.final_storage = await store();
  out.card = out.final_storage.card; out.token = out.final_storage.token;
} catch (e) {
  out.error = String(e).slice(0, 400);
  out.final_storage = await store().catch(() => ({}));
  out.card = out.final_storage.card; out.token = out.final_storage.token;
  await shot('99-error');
} finally {
  console.log('###JSON###' + JSON.stringify(out));
  await b.close();
}
"""


def main() -> int:
    SHOTS.mkdir(parents=True, exist_ok=True)
    js_path = ROOT / "e2e.tmp.mjs"
    js_path.write_text(BROWSER_JS)
    env = {**os.environ, "SITE": SITE, "SHOTS": str(SHOTS.resolve()), "NODE_OPTIONS": ""}
    r = subprocess.run(["node", js_path.name], cwd=ROOT, env=env, capture_output=True, text=True)
    js_path.unlink(missing_ok=True)

    blob = r.stdout[r.stdout.index("###JSON###") + 10:].strip() if "###JSON###" in r.stdout else None
    if not blob:
        print("BROWSER PRODUCED NO RESULT")
        print(r.stdout[-1200:]); print(r.stderr[-2000:])
        return 1

    data = json.loads(blob)
    for s in data["steps"]:
        check(s["name"], s["ok"], s["detail"])
    if data.get("error"):
        check("browser run completed without throwing", False, data["error"])
    for k in ("url_after_join", "url_after_signup", "switch_labels", "prefs_before", "prefs_after"):
        print(f"  · {k}: {data.get(k)}")

    card, token = data.get("card"), data.get("token")
    if card and token:
        st, body = call("POST", "/customer-app/delete-account", body={"card_id": card, "token": token})
        print(f"CLEANUP delete-account status={st} {str(body)[:80]}")
        st2, _ = call("GET", "/customer-app/session", query={"id": card, "t": token})
        check("cleanup: temp customer gone (401)", st2 == 401, f"status={st2}")
    else:
        check("cleanup: card+token captured", False, f"card={card} token={'set' if token else 'missing'}")

    failed = [x for x in results if not x[1]]
    print(f"\nTOTAL {len(results) - len(failed)}/{len(results)} PASS")
    for n, _, e in failed:
        print(f"  FAILED: {n} [{e}]")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
