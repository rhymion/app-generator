import FormUpsert from '@/components/parent_only/FormUpsert';

export default function AddParentOnlyPage() {
  const src = {
    id: '',
    name: '',
    description: '',
    login_time: '',
    logout_time: '',
  };
  return <FormUpsert src={src} isEdit={false} />;
}
