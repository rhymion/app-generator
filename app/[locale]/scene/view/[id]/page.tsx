import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormView from '@/components/scene/FormView';
import { getSceneDetailPageData } from '@/lib/scene/getters';
import { SceneDetailPageProps } from '@/lib/scene/types';
import { notFound } from 'next/navigation';

export default async function ViewScenePage({ params }: SceneDetailPageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<FormSkeleton />}>
      <SceneViewContent id={id} />
    </Suspense>
  );
}

async function SceneViewContent({ id }: { id: string }) {
  const { scene, userPermissions } = await getSceneDetailPageData(id);
  if (!scene) {
    notFound();
  }
  return <FormView src={scene} permissions={userPermissions} />;
}
