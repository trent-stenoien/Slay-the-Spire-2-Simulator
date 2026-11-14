/** #286: the setup's start-HP default (A2+ lowers starting HP; Max HP is unchanged). */
import { defaultStartHp } from '../../engine/enemy';
import type { GameData } from '../../engine/types';

/** Start HP a setup uses: its own value when set, else the character's default at this Ascension. */
export function setupStartHp(
  data: GameData,
  setup: { characterId: string; ascension: number; startHp?: number },
): number {
  const character = data.characters[setup.characterId];
  if (!character) throw new Error(`unknown character ${setup.characterId}`);
  return setup.startHp ?? defaultStartHp(character, setup.ascension);
}
