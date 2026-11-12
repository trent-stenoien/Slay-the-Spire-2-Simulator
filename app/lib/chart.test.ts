import { describe, expect, it } from 'vitest';
import { kdeCurve, rawCurve, silvermanBandwidth } from '../../engine/stats';
import {
  BANDWIDTH_FACTOR,
  bandwidthFactorLabel,
  clampBandwidthFactor,
  kdeBandwidth,
  toggleHidden,
  visibleHpLostRange,
  EMPTY_X_RANGE,
  NO_DATA_X_RANGE,
  curveRange,
  curvesMaxYInRange,
  hpLostPercentile,
  strategyPercentileMarkers,
  percentileMarkerSets,
  mergeMarkers,
  aboveCurvePath,
  bandwidthTicks,
  smoothedCurve,
  bandwidthTickValues,
  BAND_OPACITY,
  CURVE_FILL_OPACITY,
  spreadLabels,
  areaPath,
  curvesMaxY,
  linePath,
  linearScale,
  niceMax,
  niceStep,
  niceTicks,
  percentLabel,
} from './chart';

describe('chart scaling', () => {
  it('linearScale maps and inverts direction', () => {
    const s = linearScale([0, 10], [100, 0]);
    expect(s(0)).toBe(100);
    expect(s(5)).toBe(50);
    expect(s(10)).toBe(0);
    expect(linearScale([3, 3], [0, 10])(3)).toBe(5);
  });

  it.each([
    [10, 5, 2],
    [100, 5, 20],
    [7, 5, 2],
    [0.9, 5, 0.2],
    [0, 5, 1],
  ])('niceStep(%d, %d) = %d', (span, target, step) => {
    expect(niceStep(span, target)).toBeCloseTo(step);
  });

  it('niceTicks covers the range on step multiples', () => {
    expect(niceTicks(0, 10)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(niceTicks(3, 27)).toEqual([5, 10, 15, 20, 25]);
    expect(niceTicks(0, 0.5)).toEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5]);
    expect(niceTicks(4, 4)).toEqual([4]);
    expect(niceTicks(10, 0)).toEqual([0, 2, 4, 6, 8, 10]);
  });

  it('niceTicks with integer steps never goes below 1', () => {
    expect(niceTicks(0, 3, 10, true)).toEqual([0, 1, 2, 3]);
  });

  it('niceMax rounds up to a nice value with a floor', () => {
    expect(niceMax(13)).toBe(15);
    expect(niceMax(37)).toBe(40);
    expect(niceMax(0)).toBe(1);
    expect(niceMax(100)).toBe(100);
  });

  it('curvesMaxY', () => {
    expect(curvesMaxY([])).toBe(0);
    expect(
      curvesMaxY([
        [{ x: 0, y: 2 }],
        [
          { x: 1, y: 7 },
          { x: 2, y: 3 },
        ],
      ]),
    ).toBe(7);
  });

  it('builds line, step and area paths', () => {
    const id = (v: number) => v;
    const pts = [
      { x: 0, y: 1 },
      { x: 2, y: 3 },
    ];
    expect(linePath([], id, id)).toBe('');
    expect(linePath(pts, id, id)).toBe('M0,1L2,3');
    expect(linePath(pts, id, id, 'step')).toBe('M-0.5,1L0.5,1L1.5,3L2.5,3');
    expect(areaPath(pts, id, id, 10)).toBe('M0,1L2,3L2,10L0,10Z');
    expect(areaPath(pts, id, id, 10, 'step')).toBe('M-0.5,1L0.5,1L1.5,3L2.5,3L2.5,10L-0.5,10Z');
  });

  it('percentLabel', () => {
    expect(percentLabel(12)).toBe('12%');
    expect(percentLabel(2.5)).toBe('2.5%');
  });
});

describe('legend toggle', () => {
  it('hides a visible strategy and shows a hidden one, without mutating the input', () => {
    const none = new Set<string>();
    const hidA = toggleHidden(none, 'a');
    expect([...hidA]).toEqual(['a']);
    expect(none.size).toBe(0);
    const hidAB = toggleHidden(hidA, 'b');
    expect([...hidAB].sort()).toEqual(['a', 'b']);
    const hidB = toggleHidden(hidAB, 'a');
    expect([...hidB]).toEqual(['b']);
    expect(hidAB.has('a')).toBe(true);
    expect(toggleHidden(hidB, 'b').size).toBe(0);
  });
});

describe('KDE smoothing slider', () => {
  const counts = [0, 2, 5, 9, 4, 1, 0, 3, 6, 2];

  it('defaults to ×3 the Silverman bandwidth, over a ×0 (Raw) to ×5 range', () => {
    expect(BANDWIDTH_FACTOR).toMatchObject({ min: 0, max: 5, default: 3 });
    expect(kdeBandwidth(counts, BANDWIDTH_FACTOR.default)).toBeCloseTo(silvermanBandwidth(counts) * 3);
  });

  it('scales the Silverman bandwidth by the factor', () => {
    const base = silvermanBandwidth(counts);
    expect(kdeBandwidth(counts, 0.5)).toBeCloseTo(base * 0.5);
    expect(kdeBandwidth(counts, 4.5)).toBeCloseTo(base * 4.5);
  });

  it('clamps the factor into range; non-finite gives the ×3 default', () => {
    expect(clampBandwidthFactor(-1)).toBe(0);
    expect(clampBandwidthFactor(0.1)).toBe(0.1);
    expect(clampBandwidthFactor(10)).toBe(5);
    expect(clampBandwidthFactor(Number.NaN)).toBe(3);
    expect(kdeBandwidth(counts, 99)).toBeCloseTo(silvermanBandwidth(counts) * 5);
  });

  it('labels the factor', () => {
    expect(bandwidthFactorLabel(3)).toBe('×3.00');
    expect(bandwidthFactorLabel(0.25)).toBe('×0.25');
  });

  it('reads Raw at ×0', () => {
    expect(bandwidthFactorLabel(0)).toBe('Raw');
    expect(bandwidthFactorLabel(-3)).toBe('Raw');
    expect(bandwidthFactorLabel(0.05)).toBe('×0.05');
  });

  it('gives a zero bandwidth at ×0 and never divides by zero', () => {
    expect(kdeBandwidth(counts, 0)).toBe(0);
    expect(kdeCurve(counts, [0, 9], { bandwidth: 0 }).every((p) => Number.isFinite(p.y))).toBe(true);
  });

  it('draws the raw percentages at ×0 and the KDE above it', () => {
    const total = counts.reduce((a, b) => a + b, 0);
    const raw = smoothedCurve(counts, [0, 9], 0);
    expect(raw.map((p) => p.x)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    raw.forEach((p, v) => expect(p.y).toBeCloseTo((100 * counts[v]!) / total, 10));
    expect(raw).toEqual(rawCurve(counts, [0, 9]));
    expect(smoothedCurve(counts, [0, 9], 3)).toEqual(kdeCurve(counts, [0, 9], { bandwidth: kdeBandwidth(counts, 3) }));
    expect(smoothedCurve(counts, [0, 9], 3)).not.toEqual(raw);
  });
});

describe('hpLostPercentile (nearest rank on the histogram)', () => {
  it('returns null with no combats', () => {
    expect(hpLostPercentile([], 50)).toBeNull();
    expect(hpLostPercentile([0, 0, 0], 50)).toBeNull();
  });

  it('returns the only value for a single combat, at every percentile', () => {
    for (const p of [0, 5, 50, 95, 100]) expect(hpLostPercentile([0, 0, 0, 1], p)).toBe(3);
  });

  it('returns the common value when every combat lost the same HP', () => {
    for (const p of [5, 25, 50, 75, 95]) expect(hpLostPercentile([0, 0, 0, 0, 0, 0, 0, 40], p)).toBe(7);
  });

  it('uses rank ceil(p/100 × N), at least 1', () => {
    // 10 combats: values 0..9 once each. Rank ceil(p/10) → value rank-1.
    const counts = Array(10).fill(1);
    expect(hpLostPercentile(counts, 0)).toBe(0);
    expect(hpLostPercentile(counts, 5)).toBe(0); // rank 1
    expect(hpLostPercentile(counts, 25)).toBe(2); // rank 3
    expect(hpLostPercentile(counts, 50)).toBe(4); // rank 5
    expect(hpLostPercentile(counts, 51)).toBe(5); // rank 6
    expect(hpLostPercentile(counts, 95)).toBe(9); // rank 10
    expect(hpLostPercentile(counts, 100)).toBe(9);
  });

  it('walks the counts, skipping empty bins', () => {
    // 20 combats: 2×1 HP, 15×4 HP, 3×30 HP.
    const counts: number[] = [];
    counts[1] = 2;
    counts[4] = 15;
    counts[30] = 3;
    const filled = Array.from({ length: 31 }, (_, i) => counts[i] ?? 0);
    expect(hpLostPercentile(filled, 5)).toBe(1); // rank 1
    expect(hpLostPercentile(filled, 10)).toBe(1); // rank 2
    expect(hpLostPercentile(filled, 11)).toBe(4); // rank 3
    expect(hpLostPercentile(filled, 85)).toBe(4); // rank 17
    expect(hpLostPercentile(filled, 86)).toBe(30); // rank 18
  });

  it('clamps p into [0, 100]', () => {
    expect(hpLostPercentile([1, 1], -5)).toBe(0);
    expect(hpLostPercentile([1, 1], 500)).toBe(1);
  });
});

const row = (strategyId: string, hpLostCounts: number[]) => ({
  strategyId,
  summary: {
    strategyId,
    combats: 1,
    avgHpLost: 0,
    avgTurnsToKill: null,
    avgTurns: 1,
    avgGold: 0,
    potionRate: 0,
    deathRate: 0,
    turnCapRate: 0,
    hpLostCounts,
    firstCombatByHpLost: {},
  },
});
/** A histogram with `n` combats at each given HP value. */
const hist = (entries: Record<number, number>) => {
  const max = Math.max(...Object.keys(entries).map(Number));
  return Array.from({ length: max + 1 }, (_, i) => entries[i] ?? 0);
};

describe('visibleHpLostRange: [max(0, P5 - 2), P95 + 2] over visible strategies', () => {
  const a = row('a', [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 5]); // 10..12
  const b = row('b', [0, 0, 0, 2, 1]); // 3..4
  // 100 combats: 1 at 0 HP, 98 at 20 HP, 1 at 90 HP. P5 = P95 = 20, so the outliers are cut off.
  const outliers = row('o', hist({ 0: 1, 20: 98, 90: 1 }));

  it('spans the lowest P5 and highest P95 of all visible strategies, padded by 2', () => {
    expect(visibleHpLostRange([a, b], new Set())).toEqual([1, 14]);
  });

  it('ignores outliers below P5 and above P95', () => {
    expect(visibleHpLostRange([outliers], new Set())).toEqual([18, 22]);
  });

  it('rescales to the strategies still visible', () => {
    expect(visibleHpLostRange([a, b], new Set(['a']))).toEqual([1, 6]);
    expect(visibleHpLostRange([a, b], new Set(['b']))).toEqual([8, 14]);
    expect(visibleHpLostRange([a, outliers], new Set())).toEqual([8, 22]);
  });

  it('clamps the minimum at 0', () => {
    expect(visibleHpLostRange([row('c', [1])], new Set())).toEqual([0, 2]);
  });

  it('gives the default range when everything is hidden or there are no rows', () => {
    expect(visibleHpLostRange([a, b], new Set(['a', 'b']))).toEqual(EMPTY_X_RANGE);
    expect(visibleHpLostRange([], new Set())).toEqual(EMPTY_X_RANGE);
  });

  it('gives [0, 2] when the visible strategies have no combats', () => {
    expect(visibleHpLostRange([row('e', [])], new Set())).toEqual(NO_DATA_X_RANGE);
  });
});

describe('clipping helpers', () => {
  it('curves are computed 1 HP past the axis range on each side (not below 0)', () => {
    expect(curveRange([5, 20])).toEqual([4, 21]);
    expect(curveRange([0, 4])).toEqual([0, 5]);
  });

  it('the Y max ignores points outside the axis range', () => {
    const c = [
      { x: 3, y: 50 },
      { x: 5, y: 7 },
      { x: 10, y: 2 },
      { x: 11, y: 90 },
    ];
    expect(curvesMaxYInRange([c], [4, 10])).toBe(7);
  });
});

describe('strategyPercentileMarkers', () => {
  const a = row('a', Array(10).fill(1)); // 0..9 once each

  it('labels P5, P25, P50, P75, P95', () => {
    expect(strategyPercentileMarkers(a.summary.hpLostCounts)).toEqual([
      { p: 5, value: 0, label: 'P5 = 0' },
      { p: 25, value: 2, label: 'P25 = 2' },
      { p: 50, value: 4, label: 'P50 = 4' },
      { p: 75, value: 7, label: 'P75 = 7' },
      { p: 95, value: 9, label: 'P95 = 9' },
    ]);
  });

  it('is empty for a strategy with no combats', () => {
    expect(strategyPercentileMarkers([])).toEqual([]);
  });

  it('every marker lies inside the X range', () => {
    const o = row('o', hist({ 0: 1, 20: 98, 90: 1 }));
    const [lo, hi] = visibleHpLostRange([o], new Set());
    for (const m of strategyPercentileMarkers(o.summary.hpLostCounts)) {
      expect(m.value).toBeGreaterThanOrEqual(lo);
      expect(m.value).toBeLessThanOrEqual(hi);
    }
  });
});

describe('spreadLabels', () => {
  it('leaves well-separated labels where they are', () => {
    expect(
      spreadLabels(
        [
          { x: 50, width: 20 },
          { x: 100, width: 20 },
        ],
        [0, 200],
      ),
    ).toEqual([50, 100]);
  });

  it('pushes crowded labels apart sideways, keeping the gap', () => {
    const out = spreadLabels(
      [
        { x: 50, width: 40 },
        { x: 60, width: 40 },
        { x: 70, width: 40 },
      ],
      [0, 300],
    );
    expect(out[1]! - out[0]!).toBeGreaterThanOrEqual(44);
    expect(out[2]! - out[1]!).toBeGreaterThanOrEqual(44);
  });

  it('clamps labels inside the bounds, pulling a crowded group back from the right edge', () => {
    expect(
      spreadLabels(
        [
          { x: 2, width: 20 },
          { x: 199, width: 20 },
        ],
        [0, 200],
      ),
    ).toEqual([10, 190]);
    const out = spreadLabels(
      [
        { x: 195, width: 40 },
        { x: 198, width: 40 },
      ],
      [0, 200],
    );
    expect(out[1]).toBe(180);
    expect(out[0]).toBe(136);
  });

  it('handles no labels', () => {
    expect(spreadLabels([], [0, 200])).toEqual([]);
  });
});

describe('mergeMarkers', () => {
  const m = (p: number, value: number) => ({ p, value, label: '' });
  it('keeps distinct values as they are', () => {
    expect(mergeMarkers([m(5, 1), m(25, 2)]).map((g) => g.label)).toEqual(['P5 = 1', 'P25 = 2']);
  });
  it('merges equal values into one label', () => {
    const out = mergeMarkers([m(5, 3), m(25, 8), m(50, 8), m(75, 9), m(95, 9)]);
    expect(out.map((g) => g.label)).toEqual(['P5 = 3', 'P25–P50 = 8', 'P75–P95 = 9']);
  });
  it('merges all five when every value is equal', () => {
    expect(mergeMarkers([5, 25, 50, 75, 95].map((p) => m(p, 4))).map((g) => g.label)).toEqual(['P5–P95 = 4']);
  });
});

describe('bandwidthTicks', () => {
  it('labels the slider min (Raw), ×1-×4 and the max (×5) at their positions', () => {
    const ticks = bandwidthTicks();
    expect(ticks.map((t) => t.label)).toEqual(['Raw', '×1', '×2', '×3', '×4', '×5']);
    expect(ticks[0]!.fraction).toBe(0);
    expect(ticks[1]!.fraction).toBeCloseTo(0.2);
    expect(ticks[4]!.fraction).toBeCloseTo(0.8);
    expect(ticks[5]!.fraction).toBe(1);
    for (const t of ticks) {
      expect(t.value).toBeGreaterThanOrEqual(BANDWIDTH_FACTOR.min);
      expect(t.value).toBeLessThanOrEqual(BANDWIDTH_FACTOR.max);
    }
  });

  it('follows the slider range: a ×0 minimum gives ticks Raw, ×1 to ×5 without duplicates', () => {
    expect(bandwidthTickValues(0, 5)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(bandwidthTicks(0, 5).map((t) => t.fraction)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
  });
});

describe('fill opacities', () => {
  it('makes the P25-P75 band twice as transparent as the fill under the curve', () => {
    expect(CURVE_FILL_OPACITY).toBe(0.15);
    expect(BAND_OPACITY).toBe(0.075);
    expect(BAND_OPACITY).toBe(CURVE_FILL_OPACITY / 2);
  });
});

describe('percentileMarkerSets', () => {
  const a = row('a', Array(10).fill(1));
  const b = row('b', [0, 0, 0, 2, 1]);
  const c = row('c', [1, 1, 1]);

  it('marks every visible strategy, in row order', () => {
    const one = percentileMarkerSets([a, b, c], new Set(['b', 'c']));
    expect(one.map((s) => s.row.strategyId)).toEqual(['a']);
    expect(one[0]!.markers.map((m) => m.label)).toEqual(['P5 = 0', 'P25 = 2', 'P50 = 4', 'P75 = 7', 'P95 = 9']);
    const two = percentileMarkerSets([a, b, c], new Set(['c']));
    expect(two.map((s) => s.row.strategyId)).toEqual(['a', 'b']);
    expect(two[1]!.markers.map((m) => m.value)).toEqual([3, 3, 3, 4, 4]);
  });

  it('has no cap on strategies, and no marks with none visible', () => {
    expect(percentileMarkerSets([a, b, c], new Set()).map((s) => s.row.strategyId)).toEqual(['a', 'b', 'c']);
    expect(percentileMarkerSets([a, b, c], new Set(['a', 'b', 'c']))).toEqual([]);
    expect(percentileMarkerSets([], new Set())).toEqual([]);
  });

  it('skips a visible strategy with no combats', () => {
    expect(percentileMarkerSets([a, row('e', [])], new Set()).map((s) => s.row.strategyId)).toEqual(['a']);
  });
});

describe('aboveCurvePath', () => {
  const sx = linearScale([0, 10], [0, 100]);
  const sy = linearScale([0, 10], [100, 0]);
  const pts = [
    { x: 0, y: 2 },
    { x: 5, y: 8 },
    { x: 10, y: 4 },
  ];

  it('closes the curve up to the top of the plot (smooth)', () => {
    expect(aboveCurvePath(pts, sx, sy, 10)).toBe('M0,80L50,20L100,60L100,10L0,10Z');
  });

  it('follows the bar tops in the step (Raw) view', () => {
    expect(
      aboveCurvePath(
        [
          { x: 1, y: 5 },
          { x: 2, y: 10 },
        ],
        sx,
        sy,
        0,
        'step',
      ),
    ).toBe('M5,50L15,50L15,0L25,0L25,0L5,0Z');
  });

  it('is empty for an empty curve', () => {
    expect(aboveCurvePath([], sx, sy, 0)).toBe('');
  });
});
