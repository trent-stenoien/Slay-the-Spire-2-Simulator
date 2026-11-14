/** #322: spawnEnemies / onDeath, weighted random picks, noRepeatMoves, startBySlot. */
import { describe, expect, it } from 'vitest';
import { combatEnemyIds } from './combat';
import { cfg, deckOf, events, logged, passive, scripted, withEnemy } from './combatTestHelpers';
import { cards, makeEnemy, makeGameData } from './testFixtures';
import type { CardDef, Effect, EnemyDef, GameData, GameEvent, MovePattern } from './types';

const hit = (damage: number, hits = 1, extra: Partial<Extract<Effect, { type: 'attack' }>> = {}): Effect => ({
  type: 'attack',
  damage,
  hits,
  ...extra,
});
const card = (id: string, effects: Effect[], type: CardDef['type'] = 'attack'): CardDef => ({
  ...cards.strike!,
  id,
  code: id.slice(0, 2),
  name: id,
  type,
  cost: 0,
  effects,
  upgraded: null,
});

/** `mother` (hp 6, never acts) summons 2 Stunned `kid`s (hp 20, Bite 3) when she dies. */
function world(motherHp = 6): GameData {
  const data = makeGameData();
  data.cards.zap = card('zap', [hit(6)]);
  data.cards.sweep = card('sweep', [hit(6), hit(4, 1, { allEnemies: true }), hit(1, 6, { randomTarget: true })]);
  data.cards.toxin = card('toxin', [{ type: 'applyPoison', amount: 5 }], 'skill');
  const mother = makeEnemy('mother', motherHp, { wait: { name: 'Wait', effects: [] } });
  mother.onDeath = [{ type: 'spawnEnemies', enemyId: 'kid', count: 2, stunned: true }];
  const kid = makeEnemy('kid', 20, { bite: { name: 'Bite', effects: [hit(3)] } });
  kid.hp = { min: 5, max: 5 };
  return withEnemy(data, mother, kid);
}

/** Events of each enemy phase, in order. */
function enemyRounds(log: GameEvent[]): GameEvent[][] {
  const rounds: GameEvent[][] = [];
  let into = false;
  for (const e of log) {
    if (e.t === 'turnStart') {
      into = e.side === 'enemy';
      if (into) rounds.push([]);
    } else if (into) rounds[rounds.length - 1]!.push(e);
  }
  return rounds;
}
const count = (round: GameEvent[] | undefined, t: GameEvent['t']) => (round ?? []).filter((e) => e.t === t).length;

describe('spawnEnemies / onDeath (#322)', () => {
  it('a kill on the player turn spawns the enemies; the Stunned ones skip that enemy phase, then bite; combat is won only when all are dead', () => {
    const r = logged(
      world(),
      scripted((t) => (t === 1 ? ['zap'] : t === 3 ? ['zap', 'zap'] : [])),
      {
        enemyId: 'mother',
        deck: deckOf(['zap', 10]),
      },
    );
    expect(r.outcome).toBe('win');
    expect(r.turns).toBe(3);
    const rounds = enemyRounds(r.log!);
    expect(count(rounds[0], 'enemySkip')).toBe(2);
    expect(count(rounds[0], 'enemyMove')).toBe(0);
    expect(count(rounds[1], 'enemyMove')).toBe(2);
    // Two Bites of 3 in round 2 only.
    expect(r.hpLost).toBe(6);
    expect(r.enemyHpRemaining).toBe(0);
  });

  it('the new enemies are appended on the right with seeded HP and the line-up is visible to targeting', () => {
    const data = world();
    data.enemies.kid!.hp = { min: 5, max: 9 };
    const seen: number[][] = [];
    const spy = scripted((t) => (t === 1 ? ['zap'] : []));
    const strategy = {
      ...spy,
      decide(view: Parameters<typeof spy.decide>[0]) {
        seen.push((view.state.enemies ?? []).map((e) => e.hp));
        return spy.decide(view);
      },
    };
    const run = () =>
      logged(data, strategy, { enemyId: 'mother', deck: deckOf(['zap', 10]), seed: 4, ascension: 0 }).turns;
    run();
    const first = seen.splice(0);
    // After the kill: mother 0, then two kids with HP rolled in 5..9, same on a second run.
    const after = first.find((hps) => hps.length === 3)!;
    expect(after[0]).toBe(0);
    expect(after.slice(1).every((hp) => hp >= 5 && hp <= 9)).toBe(true);
    run();
    expect(seen.find((hps) => hps.length === 3)).toEqual(after);
  });

  it('spawned enemies take the rest of the card: all-enemy and random-target effects see them', () => {
    const data = world();
    data.enemies.kid!.hp = { min: 20, max: 20 };
    const r = logged(
      data,
      scripted((t) => (t === 1 ? ['sweep'] : [])),
      { enemyId: 'mother', deck: deckOf(['sweep', 10]) },
    );
    const loss = events(r.log, 'damage')
      .filter((d) => d.target === 'enemy')
      .reduce((n, d) => n + d.hpLoss, 0);
    // 6 kills mother, 4 + 4 on the kids, then 6 random 1-damage hits on the kids.
    expect(loss).toBe(6 + 8 + 6);
  });

  it('a Poison kill in the enemy phase still spawns; the new enemies take no turn that round and are Stunned the next', () => {
    const r = logged(
      world(5),
      scripted((t) => (t === 1 ? ['toxin'] : [])),
      {
        enemyId: 'mother',
        deck: deckOf(['toxin', 10]),
      },
    );
    const rounds = enemyRounds(r.log!);
    expect(count(rounds[0], 'poisonDamage')).toBe(1);
    expect(count(rounds[0], 'enemySkip') + count(rounds[0], 'enemyMove')).toBe(0);
    expect(count(rounds[1], 'enemySkip')).toBe(2);
    expect(count(rounds[1], 'enemyMove')).toBe(0);
    expect(count(rounds[2], 'enemyMove')).toBe(2);
  });

  it('an enemy move can spawn too (not Stunned), and combat does not end while a spawned enemy lives', () => {
    const data = world();
    const caller = makeEnemy('caller', 30, {
      call: { name: 'Call', effects: [{ type: 'spawnEnemies', enemyId: 'kid', count: 1 }] },
    });
    withEnemy(data, caller);
    const r = logged(data, passive, { enemyId: 'caller', deck: deckOf(['zap', 10]) });
    const rounds = enemyRounds(r.log!);
    expect(count(rounds[0], 'enemyMove')).toBe(1);
    // Round 2: the caller calls again, the first kid bites.
    expect(count(rounds[1], 'enemyMove')).toBe(2);
  });

  it('no Rng draw changes without onDeath: results match a combat whose enemies cannot spawn', () => {
    const plain = world();
    delete plain.enemies.mother!.onDeath;
    const a = logged(plain, passive, { enemyId: 'mother', seed: 3 });
    const b = logged(world(), passive, { enemyId: 'mother', seed: 3 });
    expect(a.log!.length).toBe(b.log!.length);
  });

  it('combatEnemyIds is unchanged (spawns are not part of the setup)', () => {
    expect(combatEnemyIds(cfg({ enemyId: 'mother' }))).toEqual(['mother']);
  });
});

const waitMoves = (...ids: string[]) =>
  Object.fromEntries(ids.map((id) => [id, { name: id, effects: [] }])) as EnemyDef['moves'];
const patterned = (pattern: MovePattern): EnemyDef => ({
  ...makeEnemy('pat', 999, waitMoves('a', 'b', 'x', 'y')),
  pattern,
});
function moveSeq(e: EnemyDef, seed: number, turns: number, enemies = 1): string[][] {
  const data = withEnemy(makeGameData(), e);
  const log = logged(data, passive, { enemyId: e.id, enemyIds: Array(enemies).fill(e.id), seed, deck: [] }).log!;
  const per: string[][] = Array.from({ length: enemies }, () => []);
  let current = 0;
  for (const ev of log) {
    if (ev.t === 'target') current = ev.enemy;
    if (ev.t === 'enemyMove') per[current]!.push(ev.moveId);
  }
  return per.map((s) => s.slice(0, turns));
}

describe('RandomPattern weights / noRepeatMoves (#322)', () => {
  const twig = patterned({
    type: 'random',
    opener: ['b'],
    moves: ['a', 'b'],
    noRepeat: true,
    noRepeatMoves: ['b'],
    weights: { a: 2, b: 1 },
  });

  it('only the listed move may not repeat; the other repeats; the opener counts as the previous move', () => {
    let aa = 0;
    for (let s = 0; s < 60; s++) {
      const seq = moveSeq(twig, s, 12)[0]!;
      expect(seq[0]).toBe('b');
      expect(seq[1]).toBe('a');
      for (let i = 1; i < seq.length; i++) {
        expect(seq[i] === 'b' && seq[i - 1] === 'b').toBe(false);
        if (seq[i] === 'a' && seq[i - 1] === 'a') aa++;
      }
    }
    expect(aa).toBeGreaterThan(0);
  });

  it('weights skew the picks about 2:1 and are seeded', () => {
    const e = patterned({ type: 'random', moves: ['a', 'b'], noRepeat: false, weights: { a: 2, b: 1 } });
    expect(moveSeq(e, 5, 10)).toEqual(moveSeq(e, 5, 10));
    let a = 0;
    let total = 0;
    for (let s = 0; s < 300; s++)
      for (const m of moveSeq(e, s, 10)[0]!) {
        total++;
        if (m === 'a') a++;
      }
    expect(a / total).toBeGreaterThan(0.6);
    expect(a / total).toBeLessThan(0.73);
  });

  it('a move left out of weights has weight 1', () => {
    const e = patterned({ type: 'random', moves: ['a', 'b'], noRepeat: false, weights: { a: 9 } });
    const all = new Set<string>();
    for (let s = 0; s < 100; s++) moveSeq(e, s, 6)[0]!.forEach((m) => all.add(m));
    expect(all).toEqual(new Set(['a', 'b']));
  });
});

describe('CyclePattern startBySlot (#322)', () => {
  const wriggler = patterned({
    type: 'cycle',
    order: ['a', 'b'],
    start: 'first',
    startBySlot: { odd: 'a', even: 'b' },
  });

  it('1st and 3rd enemies of the same id start with odd, 2nd and 4th with even, then the cycle continues from there', () => {
    const [one, two, three, four] = moveSeq(wriggler, 1, 4, 4);
    expect(one).toEqual(['a', 'b', 'a', 'b']);
    expect(two).toEqual(['b', 'a', 'b', 'a']);
    expect(three).toEqual(one);
    expect(four).toEqual(two);
  });

  it('a lone enemy is slot 1, and it uses no Rng draw (same moves as start: first)', () => {
    expect(moveSeq(wriggler, 9, 4)[0]).toEqual(['a', 'b', 'a', 'b']);
  });

  it('spawned enemies count by id: Wrigglers from Phrog Parasite alternate Bite / Wriggle', () => {
    const data = world();
    data.enemies.mother!.onDeath = [{ type: 'spawnEnemies', enemyId: 'wr', count: 3, stunned: true }];
    const wr = makeEnemy('wr', 50, waitMoves('a', 'b'));
    wr.pattern = { type: 'cycle', order: ['a', 'b'], start: 'first', startBySlot: { odd: 'a', even: 'b' } };
    withEnemy(data, wr);
    const r = logged(
      data,
      scripted((t) => (t === 1 ? ['zap'] : [])),
      { enemyId: 'mother', deck: deckOf(['zap', 10]) },
    );
    // #329: the arrival Stun skips the turn but does not use up the opener: round 2 opens a, b, a (slots 1, 2, 3).
    const moves = (round: number) =>
      enemyRounds(r.log!)
        [round]!.filter((e) => e.t === 'enemyMove')
        .map((e) => (e as Extract<GameEvent, { t: 'enemyMove' }>).moveId);
    expect(moves(1)).toEqual(['a', 'b', 'a']);
    expect(moves(2)).toEqual(['b', 'a', 'b']);
  });
});
