import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormUpsert from '@/components/character/FormUpsert';
import { searchSceneOptions } from '@/lib/scene/getters';
import { searchCreatorOptions } from '@/lib/creator/getters';
import { searchWorkOptions } from '@/lib/work/getters';
import { getCharacterNewPageAccessCheck } from '@/lib/character/getters';

export default function AddCharacterPage() {
  return (
    <Suspense fallback={<FormSkeleton />}>
      <CharacterNewContent />
    </Suspense>
  );
}

async function CharacterNewContent() {
  const [userPermissions, initialScenes, initialCreators, initialWorks] = await Promise.all([
    getCharacterNewPageAccessCheck(),
    searchSceneOptions('', [], 50),
    searchCreatorOptions('', [], 50),
    searchWorkOptions('', [], 50),
  ]);
  const src = {
    id: '',
    name: '',
    work_id: '',
    official_image: false,
    scenes: [],
    creators: [],
  };
  return <FormUpsert src={src} isEdit={false} permissions={userPermissions} initialScenes={ initialScenes } searchSceneOptions={ searchSceneOptions } initialCreators={ initialCreators } searchCreatorOptions={ searchCreatorOptions } initialWorks={ initialWorks } searchWorkOptions={ searchWorkOptions } />;
}
