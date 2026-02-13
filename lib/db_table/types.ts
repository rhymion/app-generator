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
  max_length: number | null;
  max: number | null;
  regex: string | null;
  required: boolean;
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
  };
  permissions?: ModelPermissions;
}>;

export type FormUpsertProps = Readonly<FormViewProps & {
  isEdit: boolean;

}>;
