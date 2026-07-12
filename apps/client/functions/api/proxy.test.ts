import { describe, expect, it } from "vitest";
import {
  forwardedRequest,
  forwardedResponse,
  upstreamOrigin
} from "./[[path]].js";

describe("Cloudflare Pages API proxy", () => {
  it("allows only a fixed HTTPS upstream origin", () => {
    expect(upstreamOrigin("https://ghostwriter-backend.fly.dev").origin).toBe(
      "https://ghostwriter-backend.fly.dev"
    );
    expect(() => upstreamOrigin("http://ghostwriter-backend.fly.dev")).toThrow();
    expect(() =>
      upstreamOrigin("https://ghostwriter-backend.fly.dev/untrusted-path")
    ).toThrow();
  });

  it("streams the same API path to the fixed upstream with forwarding metadata", async () => {
    const request = new Request(
      "https://ghostwriter.pages.dev/api/projects?includeArchived=true",
      {
        method: "POST",
        headers: {
          connection: "keep-alive",
          "content-type": "application/json",
          cookie: "ghostwriter.session_token=opaque"
        },
        body: JSON.stringify({ title: "Story" })
      }
    );
    const forwarded = forwardedRequest(
      request,
      upstreamOrigin("https://ghostwriter-backend.fly.dev")
    );

    expect(forwarded.url).toBe(
      "https://ghostwriter-backend.fly.dev/api/projects?includeArchived=true"
    );
    expect(forwarded.headers.get("connection")).toBeNull();
    expect(forwarded.headers.get("x-forwarded-host")).toBe(
      "ghostwriter.pages.dev"
    );
    expect(forwarded.headers.get("x-forwarded-proto")).toBe("https");
    expect(forwarded.headers.get("cookie")).toContain("opaque");
    await expect(forwarded.json()).resolves.toEqual({ title: "Story" });
  });

  it("preserves separate auth cookies and streams a no-store response", async () => {
    const headers = new Headers({ "content-type": "application/json" });
    headers.append("set-cookie", "ghostwriter.one=one; HttpOnly; Secure");
    headers.append("set-cookie", "ghostwriter.two=two; HttpOnly; Secure");
    const forwarded = forwardedResponse(
      new Response(JSON.stringify({ ok: true }), { status: 200, headers })
    );

    expect(forwarded.headers.getSetCookie()).toEqual([
      "ghostwriter.one=one; HttpOnly; Secure",
      "ghostwriter.two=two; HttpOnly; Secure"
    ]);
    expect(forwarded.headers.get("cache-control")).toBe("no-store");
    await expect(forwarded.json()).resolves.toEqual({ ok: true });
  });
});
