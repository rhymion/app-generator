import FormUpsert from '@/components/booking/FormUpsert';
import { getResourceListPageData } from '@/lib/resource/getters';
import { getBookingNewPageAccessCheck } from '@/lib/booking/getters';

export default async function AddBookingPage() {
  const resourcesData = await getResourceListPageData(false);
  const userPermissions =await getBookingNewPageAccessCheck();
  const src = {
    id: '',
    name: '',
    resource_id: '',
    start_time: null,
    end_time: null,
  };
  return <FormUpsert src={src} isEdit={false} permissions={userPermissions} allResources={resourcesData.resources} resourcePermissions={resourcesData.userPermissions} />;
}
