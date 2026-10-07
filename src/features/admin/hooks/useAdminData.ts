import { useState, useEffect, useCallback, type FormEvent } from 'react';
import { useSearchParams, useLocation } from '@shared/next-router';
import { userAPI, itemRequestAPI, serviceRequestAPI, rolesAPI } from '../../../services/api';
import { fetchWithSimpleRetry } from '@shared/utils/fetchWithRetry';
import { useRequestManagement } from '@features/requests/hooks/useRequestManagement';
import { useAuth } from "@app/providers/AuthProvider";
import { createLogger } from '@shared/utils/logger';
import { makeRequestKey } from "@shared/utils/requestKey";
import { getErrorMessage, getValidationMessage } from '@shared/utils/errorMessage';
import type { AdminTab, UserForm, UserRecord, ItemFormData, ServiceFormData, ItemRow, ServiceRow, RequestTab, EditableRequestDetail, RequestDetail, FieldValue, RoleForm, RoleWithPermissions } from '@shared/types';

const log = createLogger("useAdminData");

export const useAdminData = () => {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const { user } = useAuth();

  const requestManagement = useRequestManagement();

  const [showCreateItemModal, setShowCreateItemModal] = useState(false);
  const [showCreateServiceModal, setShowCreateServiceModal] = useState(false);
  const [createItemFormData, setCreateItemFormData] = useState<ItemFormData>({
    department: '', requested_by: '', request_type: 'out', purpose: '', remarks: '',
  });
  const [createItemTableData, setCreateItemTableData] = useState<ItemRow[]>([
    { item_name: '', quantity: 1, uom: '', remarks: '' },
  ]);
  const [createItemAttachment, setCreateItemAttachment] = useState<File | null>(null);
  const [createItemAttachmentUploadProgress, setCreateItemAttachmentUploadProgress] = useState<number | null>(null);
  const [createServiceFormData, setCreateServiceFormData] = useState<ServiceFormData>({
    department: '', requested_by: '', purpose: '', remarks: '',
  });
  const [createServiceTableData, setCreateServiceTableData] = useState<ServiceRow[]>([
    { description: '' },
  ]);

  const [showEditModal, setShowEditModal] = useState(false);
  const [editingRequestId, setEditingRequestId] = useState<number | null>(null);
  const [editingRequestType, setEditingRequestType] = useState<RequestTab>('item');
  const [editableDetails, setEditableDetails] = useState<Map<number, EditableRequestDetail>>(new Map());

  const resolveInitialTab = (): AdminTab => {
    if (searchParams.get('tab') === 'service') return 'service';
    if (location.pathname === '/dashboard/admin') return 'users';
    return 'item';
  };

  const [activeTab, setActiveTab] = useState<AdminTab>(resolveInitialTab);
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserRecord | null>(null);
  const [showUserModal, setShowUserModal] = useState(false);
  const [isEditingUser, setIsEditingUser] = useState(false);
  const [userForm, setUserForm] = useState<UserForm>({
    name: '',
    email: '',
    role: 'staff',
    department: '',
    password: '',
  });

  const [roles, setRoles] = useState<RoleWithPermissions[]>([]);
  const [selectedRole, setSelectedRole] = useState<RoleWithPermissions | null>(null);
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [isEditingRole, setIsEditingRole] = useState(false);
  const [roleForm, setRoleForm] = useState<RoleForm>({ name: '', label: '', permissions: [] });

  const loadRoles = useCallback(async () => {
    log.info("Loading roles");
    try {
      const res = await fetchWithSimpleRetry(() => rolesAPI.getAll());
      log.info("Roles loaded:", res.data.length, "records");
      setRoles(res.data);
    } catch (error) {
      log.error("Failed to load roles:", error);
      console.error('Error loading roles:', error);
    }
  }, []);

  const handleOpenCreateRole = () => {
    log.info("Opening create role modal");
    setIsEditingRole(false);
    setSelectedRole(null);
    setRoleForm({ name: '', label: '', permissions: [] });
    setShowRoleModal(true);
  };

  const handleEditRole = (targetRole: RoleWithPermissions) => {
    log.info("Opening edit role modal for:", targetRole.name);
    setIsEditingRole(true);
    setSelectedRole(targetRole);
    setRoleForm({ name: targetRole.name, label: targetRole.label, permissions: [...targetRole.permissions] });
    setShowRoleModal(true);
  };

  const handleSaveRole = async () => {
    const name = roleForm.name.trim();
    const label = roleForm.label.trim();
    if (!isEditingRole && !name) return alert('Role name is required.');
    if (!label) return alert('Display label is required.');

    log.info(isEditingRole ? "Updating role:" : "Creating role:", isEditingRole ? selectedRole?.name : name);
    try {
      if (isEditingRole && selectedRole) {
        await rolesAPI.update(selectedRole.id, { label, permissions: roleForm.permissions });
      } else {
        await rolesAPI.create({ name, label, permissions: roleForm.permissions });
      }
      log.info("Role saved successfully");
      setShowRoleModal(false);
      await loadRoles();
    } catch (error: unknown) {
      const message = getValidationMessage(error) ?? getErrorMessage(error, 'Failed to save role.');
      log.error("Failed to save role:", message);
      console.error('Error saving role:', error);
      alert(message);
    }
  };

  const handleDeleteRole = async (role: RoleWithPermissions) => {
    if (!window.confirm(`Delete the role "${role.label}"? This cannot be undone.`)) return;
    log.info("Deleting role:", role.name);
    try {
      await rolesAPI.delete(role.id);
      log.info("Role deleted successfully:", role.name);
      await loadRoles();
    } catch (error: unknown) {
      const message = getErrorMessage(error, 'Failed to delete role.');
      log.error("Failed to delete role:", message);
      alert(message);
    }
  };

  const loadUsers = useCallback(async () => {
    log.info("Loading users");
    try {
      const res = await fetchWithSimpleRetry(() => userAPI.getAll());
      log.info("Users loaded:", res.data.length, "records");
      setUsers(res.data);
    } catch (error) {
      log.error("Failed to load users:", error);
      console.error('Error loading users:', error);
    }
  }, []);

  const handleOpenCreateUser = () => {
    log.info("Opening create user modal");
    setIsEditingUser(false);
    setUserForm({ name: '', email: '', role: 'staff', department: '', password: '' });
    setShowUserModal(true);
  };

  const handleEditUser = (targetUser: UserRecord) => {
    log.info("Opening edit user modal for:", targetUser.email, `(${targetUser.role})`);
    setIsEditingUser(true);
    setSelectedUser(targetUser);
    setUserForm({
      name: targetUser.name || '',
      email: targetUser.email || '',
      role: targetUser.role || 'staff',
      department: (targetUser.department || '').toUpperCase(),
      password: '',
    });
    setShowUserModal(true);
  };

  const { setActiveTab: setRequestManagementTab, loadItemRequests, loadServiceRequests } = requestManagement;
  useEffect(() => {
    log.info("Tab changed to:", activeTab);
    if (activeTab === 'item') {
      setRequestManagementTab('item');
    } else if (activeTab === 'service') {
      setRequestManagementTab('service');
    }
    // `requestManagement` is a fresh object every render (useRequestManagement
    // returns an object literal) — depending on it directly would rerun this
    // effect on every render, refetching in a loop. Depend on the specific
    // functions instead; they're now stable (see useCallback in
    // useRequestManagement.ts).
  }, [activeTab, setRequestManagementTab]);

  // Both lists load together on mount, not just whichever tab is active —
  // same fix as useCustodianRequests.ts. Previously item/service requests
  // only loaded once their own tab was clicked into, so the Service
  // Requests tab badge stayed stale/zero until an admin actually visited
  // that tab.
  useEffect(() => {
    void loadItemRequests();
    void loadServiceRequests();
  }, [loadItemRequests, loadServiceRequests]);

  useEffect(() => {
    if (activeTab !== 'users') return;
    const timer = window.setTimeout(() => {
      void loadUsers();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeTab, loadUsers]);

  // Loaded on mount rather than gated on activeTab === 'roles' — the Create/
  // Edit User modal's role dropdown (AdminDashboard.tsx) also reads this
  // list, so it needs to be available even if the admin never visits the
  // Roles tab this session.
  useEffect(() => {
    void loadRoles();
  }, [loadRoles]);

  const handleSaveUser = async () => {
    const name = userForm.name.trim();
    const email = userForm.email.trim();
    if (!name) return alert('Name is required.');
    if (!email) return alert('Username is required.');
    if (!userForm.department) return alert('Please select a department.');
    if (!isEditingUser && !userForm.password) return alert('Password is required for a new user.');

    log.info(isEditingUser ? "Updating user:" : "Creating user:", email, `(${userForm.role})`);
    try {
      if (isEditingUser && selectedUser) {
        const payload: { name: string; email: string; role: string; department: string; password?: string } = {
          name,
          email,
          role: userForm.role,
          department: userForm.department,
        };
        if (userForm.password) payload.password = userForm.password;
        await userAPI.update(selectedUser.id, payload);
      } else {
        await userAPI.create({ ...userForm, name, email });
      }
      log.info("User saved successfully:", email);
      setShowUserModal(false);
      await loadUsers();
    } catch (error: unknown) {
      // Zod validation failures arrive as an array and need per-field formatting;
      // anything else is a plain message.
      const message = getValidationMessage(error) ?? getErrorMessage(error, 'Failed to save user.');
      log.error("Failed to save user:", email, message);
      console.error('Error saving user:', error);
      alert(message);
    }
  };

  const handleOpenCreateItemRequest = () => {
    setCreateItemFormData({ department: '', requested_by: user?.name || '', request_type: 'out', purpose: '', remarks: '' });
    setCreateItemTableData([{ item_name: '', quantity: 1, uom: '', remarks: '' }]);
    setCreateItemAttachment(null);
    setShowCreateItemModal(true);
  };

  const handleOpenCreateServiceRequest = () => {
    setCreateServiceFormData({ department: '', requested_by: user?.name || '', purpose: '', remarks: '' });
    setCreateServiceTableData([{ description: '' }]);
    setShowCreateServiceModal(true);
  };

  const addCreateItemRow = () =>
    setCreateItemTableData(prev => [...prev, { item_name: '', quantity: 1, uom: '', remarks: '' }]);

  const removeCreateItemRow = (index: number) => {
    if (createItemTableData.length > 1) setCreateItemTableData(prev => prev.filter((_, i) => i !== index));
  };

  const updateCreateItemRow = (index: number, field: keyof ItemRow, value: string | number | undefined) =>
    setCreateItemTableData(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });

  const addCreateServiceRow = () =>
    setCreateServiceTableData(prev => [...prev, { description: '' }]);

  const removeCreateServiceRow = (index: number) => {
    if (createServiceTableData.length > 1) setCreateServiceTableData(prev => prev.filter((_, i) => i !== index));
  };

  const updateCreateServiceRow = (index: number, field: keyof ServiceRow, value: string | number | undefined) =>
    setCreateServiceTableData(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });

  const handleCreateItemSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!createItemFormData.department) return alert('Please select a department.');
    log.info("Submitting item request (admin) — department:", createItemFormData.department, "items:", createItemTableData.length);
    try {
      const items = createItemTableData.map(row => ({
        ...row,
        item_name: row.item_name.toUpperCase(),
        uom: row.uom.toUpperCase(),
        remarks: row.remarks.toUpperCase(),
      }));

      const formData = new FormData();
      formData.append('department', createItemFormData.department);
      formData.append('requested_by', createItemFormData.requested_by);
      formData.append('request_type', createItemFormData.request_type);
      formData.append('purpose', createItemFormData.purpose.toUpperCase());
      formData.append('remarks', createItemFormData.remarks.toUpperCase());
      formData.append('items', JSON.stringify(items));
      if (createItemAttachment) formData.append('attachment', createItemAttachment);

      if (createItemAttachment) setCreateItemAttachmentUploadProgress(0);
      await itemRequestAPI.create(formData, createItemAttachment ? setCreateItemAttachmentUploadProgress : undefined);
      log.info("Item request created successfully (admin)");
      setShowCreateItemModal(false);
      requestManagement.loadItemRequests();
    } catch (error: unknown) {
      const reason = getErrorMessage(error);
      log.error("Failed to create item request (admin):", reason);
      alert('Error submitting request: ' + reason);
    } finally {
      setCreateItemAttachmentUploadProgress(null);
    }
  };

  const handleCreateServiceSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!createServiceFormData.department) return alert('Please select a department.');
    log.info("Submitting service request (admin) — department:", createServiceFormData.department, "services:", createServiceTableData.length);
    try {
      await serviceRequestAPI.create({
        ...createServiceFormData,
        purpose: createServiceFormData.purpose.toUpperCase(),
        remarks: createServiceFormData.remarks.toUpperCase(),
        services: createServiceTableData.map(row => ({
          ...row,
          description: row.description.toUpperCase(),
        })),
      });
      log.info("Service request created successfully (admin)");
      setShowCreateServiceModal(false);
      requestManagement.loadServiceRequests();
    } catch (error: unknown) {
      const reason = getErrorMessage(error);
      log.error("Failed to create service request (admin):", reason);
      alert('Error submitting request: ' + reason);
    }
  };

  const canEditRequest = (_details: RequestDetail | undefined): boolean => true;

  const toggleEditMode = (requestId: number, requestType?: RequestTab) => {
    if (requestType) {
      const details = requestManagement.requestDetails.get(makeRequestKey(requestType, requestId));
      if (details) {
        setEditableDetails(prev => new Map(prev).set(requestId, {
          purpose: details.purpose || '',
          remarks: details.remarks || '',
          items: details.items ? details.items.map((item: ItemRow) => ({ ...item })) : [],
          services: details.services ? details.services.map((service: ServiceRow) => ({ ...service })) : [],
        }));
        setEditingRequestId(requestId);
        setEditingRequestType(requestType);
        setShowEditModal(true);
      }
    } else {
      setShowEditModal(false);
      setEditingRequestId(null);
      setEditingRequestType('item');
      setEditableDetails(prev => {
        const next = new Map(prev);
        next.delete(requestId);
        return next;
      });
    }
  };

  const closeEditModal = () => {
    setShowEditModal(false);
    const id = editingRequestId;
    setEditingRequestId(null);
    setEditableDetails(prev => {
      const next = new Map(prev);
      if (id) next.delete(id);
      return next;
    });
  };

  const updateDetailField = (requestId: number, field: string, value: string) =>
    setEditableDetails(prev => {
      const current = prev.get(requestId);
      if (!current) return prev;
      return new Map(prev).set(requestId, { ...current, [field]: value });
    });

  const updateDetailItem = (requestId: number, index: number, field: keyof ItemRow, value: FieldValue) =>
    setEditableDetails(prev => {
      const current = prev.get(requestId);
      if (!current) return prev;
      const updatedItems = [...current.items];
      updatedItems[index] = { ...updatedItems[index], [field]: value };
      return new Map(prev).set(requestId, { ...current, items: updatedItems });
    });

  const updateDetailService = (requestId: number, index: number, field: keyof ServiceRow, value: FieldValue) =>
    setEditableDetails(prev => {
      const current = prev.get(requestId);
      if (!current) return prev;
      const updatedServices = [...current.services];
      updatedServices[index] = { ...updatedServices[index], [field]: value };
      return new Map(prev).set(requestId, { ...current, services: updatedServices });
    });

  const addDetailItem = (requestId: number) =>
    setEditableDetails(prev => {
      const current = prev.get(requestId);
      if (!current) return prev;
      return new Map(prev).set(requestId, {
        ...current,
        items: [...current.items, { item_name: '', quantity: 1, uom: '', remarks: '' }],
      });
    });

  const removeDetailItem = (requestId: number, index: number) =>
    setEditableDetails(prev => {
      const current = prev.get(requestId);
      if (!current) return prev;
      return new Map(prev).set(requestId, {
        ...current,
        items: current.items.filter((_, i) => i !== index),
      });
    });

  const addDetailService = (requestId: number) =>
    setEditableDetails(prev => {
      const current = prev.get(requestId);
      if (!current) return prev;
      return new Map(prev).set(requestId, {
        ...current,
        services: [...current.services, { description: '' }],
      });
    });

  const removeDetailService = (requestId: number, index: number) =>
    setEditableDetails(prev => {
      const current = prev.get(requestId);
      if (!current) return prev;
      return new Map(prev).set(requestId, {
        ...current,
        services: current.services.filter((_, i) => i !== index),
      });
    });

  const saveDetailChanges = async () => {
    if (!editingRequestId) return;
    const editable = editableDetails.get(editingRequestId);
    if (!editable) return;
    log.info("Saving edits for request #" + editingRequestId, `(${editingRequestType})`);
    try {
      if (editingRequestType === 'item') {
        await itemRequestAPI.update(editingRequestId, {
          purpose: editable.purpose,
          remarks: editable.remarks,
          items: editable.items,
        });
      } else {
        await serviceRequestAPI.update(editingRequestId, {
          purpose: editable.purpose,
          remarks: editable.remarks,
          services: editable.services,
        });
      }
      log.info("Request #" + editingRequestId, "updated successfully");
      const response = await fetchWithSimpleRetry(() =>
        editingRequestType === 'item'
          ? itemRequestAPI.getById(editingRequestId)
          : serviceRequestAPI.getById(editingRequestId)
      );
      requestManagement.setRequestDetails(prev => new Map(prev).set(makeRequestKey(editingRequestType, editingRequestId), response.data));
      setEditableDetails(prev => {
        const next = new Map(prev);
        next.delete(editingRequestId);
        return next;
      });
      setShowEditModal(false);
      setEditingRequestId(null);
    } catch {
      log.error("Failed to save edits for request #" + editingRequestId);
      alert('Failed to save changes');
    }
  };

  return {
    ...requestManagement,
    activeTab,
    setActiveTab,
    users,
    selectedUser,
    showUserModal,
    setShowUserModal,
    isEditingUser,
    userForm,
    setUserForm,
    loadUsers,
    handleOpenCreateUser,
    handleEditUser,
    handleSaveUser,
    roles,
    selectedRole,
    showRoleModal,
    setShowRoleModal,
    isEditingRole,
    roleForm,
    setRoleForm,
    loadRoles,
    handleOpenCreateRole,
    handleEditRole,
    handleSaveRole,
    handleDeleteRole,
    showCreateItemModal,
    setShowCreateItemModal,
    showCreateServiceModal,
    setShowCreateServiceModal,
    createItemFormData,
    setCreateItemFormData,
    createItemTableData,
    createItemAttachment,
    setCreateItemAttachment,
    createItemAttachmentUploadProgress,
    createServiceFormData,
    setCreateServiceFormData,
    createServiceTableData,
    handleOpenCreateItemRequest,
    handleOpenCreateServiceRequest,
    addCreateItemRow,
    removeCreateItemRow,
    updateCreateItemRow,
    addCreateServiceRow,
    removeCreateServiceRow,
    updateCreateServiceRow,
    handleCreateItemSubmit,
    handleCreateServiceSubmit,
    showEditModal,
    editingRequestId,
    editingRequestType,
    editableDetails,
    canEditRequest,
    toggleEditMode,
    closeEditModal,
    updateDetailField,
    updateDetailItem,
    updateDetailService,
    addDetailItem,
    removeDetailItem,
    addDetailService,
    removeDetailService,
    saveDetailChanges,
  };
};
