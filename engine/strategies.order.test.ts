/** #130 strategies: a user-ordered priority of Attack, Block and Powers, and the new draw rule. */
import { describe, expect, it } from 'vitest';
import { makeCardInstance, simulateCombat } from './combat';
import { cfg, deckOf, dummyData, events } from './combatTestHelpers';
import { blockFirstConfig, cannotFillTopGroup, createStrategy, GREEDY_CONFIG, pickPower } from './strategies';
import { cards } from './testFixtures';
import type { CardDef, CardInstance, CombatState, StrategyConfig, StrategyGroup, StrategyView } from './types';

/** Test-only cards. No Power is simulated yet (#109), so `flex` is a fixture Power. */
const extra: Record<string, CardDef> = {
  flex: {
    ...cards.defend!,
    id: 'flex',
    code: 'Fx',
    name: 'Flex',
    type: 'power',
    cost: 1,
    effects: [{ type: 'gainStrength', amount: 2 }],
    upgraded: null,
  },
  bigflex: {
    ...cards.defend!,
    id: 'bigflex',
    code: 'Bf',
    name: 'Big Flex',
    type: 'power',
    cost: 1,
    effects: [{ type: 'gainStrength', amount: 5 }],
    upgraded: null,
  },
  xflex: {
    ...cards.defend!,
    id: 'xflex',
    code: 'Xf',
    name: 'X Flex',
    type: 'power',
    cost: 0,
    xCost: true,
    effects: [{ type: 'gainStrength', amount: 9 }],
    upgraded: null,
  },
  pommel: {
    ...cards.strike!,
    id: 'pommel',
    code: 'Pm',
    name: 'Pommel Strike',
    effects: [
      { type: 'attack', damage: 9, hits: 1 },
      { type: 'draw', amount: 1 },
    ],
    upgraded: null,
  },
  shrug: {
    ...cards.defend!,
    id: 'shrug',
    code: 'Sh',
    name: 'Shrug It Off',
    effects: [
      { type: 'gainBlock', amount: 8 },
      { type: 'draw', amount: 1 },
    ],
    upgraded: null,
  },
  soul: {
    ...cards.defend!,
    id: 'soul',
    code: 'So',
    name: 'Soul',
    cost: 0,
    effects: [{ type: 'draw', amount: 2 }],
    upgraded: null,
  },
  heavy: {
    ...cards.strike!,
    id: 'heavy',
    code: 'Hv',
    name: 'Heavy',
    cost: 3,
    effects: [{ type: 'attack', damage: 32, hits: 1 }],
    upgraded: null,
  },
  xattack: {
    ...cards.strike!,
    id: 'xattack',
    code: 'Xa',
    name: 'X Attack',
    cost: 0,
    xCost: true,
    effects: [{ type: 'attack', damage: 5, hits: 1, xTimes: true }],
    upgraded: null,
  },
  fuel: {
    ...cards.defend!,
    id: 'fuel',
    code: 'Fu',
    name: 'Fuel',
    cost: 0,
    effects: [{ type: 'gainEnergy', amount: 1 }],
    upgraded: null,
  },
  /** A 1-cost pure draw card (Master of Strategy's cost is 0 here, so this stands in for a 1-cost one). */
  scry: {
    ...cards.defend!,
    id: 'scry',
    code: 'Sc',
    name: 'Scry',
    cost: 1,
    effects: [{ type: 'draw', amount: 2 }],
    upgraded: null,
  },
  trance: {
    ...cards.defend!,
    id: 'trance',
    code: 'Bt',
    name: 'Trance',
    cost: 0,
    effects: [
      { type: 'draw', amount: 3 },
      { type: 'applyPower', power: 'noDraw', amount: 1 },
    ],
    upgraded: null,
  },
  tremble: {
    ...cards.defend!,
    id: 'tremble',
    code: 'Tl',
    name: 'Tremble',
    cost: 1,
    effects: [{ type: 'applyVulnerable', amount: 3 }],
    upgraded: null,
  },
};

let nextUid = 0;
function card(id: string): CardInstance {
  return makeCardInstance((cards[id] ?? extra[id])!, false, nextUid++);
}

const order = (...o: StrategyGroup[]) => o;
const config = (o: StrategyGroup[], allowThrough = 0): StrategyConfig => ({ order: o, allowThrough });

/**
 * One player turn against a fixed incoming attack. Tracks energy and Block only (no draws); the
 * draw pile holds `drawPile` Strikes so draw cards count as able to draw. Returns the cardIds played.
 */
function playTurn(
  c: StrategyConfig,
  hand: CardInstance[],
  incoming: number,
  { energy = 3, drawPile = 5 }: { energy?: number; drawPile?: number } = {},
): string[] {
  const strategy = createStrategy(c);
  const state = {
    turn: 1,
    player: {
      hp: 80,
      maxHp: 80,
      block: 0,
      energy,
      strength: 0,
      debuffs: { vulnerable: 0, weak: 0, frail: 0 },
      drawPile: Array.from({ length: drawPile }, () => card('strike')),
      hand: [...hand],
      discardPile: [],
      exhaustPile: [],
    },
    enemy: {
      enemyId: 'x',
      name: 'x',
      hp: 100,
      maxHp: 100,
      block: 0,
      strength: 0,
      debuffs: { vulnerable: 0, weak: 0, frail: 0 },
      poison: 0,
      patternIndex: 0,
    },
  } satisfies CombatState;
  const played: string[] = [];
  for (let i = 0; i < 50; i++) {
    const view = viewOf(state, incoming);
    const d = strategy.decide(view);
    if (d.kind === 'endTurn') return played;
    const idx = state.player.hand.findIndex((x) => x.uid === d.uid);
    const played1 = state.player.hand[idx]!;
    expect(view.playable).toContain(played1);
    state.player.hand.splice(idx, 1);
    state.player.energy -= played1.xCost ? state.player.energy : played1.cost!;
    for (const e of played1.effects) {
      if (e.type === 'gainBlock') state.player.block += e.amount;
      if (e.type === 'gainEnergy') state.player.energy += e.amount;
    }
    played.push(played1.cardId);
  }
  throw new Error('strategy never ended its turn');
}

function viewOf(state: CombatState, incoming: number): StrategyView {
  return {
    state,
    intent: {
      moveId: 'm',
      name: 'm',
      attacks: incoming > 0 ? [{ damagePerHit: incoming, hits: 1 }] : [],
      totalIncoming: incoming,
    },
    playable: state.player.hand.filter((c) => c.cost !== null && c.cost <= state.player.energy),
  };
}

const S = 'strike';
const D = 'defend';
const P = 'flex';

describe('#130 group order', () => {
  it.each([
    [order('attack', 'block', 'powers'), S],
    [order('attack', 'powers', 'block'), S],
    [order('block', 'attack', 'powers'), D],
    [order('block', 'powers', 'attack'), D],
    [order('powers', 'attack', 'block'), P],
    [order('powers', 'block', 'attack'), P],
  ])('%j plays from its first group first', (o, first) => {
    const hand = [card(S), card(D), card(P)];
    expect(playTurn(config(o, 0), hand, 10, { energy: 1 })).toEqual([first]);
  });

  it('walks the groups in order, one card at a time, and spends leftover energy on block last', () => {
    const hand = () => [card(D), card(D), card(S), card(S), card(P)];
    // Block (allow 5): one Defend leaves 5 through, so Block is done; then Powers, then Attack.
    expect(playTurn(config(order('block', 'powers', 'attack'), 5), hand(), 10)).toEqual([D, P, S]);
    // With a 4th energy, the leftover goes to block after every group is done.
    expect(playTurn(config(order('block', 'powers', 'attack'), 5), hand(), 10, { energy: 5 })).toEqual([D, P, S, S, D]);
    // Powers, Block (allow 5), Attack.
    expect(playTurn(config(order('powers', 'block', 'attack'), 5), hand(), 10)).toEqual([P, D, S]);
    // Attack, Block (allow 0), Powers: attacks first, then block to 0 through, then the Power.
    expect(playTurn(config(order('attack', 'block', 'powers'), 0), hand(), 10, { energy: 5 })).toEqual([S, S, D, D, P]);
  });

  it('the Block group plays nothing when at most X would get through', () => {
    const hand = [card(D), card(S), card(P)];
    expect(playTurn(config(order('block', 'attack', 'powers'), 6), hand, 6, { energy: 2 })).toEqual([S, P]);
  });

  it('Block last spends leftover energy whatever X says (X is unused and stored as 0)', () => {
    const hand = () => [card(D), card(D), card(S), card(P)];
    const plays = playTurn(config(order('attack', 'powers', 'block'), 0), hand(), 0, { energy: 4 });
    expect(plays).toEqual([S, P, D, D]);
    expect(playTurn(config(order('attack', 'powers', 'block'), 99), hand(), 0, { energy: 4 })).toEqual(plays);
  });

  it('Tremble is first within the Attack group', () => {
    const hand = () => [card(S), card(D), card(P), card('tremble')];
    expect(playTurn(config(order('powers', 'attack', 'block')), hand(), 0, { energy: 3 })).toEqual([P, 'tremble', S]);
    expect(playTurn(config(order('block', 'powers', 'attack'), 0), hand(), 5, { energy: 3 })).toEqual([
      D,
      P,
      'tremble',
    ]);
  });

  it('the defaults: Greedy Damage = Attack, Powers, Block; Scared Block = Block (allow 0), Powers, Attack', () => {
    const hand = () => [card(D), card(S), card(P)];
    expect(playTurn(GREEDY_CONFIG, hand(), 10, { energy: 2 })).toEqual([S, P]);
    expect(playTurn(blockFirstConfig(0), hand(), 10, { energy: 2 })).toEqual([D, P]);
  });
});

describe('#130 Powers group', () => {
  it('plays the highest-value Power first; an X-cost Power only once no other is playable, never at 0 energy', () => {
    const flex = card('flex');
    const big = card('bigflex');
    const x = card('xflex');
    expect(pickPower([flex, big, x], 3)).toBe(big);
    expect(pickPower([x, flex], 3)).toBe(flex);
    expect(pickPower([x], 2)).toBe(x);
    expect(pickPower([x], 0)).toBeUndefined();
    expect(pickPower([card(S), card(D)], 3)).toBeUndefined();
  });

  it('an energy card is played first when only a Power could use the energy', () => {
    expect(playTurn(config(order('powers', 'attack', 'block')), [card(P), card('fuel')], 0, { energy: 0 })).toEqual([
      'fuel',
      P,
    ]);
  });

  it('in a combat, a Power-first strategy plays the fixture Power before attacking', () => {
    const d = dummyData();
    Object.assign(d.cards, { flex: { ...extra.flex!, keywords: ['innate'], simulated: true } });
    const strategy = config(order('powers', 'attack', 'block'));
    const r = simulateCombat(
      d,
      cfg({ enemyId: 'dummy', deck: deckOf(['flex', 1], ['strike', 5], ['defend', 4]), strategy, seed: 3 }),
      createStrategy(strategy),
      { log: true },
    );
    const plays = events(r.log!, 'play').map((p) => p.cardId);
    expect(plays[0]).toBe('flex');
    // Greedy (Attack first) plays its attacks before the Power.
    const g = simulateCombat(
      d,
      cfg({
        enemyId: 'dummy',
        deck: deckOf(['flex', 1], ['strike', 5], ['defend', 4]),
        strategy: GREEDY_CONFIG,
        seed: 3,
      }),
      createStrategy(GREEDY_CONFIG),
      { log: true },
    );
    const gPlays = events(g.log!, 'play').map((p) => p.cardId);
    expect(gPlays[0]).toBe(S);
    expect(gPlays.indexOf('flex')).toBeGreaterThan(0);
  });
});

describe('#132 draw rule', () => {
  const scared = blockFirstConfig(0);
  const bashFirst = GREEDY_CONFIG;

  it('0-cost draw cards are always played first, before blocking or attacking', () => {
    const hand = [card(D), card(D), card(S), card('soul')];
    expect(playTurn(scared, hand, 20)[0]).toBe('soul');
    expect(playTurn(bashFirst, [card(S), card('soul')], 0)[0]).toBe('soul');
    expect(playTurn(config(order('powers', 'attack', 'block')), [card(P), card('soul')], 0)[0]).toBe('soul');
  });

  it('a 0-cost card that also blocks or attacks counts, but only when it draws', () => {
    const free = (id: string, effects: CardDef['effects']) => {
      extra[id] = { ...cards.defend!, id, code: id, name: id, cost: 0, effects, upgraded: null };
      return card(id);
    };
    const drawBlock = () =>
      free('freeShrug', [
        { type: 'gainBlock', amount: 3 },
        { type: 'draw', amount: 1 },
      ]);
    const plainBlock = () => free('freeBlock', [{ type: 'gainBlock', amount: 3 }]);
    expect(playTurn(bashFirst, [card(S), drawBlock()], 0)[0]).toBe('freeShrug');
    expect(playTurn(bashFirst, [card(S), plainBlock()], 0)[0]).toBe(S);
  });

  it('Battle Trance goes after every other draw card, even a 0-cost one', () => {
    expect(playTurn(bashFirst, [card(S), card('trance'), card('soul')], 0).slice(0, 2)).toEqual(['soul', 'trance']);
  });

  it('never draws when nothing can be drawn', () => {
    expect(playTurn(scared, [card(D), card('soul')], 20, { drawPile: 0 })[0]).toBe(D);
  });

  describe('1-cost pure draw cards play first only when the top group cannot be filled', () => {
    it('Block first: the block cards in hand cannot reach the allow-X target', () => {
      // 20 incoming, allow 0: Defend (5) x2 with 3 energy reaches only 10 → draw first.
      expect(playTurn(scared, [card(D), card(D), card('scry'), card(S)], 20)[0]).toBe('scry');
      // Allow 12 → 10 block leaves 10 through, within the allowance: no draw first.
      const roomy = blockFirstConfig(12);
      expect(playTurn(roomy, [card(D), card(D), card('scry'), card(S)], 20)[0]).toBe(D);
    });

    it('#127: a net-energy card (Fuel) is played before the pure draw card, which then follows', () => {
      const plays = playTurn(scared, [card(D), card(D), card('scry'), card('fuel')], 20);
      expect(plays.slice(0, 2)).toEqual(['fuel', 'scry']);
    });

    it('Block first: enough block cards to reach the target means the draw card waits', () => {
      // Three Defends (15) cover 15 incoming with 3 energy.
      const hand = [card(D), card(D), card(D), card('scry')];
      expect(playTurn(scared, hand, 15)[0]).toBe(D);
      // Nothing incoming: the group is already filled.
      expect(playTurn(scared, [card('scry'), card(S)], 0)[0]).toBe(S);
    });

    it('Block first: the target counts only what the energy can pay for', () => {
      // Heavy block card costs 3 energy, but with 2 energy it can't be played: draw.
      extra.wall = {
        ...cards.defend!,
        id: 'wall',
        code: 'Wl',
        name: 'Wall',
        cost: 3,
        effects: [{ type: 'gainBlock', amount: 30 }],
        upgraded: null,
      };
      expect(playTurn(scared, [card('wall'), card('scry'), card(S)], 20, { energy: 2 })[0]).toBe('scry');
      expect(playTurn(scared, [card('wall'), card('scry'), card(S)], 20, { energy: 3 })[0]).toBe('wall');
    });

    it('Attack first: no attack card to play', () => {
      expect(playTurn(bashFirst, [card('scry'), card(D), card(D)], 0)[0]).toBe('scry');
      expect(playTurn(bashFirst, [card('scry'), card(S), card(D)], 0)[0]).toBe(S);
      // An attack that costs more than the energy left doesn't count.
      expect(playTurn(bashFirst, [card('scry'), card('heavy')], 0, { energy: 2 })[0]).toBe('scry');
    });

    it('Powers first: no affordable Power', () => {
      const powersFirst = config(order('powers', 'attack', 'block'));
      expect(playTurn(powersFirst, [card('scry'), card(S)], 0)[0]).toBe('scry');
      expect(playTurn(powersFirst, [card('scry'), card(S), card(P)], 0)[0]).toBe(P);
    });

    it('after the draw card the turn is re-planned with the new hand', () => {
      expect(playTurn(bashFirst, [card('scry'), card(D)], 0, { energy: 3 })).toEqual(['scry', D, D].slice(0, 2));
    });

    it('when it is not needed first, a pure draw card plays after the groups and before leftover block', () => {
      // Attack first with a Strike: Strike, then Scry (groups done), then leftover block.
      expect(playTurn(bashFirst, [card('scry'), card(S), card(D)], 0, { energy: 3 })).toEqual([S, 'scry', D]);
    });

    it('does not play when nothing can be drawn', () => {
      expect(playTurn(bashFirst, [card('scry'), card(D)], 0, { drawPile: 0 })).toEqual([D]);
    });
  });

  it('draw cards that also attack or block stay ranked within their group', () => {
    // Block first: Shrug (8) is the best block card; Pommel (9) waits for the Attack group.
    expect(playTurn(scared, [card(D), card('shrug'), card('pommel')], 20)[0]).toBe('shrug');
    // Attack first: Pommel beats Strike.
    expect(playTurn(bashFirst, [card(S), card('pommel')], 0)[0]).toBe('pommel');
  });

  it('cannotFillTopGroup reads the top group and the energy', () => {
    const view = (hand: CardInstance[], energy: number, incoming = 0) =>
      viewOf(
        {
          turn: 1,
          player: {
            hp: 80,
            maxHp: 80,
            block: 0,
            energy,
            strength: 0,
            debuffs: { vulnerable: 0, weak: 0, frail: 0 },
            drawPile: [card(S)],
            hand,
            discardPile: [],
            exhaustPile: [],
          },
          enemy: {
            enemyId: 'x',
            name: 'x',
            hp: 1,
            maxHp: 1,
            block: 0,
            strength: 0,
            debuffs: { vulnerable: 0, weak: 0, frail: 0 },
            poison: 0,
            patternIndex: 0,
          },
        } satisfies CombatState,
        incoming,
      );
    expect(cannotFillTopGroup(view([card(D)], 3), GREEDY_CONFIG)).toBe(true);
    expect(cannotFillTopGroup(view([card(S)], 3), GREEDY_CONFIG)).toBe(false);
    expect(cannotFillTopGroup(view([card(D)], 3, 5), scared)).toBe(false);
    expect(cannotFillTopGroup(view([card(D)], 3, 20), scared)).toBe(true);
    expect(cannotFillTopGroup(view([card('xattack')], 0), GREEDY_CONFIG)).toBe(true);
  });
});
