const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium' });
  for (const [label, viewport, colorScheme] of [
    ['desktop-light', { width: 1280, height: 900 }, 'light'],
    ['desktop-dark', { width: 1280, height: 900 }, 'dark'],
    ['mobile-light', { width: 390, height: 844 }, 'light'],
  ]) {
    const context = await browser.newContext({ viewport, colorScheme });
    const page = await context.newPage();
    await page.goto('http://localhost:3000/activities/405', { waitUntil: 'networkidle' });
    if (label === 'desktop-dark') {
      // ensure app theme toggled to dark via app's own theme switcher if colorScheme alone insufficient
      const html = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
      console.log('data-theme after colorScheme dark:', html);
    }
    await page.waitForSelector('.activity-map', { timeout: 15000 });
    await page.waitForTimeout(1500);
    const polylineCount = await page.locator('.activity-map path.leaflet-interactive').count();
    console.log(label, 'polyline path count:', polylineCount);
    await page.screenshot({ path: `/opt/gpx-report/.mark/pw_${label}.png` });

    // hover test: move mouse across map, check for hover dot circle marker
    const mapBox = await page.locator('.activity-map').boundingBox();
    await page.mouse.move(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height / 2);
    await page.waitForTimeout(300);
    const hoverDot = await page.locator('.activity-map path[fill="#2563eb"]').count();
    console.log(label, 'hover dot present:', hoverDot > 0);

    // jank test: pan/zoom
    await page.mouse.wheel(0, -200);
    await page.waitForTimeout(300);
    await page.mouse.move(mapBox.x + 100, mapBox.y + 100);
    await page.mouse.down();
    await page.mouse.move(mapBox.x + 200, mapBox.y + 200, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    console.log(label, 'pan/zoom done without crash');

    await context.close();
  }
  await browser.close();
})();
