/** Pure helpers for the "View a combat" picker and the combat log header. */

/** The internal (0-based) combat index shown to humans as a 1-based number. */
export function toDisplayCombat(index: number): number {
  return index + 1;
}

/** Parse the picker's 1-based text into the internal 0-based index, or null when not a whole number in 1..combats. */
export function fromDisplayCombat(text: string, combats: number): number | null {
  if (!/^[1-9]\d*$/.test(text.trim())) return null;
  const n = Number(text.trim());
  return n <= combats ? n - 1 : null;
}

/** Picker label, e.g. "Combat # (1-10000)". */
export function combatRangeLabel(combats: number): string {
  return `Combat # (1-${Math.max(1, combats)})`;
}

/** The checked strategies, in picker order. Hiding a strategy on the chart does not affect this. */
export function checkedIds(orderedIds: readonly string[], checked: ReadonlySet<string>): string[] {
  return orderedIds.filter((id) => checked.has(id));
}

/** The picker button: "Open combat log" for one checked strategy, "Compare" for 2+, disabled for none. */
export function pickerButton(checkedCount: number): { label: 'Open combat log' | 'Compare'; disabled: boolean } {
  return { label: checkedCount >= 2 ? 'Compare' : 'Open combat log', disabled: checkedCount === 0 };
}

/**
 * Where a percentile label links: the lowest-numbered combat in which the clicked label's strategy
 * lost exactly `hpLost` HP, opened for every strategy currently showing percentiles (1 = its combat
 * log, 2 = the compare view), in chart order. Null when that strategy never lost exactly `hpLost`.
 */
export function percentileLinkTarget(
  markedIds: readonly string[],
  clickedId: string,
  hpLost: number,
  firstCombatByHpLost: Readonly<Record<number, number>>,
): { combatIndex: number; strategyIds: string[] } | null {
  if (!markedIds.includes(clickedId)) return null;
  const combatIndex = firstCombatByHpLost[hpLost];
  if (combatIndex === undefined) return null;
  return { combatIndex, strategyIds: [...markedIds] };
}
