import { describe, expect, it } from 'vitest';
import { gameData } from '../data/index';
import { runCombat } from './combat';
import { runCombatRange, runSimulationSync, summarize } from './montecarlo';
import { deriveSeed } from './rng';
import { COMBATS_PER_RUN } from './types';
import type { CombatResult, RunConfig, StrategyConfig } from './types';
import { GREEDY_CONFIG, blockFirstConfig } from './strategies';

const ironclad = gameData.characters['ironclad']!;

function runConfig(strategies: StrategyConfig[], runSeed = 12345): RunConfig {
  const colors = ['blue', 'green', 'yellow', 'red', 'purple'] as const;
  return {
    characterId: 'ironclad',
    deck: ironclad.startingDeck,
    enemyId: 'nibbit',
    ascension: 0,
    runSeed,
    strategies: strategies.map((config, i) => ({
      strategy: { id: `s${i}`, name: `Strategy ${i}`, config },
      color: colors[i]!,
    })),
  };
}

const FIVE: StrategyConfig[] = [
  GREEDY_CONFIG,
  blockFirstConfig(0),
  blockFirstConfig(3),
  blockFirstConfig(6),
  blockFirstConfig(10),
];

function result(outcome: CombatResult['outcome'], turns: number, hpLost: number): CombatResult {
  return { seed: 0, outcome, turns, hpLost, enemyHpRemaining: outcome === 'win' ? 0 : 5 };
}

describe('runCombatRange', () => {
  it('uses deriveSeed(runSeed, i) for combat i, no logs', () => {
    const config = runConfig(FIVE);
    const results = runCombatRange(gameData, config, 0, 3, 7);
    expect(results.map((r) => r.seed)).toEqual([3, 4, 5, 6].map((i) => deriveSeed(config.runSeed, i)));
    expect(results.every((r) => r.log === undefined)).toBe(true);
  });

  it('gives every strategy identical combats (same seed -> same enemy HP)', () => {
    const config = runConfig(FIVE);
    for (let i = 0; i < 20; i++) {
      const hps = config.strategies.map((rs) => {
        const r = runCombat(
          gameData,
          {
            characterId: config.characterId,
            deck: config.deck,
            enemyId: config.enemyId,
            ascension: config.ascension,
            strategy: rs.strategy.config,
            seed: deriveSeed(config.runSeed, i),
          },
          { log: true },
        );
        const start = r.log?.find((e) => e.t === 'combatStart');
        return start && start.t === 'combatStart' ? start.enemyHp : -1;
      });
      expect(hps[0]).toBeGreaterThan(0);
      expect(new Set(hps).size).toBe(1);
    }
    const seedsPerStrategy = config.strategies.map((_, s) =>
      runCombatRange(gameData, config, s, 0, 20).map((r) => r.seed),
    );
    for (const seeds of seedsPerStrategy) expect(seeds).toEqual(seedsPerStrategy[0]);
  });

  it('matches the same combat run directly', () => {
    const config = runConfig(FIVE);
    const [r] = runCombatRange(gameData, config, 2, 9, 10);
    const direct = runCombat(gameData, {
      characterId: 'ironclad',
      deck: config.deck,
      enemyId: 'nibbit',
      ascension: 0,
      strategy: FIVE[2]!,
      seed: deriveSeed(config.runSeed, 9),
    });
    expect(r).toEqual(direct);
  });

  it('rejects an out-of-range strategy index', () => {
    expect(() => runCombatRange(gameData, runConfig(FIVE), 9, 0, 1)).toThrow(RangeError);
  });
});

describe('summarize', () => {
  it('keeps the lowest combat index for each HP lost value', () => {
    const s = summarize('x', [
      result('win', 3, 4),
      result('win', 3, 0),
      result('win', 3, 4),
      result('loss', 9, 80),
      result('win', 3, 0),
    ]);
    expect(s.firstCombatByHpLost).toEqual({ 4: 0, 0: 1, 80: 3 });
    // Keys are exactly the HP values that occurred.
    const seen = s.hpLostCounts.flatMap((c, hp) => (c > 0 ? [hp] : []));
    expect(
      Object.keys(s.firstCombatByHpLost)
        .map(Number)
        .sort((a, b) => a - b),
    ).toEqual(seen);
  });

  it('averages gold over all combats and counts the share of combats with a potion (#104)', () => {
    const s = summarize('x', [
      { ...result('win', 3, 0), rewards: { gold: 20, potions: 1, cardRewards: 0 } },
      { ...result('win', 3, 0), rewards: { gold: 0, potions: 2, cardRewards: 0 } },
      result('win', 3, 0),
      result('loss', 3, 9),
    ]);
    expect(s.avgGold).toBe(5);
    expect(s.potionRate).toBe(0.5);
    const none = summarize('y', [result('win', 3, 0)]);
    expect([none.avgGold, none.potionRate]).toEqual([0, 0]);
  });

  it('computes averages, rates (as fractions) and the histogram', () => {
    const s = summarize('x', [
      result('win', 3, 0),
      result('win', 5, 4),
      result('loss', 7, 80),
      result('turnCap', 100, 10),
    ]);
    expect(s.strategyId).toBe('x');
    expect(s.combats).toBe(4);
    expect(s.avgHpLost).toBeCloseTo((0 + 4 + 80 + 10) / 4);
    expect(s.avgTurnsToKill).toBe(4);
    // Every combat counts; the turn-cap fight at its full 100 turns.
    expect(s.avgTurns).toBe((3 + 5 + 7 + 100) / 4);
    expect(s.deathRate).toBe(0.25);
    expect(s.turnCapRate).toBe(0.25);
    expect(s.hpLostCounts).toHaveLength(81);
    expect(s.hpLostCounts[0]).toBe(1);
    expect(s.hpLostCounts[4]).toBe(1);
    expect(s.hpLostCounts[10]).toBe(1);
    expect(s.hpLostCounts[80]).toBe(1);
    expect(s.hpLostCounts.reduce((a, b) => a + b, 0)).toBe(4);
  });

  it('gives null avgTurnsToKill with no wins', () => {
    const s = summarize('x', [result('loss', 4, 80), result('turnCap', 100, 2)]);
    expect(s.avgTurnsToKill).toBeNull();
    expect(s.deathRate).toBe(0.5);
  });

  it('averages combat length over deaths when there are no wins', () => {
    const s = summarize('x', [result('loss', 4, 80), result('loss', 6, 80)]);
    expect(s.avgTurnsToKill).toBeNull();
    expect(s.avgTurns).toBe(5);
  });

  it('keeps hpLostCounts at least length 1 and handles empty input', () => {
    expect(summarize('x', [result('win', 2, 0), result('win', 4, 0)]).hpLostCounts).toEqual([2]);
    const empty = summarize('x', []);
    expect(empty).toEqual({
      strategyId: 'x',
      combats: 0,
      avgHpLost: 0,
      avgTurnsToKill: null,
      avgTurns: 0,
      avgGold: 0,
      potionRate: 0,
      deathRate: 0,
      turnCapRate: 0,
      hpLostCounts: [0],
      firstCombatByHpLost: {},
    });
  });
});

describe('runSimulationSync', () => {
  it('returns sensible numbers for Ironclad starter deck vs Nibbit', () => {
    const config = runConfig(FIVE);
    const run = runSimulationSync(gameData, config, 200);
    expect(run.gameVersion).toBe(gameData.manifest.gameVersion);
    expect(run.config).toBe(config);
    expect(run.summaries.map((s) => s.strategyId)).toEqual(['s0', 's1', 's2', 's3', 's4']);
    for (const s of run.summaries) {
      expect(s.combats).toBe(200);
      expect(s.hpLostCounts.reduce((a, b) => a + b, 0)).toBe(200);
      expect(s.avgHpLost).toBeGreaterThanOrEqual(0);
      expect(s.avgHpLost).toBeLessThanOrEqual(ironclad.maxHp);
      expect(s.deathRate).toBeGreaterThanOrEqual(0);
      expect(s.deathRate + s.turnCapRate).toBeLessThanOrEqual(1);
      expect(s.avgTurnsToKill).not.toBeNull();
      expect(s.avgTurnsToKill!).toBeGreaterThanOrEqual(1);
      expect(s.avgTurnsToKill!).toBeLessThan(20);
    }
  });

  it('is deterministic for a fixed runSeed and varies with the seed', () => {
    const a = runSimulationSync(gameData, runConfig(FIVE, 7), 100);
    const b = runSimulationSync(gameData, runConfig(FIVE, 7), 100);
    const c = runSimulationSync(gameData, runConfig(FIVE, 8), 100);
    expect(a).toEqual(b);
    expect(c.summaries).not.toEqual(a.summaries);
  });

  it('defaults to COMBATS_PER_RUN combats', () => {
    const run = runSimulationSync(gameData, runConfig([GREEDY_CONFIG]));
    expect(run.summaries[0]!.combats).toBe(COMBATS_PER_RUN);
  });
});
