import { getShiftTemplateListPageData } from '@/lib/shift_template/getters';
import ResponsiveListClient from '@/components/ResponsiveListClient';
import { removeShiftTemplate } from '@/lib/shift_template/actions';
import CopyShiftsButton from '@/components/shift_template/CopyShiftsButton';

export default async function ShiftTemplatesPage() {
  const { shiftTemplates, userPermissions } = await getShiftTemplateListPageData();
  return (
    <>
      <CopyShiftsButton permissions={userPermissions} />
      <ResponsiveListClient src={shiftTemplates} basePath="/shift_template" removeAction={removeShiftTemplate} entityLabel="Shift Template" displayFields={[
        { field: 'user_account', headerName: 'User Account', width: 200 },
        { field: 'day_of_week', headerName: 'Day Of Week', width: 100 }
      ]}
        permissions={userPermissions} />
    </>
  );
}
