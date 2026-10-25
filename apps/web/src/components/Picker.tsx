import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { closePicker, openMatch, openPicker, store } from '../state/app';
import { entriesOf, groupEntries, searchEntries, type MatchEntry } from '../lib/search';
import { useStore } from '../lib/store';
import './picker.css';

const formatDate = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${iso}T12:00:00Z`));

const scoreOf = (e: MatchEntry) =>
  `${e.homeScore}-${e.awayScore}${e.homePens !== null && e.awayPens !== null ? ` (${e.homePens}-${e.awayPens})` : ''}`;

/** The button in the scoreboard that opens the picker. */
export function PickerButton() {
  return (
    <button type="button" class="pick-button" onClick={openPicker} aria-haspopup="dialog">
      <span>Matches</span>
      <kbd class="pick-key" aria-hidden="true">
        /
      </kbd>
    </button>
  );
}

/**
 * The match picker: a modal dialog (so focus is trapped and Esc closes it for
 * free) with a search field and the whole index grouped by competition and
 * season. Focus stays in the field while the arrow keys move through the list,
 * the standard combobox pattern. A full-height sheet on a phone.
 */
export function Picker() {
  const open = useStore(store, (s) => s.picker);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      class="picker"
      aria-label="Choose a match"
      onClose={closePicker}
      onClick={(e) => {
        // A click on the backdrop lands on the dialog itself, outside its box.
        const box = e.currentTarget.getBoundingClientRect();
        const outside =
          e.clientX < box.left ||
          e.clientX > box.right ||
          e.clientY < box.top ||
          e.clientY > box.bottom;
        if (outside) closePicker();
      }}
    >
      {open ? <PickerBody /> : null}
    </dialog>
  );
}

function PickerBody() {
  const index = useStore(store, (s) => s.index);
  const currentId = useStore(store, (s) => s.route.m ?? s.index?.hero ?? null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const list = useRef<HTMLUListElement>(null);

  const entries = useMemo(() => (index ? entriesOf(index) : []), [index]);
  const results = useMemo(() => searchEntries(entries, query), [entries, query]);
  const groups = useMemo(() => groupEntries(results), [results]);

  // Start on the current match, so the list opens where you already are.
  useEffect(() => {
    const at = results.findIndex((e) => e.id === currentId);
    setActive(at >= 0 ? at : 0);
    // Only when the dialog opens.
  }, []);

  useEffect(() => {
    const id = results[active]?.id;
    if (id === undefined) return;
    list.current?.querySelector(`#opt-${id}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, results]);

  const choose = (entry: MatchEntry | undefined) => {
    if (!entry) return;
    closePicker();
    openMatch(entry.id);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const last = results.length - 1;
    let to: number | null = null;
    if (e.key === 'ArrowDown') to = Math.min(last, active + 1);
    else if (e.key === 'ArrowUp') to = Math.max(0, active - 1);
    else if (e.key === 'PageDown') to = Math.min(last, active + 8);
    else if (e.key === 'PageUp') to = Math.max(0, active - 8);
    else if (e.key === 'Home' && e.ctrlKey) to = 0;
    else if (e.key === 'End' && e.ctrlKey) to = last;
    if (to !== null) {
      e.preventDefault();
      setActive(to);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(results[active]);
    }
  };

  const activeId = results[active]?.id;
  // Spread, because the input typings insist on a datalist `list` for role=combobox.
  const combobox: Record<string, string | undefined> = {
    role: 'combobox',
    'aria-expanded': 'true',
    'aria-controls': 'picker-list',
    'aria-activedescendant': activeId !== undefined ? `opt-${activeId}` : undefined,
  };
  let position = -1;

  return (
    <div class="picker-box">
      <header class="picker-head">
        <label class="picker-field">
          <span class="label">Search teams</span>
          <input
            type="search"
            class="picker-input"
            {...combobox}
            autocomplete="off"
            autocapitalize="off"
            spellcheck={false}
            enterkeyhint="go"
            placeholder="Argentina, Spain, final, 2024"
            value={query}
            onInput={(e) => {
              setQuery(e.currentTarget.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
          />
        </label>
        <button type="button" class="picker-close" onClick={closePicker}>
          Close
        </button>
      </header>

      <p class="visually-hidden" role="status">
        {results.length === 1 ? '1 match' : `${results.length} matches`}
      </p>

      {results.length === 0 ? (
        <div class="picker-empty">
          <p class="picker-empty-title">No match for &ldquo;{query.trim()}&rdquo;</p>
          <p>Try a team name, a stage such as &ldquo;semi&rdquo;, or a year.</p>
          <button type="button" class="picker-clear" onClick={() => setQuery('')}>
            Clear the search
          </button>
        </div>
      ) : (
        <ul
          ref={list}
          id="picker-list"
          class="picker-list"
          role="listbox"
          aria-label="Matches"
        >
          {groups.map((group) => (
            <li key={group.key} role="presentation" class="picker-group">
              <h3 class="picker-group-title label" id={`g-${group.key}`}>
                {group.title}
              </h3>
              <ul role="group" aria-labelledby={`g-${group.key}`}>
                {group.entries.map((entry) => {
                  position++;
                  const at = position;
                  return (
                    <li
                      key={entry.id}
                      id={`opt-${entry.id}`}
                      role="option"
                      class="picker-row"
                      aria-selected={at === active}
                      data-current={entry.id === currentId}
                      onPointerMove={() => at !== active && setActive(at)}
                      onClick={() => choose(entry)}
                    >
                      <span class="picker-teams">
                        {entry.home} v {entry.away}
                      </span>
                      <span class="picker-score num">{scoreOf(entry)}</span>
                      <span class="picker-sub label">
                        {entry.stage}, {formatDate(entry.date)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
