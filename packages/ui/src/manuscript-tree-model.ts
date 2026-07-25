import type { ProjectNavigator } from "@ghostwriter/core";

/** Minimal tree shape for filter / flatten (ManuscriptTree nodes satisfy this). */
export type ManuscriptTreeFilterNode = Readonly<{
  key: string;
  label: string;
  kindLabel: string;
  detail?: string;
  children: readonly ManuscriptTreeFilterNode[];
}>;

/**
 * Prune the tree to matching nodes and ancestors of matches.
 * Matching parents keep only matching descendant branches (not the full child list).
 */
export function filterManuscriptTreeNode<T extends ManuscriptTreeFilterNode>(
  node: T,
  query: string
): T | undefined {
  if (query.length === 0) return node;
  const children = node.children
    .map((child) => filterManuscriptTreeNode(child as T, query))
    .filter((child): child is T => child !== undefined);
  const matches =
    node.label.toLocaleLowerCase().includes(query) ||
    node.kindLabel.toLocaleLowerCase().includes(query) ||
    node.detail?.toLocaleLowerCase().includes(query) === true;
  if (!matches && children.length === 0) return undefined;
  return { ...node, children };
}

export function flattenManuscriptTreeNodes<T extends ManuscriptTreeFilterNode>(
  root: T,
  expandedKeys: ReadonlySet<string>,
  searchActive: boolean
): T[] {
  const nodes: T[] = [];
  function visit(node: T): void {
    nodes.push(node);
    if (
      node.children.length > 0 &&
      (searchActive || expandedKeys.has(node.key))
    ) {
      for (const child of node.children) visit(child as T);
    }
  }
  visit(root);
  return nodes;
}

/** Project + story folder only — books start collapsed for multi-book series. */
export function defaultManuscriptExpandedKeys(
  project: ProjectNavigator
): Set<string> {
  void project;
  return new Set(["project", "story-knowledge"]);
}

/** Indent steps closer to Mockups 2.0 (project → scene). */
export function manuscriptTreeIndentPx(level: number): number {
  if (level <= 1) return 0;
  return (level - 1) * 14;
}

/**
 * Compact kind marks for tests and non-React fallbacks. The manuscript tree UI
 * renders {@link ManuscriptKindIcon} (Phosphor thin icons) instead.
 */
export function manuscriptKindGlyph(kindLabel: string): string {
  switch (kindLabel) {
    case "Project":
      return "⌂";
    case "Book":
      return "▣";
    case "Part":
      return "▤";
    case "Chapter":
      return "▥";
    case "Scene":
      return "▢";
    case "Scene folder":
      return "▣";
    case "Project folder":
    case "Story knowledge":
      return "◈";
    default:
      return "•";
  }
}

export function isManuscriptBookKind(kindLabel: string): boolean {
  return kindLabel === "Book";
}
