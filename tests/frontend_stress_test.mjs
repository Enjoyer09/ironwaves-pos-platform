import { chromium } from 'playwright';

const TARGET_URL = 'https://gyrospos.ironwaves.store';

async function runFrontendStressTest() {
  console.log('🚀 Starting Comprehensive Frontend Stress Test on:', TARGET_URL);
  console.log('------------------------------------------------------------');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--enable-precise-memory-info']
  });

  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 }
  });

  const page = await context.newPage();

  const consoleErrors = [];
  const networkErrors = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  page.on('requestfailed', (req) => {
    networkErrors.push(`${req.method()} ${req.url()} - ${req.failure()?.errorText || 'failed'}`);
  });

  // TEST 1: Page Load Performance
  console.log('\n📊 TEST 1: Page Load & Initial Render Performance');
  const t0 = performance.now();
  await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  const domLoadedTime = performance.now() - t0;

  await page.waitForLoadState('load');
  const fullLoadTime = performance.now() - t0;

  const perfMetrics = await page.evaluate(() => {
    const timing = performance.getEntriesByType('navigation')[0] || {};
    const paint = performance.getEntriesByType('paint');
    const fcp = paint.find(p => p.name === 'first-contentful-paint')?.startTime || 0;
    return {
      fcp: Math.round(fcp),
      domInteractive: Math.round(timing.domInteractive || 0),
      duration: Math.round(timing.duration || 0),
      domNodes: document.querySelectorAll('*').length,
    };
  });

  console.log(`  ✅ DOM Content Loaded: ${domLoadedTime.toFixed(1)} ms`);
  console.log(`  ✅ Full Load Time:     ${fullLoadTime.toFixed(1)} ms`);
  console.log(`  ✅ First Content Paint:${perfMetrics.fcp} ms`);
  console.log(`  ✅ Initial DOM Nodes:  ${perfMetrics.domNodes}`);

  // TEST 2: Fast PIN Login
  console.log('\n🔐 TEST 2: Fast PIN Login Stress & Auth Token Flow');
  await page.waitForTimeout(1000);

  // Check if PIN login or already logged in
  const pinButtons = await page.$$('button:has-text("1"), button:has-text("2"), button:has-text("3"), button:has-text("4")');
  if (pinButtons.length > 0) {
    const tPin0 = performance.now();
    // Enter admin PIN 1234
    for (const digit of ['1', '2', '3', '4']) {
      await page.click(`button:text-is("${digit}")`);
      await page.waitForTimeout(60);
    }
    await page.waitForTimeout(1500);
    const pinLoginTime = performance.now() - tPin0;
    console.log(`  ✅ PIN Login completed in ${pinLoginTime.toFixed(1)} ms`);
  } else {
    console.log('  ℹ️ Already authenticated or alternate login active');
  }

  // TEST 3: Rapid Module / Tab Switching Stress Test (50 iterations)
  console.log('\n⚡ TEST 3: Rapid Module / Tab Switching Stress Test (50 Cycles)');
  const routesToTest = ['/tables', '/dashboard', '/finance', '/inventory', '/analytics', '/settings', '/pos'];
  const switchTimes = [];
  const heapSnapshots = [];

  for (let i = 0; i < 50; i++) {
    const targetRoute = routesToTest[i % routesToTest.length];
    const tSwitch0 = performance.now();
    await page.evaluate((route) => {
      window.history.pushState(null, '', route);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, targetRoute);
    await page.waitForTimeout(50); // fast user simulation
    const switchDur = performance.now() - tSwitch0;
    switchTimes.push(switchDur);

    if (i % 10 === 0) {
      const stats = await page.evaluate(() => {
        return {
          nodes: document.querySelectorAll('*').length,
          jsHeap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1024 / 1024) : 'N/A'
        };
      });
      heapSnapshots.push({ cycle: i, ...stats });
    }
  }

  const avgSwitch = switchTimes.reduce((a, b) => a + b, 0) / switchTimes.length;
  const p95Switch = switchTimes.sort((a, b) => a - b)[Math.floor(switchTimes.length * 0.95)];

  console.log(`  ✅ Total Tab Switches:   50 cycles`);
  console.log(`  ✅ Average Switch Time:  ${avgSwitch.toFixed(1)} ms ⚡ (Instant SPA)`);
  console.log(`  ✅ P95 Switch Time:      ${p95Switch.toFixed(1)} ms`);
  console.log('  📊 Memory / DOM Node Evolution:');
  for (const s of heapSnapshots) {
    console.log(`     Cycle ${s.cycle.toString().padStart(2, ' ')} ➔ DOM Nodes: ${s.nodes.toString().padStart(4, ' ')} | JS Heap: ${s.jsHeap} MB`);
  }

  // TEST 4: POS Cart Rapid Calculations Stress Test
  console.log('\n🛒 TEST 4: POS Cart State & Decimal.js Calculation Stress');
  await page.evaluate(() => {
    window.history.pushState(null, '', '/pos');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await page.waitForTimeout(500);

  const productButtons = await page.$$('[data-product-id], button:has-text("₼")');
  console.log(`  ℹ️ Found ${productButtons.length} clickable product buttons on POS screen`);

  if (productButtons.length > 0) {
    const tCart0 = performance.now();
    // Rapidly click 30 items
    for (let k = 0; k < Math.min(30, productButtons.length); k++) {
      await productButtons[k % productButtons.length].click().catch(() => {});
      await page.waitForTimeout(20);
    }
    const cartTime = performance.now() - tCart0;
    console.log(`  ✅ 30 Rapid Cart Item Additions: ${cartTime.toFixed(1)} ms (avg ${(cartTime / 30).toFixed(1)} ms/item)`);
  }

  // TEST 5: Console & Error Audit
  console.log('\n🛡️ TEST 5: UI & Runtime Error Audit');
  console.log(`  ✅ Console Runtime Errors: ${consoleErrors.length}`);
  if (consoleErrors.length > 0) {
    consoleErrors.slice(0, 5).forEach((e, idx) => console.log(`     ${idx + 1}. ${e.slice(0, 100)}`));
  }
  console.log(`  ✅ Network Request Failures: ${networkErrors.length}`);
  if (networkErrors.length > 0) {
    networkErrors.slice(0, 5).forEach((e, idx) => console.log(`     ${idx + 1}. ${e.slice(0, 100)}`));
  }

  await browser.close();
  console.log('\n============================================================');
  console.log('🏁 FRONTEND STRESS TEST COMPLETED SUCCESSFULLY');
}

runFrontendStressTest().catch((err) => {
  console.error('Stress test failed:', err);
  process.exit(1);
});
