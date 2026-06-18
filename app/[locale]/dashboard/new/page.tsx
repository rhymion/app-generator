import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormUpsert from '@/components/dashboard/FormUpsert';
import { getDashboardNewPageAccessCheck } from '@/lib/dashboard/getters';

export default function AddDashboardPage() {
  return (
    <Suspense fallback={<FormSkeleton />}>
      <DashboardNewContent />
    </Suspense>
  );
}

async function DashboardNewContent() {
  const userPermissions = await getDashboardNewPageAccessCheck();
  const src = {
    id: '',
    name: '',
    widgets: [],
  };
  return <FormUpsert src={src} isEdit={false} permissions={userPermissions} />;
}
