/** Joins a RunResult's summaries with the run's strategies and formats stats. */
import { COMBATS_PER_RUN } from '../../engine/types';
import type { GameData, RunConfig, RunResult, StrategyColor, StrategySummary } from '../../engine/types';
import { hpLostPercentile } from './chart';

export interface ResultRow {
  strategyId: string;
  name: string;
  color: StrategyColor;
  summary: StrategySummary;
  /** Index into result.config.strategies. */
  strategyIndex: number;
}

/**
 * One row per summary that matches a run strategy by id
 * (summary.strategyId === runStrategy.strategy.id), in run order.
 */
export function resultRows(result: RunResult): ResultRow[] {
  const rows: ResultRow[] = [];
  result.config.strategies.forEach((rs, strategyIndex) => {
    const summary = result.summaries.find((s) => s.strategyId === rs.strategy.id);
    if (summary)
      rows.push({ strategyId: rs.strategy.id, name: rs.strategy.name, color: rs.color, summary, strategyIndex });
  });
  return rows;
}

/**
 * Rows ordered by average HP lost, lowest first. Ties break by death rate (lowest first),
 * then by average combat turn length (`avgTurns`, lowest first), then by run (selection) order.
 * Returns a new array; colors travel with each row, so they are unchanged.
 */
export function sortResultRows(rows: readonly ResultRow[]): ResultRow[] {
  const num = (n: number | null) => (n === null || !Number.isFinite(n) ? Infinity : n);
  return [...rows].sort(
    (a, b) =>
      num(a.summary.avgHpLost) - num(b.summary.avgHpLost) ||
      num(a.summary.deathRate) - num(b.summary.deathRate) ||
      num(a.summary.avgTurns) - num(b.summary.avgTurns) ||
      a.strategyIndex - b.strategyIndex,
  );
}

/** resultRows in display order (see sortResultRows). */
export function sortedResultRows(result: RunResult): ResultRow[] {
  return sortResultRows(resultRows(result));
}

export function fmtNumber(n: number | null, digits = 2): string {
  return n === null || !Number.isFinite(n) ? '—' : n.toFixed(digits);
}

/** Fraction 0–1 → "12.3%". */
export function fmtRate(fraction: number): string {
  return Number.isFinite(fraction) ? `${(fraction * 100).toFixed(1)}%` : '—';
}

/** #104: true when some strategy gained gold or a potion (the Rewards column is shown only then). */
export function hasRewards(summaries: readonly Pick<StrategySummary, 'avgGold' | 'potionRate'>[]): boolean {
  return summaries.some((s) => s.avgGold > 0 || s.potionRate > 0);
}

/** #104: "+14.2 gold avg · Random Potion 63%"; "—" when the strategy gained nothing. */
export function fmtRewards(s: Pick<StrategySummary, 'avgGold' | 'potionRate'>): string {
  const parts: string[] = [];
  if (s.avgGold > 0) parts.push(`+${s.avgGold.toFixed(1)} gold avg`);
  if (s.potionRate > 0) {
    const pct = Math.round(s.potionRate * 100);
    parts.push(`Random Potion ${pct === 0 ? '<1' : pct}%`);
  }
  return parts.length > 0 ? parts.join(' · ') : '—';
}

/** A random 32-bit run seed. `random` is injectable for tests. */
export function randomSeed(random: () => number = Math.random): number {
  return Math.floor(random() * 0x100000000) >>> 0;
}

/** Seed field text → seed, or null for blank (random) / undefined for invalid. */
export function parseSeedInput(text: string): number | null | undefined {
  const t = text.trim();
  if (t === '') return null;
  if (!/^\d+$/.test(t)) return undefined;
  const n = Number(t);
  return n <= 0xffffffff ? n : undefined;
}

/**
 * The note on the character's starting relic when the simulator does not model it; null when it
 * does (#205: Burning Blood is a simulated relic, picked by default in Setup).
 */
export function relicNote(data: GameData, characterId: string): string | null {
  const name = data.characters[characterId]?.startingRelic;
  if (Object.values(data.relics ?? {}).some((r) => r.name === name && r.simulated)) return null;
  return `${name ?? 'The starting relic'} (starting relic) is not simulated.`;
}

/**
 * The seed a run will use: the field's number, or a newly generated one when it is blank.
 * undefined when the field text is invalid. `random` is injectable for tests.
 */
export function resolveRunSeed(text: string, random: () => number = Math.random): number | undefined {
  const parsed = parseSeedInput(text);
  return parsed === undefined ? undefined : (parsed ?? randomSeed(random));
}

/** "Ironclad vs Nibbit, Ascension 0. 10,000 simulated combats per strategy." from the run's own config. */
export function describeRun(data: GameData, cfg: RunConfig): string {
  const character = data.characters[cfg.characterId]?.name ?? cfg.characterId;
  const enemy = data.enemies[cfg.enemyId]?.name ?? cfg.enemyId;
  return `${character} vs ${enemy}, Ascension ${cfg.ascension}. ${COMBATS_PER_RUN.toLocaleString('en-US')} simulated combats per strategy.`;
}

/** "P25–P75" of HP lost (EN DASH), or one number when they are equal; "—" with no combats. */
export function fmtHpLostRange(hpLostCounts: readonly number[], offset = 0): string {
  const lo = hpLostPercentile(hpLostCounts, 25, offset);
  const hi = hpLostPercentile(hpLostCounts, 75, offset);
  if (lo === null || hi === null) return '—';
  return lo === hi ? String(lo) : `${lo}\u2013${hi}`;
}
