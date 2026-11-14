import { useEffect, useMemo, useState } from 'react';
import { gameData } from '../data';
import type { RunConfig, RunResult, RunStrategy } from '../engine/types';
import { CombatLog } from './components/CombatLog';
import { DeckBuilder } from './components/DeckBuilder';
import { FeedbackDialog } from './components/FeedbackDialog';
import { ResultsPanel, type RunStatus } from './components/ResultsPanel';
import { SetupPanel } from './components/SetupPanel';
import { StrategyPanel } from './components/StrategyPanel';
import { deckPowerNames, deckSize, startingDeckFor } from './lib/deck';
import { setupHref } from './lib/links';
import { setupRelics } from './lib/relics';
import { buildQuery, enemyIdsField, parseQuery, type SetupState } from './lib/url';
import { runSimulation } from './sim/runSimulation';
import { useStrategies } from './useStrategies';

const data = gameData;

function readUrl() {
  return parseQuery(data, typeof location === 'undefined' ? '' : location.search);
}

export function App() {
  const initial = useMemo(readUrl, []);
  const [setup, setSetup] = useState<SetupState>(initial.setup);
  const [urlErrors, setUrlErrors] = useState<string[]>(initial.errors);
  const logTarget = initial.log;

  return (
    <div className="app">
      <header className="app-head">
        <h1>
          <a href={setupHref(data, setup)}>Slay the Spire 2</a>
        </h1>
        <div className="app-sub muted small">
          <p>Monte Carlo comparison of Slay the Spire 2 play strategies.</p>
          <em className="app-version">Slay the Spire 2 {data.manifest.gameVersion}</em>
        </div>
      </header>
      {urlErrors.length > 0 && (
        <div className="banner warn" role="alert">
          <strong>Some of this link couldn't be read; defaults were used instead:</strong>
          <ul>
            {urlErrors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
          <button type="button" className="btn-link" onClick={() => setUrlErrors([])}>
            Dismiss
          </button>
        </div>
      )}
      <main>
        {logTarget ? (
          <CombatLog data={data} setup={setup} target={logTarget} />
        ) : (
          <Simulator setup={setup} setSetup={setSetup} />
        )}
      </main>
      <footer className="muted small">
        <p>Card and enemy data from slaythespire.wiki.gg (CC BY-SA 4.0). Not affiliated with Mega Crit.</p>
        <p>
          <FeedbackDialog gameVersion={data.manifest.gameVersion} />
        </p>
      </footer>
    </div>
  );
}

function Simulator({ setup, setSetup }: { setup: SetupState; setSetup: (s: SetupState) => void }) {
  const strategies = useStrategies();
  const [status, setStatus] = useState<RunStatus>({ kind: 'idle' });
  const [result, setResult] = useState<RunResult | null>(null);

  // Keep the URL in sync so a copied link reproduces the setup.
  useEffect(() => {
    try {
      history.replaceState(null, '', `?${buildQuery(data, setup)}`);
    } catch {
      /* history unavailable (sandboxed frame): nothing to sync */
    }
  }, [setup]);

  const blocker =
    deckSize(setup.deck) === 0
      ? 'Add at least one card to the deck.'
      : strategies.selection.length === 0
        ? 'Select at least one strategy.'
        : null;

  const run = async (runSeed: number) => {
    const strategiesForRun: RunStrategy[] = strategies.selection.flatMap((sel) => {
      const s = strategies.library.find((x) => x.id === sel.strategyId);
      return s ? [{ strategy: s, color: sel.color }] : [];
    });
    const config: RunConfig = {
      characterId: setup.characterId,
      deck: setup.deck,
      enemyId: setup.enemyId,
      ...enemyIdsField(setup),
      ascension: setup.ascension,
      ...(setup.startHp !== undefined ? { startHp: setup.startHp } : {}),
      ...(setup.potions && setup.potions.length > 0 ? { potions: setup.potions } : {}),
      relics: setupRelics(data, setup),
      strategies: strategiesForRun,
      runSeed,
    };
    setStatus({ kind: 'running', progress: null });
    try {
      const r = await runSimulation(config, (progress) => setStatus({ kind: 'running', progress }));
      setResult(r);
      setStatus({ kind: 'done' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus({ kind: 'error', message, notImplemented: /not implemented/i.test(message) });
    }
  };

  return (
    <>
      <ResultsPanel
        data={data}
        characterId={setup.characterId}
        result={result}
        status={status}
        blocker={blocker}
        onRun={run}
      />
      <div className="grid">
        <div className="col col-deck">
          <DeckBuilder
            data={data}
            characterId={setup.characterId}
            ascension={setup.ascension}
            deck={setup.deck}
            onChange={(deck) => setSetup({ ...setup, deck })}
            onReset={() => setSetup({ ...setup, deck: startingDeckFor(data, setup.characterId) })}
          />
        </div>
        <div className="col col-side">
          <SetupPanel
            data={data}
            setup={setup}
            onCharacter={(id) => {
              const { relics: _relics, startHp: _hp, ...rest } = setup;
              setSetup({ ...rest, characterId: id, deck: startingDeckFor(data, id) });
            }}
            onEnemy={(id) => setSetup({ ...setup, enemyId: id })}
            onExtraEnemies={(ids) => {
              const { extraEnemyIds: _extra, ...rest } = setup;
              setSetup(ids.length > 0 ? { ...rest, extraEnemyIds: ids } : rest);
            }}
            onAscension={(a) => setSetup({ ...setup, ascension: a })}
            onStartHp={(startHp) => {
              const { startHp: _hp, ...rest } = setup;
              setSetup(startHp === undefined ? rest : { ...rest, startHp });
            }}
            onPotions={(potions) => setSetup({ ...setup, potions })}
            onRelics={(relics) => setSetup({ ...setup, relics })}
          />
          <StrategyPanel
            library={strategies.library}
            selection={strategies.selection}
            storageOk={strategies.storageOk}
            powerNames={deckPowerNames(data, setup.deck)}
            onToggle={strategies.toggle}
            onColor={strategies.color}
            onAdd={strategies.add}
            onRename={strategies.rename}
            onConfig={strategies.setConfig}
            onDelete={strategies.remove}
            onClearAll={strategies.clearAll}
          />
        </div>
      </div>
    </>
  );
}
