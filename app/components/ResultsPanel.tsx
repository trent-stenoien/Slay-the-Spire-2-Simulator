import { useState } from 'react';
import type { GameData, RunResult } from '../../engine/types';
import type { SimulationProgress } from '../sim/runSimulation';
import { parseSeedInput, randomSeed, relicNote, resolveRunSeed } from '../lib/results';
import { Panel } from './Panel';
import { ResultsView } from './ResultsView';

export type RunStatus =
  | { kind: 'idle' }
  | { kind: 'running'; progress: SimulationProgress | null }
  | { kind: 'error'; message: string; notImplemented: boolean }
  | { kind: 'done' };

interface Props {
  data: GameData;
  /** The setup's character, for the starting-relic note. */
  characterId: string;
  result: RunResult | null;
  status: RunStatus;
  /** Why the run can't start, or null when it can. */
  blocker: string | null;
  onRun: (seed: number) => void;
}

const SEED_ERROR = 'Seed must be a whole number from 0 to 4294967295.';

const ENGINE_UNAVAILABLE =
  "The simulation engine isn't available in this build yet (the Monte Carlo runner is still being implemented). Setup, deck and strategy choices still work, and combat logs can be viewed from a link.";

/** The full error message for a failed run, or null when the run didn't fail. */
function runErrorText(status: RunStatus): string | null {
  if (status.kind !== 'error') return null;
  return status.notImplemented ? ENGINE_UNAVAILABLE : `Simulation failed: ${status.message}`;
}

/**
 * The Results panel: Run button, progress, blocker and error live in the title bar (usable
 * while collapsed); the run seed and the results live in the body. Starts collapsed on
 * every load and expands when a run finishes.
 */
export function ResultsPanel({ data, characterId, result, status, blocker, onRun }: Props) {
  const [seedText, setSeedText] = useState('');
  const seed = parseSeedInput(seedText);
  const running = status.kind === 'running';
  const reason = blocker ?? (seed === undefined ? SEED_ERROR : null);
  const disabled = running || reason !== null;
  const pct =
    status.kind === 'running' && status.progress && status.progress.total > 0
      ? (status.progress.done / status.progress.total) * 100
      : 0;
  const start = () => {
    if (disabled) return;
    const used = resolveRunSeed(seedText);
    if (used === undefined) return;
    setSeedText(String(used));
    onRun(used);
  };

  const errorText = runErrorText(status);

  const actions = (
    <>
      {running && (
        <span className="run-state muted small" role="status">
          {status.progress && status.progress.total > 0 ? `Running… ${Math.round(pct)}%` : 'Running…'}
        </span>
      )}
      {!running && reason && <span className="run-state warn-text small">{blocker ?? 'Invalid seed'}</span>}
      {!running && !reason && errorText && (
        <span className="run-state warn-text small run-error" title={errorText} role="alert">
          {status.kind === 'error' && status.notImplemented ? 'Engine unavailable' : 'Run failed'}
        </span>
      )}
      <button type="button" className="btn btn-primary" disabled={disabled} title={reason ?? undefined} onClick={start}>
        {running ? 'Running…' : 'Run simulation'}
      </button>
    </>
  );

  return (
    <Panel id="res" title="Results" actions={actions} defaultCollapsed expandOn={result ?? undefined}>
      {relicNote(data, characterId) && <p className="note">{relicNote(data, characterId)}</p>}
      <form
        className="field-row run-seed"
        onSubmit={(e) => {
          e.preventDefault();
          start();
        }}
      >
        <label className="field">
          <span>Run seed (blank = random)</span>
          <input
            inputMode="numeric"
            placeholder="random"
            value={seedText}
            aria-invalid={seed === undefined}
            onChange={(e) => setSeedText(e.target.value)}
          />
        </label>
        <button type="button" className="btn run-seed-new" onClick={() => setSeedText(String(randomSeed()))}>
          Generate new seed
        </button>
      </form>
      {seed === undefined && <p className="warn small">{SEED_ERROR}</p>}
      {status.kind === 'running' && (
        <div
          className="progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct)}
        >
          <div style={{ width: `${pct}%` }} />
          <span>{status.progress ? `${status.progress.done} / ${status.progress.total} combats` : 'Starting…'}</span>
        </div>
      )}
      {errorText && <p className="warn">{errorText}</p>}
      {result ? (
        <ResultsView data={data} result={result} />
      ) : (
        <p className="muted results-empty">Run a simulation to see the results.</p>
      )}
    </Panel>
  );
}
