/** #144: pure draw cards in the exhaust order, and the 0-energy turn share that decides it. */
import { describe, expect, it } from 'vitest';
import { makeCardInstance } from './combat';
import {
  DRAW_EXHAUST_ZERO_ENERGY_SHARE,
  GREEDY_CONFIG,
  createStrategy,
  deckFloor,
  exhaustOrder,
  exhaustTier,
  worthExhausting,
  type TallyConfig,
} from './strategies';
import { cards } from './testFixtures';
import type { CardDef, CardInstance, CombatState, StrategyView } from './types';

const base = cards.defend!;
const def = (id: string, cost: number, effects: CardDef['effects'], extra: Partial<CardDef> = {}): CardDef => ({
  ...base,
  id,
  code: 'Zz',
  name: id,
  cost,
  effects,
  upgraded: null,
  ...extra,
});

const defs: Record<string, CardDef> = {
  strike: cards.strike!,
  defend: cards.defend!,
  bash: cards.bash!,
  /** Draw only, costs 1. */
  think: def('think', 1, [{ type: 'draw', amount: 2 }]),
  /** Draw only, free. */
  free: def('free', 0, [{ type: 'draw', amount: 3 }]),
  /** Draws, but also gives Block: not a pure draw card. */
  shrug: def('shrug', 1, [
    { type: 'gainBlock', amount: 8 },
    { type: 'draw', amount: 1 },
  ]),
  dazed: def('dazed', 0, [], { type: 'status', cost: null, keywords: ['unplayable', 'ethereal'] }),
};

let uid = 0;
const card = (id: string): CardInstance => makeCardInstance(defs[id]!, false, uid++);
const ids = (cs: readonly { cardId: string }[]) => cs.map((c) => c.cardId);

const OPEN: TallyConfig = { ...GREEDY_CONFIG, drawExhaustible: true };

describe('#144 exhaust tier of pure draw cards', () => {
  it('1+ cost pure draw: tier 6.5 when exhaustible, else 8; 0-cost and draw+Block are always 8', () => {
    expect(['think', 'free', 'shrug'].map((id) => exhaustTier(card(id), OPEN))).toEqual([6.5, 8, 8]);
    expect(['think', 'free', 'shrug'].map((id) => exhaustTier(card(id), GREEDY_CONFIG))).toEqual([8, 8, 8]);
    expect(worthExhausting(card('think'), OPEN)).toBe(true);
    expect(worthExhausting(card('think'))).toBe(false);
  });

  it('exhaustible: right after Strikes and Defends, before Ethereal junk and the rest', () => {
    const hand = ['bash', 'dazed', 'think', 'strike', 'free', 'defend'].map(card);
    expect(ids(exhaustOrder(hand, undefined, OPEN))).toEqual(['defend', 'strike', 'think', 'dazed', 'bash', 'free']);
  });

  it('otherwise never first: forced picks take every other card before a draw card', () => {
    const hand = ['think', 'free', 'bash', 'shrug'].map(card);
    expect(ids(exhaustOrder(hand, undefined, GREEDY_CONFIG)).slice(-2)).toEqual(['think', 'free']);
  });
});

describe('#144 deck floor', () => {
  const deck = (...xs: string[]) => xs.map(card);
  it('counts a draw card unless it is exhaustible (1+ cost, share reached)', () => {
    const d = deck('think', 'free', 'strike');
    expect(deckFloor(d)).toBe(5 + 2 + 3);
    expect(deckFloor(d, GREEDY_CONFIG)).toBe(10);
    expect(deckFloor(d, OPEN)).toBe(8); // Think no longer counts; the free one always does
  });
});

describe('#144 0-energy turn share', () => {
  /** A view at `turn` with `energy` left and nothing in hand, so the strategy ends its turn. */
  const view = (turn: number, energy: number, played = 0): StrategyView =>
    ({
      state: {
        turn,
        player: {
          hp: 80,
          maxHp: 80,
          block: 0,
          energy,
          strength: 0,
          debuffs: { vulnerable: 0, weak: 0, frail: 0 },
          drawPile: Array.from({ length: 20 }, () => card('strike')),
          hand: [],
          discardPile: [],
          exhaustPile: [],
          counters: { cardsPlayedThisCombat: played },
        },
        enemy: {
          enemyId: 'x',
          name: 'x',
          hp: 50,
          maxHp: 50,
          block: 0,
          strength: 0,
          debuffs: { vulnerable: 0, weak: 0, frail: 0 },
          poison: 0,
          patternIndex: 0,
        },
      } as unknown as CombatState,
      intent: { moveId: 'x', name: 'x', attacks: [], totalIncoming: 0 },
      playable: [],
    }) as StrategyView;

  /** Plays turns with these end energies, then asks the strategy to exhaust one of [think, bash] on the next turn. */
  function pickAfter(endEnergies: number[]): string {
    const s = createStrategy(GREEDY_CONFIG);
    endEnergies.forEach((e, i) => s.decide(view(i + 1, e)));
    const v = view(endEnergies.length + 1, 3);
    s.decide(v);
    const options = [card('think'), card('bash')];
    const r = s.choose!(v, { purpose: 'exhaust', from: 'hand', to: 'exhaust', options, min: 1, max: 1 });
    return options.find((o) => o.uid === r.uids[0])!.cardId;
  }

  it('the threshold is 80%', () => {
    expect(DRAW_EXHAUST_ZERO_ENERGY_SHARE).toBe(0.8);
  });

  it('no turns finished yet: draw cards are not exhausted', () => {
    expect(pickAfter([])).toBe('bash');
  });

  it('4 of 5 turns ended with 0 energy (exactly 80%): the draw card goes first', () => {
    expect(pickAfter([0, 0, 1, 0, 0])).toBe('think');
  });

  it('3 of 4 turns (75%): the draw card stays', () => {
    expect(pickAfter([0, 1, 0, 0])).toBe('bash');
  });

  it('only turns of this combat count: a new combat starts the tally again', () => {
    const s = createStrategy(GREEDY_CONFIG);
    for (let t = 1; t <= 4; t++) s.decide(view(t, 0, t));
    s.decide(view(1, 3, 0)); // a new combat: the turn number went back to 1
    const v = view(2, 3, 0);
    s.decide(v);
    const options = [card('think'), card('bash')];
    const r = s.choose!(v, { purpose: 'exhaust', from: 'hand', to: 'exhaust', options, min: 1, max: 1 });
    expect(options.find((o) => o.uid === r.uids[0])!.cardId).toBe('bash');
  });
});
