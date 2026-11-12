/** #206 Void: Unplayable, Ethereal; "Whenever you draw this card, lose 1 Energy" (never below 0). */
import { describe, expect, it } from 'vitest';
import { cards, makeGameData } from './testFixtures';
import { deckOf, dummy, events, logged, scripted, withEnemy } from './combatTestHelpers';
import { createStrategy, GREEDY_CONFIG } from './strategies';
import type { CardDef } from './types';

const voidCard: CardDef = {
  ...cards.defend!,
  id: 'void',
  code: 'Vo',
  name: 'Void',
  type: 'status',
  cost: null,
  effects: [],
  keywords: ['unplayable', 'ethereal'],
  upgraded: null,
  triggers: [{ when: 'drawn', effects: [{ type: 'loseEnergy', amount: 1 }] }],
};
const cantrip: CardDef = {
  ...cards.defend!,
  id: 'cantrip',
  code: 'Ct',
  name: 'Cantrip',
  cost: 0,
  effects: [{ type: 'draw', amount: 1 }],
  upgraded: null,
};

function world() {
  const d = withEnemy(makeGameData(), dummy());
  d.cards.void = voidCard;
  d.cards.cantrip = cantrip;
  return d;
}
const energyLosses = (r: ReturnType<typeof logged>) => events(r.log, 'energy').filter((e) => e.amount < 0);

describe('#206 Void', () => {
  it('loses 1 Energy when drawn at the start of the turn (after the refill)', () => {
    const r = logged(
      world(),
      scripted(() => []),
      { enemyId: 'dummy', deck: deckOf(['void', 1], ['strike', 4]) },
    );
    const first = events(r.log, 'energy')[0]!;
    expect(first.amount).toBe(-1);
    expect(first.total).toBe(2);
  });

  it('loses 1 Energy when drawn mid-turn by a draw effect', () => {
    let found = false;
    for (let seed = 1; seed <= 30 && !found; seed++) {
      const r = logged(
        world(),
        scripted((t) => (t === 1 ? ['cantrip', 'cantrip', 'cantrip', 'cantrip', 'cantrip'] : [])),
        {
          enemyId: 'dummy',
          seed,
          deck: deckOf(['cantrip', 5], ['void', 1]),
        },
      );
      const log = r.log!;
      const loss = log.findIndex((e) => e.t === 'energy' && e.amount < 0);
      const firstPlay = log.findIndex((e) => e.t === 'play');
      expect(energyLosses(r)[0]!.amount).toBe(-1);
      if (loss > firstPlay) found = true;
    }
    expect(found).toBe(true);
  });

  it('never takes energy below 0', () => {
    const r = logged(
      world(),
      scripted(() => []),
      { enemyId: 'dummy', deck: deckOf(['void', 4], ['strike', 1]) },
    );
    const turn1 = events(r.log, 'energy').slice(0, 3);
    expect(turn1.map((e) => e.total)).toEqual([2, 1, 0]);
    // The 4th Void changes nothing and logs nothing.
    expect(energyLosses(r).slice(0, 4)).toHaveLength(3);
  });

  it('is Ethereal: an unplayed Void is exhausted at the end of the turn', () => {
    const r = logged(
      world(),
      scripted(() => []),
      { enemyId: 'dummy', deck: deckOf(['void', 1], ['strike', 4]) },
    );
    expect(events(r.log, 'exhaust')[0]).toMatchObject({ cardId: 'void', reason: 'ethereal' });
  });

  it('a strategy never tries to play it', () => {
    const r = logged(world(), createStrategy(GREEDY_CONFIG), {
      enemyId: 'dummy',
      deck: deckOf(['void', 2], ['strike', 3]),
    });
    expect(events(r.log, 'play').some((e) => e.cardId === 'void')).toBe(false);
  });
});
