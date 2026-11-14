/** #46 (Trent): Poison-only cards are played before the Attacks when the enemy will live 2+ more turns. */
import { describe, expect, it } from 'vitest';
import { makeCardInstance } from './combat';
import { blockFirstConfig, createStrategy, GREEDY_CONFIG, isPoisonOnly, poisonApplications } from './strategies';
import { cards } from './testFixtures';
import type { CardDef, EnemyState, StrategyConfig, StrategyView } from './types';

const poison = (id: string, amount: number, extra: Partial<CardDef> = {}): CardDef => ({
  ...cards.strike!,
  id,
  code: 'Dp',
  type: 'skill',
  cost: 1,
  effects: [{ type: 'applyPoison', amount }],
  upgraded: null,
  ...extra,
});
const deadly = poison('deadly_poison', 5);
const flask = poison('bouncing_flask', 3, {
  effects: [{ type: 'repeat', per: 'constant' as never, times: 3, effects: [{ type: 'applyPoison', amount: 3 }] }],
});

function view(enemy: Partial<EnemyState>, hand: CardDef[], energy = 3, strength = 0): StrategyView {
  const inst = hand.map((c, i) => makeCardInstance(c, false, i));
  const e = {
    enemyId: 'x',
    name: 'x',
    hp: 30,
    maxHp: 30,
    block: 0,
    strength: 0,
    debuffs: { vulnerable: 0, weak: 0, frail: 0 },
    poison: 0,
    patternIndex: 0,
    ...enemy,
  } as EnemyState;
  return {
    state: {
      turn: 1,
      player: {
        hp: 80,
        maxHp: 80,
        block: 0,
        energy,
        strength,
        hand: inst,
        drawPile: [],
        discardPile: [],
        exhaustPile: [],
      },
      enemy: e,
      enemies: [e],
    },
    intent: { moveId: 'm', name: 'm', attacks: [], totalIncoming: 0 },
    playable: inst,
  } as unknown as StrategyView;
}

const first = (v: StrategyView, config: StrategyConfig = GREEDY_CONFIG) => {
  const d = createStrategy(config).decide(v);
  return d.kind === 'play' ? v.playable.find((c) => c.uid === d.uid)!.cardId : 'end';
};
const strike = cards.strike!;

describe('#46 Poison-only cards', () => {
  it('recognises Poison-only cards and counts applications (Bouncing Flask = 3)', () => {
    const [dp, fl, st] = [deadly, flask, strike].map((c) => makeCardInstance(c, false, 0));
    expect(isPoisonOnly(dp!)).toBe(true);
    expect(isPoisonOnly(st!)).toBe(false);
    expect(poisonApplications(dp!)).toBe(1);
    expect(poisonApplications(fl!)).toBe(3);
  });

  it('plays Poison before the Attacks when the enemy lives 2+ more turns', () => {
    expect(first(view({ hp: 60 }, [strike, strike, deadly]))).toBe('deadly_poison');
    expect(first(view({ hp: 60 }, [strike, strike, deadly]), blockFirstConfig(99))).toBe('deadly_poison');
  });

  it('attacks instead when the Attacks alone end the fight within two turns', () => {
    // 2 Strikes = 12 a turn; HP 20 dies on the second turn of attacks.
    expect(first(view({ hp: 20 }, [strike, strike, deadly]))).toBe('strike');
    expect(first(view({ hp: 12 }, [strike, strike, deadly]))).toBe('strike');
  });

  it('counts Poison already on the enemy toward its death', () => {
    expect(first(view({ hp: 30, poison: 10 }, [strike, strike, deadly]))).toBe('strike');
    expect(first(view({ hp: 30, poison: 0 }, [strike, strike, deadly]))).toBe('deadly_poison');
  });

  it('enemy Block favours Poison (Poison ignores Block)', () => {
    // 3 Strikes: 18 a turn; HP 30 dies in two turns, but 20 Block cuts each turn to 0.
    const hand = [strike, strike, strike, deadly];
    expect(first(view({ hp: 30 }, hand, 4))).toBe('strike');
    expect(first(view({ hp: 30, block: 20 }, hand, 4))).toBe('deadly_poison');
  });

  it('enemy Artifact counts against Poison; enough stacks to absorb every application', () => {
    const hand = [strike, strike, deadly];
    expect(first(view({ hp: 60, powers: { artifact: 1 } }, hand))).toBe('strike');
    expect(first(view({ hp: 60, powers: { artifact: 1 } }, [strike, strike, flask]))).toBe('bouncing_flask');
    expect(first(view({ hp: 60, powers: { artifact: 3 } }, [strike, strike, flask]))).toBe('strike');
  });

  it('counts Strength and Vulnerable in the damage estimate', () => {
    const hand = [strike, strike, deadly];
    // 12 a turn, HP 30: 2 turns of attacks leave it at 6 -> Poison first; with Strength 3 (18 a turn) it dies in 2.
    expect(first(view({ hp: 30 }, hand))).toBe('deadly_poison');
    expect(first(view({ hp: 30 }, hand, 3, 3))).toBe('strike');
    expect(first(view({ hp: 30, debuffs: { vulnerable: 2, weak: 0, frail: 0 } }, hand))).toBe('strike');
  });

  it('does not budget the Poison card energy for Attacks', () => {
    // 1 energy left after Deadly Poison pays for one Strike only.
    expect(first(view({ hp: 17 }, [strike, strike, deadly], 2))).toBe('deadly_poison');
  });
});
