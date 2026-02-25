'use client';

import useMediaQuery from '@mui/material/useMediaQuery';
import DataGridClient from './DataGridClient';
import CardListClient from './CardListClient';
import type { ModelPermissions } from '@/lib/authz';

interface BaseEntity {
  id: string;
  name?: string;
  [key: string]: unknown;
}

interface DisplayFieldConfig<T> {
  field: keyof T;
  headerName: string;
  width?: number;
}

interface ResponsiveListClientProps<T extends BaseEntity> {
  src: T[];
  basePath: string;
  removeAction?: (formDataOrIds: FormData | string[]) => Promise<void>;
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
      basePath={basePath}
      removeAction={removeAction}
      entityLabel={entityLabel}
      displayFields={displayFields}
      permissions={permissions}
    />
  );
}
