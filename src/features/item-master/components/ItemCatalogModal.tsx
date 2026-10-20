import React, { useEffect, useMemo, useState } from "react";
import Modal from "@/components/dialogs/Modal";
import SearchableCombobox from "@/components/forms/SearchableCombobox";
import { optionListAPI } from "@/lib/api";
import { getErrorMessage } from "@/lib/utils/errorMessage";
import { useMachineCodeOptions } from "@/features/item-master/hooks/useMachineCodeOptions";
import { useItemGroupOptions } from "@/features/item-master/hooks/useItemGroupOptions";
import DepartmentCheckboxes from "@/components/forms/DepartmentCheckboxes";
import { formatLocalDate, formatMilitaryTime } from "@/lib/utils/format";
import { copyToClipboard, formatItemForRegistration } from "@/lib/utils/clipboard";
import type { ItemCatalogEntry, OptionListEntry } from "@/types";
import {
  createItemCatalogEntryAction as createItemCatalogEntryResult,
  deleteItemCatalogEntryAction as deleteItemCatalogEntryResult,
  getItemCatalogAction,
  getOptionListAction,
  updateItemCatalogEntryAction as updateItemCatalogEntryResult,
} from "@/features/item-master/actions/reference-data";
import { throwOnError } from "@/lib/utils/actionResult";

const createItemCatalogEntryAction = throwOnError(createItemCatalogEntryResult);
const updateItemCatalogEntryAction = throwOnError(updateItemCatalogEntryResult);
const deleteItemCatalogEntryAction = throwOnError(deleteItemCatalogEntryResult);

interface ItemCatalogModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Human-readable labels for the two approval_level values — see db/schema.ts's itemCatalog.approval_level. */
const APPROVAL_LEVEL_LABELS: Record<string, string> = {
  MANAGER_ONLY: "Manager Only",
  SUPERVISOR_OR_MANAGER: "Supervisor or Manager",
};

const emptyForm = { item_name: "", uom: "", machine_code: "", item_group: "", approval_level: "", departments: [] as string[] };
type CatalogForm = typeof emptyForm;

const formFromEntry = (entry: ItemCatalogEntry): CatalogForm => ({
  item_name: entry.item_name,
  uom: entry.uom,
  machine_code: entry.machine_code ?? "",
  item_group: entry.item_group ?? "",
  approval_level: entry.approval_level,
  departments: entry.departments ? entry.departments.split(",") : [],
});


/**
 * Custodian-maintained reference list (name/UoM/machine code) — see the ARCH
 * note on server/src/db/schema.ts's itemCatalog. Purely a catalog: adding an
 * entry here does not create or affect any actual item request.
 */
const ItemCatalogModal: React.FC<ItemCatalogModalProps> = ({ isOpen, onClose }) => {
  const [entries, setEntries] = useState<ItemCatalogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<CatalogForm>(emptyForm);
  const [uomEntries, setUomEntries] = useState<OptionListEntry[]>([]);
  const uomOptions = useMemo(() => uomEntries.map((o) => o.value), [uomEntries]);
  const machineCodeOptions = useMachineCodeOptions();
  const itemGroupOptions = useItemGroupOptions();

  // Suggestions for Item Name come from the catalog itself rather than a
  // fixed list — there's no fixed set of item names the way there is for
  // UoM, just whatever's already been added.
  const itemNameSuggestions = useMemo(
    () => Array.from(new Set(entries.map((entry) => entry.item_name))).sort(),
    [entries]
  );

  // The add-form fields double as a live filter on the table below — typing
  // into any of them narrows the list to entries matching what's typed so
  // far in that field (case-insensitive substring, blank = no filter).
  const filteredEntries = useMemo(() => {
    const nameQuery = form.item_name.trim().toLowerCase();
    const uomQuery = form.uom.trim().toLowerCase();
    const machineCodeQuery = form.machine_code.trim().toLowerCase();
    const itemGroupQuery = form.item_group.trim().toLowerCase();
    return entries.filter((entry) =>
      (!nameQuery || entry.item_name.toLowerCase().includes(nameQuery)) &&
      (!uomQuery || entry.uom.toLowerCase().includes(uomQuery)) &&
      (!machineCodeQuery || (entry.machine_code ?? "").toLowerCase().includes(machineCodeQuery)) &&
      (!itemGroupQuery || (entry.item_group ?? "").toLowerCase().includes(itemGroupQuery))
    );
  }, [entries, form.item_name, form.uom, form.machine_code, form.item_group]);

  const load = async () => {
    setLoading(true);
    try {
      const [entriesRes, uomsRes] = await Promise.all([
        getItemCatalogAction(),
        getOptionListAction("uom"),
      ]);
      setEntries(entriesRes);
      setUomEntries(uomsRes);
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to load item catalog"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      load();
      setForm(emptyForm);
      setEditingId(null);
      setError(null);
    }
  }, [isOpen]);

  const sortByValue = (list: OptionListEntry[]) => [...list].sort((a, b) => a.value.localeCompare(b.value));

  // Persists a typed UoM value that isn't in the option list yet (see
  // SearchableCombobox's onAddNew) so it's a suggestion everywhere this list
  // is used from then on, not just remembered for this one field. Returns
  // the canonical (server-uppercased) value so the caller can sync its field
  // to it — what was typed and what gets saved can differ in case.
  const addUomOption = async (value: string): Promise<string | undefined> => {
    try {
      const res = await optionListAPI.create("uom", value);
      setUomEntries((prev) => (prev.some((o) => o.id === res.data.id) ? prev : sortByValue([...prev, res.data])));
      return res.data.value;
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to add option"));
      return undefined;
    }
  };

  // Renames a UoM option in place — used by the "pencil" icon
  // SearchableCombobox shows on each suggestion. If the field currently
  // holding the old value is the one being edited, it's kept in sync so the
  // form doesn't end up pointing at a name that no longer exists.
  const editUomOption = async (oldValue: string, newValue: string) => {
    const target = uomEntries.find((o) => o.value.toUpperCase() === oldValue.toUpperCase());
    if (!target) return;
    try {
      const res = await optionListAPI.update(target.id, newValue);
      setUomEntries((prev) => sortByValue(prev.map((o) => (o.id === target.id ? res.data : o))));
      setForm((f) => (f.uom.toUpperCase() === oldValue.toUpperCase() ? { ...f, uom: res.data.value } : f));
      setEditForm((f) => (f.uom.toUpperCase() === oldValue.toUpperCase() ? { ...f, uom: res.data.value } : f));
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to rename option"));
    }
  };

  // Removes a UoM option entirely — used by the "×" icon SearchableCombobox
  // shows on each suggestion. Only drops it from the suggestion list; any
  // field currently holding that value keeps it as a (now un-suggested)
  // free-typed value, same as any other custom entry.
  const deleteUomOption = async (value: string) => {
    const target = uomEntries.find((o) => o.value.toUpperCase() === value.toUpperCase());
    if (!target) return;
    if (!confirm(`Remove "${value}" from the UoM option list?`)) return;
    try {
      await optionListAPI.delete(target.id);
      setUomEntries((prev) => prev.filter((o) => o.id !== target.id));
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to delete option"));
    }
  };

  const toggleFormDepartment = (dept: string) =>
    setForm((f) => ({
      ...f,
      departments: f.departments.includes(dept) ? f.departments.filter((d) => d !== dept) : [...f.departments, dept],
    }));

  const toggleEditDepartment = (dept: string) =>
    setEditForm((f) => ({
      ...f,
      departments: f.departments.includes(dept) ? f.departments.filter((d) => d !== dept) : [...f.departments, dept],
    }));

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const itemName = form.item_name.trim();
    const uom = form.uom.trim();
    const machineCode = form.machine_code.trim();
    const itemGroup = form.item_group.trim();
    const approvalLevel = form.approval_level;
    if (!itemName || !uom || !approvalLevel) {
      setError("Item Name, UoM, and Approver Level are all required.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await createItemCatalogEntryAction({
        item_name: itemName,
        uom,
        machine_code: machineCode || undefined,
        item_group: itemGroup || undefined,
        approval_level: approvalLevel as "MANAGER_ONLY" | "SUPERVISOR_OR_MANAGER",
        departments: form.departments,
      });
      setForm(emptyForm);
      await load();
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to add item"));
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (entry: ItemCatalogEntry) => {
    setEditingId(entry.id);
    setEditForm(formFromEntry(entry));
    setError(null);
  };

  const cancelEdit = () => setEditingId(null);

  const saveEdit = async (id: number) => {
    const itemName = editForm.item_name.trim();
    const uom = editForm.uom.trim();
    const machineCode = editForm.machine_code.trim();
    const itemGroup = editForm.item_group.trim();
    const approvalLevel = editForm.approval_level;
    if (!itemName || !uom || !approvalLevel) {
      setError("Item Name, UoM, and Approver Level are all required.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await updateItemCatalogEntryAction(id, {
        item_name: itemName,
        uom,
        machine_code: machineCode || undefined,
        item_group: itemGroup || undefined,
        approval_level: approvalLevel as "MANAGER_ONLY" | "SUPERVISOR_OR_MANAGER",
        departments: editForm.departments,
      });
      setEditingId(null);
      await load();
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to update item"));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number, itemName: string) => {
    if (!confirm(`Remove "${itemName}" from the item catalog?`)) return;
    try {
      await deleteItemCatalogEntryAction(id);
      setEntries((prev) => prev.filter((entry) => entry.id !== id));
    } catch (err: unknown) {
      alert(getErrorMessage(err, "Failed to delete item"));
    }
  };

  // Registers this catalog entry on the external accounting system — see
  // ItemListPage.tsx's handleCopyForRegistration and clipboard.ts's
  // formatItemForRegistration for the same caveat: unlike the grid-paste
  // helpers, this target is a single-record form, not confirmed to
  // distribute a pasted value across its fields the same way a grid does.
  const handleCopyForRegistration = async (entry: ItemCatalogEntry) => {
    const ok = await copyToClipboard(formatItemForRegistration(entry));
    if (!ok) {
      alert("Copy failed — your browser blocked clipboard access.");
      return;
    }
    setCopiedId(entry.id);
    setTimeout(() => setCopiedId((id) => (id === entry.id ? null : id)), 1500);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="ITEM LIST">
      <form onSubmit={handleAdd} className="row g-2 align-items-end mb-3">
        <div className="col-12 col-sm-3">
          <label className="form-label small mb-1">ITEM NAME</label>
          <SearchableCombobox
            value={form.item_name}
            onChange={(value) => setForm({ ...form, item_name: value.toUpperCase() })}
            options={itemNameSuggestions}
            placeholder="Type to search…"
            required
          />
        </div>
        <div className="col-12 col-sm-2">
          <label className="form-label small mb-1">UoM *</label>
          <SearchableCombobox
            value={form.uom}
            onChange={(value) => setForm({ ...form, uom: value })}
            options={uomOptions}
            placeholder="Type to search…"
            required
            onAddNew={async (value) => {
              const resolved = await addUomOption(value);
              if (resolved) setForm((f) => ({ ...f, uom: resolved }));
            }}
            onEditOption={editUomOption}
            onDeleteOption={deleteUomOption}
          />
        </div>
        <div className="col-12 col-sm-2">
          <label className="form-label small mb-1">MACHINE CODE</label>
          <SearchableCombobox
            value={form.machine_code}
            onChange={(value) => setForm({ ...form, machine_code: value })}
            options={machineCodeOptions.options}
            descriptions={machineCodeOptions.descriptions}
            placeholder="Type to search…"
            onAddNew={async (value) => {
              const resolved = await machineCodeOptions.addOption(value);
              if (resolved) setForm((f) => ({ ...f, machine_code: resolved }));
            }}
            onEditOption={machineCodeOptions.editOption}
            onDeleteOption={machineCodeOptions.deleteOption}
          />
        </div>
        <div className="col-12 col-sm-2">
          <label className="form-label small mb-1">ITEM GROUP</label>
          <SearchableCombobox
            value={form.item_group}
            onChange={(value) => setForm({ ...form, item_group: value })}
            options={itemGroupOptions.options}
            placeholder="Type to search…"
            onAddNew={async (value) => {
              const resolved = await itemGroupOptions.addOption(value);
              if (resolved) setForm((f) => ({ ...f, item_group: resolved }));
            }}
            onEditOption={itemGroupOptions.editOption}
            onDeleteOption={itemGroupOptions.deleteOption}
          />
        </div>
        <div className="col-12 col-sm-3">
          <label className="form-label small mb-1">APPROVER LEVEL *</label>
          <select
            className="form-select form-select-sm"
            value={form.approval_level}
            onChange={(e) => setForm({ ...form, approval_level: e.target.value })}
            required
          >
            <option value="" disabled>Select…</option>
            <option value="MANAGER_ONLY">Manager Only</option>
            <option value="SUPERVISOR_OR_MANAGER">Supervisor or Manager</option>
          </select>
        </div>
        <div className="col-12">
          <label className="form-label small mb-1">DEPARTMENTS (leave blank for all departments)</label>
          <DepartmentCheckboxes selected={form.departments} onToggle={toggleFormDepartment} idPrefix="add-dept" />
        </div>
        <div className="col-12 col-sm-2">
          <button type="submit" className="btn btn-primary btn-sm w-100" disabled={saving}>
            {saving ? "Adding…" : "+ Add Item"}
          </button>
        </div>
      </form>

      {error && <div className="alert alert-danger py-1 px-2 small">{error}</div>}

      <div className="table-responsive" style={{ maxHeight: "320px", overflowY: "auto" }}>
        <table className="table table-sm table-hover mb-0">
          <thead className="table-light" style={{ position: "sticky", top: 0 }}>
            <tr>
              <th>Item Name</th>
              <th>UoM</th>
              <th>Machine Code</th>
              <th>Item Group</th>
              <th>Approver Level</th>
              <th>Departments</th>
              <th>Created</th>
              <th style={{ width: "110px" }}></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="text-center text-muted py-3">Loading…</td></tr>
            ) : entries.length === 0 ? (
              <tr><td colSpan={8} className="text-center text-muted py-3">No items in the catalog yet.</td></tr>
            ) : filteredEntries.length === 0 ? (
              <tr><td colSpan={8} className="text-center text-muted py-3">No items match your search.</td></tr>
            ) : (
              filteredEntries.map((entry) =>
                editingId === entry.id ? (
                  <tr key={entry.id}>
                    <td>
                      <SearchableCombobox
                        value={editForm.item_name}
                        onChange={(value) => setEditForm({ ...editForm, item_name: value.toUpperCase() })}
                        options={itemNameSuggestions}
                        placeholder="Type to search…"
                        required
                      />
                    </td>
                    <td>
                      <SearchableCombobox
                        value={editForm.uom}
                        onChange={(value) => setEditForm({ ...editForm, uom: value })}
                        options={uomOptions}
                        placeholder="Type to search…"
                        required
                        onAddNew={async (value) => {
                          const resolved = await addUomOption(value);
                          if (resolved) setEditForm((f) => ({ ...f, uom: resolved }));
                        }}
                        onEditOption={editUomOption}
                        onDeleteOption={deleteUomOption}
                      />
                    </td>
                    <td>
                      <SearchableCombobox
                        value={editForm.machine_code}
                        onChange={(value) => setEditForm({ ...editForm, machine_code: value })}
                        options={machineCodeOptions.options}
            descriptions={machineCodeOptions.descriptions}
                        placeholder="Type to search…"
                        onAddNew={async (value) => {
                          const resolved = await machineCodeOptions.addOption(value);
                          if (resolved) setEditForm((f) => ({ ...f, machine_code: resolved }));
                        }}
                        onEditOption={machineCodeOptions.editOption}
                        onDeleteOption={machineCodeOptions.deleteOption}
                      />
                    </td>
                    <td>
                      <SearchableCombobox
                        value={editForm.item_group}
                        onChange={(value) => setEditForm({ ...editForm, item_group: value })}
                        options={itemGroupOptions.options}
                        placeholder="Type to search…"
                        onAddNew={async (value) => {
                          const resolved = await itemGroupOptions.addOption(value);
                          if (resolved) setEditForm((f) => ({ ...f, item_group: resolved }));
                        }}
                        onEditOption={itemGroupOptions.editOption}
                        onDeleteOption={itemGroupOptions.deleteOption}
                      />
                    </td>
                    <td>
                      <select
                        className="form-select form-select-sm"
                        value={editForm.approval_level}
                        onChange={(e) => setEditForm({ ...editForm, approval_level: e.target.value })}
                        required
                      >
                        <option value="" disabled>Select…</option>
                        <option value="MANAGER_ONLY">Manager Only</option>
                        <option value="SUPERVISOR_OR_MANAGER">Supervisor or Manager</option>
                      </select>
                    </td>
                    <td style={{ minWidth: "220px" }}>
                      <DepartmentCheckboxes selected={editForm.departments} onToggle={toggleEditDepartment} idPrefix={`edit-dept-${entry.id}`} />
                    </td>
                    <td className="text-muted text-nowrap">
                      {formatLocalDate(entry.created_at)} {formatMilitaryTime(entry.created_at)}
                    </td>
                    <td className="text-nowrap">
                      <button
                        type="button"
                        className="btn btn-sm btn-link text-success p-0 me-2"
                        title="Save"
                        aria-label={`Save ${entry.item_name}`}
                        disabled={saving}
                        onClick={() => saveEdit(entry.id)}
                      >
                        <i className="bi bi-check-lg"></i>
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-link text-muted p-0"
                        title="Cancel"
                        aria-label="Cancel edit"
                        disabled={saving}
                        onClick={cancelEdit}
                      >
                        <i className="bi bi-x-lg"></i>
                      </button>
                    </td>
                  </tr>
                ) : (
                  <tr key={entry.id}>
                    <td>{entry.item_name}</td>
                    <td>{entry.uom}</td>
                    <td>{entry.machine_code || <span className="text-muted">—</span>}</td>
                    <td>{entry.item_group || <span className="text-muted">—</span>}</td>
                    <td>
                      {entry.approval_level === "MANAGER_ONLY" ? (
                        <span className="badge bg-warning text-dark">{APPROVAL_LEVEL_LABELS.MANAGER_ONLY}</span>
                      ) : (
                        APPROVAL_LEVEL_LABELS[entry.approval_level] || entry.approval_level
                      )}
                    </td>
                    <td>
                      {entry.departments ? entry.departments.split(",").join(", ") : <span className="text-muted">All Departments</span>}
                    </td>
                    <td className="text-muted text-nowrap">
                      {formatLocalDate(entry.created_at)} {formatMilitaryTime(entry.created_at)}
                    </td>
                    <td className="text-nowrap">
                      <button
                        type="button"
                        className="btn btn-sm btn-link p-0 me-2"
                        title="Copy Description/Item Type/Item Group/UoM Group — paste into the external accounting system's Item Master Data screen to register this item"
                        aria-label={`Copy ${entry.item_name} for registration`}
                        onClick={() => handleCopyForRegistration(entry)}
                      >
                        <i className={copiedId === entry.id ? "bi bi-check-lg text-success" : "bi bi-clipboard"}></i>
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-link p-0 me-2"
                        title="Edit"
                        aria-label={`Edit ${entry.item_name}`}
                        onClick={() => startEdit(entry)}
                      >
                        <i className="bi bi-pencil"></i>
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-link text-danger p-0"
                        title="Delete"
                        aria-label={`Delete ${entry.item_name}`}
                        onClick={() => handleDelete(entry.id, entry.item_name)}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                )
              )
            )}
          </tbody>
        </table>
      </div>
    </Modal>
  );
};

export default ItemCatalogModal;
