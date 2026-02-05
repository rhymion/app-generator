import type { ModelPermissions } from '@/lib/authz';

export type ParentOnly = {
  id: string;
  name: string;
  description: string | null;
  login_time: Date | null;
  logout_time: Date | null;

};

export type ParentOnlyDetail = ParentOnly;

export type ParentOnlyDetailPageProps = Readonly<{
  params: Promise<{
    id: string;
  }>
}>;

export type FormViewProps = Readonly<{
  src: {
    id: string;
    name: string;
    description: string | null;
    login_time: Date | null;
    logout_time: Date | null;
  };
  permissions?: ModelPermissions;
}>;

export type FormUpsertProps = Readonly<FormViewProps & {
  isEdit: boolean;

}>;
