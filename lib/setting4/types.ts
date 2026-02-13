import type { ModelPermissions } from '@/lib/authz';

export type Setting4 = {
  id: string;
  name: string;
  email: string;
  password: string;
  api_key: string | null;
  avatar: string | null;

};

export type Setting4Detail = Setting4;

export type Setting4DetailPageProps = Readonly<{
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
    api_key: string | null;
    avatar: string | null;
  };
  permissions?: ModelPermissions;
}>;

export type FormUpsertProps = Readonly<FormViewProps & {
  isEdit: boolean;

}>;
