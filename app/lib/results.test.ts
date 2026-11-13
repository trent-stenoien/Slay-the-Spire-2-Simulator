import { describe, expect, it } from 'vitest';
import type { RunResult, StrategySummary } from '../../engine/types';
import { gameData } from '../../data';
import {
  describeRun,
  fmtHpLostRange,
  resolveRunSeed,
  relicNote,
  fmtNumber,
  fmtRate,
  fmtRewards,
  hasRewards,
  parseSeedInput,
  randomSeed,
  resultRows,
  sortResultRows,
  type ResultRow,
} from './results';
import { GREEDY_CONFIG, blockFirstConfig } from '../../engine/strategies';

function fakeSummary(strategyId: string, over: Partial<StrategySummary> = {}): StrategySummary {
  return {
    strategyId,
    combats: 4,
    avgHpLost: 10.25,
    avgTurnsToKill: 5.5,
    avgTurns: 6,
    avgGold: 0,
    potionRate: 0,
    deathRate: 0.25,
    turnCapRate: 0,
    hpLostCounts: [0, 0, 1, 0, 2, 1],
    firstCombatByHpLost: { 2: 0, 4: 1, 5: 3 },
    ...over,
  };
}

const result: RunResult = {
  gameVersion: 'v0.107.1',
  config: {
    characterId: 'ironclad',
    deck: [],
    enemyId: 'nibbit',
    ascension: 0,
    runSeed: 7,
    strategies: [
      { strategy: { id: 'a', name: 'Greedy', config: GREEDY_CONFIG }, color: 'blue' },
      { strategy: { id: 'b', name: 'Scared', config: blockFirstConfig(0) }, color: 'red' },
      { strategy: { id: 'c', name: 'Missing', config: blockFirstConfig(3) }, color: 'purple' },
    ],
  },
  summaries: [fakeSummary('b', { avgTurnsToKill: null }), fakeSummary('a')],
};

describe('results helpers', () => {
  it('joins summaries to run strategies in run order', () => {
    const rows = resultRows(result);
    expect(rows.map((r) => [r.name, r.color, r.strategyIndex])).toEqual([
      ['Greedy', 'blue', 0],
      ['Scared', 'red', 1],
    ]);
    expect(rows[1]!.summary.avgTurnsToKill).toBeNull();
  });

  it('formats numbers and rates', () => {
    expect(fmtNumber(10.25)).toBe('10.25');
    expect(fmtNumber(6)).toBe('6.00');
    expect(fmtNumber(9.5)).toBe('9.50');
    expect(fmtNumber(null)).toBe('—');
    expect(fmtRate(0.25)).toBe('25.0%');
    expect(fmtRate(0)).toBe('0.0%');
    expect(fmtRate(1)).toBe('100.0%');
  });

  it('random seeds are 32-bit', () => {
    expect(randomSeed(() => 0)).toBe(0);
    expect(randomSeed(() => 0.9999999999)).toBe(4294967295);
  });

  it('parses the seed input', () => {
    expect(parseSeedInput('')).toBeNull();
    expect(parseSeedInput(' 42 ')).toBe(42);
    expect(parseSeedInput('4294967296')).toBeUndefined();
    expect(parseSeedInput('-3')).toBeUndefined();
  });

  it('sorts rows by avg HP lost, then death rate, then avg combat turns, then selection order; keeps colors', () => {
    const row = (
      id: string,
      strategyIndex: number,
      avgHpLost: number,
      deathRate: number,
      avgTurns: number,
    ): ResultRow => ({
      strategyId: id,
      name: id,
      color: (['blue', 'red', 'purple', 'green', 'yellow'] as const)[strategyIndex]!,
      strategyIndex,
      summary: fakeSummary(id, { avgHpLost, deathRate, avgTurns }),
    });
    const rows = [
      row('a', 0, 5, 0, 4),
      row('b', 1, 2, 0.5, 3),
      row('c', 2, 2, 0.1, 9),
      row('d', 3, 5, 0, 4),
      row('e', 4, 2, 0.1, 7),
    ];
    const sorted = sortResultRows(rows);
    expect(sorted.map((r) => r.strategyId)).toEqual(['e', 'c', 'b', 'a', 'd']);
    expect(sorted.map((r) => r.color)).toEqual(['yellow', 'purple', 'red', 'blue', 'green']);
    expect(rows.map((r) => r.strategyId)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

describe('sorting uses the unrounded values', () => {
  it('two strategies that both show 5.00 are ordered by their real averages, then by the unrounded death rate', () => {
    const row = (id: string, i: number, avgHpLost: number, deathRate: number): ResultRow => ({
      strategyId: id,
      name: id,
      color: 'blue',
      strategyIndex: i,
      summary: fakeSummary(id, { avgHpLost, deathRate, avgTurns: 4 }),
    });
    const rows = [row('late', 0, 5.004, 0), row('early', 1, 5.001, 0)];
    expect(fmtNumber(5.004)).toBe(fmtNumber(5.001));
    expect(sortResultRows(rows).map((r) => r.strategyId)).toEqual(['early', 'late']);
    const rates = [row('b', 0, 5, 0.0004), row('a', 1, 5, 0.0001)];
    expect(sortResultRows(rates).map((r) => r.strategyId)).toEqual(['a', 'b']);
  });
});

describe('relicNote', () => {
  it('#205: no note for the Ironclad (Burning Blood is simulated); names unsimulated starting relics', () => {
    expect(relicNote(gameData, 'ironclad')).toBeNull();
    expect(relicNote(gameData, 'silent')).toBe(
      `${gameData.characters.silent!.startingRelic} (starting relic) is not simulated.`,
    );
    expect(relicNote(gameData, 'nobody')).toBe('The starting relic (starting relic) is not simulated.');
  });

  it('describes the run from its own config, not the live setup', () => {
    expect(describeRun(gameData, result.config)).toBe(
      'Ironclad vs Nibbit, Ascension 0. 10,000 simulated combats per strategy.',
    );
    expect(describeRun(gameData, { ...result.config, ascension: 7 })).toContain('Ascension 7.');
  });

  it('formats the P25-P75 range with an en dash, or one number when equal', () => {
    expect(fmtHpLostRange([0, 0, 2, 3, 5])).toBe('3\u20134');
    expect(fmtHpLostRange([0, 0, 0, 10])).toBe('3');
    expect(fmtHpLostRange([0, 0, 0, 10])).not.toContain('\u2013');
    expect(fmtHpLostRange([])).toBe('—');
    expect(fmtHpLostRange([0, 0, 0])).toBe('—');
  });

  it('resolves the run seed: the field value, a generated one when blank, undefined when invalid', () => {
    expect(resolveRunSeed('42')).toBe(42);
    expect(resolveRunSeed(' 0 ')).toBe(0);
    expect(resolveRunSeed('', () => 0.5)).toBe(0x80000000);
    expect(resolveRunSeed('', () => 0)).toBe(0);
    expect(resolveRunSeed('abc')).toBeUndefined();
    expect(resolveRunSeed('4294967296')).toBeUndefined();
  });
});

describe('#104 rewards formatting', () => {
  it('shows the Rewards column only when some strategy gained something', () => {
    expect(hasRewards([fakeSummary('a'), fakeSummary('b')])).toBe(false);
    expect(hasRewards([fakeSummary('a'), fakeSummary('b', { avgGold: 0.1 })])).toBe(true);
    expect(hasRewards([fakeSummary('a', { potionRate: 0.5 })])).toBe(true);
  });

  it('formats gold and potion share', () => {
    expect(fmtRewards(fakeSummary('a', { avgGold: 14.2, potionRate: 0.63 }))).toBe(
      '+14.2 gold avg · Random Potion 63%',
    );
    expect(fmtRewards(fakeSummary('a', { avgGold: 20 }))).toBe('+20.0 gold avg');
    expect(fmtRewards(fakeSummary('a', { potionRate: 1 }))).toBe('Random Potion 100%');
    expect(fmtRewards(fakeSummary('a', { potionRate: 0.001 }))).toBe('Random Potion <1%');
    expect(fmtRewards(fakeSummary('a'))).toBe('—');
  });
});
