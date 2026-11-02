/** Energy gain (#22) and X-cost cards (#23) in combat. */
import { describe, expect, it } from 'vitest';
import { makeCardInstance, runCombat, simulateCombat } from './combat';
import { attackHits, isPlayable } from './rules';
import { cards, makeEnemy, makeGameData } from './testFixtures';
import { deckOf, events, scripted } from './combatTestHelpers';
import type { CardDef, CombatConfig, GameData, Strategy } from './types';
import { GREEDY_CONFIG, blockFirstConfig } from './strategies';

function cfg(overrides: Partial<CombatConfig> = {}): CombatConfig {
  return {
    characterId: 'ironclad',
    deck: [],
    enemyId: 'dummy',
    ascension: 0,
    strategy: GREEDY_CONFIG,
    seed: 1,
    ...overrides,
  };
}

const fuel: CardDef = {
  ...cards.defend!,
  id: 'fuel',
  code: 'Fu',
  cost: 0,
  keywords: ['exhaust'],
  effects: [{ type: 'gainEnergy', amount: 1 }],
  upgraded: { effects: [{ type: 'gainEnergy', amount: 2 }] },
};
const ritual: CardDef = {
  ...cards.defend!,
  id: 'ritual',
  code: 'FR',
  cost: 1,
  keywords: ['exhaust'],
  effects: [{ type: 'gainEnergy', amount: 3 }],
  upgraded: null,
};
const whirlwind: CardDef = {
  ...cards.strike!,
  id: 'whirlwind',
  code: 'Wh',
  cost: 0,
  xCost: true,
  effects: [{ type: 'attack', damage: 5, hits: 1, allEnemies: true, xTimes: true }],
  upgraded: { effects: [{ type: 'attack', damage: 8, hits: 1, allEnemies: true, xTimes: true }] },
};
/** Test-only "X+1 times" card (e.g. a Multi-Cast-style upgrade). */
const flurry: CardDef = {
  ...cards.strike!,
  id: 'flurry',
  code: 'Fl',
  cost: 0,
  xCost: true,
  effects: [{ type: 'attack', damage: 3, hits: 1, xTimes: true }],
  upgraded: { effects: [{ type: 'attack', damage: 3, hits: 1, xTimes: true, xBonus: 1 }] },
};

function data(): GameData {
  const d = makeGameData();
  d.enemies.dummy = makeEnemy('dummy', 999, { wait: { name: 'Wait', effects: [] } });
  Object.assign(d.cards, { fuel, ritual, whirlwind, flurry });
  return d;
}

describe('energy gain (#22)', () => {
  it('gained energy is spendable the same turn and logged', () => {
    const d = data();
    d.characters.ironclad!.drawPerTurn = 5;
    // Ritual (1) → +3: 3 - 1 + 3 = 5 energy → five Strikes' worth; we have 4 Strikes.
    const strat = scripted((t) => (t === 1 ? ['ritual', 'strike', 'strike', 'strike', 'strike'] : []));
    const r = simulateCombat(d, cfg({ deck: deckOf(['ritual', 1], ['strike', 4]) }), strat, { log: true });
    expect(events(r.log, 'energy')[0]).toEqual({ t: 'energy', amount: 3, total: 5 });
    expect(events(r.log, 'play').map((p) => p.energyLeft)).toEqual([2, 4, 3, 2, 1]);
    expect(r.enemyHpRemaining).toBe(999 - 24);
  });

  it('no carry-over: energy refills to energyPerTurn next turn', () => {
    const d = data();
    const energyAtStart: number[] = [];
    const strat: Strategy = {
      decide(v) {
        if (energyAtStart.length < v.state.turn) energyAtStart.push(v.state.player.energy);
        const c = v.playable.find((p) => p.cardId === 'fuel');
        return c ? { kind: 'play', uid: c.uid } : { kind: 'endTurn' };
      },
    };
    simulateCombat(d, cfg({ deck: deckOf(['fuel', 5, true], ['defend', 5]) }), strat);
    expect(energyAtStart.slice(0, 3)).toEqual([3, 3, 3]);
  });

  it('upgraded Fuel gains 2', () => {
    const d = data();
    const r = simulateCombat(
      d,
      cfg({ deck: deckOf(['fuel', 1, true]) }),
      scripted((t) => (t === 1 ? ['fuel'] : [])),
      { log: true },
    );
    expect(events(r.log, 'energy')).toEqual([{ t: 'energy', amount: 2, total: 5 }]);
  });

  it('an enemy move that gains energy is rejected', () => {
    const d = data();
    d.enemies.odd = makeEnemy('odd', 10, { charge: { name: 'Charge', effects: [{ type: 'gainEnergy', amount: 1 }] } });
    expect(() =>
      simulateCombat(
        d,
        cfg({ enemyId: 'odd' }),
        scripted(() => []),
      ),
    ).toThrow(/energy/);
  });
});

describe('X-cost (#23)', () => {
  it('makeCardInstance marks X-cost cards with cost 0 and xCost; others carry no xCost field', () => {
    const w = makeCardInstance(whirlwind, false, 0);
    expect(w).toMatchObject({ cost: 0, xCost: true });
    expect('xCost' in makeCardInstance(cards.strike!, false, 1)).toBe(false);
    expect(isPlayable(w, 0)).toBe(true);
  });

  it('attackHits: hits × (X + xBonus), non-X attacks unchanged', () => {
    expect(attackHits({ hits: 1, xTimes: true }, 3)).toBe(3);
    expect(attackHits({ hits: 2, xTimes: true }, 3)).toBe(6);
    expect(attackHits({ hits: 1, xTimes: true, xBonus: 1 }, 3)).toBe(4);
    expect(attackHits({ hits: 1, xTimes: true }, 0)).toBe(0);
    expect(attackHits({ hits: 2 }, 5)).toBe(2);
  });

  it('Whirlwind spends all energy and hits X times (ALL enemies counts once)', () => {
    const d = data();
    const r = simulateCombat(
      d,
      cfg({ deck: deckOf(['whirlwind', 1]) }),
      scripted((t) => (t === 1 ? ['whirlwind'] : [])),
      { log: true },
    );
    expect(events(r.log, 'play')[0]).toMatchObject({ cardId: 'whirlwind', energyLeft: 0, x: 3 });
    expect(events(r.log, 'damage').map((e) => e.amount)).toEqual([5, 5, 5]);
    expect(r.enemyHpRemaining).toBe(999 - 15);
  });

  it('X counts energy gained earlier in the turn; Strength applies per hit; upgraded Whirlwind deals 8', () => {
    const d = data();
    d.cards.flex = {
      ...cards.defend!,
      id: 'flex',
      code: 'Fx',
      cost: 0,
      effects: [{ type: 'gainStrength', amount: 1 }],
      upgraded: null,
    };
    const strat = scripted((t) => (t === 1 ? ['ritual', 'flex', 'whirlwind'] : []));
    const r = simulateCombat(d, cfg({ deck: deckOf(['ritual', 1], ['flex', 1], ['whirlwind', 1, true]) }), strat, {
      log: true,
    });
    expect(events(r.log, 'play').at(-1)).toMatchObject({ cardId: 'whirlwind', energyLeft: 0, x: 5 });
    expect(events(r.log, 'damage').map((e) => e.amount)).toEqual([9, 9, 9, 9, 9]);
  });

  it('X = 0 plays for no effect', () => {
    const d = data();
    const strat = scripted((t) => (t === 1 ? ['strike', 'strike', 'strike', 'whirlwind'] : []));
    const r = simulateCombat(d, cfg({ deck: deckOf(['strike', 3], ['whirlwind', 1]) }), strat, { log: true });
    expect(events(r.log, 'play').at(-1)).toMatchObject({ cardId: 'whirlwind', energyLeft: 0, x: 0 });
    expect(events(r.log, 'damage')).toHaveLength(3);
  });

  it('upgraded "X+1" adds 1 to X', () => {
    const d = data();
    const r = simulateCombat(
      d,
      cfg({ deck: deckOf(['flurry', 1, true]) }),
      scripted((t) => (t === 1 ? ['flurry'] : [])),
      { log: true },
    );
    expect(events(r.log, 'play')[0]).toMatchObject({ x: 3 });
    expect(events(r.log, 'damage')).toHaveLength(4);
  });

  it('non-X plays carry no x in the log', () => {
    const d = data();
    const r = simulateCombat(
      d,
      cfg({ deck: deckOf(['strike', 1]) }),
      scripted((t) => (t === 1 ? ['strike'] : [])),
      { log: true },
    );
    expect('x' in events(r.log, 'play')[0]!).toBe(false);
  });

  it('energy and X-cost combats are deterministic, with or without a log', () => {
    const d = data();
    d.enemies.nibbit!.hp = { min: 60, max: 60 };
    for (const strategy of [GREEDY_CONFIG, blockFirstConfig(0)]) {
      for (let s = 0; s < 10; s++) {
        const config = cfg({
          enemyId: 'nibbit',
          seed: s,
          strategy,
          deck: deckOf(['strike', 4], ['defend', 4], ['bash', 1], ['whirlwind', 1], ['fuel', 1], ['ritual', 1]),
        });
        const a = runCombat(d, config, { log: true });
        expect(runCombat(d, config, { log: true })).toEqual(a);
        const { log: _l, ...noLog } = a;
        expect(runCombat(d, config)).toEqual(noLog);
      }
    }
  });
});
