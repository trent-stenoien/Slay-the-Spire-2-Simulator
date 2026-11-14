// @vitest-environment jsdom
/** #315: the Starting HP field in the setup panel. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { gameData } from '../../data';
import { GREEDY_CONFIG } from '../../engine/strategies';
import { replayCombat } from '../lib/compare';
import { defaultSetup, type SetupState } from '../lib/url';
import { SetupPanel } from './SetupPanel';

afterEach(cleanup);

function Harness({ onChange }: { onChange?: (s: SetupState) => void }) {
  const [setup, setSetupRaw] = useState<SetupState>(defaultSetup(gameData));
  const setSetup = (s: SetupState) => {
    setSetupRaw(s);
    onChange?.(s);
  };
  return (
    <SetupPanel
      data={gameData}
      setup={setup}
      onCharacter={(id) => {
        const { startHp: _hp, ...rest } = setup;
        setSetup({ ...rest, characterId: id });
      }}
      onEnemy={() => {}}
      onAscension={(a) => setSetup({ ...setup, ascension: a })}
      onStartHp={(startHp) => {
        const { startHp: _hp, ...rest } = setup;
        setSetup(startHp === undefined ? rest : { ...rest, startHp });
      }}
    />
  );
}

const field = () => screen.getByLabelText('Starting HP') as HTMLInputElement;
const type = (text: string) => {
  fireEvent.change(field(), { target: { value: text } });
  fireEvent.blur(field());
};

describe('Starting HP field (#315)', () => {
  it('defaults to the character start HP for the ascension and follows ascension changes', () => {
    render(<Harness />);
    expect(field().value).toBe('80');
    fireEvent.change(screen.getByLabelText('Ascension'), { target: { value: '2' } });
    expect(field().value).toBe('64');
  });

  it('keeps an edited value across ascension changes and Reset returns to the default', () => {
    render(<Harness />);
    type('50');
    fireEvent.change(screen.getByLabelText('Ascension'), { target: { value: '3' } });
    expect(field().value).toBe('50');
    fireEvent.click(screen.getByText('Reset'));
    expect(field().value).toBe('64');
  });

  it('clamps to 1..Max HP and ignores empty input', () => {
    let last: SetupState | undefined;
    render(<Harness onChange={(s) => (last = s)} />);
    type('999');
    expect(field().value).toBe('80');
    type('0');
    expect(field().value).toBe('1');
    expect(last?.startHp).toBe(1);
    type('');
    expect(field().value).toBe('1');
  });

  it('switching character drops the edit and shows that character default', () => {
    render(<Harness />);
    type('50');
    fireEvent.change(screen.getByLabelText('Character'), { target: { value: 'silent' } });
    expect(field().value).toBe(String(gameData.characters.silent!.maxHp));
  });

  it('is passed to the replayed combat (starts at that HP)', () => {
    const setup = { ...defaultSetup(gameData), startHp: 33 };
    const r = replayCombat(gameData, setup, GREEDY_CONFIG, 1);
    expect(r.ok && r.result.log?.[0]).toMatchObject({ t: 'combatStart', playerHp: 33 });
  });
});
