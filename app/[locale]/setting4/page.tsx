import { getSetting4ListPageData } from '@/lib/setting4/getters';
import ResponsiveListClient from '@/components/ResponsiveListClient';

export default async function Setting4sPage() {
  const { setting4s, userPermissions } = await getSetting4ListPageData();
  return <ResponsiveListClient src={setting4s} basePath="/setting4" entityLabel="Setting4" displayFields={[
    { field: 'name', headerName: 'Name', width: 150 },
    { field: 'email', headerName: 'Email', width: 400 }
  ]}
    permissions={userPermissions} />;
}
