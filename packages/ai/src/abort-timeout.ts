export type AbortReason = "caller" | "timeout";

export type CombinedAbort = {
  signal: AbortSignal;
  reason: () => AbortReason | undefined;
  dispose: () => void;
};

export function combineAbortWithTimeout(
  callerSignal: AbortSignal | undefined,
  timeoutMs: number
): CombinedAbort {
  const controller = new AbortController();
  let resolvedReason: AbortReason | undefined;
  let disposed = false;

  const finish = (reason: AbortReason) => {
    if (resolvedReason !== undefined || disposed) {
      return;
    }
    resolvedReason = reason;
    controller.abort();
  };

  const onCallerAbort = () => {
    finish("caller");
  };

  if (callerSignal?.aborted) {
    finish("caller");
  } else if (callerSignal) {
    callerSignal.addEventListener("abort", onCallerAbort);
  }

  const timer =
    timeoutMs > 0
      ? setTimeout(() => {
          finish("timeout");
        }, timeoutMs)
      : undefined;
  // Allow Node to exit if a caller forgets dispose() after a successful call.
  if (timer !== undefined && typeof timer.unref === "function") {
    timer.unref();
  }

  const onCombinedAbort = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  };

  controller.signal.addEventListener("abort", onCombinedAbort, { once: true });

  const dispose = () => {
    if (disposed) {
      return;
    }
    disposed = true;
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    if (callerSignal) {
      callerSignal.removeEventListener("abort", onCallerAbort);
    }
    controller.signal.removeEventListener("abort", onCombinedAbort);
  };

  return {
    signal: controller.signal,
    reason: () => resolvedReason,
    dispose
  };
}
