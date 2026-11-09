// Core of `npm run shot`: build the app, serve it and screenshot one panel.
import { existsSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { build, preview } from 'vite';

/** Panel name -> Panel `id` in app/components. */
export const PANELS = { setup: 'setup', deck: 'deck', strategies: 'strat', results: 'res', log: 'log' };

export const panelSelector = (name) => `section[aria-labelledby="${PANELS[name]}-h"]`;

export function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  const found = candidates.find((p) => p && existsSync(p));
  if (!found) throw new Error('No Chrome found: set CHROME_PATH');
  return found;
}

/** Screenshot `panel` to `<repo>/.check-output/shot-<panel>.png` and return the path. */
export async function shotPanel(repo, panel, { width = 800 } = {}) {
  if (!(panel in PANELS)) throw new Error(`Unknown panel "${panel}". Choose one of: ${Object.keys(PANELS).join(', ')}`);
  const outDir = join(repo, '.check-output');
  mkdirSync(outDir, { recursive: true });
  const dist = join(outDir, 'dist');
  await build({ root: repo, logLevel: 'silent', build: { outDir: dist, emptyOutDir: true } });
  const server = await preview({ root: repo, logLevel: 'silent', build: { outDir: dist }, preview: { port: 0 } });
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    args: ['--no-sandbox', '--disable-gpu'],
    headless: true,
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
    const url = server.resolvedUrls?.local?.[0];
    if (!url) throw new Error('preview server has no URL');
    await page.goto(url, { waitUntil: 'networkidle0' });
    const sel = panelSelector(panel);
    await page.waitForSelector(sel);
    const toggle = await page.$(`${sel} button[aria-expanded="false"]`);
    if (toggle) await toggle.click();
    const el = await page.$(sel);
    const path = join(outDir, `shot-${panel}.png`);
    await el.screenshot({ path });
    return path;
  } finally {
    await browser.close();
    await new Promise((r) => server.httpServer.close(r));
  }
}
