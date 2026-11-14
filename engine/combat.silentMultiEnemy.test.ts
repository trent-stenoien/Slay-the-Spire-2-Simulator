/** #269 Silent multi-enemy cards: Echoing Slash, Piercing Wail (ALL), Bouncing Flask; Haze, Mirage and Serpent Form on several enemies. */
import { describe, expect, it } from 'vitest';
import { simulateCombat } from './combat';
import { cfg, deckOf, events, scripted, withEnemy } from './combatTestHelpers';
import { cards, makeEnemy, makeGameData } from './testFixtures';
import { gameData } from '../data';
import type { CardDef, GameData } from './types';

const real = (id: string, simulated = true): CardDef => ({
  ...structuredClone(gameData.cards[id]!),
  keywords: [...(gameData.cards[id]!.keywords ?? []), 'innate'],
  cost: 0,
  upgraded: null,
  simulated,
  ...(id === 'x' ? cards.strike : {}),
});
const idle = (id: string, hp: number) => makeEnemy(id, hp, { wait: { name: 'Wait', effects: [] } });

function world(...enemies: ReturnType<typeof makeEnemy>[]): GameData {
  const data = withEnemy(makeGameData(), ...enemies);
  for (const id of ['echoing_slash', 'piercing_wail', 'bouncing_flask', 'haze', 'mirage', 'serpent_form'])
    data.cards[id] = real(id);
  return data;
}
const run = (data: GameData, ids: string[], deck: [string, number][], seed = 1) =>
  simulateCombat(
    data,
    cfg({ enemyIds: ids, deck: deckOf(...deck), seed }),
    scripted((t) => (t === 1 ? deck.map(([c]) => c) : [])),
    {
      log: true,
    },
  );
const hits = (r: ReturnType<typeof run>) => events(r.log, 'damage').filter((e) => e.target === 'enemy');

describe('#269 card data', () => {
  it('is simulated and uses the new fields', () => {
    const es = gameData.cards.echoing_slash!;
    expect(es.simulated).toBe(true);
    expect(es.effects[0]).toMatchObject({ allEnemies: true, repeatPerKill: true });
    expect(es.upgraded!.effects![0]).toMatchObject({ damage: 13, repeatPerKill: true });
    expect(gameData.cards.bouncing_flask!.effects).toEqual([
      { type: 'applyPoison', amount: 3, randomTarget: true, hits: 3 },
    ]);
    expect(gameData.cards.bouncing_flask!.upgraded!.effects).toEqual([
      { type: 'applyPoison', amount: 3, randomTarget: true, hits: 4 },
    ]);
    for (const e of [gameData.cards.piercing_wail!.effects[0], gameData.cards.piercing_wail!.upgraded!.effects![0]])
      expect(e).toMatchObject({ allEnemies: true });
  });
});

describe('#269 Echoing Slash', () => {
  it('repeats once per enemy killed', () => {
    // 10 to all: a (5 HP) and b (8 HP) die in the first pass; two repeats hit only c (40 HP).
    const r = run(
      world(idle('a', 5), idle('b', 8), idle('c', 40)),
      ['a', 'b', 'c'],
      [
        ['echoing_slash', 1],
        ['defend', 5],
      ],
    );
    const c = hits(r).length;
    // first pass: 3 hits; each repeat pass: 1 hit (only c alive) x 2 repeats.
    expect(c).toBe(5);
  });

  it('kills by a repeat chain into further repeats', () => {
    // First pass kills a (5); repeat 1 kills b (15 -> 10, 10 -> dead needs 2 passes)...
    // a 5, b 20: pass 1 hits both (a dies, b 10 left); repeat 1 kills nothing... b at 10 dies in repeat 1 (kill) -> repeat 2 on c.
    const r = run(
      world(idle('a', 5), idle('b', 20), idle('c', 100)),
      ['a', 'b', 'c'],
      [
        ['echoing_slash', 1],
        ['defend', 5],
      ],
    );
    // pass1: a,b,c (3 hits); repeat1 (from a's kill): b,c; b dies -> repeat2: c; repeat 3 not owed (b's kill gave one: total owed 2)
    expect(hits(r)).toHaveLength(3 + 2 + 1);
  });

  it('does not repeat without a kill, and a one-enemy kill ends the combat', () => {
    const none = run(
      world(idle('a', 50), idle('b', 50)),
      ['a', 'b'],
      [
        ['echoing_slash', 1],
        ['defend', 5],
      ],
    );
    expect(hits(none)).toHaveLength(2);
    const one = run(
      world(idle('a', 5)),
      ['a'],
      [
        ['echoing_slash', 1],
        ['defend', 5],
      ],
    );
    expect(hits(one)).toHaveLength(1);
    expect(events(one.log, 'combatEnd')[0]!.outcome).toBe('win');
  });
});

describe('#269 Piercing Wail', () => {
  it('lowers Strength this turn on every living enemy', () => {
    const seen: number[] = [];
    const spy = scripted((t) => (t === 1 ? ['piercing_wail'] : []));
    simulateCombat(
      world(idle('a', 50), idle('b', 50)),
      cfg({ enemyIds: ['a', 'b'], deck: deckOf(['piercing_wail', 1], ['defend', 5]) }),
      {
        decide(view) {
          if (view.state.turn === 1 && view.state.enemies)
            seen.splice(0, 9, ...view.state.enemies.map((e) => e.powers?.strengthLossThisTurn ?? 0));
          return spy.decide(view);
        },
      },
      { log: true },
    );
    expect(seen).toEqual([6, 6]);
  });

  it('Artifact negates it per enemy', () => {
    const a = makeEnemy('a', 50, { wait: { name: 'Wait', effects: [] } });
    const data = world(a, idle('b', 50));
    data.enemies.a!.startPowers = { artifact: 1 };
    const r = run(
      data,
      ['a', 'b'],
      [
        ['piercing_wail', 1],
        ['defend', 5],
      ],
    );
    expect(events(r.log, 'negated')).toHaveLength(1);
  });
});

describe('#269 Bouncing Flask', () => {
  it('applies Poison three times, each to a random living enemy, and re-rolls per application', () => {
    const totals = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) {
      const r = run(
        world(idle('a', 99), idle('b', 99)),
        ['a', 'b'],
        [
          ['bouncing_flask', 1],
          ['defend', 5],
        ],
        seed,
      );
      const p = events(r.log, 'poison');
      expect(p).toHaveLength(3);
      expect(p.every((e) => e.amount === 3)).toBe(true);
      totals.add(p.map((e) => e.total).join(','));
    }
    expect(totals.size).toBeGreaterThan(1);
  });

  it('is deterministic for a seed and draws no Rng against one enemy', () => {
    const go = () =>
      run(
        world(idle('a', 99), idle('b', 99)),
        ['a', 'b'],
        [
          ['bouncing_flask', 1],
          ['defend', 5],
        ],
        7,
      ).log;
    expect(go()).toEqual(go());
    const one = run(
      world(idle('a', 99)),
      ['a'],
      [
        ['bouncing_flask', 1],
        ['defend', 5],
      ],
    );
    expect(events(one.log, 'poison').map((e) => e.total)).toEqual([3, 6, 9]);
  });

  it('Artifact negates each application separately', () => {
    const data = world(idle('a', 99));
    data.enemies.a!.startPowers = { artifact: 2 };
    const r = run(
      data,
      ['a'],
      [
        ['bouncing_flask', 1],
        ['defend', 5],
      ],
    );
    expect(events(r.log, 'negated')).toHaveLength(2);
    expect(events(r.log, 'poison')).toHaveLength(1);
  });
});

describe('#269 existing ALL / random cards on several enemies', () => {
  it('Haze poisons every living enemy; Mirage blocks for their total Poison', () => {
    const r = run(
      world(idle('a', 99), idle('b', 99)),
      ['a', 'b'],
      [
        ['haze', 1],
        ['mirage', 1],
        ['defend', 5],
      ],
    );
    expect(events(r.log, 'poison').map((e) => e.amount)).toEqual([4, 4]);
    expect(events(r.log, 'block')[0]!.amount).toBe(8);
  });

  it('Serpent Form hits a random living enemy per later card', () => {
    const r = run(
      world(idle('a', 99), idle('b', 99)),
      ['a', 'b'],
      [
        ['serpent_form', 1],
        ['mirage', 1],
        ['haze', 1],
        ['defend', 5],
      ],
    );
    expect(hits(r).length).toBe(3); // mirage, haze, defend
  });
});
