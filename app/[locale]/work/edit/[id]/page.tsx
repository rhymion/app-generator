import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormUpsert from '@/components/work/FormUpsert';
import { getWorkDetailPageData } from '@/lib/work/getters';
import { searchCharacterOptions } from '@/lib/character/getters';
import { searchSceneOptions } from '@/lib/scene/getters';
import { WorkDetailPageProps } from '@/lib/work/types';
import { notFound } from 'next/navigation';

export default async function EditWorkPage({ params }: WorkDetailPageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<FormSkeleton />}>
      <WorkEditContent id={id} />
    </Suspense>
  );
}

async function WorkEditContent({ id }: { id: string }) {
  const [detail, initialCharacters, initialScenes] = await Promise.all([
    getWorkDetailPageData(id, 'update'),
    searchCharacterOptions('', [], 50),
    searchSceneOptions('', [], 50),
  ]);
  if (!detail.work) {
    notFound();
  }
  return <FormUpsert src={detail.work} isEdit={true} permissions={detail.userPermissions} initialCharacters={ initialCharacters } searchCharacterOptions={ searchCharacterOptions } initialScenes={ initialScenes } searchSceneOptions={ searchSceneOptions } />;
}
