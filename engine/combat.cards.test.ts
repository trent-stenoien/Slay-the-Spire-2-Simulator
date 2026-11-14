/** Real card data played through the engine, for rules the other files only check on fixture cards. */
import { describe, expect, it } from 'vitest';
import { gameData } from '../data/index';
import { cfg, deckOf, dummy, events, scripted } from './combatTestHelpers';
import { simulateCombat } from './combat';
import { createStrategy } from './strategies';
import { makeEnemy } from './testFixtures';
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

describe('Omnislice splash with several enemies (FEATURES 8, #283)', () => {
  const multi = (upgraded: boolean) => {
    const w = world();
    w.enemies.second = makeEnemy('second', 50, { wait: { name: 'Wait', effects: [] } });
    w.enemies.third = makeEnemy('third', 7, { wait: { name: 'Wait', effects: [] } });
    return simulateCombat(
      w,
      cfg({
        enemyIds: ['dummy', 'second', 'third'],
        deck: deckOf(['omnislice', 1, upgraded]),
      }),
      scripted((t) => (t === 1 ? ['omnislice'] : [])),
      { log: true },
    );
  };
  const dealt = (r: ReturnType<typeof multi>) =>
    events(r.log, 'damage')
      .filter((e) => e.target === 'enemy')
      .map((e) => e.hpLoss);

  it('hits the target for 8 (11 upgraded), then every other living enemy for the same damage', () => {
    expect(dealt(multi(false))).toEqual([8, 8, 8]);
    expect(dealt(multi(true))).toEqual([11, 11, 11]);
  });

  it('splashes the primary hit final damage (Vulnerable x1.5 = 12), not Attack damage on the others', () => {
    const w = world();
    w.enemies.second = makeEnemy('second', 50, { wait: { name: 'Wait', effects: [] } });
    const r = simulateCombat(
      w,
      cfg({ enemyIds: ['dummy', 'second'], deck: deckOf(['bash', 1], ['omnislice', 1]) }),
      scripted((t) => (t === 1 ? ['bash', 'omnislice'] : [])),
      { log: true },
    );
    const hits = events(r.log, 'damage').filter((e) => e.target === 'enemy');
    // Bash 8 on the Vulnerable-to-be target; Omnislice then 12 on it and 12 (no Vulnerable) on the other.
    expect(hits.slice(-2).map((e) => e.amount)).toEqual([12, 12]);
  });

  it('a dead enemy takes no splash; the target is not hit twice', () => {
    const w = world();
    w.enemies.second = makeEnemy('second', 50, { wait: { name: 'Wait', effects: [] } });
    w.enemies.weak = makeEnemy('weak', 3, { wait: { name: 'Wait', effects: [] } });
    const r = simulateCombat(
      w,
      cfg({ enemyIds: ['dummy', 'second', 'weak'], deck: deckOf(['omnislice', 2]) }),
      scripted((t) => (t === 1 ? ['omnislice', 'omnislice'] : [])),
      { log: true },
    );
    // Turn 1, play 1: 8 to each of the three (the 3-HP one dies). Play 2: only two enemies left.
    expect(events(r.log, 'damage').map((e) => e.hpLoss)).toEqual([8, 8, 8, 8, 8]);
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
