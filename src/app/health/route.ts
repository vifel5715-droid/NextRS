// Kept at its pre-restructure path so an existing hosting health check that
// points at /health keeps passing. The canonical endpoint is /api/health.
export const dynamic = "force-dynamic";
export { GET } from "../api/health/route";
