# Request System — Next.js client

This is the unified-application migration workspace. The existing UI screens
load through explicit Next.js App Router paths. Next.js server-renders their
initial HTML, while React Client Components preserve interactive state,
providers, and permissions after hydration.

## Run locally

```sh
npm install
Copy-Item .env.example .env.local
npm run dev
```

Set `DATABASE_URL` and a unique `SESSION_SECRET` (at least 32 random bytes) in
`.env.local`. Percent-encode reserved characters, including `@`, in the
PostgreSQL username and password.
Authentication calls same-origin Next.js Server Actions directly; it does not
need a public backend URL, CORS origin, or manually configured `NODE_ENV`.
Next.js sets `NODE_ENV` for its development/build/start commands.

The Drizzle schema and a reusable server-only PostgreSQL pool are in
`src/server/db`. Login, session restore, and logout use Next.js Server Actions
and a signed HTTP-only session cookie. Item-catalog and option-list reads,
item/service and urgent/reimbursement request lists, dashboard counts,
admin user/role lists, outed items, and adjustment/deletion history also use
authenticated Server Actions. Most request, admin, and inventory mutations
and some detail reads still use REST clients and are not migrated yet; those
API routes return HTTP 501 until implemented as Server Actions. The client
does not attempt a Socket.IO connection because no realtime server is
deployed; open dashboards do not receive changes made by other users until
they reload.

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
