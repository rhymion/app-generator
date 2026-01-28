import FormUpsert from '@/components/parent_only/FormUpsert';

export default function AddParentOnlyPage() {
  const src = {
    id: '',
    name: '',
    description: '',
    login_time: null,
    logout_time: null,
  };
  return <FormUpsert src={src} isEdit={false} />;
}
