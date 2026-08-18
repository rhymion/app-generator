import { describe, it, expect } from 'vitest';
import { buildRootTree, buildGroupChildren, subtreeContainsPath } from './nav-tree';
import type { NavLink, NavGroup } from './site-config';

describe('nav-tree', () => {
  describe('buildRootTree', () => {
    it('preserves the existing array order for flat (ungrouped) links', () => {
      const links: NavLink[] = [
        { label: 'Home', href: '/' },
        { label: 'Audit Log', href: '/audit_log' },
        { label: 'User', href: '/user' },
      ];
      const tree = buildRootTree(links, []);
      expect(tree.map((n) => (n.kind === 'link' ? n.link.href : n.group.slug))).toEqual([
        '/',
        '/audit_log',
        '/user',
      ]);
    });

    it('appends top-level groups after the flat links, sorted by order', () => {
      const links: NavLink[] = [
        { label: 'Home', href: '/' },
        { label: 'Inventory Reservation', href: '/inventory_reservation', group: 'inventory_group', order: 1 },
      ];
      const groups: NavGroup[] = [
        { slug: 'purchasing_group', labelKey: 'groups.purchasing_group', order: 2 },
        { slug: 'inventory_group', labelKey: 'groups.inventory_group', order: 1 },
      ];
      // give purchasing_group at least one child so it isn't suppressed as empty
      links.push({ label: 'PO', href: '/purchase_order', group: 'purchasing_group', order: 1 });

      const tree = buildRootTree(links, groups);
      expect(tree.map((n) => (n.kind === 'link' ? n.link.href : n.group.slug))).toEqual([
        '/',
        'inventory_group',
        'purchasing_group',
      ]);
    });

    it('omits a top-level group with no visible children (§7.2)', () => {
      const links: NavLink[] = [{ label: 'Home', href: '/' }];
      const groups: NavGroup[] = [{ slug: 'empty_group', labelKey: 'groups.empty_group', order: 1 }];
      const tree = buildRootTree(links, groups);
      expect(tree).toHaveLength(1);
      expect(tree[0].kind).toBe('link');
    });
  });

  describe('buildGroupChildren', () => {
    it('sorts entity children by order, ties broken by href', () => {
      const links: NavLink[] = [
        { label: 'Reservation', href: '/inventory_reservation', group: 'g', order: 2 },
        { label: 'Transaction', href: '/inventory_transaction', group: 'g', order: 1 },
      ];
      const children = buildGroupChildren('g', links, []);
      expect(children.map((n) => (n.kind === 'link' ? n.link.href : ''))).toEqual([
        '/inventory_transaction',
        '/inventory_reservation',
      ]);
    });

    it('entities without an explicit order sort last (default 999)', () => {
      const links: NavLink[] = [
        { label: 'B', href: '/b', group: 'g', order: 1 },
        { label: 'A', href: '/a', group: 'g' },
      ];
      const children = buildGroupChildren('g', links, []);
      expect(children.map((n) => (n.kind === 'link' ? n.link.href : ''))).toEqual(['/b', '/a']);
    });

    it('supports group-to-group nesting (multi-level)', () => {
      const links: NavLink[] = [
        { label: 'Reservation', href: '/inventory_reservation', group: 'inventory_group', order: 1 },
      ];
      const groups: NavGroup[] = [
        { slug: 'inventory_group', labelKey: 'groups.inventory_group', order: 1, parent: 'logistics_group' },
      ];
      const children = buildGroupChildren('logistics_group', links, groups);
      expect(children).toHaveLength(1);
      expect(children[0].kind).toBe('group');
      if (children[0].kind === 'group') {
        expect(children[0].group.slug).toBe('inventory_group');
        expect(children[0].children).toHaveLength(1);
      }
    });

    it('recursively omits a subgroup whose own descendants are all empty', () => {
      const links: NavLink[] = [];
      const groups: NavGroup[] = [
        { slug: 'inner_empty', labelKey: 'groups.inner_empty', order: 1, parent: 'outer' },
      ];
      const children = buildGroupChildren('outer', links, groups);
      expect(children).toHaveLength(0);
    });

    it('hidden links (already filtered out of visibleLinks) empty out their group', () => {
      // Simulates the caller having already applied hiddenHrefs filtering —
      // a group whose only child was filtered out has no visible children left.
      const links: NavLink[] = [];
      const groups: NavGroup[] = [{ slug: 'g', labelKey: 'groups.g', order: 1 }];
      const tree = buildRootTree(links, groups);
      expect(tree).toHaveLength(0);
    });
  });

  describe('subtreeContainsPath', () => {
    it('returns true when a direct leaf matches the pathname', () => {
      const tree = buildGroupChildren(
        'g',
        [{ label: 'X', href: '/x', group: 'g', order: 1 }],
        [],
      );
      expect(subtreeContainsPath(tree, '/x')).toBe(true);
      expect(subtreeContainsPath(tree, '/y')).toBe(false);
    });

    it('returns true when a descendant of a nested subgroup matches (multi-level, §7.4)', () => {
      const links: NavLink[] = [
        { label: 'Reservation', href: '/inventory_reservation', group: 'inventory_group', order: 1 },
      ];
      const groups: NavGroup[] = [
        { slug: 'inventory_group', labelKey: 'groups.inventory_group', order: 1, parent: 'logistics_group' },
      ];
      const tree = buildGroupChildren('logistics_group', links, groups);
      expect(subtreeContainsPath(tree, '/inventory_reservation')).toBe(true);
      expect(subtreeContainsPath(tree, '/other')).toBe(false);
    });
  });
});
