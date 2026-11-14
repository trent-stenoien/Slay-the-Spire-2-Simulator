/** #104 Rewards: gainGold (Hand of Greed, only on a kill), gainPotion (Alchemize), CombatResult.rewards. */
import { describe, expect, it } from 'vitest';
import { simulateCombat } from './combat';
import { cards, makeEnemy } from './testFixtures';
import { cfg, deckOf, dummyData, scripted, withEnemy } from './combatTestHelpers';
import type { CardDef, Effect, GameData } from './types';

const card = (id: string, code: string, effects: Effect[], extra: Partial<CardDef> = {}): CardDef => ({
  ...cards.strike!,
  id,
  code,
  name: id,
  cost: 0,
  effects,
  upgraded: null,
  ...extra,
});

const greed = card('greed', 'HO', [
  { type: 'attack', damage: 20, hits: 1 },
  { type: 'conditional', if: { kind: 'fatal' }, then: [{ type: 'gainGold', amount: 20 }] },
]);
const alchemize = card('alchemize', 'Al', [{ type: 'gainPotion' }], { type: 'skill', keywords: ['exhaust'] });

function data(enemyHp: number): GameData {
  const d = withEnemy(dummyData(), makeEnemy('target', enemyHp, { wait: { name: 'Wait', effects: [] } }));
  d.cards.greed = greed;
  d.cards.alchemize = alchemize;
  return d;
}

const run = (hp: number, deck: ReturnType<typeof deckOf>, plan: string[]) =>
  simulateCombat(
    data(hp),
    cfg({ enemyId: 'target', deck }),
    scripted((t) => (t === 1 ? plan : [])),
  );

describe('#104 rewards', () => {
  it('Hand of Greed gains gold when its hit kills the enemy', () => {
    const r = run(20, deckOf(['greed', 5]), ['greed']);
    expect(r.outcome).toBe('win');
    expect(r.rewards).toEqual({ gold: 20, potions: 0, cardRewards: 0 });
  });

  it('Hand of Greed gains no gold when it does not kill (and rewards is omitted)', () => {
    const r = run(21, deckOf(['greed', 5]), ['greed']);
    expect(r.outcome).not.toBe('win');
    expect(r.rewards).toBeUndefined();
  });

  it('Alchemize gains one potion each play, exhausts, and has no other effect', () => {
    const r = run(999, deckOf(['alchemize', 5]), ['alchemize', 'alchemize']);
    expect(r.rewards).toEqual({ gold: 0, potions: 2, cardRewards: 0 });
    expect(r.enemyHpRemaining).toBe(999);
  });

  it('the same seed gives the same rewards', () => {
    const a = run(20, deckOf(['greed', 5]), ['greed']);
    const b = run(20, deckOf(['greed', 5]), ['greed']);
    expect(a).toEqual(b);
  });
});
