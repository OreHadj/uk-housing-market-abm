import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { groupRunsByModel, type RunPickerItem } from '../lib/runSearch';

export interface RunPickerOption extends RunPickerItem {
  value: string;
  /** Shown after the name: a sweep's instrument, or how a comparison differs. */
  note?: string;
}

interface RunPickerProps {
  /** The field's name, read out with the selected run. */
  label: string;
  value: string;
  /** Newest first; the picker groups them by model and keeps that order within each group. */
  options: readonly RunPickerOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Closed text while nothing is selected and there is no "none" choice. */
  placeholder?: string;
  /** Closed text when the selected run is not in the list, e.g. still finishing or deleted by someone else. */
  missingLabel?: string;
  /** A first choice meaning "no run", such as "No comparison run". It stays pinned while searching. */
  noneLabel?: string;
  /** Adds ✕ to the closed field, clearing the selection. */
  clearLabel?: string;
}

export function SearchIcon() {
  return (
    <svg
      className="run-search-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </svg>
  );
}

function optionText(option: Pick<RunPickerOption, 'name' | 'note'>): string {
  return option.note ? `${option.name} — ${option.note}` : option.name;
}

const NONE_VALUE = '';

/**
 * A run selector shown as a search field: opening it offers a search box and the runs grouped by
 * model. Searching matches the run name only and happens in the browser, so a long
 * run list costs one request per page. The search starts empty every time it opens.
 */
export function RunPicker({
  label,
  value,
  options,
  onChange,
  disabled = false,
  placeholder = '',
  missingLabel,
  noneLabel,
  clearLabel
}: RunPickerProps) {
  const baseId = useId();
  const listboxId = `${baseId}-listbox`;
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeValue, setActiveValue] = useState<string | null>(null);

  const selected = options.find((option) => option.value === value);
  const closedText = selected
    ? optionText(selected)
    : value ? missingLabel || value : noneLabel ?? placeholder;
  const groups = useMemo(() => groupRunsByModel(options, query), [options, query]);
  const hasNone = noneLabel !== undefined;
  const choices = [...(hasNone ? [NONE_VALUE] : []), ...groups.flatMap((group) => group.items.map((item) => item.value))];
  const optionId = (index: number) => `${baseId}-option-${index}`;
  const activeIndex = activeValue === null ? -1 : choices.indexOf(activeValue);

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  const openPicker = (initialQuery = '') => {
    if (disabled) return;
    setQuery(initialQuery);
    setActiveValue(initialQuery ? null : value);
    setOpen(true);
  };

  const choose = (nextValue: string) => {
    close(true);
    if (nextValue !== value) onChange(nextValue);
  };

  // The highlighted run follows the search: the current run on opening, then the first match.
  const resolvedActive = activeIndex >= 0
    ? activeIndex
    : choices.findIndex((choice) => !query.trim() || choice !== NONE_VALUE);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: globalThis.MouseEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', closeOutside);
    return () => document.removeEventListener('mousedown', closeOutside);
  }, [open]);

  useEffect(() => {
    // Keep the highlighted run in view without scrolling the page.
    const list = listRef.current;
    const item = resolvedActive >= 0 ? document.getElementById(optionId(resolvedActive)) : null;
    if (!open || !list || !item) return;
    if (item.offsetTop < list.scrollTop) list.scrollTop = item.offsetTop;
    else if (item.offsetTop + item.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = item.offsetTop + item.offsetHeight - list.clientHeight;
    }
  });

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (open) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      openPicker();
    } else if (event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      // Typing on the closed field starts a search with that character.
      event.preventDefault();
      openPicker(event.key);
    }
  };

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (choices.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const next = Math.min(choices.length - 1, Math.max(0, resolvedActive + step));
      setActiveValue(choices[next]);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (resolvedActive >= 0) choose(choices[resolvedActive]);
    } else if (event.key === 'Escape') {
      // Close only the picker, not a guided tour listening for Escape further up.
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === 'Tab') {
      // Tab closes the list and moves on from the field.
      close(true);
    }
  };

  // The pickers sit inside <label>s: a click on the list must not also re-activate the field.
  const keepFieldFocus = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target !== inputRef.current) event.preventDefault();
  };

  let index = -1;
  const renderOption = (optionValue: string, name: string, note?: string) => {
    index += 1;
    const optionIndex = index;
    return (
      <div
        key={`${optionValue}:${optionIndex}`}
        id={optionId(optionIndex)}
        role="option"
        aria-selected={optionValue === value}
        className={`run-picker-option${optionIndex === resolvedActive ? ' is-active' : ''}`}
        onMouseMove={() => { if (optionIndex !== resolvedActive) setActiveValue(optionValue); }}
        onClick={() => choose(optionValue)}
      >
        <span className="run-picker-option-name">{name}</span>
        {note && <span className="run-picker-option-note"> · {note}</span>}
      </div>
    );
  };

  return (
    <div
      ref={rootRef}
      className={`run-picker${clearLabel && value && !disabled ? ' has-clear' : ''}`}
      onBlur={(event) => {
        if (open && event.relatedTarget instanceof Node && !rootRef.current?.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        className="run-picker-trigger"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        disabled={disabled}
        onClick={() => (open ? close(true) : openPicker())}
        onKeyDown={onTriggerKeyDown}
      >
        <SearchIcon />
        <span className="run-picker-value">{closedText}</span>
      </button>
      {clearLabel && value && !disabled && (
        <button
          type="button"
          className="run-picker-clear"
          aria-label={clearLabel}
          title={clearLabel}
          onClick={() => {
            setOpen(false);
            onChange(NONE_VALUE);
            triggerRef.current?.focus();
          }}
        >
          <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M3 3l6 6M9 3l-6 6" /></svg>
        </button>
      )}
      {open && (
        <div className="run-picker-popup" onMouseDown={keepFieldFocus} onClick={keepFieldFocus}>
          <div className="run-search-field run-picker-search">
            <SearchIcon />
            <input
              ref={inputRef}
              type="search"
              value={query}
              placeholder="Search runs"
              aria-label="Search runs"
              aria-controls={listboxId}
              aria-activedescendant={resolvedActive >= 0 ? optionId(resolvedActive) : undefined}
              aria-autocomplete="list"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveValue(null);
              }}
              onKeyDown={onSearchKeyDown}
            />
          </div>
          <div ref={listRef} id={listboxId} role="listbox" aria-label={label} className="run-picker-list">
            {hasNone && renderOption(NONE_VALUE, noneLabel)}
            {groups.map((group) => (
              <div key={group.id} role="group" aria-labelledby={`${baseId}-${group.id}`} className="run-picker-group">
                <div id={`${baseId}-${group.id}`} role="presentation" className="run-picker-group-label">{group.label}</div>
                {group.items.map((item) => renderOption(item.value, item.name, item.note))}
              </div>
            ))}
          </div>
          {groups.length === 0 && (
            <p className="run-picker-empty" role="status">
              {query.trim() ? `No runs match “${query.trim()}”.` : 'No runs yet.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
