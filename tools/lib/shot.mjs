// Core of `npm run shot`: build the app, serve it and screenshot one panel.
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { build, preview } from 'vite';

/** Panel name -> Panel `id` in app/components. */
export const PANELS = { setup: 'setup', deck: 'deck', strategies: 'strat', results: 'res', log: 'log' };

export const panelSelector = (name) => `section[aria-labelledby="${PANELS[name]}-h"]`;

/** Setup link used for the log panel (the log is a separate view opened by a combat link). */
export const LOG_QUERY = 'v=1&c=I&e=Nb&a=0&d=St5De4Ba1&s=123&st=b4pa';

/** Two-character code of an enemy id (data/enemies/<id>.json), or throw. */
export function enemyCode(repo, id) {
  const dir = join(repo, 'data', 'enemies');
  const file = readdirSync(dir).find((f) => f === `${id}.json`);
  if (!file) throw new Error(`Unknown enemy "${id}"`);
  return JSON.parse(readFileSync(join(dir, file), 'utf8')).code;
}

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
export async function shotPanel(repo, panel, { width = 800, enemy, click } = {}) {
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
    const code = enemy ? enemyCode(repo, enemy) : 'Nb';
    const base = LOG_QUERY.replace('e=Nb', `e=${code}`);
    // Log is its own view (opened by a combat link); the other panels use the setup link.
    const query = panel === 'log' ? base : base.replace(/&s=.*$/, '');
    await page.goto(`${url}?${query}`, { waitUntil: 'networkidle0' });
    const sel = panelSelector(panel);
    await page.waitForSelector(sel);
    const toggle = await page.$(`${sel} button[aria-expanded="false"]`);
    if (toggle) await toggle.click();
    let el = await page.$(sel);
    if (click) {
      // Click a button/link by its visible text (e.g. "Send feedback" to open a modal).
      const [target] = await page.$$(`xpath/.//*[self::button or self::a][contains(normalize-space(.), "${click}")]`);
      if (!target) throw new Error(`No button or link with text "${click}"`);
      await target.click();
      await new Promise((r) => setTimeout(r, 300));
      el = (await page.$('dialog[open]')) ?? el;
    }
    const path = join(outDir, `shot-${panel}.png`);
    await el.screenshot({ path });
    return path;
  } finally {
    await browser.close();
    await new Promise((r) => server.httpServer.close(r));
  }
}
