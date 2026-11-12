/** #116 random card generation: pools, addCards, transformCards, Calamity, Hello World, Entropy. */
import { describe, expect, it } from 'vitest';
import { simulateCombat } from './combat';
import { cardPool, chooseGenerated } from './generate';
import { cards } from './testFixtures';
import { cfg, deckOf, passive, scripted, dummyData, logged, events } from './combatTestHelpers';
import type { CardDef, CardKeyword, ChoiceRequest, Effect, GameData, Strategy } from './types';

const card = (
  id: string,
  over: Partial<CardDef> & Pick<CardDef, 'type'>,
  effects: Effect[] = [],
  keywords: CardKeyword[] = [],
): CardDef => ({
  ...cards.strike!,
  id,
  code: id.slice(0, 2),
  name: id,
  character: 'I',
  rarity: 'token',
  cost: 1,
  keywords,
  effects,
  upgraded: { effects },
  ...over,
});

const hit = (damage: number): Effect[] => [{ type: 'attack', damage, hits: 1 }];

/** Dummy-enemy data with extra cards, plus a few pool cards for Ironclad. */
function dataWith(...extra: CardDef[]): GameData {
  const data = dummyData();
  for (const c of [
    card('pool_attack', { type: 'attack', rarity: 'uncommon' }, hit(3)),
    card('pool_skill', { type: 'skill', rarity: 'common' }, [{ type: 'gainBlock', amount: 4 }]),
    card('pool_power', { type: 'power', rarity: 'rare' }),
    ...extra,
  ]) {
    data.cards[c.id] = c;
  }
  return data;
}

const run = (data: GameData, strategy: Strategy, deck: ReturnType<typeof deckOf>, seed = 1) =>
  logged(data, strategy, { enemyId: 'dummy', deck, seed });

describe('card pools', () => {
  it('draw only from simulated, playable cards of the right character, rarity and type', () => {
    const data = dataWith(
      card('unsim', { type: 'attack', rarity: 'common', simulated: false }),
      card('other', { type: 'attack', character: 'S', rarity: 'common' }),
      card('cheap', { type: 'attack', cost: 0, rarity: 'common' }),
      card('colorless_a', { type: 'attack', character: 'colorless', rarity: 'uncommon' }),
      card('event_a', { type: 'attack', character: 'colorless', rarity: 'event' }),
      card('curse_a', { type: 'curse', rarity: 'common' }),
      card('unplayable_a', { type: 'skill', rarity: 'common', cost: null }, [], ['unplayable']),
    );
    const ids = (pool: Parameters<typeof cardPool>[2], up = false) =>
      cardPool(data.cards, 'I', pool, up).map((c) => c.id);
    expect(ids({ character: 'own', types: ['attack'] })).toEqual(['cheap', 'pool_attack']);
    expect(ids({ types: ['attack'], cost: 0 })).toEqual(['cheap']);
    expect(ids({ character: 'colorless' })).toEqual(['colorless_a']);
    expect(ids({ character: 'own', rarity: ['common'], types: ['skill'] })).toEqual(['pool_skill']);
    expect(ids({ types: ['power'] })).toEqual(['pool_power']);
  });

  it('an upgraded cost pool also takes cards that become that cost when upgraded; the base pool does not (#170)', () => {
    const slam = card('slam', { type: 'attack', rarity: 'common', cost: 1 }, hit(0));
    slam.upgraded = { cost: 0 };
    const data = dataWith(card('cheap', { type: 'attack', cost: 0, rarity: 'common' }), slam);
    const ids = (up: boolean) => cardPool(data.cards, 'I', { types: ['attack'], cost: 0 }, up).map((c) => c.id);
    expect(ids(false)).toEqual(['cheap']);
    expect(ids(true)).toEqual(['cheap', 'slam']);
  });

  it('a newly simulated card joins the pool by itself', () => {
    const data = dataWith(card('late', { type: 'attack', rarity: 'common', simulated: false }));
    expect(cardPool(data.cards, 'I', { types: ['attack'] }).map((c) => c.id)).toEqual(['pool_attack']);
    data.cards.late!.simulated = true;
    expect(cardPool(data.cards, 'I', { types: ['attack'] }).map((c) => c.id)).toEqual(['late', 'pool_attack']);
  });

  it('upgraded pools skip cards that cannot be upgraded; Splash pools are not simulated', () => {
    const data = dataWith(card('fixed', { type: 'attack', rarity: 'common', upgraded: null }));
    expect(cardPool(data.cards, 'I', { types: ['attack'] }, true).map((c) => c.id)).toEqual(['pool_attack']);
    expect(() => cardPool(data.cards, 'I', { character: 'otherCharacters' })).toThrow(/#151/);
  });
});

describe('addCards (random)', () => {
  const blade = card(
    'blade',
    { type: 'skill', cost: 1 },
    [
      {
        type: 'addCards',
        source: { kind: 'random', pool: { types: ['attack'] } },
        count: 1,
        to: 'hand',
        freeThisTurn: true,
      },
    ],
    ['exhaust'],
  );

  it('adds a generated card to hand, free this turn only, from the pool', () => {
    const data = dataWith(blade);
    const seen: { turn: number; cost: number | null; free?: boolean }[] = [];
    const strat: Strategy = {
      decide(view) {
        const gen = view.state.player.hand.find((c) => c.generated);
        if (gen) seen.push({ turn: view.state.turn, cost: gen.cost, free: gen.freeThisTurn });
        const b = view.playable.find((c) => c.cardId === 'blade');
        return b ? { kind: 'play', uid: b.uid } : { kind: 'endTurn' };
      },
    };
    const r = run(data, strat, deckOf(['blade', 1], ['strike', 4]));
    const gen = events(r.log, 'generated');
    expect(gen).toHaveLength(1);
    expect(gen[0]).toMatchObject({ cardId: 'pool_attack', to: 'hand', source: 'random', uid: 5 });
    expect(seen[0]).toEqual({ turn: 1, cost: 0, free: true });
    // Discarded at end of turn: when drawn later it costs its printed 1 again (never free on a later turn).
    expect(seen.filter((s) => s.turn > 1).every((s) => s.cost === 1 && !s.free)).toBe(true);
  });

  it('same seed gives the same cards', () => {
    const data = dataWith(blade);
    const a = run(
      data,
      scripted((t) => (t === 1 ? ['blade'] : [])),
      deckOf(['blade', 1], ['strike', 4]),
      7,
    );
    const b = run(
      data,
      scripted((t) => (t === 1 ? ['blade'] : [])),
      deckOf(['blade', 1], ['strike', 4]),
      7,
    );
    expect(a.log).toEqual(b.log);
  });

  it('a full hand sends the new card to the discard pile', () => {
    const data = dataWith(blade);
    // 10 cards drawn is impossible at 5/turn, so fill with a draw card.
    data.cards.fill = card('fill', { type: 'skill', cost: 0 }, [{ type: 'draw', amount: 9 }]);
    data.cards.two = card('two', { type: 'skill', cost: 0 }, [
      { type: 'addCards', source: { kind: 'random', pool: { types: ['attack'] } }, count: 2, to: 'hand' },
    ]);
    const r = run(
      data,
      scripted((t) => (t === 1 ? ['fill', 'two'] : [])),
      deckOf(['fill', 1], ['two', 1], ['strike', 12]),
      3,
    );
    expect(events(r.log, 'generated').map((g) => g.to)).toEqual(['hand', 'discard']);
  });

  it('options: shows distinct candidates and the strategy keeps one; the rest vanish', () => {
    const disc = card('disc', { type: 'skill' }, [
      { type: 'addCards', source: { kind: 'random', pool: {} }, count: 1, to: 'hand', options: 3, freeThisTurn: true },
    ]);
    const data = dataWith(disc);
    let request: ChoiceRequest | undefined;
    const strat: Strategy = {
      decide(view) {
        const d = view.playable.find((c) => c.cardId === 'disc');
        return d && !request ? { kind: 'play', uid: d.uid } : { kind: 'endTurn' };
      },
      choose(_v, req) {
        request = req;
        return { uids: [req.options[1]!.uid] };
      },
    };
    const r = run(data, strat, deckOf(['disc', 1], ['strike', 4]));
    expect(request?.purpose).toBe('generate');
    expect(request?.options).toHaveLength(3);
    expect(new Set(request?.options.map((c) => c.cardId)).size).toBe(3);
    const gen = events(r.log, 'generated');
    expect(gen).toHaveLength(1);
    expect(gen[0]!.uid).toBe(request!.options[1]!.uid);
  });

  it('upgraded creation and costThisCombat (Metamorphosis) go to the draw pile and stay cheap', () => {
    const meta = card('meta', { type: 'skill' }, [
      {
        type: 'addCards',
        source: { kind: 'random', pool: { types: ['attack'] } },
        count: 3,
        to: 'drawRandom',
        costThisCombat: 0,
        upgraded: true,
      },
    ]);
    const data = dataWith(meta);
    const costs: (number | null)[] = [];
    const strat: Strategy = {
      decide(view) {
        for (const c of view.state.player.hand) if (c.generated) costs.push(c.cost);
        const m = view.state.turn === 1 ? view.playable.find((c) => c.cardId === 'meta') : undefined;
        return m ? { kind: 'play', uid: m.uid } : { kind: 'endTurn' };
      },
    };
    const r = run(data, strat, deckOf(['meta', 1], ['strike', 6]));
    const gen = events(r.log, 'generated');
    expect(gen).toHaveLength(3);
    expect(gen.every((g) => g.to === 'drawRandom')).toBe(true);
    expect(costs.length).toBeGreaterThan(0);
    expect(costs.every((c) => c === 0)).toBe(true);
  });

  it('an empty pool creates nothing', () => {
    const none = card('none', { type: 'skill' }, [
      { type: 'addCards', source: { kind: 'random', pool: { types: ['power'], cost: 7 } }, count: 2, to: 'hand' },
    ]);
    const r = run(
      dataWith(none),
      scripted(() => ['none']),
      deckOf(['none', 1], ['strike', 4]),
    );
    expect(events(r.log, 'generated')).toHaveLength(0);
  });

  it('Stoke: exhausts the hand, then adds one random card per card exhausted', () => {
    const stoke = card('stoke_t', { type: 'skill' }, [
      { type: 'exhaustCards', mode: 'all' },
      {
        type: 'repeat',
        per: 'lastEffectCount',
        effects: [{ type: 'addCards', source: { kind: 'random', pool: {} }, count: 1, to: 'hand' }],
      },
    ]);
    const r = run(
      dataWith(stoke),
      scripted((t) => (t === 1 ? ['stoke_t'] : [])),
      deckOf(['stoke_t', 1], ['strike', 4]),
    );
    expect(events(r.log, 'exhaust')).toHaveLength(4);
    expect(events(r.log, 'generated')).toHaveLength(4);
  });
});

describe('transformCards', () => {
  const pf = (): CardDef => ({
    ...card('pf', { type: 'skill', cost: 0 }, [
      {
        type: 'transformCards',
        from: 'hand',
        mode: 'all',
        filter: { types: ['attack'] },
        into: { kind: 'card', cardId: 'giant_rock' },
      },
    ]),
    upgraded: { effects: [{ type: 'script', id: 'primalForcePlus' }] },
  });

  it('Primal Force turns every Attack in hand into Giant Rock, keeping uids', () => {
    const data = dataWith(pf());
    data.cards.giant_rock = card('giant_rock', { type: 'attack', rarity: 'token' }, hit(20));
    data.cards.giant_rock!.upgraded = { effects: hit(24) };
    const handAfter: string[] = [];
    const strat: Strategy = {
      decide(view) {
        const p = view.state.turn === 1 ? view.playable.find((c) => c.cardId === 'pf') : undefined;
        if (!p) {
          handAfter.push(...view.state.player.hand.map((c) => c.cardId));
          return { kind: 'endTurn' };
        }
        return { kind: 'play', uid: p.uid };
      },
    };
    const r = run(data, strat, deckOf(['pf', 1], ['strike', 4]));
    const tr = events(r.log, 'transformed');
    expect(tr.length).toBeGreaterThan(0);
    expect(tr.every((t) => t.fromCardId === 'strike' && t.toCardId === 'giant_rock')).toBe(true);
    expect(handAfter.filter((id) => id === 'strike')).toHaveLength(0);
  });

  it('Primal Force+ makes Giant Rock+', () => {
    const data = dataWith(pf());
    data.cards.giant_rock = card('giant_rock', { type: 'attack', rarity: 'token' }, hit(20));
    data.cards.giant_rock!.upgraded = { effects: hit(24) };
    let names: string[] = [];
    const strat: Strategy = {
      decide(view) {
        const p = view.state.turn === 1 ? view.playable.find((c) => c.cardId === 'pf') : undefined;
        if (!p) {
          names = view.state.player.hand.map((c) => c.name);
          return { kind: 'endTurn' };
        }
        return { kind: 'play', uid: p.uid };
      },
    };
    run(data, strat, deckOf(['pf', 1, true], ['strike', 4]));
    expect(names.filter((n) => n === 'giant_rock+').length).toBeGreaterThan(0);
    expect(names.includes('strike')).toBe(false);
  });
});

describe('power cards', () => {
  const power = (id: string, power: 'calamity' | 'helloWorld' | 'entropy') =>
    card(id, { type: 'power', cost: 0 }, [{ type: 'applyPower', power, amount: 1 }]);

  it('Calamity adds a random Attack to hand after each Attack played', () => {
    const data = dataWith(power('cal', 'calamity'));
    const r = run(
      data,
      scripted((t) => (t === 1 ? ['cal', 'strike', 'strike'] : [])),
      deckOf(['cal', 1], ['strike', 4]),
    );
    const gen = events(r.log, 'generated');
    expect(gen).toHaveLength(2);
    expect(gen.every((g) => g.cardId === 'pool_attack' && g.to === 'hand')).toBe(true);
  });

  it('Hello World adds a random Common card at the start of each turn', () => {
    const data = dataWith(power('hw', 'helloWorld'));
    const r = run(
      data,
      scripted((t) => (t === 1 ? ['hw'] : [])),
      deckOf(['hw', 1], ['strike', 4]),
    );
    const gen = events(r.log, 'generated');
    // Turn 1 is before the power; later turns each add one Common (pool_skill is the only Common of the character).
    expect(gen.length).toBeGreaterThanOrEqual(2);
    expect(gen.every((g) => g.cardId === 'pool_skill')).toBe(true);
  });

  it('Entropy transforms one random card in hand at the start of each turn', () => {
    const data = dataWith(power('ent', 'entropy'));
    const r = run(
      data,
      scripted((t) => (t === 1 ? ['ent'] : [])),
      deckOf(['ent', 1], ['strike', 8]),
    );
    const tr = events(r.log, 'transformed');
    expect(tr.length).toBeGreaterThanOrEqual(2);
    expect(tr.every((t) => ['pool_attack', 'pool_skill', 'pool_power'].includes(t.toCardId))).toBe(true);
  });
});

describe('chooseGenerated', () => {
  const opt = (uid: number, type: 'attack' | 'skill' | 'power', effects: Effect[]) =>
    ({ uid, cardId: `c${uid}`, name: `c${uid}`, type, upgraded: false, cost: 1, keywords: [], effects }) as const;
  const request = (options: ChoiceRequest['options']): ChoiceRequest => ({
    purpose: 'generate',
    options,
    min: 1,
    max: 1,
  });

  it('follows the strategy group order, then best value', () => {
    const o = request([
      opt(1, 'skill', [{ type: 'gainBlock', amount: 9 }]),
      opt(2, 'attack', hit(5)),
      opt(3, 'attack', hit(8)),
      opt(4, 'power', []),
    ]);
    expect(chooseGenerated(o, ['attack', 'powers', 'block']).uids).toEqual([3]);
    expect(chooseGenerated(o, ['block', 'attack', 'powers']).uids).toEqual([1]);
    expect(chooseGenerated(o, ['powers', 'block', 'attack']).uids).toEqual([4]);
  });

  it('falls back to the first option', () => {
    expect(chooseGenerated(request([opt(7, 'skill', [])]), ['attack', 'powers', 'block']).uids).toEqual([7]);
  });
});

describe('contract', () => {
  it('passive play still works with generation cards in the deck', () => {
    const r = simulateCombat(dataWith(), cfg({ enemyId: 'dummy' }), passive);
    expect(r.outcome).toBe('turnCap');
  });
});
