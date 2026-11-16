/** #272: The Insatiable (Act 2 boss), Sandpit, Frantic Escape and the strategy rule for it. */
import { describe, expect, it } from 'vitest';
import { gameData } from '../data/index';
import { simulateCombat } from './combat';
import { cfg, deckOf, events, logged, passive, scripted, withEnemy } from './combatTestHelpers';
import { createStrategy, GREEDY_CONFIG } from './strategies';
import { makeEnemy, makeGameData } from './testFixtures';
import type { GameData, Strategy } from './types';

const insatiableData = (): GameData => {
  const base = makeGameData();
  return {
    ...base,
    cards: { ...base.cards, frantic_escape: gameData.cards.frantic_escape! },
    enemies: { ...base.enemies, the_insatiable: gameData.enemies.the_insatiable! },
  };
};

const endTurn: Strategy = { decide: () => ({ kind: 'endTurn' }) };

describe('#272 The Insatiable data', () => {
  it('is an Act 2 (Hive) boss with 321 HP (A8 341)', () => {
    const d = gameData.enemies.the_insatiable!;
    expect(d).toMatchObject({ act: 2, zone: 'hive', difficulty: 'boss', hp: { min: 321, max: 321 } });
    expect(d.ascension['8']?.hp).toEqual({ min: 341, max: 341 });
  });

  it('opens with Liquify Ground, then cycles Thrash, Lunging Bite, Salivate, Thrash', () => {
    const r = logged(insatiableData(), endTurn, {
      enemyId: 'the_insatiable',
      playerStart: { powers: { intangible: 999, sandpit: 999 } },
    });
    const moves = events(r.log, 'enemyMove')
      .slice(0, 9)
      .map((e) => e.moveId);
    const cyc = ['thrash', 'lungingBite', 'salivate', 'thrash'];
    expect(moves).toEqual(['liquifyGround', ...cyc, ...cyc]);
  });

  it('base and A9 move numbers: Thrash 8x2 (9x2), Lunging Bite 28 (31), Salivate +2 (3) Strength', () => {
    const d = gameData.enemies.the_insatiable!;
    expect(d.moves.thrash!.effects).toEqual([{ type: 'attack', damage: 8, hits: 2 }]);
    expect(d.moves.lungingBite!.effects).toEqual([{ type: 'attack', damage: 28, hits: 1 }]);
    expect(d.moves.salivate!.effects).toEqual([{ type: 'gainStrength', amount: 2 }]);
    const a9 = d.ascension['9']!.moves!;
    expect(a9.thrash!.effects).toEqual([{ type: 'attack', damage: 9, hits: 2 }]);
    expect(a9.lungingBite!.effects).toEqual([{ type: 'attack', damage: 31, hits: 1 }]);
    expect(a9.salivate!.effects).toEqual([{ type: 'gainStrength', amount: 3 }]);
  });

  it('Liquify Ground shuffles 3 Frantic Escape into the draw pile and 3 into the discard pile', () => {
    let seen: { draw: number; discard: number; hand: number } | undefined;
    const strategy: Strategy = {
      decide(view) {
        if (view.state.turn === 2 && !seen) {
          const fe = (pile: readonly { cardId: string }[]) => pile.filter((c) => c.cardId === 'frantic_escape').length;
          const p = view.state.player;
          seen = { draw: fe(p.drawPile), discard: fe(p.discardPile), hand: fe(p.hand) };
        }
        return { kind: 'endTurn' };
      },
    };
    simulateCombat(
      insatiableData(),
      cfg({ enemyId: 'the_insatiable', deck: deckOf(['strike', 20]), playerStart: { powers: { intangible: 999 } } }),
      strategy,
    );
    // Turn 2 drew 5 from the draw pile, which may include some of the 3 shuffled in there.
    expect(seen!.draw + seen!.hand).toBe(3);
    expect(seen!.discard).toBe(3);
  });
});

describe('#272 Frantic Escape cost increase', () => {
  it('each play raises that copy’s cost by 1 for the rest of combat, through discard and reshuffle', () => {
    const costs: number[] = [];
    const strategy: Strategy = {
      decide(view) {
        const c = view.playable.find((p) => p.cardId === 'frantic_escape');
        if (c) {
          costs.push(c.cost!);
          return { kind: 'play', uid: c.uid };
        }
        return { kind: 'endTurn' };
      },
    };
    const r = simulateCombat(
      insatiableData(),
      cfg({ deck: deckOf(['frantic_escape', 1]), playerStart: { powers: { intangible: 999, sandpit: 99 } } }),
      strategy,
      { log: true },
    );
    // One copy, drawn every turn (reshuffled each time): cost 1, 2, 3, then 4 is above the 3 energy.
    expect(costs).toEqual([1, 2, 3]);
    expect(events(r.log, 'costChanged').map((e) => e.cost)).toEqual([2, 3, 4]);
  });
});

describe('#272 Sandpit', () => {
  it('Liquify Ground gives 4 Sandpit; −1 at the end of each player turn; eaten at the start of enemy turn 5', () => {
    const r = logged(insatiableData(), passive, {
      enemyId: 'the_insatiable',
      deck: deckOf(['strike', 20]),
      playerStart: { powers: { intangible: 999 } },
    });
    expect(r.outcome).toBe('loss');
    expect(r.turns).toBe(5);
    // Liquify Ground, Thrash, Lunging Bite, Salivate; on turn 5 the player is eaten before the move.
    expect(events(r.log, 'enemyMove').map((e) => e.moveId)).toEqual([
      'liquifyGround',
      'thrash',
      'lungingBite',
      'salivate',
    ]);
    const sandpit = events(r.log, 'powerApplied').filter((e) => e.power === 'sandpit');
    expect(sandpit.map((e) => e.total)).toEqual([4, 3, 2, 1]);
    expect(events(r.log, 'powerRemoved').some((e) => e.power === 'sandpit')).toBe(true);
    const last = events(r.log, 'loseHp').at(-1)!;
    expect(last).toMatchObject({ side: 'player', hpAfter: 0 });
  });

  it('Frantic Escape adds 1 Sandpit (one more turn)', () => {
    const data = insatiableData();
    const r = logged(
      data,
      scripted((t) => (t === 1 ? ['frantic_escape'] : [])),
      {
        deck: deckOf(['frantic_escape', 1], ['strike', 4]),
        playerStart: { powers: { intangible: 999, sandpit: 1 } },
      },
    );
    // Sandpit 1 + 1 = 2 → 1 after turn 1 → 0 after turn 2 → eaten at enemy turn 2.
    expect(r.outcome).toBe('loss');
    expect(r.turns).toBe(2);
  });

  it('a Poison kill at the start of the enemy turn wins before the player is eaten', () => {
    const sinker = makeEnemy('sinker', 5, { wait: { name: 'Wait', effects: [] } });
    const data = withEnemy(insatiableData(), sinker);
    data.cards.deadly_poison = gameData.cards.deadly_poison!;
    const start = { powers: { sandpit: 1 } };
    const won = logged(
      data,
      scripted((t) => (t === 1 ? ['deadly_poison'] : [])),
      {
        enemyId: 'sinker',
        deck: deckOf(['deadly_poison', 5]),
        playerStart: start,
      },
    );
    expect(won.outcome).toBe('win');
    const lost = logged(data, passive, { enemyId: 'sinker', deck: deckOf(['deadly_poison', 5]), playerStart: start });
    expect(lost.outcome).toBe('loss');
    expect(lost.turns).toBe(1);
  });
});

describe('#272 Frantic Escape strategy rule (Trent)', () => {
  const dummyData = () => withEnemy(insatiableData(), makeEnemy('dummy', 999, { wait: { name: 'Wait', effects: [] } }));

  /** The cards the greedy strategy plays on turn 1 against a passive dummy (3 Energy, 5-card hand). */
  function turnOnePlays(strikes: number, powers: Record<string, number>): string[] {
    const inner = createStrategy(GREEDY_CONFIG);
    const order: string[] = [];
    const strategy: Strategy = {
      ...inner,
      decide(view) {
        const d = inner.decide(view);
        if (view.state.turn === 1 && d.kind === 'play') order.push(view.playable.find((p) => p.uid === d.uid)!.cardId);
        return d;
      },
    };
    const deck = deckOf(['frantic_escape', 1], ['strike', strikes]);
    simulateCombat(dummyData(), cfg({ enemyId: 'dummy', deck, playerStart: { powers } }), strategy);
    return order;
  }

  it('with Sandpit above 2, plays it only with Energy left after the other plays', () => {
    // 4 Strikes use all 3 Energy: nothing is spare.
    expect(turnOnePlays(4, { sandpit: 10 })).toEqual(['strike', 'strike', 'strike']);
    // 2 Strikes leave 1 Energy: Strikes first, then the escape.
    expect(turnOnePlays(2, { sandpit: 10 })).toEqual(['strike', 'strike', 'frantic_escape']);
  });

  it('with Sandpit at 2 or below, plays it first', () => {
    expect(turnOnePlays(4, { sandpit: 2 })).toEqual(['frantic_escape', 'strike', 'strike']);
  });

  it('the boundary: Sandpit 3 is not urgent (Strikes first), Sandpit 2 is (round-1 addition)', () => {
    expect(turnOnePlays(4, { sandpit: 3 })).toEqual(['strike', 'strike', 'strike']);
    expect(turnOnePlays(4, { sandpit: 2 })[0]).toBe('frantic_escape');
  });

  it('never plays it without Sandpit', () => {
    expect(turnOnePlays(2, {})).toEqual(['strike', 'strike']);
  });

  it('the greedy starter deck escapes the Sandpit against The Insatiable (plays Frantic Escape, lasts past turn 5)', () => {
    const r = simulateCombat(insatiableData(), cfg({ enemyId: 'the_insatiable' }), createStrategy(GREEDY_CONFIG), {
      log: true,
    });
    expect(r.turns).toBeGreaterThan(5);
    expect(events(r.log!, 'play').some((e) => e.cardId === 'frantic_escape')).toBe(true);
  });
});
