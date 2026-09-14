const ORDERED_CANVAS_BATCH_SIZE = 100;

export type CanvasOrderedWindow<T> = Readonly<{
  items: readonly Readonly<{
    item: T;
    sourceIndex: number;
    outsideLoadedRange: boolean;
  }>[];
  shownCount: number;
  renderedCount: number;
  totalCount: number;
  nextLimit?: number;
}>;

/**
 * Bound ordered Canvas rendering while revealing a selected off-page object.
 * The input's existing Canvas order is preserved and is never re-sorted here.
 */
export function canvasOrderedWindow<T>(
  items: readonly T[],
  requestedLimit: number,
  selectedIndex = -1
): CanvasOrderedWindow<T> {
  const requested = Math.max(
    ORDERED_CANVAS_BATCH_SIZE,
    Math.ceil(requestedLimit / ORDERED_CANVAS_BATCH_SIZE) *
      ORDERED_CANVAS_BATCH_SIZE
  );
  const shownCount = Math.min(items.length, requested);
  const visible: Array<{
    item: T;
    sourceIndex: number;
    outsideLoadedRange: boolean;
  }> = items.slice(0, shownCount).map((item, sourceIndex) => ({
    item,
    sourceIndex,
    outsideLoadedRange: false
  }));
  if (selectedIndex >= shownCount && selectedIndex < items.length) {
    visible.push({
      item: items[selectedIndex]!,
      sourceIndex: selectedIndex,
      outsideLoadedRange: true
    });
  }
  return {
    items: visible,
    shownCount,
    renderedCount: visible.length,
    totalCount: items.length,
    ...(shownCount < items.length
      ? {
          nextLimit: Math.min(
            items.length,
            shownCount + ORDERED_CANVAS_BATCH_SIZE
          )
        }
      : {})
  };
}
