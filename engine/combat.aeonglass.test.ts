/**
 * #273: Aeonglass (Act 3 boss): data, cycle, Withering Presence, Increasing Intensity's X (move uses before this
 * one), Wither upgrade levels (+3 damage per level) and "upgrade all Withers" (raise to at least level X).
 */
import { describe, expect, it } from 'vitest';
import { gameData } from '../data/index';
import { makeCardInstance, simulateCombat } from './combat';
import { cfg, deckOf, events, logged, withEnemy } from './combatTestHelpers';
import { makeEnemy, makeGameData } from './testFixtures';
import type { CardInstance, GameData, Strategy, StrategyView } from './types';

const glassData = (): GameData => {
  const base = makeGameData();
  return {
    ...base,
    cards: { ...base.cards, wither: gameData.cards.wither! },
    enemies: { aeonglass: gameData.enemies.aeonglass! },
  };
};

const withers = (s: StrategyView['state']): readonly { cardId: string; upgraded: boolean; upgradeLevel?: number }[] =>
  [...s.player.drawPile, ...s.player.hand, ...s.player.discardPile, ...s.player.exhaustPile].filter(
    (c) => c.cardId === 'wither',
  );

const endTurn: Strategy = { decide: () => ({ kind: 'endTurn' }) };
const intangible = { powers: { intangible: 999 } };

describe('#273 Aeonglass data', () => {
  it('is an Act 3 (Glory) boss with 512 HP (A8 535), 3 Artifact and Withering Presence (6 cards)', () => {
    const d = gameData.enemies.aeonglass!;
    expect(d).toMatchObject({ act: 3, zone: 'glory', difficulty: 'boss', hp: { min: 512, max: 512 } });
    expect(d.ascension['8']?.hp).toEqual({ min: 535, max: 535 });
    expect(d.startPowers).toEqual({ artifact: 3, witheringPresence: 6 });
  });

  it('base and A9 moves: Ebb 22 (26) + 33 Block, Eye Lasers 11x2 (12x2), Increasing Intensity 1 (2) Wither+X, 2 (3) + X Strength, upgrade all Withers', () => {
    const d = gameData.enemies.aeonglass!;
    const ii = (count: number, strength: number) => [
      {
        type: 'addCards',
        source: { kind: 'card', cardId: 'wither' },
        count,
        to: 'discard',
        upgradeLevel: 0,
        xFromMoveUses: 'increasingIntensity',
      },
      { type: 'enemyGainStrength', amount: strength, xFromMoveUses: 'increasingIntensity' },
      { type: 'upgradeAllCopies', cardId: 'wither', level: 0, xFromMoveUses: 'increasingIntensity' },
    ];
    expect(d.moves.ebb!.effects).toEqual([
      { type: 'attack', damage: 22, hits: 1 },
      { type: 'gainBlock', amount: 33 },
    ]);
    expect(d.moves.eyeLasers!.effects).toEqual([{ type: 'attack', damage: 11, hits: 2 }]);
    expect(d.moves.increasingIntensity!.effects).toEqual(ii(1, 2));
    const a9 = d.ascension['9']!.moves!;
    expect(a9.ebb!.effects).toEqual([
      { type: 'attack', damage: 26, hits: 1 },
      { type: 'gainBlock', amount: 33 },
    ]);
    expect(a9.eyeLasers!.effects).toEqual([{ type: 'attack', damage: 12, hits: 2 }]);
    expect(a9.increasingIntensity!.effects).toEqual(ii(2, 3));
  });
});

describe('#273 Wither upgrade levels', () => {
  it('each level past the first adds the first upgrade step: Wither 3, + 6, +2 9, +3 12', () => {
    const def = gameData.cards.wither!;
    const dmg = (c: CardInstance) => (c.triggers![0]!.effects[0] as { damage: number }).damage;
    expect(dmg(makeCardInstance(def, false, 1))).toBe(3);
    expect(dmg(makeCardInstance(def, true, 1))).toBe(6);
    const w2 = makeCardInstance(def, true, 1, 2);
    expect([dmg(w2), w2.name, w2.upgradeLevel, w2.upgraded]).toEqual([9, 'Wither+2', 2, true]);
    expect(dmg(makeCardInstance(def, true, 1, 3))).toBe(12);
    // Level 0 and 1 are the plain and upgraded cards.
    expect(makeCardInstance(def, true, 1, 0)).toEqual(makeCardInstance(def, false, 1));
    expect(makeCardInstance(def, false, 1, 1)).toEqual(makeCardInstance(def, true, 1));
  });
});

describe('#273 Aeonglass in combat', () => {
  it('cycles Ebb, Eye Lasers, Increasing Intensity from turn 1', () => {
    const r = logged(glassData(), endTurn, { enemyId: 'aeonglass', playerStart: intangible });
    const moves = events(r.log, 'enemyMove')
      .slice(0, 7)
      .map((e) => e.moveId);
    expect(moves).toEqual([
      'ebb',
      'eyeLasers',
      'increasingIntensity',
      'ebb',
      'eyeLasers',
      'increasingIntensity',
      'ebb',
    ]);
  });

  it('Increasing Intensity: X = earlier uses (0, 1, 2); Wither+X into discard, 2 + X Strength, every Wither raised to +X', () => {
    const seen: { turn: number; strength: number; levels: number[] }[] = [];
    simulateCombat(glassData(), cfg({ enemyId: 'aeonglass', deck: deckOf(['defend', 10]), playerStart: intangible }), {
      decide(view) {
        const s = view.state;
        if (!seen.some((x) => x.turn === s.turn)) {
          seen.push({
            turn: s.turn,
            strength: s.enemy.strength,
            levels: withers(s)
              .map((c) => c.upgradeLevel ?? (c.upgraded ? 1 : 0))
              .sort(),
          });
        }
        return { kind: 'endTurn' };
      },
    });
    // Uses on turns 3, 6, 9: +2 (X=0), +3 (X=1), +4 (X=2) Strength.
    expect(seen.filter((x) => [1, 4, 7, 10].includes(x.turn))).toEqual([
      { turn: 1, strength: 0, levels: [] },
      { turn: 4, strength: 2, levels: [0] },
      { turn: 7, strength: 5, levels: [1, 1] },
      { turn: 10, strength: 9, levels: [2, 2, 2] },
    ]);
  });

  it('A9 Increasing Intensity shuffles 2 Withers and gains 3 + X Strength', () => {
    const r = logged(glassData(), endTurn, { enemyId: 'aeonglass', ascension: 9, playerStart: intangible });
    const gen = events(r.log, 'generated').filter((e) => e.cardId === 'wither');
    expect(gen.slice(0, 2).map((e) => e.to)).toEqual(['discard', 'discard']);
    const str = events(r.log, 'strength').filter((e) => e.side === 'enemy');
    expect(str.slice(0, 3).map((e) => e.amount)).toEqual([3, 4, 5]);
  });

  it('Withering Presence: every 6th card played (any card) adds a Wither to the Hand', () => {
    const r = logged(
      glassData(),
      { decide: (v) => (v.playable[0] ? { kind: 'play', uid: v.playable[0].uid } : { kind: 'endTurn' }) },
      { enemyId: 'aeonglass', deck: deckOf(['strike', 5], ['defend', 5]), playerStart: intangible },
    );
    // 3 energy: 3 cards a turn, so the 6th card is played on turn 2 and the 12th on turn 4.
    const gen = events(r.log, 'generated').filter((e) => e.cardId === 'wither' && e.to === 'hand');
    expect(gen.length).toBeGreaterThanOrEqual(2);
    const turnOf = (uid: number) => {
      let turn = 0;
      for (const e of r.log!) {
        if (e.t === 'turnStart') turn = e.turn;
        if (e.t === 'generated' && e.uid === uid) return turn;
      }
      return -1;
    };
    expect(gen.slice(0, 2).map((e) => turnOf(e.uid))).toEqual([2, 4]);
    // Exactly 6 and 12 cards played before each Wither arrives (round-1: the turn alone could not tell the 5th from the 6th).
    const playsBefore = (uid: number) => {
      let plays = 0;
      for (const e of r.log!) {
        if (e.t === 'generated' && e.uid === uid) return plays;
        if (e.t === 'play') plays++;
      }
      return -1;
    };
    expect(gen.slice(0, 2).map((e) => playsBefore(e.uid))).toEqual([6, 12]);
  });

  it('Withering Presence creates Withers at the level Increasing Intensity reached', () => {
    // A test enemy: Withering Presence every 1 card; its move raises Withers to +2 and records that level.
    const e = makeEnemy('glass', 999, {
      raise: { name: 'Raise', effects: [{ type: 'upgradeAllCopies', cardId: 'wither', level: 2 }] },
    });
    e.startPowers = { witheringPresence: 1 };
    const base = withEnemy(makeGameData(), e);
    const data: GameData = { ...base, cards: { ...base.cards, wither: gameData.cards.wither! } };
    const names: string[][] = [];
    simulateCombat(data, cfg({ enemyId: 'glass', deck: deckOf(['strike', 10]), playerStart: intangible }), {
      decide(v) {
        if (v.state.turn > 2) return { kind: 'endTurn' };
        const c = v.playable.find((p) => p.cardId === 'strike');
        if (c) return { kind: 'play', uid: c.uid };
        names.push(v.state.player.hand.filter((h) => h.cardId === 'wither').map((h) => h.name));
        return { kind: 'endTurn' };
      },
    });
    expect(names[0]).toEqual(['Wither', 'Wither', 'Wither']);
    expect(names[1]).toEqual(['Wither+2', 'Wither+2', 'Wither+2']);
  });

  it('a Wither+2 in hand at the end of turn deals 9', () => {
    const e = makeEnemy('glass', 999, {
      add: {
        name: 'Add',
        effects: [
          { type: 'addCards', source: { kind: 'card', cardId: 'wither' }, count: 1, to: 'hand', upgradeLevel: 2 },
        ],
      },
    });
    const base = withEnemy(makeGameData(), e);
    const data: GameData = { ...base, cards: { ...base.cards, wither: gameData.cards.wither! } };
    const hps: number[] = [];
    simulateCombat(data, cfg({ enemyId: 'glass', deck: deckOf(['strike', 4]) }), {
      decide(v) {
        if (!hps[v.state.turn]) hps[v.state.turn] = v.state.player.hp;
        return { kind: 'endTurn' };
      },
    });
    // The enemy's turn-1 move puts a Wither+2 in hand; it stays for turn 2: 9 damage at the end of turn 2.
    expect(hps[2]! - hps[3]!).toBe(9);
  });
});
