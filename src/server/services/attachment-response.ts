import "server-only";

import { readFile } from "node:fs/promises";
import { basename, resolve, sep } from "node:path";
import { env } from "@/lib/env";

/**
 * Builds the HTTP response for a stored PDF attachment.
 *
 * `?download=1` forces a download; otherwise the PDF opens inline in the
 * browser's viewer. Filenames with spaces, parentheses, and non-ASCII
 * characters are sent via RFC 5987 `filename*` plus an ASCII fallback, and
 * control characters/quotes/path separators are stripped so the header
 * cannot be broken or spoofed.
 */
export function attachmentResponse(
  request: Request,
  file: { name: string; data: Buffer; mime?: string | null },
  headOnly = false
): Response {
  const download = new URL(request.url).searchParams.get("download") === "1";
  const safeName = file.name.replace(/[\\/"\x00-\x1F\x7F]/g, "_") || "attachment.pdf";
  const fallbackName = safeName.replace(/[^\x20-\x7E]/g, "_");
  const disposition = `${download ? "attachment" : "inline"}; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`;
  return new Response(headOnly ? null : new Uint8Array(file.data), {
    headers: {
      // Only PDFs are accepted on upload; never echo a stored MIME type that
      // could make the browser render active content.
      "Content-Type": "application/pdf",
      "Content-Disposition": disposition,
      "Content-Length": String(file.data.length),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function attachmentError(message: string, status: number): Response {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Rows created before attachments moved into the database only carry an
 * on-disk filename (item_requests.attachment). Resolve it strictly inside
 * LEGACY_UPLOADS_DIR — basename only, so a stored value like
 * "../../etc/passwd" can never escape the directory. Returns null when the
 * directory isn't configured or the file is gone (Railway's filesystem is
 * ephemeral, so most legacy files no longer exist).
 */
export async function readLegacyAttachment(storedName: string | null): Promise<Buffer | null> {
  if (!storedName || !env.LEGACY_UPLOADS_DIR) return null;
  const root = resolve(env.LEGACY_UPLOADS_DIR);
  const target = resolve(root, basename(storedName));
  if (!target.startsWith(root + sep)) return null;
  try {
    return await readFile(target);
  } catch {
    return null;
  }
}
