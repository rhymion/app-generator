import FormUpsert from '@/components/parent1/FormUpsert';

export default function AddParent1Page() {
  const src = {
    id: '',
    name: '',
    description: '',
    price: 0,
    due_date: new Date(),
    image_url: '',
    parent1_child1s: [],
    parent1_child2s: [],
    parent1_list: [],
  };
  return <FormUpsert src={src} isEdit={false} />;
}
