/**
 * #274: Test Subject (Act 3 boss), three phases: revive as the next phase (EnemyDef.nextPhase), statuses clear
 * between phases, Enrage, Painful Stabs, Multi-Claw's growing hits, enemy Intangible and Nemesis.
 */
import { describe, expect, it } from 'vitest';
import { gameData } from '../data/index';
import { computeIntent, simulateCombat } from './combat';
import { cfg, deckOf, events, logged, passive, scripted, withEnemy } from './combatTestHelpers';
import { makeEnemy } from './testFixtures';
import type { EnemyDef, GameData, GameEvent, Strategy } from './types';

/** Fixture phases: `p1` (5 HP, waits) revives as `p2` (40 HP, waits); `p2` is the last phase. */
function phaseData(p1: Partial<EnemyDef> = {}, p2: Partial<EnemyDef> = {}): GameData {
  const data = structuredClone(gameData) as GameData;
  const wait = { wait: { name: 'Wait', effects: [] } };
  return withEnemy(
    data,
    { ...makeEnemy('p1', 5, wait), nextPhase: 'p2', ...p1 },
    { ...makeEnemy('p2', 40, wait), ...p2 },
  );
}

/** Events from `from` (inclusive) of a log, by type. */
const kinds = (log: GameEvent[] | undefined) => (log ?? []).map((e) => e.t);
/** Index of the `n`th turnStart of `side` (turn number). */
const turnAt = (log: GameEvent[], turn: number, side: 'player' | 'enemy') =>
  log.findIndex((e) => e.t === 'turnStart' && e.turn === turn && e.side === side);
const slice = (log: GameEvent[], turn: number, side: 'player' | 'enemy') => {
  const start = turnAt(log, turn, side);
  const next = log.findIndex((e, i) => i > start && e.t === 'turnStart');
  return log.slice(start, next < 0 ? undefined : next);
};

/** Plays the listed cards each turn when they are in hand (Wounds and Burns may crowd them out). */
function lenient(plan: (turn: number) => string[]): Strategy {
  let turn = -1;
  let queue: string[] = [];
  return {
    decide(view) {
      if (view.state.turn !== turn) {
        turn = view.state.turn;
        queue = [...plan(turn)];
      }
      for (;;) {
        const want = queue.shift();
        if (want === undefined) return { kind: 'endTurn' };
        const c = view.playable.find((p) => p.cardId === want);
        if (c) return { kind: 'play', uid: c.uid };
      }
    },
  };
}

/** Survives anything: every enemy hit on the player is 1. */
const tough = { powers: { intangible: 999 } };

describe('#274 Test Subject data', () => {
  it('phase 1: 100 HP (A8 111), Enrage 2 (A9 3), Bite 20 (22) / Skull Bash 14 (16) + 1 Vulnerable, Bite first; revives as phase 2', () => {
    const d = gameData.enemies.test_subject!;
    expect(d).toMatchObject({ act: 3, zone: 'glory', difficulty: 'boss', hp: { min: 100, max: 100 } });
    expect(d.nextPhase).toBe('test_subject_phase_2');
    expect(d.ascension['8']?.hp).toEqual({ min: 111, max: 111 });
    expect(d.startPowers).toEqual({ enrage: 2 });
    expect(d.ascension['9']?.startPowers).toEqual({ enrage: 3 });
    expect(d.pattern).toEqual({ type: 'cycle', order: ['bite', 'skullBash'], start: 'first' });
    expect(d.moves.bite!.effects).toEqual([{ type: 'attack', damage: 20, hits: 1 }]);
    expect(d.moves.skullBash!.effects).toEqual([
      { type: 'attack', damage: 14, hits: 1 },
      { type: 'applyVulnerable', amount: 1 },
    ]);
    expect(d.ascension['9']?.moves?.bite?.effects).toEqual([{ type: 'attack', damage: 22, hits: 1 }]);
    expect(d.ascension['9']?.moves?.skullBash?.effects).toEqual([
      { type: 'attack', damage: 16, hits: 1 },
      { type: 'applyVulnerable', amount: 1 },
    ]);
  });

  it('phase 2: 200 HP (A8 212), Painful Stabs 1, Multi-Claw 10x3 (11x3) +1 hit per use every turn; revives as phase 3', () => {
    const d = gameData.enemies.test_subject_phase_2!;
    expect(d.hp).toEqual({ min: 200, max: 200 });
    expect(d.nextPhase).toBe('test_subject_phase_3');
    expect(d.ascension['8']?.hp).toEqual({ min: 212, max: 212 });
    expect(d.startPowers).toEqual({ painfulStabs: 1 });
    expect(d.pattern).toEqual({ type: 'cycle', order: ['multiClaw'], start: 'first' });
    expect(d.moves.multiClaw!.effects).toEqual([{ type: 'attack', damage: 10, hits: 3, extraHitsPerUse: 1 }]);
    expect(d.ascension['9']?.moves?.multiClaw?.effects).toEqual([
      { type: 'attack', damage: 11, hits: 3, extraHitsPerUse: 1 },
    ]);
  });

  it('phase 3: 300 HP (A8 313), Nemesis + Intangible 1, Lacerate 10x3 (11x3) → Big Pounce 45 → Burning Growl 3 Burn +2 Str (5, +3); last phase', () => {
    const d = gameData.enemies.test_subject_phase_3!;
    expect(d.hp).toEqual({ min: 300, max: 300 });
    expect(d.nextPhase).toBeUndefined();
    expect(d.ascension['8']?.hp).toEqual({ min: 313, max: 313 });
    expect(d.startPowers).toEqual({ nemesis: 1, intangible: 1 });
    expect(d.pattern).toEqual({ type: 'cycle', order: ['lacerate', 'bigPounce', 'burningGrowl'], start: 'first' });
    expect(d.moves.lacerate!.effects).toEqual([{ type: 'attack', damage: 10, hits: 3 }]);
    expect(d.moves.bigPounce!.effects).toEqual([{ type: 'attack', damage: 45, hits: 1 }]);
    const growl = (n: number, s: number) => [
      { type: 'addCards', source: { kind: 'card', cardId: 'burn' }, count: n, to: 'discard' },
      { type: 'gainStrength', amount: s },
    ];
    expect(d.moves.burningGrowl!.effects).toEqual(growl(3, 2));
    const a9 = d.ascension['9']!.moves!;
    expect(a9.lacerate!.effects).toEqual([{ type: 'attack', damage: 11, hits: 3 }]);
    expect(a9.bigPounce).toBeUndefined();
    expect(a9.burningGrowl!.effects).toEqual(growl(5, 3));
  });

  it('every nextPhase names a loaded enemy', () => {
    for (const e of Object.values(gameData.enemies)) {
      if (e.nextPhase) expect(gameData.enemies[e.nextPhase], `${e.id}.nextPhase`).toBeDefined();
    }
  });
});

describe('#274 revive (multi-phase enemies)', () => {
  it('killed during the player turn: later attacks that turn hit nothing; it revives at the start of its turn (no move) with the next phase HP', () => {
    const r = logged(
      phaseData(),
      scripted((t) => (t === 1 ? ['strike', 'strike'] : [])),
      {
        enemyId: 'p1',
        deck: deckOf(['strike', 5]),
        playerStart: tough,
      },
    );
    const log = r.log!;
    const p1 = slice(log, 1, 'player');
    // One damage event: the first Strike kills it; the second Strike has no target.
    expect(events(p1, 'damage').filter((d) => d.target === 'enemy')).toHaveLength(1);
    expect(events(p1, 'play')).toHaveLength(2);
    const e1 = slice(log, 1, 'enemy');
    expect(events(e1, 'revive')).toEqual([{ t: 'revive', enemyId: 'p2', hp: 40 }]);
    expect(events(e1, 'enemyMove')).toHaveLength(0);
    expect(events(slice(log, 2, 'enemy'), 'enemyMove')).toHaveLength(1);
    expect(r.outcome).not.toBe('win');
  });

  it('the combat is won only when the last phase dies', () => {
    const r = logged(
      phaseData({}, { hp: { min: 6, max: 6 } }),
      scripted(() => ['strike']),
      {
        enemyId: 'p1',
        deck: deckOf(['strike', 5]),
        playerStart: tough,
      },
    );
    expect(r.outcome).toBe('win');
    expect(r.turns).toBe(2);
    expect(events(r.log, 'revive')).toHaveLength(1);
  });

  it("its Strength, debuffs, Poison, Block and powers clear; the player's statuses carry over", () => {
    const p1Moves = {
      buff: {
        name: 'Buff',
        effects: [
          { type: 'gainStrength' as const, amount: 3 },
          { type: 'gainBlock' as const, amount: 4 },
          { type: 'applyVulnerable' as const, amount: 2 },
        ],
      },
    };
    const data = phaseData({
      hp: { min: 20, max: 20 },
      moves: p1Moves,
      pattern: { type: 'cycle', order: ['buff'], start: 'first' },
      startPowers: { artifact: 1 },
    });
    // Turn 1: Bash (Artifact blocks the Vulnerable) and Strikes; turn 2: kill.
    let snapshot: unknown = null;
    const strategy: Strategy = {
      decide(view) {
        const e = view.state.enemy;
        if (view.state.turn === 3 && snapshot === null) {
          snapshot = { enemy: { ...e, debuffs: { ...e.debuffs } }, playerVuln: view.state.player.debuffs.vulnerable };
        }
        const c = view.playable.find((p) => p.cardId === 'bash') ?? view.playable.find((p) => p.cardId === 'strike');
        return c && view.state.turn < 3 ? { kind: 'play', uid: c.uid } : { kind: 'endTurn' };
      },
    };
    simulateCombat(
      data,
      cfg({ enemyId: 'p1', deck: deckOf(['bash', 2], ['strike', 8]), playerStart: tough }),
      strategy,
      { log: true },
    );
    const s = snapshot as { enemy: Record<string, unknown> & { debuffs: Record<string, number> }; playerVuln: number };
    expect(s.enemy.enemyId).toBe('p2');
    expect(s.enemy).toMatchObject({ hp: 40, maxHp: 40, block: 0, strength: 0, poison: 0 });
    expect(s.enemy.debuffs).toEqual({ vulnerable: 0, weak: 0, frail: 0 });
    expect(s.enemy.powers ?? {}).toEqual({});
    // The player's Vulnerable from phase 1 (2 per Buff) is still on in phase 2.
    expect(s.playerVuln).toBeGreaterThan(0);
  });

  it('killed during its own turn (Poison): stays dead through the next player turn, revives at the start of its following turn', () => {
    const r = logged(
      phaseData(),
      scripted((t) => (t === 1 ? ['deadly_poison'] : [])),
      {
        characterId: 'silent',
        enemyId: 'p1',
        deck: deckOf(['deadly_poison', 5]),
        playerStart: tough,
      },
    );
    const log = r.log!;
    expect(events(slice(log, 1, 'enemy'), 'poisonDamage')).toHaveLength(1);
    expect(events(slice(log, 1, 'enemy'), 'revive')).toHaveLength(0);
    expect(events(slice(log, 2, 'enemy'), 'revive')).toHaveLength(1);
    expect(events(slice(log, 2, 'enemy'), 'enemyMove')).toHaveLength(0);
    expect(events(slice(log, 3, 'enemy'), 'enemyMove')).toHaveLength(1);
  });

  it('is deterministic: same seed, same log, through all three real phases', () => {
    const c = cfg({
      enemyId: 'test_subject',
      deck: deckOf(['strike', 10, true], ['bash', 2, true]),
      playerStart: tough,
    });
    const a = simulateCombat(gameData, c, passive, { log: true });
    const b = simulateCombat(gameData, c, passive, { log: true });
    expect(a.log).toEqual(b.log);
  });
});

describe('#274 Enrage', () => {
  it('each Skill the player plays gives it [amount] Strength; Attacks do not', () => {
    const r = logged(
      gameData,
      scripted((t) => (t === 1 ? ['defend', 'strike', 'defend'] : [])),
      {
        enemyId: 'test_subject',
        deck: deckOf(['defend', 3], ['strike', 2]),
        playerStart: tough,
      },
    );
    const p1 = slice(r.log!, 1, 'player');
    expect(
      events(p1, 'strength')
        .filter((e) => e.side === 'enemy')
        .map((e) => e.total),
    ).toEqual([2, 4]);
  });
});

describe('#274 Painful Stabs and Multi-Claw', () => {
  it('Multi-Claw hits 3, then 4, then 5 times; the intent shows the grown count', () => {
    const r = logged(gameData, passive, {
      enemyId: 'test_subject_phase_2',
      deck: deckOf(['strike', 5]),
      playerStart: tough,
    });
    const hits = [1, 2, 3].map(
      (t) => events(slice(r.log!, t, 'enemy'), 'damage').filter((d) => d.source === 'enemy').length,
    );
    expect(hits).toEqual([3, 4, 5]);
    const move = gameData.enemies.test_subject_phase_2!.moves.multiClaw!;
    const intent = computeIntent(
      'multiClaw',
      move,
      { strength: 0, debuffs: { vulnerable: 0, weak: 0, frail: 0 }, moveUses: { multiClaw: 2 } },
      { debuffs: { vulnerable: 0, weak: 0, frail: 0 } },
    );
    expect(intent.attacks).toEqual([{ damagePerHit: 10, hits: 5 }]);
  });

  it('each hit that does HP damage shuffles 1 Wound into the discard pile; fully blocked hits add none', () => {
    const r = logged(gameData, passive, {
      enemyId: 'test_subject_phase_2',
      deck: deckOf(['strike', 5]),
      playerStart: tough,
    });
    const e1 = slice(r.log!, 1, 'enemy');
    expect(events(e1, 'generated').filter((g) => g.cardId === 'wound' && g.to === 'discard')).toHaveLength(3);
    // With Block from Defends (5 each, every hit is 1 under Intangible), the hits are absorbed: no Wounds.
    const blocked = logged(
      gameData,
      scripted((t) => (t === 1 ? ['defend'] : [])),
      {
        enemyId: 'test_subject_phase_2',
        deck: deckOf(['defend', 5]),
        playerStart: tough,
      },
    );
    expect(events(slice(blocked.log!, 1, 'enemy'), 'generated')).toHaveLength(0);
  });
});

describe('#274 enemy Intangible and Nemesis', () => {
  it('enemy Intangible makes each hit and HP loss 1, and falls off at the end of the player turn', () => {
    const r = logged(
      gameData,
      scripted((t) => (t <= 2 ? ['strike'] : [])),
      {
        enemyId: 'test_subject_phase_3',
        deck: deckOf(['strike', 5]),
        playerStart: tough,
      },
    );
    const log = r.log!;
    const hit = (t: number) => events(slice(log, t, 'player'), 'damage').find((d) => d.target === 'enemy')!;
    expect(hit(1)).toMatchObject({ amount: 1, hpLoss: 1 });
    expect(hit(2)).toMatchObject({ amount: 6, hpLoss: 6 });
    const end1 = log.findIndex((e) => e.t === 'turnEnd' && e.turn === 1 && e.side === 'player');
    const removed = log.findIndex((e) => e.t === 'powerRemoved' && e.side === 'enemy' && e.power === 'intangible');
    expect(removed).toBeGreaterThan(turnAt(log, 1, 'player'));
    expect(removed).toBeLessThan(end1);
  });

  it('Nemesis: phase 3 is Intangible on its 1st, 3rd, 5th player turns (revives with 1; gains 1 after its 2nd, 4th move)', () => {
    const r = logged(
      gameData,
      lenient(() => ['strike']),
      {
        enemyId: 'test_subject_phase_3',
        deck: deckOf(['strike', 5]),
        playerStart: tough,
      },
    );
    const perTurn = [1, 2, 3, 4, 5, 6].map(
      (t) => events(slice(r.log!, t, 'player'), 'damage').find((d) => d.target === 'enemy')!.amount,
    );
    expect(perTurn).toEqual([1, 6, 1, 6, 1, 6]);
  });

  it('full fight: phase 1 → 2 → 3 in order, Nemesis Intangible on the first player turn after the phase-3 revive', () => {
    const r = logged(
      gameData,
      lenient(() => ['strike', 'strike', 'strike']),
      {
        enemyId: 'test_subject',
        deck: deckOf(['strike', 10, true]),
        playerStart: { ...tough, strength: 30 },
      },
    );
    expect(events(r.log, 'revive').map((e) => e.enemyId)).toEqual(['test_subject_phase_2', 'test_subject_phase_3']);
    const log = r.log!;
    const at = log.findIndex((e) => e.t === 'revive' && e.enemyId === 'test_subject_phase_3');
    const next = log.slice(at).find((e) => e.t === 'damage' && e.target === 'enemy');
    expect(next).toMatchObject({ amount: 1 });
    expect(kinds(log)).toContain('revive');
  });
});
