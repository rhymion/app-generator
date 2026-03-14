import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormView from '@/components/shift_template/FormView';
import { getShiftTemplateDetailPageData } from '@/lib/shift_template/getters';
import { ShiftTemplateDetailPageProps } from '@/lib/shift_template/types';
import { notFound } from 'next/navigation';

export default async function ViewShiftTemplatePage({ params }: ShiftTemplateDetailPageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<FormSkeleton />}>
      <ShiftTemplateViewContent id={id} />
    </Suspense>
  );
}

async function ShiftTemplateViewContent({ id }: { id: string }) {
  const { shiftTemplate, userPermissions } = await getShiftTemplateDetailPageData(id);
  if (!shiftTemplate) {
    notFound();
  }
  return <FormView src={shiftTemplate} permissions={userPermissions} />;
}
