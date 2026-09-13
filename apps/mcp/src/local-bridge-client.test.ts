import { describe, expect, it } from "vitest";
import {
  LocalBridgeConfigError,
  LocalBridgeNotFoundError,
  LocalBridgeRequestFailedError,
  createLocalBridgeClient,
  parseLocalBridgeConfig
} from "./local-bridge-client.js";

describe("parseLocalBridgeConfig", () => {
  it("requires both URL and token", () => {
    expect(() => parseLocalBridgeConfig({})).toThrow(LocalBridgeConfigError);
    expect(() =>
      parseLocalBridgeConfig({ apiUrl: "http://127.0.0.1:9" })
    ).toThrow(/GRANT_TOKEN/);
    expect(() =>
      parseLocalBridgeConfig({ grantToken: "gw_token" })
    ).toThrow(/API_URL/);
  });

  it("accepts http(s) URLs and trims trailing slashes", () => {
    const config = parseLocalBridgeConfig({
      apiUrl: "  http://127.0.0.1:8080/ ",
      grantToken: "  gw_test_token  "
    });
    expect(config.apiUrl).toBe("http://127.0.0.1:8080");
    expect(config.token).toBe("gw_test_token");
  });

  it("rejects non-http URLs", () => {
    expect(() =>
      parseLocalBridgeConfig({
        apiUrl: "file:///tmp",
        grantToken: "t"
      })
    ).toThrow(/http or https/);
  });
});

describe("createLocalBridgeClient", () => {
  const token = "gw_bridge_client_test_token_value";

  it("sends Authorization Bearer and unwraps grant", async () => {
    let seenAuth: string | undefined;
    const client = createLocalBridgeClient({
      apiUrl: "http://bridge.test",
      token,
      fetchImpl: async (input, init) => {
        seenAuth = init?.headers
          ? (init.headers as Record<string, string>).Authorization
          : undefined;
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        if (url.endsWith("/local-mcp/v1/grant")) {
          return new Response(
            JSON.stringify({
              grant: {
                id: "grant-1",
                projectId: "project-1",
                captureIds: [],
                sceneIds: [],
                bookIds: [],
                assignmentIds: [],
                coordinationIds: [],
                allowProjectStructureRead: false,
                tools: ["ghostwriter_get_grant"],
                expiresAt: "2026-08-01T00:00:00.000Z"
              }
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        return new Response("{}", { status: 404 });
      }
    });

    const grant = await client.getGrant();
    expect(seenAuth).toBe(`Bearer ${token}`);
    expect(grant).toMatchObject({ id: "grant-1", projectId: "project-1" });
  });

  it("maps 404 to LocalBridgeNotFoundError", async () => {
    const client = createLocalBridgeClient({
      apiUrl: "http://bridge.test",
      token,
      fetchImpl: async () => new Response('{"error":"Not found."}', { status: 404 })
    });
    await expect(client.listStoryWork()).rejects.toBeInstanceOf(
      LocalBridgeNotFoundError
    );
  });

  it("maps other failures to LocalBridgeRequestFailedError", async () => {
    const client = createLocalBridgeClient({
      apiUrl: "http://bridge.test",
      token,
      fetchImpl: async () => new Response("{}", { status: 500 })
    });
    await expect(client.getStoryWork("assignment-1")).rejects.toBeInstanceOf(
      LocalBridgeRequestFailedError
    );
  });
});
