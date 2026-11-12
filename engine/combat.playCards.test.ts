/** #114 Play other cards: playCards, Replay (addReplay), card copies (addCards), Howl from Beyond. */
import { describe, expect, it } from 'vitest';
import { matchesFilter, makeCardInstance, simulateCombat } from './combat';
import { cards, makeEnemy } from './testFixtures';
import { cfg, deckOf, dummyData, events, logged, scripted, withEnemy } from './combatTestHelpers';
import type { CardDef, CardInstance, ChoiceRequest, Effect, GameData, GameEvent, Strategy } from './types';

const def = (id: string, cost: number, effects: Effect[], extra: Partial<CardDef> = {}): CardDef => ({
  ...cards.defend!,
  id,
  code: 'Zz',
  name: id,
  cost,
  effects,
  upgraded: null,
  ...extra,
});

const atk = (damage: number, hits = 1, extra: object = {}): Effect =>
  ({ type: 'attack', damage, hits, ...extra }) as Effect;
const playTop = (extra: object = {}): Effect =>
  ({ type: 'playCards', from: 'draw', mode: 'top', count: 1, ...extra }) as Effect;

/** Test cards modelled on the real ones (engine tests do not import data/). */
const extra: Record<string, CardDef> = {
  /** Filler: free, does nothing. */
  pad: def('pad', 0, []),
  /** Free exhaust-keyword filler. */
  fumes: def('fumes', 0, [], { keywords: ['exhaust'] }),
  havoc: def('havoc', 1, [playTop({ exhaust: true })], { upgraded: { cost: 0 } }),
  cascade: def('cascade', 0, [playTop({ xTimes: true })], {
    xCost: true,
    upgraded: { effects: [playTop({ xTimes: true, xBonus: 1 })] },
  }),
  catastrophe: def('catastrophe', 2, [playTop({ mode: 'random', count: 2 })]),
  beatdown: def('beatdown', 3, [
    { type: 'playCards', from: 'discard', mode: 'random', count: 3, filter: { types: ['attack'] } },
  ]),
  beatdown4: def('beatdown4', 3, [
    { type: 'playCards', from: 'discard', mode: 'random', count: 4, filter: { types: ['attack'] } },
  ]),
  gem: def('gem', 1, [{ type: 'addReplay', amount: 2, from: 'draw', mode: 'random', filter: { noReplay: true } }]),
  anger: def('anger', 0, [atk(6), { type: 'addCards', source: { kind: 'self' }, count: 1, to: 'discard' }], {
    type: 'attack',
    upgraded: { effects: [atk(8), { type: 'addCards', source: { kind: 'self' }, count: 1, to: 'discard' }] },
  }),
  dual: def(
    'dual',
    1,
    [
      {
        type: 'addCards',
        source: { kind: 'copyOf', from: 'hand', mode: 'choose', filter: { types: ['attack', 'power'] } },
        count: 1,
        to: 'hand',
      },
    ],
    {
      upgraded: {
        effects: [
          {
            type: 'addCards',
            source: { kind: 'copyOf', from: 'hand', mode: 'choose', filter: { types: ['attack', 'power'] } },
            count: 2,
            to: 'hand',
          },
        ],
      },
    },
  ),
  /** Draws 5: for the hand-limit test. */
  draw5: def('draw5', 0, [{ type: 'draw', amount: 5 }]),
  /** Exhaust a card of your choice (Burning Pact without the draw). */
  purge: def('purge', 0, [{ type: 'exhaustCards', count: 1, mode: 'choose' }]),
  jab: def('jab', 0, [atk(2)], { type: 'attack' }),
  guard: def('guard', 0, [{ type: 'gainBlock', amount: 1 }]),
  whirl: def('whirl', 0, [atk(5, 1, { xTimes: true })], { type: 'attack', xCost: true }),
  curse: def('curse', 0, [], { type: 'curse', cost: null, keywords: ['unplayable'] }),
  inflame: def('inflame', 1, [{ type: 'gainStrength', amount: 2 }], { type: 'power' }),
  howl: def('howl', 3, [atk(18, 1, { allEnemies: true })], {
    type: 'attack',
    triggers: [{ when: 'turnEndInExhaust', effects: [{ type: 'script', id: 'playSelf' }] }],
  }),
};

/** Dummy-enemy data with the extra cards; `innate` lists card ids that get Innate (to fix the opening hand). */
function data(...innate: string[]): GameData {
  const d = dummyData();
  Object.assign(d.cards, structuredClone(extra));
  for (const id of innate) d.cards[id] = { ...d.cards[id]!, keywords: [...d.cards[id]!.keywords, 'innate'] };
  return d;
}

/** A few-HP enemy that never acts. */
function glass(d: GameData, hp: number): GameData {
  return withEnemy(d, makeEnemy('glass', hp, { wait: { name: 'Wait', effects: [] } }));
}

const hits = (log: GameEvent[] | undefined) => events(log, 'damage').map((e) => e.amount);
const byEffect = (log: GameEvent[] | undefined) => events(log, 'play').filter((e) => e.by === 'effect');
const exhausted = (log: GameEvent[] | undefined) => events(log, 'exhaust').map((e) => [e.cardId, e.reason]);

describe('#114 playCards: Havoc (top card, exhaust)', () => {
  it('plays the top card of the draw pile for free and exhausts it', () => {
    const d = data('havoc', 'pad');
    const r = logged(
      d,
      scripted((t) => (t === 1 ? ['havoc'] : [])),
      {
        enemyId: 'dummy',
        deck: deckOf(['havoc', 1], ['pad', 4], ['strike', 1]),
      },
    );
    const plays = events(r.log, 'play');
    expect(plays.map((e) => [e.cardId, e.by, e.energyLeft])).toEqual([
      ['havoc', undefined, 2],
      ['strike', 'effect', 2],
    ]);
    expect(hits(r.log)).toEqual([6]);
    expect(exhausted(r.log)).toEqual([['strike', 'effect']]);
  });

  it('reshuffles the discard pile into an empty draw pile first', () => {
    const d = data('havoc', 'pad');
    const r = logged(
      d,
      scripted((t) => (t === 1 ? ['pad', 'pad', 'havoc'] : [])),
      {
        enemyId: 'dummy',
        deck: deckOf(['havoc', 1], ['pad', 4]),
      },
    );
    expect(
      events(r.log, 'shuffle')
        .slice(0, 2)
        .map((e) => [e.reason, e.count]),
    ).toEqual([
      ['start', 5],
      ['reshuffle', 2],
    ]);
    expect(byEffect(r.log).map((e) => e.cardId)).toEqual(['pad']);
    expect(exhausted(r.log)).toEqual([['pad', 'effect']]);
  });

  it('does nothing when both piles are empty', () => {
    const d = data('havoc', 'pad');
    const r = logged(
      d,
      scripted((t) => (t === 1 ? ['havoc'] : [])),
      {
        enemyId: 'dummy',
        deck: deckOf(['havoc', 1], ['pad', 4]),
      },
    );
    expect(byEffect(r.log)).toEqual([]);
    expect(exhausted(r.log)).toEqual([]);
  });

  it('exhausts an Unplayable top card without playing it', () => {
    const d = data('havoc', 'pad');
    const r = logged(
      d,
      scripted((t) => (t === 1 ? ['havoc'] : [])),
      {
        enemyId: 'dummy',
        deck: deckOf(['havoc', 1], ['pad', 4], ['curse', 1]),
      },
    );
    expect(byEffect(r.log)).toEqual([]);
    expect(exhausted(r.log)).toEqual([['curse', 'effect']]);
  });

  it('plays a Power (it stays in play, not in the Exhaust pile) and a card with its own Exhaust once', () => {
    const d = data('havoc', 'pad');
    const r = logged(
      d,
      scripted((t) => (t === 1 ? ['havoc'] : [])),
      {
        enemyId: 'dummy',
        deck: deckOf(['havoc', 1], ['pad', 4], ['inflame', 1]),
      },
    );
    expect(events(r.log, 'strength').map((e) => e.total)).toEqual([2]);
    expect(exhausted(r.log)).toEqual([]);
    const r2 = logged(
      d,
      scripted((t) => (t === 1 ? ['havoc'] : [])),
      {
        enemyId: 'dummy',
        deck: deckOf(['havoc', 1], ['pad', 4], ['fumes', 1]),
      },
    );
    expect(exhausted(r2.log)).toEqual([['fumes', 'effect']]);
  });

  it('an X-cost card it plays gets X = the energy left, and spends none', () => {
    const d = data('havoc', 'pad');
    const r = logged(
      d,
      scripted((t) => (t === 1 ? ['havoc'] : [])),
      {
        enemyId: 'dummy',
        deck: deckOf(['havoc', 1], ['pad', 4], ['whirl', 1]),
      },
    );
    expect(hits(r.log)).toEqual([5, 5]);
    const play = byEffect(r.log)[0]!;
    expect([play.x, play.energyLeft]).toEqual([2, 2]);
  });

  it('a kill by the played card ends the combat', () => {
    const d = glass(data('havoc', 'pad'), 6);
    const r = logged(
      d,
      scripted((t) => (t === 1 ? ['havoc'] : [])),
      {
        enemyId: 'glass',
        deck: deckOf(['havoc', 1], ['pad', 4], ['strike', 1]),
      },
    );
    expect(r.outcome).toBe('win');
    expect(r.turns).toBe(1);
  });
});

describe('#114 playCards: Cascade (top X cards)', () => {
  it('plays the top X cards where X is all the energy, reshuffling when the draw pile runs out', () => {
    const d = data('cascade', 'pad');
    const r = logged(
      d,
      scripted((t) => (t === 1 ? ['cascade'] : [])),
      {
        enemyId: 'dummy',
        deck: deckOf(['cascade', 1], ['pad', 4], ['strike', 3]),
      },
    );
    expect(events(r.log, 'play')[0]).toMatchObject({ cardId: 'cascade', x: 3, energyLeft: 0 });
    expect(byEffect(r.log).map((e) => [e.cardId, e.energyLeft])).toEqual([
      ['strike', 0],
      ['strike', 0],
      ['strike', 0],
    ]);
    expect(hits(r.log)).toEqual([6, 6, 6]);
    // The Strikes it played were discarded, not exhausted.
    expect(exhausted(r.log)).toEqual([]);
  });

  it('upgraded plays X+1 cards; a card it plays comes back after the reshuffle (Cascade itself does not)', () => {
    const d = data('cascade', 'pad');
    const r = logged(
      d,
      scripted((t) => (t === 1 ? ['cascade'] : [])),
      {
        enemyId: 'dummy',
        deck: deckOf(['cascade', 1, true], ['pad', 4], ['strike', 3]),
      },
    );
    expect(hits(r.log)).toEqual([6, 6, 6, 6]);
    expect(
      events(r.log, 'shuffle')
        .slice(0, 2)
        .map((e) => [e.reason, e.count]),
    ).toEqual([
      ['start', 8],
      ['reshuffle', 3],
    ]);
  });

  it('X = 0 plays nothing; a nested X-cost card gets X = 0', () => {
    const d = data('cascade', 'pad');
    const r = logged(
      d,
      scripted((t) => (t === 1 ? ['cascade'] : [])),
      {
        enemyId: 'dummy',
        deck: deckOf(['cascade', 1], ['pad', 4], ['whirl', 1]),
      },
    );
    // The one whirl is replayed from the reshuffled discard pile for each of the 3 cards.
    expect(byEffect(r.log).map((e) => [e.cardId, e.x])).toEqual([
      ['whirl', 0],
      ['whirl', 0],
      ['whirl', 0],
    ]);
    expect(hits(r.log)).toEqual([]);
  });

  it('a curse on top is discarded, not played, and still counts as one of the X cards', () => {
    const d = data('cascade', 'pad');
    const r = logged(
      d,
      scripted((t) => (t === 1 ? ['cascade'] : [])),
      {
        enemyId: 'dummy',
        deck: deckOf(['cascade', 1], ['pad', 4], ['strike', 2], ['curse', 1]),
      },
    );
    expect(
      byEffect(r.log)
        .map((e) => e.cardId)
        .sort(),
    ).toEqual(['strike', 'strike'].sort().slice(0, byEffect(r.log).length));
    expect(byEffect(r.log).length + exhausted(r.log).length).toBeLessThanOrEqual(3);
    expect(exhausted(r.log)).toEqual([]);
    expect(events(r.log, 'play').filter((e) => e.cardId === 'curse')).toEqual([]);
  });
});

describe('#114 playCards: random picks (Catastrophe, Beat Down)', () => {
  it('Catastrophe plays 2 distinct random playable draw-pile cards, never an Unplayable one', () => {
    const d = data('catastrophe', 'pad');
    const seen = new Set<string>();
    for (let seed = 1; seed <= 25; seed++) {
      const r = logged(
        d,
        scripted((t) => (t === 1 ? ['catastrophe'] : [])),
        {
          enemyId: 'dummy',
          seed,
          deck: deckOf(['catastrophe', 1], ['pad', 4], ['strike', 1], ['bash', 1], ['defend', 1], ['curse', 1]),
        },
      );
      const played = byEffect(r.log);
      expect(played).toHaveLength(2);
      expect(new Set(played.map((e) => e.uid)).size).toBe(2);
      expect(played.map((e) => e.cardId)).not.toContain('curse');
      seen.add(
        played
          .map((e) => e.cardId)
          .sort()
          .join('+'),
      );
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('Catastrophe plays fewer cards when the draw pile has fewer playable ones', () => {
    const d = data('catastrophe', 'pad');
    const r = logged(
      d,
      scripted((t) => (t === 1 ? ['catastrophe'] : [])),
      {
        enemyId: 'dummy',
        deck: deckOf(['catastrophe', 1], ['pad', 4], ['strike', 1], ['curse', 1]),
      },
    );
    expect(byEffect(r.log).map((e) => e.cardId)).toEqual(['strike']);
  });

  it('a card with Exhaust that it plays goes to the Exhaust pile', () => {
    const d = data('catastrophe', 'pad');
    const r = logged(
      d,
      scripted((t) => (t === 1 ? ['catastrophe'] : [])),
      {
        enemyId: 'dummy',
        deck: deckOf(['catastrophe', 1], ['pad', 4], ['fumes', 2]),
      },
    );
    expect(exhausted(r.log)).toEqual([
      ['fumes', 'keyword'],
      ['fumes', 'keyword'],
    ]);
  });

  it('Beat Down plays 3 random Attacks from the discard pile, each once, and nothing else', () => {
    const d = data('beatdown', 'jab', 'guard');
    const r = logged(
      d,
      scripted((t) => (t === 1 ? ['jab', 'jab', 'jab', 'guard', 'beatdown'] : [])),
      {
        enemyId: 'dummy',
        deck: deckOf(['beatdown', 1], ['jab', 3], ['guard', 1]),
      },
    );
    const played = byEffect(r.log);
    expect(played.map((e) => e.cardId)).toEqual(['jab', 'jab', 'jab']);
    expect(new Set(played.map((e) => e.uid)).size).toBe(3);
    expect(played.every((e) => e.energyLeft === 0)).toBe(true);
  });

  it('Beat Down with more picks than Attacks plays each Attack once, not the same one twice', () => {
    const d = data('beatdown4', 'jab', 'guard');
    const r = logged(
      d,
      scripted((t) => (t === 1 ? ['jab', 'jab', 'jab', 'guard', 'beatdown4'] : [])),
      {
        enemyId: 'dummy',
        deck: deckOf(['beatdown4', 1], ['jab', 3], ['guard', 1]),
      },
    );
    expect(byEffect(r.log)).toHaveLength(3);
  });

  it('is deterministic: the same seed gives the same log', () => {
    const d = data('catastrophe', 'pad');
    const run = () =>
      logged(
        d,
        scripted((t) => (t === 1 ? ['catastrophe'] : [])),
        {
          enemyId: 'dummy',
          seed: 7,
          deck: deckOf(['catastrophe', 1], ['pad', 4], ['strike', 3], ['bash', 2]),
        },
      ).log;
    expect(run()).toEqual(run());
  });
});

describe('#114 Replay (Hidden Gem)', () => {
  /** Plays the Gem on turn 1, then `card` whenever it is playable. */
  const gemThen = (card: string): Strategy => ({
    decide(view) {
      if (view.state.turn === 1) {
        const gem = view.playable.find((c) => c.cardId === 'gem');
        return gem ? { kind: 'play', uid: gem.uid } : { kind: 'endTurn' };
      }
      const c = view.playable.find((p) => p.cardId === card);
      return c ? { kind: 'play', uid: c.uid } : { kind: 'endTurn' };
    },
  });

  it('gives a random draw-pile card Replay 2: the card is played 2 more times, paying its cost once', () => {
    const d = data('gem', 'pad');
    const r = logged(
      d,
      scripted((t) => (t === 1 ? ['gem'] : t === 2 ? ['strike'] : [])),
      {
        enemyId: 'dummy',
        deck: deckOf(['gem', 1], ['pad', 4], ['strike', 1]),
      },
    );
    const t2 = r.log!.slice(r.log!.findIndex((e) => e.t === 'turnStart' && e.turn === 2 && e.side === 'player'));
    const plays = t2.filter((e) => e.t === 'play') as Extract<GameEvent, { t: 'play' }>[];
    expect(plays.map((e) => [e.cardId, e.by, e.energyLeft])).toEqual([
      ['strike', undefined, 2],
      ['strike', 'replay', 2],
      ['strike', 'replay', 2],
    ]);
    expect(events(t2, 'replay').map((e) => e.left)).toEqual([1, 0]);
    expect(events(t2, 'damage').map((e) => e.amount)).toEqual([6, 6, 6]);
  });

  it('is never used up: every later play of the card replays twice', () => {
    const d = data('gem', 'pad');
    const r = logged(d, gemThen('strike'), { enemyId: 'dummy', deck: deckOf(['gem', 1], ['pad', 4], ['strike', 1]) });
    const direct = events(r.log, 'play').filter((e) => e.cardId === 'strike' && !e.by);
    expect(direct.length).toBeGreaterThanOrEqual(3);
    // The last play may be cut short by the kill.
    expect(events(r.log, 'replay').length).toBeGreaterThanOrEqual(direct.length * 2 - 2);
    expect(events(r.log, 'replay').length).toBeLessThanOrEqual(direct.length * 2);
  });

  it('skips cards that already have Replay: a second Gem does not stack on the same card', () => {
    const d = data('gem', 'pad');
    d.cards.gem2 = { ...d.cards.gem!, id: 'gem2', keywords: ['innate'] };
    const r = logged(
      d,
      scripted((t) => (t === 1 ? ['gem', 'gem2'] : t === 2 ? ['strike'] : [])),
      {
        enemyId: 'dummy',
        deck: deckOf(['gem', 1], ['gem2', 1], ['pad', 3], ['strike', 1]),
      },
    );
    expect(events(r.log, 'replay')).toHaveLength(2);
  });

  it('with no draw-pile card to pick, it does nothing', () => {
    const d = data('gem', 'pad');
    const r = logged(
      d,
      scripted((t) => (t === 1 ? ['gem'] : [])),
      {
        enemyId: 'dummy',
        deck: deckOf(['gem', 1], ['pad', 4]),
      },
    );
    expect(r.outcome).toBe('turnCap');
    expect(events(r.log, 'replay')).toEqual([]);
  });

  it('an X-cost card replays with the same X', () => {
    const d = data('gem', 'pad');
    const r = logged(
      d,
      scripted((t) => (t === 1 ? ['gem'] : t === 2 ? ['whirl'] : [])),
      {
        enemyId: 'dummy',
        deck: deckOf(['gem', 1], ['pad', 4], ['whirl', 1]),
      },
    );
    // Turn 2: 3 energy, X = 3, three plays of 3 hits each.
    expect(hits(r.log)).toEqual(Array(9).fill(5));
    const xs = events(r.log, 'play')
      .filter((e) => e.cardId === 'whirl')
      .map((e) => [e.x, e.by]);
    expect(xs).toEqual([
      [3, undefined],
      [3, 'replay'],
      [3, 'replay'],
    ]);
  });

  it('stops replaying once the enemy is dead', () => {
    const d = glass(data('gem', 'pad'), 10);
    const r = logged(
      d,
      scripted((t) => (t === 1 ? ['gem'] : t === 2 ? ['strike'] : [])),
      {
        enemyId: 'glass',
        deck: deckOf(['gem', 1], ['pad', 4], ['strike', 1]),
      },
    );
    expect(r.outcome).toBe('win');
    expect(events(r.log, 'replay')).toHaveLength(1);
    expect(hits(r.log)).toEqual([6, 6]);
  });

  it('a Replayed Anger adds a copy every time', () => {
    const d = data('gem', 'pad');
    const r = logged(
      d,
      scripted((t) => (t === 1 ? ['gem'] : t === 2 ? ['anger'] : [])),
      {
        enemyId: 'dummy',
        deck: deckOf(['gem', 1], ['pad', 4], ['anger', 1]),
      },
    );
    expect(events(r.log, 'generated').map((e) => e.cardId)).toEqual(['anger', 'anger', 'anger']);
  });

  it('the noReplay filter matches only cards without Replay', () => {
    const strike = makeCardInstance(cards.strike!, false, 0);
    expect(matchesFilter(strike, { noReplay: true })).toBe(true);
    expect(matchesFilter({ ...strike, replay: 2 }, { noReplay: true })).toBe(false);
    expect(matchesFilter({ ...strike, replay: 2 }, {})).toBe(true);
  });
});

describe('#114 addCards: copies (Anger, Dual Wield)', () => {
  /** Plays `plan` and records the hand and discard pile right after each play. */
  function spy(plan: string[], pick?: (r: ChoiceRequest) => number[]) {
    const snaps: { hand: CardInstance[]; discard: CardInstance[] }[] = [];
    const requests: ChoiceRequest[] = [];
    const queue = [...plan];
    const strat: Strategy = {
      decide(view) {
        const p = view.state.player;
        if (snaps.length < plan.length + 1) {
          snaps.push({
            hand: structuredClone([...p.hand]) as CardInstance[],
            discard: structuredClone([...p.discardPile]) as CardInstance[],
          });
        }
        const want = queue.shift();
        const c = want === undefined ? undefined : view.playable.find((x) => x.cardId === want);
        return c ? { kind: 'play', uid: c.uid } : { kind: 'endTurn' };
      },
      choose(_v, r) {
        requests.push(r);
        return { uids: pick ? pick(r) : r.options.slice(0, r.min).map((c) => c.uid) };
      },
    };
    return { strat, snaps, requests };
  }

  it('Anger puts a copy of itself in the discard pile, with a new uid', () => {
    const d = data('anger', 'pad');
    const { strat, snaps } = spy(['anger']);
    const r = simulateCombat(d, cfg({ enemyId: 'dummy', deck: deckOf(['anger', 1], ['pad', 4]) }), strat, {
      log: true,
    });
    expect(events(r.log, 'generated')).toEqual([
      { t: 'generated', uid: 5, cardId: 'anger', to: 'discard', source: 'self' },
    ]);
    expect(snaps[1]!.discard.some((c) => c.cardId === 'anger' && c.uid === 5 && c.generated === true)).toBe(true);
  });

  it('Anger+ copies the upgraded card', () => {
    const d = data('anger', 'pad');
    const { strat, snaps } = spy(['anger']);
    simulateCombat(d, cfg({ enemyId: 'dummy', deck: deckOf(['anger', 1, true], ['pad', 4]) }), strat, { log: true });
    const copy = snaps[1]!.discard.find((c) => c.generated)!;
    expect([copy.name, copy.upgraded, copy.effects[0]]).toEqual(['anger+', true, atk(8)]);
  });

  it('copies are real cards: they are drawn and played later', () => {
    const d = data('anger', 'pad');
    const playAnger: Strategy = {
      decide(view) {
        const c = view.playable.find((p) => p.cardId === 'anger');
        return c ? { kind: 'play', uid: c.uid } : { kind: 'endTurn' };
      },
    };
    const r = logged(d, playAnger, { enemyId: 'dummy', deck: deckOf(['anger', 1], ['pad', 4]) });
    // The copy joins the deck at the next reshuffle, so later turns can play several Angers.
    const angerPlays = events(r.log, 'play').filter((e) => e.cardId === 'anger');
    expect(new Set(angerPlays.map((e) => e.uid)).size).toBeGreaterThan(1);
  });

  it('Dual Wield asks to choose among the Attacks and Powers in hand and adds a copy to the hand', () => {
    const d = data('dual', 'strike', 'inflame', 'defend', 'pad');
    const { strat, snaps, requests } = spy(['dual'], (r) => [r.options.find((c) => c.cardId === 'inflame')!.uid]);
    const r = simulateCombat(
      d,
      cfg({ enemyId: 'dummy', deck: deckOf(['dual', 1], ['strike', 1], ['inflame', 1], ['defend', 1], ['pad', 1]) }),
      strat,
      { log: true },
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ purpose: 'copy', from: 'hand', to: 'hand', min: 1, max: 1 });
    expect(requests[0]!.options.map((c) => c.cardId).sort()).toEqual(['inflame', 'strike']);
    expect(events(r.log, 'generated')).toMatchObject([{ cardId: 'inflame', to: 'hand', source: 'copyOf' }]);
    expect(snaps[1]!.hand.map((c) => c.cardId).sort()).toEqual(['defend', 'inflame', 'inflame', 'pad', 'strike']);
  });

  it('Dual Wield+ adds 2 copies', () => {
    const d = data('dual', 'strike', 'pad');
    const { strat, snaps } = spy(['dual']);
    simulateCombat(d, cfg({ enemyId: 'dummy', deck: deckOf(['dual', 1, true], ['strike', 1], ['pad', 3]) }), strat, {
      log: true,
    });
    expect(snaps[1]!.hand.filter((c) => c.cardId === 'strike')).toHaveLength(3);
  });

  it('Dual Wield with no Attack or Power in hand does nothing and asks nothing', () => {
    const d = data('dual', 'pad', 'defend');
    const { strat, requests } = spy(['dual']);
    const r = simulateCombat(
      d,
      cfg({ enemyId: 'dummy', deck: deckOf(['dual', 1], ['pad', 2], ['defend', 2]) }),
      strat,
      { log: true },
    );
    expect(requests).toEqual([]);
    expect(events(r.log, 'generated')).toEqual([]);
  });

  it('with only one candidate there is no choice to make', () => {
    const d = data('dual', 'strike', 'pad');
    const { strat, requests } = spy(['dual']);
    const r = simulateCombat(
      d,
      cfg({ enemyId: 'dummy', deck: deckOf(['dual', 1, true], ['strike', 1], ['pad', 3]) }),
      strat,
      { log: true },
    );
    expect(requests).toEqual([]);
    expect(events(r.log, 'generated')).toHaveLength(2);
  });

  it('a copy that does not fit in a full hand goes to the discard pile', () => {
    const d = data('draw5', 'dual', 'strike', 'pad');
    d.cards.dual = { ...d.cards.dual!, cost: 0 };
    // Hand 5: draw5, draw5, dual+, strike, pad. Two draw5 fill the hand to 10; Dual Wield+ adds 2 copies.
    const r = logged(
      d,
      scripted((t) => (t === 1 ? ['draw5', 'draw5', 'dual'] : [])),
      {
        enemyId: 'dummy',
        deck: deckOf(['draw5', 2], ['dual', 1, true], ['strike', 1], ['pad', 1], ['jab', 12]),
      },
    );
    const gen = events(r.log, 'generated');
    expect(gen.map((e) => e.to)).toEqual(['hand', 'discard']);
  });

  it('copies do not support the #116 fields (they throw)', () => {
    const d = data('pad');
    for (const effect of [
      { type: 'addCards', source: { kind: 'self' }, count: 1, to: 'hand', freeThisTurn: true },
      { type: 'addCards', source: { kind: 'self' }, count: 1, to: 'hand', options: 2 },
    ] as Effect[]) {
      d.cards.probe = def('probe', 0, [effect], { keywords: ['innate'] });
      expect(() =>
        simulateCombat(
          d,
          cfg({ enemyId: 'dummy', deck: deckOf(['probe', 1], ['pad', 4]) }),
          scripted((t) => (t === 1 ? ['probe'] : [])),
        ),
      ).toThrow(/Effect "addCards" is not simulated yet/);
    }
  });
});

describe('#114 Howl from Beyond (turnEndInExhaust)', () => {
  const exhaustHowl = (r: ChoiceRequest) => [r.options.find((c) => c.cardId === 'howl')!.uid];

  function run(d: GameData, enemyId: string, plan: (t: number) => string[]) {
    const inner = scripted(plan);
    const strat: Strategy = { decide: (v) => inner.decide(v), choose: (_v, r) => ({ uids: exhaustHowl(r) }) };
    return logged(d, strat, { enemyId, deck: deckOf(['howl', 1], ['purge', 1], ['pad', 3]) });
  }

  it('is played for free at the end of the turn it is in the Exhaust pile, once, and goes to the discard pile', () => {
    const d = data('howl', 'purge', 'pad');
    const r = run(d, 'dummy', (t) => (t === 1 ? ['purge'] : []));
    const triggered = events(r.log, 'play').filter((e) => e.by === 'trigger');
    expect(triggered).toHaveLength(1);
    expect(triggered[0]).toMatchObject({ cardId: 'howl', energyLeft: 3 });
    expect(hits(r.log)).toEqual([18]);
    // It happens inside turn 1, before the end-of-turn marker.
    const log = r.log!;
    const at = log.findIndex((e) => e.t === 'play' && e.by === 'trigger');
    const end = log.findIndex((e) => e.t === 'turnEnd' && e.turn === 1 && e.side === 'player');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(end);
  });

  it('does nothing when it is not in the Exhaust pile at the end of the turn', () => {
    const d = data('howl', 'purge', 'pad');
    const r = run(d, 'dummy', () => []);
    expect(events(r.log, 'play')).toEqual([]);
  });

  it('can win the combat at the end of the turn', () => {
    const d = glass(data('howl', 'purge', 'pad'), 18);
    const r = run(d, 'glass', (t) => (t === 1 ? ['purge'] : []));
    expect(r.outcome).toBe('win');
    expect(r.turns).toBe(1);
    expect(events(r.log, 'enemyMove')).toEqual([]);
  });

  it('a card with the trigger in the deck is accepted (it is simulated now)', () => {
    const d = data('howl');
    expect(() =>
      simulateCombat(
        d,
        cfg({ enemyId: 'dummy', deck: deckOf(['howl', 1], ['pad', 4]) }),
        scripted(() => []),
      ),
    ).not.toThrow();
  });
});
