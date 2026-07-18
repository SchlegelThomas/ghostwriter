import { describe, expect, it } from "vitest";

import { clampEditorSelection } from "./selection.js";

describe("clampEditorSelection", () => {
  it("preserves a valid collapsed caret", () => {
    expect(clampEditorSelection({ from: 5, to: 5 }, 10)).toEqual({
      from: 5,
      to: 5,
    });
  });

  it("preserves a valid forward range", () => {
    expect(clampEditorSelection({ from: 3, to: 7 }, 10)).toEqual({
      from: 3,
      to: 7,
    });
  });

  it("clamps from and to into [1, maximum]", () => {
    expect(clampEditorSelection({ from: 0, to: 15 }, 10)).toEqual({
      from: 1,
      to: 10,
    });

    expect(clampEditorSelection({ from: -5, to: 20 }, 8)).toEqual({
      from: 1,
      to: 8,
    });
  });

  it("never lets to fall before from", () => {
    expect(clampEditorSelection({ from: 8, to: 3 }, 10)).toEqual({
      from: 8,
      to: 8,
    });
  });

  it("floors fractional selection and maximum values deterministically", () => {
    expect(clampEditorSelection({ from: 3.9, to: 7.2 }, 10.9)).toEqual({
      from: 3,
      to: 7,
    });

    expect(clampEditorSelection({ from: 2.1, to: 9.99 }, 9.1)).toEqual({
      from: 2,
      to: 9,
    });
  });

  it("normalizes nonpositive maximum values to one", () => {
    expect(clampEditorSelection({ from: 5, to: 8 }, 0)).toEqual({
      from: 1,
      to: 1,
    });

    expect(clampEditorSelection({ from: 1, to: 1 }, -3.7)).toEqual({
      from: 1,
      to: 1,
    });
  });
});
