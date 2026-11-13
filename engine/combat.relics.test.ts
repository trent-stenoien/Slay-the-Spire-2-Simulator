/** #205 Relics: every simulated relic, read from the real data in data/relics/, and the HP-lost rules. */
import { describe, expect, it } from 'vitest';
import { gameData } from '../data';
import { simulateCombat } from './combat';
import { cfg, deckOf, dummy, events, logged, scripted, withEnemy } from './combatTestHelpers';
import { cards, makeEnemy, makeGameData } from './testFixtures';
import { runSimulationSync, summarize } from './montecarlo';
import { GREEDY_CONFIG } from './strategies';
import type { CardDef, CombatConfig, CombatResult, Effect, GameData, Strategy, StrategyView } from './types';

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
const hit = (damage: number, hits = 1): Effect => ({ type: 'attack', damage, hits });

const extra: Record<string, CardDef> = {
  jab: card('jab', 'Jb', [hit(1)], { type: 'attack' }),
  jab4: card('jab4', 'J4', [hit(4)], { type: 'attack' }),
  jab5: card('jab5', 'J5', [hit(5)], { type: 'attack' }),
  ouch5: card('ouch5', 'O5', [{ type: 'loseHp', amount: 5 }]),
  twinstrike: card('twinstrike', 'Tw', [hit(1)], { type: 'attack', name: 'Twin Strike', rarity: 'common', cost: 9 }),
  ouch1: card('ouch1', 'O1', [{ type: 'loseHp', amount: 1 }]),
  potion: card('potion', 'Pn', [{ type: 'gainPotion' }]),
  xhit: card('xhit', 'Xh', [{ type: 'attack', damage: 1, hits: 1, xTimes: true }], { type: 'attack', xCost: true }),
};

const weak = makeEnemy('weak', 6, { wait: { name: 'Wait', effects: [] } });
const hitter = (dmg: number) =>
  makeEnemy('hitter', 999, { hit: { name: 'Hit', effects: [{ type: 'attack', damage: dmg, hits: 1 }] } });

function world(): GameData {
  const d = withEnemy(makeGameData(), dummy(), weak, hitter(8));
  Object.assign(d.cards, extra);
  d.relics = structuredClone(gameData.relics);
  d.potions = structuredClone(gameData.potions);
  return d;
}

const relics = (...ids: string[]): Partial<CombatConfig> => ({ relics: ids.map((relicId) => ({ relicId })) });
const play = (...turns: string[][]) => scripted((t) => turns[t - 1] ?? []);

/** Records the first view of each turn, then plays like `inner`. */
function spy(inner: Strategy = play()): { strategy: Strategy; views: StrategyView[] } {
  const views: StrategyView[] = [];
  return {
    views,
    strategy: {
      decide(view) {
        if (views.length < view.state.turn) views.push(structuredClone(view));
        return inner.decide(view);
      },
    },
  };
}

/** Kill the 6-HP enemy on turn 1 with one Strike, after `before`. */
function quickWin(overrides: Partial<CombatConfig>, before: string[] = []): CombatResult {
  return logged(world(), play([...before, 'strike']), {
    enemyId: 'weak',
    deck: deckOf(['strike', 1], ...before.map((id): [string, number] => [id, 1])),
    ...overrides,
  });
}

describe('#205 relic data', () => {
  it('Ironclad’s starting relic name matches the Burning Blood relic', () => {
    const name = gameData.characters.ironclad!.startingRelic;
    expect(Object.values(gameData.relics!).find((r) => r.name === name)?.id).toBe('burning_blood');
  });

  it('an unknown relic and an unsimulated relic throw', () => {
    expect(() => quickWin(relics('nope'))).toThrow(/Unknown relic/);
    const d = world();
    d.relics!.bread!.simulated = false;
    expect(() => simulateCombat(d, cfg({ enemyId: 'weak', ...relics('bread') }), play(['strike']))).toThrow(
      /not simulated yet/,
    );
  });
});

describe('#205 HP lost with heals and startHp', () => {
  it('Burning Blood heals 6 at the end of a won combat, logged with its source', () => {
    const r = quickWin(relics('burning_blood'), ['ouch5']);
    expect(events(r.log, 'heal')).toEqual([{ t: 'heal', amount: 6, hpAfter: 80, source: 'burning_blood' }]);
    expect(events(r.log, 'relic')).toEqual([{ t: 'relic', relicId: 'burning_blood' }]);
    expect(r.hpLost).toBe(-1);
    expect(r.healed).toBe(6);
  });

  it('Burning Blood does not heal on a loss', () => {
    const d = world();
    d.enemies.hitter = hitter(200);
    const r = logged(d, play(), { enemyId: 'hitter', deck: deckOf(['defend', 5]), ...relics('burning_blood') });
    expect(r.outcome).toBe('loss');
    expect(events(r.log, 'heal')).toHaveLength(0);
    expect(r.hpLost).toBe(80);
  });

  it('Trent’s example: start 70/80, Blood Vial + lose 5 + Burning Blood → −3', () => {
    const r = quickWin({ startHp: 70, ...relics('blood_vial', 'burning_blood') }, ['ouch5']);
    expect(events(r.log, 'heal').map((e) => [e.amount, e.source])).toEqual([
      [2, 'blood_vial'],
      [6, 'burning_blood'],
    ]);
    expect(r.hpLost).toBe(-3);
    expect(r.healed).toBe(8);
  });

  it('a fight with no damage and Burning Blood is −6 HP lost (heals count past Max HP)', () => {
    const r = quickWin(relics('burning_blood'));
    expect(events(r.log, 'heal')[0]).toMatchObject({ amount: 6, hpAfter: 80 });
    expect(r.hpLost).toBe(-6);
  });

  it('startHp sets the HP the combat starts at; HP lost is counted from it', () => {
    const r = quickWin({ startHp: 50 }, ['ouch5']);
    expect(r.log![0]).toMatchObject({ t: 'combatStart', playerHp: 50 });
    expect(r.hpLost).toBe(5);
    expect(() => quickWin({ startHp: 81 })).toThrow(/startHp/);
    expect(() => quickWin({ startHp: 0 })).toThrow(/startHp/);
  });

  it('Monte Carlo: hpLostCounts start at minHpLost when HP lost goes negative', () => {
    const s = summarize(
      's',
      [{ hpLost: -3 }, { hpLost: 2 }, { hpLost: -3 }].map((x, i) => ({
        seed: i,
        outcome: 'win' as const,
        turns: 1,
        enemyHpRemaining: 0,
        ...x,
      })),
    );
    expect(s.minHpLost).toBe(-3);
    expect(s.hpLostCounts).toEqual([2, 0, 0, 0, 0, 1]);
    expect(s.firstCombatByHpLost).toEqual({ [-3]: 0, 2: 1 });
    expect(s.avgHpLost).toBeCloseTo(-4 / 3);
    expect(summarize('s', []).minHpLost).toBeUndefined();
  });

  it('runSimulationSync passes relics and startHp to every combat', () => {
    const d = world();
    const run = runSimulationSync(
      d,
      {
        characterId: 'ironclad',
        deck: deckOf(['strike', 5]),
        enemyId: 'weak',
        ascension: 0,
        strategies: [{ strategy: { id: 'g', name: 'g', config: GREEDY_CONFIG } }] as never,
        runSeed: 3,
        startHp: 70,
        relics: [{ relicId: 'burning_blood' }],
      },
      5,
    );
    expect(run.summaries[0]!.minHpLost).toBe(-6);
  });
});

describe('#205 start-of-combat relics', () => {
  it('Vajra +1, Sword of Jade +3 and Girya (choice) Strength', () => {
    expect(events(quickWin(relics('vajra')).log, 'strength')[0]!.total).toBe(1);
    expect(events(quickWin(relics('sword_of_jade')).log, 'strength')[0]!.total).toBe(3);
    expect(events(quickWin(relics('girya')).log, 'strength')[0]!.total).toBe(1);
    const r = quickWin({ relics: [{ relicId: 'girya', choice: 3 }] });
    expect(events(r.log, 'strength')[0]!.total).toBe(3);
    expect(() => quickWin({ relics: [{ relicId: 'girya', choice: 4 }] })).toThrow(/choice/);
  });

  it('Anchor: 10 Block on turn 1 (after the Block reset), gone on turn 2', () => {
    const { strategy, views } = spy();
    const r = simulateCombat(
      world(),
      cfg({ enemyId: 'hitter', deck: deckOf(['defend', 5]), ...relics('anchor') }),
      strategy,
      {
        log: true,
      },
    );
    expect(views[0]!.state.player.block).toBe(10);
    expect(views[1]!.state.player.block).toBe(0);
    const dmg = events(r.log, 'damage').filter((e) => e.target === 'player');
    expect(dmg[0]).toMatchObject({ blocked: 8, hpLoss: 0 });
    expect(dmg[1]).toMatchObject({ blocked: 0, hpLoss: 8 });
  });

  it('Gorget: 4 Plating from turn 1 (4 Block at the end of turn 1, then 3)', () => {
    const r = logged(world(), play(), { enemyId: 'dummy', deck: deckOf(['defend', 5]), ...relics('gorget') });
    const blocks = events(r.log, 'block').map((e) => e.amount);
    expect(blocks.slice(0, 4)).toEqual([4, 3, 2, 1]);
  });

  it('Bag of Marbles: 1 Vulnerable on the enemy at the start', () => {
    const r = quickWin(relics('bag_of_marbles'));
    expect(events(r.log, 'debuff')[0]).toMatchObject({ side: 'enemy', kind: 'vulnerable', amount: 1 });
  });

  it('Bronze Scales: 3 Thorns hit back', () => {
    const r = logged(world(), play(), { enemyId: 'hitter', deck: deckOf(['defend', 5]), ...relics('bronze_scales') });
    expect(events(r.log, 'damage').filter((e) => e.target === 'enemy')[0]!.amount).toBe(3);
  });

  it('Oddly Smooth Stone: +1 Dexterity; Belt Buckle: +2 Dexterity with no potions', () => {
    const block = (id: string, extra: Partial<CombatConfig> = {}) =>
      events(quickWin({ ...relics(id), ...extra }, ['defend']).log, 'block').at(-1)!.amount;
    expect(block('oddly_smooth_stone')).toBe(6);
    expect(block('belt_buckle')).toBe(7);
    // A potion held turns Belt Buckle off.
    expect(block('belt_buckle', { potions: ['fire_potion'] })).toBe(5);
  });

  it('Akabeko: 8 Vigor on the first Attack', () => {
    const r = logged(world(), play(['jab', 'jab']), {
      enemyId: 'dummy',
      deck: deckOf(['jab', 5]),
      ...relics('akabeko'),
    });
    expect(
      events(r.log, 'damage')
        .slice(0, 2)
        .map((e) => e.amount),
    ).toEqual([9, 1]);
  });

  it('Sling of Courage: 2 Strength only against an Elite', () => {
    const d = world();
    d.enemies.weak = { ...weak, difficulty: 'elite' };
    const elite = simulateCombat(
      d,
      cfg({ enemyId: 'weak', deck: deckOf(['strike', 1]), ...relics('sling_of_courage') }),
      play(['strike']),
      {
        log: true,
      },
    );
    expect(events(elite.log, 'strength')[0]!.total).toBe(2);
    expect(events(quickWin(relics('sling_of_courage')).log, 'strength')).toHaveLength(0);
  });
});

describe('#205 turn relics', () => {
  const turns = (ids: string[], deck = deckOf(['defend', 10]), enemyId = 'dummy') => {
    const { strategy, views } = spy();
    const r = simulateCombat(world(), cfg({ enemyId, deck, ...relics(...ids) }), strategy, { log: true });
    return { r, views };
  };

  it('Lantern +1 energy on turn 1; Chandelier +3 on turn 3', () => {
    expect(
      turns(['lantern'])
        .views.slice(0, 2)
        .map((v) => v.state.player.energy),
    ).toEqual([4, 3]);
    expect(
      turns(['chandelier'])
        .views.slice(0, 4)
        .map((v) => v.state.player.energy),
    ).toEqual([3, 3, 6, 3]);
  });

  it('Bag of Preparation draws 2 more on turn 1; Snecko Eye draws 2 more every turn', () => {
    expect(
      turns(['bag_of_preparation'])
        .views.slice(0, 2)
        .map((v) => v.state.player.hand.length),
    ).toEqual([7, 5]);
    expect(
      turns(['snecko_eye'])
        .views.slice(0, 2)
        .map((v) => v.state.player.hand.length),
    ).toEqual([7, 7]);
  });

  it('Ring of the Snake draws 2 more on turn 1 only: 7 then 5 cards (#258)', () => {
    expect(
      turns(['ring_of_the_snake'])
        .views.slice(0, 2)
        .map((v) => v.state.player.hand.length),
    ).toEqual([7, 5]);
  });

  it('Snecko Eye (Confused): drawn cards cost a random 0–3, the same for the same seed', () => {
    const a = turns(['snecko_eye']);
    const costs = a.views[0]!.state.player.hand.map((c) => c.costThisCombat);
    for (const c of costs) expect(c).toBeGreaterThanOrEqual(0);
    for (const c of costs) expect(c).toBeLessThanOrEqual(3);
    expect(new Set(costs).size).toBeGreaterThan(1);
    expect(turns(['snecko_eye']).r.log).toEqual(a.r.log);
  });

  it('Horn Cleat 14 Block on turn 2; Captain’s Wheel 18 Block on turn 3; Sai 7 every turn', () => {
    expect(
      turns(['horn_cleat'])
        .views.slice(0, 3)
        .map((v) => v.state.player.block),
    ).toEqual([0, 14, 0]);
    expect(
      turns(['captains_wheel'])
        .views.slice(0, 4)
        .map((v) => v.state.player.block),
    ).toEqual([0, 0, 18, 0]);
    expect(
      turns(['sai'])
        .views.slice(0, 2)
        .map((v) => v.state.player.block),
    ).toEqual([7, 7]);
  });

  it('Happy Flower: +1 energy on turns 3, 6…; Pollinous Core: +2 draw on turns 4, 8…', () => {
    const e = turns(['happy_flower'])
      .views.slice(0, 6)
      .map((v) => v.state.player.energy);
    expect(e).toEqual([3, 3, 4, 3, 3, 4]);
    const h = turns(['pollinous_core'])
      .views.slice(0, 8)
      .map((v) => v.state.player.hand.length);
    expect(h).toEqual([5, 5, 5, 7, 5, 5, 5, 7]);
  });

  it('Stone Calendar: 52 damage at the end of turn 7', () => {
    const { r } = turns(['stone_calendar']);
    const hits = events(r.log, 'damage').filter((e) => e.target === 'enemy');
    expect(hits).toEqual([{ t: 'damage', source: 'player', target: 'enemy', amount: 52, blocked: 0, hpLoss: 52 }]);
    const idx = r.log!.indexOf(hits[0]!);
    const turnStarts = r.log!.slice(0, idx).filter((e) => e.t === 'turnStart' && e.side === 'player');
    expect(turnStarts).toHaveLength(7);
  });

  it('Orichalcum: 6 Block when the turn ends with none, nothing otherwise', () => {
    const none = logged(world(), play(), { enemyId: 'dummy', deck: deckOf(['defend', 5]), ...relics('orichalcum') });
    expect(events(none.log, 'block')[0]!.amount).toBe(6);
    const some = logged(world(), play(['defend']), {
      enemyId: 'weak',
      deck: deckOf(['defend', 5]),
      ...relics('orichalcum'),
    });
    const log = some.log!;
    const turn2 = log.findIndex((e) => e.t === 'turnStart' && e.side === 'player' && e.turn === 2);
    expect(events(log.slice(0, turn2), 'block').map((e) => e.amount)).toEqual([5]);
    expect(events(log.slice(turn2), 'block')[0]!.amount).toBe(6);
  });

  it('Ice Cream keeps unspent energy', () => {
    expect(
      turns(['ice_cream'])
        .views.slice(0, 3)
        .map((v) => v.state.player.energy),
    ).toEqual([3, 6, 9]);
  });

  it('Bread: 2 less energy on turn 1, 1 more on every later turn', () => {
    expect(
      turns(['bread'])
        .views.slice(0, 3)
        .map((v) => v.state.player.energy),
    ).toEqual([1, 4, 4]);
  });

  it('Sozu and Velvet Choker: +1 energy every turn', () => {
    expect(turns(['sozu']).views[0]!.state.player.energy).toBe(4);
    expect(turns(['velvet_choker']).views[0]!.state.player.energy).toBe(4);
  });

  it('Runic Pyramid keeps the hand; Ghost Seed exhausts only basic Strikes and Defends left in hand', () => {
    const kept = turns(['runic_pyramid']).views;
    expect(kept[1]!.state.player.hand.length).toBe(10);
    const ghost = turns(['ghost_seed'], deckOf(['strike', 3], ['defend', 2], ['twinstrike', 5])).views;
    const exhausted = ghost[1]!.state.player.exhaustPile;
    expect(exhausted.length).toBe(ghost[0]!.state.player.hand.filter((c) => c.cardId !== 'twinstrike').length);
    expect(exhausted.some((c) => c.cardId === 'twinstrike')).toBe(false);
  });

  it('carried counters start at the setup count (Happy Flower 2 → turns 1, 4; Pollinous Core 3 → turn 1)', () => {
    const at = (relicId: string, choice: number) => {
      const { strategy, views } = spy();
      simulateCombat(
        world(),
        cfg({ enemyId: 'dummy', deck: deckOf(['defend', 10]), relics: [{ relicId, choice }] }),
        strategy,
      );
      return views;
    };
    expect(
      at('happy_flower', 2)
        .slice(0, 4)
        .map((v) => v.state.player.energy),
    ).toEqual([4, 3, 3, 4]);
    expect(
      at('happy_flower', 0)
        .slice(0, 3)
        .map((v) => v.state.player.energy),
    ).toEqual([3, 3, 4]);
    expect(
      at('pollinous_core', 3)
        .slice(0, 2)
        .map((v) => v.state.player.hand.length),
    ).toEqual([7, 5]);
  });

  it('Bellows upgrades the first hand only', () => {
    const v = turns(['bellows'], deckOf(['strike', 10])).views;
    expect(v[0]!.state.player.hand.every((c) => c.upgraded)).toBe(true);
    expect(v[1]!.state.player.hand.some((c) => !c.upgraded)).toBe(true);
  });
});

describe('#205 card-play relics', () => {
  it('Ornamental Fan: 4 Block on every 3rd Attack in one turn (counted per turn)', () => {
    const r = logged(world(), play(['jab', 'jab'], ['jab', 'jab', 'jab', 'jab', 'jab']), {
      enemyId: 'dummy',
      deck: deckOf(['jab', 10]),
      ...relics('ornamental_fan'),
    });
    // 2 Attacks on turn 1 don't carry over: only the 3rd Attack of turn 2 gains Block.
    expect(events(r.log, 'block').map((e) => e.amount)).toEqual([4]);
    const log = r.log!;
    const turn2 = log.findIndex((e) => e.t === 'turnStart' && e.side === 'player' && e.turn === 2);
    const playsBefore = log
      .slice(
        turn2,
        log.findIndex((e) => e.t === 'relic'),
      )
      .filter((e) => e.t === 'play');
    expect(playsBefore).toHaveLength(3);
  });

  it('Iron Club with 3 cards already counted draws on the first card played', () => {
    const r = logged(world(), play(['jab']), {
      enemyId: 'dummy',
      deck: deckOf(['jab', 12]),
      relics: [{ relicId: 'iron_club', choice: 3 }],
    });
    const firstPlay = r.log!.findIndex((e) => e.t === 'play');
    expect(r.log!.findIndex((e) => e.t === 'relic')).toBeGreaterThan(firstPlay);
    expect(events(r.log, 'relic')).toHaveLength(1);
  });

  it('Iron Club draws 1 on every 4th card played this combat', () => {
    const r = logged(world(), play(['jab', 'jab', 'jab'], ['jab']), {
      enemyId: 'dummy',
      deck: deckOf(['jab', 12]),
      ...relics('iron_club'),
    });
    const relicAt = r.log!.findIndex((e) => e.t === 'relic');
    expect(r.log![relicAt + 1]!.t).toBe('draw');
    expect(events(r.log, 'relic')).toHaveLength(1);
  });

  it('Strike Dummy: +3 per hit on cards with Strike in the name only', () => {
    const r = logged(world(), play(['strike', 'jab']), {
      enemyId: 'dummy',
      deck: deckOf(['strike', 1], ['jab', 1]),
      ...relics('strike_dummy'),
    });
    expect(
      events(r.log, 'damage')
        .slice(0, 2)
        .map((e) => e.amount),
    ).toEqual([9, 1]);
  });

  it('Chemical X: X-cost cards get X + 2', () => {
    const r = logged(world(), play(['xhit']), { enemyId: 'dummy', deck: deckOf(['xhit', 1]), ...relics('chemical_x') });
    expect(events(r.log, 'damage').filter((e) => e.target === 'enemy')).toHaveLength(5);
  });

  it('Velvet Choker: no more than 6 cards a turn', () => {
    const { strategy, views } = spy(play(['jab', 'jab', 'jab', 'jab', 'jab', 'jab']));
    let seventh: number | undefined;
    simulateCombat(
      world(),
      cfg({ enemyId: 'dummy', deck: deckOf(['jab', 10]), ...relics('velvet_choker', 'bag_of_preparation') }),
      {
        decide(view) {
          if (view.state.turn === 1 && view.state.player.counters!.cardsPlayedThisTurn === 6)
            seventh = view.playable.length;
          return strategy.decide(view);
        },
      },
    );
    expect(views.length).toBeGreaterThan(0);
    expect(seventh).toBe(0);
  });

  it('Sozu: gainPotion rewards nothing', () => {
    expect(quickWin({}, ['potion']).rewards?.potions).toBe(1);
    expect(quickWin(relics('sozu'), ['potion']).rewards).toBeUndefined();
  });

  it('The Boot: 1–4 unblocked attack damage becomes 5', () => {
    const r = logged(world(), play(['jab']), { enemyId: 'dummy', deck: deckOf(['jab', 1]), ...relics('the_boot') });
    expect(events(r.log, 'damage')[0]).toMatchObject({ amount: 1, hpLoss: 5 });
  });

  it('The Boot: the edges of the range, 4 becomes 5 and 5 stays 5; without it nothing changes', () => {
    const run = (card: string, rel: Partial<CombatConfig>) =>
      events(logged(world(), play([card]), { enemyId: 'dummy', deck: deckOf([card, 1]), ...rel }).log, 'damage')[0];
    expect(run('jab4', relics('the_boot'))).toMatchObject({ amount: 4, hpLoss: 5 });
    expect(run('jab5', relics('the_boot'))).toMatchObject({ amount: 5, hpLoss: 5 });
    expect(run('jab4', {})).toMatchObject({ amount: 4, hpLoss: 4 });
  });
});

describe('#205 HP-loss relics', () => {
  it('Tungsten Rod: every HP loss is 1 less (attacks and Lose HP)', () => {
    const r = logged(world(), play(['ouch1']), {
      enemyId: 'hitter',
      deck: deckOf(['ouch1', 5]),
      ...relics('tungsten_rod'),
    });
    expect(events(r.log, 'loseHp')[0]!.amount).toBe(0);
    expect(events(r.log, 'damage').find((e) => e.target === 'player')).toMatchObject({ amount: 8, hpLoss: 7 });
  });

  it('Beating Remnant: at most 20 HP lost in one turn', () => {
    const d = world();
    d.enemies.hitter = hitter(30);
    const r = logged(d, play(), { enemyId: 'hitter', deck: deckOf(['defend', 5]), ...relics('beating_remnant') });
    expect(
      events(r.log, 'damage')
        .filter((e) => e.target === 'player')
        .slice(0, 2)
        .map((e) => e.hpLoss),
    ).toEqual([20, 20]);
  });
});

describe('#205 Beating Remnant counts the whole turn', () => {
  it('two hits in one enemy turn share the 20 HP cap (15 + 5), and the next turn starts again', () => {
    const d = world();
    d.enemies.twin = makeEnemy('twin', 999, {
      hit: { name: 'Hit', effects: [{ type: 'attack', damage: 15, hits: 2 }] },
    });
    const r = logged(d, play(), { enemyId: 'twin', deck: deckOf(['defend', 5]), ...relics('beating_remnant') });
    expect(
      events(r.log, 'damage')
        .filter((e) => e.target === 'player')
        .slice(0, 4)
        .map((e) => e.hpLoss),
    ).toEqual([15, 5, 15, 5]);
  });
});

describe('#205 "???" merchant relics', () => {
  it('Anchor??? 4 Block, Blood Vial??? heals 1, Strike Dummy??? +1', () => {
    const { strategy, views } = spy();
    simulateCombat(world(), cfg({ enemyId: 'dummy', deck: deckOf(['defend', 5]), ...relics('anchor_fake') }), strategy);
    expect(views[0]!.state.player.block).toBe(4);
    expect(quickWin(relics('blood_vial_fake')).hpLost).toBe(-1);
    const r = logged(world(), play(['strike']), {
      enemyId: 'dummy',
      deck: deckOf(['strike', 1]),
      ...relics('strike_dummy_fake'),
    });
    expect(events(r.log, 'damage')[0]!.amount).toBe(7);
  });
});
