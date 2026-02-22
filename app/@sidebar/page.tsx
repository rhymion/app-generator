import Link from "next/link";
import { siteConfig, themeConfig } from "@/lib/site-config";

export default function Sidebar() {
  return (
    <nav id="sidebar-nav" className={`w-48 h-full ${themeConfig.sidebar.panel}`}>
      <ul className="py-2">
        {siteConfig.navLinks.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              className={themeConfig.sidebar.link}
              {...(link.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
