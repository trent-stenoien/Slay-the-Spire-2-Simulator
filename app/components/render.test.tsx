/**
 * Smoke tests: render each view to static HTML (no DOM library needed),
 * using the real engine/stats curves.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { gameData } from '../../data';
import type { Deck, RunResult } from '../../engine/types';
import indexHtml from '../../index.html?raw';
import { App } from '../App';
import { resultRows } from '../lib/results';
import { defaultSetup, type SetupState } from '../lib/url';
import { startingDeckFor } from '../lib/deck';
import { DeckBuilder } from './DeckBuilder';
import { CombatLog } from './CombatLog';
import { DistributionChart } from './DistributionChart';
import { InfoPopover } from './InfoPopover';
import { ResultsPanel, type RunStatus } from './ResultsPanel';
import { ResultsView, ViewCombat } from './ResultsView';
import { SetupPanel } from './SetupPanel';
import { StrategyPanel } from './StrategyPanel';
import { DEFAULT_STRATEGIES } from '../lib/strategyLibrary';
import { GREEDY_CONFIG, blockFirstConfig } from '../../engine/strategies';

const result: RunResult = {
  gameVersion: 'v0.107.1',
  config: {
    characterId: 'ironclad',
    deck: gameData.characters.ironclad!.startingDeck,
    enemyId: 'nibbit',
    ascension: 5,
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

const noop = () => {};
const renderChart = () => renderToStaticMarkup(<DistributionChart rows={resultRows(result)} />);
const renderResults = () => renderToStaticMarkup(<ResultsView data={gameData} result={result} />);
const renderViewCombat = (initialChecked?: string[]) =>
  renderToStaticMarkup(<ViewCombat data={gameData} result={result} combats={10} initialChecked={initialChecked} />);
const renderResultsPanel = (
  status: RunStatus,
  {
    result = null,
    blocker = null,
    characterId = 'ironclad',
  }: { result?: RunResult | null; blocker?: string | null; characterId?: string } = {},
) =>
  renderToStaticMarkup(
    <ResultsPanel
      data={gameData}
      characterId={characterId}
      result={result}
      status={status}
      blocker={blocker}
      onRun={noop}
    />,
  );
const renderDeckBuilder = (characterId: string, ascension: number, deck: Deck) =>
  renderToStaticMarkup(
    <DeckBuilder
      data={gameData}
      characterId={characterId}
      ascension={ascension}
      deck={deck}
      onChange={noop}
      onReset={noop}
    />,
  );
const renderSetupPanel = (setup: SetupState) =>
  renderToStaticMarkup(
    <SetupPanel data={gameData} setup={setup} onCharacter={noop} onEnemy={noop} onAscension={noop} />,
  );

describe('views render', () => {
  it('renders the main page with the Burning Blood note inside the Results panel body, not at the top', () => {
    const html = renderToStaticMarkup(<App />);
    const note = html.indexOf('Burning Blood&#x27;s 6 HP heal is not simulated.');
    expect(note).toBeGreaterThan(html.indexOf('id="res-body"'));
    expect(note).toBeLessThan(html.indexOf('class="grid"'));
    expect(html.match(/is not simulated\./g)).toHaveLength(1);
    expect(html.slice(0, html.indexOf('<main'))).not.toContain('class="note"');
    expect(html).toContain('Greedy Damage');
    expect(html).toContain('Scared Block');
    expect(html).toContain('Deal 8 damage. Apply 2 Vulnerable');
    expect(html).not.toContain('Ascender');
  });

  it('shows the game version alone, in italics, not inside the description', () => {
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain(`<em class="app-version">${gameData.manifest.gameVersion}</em>`);
    expect(html).not.toContain('Game data');
    expect(html).toContain('<p>Monte Carlo comparison of Slay the Spire 2 play strategies.</p>');
  });

  it('puts Results first, collapsed, with the Run button in its title bar and no Run panel', () => {
    const html = renderToStaticMarkup(<App />);
    expect(html.indexOf('id="res-h"')).toBeGreaterThan(-1);
    expect(html.indexOf('id="res-h"')).toBeLessThan(html.indexOf('class="grid"'));
    expect(html).toMatch(/id="res-h"[^>]*><button[^>]*aria-expanded="false"/);
    expect(html).toMatch(/id="res-body"[^>]*hidden/);
    const bar = html.slice(html.indexOf('class="panel-bar"'), html.indexOf('id="res-body"'));
    expect(bar).toContain('Run simulation');
    // The Run button is a sibling of the toggle, not nested in it (or in the h2).
    const toggle = bar.slice(0, bar.indexOf('</h2>'));
    expect(toggle).not.toContain('Run simulation');
    expect(html).not.toContain('id="run-h"');
  });

  it('Results shows the seed input and empty-state text before any run, and blockers in the title bar', () => {
    const html = renderResultsPanel({ kind: 'idle' }, { blocker: 'Select at least one strategy.' });
    expect(html).toContain('Run seed (blank = random)');
    expect(html).toContain('Run a simulation to see the results.');
    expect(html.indexOf('Run seed')).toBeGreaterThan(html.indexOf('id="res-body"'));
    const bar = html.slice(0, html.indexOf('id="res-body"'));
    expect(bar).toContain('Select at least one strategy.');
    expect(bar).toMatch(/<button[^>]*disabled=""[^>]*title="Select at least one strategy."[^>]*>Run simulation/);
  });

  it('Results title bar shows progress and a compact error', () => {
    const running = renderResultsPanel({ kind: 'running', progress: { done: 42, total: 100 } });
    expect(running.slice(0, running.indexOf('id="res-body"'))).toContain('Running… 42%');
    const failed = renderResultsPanel({ kind: 'error', message: 'boom', notImplemented: false }, { result });
    const bar = failed.slice(0, failed.indexOf('id="res-body"'));
    expect(bar).toContain('Run failed');
    expect(bar).toContain('title="Simulation failed: boom"');
    expect(failed).not.toContain('Run a simulation to see the results.');
  });

  it('strategy panel: Title label, New Strategy heading, no description on custom strategies', () => {
    const custom = { id: 'u1', name: 'Mine', config: blockFirstConfig(3) };
    const html = renderToStaticMarkup(
      <StrategyPanel
        library={[...DEFAULT_STRATEGIES, custom]}
        selection={[]}
        storageOk
        powerNames={[]}
        onToggle={noop}
        onColor={noop}
        onAdd={noop}
        onRename={noop}
        onConfig={noop}
        onDelete={noop}
        onClearAll={noop}
      />,
    );
    expect(html).toContain('New Strategy');
    expect(html).not.toContain('New block strategy');
    expect(html).toContain('<span>Title</span>');
    expect(html).not.toContain('<span>Name</span>');
    // #130: every strategy shows its numbered priority chips; no description line any more.
    expect(html).not.toContain('strat-desc');
    expect(html.match(/class="prio-chips"/g)?.length).toBe(DEFAULT_STRATEGIES.length + 1);
    expect(html).toContain(
      '<li class="prio-chip"><b>1</b>Attack</li><li class="prio-chip"><b>2</b>Powers</li><li class="prio-chip"><b>3</b>Block</li>',
    );
    expect(html).toContain('<li class="prio-chip"><b>1</b>Block · allow 3</li>');
  });

  it('Results body shows the starting-relic note for the setup character', () => {
    const silent = gameData.characters.silent!;
    const html = renderResultsPanel({ kind: 'idle' }, { characterId: 'silent' });
    const body = html.slice(html.indexOf('id="res-body"'));
    expect(body).toContain(`${silent.startingRelic} (starting relic) is not simulated.`);
    expect(html).not.toContain('Burning Blood');
  });

  it('renders results with death rate as a percentage, no turn-cap column, and the description line', () => {
    const html = renderResults();
    expect(html).toContain('10.0%');
    expect(html).not.toContain('Turn-cap rate');
    expect(html).not.toContain('20.0%');
    expect(html.match(/<th scope="col">/g)).toHaveLength(5);
    expect(html).not.toContain('v0.107.1');
    expect(html).not.toContain('run seed');
    expect(html).not.toContain('-card deck');
    expect(html).toContain(
      '<p class="muted small">Ironclad vs Nibbit, Ascension 5. 10,000 simulated combats per strategy.</p>',
    );
    expect(html).toContain('<svg');
    // The combat picker defaults to the first listed (lowest HP lost) strategy: Scared Block.
    expect(html).toContain('?v=1&amp;c=I&amp;e=Nb&amp;a=5&amp;d=St5De4Ba1&amp;s=2751716061&amp;st=b0pa');
  });

  it('shows Avg combat turn length over every combat, with no dash for a strategy with no wins', () => {
    const html = renderResults();
    expect(html).toContain('<th scope="col">Avg combat turn length</th>');
    expect(html).not.toContain('Avg turns to kill');
    const table = html.slice(html.indexOf('<table'), html.indexOf('</table>'));
    expect(table).not.toContain('—');
    expect(table).toContain('<td>9.50</td>');
    expect(table).toContain('<td>6.40</td>');
    expect(table).toContain('<td>8.40</td>');
    expect(table).toContain('<td>3.20</td>');
  });

  it('adds a "HP lost, P25-P75" column right after Avg HP lost with en-dash values', () => {
    const html = renderResults();
    const heads = [...html.matchAll(/<th scope="col">([^<]*)<\/th>/g)].map((m) => m[1]);
    expect(heads).toEqual(['Strategy', 'Avg HP lost', 'HP lost, P25-P75', 'Avg combat turn length', 'Death rate']);
    const table = html.slice(html.indexOf('<table'), html.indexOf('</table>'));
    expect(table).toContain('<td>0\u20131</td>'); // Scared Block [4,4,2]
    expect(table).toContain('<td>3\u20134</td>'); // Greedy Damage [0,0,2,3,5]
  });

  it('puts the legend above the chart, as toggle buttons, with the KDE smoothing slider', () => {
    const html = renderChart();
    expect(html.indexOf('class="legend"')).toBeGreaterThan(-1);
    expect(html.indexOf('class="legend"')).toBeLessThan(html.indexOf('<svg class="chart"'));
    expect(html.match(/<button type="button" class="legend-item" aria-pressed="true"/g)).toHaveLength(2);
    expect(html).toContain('type="range"');
    expect(html).toContain('min="0"');
    expect(html).toContain('max="5"');
    expect(html).toContain('value="3"');
    expect(html).toContain('×3.00');
    // Reset is disabled at the ×3 default.
    expect(html).toMatch(/<button type="button" class="btn-link bandwidth-reset small" disabled="">Reset<\/button>/);
  });

  it('aligns the legend with the plot area and renders names for bold-on-hover', () => {
    const html = renderChart();
    // Picker, smoothing row and legend sit in one block inset to the Y axis.
    expect(html).toContain('class="chart-controls" style="padding-left:8.125%"');
    expect(html.indexOf('class="chart-controls"')).toBeLessThan(html.indexOf('class="segmented"'));
    expect(html.indexOf('class="legend"')).toBeLessThan(html.indexOf('</div><svg class="chart"'));
    expect(html).toContain('class="legend" aria-label="Strategies (click to show or hide)"');
    expect(html).toContain('<span class="legend-name" data-text="Scared Block">Scared Block</span>');
  });

  it('draws percentile marks for each of two visible strategies, in their colors, with a P25-P75 band each', () => {
    const html = renderChart();
    expect(html.match(/class="pmark"/g)).toHaveLength(6); // equal values share a line and label
    expect(html.match(/class="pmark-label"/g)).toHaveLength(6);
    expect(html.match(/class="pband"/g)).toHaveLength(2);
    expect(html).toContain('--mark-color:#8a5cd6');
    expect(html).toContain('--mark-color:#2f6fdf');
    expect(html).toMatch(/class="pband"[^>]*fill="#8a5cd6"[^>]*clip-path="url\(#[^)]*-above-1\)"/);
    expect(html.match(/class="pband"[^>]*fill-opacity="0.075"/g)).toHaveLength(2);
  });

  it('still draws percentile marks with three visible strategies, one label row each', () => {
    const rows = resultRows(result);
    const third = { ...rows[0]!, strategyId: 'x', name: 'Third', color: 'green' as const };
    const html = renderToStaticMarkup(<DistributionChart rows={[...rows, third]} />);
    expect(html.match(/class="pband"/g)).toHaveLength(3);
    const ys = new Set([...html.matchAll(/class="pmark-label" x="[^"]*" y="([^"]*)"/g)].map((m) => m[1]));
    expect(ys.size).toBe(3);
  });

  it('puts all of a strategy\'s labels on one line and has a Show Percentiles checkbox, on by default', () => {
    const html = renderChart();
    const ys = [...html.matchAll(/class="pmark-label" x="[^"]*" y="([^"]*)"/g)].map((m) => m[1]);
    expect(new Set(ys).size).toBe(2);
    expect(html).toMatch(/class="pct-toggle small"><input type="checkbox" checked=""[^>]*\/>Show Percentiles/);
  });

  it('draws five labelled percentile markers when only one strategy is in the results', () => {
    const one = resultRows(result).filter((r) => r.strategyId === 'g'); // [0, 0, 2, 3, 5]: 10 combats
    const html = renderToStaticMarkup(<DistributionChart rows={one} />);
    expect(html.match(/class="pmark"/g)).toHaveLength(3);
    expect(html.match(/class="pband"/g)).toHaveLength(1);
    // Equal values share a label.
    for (const label of ['P5 = 2', 'P25–P50 = 3', 'P75–P95 = 4']) expect(html).toContain(`>${label}</text>`);
  });

  it('has no Raw view button: only Smoothed (KDE) and Cumulative', () => {
    const html = renderChart();
    const tabs = [...html.matchAll(/role="tab"[^>]*>([^<]*)</g)].map((m) => m[1]);
    expect(tabs).toEqual(['Smoothed (KDE)', 'Cumulative']);
  });

  it('labels the smoothing slider at its min (Raw), ×1-×4 and its max (×5)', () => {
    const html = renderChart();
    for (const l of ['Raw', '×1', '×2', '×3', '×4', '×5'])
      expect(html).toMatch(new RegExp(`class="bandwidth-tick" style="--f:[0-9.]+">${l}</span>`));
    expect(html.match(/class="bandwidth-tick"/g)).toHaveLength(6);
    expect(html).toMatch(/<option value="0" label="Raw">/);
    expect(html).toMatch(/<option value="5" label="×5">/);
  });

  it('has a closed info button next to Smoothing', () => {
    const html = renderChart();
    expect(html).toMatch(
      /Smoothing<\/label><span class="info-pop"><button[^>]*aria-label="About smoothing"[^>]*aria-expanded="false"/,
    );
    expect(html).not.toContain('info-pop-card');
  });

  it('renders the open info popover with the explanation and a safe new-tab KDE link', () => {
    const html = renderToStaticMarkup(<InfoPopover defaultOpen />);
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('left shows more detail');
    expect(html).toContain('smooths the curve more');
    expect(html).toContain(
      'href="https://en.wikipedia.org/wiki/Kernel_density_estimation" target="_blank" rel="noopener noreferrer"',
    );
  });

  it('lists strategies by avg HP lost, lowest first, in table, legend and chart, keeping colors', () => {
    const html = renderResults();
    expect(html.indexOf('Scared Block')).toBeLessThan(html.indexOf('Greedy Damage'));
    // Chart series (purple = Scared Block, blue = Greedy Damage) and legend follow the same order.
    expect(html.indexOf('stroke="#8a5cd6"')).toBeLessThan(html.indexOf('stroke="#2f6fdf"'));
    const legend = html.slice(html.indexOf('class="legend"'));
    expect(legend.indexOf('Scared Block')).toBeLessThan(legend.indexOf('Greedy Damage'));
  });

  it('draws one line and one 15% fill per strategy in run colors', () => {
    const html = renderChart();
    expect(html.match(/fill-opacity="0.15"/g)).toHaveLength(2);
    expect(html).toContain('stroke="#2f6fdf"');
    expect(html).toContain('stroke="#8a5cd6"');
    expect(html).toContain('HP lost');
  });

  it('draws a 15% fill path per visible strategy in the Cumulative view, with the P25-P75 band kept above the curve', () => {
    const rows = resultRows(result);
    const html = renderToStaticMarkup(<DistributionChart rows={rows} initialMode="cumulative" />);
    expect(html).toContain('aria-label="HP lost distribution, cumulative view"');
    expect(html.match(/<path class="curve-fill"[^>]*fill-opacity="0.15"/g)).toHaveLength(2);
    expect(html).toMatch(/class="curve-fill"[^>]*fill="#8a5cd6"/);
    expect(html).toMatch(/class="curve-fill"[^>]*fill="#2f6fdf"/);
    // Fills sit inside the clipped group, so X-range clipping applies to them too.
    const clipped = html.slice(html.indexOf('<g clip-path'));
    expect(clipped.match(/class="curve-fill"/g)).toHaveLength(2);
    expect(html.match(/class="pband"/g)).toHaveLength(2);
    expect(html.match(/-above-\d\)/g)).toHaveLength(2);
  });

  it('draws one Cumulative fill when only one strategy is shown', () => {
    const rows = resultRows(result);
    const one = rows.slice(0, 1);
    const html = renderToStaticMarkup(<DistributionChart rows={one} initialMode="cumulative" />);
    expect(html.match(/class="curve-fill"/g)).toHaveLength(1);
  });

  it('renders a combat log with intent', () => {
    const html = renderToStaticMarkup(
      <CombatLog
        data={gameData}
        setup={defaultSetup(gameData)}
        target={{ seed: 123456, strategies: [blockFirstConfig(4)] }}
      />,
    );
    expect(html).toContain('Turn');
    expect(html).toContain('Enemy Intent: Butt (12 damage)');
    expect(html).toContain('<h4>Your Turn</h4>');
    expect(html).toContain('<h4>Enemy Turn');
    expect(html).toContain('phase phase-you phase-ironclad');
    expect(html).toContain('phase phase-enemy');
    expect(html).toContain('Combat Log');
    expect(html).not.toContain('Combat log');
    expect(html).toContain('Ascension 0');
    expect(html).not.toMatch(/\bA0\b/);
    expect(html).not.toContain('Combat #');
    expect(html).toMatch(/Won|Died|turn cap/);
  });

  it('shows the 1-based combat number on the log page when the link carries it', () => {
    const html = renderToStaticMarkup(
      <CombatLog
        data={gameData}
        setup={defaultSetup(gameData)}
        target={{ seed: 123456, strategies: [blockFirstConfig(4)], combatIndex: 0 }}
      />,
    );
    expect(html).toContain('Combat #1');
  });

  it('labels the combat picker 1-10000 and links the 0-based index', () => {
    const html = renderResults();
    const combats = resultRows(result)[0]!.summary.combats;
    expect(html).toContain(`Combat # (1-${combats})`);
    expect(html).not.toContain('(0–');
    expect(html).toMatch(/href="[^"]*&amp;n=0"/);
  });

  it('lists a checkbox per strategy; one checked opens the combat log', () => {
    const html = renderViewCombat();
    expect(html.match(/type="checkbox"/g)).toHaveLength(2);
    expect(html).not.toContain('<select');
    expect(html).toContain('>Open combat log</a>');
    expect(html).toMatch(/href="[^"]*&amp;st=b0pa&amp;n=0"/); // sorted first: Scared Block, no k for one strategy
  });

  it('reads Compare with 2+ checked and links every checked strategy with its color', () => {
    const html = renderViewCombat(['g', 's']);
    expect(html).toContain('>Compare</a>');
    expect(html).toMatch(/href="[^"]*&amp;st=b0pa,apb&amp;k=p,b&amp;n=0"/);
  });

  it('disables the button with nothing checked', () => {
    const html = renderViewCombat([]);
    expect(html).toContain('aria-disabled="true"');
    expect(html).not.toContain('</a>');
  });

  it('renders the compare view: one column per strategy on the same turn, with name, color and outcome', () => {
    const html = renderToStaticMarkup(
      <CombatLog
        data={gameData}
        setup={defaultSetup(gameData)}
        target={{
          seed: 123456,
          strategies: [GREEDY_CONFIG, blockFirstConfig(0), blockFirstConfig(5)],
          colors: ['blue', 'red', 'green'],
          combatIndex: 4,
        }}
      />,
    );
    expect(html).toContain('Combat #5');
    expect(html.match(/class="compare-col"/g)).toHaveLength(3);
    expect(html.match(/class="turn-nav"/g)).toHaveLength(1);
    expect(html.match(/<h4>Your Turn<\/h4>/g)).toHaveLength(3);
    expect(html.match(/Enemy Intent: /g)).toHaveLength(3);
    expect(html).toContain('Greedy Damage');
    expect(html).toContain('Scared Block');
    expect(html).toContain('#2f6fdf');
    expect(html).toContain('#d6453d');
    expect(html.match(/(Won|Died|Hit the turn cap) on turn \d+, lost \d+ HP/g)).toHaveLength(3);
  });

  it('rescales the Y axis to the visible strategies only', () => {
    // 'tall': 100 combats all at 20 HP (a high peak). 'flat': 1 combat at each of 0-40 HP (a low curve).
    const summary = (strategyId: string, hpLostCounts: number[]) => ({
      strategyId,
      combats: hpLostCounts.reduce((a, b) => a + b, 0),
      avgHpLost: 0,
      avgTurnsToKill: null,
      avgTurns: 1,
      avgGold: 0,
      potionRate: 0,
      deathRate: 0,
      turnCapRate: 0,
      hpLostCounts,
      firstCombatByHpLost: {},
    });
    const rows = resultRows({
      ...result,
      config: {
        ...result.config,
        strategies: [
          { strategy: { id: 'tall', name: 'Tall', config: GREEDY_CONFIG }, color: 'blue' },
          { strategy: { id: 'flat', name: 'Flat', config: blockFirstConfig(0) }, color: 'red' },
        ],
      },
      summaries: [summary('tall', [...Array(20).fill(0), 100]), summary('flat', Array(41).fill(1))],
    });
    const yMax = (hidden: Set<string>) => {
      const html = renderToStaticMarkup(<DistributionChart rows={rows} hidden={hidden} />);
      const labels = [...html.matchAll(/<text class="tick"[^>]*text-anchor="end"[^>]*>([\d.]+)%<\/text>/g)].map((m) =>
        Number(m[1]),
      );
      expect(labels.length).toBeGreaterThan(1);
      return Math.max(...labels);
    };
    const both = yMax(new Set());
    expect(yMax(new Set(['tall']))).toBeLessThan(both);
    expect(yMax(new Set(['flat']))).toBe(both);
  });

  it('links percentile labels to the first combat with that HP lost', () => {
    // One strategy shown: Greedy's labels carry only its own id (P75 = 4).
    const one = renderToStaticMarkup(
      <DistributionChart
        rows={resultRows(result)}
        hidden={new Set(['s'])}
        percentileHref={(ids, id, hp) => `#${ids.join('+')}/${id}/${hp}`}
      />,
    );
    expect(one.match(/class="pmark-link"/g)).toHaveLength(3); // P25-50 share a label
    expect(one).toContain('href="#g/g/4"');
    expect(one).toContain('href="#g/g/3"');
    // ResultsView builds the real links: two strategies shown, so each label opens the compare view.
    const html = renderResults();
    expect(html.match(/class="pmark-link"/g)).toHaveLength(6);
    // Greedy P75 = 4 -> first combat index 1; Greedy P50 = 3 and Scared P50 = 1 -> index 0. Both strategies, in chart order.
    expect(html).toMatch(/class="pmark-link" href="[^"]*&amp;st=b0pa,apb&amp;k=p,b&amp;n=1"/);
    expect(html).toMatch(/class="pmark-link" href="[^"]*&amp;st=b0pa,apb&amp;k=p,b&amp;n=0"/);
  });

  it('marks characters with unsimulated starters as work in progress', () => {
    const html = renderSetupPanel(defaultSetup(gameData));
    const option = (id: string) => html.match(new RegExp(`<option value="${id}"[^>]*>([^<]*)</option>`))?.[1];
    expect(option('ironclad')).toBe(gameData.characters.ironclad!.name);
    expect(option('silent')).toBe(`${gameData.characters.silent!.name} (work in progress)`);
  });

  it('tints deck rows with the same key as the cost circle', () => {
    const html = renderDeckBuilder('silent', 0, []);
    expect(html).toContain('row-silent');
    const rows = [...html.matchAll(/<li class="card-row row-(\w+)[^"]*">.*?<span class="cost cost-(\w+)"/g)];
    expect(rows.length).toBeGreaterThan(0);
    for (const [, row, cost] of rows) expect(row).toBe(cost);
  });

  it('shows the remove-all X only for cards that have copies in the deck', () => {
    const html = renderDeckBuilder('ironclad', 5, startingDeckFor(gameData, 'ironclad'));
    expect(html).toContain('aria-label="Remove all Strike from deck"');
    expect(html).toContain('title="Remove all Defend from deck"');
    expect(html).not.toContain('Remove all Anger from deck');
    expect(html).not.toContain('Remove all Ascender');
    const upgradedOnly = renderDeckBuilder('ironclad', 0, [{ cardId: 'strike', upgraded: true, count: 1 }]);
    expect(upgradedOnly).toContain('Remove all Strike from deck');
    expect(upgradedOnly).not.toContain('Remove all Defend from deck');
  });

  it("shows Ascender's Bane locked in the Curses group at A5, not at A4, and drops the old setup note", () => {
    const render = (ascension: number) =>
      renderDeckBuilder('ironclad', ascension, startingDeckFor(gameData, 'ironclad'));
    const a5 = render(5);
    expect(a5).toContain('Ascender&#x27;s Bane');
    expect(a5).toContain('Added automatically at Ascension 5+');
    expect(a5).toContain('(11 cards)');
    expect(a5).toContain('1 in deck');
    expect(a5).not.toContain('Add one standard Ascender');
    const a4 = render(4);
    expect(a4).not.toContain('Ascender');
    expect(a4).toContain('(10 cards)');
    const setup = renderSetupPanel({ ...defaultSetup(gameData), ascension: 5 });
    expect(setup).not.toContain('Ascender');
  });
});

describe('deck folders, links and page layout', () => {
  const deckHtml = () => renderDeckBuilder('ironclad', 0, startingDeckFor(gameData, 'ironclad'));

  it('renders every card folder collapsed on load', () => {
    const html = deckHtml();
    const tags = [...html.matchAll(/<details[^>]*>/g)].map((m) => m[0]);
    expect(tags.length).toBeGreaterThan(1);
    for (const tag of tags) expect(tag).not.toMatch(/\sopen/);
  });

  it('links each card name to its wiki page in a new tab', () => {
    const html = deckHtml();
    expect(html).toContain(
      '<a href="https://slaythespire.wiki.gg/wiki/Slay_the_Spire_2:Bludgeon" target="_blank" rel="noopener noreferrer"',
    );
    // The clear-X stays a sibling of the name, not inside the link.
    expect(html).not.toMatch(/<a [^>]*>[^<]*<button/);
  });

  it('puts Setup in the right column above Strategies, with Deck on the left', () => {
    const html = renderToStaticMarkup(<App />);
    const left = html.indexOf('col col-deck');
    const right = html.indexOf('col col-side');
    expect(left).toBeGreaterThan(-1);
    expect(right).toBeGreaterThan(left);
    const at = (id: string) => html.indexOf(`id="${id}-h"`);
    expect(at('deck')).toBeGreaterThan(left);
    expect(at('deck')).toBeLessThan(right);
    expect(at('setup')).toBeGreaterThan(right);
    expect(at('strat')).toBeGreaterThan(at('setup'));
  });

  it('titles the page "Slay the Spire 2" but leaves the browser tab title alone', () => {
    const html = renderToStaticMarkup(<App />);
    expect(html).toMatch(/<h1><a [^>]*>Slay the Spire 2<\/a><\/h1>/);
    expect(html).not.toContain('STS2 Combat Simulator');
    expect(indexHtml).toContain('<title>STS2 Combat Simulator</title>');
  });
});
