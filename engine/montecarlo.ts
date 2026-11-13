/**
 * Monte Carlo layer: runs many seeded combats per strategy and summarizes them.
 * The UI agent codes against these signatures.
 */
import { runCombat } from './combat';
import { deriveSeed } from './rng';
import { COMBATS_PER_RUN } from './types';
import type { CombatResult, GameData, RunConfig, RunResult, StrategySummary } from './types';

/**
 * Run combats [from, to) for one strategy of a run. Combat i uses
 * deriveSeed(config.runSeed, i), so every strategy faces identical combats.
 * Logs are not kept.
 */
export function runCombatRange(
  data: GameData,
  config: RunConfig,
  strategyIndex: number,
  from: number,
  to: number,
): CombatResult[] {
  const runStrategy = config.strategies[strategyIndex];
  if (!runStrategy) throw new RangeError(`runCombatRange: no strategy at index ${strategyIndex}`);
  const strategy = runStrategy.strategy.config;
  const results: CombatResult[] = [];
  for (let i = from; i < to; i++) {
    results.push(
      runCombat(data, {
        characterId: config.characterId,
        deck: config.deck,
        enemyId: config.enemyId,
        ...(config.enemyIds && config.enemyIds.length > 0 ? { enemyIds: config.enemyIds } : {}),
        ascension: config.ascension,
        strategy,
        ...(config.potions ? { potions: config.potions } : {}),
        seed: deriveSeed(config.runSeed, i),
        ...(config.startHp !== undefined ? { startHp: config.startHp } : {}),
        ...(config.relics && config.relics.length > 0 ? { relics: config.relics } : {}),
      }),
    );
  }
  return results;
}

/**
 * Summary stats for one strategy from its combat results.
 *
 * - avgHpLost: mean over ALL combats (wins, losses and turn-cap draws).
 * - avgTurnsToKill: mean turns over wins only; null if there were no wins.
 * - avgTurns: mean turns over ALL combats (wins, losses, and turn-cap fights at
 *   their full length); 0 for an empty list.
 * - avgGold: mean gold gained per combat; potionRate: fraction of combats that gained a potion (#104).
 * - deathRate, turnCapRate: FRACTIONS in [0, 1] (not percentages).
 * - hpLostCounts[n]: combats that lost exactly n + minHpLost HP; length = max − min hpLost + 1
 *   (at least 1, so an empty run gives [0]).
 * - minHpLost (#205): the lowest HP lost when it is negative (heals beyond the damage taken);
 *   absent when no combat went below 0, so hpLostCounts[n] is then exactly n HP.
 * - firstCombatByHpLost[v]: keyed by the HP lost itself (negative keys included): the position
 *   in `results` of the first combat that lost exactly v HP. `results` must be in combat-index order starting at combat 0 (as
 *   runCombatRange(…, 0, n) and mergeChunkResults produce), so this is the lowest combat index.
 * An empty result list gives zeros everywhere (no NaN).
 */
export function summarize(strategyId: string, results: readonly CombatResult[]): StrategySummary {
  const n = results.length;
  let hpSum = 0;
  let wins = 0;
  let winTurns = 0;
  let losses = 0;
  let caps = 0;
  let maxHp = 0;
  let minHp = 0;
  let turnSum = 0;
  let goldSum = 0;
  let potionCombats = 0;
  for (const r of results) {
    hpSum += r.hpLost;
    turnSum += r.turns;
    goldSum += r.rewards?.gold ?? 0;
    if ((r.rewards?.potions ?? 0) > 0) potionCombats++;
    if (r.hpLost > maxHp) maxHp = r.hpLost;
    if (r.hpLost < minHp) minHp = r.hpLost;
    if (r.outcome === 'win') {
      wins++;
      winTurns += r.turns;
    } else if (r.outcome === 'loss') {
      losses++;
    } else {
      caps++;
    }
  }
  const hpLostCounts = new Array<number>(maxHp - minHp + 1).fill(0);
  const firstCombatByHpLost: Record<number, number> = {};
  results.forEach((r, i) => {
    hpLostCounts[r.hpLost - minHp] = (hpLostCounts[r.hpLost - minHp] ?? 0) + 1;
    if (!(r.hpLost in firstCombatByHpLost)) firstCombatByHpLost[r.hpLost] = i;
  });
  return {
    strategyId,
    combats: n,
    avgHpLost: n > 0 ? hpSum / n : 0,
    avgTurnsToKill: wins > 0 ? winTurns / wins : null,
    avgTurns: n > 0 ? turnSum / n : 0,
    avgGold: n > 0 ? goldSum / n : 0,
    potionRate: n > 0 ? potionCombats / n : 0,
    deathRate: n > 0 ? losses / n : 0,
    turnCapRate: n > 0 ? caps / n : 0,
    hpLostCounts,
    ...(minHp < 0 ? { minHpLost: minHp } : {}),
    firstCombatByHpLost,
  };
}

/** Single-threaded full run (tests, and fallback when Workers are unavailable). */
export function runSimulationSync(data: GameData, config: RunConfig, combats: number = COMBATS_PER_RUN): RunResult {
  return {
    gameVersion: data.manifest.gameVersion,
    config,
    summaries: config.strategies.map((rs, index) =>
      summarize(rs.strategy.id, runCombatRange(data, config, index, 0, combats)),
    ),
  };
}
