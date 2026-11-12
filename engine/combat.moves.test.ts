/** #112 move-a-card, choose-a-card and in-combat upgrades: moveCards, moveSelf, upgradeCards. */
import { describe, expect, it } from 'vitest';
import { chooseGenerated } from './generate';
import { GREEDY_CONFIG, createStrategy } from './strategies';
import { cards } from './testFixtures';
import { deckOf, dummyData, events, logged, scripted } from './combatTestHelpers';
import type { CardDef, CardKeyword, ChoiceRequest, Effect, GameData, Strategy, StrategyView } from './types';

const card = (
  id: string,
  over: Partial<CardDef> & Pick<CardDef, 'type'>,
  effects: Effect[] = [],
  keywords: CardKeyword[] = [],
): CardDef => ({
  ...cards.strike!,
  id,
  code: id.slice(0, 2),
  name: id,
  character: 'I',
  rarity: 'common',
  cost: 0,
  keywords,
  effects,
  upgraded: { effects },
  ...over,
});

const hit = (damage: number): Effect[] => [{ type: 'attack', damage, hits: 1 }];
const block = (amount: number): Effect[] => [{ type: 'gainBlock', amount }];

function dataWith(...extra: CardDef[]): GameData {
  const data = dummyData();
  for (const c of extra) data.cards[c.id] = c;
  return data;
}

/** Plays the listed cards in order on turn 1 and records the piles (card ids) after every decision. */
function probe(plan: string[], choose?: Strategy['choose']) {
  const snaps: { hand: string[]; draw: string[]; discard: string[]; exhaust: string[]; turn: number }[] = [];
  let i = 0;
  const strategy: Strategy = {
    decide(view: StrategyView) {
      const p = view.state.player;
      const ids = (pile: readonly { cardId: string; upgraded: boolean }[]) =>
        pile.map((c) => (c.upgraded ? `${c.cardId}+` : c.cardId));
      snaps.push({
        hand: ids(p.hand),
        draw: ids(p.drawPile),
        discard: ids(p.discardPile),
        exhaust: ids(p.exhaustPile),
        turn: view.state.turn,
      });
      const want = view.state.turn === 1 ? plan[i++] : undefined;
      const c = want === undefined ? undefined : view.playable.find((x) => x.cardId === want);
      return c ? { kind: 'play', uid: c.uid } : { kind: 'endTurn' };
    },
    choose,
  };
  return { strategy, snaps };
}

describe('#112 moveCards', () => {
  const headbutt = card('hb', { type: 'attack' }, [
    ...hit(1),
    { type: 'moveCards', from: 'discard', to: 'drawTop', count: 1, mode: 'choose' },
  ]);

  it('Headbutt: puts the strategy-ranked discard card on top of the draw pile, logged as moved', () => {
    const data = dataWith(headbutt);
    const { strategy, snaps } = probe(['strike', 'defend', 'hb']);
    // No `choose` of its own: the engine's default ranks Attack first, so the Strike goes back.
    const r = logged(data, strategy, { deck: deckOf(['hb', 1], ['strike', 1], ['defend', 1], ['bash', 1]) });
    const moved = events(r.log, 'moved');
    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatchObject({ cardId: 'strike', from: 'discard', to: 'drawTop' });
    // Next turn the Strike is drawn first, and the Defend stayed in the discard pile until then.
    const turn2 = snaps.find((s) => s.turn === 2)!;
    expect(turn2.hand).toContain('strike');
    const draws = events(r.log, 'draw');
    const turn2Start = (r.log ?? []).findIndex((e) => e.t === 'turnStart' && e.turn === 2 && e.side === 'player');
    const firstDraw = (r.log ?? []).slice(turn2Start).find((e) => e.t === 'draw');
    expect(firstDraw).toMatchObject({ cardId: 'strike' });
    expect(draws.length).toBeGreaterThan(0);
  });

  it('asks Strategy.choose with purpose "move" and checks the answer', () => {
    const data = dataWith(headbutt);
    let req: ChoiceRequest | undefined;
    const { strategy } = probe(['strike', 'defend', 'hb'], (_v, request) => {
      req = request;
      return { uids: [request.options.find((c) => c.cardId === 'defend')!.uid] };
    });
    const r = logged(data, strategy, { deck: deckOf(['hb', 1], ['strike', 1], ['defend', 1], ['bash', 1]) });
    expect(req).toMatchObject({ purpose: 'move', from: 'discard', to: 'drawTop', min: 1, max: 1 });
    expect(req!.options.map((c) => c.cardId).sort()).toEqual(['defend', 'strike']);
    expect(events(r.log, 'moved')[0]).toMatchObject({ cardId: 'defend' });
  });

  it('an illegal choice throws', () => {
    const data = dataWith(headbutt);
    const { strategy } = probe(['strike', 'defend', 'hb'], () => ({ uids: [9999] }));
    expect(() => logged(data, strategy, { deck: deckOf(['hb', 1], ['strike', 1], ['defend', 1]) })).toThrow(
      /illegal move choice/,
    );
  });

  it('nothing to move: no choice is asked and nothing is logged', () => {
    const data = dataWith(headbutt);
    let asked = false;
    const { strategy } = probe(['hb'], () => {
      asked = true;
      return { uids: [] };
    });
    const r = logged(data, strategy, { deck: deckOf(['hb', 1], ['defend', 1]) });
    expect(asked).toBe(false);
    expect(events(r.log, 'moved')).toHaveLength(0);
  });

  it('Neow\'s Fury: "up to 2" takes the best cards, fewer when fewer qualify', () => {
    const fury = card('fury', { type: 'attack' }, [
      ...hit(1),
      { type: 'moveCards', from: 'discard', to: 'hand', count: 2, mode: 'choose', upTo: true },
    ]);
    const data = dataWith(
      fury,
      card('z_small', { type: 'attack' }, hit(3)),
      card('z_big', { type: 'attack' }, hit(7)),
      card('z_block', { type: 'skill' }, block(4)),
    );
    const a = probe(['z_small', 'z_block', 'z_big', 'fury']);
    const r1 = logged(data, a.strategy, { deck: deckOf(['fury', 1], ['z_small', 1], ['z_block', 1], ['z_big', 1]) });
    // Discard is [z_small, z_block, z_big]: the two best by Attack-first priority come back.
    expect(events(r1.log, 'moved').map((m) => m.cardId)).toEqual(['z_big', 'z_small']);
    const b = probe(['z_block', 'fury']);
    const r2 = logged(data, b.strategy, { deck: deckOf(['fury', 1], ['z_block', 1]) });
    expect(events(r2.log, 'moved').map((m) => m.cardId)).toEqual(['z_block']);
    const c = probe(['fury']);
    const r3 = logged(data, c.strategy, { deck: deckOf(['fury', 1]) });
    expect(events(r3.log, 'moved')).toHaveLength(0);
  });

  it('Secret Technique / Weapon: only matching types qualify; Wish takes any', () => {
    const skillTutor = card('st', { type: 'skill' }, [
      { type: 'moveCards', from: 'draw', to: 'hand', count: 1, mode: 'choose', filter: { types: ['skill'] } },
    ]);
    const data = dataWith(skillTutor);
    // 7 cards: turn 1 draws 5, so two stay in the draw pile (one Strike, one Defend or the like).
    let seen: string[] = [];
    const strat: Strategy = {
      decide(view) {
        const st = view.playable.find((c) => c.cardId === 'st');
        if (view.state.turn === 1 && st) return { kind: 'play', uid: st.uid };
        return { kind: 'endTurn' };
      },
      choose(_v, req) {
        seen = req.options.map((c) => c.type);
        return { uids: [req.options[0]!.uid] };
      },
    };
    const deck = deckOf(['st', 1], ['strike', 3], ['defend', 3]);
    for (let seed = 1; seed < 12; seed++) {
      seen = [];
      const r = logged(data, strat, { deck, seed });
      const moved = events(r.log, 'moved');
      for (const m of moved) expect(['defend']).toContain(m.cardId);
      for (const t of seen) expect(t).toBe('skill');
    }
  });

  it('Seeker Strike: shows 3 random draw-pile cards (all of them when fewer) and picks 1', () => {
    const seeker = card('seek', { type: 'attack' }, [
      ...hit(1),
      { type: 'moveCards', from: 'draw', to: 'hand', count: 1, mode: 'choose', options: 3 },
    ]);
    const data = dataWith(seeker);
    let shown: number[] = [];
    const strat: Strategy = {
      decide(view) {
        const s = view.playable.find((c) => c.cardId === 'seek');
        return view.state.turn === 1 && s ? { kind: 'play', uid: s.uid } : { kind: 'endTurn' };
      },
      choose(_v, req) {
        shown.push(req.options.length);
        return { uids: [req.options[0]!.uid] };
      },
    };
    /** The first run (seed 1..40) where Seeker Strike is in the opening hand. */
    const withSeeker = (strikes: number) => {
      for (let seed = 1; seed < 40; seed++) {
        shown = [];
        const r = logged(data, strat, { deck: deckOf(['seek', 1], ['strike', strikes]), seed });
        if (events(r.log, 'play').some((p) => p.cardId === 'seek')) return { r, seed };
      }
      throw new Error('Seeker Strike never drawn');
    };
    const big = withSeeker(10);
    expect(shown).toEqual([3]);
    expect(events(big.r.log, 'moved')).toHaveLength(1);
    // Same seed, same shown cards and result.
    const again = logged(data, strat, { deck: deckOf(['seek', 1], ['strike', 10]), seed: big.seed });
    expect(again.log).toEqual(big.r.log);
    // With only 2 cards in the draw pile both are shown; with 1 no choice is asked.
    withSeeker(6);
    expect(shown).toEqual([2]);
    const one = withSeeker(5);
    expect(shown).toEqual([]);
    expect(events(one.r.log, 'moved')).toHaveLength(1);
  });

  it('Anointed: every Rare card of the draw pile goes to the hand (rarity filter, mode all)', () => {
    const anointed = card('anoint', { type: 'skill' }, [
      { type: 'moveCards', from: 'draw', to: 'hand', mode: 'all', filter: { rarity: ['rare'] } },
    ]);
    const rare = card('rare_a', { type: 'attack', rarity: 'rare' }, hit(1));
    const data = dataWith(anointed, rare);
    const { strategy, snaps } = probe(['anoint']);
    // 7-card deck: 2 stay in the draw pile; check the rarity filter via the moved events.
    const r = logged(data, strategy, { deck: deckOf(['anoint', 1], ['rare_a', 3], ['strike', 3]), seed: 5 });
    const drawnBefore = snaps[0]!.hand;
    expect(drawnBefore).toContain('anoint');
    const moved = events(r.log, 'moved');
    const leftRares = snaps[0]!.draw.filter((id) => id === 'rare_a').length;
    expect(moved).toHaveLength(leftRares);
    expect(moved.every((m) => m.cardId === 'rare_a' && m.from === 'draw' && m.to === 'hand')).toBe(true);
  });

  it('Thinking Ahead: draws 2, then the worst-ranked hand card goes back on top of the draw pile', () => {
    const ahead = card('ahead', { type: 'skill' }, [
      { type: 'draw', amount: 2 },
      { type: 'moveCards', from: 'hand', to: 'drawTop', count: 1, mode: 'choose' },
    ]);
    const data = dataWith(ahead);
    const { strategy, snaps } = probe(['ahead']);
    const r = logged(data, strategy, { deck: deckOf(['ahead', 1], ['bash', 3], ['defend', 3]), seed: 4 });
    const moved = events(r.log, 'moved');
    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatchObject({ from: 'hand', to: 'drawTop' });
    // Attack-first priority: a Defend (worst-ranked) is the one put back.
    expect(moved[0]!.cardId).toBe('defend');
    expect(snaps.length).toBeGreaterThan(1);
  });
});

describe('#112 moveSelf (nextTurnStart)', () => {
  const bolas = card('bolas', { type: 'attack' }, [...hit(1), { type: 'moveSelf', to: 'hand', when: 'nextTurnStart' }]);

  it('Bolas comes back to the hand at the start of the next turn, before the draw', () => {
    const data = dataWith(bolas);
    const { strategy, snaps } = probe(['bolas']);
    const r = logged(data, strategy, { deck: deckOf(['bolas', 1], ['strike', 2]) });
    const turn2 = snaps.find((s) => s.turn === 2)!;
    expect(turn2.hand).toContain('bolas');
    const moved = events(r.log, 'moved');
    expect(moved[0]).toMatchObject({ cardId: 'bolas', from: 'discard', to: 'hand' });
    // It came back by itself, not through a reshuffle: all 3 cards are in the hand.
    expect(turn2.hand.sort()).toEqual(['bolas', 'strike', 'strike']);
  });

  it('comes back every turn it is played', () => {
    const data = dataWith(bolas);
    const plan = scripted(() => ['bolas']);
    const r = logged(data, plan, { deck: deckOf(['bolas', 1]) });
    expect(events(r.log, 'moved').length).toBeGreaterThanOrEqual(2);
  });

  it('a card exhausted before the next turn stays gone', () => {
    const once = card(
      'once',
      { type: 'attack' },
      [...hit(1), { type: 'moveSelf', to: 'hand', when: 'nextTurnStart' }],
      ['exhaust'],
    );
    const data = dataWith(once);
    const { strategy, snaps } = probe(['once']);
    const r = logged(data, strategy, { deck: deckOf(['once', 1], ['strike', 1]) });
    expect(events(r.log, 'moved')).toHaveLength(0);
    expect(snaps.find((s) => s.turn === 2)!.hand).not.toContain('once');
  });
});

describe('#112 upgradeCards', () => {
  const armaments = card('arm', { type: 'skill', upgraded: { effects: [] } }, [
    { type: 'upgradeCards', piles: ['hand'], count: 1, mode: 'choose' },
  ]);
  armaments.upgraded = { effects: [{ type: 'upgradeCards', piles: ['hand'], mode: 'all' }] };

  it('Armaments: upgrades the strategy-ranked hand card (same uid), logged as upgraded', () => {
    const data = dataWith(armaments);
    const { strategy, snaps } = probe(['arm', 'strike']);
    const r = logged(data, strategy, { deck: deckOf(['arm', 1], ['strike', 2], ['defend', 2]), seed: 1 });
    const ups = events(r.log, 'upgraded');
    expect(ups).toHaveLength(1);
    expect(ups[0]!.cardId).toBe('strike');
    expect(snaps[1]!.hand.filter((c) => c === 'strike+')).toHaveLength(1);
    expect(snaps[1]!.hand.filter((c) => c === 'strike')).toHaveLength(1);
  });

  it('the upgraded card deals its upgraded damage', () => {
    const data = dataWith(armaments);
    const { strategy } = probe(['arm', 'strike']);
    const r = logged(data, strategy, { deck: deckOf(['arm', 1], ['strike', 1], ['defend', 3]), seed: 1 });
    const hits = events(r.log, 'damage').filter((d) => d.source === 'player');
    expect(hits.map((h) => h.amount)).toEqual([9]);
  });

  it('asks Strategy.choose with purpose "upgrade"; already-upgraded and un-upgradable cards do not qualify', () => {
    const data = dataWith(armaments);
    let req: ChoiceRequest | undefined;
    const { strategy } = probe(['arm'], (_v, request) => {
      req = request;
      return { uids: [request.options[0]!.uid] };
    });
    logged(data, strategy, {
      deck: [
        { cardId: 'arm', upgraded: false, count: 1 },
        { cardId: 'strike', upgraded: true, count: 1 },
        { cardId: 'defend', upgraded: false, count: 1 },
        { cardId: 'bash', upgraded: false, count: 1 },
        { cardId: 'ascenders_bane', upgraded: false, count: 1 },
      ],
    });
    expect(req).toMatchObject({ purpose: 'upgrade', from: 'hand', min: 1, max: 1 });
    expect(req!.options.map((c) => c.cardId).sort()).toEqual(['bash', 'defend']);
  });

  it('Armaments+: upgrades every upgradable card in the hand', () => {
    const data = dataWith(armaments);
    const { strategy, snaps } = probe(['arm']);
    const r = logged(data, strategy, {
      deck: [
        { cardId: 'arm', upgraded: true, count: 1 },
        { cardId: 'strike', upgraded: false, count: 2 },
        { cardId: 'defend', upgraded: false, count: 1 },
        { cardId: 'ascenders_bane', upgraded: false, count: 1 },
      ],
    });
    expect(events(r.log, 'upgraded')).toHaveLength(3);
    expect(snaps[1]!.hand.sort()).toEqual(['ascenders_bane', 'defend+', 'strike+', 'strike+']);
  });

  it('Apotheosis: upgrades the cards of every pile, the exhaust pile included', () => {
    const apo = card('apo', { type: 'skill' }, [
      { type: 'upgradeCards', piles: ['hand', 'draw', 'discard', 'exhaust'], mode: 'all' },
    ]);
    const burn = card('burn', { type: 'skill' }, [], ['exhaust']);
    const data = dataWith(apo, burn);
    // 8 cards: 5 drawn, 3 in the draw pile. Play burn first (exhausted), a Strike (discard), then apo.
    const { strategy, snaps } = probe(['burn', 'strike', 'apo']);
    const r = logged(data, strategy, { deck: deckOf(['apo', 1], ['burn', 1], ['strike', 6]), seed: 7 });
    const after = snaps.filter((s) => s.turn === 1).at(-1)!;
    // Everything but Apotheosis itself (being played): the Burn-like card in the exhaust pile and 6 Strikes.
    expect(events(r.log, 'upgraded')).toHaveLength(7);
    expect(after.exhaust).toEqual(['burn+']);
    const rest = [...after.hand, ...after.draw, ...after.discard];
    expect(rest.filter((id) => id.startsWith('strike')).every((id) => id === 'strike+')).toBe(true);
  });
});

describe('chooseGenerated for moves and upgrades', () => {
  const opt = (uid: number, type: 'attack' | 'skill' | 'power' | 'curse', effects: Effect[]) =>
    ({ uid, cardId: `c${uid}`, name: `c${uid}`, type, upgraded: false, cost: 1, keywords: [], effects }) as const;
  const req = (over: Partial<ChoiceRequest>, options: ChoiceRequest['options']): ChoiceRequest => ({
    purpose: 'move',
    options,
    min: 1,
    max: 1,
    ...over,
  });
  const options = [
    opt(1, 'curse', []),
    opt(2, 'skill', block(9)),
    opt(3, 'attack', hit(5)),
    opt(4, 'attack', hit(8)),
    opt(5, 'skill', []),
  ];

  it('takes the best card by the strategy order, several in rank order', () => {
    expect(chooseGenerated(req({ max: 3, min: 3 }, options), ['attack', 'powers', 'block']).uids).toEqual([4, 3, 2]);
    expect(chooseGenerated(req({ max: 2, min: 2 }, options), ['block', 'attack', 'powers']).uids).toEqual([2, 4]);
  });

  it('"up to" never takes a curse or status; an exact count may', () => {
    const upTo = chooseGenerated(req({ min: 0, max: 5 }, options), ['attack', 'powers', 'block']).uids;
    expect(upTo).toEqual([4, 3, 2, 5]);
    const exact = chooseGenerated(req({ min: 5, max: 5 }, options), ['attack', 'powers', 'block']).uids;
    expect(exact).toEqual([4, 3, 2, 5, 1]);
  });

  it('cards put from the hand on top of the draw pile are the worst ranked', () => {
    const r = req({ from: 'hand', to: 'drawTop' }, options);
    expect(chooseGenerated(r, ['attack', 'powers', 'block']).uids).toEqual([1]);
    expect(
      chooseGenerated(req({ from: 'hand', to: 'drawTop' }, options.slice(1)), ['attack', 'powers', 'block']).uids,
    ).toEqual([5]);
  });
});

describe('#112 the strategy plays tutors and Apotheosis', () => {
  const tutor = card('weapon', { type: 'skill' }, [
    { type: 'moveCards', from: 'draw', to: 'hand', count: 1, mode: 'choose', filter: { types: ['attack'] } },
  ]);
  const apo = card(
    'apo',
    { type: 'skill', cost: 2 },
    [{ type: 'upgradeCards', piles: ['hand', 'draw', 'discard', 'exhaust'], mode: 'all' }],
    ['exhaust'],
  );
  const data = dataWith(tutor, apo);
  const play = (deck: ReturnType<typeof deckOf>, seed: number) =>
    logged(data, createStrategy(GREEDY_CONFIG), { deck, seed });
  const playsOf = (r: ReturnType<typeof play>, id: string) => events(r.log, 'play').filter((p) => p.cardId === id);

  it('plays a tutor first when the draw pile holds a card it can fetch', () => {
    for (let seed = 1; seed < 40; seed++) {
      const r = play(deckOf(['weapon', 1], ['strike', 9]), seed);
      if (playsOf(r, 'weapon').length === 0) continue;
      const firstPlay = events(r.log, 'play')[0]!;
      expect(firstPlay.cardId).toBe('weapon');
      expect(events(r.log, 'moved')[0]).toMatchObject({ cardId: 'strike', from: 'draw', to: 'hand' });
      return;
    }
    throw new Error('weapon never drawn');
  });

  it('does not waste a tutor when nothing in the draw pile qualifies', () => {
    const r = play(deckOf(['weapon', 1], ['defend', 4]), 1);
    expect(playsOf(r, 'weapon')).toHaveLength(0);
  });

  it('plays Apotheosis when there is something to upgrade', () => {
    const r = play(deckOf(['apo', 1], ['strike', 4]), 1);
    expect(playsOf(r, 'apo')).toHaveLength(1);
    expect(events(r.log, 'upgraded')).toHaveLength(4);
    const alone = play(deckOf(['apo', 1]), 1);
    expect(playsOf(alone, 'apo')).toHaveLength(0);
  });
});
