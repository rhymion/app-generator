import FormUpsert from '@/components/product/FormUpsert';
import { getProductNewPageAccessCheck } from '@/lib/product/getters';

export default async function AddProductPage() {
  const userPermissions = await getProductNewPageAccessCheck();
  const src = {
    id: '',
    code: '',
    name: '',
    price: 0,
    images: [],
  };
  return <FormUpsert src={src} isEdit={false} permissions={userPermissions} />;
}
