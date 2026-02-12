import type { ModelPermissions } from '@/lib/authz';

export type Setting8 = {
  id: string;
  name: string;
  email: string;
  password: string;

};

export type Setting8Detail = Setting8;

export type Setting8DetailPageProps = Readonly<{
  params: Promise<{
    id: string;
  }>
}>;

export type FormViewProps = Readonly<{
  src: {
    id: string;
    name: string;
    email: string;
    password: string;
  };
  permissions?: ModelPermissions;
}>;

export type FormUpsertProps = Readonly<FormViewProps & {
  isEdit: boolean;

}>;
