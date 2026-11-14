/**
 * #314 Sly strategy rule (Trent, Nov 13 round 3): a discard card is weighed with the free effect of the Sly
 * card it would discard added to its own effect, against its Energy cost, like other plays.
 */
import { describe, expect, it } from 'vitest';
import { simulateCombat } from './combat';
import { cfg, deckOf, dummy, dummyData, events, withEnemy } from './combatTestHelpers';
import { createStrategy, GREEDY_CONFIG } from './strategies';
import { gameData } from '../data';

const REAL = [
  'survivor',
  'untouchable',
  'tactician',
  'reflex',
  'ricochet',
  'haze',
  'abrasive',
  'dagger_throw',
  'strike',
  'defend',
];

/** The plays of turn 1 with `deck` (`innate` cards are in the opening hand); `sly: false` strips the keyword. */
function turnOne(
  deck: [string, number][],
  { energy = 3, sly = true, draw = 5, innate = [] as string[], artifact = 0 } = {},
) {
  const d = withEnemy(dummyData(), artifact ? { ...dummy(), startPowers: { artifact } } : dummy());
  for (const id of REAL) d.cards[id] = structuredClone(gameData.cards[id]!);
  if (!sly) for (const id of REAL) d.cards[id]!.keywords = d.cards[id]!.keywords.filter((k) => k !== 'sly');
  for (const id of innate) d.cards[id]!.keywords.push('innate');
  d.characters.ironclad!.energyPerTurn = energy;
  d.characters.ironclad!.drawPerTurn = draw;
  const r = simulateCombat(
    d,
    cfg({ enemyId: 'dummy', deck: deckOf(...deck), seed: 2 }),
    createStrategy(GREEDY_CONFIG),
    {
      log: true,
    },
  );
  const log = r.log ?? [];
  const end = log.findIndex((e) => e.t === 'turnStart' && e.side === 'enemy');
  return events(log.slice(0, end), 'play');
}

describe('#314 strategies with a Sly card in hand', () => {
  it('Survivor + Tactician + Strike + Defend: Survivor first (Block, Tactician refunds it), then Strike and Defend', () => {
    const plays = turnOne(
      [
        ['survivor', 1],
        ['tactician', 1],
        ['strike', 1],
        ['defend', 1],
      ],
      { draw: 4 },
    );
    expect(plays[0]!.cardId).toBe('survivor');
    expect(plays[1]).toMatchObject({ cardId: 'tactician', by: 'effect' });
    expect(
      plays
        .slice(2)
        .map((p) => p.cardId)
        .sort(),
    ).toEqual(['defend', 'strike']);
    expect(plays.at(-1)!.energyLeft).toBe(1);
  });

  it('Survivor + Reflex: Survivor first while energy is left, so the 2 cards Reflex draws can be played', () => {
    const plays = turnOne(
      [
        ['survivor', 1],
        ['reflex', 1],
        ['defend', 1],
        ['strike', 6],
      ],
      { draw: 3, innate: ['survivor', 'reflex', 'defend'] },
    );
    expect(plays[0]!.cardId).toBe('survivor');
    expect(plays[1]).toMatchObject({ cardId: 'reflex', by: 'effect' });
    // 2 energy left: both Reflex draws (Strikes) are played.
    expect(plays.filter((p) => p.cardId === 'strike')).toHaveLength(2);
  });

  it("the Sly card's effect counts in the group: Survivor + Ricochet (12 damage for 1) beats Strike with 1 energy", () => {
    const deck: [string, number][] = [
      ['survivor', 1],
      ['ricochet', 1],
      ['strike', 1],
    ];
    const sly = turnOne(deck, { energy: 1, draw: 3 });
    expect(sly.map((p) => p.cardId)).toEqual(['survivor', 'ricochet']);
    // Without Sly, Survivor is only a block card and the Attack group plays Strike.
    expect(turnOne(deck, { energy: 1, draw: 3, sly: false }).map((p) => p.cardId)).toEqual(['strike']);
  });

  it('a Sly card with no energy or draw is not pulled to the front: the Attack group goes first (no Block needed)', () => {
    const plays = turnOne(
      [
        ['survivor', 1],
        ['untouchable', 1],
        ['strike', 3],
      ],
      { energy: 3 },
    );
    expect(plays.map((p) => p.cardId)).toEqual(['strike', 'strike', 'strike']);
  });

  it('Survivor + Haze: Survivor is played first to discard Haze (free Poison to all, the enemy outlives the Attacks)', () => {
    const plays = turnOne([
      ['survivor', 1],
      ['haze', 1],
      ['strike', 3],
    ]);
    expect(plays[0]!.cardId).toBe('survivor');
    expect(plays[1]).toMatchObject({ cardId: 'haze', by: 'effect' });
  });

  it('Survivor + Haze: not pulled to the front when Artifact would negate the Poison (#46 estimate)', () => {
    const plays = turnOne(
      [
        ['survivor', 1],
        ['haze', 1],
        ['strike', 3],
      ],
      { artifact: 1 },
    );
    expect(plays[0]!.cardId).toBe('strike');
  });

  it('Survivor + Abrasive: a free Power is worth its cost, so Survivor goes first', () => {
    const plays = turnOne([
      ['survivor', 1],
      ['abrasive', 1],
      ['strike', 3],
    ]);
    expect(plays[0]!.cardId).toBe('survivor');
    expect(plays[1]).toMatchObject({ cardId: 'abrasive', by: 'effect' });
  });
});
