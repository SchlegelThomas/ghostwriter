import { describe, expect, it } from "vitest";
import {
  WORK_PLAN_WORKING_QUIPS,
  workPlanQuipAtIndex,
  workPlanQuipPhase
} from "./work-plan-working-quips.js";

describe("work-plan-working-quips", () => {
  it("has a rich quip list", () => {
    expect(WORK_PLAN_WORKING_QUIPS.length).toBeGreaterThanOrEqual(50);
  });

  it("typewrites then holds before the next cycle", () => {
    const quip = "Reviewing";
    expect(workPlanQuipPhase(0, quip, 50, 1000).visible).toBe("R");
    expect(workPlanQuipPhase(200, quip, 50, 1000).visible).toBe("Revie");
    const held = workPlanQuipPhase(quip.length * 50 + 10, quip, 50, 1000);
    expect(held.visible).toBe(quip);
    expect(held.complete).toBe(true);
  });

  it("wraps quip indexes", () => {
    expect(workPlanQuipAtIndex(0)).toBe(WORK_PLAN_WORKING_QUIPS[0]);
    expect(workPlanQuipAtIndex(WORK_PLAN_WORKING_QUIPS.length)).toBe(
      WORK_PLAN_WORKING_QUIPS[0]
    );
  });
});
