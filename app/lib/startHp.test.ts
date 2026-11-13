import { describe, expect, it } from 'vitest';
import { gameData } from '../../data';
import { setupStartHp } from './startHp';

describe('#286 setup start HP default', () => {
  it('follows the character and Ascension; an explicit value wins', () => {
    expect(setupStartHp(gameData, { characterId: 'ironclad', ascension: 1 })).toBe(80);
    expect(setupStartHp(gameData, { characterId: 'ironclad', ascension: 2 })).toBe(64);
    expect(setupStartHp(gameData, { characterId: 'silent', ascension: 10 })).toBe(56);
    expect(setupStartHp(gameData, { characterId: 'silent', ascension: 10, startHp: 40 })).toBe(40);
  });
});
