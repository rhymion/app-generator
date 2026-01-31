import FormUpsert from '@/components/user_account/FormUpsert';

export default function AddUserAccountPage() {
  const src = {
    id: '',
    name: '',
    email: '',
    password: '',
    api_key: '',
    avatar: '',
    roles: [],
  };
  return <FormUpsert src={src} isEdit={false} />;
}
