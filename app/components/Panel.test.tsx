import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { gameData } from '../../data';
import { DEFAULT_STRATEGIES } from '../lib/strategyLibrary';
import { readCollapsed, writeCollapsed } from '../lib/panelState';
import { DeckBuilder } from './DeckBuilder';
import { Panel } from './Panel';
import { StrategyPanel } from './StrategyPanel';
import { blockFirstConfig } from '../../engine/strategies';

const throwing = {
  getItem: () => {
    throw new Error('denied');
  },
  setItem: () => {
    throw new Error('denied');
  },
};

describe('Panel', () => {
  it('is expanded by default with a labelled toggle button inside the heading', () => {
    const html = renderToStaticMarkup(
      <Panel id="x" title="Thing" aside="3/5">
        <p>body</p>
      </Panel>,
    );
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-controls="x-body"');
    expect(html).toMatch(/<h2 id="x-h"[^>]*><button/);
    expect(html).toContain('3/5');
    expect(html).not.toMatch(/id="x-body"[^>]*hidden/);
  });

  it('defaultCollapsed starts collapsed without storage; actions sit beside the toggle, not inside it', () => {
    const html = renderToStaticMarkup(
      <Panel id="y" title="Thing" defaultCollapsed actions={<button type="button">Go</button>}>
        <p>body</p>
      </Panel>,
    );
    expect(html).toContain('aria-expanded="false"');
    expect(html).toMatch(/id="y-body"[^>]*hidden/);
    expect(html).toMatch(/<\/h2><div class="panel-bar-actions"><button type="button">Go<\/button><\/div>/);
  });

  it('puts Deck and Strategies action links in the body, not the title bar', () => {
    const deck = renderToStaticMarkup(
      <DeckBuilder
        data={gameData}
        characterId="ironclad"
        ascension={0}
        deck={gameData.characters.ironclad!.startingDeck}
        onChange={() => {}}
        onReset={() => {}}
      />,
    );
    expect(deck.indexOf('Reset to starter deck')).toBeGreaterThan(deck.indexOf('id="deck-body"'));
    expect(deck.indexOf('Reset to starter deck')).toBeGreaterThan(deck.indexOf('</h2>'));
    expect(deck).toContain('cards)');

    const custom = { id: 'c1', name: 'Mine', config: blockFirstConfig(3) };
    const strat = renderToStaticMarkup(
      <StrategyPanel
        library={[...DEFAULT_STRATEGIES, custom]}
        selection={[]}
        storageOk
        powerNames={[]}
        onToggle={() => {}}
        onColor={() => {}}
        onAdd={() => {}}
        onRename={() => {}}
        onConfig={() => {}}
        onDelete={() => {}}
        onClearAll={() => {}}
      />,
    );
    expect(strat.indexOf('Clear custom strategies')).toBeGreaterThan(strat.indexOf('id="strat-body"'));
    expect(strat.indexOf('Clear custom strategies')).toBeGreaterThan(strat.indexOf('</h2>'));
    expect(strat).toContain('0/');
  });
});

describe('panelState', () => {
  it('tolerates storage that throws', () => {
    expect(readCollapsed('x', throwing)).toBe(false);
    expect(() => writeCollapsed('x', true, throwing)).not.toThrow();
    expect(readCollapsed('x', null)).toBe(false);
  });

  it('round-trips through working storage', () => {
    const m = new Map<string, string>();
    const s = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    writeCollapsed('x', true, s);
    expect(readCollapsed('x', s)).toBe(true);
    writeCollapsed('x', false, s);
    expect(readCollapsed('x', s)).toBe(false);
  });
});
