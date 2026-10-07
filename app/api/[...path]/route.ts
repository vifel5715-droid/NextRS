import { NextResponse } from "next/server";

type RouteContext = { params: Promise<{ path: string[] }> };

const MAX_FORWARDED_BODY_BYTES = 12 * 1024 * 1024;

const forwardedRequestHeaders = [
  "accept",
  "content-type",
  "cookie",
  "ngrok-skip-browser-warning",
  "user-agent",
  "x-csrf-token",
];

async function forwardToLegacyApi(request: Request, context: RouteContext): Promise<Response> {
  const legacyOrigin = process.env.LEGACY_API_ORIGIN;
  if (!legacyOrigin) {
    return NextResponse.json(
      { error: "This API endpoint has not yet been migrated to Next.js." },
      { status: 501 }
    );
  }

  let bodyTooLarge = false;
  try {
    const legacyUrl = new URL(legacyOrigin);
    if (legacyUrl.protocol !== "http:" && legacyUrl.protocol !== "https:") {
      throw new Error("LEGACY_API_ORIGIN must use HTTP or HTTPS.");
    }
    const { path } = await context.params;
    const target = new URL(
      `/api/${path.map(encodeURIComponent).join("/")}${new URL(request.url).search}`,
      legacyUrl
    );
    const headers = new Headers();
    for (const name of forwardedRequestHeaders) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }

    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > MAX_FORWARDED_BODY_BYTES) {
      return NextResponse.json({ error: "Request body is too large." }, { status: 413 });
    }

    let bodyBytes = 0;
    const body = ["GET", "HEAD"].includes(request.method) || !request.body
      ? undefined
      : request.body.pipeThrough(
          new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) {
              bodyBytes += chunk.byteLength;
              if (bodyBytes > MAX_FORWARDED_BODY_BYTES) {
                bodyTooLarge = true;
                throw new Error("Request body is too large.");
              }
              controller.enqueue(chunk);
            },
          })
        );

    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body,
      cache: "no-store",
      redirect: "manual",
      ...(body ? { duplex: "half" } : {}),
    });
    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.delete("connection");
    responseHeaders.delete("content-encoding");
    responseHeaders.delete("content-length");
    responseHeaders.delete("transfer-encoding");
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    if (bodyTooLarge) {
      return NextResponse.json({ error: "Request body is too large." }, { status: 413 });
    }
    console.error("Legacy API forwarding failed:", error);
    return NextResponse.json(
      { error: "The existing API service could not be reached." },
      { status: 502 }
    );
  }
}

export const GET = forwardToLegacyApi;
export const HEAD = forwardToLegacyApi;
export const POST = forwardToLegacyApi;
export const PUT = forwardToLegacyApi;
export const PATCH = forwardToLegacyApi;
export const DELETE = forwardToLegacyApi;
export const OPTIONS = forwardToLegacyApi;
