// Core of `npm run compare-main`: run fixed-seed combats against the engine in a given
// repo root (the working tree or a checkout of main) and return a comparable report.
import { createServer } from 'vite';

export const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
export const ASCENSIONS = [0, 10];

/** Run every config in `root` and return { name: JSON-able result } (errors are recorded, not thrown). */
export async function simulate(root) {
  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    const { gameData } = await server.ssrLoadModule('/data/index.ts');
    const { runCombat } = await server.ssrLoadModule('/engine/combat.ts');
    const { deriveSeed } = await server.ssrLoadModule('/engine/rng.ts');
    const { GREEDY_CONFIG, blockFirstConfig } = await server.ssrLoadModule('/engine/strategies.ts');
    const { startingDeckFor } = await server.ssrLoadModule('/app/lib/deck.ts');
    const strategies = { greedy: GREEDY_CONFIG, block: blockFirstConfig(0) };
    const report = {};
    for (const enemyId of Object.keys(gameData.enemies).sort()) {
      for (const [sName, strategy] of Object.entries(strategies)) {
        for (const ascension of ASCENSIONS) {
          const name = `ironclad/${enemyId}/${sName}/A${ascension}`;
          const deck = startingDeckFor(gameData, 'ironclad');
          report[name] = SEEDS.map((i) => {
            try {
              return runCombat(
                gameData,
                { characterId: 'ironclad', deck, enemyId, ascension, strategy, seed: deriveSeed(7, i) },
                { log: true },
              );
            } catch (e) {
              return { error: e instanceof Error ? e.message : String(e) };
            }
          });
        }
      }
    }
    return report;
  } finally {
    await server.close();
  }
}

/** First difference between two reports as a short string, or null when identical. */
export function firstDiff(a, b) {
  for (const name of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    if (!(name in a) || !(name in b)) return `${name}: only in ${name in a ? 'branch' : 'main'}`;
    const ra = a[name];
    const rb = b[name];
    for (let i = 0; i < Math.max(ra.length, rb.length); i++) {
      const sa = JSON.stringify(ra[i]);
      const sb = JSON.stringify(rb[i]);
      if (sa === sb) continue;
      const la = ra[i]?.log;
      const lb = rb[i]?.log;
      if (la && lb) {
        for (let j = 0; j < Math.max(la.length, lb.length); j++) {
          if (JSON.stringify(la[j]) !== JSON.stringify(lb[j]))
            return `${name} combat ${i} event ${j}: branch=${JSON.stringify(la[j])} main=${JSON.stringify(lb[j])}`;
        }
      }
      return `${name} combat ${i}: branch=${(sa ?? '').slice(0, 160)} main=${(sb ?? '').slice(0, 160)}`;
    }
  }
  return null;
}
