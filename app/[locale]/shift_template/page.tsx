import { getShiftTemplateListPageData } from '@/lib/shift_template/getters';
import ResponsiveListClient from '@/components/ResponsiveListClient';
import { removeShiftTemplate } from '@/lib/shift_template/actions';
import Box from '@mui/material/Box';
import CopyShiftsButton from '@/components/shift_template/CopyShiftsButton';
import { getTranslations } from 'next-intl/server';

export default async function ShiftTemplatesPage() {
  const [t, tf, td] = await Promise.all([
    getTranslations('EntityLabel'),
    getTranslations('Fields'),
    getTranslations('DayOfWeek'),
  ]);
  const { shiftTemplates, userPermissions } = await getShiftTemplateListPageData();
  const dayLabels = [td('sunday'), td('monday'), td('tuesday'), td('wednesday'), td('thursday'), td('friday'), td('saturday')];
  const formattedShiftTemplates = shiftTemplates.map(item => ({
    ...item,
    day_of_week: dayLabels[item.day_of_week as number] ?? '',
  }));
  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'flex-start', mb: 1 }}>
        <CopyShiftsButton permissions={userPermissions} />
      </Box>
      <ResponsiveListClient src={formattedShiftTemplates} basePath="/shift_template" removeAction={removeShiftTemplate} entityLabel={t('shiftTemplate')} primaryField="user_account" displayFields={[
    { field: 'user_account', headerName: tf('userAccount'), width: 200 },
    { field: 'day_of_week', headerName: tf('dayOfWeek'), width: 100 }
  ]}
        permissions={userPermissions} />
    </Box>
  );
}
