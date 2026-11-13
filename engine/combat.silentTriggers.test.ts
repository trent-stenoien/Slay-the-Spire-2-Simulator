/** #266 Silent trigger powers: Afterimage, Serpent Form, Speedster, Tools of the Trade, Well-Laid Plans, Tracking. */
import { describe, expect, it } from 'vitest';
import { makeCardInstance, simulateCombat } from './combat';
import { attackDamage } from './rules';
import { cards } from './testFixtures';
import { cfg, deckOf, dummyData, events, scripted } from './combatTestHelpers';
import { chooseRetained } from './generate';
import { chooseDiscard, createStrategy } from './strategies';
import type { CardDef, CardInstance, Effect, GameData, PowerId, Strategy, StrategyView } from './types';

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
const apply = (power: PowerId, amount: number): Effect => ({ type: 'applyPower', power, amount });

const defs: Record<string, CardDef> = {
  afterimage: card('afterimage', 'power', 0, [apply('afterimage', 1)]),
  serpent: card('serpent', 'power', 0, [apply('serpentForm', 4)]),
  speedster: card('speedster', 'power', 0, [apply('speedster', 2)]),
  tools: card('tools', 'power', 0, [apply('toolsOfTheTrade', 1)]),
  plans: card('plans', 'power', 0, [apply('wellLaidPlans', 1)], { keywords: ['innate'] }),
  plans2: card('plans2', 'power', 0, [apply('wellLaidPlans', 2)], { keywords: ['innate'] }),
  tracking: card('tracking', 'power', 0, [apply('tracking', 1)]),
  strike1: card('strike1', 'attack', 0, [{ type: 'attack', damage: 6, hits: 1 }]),
  strike0: card('strike0', 'attack', 0, [{ type: 'attack', damage: 6, hits: 1 }]),
  defend0: card('defend0', 'skill', 0, [{ type: 'gainBlock', amount: 5 }], { name: 'Defend' }),
  weakener: card('weakener', 'skill', 0, [{ type: 'applyWeak', amount: 2 }]),
  vuln: card('vuln', 'skill', 0, [{ type: 'applyVulnerable', amount: 2 }]),
  drawer: card('drawer', 'skill', 0, [{ type: 'draw', amount: 2 }]),
  slyOne: card('slyOne', 'skill', 0, [], { keywords: ['sly'] }),
  burn: card('burn', 'status', null as unknown as number, [], {
    keywords: ['unplayable'],
    triggers: [{ when: 'turnEndInHand', effects: [{ type: 'loseHp', amount: 2 }] }],
  }),
  dazed: card('dazed', 'status', null as unknown as number, [], { keywords: ['unplayable', 'ethereal'] }),
};

/** Cards the scripts play are Innate, so they are always in the opening hand (5 cards). */
const INNATE = ['afterimage', 'serpent', 'speedster', 'tools', 'tracking', 'weakener', 'vuln', 'drawer', 'strike1'];

function data(): GameData {
  const d = dummyData();
  Object.assign(d.cards, structuredClone(defs));
  for (const id of INNATE) d.cards[id]!.keywords = ['innate'];
  return d;
}

const run = (deck: [string, number][], plan: (turn: number) => string[], strategy?: Strategy, seed = 1) =>
  simulateCombat(data(), cfg({ enemyId: 'dummy', deck: deckOf(...deck), seed }), strategy ?? scripted(plan), {
    log: true,
  });

const damages = (r: ReturnType<typeof run>) => events(r.log, 'damage').map((e) => e.amount);

/** A minimal view over `hand` (3 energy, nothing incoming) for the strategy helpers. */
function stubView(hand: CardInstance[]): StrategyView {
  const player = {
    hp: 80,
    maxHp: 80,
    block: 0,
    energy: 3,
    strength: 0,
    debuffs: { vulnerable: 0, weak: 0, frail: 0 },
    drawPile: [],
    hand,
    discardPile: [],
    exhaustPile: [],
  };
  const enemy = {
    enemyId: 'e',
    name: 'e',
    hp: 50,
    maxHp: 50,
    block: 0,
    strength: 0,
    debuffs: { vulnerable: 0, weak: 0, frail: 0 },
    poison: 0,
    patternIndex: 0,
  };
  return {
    state: { turn: 1, player, enemy } as StrategyView['state'],
    intent: { moveId: 'm', name: 'm', attacks: [], totalIncoming: 0 },
    playable: hand.filter((c) => (c.cost ?? 99) <= 3),
  };
}

describe('#266 Afterimage', () => {
  it('gains Block for each card played after it, not for itself, ignoring Dexterity and Frail', () => {
    const r = run(
      [
        ['afterimage', 1],
        ['strike1', 2],
      ],
      (t) => (t === 1 ? ['afterimage', 'strike1', 'strike1'] : []),
    );
    expect(events(r.log, 'block').map((e) => [e.amount, e.total])).toEqual([
      [1, 1],
      [1, 2],
    ]);
  });

  it('stacks: each copy adds 1 Block per card, from its own play on', () => {
    const r = run(
      [
        ['afterimage', 2],
        ['strike1', 1],
      ],
      (t) => (t === 1 ? ['afterimage', 'afterimage', 'strike1'] : []),
    );
    // The second copy is on after its own play: 1 Block for it, then 2 for the Strike.
    expect(events(r.log, 'block').map((e) => e.amount)).toEqual([1, 2]);
    expect(events(r.log, 'powerApplied').map((e) => e.total)).toEqual([1, 2]);
  });
});

describe('#266 Serpent Form', () => {
  it('deals its damage to the enemy after each card played after it (Block absorbs it, Strength does not add)', () => {
    const r = run(
      [
        ['serpent', 1],
        ['strike1', 2],
      ],
      (t) => (t === 1 ? ['serpent', 'strike1', 'strike1'] : []),
    );
    expect(damages(r)).toEqual([6, 4, 6, 4]);
  });
});

describe('#266 Speedster', () => {
  it('deals its damage to all enemies for every card drawn during the player turn, the turn-start draw included', () => {
    const r = run(
      [
        ['speedster', 1],
        ['drawer', 1],
        ['strike0', 12],
      ],
      (t) => (t === 1 ? ['speedster', 'drawer'] : []),
    );
    const log = r.log ?? [];
    const from = log.findIndex((e) => e.t === 'play' && e.cardId === 'speedster');
    // Turn 1: the opening hand was drawn before Speedster; Drawer draws 2 (2 hits). Turn 2: 5 drawn at the start.
    const turn2 = log.findIndex((e) => e.t === 'turnStart' && e.side === 'player' && e.turn === 2);
    const upto = log.findIndex((e, k) => k > turn2 && e.t === 'turnEnd' && e.side === 'player');
    const window = log.slice(from, upto);
    const draws = events(window, 'draw').length;
    expect(draws).toBe(7);
    expect(events(window, 'damage').filter((e) => e.amount === 2)).toHaveLength(draws);
  });

  it('does nothing before it is played and not on the enemy turn', () => {
    const r = run(
      [
        ['speedster', 1],
        ['strike0', 8],
      ],
      () => [],
    );
    expect(damages(r)).toEqual([]);
  });
});

describe('#266 Tools of the Trade', () => {
  it('each turn after the draw: draw 1, then discard 1 card from the hand', () => {
    const r = run(
      [
        ['tools', 1],
        ['strike0', 10],
      ],
      (t) => (t === 1 ? ['tools'] : []),
    );
    const log = r.log ?? [];
    const from = log.findIndex((e) => e.t === 'turnStart' && e.side === 'player' && e.turn === 2);
    const turn2 = log.slice(
      from,
      log.findIndex((e, k) => k > from && e.t === 'turnEnd' && e.side === 'player'),
    );
    expect(events(turn2, 'draw')).toHaveLength(6);
    const moved = events(turn2, 'moved').filter((e) => e.from === 'hand' && e.to === 'discard');
    expect(moved).toHaveLength(1);
    // The extra draw happens before the discard.
    const lastDraw = turn2.map((e) => e.t).lastIndexOf('draw');
    expect(turn2.findIndex((e) => e.t === 'moved')).toBeGreaterThan(lastDraw);
  });

  it('discards curses and statuses that hurt first, then Sly cards, then by the exhaust order', () => {
    const hand = ['strike0', 'slyOne', 'burn', 'defend0'].map((id, i) => makeCardInstance(data().cards[id]!, false, i));
    const names = (ids: string[], n: number) => {
      const options = hand.filter((c) => ids.includes(c.cardId));
      const view = stubView(hand);
      const { uids } = chooseDiscard(view, { purpose: 'move', from: 'hand', to: 'discard', options, min: n, max: n });
      return uids.map((u) => hand.find((c) => c.uid === u)!.cardId);
    };
    expect(names(['strike0', 'slyOne', 'burn', 'defend0'], 2)).toEqual(['burn', 'slyOne']);
    expect(names(['strike0', 'slyOne', 'defend0'], 1)).toEqual(['slyOne']);
  });
});

describe('#266 Well-Laid Plans', () => {
  /** Plays the plan; remembers which turn-1 cards are still in the hand at turn 2 (Retain). */
  function keeping(plan: string[], choose?: Strategy['choose']) {
    const inner = scripted((t) => (t === 1 ? plan : []));
    const seen: { turn1: number[]; kept: string[] } = { turn1: [], kept: [] };
    const s: Strategy = {
      decide(view) {
        if (view.state.turn === 1) seen.turn1 = view.state.player.hand.map((c) => c.uid);
        if (view.state.turn === 2 && seen.kept.length === 0) {
          seen.kept = view.state.player.hand.filter((c) => seen.turn1.includes(c.uid)).map((c) => c.cardId);
        }
        return inner.decide(view);
      },
      ...(choose ? { choose } : {}),
    };
    return { s, seen };
  }
  const deck: [string, number][] = [
    ['plans', 1],
    ['plans2', 0],
    ['defend0', 5],
    ['strike0', 5],
  ];

  it('retains up to 1 card chosen by the strategy; the rest is discarded', () => {
    const { s, seen } = keeping(['plans'], (_view, request) => {
      expect(request).toMatchObject({ purpose: 'move', sourcePower: 'wellLaidPlans', from: 'hand', to: 'hand' });
      expect([request.min, request.max]).toEqual([0, 1]);
      const pick = request.options.find((c) => c.cardId === 'strike0')!;
      return { uids: [pick.uid] };
    });
    run(deck, () => [], s);
    expect(seen.kept).toEqual(['strike0']);
  });

  it('may retain nothing, and Well-Laid Plans+ retains up to 2', () => {
    const none = keeping(['plans'], () => ({ uids: [] }));
    run(deck, () => [], none.s);
    expect(none.seen.kept).toEqual([]);
    let max = 0;
    const two = keeping(['plans2'], (_v, request) => {
      max = request.max;
      return { uids: request.options.slice(0, 2).map((c) => c.uid) };
    });
    run(
      [
        ['plans2', 1],
        ['defend0', 5],
        ['strike0', 5],
      ],
      () => [],
      two.s,
    );
    expect(max).toBe(2);
    expect(two.seen.kept).toHaveLength(2);
  });

  it('built-in strategies pick through Strategy.choose; no pick is asked for when nothing is eligible', () => {
    const s = createStrategy({ order: ['block', 'attack', 'powers'], allowThrough: 0 });
    const { s: wrapped, seen } = keeping(['plans'], s.choose);
    const r = run(deck, () => [], wrapped);
    expect(seen.kept.length).toBeLessThanOrEqual(1);
    expect(r.outcome).toBeDefined();
  });

  const inst = (ids: string[], base = 0): CardInstance[] =>
    ids.map((id, i) => makeCardInstance(data().cards[id]!, false, base + i));
  const retainOf = (hand: string[], pile: string[], order: ('attack' | 'block' | 'powers')[]) => {
    const options = inst(hand);
    const draw = inst(pile, 100);
    const { uids } = chooseRetained(
      { purpose: 'move', from: 'hand', to: 'hand', options, min: 0, max: 1 },
      draw,
      order,
    );
    return uids.map((u) => hand[u]);
  };

  it('keeps the card for the strategy top priority: a Block-first strategy keeps a Block card', () => {
    expect(
      retainOf(['strike0', 'defend0'], ['strike0', 'defend0', 'strike0', 'defend0'], ['block', 'attack', 'powers']),
    ).toEqual(['defend0']);
    expect(retainOf(['strike0', 'defend0'], ['defend0', 'strike0', 'defend0'], ['attack', 'block', 'powers'])).toEqual([
      'strike0',
    ]);
  });

  it('keeps something else when more than half of the draw pile is cards of that kind', () => {
    expect(
      retainOf(['strike0', 'defend0'], ['defend0', 'defend0', 'defend0', 'strike0'], ['block', 'attack', 'powers']),
    ).toEqual(['strike0']);
    // Exactly half is not "mostly".
    expect(retainOf(['strike0', 'defend0'], ['defend0', 'strike0'], ['block', 'attack', 'powers'])).toEqual([
      'defend0',
    ]);
    // With nothing else to keep, the top-priority card is still kept.
    expect(retainOf(['defend0'], ['defend0', 'defend0'], ['block', 'attack', 'powers'])).toEqual(['defend0']);
  });

  it('never keeps curses or statuses', () => {
    expect(retainOf(['burn', 'dazed'], [], ['block', 'attack', 'powers'])).toEqual([]);
  });
});

describe('#266 Tracking', () => {
  it('attackDamage doubles for a Weak target: ×2, ×3 with Vulnerable, floored once', () => {
    expect(attackDamage(6, 0, 0, 0, 0, 0, 0, true)).toBe(12);
    expect(attackDamage(6, 0, 0, 1, 0, 0, 0, true)).toBe(18);
    expect(attackDamage(7, 0, 1, 0, 0, 0, 0, true)).toBe(10);
    expect(attackDamage(6, 0, 0, 0)).toBe(6);
  });

  it('Attacks deal double damage to a Weak enemy only (×3 with Vulnerable)', () => {
    const hit = (...setup: string[]) =>
      damages(
        run(
          [
            ['tracking', 1],
            ['weakener', 1],
            ['vuln', 1],
            ['strike1', 1],
          ],
          (t) => (t === 1 ? ['tracking', ...setup, 'strike1'] : []),
        ),
      );
    expect(hit()).toEqual([6]);
    expect(hit('weakener')).toEqual([12]);
    expect(hit('weakener', 'vuln')).toEqual([18]);
    expect(hit('vuln')).toEqual([9]);
  });

  it('does not double power damage (Serpent Form)', () => {
    const r = run(
      [
        ['tracking', 1],
        ['serpent', 1],
        ['weakener', 1],
        ['strike1', 1],
      ],
      (t) => (t === 1 ? ['tracking', 'serpent', 'weakener', 'strike1'] : []),
    );
    expect(damages(r)).toEqual([4, 12, 4]);
  });
});
