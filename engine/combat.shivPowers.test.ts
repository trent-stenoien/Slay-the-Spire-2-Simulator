/** #267 Silent Shiv powers and Knife Trap: Accuracy, Infinite Blades, Phantom Blades, Fan of Knives, Knife Trap (real card data). */
import { describe, expect, it } from 'vitest';
import { gameData } from '../data/index';
import { simulateCombat } from './combat';
import { makeEnemy, makeGameData } from './testFixtures';
import { cfg, deckOf, dummy, events, withEnemy } from './combatTestHelpers';
import { GREEDY_CONFIG, createStrategy, isShivCard } from './strategies';
import type { CardDef, Decision, Strategy, StrategyView } from './types';

const real = (id: string): CardDef => structuredClone(gameData.cards[id]!);

/** Real cards (the `innate` ones open in the hand) plus the Shiv tokens, against passive enemies. */
function world(innate: string[], other: string[] = []) {
  const d = withEnemy(makeGameData(), dummy(), makeEnemy('dummy2', 999, { wait: { name: 'Wait', effects: [] } }));
  for (const id of [...innate, ...other, 'shiv', 'inky_shiv']) d.cards[id] = real(id);
  for (const id of innate) d.cards[id]!.keywords = [...d.cards[id]!.keywords, 'innate'];
  return d;
}

/** Plays the listed cardIds in order per turn (`plans[turn - 1]`), then ends the turn. */
function plan(...plans: string[][]): Strategy {
  const queues = plans.map((p) => [...p]);
  return {
    decide(view: StrategyView): Decision {
      const want = queues[view.state.turn - 1]?.shift();
      if (want === undefined) return { kind: 'endTurn' };
      const c = view.playable.find((p) => p.cardId === want);
      if (!c) throw new Error(`${want} not playable; playable: ${view.playable.map((p) => p.cardId).join(',')}`);
      return { kind: 'play', uid: c.uid };
    },
  };
}

const run = (d: ReturnType<typeof world>, strategy: Strategy, deck = deckOf(), overrides = {}) =>
  simulateCombat(d, cfg({ enemyId: 'dummy', deck, ...overrides }), strategy, { log: true });
type Log = ReturnType<typeof run>['log'];
const hits = (log: Log) => events(log, 'damage').filter((e) => e.source === 'player');
const amounts = (log: Log) => hits(log).map((e) => e.amount);

describe('#267 Accuracy', () => {
  it.each([
    [false, 8],
    [true, 10],
  ])('upgraded=%s: every Shiv deals %i (4 + 4 or 6)', (up, dmg) => {
    const r = run(
      world(['accuracy', 'blade_dance']),
      plan(['accuracy', 'blade_dance', 'shiv', 'shiv']),
      deckOf(['accuracy', 1, up], ['blade_dance', 1]),
    );
    expect(amounts(r.log)).toEqual([dmg, dmg]);
  });

  it('does not change other Attacks', () => {
    const r = run(
      world(['accuracy'], ['strike']),
      plan(['accuracy', 'strike']),
      deckOf(['accuracy', 1], ['strike', 1]),
    );
    expect(amounts(r.log)).toEqual([6]);
  });

  it('stacks across copies', () => {
    const r = run(
      world(['accuracy', 'blade_dance']),
      plan(['accuracy', 'accuracy', 'blade_dance', 'shiv']),
      deckOf(['accuracy', 2], ['blade_dance', 1]),
    );
    expect(amounts(r.log)).toEqual([12]); // 4 + 4 + 4
  });
});

describe('#267 Phantom Blades', () => {
  it('the first Shiv each turn deals 9 more (12 upgraded); later Shivs deal the plain 4', () => {
    for (const [up, bonus] of [
      [false, 9],
      [true, 12],
    ] as const) {
      const r = run(
        world(['phantom_blades', 'blade_dance']),
        plan(['phantom_blades', 'blade_dance', 'shiv', 'shiv', 'shiv']),
        deckOf(['phantom_blades', 1, up], ['blade_dance', 1]),
      );
      expect(amounts(r.log)).toEqual([4 + bonus, 4, 4]);
    }
  });

  it('Shivs are Retained, so they stay in hand and the first Shiv of the next turn gets the bonus again', () => {
    const r = run(
      world(['phantom_blades', 'blade_dance']),
      plan(['phantom_blades', 'blade_dance', 'shiv'], ['shiv', 'shiv']),
      deckOf(['phantom_blades', 1], ['blade_dance', 1]),
    );
    expect(amounts(r.log)).toEqual([13, 13, 4]);
    expect(events(r.log, 'discard').filter((e) => e.cardId === 'shiv').length).toBe(0);
  });

  it('without Phantom Blades, unplayed Shivs are discarded at the end of the turn', () => {
    const r = run(world(['blade_dance']), plan(['blade_dance'], []), deckOf(['blade_dance', 1]));
    expect(
      events(r.log, 'discard').filter((e) => e.cardId === 'shiv' && e.reason === 'endOfTurn').length,
    ).toBeGreaterThanOrEqual(3);
  });

  it('Accuracy and the first-Shiv bonus add together', () => {
    const r = run(
      world(['phantom_blades', 'accuracy', 'blade_dance']),
      plan(['phantom_blades', 'accuracy', 'blade_dance', 'shiv', 'shiv']),
      deckOf(['phantom_blades', 1], ['accuracy', 1], ['blade_dance', 1]),
      { startEnergy: undefined },
    );
    expect(amounts(r.log)).toEqual([4 + 9 + 4, 4 + 4]);
  });
});

describe('#356 Phantom Blades: the strategy keeps one Shiv for next turn', () => {
  const phantom = (hp = 999) => {
    const d = world(['phantom_blades', 'blade_dance']);
    d.enemies.dummy!.hp = { min: hp, max: hp };
    return run(d, createStrategy(GREEDY_CONFIG), deckOf(['phantom_blades', 1], ['blade_dance', 1]));
  };
  /** Player damage per turn: the log is split at each player turnStart. */
  const byTurn = (log: Log) => {
    const turns: number[][] = [];
    for (const e of log ?? []) {
      if (e.t === 'turnStart' && e.side === 'player') turns.push([]);
      else if (e.t === 'damage' && e.source === 'player') turns[turns.length - 1]!.push(e.amount);
    }
    return turns;
  };

  it('plays the first Shiv (bonus), keeps the last one, and plays it first next turn with the bonus again', () => {
    const r = phantom();
    const turns = byTurn(r.log);
    expect(turns[0]).toEqual([13, 4]);
    expect(turns[1]![0]).toBe(13);
  });

  it('with Infinite Blades in play every Shiv is played (a new one comes each turn), none is held (round-1 addition)', () => {
    const d = world(['phantom_blades', 'infinite_blades', 'blade_dance']);
    d.enemies.dummy!.hp = { min: 999, max: 999 };
    const r = run(
      d,
      createStrategy(GREEDY_CONFIG),
      deckOf(['phantom_blades', 1], ['infinite_blades', 1], ['blade_dance', 1]),
    );
    expect(byTurn(r.log)[0]).toEqual([13, 4, 4]);
  });

  it('plays the last Shiv when it kills the enemy', () => {
    const r = phantom(21);
    expect(byTurn(r.log)).toEqual([[13, 4, 4]]);
  });
});

describe('#267 Infinite Blades', () => {
  it('adds a Shiv to the hand at the start of each turn (the turn it is played: none)', () => {
    const r = run(world(['infinite_blades']), plan(['infinite_blades'], [], []), deckOf(['infinite_blades', 1]));
    const made = events(r.log, 'generated').filter((e) => e.cardId === 'shiv' && e.to === 'hand');
    expect(made.length).toBeGreaterThanOrEqual(2);
    expect(made.every((e) => e.cardId === 'shiv')).toBe(true);
  });

  it('exactly one Shiv per turn, none on the turn it is played (round-1 addition)', () => {
    const r = run(world(['infinite_blades']), plan(['infinite_blades'], [], []), deckOf(['infinite_blades', 1]));
    const perTurn = new Map<number, number>();
    let turn = 0;
    for (const e of r.log ?? []) {
      if (e.t === 'turnStart' && e.side === 'player') turn = e.turn;
      if (e.t === 'generated' && e.cardId === 'shiv' && e.to === 'hand')
        perTurn.set(turn, (perTurn.get(turn) ?? 0) + 1);
    }
    expect(perTurn.get(1)).toBeUndefined();
    expect(perTurn.get(2)).toBe(1);
    expect(perTurn.get(3)).toBe(1);
  });

  it('turn 2 starts with one Shiv in the hand to play', () => {
    const r = run(world(['infinite_blades']), plan(['infinite_blades'], ['shiv']), deckOf(['infinite_blades', 1]));
    expect(amounts(r.log)).toEqual([4]);
  });

  it('upgraded is Innate', () => {
    expect(gameData.cards.infinite_blades!.upgraded?.keywords).toContain('innate');
  });
});

describe('#267 Fan of Knives', () => {
  it.each([
    [false, 4],
    [true, 5],
  ])('upgraded=%s adds %i Shivs to the hand', (up, n) => {
    const r = run(world(['fan_of_knives']), plan(['fan_of_knives']), deckOf(['fan_of_knives', 1, up]));
    expect(events(r.log, 'generated').filter((e) => e.cardId === 'shiv' && e.to === 'hand')).toHaveLength(n);
  });

  it('Shivs hit ALL enemies: one hit per living enemy, Accuracy included', () => {
    const r = run(
      world(['fan_of_knives', 'accuracy']),
      plan(['accuracy', 'fan_of_knives', 'shiv']),
      deckOf(['fan_of_knives', 1], ['accuracy', 1]),
      { enemyId: undefined, enemyIds: ['dummy', 'dummy2'], startEnergy: undefined },
    );
    expect(amounts(r.log)).toEqual([8, 8]);
  });

  it('an Inky Shiv applies its Weak to ALL enemies too (#356), and to one without the power', () => {
    const weakOn = (r: ReturnType<typeof run>) =>
      events(r.log, 'debuff').filter((e) => e.side === 'enemy' && e.kind === 'weak').length;
    const two = { enemyId: undefined, enemyIds: ['dummy', 'dummy2'] };
    const deck = deckOf(['fan_of_knives', 1], ['blade_of_ink', 1]);
    const w = () => world(['fan_of_knives', 'blade_of_ink']);
    expect(weakOn(run(w(), plan(['fan_of_knives', 'blade_of_ink', 'inky_shiv']), deck, two))).toBe(2);
    expect(weakOn(run(w(), plan(['blade_of_ink', 'inky_shiv']), deck, two))).toBe(1);
  });

  it('without the power, a Shiv hits one enemy', () => {
    const r = run(world(['blade_dance']), plan(['blade_dance', 'shiv']), deckOf(['blade_dance', 1]), {
      enemyId: undefined,
      enemyIds: ['dummy', 'dummy2'],
    });
    expect(amounts(r.log)).toEqual([4]);
  });

  it('only Shivs: other attacks stay single-target', () => {
    const d = world(['fan_of_knives'], ['strike']);
    const r = run(d, plan(['fan_of_knives', 'strike']), deckOf(['fan_of_knives', 1], ['strike', 1]), {
      enemyId: undefined,
      enemyIds: ['dummy', 'dummy2'],
    });
    expect(amounts(r.log)).toEqual([6]);
  });
});

describe('#267 Knife Trap', () => {
  const trapDeck = (up: boolean) => deckOf(['blade_dance', 1], ['knife_trap', 1, up]);
  const trapWorld = () => world(['blade_dance', 'knife_trap']);

  it('plays every Shiv in the Exhaust pile on the enemy', () => {
    const r = run(trapWorld(), plan(['blade_dance', 'shiv', 'shiv', 'shiv', 'knife_trap']), trapDeck(false));
    expect(amounts(r.log)).toEqual([4, 4, 4, 4, 4, 4]);
  });

  it('upgraded: upgrades each Shiv, then plays it (6 damage)', () => {
    const r = run(trapWorld(), plan(['blade_dance', 'shiv', 'shiv', 'knife_trap']), trapDeck(true));
    expect(amounts(r.log)).toEqual([4, 4, 6, 6]);
    expect(events(r.log, 'upgraded').filter((e) => e.cardId === 'shiv')).toHaveLength(2);
  });

  it('the played Shivs Exhaust again (each once), and are not replayed', () => {
    const r = run(trapWorld(), plan(['blade_dance', 'shiv', 'shiv', 'knife_trap']), trapDeck(false));
    expect(events(r.log, 'exhaust').filter((e) => e.cardId === 'shiv')).toHaveLength(4);
  });

  it('with no Shiv in the Exhaust pile it does nothing', () => {
    const r = run(trapWorld(), plan(['knife_trap']), trapDeck(false));
    expect(amounts(r.log)).toEqual([]);
  });

  it('plays only Shiv and Shiv+, not Inky Shivs (#356)', () => {
    const r = run(
      world(['knife_trap', 'blade_of_ink']),
      plan(['blade_of_ink', 'inky_shiv', 'knife_trap']),
      deckOf(['knife_trap', 1], ['blade_of_ink', 1]),
    );
    expect(amounts(r.log)).toEqual([4]); // the Inky Shiv played once; Knife Trap leaves it in the Exhaust pile
  });
});

describe('#267 strategy: Shivs in hand are always played', () => {
  it('plays Accuracy first, then every Shiv with its bonus (greedy strategy)', () => {
    const d = world(['accuracy', 'blade_dance']);
    const r = run(d, createStrategy(GREEDY_CONFIG), deckOf(['accuracy', 1], ['blade_dance', 1]));
    const turnOne = amounts(r.log).slice(0, 3);
    expect(turnOne).toEqual([8, 8, 8]);
  });

  it('plays the Shivs even when Block is ranked above Attacks', () => {
    const d = world(['blade_dance']);
    const r = run(
      d,
      createStrategy({ ...GREEDY_CONFIG, order: ['block', 'attack', 'powers'] }),
      deckOf(['blade_dance', 1]),
    );
    expect(amounts(r.log).slice(0, 3)).toEqual([4, 4, 4]);
  });

  it('#356: Shivs already in hand are played before Fan of Knives', () => {
    const d = world(['shiv', 'fan_of_knives']);
    const r = run(d, createStrategy(GREEDY_CONFIG), deckOf(['shiv', 2], ['fan_of_knives', 1]));
    const order = events(r.log, 'play')
      .slice(0, 3)
      .map((e) => e.cardId);
    expect(order.indexOf('fan_of_knives')).toBe(2);
    expect(order.slice(0, 2)).toEqual(['shiv', 'shiv']);
  });

  it('#356: Knife Trap is played after the Shivs in hand', () => {
    const d = world(['blade_dance', 'knife_trap'], ['shiv']);
    const r = run(d, createStrategy(GREEDY_CONFIG), deckOf(['blade_dance', 1], ['knife_trap', 1]));
    const order = events(r.log, 'play')
      .slice(0, 5)
      .map((e) => e.cardId);
    expect(order.indexOf('knife_trap')).toBeGreaterThan(order.lastIndexOf('shiv', 3));
  });

  it('isShivCard covers Shiv and Inky Shiv only', () => {
    expect(isShivCard({ cardId: 'shiv' })).toBe(true);
    expect(isShivCard({ cardId: 'inky_shiv' })).toBe(true);
    expect(isShivCard({ cardId: 'strike' })).toBe(false);
  });
});
