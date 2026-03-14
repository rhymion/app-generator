import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormUpsert from '@/components/booking/FormUpsert';
import { getResourceListPageData } from '@/lib/resource/getters';
import { getBookingNewPageAccessCheck } from '@/lib/booking/getters';

export default function AddBookingPage() {
  return (
    <Suspense fallback={<FormSkeleton />}>
      <BookingNewContent />
    </Suspense>
  );
}

async function BookingNewContent() {
  const [userPermissions, resourcesData] = await Promise.all([
    getBookingNewPageAccessCheck(),
    getResourceListPageData(false),
  ]);
  const src = {
    id: '',
    name: '',
    resource_id: '',
    start_time: null,
    end_time: null,
  };
  return <FormUpsert src={src} isEdit={false} permissions={userPermissions} allResources={resourcesData.resources} resourcePermissions={resourcesData.userPermissions} />;
}
