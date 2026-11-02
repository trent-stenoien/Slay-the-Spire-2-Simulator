import { describe, expect, it } from 'vitest';
import { gameData } from '../../data';
import { buildQuery, decodeDeck, defaultSetup, encodeDeck, parseQuery, splitQuery, type LogTarget } from './url';
import { GREEDY_CONFIG, blockFirstConfig } from '../../engine/strategies';

const data = gameData;
const starter = data.characters.ironclad!.startingDeck;

describe('deck encoding', () => {
  it('encodes the starter deck', () => {
    expect(encodeDeck(data, starter)).toBe('St5De4Ba1');
  });

  it('encodes upgraded entries with +', () => {
    expect(
      encodeDeck(data, [
        { cardId: 'strike', upgraded: false, count: 4 },
        { cardId: 'strike', upgraded: true, count: 1 },
      ]),
    ).toBe('St4St+1');
  });

  it("does not encode Ascender's Bane at A5+ (the engine adds it)", () => {
    expect(encodeDeck(data, starter)).toBe('St5De4Ba1');
    expect(buildQuery(data, { ...defaultSetup(data), ascension: 5 })).toContain('d=St5De4Ba1');
    expect(buildQuery(data, { ...defaultSetup(data), ascension: 5 })).not.toContain('As');
  });

  it('skips zero-count entries', () => {
    expect(encodeDeck(data, [{ cardId: 'bash', upgraded: false, count: 0 }])).toBe('');
  });

  it('decodes and round-trips', () => {
    const deck = [
      { cardId: 'strike', upgraded: false, count: 4 },
      { cardId: 'strike', upgraded: true, count: 1 },
      { cardId: 'ultimate_defend', upgraded: true, count: 12 },
    ];
    const text = encodeDeck(data, deck);
    expect(text).toBe('St4St+1UD+12');
    expect(decodeDeck(data, 'ironclad', text)).toEqual({ ok: true, deck });
  });

  it('decodes an empty deck', () => {
    expect(decodeDeck(data, 'ironclad', '')).toEqual({ ok: true, deck: [] });
  });

  it.each([
    ['Zz3', /unknown card code "Zz"/],
    ['St', /cannot read/],
    ['St0', /count must be/],
    ['St05', /cannot read|count must be/],
    ['St100', /count must be/],
    ['St5x', /cannot read/],
    ['St2St3', /more than once/],
    ['AB1', /not available/],
    ['St-1', /cannot read/],
  ])('rejects %s', (text, msg) => {
    const r = decodeDeck(data, 'ironclad', text);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(msg);
  });

  it('is case-sensitive on codes', () => {
    expect(decodeDeck(data, 'ironclad', 'st1').ok).toBe(false);
  });
});

describe('query strings', () => {
  const setup = defaultSetup(data);

  it('builds the documented setup URL', () => {
    expect(buildQuery(data, setup)).toBe('v=1&c=I&e=Nb&a=0&d=St5De4Ba1');
  });

  it('builds the documented combat-log URL', () => {
    expect(buildQuery(data, setup, { seed: 123456, strategies: [blockFirstConfig(4)] })).toBe(
      'v=1&c=I&e=Nb&a=0&d=St5De4Ba1&s=123456&st=b4pa',
    );
  });

  it('round-trips setup and log target', () => {
    const s = { ...setup, ascension: 9, deck: [{ cardId: 'bash', upgraded: true, count: 2 }] };
    const log = { seed: 4294967295, strategies: [GREEDY_CONFIG] };
    const parsed = parseQuery(data, `?${buildQuery(data, s, log)}`);
    expect(parsed).toEqual({ setup: s, log, errors: [] });
  });

  it('keeps a literal + in the deck', () => {
    expect(parseQuery(data, '?v=1&c=I&e=Nb&a=0&d=St4St%2B1').setup.deck).toEqual(
      parseQuery(data, '?v=1&c=I&e=Nb&a=0&d=St4St+1').setup.deck,
    );
    expect(parseQuery(data, '?d=St4St+1').setup.deck).toEqual([
      { cardId: 'strike', upgraded: false, count: 4 },
      { cardId: 'strike', upgraded: true, count: 1 },
    ]);
  });

  it('an empty query is defaults with no errors', () => {
    expect(parseQuery(data, '')).toEqual({ setup, log: null, errors: [] });
    expect(parseQuery(data, '?')).toEqual({ setup, log: null, errors: [] });
  });

  it('reports unknown codes without throwing and falls back', () => {
    const r = parseQuery(data, '?v=1&c=X&e=Qq&a=0&d=St5');
    expect(r.errors).toEqual(['Unknown character code "X"', 'Unknown enemy code "Qq"']);
    expect(r.setup).toEqual(setup);
  });

  it('reports a bad deck and keeps the starter deck', () => {
    const r = parseQuery(data, '?v=1&c=I&e=Nb&a=3&d=Zz1');
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/Zz/);
    expect(r.setup.deck).toEqual(starter);
    expect(r.setup.ascension).toBe(3);
  });

  it.each(['21', '-1', '1.5', '05', 'abc', ''])('rejects Ascension "%s"', (a) => {
    const r = parseQuery(data, `?a=${a}`);
    expect(r.errors[0]).toMatch(/Ascension/);
    expect(r.setup.ascension).toBe(0);
  });

  it('rejects an unsupported version', () => {
    const r = parseQuery(data, '?v=2&c=I');
    expect(r.errors[0]).toMatch(/version/);
    expect(r.log).toBeNull();
  });

  it('needs both s and st for a log link', () => {
    expect(parseQuery(data, '?s=5').log).toBeNull();
    expect(parseQuery(data, '?s=5').errors[0]).toMatch(/strategy/);
    expect(parseQuery(data, '?st=g').errors[0]).toMatch(/seed/);
  });

  it.each([
    ['s=abc&st=g', /Seed/],
    ['s=4294967296&st=g', /Seed/],
    ['s=1&st=x', /strategy code "x"/],
    ['s=1&st=b01', /strategy code/],
  ])('rejects log params %s', (q, msg) => {
    const r = parseQuery(data, `?${q}`);
    expect(r.log).toBeNull();
    expect(r.errors[0]).toMatch(msg);
  });

  it('splitQuery ignores malformed escapes and keeps the first value', () => {
    const m = splitQuery('?a=1&a=2&b=%E0%A4%A&c');
    expect(m.get('a')).toBe('1');
    expect(m.has('b')).toBe(false);
    expect(m.get('c')).toBe('');
  });
});

describe('combat number (n) in log links', () => {
  const strategies = [GREEDY_CONFIG];
  it('is appended last and round-trips as the 0-based index', () => {
    const q = buildQuery(data, defaultSetup(data), { seed: 7, strategies, combatIndex: 41 });
    expect(q.endsWith('&n=41')).toBe(true);
    expect(parseQuery(data, q).log).toMatchObject({ seed: 7, combatIndex: 41 });
  });
  it('is absent from links that do not carry it, and the seed link is unchanged', () => {
    const q = buildQuery(data, defaultSetup(data), { seed: 7, strategies });
    expect(q).not.toContain('&n=');
    expect(parseQuery(data, q).log?.combatIndex).toBeUndefined();
  });
  it.each([0, 9999])('round-trips the boundary combat index %i', (combatIndex) => {
    const q = buildQuery(data, defaultSetup(data), { seed: 7, strategies, combatIndex });
    expect(q.endsWith(`&n=${combatIndex}`)).toBe(true);
    expect(parseQuery(data, q)).toMatchObject({ errors: [], log: { combatIndex } });
  });
  it.each(['-1', 'abc', '1.5', '05', ''])('ignores n="%s" without an error, keeping the rest of the link', (n) => {
    const r = parseQuery(data, buildQuery(data, defaultSetup(data), { seed: 7, strategies }) + `&n=${n}`);
    expect(r.errors).toEqual([]);
    expect(r.log).toEqual({ seed: 7, strategies });
  });
  it('ignores an invalid n without an error', () => {
    const q = buildQuery(data, defaultSetup(data), { seed: 7, strategies }) + '&n=10000';
    const r = parseQuery(data, q);
    expect(r.errors).toEqual([]);
    expect(r.log?.combatIndex).toBeUndefined();
  });
});

describe('compare links (several strategies in st, colors in k)', () => {
  const setup = defaultSetup(data);
  const three: LogTarget = {
    seed: 99,
    strategies: [blockFirstConfig(4), GREEDY_CONFIG, blockFirstConfig(0)],
    colors: ['blue', 'red', 'green'],
    combatIndex: 41,
  };

  it('builds the documented compare URL', () => {
    expect(buildQuery(data, setup, three)).toBe('v=1&c=I&e=Nb&a=0&d=St5De4Ba1&s=99&st=b4pa,apb,b0pa&k=b,r,g&n=41');
  });

  it('round-trips 2 to 5 strategies with colors and combat number', () => {
    expect(parseQuery(data, `?${buildQuery(data, setup, three)}`)).toEqual({ setup, log: three, errors: [] });
    const five: LogTarget = {
      seed: 0,
      strategies: [0, 1, 2, 3].map((n) => blockFirstConfig(n)).concat([blockFirstConfig(9999)]),
      colors: ['blue', 'green', 'yellow', 'red', 'purple'],
    };
    expect(parseQuery(data, `?${buildQuery(data, setup, five)}`)).toEqual({ setup, log: five, errors: [] });
    const two: LogTarget = { seed: 5, strategies: [GREEDY_CONFIG, blockFirstConfig(3)] };
    expect(parseQuery(data, `?${buildQuery(data, setup, two)}`)).toEqual({ setup, log: two, errors: [] });
  });

  it('keeps single-strategy links unchanged (no k unless colors are given)', () => {
    const q = buildQuery(data, setup, { seed: 1, strategies: [GREEDY_CONFIG] });
    expect(q).toBe('v=1&c=I&e=Nb&a=0&d=St5De4Ba1&s=1&st=apb');
    expect(parseQuery(data, '?v=1&c=I&e=Nb&a=0&d=St5De4Ba1&s=1&st=b4&n=3').log).toEqual({
      seed: 1,
      strategies: [blockFirstConfig(4)],
      combatIndex: 3,
    });
  });

  it('survives URL-encoded commas', () => {
    expect(parseQuery(data, '?s=1&st=b4%2Cg&k=b%2Cr').log).toEqual({
      seed: 1,
      strategies: [blockFirstConfig(4), GREEDY_CONFIG],
      colors: ['blue', 'red'],
    });
  });

  it('#130: still opens old links (st=g / b<X>) as the migrated strategies', () => {
    expect(parseQuery(data, '?v=1&c=I&e=Nb&a=0&d=St5De4Ba1&s=99&st=b4,g,b0&k=b,r,g&n=41')).toEqual({
      setup,
      log: three,
      errors: [],
    });
    // A rebuilt link uses the new codes, and opens the same thing.
    const rebuilt = buildQuery(data, setup, parseQuery(data, '?s=99&st=b4,g,b0&k=b,r,g&n=41').log!);
    expect(rebuilt).toContain('st=b4pa,apb,b0pa');
  });

  it('#130: round-trips custom orders', () => {
    const custom: LogTarget = {
      seed: 7,
      strategies: [
        { order: ['powers', 'block', 'attack'], allowThrough: 5 },
        { order: ['attack', 'block', 'powers'], allowThrough: 0 },
        { order: ['powers', 'attack', 'block'], allowThrough: 0 },
        { order: ['block', 'attack', 'powers'], allowThrough: 9999 },
      ],
    };
    const q = buildQuery(data, setup, custom);
    expect(q).toContain('st=pb5a,ab0p,pab,b9999ap');
    expect(parseQuery(data, `?${q}`)).toEqual({ setup, log: custom, errors: [] });
  });

  it.each([
    ['s=1&st=g,g', /more than once/],
    ['s=1&st=g,apb', /"apb" appears more than once/],
    ['s=1&st=b4pa,b4', /"b4" appears more than once/],
    ['s=1&st=bpa', /strategy code "bpa"/],
    ['s=1&st=b0,b1,b2,b3,b4,b5', /at most 5/],
    ['s=1&st=g,', /strategy code ""/],
    ['s=1&st=g,x', /strategy code "x"/],
  ])('rejects %s', (q, msg) => {
    const r = parseQuery(data, `?${q}`);
    expect(r.log).toBeNull();
    expect(r.errors[0]).toMatch(msg);
  });

  it.each(['b', 'b,r,g', 'b,x', 'blue,red', ''])('ignores a bad k "%s" without an error', (k) => {
    const r = parseQuery(data, `?s=1&st=g,b0&k=${k}`);
    expect(r.errors).toEqual([]);
    expect(r.log?.colors).toBeUndefined();
    expect(r.log?.strategies).toHaveLength(2);
  });

  it('refuses to build a link with 0 or more than 5 strategies', () => {
    expect(() => buildQuery(data, setup, { seed: 1, strategies: [] })).toThrow();
    const six = [0, 1, 2, 3, 4, 5].map((n) => blockFirstConfig(n));
    expect(() => buildQuery(data, setup, { seed: 1, strategies: six })).toThrow();
  });
});
