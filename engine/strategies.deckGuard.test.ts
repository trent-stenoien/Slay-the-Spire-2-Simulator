/**
 * #141 deck-health guard: exhausting keeps >= max(2, ceil(active deck / 5)) damaging cards and
 * >= 5 + extra draw cards, unless it kills; the last damaging card allowed to go is the lowest damage per energy.
 */
import { describe, expect, it } from 'vitest';
import { makeCardInstance, simulateCombat } from './combat';
import {
  activeDeck,
  blockFirstConfig,
  chooseExhaust,
  createStrategy,
  damagePerEnergy,
  damagingNeeded,
  dealsDamageToEnemy,
  deckFloor,
  deckHealthy,
  exhaustKeepsDeckHealthy,
  drawUntilEstimate,
  extraDraw,
  GREEDY_CONFIG,
  pickAttack,
} from './strategies';
import { cards } from './testFixtures';
import { cfg, deckOf, dummyData } from './combatTestHelpers';
import type { CardDef, CardInstance, ChoiceRequest, CombatState, Effect, StrategyView } from './types';
import { isPlayable } from './rules';

const base = (id: string, effects: Effect[], extra: Partial<CardDef> = {}): CardDef => ({
  ...cards.defend!,
  id,
  code: 'Zz',
  name: id,
  cost: 0,
  effects,
  upgraded: null,
  ...extra,
});

const defs: Record<string, CardDef> = {
  ...cards,
  pact: base('pact', [
    { type: 'exhaustCards', count: 1, mode: 'choose' },
    { type: 'draw', amount: 2 },
  ]),
  brand: base('brand', [
    { type: 'loseHp', amount: 1 },
    { type: 'exhaustCards', count: 1, mode: 'choose' },
    { type: 'gainStrength', amount: 1 },
  ]),
  purity: base('purity', [{ type: 'exhaustCards', count: 3, mode: 'choose', upTo: true }], {
    keywords: ['retain', 'exhaust'],
  }),
  grit: base('grit', [
    { type: 'gainBlock', amount: 7 },
    { type: 'exhaustCards', count: 1, mode: 'random' },
  ]),
  'grit+': base('grit+', [
    { type: 'gainBlock', amount: 9 },
    { type: 'exhaustCards', count: 1, mode: 'choose' },
  ]),
  wind: base('wind', [
    { type: 'exhaustCards', mode: 'all', filter: { notTypes: ['attack'] } },
    { type: 'repeat', per: 'lastEffectCount', effects: [{ type: 'gainBlock', amount: 5 }] },
  ]),
  fiend: {
    ...cards.strike!,
    id: 'fiend',
    cost: 0,
    keywords: ['exhaust'],
    effects: [{ type: 'script', id: 'fiendFire', values: [7] }],
    upgraded: null,
  },
  cinder: {
    ...cards.strike!,
    id: 'cinder',
    cost: 0,
    effects: [
      { type: 'attack', damage: 18, hits: 1 },
      { type: 'exhaustCards', count: 1, mode: 'random' },
    ],
    upgraded: null,
  },
  thrash: {
    ...cards.strike!,
    id: 'thrash',
    cost: 0,
    effects: [
      { type: 'attack', damage: 4, hits: 2 },
      { type: 'script', id: 'thrash' },
    ],
    upgraded: null,
  },
  wound: base('wound', [], { type: 'status', cost: null, keywords: ['unplayable'] }),
  curse: base('curse', [{ type: 'attack', damage: 3, hits: 1 }], {
    type: 'curse',
    cost: null,
    keywords: ['unplayable'],
  }),
  flex: base('flex', [{ type: 'gainStrength', amount: 2 }], { type: 'power', cost: 1 }),
  pommel: {
    ...cards.strike!,
    id: 'pommel',
    effects: [
      { type: 'attack', damage: 9, hits: 1 },
      { type: 'draw', amount: 1 },
    ],
    upgraded: null,
  },
  /** A 0-cost attack (Anger-like). */
  anger: { ...cards.strike!, id: 'anger', cost: 0, effects: [{ type: 'attack', damage: 6, hits: 1 }], upgraded: null },
  /** An X-cost attack (Whirlwind-like): 5 per X. */
  whirl: {
    ...cards.strike!,
    id: 'whirl',
    cost: 0,
    xCost: true,
    effects: [{ type: 'attack', damage: 5, hits: 1, xTimes: true }],
    upgraded: null,
  } as CardDef,
  /** Upgraded Whirlwind-like: 8 per X. */
  'whirl+': {
    ...cards.strike!,
    id: 'whirl+',
    cost: 0,
    xCost: true,
    effects: [{ type: 'attack', damage: 8, hits: 1, xTimes: true }],
    upgraded: null,
  } as CardDef,
  /** A 1-cost 5-damage attack (ties un-upgraded Whirlwind). */
  five: { ...cards.strike!, id: 'five', effects: [{ type: 'attack', damage: 5, hits: 1 }], upgraded: null },
  /** A 2-cost attack, 7 per energy. */
  heavy: { ...cards.strike!, id: 'heavy', cost: 2, effects: [{ type: 'attack', damage: 14, hits: 1 }], upgraded: null },
  /** "Draw until the hand is full" without Exhaust. */
  fill: base('fill', [{ type: 'drawUntil', handFull: true }], { cost: 1 }),
  twin: { ...cards.strike!, id: 'twin', cost: 1, effects: [{ type: 'attack', damage: 5, hits: 2 }], upgraded: null },
  scrawl: base('scrawl', [{ type: 'drawUntil', handFull: true }], { cost: 1, keywords: ['exhaust'] }),
  pillage: {
    ...cards.strike!,
    id: 'pillage',
    effects: [
      { type: 'attack', damage: 6, hits: 1 },
      { type: 'drawUntil', stopOn: { notTypes: ['attack'] } },
    ],
    upgraded: null,
  },
};

let uid = 5000;
const card = (id: string): CardInstance => makeCardInstance(defs[id]!, false, uid++);
const many = (id: string, n: number): CardInstance[] => Array.from({ length: n }, () => card(id));

interface Setup {
  hand: CardInstance[];
  draw?: CardInstance[];
  discard?: CardInstance[];
  energy?: number;
  enemyHp?: number;
}

/** A view of the player's turn; the enemy never blocks. */
function viewOf({ hand, draw = [], discard = [], energy = 0, enemyHp = 500 }: Setup): StrategyView {
  const state = {
    turn: 1,
    player: {
      hp: 80,
      maxHp: 80,
      block: 0,
      energy,
      strength: 0,
      debuffs: { vulnerable: 0, weak: 0, frail: 0 },
      drawPile: draw,
      hand,
      discardPile: discard,
      exhaustPile: [],
    },
    enemy: {
      enemyId: 'dummy',
      name: 'dummy',
      hp: enemyHp,
      maxHp: enemyHp,
      block: 0,
      strength: 0,
      debuffs: { vulnerable: 0, weak: 0, frail: 0 },
      poison: 0,
      patternIndex: 0,
    },
  } as CombatState;
  return {
    state,
    intent: { moveId: 'x', name: 'x', attacks: [], totalIncoming: 0 },
    playable: hand.filter((c) => isPlayable(c, energy)),
  };
}

const GREEDY = createStrategy(GREEDY_CONFIG);
/** Plays the card with this id, if the strategy does at all. */
const playedId = (s: Setup, strategy = GREEDY): string | null => {
  const view = viewOf(s);
  const d = strategy.decide(view);
  return d.kind === 'play' ? view.state.player.hand.find((c) => c.uid === d.uid)!.cardId : null;
};

describe('#141 damaging card', () => {
  const dmg = (effects: Effect[], extra: Partial<CardDef> = {}) =>
    dealsDamageToEnemy(makeCardInstance(base('t', effects, extra), false, 1));

  it('attack, dealDamage, enemyLoseHp, poison and damaging scripts count, nested too', () => {
    expect(dmg([{ type: 'attack', damage: 6, hits: 1 }])).toBe(true);
    expect(dmg([{ type: 'dealDamage', amount: 40 }])).toBe(true);
    expect(dmg([{ type: 'enemyLoseHp', amount: 3 }])).toBe(true);
    expect(dmg([{ type: 'applyPoison', amount: 4 }])).toBe(true);
    expect(dmg([{ type: 'script', id: 'fiendFire', values: [7] }])).toBe(true);
    expect(dmg([{ type: 'script', id: 'thrash' }])).toBe(true);
    expect(dmg([{ type: 'schedule', delay: 1, effects: [{ type: 'dealDamage', amount: 40 }] }])).toBe(true);
    expect(
      dmg([{ type: 'conditional', if: { kind: 'always' } as never, then: [{ type: 'attack', damage: 1, hits: 1 }] }]),
    ).toBe(true);
  });

  it('block, draw, exhaust, other scripts and powers without damage do not count', () => {
    expect(dmg([{ type: 'gainBlock', amount: 5 }])).toBe(false);
    expect(dmg([{ type: 'draw', amount: 2 }])).toBe(false);
    expect(dmg([{ type: 'exhaustCards', count: 1, mode: 'choose' }])).toBe(false);
    expect(dmg([{ type: 'script', id: 'playSelf' }])).toBe(false);
    expect(dmg([{ type: 'gainStrength', amount: 2 }], { type: 'power' })).toBe(false);
  });

  it('curses, statuses and Unplayable cards never count', () => {
    expect(dealsDamageToEnemy(card('curse'))).toBe(false);
    expect(dealsDamageToEnemy(card('wound'))).toBe(false);
    expect(dmg([{ type: 'attack', damage: 6, hits: 1 }], { keywords: ['unplayable'] })).toBe(false);
  });

  it('the real cards', () => {
    expect(['strike', 'bash', 'fiend', 'cinder', 'thrash'].map((id) => dealsDamageToEnemy(card(id)))).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
    expect(['defend', 'pact', 'purity', 'wind', 'grit', 'flex'].map((id) => dealsDamageToEnemy(card(id)))).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });
});

describe('#141 the guard: ratio and minimum', () => {
  const deck = (strikes: number, others: number) => [...many('strike', strikes), ...many('defend', others)];

  it('needs damaging >= max(2, ceil(size / 5)), at each size boundary', () => {
    // size 5..10: 2 damaging; 11..15: 3; 16: 4.
    expect([5, 6, 10, 11, 15, 16].map(damagingNeeded)).toEqual([2, 2, 2, 3, 3, 4]);
    expect([5, 6, 10, 11, 15, 16].map((n) => deckHealthy(deck(damagingNeeded(n), n - damagingNeeded(n))))).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
    expect(
      [5, 6, 10, 11, 15, 16].map((n) => deckHealthy(deck(damagingNeeded(n) - 1, n - damagingNeeded(n) + 1))),
    ).toEqual([false, false, false, false, false, false]);
    expect(deckHealthy(deck(2, 8))).toBe(true); // 10 cards, 2
    expect(deckHealthy(deck(2, 9))).toBe(false); // 11 cards, needs 3
    expect(deckHealthy(deck(3, 8))).toBe(true);
  });

  it('always keeps at least 2 damaging cards, also where ceil(size / 5) would ask for 1', () => {
    expect(deckHealthy(deck(1, 4))).toBe(false); // 5 cards: ceil(5 / 5) = 1, but 2 needed
    expect(deckHealthy(deck(2, 3))).toBe(true);
  });

  it('needs at least 5 cards, even when every card damages', () => {
    expect(deckHealthy(deck(4, 0))).toBe(false);
    expect(deckHealthy(deck(5, 0))).toBe(true);
    expect(deckHealthy([])).toBe(false);
  });

  it('the floor is 5 + the extra draw of every draw card in the deck', () => {
    expect(deckFloor(deck(2, 3))).toBe(5); // no draw cards
    expect(deckFloor([card('pommel'), ...deck(2, 3)])).toBe(6);
    expect(deckFloor([card('pommel'), card('pommel'), ...deck(2, 3)])).toBe(7);
    expect(deckFloor([card('pact'), ...deck(2, 3)])).toBe(7); // Burning Pact draws 2
    // One Pommel Strike: 5 cards are not enough, 6 are.
    expect(deckHealthy([card('pommel'), ...deck(1, 3)])).toBe(false);
    expect(deckHealthy([card('pommel'), ...deck(1, 4)])).toBe(true);
    expect(deckHealthy([card('pommel'), card('pommel'), ...deck(0, 4)])).toBe(false);
    expect(deckHealthy([card('pommel'), card('pommel'), ...deck(0, 5)])).toBe(true);
  });

  it('the extra draw comes from the card effects', () => {
    expect(['strike', 'pommel', 'pact', 'scrawl', 'fill', 'pillage', 'grit'].map((id) => extraDraw(card(id)))).toEqual([
      0, 1, 2, 0, 5, 1, 0,
    ]);
  });

  it('#147: Scrawl exhausts, so it adds nothing to the floor (a non-exhausting "fill the hand" adds 5)', () => {
    expect(deckFloor([card('scrawl'), ...deck(2, 3)])).toBe(5);
    expect(deckFloor([card('fill'), ...deck(2, 3)])).toBe(10);
    expect(deckHealthy([card('scrawl'), ...deck(2, 2)])).toBe(true); // 5 cards
  });
});

describe('#147 Pillage: estimated draw (option C)', () => {
  const stopOn = { notTypes: ['attack' as const] };
  const est = (attacks: number, others: number, handAfter = 4) =>
    drawUntilEstimate([...many('strike', attacks), ...many('defend', others)], stopOn, handAfter);

  it("Trent's example: 4 Strikes + 1 Defend: 80% (+1), then 75% (stop) -> 2", () => {
    expect(est(4, 1)).toBe(2);
  });

  it('draws at least 1; below 80% on the first step stays at 1', () => {
    expect(est(0, 0)).toBe(1);
    expect(est(0, 5)).toBe(1);
    expect(est(3, 1)).toBe(1); // 75%
    expect(est(1, 1)).toBe(1);
  });

  it('steps one card at a time while the chance stays >= 80%', () => {
    // 8 Strikes + 1 Defend: 8/9, 7/8, 6/7, 5/6, 4/5 (+5), 3/4 stop -> 6.
    expect(est(8, 1, 0)).toBe(6);
    // 8 Strikes + 2 Defends: 80% (+1), 7/9 = 77.8% stop -> 2.
    expect(est(8, 2, 0)).toBe(2);
    // All attacks: every step is 100% until the pile runs out.
    expect(est(3, 0, 0)).toBe(4);
  });

  it('capped at 10 - hand size after Pillage', () => {
    // 10 Anger-like + 1 Defend: 7 steps (10/11 ... 4/5), 3/4 stop -> 8 uncapped.
    expect(est(10, 1, 0)).toBe(8);
    expect(est(10, 1, 4)).toBe(6);
    expect(est(10, 1, 9)).toBe(1);
    expect(est(10, 1, 10)).toBe(0);
  });

  it('in the deck floor: the rest of the active deck stands in for the draw pile, hand of 4 after it', () => {
    expect(extraDraw(card('pillage'), [...many('strike', 4), card('defend')])).toBe(2);
    expect(deckFloor([card('pillage'), ...many('strike', 4), card('defend')])).toBe(7); // 5 + 2
    expect(deckFloor([card('pillage'), ...many('strike', 3), ...many('defend', 3)])).toBe(6); // 50%: 5 + 1
    expect(deckFloor([card('pillage'), ...many('strike', 12), card('defend')])).toBe(11); // capped: 5 + 6
    expect(deckHealthy([card('pillage'), ...many('strike', 4), card('defend')])).toBe(false); // 6 < 7
    // One more Strike raises the estimate too (5/6, 4/5, then 3/4: 3): 7 < 8.
    expect(deckHealthy([card('pillage'), ...many('strike', 5), card('defend')])).toBe(false);
    expect(deckHealthy([card('pillage'), ...many('strike', 2), ...many('defend', 4)])).toBe(true); // 7 >= 5 + 1
  });
});

describe('#147 X-cost attacks in play order (single enemy): damage for 1 energy vs damage per energy', () => {
  const pick = (ids: string[], energy = 3) => pickAttack(ids.map(card), energy)?.cardId;

  it('un-upgraded Whirlwind (5) after Strike (6); upgraded Whirlwind (8) before Strike', () => {
    expect(pick(['whirl', 'strike'])).toBe('strike');
    expect(pick(['whirl+', 'strike'])).toBe('whirl+');
  });

  it('per energy, not total: Whirlwind+ (8) before a 2-cost 14-damage attack (7 per energy)', () => {
    expect(pick(['heavy', 'whirl+'])).toBe('whirl+');
    expect(pick(['heavy', 'whirl'])).toBe('heavy');
  });

  it('a tie goes to the other attack; a 0-cost attack always comes first; Vulnerable still leads', () => {
    expect(pick(['whirl', 'five'])).toBe('five'); // 5 vs 5
    expect(pick(['whirl', 'twin'])).toBe('twin'); // 5 vs 10 per energy
    expect(pick(['whirl+', 'anger'])).toBe('anger');
    expect(pick(['whirl+', 'bash'])).toBe('bash');
  });

  it('a full Greedy turn at 3 energy', () => {
    expect(playedId({ hand: [card('whirl+'), card('strike')], energy: 3 })).toBe('whirl+');
    expect(playedId({ hand: [card('whirl'), card('strike')], energy: 3 })).toBe('strike');
  });

  it('the active deck is hand + draw + discard (the exhaust pile does not count)', () => {
    const v = viewOf({ hand: [card('strike')], draw: [card('defend')], discard: [card('bash')] });
    (v.state.player.exhaustPile as CardInstance[]).push(card('strike'));
    expect(activeDeck(v.state).map((c) => c.cardId)).toEqual(['strike', 'defend', 'bash']);
  });

  it('a boundary through a real exhaust: Burning Pact on a Wound, ratio (10 cards after: 2 needed)', () => {
    // After the Wound goes: draw + Burning Pact (in the discard pile).
    const ok = { hand: [card('pact'), card('wound')], draw: [...many('strike', 2), ...many('defend', 7)] };
    expect(playedId(ok)).toBe('pact'); // 10 cards, 2 damaging
    const bad = { hand: [card('pact'), card('wound')], draw: [...many('strike', 2), ...many('defend', 8)] };
    expect(playedId(bad)).toBeNull(); // 11 cards, needs 3
    const fixed = { hand: [card('pact'), card('wound')], draw: [...many('strike', 3), ...many('defend', 7)] };
    expect(playedId(fixed)).toBe('pact'); // 11 cards, 3 damaging
  });

  it('a boundary through a real exhaust: the floor (Burning Pact draws 2, so 7)', () => {
    const seven = { hand: [card('pact'), card('wound')], draw: many('strike', 6) };
    expect(playedId(seven)).toBe('pact'); // 6 Strikes + Burning Pact = 7
    const six = { hand: [card('pact'), card('wound')], draw: many('strike', 5) };
    expect(playedId(six)).toBeNull(); // 6 cards
  });
});

describe('#141 damage per energy', () => {
  it('Strike 6, Bash 4, Pommel Strike 9, two hits count; 0-cost is Infinity; X-cost counts X = 1', () => {
    expect(['strike', 'bash', 'pommel', 'twin', 'anger', 'whirl'].map((id) => damagePerEnergy(card(id)))).toEqual([
      6,
      4,
      9,
      10,
      Infinity,
      5,
    ]);
    expect(damagePerEnergy(card('fiend'))).toBe(Infinity); // 0-cost fixture
  });

  const request = (options: CardInstance[]): ChoiceRequest => ({
    purpose: 'exhaust',
    from: 'hand',
    to: 'exhaust',
    options,
    min: 1,
    max: 1,
  });
  /** True Grit+ stays in the deck; the others make up the rest. */
  const pickWith = (options: CardInstance[], draw: CardInstance[], nothingPlayable = false) => {
    const view = viewOf({ hand: options, draw });
    if (nothingPlayable) view.playable = []; // no card is planned: tier 8 goes by uid
    const uids = chooseExhaust(view, request(options), blockFirstConfig(0), card('grit+')).uids;
    return options.find((c) => c.uid === uids[0])!.cardId;
  };

  it('Bash goes before the last Strike when only one more damaging card may go', () => {
    // 11 cards, 3 damaging: one may go (10 cards, 2), a second may not (9 cards, 1).
    expect(pickWith([card('strike'), card('bash')], [card('strike'), ...many('defend', 7)])).toBe('bash');
  });

  it('with room for more, the regular order applies (Strike first for Block-first)', () => {
    // 12 cards, 4 damaging: after a Strike (11, 3), another could still go (10, 2).
    expect(pickWith([card('strike'), card('bash')], [...many('strike', 2), ...many('defend', 7)])).toBe('strike');
  });

  it('a 0-cost attack is kept longest; an X-cost attack counts its damage per X', () => {
    // Nothing planned: Anger (lower uid) is first in the order. With room it goes; at the margin
    // it stays (Infinity), even against a Pommel Strike (9 per energy).
    expect(pickWith([card('anger'), card('pommel')], [...many('strike', 2), ...many('defend', 7)], true)).toBe('anger');
    expect(pickWith([card('anger'), card('pommel')], [card('strike'), ...many('defend', 7)], true)).toBe('pommel');
    // Whirlwind-like (5) goes before a Strike (6), even though the Strike is first in the order.
    expect(pickWith([card('strike'), card('whirl')], [card('strike'), ...many('defend', 7)])).toBe('whirl');
  });

  it('#147: a 0-cost card is never picked by the damage-per-energy rule', () => {
    // Strike first in the order; Anger (0-cost) has the lowest damage of all but is never the swap.
    expect(pickWith([card('strike'), card('anger')], [card('strike'), ...many('defend', 7)])).toBe('strike');
    // Anger first in the order (nothing planned, lower uid): swapped for the Strike at the margin.
    expect(pickWith([card('anger'), card('strike')], [card('strike'), ...many('defend', 7)], true)).toBe('strike');
    // Only 0-cost damaging cards: the order's pick stands.
    const [a1, a2] = [card('anger'), card('fiend')];
    expect(pickWith([a1, a2], [card('anger'), ...many('defend', 7)], true)).toBe('anger');
  });

  it('the damaging card the order picks stays when it already has the lowest damage per energy', () => {
    expect(pickWith([card('strike'), card('pommel')], [card('strike'), ...many('defend', 7)])).toBe('strike');
  });
});

describe('#141 the kill exception', () => {
  it('Fiend Fire that kills is played even when it empties the deck', () => {
    // 4 Strikes in hand: 28 damage. The active deck after is empty.
    const hand = [card('fiend'), ...many('strike', 4)];
    expect(exhaustKeepsDeckHealthy(viewOf({ hand, enemyHp: 28 }), hand[0]!, GREEDY_CONFIG)).toBe(true);
    expect(playedId({ hand: [card('fiend'), ...many('strike', 4)], enemyHp: 28 })).toBe('fiend');
  });

  it('Fiend Fire that does not kill is not played when it breaks the guard', () => {
    const hand = [card('fiend'), ...many('strike', 4)];
    expect(exhaustKeepsDeckHealthy(viewOf({ hand, enemyHp: 29 }), hand[0]!, GREEDY_CONFIG)).toBe(false);
    expect(playedId({ hand: [card('fiend'), ...many('strike', 4)], enemyHp: 29 })).toBeNull();
  });

  it('an attack that kills before its random exhaust is played (Cinder)', () => {
    // Cinder and a Strike, nothing else: the random exhaust alone would break the guard.
    const mk = (enemyHp: number) => ({ hand: [card('cinder'), card('strike')], enemyHp });
    expect(playedId(mk(18))).toBe('cinder'); // 18 damage kills
    expect(playedId(mk(19))).toBeNull();
  });

  it('Vulnerable, Strength and enemy Block count towards the kill', () => {
    const hand = [card('cinder'), card('strike')];
    const view = viewOf({ hand, enemyHp: 20 });
    expect(exhaustKeepsDeckHealthy(view, hand[0]!, GREEDY_CONFIG)).toBe(false);
    (view.state.enemy as { debuffs: { vulnerable: number } }).debuffs.vulnerable = 1; // 27 damage
    expect(exhaustKeepsDeckHealthy(view, hand[0]!, GREEDY_CONFIG)).toBe(true);
    (view.state.enemy as { block: number }).block = 8; // 27 < 20 + 8
    expect(exhaustKeepsDeckHealthy(view, hand[0]!, GREEDY_CONFIG)).toBe(false);
  });

  it('Fiend Fire is played while the guard holds, with no kill', () => {
    const hand = () => [card('fiend'), card('wound'), card('wound')];
    expect(playedId({ hand: hand(), draw: many('strike', 5) })).toBe('fiend');
    expect(playedId({ hand: hand(), draw: many('strike', 4) })).toBeNull();
  });
});

describe('#141 choice exhausts: only picks that keep the guard, in tier order', () => {
  const request = (options: CardInstance[], min: number, max: number): ChoiceRequest => ({
    purpose: 'exhaust',
    from: 'hand',
    to: 'exhaust',
    options,
    min,
    max,
  });

  it('Burning Pact: skips the first tier pick when it would break the guard', () => {
    // Block-first: a Strike is exhausted before a Defend. 10 active cards, 2 Strikes: no Strike can go.
    const strikes = many('strike', 2);
    const defends = many('defend', 3);
    const pact = card('pact');
    const view = viewOf({
      hand: [strikes[0]!, defends[0]!],
      draw: [strikes[1]!, ...defends.slice(1), ...many('defend', 5)],
    });
    const picked = chooseExhaust(view, request([strikes[0]!, defends[0]!], 1, 1), blockFirstConfig(0), pact);
    expect(picked.uids).toEqual([defends[0]!.uid]);
    // Greedy has the Defend first anyway; the pick is the same.
    expect(chooseExhaust(view, request([strikes[0]!, defends[0]!], 1, 1), GREEDY_CONFIG, pact).uids).toEqual([
      defends[0]!.uid,
    ]);
  });

  it('Burning Pact: not played when no pick keeps the guard', () => {
    // The only card to exhaust is a Strike, and 4 cards would be left.
    expect(playedId({ hand: [card('pact'), card('strike')], draw: many('strike', 3) })).not.toBe('pact');
  });

  it('Burning Pact: with a valid pick that is not worth exhausting, it is still not played', () => {
    // The Wound can't go (it is not there); a Bash would be the only legal pick but it is not worth it.
    const s = { hand: [card('pact'), card('bash')], draw: [...many('strike', 6)] };
    expect(playedId(s)).not.toBe('pact');
  });

  it('Brand: needs a guard-keeping pick, and a deck of exactly 5 stops it', () => {
    const ok = { hand: [card('brand'), card('wound')], draw: many('strike', 5) };
    expect(playedId(ok)).toBe('brand'); // 5 Strikes + Brand left
    const no = { hand: [card('brand'), card('wound')], draw: many('strike', 3) };
    expect(playedId(no)).not.toBe('brand'); // 3 Strikes + Brand = 4
    const fiveAfter = { hand: [card('brand'), card('wound')], draw: many('strike', 4) };
    expect(playedId(fiveAfter)).toBe('brand'); // 4 Strikes + Brand = 5
  });

  it('Purity: takes fewer than N when the guard stops it, at least one, and is not played with none', () => {
    const wounds = many('wound', 3);
    const purity = card('purity');
    // Purity leaves the deck (Exhaust): 4 Strikes + the 3 Wounds, any 2 Wounds can go (5 cards), a 3rd would leave 4.
    const view = viewOf({ hand: [wounds[0]!, wounds[1]!, wounds[2]!], draw: many('strike', 4) });
    expect(chooseExhaust(view, request(wounds, 0, 3), GREEDY_CONFIG, purity).uids.length).toBe(2);
    // A fifth Strike: all three can go.
    const roomy = viewOf({ hand: wounds, draw: many('strike', 5) });
    expect(chooseExhaust(roomy, request(wounds, 0, 3), GREEDY_CONFIG, purity).uids.length).toBe(3);
    // Played with room for some; not played with room for none (4 Strikes + 1 Wound: the Wound can't go).
    expect(playedId({ hand: [card('purity'), ...many('wound', 3)], draw: many('strike', 4) })).toBe('purity');
    expect(playedId({ hand: [card('purity'), card('wound')], draw: many('strike', 4) })).toBeNull();
  });

  it('Purity: the ratio can stop it too (junk goes, but not the Strikes that keep the ratio)', () => {
    const strikes = many('strike', 2);
    const defends = many('defend', 3);
    const purity = card('purity');
    // 10 active cards after Purity leaves, 2 Strikes in hand: neither Strike can go (1 < 2), Defends can.
    const view = viewOf({ hand: [...strikes, ...defends], draw: many('defend', 5) });
    const picked = chooseExhaust(view, request([...strikes, ...defends], 0, 3), blockFirstConfig(0), purity);
    expect(picked.uids.sort()).toEqual(defends.map((c) => c.uid).sort());
  });

  it('True Grit+: picks within the guard, and is not played when nothing is valid', () => {
    const s = { hand: [card('grit+'), card('defend')], draw: [...many('strike', 5)] };
    expect(playedId(s)).toBe('grit+'); // 5 Strikes + True Grit+ = 6
    const tight = { hand: [card('grit+'), card('strike')], draw: many('strike', 3) };
    expect(playedId(tight)).not.toBe('grit+'); // the Strike can't go: 4 cards
  });

  it('a pick is forced past the guard only when the engine demands more than the guard allows (fallback)', () => {
    const [a, b] = many('strike', 2);
    const view = viewOf({ hand: [a!, b!] });
    expect(chooseExhaust(view, request([a!, b!], 1, 1), GREEDY_CONFIG).uids.length).toBe(1);
  });
});

describe('#141 forced and random exhausts: the strategy does not play the card if the result could break the guard', () => {
  it('Second Wind: exhausts every non-attack; the rest must be healthy', () => {
    // Defend and Wound go (and Wind goes to the discard pile).
    const hand = () => [card('wind'), card('defend'), card('wound')];
    expect(playedId({ hand: hand(), draw: many('strike', 4) })).toBe('wind'); // 4 Strikes + Wind = 5
    expect(playedId({ hand: hand(), draw: many('strike', 3) })).toBeNull(); // 4 cards
    // Ratio: 6 Strikes + Wind = 7 cards, needs 2; one Strike is not enough.
    expect(playedId({ hand: hand(), draw: [card('strike'), ...many('defend', 6)] })).toBeNull();
    expect(playedId({ hand: hand(), draw: [...many('strike', 2), ...many('defend', 5)] })).toBe('wind');
  });

  it('Second Wind: Attacks in hand stay in the deck', () => {
    const hand = () => [card('wind'), card('defend'), card('strike')];
    expect(playedId({ hand: hand(), draw: many('strike', 3) })).toBe('wind'); // Strike + 3 Strikes + Wind = 5
    expect(playedId({ hand: hand(), draw: many('strike', 2) })).toBeNull();
  });

  it('Fiend Fire: the whole hand goes (and Fiend Fire); the draw and discard piles must be healthy', () => {
    const hand = () => [card('fiend'), card('defend'), card('defend')];
    expect(playedId({ hand: hand(), draw: many('strike', 5) })).toBe('fiend');
    expect(playedId({ hand: hand(), draw: many('strike', 4) })).toBeNull(); // 4 cards left
    expect(playedId({ hand: hand(), draw: many('strike', 2), discard: many('strike', 3) })).toBe('fiend');
    // Ratio: 11 cards left with 2 Strikes (needs 3).
    expect(playedId({ hand: hand(), draw: [...many('strike', 2), ...many('defend', 9)] })).toBeNull();
    expect(playedId({ hand: hand(), draw: [...many('strike', 3), ...many('defend', 8)] })).toBe('fiend');
  });

  it('True Grit (random): the worst case removes a damaging card from the hand', () => {
    // 11 cards with True Grit, 3 damaging: worst case 10 cards, 2 damaging.
    const ok = {
      hand: [card('grit'), card('strike'), card('defend')],
      draw: [...many('strike', 2), ...many('defend', 6)],
    };
    expect(playedId(ok)).toBe('grit');
    // 10 cards with True Grit, 2 damaging: worst case 9 cards, 1 damaging, needs 2.
    const bad = {
      hand: [card('grit'), card('strike'), card('defend')],
      draw: [...many('strike', 1), ...many('defend', 6)],
    };
    expect(playedId(bad)).toBeNull();
  });

  it('True Grit (random): damaging cards outside the hand are not at risk', () => {
    // 10 cards, 2 Strikes in the draw pile; only Defends in hand: 9 cards, 2 damaging.
    const s = {
      hand: [card('grit'), card('defend'), card('defend')],
      draw: [...many('strike', 2), ...many('defend', 5)],
    };
    expect(playedId(s)).toBe('grit');
  });

  it('True Grit (random): the worst case for the floor keeps the draw card and exhausts the other', () => {
    // True Grit, Burning Pact, a Defend and 4 Strikes: 7 cards, floor 7 (Pact draws 2).
    // If the Pact went, 6 cards with floor 5 would be fine; if the Defend goes, 6 < 7.
    const hand = [card('grit'), card('pact'), card('defend')];
    expect(exhaustKeepsDeckHealthy(viewOf({ hand, draw: many('strike', 4) }), hand[0]!, GREEDY_CONFIG)).toBe(false);
    const hand2 = [card('grit'), card('pact'), card('defend')];
    expect(exhaustKeepsDeckHealthy(viewOf({ hand: hand2, draw: many('strike', 5) }), hand2[0]!, GREEDY_CONFIG)).toBe(
      true,
    );
  });

  it('True Grit (random): the 5-card minimum counts too', () => {
    expect(playedId({ hand: [card('grit'), card('defend')], draw: many('strike', 4) })).toBe('grit'); // 5 cards left
    expect(playedId({ hand: [card('grit'), card('defend')], draw: many('strike', 3) })).toBeNull(); // 4 left
  });

  it('Cinder (random): worst case, and it stays in the deck as a damaging card', () => {
    // Cinder + Strike in hand, 1 Strike and 8 Defends in the draw pile: 11 cards, 3 damaging -> worst case 10, 2.
    const ok = { hand: [card('cinder'), card('strike')], draw: [card('strike'), ...many('defend', 8)] };
    expect(playedId(ok)).toBe('cinder');
    // 10 cards, 2 damaging -> 9 cards, 1.
    expect(playedId({ hand: [card('cinder'), card('strike')], draw: many('defend', 8) })).toBeNull();
  });

  it('Thrash exhausts a random Attack in hand: the worst case counts', () => {
    // Thrash stays: 10 cards, 3 damaging -> 9 cards, 2.
    const ok = { hand: [card('thrash'), card('strike')], draw: [card('strike'), ...many('defend', 7)] };
    expect(playedId(ok)).toBe('thrash');
    // 10 cards, 2 damaging -> 9 cards, 1.
    expect(playedId({ hand: [card('thrash'), card('strike')], draw: many('defend', 8) })).toBeNull();
    // No Attack in hand: nothing is exhausted.
    expect(playedId({ hand: [card('thrash')], draw: many('defend', 8) })).toBe('thrash');
  });
});

describe('#141 nothing changes without exhaust cards', () => {
  it('a tiny deck without exhaust cards plays as before', () => {
    const view = viewOf({ hand: [card('defend'), card('strike')], draw: [], energy: 3 });
    expect(exhaustKeepsDeckHealthy(view, view.state.player.hand[1]!, GREEDY_CONFIG)).toBe(true);
    const d = GREEDY.decide(view);
    expect(d.kind).toBe('play');
    // The Power is played (never on the "played Powers don't count" side).
    expect(playedId({ hand: [card('flex')], draw: [], energy: 3 })).toBe('flex');
  });
});

describe('#141 in a full combat', () => {
  const data = () => {
    const d = dummyData();
    for (const [id, def] of Object.entries(defs)) if (!d.cards[id]) d.cards[id] = structuredClone(def);
    return d;
  };

  it('after the first exhaust the active deck never gets unhealthy, for Greedy and Block 0', () => {
    let checked = 0;
    for (const strategyConfig of [GREEDY_CONFIG, blockFirstConfig(0), blockFirstConfig(5)]) {
      for (let seed = 1; seed <= 25; seed++) {
        const inner = createStrategy(strategyConfig);
        let exhausted = false;
        const strategy = {
          decide(view: StrategyView) {
            if (view.state.player.exhaustPile.length > 0) exhausted = true;
            if (exhausted) {
              checked++;
              expect(deckHealthy(activeDeck(view.state))).toBe(true);
            }
            return inner.decide(view);
          },
          choose: inner.choose,
        };
        simulateCombat(
          data(),
          cfg({
            enemyId: 'nibbit',
            strategy: strategyConfig,
            seed,
            deck: deckOf(
              ['strike', 5],
              ['defend', 4],
              ['bash', 1],
              ['pact', 1],
              ['purity', 1],
              ['brand', 1],
              ['wind', 1],
              ['grit', 1],
            ),
          }),
          strategy,
        );
      }
    }
    // The decks did exhaust, so the check ran.
    expect(checked).toBeGreaterThan(100);
  });
});
