import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs without types
import { firstDiff, simulate } from './lib/compare.mjs';
// @ts-expect-error plain .mjs without types
import { PANELS, panelSelector } from './lib/shot.mjs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');

describe('compare-main', () => {
  it('firstDiff reports identical and the first differing event', () => {
    const a = { x: [{ log: [{ t: 'a' }, { t: 'b' }] }] };
    expect(firstDiff(a, structuredClone(a))).toBeNull();
    const b = { x: [{ log: [{ t: 'a' }, { t: 'c' }] }] };
    expect(firstDiff(a, b)).toContain('x combat 0 event 1');
    expect(firstDiff(a, {})).toContain('only in branch');
  });

  it('simulate is deterministic and covers real combats without errors', async () => {
    const r1 = await simulate(root);
    const r2 = await simulate(root);
    expect(firstDiff(r1, r2)).toBeNull();
    const all = Object.values(r1).flat() as { error?: string; log?: unknown[] }[];
    expect(all.length).toBeGreaterThan(0);
    expect(all.filter((c) => c.error)).toEqual([]);
    expect(all[0]?.log?.length).toBeGreaterThan(0);
  }, 60_000);
});

describe('shot', () => {
  it('every panel name maps to a Panel id that exists in the app', () => {
    const src = ['SetupPanel', 'DeckBuilder', 'StrategyPanel', 'ResultsPanel', 'CombatLog']
      .map((f) => readFileSync(resolve(root, 'app/components', `${f}.tsx`), 'utf8'))
      .join('\n');
    for (const name of Object.keys(PANELS)) {
      expect(src, name).toContain(`<Panel id="${PANELS[name]}"`);
      expect(panelSelector(name)).toContain(`${PANELS[name]}-h`);
    }
  });
});

describe('GitHub Pages base path', () => {
  it("uses a relative base so the repo name's case cannot break asset URLs", () => {
    expect(readFileSync(resolve(root, 'vite.config.ts'), 'utf8')).toMatch(/base:\s*'\.\/'/);
  });
});
