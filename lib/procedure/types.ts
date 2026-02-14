import type { ModelPermissions } from '@/lib/authz';



export type Procedure = {
  id: string;
  name: string;
  description: string | null;
  parent_id: string | null;
  parent?: Procedure | null;
};

export type ProcedureDetail = Procedure & {
  children: Procedure[];
  preceded_by: Procedure[];
  followed_by: Procedure[];
};

export type ProcedureDetailPageProps = Readonly<{
  params: Promise<{
    id: string;
  }>
}>;

export type FormViewProps = Readonly<{
  src: {
    id: string;
    name: string;
    description: string | null;
    parent_id: string | null;
    parent?: Procedure | null;
    children: Procedure[];
    preceded_by: Procedure[];
    followed_by: Procedure[];
    created_at?: string | Date;
    updated_at?: string | Date;
    creator?: { id: string; name: string } | null;
    updater?: { id: string; name: string } | null;
  };
  permissions?: ModelPermissions;
}>;

export type FormUpsertProps = Readonly<FormViewProps & {
  isEdit: boolean;
  allProcedures?: Procedure[];

  procedurePermissions?: ModelPermissions;
}>;
