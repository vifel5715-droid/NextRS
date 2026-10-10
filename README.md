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
authenticated Server Actions. The client does not attempt a Socket.IO
connection because no realtime server is deployed; open dashboards do not
receive changes made by other users until they reload.

## Database setup

The PostgreSQL schema, database bootstrap, and seed data are available here:

- Schema and idempotent create-table SQL: `src/server/db/schema.ts` and
  `src/database/tables.ts`
- Database initialization, existing-schema upgrades, and reference-data
  imports: `src/scripts/init-db.ts` and `src/database/`
- Drizzle Kit config: `drizzle.config.ts`

Set `DATABASE_URL` in `.env.local` (or provide it in the shell environment) as
a PostgreSQL URL, such as
`postgresql://postgres:<URL-encoded-password>@localhost:5432/RS_DB?connect_timeout=10`.
Percent-encode reserved characters in the username or password. Then run
this command from the project directory to create the current tables, add
missing columns to existing tables, seed built-in roles and options, add
missing catalog items, create indexes, and seed demo users:

```powershell
npm run db:setup
```

Before running this against Railway or any production database, take a
database backup and set `INIT_DB_DEMO_PASSWORD` to a strong, unique password.
The seeded demo accounts share that password; existing accounts and their
passwords are never reset. `npm run db:setup` and `npm run init-db` run the
same idempotent initializer; there is no separate migration runner or
migration-history table. Existing request, catalog, and administrator data
is preserved. Catalog loading is additive and never truncates the catalog.
The initializer does not run destructive operations such as table drops,
catalog replacement, or historical serial rewrites. If legacy data prevents
a foreign key or unique index from being created, setup stops with the
database error rather than deleting records automatically.

**Back up the database first.** The optional `INIT_DB_DEMO_PASSWORD` and
`ADMIN_RESET_PASSWORD` variables are for database scripts only and must not
use a `NEXT_PUBLIC_` prefix.

## Build and run

```sh
npm run build
npm start
```
