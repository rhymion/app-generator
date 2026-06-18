import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormUpsert from '@/components/fc_link/FormUpsert';
import { getFcLinkDetailPageData } from '@/lib/fc_link/getters';
import { searchWorkOptions } from '@/lib/work/getters';
import { searchCharacterOptions } from '@/lib/character/getters';
import { searchMusicOptions } from '@/lib/music/getters';
import { searchChannelOptions } from '@/lib/channel/getters';
import { FcLinkDetailPageProps } from '@/lib/fc_link/types';
import { notFound } from 'next/navigation';

export default async function EditFcLinkPage({ params }: FcLinkDetailPageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<FormSkeleton />}>
      <FcLinkEditContent id={id} />
    </Suspense>
  );
}

async function FcLinkEditContent({ id }: { id: string }) {
  const [detail, initialWorks, initialCharacters, initialMusics, initialChannels] = await Promise.all([
    getFcLinkDetailPageData(id, 'update'),
    searchWorkOptions('', [], 50),
    searchCharacterOptions('', [], 50),
    searchMusicOptions('', [], 50),
    searchChannelOptions('', [], 50),
  ]);
  if (!detail.fcLink) {
    notFound();
  }
  return <FormUpsert src={detail.fcLink} isEdit={true} permissions={detail.userPermissions} initialWorks={ initialWorks } searchWorkOptions={ searchWorkOptions } initialCharacters={ initialCharacters } searchCharacterOptions={ searchCharacterOptions } initialMusics={ initialMusics } searchMusicOptions={ searchMusicOptions } initialChannels={ initialChannels } searchChannelOptions={ searchChannelOptions } />;
}
