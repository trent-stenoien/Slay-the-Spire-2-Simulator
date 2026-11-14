/** #265 Silent counters and conditions: the real card data run through the engine. */
import { describe, expect, it } from 'vitest';
import { gameData } from '../data/index';
import { makeCardInstance, simulateCombat } from './combat';
import { makeGameData } from './testFixtures';
import { cfg, deckOf, dummy, events, withEnemy } from './combatTestHelpers';
import { cardCost } from './rules';
import { createStrategy, GREEDY_CONFIG } from './strategies';
import type { CardDef, Decision, Effect, Strategy, StrategyView } from './types';

const real = (id: string): CardDef => structuredClone(gameData.cards[id]!);
const innate = (c: CardDef): CardDef => ({ ...c, keywords: [...c.keywords, 'innate'] });
const helper = (id: string, effects: Effect[], extra: Partial<CardDef> = {}): CardDef => ({
  ...real('defend'),
  id,
  code: id.slice(0, 2).padEnd(2, 'x'),
  name: id,
  cost: 0,
  keywords: ['innate'],
  effects,
  upgraded: null,
  ...extra,
});

function world(ids: string[] = [], extra: Record<string, CardDef> = {}) {
  const d = withEnemy(makeGameData(), dummy());
  for (const id of ids) d.cards[id] = innate(real(id));
  Object.assign(d.cards, extra);
  return d;
}

/** Plays the listed cardIds in order on turn 1, then ends the turn. */
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

const run = (d: ReturnType<typeof world>, strategy: Strategy, deck: ReturnType<typeof deckOf>, overrides = {}) =>
  simulateCombat(d, cfg({ enemyId: 'dummy', deck, ...overrides }), strategy, { log: true });
/** Events of turn 1 only (the dummy never dies, so combat runs on to the turn cap). */
const turnOneLog = (r: ReturnType<typeof run>) =>
  r.log!.slice(
    0,
    r.log!.findIndex((e) => e.t === 'turnEnd'),
  );
const hits = (r: ReturnType<typeof run>) => events(r.log, 'damage').filter((e) => e.source === 'player');
const blocks = (r: ReturnType<typeof run>) => events(r.log, 'block').filter((e) => e.side === 'player');

describe('#265 Pinpoint costs 1 less per Skill played this turn', () => {
  it('cardCost reads Skills, not Attacks', () => {
    const pin = makeCardInstance(real('pinpoint'), false, 0);
    expect(cardCost(pin, 5, false, 0)).toBe(3);
    expect(cardCost(pin, 0, false, 2)).toBe(1);
    expect(cardCost(pin, 0, false, 9)).toBe(0);
  });

  it('three Defends make it free, and it deals 15', () => {
    const d = world(['pinpoint', 'defend']);
    const r = run(d, turnOne('defend', 'defend', 'defend', 'pinpoint'), deckOf(['pinpoint', 1], ['defend', 4]));
    expect(hits(r)[0]!.amount).toBe(15);
    expect(events(r.log, 'play').at(-1)!.energyLeft).toBe(0);
  });

  it('is unplayable at full cost with 3 energy and no Skill when energy is short', () => {
    const d = world(['pinpoint', 'defend']);
    d.characters.ironclad!.energyPerTurn = 2;
    expect(() => run(d, turnOne('pinpoint'), deckOf(['pinpoint', 1], ['defend', 4]))).toThrow(/not playable/);
  });
});

describe('#265 Memento Mori counts cards discarded this turn', () => {
  const discardOne = helper('discarder', [
    { type: 'moveCards', from: 'hand', to: 'discard', count: 1, mode: 'random', filter: { cardId: 'defend' } },
  ]);

  it('deals 9 + 4 per discarded card, 11 + 5 upgraded', () => {
    for (const [up, expected] of [
      [false, 9 + 4 * 2],
      [true, 11 + 5 * 2],
    ] as const) {
      const d = world(['memento_mori'], { discarder: discardOne });
      const r = run(
        d,
        turnOne('discarder', 'discarder', 'memento_mori'),
        deckOf(['memento_mori', 1, up], ['discarder', 2], ['defend', 5]),
      );
      expect(hits(r)[0]!.amount).toBe(expected);
    }
  });

  it('the end-of-turn discard does not count, and the count resets each turn', () => {
    const d = world(['memento_mori'], { discarder: discardOne });
    d.cards.memento_mori!.keywords = ['innate', 'retain'];
    // Turn 1: discard one card, end the turn (the rest of the hand is discarded). Turn 2: Memento Mori, kept by Retain.
    const strat: Strategy = {
      decide(view) {
        const want = view.state.turn === 1 ? 'discarder' : 'memento_mori';
        const c = view.playable.find((p) => p.cardId === want);
        const done = view.state.turn === 1 ? view.state.player.hand.length < 5 : false;
        return c && !done && view.state.turn <= 2 ? { kind: 'play', uid: c.uid } : { kind: 'endTurn' };
      },
    };
    const r = run(d, strat, deckOf(['memento_mori', 1], ['discarder', 1], ['defend', 20]));
    expect(hits(r)[0]!.amount).toBe(9);
  });
});

describe('#265 Murder counts cards drawn this combat', () => {
  it('deals 1 plus 1 per card drawn (the opening hand of 5 counts)', () => {
    const d = world(['murder']);
    const r = run(d, turnOne('murder'), deckOf(['murder', 1], ['defend', 9]), { energy: 3 });
    expect(hits(r)[0]!.amount).toBe(1 + 5);
  });

  it('counts draws from effects too', () => {
    const draw2 = helper('draw2', [{ type: 'draw', amount: 2 }]);
    const d = world(['murder'], { draw2 });
    const r = run(d, turnOne('draw2', 'murder'), deckOf(['murder', 1], ['draw2', 1], ['defend', 9]));
    expect(hits(r)[0]!.amount).toBe(1 + 5 + 2);
  });
});

describe('#265 Flechettes hits once per Skill in hand', () => {
  it('deals 5 per Skill (7 upgraded), not counting itself or Attacks', () => {
    const d = world(['flechettes', 'defend', 'strike']);
    const hand = deckOf(['flechettes', 1], ['defend', 3], ['strike', 1]);
    const r = run(d, turnOne('flechettes'), hand);
    expect(hits(r).map((h) => h.amount)).toEqual([5, 5, 5]);
    const up = run(d, turnOne('flechettes'), deckOf(['flechettes', 1, true], ['defend', 3], ['strike', 1]));
    expect(hits(up).map((h) => h.amount)).toEqual([7, 7, 7]);
  });

  it('with no Skill in hand it makes no hits', () => {
    const d = world(['flechettes', 'strike']);
    const r = run(d, turnOne('flechettes'), deckOf(['flechettes', 1], ['strike', 4]));
    expect(hits(r)).toEqual([]);
  });
});

describe('#265 Finisher hits once per Attack played earlier this turn', () => {
  it('with no earlier Attack it deals 0 damage', () => {
    const d = world(['finisher', 'strike']);
    const r = run(d, turnOne('finisher'), deckOf(['finisher', 1], ['strike', 4]));
    expect(hits(r)).toEqual([]);
  });

  it('after two Attacks it hits twice for 6 (8 upgraded); it does not count itself', () => {
    const d = world(['finisher', 'strike']);
    const r = run(d, turnOne('strike', 'strike', 'finisher'), deckOf(['finisher', 1], ['strike', 4]));
    expect(hits(r).map((h) => h.amount)).toEqual([6, 6, 6, 6]);
    const up = run(d, turnOne('strike', 'strike', 'finisher'), deckOf(['finisher', 1, true], ['strike', 4]));
    expect(
      hits(up)
        .slice(2)
        .map((h) => h.amount),
    ).toEqual([8, 8]);
  });

  it('the strategy plays it after the other Attacks', () => {
    const d = world(['finisher', 'strike']);
    d.characters.ironclad!.energyPerTurn = 5;
    const r = run(d, createStrategy(GREEDY_CONFIG), deckOf(['finisher', 1], ['strike', 4]));
    const plays = events(r.log, 'play').map((e) => e.cardId);
    const turn1 = plays.slice(0, plays.indexOf('finisher') + 1);
    expect(turn1.at(-1)).toBe('finisher');
    expect(turn1.filter((c) => c === 'strike').length).toBe(4);
  });
});

describe('#265 Escape Plan: if you draw a Skill, gain Block', () => {
  const run1 = (topIds: string[], upgraded = false) => {
    const d = world(['escape_plan', 'defend', 'strike']);
    // Opening hand is innate Escape Plan + fillers; the drawn card is the top of the draw pile.
    d.cards.defend!.keywords = [];
    d.cards.strike!.keywords = [];
    const deck = deckOf(['escape_plan', 1, upgraded], ...topIds.map((id) => [id, 20] as [string, number]));
    return run(d, turnOne('escape_plan'), deck);
  };

  it('drawing a Skill gains 3 Block (5 upgraded)', () => {
    expect(blocks(run1(['defend']))[0]!.amount).toBe(3);
    expect(blocks(run1(['defend'], true))[0]!.amount).toBe(5);
  });

  it('drawing an Attack gains no Block', () => {
    expect(blocks(run1(['strike']))).toEqual([]);
  });

  it('with nothing left to draw, no Block', () => {
    const d = world(['escape_plan']);
    const r = run(d, turnOne('escape_plan'), deckOf(['escape_plan', 1]));
    expect(blocks(r)).toEqual([]);
  });
});

describe('#265 Expertise draws until 6 (7) cards in hand', () => {
  const handAfter = (upgraded: boolean, others: number) => {
    const d = world(['expertise', 'defend']);
    d.cards.defend!.keywords = [];
    const r = run(d, turnOne('expertise'), deckOf(['expertise', 1, upgraded], ['defend', others]));
    return events(turnOneLog(r), 'draw').length;
  };

  it('opening hand 5, Expertise played: 4 left + 2 drawn = 6 (the first 5 draws + 2)', () => {
    expect(handAfter(false, 20)).toBe(5 + 2);
  });

  it('upgraded draws up to 7', () => {
    expect(handAfter(true, 20)).toBe(5 + 3);
  });

  it('a hand already at 6+ draws nothing', () => {
    const d = world(['expertise', 'defend']);
    d.cards.defend!.keywords = [];
    const draw3 = helper('draw3', [{ type: 'draw', amount: 3 }]);
    d.cards.draw3 = draw3;
    const r = run(d, turnOne('draw3', 'expertise'), deckOf(['expertise', 1], ['draw3', 1], ['defend', 20]));
    // 5 opening + 3 from draw3 = 8 drawn; Expertise then finds 6+ in hand (5 - 1 + 3 = 7).
    expect(events(turnOneLog(r), 'draw').length).toBe(8);
  });

  it('stops when nothing is left to draw', () => {
    const d = world(['expertise']);
    const r = run(d, turnOne('expertise'), deckOf(['expertise', 1]));
    expect(events(turnOneLog(r), 'draw').length).toBe(1);
  });
});
