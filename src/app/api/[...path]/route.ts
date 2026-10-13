import { apiError } from "@/lib/api-response";

// Any /api/* path without its own route: a JSON 404 in the API's standard
// error shape, rather than the HTML not-found page.
function notFound() {
  return apiError(404, "NOT_FOUND", "This API endpoint does not exist.");
}

export const GET = notFound;
export const HEAD = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
export const OPTIONS = notFound;
