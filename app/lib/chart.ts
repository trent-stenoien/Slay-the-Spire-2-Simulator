/** Pure scaling helpers for the hand-built SVG distribution chart. */
import { kdeCurve, rawCurve, silvermanBandwidth } from '../../engine/stats';
import type { StrategySummary } from '../../engine/types';

export interface Point {
  x: number;
  y: number;
}

/** Linear map from [d0, d1] to [r0, r1]. A zero-width domain maps to the range midpoint. */
export function linearScale(domain: [number, number], range: [number, number]): (v: number) => number {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  if (d1 === d0) return () => (r0 + r1) / 2;
  const k = (r1 - r0) / (d1 - d0);
  return (v) => r0 + (v - d0) * k;
}

/** A "nice" step (1, 2, 5 × 10^n) so that span / step is about `target`. */
export function niceStep(span: number, target: number): number {
  if (!(span > 0) || !(target > 0)) return 1;
  const raw = span / target;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nice * pow;
}

/**
 * Tick values on multiples of a nice step inside [min, max] (inclusive).
 * `integer` forces steps ≥ 1 (HP-lost axis).
 */
export function niceTicks(min: number, max: number, target = 5, integer = false): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (max < min) [min, max] = [max, min];
  if (max === min) return [min];
  let step = niceStep(max - min, target);
  if (integer) step = Math.max(1, Math.round(step));
  const first = Math.ceil(min / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = first; v <= max + step * 1e-9; v += step) {
    ticks.push(Number(v.toFixed(10)));
  }
  return ticks;
}

/** Upper bound for the Y axis: the smallest nice tick at or above the data max (at least `floor`). */
export function niceMax(dataMax: number, target = 5, floor = 1): number {
  const m = Math.max(dataMax, floor);
  const step = niceStep(m, target);
  return Math.ceil(m / step - 1e-9) * step;
}

/** Max y across all curves (0 for none). */
export function curvesMaxY(curves: readonly (readonly Point[])[]): number {
  let m = 0;
  for (const c of curves) for (const p of c) if (p.y > m) m = p.y;
  return m;
}

function fmt(n: number): string {
  return String(Math.round(n * 100) / 100);
}

export type CurveShape = 'smooth' | 'step';

/**
 * SVG path for a curve. 'smooth' joins points with straight segments (the KDE
 * is sampled finely); 'step' draws a histogram-like step centered on each x.
 */
export function linePath(
  points: readonly Point[],
  sx: (v: number) => number,
  sy: (v: number) => number,
  shape: CurveShape = 'smooth',
): string {
  if (points.length === 0) return '';
  if (shape === 'smooth') {
    return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${fmt(sx(p.x))},${fmt(sy(p.y))}`).join('');
  }
  const out: string[] = [];
  points.forEach((p, i) => {
    const left = sx(p.x - 0.5);
    const right = sx(p.x + 0.5);
    const y = sy(p.y);
    out.push(`${i === 0 ? 'M' : 'L'}${fmt(left)},${fmt(y)}`, `L${fmt(right)},${fmt(y)}`);
  });
  return out.join('');
}

/** Closed area path: the line, then down to the baseline and back. */
export function areaPath(
  points: readonly Point[],
  sx: (v: number) => number,
  sy: (v: number) => number,
  baselineY: number,
  shape: CurveShape = 'smooth',
): string {
  const line = linePath(points, sx, sy, shape);
  if (!line) return '';
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const x0 = shape === 'step' ? sx(first.x - 0.5) : sx(first.x);
  const x1 = shape === 'step' ? sx(last.x + 0.5) : sx(last.x);
  return `${line}L${fmt(x1)},${fmt(baselineY)}L${fmt(x0)},${fmt(baselineY)}Z`;
}

/** Percent label for an axis tick: "12%", "2.5%". */
export function percentLabel(v: number): string {
  return `${fmt(v)}%`;
}

/**
 * Legend toggle: returns a new set of hidden strategy ids with `id` flipped
 * (visible -> hidden, hidden -> visible). The input set is not modified.
 */
export function toggleHidden(hidden: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(hidden);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** KDE smoothing slider: a multiplier on each strategy's Silverman bandwidth. Starts (and resets) at ×3; ×0 means no smoothing (the raw per-HP percentages). */
export const BANDWIDTH_FACTOR = { min: 0, max: 5, step: 0.05, default: 3 } as const;

/** Clamp a slider value into [min, max]; non-finite values give the default (×3). */
export function clampBandwidthFactor(factor: number): number {
  if (!Number.isFinite(factor)) return BANDWIDTH_FACTOR.default;
  return Math.min(BANDWIDTH_FACTOR.max, Math.max(BANDWIDTH_FACTOR.min, factor));
}

/** True when the factor is the slider minimum ×0: no kernel, the line runs through the raw per-HP shares. */
export function isRawFactor(factor: number): boolean {
  return clampBandwidthFactor(factor) === 0;
}

/** KDE bandwidth for one strategy: Silverman's rule × the (clamped) slider factor. */
export function kdeBandwidth(hpLostCounts: readonly number[], factor: number): number {
  return silvermanBandwidth(hpLostCounts) * clampBandwidthFactor(factor);
}

/**
 * The Smoothed view's curve for one strategy: a Gaussian KDE at the slider's bandwidth, or at ×0
 * the raw per-HP percentages (one point per integer HP, joined by the same smooth line style).
 */
export function smoothedCurve(hpLostCounts: readonly number[], range: [number, number], factor: number): Point[] {
  if (isRawFactor(factor)) return rawCurve(hpLostCounts, range);
  return kdeCurve(hpLostCounts, range, { bandwidth: kdeBandwidth(hpLostCounts, factor) });
}

/** Opacity of the fill under each curve, and of the P25-P75 band above it (twice as transparent). */
export const CURVE_FILL_OPACITY = 0.15;
export const BAND_OPACITY = CURVE_FILL_OPACITY / 2;

/**
 * Labelled tick marks under the smoothing slider: the slider's own min and max (a non-integer
 * end is labelled as is) plus every whole multiplier between them,
 * so the ticks follow the slider if its range changes.
 */
export function bandwidthTickValues(min: number = BANDWIDTH_FACTOR.min, max: number = BANDWIDTH_FACTOR.max): number[] {
  const values = new Set<number>([min, max]);
  for (let v = Math.ceil(min); v <= Math.floor(max); v++) values.add(v);
  return [...values].sort((a, b) => a - b);
}

/** "Raw" for ×0, otherwise "×n" (n as given). */
function factorText(value: number): string {
  return value === 0 ? 'Raw' : `×${value}`;
}

/** Tick label and position along the slider track (0 = min, 1 = max). */
export function bandwidthTicks(
  min: number = BANDWIDTH_FACTOR.min,
  max: number = BANDWIDTH_FACTOR.max,
): { value: number; label: string; fraction: number }[] {
  return bandwidthTickValues(min, max).map((value) => ({
    value,
    label: factorText(value),
    fraction: (value - min) / (max - min),
  }));
}

/** Slider label: "×1.00", or "Raw" at ×0. */
export function bandwidthFactorLabel(factor: number): string {
  const f = clampBandwidthFactor(factor);
  return f === 0 ? 'Raw' : `×${f.toFixed(2)}`;
}

/** X range shown when every strategy is hidden. */
export const EMPTY_X_RANGE: [number, number] = [0, 10];

/** X range when the visible strategies have no observed combats at all. */
export const NO_DATA_X_RANGE: [number, number] = [0, 2];

/** Padding (in HP) added on each side of the [P5, P95] span. */
export const X_RANGE_PADDING = 2;

/**
 * Percentile `p` (0–100) of raw HP lost from a histogram (`hpLostCounts[n]` = combats that
 * lost n HP), by the nearest-rank method: with N combats sorted ascending, the value at
 * rank ceil(p / 100 × N), at least rank 1. So P0 is the minimum, P100 the maximum, and the
 * result is always an observed HP-lost value. Returns null when there are no combats.
 */
export function hpLostPercentile(hpLostCounts: readonly number[], p: number): number | null {
  let n = 0;
  for (const c of hpLostCounts) n += c > 0 ? c : 0;
  if (n === 0) return null;
  const q = Math.min(100, Math.max(0, p));
  const rank = Math.max(1, Math.ceil((q / 100) * n - 1e-9));
  let run = 0;
  for (let v = 0; v < hpLostCounts.length; v++) {
    const c = hpLostCounts[v] ?? 0;
    if (c > 0) run += c;
    if (run >= rank) return v;
  }
  return hpLostCounts.length - 1; // unreachable: run reaches n
}

type ChartRow = { strategyId: string; summary: StrategySummary };

/**
 * X-axis range fitted to the strategies not in `hidden`: [max(0, P5 − 2), P95 + 2], where P5
 * is the lowest 5th percentile and P95 the highest 95th percentile of raw HP lost among the
 * visible strategies (nearest rank, see `hpLostPercentile`). Data outside the range is drawn
 * to the edge and clipped. With none visible, EMPTY_X_RANGE; visible but no combats, NO_DATA_X_RANGE.
 */
export function visibleHpLostRange(rows: readonly ChartRow[], hidden: ReadonlySet<string>): [number, number] {
  const shown = rows.filter((r) => !hidden.has(r.strategyId));
  if (shown.length === 0) return [...EMPTY_X_RANGE];
  let lo = Infinity;
  let hi = -Infinity;
  for (const r of shown) {
    const p5 = hpLostPercentile(r.summary.hpLostCounts, 5);
    const p95 = hpLostPercentile(r.summary.hpLostCounts, 95);
    if (p5 !== null && p5 < lo) lo = p5;
    if (p95 !== null && p95 > hi) hi = p95;
  }
  if (lo === Infinity) return [...NO_DATA_X_RANGE];
  return [Math.max(0, lo - X_RANGE_PADDING), hi + X_RANGE_PADDING];
}

/** Range the curves are computed over: the axis range plus 1 HP each side (min 0), so lines run to the clip edge. */
export function curveRange(range: [number, number]): [number, number] {
  return [Math.max(0, range[0] - 1), range[1] + 1];
}

/** Max y over the points whose x lies in [range[0], range[1]], so clipped peaks don't set the Y axis. */
export function curvesMaxYInRange(curves: readonly (readonly Point[])[], range: [number, number]): number {
  return curvesMaxY(curves.map((c) => c.filter((p) => p.x >= range[0] && p.x <= range[1])));
}

/** Percentiles marked on the chart for each visible strategy (for every visible strategy). */
export const MARKER_PERCENTILES = [5, 25, 50, 75, 95] as const;

export interface PercentileMarker {
  p: number;
  value: number;
  label: string;
}

/** One strategy's labelled P5/P25/P50/P75/P95 of raw HP lost, or [] if it has no combats. */
export function strategyPercentileMarkers(hpLostCounts: readonly number[]): PercentileMarker[] {
  const out: PercentileMarker[] = [];
  for (const p of MARKER_PERCENTILES) {
    const value = hpLostPercentile(hpLostCounts, p);
    if (value === null) return [];
    out.push({ p, value, label: `P${p} = ${value}` });
  }
  return out;
}

/**
 * Percentile marks per visible strategy, in row order: one entry per visible strategy that has
 * combats. Empty when no strategy is visible.
 */
export function percentileMarkerSets<R extends ChartRow>(
  rows: readonly R[],
  hidden: ReadonlySet<string>,
): { row: R; markers: PercentileMarker[] }[] {
  const shown = rows.filter((r) => !hidden.has(r.strategyId));
  return shown
    .map((row) => ({ row, markers: strategyPercentileMarkers(row.summary.hpLostCounts) }))
    .filter((s) => s.markers.length > 0);
}

/** Markers with equal values, which are always adjacent, merged into one label: "P25–P50 = 8". */
export interface MergedMarker {
  ps: number[];
  value: number;
  label: string;
}

export function mergeMarkers(markers: readonly PercentileMarker[]): MergedMarker[] {
  const out: MergedMarker[] = [];
  for (const m of markers) {
    const last = out[out.length - 1];
    if (last && last.value === m.value) last.ps.push(m.p);
    else out.push({ ps: [m.p], value: m.value, label: '' });
  }
  for (const g of out) {
    const names = g.ps.length === 1 ? `P${g.ps[0]}` : `P${g.ps[0]}–P${g.ps[g.ps.length - 1]}`;
    g.label = `${names} = ${g.value}`;
  }
  return out;
}

/**
 * Closed path of the region ABOVE a curve: the line, then up to `topY` and back. Used as a
 * clip path so the P25-P75 band fills only the space between the curve and the top of the plot.
 */
export function aboveCurvePath(
  points: readonly Point[],
  sx: (v: number) => number,
  sy: (v: number) => number,
  topY: number,
  shape: CurveShape = 'smooth',
): string {
  return areaPath(points, sx, sy, topY, shape);
}

/**
 * Places one strategy's marker labels on a single row. Each label is centered on its x; labels
 * that would overlap (closer than `gap`) are pushed left/right, never down, and everything is
 * kept inside `bounds`. Items must be sorted by x. Returns each label's center x.
 */
export function spreadLabels(
  items: readonly { x: number; width: number }[],
  bounds: [number, number],
  gap = 4,
): number[] {
  const cx = items.map((it) => it.x);
  // Left to right: push each label right of the previous one.
  for (let i = 0; i < items.length; i++) {
    const half = items[i]!.width / 2;
    let min = bounds[0] + half;
    if (i > 0) min = Math.max(min, cx[i - 1]! + items[i - 1]!.width / 2 + gap + half);
    cx[i] = Math.max(min, cx[i]!);
  }
  // Right to left: pull back anything pushed past the right bound (and its neighbours).
  for (let i = items.length - 1; i >= 0; i--) {
    const half = items[i]!.width / 2;
    let max = bounds[1] - half;
    if (i < items.length - 1) max = Math.min(max, cx[i + 1]! - items[i + 1]!.width / 2 - gap - half);
    cx[i] = Math.min(max, cx[i]!);
  }
  return cx;
}
