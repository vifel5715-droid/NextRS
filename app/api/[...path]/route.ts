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

async function forwardToConfiguredApi(request: Request, context: RouteContext): Promise<Response> {
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!apiBaseUrl) {
    return NextResponse.json(
      { error: "NEXT_PUBLIC_API_BASE_URL is not configured." },
      { status: 501 }
    );
  }

  let bodyTooLarge = false;
  try {
    const apiUrl = new URL(apiBaseUrl);
    if (apiUrl.protocol !== "http:" && apiUrl.protocol !== "https:") {
      throw new Error("NEXT_PUBLIC_API_BASE_URL must use HTTP or HTTPS.");
    }
    const { path } = await context.params;
    const basePath = apiUrl.pathname.replace(/\/api\/?$/, "").replace(/\/$/, "");
    const target = new URL(
      `${basePath}/api/${path.map(encodeURIComponent).join("/")}${new URL(request.url).search}`,
      apiUrl.origin
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

export const GET = forwardToConfiguredApi;
export const HEAD = forwardToConfiguredApi;
export const POST = forwardToConfiguredApi;
export const PUT = forwardToConfiguredApi;
export const PATCH = forwardToConfiguredApi;
export const DELETE = forwardToConfiguredApi;
export const OPTIONS = forwardToConfiguredApi;
