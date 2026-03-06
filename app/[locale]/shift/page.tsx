import { getTranslations } from 'next-intl/server';
import { getShiftListPageData } from '@/lib/shift/getters';
import ResponsiveListClient from '@/components/ResponsiveListClient';
import { removeShift } from '@/lib/shift/actions';
import Link from '@mui/material/Link';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import BarChartIcon from '@mui/icons-material/BarChart';

export default async function ShiftsPage() {
  const { shifts, userPermissions } = await getShiftListPageData();
  const [t, tf, tc] = await Promise.all([
    getTranslations('EntityLabel'),
    getTranslations('Fields'),
    getTranslations('Common'),
  ]);
  const formattedShifts = shifts.map(item => ({
    ...item,
    start_time: item.start_time ? new Date(item.start_time).toLocaleString('sv-SE') : '',
    end_time: item.end_time ? new Date(item.end_time).toLocaleString('sv-SE') : '',
  }));
  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'flex-start', mb: 1 }}>
        <Link href="/shift/chart" underline="none">
          <Button variant="outlined" size="medium" startIcon={<BarChartIcon />}>{tc('chart')}</Button>
        </Link>
      </Box>
      <ResponsiveListClient src={formattedShifts} basePath="/shift" removeAction={removeShift} entityLabel={t('shift')} primaryField="user_account" displayFields={[
    { field: 'user_account', headerName: tf('userAccount'), width: 200 },
    { field: 'start_time', headerName: tf('startTime'), width: 200 },
    { field: 'end_time', headerName: tf('endTime'), width: 200 }
  ]}
        permissions={userPermissions} />
    </Box>
  );
}
