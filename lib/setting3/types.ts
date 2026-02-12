import type { ModelPermissions } from '@/lib/authz';

export type Setting3 = {
  id: string;
  name: string;
  email: string;

};

export type Setting3Detail = Setting3;

export type Setting3DetailPageProps = Readonly<{
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
