import { getShiftListPageData } from '@/lib/shift/getters';
import ResponsiveListClient from '@/components/ResponsiveListClient';
import { removeShift } from '@/lib/shift/actions';

export default async function ShiftsPage() {
  const { shifts, userPermissions } = await getShiftListPageData();
  return <ResponsiveListClient src={shifts} basePath="/shift" removeAction={removeShift} entityLabel="Shift" displayFields={[
    { field: 'user_account', headerName: 'User Account', width: 200 },
    { field: 'start_time', headerName: 'Start Time', width: 200 },
    { field: 'end_time', headerName: 'End Time', width: 200 }
  ]}
    permissions={userPermissions} />;
}
