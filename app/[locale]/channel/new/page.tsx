import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormUpsert from '@/components/channel/FormUpsert';
import { searchAssociatedOrganizationOptions } from '@/lib/organization/getters_associated';
import { searchWorkOptions } from '@/lib/work/getters';
import { searchCharacterOptions } from '@/lib/character/getters';
import { searchSceneOptions } from '@/lib/scene/getters';
import { getChannelNewPageAccessCheck } from '@/lib/channel/getters';

type NewSearchParams = Record<string, string | string[] | undefined>;

export default function AddChannelPage({ searchParams }: { searchParams: Promise<NewSearchParams> }) {
  return (
    <Suspense fallback={<FormSkeleton />}>
      <ChannelNewContent searchParams={searchParams} />
    </Suspense>
  );
}

async function ChannelNewContent({ searchParams }: { searchParams: Promise<NewSearchParams> }) {
  const _sp = await searchParams;
  const _initialParentType = typeof _sp.parentType === 'string' ? _sp.parentType : '';
  const _initialParentId = typeof _sp.parentId === 'string' ? _sp.parentId : '';
  const [userPermissions, initialOrganizations, initialWorks, initialCharacters, initialScenes] = await Promise.all([
    getChannelNewPageAccessCheck(),
    searchAssociatedOrganizationOptions('', [], 50),
    searchWorkOptions('', [], 50),
    searchCharacterOptions('', [], 50),
    searchSceneOptions('', [], 50),
  ]);
  const src = {
    id: '',
    name: '',
    kind: null,
    organization_id: '',
  };
  return <FormUpsert src={src} isEdit={false} permissions={userPermissions} initialOrganizations={ initialOrganizations } searchOrganizationOptions={ searchAssociatedOrganizationOptions } initialWorks={ initialWorks } searchWorkOptions={ searchWorkOptions } initialCharacters={ initialCharacters } searchCharacterOptions={ searchCharacterOptions } initialScenes={ initialScenes } searchSceneOptions={ searchSceneOptions } initialParentType={_initialParentType} initialParentId={_initialParentId} />;
}
