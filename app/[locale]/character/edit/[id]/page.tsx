import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormUpsert from '@/components/character/FormUpsert';
import { getCharacterDetailPageData } from '@/lib/character/getters';
import { searchSceneOptions } from '@/lib/scene/getters';
import { searchCreatorOptions } from '@/lib/creator/getters';
import { searchWorkOptions } from '@/lib/work/getters';
import { CharacterDetailPageProps } from '@/lib/character/types';
import { notFound } from 'next/navigation';

export default async function EditCharacterPage({ params }: CharacterDetailPageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<FormSkeleton />}>
      <CharacterEditContent id={id} />
    </Suspense>
  );
}

async function CharacterEditContent({ id }: { id: string }) {
  const [detail, initialScenes, initialCreators, initialWorks] = await Promise.all([
    getCharacterDetailPageData(id, 'update'),
    searchSceneOptions('', [], 50),
    searchCreatorOptions('', [], 50),
    searchWorkOptions('', [], 50),
  ]);
  if (!detail.character) {
    notFound();
  }
  return <FormUpsert src={detail.character} isEdit={true} permissions={detail.userPermissions} initialScenes={ initialScenes } searchSceneOptions={ searchSceneOptions } initialCreators={ initialCreators } searchCreatorOptions={ searchCreatorOptions } initialWorks={ initialWorks } searchWorkOptions={ searchWorkOptions } />;
}
