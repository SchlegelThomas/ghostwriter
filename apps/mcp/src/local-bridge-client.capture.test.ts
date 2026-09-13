import { describe, expect, it } from "vitest";
import { createLocalBridgeClient } from "./local-bridge-client.js";

const token = "gw_bridge_capture_client_token";

describe("createLocalBridgeClient capture routes", () => {
  it("reads capture summaries from the bridge GET path", async () => {
    let seen: { url: string; authorization?: string } | undefined;
    const client = createLocalBridgeClient({
      apiUrl: "http://bridge.test",
      token,
      fetchImpl: async (input, init) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        seen = {
          url,
          authorization: init?.headers
            ? (init.headers as Record<string, string>).Authorization
            : undefined
        };
        return new Response(
          JSON.stringify({
            captureId: "capture-1",
            projectId: "project-1",
            status: "ready",
            sourceModality: "text",
            workingVersion: 1,
            contentHash: "a".repeat(64),
            plainTextSummary: "Fog",
            truncated: false,
            updatedAt: "2026-07-01T00:00:00.000Z"
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
    });
    const summary = await client.readCapture("capture-1");
    expect(seen?.url).toBe("http://bridge.test/local-mcp/v1/captures/capture-1");
    expect(seen?.authorization).toBe(`Bearer ${token}`);
    expect(summary).toMatchObject({ captureId: "capture-1" });
    expect(JSON.stringify(summary)).not.toContain(token);
  });

  it("posts empty JSON bodies for context and proposals", async () => {
    const posts: Array<{ url: string; body: unknown }> = [];
    const client = createLocalBridgeClient({
      apiUrl: "http://bridge.test",
      token,
      fetchImpl: async (input, init) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        posts.push({ url, body: JSON.parse(String(init?.body)) });
        if (url.endsWith("/context")) {
          return new Response(
            JSON.stringify({
              id: "receipt-1",
              projectId: "project-1",
              workflowId: "wf",
              receiptHash: "b".repeat(64),
              model: "gpt-4.1",
              createdAt: "2026-07-01T00:00:00.000Z"
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        return new Response(
          JSON.stringify({
            kind: "ready",
            runId: "run-1",
            proposalId: "proposal-1",
            status: "ready"
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
    });
    await client.assembleCaptureReflectionContext("capture-1");
    await client.proposeCaptureReflection("capture-1");
    expect(posts).toEqual([
      {
        url: "http://bridge.test/local-mcp/v1/captures/capture-1/context",
        body: {}
      },
      {
        url: "http://bridge.test/local-mcp/v1/captures/capture-1/proposals",
        body: {}
      }
    ]);
  });
});
