const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium' });
  const consoleErrors = [];

  // Stats page - desktop
  {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await context.newPage();
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(`[stats-desktop] ${msg.text()}`);
    });
    page.on('pageerror', (err) => consoleErrors.push(`[stats-desktop pageerror] ${err.message}`));
    await page.goto('http://localhost:3000/stats', { waitUntil: 'networkidle' });
    const heading = page.getByText('Personal Records', { exact: false }).first();
    try {
      await heading.scrollIntoViewIfNeeded({ timeout: 10000 });
    } catch (e) {
      console.log('Could not find "Personal Records" heading:', e.message);
    }
    await page.waitForTimeout(1000);
    await page.screenshot({ path: '/opt/gpx-report/.mark/personal_records_check.png', fullPage: true });
    console.log('Saved desktop stats screenshot');
    await context.close();
  }

  // Stats page - mobile
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(`[stats-mobile] ${msg.text()}`);
    });
    page.on('pageerror', (err) => consoleErrors.push(`[stats-mobile pageerror] ${err.message}`));
    await page.goto('http://localhost:3000/stats', { waitUntil: 'networkidle' });
    const heading = page.getByText('Personal Records', { exact: false }).first();
    try {
      await heading.scrollIntoViewIfNeeded({ timeout: 10000 });
    } catch (e) {
      console.log('Could not find "Personal Records" heading (mobile):', e.message);
    }
    await page.waitForTimeout(1000);
    await page.screenshot({ path: '/opt/gpx-report/.mark/personal_records_check_mobile.png', fullPage: true });
    console.log('Saved mobile stats screenshot');
    await context.close();
  }

  // Activity detail page
  {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await context.newPage();
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(`[activity-detail] ${msg.text()}`);
    });
    page.on('pageerror', (err) => consoleErrors.push(`[activity-detail pageerror] ${err.message}`));
    await page.goto('http://localhost:3000/activities/3461', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    const prBadgeCount = await page.getByText('PR', { exact: true }).count();
    console.log('PR badge text count on activity detail:', prBadgeCount);
    await page.screenshot({ path: '/opt/gpx-report/.mark/activity_detail_check.png', fullPage: true });
    console.log('Saved activity detail screenshot');
    await context.close();
  }

  console.log('--- Console errors ---');
  if (consoleErrors.length === 0) {
    console.log('None');
  } else {
    consoleErrors.forEach((e) => console.log(e));
  }

  await browser.close();
})();
