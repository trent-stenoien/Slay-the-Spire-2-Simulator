/** #262 Silent Shiv cards: the real card data run through the engine. */
import { describe, expect, it } from 'vitest';
import { gameData } from '../data/index';
import { simulateCombat } from './combat';
import { makeGameData } from './testFixtures';
import { cfg, deckOf, dummy, events, withEnemy } from './combatTestHelpers';
import { GREEDY_CONFIG, createStrategy } from './strategies';
import type { CardDef, Decision, Strategy, StrategyView } from './types';

const real = (id: string): CardDef => structuredClone(gameData.cards[id]!);

/** Real cards (innate, so they open in the hand) in a world with the Shiv token and a passive enemy. */
function world(innate: string[], other: string[] = []) {
  const d = withEnemy(makeGameData(), dummy());
  for (const id of [...innate, ...other, 'shiv']) d.cards[id] = real(id);
  for (const id of innate) d.cards[id]!.keywords = [...d.cards[id]!.keywords, 'innate'];
  return d;
}

/** Plays the listed cardIds in order on turn 1, then ends the turn (a missing card throws). */
function turnOne(...order: string[]): Strategy {
  const queue = [...order];
  return {
    decide(view: StrategyView): Decision {
      if (view.state.turn !== 1) return { kind: 'endTurn' };
      const want = queue.shift();
      if (want === undefined) return { kind: 'endTurn' };
      const c = view.playable.find((p) => p.cardId === want);
      if (!c) throw new Error(`${want} not playable; playable: ${view.playable.map((p) => p.cardId).join(',')}`);
      return { kind: 'play', uid: c.uid };
    },
  };
}

const run = (d: ReturnType<typeof world>, strategy: Strategy, deck = deckOf(), overrides = {}) =>
  simulateCombat(d, cfg({ enemyId: 'dummy', deck, ...overrides }), strategy, { log: true });

const shivsMade = (log: ReturnType<typeof run>['log']) =>
  events(log, 'generated').filter((e) => e.cardId === 'shiv' && e.to === 'hand').length;
const playerHits = (log: ReturnType<typeof run>['log']) => events(log, 'damage').filter((e) => e.source === 'player');
const blockGains = (log: ReturnType<typeof run>['log']) => events(log, 'block').filter((e) => e.side === 'player');

describe('#262 Blade Dance', () => {
  it.each([
    [false, 3],
    [true, 4],
  ])('upgraded=%s adds %i Shivs to the hand and Exhausts', (up, n) => {
    const r = run(world(['blade_dance']), turnOne('blade_dance'), deckOf(['blade_dance', 1, up]));
    expect(shivsMade(r.log)).toBe(n);
    expect(events(r.log, 'exhaust').filter((e) => e.cardId === 'blade_dance')).toHaveLength(1);
  });

  it('the Shivs are real Shivs: each deals 4 damage and Exhausts', () => {
    const r = run(world(['blade_dance']), turnOne('blade_dance', 'shiv', 'shiv', 'shiv'), deckOf(['blade_dance', 1]));
    expect(playerHits(r.log).map((e) => e.amount)).toEqual([4, 4, 4]);
    expect(events(r.log, 'exhaust').filter((e) => e.cardId === 'shiv')).toHaveLength(3);
  });
});

describe('#262 Cloak and Dagger', () => {
  it.each([
    [false, 1],
    [true, 2],
  ])('upgraded=%s: 6 Block and %i Shiv(s) into the hand', (up, n) => {
    const r = run(world(['cloak_and_dagger']), turnOne('cloak_and_dagger'), deckOf(['cloak_and_dagger', 1, up]));
    expect(blockGains(r.log).map((e) => e.amount)).toEqual([6]);
    expect(shivsMade(r.log)).toBe(n);
  });
});

describe('#262 Leading Strike', () => {
  it.each([
    [false, 3],
    [true, 6],
  ])('upgraded=%s: %i damage and 2 Shivs into the hand', (up, dmg) => {
    const r = run(world(['leading_strike']), turnOne('leading_strike'), deckOf(['leading_strike', 1, up]));
    expect(playerHits(r.log).map((e) => e.amount)).toEqual([dmg]);
    expect(shivsMade(r.log)).toBe(2);
  });
});

describe('#262 Storm of Steel', () => {
  // Innate Storm + 3 innate Defends: the hand is Storm + 3 Defends; Storm is played, so 3 cards are discarded.
  const storm = (up: boolean, others: number, play: string[] = []) => {
    const d = world(['storm_of_steel', 'defend']);
    return run(d, turnOne('storm_of_steel', ...play), deckOf(['storm_of_steel', 1, up], ['defend', others]));
  };

  it('discards the whole hand (not itself) and adds 1 Shiv per discarded card', () => {
    const r = storm(false, 3);
    expect(events(r.log, 'moved').filter((e) => e.from === 'hand' && e.to === 'discard')).toHaveLength(3);
    expect(shivsMade(r.log)).toBe(3);
  });

  it('an empty hand adds no Shivs', () => {
    expect(shivsMade(storm(false, 0).log)).toBe(0);
  });

  it('upgraded adds Shiv+ (6 damage each); base Shivs deal 4', () => {
    expect(playerHits(storm(true, 2, ['shiv', 'shiv']).log).map((e) => e.amount)).toEqual([6, 6]);
    expect(playerHits(storm(false, 2, ['shiv', 'shiv']).log).map((e) => e.amount)).toEqual([4, 4]);
  });
});

describe('#262 Up My Sleeve', () => {
  it.each([
    [false, 3],
    [true, 4],
  ])('upgraded=%s adds %i Shivs', (up, n) => {
    const r = run(world(['up_my_sleeve']), turnOne('up_my_sleeve'), deckOf(['up_my_sleeve', 1, up]));
    expect(shivsMade(r.log)).toBe(n);
  });

  it('costs 2, then 1, then 0 on later plays, never below 0 (each copy on its own)', () => {
    // One card in the deck. The plan plays Up My Sleeve when it can, then every Shiv, so the Shivs never clog the deck.
    const strategy: Strategy = {
      decide(view) {
        if (view.state.turn > 3) return { kind: 'endTurn' };
        const c =
          view.playable.find((p) => p.cardId === 'up_my_sleeve') ?? view.playable.find((p) => p.cardId === 'shiv');
        return c ? { kind: 'play', uid: c.uid } : { kind: 'endTurn' };
      },
    };
    const r = run(world(['up_my_sleeve']), strategy, deckOf(['up_my_sleeve', 1]));
    const left = events(r.log, 'play')
      .filter((e) => e.cardId === 'up_my_sleeve')
      .map((e) => e.energyLeft);
    expect(left.slice(0, 3)).toEqual([1, 2, 3]); // 3 energy: paid 2, then 1, then 0
    expect(
      events(r.log, 'costChanged')
        .map((e) => e.cost)
        .slice(0, 3),
    ).toEqual([1, 0, 0]);
  });
});

describe('#262 Hidden Daggers stays unsimulated until the discard choice exists (#259)', () => {
  it('is not simulated', () => {
    expect(gameData.cards.hidden_daggers!.simulated).toBe(false);
  });
});

describe('#285 Blade of Ink (Inky Shivs: a Shiv that also applies 1 Weak)', () => {
  const inkWorld = () => {
    const d = world(['blade_of_ink']);
    d.cards.inky_shiv = real('inky_shiv');
    return d;
  };
  const weakOnEnemy = (log: ReturnType<typeof run>['log']) =>
    events(log, 'debuff').filter((e) => e.side === 'enemy' && e.kind === 'weak');

  it.each([
    [false, 2],
    [true, 3],
  ])('upgraded=%s adds %i Inky Shivs to the hand', (up, n) => {
    const r = run(inkWorld(), turnOne('blade_of_ink'), deckOf(['blade_of_ink', 1, up]));
    expect(events(r.log, 'generated').filter((e) => e.cardId === 'inky_shiv' && e.to === 'hand')).toHaveLength(n);
  });

  it('each Inky Shiv deals 4, applies 1 Weak and Exhausts', () => {
    const r = run(inkWorld(), turnOne('blade_of_ink', 'inky_shiv', 'inky_shiv'), deckOf(['blade_of_ink', 1]));
    expect(playerHits(r.log).map((e) => e.amount)).toEqual([4, 4]);
    expect(weakOnEnemy(r.log)).toHaveLength(2);
    expect(events(r.log, 'exhaust').filter((e) => e.cardId === 'inky_shiv')).toHaveLength(2);
  });

  it('a plain Shiv applies no Weak', () => {
    const d = world(['blade_dance']);
    const r = run(d, turnOne('blade_dance', 'shiv'), deckOf(['blade_dance', 1]));
    expect(weakOnEnemy(r.log)).toHaveLength(0);
  });

  it('strategies play the Inky Shivs', () => {
    const r = simulateCombat(
      inkWorld(),
      cfg({
        enemyId: 'dummy',
        deck: deckOf(['blade_of_ink', 1]),
        strategy: { ...GREEDY_CONFIG, order: [...GREEDY_CONFIG.order] },
      }),
      createStrategy({ ...GREEDY_CONFIG, order: [...GREEDY_CONFIG.order] }),
      { log: true },
    );
    const plays = events(r.log, 'play').filter((e) => e.cardId === 'inky_shiv').length;
    expect(plays).toBeGreaterThanOrEqual(2);
    expect(events(r.log, 'exhaust').filter((e) => e.cardId === 'inky_shiv')).toHaveLength(plays);
  });
});

describe('#262 strategies play Shivs', () => {
  it.each([
    ['attack first', GREEDY_CONFIG],
    ['block first', { order: ['block', 'powers', 'attack'], allowThrough: 0 }],
  ] as const)('%s: the 0-cost Shivs from Blade Dance are all played', (_name, config) => {
    const d = world(['blade_dance']);
    const r = simulateCombat(
      d,
      cfg({ enemyId: 'dummy', deck: deckOf(['blade_dance', 1]), strategy: { ...config, order: [...config.order] } }),
      createStrategy({ ...config, order: [...config.order] }),
      { log: true },
    );
    const shivPlays = events(r.log, 'play').filter((e) => e.cardId === 'shiv');
    expect(shivPlays).toHaveLength(3);
    expect(events(r.log, 'exhaust').filter((e) => e.cardId === 'shiv')).toHaveLength(3);
  });

  it('Up My Sleeve is played first; Storm of Steel last, turning the cards it cannot play into Shivs that are played', () => {
    const config = GREEDY_CONFIG;
    const d = world(['up_my_sleeve', 'storm_of_steel', 'defend']);
    d.cards.defend!.cost = 3; // unaffordable after Up My Sleeve: Storm of Steel discards them
    const r = simulateCombat(
      d,
      cfg({
        enemyId: 'dummy',
        deck: deckOf(['up_my_sleeve', 1], ['storm_of_steel', 1], ['defend', 3]),
        strategy: { ...config, order: [...config.order] },
      }),
      createStrategy({ ...config, order: [...config.order] }),
      { log: true },
    );
    const plays = events(r.log, 'play').map((e) => e.cardId);
    expect(plays.slice(0, 5)).toEqual(['up_my_sleeve', 'shiv', 'shiv', 'shiv', 'storm_of_steel']);
    expect(plays.slice(5, 8)).toEqual(['shiv', 'shiv', 'shiv']);
  });
});
