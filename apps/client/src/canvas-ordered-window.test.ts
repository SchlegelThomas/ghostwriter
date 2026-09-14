import { describe, expect, it } from "vitest";
import { canvasOrderedWindow } from "./canvas-ordered-window.js";

describe("ordered Canvas window", () => {
  const canonical = Array.from({ length: 1_000 }, (_, index) => index);

  it("shows the first 100 objects and expands in 100-object batches", () => {
    const first = canvasOrderedWindow(canonical, 100);
    expect(first.items.map((entry) => entry.item)).toEqual(
      canonical.slice(0, 100)
    );
    expect(first).toMatchObject({
      shownCount: 100,
      totalCount: 1_000,
      nextLimit: 200
    });

    const second = canvasOrderedWindow(canonical, first.nextLimit!);
    expect(second.items.map((entry) => entry.item)).toEqual(
      canonical.slice(0, 200)
    );
    expect(second.nextLimit).toBe(300);
  });

  it("reveals an off-page selection without expanding the loaded prefix", () => {
    const selected = canvasOrderedWindow(canonical, 100, 449);
    expect(selected.shownCount).toBe(100);
    expect(selected.renderedCount).toBe(101);
    expect(selected.items.slice(0, 100).map((entry) => entry.item)).toEqual(
      canonical.slice(0, 100)
    );
    expect(selected.items[100]).toEqual({
      item: 449,
      sourceIndex: 449,
      outsideLoadedRange: true
    });
    expect(selected.nextLimit).toBe(200);
  });

  it("keeps selection of the final result within the 101-row render bound", () => {
    const selected = canvasOrderedWindow(canonical, 100, 999);
    expect(selected.shownCount).toBe(100);
    expect(selected.renderedCount).toBe(101);
    expect(selected.items[100]).toEqual({
      item: 999,
      sourceIndex: 999,
      outsideLoadedRange: true
    });
    expect(selected.nextLimit).toBe(200);
  });

  it("does not advertise another page after the final partial batch", () => {
    expect(canvasOrderedWindow(canonical.slice(0, 135), 200)).toMatchObject({
      shownCount: 135,
      totalCount: 135
    });
    expect(canvasOrderedWindow(canonical.slice(0, 135), 200).nextLimit).toBeUndefined();
  });
});
