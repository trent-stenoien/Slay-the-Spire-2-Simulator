/** #115 Statuses, healing and Max HP: heal, Feed, Brightest Flame, Intangible, The Gambit, Stun, curse and status triggers. */
import { describe, expect, it } from 'vitest';
import { simulateCombat } from './combat';
import { cards, makeEnemy } from './testFixtures';
import { cfg, deckOf, dummy, events, logged, scripted, withEnemy } from './combatTestHelpers';
import { makeGameData } from './testFixtures';
import { blockFirstConfig, createStrategy, GREEDY_CONFIG } from './strategies';
import type { CardDef, CardTrigger, Effect } from './types';

const card = (id: string, code: string, effects: Effect[], extra: Partial<CardDef> = {}): CardDef => ({
  ...cards.defend!,
  id,
  code,
  name: id,
  cost: 0,
  effects,
  upgraded: null,
  ...extra,
});
const junk = (id: string, code: string, triggers: CardTrigger[], extra: Partial<CardDef> = {}): CardDef =>
  card(id, code, [], { type: 'status', cost: null, keywords: ['unplayable'], triggers, ...extra });
const endOfTurn = (...effects: Effect[]): CardTrigger[] => [{ when: 'turnEndInHand', effects }];
const hit = (damage: number): Effect => ({ type: 'attack', damage, hits: 1 });
const lose = (amount: number): Effect => ({ type: 'loseHp', amount });

const extra: Record<string, CardDef> = {
  ouch: card('ouch', 'Ou', [lose(6)]),
  ouch1: card('ouch1', 'O1', [lose(1)]),
  notyet: card('notyet', 'NY', [{ type: 'heal', amount: 10 }], { cost: 2, keywords: ['exhaust'] }),
  flame: card('flame', 'BF', [{ type: 'loseMaxHp', amount: 2 }]),
  feed: card(
    'feed',
    'Fd',
    [hit(10), { type: 'conditional', if: { kind: 'fatal' }, then: [{ type: 'gainMaxHp', amount: 3 }] }],
    { type: 'attack', cost: 1, keywords: ['exhaust'] },
  ),
  appar: card('appar', 'Ap', [{ type: 'applyPower', power: 'intangible', amount: 1 }]),
  gambit: card('gambit', 'TG', [
    { type: 'gainBlock', amount: 50 },
    { type: 'applyPower', power: 'gambit', amount: 1 },
  ]),
  whistle: card('whistle', 'Wi', [hit(3), { type: 'applyEnemyPower', power: 'stun', amount: 1 }], { type: 'attack' }),
  guard: card('guard', 'Gu', [{ type: 'gainBlock', amount: 20 }]),
  burn: junk('burn', 'B9', endOfTurn(hit(2))),
  badluck: junk('badluck', 'BL', endOfTurn(lose(13)), { type: 'curse' }),
  regret: junk('regret', 'Rc', endOfTurn({ type: 'repeat', per: 'handSize', effects: [lose(1)] }), { type: 'curse' }),
  drawnburn: junk('drawnburn', 'Dn', [{ when: 'drawn', effects: [lose(4)] }]),
};

const weak = makeEnemy('weak', 6, { wait: { name: 'Wait', effects: [] } });
const hitter = (dmg: number, hits = 1) =>
  makeEnemy('hitter', 999, { hit: { name: 'Hit', effects: [{ type: 'attack', damage: dmg, hits }] } });

function world(...enemies: ReturnType<typeof makeEnemy>[]) {
  const d = withEnemy(makeGameData(), dummy(), weak, ...enemies);
  Object.assign(d.cards, extra);
  return d;
}

const play = (...turns: string[][]) => scripted((t) => turns[t - 1] ?? []);

describe('#115 heal and hpLost', () => {
  it('#205: Not Yet heals in full for HP lost, past the damage taken (lose 6, heal 10 → −4)', () => {
    const r = logged(world(), play(['ouch', 'notyet', 'strike']), {
      enemyId: 'weak',
      deck: deckOf(['ouch', 1], ['notyet', 1], ['strike', 1]),
    });
    // HP itself stops at Max HP; the event carries the full heal.
    expect(events(r.log, 'heal')).toEqual([{ t: 'heal', amount: 10, hpAfter: 80 }]);
    expect(r.outcome).toBe('win');
    expect(r.hpLost).toBe(-4);
    expect(r.healed).toBe(10);
  });

  it('a heal below Max HP restores its full amount (lose 25, heal 10 → 15)', () => {
    const d = world();
    d.cards.ouch = card('ouch', 'Ou', [lose(25)]);
    const r = logged(d, play(['ouch', 'notyet', 'strike']), {
      enemyId: 'weak',
      deck: deckOf(['ouch', 1], ['notyet', 1], ['strike', 1]),
    });
    expect(events(r.log, 'heal')[0]!.amount).toBe(10);
    expect(r.hpLost).toBe(15);
  });

  it('#205: a heal at full HP still counts in full (HP lost −10)', () => {
    const r = logged(world(), play(['notyet', 'strike']), {
      enemyId: 'weak',
      deck: deckOf(['notyet', 1], ['strike', 1]),
    });
    expect(events(r.log, 'heal')).toEqual([{ t: 'heal', amount: 10, hpAfter: 80 }]);
    expect(r.hpLost).toBe(-10);
  });
});

describe('#115 Max HP (Feed, Brightest Flame)', () => {
  it('Feed raises Max HP and current HP only when its hit kills, lowering HP lost', () => {
    const r = logged(world(), play(['ouch', 'feed']), {
      enemyId: 'weak',
      deck: deckOf(['ouch', 1], ['feed', 1]),
    });
    expect(r.outcome).toBe('win');
    expect(events(r.log, 'maxHp')).toEqual([{ t: 'maxHp', amount: 3, maxHpAfter: 83, hpAfter: 77 }]);
    expect(r.hpLost).toBe(3);
  });

  it('Feed does not raise Max HP when the hit does not kill', () => {
    const r = logged(world(), play(['ouch', 'feed']), {
      enemyId: 'dummy',
      deck: deckOf(['ouch', 1], ['feed', 1]),
    });
    expect(events(r.log, 'maxHp')).toHaveLength(0);
    expect(r.hpLost).toBe(6);
  });

  it('Brightest Flame caps current HP and the HP removed counts as lost (69/70 → 68/68)', () => {
    const r = logged(world(), play(['ouch1', 'flame', 'strike']), {
      enemyId: 'weak',
      deck: deckOf(['ouch1', 1], ['flame', 1], ['strike', 1]),
    });
    expect(events(r.log, 'maxHp')).toEqual([{ t: 'maxHp', amount: -2, maxHpAfter: 78, hpAfter: 78 }]);
    expect(r.hpLost).toBe(2);
  });

  it('Brightest Flame below current HP leaves current HP alone', () => {
    const r = logged(world(), play(['ouch', 'flame', 'strike']), {
      enemyId: 'weak',
      deck: deckOf(['ouch', 1], ['flame', 1], ['strike', 1]),
    });
    expect(events(r.log, 'maxHp')[0]).toEqual({ t: 'maxHp', amount: -2, maxHpAfter: 78, hpAfter: 74 });
    expect(r.hpLost).toBe(6);
  });

  it('#205: HP lost can go below 0 after Feed at full HP (80/80 → 83/83 = −3)', () => {
    const r = logged(world(), play(['feed']), { enemyId: 'weak', deck: deckOf(['feed', 1]) });
    expect(r.hpLost).toBe(-3);
  });
});

describe('#115 Intangible', () => {
  it('every enemy hit becomes 1 for that turn, then ends after the enemy move', () => {
    const d = world(hitter(10, 3));
    const r = logged(d, play(['appar'], []), { enemyId: 'hitter', deck: deckOf(['appar', 1], ['strike', 4]) });
    const dmg = events(r.log, 'damage').filter((e) => e.source === 'enemy');
    expect(dmg.slice(0, 3).map((e) => e.amount)).toEqual([1, 1, 1]);
    expect(dmg.slice(3, 6).map((e) => e.amount)).toEqual([10, 10, 10]);
    expect(events(r.log, 'powerRemoved').some((e) => e.power === 'intangible')).toBe(true);
  });

  it('Block absorbs the 1', () => {
    const r = logged(world(hitter(10, 2)), play(['appar', 'guard']), {
      enemyId: 'hitter',
      deck: deckOf(['appar', 1], ['guard', 1]),
      strategy: { order: ['block', 'powers', 'attack'], allowThrough: 0 },
    });
    const first = events(r.log, 'damage')
      .filter((e) => e.source === 'enemy')
      .slice(0, 2);
    expect(first.map((e) => [e.amount, e.blocked, e.hpLoss])).toEqual([
      [1, 1, 0],
      [1, 1, 0],
    ]);
  });

  it('applies to "take X damage" statuses but not to "lose X HP"', () => {
    const d = world(hitter(0));
    const r = logged(d, play(['appar']), {
      enemyId: 'hitter',
      deck: deckOf(['appar', 1], ['burn', 1], ['badluck', 1]),
    });
    const burn = events(r.log, 'damage').find((e) => e.target === 'player' && e.source === 'player');
    expect(burn).toMatchObject({ amount: 1, hpLoss: 1 });
    expect(events(r.log, 'loseHp')[0]).toMatchObject({ amount: 13 });
  });
});

describe('#115 The Gambit', () => {
  it('fully blocked hits are safe; the Block is gone next turn and the hit kills', () => {
    const r = logged(world(hitter(10)), play(['gambit']), { enemyId: 'hitter', deck: deckOf(['gambit', 1]) });
    const hits = events(r.log, 'damage').filter((e) => e.source === 'enemy');
    expect(hits[0]).toMatchObject({ amount: 10, blocked: 10, hpLoss: 0 });
    expect(r.outcome).toBe('loss');
    expect(r.turns).toBe(2);
  });

  it('one unblocked point of enemy attack damage loses the combat', () => {
    const r = logged(world(hitter(60)), play(['gambit'], []), { enemyId: 'hitter', deck: deckOf(['gambit', 1]) });
    // Turn 1: 60 vs 50 Block → 10 unblocked → dead.
    expect(r.outcome).toBe('loss');
    expect(r.turns).toBe(1);
    expect(r.hpLost).toBe(80);
  });

  it('losing HP from a card is not attack damage', () => {
    const r = logged(world(), play(['gambit', 'ouch', 'strike']), {
      enemyId: 'weak',
      deck: deckOf(['gambit', 1], ['ouch', 1], ['strike', 1]),
    });
    expect(r.outcome).toBe('win');
  });
});

describe("#115 Whistle's Stun", () => {
  const two = makeEnemy(
    'two',
    999,
    {
      a: { name: 'A', effects: [{ type: 'attack', damage: 5, hits: 1 }] },
      b: { name: 'B', effects: [{ type: 'attack', damage: 20, hits: 1 }] },
    },
    ['a', 'b'],
  );

  it('the stunned enemy skips its move (no damage) and its pattern still advances', () => {
    const r = logged(world(two), play(['whistle'], []), {
      enemyId: 'two',
      deck: deckOf(['whistle', 1], ['strike', 2]),
    });
    expect(events(r.log, 'enemySkip')).toEqual([{ t: 'enemySkip', reason: 'stun' }]);
    const moves = events(r.log, 'enemyMove').map((e) => e.moveId);
    expect(moves[0]).toBe('b');
    const hits = events(r.log, 'damage').filter((e) => e.source === 'enemy');
    expect(hits[0]!.amount).toBe(20);
  });

  it('the intent of a stunned enemy shows no damage', () => {
    let seen = -1;
    const probe = {
      decide: (view: Parameters<ReturnType<typeof scripted>['decide']>[0]) => {
        if (view.state.turn === 1) {
          const w = view.playable.find((c) => c.cardId === 'whistle');
          if (w) return { kind: 'play' as const, uid: w.uid };
          seen = view.intent.totalIncoming;
        }
        return { kind: 'endTurn' as const };
      },
    };
    simulateCombat(world(two), cfg({ enemyId: 'two', deck: deckOf(['whistle', 1]) }), probe);
    expect(seen).toBe(0);
  });
});

describe('#115 curse and status triggers', () => {
  it('"take X damage" is blockable', () => {
    const r = logged(world(hitter(0)), play(['guard']), {
      enemyId: 'hitter',
      deck: deckOf(['guard', 1], ['burn', 2]),
    });
    const burns = events(r.log, 'damage').filter((e) => e.source === 'player' && e.target === 'player');
    expect(burns.slice(0, 2).map((e) => [e.amount, e.blocked, e.hpLoss])).toEqual([
      [2, 2, 0],
      [2, 2, 0],
    ]);
  });

  it('unblocked Burn damage costs HP', () => {
    const r = logged(world(hitter(0)), play([]), { enemyId: 'hitter', deck: deckOf(['burn', 2]) });
    expect(events(r.log, 'damage')[0]).toMatchObject({ amount: 2, blocked: 0, hpLoss: 2 });
  });

  it('"lose X HP" ignores Block', () => {
    const r = logged(world(hitter(0)), play(['guard']), {
      enemyId: 'hitter',
      deck: deckOf(['guard', 1], ['badluck', 1]),
    });
    expect(events(r.log, 'loseHp')[0]).toMatchObject({ amount: 13, hpAfter: 67 });
  });

  it('Regret loses 1 HP per card in hand', () => {
    const r = logged(world(hitter(0)), play([]), { enemyId: 'hitter', deck: deckOf(['regret', 1], ['strike', 3]) });
    // Turn 1: Regret + 3 Strikes in hand = 4 cards = 4 HP.
    const losses = events(r.log, 'loseHp');
    expect(losses.slice(0, 4).map((e) => e.hpAfter)).toEqual([79, 78, 77, 76]);
    expect(losses[4]!.hpAfter).toBe(75);
  });

  it('a trigger can kill the player at end of turn', () => {
    const d = world(hitter(0));
    d.cards.badluck = junk('badluck', 'BL', endOfTurn(lose(100)), { type: 'curse' });
    const r = simulateCombat(d, cfg({ enemyId: 'hitter', deck: deckOf(['badluck', 1]) }), play([]));
    expect(r.outcome).toBe('loss');
    expect(r.turns).toBe(1);
  });

  it('a "when drawn" trigger runs when the card is drawn', () => {
    const r = logged(world(hitter(0)), play([]), { enemyId: 'hitter', deck: deckOf(['drawnburn', 1]) });
    expect(events(r.log, 'loseHp')[0]).toMatchObject({ amount: 4 });
    expect(r.log!.findIndex((e) => e.t === 'draw')).toBeLessThan(r.log!.findIndex((e) => e.t === 'loseHp'));
  });
});

describe('#115 strategy: Not Yet', () => {
  const config = { enemyId: 'hitter', deck: deckOf(['notyet', 1], ['strike', 1]) };
  /** The player turn number on which each Not Yet was played. */
  const notYetTurns = (r: ReturnType<typeof logged>) => {
    let turn = 0;
    const out: number[] = [];
    for (const e of r.log!) {
      if (e.t === 'turnStart' && e.side === 'player') turn = e.turn;
      if (e.t === 'play' && e.cardId === 'notyet') out.push(turn);
    }
    return out;
  };

  it('#205: is played with leftover energy even at full HP (every heal counts in full)', () => {
    for (const config_ of [blockFirstConfig(0), GREEDY_CONFIG]) {
      const r = logged(world(hitter(7)), createStrategy(config_), config);
      expect(notYetTurns(r)).toEqual([1]);
      expect(
        events(r.log, 'play')
          .map((e) => e.cardId)
          .slice(0, 2),
      ).toEqual(['strike', 'notyet']);
      expect(events(r.log, 'heal')[0]).toMatchObject({ amount: 10, hpAfter: 80 });
    }
  });

  it('#205: never takes energy the groups want (3 Strikes first, Not Yet waits)', () => {
    const r = logged(world(hitter(7)), createStrategy(GREEDY_CONFIG), {
      enemyId: 'hitter',
      deck: deckOf(['notyet', 1], ['strike', 3]),
    });
    expect(
      events(r.log, 'play')
        .map((e) => e.cardId)
        .slice(0, 3),
    ).toEqual(['strike', 'strike', 'strike']);
    expect(notYetTurns(r)).not.toContain(1);
  });
});
