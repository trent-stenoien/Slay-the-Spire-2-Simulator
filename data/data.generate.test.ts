/** #116 random card generation: the cards are simulated, and every one runs in a real combat. */
import { describe, expect, it } from 'vitest';
import { gameData } from './index';
import { simulateCombat } from '../engine/combat';
import { GREEDY_CONFIG, createStrategy } from '../engine/strategies';
import type { Deck } from '../engine/types';

const IDS = [
  'infernal_blade',
  'distraction',
  'jack_of_all_trades',
  'jackpot',
  'discovery',
  'abundance',
  'metamorphosis',
  'stoke',
  'primal_force',
  'calamity',
  'hello_world',
  'entropy',
  'mad_science_chaos',
];

describe('#116 generation cards', () => {
  it.each(IDS)('%s is simulated', (id) => {
    expect(gameData.cards[id]?.simulated).toBe(true);
  });

  it('Splash stays unsimulated (#151)', () => {
    expect(gameData.cards.splash?.simulated).toBe(false);
  });

  it.each(IDS.flatMap((id) => [false, true].map((up) => [id, up] as const)))(
    '%s (upgraded: %s) plays in a combat',
    (id, up) => {
      const deck: Deck = [
        { cardId: id, upgraded: up, count: 3 },
        { cardId: 'strike', upgraded: false, count: 5 },
        { cardId: 'defend', upgraded: false, count: 4 },
      ];
      for (let seed = 1; seed <= 5; seed++) {
        const r = simulateCombat(
          gameData,
          { characterId: 'ironclad', deck, enemyId: 'nibbit', ascension: 0, strategy: GREEDY_CONFIG, seed },
          createStrategy(GREEDY_CONFIG),
          { log: true },
        );
        expect(['win', 'loss', 'turnCap']).toContain(r.outcome);
      }
    },
  );
});
