import FormUpsert from '@/components/role/FormUpsert';

export default function AddRolePage() {
  const src = {
    id: '',
    name: '',
    description: '',
    user_accounts: [],
  };
  return <FormUpsert src={src} isEdit={false} />;
}
