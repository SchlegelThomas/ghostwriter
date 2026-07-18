import { describe, expect, it } from "vitest";
import {
  clampSplitRatio,
  SPLIT_RATIO_DEFAULT,
  SPLIT_RATIO_MAX,
  SPLIT_RATIO_MIN
} from "./split-layout.js";

describe("split-layout", () => {
  it("clamps invalid and out-of-range ratios", () => {
    expect(clampSplitRatio(Number.NaN)).toBe(SPLIT_RATIO_DEFAULT);
    expect(clampSplitRatio(0.1)).toBe(SPLIT_RATIO_MIN);
    expect(clampSplitRatio(0.9)).toBe(SPLIT_RATIO_MAX);
    expect(clampSplitRatio(0.42)).toBe(0.42);
  });
});
