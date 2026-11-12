/// <reference types="vite/client" />
/**
 * Loads every data JSON file at build time, validates it, and exports the
 * result. An invalid file fails the build/tests with every problem listed.
 */
import type { CardDef, CharacterDef, EnemyDef, GameData, PotionDef } from '../engine/types';
import manifest from './manifest.json';
import { assembleGameData, validateGameData } from './validate';

const cardFiles = import.meta.glob('./cards/**/*.json', { eager: true, import: 'default' });
const enemyFiles = import.meta.glob('./enemies/*.json', { eager: true, import: 'default' });
const characterFiles = import.meta.glob('./characters/*.json', { eager: true, import: 'default' });
const potionFiles = import.meta.glob('./potions/*.json', { eager: true, import: 'default' });

function load(): GameData {
  const { raw, errors } = assembleGameData({
    manifest,
    cards: cardFiles,
    enemies: enemyFiles,
    characters: characterFiles,
    potions: potionFiles,
  });
  const result = validateGameData(raw);
  const all = [...errors, ...(result.ok ? [] : result.errors)];
  if (all.length > 0 || !result.ok) {
    throw new Error(`Invalid game data (${all.length} problem(s)):\n- ${all.join('\n- ')}`);
  }
  return result.data;
}

export const gameData: GameData = load();

const cardsByCode = new Map(Object.values(gameData.cards).map((c) => [c.code, c]));
const enemiesByCode = new Map(Object.values(gameData.enemies).map((e) => [e.code, e]));
const potionsByCode = new Map(Object.values(gameData.potions ?? {}).map((p) => [p.code, p]));
const charactersByCode = new Map<string, CharacterDef>(Object.values(gameData.characters).map((c) => [c.code, c]));

export function potionByCode(code: string): PotionDef | undefined {
  return potionsByCode.get(code);
}

export function cardByCode(code: string): CardDef | undefined {
  return cardsByCode.get(code);
}

export function enemyByCode(code: string): EnemyDef | undefined {
  return enemiesByCode.get(code);
}

export function characterByCode(code: string): CharacterDef | undefined {
  return charactersByCode.get(code);
}

export { validateGameData } from './validate';
