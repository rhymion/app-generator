import type { ModelPermissions } from '@/lib/authz';

import type { Organization } from '@/lib/organization/types';

export type Parent1 = {
  id: string;
  name: string;
  organization_id: string;
  description: string | null;
  price: number;
  due_date: Date;
  image_url: string | null;
  organization?: Organization | null;
};

export type OrganizationOption = {
  id: string;
  name: string;
};

export type Parent1Detail = Parent1 & {
  parent1_child1s: Parent1Child1[];
  parent1_child2s: Parent1Child2[];
  parent1_lists: Parent1List[];
};

export type Parent1Child1 = {
  id: string;
  order: number;
  name: string;
  type: string;
  parent1_id: string;
  max_length: number | null;
  max: number | null;
  regex: string | null;
  required: boolean;
  written_by: string;
};

export type Parent1Child2 = {
  id: string;
  name: string;
  required: boolean;
  start_date: Date | null;
  end_date: Date;
};

export type Parent1List = {
  id: string;
  name: string;
};
export type Parent1DetailPageProps = Readonly<{
  params: Promise<{
    id: string;
  }>
}>;

export type FormViewProps = Readonly<{
  src: {
    id: string;
    name: string;
    organization_id: string;
    description: string | null;
    price: number;
    due_date: Date;
    image_url: string | null;
    organization?: Organization | null;
    parent1_child1s: Parent1Child1[];
    parent1_child2s: Parent1Child2[];
    parent1_lists: Parent1List[];
    created_at?: string | Date;
    updated_at?: string | Date;
    creator?: { id: string; name: string } | null;
    updater?: { id: string; name: string } | null;
  };
  permissions?: ModelPermissions;
}>;

export type FormUpsertProps = Readonly<FormViewProps & {
  isEdit: boolean;
  allOrganizations?: Organization[];
  currentUserId?: string | null;

  organizationPermissions?: ModelPermissions;
}>;
