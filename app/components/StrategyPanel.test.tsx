import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MAX_STRATEGIES_PER_RUN } from '../../engine/types';
import { COLORS, type Selection } from '../lib/colors';
import { MAX_LIBRARY_SIZE, fullLibrary } from '../lib/strategyLibrary';
import { StrategyPanel } from './StrategyPanel';
import { blockFirstConfig } from '../../engine/strategies';

const custom = (n: number) => ({
  id: `u${n}`,
  name: `Block ${n}`,
  config: blockFirstConfig(n),
});
const library = (customCount: number) => fullLibrary(Array.from({ length: customCount }, (_, i) => custom(i + 6)));

function render(lib: ReturnType<typeof library>, selectedCount: number): string {
  const selection: Selection[] = lib.slice(0, selectedCount).map((s, i) => ({ strategyId: s.id, color: COLORS[i]! }));
  return renderToStaticMarkup(
    <StrategyPanel
      library={lib}
      selection={selection}
      storageOk
      onToggle={() => {}}
      onColor={() => {}}
      onAdd={() => {}}
      onRename={() => {}}
      onConfig={() => {}}
      onDelete={() => {}}
      onClearAll={() => {}}
    />,
  );
}

const checkboxes = (html: string) => [...html.matchAll(/<input type="checkbox"[^>]*>/g)].map((m) => m[0]);

describe('StrategyPanel with a 10-strategy library', () => {
  it('lists all 10 and shows N/5 selected', () => {
    const html = render(library(MAX_LIBRARY_SIZE - 2), 3);
    expect(checkboxes(html)).toHaveLength(MAX_LIBRARY_SIZE);
    expect(html).toContain(`3/${MAX_STRATEGIES_PER_RUN} selected`);
  });

  it('leaves unchecked rows enabled below 5 selected', () => {
    const boxes = checkboxes(render(library(8), MAX_STRATEGIES_PER_RUN - 1));
    expect(boxes.filter((b) => !b.includes('checked=""')).every((b) => !b.includes('disabled'))).toBe(true);
  });

  it('disables only the unchecked rows at 5 selected', () => {
    const boxes = checkboxes(render(library(8), MAX_STRATEGIES_PER_RUN));
    const checked = boxes.filter((b) => b.includes('checked=""'));
    const unchecked = boxes.filter((b) => !b.includes('checked=""'));
    expect(checked).toHaveLength(MAX_STRATEGIES_PER_RUN);
    expect(checked.every((b) => !b.includes('disabled'))).toBe(true);
    expect(unchecked).toHaveLength(MAX_LIBRARY_SIZE - MAX_STRATEGIES_PER_RUN);
    expect(unchecked.every((b) => b.includes('disabled'))).toBe(true);
  });

  it('disables Add and shows the limit message when the library is full, not at 9', () => {
    const addDisabled = (html: string) => /<button type="submit" class="btn" disabled="">/.test(html);
    expect(addDisabled(render(library(7), 1))).toBe(false);
    const full = render(library(8), 1);
    expect(addDisabled(full)).toBe(true);
    expect(full).toContain('at most 10 strategies');
  });
});
