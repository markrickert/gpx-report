const { chromium } = require('/root/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium' });
  const results = {};

  for (const theme of ['light', 'dark']) {
    for (const viewport of [{ name: 'desktop', width: 1280, height: 900 }, { name: 'mobile', width: 390, height: 844 }]) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
      const page = await context.newPage();
      await page.goto('http://localhost:3000/activities/377', { waitUntil: 'networkidle' });
      // set theme via localStorage / toggle - try to find theme toggle button
      if (theme === 'dark') {
        await page.evaluate(() => localStorage.setItem('gpx-report-theme', 'dark'));
        await page.reload({ waitUntil: 'networkidle' });
      }
      await page.waitForTimeout(500);
      const heading = await page.locator('text=Similar Past Activities').count();
      const shotPath = `/opt/gpx-report/.mark/similar_${theme}_${viewport.name}.png`;
      await page.screenshot({ path: shotPath, fullPage: true });
      results[`${theme}_${viewport.name}`] = { headingFound: heading, shotPath };
      await context.close();
    }
  }

  await browser.close();
  console.log(JSON.stringify(results, null, 2));
})();
