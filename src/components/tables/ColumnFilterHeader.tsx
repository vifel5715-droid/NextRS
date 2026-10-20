import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "@/components/tables/ColumnFilterHeader.module.css";

export type SortDirection = "asc" | "desc";

interface ColumnFilterHeaderProps {
  label: string;
  /** Every distinct value this column can be filtered on (already de-duplicated). */
  values: readonly string[];
  /** The checked values, or null when the column is unfiltered (everything shown). */
  selected: ReadonlySet<string> | null;
  onFilterChange: (selected: Set<string> | null) => void;
  /** This column's active sort direction, or null when another column (or none) is sorted. */
  sortDirection: SortDirection | null;
  onSort: (direction: SortDirection) => void;
}

const MENU_WIDTH = 260;
const MAX_LISTED_VALUES = 1000;

// Inline SVGs: the app has no icon font, only a few `.bi-*` glyphs mapped in globals.css.
const svgProps = { width: 12, height: 12, viewBox: "0 0 16 16", fill: "currentColor", "aria-hidden": true } as const;

const CaretIcon = () => (
  <svg {...svgProps}><path d="M3 5.5h10L8 11.5z" /></svg>
);

const FunnelIcon = ({ filled = true }: { filled?: boolean }) => (
  <svg {...svgProps}>
    <path
      d="M1.5 2h13l-5 6.2V13l-3 1.5V8.2z"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinejoin="round"
    />
  </svg>
);

const SortIcon = ({ direction }: { direction: SortDirection }) => (
  <svg {...svgProps} width={14} height={14}>
    <text x="0" y="7" fontSize="7" fontWeight="700" fontFamily="sans-serif">{direction === "asc" ? "A" : "Z"}</text>
    <text x="0" y="15" fontSize="7" fontWeight="700" fontFamily="sans-serif">{direction === "asc" ? "Z" : "A"}</text>
    <path d="M11.5 1.5v11M9 10l2.5 3 2.5-3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * A table header label with an Excel-style dropdown arrow: Sort A to Z / Z to
 * A, Clear Filter, a search box and a (Select All) checkbox list of the
 * column's values. Checkbox changes only apply on OK, like Excel.
 */
const ColumnFilterHeader: React.FC<ColumnFilterHeaderProps> = ({
  label,
  values,
  selected,
  onFilterChange,
  sortDirection,
  onSort,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const sortedValues = useMemo(
    () => [...values].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })),
    [values]
  );
  const isFiltered = selected !== null;

  const open = () => {
    setDraft(new Set(selected ?? values));
    setSearch("");
    setIsOpen(true);
  };
  const close = () => setIsOpen(false);

  useEffect(() => {
    if (!isOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setIsOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [isOpen]);

  // Portaled + fixed for the same reason as SearchableCombobox: the table's
  // .table-responsive wrapper would clip an absolutely positioned menu.
  useLayoutEffect(() => {
    if (!isOpen) return;
    const update = () => {
      if (!buttonRef.current) return;
      const rect = buttonRef.current.getBoundingClientRect();
      const margin = 8;
      const viewportWidth = document.documentElement.clientWidth;
      const width = Math.min(MENU_WIDTH, viewportWidth - margin * 2);
      const left = Math.max(margin, Math.min(rect.right - width, viewportWidth - width - margin));
      const top = rect.bottom + 4;
      setMenuPos({ top, left, maxHeight: Math.max(220, window.innerHeight - top - margin) });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [isOpen]);

  const query = search.trim().toLowerCase();
  const visibleValues = query ? sortedValues.filter((v) => v.toLowerCase().includes(query)) : sortedValues;
  const listedValues = visibleValues.slice(0, MAX_LISTED_VALUES);
  const allVisibleChecked = visibleValues.length > 0 && visibleValues.every((v) => draft.has(v));
  const someVisibleChecked = visibleValues.some((v) => draft.has(v));

  const toggleValue = (value: string) => {
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  };

  const toggleAllVisible = () => {
    setDraft((prev) => {
      const next = new Set(prev);
      visibleValues.forEach((v) => (allVisibleChecked ? next.delete(v) : next.add(v)));
      return next;
    });
  };

  const applyDraft = () => {
    // With a search typed, Excel keeps only the matching values that are checked.
    const chosen = query ? new Set(visibleValues.filter((v) => draft.has(v))) : draft;
    const coversEverything = values.every((v) => chosen.has(v));
    onFilterChange(coversEverything ? null : new Set(chosen));
    close();
  };

  return (
    <span className={styles.header}>
      <button
        ref={buttonRef}
        type="button"
        className={`${styles.trigger} ${isOpen ? styles.triggerOpen : ""}`}
        title={isFiltered ? `${label}: filtered — click to change` : `Sort or filter ${label}`}
        aria-label={`Filter and sort ${label}`}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={() => (isOpen ? close() : open())}
      >
        <span>{label}</span>
        <span className={`${styles.arrowButton} ${isFiltered || sortDirection ? styles.arrowButtonActive : ""}`}>
          {isFiltered ? (
            <FunnelIcon />
          ) : sortDirection ? (
            <SortIcon direction={sortDirection} />
          ) : (
            <CaretIcon />
          )}
        </span>
      </button>
      {isOpen && menuPos && createPortal(
        <div
          ref={menuRef}
          className={styles.menu}
          style={{ top: menuPos.top, left: menuPos.left, width: Math.min(MENU_WIDTH, document.documentElement.clientWidth - 16), maxHeight: menuPos.maxHeight }}
          role="dialog"
          aria-label={`${label} filter`}
        >
          <button
            type="button"
            className={`${styles.menuItem} ${sortDirection === "asc" ? styles.menuItemActive : ""}`}
            onClick={() => { onSort("asc"); close(); }}
          >
            <SortIcon direction="asc" /> Sort A to Z
          </button>
          <button
            type="button"
            className={`${styles.menuItem} ${sortDirection === "desc" ? styles.menuItemActive : ""}`}
            onClick={() => { onSort("desc"); close(); }}
          >
            <SortIcon direction="desc" /> Sort Z to A
          </button>
          <div className={styles.divider}></div>
          <button
            type="button"
            className={styles.menuItem}
            disabled={!isFiltered}
            onClick={() => { onFilterChange(null); close(); }}
          >
            <FunnelIcon filled={false} /> Clear Filter From &quot;{label}&quot;
          </button>
          <div className={styles.divider}></div>
          <input
            type="text"
            className={`form-control form-control-sm ${styles.search}`}
            placeholder="Search"
            value={search}
            autoFocus
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); applyDraft(); }
            }}
          />
          <div className={styles.valueList}>
            {visibleValues.length === 0 ? (
              <div className={styles.empty}>No matches</div>
            ) : (
              <>
                <label className={styles.valueRow}>
                  <input
                    type="checkbox"
                    checked={allVisibleChecked}
                    ref={(el) => { if (el) el.indeterminate = !allVisibleChecked && someVisibleChecked; }}
                    onChange={toggleAllVisible}
                  />
                  <span>{query ? "(Select All Search Results)" : "(Select All)"}</span>
                </label>
                {listedValues.map((value) => (
                  <label key={value} className={styles.valueRow}>
                    <input type="checkbox" checked={draft.has(value)} onChange={() => toggleValue(value)} />
                    <span>{value}</span>
                  </label>
                ))}
                {visibleValues.length > listedValues.length && (
                  <div className={styles.empty}>
                    Showing first {MAX_LISTED_VALUES} of {visibleValues.length} — type to narrow the list.
                  </div>
                )}
              </>
            )}
          </div>
          <div className={styles.footer}>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={!(query ? visibleValues.some((v) => draft.has(v)) : draft.size > 0)}
              onClick={applyDraft}
            >
              OK
            </button>
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={close}>
              Cancel
            </button>
          </div>
        </div>,
        document.body
      )}
    </span>
  );
};

export default ColumnFilterHeader;
