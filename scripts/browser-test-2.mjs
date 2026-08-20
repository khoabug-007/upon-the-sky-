// Verifies the upper map sections: clouds, grab wall, space asteroids and the ending.
import puppeteer from 'puppeteer-core';
import fs from 'fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = 'scripts/shots';
fs.mkdirSync(OUT, { recursive: true });

const errors = [];
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--window-size=1440,860', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox']
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 860 });
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tp = (x, y, z) => page.evaluate(([x, y, z]) => {
  const g = window.__uts;
  g.controller.pos.set(x, y, z);
  g.controller.vel.set(0, 0, 0);
  g.cam.snap(g.controller.pos);
}, [x, y, z]);

await page.goto('http://localhost:3000', { waitUntil: 'networkidle2' });
await sleep(1500);
await page.evaluate(() => localStorage.removeItem('uts_progress'));
await page.click('#btn-create');
await sleep(400);
await page.click('#btn-do-create');
await sleep(2000);

// Sky section: rest cloud before the grab wall
await tp(0, 106.4, 221);
await sleep(1500);
await page.screenshot({ path: `${OUT}/9-sky-clouds.png` });

// Space section: asteroid leaps
await tp(0, 165, 310);
await sleep(1500);
await page.screenshot({ path: `${OUT}/10-space-asteroids.png` });

// Final platform, walk into the ending ring
await tp(0, 232, 390);
await sleep(800);
await page.keyboard.down('w');
await sleep(1400);
await page.keyboard.up('w');
await sleep(4000);
await page.screenshot({ path: `${OUT}/11-ending-early.png` });
await sleep(7000);
await page.screenshot({ path: `${OUT}/12-ending-full.png` });

const state = await page.evaluate(() => ({
  endingShown: !document.getElementById('hud-ending').classList.contains('hidden'),
  endingText: document.getElementById('hud-ending').innerText.slice(0, 200),
  altitude: document.getElementById('hud-altitude').textContent
}));
console.log('STATE:', JSON.stringify(state, null, 2));
console.log(errors.length ? `ERRORS (${errors.length}):\n` + errors.join('\n') : 'NO BROWSER ERRORS');
await browser.close();
process.exit(errors.length || !state.endingShown ? 1 : 0);
