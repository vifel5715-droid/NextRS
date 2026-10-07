# Request System — Next.js client

This is the unified-application migration workspace. The original Vite client
and Express backend remain unchanged until their replacements are verified.
The existing UI screens now load through explicit Next.js App Router paths;
React stateful screens remain client-rendered while their shared providers and
permissions are preserved.

## Run locally

```sh
npm install
Copy-Item .env.example .env.local
npm run dev
```

Set `DATABASE_URL`, `JWT_SECRET`, and `JWT_REFRESH_SECRET` in `.env.local`.
Until API routes and realtime are migrated, keep the existing Express backend
running and set `LEGACY_API_ORIGIN` and `NEXT_PUBLIC_SOCKET_URL` to its origin.
The Next.js API catch-all forwards existing HTTP API calls to that backend;
it returns an explicit 501 for API calls when no legacy origin is configured.
Socket.IO uses a direct connection because Next.js Route Handlers do not proxy
WebSocket upgrades.

The Drizzle schema and a reusable server-only PostgreSQL pool are in
`src/server/db`. The health endpoint is already served by Next.js. The rest of
the API, auth/security middleware, and Socket.IO server remain migration work;
this app is not a replacement for the existing backend deployment yet.

## Database setup and migrations

The PostgreSQL schema, bootstrap scripts, seed data, and existing one-off
migrations are available here:

- Schema and idempotent create-table SQL: `src/server/db/schema.ts` and
  `src/database/tables.ts`
- Database initialization and demo-user/role seeding: `src/scripts/init-db.ts`
- Existing schema/data migration scripts: `src/scripts/migrate/`
- Drizzle Kit config: `drizzle.config.ts`

Set `DATABASE_URL` in `.env.local` (or provide it in the shell environment) as
a PostgreSQL URL, such as
`postgresql://postgres:<URL-encoded-password>@localhost:5432/RS_DB?connect_timeout=10`.
Percent-encode reserved characters in the username or password. Then run
commands from this directory:

```powershell
npm run init-db
npm run migrate:add-roles
npm run view-db
```

`init-db` creates missing tables/indexes and seeds built-in roles,
departments, and demo users. It does not run every historical migration in
sequence. For an existing database, run only the specific migration commands
needed for that database's current schema, in the order established by the
original server deployment history. The individual `migrate:*` command names
from the former backend are retained in `package.json`.

**Back up the database first.** Some retained maintenance commands are
destructive: `migrate:replace-item-catalog-2026-09` truncates and replaces the
item catalog; `drop-tables` removes tables; `clear-requests` deletes request
data. Do not run these against production unless that operation is intended.
The optional `INIT_DB_DEMO_PASSWORD` and `ADMIN_RESET_PASSWORD` variables are
for database scripts only and must not use a `NEXT_PUBLIC_` prefix.

## Build and run

```sh
npm run build
npm start
```
