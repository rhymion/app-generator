import type { ModelPermissions } from '@/lib/authz';

export type Setting = {
  id: string;
  name: string;
  email: string;

};

export type SettingDetail = Setting;

export type SettingDetailPageProps = Readonly<{
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
