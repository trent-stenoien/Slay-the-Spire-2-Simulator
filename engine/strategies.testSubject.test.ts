/** #382 / #339: strategies and Test Subject: revive (no target), enemy Intangible, Enrage on Skills. */
import { describe, expect, it } from 'vitest';
import { makeCardInstance } from './combat';
import { createStrategy, GREEDY_CONFIG } from './strategies';
import { gameData } from '../data';
import type { EnemyState, StrategyView } from './types';

interface Opts {
  powers?: Record<string, number>;
  reviving?: boolean;
  hp?: number;
  incoming?: number;
  hits?: number;
  playerHp?: number;
}

function view(hand: string[], o: Opts = {}): StrategyView {
  const inst = hand.map((id, i) => makeCardInstance(gameData.cards[id]!, false, i));
  const e = {
    enemyId: 'x',
    name: 'x',
    hp: o.reviving ? 0 : (o.hp ?? 100),
    maxHp: 100,
    block: 0,
    strength: 0,
    debuffs: { vulnerable: 0, weak: 0, frail: 0 },
    poison: 0,
    patternIndex: 0,
    powers: o.powers,
    reviving: o.reviving,
  } as unknown as EnemyState;
  const incoming = o.incoming ?? 0;
  return {
    state: {
      turn: 1,
      player: {
        hp: o.playerHp ?? 80,
        maxHp: 80,
        block: 0,
        energy: 3,
        strength: 0,
        hand: inst,
        drawPile: [],
        discardPile: [],
        exhaustPile: [],
      },
      enemy: e,
      enemies: [e],
    },
    intent: {
      moveId: 'm',
      name: 'm',
      attacks: incoming ? [{ damagePerHit: incoming / (o.hits ?? 1), hits: o.hits ?? 1 }] : [],
      totalIncoming: incoming,
    },
    playable: inst,
  } as unknown as StrategyView;
}

/** Ids played in order until the strategy ends the turn (the view is not updated between plays). */
const first = (v: StrategyView) => {
  const d = createStrategy(GREEDY_CONFIG).decide(v);
  return d.kind === 'play' ? v.playable.find((c) => c.uid === d.uid)!.cardId : 'end';
};

describe('#382 Test Subject: revive and Intangible', () => {
  it('plays an Attack against a living enemy (control)', () => {
    expect(first(view(['strike']))).toBe('strike');
  });
  it('holds Attacks while the only enemy is reviving (no target)', () => {
    expect(first(view(['strike', 'strike'], { reviving: true }))).toBe('end');
  });
  it('plays Block instead of the Attack while reviving', () => {
    expect(first(view(['strike', 'defend'], { reviving: true, incoming: 10 }))).toBe('defend');
  });
  it('holds a 1-hit Attack into Intangible and plays Block', () => {
    expect(first(view(['strike', 'defend'], { powers: { intangible: 1 }, incoming: 10 }))).toBe('defend');
  });
  it('plays an Attack into Intangible when nothing else is left to play', () => {
    expect(first(view(['strike'], { powers: { intangible: 1 } }))).toBe('strike');
  });
  it('still plays an Attack into Intangible when its hits would kill', () => {
    expect(first(view(['strike', 'defend'], { powers: { intangible: 1 }, hp: 1 }))).toBe('strike');
  });
  it('plays a card with more hits than its cost into Intangible', () => {
    expect(first(view(['twin_strike'], { powers: { intangible: 1 } }))).toBe('twin_strike');
  });
});

describe('#339 Test Subject: Enrage punishes Skills', () => {
  it('holds a Defend when its useful Block is worth less than the Strength it gives', () => {
    // Enrage 2 x 1 hit x 3 turns = 6 > 5 useful Block.
    expect(first(view(['defend'], { powers: { enrage: 2 }, incoming: 20 }))).toBe('end');
  });
  it('plays the Defend without Enrage', () => {
    expect(first(view(['defend'], { incoming: 20 }))).toBe('defend');
  });
  it('plays the Defend when the Block is worth more than the Strength', () => {
    expect(first(view(['defend'], { powers: { enrage: 1 }, incoming: 20 }))).toBe('defend');
  });
  it('plays the Defend when the attack would be lethal', () => {
    expect(first(view(['defend'], { powers: { enrage: 2 }, incoming: 20, playerHp: 15 }))).toBe('defend');
  });
  it('plays an Attack in phase 1 (only Skills are punished)', () => {
    expect(first(view(['strike', 'defend'], { powers: { enrage: 2 }, incoming: 20 }))).toBe('strike');
  });
});
