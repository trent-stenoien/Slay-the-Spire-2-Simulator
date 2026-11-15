// Usage: npm run shot -- <panel> [--enemy <enemyId>] [--click <button text>]
//   panel: setup | deck | strategies | results | log. --enemy picks the fight (e.g. aeonglass, a boss);
//   --click presses a button/link by text first and shoots the open <dialog> if one appears.
// Builds the app, serves it, and screenshots one panel (800px wide, deviceScaleFactor 1)
// to .check-output/shot-<panel>.png. Prints the path. Needs Chrome (set CHROME_PATH if not found).
import { resolve } from 'node:path';
import { PANELS, shotPanel } from './lib/shot.mjs';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const enemy = flag('enemy');
const click = flag('click');
const panel = args[0];
if (!panel || !(panel in PANELS)) {
  console.error(`Usage: npm run shot -- <panel>   (${Object.keys(PANELS).join(' | ')})`);
  process.exit(2);
}
const path = await shotPanel(resolve(import.meta.dirname, '..'), panel, { enemy, click });
console.log(`shot: ${path}`);
process.exit(0);
