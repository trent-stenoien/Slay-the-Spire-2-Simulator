import { describe, expect, it } from 'vitest';
import { makeCardInstance } from './combat';
import {
  createStrategy,
  normalizeConfig,
  parseStrategyCode,
  pickAttack,
  pickBlock,
  sameConfig,
  strategyCode,
  GREEDY_CONFIG,
  blockFirstConfig,
} from './strategies';
import { cards } from './testFixtures';
import type { CardDef, CardInstance, CombatState, StrategyConfig, StrategyView } from './types';

/** Extra test cards: Tremble (#1), energy gain (#22), X-cost (#23). */
const extra: Record<string, CardDef> = {
  tremble: {
    ...cards.defend!,
    id: 'tremble',
    code: 'Tl',
    cost: 1,
    keywords: ['exhaust'],
    effects: [{ type: 'applyVulnerable', amount: 3 }],
    upgraded: { effects: [{ type: 'applyVulnerable', amount: 4 }] },
  },
  fuel: {
    ...cards.defend!,
    id: 'fuel',
    code: 'Fu',
    cost: 0,
    keywords: ['exhaust'],
    effects: [{ type: 'gainEnergy', amount: 1 }],
    upgraded: null,
  },
  ritual: {
    ...cards.defend!,
    id: 'ritual',
    code: 'FR',
    cost: 1,
    keywords: ['exhaust'],
    effects: [{ type: 'gainEnergy', amount: 3 }],
    upgraded: null,
  },
  /** Gains exactly its cost back: not a net energy card. */
  wash: {
    ...cards.defend!,
    id: 'wash',
    code: 'Wa',
    cost: 1,
    effects: [{ type: 'gainEnergy', amount: 1 }],
    upgraded: null,
  },
  whirlwind: {
    ...cards.strike!,
    id: 'whirlwind',
    code: 'Wh',
    cost: 0,
    xCost: true,
    effects: [{ type: 'attack', damage: 5, hits: 1, allEnemies: true, xTimes: true }],
    upgraded: null,
  },
  xblock: {
    ...cards.defend!,
    id: 'xblock',
    code: 'XB',
    cost: 0,
    xCost: true,
    effects: [{ type: 'gainBlock', amount: 20 }],
    upgraded: null,
  },
};

let nextUid = 0;
function card(id: keyof typeof cards | keyof typeof extra, upgraded = false): CardInstance {
  return makeCardInstance((cards[id] ?? extra[id])!, upgraded, nextUid++);
}

/**
 * Drive one player turn with a strategy against a fixed incoming intent.
 * Only block and energy are tracked; returns the cardIds played in order.
 */
function playTurn(config: StrategyConfig, hand: CardInstance[], incoming: number, energy = 3): string[] {
  return playTurnCards(config, hand, incoming, energy).map((c) => c.cardId);
}

/** Like playTurn, but returns the card instances played (to check which copy went first). */
function playTurnCards(config: StrategyConfig, hand: CardInstance[], incoming: number, energy = 3): CardInstance[] {
  const strategy = createStrategy(config);
  const state = {
    turn: 1,
    player: {
      hp: 80,
      maxHp: 80,
      block: 0,
      energy,
      strength: 0,
      debuffs: { vulnerable: 0, weak: 0, frail: 0 },
      drawPile: [],
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
  const played: CardInstance[] = [];
  for (let i = 0; i < 50; i++) {
    const view: StrategyView = {
      state,
      intent: {
        moveId: 'm',
        name: 'm',
        attacks: incoming > 0 ? [{ damagePerHit: incoming, hits: 1 }] : [],
        totalIncoming: incoming,
      },
      playable: state.player.hand.filter((c) => c.cost !== null && c.cost <= state.player.energy),
    };
    const d = strategy.decide(view);
    if (d.kind === 'endTurn') return played;
    const idx = state.player.hand.findIndex((c) => c.uid === d.uid);
    const c = state.player.hand[idx]!;
    expect(view.playable).toContain(c);
    state.player.hand.splice(idx, 1);
    state.player.energy -= c.xCost ? state.player.energy : c.cost!;
    for (const e of c.effects) {
      if (e.type === 'gainBlock') state.player.block += e.amount;
      if (e.type === 'gainEnergy') state.player.energy += e.amount;
    }
    played.push(c);
  }
  throw new Error('strategy never ended its turn');
}

const S = 'strike';
const D = 'defend';
const B = 'bash';

function starterHand(): CardInstance[] {
  return [card(S), card(S), card(D), card(D), card(D)];
}

describe('block strategy (allow through X)', () => {
  it('X=1 with 6 incoming plays exactly one Defend, then attacks', () => {
    expect(playTurn(blockFirstConfig(1), starterHand(), 6)).toEqual([D, S, S]);
  });

  it('X=1 with 7 incoming plays two Defends', () => {
    expect(playTurn(blockFirstConfig(1), starterHand(), 7)).toEqual([D, D, S]);
  });

  it('X=0 blocks everything possible', () => {
    expect(playTurn(blockFirstConfig(0), starterHand(), 5)).toEqual([D, S, S]);
    expect(playTurn(blockFirstConfig(0), starterHand(), 11)).toEqual([D, D, D]);
  });

  it('X=4 blocks with a 5-block Defend only when it is fully used', () => {
    const b4: StrategyConfig = blockFirstConfig(4);
    expect(playTurn(b4, starterHand(), 4)).toEqual([S, S, D]);
    expect(playTurn(b4, starterHand(), 5)).toEqual([D, S, S]);
    expect(playTurn(b4, starterHand(), 9)).toEqual([D, S, S]);
    expect(playTurn(b4, starterHand(), 10)).toEqual([D, D, S]);
  });

  it('non-attack intent: no blocking before attacks, leftover energy goes to block', () => {
    expect(playTurn(blockFirstConfig(0), starterHand(), 0)).toEqual([S, S, D]);
  });

  it('plays the largest block card first', () => {
    const hand = [card(D), card('ultimate_defend'), card(S)];
    expect(playTurn(blockFirstConfig(0), hand, 20, 1)).toEqual(['ultimate_defend']);
  });
});

describe('greedy damage strategy', () => {
  it('plays Bash before Strikes with 2+ energy', () => {
    const hand = [card(S), card(S), card(B), card(D), card(D)];
    expect(playTurn(GREEDY_CONFIG, hand, 12)).toEqual([B, S]);
  });

  it('plays a Strike when Bash is unaffordable, then block with leftovers', () => {
    const hand = [card(B), card(S), card(D)];
    expect(playTurn(GREEDY_CONFIG, hand, 12, 2)).toEqual([B]);
    expect(playTurn(GREEDY_CONFIG, [card(B), card(S), card(D)], 12, 1)).toEqual([S]);
    expect(playTurn(GREEDY_CONFIG, [card(S), card(D), card(D)], 12)).toEqual([S, D, D]);
  });

  it('prefers the highest total base damage', () => {
    const hand = [card(S), card('ultimate_strike'), card(S, true)];
    expect(playTurn(GREEDY_CONFIG, hand, 0, 1)).toEqual(['ultimate_strike']);
  });

  it('ends turn when nothing is playable', () => {
    expect(playTurn(GREEDY_CONFIG, [card('ascenders_bane')], 0)).toEqual([]);
  });
});

describe('pick helpers', () => {
  it('break ties by lowest uid', () => {
    const a = makeCardInstance(cards[S]!, false, 7);
    const b = makeCardInstance(cards[S]!, false, 3);
    expect(pickAttack([a, b])!.uid).toBe(3);
    const c = makeCardInstance(cards[D]!, false, 9);
    const d = makeCardInstance(cards[D]!, false, 4);
    expect(pickBlock([c, d])!.uid).toBe(4);
  });

  it('Vulnerable-appliers beat higher-damage attacks', () => {
    const us = makeCardInstance(cards.ultimate_strike!, true, 0);
    const bash = makeCardInstance(cards.bash!, false, 1);
    expect(pickAttack([us, bash])!.cardId).toBe('bash');
  });
});

const G: StrategyConfig = GREEDY_CONFIG;
const B0: StrategyConfig = blockFirstConfig(0);
const B4: StrategyConfig = blockFirstConfig(4);

describe('Tremble first (#1)', () => {
  it('Greedy plays Tremble before Bash and Strikes', () => {
    expect(playTurn(G, [card(S), card(B), card('tremble'), card(D)], 12)).toEqual(['tremble', B]);
  });

  it('#130: Tremble is first within the Attack group, so block-first strategies block before it', () => {
    expect(playTurn(B0, [card(D), card(D), card('tremble'), card(S)], 10)).toEqual([D, D, 'tremble']);
    // Nothing to block: the Block group is done, so the Attack group starts with Tremble.
    expect(playTurn(B4, [card(S), card(D), card('tremble')], 0)).toEqual(['tremble', S, D]);
    // Powers, Attack, Block: no Power in hand, so Tremble then attacks.
    const pab: StrategyConfig = { order: ['powers', 'attack', 'block'], allowThrough: 0 };
    expect(playTurn(pab, [card(D), card(S), card('tremble')], 10)).toEqual(['tremble', S, D]);
  });

  it('upgraded Tremble counts too; two Trembles go lowest uid first', () => {
    const t1 = card('tremble', true);
    const t2 = card('tremble');
    expect(t1.uid).toBeLessThan(t2.uid);
    // Hand order puts the higher uid first, so only the uid tie-break explains t1 going first.
    expect(playTurnCards(G, [card(S), t2, t1], 0, 2).map((c) => c.uid)).toEqual([t1.uid, t2.uid]);
    expect(playTurnCards(G, [card(S), card('tremble', true)], 0, 1).map((c) => c.cardId)).toEqual(['tremble']);
  });

  it('Tremble is played only while affordable; it does not block other plays', () => {
    expect(playTurn(G, [card('tremble')], 0, 0)).toEqual([]);
    // Bash first would leave 0 for Tremble; Tremble first leaves 1 for a Strike.
    expect(playTurn(G, [card(B), card(S), card('tremble')], 0, 2)).toEqual(['tremble', S]);
  });
});

describe('energy gain (#22)', () => {
  it('Greedy plays a net energy card first, then uses the extra energy', () => {
    // 3 energy + Ritual (1 → 3) = 5: Bash (2) + 3 Strikes.
    const hand = [card(S), card(S), card(S), card(B), card('ritual')];
    expect(playTurn(G, hand, 0)).toEqual(['ritual', B, S, S, S]);
  });

  it('block strategies play it first too, and the extra energy goes to block and attacks', () => {
    const hand = [card(D), card(D), card(S), card(S), card('fuel')];
    expect(playTurn(B0, hand, 10)).toEqual(['fuel', D, D, S, S]);
  });

  it('Tremble still comes before the energy card', () => {
    expect(playTurn(G, [card(S), card('fuel'), card('tremble')], 0, 1)).toEqual(['tremble', 'fuel', S]);
  });

  it('an energy card with nothing to spend it on stays in hand', () => {
    expect(playTurn(G, [card('fuel')], 0)).toEqual([]);
    expect(playTurn(G, [card('fuel'), card('ascenders_bane')], 0)).toEqual([]);
  });

  it('a card that only gains back its cost is not played first', () => {
    expect(playTurn(G, [card('wash'), card(S)], 0, 1)).toEqual([S]);
  });

  it('at 0 energy, Fuel unlocks a Strike', () => {
    expect(playTurn(G, [card(S), card('fuel')], 0, 0)).toEqual(['fuel', S]);
  });
});

describe('X-cost (#23)', () => {
  it('Greedy plays X-cost attacks last among attacks, with the leftover energy', () => {
    expect(playTurn(G, [card('whirlwind'), card(S), card(D)], 0)).toEqual([S, 'whirlwind']);
    expect(playTurn(G, [card('whirlwind'), card(B), card(S)], 0, 3)).toEqual([B, S]);
  });

  it('never plays an X-cost card at 0 energy', () => {
    expect(playTurn(G, [card('whirlwind')], 0, 0)).toEqual([]);
    expect(playTurn(B0, [card('xblock')], 20, 0)).toEqual([]);
  });

  it('block strategy: blocks first, then the X attack takes what is left', () => {
    expect(playTurn(B0, [card('whirlwind'), card(D), card(S)], 5)).toEqual([D, S, 'whirlwind']);
  });

  it('X-cost block cards are block, played after other block cards', () => {
    expect(playTurn(B0, [card('xblock'), card(D), card(S)], 30)).toEqual([D, 'xblock']);
  });

  it('energy cards come before the X attack so X is larger', () => {
    expect(playTurn(G, [card('whirlwind'), card('ritual')], 0)).toEqual(['ritual', 'whirlwind']);
  });

  it('pickAttack scores an X attack by the current energy but still ranks it last', () => {
    const w = card('whirlwind');
    const s = card(S);
    expect(pickAttack([w, s], 5)!.uid).toBe(s.uid);
    expect(pickAttack([w], 5)!.uid).toBe(w.uid);
    expect(pickAttack([w], 0)).toBeUndefined();
    expect(pickBlock([card('xblock')], 0)).toBeUndefined();
  });
});

describe('strategy codes (#130)', () => {
  const cfg = (order: string, allowThrough = 0): StrategyConfig => ({
    order: order.split('').map((l) => ({ a: 'attack', b: 'block', p: 'powers' })[l]!) as StrategyConfig['order'],
    allowThrough,
  });

  it('encodes the order as letters, with X after "b" unless Block is last', () => {
    expect(strategyCode(GREEDY_CONFIG)).toBe('apb');
    expect(strategyCode(blockFirstConfig(4))).toBe('b4pa');
    expect(strategyCode(blockFirstConfig(0))).toBe('b0pa');
    expect(strategyCode(cfg('pba', 5))).toBe('pb5a');
    expect(strategyCode(cfg('abp', 12))).toBe('ab12p');
    expect(strategyCode(cfg('pab'))).toBe('pab');
  });

  it('parses the old codes: g = Attack, Powers, Block; b<X> = Block (allow X), Powers, Attack', () => {
    expect(parseStrategyCode('g')).toEqual({ order: ['attack', 'powers', 'block'], allowThrough: 0 });
    expect(parseStrategyCode('b4')).toEqual({ order: ['block', 'powers', 'attack'], allowThrough: 4 });
    expect(parseStrategyCode('b0')).toEqual({ order: ['block', 'powers', 'attack'], allowThrough: 0 });
    expect(parseStrategyCode('b9999')).toEqual(blockFirstConfig(9999));
    // Old codes come back in the new form.
    expect(strategyCode(parseStrategyCode('g')!)).toBe('apb');
    expect(strategyCode(parseStrategyCode('b12')!)).toBe('b12pa');
  });

  it('round-trips every order and a range of X', () => {
    const orders = ['abp', 'apb', 'bap', 'bpa', 'pab', 'pba'];
    for (const o of orders) {
      for (const x of [0, 1, 5, 42, 9999]) {
        const c = normalizeConfig(cfg(o, x))!;
        const code = strategyCode(c);
        expect(parseStrategyCode(code)).toEqual(c);
        expect(strategyCode(parseStrategyCode(code)!)).toBe(code);
      }
    }
    for (const code of ['apb', 'pab', 'b0pa', 'b5ap', 'ab3p', 'pb5a', 'ab9999p']) {
      expect(strategyCode(parseStrategyCode(code)!)).toBe(code);
    }
  });

  it('rejects invalid codes', () => {
    for (const c of [
      '',
      'G',
      'b',
      'b-1',
      'b01',
      'b1.5',
      'x4',
      'g1',
      'b4 ',
      'ab',
      'abpa',
      'aab',
      'bpa', // Block not last needs its X
      'apb0', // ...and Block last takes none
      'a1bp', // X only after "b"
      'b01pa',
      'b10000pa',
      'ABP',
    ]) {
      expect(parseStrategyCode(c)).toBeNull();
    }
  });

  it('normalizeConfig migrates old configs and canonicalizes X', () => {
    expect(normalizeConfig({ kind: 'greedyDamage' })).toEqual(GREEDY_CONFIG);
    expect(normalizeConfig({ kind: 'block', allowThrough: 3 })).toEqual(blockFirstConfig(3));
    expect(normalizeConfig({ kind: 'block', allowThrough: -1 })).toBeNull();
    expect(normalizeConfig({ order: ['attack', 'powers', 'block'], allowThrough: 8 })).toEqual(GREEDY_CONFIG);
    expect(normalizeConfig({ order: ['attack', 'attack', 'block'], allowThrough: 0 })).toBeNull();
    expect(normalizeConfig(null)).toBeNull();
    expect(sameConfig(cfg('apb', 8), GREEDY_CONFIG)).toBe(true);
    expect(sameConfig(cfg('pba', 1), cfg('pba', 2))).toBe(false);
  });

  it('createStrategy rejects an invalid config', () => {
    expect(() => createStrategy(cfg('aab'))).toThrow(/Invalid strategy config/);
  });
});
