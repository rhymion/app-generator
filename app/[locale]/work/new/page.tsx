import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormUpsert from '@/components/work/FormUpsert';
import { searchCharacterOptions } from '@/lib/character/getters';
import { searchSceneOptions } from '@/lib/scene/getters';
import { getWorkNewPageAccessCheck } from '@/lib/work/getters';

export default function AddWorkPage() {
  return (
    <Suspense fallback={<FormSkeleton />}>
      <WorkNewContent />
    </Suspense>
  );
}

async function WorkNewContent() {
  const [userPermissions, initialCharacters, initialScenes] = await Promise.all([
    getWorkNewPageAccessCheck(),
    searchCharacterOptions('', [], 50),
    searchSceneOptions('', [], 50),
  ]);
  const src = {
    id: '',
    title: '',
    pattern: null,
    status: null,
    characters: [],
    scenes: [],
  };
  return <FormUpsert src={src} isEdit={false} permissions={userPermissions} initialCharacters={ initialCharacters } searchCharacterOptions={ searchCharacterOptions } initialScenes={ initialScenes } searchSceneOptions={ searchSceneOptions } />;
}
