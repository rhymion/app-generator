import { getShiftListPageData } from '@/lib/shift/getters';
import ResponsiveListClient from '@/components/ResponsiveListClient';
import { removeShift } from '@/lib/shift/actions';
// import { Link } from '@/i18n/navigation';
import Link from '@mui/material/Link';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import BarChartIcon from '@mui/icons-material/BarChart';

export default async function ShiftsPage() {
  const { shifts, userPermissions } = await getShiftListPageData();
  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'flex-start', mb: 1 }}>
        <Link href="/shift/chart">
          <Button variant="outlined" size="medium" startIcon={<BarChartIcon />}>
            Chart
          </Button>
        </Link>
      </Box>
      <ResponsiveListClient src={shifts} basePath="/shift" removeAction={removeShift} entityLabel="Shift" displayFields={[
        { field: 'user_account', headerName: 'User Account', width: 200 },
        { field: 'start_time', headerName: 'Start Time', width: 200 },
        { field: 'end_time', headerName: 'End Time', width: 200 }
      ]}
        permissions={userPermissions} />
    </Box>
  );
}
