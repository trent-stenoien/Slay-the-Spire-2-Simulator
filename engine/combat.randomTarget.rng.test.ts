/** #45 test-review round 1: the random-target pick really goes through the seeded Rng, once per hit and only while 2+ enemies live. */
import { describe, expect, it, vi } from 'vitest';
import { simulateCombat } from './combat';
import { cfg, deckOf, scripted, withEnemy } from './combatTestHelpers';
import { createStrategy, GREEDY_CONFIG } from './strategies';
import { cards, makeEnemy, makeGameData } from './testFixtures';
import type { CardDef, GameEvent } from './types';

const intCalls: [number, number][] = [];
vi.mock('./rng', async (orig) => {
  const mod = await orig<typeof import('./rng')>();
  return {
    ...mod,
    createRng: (seed: number) => {
      const r = mod.createRng(seed);
      return {
        ...r,
        int: (min: number, max: number) => {
          intCalls.push([min, max]);
          return r.int(min, max);
        },
      };
    },
  };
});

const idle = (id: string, hp: number) => makeEnemy(id, hp, { wait: { name: 'Wait', effects: [] } });
const boomer: CardDef = {
  ...cards.strike!,
  id: 'boomer',
  code: 'bo',
  name: 'boomer',
  cost: 0,
  effects: [{ type: 'attack', damage: 3, hits: 6, randomTarget: true }],
  upgraded: null,
};
const world = (hpC: number) => {
  const data = withEnemy(makeGameData(), idle('a', 500), idle('b', 500), idle('c', hpC));
  data.cards.boomer = boomer;
  return data;
};
const play = (ids: string[], deck: number, seed: number) => {
  intCalls.length = 0;
  return simulateCombat(
    world(1),
    cfg({ enemyIds: ids, deck: deckOf(['boomer', deck]), seed }),
    createStrategy(GREEDY_CONFIG),
    {
      log: true,
    },
  );
};
/** Enemy index hit by each player damage event, in order. */
const hitTargets = (log: GameEvent[] | undefined) => {
  let cur = 0;
  const out: number[] = [];
  for (const e of log ?? []) {
    if (e.t === 'target') cur = e.enemy;
    if (e.t === 'damage' && e.source === 'player') out.push(cur);
  }
  return out;
};

describe('#45 random target goes through the seeded Rng (round-1 additions)', () => {
  it('a single play of 6 hits lands on both enemies for some seed, and the hit order differs per seed', () => {
    // One Boomer in the deck: the whole first-turn damage is that one play, so the strategy cannot be the one spreading it.
    const orders = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      const targets = hitTargets(play(['a', 'b'], 1, seed).log).slice(0, 6);
      expect(targets).toHaveLength(6);
      orders.add(targets.join(''));
    }
    expect([...orders].some((o) => o.includes('0') && o.includes('1'))).toBe(true);
    expect(orders.size).toBeGreaterThan(3);
  });

  it('draws exactly one Rng int(0, living - 1) per hit while 2+ enemies live, and nothing once only one lives', () => {
    // c has 1 HP: it dies to the first hit it takes; after that only 'a' lives, so no more random-target draws.
    const r = play(['c', 'a'], 1, 5);
    const hits = hitTargets(r.log).slice(0, 6);
    const twoLiving = intCalls.filter(([lo, hi]) => lo === 0 && hi === 1);
    expect(twoLiving.length).toBeGreaterThanOrEqual(1);
    expect(twoLiving.length).toBeLessThanOrEqual(6);
    // No draw ever asks for a one-element range: a one-enemy-alive pick must not touch the Rng.
    expect(intCalls.filter(([lo, hi]) => lo === 0 && hi === 0)).toEqual([]);
    expect(hits.slice(-1)).toEqual([1]);
  });
});

describe('#45 Juggernaut picks through the seeded Rng (round-1 addition)', () => {
  const jugger: CardDef = {
    ...cards.strike!,
    id: 'jugger',
    code: 'ju',
    name: 'jugger',
    type: 'power',
    cost: 0,
    keywords: ['innate'],
    effects: [{ type: 'applyPower', power: 'juggernaut', amount: 4 }],
    upgraded: null,
  };
  const wall: CardDef = {
    ...cards.strike!,
    id: 'wall',
    code: 'wa',
    name: 'wall',
    type: 'skill',
    cost: 0,
    effects: [{ type: 'gainBlock', amount: 5 }],
    upgraded: null,
  };
  const hitsFor = (seed: number) => {
    const data = withEnemy(makeGameData(), idle('a', 500), idle('b', 500));
    data.cards.jugger = jugger;
    data.cards.wall = wall;
    const r = simulateCombat(
      data,
      cfg({ enemyIds: ['a', 'b'], deck: deckOf(['jugger', 1], ['wall', 9]), seed }),
      // The scripted strategy never picks a target, so only the engine decides who Juggernaut hits.
      scripted((t) => (t === 1 ? ['jugger', 'wall', 'wall', 'wall', 'wall'] : [])),
      { log: true },
    );
    return hitTargets(r.log);
  };

  it('each Block gain hits a random living enemy: both enemies get hit across seeds, a seed repeats', () => {
    const seen = new Set<number>();
    for (let seed = 1; seed <= 6; seed++) {
      const hits = hitsFor(seed);
      expect(hits).toHaveLength(4);
      hits.forEach((h) => seen.add(h));
      expect(hitsFor(seed)).toEqual(hits);
    }
    expect(seen.size).toBe(2);
  });
});
