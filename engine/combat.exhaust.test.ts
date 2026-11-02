/** #108 Exhaust: engine rules (exhaustCards, Drum of Battle's trigger, Second Wind, Fiend Fire, Thrash). */
import { describe, expect, it } from 'vitest';
import { makeCardInstance, perHitBaseDamage, runCombat, simulateCombat } from './combat';
import { cards } from './testFixtures';
import { cfg, deckOf, dummyData, events, logged, scripted } from './combatTestHelpers';
import type { CardDef, ChoiceRequest, CombatCounters, Effect, GameData, GameEvent, Strategy } from './types';
import { GREEDY_CONFIG, blockFirstConfig } from './strategies';

const skill = (id: string, code: string, effects: Effect[], extra: Partial<CardDef> = {}): CardDef => ({
  ...cards.defend!,
  id,
  code,
  name: id,
  cost: 0,
  effects,
  upgraded: null,
  ...extra,
});

/** Test cards modelled on the real ones (engine tests do not import data/). */
const extra: Record<string, CardDef> = {
  pact: skill('pact', 'BP', [
    { type: 'exhaustCards', count: 1, mode: 'choose' },
    { type: 'draw', amount: 2 },
  ]),
  brand: skill('brand', 'Bx', [
    { type: 'loseHp', amount: 1 },
    { type: 'exhaustCards', count: 1, mode: 'choose' },
    { type: 'gainStrength', amount: 1 },
  ]),
  grit: skill('grit', 'Tj', [
    { type: 'gainBlock', amount: 7 },
    { type: 'exhaustCards', count: 1, mode: 'random' },
  ]),
  purity: skill('purity', 'P0', [{ type: 'exhaustCards', count: 3, mode: 'choose', upTo: true }], {
    keywords: ['retain', 'exhaust'],
  }),
  wind: skill('wind', 'SW', [
    { type: 'exhaustCards', mode: 'all', filter: { notTypes: ['attack'] } },
    { type: 'repeat', per: 'lastEffectCount', effects: [{ type: 'gainBlock', amount: 5 }] },
  ]),
  /** A card whose repeat does not follow the exhaust: lastEffectCount is 0 by then. */
  late: skill('late', 'Lt', [
    { type: 'exhaustCards', mode: 'all', filter: { notTypes: ['attack'] } },
    { type: 'gainStrength', amount: 1 },
    { type: 'repeat', per: 'lastEffectCount', effects: [{ type: 'gainBlock', amount: 5 }] },
  ]),
  drum: skill('drum', 'DO', [{ type: 'draw', amount: 2 }], {
    cost: 1,
    triggers: [{ when: 'exhausted', effects: [{ type: 'gainEnergy', amount: 2 }] }],
    upgraded: { triggers: [{ when: 'exhausted', effects: [{ type: 'gainEnergy', amount: 3 }] }] },
  }),
  fiend: {
    ...cards.strike!,
    id: 'fiend',
    code: 'Fi',
    cost: 0,
    keywords: ['exhaust'],
    effects: [{ type: 'script', id: 'fiendFire', values: [7] }],
    upgraded: null,
  },
  thrash: {
    ...cards.strike!,
    id: 'thrash',
    code: 'Tb',
    cost: 0,
    effects: [
      { type: 'attack', damage: 4, hits: 2 },
      { type: 'script', id: 'thrash' },
    ],
    upgraded: null,
  },
  twin: {
    ...cards.strike!,
    id: 'twin',
    code: 'TS',
    effects: [{ type: 'attack', damage: 5, hits: 2 }],
    upgraded: null,
  },
};

/** Dummy-enemy data with the extra cards; `innate` lists card ids that get Innate (to fix the opening hand). */
function data(...innate: string[]): GameData {
  const d = dummyData();
  Object.assign(d.cards, structuredClone(extra));
  for (const id of innate) d.cards[id] = { ...d.cards[id]!, keywords: [...d.cards[id]!.keywords, 'innate'] };
  return d;
}

function turnEvents(log: GameEvent[], turn: number): GameEvent[] {
  const start = log.findIndex((e) => e.t === 'turnStart' && e.turn === turn && e.side === 'player');
  const end = log.findIndex((e) => e.t === 'turnEnd' && e.turn === turn && e.side === 'player');
  return log.slice(start, end + 1);
}

/** Scripted plays plus a recorded `choose` that answers with `pick` (or the first `min` options). */
function chooser(plan: (turn: number) => string[], pick?: (r: ChoiceRequest) => number[]) {
  const requests: ChoiceRequest[] = [];
  const inner = scripted(plan);
  const counters: CombatCounters[] = [];
  const strat: Strategy = {
    decide(v) {
      counters.push({ ...(v.state.player.counters as CombatCounters) });
      return inner.decide(v);
    },
    choose(_v, r) {
      requests.push(r);
      return { uids: pick ? pick(r) : r.options.slice(0, r.min).map((c) => c.uid) };
    },
  };
  return { strat, requests, counters };
}

const exhausted = (log: GameEvent[] | undefined) => events(log, 'exhaust').map((e) => [e.cardId, e.reason]);

describe('#108 exhaustCards', () => {
  it('"choose" asks Strategy.choose with the hand (not the played card) and exhausts its pick', () => {
    const d = data('pact', 'bash');
    const { strat, requests } = chooser(
      (t) => (t === 1 ? ['pact'] : []),
      (r) => [r.options.find((c) => c.cardId === 'bash')!.uid],
    );
    const r = logged(d, strat, { enemyId: 'dummy', deck: deckOf(['pact', 1], ['bash', 1], ['strike', 10]) });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ purpose: 'exhaust', from: 'hand', to: 'exhaust', min: 1, max: 1 });
    expect(requests[0]!.sourceCardId).toBe('pact');
    expect(requests[0]!.options.map((c) => c.cardId)).not.toContain('pact');
    expect(requests[0]!.options).toHaveLength(4);
    const t1 = turnEvents(r.log!, 1);
    const play = t1.findIndex((e) => e.t === 'play');
    // Burning Pact: exhaust first, then draw 2.
    expect(t1.slice(play + 1, play + 4).map((e) => e.t)).toEqual(['exhaust', 'draw', 'draw']);
    expect(exhausted(r.log)[0]).toEqual(['bash', 'effect']);
  });

  it('a strategy without choose gets the shared exhaust order (Strike before Bash)', () => {
    const d = data('pact', 'bash', 'strike');
    const r = logged(
      d,
      scripted((t) => (t === 1 ? ['pact'] : [])),
      {
        enemyId: 'dummy',
        deck: deckOf(['pact', 1], ['bash', 1], ['strike', 3], ['defend', 5]),
      },
    );
    expect(exhausted(r.log)[0]).toEqual(['strike', 'effect']);
  });

  it('no choice is asked when every candidate must go, or when there is nothing to exhaust', () => {
    const d = data('pact');
    const { strat, requests } = chooser((t) => (t === 1 ? ['pact'] : []));
    // Hand: 2 Burning Pacts only (deck of 2): the first must exhaust the second, with no choice asked.
    const r = logged(d, strat, { enemyId: 'dummy', deck: deckOf(['pact', 2]) });
    expect(requests).toHaveLength(0);
    expect(exhausted(r.log)[0]).toEqual(['pact', 'effect']);
  });

  it('an illegal choice (too many, unknown uid or duplicate) throws', () => {
    for (const pick of [
      (r: ChoiceRequest) => r.options.slice(0, 2).map((c) => c.uid),
      () => [999],
      (r: ChoiceRequest) => [r.options[0]!.uid, r.options[0]!.uid],
      () => [],
    ]) {
      const { strat } = chooser((t) => (t === 1 ? ['pact'] : []), pick);
      expect(() =>
        simulateCombat(data('pact'), cfg({ enemyId: 'dummy', deck: deckOf(['pact', 1], ['strike', 10]) }), strat),
      ).toThrow(/illegal exhaust choice/);
    }
  });

  it('Brand: lose 1 HP, exhaust 1, gain Strength, in that order', () => {
    const d = data('brand');
    const r = logged(
      d,
      scripted((t) => (t === 1 ? ['brand'] : [])),
      { enemyId: 'dummy', deck: deckOf(['brand', 1], ['strike', 10]) },
    );
    const t1 = turnEvents(r.log!, 1);
    const play = t1.findIndex((e) => e.t === 'play');
    expect(t1.slice(play + 1, play + 4).map((e) => e.t)).toEqual(['loseHp', 'exhaust', 'strength']);
  });

  it('"random" (True Grit) exhausts one random card from the hand through the seeded Rng', () => {
    const d = data('grit');
    const seen = new Set<string>();
    for (let seed = 0; seed < 30; seed++) {
      const config = cfg({
        enemyId: 'dummy',
        seed,
        deck: deckOf(['grit', 1], ['strike', 2], ['defend', 2], ['bash', 1]),
      });
      const strat = () => scripted((t) => (t === 1 ? ['grit'] : []));
      const r = simulateCombat(d, config, strat(), { log: true });
      expect(simulateCombat(d, config, strat(), { log: true })).toEqual(r);
      const t1 = turnEvents(r.log!, 1).filter((e) => e.t === 'exhaust');
      expect(t1).toHaveLength(1);
      seen.add((t1[0] as { cardId: string }).cardId);
    }
    // Over 30 seeds every kind of card in hand gets picked at some point; never True Grit itself.
    expect([...seen].sort()).toEqual(['bash', 'defend', 'strike']);
  });

  it('Purity ("up to 3") may exhaust fewer: the choice allows 0 to 3', () => {
    const d = data('purity');
    const { strat, requests } = chooser(
      (t) => (t === 1 ? ['purity'] : []),
      () => [],
    );
    const r = logged(d, strat, { enemyId: 'dummy', deck: deckOf(['purity', 1], ['strike', 10]) });
    expect(requests[0]).toMatchObject({ min: 0, max: 3 });
    // Only Purity itself (keyword) is exhausted.
    expect(exhausted(r.log)).toEqual([['purity', 'keyword']]);
  });

  it('counters: every exhaust counts (effect and keyword); "this turn" resets at turn start', () => {
    const d = data('pact', 'purity');
    const { strat, counters } = chooser(
      (t) => (t === 1 ? ['pact', 'purity'] : []),
      (r) =>
        r.options
          .filter((c) => c.cardId === 'strike')
          .slice(0, r.min)
          .map((c) => c.uid),
    );
    logged(d, strat, { enemyId: 'dummy', deck: deckOf(['pact', 1], ['purity', 1], ['strike', 20]) });
    // Decisions on turn 1: before Pact, after Pact (1), after Purity (Purity exhausts 0 + itself: 2).
    expect(counters.slice(0, 3).map((c) => [c.cardsExhaustedThisTurn, c.cardsExhaustedThisCombat])).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
    ]);
    expect(counters[3]).toMatchObject({ cardsExhaustedThisTurn: 0, cardsExhaustedThisCombat: 2 });
  });
});

describe('#108 Drum of Battle (when exhausted)', () => {
  it('gains 2 energy when exhausted (3 upgraded); playing it only draws', () => {
    for (const [upgraded, gain] of [
      [false, 2],
      [true, 3],
    ] as const) {
      const d = data('pact', 'drum');
      const r = logged(
        d,
        scripted((t) => (t === 1 ? ['pact'] : [])),
        {
          enemyId: 'dummy',
          deck: [...deckOf(['pact', 1], ['strike', 10]), { cardId: 'drum', upgraded, count: 1 }],
        },
      );
      const t1 = turnEvents(r.log!, 1);
      const ex = t1.findIndex((e) => e.t === 'exhaust');
      expect(t1[ex]).toMatchObject({ cardId: 'drum', reason: 'effect' });
      // Energy 3, Burning Pact costs 0, so 3 + gain.
      expect(t1[ex + 1]).toEqual({ t: 'energy', amount: gain, total: 3 + gain });
    }
    const d = data('drum');
    const r = logged(
      d,
      scripted((t) => (t === 1 ? ['drum'] : [])),
      { enemyId: 'dummy', deck: deckOf(['drum', 1], ['strike', 10]) },
    );
    expect(events(r.log, 'energy')).toHaveLength(0);
  });

  it('upgrade replaces the trigger list on the card instance', () => {
    const d = data();
    expect(makeCardInstance(d.cards.drum!, false, 0).triggers).toEqual([
      { when: 'exhausted', effects: [{ type: 'gainEnergy', amount: 2 }] },
    ]);
    expect(makeCardInstance(d.cards.drum!, true, 0).triggers).toEqual([
      { when: 'exhausted', effects: [{ type: 'gainEnergy', amount: 3 }] },
    ]);
  });

  it('a deck card with a trigger the engine does not run yet throws', () => {
    const d = data();
    d.cards.howl = { ...cards.strike!, id: 'howl', triggers: [{ when: 'turnEndInExhaust', effects: [] }] };
    expect(() =>
      simulateCombat(
        d,
        cfg({ deck: deckOf(['howl', 1]) }),
        scripted(() => []),
      ),
    ).toThrow(/trigger "turnEndInExhaust" is not simulated yet/);
  });
});

describe('#108 Second Wind', () => {
  it('exhausts every non-Attack in hand and gains 5 Block per card, as separate gains', () => {
    const d = data('wind', 'defend', 'bash');
    const r = logged(
      d,
      scripted((t) => (t === 1 ? ['wind'] : [])),
      {
        enemyId: 'dummy',
        deck: deckOf(['wind', 1], ['defend', 3], ['bash', 1], ['strike', 5]),
      },
    );
    const t1 = turnEvents(r.log!, 1);
    expect(t1.filter((e) => e.t === 'exhaust').map((e) => (e as { cardId: string }).cardId)).toEqual([
      'defend',
      'defend',
      'defend',
    ]);
    expect(t1.filter((e) => e.t === 'block')).toEqual([
      { t: 'block', side: 'player', amount: 5, total: 5 },
      { t: 'block', side: 'player', amount: 5, total: 10 },
      { t: 'block', side: 'player', amount: 5, total: 15 },
    ]);
  });

  it('with nothing to exhaust it gains no Block', () => {
    const d = data('wind', 'strike');
    const r = logged(
      d,
      scripted((t) => (t === 1 ? ['wind'] : [])),
      { enemyId: 'dummy', deck: deckOf(['wind', 1], ['strike', 6]) },
    );
    expect(turnEvents(r.log!, 1).filter((e) => e.t === 'block')).toHaveLength(0);
  });

  it('lastEffectCount is the count of the effect right before; any other effect in between resets it to 0', () => {
    const d = data('late', 'defend');
    const r = logged(
      d,
      scripted((t) => (t === 1 ? ['late'] : [])),
      { enemyId: 'dummy', deck: deckOf(['late', 1], ['defend', 6]) },
    );
    const t1 = turnEvents(r.log!, 1);
    expect(t1.filter((e) => e.t === 'exhaust')).toHaveLength(4);
    expect(t1.filter((e) => e.t === 'block')).toHaveLength(0);
  });

  it('repeat with a counter other than lastEffectCount is not simulated yet', () => {
    const d = data();
    d.cards.probe = skill('probe', 'Pr', [
      { type: 'repeat', per: 'handSize', effects: [{ type: 'gainBlock', amount: 1 }] },
    ]);
    expect(() =>
      simulateCombat(
        d,
        cfg({ deck: deckOf(['probe', 5]) }),
        scripted((t) => (t === 1 ? ['probe'] : [])),
      ),
    ).toThrow(/Effect "repeat" is not simulated yet \(counter "handSize"\)/);
  });
});

describe('#108 Fiend Fire', () => {
  it('exhausts the rest of the hand and hits 7 once per OTHER card exhausted; itself exhausts by keyword', () => {
    const d = data('fiend', 'brand');
    const r = logged(
      d,
      scripted((t) => (t === 1 ? ['brand', 'fiend'] : [])),
      {
        enemyId: 'dummy',
        deck: deckOf(['fiend', 1], ['brand', 1], ['defend', 3], ['strike', 3]),
      },
    );
    const t1 = turnEvents(r.log!, 1);
    const play = t1.map((e) => e.t).lastIndexOf('play');
    const after = t1.slice(play + 1);
    // Brand exhausted 1 of the 3 others; Fiend Fire exhausts the 2 left, then 2 hits of 7 + 1 Strength.
    expect(after.filter((e) => e.t === 'exhaust').map((e) => (e as { reason: string }).reason)).toEqual([
      'effect',
      'effect',
      'keyword',
    ]);
    expect(after.filter((e) => e.t === 'damage')).toEqual([
      { t: 'damage', source: 'player', target: 'enemy', amount: 8, blocked: 0, hpLoss: 8 },
      { t: 'damage', source: 'player', target: 'enemy', amount: 8, blocked: 0, hpLoss: 8 },
    ]);
  });

  it('with an empty hand it deals no damage', () => {
    const d = data('fiend');
    const r = logged(
      d,
      scripted((t) => (t === 1 ? ['fiend'] : [])),
      { enemyId: 'dummy', deck: deckOf(['fiend', 1]) },
    );
    expect(events(r.log, 'damage').filter((e) => e.source === 'player')).toHaveLength(0);
  });

  it('a script id the engine does not know is not simulated yet', () => {
    const d = data();
    d.cards.probe = skill('probe', 'Pr', [{ type: 'script', id: 'perfectedStrike', values: [2] }]);
    expect(() =>
      simulateCombat(
        d,
        cfg({ deck: deckOf(['probe', 5]) }),
        scripted((t) => (t === 1 ? ['probe'] : [])),
      ),
    ).toThrow(/Effect "script" is not simulated yet \(id "perfectedStrike"\)/);
  });
});

describe('#108 Thrash', () => {
  it('hits first, then exhausts a random Attack in hand and adds its PER-HIT damage to this copy', () => {
    // Opening hand: Thrash + Twin Strike (Innate) + 3 Defends: the only other Attack is Twin Strike.
    const d = data('thrash', 'twin');
    const r = logged(
      d,
      scripted((t) => (t === 1 || t === 2 ? ['thrash'] : [])),
      {
        enemyId: 'dummy',
        deck: deckOf(['thrash', 1], ['twin', 1], ['defend', 3]),
      },
    );
    const t1 = turnEvents(r.log!, 1);
    expect(t1.filter((e) => e.t === 'damage').map((e) => (e as { amount: number }).amount)).toEqual([4, 4]);
    expect(t1.filter((e) => e.t === 'exhaust')).toEqual([{ t: 'exhaust', uid: 1, cardId: 'twin', reason: 'effect' }]);
    // Turn 2: Thrash deals 4 + 5 (Twin Strike's per-hit damage, not 10) twice. No Attack left to exhaust.
    const t2 = turnEvents(r.log!, 2);
    expect(t2.filter((e) => e.t === 'damage').map((e) => (e as { amount: number }).amount)).toEqual([9, 9]);
    expect(t2.filter((e) => e.t === 'exhaust')).toHaveLength(0);
  });

  it('the bonus is permanent and stacks: Twin Strike (+5) then Strike (+6) = +11', () => {
    const d = data('thrash', 'twin');
    d.cards.strike = { ...d.cards.strike!, keywords: [] };
    // Turn 1 hand: Thrash, Twin Strike, 3 Defends. Turn 2: Thrash comes back with a Strike.
    const r = logged(
      d,
      scripted((t) => (t <= 3 ? ['thrash'] : [])),
      { enemyId: 'dummy', deck: deckOf(['thrash', 1], ['twin', 1], ['defend', 3], ['strike', 1]) },
    );
    const hits = (t: number) =>
      turnEvents(r.log!, t)
        .filter((e) => e.t === 'damage')
        .map((e) => (e as { amount: number }).amount);
    expect(hits(1)).toEqual([4, 4]);
    expect(hits(2)).toEqual([9, 9]);
    expect(turnEvents(r.log!, 2).filter((e) => e.t === 'exhaust')).toMatchObject([{ cardId: 'strike' }]);
    expect(hits(3)).toEqual([15, 15]);
  });

  it("per-hit base damage: first attack effect plus the card's own bonus; 0 for a card with no attack", () => {
    const d = data();
    const twin = makeCardInstance(d.cards.twin!, false, 0);
    expect(perHitBaseDamage(twin)).toBe(5);
    twin.damageBonus = 3;
    expect(perHitBaseDamage(twin)).toBe(8);
    expect(perHitBaseDamage(makeCardInstance(d.cards.fiend!, false, 1))).toBe(0);
  });
});

describe('#108 determinism', () => {
  it('exhaust combats with every strategy are deterministic', () => {
    const d = data();
    for (const strategy of [GREEDY_CONFIG, blockFirstConfig(0)] as const) {
      const config = cfg({
        enemyId: 'nibbit',
        seed: 23,
        strategy,
        deck: deckOf(
          ['pact', 1],
          ['brand', 1],
          ['grit', 1],
          ['wind', 1],
          ['fiend', 1],
          ['thrash', 1],
          ['drum', 1],
          ['strike', 4],
          ['defend', 4],
        ),
      });
      expect(runCombat(d, config, { log: true })).toEqual(runCombat(d, config, { log: true }));
    }
  });
});
