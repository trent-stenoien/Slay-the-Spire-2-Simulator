/** Innate and Retain. */
import { describe, expect, it } from 'vitest';
import { runCombat, simulateCombat } from './combat';
import { cards } from './testFixtures';
import { cfg, deckOf, passive, scripted, dummyData, logged, events, type Ev } from './combatTestHelpers';
import type { GameEvent, Strategy } from './types';
import { GREEDY_CONFIG, blockFirstConfig } from './strategies';

describe('Innate', () => {
  const withInnate = () => {
    const data = dummyData();
    data.cards.opener = { ...cards.strike!, id: 'opener', code: 'Op', keywords: ['innate'], upgraded: null };
    return data;
  };
  const drawsOnTurn = (log: GameEvent[], turn: number) => {
    const start = log.findIndex((e) => e.t === 'turnStart' && e.turn === turn && e.side === 'player');
    const end = log.findIndex((e) => e.t === 'turnEnd' && e.turn === turn && e.side === 'player');
    return log.slice(start, end).filter((e): e is Ev<'draw'> => e.t === 'draw');
  };

  it('Innate cards are always in the opening hand, drawn first', () => {
    const data = withInnate();
    for (let s = 0; s < 30; s++) {
      const r = logged(data, passive, { enemyId: 'dummy', seed: s, deck: deckOf(['defend', 15], ['opener', 2]) });
      const t1 = drawsOnTurn(r.log!, 1);
      expect(t1).toHaveLength(5);
      expect(t1.slice(0, 2).map((d) => d.cardId)).toEqual(['opener', 'opener']);
      expect(t1.slice(2).every((d) => d.cardId === 'defend')).toBe(true);
    }
  });

  it('turn 1 draws the normal 5 even with more Innate cards; the rest stay on top for later turns (#2)', () => {
    const data = withInnate();
    const seven = logged(data, passive, { enemyId: 'dummy', deck: deckOf(['defend', 10], ['opener', 7]) });
    expect(drawsOnTurn(seven.log!, 1).map((d) => d.cardId)).toEqual(Array(5).fill('opener'));
    expect(drawsOnTurn(seven.log!, 2).map((d) => d.cardId)).toEqual(['opener', 'opener', 'defend', 'defend', 'defend']);

    // 12 Innate: turns 1 and 2 draw 5 each, turn 3 draws the last 2 Innate, then the 3 others.
    const twelve = logged(data, passive, { enemyId: 'dummy', deck: deckOf(['defend', 3], ['opener', 12]) });
    expect(drawsOnTurn(twelve.log!, 1).map((d) => d.cardId)).toEqual(Array(5).fill('opener'));
    expect(drawsOnTurn(twelve.log!, 2).map((d) => d.cardId)).toEqual(Array(5).fill('opener'));
    expect(drawsOnTurn(twelve.log!, 3).map((d) => d.cardId)).toEqual([
      'opener',
      'opener',
      'defend',
      'defend',
      'defend',
    ]);
    expect(events(twelve.log, 'discard').filter((d) => d.reason === 'handLimit')).toHaveLength(0);
  });

  it('Innate cards are put on top once, at the start of combat: a reshuffle does not put them back on top', () => {
    const data = withInnate();
    // 1 Innate + 5 Defend: turn 1 draws the opener + 4 Defend; turn 2 draws the last Defend, then
    // reshuffles the 5 discarded cards. After that the opener lands anywhere in the draw order.
    const positions = new Set<number>();
    for (let s = 0; s < 20; s++) {
      const r = logged(data, passive, { enemyId: 'dummy', seed: s, deck: deckOf(['defend', 5], ['opener', 1]) });
      expect(drawsOnTurn(r.log!, 1)[0]!.cardId).toBe('opener');
      const t2 = drawsOnTurn(r.log!, 2).map((d) => d.cardId);
      expect(t2[0]).toBe('defend');
      positions.add(t2.indexOf('opener'));
    }
    expect(positions.size).toBeGreaterThan(1);
  });

  it('a deck without Innate cards gives the same log as before (no extra RNG use)', () => {
    const data = withInnate();
    const config = cfg({ enemyId: 'dummy', seed: 9, deck: deckOf(['strike', 5], ['defend', 5]) });
    const r = simulateCombat(data, config, passive, { log: true });
    // Draw order equals popping the start-shuffled pile.
    expect(drawsOnTurn(r.log!, 1)).toHaveLength(5);
    expect(simulateCombat(data, config, passive, { log: true })).toEqual(r);
  });

  it('Innate is deterministic', () => {
    const data = withInnate();
    const config = cfg({
      enemyId: 'dummy',
      seed: 31,
      deck: deckOf(['strike', 8], ['opener', 3]),
      strategy: GREEDY_CONFIG,
    });
    expect(runCombat(data, config, { log: true })).toEqual(runCombat(data, config, { log: true }));
  });
});

describe('Retain', () => {
  const withRetain = () => {
    const data = dummyData();
    data.cards.keep = { ...cards.defend!, id: 'keep', code: 'Kp', keywords: ['retain'], upgraded: null };
    data.cards.ghost = { ...cards.defend!, id: 'ghost', code: 'Gh', keywords: ['ethereal', 'retain'], upgraded: null };
    return data;
  };

  it('Retain cards stay in hand at end of turn; the rest is discarded; next turn still draws drawPerTurn', () => {
    const data = withRetain();
    const hands: string[][] = [];
    const strat: Strategy = {
      decide(v) {
        if (hands.length < v.state.turn) hands.push(v.state.player.hand.map((c) => c.cardId));
        return { kind: 'endTurn' };
      },
    };
    const r = logged(data, strat, { enemyId: 'dummy', deck: deckOf(['keep', 1], ['strike', 20]) });
    const firstKeep = hands.findIndex((h) => h.includes('keep'));
    expect(firstKeep).toBeGreaterThanOrEqual(0);
    // From the turn it is drawn on, it stays in hand for good, and hand size is 5 + 1.
    expect(hands[firstKeep]).toHaveLength(5);
    for (let t = firstKeep + 1; t < firstKeep + 5; t++) {
      expect(hands[t]).toContain('keep');
      expect(hands[t]).toHaveLength(6);
    }
    expect(events(r.log, 'discard').some((d) => d.cardId === 'keep')).toBe(false);
    expect(events(r.log, 'draw').filter((d) => d.cardId === 'keep')).toHaveLength(1);
  });

  it('a retained card can be played on a later turn', () => {
    const data = withRetain();
    const strat = scripted((turn) => (turn === 3 ? ['keep'] : []));
    const r = logged(data, strat, { enemyId: 'dummy', deck: deckOf(['keep', 1], ['strike', 4]) });
    expect(events(r.log, 'play')[0]).toMatchObject({ cardId: 'keep' });
    expect(events(r.log, 'block')[0]).toMatchObject({ amount: 5 });
  });

  it('Ethereal + Retain exhausts', () => {
    const data = withRetain();
    const r = logged(data, passive, { enemyId: 'dummy', deck: deckOf(['ghost', 1], ['strike', 4]) });
    expect(events(r.log, 'exhaust')).toEqual([{ t: 'exhaust', uid: 0, cardId: 'ghost', reason: 'ethereal' }]);
    expect(events(r.log, 'draw').filter((d) => d.cardId === 'ghost')).toHaveLength(1);
  });

  it('retained cards count toward the hand limit for the next draw', () => {
    const data = withRetain();
    const hands: number[] = [];
    const strat: Strategy = {
      decide(v) {
        if (hands.length < v.state.turn) hands.push(v.state.player.hand.length);
        return { kind: 'endTurn' };
      },
    };
    // 12 Retain cards: turn 1 holds 5, turn 2 draws 5 more (10). On turn 3 the hand is full, so all
    // 5 draws (the last 2 cards, reshuffled back and drawn again) go straight to the discard pile.
    const r = logged(data, strat, { enemyId: 'dummy', deck: deckOf(['keep', 12]) });
    expect(hands.slice(0, 3)).toEqual([5, 10, 10]);
    const log = r.log!;
    const t3 = log.findIndex((e) => e.t === 'turnStart' && e.turn === 3 && e.side === 'player');
    const t3End = log.findIndex((e) => e.t === 'turnEnd' && e.turn === 3 && e.side === 'player');
    const t3Limit = log.slice(t3, t3End).filter((e) => e.t === 'discard' && e.reason === 'handLimit');
    expect(t3Limit).toHaveLength(5);
    expect(events(log.slice(0, t3), 'discard')).toHaveLength(0);
  });

  it('Retain is deterministic', () => {
    const data = withRetain();
    const config = cfg({
      enemyId: 'dummy',
      seed: 5,
      deck: deckOf(['keep', 3], ['strike', 7]),
      strategy: blockFirstConfig(0),
    });
    expect(runCombat(data, config, { log: true })).toEqual(runCombat(data, config, { log: true }));
  });
});
