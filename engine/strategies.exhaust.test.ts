/** #108 strategy rules: exhaust order, Purity's limits, Brand / Burning Pact early, Second Wind / Fiend Fire last. */
import { describe, expect, it } from 'vitest';
import { makeCardInstance, simulateCombat } from './combat';
import { cardValue, chooseExhaust, createStrategy, exhaustOrder, exhaustTier, worthExhausting } from './strategies';
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
  shrug: skill('shrug', [
    { type: 'gainBlock', amount: 8 },
    { type: 'draw', amount: 1 },
  ]),
  twin: { ...cards.strike!, id: 'twin', effects: [{ type: 'attack', damage: 5, hits: 2 }], upgraded: null },
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
function viewOf(hand: CardInstance[], energy = 3, incoming = 0): StrategyView {
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
      hp: 50,
      maxHp: 50,
      block: 0,
      strength: 0,
      debuffs: { vulnerable: 0, weak: 0, frail: 0 },
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
  const greedy = createStrategy({ kind: 'greedyDamage' });
  const block = createStrategy({ kind: 'block', allowThrough: 0 });

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

describe('#108 Second Wind and Fiend Fire are played last', () => {
  const greedy = createStrategy({ kind: 'greedyDamage' });

  it('greedy: attacks and block cards first, then Second Wind', () => {
    const hand = [card('wind'), card('strike'), card('defend'), card('dazed')];
    const v = viewOf(hand, 3);
    expect(greedy.decide(v)).toEqual({ kind: 'play', uid: hand[1]!.uid });
    // Only Second Wind left playable (with a status still in hand to exhaust).
    const late = [card('wind'), card('dazed')];
    expect(greedy.decide(viewOf(late, 1))).toEqual({ kind: 'play', uid: late[0]!.uid });
  });

  it('Fiend Fire last, and not at all when the hand has nothing else', () => {
    const hand = [card('fiend'), card('strike'), card('dazed')];
    expect(greedy.decide(viewOf(hand, 3))).toEqual({ kind: 'play', uid: hand[1]!.uid });
    const late = [card('fiend'), card('dazed')];
    expect(greedy.decide(viewOf(late, 2))).toEqual({ kind: 'play', uid: late[0]!.uid });
    expect(greedy.decide(viewOf([card('fiend')], 2))).toEqual({ kind: 'endTurn' });
  });

  it('with energy for both, Second Wind goes before Fiend Fire; with energy for one, greedy takes Fiend Fire, block Second Wind', () => {
    const hand = [card('fiend'), card('wind'), card('dazed')];
    expect(greedy.decide(viewOf(hand, 3))).toEqual({ kind: 'play', uid: hand[1]!.uid });
    expect(greedy.decide(viewOf(hand, 2))).toEqual({ kind: 'play', uid: hand[0]!.uid });
    const block = createStrategy({ kind: 'block', allowThrough: 100 });
    expect(block.decide(viewOf(hand, 2))).toEqual({ kind: 'play', uid: hand[1]!.uid });
  });
});

describe('#108 block strategies value Second Wind as 5 Block × the cards it would exhaust', () => {
  const block = createStrategy({ kind: 'block', allowThrough: 0 });

  it('beats a smaller block card when it would exhaust enough (2 × 5 = 10 > Shrug 8)', () => {
    const hand = [card('shrug'), card('wind'), card('dazed'), card('dazed'), card('strike')];
    expect(block.decide(viewOf(hand, 3, 20))).toEqual({ kind: 'play', uid: hand[1]!.uid });
  });

  it('loses to a bigger block card (1 × 5 = 5 < Shrug 8), and ties go to the normal block card', () => {
    const hand = [card('shrug'), card('wind'), card('strike')];
    expect(block.decide(viewOf(hand, 3, 20))).toEqual({ kind: 'play', uid: hand[0]!.uid });
    const tie = [card('defend'), card('wind'), card('strike')];
    expect(block.decide(viewOf(tie, 3, 20))).toEqual({ kind: 'play', uid: tie[0]!.uid });
  });

  it('greedy does not treat Second Wind as a block card', () => {
    const greedy = createStrategy({ kind: 'greedyDamage' });
    const hand = [card('wind'), card('dazed'), card('dazed'), card('defend')];
    expect(greedy.decide(viewOf(hand, 3, 20))).toEqual({ kind: 'play', uid: hand[3]!.uid });
  });
});

describe('#108 strategies in combat', () => {
  it('built strategies answer exhaust choices with the shared order (Strike before Bash)', () => {
    const d = data();
    d.cards.pact = { ...d.cards.pact!, keywords: ['innate'] };
    d.cards.bash = { ...d.cards.bash!, keywords: ['innate'] };
    for (const config of [{ kind: 'greedyDamage' }, { kind: 'block', allowThrough: 0 }] as StrategyConfig[]) {
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
