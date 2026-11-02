import { describe, expect, it } from 'vitest';
import { gameData } from '../../data/index';
import { runCombatRange, runSimulationSync } from '../../engine/montecarlo';
import type { RunConfig } from '../../engine/types';
import { CHUNK_SIZE, mergeChunkResults, planChunks, workerCount } from './plan';
import type { ChunkResult } from './plan';
import { GREEDY_CONFIG, blockFirstConfig } from '../../engine/strategies';

const config: RunConfig = {
  characterId: 'ironclad',
  deck: gameData.characters['ironclad']!.startingDeck,
  enemyId: 'nibbit',
  ascension: 0,
  runSeed: 99,
  strategies: [
    { strategy: { id: 'g', name: 'Greedy', config: GREEDY_CONFIG }, color: 'blue' },
    { strategy: { id: 'b4', name: 'Block 4', config: blockFirstConfig(4) }, color: 'red' },
  ],
};

describe('planChunks', () => {
  it('covers every combat of every strategy exactly once', () => {
    const chunks = planChunks(3, 1000);
    expect(chunks).toHaveLength(30);
    expect(chunks.map((c) => c.id)).toEqual(chunks.map((_, i) => i));
    for (let s = 0; s < 3; s++) {
      const mine = chunks.filter((c) => c.strategyIndex === s);
      expect(mine[0]!.from).toBe(0);
      expect(mine[mine.length - 1]!.to).toBe(1000);
      for (let i = 1; i < mine.length; i++) expect(mine[i]!.from).toBe(mine[i - 1]!.to);
      expect(mine.every((c) => c.to - c.from <= CHUNK_SIZE)).toBe(true);
    }
  });
  it('handles a ragged last chunk', () => {
    expect(planChunks(1, 250, 100).map((c) => [c.from, c.to])).toEqual([
      [0, 100],
      [100, 200],
      [200, 250],
    ]);
  });
});

describe('workerCount', () => {
  it('caps at 8, floors at 1, and never exceeds the chunk count', () => {
    expect(workerCount(16, 50)).toBe(8);
    expect(workerCount(4, 50)).toBe(4);
    expect(workerCount(undefined, 50)).toBe(1);
    expect(workerCount(0, 50)).toBe(1);
    expect(workerCount(8, 3)).toBe(3);
  });
});

describe('mergeChunkResults', () => {
  it('equals runSimulationSync regardless of arrival order', () => {
    const combats = 250;
    const chunks = planChunks(config.strategies.length, combats, 60);
    const results: ChunkResult[] = chunks.map((chunk) => ({
      chunk,
      results: runCombatRange(gameData, config, chunk.strategyIndex, chunk.from, chunk.to),
    }));
    // Deterministic shuffle of arrival order.
    const shuffled = results
      .map((r, i) => ({ r, k: (i * 7919) % 13 }))
      .sort((a, b) => a.k - b.k)
      .map((x) => x.r);
    const merged = mergeChunkResults(gameData.manifest.gameVersion, config, shuffled);
    expect(merged).toEqual(runSimulationSync(gameData, config, combats));
  });
  it('keeps the minimum combat index per HP lost across chunks', () => {
    const combats = 90;
    const chunks = planChunks(config.strategies.length, combats, 7);
    const results: ChunkResult[] = chunks.map((chunk) => ({
      chunk,
      results: runCombatRange(gameData, config, chunk.strategyIndex, chunk.from, chunk.to),
    }));
    const reversed = [...results].reverse();
    const merged = mergeChunkResults(gameData.manifest.gameVersion, config, reversed);
    merged.summaries.forEach((summary, s) => {
      const all = runCombatRange(gameData, config, s, 0, combats);
      const expected: Record<number, number> = {};
      all.forEach((r, i) => {
        if (expected[r.hpLost] === undefined) expected[r.hpLost] = i;
      });
      expect(summary.firstCombatByHpLost).toEqual(expected);
      for (const [hp, idx] of Object.entries(summary.firstCombatByHpLost)) expect(all[idx]!.hpLost).toBe(Number(hp));
    });
  });
  it('rejects a chunk with the wrong number of results', () => {
    const [chunk] = planChunks(1, 10);
    expect(() => mergeChunkResults('v', config, [{ chunk: chunk!, results: [] }])).toThrow();
  });
});
