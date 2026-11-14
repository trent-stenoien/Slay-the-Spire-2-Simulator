/** #268 Hand Trick (Sly for one turn) and Nightmare (3 copies next turn), real card data through the engine. */
import { describe, expect, it } from 'vitest';
import { gameData } from '../data/index';
import { simulateCombat } from './combat';
import { cfg, deckOf, dummy, events, withEnemy } from './combatTestHelpers';
import { cards, makeGameData } from './testFixtures';
import type { CardDef, ChoiceRequest, ChoiceResponse, GameData, Strategy, StrategyView } from './types';

const real = (id: string, innate = true): CardDef => {
  const c = structuredClone(gameData.cards[id]!);
  return innate ? { ...c, keywords: [...c.keywords, 'innate'] } : c;
};
const skill = (id: string, cost: number, extra: Partial<CardDef> = {}): CardDef => ({
  ...cards.defend!,
  id,
  code: id.slice(0, 2).padEnd(2, 'x'),
  name: id,
  cost,
  effects: [{ type: 'gainBlock', amount: 20 }],
  upgraded: extra.upgraded ?? { effects: [{ type: 'gainBlock', amount: 30 }] },
  ...extra,
});

function world(extra: Record<string, CardDef>): GameData {
  const d = withEnemy(makeGameData(), dummy());
  for (const id of ['hand_trick', 'survivor']) d.cards[id] = real(id);
  d.cards.nightmare = real('nightmare');
  Object.assign(d.cards, extra);
  return d;
}

function run(d: GameData, deck: ReturnType<typeof deckOf>, plan: (turn: number) => string[], pick: string, turns = 2) {
  const views: StrategyView[] = [];
  let turn = -1;
  let queue: string[] = [];
  const strategy: Strategy = {
    decide(view) {
      if (view.state.turn !== turn) {
        turn = view.state.turn;
        views.push(structuredClone(view) as StrategyView);
        queue = [...plan(turn)];
      }
      if (turn > turns) return { kind: 'endTurn' };
      const want = queue.shift();
      if (want === undefined) return { kind: 'endTurn' };
      const c = view.playable.find((p) => p.cardId === want);
      if (!c) throw new Error(`${want} not playable on turn ${turn}`);
      return { kind: 'play', uid: c.uid };
    },
    choose(_v, r: ChoiceRequest): ChoiceResponse {
      const hit = r.options.find((o) => o.cardId === pick) ?? r.options[0]!;
      return { uids: [hit.uid] };
    },
  };
  const r = simulateCombat(d, cfg({ enemyId: 'dummy', deck, seed: 3 }), strategy, { log: true });
  return { r, views };
}

describe('#268 Hand Trick', () => {
  it('data: Block 7 (10), then a script; simulated', () => {
    const c = gameData.cards.hand_trick!;
    expect(c.simulated).toBe(true);
    expect(c.effects).toEqual([
      { type: 'gainBlock', amount: 7 },
      { type: 'script', id: 'handTrick' },
    ]);
    expect(c.upgraded?.effects?.[0]).toEqual({ type: 'gainBlock', amount: 10 });
  });

  it('gives Sly to the costliest Skill in hand: Survivor then discards it and it plays free', () => {
    const d = world({
      big: skill('big', 3, { keywords: ['innate'] }),
      cheap: skill('cheap', 1, { keywords: ['innate'] }),
    });
    const { r, views } = run(
      d,
      deckOf(['hand_trick', 1], ['survivor', 1], ['big', 1], ['cheap', 1], ['defend', 6]),
      () => ['hand_trick', 'survivor'],
      'big',
      1,
    );
    // Hand Trick 7, Survivor 8, then Big's free Sly play 20 (Big costs 3, no energy left for it).
    const blocks = events(r.log, 'block').map((e) => e.amount);
    expect(blocks.slice(0, 3)).toEqual([7, 8, 20]);
    expect(events(r.log, 'play').map((e) => e.cardId)).toContain('big');
    expect(views[0]!.state.player.energy).toBe(3);
  });

  it('the Sly is for this turn only: a retained Skill has no Sly next turn', () => {
    const d = world({ keep: skill('keep', 1, { keywords: ['innate', 'retain'] }) });
    const { views } = run(
      d,
      deckOf(['hand_trick', 1], ['keep', 1], ['defend', 8]),
      (t) => (t === 1 ? ['hand_trick'] : []),
      'keep',
    );
    const kept = views[1]!.state.player.hand.find((c) => c.cardId === 'keep')!;
    expect(kept.keywords).not.toContain('sly');
  });

  it('no Skill in hand besides itself: nothing happens', () => {
    const d = world({ atk: { ...cards.strike!, id: 'atk', code: 'At', name: 'atk', keywords: ['innate'] } });
    const { r } = run(d, deckOf(['hand_trick', 1], ['atk', 1], ['survivor', 0]), () => ['hand_trick'], 'atk', 1);
    expect(events(r.log, 'block').map((e) => e.amount)).toEqual([7]);
  });
});

describe('#268 Nightmare', () => {
  it('data: cost 3 (2), Exhaust, script with 3 copies; simulated', () => {
    const c = gameData.cards.nightmare!;
    expect(c.simulated).toBe(true);
    expect(c.cost).toBe(3);
    expect(c.upgraded?.cost).toBe(2);
    expect(c.keywords).toContain('exhaust');
    expect(c.effects).toEqual([{ type: 'script', id: 'nightmare', values: [3] }]);
  });

  it('adds 3 copies of the chosen card (upgrade kept) to the hand at the start of next turn, before the draw', () => {
    const d = world({ mark: skill('mark', 0, { keywords: ['innate', 'exhaust'] }) });
    const { r, views } = run(
      d,
      deckOf(['nightmare', 1], ['mark', 1, true], ['defend', 12]),
      (t) => (t === 1 ? ['nightmare'] : []),
      'mark',
    );
    const made = events(r.log, 'generated').filter((e) => e.cardId === 'mark');
    expect(made).toHaveLength(3);
    const hand2 = views[1]!.state.player.hand.filter((c) => c.cardId === 'mark');
    expect(hand2.filter((c) => c.generated)).toHaveLength(3);
    expect(hand2.every((c) => c.upgraded)).toBe(true);
    // Nightmare exhausts.
    expect(events(r.log, 'exhaust').map((e) => e.cardId)).toContain('nightmare');
  });

  it('the copies arrive before the draw, and a full hand sends the excess drawn cards to the discard pile', () => {
    const d = world({ mark: skill('mark', 0, { keywords: ['innate', 'exhaust'] }) });
    const { r } = run(
      d,
      deckOf(['nightmare', 1], ['mark', 1], ['defend', 14]),
      (t) => (t === 1 ? ['nightmare'] : []),
      'mark',
    );
    const log = r.log!;
    const gen = log.findIndex((e) => e.t === 'generated');
    const firstDrawAfter = log.findIndex((e, k) => e.t === 'draw' && k > gen);
    expect(gen).toBeGreaterThan(-1);
    expect(gen).toBeLessThan(firstDrawAfter);
    // 3 copies + 5 draws = 8, but the hand holds 10 and turn 1 left cards in it only if retained: no overflow here.
    expect(events(log, 'discard').filter((e) => e.reason === 'handLimit')).toHaveLength(0);
  });

  it('with a hand near the limit, drawn cards beyond 10 go to the discard pile (existing rule)', () => {
    const d = world({
      mark: skill('mark', 0, { keywords: ['innate', 'exhaust'] }),
      keep: skill('keep', 0, { keywords: ['innate', 'retain'] }),
    });
    const { r, views } = run(
      d,
      deckOf(['nightmare', 1], ['mark', 1], ['keep', 4], ['defend', 14]),
      (t) => (t === 1 ? ['nightmare'] : []),
      'mark',
    );
    // Turn 2: 4 retained + 3 copies = 7 in hand before the draw of 5: the 4th draw hits the limit.
    expect(views[1]!.state.player.hand).toHaveLength(10);
    expect(events(r.log, 'discard').filter((e) => e.reason === 'handLimit').length).toBeGreaterThan(0);
  });

  it("the copies carry Hand Trick's temporary Sly, which expires at the end of the turn they arrive", () => {
    const d = world({ mark: skill('mark', 3, { keywords: ['innate'] }) });
    d.cards.nightmare = { ...d.cards.nightmare!, cost: 2 };
    const { views } = run(
      d,
      deckOf(['hand_trick', 1], ['nightmare', 1], ['mark', 1], ['defend', 12]),
      (t) => (t === 1 ? ['hand_trick', 'nightmare'] : []),
      'mark',
      3,
    );
    const slyCopies = (v: StrategyView) => v.state.player.hand.filter((c) => c.generated && c.keywords.includes('sly'));
    expect(slyCopies(views[1]!)).toHaveLength(3);
    // Turn 3: the copies were discarded at the end of turn 2 and carry no Sly any more (wherever they are).
    const p3 = views[2]!.state.player;
    const all = [...p3.hand, ...p3.drawPile, ...p3.discardPile].filter((c) => c.generated);
    expect(all.length).toBeGreaterThan(0);
    expect(all.some((c) => c.keywords.includes('sly'))).toBe(false);
  });

  it('an empty hand (only Nightmare itself): no copies', () => {
    const { r } = run(world({}), deckOf(['nightmare', 1]), (t) => (t === 1 ? ['nightmare'] : []), 'nightmare', 2);
    expect(events(r.log, 'generated')).toHaveLength(0);
  });
});
