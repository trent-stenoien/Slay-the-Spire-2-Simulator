import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SavedStrategy, StrategyColor, StrategyConfig } from '../engine/types';
import { deselectStrategy, pruneSelection, selectStrategy, setColor, type Selection } from './lib/colors';
import { loadSelection, saveSelection } from './lib/selectionStorage';
import {
  DEFAULT_STRATEGIES,
  addUserStrategy,
  browserStorage,
  clearUserStrategies,
  deleteUserStrategy,
  fullLibrary,
  loadUserStrategies,
  renameUserStrategy,
  saveUserStrategies,
  setUserConfig,
  strategyProblem,
} from './lib/strategyLibrary';

function newId(): string {
  try {
    return `u-${crypto.randomUUID()}`;
  } catch {
    return `u-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
  }
}

/** This browser's saved strategy library, read once on mount (the log page uses it to name strategies). */
export function useSavedLibrary(): readonly SavedStrategy[] {
  const [library] = useState(() => fullLibrary(loadUserStrategies(browserStorage())));
  return library;
}

/** Strategy library + per-run selection state, persisted to localStorage when possible. */
export function useStrategies() {
  const storage = useMemo(browserStorage, []);
  const [user, setUser] = useState<SavedStrategy[]>(() => loadUserStrategies(storage));
  const [storageOk, setStorageOk] = useState(storage !== null);
  // Restore the per-run selection (ids + colors) saved alongside the library.
  const [selection, setSelection] = useState<Selection[]>(() => loadSelection(storage, fullLibrary(user)));

  // Persist every selection change, including pruning after a delete or clear.
  useEffect(() => {
    saveSelection(storage, selection);
  }, [storage, selection]);

  const library = useMemo(() => fullLibrary(user), [user]);

  const commit = useCallback(
    (next: SavedStrategy[]) => {
      setUser(next);
      setStorageOk(saveUserStrategies(storage, next));
      setSelection((sel) =>
        pruneSelection(
          sel,
          fullLibrary(next).map((s) => s.id),
        ),
      );
    },
    [storage],
  );

  return {
    library,
    selection,
    storageOk,
    toggle: (id: string) =>
      setSelection((sel) =>
        sel.some((s) => s.strategyId === id) ? deselectStrategy(sel, id) : selectStrategy(sel, id),
      ),
    color: (id: string, c: StrategyColor) => setSelection((sel) => setColor(sel, id, c)),
    add: (name: string, config: StrategyConfig) => {
      if (strategyProblem(library, config) !== null) return;
      const next = addUserStrategy(user, name, config, newId);
      commit(next);
      const added = next[next.length - 1];
      if (added) setSelection((sel) => selectStrategy(sel, added.id));
    },
    rename: (id: string, name: string) => commit(renameUserStrategy(user, id, name)),
    setConfig: (id: string, config: StrategyConfig) => {
      if (strategyProblem(library, config, id) === null) commit(setUserConfig(user, id, config));
    },
    remove: (id: string) => commit(deleteUserStrategy(user, id)),
    clearAll: () => {
      clearUserStrategies(storage);
      setUser([]);
      setSelection((sel) =>
        pruneSelection(
          sel,
          DEFAULT_STRATEGIES.map((s) => s.id),
        ),
      );
    },
  };
}
