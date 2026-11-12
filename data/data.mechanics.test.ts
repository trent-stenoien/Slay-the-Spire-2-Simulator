/** #106 Lose HP, #107 Draw and #108 Exhaust cards: effects and the simulated flag, checked against the wiki text. */
import { describe, expect, it } from 'vitest';
import { gameData } from './index';

const c = gameData.cards;
const atk = (damage: number, extra: object = {}) => ({ type: 'attack', damage, hits: 1, ...extra });
const block = (amount: number) => ({ type: 'gainBlock', amount });
const loseHp = (amount: number) => ({ type: 'loseHp', amount });
const draw = (amount: number) => ({ type: 'draw', amount });
const energy = (amount: number) => ({ type: 'gainEnergy', amount });
const noDraw = { type: 'applyPower', power: 'noDraw', amount: 1 };
const untilNonAttack = { type: 'drawUntil', stopOn: { notTypes: ['attack'] } };

describe('#106 Lose HP cards', () => {
  it.each([
    ['blood_wall', [loseHp(2), block(16)], [loseHp(2), block(20)]],
    ['bloodletting', [loseHp(3), energy(2)], [loseHp(3), energy(3)]],
    ['breakthrough', [loseHp(1), atk(9, { allEnemies: true })], [loseHp(1), atk(13, { allEnemies: true })]],
    ['hemokinesis', [loseHp(2), atk(15)], [loseHp(2), atk(20)]],
  ])('%s loses HP first and is simulated', (id, base, up) => {
    expect(c[id]).toMatchObject({ simulated: true, effects: base, upgraded: { effects: up } });
  });

  it('Spite and Tear Asunder are recorded but wait for conditional / attackFrom (#111)', () => {
    expect(c.spite).toMatchObject({
      simulated: false,
      effects: [{ type: 'conditional', if: { kind: 'lostHpThisTurn' }, then: [atk(5, { hits: 2 })], else: [atk(5)] }],
      upgraded: { effects: [{ type: 'conditional', then: [atk(5, { hits: 3 })], else: [atk(5)] }] },
    });
    const per = { per: 'hpLossesThisCombat', amount: 1 };
    expect(c.tear_asunder).toMatchObject({
      simulated: false,
      effects: [{ type: 'attackFrom', damage: 5, hits: 1, extraHitsPer: per }],
      upgraded: { effects: [{ type: 'attackFrom', damage: 7, hits: 1, extraHitsPer: per }] },
    });
  });
});

describe('#107 Draw cards', () => {
  it.each([
    ['pommel_strike', [atk(9), draw(1)], [atk(10), draw(2)], []],
    ['shrug_it_off', [block(8), draw(1)], [block(11), draw(1)], []],
    ['finesse', [block(4), draw(1)], [block(7), draw(1)], []],
    ['flash_of_steel', [atk(5), draw(1)], [atk(8), draw(1)], []],
    ['minion_strike', [atk(6), draw(1)], [atk(9), draw(1)], ['exhaust']],
    ['master_of_strategy', [draw(3)], [draw(4)], ['exhaust']],
    ['soul', [draw(2)], [draw(3)], ['exhaust']],
    ['battle_trance', [draw(3), noDraw], [draw(4), noDraw], []],
    ['pillage', [atk(6), untilNonAttack], [atk(9), untilNonAttack], []],
    ['offering', [loseHp(6), energy(2), draw(3)], [loseHp(6), energy(2), draw(5)], ['exhaust']],
  ])('%s is simulated', (id, base, up, keywords) => {
    expect(c[id]).toMatchObject({ simulated: true, keywords, effects: base, upgraded: { effects: up } });
  });

  it('Scrawl draws until the hand is full; the upgrade only adds Retain', () => {
    expect(c.scrawl).toMatchObject({
      simulated: true,
      keywords: ['exhaust'],
      effects: [{ type: 'drawUntil', handFull: true }],
      upgraded: { keywords: ['retain', 'exhaust'] },
    });
    expect(c.scrawl!.upgraded!.effects).toBeUndefined();
  });

  it('Master of Strategy: Wisdom (Mad Science) is block + draw; the upgrade adds Innate', () => {
    expect(c.mad_science_wisdom).toMatchObject({
      simulated: true,
      effects: [block(8), draw(3)],
      upgraded: { keywords: ['innate'] },
    });
  });

  it('cards whose other parts belong to later mechanics stay unsimulated', () => {
    // Impatience, Restlessness: conditional (#111). Drum of Battle is simulated now (#108).
    // Brightest Flame: Max HP loss (#115).
    expect(c.impatience).toMatchObject({
      simulated: false,
      effects: [{ type: 'conditional', if: { kind: 'handHasNone', filter: { types: ['attack'] } }, then: [draw(2)] }],
    });
    expect(c.restlessness).toMatchObject({
      simulated: false,
      keywords: ['retain'],
      effects: [
        { type: 'conditional', if: { kind: 'counter', counter: 'handSize', max: 0 }, then: [draw(2), energy(2)] },
      ],
    });
    expect(c.brightest_flame).toMatchObject({
      simulated: true,
      effects: [energy(2), draw(2), { type: 'loseMaxHp', amount: 2 }],
      upgraded: { effects: [energy(3), draw(3), { type: 'loseMaxHp', amount: 2 }] },
    });
  });
});

describe('#108 Exhaust cards', () => {
  const ex = (count: number, mode: string, extra: object = {}) => ({ type: 'exhaustCards', count, mode, ...extra });
  const str = (amount: number) => ({ type: 'gainStrength', amount });
  const windOf = (b: number) => [
    { type: 'exhaustCards', mode: 'all', filter: { notTypes: ['attack'] } },
    { type: 'repeat', per: 'lastEffectCount', effects: [block(b)] },
  ];

  it.each([
    ['brand', [loseHp(1), ex(1, 'choose'), str(1)], [loseHp(1), ex(1, 'choose'), str(2)], []],
    ['burning_pact', [ex(1, 'choose'), draw(2)], [ex(1, 'choose'), draw(3)], []],
    ['true_grit', [block(7), ex(1, 'random')], [block(9), ex(1, 'choose')], []],
    ['cinder', [atk(18), ex(1, 'random')], [atk(24), ex(1, 'random')], []],
    ['purity', [ex(3, 'choose', { upTo: true })], [ex(5, 'choose', { upTo: true })], ['retain', 'exhaust']],
    ['second_wind', windOf(5), windOf(7), []],
    [
      'fiend_fire',
      [{ type: 'script', id: 'fiendFire', values: [7] }],
      [{ type: 'script', id: 'fiendFire', values: [10] }],
      ['exhaust'],
    ],
    [
      'thrash',
      [atk(4, { hits: 2 }), { type: 'script', id: 'thrash' }],
      [atk(6, { hits: 2 }), { type: 'script', id: 'thrash' }],
      [],
    ],
  ])('%s is simulated', (id, base, up, keywords) => {
    expect(c[id]).toMatchObject({ simulated: true, keywords, effects: base, upgraded: { effects: up } });
  });

  it('Drum of Battle draws and gains energy when exhausted; simulated', () => {
    expect(c.drum_of_battle).toMatchObject({
      simulated: true,
      effects: [draw(2)],
      triggers: [{ when: 'exhausted', effects: [energy(2)] }],
      upgraded: { triggers: [{ when: 'exhausted', effects: [energy(3)] }] },
    });
  });

  it("Evil Eye, Ashen Strike and Pact's End are recorded but wait for conditional / attackFrom (#111)", () => {
    const exhaustedThisTurn = { kind: 'counter', counter: 'cardsExhaustedThisTurn', min: 1 };
    expect(c.evil_eye).toMatchObject({
      simulated: false,
      effects: [block(8), { type: 'conditional', if: exhaustedThisTurn, then: [block(8)] }],
      upgraded: { effects: [block(11), { type: 'conditional', if: exhaustedThisTurn, then: [block(11)] }] },
    });
    const per = (amount: number) => ({ per: 'exhaustPileSize', amount });
    expect(c.ashen_strike).toMatchObject({
      simulated: false,
      effects: [{ type: 'attackFrom', damage: 6, hits: 1, bonusPer: per(3) }],
      upgraded: { effects: [{ type: 'attackFrom', damage: 6, hits: 1, bonusPer: per(4) }] },
    });
    const three = { kind: 'counter', counter: 'exhaustPileSize', min: 3 };
    expect(c.pacts_end).toMatchObject({
      simulated: false,
      effects: [{ type: 'conditional', if: three, then: [atk(18, { allEnemies: true })] }],
      upgraded: { effects: [{ type: 'conditional', if: three, then: [atk(24, { allEnemies: true })] }] },
    });
  });
});

describe('#109 Powers', () => {
  const pw = (power: string, amount: number) => ({ type: 'applyPower', power, amount });
  const str = (amount: number) => ({ type: 'gainStrength', amount });

  it.each([
    ['inflame', [str(2)], [str(3)]],
    ['demon_form', [pw('demonForm', 3)], [pw('demonForm', 4)]],
    ['pyre', [pw('energyPerTurn', 1)], [pw('energyPerTurn', 2)]],
    ['rolling_boulder', [pw('rollingBoulder', 5)], [pw('rollingBoulder', 10)]],
    ['crimson_mantle', [pw('crimsonMantle', 7)], [pw('crimsonMantle', 10)]],
    ['stone_armor', [pw('plating', 4)], [pw('plating', 6)]],
    ['eternal_armor', [pw('plating', 9)], [pw('plating', 12)]],
    ['cruelty', [pw('cruelty', 25)], [pw('cruelty', 50)]],
    ['prowess', [str(1), pw('dexterity', 1)], [str(2), pw('dexterity', 2)]],
    ['fasten', [pw('fasten', 4)], [pw('fasten', 6)]],
    ['caltrops', [pw('thorns', 3)], [pw('thorns', 5)]],
    ['prep_time', [pw('vigorPerTurn', 4)], [pw('vigorPerTurn', 6)]],
  ])('%s is a simulated Power', (id, base, up) => {
    expect(c[id]).toMatchObject({ type: 'power', simulated: true, effects: base, upgraded: { effects: up } });
  });

  it.each([
    ['barricade', [pw('barricade', 1)], { cost: 2 }],
    ['corruption', [pw('corruption', 1)], { cost: 2 }],
    ['mad_science_expertise', [str(2), pw('dexterity', 2)], { keywords: ['innate'] }],
    ['mad_science_curious', [pw('powersCostLess', 1)], { keywords: ['innate'] }],
    ['mad_science_improvement', [pw('upgradeAtCombatEnd', 1)], { keywords: ['innate'] }],
  ])('%s is a simulated Power; the upgrade only changes cost or keywords', (id, base, up) => {
    expect(c[id]).toMatchObject({ type: 'power', simulated: true, effects: base, upgraded: up });
    expect(c[id]!.upgraded!.effects).toBeUndefined();
  });
});

describe('#114 Play other cards', () => {
  const play = (extra: object) => ({ type: 'playCards', from: 'draw', mode: 'top', count: 1, ...extra });
  const gem = (amount: number) => ({
    type: 'addReplay',
    amount,
    from: 'draw',
    mode: 'random',
    filter: { noReplay: true },
  });
  const copyOfHand = (count: number) => ({
    type: 'addCards',
    source: { kind: 'copyOf', from: 'hand', mode: 'choose', filter: { types: ['attack', 'power'] } },
    count,
    to: 'hand',
  });
  const self = { type: 'addCards', source: { kind: 'self' }, count: 1, to: 'discard' };

  it.each([
    ['havoc', [play({ exhaust: true })], undefined],
    ['cascade', [play({ xTimes: true })], [play({ xTimes: true, xBonus: 1 })]],
    ['catastrophe', [play({ mode: 'random', count: 2 })], [play({ mode: 'random', count: 3 })]],
    [
      'beat_down',
      [play({ from: 'discard', mode: 'random', count: 3, filter: { types: ['attack'] } })],
      [play({ from: 'discard', mode: 'random', count: 4, filter: { types: ['attack'] } })],
    ],
    ['hidden_gem', [gem(2)], [gem(3)]],
    ['anger', [atk(6), self], [atk(8), self]],
    ['dual_wield', [copyOfHand(1)], [copyOfHand(2)]],
  ])('%s is simulated', (id, base, up) => {
    expect(c[id]).toMatchObject({ simulated: true, effects: base });
    if (up) expect(c[id]).toMatchObject({ upgraded: { effects: up } });
  });

  it('Havoc only gets cheaper when upgraded', () => {
    expect(c.havoc).toMatchObject({ cost: 1, upgraded: { cost: 0 } });
    expect(c.havoc?.upgraded).not.toHaveProperty('effects');
  });

  it('Howl from Beyond plays itself from the Exhaust pile at the end of the turn; simulated', () => {
    expect(c.howl_from_beyond).toMatchObject({
      simulated: true,
      effects: [atk(18, { allEnemies: true })],
      triggers: [{ when: 'turnEndInExhaust', effects: [{ type: 'script', id: 'playSelf' }] }],
    });
  });
});

describe('#115 Statuses, healing and Max HP', () => {
  const trig = (...effects: object[]) => [{ when: 'turnEndInHand', effects }];
  const takes = (damage: number) => atk(damage);

  it('Not Yet heals 10 (13 upgraded)', () => {
    expect(c.not_yet).toMatchObject({
      simulated: true,
      effects: [{ type: 'heal', amount: 10 }],
      upgraded: { effects: [{ type: 'heal', amount: 13 }] },
    });
  });

  it('Feed raises Max HP only if Fatal; Brightest Flame loses 2 Max HP', () => {
    const fed = (n: number) => ({
      type: 'conditional',
      if: { kind: 'fatal' },
      then: [{ type: 'gainMaxHp', amount: n }],
    });
    expect(c.feed).toMatchObject({
      simulated: true,
      effects: [atk(10), fed(3)],
      upgraded: { effects: [atk(12), fed(4)] },
    });
    expect(c.brightest_flame).toMatchObject({ simulated: true });
  });

  it('Apparition, The Gambit and Whistle apply their powers', () => {
    expect(c.apparition).toMatchObject({
      simulated: true,
      effects: [{ type: 'applyPower', power: 'intangible', amount: 1 }],
    });
    const gambit = (n: number) => [block(n), { type: 'applyPower', power: 'gambit', amount: 1 }];
    expect(c.the_gambit).toMatchObject({ simulated: true, effects: gambit(50), upgraded: { effects: gambit(75) } });
    const stun = { type: 'applyEnemyPower', power: 'stun', amount: 1 };
    expect(c.whistle).toMatchObject({
      simulated: true,
      effects: [atk(33), stun],
      upgraded: { effects: [atk(44), stun] },
    });
  });

  it('"Lose X HP" curses and statuses are unblockable HP loss in a turnEndInHand trigger', () => {
    expect(c.bad_luck).toMatchObject({ simulated: true, triggers: trig(loseHp(13)) });
    expect(c.beckon).toMatchObject({ simulated: true, triggers: trig(loseHp(6)) });
    expect(c.regret).toMatchObject({
      simulated: true,
      triggers: trig({ type: 'repeat', per: 'handSize', effects: [loseHp(1)] }),
    });
  });

  it('"Take X damage" curses and statuses are blockable damage in a turnEndInHand trigger', () => {
    for (const [id, n] of [
      ['burn', 2],
      ['decay', 2],
      ['disintegration', 6],
      ['infection', 3],
      ['toxic', 5],
      ['wither', 3],
    ] as const) {
      expect(c[id]).toMatchObject({ simulated: true, triggers: trig(takes(n)) });
    }
    expect(c.wither!.upgraded).toMatchObject({ triggers: trig(takes(6)) });
  });
});
