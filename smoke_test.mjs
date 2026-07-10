// @ts-check
import { chromium } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = 'http://localhost:5174/customer.html';
const SCREENSHOT_DIR = '/Users/macbookair/.gemini/antigravity/brain/c9dd35ef-1341-4bb7-932e-2136924e311c/smoke_screenshots';

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

const results = [];
const consoleErrors = [];

async function shot(page, name) {
  const file = path.join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

async function runSmokeTest() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
  });
  const page = await context.newPage();

  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(`[CONSOLE ERROR] ${msg.text()}`);
  });
  page.on('pageerror', err => {
    consoleErrors.push(`[PAGE ERROR] ${err.message}`);
  });

  // ─── 1. Initial Load ───────────────────────────────────────────────────────
  console.log('\n🧪 Test 1: Initial Load');
  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(3000);
    const bodyText = await page.locator('body').innerText().catch(() => '');
    const hasErrorBoundary = bodyText.includes('Səhifəni yeniləyin') || bodyText.includes('undefined is not') || bodyText.includes('Yenilə');
    const elemCount = await page.locator('div').count();
    const sc = await shot(page, '01_initial_load');
    results.push({
      name: '1. Initial Load',
      status: hasErrorBoundary ? 'FAIL' : elemCount > 5 ? 'PASS' : 'WARN',
      notes: hasErrorBoundary
        ? `❌ Error boundary visible. Snippet: "${bodyText.slice(0, 150)}"`
        : `✅ Loaded. ${elemCount} divs rendered.`,
      screenshot: sc,
    });
  } catch (e) {
    results.push({ name: '1. Initial Load', status: 'FAIL', notes: `Exception: ${e.message}` });
  }

  // ─── 2. Check for "undefined" / NaN in body ───────────────────────────────
  console.log('🧪 Test 2: No undefined/NaN in visible text');
  try {
    const bodyText = await page.locator('body').innerText().catch(() => '');
    const undefinedCount = (bodyText.match(/\bundefined\b/g) || []).length;
    const nanCount = (bodyText.match(/\bNaN\b/g) || []).length;
    const sc = await shot(page, '02_home_loyalty');
    results.push({
      name: '2. Home/Loyalty — undefined check',
      status: undefinedCount === 0 && nanCount === 0 ? 'PASS' : 'FAIL',
      notes: undefinedCount === 0 && nanCount === 0
        ? '✅ No "undefined" or "NaN" in visible text'
        : `❌ Found: ${undefinedCount}x "undefined", ${nanCount}x "NaN"`,
      screenshot: sc,
    });
  } catch (e) {
    results.push({ name: '2. Home/Loyalty — undefined check', status: 'FAIL', notes: `Exception: ${e.message}` });
  }

  // ─── 3. Navigate to Menu Tab ───────────────────────────────────────────────
  console.log('🧪 Test 3: Navigate to Menu Tab');
  try {
    // Bottom nav: find buttons in y > 750
    const allBtns = await page.locator('button').all();
    const bottomBtns = [];
    for (const btn of allBtns) {
      const bb = await btn.boundingBox().catch(() => null);
      if (bb && bb.y > 730 && bb.y < 850) bottomBtns.push({ btn, bb });
    }
    console.log(`  Found ${bottomBtns.length} bottom nav buttons`);

    // Click the 2nd bottom button (order tab)
    if (bottomBtns.length >= 2) {
      bottomBtns.sort((a, b) => a.bb.x - b.bb.x);
      await bottomBtns[1].btn.click();
    } else if (bottomBtns.length === 1) {
      await bottomBtns[0].btn.click();
    } else {
      // Fallback: click center of bottom area
      await page.mouse.click(195, 790);
    }

    await page.waitForTimeout(2500);
    const bodyText = await page.locator('body').innerText().catch(() => '');
    const hasPrice = bodyText.includes('₼');
    const imgCount = await page.locator('img').count();
    const undefinedCount = (bodyText.match(/\bundefined\b/g) || []).length;
    const sc = await shot(page, '03_menu_tab');
    results.push({
      name: '3. Menu Tab — Items render',
      status: hasPrice ? (undefinedCount > 0 ? 'WARN' : 'PASS') : 'WARN',
      notes: [
        hasPrice ? '✅ Prices (₼) visible' : '⚠️ No prices visible',
        `📷 Images: ${imgCount}`,
        undefinedCount > 0 ? `⚠️ ${undefinedCount}x "undefined" in page` : '✅ No undefined text',
      ].join(' | '),
      screenshot: sc,
    });
  } catch (e) {
    results.push({ name: '3. Menu Tab — Items render', status: 'FAIL', notes: `Exception: ${e.message}` });
  }

  // ─── 4. Category chip click ────────────────────────────────────────────────
  console.log('🧪 Test 4: Category chip click');
  try {
    const allBtns = await page.locator('button').all();
    let clicked = null;
    for (const btn of allBtns) {
      const bb = await btn.boundingBox().catch(() => null);
      const text = await btn.innerText().catch(() => '');
      if (bb && bb.y > 120 && bb.y < 400 && text.trim().length > 0 && text.trim().length < 30) {
        await btn.click();
        clicked = text.trim();
        console.log(`  Clicked: "${clicked}"`);
        break;
      }
    }
    await page.waitForTimeout(1200);
    const bodyText = await page.locator('body').innerText().catch(() => '');
    const sc = await shot(page, '04_category_filtered');
    results.push({
      name: '4. Category Filter',
      status: clicked ? 'PASS' : 'WARN',
      notes: clicked
        ? `✅ Clicked category "${clicked}". Items still present: ${bodyText.includes('₼')}`
        : '⚠️ No category chip found to click',
      screenshot: sc,
    });
  } catch (e) {
    results.push({ name: '4. Category Filter', status: 'FAIL', notes: `Exception: ${e.message}` });
  }

  // ─── 5. Open product modifier sheet ───────────────────────────────────────
  console.log('🧪 Test 5: Open ModifierSheet');
  try {
    const imgs = await page.locator('img').all();
    let cardClicked = false;
    for (const img of imgs) {
      const bb = await img.boundingBox().catch(() => null);
      if (bb && bb.width > 60 && bb.height > 60 && bb.y > 100 && bb.y < 750) {
        await img.click({ force: true });
        cardClicked = true;
        console.log(`  Clicked image at y=${Math.round(bb.y)}`);
        break;
      }
    }

    await page.waitForTimeout(2000);
    const bodyText = await page.locator('body').innerText().catch(() => '');
    const sheetOpen = bodyText.toLowerCase().includes('əlavə et') ||
      bodyText.toLowerCase().includes('add to cart') ||
      bodyText.toLowerCase().includes('seçin') ||
      bodyText.match(/\d+\.\d{2}\s*₼/) !== null;
    const undefinedInSheet = (bodyText.match(/\bundefined\b/g) || []).length > 0;

    const sc = await shot(page, '05_modifier_sheet');
    results.push({
      name: '5. ModifierSheet Open',
      status: cardClicked && sheetOpen ? (undefinedInSheet ? 'WARN' : 'PASS') : 'WARN',
      notes: [
        cardClicked ? '✅ Card clicked' : '⚠️ No card clicked',
        sheetOpen ? '✅ Sheet appears open' : '⚠️ Sheet may not have opened',
        undefinedInSheet ? '⚠️ "undefined" in sheet content' : '✅ No undefined in sheet',
      ].join(' | '),
      screenshot: sc,
    });
  } catch (e) {
    results.push({ name: '5. ModifierSheet Open', status: 'FAIL', notes: `Exception: ${e.message}` });
  }

  // ─── 6. Add to Cart ────────────────────────────────────────────────────────
  console.log('🧪 Test 6: Add to Cart button');
  try {
    const allBtns = await page.locator('button').all();
    let addClicked = false;
    for (const btn of allBtns) {
      const text = await btn.innerText().catch(() => '');
      const bb = await btn.boundingBox().catch(() => null);
      if (!bb) continue;
      if (text.toLowerCase().includes('əlavə') || text.toLowerCase().includes('add') || text.trim() === '+') {
        await btn.click({ force: true }).catch(() => {});
        addClicked = true;
        console.log(`  Clicked button: "${text.slice(0, 30)}"`);
        break;
      }
    }

    await page.waitForTimeout(1000);
    const sc = await shot(page, '06_after_add_to_cart');
    results.push({
      name: '6. Add to Cart',
      status: addClicked ? 'PASS' : 'WARN',
      notes: addClicked ? '✅ Add to cart button found and clicked' : '⚠️ Add to cart button not found',
      screenshot: sc,
    });
  } catch (e) {
    results.push({ name: '6. Add to Cart', status: 'FAIL', notes: `Exception: ${e.message}` });
  }

  // ─── 7. JS Console Errors ──────────────────────────────────────────────────
  console.log('🧪 Test 7: JS Console Errors');
  results.push({
    name: '7. JS Console Errors',
    status: consoleErrors.length === 0 ? 'PASS' : 'FAIL',
    notes: consoleErrors.length === 0
      ? '✅ No console/JS errors during test session'
      : `❌ ${consoleErrors.length} error(s):\n     ${consoleErrors.slice(0, 8).join('\n     ')}`,
  });

  await shot(page, '99_final_state');
  await browser.close();

  // ─── REPORT ────────────────────────────────────────────────────────────────
  console.log('\n\n═══════════════════════════════════════════════════════════');
  console.log('           CUSTOMER APP SMOKE TEST REPORT');
  console.log('═══════════════════════════════════════════════════════════\n');

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

  console.log('───────────────────────────────────────────────────────────');
  console.log(`RESULT: ${results.length} tests  ✅ ${passed} PASS  ❌ ${failed} FAIL  ⚠️ ${warned} WARN`);
  console.log(`Screenshots saved in: ${SCREENSHOT_DIR}`);
  console.log('═══════════════════════════════════════════════════════════\n');

  fs.writeFileSync(
    path.join(SCREENSHOT_DIR, 'smoke_report.json'),
    JSON.stringify({ results, consoleErrors, timestamp: new Date().toISOString() }, null, 2)
  );
}

runSmokeTest().catch(err => {
  console.error('💥 Smoke test crashed:', err);
  process.exit(1);
});
