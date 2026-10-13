import React, { useState } from "react";
import Modal from "@/components/dialogs/Modal";
import { useDepartmentOptions } from "@/hooks/useDepartmentOptions";

const emptyForm = { code: "", label: "" };
type DepartmentForm = typeof emptyForm;

/**
 * Admin-only management screen for the Department option list (see
 * option-list.controller.ts's assertCanWriteKind — writes are admin-only).
 * Every department added here immediately shows up in the Create/Edit User
 * form's Department combobox and the item catalog's department-restriction
 * checkboxes (both read from the same useDepartmentOptions hook), so this
 * is the one place to add/rename/remove one.
 */
const DepartmentsTab: React.FC = () => {
  const { entries, addOption, updateEntry, deleteEntry } = useDepartmentOptions();

  const [showModal, setShowModal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<DepartmentForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOpenCreate = () => {
    setIsEditing(false);
    setEditingId(null);
    setForm(emptyForm);
    setError(null);
    setShowModal(true);
  };

  const handleOpenEdit = (entry: { id: number; value: string; description: string | null }) => {
    setIsEditing(true);
    setEditingId(entry.id);
    setForm({ code: entry.value, label: entry.description ?? "" });
    setError(null);
    setShowModal(true);
  };

  const handleSave = async () => {
    const code = form.code.trim();
    const label = form.label.trim();
    if (!code) {
      setError("Department code is required.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const ok = isEditing && editingId !== null
        ? await updateEntry(editingId, code, label)
        : (await addOption(code, label)) !== undefined;
      if (!ok) {
        setError(isEditing ? "Failed to update department." : "Failed to add department.");
        return;
      }
      setShowModal(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (entry: { id: number; value: string }) => {
    if (!confirm(`Remove "${entry.value}" from the department list?`)) return;
    await deleteEntry(entry.id);
  };

  return (
    <div className="card">
      <div className="card-header d-flex justify-content-between align-items-center">
        <h5 className="mb-0">Departments</h5>
        <button className="btn btn-primary btn-sm" onClick={handleOpenCreate}>+ Add Department</button>
      </div>
      <div className="card-body p-0">
        <div className="table-responsive">
          <table className="table table-hover mb-0">
            <thead className="table-light">
              <tr>
                <th>Code</th>
                <th>Label</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 ? (
                <tr>
                  <td colSpan={3} className="text-center text-muted py-3">No departments yet.</td>
                </tr>
              ) : (
                entries.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.value}</td>
                    <td>{entry.description || <span className="text-muted">—</span>}</td>
                    <td>
                      <div className="d-flex gap-2">
                        <button className="btn btn-sm btn-outline-primary" onClick={() => handleOpenEdit(entry)}>Edit</button>
                        <button className="btn btn-sm btn-outline-danger" onClick={() => handleDelete(entry)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={isEditing ? "Edit Department" : "Add Department"}>
        <div className="mb-3">
          <label className="form-label">Code</label>
          <input
            type="text"
            className="form-control text-uppercase"
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
            autoComplete="off"
            required
          />
        </div>
        <div className="mb-3">
          <label className="form-label">Label</label>
          <input
            type="text"
            className="form-control"
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
            placeholder="Full department name (optional)"
          />
        </div>
        {error && <div className="alert alert-danger py-1 px-2 small">{error}</div>}
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving} aria-busy={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </Modal>
    </div>
  );
};

export default DepartmentsTab;
