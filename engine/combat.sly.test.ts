/**
 * #261 Sly: a Sly card discarded from the hand by a card effect during the player's turn is played for free.
 * #314: it plays after the discarding card has finished, several in hand order.
 */
import { describe, expect, it } from 'vitest';
import { simulateCombat } from './combat';
import { cfg, deckOf, dummy, events, withEnemy } from './combatTestHelpers';
import { cards as fixtureCards, makeEnemy, makeGameData } from './testFixtures';
import { gameData } from '../data';
import type {
  CardDef,
  ChoiceRequest,
  ChoiceResponse,
  CombatConfig,
  Effect,
  GameData,
  GameEvent,
  Strategy,
  StrategyView,
} from './types';

const SLY = ['abrasive', 'flick_flack', 'haze', 'reflex', 'ricochet', 'tactician', 'untouchable'];
const REAL = [...SLY, 'survivor', 'storm_of_steel', 'tools_of_the_trade', 'shiv'];

const custom = (id: string, effects: Effect[], extra: Partial<CardDef> = {}): CardDef => ({
  ...fixtureCards.strike!,
  id,
  code: id.slice(0, 2),
  name: id,
  type: 'skill',
  cost: 0,
  effects,
  upgraded: null,
  ...extra,
});

const discardOne: Effect = { type: 'moveCards', from: 'hand', to: 'discard', count: 1, mode: 'choose' };
const idle = (id: string, hp: number) => makeEnemy(id, hp, { wait: { name: 'Wait', effects: [] } });

function data(innate: string[]): GameData {
  const d = withEnemy(makeGameData(), dummy(), idle('frail', 5), idle('a', 500), idle('b', 500), {
    ...dummy(),
    id: 'slowpoke',
    startPowers: { slow: 1 },
  });
  for (const id of REAL) d.cards[id] = structuredClone(gameData.cards[id]!);
  d.cards.pad = custom('pad', []);
  // Discards in the middle of the card: a Sly card waits until the effects after the discard are done (#314).
  d.cards.discardThenBlock = custom('discardThenBlock', [discardOne, { type: 'gainBlock', amount: 5 }]);
  d.cards.discardThenHit = custom('discardThenHit', [discardOne, { type: 'attack', damage: 10, hits: 1 }], {
    type: 'attack',
  });
  d.cards.hitThenDiscard = custom('hitThenDiscard', [{ type: 'attack', damage: 5, hits: 1 }, discardOne], {
    type: 'attack',
  });
  d.cards.discardTwo = custom('discardTwo', [{ ...discardOne, count: 2 } as Effect]);
  d.cards.vigorUp = custom('vigorUp', [{ type: 'applyPower', power: 'vigor', amount: 3 }]);
  // A Sly card that itself discards, a single-target Sly Attack and an exhausting Sly card.
  d.cards.slyDiscarder = custom('slyDiscarder', [discardOne], { keywords: ['sly'], cost: 3 });
  d.cards.slyStab = custom('slyStab', [{ type: 'attack', damage: 7, hits: 1 }], {
    type: 'attack',
    keywords: ['sly'],
    cost: 3,
  });
  d.cards.slyBurn = custom('slyBurn', [{ type: 'gainBlock', amount: 2 }], { keywords: ['sly', 'exhaust'], cost: 3 });
  for (const id of innate) d.cards[id]!.keywords = [...d.cards[id]!.keywords, 'innate'];
  return d;
}

/** Plays `plan(turn)` in order (turn 1 only unless `turns` says more); answers discards in `order`. */
function run(
  deck: [string, number, boolean?][],
  innate: string[],
  plan: (turn: number) => string[],
  order: string[] = [],
  over: Partial<CombatConfig> = {},
  turns = 1,
) {
  const views: StrategyView[] = [];
  let turn = -1;
  let queue: string[] = [];
  const strategy: Strategy = {
    decide(view) {
      views.push(structuredClone(view) as StrategyView);
      if (view.state.turn > turns) return { kind: 'endTurn' };
      if (view.state.turn !== turn) {
        turn = view.state.turn;
        queue = [...plan(turn)];
      }
      const want = queue.shift();
      if (want === undefined) return { kind: 'endTurn' };
      const c = view.playable.find((p) => p.cardId === want);
      if (!c) throw new Error(`${want} not playable on turn ${turn}`);
      return { kind: 'play', uid: c.uid, target: 0 };
    },
    choose(_view, r: ChoiceRequest): ChoiceResponse {
      const rank = (id: string) => (order.indexOf(id) < 0 ? 99 : order.indexOf(id));
      const ranked = [...r.options].sort((a, b) => rank(a.cardId) - rank(b.cardId));
      return { uids: ranked.slice(0, r.max).map((c) => c.uid) };
    },
  };
  const r = simulateCombat(data(innate), cfg({ enemyId: 'dummy', deck: deckOf(...deck), seed: 3, ...over }), strategy, {
    log: true,
  });
  const last = views.filter((v) => v.state.turn === 1).at(-1)!;
  return { r, last, views };
}

const plays = (log: GameEvent[] | undefined) => events(log, 'play').map((e) => e.cardId);
const blocks = (log: GameEvent[] | undefined) => events(log, 'block').map((e) => e.amount);
const playerHits = (log: GameEvent[] | undefined) =>
  events(log, 'damage')
    .filter((e) => e.source === 'player')
    .map((e) => e.amount);

describe('#261 Sly data', () => {
  it('the seven Sly cards are simulated, keep the Sly keyword and have their main-release effects', () => {
    for (const id of SLY) {
      expect(gameData.cards[id]!.simulated).toBe(true);
      expect(gameData.cards[id]!.keywords).toContain('sly');
    }
    expect(gameData.cards.abrasive!.effects).toEqual([
      { type: 'applyPower', power: 'dexterity', amount: 1 },
      { type: 'applyPower', power: 'thorns', amount: 4 },
    ]);
    expect(gameData.cards.haze!.effects).toEqual([{ type: 'applyPoison', amount: 4, allEnemies: true }]);
    expect(gameData.cards.haze!.cost).toBe(3);
    expect(gameData.cards.reflex!.effects).toEqual([{ type: 'draw', amount: 2 }]);
    expect(gameData.cards.tactician!.effects).toEqual([{ type: 'gainEnergy', amount: 1 }]);
    expect(gameData.cards.tactician!.upgraded?.effects).toEqual([{ type: 'gainEnergy', amount: 2 }]);
    // Main v0.107.1: 6 (8); the 7 (9) on the wiki is the V0.108 beta.
    expect(gameData.cards.flick_flack!.effects).toEqual([{ type: 'attack', damage: 6, hits: 1, allEnemies: true }]);
  });
});

describe('#261 Sly: discarded by a card effect, played for free', () => {
  it('Survivor discards Untouchable: it is played (by an effect), costs nothing and goes to the discard pile', () => {
    const { r, last } = run(
      [
        ['survivor', 1],
        ['untouchable', 1],
        ['pad', 10],
      ],
      ['survivor', 'untouchable'],
      () => ['survivor'],
      ['untouchable'],
    );
    expect(blocks(r.log)).toEqual([8, 6]);
    const sly = events(r.log, 'play').find((e) => e.cardId === 'untouchable')!;
    expect(sly.by).toBe('effect');
    expect(last.state.player.energy).toBe(2);
    expect(last.state.player.discardPile.map((c) => c.cardId).sort()).toEqual(['survivor', 'untouchable']);
    expect(last.state.player.hand.some((c) => c.cardId === 'untouchable')).toBe(false);
    // Counted as discarded and as a card played this turn (same as from the hand).
    expect(last.state.player.counters?.cardsDiscardedThisTurn).toBe(1);
    expect(last.state.player.counters?.cardsPlayedThisTurn).toBe(2);
  });

  it('the Sly card is logged as discarded, then played', () => {
    const { r } = run(
      [
        ['survivor', 1],
        ['untouchable', 1],
        ['pad', 10],
      ],
      ['survivor', 'untouchable'],
      () => ['survivor'],
      ['untouchable'],
    );
    const log = r.log ?? [];
    const moved = log.findIndex((e) => e.t === 'moved' && e.cardId === 'untouchable' && e.to === 'discard');
    const played = log.findIndex((e) => e.t === 'play' && e.cardId === 'untouchable');
    expect(moved).toBeGreaterThan(-1);
    expect(played).toBe(moved + 1);
  });

  it('plays after the discarding card has finished (#314)', () => {
    const { r } = run(
      [
        ['discardThenBlock', 1],
        ['untouchable', 1],
        ['pad', 10],
      ],
      ['discardThenBlock', 'untouchable'],
      () => ['discardThenBlock'],
      ['untouchable'],
    );
    expect(blocks(r.log)).toEqual([5, 6]);
    expect(plays(r.log)).toEqual(['discardThenBlock', 'untouchable']);
  });

  it('several Sly cards discarded by one card play in hand order, not in the order they were discarded (#314)', () => {
    for (const order of [
      ['untouchable', 'tactician'],
      ['tactician', 'untouchable'],
    ]) {
      const { r, views } = run(
        [
          ['discardTwo', 1],
          ['untouchable', 1],
          ['tactician', 1],
          ['pad', 10],
        ],
        ['discardTwo', 'untouchable', 'tactician'],
        () => ['discardTwo'],
        order,
      );
      const discarded = events(r.log, 'moved')
        .filter((e) => e.from === 'hand' && e.to === 'discard')
        .map((e) => e.cardId);
      expect(discarded).toEqual(order);
      const handOrder = views[0]!.state.player.hand
        .map((c) => c.cardId)
        .filter((id) => id === 'untouchable' || id === 'tactician');
      expect(plays(r.log).slice(1)).toEqual(handOrder);
    }
  });

  it('several Sly cards discarded at once are played in discard order (Storm of Steel)', () => {
    const { r, last } = run(
      [
        ['storm_of_steel', 1],
        ['untouchable', 1],
        ['tactician', 1],
        ['pad', 10],
      ],
      ['storm_of_steel', 'untouchable', 'tactician'],
      () => ['storm_of_steel'],
    );
    const discarded = events(r.log, 'moved')
      .filter((e) => e.from === 'hand' && e.to === 'discard')
      .map((e) => e.cardId);
    const slyPlays = plays(r.log).filter((id) => id === 'untouchable' || id === 'tactician');
    expect(slyPlays).toEqual(discarded.filter((id) => id === 'untouchable' || id === 'tactician'));
    expect(slyPlays).toHaveLength(2);
    // Storm of Steel (1) paid; Tactician's energy came free: 3 - 1 + 1.
    expect(last.state.player.energy).toBe(3);
    // Every discarded card still makes a Shiv (Storm of Steel's count includes the Sly cards).
    expect(last.state.player.hand.filter((c) => c.cardId === 'shiv')).toHaveLength(discarded.length);
  });

  it('a Sly play that kills the last enemy wins like any played card (after the discarding card, #314)', () => {
    const { r } = run(
      [
        ['discardThenBlock', 1],
        ['flick_flack', 1],
        ['pad', 10],
      ],
      ['discardThenBlock', 'flick_flack'],
      () => ['discardThenBlock'],
      ['flick_flack'],
      { enemyId: 'frail' },
    );
    expect(r.outcome).toBe('win');
    expect(r.turns).toBe(1);
    expect(blocks(r.log)).toEqual([5]);
    expect(plays(r.log)).toEqual(['discardThenBlock', 'flick_flack']);
  });

  it('a Sly card that itself discards can discard (and play) another Sly card', () => {
    const { r } = run(
      [
        ['survivor', 1],
        ['slyDiscarder', 1],
        ['untouchable', 1],
        ['pad', 10],
      ],
      ['survivor', 'slyDiscarder', 'untouchable'],
      () => ['survivor'],
      ['slyDiscarder', 'untouchable'],
    );
    expect(plays(r.log)).toEqual(['survivor', 'slyDiscarder', 'untouchable']);
    expect(blocks(r.log)).toEqual([8, 6]);
  });

  it('a Sly card that exhausts goes to the Exhaust pile; a Sly Power leaves play and its powers apply', () => {
    const { r, last } = run(
      [
        ['storm_of_steel', 1],
        ['slyBurn', 1],
        ['abrasive', 1],
        ['pad', 10],
      ],
      ['storm_of_steel', 'slyBurn', 'abrasive'],
      () => ['storm_of_steel'],
    );
    const p = last.state.player;
    expect(p.exhaustPile.map((c) => c.cardId)).toEqual(['slyBurn']);
    expect([...p.hand, ...p.drawPile, ...p.discardPile].some((c) => c.cardId === 'abrasive')).toBe(false);
    expect(p.powers?.dexterity).toBe(1);
    expect(p.powers?.thorns).toBe(4);
    expect(plays(r.log)).toContain('abrasive');
  });

  it('Reflex draws, Haze poisons every enemy, Ricochet hits 4 times, all for free', () => {
    const { r, last } = run(
      [
        ['storm_of_steel', 1],
        ['reflex', 1],
        ['haze', 1],
        ['ricochet', 1],
        ['pad', 10],
      ],
      ['storm_of_steel', 'reflex', 'haze', 'ricochet'],
      () => ['storm_of_steel'],
      [],
      { enemyIds: ['a', 'b'] },
    );
    const log = r.log ?? [];
    const enemyTurn = log.findIndex((e) => e.t === 'turnStart' && e.side === 'enemy');
    expect(log.slice(0, enemyTurn).filter((e) => e.t === 'draw')).toHaveLength(5 + 2);
    // The 2 cards Reflex drew stay in the hand (Storm of Steel discards the hand it saw), next to 4 Shivs.
    expect(last.state.player.hand).toHaveLength(2 + 4);
    expect(last.state.enemies?.map((e) => e.poison)).toEqual([4, 4]);
    expect(playerHits(r.log)).toEqual([3, 3, 3, 3]);
    expect(last.state.player.energy).toBe(2);
  });

  it('Sly cards are NOT played when the hand is discarded at the end of the turn', () => {
    const { r, views } = run(
      [
        ['untouchable', 1],
        ['pad', 10],
      ],
      ['untouchable'],
      () => [],
    );
    expect(plays(r.log)).not.toContain('untouchable');
    const turn2 = views.find((v) => v.state.turn === 2)!;
    expect(
      [...turn2.state.player.hand, ...turn2.state.player.discardPile].some((c) => c.cardId === 'untouchable'),
    ).toBe(true);
  });

  it('Tools of the Trade discarding a Sly card at the start of the turn plays it', () => {
    const { r } = run(
      [
        ['tools_of_the_trade', 1],
        ['untouchable', 1],
        ['pad', 3],
      ],
      ['tools_of_the_trade', 'untouchable'],
      (t) => (t === 1 ? ['tools_of_the_trade'] : []),
      ['untouchable'],
      {},
      2,
    );
    const turn2 = (r.log ?? []).findIndex((e) => e.t === 'turnStart' && e.turn === 2 && e.side === 'player');
    const slyPlay = (r.log ?? []).findIndex((e, i) => i > turn2 && e.t === 'play' && e.cardId === 'untouchable');
    expect(slyPlay).toBeGreaterThan(turn2);
  });
});

describe('#261 Sly: targets and the discarding card', () => {
  it('a single-target Sly Attack picks a random living enemy (seeded), after the outer card hit its target', () => {
    const hitEnemies = new Set<number>();
    for (let seed = 1; seed <= 10; seed++) {
      const c = [
        [
          ['discardThenHit', 1],
          ['slyStab', 1],
          ['pad', 10],
        ],
        ['discardThenHit', 'slyStab'],
        () => ['discardThenHit'],
        ['slyStab'],
        { enemyIds: ['a', 'b'], seed },
      ] as const;
      const { r } = run(...(c as unknown as Parameters<typeof run>));
      const { r: again } = run(...(c as unknown as Parameters<typeof run>));
      expect(r.log).toEqual(again.log);
      let cur = 0;
      const hits: [number, number][] = [];
      for (const e of r.log ?? []) {
        if (e.t === 'target') cur = e.enemy;
        if (e.t === 'damage' && e.source === 'player') hits.push([cur, e.amount]);
      }
      expect(hits).toHaveLength(2);
      // The outer card's attack after the discard hits its target, enemy 0, before the Sly card plays.
      expect(hits[0]).toEqual([0, 10]);
      expect(hits[1]![1]).toBe(7);
      hitEnemies.add(hits[1]![0]);
    }
    expect(hitEnemies).toEqual(new Set([0, 1]));
  });

  it('every played card counts for Slow, a Sly play included (#314)', () => {
    // discardThenHit is the 1st card (0 before it) and hits first; the Sly Flick-Flack is the 2nd (+10%).
    const { r } = run(
      [
        ['discardThenHit', 1],
        ['flick_flack', 1],
        ['pad', 10],
      ],
      ['discardThenHit', 'flick_flack'],
      () => ['discardThenHit'],
      ['flick_flack'],
      { enemyId: 'slowpoke' },
    );
    expect(playerHits(r.log)).toEqual([10, 6]);
    // After 3 cards, Survivor (4th) discards Flick-Flack (5th): 4 before it, +40% → floor(8.4) = 8.
    const { r: late } = run(
      [
        ['survivor', 1],
        ['flick_flack', 1],
        ['pad', 3],
      ],
      ['survivor', 'flick_flack', 'pad'],
      () => ['pad', 'pad', 'pad', 'survivor'],
      ['flick_flack'],
      { enemyId: 'slowpoke' },
    );
    expect(playerHits(late.log)).toEqual([8]);
  });

  it('a Sly play counts for Slow on later hits (#314)', () => {
    // Survivor (0 before), the Sly Untouchable (1), then hitThenDiscard has 2 before it: 5 x 1.2 = 6.
    const { r } = run(
      [
        ['survivor', 1],
        ['untouchable', 1],
        ['hitThenDiscard', 1],
        ['pad', 10],
      ],
      ['survivor', 'untouchable', 'hitThenDiscard'],
      () => ['survivor', 'hitThenDiscard'],
      ['untouchable'],
      { enemyId: 'slowpoke' },
    );
    expect(plays(r.log).slice(0, 3)).toEqual(['survivor', 'untouchable', 'hitThenDiscard']);
    expect(playerHits(r.log)).toEqual([6]);
  });

  it('Vigor goes to the first Attack played: an Attack that discards a Sly Attack uses it (#314)', () => {
    const { r, last } = run(
      [
        ['vigorUp', 1],
        ['hitThenDiscard', 1],
        ['flick_flack', 1],
        ['pad', 10],
      ],
      ['vigorUp', 'hitThenDiscard', 'flick_flack'],
      () => ['vigorUp', 'hitThenDiscard'],
      ['flick_flack'],
    );
    expect(playerHits(r.log)).toEqual([8, 6]);
    expect(last.state.player.powers?.vigor ?? 0).toBe(0);
  });

  it('a Sly Attack discarded by a Skill uses up the Vigor itself', () => {
    const { r, last } = run(
      [
        ['vigorUp', 1],
        ['survivor', 1],
        ['flick_flack', 1],
        ['pad', 10],
      ],
      ['vigorUp', 'survivor', 'flick_flack'],
      () => ['vigorUp', 'survivor'],
      ['flick_flack'],
    );
    expect(playerHits(r.log)).toEqual([9]);
    expect(last.state.player.powers?.vigor ?? 0).toBe(0);
  });
});
