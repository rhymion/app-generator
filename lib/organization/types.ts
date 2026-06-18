import type { ModelPermissions } from '@/lib/authz';

export type Organization = {
  id: string;
  name: string;
  description: string | null;
  creator_id: string | null;
  creator?: { id: string; name: string } | null;
  updater?: { id: string; name: string } | null;
};

export type OrganizationDetail = Organization & {
  users: User[];
};

export type User = {
  id: string;
  name: string;
  image: string | null;
};

export type OrganizationDetailPageProps = Readonly<{
  params: Promise<{
    id: string;
  }>
}>;

export type FormViewProps = Readonly<{
  src: {
    id: string;
    name: string;
    description: string | null;
    users: User[];
    created_at?: string | Date;
    updated_at?: string | Date;
    creator?: { id: string; name: string } | null;
    updater?: { id: string; name: string } | null;
  };
  permissions?: ModelPermissions;
}>;

export type FormUpsertProps = Readonly<FormViewProps & {
  isEdit: boolean;
  initialUsers?: User[];
  searchUserOptions?: (query: string, includeIds: string[]) => Promise<User[]>;
  currentUserId?: string | null;
}>;
