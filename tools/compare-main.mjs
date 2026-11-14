// Usage: npm run compare-main
// Runs fixed-seed combats (every enemy x greedy/block strategy x A0/A10, Ironclad starter deck)
// on this working tree and on origin/main, prints `identical` or the first difference.
// Full reports go to .check-output/compare-main.{branch,main}.json.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { firstDiff, simulate } from './lib/compare.mjs';

const repo = resolve(import.meta.dirname, '..');
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const outDir = join(repo, '.check-output');
mkdirSync(outDir, { recursive: true });

let ref = 'origin/main';
try {
  git('fetch', '--quiet', 'origin', 'main');
} catch {
  /* offline: use whatever origin/main or main we have */
}
try {
  git('rev-parse', '--verify', '--quiet', ref);
} catch {
  ref = 'main';
}

const tmp = mkdtempSync(join(tmpdir(), 'sts2-main-'));
const wt = join(tmp, 'main');
let verdict;
try {
  git('worktree', 'add', '--detach', '--quiet', wt, ref);
  symlinkSync(join(repo, 'node_modules'), join(wt, 'node_modules'), 'dir');
  const main = await simulate(wt);
  const branch = await simulate(repo);
  writeFileSync(join(outDir, 'compare-main.main.json'), JSON.stringify(main));
  writeFileSync(join(outDir, 'compare-main.branch.json'), JSON.stringify(branch));
  const diff = firstDiff(branch, main);
  verdict = diff === null ? 'compare-main: identical' : `compare-main: DIFFERENT, first difference: ${diff}`;
  console.log(verdict);
  console.log(`full output: ${outDir}/compare-main.{branch,main}.json`);
} finally {
  try {
    git('worktree', 'remove', '--force', wt);
  } catch {
    if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
  }
}
process.exit(verdict === 'compare-main: identical' ? 0 : 1);
