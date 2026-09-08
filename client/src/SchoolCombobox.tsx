import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';
import type { School } from './types';

// A searchable, keyboard-navigable school picker. Replaces the native <select>
// for the district-size school list: type to filter by name or school number,
// use Up/Down + Enter to pick, Esc to dismiss. Exposes the same value semantics
// as a <select> (a school id string, '' for "no selection").
export function SchoolCombobox({
  schools,
  value,
  onChange,
  emptyLabel = 'Select a school…',
  ariaLabel = 'Select school',
  allowEmpty = false,
  leadingIcon
}: {
  schools: School[];
  value: string;
  onChange: (schoolId: string) => void;
  emptyLabel?: string;
  ariaLabel?: string;
  /** When true, the user may clear back to the empty state ('' value). */
  allowEmpty?: boolean;
  leadingIcon?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selected = schools.find((school) => school.id === value) ?? null;

  // Keep the input text in sync with the selected school when not typing.
  useEffect(() => {
    if (!open) setText(selected?.name ?? '');
  }, [open, selected?.name]);

  const filtered = useMemo(() => {
    const needle = text.trim().toLowerCase();
    if (!needle) return schools;
    return schools.filter(
      (school) =>
        school.name.toLowerCase().includes(needle) ||
        school.schoolNumber.toLowerCase().includes(needle)
    );
  }, [schools, text]);

  // Reset highlight whenever the visible options change.
  useEffect(() => {
    setHighlighted(0);
  }, [filtered]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    function onDocClick(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Scroll the highlighted option into view.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.children[highlighted] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [open, highlighted]);

  function commit(school: School | null) {
    onChange(school ? school.id : '');
    setOpen(false);
    setText(school?.name ?? '');
    inputRef.current?.blur();
  }

  function clear() {
    onChange('');
    setOpen(false);
    setText('');
    inputRef.current?.blur();
  }

  function onFocus() {
    setOpen(true);
    // Select the current text so typing replaces it (like a combobox).
    requestAnimationFrame(() => inputRef.current?.select());
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) setOpen(true);
      setHighlighted((h) => Math.min(h + 1, filtered.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) setOpen(true);
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (open && filtered.length > 0) {
        commit(filtered[highlighted] ?? null);
      } else {
        setOpen(true);
      }
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  }

  const showClear = allowEmpty && Boolean(selected);

  return (
    <div className="school-combobox" ref={rootRef}>
      {leadingIcon}
      <input
        ref={inputRef}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-controls={open ? 'school-combobox-list' : undefined}
        aria-activedescendant={
          open && filtered[highlighted] ? `school-combobox-opt-${filtered[highlighted].id}` : undefined
        }
        aria-label={ariaLabel}
        placeholder={emptyLabel}
        value={text}
        onFocus={onFocus}
        onBlur={() => setOpen(false)}
        onChange={(event) => {
          setText(event.target.value);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />
      {showClear && (
        <button
          type="button"
          className="field-clear combobox-clear"
          onClick={clear}
          aria-label="Clear selection"
          tabIndex={-1}
        >
          <X size={14} />
        </button>
      )}
      <ChevronDown size={15} aria-hidden="true" className="combobox-chevron" />
      {open && (
        <ul id="school-combobox-list" className="school-combobox-list" role="listbox" ref={listRef}>
          {filtered.length === 0 ? (
            <li className="school-combobox-empty" role="option" aria-disabled="true">
              No schools found
            </li>
          ) : (
            filtered.map((school, index) => {
              const isSelected = school.id === value;
              return (
                <li
                  key={school.id}
                  id={`school-combobox-opt-${school.id}`}
                  role="option"
                  aria-selected={isSelected}
                  className={`school-combobox-option${index === highlighted ? ' highlighted' : ''}${isSelected ? ' selected' : ''}`}
                  onMouseEnter={() => setHighlighted(index)}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    commit(school);
                  }}
                >
                  <span className="school-combobox-name">{school.name}</span>
                  <span className="school-combobox-number">{school.schoolNumber}</span>
                  {isSelected && <Check size={15} aria-hidden="true" className="combobox-check" />}
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
