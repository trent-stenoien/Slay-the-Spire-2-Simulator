/** #105 contract shapes in card and enemy data. */
import { describe, expect, it } from 'vitest';
import { CONTRACT_EFFECT_SAMPLES } from '../engine/testFixtures';
import { fixture, errorsOf } from './dataTestHelpers';
import { SIMULATED_POWERS } from './validate/lists';
import { SIMULATED_POWER_IDS } from '../engine/combat';

/** Contract effects the engine simulates now (#106, #107, #108, #110, #111, #113, #114, #115, #116); a simulated card may use them. */
const SIMULATED = [
  'applyPower',
  'loseHp',
  'draw',
  'drawUntil',
  'exhaustCards',
  'heal',
  'gainMaxHp',
  'loseMaxHp',
  'addCards',
  'transformCards',
  'conditional',
  'repeat',
  'attackFrom',
  'gainBlockFrom',
  'growDamage',
  'script',
  'script',
  'applyEnemyPower',
  'schedule',
  'dealDamage',
  'enemyLoseHp',
  'enemyGainStrength',
  'setCost',
  'playCards',
  'addReplay',
  'moveCards',
  'moveSelf',
  'upgradeCards',
];
const UNSIMULATED_SAMPLES = CONTRACT_EFFECT_SAMPLES.filter((e) => !SIMULATED.includes(e.type));
const SIMULATED_SAMPLES = CONTRACT_EFFECT_SAMPLES.filter((e) => SIMULATED.includes(e.type));

describe('#105 contract shapes', () => {
  it('accepts every contract effect on unsimulated cards', () => {
    const d = fixture();
    d.cards.strike.simulated = false;
    d.cards.strike.effects = structuredClone(CONTRACT_EFFECT_SAMPLES);
    d.cards.strike.upgraded.effects = structuredClone(CONTRACT_EFFECT_SAMPLES);
    expect(errorsOf(d)).toEqual([]);
  });

  it.each(SIMULATED_SAMPLES.map((e) => [e.type, e] as const))('accepts "%s" on a simulated card', (_type, effect) => {
    const d = fixture();
    d.cards.strike.effects.push(structuredClone(effect));
    d.cards.strike.upgraded.effects.push(structuredClone(effect));
    expect(errorsOf(d)).toEqual([]);
  });

  it('SIMULATED_POWERS matches the powers the engine simulates (#109)', () => {
    expect([...SIMULATED_POWERS].sort()).toEqual([...SIMULATED_POWER_IDS].sort());
  });

  it.each([...SIMULATED_POWER_IDS])('accepts applyPower "%s" on a simulated card (#107, #109)', (power) => {
    const d = fixture();
    d.cards.strike.effects.push({ type: 'applyPower', power, amount: 1 });
    expect(errorsOf(d)).toEqual([]);
  });

  it('accepts every PowerId on a simulated card, the #113 trigger powers included', () => {
    const d = fixture();
    d.cards.strike.effects.push({ type: 'applyPower', power: 'noDraw', amount: 1 });
    d.cards.strike.upgraded.effects.push({ type: 'applyPower', power: 'rupture', amount: 1 });
    expect(errorsOf(d)).toEqual([]);
  });

  it('rejects Splash-style pools and unsupported sources on a simulated card (#116)', () => {
    const d = fixture();
    d.cards.strike.effects.push({
      type: 'addCards',
      source: { kind: 'random', pool: { character: 'otherCharacters' } },
      count: 1,
      to: 'hand',
    });
    expect(errorsOf(d)).toEqual([expect.stringMatching(/"simulated".*"cardPool\.otherCharacters"/)]);
    // #114: copies (self, copyOf) are simulated, but not with the #116 fields.
    d.cards.strike.effects.at(-1).source = { kind: 'self' };
    d.cards.strike.effects.at(-1).options = 2;
    expect(errorsOf(d)).toEqual([expect.stringMatching(/"simulated".*"addCards"/)]);
    d.cards.strike.effects.pop();
    d.cards.strike.effects.push({
      type: 'transformCards',
      from: 'hand',
      mode: 'choose',
      count: 1,
      into: { kind: 'card', cardId: 'x' },
    });
    expect(errorsOf(d)).toEqual([expect.stringMatching(/"simulated".*"transformCards\.mode\.choose"/)]);
  });

  it('accepts a drawUntil stop filter with nameIncludes (#113 enabled it) on a simulated card', () => {
    const d = fixture();
    d.cards.strike.effects.push({ type: 'drawUntil', stopOn: { types: ['skill'], nameIncludes: 'Strike' } });
    expect(errorsOf(d)).toEqual([]);
    d.cards.strike.effects.at(-1).stopOn = { notTypes: ['attack'] };
    expect(errorsOf(d)).toEqual([]);
  });

  it.each(UNSIMULATED_SAMPLES.map((e) => [e.type, e] as const))('rejects "%s" on a simulated card', (type, effect) => {
    const d = fixture();
    d.cards.strike.effects.push(structuredClone(effect));
    expect(errorsOf(d)).toEqual([expect.stringMatching(new RegExp(`cards/strike.*"simulated".*"${type}"`))]);
    const u = fixture();
    u.cards.strike.upgraded.effects.push(structuredClone(effect));
    expect(errorsOf(u)).toEqual([expect.stringMatching(new RegExp(`cards/strike.*"simulated".*"${type}"`))]);
  });

  // Every field of every contract sample is checked: a value that is wrong for any field type
  // (NaN is not an int, string, enum, bool, list or object) must be reported at that field.
  it.each(
    CONTRACT_EFFECT_SAMPLES.flatMap((e) =>
      Object.keys(e)
        .filter((k) => k !== 'type')
        .map((k) => [e.type, k, e] as const),
    ),
  )('reports a broken "%s".%s on an unsimulated card', (_type, field, effect) => {
    const d = fixture();
    d.cards.strike.simulated = false;
    d.cards.strike.effects = [{ ...structuredClone(effect), [field]: Number.NaN }];
    const errs = errorsOf(d);
    expect(errs.length).toBeGreaterThan(0);
    expect(errs.every((e) => e.includes('cards/strike'))).toBe(true);
    expect(errs).toContainEqual(expect.stringMatching(new RegExp(`effects\\[0\\]\\.${field}\\b`)));
  });

  it('#322: rejects the declared-only summon fields in enemy data', () => {
    const d = fixture();
    d.enemies.nibbit.onDeath = [{ type: 'spawnEnemies', enemyId: 'nibbit', count: 1 }];
    d.enemies.nibbit.pattern = { ...d.enemies.nibbit.pattern, startBySlot: { odd: 'hiss', even: 'hiss' } };
    const errs = errorsOf(d);
    expect(errs).toContainEqual(expect.stringMatching(/enemies\/nibbit.*onDeath.*not simulated yet/));
    expect(errs).toContainEqual(expect.stringMatching(/enemies\/nibbit.*pattern\.startBySlot.*not simulated yet/));
    const r = fixture();
    r.enemies.nibbit.pattern = { type: 'random', moves: ['hiss', 'hiss'], noRepeat: false, weights: { hiss: 2 } };
    expect(errorsOf(r)).toContainEqual(expect.stringMatching(/enemies\/nibbit.*pattern\.weights.*not simulated yet/));
    r.enemies.nibbit.pattern = { type: 'random', moves: ['hiss'], noRepeat: false, noRepeatMoves: ['hiss'] };
    expect(errorsOf(r)).toContainEqual(expect.stringMatching(/pattern\.noRepeatMoves.*not simulated yet/));
  });

  it('rejects contract effects on enemy moves', () => {
    const d = fixture();
    d.enemies.nibbit.moves.hiss.effects.push({ type: 'heal', amount: 5 });
    expect(errorsOf(d)).toContainEqual(
      expect.stringMatching(/enemies\/nibbit.*moves\.hiss\.effects\[1\]\.type.*"heal".*not simulated on enemy moves/),
    );
  });

  it('#108: accepts "when exhausted" triggers with simulated effects on a simulated card', () => {
    const d = fixture();
    d.cards.strike.triggers = [{ when: 'exhausted', effects: [{ type: 'gainEnergy', amount: 2 }] }];
    d.cards.strike.upgraded.triggers = [{ when: 'exhausted', effects: [{ type: 'gainEnergy', amount: 3 }] }];
    expect(errorsOf(d)).toEqual([]);
    d.cards.strike.upgraded.triggers = [
      { when: 'exhausted', effects: [{ type: 'applyPower', power: 'rupture', amount: 3 }] },
    ];
    expect(errorsOf(d)).toEqual([]);
    d.cards.strike.upgraded.triggers = [{ when: 'exhausted', effects: [{ type: 'gainStars', amount: 1 }] }];
    expect(errorsOf(d)).toEqual([expect.stringMatching(/cards\/strike.*"simulated".*"gainStars"/)]);
  });

  it('#108/#111: repeat only per a tracked counter with simulated inner effects; script only known ids', () => {
    const d = fixture();
    d.cards.strike.effects.push(
      { type: 'exhaustCards', mode: 'all', filter: { notTypes: ['attack'] } },
      { type: 'repeat', per: 'lastEffectCount', effects: [{ type: 'gainBlock', amount: 5 }] },
      { type: 'script', id: 'fiendFire', values: [7] },
      { type: 'script', id: 'thrash' },
    );
    expect(errorsOf(d)).toEqual([]);
    d.cards.strike.effects.push({
      type: 'repeat',
      per: 'lastEffectCount',
      effects: [
        { type: 'draw', amount: 1 },
        { type: 'applyPower', power: 'rupture', amount: 1 },
      ],
    });
    expect(errorsOf(d)).toEqual([]);
    d.cards.strike.effects.pop();
    d.cards.strike.effects.push({ type: 'script', id: 'perfectedStrike', values: [6, 2] });
    expect(errorsOf(d)).toEqual([]);
    d.cards.strike.effects.push({ type: 'script', id: 'unknownScript' });
    expect(errorsOf(d)).toEqual([expect.stringMatching(/cards\/strike.*"simulated".*"script"/)]);
  });

  it('#111/#113: every counter, the cards-played tallies included, is accepted on a simulated card', () => {
    const d = fixture();
    const goldAxe = { type: 'attackFrom', damage: 0, hits: 1, bonusPer: { per: 'cardsPlayedThisCombat', amount: 1 } };
    d.cards.strike.effects.push(goldAxe);
    expect(errorsOf(d)).toEqual([]);
    d.cards.strike.effects.pop();
    d.cards.strike.effects.push({
      type: 'conditional',
      if: { kind: 'counter', counter: 'attacksPlayedThisTurn', min: 1 },
      then: [],
    });
    expect(errorsOf(d)).toEqual([]);
    d.cards.strike.effects.pop();
    d.cards.strike.effects.push({ type: 'gainBlockFrom', amount: 0, bonusPer: { per: 'discardPileSize', amount: 1 } });
    d.cards.strike.playableIf = { kind: 'handAll', filter: { types: ['attack'] } };
    expect(errorsOf(d)).toEqual([]);
    d.cards.strike.playableIf = { kind: 'handAll', filter: { nameIncludes: 'Strike' } };
    expect(errorsOf(d)).toEqual([]);
  });

  it('#114: addCards is simulated for self / copyOf sources, but not with the #116 fields', () => {
    const d = fixture();
    const self = { type: 'addCards', source: { kind: 'self' }, count: 1, to: 'discard' };
    const copy = { type: 'addCards', source: { kind: 'copyOf', from: 'hand', mode: 'choose' }, count: 2, to: 'hand' };
    d.cards.strike.effects.push(structuredClone(self), structuredClone(copy));
    expect(errorsOf(d)).toEqual([]);
    for (const bad of [
      { ...self, upgraded: true },
      { ...self, freeThisTurn: true },
      { ...copy, options: 3 },
    ]) {
      const e = fixture();
      e.cards.strike.effects.push(structuredClone(bad));
      expect(errorsOf(e)).toEqual([expect.stringMatching(/cards\/strike.*"simulated".*"addCards"/)]);
    }
  });

  it('#114: playCards and addReplay are simulated except from the exhaust pile or with an unmatched filter field', () => {
    const d = fixture();
    d.cards.strike.effects.push(
      { type: 'playCards', from: 'discard', mode: 'random', count: 3, filter: { types: ['attack'] } },
      { type: 'addReplay', amount: 2, from: 'draw', mode: 'random', filter: { noReplay: true } },
    );
    expect(errorsOf(d)).toEqual([]);
    d.cards.strike.effects.at(-2).from = 'exhaust';
    expect(errorsOf(d)).toEqual([expect.stringMatching(/"playCards\.from\.exhaust"/)]);
    d.cards.strike.effects.at(-2).from = 'draw';
  });

  it('#108: rejects exhaustCards from the exhaust pile or with an unmatched filter field on a simulated card', () => {
    const d = fixture();
    d.cards.strike.effects.push({ type: 'exhaustCards', from: 'exhaust', count: 1, mode: 'random' });
    expect(errorsOf(d)).toEqual([expect.stringMatching(/"exhaustCards\.from\.exhaust"/)]);
    d.cards.strike.effects.at(-1).from = 'hand';
    d.cards.strike.effects.at(-1).filter = { nameIncludes: 'Strike' };
    expect(errorsOf(d)).toEqual([]);
  });

  it('#112: rejects moves to the exhaust pile, upgrade-on-move and an immediate moveSelf on a simulated card', () => {
    const d = fixture();
    d.cards.strike.effects.push({ type: 'moveCards', from: 'discard', to: 'exhaust', count: 1, mode: 'choose' });
    expect(errorsOf(d)).toEqual([expect.stringMatching(/"moveCards\.to\.exhaust"/)]);
    d.cards.strike.effects.pop();
    d.cards.strike.effects.push({
      type: 'moveCards',
      from: 'discard',
      to: 'hand',
      count: 1,
      mode: 'choose',
      upgrade: true,
    });
    expect(errorsOf(d)).toEqual([expect.stringMatching(/"moveCards\.upgrade"/)]);
    d.cards.strike.effects.pop();
    d.cards.strike.effects.push({
      type: 'moveCards',
      from: 'draw',
      to: 'hand',
      mode: 'all',
      filter: { nameIncludes: 'Strike' },
    });
    expect(errorsOf(d)).toEqual([]);
    d.cards.strike.effects.pop();
    d.cards.strike.effects.push({ type: 'moveSelf', to: 'hand', when: 'now' });
    expect(errorsOf(d)).toEqual([expect.stringMatching(/"moveSelf\.now"/)]);
  });

  it('#112: accepts a rarity filter and the Anointed, Bolas and Armaments shapes on simulated cards', () => {
    const d = fixture();
    d.cards.strike.effects.push(
      { type: 'moveCards', from: 'draw', to: 'hand', mode: 'all', filter: { rarity: ['rare'] } },
      { type: 'moveSelf', to: 'hand', when: 'nextTurnStart' },
      { type: 'upgradeCards', piles: ['hand'], count: 1, mode: 'choose' },
    );
    expect(errorsOf(d)).toEqual([]);
  });

  it('accepts playableIf and costLessPer on unsimulated cards and rejects them on simulated ones', () => {
    const d = fixture();
    d.cards.defend.playableIf = { kind: 'counter', counter: 'cardsPlayedThisTurn', min: 1 };
    d.cards.bash.costLessPer = { per: 'cardsPlayedThisTurn', amount: 1 };
    const errs = errorsOf(d);
    expect(errs).toEqual([expect.stringMatching(/cards\/bash.*"simulated".*"costLessPer"/)]);
    d.cards.strike.simulated = false;
    d.cards.defend.simulated = false;
    d.cards.bash.simulated = false;
    expect(errorsOf(d)).toEqual([]);
  });

  it('reports bad contract shapes with their field paths', () => {
    const d = fixture();
    d.cards.strike.simulated = false;
    d.cards.strike.effects = [
      { type: 'loseHp', amount: -1 },
      { type: 'drawUntil' },
      { type: 'exhaustCards', mode: 'choose' },
      { type: 'applyPower', power: 'flight', amount: 1 },
      { type: 'conditional', if: { kind: 'counter', counter: 'handSize' }, then: [{ type: 'nope' }] },
      { type: 'moveCards', from: 'deck', to: 'hand', mode: 'all' },
      { type: 'addCards', source: { kind: 'random', pool: { character: 'mine' } }, count: 0, to: 'hand' },
      { type: 'attackFrom', damage: 5, hits: 1 },
      { type: 'playCards', from: 'draw', mode: 'top', count: 1, xBonus: 1 },
      { type: 'script', values: ['x'] },
    ];
    d.cards.strike.triggers = [{ when: 'sometimes', effects: [] }];
    d.cards.strike.playableIf = { kind: 'enemyHas', status: 'shiny' };
    d.cards.strike.costLessPer = { per: 'moon', amount: 1 };
    const errs = errorsOf(d);
    for (const re of [
      /effects\[0\]\.amount/,
      /effects\[1\]" needs "handFull"/,
      /effects\[2\]\.count" is required/,
      /effects\[3\]\.power/,
      /effects\[4\]\.if" needs "min" or "max"/,
      /effects\[4\]\.then\[0\]\.type/,
      /effects\[5\]\.from/,
      /effects\[6\]\.source\.pool\.character/,
      /effects\[6\]\.count/,
      /effects\[7\]" needs "bonusPer" or "extraHitsPer"/,
      /effects\[8\]\.xBonus/,
      /effects\[9\]\.id/,
      /effects\[9\]\.values\[0\]/,
      /triggers\[0\]\.when/,
      /playableIf\.status/,
      /costLessPer\.per/,
    ]) {
      expect(errs).toContainEqual(expect.stringMatching(re));
    }
  });
});
