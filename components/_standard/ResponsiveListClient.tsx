'use client';

import useMediaQuery from '@mui/material/useMediaQuery';
import dynamic from 'next/dynamic';
import type DataGridClientStatic from './DataGridClient';
import type CardListClientStatic from './CardListClient';
import type { ModelPermissions } from '@/lib/authz';
import type { PageOpts, PageResult } from '@/lib/_pagination';

// Lazy-load both variants so each route only ships the JS for the breakpoint
// it actually renders (Phase 4 #7 from performance-plan-session.md).
//   - DataGridClient keeps SSR — most users are desktop, so the HTML is on
//     first paint and the @mui/x-data-grid bundle hydrates after.
//   - CardListClient is client-only because the mobile branch is gated on
//     useMediaQuery, which resolves to false at SSR. Skipping SSR here means
//     desktop users never download CardListClient or its MUI deps.
// `next/dynamic` erases the component's generic, so we cast back to the
// static type to keep `DisplayFieldConfig<T>` flowing through correctly.
const DataGridClient = dynamic(() => import('./DataGridClient')) as typeof DataGridClientStatic;
const CardListClient = dynamic(() => import('./CardListClient'), { ssr: false }) as typeof CardListClientStatic;

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
    />
  );
}
