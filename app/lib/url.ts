/**
 * Shareable URL format (v=1).
 *
 *   ?v=1&c=I&e=Nb&a=0&d=St5De4Ba1            setup link
 *   ?v=1&c=I&e=Nb&a=0&d=St5De4Ba1&s=123&st=b4pa combat-log link
 *   ?v=1&c=I&e=Nb&a=0&d=St5De4Ba1&s=123&st=b4pa,apb,b0pa&k=b,r,g&n=41  compare link
 *   (st codes, #130: group letters a/b/p in priority order, X after "b" unless Block is last;
 *   the old "g" and "b<X>" still parse)
 *
 * Log params:
 *   s   per-combat seed (required for a log link)
 *   st  strategy code, or 2–5 distinct codes joined by "," for the side-by-side
 *       compare view (codes never contain ","). One code = the single combat log.
 *   k   optional, display-only: one color letter per `st` entry, joined by ","
 *       (b blue, g green, y yellow, r red, p purple). Ignored when malformed or
 *       when its length differs from `st`.
 *   n   optional, display-only: 0-based combat number within the run.
 *
 * Potions (#204): optional `p`, concatenated potion codes (2 chars each, in slot order, at most
 * MAX_POTIONS), e.g. `p=SPFP`. Absent = no potions.
 *
 * Deck: concatenated entries of card code (2 chars) + optional "+" (upgraded)
 * + count (decimal, no leading zeros). The "+" is written literally, so the
 * query is built and parsed by hand rather than with URLSearchParams (which
 * would turn "+" into a space).
 */
import { parseStrategyCode, strategyCode } from '../../engine/strategies';
import {
  MAX_STRATEGIES_PER_RUN,
  type CardDef,
  type Deck,
  type GameData,
  type StrategyColor,
  type StrategyConfig,
} from '../../engine/types';
import { deckPool, startingDeckFor } from './deck';

export const URL_VERSION = '1';
export const MAX_ASCENSION = 10;
const MAX_SEED = 0xffffffff;
const MAX_COPIES = 99;
const MAX_COMBAT_INDEX = 9999;
/** Potion slots in the setup (#204). */
export const MAX_POTIONS = 3;

/** One-letter color codes for the `k` param. */
const COLOR_LETTER: Record<StrategyColor, string> = { blue: 'b', green: 'g', yellow: 'y', red: 'r', purple: 'p' };
const LETTER_COLOR = new Map(Object.entries(COLOR_LETTER).map(([c, l]) => [l, c as StrategyColor]));

export interface SetupState {
  characterId: string;
  enemyId: string;
  ascension: number;
  deck: Deck;
  /** #204: potion ids in slot order (at most MAX_POTIONS); absent means none. */
  potions?: string[];
}

export interface LogTarget {
  /** Per-combat seed passed straight to runCombat. */
  seed: number;
  /** 1 strategy: the single combat log. 2–MAX_STRATEGIES_PER_RUN: the compare view, in column order. */
  strategies: StrategyConfig[];
  /** Optional display colors, one per strategy (`k`). */
  colors?: StrategyColor[];
  /** 0-based combat number within the run, when the link came from the results picker (optional `n`). Display only. */
  combatIndex?: number;
}

export interface ParsedUrl {
  /** Setup from the URL; fields that were missing or invalid fall back to defaults. */
  setup: SetupState;
  /** Present when both `s` and `st` were valid: the URL opens the log view. */
  log: LogTarget | null;
  /** Human-readable problems; empty when the URL was fine. */
  errors: string[];
}

/** Setup used when the URL has no (valid) params: first character, first enemy, A0, starter deck. */
export function defaultSetup(data: GameData): SetupState {
  const character = data.characters.ironclad ?? Object.values(data.characters)[0];
  const enemy = data.enemies.nibbit ?? Object.values(data.enemies)[0];
  if (!character || !enemy) throw new Error('Game data has no characters or enemies');
  return {
    characterId: character.id,
    enemyId: enemy.id,
    ascension: 0,
    deck: startingDeckFor(data, character.id),
  };
}

// ---------------------------------------------------------------------------
// Deck encoding
// ---------------------------------------------------------------------------

export function encodeDeck(data: GameData, deck: Deck): string {
  let out = '';
  for (const entry of deck) {
    if (entry.count <= 0) continue;
    const card = data.cards[entry.cardId];
    if (!card) throw new Error(`Unknown card id "${entry.cardId}"`);
    out += `${card.code}${entry.upgraded ? '+' : ''}${entry.count}`;
  }
  return out;
}

export type DeckParseResult = { ok: true; deck: Deck } | { ok: false; error: string };

/**
 * Strict deck parser. Rejects unknown codes, cards outside the character's
 * deck-builder pool, upgrades on cards that cannot be upgraded, duplicate
 * entries, zero / leading-zero / oversized counts, and any stray characters.
 */
export function decodeDeck(data: GameData, characterId: string, text: string): DeckParseResult {
  const byCode = new Map<string, CardDef>(Object.values(data.cards).map((c) => [c.code, c]));
  const pool = new Set(deckPool(data, characterId).map((c) => c.id));
  const re = /([A-Za-z0-9]{2})(\+?)(0|[1-9]\d*)/y;
  const deck: Deck = [];
  const seen = new Set<string>();
  let pos = 0;
  while (pos < text.length) {
    re.lastIndex = pos;
    const m = re.exec(text);
    if (!m) return { ok: false, error: `Deck: cannot read "${text.slice(pos)}" (expected code, optional +, count)` };
    const [whole, code = '', plus, countText = ''] = m;
    const card = byCode.get(code);
    if (!card) return { ok: false, error: `Deck: unknown card code "${code}"` };
    if (!pool.has(card.id))
      return { ok: false, error: `Deck: ${card.name} (${code}) is not available for this character` };
    const upgraded = plus === '+';
    if (upgraded && !card.upgraded) return { ok: false, error: `Deck: ${card.name} (${code}) cannot be upgraded` };
    const count = Number(countText);
    if (count < 1 || count > MAX_COPIES) {
      return { ok: false, error: `Deck: ${card.name} count must be 1–${MAX_COPIES}, got ${countText}` };
    }
    const key = `${card.id}${upgraded ? '+' : ''}`;
    if (seen.has(key)) return { ok: false, error: `Deck: ${code}${plus} appears more than once` };
    seen.add(key);
    const limit = card.maxCopies;
    if (limit !== undefined) {
      const total = deck.filter((e) => e.cardId === card.id).reduce((n, e) => n + e.count, 0) + count;
      if (total > limit) {
        return {
          ok: false,
          error: `Deck: ${card.name} is limited to ${limit} ${limit === 1 ? 'copy' : 'copies'} (Standard and Upgraded combined), got ${total}`,
        };
      }
    }
    deck.push({ cardId: card.id, upgraded, count });
    pos += whole.length;
  }
  return { ok: true, deck };
}

export function encodePotions(data: GameData, potions: readonly string[]): string {
  return potions
    .map((id) => {
      const potion = data.potions?.[id];
      if (!potion) throw new Error(`Unknown potion id "${id}"`);
      return potion.code;
    })
    .join('');
}

export type PotionParseResult = { ok: true; potions: string[] } | { ok: false; error: string };

/** Strict parser: 2-char codes of known potions, at most MAX_POTIONS. */
export function decodePotions(data: GameData, text: string): PotionParseResult {
  if (text.length % 2 !== 0) return { ok: false, error: `Potions: cannot read "${text}" (expected 2-char codes)` };
  const potions: string[] = [];
  for (let i = 0; i < text.length; i += 2) {
    const code = text.slice(i, i + 2);
    const potion = Object.values(data.potions ?? {}).find((x) => x.code === code);
    if (!potion) return { ok: false, error: `Potions: unknown potion code "${code}"` };
    potions.push(potion.id);
  }
  if (potions.length > MAX_POTIONS) return { ok: false, error: `Potions: at most ${MAX_POTIONS} are allowed` };
  return { ok: true, potions };
}

// ---------------------------------------------------------------------------
// Query string
// ---------------------------------------------------------------------------

/** Build the query string (without "?"). Param order is fixed: v c e a d [p] [s st [k] [n]]. */
export function buildQuery(data: GameData, setup: SetupState, log?: LogTarget | null): string {
  const character = data.characters[setup.characterId];
  const enemy = data.enemies[setup.enemyId];
  if (!character) throw new Error(`Unknown character id "${setup.characterId}"`);
  if (!enemy) throw new Error(`Unknown enemy id "${setup.enemyId}"`);
  const parts = [
    `v=${URL_VERSION}`,
    `c=${character.code}`,
    `e=${enemy.code}`,
    `a=${setup.ascension}`,
    `d=${encodeDeck(data, setup.deck)}`,
  ];
  if (setup.potions && setup.potions.length > 0) parts.push(`p=${encodePotions(data, setup.potions)}`);
  if (log) {
    if (log.strategies.length < 1 || log.strategies.length > MAX_STRATEGIES_PER_RUN) {
      throw new Error(`A log link needs 1–${MAX_STRATEGIES_PER_RUN} strategies, got ${log.strategies.length}`);
    }
    parts.push(`s=${log.seed >>> 0}`, `st=${log.strategies.map(strategyCode).join(',')}`);
    if (log.colors && log.colors.length === log.strategies.length)
      parts.push(`k=${log.colors.map((c) => COLOR_LETTER[c]).join(',')}`);
    if (log.combatIndex !== undefined) parts.push(`n=${log.combatIndex}`);
  }
  return parts.join('&');
}

/** Split a query by hand so a literal "+" survives. First occurrence of a key wins. */
export function splitQuery(search: string): Map<string, string> {
  const params = new Map<string, string>();
  const q = search.startsWith('?') ? search.slice(1) : search;
  if (q === '') return params;
  for (const pair of q.split('&')) {
    if (pair === '') continue;
    const eq = pair.indexOf('=');
    const rawKey = eq < 0 ? pair : pair.slice(0, eq);
    const rawValue = eq < 0 ? '' : pair.slice(eq + 1);
    let key: string;
    let value: string;
    try {
      key = decodeURIComponent(rawKey);
      value = decodeURIComponent(rawValue);
    } catch {
      continue; // malformed escape: ignore the pair
    }
    if (!params.has(key)) params.set(key, value);
  }
  return params;
}

function parseIntStrict(text: string, max: number): number | null {
  if (!/^(0|[1-9]\d*)$/.test(text)) return null;
  const n = Number(text);
  return n <= max ? n : null;
}

/**
 * Parse a location.search string. Never throws: problems are collected in
 * `errors` and the affected fields fall back to defaults. A query with no
 * params at all is not an error.
 */
export function parseQuery(data: GameData, search: string): ParsedUrl {
  const setup = defaultSetup(data);
  const errors: string[] = [];
  const p = splitQuery(search);
  if (p.size === 0) return { setup, log: null, errors };

  const v = p.get('v');
  if (v !== undefined && v !== URL_VERSION) {
    errors.push(`Unsupported link version "${v}" (this app reads v=${URL_VERSION})`);
    return { setup, log: null, errors };
  }

  const c = p.get('c');
  let characterOk = true;
  if (c !== undefined) {
    const ch = Object.values(data.characters).find((x) => x.code === c);
    if (ch) {
      setup.characterId = ch.id;
      setup.deck = startingDeckFor(data, ch.id);
    } else {
      errors.push(`Unknown character code "${c}"`);
      characterOk = false;
    }
  }

  const e = p.get('e');
  if (e !== undefined) {
    const en = Object.values(data.enemies).find((x) => x.code === e);
    if (en) setup.enemyId = en.id;
    else errors.push(`Unknown enemy code "${e}"`);
  }

  const a = p.get('a');
  if (a !== undefined) {
    const n = parseIntStrict(a, MAX_ASCENSION);
    if (n === null) errors.push(`Ascension must be a whole number 0–${MAX_ASCENSION}, got "${a}"`);
    else setup.ascension = n;
  }

  const d = p.get('d');
  if (d !== undefined && characterOk) {
    // Tolerate a "+" that some tool turned into a space.
    const r = decodeDeck(data, setup.characterId, d.replace(/ /g, '+'));
    if (r.ok) setup.deck = r.deck;
    else errors.push(r.error);
  }

  const pt = p.get('p');
  if (pt !== undefined && pt !== '') {
    const r = decodePotions(data, pt);
    if (r.ok) setup.potions = r.potions;
    else errors.push(r.error);
  }

  return { setup, log: parseLogTarget(p, errors), errors };
}

/** The combat-log part of a query (`s`, `st`, optional `k` and `n`), or null when absent or invalid. */
function parseLogTarget(p: Map<string, string>, errors: string[]): LogTarget | null {
  const s = p.get('s');
  const st = p.get('st');
  if (s === undefined && st === undefined) return null;
  let seed: number | null = null;
  let strategies: StrategyConfig[] | null = null;
  if (s === undefined) errors.push('Combat link is missing the seed (s)');
  else {
    seed = parseIntStrict(s, MAX_SEED);
    if (seed === null) errors.push(`Seed must be a whole number 0–${MAX_SEED}, got "${s}"`);
  }
  if (st === undefined) errors.push('Combat link is missing the strategy (st)');
  else {
    const r = parseStrategyList(st);
    if (r.ok) strategies = r.strategies;
    else errors.push(r.error);
  }
  if (seed === null || !strategies) return null;
  const log: LogTarget = { seed, strategies };
  const colors = parseColorList(p.get('k'), strategies.length);
  if (colors) log.colors = colors;
  const n = p.get('n');
  // Optional and display-only: a bad value is ignored, never an error.
  const combatIndex = n === undefined ? null : parseIntStrict(n, MAX_COMBAT_INDEX);
  if (combatIndex !== null) log.combatIndex = combatIndex;
  return log;
}

/** Parse `st`: one strategy code, or up to MAX_STRATEGIES_PER_RUN distinct codes joined by ",". */
export function parseStrategyList(
  text: string,
): { ok: true; strategies: StrategyConfig[] } | { ok: false; error: string } {
  const codes = text.split(',');
  if (codes.length > MAX_STRATEGIES_PER_RUN)
    return {
      ok: false,
      error: `A combat link holds at most ${MAX_STRATEGIES_PER_RUN} strategies, got ${codes.length}`,
    };
  const strategies: StrategyConfig[] = [];
  const seen = new Set<string>();
  for (const code of codes) {
    const config = parseStrategyCode(code);
    if (!config) return { ok: false, error: `Unknown strategy code "${code}"` };
    // Compare canonical codes, so an old code and its new form ("g" and "apb") count as the same.
    const canonical = strategyCode(config);
    if (seen.has(canonical)) return { ok: false, error: `Strategy code "${code}" appears more than once` };
    seen.add(canonical);
    strategies.push(config);
  }
  return { ok: true, strategies };
}

/** Parse the optional, display-only `k`; null when absent, malformed or not one color per strategy. */
export function parseColorList(text: string | undefined, count: number): StrategyColor[] | null {
  if (text === undefined) return null;
  const colors = text.split(',').map((l) => LETTER_COLOR.get(l));
  if (colors.length !== count || colors.some((c) => c === undefined)) return null;
  return colors as StrategyColor[];
}
