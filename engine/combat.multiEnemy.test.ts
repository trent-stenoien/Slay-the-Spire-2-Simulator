/** #5: fights against several enemies, and per-strategy target priority. */
import { describe, expect, it } from 'vitest';
import { combatEnemyIds, combineIntents, runCombat, simulateCombat } from './combat';
import { cfg, deckOf, events, passive, withEnemy } from './combatTestHelpers';
import { runCombatRange } from './montecarlo';
import { GREEDY_CONFIG, normalizeConfig, parseStrategyCode, pickTarget, strategyCode } from './strategies';
import { cards, makeEnemy, makeGameData } from './testFixtures';
import { gameData } from '../data';
import type {
  CardDef,
  CombatConfig,
  Effect,
  EnemyIntent,
  EnemyState,
  GameData,
  GameEvent,
  RunConfig,
  Strategy,
  StrategyView,
} from './types';

/** A test attack/skill card built from Strike with these effects (cost 0 unless given). */
function card(id: string, effects: Effect[], over: Partial<CardDef> = {}): CardDef {
  return { ...cards.strike!, id, code: id.slice(0, 2), name: id, cost: 0, effects, upgraded: null, ...over };
}

const hit = (damage: number, hits = 1): Effect => ({ type: 'attack', damage, hits });
const wait = () => ({ wait: { name: 'Wait', effects: [] as Effect[] } });
const attacker = (id: string, hp: number, damage: number) =>
  makeEnemy(id, hp, { bite: { name: 'Bite', effects: [hit(damage)] } });

/** Game data with the test cards and enemies added. */
function world(...enemies: ReturnType<typeof makeEnemy>[]): GameData {
  const data = withEnemy(makeGameData(), ...enemies);
  const add = (c: CardDef) => (data.cards[c.id] = c);
  add(card('zap', [hit(6)]));
  add(card('twin', [hit(5, 2)]));
  add(card('cleave', [{ type: 'attack', damage: 8, hits: 1, allEnemies: true }]));
  add(card('spray', [{ type: 'attack', damage: 4, hits: 2, allEnemies: true }]));
  add(
    card('clap', [
      { type: 'attack', damage: 4, hits: 1, allEnemies: true },
      { type: 'applyVulnerable', amount: 1, allEnemies: true },
    ]),
  );
  add(card('mark', [{ type: 'applyVulnerable', amount: 2 }], { type: 'skill' }));
  add(card('toxin', [{ type: 'applyPoison', amount: 5 }], { type: 'skill' }));
  add(card('fog', [{ type: 'applyPoison', amount: 3, allEnemies: true }], { type: 'skill' }));
  add(
    card('feed', [hit(10), { type: 'conditional', if: { kind: 'fatal' }, then: [{ type: 'gainMaxHp', amount: 3 }] }]),
  );
  // #111 Fisticuffs-style: Block equal to the damage of the previous attack.
  add(
    card('punch', [
      { type: 'attack', damage: 6, hits: 1, allEnemies: true },
      { type: 'gainBlockFrom', amount: 0, bonusPer: { per: 'lastAttackDamage', amount: 1 } },
    ]),
  );
  add(card('spikes', [{ type: 'applyPower', power: 'thorns', amount: 3 }], { type: 'power' }));
  add(card('bomb', [{ type: 'dealDamage', amount: 7, allEnemies: true }], { type: 'skill' }));
  return data;
}

/** Plays [cardId, target?] pairs in order each turn (a missing card throws). */
function aimed(plan: (turn: number) => [string, number?][]): Strategy {
  let turn = -1;
  let queue: [string, number?][] = [];
  return {
    decide(view: StrategyView) {
      if (view.state.turn !== turn) {
        turn = view.state.turn;
        queue = [...plan(turn)];
      }
      const next = queue.shift();
      if (!next) return { kind: 'endTurn' };
      const c = view.playable.find((p) => p.cardId === next[0]);
      if (!c) throw new Error(`aimed: ${next[0]} not playable on turn ${turn}`);
      return next[1] === undefined ? { kind: 'play', uid: c.uid } : { kind: 'play', uid: c.uid, target: next[1] };
    },
  };
}

const conf = (enemyIds: string[], deck: [string, number][], over: Partial<CombatConfig> = {}) =>
  cfg({ enemyIds, deck: deckOf(...deck), ...over });

const run = (data: GameData, strategy: Strategy, c: CombatConfig) => simulateCombat(data, c, strategy, { log: true });

/** The log as compact strings, tracking which enemy each enemy-side event is about. */
function trace(log: GameEvent[] | undefined, from: (e: GameEvent) => boolean = () => true): string[] {
  const out: string[] = [];
  let on = false;
  for (const e of log ?? []) {
    if (!on && from(e)) on = true;
    if (!on) continue;
    // Stop at the start of the next player turn after the first event.
    if (out.length > 0 && e.t === 'turnStart' && e.side === 'player') break;
    if (e.t === 'target') out.push(`target ${e.enemy}`);
    else if (e.t === 'damage') out.push(`damage ${e.target} ${e.hpLoss}`);
    else if (e.t === 'enemyMove') out.push(`move ${e.name}`);
    else if (e.t === 'blockReset' || e.t === 'turnEnd' || e.t === 'turnStart')
      out.push(`${e.t} ${'side' in e ? e.side : ''}`);
    else if (e.t === 'debuff') out.push(`debuff ${e.side} ${e.kind} ${e.total}`);
    else if (e.t === 'debuffTick') out.push(`tick ${e.side} ${e.kind} ${e.total}`);
    else if (e.t === 'poisonDamage') out.push(`poison ${e.amount}`);
    else if (e.t === 'poison') out.push(`poisoned ${e.total}`);
    else if (e.t === 'combatEnd') out.push(`end ${e.outcome}`);
  }
  return out;
}

const enemyTurn1 = (e: GameEvent) => e.t === 'turnStart' && e.side === 'enemy' && e.turn === 1;

describe('#5 multi-enemy setup', () => {
  it('enemyIds lists the enemies left to right; enemyId alone is a one-enemy fight', () => {
    expect(combatEnemyIds({ enemyId: 'x' })).toEqual(['x']);
    expect(combatEnemyIds({ enemyId: 'x', enemyIds: [] })).toEqual(['x']);
    expect(combatEnemyIds({ enemyId: 'x', enemyIds: ['a', 'b'] })).toEqual(['a', 'b']);
  });

  it('logs every enemy HP at the start; a one-enemy fight logs no enemyHps and no target events', () => {
    const data = world(attacker('a', 20, 1), attacker('b', 12, 1));
    const two = run(data, passive, conf(['a', 'b'], [['defend', 5]]));
    expect(events(two.log, 'combatStart')[0]).toMatchObject({ enemyHp: 20, enemyHps: [20, 12] });
    const one = run(data, passive, conf(['a'], [['defend', 5]]));
    expect(events(one.log, 'combatStart')[0]!.enemyHps).toBeUndefined();
    expect(events(one.log, 'target')).toEqual([]);
  });
});

describe('#5 enemy turn order', () => {
  it('each enemy finishes its whole turn (Block reset, move, debuff tick) before the next starts', () => {
    const data = world(attacker('a', 30, 5), attacker('b', 30, 3));
    const r = run(
      data,
      aimed((t) => (t === 1 ? [['clap']] : [])),
      conf(
        ['a', 'b'],
        [
          ['clap', 1],
          ['defend', 4],
        ],
      ),
    );
    // The clap left enemy 0 current, so the turn starts on it without a target event.
    expect(trace(r.log, enemyTurn1)).toEqual([
      'turnStart enemy',
      'blockReset enemy',
      'move Bite',
      'damage player 5',
      'tick enemy vulnerable 0',
      'target 1',
      'blockReset enemy',
      'move Bite',
      'damage player 3',
      'tick enemy vulnerable 0',
      'turnEnd enemy',
    ]);
  });

  it('Poison ticks in each enemy own turn, right before its move', () => {
    const data = world(attacker('a', 30, 5), attacker('b', 30, 3));
    const r = run(
      data,
      aimed((t) => (t === 1 ? [['fog']] : [])),
      conf(
        ['a', 'b'],
        [
          ['fog', 1],
          ['defend', 4],
        ],
      ),
    );
    const t = trace(r.log, enemyTurn1).filter((l) => /^(poison |move |target)/.test(l));
    expect(t).toEqual(['poison 3', 'move Bite', 'target 1', 'poison 3', 'move Bite']);
  });

  it('a Poison kill of an earlier enemy skips only its move; later enemies still take their turns', () => {
    const data = world(attacker('a', 3, 5), attacker('b', 30, 3));
    const r = run(
      data,
      aimed((t) => (t === 1 ? [['fog']] : [])),
      conf(
        ['a', 'b'],
        [
          ['fog', 1],
          ['defend', 4],
        ],
      ),
    );
    const t = trace(r.log, enemyTurn1).filter((l) => /^(poison |move )/.test(l));
    expect(t.slice(0, 3)).toEqual(['poison 3', 'poison 3', 'move Bite']);
  });

  it('a dead enemy no longer acts', () => {
    const data = world(attacker('a', 6, 5), attacker('b', 30, 3));
    const r = run(
      data,
      aimed((t) => (t === 1 ? [['zap', 0]] : [])),
      conf(
        ['a', 'b'],
        [
          ['zap', 1],
          ['defend', 4],
        ],
      ),
    );
    const moves = trace(r.log, enemyTurn1).filter((l) => l.startsWith('move') || l.startsWith('damage player'));
    expect(moves.slice(0, 2)).toEqual(['move Bite', 'damage player 3']);
    expect(r.log!.filter((e) => e.t === 'damage' && e.target === 'player' && e.hpLoss === 5)).toEqual([]);
  });
});

describe('#5 win condition', () => {
  it('killing one enemy does not end the fight; it is won when every enemy is dead', () => {
    const data = world(makeEnemy('a', 6, wait()), makeEnemy('b', 6, wait()));
    const r = run(
      data,
      aimed((t) => (t === 1 ? [['zap', 0]] : t === 2 ? [['zap', 1]] : [])),
      conf(['a', 'b'], [['zap', 5]]),
    );
    expect(r.outcome).toBe('win');
    expect(r.turns).toBe(2);
    expect(r.enemyHpRemaining).toBe(0);
  });

  it('enemyHpRemaining is the sum over all enemies', () => {
    const data = world(makeEnemy('a', 20, wait()), makeEnemy('b', 15, wait()));
    const r = runCombat(data, conf(['a', 'b'], [['defend', 5]], { strategy: GREEDY_CONFIG }));
    expect(r.outcome).toBe('turnCap');
    expect(r.enemyHpRemaining).toBe(35);
  });

  it('the player still loses when killed by any enemy', () => {
    const data = world(attacker('a', 99, 50), attacker('b', 99, 50));
    expect(runCombat(data, conf(['a', 'b'], [['defend', 5]])).outcome).toBe('loss');
  });
});

describe('#5 targets', () => {
  it('a single-target card hits the chosen enemy', () => {
    const data = world(makeEnemy('a', 30, wait()), makeEnemy('b', 30, wait()));
    const r = run(
      data,
      aimed((t) => (t === 1 ? [['zap', 1]] : [])),
      conf(['a', 'b'], [['zap', 5]]),
    );
    expect(trace(r.log).filter((l) => l.startsWith('target') || l.startsWith('damage'))[0]).toBe('target 1');
    expect(trace(r.log)).toContain('damage enemy 6');
  });

  it('a dead or missing target is replaced by the current enemy, else the leftmost living one', () => {
    const data = world(makeEnemy('a', 6, wait()), makeEnemy('b', 30, wait()), makeEnemy('c', 30, wait()));
    // Kill a, then aim at the dead a: the zap goes to b (leftmost living).
    const r = run(
      data,
      aimed((t) =>
        t === 1
          ? [
              ['zap', 0],
              ['zap', 0],
            ]
          : [],
      ),
      conf(['a', 'b', 'c'], [['zap', 5]]),
    );
    const turn1 = r.log!.slice(
      0,
      r.log!.findIndex((e) => e.t === 'turnStart' && e.side === 'enemy'),
    );
    const states = turn1.filter((e) => e.t === 'target' || e.t === 'damage');
    expect(states.map((e) => (e.t === 'target' ? `t${e.enemy}` : `d${e.t === 'damage' ? e.hpLoss : ''}`))).toEqual([
      'd6',
      't1',
      'd6',
    ]);
  });

  it('the remaining hits of a single-target attack are lost when its target dies', () => {
    const data = world(makeEnemy('a', 5, wait()), makeEnemy('b', 30, wait()));
    const r = run(
      data,
      aimed((t) => (t === 1 ? [['twin', 0]] : [])),
      conf(['a', 'b'], [['twin', 5]]),
    );
    const dmg = events(r.log, 'damage').filter((d) => d.target === 'enemy');
    expect(dmg).toHaveLength(1);
  });

  it('single-target debuffs and Poison go to the target only', () => {
    const data = world(makeEnemy('a', 30, wait()), makeEnemy('b', 30, wait()));
    const r = run(
      data,
      aimed((t) =>
        t === 1
          ? [
              ['mark', 1],
              ['toxin', 1],
            ]
          : [],
      ),
      conf(
        ['a', 'b'],
        [
          ['mark', 1],
          ['toxin', 1],
          ['defend', 3],
        ],
      ),
    );
    expect(
      trace(r.log)
        .filter((l) => /target|debuff|poisoned/.test(l))
        .slice(0, 3),
    ).toEqual(['target 1', 'debuff enemy vulnerable 2', 'poisoned 5']);
  });
});

describe('#5 ALL-enemies effects', () => {
  it('an ALL attack hits every living enemy; multi-hit: each hit lands on all before the next', () => {
    const data = world(makeEnemy('a', 30, wait()), makeEnemy('b', 30, wait()));
    const r = run(
      data,
      aimed((t) => (t === 1 ? [['spray']] : [])),
      conf(['a', 'b'], [['spray', 5]]),
    );
    const seq = trace(r.log).filter((l) => /target|damage/.test(l));
    expect(seq.slice(0, 6)).toEqual([
      'damage enemy 4',
      'target 1',
      'damage enemy 4',
      'target 0',
      'damage enemy 4',
      'target 1',
    ]);
  });

  it('an ALL attack skips dead enemies and can win the fight', () => {
    const data = world(makeEnemy('a', 6, wait()), makeEnemy('b', 8, wait()), makeEnemy('c', 30, wait()));
    const r = run(
      data,
      aimed((t) => (t === 1 ? [['zap', 0], ['cleave']] : [])),
      conf(
        ['a', 'b', 'c'],
        [
          ['zap', 1],
          ['cleave', 1],
          ['defend', 3],
        ],
      ),
    );
    const hits = events(r.log, 'damage').filter((d) => d.target === 'enemy');
    expect(hits.map((h) => h.hpLoss)).toEqual([6, 8, 8]);
    const kill = world(makeEnemy('a', 8, wait()), makeEnemy('b', 8, wait()));
    expect(
      run(
        kill,
        aimed(() => [['cleave']]),
        conf(['a', 'b'], [['cleave', 5]]),
      ).outcome,
    ).toBe('win');
  });

  it('ALL debuffs and ALL Poison go on every living enemy', () => {
    const data = world(makeEnemy('a', 30, wait()), makeEnemy('b', 30, wait()));
    const r = run(
      data,
      aimed((t) => (t === 1 ? [['clap'], ['fog']] : [])),
      conf(
        ['a', 'b'],
        [
          ['clap', 1],
          ['fog', 1],
          ['defend', 3],
        ],
      ),
    );
    expect(events(r.log, 'debuff').filter((d) => d.side === 'enemy')).toHaveLength(2);
    expect(events(r.log, 'poison')).toHaveLength(2);
    // Each enemy then takes its own Poison at the start of the enemy turn.
    expect(trace(r.log, enemyTurn1).filter((l) => l.startsWith('poison '))).toEqual(['poison 3', 'poison 3']);
  });

  it('ALL fixed damage (The Bomb) hits every living enemy', () => {
    const data = world(makeEnemy('a', 30, wait()), makeEnemy('b', 30, wait()));
    const r = run(
      data,
      aimed((t) => (t === 1 ? [['bomb']] : [])),
      conf(
        ['a', 'b'],
        [
          ['bomb', 1],
          ['defend', 4],
        ],
      ),
    );
    expect(
      events(r.log, 'damage')
        .filter((d) => d.target === 'enemy')
        .map((d) => d.hpLoss),
    ).toEqual([7, 7]);
  });

  it('#6 note: an ALL attack counts its damage once per enemy hit (6 to ALL = 12 vs two enemies)', () => {
    const data = world(makeEnemy('a', 30, wait()), makeEnemy('b', 30, wait()));
    const r = run(
      data,
      aimed((t) => (t === 1 ? [['punch']] : [])),
      conf(['a', 'b'], [['punch', 5]]),
    );
    expect(events(r.log, 'block').find((b) => b.side === 'player')?.amount).toBe(12);
  });
});

describe('#5 deaths mid-fight', () => {
  it('Poison killing one enemy does not end the fight; the other still moves', () => {
    const data = world(attacker('a', 4, 9), attacker('b', 30, 2));
    const r = run(
      data,
      aimed((t) => (t === 1 ? [['toxin', 0]] : [])),
      conf(
        ['a', 'b'],
        [
          ['toxin', 1],
          ['defend', 4],
        ],
      ),
    );
    const turn = trace(r.log, enemyTurn1);
    expect(turn).toContain('poison 5');
    expect(turn.filter((l) => l.startsWith('move'))).toEqual(['move Bite']);
    expect(turn).toContain('damage player 2');
  });

  it('Thorns killing an attacker stops its attack; the next enemy still acts', () => {
    const multi = makeEnemy('a', 3, { jab: { name: 'Jab', effects: [hit(1, 3)] } });
    const data = world(multi, attacker('b', 30, 2));
    const r = run(
      data,
      aimed((t) => (t === 1 ? [['spikes']] : [])),
      conf(
        ['a', 'b'],
        [
          ['spikes', 1],
          ['defend', 4],
        ],
      ),
    );
    const turn = trace(r.log, enemyTurn1);
    expect(turn.filter((l) => l === 'damage player 1')).toHaveLength(1);
    expect(turn).toContain('damage player 2');
  });

  it('a fatal kill counts while other enemies live (Feed)', () => {
    const data = world(makeEnemy('a', 10, wait()), makeEnemy('b', 30, wait()));
    const r = run(
      data,
      aimed((t) => (t === 1 ? [['feed', 0]] : [])),
      conf(
        ['a', 'b'],
        [
          ['feed', 1],
          ['defend', 4],
        ],
      ),
    );
    expect(events(r.log, 'maxHp')).toEqual([expect.objectContaining({ amount: 3 })]);
    const miss = run(
      data,
      aimed((t) => (t === 1 ? [['feed', 1]] : [])),
      conf(
        ['a', 'b'],
        [
          ['feed', 1],
          ['defend', 4],
        ],
      ),
    );
    expect(events(miss.log, 'maxHp')).toEqual([]);
  });

  it('Shrink ends when the enemy that applied it dies', () => {
    const shrinker = makeEnemy('s', 6, { shrink: { name: 'Shrink', effects: [{ type: 'applyShrink', amount: 50 }] } });
    const data = world(shrinker, makeEnemy('b', 99, wait()));
    const plan = aimed((t) =>
      t === 2
        ? [
            ['zap', 0],
            ['zap', 0],
            ['zap', 1],
          ]
        : [],
    );
    const r = run(data, plan, conf(['s', 'b'], [['zap', 5]]));
    // Turn 2: two shrunk zaps (6 → 3) kill the Shrinker; the third zap is full damage again.
    const dmg = events(r.log, 'damage').filter((d) => d.target === 'enemy');
    expect(dmg.map((d) => d.amount)).toEqual([3, 3, 6]);
    expect(events(r.log, 'shrink').at(-1)?.percent).toBe(0);
  });
});

describe('#5 intents', () => {
  const intent = (moveId: string, totalIncoming: number): EnemyIntent => ({
    moveId,
    name: moveId,
    attacks: totalIncoming ? [{ damagePerHit: totalIncoming, hits: 1 }] : [],
    totalIncoming,
  });

  it('combines the living enemies: attacks in order, incoming summed, the first living one named', () => {
    const c = combineIntents([intent('x', 5), intent('y', 0), intent('z', 7)], [{ hp: 0 }, { hp: 3 }, { hp: 4 }]);
    expect(c).toEqual({ moveId: 'y', name: 'y', attacks: [{ damagePerHit: 7, hits: 1 }], totalIncoming: 7 });
  });

  it('with one enemy the intent is its own', () => {
    const only = intent('x', 5);
    expect(combineIntents([only], [{ hp: 1 }])).toBe(only);
  });

  it('the strategy view carries every enemy intent and the combined incoming damage', () => {
    const data = world(attacker('a', 30, 5), attacker('b', 30, 3));
    let seen: StrategyView | undefined;
    simulateCombat(data, conf(['a', 'b'], [['defend', 5]]), {
      decide: (v) => {
        seen ??= v;
        return { kind: 'endTurn' };
      },
    });
    expect(seen!.intents!.map((i) => i.totalIncoming)).toEqual([5, 3]);
    expect(seen!.intent.totalIncoming).toBe(8);
    expect(seen!.state.enemies).toHaveLength(2);
  });
});

describe('#5 target priority (Trent)', () => {
  const enemy = (hp: number): EnemyState => ({
    enemyId: 'e',
    name: 'e',
    hp,
    maxHp: hp,
    block: 0,
    strength: 0,
    debuffs: { vulnerable: 0, weak: 0, frail: 0 },
    poison: 0,
    patternIndex: 0,
  });
  const view = (hps: number[], incoming: number[]): StrategyView => {
    const enemies = hps.map(enemy);
    const intents = incoming.map((n, i) => ({
      moveId: `m${i}`,
      name: `m${i}`,
      attacks: n ? [{ damagePerHit: n, hits: 1 }] : [],
      totalIncoming: n,
    }));
    return {
      state: { turn: 1, player: {} as never, enemy: enemies[0]!, enemies },
      intent: combineIntents(intents, enemies),
      intents,
      playable: [],
    };
  };

  it('lowest HP first (the default), ties to the leftmost, dead enemies skipped', () => {
    expect(pickTarget(view([20, 8, 15], [0, 0, 0]))).toBe(1);
    expect(pickTarget(view([20, 8, 15], [0, 0, 0]), 'lowestHp')).toBe(1);
    expect(pickTarget(view([9, 9], [5, 7]), 'lowestHp')).toBe(0);
    expect(pickTarget(view([0, 12, 9], [0, 0, 0]), 'lowestHp')).toBe(2);
  });

  it('biggest incoming attack first, ties to lowest HP, then leftmost; dead skipped', () => {
    expect(pickTarget(view([20, 8, 15], [3, 2, 9]), 'biggestAttack')).toBe(2);
    expect(pickTarget(view([20, 8, 15], [5, 5, 0]), 'biggestAttack')).toBe(1);
    expect(pickTarget(view([10, 10], [0, 0]), 'biggestAttack')).toBe(0);
    expect(pickTarget(view([0, 12, 9], [99, 1, 0]), 'biggestAttack')).toBe(1);
  });

  it('no target with a single enemy', () => {
    expect(pickTarget(view([20], [3]), 'biggestAttack')).toBeUndefined();
  });

  it('each strategy uses its own priority in the same fight', () => {
    // a: 40 HP, hits for 9; b: 12 HP, hits for 1. Lowest HP aims at b; biggest attack aims at a.
    const data = world(attacker('a', 40, 9), attacker('b', 12, 1));
    const firstTarget = (target?: 'biggestAttack') => {
      const c = conf(['a', 'b'], [['strike', 5]], { strategy: { ...GREEDY_CONFIG, ...(target ? { target } : {}) } });
      const r = runCombat(data, c, { log: true });
      const hit = r.log!.findIndex((e) => e.t === 'damage' && e.target === 'enemy');
      const before = r.log!.slice(0, hit).filter((e): e is Extract<GameEvent, { t: 'target' }> => e.t === 'target');
      return before.at(-1)?.enemy ?? 0;
    };
    expect(firstTarget()).toBe(1);
    expect(firstTarget('biggestAttack')).toBe(0);
  });

  it('URL codes: a trailing "i" is biggest attack; old codes still parse to the default', () => {
    const big = { ...GREEDY_CONFIG, target: 'biggestAttack' as const };
    expect(strategyCode(GREEDY_CONFIG)).toBe('apb');
    expect(strategyCode(big)).toBe('apbi');
    expect(parseStrategyCode('apbi')).toEqual({
      order: ['attack', 'powers', 'block'],
      allowThrough: 0,
      target: 'biggestAttack',
    });
    expect(parseStrategyCode('b5pai')).toMatchObject({ allowThrough: 5, target: 'biggestAttack' });
    expect(parseStrategyCode('apb')!.target).toBeUndefined();
    for (const bad of ['gi', 'b5i', 'apbii', 'i']) expect(parseStrategyCode(bad)).toBeNull();
  });

  it('saved configs: absent or lowestHp is the default form; an unknown priority is invalid', () => {
    expect(normalizeConfig({ order: ['attack', 'powers', 'block'], allowThrough: 0 })).toEqual(GREEDY_CONFIG);
    expect(normalizeConfig({ ...GREEDY_CONFIG, target: 'lowestHp' })).toEqual(GREEDY_CONFIG);
    expect(normalizeConfig({ ...GREEDY_CONFIG, target: 'biggestAttack' })!.target).toBe('biggestAttack');
    expect(normalizeConfig({ ...GREEDY_CONFIG, target: 'leftmost' })).toBeNull();
  });
});

describe('#5 Monte Carlo', () => {
  it('runs pass enemyIds to every combat', () => {
    const data = world(makeEnemy('a', 6, wait()), makeEnemy('b', 999, wait()));
    const config: RunConfig = {
      characterId: 'ironclad',
      deck: deckOf(['defend', 5]),
      enemyId: 'a',
      enemyIds: ['a', 'b'],
      ascension: 0,
      strategies: [{ strategy: { id: 's', name: 's', config: GREEDY_CONFIG }, color: 'blue' }],
      runSeed: 1,
    };
    const [r] = runCombatRange(data, config, 0, 0, 1);
    expect(r!.outcome).toBe('turnCap');
    expect(r!.enemyHpRemaining).toBe(1005);
  });
});

describe('#5 with #262 Shiv cards', () => {
  it('Blade Dance, Leading Strike and their Shivs hit the strategy target (lowest HP)', () => {
    const data = world(makeEnemy('a', 120, wait()), makeEnemy('b', 99, wait()));
    for (const id of ['shiv', 'blade_dance', 'leading_strike', 'storm_of_steel']) data.cards[id] = gameData.cards[id]!;
    const c = conf(
      ['a', 'b'],
      [
        ['blade_dance', 2],
        ['leading_strike', 2],
        ['storm_of_steel', 1],
      ],
      {
        strategy: GREEDY_CONFIG,
        seed: 3,
      },
    );
    const r = runCombat(data, c, { log: true });
    const turn1 = r.log!.slice(
      0,
      r.log!.findIndex((e) => e.t === 'turnStart' && e.side === 'enemy'),
    );
    const hits = events(turn1, 'damage').filter((d) => d.target === 'enemy');
    expect(hits.length).toBeGreaterThan(0);
    // Every hit lands on b (index 1, the lowest HP) and the first target event says so.
    expect(events(turn1, 'target').map((t) => t.enemy)).toEqual([1]);
    expect(r.log!.find((e) => e.t === 'combatStart')).toMatchObject({ enemyHps: [120, 99] });
  });
});
