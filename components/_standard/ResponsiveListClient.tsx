'use client';

import useMediaQuery from '@mui/material/useMediaQuery';
import DataGridClient from './DataGridClient';
import CardListClient from './CardListClient';
import type { ModelPermissions } from '@/lib/authz';
import type { PageOpts, PageResult } from '@/lib/_pagination';

interface BaseEntity {
  id: string;
  name?: string;
  [key: string]: unknown;
}

interface DisplayFieldConfig<T> {
  field: keyof T;
  headerName: string;
  width?: number;
  format?: 'date-time' | 'date' | 'time';
  enumLabels?: Record<number, string>;
}

interface ResponsiveListClientProps<T extends BaseEntity> {
  /** Client-mode rows. Use either `src` or the server-mode `initialRows` set. */
  src?: T[];
  /** Server-mode initial page rows. */
  initialRows?: T[];
  initialRowCount?: number;
  initialPage?: number;
  initialPageSize?: number;
  fetchPage?: (opts: PageOpts) => Promise<PageResult<T>>;
  basePath: string;
  removeAction?: (ids: string[]) => Promise<void>;
  entityLabel?: string;
  displayFields?: DisplayFieldConfig<T>[];
  permissions?: ModelPermissions;
  /** Which field to display as the card title on mobile. Defaults to 'name'. */
  primaryField?: keyof T;
  /** Pixel width below which to switch to card layout. Defaults to 768. */
  mobileBreakpoint?: number;
  /** When true, edit links open in a new tab. Used in parent-embedded bridge grids. */
  openLinksInNewTab?: boolean;
}

export default function ResponsiveListClient<T extends BaseEntity>({
  src,
  initialRows,
  initialRowCount,
  initialPage,
  initialPageSize,
  fetchPage,
  basePath,
  removeAction,
  entityLabel = 'Item',
  displayFields,
  permissions,
  primaryField,
  mobileBreakpoint = 768,
  openLinksInNewTab,
}: ResponsiveListClientProps<T>) {
  const isMobile = useMediaQuery(`(max-width: ${mobileBreakpoint}px)`);

  if (isMobile) {
    return (
      <CardListClient
        src={src}
        initialRows={initialRows}
        initialRowCount={initialRowCount}
        initialPage={initialPage}
        initialPageSize={initialPageSize}
        fetchPage={fetchPage}
        basePath={basePath}
        removeAction={removeAction}
        entityLabel={entityLabel}
        displayFields={displayFields}
        permissions={permissions}
        primaryField={primaryField}
      />
    );
  }

  return (
    <DataGridClient
      src={src}
      initialRows={initialRows}
      initialRowCount={initialRowCount}
      initialPage={initialPage}
      initialPageSize={initialPageSize}
      fetchPage={fetchPage}
      basePath={basePath}
      removeAction={removeAction}
      entityLabel={entityLabel}
      displayFields={displayFields}
      permissions={permissions}
      primaryField={primaryField}
      openLinksInNewTab={openLinksInNewTab}
    />
  );
}
