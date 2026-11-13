import { useId, useState, type CSSProperties } from 'react';
import { cumulativeCurve, rawCurve, type CurvePoint } from '../../engine/stats';
import { chartPalette, DASH_BY_COLOR } from '../lib/colors';
import {
  aboveCurvePath,
  areaPath,
  BAND_OPACITY,
  BANDWIDTH_FACTOR,
  CURVE_FILL_OPACITY,
  curveRange,
  hpLostOffset,
  offsetCurve,
  curvesMaxYInRange,
  linePath,
  linearScale,
  niceMax,
  niceTicks,
  mergeMarkers,
  percentileMarkerSets,
  percentLabel,
  smoothedCurve,
  spreadLabels,
  visibleHpLostRange,
  type CurveShape,
  type PercentileMarker,
} from '../lib/chart';
import type { StrategyColor } from '../../engine/types';
import type { ResultRow } from '../lib/results';
import {
  BandwidthSlider,
  ChartLegend,
  ColorBlindToggle,
  ModePicker,
  PercentileToggle,
  type ChartMode,
} from './ChartControls';

const W = 640;
const H = 320;
const M = { top: 12, right: 16, bottom: 44, left: 52 };
const PLOT_BOTTOM = H - M.bottom;
/** Percentile marker labels: font size and row height in viewBox units, and an approximate glyph width. */
const MARK_FONT = 11;
const MARK_ROW = 13;
const MARK_CHAR_W = 6.4;

type Scale = (v: number) => number;
type MarkerSet = { row: ResultRow; markers: PercentileMarker[] };
/** A merged marker label, its true x (for the line) and the x its text is centered on (shifted if crowded). */
type MarkLabel = { x: number; labelX: number; text: string; value: number };

const Y_LABELS: Record<ChartMode, string> = {
  kde: '% of combats (per HP)',
  raw: '% of combats',
  cumulative: '% of combats losing ≤ x HP',
};

/**
 * The x range fits only the visible strategies ([P5 − 2, P95 + 2]), so hiding or showing a
 * line rescales the axis. Curves extend 1 HP past it on each side and are clipped at the edge.
 */
function compute(rows: readonly ResultRow[], hidden: ReadonlySet<string>, mode: ChartMode, bandwidthFactor: number) {
  const range = visibleHpLostRange(rows, hidden);
  const span = curveRange(range);
  const build = (counts: readonly number[], at: [number, number]): CurvePoint[] => {
    if (mode === 'kde') return smoothedCurve(counts, at, bandwidthFactor); // ×0 is the raw per-HP percentages
    if (mode === 'raw') return rawCurve(counts, at);
    return cumulativeCurve(counts, at);
  };
  // #205: hpLostCounts start at minHpLost when HP lost went negative.
  const curve = (r: ResultRow) => offsetCurve(build, r.summary.hpLostCounts, span, hpLostOffset(r.summary));
  return { range, curves: rows.map(curve) };
}

/** Y offset of a marker label row in the strip above the plot. */
const labelY = (row: number) => M.top + MARK_FONT - 2 + row * MARK_ROW;

/**
 * Overlaid HP-lost distributions, one line + light fill per strategy. The legend sits
 * above the chart, aligned with the plot area; clicking an entry hides or shows that
 * strategy's line (hidden entries stay in the legend, dimmed). The KDE view has a smoothing
 * (bandwidth) slider with ticks from its min to its max. Each visible strategy's one's
 * P5/P25/P50/P75/P95 are marked in its color (one label row per strategy; crowded labels shift sideways, equal values merge), with a light
 * P25-P75 band drawn only above its curve. The "Show Percentiles" toggle hides them all.
 */
export function DistributionChart({
  rows,
  initialMode = 'kde',
  hidden: hiddenProp,
  onHiddenChange,
  colorBlind: colorBlindProp,
  onColorBlindChange,
  percentileHref,
}: {
  rows: ResultRow[];
  initialMode?: ChartMode;
  /** Optional controlled legend state (ids of hidden strategies); the parent can then react to it. */
  hidden?: ReadonlySet<string>;
  onHiddenChange?: (hidden: ReadonlySet<string>) => void;
  /** Optional controlled color-blind palette state, shared with the rest of the results panel. */
  colorBlind?: boolean;
  onColorBlindChange?: (on: boolean) => void;
  /**
   * Optional link for a percentile label: given the ids of every strategy showing percentiles
   * (chart order), the label's strategy and its HP value. Labels without an href stay plain text.
   */
  percentileHref?: (markedIds: string[], strategyId: string, hpLost: number) => string | undefined;
}) {
  const [mode, setMode] = useState<ChartMode>(initialMode);
  const [ownHidden, setOwnHidden] = useState<ReadonlySet<string>>(() => new Set());
  const hidden = hiddenProp ?? ownHidden;
  const setHidden = (next: ReadonlySet<string>) => {
    if (hiddenProp === undefined) setOwnHidden(next);
    onHiddenChange?.(next);
  };
  const [showPercentiles, setShowPercentiles] = useState(true);
  const [ownColorBlind, setOwnColorBlind] = useState(false);
  const colorBlind = colorBlindProp ?? ownColorBlind;
  const setColorBlind = (on: boolean) => {
    if (colorBlindProp === undefined) setOwnColorBlind(on);
    onColorBlindChange?.(on);
  };
  const palette = chartPalette(colorBlind);
  const [bandwidthFactor, setBandwidthFactor] = useState<number>(BANDWIDTH_FACTOR.default);
  const clipId = useId();

  let computed: ReturnType<typeof compute>;
  try {
    computed = compute(rows, hidden, mode, bandwidthFactor);
  } catch (err) {
    return (
      <div className="chart-box">
        <p className="warn">Chart unavailable: {err instanceof Error ? err.message : String(err)}</p>
      </div>
    );
  }

  const { range, curves } = computed;
  const visible = rows.map((r) => !hidden.has(r.strategyId));
  const yMax =
    mode === 'cumulative'
      ? 100
      : niceMax(
          curvesMaxYInRange(
            curves.filter((_, i) => visible[i]),
            range,
          ),
          5,
          1,
        );
  const sx = linearScale(range, [M.left, W - M.right]);
  const markerSets = showPercentiles ? percentileMarkerSets(rows, hidden) : [];
  // One label row per strategy; crowded labels shift left/right, equal values share a label.
  const markerLabels: MarkLabel[][] = markerSets.map((set) => {
    const merged = mergeMarkers(set.markers);
    const xs = spreadLabels(
      merged.map((m) => ({ x: sx(m.value), width: m.label.length * MARK_CHAR_W + 4 })),
      [M.left + 2, W - M.right - 2],
    );
    return merged.map((m, i) => ({ x: sx(m.value), labelX: xs[i]!, text: m.label, value: m.value }));
  });
  // Marker labels get their own strip above the plot, so they never sit on the curves.
  const labelRows = markerSets.length;
  const top = M.top + (labelRows > 0 ? labelRows * MARK_ROW + 2 : 0);
  const sy = linearScale([0, yMax], [PLOT_BOTTOM, top]);
  const shape: CurveShape = mode === 'raw' ? 'step' : 'smooth';
  const curveIndex = (row: ResultRow) => rows.indexOf(row);

  return (
    <div className="chart-box">
      {/* Picker, smoothing row and legend share the plot's left edge (the Y axis). */}
      <div className="chart-controls" style={{ paddingLeft: `${(M.left / W) * 100}%` }}>
        <ModePicker mode={mode} onChange={setMode} />
        {mode === 'kde' && <BandwidthSlider factor={bandwidthFactor} onChange={setBandwidthFactor} />}
        <div className="legend-row">
          <ChartLegend rows={rows} hidden={hidden} onChange={setHidden} palette={palette} colorBlind={colorBlind} />
          <div className="chart-toggles">
            <ColorBlindToggle on={colorBlind} onChange={setColorBlind} />
            <PercentileToggle on={showPercentiles} onChange={setShowPercentiles} />
          </div>
        </div>
      </div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`HP lost distribution, ${mode} view`}>
        <defs>
          <clipPath id={clipId}>
            <rect x={M.left} y={top} width={W - M.left - M.right} height={PLOT_BOTTOM - top} />
          </clipPath>
          {markerSets.map(({ row }) => {
            const i = curveIndex(row);
            return (
              <clipPath key={row.strategyId} id={`${clipId}-above-${i}`}>
                <path d={aboveCurvePath(curves[i]!, sx, sy, top, shape)} />
              </clipPath>
            );
          })}
        </defs>
        <Axes
          sx={sx}
          sy={sy}
          top={top}
          xTicks={niceTicks(range[0], range[1], 8, true)}
          yTicks={niceTicks(0, yMax, 5)}
          yLabel={Y_LABELS[mode]}
        />
        <g clipPath={`url(#${clipId})`}>
          {/* P25-P75 bands, only between each marked strategy's curve and the top of the plot. */}
          {markerSets.map(({ row, markers }) => (
            <PercentileBand
              key={`band-${row.strategyId}`}
              row={row}
              markers={markers}
              sx={sx}
              top={top}
              color={palette[row.color]}
              clipPath={`url(#${clipId}-above-${curveIndex(row)})`}
            />
          ))}
          {curves.map((pts, i) => {
            if (!visible[i]) return null;
            const color = palette[rows[i]!.color];
            const dash = colorBlind ? DASH_BY_COLOR[rows[i]!.color] : undefined;
            return (
              <g key={rows[i]!.strategyId}>
                <path
                  className="curve-fill"
                  d={areaPath(pts, sx, sy, sy(0), shape)}
                  fill={color}
                  fillOpacity={CURVE_FILL_OPACITY}
                  stroke="none"
                />
                <path
                  d={linePath(pts, sx, sy, shape)}
                  fill="none"
                  stroke={color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeDasharray={dash}
                />
              </g>
            );
          })}
        </g>
        {markerSets.length > 0 && (
          <PercentileMarks sets={markerSets} labels={markerLabels} palette={palette} percentileHref={percentileHref} />
        )}
      </svg>
    </div>
  );
}

function Axes({
  sx,
  sy,
  top,
  xTicks,
  yTicks,
  yLabel,
}: {
  sx: Scale;
  sy: Scale;
  top: number;
  xTicks: number[];
  yTicks: number[];
  yLabel: string;
}) {
  return (
    <>
      {yTicks.map((t) => (
        <g key={`y${t}`}>
          <line className="grid" x1={M.left} x2={W - M.right} y1={sy(t)} y2={sy(t)} />
          <text className="tick" x={M.left - 6} y={sy(t)} textAnchor="end" dominantBaseline="middle">
            {percentLabel(t)}
          </text>
        </g>
      ))}
      {xTicks.map((t) => (
        <g key={`x${t}`}>
          <line className="axis" x1={sx(t)} x2={sx(t)} y1={PLOT_BOTTOM} y2={PLOT_BOTTOM + 5} />
          <text className="tick" x={sx(t)} y={PLOT_BOTTOM + 18} textAnchor="middle">
            {t}
          </text>
        </g>
      ))}
      <line className="axis" x1={M.left} x2={W - M.right} y1={PLOT_BOTTOM} y2={PLOT_BOTTOM} />
      <line className="axis" x1={M.left} x2={M.left} y1={top} y2={PLOT_BOTTOM} />
      <text className="axis-label" x={(M.left + W - M.right) / 2} y={H - 6} textAnchor="middle">
        HP lost
      </text>
      <text
        className="axis-label"
        transform={`translate(14 ${(top + PLOT_BOTTOM) / 2}) rotate(-90)`}
        textAnchor="middle"
      >
        {yLabel}
      </text>
    </>
  );
}

function PercentileBand({
  markers,
  sx,
  top,
  color,
  clipPath,
}: MarkerSet & { sx: Scale; top: number; color: string; clipPath: string }) {
  const p25 = markers.find((m) => m.p === 25)!.value;
  const p75 = markers.find((m) => m.p === 75)!.value;
  return (
    <rect
      className="pband"
      x={sx(p25)}
      y={top}
      width={Math.max(0, sx(p75) - sx(p25))}
      height={PLOT_BOTTOM - top}
      fill={color}
      fillOpacity={BAND_OPACITY}
      clipPath={clipPath}
    />
  );
}

/** Marker lines for every set, then their labels on top (optionally linked to a combat). */
function PercentileMarks({
  sets,
  labels,
  palette,
  percentileHref,
}: {
  sets: MarkerSet[];
  labels: MarkLabel[][];
  palette: Record<StrategyColor, string>;
  percentileHref?: (markedIds: string[], strategyId: string, hpLost: number) => string | undefined;
}) {
  const markColor = (row: ResultRow) => ({ '--mark-color': palette[row.color] }) as CSSProperties;
  const markedIds = () => sets.map((set) => set.row.strategyId);
  return (
    <g className="pmarks" aria-label="Percentiles of HP lost">
      {sets.map(({ row }, s) => (
        <g key={row.strategyId} className="pmark-set" style={markColor(row)}>
          {labels[s]!.map((l) => (
            <line key={`l${l.value}`} className="pmark" x1={l.x} x2={l.x} y1={labelY(s) + 3} y2={PLOT_BOTTOM} />
          ))}
        </g>
      ))}
      {sets.map(({ row }, s) => (
        <g key={`t-${row.strategyId}`} className="pmark-set" style={markColor(row)}>
          {labels[s]!.map((m) => {
            const label = (
              <text
                key={`t${m.value}`}
                className="pmark-label"
                x={m.labelX}
                y={labelY(s)}
                textAnchor="middle"
                fontSize={MARK_FONT}
              >
                {m.text}
              </text>
            );
            const href = percentileHref?.(markedIds(), row.strategyId, m.value);
            if (!href) return label;
            return (
              <a
                key={`t${m.value}`}
                className="pmark-link"
                href={href}
                target="_blank"
                rel="noopener"
                aria-label={`${row.name}: ${m.text} HP lost, open the first combat with that HP lost`}
              >
                {label}
              </a>
            );
          })}
        </g>
      ))}
    </g>
  );
}
