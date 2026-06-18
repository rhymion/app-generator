import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormView from '@/components/character/FormView';
import { getCharacterDetailPageData } from '@/lib/character/getters';
import { CharacterDetailPageProps } from '@/lib/character/types';
import { notFound } from 'next/navigation';

export default async function ViewCharacterPage({ params }: CharacterDetailPageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<FormSkeleton />}>
      <CharacterViewContent id={id} />
    </Suspense>
  );
}

async function CharacterViewContent({ id }: { id: string }) {
  const { character, userPermissions } = await getCharacterDetailPageData(id);
  if (!character) {
    notFound();
  }
  return <FormView src={character} permissions={userPermissions} />;
}
