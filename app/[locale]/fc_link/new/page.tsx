import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormUpsert from '@/components/fc_link/FormUpsert';
import { searchWorkOptions } from '@/lib/work/getters';
import { searchCharacterOptions } from '@/lib/character/getters';
import { searchMusicOptions } from '@/lib/music/getters';
import { searchChannelOptions } from '@/lib/channel/getters';
import { getFcLinkNewPageAccessCheck } from '@/lib/fc_link/getters';

type NewSearchParams = Record<string, string | string[] | undefined>;

export default function AddFcLinkPage({ searchParams }: { searchParams: Promise<NewSearchParams> }) {
  return (
    <Suspense fallback={<FormSkeleton />}>
      <FcLinkNewContent searchParams={searchParams} />
    </Suspense>
  );
}

async function FcLinkNewContent({ searchParams }: { searchParams: Promise<NewSearchParams> }) {
  const _sp = await searchParams;
  const _initialParentType = typeof _sp.parentType === 'string' ? _sp.parentType : '';
  const _initialParentId = typeof _sp.parentId === 'string' ? _sp.parentId : '';
  const [userPermissions, initialWorks, initialCharacters, initialMusics, initialChannels] = await Promise.all([
    getFcLinkNewPageAccessCheck(),
    searchWorkOptions('', [], 50),
    searchCharacterOptions('', [], 50),
    searchMusicOptions('', [], 50),
    searchChannelOptions('', [], 50),
  ]);
  const src = {
    id: '',
    name: '',
    url: '',
  };
  return <FormUpsert src={src} isEdit={false} permissions={userPermissions} initialWorks={ initialWorks } searchWorkOptions={ searchWorkOptions } initialCharacters={ initialCharacters } searchCharacterOptions={ searchCharacterOptions } initialMusics={ initialMusics } searchMusicOptions={ searchMusicOptions } initialChannels={ initialChannels } searchChannelOptions={ searchChannelOptions } initialParentType={_initialParentType} initialParentId={_initialParentId} />;
}
