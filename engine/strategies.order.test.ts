/** #130 strategies: a user-ordered priority of Attack, Block and Powers, and the new draw rule. */
import { describe, expect, it } from 'vitest';
import { makeCardInstance, simulateCombat } from './combat';
import { cfg, deckOf, dummyData, events } from './combatTestHelpers';
import { blockFirstConfig, createStrategy, drawGoesFirst, GREEDY_CONFIG, isBaseCard, pickPower } from './strategies';
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

describe('#130 draw rule: draw goes to the top only when non-base cards can’t use all the energy', () => {
  const scared = blockFirstConfig(0);

  it('base cards are Strike and Defend only', () => {
    expect(isBaseCard(card(S))).toBe(true);
    expect(isBaseCard(card(D))).toBe(true);
    expect(isBaseCard(card('pommel'))).toBe(false);
    expect(isBaseCard(card('bash'))).toBe(false);
  });

  it('with only Strikes and Defends besides the draw card, draw goes first, even before blocking', () => {
    const hand = [card(D), card(D), card(S), card('pommel'), card(S)];
    expect(playTurn(scared, hand, 20)[0]).toBe('pommel');
    expect(playTurn(scared, [card(D), card('shrug'), card(S), card(S)], 0)[0]).toBe('shrug');
  });

  it('when the non-base cards can use all the energy, draw cards are ranked within their group', () => {
    // Heavy (3) uses all 3 energy: Scared Block blocks first; Pommel waits its turn in Attack.
    const hand = [card(D), card(D), card('heavy'), card('pommel'), card(S)];
    expect(playTurn(scared, hand, 20)[0]).toBe(D);
    // Shrug is still the best block card in the Block group (8 > 5).
    const blocks = [card(D), card('shrug'), card('heavy'), card(S)];
    expect(playTurn(scared, blocks, 20)[0]).toBe('shrug');
  });

  it('a pure draw card waits until the groups are done when the non-base cards can use the energy', () => {
    expect(playTurn(GREEDY_CONFIG, [card('soul'), card('heavy'), card(S)], 0)).toEqual(['heavy', 'soul']);
    // Without Heavy, the non-base cards can't use the energy: Soul first.
    expect(playTurn(GREEDY_CONFIG, [card('soul'), card(S), card(S)], 0)).toEqual(['soul', S, S]);
  });

  it('an X-cost non-base card can use any energy; a net-energy card does not count', () => {
    const withX = [card(D), card('xattack'), card('pommel'), card(S)];
    expect(playTurn(scared, withX, 20)[0]).toBe(D);
    // Fuel nets energy, so only Strikes/Defends are left to use it: Fuel (energy rule), then Pommel.
    const withFuel = [card(D), card('fuel'), card('pommel'), card(S), card(D)];
    expect(playTurn(scared, withFuel, 20).slice(0, 2)).toEqual(['fuel', 'pommel']);
  });

  it('never goes first when nothing can be drawn', () => {
    const hand = [card(D), card(D), card(S), card('pommel'), card(S)];
    expect(playTurn(scared, hand, 20, { drawPile: 0 })[0]).toBe(D);
  });

  it('drawGoesFirst compares the non-base, non-draw costs with the energy', () => {
    const state = (hand: CardInstance[], energy: number) =>
      ({
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
      }) satisfies CombatState;
    const bash = () => card('bash'); // 2 energy
    expect(drawGoesFirst(viewOf(state([card('pommel'), bash(), card(S)], 3), 0))).toBe(true);
    expect(drawGoesFirst(viewOf(state([card('pommel'), bash(), card(P)], 3), 0))).toBe(false);
    expect(drawGoesFirst(viewOf(state([card('pommel'), bash()], 2), 0))).toBe(false);
    expect(drawGoesFirst(viewOf(state([card('pommel')], 0), 0))).toBe(false);
  });
});
