/**
 * #276: Queen and Torch Head Amalgam (Act 3 boss): data, patterns, You're Mine's debuffs.
 * Interim: the Minion rule (win when the Queen dies), Chains of Binding / Bound, Burn Bright for Me's
 * Strength to the Amalgam and the Queen's pattern switch when the Amalgam dies wait for the contract.
 */
import { describe, expect, it } from 'vitest';
import { gameData } from '../data/index';
import { simulateCombat } from './combat';
import { cfg, events, logged, passive } from './combatTestHelpers';
import { makeGameData } from './testFixtures';
import type { GameData, Strategy } from './types';

const queenData = (): GameData => ({
  ...makeGameData(),
  enemies: {
    queen: gameData.enemies.queen!,
    torch_head_amalgam: gameData.enemies.torch_head_amalgam!,
  },
});

const intangible = { powers: { intangible: 999 } };

describe('#276 Queen and Torch Head Amalgam data', () => {
  it('Queen: Act 3 (Glory) boss, 400 HP (A8 419); Amalgam: Minion, 199 HP (A8 211)', () => {
    const q = gameData.enemies.queen!;
    const a = gameData.enemies.torch_head_amalgam!;
    expect(q).toMatchObject({ act: 3, zone: 'glory', difficulty: 'boss', hp: { min: 400, max: 400 } });
    expect(q.ascension['8']?.hp).toEqual({ min: 419, max: 419 });
    expect(a).toMatchObject({ act: 3, zone: 'glory', difficulty: 'minion', hp: { min: 199, max: 199 } });
    expect(a.ascension['8']?.hp).toEqual({ min: 211, max: 211 });
  });

  it('Queen moves: You are Mine 99 Frail/Weak/Vulnerable, 20 Block, Off with Your Head 3x5 (A9 4x5), Execution 15 (18), Enrage 2 Strength', () => {
    const m = gameData.enemies.queen!.moves;
    expect(m.youreMine!.effects).toEqual([
      { type: 'applyFrail', amount: 99 },
      { type: 'applyWeak', amount: 99 },
      { type: 'applyVulnerable', amount: 99 },
    ]);
    expect(m.burnBrightForMe!.effects).toEqual([{ type: 'gainBlock', amount: 20 }]);
    expect(m.offWithYourHead!.effects).toEqual([{ type: 'attack', damage: 3, hits: 5 }]);
    expect(m.execution!.effects).toEqual([{ type: 'attack', damage: 15, hits: 1 }]);
    expect(m.enrage!.effects).toEqual([{ type: 'gainStrength', amount: 2 }]);
    const a9 = gameData.enemies.queen!.ascension['9']!.moves!;
    expect(a9.offWithYourHead!.effects).toEqual([{ type: 'attack', damage: 4, hits: 5 }]);
    expect(a9.execution!.effects).toEqual([{ type: 'attack', damage: 18, hits: 1 }]);
  });

  it('Amalgam moves: Tackle 18 (A9 22), Beam 8x3, Weak Tackle 14 (16)', () => {
    const d = gameData.enemies.torch_head_amalgam!;
    expect(d.moves.tackle!.effects).toEqual([{ type: 'attack', damage: 18, hits: 1 }]);
    expect(d.moves.beam!.effects).toEqual([{ type: 'attack', damage: 8, hits: 3 }]);
    expect(d.moves.weakTackle!.effects).toEqual([{ type: 'attack', damage: 14, hits: 1 }]);
    const a9 = d.ascension['9']!.moves!;
    expect(a9.tackle!.effects).toEqual([{ type: 'attack', damage: 22, hits: 1 }]);
    expect(a9.weakTackle!.effects).toEqual([{ type: 'attack', damage: 16, hits: 1 }]);
  });
});

describe('#276 patterns', () => {
  it('Queen: Puppet Strings, You are Mine, then Burn Bright for Me; Amalgam: Tackle, Tackle, Beam, Weak Tackle, Weak Tackle', () => {
    const r = logged(queenData(), passive, {
      enemyId: 'queen',
      enemyIds: ['torch_head_amalgam', 'queen'],
      playerStart: intangible,
    });
    const moves = events(r.log, 'enemyMove').map((e) => e.moveId);
    const amalgam = ['tackle', 'beam', 'weakTackle'];
    expect(moves.filter((m) => !amalgam.includes(m)).slice(0, 5)).toEqual([
      'puppetStrings',
      'youreMine',
      'burnBrightForMe',
      'burnBrightForMe',
      'burnBrightForMe',
    ]);
    expect(moves.filter((m) => amalgam.includes(m)).slice(0, 10)).toEqual([
      'tackle',
      'tackle',
      'beam',
      'weakTackle',
      'weakTackle',
      'tackle',
      'tackle',
      'beam',
      'weakTackle',
      'weakTackle',
    ]);
  });

  it("You're Mine puts 99 Frail, 99 Weak and 99 Vulnerable on the player", () => {
    let seen: { vulnerable: number; weak: number; frail: number } | undefined;
    const watcher: Strategy = {
      decide(view) {
        if (view.state.turn === 3 && !seen) seen = { ...view.state.player.debuffs };
        return { kind: 'endTurn' };
      },
    };
    simulateCombat(queenData(), cfg({ enemyId: 'queen', playerStart: intangible }), watcher);
    // Applied on turn 2's enemy move; player debuffs tick down by 1 at the end of each player turn.
    expect(seen).toEqual({ vulnerable: 99, weak: 99, frail: 99 });
  });
});
