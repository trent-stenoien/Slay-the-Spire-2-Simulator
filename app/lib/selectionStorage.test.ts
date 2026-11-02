import { describe, expect, it } from 'vitest';
import { MAX_STRATEGIES_PER_RUN, type SavedStrategy } from '../../engine/types';
import { COLORS } from './colors';
import { SELECTION_STORAGE_KEY, defaultSelection, loadSelection, saveSelection } from './selectionStorage';
import { fullLibrary, type StorageLike } from './strategyLibrary';
import { blockFirstConfig } from '../../engine/strategies';

function memStorage(initial?: string): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(SELECTION_STORAGE_KEY, initial);
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

const throwing: StorageLike = {
  getItem: () => {
    throw new Error('denied');
  },
  setItem: () => {
    throw new Error('quota');
  },
};

const custom = (id: string, allow: number): SavedStrategy => ({
  id,
  name: id,
  config: blockFirstConfig(allow),
});
const lib = fullLibrary([custom('u1', 3), custom('u2', 5), custom('u3', 7)]);

describe('selection storage', () => {
  it('round-trips ids and colors', () => {
    const s = memStorage();
    const sel = [
      { strategyId: 'u1', color: 'red' as const },
      { strategyId: 'default-greedy', color: 'purple' as const },
    ];
    expect(saveSelection(s, sel)).toBe(true);
    expect(loadSelection(s, lib)).toEqual(sel);
  });

  it('falls back to the default selection when nothing is stored', () => {
    expect(loadSelection(memStorage(), lib)).toEqual(defaultSelection());
    expect(loadSelection(null, lib)).toEqual(defaultSelection());
    expect(defaultSelection().map((s) => s.strategyId)).toEqual(['default-greedy', 'default-scared']);
  });

  it('drops ids no longer in the library, and repeated ids', () => {
    const s = memStorage(
      JSON.stringify([
        { strategyId: 'gone', color: 'blue' },
        { strategyId: 'u2', color: 'green' },
        { strategyId: 'u2', color: 'red' },
      ]),
    );
    expect(loadSelection(s, lib)).toEqual([{ strategyId: 'u2', color: 'green' }]);
  });

  it('falls back to defaults when every stored id was deleted', () => {
    const s = memStorage(JSON.stringify([{ strategyId: 'gone', color: 'blue' }]));
    expect(loadSelection(s, lib)).toEqual(defaultSelection());
  });

  it('replaces duplicate and invalid colors with free ones', () => {
    const s = memStorage(
      JSON.stringify([
        { strategyId: 'u1', color: 'blue' },
        { strategyId: 'u2', color: 'blue' },
        { strategyId: 'u3', color: 'magenta' },
        { strategyId: 'default-greedy' },
      ]),
    );
    const sel = loadSelection(s, lib);
    expect(sel.map((x) => x.strategyId)).toEqual(['u1', 'u2', 'u3', 'default-greedy']);
    expect(sel[0]?.color).toBe('blue');
    expect(new Set(sel.map((x) => x.color)).size).toBe(4);
    for (const x of sel) expect(COLORS).toContain(x.color);
  });

  it(`caps the selection at ${MAX_STRATEGIES_PER_RUN}`, () => {
    const big = fullLibrary([1, 2, 3, 4, 5, 6, 7, 8].map((i) => custom(`c${i}`, i)));
    const s = memStorage(JSON.stringify(big.map((x) => ({ strategyId: x.id, color: 'blue' }))));
    expect(big).toHaveLength(10);
    const sel = loadSelection(s, big);
    expect(sel).toHaveLength(MAX_STRATEGIES_PER_RUN);
    expect(sel.map((x) => x.strategyId)).toEqual(big.slice(0, MAX_STRATEGIES_PER_RUN).map((x) => x.id));
    expect(new Set(sel.map((x) => x.color)).size).toBe(MAX_STRATEGIES_PER_RUN);
  });

  it('survives throwing storage', () => {
    expect(loadSelection(throwing, lib)).toEqual(defaultSelection());
    expect(saveSelection(throwing, defaultSelection())).toBe(false);
    expect(saveSelection(null, defaultSelection())).toBe(false);
  });

  it('falls back to defaults on garbage JSON or the wrong shape', () => {
    for (const raw of ['{not json', '42', '{"a":1}', '[null, 3, "x"]']) {
      expect(loadSelection(memStorage(raw), lib)).toEqual(defaultSelection());
    }
  });
});
