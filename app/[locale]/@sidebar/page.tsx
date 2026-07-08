"use client";
import { useTranslations } from "next-intl";
import { useSession, signOut } from "next-auth/react";
import { useLocale } from "next-intl";
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
  "/db_table": "dbTable",
  "/xxxxx_xxxxx": "xxxxxXxxxx",
  "/parent1": "parent1",
  "/parent_only": "parentOnly",
  "/procedure": "procedure",
  "/resource": "resource",
  "/booking": "booking",
  "/shift_template": "shiftTemplate",
  "/shift": "shift",
  "/product": "product",
  "/inventory": "inventory",
  "/purchase_order": "purchaseOrder",
  "/leave_request": "leaveRequest",
  "/supply_pool": "supplyPool",
  "/supply_request": "supplyRequest",
  "/room_type": "roomType",
  "/room": "room",
  "/room_reservation": "roomReservation",
  "/receiving_purchase_order": "receivingPurchaseOrder",
  "/receiving_asn": "receivingAsn",
  "/receiving_receipt": "receivingReceipt",
  "/inventory_transaction": "inventoryTransaction",
};

export default function Sidebar({ hiddenHrefs = [] }: { hiddenHrefs?: string[] }) {
  const t = useTranslations("Nav");
  const tHeader = useTranslations("Header");
  const { data: session } = useSession();
  const locale = useLocale();

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

