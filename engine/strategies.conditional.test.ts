/** #111 strategy rules: Body Slam and Entrench after the block cards, scaling cards ranked by what they deal now. */
import { describe, expect, it } from 'vitest';
import { gameData } from '../data/index';
import { simulateCombat } from './combat';
import { blockFirstConfig, createStrategy, GREEDY_CONFIG, isAttackCard, isBlockCard } from './strategies';
import { makeCardInstance } from './combat';
import { makeEnemy, makeGameData } from './testFixtures';
import { cfg, deckOf, events, withEnemy } from './combatTestHelpers';
import type { CardDef, Effect, StrategyConfig } from './types';

const real = (id: string): CardDef => structuredClone(gameData.cards[id]!);
const innate = (c: CardDef): CardDef => ({ ...c, keywords: [...c.keywords, 'innate'] });
const helper = (id: string, effects: Effect[], extra: Partial<CardDef> = {}): CardDef => ({
  ...real('defend'),
  id,
  code: id.slice(0, 2).padEnd(2, 'x'),
  name: id,
  effects,
  upgraded: null,
  keywords: ['innate'],
  ...extra,
});

/** An enemy that hits for 14 every turn. */
const brute = makeEnemy('brute', 999, { hit: { name: 'Hit', effects: [{ type: 'attack', damage: 14, hits: 1 }] } });

function world(cardIds: string[], extra: Record<string, CardDef> = {}, energy = 3) {
  const d = withEnemy(makeGameData(), brute);
  for (const id of cardIds) d.cards[id] = innate(real(id));
  Object.assign(d.cards, extra);
  d.characters.ironclad!.energyPerTurn = energy;
  return d;
}

/** The card ids played on turn 1, in order, and the log. */
function turnOnePlays(d: ReturnType<typeof world>, deck: ReturnType<typeof deckOf>, strategy: StrategyConfig) {
  const r = simulateCombat(d, cfg({ enemyId: 'brute', deck, strategy }), createStrategy(strategy), { log: true });
  const log = r.log!;
  const end = log.findIndex((e) => e.t === 'turnEnd');
  return { plays: events(log.slice(0, end), 'play').map((e) => e.cardId), log: log.slice(0, end) };
}

const wall = () => helper('wall', [{ type: 'gainBlock', amount: 7 }], { cost: 1 });

describe('#111 card classification', () => {
  it('scaling attacks are attacks; Stack and Entrench are block cards; Fisticuffs is only an attack', () => {
    const inst = (id: string) => makeCardInstance(real(id), false, 0);
    for (const id of ['body_slam', 'bully', 'rend', 'mind_blast', 'perfected_strike', 'dismantle', 'fisticuffs']) {
      expect(isAttackCard(inst(id)), id).toBe(true);
    }
    for (const id of ['stack', 'entrench']) expect(isBlockCard(inst(id)), id).toBe(true);
    expect(isBlockCard(inst('fisticuffs'))).toBe(false);
    expect(isAttackCard(inst('entrench'))).toBe(false);
  });
});

describe('#111 Body Slam goes after the other block cards', () => {
  const deck = deckOf(['body_slam', 1], ['defend', 2]);

  it('Attack first (Greedy): Defend, Defend, then Body Slam for 10', () => {
    const { plays, log } = turnOnePlays(world(['body_slam']), deck, GREEDY_CONFIG);
    expect(plays).toEqual(['defend', 'defend', 'body_slam']);
    expect(events(log, 'damage').find((e) => e.source === 'player')!.amount).toBe(10);
  });

  it('Block first: the Block it needs comes first, then Body Slam hits for the Block gained', () => {
    const { plays, log } = turnOnePlays(world(['body_slam']), deck, blockFirstConfig(0));
    expect(plays).toEqual(['defend', 'defend', 'body_slam']);
    expect(events(log, 'damage').find((e) => e.source === 'player')!.amount).toBe(10);
  });

  it('with no block card to play, Body Slam is played like any attack', () => {
    const { plays } = turnOnePlays(world(['body_slam']), deckOf(['body_slam', 1], ['strike', 1]), GREEDY_CONFIG);
    expect(plays).toEqual(['strike', 'body_slam']);
  });

  it('a scaling attack is ranked by what it deals now: Perfected Strike (6 Strikes) before a Strike', () => {
    const { plays } = turnOnePlays(
      world(['perfected_strike']),
      deckOf(['perfected_strike', 1], ['strike', 4]),
      GREEDY_CONFIG,
    );
    expect(plays[0]).toBe('perfected_strike');
  });
});

describe('#111 Entrench is planned with the block strategy', () => {
  it('vs 14 incoming: 7 Block then Entrench+ (14) beats 7 + Defend then Entrench+ (24)', () => {
    const d = world(['entrench'], { wall: wall() });
    const { plays } = turnOnePlays(d, deckOf(['entrench', 1, true], ['wall', 1], ['defend', 1]), blockFirstConfig(0));
    expect(plays.slice(0, 2)).toEqual(['wall', 'entrench']);
  });

  it('with the first group a plan cannot reach the target, it plays for the most Block', () => {
    const d = world(['entrench'], { wall: wall() });
    // Target 14 with only Defend (5) and Entrench+ (cost 1) and 2 energy: Defend then Entrench = 10.
    const { plays } = turnOnePlays(d, deckOf(['entrench', 1, true], ['defend', 1]), blockFirstConfig(0));
    expect(plays).toEqual(['defend', 'entrench']);
  });

  it('Block last (Greedy): it spends the energy for the most Block, Entrench last', () => {
    const d = world(['entrench'], { wall: wall() });
    const { plays } = turnOnePlays(d, deckOf(['entrench', 1, true], ['wall', 1], ['defend', 1]), GREEDY_CONFIG);
    expect(plays).toEqual(['wall', 'defend', 'entrench']);
  });

  it('Entrench with no Block to double is not played', () => {
    const d = world(['entrench']);
    const { plays } = turnOnePlays(d, deckOf(['entrench', 1]), blockFirstConfig(0));
    expect(plays).toEqual([]);
  });
});

describe('#111 Clash', () => {
  it('is played once the non-Attacks in hand are gone', () => {
    const d = world(['clash']);
    const { plays } = turnOnePlays(d, deckOf(['clash', 1], ['strike', 1], ['defend', 1]), GREEDY_CONFIG);
    expect(plays).toEqual(['strike', 'defend', 'clash']);
  });
});

describe('#111 real data end to end', () => {
  it('a deck of every #111 card plays full combats under every strategy order without error', () => {
    const ids = [
      'body_slam',
      'bully',
      'dismantle',
      'dominate',
      'molten_fist',
      'perfected_strike',
      'rampage',
      'maul',
      'rend',
      'mind_blast',
      'stack',
      'fisticuffs',
      'entrench',
      'clash',
    ];
    const deck = [
      ...deckOf(['strike', 4], ['defend', 4], ['bash', 1]),
      ...ids.map((id) => ({ cardId: id, upgraded: false, count: 1 })),
    ];
    for (const id of ids) expect(gameData.cards[id]!.simulated, id).toBe(true);
    for (const strategy of [GREEDY_CONFIG, blockFirstConfig(0), blockFirstConfig(5)]) {
      for (let seed = 1; seed <= 40; seed++) {
        const r = simulateCombat(
          gameData,
          { ...cfg({ deck, strategy, seed }), characterId: 'ironclad', enemyId: 'nibbit' },
          createStrategy(strategy),
        );
        expect(['win', 'loss']).toContain(r.outcome);
      }
    }
  });
});
