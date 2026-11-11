import { describe, expect, it } from 'vitest';
import {
  checkedIds,
  combatRangeLabel,
  fromDisplayCombat,
  percentileLinkTarget,
  pickerButton,
  toDisplayCombat,
} from './combatPicker';

describe('combat number conversion (display is 1-based, internal 0-based)', () => {
  it('internal to display', () => {
    expect(toDisplayCombat(0)).toBe(1);
    expect(toDisplayCombat(9999)).toBe(10000);
  });
  it('display to internal', () => {
    expect(fromDisplayCombat('1', 10000)).toBe(0);
    expect(fromDisplayCombat('10000', 10000)).toBe(9999);
    expect(fromDisplayCombat('42', 10000)).toBe(41);
  });
  it('round-trips every boundary', () => {
    for (const i of [0, 1, 4999, 9998, 9999]) expect(fromDisplayCombat(String(toDisplayCombat(i)), 10000)).toBe(i);
  });
  it('rejects out-of-range and non-integer input', () => {
    for (const t of ['0', '10001', '-1', '1.5', '', 'abc', '01']) expect(fromDisplayCombat(t, 10000)).toBeNull();
  });
  it('labels the range 1-N', () => {
    expect(combatRangeLabel(10000)).toBe('Combat # (1-10000)');
  });
});

describe('checkedIds', () => {
  const ids = ['a', 'b', 'c'];
  it('keeps checked strategies in picker order', () => {
    expect(checkedIds(ids, new Set(['c', 'a']))).toEqual(['a', 'c']);
  });
  it('ignores checked ids that are not in the run', () => {
    expect(checkedIds(ids, new Set(['z']))).toEqual([]);
  });
});

describe('pickerButton', () => {
  it('is disabled with nothing checked', () => {
    expect(pickerButton(0)).toEqual({ label: 'Open combat log', disabled: true });
  });
  it('opens the combat log for one strategy', () => {
    expect(pickerButton(1)).toEqual({ label: 'Open combat log', disabled: false });
  });
  it('compares 2 or more', () => {
    for (const n of [2, 3, 5]) expect(pickerButton(n)).toEqual({ label: 'Compare', disabled: false });
  });
});

describe('percentileLinkTarget', () => {
  const first = { 3: 17, 7: 2, 12: 900 };
  it('one strategy: its own lowest combat with that HP lost', () => {
    expect(percentileLinkTarget(['a'], 'a', 7, first)).toEqual({ combatIndex: 2, strategyIds: ['a'] });
  });
  it("two strategies: both, at the clicked strategy's combat, in chart order", () => {
    expect(percentileLinkTarget(['a', 'b'], 'b', 12, first)).toEqual({ combatIndex: 900, strategyIds: ['a', 'b'] });
  });
  it('is null for an HP value the strategy never lost, or a strategy not marked', () => {
    expect(percentileLinkTarget(['a'], 'a', 4, first)).toBeNull();
    expect(percentileLinkTarget(['a'], 'b', 7, first)).toBeNull();
  });
  it('treats combat 0 as a real target', () => {
    expect(percentileLinkTarget(['a'], 'a', 0, { 0: 0 })).toEqual({ combatIndex: 0, strategyIds: ['a'] });
  });
});
