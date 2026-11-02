/** #108 / #129 strategy rules: exhaust order, Purity's limits, Brand / Burning Pact early, Second Wind / Fiend Fire placement. */
import { describe, expect, it } from 'vitest';
import { makeCardInstance, simulateCombat } from './combat';
import {
  cardValue,
  chooseExhaust,
  createStrategy,
  exhaustOrder,
  exhaustTier,
  isPlainBlock,
  planTurn,
  worthExhausting,
  GREEDY_CONFIG,
  blockFirstConfig,
} from './strategies';
import { cards } from './testFixtures';
import { cfg, deckOf, dummyData, events } from './combatTestHelpers';
import type {
  CardDef,
  CardInstance,
  ChoiceRequest,
  CombatState,
  Effect,
  GameData,
  StrategyConfig,
  StrategyView,
} from './types';
import { isPlayable } from './rules';

const skill = (id: string, effects: Effect[], extra: Partial<CardDef> = {}): CardDef => ({
  ...cards.defend!,
  id,
  code: 'Zz',
  name: id,
  cost: 0,
  effects,
  upgraded: null,
  ...extra,
});

const extra: Record<string, CardDef> = {
  pact: skill('pact', [
    { type: 'exhaustCards', count: 1, mode: 'choose' },
    { type: 'draw', amount: 2 },
  ]),
  brand: skill('brand', [
    { type: 'loseHp', amount: 1 },
    { type: 'exhaustCards', count: 1, mode: 'choose' },
    { type: 'gainStrength', amount: 1 },
  ]),
  purity: skill('purity', [{ type: 'exhaustCards', count: 3, mode: 'choose', upTo: true }], {
    keywords: ['retain', 'exhaust'],
  }),
  wind: skill(
    'wind',
    [
      { type: 'exhaustCards', mode: 'all', filter: { notTypes: ['attack'] } },
      { type: 'repeat', per: 'lastEffectCount', effects: [{ type: 'gainBlock', amount: 5 }] },
    ],
    { cost: 1 },
  ),
  fiend: {
    ...cards.strike!,
    id: 'fiend',
    cost: 2,
    keywords: ['exhaust'],
    effects: [{ type: 'script', id: 'fiendFire', values: [7] }],
    upgraded: null,
  },
  drum: skill('drum', [{ type: 'draw', amount: 2 }], {
    cost: 1,
    triggers: [{ when: 'exhausted', effects: [{ type: 'gainEnergy', amount: 2 }] }],
  }),
  /** A status that hurts while in hand (modelled on Burn; #115 will add the real trigger). */
  burn: skill('burn', [], {
    type: 'status',
    cost: null,
    keywords: ['unplayable'],
    triggers: [{ when: 'turnEndInHand', effects: [{ type: 'loseHp', amount: 2 }] }],
  }),
  dazed: skill('dazed', [], { type: 'status', cost: null, keywords: ['unplayable', 'ethereal'] }),
  shrug: skill(
    'shrug',
    [
      { type: 'gainBlock', amount: 8 },
      { type: 'draw', amount: 1 },
    ],
    { cost: 1 },
  ),
  twin: { ...cards.strike!, id: 'twin', effects: [{ type: 'attack', damage: 5, hits: 2 }], upgraded: null },
  /** A block-only card better than a Defend (12 Block). */
  wall: skill('wall', [{ type: 'gainBlock', amount: 12 }], { cost: 1 }),
  /** A fixture Power (none are simulated yet, #109). */
  flex: skill('flex', [{ type: 'gainStrength', amount: 2 }], { type: 'power', cost: 1 }),
};

function data(): GameData {
  const d = dummyData();
  Object.assign(d.cards, structuredClone(extra));
  return d;
}

let uid = 0;
/** A card instance by id; `+` suffix = upgraded. */
function card(id: string): CardInstance {
  const up = id.endsWith('+');
  const base = up ? id.slice(0, -1) : id;
  const all = { ...cards, ...extra };
  const def = all[base]!;
  return makeCardInstance(up && !def.upgraded ? { ...def, upgraded: {} } : def, up, uid++);
}

/** A view with `hand` in hand and `energy` energy; the enemy intends `incoming` damage. */
function viewOf(
  hand: CardInstance[],
  energy = 3,
  incoming = 0,
  enemy: { hp?: number; block?: number; vulnerable?: number } = {},
): StrategyView {
  const state = {
    turn: 1,
    player: {
      hp: 80,
      maxHp: 80,
      block: 0,
      energy,
      strength: 0,
      debuffs: { vulnerable: 0, weak: 0, frail: 0 },
      drawPile: [card('strike')],
      hand,
      discardPile: [],
      exhaustPile: [],
    },
    enemy: {
      enemyId: 'dummy',
      name: 'dummy',
      hp: enemy.hp ?? 50,
      maxHp: 50,
      block: enemy.block ?? 0,
      strength: 0,
      debuffs: { vulnerable: enemy.vulnerable ?? 0, weak: 0, frail: 0 },
      poison: 0,
      patternIndex: 0,
    },
  } as CombatState;
  return {
    state,
    intent: {
      moveId: 'x',
      name: 'x',
      attacks: incoming ? [{ damagePerHit: incoming, hits: 1 }] : [],
      totalIncoming: incoming,
    },
    playable: hand.filter((c) => isPlayable(c, energy)),
  };
}

const request = (options: CardInstance[], min: number, max: number): ChoiceRequest => ({
  purpose: 'exhaust',
  from: 'hand',
  to: 'exhaust',
  options,
  min,
  max,
});

const ids = (cs: readonly { cardId: string; upgraded: boolean }[]) => cs.map((c) => c.cardId + (c.upgraded ? '+' : ''));

describe('#108 exhaust order (every strategy)', () => {
  it('tiers: exhaust-benefit, curses/statuses, Strike, Defend, Strike+, Defend+, then the rest', () => {
    expect(
      ['drum', 'burn', 'ascenders_bane', 'strike', 'defend', 'strike+', 'defend+', 'bash'].map((id) =>
        exhaustTier(card(id)),
      ),
    ).toEqual([1, 2, 2, 3, 4, 5, 6, 7]);
  });

  it('full order: Drum, damaging status, other curse/status, Strike, Defend, Strike+, Defend+, lowest value', () => {
    const hand = ['bash', 'defend+', 'strike+', 'shrug', 'defend', 'strike', 'dazed', 'burn', 'drum+', 'drum'].map(
      card,
    );
    expect(ids(exhaustOrder(hand))).toEqual([
      'drum',
      'drum+',
      'burn',
      'dazed',
      'strike',
      'defend',
      'strike+',
      'defend+',
      'shrug',
      'bash',
    ]);
  });

  it('within a tier the non-upgraded copy goes first, then lowest uid', () => {
    const [a, b, c] = [card('bash+'), card('bash'), card('bash')];
    expect(exhaustOrder([a!, b!, c!]).map((x) => x.uid)).toEqual([b!.uid, c!.uid, a!.uid]);
  });

  it('the rest goes by lowest value (Shrug It Off 8 Block + draw < Twin Strike 10 < Bash 8 + 2 Vulnerable)', () => {
    expect(cardValue(card('shrug'))).toBe(11);
    expect(cardValue(card('twin'))).toBe(10);
    expect(cardValue(card('bash'))).toBe(14);
    expect(ids(exhaustOrder(['bash', 'shrug', 'twin'].map(card)))).toEqual(['twin', 'shrug', 'bash']);
  });

  it('worth exhausting: tiers 1–2 and non-upgraded Strike / Defend only', () => {
    expect(
      ['drum', 'burn', 'strike', 'defend', 'strike+', 'defend+', 'bash'].map((id) => worthExhausting(card(id))),
    ).toEqual([true, true, true, true, false, false, false]);
  });

  it('"Exhaust 1 card" takes the first card in the order', () => {
    const hand = ['bash', 'defend', 'strike+', 'strike'].map(card);
    expect(chooseExhaust(viewOf(hand), request(hand, 1, 1)).uids).toEqual([hand[3]!.uid]);
  });
});

describe('#108 Purity ("up to 3/5")', () => {
  const pick = (hand: string[], max: number) => {
    const cs = hand.map(card);
    const res = chooseExhaust(viewOf(cs), request(cs, 0, max));
    return res.uids.map((u) => ids([cs.find((c) => c.uid === u)!])[0]);
  };

  it('takes every tier 1–2 card up to the limit before any Strike or Defend', () => {
    expect(pick(['strike', 'defend', 'burn', 'dazed', 'drum'], 3)).toEqual(['drum', 'burn', 'dazed']);
  });

  it('fills the remaining slots with non-upgraded Strikes, then non-upgraded Defends', () => {
    expect(pick(['defend', 'strike', 'dazed', 'defend', 'strike'], 5)).toEqual([
      'dazed',
      'strike',
      'strike',
      'defend',
      'defend',
    ]);
  });

  it('never takes upgraded Strikes / Defends or other cards, even with slots left', () => {
    expect(pick(['strike+', 'defend+', 'bash', 'shrug', 'strike'], 5)).toEqual(['strike']);
    expect(pick(['strike+', 'bash'], 3)).toEqual([]);
  });

  it('stops at the limit', () => {
    expect(pick(['strike', 'strike', 'strike', 'strike'], 3)).toHaveLength(3);
  });
});

describe('#108 Brand, Burning Pact and Purity are played early, only with something worth exhausting', () => {
  const greedy = createStrategy(GREEDY_CONFIG);
  const block = createStrategy(blockFirstConfig(0));

  it('played first (before attacks) when a tier 1–4 card is in hand', () => {
    for (const s of [greedy, block]) {
      for (const enabler of ['pact', 'brand', 'purity']) {
        for (const target of ['strike', 'defend', 'burn', 'drum']) {
          const hand = [card('bash'), card(enabler), card(target)];
          expect(s.decide(viewOf(hand, 3, 10))).toEqual({ kind: 'play', uid: hand[1]!.uid });
        }
      }
    }
  });

  it('not played when only upgraded basics or other cards could be exhausted', () => {
    for (const enabler of ['pact', 'brand', 'purity']) {
      const hand = [card(enabler), card('strike+'), card('defend+'), card('bash')];
      const v = viewOf(hand, 3);
      expect(greedy.decide(v)).toEqual({ kind: 'play', uid: hand[3]!.uid });
      // With nothing else affordable, the turn ends rather than playing it.
      const alone = [card(enabler), card('strike+')];
      expect(greedy.decide(viewOf(alone, 0))).toEqual({ kind: 'endTurn' });
    }
  });

  it("Burning Pact goes before Drum of Battle's own draw, so the Drum is exhausted for energy", () => {
    const hand = [card('drum'), card('pact'), card('bash')];
    expect(greedy.decide(viewOf(hand, 3))).toEqual({ kind: 'play', uid: hand[1]!.uid });
  });
});

const playsCard = (c: CardInstance) => ({ kind: 'play', uid: c.uid });

describe('#129 Fiend Fire', () => {
  const greedy = createStrategy(GREEDY_CONFIG);
  /** Block (allow 100), Powers, Attack: the Block group is done, so the turn reaches Attack. */
  const blockDone = createStrategy(blockFirstConfig(100));

  it('always played when it would kill (Vulnerable and enemy Block counted), even by a blocking strategy', () => {
    const hand = () => [card('fiend'), card('strike'), card('strike'), card('defend'), card('defend'), card('dazed')];
    const scared = createStrategy(blockFirstConfig(0));
    // 5 other cards × 7 = 35 < 30 HP + 10 Block: not lethal, so Scared Block blocks first.
    const h1 = hand();
    expect(scared.decide(viewOf(h1, 3, 20, { hp: 30, block: 10 }))).toEqual(playsCard(h1[3]!));
    // Vulnerable: 5 × floor(7 × 1.5) = 50 ≥ 40: lethal, Fiend Fire first.
    const h2 = hand();
    expect(scared.decide(viewOf(h2, 3, 20, { hp: 30, block: 10, vulnerable: 1 }))).toEqual(playsCard(h2[0]!));
  });

  it('played when its damage beats the other attacks the energy could buy (4 × 7 = 28 > 2 Strikes)', () => {
    const hand = [card('fiend'), card('strike'), card('strike'), card('defend'), card('defend')];
    expect(greedy.decide(viewOf(hand, 3))).toEqual(playsCard(hand[0]!));
    expect(blockDone.decide(viewOf(hand, 3))).toEqual(playsCard(hand[0]!));
    // Only a Strike else in hand: 2 × 7 = 14 > 6.
    const small = [card('fiend'), card('strike'), card('dazed')];
    expect(greedy.decide(viewOf(small, 3))).toEqual(playsCard(small[0]!));
  });

  it('not played while the other attacks deal more (3 × 7 = 21 < Twin + Twin + Strike = 26)', () => {
    const hand = [card('fiend'), card('twin'), card('twin'), card('strike')];
    expect(greedy.decide(viewOf(hand, 3))).toEqual(playsCard(hand[1]!));
    expect(blockDone.decide(viewOf(hand, 3))).toEqual(playsCard(hand[1]!));
    // Not enough energy for Fiend Fire: never chosen.
    const poor = [card('fiend'), card('strike'), card('strike'), card('strike')];
    expect(greedy.decide(viewOf(poor, 1))).toEqual(playsCard(poor[1]!));
  });

  it('greedy plays Vulnerable-appliers first while Fiend Fire stays affordable; other orders play Fiend Fire first', () => {
    const hand = () => [card('fiend'), card('bash'), card('strike'), card('strike'), card('defend')];
    const h1 = hand();
    expect(greedy.decide(viewOf(h1, 4))).toEqual(playsCard(h1[1]!)); // Bash (2) + Fiend Fire (2) = 4
    const h2 = hand();
    expect(blockDone.decide(viewOf(h2, 4))).toEqual(playsCard(h2[0]!));
    // 3 energy: Bash would leave too little, so Fiend Fire (28 > Bash 8 + Strike 6).
    const h3 = hand();
    expect(greedy.decide(viewOf(h3, 3))).toEqual(playsCard(h3[0]!));
  });

  it('greedy plays draw cards first (they grow the hand it exhausts); other orders do not wait', () => {
    // Shrug costs 1 here (a 0-cost draw card would always go first, #132).
    const hand = () => [card('fiend'), card('shrug'), card('twin'), card('strike'), card('dazed')];
    const h1 = hand();
    expect(greedy.decide(viewOf(h1, 3))).toEqual(playsCard(h1[1]!));
    const h2 = hand();
    expect(blockDone.decide(viewOf(h2, 3))).toEqual(playsCard(h2[0]!));
  });

  it('not played when the hand has nothing else to exhaust', () => {
    expect(greedy.decide(viewOf([card('fiend')], 2))).toEqual({ kind: 'endTurn' });
  });

  it('counts Strength per card exhausted', () => {
    const hand = [card('fiend'), card('twin'), card('twin'), card('strike')];
    const v = viewOf(hand, 3);
    (v.state.player as { strength: number }).strength = 3;
    // (7 + 3) × 3 = 30 < Twin 16 + Twin 16 + Strike 9 = 41, so Twin Strike.
    expect(greedy.decide(v)).toEqual(playsCard(hand[1]!));
    const many = [card('fiend'), card('strike'), card('defend'), card('defend'), card('dazed')];
    const v2 = viewOf(many, 3);
    (v2.state.player as { strength: number }).strength = 3;
    // (7 + 3) × 4 = 40 > Strike 9.
    expect(greedy.decide(v2)).toEqual(playsCard(many[0]!));
  });
});

describe('#129 Second Wind', () => {
  const scared = createStrategy(blockFirstConfig(0));

  it('plain block cards: a Defend (5) is plain against Second Wind (5); Defend+ (8) and Shrug (Block + draw) are not', () => {
    expect(isPlainBlock(card('defend'), 5)).toBe(true);
    expect(isPlainBlock(card('defend+'), 5)).toBe(false);
    expect(isPlainBlock(card('defend+'), 8)).toBe(true);
    expect(isPlainBlock(card('shrug'), 10)).toBe(false);
    expect(isPlainBlock(card('wall'), 5)).toBe(false);
  });

  it('goes before plain Defends, which it exhausts for Block (2 × 5 = 10)', () => {
    const hand = [card('wind'), card('defend'), card('defend'), card('strike')];
    expect(scared.decide(viewOf(hand, 3, 20))).toEqual(playsCard(hand[0]!));
  });

  it('a better block card the turn plan plays goes first, then Second Wind', () => {
    const hand = [card('shrug'), card('wind'), card('dazed'), card('dazed'), card('bash')];
    expect(scared.decide(viewOf(hand, 3, 20))).toEqual(playsCard(hand[0]!));
    const after = [card('wind'), card('defend'), card('dazed'), card('bash')];
    expect(scared.decide(viewOf(after, 2, 12))).toEqual(playsCard(after[0]!));
  });

  it('with energy for only one, the better block card wins unless Second Wind gives more', () => {
    const one = [card('wind'), card('wall'), card('dazed')]; // 2 × 5 = 10 < 12
    expect(scared.decide(viewOf(one, 1, 20))).toEqual(playsCard(one[1]!));
    const three = [card('wind'), card('wall'), card('dazed'), card('dazed')]; // 3 × 5 = 15 > 12
    expect(scared.decide(viewOf(three, 1, 20))).toEqual(playsCard(three[0]!));
  });

  it('a Power the turn plan plays is played before Second Wind; one it would not play is exhausted', () => {
    // Block, Powers, Attack with 3 energy: the plan (2 left after Second Wind) plays Defend, then Flex.
    const hand = [card('wind'), card('flex'), card('defend'), card('dazed')];
    expect(planTurn(viewOf(hand, 3, 20), blockFirstConfig(0), 2).map((c) => c.cardId)).toEqual(['defend', 'flex']);
    expect(scared.decide(viewOf(hand, 3, 20))).toEqual(playsCard(hand[1]!));
    // 1 energy: nothing else would be played, so Second Wind exhausts Flex, Defend and Dazed (15).
    const poor = [card('wind'), card('flex'), card('defend'), card('dazed')];
    expect(scared.decide(viewOf(poor, 1, 20))).toEqual(playsCard(poor[0]!));
  });

  it('Greedy (Block last) uses leftover energy on Second Wind before plain Defends', () => {
    const greedy = createStrategy(GREEDY_CONFIG);
    const hand = [card('wind'), card('defend'), card('defend'), card('strike')];
    expect(greedy.decide(viewOf(hand, 3))).toEqual(playsCard(hand[3]!)); // Attack first
    const left = [card('wind'), card('defend'), card('defend')];
    expect(greedy.decide(viewOf(left, 2))).toEqual(playsCard(left[0]!));
  });

  it('when the Block group is done, Second Wind still goes last with leftover energy', () => {
    const block = createStrategy(blockFirstConfig(100));
    const late = [card('wind'), card('dazed')];
    expect(block.decide(viewOf(late, 1))).toEqual(playsCard(late[0]!));
  });
});

describe('#108 strategies in combat', () => {
  it('built strategies answer exhaust choices with the shared order (Strike before Bash)', () => {
    const d = data();
    d.cards.pact = { ...d.cards.pact!, keywords: ['innate'] };
    d.cards.bash = { ...d.cards.bash!, keywords: ['innate'] };
    for (const config of [GREEDY_CONFIG, blockFirstConfig(0)] as StrategyConfig[]) {
      const r = simulateCombat(
        d,
        cfg({ enemyId: 'dummy', strategy: config, deck: deckOf(['pact', 1], ['bash', 1], ['strike', 8]) }),
        createStrategy(config),
        { log: true },
      );
      expect(events(r.log, 'exhaust')[0]).toMatchObject({ cardId: 'strike', reason: 'effect' });
    }
  });
});
