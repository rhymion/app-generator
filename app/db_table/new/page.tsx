import FormUpsert from '@/components/db_table/FormUpsert';
import { getDbTableNewPageAccessCheck } from '@/lib/db_table/getters';

export default async function AddDbTablePage() {
  const userPermissions =await getDbTableNewPageAccessCheck();
  const src = {
    id: '',
    name: '',
    description: '',
    fields: [],
  };
  return <FormUpsert src={src} isEdit={false} permissions={userPermissions} />;
}
