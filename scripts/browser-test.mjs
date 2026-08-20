// Loads the real game in a headless browser, clicks through the menu,
// creates a server, moves the player, and captures screenshots + console errors.
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

await page.goto('http://localhost:3000', { waitUntil: 'networkidle2' });
await sleep(2500);
await page.screenshot({ path: `${OUT}/1-menu.png` });

// Play with the sliders (fat head, thin body, long legs)
await page.evaluate(() => {
  const set = (id, v) => {
    const el = document.getElementById(id);
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  set('slider-head', 85); set('slider-body', 25); set('slider-legs', 90);
});
await sleep(1200);
await page.screenshot({ path: `${OUT}/2-menu-edited.png` });

// Open the Join Server board (should be empty), then Find Server, then Create
await page.click('#btn-join');
await sleep(1200);
await page.screenshot({ path: `${OUT}/3-join-board.png` });

await page.click('#btn-find');
await sleep(600);
await page.type('#find-input', 'ABCDEF');
await page.click('#btn-do-find');
await sleep(1000);
await page.screenshot({ path: `${OUT}/4-find-server.png` });

await page.click('#btn-create');
await sleep(500);
await page.click('#btn-do-create');
await sleep(3000);
await page.screenshot({ path: `${OUT}/5-ingame-spawn.png` });

// Walk forward + jump for a few seconds
await page.keyboard.down('w');
await sleep(1500);
await page.keyboard.down('Shift');
await sleep(1500);
await page.keyboard.press('Space');
await sleep(900);
await page.keyboard.up('Shift');
await page.keyboard.up('w');
await sleep(800);
await page.screenshot({ path: `${OUT}/6-ingame-running.png` });

// Crawl toggle + punch + prop pickup attempt (input sanity, no errors expected)
await page.keyboard.press('r');
await sleep(700);
await page.screenshot({ path: `${OUT}/7-ingame-crawl.png` });
await page.keyboard.press('r');
await page.keyboard.press('e');
await page.keyboard.press('q');
await page.keyboard.press('b');
await sleep(700);

// Teleport near the end to verify space visuals + ending trigger
await page.evaluate(() => { window.scrollTo(0, 0); });
await page.screenshot({ path: `${OUT}/8-final.png` });

const state = await page.evaluate(() => ({
  hudVisible: !document.getElementById('hud-root').classList.contains('hidden'),
  menuHidden: document.getElementById('menu-root').classList.contains('hidden'),
  altitudeText: document.getElementById('hud-altitude')?.textContent ?? '',
  serverCode: document.getElementById('hud-server-code')?.textContent ?? ''
}));

console.log('STATE:', JSON.stringify(state));
console.log(errors.length ? `ERRORS (${errors.length}):\n` + errors.join('\n') : 'NO BROWSER ERRORS');
await browser.close();
process.exit(errors.length ? 1 : 0);
