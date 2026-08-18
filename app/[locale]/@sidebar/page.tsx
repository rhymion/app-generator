"use client";
import { useTranslations } from "next-intl";
import { useSession, signOut } from "next-auth/react";
import { useLocale } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { siteConfig, themeConfig, type NavLink } from "@/lib/site-config";
import { buildRootTree, subtreeContainsPath, type TreeNode } from "@/lib/nav-tree";
import NavGroupWrapper from "@/components/_standard/NavGroupWrapper";

// Maps nav link href to Nav translation key
const navTranslationKeys: Record<string, string> = {
  "/": "home",
  "/audit_log": "auditLog",
  "/user": "user",
  "/role": "role",
  "/organization": "organization",
  "/permission": "permission",
  "/approval_flow": "approvalFlow",
  "/dashboard": "dashboard",
};

export default function Sidebar({ hiddenHrefs = [] }: { hiddenHrefs?: string[] }) {
  const t = useTranslations("Nav");
  const tHeader = useTranslations("Header");
  const { data: session } = useSession();
  const locale = useLocale();
  const pathname = usePathname();

  const visibleLinks = siteConfig.navLinks.filter((link) => !hiddenHrefs.includes(link.href));
  const tree = buildRootTree(visibleLinks, siteConfig.navGroups);

  return (
    <nav id="sidebar-nav" className={`w-48 h-full ${themeConfig.sidebar.panel}`}>
      <ul className="py-2">
        {tree.map((node) => (
          <NavTreeNode
            key={node.kind === "link" ? node.link.href : node.group.slug}
            node={node}
            t={t}
            pathname={pathname}
          />
        ))}
      </ul>
      {/* Mobile-only account section — hidden on md+ where header handles it */}
      {session?.user && (
        <div className="md:hidden">
          <hr className="my-1 border-gray-300" aria-hidden="true" />
          <ul className="py-1">
            <li>
              <Link
                href={`/setting/view/${session.user.id}`}
                className={themeConfig.sidebar.link}
              >
                {tHeader("setting")}
              </Link>
            </li>
            <li>
              <button
                onClick={() => signOut({ callbackUrl: `/${locale}/login` })}
                className={`${themeConfig.sidebar.link} w-full text-left`}
              >
                {tHeader("signOut")}
              </button>
            </li>
          </ul>
        </div>
      )}
    </nav>
  );
}

function NavLinkItem({ link, t }: { link: NavLink; t: ReturnType<typeof useTranslations> }) {
  const labelKey = navTranslationKeys[link.href];
  const label = labelKey ? t(labelKey as Parameters<typeof t>[0]) : link.label;
  return (
    <li key={link.href}>
      <Link
        href={link.href}
        className={themeConfig.sidebar.link}
        {...(link.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      >
        {label}
      </Link>
    </li>
  );
}

function NavTreeNode({
  node,
  t,
  pathname,
}: {
  node: TreeNode;
  t: ReturnType<typeof useTranslations>;
  pathname: string;
}) {
  if (node.kind === "link") {
    return <NavLinkItem link={node.link} t={t} />;
  }
  const label = t(node.group.labelKey as Parameters<typeof t>[0]);
  return (
    <NavGroupWrapper
      key={node.group.slug}
      label={label}
      icon={node.group.icon}
      defaultOpen={subtreeContainsPath(node.children, pathname)}
      sidebarTheme={themeConfig.sidebar}
    >
      {node.children.map((child) => (
        <NavTreeNode
          key={child.kind === "link" ? child.link.href : child.group.slug}
          node={child}
          t={t}
          pathname={pathname}
        />
      ))}
    </NavGroupWrapper>
  );
}
