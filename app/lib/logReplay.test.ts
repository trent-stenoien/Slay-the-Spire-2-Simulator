import { describe, expect, it } from 'vitest';
import { gameData } from '../../data';
import { runCombat, deriveSeed } from '../../engine';
import { ascensionLabel, buildReplay, describeEvent, enemyIntentLabel, intendedMoveId, type Round } from './logReplay';
import { GREEDY_CONFIG } from '../../engine/strategies';
import type { PowerId } from '../../engine/types';

describe('spawn events (#333)', () => {
  const nm = (id: string) => id;
  it('describeEvent names the new enemy, its slot, HP and Stunned', () => {
    expect(describeEvent({ t: 'spawn', enemyId: 'wriggler', index: 1, hp: 18, stunned: true }, nm)).toBe(
      'Wriggler appears as Enemy 2 (18 HP, Stunned)',
    );
    expect(describeEvent({ t: 'spawn', enemyId: 'twig_slime', index: 3, hp: 7 }, nm)).toBe(
      'Twig Slime appears as Enemy 4 (7 HP)',
    );
  });
  it('buildReplay adds a snapshot for the spawned enemy so later target events work', () => {
    const r = buildReplay([
      { t: 'combatStart', seed: 1, enemyHp: 10, playerHp: 50 },
      { t: 'turnStart', turn: 1, side: 'player' },
      { t: 'spawn', enemyId: 'wriggler', index: 1, hp: 18, stunned: true },
      { t: 'target', enemy: 1 },
      { t: 'loseHp', side: 'enemy', amount: 3, hpAfter: 15 },
    ]);
    expect(r.rounds[0]!.end.enemies.map((e) => e.hp)).toEqual([10, 15]);
  });
});

describe('log replay', () => {
  const result = runCombat(
    gameData,
    {
      characterId: 'ironclad',
      deck: gameData.characters.ironclad!.startingDeck,
      enemyId: 'nibbit',
      ascension: 0,
      strategy: GREEDY_CONFIG,
      seed: deriveSeed(42, 0),
    },
    { log: true },
  );
  const replay = buildReplay(result.log!);

  it('has one round per player turn and the final outcome', () => {
    expect(replay.rounds).toHaveLength(result.turns);
    expect(replay.outcome).toBe(result.outcome);
    expect(replay.hpLost).toBe(result.hpLost);
    expect(replay.playerMaxHp).toBe(80);
  });

  it('tracks HP to the engine result', () => {
    const last = replay.rounds[replay.rounds.length - 1]!;
    expect(last.end.player.hp).toBe(80 - result.hpLost);
    expect(last.end.enemy.hp).toBe(result.enemyHpRemaining);
    expect(replay.rounds[0]!.start.player.hp).toBe(80);
  });

  it('records draws and the enemy move', () => {
    expect(replay.rounds[0]!.drawn).toHaveLength(5);
    expect(replay.rounds[0]!.enemyMove).toBe('Butt');
  });

  it('describes events', () => {
    const name = (id: string) => gameData.cards[id]?.name ?? id;
    expect(
      describeEvent({ t: 'damage', source: 'enemy', target: 'player', amount: 12, blocked: 5, hpLoss: 7 }, name),
    ).toBe('Enemy hits for 12, 5 blocked, 7 HP lost');
    expect(describeEvent({ t: 'play', uid: 1, cardId: 'bash', energyLeft: 1 }, name)).toBe('Play Bash (1 energy left)');
    expect(describeEvent({ t: 'play', uid: 2, cardId: 'whirlwind', energyLeft: 0, x: 3 }, name)).toBe(
      'Play Whirlwind (X = 3, 0 energy left)',
    );
    expect(describeEvent({ t: 'energy', amount: 2, total: 4 }, name)).toBe('You gain 2 energy (4 energy)');
    expect(describeEvent({ t: 'debuff', side: 'enemy', kind: 'vulnerable', amount: 2, total: 2 }, name)).toBe(
      'Enemy gets 2 Vulnerable (total 2)',
    );
    expect(describeEvent({ t: 'blockReset', side: 'player' }, name)).toBeNull();
    expect(describeEvent({ t: 'poison', amount: 3, total: 5 }, name)).toBe('Enemy gets 3 Poison (total 5)');
    expect(describeEvent({ t: 'shrink', percent: 30 }, name)).toBe('You are Shrunk: your attacks deal 30% less damage');
    expect(describeEvent({ t: 'poisonDamage', amount: 5, hpAfter: 37 }, name)).toBe(
      'Enemy loses 5 HP from Poison (37 HP left)',
    );
  });

  it('#108: describes exhausts by reason', () => {
    const name = (id: string) => gameData.cards[id]?.name ?? id;
    const ex = (reason: 'ethereal' | 'keyword' | 'effect' | 'power') =>
      describeEvent({ t: 'exhaust', uid: 1, cardId: 'drum_of_battle', reason }, name);
    expect(ex('effect')).toBe('Drum of Battle exhausted (by a card effect)');
    expect(ex('keyword')).toBe('Drum of Battle exhausted');
    expect(ex('ethereal')).toBe('Drum of Battle exhausted (Ethereal)');
    expect(ex('power')).toBe('Drum of Battle exhausted (by a power)');
  });

  it('tracks Poison stacks and Poison HP loss', () => {
    const log = [
      { t: 'combatStart', seed: 1, enemyHp: 40, playerHp: 70 },
      { t: 'turnStart', turn: 1, side: 'player' },
      { t: 'poison', amount: 3, total: 3 },
      { t: 'turnEnd', turn: 1, side: 'player' },
      { t: 'turnStart', turn: 1, side: 'enemy' },
      { t: 'blockReset', side: 'enemy' },
      { t: 'poisonDamage', amount: 3, hpAfter: 37 },
      { t: 'enemyMove', moveId: 'm', name: 'M' },
      { t: 'turnEnd', turn: 1, side: 'enemy' },
    ] as const;
    const rp = buildReplay(log);
    expect(rp.rounds[0]!.end.enemy).toMatchObject({ hp: 37, poison: 2 });
    expect(rp.rounds[0]!.start.enemy.poison).toBe(0);
    expect(rp.rounds[0]!.enemyEvents.map((e) => e.t)).toContain('poisonDamage');
  });

  it('tracks self-inflicted HP loss and lists mid-turn draws as events (#106, #107)', () => {
    const log = [
      { t: 'combatStart', seed: 1, enemyHp: 40, playerHp: 70 },
      { t: 'turnStart', turn: 1, side: 'player' },
      { t: 'draw', uid: 0, cardId: 'pommel_strike' },
      { t: 'draw', uid: 1, cardId: 'strike' },
      { t: 'play', uid: 2, cardId: 'hemokinesis', energyLeft: 2 },
      { t: 'loseHp', side: 'player', amount: 2, hpAfter: 68 },
      { t: 'play', uid: 0, cardId: 'pommel_strike', energyLeft: 1 },
      { t: 'draw', uid: 3, cardId: 'defend' },
      { t: 'turnEnd', turn: 1, side: 'player' },
    ] as const;
    const rp = buildReplay(log);
    const r0 = rp.rounds[0]!;
    expect(r0.drawn).toEqual(['pommel_strike', 'strike']);
    expect(r0.end.player.hp).toBe(68);
    expect(r0.playerEvents.filter((e) => e.t === 'draw')).toEqual([{ t: 'draw', uid: 3, cardId: 'defend' }]);
  });

  it('describes lose HP, mid-turn draws and the no-draw power', () => {
    const name = (id: string) => gameData.cards[id]?.name ?? id;
    expect(describeEvent({ t: 'loseHp', side: 'player', amount: 2, hpAfter: 78 }, name)).toBe(
      'You lose 2 HP (78 HP left)',
    );
    expect(describeEvent({ t: 'draw', uid: 4, cardId: 'shrug_it_off' }, name)).toBe('You draw Shrug It Off');
    expect(describeEvent({ t: 'powerApplied', side: 'player', power: 'noDraw', amount: 1, total: 1 }, name)).toBe(
      'You cannot draw additional cards this turn',
    );
    expect(describeEvent({ t: 'powerRemoved', side: 'player', power: 'noDraw' }, name)).toBeNull();
  });

  it('describes the #109 powers', () => {
    const name = (id: string) => gameData.cards[id]?.name ?? id;
    const applied = (power: PowerId, amount: number, total: number) =>
      describeEvent({ t: 'powerApplied', side: 'player', power, amount, total }, name);
    expect(applied('demonForm', 3, 3)).toBe('You gain 3 Demon Form (total 3)');
    expect(applied('plating', 4, 4)).toBe('You gain 4 Plating (total 4)');
    expect(applied('plating', -1, 3)).toBe('Your Plating drops by 1 (3 left)');
    expect(applied('energyPerTurn', 1, 1)).toBe('You gain 1 Pyre (total 1)');
    expect(applied('vigorPerTurn', 4, 4)).toBe('You gain 4 Prep Time (total 4)');
    expect(applied('vigor', 4, 4)).toBe('You gain 4 Vigor (total 4)');
    expect(applied('powersCostLess', 1, 1)).toBe('You gain 1 Curious (total 1)');
    expect(applied('rollingBoulder', 5, 5)).toBe('Rolling Boulder: 5 damage at the start of your turn');
    expect(applied('rollingBoulder', 5, 10)).toBe('Rolling Boulder grows by 5 (10 damage)');
    expect(applied('cruelty', 25, 25)).toBe('Cruelty: Vulnerable enemies take 25% more damage');
    expect(applied('barricade', 1, 1)).toBe('Barricade: Block is no longer removed at the start of your turn');
    expect(applied('corruption', 1, 1)).toBe('Corruption: Skills cost 0 and are Exhausted when played');
    expect(applied('upgradeAtCombatEnd', 1, 1)).toBe(
      'Improvement: a random card is Upgraded at the end of combat (no effect in this combat)',
    );
    expect(describeEvent({ t: 'powerRemoved', side: 'player', power: 'vigor' }, name)).toBe('Your Vigor is used up');
    expect(describeEvent({ t: 'powerRemoved', side: 'player', power: 'plating' }, name)).toBe('Your Plating ends');
  });

  it('works out the intended move, including after a kill', () => {
    expect(intendedMoveId(replay.rounds, 0, new Map())).toBe('butt');
    const r = (turn: number, id: string | null) => ({ turn, enemyMoveId: id }) as Round;
    const seen = new Map([[2, 'a']]);
    // The logged move wins; a final round without a move falls back to the intent seen that turn.
    expect(intendedMoveId([r(1, 'c'), r(2, null)], 0, seen)).toBe('c');
    expect(intendedMoveId([r(1, 'c'), r(2, null)], 1, seen)).toBe('a');
    expect(intendedMoveId([r(1, null)], 0, seen)).toBeNull();
    expect(intendedMoveId([], 0, seen)).toBeNull();
  });
});

describe('log page text', () => {
  const intent = { moveId: 'butt', name: 'Butt', attacks: [{ damagePerHit: 12, hits: 1 }], totalIncoming: 12 };
  it('spells out Ascension', () => {
    expect(ascensionLabel(0)).toBe('Ascension 0');
    expect(ascensionLabel(10)).toBe('Ascension 10');
  });
  it('formats the enemy intent with the move effects', () => {
    expect(enemyIntentLabel(intent, [{ type: 'attack', damage: 12, hits: 1 }])).toBe('Enemy Intent: Butt (12 damage)');
  });
  it('uses the modified damage and multi-hit and non-attack wording', () => {
    const multi = { moveId: 'm', name: 'Slice', attacks: [{ damagePerHit: 8, hits: 2 }], totalIncoming: 16 };
    expect(
      enemyIntentLabel(multi, [
        { type: 'attack', damage: 6, hits: 2 },
        { type: 'gainStrength', amount: 2 },
      ]),
    ).toBe('Enemy Intent: Slice (8 damage 2 times, Gain 2 Strength)');
  });
  it('handles unknown intent and effect-less moves', () => {
    expect(enemyIntentLabel(null)).toBe('Enemy Intent: unknown');
    expect(enemyIntentLabel({ ...intent, attacks: [], totalIncoming: 0 }, [])).toBe('Enemy Intent: Butt');
  });
});
