/** #4: opener moves and random (no-repeat) move patterns. */
import { describe, expect, it } from 'vitest';
import { runCombat, simulateCombat } from './combat';
import { resolveEnemy } from './enemy';
import { makeEnemy, makeGameData } from './testFixtures';
import { cfg, events, logged, passive, withEnemy } from './combatTestHelpers';
import type { CyclePattern, EnemyDef, MovePattern, Strategy } from './types';

const waitMoves = (...ids: string[]) =>
  Object.fromEntries(ids.map((id) => [id, { name: id.toUpperCase(), effects: [] }])) as EnemyDef['moves'];

/** A 999-HP enemy with harmless moves and the given pattern. */
function patterned(pattern: MovePattern, ids = ['x', 'y', 'a', 'b', 'c']): EnemyDef {
  return { ...makeEnemy('pat', 999, waitMoves(...ids)), pattern };
}

/** Move ids the enemy made over the first `turns` turns (a passive player survives them all). */
function moveSeq(e: EnemyDef, seed: number, turns = 12): string[] {
  const data = withEnemy(makeGameData(), e);
  const log = logged(data, passive, { enemyId: e.id, seed, deck: [] }).log;
  return events(log, 'enemyMove')
    .slice(0, turns)
    .map((m) => m.moveId);
}

describe('opener', () => {
  it('a cycle with an opener plays the opener once, then cycles from order[0]', () => {
    const e = patterned({ type: 'cycle', opener: ['x'], order: ['a', 'b'], start: 'first' });
    expect(moveSeq(e, 1, 6)).toEqual(['x', 'a', 'b', 'a', 'b', 'a']);
  });

  it('a multi-move opener plays in order', () => {
    const e = patterned({ type: 'cycle', opener: ['x', 'y'], order: ['a', 'b', 'c'], start: 'first' });
    expect(moveSeq(e, 1, 6)).toEqual(['x', 'y', 'a', 'b', 'c', 'a']);
  });

  it('with a random cycle start the opener still comes first, then the cycle from the rolled start', () => {
    const e = patterned({ type: 'cycle', opener: ['x'], order: ['a', 'b', 'c'], start: 'random' });
    const starts = new Set<string>();
    for (let s = 0; s < 40; s++) {
      const seq = moveSeq(e, s, 5);
      expect(seq[0]).toBe('x');
      const at = ['a', 'b', 'c'].indexOf(seq[1]!);
      expect(seq.slice(1)).toEqual([0, 1, 2, 3].map((k) => ['a', 'b', 'c'][(at + k) % 3]));
      starts.add(seq[1]!);
    }
    expect(starts.size).toBe(3);
  });

  it('an empty opener behaves like no opener', () => {
    const e = patterned({ type: 'cycle', opener: [], order: ['a', 'b'], start: 'first' });
    expect(moveSeq(e, 1, 3)).toEqual(['a', 'b', 'a']);
  });

  it('Ascension pattern overrides keep the opener and are not shared with the base definition', () => {
    const e = patterned({ type: 'cycle', opener: ['x'], order: ['a'], start: 'first' });
    const r = resolveEnemy(e, 0);
    expect(r.pattern).toEqual(e.pattern);
    (r.pattern as CyclePattern).opener!.push('y');
    expect((e.pattern as CyclePattern).opener).toEqual(['x']);
  });
});

describe('random pattern', () => {
  const random = (noRepeat: boolean, opener?: string[]): MovePattern => ({
    type: 'random',
    moves: ['a', 'b', 'c'],
    noRepeat,
    ...(opener ? { opener } : {}),
  });

  it('noRepeat never plays the same move twice in a row, and uses every move', () => {
    const seen = new Set<string>();
    for (let s = 0; s < 30; s++) {
      const seq = moveSeq(patterned(random(true)), s, 20);
      for (let i = 1; i < seq.length; i++) expect(seq[i]).not.toBe(seq[i - 1]);
      seq.forEach((id) => seen.add(id));
    }
    expect([...seen].sort()).toEqual(['a', 'b', 'c']);
  });

  it('the last opener move counts as the previous move for noRepeat', () => {
    const seconds = new Set<string>();
    for (let s = 0; s < 60; s++) {
      const seq = moveSeq(patterned(random(true, ['a'])), s, 10);
      expect(seq[0]).toBe('a');
      seconds.add(seq[1]!);
      for (let i = 1; i < seq.length; i++) expect(seq[i]).not.toBe(seq[i - 1]);
    }
    expect([...seconds].sort()).toEqual(['b', 'c']);
  });

  it('without noRepeat a move can repeat', () => {
    let repeats = 0;
    for (let s = 0; s < 20; s++) {
      const seq = moveSeq(patterned(random(false)), s, 20);
      for (let i = 1; i < seq.length; i++) if (seq[i] === seq[i - 1]) repeats++;
    }
    expect(repeats).toBeGreaterThan(0);
  });

  it('is seeded: same seed, same moves; different seeds differ', () => {
    const e = patterned(random(true, ['x']));
    expect(moveSeq(e, 7, 20)).toEqual(moveSeq(e, 7, 20));
    const all = new Set(Array.from({ length: 10 }, (_, s) => moveSeq(e, s, 20).join()));
    expect(all.size).toBeGreaterThan(1);
  });

  it('the intent the strategy sees is the move the enemy then makes', () => {
    const data = withEnemy(makeGameData(), patterned(random(true, ['x'])));
    const intents: string[] = [];
    const watcher: Strategy = {
      decide: (view) => {
        intents.push(view.intent.moveId);
        return { kind: 'endTurn' };
      },
    };
    const log = simulateCombat(data, cfg({ enemyId: 'pat', seed: 3, deck: [] }), watcher, { log: true }).log;
    const moves = events(log, 'enemyMove').map((m) => m.moveId);
    expect(intents.slice(0, moves.length)).toEqual(moves);
    expect(moves.length).toBeGreaterThan(10);
  });

  it('tracks movesMade and nextMoveId on the enemy state', () => {
    const data = withEnemy(makeGameData(), patterned(random(true, ['x'])));
    const states: { made: number | undefined; next: string | undefined; intent: string }[] = [];
    const watcher: Strategy = {
      decide: (view) => {
        const { enemy } = view.state;
        states.push({ made: enemy.movesMade, next: enemy.nextMoveId, intent: view.intent.moveId });
        return { kind: 'endTurn' };
      },
    };
    simulateCombat(data, cfg({ enemyId: 'pat', seed: 3, deck: [] }), watcher);
    expect(states[0]).toMatchObject({ made: 0, next: 'x', intent: 'x' });
    states.slice(0, 5).forEach((s, i) => {
      expect(s.made).toBe(i);
      expect(s.next).toBe(s.intent);
    });
  });

  it('rejects a noRepeat pattern with one move and unknown opener moves', () => {
    const one = patterned({ type: 'random', moves: ['a'], noRepeat: true });
    expect(() => runCombat(withEnemy(makeGameData(), one), cfg({ enemyId: 'pat' }))).toThrow(/at least 2 moves/);
    const bad = patterned({ type: 'cycle', opener: ['nope'], order: ['a'], start: 'first' });
    expect(() => runCombat(withEnemy(makeGameData(), bad), cfg({ enemyId: 'pat' }))).toThrow(/unknown move "nope"/);
    const empty = patterned({ type: 'random', moves: [], noRepeat: false });
    expect(() => runCombat(withEnemy(makeGameData(), empty), cfg({ enemyId: 'pat' }))).toThrow(/empty pattern/);
  });
});

describe('oncePerFight moves (#226)', () => {
  const once = (pattern: MovePattern, ids = ['roar', 'a', 'b']): EnemyDef => {
    const e = patterned(pattern, ids);
    e.moves.roar = { ...e.moves.roar!, oncePerFight: true };
    return e;
  };

  it('is used at most once over a long fight across many seeds, and the picker never stalls', () => {
    const e = once({ type: 'random', opener: ['a'], moves: ['roar', 'a', 'b'], noRepeat: true });
    for (let s = 0; s < 60; s++) {
      const seq = moveSeq(e, s, 40);
      expect(seq).toHaveLength(40);
      expect(seq.filter((m) => m === 'roar').length).toBeLessThanOrEqual(1);
      for (let i = 1; i < seq.length; i++) if (seq[i] === seq[i - 1]) throw new Error(`repeat at ${i}, seed ${s}`);
    }
  });

  it('with a two-move pool, once-move plus one other, the other repeats after the once-move is spent', () => {
    const e = once({ type: 'random', moves: ['roar', 'a'], noRepeat: true }, ['roar', 'a']);
    for (let s = 0; s < 30; s++) {
      const seq = moveSeq(e, s, 20);
      expect(seq).toHaveLength(20);
      expect(seq.filter((m) => m === 'roar').length).toBeLessThanOrEqual(1);
    }
  });

  it('survives Ascension resolution', () => {
    const e = once({ type: 'random', moves: ['roar', 'a'], noRepeat: true }, ['roar', 'a']);
    expect(resolveEnemy(e, 9).moves.roar?.oncePerFight).toBe(true);
  });
});
