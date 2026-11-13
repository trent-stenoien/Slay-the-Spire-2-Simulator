import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { sameConfig, strategyCode } from '../../engine/strategies';
import type { GameData, GameEvent, SavedStrategy, StrategyColor, StrategyConfig } from '../../engine/types';
import { defaultName, describeConfig } from '../lib/strategyLibrary';
import { useSavedLibrary } from '../useStrategies';
import {
  ascensionLabel,
  describeEvent,
  enemyIntentLabel,
  hpLostPhrase,
  type Round,
  type SideSnapshot,
} from '../lib/logReplay';
import { setupHref } from '../lib/links';
import { setupEnemyIds, type LogTarget, type SetupState } from '../lib/url';
import { enemyNames } from '../lib/results';
import { Panel } from './Panel';
import { deckSize } from '../lib/deck';
import { toDisplayCombat } from '../lib/combatPicker';
import {
  clampTurn,
  columnTurn,
  outcomeLabel,
  replayCombat,
  sharedTurnCount,
  type ReplayedCombat,
  type TurnIntent,
} from '../lib/compare';
import { COLOR_HEX, COLORS } from '../lib/colors';

interface Props {
  data: GameData;
  setup: SetupState;
  target: LogTarget;
}

/**
 * The shown turn (0-based, clamped to `count`), with step/jump setters. Left/Right arrow keys
 * step it too (ignored while typing in a field).
 */
function useTurn(count: number) {
  const [turnIdx, setTurnIdx] = useState(0);
  const step = useCallback((d: number) => setTurnIdx((i) => clampTurn(i + d, count)), [count]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === 'ArrowRight') step(1);
      if (e.key === 'ArrowLeft') step(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step]);
  return { idx: clampTurn(turnIdx, count), step, jump: setTurnIdx };
}

/** Card name for an id (the id itself if unknown). */
const cardNamer = (data: GameData) => (id: string) => data.cards[id]?.name ?? id;

/** The log page for a link: the single combat log, or the compare view for 2+ strategies. */
export function CombatLog({ data, setup, target }: Props) {
  return target.strategies.length > 1 ? (
    <CompareLog data={data} setup={setup} target={target} />
  ) : (
    <SingleLog data={data} setup={setup} target={target} />
  );
}

function LogHeader({ data, setup, target, children }: Props & { children: ReactNode }) {
  const enemy = enemyNames(data, setupEnemyIds(setup));
  return (
    <>
      <div className="panel-actions">
        <a className="btn-link" href={setupHref(data, setup)}>
          Back to setup
        </a>
      </div>
      {target.combatIndex !== undefined && (
        <p className="combat-number">
          <strong>Combat #{toDisplayCombat(target.combatIndex)}</strong>
        </p>
      )}
      <p className="muted small">
        {enemy}, {ascensionLabel(setup.ascension)}, {deckSize(setup.deck)}-card deck. {children}
        Seed {target.seed}.
      </p>
    </>
  );
}

/** Replays one combat from a seed + strategy and steps through it turn by turn. */
function SingleLog({ data, setup, target }: Props) {
  const strategy = target.strategies[0]!;
  const outcome = useMemo(() => replayCombat(data, setup, strategy, target.seed), [data, setup, strategy, target.seed]);
  const roundCount = outcome.ok ? outcome.replay.rounds.length : 0;
  const { idx, step, jump } = useTurn(roundCount);
  const name = cardNamer(data);

  return (
    <Panel id="log" title="Combat Log">
      <LogHeader data={data} setup={setup} target={target}>
        Strategy: {describeConfig(strategy)} (<code>{strategyCode(strategy)}</code>).{' '}
      </LogHeader>
      {!outcome.ok ? (
        <p className="warn">Could not replay this combat: {outcome.error}</p>
      ) : (
        <>
          <p className={`outcome outcome-${outcome.result.outcome}`}>
            {outcomeLabel(outcome.result.outcome)} on turn {outcome.result.turns},{' '}
            {hpLostPhrase(outcome.result.hpLost, true)}.
          </p>
          {roundCount > 0 && (
            <div className="round">
              <TurnNav idx={idx} count={roundCount} onStep={step} onJump={jump} />
              <RoundBody
                round={outcome.replay.rounds[idx]!}
                intent={outcome.intents[idx] ?? null}
                characterId={setup.characterId}
                name={name}
              />
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

/** Saved name for a strategy config (from the given library), or its default name. */
function strategyName(config: StrategyConfig, library: readonly SavedStrategy[]): string {
  const saved = library.find((s) => sameConfig(s.config, config));
  return saved?.name ?? defaultName(config);
}

interface Column {
  config: StrategyConfig;
  name: string;
  color: StrategyColor;
  combat: ReplayedCombat;
}

/** Several strategies on the same combat, side by side, all showing the same turn. */
function CompareLog({ data, setup, target }: Props) {
  const library = useSavedLibrary();
  const columns = useMemo(
    (): Column[] =>
      target.strategies.map((config, i) => ({
        config,
        name: strategyName(config, library),
        color: target.colors?.[i] ?? COLORS[i % COLORS.length]!,
        combat: replayCombat(data, setup, config, target.seed),
      })),
    [data, setup, target, library],
  );
  const count = sharedTurnCount(columns.map((c) => (c.combat.ok ? c.combat.replay.rounds.length : 0)));
  const { idx, step, jump } = useTurn(count);
  const name = cardNamer(data);

  return (
    <Panel id="log" title="Combat Log">
      <LogHeader data={data} setup={setup} target={target}>
        Comparing {columns.length} strategies.{' '}
      </LogHeader>
      {count > 0 && <TurnNav idx={idx} count={count} onStep={step} onJump={jump} />}
      <div className="compare-cols" style={{ '--cols': columns.length } as CSSProperties}>
        {columns.map((col) => (
          <CompareColumn
            key={strategyCode(col.config)}
            col={col}
            idx={idx}
            characterId={setup.characterId}
            name={name}
          />
        ))}
      </div>
    </Panel>
  );
}

function CompareColumn({
  col,
  idx,
  characterId,
  name,
}: {
  col: Column;
  idx: number;
  characterId: string;
  name: (id: string) => string;
}) {
  return (
    <section
      className="compare-col"
      style={{ '--strategy-color': COLOR_HEX[col.color] } as CSSProperties}
      aria-label={col.name}
    >
      <header className="compare-head">
        <h3>
          <span className="legend-swatch" style={{ background: COLOR_HEX[col.color] }} aria-hidden />
          {col.name}
        </h3>
        {col.combat.ok ? (
          <p className={`outcome small outcome-${col.combat.result.outcome}`}>
            {outcomeLabel(col.combat.result.outcome)} on turn {col.combat.result.turns},{' '}
            {hpLostPhrase(col.combat.result.hpLost)}
          </p>
        ) : (
          <p className="warn small">Could not replay: {col.combat.error}</p>
        )}
      </header>
      {col.combat.ok && <CompareCell combat={col.combat} idx={idx} characterId={characterId} name={name} />}
    </section>
  );
}

function CompareCell({
  combat,
  idx,
  characterId,
  name,
}: {
  combat: Extract<ReplayedCombat, { ok: true }>;
  idx: number;
  characterId: string;
  name: (id: string) => string;
}) {
  const at = columnTurn(combat.replay.rounds.length, idx);
  if (at.kind === 'ended') {
    return (
      <p className={`compare-ended outcome outcome-${combat.result.outcome}`}>
        Combat ended on turn {at.endTurn}: {outcomeLabel(combat.result.outcome).toLowerCase()},{' '}
        {hpLostPhrase(combat.result.hpLost)}.
      </p>
    );
  }
  return (
    <RoundBody
      round={combat.replay.rounds[at.index]!}
      intent={combat.intents[at.index] ?? null}
      characterId={characterId}
      name={name}
    />
  );
}

function TurnNav({
  idx,
  count,
  onStep,
  onJump,
}: {
  idx: number;
  count: number;
  onStep: (d: number) => void;
  onJump: (i: number) => void;
}) {
  return (
    <div className="turn-nav">
      <button type="button" className="btn" onClick={() => onStep(-1)} disabled={idx === 0} aria-label="Previous turn">
        ← Prev
      </button>
      <label className="turn-pick">
        Turn{' '}
        <select value={idx} onChange={(e) => onJump(Number(e.target.value))}>
          {Array.from({ length: count }, (_, i) => (
            <option key={i} value={i}>
              {i + 1}
            </option>
          ))}
        </select>{' '}
        of {count}
      </label>
      <button
        type="button"
        className="btn"
        onClick={() => onStep(1)}
        disabled={idx >= count - 1}
        aria-label="Next turn"
      >
        Next →
      </button>
    </div>
  );
}

/** One turn: both fighters, the intent the player saw, then the Your Turn and Enemy Turn blocks. */
function RoundBody({
  round,
  intent,
  characterId,
  name,
}: {
  intent: TurnIntent;
  characterId: string;
  round: Round;
  name: (id: string) => string;
}) {
  const lines = (evs: GameEvent[]) => evs.map((e) => describeEvent(e, name)).filter((s): s is string => s !== null);
  const playerLines = lines(round.playerEvents);
  const enemyLines = lines(round.enemyEvents).filter((l) => !l.startsWith('Enemy uses'));
  return (
    <div className="round-body">
      <div className="fighters">
        <Fighter label="You" start={round.start.player} end={round.end.player} />
        {round.start.enemies.length > 1 ? (
          round.start.enemies.map((start, i) => (
            <Fighter key={i} label={`Enemy ${i + 1}`} start={start} end={round.end.enemies[i] ?? start} />
          ))
        ) : (
          <Fighter label="Enemy" start={round.start.enemy} end={round.end.enemy} />
        )}
      </div>
      <p className="intent">{enemyIntentLabel(intent?.intent ?? null, intent?.effects)}</p>
      <div className={`phase phase-you phase-${characterId}`}>
        <h4>Your Turn</h4>
        <p className="small">
          <strong>Drew:</strong> {round.drawn.length ? round.drawn.map(name).join(', ') : 'nothing'}
        </p>
        <EventList lines={playerLines} empty="No cards played." />
      </div>
      <div className="phase phase-enemy">
        <h4>Enemy Turn{round.enemyMove ? `: ${round.enemyMove}` : ''}</h4>
        {round.enemyMove === null ? (
          <p className="muted small">The combat ended before the enemy acted.</p>
        ) : (
          <EventList lines={enemyLines} empty="Nothing happened." />
        )}
      </div>
    </div>
  );
}

function EventList({ lines, empty }: { lines: string[]; empty: string }) {
  if (lines.length === 0) return <p className="muted small">{empty}</p>;
  return (
    <ol className="events">
      {lines.map((l, i) => (
        <li key={i}>{l}</li>
      ))}
    </ol>
  );
}

function Fighter({ label, start, end }: { label: string; start: SideSnapshot; end: SideSnapshot }) {
  const pct = start.maxHp > 0 ? (end.hp / start.maxHp) * 100 : 0;
  const deb = Object.entries(end.debuffs).filter(([, v]) => v > 0);
  return (
    <div className="fighter">
      <div className="fighter-head">
        <strong>{label}</strong>
        <span>
          HP {start.hp} → {end.hp} / {start.maxHp}
        </span>
      </div>
      <div className="hpbar" aria-hidden>
        <div style={{ width: `${pct}%` }} />
      </div>
      <div className="small muted">
        Block at end {end.block}
        {end.strength ? ` · Strength ${end.strength}` : ''}
        {deb.map(([k, v]) => ` · ${k} ${v}`).join('')}
        {end.poison ? ` · poison ${end.poison}` : ''}
      </div>
    </div>
  );
}
