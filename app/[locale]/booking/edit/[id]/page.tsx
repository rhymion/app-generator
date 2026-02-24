import FormUpsert from '@/components/booking/FormUpsert';
import { getBookingDetailPageData } from '@/lib/booking/getters';
import { getResourceListPageData } from '@/lib/resource/getters';
import { BookingDetailPageProps } from '@/lib/booking/types';
import { notFound } from 'next/navigation';

export default async function EditBookingPage({ params }: BookingDetailPageProps) {
  const { id } = await params;
  const [detail, resourcesData] = await Promise.all([
    getBookingDetailPageData(id, 'update'),
    getResourceListPageData(false),
  ]);
  if (!detail.booking) {
    notFound();
  }
  return <FormUpsert src={detail.booking} isEdit={true} permissions={detail.userPermissions} allResources={resourcesData.resources} resourcePermissions={resourcesData.userPermissions} />;
}
