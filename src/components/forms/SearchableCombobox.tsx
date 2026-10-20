import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "@/components/forms/SearchableCombobox.module.css";

interface SearchableComboboxProps {
  value: string;
  onChange: (value: string) => void;
  options: readonly string[];
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  id?: string;
  className?: string;
  /**
   * When given, typing a value with no exact (case-insensitive) match in
   * `options` shows a "+ Add '<value>' as new option" row. Selecting it
   * persists the value (caller's responsibility — e.g. an API call) so it's
   * available as a suggestion everywhere this list is used, not just here.
   */
  onAddNew?: (value: string) => void;
  /** When given, each suggestion gets an inline edit (pencil) icon that renames it in place. */
  onEditOption?: (oldValue: string, newValue: string) => void;
  /** When given, each suggestion gets a delete (×) icon that removes it from the list entirely. */
  onDeleteOption?: (value: string) => void;
  /** When given, pressing Enter in the input (closing the dropdown) also fires this — e.g. to trigger a per-row Save. */
  onEnter?: () => void;
  /** When given, shows this message in the dropdown instead of nothing when typing matches no option (and onAddNew isn't offered) — e.g. "No record found". */
  noResultsText?: string;
  /** When given, keyed by option value (case-insensitive), shows a muted subtitle under that suggestion — e.g. a Machine Code's full machine name. */
  descriptions?: Record<string, string>;
}

const DROPDOWN_MIN_WIDTH = 280;
const DROPDOWN_MAX_HEIGHT = 320;

/**
 * Free-typed text input with a filtered, click-to-pick suggestion list below
 * it — a value not in `options` is still accepted (typing IS the "Other"
 * path), matches are just an assist. Used where a plain <select> was too
 * rigid to search through a longer option list (Item Type, UoM).
 */
const SearchableCombobox: React.FC<SearchableComboboxProps> = ({
  value,
  onChange,
  options,
  placeholder = "Type to search…",
  required,
  disabled,
  id,
  className = "form-control form-control-sm text-uppercase",
  onAddNew,
  onEditOption,
  onDeleteOption,
  onEnter,
  noResultsText,
  descriptions,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [editingOption, setEditingOption] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownElRef = useRef<HTMLDivElement>(null);
  // Viewport-relative coordinates for the portaled dropdown below — see the
  // portal note on its render for why this can't just be `position: absolute`
  // inside wrapper.
  const [dropdownRect, setDropdownRect] = useState<
    { top?: number; bottom?: number; left: number; width: number; maxHeight: number } | null
  >(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      // The dropdown itself renders in a portal outside wrapperRef's DOM
      // subtree (see below), so a click inside it would otherwise register as
      // "outside" and close it — checked separately here.
      const target = e.target as Node;
      if (wrapperRef.current?.contains(target)) return;
      if (dropdownElRef.current?.contains(target)) return;
      setIsOpen(false);
      setEditingOption(null);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Recomputes on open and while open (scroll/resize) so the dropdown tracks
  // its input even when an ancestor (e.g. a table's .table-responsive
  // wrapper) scrolls — capture:true catches scroll on any nested scroll
  // container, not just window.
  useLayoutEffect(() => {
    if (!isOpen) return;
    const updatePosition = () => {
      if (!inputRef.current) return;
      const rect = inputRef.current.getBoundingClientRect();
      const margin = 8;
      const viewportWidth = document.documentElement.clientWidth;
      const viewportHeight = window.innerHeight;
      // Narrow table cells would otherwise squeeze every option to "AB…".
      const width = Math.min(Math.max(rect.width, DROPDOWN_MIN_WIDTH), viewportWidth - margin * 2);
      const left = Math.max(margin, Math.min(rect.left, viewportWidth - width - margin));
      const spaceBelow = viewportHeight - rect.bottom - margin;
      const spaceAbove = rect.top - margin;
      const openUp = spaceBelow < DROPDOWN_MAX_HEIGHT && spaceAbove > spaceBelow;
      setDropdownRect(
        openUp
          ? { bottom: viewportHeight - rect.top + 2, left, width, maxHeight: Math.min(DROPDOWN_MAX_HEIGHT, spaceAbove) }
          : { top: rect.bottom + 2, left, width, maxHeight: Math.min(DROPDOWN_MAX_HEIGHT, spaceBelow) }
      );
    };
    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [isOpen]);

  const trimmed = value.trim();
  const query = trimmed.toLowerCase();
  const matches = options.filter((option) => option.toLowerCase().includes(query));
  const hasExactMatch = options.some((option) => option.toLowerCase() === query);
  const showAddNew = !!onAddNew && trimmed.length > 0 && !hasExactMatch;
  const showNoResults = matches.length === 0 && !showAddNew && !!noResultsText && trimmed.length > 0;
  const showRowActions = !!onEditOption || !!onDeleteOption;

  const commitEdit = () => {
    const newValue = editingValue.trim();
    if (editingOption && newValue && newValue !== editingOption) {
      onEditOption?.(editingOption, newValue);
    }
    setEditingOption(null);
  };

  return (
    <div ref={wrapperRef} className={styles.wrapper}>
      <input
        ref={inputRef}
        id={id}
        type="text"
        className={className}
        value={value}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setIsOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setIsOpen(false);
          if (e.key === "Enter" && onEnter) {
            e.preventDefault();
            setIsOpen(false);
            onEnter();
          }
        }}
      />
      {isOpen && !disabled && (matches.length > 0 || showAddNew || showNoResults) && dropdownRect && createPortal(
        // Portaled to <body> and positioned fixed at the input's own
        // viewport coordinates (dropdownRect, kept in sync by the effect
        // above) rather than absolutely inside `wrapper` — a table row's
        // .table-responsive ancestor forces overflow-y to clip/scroll
        // anything, including an absolutely-positioned dropdown, that pokes
        // out below the visible table area. Escaping to <body> sidesteps
        // that clipping entirely. stopPropagation on every interactive
        // element below: an edit/delete click swaps that row's DOM (removing
        // the very button that was clicked) before the document-level
        // click-outside listener in the effect above gets to run, so by then
        // e.target has already been detached from the tree — stopping
        // propagation keeps the event from ever reaching that listener.
        <div
          ref={dropdownElRef}
          className={styles.dropdown}
          style={{
            position: "fixed",
            top: dropdownRect.top,
            bottom: dropdownRect.bottom,
            left: dropdownRect.left,
            width: dropdownRect.width,
            maxHeight: dropdownRect.maxHeight,
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {matches.map((option) =>
            editingOption === option ? (
              <div key={option} className={styles.optionRow}>
                <input
                  type="text"
                  className={styles.editInput}
                  value={editingValue}
                  autoFocus
                  onChange={(e) => setEditingValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); commitEdit(); }
                    if (e.key === "Escape") setEditingOption(null);
                  }}
                />
                <button
                  type="button"
                  className={styles.rowIcon}
                  title="Save"
                  aria-label={`Save ${option}`}
                  onClick={commitEdit}
                >
                  <i className="bi bi-check-lg"></i>
                </button>
                <button
                  type="button"
                  className={styles.rowIcon}
                  title="Cancel"
                  aria-label="Cancel edit"
                  onClick={() => setEditingOption(null)}
                >
                  <i className="bi bi-x-lg"></i>
                </button>
              </div>
            ) : (
              <div key={option} className={styles.optionRow}>
                <button
                  type="button"
                  className={styles.option}
                  onClick={() => {
                    onChange(option);
                    setIsOpen(false);
                  }}
                >
                  {option}
                  {descriptions?.[option.toUpperCase()] && (
                    <span className={styles.optionDescription}>{descriptions[option.toUpperCase()]}</span>
                  )}
                </button>
                {showRowActions && (
                  <>
                    {onEditOption && (
                      <button
                        type="button"
                        className={styles.rowIcon}
                        title="Edit option"
                        aria-label={`Edit ${option}`}
                        onClick={() => {
                          setEditingOption(option);
                          setEditingValue(option);
                        }}
                      >
                        <i className="bi bi-pencil"></i>
                      </button>
                    )}
                    {onDeleteOption && (
                      <button
                        type="button"
                        className={`${styles.rowIcon} ${styles.rowIconDanger}`}
                        title="Delete option"
                        aria-label={`Delete ${option}`}
                        onClick={() => onDeleteOption(option)}
                      >
                        ×
                      </button>
                    )}
                  </>
                )}
              </div>
            )
          )}
          {showAddNew && (
            <button
              type="button"
              className={`${styles.option} ${styles.addNew}`}
              onClick={() => {
                onAddNew?.(trimmed);
                setIsOpen(false);
              }}
            >
              + Add &quot;{trimmed}&quot; as new option
            </button>
          )}
          {showNoResults && (
            <div className={styles.optionRow} style={{ color: "#6c757d", cursor: "default" }}>
              {noResultsText}
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
};

export default SearchableCombobox;
