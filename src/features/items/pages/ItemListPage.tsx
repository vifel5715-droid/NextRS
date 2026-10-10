import React, { useEffect, useMemo, useState } from "react";
import ListToolbar from "@shared/components/ListToolbar";
import Modal from "@shared/components/Modal";
import SearchableCombobox from "@shared/components/SearchableCombobox";
import { optionListAPI } from "../../../services/api";
import { exportToExcel } from "@shared/utils/exportExcel";
import { getErrorMessage } from "@shared/utils/errorMessage";
import { useMachineCodeOptions } from "@features/item-catalog/hooks/useMachineCodeOptions";
import { useItemGroupOptions } from "@features/item-catalog/hooks/useItemGroupOptions";
import { useOutedItemsContext } from "@app/providers/OutedItemsProvider";
import { useAuth } from "@app/providers/AuthProvider";
import DepartmentCheckboxes from "@shared/components/DepartmentCheckboxes";
import { formatDate, formatLocalDate, formatMilitaryTime } from "@shared/utils/format";
import { useDateRangeContext } from "@app/providers/DateRangeProvider";
import { filterByDateRange } from "@shared/utils/dateRange";
import DateRangeFilter from "@shared/components/DateRangeFilter";
import { copyToClipboard, formatItemForRegistration } from "@shared/utils/clipboard";
import type { ItemCatalogEntry, OptionListEntry } from "@shared/types";
import {
  createItemCatalogEntryAction,
  deleteItemCatalogEntryAction,
  getItemCatalogAction,
  getOptionListAction,
  updateItemCatalogEntryAction,
} from "@server/actions/reference-data";

/** Human-readable labels for the two approval_level values — see db/schema.ts's itemCatalog. */
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
 * Full item catalog as its own sidebar page — everyone who can see the
 * dashboards can browse it for reference (machine code, approver level,
 * which departments may request it); only custodian/admin get the add/edit/
 * delete controls, matching who could already manage it via the
 * CustodianDashboard "Item List" modal this page is the read-facing sibling of.
 */
const ItemListPage: React.FC = () => {
  const { user } = useAuth();
  const role = user?.role?.toLowerCase().trim() ?? "";
  const canManage = ["custodian", "admin"].includes(role);
  // Director has no single home department (see AdminDashboard's role
  // dropdown) — department-scoping the catalog for them the same way as a
  // staff/secretary viewer would hide entries they're specifically meant to
  // see everything of. Kept separate from canManage, which still alone gates
  // the add/edit/delete controls below.
  const seesFullCatalog = canManage || role === "director";
  const { startDate, endDate } = useDateRangeContext();

  const [entries, setEntries] = useState<ItemCatalogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<CatalogForm>(emptyForm);
  const [uomEntries, setUomEntries] = useState<OptionListEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [historyEntry, setHistoryEntry] = useState<ItemCatalogEntry | null>(null);
  const [page, setPage] = useState(1);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const uomOptions = useMemo(() => uomEntries.map((o) => o.value), [uomEntries]);
  const machineCodeOptions = useMachineCodeOptions();
  const itemGroupOptions = useItemGroupOptions();
  const outedItems = useOutedItemsContext();

  // Every time this catalog item was actually released to a requester, across
  // every request it's ever appeared on — matched by name since a catalog
  // entry has no direct link to the item lines that were created from it.
  // Item names are free-typed on the request side (see db/schema.ts's
  // itemCatalog ARCH note) and displayed in uppercase everywhere via CSS, not
  // by normalizing the stored text — so two names that look identical on
  // screen can still differ in case/whitespace underneath. A strict `===`
  // silently misses those and always reports "never released" even when the
  // Outed Items page clearly shows a match. Compare case/whitespace-insensitively.
  const normalizeItemName = (name: string) => name.trim().toUpperCase();
  const outedHistory = useMemo(() => {
    if (!historyEntry) return [];
    const targetName = normalizeItemName(historyEntry.item_name);
    return outedItems
      .flatMap((req) =>
        req.items
          .filter((item) => normalizeItemName(item.item_name) === targetName)
          .map((item) => ({
            key: `${req.id}-${item.issuance_number}-${item.issued_at}`,
            item_name: item.item_name,
            serial: req.serial,
            purpose: req.purpose,
            issuance_number: item.issuance_number || "",
            qty_out: item.quantity_out ?? 0,
            machine_code: item.machine_code || "",
            issued_at: item.issued_at,
          }))
      )
      .sort((a, b) => (b.issued_at || "").localeCompare(a.issued_at || ""));
  }, [outedItems, historyEntry]);

  // Custodian/admin manage the catalog across every department, so they see
  // it all. Everyone else is browsing for their own department's reference —
  // an item whose catalog entry lists specific departments is only shown to
  // those departments; unrestricted (null/empty departments) items stay
  // visible to everyone. Same rule as StaffDashboard's Create Item Request
  // catalog scoping.
  const visibleEntries = useMemo(() => {
    if (seesFullCatalog) return entries;
    const dept = (user?.department || "").toUpperCase();
    return entries.filter((entry) => {
      if (!entry.departments) return true;
      const allowed = entry.departments.split(",").map((d) => d.trim().toUpperCase());
      return allowed.includes(dept);
    });
  }, [entries, seesFullCatalog, user?.department]);

  const itemNameSuggestions = useMemo(
    () => Array.from(new Set(entries.map((entry) => entry.item_name))).sort(),
    [entries]
  );

  const filteredEntries = useMemo(() => {
    const inRange = filterByDateRange(visibleEntries, startDate, endDate, "created_at");
    const q = searchQuery.trim().toLowerCase();
    const matched = !q
      ? inRange
      : inRange.filter((entry) =>
          entry.item_name.toLowerCase().includes(q) ||
          entry.uom.toLowerCase().includes(q) ||
          (entry.machine_code ?? "").toLowerCase().includes(q) ||
          (entry.item_group ?? "").toLowerCase().includes(q) ||
          (entry.departments ?? "").toLowerCase().includes(q)
        );
    // Always alphabetical by Item Name, regardless of insertion/creation order.
    return [...matched].sort((a, b) => a.item_name.localeCompare(b.item_name));
  }, [visibleEntries, searchQuery, startDate, endDate]);

  // The catalog can run into the thousands of rows (bulk-imported item
  // lists), and rendering every <tr> at once froze the page — paginate
  // client-side instead. Reset to page 1 whenever the filtered set changes
  // shape so a stale page number doesn't land on an empty page.
  const PAGE_SIZE = 50;
  const totalPages = Math.max(1, Math.ceil(filteredEntries.length / PAGE_SIZE));
  useEffect(() => {
    setPage(1);
  }, [searchQuery, startDate, endDate]);
  useEffect(() => {
    setPage((p) => Math.min(p, totalPages));
  }, [totalPages]);
  const pagedEntries = useMemo(
    () => filteredEntries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filteredEntries, page]
  );

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
    void load();
  }, []);

  const sortByValue = (list: OptionListEntry[]) => [...list].sort((a, b) => a.value.localeCompare(b.value));

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

  // Registers this catalog entry on the external accounting system — paste
  // into that system's Item Master Data screen, starting from its
  // Description field. See clipboard.ts's formatItemForRegistration for the
  // important caveat: unlike the grid-paste helpers used elsewhere, this
  // target is a single-record form, not confirmed to distribute a pasted
  // value across its fields the same way a grid cell does.
  const handleCopyForRegistration = async (entry: ItemCatalogEntry) => {
    const ok = await copyToClipboard(formatItemForRegistration(entry));
    if (!ok) {
      alert("Copy failed — your browser blocked clipboard access.");
      return;
    }
    setCopiedId(entry.id);
    setTimeout(() => setCopiedId((id) => (id === entry.id ? null : id)), 1500);
  };

  const handleExport = () =>
    exportToExcel(
      "item-list",
      [
        { key: "item_name", label: "Item Name" },
        { key: "uom", label: "UoM" },
        { key: "machine_code", label: "Machine Code" },
        { key: "item_group", label: "Item Group" },
        { key: "approval_level", label: "Approver Level" },
        { key: "departments", label: "Departments" },
        { key: "created", label: "Created" },
      ],
      filteredEntries.map((entry) => ({
        item_name: entry.item_name,
        uom: entry.uom,
        machine_code: entry.machine_code || "",
        item_group: entry.item_group || "",
        approval_level: APPROVAL_LEVEL_LABELS[entry.approval_level] || entry.approval_level,
        departments: entry.departments ? entry.departments.split(",").join(", ") : "All Departments",
        created: `${formatLocalDate(entry.created_at)} ${formatMilitaryTime(entry.created_at)}`,
      }))
    );

  const handleExportHistory = () =>
    exportToExcel(
      `outed-history-${(historyEntry?.item_name || "item").toLowerCase().replace(/\s+/g, "-")}`,
      [
        { key: "item_name", label: "Item Name" },
        { key: "date", label: "Date" },
        { key: "time", label: "Time" },
        { key: "serial", label: "Serial" },
        { key: "issuance_number", label: "Issuance No." },
        { key: "qty_out", label: "Qty Out" },
        { key: "purpose", label: "Purpose" },
        { key: "machine_code", label: "Machine Code" },
      ],
      outedHistory.map((row) => ({
        item_name: row.item_name,
        date: row.issued_at ? formatDate(row.issued_at) : "",
        time: row.issued_at ? formatMilitaryTime(row.issued_at) : "",
        serial: row.serial,
        issuance_number: row.issuance_number,
        qty_out: row.qty_out,
        purpose: row.purpose,
        machine_code: row.machine_code,
      }))
    );

  return (
    <>
      <div className="dash-container">
        <div className="dash-header">
          <div>
            <h1 className="dash-title">Item List</h1>
            <p className="dash-subtitle">Every item in the system catalog</p>
          </div>
        </div>

        <ListToolbar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="Search by Item Name, UoM, Machine Code, Item Group, or Department..."
          onExport={handleExport}
          exportDisabled={filteredEntries.length === 0}
        />

        <div className="mb-3">
          <DateRangeFilter />
        </div>

        {canManage && (
          <form onSubmit={handleAdd} className="row g-2 align-items-end mb-3">
            <div className="col-12 col-sm-3">
              <label className="form-label small mb-1">ITEM NAME</label>
              <SearchableCombobox
                value={form.item_name}
                onChange={(value) => setForm({ ...form, item_name: value })}
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
        )}

        {error && <div className="alert alert-danger py-1 px-2 small">{error}</div>}

        <div className="table-responsive">
          {/* simple-list-table collapses each row into a labeled stacked
              card below 768px (see app.css) instead of letting this wide
              table overflow off the side of a phone screen. */}
          <table className="table table-sm table-hover mb-0 simple-list-table">
            <thead className="table-light">
              <tr>
                <th>Item Name</th>
                <th>UoM</th>
                <th>Machine Code</th>
                <th>Item Group</th>
                <th>Approver Level</th>
                <th>Departments</th>
                <th>Created</th>
                {canManage && <th style={{ width: "110px" }}></th>}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={canManage ? 8 : 7} className="text-center text-muted py-3">Loading…</td></tr>
              ) : entries.length === 0 ? (
                <tr><td colSpan={canManage ? 8 : 7} className="text-center text-muted py-3">No items in the catalog yet.</td></tr>
              ) : filteredEntries.length === 0 ? (
                <tr><td colSpan={canManage ? 8 : 7} className="text-center text-muted py-3">No items match your search.</td></tr>
              ) : (
                pagedEntries.map((entry) =>
                  canManage && editingId === entry.id ? (
                    <tr key={entry.id}>
                      <td data-label="Item Name">
                        <SearchableCombobox
                          value={editForm.item_name}
                          onChange={(value) => setEditForm({ ...editForm, item_name: value })}
                          options={itemNameSuggestions}
                          placeholder="Type to search…"
                          required
                        />
                      </td>
                      <td data-label="UoM">
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
                      <td data-label="Machine Code">
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
                      <td data-label="Item Group">
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
                      <td data-label="Approver Level">
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
                      <td data-label="Departments" style={{ minWidth: "220px" }}>
                        <DepartmentCheckboxes selected={editForm.departments} onToggle={toggleEditDepartment} idPrefix={`edit-dept-${entry.id}`} />
                      </td>
                      <td data-label="Created" className="text-muted text-nowrap">
                        {formatLocalDate(entry.created_at)} {formatMilitaryTime(entry.created_at)}
                      </td>
                      <td data-label="Actions" className="text-nowrap">
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
                      <td data-label="Item Name">
                        <button
                          type="button"
                          className="btn btn-link p-0"
                          style={{ textDecoration: "none" }}
                          onClick={() => setHistoryEntry(entry)}
                          title="View TRANSACTION HISTORY for this item"
                        >
                          {entry.item_name}
                        </button>
                      </td>
                      <td data-label="UoM">{entry.uom}</td>
                      <td data-label="Machine Code">{entry.machine_code || <span className="text-muted">—</span>}</td>
                      <td data-label="Item Group">{entry.item_group || <span className="text-muted">—</span>}</td>
                      <td data-label="Approver Level">
                        {entry.approval_level === "MANAGER_ONLY" ? (
                          <span className="badge bg-warning text-dark">{APPROVAL_LEVEL_LABELS.MANAGER_ONLY}</span>
                        ) : (
                          APPROVAL_LEVEL_LABELS[entry.approval_level] || entry.approval_level
                        )}
                      </td>
                      <td data-label="Departments">
                        {entry.departments ? entry.departments.split(",").join(", ") : <span className="text-muted">All Departments</span>}
                      </td>
                      <td data-label="Created" className="text-muted text-nowrap">
                        {formatLocalDate(entry.created_at)} {formatMilitaryTime(entry.created_at)}
                      </td>
                      {canManage && (
                        <td data-label="Actions" className="text-nowrap">
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
                      )}
                    </tr>
                  )
                )
              )}
            </tbody>
          </table>
        </div>

        {filteredEntries.length > 0 && (
          <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mt-2">
            <span className="text-muted small">
              Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filteredEntries.length)} of {filteredEntries.length}
            </span>
            <div className="d-flex align-items-center gap-2">
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <span className="small text-muted">Page {page} of {totalPages}</span>
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      <Modal
        isOpen={!!historyEntry}
        onClose={() => setHistoryEntry(null)}
        title={`TRANSACTION HISTORY — ${historyEntry?.item_name ?? ""}`}
      >
        {outedHistory.length === 0 ? (
          <p className="text-muted text-center py-3 mb-0">This item has no Transaction History.</p>
        ) : (
          <>
          <div className="d-flex justify-content-end mb-2">
            <button type="button" className="btn btn-success btn-sm" onClick={handleExportHistory}>
              <i className="bi bi-file-earmark-excel me-1"></i>Convert to Excel
            </button>
          </div>
          <div className="table-responsive">
            <table className="table table-sm table-hover mb-0 simple-list-table">
              <thead className="table-light">
                <tr>
                  <th>Item Name</th>
                  <th>Date</th>
                  <th>Time</th>
                  <th>Serial</th>
                  <th>Issuance No.</th>
                  <th>Qty Out</th>
                  <th>Purpose</th>
                  <th>Machine Code</th>
                </tr>
              </thead>
              <tbody>
                {outedHistory.map((row) => (
                  <tr key={row.key}>
                    <td data-label="Item Name">{row.item_name}</td>
                    <td data-label="Date">{row.issued_at ? formatDate(row.issued_at) : "—"}</td>
                    <td data-label="Time">{row.issued_at ? formatMilitaryTime(row.issued_at) : "—"}</td>
                    <td data-label="Serial" className="font-monospace">{row.serial}</td>
                    <td data-label="Issuance No." className="font-monospace">{row.issuance_number || "—"}</td>
                    <td data-label="Qty Out">{row.qty_out}</td>
                    <td data-label="Purpose">{row.purpose}</td>
                    <td data-label="Machine Code" className="font-monospace">{row.machine_code || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </Modal>
    </>
  );
};

export default ItemListPage;
