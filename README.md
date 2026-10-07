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

## Build and run

```sh
npm run build
npm start
```
