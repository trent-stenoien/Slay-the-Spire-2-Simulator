/** #264 Silent temporary and next-turn powers: Anticipate, Blur, Shadowmeld, Burst, Pounce, Shadow Step, Wraith Form, Dodge and Roll. */
import { describe, expect, it } from 'vitest';
import { simulateCombat } from './combat';
import { attackDamage, cardCost } from './rules';
import { cards, makeEnemy } from './testFixtures';
import { createStrategy, GREEDY_CONFIG } from './strategies';
import { cfg, deckOf, dummyData, events, scripted, withEnemy } from './combatTestHelpers';
import type { CardDef, CardInstance, Effect, GameData, GameEvent } from './types';

const apply = (power: Extract<Effect, { type: 'applyPower' }>['power'], amount: number): Effect => ({
  type: 'applyPower',
  power,
  amount,
});
const block = (amount: number): Effect => ({ type: 'gainBlock', amount });
const atk = (damage: number): Effect => ({ type: 'attack', damage, hits: 1 });
const scheduledBlock = (amount: number): Effect => ({
  type: 'schedule',
  delay: 1,
  effects: [{ type: 'script', id: 'scheduledBlock', values: [amount] }],
});

const card = (id: string, type: CardDef['type'], cost: number, effects: Effect[]): CardDef => ({
  ...cards.strike!,
  id,
  code: id.slice(0, 2).padEnd(2, 'x'),
  name: id,
  type,
  cost,
  effects,
  upgraded: null,
});

const extra: Record<string, CardDef> = {
  strike: cards.strike!,
  guard: card('guard', 'skill', 0, [block(5)]),
  guard1: card('guard1', 'skill', 1, [block(5)]),
  guard2: card('guard2', 'skill', 2, [block(5)]),
  anticipate: card('anticipate', 'skill', 0, [apply('dexterityThisTurn', 2)]),
  blur: card('blur', 'skill', 0, [block(5), apply('retainBlock', 1)]),
  shadowmeld: card('shadowmeld', 'skill', 0, [apply('doubleBlock', 1)]),
  burst: card('burst', 'skill', 0, [apply('burst', 1)]),
  burst2: card('burst2', 'skill', 0, [apply('burst', 2)]),
  pounce: card('pounce', 'attack', 2, [atk(14), apply('freeNextSkill', 1)]),
  shadowstep: card('shadowstep', 'skill', 0, [
    { type: 'moveCards', from: 'hand', to: 'discard', mode: 'all' },
    apply('doubleAttackNextTurn', 1),
  ]),
  wraith: card('wraith', 'power', 0, [apply('intangible', 2), apply('dexterityLossPerTurn', 1)]),
  dodge: card('dodge', 'skill', 0, [block(4), scheduledBlock(4)]),
  dex: card('dex', 'power', 0, [apply('dexterity', 2)]),
  frail: card('frail', 'skill', 0, [{ type: 'applyFrail', amount: 3 }]),
};

function data(...enemies: ReturnType<typeof makeEnemy>[]): GameData {
  const d = dummyData();
  Object.assign(d.cards, structuredClone(extra));
  return withEnemy(d, ...enemies);
}

const run = (deck: [string, number][], plan: (turn: number) => string[], d = data(), enemyId = 'dummy') =>
  simulateCombat(d, cfg({ enemyId, deck: deckOf(...deck) }), scripted(plan), { log: true });

function playerTurn(log: GameEvent[] | undefined, turn: number): GameEvent[] {
  const l = log ?? [];
  const from = l.findIndex((e) => e.t === 'turnStart' && e.side === 'player' && e.turn === turn);
  const to = l.findIndex((e, i) => i > from && e.t === 'turnEnd' && e.side === 'player');
  return l.slice(from, to < 0 ? undefined : to + 1);
}

const blocks = (log: GameEvent[] | undefined) => events(log, 'block').map((b) => b.amount);
const playerHits = (log: GameEvent[] | undefined) =>
  events(log, 'damage')
    .filter((d) => d.source === 'player')
    .map((d) => d.amount);

describe('#264 rules', () => {
  it('attackDamage multiplier doubles with the other modifiers and floors once', () => {
    expect(attackDamage(6, 0, 0, 0, 0, 0, 0, 2)).toBe(12);
    expect(attackDamage(5, 1, 1, 1, 0, 0, 0, 2)).toBe(13); // 6 × 2 × 0.75 × 1.5 = 13.5
  });

  it('cardCost: a free Skill is 0, an Attack is not', () => {
    const base = { uid: 1, cardId: 'x', name: 'x', keywords: [], effects: [], xCost: false } as unknown;
    const skill = { ...(base as object), type: 'skill', cost: 2 } as unknown as CardInstance;
    const attack = { ...(base as object), type: 'attack', cost: 2 } as unknown as CardInstance;
    expect(cardCost(skill, 0, false, true)).toBe(0);
    expect(cardCost(attack, 0, false, true)).toBe(2);
    expect(cardCost(skill, 0, false)).toBe(2);
  });
});

describe('#264 Anticipate (Dexterity this turn)', () => {
  it('adds Dexterity for the turn only', () => {
    const r = run(
      [
        ['anticipate', 1],
        ['guard', 2],
      ],
      (t) => (t <= 2 ? (t === 1 ? ['anticipate', 'guard'] : ['guard']) : []),
    );
    expect(blocks(playerTurn(r.log, 1))).toEqual([7]);
    expect(blocks(playerTurn(r.log, 2))).toEqual([5]);
  });

  it('adds to Dexterity from a power and leaves it after the turn', () => {
    const r = run(
      [
        ['dex', 1],
        ['anticipate', 1],
        ['guard', 1],
      ],
      (t) => (t === 1 ? ['dex', 'anticipate', 'guard'] : t === 2 ? ['guard'] : []),
    );
    expect(blocks(playerTurn(r.log, 1))).toEqual([9]);
    expect(blocks(playerTurn(r.log, 2))).toEqual([7]);
  });
});

describe('#264 Blur (Block kept for one turn)', () => {
  it('keeps the Block at the next turn start only', () => {
    const r = run(
      [
        ['blur', 1],
        ['guard', 1],
      ],
      (t) => (t === 1 ? ['blur'] : []),
    );
    expect(events(playerTurn(r.log, 2), 'blockReset')).toEqual([]);
    expect(events(playerTurn(r.log, 3), 'blockReset')).toHaveLength(1);
    expect(events(playerTurn(r.log, 1), 'powerApplied').map((e) => e.power)).toEqual(['retainBlock']);
  });

  it('the kept Block still stands when the next turn adds more', () => {
    const r = run(
      [
        ['blur', 1],
        ['guard', 1],
      ],
      (t) => (t === 1 ? ['blur'] : t === 2 ? ['guard'] : []),
    );
    expect(events(playerTurn(r.log, 2), 'block')[0]).toMatchObject({ amount: 5, total: 10 });
  });
});

describe('#264 Shadowmeld (double Block this turn)', () => {
  it('doubles Block from cards this turn only', () => {
    const r = run(
      [
        ['shadowmeld', 1],
        ['guard', 3],
      ],
      (t) => (t === 1 ? ['shadowmeld', 'guard', 'guard'] : t === 2 ? ['guard'] : []),
    );
    expect(blocks(playerTurn(r.log, 1))).toEqual([10, 10]);
    expect(blocks(playerTurn(r.log, 2))).toEqual([5]);
  });

  it('multiplies with Dexterity and Frail, floored once: (5 + 2) × 0.75 × 2 = 10', () => {
    const frailer = makeEnemy('frailer', 999, { f: { name: 'F', effects: [{ type: 'applyFrail', amount: 5 }] } });
    const r = run(
      [
        ['dex', 1],
        ['shadowmeld', 1],
        ['guard', 1],
      ],
      (t) => (t === 1 ? ['dex'] : t === 2 ? ['shadowmeld', 'guard'] : []),
      data(frailer),
      'frailer',
    );
    expect(blocks(playerTurn(r.log, 2))).toEqual([10]);
  });
});

describe('#264 Burst (next Skills played an extra time)', () => {
  it('the next Skill is played twice, then Skills are normal again', () => {
    const r = run(
      [
        ['burst', 1],
        ['guard', 2],
      ],
      (t) => (t === 1 ? ['burst', 'guard', 'guard'] : []),
    );
    expect(blocks(playerTurn(r.log, 1))).toEqual([5, 5, 5]);
    expect(events(playerTurn(r.log, 1), 'replay')).toHaveLength(1);
  });

  it('Burst+ covers the next 2 Skills; an Attack in between does not use it', () => {
    const r = run(
      [
        ['burst2', 1],
        ['strike', 1],
        ['guard', 3],
      ],
      (t) => (t === 1 ? ['burst2', 'strike', 'guard', 'guard', 'guard'] : []),
    );
    expect(blocks(playerTurn(r.log, 1))).toEqual([5, 5, 5, 5, 5]);
    expect(playerHits(r.log)).toEqual([6]);
  });

  it('wears off at the end of the turn', () => {
    const r = run(
      [
        ['burst', 1],
        ['guard', 1],
      ],
      (t) => (t === 1 ? ['burst'] : t === 2 ? ['guard'] : []),
    );
    expect(blocks(playerTurn(r.log, 2))).toEqual([5]);
  });
});

describe('#264 Pounce (the next Skill costs 0)', () => {
  it('the next Skill is free (energy is not spent), the one after pays', () => {
    const r = run(
      [
        ['pounce', 1],
        ['guard2', 2],
      ],
      (t) => (t === 1 ? ['pounce', 'guard2'] : []),
    );
    const plays = events(playerTurn(r.log, 1), 'play').map((e) => e.energyLeft);
    // 3 energy: Pounce -2 = 1; the free guard2 leaves 1 (the second guard2, cost 2, would not be playable).
    expect(plays).toEqual([1, 1]);
  });

  it('is not used up by an Attack and carries to the next turn', () => {
    const r = run(
      [
        ['pounce', 1],
        ['strike', 1],
        ['guard2', 1],
      ],
      (t) => (t === 1 ? ['pounce', 'strike'] : t === 2 ? ['guard2'] : []),
    );
    expect(events(playerTurn(r.log, 2), 'play')[0]).toMatchObject({ cardId: 'guard2', energyLeft: 3 });
  });
});

describe('#264 Shadow Step (discard hand, next turn Attacks deal double)', () => {
  it('discards the hand; next turn Attacks deal double, the turn after they are normal', () => {
    const r = run(
      [
        ['shadowstep', 1],
        ['strike', 4],
      ],
      (t) => (t === 1 ? ['shadowstep'] : t === 2 ? ['strike', 'strike'] : t === 3 ? ['strike'] : []),
    );
    expect(events(playerTurn(r.log, 1), 'play')).toHaveLength(1);
    expect(playerHits(r.log)).toEqual([12, 12, 6]);
  });

  it('does not double Attacks played the turn it is played', () => {
    const r = run(
      [
        ['shadowstep', 1],
        ['strike', 4],
      ],
      (t) => (t === 1 ? ['strike', 'shadowstep'] : []),
    );
    expect(playerHits(r.log)).toEqual([6]);
  });
});

describe('#264 Wraith Form (Intangible, Dexterity lost each turn)', () => {
  it('gains Intangible and loses 1 Dexterity at each turn start, going below 0', () => {
    const r = run(
      [
        ['wraith', 1],
        ['guard', 1],
      ],
      (t) => (t === 1 ? ['wraith'] : t === 3 ? ['guard'] : []),
    );
    const dexTotals = events(r.log, 'powerApplied')
      .filter((e) => e.power === 'dexterity')
      .slice(0, 3)
      .map((e) => e.total);
    expect(dexTotals).toEqual([-1, -2, -3]);
    expect(blocks(playerTurn(r.log, 3))).toEqual([3]); // 5 + (-2)
    expect(events(playerTurn(r.log, 1), 'powerApplied').map((e) => [e.power, e.total])).toEqual([
      ['intangible', 2],
      ['dexterityLossPerTurn', 1],
    ]);
  });

  it('Dexterity below 0 cannot take Block below 0', () => {
    const r = run(
      [
        ['wraith', 1],
        ['guard', 1],
      ],
      (t) => (t === 1 ? ['wraith'] : t === 8 ? ['guard'] : []),
    );
    expect(blocks(playerTurn(r.log, 8))).toEqual([0]);
  });
});

describe('#264 Dodge and Roll (Block now and next turn)', () => {
  it('next turn Block gets Dexterity', () => {
    const r = run(
      [
        ['dex', 1],
        ['dodge', 1],
      ],
      (t) => (t === 1 ? ['dex', 'dodge'] : []),
    );
    expect(blocks(playerTurn(r.log, 1))).toEqual([6]);
    expect(blocks(playerTurn(r.log, 2))).toEqual([6]);
  });

  it('next turn Block gets Frail: 4 × 0.75 = 3', () => {
    const frailer = makeEnemy('frailer', 999, { f: { name: 'F', effects: [{ type: 'applyFrail', amount: 5 }] } });
    const r = run([['dodge', 1]], (t) => (t === 1 ? ['dodge'] : []), data(frailer), 'frailer');
    expect(blocks(playerTurn(r.log, 1))).toEqual([4]);
    expect(blocks(playerTurn(r.log, 2))).toEqual([3]);
  });
});

describe('#264 strategy defaults', () => {
  const play = (deck: [string, number][], strategyData = data()) =>
    simulateCombat(strategyData, cfg({ enemyId: 'dummy', deck: deckOf(...deck) }), createStrategy(GREEDY_CONFIG), {
      log: true,
    });

  it('plays Anticipate before the Block Skills it helps', () => {
    const r = play([
      ['anticipate', 1],
      ['guard1', 2],
    ]);
    expect(blocks(playerTurn(r.log, 1))).toEqual([7, 7]);
  });

  it('plays Shadow Step last, after the Attacks', () => {
    const r = play([
      ['shadowstep', 1],
      ['strike', 3],
    ]);
    const plays = events(playerTurn(r.log, 1), 'play').map((e) => e.cardId);
    expect(plays).toEqual(['strike', 'strike', 'strike', 'shadowstep']);
  });
});
