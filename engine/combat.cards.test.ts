/** Real card data played through the engine, for rules the other files only check on fixture cards. */
import { describe, expect, it } from 'vitest';
import { gameData } from '../data/index';
import { cfg, deckOf, dummy, events, scripted } from './combatTestHelpers';
import { simulateCombat } from './combat';
import { createStrategy } from './strategies';
import type { GameData } from './types';

const world = (): GameData => ({ ...gameData, enemies: { ...gameData.enemies, dummy: dummy() } });

describe('Omnislice with a single enemy (FEATURES 8)', () => {
  it('deals 8 once (11 upgraded): no second target, no extra damage', () => {
    for (const [upgraded, damage] of [
      [false, 8],
      [true, 11],
    ] as const) {
      const r = simulateCombat(
        world(),
        cfg({ enemyId: 'dummy', deck: deckOf(['omnislice', 1, upgraded]) }),
        scripted((t) => (t === 1 ? ['omnislice'] : [])),
        { log: true },
      );
      const hits = events(r.log, 'damage').filter((e) => e.target === 'enemy');
      expect(hits.map((e) => e.amount)).toEqual([damage]);
    }
  });
});

describe('Alchemize with every strategy order (FEATURES Strategy 19)', () => {
  it('is never played, even with spare energy and nothing else to do', () => {
    for (const order of [
      ['attack', 'powers', 'block'],
      ['block', 'powers', 'attack'],
      ['powers', 'attack', 'block'],
    ] as const) {
      const r = simulateCombat(
        world(),
        cfg({
          enemyId: 'dummy',
          deck: deckOf(['alchemize', 1], ['alchemize', 1, true], ['strike', 1]),
          strategy: { order: [...order], allowThrough: 0 },
        }),
        createStrategy({ order: [...order], allowThrough: 0 }),
        { log: true },
      );
      expect(events(r.log, 'play').filter((e) => e.cardId === 'alchemize')).toEqual([]);
      expect(r.rewards?.potions ?? 0).toBe(0);
    }
  });
});
