// Usage: npm run shot -- <panel>      (panel: setup | deck | strategies | results | log)
// Builds the app, serves it, and screenshots one panel (800px wide, deviceScaleFactor 1)
// to .check-output/shot-<panel>.png. Prints the path. Needs Chrome (set CHROME_PATH if not found).
import { resolve } from 'node:path';
import { PANELS, shotPanel } from './lib/shot.mjs';

const panel = process.argv[2];
if (!panel || !(panel in PANELS)) {
  console.error(`Usage: npm run shot -- <panel>   (${Object.keys(PANELS).join(' | ')})`);
  process.exit(2);
}
const path = await shotPanel(resolve(import.meta.dirname, '..'), panel);
console.log(`shot: ${path}`);
process.exit(0);
