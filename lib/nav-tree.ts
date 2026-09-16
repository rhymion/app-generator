/**
 * Pure tree-building logic for the nested sidebar nav — kept separate from
 * app/[locale]/@sidebar/page.tsx so it is unit-testable without mocking
 * next-intl/next-auth. See docs/knowledge/nested-nav-menu-design.md.
 */
import type { NavLink, NavGroup } from '@/lib/site-config';

export type TreeNode =
  | { kind: 'link'; link: NavLink }
  | { kind: 'group'; group: NavGroup; children: TreeNode[] };

function sortSiblings(nodes: TreeNode[]): TreeNode[] {
  return [...nodes].sort((a, b) => {
    const orderA = a.kind === 'link' ? (a.link.order ?? 999) : a.group.order;
    const orderB = b.kind === 'link' ? (b.link.order ?? 999) : b.group.order;
    if (orderA !== orderB) return orderA - orderB;
    const keyA = a.kind === 'link' ? a.link.href : a.group.slug;
    const keyB = b.kind === 'link' ? b.link.href : b.group.slug;
    return keyA.localeCompare(keyB);
  });
}

/**
 * Children of a specific group, sorted by `order` (§3). A subgroup with no
 * visible descendants (recursively) is omitted (§7.2 empty-group suppression).
 */
export function buildGroupChildren(
  parentSlug: string,
  visibleLinks: NavLink[],
  groups: NavGroup[],
): TreeNode[] {
  const leafNodes: TreeNode[] = visibleLinks
    .filter((link) => link.group === parentSlug)
    .map((link) => ({ kind: 'link', link }));

  const groupNodes: TreeNode[] = groups
    .filter((group) => group.parent === parentSlug)
    .map((group) => ({
      kind: 'group' as const,
      group,
      children: buildGroupChildren(group.slug, visibleLinks, groups),
    }))
    .filter((node) => node.children.length > 0);

  return sortSiblings([...leafNodes, ...groupNodes]);
}

/**
 * Root level keeps flat (ungrouped) links in their existing array order —
 * unchanged from the pre-nesting behavior (golden-diff-zero for a schema
 * with no `x-nav` at all) — and appends top-level groups after them, sorted
 * by their computed order.
 */
export function buildRootTree(visibleLinks: NavLink[], groups: NavGroup[]): TreeNode[] {
  const flatLinks: TreeNode[] = visibleLinks
    .filter((link) => link.group === undefined)
    .map((link) => ({ kind: 'link', link }));

  const topGroups: TreeNode[] = groups
    .filter((group) => group.parent === undefined)
    .map((group) => ({
      kind: 'group' as const,
      group,
      children: buildGroupChildren(group.slug, visibleLinks, groups),
    }))
    .filter((node) => node.children.length > 0)
    .sort((a, b) => a.group.order - b.group.order || a.group.slug.localeCompare(b.group.slug));

  return [...flatLinks, ...topGroups];
}

/** §7.4: whether any leaf link in this subtree matches the current pathname. */
export function subtreeContainsPath(nodes: TreeNode[], pathname: string): boolean {
  return nodes.some((node) =>
    node.kind === 'link' ? node.link.href === pathname : subtreeContainsPath(node.children, pathname),
  );
}
