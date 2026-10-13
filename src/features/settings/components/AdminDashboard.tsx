import React, { useEffect, useState } from "react";
import Layout from "@/components/layout/Layout";
import Modal from "@/components/dialogs/Modal";
import SearchableCombobox from "@/components/forms/SearchableCombobox";
import RolesTab from "@/features/settings/components/RolesTab";
import DepartmentsTab from "@/features/settings/components/DepartmentsTab";
import { useAdminData } from "@/features/settings/hooks/useAdminData";
import { useDepartmentOptions } from "@/hooks/useDepartmentOptions";
import { createLogger } from "@/lib/client-logger";
import type { AdminTab } from "@/types";

const log = createLogger("AdminDashboard");

const AdminDashboard: React.FC = () => {
  const {
    users,
    showUserModal,
    setShowUserModal,
    isEditingUser,
    userForm,
    setUserForm,
    handleOpenCreateUser,
    handleEditUser,
    handleSaveUser,
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
  } = useAdminData();

  const [activeTab, setActiveTab] = useState<Extract<AdminTab, "users" | "roles" | "departments">>("users");
  const departmentOptions = useDepartmentOptions();

  useEffect(() => {
    log.info("Mounted");
    return () => { log.info("Unmounted"); };
  }, []);

  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">Admin Dashboard</h1>
        <p className="page-subtitle">System Administration</p>
      </div>

      <div className="dash-toolbar">
        <div className="dash-tabs">
          <button className={`dash-tab ${activeTab === "users" ? "active" : ""}`} onClick={() => setActiveTab("users")}>
            Users
          </button>
          <button className={`dash-tab ${activeTab === "roles" ? "active" : ""}`} onClick={() => setActiveTab("roles")}>
            Roles
          </button>
          <button className={`dash-tab ${activeTab === "departments" ? "active" : ""}`} onClick={() => setActiveTab("departments")}>
            Departments
          </button>
        </div>
      </div>

      {activeTab === "users" && (
        <div className="card">
          <div className="card-header d-flex justify-content-between align-items-center">
            <h5 className="mb-0">User Management</h5>
            <button className="btn btn-primary btn-sm" onClick={handleOpenCreateUser}>+ Create User</button>
          </div>
          <div className="card-body p-0">
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead className="table-light">
                  <tr>
                    <th>Name</th>
                    <th>Username</th>
                    <th>Role</th>
                    <th>Department</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td>{u.name}</td>
                      <td>{u.email}</td>
                      <td><span className="badge bg-secondary">{u.role}</span></td>
                      <td>{u.department}</td>
                      <td>
                        <div className="d-flex gap-2">
                          <button className="btn btn-sm btn-outline-primary" onClick={() => handleEditUser(u)}>Edit</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === "roles" && (
        <RolesTab
          roles={roles}
          showRoleModal={showRoleModal}
          setShowRoleModal={setShowRoleModal}
          isEditingRole={isEditingRole}
          roleForm={roleForm}
          setRoleForm={setRoleForm}
          handleOpenCreateRole={handleOpenCreateRole}
          handleEditRole={handleEditRole}
          handleSaveRole={handleSaveRole}
          handleDeleteRole={handleDeleteRole}
        />
      )}

      {activeTab === "departments" && <DepartmentsTab />}

      {/* User Modal */}
      <Modal isOpen={showUserModal} onClose={() => setShowUserModal(false)} title={isEditingUser ? "Edit User" : "Create User"}>
        <div className="mb-3">
          <label className="form-label">Name</label>
          <input type="text" className="form-control text-uppercase" value={userForm.name} onChange={(e) => setUserForm({ ...userForm, name: e.target.value.toUpperCase() })} required />
        </div>
        <div className="mb-3">
          <label className="form-label">Username</label>
          <input type="text" className="form-control" value={userForm.email} onChange={(e) => setUserForm({ ...userForm, email: e.target.value })} autoComplete="off" required />
        </div>
        <div className="mb-3">
          <label className="form-label">Role</label>
          <select className="form-select" value={userForm.role} onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}>
            {roles.map((role) => (
              <option key={role.id} value={role.name}>{role.label}</option>
            ))}
          </select>
        </div>
        <div className="mb-3">
          <label className="form-label">Department</label>
          <SearchableCombobox
            value={userForm.department}
            onChange={(value) => setUserForm({ ...userForm, department: value })}
            options={departmentOptions.options}
            descriptions={departmentOptions.descriptions}
            placeholder="Type to search or add a department…"
            required
            onAddNew={async (value) => {
              const resolved = await departmentOptions.addOption(value);
              if (resolved) setUserForm((f) => ({ ...f, department: resolved }));
            }}
            onEditOption={departmentOptions.editOption}
            onDeleteOption={departmentOptions.deleteOption}
          />
        </div>
        <div className="mb-3">
          <label className="form-label">{isEditingUser ? "New Password (leave blank to keep current)" : "Password"}</label>
          <input type="password" className="form-control" value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} autoComplete="new-password" required={!isEditingUser} />
        </div>
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={() => setShowUserModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSaveUser}>Save</button>
        </div>
      </Modal>

    </Layout>
  );
};

export default AdminDashboard;
