/** Core combat rules: pure helpers, setup, end conditions. */
import { describe, expect, it } from 'vitest';
import { computeIntent, makeCardInstance, runCombat } from './combat';
import { attackDamage, blockGain } from './rules';
import { cards, makeEnemy, makeGameData } from './testFixtures';
import { cfg, deckOf, passive, withEnemy, dummyData, noDebuffs, logged, events } from './combatTestHelpers';
import type { CardDef } from './types';
import { blockFirstConfig } from './strategies';

describe('rule helpers', () => {
  it('attackDamage: Strength, Weak, Vulnerable, floor once, min 0', () => {
    expect(attackDamage(6, 0, 0, 0)).toBe(6);
    expect(attackDamage(6, 2, 0, 0)).toBe(8);
    expect(attackDamage(6, 0, 0, 1)).toBe(9);
    expect(attackDamage(6, 0, 1, 0)).toBe(4); // 4.5 → 4
    expect(attackDamage(7, 0, 1, 1)).toBe(7); // 7 × 0.75 × 1.5 = 7.875 → 7 (single floor)
    expect(attackDamage(2, -5, 0, 0)).toBe(0);
  });

  it('blockGain: Frail ×0.75 floored', () => {
    expect(blockGain(5, 0)).toBe(5);
    expect(blockGain(5, 1)).toBe(3);
    expect(blockGain(8, 2)).toBe(6);
  });

  it('computeIntent: non-attack move is 0/0/0', () => {
    const i = computeIntent(
      'hiss',
      { name: 'Hiss', effects: [{ type: 'gainStrength', amount: 2 }] },
      { strength: 0, debuffs: noDebuffs() },
      { debuffs: noDebuffs() },
    );
    expect(i).toEqual({ moveId: 'hiss', name: 'Hiss', attacks: [], totalIncoming: 0 });
  });

  it('computeIntent: multi-hit with Strength and player Vulnerable', () => {
    const i = computeIntent(
      'x',
      { name: 'X', effects: [{ type: 'attack', damage: 2, hits: 2 }] },
      { strength: 2, debuffs: noDebuffs() },
      { debuffs: { vulnerable: 1, weak: 0, frail: 0 } },
    );
    expect(i).toMatchObject({ attacks: [{ damagePerHit: 6, hits: 2 }], totalIncoming: 12 });
  });

  it('computeIntent: sums across several attack effects', () => {
    const i = computeIntent(
      'x',
      {
        name: 'X',
        effects: [
          { type: 'attack', damage: 5, hits: 1 },
          { type: 'gainBlock', amount: 3 },
          { type: 'attack', damage: 3, hits: 2 },
        ],
      },
      { strength: 1, debuffs: noDebuffs() },
      { debuffs: noDebuffs() },
    );
    expect(i).toMatchObject({
      attacks: [
        { damagePerHit: 6, hits: 1 },
        { damagePerHit: 4, hits: 2 },
      ],
      totalIncoming: 6 + 4 * 2,
    });
  });

  it('makeCardInstance applies upgrades and nulls cost for unplayable', () => {
    const s = makeCardInstance(cards.strike!, true, 3);
    expect(s).toMatchObject({ uid: 3, upgraded: true, cost: 1, effects: [{ type: 'attack', damage: 9, hits: 1 }] });
    const def: CardDef = { ...cards.strike!, upgraded: { cost: 0, keywords: ['exhaust'] } };
    expect(makeCardInstance(def, true, 0)).toMatchObject({ cost: 0, keywords: ['exhaust'], effects: [{ damage: 6 }] });
    expect(makeCardInstance({ ...cards.strike!, keywords: ['unplayable'] }, false, 0).cost).toBeNull();
    expect(() => makeCardInstance(cards.ascenders_bane!, true, 0)).toThrow();
  });
});

describe('runCombat setup', () => {
  it('is deterministic: same config + seed → identical log and result', () => {
    const data = makeGameData();
    const a = runCombat(data, cfg({ seed: 777 }), { log: true });
    const b = runCombat(data, cfg({ seed: 777 }), { log: true });
    expect(a).toEqual(b);
    expect(a.log!.length).toBeGreaterThan(10);
  });

  it('different seeds generally differ', () => {
    const data = makeGameData();
    const logs = new Set(
      Array.from({ length: 10 }, (_, s) => JSON.stringify(runCombat(data, cfg({ seed: s }), { log: true }).log)),
    );
    expect(logs.size).toBeGreaterThan(1);
  });

  it('omits the log unless requested', () => {
    const r = runCombat(makeGameData(), cfg());
    expect(r.log).toBeUndefined();
    expect('log' in r).toBe(false);
  });

  it('rolls enemy HP in range and starts the player at max HP', () => {
    const data = makeGameData();
    const hps = new Set<number>();
    for (let s = 0; s < 200; s++) {
      const start = events(runCombat(data, cfg({ seed: s }), { log: true }).log, 'combatStart')[0]!;
      expect(start.playerHp).toBe(80);
      hps.add(start.enemyHp);
    }
    expect([...hps].sort()).toEqual([42, 43, 44, 45, 46]);
  });

  it('A8 Nibbit rolls 44–48 HP', () => {
    const data = makeGameData();
    for (let s = 0; s < 100; s++) {
      const hp = events(runCombat(data, cfg({ seed: s, ascension: 8 }), { log: true }).log, 'combatStart')[0]!.enemyHp;
      expect(hp).toBeGreaterThanOrEqual(44);
      expect(hp).toBeLessThanOrEqual(48);
    }
  });

  it('assigns uids 0..n-1 and logs the start shuffle', () => {
    const r = logged(makeGameData(), passive, { deck: deckOf(['defend', 10]) });
    expect(events(r.log, 'shuffle')[0]).toEqual({ t: 'shuffle', reason: 'start', count: 10 });
    const firstTen = events(r.log, 'draw')
      .slice(0, 10)
      .map((d) => d.uid);
    expect([...firstTen].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('throws on unknown ids', () => {
    const data = makeGameData();
    expect(() => runCombat(data, cfg({ characterId: 'nope' }))).toThrow();
    expect(() => runCombat(data, cfg({ enemyId: 'nope' }))).toThrow();
    expect(() => runCombat(data, cfg({ deck: deckOf(['nope', 1]) }))).toThrow();
  });

  it('random pattern start is seeded and within the cycle', () => {
    const e = makeEnemy('rnd', 999, {
      a: { name: 'A', effects: [] },
      b: { name: 'B', effects: [] },
      c: { name: 'C', effects: [] },
    });
    e.pattern.start = 'random';
    const data = withEnemy(makeGameData(), e);
    const starts = new Set<string>();
    for (let s = 0; s < 50; s++) {
      const log = logged(data, passive, { enemyId: 'rnd', seed: s, deck: [] }).log;
      const first = events(log, 'enemyMove')[0]!.moveId;
      const again = events(logged(data, passive, { enemyId: 'rnd', seed: s, deck: [] }).log, 'enemyMove')[0]!.moveId;
      expect(again).toBe(first);
      starts.add(first);
    }
    expect([...starts].sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('end conditions', () => {
  it('turn cap: passive player vs. non-attacking enemy', () => {
    const data = dummyData();
    const r = logged(data, passive, { enemyId: 'dummy' });
    expect(r).toMatchObject({ outcome: 'turnCap', turns: 100, hpLost: 0 });
    expect(r.enemyHpRemaining).toBeGreaterThan(0);
    expect(events(r.log, 'discard').every((e) => e.reason === 'endOfTurn' || e.reason === 'handLimit')).toBe(true);
    expect(r.log!.at(-1)).toEqual({ t: 'combatEnd', outcome: 'turnCap', turns: 100, hpLost: 0 });
  });

  it('win ends immediately when the enemy hits 0 HP', () => {
    const data = withEnemy(makeGameData(), makeEnemy('weak', 5, { wait: { name: 'Wait', effects: [] } }));
    const r = runCombat(data, cfg({ enemyId: 'weak' }), { log: true });
    expect(r).toMatchObject({ outcome: 'win', turns: 1, hpLost: 0, enemyHpRemaining: 0 });
    // Only one card played: combat stops on the kill.
    expect(events(r.log, 'play')).toHaveLength(1);
    expect(r.log!.at(-1)!.t).toBe('combatEnd');
  });

  it('loss: hpLost is capped at max HP', () => {
    const data = makeGameData();
    data.characters.ironclad!.maxHp = 5;
    const r = logged(data, passive, { deck: [] });
    expect(r).toMatchObject({ outcome: 'loss', turns: 1, hpLost: 5 });
    expect(events(r.log, 'damage')[0]).toMatchObject({ amount: 12, hpLoss: 12 });
  });

  it('multi-hit stops once the target dies', () => {
    const data = withEnemy(
      makeGameData(),
      makeEnemy('flurry', 999, {
        f: { name: 'Flurry', effects: [{ type: 'attack', damage: 3, hits: 10 }] },
      }),
    );
    data.characters.ironclad!.maxHp = 7;
    const r = logged(data, passive, { enemyId: 'flurry', deck: [] });
    expect(events(r.log, 'damage')).toHaveLength(3);
    expect(r).toMatchObject({ outcome: 'loss', hpLost: 7 });
  });

  it('greedy Ironclad starter beats A0 Nibbit; hpLost matches logged damage', () => {
    const data = makeGameData();
    for (let s = 0; s < 20; s++) {
      const r = runCombat(data, cfg({ seed: s }), { log: true });
      expect(r.outcome).toBe('win');
      const taken = events(r.log, 'damage')
        .filter((d) => d.target === 'player')
        .reduce((a, d) => a + d.hpLoss, 0);
      expect(r.hpLost).toBe(taken);
      expect(r.turns).toBe(events(r.log, 'turnStart').filter((t) => t.side === 'player').length);
    }
  });

  it('runCombat with and without a log gives the same result', () => {
    const data = makeGameData();
    for (let s = 0; s < 20; s++) {
      const config = cfg({ seed: s, ascension: 10, strategy: blockFirstConfig(2) });
      const { log: _log, ...withLog } = runCombat(data, config, { log: true });
      expect(runCombat(data, config)).toEqual(withLog);
    }
  });
});
