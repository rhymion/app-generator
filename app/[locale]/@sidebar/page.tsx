"use client";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { siteConfig, themeConfig } from "@/lib/site-config";

// Maps nav link href to Nav translation key
const navTranslationKeys: Record<string, string> = {
  "/": "home",
  "/user": "user",
  "/role": "role",
  "/organization": "organization",
  "/permission": "permission",
  "/approval_flow": "approvalFlow",
  "/dashboard": "dashboard",
  "/plan": "plan",
  "/work": "work",
  "/character": "character",
  "/scene": "scene",
  "/music": "music",
  "/creator": "creator",
  "/channel": "channel",
  "/fc_link": "fcLink",
  "/tip_tx": "tipTx",
};

export default function Sidebar({ hiddenHrefs = [] }: { hiddenHrefs?: string[] }) {
  const t = useTranslations("Nav");

  return (
    <nav id="sidebar-nav" className={`w-48 h-full ${themeConfig.sidebar.panel}`}>
      <ul className="py-2">
        {siteConfig.navLinks
          .filter((link) => !hiddenHrefs.includes(link.href))
          .map((link) => {
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
        })}
      </ul>
    </nav>
  );
}
