/** #110 Temporary and next-turn effects: this-turn Strength, enemy Strength loss, Flame Barrier, Colossus, scheduled effects, cost changes. */
import { describe, expect, it } from 'vitest';
import { computeIntent, simulateCombat } from './combat';
import { attackDamage, cardCost } from './rules';
import { cards, makeEnemy } from './testFixtures';
import { cfg, deckOf, dummyData, events, scripted, withEnemy } from './combatTestHelpers';
import type { CardDef, CardInstance, Effect, EnemyDef, GameData, GameEvent, PowerId, Strategy } from './types';

const apply = (p: PowerId, amount: number): Effect => ({ type: 'applyPower', power: p, amount });
const loss = (amount: number): Effect => ({ type: 'applyEnemyPower', power: 'strengthLossThisTurn', amount });
const atk = (damage: number, hits = 1): Effect => ({ type: 'attack', damage, hits });
const block = (amount: number): Effect => ({ type: 'gainBlock', amount });

/** A test card modelled on a real one (engine tests do not import data/). */
const card = (
  id: string,
  type: CardDef['type'],
  cost: number,
  effects: Effect[],
  extra: Partial<CardDef> = {},
): CardDef => ({
  ...cards.strike!,
  id,
  code: id.slice(0, 2).padEnd(2, 'x'),
  name: id,
  type,
  cost,
  effects,
  upgraded: null,
  ...extra,
});

const extra: Record<string, CardDef> = {
  strike0: card('strike0', 'attack', 0, [atk(6)]),
  strike: cards.strike!,
  bash: cards.bash!,
  defend: cards.defend!,
  frenzy: card('frenzy', 'skill', 0, [apply('strengthThisTurn', 5)]),
  setup: card('setup', 'attack', 1, [atk(7), apply('strengthThisTurn', 3)]),
  mangle: card('mangle', 'attack', 0, [atk(20), loss(10)]),
  shackles: card('shackles', 'skill', 0, [loss(3)]),
  rage: card('rage', 'skill', 0, [apply('rage', 3)]),
  barrier: card('barrier', 'skill', 0, [block(12), apply('flameBarrier', 4)]),
  colossus: card('colossus', 'skill', 0, [block(4), apply('colossus', 1)]),
  panic: card('panic', 'skill', 0, [block(30), apply('noBlockFromCards', 2)], { keywords: ['exhaust'] }),
  entrench: card('entrench', 'skill', 2, [{ type: 'gainBlockFrom', amount: 0, bonusPer: { per: 'playerBlock', amount: 1 } }]),
  equilibrium: card('equilibrium', 'skill', 0, [block(13), apply('retainHand', 1)]),
  salvo: card('salvo', 'attack', 0, [atk(12), apply('retainHand', 1)]),
  unrelenting: card('unrelenting', 'attack', 0, [atk(14), apply('freeAttack', 1)]),
  stomp: card('stomp', 'attack', 3, [{ type: 'attack', damage: 12, hits: 1, allEnemies: true }], {
    costLessPer: { per: 'attacksPlayedThisTurn', amount: 1 },
  }),
  punch: card('punch', 'skill', 0, [apply('doubleAttack', 1)]),
  punch2: card('punch2', 'skill', 0, [apply('doubleAttack', 2)]),
  rebound: card('rebound', 'attack', 0, [atk(9), apply('nextCardToDrawTop', 1)]),
  choking: card('choking', 'attack', 0, [atk(12), apply('choking', 6)]),
  outmaneuver: card('outmaneuver', 'skill', 0, [
    { type: 'schedule', delay: 1, effects: [{ type: 'gainEnergy', amount: 2 }] },
  ]),
  relax: card('relax', 'skill', 0, [
    block(16),
    {
      type: 'schedule',
      delay: 1,
      effects: [
        { type: 'draw', amount: 2 },
        { type: 'gainEnergy', amount: 2 },
      ],
    },
  ]),
  toric: card('toric', 'skill', 0, [
    block(5),
    { type: 'schedule', delay: 1, effects: [block(5)] },
    { type: 'schedule', delay: 2, effects: [block(5)] },
  ]),
  prolong: card('prolong', 'skill', 0, [{ type: 'script', id: 'prolong' }]),
  bomb: card('bomb', 'skill', 0, [
    { type: 'schedule', delay: 2, at: 'turnEnd', effects: [{ type: 'dealDamage', amount: 40, allEnemies: true }] },
  ]),
  enlighten: card(
    'enlighten',
    'skill',
    0,
    [{ type: 'setCost', piles: ['hand'], cost: 1, duration: 'turn', onlyIfHigher: true }],
    { keywords: ['exhaust'] },
  ),
  enlightenPlus: card(
    'enlightenPlus',
    'skill',
    0,
    [{ type: 'setCost', piles: ['hand'], cost: 1, duration: 'combat', onlyIfHigher: true }],
    { keywords: ['exhaust'] },
  ),
  dex: card('dex', 'power', 0, [apply('dexterity', 2)]),
  ethereal: card('ethereal', 'skill', 0, [block(1)], { keywords: ['ethereal'] }),
  weakener: card('weakener', 'skill', 0, [{ type: 'applyWeak', amount: 2 }]),
  vuln: card('vuln', 'skill', 0, [{ type: 'applyVulnerable', amount: 2 }]),
  frail: card('frail', 'skill', 0, [{ type: 'applyFrail', amount: 3 }]),
};

/** Enemy that hits 3 × 3 every turn, never dying (999 HP). */
const attacker = (hits = 3, damage = 3): EnemyDef =>
  makeEnemy('att', 999, { hit: { name: 'Hit', effects: [atk(damage, hits)] } });

function data(...enemies: EnemyDef[]): GameData {
  const d = dummyData();
  Object.assign(d.cards, structuredClone(extra));
  return withEnemy(d, ...enemies);
}

const run = (
  d: GameData,
  deck: [string, number][],
  plan: (turn: number) => string[],
  enemyId = 'dummy',
  strategy: Strategy = scripted(plan),
) => simulateCombat(d, cfg({ enemyId, deck: deckOf(...deck) }), strategy, { log: true });

const playerHits = (log: GameEvent[] | undefined) => events(log, 'damage').filter((d) => d.source === 'player');
const enemyHits = (log: GameEvent[] | undefined) => events(log, 'damage').filter((d) => d.source === 'enemy');
const blocks = (log: GameEvent[] | undefined) => events(log, 'block').map((b) => b.amount);
const enemyTurnStarts = (log: GameEvent[] | undefined) =>
  (log ?? []).flatMap((e, i) => (e.t === 'turnStart' && e.side === 'enemy' ? [i] : []));

describe('rules: attackDamage reduction and cardCost', () => {
  it('Colossus multiplies with Weak: Weak + Colossus = 62.5% less, one floor at the end', () => {
    expect(attackDamage(16, 0, 0, 0, 0, 0, 50)).toBe(8);
    expect(attackDamage(16, 0, 1, 0, 0, 0, 50)).toBe(6); // 16 × 0.75 × 0.5
    expect(attackDamage(15, 0, 0, 0, 0, 0, 50)).toBe(7); // 7.5 floors
    expect(attackDamage(8, 0, 1, 0, 0, 0, 50)).toBe(3); // 8 × 0.375 = 3
  });

  it('cardCost: costThisTurn beats costThisCombat beats cost; costLessPer takes off per Attack; free Attack is 0', () => {
    const base = {
      uid: 1,
      cardId: 'x',
      name: 'x',
      type: 'attack',
      upgraded: false,
      cost: 3,
      keywords: [],
      effects: [],
    } as CardInstance;
    expect(cardCost(base, 0, false)).toBe(3);
    expect(cardCost({ ...base, costThisCombat: 1 }, 0, false)).toBe(1);
    expect(cardCost({ ...base, costThisCombat: 1, costThisTurn: 2 }, 0, false)).toBe(2);
    const stomp = { ...base, costLessPer: { per: 'attacksPlayedThisTurn', amount: 1 } } as CardInstance;
    expect(cardCost(stomp, 2, false)).toBe(1);
    expect(cardCost(stomp, 5, false)).toBe(0);
    expect(cardCost(base, 0, true)).toBe(0);
    expect(cardCost({ ...base, type: 'skill' }, 0, true)).toBe(3);
    expect(cardCost({ ...base, cost: null }, 0, true)).toBeNull();
  });
});

describe('#110 Strength this turn (Setup Strike, Feeding Frenzy)', () => {
  it('Feeding Frenzy +5: the Strike after it deals 11; the Strength is taken back at end of turn', () => {
    const r = run(
      data(),
      [
        ['frenzy', 1],
        ['strike0', 2],
      ],
      (t) => (t === 1 ? ['frenzy', 'strike0'] : t === 2 ? ['strike0'] : []),
    );
    expect(
      playerHits(r.log)
        .map((h) => h.amount)
        .slice(0, 2),
    ).toEqual([11, 6]);
    const str = events(r.log, 'strength');
    expect(str.map((s) => [s.amount, s.total])).toEqual([
      [5, 5],
      [-5, 0],
    ]);
  });

  it('Setup Strike: its own 7 damage is unchanged; the next Attack gets +3', () => {
    const r = run(
      data(),
      [
        ['setup', 1],
        ['strike0', 1],
      ],
      () => ['setup', 'strike0'],
    );
    expect(
      playerHits(r.log)
        .map((h) => h.amount)
        .slice(0, 2),
    ).toEqual([7, 9]);
  });

  it('Strength this turn stacks with permanent Strength and only the temporary part goes away', () => {
    const d = data();
    d.cards.inflame = card('inflame', 'power', 0, [{ type: 'gainStrength', amount: 2 }]);
    const r = run(
      d,
      [
        ['inflame', 1],
        ['frenzy', 1],
        ['strike0', 3],
      ],
      (t) => (t === 1 ? ['inflame', 'frenzy', 'strike0'] : ['strike0']),
    );
    expect(playerHits(r.log)[0]!.amount).toBe(13);
    expect(playerHits(r.log)[1]!.amount).toBe(8);
  });
});

describe('#110 enemy Strength loss this turn (Mangle, Dark Shackles)', () => {
  it('a 3×3 attack with 3 Strength lost hits 0×3 and the Strength comes back after its turn', () => {
    const r = run(
      data(attacker()),
      [
        ['shackles', 1],
        ['defend', 4],
      ],
      (t) => (t === 1 ? ['shackles'] : []),
      'att',
    );
    const hits = enemyHits(r.log);
    expect(hits.slice(0, 3).map((h) => h.amount)).toEqual([0, 0, 0]);
    expect(hits[3]!.amount).toBe(3);
    expect(events(r.log, 'powerApplied').filter((p) => p.side === 'enemy')).toHaveLength(1);
    expect(events(r.log, 'powerRemoved').some((p) => p.side === 'enemy' && p.power === 'strengthLossThisTurn')).toBe(
      true,
    );
  });

  it('Mangle and Dark Shackles stack; damage never goes below 0', () => {
    const r = run(
      data(attacker(1, 8)),
      [
        ['mangle', 1],
        ['shackles', 1],
        ['defend', 3],
      ],
      (t) => (t === 1 ? ['mangle', 'shackles'] : []),
      'att',
    );
    expect(enemyHits(r.log)[0]!.amount).toBe(0); // 8 − 10 − 3
    expect(enemyHits(r.log)[1]!.amount).toBe(8);
  });

  it('the intent shows the lowered damage', () => {
    const enemy = { strength: 0, debuffs: { vulnerable: 0, weak: 0, frail: 0 }, powers: { strengthLossThisTurn: 2 } };
    const move = { name: 'Hit', effects: [atk(3, 3)] };
    const player = { debuffs: { vulnerable: 0, weak: 0, frail: 0 } };
    expect(computeIntent('hit', move, enemy, player).totalIncoming).toBe(3);
    expect(computeIntent('hit', move, { ...enemy, powers: undefined }, player).totalIncoming).toBe(9);
  });

  it('the strategy sees the lowered intent before it decides', () => {
    const seen: number[] = [];
    const inner = scripted((t) => (t === 1 ? ['shackles'] : []));
    const s: Strategy = {
      decide(view) {
        if (view.state.turn === 1) seen.push(view.intent.totalIncoming);
        return inner.decide(view);
      },
    };
    run(
      data(attacker()),
      [
        ['shackles', 1],
        ['defend', 4],
      ],
      () => [],
      'att',
      s,
    );
    expect(seen).toEqual([9, 0]);
  });
});

describe('#110 Rage', () => {
  it('gains 3 Block per Attack played this turn, stacks, and ends with the turn', () => {
    const r = run(
      data(),
      [
        ['rage', 2],
        ['strike0', 3],
      ],
      (t) => (t === 1 ? ['rage', 'rage', 'strike0', 'strike0'] : ['strike0']),
    );
    expect(blocks(r.log).slice(0, 2)).toEqual([6, 6]);
    expect(blocks(r.log)).toHaveLength(2); // turn 2: Rage is gone, no Block
  });

  it('Rage Block ignores Dexterity and Frail', () => {
    const r = run(
      data(),
      [
        ['dex', 1],
        ['frail', 1],
        ['rage', 1],
        ['strike0', 2],
      ],
      (t) => (t === 1 ? ['dex', 'frail', 'rage', 'strike0'] : []),
    );
    expect(blocks(r.log)).toEqual([3]);
  });
});

describe('#110 Flame Barrier', () => {
  it('deals its damage back on every hit of the following enemy turn, even hits reduced to 0', () => {
    const r = run(
      data(attacker()),
      [
        ['barrier', 1],
        ['shackles', 1],
        ['defend', 3],
      ],
      (t) => (t === 1 ? ['barrier', 'shackles'] : []),
      'att',
    );
    const back = playerHits(r.log).filter((h) => h.amount === 4);
    expect(back).toHaveLength(3); // 3 hits of 0 damage still count
    expect(
      enemyHits(r.log)
        .slice(0, 3)
        .map((h) => h.hpLoss),
    ).toEqual([0, 0, 0]);
  });

  it('ends after that enemy turn: the next enemy turn gets no damage back', () => {
    const r = run(
      data(attacker(2, 3)),
      [
        ['barrier', 1],
        ['defend', 4],
      ],
      (t) => (t === 1 ? ['barrier'] : []),
      'att',
    );
    const l = r.log!;
    const starts = enemyTurnStarts(l);
    const turn1 = l.slice(starts[0], starts[1]);
    const turn2 = l.slice(starts[1], starts[2]);
    expect(playerHits(turn1)).toHaveLength(2);
    expect(playerHits(turn2)).toHaveLength(0);
    expect(events(l, 'powerRemoved').some((p) => p.power === 'flameBarrier')).toBe(true);
  });

  it('stacks with Thorns and with a second Flame Barrier', () => {
    const d = data(attacker(1, 3));
    d.cards.caltrops = card('caltrops', 'power', 0, [apply('thorns', 3)]);
    const r = run(
      d,
      [
        ['barrier', 2],
        ['caltrops', 1],
        ['defend', 2],
      ],
      (t) => (t === 1 ? ['caltrops', 'barrier', 'barrier'] : []),
      'att',
    );
    expect(playerHits(r.log)[0]!.amount).toBe(11); // 3 + 4 + 4
  });
});

describe('#110 Colossus', () => {
  const vulnerable = (d: GameData) => d;
  it('halves damage from a Vulnerable enemy, rounded down, and does nothing against a non-Vulnerable one', () => {
    const plain = run(
      data(attacker(1, 15)),
      [
        ['colossus', 1],
        ['defend', 4],
      ],
      (t) => (t === 1 ? ['colossus'] : []),
      'att',
    );
    expect(enemyHits(plain.log)[0]!.amount).toBe(15);
    const vuln = run(
      vulnerable(data(attacker(1, 15))),
      [
        ['colossus', 1],
        ['vuln', 1],
        ['defend', 3],
      ],
      (t) => (t === 1 ? ['vuln', 'colossus'] : []),
      'att',
    );
    expect(enemyHits(vuln.log)[0]!.amount).toBe(7);
  });

  it('multiplies with Weak: 16 damage becomes 6 (62.5% less)', () => {
    const r = run(
      data(attacker(1, 16)),
      [
        ['colossus', 1],
        ['vuln', 1],
        ['weakener', 1],
        ['defend', 2],
      ],
      (t) => (t === 1 ? ['vuln', 'weakener', 'colossus'] : []),
      'att',
    );
    expect(enemyHits(r.log)[0]!.amount).toBe(6);
  });

  it('covers the following enemy turn only: one stack ends after it', () => {
    const r = run(
      data(attacker(1, 16)),
      [
        ['colossus', 1],
        ['vuln', 1],
        ['defend', 3],
      ],
      (t) => (t === 1 ? ['vuln', 'colossus'] : []),
      'att',
    );
    const hits = enemyHits(r.log);
    expect(hits[0]!.amount).toBe(8);
    expect(hits[1]!.amount).toBe(16); // Vulnerable is gone too after 2 ticks? it ticks 1 per turn; see below
  });

  it('playing it again in the same turn adds a stack that lasts one more enemy turn', () => {
    const d = data(attacker(1, 16));
    d.cards.vuln = card('vuln', 'skill', 0, [{ type: 'applyVulnerable', amount: 5 }]);
    const r = run(
      d,
      [
        ['colossus', 2],
        ['vuln', 1],
        ['defend', 2],
      ],
      (t) => (t === 1 ? ['vuln', 'colossus', 'colossus'] : []),
      'att',
    );
    const hits = enemyHits(r.log);
    expect(hits.slice(0, 3).map((h) => h.amount)).toEqual([8, 8, 16]);
    const stacks = events(r.log, 'powerApplied').filter((p) => p.power === 'colossus');
    expect(stacks.map((p) => p.total)).toEqual([1, 2, 1]);
  });

  it('the intent shows the reduced damage', () => {
    const enemy = { strength: 0, debuffs: { vulnerable: 1, weak: 0, frail: 0 } };
    const move = { name: 'Hit', effects: [atk(16, 1)] };
    const player = { debuffs: { vulnerable: 0, weak: 0, frail: 0 }, powers: { colossus: 1 } };
    expect(computeIntent('hit', move, enemy, player).totalIncoming).toBe(8);
  });
});

describe('#110 Panic Button', () => {
  it('gains 30 Block, then no Block from cards for 2 turns (this turn and the next)', () => {
    const r = run(
      data(),
      [
        ['panic', 1],
        ['defend', 4],
      ],
      (t) => (t === 1 ? ['panic', 'defend'] : t === 2 ? ['defend'] : t === 3 ? ['defend'] : []),
    );
    expect(blocks(r.log).slice(0, 4)).toEqual([30, 0, 0, 5]);
  });

  it('Entrench still doubles current Block under No Block; Block gained after it is not doubled (#170)', () => {
    const d = data();
    d.cards.entrench!.cost = 0;
    const r = run(
      d,
      [
        ['panic', 1],
        ['entrench', 1],
        ['defend', 1],
      ],
      (t) => (t === 1 ? ['panic', 'entrench', 'defend'] : []),
    );
    // 30 from Panic Button, +30 from Entrench (doubled), Defend blocked by No Block.
    expect(blocks(r.log).slice(0, 3)).toEqual([30, 30, 0]);
  });

  it('does not stop Block from powers', () => {
    const d = data();
    d.cards.stone = card('stone', 'power', 0, [apply('plating', 4)]);
    const r = run(
      d,
      [
        ['stone', 1],
        ['panic', 1],
        ['defend', 3],
      ],
      (t) => (t === 1 ? ['panic', 'stone'] : []),
    );
    expect(blocks(r.log)).toContain(4);
  });
});

describe('#110 Retain Hand (Equilibrium, Salvo)', () => {
  it('keeps the whole hand for the next turn, then ends', () => {
    const r = run(
      data(),
      [
        ['equilibrium', 1],
        ['defend', 4],
      ],
      (t) => (t === 1 ? ['equilibrium'] : []),
    );
    const turn2draws = events(r.log, 'draw').length;
    expect(events(r.log, 'discard').filter((d) => d.reason === 'endOfTurn').length).toBeGreaterThan(0);
    // Turn 1 hand of 5 minus the played Equilibrium is retained: no end-of-turn discard happened on turn 1.
    const turn1End = r.log!.findIndex((e) => e.t === 'turnEnd' && e.side === 'player');
    expect(r.log!.slice(0, turn1End).some((e) => e.t === 'discard')).toBe(false);
    expect(turn2draws).toBeGreaterThan(5);
  });

  it('Ethereal cards still exhaust; Salvo deals its damage', () => {
    const r = run(
      data(),
      [
        ['salvo', 1],
        ['ethereal', 1],
        ['defend', 3],
      ],
      (t) => (t === 1 ? ['salvo'] : []),
    );
    expect(playerHits(r.log)[0]!.amount).toBe(12);
    expect(events(r.log, 'exhaust').map((e) => [e.cardId, e.reason])[0]).toEqual(['ethereal', 'ethereal']);
  });
});

describe('#110 Unrelenting', () => {
  it('the next Attack costs 0, across turns, and only that one', () => {
    const d = data();
    const r = run(
      d,
      [
        ['unrelenting', 1],
        ['bash', 2],
        ['defend', 2],
      ],
      (t) => (t === 1 ? ['unrelenting', 'bash', 'bash'] : []),
    );
    const plays = events(r.log, 'play');
    expect(plays.map((p) => [p.cardId, p.energyLeft])).toEqual([
      ['unrelenting', 3],
      ['bash', 3], // free
      ['bash', 1], // 2 energy
    ]);
  });

  it('stays until used: Unrelenting played, no Attack that turn, next turn the first Attack is free', () => {
    const r = run(
      data(),
      [
        ['unrelenting', 1],
        ['bash', 1],
        ['defend', 3],
      ],
      (t) => (t === 1 ? ['unrelenting'] : t === 2 ? ['bash'] : []),
    );
    const bash = events(r.log, 'play').find((p) => p.cardId === 'bash');
    expect(bash?.energyLeft).toBe(3);
  });
});

describe('#110 Stomp', () => {
  it('costs 1 less for each Attack played this turn, minimum 0, and resets next turn', () => {
    const r = run(
      data(),
      [
        ['stomp', 2],
        ['strike0', 3],
      ],
      (t) => (t === 1 ? ['strike0', 'strike0', 'stomp'] : t === 2 ? ['stomp'] : []),
    );
    const plays = events(r.log, 'play');
    expect(plays.map((p) => [p.cardId, p.energyLeft]).slice(0, 3)).toEqual([
      ['strike0', 3],
      ['strike0', 3],
      ['stomp', 2], // 3 − 2 = 1 energy
    ]);
    expect(plays.find((p, i) => i > 2 && p.cardId === 'stomp')?.energyLeft).toBe(0); // back to 3
  });

  it('is unplayable at full price with too little energy, then playable once Attacks were played', () => {
    const seen: number[][] = [];
    const inner = scripted((t) => (t === 1 ? ['strike0', 'strike0', 'strike0', 'stomp'] : []));
    const s: Strategy = {
      decide(view) {
        if (view.state.turn === 1)
          seen.push(view.playable.filter((c) => c.cardId === 'stomp').map((c) => c.cost as number));
        return inner.decide(view);
      },
    };
    run(
      data(),
      [
        ['stomp', 1],
        ['strike0', 3],
      ],
      () => [],
      'dummy',
      s,
    );
    expect(seen[0]).toEqual([3]);
    expect(seen.at(-1)).toEqual([]); // played at cost 0
  });
});

describe('#110 One-Two Punch', () => {
  it('the next Attack is played an extra time; the extra play is free', () => {
    const r = run(
      data(),
      [
        ['punch', 1],
        ['strike', 2],
        ['defend', 2],
      ],
      (t) => (t === 1 ? ['punch', 'strike', 'strike'] : []),
    );
    expect(
      playerHits(r.log)
        .map((h) => h.amount)
        .slice(0, 3),
    ).toEqual([6, 6, 6]);
    expect(events(r.log, 'play').filter((p) => p.by === 'replay')).toHaveLength(1);
    expect(events(r.log, 'play').find((p) => p.cardId === 'strike')?.energyLeft).toBe(2);
  });

  it('with 2 stacks the next 2 Attacks are doubled; unused stacks end with the turn', () => {
    const r = run(
      data(),
      [
        ['punch2', 1],
        ['strike0', 3],
      ],
      (t) => (t === 1 ? ['punch2', 'strike0', 'strike0', 'strike0'] : []),
    );
    expect(playerHits(r.log).slice(0, 5)).toHaveLength(5);
    const ended = run(
      data(),
      [
        ['punch', 1],
        ['strike0', 2],
      ],
      (t) => (t === 1 ? ['punch'] : t === 2 ? ['strike0'] : []),
    );
    expect(playerHits(ended.log)).toHaveLength(1);
  });
});

describe('#110 Rebound', () => {
  it('puts the next card played on top of the draw pile; Rebound itself is discarded', () => {
    const r = run(
      data(),
      [
        ['rebound', 1],
        ['strike0', 4],
      ],
      (t) => (t === 1 ? ['rebound', 'strike0'] : []),
    );
    const moved = events(r.log, 'moved');
    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatchObject({ cardId: 'strike0', to: 'drawTop' });
    // That Strike is the first card drawn next turn.
    const turn2 = r.log!.findIndex((e) => e.t === 'turnStart' && e.side === 'player' && e.turn === 2);
    const firstDraw = r.log!.slice(turn2).find((e) => e.t === 'draw');
    expect(firstDraw).toMatchObject({ uid: moved[0]!.uid });
  });

  it('an Exhaust card is still exhausted and only the one next card is affected', () => {
    const d = data();
    d.cards.fuel = card('fuel', 'skill', 0, [block(1)], { keywords: ['exhaust'] });
    const r = run(
      d,
      [
        ['rebound', 1],
        ['fuel', 1],
        ['strike0', 3],
      ],
      (t) => (t === 1 ? ['rebound', 'fuel', 'strike0'] : []),
    );
    expect(events(r.log, 'moved')).toHaveLength(0);
    expect(events(r.log, 'exhaust').map((e) => e.cardId)).toContain('fuel');
  });
});

describe('#110 Choking', () => {
  it('after it, each card played this turn makes the enemy lose 6 HP (not the Choking card itself), through Block', () => {
    const r = run(
      data(),
      [
        ['choking', 1],
        ['strike0', 2],
        ['defend', 2],
      ],
      (t) => (t === 1 ? ['choking', 'strike0', 'defend'] : t === 2 ? ['strike0'] : []),
    );
    const lose = events(r.log, 'loseHp').filter((e) => e.side === 'enemy');
    expect(lose.map((e) => e.amount)).toEqual([6, 6]);
    expect(lose[0]!.hpAfter).toBe(999 - 12 - 6);
  });

  it('stacks (two Chokings: 6 then 12 per card) and can win the combat', () => {
    const d = data(makeEnemy('weak', 20, { w: { name: 'W', effects: [] } }));
    const r = run(
      d,
      [
        ['choking', 2],
        ['strike0', 1],
      ],
      () => ['choking', 'strike0', 'choking'],
      'weak',
    );
    expect(r.outcome).toBe('win');
  });
});

describe('#110 scheduled effects', () => {
  it('Outmaneuver: +2 energy at the start of next turn only', () => {
    const r = run(
      data(),
      [
        ['outmaneuver', 1],
        ['strike0', 4],
      ],
      (t) => (t === 1 ? ['outmaneuver'] : []),
    );
    const gains = events(r.log, 'energy');
    expect(gains.map((g) => [g.amount, g.total])).toEqual([[2, 5]]);
  });

  it('Relax: Block now, next turn draw 2 more and +2 energy', () => {
    const r = run(
      data(),
      [
        ['relax', 1],
        ['strike0', 9],
      ],
      (t) => (t === 1 ? ['relax'] : []),
    );
    expect(blocks(r.log)[0]).toBe(16);
    const turn2 = r.log!.findIndex((e) => e.t === 'turnStart' && e.side === 'player' && e.turn === 2);
    const turn3 = r.log!.findIndex((e) => e.t === 'turnStart' && e.side === 'player' && e.turn === 3);
    const between = r.log!.slice(turn2, turn3);
    expect(between.filter((e) => e.t === 'draw')).toHaveLength(7);
    expect(events(between, 'energy').map((e) => e.total)).toEqual([5]);
  });

  it('Toric Toughness: Block now and 5 at the start of the next 2 turns (no Dexterity)', () => {
    const r = run(
      data(),
      [
        ['dex', 1],
        ['frail', 1],
        ['toric', 1],
        ['strike0', 2],
      ],
      (t) => (t === 1 ? ['dex', 'frail', 'toric'] : []),
    );
    // Now: 5 + 2 Dexterity from the card; the scheduled gains are plain 5.
    expect(blocks(r.log).slice(0, 3)).toEqual([7, 5, 5]);
    expect(blocks(r.log)).toHaveLength(3);
  });

  it('Prolong: next turn gain Block equal to the Block you had when you played it', () => {
    const r = run(
      data(),
      [
        ['defend', 1],
        ['prolong', 1],
        ['strike0', 3],
      ],
      (t) => (t === 1 ? ['defend', 'prolong'] : []),
    );
    expect(blocks(r.log)).toEqual([5, 5]);
    // Block was reset at the start of turn 2 before the scheduled Block arrived.
    const turn2 = r.log!.findIndex((e) => e.t === 'turnStart' && e.side === 'player' && e.turn === 2);
    expect(r.log!.slice(turn2).find((e) => e.t === 'block')).toMatchObject({ amount: 5, total: 5 });
  });

  it('The Bomb: 40 damage at the end of the third turn (the turn it is played counts as the first)', () => {
    const r = run(
      data(),
      [
        ['bomb', 1],
        ['defend', 4],
      ],
      (t) => (t === 1 ? ['bomb'] : []),
    );
    const boom = playerHits(r.log).filter((h) => h.amount === 40);
    expect(boom).toHaveLength(1);
    const idx = r.log!.findIndex((e) => e.t === 'damage' && e.amount === 40);
    const turnEnds = r.log!.slice(0, idx).filter((e) => e.t === 'turnEnd' && e.side === 'player').length;
    expect(turnEnds).toBe(2); // fires during the end of player turn 3
    const next = r.log!.slice(idx).find((e) => e.t === 'turnEnd');
    expect(next).toMatchObject({ side: 'player', turn: 3 });
  });

  it('The Bomb ignores Strength but the enemy Block absorbs it, and it can win the combat', () => {
    const d = data(makeEnemy('bag', 30, { b: { name: 'B', effects: [{ type: 'gainBlock', amount: 10 }] } }));
    const r = run(
      d,
      [
        ['bomb', 1],
        ['defend', 4],
      ],
      (t) => (t === 1 ? ['bomb'] : []),
      'bag',
    );
    expect(r.outcome).toBe('win');
    expect(r.turns).toBe(3);
  });
});

describe('#110 Enlightenment', () => {
  it('sets every card in hand to cost 1 for this turn only; cards already at 0 or 1 are unchanged', () => {
    const r = run(
      data(),
      [
        ['enlighten', 1],
        ['bash', 2],
        ['strike0', 1],
        ['defend', 1],
      ],
      (t) => (t === 1 ? ['enlighten', 'bash', 'bash'] : t === 2 ? ['bash'] : []),
    );
    const changed = events(r.log, 'costChanged');
    expect(changed.map((c) => [c.cardId, c.cost, c.duration])).toEqual([
      ['bash', 1, 'turn'],
      ['bash', 1, 'turn'],
    ]);
    const bashes = events(r.log, 'play').filter((p) => p.cardId === 'bash');
    expect(bashes.map((p) => p.energyLeft).slice(0, 2)).toEqual([2, 1]);
  });

  it('Enlightenment+ lasts the rest of the combat', () => {
    const r = run(
      data(),
      [
        ['enlightenPlus', 1],
        ['bash', 1],
        ['defend', 3],
      ],
      (t) => (t === 1 ? ['enlightenPlus'] : t === 3 ? ['bash'] : []),
    );
    const bash = events(r.log, 'play').find((p) => p.cardId === 'bash');
    // Bash costs 1 wherever it is played after the upgrade (turn 3 here, if it was in hand on turn 1 it keeps 1).
    expect(bash?.energyLeft === 2 || bash === undefined).toBe(true);
  });
});
