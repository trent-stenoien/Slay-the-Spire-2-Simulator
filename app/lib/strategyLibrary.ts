/**
 * Saved-strategy library. Built-in defaults are always present and read-only;
 * user strategies (a priority order of Attack, Block and Powers, #130) live in
 * localStorage. All storage access is wrapped so the app works without it.
 */
import {
  blockFirstConfig,
  blockIsLast,
  GREEDY_CONFIG,
  MAX_ALLOW_THROUGH,
  normalizeConfig,
  sameConfig,
} from '../../engine/strategies';
import type { SavedStrategy, StrategyConfig, StrategyGroup, TargetPriority } from '../../engine/types';

export { MAX_ALLOW_THROUGH };

/** Pre-#130 entries ({ kind: 'greedyDamage' | 'block' }) are migrated on load and saved in the new shape. */
export const STORAGE_KEY = 'sts2sim.strategies.v1';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export const DEFAULT_STRATEGIES: readonly SavedStrategy[] = [
  { id: 'default-greedy', name: 'Greedy Damage', config: GREEDY_CONFIG },
  { id: 'default-scared', name: 'Scared Block', config: blockFirstConfig(0) },
];

export function isBuiltIn(id: string): boolean {
  return DEFAULT_STRATEGIES.some((s) => s.id === id);
}

/** The browser's localStorage, or null if it is missing or throws. */
export function browserStorage(): StorageLike | null {
  try {
    const s = globalThis.localStorage;
    return s ?? null;
  } catch {
    return null;
  }
}

/** A stored entry as a SavedStrategy (old configs migrated, #130), or null when invalid. */
function toSaved(x: unknown): SavedStrategy | null {
  if (typeof x !== 'object' || x === null) return null;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== 'string' || o.id === '' || typeof o.name !== 'string') return null;
  const config = normalizeConfig(o.config);
  return config ? { id: o.id, name: o.name, config } : null;
}

/**
 * User strategies from storage, with pre-#130 configs migrated. Invalid, built-in-id or
 * duplicate-id entries are dropped.
 */
export function loadUserStrategies(storage: StorageLike | null): SavedStrategy[] {
  if (!storage) return [];
  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  const out: SavedStrategy[] = [];
  for (const raw of parsed) {
    const x = toSaved(raw);
    if (!x || isBuiltIn(x.id) || seen.has(x.id)) continue;
    seen.add(x.id);
    out.push(x);
  }
  return out;
}

/** Returns false if storage is missing or the write failed. */
export function saveUserStrategies(storage: StorageLike | null, list: readonly SavedStrategy[]): boolean {
  if (!storage) return false;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(list.filter((s) => !isBuiltIn(s.id))));
    return true;
  } catch {
    return false;
  }
}

/** Removes the stored user strategies. Returns false if storage is missing or removal failed. */
export function clearUserStrategies(storage: StorageLike | null): boolean {
  if (!storage?.removeItem) return false;
  try {
    storage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

/** Defaults followed by user strategies. */
export function fullLibrary(user: readonly SavedStrategy[]): SavedStrategy[] {
  return [...DEFAULT_STRATEGIES, ...user];
}

/** "4" → 4; anything other than a whole number 0–MAX_ALLOW_THROUGH → null. */
export function parseAllowThrough(text: string): number | null {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n <= MAX_ALLOW_THROUGH ? n : null;
}

export const GROUP_LABEL: Record<StrategyGroup, string> = { attack: 'Attack', block: 'Block', powers: 'Powers' };

/** A group's label in `config`: "Block (allow X)" for Block unless it is last. */
export function groupLabel(config: StrategyConfig, group: StrategyGroup): string {
  return group === 'block' && !blockIsLast(config) ? `Block (allow ${config.allowThrough})` : GROUP_LABEL[group];
}

/** #130 default title: the 1st and 2nd priorities, e.g. "Powers, Block (allow 5)" or "Attack, Powers". */
export function defaultName(config: StrategyConfig): string {
  const name = config.order
    .slice(0, 2)
    .map((g) => groupLabel(config, g))
    .join(', ');
  return config.target === 'biggestAttack' ? `${name}, ${TARGET_SHORT.biggestAttack}` : name;
}

/** #5 (Trent): the target priority choices, as shown in the strategy editor. */
export const TARGET_LABEL: Record<TargetPriority, string> = {
  lowestHp: 'Lowest HP first',
  biggestAttack: 'Biggest incoming attack first',
};

/** #5: short form for chips and names. */
export const TARGET_SHORT: Record<TargetPriority, string> = {
  lowestHp: 'target lowest HP',
  biggestAttack: 'target biggest attack',
};

export function addUserStrategy(
  user: readonly SavedStrategy[],
  name: string,
  config: StrategyConfig,
  newId: () => string,
): SavedStrategy[] {
  const c = normalizeConfig(config);
  if (!c) return [...user];
  return [...user, { id: newId(), name: name.trim() || defaultName(c), config: c }];
}

export function renameUserStrategy(user: readonly SavedStrategy[], id: string, name: string): SavedStrategy[] {
  const trimmed = name.trim();
  if (!trimmed) return [...user];
  return user.map((s) => (s.id === id ? { ...s, name: trimmed } : s));
}

/** #130: replaces a user strategy's order and allowance (invalid configs are ignored). */
export function setUserConfig(user: readonly SavedStrategy[], id: string, config: StrategyConfig): SavedStrategy[] {
  const c = normalizeConfig(config);
  return user.map((s) => (s.id === id && c ? { ...s, config: c } : s));
}

export function deleteUserStrategy(user: readonly SavedStrategy[], id: string): SavedStrategy[] {
  return user.filter((s) => s.id !== id);
}

/** #130: the whole priority order, e.g. "Block (allow 0), Powers, Attack". */
export function describeConfig(config: StrategyConfig): string {
  const order = config.order.map((g) => groupLabel(config, g)).join(', ');
  return config.target === 'biggestAttack' ? `${order}; ${TARGET_SHORT.biggestAttack}` : order;
}

/** The library holds at most this many strategies, defaults included. */
/** (Only MAX_STRATEGIES_PER_RUN of them can be selected for one run.) */
export const MAX_LIBRARY_SIZE = 10;

/**
 * Why a strategy with `config` can't be added (or another one changed to it), or null if it
 * can: no two strategies may share an order and X (#130), and the library is capped.
 * `exceptId` is the strategy being edited.
 */
export function strategyProblem(
  library: readonly SavedStrategy[],
  config: StrategyConfig,
  exceptId?: string,
): string | null {
  const twin = library.find((s) => s.id !== exceptId && sameConfig(s.config, config));
  if (twin) return `"${twin.name}" already plays ${describeConfig(config)}.`;
  if (exceptId === undefined && library.length >= MAX_LIBRARY_SIZE) {
    return `You can have at most ${MAX_LIBRARY_SIZE} strategies. Delete one to add another.`;
  }
  return null;
}
