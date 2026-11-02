import { useEffect, useId, useRef, useState } from 'react';
import { blockIsLast } from '../../engine/strategies';
import {
  MAX_STRATEGIES_PER_RUN,
  type SavedStrategy,
  type StrategyColor,
  type StrategyConfig,
  type StrategyGroup,
} from '../../engine/types';
import { Panel } from './Panel';
import { COLORS, COLOR_HEX, isColorTaken, type Selection } from '../lib/colors';
import { defaultName, GROUP_LABEL, isBuiltIn, parseAllowThrough, strategyProblem } from '../lib/strategyLibrary';

interface Props {
  library: SavedStrategy[];
  selection: Selection[];
  storageOk: boolean;
  onToggle: (id: string) => void;
  onColor: (id: string, color: StrategyColor) => void;
  onAdd: (name: string, config: StrategyConfig) => void;
  onRename: (id: string, name: string) => void;
  onConfig: (id: string, config: StrategyConfig) => void;
  onDelete: (id: string) => void;
  onClearAll: () => void;
}

/** Saved-strategy library with per-run selection and colors. */
export function StrategyPanel(props: Props) {
  const { library, selection, storageOk } = props;
  const full = selection.length >= MAX_STRATEGIES_PER_RUN;
  return (
    <Panel id="strat" title="Strategies" aside={`${selection.length}/${MAX_STRATEGIES_PER_RUN} selected`}>
      <div className="panel-actions">
        {library.some((s) => !isBuiltIn(s.id)) && (
          <button
            type="button"
            className="btn-link danger"
            onClick={() => {
              if (globalThis.confirm?.('Delete all custom strategies?') ?? true) props.onClearAll();
            }}
          >
            Clear custom strategies
          </button>
        )}
      </div>
      {!storageOk && (
        <p className="note">Browser storage is unavailable; custom strategies last only until you close the page.</p>
      )}
      <ul className="strat-list">
        {library.map((s) => (
          <StrategyRow key={s.id} {...props} s={s} sel={selection.find((x) => x.strategyId === s.id)} full={full} />
        ))}
      </ul>
      <NewStrategyForm library={library} onAdd={props.onAdd} />
    </Panel>
  );
}

/** #130: "1 Attack · 2 Powers · 3 Block", with "allow X" on the Block chip unless Block is last. */
function PriorityChips({ config }: { config: StrategyConfig }) {
  const last = blockIsLast(config);
  return (
    <ol className="prio-chips" aria-label="Priority">
      {config.order.map((g, i) => (
        <li key={g} className="prio-chip">
          <b>{i + 1}</b>
          {GROUP_LABEL[g]}
          {g === 'block' && !last && <> · allow {config.allowThrough}</>}
        </li>
      ))}
    </ol>
  );
}

function StrategyRow({
  library,
  s,
  sel,
  selection,
  full,
  onToggle,
  onColor,
  onRename,
  onConfig,
  onDelete,
}: Props & { s: SavedStrategy; sel: Selection | undefined; full: boolean }) {
  const builtIn = isBuiltIn(s.id);
  const [editing, setEditing] = useState(false);
  const checked = sel !== undefined;
  return (
    <li
      className={`strat-row${checked ? ' selected' : ''}${builtIn ? '' : ' custom'}`}
      style={sel ? { borderLeftColor: COLOR_HEX[sel.color] } : undefined}
    >
      <div className="strat-main">
        <label className="strat-check">
          <input type="checkbox" checked={checked} disabled={!checked && full} onChange={() => onToggle(s.id)} />
          <span className="strat-name">{s.name}</span>
          {builtIn && <span className="tag">default</span>}
        </label>
        <PriorityChips config={s.config} />
      </div>
      {!builtIn && (
        <div className="strat-actions">
          <button
            type="button"
            className="icon-btn"
            aria-label={editing ? `Done editing ${s.name}` : `Edit ${s.name}`}
            title={editing ? `Done editing ${s.name}` : `Edit ${s.name}`}
            aria-expanded={editing}
            onClick={() => setEditing((v) => !v)}
          >
            {editing ? <CheckIcon /> : <PencilIcon />}
          </button>
          <button
            type="button"
            className="icon-btn danger"
            aria-label={`Delete ${s.name}`}
            title={`Delete ${s.name}`}
            onClick={() => onDelete(s.id)}
          >
            <XIcon />
          </button>
        </div>
      )}
      {sel && (
        <div className="swatches" role="radiogroup" aria-label={`Color for ${s.name}`}>
          {COLORS.map((c) => {
            const taken = isColorTaken(selection, s.id, c);
            return (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={sel.color === c}
                aria-label={c}
                title={taken ? `${c} (used by another strategy)` : c}
                disabled={taken}
                className={`swatch${sel.color === c ? ' on' : ''}`}
                style={{ background: COLOR_HEX[c] }}
                onClick={() => onColor(s.id, c)}
              />
            );
          })}
        </div>
      )}
      {editing && !builtIn && (
        <StrategyEditor library={library} s={s} onRename={onRename} onConfig={(c) => onConfig(s.id, c)} />
      )}
    </li>
  );
}

/** Edit form for a saved strategy: title (saved on blur) and its priority order (saved when valid). */
function StrategyEditor({
  library,
  s,
  onRename,
  onConfig,
}: {
  library: SavedStrategy[];
  s: SavedStrategy;
  onRename: (id: string, name: string) => void;
  onConfig: (config: StrategyConfig) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => ({
    order: [...s.config.order],
    allow: String(s.config.allowThrough),
  }));
  const config = draftConfig(draft);
  const problem = config ? strategyProblem(library, config, s.id) : null;
  const change = (next: Draft) => {
    setDraft(next);
    const c = draftConfig(next);
    if (c && strategyProblem(library, c, s.id) === null) onConfig(c);
  };
  return (
    <div className="strat-edit">
      <label className="field">
        <span>Title</span>
        <input defaultValue={s.name} onBlur={(e) => onRename(s.id, e.target.value)} maxLength={40} />
      </label>
      <OrderEditor draft={draft} onChange={change} label={`Priority for ${s.name}`} />
      {config === null && <small className="warn">Allowance must be a whole number, 0 or more.</small>}
      {problem && <small className="warn">{problem} Change the order or allowance; this edit isn&apos;t saved.</small>}
    </div>
  );
}

/** The editable state of a priority order: the allowance stays text while it's typed. */
interface Draft {
  order: StrategyGroup[];
  allow: string;
}

/** The config a draft describes, or null when the allowance is needed and isn't a valid number. */
function draftConfig(d: Draft): StrategyConfig | null {
  if (d.order[d.order.length - 1] === 'block') return { order: d.order, allowThrough: 0 };
  const n = parseAllowThrough(d.allow);
  return n === null ? null : { order: d.order, allowThrough: n };
}

function moved<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

const GROUP_HINT: Record<StrategyGroup, string> = {
  attack: 'Tremble, Bash, then highest damage',
  powers: 'Inflame, Demon Form, …',
  block: 'Spends leftover energy',
};

/**
 * #130: reorderable priority list (top = played first). Rows move by drag and drop on the
 * handle, the up/down buttons, or ArrowUp/ArrowDown on the focused handle. The Block row
 * holds the allowance unless it is last.
 */
function OrderEditor({ draft, onChange, label }: { draft: Draft; onChange: (d: Draft) => void; label: string }) {
  const { order } = draft;
  const [dragging, setDragging] = useState<number | null>(null);
  const [announce, setAnnounce] = useState('');
  // After a keyboard or button move, focus follows the moved row.
  const [focus, setFocus] = useState<{ group: StrategyGroup; part: 'handle' | 'up' | 'down' } | null>(null);
  const refs = useRef(new Map<string, HTMLButtonElement | null>());
  const helpId = useId();

  useEffect(() => {
    if (!focus) return;
    const want = refs.current.get(`${focus.group}-${focus.part}`);
    const el = want && !want.disabled ? want : refs.current.get(`${focus.group}-handle`);
    el?.focus();
  }, [focus, order]);

  const move = (from: number, to: number, part: 'handle' | 'up' | 'down' | null) => {
    if (to < 0 || to >= order.length || from === to) return;
    const group = order[from]!;
    onChange({ ...draft, order: moved(order, from, to) });
    setAnnounce(`${GROUP_LABEL[group]} moved to position ${to + 1} of ${order.length}.`);
    if (part) setFocus({ group, part });
  };
  const ref = (key: string) => (el: HTMLButtonElement | null) => {
    refs.current.set(key, el);
  };
  const last = order.length - 1;

  return (
    <div className="order-editor">
      <p className="order-help" id={helpId}>
        Priority <span className="muted">— drag or use the arrows; top is played first</span>
      </p>
      <ol className="order-list" aria-label={label} aria-describedby={helpId}>
        {order.map((g, i) => (
          <li
            key={g}
            className={`order-row${dragging === i ? ' dragging' : ''}`}
            onDragOver={(e) => {
              if (dragging === null) return;
              e.preventDefault();
              if (dragging !== i) {
                move(dragging, i, null);
                setDragging(i);
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(null);
            }}
          >
            <span className="order-rank" aria-hidden="true">
              {i + 1}
            </span>
            <button
              type="button"
              className="order-handle"
              ref={ref(`${g}-handle`)}
              draggable
              aria-label={`${GROUP_LABEL[g]}, priority ${i + 1} of ${order.length}. Press up or down arrow to move.`}
              title="Drag, or press up/down arrow, to move"
              onDragStart={(e) => {
                setDragging(i);
                try {
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', g);
                } catch {
                  // Some browsers (and jsdom) have no usable dataTransfer; the drag still works.
                }
              }}
              onDragEnd={() => setDragging(null)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  move(i, i - 1, 'handle');
                } else if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  move(i, i + 1, 'handle');
                }
              }}
            >
              <GripIcon />
            </button>
            <span className="order-name">{GROUP_LABEL[g]}</span>
            {g === 'block' && i !== last ? (
              <label className="order-allow">
                <span>allow at most</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  value={draft.allow}
                  aria-label="Allow at most X damage per turn"
                  aria-invalid={parseAllowThrough(draft.allow) === null}
                  onChange={(e) => onChange({ ...draft, allow: e.target.value })}
                />
                <span>dmg</span>
              </label>
            ) : (
              <span className="order-hint">{GROUP_HINT[g]}</span>
            )}
            <span className="order-arrows">
              <button
                type="button"
                ref={ref(`${g}-up`)}
                aria-label={`Move ${GROUP_LABEL[g]} up`}
                disabled={i === 0}
                onClick={() => move(i, i - 1, 'up')}
              >
                <ArrowIcon up />
              </button>
              <button
                type="button"
                ref={ref(`${g}-down`)}
                aria-label={`Move ${GROUP_LABEL[g]} down`}
                disabled={i === last}
                onClick={() => move(i, i + 1, 'down')}
              >
                <ArrowIcon />
              </button>
            </span>
          </li>
        ))}
      </ol>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
    </div>
  );
}

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}
const PencilIcon = () => (
  <Icon>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
  </Icon>
);
const CheckIcon = () => (
  <Icon>
    <path d="M20 6 9 17l-5-5" />
  </Icon>
);
const XIcon = () => (
  <Icon>
    <path d="M18 6 6 18M6 6l12 12" />
  </Icon>
);

const GripIcon = () => (
  <Icon>
    <circle cx="9" cy="6" r="1" />
    <circle cx="15" cy="6" r="1" />
    <circle cx="9" cy="12" r="1" />
    <circle cx="15" cy="12" r="1" />
    <circle cx="9" cy="18" r="1" />
    <circle cx="15" cy="18" r="1" />
  </Icon>
);
const ArrowIcon = ({ up = false }: { up?: boolean }) => (
  <Icon>{up ? <path d="M12 19V5M5 12l7-7 7 7" /> : <path d="M12 5v14M19 12l-7 7-7-7" />}</Icon>
);

/** Starts as the old default custom strategy: Block (allow 5), Powers, Attack. */
const NEW_DRAFT: Draft = { order: ['block', 'powers', 'attack'], allow: '5' };

function NewStrategyForm({
  library,
  onAdd,
}: {
  library: SavedStrategy[];
  onAdd: (name: string, config: StrategyConfig) => void;
}) {
  const [name, setName] = useState('');
  const [draft, setDraft] = useState<Draft>(NEW_DRAFT);
  const config = draftConfig(draft);
  const problem = config ? strategyProblem(library, config) : null;
  return (
    <form
      className="new-strat"
      onSubmit={(e) => {
        e.preventDefault();
        if (config === null || problem !== null) return;
        onAdd(name, config);
        setName('');
      }}
    >
      <h3>New Strategy</h3>
      <label className="field">
        <span>Title</span>
        <input
          value={name}
          placeholder={config ? defaultName(config) : 'Title'}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <OrderEditor draft={draft} onChange={setDraft} label="Priority for the new strategy" />
      {config === null && <small className="warn">Allowance must be a whole number, 0 or more.</small>}
      {problem && <small className="warn">{problem}</small>}
      <div className="new-strat-actions">
        <button type="submit" className="btn" disabled={config === null || problem !== null}>
          Add
        </button>
      </div>
    </form>
  );
}
