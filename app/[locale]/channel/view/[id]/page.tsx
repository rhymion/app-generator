import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormView from '@/components/channel/FormView';
import { getChannelDetailPageData } from '@/lib/channel/getters';
import { ChannelDetailPageProps } from '@/lib/channel/types';
import { notFound } from 'next/navigation';

export default async function ViewChannelPage({ params }: ChannelDetailPageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<FormSkeleton />}>
      <ChannelViewContent id={id} />
    </Suspense>
  );
}

async function ChannelViewContent({ id }: { id: string }) {
  const { channel, userPermissions } = await getChannelDetailPageData(id);
  if (!channel) {
    notFound();
  }
  return <FormView src={channel} permissions={userPermissions} />;
}
