// Build card JSON skeletons from data/raw/cards.txt (the wiki export).
//
// Writes data/cards/<folder>/<id>.json with all metadata filled in deterministically:
// id, code, name, type, rarity, character, cost, xCost, starCost, upgraded cost,
// keywords, base/upgraded description, multiplayerOnly, lastUpdateVersion.
// `effects` start empty and `simulated` false; the sts2-wiki-import skill fills them.
//
// Existing card files are never overwritten (pass --refresh-meta to update their
// metadata while keeping effects/simulated). Codes are permanent: existing codes are
// kept and new cards get the first free code from a deterministic candidate list.
// Codes in data/reserved-codes.json (removed cards, e.g. beta-only ones) count as used
// and are never handed out again, and those cards' rows are skipped so a re-run does
// not recreate them.
//
// WARNING: data/raw/cards.txt is a BETA export (newer than manifest.json's gameVersion), so
// --refresh-meta would overwrite main-release metadata (rarity, cost, type, text) with beta
// values (e.g. Splash/Salvo rarities, Mirage, Outbreak, Well-Laid Plans). Do not run it
// without checking every changed file against the wiki Update History (sts2-wiki-import).
//
// Usage: node tools/build-card-skeletons.mjs [--refresh-meta] [--dry-run]
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const CARDS_DIR = join(ROOT, 'data/cards');
const RAW = join(ROOT, 'data/raw/cards.txt');
const refreshMeta = process.argv.includes('--refresh-meta');
const dryRun = process.argv.includes('--dry-run');

const FIELDS = [
  'Name',
  'Color',
  'OverrideColor',
  'Type',
  'Rarity',
  'Cost',
  'CostPlus',
  'StarCost',
  'NoUpgrade',
  'MultiplayerOnly',
  'Tags',
  'Description',
];
const CHARACTER = { Ironclad: 'I', Silent: 'S', Defect: 'D', Necrobinder: 'N', Regent: 'R', Colorless: 'colorless' };
const KEYWORDS = {
  'Unplayable.': 'unplayable',
  'Ethereal.': 'ethereal',
  'Eternal.': 'eternal',
  'Exhaust.': 'exhaust',
  'Retain.': 'retain',
  'Innate.': 'innate',
  'Sly.': 'sly',
};
/** Basic Strike/Defend are identical for every character: one shared card each. */
const SHARED = /^(Strike|Defend) \((Ironclad|Silent|Defect|Necrobinder|Regent)\)$/;

const version = JSON.parse(readFileSync(join(ROOT, 'data/manifest.json'), 'utf8')).gameVersion;
/** Removed cards whose codes stay reserved: { code, id, name, reason }. */
const RESERVED = JSON.parse(readFileSync(join(ROOT, 'data/reserved-codes.json'), 'utf8')).cards;

export function slug(name) {
  return name
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

/** Split wiki "(base;upgraded)" text into the two versions. */
export function splitUpgrade(text) {
  const pick = (i) => text.replace(/\(([^()]*?);([^()]*?)\)/g, (_, a, b) => (i === 0 ? a : b));
  const tidy = (s) =>
    s
      .replace(/\s+/g, ' ')
      .replace(/ \/ (?= \/ |$)/g, '')
      .replace(/^ \/ /, '')
      .replace(/\s+\./g, '.')
      .trim();
  return [tidy(pick(0)), tidy(pick(1))];
}

export function keywordsOf(text) {
  const out = [];
  for (const line of text.split(' / ')) {
    for (const part of line.split(/(?<=\.)\s+/)) {
      const k = KEYWORDS[part.trim()];
      if (k && !out.includes(k)) out.push(k);
    }
  }
  return out;
}

function folderFor(type, color) {
  if (type === 'curse') return 'curses';
  if (type === 'status') return 'status';
  if (type === 'quest') return 'quests';
  return color.toLowerCase();
}

function* codeCandidates(name) {
  const letters = name.replace(/[^A-Za-z0-9 ]/g, '');
  const words = letters.split(' ').filter(Boolean);
  const first = (letters[0] || 'X').toUpperCase();
  if (words.length > 1) yield first + words[1][0].toUpperCase();
  for (const ch of letters.slice(1).replace(/ /g, '')) yield first + ch.toLowerCase();
  const pool = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (const ch of pool) yield first + ch;
  for (const a of pool) for (const b of pool) yield a.toUpperCase() + b;
}

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.json') ? [p] : [];
  });
}

function main() {
  const existing = new Map(); // id -> { path, card }
  const usedCodes = new Set(RESERVED.map((r) => r.code));
  const reservedNames = new Set(RESERVED.map((r) => r.name));
  for (const p of walk(CARDS_DIR)) {
    const card = JSON.parse(readFileSync(p, 'utf8'));
    existing.set(card.id, { path: p, card });
    usedCodes.add(card.code);
  }

  const rows = readFileSync(RAW, 'utf8')
    .trim()
    .split('\n')
    .map((line) => {
      const parts = line.split('|');
      if (parts.length !== FIELDS.length) throw new Error(`Bad row (${parts.length} fields): ${line}`);
      return Object.fromEntries(FIELDS.map((f, i) => [f, parts[i] === '∅' ? '' : parts[i]]));
    });

  const seen = new Set();
  let created = 0,
    refreshed = 0,
    skipped = 0,
    reserved = 0;
  for (const r of rows.sort((a, b) => a.Name.localeCompare(b.Name))) {
    if (SHARED.test(r.Name)) {
      skipped++;
      continue;
    }
    if (reservedNames.has(r.Name)) {
      reserved++;
      continue;
    }
    const id = slug(r.Name);
    if (seen.has(id)) throw new Error(`Duplicate id ${id} (${r.Name})`);
    seen.add(id);

    const type = r.Type.toLowerCase();
    const character = CHARACTER[r.Color];
    if (!character) throw new Error(`Unknown color "${r.Color}" for ${r.Name}`);
    const rawCost = Number(r.Cost);
    const unplayable = rawCost === -2;
    const xCost = rawCost === -1;
    const cost = unplayable ? null : xCost ? 0 : rawCost;
    const noUpgrade = r.NoUpgrade === '1';
    const [baseText, upText] = splitUpgrade(r.Description);
    const keywords = keywordsOf(baseText);
    if (unplayable && !keywords.includes('unplayable')) keywords.unshift('unplayable');
    const upKeywords = keywordsOf(upText);
    if (unplayable && !upKeywords.includes('unplayable')) upKeywords.unshift('unplayable');

    let upgraded = null;
    if (!noUpgrade) {
      upgraded = {};
      if (r.CostPlus !== '') upgraded.cost = Number(r.CostPlus);
      if (JSON.stringify(upKeywords) !== JSON.stringify(keywords)) upgraded.keywords = upKeywords;
    }

    const meta = {
      id,
      name: r.Name,
      type,
      rarity: r.Rarity.toLowerCase(),
      character,
      cost,
      xCost,
      starCost: r.StarCost === '' ? null : Number(r.StarCost) === -1 ? 0 : Number(r.StarCost),
      ...(r.StarCost === '-1' ? { xStarCost: true } : {}),
      keywords,
      description: baseText,
      upgradedDescription: noUpgrade ? null : upText,
      multiplayerOnly: r.MultiplayerOnly === '1',
      lastUpdateVersion: version,
    };

    const prior = existing.get(id);
    if (prior) {
      if (!refreshMeta) continue;
      const card = { ...prior.card, ...meta, code: prior.card.code };
      if (prior.card.upgraded && upgraded) card.upgraded = { ...prior.card.upgraded, ...upgraded };
      if (!dryRun) writeFileSync(prior.path, JSON.stringify(order(card), null, 2) + '\n');
      refreshed++;
      continue;
    }

    let code;
    for (const c of codeCandidates(r.Name))
      if (!usedCodes.has(c)) {
        code = c;
        break;
      }
    usedCodes.add(code);
    const card = order({ ...meta, code, effects: [], upgraded, simulated: false });
    const path = join(CARDS_DIR, folderFor(type, r.Color), `${id}.json`);
    if (!dryRun) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify(card, null, 2) + '\n');
    }
    created++;
  }
  console.log(
    `created ${created}, refreshed ${refreshed}, skipped ${skipped} shared Strike/Defend rows and ${reserved} reserved (removed) cards, existing kept ${existing.size}`,
  );
}

/** Stable key order matching the hand-written files. */
function order(c) {
  const keys = [
    'id',
    'code',
    'name',
    'type',
    'rarity',
    'character',
    'cost',
    'xCost',
    'starCost',
    'xStarCost',
    'keywords',
    'effects',
    'upgraded',
    'description',
    'upgradedDescription',
    'simulated',
    'multiplayerOnly',
    'lastUpdateVersion',
  ];
  const out = {};
  for (const k of keys) if (k in c) out[k] = c[k];
  for (const k of Object.keys(c)) if (!(k in out)) out[k] = c[k];
  return out;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) main();
