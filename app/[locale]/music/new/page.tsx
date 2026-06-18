import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormUpsert from '@/components/music/FormUpsert';
import { searchSceneOptions } from '@/lib/scene/getters';
import { searchCreatorOptions } from '@/lib/creator/getters';
import { getMusicNewPageAccessCheck } from '@/lib/music/getters';

export default function AddMusicPage() {
  return (
    <Suspense fallback={<FormSkeleton />}>
      <MusicNewContent />
    </Suspense>
  );
}

async function MusicNewContent() {
  const [userPermissions, initialScenes, initialCreators] = await Promise.all([
    getMusicNewPageAccessCheck(),
    searchSceneOptions('', [], 50),
    searchCreatorOptions('', [], 50),
  ]);
  const src = {
    id: '',
    title: '',
    kind: null,
    scenes: [],
    composers: [],
    credits: [],
  };
  return <FormUpsert src={src} isEdit={false} permissions={userPermissions} initialScenes={ initialScenes } searchSceneOptions={ searchSceneOptions } initialCreators={ initialCreators } searchCreatorOptions={ searchCreatorOptions } />;
}
