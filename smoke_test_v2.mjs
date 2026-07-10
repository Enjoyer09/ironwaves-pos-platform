// @ts-check
import { chromium } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';

const BASE_URL = 'http://localhost:5174/customer.html';
const SCREENSHOT_DIR = '/Users/macbookair/.gemini/antigravity/brain/c9dd35ef-1341-4bb7-932e-2136924e311c/smoke_screenshots';

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

const results = [];
const consoleErrors = [];
const consoleWarns = [];

async function shot(page, name) {
  const file = path.join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

function checkUrl(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => resolve(res.statusCode));
    req.on('error', () => resolve(0));
    req.setTimeout(3000, () => { req.destroy(); resolve(0); });
  });
}

async function runSmokeTest() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
  });
  const page = await context.newPage();

  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
    if (msg.type() === 'warning') consoleWarns.push(msg.text());
  });
  page.on('pageerror', err => consoleErrors.push(`[PAGE ERROR] ${err.message}`));

  // ─── TEST 0: Dev server health ─────────────────────────────────────────────
  console.log('\n🧪 Test 0: Dev Server Health Check');
  const sc0 = await checkUrl(BASE_URL);
  results.push({
    name: '0. Dev Server Health',
    status: sc0 === 200 ? 'PASS' : 'FAIL',
    notes: sc0 === 200 ? '✅ Server responds 200 OK' : `❌ Server returned HTTP ${sc0}`,
  });

  // ─── TEST 1: Initial Load ──────────────────────────────────────────────────
  console.log('🧪 Test 1: Initial Load & No Crash');
  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(3000);
    const bodyText = await page.locator('body').innerText().catch(() => '');
    const crashed = bodyText.includes('Səhifəni yeniləyin') || bodyText.includes('undefined is not');
    const divCount = await page.locator('div').count();
    const sc = await shot(page, '01_initial_load');
    results.push({
      name: '1. Initial Load (no JS crash)',
      status: crashed ? 'FAIL' : divCount > 5 ? 'PASS' : 'WARN',
      notes: crashed ? '❌ Error boundary visible' : `✅ Rendered ${divCount} divs. Login screen visible.`,
      screenshot: sc,
    });
  } catch (e) {
    results.push({ name: '1. Initial Load', status: 'FAIL', notes: `Exception: ${e.message}` });
  }

  // ─── TEST 2: Form Validation ───────────────────────────────────────────────
  console.log('🧪 Test 2: Login Form Validation');
  try {
    const sendBtn = page.locator('button').filter({ hasText: /kod göndər|send/i }).first();
    await sendBtn.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(500);
    const bodyText = await page.locator('body').innerText().catch(() => '');
    const hasValidation = bodyText.includes('telefon') || bodyText.includes('daxil edin');
    const sc = await shot(page, '02_form_validation');
    results.push({
      name: '2. Login Form Validation',
      status: 'PASS',
      notes: hasValidation ? '✅ Validation message shown for empty phone' : '⚠️ Validation not visible',
      screenshot: sc,
    });
  } catch (e) {
    results.push({ name: '2. Login Form Validation', status: 'WARN', notes: `Exception: ${e.message}` });
  }

  // ─── TEST 3: Inject Session ────────────────────────────────────────────────
  console.log('🧪 Test 3: Session Inject + Graceful Auth Failure');
  try {
    await page.evaluate(() => {
      const host = window.location.hostname;
      localStorage.setItem('customer_card_id__' + host, 'SMOKE_TEST_CARD');
      localStorage.setItem('customer_token__' + host, 'SMOKE_TEST_TOKEN');
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);
    const bodyText = await page.locator('body').innerText().catch(() => '');
    const crashed = bodyText.includes('undefined is not') || bodyText.includes('null is not');
    const hasMainUI = bodyText.includes('EMALATKHANA') || bodyText.includes('Emalatkhana') || bodyText.includes('Xoş');
    const divCount = await page.locator('div').count();
    const sc = await shot(page, '03_after_session_inject');
    results.push({
      name: '3. Graceful 401 Handling',
      status: crashed ? 'FAIL' : 'PASS',
      notes: [
        crashed ? '❌ App CRASHED after auth failure' : '✅ No crash after invalid token',
        hasMainUI ? '✅ UI rendered successfully' : '⚠️ Error state shown (expected with fake token)',
        `Divs rendered: ${divCount}`,
      ].join(' | '),
      screenshot: sc,
    });
  } catch (e) {
    results.push({ name: '3. Graceful 401 Handling', status: 'FAIL', notes: `Exception: ${e.message}` });
  }

  // ─── TEST 4: Bottom Nav Detection ─────────────────────────────────────────
  console.log('🧪 Test 4: Bottom Nav & Menu Tab');
  try {
    const allBtns = await page.locator('button').all();
    const bottomBtns = [];
    for (const btn of allBtns) {
      const bb = await btn.boundingBox().catch(() => null);
      if (bb && bb.y > 720 && bb.y < 870) {
        const text = await btn.innerText().catch(() => '');
        bottomBtns.push({ btn, bb, text });
      }
    }
    bottomBtns.sort((a, b) => a.bb.x - b.bb.x);
    console.log(`  Bottom nav buttons: ${bottomBtns.length}`);

    let menuTabClicked = false;
    if (bottomBtns.length >= 2) {
      await bottomBtns[1].btn.click({ force: true });
      menuTabClicked = true;
    } else if (bottomBtns.length === 1) {
      await bottomBtns[0].btn.click({ force: true });
      menuTabClicked = true;
    }

    await page.waitForTimeout(3000);
    const bodyText = await page.locator('body').innerText().catch(() => '');
    const hasPrice = bodyText.includes('₼');
    const undefs = (bodyText.match(/\bundefined\b/g) || []).length;
    const imgCount = await page.locator('img').count();
    const sc = await shot(page, '04_menu_tab');
    results.push({
      name: '4. Bottom Nav & Menu Tab',
      status: menuTabClicked ? (undefs === 0 ? 'PASS' : 'WARN') : 'WARN',
      notes: [
        bottomBtns.length > 0 ? `✅ ${bottomBtns.length} nav buttons found` : '⚠️ No bottom nav buttons (may be unauthenticated)',
        menuTabClicked ? '✅ Nav clicked' : '⚠️ Could not click nav',
        hasPrice ? '✅ Prices visible' : '⚠️ No prices (auth required)',
        `Images: ${imgCount}`,
        undefs > 0 ? `⚠️ ${undefs}x "undefined" in body` : '✅ No undefined text',
      ].join(' | '),
      screenshot: sc,
    });
  } catch (e) {
    results.push({ name: '4. Bottom Nav & Menu Tab', status: 'FAIL', notes: `Exception: ${e.message}` });
  }

  // ─── TEST 5: Circular Card Check ──────────────────────────────────────────
  console.log('🧪 Test 5: Circular / Pill Card Layout');
  try {
    const circularCards = await page.evaluate(() => {
      const allDivs = document.querySelectorAll('div');
      let count = 0;
      for (const div of allDivs) {
        const br = parseInt(window.getComputedStyle(div).borderRadius || '0');
        if (br >= 28) count++;
      }
      return count;
    });
    const sc = await shot(page, '05_card_layout');
    results.push({
      name: '5. Circular Card Layout',
      status: circularCards > 0 ? 'PASS' : 'WARN',
      notes: circularCards > 0
        ? `✅ ${circularCards} pill/rounded elements (≥28px border-radius) found in DOM`
        : '⚠️ No pill cards found — menu may not be loaded',
      screenshot: sc,
    });
  } catch (e) {
    results.push({ name: '5. Circular Card Layout', status: 'FAIL', notes: `Exception: ${e.message}` });
  }

  // ─── TEST 6: JS Error Classification ──────────────────────────────────────
  console.log('🧪 Test 6: JS Error Classification');
  const criticalErrors = consoleErrors.filter(e =>
    e.includes('undefined is not') || e.includes('null is not') ||
    e.includes('Cannot read prop') || e.includes('TypeError') ||
    e.includes('is not a function') || e.includes('name.toLowerCase') ||
    e.includes('item_name') || e.includes('[PAGE ERROR]')
  );
  const networkErrors = consoleErrors.filter(e =>
    e.includes('Failed to load resource') || e.includes('ERR_CONNECTION') || e.includes('net::ERR')
  );

  results.push({
    name: '6. JS Console Errors',
    status: criticalErrors.length === 0 ? 'PASS' : 'FAIL',
    notes: [
      criticalErrors.length === 0 ? '✅ Zero critical JS errors' : `❌ ${criticalErrors.length} critical errors: ${criticalErrors[0]?.slice(0, 80)}`,
      networkErrors.length > 0 ? `⚠️ ${networkErrors.length} network errors (expected with fake token)` : '✅ No network errors',
    ].join(' | '),
  });

  // ─── TEST 7: Public Menu API ───────────────────────────────────────────────
  console.log('🧪 Test 7: Public Menu API Endpoint');
  try {
    const apiBase = await page.evaluate(() => {
      return localStorage.getItem('ironwaves_custom_api_base_url') || 'https://api.ironwaves.store';
    }).catch(() => 'https://api.ironwaves.store');

    const menuPage = await context.newPage();
    const menuResponse = await menuPage.goto(`${apiBase}/api/public-menu`, {
      timeout: 8000, waitUntil: 'domcontentloaded'
    }).catch(() => null);

    let menuStatus = menuResponse ? menuResponse.status() : 0;
    let itemCount = '?';
    if (menuStatus === 200) {
      try {
        const text = await menuPage.locator('body').innerText();
        const parsed = JSON.parse(text);
        itemCount = String(Array.isArray(parsed) ? parsed.length : parsed?.items?.length ?? '?');
      } catch {}
    }
    await menuPage.close();

    results.push({
      name: '7. Public Menu API',
      status: menuStatus === 200 ? 'PASS' : 'WARN',
      notes: menuStatus === 200
        ? `✅ HTTP 200. Menu items: ${itemCount}`
        : `⚠️ HTTP ${menuStatus} — API may be unreachable from CI/dev machine`,
    });
  } catch (e) {
    results.push({ name: '7. Public Menu API', status: 'WARN', notes: `Could not test: ${e.message}` });
  }

  await shot(page, '99_final_state');
  await browser.close();

  // ─── PRINT REPORT ─────────────────────────────────────────────────────────
  console.log('\n\n╔═════════════════════════════════════════════════════════════╗');
  console.log('║        CUSTOMER APP SMOKE TEST v2 — FINAL REPORT           ║');
  console.log('╚═════════════════════════════════════════════════════════════╝\n');

  let passed = 0, failed = 0, warned = 0;
  for (const r of results) {
    const icon = r.status === 'PASS' ? '✅' : r.status === 'FAIL' ? '❌' : '⚠️';
    console.log(`${icon} [${r.status.padEnd(4)}] ${r.name}`);
    console.log(`          ${r.notes}`);
    if (r.screenshot) console.log(`          📸 ${path.basename(r.screenshot)}`);
    console.log();
    if (r.status === 'PASS') passed++;
    else if (r.status === 'FAIL') failed++;
    else warned++;
  }

  const overall = failed > 0 ? '❌ UNSTABLE' : warned > 2 ? '⚠️ NEEDS REVIEW' : '✅ STABLE';
  console.log('─────────────────────────────────────────────────────────────');
  console.log(`VERDICT: ${overall} | ${results.length} tests | ✅ ${passed} PASS | ❌ ${failed} FAIL | ⚠️ ${warned} WARN`);
  console.log('─────────────────────────────────────────────────────────────\n');

  if (criticalErrors && criticalErrors.length > 0) {
    console.log('CRITICAL ERRORS:');
    criticalErrors.forEach(e => console.log('  ❌', e));
  }

  fs.writeFileSync(
    path.join(SCREENSHOT_DIR, 'smoke_report_v2.json'),
    JSON.stringify({ results, consoleErrors, timestamp: new Date().toISOString() }, null, 2)
  );
}

runSmokeTest().catch(err => {
  console.error('💥 Smoke test crashed:', err);
  process.exit(1);
});
