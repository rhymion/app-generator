'use client';

import { useId, useState } from 'react';
import type { SvgIconProps } from '@mui/material/SvgIcon';
import Folder from '@mui/icons-material/Folder';
import FolderOpen from '@mui/icons-material/FolderOpen';
import Work from '@mui/icons-material/Work';
import WorkOutlined from '@mui/icons-material/WorkOutlined';
import People from '@mui/icons-material/People';
import PeopleOutlined from '@mui/icons-material/PeopleOutlined';
import Settings from '@mui/icons-material/Settings';
import SettingsOutlined from '@mui/icons-material/SettingsOutlined';
import Inventory from '@mui/icons-material/Inventory';
import Inventory2 from '@mui/icons-material/Inventory2';
import ShoppingCart from '@mui/icons-material/ShoppingCart';
import LocalShipping from '@mui/icons-material/LocalShipping';
import Assignment from '@mui/icons-material/Assignment';
import Description from '@mui/icons-material/Description';
import Build from '@mui/icons-material/Build';
import Widgets from '@mui/icons-material/Widgets';
import Dashboard from '@mui/icons-material/Dashboard';
import AccountTree from '@mui/icons-material/AccountTree';
import Category from '@mui/icons-material/Category';
import AttachMoney from '@mui/icons-material/AttachMoney';

// Allowlist of icon names generated schema (`x-nav-groups.<slug>.icon`) may
// reference. Generated code never imports from `@mui/icons-material`
// directly (CLAUDE.md wrapper-boundary rule) — it passes the string name as
// a prop and this map resolves it. Keep in sync with
// code_generator/nav_config.py's NAV_ICON_ALLOWLIST (that module is the
// generation-time fail-closed validator; this map is the runtime resolver).
const ICON_MAP: Record<string, React.ComponentType<SvgIconProps>> = {
  Folder,
  FolderOpen,
  Work,
  WorkOutlined,
  People,
  PeopleOutlined,
  Settings,
  SettingsOutlined,
  Inventory,
  Inventory2,
  ShoppingCart,
  LocalShipping,
  Assignment,
  Description,
  Build,
  Widgets,
  Dashboard,
  AccountTree,
  Category,
  AttachMoney,
};

export interface NavGroupWrapperProps {
  /** i18n-resolved group label. */
  label: string;
  /** Nav links / nested NavGroupWrapper elements for this group. */
  children: React.ReactNode;
  /** Whether the group starts expanded (the active pathname is a descendant). */
  defaultOpen?: boolean;
  /** Icon allowlist name (see ICON_MAP above), or undefined for no icon. */
  icon?: string;
  /** themeConfig.sidebar tokens — no hardcoded MUI palette values here. */
  sidebarTheme: { panel: string; link: string; backdrop: string };
}

export default function NavGroupWrapper({
  label,
  children,
  defaultOpen = false,
  icon,
  sidebarTheme,
}: NavGroupWrapperProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const contentId = useId();
  const IconComponent = icon ? ICON_MAP[icon] : undefined;

  return (
    <li>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-controls={contentId}
        className={`${sidebarTheme.link} w-full flex items-center justify-between gap-2 text-left`}
      >
        <span className="flex items-center gap-2">
          {IconComponent && <IconComponent className="w-5 h-5" aria-hidden="true" />}
          {label}
        </span>
        <span aria-hidden="true" className="text-xs">
          {isOpen ? '▾' : '▸'}
        </span>
      </button>
      <ul
        id={contentId}
        className={`overflow-hidden transition-[max-height] duration-200 ease-in-out pl-3 ${
          isOpen ? 'max-h-screen' : 'max-h-0'
        }`}
      >
        {children}
      </ul>
    </li>
  );
}
