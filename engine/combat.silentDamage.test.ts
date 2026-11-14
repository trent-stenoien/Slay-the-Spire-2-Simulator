/** #260 Silent damage, Block and debuff cards: the real card data run through the engine. */
import { describe, expect, it } from 'vitest';
import { gameData } from '../data/index';
import { simulateCombat } from './combat';
import { cards, makeEnemy, makeGameData } from './testFixtures';
import { cfg, deckOf, dummy, events, withEnemy } from './combatTestHelpers';
import { createStrategy, GREEDY_CONFIG } from './strategies';
import type { CardDef, Decision, EnemyDef, GameData, Strategy, StrategyView } from './types';

const real = (id: string): CardDef => structuredClone(gameData.cards[id]!);
const innate = (c: CardDef): CardDef => ({ ...c, keywords: [...c.keywords, 'innate', 'retain'] });
/** A free helper card; innate so it is always in the opening hand. */
const helper = (id: string, effects: CardDef['effects']): CardDef => ({
  ...cards.defend!,
  id,
  code: id.slice(0, 2).padEnd(2, 'x'),
  name: id,
  cost: 0,
  keywords: ['innate'],
  effects,
  upgraded: null,
});

function world(ids: string[], enemy: EnemyDef = dummy(), extra: Record<string, CardDef> = {}): GameData {
  const d = withEnemy(makeGameData(), enemy);
  for (const id of ids) d.cards[id] = innate(real(id));
  Object.assign(d.cards, extra);
  return d;
}

interface Seen {
  energy: number;
  hand: number;
  enemy: StrategyView['state']['enemy'];
}

/** Plays the listed cardIds in order on turn `turn`; records the state when the turn ends. */
function play(order: string[], turn = 1, observe = turn) {
  const queue = [...order];
  const seen: Seen[] = [];
  const strategy: Strategy = {
    decide(view: StrategyView): Decision {
      if (view.state.turn !== turn && view.state.turn !== observe) return { kind: 'endTurn' };
      const want = view.state.turn === turn ? queue.shift() : undefined;
      if (want === undefined) {
        if (view.state.turn !== observe) return { kind: 'endTurn' };
        seen.push({
          energy: view.state.player.energy,
          hand: view.state.player.hand.length,
          enemy: structuredClone(view.state.enemy),
        });
        return { kind: 'endTurn' };
      }
      const c = view.playable.find((p) => p.cardId === want);
      if (!c) throw new Error(`${want} not playable; playable: ${view.playable.map((p) => p.cardId).join(',')}`);
      return { kind: 'play', uid: c.uid };
    },
  };
  return { strategy, seen };
}

function run(d: GameData, order: string[], deck: ReturnType<typeof deckOf>, turn = 1, overrides = {}, observe = turn) {
  const { strategy, seen } = play(order, turn, observe);
  const r = simulateCombat(d, cfg({ enemyId: 'dummy', deck, ...overrides }), strategy, { log: true });
  return { r, seen: seen[0]! };
}

const hits = (r: ReturnType<typeof run>['r']) => events(r.log, 'damage').filter((e) => e.source === 'player');
const withArtifact = (n: number): EnemyDef => ({ ...dummy(), startPowers: { artifact: n } });

describe('#260 Skewer (X-cost)', () => {
  it('hits X times for 8 (11 upgraded), spending all the Energy', () => {
    for (const [up, dmg] of [
      [false, 8],
      [true, 11],
    ] as const) {
      const { r, seen } = run(world(['skewer']), ['skewer'], deckOf(['skewer', 1, up], ['defend', 9]));
      expect(hits(r).map((h) => h.amount)).toEqual([dmg, dmg, dmg]);
      expect(seen.energy).toBe(0);
    }
  });

  it('with two X-cost cards in hand the strategy plays only one: the other has no Energy left', () => {
    const r = simulateCombat(
      world(['skewer']),
      cfg({ enemyId: 'dummy', deck: deckOf(['skewer', 2], ['defend', 8]) }),
      createStrategy(GREEDY_CONFIG),
      { log: true },
    );
    const firstTurn = r.log!.slice(
      0,
      r.log!.findIndex((e) => e.t === 'turnEnd'),
    );
    expect(events(firstTurn, 'play').filter((e) => e.cardId === 'skewer')).toHaveLength(1);
  });

  it('a card that generates Energy lets the second X-cost card play with that Energy', () => {
    const d = world(['skewer'], dummy(), { surge: helper('surge', [{ type: 'gainEnergy', amount: 2 }]) });
    const { r } = run(d, ['skewer', 'surge', 'skewer'], deckOf(['skewer', 2], ['surge', 1], ['defend', 7]));
    expect(hits(r).map((h) => h.amount)).toEqual([8, 8, 8, 8, 8]);
  });
});

describe('#260 Grand Finale', () => {
  it('is not playable while the draw pile has cards, and deals 60 (75 upgraded) once it is empty', () => {
    expect(() => run(world(['grand_finale']), ['grand_finale'], deckOf(['grand_finale', 1], ['defend', 9]))).toThrow(
      /not playable/,
    );
    for (const [up, dmg] of [
      [false, 60],
      [true, 75],
    ] as const) {
      const { r } = run(world(['grand_finale']), ['grand_finale'], deckOf(['grand_finale', 1, up], ['defend', 4]));
      expect(hits(r)[0]!.amount).toBe(dmg);
    }
  });
});

describe('#260 Strangle', () => {
  it('the enemy loses 2 HP (3 upgraded) for each card played after it, not for Strangle itself', () => {
    for (const [up, loss] of [
      [false, 2],
      [true, 3],
    ] as const) {
      const { r } = run(
        world(['strangle']),
        ['strangle', 'defend', 'defend'],
        deckOf(['strangle', 1, up], ['defend', 9]),
      );
      const lost = events(r.log, 'loseHp').filter((e) => e.side === 'enemy');
      expect(lost.map((e) => e.amount)).toEqual([loss, loss]);
    }
  });

  it('wears off at the end of the turn', () => {
    const { r } = run(world(['strangle']), ['strangle'], deckOf(['strangle', 1], ['defend', 9]));
    expect(events(r.log, 'loseHp').filter((e) => e.side === 'enemy' && e.amount > 0)).toHaveLength(0);
  });
});

describe('#260 Bullet Time', () => {
  it('makes the cards in hand free, and nothing is drawn for the rest of the turn', () => {
    const d = world(['bullet_time']);
    const { r, seen } = run(
      d,
      ['bullet_time', 'defend', 'defend', 'defend', 'defend'],
      deckOf(['bullet_time', 1], ['defend', 9]),
    );
    // 3 Energy paid for Bullet Time; four Defends cost nothing.
    expect(seen.energy).toBe(0);
    expect(events(r.log, 'block').filter((b) => b.side === 'player')).toHaveLength(4);
    expect(events(r.log, 'draw').filter((e) => e.t === 'draw').length).toBe(events(r.log, 'draw').length);
  });

  it('cards drawn after it are not free, and drawing is blocked', () => {
    const d = world(['bullet_time'], dummy(), { drawer: helper('drawer', [{ type: 'draw', amount: 2 }]) });
    const { seen } = run(d, ['bullet_time', 'drawer'], deckOf(['bullet_time', 1], ['drawer', 1], ['defend', 8]));
    // Drawer played free; its draw is blocked, so the hand only shrinks.
    expect(seen.hand).toBe(5 - 2);
  });

  it('upgraded costs 2', () => {
    const d = world(['bullet_time']);
    const { seen } = run(d, ['bullet_time'], deckOf(['bullet_time', 1, true], ['defend', 9]));
    expect(seen.energy).toBe(1);
  });
});

describe('#260 Footwork', () => {
  it('gives 2 Dexterity (3 upgraded): Defend gains that much Block', () => {
    for (const [up, dex] of [
      [false, 2],
      [true, 3],
    ] as const) {
      const { r } = run(world(['footwork']), ['footwork', 'defend'], deckOf(['footwork', 1, up], ['defend', 9]));
      expect(events(r.log, 'block').find((b) => b.side === 'player')!.amount).toBe(5 + dex);
    }
  });
});

describe('#260 Bubble Bubble', () => {
  const venom = helper('venom', [{ type: 'applyPoison', amount: 4 }]);

  it('does nothing to an enemy without Poison', () => {
    const { seen } = run(world(['bubble_bubble']), ['bubble_bubble'], deckOf(['bubble_bubble', 1], ['defend', 9]));
    expect(seen.enemy.poison).toBe(0);
  });

  it('applies 9 Poison (12 upgraded) to a Poisoned enemy', () => {
    for (const [up, add] of [
      [false, 9],
      [true, 12],
    ] as const) {
      const { seen } = run(
        world(['bubble_bubble'], dummy(), { venom }),
        ['venom', 'bubble_bubble'],
        deckOf(['bubble_bubble', 1, up], ['venom', 1], ['defend', 8]),
      );
      expect(seen.enemy.poison).toBe(4 + add);
    }
  });
});

describe('#260 Precise Cut', () => {
  const dmg = (hand: number, up = false, extra: Record<string, CardDef> = {}, order = ['precise_cut']) => {
    const { r } = run(world(['precise_cut'], dummy(), extra), order, deckOf(['precise_cut', 1, up], ['defend', hand]));
    return hits(r)[0]!.amount;
  };

  it('deals 13 (16 upgraded) minus 2 per other card in hand', () => {
    // Opening hand is 5 cards: Precise Cut + 4 others.
    expect(dmg(9)).toBe(13 - 2 * 4);
    expect(dmg(9, true)).toBe(16 - 2 * 4);
  });

  it('floors at 0 with a big hand (never heals or goes negative)', () => {
    const d = world(['precise_cut']);
    d.characters.ironclad!.drawPerTurn = 10;
    const { r } = run(d, ['precise_cut'], deckOf(['precise_cut', 1], ['defend', 12]));
    expect(hits(r)[0]!.amount).toBe(0);
  });

  it('floors the card at 0 before Strength is added', () => {
    const d = world(['precise_cut'], dummy(), { flex: helper('flex', [{ type: 'gainStrength', amount: 3 }]) });
    d.characters.ironclad!.drawPerTurn = 10;
    const { r } = run(d, ['flex', 'precise_cut'], deckOf(['precise_cut', 1], ['flex', 1], ['defend', 11]));
    // 8 other cards left in hand: 13 - 16 < 0 -> 0, then +3 Strength.
    expect(hits(r)[0]!.amount).toBe(3);
  });
});

describe('#260 Expose', () => {
  const blocker = makeEnemy('dummy', 999, { guard: { name: 'Guard', effects: [{ type: 'gainBlock', amount: 12 }] } });

  it('removes the enemy Block and applies 2 Vulnerable (3 upgraded)', () => {
    for (const [up, vuln] of [
      [false, 2],
      [true, 3],
    ] as const) {
      const { seen } = run(
        world(['expose'], { ...blocker, startPowers: {} }),
        ['expose'],
        deckOf(['expose', 1, up], ['defend', 9]),
        2,
      );
      expect(seen.enemy.block).toBe(0);
      expect(seen.enemy.debuffs.vulnerable).toBe(vuln);
    }
  });

  it('removes all Artifact first, so Vulnerable lands', () => {
    const { r, seen } = run(world(['expose'], withArtifact(3)), ['expose'], deckOf(['expose', 1], ['defend', 9]));
    expect(seen.enemy.powers?.artifact ?? 0).toBe(0);
    expect(seen.enemy.debuffs.vulnerable).toBe(2);
    expect(events(r.log, 'negated')).toHaveLength(0);
  });

  it('exhausts', () => {
    const { r } = run(world(['expose']), ['expose'], deckOf(['expose', 1], ['defend', 9]));
    expect(events(r.log, 'exhaust')).toHaveLength(1);
  });
});

describe('#260 Piercing Wail', () => {
  it('the enemy loses 6 Strength (8 upgraded) this turn only', () => {
    for (const [up, loss] of [
      [false, 6],
      [true, 8],
    ] as const) {
      const { seen } = run(
        world(['piercing_wail']),
        ['piercing_wail'],
        deckOf(['piercing_wail', 1, up], ['defend', 9]),
      );
      expect(seen.enemy.powers?.strengthLossThisTurn).toBe(loss);
      const after = run(
        world(['piercing_wail']),
        ['piercing_wail'],
        deckOf(['piercing_wail', 1, up], ['defend', 9]),
        1,
        {},
        2,
      );
      expect(after.seen.enemy.powers?.strengthLossThisTurn ?? 0).toBe(0);
    }
  });
});

describe('#260 Malaise (X-cost)', () => {
  it('takes X Strength for good and applies X Weak', () => {
    const { seen } = run(world(['malaise']), ['malaise'], deckOf(['malaise', 1], ['defend', 9]));
    expect(seen.energy).toBe(0);
    expect(seen.enemy.strength).toBe(-3);
    expect(seen.enemy.debuffs.weak).toBe(3);
  });

  it('upgraded is X+1, even for X = 0', () => {
    const { seen } = run(world(['malaise']), ['malaise'], deckOf(['malaise', 1, true], ['defend', 9]));
    expect(seen.enemy.strength).toBe(-4);
    expect(seen.enemy.debuffs.weak).toBe(4);
  });

  it('Strength loss lasts into the next turns', () => {
    const { seen } = run(world(['malaise']), ['malaise'], deckOf(['malaise', 1], ['defend', 9]));
    const later = run(world(['malaise']), [], deckOf(['malaise', 1], ['defend', 9]), 3);
    expect(seen.enemy.strength).toBe(-3);
    expect(later.seen.enemy.strength).toBe(0);
  });

  it('Artifact negates the Strength loss and the Weak separately', () => {
    const { r, seen } = run(world(['malaise'], withArtifact(1)), ['malaise'], deckOf(['malaise', 1], ['defend', 9]));
    expect(events(r.log, 'negated')).toHaveLength(1);
    expect(seen.enemy.strength).toBe(0);
    expect(seen.enemy.debuffs.weak).toBe(3);
    const two = run(world(['malaise'], withArtifact(2)), ['malaise'], deckOf(['malaise', 1], ['defend', 9]));
    expect(two.seen.enemy.strength).toBe(0);
    expect(two.seen.enemy.debuffs.weak).toBe(0);
  });

  it('with no Energy left X is 0: nothing happens (upgraded still X+1)', () => {
    const burn = { burn: helper('burn', [{ type: 'loseEnergy', amount: 3 }]) };
    for (const [up, n] of [
      [false, 0],
      [true, 1],
    ] as const) {
      const { seen } = run(
        world(['malaise'], dummy(), burn),
        ['burn', 'malaise'],
        deckOf(['malaise', 1, up], ['burn', 1], ['defend', 8]),
      );
      expect(seen.enemy.strength).toBe(n === 0 ? 0 : -n);
      expect(seen.enemy.debuffs.weak).toBe(n);
    }
  });
});
