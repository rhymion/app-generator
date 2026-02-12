import type { ModelPermissions } from '@/lib/authz';

export type Setting5 = {
  id: string;
  name: string;
  email: string;

};

export type Setting5Detail = Setting5;

export type Setting5DetailPageProps = Readonly<{
  params: Promise<{
    id: string;
  }>
}>;

export type FormViewProps = Readonly<{
  src: {
    id: string;
    name: string;
    email: string;
  };
  permissions?: ModelPermissions;
}>;

export type FormUpsertProps = Readonly<FormViewProps & {
  isEdit: boolean;

}>;
