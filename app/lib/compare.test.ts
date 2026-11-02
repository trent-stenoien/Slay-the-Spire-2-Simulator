import { describe, expect, it } from 'vitest';
import { gameData } from '../../data';
import { clampTurn, columnTurn, outcomeLabel, replayCombat, sharedTurnCount } from './compare';
import { defaultSetup } from './url';
import { GREEDY_CONFIG, blockFirstConfig } from '../../engine/strategies';

describe('compare turn alignment', () => {
  it('the shared selector spans the longest combat', () => {
    expect(sharedTurnCount([4, 7, 5])).toBe(7);
    expect(sharedTurnCount([3])).toBe(3);
    expect(sharedTurnCount([])).toBe(0);
  });

  it('every column shows the same turn while its combat lasts', () => {
    for (const idx of [0, 1, 3]) {
      expect([4, 7, 5].map((n) => columnTurn(n, idx))).toEqual([
        { kind: 'round', index: idx },
        { kind: 'round', index: idx },
        { kind: 'round', index: idx },
      ]);
    }
  });

  it('a column past its end shows the turn its combat ended on', () => {
    // Shared turn 6 (index 5): the 4-turn combat ended on turn 4, the 5-turn one on turn 5.
    expect([4, 7, 5].map((n) => columnTurn(n, 5))).toEqual([
      { kind: 'ended', endTurn: 4 },
      { kind: 'round', index: 5 },
      { kind: 'ended', endTurn: 5 },
    ]);
    // The last round of a combat is still shown, not "ended".
    expect(columnTurn(4, 3)).toEqual({ kind: 'round', index: 3 });
    expect(columnTurn(4, 4)).toEqual({ kind: 'ended', endTurn: 4 });
  });

  it('clamps the shared turn', () => {
    expect(clampTurn(-1, 7)).toBe(0);
    expect(clampTurn(9, 7)).toBe(6);
    expect(clampTurn(3, 7)).toBe(3);
    expect(clampTurn(0, 0)).toBe(0);
  });

  it('labels outcomes', () => {
    expect(outcomeLabel('win')).toBe('Won');
    expect(outcomeLabel('loss')).toBe('Died');
    expect(outcomeLabel('turnCap')).toBe('Hit the turn cap');
  });
});

describe('replayCombat', () => {
  const setup = defaultSetup(gameData);
  it('has one round and one intent per turn, matching the combat result', () => {
    const r = replayCombat(gameData, setup, GREEDY_CONFIG, 123456);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.replay.rounds).toHaveLength(r.result.turns);
    expect(r.intents).toHaveLength(r.result.turns);
  });
  it('is deterministic for a seed', () => {
    const a = replayCombat(gameData, setup, blockFirstConfig(4), 77);
    const b = replayCombat(gameData, setup, blockFirstConfig(4), 77);
    expect(a).toEqual(b);
  });
  it('reports errors instead of throwing', () => {
    const r = replayCombat(gameData, { ...setup, enemyId: 'nope' }, GREEDY_CONFIG, 1);
    expect(r.ok).toBe(false);
  });
});
