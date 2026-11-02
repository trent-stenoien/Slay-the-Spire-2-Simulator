import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STRATEGIES,
  STORAGE_KEY,
  clearUserStrategies,
  addUserStrategy,
  deleteUserStrategy,
  fullLibrary,
  loadUserStrategies,
  parseAllowThrough,
  renameUserStrategy,
  saveUserStrategies,
  setUserConfig,
  type StorageLike,
  strategyProblem,
  MAX_LIBRARY_SIZE,
  defaultName,
  describeConfig,
} from './strategyLibrary';
import type { StrategyConfig } from '../../engine/types';
import { GREEDY_CONFIG, blockFirstConfig } from '../../engine/strategies';

function memStorage(initial?: string): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(STORAGE_KEY, initial);
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

let n = 0;
const newId = () => `u${++n}`;

describe('strategy library storage', () => {
  it('seeds the two defaults', () => {
    expect(fullLibrary([]).map((s) => [s.name, s.config])).toEqual([
      ['Greedy Damage', GREEDY_CONFIG],
      ['Scared Block', blockFirstConfig(0)],
    ]);
  });

  it('works with no storage or throwing storage', () => {
    expect(loadUserStrategies(null)).toEqual([]);
    expect(loadUserStrategies(throwing)).toEqual([]);
    expect(saveUserStrategies(null, [])).toBe(false);
    expect(saveUserStrategies(throwing, [])).toBe(false);
  });

  it('ignores corrupt or wrong-shaped data', () => {
    expect(loadUserStrategies(memStorage('{not json'))).toEqual([]);
    expect(loadUserStrategies(memStorage('{"a":1}'))).toEqual([]);
  });

  it('drops invalid entries, built-in ids and duplicates', () => {
    const raw = JSON.stringify([
      { id: 'a', name: 'A', config: blockFirstConfig(3) },
      { id: 'a', name: 'dup', config: blockFirstConfig(1) },
      { id: 'b', name: 'B', config: blockFirstConfig(-1) },
      { id: 'c', name: 'C', config: blockFirstConfig(1.5) },
      { id: 'c2', name: 'C2', config: blockFirstConfig(10000) },
      { id: 'd', name: 'D', config: { kind: 'magic' } },
      { id: 'e', name: 'E', config: { order: ['attack', 'attack', 'block'], allowThrough: 0 } },
      { id: 'f', name: 'F', config: { order: ['attack', 'block'], allowThrough: 0 } },
      { id: 'g', name: 'G', config: { order: ['attack', 'block', 'powers', 'block'], allowThrough: 0 } },
      { id: 'h', name: 'H', config: { order: ['attack', 'block', 'magic'], allowThrough: 0 } },
      { id: 'i', name: 'I', config: { order: ['attack', 'block', 'powers'] } },
      { id: DEFAULT_STRATEGIES[0]!.id, name: 'X', config: GREEDY_CONFIG },
      null,
    ]);
    expect(loadUserStrategies(memStorage(raw))).toEqual([{ id: 'a', name: 'A', config: blockFirstConfig(3) }]);
  });

  it('migrates pre-#130 configs: greedy → Attack, Powers, Block; block X → Block (allow X), Powers, Attack', () => {
    const raw = JSON.stringify([
      { id: 'u1', name: 'Block, allow 4', config: { kind: 'block', allowThrough: 4 } },
      { id: 'u2', name: 'Old greedy', config: { kind: 'greedyDamage' } },
      { id: 'u3', name: 'Bad', config: { kind: 'block', allowThrough: -2 } },
    ]);
    const s = memStorage(raw);
    const loaded = loadUserStrategies(s);
    expect(loaded).toEqual([
      { id: 'u1', name: 'Block, allow 4', config: { order: ['block', 'powers', 'attack'], allowThrough: 4 } },
      { id: 'u2', name: 'Old greedy', config: { order: ['attack', 'powers', 'block'], allowThrough: 0 } },
    ]);
    // Saving writes the new shape, which loads back unchanged.
    saveUserStrategies(s, loaded);
    expect(s.data.get(STORAGE_KEY)).not.toContain('kind');
    expect(loadUserStrategies(s)).toEqual(loaded);
  });

  it('stores X as 0 when Block is last (it is unused there)', () => {
    const raw = JSON.stringify([
      { id: 'u1', name: 'A', config: { order: ['powers', 'attack', 'block'], allowThrough: 7 } },
    ]);
    expect(loadUserStrategies(memStorage(raw))[0]!.config).toEqual({
      order: ['powers', 'attack', 'block'],
      allowThrough: 0,
    });
  });

  it('saves and loads round-trip, never persisting defaults', () => {
    const s = memStorage();
    const user = addUserStrategy([], 'Brave', { order: ['powers', 'block', 'attack'], allowThrough: 6 }, newId);
    expect(saveUserStrategies(s, [...DEFAULT_STRATEGIES, ...user])).toBe(true);
    expect(loadUserStrategies(s)).toEqual(user);
  });
});

const PBA5: StrategyConfig = { order: ['powers', 'block', 'attack'], allowThrough: 5 };

describe('strategy library edits', () => {
  it('adds with a trimmed name or a default name', () => {
    const a = addUserStrategy([], '  Mine ', blockFirstConfig(2), () => 'x');
    expect(a).toEqual([{ id: 'x', name: 'Mine', config: blockFirstConfig(2) }]);
    expect(addUserStrategy([], '  ', blockFirstConfig(7), () => 'y')[0]!.name).toBe('Block (allow 7), Powers');
  });

  it('default titles name the 1st and 2nd priorities', () => {
    expect(defaultName(PBA5)).toBe('Powers, Block (allow 5)');
    expect(defaultName(GREEDY_CONFIG)).toBe('Attack, Powers');
    expect(defaultName({ order: ['powers', 'attack', 'block'], allowThrough: 0 })).toBe('Powers, Attack');
    expect(defaultName(blockFirstConfig(0))).toBe('Block (allow 0), Powers');
    expect(describeConfig(PBA5)).toBe('Powers, Block (allow 5), Attack');
    expect(describeConfig(GREEDY_CONFIG)).toBe('Attack, Powers, Block');
  });

  it('renames, ignoring blank names', () => {
    const a = addUserStrategy([], 'A', blockFirstConfig(1), () => 'x');
    expect(renameUserStrategy(a, 'x', ' B ')[0]!.name).toBe('B');
    expect(renameUserStrategy(a, 'x', '   ')[0]!.name).toBe('A');
  });

  it('changes order and allowance, and deletes', () => {
    const a = addUserStrategy([], 'A', blockFirstConfig(1), () => 'x');
    expect(setUserConfig(a, 'x', blockFirstConfig(9))[0]!.config).toEqual(blockFirstConfig(9));
    expect(setUserConfig(a, 'x', PBA5)[0]!.config).toEqual(PBA5);
    // Invalid configs are ignored.
    expect(setUserConfig(a, 'x', { order: ['block', 'block', 'attack'], allowThrough: 1 })[0]!.config).toEqual(
      blockFirstConfig(1),
    );
    expect(deleteUserStrategy(a, 'x')).toEqual([]);
  });

  it.each([
    ['0', 0],
    ['12', 12],
    [' 4 ', 4],
    ['9999', 9999],
    ['10000', null],
    ['-1', null],
    ['1.5', null],
    ['', null],
    ['abc', null],
  ])('parseAllowThrough(%j) = %j', (t, v) => {
    expect(parseAllowThrough(t)).toBe(v);
  });
});

describe('strategyProblem (no duplicates: same order and X)', () => {
  const lib = fullLibrary([{ id: 'u1', name: 'Mine', config: PBA5 }]);

  it('rejects the same order and X, including the built-ins', () => {
    expect(strategyProblem(lib, PBA5)).toMatch(/"Mine" already plays Powers, Block \(allow 5\), Attack/);
    expect(strategyProblem(lib, blockFirstConfig(0))).toMatch(/"Scared Block" already plays/);
    expect(strategyProblem(lib, GREEDY_CONFIG)).toMatch(/"Greedy Damage" already plays/);
  });

  it('allows the same order with another X, or the same X in another order', () => {
    expect(strategyProblem(lib, { ...PBA5, allowThrough: 6 })).toBeNull();
    expect(strategyProblem(lib, { order: ['block', 'attack', 'powers'], allowThrough: 5 })).toBeNull();
  });

  it('ignores X when Block is last (Attack, Powers, Block with any X is Greedy Damage)', () => {
    expect(strategyProblem(lib, { order: ['attack', 'powers', 'block'], allowThrough: 9 })).toMatch(/Greedy Damage/);
  });

  it('lets a strategy keep its own config while editing', () => {
    expect(strategyProblem(lib, PBA5, 'u1')).toBeNull();
  });

  it('caps the library at 10 strategies, defaults included', () => {
    const extra = Array.from({ length: 8 }, (_, i) => ({
      id: `u${i + 3}`,
      name: `b${i + 3}`,
      config: blockFirstConfig(i + 3),
    }));
    const nine = fullLibrary(extra.slice(0, 7));
    expect(nine).toHaveLength(9);
    expect(strategyProblem(nine, blockFirstConfig(20))).toBeNull();
    const full = fullLibrary(extra);
    expect(full).toHaveLength(MAX_LIBRARY_SIZE);
    expect(MAX_LIBRARY_SIZE).toBe(10);
    expect(strategyProblem(full, blockFirstConfig(20))).toMatch(/at most 10/);
    expect(strategyProblem(full, blockFirstConfig(5), 'u5')).toBeNull();
  });
});

describe('clearUserStrategies', () => {
  const withRemove = (initial?: string) => {
    const m = memStorage(initial);
    return Object.assign(m, { removeItem: (k: string) => void m.data.delete(k) });
  };

  it('removes the storage key and leaves no user strategies', () => {
    const s = withRemove(JSON.stringify([{ id: 'u1', name: 'A', config: blockFirstConfig(3) }]));
    expect(clearUserStrategies(s)).toBe(true);
    expect(s.data.has(STORAGE_KEY)).toBe(false);
    expect(loadUserStrategies(s)).toEqual([]);
  });

  it('succeeds when nothing is stored', () => {
    expect(clearUserStrategies(withRemove())).toBe(true);
  });

  it('returns false for null storage or storage without removeItem', () => {
    expect(clearUserStrategies(null)).toBe(false);
    expect(clearUserStrategies(memStorage('[]'))).toBe(false);
  });

  it('tolerates storage that throws', () => {
    const bad: StorageLike = {
      ...throwing,
      removeItem: () => {
        throw new Error('denied');
      },
    };
    expect(clearUserStrategies(bad)).toBe(false);
    expect(fullLibrary([]).map((s) => s.name)).toEqual(['Greedy Damage', 'Scared Block']);
  });
});
