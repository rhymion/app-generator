import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormUpsert from '@/components/scene/FormUpsert';
import { getSceneDetailPageData } from '@/lib/scene/getters';
import { searchCharacterOptions } from '@/lib/character/getters';
import { searchMusicOptions } from '@/lib/music/getters';
import { searchCreatorOptions } from '@/lib/creator/getters';
import { searchWorkOptions } from '@/lib/work/getters';
import { SceneDetailPageProps } from '@/lib/scene/types';
import { notFound } from 'next/navigation';

export default async function EditScenePage({ params }: SceneDetailPageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<FormSkeleton />}>
      <SceneEditContent id={id} />
    </Suspense>
  );
}

async function SceneEditContent({ id }: { id: string }) {
  const [detail, initialCharacters, initialMusics, initialCreators, initialWorks] = await Promise.all([
    getSceneDetailPageData(id, 'update'),
    searchCharacterOptions('', [], 50),
    searchMusicOptions('', [], 50),
    searchCreatorOptions('', [], 50),
    searchWorkOptions('', [], 50),
  ]);
  if (!detail.scene) {
    notFound();
  }
  return <FormUpsert src={detail.scene} isEdit={true} permissions={detail.userPermissions} initialCharacters={ initialCharacters } searchCharacterOptions={ searchCharacterOptions } initialMusics={ initialMusics } searchMusicOptions={ searchMusicOptions } initialCreators={ initialCreators } searchCreatorOptions={ searchCreatorOptions } initialWorks={ initialWorks } searchWorkOptions={ searchWorkOptions } />;
}
