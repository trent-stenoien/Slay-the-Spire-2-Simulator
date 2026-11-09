/** #108 / #129 strategy rules: exhaust order, Purity's limits, Brand / Burning Pact early, Second Wind / Fiend Fire placement. */
import { describe, expect, it } from 'vitest';
import { makeCardInstance, simulateCombat } from './combat';
import {
  chooseExhaust,
  dealsBlockableDamage,
  dealsDirectHpDamage,
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
  /** A status that makes you lose HP while in hand (tier 1, "Lose X HP", modelled on Beckon; #115 adds the real trigger). */
  burn: skill('burn', [], {
    type: 'status',
    cost: null,
    keywords: ['unplayable'],
    triggers: [{ when: 'turnEndInHand', effects: [{ type: 'loseHp', amount: 2 }] }],
  }),
  /** A status with flat, blockable damage in hand (tier 3, "Take X damage", modelled on Burn; #115 adds the real trigger). */
  blk: skill('blk', [], {
    type: 'status',
    cost: null,
    keywords: ['unplayable'],
    triggers: [{ when: 'turnEndInHand', effects: [{ type: 'dealDamage', amount: 3 }] }],
  }),
  /** A plain non-Ethereal status. */
  wound: skill('wound', [], { type: 'status', cost: null, keywords: ['unplayable'] }),
  mad_science_improvement: skill(
    'mad_science_improvement',
    [{ type: 'applyPower', power: 'upgradeAtCombatEnd', amount: 1 }],
    { type: 'power', cost: 1 },
  ),
  dazed: skill('dazed', [], { type: 'status', cost: null, keywords: ['unplayable', 'ethereal'] }),
  shrug: skill(
    'shrug',
    [
      { type: 'gainBlock', amount: 8 },
      { type: 'draw', amount: 1 },
    ],
    { cost: 1 },
  ),
  /** Pommel Strike: a 1-cost attack that draws a card. */
  pommel: {
    ...cards.strike!,
    id: 'pommel',
    effects: [
      { type: 'attack', damage: 9, hits: 1 },
      { type: 'draw', amount: 1 },
    ],
    upgraded: null,
  },
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
      // A deep draw pile of Strikes keeps the #141 deck-health guard out of the way of the older tests.
      drawPile: Array.from({ length: 20 }, () => card('strike')),
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

const junkFiles = import.meta.glob<CardDef>(['../data/cards/curses/*.json', '../data/cards/status/*.json'], {
  eager: true,
  import: 'default',
});
/** A curse/status's HP-loss or damage effects, triggers included. */
const junkDamageEffects = (c: CardDef) =>
  [...c.effects, ...(c.triggers ?? []).flatMap((t) => t.effects)].filter(
    (e) => e.type === 'loseHp' || e.type === 'attack' || e.type === 'dealDamage',
  );
/** #141 Q3a wording: "lose 13 HP", "lose 1 HP for each card" vs "take 2 damage", "take 6/7/8 damage". */
const LOSE_HP = /\blose \d+ HP\b/i;
const TAKE_DAMAGE = /\btake [\d/]+ damage\b/i;

describe('#139 exhaust order (every strategy)', () => {
  /** Block is the lower-priority group: Defend is the base card that goes first. */
  const GREEDY = GREEDY_CONFIG;
  /** Attack is the lower-priority group: Strike goes first. */
  const BLOCK = blockFirstConfig(0);

  it('tiers 1–8, with a card on each side of every boundary (Greedy: Block is the lower group)', () => {
    expect(
      ['burn', 'drum', 'blk', 'wound', 'defend', 'strike', 'dazed', 'strike+', 'bash'].map((id) =>
        exhaustTier(card(id), GREEDY),
      ),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 8]);
    expect(['defend', 'strike'].map((id) => exhaustTier(card(id), BLOCK))).toEqual([6, 5]);
    // The curse from the ascension rule is Ethereal: tier 7.
    expect(exhaustTier(card('ascenders_bane'), GREEDY)).toBe(7);
  });

  it('full order: HP-loss junk, Drum, blockable junk, other junk, lower-group base, other base, Ethereal junk, the rest', () => {
    // Energy 0: nothing is left to play, so no Ethereal exception.
    const hand = ['bash', 'defend+', 'strike', 'dazed', 'defend', 'wound', 'drum', 'blk', 'burn', 'strike+'].map(card);
    expect(ids(exhaustOrder(hand, viewOf(hand, 0), GREEDY))).toEqual([
      'burn',
      'drum',
      'blk',
      'wound',
      'defend',
      'strike',
      'dazed',
      'defend+',
      'strike+',
      'bash',
    ]);
  });

  it('each tier boundary: a card of the next tier never goes before one of the tier above', () => {
    const order = ['burn', 'drum', 'blk', 'wound', 'defend', 'strike', 'dazed', 'strike+'];
    for (let i = 0; i + 1 < order.length; i++) {
      const pair = [card(order[i + 1]!), card(order[i]!)];
      expect(ids(exhaustOrder(pair, viewOf(pair, 0), GREEDY))).toEqual([order[i], order[i + 1]]);
    }
  });

  it('Drum of Battle goes after HP-loss junk but before blockable-damage and other junk', () => {
    const hand = ['wound', 'blk', 'drum', 'burn'].map(card);
    expect(ids(exhaustOrder(hand, viewOf(hand, 0), GREEDY))).toEqual(['burn', 'drum', 'blk', 'wound']);
  });

  it('a curse/status with an exhaust trigger only is not damaging (the trigger does not hurt in hand)', () => {
    expect(dealsDirectHpDamage(card('burn'))).toBe(true);
    expect(dealsDirectHpDamage(card('blk'))).toBe(false);
    expect(dealsBlockableDamage(card('blk'))).toBe(true);
    expect(dealsBlockableDamage(card('burn'))).toBe(false);
    expect(dealsDirectHpDamage(card('wound'))).toBe(false);
    expect(dealsBlockableDamage(card('wound'))).toBe(false);
    // Only curses and statuses count.
    expect(dealsDirectHpDamage(card('brand'))).toBe(false);
  });

  it('no curse or status in the data has an HP-loss or damage effect yet (classes are fixture-tested)', () => {
    expect(Object.keys(junkFiles).length).toBeGreaterThan(20);
    for (const c of Object.values(junkFiles)) {
      expect(junkDamageEffects(c)).toEqual([]);
    }
  });

  it('#141 Q3a: "Lose X HP" is non-blockable (tier 1), "Take X damage" is blockable (tier 3)', () => {
    // The wording of every curse/status in the data, pinned so #115 models each with the right effect.
    const byText = (re: RegExp) =>
      Object.values(junkFiles)
        .filter((c) => re.test(c.description))
        .map((c) => c.id)
        .sort();
    expect(byText(LOSE_HP)).toEqual(['bad_luck', 'beckon', 'regret']);
    expect(byText(TAKE_DAMAGE)).toEqual(['burn', 'decay', 'disintegration', 'infection', 'toxic', 'wither']);
    // A card whose text says one must be modelled (and so classified) as that one.
    for (const c of Object.values(junkFiles)) {
      if (junkDamageEffects(c).length === 0) continue;
      const inst = makeCardInstance(c, false, 1);
      expect(dealsDirectHpDamage(inst)).toBe(LOSE_HP.test(c.description));
      expect(dealsBlockableDamage(inst)).toBe(TAKE_DAMAGE.test(c.description));
    }
    // The fixtures modelled on Beckon ("lose 6 HP") and Burn ("take 2 damage") land in tiers 1 and 3.
    expect(exhaustTier(card('burn'))).toBe(1);
    expect(exhaustTier(card('blk'))).toBe(3);
  });

  describe("the strategy's lower-priority group", () => {
    const hand = () => ['strike', 'defend', 'strike', 'defend'].map(card);

    it('Greedy (Attack before Block): Block is lower, so Defends go before Strikes', () => {
      const h = hand();
      expect(ids(exhaustOrder(h, viewOf(h, 0), GREEDY))).toEqual(['defend', 'defend', 'strike', 'strike']);
    });

    it('Block first (Block before Attack): Attack is lower, so Strikes go before Defends', () => {
      const h = hand();
      expect(ids(exhaustOrder(h, viewOf(h, 0), BLOCK))).toEqual(['strike', 'strike', 'defend', 'defend']);
    });

    it('only the positions of Attack and Block matter, not Powers', () => {
      const orders: StrategyConfig['order'][] = [
        ['attack', 'block', 'powers'],
        ['powers', 'attack', 'block'],
        ['attack', 'powers', 'block'],
      ];
      for (const order of orders) {
        const h = hand();
        expect(ids(exhaustOrder(h, viewOf(h, 0), { order, allowThrough: 0 }))[0]).toBe('defend');
      }
      const blockFirst: StrategyConfig['order'][] = [
        ['block', 'attack', 'powers'],
        ['powers', 'block', 'attack'],
        ['block', 'powers', 'attack'],
      ];
      for (const order of blockFirst) {
        const h = hand();
        expect(ids(exhaustOrder(h, viewOf(h, 0), { order, allowThrough: 0 }))[0]).toBe('strike');
      }
    });

    it('the strategy built by createStrategy answers with its own order, in combat choices', () => {
      const h = hand();
      const req = request(h, 1, 1);
      expect(ids([h.find((c) => c.uid === createStrategy(GREEDY).choose!(viewOf(h, 0), req).uids[0])!])).toEqual([
        'defend',
      ]);
      expect(ids([h.find((c) => c.uid === createStrategy(BLOCK).choose!(viewOf(h, 0), req).uids[0])!])).toEqual([
        'strike',
      ]);
    });
  });

  describe('the Ethereal exception', () => {
    it('Ethereal junk goes before a Strike that would otherwise be played (energy would be unused)', () => {
      const h = ['strike', 'dazed'].map(card);
      expect(ids(exhaustOrder(h, viewOf(h, 1), GREEDY))).toEqual(['dazed', 'strike']);
    });

    it('same for a Defend with a Block-first strategy', () => {
      const h = ['defend', 'dazed'].map(card);
      expect(ids(exhaustOrder(h, viewOf(h, 1, 20), BLOCK))).toEqual(['dazed', 'defend']);
    });

    it('no exception when the base card would not be played (no energy left)', () => {
      const h = ['strike', 'dazed'].map(card);
      expect(ids(exhaustOrder(h, viewOf(h, 0), GREEDY))).toEqual(['strike', 'dazed']);
    });

    it('no exception while another card still uses the energy; it applies to the last Strike', () => {
      const h = ['strike', 'strike', 'dazed'].map(card);
      expect(ids(exhaustOrder(h, viewOf(h, 1), GREEDY))).toEqual(['strike', 'dazed', 'strike']);
    });

    it('the exception only moves Ethereal junk: other junk stays above both', () => {
      const h = ['strike', 'dazed', 'wound', 'burn'].map(card);
      expect(ids(exhaustOrder(h, viewOf(h, 1), GREEDY))).toEqual(['burn', 'wound', 'dazed', 'strike']);
    });

    it('without a view the plain order applies (Ethereal junk after Strikes and Defends)', () => {
      const h = ['dazed', 'strike'].map(card);
      expect(ids(exhaustOrder(h))).toEqual(['strike', 'dazed']);
    });
  });

  describe("cards that won't be played this turn (tier 8)", () => {
    it('upgraded Strikes/Defends first (lower group first), then other cards from the lowest group upward', () => {
      // Greedy: Attack, Powers, Block. Energy 0: nothing is played.
      const h = ['bash', 'twin', 'shrug', 'flex', 'strike+', 'defend+'].map(card);
      expect(ids(exhaustOrder(h, viewOf(h, 0), GREEDY))).toEqual([
        'defend+',
        'strike+',
        'shrug',
        'flex',
        'bash',
        'twin',
      ]);
      // Block first: Block, Powers, Attack.
      const h2 = ['bash', 'twin', 'shrug', 'flex', 'strike+', 'defend+'].map(card);
      expect(ids(exhaustOrder(h2, viewOf(h2, 0), BLOCK))).toEqual([
        'strike+',
        'defend+',
        'bash',
        'twin',
        'flex',
        'shrug',
      ]);
    });

    it('a card the turn plan plays goes after the ones it does not', () => {
      // Block first, no incoming damage: the plan plays Strike+ with the 1 energy; Defend+ is not played.
      const h = ['strike+', 'defend+'].map(card);
      expect(ids(exhaustOrder(h, viewOf(h, 1), BLOCK))).toEqual(['defend+', 'strike+']);
      // No energy: neither is played, so the lower group's (Attack) Strike+ goes first.
      const h2 = ['strike+', 'defend+'].map(card);
      expect(ids(exhaustOrder(h2, viewOf(h2, 0), BLOCK))).toEqual(['strike+', 'defend+']);
    });

    it('the plan leaves out the exhausting card: energy is what is left after it was played', () => {
      const h = ['twin', 'bash'].map(card);
      // 1 energy: the plan plays Twin Strike (1); Bash (2) is not played, so it goes first.
      expect(ids(exhaustOrder(h, viewOf(h, 1), GREEDY))).toEqual(['bash', 'twin']);
    });

    it('Second Wind and Fiend Fire count as played (they go last), so they are exhausted after other cards', () => {
      const h = ['wind', 'bash'].map(card);
      expect(ids(exhaustOrder(h, viewOf(h, 0), GREEDY))).toEqual(['bash', 'wind']);
    });
  });

  it('"Exhaust 1 card" takes the first card in the order', () => {
    const hand = ['bash', 'defend', 'strike+', 'strike'].map(card);
    // Greedy: Defend is the lower-group base card.
    expect(chooseExhaust(viewOf(hand, 0), request(hand, 1, 1)).uids).toEqual([hand[1]!.uid]);
    expect(chooseExhaust(viewOf(hand, 0), request(hand, 1, 1), BLOCK).uids).toEqual([hand[3]!.uid]);
  });

  it('worth exhausting: tiers 1–7 only (junk incl. Ethereal, Drum, non-upgraded Strike/Defend)', () => {
    expect(
      ['burn', 'drum', 'blk', 'wound', 'strike', 'defend', 'dazed', 'strike+', 'defend+', 'bash'].map((id) =>
        worthExhausting(card(id)),
      ),
    ).toEqual([true, true, true, true, true, true, true, false, false, false]);
  });
});

describe('#139 Purity ("up to 3/5")', () => {
  const pick = (hand: string[], max: number, config?: StrategyConfig, energy = 0) => {
    const cs = hand.map(card);
    const res = chooseExhaust(viewOf(cs, energy), request(cs, 0, max), config);
    return res.uids.map((u) => ids([cs.find((c) => c.uid === u)!])[0]);
  };

  it('#141 Q3d: follows the regular exhaust order (tiers 1–7), up to the limit', () => {
    // No energy: Strikes/Defends would not be played, so Dazed (tier 7) comes after them.
    expect(pick(['strike', 'defend', 'dazed', 'wound', 'drum', 'burn'], 4)).toEqual([
      'burn',
      'drum',
      'wound',
      'defend',
    ]);
    expect(pick(['strike', 'defend', 'dazed', 'wound', 'drum', 'burn'], 3)).toEqual(['burn', 'drum', 'wound']);
    expect(pick(['dazed', 'blk', 'wound'], 3)).toEqual(['blk', 'wound', 'dazed']);
  });

  it('Ethereal junk goes before Strikes and Defends only by the regular Ethereal exception (energy to spend)', () => {
    expect(pick(['strike', 'dazed'], 1, GREEDY_CONFIG, 3)).toEqual(['dazed']);
    expect(pick(['strike', 'dazed'], 3, GREEDY_CONFIG, 3)).toEqual(['dazed', 'strike']);
    expect(pick(['strike', 'dazed'], 1, GREEDY_CONFIG, 0)).toEqual(['strike']);
  });

  it('fills the slots with non-upgraded Strikes/Defends, the lower-priority group first', () => {
    expect(pick(['defend', 'strike', 'dazed', 'defend', 'strike'], 5)).toEqual([
      'defend',
      'defend',
      'strike',
      'strike',
      'dazed',
    ]);
    expect(pick(['defend', 'strike', 'dazed', 'defend', 'strike'], 3, blockFirstConfig(0))).toEqual([
      'strike',
      'strike',
      'defend',
    ]);
  });

  it('never takes upgraded Strikes / Defends or other cards, even with slots left', () => {
    expect(pick(['strike+', 'defend+', 'bash', 'shrug', 'strike'], 5)).toEqual(['strike']);
    expect(pick(['strike+', 'bash', 'defend+'], 3)).toEqual([]);
  });

  it('stops at the limit', () => {
    expect(pick(['strike', 'strike', 'strike', 'strike'], 3)).toHaveLength(3);
    expect(pick(['burn', 'burn', 'burn', 'burn', 'burn', 'burn'], 5)).toHaveLength(5);
  });
});

describe('#135 Q7: strategies never play Mad Science (Improvement)', () => {
  it('skips it with energy to spare, and still plays other cards', () => {
    for (const config of [GREEDY_CONFIG, blockFirstConfig(0), blockFirstConfig(100)]) {
      const s = createStrategy(config);
      expect(s.decide(viewOf([card('mad_science_improvement')], 3))).toEqual({ kind: 'endTurn' });
      const hand = [card('mad_science_improvement'), card('strike')];
      expect(s.decide(viewOf(hand, 3))).toEqual({ kind: 'play', uid: hand[1]!.uid });
    }
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
    // Chosen, but played last (#132): with 3 energy the spare 1 goes to a Strike first; with 2 it is Fiend Fire.
    expect(greedy.decide(viewOf(hand, 3))).toEqual(playsCard(hand[1]!));
    expect(greedy.decide(viewOf(hand, 2))).toEqual(playsCard(hand[0]!));
    expect(blockDone.decide(viewOf(hand, 2))).toEqual(playsCard(hand[0]!));
    // Only a Strike else in hand: 2 × 7 = 14 > 6.
    const small = [card('fiend'), card('strike'), card('dazed')];
    expect(greedy.decide(viewOf(small, 2))).toEqual(playsCard(small[0]!));
  });

  it('not played while the other attacks deal more (3 × 7 = 21 < Twin + Twin + Strike = 26)', () => {
    const hand = [card('fiend'), card('twin'), card('twin'), card('strike')];
    expect(greedy.decide(viewOf(hand, 3))).toEqual(playsCard(hand[1]!));
    expect(blockDone.decide(viewOf(hand, 3))).toEqual(playsCard(hand[1]!));
    // Not enough energy for Fiend Fire: never chosen.
    const poor = [card('fiend'), card('strike'), card('strike'), card('strike')];
    expect(greedy.decide(viewOf(poor, 1))).toEqual(playsCard(poor[1]!));
  });

  it('Bash goes before Fiend Fire (greedy, and other orders)', () => {
    const hand = () => [card('fiend'), card('bash'), card('strike'), card('strike'), card('defend')];
    const h1 = hand();
    expect(greedy.decide(viewOf(h1, 4))).toEqual(playsCard(h1[1]!)); // Bash (2) + Fiend Fire (2) = 4
    const h2 = hand();
    expect(blockDone.decide(viewOf(h2, 4))).toEqual(playsCard(h2[1]!)); // Bash always first (#132)
    // 3 energy: Bash leaves too little for Fiend Fire, but Bash still goes first (#132, answer 8).
    const h3 = hand();
    expect(greedy.decide(viewOf(h3, 3))).toEqual(playsCard(h3[1]!));
  });

  it('#132: other orders also play Bash before Fiend Fire, even when Fiend Fire is then unaffordable', () => {
    const h = [card('fiend'), card('bash'), card('strike'), card('strike'), card('defend')];
    expect(blockDone.decide(viewOf(h, 3))).toEqual(playsCard(h[1]!));
  });

  it('#132: Bash does not go first when Fiend Fire would kill (Strength and Vulnerable counted)', () => {
    const h = [card('fiend'), card('bash'), card('strike'), card('strike'), card('defend')];
    // 4 × 7 = 28 ≥ 28 HP: lethal, so Fiend Fire right away.
    expect(greedy.decide(viewOf(h, 3, 0, { hp: 28 }))).toEqual(playsCard(h[0]!));
    // 29 HP: not lethal, Bash first.
    const h2 = [card('fiend'), card('bash'), card('strike'), card('strike'), card('defend')];
    expect(greedy.decide(viewOf(h2, 3, 0, { hp: 29 }))).toEqual(playsCard(h2[1]!));
    // Vulnerable on the enemy: 4 × 10 = 40 ≥ 40 HP.
    const h3 = [card('fiend'), card('bash'), card('strike'), card('strike'), card('defend')];
    expect(greedy.decide(viewOf(h3, 3, 0, { hp: 40, vulnerable: 1 }))).toEqual(playsCard(h3[0]!));
  });

  it('#132: Cruelty counts in the kill check, so Bash waits', () => {
    const h = [card('fiend'), card('bash'), card('strike'), card('strike'), card('defend')];
    const v = viewOf(h, 3, 0, { hp: 36 });
    // Vulnerable 7 × 1.5 = 10 per hit without Cruelty (still 28 < 36); with Cruelty 2 it is more.
    expect(greedy.decide(v)).toEqual(playsCard(h[1]!));
    const h2 = [card('fiend'), card('bash'), card('strike'), card('strike'), card('defend')];
    const v2 = viewOf(h2, 3, 0, { hp: 36, vulnerable: 1 });
    (v2.state.player as { powers?: Record<string, number> }).powers = { cruelty: 25 };
    expect(greedy.decide(v2)).toEqual(playsCard(h2[0]!));
  });

  it('#132: Fiend Fire is played last: spare energy goes to a draw card first, then Fiend Fire', () => {
    // 3 energy, Fiend Fire (2) + 3 Strikes + a 1-cost attack that draws: draw card, then Fiend Fire.
    const hand = () => [card('fiend'), card('strike'), card('strike'), card('strike'), card('pommel')];
    const h1 = hand();
    expect(greedy.decide(viewOf(h1, 3))).toEqual(playsCard(h1[4]!));
    // After the draw (hand grew by a card, energy 2): spare is 0, Fiend Fire.
    const h2 = [h1[0]!, h1[1]!, h1[2]!, h1[3]!, card('strike')];
    expect(greedy.decide(viewOf(h2, 2))).toEqual(playsCard(h2[0]!));
    expect(blockDone.decide(viewOf(h2, 2))).toEqual(playsCard(h2[0]!));
  });

  it('#132: with spare energy and no draw card, other plays go before Fiend Fire', () => {
    const h = [card('fiend'), card('strike'), card('strike'), card('defend'), card('defend')];
    // 3 energy, Fiend Fire 2: 1 spare, spent on a Strike first.
    expect(greedy.decide(viewOf(h, 3))).toEqual(playsCard(h[1]!));
    // No spare energy: Fiend Fire.
    expect(greedy.decide(viewOf(h, 2))).toEqual(playsCard(h[0]!));
  });

  it('draw cards go before Fiend Fire (they grow the hand it exhausts)', () => {
    // Shrug costs 1 here (a 0-cost draw card would always go first, #132).
    const hand = () => [card('fiend'), card('shrug'), card('twin'), card('strike'), card('dazed')];
    const h1 = hand();
    expect(greedy.decide(viewOf(h1, 3))).toEqual(playsCard(h1[1]!));
    const h2 = hand();
    expect(blockDone.decide(viewOf(h2, 3))).toEqual(playsCard(h2[1]!)); // spare energy: the draw card goes first anyway (#132)
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
    (v2.state.player as { energy: number }).energy = 2;
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
