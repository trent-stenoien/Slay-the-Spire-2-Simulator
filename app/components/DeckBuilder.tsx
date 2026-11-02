import { useEffect, useState } from 'react';
import { Panel } from './Panel';
import type { CardDef, Deck, GameData } from '../../engine/types';
import { cardText } from '../lib/cardText';
import { cardWikiUrl } from '../lib/wiki';
import type { CostColorKey, PoolFilters } from '../lib/deck';
import {
  DEFAULT_FILTERS,
  automaticCards,
  foldersForFilter,
  atCopyLimit,
  changeCount,
  combatDeckSize,
  copiesOf,
  costColorKey,
  groupedPool,
  removeCard,
  unsimulatedStarters,
} from '../lib/deck';

interface Props {
  data: GameData;
  characterId: string;
  ascension: number;
  deck: Deck;
  onChange: (deck: Deck) => void;
  onReset: () => void;
}

const FILTER_BUTTONS: [keyof PoolFilters, string][] = [
  ['statuses', 'Statuses'],
  ['curses', 'Curses'],
  ['multiplayer', 'Multiplayer'],
];

/** Searchable card pool, grouped by data folder; one row per card with normal and upgraded counts. */
export function DeckBuilder({ data, characterId, ascension, deck, onChange, onReset }: Props) {
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<PoolFilters>(DEFAULT_FILTERS);
  // Folders start collapsed; turning a filter on expands the folders it adds.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    setFilters(DEFAULT_FILTERS);
    setExpanded(new Set());
  }, [characterId]);
  const toggleFilter = (key: keyof PoolFilters) => {
    if (!filters[key]) setExpanded((e) => new Set([...e, ...foldersForFilter(data, characterId, key, ascension)]));
    setFilters((f) => ({ ...f, [key]: !f[key] }));
  };
  const setFolder = (key: string, open: boolean) =>
    setExpanded((e) => {
      if (e.has(key) === open) return e;
      const next = new Set(e);
      if (open) next.add(key);
      else next.delete(key);
      return next;
    });
  const groups = groupedPool(data, characterId, query, filters, ascension);
  const auto = new Map(automaticCards(data, ascension).map((a) => [a.card.id, a.level]));
  const builtSize = deck.reduce((n, e) => n + e.count, 0);
  const size = combatDeckSize(data, deck, ascension);
  const leftOut = unsimulatedStarters(data, characterId);

  return (
    <Panel id="deck" title="Deck" aside={`(${size} cards)`}>
      <div className="panel-actions">
        <button type="button" className="btn-link" onClick={onReset}>
          Reset to starter deck
        </button>
      </div>
      {leftOut.length > 0 && (
        <p className="note">Not simulated yet, so left out of the starter deck: {leftOut.join(', ')}.</p>
      )}
      {builtSize === 0 && <p className="warn">The deck is empty. Add at least one card.</p>}
      <div className="deck-tools">
        <input
          type="search"
          className="deck-search"
          placeholder="Search cards by name or text"
          aria-label="Search cards"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="filter-pills" role="group" aria-label="Show more card types">
          {FILTER_BUTTONS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              className="pill"
              aria-pressed={filters[key]}
              onClick={() => toggleFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {groups.length === 0 && (
        <p className="muted small">No cards match{query.trim() ? ` "${query}"` : ' the current filters'}.</p>
      )}
      {groups.map((g) => {
        const inDeck = g.cards.reduce(
          (n, c) => n + (auto.has(c.id) ? 1 : copiesOf(deck, c.id, false) + copiesOf(deck, c.id, true)),
          0,
        );
        return (
          <details
            key={g.key}
            className="card-group"
            open={expanded.has(g.key)}
            onToggle={(e) => setFolder(g.key, e.currentTarget.open)}
          >
            <summary>
              {g.label}{' '}
              <span className="muted small">
                ({g.cards.length} {g.cards.length === 1 ? 'card' : 'cards'}
                {inDeck > 0 ? `, ${inDeck} in deck` : ''})
              </span>
            </summary>
            <ul className="card-list">
              {g.cards.map((card) => (
                <CardRow
                  key={card.id}
                  card={card}
                  colorKey={costColorKey(card, characterId, data)}
                  deck={deck}
                  autoLevel={auto.get(card.id)}
                  onChange={onChange}
                />
              ))}
            </ul>
          </details>
        );
      })}
    </Panel>
  );
}

function CardRow({
  card,
  colorKey,
  deck,
  autoLevel,
  onChange,
}: {
  card: CardDef;
  colorKey: CostColorKey;
  deck: Deck;
  autoLevel?: number;
  onChange: (d: Deck) => void;
}) {
  const base = cardText(card, false);
  const up = card.upgraded ? cardText(card, true) : null;
  const locked = autoLevel !== undefined;
  const n = locked ? 1 : copiesOf(deck, card.id, false);
  const nUp = copiesOf(deck, card.id, true);
  const limit = card.maxCopies;
  const limitNote =
    limit !== undefined && atCopyLimit(deck, card)
      ? `Limited to ${limit} ${limit === 1 ? 'copy' : 'copies'} for now (untested with multiple copies)`
      : undefined;
  return (
    <li className={`card-row row-${colorKey} type-${card.type}${n + nUp > 0 ? ' in-deck' : ''}`}>
      <div className="card-head">
        <span className={`cost cost-${colorKey}`} title="Energy cost">
          {base.cost}
        </span>
        <span className="card-name">
          <a
            href={cardWikiUrl(card.name)}
            target="_blank"
            rel="noopener noreferrer"
            title={`${base.name} on the wiki (opens in a new tab)`}
          >
            {base.name}
          </a>
        </span>
        {!locked && n + nUp > 0 && (
          <button
            type="button"
            className="icon-btn danger card-clear"
            aria-label={`Remove all ${base.name} from deck`}
            title={`Remove all ${base.name} from deck`}
            onClick={() => onChange(removeCard(deck, card.id))}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
      <span className="card-label">Standard</span>
      <span className="card-text">{base.lines.join('. ')}</span>
      {locked ? (
        <div className="stepper locked" title="Added automatically">
          <span className="count" aria-label={`${n} standard copy of ${base.name}, added automatically`}>
            {n}
          </span>
        </div>
      ) : (
        <Stepper
          label={base.name}
          tag="Standard"
          n={n}
          addBlocked={limitNote}
          onStep={(d) => onChange(changeCount(deck, card.id, false, d))}
        />
      )}
      {locked && <span className="auto-note muted small">Added automatically at Ascension {autoLevel}+</span>}
      {up && (
        <>
          <span className="card-label">Upgraded</span>
          <span className="card-text">
            {up.lines.join('. ')}
            {up.cost !== base.cost ? ` (costs ${up.cost})` : ''}
          </span>
          <Stepper
            label={up.name}
            tag="Upgraded"
            n={nUp}
            addBlocked={limitNote}
            onStep={(d) => onChange(changeCount(deck, card.id, true, d))}
          />
        </>
      )}
    </li>
  );
}

function Stepper({
  label,
  tag,
  n,
  addBlocked,
  onStep,
}: {
  label: string;
  tag: string;
  n: number;
  /** Tooltip explaining why + is disabled by a copy limit; undefined when not limited. */
  addBlocked?: string | undefined;
  onStep: (delta: number) => void;
}) {
  return (
    <div className="stepper" title={`${tag} copies`}>
      <button
        type="button"
        aria-label={`Remove one ${tag.toLowerCase()} ${label}`}
        disabled={n === 0}
        onClick={() => onStep(-1)}
      >
        −
      </button>
      <span className="count" aria-label={`${n} ${tag.toLowerCase()} copies of ${label}`}>
        {n}
      </span>
      <button
        type="button"
        aria-label={`Add one ${tag.toLowerCase()} ${label}`}
        disabled={n >= 99 || addBlocked !== undefined}
        title={addBlocked}
        onClick={() => onStep(1)}
      >
        +
      </button>
    </div>
  );
}
