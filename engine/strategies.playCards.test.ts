/** #114 strategy defaults: Havoc early, Cascade with the X-cost attacks (last), support cards with leftover energy. */
import { describe, expect, it } from 'vitest';
import { makeCardInstance } from './combat';
import {
  GREEDY_CONFIG,
  chooseExhaust,
  createStrategy,
  isAttackCard,
  isCascade,
  isHavoc,
  isSupportCard,
} from './strategies';
import { cards } from './testFixtures';
import type { CardDef, CardInstance, ChoiceRequest, CombatState, Effect, StrategyView } from './types';

const def = (id: string, cost: number, effects: Effect[], extra: Partial<CardDef> = {}): CardDef => ({
  ...cards.defend!,
  id,
  code: 'Zz',
  name: id,
  cost,
  effects,
  upgraded: null,
  ...extra,
});

const play = (extra: object): Effect =>
  ({ type: 'playCards', from: 'draw', mode: 'top', count: 1, ...extra }) as Effect;
const defs: Record<string, CardDef> = {
  strike: cards.strike!,
  defend: cards.defend!,
  havoc: def('havoc', 1, [play({ exhaust: true })]),
  cascade: def('cascade', 0, [play({ xTimes: true })], { xCost: true }),
  whirl: def('whirl', 0, [{ type: 'attack', damage: 5, hits: 1, xTimes: true }], { type: 'attack', xCost: true }),
  catastrophe: def('catastrophe', 2, [play({ mode: 'random', count: 2 })]),
  beatdown: def('beatdown', 3, [
    { type: 'playCards', from: 'discard', mode: 'random', count: 3, filter: { types: ['attack'] } },
  ]),
  gem: def('gem', 1, [{ type: 'addReplay', amount: 2, from: 'draw', mode: 'random', filter: { noReplay: true } }]),
  dual: def('dual', 1, [
    {
      type: 'addCards',
      source: { kind: 'copyOf', from: 'hand', mode: 'choose', filter: { types: ['attack'] } },
      count: 1,
      to: 'hand',
    },
  ]),
  inflame: def('inflame', 1, [{ type: 'gainStrength', amount: 2 }], { type: 'power' }),
};

let uid = 0;
const card = (id: string): CardInstance => makeCardInstance(defs[id]!, false, uid++);

interface Setup {
  hand: string[];
  draw?: string[];
  discard?: string[];
  energy?: number;
}

function view(s: Setup): StrategyView {
  const energy = s.energy ?? 3;
  const state: CombatState = {
    turn: 1,
    player: {
      hp: 80,
      maxHp: 80,
      block: 0,
      energy,
      strength: 0,
      debuffs: { vulnerable: 0, weak: 0, frail: 0 },
      drawPile: (s.draw ?? []).map(card),
      hand: s.hand.map(card),
      discardPile: (s.discard ?? []).map(card),
      exhaustPile: [],
    },
    enemy: {
      enemyId: 'dummy',
      name: 'dummy',
      hp: 100,
      maxHp: 100,
      block: 0,
      strength: 0,
      debuffs: { vulnerable: 0, weak: 0, frail: 0 },
      poison: 0,
      patternIndex: 0,
    },
  };
  const p = state.player;
  return {
    state,
    intent: { moveId: 'wait', name: 'Wait', attacks: [], totalIncoming: 0 },
    playable: p.hand.filter((c) => c.cost !== null && c.cost <= energy),
  };
}

/** The card id the strategy plays next, or null for end of turn. */
function next(s: Setup): string | null {
  const v = view(s);
  const d = createStrategy(GREEDY_CONFIG).decide(v);
  return d.kind === 'play' ? v.state.player.hand.find((c) => c.uid === d.uid)!.cardId : null;
}

describe('#114 card classes', () => {
  it('Havoc, Cascade and the support cards are told apart', () => {
    expect([isHavoc(card('havoc')), isHavoc(card('cascade'))]).toEqual([true, false]);
    expect([isCascade(card('cascade')), isCascade(card('havoc'))]).toEqual([true, false]);
    expect(['catastrophe', 'beatdown', 'gem', 'dual'].map((id) => isSupportCard(card(id)))).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(['havoc', 'cascade', 'strike', 'inflame'].map((id) => isSupportCard(card(id)))).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });

  it('Cascade counts as an attack (it is played with the X-cost attacks)', () => {
    expect(isAttackCard(card('cascade'))).toBe(true);
  });
});

describe('#114 Havoc is played early', () => {
  it('before Strike and Defend', () => {
    expect(next({ hand: ['strike', 'defend', 'havoc'], draw: ['strike'] })).toBe('havoc');
  });

  it('not when both piles are empty', () => {
    expect(next({ hand: ['strike', 'havoc'] })).toBe('strike');
  });

  it('plays when only the discard pile has cards', () => {
    expect(next({ hand: ['strike', 'havoc'], discard: ['defend'] })).toBe('havoc');
  });
});

describe('#114 Cascade is played with the X-cost attacks, last', () => {
  it('after other attacks', () => {
    expect(next({ hand: ['cascade', 'strike'], draw: ['strike'] })).toBe('strike');
  });

  it('after an X-cost attack at the same energy, and alone it uses the energy', () => {
    expect(next({ hand: ['cascade', 'whirl'], draw: ['strike'] })).toBe('whirl');
    expect(next({ hand: ['cascade'], draw: ['strike'] })).toBe('cascade');
  });

  it('never at 0 energy, and not with no card to play', () => {
    expect(next({ hand: ['cascade'], draw: ['strike'], energy: 0 })).toBe(null);
    expect(next({ hand: ['cascade'] })).toBe(null);
  });
});

describe('#114 support cards use leftover energy when they have something to act on', () => {
  it('after attacks and Block', () => {
    expect(next({ hand: ['catastrophe', 'strike'], draw: ['strike', 'strike'], energy: 3 })).toBe('strike');
    expect(next({ hand: ['catastrophe'], draw: ['strike', 'strike'], energy: 2 })).toBe('catastrophe');
  });

  it('Beat Down needs an Attack in the discard pile', () => {
    expect(next({ hand: ['beatdown'], discard: ['defend'] })).toBe(null);
    expect(next({ hand: ['beatdown'], discard: ['strike'] })).toBe('beatdown');
  });

  it('Hidden Gem needs a draw-pile card; Dual Wield an Attack in hand', () => {
    expect(next({ hand: ['gem'] })).toBe(null);
    expect(next({ hand: ['gem'], draw: ['strike'] })).toBe('gem');
    expect(next({ hand: ['dual', 'defend'], energy: 1 })).toBe('defend');
    expect(next({ hand: ['dual'], energy: 1 })).toBe(null);
  });
});

describe('#114 copy / Replay picks take the best card', () => {
  it('Dual Wield copies the highest-damage Attack; Powers are ranked by their value', () => {
    const v = view({ hand: ['strike', 'whirl', 'inflame'] });
    const options = v.state.player.hand;
    const request: ChoiceRequest = { purpose: 'copy', from: 'hand', to: 'hand', options, min: 1, max: 1 };
    const picked = chooseExhaust(v, request).uids[0];
    expect(options.find((c) => c.uid === picked)!.cardId).toBe('inflame');
    const two: ChoiceRequest = { ...request, options: options.slice(0, 2) };
    expect(options.find((c) => c.uid === chooseExhaust(v, two).uids[0])!.cardId).toBe('strike');
  });
});
