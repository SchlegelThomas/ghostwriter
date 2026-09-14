import { describe, expect, it } from "vitest";
import { sceneDraftDocument } from "./scene-draft-document.js";

describe("reviewed scene prose conversion", () => {
  it("preserves literal prose and line breaks with server-generated block IDs", () => {
    let next = 0;
    const document = sceneDraftDocument({ schemaId: "scene-draft-v1", prose: "  # A letter\r\n<keep this literal>\r\n\r\nThe tide returned.  ", sourceSceneIds: [] }, () => `server-block-${++next}`);
    expect(document.document.content).toEqual([
      { type: "paragraph", attrs: { id: "server-block-1" }, content: [
        { type: "text", text: "  # A letter" }, { type: "hardBreak" }, { type: "text", text: "<keep this literal>" }
      ] },
      { type: "paragraph", attrs: { id: "server-block-2" }, content: [{ type: "text", text: "The tide returned.  " }] }
    ]);
    expect(next).toBe(2);
  });

  it("rejects model-selected document IDs and invalid prose before allocating IDs", () => {
    let calls = 0;
    const ids = () => { calls += 1; return "server-block"; };
    expect(() => sceneDraftDocument({ schemaId: "scene-draft-v1", prose: "Valid text", sourceSceneIds: [], document: {} }, ids)).toThrow();
    expect(() => sceneDraftDocument({ schemaId: "scene-draft-v1", prose: " ", sourceSceneIds: [] }, ids)).toThrow();
    expect(calls).toBe(0);
  });
});
