import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { search } from '../data/browse';
import { otherSlot, parseCompareView, playerIn, type Slot } from '../lib/compare';
import { announce, flatten, groupsOf, playerGroupsOf, type Option } from '../lib/options';
import { loadRecents, rememberSearch } from '../lib/recents';
import { createSearcher, type SearchState } from '../lib/searcher';
import { useStore } from '../lib/store';
import {
  choosePlayer,
  closePicker,
  navigate,
  openMatch,
  openPicker,
  store,
} from '../state/app';
import './picker.css';

/** The button in the header that opens the search. */
export function PickerButton() {
  return (
    <button type="button" class="pick-button" onClick={openPicker} aria-haspopup="dialog">
      <span>Search</span>
      <kbd class="pick-key" aria-hidden="true">
        /
      </kbd>
    </button>
  );
}

/**
 * The search: a modal dialog (so focus is trapped and Esc closes it for free) with a field and
 * the results of GET /v1/search grouped as players, teams and matches. Focus stays in the field
 * while the arrow keys move through the list, the standard combobox pattern. A full-height
 * sheet on a phone. Asked for a player to compare (`pick`), it lists players only and hands the
 * one chosen to the compare page instead of going to their own.
 */
export function Picker() {
  const open = useStore(store, (s) => s.picker);
  const pick = useStore(store, (s) => s.pick);
  // The player already on the other side is not offered again.
  const taken = useStore(store, (s) =>
    s.pick ? playerIn(parseCompareView(s.search), otherSlot(s.pick)) : null,
  );
  const dialog = useRef<HTMLDialogElement>(null);

  // Opened as soon as it is drawn, not a frame later, so what is typed right after the shortcut
  // lands in the field.
  useLayoutEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      class="picker"
      aria-label={pick ? 'Choose a player' : 'Search players, teams and matches'}
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
      {open ? <PickerBody pick={pick} taken={taken} /> : null}
    </dialog>
  );
}

function PickerBody({ pick, taken }: { pick: Slot | null; taken: number | null }) {
  const [query, setQuery] = useState('');
  const [state, setState] = useState<SearchState>({ status: 'idle' });
  const [active, setActive] = useState(0);
  const [recents, setRecents] = useState(loadRecents);
  const list = useRef<HTMLUListElement>(null);

  // Nothing is asked until typing pauses, and a question nobody waits for any more is aborted.
  const searcher = useMemo(() => createSearcher({ search, onState: setState }), []);
  useEffect(() => () => searcher.cancel(), [searcher]);

  // While the next answer loads, keep showing the last one: the list does not flash empty.
  const last = useRef<SearchState>({ status: 'idle' });
  if (state.status === 'ready') last.current = state;
  const shown = state.status === 'loading' ? last.current : state;
  const groups = useMemo(
    () => (pick ? playerGroupsOf(shown, taken) : groupsOf(shown, recents)),
    [shown, recents, pick, taken],
  );
  const options = useMemo(() => flatten(groups), [groups]);
  const busy = state.status === 'loading';

  useEffect(() => setActive(0), [groups]);
  useEffect(() => {
    const key = options[active]?.key;
    if (key !== undefined)
      list.current?.querySelector(`#opt-${key}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, options]);

  const type = (words: string) => {
    setQuery(words);
    searcher.run(words);
  };

  const choose = (option: Option | undefined) => {
    if (!option) return;
    if (option.words !== undefined) {
      type(option.words);
      return;
    }
    if (pick && option.player !== undefined) {
      closePicker();
      choosePlayer(pick, option.player);
      return;
    }
    setRecents(rememberSearch(query));
    closePicker();
    if (option.match !== undefined) openMatch(option.match);
    else if (option.href) navigate(option.href);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const end = options.length - 1;
    let to: number | null = null;
    if (e.key === 'ArrowDown') to = Math.min(end, active + 1);
    else if (e.key === 'ArrowUp') to = Math.max(0, active - 1);
    else if (e.key === 'PageDown') to = Math.min(end, active + 8);
    else if (e.key === 'PageUp') to = Math.max(0, active - 8);
    else if (e.key === 'Home' && e.ctrlKey) to = 0;
    else if (e.key === 'End' && e.ctrlKey) to = end;
    if (to !== null) {
      e.preventDefault();
      setActive(to);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(options[active]);
    }
  };

  const activeKey = options[active]?.key;
  // Spread, because the input typings insist on a datalist `list` for role=combobox.
  const combobox: Record<string, string | undefined> = {
    role: 'combobox',
    'aria-expanded': 'true',
    'aria-controls': 'picker-list',
    'aria-activedescendant': activeKey !== undefined ? `opt-${activeKey}` : undefined,
  };
  let position = -1;

  return (
    <div class="picker-box">
      <header class="picker-head">
        <label class="picker-field">
          <span class="label">{pick ? 'Player' : 'Search'}</span>
          <input
            type="search"
            class="picker-input"
            {...combobox}
            autocomplete="off"
            autocapitalize="off"
            spellcheck={false}
            enterkeyhint="go"
            maxLength={64}
            placeholder={pick ? 'Messi, Ronaldo, Kane' : 'Messi, Argentina, final'}
            value={query}
            onInput={(e) => type(e.currentTarget.value)}
            onKeyDown={onKeyDown}
          />
        </label>
        <button type="button" class="picker-close" onClick={closePicker}>
          Close
        </button>
      </header>

      <p class="visually-hidden" role="status">
        {announce(state, options.length)}
      </p>

      {state.status === 'error' ? (
        <div class="picker-empty" role="alert">
          <p class="picker-empty-title">The search did not work</p>
          <p>Check your connection and try again.</p>
          <button type="button" class="picker-clear" onClick={() => searcher.run(query)}>
            Try again
          </button>
        </div>
      ) : state.status === 'ready' && options.length === 0 ? (
        <div class="picker-empty">
          <p class="picker-empty-title">Nothing for &ldquo;{state.words}&rdquo;</p>
          <p>
            {pick
              ? 'Try a surname. Words match the start of a word.'
              : 'Try a surname, a team, or a stage such as “semi”. Words match the start of a word.'}
          </p>
          <button type="button" class="picker-clear" onClick={() => type('')}>
            Clear the search
          </button>
        </div>
      ) : pick && state.status === 'idle' ? (
        <p class="picker-hint">Type the name of a player.</p>
      ) : (
        <ul
          ref={list}
          id="picker-list"
          class="picker-list"
          role="listbox"
          aria-label="Results"
          aria-busy={busy}
          data-busy={busy}
        >
          {groups.map((group) => (
            <li key={group.key} role="presentation" class="picker-group">
              {/* Not a heading: a listbox may hold only options and groups, and the group is named by this. */}
              <div
                role="presentation"
                class="picker-group-title label"
                id={`g-${group.key}`}
              >
                {group.title}
              </div>
              <ul role="group" aria-labelledby={`g-${group.key}`}>
                {group.options.map((option) => {
                  position++;
                  const at = position;
                  return (
                    <li
                      key={option.key}
                      id={`opt-${option.key}`}
                      role="option"
                      class="picker-row"
                      aria-selected={at === active}
                      onPointerMove={() => at !== active && setActive(at)}
                      onClick={() => choose(option)}
                    >
                      <span class="picker-teams">{option.label}</span>
                      {option.sub ? (
                        <span class="picker-sub label">{option.sub}</span>
                      ) : null}
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
