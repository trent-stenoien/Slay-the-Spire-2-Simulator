/** #259 Silent draw, discard and energy cards: Survivor, Acrobatics, Prepared, Dagger Throw, Backflip, Adrenaline, Calculated Gamble, Predator, Dodge and Roll. */
import { describe, expect, it } from 'vitest';
import { simulateCombat } from './combat';
import { cfg, deckOf, dummyData, events } from './combatTestHelpers';
import { createStrategy, GREEDY_CONFIG } from './strategies';
import { cards as fixtureCards } from './testFixtures';
import { gameData } from '../data';
import type { CardDef, ChoiceRequest, ChoiceResponse, GameData, Strategy, StrategyView } from './types';

/** Cards played by the tests are Innate, so they start in the opening hand. */
const REAL = [
  'survivor',
  'acrobatics',
  'prepared',
  'dagger_throw',
  'backflip',
  'adrenaline',
  'calculated_gamble',
  'predator',
  'dodge_and_roll',
];

const filler = (id: string, extra: Partial<CardDef> = {}): CardDef => ({
  ...fixtureCards.strike!,
  id,
  code: id.slice(0, 2),
  name: id,
  type: 'skill',
  cost: 0,
  effects: [],
  upgraded: null,
  ...extra,
});

function data(innate: string[]): GameData {
  const d = dummyData();
  for (const id of REAL) d.cards[id] = structuredClone(gameData.cards[id]!);
  d.cards.pad = filler('pad');
  d.cards.slyOne = filler('slyOne', { keywords: ['sly'] });
  d.cards.decay = filler('decay', { type: 'curse', cost: null as unknown as number, keywords: ['unplayable'] });
  for (const id of innate) d.cards[id]!.keywords = [...d.cards[id]!.keywords, 'innate'];
  return d;
}

interface Seen {
  views: StrategyView[];
  requests: ChoiceRequest[];
}

/** Plays `plan(turn)` in order; answers choices with `pick` (or the fallback when absent). */
function player(plan: (turn: number) => string[], seen: Seen, pick?: (r: ChoiceRequest) => ChoiceResponse): Strategy {
  let turn = -1;
  let queue: string[] = [];
  const s: Strategy = {
    decide(view) {
      seen.views.push(structuredClone(view) as StrategyView);
      if (view.state.turn !== turn) {
        turn = view.state.turn;
        queue = [...plan(turn)];
      }
      const want = queue.shift();
      if (want === undefined) return { kind: 'endTurn' };
      const c = view.playable.find((p) => p.cardId === want);
      if (!c) throw new Error(`${want} not playable on turn ${turn}`);
      return { kind: 'play', uid: c.uid };
    },
  };
  if (pick)
    s.choose = (_view, r) => {
      seen.requests.push(structuredClone(r) as ChoiceRequest);
      return pick(r);
    };
  return s;
}

function run(
  deck: [string, number, boolean?][],
  innate: string[],
  plan: (turn: number) => string[],
  pick?: (r: ChoiceRequest) => ChoiceResponse,
  turns = 1,
) {
  const seen: Seen = { views: [], requests: [] };
  const strategy = player(plan, seen, pick);
  const limited: Strategy = {
    ...strategy,
    decide: (v) => (v.state.turn > turns ? { kind: 'endTurn' } : strategy.decide(v)),
  };
  const r = simulateCombat(data(innate), cfg({ enemyId: 'dummy', deck: deckOf(...deck), seed: 3 }), limited, {
    log: true,
  });
  return { r, seen };
}

/** The last view of `turn` (after every play that turn). */
const lastView = (seen: Seen, turn: number) => seen.views.filter((v) => v.state.turn === turn).at(-1)!;
const firstView = (seen: Seen, turn: number) => seen.views.find((v) => v.state.turn === turn)!;
const discardedMoves = (r: ReturnType<typeof run>['r']) =>
  events(r.log, 'moved').filter((e) => e.from === 'hand' && e.to === 'discard');
/** Picks the first option whose cardId is in `ids`, then the rest in order. */
const prefer =
  (...ids: string[]) =>
  (r: ChoiceRequest): ChoiceResponse => {
    const ranked = [...r.options].sort((a, b) => {
      const ia = ids.indexOf(a.cardId);
      const ib = ids.indexOf(b.cardId);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    return { uids: ranked.slice(0, r.max).map((c) => c.uid) };
  };

describe('#259 Survivor', () => {
  it('gains 8 Block, then discards exactly 1 card picked by Strategy.choose', () => {
    const { r, seen } = run(
      [
        ['survivor', 1],
        ['slyOne', 1],
        ['pad', 10],
      ],
      ['survivor', 'slyOne'],
      () => ['survivor'],
      prefer('slyOne'),
    );
    expect(events(r.log, 'block')[0]!.amount).toBe(8);
    expect(seen.requests).toHaveLength(1);
    expect(seen.requests[0]).toMatchObject({ purpose: 'move', from: 'hand', to: 'discard', min: 1, max: 1 });
    expect(seen.requests[0]!.sourceCardId).toBe('survivor');
    expect(seen.requests[0]!.options).toHaveLength(4);
    expect(discardedMoves(r).map((e) => e.cardId)).toEqual(['slyOne']);
    const v = lastView(seen, 1);
    expect(v.state.player.hand).toHaveLength(3);
    expect(v.state.player.counters?.cardsDiscardedThisTurn).toBe(1);
  });

  it('Survivor+ gains 11 Block; with an empty hand it discards nothing', () => {
    const { r, seen } = run([['survivor', 1, true]], ['survivor'], () => ['survivor'], prefer());
    expect(events(r.log, 'block')[0]!.amount).toBe(11);
    expect(seen.requests).toHaveLength(0);
    expect(discardedMoves(r)).toHaveLength(0);
  });

  it('without a choose, the shared discard order picks (a Sly card before a curse that does not hurt)', () => {
    const { r } = run(
      [
        ['survivor', 1],
        ['slyOne', 1],
        ['decay', 1],
        ['pad', 10],
      ],
      ['survivor', 'slyOne', 'decay'],
      () => ['survivor'],
    );
    expect(discardedMoves(r).map((e) => e.cardId)).toEqual(['slyOne']);
  });
});

describe('#259 Acrobatics, Prepared, Dagger Throw (draw, then discard)', () => {
  it('Acrobatics draws 3, then discards 1 (Acrobatics+ draws 4)', () => {
    for (const [up, drawn] of [
      [false, 3],
      [true, 4],
    ] as const) {
      const { r, seen } = run(
        [
          ['acrobatics', 1, up],
          ['pad', 12],
        ],
        ['acrobatics'],
        () => ['acrobatics'],
        prefer(),
      );
      expect(seen.requests[0]!.options).toHaveLength(4 + drawn);
      expect(lastView(seen, 1).state.player.hand).toHaveLength(4 + drawn - 1);
      expect(discardedMoves(r)).toHaveLength(1);
    }
  });

  it('Prepared draws 1 and discards 1; Prepared+ draws 2 and discards 2', () => {
    const base = run(
      [
        ['prepared', 1],
        ['pad', 12],
      ],
      ['prepared'],
      () => ['prepared'],
      prefer(),
    );
    expect(base.seen.requests[0]).toMatchObject({ min: 1, max: 1 });
    expect(lastView(base.seen, 1).state.player.hand).toHaveLength(4);
    const up = run(
      [
        ['prepared', 1, true],
        ['pad', 12],
      ],
      ['prepared'],
      () => ['prepared'],
      prefer(),
    );
    expect(up.seen.requests[0]).toMatchObject({ min: 2, max: 2 });
    expect(up.seen.requests[0]!.options).toHaveLength(6);
    expect(discardedMoves(up.r)).toHaveLength(2);
    expect(lastView(up.seen, 1).state.player.hand).toHaveLength(4);
  });

  it('Dagger Throw deals 9 (12 upgraded), draws 1, then discards 1', () => {
    for (const [up, dmg] of [
      [false, 9],
      [true, 12],
    ] as const) {
      const { r, seen } = run(
        [
          ['dagger_throw', 1, up],
          ['pad', 12],
        ],
        ['dagger_throw'],
        () => ['dagger_throw'],
        prefer(),
      );
      expect(events(r.log, 'damage')[0]!.amount).toBe(dmg);
      expect(seen.requests[0]!.options).toHaveLength(5);
      expect(lastView(seen, 1).state.player.hand).toHaveLength(4);
    }
  });
});

describe('#259 Backflip and Adrenaline', () => {
  it('Backflip gains 5 Block (8 upgraded) and draws 2', () => {
    for (const [up, blk] of [
      [false, 5],
      [true, 8],
    ] as const) {
      const { r, seen } = run(
        [
          ['backflip', 1, up],
          ['pad', 12],
        ],
        ['backflip'],
        () => ['backflip'],
      );
      expect(events(r.log, 'block')[0]!.amount).toBe(blk);
      expect(lastView(seen, 1).state.player.hand).toHaveLength(6);
    }
  });

  it('Adrenaline gains 1 energy (2 upgraded), draws 2 and exhausts', () => {
    for (const [up, energy] of [
      [false, 1],
      [true, 2],
    ] as const) {
      const { r, seen } = run(
        [
          ['adrenaline', 1, up],
          ['pad', 12],
        ],
        ['adrenaline'],
        () => ['adrenaline'],
      );
      const v = lastView(seen, 1);
      expect(v.state.player.energy).toBe(firstView(seen, 1).state.player.energy + energy);
      expect(v.state.player.hand).toHaveLength(6);
      expect(v.state.player.exhaustPile.map((c) => c.cardId)).toEqual(['adrenaline']);
      expect(events(r.log, 'exhaust').map((e) => e.cardId)).toEqual(['adrenaline']);
    }
  });
});

describe('#259 Calculated Gamble', () => {
  it('discards the whole hand (each through the shared discard), then draws that many, and exhausts', () => {
    const { r, seen } = run(
      [
        ['calculated_gamble', 1],
        ['pad', 12],
      ],
      ['calculated_gamble'],
      () => ['calculated_gamble'],
    );
    expect(discardedMoves(r)).toHaveLength(4);
    const v = lastView(seen, 1);
    expect(v.state.player.hand).toHaveLength(4);
    expect(v.state.player.discardPile).toHaveLength(4);
    expect(v.state.player.counters?.cardsDiscardedThisTurn).toBe(4);
    expect(v.state.player.exhaustPile.map((c) => c.cardId)).toEqual(['calculated_gamble']);
  });

  it('with no other card in hand it discards and draws nothing; Calculated Gamble+ has Retain', () => {
    const { r, seen } = run([['calculated_gamble', 1]], ['calculated_gamble'], () => ['calculated_gamble']);
    expect(discardedMoves(r)).toHaveLength(0);
    expect(lastView(seen, 1).state.player.hand).toHaveLength(0);
    expect(gameData.cards.calculated_gamble!.upgraded!.keywords).toContain('retain');
  });
});

describe('#259 Predator', () => {
  it('deals 15 (20 upgraded) and draws 2 more cards at the start of next turn', () => {
    for (const [up, dmg] of [
      [false, 15],
      [true, 20],
    ] as const) {
      const { r, seen } = run(
        [
          ['predator', 1, up],
          ['pad', 20],
        ],
        ['predator'],
        (t) => (t === 1 ? ['predator'] : []),
        undefined,
        2,
      );
      expect(events(r.log, 'damage')[0]!.amount).toBe(dmg);
      expect(firstView(seen, 2).state.player.hand).toHaveLength(7);
    }
  });
});

describe('#259 Dodge and Roll (real card data)', () => {
  it('gains 4 Block now and 4 next turn (6 and 6 upgraded)', () => {
    for (const [up, blk] of [
      [false, 4],
      [true, 6],
    ] as const) {
      const { r } = run(
        [
          ['dodge_and_roll', 1, up],
          ['pad', 12],
        ],
        ['dodge_and_roll'],
        (t) => (t === 1 ? ['dodge_and_roll'] : []),
        undefined,
        2,
      );
      expect(
        events(r.log, 'block')
          .filter((e) => e.side === 'player')
          .map((e) => e.amount),
      ).toEqual([blk, blk]);
    }
  });
});

describe('#259 strategies play the cards', () => {
  it('the greedy strategy plays a Silent deck with every new card without an illegal choice', () => {
    const d = data([]);
    const deck = deckOf(...REAL.map((id): [string, number] => [id, 1]), ['slyOne', 2], ['decay', 1]);
    const r = simulateCombat(d, cfg({ enemyId: 'dummy', deck, seed: 7 }), createStrategy(GREEDY_CONFIG), {
      log: true,
    });
    const played = new Set(events(r.log, 'play').map((e) => e.cardId));
    for (const id of REAL) expect(played.has(id), id).toBe(true);
  });
});

describe('#259 strategy: when Calculated Gamble is played', () => {
  const firstPlay = (deck: [string, number][], innate: string[]) => {
    const d = data(innate);
    const r = simulateCombat(
      d,
      cfg({ enemyId: 'dummy', deck: deckOf(...deck), seed: 5 }),
      createStrategy(GREEDY_CONFIG),
      {
        log: true,
      },
    );
    return events(r.log, 'play')[0]?.cardId;
  };

  it('first, when more than half of the rest of the hand would not be played (curses)', () => {
    expect(
      firstPlay(
        [
          ['calculated_gamble', 1],
          ['decay', 3],
          ['dagger_throw', 1],
          ['pad', 10],
        ],
        ['calculated_gamble', 'decay', 'dagger_throw'],
      ),
    ).toBe('calculated_gamble');
  });

  it('not while the turn plan plays most of the hand', () => {
    expect(
      firstPlay(
        [
          ['calculated_gamble', 1],
          ['dagger_throw', 4],
          ['pad', 10],
        ],
        ['calculated_gamble', 'dagger_throw'],
      ),
    ).not.toBe('calculated_gamble');
  });
});
