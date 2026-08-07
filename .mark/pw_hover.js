const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto('http://localhost:3000/activities/405', { waitUntil: 'networkidle' });
  await page.waitForSelector('.activity-map');
  await page.waitForTimeout(1000);
  // get a point on one of the polyline paths
  const point = await page.evaluate(() => {
    const path = document.querySelector('.activity-map path.leaflet-interactive');
    const box = path.getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  });
  console.log('point', point);
  await page.mouse.move(point.x, point.y);
  await page.waitForTimeout(300);
  const markers = await page.locator('.activity-map .leaflet-interactive').count();
  const circleFill = await page.evaluate(() => {
    const circles = document.querySelectorAll('.activity-map path[fill-opacity="1"]');
    return circles.length;
  });
  console.log('circle markers with fill-opacity 1:', circleFill);
  await page.screenshot({ path: '/opt/gpx-report/.mark/pw_hover.png' });
  await browser.close();
})();
