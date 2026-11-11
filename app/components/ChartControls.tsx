import { useId, type CSSProperties } from 'react';
import type { StrategyColor } from '../../engine/types';
import {
  BANDWIDTH_FACTOR,
  bandwidthFactorLabel,
  bandwidthTicks,
  clampBandwidthFactor,
  toggleHidden,
} from '../lib/chart';
import type { ResultRow } from '../lib/results';
import { InfoPopover } from './InfoPopover';

export type ChartMode = 'kde' | 'raw' | 'cumulative';

const MODES: { id: ChartMode; label: string }[] = [
  { id: 'kde', label: 'Smoothed (KDE)' },
  { id: 'cumulative', label: 'Cumulative' },
];

export function ModePicker({ mode, onChange }: { mode: ChartMode; onChange: (mode: ChartMode) => void }) {
  return (
    <div className="segmented" role="tablist" aria-label="Chart view">
      {MODES.map((m) => (
        <button
          key={m.id}
          type="button"
          role="tab"
          aria-selected={mode === m.id}
          className={mode === m.id ? 'on' : ''}
          onClick={() => onChange(m.id)}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

/** KDE smoothing slider (a multiplier on Silverman's bandwidth) with labelled ticks and a Reset button. */
export function BandwidthSlider({ factor, onChange }: { factor: number; onChange: (factor: number) => void }) {
  const sliderId = useId();
  const ticks = bandwidthTicks();
  return (
    <div className="bandwidth">
      <label htmlFor={sliderId}>Smoothing</label>
      <InfoPopover />
      <span className="bandwidth-slider">
        <input
          id={sliderId}
          type="range"
          list={`${sliderId}-ticks`}
          min={BANDWIDTH_FACTOR.min}
          max={BANDWIDTH_FACTOR.max}
          step={BANDWIDTH_FACTOR.step}
          value={factor}
          aria-valuetext={`${bandwidthFactorLabel(factor)} Silverman bandwidth`}
          onChange={(e) => onChange(clampBandwidthFactor(Number(e.target.value)))}
        />
        <datalist id={`${sliderId}-ticks`}>
          {ticks.map((t) => (
            <option key={t.value} value={t.value} label={t.label} />
          ))}
        </datalist>
        <span className="bandwidth-ticks" aria-hidden>
          {ticks.map((t) => (
            <span key={t.value} className="bandwidth-tick" style={{ '--f': t.fraction } as CSSProperties}>
              {t.label}
            </span>
          ))}
        </span>
      </span>
      <output htmlFor={sliderId} className="small">
        {bandwidthFactorLabel(factor)}
      </output>
      <button
        type="button"
        className="btn-link bandwidth-reset small"
        disabled={factor === BANDWIDTH_FACTOR.default}
        onClick={() => onChange(BANDWIDTH_FACTOR.default)}
      >
        Reset
      </button>
    </div>
  );
}

/** Legend: clicking an entry hides or shows that strategy (hidden entries stay, dimmed). */
export function ChartLegend({
  rows,
  hidden,
  onChange,
  palette,
}: {
  rows: readonly ResultRow[];
  hidden: ReadonlySet<string>;
  onChange: (hidden: ReadonlySet<string>) => void;
  palette: Record<StrategyColor, string>;
}) {
  return (
    <ul className="legend" aria-label="Strategies (click to show or hide)">
      {rows.map((r) => {
        const visible = !hidden.has(r.strategyId);
        return (
          <li key={r.strategyId}>
            <button
              type="button"
              className={visible ? 'legend-item' : 'legend-item off'}
              aria-pressed={visible}
              title={visible ? `Hide ${r.name}` : `Show ${r.name}`}
              onClick={() => onChange(toggleHidden(hidden, r.strategyId))}
            >
              <span className="legend-swatch" style={{ background: palette[r.color] }} aria-hidden />
              <span className="legend-name" data-text={r.name}>
                {r.name}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** "Color-blind palette" toggle: Okabe-Ito colors plus a distinct dash pattern per strategy line. */
export function ColorBlindToggle({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="pct-toggle small">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
      Color-blind palette
    </label>
  );
}

/** "Show Percentiles" toggle, at the far right of the legend row. */
export function PercentileToggle({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="pct-toggle small">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
      Show Percentiles
    </label>
  );
}
