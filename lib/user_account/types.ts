export type UserAccount = {
  id: string;
  name: string;
  email: string;
  password: string;
  api_key: string | null;
  avatar: string | null;
};

export type UserAccountDetail = UserAccount & {
  roles: Role[];
};

export type Role = {
  id: string;
  name: string;
  description: string | null;
};
export type UserAccountDetailPageProps = Readonly<{
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
    roles: Role[];
  };
}>;

export type FormUpsertProps = Readonly<FormViewProps & {
  isEdit: boolean;
  allRoles?: Role[];
}>;
