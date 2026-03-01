import { getShiftTemplateListPageData } from '@/lib/shift_template/getters';
import ResponsiveListClient from '@/components/ResponsiveListClient';
import { removeShiftTemplate } from '@/lib/shift_template/actions';
import CopyShiftsButton from '@/components/shift_template/CopyShiftsButton';

export default async function ShiftTemplatesPage() {
  const { shiftTemplates, userPermissions } = await getShiftTemplateListPageData();
  const formattedShiftTemplates = shiftTemplates.map(template => ({
    ...template,
    day_of_week: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][template.day_of_week] || ''
  }));
  return (
    <>
      <CopyShiftsButton permissions={userPermissions} />
      <ResponsiveListClient src={formattedShiftTemplates} basePath="/shift_template" removeAction={removeShiftTemplate} entityLabel="Shift Template"
       primaryField="user_account" displayFields={[
        { field: 'user_account', headerName: 'User Account', width: 200 },
        { field: 'day_of_week', headerName: 'Day Of Week', width: 100 }
      ]}
        permissions={userPermissions} />
    </>
  );
}
