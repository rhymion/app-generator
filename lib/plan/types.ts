import type { ModelPermissions } from '@/lib/authz';

export type Plan = {
  id: string;
  tier: number;
  reaction_kinds_allowed: number;
  sub_account_limit: number;
  can_view_paid_posts: boolean;
  creator_id: string | null;
  creator?: { id: string; name: string } | null;
  updater?: { id: string; name: string } | null;
};

export type PlanDetail = Plan & {
  users: User[];
};

export type User = {
  id: string;
  name: string;
  image: string | null;
};

export type PlanDetailPageProps = Readonly<{
  params: Promise<{
    id: string;
  }>
}>;

export type FormViewProps = Readonly<{
  src: {
    id: string;
    tier: number | null;
    reaction_kinds_allowed: number | null;
    sub_account_limit: number | null;
    can_view_paid_posts: boolean;
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
