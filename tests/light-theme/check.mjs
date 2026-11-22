import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  await page.goto(process.env.LIGHT_THEME_TEST_URL || 'http://127.0.0.1:18261/tests/light-theme/');
  await page.getByText('Gyros mal əti').waitFor();
  const result = await page.evaluate(() => {
    const luminance = (rgb) => {
      const channels = rgb.match(/[\d.]+/g).slice(0, 3).map(Number).map((x) => { const c = x / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    return [...document.querySelectorAll('.table-menu-product-name')].map((node) => {
      const fg = getComputedStyle(node).color;
      const bg = getComputedStyle(node.closest('button') || node.closest('.pos-product-card')).backgroundColor;
      const a = luminance(fg), b = luminance(bg);
      return { name: node.textContent.trim(), ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
    });
  });
  if (result.length !== 2 || result.some((item) => item.ratio < 4.5)) throw Error(JSON.stringify(result));
  console.log('PASS real MenuGrid light contrast', JSON.stringify(result));
} finally { await browser.close(); }
