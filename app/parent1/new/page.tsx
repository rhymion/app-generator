import FormUpsert from '@/components/parent1/FormUpsert';

export default function AddParent1Page() {
  const src = {
    id: '',
    name: '',
    description: '',
    price: null,
    due_date: '',
    image_url: '',
    parent1_child1s: [],
    parent1_child2s: [],
  };
  return <FormUpsert src={src} isEdit={false} />;
}
