/** #271: Knowledge Demon (first Act 2 boss) and the enemy heal (capped at the enemy's Max HP, Trent). */
import { describe, expect, it } from 'vitest';
import { gameData } from '../data/index';
import { simulateCombat } from './combat';
import { cfg, deckOf, events, logged, withEnemy } from './combatTestHelpers';
import { makeEnemy, makeGameData } from './testFixtures';
import type { GameData, Strategy } from './types';

/** Plays every playable Strike each turn and records the enemy's HP at the start of each player turn. */
function strikerWithHp(): { strategy: Strategy; hps: number[] } {
  const hps: number[] = [];
  let turn = -1;
  return {
    hps,
    strategy: {
      decide(view) {
        if (view.state.turn !== turn) {
          turn = view.state.turn;
          hps.push(view.state.enemy.hp);
        }
        const c = view.playable.find((p) => p.cardId === 'strike');
        return c ? { kind: 'play', uid: c.uid } : { kind: 'endTurn' };
      },
    },
  };
}

const demonData = (): GameData => ({
  ...makeGameData(),
  enemies: { knowledge_demon: gameData.enemies.knowledge_demon! },
});

describe('#271 enemy heal', () => {
  it('an enemy move heal restores the acting enemy, capped at its Max HP', () => {
    const healer = makeEnemy('healer', 50, { mend: { name: 'Mend', effects: [{ type: 'heal', amount: 10 }] } });
    const { strategy, hps } = strikerWithHp();
    const data = withEnemy(makeGameData(), healer);
    simulateCombat(data, cfg({ enemyId: 'healer', deck: deckOf(['strike', 10]) }), strategy);
    // Turn 1: 3 Strikes (18) → 32, heal 10 → 42. Turn 2: 3 Strikes → 24, heal → 34.
    expect(hps.slice(0, 3)).toEqual([50, 42, 34]);
    // A heal bigger than the damage taken stops at Max HP.
    const big = makeEnemy('bigHealer', 50, { mend: { name: 'Mend', effects: [{ type: 'heal', amount: 30 }] } });
    const b = strikerWithHp();
    simulateCombat(
      withEnemy(makeGameData(), big),
      cfg({ enemyId: 'bigHealer', deck: deckOf(['strike', 10]) }),
      b.strategy,
    );
    expect(b.hps.slice(0, 3)).toEqual([50, 50, 50]);
  });
});

describe('#271 Knowledge Demon data', () => {
  it('is an Act 2 (Hive) boss with 379 HP (A8 399)', () => {
    const d = gameData.enemies.knowledge_demon!;
    expect(d).toMatchObject({ act: 2, zone: 'hive', difficulty: 'boss', hp: { min: 379, max: 379 } });
    expect(d.ascension['8']?.hp).toEqual({ min: 399, max: 399 });
  });

  it('uses Curse of Knowledge three times, each followed by Slap, Knowledge Overwhelming, Ponder; then cycles those three', () => {
    const r = logged(
      demonData(),
      { decide: () => ({ kind: 'endTurn' }) },
      {
        enemyId: 'knowledge_demon',
        playerStart: { powers: { intangible: 999 } },
      },
    );
    const moves = events(r.log, 'enemyMove')
      .slice(0, 18)
      .map((e) => e.moveId);
    const cyc = ['slap', 'knowledgeOverwhelming', 'ponder'];
    expect(moves).toEqual([
      'curseOfKnowledge1',
      ...cyc,
      'curseOfKnowledge2',
      ...cyc,
      'curseOfKnowledge3',
      ...cyc,
      ...cyc,
      ...cyc,
    ]);
  });

  it('base and A9 move numbers: Slap 17 (18), Knowledge Overwhelming 8x3 (9x3), Ponder 11 (13) + heal 30 + 2 (3) Strength', () => {
    const d = gameData.enemies.knowledge_demon!;
    expect(d.moves.slap!.effects).toEqual([{ type: 'attack', damage: 17, hits: 1 }]);
    expect(d.moves.knowledgeOverwhelming!.effects).toEqual([{ type: 'attack', damage: 8, hits: 3 }]);
    expect(d.moves.ponder!.effects).toEqual([
      { type: 'attack', damage: 11, hits: 1 },
      { type: 'heal', amount: 30 },
      { type: 'gainStrength', amount: 2 },
    ]);
    const a9 = d.ascension['9']!.moves!;
    expect(a9.slap!.effects).toEqual([{ type: 'attack', damage: 18, hits: 1 }]);
    expect(a9.knowledgeOverwhelming!.effects).toEqual([{ type: 'attack', damage: 9, hits: 3 }]);
    expect(a9.ponder!.effects).toEqual([
      { type: 'attack', damage: 13, hits: 1 },
      { type: 'heal', amount: 30 },
      { type: 'gainStrength', amount: 3 },
    ]);
  });

  it('Ponder heals the Demon (never above 379) and the Curse puts Disintegration on the player (interim option)', () => {
    const { strategy, hps } = strikerWithHp();
    const r = simulateCombat(
      demonData(),
      cfg({ enemyId: 'knowledge_demon', deck: deckOf(['strike', 10]), playerStart: { powers: { intangible: 999 } } }),
      strategy,
      { log: true },
    );
    // 18 damage a turn: 361, 343, 325; on turn 4 the Strikes take it to 307, then Ponder heals 30 → 337.
    expect(hps.slice(0, 6)).toEqual([379, 361, 343, 325, 337, 319]);
    expect(Math.max(...hps)).toBeLessThanOrEqual(379);
    expect(events(r.log, 'powerApplied').find((e) => e.power === 'disintegration')).toMatchObject({
      side: 'player',
      power: 'disintegration',
      amount: 6,
    });
  });
});
