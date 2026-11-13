// @vitest-environment jsdom
/**
 * Interaction tests: render into jsdom and drive the UI the way a user does (clicks, typing),
 * checking what the page shows afterwards.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { gameData } from '../../data';
import type { Deck, RunResult, StrategyConfig } from '../../engine/types';
import { App } from '../App';
import { replayCombat } from '../lib/compare';
import { foldersForFilter } from '../lib/deck';
import { STORAGE_KEY } from '../lib/strategyLibrary';
import { SELECTION_STORAGE_KEY } from '../lib/selectionStorage';
import { defaultSetup } from '../lib/url';
import { CombatLog } from './CombatLog';
import { DeckBuilder } from './DeckBuilder';
import { DistributionChart } from './DistributionChart';
import { ResultsView } from './ResultsView';
import { ResultsPanel } from './ResultsPanel';
import { SetupPanel, enemiesIn } from './SetupPanel';
import { selectableRelics } from '../lib/relics';
import { resultRows } from '../lib/results';
import { GREEDY_CONFIG, blockFirstConfig } from '../../engine/strategies';

beforeEach(() => localStorage.clear());
afterEach(cleanup);

const result: RunResult = {
  gameVersion: 'v0.107.1',
  config: {
    characterId: 'ironclad',
    deck: gameData.characters.ironclad!.startingDeck,
    enemyId: 'nibbit',
    ascension: 0,
    runSeed: 99,
    strategies: [
      { strategy: { id: 'g', name: 'Greedy Damage', config: GREEDY_CONFIG }, color: 'blue' },
      { strategy: { id: 's', name: 'Scared Block', config: blockFirstConfig(0) }, color: 'purple' },
    ],
  },
  summaries: [
    {
      strategyId: 'g',
      combats: 10,
      avgHpLost: 8.4,
      avgTurnsToKill: 6.1,
      avgTurns: 6.4,
      avgGold: 0,
      potionRate: 0,
      deathRate: 0.1,
      turnCapRate: 0,
      hpLostCounts: [0, 0, 2, 3, 5],
      firstCombatByHpLost: { 2: 4, 3: 0, 4: 1 },
    },
    {
      strategyId: 's',
      combats: 10,
      avgHpLost: 3.2,
      avgTurnsToKill: null,
      avgTurns: 9.5,
      avgGold: 0,
      potionRate: 0,
      deathRate: 0,
      turnCapRate: 0.2,
      hpLostCounts: [4, 4, 2],
      firstCombatByHpLost: { 0: 1, 1: 0, 2: 7 },
    },
  ],
};

const legendButton = (name: string) =>
  within(screen.getByRole('list', { name: /Strategies \(click to show or hide\)/ })).getByRole('button', {
    name,
  });
const percentileLinks = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLAnchorElement>('a.pmark-link')].map((a) => a.getAttribute('href') ?? '');
const curveFills = (container: HTMLElement) => container.querySelectorAll('path.curve-fill').length;

describe('compare view: stepping turns', () => {
  it('a column whose combat is over reads "Combat ended on turn N" while the longer one still shows its turn', async () => {
    const setup = defaultSetup(gameData);
    const strategies: StrategyConfig[] = [GREEDY_CONFIG, blockFirstConfig(0)];
    // Find a seed where the two strategies' combats last a different number of turns.
    let seed = -1;
    let lengths: number[] = [];
    for (let s = 1; s < 200 && seed < 0; s++) {
      const ls = strategies.map((c) => {
        const r = replayCombat(gameData, setup, c, s);
        return r.ok ? r.replay.rounds.length : 0;
      });
      if (ls[0]! > 0 && ls[1]! > 0 && ls[0] !== ls[1]) [seed, lengths] = [s, ls];
    }
    expect(seed).toBeGreaterThan(0);
    const short = Math.min(...lengths);
    const long = Math.max(...lengths);
    const shortCol = lengths.indexOf(short);

    const { container } = render(
      <CombatLog data={gameData} setup={setup} target={{ seed, strategies, colors: ['blue', 'red'] }} />,
    );
    const cols = () => [...container.querySelectorAll<HTMLElement>('section.compare-col')];
    expect(cols()).toHaveLength(2);
    expect(screen.getByRole('combobox')).toHaveProperty('value', '0');
    expect(container.querySelector('.compare-ended')).toBeNull();

    const user = userEvent.setup();
    // On the short combat's last turn, both columns still show a round.
    for (let i = 1; i < short; i++) await user.click(screen.getByRole('button', { name: 'Next turn' }));
    expect(container.querySelector('.compare-ended')).toBeNull();
    // One more step: the short column has ended, the long one shows turn short + 1.
    await user.click(screen.getByRole('button', { name: 'Next turn' }));
    expect(cols()[shortCol]!.querySelector('.compare-ended')?.textContent).toMatch(
      new RegExp(`^Combat ended on turn ${short}: (won|died|hit the turn cap), lost \\d+ HP\\.$`, 'i'),
    );
    expect(cols()[1 - shortCol]!.querySelector('.compare-ended')).toBeNull();
    expect(within(cols()[1 - shortCol]!).getByText('Your Turn')).toBeTruthy();
    expect(screen.getByRole('combobox')).toHaveProperty('value', String(short));
    // The shared selector spans the longer combat, and Next stops there.
    expect(screen.getAllByRole('option')).toHaveLength(long);
    // Stepping back brings the short column's round back.
    await user.click(screen.getByRole('button', { name: 'Previous turn' }));
    expect(container.querySelector('.compare-ended')).toBeNull();
  });
});

/** DeckBuilder with real deck state, as App wires it. */
function DeckHarness({ initial, ascension = 0 }: { initial: Deck; ascension?: number }) {
  const [deck, setDeck] = useState<Deck>(initial);
  return (
    <>
      <DeckBuilder
        data={gameData}
        characterId="ironclad"
        ascension={ascension}
        deck={deck}
        onChange={setDeck}
        onReset={() => setDeck(initial)}
      />
      <output data-testid="deck">{JSON.stringify(deck)}</output>
    </>
  );
}
const deckState = (): Deck => JSON.parse(screen.getByTestId('deck').textContent ?? '[]');
const folder = (container: HTMLElement, label: string) =>
  [...container.querySelectorAll<HTMLDetailsElement>('details.card-group')].find((d) =>
    d.querySelector('summary')?.textContent?.startsWith(label),
  );

describe('deck builder interactions', () => {
  it('every folder starts collapsed, and clicking a folder header opens it', async () => {
    const { container } = render(<DeckHarness initial={[]} />);
    const all = [...container.querySelectorAll<HTMLDetailsElement>('details.card-group')];
    expect(all.length).toBeGreaterThan(1);
    expect(all.every((d) => !d.open)).toBe(true);
    await userEvent.click(folder(container, 'Ironclad')!.querySelector('summary')!);
    expect(folder(container, 'Ironclad')!.open).toBe(true);
    expect(all.filter((d) => d.open)).toHaveLength(1);
  });

  it('the X removes every standard and upgraded copy of that card, and then disappears', async () => {
    render(
      <DeckHarness
        initial={[
          { cardId: 'strike', upgraded: false, count: 3 },
          { cardId: 'strike', upgraded: true, count: 2 },
          { cardId: 'defend', upgraded: false, count: 4 },
        ]}
      />,
    );
    expect(screen.getByLabelText('3 standard copies of Strike')).toBeTruthy();
    expect(screen.getByLabelText('2 upgraded copies of Strike+')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Remove all Strike from deck' }));
    expect(deckState()).toEqual([{ cardId: 'defend', upgraded: false, count: 4 }]);
    expect(screen.getByLabelText('0 standard copies of Strike')).toBeTruthy();
    expect(screen.getByLabelText('0 upgraded copies of Strike+')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remove all Strike from deck' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove all Defend from deck' })).toBeTruthy();
  });

  it('the Standard and Upgraded steppers change only their own count', async () => {
    render(<DeckHarness initial={[{ cardId: 'strike', upgraded: false, count: 1 }]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add one upgraded Strike+' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add one standard Strike' }));
    expect(deckState()).toEqual([
      { cardId: 'strike', upgraded: false, count: 2 },
      { cardId: 'strike', upgraded: true, count: 1 },
    ]);
  });

  it("disables both + buttons at a card's copy limit, with a tooltip (#137)", async () => {
    // No real card is limited right now (#135): limit Crimson Mantle for this test only.
    const mantle = gameData.cards.crimson_mantle as { maxCopies?: number };
    mantle.maxCopies = 1;
    try {
      await limitTest();
    } finally {
      delete mantle.maxCopies;
    }
  });

  async function limitTest() {
    render(<DeckHarness initial={[]} />);
    const addStd = () => screen.getByRole('button', { name: 'Add one standard Crimson Mantle' }) as HTMLButtonElement;
    const addUp = () => screen.getByRole('button', { name: 'Add one upgraded Crimson Mantle+' }) as HTMLButtonElement;
    expect(addStd().disabled).toBe(false);
    expect(addUp().disabled).toBe(false);
    await userEvent.click(addUp());
    expect(addStd().disabled).toBe(true);
    expect(addUp().disabled).toBe(true);
    expect(addStd().title).toBe('Limited to 1 copy for now (untested with multiple copies)');
    expect(deckState()).toEqual([{ cardId: 'crimson_mantle', upgraded: true, count: 1 }]);
    await userEvent.click(screen.getByRole('button', { name: 'Remove one upgraded Crimson Mantle+' }));
    expect(addStd().disabled).toBe(false);
    // Cards without a limit are unaffected.
    expect((screen.getByRole('button', { name: 'Add one standard Strike' }) as HTMLButtonElement).disabled).toBe(false);
  }

  it.each([
    ['Statuses', 'statuses'],
    ['Curses', 'curses'],
    ['Multiplayer', 'multiplayer'],
  ] as const)(
    'turning on the %s filter adds its folders, collapsed (Multiplayer expands what it adds)',
    async (label, key) => {
      const { container } = render(<DeckHarness initial={[]} />);
      // Ironclad has no simulated multiplayer-only cards, so Multiplayer expands nothing for it.
      const keys = foldersForFilter(gameData, 'ironclad', key, 0);
      // Statuses and Curses folders start collapsed; Ironclad has no multiplayer-only cards.
      expect(keys).toEqual([]);
      const openKeys = () =>
        [...container.querySelectorAll<HTMLDetailsElement>('details.card-group')]
          .filter((d) => d.open)
          .map((d) => d.querySelector('summary')!.textContent!.split(' (')[0]!.trim().toLowerCase());
      expect(openKeys()).toEqual([]);
      const pill = screen.getByRole('button', { name: label });
      expect(pill.getAttribute('aria-pressed')).toBe('false');
      await userEvent.click(pill);
      expect(pill.getAttribute('aria-pressed')).toBe('true');
      expect(openKeys()).toEqual([]);
      if (key !== 'multiplayer') {
        expect(screen.getByText(key === 'statuses' ? 'Status' : 'Curses', { selector: 'summary' })).toBeTruthy();
      }
      // Turning the filter off again hides those cards.
      await userEvent.click(pill);
      expect(pill.getAttribute('aria-pressed')).toBe('false');
    },
  );

  it("Ascender's Bane is locked at A5: no X, no stepper buttons, counted in the deck size", () => {
    render(<DeckHarness initial={[{ cardId: 'strike', upgraded: false, count: 2 }]} ascension={5} />);
    expect(screen.getByText('(3 cards)')).toBeTruthy();
    expect(screen.getByLabelText("1 standard copy of Ascender's Bane, added automatically")).toBeTruthy();
    expect(screen.queryByRole('button', { name: "Remove all Ascender's Bane from deck" })).toBeNull();
    expect(screen.queryByRole('button', { name: "Remove one standard Ascender's Bane" })).toBeNull();
  });
});

describe('chart legend and smoothing slider', () => {
  it('clicking a legend entry hides that strategy on the chart only (View a combat still lists it), and clicking again shows it', async () => {
    const { container } = render(<ResultsView data={gameData} result={result} />);
    const checks = () =>
      [...container.querySelectorAll('.strategy-checks label')].map((l) => l.textContent?.trim() ?? '');
    expect(curveFills(container)).toBe(2);
    expect(checks()).toEqual(['Scared Block', 'Greedy Damage']);

    await userEvent.click(legendButton('Greedy Damage'));
    expect(legendButton('Greedy Damage').getAttribute('aria-pressed')).toBe('false');
    expect(legendButton('Greedy Damage').className).toContain('off');
    expect(curveFills(container)).toBe(1);
    expect(checks()).toEqual(['Scared Block', 'Greedy Damage']);

    await userEvent.click(legendButton('Greedy Damage'));
    expect(legendButton('Greedy Damage').getAttribute('aria-pressed')).toBe('true');
    expect(curveFills(container)).toBe(2);
    expect(checks()).toEqual(['Scared Block', 'Greedy Damage']);
  });

  it('Reset puts the smoothing slider back to ×3 and is disabled there', async () => {
    const { container } = render(<DistributionChart rows={resultRows(result)} />);
    const slider = screen.getByRole('slider') as HTMLInputElement;
    const reset = screen.getByRole('button', { name: 'Reset' }) as HTMLButtonElement;
    const output = () => container.querySelector('.bandwidth output')!.textContent;
    const curve = () => container.querySelector('path.curve-fill')!.getAttribute('d');
    expect(slider.value).toBe('3');
    expect(output()).toBe('×3.00');
    expect(reset.disabled).toBe(true);
    const atDefault = curve();

    fireEvent.change(slider, { target: { value: '1' } });
    expect(output()).toBe('×1.00');
    expect(reset.disabled).toBe(false);
    expect(curve()).not.toBe(atDefault);

    await userEvent.click(reset);
    expect(slider.value).toBe('3');
    expect(output()).toBe('×3.00');
    expect(reset.disabled).toBe(true);
    expect(curve()).toBe(atDefault);
  });

  it('the slider at its minimum reads Raw', () => {
    const { container } = render(<DistributionChart rows={resultRows(result)} />);
    fireEvent.change(screen.getByRole('slider'), { target: { value: '0' } });
    expect(container.querySelector('.bandwidth output')!.textContent).toBe('Raw');
  });
});

describe('percentile label links', () => {
  it('link to the compare view with two strategies shown, and to one combat log after hiding one', async () => {
    const { container } = render(<ResultsView data={gameData} result={result} />);
    // Two visible: 6 labels (equal percentiles merge), each opening both strategies (chart order b0, g) with their colors.
    let links = percentileLinks(container);
    expect(links).toHaveLength(6);
    expect(links.every((h) => /&st=b0pa,apb&k=p,b&n=\d+$/.test(h))).toBe(true);
    // Scared Block P50 = 1 HP -> its first combat with 1 HP lost is index 0.
    expect(links.some((h) => h.endsWith('&n=0'))).toBe(true);

    await userEvent.click(legendButton('Scared Block'));
    links = percentileLinks(container);
    expect(links).toHaveLength(3);
    // Greedy alone: no colors, just its own combat; P75 = 4 HP -> first combat index 1, P50 = 3 -> index 0.
    expect(links.every((h) => /&st=apb&n=\d+$/.test(h))).toBe(true);
    expect(links.some((h) => h.endsWith('&n=1'))).toBe(true);
    expect(links.some((h) => h.endsWith('&n=0'))).toBe(true);
  });

  it('three visible strategies still get percentile labels, and the Percentiles toggle hides them', async () => {
    const three: RunResult = {
      ...result,
      config: {
        ...result.config,
        strategies: [
          ...result.config.strategies,
          { strategy: { id: 'b4', name: 'Block 4', config: blockFirstConfig(4) }, color: 'green' },
        ],
      },
      summaries: [...result.summaries, { ...result.summaries[0]!, strategyId: 'b4' }],
    };
    const { container } = render(<ResultsView data={gameData} result={three} />);
    expect(percentileLinks(container).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByLabelText('Percentiles'));
    expect(percentileLinks(container)).toHaveLength(0);
    expect(container.querySelector('.pband')).toBeNull();
  });

  it('the Colorblind toggle swaps the line colors to Okabe-Ito and adds dashes; off by default', async () => {
    const { container } = render(<ResultsView data={gameData} result={result} />);
    const lines = () => [...container.querySelectorAll<SVGPathElement>('svg.chart path[fill="none"]')];
    // Lines follow the table order (Scared Block, purple, first). Default: original palette, solid.
    expect(lines().map((p) => p.getAttribute('stroke'))).toEqual(['#8a5cd6', '#2f6fdf']);
    expect(lines().every((p) => p.getAttribute('stroke-dasharray') === null)).toBe(true);
    await userEvent.click(screen.getByLabelText('Colorblind'));
    // Okabe-Ito colors; purple gets its long dash, blue stays solid.
    expect(lines().map((p) => p.getAttribute('stroke'))).toEqual(['#cc79a7', '#0072b2']);
    expect(lines().map((p) => p.getAttribute('stroke-dasharray'))).toEqual(['14 5', null]);
    // Every strategy key follows the same palette and dash: legend, stats table and "View a combat" list.
    const keys = () => [...container.querySelectorAll<SVGLineElement>('svg.legend-swatch-line line')];
    expect(keys().map((l) => l.getAttribute('stroke'))).toEqual(
      Array(3)
        .fill(null)
        .flatMap(() => ['#cc79a7', '#0072b2']),
    );
    expect(keys().map((l) => l.getAttribute('stroke-dasharray'))).toEqual(
      Array(3)
        .fill(null)
        .flatMap(() => ['14 5', null]),
    );
    expect(container.querySelectorAll('.legend-swatch:not(.legend-swatch-line)')).toHaveLength(0);
    await userEvent.click(screen.getByLabelText('Colorblind'));
    expect(lines().map((p) => p.getAttribute('stroke'))).toEqual(['#8a5cd6', '#2f6fdf']);
  });
});

describe('view-a-combat picker', () => {
  it('checking a second strategy turns "Open combat log" into "Compare" linking both', async () => {
    render(<ResultsView data={gameData} result={result} />);
    const button = () => screen.getByText(/^(Open combat log|Compare)$/);
    expect(button().textContent).toBe('Open combat log');
    expect(button().getAttribute('href')).toMatch(/&st=b0pa&n=0$/);
    await userEvent.click(screen.getByRole('checkbox', { name: /Greedy Damage/ }));
    expect(button().textContent).toBe('Compare');
    expect(button().getAttribute('href')).toMatch(/&st=b0pa,apb&k=p,b&n=0$/);
    // Combat 5 in the field is index 4 in the link.
    const field = screen.getByRole('spinbutton');
    await userEvent.clear(field);
    await userEvent.type(field, '5');
    expect(button().getAttribute('href')).toMatch(/&n=4$/);
    // Unchecking both leaves a disabled button with no link.
    await userEvent.click(screen.getByRole('checkbox', { name: /Greedy Damage/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: /Scared Block/ }));
    expect(button().getAttribute('aria-disabled')).toBe('true');
    expect(button().getAttribute('href')).toBeNull();
    expect(screen.getByText('Check at least one strategy to view its combat.')).toBeTruthy();
  });
});

describe('strategy selection limits (App)', () => {
  const customs = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `u${i}`,
      name: `Block ${i + 1}`,
      config: blockFirstConfig(i + 1),
    }));
  const strategyBoxes = () => [...document.querySelectorAll<HTMLInputElement>('.strat-list input[type="checkbox"]')];

  it('at 5 selected the unchecked boxes are disabled; unchecking one frees them; the selection persists', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(customs(8)));
    render(<App />);
    expect(strategyBoxes()).toHaveLength(10);
    const user = userEvent.setup();
    // Defaults start selected; select more until 5 are checked.
    for (const box of strategyBoxes()) {
      if (strategyBoxes().filter((b) => b.checked).length >= 5) break;
      if (!box.checked) await user.click(box);
    }
    expect(strategyBoxes().filter((b) => b.checked)).toHaveLength(5);
    expect(screen.getByText('5/5 selected')).toBeTruthy();
    const unchecked = strategyBoxes().filter((b) => !b.checked);
    expect(unchecked).toHaveLength(5);
    expect(unchecked.every((b) => b.disabled)).toBe(true);
    await user.click(unchecked[0]!);
    expect(strategyBoxes().filter((b) => b.checked)).toHaveLength(5);

    const firstChecked = strategyBoxes().find((b) => b.checked)!;
    await user.click(firstChecked);
    expect(screen.getByText('4/5 selected')).toBeTruthy();
    expect(
      strategyBoxes()
        .filter((b) => !b.checked)
        .every((b) => !b.disabled),
    ).toBe(true);
    // The selection survives a reload.
    expect(localStorage.getItem(SELECTION_STORAGE_KEY)).not.toBeNull();
    const before = strategyBoxes().map((b) => b.checked);
    cleanup();
    render(<App />);
    expect(strategyBoxes().map((b) => b.checked)).toEqual(before);
    expect(screen.getByText('4/5 selected')).toBeTruthy();
  });

  it('Add is disabled once the library holds 10 strategies, and adding the 10th works', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(customs(7)));
    render(<App />);
    const add = () => screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement;
    const allowance = screen.getByRole('spinbutton', { name: /Allow at most X damage per turn/ });
    await userEvent.clear(allowance);
    await userEvent.type(allowance, '20');
    expect(add().disabled).toBe(false);
    await userEvent.click(add());
    expect(strategyBoxes()).toHaveLength(10);
    await userEvent.clear(allowance);
    await userEvent.type(allowance, '21');
    expect(add().disabled).toBe(true);
    expect(screen.getByText(/at most 10 strategies/)).toBeTruthy();
  });

  it('a duplicate (same order and allowance) cannot be added', async () => {
    render(<App />);
    // The form starts at Block (allow 5), Powers, Attack; X = 0 makes it Scared Block.
    const allowance = screen.getByRole('spinbutton', { name: /Allow at most X damage per turn/ });
    await userEvent.clear(allowance);
    await userEvent.type(allowance, '0');
    expect((screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/"Scared Block" already plays Block \(allow 0\), Powers, Attack/)).toBeTruthy();
  });
});

describe('#130 strategy priority order (App)', () => {
  const newList = () => screen.getByRole('list', { name: 'Priority for the new strategy' });
  const groupsIn = (list: HTMLElement) =>
    [...list.querySelectorAll('.order-row .order-name')].map((e) => e.textContent);
  const ranksIn = (list: HTMLElement) => [...list.querySelectorAll('.order-row .order-rank')].map((e) => e.textContent);
  const rowOf = (name: RegExp) => screen.getByRole('checkbox', { name }).closest('li')!;
  const chipsOf = (name: RegExp) => [...rowOf(name).querySelectorAll('.prio-chip')].map((e) => e.textContent);

  it('shows numbered priority chips on every strategy, with allow X on the Block chip unless Block is last', () => {
    render(<App />);
    expect(chipsOf(/Greedy Damage/)).toEqual(['1Attack', '2Powers', '3Block']);
    expect(chipsOf(/Scared Block/)).toEqual(['1Block · allow 0', '2Powers', '3Attack']);
  });

  it('loads strategies saved before #130 as their new orders', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { id: 'u1', name: 'Block, allow 4', config: { kind: 'block', allowThrough: 4 } },
        { id: 'u2', name: 'Old greedy', config: { kind: 'greedyDamage' } },
      ]),
    );
    render(<App />);
    expect(chipsOf(/Block, allow 4/)).toEqual(['1Block · allow 4', '2Powers', '3Attack']);
    expect(chipsOf(/Old greedy/)).toEqual(['1Attack', '2Powers', '3Block']);
  });

  it('reorders with the up/down buttons, then adds with a default title naming the 1st and 2nd priorities', async () => {
    render(<App />);
    const user = userEvent.setup();
    const list = newList();
    expect(groupsIn(list)).toEqual(['Block', 'Powers', 'Attack']);
    expect(ranksIn(list)).toEqual(['1', '2', '3']);
    // Top row can't go up, bottom row can't go down.
    expect((within(list).getByRole('button', { name: 'Move Block up' }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(list).getByRole('button', { name: 'Move Attack down' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(within(list).getByRole('button', { name: 'Move Powers up' }));
    expect(groupsIn(list)).toEqual(['Powers', 'Block', 'Attack']);
    // Focus follows the moved row; at the top its up button is disabled, so the handle gets it.
    expect(document.activeElement).toBe(within(list).getByRole('button', { name: /^Powers, priority 1 of 3/ }));
    expect(screen.getByRole('textbox', { name: 'Title' }).getAttribute('placeholder')).toBe('Powers, Block (allow 5)');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(chipsOf(/^Powers, Block \(allow 5\)$/)).toEqual(['1Powers', '2Block · allow 5', '3Attack']);
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(saved[0]).toMatchObject({
      name: 'Powers, Block (allow 5)',
      config: { order: ['powers', 'block', 'attack'], allowThrough: 5 },
    });
    // The same order and X again is now a duplicate.
    expect((screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('reorders with ArrowUp/ArrowDown on the focused handle, keeping focus and announcing the move', async () => {
    render(<App />);
    const user = userEvent.setup();
    const list = newList();
    within(list)
      .getByRole('button', { name: /^Attack, priority 3 of 3/ })
      .focus();
    await user.keyboard('{ArrowUp}');
    expect(groupsIn(list)).toEqual(['Block', 'Attack', 'Powers']);
    expect(document.activeElement).toBe(within(list).getByRole('button', { name: /^Attack, priority 2 of 3/ }));
    expect(screen.getByText('Attack moved to position 2 of 3.')).toBeTruthy();
    await user.keyboard('{ArrowUp}');
    await user.keyboard('{ArrowUp}'); // already at the top: no change
    expect(groupsIn(list)).toEqual(['Attack', 'Block', 'Powers']);
    await user.keyboard('{ArrowDown}');
    expect(groupsIn(list)).toEqual(['Block', 'Attack', 'Powers']);
  });

  it('moves the allowance with the Block row, and drops it when Block is last', async () => {
    render(<App />);
    const user = userEvent.setup();
    const list = newList();
    await user.click(within(list).getByRole('button', { name: 'Move Block down' }));
    await user.click(within(list).getByRole('button', { name: 'Move Block down' }));
    expect(groupsIn(list)).toEqual(['Powers', 'Attack', 'Block']);
    expect(within(list).queryByRole('spinbutton')).toBeNull();
    expect(within(list).getByText('Spends leftover energy')).toBeTruthy();
    // Attack, Powers, Block (any X) is Greedy Damage.
    await user.click(within(list).getByRole('button', { name: 'Move Attack up' }));
    expect((screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/"Greedy Damage" already plays Attack, Powers, Block/)).toBeTruthy();
    // Block back to the middle: the allowance returns with its old value.
    await user.click(within(list).getByRole('button', { name: 'Move Block up' }));
    expect((within(list).getByRole('spinbutton') as HTMLInputElement).value).toBe('5');
    expect(screen.getByRole('textbox', { name: 'Title' }).getAttribute('placeholder')).toBe('Attack, Block (allow 5)');
  });

  it('reorders by drag and drop on the handle', () => {
    render(<App />);
    const list = newList();
    const handle = within(list).getByRole('button', { name: /^Attack, priority 3/ });
    const rows = list.querySelectorAll('.order-row');
    fireEvent.dragStart(handle);
    expect(rows[2]!.classList.contains('dragging')).toBe(true);
    fireEvent.dragOver(rows[0]!);
    fireEvent.drop(rows[0]!);
    fireEvent.dragEnd(handle);
    expect(groupsIn(list)).toEqual(['Attack', 'Block', 'Powers']);
    expect(list.querySelector('.dragging')).toBeNull();
  });

  it('the pencil opens the same list for a saved strategy; valid edits save, duplicates are refused', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([{ id: 'u1', name: 'Mine', config: { order: ['powers', 'block', 'attack'], allowThrough: 5 } }]),
    );
    render(<App />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Edit Mine' }));
    const list = screen.getByRole('list', { name: 'Priority for Mine' });
    expect(groupsIn(list)).toEqual(['Powers', 'Block', 'Attack']);
    expect((within(list).getByRole('spinbutton') as HTMLInputElement).value).toBe('5');
    await user.click(within(list).getByRole('button', { name: 'Move Attack up' }));
    expect(chipsOf(/^Mine$/)).toEqual(['1Powers', '2Attack', '3Block']);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)[0].config).toEqual({
      order: ['powers', 'attack', 'block'],
      allowThrough: 0,
    });
    // Block first with X 0 is Scared Block: shown as a problem and not saved.
    within(list)
      .getByRole('button', { name: /^Block, priority 3/ })
      .focus();
    await user.keyboard('{ArrowUp}{ArrowUp}');
    await user.click(within(list).getByRole('button', { name: 'Move Attack down' }));
    expect(groupsIn(list)).toEqual(['Block', 'Powers', 'Attack']);
    const allow = within(list).getByRole('spinbutton');
    await user.clear(allow);
    await user.type(allow, '0');
    expect(screen.getByText(/"Scared Block" already plays/)).toBeTruthy();
    expect(chipsOf(/^Mine$/)).toEqual(['1Block · allow 5', '2Powers', '3Attack']);
    await user.type(allow, '7');
    expect(chipsOf(/^Mine$/)).toEqual(['1Block · allow 7', '2Powers', '3Attack']);
    await user.click(screen.getByRole('button', { name: 'Done editing Mine' }));
    expect(screen.queryByRole('list', { name: 'Priority for Mine' })).toBeNull();
  });
});

describe('UI polish (#254)', () => {
  it('the Results seed row has a Generate new seed button that fills the field with a new seed', async () => {
    render(
      <ResultsPanel
        data={gameData}
        characterId="ironclad"
        result={null}
        status={{ kind: 'idle' }}
        blocker={null}
        onRun={() => {}}
      />,
    );
    expect(screen.getByText('Run seed (blank = random)')).toBeTruthy();
    const input = screen.getByPlaceholderText('random') as HTMLInputElement;
    expect(input.value).toBe('');
    const button = screen.getByRole('button', { name: 'Generate new seed', hidden: true }); // Results starts collapsed
    await userEvent.click(button);
    const first = input.value;
    expect(first).toMatch(/^\d+$/);
    expect(Number(first)).toBeLessThanOrEqual(4294967295);
    await userEvent.click(button);
    expect(input.value).toMatch(/^\d+$/);
    expect(input.value).not.toBe(first);
  });

  it('the chart toggles are labelled Colorblind and Percentiles', () => {
    render(<DistributionChart rows={resultRows(result)} />);
    expect(screen.getByLabelText('Colorblind')).toBeTruthy();
    expect(screen.getByLabelText('Percentiles')).toBeTruthy();
  });

  it('deck folders: character and Colorless split into rarity sub-folders; Shared stays flat', () => {
    const { container } = render(<DeckHarness initial={[]} />);
    const top = [...container.querySelectorAll<HTMLDetailsElement>('details.card-group:not(.card-subgroup)')];
    const name = (d: Element) => d.querySelector('summary')!.textContent!.split(' (')[0]!.trim();
    const labels = top.map(name);
    expect(labels).toEqual(expect.arrayContaining(['Shared', 'Ironclad', 'Colorless']));
    const subs = (label: string) =>
      [...top.find((d) => name(d) === label)!.querySelectorAll('details.card-subgroup')].map(name);
    const order = ['Basic', 'Common', 'Uncommon', 'Rare', 'Ancient', 'Event', 'Token'];
    for (const label of ['Ironclad', 'Colorless']) {
      const got = subs(label);
      expect(got.length).toBeGreaterThan(0);
      expect(got).toEqual(order.filter((o) => got.includes(o)));
    }
    expect(subs('Shared')).toEqual([]);
    // All start collapsed.
    expect(container.querySelectorAll('details[open]').length).toBe(0);
  });

  it('enemy, relic and potion lists are alphabetical', () => {
    for (const zone of ['overgrowth', 'hive', 'glory', 'underdocks'] as const) {
      const names = enemiesIn(gameData, zone).map((e) => e.name);
      expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    }
    const relics = selectableRelics(gameData, 'ironclad').map((r) => r.name);
    expect(relics).toEqual([...relics].sort((a, b) => a.localeCompare(b)));
    render(
      <SetupPanel
        data={gameData}
        setup={defaultSetup(gameData)}
        onCharacter={() => {}}
        onEnemy={() => {}}
        onAscension={() => {}}
        onPotions={() => {}}
      />,
    );
    const potionSelect = screen.getByLabelText('Potion 1') as HTMLSelectElement;
    const potions = [...potionSelect.options].slice(1).map((o) => o.textContent!);
    expect(potions.length).toBeGreaterThan(1);
    expect(potions).toEqual([...potions].sort((a, b) => a.localeCompare(b)));
  });

  it('the relic remove button is a plain unstyled button, still labelled', () => {
    render(
      <SetupPanel
        data={gameData}
        setup={defaultSetup(gameData)}
        onCharacter={() => {}}
        onEnemy={() => {}}
        onAscension={() => {}}
        onRelics={() => {}}
      />,
    );
    const remove = screen.getByRole('button', { name: /^Remove / });
    expect(remove.className).toBe('relic-remove');
    expect(remove.textContent).toBe('×');
  });

  it('the top-right version label reads "Slay the Spire 2 <gameVersion>"', () => {
    const { container } = render(<App />);
    expect(container.querySelector('.app-version')!.textContent).toBe(
      `Slay the Spire 2 ${gameData.manifest.gameVersion}`,
    );
  });
});
