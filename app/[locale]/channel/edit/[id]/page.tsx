import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormUpsert from '@/components/channel/FormUpsert';
import { getChannelDetailPageData } from '@/lib/channel/getters';
import { searchAssociatedOrganizationOptions } from '@/lib/organization/getters_associated';
import { searchWorkOptions } from '@/lib/work/getters';
import { searchCharacterOptions } from '@/lib/character/getters';
import { searchSceneOptions } from '@/lib/scene/getters';
import { getSessionUserId } from '@/lib/authz';
import { ChannelDetailPageProps } from '@/lib/channel/types';
import { notFound } from 'next/navigation';

export default async function EditChannelPage({ params }: ChannelDetailPageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<FormSkeleton />}>
      <ChannelEditContent id={id} />
    </Suspense>
  );
}

async function ChannelEditContent({ id }: { id: string }) {
  const [detail, initialOrganizations, initialWorks, initialCharacters, initialScenes] = await Promise.all([
    getChannelDetailPageData(id, 'update'),
    searchAssociatedOrganizationOptions('', [], 50),
    searchWorkOptions('', [], 50),
    searchCharacterOptions('', [], 50),
    searchSceneOptions('', [], 50),
  ]);
  const currentUserId = await getSessionUserId();
  if (!detail.channel) {
    notFound();
  }
  return <FormUpsert src={detail.channel} isEdit={true} permissions={detail.userPermissions} initialOrganizations={ initialOrganizations } searchOrganizationOptions={ searchAssociatedOrganizationOptions } initialWorks={ initialWorks } searchWorkOptions={ searchWorkOptions } initialCharacters={ initialCharacters } searchCharacterOptions={ searchCharacterOptions } initialScenes={ initialScenes } searchSceneOptions={ searchSceneOptions } currentUserId={currentUserId} />;
}
