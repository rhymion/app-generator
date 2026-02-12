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
    start_time: new Date(),
    end_time: new Date(),
  };
  return <FormUpsert src={src} isEdit={false} permissions={userPermissions} allResources={resourcesData.resources} resourcePermissions={resourcesData.userPermissions} />;
}
