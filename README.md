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
authenticated Server Actions. Pending purchase-item counts also use an
authenticated Server Action. Most request, admin, and inventory mutations
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
this command from the project directory to create the current tables, apply
the tracked schema upgrades, seed built-in roles and options, merge missing
catalog items, and finish indexes and demo-user setup:

```powershell
npm run db:setup
```

Before running this against Railway or any production database, take a
database backup and set `INIT_DB_DEMO_PASSWORD` to a strong, unique password.
The seeded demo accounts share that password; existing accounts are never
reset. The setup command records completed migration steps in
`nextjs_schema_migrations` and stops on the first error. It is safe to rerun
the curated sequence, but a failed step must be corrected before retrying.

The command deliberately does not run operations that can discard data or
rewrite administrator choices: catalog replacement, legacy attachment-file
migration, service-field drops, adjustment-department rewrites, and
admin-permission backfills remain manual. Legacy serial normalization and
adjustment-serial generation are also left as targeted operations because
they rewrite historical identifiers and need duplicate/sequence checks. The
missing historical `migrate:import-item-catalog-2026-08` target was removed;
the setup command uses an additive catalog merge instead, preserving
existing item records.
Unique-index or foreign-key creation can still stop if legacy data contains
duplicates or orphan rows; resolve those explicitly rather than deleting
production data automatically.

This command prepares the database only. It does not implement the remaining
unmigrated REST endpoints, which still return HTTP 501 until converted to
Server Actions.

The individual maintenance commands are retained for reviewed, targeted
operations. Do not use `migrate:replace-item-catalog-2026-09`, `drop-tables`,
or `clear-requests` unless the corresponding data loss is explicitly
intended. `npm run init-db` remains available for standalone table/index and
seed initialization.

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
