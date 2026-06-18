import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormUpsert from '@/components/scene/FormUpsert';
import { searchCharacterOptions } from '@/lib/character/getters';
import { searchMusicOptions } from '@/lib/music/getters';
import { searchCreatorOptions } from '@/lib/creator/getters';
import { searchWorkOptions } from '@/lib/work/getters';
import { getSceneNewPageAccessCheck } from '@/lib/scene/getters';

export default function AddScenePage() {
  return (
    <Suspense fallback={<FormSkeleton />}>
      <SceneNewContent />
    </Suspense>
  );
}

async function SceneNewContent() {
  const [userPermissions, initialCharacters, initialMusics, initialCreators, initialWorks] = await Promise.all([
    getSceneNewPageAccessCheck(),
    searchCharacterOptions('', [], 50),
    searchMusicOptions('', [], 50),
    searchCreatorOptions('', [], 50),
    searchWorkOptions('', [], 50),
  ]);
  const src = {
    id: '',
    label: '',
    work_id: '',
    episode: '',
    timestamp: '',
    characters: [],
    music: [],
    creators: [],
  };
  return <FormUpsert src={src} isEdit={false} permissions={userPermissions} initialCharacters={ initialCharacters } searchCharacterOptions={ searchCharacterOptions } initialMusics={ initialMusics } searchMusicOptions={ searchMusicOptions } initialCreators={ initialCreators } searchCreatorOptions={ searchCreatorOptions } initialWorks={ initialWorks } searchWorkOptions={ searchWorkOptions } />;
}
