import type { ModelPermissions } from '@/lib/authz';

export type Procedure = {
  id: string;
  name: string;
  description: string | null;

};

export type ProcedureDetail = Procedure & {
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
    preceded_by: Procedure[];
    followed_by: Procedure[];
  };
  permissions?: ModelPermissions;
}>;

export type FormUpsertProps = Readonly<FormViewProps & {
  isEdit: boolean;
  allProcedures?: Procedure[];


  procedurePermissions?: ModelPermissions;
}>;
