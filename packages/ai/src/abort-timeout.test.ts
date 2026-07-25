import { afterEach, describe, expect, it, vi } from "vitest";
import { combineAbortWithTimeout } from "./abort-timeout.js";

describe("combineAbortWithTimeout", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("dispose clears timeout so a later tick does not abort", () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    const combined = combineAbortWithTimeout(caller.signal, 5_000);

    expect(combined.signal.aborted).toBe(false);
    combined.dispose();
    vi.advanceTimersByTime(10_000);

    expect(combined.signal.aborted).toBe(false);
    expect(combined.reason()).toBeUndefined();
    expect(caller.signal.aborted).toBe(false);
  });

  it("dispose removes caller abort listener after success path", () => {
    const caller = new AbortController();
    const combined = combineAbortWithTimeout(caller.signal, 60_000);

    combined.dispose();
    caller.abort();

    expect(combined.reason()).toBeUndefined();
  });

  it("still aborts on caller signal before dispose", () => {
    const caller = new AbortController();
    const combined = combineAbortWithTimeout(caller.signal, 60_000);

    caller.abort();
    expect(combined.reason()).toBe("caller");
    expect(combined.signal.aborted).toBe(true);
  });

  it("still aborts on timeout before dispose", () => {
    vi.useFakeTimers();
    const combined = combineAbortWithTimeout(undefined, 1_000);

    vi.advanceTimersByTime(1_000);
    expect(combined.reason()).toBe("timeout");
    expect(combined.signal.aborted).toBe(true);
  });
});
