# Request System

Request management for Staples Foods Corporation: item, service, urgent and
reimbursement requests, multi-stage approvals, inventory issuance, purchase
requests, petty cash and an Item Master List — one Next.js (App Router)
application backed by PostgreSQL.

## Quick start

```powershell
npm install
Copy-Item .env.example .env.local   # then fill in DATABASE_URL and SESSION_SECRET
npm run db:setup                    # create/upgrade tables, seed roles and reference data
npm run dev
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / server |
| `npm run typecheck` | TypeScript for the app and for `tests/` |
| `npm run lint` | ESLint (`eslint.config.mjs`) |
| `npm test` | Jest unit tests (integration suite skips unless configured) |
| `npm run test:integration` | Database integration tests — needs `TEST_DATABASE_URL` |
| `npm run db:setup` | Idempotent schema create/upgrade + seeds (same as `init-db`) |

## Environment

All variables are server-only; none may use a `NEXT_PUBLIC_` prefix.

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL URL. Percent-encode reserved characters (including `@`) in the username and password. |
| `SESSION_SECRET` | yes | HMAC key for session cookies, at least 32 random bytes. Rotating it signs everyone out. |
| `INIT_DB_DEMO_PASSWORD` | production setup | Password for the seeded demo accounts. Required when `db:setup` runs with `NODE_ENV=production`. |
| `ADMIN_RESET_PASSWORD` | no | Used by `npm run reset-admin`. |
| `LEGACY_UPLOADS_DIR` | no | Only for very old attachment rows that still point to a file on disk. |
| `TEST_DATABASE_URL` | tests only | A separate, disposable database for `npm run test:integration`. Must differ from `DATABASE_URL`. |

## Project structure

```text
scripts/                 Database CLI scripts (db:setup, reset-admin, seeding, debugging)
src/
  app/                   Next.js App Router
    (auth)/              /login, /unauthorized
    (dashboard)/         Signed-in screens: /dashboard, /requests, /approvals, /inventory,
                         /purchase-requests, /reports, /petty-cash, /settings
    api/                 Route Handlers: auth, requests, events (SSE), attachments, health
  components/            Shared UI: layout (shell, sidebar), dialogs, forms, tables, providers
  constants/             Permission keys, UoM/item types, legacy URL map
  db/                    Drizzle schema, idempotent DDL (tables/indexes/bootstrap), seed data
  features/<feature>/    One folder per business area:
    actions/             Server Actions (the mutation/read entry points)
    components/          Screens and feature components
    hooks/               Client data hooks
    schemas/             Zod input schemas
    services/            Business logic shared by actions and Route Handlers
  hooks/                 Cross-feature React hooks
  lib/                   Infrastructure: db pool, session, auth, permissions, validation,
                         errors, logger, realtime, API response helpers, client utilities
  server/
    audit/               Audit trail (audit_logs) and the adjustment log
    policies/            Pure authorization/business rules (approval, login throttling)
    repositories/        Data access (users)
    services/            Cross-feature server services (serial numbers, throttling, payment forms)
  proxy.ts               Per-request CSP nonce (Next.js 16 "proxy", formerly middleware)
tests/
  unit/                  Jest unit tests (no database needed)
  integration/           Jest tests against TEST_DATABASE_URL
```

Features: `auth`, `dashboard`, `requests`, `approvals`, `item-master`,
`inventory`, `purchase-requests`, `reports`, `petty-cash`, `settings`.

### Rendering model

Every route's `page.tsx` renders nothing: the route group's `layout.tsx` mounts
one persistent client shell (`components/layout/ClientApp.tsx`) that picks the
screen from the URL. Because a layout stays mounted across client-side
navigation, providers, the sidebar, cached screens and the realtime stream all
survive navigation. The `(dashboard)` layout redirects anonymous visitors to
`/login` on the server.

Old URLs (`/dashboard/staff`, `/dashboard/custodian`, ...) redirect to the new
ones; the map is `src/constants/legacy-routes.json`.

## Security model

- **Authentication.** A signed, HTTP-only, `SameSite=Lax` cookie (`Secure` in
  production) carries the user id, an 8-hour expiry and the user's
  `session_version`. The user, role and permissions are re-read from the
  database on every request. Logout and password changes increment
  `session_version`, revoking every outstanding token for that user on every
  device.
- **Brute-force protection.** Failed sign-ins are recorded in
  `failed_login_attempts`: 5 failures per username or 30 per IP within 15
  minutes locks further attempts for the rest of the window (HTTP 429 with
  `Retry-After` from the API). Unknown usernames cost the same password-hash
  work as wrong passwords.
- **Authorization** is enforced in every Server Action and Route Handler, never
  only in the UI: `requireUser()` (`lib/auth.ts`), `requirePermission()`,
  `requireRole()`, `requireDepartmentAccess()` and `canEditRequest()`
  (`lib/permissions.ts`). Approval rules live in
  `server/policies/approval-policy.ts`: nobody reviews their own request except
  a manager; supervisor- or manager-created requests and manager-only catalog
  items need a manager-tier reviewer. Only an admin can grant the admin role or
  edit an admin account.
- **Errors.** Server Actions return `{ ok, data | error }` (Next.js hides thrown
  messages in production). Route Handlers return `{ error: { code, message } }`.
  Only `AppError`s (`lib/errors.ts`) and plain validation `Error`s reach users;
  database errors are logged and replaced with a generic message.
- **Logging** (`lib/logger.ts`) redacts secret-looking keys and strips bound
  query parameters from database errors.
- **Audit trail.** `audit_logs` records sign-in/out, throttling, supervisor and
  custodian decisions, and user/role administration — in the same transaction
  as the change it records.
- **CSRF.** Server Actions are origin-checked by Next.js; state-changing Route
  Handlers reject cross-origin `Origin` headers.

## HTTP API

| Method & path | Description |
| --- | --- |
| `POST /api/auth/login` | `{ username, password }` → `{ user }` + session cookie |
| `POST /api/auth/logout` | Revokes the session (204) |
| `GET /api/auth/me` | Current user and permissions, or 401 |
| `GET /api/requests?type=item\|service&scope=all\|own` | Requests visible to the caller |
| `GET /api/requests/:id?type=item\|service` | One request, or 404 |
| `GET /api/events` | Server-Sent Events: request-change notifications (ids only) |
| `GET /api/item-request/:id/attachment`, `/api/reimbursement-request/:id/attachment` | Attachments (`?download=1` to save) |
| `GET /api/health` (alias `/health`) | Liveness probe; does not touch the database |

Realtime: after a write commits, the server publishes a Postgres
`NOTIFY request_changed` carrying ids only, and `/api/events` streams it to
browsers, so open dashboards refetch through their normal authorized reads. It
needs no extra service and works with multiple app instances.

## Database and migrations

The schema lives in `src/db/schema.ts` (Drizzle) and, as runnable SQL, in
`src/db/tables.ts`, `src/db/indexes.ts` and the column upgrades in
`src/db/bootstrap.ts`. **Keep all four in sync** when changing the schema.

`npm run db:setup` is the migration mechanism: an idempotent initializer that
creates missing tables, adds missing columns, foreign keys and indexes, seeds
built-in roles and reference data, and creates the demo accounts only if they
do not exist. It never drops tables, truncates the catalog, rewrites serials or
resets existing passwords. There is no migration-history table.

**Back up the database before running it against production**, and run it
**before** starting a new build whose schema changed. The current build needs
`users.session_version`, `failed_login_attempts` and `audit_logs`; without
`session_version` every request fails to load the session.

## Testing

```powershell
npm test
# Optional, against a throwaway database (never your real one):
$env:TEST_DATABASE_URL = "postgresql://postgres:<password>@localhost:5432/RS_DB_TEST"
npm run test:integration
```

Unit tests cover session tokens, RBAC and department scoping, the approval
policy, login throttling and the sign-in flow, serial numbers, validation and
Zod schemas, error mapping and log redaction, and the Route Handlers
(unauthenticated access, CSRF, error shapes). The integration suite checks
concurrent serial allocation, transactional audit rollback and the throttle
table against a real PostgreSQL database.
