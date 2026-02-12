import type { ModelPermissions } from '@/lib/authz';

export type Setting2 = {
  id: string;
  name: string;
  email: string;
  password: string;

};

export type Setting2Detail = Setting2;

export type Setting2DetailPageProps = Readonly<{
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
