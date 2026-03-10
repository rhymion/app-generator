import type { ModelPermissions } from '@/lib/authz';

export type DbTable = {
  id: string;
  name: string;
  description: string | null;
};

export type DbTableDetail = DbTable & {
  fields: Field[];
  db_table_comments: DbTableComment[];
};

export type Field = {
  id: string;
  name: string;
  type: string;
  db_table_id: string;
  reference_id: string | null;
  max_length: number | null;
  max: number | null;
  regex: string | null;
  required: boolean;
  reference?: DbTable | null;
};

export type DbTableComment = {
  id: string;
  message: string;
  db_table_id: string;
  created_at?: string | Date | null;
  updated_at?: string | Date | null;
  creator?: { id: string; name: string; avatar?: string | null } | null;
};

export type DbTableDetailPageProps = Readonly<{
  params: Promise<{
    id: string;
  }>
}>;

export type FormViewProps = Readonly<{
  src: {
    id: string;
    name: string;
    description: string | null;
    fields: Field[];
    db_table_comments: DbTableComment[];
    created_at?: string | Date;
    updated_at?: string | Date;
    creator?: { id: string; name: string } | null;
    updater?: { id: string; name: string } | null;
  };
  permissions?: ModelPermissions;
}>;

export type FormUpsertProps = Readonly<FormViewProps & {
  isEdit: boolean;
  allDbTables?: DbTable[];
  currentUserId?: string | null;
  dbTablePermissions?: ModelPermissions;
}>;
