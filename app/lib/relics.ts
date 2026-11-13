/**
 * #205 Relic setup: the character's starting relic by default, the picker's list, and the URL
 * encoding (`r` = relic codes joined by ",", each followed by its setup choice when it has one:
 * "BB,Gy3"; an empty `r=` means no relics).
 */
import type { GameData, RelicDef, RelicSetup } from '../../engine/types';

/** The character's starting relic (CharacterDef.startingRelic matched by name), when it is simulated. */
export function startingRelics(data: GameData, characterId: string): RelicSetup[] {
  const name = data.characters[characterId]?.startingRelic;
  const relic = Object.values(data.relics ?? {}).find((r) => r.name === name && r.simulated);
  return relic ? [{ relicId: relic.id }] : [];
}

/** The relics a setup uses: its own list, or the starting relic when it has none set. */
export function setupRelics(data: GameData, setup: { characterId: string; relics?: RelicSetup[] }): RelicSetup[] {
  return setup.relics ?? startingRelics(data, setup.characterId);
}

/** Relics the picker offers: simulated, for any character or this one, alphabetical. */
export function selectableRelics(data: GameData, characterId: string): RelicDef[] {
  const code = data.characters[characterId]?.code;
  return Object.values(data.relics ?? {})
    .filter((r) => r.simulated && (r.character === 'any' || r.character === code))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** True when two relic lists are the same (order and choices included). */
export function sameRelics(a: readonly RelicSetup[], b: readonly RelicSetup[]): boolean {
  return a.length === b.length && a.every((r, i) => r.relicId === b[i]!.relicId && r.choice === b[i]!.choice);
}

/** "BB,Gy3": codes in pick order, each with its choice when the relic has one. */
export function encodeRelics(data: GameData, relics: readonly RelicSetup[]): string {
  return relics
    .map((r) => {
      const def = data.relics?.[r.relicId];
      if (!def) throw new Error(`Unknown relic id "${r.relicId}"`);
      return def.choice ? `${def.code}${r.choice ?? def.choice.default}` : def.code;
    })
    .join(',');
}

export type RelicParseResult = { ok: true; relics: RelicSetup[] } | { ok: false; error: string };

/** Parse `r`. Unknown codes, duplicates, unsimulated relics and bad choices are errors. */
export function decodeRelics(data: GameData, text: string): RelicParseResult {
  if (text === '') return { ok: true, relics: [] };
  const byCode = new Map(Object.values(data.relics ?? {}).map((r) => [r.code, r]));
  const relics: RelicSetup[] = [];
  for (const part of text.split(',')) {
    const m = /^([A-Za-z0-9]{2})(\d+)?$/.exec(part);
    const def = m ? byCode.get(m[1]!) : undefined;
    if (!m || !def) return { ok: false, error: `Unknown relic code "${part}"` };
    if (!def.simulated) return { ok: false, error: `Relic ${def.name} is not simulated yet` };
    if (relics.some((r) => r.relicId === def.id)) return { ok: false, error: `Relic ${def.name} is listed twice` };
    if (def.choice) {
      const choice = m[2] === undefined ? def.choice.default : Number(m[2]);
      if (!def.choice.values.includes(choice)) {
        return { ok: false, error: `${def.name}: ${def.choice.label} must be one of ${def.choice.values.join(', ')}` };
      }
      relics.push({ relicId: def.id, choice });
    } else {
      if (m[2] !== undefined) return { ok: false, error: `Relic ${def.name} takes no number` };
      relics.push({ relicId: def.id });
    }
  }
  return { ok: true, relics };
}
