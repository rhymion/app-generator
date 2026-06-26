import type { ModelPermissions } from '@/lib/authz';

export type AuditLog = {
  id: string;
  target_table: string | null;
  target_id: string | null;
  action: string;
  actor_user_id: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: Date | string;
};

export type UserOption = {
  id: string;
  label: string;
};

export type AuditLogDetail = AuditLog;

export type AuditLogDetailPageProps = Readonly<{
  params: Promise<{
    id: string;
  }>
}>;

export type FormViewProps = Readonly<{
  src: {
    id: string;
    target_table: string | null;
    target_id: string | null;
    action: string;
    actor_user_id: string | null;
    created_at: Date | string;
    metadata?: Record<string, unknown> | null;
  };
  permissions?: ModelPermissions;
}>;

export type FormUpsertProps = Readonly<FormViewProps & {
  isEdit: boolean;
  currentUserId?: string | null;
}>;
