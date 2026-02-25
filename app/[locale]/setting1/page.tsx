import { getSetting1ListPageData } from '@/lib/setting1/getters';
import ResponsiveListClient from '@/components/ResponsiveListClient';
import { removeSetting1 } from '@/lib/setting1/actions';

export default async function Setting1sPage() {
  const { setting1s, userPermissions } = await getSetting1ListPageData();
  return <ResponsiveListClient src={setting1s} basePath="/setting1" removeAction={removeSetting1} entityLabel="Setting1" displayFields={[
    { field: 'name', headerName: 'Name', width: 150 },
    { field: 'email', headerName: 'Email', width: 400 }
  ]}
    permissions={userPermissions} />;
}
