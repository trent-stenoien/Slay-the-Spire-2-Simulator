/** #339 enemy Thorns and Personal Hive (Attack hits on the enemy), and relic ids in the strategy view. */
import { describe, expect, it } from 'vitest';
import { cards, makeGameData } from './testFixtures';
import { deckOf, dummy, events, logged, scripted, withEnemy } from './combatTestHelpers';
import type { Strategy } from './types';

function withPowers(powers: Record<string, number>, inner: Strategy): Strategy {
  let done = false;
  return {
    decide(view) {
      if (!done) {
        done = true;
        const enemy = view.state.enemy as { powers?: Record<string, number> };
        enemy.powers = { ...enemy.powers, ...powers };
      }
      return inner.decide(view);
    },
  };
}

const setup = () => {
  const data = withEnemy(makeGameData(), dummy());
  data.cards.flurry = {
    ...cards.strike!,
    id: 'flurry',
    code: 'Fl',
    cost: 0,
    effects: [{ type: 'attack', damage: 3, hits: 3 }],
    upgraded: null,
  };
  data.cards.dazed = {
    ...cards.defend!,
    id: 'dazed',
    code: 'Dz',
    cost: null,
    effects: [],
    upgraded: null,
  };
  return data;
};

describe('#339 enemy Thorns and Personal Hive', () => {
  it('Thorns deals its damage to the player on every Attack hit (Block absorbs)', () => {
    const data = setup();
    const r = logged(
      data,
      withPowers(
        { thorns: 2 },
        scripted((t) => (t === 1 ? ['flurry'] : [])),
      ),
      { enemyId: 'dummy', deck: deckOf(['flurry', 1], ['defend', 4]) },
    );
    const back = events(r.log, 'damage').filter((d) => d.target === 'player' && d.source === 'player');
    expect(back.map((d) => d.amount)).toEqual([2, 2, 2]);
  });

  it('Personal Hive adds Dazed to the draw pile on every Attack hit', () => {
    const data = setup();
    const r = logged(
      data,
      withPowers(
        { personalHive: 2 },
        scripted((t) => (t === 1 ? ['flurry'] : [])),
      ),
      { enemyId: 'dummy', deck: deckOf(['flurry', 1], ['defend', 4]) },
    );
    const dazed = events(r.log, 'generated').filter((g) => g.cardId === 'dazed');
    expect(dazed).toHaveLength(6);
  });
});
