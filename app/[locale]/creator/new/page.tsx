import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormUpsert from '@/components/creator/FormUpsert';
import { searchCharacterOptions } from '@/lib/character/getters';
import { searchMusicOptions } from '@/lib/music/getters';
import { searchSceneOptions } from '@/lib/scene/getters';
import { getCreatorNewPageAccessCheck } from '@/lib/creator/getters';

export default function AddCreatorPage() {
  return (
    <Suspense fallback={<FormSkeleton />}>
      <CreatorNewContent />
    </Suspense>
  );
}

async function CreatorNewContent() {
  const [userPermissions, initialCharacters, initialMusics, initialScenes] = await Promise.all([
    getCreatorNewPageAccessCheck(),
    searchCharacterOptions('', [], 50),
    searchMusicOptions('', [], 50),
    searchSceneOptions('', [], 50),
  ]);
  const src = {
    id: '',
    name: '',
    role: null,
    affiliation: null,
    voiced_characters: [],
    composed_musics: [],
    credited_musics: [],
    credited_scenes: [],
  };
  return <FormUpsert src={src} isEdit={false} permissions={userPermissions} initialCharacters={ initialCharacters } searchCharacterOptions={ searchCharacterOptions } initialMusics={ initialMusics } searchMusicOptions={ searchMusicOptions } initialScenes={ initialScenes } searchSceneOptions={ searchSceneOptions } />;
}
