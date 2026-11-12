/** #213 Slippery on the enemy: the next N HP losses are 1 HP each. */
import { describe, expect, it } from 'vitest';
import { cards, makeEnemy, makeGameData } from './testFixtures';
import { deckOf, dummy, events, logged, scripted, withEnemy } from './combatTestHelpers';
import { pickAttack } from './strategies';
import type { CardInstance as Card, Strategy } from './types';

/** Gives the enemy `n` Slippery before the first decision (EnemyDef.startPowers is #203's job). */
function slippery(n: number, inner: Strategy): Strategy {
  let done = false;
  return {
    decide(view) {
      if (!done) {
        done = true;
        const enemy = view.state.enemy as { powers?: Record<string, number> };
        enemy.powers = { ...enemy.powers, slippery: n };
      }
      return inner.decide(view);
    },
  };
}

const setup = (enemy = dummy()) => {
  const data = withEnemy(makeGameData(), enemy);
  data.cards.flurry = {
    ...cards.strike!,
    id: 'flurry',
    code: 'Fl',
    cost: 0,
    effects: [{ type: 'attack', damage: 3, hits: 3 }],
    upgraded: null,
  };
  data.cards.smash = {
    ...cards.strike!,
    id: 'smash',
    code: 'Sm',
    cost: 0,
    effects: [{ type: 'attack', damage: 30, hits: 1 }],
    upgraded: null,
  };
  data.cards.venom = {
    ...cards.defend!,
    id: 'venom',
    code: 'Vn',
    cost: 0,
    effects: [{ type: 'applyPoison', amount: 5 }],
    upgraded: null,
  };
  data.cards.expose = {
    ...cards.defend!,
    id: 'expose',
    code: 'Ex',
    cost: 0,
    effects: [{ type: 'applyVulnerable', amount: 5 }],
    upgraded: null,
  };
  return data;
};

const losses = (log: ReturnType<typeof logged>['log']) => events(log, 'damage').map((d) => d.hpLoss);
const stacksAfter = (log: ReturnType<typeof logged>['log']) =>
  events(log, 'powerApplied')
    .filter((p) => p.side === 'enemy' && p.power === 'slippery')
    .map((p) => p.total);

describe('Slippery', () => {
  it('an attack hit loses only 1 HP and uses one stack', () => {
    const data = setup();
    const r = logged(
      data,
      slippery(
        2,
        scripted((t) => (t === 1 ? ['smash', 'smash', 'smash'] : [])),
      ),
      {
        enemyId: 'dummy',
        deck: deckOf(['smash', 3], ['defend', 2]),
      },
    );
    // Two stacks: 1, 1; then the third hit is full damage.
    expect(losses(r.log)).toEqual([1, 1, 30]);
    expect(r.log!.some((e) => e.t === 'powerRemoved' && e.side === 'enemy' && e.power === 'slippery')).toBe(true);
  });

  it('a multi-hit attack uses one stack per hit', () => {
    const data = setup();
    const r = logged(
      data,
      slippery(
        2,
        scripted((t) => (t === 1 ? ['flurry'] : [])),
      ),
      {
        enemyId: 'dummy',
        deck: deckOf(['flurry', 1], ['defend', 4]),
      },
    );
    // Hits 1 and 2 lose 1 HP each (2 stacks), hit 3 deals its 3.
    expect(losses(r.log)).toEqual([1, 1, 3]);
    expect(stacksAfter(r.log)).toEqual([1]);
  });

  it('Strength and Vulnerable do not matter: the loss is 1 either way', () => {
    const data = setup();
    const r = logged(
      data,
      slippery(
        1,
        scripted((t) => (t === 1 ? ['expose', 'smash'] : [])),
      ),
      {
        enemyId: 'dummy',
        deck: deckOf(['expose', 1], ['smash', 1], ['defend', 3]),
      },
    );
    expect(losses(r.log)).toEqual([1]);
  });

  it('at 0 stacks (none ever, or used up) damage is normal', () => {
    const data = setup();
    const r = logged(
      data,
      scripted((t) => (t === 1 ? ['smash'] : [])),
      {
        enemyId: 'dummy',
        deck: deckOf(['smash', 1], ['defend', 4]),
      },
    );
    expect(losses(r.log)).toEqual([30]);
    expect(stacksAfter(r.log)).toEqual([]);
  });

  it('a fully blocked hit loses no HP and keeps the stack; a partly blocked one uses it', () => {
    const wall = makeEnemy('wall', 999, {
      fortify: { name: 'Fortify', effects: [{ type: 'gainBlock', amount: 40 }] },
    });
    const data = setup(wall);
    const r = logged(
      data,
      slippery(
        1,
        scripted((t) => (t === 2 ? ['smash', 'smash'] : [])),
      ),
      {
        enemyId: 'wall',
        deck: deckOf(['smash', 10]),
      },
    );
    // 40 Block: the first 30 is fully blocked (stack kept); the second has 10 Block left, would lose
    // 20 HP, loses 1 and uses the stack.
    const dmg = events(r.log, 'damage').filter((d) => d.target === 'enemy');
    expect(dmg.slice(0, 2).map((d) => d.hpLoss)).toEqual([0, 1]);
    expect(stacksAfter(r.log)).toEqual([]);
    expect(events(r.log, 'powerRemoved').filter((p) => p.side === 'enemy')).toHaveLength(1);
  });

  it('Poison counts as an HP loss: 1 HP and one stack per tick', () => {
    const data = setup();
    const r = logged(
      data,
      slippery(
        1,
        scripted((t) => (t === 1 ? ['venom'] : [])),
      ),
      {
        enemyId: 'dummy',
        deck: deckOf(['venom', 1], ['defend', 4]),
      },
    );
    const pd = events(r.log, 'poisonDamage');
    // Tick 1: 5 Poison -> 1 HP (stack used), Poison 4; tick 2: 4 HP.
    expect(pd.slice(0, 2).map((p) => p.amount)).toEqual([1, 4]);
    expect(pd[0]!.hpAfter).toBe(998);
  });
});

describe('Slippery strategy', () => {
  const card = (cardId: string, uid: number): Card =>
    ({ ...(cards[cardId] as object), uid, cardId }) as unknown as Card;
  it('plays the multi-hit attack before a big single hit while Slippery is up', () => {
    const data = setup();
    const flurry = { ...card('flurry', 1), ...data.cards.flurry };
    const smash = { ...card('smash', 2), ...data.cards.smash };
    expect(pickAttack([flurry, smash] as never, 3, 0, undefined)).toBe(smash);
    const state = { enemy: { powers: { slippery: 3 } } } as never;
    expect(pickAttack([flurry, smash] as never, 3, 0, state)).toBe(flurry);
  });
});
