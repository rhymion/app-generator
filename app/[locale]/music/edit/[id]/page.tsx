import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormUpsert from '@/components/music/FormUpsert';
import { getMusicDetailPageData } from '@/lib/music/getters';
import { searchSceneOptions } from '@/lib/scene/getters';
import { searchCreatorOptions } from '@/lib/creator/getters';
import { MusicDetailPageProps } from '@/lib/music/types';
import { notFound } from 'next/navigation';

export default async function EditMusicPage({ params }: MusicDetailPageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<FormSkeleton />}>
      <MusicEditContent id={id} />
    </Suspense>
  );
}

async function MusicEditContent({ id }: { id: string }) {
  const [detail, initialScenes, initialCreators] = await Promise.all([
    getMusicDetailPageData(id, 'update'),
    searchSceneOptions('', [], 50),
    searchCreatorOptions('', [], 50),
  ]);
  if (!detail.music) {
    notFound();
  }
  return <FormUpsert src={detail.music} isEdit={true} permissions={detail.userPermissions} initialScenes={ initialScenes } searchSceneOptions={ searchSceneOptions } initialCreators={ initialCreators } searchCreatorOptions={ searchCreatorOptions } />;
}
