import { describe, expect, it, vi } from "vitest";
import { createDoublePressHandler } from "./double-press.js";

describe("createDoublePressHandler", () => {
  it("invokes the callback only on a second press within the window", () => {
    const onDoublePress = vi.fn();
    let now = 1_000;
    const press = createDoublePressHandler(onDoublePress, 350, () => now);

    press();
    expect(onDoublePress).not.toHaveBeenCalled();

    now = 1_200;
    press();
    expect(onDoublePress).toHaveBeenCalledTimes(1);

    now = 1_600;
    press();
    expect(onDoublePress).toHaveBeenCalledTimes(1);

    now = 1_700;
    press();
    expect(onDoublePress).toHaveBeenCalledTimes(2);
  });

  it("ignores a second press after the window expires", () => {
    const onDoublePress = vi.fn();
    let now = 1_000;
    const press = createDoublePressHandler(onDoublePress, 350, () => now);

    press();
    now = 1_400;
    press();
    expect(onDoublePress).not.toHaveBeenCalled();
  });
});
