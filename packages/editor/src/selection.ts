export function clampEditorSelection(
  selection: Readonly<{ from: number; to: number }>,
  maximumPosition: number,
): Readonly<{ from: number; to: number }> {
  const maximum = Math.max(1, Math.floor(maximumPosition));
  const from = Math.max(1, Math.min(maximum, Math.floor(selection.from)));
  const to = Math.max(from, Math.min(maximum, Math.floor(selection.to)));
  return { from, to };
}
