/** Pure helper for unmarked double-tap / double-click hit targets. */
export function createDoublePressHandler(
  onDoublePress: () => void,
  windowMs = 350,
  now: () => number = () => Date.now()
): () => void {
  let lastPressAt = 0;
  return () => {
    const at = now();
    if (lastPressAt > 0 && at - lastPressAt <= windowMs) {
      lastPressAt = 0;
      onDoublePress();
      return;
    }
    lastPressAt = at;
  };
}
