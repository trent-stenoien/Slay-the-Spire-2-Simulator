/** #204: potions in combat, and the shared potion-use rules (pickPotion). */
import { describe, expect, it } from 'vitest';
import { gameData } from '../data';
import { simulateCombat } from './combat';
import { cfg, events, logged, scripted, withEnemy } from './combatTestHelpers';
import { makeEnemy, makeGameData } from './testFixtures';
import { createStrategy, GREEDY_CONFIG } from './strategies';
import { pickPotion } from './potions';
import type { GameData, Strategy, StrategyView } from './types';

const potionData = (hp: number, moves?: Parameters<typeof makeEnemy>[2]): GameData => {
  const data = withEnemy(makeGameData(), makeEnemy('target', hp, moves ?? { wait: { name: 'Wait', effects: [] } }));
  data.potions = structuredClone(gameData.potions);
  return data;
};

/** Uses the first held potion whenever asked (turn 1 only unless `always`). */
const useAll: Strategy = {
  decide: () => ({ kind: 'endTurn' }),
  usePotion: (v) => {
    const slot = (v.state.player.potions ?? []).findIndex((p) => p !== null);
    return slot >= 0 ? { slot } : null;
  },
};

describe('potion data', () => {
  it('has Strength Potion (gain 2 Strength) and Fire Potion (deal 20 damage)', () => {
    expect(gameData.potions?.strength_potion?.effects).toEqual([{ type: 'gainStrength', amount: 2 }]);
    expect(gameData.potions?.fire_potion?.effects).toEqual([{ type: 'dealDamage', amount: 20 }]);
  });
});

describe('using potions', () => {
  it('costs no energy, empties the slot, logs a potion event, and works only once', () => {
    const r = logged(potionData(999), useAll, { enemyId: 'target', potions: ['strength_potion', 'strength_potion'] });
    const ev = events(r.log, 'potion');
    expect(ev.map((e) => e.slot)).toEqual([0, 1]);
    expect(events(r.log, 'strength').map((e) => e.total)).toEqual([2, 4]);
    expect(events(r.log, 'energy')).toEqual([]);
  });

  it('a strategy without usePotion never uses them', () => {
    const r = logged(
      potionData(999),
      { decide: () => ({ kind: 'endTurn' }) },
      { enemyId: 'target', potions: ['fire_potion'] },
    );
    expect(events(r.log, 'potion')).toEqual([]);
  });

  it('Strength Potion is used before the first card of turn 1 and raises Strike to 8', () => {
    const strategy = createStrategy(GREEDY_CONFIG);
    const r = logged(potionData(999), strategy, { enemyId: 'target', potions: ['strength_potion'] });
    const log = r.log ?? [];
    const potionAt = log.findIndex((e) => e.t === 'potion');
    const firstPlay = log.findIndex((e) => e.t === 'play');
    expect(potionAt).toBeGreaterThan(-1);
    expect(potionAt).toBeLessThan(firstPlay);
    expect(events(log, 'potion')).toHaveLength(1);
    const firstHit = events(log, 'damage').find((e) => e.source === 'player');
    expect(firstHit?.amount).toBeGreaterThanOrEqual(8);
  });

  it('Fire Potion deals 20 damage that ignores Strength and goes through Block', () => {
    const data = potionData(100, { guard: { name: 'Guard', effects: [{ type: 'gainBlock', amount: 12 }] } });
    // Turn 1: Strength Potion then Fire Potion (no Block yet); turn 2: enemy has 12 Block.
    const strategy: Strategy = {
      decide: () => ({ kind: 'endTurn' }),
      usePotion: (v) => {
        const p = v.state.player.potions ?? [];
        const slot =
          v.state.turn === 1 ? p.findIndex((x) => x === 'strength_potion') : p.findIndex((x) => x === 'fire_potion');
        return slot >= 0 && p[slot] !== null && (v.state.turn === 1 || v.state.turn === 2) ? { slot } : null;
      },
    };
    const r = logged(data, strategy, { enemyId: 'target', potions: ['strength_potion', 'fire_potion'] });
    const hit = events(r.log, 'damage').find((e) => e.source === 'player');
    expect(hit).toMatchObject({ amount: 20, blocked: 12, hpLoss: 8 });
  });

  it('Fire Potion that kills the enemy wins the combat', () => {
    const r = logged(potionData(15), useAll, { enemyId: 'target', potions: ['fire_potion'] });
    expect(r.outcome).toBe('win');
    expect(r.turns).toBe(1);
  });

  it('rejects an unknown potion id and an empty slot', () => {
    expect(() => simulateCombat(potionData(10), cfg({ enemyId: 'target', potions: ['nope'] }), useAll)).toThrow(
      /Unknown potion/,
    );
    const twice: Strategy = { decide: () => ({ kind: 'endTurn' }), usePotion: () => ({ slot: 0 }) };
    expect(() =>
      simulateCombat(potionData(999), cfg({ enemyId: 'target', potions: ['strength_potion'] }), twice),
    ).toThrow(/empty or unknown/);
  });

  it('scripted card play still works with potions held', () => {
    const r = simulateCombat(
      potionData(999),
      cfg({ enemyId: 'target', potions: ['fire_potion'] }),
      scripted(() => ['strike']),
    );
    expect(r.outcome).not.toBe('loss');
  });
});

describe('pickPotion rules', () => {
  const view = (o: {
    potions: (string | null)[];
    turn?: number;
    enemy?: { hp?: number; block?: number; powers?: Record<string, number> };
    hp?: number;
    block?: number;
    incoming?: number;
  }) =>
    ({
      state: {
        turn: o.turn ?? 1,
        player: { hp: o.hp ?? 80, block: o.block ?? 0, potions: o.potions },
        enemy: { hp: 50, block: 0, ...o.enemy },
      },
      intent: { totalIncoming: o.incoming ?? 0 },
    }) as unknown as StrategyView;

  it('Strength Potion is used at once', () => {
    expect(pickPotion(view({ potions: [null, 'strength_potion'] }))).toEqual({ slot: 1 });
  });
  it('Strength Potion goes before the Fire Potion', () => {
    expect(pickPotion(view({ potions: ['fire_potion', 'strength_potion'] }))).toEqual({ slot: 1 });
  });
  it('Fire Potion is used when the enemy has no Block and no Slippery', () => {
    expect(pickPotion(view({ potions: ['fire_potion'] }))).toEqual({ slot: 0 });
  });
  it('Fire Potion waits while the enemy has Slippery', () => {
    expect(pickPotion(view({ potions: ['fire_potion'], enemy: { powers: { slippery: 8 } } }))).toBeNull();
  });
  it('Fire Potion waits while the enemy has Block', () => {
    expect(pickPotion(view({ potions: ['fire_potion'], enemy: { block: 5 } }))).toBeNull();
  });
  it('Fire Potion is used when it kills through Block (HP + Block ≤ 20)', () => {
    expect(pickPotion(view({ potions: ['fire_potion'], enemy: { hp: 12, block: 8 } }))).toEqual({ slot: 0 });
    expect(pickPotion(view({ potions: ['fire_potion'], enemy: { hp: 13, block: 8 } }))).toBeNull();
  });
  it('Fire Potion does not count a kill under Slippery', () => {
    expect(pickPotion(view({ potions: ['fire_potion'], enemy: { hp: 5, powers: { slippery: 1 } } }))).toBeNull();
  });
  it('Fire Potion is used when the coming attack could kill the player, even under Slippery or Block', () => {
    const enemy = { block: 10, powers: { slippery: 3 } };
    expect(pickPotion(view({ potions: ['fire_potion'], enemy, hp: 20, block: 4, incoming: 24 }))).toEqual({ slot: 0 });
    expect(pickPotion(view({ potions: ['fire_potion'], enemy, hp: 20, block: 4, incoming: 23 }))).toBeNull();
  });
  it('nothing held, nothing used', () => {
    expect(pickPotion(view({ potions: [null] }))).toBeNull();
    expect(pickPotion({ ...view({ potions: [] }) })).toBeNull();
  });
});
