import FormView from '@/components/shift_template/FormView';
import { getShiftTemplateDetailPageData } from '@/lib/shift_template/getters';
import { ShiftTemplateDetailPageProps } from '@/lib/shift_template/types';
import { notFound } from 'next/navigation';

export default async function ViewShiftTemplatePage({ params }: ShiftTemplateDetailPageProps) {
  const { id } = await params;
  const { shiftTemplate, userPermissions } = await getShiftTemplateDetailPageData(id);
  if (!shiftTemplate) {
    notFound();
  }
  return <FormView src={shiftTemplate} permissions={userPermissions} />;
}
