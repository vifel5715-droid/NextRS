import type { User } from "@/types";

// Each landing page and the permission ClientApp requires to open it.
// Everyone who may open the overview Dashboard lands there; the order below
// is the fallback for custom roles (created in the Admin Dashboard) without it.
const LANDING_PAGES: ReadonlyArray<readonly [path: string, permission: string]> = [
  ['/dashboard', 'overview'],
  ['/requests/pending', 'create_request'],
  ['/approvals/custodian', 'department_requests'],
  ['/approvals/purchaser', 'purchaser_dashboard'],
  ['/approvals/ap-officer', 'ap_officer_dashboard'],
  ['/settings', 'users_management'],
];

const ROLE_LANDING: Record<string, string> = {
  staff: '/requests/pending',
  secretary: '/requests/pending',
  supervisor: '/requests/pending',
  manager: '/requests/pending',
  custodian: '/approvals/custodian',
  admin: '/settings',
  director: '/dashboard',
  purchaser: '/approvals/purchaser',
  ap_officer: '/approvals/ap-officer',
};

/**
 * The Dashboard when the user may open it; otherwise the role's usual page if
 * permitted, else the first page they can, so nobody lands on /unauthorized
 * straight after signing in. Role names are matched like the server matches
 * them (case/whitespace-insensitive).
 */
export function landingPathFor(user: Pick<User, 'role' | 'permissions'>): string {
  const allowed = (path: string) =>
    LANDING_PAGES.some(([p, permission]) => p === path && user.permissions.includes(permission));
  if (allowed('/dashboard')) return '/dashboard';
  const preferred = ROLE_LANDING[user.role.trim().toLowerCase()];
  if (preferred && allowed(preferred)) return preferred;
  return LANDING_PAGES.find(([, permission]) => user.permissions.includes(permission))?.[0] ?? '/unauthorized';
}
