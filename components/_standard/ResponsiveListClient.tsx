'use client';

import useMediaQuery from '@mui/material/useMediaQuery';
import DataGridClient from './DataGridClient';
import CardListClient from './CardListClient';
import type { ModelPermissions } from '@/lib/authz';
import type { PageOpts, PageResult } from '@/lib/_pagination';
import type { ActionFailure } from '@/lib/_errors';
import type { ListQuerySpec } from '@/lib/_list_query';

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
  showSeconds?: boolean;
  enumLabels?: Record<number, string>;
  uriKind?: 'image' | 'link';
  /** MUI GridColDef.type -- forwarded to DataGridClient (the real filter
   * control per column type, app-generator#756). Ignored by CardListClient
   * (no filter panel there), declared here only so this pass-through prop's
   * object literal type-checks regardless of which child renders it. */
  type?: 'singleSelect' | 'boolean' | 'date' | 'dateTime' | 'number';
  valueOptions?: { value: string | number; label: string }[];
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
  removeAction?: (ids: string[]) => Promise<ActionFailure | void>;
  invalidateAction?: (id: string) => Promise<void>;
  entityLabel?: string;
  displayFields?: DisplayFieldConfig<T>[];
  permissions?: ModelPermissions;
  /** Which field to display as the card title on mobile. Defaults to 'name'. */
  primaryField?: keyof T;
  /** Pixel width below which to switch to card layout. Defaults to 768. */
  mobileBreakpoint?: number;
  /** When true, edit links open in a new tab. Used in parent-embedded bridge grids. */
  openLinksInNewTab?: boolean;
  /** When false, the "+" create button is hidden even if the user has create permission.
   * Used for bridge-child entities, which cannot be created standalone (only via a parent),
   * and for entities whose x-generate.new is false (no /new page exists to link to). */
  allowCreate?: boolean;
  /** When false, the edit icon is hidden even if the user has update permission.
   * Used for entities whose x-generate.edit is false (no /edit page exists to link to). */
  allowEdit?: boolean;
  /** What the multi-column sort / multi-field filter / search panel offers; shown above the grid or the cards. */
  listQuery?: ListQuerySpec;
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
  invalidateAction,
  entityLabel = 'Item',
  displayFields,
  permissions,
  primaryField,
  mobileBreakpoint = 768,
  openLinksInNewTab,
  allowCreate,
  allowEdit,
  listQuery,
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
        allowCreate={allowCreate}
        allowEdit={allowEdit}
        listQuery={listQuery}
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
      invalidateAction={invalidateAction}
      entityLabel={entityLabel}
      displayFields={displayFields}
      permissions={permissions}
      primaryField={primaryField}
      openLinksInNewTab={openLinksInNewTab}
      allowCreate={allowCreate}
      allowEdit={allowEdit}
      listQuery={listQuery}
    />
  );
}
