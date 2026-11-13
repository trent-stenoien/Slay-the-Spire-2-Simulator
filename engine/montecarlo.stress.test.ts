/** FEATURES "Known failure points": the Scared Block stress deck must stay at 0% deaths. */
import { describe, expect, it } from 'vitest';
import { gameData } from '../data/index';
import { runSimulationSync } from './montecarlo';
import { GREEDY_CONFIG, blockFirstConfig } from './strategies';
import type { RunConfig } from './types';

/** Raise to 10000 for the full measurement (5 s). */
const STRESS_COMBATS = 1000;

const ironclad = gameData.characters['ironclad']!;

/** Starter + Burning Pact + Purity + True Grit+ vs Nibbit A0 (it was 64% deaths at Block 0 before #141). */
const stressRun = (): RunConfig => ({
  characterId: 'ironclad',
  deck: [
    ...ironclad.startingDeck,
    { cardId: 'burning_pact', upgraded: false, count: 1 },
    { cardId: 'purity', upgraded: false, count: 1 },
    { cardId: 'true_grit', upgraded: true, count: 1 },
  ],
  enemyId: 'nibbit',
  ascension: 0,
  strategies: [
    { strategy: { id: 'block0', name: 'Block 0', config: blockFirstConfig(0) }, color: 'blue' },
    { strategy: { id: 'block5', name: 'Block 5', config: blockFirstConfig(5) }, color: 'green' },
    { strategy: { id: 'greedy', name: 'Greedy', config: GREEDY_CONFIG }, color: 'yellow' },
  ],
  runSeed: 12345,
});

describe('Scared Block stress deck (known failure point)', () => {
  it('has 0 deaths and no turn-cap fights for Block 0, Block 5 and Greedy', () => {
    const run = runSimulationSync(gameData, stressRun(), STRESS_COMBATS);
    expect(run.summaries.map((s) => [s.strategyId, s.deathRate, s.turnCapRate])).toEqual([
      ['block0', 0, 0],
      ['block5', 0, 0],
      ['greedy', 0, 0],
    ]);
  });
});
