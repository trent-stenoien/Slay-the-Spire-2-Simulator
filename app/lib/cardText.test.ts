import { describe, expect, it } from 'vitest';
import { gameData } from '../../data';
import { cardText, effectText } from './cardText';
import { CONTRACT_EFFECT_SAMPLES } from '../../engine/testFixtures';

const card = (id: string) => gameData.cards[id]!;

describe('card text', () => {
  it.each([
    [{ type: 'attack', damage: 6, hits: 1 } as const, 'Deal 6 damage'],
    [{ type: 'attack', damage: 5, hits: 2 } as const, 'Deal 5 damage 2 times'],
    [{ type: 'gainBlock', amount: 5 } as const, 'Gain 5 Block'],
    [{ type: 'gainStrength', amount: 2 } as const, 'Gain 2 Strength'],
    [{ type: 'applyVulnerable', amount: 2 } as const, 'Apply 2 Vulnerable'],
    [{ type: 'applyWeak', amount: 1 } as const, 'Apply 1 Weak'],
    [{ type: 'applyFrail', amount: 3 } as const, 'Apply 3 Frail'],
    [{ type: 'applyPoison', amount: 3 } as const, 'Apply 3 Poison'],
    [{ type: 'gainEnergy', amount: 2 } as const, 'Gain 2 Energy'],
    [
      { type: 'attack', damage: 5, hits: 1, allEnemies: true, xTimes: true } as const,
      'Deal 5 damage to ALL enemies X times',
    ],
    [{ type: 'attack', damage: 3, hits: 1, xTimes: true, xBonus: 1 } as const, 'Deal 3 damage X+1 times'],
  ])('%o → %s', (e, text) => {
    expect(effectText(e)).toBe(text);
  });

  it('describes Bash+', () => {
    expect(cardText(card('bash'), true)).toEqual({
      name: 'Bash+',
      cost: '2',
      lines: ['Deal 10 damage', 'Apply 3 Vulnerable'],
    });
  });

  it('shows keywords and a dash cost for unplayable cards', () => {
    expect(cardText(card('ascenders_bane'), false)).toEqual({
      name: "Ascender's Bane",
      cost: '—',
      lines: ['Unplayable', 'Ethereal', 'Eternal'],
    });
  });

  it('shows X as the cost of X-cost cards', () => {
    expect(cardText(card('whirlwind'), true)).toEqual({
      name: 'Whirlwind+',
      cost: 'X',
      lines: ['Deal 8 damage to ALL enemies X times'],
    });
  });

  it.each([
    ['hemokinesis', false, ['Lose 2 HP', 'Deal 15 damage']],
    ['pommel_strike', true, ['Deal 10 damage', 'Draw 2 cards']],
    ['battle_trance', false, ['Draw 3 cards', 'You cannot draw additional cards this turn']],
    ['pillage', false, ['Deal 6 damage', 'Draw cards until you draw a non-Attack card']],
    ['scrawl', true, ['Retain', 'Exhaust', 'Draw cards until your Hand is full']],
    ['offering', true, ['Exhaust', 'Lose 6 HP', 'Gain 2 Energy', 'Draw 5 cards']],
  ] as const)('describes #106/#107 card %s (upgraded: %s)', (id, up, lines) => {
    expect(cardText(card(id), up).lines).toEqual(lines);
  });

  it.each([
    ['brand', false, ['Lose 1 HP', 'Exhaust 1 card', 'Gain 1 Strength']],
    ['burning_pact', true, ['Exhaust 1 card', 'Draw 3 cards']],
    ['true_grit', false, ['Gain 7 Block', 'Exhaust 1 card at random']],
    ['true_grit', true, ['Gain 9 Block', 'Exhaust 1 card']],
    ['cinder', false, ['Deal 18 damage', 'Exhaust 1 card at random']],
    ['purity', true, ['Retain', 'Exhaust', 'Exhaust up to 5 cards']],
    ['second_wind', false, ['Exhaust all non-Attack cards in your Hand', 'Gain 5 Block for each card Exhausted']],
    ['fiend_fire', true, ['Exhaust', 'Exhaust your Hand. Deal 10 damage for each card Exhausted']],
    [
      'thrash',
      false,
      ['Deal 4 damage 2 times', 'Exhaust a random Attack in your Hand and add its damage to this card'],
    ],
    ['drum_of_battle', false, ['Draw 2 cards', 'When Exhausted: Gain 2 Energy']],
    ['drum_of_battle', true, ['Draw 2 cards', 'When Exhausted: Gain 3 Energy']],
  ] as const)('describes #108 card %s (upgraded: %s)', (id, up, lines) => {
    expect(cardText(card(id), up).lines).toEqual(lines);
  });

  it('describes exhaust from other piles and unfiltered "all"', () => {
    expect(effectText({ type: 'exhaustCards', mode: 'all' })).toBe('Exhaust your Hand');
    expect(effectText({ type: 'exhaustCards', from: 'draw', count: 2, mode: 'top' })).toBe(
      'Exhaust 2 cards from your Draw Pile',
    );
    expect(effectText({ type: 'exhaustCards', from: 'discard', mode: 'all', filter: { types: ['skill'] } })).toBe(
      'Exhaust all Skill cards from your Discard Pile',
    );
  });

  it('describes drawUntil stop filters', () => {
    expect(effectText({ type: 'drawUntil', stopOn: { types: ['skill'] } })).toBe(
      'Draw cards until you draw a Skill card',
    );
    expect(effectText({ type: 'drawUntil', stopOn: { cardId: 'x' } })).toBe(
      'Draw cards until you draw a matching card',
    );
  });

  it('applies an upgrade cost change', () => {
    const def = { ...card('strike'), upgraded: { cost: 0 } };
    expect(cardText(def, true).cost).toBe('0');
    expect(cardText(def, true).lines).toEqual(['Deal 6 damage']);
  });
});

describe('#105 fallback text for contract effects', () => {
  it.each(CONTRACT_EFFECT_SAMPLES.map((e) => [e.type, e] as const))('"%s" has plain non-empty text', (_type, e) => {
    const text = effectText(e);
    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(0);
  });

  it.each([
    [{ type: 'loseHp', amount: 2 } as const, 'Lose 2 HP'],
    [{ type: 'draw', amount: 1 } as const, 'Draw 1 card'],
    [{ type: 'draw', amount: 3 } as const, 'Draw 3 cards'],
    [{ type: 'heal', amount: 10 } as const, 'Heal 10 HP'],
    [{ type: 'applyPower', power: 'rupture', amount: 1 } as const, 'Gain 1 Rupture'],
    [{ type: 'exhaustCards', count: 3, mode: 'choose', upTo: true } as const, 'Exhaust up to 3 cards'],
  ])('%o → %s', (e, text) => {
    expect(effectText(e)).toBe(text);
  });
});

describe('#109 power card text', () => {
  it.each([
    ['demon_form', false, ['At the start of your turn, gain 3 Strength']],
    ['demon_form', true, ['At the start of your turn, gain 4 Strength']],
    ['pyre', true, ['Gain 2 Energy at the start of each turn']],
    [
      'rolling_boulder',
      false,
      ['At the start of your turn, deal 5 damage to ALL enemies and increase this damage by 5'],
    ],
    ['crimson_mantle', false, ['At the start of your turn, lose 1 HP and gain 7 Block']],
    ['stone_armor', false, ['Gain 4 Plating']],
    ['eternal_armor', true, ['Gain 12 Plating']],
    ['barricade', false, ['Block is not removed at the start of your turn']],
    ['cruelty', true, ['Vulnerable enemies take an additional 50% damage']],
    ['prowess', false, ['Gain 1 Strength', 'Gain 1 Dexterity']],
    ['mad_science_expertise', true, ['Innate', 'Gain 2 Strength', 'Gain 2 Dexterity']],
    ['fasten', false, ['Gain an additional 4 Block from Defend cards']],
    ['caltrops', true, ['Whenever you are attacked, deal 5 damage back']],
    ['prep_time', false, ['At the start of your turn, gain 4 Vigor']],
    ['mad_science_curious', false, ['Powers cost 1 Energy less']],
    ['mad_science_improvement', false, ['At the end of combat, Upgrade a random card']],
    ['corruption', false, ['Skills cost 0 Energy. Whenever you play a Skill, Exhaust it']],
  ] as const)('%s (upgraded %s)', (id, upgraded, lines) => {
    expect(cardText(gameData.cards[id]!, upgraded).lines).toEqual(lines);
  });

  it('Vigor on its own reads as a gain', () => {
    expect(effectText({ type: 'applyPower', power: 'vigor', amount: 3 })).toBe('Gain 3 Vigor');
  });
});
