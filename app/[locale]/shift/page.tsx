import { Suspense } from 'react';
import Loading from '@/app/[locale]/loading';
import { getTranslations } from 'next-intl/server';
import ResponsiveListClient from '@/components/_standard/ResponsiveListClient';
import { getShiftListPageData } from '@/lib/shift/getters';
import { removeShift } from '@/lib/shift/actions';
import Link from '@mui/material/Link';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import BarChartIcon from '@mui/icons-material/BarChart';

export default function ShiftListPage() {
  return (
    <Suspense fallback={<Loading />}>
      <ShiftListContent />
    </Suspense>
  );
}

async function ShiftListContent() {
  const [t, tf, tc] = await Promise.all([
    getTranslations('EntityLabel'),
    getTranslations('Fields'),
    getTranslations('Common'),
  ]);
  const { shifts, userPermissions } = await getShiftListPageData();
  const formattedShifts = shifts.map(item => ({
    ...item,
    start_time: item.start_time ? new Date(item.start_time).toLocaleString('sv-SE') : '',
    end_time: item.end_time ? new Date(item.end_time).toLocaleString('sv-SE') : '',
  }));
  return (
    <>
      <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
        <Button component={Link} href="/shift/chart" variant="outlined" startIcon={<BarChartIcon />}>
          {tc('chart')}
        </Button>
      </Box>
      <ResponsiveListClient
        entityLabel={t('shift')}
        src={formattedShifts}
        permissions={userPermissions}
        basePath="/shift"
        removeAction={removeShift}
        displayFields={[
          { field: 'user_account', headerName: tf('userAccount'), width: 200 },
          { field: 'start_time', headerName: tf('startTime'), width: 200 },
          { field: 'end_time', headerName: tf('endTime'), width: 200 }
        ]}
        primaryField="user_account"
      />
    </>
  );
}
