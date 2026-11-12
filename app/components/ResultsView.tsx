import { useState, type CSSProperties } from 'react';
import { deriveSeed } from '../../engine/rng';
import type { GameData, RunResult, StrategyColor } from '../../engine/types';
import { chartPalette, COLOR_HEX } from '../lib/colors';
import { Swatch } from './ChartControls';
import {
  describeRun,
  fmtHpLostRange,
  fmtNumber,
  fmtRate,
  fmtRewards,
  hasRewards,
  sortedResultRows,
  type ResultRow,
} from '../lib/results';
import { DistributionChart } from './DistributionChart';
import { toggleHidden } from '../lib/chart';
import { logHref } from '../lib/links';
import {
  checkedIds,
  combatRangeLabel,
  fromDisplayCombat,
  percentileLinkTarget,
  pickerButton,
  toDisplayCombat,
} from '../lib/combatPicker';

/** The results body (stats table, chart, combat picker), strategies sorted by avg HP lost. */
export function ResultsView({ data, result }: { data: GameData; result: RunResult }) {
  const rows = sortedResultRows(result);
  const cfg = result.config;
  const combats = rows[0]?.summary.combats ?? 0;
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  // One color-blind setting for the whole results panel, so every strategy key uses the same colors.
  const [colorBlind, setColorBlind] = useState(false);
  const palette = chartPalette(colorBlind);

  return (
    <div className="results">
      <p className="muted small">{describeRun(data, cfg)}</p>
      <StatsTable rows={rows} colorBlind={colorBlind} palette={palette} />
      {rows.length > 0 && (
        <DistributionChart
          rows={rows}
          hidden={hidden}
          onHiddenChange={setHidden}
          colorBlind={colorBlind}
          onColorBlindChange={setColorBlind}
          percentileHref={(markedIds, strategyId, hpLost) => {
            const row = rows.find((r) => r.strategyId === strategyId);
            const t = row ? percentileLinkTarget(markedIds, strategyId, hpLost, row.summary.firstCombatByHpLost) : null;
            return t ? combatHref(data, result, rows, t.strategyIds, t.combatIndex) : undefined;
          }}
        />
      )}
      {rows.length > 0 && (
        <ViewCombat data={data} result={result} combats={combats} colorBlind={colorBlind} palette={palette} />
      )}
    </div>
  );
}

function StatsTable({
  rows,
  colorBlind,
  palette,
}: {
  rows: readonly ResultRow[];
  colorBlind: boolean;
  palette: Record<StrategyColor, string>;
}) {
  const showRewards = hasRewards(rows.map((r) => r.summary));
  return (
    <div className="table-wrap">
      <table className="stats">
        <thead>
          <tr>
            <th scope="col">Strategy</th>
            <th scope="col">Avg HP lost</th>
            <th scope="col">HP lost, P25-P75</th>
            <th scope="col">Avg combat turn length</th>
            <th scope="col">Death rate</th>
            {showRewards && <th scope="col">Rewards</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.strategyId}>
              <th scope="row">
                <Swatch color={palette[r.color]} colorBlind={colorBlind} strategyColor={r.color} />
                {r.name}
              </th>
              <td>{fmtNumber(r.summary.avgHpLost)}</td>
              <td>{fmtHpLostRange(r.summary.hpLostCounts, r.summary.minHpLost)}</td>
              <td>{fmtNumber(r.summary.avgTurns)}</td>
              <td>{fmtRate(r.summary.deathRate)}</td>
              {showRewards && <td>{fmtRewards(r.summary)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * "View a combat": a checkbox per strategy shown on the chart (in its color) and one shared
 * combat number. One checked strategy opens its combat log; 2+ open the compare view.
 */
export function ViewCombat({
  data,
  result,
  combats,
  initialChecked,
  colorBlind = false,
  palette = COLOR_HEX,
}: {
  data: GameData;
  result: RunResult;
  combats: number;
  /** Color-blind palette and dash keys, shared with the chart (default: the normal palette). */
  colorBlind?: boolean;
  palette?: Record<StrategyColor, string>;
  /** Strategy ids checked at first (default: the first row). */
  initialChecked?: readonly string[];
}) {
  const rows = sortedResultRows(result);
  const [idx, setIdx] = useState(0); // 0-based internally; the field shows idx + 1
  const [text, setText] = useState(String(toDisplayCombat(0)));
  const [checked, setChecked] = useState<ReadonlySet<string>>(
    () => new Set(initialChecked ?? rows.slice(0, 1).map((r) => r.strategyId)),
  );
  if (rows.length === 0) return null;
  // Every strategy is listed, whether or not it is hidden on the chart.
  const ids = checkedIds(
    rows.map((r) => r.strategyId),
    checked,
  );
  const button = pickerButton(ids.length);
  const seed = deriveSeed(result.config.runSeed, idx);
  const href = button.disabled ? undefined : combatHref(data, result, rows, ids, idx);
  const toggle = (id: string) => setChecked((c) => toggleHidden(c, id)); // same set flip as the chart legend

  return (
    <div className="view-combat">
      <h3>View a combat</h3>
      <div className="field-row">
        <fieldset className="field strategy-checks">
          <legend>Strategies</legend>
          {rows.map((r) => (
            <label
              key={r.strategyId}
              className="strategy-check"
              style={{ '--strategy-color': palette[r.color] } as CSSProperties}
            >
              <input type="checkbox" checked={checked.has(r.strategyId)} onChange={() => toggle(r.strategyId)} />
              <Swatch color={palette[r.color]} colorBlind={colorBlind} strategyColor={r.color} />
              {r.name}
            </label>
          ))}
        </fieldset>
        <label className="field field-narrow">
          <span>{combatRangeLabel(combats)}</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={Math.max(1, combats)}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              const n = fromDisplayCombat(e.target.value, combats);
              if (n !== null) setIdx(n);
            }}
          />
        </label>
        {button.disabled ? (
          <span className="btn btn-disabled" aria-disabled="true" role="link">
            {button.label}
          </span>
        ) : (
          <a className="btn" href={href} target="_blank" rel="noopener">
            {button.label}
          </a>
        )}
      </div>
      <p className="muted small">
        {button.disabled
          ? 'Check at least one strategy to view its combat.'
          : `Combat ${toDisplayCombat(idx)} uses seed ${seed}; every strategy faces the same combat for a given number.`}
      </p>
    </div>
  );
}

/** Link to combat `idx` for the given strategy ids (in order): its combat log, or the compare view for 2+. */
export function combatHref(
  data: GameData,
  result: RunResult,
  rows: readonly ResultRow[],
  ids: readonly string[],
  idx: number,
): string {
  const picked = ids.flatMap((id) => rows.filter((r) => r.strategyId === id));
  const seed = deriveSeed(result.config.runSeed, idx);
  return logHref(data, result.config, {
    seed,
    strategies: picked.map((r) => result.config.strategies[r.strategyIndex]!.strategy.config),
    ...(picked.length > 1 ? { colors: picked.map((r) => r.color) } : {}),
    combatIndex: idx,
  });
}
