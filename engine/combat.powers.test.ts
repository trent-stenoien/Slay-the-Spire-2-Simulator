/** #109 Powers: played Powers leave the deck, the turn-start / turn-end hooks and the simple powers. */
import { describe, expect, it } from 'vitest';
import { simulateCombat, SIMULATED_POWER_IDS } from './combat';
import { cards, makeEnemy } from './testFixtures';
import { cfg, deckOf, dummyData, events, scripted, withEnemy } from './combatTestHelpers';
import type {
  CardDef,
  DeepReadonly,
  Effect,
  GameData,
  GameEvent,
  PlayerState,
  PowerId,
  Strategy,
  StrategyView,
} from './types';
import { createStrategy, GREEDY_CONFIG } from './strategies';

const power = (id: string, code: string, effects: Effect[], extra: Partial<CardDef> = {}): CardDef => ({
  ...cards.defend!,
  id,
  code,
  name: id,
  type: 'power',
  cost: 0,
  effects,
  upgraded: null,
  ...extra,
});

const apply = (p: PowerId, amount: number): Effect => ({ type: 'applyPower', power: p, amount });

/** Test cards modelled on the real ones (engine tests do not import data/); most cost 0 to keep turns simple. */
const extra: Record<string, CardDef> = {
  inflame: power('inflame', 'Il', [{ type: 'gainStrength', amount: 2 }]),
  demon: power('demon', 'DF', [apply('demonForm', 3)]),
  pyre: power('pyre', 'P2', [apply('energyPerTurn', 1)]),
  boulder: power('boulder', 'Ru', [apply('rollingBoulder', 5)]),
  mantle: power('mantle', 'C8', [apply('crimsonMantle', 7)]),
  stone: power('stone', 'A0', [apply('plating', 4)]),
  barricade: power('barricade', 'Bi', [apply('barricade', 1)]),
  cruelty: power('cruelty', 'C9', [apply('cruelty', 25)]),
  prowess: power('prowess', 'Px', [{ type: 'gainStrength', amount: 1 }, apply('dexterity', 1)]),
  fasten: power('fasten', 'Fs', [apply('fasten', 4)]),
  caltrops: power('caltrops', 'Ct', [apply('thorns', 3)]),
  prep: power('prep', 'PT', [apply('vigorPerTurn', 4)]),
  curious: power('curious', 'Ms', [apply('powersCostLess', 1)]),
  improve: power('improve', 'Me', [apply('upgradeAtCombatEnd', 1)]),
  corruption: power('corruption', 'C4', [apply('corruption', 1)]),
  /** A 2-cost Power, to see Curious lower it. */
  pricey: power('pricey', 'Pp', [{ type: 'gainStrength', amount: 1 }], { cost: 2 }),
  bash0: { ...cards.bash!, id: 'bash0', code: 'B0', cost: 0, upgraded: null },
  strike0: { ...cards.strike!, id: 'strike0', code: 'S0', cost: 0, upgraded: null },
  twin: { ...cards.strike!, id: 'twin', code: 'TS', cost: 0, effects: [{ type: 'attack', damage: 5, hits: 2 }] },
  defend0: { ...cards.defend!, id: 'defend0', code: 'D0', name: 'Defend', cost: 0, upgraded: null },
  ultdef0: { ...cards.ultimate_defend!, id: 'ultdef0', code: 'U0', cost: 0, upgraded: null },
  /** A Block skill not named Defend (Shrug It Off-like). */
  shrug: { ...cards.defend!, id: 'shrug', code: 'Sh', name: 'Shrug It Off', cost: 0, upgraded: null },
  exhaustSkill: {
    ...cards.defend!,
    id: 'exhaustSkill',
    code: 'Xs',
    name: 'Exhaust Skill',
    keywords: ['exhaust'],
    upgraded: null,
  },
  drum: {
    ...cards.defend!,
    id: 'drum',
    code: 'DO',
    name: 'Drum of Battle',
    cost: 1,
    effects: [],
    triggers: [{ when: 'exhausted', effects: [{ type: 'gainEnergy', amount: 2 }] }],
    upgraded: null,
  },
};

/** Fixture data with the test cards and a 999-HP enemy that never acts. */
function data(): GameData {
  const d = dummyData();
  Object.assign(d.cards, structuredClone(extra));
  return d;
}

/** The `dummy` enemy, these cards, and a script. */
const run = (d: GameData, deck: [string, number, boolean?][], plan: (turn: number) => string[], seed = 1) =>
  simulateCombat(d, cfg({ enemyId: 'dummy', deck: deckOf(...deck), seed }), scripted(plan), { log: true });

/** Events between the start of player turn `turn` and its end (or the end of the log). */
function playerTurn(log: GameEvent[] | undefined, turn: number): GameEvent[] {
  const l = log ?? [];
  const from = l.findIndex((e) => e.t === 'turnStart' && e.side === 'player' && e.turn === turn);
  const to = l.findIndex((e, i) => i > from && e.t === 'turnEnd' && e.side === 'player');
  return l.slice(from, to < 0 ? undefined : to + 1);
}

/** Events of the enemy turn `turn`. */
function enemyTurn(log: GameEvent[] | undefined, turn: number): GameEvent[] {
  const l = log ?? [];
  const from = l.findIndex((e) => e.t === 'turnStart' && e.side === 'enemy' && e.turn === turn);
  const to = l.findIndex((e, i) => i > from && (e.t === 'turnEnd' || e.t === 'combatEnd'));
  return l.slice(from, to + 1);
}

/** Strategy that records the state seen at each turn's first decision, then plays the plan. */
function watching(plan: (turn: number) => string[], seen: { turn: number; [k: string]: unknown }[], read: Reader) {
  const inner = scripted(plan);
  let last = 0;
  const s: Strategy = {
    decide(view) {
      if (view.state.turn !== last) {
        last = view.state.turn;
        seen.push({ turn: last, ...read(view.state.player, view) });
      }
      return inner.decide(view);
    },
  };
  return s;
}
type Reader = (p: DeepReadonly<PlayerState>, view: StrategyView) => Record<string, unknown>;

describe('#109 played Power cards', () => {
  it('leave the deck for the rest of combat: not discarded, not exhausted, never drawn again', () => {
    const r = run(
      data(),
      [
        ['inflame', 1],
        ['strike0', 4],
      ],
      (t) => (t === 1 ? ['inflame'] : []),
    );
    expect(events(r.log, 'play').map((e) => e.cardId)).toEqual(['inflame']);
    expect(events(r.log, 'exhaust')).toEqual([]);
    expect(events(r.log, 'discard').some((e) => e.cardId === 'inflame')).toBe(false);
    // Only the 4 Strikes are left to draw on later turns.
    expect(events(playerTurn(r.log, 2), 'draw').map((e) => e.cardId)).toEqual(Array(4).fill('strike0'));
    expect(events(r.log, 'draw').filter((e) => e.cardId === 'inflame')).toHaveLength(1);
  });

  it('Inflame gains Strength at once (no power)', () => {
    const r = run(
      data(),
      [
        ['inflame', 1],
        ['strike0', 1],
      ],
      (t) => (t === 1 ? ['inflame', 'strike0'] : []),
    );
    expect(events(r.log, 'strength')).toEqual([{ t: 'strength', side: 'player', amount: 2, total: 2 }]);
    expect(events(r.log, 'damage')[0]!.amount).toBe(8);
    expect(events(r.log, 'powerApplied')).toEqual([]);
  });

  it('logs powerApplied and keeps PlayerState.powers; stacks add', () => {
    const seen: { turn: number; [k: string]: unknown }[] = [];
    const strat = watching(
      (t) => (t === 1 ? ['caltrops', 'caltrops'] : []),
      seen,
      (p) => ({ powers: { ...p.powers } }),
    );
    const d = data();
    const r = simulateCombat(d, cfg({ enemyId: 'dummy', deck: deckOf(['caltrops', 2]) }), strat, { log: true });
    expect(events(r.log, 'powerApplied')).toEqual([
      { t: 'powerApplied', side: 'player', power: 'thorns', amount: 3, total: 3 },
      { t: 'powerApplied', side: 'player', power: 'thorns', amount: 3, total: 6 },
    ]);
    expect(seen[1]).toMatchObject({ turn: 2, powers: { thorns: 6 } });
  });

  it('the engine simulates every PowerId: noDraw, the simple powers, #110, #113, #115 and #116 powers', () => {
    expect([...SIMULATED_POWER_IDS].sort()).toEqual(
      [
        'noDraw',
        'demonForm',
        'energyPerTurn',
        'rollingBoulder',
        'crimsonMantle',
        'plating',
        'barricade',
        'cruelty',
        'dexterity',
        'fasten',
        'thorns',
        'vigorPerTurn',
        'vigor',
        'powersCostLess',
        'upgradeAtCombatEnd',
        'corruption',
        'calamity',
        'helloWorld',
        'entropy',
        'intangible',
        'gambit',
        // #110
        'strengthThisTurn',
        'rage',
        'flameBarrier',
        'colossus',
        'noBlockFromCards',
        'retainHand',
        'freeAttack',
        'doubleAttack',
        'nextCardToDrawTop',
        'choking',
        // #113
        'darkEmbrace',
        'feelNoPain',
        'rupture',
        'inferno',
        'juggernaut',
        'unmovable',
        'vicious',
        'panache',
        'automation',
        'juggling',
        'aggression',
        'hellraiser',
        'stampede',
        'mayhem',
        'nostalgia',
        'stratagem',
      ].sort(),
    );
  });
});

describe('#109 start-of-turn powers', () => {
  it('Demon Form: gain 3 Strength at the start of each later turn, not the turn it is played', () => {
    const r = run(
      data(),
      [
        ['demon', 1],
        ['strike0', 4],
      ],
      (t) => (t === 1 ? ['demon'] : []),
    );
    expect(events(playerTurn(r.log, 1), 'strength')).toEqual([]);
    expect(events(playerTurn(r.log, 2), 'strength')).toEqual([{ t: 'strength', side: 'player', amount: 3, total: 3 }]);
    expect(events(playerTurn(r.log, 3), 'strength')).toEqual([{ t: 'strength', side: 'player', amount: 3, total: 6 }]);
  });

  it('turn-start powers act after the draw', () => {
    const r = run(
      data(),
      [
        ['demon', 1],
        ['strike0', 4],
      ],
      (t) => (t === 1 ? ['demon'] : []),
    );
    const t2 = playerTurn(r.log, 2);
    const lastDraw = t2.map((e) => e.t).lastIndexOf('draw');
    expect(t2.findIndex((e) => e.t === 'strength')).toBeGreaterThan(lastDraw);
  });

  it('Pyre: gain 1 energy at the start of each later turn, on top of the refill', () => {
    const seen: { turn: number; [k: string]: unknown }[] = [];
    const strat = watching(
      (t) => (t === 1 ? ['pyre'] : ['strike0']),
      seen,
      (p) => ({ energy: p.energy }),
    );
    simulateCombat(data(), cfg({ enemyId: 'dummy', deck: deckOf(['pyre', 1], ['strike0', 4]) }), strat);
    expect(seen.slice(0, 3)).toEqual([
      { turn: 1, energy: 3 },
      { turn: 2, energy: 4 },
      { turn: 3, energy: 4 },
    ]);
  });

  it('Rolling Boulder: 5 damage, then 10, …; Block absorbs it; Strength, Vulnerable and Cruelty do not change it', () => {
    const d = data();
    const r = run(
      d,
      [
        ['boulder', 1],
        ['inflame', 1],
        ['cruelty', 1],
        ['bash0', 1],
      ],
      (t) => (t === 1 ? ['boulder', 'inflame', 'cruelty', 'bash0'] : []),
    );
    // Bash on turn 1 applied 2 Vulnerable: still 1 left on turn 2.
    const t2 = playerTurn(r.log, 2);
    expect(events(t2, 'damage')).toEqual([
      { t: 'damage', source: 'player', target: 'enemy', amount: 5, blocked: 0, hpLoss: 5 },
    ]);
    expect(events(t2, 'powerApplied')).toEqual([
      { t: 'powerApplied', side: 'player', power: 'rollingBoulder', amount: 5, total: 10 },
    ]);
    expect(events(playerTurn(r.log, 3), 'damage')[0]).toMatchObject({ amount: 10, hpLoss: 10 });
    expect(events(playerTurn(r.log, 4), 'damage')[0]).toMatchObject({ amount: 15 });
  });

  it("Rolling Boulder: the enemy's Block absorbs it", () => {
    const wall = makeEnemy('wall', 999, { wall: { name: 'Wall', effects: [{ type: 'gainBlock', amount: 3 }] } });
    const d = withEnemy(data(), wall);
    const r = simulateCombat(
      d,
      cfg({ enemyId: 'wall', deck: deckOf(['boulder', 1]) }),
      scripted((t) => (t === 1 ? ['boulder'] : [])),
      { log: true },
    );
    expect(events(playerTurn(r.log, 2), 'damage')[0]).toEqual({
      t: 'damage',
      source: 'player',
      target: 'enemy',
      amount: 5,
      blocked: 3,
      hpLoss: 2,
    });
  });

  it('Rolling Boulder can win at the start of a turn, before any card is played', () => {
    const d = withEnemy(data(), makeEnemy('frail5', 5, { wait: { name: 'Wait', effects: [] } }));
    const r = simulateCombat(
      d,
      cfg({ enemyId: 'frail5', deck: deckOf(['boulder', 1], ['strike0', 4]) }),
      scripted((t) => (t === 1 ? ['boulder'] : ['strike0'])),
      { log: true },
    );
    expect(r).toMatchObject({ outcome: 'win', turns: 2, enemyHpRemaining: 0 });
    expect(events(playerTurn(r.log, 2), 'play')).toEqual([]);
  });

  it('Crimson Mantle: lose 1 HP, then gain 7 Block, at the start of each later turn', () => {
    const r = run(
      data(),
      [
        ['mantle', 1],
        ['strike0', 4],
      ],
      (t) => (t === 1 ? ['mantle'] : []),
    );
    const t2 = playerTurn(r.log, 2).filter((e) => e.t === 'loseHp' || e.t === 'block');
    expect(t2).toEqual([
      { t: 'loseHp', side: 'player', amount: 1, hpAfter: 79 },
      { t: 'block', side: 'player', amount: 7, total: 7 },
    ]);
    expect(events(playerTurn(r.log, 1), 'loseHp')).toEqual([]);
  });

  it('Crimson Mantle: two copies each add their Block and their 1 HP loss (#135)', () => {
    const r = run(data(), [['mantle', 2]], (t) => (t === 1 ? ['mantle', 'mantle'] : []));
    const t2 = playerTurn(r.log, 2).filter((e) => e.t === 'loseHp' || e.t === 'block');
    expect(t2).toEqual([
      { t: 'loseHp', side: 'player', amount: 2, hpAfter: 78 },
      { t: 'block', side: 'player', amount: 14, total: 14 },
    ]);
  });

  it('Rolling Boulder: two copies are separate instances that each grow +5 a turn (#135)', () => {
    const r = run(data(), [['boulder', 2]], (t) => (t === 1 ? ['boulder', 'boulder'] : []));
    const dmg = (turn: number) => events(playerTurn(r.log, turn), 'damage').map((e) => e.amount);
    expect(dmg(2)).toEqual([5, 5]);
    expect(dmg(3)).toEqual([10, 10]);
    expect(dmg(4)).toEqual([15, 15]);
  });

  it('Rolling Boulder: a copy played later starts at 5 while the older one keeps growing (#135)', () => {
    const r = run(data(), [['boulder', 2]], (t) => (t === 1 ? ['boulder'] : t === 2 ? ['boulder'] : []));
    const dmg = (turn: number) => events(playerTurn(r.log, turn), 'damage').map((e) => e.amount);
    expect(dmg(2)).toEqual([5]);
    expect(dmg(3)).toEqual([10, 5]);
    expect(dmg(4)).toEqual([15, 10]);
  });

  it("Crimson Mantle's HP loss counts as an HP loss and can lose the combat", () => {
    const hitter = makeEnemy('hitter', 999, {
      hit: { name: 'Hit', effects: [{ type: 'attack', damage: 79, hits: 1 }] },
    });
    const d = withEnemy(data(), hitter);
    const r = simulateCombat(
      d,
      cfg({ enemyId: 'hitter', deck: deckOf(['mantle', 1]) }),
      scripted((t) => (t === 1 ? ['mantle'] : [])),
      { log: true },
    );
    expect(r).toMatchObject({ outcome: 'loss', turns: 2, hpLost: 80 });
    expect(events(r.log, 'loseHp')).toEqual([{ t: 'loseHp', side: 'player', amount: 1, hpAfter: 0 }]);
  });

  it('Crimson Mantle Block ignores Dexterity and Frail (not from a card)', () => {
    const d = data();
    const frailer = makeEnemy('frailer', 999, { f: { name: 'F', effects: [{ type: 'applyFrail', amount: 3 }] } });
    withEnemy(d, frailer);
    const r = simulateCombat(
      d,
      cfg({ enemyId: 'frailer', deck: deckOf(['mantle', 1], ['prowess', 1]) }),
      scripted((t) => (t === 1 ? ['mantle', 'prowess'] : [])),
      { log: true },
    );
    expect(events(playerTurn(r.log, 2), 'block')).toEqual([{ t: 'block', side: 'player', amount: 7, total: 7 }]);
  });

  it('Prep Time: gain 4 Vigor at the start of each later turn', () => {
    const r = run(data(), [['prep', 1]], (t) => (t === 1 ? ['prep'] : []));
    expect(events(playerTurn(r.log, 2), 'powerApplied')).toEqual([
      { t: 'powerApplied', side: 'player', power: 'vigor', amount: 4, total: 4 },
    ]);
    // Unused Vigor stays and stacks.
    expect(events(playerTurn(r.log, 3), 'powerApplied')).toEqual([
      { t: 'powerApplied', side: 'player', power: 'vigor', amount: 4, total: 8 },
    ]);
  });

  it('turn-start powers run in the order they were first gained', () => {
    const r = run(
      data(),
      [
        ['prep', 1],
        ['demon', 1],
        ['pyre', 1],
      ],
      (t) => (t === 1 ? ['pyre', 'prep', 'demon'] : []),
    );
    const kinds = playerTurn(r.log, 2)
      .filter((e) => e.t === 'energy' || e.t === 'strength' || e.t === 'powerApplied')
      .map((e) => e.t);
    expect(kinds).toEqual(['energy', 'powerApplied', 'strength']);
  });
});

describe('#109 Plating (Stone Armor, Eternal Armor)', () => {
  it('end of turn: gain Block equal to Plating; start of turn: Plating drops by 1 (4 + 3 + 2 + 1), then ends', () => {
    const r = run(data(), [['stone', 1]], (t) => (t === 1 ? ['stone'] : []));
    const blocks = events(r.log, 'block').slice(0, 5);
    expect(blocks.map((b) => b.amount)).toEqual([4, 3, 2, 1]);
    expect(events(playerTurn(r.log, 2), 'powerApplied')).toEqual([
      { t: 'powerApplied', side: 'player', power: 'plating', amount: -1, total: 3 },
    ]);
    expect(events(playerTurn(r.log, 5), 'powerRemoved')).toEqual([
      { t: 'powerRemoved', side: 'player', power: 'plating' },
    ]);
  });

  it('the Block comes at the end of the player turn, before the enemy acts', () => {
    const r = run(data(), [['stone', 1]], (t) => (t === 1 ? ['stone'] : []));
    const t1 = playerTurn(r.log, 1);
    expect(t1.at(-1)).toMatchObject({ t: 'turnEnd', side: 'player' });
    expect(events(t1, 'block')).toEqual([{ t: 'block', side: 'player', amount: 4, total: 4 }]);
  });

  it('does not drop when you take damage', () => {
    const hitter = makeEnemy('hitter', 999, {
      hit: { name: 'Hit', effects: [{ type: 'attack', damage: 10, hits: 3 }] },
    });
    const d = withEnemy(data(), hitter);
    const r = simulateCombat(
      d,
      cfg({ enemyId: 'hitter', deck: deckOf(['stone', 1]) }),
      scripted((t) => (t === 1 ? ['stone'] : [])),
      { log: true },
    );
    expect(events(enemyTurn(r.log, 1), 'powerApplied')).toEqual([]);
    expect(events(playerTurn(r.log, 2), 'block')).toEqual([{ t: 'block', side: 'player', amount: 3, total: 3 }]);
  });

  it('is not changed by Dexterity or Frail', () => {
    const frailer = makeEnemy('frailer', 999, { f: { name: 'F', effects: [{ type: 'applyFrail', amount: 5 }] } });
    const d = withEnemy(data(), frailer);
    const r = simulateCombat(
      d,
      cfg({ enemyId: 'frailer', deck: deckOf(['stone', 1], ['prowess', 1]) }),
      scripted((t) => (t === 1 ? ['stone', 'prowess'] : [])),
      { log: true },
    );
    expect(events(playerTurn(r.log, 2), 'block')).toEqual([{ t: 'block', side: 'player', amount: 3, total: 3 }]);
  });
});

describe('#109 Barricade', () => {
  it('Block is not removed at the start of your turn (no blockReset)', () => {
    const r = run(
      data(),
      [
        ['barricade', 1],
        ['defend0', 2],
      ],
      (t) => (t === 1 ? ['barricade', 'defend0'] : ['defend0']),
    );
    expect(events(playerTurn(r.log, 2), 'blockReset')).toEqual([]);
    expect(events(playerTurn(r.log, 2), 'block')).toEqual([{ t: 'block', side: 'player', amount: 5, total: 10 }]);
  });

  it('without Barricade the Block resets as before', () => {
    const r = run(data(), [['defend0', 2]], () => ['defend0']);
    expect(events(playerTurn(r.log, 2), 'blockReset')).toHaveLength(1);
  });
});

describe('#109 Cruelty', () => {
  it('Vulnerable enemies take an extra 25% (×1.75), floored: Strike 6 → 10', () => {
    const r = run(
      data(),
      [
        ['cruelty', 1],
        ['bash0', 1],
        ['strike0', 1],
      ],
      (t) => (t === 1 ? ['cruelty', 'bash0', 'strike0'] : []),
    );
    const dmg = events(r.log, 'damage').map((e) => e.amount);
    expect(dmg.slice(0, 2)).toEqual([8, 10]); // Bash hits before its Vulnerable; then floor(6 × 1.75)
  });

  it('stacks: two Cruelty = +50% (×2): Strike 6 → 12', () => {
    const r = run(
      data(),
      [
        ['cruelty', 2],
        ['bash0', 1],
        ['strike0', 1],
      ],
      (t) => (t === 1 ? ['cruelty', 'cruelty', 'bash0', 'strike0'] : []),
    );
    expect(events(r.log, 'damage')[1]!.amount).toBe(12);
  });

  it('does nothing without Vulnerable', () => {
    const r = run(
      data(),
      [
        ['cruelty', 1],
        ['strike0', 1],
      ],
      (t) => (t === 1 ? ['cruelty', 'strike0'] : []),
    );
    expect(events(r.log, 'damage')[0]!.amount).toBe(6);
  });
});

describe('#109 Dexterity (Prowess, Expertise) and Fasten', () => {
  it('Dexterity adds to every Block gain from a card', () => {
    const r = run(
      data(),
      [
        ['prowess', 1],
        ['defend0', 1],
        ['shrug', 1],
      ],
      (t) => (t === 1 ? ['prowess', 'defend0', 'shrug'] : []),
    );
    expect(events(r.log, 'strength')).toEqual([{ t: 'strength', side: 'player', amount: 1, total: 1 }]);
    expect(events(r.log, 'block').map((b) => b.amount)).toEqual([6, 6]);
  });

  it('Dexterity is added before Frail: floor((5 + 2) × 0.75) = 5', () => {
    const frailer = makeEnemy('frailer', 999, { f: { name: 'F', effects: [{ type: 'applyFrail', amount: 5 }] } });
    const d = withEnemy(data(), frailer);
    d.cards.prowess!.effects = [apply('dexterity', 2)];
    const r = simulateCombat(
      d,
      cfg({ enemyId: 'frailer', deck: deckOf(['prowess', 1], ['defend0', 1]) }),
      scripted((t) => (t === 1 ? ['prowess'] : ['defend0'])),
      { log: true },
    );
    expect(events(playerTurn(r.log, 2), 'block')).toEqual([{ t: 'block', side: 'player', amount: 5, total: 5 }]);
  });

  it('Dexterity does not change enemy Block', () => {
    const wall = makeEnemy('wall', 999, { wall: { name: 'Wall', effects: [{ type: 'gainBlock', amount: 3 }] } });
    const d = withEnemy(data(), wall);
    const r = simulateCombat(
      d,
      cfg({ enemyId: 'wall', deck: deckOf(['prowess', 1]) }),
      scripted((t) => (t === 1 ? ['prowess'] : [])),
      { log: true },
    );
    expect(events(r.log, 'block').find((b) => b.side === 'enemy')).toMatchObject({ amount: 3 });
  });

  it('Fasten: +4 Block on cards named "Defend" (Defend, Ultimate Defend), not on other Block cards', () => {
    const r = run(
      data(),
      [
        ['fasten', 1],
        ['defend0', 1],
        ['ultdef0', 1],
        ['shrug', 1],
      ],
      (t) => (t === 1 ? ['fasten', 'defend0', 'ultdef0', 'shrug'] : []),
    );
    expect(events(r.log, 'block').map((b) => b.amount)).toEqual([9, 15, 5]);
  });

  it('Fasten applies to upgraded Defends ("Defend+") and adds with Dexterity before Frail', () => {
    const frailer = makeEnemy('frailer', 999, { f: { name: 'F', effects: [{ type: 'applyFrail', amount: 5 }] } });
    const d = withEnemy(data(), frailer);
    const r = simulateCombat(
      d,
      cfg({ enemyId: 'frailer', deck: deckOf(['fasten', 1], ['prowess', 1], ['defend', 1, true]) }),
      scripted((t) => (t === 1 ? ['fasten', 'prowess'] : ['defend'])),
      { log: true },
    );
    // floor((8 + 1 + 4) × 0.75) = 9
    expect(events(playerTurn(r.log, 2), 'block')).toEqual([{ t: 'block', side: 'player', amount: 9, total: 9 }]);
  });
});

describe('#135 Fasten and Frail', () => {
  it('Fasten is added before Frail x0.75, rounded down once: floor((5 + 4) x 0.75) = 6', () => {
    const frailer = makeEnemy('frailer', 999, { f: { name: 'F', effects: [{ type: 'applyFrail', amount: 5 }] } });
    const d = withEnemy(data(), frailer);
    const r = simulateCombat(
      d,
      cfg({ enemyId: 'frailer', deck: deckOf(['fasten', 1], ['defend0', 1]) }),
      scripted((t) => (t === 1 ? ['fasten'] : ['defend0'])),
      { log: true },
    );
    // Rounding separately would give 9 or floor(5 x 0.75) + 4 = 7; the wiki rule gives 6.
    expect(events(playerTurn(r.log, 2), 'block')).toEqual([{ t: 'block', side: 'player', amount: 6, total: 6 }]);
  });
});

describe('#109 Thorns (Caltrops)', () => {
  const twoHits = () =>
    makeEnemy('twohit', 999, { hit: { name: 'Hit', effects: [{ type: 'attack', damage: 4, hits: 2 }] } });

  it('deals 3 damage back after every enemy hit, blocked or not', () => {
    const d = withEnemy(data(), twoHits());
    const r = simulateCombat(
      d,
      cfg({ enemyId: 'twohit', deck: deckOf(['caltrops', 1], ['ultdef0', 1]) }),
      scripted((t) => (t === 1 ? ['caltrops', 'ultdef0'] : [])),
      { log: true },
    );
    const dmg = events(enemyTurn(r.log, 1), 'damage');
    expect(dmg).toEqual([
      { t: 'damage', source: 'enemy', target: 'player', amount: 4, blocked: 4, hpLoss: 0 },
      { t: 'damage', source: 'player', target: 'enemy', amount: 3, blocked: 0, hpLoss: 3 },
      { t: 'damage', source: 'enemy', target: 'player', amount: 4, blocked: 4, hpLoss: 0 },
      { t: 'damage', source: 'player', target: 'enemy', amount: 3, blocked: 0, hpLoss: 3 },
    ]);
  });

  it('ignores Strength and Vulnerable; does not trigger on non-attack moves', () => {
    const d = withEnemy(
      data(),
      makeEnemy(
        'mix',
        999,
        {
          hit: { name: 'Hit', effects: [{ type: 'attack', damage: 1, hits: 1 }] },
          rest: { name: 'Rest', effects: [{ type: 'gainBlock', amount: 1 }] },
        },
        ['rest', 'hit'],
      ),
    );
    const r = simulateCombat(
      d,
      cfg({ enemyId: 'mix', deck: deckOf(['caltrops', 1], ['inflame', 1], ['bash0', 1]) }),
      scripted((t) => (t === 1 ? ['caltrops', 'inflame', 'bash0'] : [])),
      { log: true },
    );
    expect(events(enemyTurn(r.log, 1), 'damage')).toEqual([]);
    // Turn 2: enemy (still Vulnerable from Bash's 2) hits once; Thorns deals a flat 3.
    expect(events(enemyTurn(r.log, 2), 'damage').filter((e) => e.source === 'player')).toEqual([
      { t: 'damage', source: 'player', target: 'enemy', amount: 3, blocked: 0, hpLoss: 3 },
    ]);
  });

  it('can kill the enemy during its move: a win, and the move stops', () => {
    const d = withEnemy(
      data(),
      makeEnemy('weak', 3, { hit: { name: 'Hit', effects: [{ type: 'attack', damage: 1, hits: 3 }] } }),
    );
    const r = simulateCombat(
      d,
      cfg({ enemyId: 'weak', deck: deckOf(['caltrops', 1]) }),
      scripted((t) => (t === 1 ? ['caltrops'] : [])),
      { log: true },
    );
    expect(r).toMatchObject({ outcome: 'win', turns: 1, enemyHpRemaining: 0, hpLost: 1 });
    expect(events(r.log, 'damage').filter((e) => e.source === 'enemy')).toHaveLength(1);
  });

  it("a hit that kills the player is a loss (Thorns doesn't fire after it)", () => {
    const d = withEnemy(
      data(),
      makeEnemy('big', 3, { hit: { name: 'Hit', effects: [{ type: 'attack', damage: 80, hits: 1 }] } }),
    );
    const r = simulateCombat(
      d,
      cfg({ enemyId: 'big', deck: deckOf(['caltrops', 1]) }),
      scripted((t) => (t === 1 ? ['caltrops'] : [])),
    );
    expect(r).toMatchObject({ outcome: 'loss', enemyHpRemaining: 3 });
  });
});

describe('#109 Vigor (Prep Time)', () => {
  /** Prep Time on turn 1, then on turn 2 the given plays. */
  const vigorRun = (deck: [string, number, boolean?][], turn2: string[]) =>
    run(data(), [['prep', 1], ...deck], (t) => (t === 1 ? ['prep'] : t === 2 ? turn2 : []));

  it('adds to EVERY hit of the next Attack: Twin Strike 5+4 twice', () => {
    const r = vigorRun([['twin', 1]], ['twin']);
    expect(events(playerTurn(r.log, 2), 'damage').map((e) => e.amount)).toEqual([9, 9]);
  });

  it('that Attack uses it all up; the next Attack gets none', () => {
    const r = vigorRun(
      [
        ['twin', 1],
        ['strike0', 1],
      ],
      ['twin', 'strike0'],
    );
    const t2 = playerTurn(r.log, 2);
    expect(events(t2, 'damage').map((e) => e.amount)).toEqual([9, 9, 6]);
    expect(events(t2, 'powerRemoved')).toEqual([{ t: 'powerRemoved', side: 'player', power: 'vigor' }]);
  });

  it('a Skill does not use it', () => {
    const r = vigorRun(
      [
        ['defend0', 1],
        ['strike0', 1],
      ],
      ['defend0', 'strike0'],
    );
    expect(events(playerTurn(r.log, 2), 'damage').map((e) => e.amount)).toEqual([10]);
  });

  it('is added to the first Bash only: 8 + 4, then 8 × 1.5 for the second (Vigor used up)', () => {
    const d = data();
    const r = run(
      d,
      [
        ['prep', 1],
        ['bash0', 2],
      ],
      (t) => (t === 1 ? ['prep'] : t === 2 ? ['bash0', 'bash0'] : []),
    );
    // First Bash: 8 + 4 Vigor = 12 (enemy not yet Vulnerable); second Bash: 8 × 1.5 = 12 (Vigor used up).
    expect(events(playerTurn(r.log, 2), 'damage').map((e) => e.amount)).toEqual([12, 12]);
  });

  it('with Strength and Vulnerable: floor((5 + 2 + 4) × 1.5) = 16 per hit', () => {
    const d = data();
    const r = run(
      d,
      [
        ['prep', 1],
        ['inflame', 1],
        ['bash0', 1],
        ['twin', 1],
      ],
      (t) => (t === 1 ? ['prep', 'inflame', 'bash0'] : t === 2 ? ['twin'] : []),
    );
    // Bash on turn 1 leaves 1 Vulnerable for turn 2; Twin Strike gets the 4 Vigor on both hits.
    expect(events(playerTurn(r.log, 2), 'damage').map((e) => e.amount)).toEqual([16, 16]);
  });
});

describe('#109 Mad Science: Curious and Improvement', () => {
  it('Curious: every Power costs 1 less, in every pile, minimum 0; stacks', () => {
    const seen: { turn: number; [k: string]: unknown }[] = [];
    const read: Reader = (p) => ({
      costs: [...p.hand, ...p.drawPile, ...p.discardPile]
        .filter((c) => c.cardId === 'pricey' || c.cardId === 'inflame')
        .map((c) => `${c.cardId}:${c.cost}`)
        .sort(),
    });
    const d = data();
    d.cards.curious!.cost = 1;
    d.cards.inflame!.cost = 1;
    const strat = watching((t) => (t === 1 ? ['curious'] : []), seen, read);
    // 7 cards: 5 drawn on turn 1, 2 still in the draw pile.
    simulateCombat(d, cfg({ enemyId: 'dummy', deck: deckOf(['curious', 1], ['pricey', 3], ['inflame', 3]) }), strat);
    expect(seen[1]!.costs).toEqual(['inflame:0', 'inflame:0', 'inflame:0', 'pricey:1', 'pricey:1', 'pricey:1']);
  });

  it('Curious stacks: two copies take 2 off', () => {
    const d = data();
    const r = run(
      d,
      [
        ['curious', 2],
        ['pricey', 1],
      ],
      (t) => (t === 1 ? ['curious', 'curious', 'pricey'] : []),
    );
    expect(events(r.log, 'play').map((e) => [e.cardId, e.energyLeft])).toEqual([
      ['curious', 3],
      ['curious', 3],
      ['pricey', 3],
    ]);
  });

  it('Improvement: costs its energy, does nothing in combat, and leaves the deck', () => {
    const d = data();
    d.cards.improve!.cost = 1;
    const r = run(
      d,
      [
        ['improve', 1],
        ['strike0', 1],
      ],
      (t) => (t === 1 ? ['improve', 'strike0'] : ['strike0']),
    );
    expect(events(r.log, 'play')[0]).toMatchObject({ cardId: 'improve', energyLeft: 2 });
    expect(events(r.log, 'powerApplied')).toEqual([
      { t: 'powerApplied', side: 'player', power: 'upgradeAtCombatEnd', amount: 1, total: 1 },
    ]);
    expect(events(r.log, 'damage')[0]!.amount).toBe(6);
  });
});

describe('#109 Corruption', () => {
  it('Skills cost 0 in every pile; Attacks and Powers keep their cost', () => {
    const seen: { turn: number; [k: string]: unknown }[] = [];
    const read: Reader = (p) => ({
      costs: [...p.hand, ...p.drawPile, ...p.discardPile].map((c) => `${c.cardId}:${c.cost}`).sort(),
    });
    const d = data();
    const strat = watching((t) => (t === 1 ? ['corruption'] : []), seen, read);
    simulateCombat(
      d,
      cfg({ enemyId: 'dummy', deck: deckOf(['corruption', 1], ['defend', 3], ['strike', 3], ['pricey', 1]) }),
      strat,
    );
    expect(seen[1]!.costs).toEqual([
      'defend:0',
      'defend:0',
      'defend:0',
      'pricey:2',
      'strike:1',
      'strike:1',
      'strike:1',
    ]);
  });

  it('a played Skill is exhausted (reason "power"); an Attack is discarded as usual', () => {
    const r = run(
      data(),
      [
        ['corruption', 1],
        ['defend', 1],
        ['strike0', 1],
      ],
      (t) => (t === 1 ? ['corruption', 'defend', 'strike0'] : []),
    );
    expect(events(r.log, 'play').map((e) => [e.cardId, e.energyLeft])).toEqual([
      ['corruption', 3],
      ['defend', 3],
      ['strike0', 3],
    ]);
    expect(events(r.log, 'exhaust')).toEqual([
      { t: 'exhaust', uid: expect.any(Number), cardId: 'defend', reason: 'power' },
    ]);
    expect(events(playerTurn(r.log, 2), 'draw').map((e) => e.cardId)).toEqual(['strike0']);
  });

  it('a Skill with the Exhaust keyword is exhausted once, by the keyword', () => {
    const r = run(
      data(),
      [
        ['corruption', 1],
        ['exhaustSkill', 1],
      ],
      (t) => (t === 1 ? ['corruption', 'exhaustSkill'] : []),
    );
    expect(events(r.log, 'exhaust')).toEqual([
      { t: 'exhaust', uid: expect.any(Number), cardId: 'exhaustSkill', reason: 'keyword' },
    ]);
  });

  it('Drum of Battle played under Corruption costs 0, is exhausted and gains its 2 energy (Trent, Q4)', () => {
    const r = run(
      data(),
      [
        ['corruption', 1],
        ['drum', 1],
      ],
      (t) => (t === 1 ? ['corruption', 'drum'] : []),
    );
    expect(events(r.log, 'play').map((e) => [e.cardId, e.energyLeft])).toEqual([
      ['corruption', 3],
      ['drum', 3],
    ]);
    expect(events(r.log, 'energy')).toEqual([{ t: 'energy', amount: 2, total: 5 }]);
  });

  it('Ethereal Skills left in hand still exhaust as Ethereal, not by Corruption', () => {
    const d = data();
    d.cards.eth = { ...cards.defend!, id: 'eth', code: 'Et', keywords: ['ethereal'], upgraded: null };
    const r = run(
      d,
      [
        ['corruption', 1],
        ['eth', 1],
      ],
      (t) => (t === 1 ? ['corruption'] : []),
    );
    expect(events(r.log, 'exhaust')).toEqual([
      { t: 'exhaust', uid: expect.any(Number), cardId: 'eth', reason: 'ethereal' },
    ]);
  });
});

describe('#109 determinism', () => {
  it('same config + seed with every simple power gives an identical log', () => {
    const d = withEnemy(
      data(),
      makeEnemy('hitter', 300, { hit: { name: 'Hit', effects: [{ type: 'attack', damage: 6, hits: 2 }] } }),
    );
    const deck = deckOf(
      ['demon', 1],
      ['boulder', 1],
      ['stone', 1],
      ['caltrops', 1],
      ['prep', 1],
      ['cruelty', 1],
      ['strike', 4],
      ['defend', 4],
      ['bash', 1],
    );
    const c = cfg({ enemyId: 'hitter', deck, seed: 42 });
    const a = simulateCombat(d, c, createStrategy(GREEDY_CONFIG), { log: true });
    const b = simulateCombat(d, c, createStrategy(GREEDY_CONFIG), { log: true });
    expect(a).toEqual(b);
    expect(events(a.log, 'powerApplied').length).toBeGreaterThan(0);
  });
});
