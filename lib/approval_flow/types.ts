import type { ModelPermissions } from '@/lib/authz';
import type { Role } from '@/lib/role/types';

export type ApprovalFlow = {
  id: string;
  entity_name: string;
  requestor_role_id: string | null;
  approver_role_id: string;
  creator_id: string | null;
  requestor_role?: Role | null;
  approver_role?: Role | null;
  creator?: { id: string; name: string } | null;
  updater?: { id: string; name: string } | null;
};

export type RoleOption = {
  id: string;
  label: string;
};

export type ApprovalFlowDetail = ApprovalFlow & {
  preceded_by: ApprovalFlow[];
  followed_by: ApprovalFlow[];
};

export type ApprovalFlowDetailPageProps = Readonly<{
  params: Promise<{
    id: string;
  }>
}>;

export type FormViewProps = Readonly<{
  src: {
    id: string;
    entity_name: string;
    requestor_role_id: string | null;
    approver_role_id: string;
    requestor_role?: Role | null;
    approver_role?: Role | null;
    preceded_by: ApprovalFlow[];
    followed_by: ApprovalFlow[];
    created_at?: string | Date;
    updated_at?: string | Date;
    creator?: { id: string; name: string } | null;
    updater?: { id: string; name: string } | null;
  };
  permissions?: ModelPermissions;
}>;

export type FormUpsertProps = Readonly<FormViewProps & {
  isEdit: boolean;
  initialApprovalFlows?: ApprovalFlow[];
  searchApprovalFlowOptions?: (query: string, includeIds: string[]) => Promise<ApprovalFlow[]>;
  initialRoles?: Role[];
  searchRoleOptions?: (query: string, includeIds: string[]) => Promise<Role[]>;
  currentUserId?: string | null;
}>;
