/** Deck-builder logic: the card pool and immutable deck edits. */
import type { CardDef, CharacterDef, Deck, GameData } from '../../engine/types';

/** True when every card in the character's starting deck can be simulated. */
export function isCharacterSimulated(data: GameData, ch: CharacterDef): boolean {
  return ch.startingDeck.every((e) => data.cards[e.cardId]?.simulated === true);
}

/**
 * Cards the deck builder offers for a character: its own cards plus
 * colorless ones, minus unplayable curses (Ascender's Bane is added by the
 * engine at A5+, never by hand) and cards the engine can't simulate yet
 * (or multiplayer-only cards). Sorted by name.
 */
export function deckPool(data: GameData, characterId: string): CardDef[] {
  const code = data.characters[characterId]?.code;
  if (!code) return [];
  return Object.values(data.cards)
    .filter((c) => c.character === code || c.character === 'colorless' || c.character === 'shared')
    .filter((c) => !(c.type === 'curse' && c.keywords.includes('unplayable')))
    .filter((c) => c.simulated && !c.multiplayerOnly && !c.hidden)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Cards the engine adds to every deck at the given ascension, per
 * `manifest.ascensionCards` (cumulative: each entry applies at its level or above).
 * They are never part of `setup.deck`.
 */
export function automaticCards(data: GameData, ascension: number): { card: CardDef; level: number }[] {
  return data.manifest.ascensionCards
    .filter((e) => ascension >= e.level)
    .flatMap((e) => {
      const card = data.cards[e.cardId];
      return card ? [{ card, level: e.level }] : [];
    });
}

/** Size of the real combat deck: the built deck plus automatic ascension cards. */
export function combatDeckSize(data: GameData, deck: Deck, ascension: number): number {
  return deckSize(deck) + automaticCards(data, ascension).length;
}

export function deckSize(deck: Deck): number {
  return deck.reduce((n, e) => n + e.count, 0);
}

export function copiesOf(deck: Deck, cardId: string, upgraded: boolean): number {
  return deck.find((e) => e.cardId === cardId && e.upgraded === upgraded)?.count ?? 0;
}

/** Total copies of a card in the deck, Standard and Upgraded together. */
export function totalCopies(deck: Deck, cardId: string): number {
  return copiesOf(deck, cardId, false) + copiesOf(deck, cardId, true);
}

/** #137: true when the card has a `maxCopies` limit and the deck already holds that many. */
export function atCopyLimit(deck: Deck, card: CardDef): boolean {
  return card.maxCopies !== undefined && totalCopies(deck, card.id) >= card.maxCopies;
}

/** Add `delta` copies (may be negative). Entries reaching 0 are removed; new entries are appended. */
export function changeCount(deck: Deck, cardId: string, upgraded: boolean, delta: number): Deck {
  const idx = deck.findIndex((e) => e.cardId === cardId && e.upgraded === upgraded);
  if (idx < 0) {
    return delta > 0 ? [...deck, { cardId, upgraded, count: delta }] : deck;
  }
  const count = Math.max(0, (deck[idx]?.count ?? 0) + delta);
  if (count === 0) return deck.filter((_, i) => i !== idx);
  return deck.map((e, i) => (i === idx ? { ...e, count } : e));
}

/** Remove every copy of a card, both Standard and Upgraded. Returns the same deck when the card is absent. */
export function removeCard(deck: Deck, cardId: string): Deck {
  return deck.some((e) => e.cardId === cardId) ? deck.filter((e) => e.cardId !== cardId) : deck;
}

/**
 * The character's starting deck, minus cards the engine can't simulate yet
 * (so a character like the Silent can still be picked and run).
 */
export function startingDeckFor(data: GameData, characterId: string): Deck {
  const ch = data.characters[characterId];
  return (ch?.startingDeck ?? []).filter((e) => data.cards[e.cardId]?.simulated === true).map((e) => ({ ...e }));
}

/** Names of starting-deck cards left out because they aren't simulated yet. */
export function unsimulatedStarters(data: GameData, characterId: string): string[] {
  const ch = data.characters[characterId];
  return (ch?.startingDeck ?? [])
    .filter((e) => data.cards[e.cardId]?.simulated !== true)
    .map((e) => data.cards[e.cardId]?.name ?? e.cardId);
}

export interface CardGroup {
  key: string;
  label: string;
  /** Every card in the folder (all rarities, when it has rarity sub-folders). */
  cards: CardDef[];
  /** Rarity sub-folders (character and Colorless folders only; empty ones omitted). */
  subgroups?: CardGroup[];
}

/** Rarity sub-folders under a character or Colorless folder, in display order. */
const RARITY_FOLDERS: [string, string][] = [
  ['basic', 'Basic'], // a character's own starters (Bash); the shared Strike and Defend stay in Shared
  ['common', 'Common'],
  ['uncommon', 'Uncommon'],
  ['rare', 'Rare'],
  ['ancient', 'Ancient'],
  ['event', 'Event'],
  ['token', 'Token'],
];

/** Folders that split into rarity sub-folders: each character's and Colorless (not Shared, Status, Curses, Quests). */
function hasRarityFolders(label: string): boolean {
  return label === 'Colorless' || Object.values(CHARACTER_FOLDER).includes(label);
}

/** Group key of a rarity sub-folder, e.g. "ironclad/rare". */
export function rarityFolderKey(folderLabel: string, rarity: string): string {
  return `${folderLabel.toLowerCase()}/${rarity}`;
}

const CHARACTER_FOLDER: Record<string, string> = {
  I: 'Ironclad',
  S: 'Silent',
  D: 'Defect',
  N: 'Necrobinder',
  R: 'Regent',
};

/** The data folder a card lives in (data/cards/<folder>/), as a label. */
export function cardFolder(card: CardDef): string {
  if (card.type === 'curse') return 'Curses';
  if (card.type === 'status') return 'Status';
  if (card.type === 'quest') return 'Quests';
  if (card.character === 'shared') return 'Shared';
  if (card.character === 'colorless') return 'Colorless';
  return CHARACTER_FOLDER[card.character] ?? card.character;
}

const FOLDER_ORDER = ['Shared', ...Object.values(CHARACTER_FOLDER), 'Colorless', 'Status', 'Curses', 'Quests'];

/** Case-insensitive match on the card name or its base/upgraded text. */
export function matchesSearch(card: CardDef, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [card.name, card.description, card.upgradedDescription ?? ''].some((s) => s.toLowerCase().includes(q));
}

/** Which optional categories the card selector shows. All off by default. */
export interface PoolFilters {
  statuses: boolean;
  curses: boolean;
  multiplayer: boolean;
}

export const DEFAULT_FILTERS: PoolFilters = { statuses: false, curses: false, multiplayer: false };

/**
 * Cards the selector lists. Default: simulated single-player cards from the
 * shared, selected character and colorless folders. Each filter adds its
 * category; multiplayer-only cards (of any shown category) need `multiplayer`.
 * Ascender's Bane is never addable by hand, so it is excluded here; it is
 * listed (locked) only when `ascension` reaches its manifest level, via
 * `automaticCards`. Sorted by name.
 */
export function filteredPool(data: GameData, characterId: string, filters: PoolFilters, ascension = 0): CardDef[] {
  const code = data.characters[characterId]?.code;
  if (!code) return [];
  const auto = automaticCards(data, ascension).map((a) => a.card);
  const autoIds = new Set(data.manifest.ascensionCards.map((e) => e.cardId));
  const pool = Object.values(data.cards)
    .filter((c) => c.simulated && !c.hidden)
    .filter((c) => !autoIds.has(c.id))
    .filter((c) => filters.multiplayer || !c.multiplayerOnly)
    .filter((c) => {
      if (c.type === 'status') return filters.statuses;
      if (c.type === 'curse') return filters.curses;
      if (c.type === 'quest') return false;
      return c.character === code || c.character === 'colorless' || c.character === 'shared';
    });
  return [...pool, ...auto].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Group keys (see `groupedPool`) of the folders a filter adds cards to, so the
 * deck builder can expand them when the filter is turned on. Multiplayer adds
 * multiplayer-only cards to whichever folders would otherwise be shown.
 */
export function foldersForFilter(
  data: GameData,
  characterId: string,
  filter: keyof PoolFilters,
  ascension = 0,
): string[] {
  // Statuses and Curses folders start collapsed (the pill only adds them to the list).
  if (filter === 'statuses' || filter === 'curses') return [];
  const only = { ...DEFAULT_FILTERS, statuses: true, curses: true, multiplayer: true };
  const keys = new Set(
    filteredPool(data, characterId, only, ascension)
      .filter((c) => c.multiplayerOnly)
      .flatMap((c) => {
        const folder = cardFolder(c);
        return hasRarityFolders(folder)
          ? [folder.toLowerCase(), rarityFolderKey(folder, c.rarity)]
          : [folder.toLowerCase()];
      }),
  );
  return [...keys];
}

/** Pool cards matching the search and filters, grouped by data folder in a fixed order. Empty groups are dropped. */
export function groupedPool(
  data: GameData,
  characterId: string,
  query: string,
  filters: PoolFilters = DEFAULT_FILTERS,
  ascension = 0,
): CardGroup[] {
  const groups = new Map<string, CardDef[]>();
  for (const card of filteredPool(data, characterId, filters, ascension)) {
    if (!matchesSearch(card, query)) continue;
    const label = cardFolder(card);
    groups.set(label, [...(groups.get(label) ?? []), card]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => FOLDER_ORDER.indexOf(a) - FOLDER_ORDER.indexOf(b))
    .map(([label, cards]) => {
      const group: CardGroup = { key: label.toLowerCase(), label, cards };
      if (hasRarityFolders(label)) {
        group.subgroups = RARITY_FOLDERS.map(([rarity, rarityLabel]) => ({
          key: rarityFolderKey(label, rarity),
          label: rarityLabel,
          cards: cards.filter((c) => c.rarity === rarity),
        })).filter((g) => g.cards.length > 0);
      }
      return group;
    });
}

export type CostColorKey = 'ironclad' | 'silent' | 'regent' | 'necrobinder' | 'defect' | 'colorless' | 'curse';

const CODE_COLOR_KEY: Record<string, CostColorKey> = {
  I: 'ironclad',
  S: 'silent',
  R: 'regent',
  N: 'necrobinder',
  D: 'defect',
};

/**
 * Which color a card's energy-cost circle gets: its owner's, with shared
 * cards (Strike/Defend) taking the selected character's. Curses and quests
 * are 'curse'; colorless and status cards are 'colorless'.
 */
export function costColorKey(card: CardDef, characterId: string, data: GameData): CostColorKey {
  if (card.type === 'curse' || card.type === 'quest') return 'curse';
  if (card.type === 'status') return 'colorless';
  const code = card.character === 'shared' ? data.characters[characterId]?.code : card.character;
  return (code && CODE_COLOR_KEY[code]) || 'colorless';
}

/**
 * #132: names of the Power cards in the deck, each once (upgraded and standard copies share a
 * name), in the order they first appear.
 */
export function deckPowerNames(data: GameData, deck: Deck): string[] {
  const names: string[] = [];
  for (const e of deck) {
    const card = data.cards[e.cardId];
    if (e.count > 0 && card?.type === 'power' && !names.includes(card.name)) names.push(card.name);
  }
  return names;
}
