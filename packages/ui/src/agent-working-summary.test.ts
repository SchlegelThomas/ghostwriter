import { describe, expect, it } from "vitest";
import {
  agentWorkingGroupState,
  type AgentWorkingTrace
} from "./agent-working-summary.js";

const readScene: AgentWorkingTrace = { title: "Read scene", ok: true };
const searchedCast: AgentWorkingTrace = { title: "Searched cast", ok: true };
const failedLookup: AgentWorkingTrace = { title: "Checked timeline", ok: false };

describe("agentWorkingGroupState", () => {
  it("shows the live status while the agent works", () => {
    expect(
      agentWorkingGroupState({
        streaming: true,
        statusLabel: "Thinking…",
        traces: []
      })
    ).toEqual({
      visible: true,
      label: "Thinking…",
      defaultExpanded: true,
      toggleable: false
    });
  });

  it("falls back to a working label when no status arrived yet", () => {
    expect(
      agentWorkingGroupState({ streaming: true, traces: [] }).label
    ).toBe("Working…");
    expect(
      agentWorkingGroupState({
        streaming: true,
        statusLabel: "   ",
        traces: []
      }).label
    ).toBe("Working…");
  });

  it("counts steps as they arrive mid-stream", () => {
    expect(
      agentWorkingGroupState({
        streaming: true,
        statusLabel: "Writing…",
        traces: [readScene, searchedCast]
      })
    ).toEqual({
      visible: true,
      label: "Writing… · 2 steps",
      defaultExpanded: true,
      toggleable: true
    });
  });

  it("names the single step a finished turn took", () => {
    expect(
      agentWorkingGroupState({ streaming: false, traces: [readScene] })
    ).toEqual({
      visible: true,
      label: "Worked · Read scene",
      defaultExpanded: false,
      toggleable: true
    });
  });

  it("summarises several finished steps and folds them away", () => {
    expect(
      agentWorkingGroupState({
        streaming: false,
        traces: [readScene, searchedCast]
      })
    ).toEqual({
      visible: true,
      label: "Worked · 2 steps",
      defaultExpanded: false,
      toggleable: true
    });
  });

  it("flags steps that need a look", () => {
    expect(
      agentWorkingGroupState({
        streaming: false,
        traces: [readScene, failedLookup]
      }).label
    ).toBe("Worked · 2 steps · 1 needs a look");
    expect(
      agentWorkingGroupState({
        streaming: false,
        traces: [failedLookup, failedLookup]
      }).label
    ).toBe("Worked · 2 steps · 2 need a look");
  });

  it("stays out of the way when a plain reply used no tools", () => {
    expect(
      agentWorkingGroupState({ streaming: false, traces: [] })
    ).toEqual({
      visible: false,
      label: "Worked",
      defaultExpanded: false,
      toggleable: false
    });
  });
});
