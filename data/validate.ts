/**
 * Runtime validation for hand-entered game data. No external libraries.
 *
 * Every error names the entity (e.g. `cards/bash`) and the field path
 * (e.g. `effects[1].amount`) so a broken JSON file is easy to find.
 * The checks live in data/validate/: lists, shared helpers, effects, cards and enemies.
 */
import type { CardDef, CharacterDef, EnemyDef, GameData, Manifest, PotionDef } from '../engine/types';
import reservedCodes from './reserved-codes.json';
import { CHARACTER_CODES } from './validate/lists';
import { type Obj, isObj, Reporter } from './validate/shared';
import { checkCard } from './validate/cards';
import { checkEnemy } from './validate/enemies';
import { checkPotion } from './validate/potions';

export { CONTRACT_LISTS_MATCH_TYPES } from './validate/lists';

export type ValidationResult = { ok: true; data: GameData } | { ok: false; errors: string[] };

function checkManifest(errors: string[], raw: unknown, cardIds: Set<string>): void {
  const r = new Reporter(errors, 'manifest');
  if (!isObj(raw)) {
    errors.push('manifest: must be an object');
    return;
  }
  r.str(raw, 'gameVersion');
  const list = r.arr(raw, 'ascensionCards');
  list?.forEach((entry, i) => {
    const p = `ascensionCards[${i}]`;
    if (!isObj(entry)) {
      r.add(p, 'must be an object');
      return;
    }
    r.int(entry, 'level', 0, `${p}.level`);
    const id = r.str(entry, 'cardId', `${p}.cardId`);
    if (id !== undefined && !cardIds.has(id)) r.add(`${p}.cardId`, `references unknown card id "${id}"`);
  });
}

function checkCharacter(r: Reporter, c: Obj, cardIds: Set<string>): void {
  r.oneOf(c, 'code', CHARACTER_CODES);
  r.str(c, 'name');
  r.int(c, 'maxHp', 1);
  r.int(c, 'energyPerTurn', 0);
  r.int(c, 'drawPerTurn', 0);
  const deck = r.arr(c, 'startingDeck');
  deck?.forEach((entry, i) => {
    const p = `startingDeck[${i}]`;
    if (!isObj(entry)) {
      r.add(p, 'must be an object');
      return;
    }
    const id = r.str(entry, 'cardId', `${p}.cardId`);
    if (id !== undefined && !cardIds.has(id)) r.add(`${p}.cardId`, `references unknown card id "${id}"`);
    r.bool(entry, 'upgraded', `${p}.upgraded`);
    r.int(entry, 'count', 1, `${p}.count`);
  });
  r.str(c, 'startingRelic');
  r.str(c, 'lastUpdateVersion');
}

/**
 * Validates a collection keyed by id: each entry is an object whose `id`
 * matches its key, then runs the per-entity check.
 */
function checkCollection(
  errors: string[],
  name: 'cards' | 'enemies' | 'characters' | 'potions',
  raw: unknown,
  check: (r: Reporter, o: Obj) => void,
): void {
  if (!isObj(raw)) {
    errors.push(`${name}: must be an object keyed by id`);
    return;
  }
  for (const [key, value] of Object.entries(raw)) {
    const r = new Reporter(errors, `${name}/${key}`);
    if (!isObj(value)) {
      errors.push(`${name}/${key}: must be an object`);
      continue;
    }
    const id = r.str(value, 'id');
    if (id !== undefined && id !== key) r.add('id', `"${id}" does not match its key "${key}"`);
    check(r, value);
  }
}

/** Reports every code shared by more than one entity in a collection. */
function checkUniqueCodes(errors: string[], name: string, raw: unknown): void {
  if (!isObj(raw)) return;
  const byCode = new Map<string, string[]>();
  for (const [key, value] of Object.entries(raw)) {
    if (!isObj(value) || typeof value.code !== 'string') continue;
    const list = byCode.get(value.code) ?? [];
    list.push(key);
    byCode.set(value.code, list);
  }
  for (const [code, keys] of byCode) {
    if (keys.length > 1) {
      errors.push(
        `${name}: field "code" "${code}" is used by more than one entry: ${keys.map((k) => `${name}/${k}`).join(', ')}`,
      );
    }
  }
}

/**
 * Codes of removed cards (e.g. beta-only) stay reserved: no card may use them.
 * A card that returns to the game takes its reserved code back by removing the
 * entry from data/reserved-codes.json.
 */
function checkReservedCodes(errors: string[], raw: unknown): void {
  if (!isObj(raw)) return;
  const reserved = new Map(reservedCodes.cards.map((r) => [r.code, r]));
  for (const [key, value] of Object.entries(raw)) {
    if (!isObj(value) || typeof value.code !== 'string') continue;
    const r = reserved.get(value.code);
    if (r) {
      errors.push(
        `cards/${key}: field "code" "${value.code}" is reserved for removed card "${r.name}" (data/reserved-codes.json): ${r.reason}`,
      );
    }
  }
}

export function validateGameData(raw: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isObj(raw)) return { ok: false, errors: ['gameData: must be an object'] };

  const cardIds = new Set(isObj(raw.cards) ? Object.keys(raw.cards) : []);

  checkManifest(errors, raw.manifest, cardIds);
  checkCollection(errors, 'cards', raw.cards, checkCard);
  checkCollection(errors, 'enemies', raw.enemies, checkEnemy);
  checkCollection(errors, 'characters', raw.characters, (r, o) => checkCharacter(r, o, cardIds));
  checkCollection(errors, 'potions', raw.potions, checkPotion);
  checkUniqueCodes(errors, 'cards', raw.cards);
  checkReservedCodes(errors, raw.cards);
  checkUniqueCodes(errors, 'enemies', raw.enemies);
  checkUniqueCodes(errors, 'characters', raw.characters);
  checkUniqueCodes(errors, 'potions', raw.potions);

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      manifest: raw.manifest as Manifest,
      cards: raw.cards as Record<string, CardDef>,
      enemies: raw.enemies as Record<string, EnemyDef>,
      characters: raw.characters as Record<string, CharacterDef>,
      potions: raw.potions as Record<string, PotionDef>,
    },
  };
}

/** Raw JSON modules keyed by file path, as `import.meta.glob` returns them. */
export interface RawGameFiles {
  manifest: unknown;
  cards: Record<string, unknown>;
  enemies: Record<string, unknown>;
  characters: Record<string, unknown>;
  /** #204: optional so callers without potion files still work. */
  potions?: Record<string, unknown>;
}

/**
 * Keys each collection by entity id. Two files with the same id would
 * otherwise silently collapse into one entry, so they are reported here.
 * A file with no string id is kept under its path so validation reports it.
 */
export function assembleGameData(files: RawGameFiles): { raw: Obj; errors: string[] } {
  const errors: string[] = [];
  const collect = (name: string, byPath: Record<string, unknown>): Obj => {
    const out: Obj = {};
    const seenIn = new Map<string, string>();
    for (const [path, value] of Object.entries(byPath)) {
      const id = isObj(value) && typeof value.id === 'string' ? value.id : path;
      const prior = seenIn.get(id);
      if (prior !== undefined) {
        errors.push(`${name}: field "id" "${id}" is used by both ${prior} and ${path}`);
        continue;
      }
      seenIn.set(id, path);
      out[id] = value;
    }
    return out;
  };
  return {
    raw: {
      manifest: files.manifest,
      cards: collect('cards', files.cards),
      enemies: collect('enemies', files.enemies),
      characters: collect('characters', files.characters),
      potions: collect('potions', files.potions ?? {}),
    },
    errors,
  };
}
