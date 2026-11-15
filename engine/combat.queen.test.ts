/**
 * #276: Queen and Torch Head Amalgam (Act 3 boss): data, patterns, Burn Bright for Me's Strength to the Amalgam,
 * the Queen's switch when the Amalgam dies, the Minion rule (the fight is won when the Queen dies) and
 * Chains of Binding / Bound (only 1 Bound card per turn, un-Bound at the end of the turn).
 */
import { describe, expect, it } from 'vitest';
import { gameData } from '../data/index';
import { simulateCombat } from './combat';
import { cfg, deckOf, events, logged, passive, withEnemy } from './combatTestHelpers';
import { makeEnemy, makeGameData } from './testFixtures';
import type { EnemyDef, GameData, Strategy, StrategyView } from './types';

const queenData = (amalgamHp?: number, queenHp?: number): GameData => {
  const amalgam = gameData.enemies.torch_head_amalgam!;
  const queen = gameData.enemies.queen!;
  return {
    ...makeGameData(),
    enemies: {
      queen: queenHp ? { ...queen, hp: { min: queenHp, max: queenHp } } : queen,
      torch_head_amalgam: amalgamHp ? { ...amalgam, hp: { min: amalgamHp, max: amalgamHp } } : amalgam,
    },
  };
};

/** The real encounter: the Amalgam stands left (acts first), the Queen right (Trent). */
const fight = { enemyId: 'torch_head_amalgam', enemyIds: ['torch_head_amalgam', 'queen'] };
const intangible = { powers: { intangible: 999 } };
const AMALGAM_MOVES = ['tackle', 'beam', 'weakTackle'];
const queenMoves = (log: Parameters<typeof events>[0]) =>
  events(log, 'enemyMove')
    .map((e) => e.moveId)
    .filter((m) => !AMALGAM_MOVES.includes(m));

/** Plays every playable Strike at enemy `target` on turn `onTurn` (every turn when omitted); otherwise ends the turn. */
const strikeAt = (target: number, onTurn?: number): Strategy => ({
  decide(view) {
    if (onTurn !== undefined && view.state.turn !== onTurn) return { kind: 'endTurn' };
    const c = view.playable.find((p) => p.cardId === 'strike');
    return c ? { kind: 'play', uid: c.uid, target } : { kind: 'endTurn' };
  },
});

describe('#276 Queen and Torch Head Amalgam data', () => {
  it('Queen: Act 3 (Glory) boss, 400 HP (A8 419); Amalgam: 199 HP (A8 211) with the Minion power', () => {
    const q = gameData.enemies.queen!;
    const a = gameData.enemies.torch_head_amalgam!;
    expect(q).toMatchObject({ act: 3, zone: 'glory', difficulty: 'boss', hp: { min: 400, max: 400 } });
    expect(q.ascension['8']?.hp).toEqual({ min: 419, max: 419 });
    expect(a).toMatchObject({ act: 3, zone: 'glory', difficulty: 'minion', hp: { min: 199, max: 199 } });
    expect(a.ascension['8']?.hp).toEqual({ min: 211, max: 211 });
    expect(a.startPowers).toEqual({ minion: 1 });
  });

  it('Queen moves: Puppet Strings 3 Chains of Binding, You are Mine 99 Frail/Weak/Vulnerable, Burn Bright for Me, Off with Your Head 3x5 (A9 4x5), Execution 15 (18), Enrage 2', () => {
    const m = gameData.enemies.queen!.moves;
    expect(m.puppetStrings!.effects).toEqual([{ type: 'applyPower', power: 'chainsOfBinding', amount: 3 }]);
    expect(m.youreMine!.effects).toEqual([
      { type: 'applyFrail', amount: 99 },
      { type: 'applyWeak', amount: 99 },
      { type: 'applyVulnerable', amount: 99 },
    ]);
    expect(m.burnBrightForMe!.effects).toEqual([
      { type: 'enemyGainStrength', amount: 1, ally: 'torch_head_amalgam' },
      { type: 'gainBlock', amount: 20 },
    ]);
    expect(m.offWithYourHead!.effects).toEqual([{ type: 'attack', damage: 3, hits: 5 }]);
    expect(m.execution!.effects).toEqual([{ type: 'attack', damage: 15, hits: 1 }]);
    expect(m.enrage!.effects).toEqual([{ type: 'gainStrength', amount: 2 }]);
    const a9 = gameData.enemies.queen!.ascension['9']!.moves!;
    expect(a9.offWithYourHead!.effects).toEqual([{ type: 'attack', damage: 4, hits: 5 }]);
    expect(a9.execution!.effects).toEqual([{ type: 'attack', damage: 18, hits: 1 }]);
    expect(gameData.enemies.queen!.onAllyDeath).toEqual({
      allyId: 'torch_head_amalgam',
      pattern: { type: 'cycle', order: ['offWithYourHead', 'execution', 'enrage'], start: 'first', opener: ['enrage'] },
    });
  });

  it('Amalgam moves: Tackle 18 (A9 22), Beam 8x3, Weak Tackle 14 (16); no Strong Tackle (beta V0.109.0)', () => {
    const d = gameData.enemies.torch_head_amalgam!;
    expect(Object.keys(d.moves).sort()).toEqual(['beam', 'tackle', 'weakTackle']);
    expect(d.moves.tackle!.effects).toEqual([{ type: 'attack', damage: 18, hits: 1 }]);
    expect(d.moves.beam!.effects).toEqual([{ type: 'attack', damage: 8, hits: 3 }]);
    expect(d.moves.weakTackle!.effects).toEqual([{ type: 'attack', damage: 14, hits: 1 }]);
    const a9 = d.ascension['9']!.moves!;
    expect(a9.tackle!.effects).toEqual([{ type: 'attack', damage: 22, hits: 1 }]);
    expect(a9.weakTackle!.effects).toEqual([{ type: 'attack', damage: 16, hits: 1 }]);
  });
});

describe('#276 patterns while the Amalgam lives', () => {
  it('Queen: Puppet Strings, You are Mine, then Burn Bright for Me; Amalgam: Tackle, Tackle, Beam, Weak Tackle, Weak Tackle', () => {
    const r = logged(queenData(), passive, { ...fight, playerStart: intangible });
    expect(queenMoves(r.log).slice(0, 5)).toEqual([
      'puppetStrings',
      'youreMine',
      'burnBrightForMe',
      'burnBrightForMe',
      'burnBrightForMe',
    ]);
    const amalgam = events(r.log, 'enemyMove')
      .map((e) => e.moveId)
      .filter((m) => AMALGAM_MOVES.includes(m));
    const cycle = ['tackle', 'tackle', 'beam', 'weakTackle', 'weakTackle'];
    expect(amalgam.slice(0, 10)).toEqual([...cycle, ...cycle]);
  });

  it("You're Mine puts 99 Frail, 99 Weak and 99 Vulnerable on the player", () => {
    let seen: { vulnerable: number; weak: number; frail: number } | undefined;
    const watcher: Strategy = {
      decide(view) {
        if (view.state.turn === 3 && !seen) seen = { ...view.state.player.debuffs };
        return { kind: 'endTurn' };
      },
    };
    simulateCombat(queenData(), cfg({ ...fight, playerStart: intangible }), watcher);
    expect(seen).toEqual({ vulnerable: 99, weak: 99, frail: 99 });
  });

  it('Burn Bright for Me gives the Amalgam 1 Strength and the Queen 20 Block each turn', () => {
    const seen: { amalgam: number; queen: number; block: number }[] = [];
    const watcher: Strategy = {
      decide(view) {
        const [a, q] = view.state.enemies!;
        if (seen.length < view.state.turn) seen.push({ amalgam: a!.strength, queen: q!.strength, block: q!.block });
        return { kind: 'endTurn' };
      },
    };
    simulateCombat(queenData(), cfg({ ...fight, playerStart: intangible }), watcher);
    // Turns 3, 4, 5 follow Burn Bright on enemy turns 3, 4 (the Queen's Block resets at her own turn start).
    expect(seen.slice(0, 6).map((s) => s.amalgam)).toEqual([0, 0, 0, 1, 2, 3]);
    expect(seen.slice(0, 6).map((s) => s.queen)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(seen[3]!.block).toBe(20);
  });
});

describe('#276 the Queen when the Amalgam dies', () => {
  it('killed while her intent is Burn Bright for Me: the intent becomes Enrage at once, then Off with Your Head, Execution, Enrage', () => {
    let intentAfterKill: string | undefined;
    const killer: Strategy = {
      decide(view: StrategyView) {
        if (view.state.turn !== 4) return { kind: 'endTurn' };
        if (view.state.enemies![0]!.hp <= 0) {
          intentAfterKill ??= view.intents![1]!.moveId;
          return { kind: 'endTurn' };
        }
        const c = view.playable.find((p) => p.cardId === 'strike');
        return c ? { kind: 'play', uid: c.uid, target: 0 } : { kind: 'endTurn' };
      },
    };
    const r = simulateCombat(
      queenData(6),
      cfg({ ...fight, playerStart: intangible, deck: deckOf(['strike', 10]) }),
      killer,
      { log: true },
    );
    expect(intentAfterKill).toBe('enrage');
    expect(queenMoves(r.log).slice(0, 8)).toEqual([
      'puppetStrings',
      'youreMine',
      'burnBrightForMe',
      'enrage',
      'offWithYourHead',
      'execution',
      'enrage',
      'offWithYourHead',
    ]);
  });

  it('killed on turn 2 or earlier: she finishes her opener, then Off with Your Head with no Enrage first', () => {
    const turn2 = simulateCombat(
      queenData(6),
      cfg({ ...fight, playerStart: intangible, deck: deckOf(['strike', 10]) }),
      strikeAt(0, 2),
      { log: true },
    );
    expect(queenMoves(turn2.log).slice(0, 5)).toEqual([
      'puppetStrings',
      'youreMine',
      'offWithYourHead',
      'execution',
      'enrage',
    ]);
    const turn1 = simulateCombat(
      queenData(6),
      cfg({ ...fight, playerStart: intangible, deck: deckOf(['strike', 10]) }),
      strikeAt(0, 1),
      { log: true },
    );
    expect(queenMoves(turn1.log).slice(0, 4)).toEqual(['puppetStrings', 'youreMine', 'offWithYourHead', 'execution']);
  });

  it('Enrage gives the Queen 2 Strength', () => {
    const r = simulateCombat(
      queenData(6),
      cfg({ ...fight, playerStart: intangible, deck: deckOf(['strike', 10]) }),
      strikeAt(0, 4),
      { log: true },
    );
    expect(events(r.log, 'strength').filter((e) => e.amount === 2)[0]).toMatchObject({ side: 'enemy', total: 2 });
  });
});

describe('#276 Minion rule', () => {
  const wait = { wait: { name: 'Wait', effects: [] } };
  const leader = (hp: number): EnemyDef => makeEnemy('leader', hp, wait);
  const minion = (hp: number): EnemyDef => ({ ...makeEnemy('minion', hp, wait), startPowers: { minion: 1 } });
  const both = { enemyId: 'minion', enemyIds: ['minion', 'leader'], deck: deckOf(['strike', 10]) };

  it('the fight is won when every non-Minion enemy is dead, with the Minion still alive', () => {
    const r = simulateCombat(withEnemy(makeGameData(), leader(12), minion(500)), cfg(both), strikeAt(1));
    expect(r.outcome).toBe('win');
    expect(r.turns).toBe(1);
  });

  it('killing the Minion alone does not end the fight', () => {
    const r = simulateCombat(withEnemy(makeGameData(), leader(999), minion(6)), cfg(both), strikeAt(0));
    // Turn 1 kills the Minion; the Strikes then fall back to the 999-HP leader, which takes many turns.
    expect(r.turns).toBeGreaterThan(1);
  });

  it('a fight of Minions only is won when they are all dead', () => {
    const r = simulateCombat(
      withEnemy(makeGameData(), minion(6)),
      cfg({ enemyId: 'minion', deck: deckOf(['strike', 10]) }),
      strikeAt(0),
    );
    expect(r.outcome).toBe('win');
  });

  it('difficulty "minion" alone (Wriggler) is not the Minion power', () => {
    const plain = { ...makeEnemy('minion', 500, wait), difficulty: 'minion' as const };
    const r = simulateCombat(withEnemy(makeGameData(), leader(12), plain), cfg(both), strikeAt(1));
    expect(r.turns).toBeGreaterThan(1);
  });

  it('Queen fight: killing the Queen wins with the Amalgam alive', () => {
    const r = simulateCombat(queenData(undefined, 6), cfg({ ...fight, deck: deckOf(['strike', 10]) }), strikeAt(1));
    expect(r.outcome).toBe('win');
    expect(r.turns).toBe(1);
  });
});

describe('#276 Chains of Binding and Bound', () => {
  const chains = (amount: number) => ({ powers: { chainsOfBinding: amount, intangible: 999 } });
  const dummyData = () => withEnemy(makeGameData(), makeEnemy('dummy', 999, { wait: { name: 'Wait', effects: [] } }));
  const base = { enemyId: 'dummy', deck: deckOf(['strike', 10]) };

  it('binds the first 3 cards drawn each turn; after one Bound card is played the other Bound cards are unplayable', () => {
    const turns: { bound: number; playable: number; afterBound: number; boundOff: number }[] = [];
    let played = 0;
    const s: Strategy = {
      decide(view) {
        const hand = view.state.player.hand;
        if (played === 0) {
          turns.push({
            bound: hand.filter((c) => c.bound).length,
            playable: view.playable.length,
            afterBound: -1,
            // Cards outside the hand carry no Bound from earlier turns.
            boundOff: [...view.state.player.discardPile, ...view.state.player.drawPile].filter((c) => c.bound).length,
          });
          const b = view.playable.find((c) => c.bound)!;
          played = 1;
          return { kind: 'play', uid: b.uid };
        }
        if (played === 1) {
          turns[turns.length - 1]!.afterBound = view.playable.filter((c) => c.bound).length;
          played = 2;
        }
        const c = view.playable[0];
        if (c) return { kind: 'play', uid: c.uid };
        played = 0;
        return { kind: 'endTurn' };
      },
    };
    simulateCombat(dummyData(), cfg({ ...base, playerStart: chains(3) }), s);
    for (const t of turns.slice(0, 3)) {
      expect(t).toEqual({ bound: 3, playable: 5, afterBound: 0, boundOff: 0 });
    }
  });

  it('counts every draw of the turn: with Chains of Binding 7 all 5 cards of the turn draw are Bound', () => {
    let bound = -1;
    const s: Strategy = {
      decide(view) {
        if (bound < 0) bound = view.state.player.hand.filter((c) => c.bound).length;
        return { kind: 'endTurn' };
      },
    };
    simulateCombat(dummyData(), cfg({ ...base, playerStart: chains(7) }), s);
    expect(bound).toBe(5);
  });

  it('flags Bound draws in the event log (#383)', () => {
    const r = simulateCombat(dummyData(), cfg({ ...base, playerStart: chains(2) }), passive, { log: true });
    const first = events(r.log, 'draw').slice(0, 5);
    expect(first.map((e) => e.t === 'draw' && e.bound === true)).toEqual([true, true, false, false, false]);
  });

  it('playing a second Bound card in the same turn is illegal', () => {
    const s: Strategy = {
      decide(view) {
        const b = view.state.player.hand.filter((c) => c.bound);
        return { kind: 'play', uid: b[0]!.uid };
      },
    };
    expect(() => simulateCombat(dummyData(), cfg({ ...base, playerStart: chains(3) }), s)).toThrow(/illegal card/);
  });

  it('no Bound cards without Chains of Binding', () => {
    let bound = -1;
    const s: Strategy = {
      decide(view) {
        if (bound < 0) bound = view.state.player.hand.filter((c) => c.bound).length;
        return { kind: 'endTurn' };
      },
    };
    simulateCombat(dummyData(), cfg({ ...base, playerStart: intangible }), s);
    expect(bound).toBe(0);
  });
});
