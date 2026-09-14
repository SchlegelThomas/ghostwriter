import { describe, expect, it } from "vitest";
import {
  LocalBridgeStructurePreviewConflictError,
  createLocalBridgeClient
} from "./local-bridge-client.js";

const token = "gw_bridge_mutation_client_token";

describe("createLocalBridgeClient mutation POST", () => {
  it("posts coordination create to the exact bridge path", async () => {
    let seen: { url: string; body: unknown; authorization?: string } | undefined;
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
          body: JSON.parse(String(init?.body)),
          authorization: init?.headers
            ? (init.headers as Record<string, string>).Authorization
            : undefined
        };
        return new Response(
          JSON.stringify({
            replayed: false,
            coordination: { id: "coord-1", title: "Test" },
            rootAssignment: { id: "root-1" },
            projection: { steps: [] }
          }),
          { status: 201, headers: { "content-type": "application/json" } }
        );
      }
    });
    const body = {
      expectedProjectVersion: 1,
      idempotencyKey: "coord-key",
      title: "Coordination title",
      scene: {
        title: "Scene step",
        brief: "Brief",
        constraints: "Constraints",
        doneWhen: "Done",
        model: "gpt-4.1",
        sceneIds: ["scene-a"]
      },
      check: {
        title: "Check step",
        brief: "Brief",
        constraints: "Constraints",
        doneWhen: "Done",
        model: "gpt-4.1",
        surroundingSceneIds: ["scene-b"]
      }
    };
    const result = await client.createStoryWorkCoordination(body);
    expect(seen?.url).toBe("http://bridge.test/local-mcp/v1/coordinations");
    expect(seen?.authorization).toBe(`Bearer ${token}`);
    expect(seen?.body).toEqual(body);
    expect(result.coordination).toMatchObject({ id: "coord-1" });
    expect(JSON.stringify(result)).not.toContain(token);
  });

  it("maps preview 409 missingRequired to a safe typed error", async () => {
    const client = createLocalBridgeClient({
      apiUrl: "http://bridge.test",
      token,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            error: "Structure preview selection is invalid.",
            code: "MISSING_REQUIRED",
            missingRequired: ["op-a", "op-b"]
          }),
          { status: 409, headers: { "content-type": "application/json" } }
        )
    });
    await expect(
      client.previewStoryStructure({
        assignmentId: "assignment-1",
        expectedAssignmentVersion: 1,
        expectedProjectVersion: 1,
        artifact: {
          proposalId: "proposal-1",
          artifactVersion: 1,
          contentHash: "b".repeat(64)
        },
        selectedOperationIds: ["op-only"]
      })
    ).rejects.toMatchObject({
      name: "LocalBridgeStructurePreviewConflictError",
      missingRequired: ["op-a", "op-b"]
    } satisfies Partial<LocalBridgeStructurePreviewConflictError>);
  });

  it("posts continue to the coordination step path", async () => {
    let url: string | undefined;
    const client = createLocalBridgeClient({
      apiUrl: "http://bridge.test",
      token,
      fetchImpl: async (input) => {
        url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        return new Response(
          JSON.stringify({
            replayed: true,
            coordination: { id: "coord-1" },
            rootAssignment: { id: "root-1" },
            checkAssignment: { id: "check-1" }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
    });
    await client.continueStoryWorkCoordinationStep("coord-1", "step-check", {
      expectedCoordinationVersion: 2,
      expectedUpstreamArtifact: {
        proposalId: "proposal-1",
        artifactVersion: 1,
        contentHash: "c".repeat(64)
      }
    });
    expect(url).toBe(
      "http://bridge.test/local-mcp/v1/coordinations/coord-1/steps/step-check/continue"
    );
  });
});
