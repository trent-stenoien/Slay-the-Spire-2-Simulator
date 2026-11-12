/** #106 Lose HP and #107 Draw: engine rules. */
import { describe, expect, it } from 'vitest';
import { matchesFilter, makeCardInstance, runCombat, simulateCombat } from './combat';
import { cards, makeEnemy } from './testFixtures';
import { cfg, deckOf, dummyData, events, logged, passive, scripted, withEnemy, type Ev } from './combatTestHelpers';
import { HAND_LIMIT, type CardDef, type CombatCounters, type GameData, type GameEvent, type Strategy } from './types';

/** Test cards modelled on the real ones (engine tests do not import data/). */
const extra: Record<string, CardDef> = {
  hemo: {
    ...cards.strike!,
    id: 'hemo',
    code: 'Hm',
    effects: [
      { type: 'loseHp', amount: 2 },
      { type: 'attack', damage: 15, hits: 1 },
    ],
    upgraded: null,
  },
  wall: {
    ...cards.defend!,
    id: 'wall',
    code: 'Bw',
    cost: 0,
    effects: [
      { type: 'loseHp', amount: 2 },
      { type: 'gainBlock', amount: 16 },
    ],
    upgraded: null,
  },
  soul: { ...cards.defend!, id: 'soul', code: 'So', cost: 0, effects: [{ type: 'draw', amount: 2 }], upgraded: null },
  scrawl: {
    ...cards.defend!,
    id: 'scrawl',
    code: 'Sc',
    cost: 0,
    keywords: ['exhaust'],
    effects: [{ type: 'drawUntil', handFull: true }],
    upgraded: null,
  },
  pillage: {
    ...cards.strike!,
    id: 'pillage',
    code: 'Pi',
    cost: 0,
    effects: [
      { type: 'attack', damage: 6, hits: 1 },
      { type: 'drawUntil', stopOn: { notTypes: ['attack'] } },
    ],
    upgraded: null,
  },
  trance: {
    ...cards.defend!,
    id: 'trance',
    code: 'Tr',
    cost: 0,
    effects: [
      { type: 'draw', amount: 3 },
      { type: 'applyPower', power: 'noDraw', amount: 1 },
    ],
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

/** Events of player turn `turn` (from its turnStart to its turnEnd). */
function turnEvents(log: GameEvent[], turn: number): GameEvent[] {
  const start = log.findIndex((e) => e.t === 'turnStart' && e.turn === turn && e.side === 'player');
  const end = log.findIndex((e) => e.t === 'turnEnd' && e.turn === turn && e.side === 'player');
  return log.slice(start, end + 1);
}

/** The events after the first `play` of the turn. */
function afterFirstPlay(log: GameEvent[], turn: number): GameEvent[] {
  const evs = turnEvents(log, turn);
  return evs.slice(evs.findIndex((e) => e.t === 'play'));
}

/** Records the player's counters, hand size and HP each time the strategy is asked. */
function recorder(plan: (turn: number) => string[]) {
  const seen: { turn: number; counters: CombatCounters; hand: number; hp: number }[] = [];
  const inner = scripted(plan);
  const strat: Strategy = {
    decide(v) {
      seen.push({
        turn: v.state.turn,
        counters: { ...(v.state.player.counters as CombatCounters) },
        hand: v.state.player.hand.length,
        hp: v.state.player.hp,
      });
      return inner.decide(v);
    },
  };
  return { strat, seen };
}

describe('#106 lose HP', () => {
  it('loseHp ignores Block and is not an attack', () => {
    const d = data('wall');
    const r = logged(
      d,
      scripted((t) => (t === 1 ? ['wall', 'wall'] : [])),
      {
        enemyId: 'dummy',
        deck: deckOf(['wall', 2], ['defend', 3]),
      },
    );
    const t1 = turnEvents(r.log!, 1);
    // First Blood Wall: 2 HP, then 16 Block. Second: 2 HP more even with 16 Block up.
    expect(t1.filter((e) => e.t === 'loseHp' || e.t === 'block')).toEqual([
      { t: 'loseHp', side: 'player', amount: 2, hpAfter: 78 },
      { t: 'block', side: 'player', amount: 16, total: 16 },
      { t: 'loseHp', side: 'player', amount: 2, hpAfter: 76 },
      { t: 'block', side: 'player', amount: 16, total: 32 },
    ]);
    expect(events(r.log, 'damage')).toHaveLength(0);
  });

  it('HP lost from your own cards counts toward hpLost', () => {
    const d = withEnemy(data(), makeEnemy('weak', 10, { wait: { name: 'Wait', effects: [] } }));
    const r = logged(
      d,
      scripted((t) => (t === 1 ? ['hemo'] : [])),
      { enemyId: 'weak', deck: deckOf(['hemo', 5]) },
    );
    expect(r).toMatchObject({ outcome: 'win', turns: 1, hpLost: 2 });
  });

  it('a self-damage card that drops you to 0 HP ends the combat as a loss, before its other effects', () => {
    const d = data();
    d.characters.ironclad!.maxHp = 2;
    const r = logged(
      d,
      scripted((t) => (t === 1 ? ['hemo'] : [])),
      { enemyId: 'dummy', deck: deckOf(['hemo', 5]) },
    );
    expect(r).toMatchObject({ outcome: 'loss', turns: 1, hpLost: 2, enemyHpRemaining: 999 });
    expect(events(r.log, 'damage')).toHaveLength(0);
    expect(r.log!.slice(-2)).toEqual([
      { t: 'loseHp', side: 'player', amount: 2, hpAfter: 0 },
      { t: 'combatEnd', outcome: 'loss', turns: 1, hpLost: 2 },
    ]);
  });

  it('a kill by the same card does not matter if the HP loss came first', () => {
    const d = withEnemy(data(), makeEnemy('weak', 10, { wait: { name: 'Wait', effects: [] } }));
    d.characters.ironclad!.maxHp = 2;
    const r = logged(
      d,
      scripted((t) => (t === 1 ? ['hemo'] : [])),
      { enemyId: 'weak', deck: deckOf(['hemo', 5]) },
    );
    expect(r.outcome).toBe('loss');
    expect(r.enemyHpRemaining).toBe(10);
  });

  it('counters: every HP drop from any source counts; fully blocked hits do not; "this turn" resets', () => {
    // The enemy hits twice for 5 each turn. Turn 1: one Defend (5 Block) absorbs the first hit;
    // the second hit drops HP. Turn 2: Blood Wall loses 2 HP.
    const d = withEnemy(
      data('wall', 'defend'),
      makeEnemy('twice', 999, { jab: { name: 'Jab', effects: [{ type: 'attack', damage: 5, hits: 2 }] } }),
    );
    const { strat, seen } = recorder((t) => (t === 1 ? ['defend'] : t === 2 ? ['wall'] : []));
    const r = logged(d, strat, { enemyId: 'twice', deck: deckOf(['defend', 4], ['wall', 1]) });
    const hits = events(r.log, 'damage').filter((e) => e.target === 'player');
    expect(hits.slice(0, 2).map((h) => h.hpLoss)).toEqual([0, 5]);
    const t2 = seen.filter((s) => s.turn === 2);
    // Start of turn 2: one HP drop so far (the blocked hit did not count); this turn's tally reset.
    expect(t2[0]!.counters).toMatchObject({ hpLostThisTurn: 0, hpLostThisCombat: 5, hpLossesThisCombat: 1 });
    // After Blood Wall: a second drop, 2 HP this turn.
    expect(t2[1]!.counters).toMatchObject({ hpLostThisTurn: 2, hpLostThisCombat: 7, hpLossesThisCombat: 2 });
    // Turn 3 start: Blood Wall's 16 Block absorbed both of turn 2's enemy hits, so nothing new counted.
    const t3 = seen.find((s) => s.turn === 3)!;
    expect(t3.counters).toMatchObject({ hpLostThisTurn: 0, hpLostThisCombat: 7, hpLossesThisCombat: 2 });
  });

  it('a partly blocked hit counts once, by the HP actually lost', () => {
    const d = withEnemy(
      data(),
      makeEnemy('big', 999, { slam: { name: 'Slam', effects: [{ type: 'attack', damage: 8, hits: 1 }] } }),
    );
    d.cards.defend = { ...d.cards.defend!, keywords: ['innate'] };
    const { strat, seen } = recorder((t) => (t === 1 ? ['defend'] : []));
    logged(d, strat, { enemyId: 'big', deck: deckOf(['defend', 5]) });
    expect(seen.find((s) => s.turn === 2)!.counters).toMatchObject({ hpLostThisCombat: 3, hpLossesThisCombat: 1 });
  });

  it('loseHp on an enemy move is not simulated yet', () => {
    const e = makeEnemy('bleeder', 50, { cut: { name: 'Cut', effects: [{ type: 'loseHp', amount: 3 }] } });
    expect(() => simulateCombat(withEnemy(data(), e), cfg({ enemyId: 'bleeder', deck: [] }), passive)).toThrow(
      /"loseHp" is not simulated yet on enemy moves/,
    );
  });
});

describe('#107 draw', () => {
  it('draw N draws N cards mid-turn and counts them', () => {
    const d = data('soul');
    const { strat, seen } = recorder((t) => (t === 1 ? ['soul'] : []));
    const r = logged(d, strat, { enemyId: 'dummy', deck: deckOf(['soul', 1], ['strike', 10]) });
    const after = afterFirstPlay(r.log!, 1);
    expect(after.filter((e) => e.t === 'draw')).toHaveLength(2);
    // Hand: 5 − Soul + 2 = 6.
    expect(seen[1]!.hand).toBe(6);
    expect(seen[0]!.counters).toMatchObject({ cardsDrawnThisTurn: 5, cardsDrawnThisCombat: 5 });
    expect(seen[1]!.counters).toMatchObject({ cardsDrawnThisTurn: 7, cardsDrawnThisCombat: 7 });
    expect(seen.find((s) => s.turn === 2)!.counters).toMatchObject({ cardsDrawnThisTurn: 5, cardsDrawnThisCombat: 12 });
  });

  it('draw reshuffles the discard pile when the draw pile runs out', () => {
    const d = data('soul');
    // Opening hand: Soul + 4 Strikes (all Innate); the draw pile holds 1 Defend. Two Strikes go to
    // the discard pile, then Soul draws the Defend and reshuffles the discard pile for its second draw.
    d.cards.strike = { ...d.cards.strike!, keywords: ['innate'] };
    const r = logged(
      d,
      scripted((t) => (t === 1 ? ['strike', 'strike', 'soul'] : [])),
      {
        enemyId: 'dummy',
        deck: deckOf(['soul', 1], ['strike', 4], ['defend', 1]),
      },
    );
    const after = afterFirstPlay(r.log!, 1)
      .filter((e) => ['draw', 'shuffle'].includes(e.t))
      .map((e) => e.t);
    expect(after).toEqual(['draw', 'shuffle', 'draw']);
  });

  it('drawing into a full hand discards the drawn card', () => {
    const d = data('soul');
    d.characters.ironclad!.drawPerTurn = 10;
    const r = logged(
      d,
      scripted((t) => (t === 1 ? ['soul'] : [])),
      {
        enemyId: 'dummy',
        deck: deckOf(['soul', 1], ['soul', 1], ['strike', 10]),
      },
    );
    // Hand of 10 → Soul leaves (9) → first draw fills to 10, second is discarded.
    const after = afterFirstPlay(r.log!, 1);
    expect(after.filter((e) => e.t === 'draw')).toHaveLength(2);
    expect(after.filter((e) => e.t === 'discard' && e.reason === 'handLimit')).toHaveLength(1);
  });

  it('Scrawl draws until the hand is full (10) and never discards for the hand limit', () => {
    const d = data('scrawl');
    const { strat, seen } = recorder((t) => (t === 1 ? ['scrawl'] : []));
    const r = logged(d, strat, { enemyId: 'dummy', deck: deckOf(['scrawl', 1], ['strike', 20]) });
    expect(seen[1]!.hand).toBe(HAND_LIMIT);
    // 5 − Scrawl = 4, so 6 draws.
    expect(afterFirstPlay(r.log!, 1).filter((e) => e.t === 'draw')).toHaveLength(6);
    expect(events(r.log, 'discard').some((e) => e.reason === 'handLimit')).toBe(false);
  });

  it('Scrawl stops when nothing is left to draw', () => {
    const d = data('scrawl');
    const { strat, seen } = recorder((t) => (t === 1 ? ['scrawl'] : []));
    logged(d, strat, { enemyId: 'dummy', deck: deckOf(['scrawl', 1], ['strike', 6]) });
    expect(seen[1]!.hand).toBe(6);
  });

  it('Pillage draws until it draws a non-Attack card (that card stays in hand)', () => {
    const d = data('pillage', 'strike');
    // Opening hand: Pillage + 4 Strikes (all Innate). Draw pile: 3 Bash and 1 Defend in random order;
    // Pillage draws Bashes until it draws the Defend.
    for (let s = 0; s < 10; s++) {
      const r = logged(
        d,
        scripted((t) => (t === 1 ? ['pillage'] : [])),
        {
          enemyId: 'dummy',
          seed: s,
          deck: deckOf(['pillage', 1], ['strike', 4], ['bash', 3], ['defend', 1]),
        },
      );
      const drawn = afterFirstPlay(r.log!, 1)
        .filter((e): e is Ev<'draw'> => e.t === 'draw')
        .map((e) => e.cardId);
      expect(drawn.at(-1)).toBe('defend');
      expect(drawn.slice(0, -1).every((id) => id === 'bash')).toBe(true);
    }
  });

  it('Pillage stops when the draw pile and discard pile are empty', () => {
    const d = data('pillage');
    const { strat, seen } = recorder((t) => (t === 1 ? ['pillage'] : []));
    logged(d, strat, { enemyId: 'dummy', deck: deckOf(['pillage', 1], ['strike', 7]) });
    expect(seen[1]!.hand).toBe(7);
  });

  it('Pillage stops at a full hand instead of drawing into it', () => {
    const d = data('pillage');
    d.characters.ironclad!.drawPerTurn = 10;
    const { strat, seen } = recorder((t) => (t === 1 ? ['pillage'] : []));
    const r = logged(d, strat, { enemyId: 'dummy', deck: deckOf(['pillage', 1], ['strike', 30]) });
    expect(afterFirstPlay(r.log!, 1).filter((e) => e.t === 'draw')).toHaveLength(1);
    expect(seen[1]!.hand).toBe(HAND_LIMIT);
    expect(events(r.log, 'discard').some((e) => e.reason === 'handLimit')).toBe(false);
  });

  it('Battle Trance: draws, then blocks every later draw this turn; the next turn draws normally', () => {
    const d = data('trance', 'soul', 'pillage', 'scrawl');
    const r = logged(
      d,
      scripted((t) => (t === 1 ? ['trance', 'soul', 'pillage', 'scrawl'] : [])),
      {
        enemyId: 'dummy',
        deck: deckOf(['trance', 1], ['soul', 1], ['pillage', 1], ['scrawl', 1], ['defend', 20]),
      },
    );
    const after = afterFirstPlay(r.log!, 1);
    // Battle Trance's 3 draws, then nothing from Soul, Pillage or Scrawl.
    expect(after.filter((e) => e.t === 'draw')).toHaveLength(3);
    expect(after.filter((e) => e.t === 'powerApplied')).toEqual([
      { t: 'powerApplied', side: 'player', power: 'noDraw', amount: 1, total: 1 },
    ]);
    expect(after.filter((e) => e.t === 'powerRemoved')).toEqual([
      { t: 'powerRemoved', side: 'player', power: 'noDraw' },
    ]);
    expect(turnEvents(r.log!, 2).filter((e) => e.t === 'draw')).toHaveLength(5);
  });

  it('matchesFilter: types, notTypes, cardId, upgraded, nameIncludes', () => {
    const strike = makeCardInstance(cards.strike!, true, 0);
    expect(matchesFilter(strike, {})).toBe(true);
    expect(matchesFilter(strike, { notTypes: ['attack'] })).toBe(false);
    expect(matchesFilter(strike, { types: ['attack'], cardId: 'strike', upgraded: true })).toBe(true);
    expect(matchesFilter(strike, { upgraded: false })).toBe(false);
    expect(matchesFilter(strike, { nameIncludes: 'Strike' })).toBe(true);
    expect(matchesFilter(strike, { nameIncludes: 'strike' })).toBe(false);
  });

  it('lose HP and draw combats are deterministic', () => {
    const d = data();
    const config = cfg({
      enemyId: 'nibbit',
      seed: 17,
      deck: deckOf(['hemo', 2], ['wall', 2], ['soul', 2], ['pillage', 2], ['trance', 1], ['strike', 4], ['defend', 4]),
    });
    expect(runCombat(d, config, { log: true })).toEqual(runCombat(d, config, { log: true }));
  });
});
