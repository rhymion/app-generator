import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormUpsert from '@/components/creator/FormUpsert';
import { getCreatorDetailPageData } from '@/lib/creator/getters';
import { searchCharacterOptions } from '@/lib/character/getters';
import { searchMusicOptions } from '@/lib/music/getters';
import { searchSceneOptions } from '@/lib/scene/getters';
import { CreatorDetailPageProps } from '@/lib/creator/types';
import { notFound } from 'next/navigation';

export default async function EditCreatorPage({ params }: CreatorDetailPageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<FormSkeleton />}>
      <CreatorEditContent id={id} />
    </Suspense>
  );
}

async function CreatorEditContent({ id }: { id: string }) {
  const [detail, initialCharacters, initialMusics, initialScenes] = await Promise.all([
    getCreatorDetailPageData(id, 'update'),
    searchCharacterOptions('', [], 50),
    searchMusicOptions('', [], 50),
    searchSceneOptions('', [], 50),
  ]);
  if (!detail.creator) {
    notFound();
  }
  return <FormUpsert src={detail.creator} isEdit={true} permissions={detail.userPermissions} initialCharacters={ initialCharacters } searchCharacterOptions={ searchCharacterOptions } initialMusics={ initialMusics } searchMusicOptions={ searchMusicOptions } initialScenes={ initialScenes } searchSceneOptions={ searchSceneOptions } />;
}
