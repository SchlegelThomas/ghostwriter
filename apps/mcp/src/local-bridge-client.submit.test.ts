import { describe, expect, it } from "vitest";
import {
  LocalBridgeConflictError,
  LocalBridgeInvalidRequestError,
  LocalBridgeNotFoundError,
  LocalBridgeUnavailableError,
  createLocalBridgeClient
} from "./local-bridge-client.js";

const token = "gw_bridge_submit_client_token";

function characterBody() {
  return {
    expectedProjectVersion: 1,
    assignmentIdempotencyKey: "assignment-key-1",
    attemptIdempotencyKey: "attempt-key-1",
    brief: "  Brief text for bridge.  ",
    constraints: "Constraints",
    doneWhen: "Done when ready.",
    sceneIds: ["scene-a"],
    model: "gpt-4.1"
  };
}

describe("createLocalBridgeClient submit POST", () => {
  it("sends Authorization, content-type, path, and JSON body", async () => {
    let seen:
      | {
          url: string;
          method: string;
          authorization?: string;
          contentType?: string;
          body: unknown;
        }
      | undefined;
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
          method: init?.method ?? "GET",
          authorization: init?.headers
            ? (init.headers as Record<string, string>).Authorization
            : undefined,
          contentType: init?.headers
            ? (init.headers as Record<string, string>)["Content-Type"]
            : undefined,
          body: init?.body === undefined ? undefined : JSON.parse(String(init.body))
        };
        return new Response(
          JSON.stringify({
            assignment: { id: "assignment-1", status: "ready" },
            created: true,
            generation: {
              kind: "ready",
              state: { attempt: { instruction: characterBody().brief } }
            }
          }),
          { status: 201, headers: { "content-type": "application/json" } }
        );
      }
    });

    const body = characterBody();
    const result = await client.submitCharacterWork(body);
    expect(seen?.url).toBe("http://bridge.test/local-mcp/v1/story-work/character");
    expect(seen?.method).toBe("POST");
    expect(seen?.authorization).toBe(`Bearer ${token}`);
    expect(seen?.contentType).toBe("application/json");
    expect(seen?.body).toEqual(body);
    expect(result.created).toBe(true);
    expect(result.generation).toMatchObject({ kind: "ready" });
    expect(JSON.stringify(result)).not.toContain(token);
  });

  it("maps submit HTTP statuses to typed errors", async () => {
    async function clientForStatus(status: number) {
      return createLocalBridgeClient({
        apiUrl: "http://bridge.test",
        token,
        fetchImpl: async () =>
          new Response(JSON.stringify({ error: "hidden" }), {
            status,
            headers: { "content-type": "application/json" }
          })
      });
    }
    await expect(
      clientForStatus(404).then((c) => c.submitCharacterWork(characterBody()))
    ).rejects.toBeInstanceOf(LocalBridgeNotFoundError);
    await expect(
      clientForStatus(409).then((c) => c.submitCharacterWork(characterBody()))
    ).rejects.toBeInstanceOf(LocalBridgeConflictError);
    await expect(
      clientForStatus(422).then((c) => c.submitCharacterWork(characterBody()))
    ).rejects.toBeInstanceOf(LocalBridgeInvalidRequestError);
    await expect(
      clientForStatus(503).then((c) => c.submitCharacterWork(characterBody()))
    ).rejects.toBeInstanceOf(LocalBridgeUnavailableError);
  });

  it("returns replay responses with created false", async () => {
    const client = createLocalBridgeClient({
      apiUrl: "http://bridge.test",
      token,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            assignment: { id: "assignment-1" },
            created: false,
            generation: { kind: "replayed", state: { runId: "run-1" } }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    });
    const result = await client.submitCharacterWork(characterBody());
    expect(result.created).toBe(false);
    expect(result.generation).toMatchObject({ kind: "replayed" });
  });
});
