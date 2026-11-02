/** #109 Powers group internals: ranking Powers, and never playing a Crimson Mantle that would kill. */
import { describe, expect, it } from 'vitest';
import { makeCardInstance, simulateCombat } from './combat';
import { cfg, deckOf, dummyData, events } from './combatTestHelpers';
import { createStrategy, GREEDY_CONFIG, pickPower, powerValue, selfDamage } from './strategies';
import { cards } from './testFixtures';
import type { CardDef, Effect, PowerId, StrategyConfig } from './types';

const apply = (p: PowerId, amount: number): Effect => ({ type: 'applyPower', power: p, amount });

const power = (id: string, cost: number, effects: Effect[]): CardDef => ({
  ...cards.defend!,
  id,
  code: id.slice(0, 2),
  name: id,
  type: 'power',
  cost,
  effects,
  upgraded: null,
});

/** Test cards with the real cards' numbers and costs. */
const defs: Record<string, CardDef> = {
  inflame: power('inflame', 1, [{ type: 'gainStrength', amount: 2 }]),
  demon: power('demon', 3, [apply('demonForm', 3)]),
  stone: power('stone', 1, [apply('plating', 4)]),
  mantle: power('mantle', 1, [apply('crimsonMantle', 7)]),
  improve: power('improve', 1, [apply('upgradeAtCombatEnd', 1)]),
  barricade: power('barricade', 3, [apply('barricade', 1)]),
  corruption: power('corruption', 3, [apply('corruption', 1)]),
  cruelty: power('cruelty', 1, [apply('cruelty', 25)]),
  /** Same value as Inflame (8) but 2 energy. */
  dearFlex: power('dearFlex', 2, [{ type: 'gainStrength', amount: 2 }]),
};

let uid = 0;
const card = (id: string) => makeCardInstance(defs[id]!, false, uid++);

describe('#109 Powers group ranking', () => {
  it('values each Power by its immediate worth', () => {
    expect(powerValue(card('inflame'))).toBe(8); // 2 Strength × 4
    expect(powerValue(card('demon'))).toBe(12); // 3 Strength a turn × 4
    expect(powerValue(card('stone'))).toBe(4); // 4 Block this turn
    expect(powerValue(card('mantle'))).toBe(7);
    expect(powerValue(card('cruelty'))).toBe(5);
    expect(powerValue(card('barricade'))).toBe(6);
    expect(powerValue(card('corruption'))).toBe(10);
    expect(powerValue(card('improve'))).toBe(0);
  });

  it('plays the highest value first: Demon Form, then Inflame, then Stone Armor; Improvement last', () => {
    const hand = [card('improve'), card('stone'), card('inflame'), card('demon')];
    expect(pickPower(hand, 6)?.cardId).toBe('demon');
    expect(
      pickPower(
        hand.filter((c) => c.cardId !== 'demon'),
        3,
      )?.cardId,
    ).toBe('inflame');
    expect(pickPower([hand[0]!, hand[1]!], 3)?.cardId).toBe('stone');
  });

  it('ties go to the cheaper Power', () => {
    const dear = card('dearFlex');
    const cheap = card('inflame');
    expect(pickPower([dear, cheap], 3)).toBe(cheap);
  });

  it('in a combat, Powers first plays Demon Form (all 3 energy) on turn 1, Inflame first on turn 2', () => {
    const d = dummyData();
    Object.assign(d.cards, structuredClone(defs));
    const powersFirst: StrategyConfig = { order: ['powers', 'block', 'attack'], allowThrough: 5 };
    const r = simulateCombat(
      d,
      cfg({ enemyId: 'dummy', deck: deckOf(['demon', 1], ['inflame', 1], ['strike', 3]), strategy: powersFirst }),
      createStrategy(powersFirst),
      { log: true },
    );
    expect(
      events(r.log, 'play')
        .map((e) => e.cardId)
        .slice(0, 2),
    ).toEqual(['demon', 'inflame']);
  });
});

describe('#109 self-damage Powers', () => {
  it('Crimson Mantle counts its 1 HP a turn as self-damage', () => {
    expect(selfDamage(card('mantle'))).toBe(1);
    expect(selfDamage(card('stone'))).toBe(0);
  });

  it('is never played at 1 HP, and is played at 2 HP', () => {
    const d = dummyData();
    Object.assign(d.cards, structuredClone(defs));
    d.characters.ironclad!.maxHp = 1;
    const deck = deckOf(['mantle', 1]);
    const at1 = simulateCombat(d, cfg({ enemyId: 'dummy', deck }), createStrategy(GREEDY_CONFIG), { log: true });
    expect(events(at1.log, 'play')).toEqual([]);
    d.characters.ironclad!.maxHp = 2;
    const at2 = simulateCombat(d, cfg({ enemyId: 'dummy', deck }), createStrategy(GREEDY_CONFIG), { log: true });
    expect(events(at2.log, 'play').map((e) => e.cardId)).toEqual(['mantle']);
  });
});
