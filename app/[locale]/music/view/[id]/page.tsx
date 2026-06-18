import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormView from '@/components/music/FormView';
import { getMusicDetailPageData } from '@/lib/music/getters';
import { MusicDetailPageProps } from '@/lib/music/types';
import { notFound } from 'next/navigation';

export default async function ViewMusicPage({ params }: MusicDetailPageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<FormSkeleton />}>
      <MusicViewContent id={id} />
    </Suspense>
  );
}

async function MusicViewContent({ id }: { id: string }) {
  const { music, userPermissions } = await getMusicDetailPageData(id);
  if (!music) {
    notFound();
  }
  return <FormView src={music} permissions={userPermissions} />;
}
