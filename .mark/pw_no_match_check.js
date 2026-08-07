const { chromium } = require('/root/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium' });
  const page = await browser.newPage();
  await page.goto('http://localhost:3000/activities/9176', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const heading = await page.locator('text=Similar Past Activities').count();
  console.log('heading count for no-match activity:', heading);
  await browser.close();
})();
