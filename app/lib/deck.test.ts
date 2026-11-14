import { describe, expect, it } from 'vitest';
import { gameData } from '../../data';
import {
  automaticCards,
  cardFolder,
  combatDeckSize,
  changeCount,
  copiesOf,
  atCopyLimit,
  totalCopies,
  costColorKey,
  deckPool,
  deckPowerNames,
  deckSize,
  filteredPool,
  foldersForFilter,
  groupedPool,
  isCharacterSimulated,
  matchesSearch,
  removeCard,
  startingDeckFor,
  unsimulatedStarters,
} from './deck';
import type { CardDef, Deck } from '../../engine/types';

const deck: Deck = [
  { cardId: 'strike', upgraded: false, count: 5 },
  { cardId: 'defend', upgraded: false, count: 4 },
];

describe('deckPool', () => {
  it('has Ironclad and colorless cards but no unplayable curses', () => {
    const ids = deckPool(gameData, 'ironclad').map((c) => c.id);
    expect(ids).toContain('strike');
    expect(ids).toContain('ultimate_strike');
    expect(ids).not.toContain('ascenders_bane');
  });

  it('excludes hidden cards even when simulated', () => {
    const data = {
      ...gameData,
      cards: {
        ...gameData.cards,
        hid_test: {
          ...gameData.cards.strike!,
          id: 'hid_test',
          name: 'Hid Test',
          character: 'colorless' as const,
          simulated: true,
          hidden: true,
        },
      },
    };
    expect(deckPool(data, 'ironclad').map((c) => c.id)).not.toContain('hid_test');
    expect(
      groupedPool(data, 'ironclad', '', { statuses: true, curses: true, multiplayer: true }).flatMap((g) =>
        g.cards.map((c) => c.id),
      ),
    ).not.toContain('hid_test');
  });

  it('hides the Mad Science placeholder', () => {
    expect(gameData.cards.mad_science?.hidden).toBe(true);
    expect(deckPool(gameData, 'ironclad').map((c) => c.id)).not.toContain('mad_science');
  });

  it('is empty for an unknown character', () => {
    expect(deckPool(gameData, 'nobody')).toEqual([]);
  });
});

describe('deck edits', () => {
  it('counts', () => {
    expect(deckSize(deck)).toBe(9);
    expect(copiesOf(deck, 'strike', false)).toBe(5);
    expect(copiesOf(deck, 'strike', true)).toBe(0);
  });

  it('adds a new group at the end, keeping upgraded separate', () => {
    expect(changeCount(deck, 'strike', true, 1)).toEqual([...deck, { cardId: 'strike', upgraded: true, count: 1 }]);
  });

  it('removes a group at zero and ignores removing what is absent', () => {
    expect(changeCount(deck, 'defend', false, -4)).toEqual([deck[0]]);
    expect(changeCount(deck, 'bash', false, -1)).toBe(deck);
  });
});

describe('copy limits (#137)', () => {
  // No card is limited right now (#135), so test the mechanism with a limited copy.
  const boulder = { ...gameData.cards.rolling_boulder!, maxCopies: 1 };
  const strike = gameData.cards.strike!;
  it('counts Standard and Upgraded together', () => {
    const d: Deck = [{ cardId: 'rolling_boulder', upgraded: true, count: 1 }];
    expect(totalCopies(d, 'rolling_boulder')).toBe(1);
    expect(totalCopies([...d, { cardId: 'rolling_boulder', upgraded: false, count: 2 }], 'rolling_boulder')).toBe(3);
  });
  it('is at the limit once maxCopies is reached, in either version', () => {
    expect(atCopyLimit([], boulder)).toBe(false);
    expect(atCopyLimit([{ cardId: 'rolling_boulder', upgraded: false, count: 1 }], boulder)).toBe(true);
    expect(atCopyLimit([{ cardId: 'rolling_boulder', upgraded: true, count: 1 }], boulder)).toBe(true);
  });
  it('never limits a card without maxCopies', () => {
    expect(
      atCopyLimit([{ cardId: 'rolling_boulder', upgraded: false, count: 9 }], gameData.cards.rolling_boulder!),
    ).toBe(false);
    expect(atCopyLimit([{ cardId: 'strike', upgraded: false, count: 50 }], strike)).toBe(false);
  });
});

describe('removeCard', () => {
  const mixed: Deck = [...deck, { cardId: 'defend', upgraded: true, count: 1 }];

  it('removes both the standard and upgraded entries', () => {
    expect(removeCard(mixed, 'defend')).toEqual([deck[0]]);
    expect(copiesOf(removeCard(mixed, 'defend'), 'defend', false)).toBe(0);
    expect(copiesOf(removeCard(mixed, 'defend'), 'defend', true)).toBe(0);
  });

  it('leaves other cards untouched and does not mutate the input', () => {
    expect(removeCard(mixed, 'defend')).toContainEqual(deck[0]);
    expect(mixed).toHaveLength(3);
  });

  it('is a no-op for an absent card', () => {
    expect(removeCard(deck, 'bash')).toBe(deck);
  });
});

describe('isCharacterSimulated', () => {
  it('is true for Ironclad and false for a starter deck with unsupported cards', () => {
    expect(isCharacterSimulated(gameData, gameData.characters.ironclad!)).toBe(true);
    expect(isCharacterSimulated(gameData, gameData.characters.defect!)).toBe(false);
  });
});

describe('deck builder grouping and search', () => {
  it('groups by data folder in a fixed order', () => {
    const labels = groupedPool(gameData, 'ironclad', '').map((g) => g.label);
    expect(labels.slice(0, 3)).toEqual(['Shared', 'Ironclad', 'Colorless']);
    expect(cardFolder(gameData.cards.ascenders_bane!)).toBe('Curses');
  });

  it('filters by name or text, case-insensitively', () => {
    const ids = groupedPool(gameData, 'ironclad', 'BASH').flatMap((g) => g.cards.map((c) => c.id));
    expect(ids).toContain('bash');
    expect(ids).not.toContain('strike');
    expect(matchesSearch(gameData.cards.bash!, 'vulnerable')).toBe(true);
  });

  it('leaves unsimulated starters out of the starting deck', () => {
    expect(startingDeckFor(gameData, 'ironclad')).toEqual(gameData.characters.ironclad!.startingDeck);
    // #259: Survivor is simulated, so the Silent's starting deck is complete; the Defect's is not.
    expect(startingDeckFor(gameData, 'silent')).toEqual(gameData.characters.silent!.startingDeck);
    expect(unsimulatedStarters(gameData, 'silent')).toEqual([]);
    expect(startingDeckFor(gameData, 'defect').map((e) => e.cardId)).toEqual(['strike', 'defend']);
    expect(unsimulatedStarters(gameData, 'defect')).toEqual(['Zap', 'Dualcast']);
  });
});

describe('card selector filters', () => {
  const off = { statuses: false, curses: false, multiplayer: false };
  const all = { statuses: true, curses: true, multiplayer: true };
  const cardsFor = (f: Partial<typeof off>, q = '') =>
    groupedPool(gameData, 'ironclad', q, { ...off, ...f }).flatMap((g) => g.cards);

  it('by default shows only single-player shared, character and colorless cards', () => {
    expect(cardsFor({}).some((c) => c.type === 'status' || c.type === 'curse' || c.multiplayerOnly)).toBe(false);
    expect(groupedPool(gameData, 'ironclad', '', off).map((g) => g.label)).toEqual(['Shared', 'Ironclad', 'Colorless']);
  });

  it('each toggle adds its category', () => {
    expect(cardsFor({ statuses: true }).some((c) => c.type === 'status')).toBe(true);
    expect(cardsFor({ statuses: true }).some((c) => c.type === 'curse' || c.multiplayerOnly)).toBe(false);
    expect(cardsFor({ curses: true }).some((c) => c.type === 'curse')).toBe(true);
    expect(cardsFor({ curses: true }).some((c) => c.type === 'status' || c.multiplayerOnly)).toBe(false);
    // No simulated multiplayer-only card exists in the data yet, so flag one.
    const data = {
      ...gameData,
      cards: {
        ...gameData.cards,
        mp_test: {
          ...gameData.cards.strike!,
          id: 'mp_test',
          name: 'MP Test',
          character: 'colorless' as const,
          multiplayerOnly: true,
          simulated: true,
        },
      },
    };
    const ids = (f: Partial<typeof off>) =>
      groupedPool(data, 'ironclad', '', { ...off, ...f }).flatMap((g) => g.cards.map((c) => c.id));
    expect(ids({})).not.toContain('mp_test');
    expect(ids({ multiplayer: true })).toContain('mp_test');
    expect(ids({ statuses: true, curses: true })).not.toContain('mp_test');
    expect(cardsFor({ multiplayer: true }).some((c) => c.type === 'status' || c.type === 'curse')).toBe(false);
  });

  it("never lists Ascender's Bane or unsimulated cards", () => {
    const cards = cardsFor(all);
    expect(cards.map((c) => c.id)).not.toContain('ascenders_bane');
    expect(cards.every((c) => c.simulated)).toBe(true);
    expect(filteredPool(gameData, 'ironclad', all).map((c) => c.id)).not.toContain('ascenders_bane');
  });

  it('combines with search', () => {
    const q = cardsFor(all, 'BASH').map((c) => c.id);
    expect(q).toContain('bash');
    expect(q).not.toContain('strike');
    const curse = Object.values(gameData.cards).find(
      (c) => c.type === 'curse' && c.simulated && c.id !== 'ascenders_bane',
    )!;
    expect(cardsFor({}, curse.name).map((c) => c.id)).not.toContain(curse.id);
    expect(cardsFor({ curses: true }, curse.name).map((c) => c.id)).toContain(curse.id);
  });
});

describe('costColorKey', () => {
  const card = (character: string, type = 'skill') => ({ character, type }) as unknown as CardDef;
  const cases: [string, string][] = [
    ['I', 'ironclad'],
    ['S', 'silent'],
    ['R', 'regent'],
    ['N', 'necrobinder'],
    ['D', 'defect'],
  ];

  it.each(cases)('character %s cards are %s', (code, key) => {
    expect(costColorKey(card(code), 'ironclad', gameData)).toBe(key);
  });

  it('shared cards take the selected character color', () => {
    expect(costColorKey(card('shared', 'attack'), 'ironclad', gameData)).toBe('ironclad');
    expect(costColorKey(card('shared', 'skill'), 'silent', gameData)).toBe('silent');
  });

  it('shared cards fall back to colorless for an unknown character', () => {
    expect(costColorKey(card('shared'), 'nobody', gameData)).toBe('colorless');
  });

  it('colorless and status cards are colorless', () => {
    expect(costColorKey(card('colorless'), 'silent', gameData)).toBe('colorless');
    expect(costColorKey(card('colorless', 'status'), 'silent', gameData)).toBe('colorless');
    expect(costColorKey(card('I', 'status'), 'ironclad', gameData)).toBe('colorless');
  });

  it('curses and quests are curse', () => {
    expect(costColorKey(card('colorless', 'curse'), 'ironclad', gameData)).toBe('curse');
    expect(costColorKey(card('I', 'curse'), 'ironclad', gameData)).toBe('curse');
    expect(costColorKey(card('colorless', 'quest'), 'ironclad', gameData)).toBe('curse');
  });
});

describe("automatic ascension cards (Ascender's Bane)", () => {
  const off = { statuses: false, curses: false, multiplayer: false };
  const on = { ...off, curses: true };
  const curseIds = (asc: number, f = off) =>
    groupedPool(gameData, 'ironclad', '', f, asc)
      .find((g) => g.label === 'Curses')
      ?.cards.map((c) => c.id) ?? [];
  const level = gameData.manifest.ascensionCards[0]!.level;

  it('none below the manifest level, Bane at and above it', () => {
    expect(automaticCards(gameData, level - 1)).toEqual([]);
    expect(automaticCards(gameData, level).map((a) => a.card.id)).toEqual(['ascenders_bane']);
    expect(automaticCards(gameData, 10).map((a) => a.card.id)).toEqual(['ascenders_bane']);
    expect(automaticCards(gameData, level)[0]!.level).toBe(level);
  });

  it('is listed under Curses with the filter off, alone', () => {
    expect(curseIds(level)).toEqual(['ascenders_bane']);
  });

  it('is listed alongside other curses with the filter on, and never below the level', () => {
    const ids = curseIds(level, on);
    expect(ids).toContain('ascenders_bane');
    expect(ids.length).toBeGreaterThan(1);
    expect(ids.filter((i) => i === 'ascenders_bane')).toHaveLength(1);
    expect(curseIds(level - 1)).toEqual([]);
    expect(curseIds(level - 1, on)).not.toContain('ascenders_bane');
  });

  it('counts toward the combat deck size but is not added to the deck', () => {
    expect(combatDeckSize(gameData, deck, level - 1)).toBe(deckSize(deck));
    expect(combatDeckSize(gameData, deck, level)).toBe(deckSize(deck) + 1);
    expect(deck.some((e) => e.cardId === 'ascenders_bane')).toBe(false);
  });
});

describe('groupedPool rarity sub-folders (#254)', () => {
  it('splits character and Colorless folders by rarity, omitting empty ones; Shared, Status and Curses stay flat', () => {
    const groups = groupedPool(gameData, 'ironclad', '', { statuses: true, curses: true, multiplayer: false });
    for (const g of groups) {
      if (['ironclad', 'colorless'].includes(g.key)) {
        expect(g.subgroups!.length).toBeGreaterThan(0);
        expect(g.subgroups!.every((s) => s.cards.length > 0 && s.key.startsWith(`${g.key}/`))).toBe(true);
        expect(g.subgroups!.flatMap((s) => s.cards).length).toBe(g.cards.length);
      } else {
        expect(g.subgroups).toBeUndefined();
      }
    }
    const ironclad = groups.find((g) => g.key === 'ironclad')!;
    expect(ironclad.subgroups!.map((s) => s.label)).toEqual(expect.arrayContaining(['Common', 'Uncommon', 'Rare']));
  });
});

describe('foldersForFilter', () => {
  it('maps Statuses and Curses to their own folders, matching groupedPool keys', () => {
    // They start collapsed, so turning the pill on expands nothing.
    expect(foldersForFilter(gameData, 'ironclad', 'statuses')).toEqual([]);
    expect(foldersForFilter(gameData, 'ironclad', 'curses')).toEqual([]);
    const keys = groupedPool(gameData, 'ironclad', '', { statuses: true, curses: true, multiplayer: false }).map(
      (g) => g.key,
    );
    expect(keys).toContain('status');
    expect(keys).toContain('curses');
  });

  it('maps Multiplayer to the folders of the multiplayer-only cards it adds', () => {
    const folders = foldersForFilter(gameData, 'ironclad', 'multiplayer');
    const withIt = groupedPool(gameData, 'ironclad', '', { statuses: true, curses: true, multiplayer: true });
    const without = groupedPool(gameData, 'ironclad', '', { statuses: true, curses: true, multiplayer: false });
    const gained = withIt
      .filter((g) => g.cards.length > (without.find((w) => w.key === g.key)?.cards.length ?? 0))
      .map((g) => g.key);
    expect([...folders].filter((k) => !k.includes('/')).sort()).toEqual(gained.sort());
  });
});

describe('deckPowerNames (#132)', () => {
  const power = Object.values(gameData.cards).filter((c) => c.type === 'power');
  const [a, b] = power;

  it('is empty for a deck without Powers', () => {
    expect(deckPowerNames(gameData, deck)).toEqual([]);
  });

  it('lists each Power once, whether upgraded, standard or both, in first-seen order', () => {
    expect(a && b).toBeTruthy();
    const d: Deck = [
      ...deck,
      { cardId: b!.id, upgraded: true, count: 1 },
      { cardId: a!.id, upgraded: false, count: 2 },
      { cardId: b!.id, upgraded: false, count: 1 },
      { cardId: a!.id, upgraded: true, count: 1 },
    ];
    expect(deckPowerNames(gameData, d)).toEqual([b!.name, a!.name]);
  });

  it('ignores unknown cards and zero-count entries', () => {
    expect(
      deckPowerNames(gameData, [
        { cardId: 'nope', upgraded: false, count: 1 },
        { cardId: a!.id, upgraded: false, count: 0 },
      ]),
    ).toEqual([]);
  });
});
