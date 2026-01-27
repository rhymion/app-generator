export type ParentOnly = {
  id: string;
  name: string;
  description: string | null;
  login_time: string | null;
  logout_time: string | null;
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
    login_time: string | null;
    logout_time: string | null;
  };
}>;

export type FormUpsertProps = Readonly<FormViewProps & {
  isEdit: boolean;
}>;
