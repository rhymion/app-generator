import type { ModelPermissions } from '@/lib/authz';

export type Setting6 = {
  id: string;
  name: string;
  email: string;
  password: string;
  api_key: string | null;
  avatar: string | null;

};

export type Setting6Detail = Setting6;

export type Setting6DetailPageProps = Readonly<{
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
    created_at?: string | Date;
    updated_at?: string | Date;
    creator?: { id: string; name: string } | null;
    updater?: { id: string; name: string } | null;
  };
  permissions?: ModelPermissions;
}>;

export type FormUpsertProps = Readonly<FormViewProps & {
  isEdit: boolean;

}>;
