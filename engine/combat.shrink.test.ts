/** #4: Shrink (Shrinker Beetle): the player's attacks deal 30% less, after all other modifiers. */
import { describe, expect, it } from 'vitest';
import { runCombat } from './combat';
import { attackDamage } from './rules';
import { fiendFireKills } from './strategies';
import { cards, makeEnemy, makeGameData } from './testFixtures';
import { deckOf, events, logged, scripted, withEnemy, cfg } from './combatTestHelpers';
import type { CardInstance, Effect, StrategyView } from './types';

describe('attackDamage with Shrink', () => {
  it('multiplies by (100 − percent)% after Strength, Weak and Vulnerable, then floors once', () => {
    expect(attackDamage(6, 0, 0, 0, 0, 30)).toBe(4); // 4.2
    expect(attackDamage(10, 0, 0, 0, 0, 30)).toBe(7); // exactly 7, not 6.999…
    expect(attackDamage(20, 0, 0, 0, 0, 30)).toBe(14);
    expect(attackDamage(6, 2, 0, 0, 0, 30)).toBe(5); // (6 + 2) × 0.7 = 5.6
    expect(attackDamage(10, 0, 1, 0, 0, 30)).toBe(5); // 10 × 0.75 × 0.7 = 5.25
    expect(attackDamage(10, 0, 0, 1, 0, 30)).toBe(10); // 10 × 1.5 × 0.7 = 10.5
    // One floor at the end: 3 × 1.5 = 4.5, × 0.7 = 3.15 → 3 (flooring 4.5 first would give 2).
    expect(attackDamage(3, 0, 0, 1, 0, 30)).toBe(3);
    expect(attackDamage(10, 0, 0, 1, 50, 30)).toBe(14); // Cruelty 50: 10 × 2 × 0.7
    expect(attackDamage(6, 0, 0, 0, 0, 0)).toBe(6);
    expect(attackDamage(0, -3, 0, 0, 0, 30)).toBe(0);
  });
});

describe('Shrink in combat', () => {
  const shrinker = (moves: Effect[][] = [[{ type: 'applyShrink', amount: 30 }]], hp = 999) =>
    makeEnemy('shr', hp, Object.fromEntries(moves.map((effects, i) => [`m${i}`, { name: `M${i}`, effects }])));

  it('applies to the player after the move; later player attacks deal 30% less', () => {
    const data = withEnemy(makeGameData(), shrinker([[{ type: 'applyShrink', amount: 30 }], []]));
    const strat = scripted(() => ['strike']);
    const log = logged(data, strat, { enemyId: 'shr', deck: deckOf(['strike', 10]) }).log;
    expect(events(log, 'shrink')[0]).toEqual({ t: 'shrink', percent: 30 });
    const hits = events(log, 'damage').filter((d) => d.source === 'player');
    expect(hits[0]!.amount).toBe(6); // turn 1, before the Shrinker move
    expect(hits[1]!.amount).toBe(4); // floor(6 × 0.7)
    expect(hits.slice(1).every((h) => h.amount === 4)).toBe(true);
  });

  it('does not change the enemy attacks', () => {
    const data = withEnemy(
      makeGameData(),
      shrinker([[{ type: 'applyShrink', amount: 30 }], [{ type: 'attack', damage: 10, hits: 1 }]]),
    );
    const log = logged(
      data,
      scripted(() => []),
      { enemyId: 'shr', deck: deckOf(['defend', 10]) },
    ).log;
    const enemyHits = events(log, 'damage').filter((d) => d.source === 'enemy');
    expect(enemyHits[0]!.amount).toBe(10);
  });

  it('does not stack: a second Shrink keeps the larger percent', () => {
    const data = withEnemy(
      makeGameData(),
      shrinker([
        [{ type: 'applyShrink', amount: 30 }],
        [{ type: 'applyShrink', amount: 30 }],
        [{ type: 'applyShrink', amount: 20 }],
      ]),
    );
    const log = logged(
      data,
      scripted(() => ['strike']),
      { enemyId: 'shr', deck: deckOf(['strike', 10]) },
    ).log;
    expect(
      events(log, 'shrink')
        .slice(0, 3)
        .map((e) => e.percent),
    ).toEqual([30, 30, 30]);
    const hits = events(log, 'damage').filter((d) => d.source === 'player');
    expect(hits.slice(1).every((h) => h.amount === 4)).toBe(true);
  });

  it('is applied after Vulnerable: Bash then Strike on a Vulnerable enemy, Shrunk', () => {
    const data = withEnemy(makeGameData(), shrinker([[{ type: 'applyShrink', amount: 30 }], []]));
    const strat = scripted((turn) => (turn === 2 ? ['bash', 'strike'] : []));
    const log = logged(data, strat, { enemyId: 'shr', deck: deckOf(['bash', 1], ['strike', 4]) }).log;
    const hits = events(log, 'damage').filter((d) => d.source === 'player');
    expect(hits[0]!.amount).toBe(5); // Bash 8 × 0.7 = 5.6
    expect(hits[1]!.amount).toBe(6); // Strike 6 × 1.5 × 0.7 = 6.3
  });

  it('a card cannot apply Shrink (v1 simulates it on enemy moves only)', () => {
    const data = withEnemy(makeGameData(), shrinker([[]]));
    data.cards.shrinkRay = {
      ...cards.defend!,
      id: 'shrinkRay',
      code: 'Sr',
      cost: 0,
      effects: [{ type: 'applyShrink', amount: 30 }],
      upgraded: null,
    };
    const strat = scripted(() => ['shrinkRay']);
    expect(() => logged(data, strat, { enemyId: 'shr', deck: deckOf(['shrinkRay', 5]) })).toThrow(/Shrink/);
  });

  it('Shrink ends with the Beetle: killing it ends the combat (single enemy)', () => {
    const data = withEnemy(makeGameData(), shrinker([[{ type: 'applyShrink', amount: 30 }], []], 10));
    expect(runCombat(data, cfg({ enemyId: 'shr', deck: deckOf(['strike', 10]) })).outcome).toBe('win');
  });
});

describe('strategy kill checks see Shrink', () => {
  it('fiendFireKills uses the Shrunk damage', () => {
    const ff = {
      uid: 9,
      cardId: 'fiend_fire',
      type: 'attack',
      effects: [{ type: 'script', id: 'fiendFire', values: [7] }],
    };
    const other = (uid: number) => ({ uid, cardId: 'defend', type: 'skill', keywords: [], effects: [] });
    const view = (shrink: number, enemyHp: number) =>
      ({
        state: {
          turn: 1,
          player: {
            strength: 0,
            debuffs: { vulnerable: 0, weak: 0, frail: 0 },
            hand: [ff, other(1), other(2)],
            powers: {},
            shrink,
          },
          enemy: { hp: enemyHp, block: 0, debuffs: { vulnerable: 0, weak: 0, frail: 0 } },
        },
      }) as unknown as StrategyView;
    // 2 other cards × 7 = 14 unshrunk; Shrunk: 2 × floor(4.9) = 8.
    expect(fiendFireKills(view(0, 14), ff as unknown as CardInstance)).toBe(true);
    expect(fiendFireKills(view(30, 14), ff as unknown as CardInstance)).toBe(false);
    expect(fiendFireKills(view(30, 8), ff as unknown as CardInstance)).toBe(true);
  });
});
