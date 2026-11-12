/** #205 Relic setup, URL, negative HP lost in the chart/results, and log text. */
import { describe, expect, it } from 'vitest';
import { gameData } from '../../data';
import { rawCurve } from '../../engine/stats';
import { buildQuery, defaultSetup, parseQuery } from './url';
import { decodeRelics, encodeRelics, selectableRelics, setupRelics, startingRelics } from './relics';
import { curveRange, hpLostPercentile, offsetCurve, strategyPercentileMarkers, visibleHpLostRange } from './chart';
import { fmtHpLostRange } from './results';
import { describeEvent, hpLostPhrase } from './logReplay';
import type { StrategySummary } from '../../engine/types';

describe('#205 relic setup', () => {
  it('the Ironclad starts with Burning Blood; other characters with nothing simulated', () => {
    expect(startingRelics(gameData, 'ironclad')).toEqual([{ relicId: 'burning_blood' }]);
    expect(startingRelics(gameData, 'silent')).toEqual([]);
    expect(setupRelics(gameData, defaultSetup(gameData))).toEqual([{ relicId: 'burning_blood' }]);
    expect(setupRelics(gameData, { characterId: 'ironclad', relics: [] })).toEqual([]);
  });

  it('the picker lists simulated relics for this character', () => {
    const ids = selectableRelics(gameData, 'ironclad').map((r) => r.id);
    expect(ids).toContain('vajra');
    expect(selectableRelics(gameData, 'silent').map((r) => r.id)).not.toContain('burning_blood');
  });

  it('encodes and decodes relic lists with Girya’s choice', () => {
    const relics = [{ relicId: 'vajra' }, { relicId: 'girya', choice: 2 }];
    const text = encodeRelics(gameData, relics);
    expect(text).toBe('Vj,Gy2');
    expect(decodeRelics(gameData, text)).toEqual({ ok: true, relics });
    expect(decodeRelics(gameData, 'Gy')).toEqual({ ok: true, relics: [{ relicId: 'girya', choice: 1 }] });
    expect(decodeRelics(gameData, '')).toEqual({ ok: true, relics: [] });
    for (const bad of ['Zz', 'Gy4', 'Vj2', 'Vj,Vj']) expect(decodeRelics(gameData, bad).ok).toBe(false);
  });

  it('the URL keeps relics only when they differ from the starting relic', () => {
    const base = defaultSetup(gameData);
    expect(buildQuery(gameData, base)).not.toContain('r=');
    expect(buildQuery(gameData, { ...base, relics: [{ relicId: 'burning_blood' }] })).not.toContain('r=');
    const q = buildQuery(gameData, {
      ...base,
      relics: [{ relicId: 'burning_blood' }, { relicId: 'girya', choice: 3 }],
    });
    expect(q).toContain('r=BB,Gy3');
    expect(parseQuery(gameData, `?${q}`).setup.relics).toEqual([
      { relicId: 'burning_blood' },
      { relicId: 'girya', choice: 3 },
    ]);
    const none = buildQuery(gameData, { ...base, relics: [] });
    expect(none).toMatch(/&r=$/);
    expect(parseQuery(gameData, `?${none}`).setup.relics).toEqual([]);
    expect(parseQuery(gameData, '?v=1&r=Qq').errors).toEqual(['Unknown relic code "Qq"']);
  });
});

describe('#205 negative HP lost in results and chart', () => {
  // HP lost −3 ×2, 0 ×1, 2 ×1.
  const counts = [2, 0, 0, 1, 0, 1];
  const summary = { strategyId: 's', hpLostCounts: counts, minHpLost: -3 } as StrategySummary;

  it('percentiles and the P25–P75 text use the offset', () => {
    expect(hpLostPercentile(counts, 0, -3)).toBe(-3);
    expect(hpLostPercentile(counts, 100, -3)).toBe(2);
    expect(fmtHpLostRange(counts, -3)).toBe('−3–0'.replace('−', '-'));
    expect(strategyPercentileMarkers(counts, -3)[0]).toEqual({ p: 5, value: -3, label: 'P5 = -3' });
  });

  it('the X range and curves reach below 0', () => {
    const range = visibleHpLostRange([{ strategyId: 's', summary }], new Set());
    expect(range).toEqual([-5, 4]);
    expect(curveRange(range)).toEqual([-6, 5]);
    expect(curveRange([0, 10])).toEqual([0, 11]);
    const pts = offsetCurve(rawCurve, counts, [-3, 2], -3);
    expect(pts[0]).toMatchObject({ x: -3, y: 50 });
    expect(pts.at(-1)).toMatchObject({ x: 2, y: 25 });
  });

  it('log text: net HP gained, heal source, relic activation', () => {
    expect(hpLostPhrase(6)).toBe('lost 6 HP');
    expect(hpLostPhrase(-3)).toBe('gained 3 HP');
    expect(hpLostPhrase(-3, true)).toBe('gaining 3 HP');
    const name = (id: string) => id;
    expect(describeEvent({ t: 'heal', amount: 6, hpAfter: 80, source: 'burning_blood' }, name)).toBe(
      'You heal 6 HP from Burning Blood (80 HP)',
    );
    expect(describeEvent({ t: 'relic', relicId: 'captains_wheel' }, name)).toBe('Captains Wheel activates');
  });
});
