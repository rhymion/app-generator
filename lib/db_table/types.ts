import type { ModelPermissions } from '@/lib/authz';

export type DbTable = {
  id: string;
  name: string;
  description: string | null;

};

export type DbTableDetail = DbTable & {
  fields: Field[];
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

  dbTablePermissions?: ModelPermissions;
}>;
