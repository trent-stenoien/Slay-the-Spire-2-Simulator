// @vitest-environment jsdom
/** #5: multi-enemy setup, links, results text, combat log, and the per-strategy target priority control. */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { gameData } from '../../data';
import { GREEDY_CONFIG } from '../../engine/strategies';
import type { GameEvent, RunConfig, StrategyConfig } from '../../engine/types';
import { multiIntent, replayCombat } from '../lib/compare';
import { buildReplay, enemyIntentLabel } from '../lib/logReplay';
import { describeRun, enemyNames } from '../lib/results';
import { defaultName, describeConfig } from '../lib/strategyLibrary';
import { buildQuery, defaultSetup, enemyIdsField, parseQuery, setupEnemyIds, type SetupState } from '../lib/url';
import { SetupPanel } from './SetupPanel';
import { StrategyPanel } from './StrategyPanel';

const data = gameData;
const noop = () => {};
const two: SetupState = { ...defaultSetup(data), enemyId: 'nibbit', extraEnemyIds: ['seapunk'] };

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('#5 setup and links', () => {
  it('a several-enemy setup round-trips through the link (one code per enemy)', () => {
    const q = buildQuery(data, two);
    const codes = data.enemies.nibbit!.code + data.enemies.seapunk!.code;
    expect(q).toContain(`e=${codes}`);
    const back = parseQuery(data, `?${q}`);
    expect(back.errors).toEqual([]);
    expect(setupEnemyIds(back.setup)).toEqual(['nibbit', 'seapunk']);
  });

  it('old one-enemy links are unchanged and parse without extra enemies', () => {
    const one = defaultSetup(data);
    expect(buildQuery(data, one)).toContain(`e=${data.enemies.nibbit!.code}&`);
    expect(parseQuery(data, `?${buildQuery(data, one)}`).setup.extraEnemyIds).toBeUndefined();
    expect(enemyIdsField(one)).toEqual({});
    expect(enemyIdsField(two)).toEqual({ enemyIds: ['nibbit', 'seapunk'] });
  });

  it('an unknown code or too many enemies is an error', () => {
    const nb = data.enemies.nibbit!.code;
    expect(parseQuery(data, `?e=${nb}Q?`).errors[0]).toMatch(/Unknown enemy code "Q\?"/);
    expect(parseQuery(data, `?e=${nb.repeat(6)}`).errors[0]).toMatch(/At most 5 enemies/);
  });

  it('the setup panel adds, changes and removes extra enemies', () => {
    function Harness() {
      const [setup, setSetup] = useState<SetupState>(defaultSetup(data));
      return (
        <>
          <SetupPanel
            data={data}
            setup={setup}
            onCharacter={noop}
            onEnemy={noop}
            onAscension={noop}
            onExtraEnemies={(ids) => setSetup({ ...setup, extraEnemyIds: ids })}
          />
          <output data-testid="ids">{setupEnemyIds(setup).join(',')}</output>
        </>
      );
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Add enemy' }));
    const first = Object.values(data.enemies).sort((a, b) => a.act - b.act || a.name.localeCompare(b.name))[0]!;
    expect(screen.getByTestId('ids').textContent).toBe(`nibbit,${first.id}`);
    fireEvent.change(screen.getByLabelText(/Enemy 2/), { target: { value: 'seapunk' } });
    expect(screen.getByTestId('ids').textContent).toBe('nibbit,seapunk');
    fireEvent.click(screen.getByRole('button', { name: 'Remove enemy 2' }));
    expect(screen.getByTestId('ids').textContent).toBe('nibbit');
  });
});

describe('#5 results and log text', () => {
  it('joins enemy names in the run description (#80)', () => {
    expect(enemyNames(data, ['nibbit'])).toBe('Nibbit');
    expect(enemyNames(data, ['nibbit', 'seapunk', 'vantom'])).toBe('Nibbit, Seapunk and Vantom');
    const cfg: RunConfig = {
      characterId: 'ironclad',
      deck: [],
      enemyId: 'nibbit',
      enemyIds: ['nibbit', 'seapunk'],
      ascension: 3,
      strategies: [],
      runSeed: 1,
    };
    expect(describeRun(data, cfg)).toMatch(/^Ironclad vs Nibbit and Seapunk, Ascension 3\./);
  });

  it('the log replay keeps one snapshot per enemy, following target events', () => {
    const log: GameEvent[] = [
      { t: 'combatStart', seed: 1, enemyHp: 20, playerHp: 80, enemyHps: [20, 12] },
      { t: 'turnStart', turn: 1, side: 'player' },
      { t: 'target', enemy: 1 },
      { t: 'damage', source: 'player', target: 'enemy', amount: 6, blocked: 0, hpLoss: 6 },
      { t: 'turnStart', turn: 1, side: 'enemy' },
      { t: 'target', enemy: 0 },
      { t: 'enemyMove', moveId: 'a', name: 'Bite' },
      { t: 'target', enemy: 1 },
      { t: 'enemyMove', moveId: 'b', name: 'Spit' },
      { t: 'turnEnd', turn: 1, side: 'enemy' },
    ];
    const r = buildReplay(log).rounds[0]!;
    expect(r.end.enemies.map((e) => e.hp)).toEqual([20, 6]);
    expect(r.start.enemies.map((e) => e.maxHp)).toEqual([20, 12]);
    expect(r.enemyMove).toBe('Bite + Spit');
  });

  it('a several-enemy intent names every living enemy move and the total incoming damage', () => {
    const i = (name: string, n: number) => ({
      moveId: name,
      name,
      attacks: [{ damagePerHit: n, hits: 1 }],
      totalIncoming: n,
    });
    const m = multiIntent([i('Bite', 5), i('Spit', 3), i('Gone', 9)], [{ hp: 1 }, { hp: 1 }, { hp: 0 }]);
    expect(enemyIntentLabel(m)).toBe('Enemy Intent: Bite + Spit (8 damage in all)');
  });

  it('replays a several-enemy combat for the log view with every enemy shown', () => {
    const out = replayCombat(data, two, GREEDY_CONFIG, 7);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.replay.rounds[0]!.start.enemies).toHaveLength(2);
    expect(out.intents[0]?.intent.name).toContain(' + ');
  });
});

describe('#5 target priority per strategy (Trent)', () => {
  const big: StrategyConfig = { ...GREEDY_CONFIG, target: 'biggestAttack' };

  it('names and descriptions mention a non-default target', () => {
    expect(describeConfig(GREEDY_CONFIG)).not.toMatch(/target/);
    expect(describeConfig(big)).toMatch(/target biggest attack$/);
    expect(defaultName(big)).toMatch(/target biggest attack$/);
  });

  it('the new-strategy form saves the picked target priority', () => {
    let added: StrategyConfig | null = null;
    render(
      <StrategyPanel
        library={[]}
        selection={[]}
        storageOk
        powerNames={[]}
        onToggle={noop}
        onColor={noop}
        onAdd={(_, c) => (added = c)}
        onRename={noop}
        onConfig={noop}
        onDelete={noop}
        onClearAll={noop}
      />,
    );
    const select = screen.getByLabelText('Target priority for the new strategy') as HTMLSelectElement;
    expect(select.value).toBe('lowestHp');
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Lowest HP first', 'Biggest incoming attack first']);
    fireEvent.change(select, { target: { value: 'biggestAttack' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(added).toMatchObject({ target: 'biggestAttack' });
  });

  it('a saved strategy shows its target and can change it', () => {
    let changed: StrategyConfig | null = null;
    render(
      <StrategyPanel
        library={[{ id: 'u1', name: 'Mine', config: big }]}
        selection={[]}
        storageOk
        powerNames={[]}
        onToggle={noop}
        onColor={noop}
        onAdd={noop}
        onRename={noop}
        onConfig={(_, c) => (changed = c)}
        onDelete={noop}
        onClearAll={noop}
      />,
    );
    expect(screen.getByText('target biggest attack')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Mine' }));
    fireEvent.change(screen.getByLabelText('Target priority for Mine'), { target: { value: 'lowestHp' } });
    expect(changed).toEqual(GREEDY_CONFIG);
  });
});
