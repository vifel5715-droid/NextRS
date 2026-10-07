import React from "react";
import Modal from "@shared/components/Modal";
import { PERMISSION_KEYS, PERMISSION_LABELS } from "@constants/permissions";
import type { RoleForm, RoleWithPermissions } from "@shared/types";

interface RolesTabProps {
  roles: RoleWithPermissions[];
  showRoleModal: boolean;
  setShowRoleModal: (open: boolean) => void;
  isEditingRole: boolean;
  roleForm: RoleForm;
  setRoleForm: (form: RoleForm) => void;
  handleOpenCreateRole: () => void;
  handleEditRole: (role: RoleWithPermissions) => void;
  handleSaveRole: () => void;
  handleDeleteRole: (role: RoleWithPermissions) => void;
}

const toggleView = (form: RoleForm, key: string): RoleForm["permissions"] =>
  form.permissions.some((p) => p.key === key)
    ? form.permissions.filter((p) => p.key !== key)
    : [...form.permissions, { key, can_edit: false }];

const toggleEdit = (form: RoleForm, key: string): RoleForm["permissions"] =>
  form.permissions.map((p) => (p.key === key ? { ...p, can_edit: !p.can_edit } : p));

const RolesTab: React.FC<RolesTabProps> = ({
  roles,
  showRoleModal,
  setShowRoleModal,
  isEditingRole,
  roleForm,
  setRoleForm,
  handleOpenCreateRole,
  handleEditRole,
  handleSaveRole,
  handleDeleteRole,
}) => {
  return (
    <div className="card">
      <div className="card-header d-flex justify-content-between align-items-center">
        <h5 className="mb-0">Roles</h5>
        <button className="btn btn-primary btn-sm" onClick={handleOpenCreateRole}>+ Create Role</button>
      </div>
      <div className="card-body p-0">
        <div className="table-responsive">
          <table className="table table-hover mb-0">
            <thead className="table-light">
              <tr>
                <th>Name</th>
                <th>Label</th>
                <th>Page Access</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {roles.map((role) => (
                <tr key={role.id}>
                  <td>
                    {role.name}
                    {role.is_system && <span className="badge bg-secondary ms-2">Built-in</span>}
                  </td>
                  <td>{role.label}</td>
                  <td>{role.permissions.length} page{role.permissions.length === 1 ? "" : "s"}</td>
                  <td>
                    <div className="d-flex gap-2">
                      <button
                        className="btn btn-sm btn-outline-primary"
                        onClick={() => handleEditRole(role)}
                      >
                        Edit
                      </button>
                      <button
                        className="btn btn-sm btn-outline-danger"
                        onClick={() => handleDeleteRole(role)}
                        disabled={role.is_system}
                        title={role.is_system ? "Built-in roles cannot be deleted" : undefined}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal isOpen={showRoleModal} onClose={() => setShowRoleModal(false)} title={isEditingRole ? "Edit Role" : "Create Role"}>
        <div className="mb-3">
          <label className="form-label">Role Name</label>
          <input
            type="text"
            className="form-control"
            value={roleForm.name}
            onChange={(e) => setRoleForm({ ...roleForm, name: e.target.value })}
            disabled={isEditingRole}
            autoComplete="off"
            required
          />
        </div>
        <div className="mb-3">
          <label className="form-label">Display Label</label>
          <input
            type="text"
            className="form-control"
            value={roleForm.label}
            onChange={(e) => setRoleForm({ ...roleForm, label: e.target.value })}
            required
          />
        </div>
        <div className="mb-3">
          <label className="form-label">Page Access</label>
          <table className="table table-sm mb-0">
            <thead>
              <tr>
                <th>Page</th>
                <th className="text-center" style={{ width: "70px" }}>View</th>
                <th className="text-center" style={{ width: "70px" }}>Edit</th>
              </tr>
            </thead>
            <tbody>
              {PERMISSION_KEYS.map((key) => {
                const grant = roleForm.permissions.find((p) => p.key === key);
                return (
                  <tr key={key}>
                    <td>{PERMISSION_LABELS[key]}</td>
                    <td className="text-center">
                      <input
                        type="checkbox"
                        className="form-check-input"
                        aria-label={`View access for ${PERMISSION_LABELS[key]}`}
                        checked={!!grant}
                        onChange={() => setRoleForm({ ...roleForm, permissions: toggleView(roleForm, key) })}
                      />
                    </td>
                    <td className="text-center">
                      <input
                        type="checkbox"
                        className="form-check-input"
                        aria-label={`Edit access for ${PERMISSION_LABELS[key]}`}
                        checked={!!grant?.can_edit}
                        disabled={!grant}
                        onChange={() => setRoleForm({ ...roleForm, permissions: toggleEdit(roleForm, key) })}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="d-flex gap-2">
          <button className="btn btn-primary" onClick={handleSaveRole}>Save</button>
          <button className="btn btn-secondary" onClick={() => setShowRoleModal(false)}>Cancel</button>
        </div>
      </Modal>
    </div>
  );
};

export default RolesTab;
