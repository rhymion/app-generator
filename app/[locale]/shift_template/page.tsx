import { getTranslations } from 'next-intl/server';
import ResponsiveListClient from '@/components/_standard/ResponsiveListClient';
import { getShiftTemplateListPageData } from '@/lib/shift_template/getters';
import { removeShiftTemplate } from '@/lib/shift_template/actions';
import Box from '@mui/material/Box';
import CopyShiftsButton from '@/components/shift_template/CopyShiftsButton';

export default async function ShiftTemplateListPage() {
  const [t, tf] = await Promise.all([
    getTranslations('EntityLabel'),
    getTranslations('Fields'),
  ]);
  const { shiftTemplates, userPermissions } = await getShiftTemplateListPageData();
  const formattedShiftTemplates = shiftTemplates.map(item => ({
    ...item,
    day_of_week: (['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const)[item.day_of_week as number] ?? '',
  }));
  return (
    <>
      <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
        <CopyShiftsButton permissions={userPermissions} />
      </Box>
      <ResponsiveListClient
        entityLabel={t('shiftTemplate')}
        src={formattedShiftTemplates}
        permissions={userPermissions}
        basePath="/shift_template"
        removeAction={removeShiftTemplate}
        displayFields={[
          { field: 'user_account', headerName: tf('userAccount'), width: 200 },
          { field: 'day_of_week', headerName: tf('dayOfWeek'), width: 100 }
        ]}
        primaryField="user_account"
      />
    </>
  );
}
