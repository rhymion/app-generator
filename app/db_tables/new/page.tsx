import FormUpsert from '@/components/db_tables/FormUpsert';

export default function AddDbTablePage() {
  const src = {
    id: '',
    name: '',
    description: null,
    fields: [],
  };
  return <FormUpsert src={src} isEdit={false} />;
}