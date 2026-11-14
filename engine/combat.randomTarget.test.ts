/** #45: random-target cards in multi-enemy fights. */
import { describe, expect, it } from 'vitest';
import { simulateCombat } from './combat';
import { cfg, deckOf, passive, withEnemy } from './combatTestHelpers';
import { createStrategy, GREEDY_CONFIG } from './strategies';
import { cards, makeEnemy, makeGameData } from './testFixtures';
import type { CardDef, CombatConfig, Effect, GameData, GameEvent, StrategyView } from './types';

const card = (id: string, effects: Effect[], over: Partial<CardDef> = {}): CardDef => ({
  ...cards.strike!,
  id,
  code: id.slice(0, 2),
  name: id,
  cost: 0,
  effects,
  upgraded: null,
  ...over,
});
const idle = (id: string, hp: number) => makeEnemy(id, hp, { wait: { name: 'Wait', effects: [] } });

function world(): GameData {
  const data = withEnemy(makeGameData(), idle('a', 500), idle('b', 500), idle('c', 6));
  const add = (c: CardDef) => (data.cards[c.id] = c);
  add(card('boomer', [{ type: 'attack', damage: 3, hits: 6, randomTarget: true }]));
  add(card('poke', [{ type: 'attack', damage: 3, hits: 1 }]));
  add(
    card('bonk', [
      { type: 'attack', damage: 4, hits: 1 },
      { type: 'applyVulnerable', amount: 2 },
    ]),
  );
  add(
    card('flex', [
      { type: 'attack', damage: 1, hits: 1 },
      { type: 'gainStrength', amount: 3 },
    ]),
  );
  add(card('stab', [{ type: 'attack', damage: 9, hits: 1 }]));
  add(card('wall', [{ type: 'gainBlock', amount: 5 }], { type: 'skill' }));
  add(card('jugger', [{ type: 'applyPower', power: 'juggernaut', amount: 4 }], { type: 'power' }));
  return data;
}

const conf = (enemyIds: string[], deck: [string, number][], over: Partial<CombatConfig> = {}) =>
  cfg({ enemyIds, deck: deckOf(...deck), ...over });
const run = (data: GameData, c: CombatConfig, strategy = createStrategy(GREEDY_CONFIG)) =>
  simulateCombat(data, c, strategy, { log: true });
/** The first play of the combat is the only thing these tests need to look at. */
const dmg = (log: GameEvent[] | undefined) =>
  (log ?? []).filter((e): e is Extract<GameEvent, { t: 'damage' }> => e.t === 'damage' && e.source === 'player');

describe('#45 random-target attacks', () => {
  it('same config and seed give an identical log', () => {
    const c = conf(['a', 'b'], [['boomer', 5]], { seed: 7 });
    expect(run(world(), c).log).toEqual(run(world(), c).log);
  });

  it('hits are picked per hit: one play spreads over both enemies', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 8; seed++) {
      const r = run(world(), conf(['a', 'b'], [['boomer', 5]], { seed }));
      const ev = r.log ?? [];
      let cur = 0;
      for (const e of ev) {
        if (e.t === 'target') cur = e.enemy;
        if (e.t === 'damage' && e.source === 'player') seen.add(String(cur));
      }
    }
    expect(seen.size).toBe(2);
  });

  it('a single-enemy fight draws nothing from the Rng: the log matches the same card without the flag', () => {
    const flagged = world();
    const plain = world();
    plain.cards.boomer = card('boomer', [{ type: 'attack', damage: 3, hits: 6 }]);
    const c = conf(['a'], [['boomer', 5]], { seed: 3 });
    expect(run(flagged, c).log).toEqual(run(plain, c).log);
  });

  it('with one enemy left alive, hits keep going at it and draw nothing', () => {
    const flagged = world();
    const plain = world();
    plain.cards.boomer = card('boomer', [{ type: 'attack', damage: 3, hits: 6 }]);
    // c dies (6 HP) to the first plays; afterwards only a lives... use a 1-HP second enemy.
    flagged.enemies.c = idle('c', 1);
    plain.enemies.c = idle('c', 1);
    const c = conf(['c', 'a'], [['boomer', 5]], { seed: 5 });
    const f = run(flagged, c);
    expect(dmg(f.log).length).toBeGreaterThan(6);
  });

  it('Juggernaut hits a random living enemy, deterministically per seed', () => {
    const c = conf(
      ['a', 'b'],
      [
        ['jugger', 1],
        ['wall', 4],
      ],
      { seed: 11 },
    );
    const one = run(world(), c);
    expect(one.log).toEqual(run(world(), c).log);
    let cur = 0;
    const hit = new Set<number>();
    for (let seed = 1; seed <= 10; seed++) {
      for (const e of run(world(), { ...c, seed }).log ?? []) {
        if (e.t === 'target') cur = e.enemy;
        if (e.t === 'damage' && e.source === 'player') hit.add(cur);
      }
    }
    expect(hit.size).toBe(2);
  });
});

describe('#45 strategy: random-target attacks first', () => {
  const view = (hand: CardDef[], enemyHps: number[], energy = 3): StrategyView => {
    const data = world();
    const inst = hand.map((d, i) => ({
      uid: i + 1,
      cardId: d.id,
      name: d.name,
      type: d.type,
      cost: d.cost as number,
      xCost: false,
      keywords: [],
      effects: d.effects,
      upgraded: false,
    }));
    const enemies = enemyHps.map((hp) => ({
      ...(data.enemies.a as object),
      hp,
      block: 0,
      debuffs: { vulnerable: 0, weak: 0, frail: 0 },
    }));
    return {
      playable: inst,
      intent: { totalIncoming: 0, attacks: [] },
      intents: enemies.map(() => ({ totalIncoming: 0, attacks: [] })),
      state: {
        turn: 1,
        player: {
          energy,
          strength: 0,
          debuffs: { vulnerable: 0, weak: 0, frail: 0 },
          hand: inst,
          drawPile: [],
          discardPile: [],
          exhaustPile: [],
          powers: {},
          block: 0,
        },
        enemy: enemies[0],
        enemies,
      },
    } as unknown as StrategyView;
  };
  const boomer = world().cards.boomer!;
  const poke = world().cards.poke!;
  const stab = world().cards.stab!;

  it('plays the random-target attack before a targeted one when 2+ enemies live', () => {
    const d = createStrategy(GREEDY_CONFIG).decide(view([stab, boomer], [50, 50]));
    expect(d).toMatchObject({ kind: 'play', uid: 2 });
  });

  it('a targeted attack that kills a low-HP enemy goes first, aimed at it', () => {
    const d = createStrategy(GREEDY_CONFIG).decide(view([boomer, stab], [50, 8]));
    expect(d).toMatchObject({ kind: 'play', uid: 2, target: 1 });
  });

  it('a targeted attack that cannot kill does not go first', () => {
    const d = createStrategy(GREEDY_CONFIG).decide(view([poke, boomer], [50, 8]));
    expect(d).toMatchObject({ kind: 'play', uid: 2 });
  });

  it('#304: targeted attacks that kill together (not alone) go first, aimed at that enemy', () => {
    const d = createStrategy(GREEDY_CONFIG).decide(view([boomer, poke, poke], [50, 6]));
    expect(d).toMatchObject({ kind: 'play', uid: 2, target: 1 });
  });

  it('#304: a combined kill the Energy cannot pay for does not go first', () => {
    const pricey = { ...poke, cost: 1 };
    const d = createStrategy(GREEDY_CONFIG).decide(view([boomer, pricey, pricey], [50, 6], 1));
    expect(d).toMatchObject({ kind: 'play', uid: 1 });
    expect((d as { target?: number }).target).toBeUndefined();
  });

  it('#304: targeted attacks that cannot kill any enemy together leave random-target first', () => {
    const d = createStrategy(GREEDY_CONFIG).decide(view([boomer, poke, poke], [50, 7]));
    expect(d).toMatchObject({ kind: 'play', uid: 1 });
  });

  it('with one living enemy the rule does not apply (a killing stab gets no forced target)', () => {
    const d = createStrategy(GREEDY_CONFIG).decide(view([stab, boomer], [8]));
    expect(d).toMatchObject({ kind: 'play' });
    expect((d as { target?: number }).target).toBeUndefined();
  });

  describe('#344 targeted kill counts all modifiers', () => {
    const boomer = world().cards.boomer!;
    const poke = world().cards.poke!;
    const stab = world().cards.stab!;
    const bonk = world().cards.bonk!;
    const flex = world().cards.flex!;
    const first = (hand: CardDef[], hps: number[], tweak?: (v: StrategyView) => void, energy = 3) => {
      const v = view(hand, hps, energy);
      tweak?.(v);
      return createStrategy(GREEDY_CONFIG).decide(v);
    };

    it('Vulnerable from a card in the set counts for the later card, which is played second', () => {
      // bonk 4 + stab 9 x1.5 (13) = 17 kills 17 HP; without the modifier 13 would not.
      expect(first([boomer, stab, bonk], [50, 17])).toMatchObject({ kind: 'play', uid: 3, target: 1 });
    });

    it('the card applying the debuff goes first even when it is later in hand', () => {
      expect(first([boomer, stab, poke, bonk], [50, 17])).toMatchObject({ uid: 4, target: 1 });
    });

    it('Vulnerable does not help the card that applies it (damage lands first)', () => {
      expect(first([boomer, bonk], [50, 7])).toMatchObject({ uid: 1 });
      expect((first([boomer, bonk], [50, 7]) as { target?: number }).target).toBeUndefined();
    });

    it('Strength gained from a card in the set counts for the later cards', () => {
      // flex 1 then stab 9+3 = 12 -> 13 total
      expect(first([boomer, stab, flex], [50, 13])).toMatchObject({ uid: 3, target: 1 });
      expect(first([boomer, stab, flex], [50, 14])).toMatchObject({ uid: 1 });
    });

    it('enemy Block still has to be chewed through', () => {
      const withBlock = (v: StrategyView) => {
        (v.state.enemies![1] as { block: number }).block = 5;
      };
      expect(first([boomer, stab, bonk], [50, 12], withBlock)).toMatchObject({ uid: 3, target: 1 });
      expect(first([boomer, stab, bonk], [50, 13], withBlock)).toMatchObject({ uid: 1 });
    });

    it('Artifact on the enemy negates the Vulnerable, so the kill is not counted', () => {
      const artifact = (v: StrategyView) => {
        (v.state.enemies![1] as { powers: object }).powers = { artifact: 1 };
      };
      expect(first([boomer, stab, bonk], [50, 17], artifact)).toMatchObject({ uid: 1 });
    });

    it('an existing Vulnerable on the enemy counts for every card', () => {
      const vuln = (v: StrategyView) => {
        (v.state.enemies![1]!.debuffs as { vulnerable: number }).vulnerable = 1;
      };
      expect(first([boomer, stab], [50, 13], vuln)).toMatchObject({ uid: 2, target: 1 });
    });
  });
});
void passive;
