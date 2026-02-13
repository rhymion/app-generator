import type { ModelPermissions } from '@/lib/authz';

import type { Organization } from '@/lib/organization/types';

export type Resource = {
  id: string;
  name: string;
  description: string | null;
  organization_id: string;
  organization?: Organization | null;
};

export type OrganizationOption = {
  id: string;
  name: string;
};

export type ResourceDetail = Resource & {
  resource_attachments: ResourceAttachment[];
  resource_images: ResourceImage[];
};

export type ResourceAttachment = {
  id: string;
  order: number;
  name: string;
  path: string;
};

export type ResourceImage = {
  id: string;
  name: string;
  path: string;
};
export type ResourceDetailPageProps = Readonly<{
  params: Promise<{
    id: string;
  }>
}>;

export type FormViewProps = Readonly<{
  src: {
    id: string;
    name: string;
    description: string | null;
    organization_id: string;
    organization?: Organization | null;
    resource_attachments: ResourceAttachment[];
    resource_images: ResourceImage[];
  };
  permissions?: ModelPermissions;
}>;

export type FormUpsertProps = Readonly<FormViewProps & {
  isEdit: boolean;
  allOrganizations?: Organization[];

  organizationPermissions?: ModelPermissions;
}>;
