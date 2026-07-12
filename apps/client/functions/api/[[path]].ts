const ALLOWED_METHODS = new Set([
  "GET",
  "HEAD",
  "POST",
  "PATCH",
  "DELETE",
  "OPTIONS"
]);

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
]);

export function upstreamOrigin(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.origin !== value) {
    throw new Error("GHOSTWRITER_API_ORIGIN must be an HTTPS origin.");
  }
  return url;
}

export function forwardedRequest(request: Request, upstream: URL): Request {
  const publicUrl = new URL(request.url);
  const target = new URL(`${publicUrl.pathname}${publicUrl.search}`, upstream);
  const headers = new Headers(request.headers);

  headers.delete("host");
  headers.delete("content-length");
  for (const header of HOP_BY_HOP_HEADERS) headers.delete(header);
  headers.set("x-forwarded-host", publicUrl.host);
  headers.set("x-forwarded-proto", publicUrl.protocol.slice(0, -1));

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers,
    body: hasBody ? request.body : undefined,
    redirect: "manual",
    ...(hasBody ? { duplex: "half" } : {})
  };
  return new Request(target, init);
}

export function forwardedResponse(response: Response): Response {
  const headers = new Headers();
  for (const [name, value] of response.headers) {
    const normalized = name.toLowerCase();
    if (normalized === "set-cookie" || HOP_BY_HOP_HEADERS.has(normalized)) continue;
    headers.append(name, value);
  }
  for (const cookie of response.headers.getSetCookie()) {
    headers.append("set-cookie", cookie);
  }
  headers.set("cache-control", "no-store");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export const onRequest: PagesFunction<Env> = async (context) => {
  if (!ALLOWED_METHODS.has(context.request.method)) {
    return Response.json(
      { error: "Method not allowed.", code: "METHOD_NOT_ALLOWED" },
      {
        status: 405,
        headers: { allow: [...ALLOWED_METHODS].join(", ") }
      }
    );
  }

  try {
    const response = await fetch(
      forwardedRequest(
        context.request,
        upstreamOrigin(context.env.GHOSTWRITER_API_ORIGIN)
      )
    );
    return forwardedResponse(response);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "ghostwriter_api_proxy_failed",
        errorName: error instanceof Error ? error.name : "UnknownError"
      })
    );
    return Response.json(
      { error: "The Ghostwriter service is unavailable.", code: "UPSTREAM_UNAVAILABLE" },
      {
        status: 502,
        headers: { "cache-control": "no-store" }
      }
    );
  }
};
