import FormUpsert from '@/components/xxxxx_xxxxx/FormUpsert';
import { getXxxxxXxxxxNewPageAccessCheck } from '@/lib/xxxxx_xxxxx/getters';

export default async function AddXxxxxXxxxxPage() {
  await getXxxxxXxxxxNewPageAccessCheck();
  const src = {
    id: '',
    name: '',
    description: '',
    team: '',
    yyyyy_yyyyys: [],
  };
  return <FormUpsert src={src} isEdit={false} />;
}
