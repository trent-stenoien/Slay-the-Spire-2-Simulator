import type { EnemyDef, GameData, RelicSetup, Zone } from '../../engine/types';
import { isCharacterSimulated } from '../lib/deck';
import { selectableRelics, setupRelics } from '../lib/relics';
import { Panel } from './Panel';
import { MAX_ASCENSION, MAX_POTIONS, type SetupState } from '../lib/url';

interface Props {
  data: GameData;
  setup: SetupState;
  onCharacter: (characterId: string) => void;
  onEnemy: (enemyId: string) => void;
  onAscension: (ascension: number) => void;
  /** #204: potion ids in slot order (empty slots dropped). */
  onPotions?: (potions: string[]) => void;
  /** #205: relics in play (the picker shows only when this is set). */
  onRelics?: (relics: RelicSetup[]) => void;
}

/** Biomes by Act, in game order. Act 1 has two alternatives. */
export const ZONES: { act: number; zone: Zone; label: string }[] = [
  { act: 1, zone: 'overgrowth', label: 'Overgrowth' },
  { act: 1, zone: 'underdocks', label: 'Underdocks' },
  { act: 2, zone: 'hive', label: 'Hive' },
  { act: 3, zone: 'glory', label: 'Glory' },
];
const ACTS = [1, 2, 3];

/** Appended to characters whose starting deck is not fully simulated. */
export const WIP_SUFFIX = ' (work in progress)';

/** Enemies in one biome, alphabetical by name. */
export function enemiesIn(data: GameData, zone: Zone): EnemyDef[] {
  return Object.values(data.enemies)
    .filter((e) => e.zone === zone)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * #205 Relics in play: the chosen list (starting relic by default), each removable, with Girya's
 * Strength picker, and a select that adds any other simulated relic.
 */
export function RelicPicker({
  data,
  setup,
  onRelics,
}: {
  data: GameData;
  setup: Props['setup'];
  onRelics: (relics: RelicSetup[]) => void;
}) {
  const chosen = setupRelics(data, setup);
  const options = selectableRelics(data, setup.characterId).filter((r) => !chosen.some((c) => c.relicId === r.id));
  const setChoice = (i: number, choice: number) =>
    onRelics(chosen.map((r, j) => (j === i ? { relicId: r.relicId, choice } : r)));
  return (
    <div className="field relic-picker">
      <span>Relics</span>
      <ul className="relic-list">
        {chosen.length === 0 && <li className="muted small">None</li>}
        {chosen.map((r, i) => {
          const def = data.relics?.[r.relicId];
          if (!def) return null;
          return (
            <li key={r.relicId} title={def.description}>
              <span>{def.name}</span>
              {def.choice && (
                <select
                  aria-label={`${def.name}: ${def.choice.label}`}
                  value={r.choice ?? def.choice.default}
                  onChange={(e) => setChoice(i, Number(e.target.value))}
                >
                  {def.choice.values.map((v) => (
                    <option key={v} value={v}>
                      {def.choice!.label} {v}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                className="relic-remove"
                aria-label={`Remove ${def.name}`}
                onClick={() => onRelics(chosen.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>
      <select
        aria-label="Add a relic"
        value=""
        onChange={(e) => {
          const def = data.relics?.[e.target.value];
          if (!def) return;
          const added: RelicSetup = def.choice ? { relicId: def.id, choice: def.choice.default } : { relicId: def.id };
          onRelics([...chosen, added]);
        }}
      >
        <option value="">Add a relic…</option>
        {options.map((r) => (
          <option key={r.id} value={r.id} title={r.description}>
            {r.name} ({r.rarity})
          </option>
        ))}
      </select>
    </div>
  );
}

/** Character, Act, biome, enemy, Ascension and relic pickers. */
export function SetupPanel({ data, setup, onCharacter, onEnemy, onAscension, onPotions, onRelics }: Props) {
  const order = ['I', 'S', 'R', 'N', 'D']; // in-game order
  const characters = Object.values(data.characters).sort((a, b) => order.indexOf(a.code) - order.indexOf(b.code));
  const current = data.enemies[setup.enemyId];
  const zone = current?.zone ?? 'overgrowth';
  const act = ZONES.find((z) => z.zone === zone)?.act ?? 1;
  const enemies = enemiesIn(data, zone);
  const hasEnemies = (z: Zone) => enemiesIn(data, z).length > 0;
  /** Switching biome picks its first enemy. */
  const pickZone = (z: Zone) => {
    const first = enemiesIn(data, z)[0];
    if (first) onEnemy(first.id);
  };
  const pickAct = (a: number) => {
    const z = ZONES.find((x) => x.act === a && hasEnemies(x.zone));
    if (z) pickZone(z.zone);
  };

  return (
    <Panel id="setup" title="Setup">
      <div className="field-row">
        <label className="field">
          <span>Character</span>
          <select value={setup.characterId} onChange={(e) => onCharacter(e.target.value)}>
            {characters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {isCharacterSimulated(data, c) ? '' : WIP_SUFFIX}
              </option>
            ))}
          </select>
        </label>
        <label className="field field-narrow">
          <span>Ascension</span>
          <select value={setup.ascension} onChange={(e) => onAscension(Number(e.target.value))}>
            {Array.from({ length: MAX_ASCENSION + 1 }, (_, i) => (
              <option key={i} value={i}>
                A{i}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="field-row">
        <label className="field field-narrow">
          <span>Act</span>
          <select value={act} onChange={(e) => pickAct(Number(e.target.value))}>
            {ACTS.map((a) => (
              <option key={a} value={a} disabled={!ZONES.some((z) => z.act === a && hasEnemies(z.zone))}>
                Act {a}
              </option>
            ))}
          </select>
        </label>
        <label className="field field-narrow">
          <span>Biome</span>
          <select value={zone} onChange={(e) => pickZone(e.target.value as Zone)}>
            {ZONES.filter((z) => z.act === act).map((z) => (
              <option key={z.zone} value={z.zone} disabled={!hasEnemies(z.zone)}>
                {z.label}
                {hasEnemies(z.zone) ? '' : ' (no enemies yet)'}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Enemy</span>
          <select value={setup.enemyId} onChange={(e) => onEnemy(e.target.value)}>
            {enemies.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} ({e.difficulty})
              </option>
            ))}
          </select>
        </label>
      </div>
      {onRelics && <RelicPicker data={data} setup={setup} onRelics={onRelics} />}
      {onPotions && (data.potions ? Object.keys(data.potions).length > 0 : false) && (
        <div className="field-row">
          {Array.from({ length: MAX_POTIONS }, (_, slot) => (
            <label className="field field-narrow" key={slot}>
              <span>Potion {slot + 1}</span>
              <select
                value={setup.potions?.[slot] ?? ''}
                onChange={(e) => {
                  const slots = Array.from({ length: MAX_POTIONS }, (_, i) => setup.potions?.[i] ?? '');
                  slots[slot] = e.target.value;
                  onPotions(slots.filter((id) => id !== ''));
                }}
              >
                <option value="">None</option>
                {Object.values(data.potions ?? {})
                  .filter((p) => p.simulated)
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
          ))}
        </div>
      )}
    </Panel>
  );
}
