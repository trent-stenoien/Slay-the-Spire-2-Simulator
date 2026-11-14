/** #323: the Sly strategy credits the Poison powers (Envenom, Accelerant, Outbreak) for a free Sly card. */
import { describe, expect, it } from 'vitest';
import { makeCardInstance } from './combat';
import { createStrategy, GREEDY_CONFIG } from './strategies';
import { gameData } from '../data';
import type { EnemyState, StrategyView } from './types';

function view(hand: string[], powers: Record<string, number>, enemyHp: number, artifact = 0): StrategyView {
  const inst = hand.map((id, i) => makeCardInstance(gameData.cards[id]!, false, i));
  const e = {
    enemyId: 'x',
    name: 'x',
    hp: enemyHp,
    maxHp: enemyHp,
    block: 0,
    strength: 0,
    debuffs: { vulnerable: 0, weak: 0, frail: 0 },
    poison: 0,
    patternIndex: 0,
    powers: artifact ? { artifact } : undefined,
  } as unknown as EnemyState;
  return {
    state: {
      turn: 1,
      player: {
        hp: 80,
        maxHp: 80,
        block: 0,
        energy: 3,
        strength: 0,
        powers,
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
const first = (v: StrategyView) => {
  const d = createStrategy(GREEDY_CONFIG).decide(v);
  return d.kind === 'play' ? v.playable.find((c) => c.uid === d.uid)!.cardId : 'end';
};
const hand = (sly: string) => [sly, 'survivor', 'strike', 'strike', 'strike'];

describe('#323 Sly cards with the Poison powers', () => {
  it('Envenom: Survivor goes first to discard a free Flick-Flack', () => {
    expect(first(view(hand('flick_flack'), { envenom: 1 }, 40))).toBe('survivor');
    expect(first(view(hand('flick_flack'), {}, 40))).not.toBe('survivor');
  });
  it('Envenom: not with Artifact on the enemy', () => {
    expect(first(view(hand('flick_flack'), { envenom: 1 }, 40, 1))).not.toBe('survivor');
  });
  it('Accelerant: Survivor first for Haze when the enemy outlives one turn of Attacks but not two', () => {
    expect(first(view(hand('haze'), { accelerant: 1 }, 20))).toBe('survivor');
    expect(first(view(hand('haze'), {}, 20))).not.toBe('survivor');
  });
  it('Outbreak counts like Accelerant for Haze', () => {
    expect(first(view(hand('haze'), { outbreak: 1 }, 20))).toBe('survivor');
  });
});
