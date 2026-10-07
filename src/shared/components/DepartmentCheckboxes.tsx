import React from "react";
import { useDepartmentOptions } from "../hooks/useDepartmentOptions";

interface DepartmentCheckboxesProps {
  selected: string[];
  onToggle: (dept: string) => void;
  idPrefix: string;
}

/** Small checkbox row for picking which departments can request an item —
 * used by the item catalog's add form and inline edit row (ItemCatalogModal,
 * ItemListPage). Sourced from the same admin-managed Department option list
 * (useDepartmentOptions) as the Create/Edit User form, so a department added
 * there shows up here too without a page reload. */
const DepartmentCheckboxes: React.FC<DepartmentCheckboxesProps> = ({ selected, onToggle, idPrefix }) => {
  const { options: departmentOptions } = useDepartmentOptions();

  return (
    <div className="d-flex flex-wrap gap-3">
      {departmentOptions.map((dept) => (
        <div className="form-check form-check-inline m-0" key={dept}>
          <input
            className="form-check-input"
            type="checkbox"
            id={`${idPrefix}-${dept}`}
            checked={selected.includes(dept)}
            onChange={() => onToggle(dept)}
          />
          <label className="form-check-label small" htmlFor={`${idPrefix}-${dept}`}>{dept}</label>
        </div>
      ))}
    </div>
  );
};

export default DepartmentCheckboxes;
