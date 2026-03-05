import type { ModelPermissions } from '@/lib/authz';

export type Setting5 = {
  id: string;
  name: string;

};

export type Setting5Detail = Setting5 & {
  yyyyy_yyyyys: YyyyyYyyyy[];
};

export type YyyyyYyyyy = {
  id: string;
  name: string;
  type: string;
  xxxxx_xxxxx_id: string;
  max_length: number | null;
  max: number | null;
  regex: string | null;
  required: boolean;
  written_by: string;
};
export type Setting5DetailPageProps = Readonly<{
  params: Promise<{
    id: string;
  }>
}>;

export type FormViewProps = Readonly<{
  src: {
    id: string;
    name: string;
    yyyyy_yyyyys: YyyyyYyyyy[];
    created_at?: string | Date;
    updated_at?: string | Date;
    creator?: { id: string; name: string } | null;
    updater?: { id: string; name: string } | null;
  };
  permissions?: ModelPermissions;
}>;

export type FormUpsertProps = Readonly<FormViewProps & {
  isEdit: boolean;
  currentUserId?: string | null;

}>;
