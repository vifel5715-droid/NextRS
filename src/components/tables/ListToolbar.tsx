import React, { useId } from "react";

interface ListToolbarProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder: string;
  onExport: () => void;
  /** Disables the export button — e.g. nothing to export yet. */
  exportDisabled?: boolean;
}

/** Search box (left) + "Convert to Excel" button (right), sitting directly
 * under a list page's header — shared by Pending Items, Held Items, Pending
 * Services, and Delivered Items so the control row looks/behaves the same
 * everywhere it appears. */
const ListToolbar: React.FC<ListToolbarProps> = ({
  searchQuery,
  onSearchChange,
  searchPlaceholder,
  onExport,
  exportDisabled,
}) => {
  const searchId = useId();
  return (
  <div className="d-flex justify-content-between align-items-center gap-2 mb-3 flex-wrap">
    <div className="input-group" style={{ maxWidth: "420px" }}>
      <span className="input-group-text bg-white border-end-0">
        <i className="bi bi-search text-muted"></i>
      </span>
      <input
        id={searchId}
        name="search"
        type="text"
        aria-label={searchPlaceholder}
        className="form-control border-start-0 ps-0"
        placeholder={searchPlaceholder}
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        style={{ boxShadow: "none" }}
      />
    </div>
    <button
      type="button"
      className="btn btn-success btn-sm"
      onClick={onExport}
      disabled={exportDisabled}
    >
      <i className="bi bi-file-earmark-excel me-1"></i>Convert to Excel
    </button>
  </div>
  );
};

export default ListToolbar;
